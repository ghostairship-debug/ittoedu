import type { InteractionRule } from '../interaction-v1/types'
import type {
  CourseStateCondition,
  CourseStateDeclaration,
} from '../course-state/types'
export type {
  CourseStateCondition,
  CourseStateDeclaration,
  CourseStateScalar,
} from '../course-state/types'
import type {
  FormulaAstNode,
  NativeChartContent,
  NativeFormulaContent,
  NativeImageContent,
  NativeInputContent,
  NativeShapeContent,
  NativeTableContent,
  NativeTeacherControllerContent,
  NativeTextContent,
  NativeVideoContent,
  TextRun,
} from '../native-v1/types'
import type { ProjectDesignTokens } from '../design-v1/types'
import type { AssetMeta, ProjectMediaSettings } from '../media-v1/types'
import type { ProjectPlaybackSettings } from '../playback-v1/types'
import type { EmbeddedComponentPackageMeta } from '../component-v4/types'
import type { RuntimeRenderMode } from '../runtime/types'

export const COURSE_PROJECT_SCHEMA_VERSION = 9 as const

export const COURSE_SURFACE_TYPES = ['slide', 'flow', 'spatial-2d'] as const
export type CourseSurfaceType = typeof COURSE_SURFACE_TYPES[number]

export const LAYER_ITEM_KINDS = ['native', 'component', 'runtime'] as const
export type LayerItemKind = typeof LAYER_ITEM_KINDS[number]

export const GLOBAL_LAYER_PLANES = ['underlay', 'overlay'] as const
export type GlobalLayerPlane = typeof GLOBAL_LAYER_PLANES[number]

/** Surface-local Flow overlays paint on either side of the semantic body. */
export const FLOW_BODY_LAYER_PLANES = ['underlay', 'overlay'] as const
export type FlowBodyLayerPlane = typeof FLOW_BODY_LAYER_PLANES[number]

/**
 * Background ownership mode for an owner that can inherit its effective
 * background from the parent in the Course → surface → scene → state chain.
 * Course has no mode: it is the root of the chain, not an inheriting owner.
 * Named state has no mode either: its "inherit" is expressed by omitting its
 * two optional override fields, not by a separate mode field.
 */
export const BACKGROUND_MODES = ['inherit', 'own'] as const
export type BackgroundMode = typeof BACKGROUND_MODES[number]

export type LayerHitPolicy = 'auto' | 'surface' | 'pass-through'

export interface LayerFrame {
  mode: 'absolute'
  x: number
  y: number
  width: number
  height: number
}

export interface LayerItemBase {
  /** Stable authoring identity. It survives save/reopen and is not a hit-test id. */
  layerItemId: string
  label: string
  frame: LayerFrame
  /**
   * Canonical sparse back-to-front key in the effective scene composition.
   * Global, surface and scene/world items share this ordering fact; the
   * containing arrays are storage scopes, not independent visual planes.
   */
  order: number
  visible: boolean
  locked: boolean
  rotation: number
  opacity: number
  hitPolicy: LayerHitPolicy
  playbackInitialVisibility: 'inherit' | 'hidden'
  paperSpace?: 'viewport' | 'paper'
}

export type NativeElementContent =
  | { nativeType: 'text'; data: NativeTextContent }
  | { nativeType: 'formula'; data: NativeFormulaContent }
  | { nativeType: 'image'; data: NativeImageContent }
  | { nativeType: 'video'; data: NativeVideoContent }
  | { nativeType: 'shape'; data: NativeShapeContent }
  | { nativeType: 'teacher-controller'; data: NativeTeacherControllerContent }
  | { nativeType: 'table'; data: NativeTableContent }
  | { nativeType: 'chart'; data: NativeChartContent }
  | { nativeType: 'input'; data: NativeInputContent }

export interface NativeLayerItem extends LayerItemBase {
  kind: 'native'
  content: NativeElementContent
}

export interface ComponentLayerItem extends LayerItemBase {
  kind: 'component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
  staticFallbackAssetId?: string
}

export interface CourseRuntimeContent {
  values: Record<string, string>
  metadata?: Record<string, {
    label?: string
    description?: string
    multiline?: boolean
    maxLength?: number
  }>
}

/**
 * Remote delivery hint for a project asset. The embedded local bytes stay the
 * author cache / offline source of truth; `path` and `byteLength` always
 * describe those embedded bytes and are never fabricated for remote-only payloads.
 */
export interface CourseAssetRemoteDelivery {
  /**
   * Canonical HTTPS URL serving the same bytes as the embedded local cache.
   * Credentials are never allowed: secrets do not enter the project contract.
   */
  url: string
}

/**
 * V9 asset metadata: the shared V8 `AssetMeta` shape plus optional remote
 * delivery facts. V8 `AssetMeta` itself is frozen and must not grow these keys.
 */
export interface CourseAssetMeta extends AssetMeta {
  remote?: CourseAssetRemoteDelivery
}

/**
 * Course-level network declaration for Runtime/Component code.
 * Supported preview/publish/export hosts derive network, CSP and diagnostics
 * from these exact origins and deny undeclared access. This contract carries
 * origins only, never secrets, and does not define host-local capabilities.
 */
export interface CourseNetworkDeclaration {
  /**
   * Normalized exact `https:`/`wss:` origins the course may connect to
   * (remote media, HTTP API, WebSocket, future AI API). No wildcard, no
   * userinfo, no path/query/fragment.
   */
  connectOrigins?: string[]
}

export interface CourseRuntimeDefinition {
  protocol: 'canvas-runtime' | 'surface-runtime'
  runtimeApiVersion: 2 | 3
  enabled: boolean
  renderMode: RuntimeRenderMode
  source: string
  content: CourseRuntimeContent
  assets: Record<string, { assetId: string }>
  nodeBindings?: Record<string, string>
  staticFallback?: {
    assetId: string
    coverage: 'surface' | 'scene'
  }
}

export interface RuntimeLayerItem extends LayerItemBase {
  kind: 'runtime'
  runtime: CourseRuntimeDefinition
}

export type LayerItem = NativeLayerItem | ComponentLayerItem | RuntimeLayerItem

export interface LocationVisibility {
  mode: 'all' | 'include' | 'exclude'
  locationIds: string[]
}

export interface ScopedLayerItem {
  item: LayerItem
  visibility: LocationVisibility
}

/**
 * Missing `bodyPlane` is the V9 compatibility case and resolves to Overlay,
 * preserving the rendering of projects authored before the body boundary was
 * persisted.
 */
export interface FlowSurfaceLayerEntry extends ScopedLayerItem {
  bodyPlane?: FlowBodyLayerPlane
}

/**
 * Course-global ownership and the plane around local content are orthogonal.
 * Missing `plane` is the documented legacy compatibility case; canonical
 * authoring commands and Published producers materialize the effective plane.
 */
export interface GlobalLayerEntry extends ScopedLayerItem {
  plane?: GlobalLayerPlane
}

export interface LayerItemOverride {
  label?: string
  frame?: Partial<LayerFrame>
  order?: number
  visible?: boolean
  locked?: boolean
  rotation?: number
  opacity?: number
  hitPolicy?: LayerHitPolicy
  playbackInitialVisibility?: 'inherit' | 'hidden'
  nativeData?: Record<string, unknown>
  componentProps?: Record<string, unknown>
}

export interface SlidePresentationState {
  id: string
  name: string
  description?: string
  backgroundColor?: string
  backgroundAssetId?: string | null
  layerItemOverrides: Record<string, LayerItemOverride>
  layerItemOrder?: string[]
}

export interface SlidePresentation {
  initialStateId: string
  thumbnailStateId?: string
  states: SlidePresentationState[]
}

export interface SlideSceneDocument {
  id: string
  name: string
  /** Missing mode defaults to `'own'`; `backgroundColor` stays required either way. */
  backgroundMode?: BackgroundMode
  backgroundColor: string
  backgroundAssetId?: string | null
  layerItems: LayerItem[]
  presentation?: SlidePresentation
  interactions: InteractionRule[]
}

export interface SurfaceBase {
  id: string
  title: string
  /** Persistent surface UI/content, ordered by the same rule as scene/world items. */
  surfaceLayerItems: ScopedLayerItem[]
}

export interface SlideSurfaceDocument extends SurfaceBase {
  type: 'slide'
  /** Missing mode defaults to `'inherit'`; the Slide surface historically had no background of its own. */
  backgroundMode?: BackgroundMode
  backgroundColor?: string
  backgroundAssetId?: string | null
  canvas: {
    width: 1280
    height: 720
  }
  scenes: SlideSceneDocument[]
}

export interface FlowBlockBase {
  /** Stable across reorder, save/reopen, export and AI patching. */
  id: string
}

/**
 * Plain-text plus optional V8 `TextRun[]` selection styles.
 * `text` remains the glyph source; `runs` are range styles over that string.
 */
export interface FlowRichText {
  text: string
  runs?: TextRun[]
}

export type FlowTableCell = string | FlowRichText

export interface FlowListItem extends FlowRichText {
  id: string
}

export interface FlowHeadingBlock extends FlowBlockBase, FlowRichText {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  textAlign?: 'left' | 'center' | 'right'
  lineSpacing?: number
}

export interface FlowParagraphBlock extends FlowBlockBase, FlowRichText {
  type: 'paragraph'
  textAlign?: 'left' | 'center' | 'right'
  lineSpacing?: number
}

export interface FlowListBlock extends FlowBlockBase {
  type: 'list'
  ordered: boolean
  items: FlowListItem[]
}

export interface FlowQuoteBlock extends FlowBlockBase, FlowRichText {
  type: 'quote'
  citation?: string
  textAlign?: 'left' | 'center' | 'right'
  lineSpacing?: number
}

export interface FlowDividerBlock extends FlowBlockBase {
  type: 'divider'
}

export interface FlowMediaBlock extends FlowBlockBase {
  type: 'media'
  assetId: string
  mediaKind: 'image' | 'audio' | 'video'
  altText?: string
  caption?: string
  layout: 'content-width' | 'wide' | 'full-width'
  wrap?: 'none' | 'left' | 'right'
}

export interface FlowTableBlock extends FlowBlockBase {
  type: 'table'
  caption?: string
  columns: Array<{ id: string; header: string }>
  rows: Array<{ id: string; cells: Record<string, FlowTableCell> }>
}

export interface FlowFormulaBlock extends FlowBlockBase {
  type: 'formula'
  formulaId: string
  accessibleText: string
  ast: FormulaAstNode
}

export interface FlowCodeBlock extends FlowBlockBase {
  type: 'code'
  language?: string
  code: string
}

export interface FlowCalloutBlock extends FlowBlockBase {
  type: 'callout'
  tone: 'note' | 'example' | 'warning' | 'conclusion'
  title?: string
  body: string
}

export interface FlowSectionBlock extends FlowBlockBase {
  type: 'section'
  title: string
  collapsedByDefault: boolean
  blocks: FlowBlock[]
}

export interface FlowComponentBlock extends FlowBlockBase {
  type: 'component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
  staticFallbackAssetId: string
  wrap?: 'none' | 'left' | 'right'
}

export type FlowBlock =
  | FlowHeadingBlock
  | FlowParagraphBlock
  | FlowListBlock
  | FlowQuoteBlock
  | FlowDividerBlock
  | FlowMediaBlock
  | FlowTableBlock
  | FlowFormulaBlock
  | FlowCodeBlock
  | FlowCalloutBlock
  | FlowSectionBlock
  | FlowComponentBlock

export interface FlowSurfaceDocument extends SurfaceBase {
  type: 'flow'
  surfaceLayerItems: FlowSurfaceLayerEntry[]
  /** Missing mode defaults to `'own'`; Flow has always owned its background. */
  backgroundMode?: BackgroundMode
  /**
   * Paper / page-chrome color. Omitted documents read as `#ffffff`.
   * This is not a Flow block field and does not rename Slide scene `backgroundColor`.
   */
  backgroundColor?: string
  backgroundAssetId?: string | null
  layout: {
    readingWidth: number
    wideContentWidth: number
  }
  blocks: FlowBlock[]
}

export interface SpatialCameraPose {
  x: number
  y: number
  zoom: number
}

export interface SpatialCameraFrame extends SpatialCameraPose {
  id: string
  name: string
}

export interface SpatialSemanticZoomRule {
  id: string
  layerItemIds: string[]
  minZoom: number
  maxZoom: number
  visible: boolean
}

export type SpatialPathDash = 'solid' | 'dashed' | 'dotted'

export interface SpatialPathStyle {
  color?: string
  width?: number
  dash?: SpatialPathDash
}

export interface SpatialPathDocument {
  id: string
  name: string
  layerItemIds: string[]
  style?: SpatialPathStyle
}

export type SpatialRelationKind = 'line' | 'arrow' | 'bidirectional'

export interface SpatialRelationDocument {
  id: string
  sourceLayerItemId: string
  targetLayerItemId: string
  label?: string
  kind: SpatialRelationKind
}

export interface SpatialSurfaceDocument extends SurfaceBase {
  type: 'spatial-2d'
  /** Missing mode defaults to `'own'`; Spatial has always owned its background. */
  backgroundMode?: BackgroundMode
  /**
   * Infinite-canvas chrome color. Omitted documents read as `#ffffff`.
   * Slide scenes keep their own required `backgroundColor`; do not rename that field.
   */
  backgroundColor?: string
  backgroundAssetId?: string | null
  world: {
    bounds:
      | { mode: 'infinite' }
      | {
          mode: 'finite'
          x: number
          y: number
          width: number
          height: number
        }
    layerItems: LayerItem[]
    paths?: SpatialPathDocument[]
    relations?: SpatialRelationDocument[]
  }
  camera: {
    home: SpatialCameraPose
    frames: SpatialCameraFrame[]
  }
  semanticZoom: SpatialSemanticZoomRule[]
}

export type CourseSurfaceDocument =
  | SlideSurfaceDocument
  | FlowSurfaceDocument
  | SpatialSurfaceDocument

/** A declarative guard may only block; it cannot redirect or execute code. */
export interface CourseNavigationGuard {
  id: string
  effect: 'block'
  fromLocationIds?: string[]
  toLocationIds: string[]
  match: 'all' | 'any'
  conditions: CourseStateCondition[]
  message: string
}

export type CourseLocation =
  | {
      id: string
      label: string
      kind: 'slide-scene'
      surfaceId: string
      sceneId: string
      stateId?: string
    }
  | {
      id: string
      label: string
      kind: 'flow-block'
      surfaceId: string
      blockId: string
    }
  | {
      id: string
      label: string
      kind: 'spatial-camera'
      surfaceId: string
      cameraFrameId: string
    }

export type MixedPrintEntry =
  | {
      id: string
      kind: 'slide-scenes'
      surfaceId: string
      sceneIds: string[]
    }
  | {
      id: string
      kind: 'flow-document'
      surfaceId: string
    }
  | {
      id: string
      kind: 'spatial-frames'
      surfaceId: string
      cameraFrameIds: string[]
    }

export interface MixedPrintPlan {
  pageSize: 'A4' | 'letter' | 'surface-native'
  orientation: 'auto' | 'portrait' | 'landscape'
  entries: MixedPrintEntry[]
}

export interface CourseProjectDocument {
  schemaVersion: typeof COURSE_PROJECT_SCHEMA_VERSION
  id: string
  /** Monotonic authoring transaction revision; unrelated to approval hashes. */
  revision: number
  title: string
  createdAt: string
  updatedAt: string
  /**
   * Course-wide background: the root of the owner resolution chain. Omitted
   * color reads as `#ffffff`; omitted or `null` asset reads as none. Course
   * has no `backgroundMode`; it is the chain's root, not an inheriting owner.
   */
  backgroundColor?: string
  backgroundAssetId?: string | null
  assets: Record<string, CourseAssetMeta>
  componentPackages: Record<string, EmbeddedComponentPackageMeta>
  /** Course-level network declaration; absent means no remote access is declared. */
  network?: CourseNetworkDeclaration
  designTokens: ProjectDesignTokens
  media: ProjectMediaSettings
  playback: ProjectPlaybackSettings
  courseState: CourseStateDeclaration[]
  navigationGuards: CourseNavigationGuard[]
  locations: CourseLocation[]
  startLocationId: string
  globalLayerItems: GlobalLayerEntry[]
  globalInteractions: InteractionRule[]
  surfaces: CourseSurfaceDocument[]
  /** Required only for a project containing more than one surface. */
  mixedPrintPlan?: MixedPrintPlan
}
