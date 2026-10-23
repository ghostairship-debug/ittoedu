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
  subscribeTrigger(trigger: InteractionTrigger, listener: (payload?: unknown) => boolean | void | PromiseLike<boolean | void>): () => void
  executeAction(action: InteractionAction, context: { signal: AbortSignal; ruleId: string; stepId: string; restartFromBeginning: boolean; onNavigationCommit?: () => void }): boolean | void | PromiseLike<boolean | void>
  report(message: string): void
}
export interface ComponentPresentationPort {
  feedback(text?: string): { setText(text: string): Promise<boolean>; dispose(): void }
  visibility(visible?: boolean): { setVisible(visible: boolean): Promise<boolean>; dispose(): void }
}

/** One synchronous host observation. Frames map target border-box CSS pixels into the caller's viewport. */
export interface ComponentGeometrySnapshot {
  /** Host performance.timeOrigin + performance.now(), in milliseconds; all entries share this sample. */
  sampleTime: number
  targets: {
    reference: ComponentTarget
    /** Null means no connected, measurable visual projection. Offscreen alone does not make it null. */
    viewportFrame: ComponentFrame | null
    flow?: {
      containerId: string
      /** Frame in the real Flow scroll owner's unscaled content CSS pixels. */
      contentFrame: ComponentFrame
      /** Maps those content pixels into the same caller viewport as viewportFrame. */
      contentToViewport: AffineTransform
      /** Visible scroll window in content pixels, including the current scrollLeft/scrollTop. */
      viewport: { x: number; y: number; width: number; height: number }
      scrollSize: { width: number; height: number }
    }
  }[]
}

/** Every mounted implementation receives a fresh scope; state never writes author data. */
export interface ComponentRuntimeScope {
  readonly runScopeId: string
  readonly instanceId: string
  readonly generation: number
  readonly signal: AbortSignal
  /** Whether this mount survives; temporary offscreen pause does not revoke it. */
  isActive(): boolean
  cleanup(dispose: () => void): void
  target(reference: ComponentTarget): ComponentRuntimeTarget | null
  /** Batch fresh layout facts; no author transaction, retained layout cache, or independent animation clock. */
  measure?(references: readonly ComponentTarget[]): Promise<ComponentGeometrySnapshot | null>
  events: {
    emit(name: string, value: JsonValue): void
    /** __runtime.activity replays the current {active, visible, playing} for this instance. */
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
  /** A semantic range can span several formatted runs. */
  readonly elements?: readonly HTMLElement[]
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
  /** Original CSS transform-origin offset and its response to one CSS px of box resizing. */
  sourceOffset?: { current: { x: number; y: number }; widthDelta: { x: number; y: number }; heightDelta: { x: number; y: number } }
}

/** Ephemeral observations carry the persistent record needed to commit a first local edit. */
export interface ComponentAuthorSpotInput {
  kind: 'text' | 'image'
  /** Current computed CSS for the local text tools; never persisted as author data. */
  textStyle?: Partial<Record<'font-family' | 'font-size' | 'color' | 'fill' | 'font-weight' | 'font-style'
    | 'text-decoration-line' | 'background-color' | 'text-align' | 'line-height' | 'letter-spacing' | 'word-spacing' | 'text-transform' | 'white-space' | 'width' | 'transform' | 'transform-origin', string>>
  authorKey?: string
  scope?: ComponentAuthorScope
  binding?: ComponentAuthorBinding
  bindingStatus?: 'bound' | 'unmounted' | 'unresolved' | 'source-required'
  geometry?: ComponentAuthorGeometryObservation
  fieldScope?: 'data' | 'authoring'
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
/** A frozen semantic author address, without display geometry or a live mount identity. */
export type ComponentAuthorField = Pick<ComponentAuthorSpotInput, 'kind' | 'authorKey' | 'scope' | 'binding' | 'bindingStatus'
  | 'fieldScope' | 'dataPath' | 'sourceRegion' | 'initialValue'>
/** A live registration may preview one gesture; callbacks never enter author data or cloned observations. */
export interface ComponentAuthorPreviewCallbacks {
  previewGeometry(geometry: ComponentAuthorGeometry | null): void
}

/** Host-derived layout, not author metadata. Only Flow owns the natural height of a reading block. */
export type ComponentLayoutInput =
  | { mode: 'free-frame' | 'flow-viewport' | 'program-viewport'; inlineSize: number; blockSize: number }
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
  /** Host mounts a referenced owned child in its authored inline position. */
  inline?: { mount(instanceId: string, root: HTMLElement): () => void }
  readonly instance: ComponentInstance<Data>
  readonly scope: ComponentRuntimeScope
  readonly root?: HTMLElement
  readonly teacherController?: TeacherControllerPort
  /** Read-only URLs for assets already owned by this document; no file-system access. */
  readonly resources?: { url(assetId: string): string | undefined }
  readonly media?: ComponentMediaPort
  readonly interactions?: ComponentInteractionPort
  readonly authoring?: { register(spot: ComponentAuthorSpotInput, callbacks?: ComponentAuthorPreviewCallbacks): () => void }
  readonly layout?: ComponentLayoutPort
}

/** Latest per-instance __runtime.activity event; survival is still scope.isActive(). */
export interface ComponentRuntimeActivity {
  active: boolean
  visible: boolean
  playing: boolean
}

export interface MountedComponent<Data = JsonValue> {
  update(instance: ComponentInstance<Data>): void | Promise<void>
  updatePlacement?(frame: ComponentFrame | undefined): void
  /** Cooperative offscreen pause; retains this mount and its local state. */
  suspend?(): void | Promise<void>
  /** Continue this same mount after it becomes active and visible again. */
  resume?(): void | Promise<void>
  dispose(): void | Promise<void>
}

export interface ComponentRuntimeImplementation<Data = JsonValue> {
  /** Explicit Source opt-in: prepare its Web data in this realm before mount, without re-importing the module.
   * DOM and listeners belong to mount; parser preparation replaces the initial document. */
  document?: 'web'
  mount(context: ComponentRuntimeContext<Data>): MountedComponent<Data> | Promise<MountedComponent<Data>>
}
