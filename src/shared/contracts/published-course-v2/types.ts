import type {
  CourseNavigationGuard,
  CourseStateDeclaration,
  CourseLocation,
  FlowBlock,
  LayerFrame,
  LayerHitPolicy,
  LayerItemOverride,
  MixedPrintPlan,
  NativeElementContent,
  SpatialCameraFrame,
  SpatialCameraPose,
  SpatialPathDocument,
  SpatialRelationDocument,
  SpatialSemanticZoomRule,
} from '../course-project-v9/types'
import type { InteractionRule } from '../interaction-v1/types'
import type {
  ProjectDesignTokens,
  ProjectMediaSettings,
  ProjectPlaybackSettings,
} from '../../projectTypes'
import type { RuntimeRenderMode } from '../runtime/types'

export const PUBLISHED_COURSE_FORMAT = 'h5course-published' as const
export const PUBLISHED_COURSE_VERSION = 2 as const

export interface PublishedCourseExecutableCode {
  encoding: 'base64-utf16le'
  data: string
}

export interface PublishedCourseAsset {
  mimeType: string
  /** Data URL in standalone HTML; relative URL in an extracted web package. */
  url: string
}

export interface PublishedCourseComponent {
  id: string
  name: string
  version: string
  contentSha256: string
  apiVersion: 4
  scopes: Array<'scene' | 'global'>
  renderMode: 'dom' | 'phaser' | 'hybrid'
  code: PublishedCourseExecutableCode
  assets: Record<string, PublishedCourseAsset>
}

export interface PublishedLayerItemBase {
  layerItemId: string
  frame: LayerFrame
  order: number
  visible: boolean
  rotation: number
  opacity: number
  hitPolicy: LayerHitPolicy
  playbackInitialVisibility: 'inherit' | 'hidden'
  paperSpace?: 'viewport' | 'paper'
}

export interface PublishedNativeLayerItem extends PublishedLayerItemBase {
  kind: 'native'
  content: NativeElementContent
}

export interface PublishedComponentLayerItem extends PublishedLayerItemBase {
  kind: 'component'
  component: { packageId: string; version: string }
  props: Record<string, unknown>
  staticFallbackAssetId?: string
}

export interface PublishedRuntimeLayerItem extends PublishedLayerItemBase {
  kind: 'runtime'
  runtime: {
    protocol: 'canvas-runtime' | 'surface-runtime'
    runtimeApiVersion: 2 | 3
    enabled: boolean
    renderMode: RuntimeRenderMode
    code: PublishedCourseExecutableCode
    content: {
      values: Record<string, string>
      metadata?: Record<string, {
        label?: string
        description?: string
        multiline?: boolean
        maxLength?: number
      }>
    }
    assets: Record<string, { assetId: string }>
    nodeBindings?: Record<string, string>
    staticFallback?: { assetId: string; coverage: 'surface' | 'scene' }
  }
}

export type PublishedLayerItem =
  | PublishedNativeLayerItem
  | PublishedComponentLayerItem
  | PublishedRuntimeLayerItem

export interface PublishedScopedLayerItem {
  item: PublishedLayerItem
  visibility: {
    mode: 'all' | 'include' | 'exclude'
    locationIds: string[]
  }
}

export interface PublishedSlidePresentationState {
  id: string
  name: string
  backgroundColor?: string
  backgroundAssetId?: string | null
  layerItemOverrides: Record<string, LayerItemOverride>
  layerItemOrder?: string[]
}

export interface PublishedSlidePresentation {
  initialStateId: string
  states: PublishedSlidePresentationState[]
}

export interface PublishedSlideScene {
  id: string
  name: string
  backgroundColor: string
  backgroundAssetId?: string | null
  layerItems: PublishedLayerItem[]
  presentation?: PublishedSlidePresentation
  interactions: InteractionRule[]
}

interface PublishedSurfaceBase {
  id: string
  title: string
  surfaceLayerItems: PublishedScopedLayerItem[]
}

export interface PublishedSlideSurface extends PublishedSurfaceBase {
  type: 'slide'
  canvas: { width: 1280; height: 720 }
  scenes: PublishedSlideScene[]
}

export interface PublishedFlowSurface extends PublishedSurfaceBase {
  type: 'flow'
  backgroundColor?: string
  layout: { readingWidth: number; wideContentWidth: number }
  blocks: FlowBlock[]
}

export interface PublishedSpatialSurface extends PublishedSurfaceBase {
  type: 'spatial-2d'
  backgroundColor?: string
  world: {
    bounds:
      | { mode: 'infinite' }
      | { mode: 'finite'; x: number; y: number; width: number; height: number }
    layerItems: PublishedLayerItem[]
    paths?: SpatialPathDocument[]
    relations?: SpatialRelationDocument[]
  }
  camera: { home: SpatialCameraPose; frames: SpatialCameraFrame[] }
  semanticZoom: SpatialSemanticZoomRule[]
}

export type PublishedCourseSurface =
  | PublishedSlideSurface
  | PublishedFlowSurface
  | PublishedSpatialSurface

/** One-way player input. It is intentionally not an authoring project. */
export interface PublishedCourseV2Payload {
  format: typeof PUBLISHED_COURSE_FORMAT
  formatVersion: typeof PUBLISHED_COURSE_VERSION
  sourceSchemaVersion: 9
  courseId: string
  title: string
  assets: Record<string, PublishedCourseAsset>
  components: Record<string, PublishedCourseComponent>
  designTokens: ProjectDesignTokens
  media: ProjectMediaSettings
  playback: ProjectPlaybackSettings
  courseState: CourseStateDeclaration[]
  navigationGuards: CourseNavigationGuard[]
  locations: CourseLocation[]
  startLocationId: string
  globalLayerItems: PublishedScopedLayerItem[]
  globalInteractions: InteractionRule[]
  surfaces: PublishedCourseSurface[]
  mixedPrintPlan?: MixedPrintPlan
}
