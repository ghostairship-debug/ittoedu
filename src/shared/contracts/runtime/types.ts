import type * as Phaser from 'phaser'
import type {
  AssessmentEvaluationRequest,
  AssessmentEvaluationResult,
} from '../../assessmentEvaluators'

export type RuntimeApiVersion = 2
export const RUNTIME_RENDER_MODES = ['phaser', 'dom', 'hybrid'] as const
export const RUNTIME_SCOPES = ['scene', 'global'] as const
export const RUNTIME_EXECUTION_MODES = ['preview', 'capture'] as const
export type RuntimeRenderMode = typeof RUNTIME_RENDER_MODES[number]
export type RuntimeLayer = 'underlay' | 'overlay'
export type RuntimeScope = typeof RUNTIME_SCOPES[number]
export type RuntimeExecutionMode = typeof RUNTIME_EXECUTION_MODES[number]
export type RuntimeAuthoringApiVersion = 1

export interface EditableTextMetadata {
  label?: string
  description?: string
  multiline?: boolean
  maxLength?: number
}

export interface EditableTextContent {
  /** Every authored, visible string must be stored here. */
  values: Record<string, string>
  metadata?: Record<string, EditableTextMetadata>
}

export interface RuntimeAssetBinding {
  /** Stable AssetMeta.id from the project asset table. */
  assetId: string
}

export interface RuntimeStaticFallback {
  assetId: string
  coverage: 'runtime-layer' | 'full-scene'
  layer: RuntimeLayer
}

interface RuntimeDocumentBase {
  enabled: boolean
  renderMode: RuntimeRenderMode
  source: string
  content: EditableTextContent
  assets: Record<string, RuntimeAssetBinding>
  /** Semantic binding key -> scene/global node id. Copying a scene rewrites ids. */
  nodeBindings?: Record<string, string>
  staticFallback?: RuntimeStaticFallback
}

export interface RuntimeDocument extends RuntimeDocumentBase {
  runtimeApiVersion: 2
}

export type CourseStateData =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | CourseStateData[]
  | { [key: string]: CourseStateData }

export interface CourseStateStore {
  get<T = CourseStateData>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
  snapshot(): Record<string, unknown>
}

export type RuntimeEventDisposer = () => void
export type RuntimeEventListener<T = unknown> = (
  payload: T,
) => void | Promise<void>

export interface CourseEventBus {
  on<T = unknown>(
    eventName: string,
    listener: RuntimeEventListener<T>,
  ): RuntimeEventDisposer
  off<T = unknown>(eventName: string, listener: RuntimeEventListener<T>): void
  emit<T = unknown>(eventName: string, payload?: T): void
  listenerCount(eventName?: string): number
  dispose(): void
}

export interface RuntimeHostActions {
  goToScene(sceneId: string, targetStateId?: string): boolean
  nextScene(): boolean
  previousScene(): boolean
  replayScene(): boolean
  restartCourse(): boolean
}

export interface RuntimeNodeHandle {
  readonly id: string
  readonly type: string
  readonly root: Phaser.GameObjects.GameObject
}

export interface RuntimePresentationStateInfo {
  id: string
  name: string
  description?: string
}

export interface RuntimePresentationTransition {
  /** Duration in milliseconds. Omit or use zero for an immediate switch. */
  duration?: number
  /** Any Phaser tween easing name, for example `Sine.easeInOut`. */
  ease?: string
}

/** Controls declarative, author-editable states of the current scene. */
export interface RuntimePresentationApi {
  current(): string | null
  states(): ReadonlyArray<Readonly<RuntimePresentationStateInfo>>
  setState(stateId: string): boolean
  transitionTo(
    stateId: string,
    transition?: RuntimePresentationTransition,
  ): boolean
}

export interface RuntimePhaserRoots {
  scene: Phaser.Scene
  /** Default root alias. It points to the overlay root. */
  root: Phaser.GameObjects.Container
  underlay: Phaser.GameObjects.Container
  overlay: Phaser.GameObjects.Container
}

export interface RuntimeDomRoots {
  /** Default root alias. It points to the overlay root. */
  root: HTMLElement
  underlay: HTMLElement
  overlay: HTMLElement
}

export interface RuntimeNavigationRequest {
  fromSceneId?: string
  toSceneId: string
}

/** `false` blocks, a scene id redirects, and `true`/`void` allows. */
export type RuntimeNavigationGuardResult = boolean | string | void
export type RuntimeNavigationGuard = (
  request: Readonly<RuntimeNavigationRequest>,
) => RuntimeNavigationGuardResult

export interface RuntimeNavigationApi {
  guard(guard: RuntimeNavigationGuard): RuntimeEventDisposer
}

/** Deterministic, offline evaluators published in the Capability Index. */
export interface RuntimeAssessmentApi {
  evaluate(request: AssessmentEvaluationRequest): AssessmentEvaluationResult
}

export const RUNTIME_EVIDENCE_ACTION_KINDS = [
  'click',
  'select',
  'text-input',
  'formula-input',
  'drag',
  'sort',
  'circle-text',
  'highlight',
  'parameter-change',
  'oral',
  'paper',
  'teacher-command',
] as const

export type RuntimeEvidenceActionKind =
  typeof RUNTIME_EVIDENCE_ACTION_KINDS[number]

export interface RuntimeActionEvidenceRequest {
  actId: `ACT-${number}`
  actionKind: RuntimeEvidenceActionKind
  responseId?: `RESP-${number}`
  /** The native browser event that directly caused this approved action. */
  event: Event
}

/** Records approved actions only when directly caused by a trusted browser event. */
export interface RuntimeEvidenceApi {
  recordAction(request: RuntimeActionEvidenceRequest): void
}

export interface RuntimeContentReader {
  get(key: string): string
  all(): Readonly<Record<string, string>>
}

export interface RuntimeAssetResolver {
  url(bindingKey: string): string
  projectUrl(assetId: string): string
}

export interface RuntimeNodeResolver {
  get(nodeId: string): RuntimeNodeHandle | null
}

export interface RuntimeCaptureContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface RuntimeAuthoringBounds {
  x: number
  y: number
  width: number
  height: number
}

interface RuntimeAuthoringTargetRegistrationBase {
  /** Stable key in RuntimeDocument.content.values or RuntimeDocument.assets. */
  key: string
  /** Optional author-facing label shown by the canvas editor. */
  label?: string
  /** Used only to preserve coarse underlay/overlay hit-test order. */
  layer?: RuntimeLayer
  /**
   * Bounds in the runtime's current logical coordinate system. The host
   * normalizes snapshots to the canonical 1280 x 720 authoring canvas.
   */
  getBounds(): RuntimeAuthoringBounds
}

export interface RuntimeAuthoringTextTargetRegistration
  extends RuntimeAuthoringTargetRegistrationBase {
  kind: 'text'
  multiline?: boolean
  maxLength?: number
}

export interface RuntimeAuthoringAssetTargetRegistration
  extends RuntimeAuthoringTargetRegistrationBase {
  kind: 'asset'
}

export type RuntimeAuthoringTargetRegistration =
  | RuntimeAuthoringTextTargetRegistration
  | RuntimeAuthoringAssetTargetRegistration

/** Optional authoring bridge. It is absent from ordinary preview/capture hosts. */
export interface RuntimeAuthoringApi {
  register(target: RuntimeAuthoringTargetRegistration): RuntimeEventDisposer
  /** Re-measures registered and declarative DOM targets after layout changes. */
  invalidate(): void
}

export type RuntimeAuthoringTargetSource = 'registered' | 'dom'

/** A read-only, session-local target snapshot emitted by an authoring host. */
export interface RuntimeAuthoringTarget {
  /** Stable for the lifetime of the registered region or DOM element. */
  targetId: string
  /**
   * Stable Published layer-item owner. RuntimeHost-local registries omit it;
   * Published surface adapters add it before aggregating multiple carriers.
   */
  nodeId?: string
  scope: RuntimeScope
  sceneId?: string
  kind: 'text' | 'asset'
  key: string
  label?: string
  multiline?: boolean
  maxLength?: number
  layer: RuntimeLayer
  source: RuntimeAuthoringTargetSource
  /** Axis-aligned bounds normalized to the canonical 1280 x 720 canvas. */
  bounds: Readonly<RuntimeAuthoringBounds>
}

export interface RuntimeAuthoringTargetUpdate {
  /** Monotonically increases for each changed snapshot from one host. */
  revision: number
  /** Identifies the host even when cleanup publishes an empty target list. */
  scope: RuntimeScope
  sceneId?: string
  targets: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
}

export interface RuntimeCreateContextBase {
  scope: RuntimeScope
  mode: RuntimeExecutionMode
  sceneId?: string
  width: number
  height: number

  content: RuntimeContentReader
  assets: RuntimeAssetResolver
  presentation: RuntimePresentationApi
  actions: Readonly<RuntimeHostActions>
  events: CourseEventBus
  localState: CourseStateStore
  courseState: CourseStateStore
  capture: RuntimeCaptureContext
  navigation: RuntimeNavigationApi
  assessment: Readonly<RuntimeAssessmentApi>
  evidence: Readonly<RuntimeEvidenceApi>
  /** Present only when the definition and authoring host both opt into authoring V1. */
  authoring?: RuntimeAuthoringApi
  emit(eventName: string, payload?: unknown): void
}

interface RuntimeCreateContextWithRenderMode extends RuntimeCreateContextBase {
  runtimeApiVersion: 2
  renderMode: RuntimeRenderMode
}

export interface RuntimeCreateContextPhaser
  extends RuntimeCreateContextWithRenderMode {
  renderMode: 'phaser'
  Phaser: typeof Phaser
  phaser: RuntimePhaserRoots
  nodes: RuntimeNodeResolver
}

export interface RuntimeCreateContextDom extends RuntimeCreateContextWithRenderMode {
  renderMode: 'dom'
  domRoot: HTMLElement
  dom: RuntimeDomRoots
}

export interface RuntimeCreateContextHybrid
  extends RuntimeCreateContextWithRenderMode {
  renderMode: 'hybrid'
  Phaser: typeof Phaser
  phaser: RuntimePhaserRoots
  domRoot: HTMLElement
  dom: RuntimeDomRoots
  nodes: RuntimeNodeResolver
}

/** Runtime API 2 exposes only the surfaces declared by RuntimeDocument.renderMode. */
export type RuntimeCreateContext =
  | RuntimeCreateContextPhaser
  | RuntimeCreateContextDom
  | RuntimeCreateContextHybrid

export interface RuntimeInstanceLifecycle {
  resize?(width: number, height: number): void
  setVisible?(visible: boolean): void
  suspend?(): void
  resume?(): void
  prepareCapture?(): void | Promise<void>
  destroy(): void
}

export interface RuntimeDefinition {
  runtimeApiVersion: 2
  /** Optional canvas-authoring extension; versioned independently. */
  authoringApiVersion?: RuntimeAuthoringApiVersion
  create(context: RuntimeCreateContext): RuntimeInstanceLifecycle
}
