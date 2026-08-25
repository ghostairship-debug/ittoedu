import type { InteractionRule } from '../interaction-v1/types'
import type {
  BaseNode,
  EmbeddedComponentPackageMeta,
  FormulaAstNode,
  FormulaNode,
  ImageNode,
  ProjectDesignTokens,
  ProjectMediaSettings,
  ProjectPlaybackSettings,
  SceneNode,
  ShapeNode,
  TeacherControllerNode,
  TextNode,
  TextRun,
  VideoNode,
  AssetMeta,
} from '../../projectTypes'
import type { RuntimeRenderMode } from '../runtime/types'

export const COURSE_PROJECT_SCHEMA_VERSION = 9 as const

export const COURSE_SURFACE_TYPES = ['slide', 'flow', 'spatial-2d'] as const
export type CourseSurfaceType = typeof COURSE_SURFACE_TYPES[number]

export const LAYER_ITEM_KINDS = ['native', 'component', 'runtime'] as const
export type LayerItemKind = typeof LAYER_ITEM_KINDS[number]

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

type NativeNodeData<T extends SceneNode> = Omit<T, keyof BaseNode>

export type NativeElementContent =
  | { nativeType: 'text'; data: NativeNodeData<TextNode> }
  | { nativeType: 'formula'; data: NativeNodeData<FormulaNode> }
  | { nativeType: 'image'; data: NativeNodeData<ImageNode> }
  | { nativeType: 'video'; data: NativeNodeData<VideoNode> }
  | { nativeType: 'shape'; data: NativeNodeData<ShapeNode> }
  | {
      nativeType: 'teacher-controller'
      data: NativeNodeData<TeacherControllerNode>
    }

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
 * The isolated Player allows only the declared exact origins and denies
 * anything undeclared; this contract carries origins only, never secrets.
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
  /**
   * Paper / page-chrome color. Omitted documents read as `#ffffff`.
   * This is not a Flow block field and does not rename Slide scene `backgroundColor`.
   */
  backgroundColor?: string
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
  /**
   * Infinite-canvas chrome color. Omitted documents read as `#ffffff`.
   * Slide scenes keep their own required `backgroundColor`; do not rename that field.
   */
  backgroundColor?: string
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

export type CourseStateScalar = boolean | number | string | null

export type CourseStateDeclaration =
  | { key: string; valueType: 'boolean'; defaultValue: boolean }
  | { key: string; valueType: 'number'; defaultValue: number }
  | { key: string; valueType: 'string'; defaultValue: string }
  | { key: string; valueType: 'null'; defaultValue: null }

export type CourseStateCondition =
  | { type: 'exists'; key: string; exists: boolean }
  | {
      type: 'compare'
      key: string
      operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
      value: CourseStateScalar
    }

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
  globalLayerItems: ScopedLayerItem[]
  globalInteractions: InteractionRule[]
  surfaces: CourseSurfaceDocument[]
  /** Required only for a project containing more than one surface. */
  mixedPrintPlan?: MixedPrintPlan
}
