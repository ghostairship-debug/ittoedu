import type { NodeMotionAction } from '../../shared/contracts/interaction-v1/types'
import type {
  PublishedInteractionSurfacePort,
  PublishedNodeMotionContext,
} from './PublishedInteractionSurfacePort'

const MAX_MOTION_DURATION_MS = 10_000
const SLIDE_DISTANCE_PX = 48
const SCALE_MULTIPLIER = 0.84

export type PublishedInteractionNodeSource = 'scene' | 'surface' | 'global'

export type PublishedInteractionNodeOwnership =
  | 'native'
  | 'component'
  | 'runtime'
  | 'media'
  | 'teacher-controller'

export interface PublishedInteractionMotionStyle {
  /** The exact authored/computed endpoint, not an effect-relative alpha. */
  readonly opacity: string
  /** Include authored rotation/scale so the port can preserve the endpoint. */
  readonly transform: string
}

export interface PublishedInteractionNodeState {
  readonly visible: boolean
  /** True while at least one controller binding owns this native click target. */
  readonly clickBound: boolean
}

/**
 * A renderer-owned node boundary. The callbacks deliberately avoid querying
 * arbitrary DOM by id: each host decides which wrapper owns interaction,
 * visibility and the authored motion endpoint.
 */
export interface PublishedInteractionNodeHandle {
  readonly nodeId: string
  readonly source: PublishedInteractionNodeSource
  readonly ownership: PublishedInteractionNodeOwnership
  /** Global handles may point at one session-shared state instance. */
  readonly visibilityState?: PublishedInteractionVisibilityState
  /** Resolve on demand so bindings survive host rerenders. */
  resolveElement(): HTMLElement | SVGElement | null
  /** False when the node is outside the current renderer/location boundary. */
  isInteractionAvailable(): boolean
  /** False when component/runtime/media/controller owns the click gesture. */
  canBindClick(): boolean
  /** Kept separate from click ownership so an occupied wrapper may still move. */
  canRunMotion(): boolean
  /** The visibility restored when the local/session state is reset. */
  authoredVisible(): boolean
  /** Host keeps authored pointer behavior unless clickBound grants native hit ownership. */
  applyInteractionState(state: PublishedInteractionNodeState): void
  /** Optional stable endpoint; otherwise the port reads the current DOM style. */
  authoredMotionStyle?(): PublishedInteractionMotionStyle
}

type VisibilityListener = (nodeId: string) => void

/**
 * Session-only visibility overrides. Sharing one instance between the global
 * handles of multiple surfaces keeps global reveal state coherent; a port's
 * default instance remains local and can be reset independently.
 */
export class PublishedInteractionVisibilityState {
  readonly #overrides = new Map<string, boolean>()
  readonly #listeners = new Set<VisibilityListener>()

  resolve(nodeId: string, authoredVisible: boolean): boolean {
    return this.#overrides.get(nodeId) ?? authoredVisible
  }

  set(nodeId: string, visible: boolean): void {
    if (this.#overrides.get(nodeId) === visible) return
    this.#overrides.set(nodeId, visible)
    this.#notify(nodeId)
  }

  reset(nodeIds?: Iterable<string>): void {
    if (nodeIds) {
      for (const nodeId of new Set(nodeIds)) {
        if (!this.#overrides.delete(nodeId)) continue
        this.#notify(nodeId)
      }
      return
    }
    const changed = [...this.#overrides.keys()]
    this.#overrides.clear()
    for (const nodeId of changed) this.#notify(nodeId)
  }

  subscribe(listener: VisibilityListener): () => void {
    this.#listeners.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.#listeners.delete(listener)
    }
  }

  #notify(nodeId: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(nodeId)
      } catch {
        // State propagation is observational; one stale host must not break peers.
      }
    }
  }
}

export interface PublishedDomInteractionSurfacePortOptions {
  active?: boolean
  localVisibilityState?: PublishedInteractionVisibilityState
  prefersReducedMotion?: () => boolean
}

interface ClickRegistration {
  readonly listener: () => void
}

interface ActiveMotion {
  readonly token: symbol
  readonly controller: AbortController
  readonly nodeId: string
  readonly handle: PublishedInteractionNodeHandle
  readonly state: PublishedInteractionVisibilityState
  readonly previousVisible: boolean
  readonly generation: number
}

function finiteDuration(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_MOTION_DURATION_MS, value))
}

function normalizeTransform(transform: string): string {
  const trimmed = transform.trim()
  return trimmed && trimmed !== 'none' ? trimmed : 'none'
}

function composedTransform(effectTransform: string, authoredTransform: string): string {
  const authored = normalizeTransform(authoredTransform)
  return authored === 'none' ? effectTransform : `${effectTransform} ${authored}`
}

function effectTransform(action: NodeMotionAction, authoredTransform: string): string {
  if (action.effect === 'scale') {
    return composedTransform(`scale(${SCALE_MULTIPLIER})`, authoredTransform)
  }
  if (action.effect !== 'slide') return normalizeTransform(authoredTransform)
  const [x, y] = (() => {
    switch (action.direction) {
      case 'right': return [SLIDE_DISTANCE_PX, 0]
      case 'up': return [0, -SLIDE_DISTANCE_PX]
      case 'down': return [0, SLIDE_DISTANCE_PX]
      case 'left':
      default: return [-SLIDE_DISTANCE_PX, 0]
    }
  })()
  return composedTransform(`translate3d(${x}px, ${y}px, 0)`, authoredTransform)
}

function motionFrames(
  action: NodeMotionAction,
  authored: PublishedInteractionMotionStyle,
): [Keyframe, Keyframe] {
  const endpoint: Keyframe = {
    opacity: authored.opacity,
    transform: normalizeTransform(authored.transform),
  }
  const effect: Keyframe = {
    opacity: action.effect === 'fade' ? '0' : authored.opacity,
    transform: effectTransform(action, authored.transform),
  }
  return action.type === 'node.enter' ? [effect, endpoint] : [endpoint, effect]
}

function elementStyle(element: HTMLElement | SVGElement): CSSStyleDeclaration {
  return element.style
}

/**
 * Reusable DOM implementation of the Published controller's surface port.
 * One stable bubble listener delegates into renderer-supplied node handles;
 * no listener prevents default browser behavior or changes propagation.
 */
export class PublishedDomInteractionSurfacePort implements PublishedInteractionSurfacePort {
  readonly localVisibilityState: PublishedInteractionVisibilityState
  readonly #root: HTMLElement
  readonly #prefersReducedMotion?: () => boolean
  readonly #handles = new Map<string, PublishedInteractionNodeHandle>()
  readonly #clicks = new Map<string, Set<ClickRegistration>>()
  readonly #activeMotions = new Map<string, ActiveMotion>()
  readonly #stateDisposers: Array<() => void> = []
  readonly #onRootClick = (event: Event): void => this.#delegateClick(event)
  #active: boolean
  #generation = 0
  #destroyed = false

  constructor(
    root: HTMLElement,
    options: PublishedDomInteractionSurfacePortOptions = {},
  ) {
    this.#root = root
    this.#active = options.active ?? false
    this.#prefersReducedMotion = options.prefersReducedMotion
    this.localVisibilityState = options.localVisibilityState
      ?? new PublishedInteractionVisibilityState()
    this.#root.addEventListener('click', this.#onRootClick)
  }

  get active(): boolean {
    return this.#active && !this.#destroyed
  }

  get generation(): number {
    return this.#generation
  }

  /**
   * Replace renderer handles after a rerender. Existing controller callbacks
   * remain registered, while stale element/motion ownership is cancelled.
   */
  refreshNodes(
    handles: Iterable<PublishedInteractionNodeHandle>,
    generation = this.#generation + 1,
  ): void {
    if (this.#destroyed) return
    this.#cancelMotions()
    this.#generation = generation
    this.#handles.clear()
    for (const handle of handles) {
      if (!handle.nodeId || this.#handles.has(handle.nodeId)) continue
      this.#handles.set(handle.nodeId, handle)
    }
    this.#refreshStateSubscriptions()
    this.#applyAllVisibility()
  }

  setActive(active: boolean): void {
    if (this.#destroyed || this.#active === active) return
    this.#cancelMotions()
    this.#active = active
    this.#generation += 1
    this.#applyAllVisibility()
  }

  /** Reset only handles using this port's default local state. */
  resetLocalVisibility(): void {
    if (this.#destroyed) return
    this.#cancelMotions((motion) => motion.state === this.localVisibilityState)
    this.localVisibilityState.reset()
    this.#applyAllVisibility()
  }

  bindNodeClick(nodeId: string, listener: () => void): (() => void) | null {
    if (!this.active) return null
    const handle = this.#handles.get(nodeId)
    if (!handle || !this.#availableElement(handle, 'click')) return null
    const registration: ClickRegistration = { listener }
    const registrations = this.#clicks.get(nodeId) ?? new Set<ClickRegistration>()
    registrations.add(registration)
    this.#clicks.set(nodeId, registrations)
    this.#applyInteractionState(handle)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.#clicks.get(nodeId)
      current?.delete(registration)
      if (current?.size === 0) this.#clicks.delete(nodeId)
      const currentHandle = this.#handles.get(nodeId)
      if (currentHandle) this.#applyInteractionState(currentHandle)
    }
  }

  executeNodeMotion(
    action: NodeMotionAction,
    context: PublishedNodeMotionContext,
  ): Promise<boolean> | boolean {
    if (!this.active || context.signal.aborted) return false
    const handle = this.#handles.get(action.nodeId)
    const element = handle ? this.#availableElement(handle, 'motion') : null
    if (!handle || !element) return false

    this.#cancelMotion(action.nodeId)
    const state = handle.visibilityState ?? this.localVisibilityState
    const previousVisible = state.resolve(action.nodeId, this.#authoredVisible(handle))
    const motion: ActiveMotion = {
      token: Symbol(`published-dom-motion:${action.nodeId}`),
      controller: new AbortController(),
      nodeId: action.nodeId,
      handle,
      state,
      previousVisible,
      generation: this.#generation,
    }
    this.#activeMotions.set(action.nodeId, motion)
    return this.#runMotion(action, context, motion, element)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#active = false
    this.#cancelMotions()
    this.#root.removeEventListener('click', this.#onRootClick)
    for (const dispose of this.#stateDisposers.splice(0)) dispose()
    this.#clicks.clear()
    this.#handles.clear()
  }

  async #runMotion(
    action: NodeMotionAction,
    context: PublishedNodeMotionContext,
    motion: ActiveMotion,
    initialElement: HTMLElement | SVGElement,
  ): Promise<boolean> {
    const abortFromContext = (): void => motion.controller.abort()
    context.signal.addEventListener('abort', abortFromContext, { once: true })
    if (context.signal.aborted) abortFromContext()
    let succeeded = false

    try {
      if (motion.controller.signal.aborted) return false
      if (action.type === 'node.enter') {
        if (!this.#applyInteractionState(motion.handle, true)) return false
      }
      const element = this.#availableElement(motion.handle, 'motion') ?? initialElement
      const authored = this.#readMotionStyle(motion.handle, element)
      const duration = this.#reducedMotion() ? 0 : finiteDuration(action.durationMs)
      const frames = motionFrames(action, authored)
      const completed = duration === 0 || action.effect === 'none'
        ? !motion.controller.signal.aborted
        : await this.#animate(element, frames, duration, action.easing, motion.controller.signal)

      if (!completed || !this.#ownsMotion(motion)) return false
      motion.state.set(action.nodeId, action.type === 'node.enter')
      if (!this.#applyInteractionState(motion.handle)) return false
      succeeded = true
      return true
    } finally {
      context.signal.removeEventListener('abort', abortFromContext)
      if (this.#isCurrentMotion(motion)) {
        if (motion.controller.signal.aborted || !succeeded) {
          motion.state.set(motion.nodeId, motion.previousVisible)
          this.#applyInteractionState(motion.handle)
        }
        this.#activeMotions.delete(motion.nodeId)
      }
    }
  }

  #delegateClick(event: Event): void {
    if (!this.active) return
    const ElementConstructor = this.#root.ownerDocument.defaultView?.Element
    let candidate = ElementConstructor && event.target instanceof ElementConstructor
      ? event.target as Element
      : null
    while (candidate && this.#root.contains(candidate)) {
      const matched = this.#handleForElement(candidate)
      if (matched) {
        if (!this.#isAvailable(matched) || !this.#canBindClick(matched)) return
        const state = matched.visibilityState ?? this.localVisibilityState
        if (!state.resolve(matched.nodeId, this.#authoredVisible(matched))) return
        const registrations = this.#clicks.get(matched.nodeId)
        if (!registrations?.size) return
        for (const registration of [...registrations]) {
          try {
            registration.listener()
          } catch {
            // A controller callback is isolated from browser event dispatch.
          }
        }
        return
      }
      if (candidate === this.#root) return
      candidate = candidate.parentElement
    }
  }

  #handleForElement(element: Element): PublishedInteractionNodeHandle | null {
    for (const handle of this.#handles.values()) {
      try {
        if (handle.resolveElement() === element) return handle
      } catch {
        // A stale renderer handle is treated as absent.
      }
    }
    return null
  }

  #availableElement(
    handle: PublishedInteractionNodeHandle,
    purpose: 'click' | 'motion',
  ): HTMLElement | SVGElement | null {
    if (!this.#isAvailable(handle)) return null
    if (purpose === 'click' && !this.#canBindClick(handle)) return null
    if (purpose === 'motion' && !this.#canRunMotion(handle)) return null
    try {
      const element = handle.resolveElement()
      if (!element || !this.#root.contains(element)) return null
      return element
    } catch {
      return null
    }
  }

  #isAvailable(handle: PublishedInteractionNodeHandle): boolean {
    try {
      return handle.isInteractionAvailable()
    } catch {
      return false
    }
  }

  #canBindClick(handle: PublishedInteractionNodeHandle): boolean {
    try {
      return handle.canBindClick()
    } catch {
      return false
    }
  }

  #canRunMotion(handle: PublishedInteractionNodeHandle): boolean {
    try {
      return handle.canRunMotion()
    } catch {
      return false
    }
  }

  #authoredVisible(handle: PublishedInteractionNodeHandle): boolean {
    try {
      return handle.authoredVisible()
    } catch {
      return false
    }
  }

  #readMotionStyle(
    handle: PublishedInteractionNodeHandle,
    element: HTMLElement | SVGElement,
  ): PublishedInteractionMotionStyle {
    try {
      const authored = handle.authoredMotionStyle?.()
      if (authored) {
        return {
          opacity: authored.opacity || '1',
          transform: normalizeTransform(authored.transform),
        }
      }
    } catch {
      // Fall through to the current rendered endpoint.
    }
    const inline = elementStyle(element)
    const view = element.ownerDocument.defaultView
    const computed = view?.getComputedStyle(element)
    return {
      opacity: inline.opacity || computed?.opacity || '1',
      transform: normalizeTransform(inline.transform || computed?.transform || 'none'),
    }
  }

  #applyInteractionState(
    handle: PublishedInteractionNodeHandle,
    visibilityOverride?: boolean,
  ): boolean {
    const state = handle.visibilityState ?? this.localVisibilityState
    const visible = visibilityOverride
      ?? state.resolve(handle.nodeId, this.#authoredVisible(handle))
    const clickBound = this.active
      && visibilityOverride === undefined
      && visible
      && this.#isAvailable(handle)
      && this.#canBindClick(handle)
      && (this.#clicks.get(handle.nodeId)?.size ?? 0) > 0
    try {
      handle.applyInteractionState({ visible, clickBound })
      return true
    } catch {
      return false
    }
  }

  #applyVisibilityForState(
    state: PublishedInteractionVisibilityState,
    nodeId: string,
  ): void {
    const handle = this.#handles.get(nodeId)
    if (!handle) return
    if ((handle.visibilityState ?? this.localVisibilityState) !== state) return
    this.#applyInteractionState(handle)
  }

  #applyAllVisibility(): void {
    for (const handle of this.#handles.values()) this.#applyInteractionState(handle)
  }

  #refreshStateSubscriptions(): void {
    for (const dispose of this.#stateDisposers.splice(0)) dispose()
    const states = new Set<PublishedInteractionVisibilityState>([this.localVisibilityState])
    for (const handle of this.#handles.values()) {
      if (handle.visibilityState) states.add(handle.visibilityState)
    }
    for (const state of states) {
      this.#stateDisposers.push(state.subscribe((nodeId) => {
        this.#applyVisibilityForState(state, nodeId)
      }))
    }
  }

  #reducedMotion(): boolean {
    try {
      if (this.#prefersReducedMotion) return this.#prefersReducedMotion()
      return this.#root.ownerDocument.defaultView
        ?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    } catch {
      return false
    }
  }

  #animate(
    element: HTMLElement | SVGElement,
    frames: [Keyframe, Keyframe],
    duration: number,
    easing: NodeMotionAction['easing'],
    signal: AbortSignal,
  ): Promise<boolean> {
    if (typeof element.animate === 'function') {
      return this.#animateWithWebAnimations(element, frames, duration, easing, signal)
    }
    return this.#animateWithTimer(element, frames, duration, easing, signal)
  }

  #animateWithWebAnimations(
    element: HTMLElement | SVGElement,
    frames: [Keyframe, Keyframe],
    duration: number,
    easing: NodeMotionAction['easing'],
    signal: AbortSignal,
  ): Promise<boolean> {
    let animation: Animation
    try {
      animation = element.animate(frames, { duration, easing, fill: 'none' })
    } catch {
      return this.#animateWithTimer(element, frames, duration, easing, signal)
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = (completed: boolean): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        resolve(completed)
      }
      const abort = (): void => {
        try {
          animation.cancel()
        } catch {
          // Cancellation still settles the port even for a partial polyfill.
        }
        finish(false)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) {
        abort()
        return
      }
      void animation.finished.then(() => finish(true), () => finish(false))
    })
  }

  #animateWithTimer(
    element: HTMLElement | SVGElement,
    frames: [Keyframe, Keyframe],
    duration: number,
    easing: NodeMotionAction['easing'],
    signal: AbortSignal,
  ): Promise<boolean> {
    const style = elementStyle(element)
    const original = {
      opacity: style.opacity,
      transform: style.transform,
      transition: style.transition,
    }
    const restore = (): void => {
      style.opacity = original.opacity
      style.transform = original.transform
      style.transition = original.transition
    }
    style.transition = 'none'
    style.opacity = String(frames[0].opacity ?? original.opacity)
    style.transform = String(frames[0].transform ?? original.transform)
    // Force the start frame before applying the CSS transition endpoint.
    void element.getBoundingClientRect()
    style.transition = `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`
    style.opacity = String(frames[1].opacity ?? original.opacity)
    style.transform = String(frames[1].transform ?? original.transform)

    return new Promise((resolve) => {
      let settled = false
      const finish = (completed: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        restore()
        resolve(completed)
      }
      const abort = (): void => finish(false)
      const timer = setTimeout(() => finish(true), duration)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  #ownsMotion(motion: ActiveMotion): boolean {
    return !this.#destroyed
      && this.#active
      && !motion.controller.signal.aborted
      && this.#isCurrentMotion(motion)
  }

  #isCurrentMotion(motion: ActiveMotion): boolean {
    return !this.#destroyed
      && motion.generation === this.#generation
      && this.#activeMotions.get(motion.nodeId)?.token === motion.token
  }

  #cancelMotion(nodeId: string): void {
    const motion = this.#activeMotions.get(nodeId)
    if (!motion) return
    motion.controller.abort()
    motion.state.set(motion.nodeId, motion.previousVisible)
    this.#applyInteractionState(motion.handle)
    this.#activeMotions.delete(nodeId)
  }

  #cancelMotions(predicate: (motion: ActiveMotion) => boolean = () => true): void {
    for (const motion of [...this.#activeMotions.values()]) {
      if (predicate(motion)) this.#cancelMotion(motion.nodeId)
    }
  }
}
