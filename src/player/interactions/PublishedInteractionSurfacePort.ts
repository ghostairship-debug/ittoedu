import type {
  AudioInteractionAction,
  NodeMotionAction,
  VideoInteractionAction,
  InteractionTrigger,
} from '../../shared/contracts/interaction-v1/types'
import type { SurfaceDiagnostic } from '../surfaces/SurfaceHost'
import type { CourseStateStore } from '../../shared/runtimeTypes'

/** A port operation may complete synchronously or after host-owned work. */
export type PublishedInteractionPortResult =
  | boolean
  | void
  | PromiseLike<boolean | void>

export interface PublishedNodeMotionContext {
  readonly ruleId: string
  readonly stepId: string
  readonly signal: AbortSignal
  /** The same rule was triggered again before its previous run settled. */
  readonly restartFromBeginning: boolean
}

/**
 * The active Surface owns hit testing, gesture priority, authored visibility,
 * camera/location visibility and the concrete motion implementation. The
 * controller never queries or mutates arbitrary DOM nodes.
 */
export type PublishedVideoEventKind = 'started' | 'paused' | 'ended' | 'time'

export interface PublishedVideoActionContext {
  readonly ruleId: string
  readonly stepId: string
  readonly signal: AbortSignal
}

/**
 * Scene-local video extension. Only the Slide Published host implements it;
 * Flow/Spatial ports omit these members and video rules stay unsupported there.
 */
export interface PublishedInteractionVideoPort {
  executeVideoAction(
    action: VideoInteractionAction,
    context: PublishedVideoActionContext,
  ): PublishedInteractionPortResult
  bindVideoEvent(
    nodeId: string,
    kind: PublishedVideoEventKind,
    listener: (seconds?: number) => void,
  ): (() => void) | null
}

export interface PublishedInputDescriptor {
  answerType: 'text' | 'number'
  stateKey: string
  validityKey: string
  defaultValue: string | number
}

export interface PublishedInteractionSurfacePort {
  bindNodeClick(nodeId: string, listener: () => void): (() => void) | null
  executeNodeMotion(
    action: NodeMotionAction,
    context: PublishedNodeMotionContext,
  ): PublishedInteractionPortResult
  executeVideoAction?(
    action: VideoInteractionAction,
    context: PublishedVideoActionContext,
  ): PublishedInteractionPortResult
  bindVideoEvent?(
    nodeId: string,
    kind: PublishedVideoEventKind,
    listener: (seconds?: number) => void,
  ): (() => void) | null
  describeInput?(nodeId: string): PublishedInputDescriptor | null
  bindInputSubmit?(
    nodeId: string,
    listener: (rawValue: string) => void,
  ): (() => void) | null
}

/** Published navigation boundary supplied by the whole-course session. */
export interface PublishedInteractionSessionPort {
  readonly interactionRuns?: PublishedInteractionRuns
  readonly courseState: Pick<CourseStateStore, 'get' | 'set'>
  setCourseStateBatch?(entries: readonly { key: string; value: unknown }[]): void
  currentSceneId(): string | null
  executeAudioAction?(
    action: AudioInteractionAction,
    signal: AbortSignal,
  ): PublishedInteractionPortResult
  bindAudioEnded?(
    soundId: string,
    listener: () => void,
  ): (() => void) | null
  goToLocation?(locationId: string, signal: AbortSignal): PublishedInteractionPortResult
  goToScene(
    sceneId: string,
    targetStateId: string | undefined,
    signal: AbortSignal,
  ): PublishedInteractionPortResult
  nextScene(signal: AbortSignal): PublishedInteractionPortResult
  nextStep?(signal: AbortSignal): PublishedInteractionPortResult
  previousStep?(signal: AbortSignal): PublishedInteractionPortResult
  previousScene(signal: AbortSignal): PublishedInteractionPortResult
  replayScene(signal: AbortSignal): PublishedInteractionPortResult
  restartCourse(signal: AbortSignal): PublishedInteractionPortResult
}

export type PublishedInteractionRunStatus = 'running' | 'completed' | 'navigation-terminal' | 'cancelled' | 'failed' | 'skipped'
export interface PublishedInteractionRunLocation { locationId: string | null; stateId: string | null }
export interface PublishedInteractionRun {
  runId: number
  chainId: number
  parentRunId?: number
  ruleId: string
  surfaceId: string
  trigger: InteractionTrigger
  status: PublishedInteractionRunStatus
  start: PublishedInteractionRunLocation
  end: PublishedInteractionRunLocation
  reason?: string
  navigation?: { transitionId: number; fromLocationId: string; locationId: string; stateId?: string; started: boolean; settled: boolean; matched?: boolean }
}

/** Ephemeral session evidence. Survives controller teardown, never enters the payload. */
export class PublishedInteractionRuns {
  #nextId = 0
  #transitionId = 0
  readonly #runs = new Map<number, PublishedInteractionRun>()
  readonly #signals = new WeakMap<AbortSignal, number>()
  readonly #observations = new Set<{ ruleId: string; surfaceId: string; runIds: number[] }>()
  constructor(private readonly location: () => PublishedInteractionRunLocation = () => ({ locationId: null, stateId: null })) {}

  start(input: Pick<PublishedInteractionRun, 'ruleId' | 'surfaceId' | 'trigger'>, signal: AbortSignal, parentRunId?: number): number {
    const runId = ++this.#nextId
    const parent = parentRunId === undefined ? undefined : this.#runs.get(parentRunId)
    const start = this.location()
    const run: PublishedInteractionRun = { ...input, runId, chainId: parent?.chainId ?? runId, status: 'running', start, end: { ...start }, ...(parent ? { parentRunId } : {}) }
    this.#runs.set(runId, run)
    this.#signals.set(signal, runId)
    for (const observation of this.#observations) {
      if ((input.ruleId === observation.ruleId && input.surfaceId === observation.surfaceId && input.trigger.type === 'node.click')
        || (parent && observation.runIds.includes(parent.runId))) observation.runIds.push(runId)
    }
    // Completed unobserved history is bounded; active/observed causal chains stay intact.
    if (this.#runs.size > 512) for (const [id, old] of this.#runs) {
      if (old.status !== 'running' && ![...this.#observations].some(value => value.runIds.includes(id))) { this.#runs.delete(id); break }
    }
    return runId
  }

  read(runId: number): PublishedInteractionRun | undefined {
    const run = this.#runs.get(runId)
    return run ? { ...run, start: { ...run.start }, end: { ...run.end }, trigger: { ...run.trigger }, ...(run.navigation ? { navigation: { ...run.navigation } } : {}) } : undefined
  }

  observe(ruleId: string, surfaceId: string) {
    const observation = { ruleId, surfaceId, runIds: [] as number[] }
    this.#observations.add(observation)
    return {
      read: (): PublishedInteractionRun[] => observation.runIds.flatMap(id => this.read(id) ?? []),
      close: () => { this.#observations.delete(observation) },
    }
  }

  finish(runId: number, status: Exclude<PublishedInteractionRunStatus, 'running'>, reason?: string): void {
    const run = this.#runs.get(runId)
    if (!run || run.status !== 'running') return
    // Only the matching navigation owner may finish an admitted transition.
    if (run.navigation?.started && status === 'cancelled' && !run.navigation.settled && reason !== 'retriggered') return
    run.status = run.navigation?.settled && status !== 'failed' && reason !== 'retriggered' && reason !== 'session-destroyed'
      ? (run.navigation.matched ? 'navigation-terminal' : 'failed') : status
    if (!run.navigation?.settled) run.end = this.location()
    if (reason) run.reason = reason
  }

  prepareNavigation(signal: AbortSignal, fromLocationId: string, locationId: string, stateId?: string): number | undefined {
    const id = this.#signals.get(signal), run = id === undefined ? undefined : this.#runs.get(id)
    if (!run || run.status !== 'running') return undefined
    run.navigation = { transitionId: ++this.#transitionId, fromLocationId, locationId, ...(stateId === undefined ? {} : { stateId }), started: false, settled: false }
    return id
  }

  beginNavigation(runId: number | undefined, from: string | undefined, to: string): void {
    const run = runId === undefined ? undefined : this.#runs.get(runId)
    if (run?.status === 'running' && run.navigation && run.navigation.fromLocationId === from && run.navigation.locationId === to) run.navigation.started = true
  }

  settleNavigation(runId: number | undefined, locationId: string, stateId: string | null): boolean {
    const run = runId === undefined ? undefined : this.#runs.get(runId), navigation = run?.navigation
    if (!run || run.status !== 'running' || !navigation?.started) return false
    navigation.settled = true
    run.end = { locationId, stateId }
    const matched = navigation.locationId === locationId && (navigation.stateId === undefined || navigation.stateId === stateId)
    navigation.matched = matched
    if (!matched) run.reason = 'navigation-destination-mismatch'
    return matched
  }

  cancelAll(reason: string): void {
    for (const run of this.#runs.values()) if (run.status === 'running') { run.status = 'cancelled'; run.reason = reason; run.end = this.location() }
  }
}

export type PublishedInteractionDiagnosticCode =
  | 'unsupported-trigger'
  | 'unsupported-condition'
  | 'unsupported-action'
  | 'bind-unavailable'
  | 'bind-failed'
  | 'session-failed'
  | 'motion-failed'
  | 'navigation-failed'
  | 'course-state-failed'
  | 'audio-failed'
  | 'video-failed'
  | 'execution-failed'
  | 'dispose-failed'

export interface PublishedInteractionDiagnostic extends SurfaceDiagnostic {
  code: PublishedInteractionDiagnosticCode
  ruleId?: string
  stepId?: string
  nodeId?: string
  interactionType?: string
}
