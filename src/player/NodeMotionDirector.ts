import type * as Phaser from 'phaser'
import type {
  MotionDirection,
  MotionEasing,
  NodeMotionAction,
} from '../shared/interactionTypes'
import type { NativeRenderableBase } from '../shared/contracts/native-v1/types'
import type {
  CourseEventBus,
  RuntimeExecutionMode,
} from '../shared/runtimeTypes'
import type { RenderedNodeHandle } from './renderNode'

const SLIDE_DISTANCE = 48
const SCALE_MULTIPLIER = 0.84
const AUTHORING_EXIT_PREVIEW_HOLD_MS = 180
const AUTHORING_PREVIEW_WATCHDOG_GRACE_MS = 500

export type MotionRenderableNode = Pick<
  NativeRenderableBase,
  'id' | 'visible' | 'playbackInitialVisibility' | 'x' | 'y' | 'width' | 'height' | 'opacity'
>

interface MotionFrame {
  x: number
  y: number
  alpha: number
  scaleX: number
  scaleY: number
}

interface ActiveMotion {
  readonly token: symbol
  readonly settle: (completed: boolean) => void
  tween?: Phaser.Tweens.Tween
}

interface MotionRecord {
  handle: RenderedNodeHandle
  node: MotionRenderableNode
  eligible: boolean
  runtimeVisible: boolean
  frame: MotionFrame
  active?: ActiveMotion
  interruptedFrame: boolean
}

interface PendingActivation {
  nodeId: string
  sceneId?: string
}

export interface NodeMotionDirectorOptions {
  scene: Phaser.Scene
  scope: 'scene' | 'global'
  mode: RuntimeExecutionMode
  events: CourseEventBus
  sceneId?: string
  prefersReducedMotion?: () => boolean
}

export interface UpdateNodeMotionOptions {
  /** Preserve a global node's transient enter/exit result across ordinary pages. */
  preserveTransient?: boolean
  /** Scene id captured for scene.in conditions when a global node activates. */
  activationSceneId?: string
  /** A presentation transition owns the current x/y/alpha until it completes. */
  preserveRenderedFrame?: boolean
}

export interface PlayNodeMotionOptions {
  /** Restart this authored action from its canonical endpoint. */
  restartFromBeginning?: boolean
  /** Editor-only: animate a transient preview even in deterministic capture mode. */
  animateInCapture?: boolean
}

function playbackStartsHidden(node: MotionRenderableNode): boolean {
  return node.playbackInitialVisibility === 'hidden'
}

function easingName(easing: MotionEasing): string {
  switch (easing) {
    case 'linear':
      return 'Linear'
    case 'ease-in':
      return 'Sine.easeIn'
    case 'ease-out':
      return 'Sine.easeOut'
    case 'ease-in-out':
      return 'Sine.easeInOut'
  }
}

function slideOffset(direction: MotionDirection | undefined): {
  x: number
  y: number
} {
  switch (direction) {
    case 'right':
      return { x: SLIDE_DISTANCE, y: 0 }
    case 'up':
      return { x: 0, y: -SLIDE_DISTANCE }
    case 'down':
      return { x: 0, y: SLIDE_DISTANCE }
    case 'left':
    default:
      return { x: -SLIDE_DISTANCE, y: 0 }
  }
}

function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Owns transient playback visibility without mutating NativeRenderInput.visible or a
 * presentation state. Scene and global scopes deliberately use separate
 * instances so scene teardown cannot reset persistent global motion results.
 */
export class NodeMotionDirector {
  private readonly scene: Phaser.Scene
  private readonly scope: 'scene' | 'global'
  private readonly mode: RuntimeExecutionMode
  private readonly events: CourseEventBus
  private readonly sceneId?: string
  private readonly prefersReducedMotion: () => boolean
  private readonly records = new Map<string, MotionRecord>()
  private readonly pendingActivations = new Map<string, PendingActivation>()
  private readonly disabledInputStates = new WeakMap<object, boolean>()
  private readonly previewTokens = new Map<string, symbol>()
  private readonly previewTimers = new Map<string, Phaser.Time.TimerEvent>()
  private readonly previewWatchdogs = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private destroyed = false

  constructor(options: NodeMotionDirectorOptions) {
    this.scene = options.scene
    this.scope = options.scope
    this.mode = options.mode
    this.events = options.events
    this.sceneId = options.sceneId
    this.prefersReducedMotion = options.prefersReducedMotion ??
      systemPrefersReducedMotion
  }

  register(
    handle: RenderedNodeHandle,
    node: MotionRenderableNode,
    eligible = node.visible,
    activationSceneId = this.sceneId,
  ): void {
    if (this.destroyed) return
    this.unregister(handle.id)
    const runtimeVisible = this.mode === 'capture'
      ? eligible
      : eligible && !playbackStartsHidden(node)
    const record: MotionRecord = {
      handle,
      node,
      eligible,
      runtimeVisible,
      frame: this.frameFor(node, handle),
      interruptedFrame: false,
    }
    this.records.set(handle.id, record)
    this.applyStableFrame(record)
    this.setRuntimeVisible(record, runtimeVisible)
    if (eligible) this.queueActivation(handle.id, activationSceneId)
  }

  unregister(nodeId: string): void {
    const record = this.records.get(nodeId)
    if (!record) return
    this.clearPreviewSession(nodeId)
    this.cancelActive(record, false)
    this.records.delete(nodeId)
    this.pendingActivations.delete(nodeId)
  }

  /**
   * Must run before a renderer applies a new presentation frame. It releases
   * any motion waiter and restores scale/position so the presentation tween
   * starts from a stable authored frame rather than a half-finished exit.
   */
  prepareStableUpdate(nodeId: string): void {
    const record = this.records.get(nodeId)
    if (!record) return
    this.clearPreviewSession(nodeId)
    this.cancelActive(record, false)
    this.applyStableFrame(record)
    this.setRuntimeVisible(record, record.eligible)
  }

  update(
    handle: RenderedNodeHandle,
    node: MotionRenderableNode,
    eligible = node.visible,
    options: UpdateNodeMotionOptions = {},
  ): void {
    if (this.destroyed) return
    const record = this.records.get(handle.id)
    if (!record) {
      this.register(handle, node, eligible, options.activationSceneId)
      return
    }

    const wasEligible = record.eligible
    const preservedVisibility = record.runtimeVisible
    if (wasEligible && eligible && options.preserveTransient) {
      record.handle = handle
      record.node = node
      // Persistent global nodes keep both an in-flight tween and its completed
      // visibility across ordinary scene navigation.
      this.setVisualVisibility(record, preservedVisibility)
      this.setInputTreeEnabled(
        handle.root,
        preservedVisibility && !record.active && handle.root.visible !== false,
      )
      return
    }
    this.cancelActive(record, false)
    record.handle = handle
    record.node = node
    record.eligible = eligible
    record.frame = this.frameFor(node, handle)

    let runtimeVisible: boolean
    if (this.mode === 'capture') {
      runtimeVisible = eligible
    } else if (!wasEligible && eligible) {
      runtimeVisible = !playbackStartsHidden(node)
    } else if (wasEligible && eligible && options.preserveTransient) {
      runtimeVisible = preservedVisibility
    } else {
      runtimeVisible = eligible
    }
    record.runtimeVisible = runtimeVisible
    if (!runtimeVisible) {
      this.scene.tweens.killTweensOf(this.motionTarget(record))
      this.applyStableFrame(record)
    } else if (!options.preserveRenderedFrame) {
      this.applyStableFrame(record)
    }
    this.setRuntimeVisible(record, runtimeVisible)

    if (!wasEligible && eligible) {
      this.queueActivation(handle.id, options.activationSceneId ?? this.sceneId)
    } else if (wasEligible && !eligible) {
      this.pendingActivations.delete(handle.id)
    }
  }

  /**
   * Starts a fresh stable-state activation epoch for an already registered
   * node. Presentation states are semantic entry points even when a node stays
   * author-visible across two states, so activation cannot be inferred only
   * from a false -> true visibility edge.
   *
   * Nodes authored to wait for an enter action are reset to their stable frame
   * and hidden before the activation is published. Other unchanged nodes keep
   * their transient frame; entering a state must not cancel unrelated motion.
   */
  beginActivationEpoch(
    nodeId: string,
    activationSceneId = this.sceneId,
  ): void {
    if (this.destroyed || this.mode === 'capture') return
    const record = this.records.get(nodeId)
    if (!record?.eligible) {
      this.pendingActivations.delete(nodeId)
      return
    }

    if (playbackStartsHidden(record.node)) {
      this.cancelActive(record, false)
      this.scene.tweens.killTweensOf(this.motionTarget(record))
      this.applyStableFrame(record)
      this.setRuntimeVisible(record, false)
    }
    this.queueActivation(nodeId, activationSceneId)
  }

  /** Re-applies disabled input after InteractionEngine installs click zones. */
  refreshInputStates(): void {
    for (const record of this.records.values()) {
      this.setInputTreeEnabled(
        record.handle.root,
        record.runtimeVisible && !record.active &&
          record.handle.root.visible !== false,
      )
    }
  }

  flushActivations(): void {
    if (this.destroyed || this.mode === 'capture') {
      this.pendingActivations.clear()
      return
    }
    const activations = [...this.pendingActivations.values()]
    this.pendingActivations.clear()
    for (const activation of activations) {
      const record = this.records.get(activation.nodeId)
      if (!record?.eligible) continue
      this.events.emit('node:activated', {
        scope: this.scope,
        nodeId: activation.nodeId,
        ...(activation.sceneId ? { sceneId: activation.sceneId } : {}),
      })
    }
  }

  play(
    action: NodeMotionAction,
    signal?: AbortSignal,
    options: PlayNodeMotionOptions = {},
  ): Promise<boolean> {
    const record = this.records.get(action.nodeId)
    if (
      this.destroyed ||
      !record ||
      !record.handle.root.active ||
      !this.motionTarget(record).active ||
      signal?.aborted
    ) {
      return Promise.resolve(false)
    }

    const root = record.handle.root
    const motionTarget = this.motionTarget(record)
    const interrupted = Boolean(record.active) || record.interruptedFrame
    this.cancelActive(record)
    record.interruptedFrame = false
    this.scene.tweens.killTweensOf(motionTarget)

    const entering = action.type === 'node.enter'
    const restartFromBeginning = options.restartFromBeginning === true
    if (
      !restartFromBeginning &&
      !interrupted &&
      record.runtimeVisible === entering
    ) {
      this.applyStableFrame(record)
      this.setRuntimeVisible(record, entering)
      return Promise.resolve(true)
    }

    if (restartFromBeginning) {
      if (entering) {
        this.applyMotionEndpoint(record, action, 'hidden')
      } else {
        this.applyStableFrame(record)
      }
      // A completed exit leaves the object transiently hidden. Replaying that
      // exit must first restore the authored visible endpoint so the full
      // action is observable again.
      record.runtimeVisible = true
      this.setVisualVisibility(record, true)
    } else if (entering && !interrupted) {
      this.applyMotionEndpoint(record, action, 'hidden')
    }
    if (entering) {
      record.runtimeVisible = true
      this.setVisualVisibility(record, true)
    }
    this.setInputTreeEnabled(root, false)

    const duration = this.mode === 'capture' && options.animateInCapture !== true ||
      this.prefersReducedMotion() ||
      action.effect === 'none'
      ? 0
      : Math.max(0, Math.min(10_000, action.durationMs))

    return new Promise<boolean>((resolve) => {
      const token = Symbol(`node-motion:${action.nodeId}`)
      let settled = false
      const abort = (): void => {
        if (record.active?.token !== token) return
        this.scene.tweens.killTweensOf(motionTarget)
        record.interruptedFrame = true
        settle(false)
      }
      const settle = (completed: boolean): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        if (record.active?.token === token) delete record.active
        resolve(completed)
      }
      const complete = (): void => {
        if (
          record.active?.token !== token ||
          !root.active ||
          !motionTarget.active
        ) {
          settle(false)
          return
        }
        delete record.active
        record.interruptedFrame = false
        this.applyStableFrame(record)
        record.runtimeVisible = entering
        this.setRuntimeVisible(record, entering)
        settle(true)
      }
      const active: ActiveMotion = { token, settle }
      record.active = active
      signal?.addEventListener('abort', abort, { once: true })

      if (duration === 0) {
        complete()
        return
      }

      const endpoint = this.motionEndpoint(record, action, entering ? 'visible' : 'hidden')
      active.tween = this.scene.tweens.add({
        targets: motionTarget,
        ...endpoint,
        duration,
        ease: easingName(action.easing),
        onComplete: complete,
      })
    })
  }

  /**
   * Plays one isolated editor preview and restores the authored stable frame.
   * The request is session-local and never changes Project or runtimeVisible.
   */
  preview(action: NodeMotionAction, delayMs = 0): boolean {
    const record = this.records.get(action.nodeId)
    if (
      this.destroyed ||
      !record?.eligible ||
      !record.handle.root.active ||
      !this.motionTarget(record).active
    ) {
      return false
    }

    this.cancel(action.nodeId, true)
    const token = Symbol(`node-motion-preview:${action.nodeId}`)
    this.previewTokens.set(action.nodeId, token)
    const start = (): void => {
      this.previewTimers.delete(action.nodeId)
      if (this.previewTokens.get(action.nodeId) !== token) return
      const playback = this.play(action, undefined, {
        restartFromBeginning: true,
        animateInCapture: true,
      })
      this.schedulePreviewWatchdog(action, token)
      void playback.then((completed) => {
        if (this.previewTokens.get(action.nodeId) !== token) return
        if (!completed) {
          this.previewTokens.delete(action.nodeId)
          return
        }
        if (action.type === 'node.exit') {
          const timer = this.scene.time.delayedCall(
            AUTHORING_EXIT_PREVIEW_HOLD_MS,
            () => {
              if (this.previewTokens.get(action.nodeId) === token) {
                this.cancel(action.nodeId, true)
              }
            },
          )
          this.previewTimers.set(action.nodeId, timer)
        } else {
          this.cancel(action.nodeId, true)
        }
      })
    }
    const delay = Math.max(0, Math.min(60_000, delayMs))
    if (delay === 0) start()
    else {
      this.previewTimers.set(
        action.nodeId,
        this.scene.time.delayedCall(delay, start),
      )
    }
    return true
  }

  cancel(nodeId: string, restoreStable = true): void {
    const record = this.records.get(nodeId)
    if (!record) return
    this.clearPreviewSession(nodeId)
    this.cancelActive(record, !restoreStable)
    if (restoreStable) {
      this.applyStableFrame(record)
      record.runtimeVisible = record.eligible
      this.setRuntimeVisible(record, record.eligible)
      record.interruptedFrame = false
    }
  }

  clear(): void {
    if (this.destroyed) return
    for (const nodeId of this.previewTokens.keys()) {
      this.clearPreviewSession(nodeId)
    }
    for (const record of this.records.values()) this.cancelActive(record, false)
    this.records.clear()
    this.pendingActivations.clear()
    this.destroyed = true
  }

  private clearPreviewSession(nodeId: string): void {
    this.previewTimers.get(nodeId)?.remove(false)
    this.previewTimers.delete(nodeId)
    const watchdog = this.previewWatchdogs.get(nodeId)
    if (watchdog !== undefined) clearTimeout(watchdog)
    this.previewWatchdogs.delete(nodeId)
    this.previewTokens.delete(nodeId)
  }

  /**
   * Phaser tweens are driven by animation frames. A fully hidden authoring
   * window can temporarily starve those frames even when Chromium background
   * throttling is disabled, leaving the canvas at the preview start endpoint.
   * This wall-clock guard affects only the isolated editor preview: normal
   * playback keeps its authored timing, while an expired preview always
   * returns to the stable Project frame.
   */
  private schedulePreviewWatchdog(
    action: NodeMotionAction,
    token: symbol,
  ): void {
    const previous = this.previewWatchdogs.get(action.nodeId)
    if (previous !== undefined) clearTimeout(previous)
    const duration = action.effect === 'none' || this.prefersReducedMotion()
      ? 0
      : Math.max(0, Math.min(10_000, action.durationMs))
    const exitHold = action.type === 'node.exit'
      ? AUTHORING_EXIT_PREVIEW_HOLD_MS
      : 0
    const watchdog = setTimeout(() => {
      this.previewWatchdogs.delete(action.nodeId)
      if (this.previewTokens.get(action.nodeId) !== token) return
      this.cancel(action.nodeId, true)
    }, duration + exitHold + AUTHORING_PREVIEW_WATCHDOG_GRACE_MS)
    this.previewWatchdogs.set(action.nodeId, watchdog)
  }

  private frameFor(
    node: MotionRenderableNode,
    handle: RenderedNodeHandle,
  ): MotionFrame {
    if (handle.motionRoot) {
      return { x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 }
    }
    const root = handle.root
    const renderedWidth = root.width > 0 ? root.width : node.width
    const renderedHeight = root.height > 0 ? root.height : node.height
    return {
      x: node.x + renderedWidth / 2,
      y: node.y + renderedHeight / 2,
      alpha: node.opacity,
      scaleX: root.scaleX,
      scaleY: root.scaleY,
    }
  }

  private motionEndpoint(
    record: MotionRecord,
    action: NodeMotionAction,
    state: 'visible' | 'hidden',
  ): Partial<MotionFrame> {
    const frame = record.frame
    if (state === 'visible' || action.effect === 'none') return { ...frame }
    switch (action.effect) {
      case 'fade':
        return { ...frame, alpha: 0 }
      case 'slide': {
        const offset = slideOffset(action.direction)
        return { ...frame, x: frame.x + offset.x, y: frame.y + offset.y }
      }
      case 'scale':
        return {
          ...frame,
          scaleX: frame.scaleX * SCALE_MULTIPLIER,
          scaleY: frame.scaleY * SCALE_MULTIPLIER,
        }
    }
  }

  private applyMotionEndpoint(
    record: MotionRecord,
    action: NodeMotionAction,
    state: 'visible' | 'hidden',
  ): void {
    const endpoint = this.motionEndpoint(record, action, state)
    const target = this.motionTarget(record)
    target
      .setPosition(endpoint.x ?? target.x, endpoint.y ?? target.y)
      .setAlpha(endpoint.alpha ?? target.alpha)
      .setScale(
        endpoint.scaleX ?? target.scaleX,
        endpoint.scaleY ?? target.scaleY,
      )
  }

  private applyStableFrame(record: MotionRecord): void {
    const target = this.motionTarget(record)
    if (!target.active) return
    target
      .setPosition(record.frame.x, record.frame.y)
      .setAlpha(record.frame.alpha)
      .setScale(record.frame.scaleX, record.frame.scaleY)
  }

  private setRuntimeVisible(record: MotionRecord, visible: boolean): void {
    record.runtimeVisible = visible
    this.setVisualVisibility(record, visible)
    this.setInputTreeEnabled(
      record.handle.root,
      visible && !record.active && record.handle.root.visible !== false,
    )
  }

  private setVisualVisibility(record: MotionRecord, visible: boolean): void {
    const target = this.motionTarget(record)
    if (!record.handle.root.active || !target.active) return
    if (record.handle.setMotionVisible) {
      record.handle.setMotionVisible(visible)
    } else {
      target.setVisible(visible)
    }
  }

  private setInputTreeEnabled(object: Phaser.GameObjects.GameObject, enabled: boolean): void {
    if (object.input) {
      if (!enabled) {
        if (!this.disabledInputStates.has(object)) {
          this.disabledInputStates.set(object, object.input.enabled)
        }
        object.input.enabled = false
      } else {
        const previous = this.disabledInputStates.get(object)
        if (previous !== undefined) object.input.enabled = previous
        this.disabledInputStates.delete(object)
      }
    }
    const children = (object as Phaser.GameObjects.GameObject & {
      list?: Phaser.GameObjects.GameObject[]
    }).list
    children?.forEach((child) => this.setInputTreeEnabled(child, enabled))
  }

  private cancelActive(record: MotionRecord, preserveFrame = true): void {
    const active = record.active
    if (!active) {
      if (!preserveFrame) record.interruptedFrame = false
      return
    }
    delete record.active
    this.scene.tweens.killTweensOf(this.motionTarget(record))
    record.interruptedFrame = preserveFrame
    active.settle(false)
  }

  private queueActivation(nodeId: string, sceneId?: string): void {
    if (this.mode === 'capture') return
    this.pendingActivations.set(nodeId, {
      nodeId,
      ...(sceneId ? { sceneId } : {}),
    })
  }

  private motionTarget(record: MotionRecord): Phaser.GameObjects.Container {
    return record.handle.motionRoot ?? record.handle.root
  }
}
