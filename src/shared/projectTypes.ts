export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type WritingMode = 'horizontal' | 'vertical-rl' | 'vertical-lr'
export type TextOverflowMode = 'auto-height' | 'fixed' | 'shrink'
export type ImageFit = 'contain' | 'cover' | 'stretch'
export type AssetKind = 'image' | 'audio' | 'video'
export type AudioChannel = 'music' | 'narration' | 'sfx' | 'ui' | 'video'
export type FeatherMode = 'rectangle' | 'ellipse'
export type ShapeLineStyle = 'solid' | 'dashed' | 'dotted'
export type ArrowHead = 'none' | 'triangle' | 'stealth' | 'circle' | 'diamond'

export const SHAPE_TYPES = [
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'line',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'arrow-down',
  'arrow-left-right',
  'elbow-arrow',
  'brace-left',
  'brace-right',
  'brace-top',
  'brace-bottom',
  'brace-pair-horizontal',
  'brace-pair-vertical',
  'bracket-left',
  'bracket-right',
  'emphasis-dot',
  'emphasis-triangle',
] as const

export type ShapeType = (typeof SHAPE_TYPES)[number]

export const STROKE_ONLY_SHAPE_TYPES = [
  'line',
  'elbow-arrow',
  'brace-left',
  'brace-right',
  'brace-top',
  'brace-bottom',
  'brace-pair-horizontal',
  'brace-pair-vertical',
  'bracket-left',
  'bracket-right',
] as const satisfies readonly ShapeType[]

const strokeOnlyShapeTypes = new Set<ShapeType>(STROKE_ONLY_SHAPE_TYPES)

export function isStrokeOnlyShapeType(shapeType: ShapeType): boolean {
  return strokeOnlyShapeTypes.has(shapeType)
}

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

export interface SoundDefinition {
  id: string
  name: string
  assetId: string
  channel: Exclude<AudioChannel, 'video'>
  defaultVolume: number
  defaultLoop: boolean
}

export interface ProjectAudioSettings {
  defaultMuted: boolean
  masterVolume: number
  channelVolumes: Record<AudioChannel, number>
  sounds: Record<string, SoundDefinition>
  narrationDucking: {
    enabled: boolean
    musicVolume: number
    fadeMs: number
  }
}

export interface ProjectMediaSettings {
  audio: ProjectAudioSettings
}

export interface ProjectFontToken {
  id: string
  label: string
  fontFamily: string
}

export interface ProjectColorToken {
  id: string
  label: string
  color: string
}

/** Minimal machine-readable style vocabulary; it does not store art-direction prose. */
export interface ProjectDesignTokens {
  fonts: ProjectFontToken[]
  colors: ProjectColorToken[]
}

export interface ProjectPlaybackSettings {
  /** `canvas` uses authorable controller nodes; V8 removed the legacy outer footer. */
  controls: 'canvas' | 'none'
  keyboardNavigation: boolean
  presenter: ProjectPresenterSettings
}

export type PresenterCommand = 'next' | 'previous'

export interface PresenterKeyBinding {
  id: string
  command: PresenterCommand
  /** KeyboardEvent.key is the portable matching authority; `code` is diagnostic only. */
  key: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface ProjectPresenterSettings {
  enabled: boolean
  strategy: 'scene-navigation' | 'authored-command'
  additionalBindings: PresenterKeyBinding[]
}

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

export interface TextRunStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** East Asian emphasis marks rendered per authored Unicode character. */
  emphasis?: boolean
  highlightColor?: string | null
  fontFamily?: string
  fontSize?: number
}

export interface TextRun {
  start: number
  end: number
  style: TextRunStyle
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  runs: TextRun[]
  style: {
    fontFamily: string
    fontSize: number
    color: string
    bold: boolean
    italic: boolean
    underline: boolean
    strike: boolean
    /** Draw filled emphasis dots below horizontal text and to the right of vertical text. */
    emphasis: boolean
    highlightColor: string | null
    align: TextAlign
    verticalAlign: VerticalAlign
    writingMode: WritingMode
    lineSpacing: number
    letterSpacing: number
    padding: number
    overflow: TextOverflowMode
    backgroundColor: string
    backgroundOpacity: number
    cornerRadius: number
  }
}

export type FormulaAstNode =
  | FormulaRow
  | FormulaToken
  | FormulaOperator
  | FormulaFraction
  | FormulaRoot
  | FormulaScript
  | FormulaFenced

export interface FormulaRow {
  type: 'row'
  children: FormulaAstNode[]
}

export interface FormulaToken {
  type: 'token'
  value: string
}

export interface FormulaOperator {
  type: 'operator'
  value: string
}

export interface FormulaFraction {
  type: 'fraction'
  numerator: FormulaAstNode
  denominator: FormulaAstNode
}

export interface FormulaRoot {
  type: 'root'
  radicand: FormulaAstNode
  index?: FormulaAstNode
}

export interface FormulaScript {
  type: 'script'
  base: FormulaAstNode
  superscript?: FormulaAstNode
  subscript?: FormulaAstNode
}

export interface FormulaFenced {
  type: 'fenced'
  open: string
  close: string
  body: FormulaAstNode
}

/** A semantic formula rendered from one shared recursive AST on every surface. */
export interface FormulaNode extends BaseNode {
  type: 'formula'
  /** Stable content reference used by lesson traceability and AI edits. */
  formulaId: string
  /** Human-readable equivalent for accessibility and non-visual inspection. */
  accessibleText: string
  ast: FormulaAstNode
  style: {
    fontSize: number
    color: string
    align: TextAlign
  }
}

export interface ImageNode extends BaseNode {
  type: 'image'
  assetId: string
  preserveAspectRatio: boolean
  fit: ImageFit
  /** Normalized insets into the source image. Opposing sides total less than 1. */
  crop: {
    left: number
    top: number
    right: number
    bottom: number
  }
  /** Alignment/focal point used after the source crop is applied. */
  cropX: number
  cropY: number
  flipX: boolean
  flipY: boolean
  cornerRadius: number
  feather: {
    amount: number
    mode: FeatherMode
  }
  /** Author-only normalized regions that keep important image content reviewable. */
  safeAreas: ImageSafeArea[]
}

export interface ImageSafeArea {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface VideoNode extends BaseNode {
  type: 'video'
  assetId: string
  fit: ImageFit
  autoplay: boolean
  loop: boolean
  muted: boolean
  volume: number
  playbackRate: number
  showControls: boolean
  clickToToggle: boolean
  startTime: number
  endTime: number | null
  poster: {
    mode: 'video-frame' | 'image'
    time: number
    assetId?: string
  }
  backgroundAudioMode: 'none' | 'duck' | 'pause' | 'stop'
}

export interface ShapeNode extends BaseNode {
  type: 'shape'
  shapeType: ShapeType
  style: {
    fillColor: string
    fillOpacity: number
    borderColor: string
    borderOpacity: number
    borderWidth: number
    lineStyle: ShapeLineStyle
    cornerRadius: number
    startArrow: ArrowHead
    endArrow: ArrowHead
  }
}

export interface ExternalComponentNode extends BaseNode {
  type: 'external-component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
}

export type TeacherControllerAction =
  | { type: 'scene.previous' }
  | { type: 'scene.next' }
  | { type: 'scene.replay' }
  | { type: 'course.restart' }
  | { type: 'scene.open-picker' }
  | {
      type: 'scene.go'
      sceneId: string
      targetStateId?: string
    }
  | { type: 'audio.toggle-mute' }
  | { type: 'player.fullscreen.toggle' }

export interface TeacherControllerButton {
  id: string
  action: TeacherControllerAction
  label: string
  visible: boolean
}

/** A first-class, authorable controller that lives inside the canvas global layer. */
export interface TeacherControllerNode extends BaseNode {
  type: 'teacher-controller'
  title: string
  showSceneProgress: boolean
  compact: boolean
  collapsible: boolean
  defaultCollapsed: boolean
  buttons: TeacherControllerButton[]
  style: {
    backgroundColor: string
    backgroundOpacity: number
    accentColor: string
    textColor: string
    cornerRadius: number
  }
  /** Static exports normally omit delivery-only controls. */
  includeInStaticExports: boolean
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

export interface AssetMeta {
  id: string
  filename: string
  mimeType: string
  kind: AssetKind
  path: string
  byteLength: number
  width?: number
  height?: number
  duration?: number
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

export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T

export interface RuntimeAsset {
  meta: AssetMeta
  bytes: Uint8Array
  url: string
}

export type RuntimeAssetMap = Record<string, RuntimeAsset>
import type { RuntimeDocument, RuntimeLayer } from './runtimeTypes'
