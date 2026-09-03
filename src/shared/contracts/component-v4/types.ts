import type * as Phaser from 'phaser'
import type {
  CourseEventBus,
  CourseStateStore,
  RuntimeCaptureContext,
  RuntimePresentationApi,
} from '../runtime/types'

export type ComponentSchemaVersion = 4
export type ComponentRuntimeApiVersion = 4
export const COMPONENT_SCOPES = ['scene', 'global'] as const
export const COMPONENT_RENDER_MODES = ['phaser', 'dom', 'hybrid'] as const
export const COMPONENT_EXECUTION_MODES = ['edit', 'preview', 'capture'] as const
export type ComponentScope = typeof COMPONENT_SCOPES[number]
export type ComponentRenderMode = typeof COMPONENT_RENDER_MODES[number]
export type ComponentExecutionMode = typeof COMPONENT_EXECUTION_MODES[number]

interface ComponentManifestBase {
  id: string
  name: string
  version: string
  description?: string
  entry: string
  thumbnail?: string
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  preserveAspectRatio: boolean
  assets: Record<string, string>
  defaultProps: Record<string, unknown>
}

export interface ComponentEditorPropertyBase {
  /** Dot-separated path inside node.props, for example `pages.intro.title`. */
  key: string
  label: string
  description?: string
  required?: boolean
}

export interface ComponentTextProperty extends ComponentEditorPropertyBase {
  type: 'text' | 'textarea'
  placeholder?: string
  maxLength?: number
}

export interface ComponentNumberProperty extends ComponentEditorPropertyBase {
  type: 'number'
  min?: number
  max?: number
  step?: number
  unit?: string
}

export interface ComponentBooleanProperty extends ComponentEditorPropertyBase {
  type: 'boolean'
}

export interface ComponentColorProperty extends ComponentEditorPropertyBase {
  type: 'color'
}

export interface ComponentSelectProperty extends ComponentEditorPropertyBase {
  type: 'select'
  options: Array<{ value: string; label: string }>
}

export interface ComponentImageProperty extends ComponentEditorPropertyBase {
  /** The stored prop value is a project AssetMeta.id. */
  type: 'image'
}

export type ComponentEditorProperty =
  | ComponentTextProperty
  | ComponentNumberProperty
  | ComponentBooleanProperty
  | ComponentColorProperty
  | ComponentSelectProperty
  | ComponentImageProperty

export interface ComponentEditorPage {
  id: string
  label: string
  description?: string
  /** Property keys shown while this internal page is selected in the editor. */
  propertyKeys: string[]
}

export interface ComponentEditorSchema {
  properties: ComponentEditorProperty[]
  /** Optional internal pages used to group fields and preview multi-page components. */
  pages?: ComponentEditorPage[]
  defaultPageId?: string
  /**
   * Prop path used only to persist the editor's currently inspected internal page.
   * A component should use ctx.editorState.pageId in edit mode and keep its playback
   * initial-page prop separate.
   */
  previewPageProp?: string
}

export interface ComponentVariant {
  id: string
  label: string
  description?: string
  /** Props applied when the author switches to this variant. */
  props: Record<string, unknown>
}

export interface ComponentPreset {
  id: string
  label: string
  description?: string
  variantId?: string
  /** Props merged after defaultProps and the referenced variant props. */
  props: Record<string, unknown>
  /** Optional internal page to show immediately after adding the preset. */
  previewPageId?: string
}

export interface ComponentManifestV4 extends ComponentManifestBase {
  schemaVersion: 4
  runtimeApiVersion: 4
  /** V4 components explicitly declare both their mount scopes and render surface. */
  supportedScopes: ComponentScope[]
  renderMode: ComponentRenderMode
  editor?: ComponentEditorSchema
  variants?: ComponentVariant[]
  presets?: ComponentPreset[]
}

/** Current production component contract. */
export type ConfigurableComponentManifest = ComponentManifestV4
export type ComponentManifest = ComponentManifestV4

export interface ComponentHostActions {
  goToScene(sceneId: string, targetStateId?: string): boolean
  nextScene(): boolean
  previousScene(): boolean
  replayScene(): boolean
  restartCourse(): boolean
}

export interface ComponentEditorState {
  pageId?: string
  variantId?: string
}

export interface ComponentEditableTextBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ComponentEditableTextRegion {
  /** Dot-separated path inside node.props, for example `content.title`. */
  key: string
  /** Optional author-facing label shown by the canvas editor. */
  label?: string
  multiline?: boolean
  maxLength?: number
  /**
   * Bounds in the component's authored local coordinate system.
   * A getter lets Phaser components keep the hit target aligned with motion.
   */
  getBounds(): ComponentEditableTextBounds
}

export type ComponentAuthoringTargetSource = 'registered' | 'dom'

/** Explicit component text target measured in the canonical stage space. */
export interface ComponentAuthoringTextTarget {
  kind: 'component-text'
  /** Stable for the lifetime of the registration or DOM element. */
  targetId: string
  scope: ComponentScope
  sceneId?: string
  nodeId: string
  componentId: string
  /** Dot-separated path inside the effective component props. */
  key: string
  label: string
  multiline: boolean
  maxLength?: number
  source: ComponentAuthoringTargetSource
  /**
   * Stage-space rectangle before rotation. Rotate around its center by
   * `rotation` to obtain the visible target in the 1280 x 720 canvas.
   */
  bounds: Readonly<ComponentEditableTextBounds>
  /** Clockwise degrees inherited from the authored component node. */
  rotation: number
}

export interface ComponentAuthoringTargetUpdate {
  revision: number
  /** Identifies the component even when cleanup publishes an empty list. */
  scope: ComponentScope
  sceneId?: string
  nodeId: string
  targets: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
}

export interface ComponentEditorHost {
  /**
   * Registers an explicit canvas text-edit hit target. The returned disposer
   * may be called before component destruction when a region is no longer used.
   */
  registerTextRegion(region: ComponentEditableTextRegion): () => void

  /**
   * Requests a recomputation after component-internal layout or motion changes
   * the bounds returned by a registered region. Calls may be coalesced by the
   * host and are safe no-ops after the component authoring host is destroyed.
   */
  invalidate(): void
}

interface ComponentCreateContextV4Base {
  runtimeApiVersion: 4
  renderMode: ComponentRenderMode
  instanceId: string
  width: number
  height: number
  mode: ComponentExecutionMode
  props: Record<string, unknown>
  editorState: Readonly<ComponentEditorState>
  /** Editor-only optional bridge; absent in preview/capture players. */
  editor?: ComponentEditorHost
  actions: Readonly<ComponentHostActions>
  scope: ComponentScope
  /** Lifecycle-scoped in the player: subscriptions are removed on destroy. */
  events?: CourseEventBus
  /** Shared across ordinary scene navigation and reset by restartCourse(). */
  courseState?: CourseStateStore
  /** Player-only declarative scene-state controller. */
  presentation?: RuntimePresentationApi
  /** Lets async assets participate in deterministic thumbnail/export capture. */
  capture: RuntimeCaptureContext
  assetUrl(assetKey: string): string
  projectAssetUrl(assetId: string): string
  emit(eventName: string, payload?: unknown): void
}

export interface ComponentPhaserSurface {
  Phaser: typeof Phaser
  scene: Phaser.Scene
  root: Phaser.GameObjects.Container
}

export interface ComponentDomSurface {
  root: HTMLElement
}

export interface ComponentCreateContextV4Phaser
  extends ComponentCreateContextV4Base {
  renderMode: 'phaser'
  phaser: ComponentPhaserSurface
}

export interface ComponentCreateContextV4Dom
  extends ComponentCreateContextV4Base {
  renderMode: 'dom'
  dom: ComponentDomSurface
}

export interface ComponentCreateContextV4Hybrid
  extends ComponentCreateContextV4Base {
  renderMode: 'hybrid'
  phaser: ComponentPhaserSurface
  dom: ComponentDomSurface
}

/**
 * V4 exposes only the renderer capabilities declared by manifest.renderMode.
 * Renderer roots are nested so DOM and Phaser never share an ambiguous `root`.
 */
export type ComponentCreateContextV4 =
  | ComponentCreateContextV4Phaser
  | ComponentCreateContextV4Dom
  | ComponentCreateContextV4Hybrid

export interface ComponentInstanceLifecycle {
  setMode?(mode: ComponentExecutionMode): void
  resize?(width: number, height: number): void
  updateProps?(props: Record<string, unknown>): void
  setEditorState?(state: Readonly<ComponentEditorState>): void
  setVisible?(visible: boolean): void
  suspend?(): void
  resume?(): void
  prepareCapture?(): void | Promise<void>
  destroy(): void
}

export interface ComponentDefinitionV4 {
  id: string
  runtimeApiVersion: 4
  create(context: ComponentCreateContextV4): ComponentInstanceLifecycle
}

export interface EmbeddedComponentPackageMeta {
  packageId: string
  version: string
  name: string
  manifestPath: string
  runtimePath: string
  thumbnailPath?: string
  /** Canonical SHA-256 of all embedded component paths and bytes. */
  contentSha256: string
  /** SHA-256 of the exact .h5component bytes selected from a catalog or file. */
  sha256?: string
  /** ISO timestamp recorded when the executable package entered this project. */
  importedAt?: string
  /** Human-readable catalog/source label; never an external absolute path. */
  sourceLabel?: string
  /** Explicit authoring provenance; imported third-party packages default to read-only. */
  editableCopy?: boolean
  sourcePackageId?: string
}

export interface ComponentPackageData {
  manifest: ComponentManifest
  runtimeSource: string
  files: Record<string, Uint8Array>
  /** Recomputed by package parsing; raw test/build sources may omit the cache. */
  readonly contentSha256?: string
  thumbnailUrl?: string
  /** Import provenance used to lock exact executable bytes in Project V8. */
  provenance?: {
    sha256: string
    importedAt: string
    sourceLabel: string
  }
}

export interface ExportPayload {
  project: import('../../projectTypes').ProjectDocument
  assets: Record<string, { mimeType: string; dataUrl: string }>
  components: Record<
    string,
    {
      manifest: ComponentManifest
      runtimeSource: string
      assets: Record<string, { mimeType: string; dataUrl: string }>
    }
  >
}
