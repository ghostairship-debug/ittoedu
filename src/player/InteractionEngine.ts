import type {
  CourseEventBus,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../shared/runtimeTypes'
import {
  isAudioInteractionAction,
  isNodeMotionAction,
  isTerminalNavigationAction,
  isVideoInteractionAction,
  type AudioInteractionAction,
  type InteractionAction,
  type InteractionActionStep,
  type InteractionCondition,
  type InteractionRule,
  type InteractionTrigger,
  type NodeMotionAction,
  type VideoInteractionAction,
} from '../shared/interactionTypes'

const DEFAULT_MAX_CHAIN_DEPTH = 100

export interface InteractionBindableRoot {
  active?: boolean
  visible?: boolean
  input?: {
    enabled?: boolean
    cursor?: string
  } | null
  setInteractive?(config?: { cursor?: string }): unknown
  on(eventName: string, listener: (...args: unknown[]) => void): unknown
  off(eventName: string, listener: (...args: unknown[]) => void): unknown
}

export interface InteractionBindableNodeHandle {
  readonly id: string
  readonly root: InteractionBindableRoot
}

export interface InteractionEngineErrorContext {
  phase: 'bind' | 'execute' | 'chain-limit'
  rule?: InteractionRule
  action?: InteractionAction
  step?: InteractionActionStep
  nodeId?: string
}

export interface InteractionNodeMotionContext {
  readonly actionId: string
  readonly signal: AbortSignal
  /** The owning rule was retriggered before its previous run settled. */
  readonly restartFromBeginning: boolean
  readonly scope: 'scene' | 'global'
  readonly sceneId: string | null
}

export interface InteractionEngineOptions {
  scope?: 'scene' | 'global'
  sceneId: string
  /** Resolves the active scene for persistent global rules and scene.in conditions. */
  currentSceneId?(): string | null
  rules: readonly InteractionRule[]
  events: CourseEventBus
  presentation: RuntimePresentationApi
  hostActions: Readonly<RuntimeHostActions>
  executeAudioAction?(action: AudioInteractionAction): unknown
  executeVideoAction?(action: VideoInteractionAction): unknown
  executeNodeMotion?(
    action: NodeMotionAction,
    context: InteractionNodeMotionContext,
  ): boolean | PromiseLike<boolean>
  /** Maximum trigger events drained as one synchronous causal chain. */
  maxChainDepth?: number
  onError?(error: unknown, context: InteractionEngineErrorContext): void
}

interface QueuedTrigger {
  trigger: InteractionTrigger
  /** Presentation state captured when the trigger occurred. */
  stateId: string | null
  /** Scene captured when the trigger occurred. */
  sceneId: string | null
}

interface BoundNode {
  root: InteractionBindableRoot
  listener: (...args: unknown[]) => void
  previousCursor: string | undefined
}

interface ActiveRuleRun {
  readonly token: symbol
  readonly controller: AbortController
  readonly restarted: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function matchesTrigger(authored: InteractionTrigger, actual: InteractionTrigger): boolean {
  if (authored.type !== actual.type) return false
  switch (authored.type) {
    case 'scene.enter':
      return true
    case 'node.click':
      return actual.type === authored.type && authored.nodeId === actual.nodeId
    case 'node.activated':
      return actual.type === authored.type && authored.nodeId === actual.nodeId
    case 'animation.completed':
      return actual.type === authored.type && authored.actionId === actual.actionId
    case 'presentation.enter':
      return actual.type === authored.type && authored.stateId === actual.stateId
    case 'component.event':
      return actual.type === authored.type &&
        authored.nodeId === actual.nodeId &&
        authored.eventName === actual.eventName
    case 'runtime.event':
      return actual.type === authored.type &&
        authored.scope === actual.scope &&
        authored.eventName === actual.eventName
    case 'audio.ended':
      return actual.type === authored.type && authored.soundId === actual.soundId
    case 'video.started':
    case 'video.paused':
    case 'video.ended':
      return actual.type === authored.type && authored.nodeId === actual.nodeId
    case 'video.time':
      return actual.type === authored.type &&
        authored.nodeId === actual.nodeId &&
        authored.seconds === actual.seconds
    case 'presenter.command':
      return actual.type === authored.type && authored.command === actual.command
    case 'input.submit':
      return actual.type === authored.type && authored.nodeId === actual.nodeId
  }
}

function matchesCondition(
  condition: InteractionCondition,
  stateId: string | null,
  sceneId: string | null,
): boolean {
  switch (condition.type) {
    case 'presentation.in':
      return stateId !== null && condition.stateIds.includes(stateId)
    case 'scene.in':
      return sceneId !== null && condition.sceneIds.includes(sceneId)
    case 'course-state.exists':
    case 'course-state.compare':
      // Course Project V9 executes these through the Published V2 controller.
      return false
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function'
}

/**
 * Executes one scene's declarative interaction rules. It deliberately depends
 * on callbacks and the public event/action contracts instead of PlayerScene.
 */
export class InteractionEngine {
  private readonly sceneId: string
  private readonly scope: 'scene' | 'global'
  private readonly currentSceneId: () => string | null
  private readonly rules: readonly InteractionRule[]
  private readonly events: CourseEventBus
  private readonly presentation: RuntimePresentationApi
  private readonly hostActions: Readonly<RuntimeHostActions>
  private readonly executeAudioAction?: (action: AudioInteractionAction) => unknown
  private readonly executeVideoAction?: (action: VideoInteractionAction) => unknown
  private readonly executeNodeMotion?: (
    action: NodeMotionAction,
    context: InteractionNodeMotionContext,
  ) => boolean | PromiseLike<boolean>
  private readonly maxChainDepth: number
  private readonly onError: (
    error: unknown,
    context: InteractionEngineErrorContext,
  ) => void
  private readonly eventDisposers: Array<() => void> = []
  private readonly boundNodes = new Map<string, BoundNode>()
  private readonly triggerQueue: QueuedTrigger[] = []
  private readonly videoTimes = new Map<string, number>()
  private readonly activeRuleRuns = new Map<string, ActiveRuleRun>()
  private draining = false
  private destroyed = false
  private processedInCausalChain = 0
  private causalChainResetTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: InteractionEngineOptions) {
    this.sceneId = options.sceneId
    this.scope = options.scope ?? 'scene'
    this.currentSceneId = options.currentSceneId ?? (() => this.sceneId || null)
    this.rules = options.rules
    this.events = options.events
    this.presentation = options.presentation
    this.hostActions = options.hostActions
    this.executeAudioAction = options.executeAudioAction
    this.executeVideoAction = options.executeVideoAction
    this.executeNodeMotion = options.executeNodeMotion
    this.maxChainDepth = Math.max(
      1,
      Math.min(10_000, Math.floor(options.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH)),
    )
    this.onError = options.onError ?? ((error, context) => {
      console.error(`交互规则${context.phase === 'chain-limit' ? '触发链过长' : '执行失败'}`, error)
    })
    this.subscribeToCourseEvents()
  }

  /** Replace the current native-node bindings without touching other listeners. */
  bindNodeHandles(handles: Iterable<InteractionBindableNodeHandle>): void {
    this.unbindNodeHandles()
    if (this.destroyed) return
    const clickableNodeIds = new Set(
      this.rules
        .filter((rule) => rule.enabled && rule.trigger.type === 'node.click')
        .map((rule) => rule.trigger)
        .map((trigger) => trigger.type === 'node.click' ? trigger.nodeId : ''),
    )
    for (const handle of handles) {
      if (!clickableNodeIds.has(handle.id) || this.boundNodes.has(handle.id)) continue
      const { root } = handle
      const previousCursor = root.input?.cursor
      const listener = () => {
        if (
          this.destroyed ||
          root.active === false ||
          root.visible === false ||
          root.input?.enabled === false
        ) {
          return
        }
        this.dispatch({ type: 'node.click', nodeId: handle.id })
      }
      try {
        if (!root.input) root.setInteractive?.({ cursor: 'pointer' })
        if (root.input) root.input.cursor = 'pointer'
        root.on('pointerup', listener)
        this.boundNodes.set(handle.id, { root, listener, previousCursor })
      } catch (error) {
        this.onError(error, {
          phase: 'bind',
          nodeId: handle.id,
        })
      }
    }
  }

  /** Public for media hosts that prefer direct dispatch over CourseEventBus. */
  dispatch(
    trigger: InteractionTrigger,
    stateId = this.presentation.current(),
    sceneId = this.currentSceneId(),
  ): void {
    if (this.destroyed) return
    if (trigger.type === 'video.time') {
      this.dispatchVideoTime(trigger, stateId, sceneId)
      return
    }
    this.triggerQueue.push({ trigger, stateId, sceneId })
    this.drainTriggerQueue()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.triggerQueue.length = 0
    this.videoTimes.clear()
    for (const run of this.activeRuleRuns.values()) run.controller.abort()
    this.activeRuleRuns.clear()
    if (this.causalChainResetTimer !== null) {
      clearTimeout(this.causalChainResetTimer)
      this.causalChainResetTimer = null
    }
    this.unbindNodeHandles()
    for (const dispose of this.eventDisposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        this.onError(error, { phase: 'bind' })
      }
    }
  }

  private subscribeToCourseEvents(): void {
    this.eventDisposers.push(
      this.events.on<unknown>('scene:enter', (payload) => {
        if (!isRecord(payload)) return
        const sceneId = optionalString(payload, 'sceneId')
        if (!sceneId || (this.scope === 'scene' && sceneId !== this.sceneId)) return
        this.dispatch({ type: 'scene.enter' }, this.presentation.current(), sceneId)
      }),
      this.events.on<unknown>('presentation:change', (payload) => {
        if (!isRecord(payload)) return
        const sceneId = optionalString(payload, 'sceneId')
        if (!sceneId || (this.scope === 'scene' && sceneId !== this.sceneId)) return
        const stateId = optionalString(payload, 'stateId')
        if (!stateId) return
        this.dispatch({ type: 'presentation.enter', stateId }, stateId, sceneId)
      }),
      this.events.on<unknown>('node:activated', (payload) => {
        if (!this.automationEventBelongsToScope(payload)) return
        const nodeId = optionalString(payload, 'nodeId')
        if (!nodeId) return
        this.dispatch(
          { type: 'node.activated', nodeId },
          this.presentation.current(),
          optionalString(payload, 'sceneId') ?? this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('animation:completed', (payload) => {
        if (!this.automationEventBelongsToScope(payload)) return
        const actionId = optionalString(payload, 'actionId')
        if (!actionId) return
        this.dispatch(
          { type: 'animation.completed', actionId },
          this.presentation.current(),
          optionalString(payload, 'sceneId') ?? this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('component:event', (payload) => {
        if (!isRecord(payload)) return
        if (optionalString(payload, 'scope') !== this.scope) return
        const payloadSceneId = optionalString(payload, 'sceneId')
        if (
          this.scope === 'scene' &&
          payloadSceneId &&
          payloadSceneId !== this.sceneId
        ) return
        const nodeId = optionalString(payload, 'instanceId')
        const eventName = optionalString(payload, 'eventName')
        if (!nodeId || !eventName) return
        this.dispatch(
          { type: 'component.event', nodeId, eventName },
          this.presentation.current(),
          payloadSceneId ?? this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('runtime:event', (payload) => {
        if (!isRecord(payload)) return
        const scope = optionalString(payload, 'scope')
        const eventName = optionalString(payload, 'eventName')
        if ((scope !== 'scene' && scope !== 'global') || !eventName) return
        if (
          this.scope === 'scene' &&
          scope === 'scene' &&
          optionalString(payload, 'sceneId') !== this.sceneId
        ) {
          return
        }
        this.dispatch(
          { type: 'runtime.event', scope, eventName },
          this.presentation.current(),
          optionalString(payload, 'sceneId') ?? this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('presenter:command', (payload) => {
        if (!isRecord(payload)) return
        const command = optionalString(payload, 'command')
        if (command !== 'next' && command !== 'previous') return
        this.dispatch(
          { type: 'presenter.command', command },
          this.presentation.current(),
          this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('audio:ended', (payload) => {
        if (!this.mediaEventBelongsToScope(payload)) return
        const soundId = optionalString(payload, 'soundId')
        if (soundId) this.dispatch(
          { type: 'audio.ended', soundId },
          this.presentation.current(),
          optionalString(payload, 'sceneId') ?? this.currentSceneId(),
        )
      }),
      this.events.on<unknown>('video:started', (payload) => {
        this.dispatchVideoEvent('video.started', payload)
      }),
      this.events.on<unknown>('video:paused', (payload) => {
        this.dispatchVideoEvent('video.paused', payload)
      }),
      this.events.on<unknown>('video:ended', (payload) => {
        this.dispatchVideoEvent('video.ended', payload)
      }),
      this.events.on<unknown>('video:time', (payload) => {
        if (!this.mediaEventBelongsToScope(payload)) return
        const nodeId = optionalString(payload, 'nodeId')
        const seconds = optionalNumber(payload, 'seconds')
        if (nodeId && seconds !== undefined) {
          this.dispatch(
            { type: 'video.time', nodeId, seconds },
            this.presentation.current(),
            optionalString(payload, 'sceneId') ?? this.currentSceneId(),
          )
        }
      }),
    )
  }

  private automationEventBelongsToScope(
    payload: unknown,
  ): payload is Record<string, unknown> {
    if (!isRecord(payload) || optionalString(payload, 'scope') !== this.scope) {
      return false
    }
    if (this.scope === 'global') return true
    const payloadSceneId = optionalString(payload, 'sceneId')
    return !payloadSceneId || payloadSceneId === this.sceneId
  }

  private mediaEventBelongsToScope(payload: unknown): payload is Record<string, unknown> {
    if (!isRecord(payload)) return false
    if (this.scope === 'global') return true
    const payloadSceneId = optionalString(payload, 'sceneId')
    return !payloadSceneId || payloadSceneId === this.sceneId
  }

  private dispatchVideoEvent(
    type: 'video.started' | 'video.paused' | 'video.ended',
    payload: unknown,
  ): void {
    if (!this.mediaEventBelongsToScope(payload)) return
    const nodeId = optionalString(payload, 'nodeId')
    if (nodeId) this.dispatch(
      { type, nodeId },
      this.presentation.current(),
      optionalString(payload, 'sceneId') ?? this.currentSceneId(),
    )
  }

  /**
   * Browser timeupdate events are neither exact nor frame-aligned. Treat an
   * authored video.time value as a threshold, emit it once when playback or a
   * forward seek crosses that threshold, and arm it again after rewinding.
   */
  private dispatchVideoTime(
    trigger: Extract<InteractionTrigger, { type: 'video.time' }>,
    stateId: string | null,
    sceneId: string | null,
  ): void {
    const current = Math.max(0, trigger.seconds)
    const previous = this.videoTimes.get(trigger.nodeId)
    this.videoTimes.set(trigger.nodeId, current)

    // A backwards seek only rearms later thresholds. It must not immediately
    // fire every threshold that still lies before the new playhead position.
    if (previous !== undefined && current < previous) return

    const lowerBound = previous ?? Number.NEGATIVE_INFINITY
    const crossedThresholds = new Set<number>()
    for (const rule of this.rules) {
      if (!rule.enabled || rule.trigger.type !== 'video.time') continue
      if (rule.trigger.nodeId !== trigger.nodeId) continue
      const threshold = rule.trigger.seconds
      if (threshold > lowerBound && threshold <= current) {
        crossedThresholds.add(threshold)
      }
    }
    for (const threshold of [...crossedThresholds].sort((left, right) => left - right)) {
      this.triggerQueue.push({
        trigger: { type: 'video.time', nodeId: trigger.nodeId, seconds: threshold },
        stateId,
        sceneId,
      })
    }
    this.drainTriggerQueue()
  }

  private drainTriggerQueue(): void {
    if (this.draining || this.destroyed) return
    this.draining = true
    this.beginCausalChainWindow()
    try {
      while (!this.destroyed && this.triggerQueue.length > 0) {
        if (this.processedInCausalChain >= this.maxChainDepth) {
          this.triggerQueue.length = 0
          this.onError(
            new Error(`交互触发链超过 ${this.maxChainDepth} 层，已停止后续规则`),
            { phase: 'chain-limit' },
          )
          break
        }
        this.processedInCausalChain += 1
        const queued = this.triggerQueue.shift()!
        const matchingRules = this.rules.filter((rule) =>
          rule.enabled &&
          matchesTrigger(rule.trigger, queued.trigger) &&
          rule.conditions.every((condition) => matchesCondition(
            condition,
            queued.stateId,
            queued.sceneId,
          )),
        )
        for (const rule of matchingRules) {
          this.startRule(rule, queued)
          if (this.destroyed) break
        }
      }
    } finally {
      this.draining = false
    }
  }

  private beginCausalChainWindow(): void {
    if (this.causalChainResetTimer !== null) return
    this.causalChainResetTimer = setTimeout(() => {
      this.causalChainResetTimer = null
      this.processedInCausalChain = 0
    }, 0)
  }

  private startRule(rule: InteractionRule, queued: QueuedTrigger): void {
    const previous = this.activeRuleRuns.get(rule.id)
    previous?.controller.abort()
    const run: ActiveRuleRun = {
      token: Symbol(`interaction-rule:${rule.id}`),
      controller: new AbortController(),
      restarted: previous !== undefined,
    }
    this.activeRuleRuns.set(rule.id, run)
    void this.executeRule(rule, queued, run).finally(() => {
      if (this.activeRuleRuns.get(rule.id)?.token === run.token) {
        this.activeRuleRuns.delete(rule.id)
      }
    })
  }

  private async executeRule(
    rule: InteractionRule,
    queued: QueuedTrigger,
    run: ActiveRuleRun,
  ): Promise<void> {
    const groups: InteractionActionStep[][] = []
    for (const step of rule.actions) {
      if (groups.length === 0 || step.start === 'after-previous') {
        groups.push([step])
      } else {
        groups[groups.length - 1]!.push(step)
      }
    }

    for (const group of groups) {
      if (this.destroyed || run.controller.signal.aborted) return
      const outcomes = await Promise.all(group.map((step) =>
        this.executeStep(rule, step, queued, run),
      ))
      if (
        this.destroyed ||
        run.controller.signal.aborted ||
        outcomes.some((outcome) => outcome !== 'completed')
      ) {
        return
      }
    }
  }

  private async executeStep(
    rule: InteractionRule,
    step: InteractionActionStep,
    queued: QueuedTrigger,
    run: ActiveRuleRun,
  ): Promise<'completed' | 'cancelled' | 'terminal'> {
    const signal = run.controller.signal
    if (step.delayMs > 0 && !await this.waitForDelay(step.delayMs, signal)) {
      return 'cancelled'
    }
    if (this.destroyed || signal.aborted) return 'cancelled'
    // Global bindings survive ordinary navigation. A rule explicitly scoped by
    // scene.in must not let a delayed action leak into a later scene.
    if (!this.matchesCurrentGlobalScene(rule)) return 'cancelled'
    return this.executeAction(rule, step, queued, run)
  }

  private matchesCurrentGlobalScene(rule: InteractionRule): boolean {
    if (this.scope !== 'global') return true
    const sceneId = this.currentSceneId()
    return rule.conditions
      .filter((condition) => condition.type === 'scene.in')
      .every((condition) => matchesCondition(condition, null, sceneId))
  }

  private waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
    const bounded = Math.max(0, Math.min(60_000, delayMs))
    if (bounded === 0) return Promise.resolve(!signal.aborted)
    return new Promise((resolve) => {
      let settled = false
      const finish = (completed: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(completed)
      }
      const abort = (): void => finish(false)
      const timer = setTimeout(() => finish(true), bounded)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  private async executeAction(
    rule: InteractionRule,
    step: InteractionActionStep,
    queued: QueuedTrigger,
    run: ActiveRuleRun,
  ): Promise<'completed' | 'cancelled' | 'terminal'> {
    const signal = run.controller.signal
    const action = step.action
    try {
      let result: unknown
      switch (action.type) {
        case 'presentation.set':
          result = action.transition
            ? this.presentation.transitionTo(action.stateId, action.transition)
            : this.presentation.setState(action.stateId)
          break
        case 'scene.go':
          result = this.hostActions.goToScene(
            action.sceneId,
            action.targetStateId,
          )
          break
        case 'scene.next':
          result = this.hostActions.nextScene()
          break
        case 'scene.previous':
          result = this.hostActions.previousScene()
          break
        case 'scene.replay':
          result = this.hostActions.replayScene()
          break
        case 'course.restart':
          result = this.hostActions.restartCourse()
          break
        default:
          if (isAudioInteractionAction(action)) {
            if (!this.executeAudioAction) {
              throw new Error('播放器未提供音频动作执行器')
            }
            result = this.executeAudioAction(action)
          } else if (isVideoInteractionAction(action)) {
            if (!this.executeVideoAction) {
              throw new Error('播放器未提供视频动作执行器')
            }
            result = this.executeVideoAction(action)
          } else if (isNodeMotionAction(action)) {
            if (!this.executeNodeMotion) {
              throw new Error('播放器未提供元素动画动作执行器')
            }
            result = this.executeNodeMotion(action, {
              actionId: step.id,
              signal,
              restartFromBeginning: run.restarted,
              scope: this.scope,
              sceneId: queued.sceneId,
            })
          }
      }
      if (isPromiseLike(result)) {
        result = await Promise.resolve(result)
      }
      if (this.destroyed || signal.aborted) return 'cancelled'
      if (isNodeMotionAction(action)) {
        if (result === false) return 'cancelled'
        this.events.emit('animation:completed', {
          scope: this.scope,
          actionId: step.id,
          nodeId: action.nodeId,
          // Persistent global motion may finish after ordinary navigation.
          // Completion conditions belong to the scene active at completion;
          // scene-scoped engines are destroyed before that value can differ.
          sceneId: this.currentSceneId(),
        })
        if (this.destroyed || signal.aborted) return 'cancelled'
      }
      return isTerminalNavigationAction(action) ? 'terminal' : 'completed'
    } catch (error) {
      this.onError(error, { phase: 'execute', rule, step, action })
      return 'cancelled'
    }
  }

  private unbindNodeHandles(): void {
    for (const { root, listener, previousCursor } of this.boundNodes.values()) {
      try {
        root.off('pointerup', listener)
        if (root.input?.cursor === 'pointer') {
          root.input.cursor = previousCursor
        }
      } catch (error) {
        this.onError(error, { phase: 'bind' })
      }
    }
    this.boundNodes.clear()
  }
}
