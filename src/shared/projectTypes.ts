export type {
  TextAlign,
  VerticalAlign,
  WritingMode,
  TextOverflowMode,
  ImageFit,
  FeatherMode,
  ShapeLineStyle,
  ArrowHead,
  ShapeType,
  TextRunStyle,
  TextRun,
  TextNode,
  FormulaAstNode,
  FormulaRow,
  FormulaToken,
  FormulaOperator,
  FormulaFraction,
  FormulaRoot,
  FormulaScript,
  FormulaFenced,
  FormulaNode,
  ImageSafeArea,
  ImageNode,
  VideoNode,
  ShapeNode,
  TeacherControllerAction,
  TeacherControllerButton,
  TeacherControllerNode,
} from './contracts/native-v1/types'
export {
  SHAPE_TYPES,
  STROKE_ONLY_SHAPE_TYPES,
  isStrokeOnlyShapeType,
} from './contracts/native-v1/types'

export type {
  AssetKind,
  AudioChannel,
  SoundDefinition,
  ProjectAudioSettings,
  ProjectMediaSettings,
  AssetMeta,
  RuntimeAsset,
  RuntimeAssetMap,
} from './contracts/media-v1/types'

export type {
  ProjectFontToken,
  ProjectColorToken,
  ProjectDesignTokens,
} from './contracts/design-v1/types'

export type {
  PresenterCommand,
  PresenterKeyBinding,
  ProjectPresenterSettings,
  ProjectPlaybackSettings,
} from './contracts/playback-v1/types'

export type { EmbeddedComponentPackageMeta } from './contracts/component-v4/types'

import type { EmbeddedComponentPackageMeta } from './contracts/component-v4/types'
import type {
  FormulaNode,
  ImageNode,
  ShapeNode,
  TeacherControllerNode,
  TextNode,
  VideoNode,
} from './contracts/native-v1/types'
import type {
  AssetMeta,
  ProjectMediaSettings,
} from './contracts/media-v1/types'
import type { ProjectDesignTokens } from './contracts/design-v1/types'
import type { ProjectPlaybackSettings } from './contracts/playback-v1/types'
import type { RuntimeDocument, RuntimeLayer } from './runtimeTypes'

/** Runtime-visible Project V8 node discriminators used by generated contracts. */
export const SCENE_NODE_TYPES = [
  'text',
  'formula',
  'image',
  'video',
  'shape',
  'teacher-controller',
  'external-component',
] as const

export type NodeType = typeof SCENE_NODE_TYPES[number]

export interface ProjectDocument {
  schemaVersion: 8
  id: string
  title: string
  createdAt: string
  updatedAt: string
  canvas: {
    width: 1280
    height: 720
  }
  scenes: SceneDocument[]
  assets: Record<string, AssetMeta>
  componentPackages: Record<string, EmbeddedComponentPackageMeta>
  globalRuntime?: RuntimeDocument
  globalLayer: GlobalLayerItem[]
  /** Persistent, course-wide declarative mappings for global-layer nodes. */
  globalInteractions: import('./interactionTypes').InteractionRule[]
  designTokens: ProjectDesignTokens
  media: ProjectMediaSettings
  playback: ProjectPlaybackSettings
}

export interface SceneDocument {
  id: string
  name: string
  backgroundColor: string
  backgroundAssetId?: string | null
  nodes: SceneNode[]
  /** Optional when a scene does not author named presentation states. */
  presentation?: ScenePresentation
  runtime?: RuntimeDocument
  interactions: import('./interactionTypes').InteractionRule[]
}

/**
 * A stable, authorable visual state of a scene. The scene's `nodes` remain the
 * canonical base. A state only stores the fields that differ from that base.
 */
export interface ScenePresentationState {
  id: string
  name: string
  description?: string
  backgroundColor?: string
  /** `null` explicitly clears the base background asset. */
  backgroundAssetId?: string | null
  nodeOverrides: Record<string, SceneNodeOverride>
  /** Optional state-specific z-order, from back to front. */
  nodeOrder?: string[]
}

export interface ScenePresentation {
  initialStateId: string
  thumbnailStateId?: string
  states: ScenePresentationState[]
}

export interface BaseNode {
  id: string
  name: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  /** Playback may start hidden while remaining visible/selectable on authoring and static canvases. */
  playbackInitialVisibility: 'inherit' | 'hidden'
}

export interface ExternalComponentNode extends BaseNode {
  type: 'external-component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
}

export interface GlobalLayerVisibility {
  mode: 'all' | 'include' | 'exclude'
  sceneIds: string[]
}

export interface GlobalLayerItem {
  node: SceneNode
  layer: RuntimeLayer
  visibility: GlobalLayerVisibility
}

export type SceneNode =
  | TextNode
  | FormulaNode
  | ImageNode
  | VideoNode
  | ShapeNode
  | TeacherControllerNode
  | ExternalComponentNode

type DistributiveNodeOverride<T> = T extends ExternalComponentNode
  ? DeepPartial<Omit<T, 'id' | 'type' | 'component'>>
  : T extends SceneNode
    ? DeepPartial<Omit<T, 'id' | 'type'>>
    : never

export type SceneNodeOverride = DistributiveNodeOverride<SceneNode>

export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T
