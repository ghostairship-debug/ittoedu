import type {
  ComponentRenderMode,
  ComponentRuntimeApiVersion,
  ComponentScope,
} from './componentTypes'
import type { InteractionRule } from './interactionTypes'
import type {
  DeepPartial,
  GlobalLayerVisibility,
  SceneNode,
} from './projectTypes'
import type { ProjectMediaSettings } from './contracts/media-v1/types'
import type { ProjectPlaybackSettings } from './contracts/playback-v1/types'
import type {
  RuntimeLayer,
  RuntimeRenderMode,
  RuntimeStaticFallback,
} from './runtimeTypes'

export const PUBLISHED_LESSON_FORMAT = 'h5lesson-published' as const
export const PUBLISHED_LESSON_VERSION = 1 as const

/** Exact UTF-16 code-unit encoding. It preserves arbitrary trusted JS strings. */
export interface PublishedExecutableCode {
  encoding: 'base64-utf16le'
  data: string
}

export interface PublishedRuntimeDocument {
  apiVersion: 2
  renderMode: RuntimeRenderMode
  code: PublishedExecutableCode
  content: Record<string, string>
  assets: Record<string, { assetId: string }>
  nodeBindings?: Record<string, string>
  staticFallback?: RuntimeStaticFallback
}

type PublishedNode<T> = T extends SceneNode
  ? Omit<T, 'locked' | 'name'>
  : never

/**
 * Runtime nodes deliberately omit authoring-only lock state and layer labels.
 * Stable ids remain because interactions, states and runtime bindings use them.
 */
export type PublishedSceneNode = PublishedNode<SceneNode>

export interface PublishedScenePresentationState {
  id: string
  name: string
  backgroundColor?: string
  backgroundAssetId?: string | null
  nodeOverrides: Record<string, DeepPartial<PublishedSceneNode>>
  nodeOrder?: string[]
}

export interface PublishedScenePresentation {
  initialStateId: string
  states: PublishedScenePresentationState[]
}

export interface PublishedScene {
  id: string
  name: string
  backgroundColor: string
  backgroundAssetId?: string | null
  nodes: PublishedSceneNode[]
  presentation?: PublishedScenePresentation
  runtime?: PublishedRuntimeDocument
  interactions: InteractionRule[]
}

export interface PublishedGlobalLayerItem {
  node: PublishedSceneNode
  layer: RuntimeLayer
  visibility: GlobalLayerVisibility
}

export interface PublishedAsset {
  mimeType: string
  /** Data URL in a standalone file; relative URL in an extracted web package. */
  url: string
}

export interface PublishedComponent {
  id: string
  name: string
  version: string
  /** Canonical digest of the complete authoring component embedded upstream. */
  contentSha256: string
  apiVersion: ComponentRuntimeApiVersion
  scopes: ComponentScope[]
  renderMode: ComponentRenderMode
  code: PublishedExecutableCode
  assets: Record<string, PublishedAsset>
}

/**
 * One-way player input. This is intentionally not a ProjectDocument and cannot
 * be imported by the editor as an authoring project.
 */
export interface PublishedLessonPayload {
  format: typeof PUBLISHED_LESSON_FORMAT
  formatVersion: typeof PUBLISHED_LESSON_VERSION
  title: string
  canvas: {
    width: 1280
    height: 720
  }
  scenes: PublishedScene[]
  assets: Record<string, PublishedAsset>
  components: Record<string, PublishedComponent>
  globalRuntime?: PublishedRuntimeDocument
  globalLayer: PublishedGlobalLayerItem[]
  globalInteractions: InteractionRule[]
  media: ProjectMediaSettings
  playback: ProjectPlaybackSettings
}
