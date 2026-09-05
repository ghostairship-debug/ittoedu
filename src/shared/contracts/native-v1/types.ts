export type TextAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type WritingMode = 'horizontal' | 'vertical-rl' | 'vertical-lr'
export type TextOverflowMode = 'auto-height' | 'fixed' | 'shrink'
export type ImageFit = 'contain' | 'cover' | 'stretch'
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

export const NATIVE_NODE_TYPES = [
  'text',
  'formula',
  'image',
  'video',
  'shape',
  'teacher-controller',
  'table',
  'chart',
  'input',
] as const

export type NativeNodeType = (typeof NATIVE_NODE_TYPES)[number]

/**
 * Layout and playback fields shared by every Native renderable.
 * Same field set as the V8 `BaseNode`, but not that Legacy type.
 */
export interface NativeRenderableBase {
  id: string
  name: string
  type: NativeNodeType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
}

export interface TextRunStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
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

export interface TextNode extends NativeRenderableBase {
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

export interface FormulaNode extends NativeRenderableBase {
  type: 'formula'
  formulaId: string
  accessibleText: string
  ast: FormulaAstNode
  style: {
    fontSize: number
    color: string
    align: TextAlign
  }
}

export interface ImageSafeArea {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface ImageNode extends NativeRenderableBase {
  type: 'image'
  assetId: string
  preserveAspectRatio: boolean
  fit: ImageFit
  crop: {
    left: number
    top: number
    right: number
    bottom: number
  }
  cropX: number
  cropY: number
  flipX: boolean
  flipY: boolean
  cornerRadius: number
  feather: {
    amount: number
    mode: FeatherMode
  }
  safeAreas: ImageSafeArea[]
}

export interface VideoNode extends NativeRenderableBase {
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

export type NativeLineGeometry =
  | { kind: 'straight'; start: [number, number]; end: [number, number] }
  | { kind: 'elbow'; start: [number, number]; end: [number, number]; axis: 'horizontal' | 'vertical'; position: number }

export interface ShapeNode extends NativeRenderableBase {
  type: 'shape'
  shapeType: ShapeType
  lineGeometry?: NativeLineGeometry
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

export interface TeacherControllerNode extends NativeRenderableBase {
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
  includeInStaticExports: boolean
}

export type NativeTextContent = Omit<TextNode, keyof NativeRenderableBase>
export type NativeFormulaContent = Omit<FormulaNode, keyof NativeRenderableBase>
export type NativeImageContent = Omit<ImageNode, keyof NativeRenderableBase>
export type NativeVideoContent = Omit<VideoNode, keyof NativeRenderableBase>
export type NativeShapeContent = Omit<ShapeNode, keyof NativeRenderableBase>
export type NativeTeacherControllerContent = Omit<TeacherControllerNode, keyof NativeRenderableBase>

export type NativeTableHorizontalAlign = 'left' | 'center' | 'right'
export type NativeTableVerticalAlign = 'top' | 'middle' | 'bottom'

export interface NativeTableCellStyle {
  fillColor?: string
  fillOpacity?: number
  textColor?: string
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  horizontalAlign?: NativeTableHorizontalAlign
  verticalAlign?: NativeTableVerticalAlign
}

export type NativeTableStyle = {
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  lineStyle: 'solid' | 'dashed' | 'dotted'
  textColor: string
  fontFamily: string
  fontSize: number
  horizontalAlign: NativeTableHorizontalAlign
  verticalAlign: NativeTableVerticalAlign
  cellPadding: number
}

export interface NativeTableColumn {
  id: string
  width: number
}

export interface NativeTableCell {
  id: string
  columnId: string
  text: string
  style?: NativeTableCellStyle
}

export interface NativeTableRow {
  id: string
  height: number
  cells: NativeTableCell[]
}

export interface NativeTableContent {
  columns: NativeTableColumn[]
  rows: NativeTableRow[]
  headerRowCount: number
  style: NativeTableStyle
}

export interface NativeChartCategory {
  id: string
  label: string
}

export interface NativeChartPoint {
  id: string
  categoryId: string
  value: number
}

export interface NativeChartSeries {
  id: string
  name: string
  color: string
  points: NativeChartPoint[]
}

export type NativeChartCommonStyle = {
  backgroundColor: string
  backgroundOpacity: number
  fontFamily: string
  fontSize: number
  textColor: string
  showLegend: boolean
  legendPosition: 'top' | 'right' | 'bottom' | 'left'
  showDataLabels: boolean
}

export type NativeChartContent =
  | {
      chartType: 'bar' | 'line' | 'area'
      title: string
      categories: NativeChartCategory[]
      series: NativeChartSeries[]
      style: NativeChartCommonStyle & {
        showCategoryAxis: boolean
        showValueAxis: boolean
        showGridLines: boolean
        valueMin?: number
        valueMax?: number
      }
    }
  | {
      chartType: 'pie'
      title: string
      categories: NativeChartCategory[]
      series: [NativeChartSeries]
      style: NativeChartCommonStyle
    }
  | {
      chartType: 'donut'
      title: string
      categories: NativeChartCategory[]
      series: [NativeChartSeries]
      style: NativeChartCommonStyle & { holeSize: number }
    }

export type NativeInputStyle = {
  fontFamily: string
  fontSize: number
  textColor: string
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  cornerRadius: number
  horizontalAlign: 'left' | 'center' | 'right'
  padding: number
}

export interface NativeInputContent {
  answerType: 'text' | 'number'
  stateKey: string
  validityKey: string
  placeholder?: string
  ruleFamilyRuleIds: string[]
  style: NativeInputStyle
}

export type NativeElementData =
  | NativeTextContent
  | NativeFormulaContent
  | NativeImageContent
  | NativeVideoContent
  | NativeShapeContent
  | NativeTeacherControllerContent
  | NativeTableContent
  | NativeChartContent
  | NativeInputContent

export interface TableNode extends NativeRenderableBase, NativeTableContent {
  type: 'table'
}

export type ChartNode = NativeRenderableBase & { type: 'chart' } & NativeChartContent

export interface InputNode extends NativeRenderableBase, NativeInputContent {
  type: 'input'
}

export type NativeRenderableNode =
  | TextNode
  | FormulaNode
  | ImageNode
  | VideoNode
  | ShapeNode
  | TeacherControllerNode
  | TableNode
  | ChartNode
  | InputNode

/**
 * Mutable Native runtime shape retained for the Legacy renderer until its
 * scheduled deletion. The formal Published painter consumes the detached,
 * recursively readonly form below.
 */
export type NativeRenderInput = NativeRenderableNode

type DeepReadonlyNative<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyNative<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyNative<T[Key]> }
    : T

/** Non-persistable, detached Native painter snapshot used by the V2 seam. */
export type ReadonlyNativeRenderInput = DeepReadonlyNative<NativeRenderableNode>

const nativeNodeTypeSet = new Set<string>(NATIVE_NODE_TYPES)

export function isNativeNodeType(type: string): type is NativeNodeType {
  return nativeNodeTypeSet.has(type)
}

export function isNativeRenderInput(
  value: { readonly type: string },
): value is NativeRenderInput {
  return isNativeNodeType(value.type)
}
