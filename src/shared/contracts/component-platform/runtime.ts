import type { AffineTransform, ComponentFrame } from './frame'
import type { ComponentInstance, ComponentTarget, JsonValue } from './project'
import type { TeacherControllerPort } from './teacherController'
import type { ComponentMotionPort } from './motion'
import type { InteractionAction, InteractionTrigger } from '../../interactionTypes'

export type ComponentMediaChannel = 'music' | 'narration' | 'sfx' | 'ui' | 'video'
export interface ComponentMediaState { paused: boolean; currentTime: number; loop: boolean }
export type ComponentMediaCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'seek'; seconds: number }
  | { type: 'loop'; value: boolean } | { type: 'mix'; volume: number; muted: boolean }
export interface ComponentMediaRegistrationOptions {
  kind: 'audio' | 'video'
  channel: ComponentMediaChannel
  volume: number
  muted: boolean
  initial: ComponentMediaState
}
export interface ComponentMediaRegistration {
  update(options: Partial<Pick<ComponentMediaRegistrationOptions, 'channel' | 'volume' | 'muted'>>): void
  report(state: ComponentMediaState, event?: 'play' | 'pause' | 'ended'): void
  dispose(): void
}
/** The callback executes in its caller's realm; transport carries commands and acknowledgements only. */
export interface ComponentMediaPort {
  register(options: ComponentMediaRegistrationOptions, command: (command: ComponentMediaCommand) => boolean | Promise<boolean>): ComponentMediaRegistration
  interruptBackground(mode: 'none' | 'duck' | 'pause' | 'stop'): { release(): void }
}
export interface ComponentInteractionPort {
  currentSurfaceId(): string | null
  currentStateId(): string | null
  courseState: { get(key: string): unknown; set(key: string, value: unknown): void }
  subscribeTrigger(trigger: InteractionTrigger, listener: (payload?: unknown) => void): () => void
  executeAction(action: InteractionAction, context: { signal: AbortSignal; ruleId: string; stepId: string; restartFromBeginning: boolean }): boolean | void | PromiseLike<boolean | void>
  report(message: string): void
}
export interface ComponentPresentationPort {
  feedback(text?: string): { setText(text: string): Promise<boolean>; dispose(): void }
  visibility(visible?: boolean): { setVisible(visible: boolean): Promise<boolean>; dispose(): void }
}

/** Every mounted implementation receives a fresh scope; state never writes author data. */
export interface ComponentRuntimeScope {
  readonly runScopeId: string
  readonly instanceId: string
  readonly generation: number
  readonly signal: AbortSignal
  isActive(): boolean
  cleanup(dispose: () => void): void
  target(reference: ComponentTarget): ComponentRuntimeTarget | null
  events: {
    emit(name: string, value: JsonValue): void
    subscribe(name: string, listener: (value: JsonValue) => void): () => void
  }
  state: {
    get(name: string): JsonValue | undefined
    set(name: string, value: JsonValue): void
    subscribe(name: string, listener: (value: JsonValue | undefined) => void): () => void
  }
}

export interface ComponentRuntimeTarget {
  readonly instanceId: string
  /** Headless targets and behavior instances need no DOM root. */
  readonly element?: HTMLElement
  readonly motion?: ComponentMotionPort
  readonly presentation?: ComponentPresentationPort
  read(): JsonValue
  emit(name: string, value: JsonValue): void
}

/** Identity is local to one component/HTML document; scopes contain real state or data-item keys. */
export type ComponentAuthorScope = Record<string, string>
export interface ComponentAuthorBindingStep { tag: string; index: number; attributes?: Record<string, string> }
export interface ComponentAuthorBinding {
  kind: 'dom'
  path: ComponentAuthorBindingStep[]
  textIndex?: number
  baseline: string
  context?: { path: ComponentAuthorBindingStep[]; value: string }[]
}
/** Author increments compose with the program's own transform; width/height resize its content box. */
export interface ComponentAuthorGeometry {
  translateX?: number; translateY?: number; scaleX?: number; scaleY?: number
  width?: number; height?: number; rotation?: number
}
export interface ComponentAuthorRecord {
  kind: 'text' | 'image'
  scope?: ComponentAuthorScope
  binding: ComponentAuthorBinding
  overrides: { text?: string; src?: string; style?: Record<string, string>; geometry?: ComponentAuthorGeometry }
}
/** Observed border box in its actual DOM parent; the parent map excludes the object itself. */
export interface ComponentAuthorGeometryObservation {
  frame: ComponentFrame
  parentToInstance: AffineTransform
  author: ComponentAuthorGeometry
  /** Insets to subtract when a border-box gesture writes CSS content-box width/height. */
  boxInsets: { width: number; height: number }
}

/** Ephemeral observations carry the persistent record needed to commit a first local edit. */
export interface ComponentAuthorSpotInput {
  kind: 'text' | 'image'
  authorKey?: string
  scope?: ComponentAuthorScope
  binding?: ComponentAuthorBinding
  bindingStatus?: 'bound' | 'unmounted' | 'unresolved' | 'source-required'
  geometry?: ComponentAuthorGeometryObservation
  dataPath?: string[]
  sourceRegion?: { kind: 'implementation' | 'data'; path?: string[]; start: number; end: number;
    encoding?: 'html-text' | 'html-attribute' }
  initialValue: JsonValue
  localBounds: ComponentFrame
}
export interface ComponentAuthorSpot extends ComponentAuthorSpotInput {
  id: string
  instanceId: string
  mountGeneration: number
}

/** Host-derived layout, not author metadata. Only Flow owns the natural height of a reading block. */
export type ComponentLayoutInput =
  | { mode: 'free-frame' | 'flow-viewport'; inlineSize: number; blockSize: number }
  | { mode: 'flow-content'; inlineSize: number }

export interface ComponentLayoutSizeReport {
  /** The host input width used for this measurement, never the content's scrollWidth. */
  inlineSize: number
  blockSize: number
}

/** Bound to one instance/mount generation; retired ports cannot report into a replacement generation. */
export interface ComponentLayoutPort {
  read(): ComponentLayoutInput
  subscribe(listener: (layout: ComponentLayoutInput) => void): () => void
  /** A display observation only. The Surface accepts it for the current width and never writes History. */
  reportSize(report: ComponentLayoutSizeReport): void
}

export interface ComponentRuntimeContext<Data = JsonValue> {
  readonly instance: ComponentInstance<Data>
  readonly scope: ComponentRuntimeScope
  readonly root?: HTMLElement
  readonly teacherController?: TeacherControllerPort
  /** Read-only URLs for assets already owned by this document; no file-system access. */
  readonly resources?: { url(assetId: string): string | undefined }
  readonly media?: ComponentMediaPort
  readonly interactions?: ComponentInteractionPort
  readonly authoring?: { register(spot: ComponentAuthorSpotInput): () => void }
  readonly layout?: ComponentLayoutPort
}

export interface MountedComponent<Data = JsonValue> {
  update(instance: ComponentInstance<Data>): void | Promise<void>
  updatePlacement?(frame: ComponentFrame | undefined): void
  dispose(): void | Promise<void>
}

export interface ComponentRuntimeImplementation<Data = JsonValue> {
  mount(context: ComponentRuntimeContext<Data>): MountedComponent<Data> | Promise<MountedComponent<Data>>
}
