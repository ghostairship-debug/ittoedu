import { nanoid } from 'nanoid'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import { isStrokeOnlyShapeType } from '@/shared/contracts/native-v1'
import type {
  FormulaAstNode,
  FormulaNode,
  ImageNode,
  NativeChartContent,
  NativeRenderableBase,
  NativeTableContent,
  ShapeNode,
  ShapeType,
  TeacherControllerNode,
  TextNode,
  VideoNode,
} from '@/shared/contracts/native-v1'
import type {
  NativeChartCategory,
  NativeChartCommonStyle,
  NativeChartPoint,
  NativeChartSeries,
  NativeTableCell,
  NativeTableCellStyle,
  NativeTableColumn,
  NativeTableRow,
  NativeTableStyle,
  NativeInputContent,
} from '@/shared/contracts/native-v1/types'
import type { NativeLayerItem } from '@/shared/contracts/course-project-v9/types'
import type { ComponentManifest } from '@/shared/componentTypes'

const DEFAULT_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

export type IdFactory = () => string

export function createInputLayerItem(
  data: NativeInputContent,
  options: { idFactory?: IdFactory; x?: number; y?: number; id?: string } = {},
): NativeLayerItem {
  return {
    layerItemId: options.id ?? `input_${(options.idFactory ?? nanoid)()}`,
    label: '填空题', kind: 'native',
    frame: { mode: 'absolute', x: options.x ?? 400, y: options.y ?? 300, width: 480, height: 64 },
    order: 0, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    content: { nativeType: 'input', data: structuredClone(data) },
  }
}

export const DEFAULT_INPUT_STYLE: NativeInputContent['style'] = {
  fontFamily: DEFAULT_FONT_FAMILY, fontSize: 24, textColor: '#1f2937', fillColor: '#ffffff', fillOpacity: 1,
  borderColor: '#94a3b8', borderOpacity: 1, borderWidth: 1, cornerRadius: 6, horizontalAlign: 'left', padding: 10,
}

export type TextNodeOptions = Partial<Omit<TextNode, 'id' | 'type' | 'style'>> & {
  id?: string
  style?: Partial<TextNode['style']>
  idFactory?: IdFactory
}

export type FormulaNodeOptions = Partial<Omit<FormulaNode, 'id' | 'type' | 'style'>> & {
  id?: string
  style?: Partial<FormulaNode['style']>
  idFactory?: IdFactory
}

type ImageNodeOptions = Partial<Omit<ImageNode, 'id' | 'type' | 'assetId'>> & {
  id?: string
  assetId: string
  idFactory?: IdFactory
}

type VideoNodeOptions = Partial<Omit<VideoNode, 'id' | 'type' | 'assetId' | 'poster'>> & {
  id?: string
  assetId: string
  poster?: Partial<VideoNode['poster']>
  idFactory?: IdFactory
}

type ShapeNodeOptions = Partial<Omit<ShapeNode, 'id' | 'type' | 'style'>> & {
  id?: string
  style?: Partial<ShapeNode['style']>
  idFactory?: IdFactory
}

export type ExternalComponentFactoryNode = Omit<NativeRenderableBase, 'type'> & {
  type: 'external-component'
  component: {
    packageId: string
    version: string
  }
  props: Record<string, unknown>
}

type ExternalComponentNodeOptions = Partial<
  Omit<ExternalComponentFactoryNode, 'id' | 'type' | 'component'>
> & {
  id?: string
  component: ExternalComponentFactoryNode['component']
  idFactory?: IdFactory
}

function nextId(prefix: string, explicitId: string | undefined, idFactory: IdFactory): string {
  return explicitId ?? `${prefix}_${idFactory()}`
}

export function createTextNode(options?: TextNodeOptions): TextNode
export function createTextNode(x?: number, y?: number): TextNode
export function createTextNode(
  optionsOrX?: TextNodeOptions | number,
  legacyY?: number,
): TextNode {
  const options: TextNodeOptions =
    typeof optionsOrX === 'number'
      ? { x: optionsOrX, y: legacyY }
      : (optionsOrX ?? (legacyY === undefined ? {} : { y: legacyY }))
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 400
  const height = options.height ?? 80
  return {
    id: nextId('text', options.id, idFactory),
    name: options.name ?? '文本',
    type: 'text',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    text: options.text ?? '双击编辑文字',
    runs: options.runs ?? [],
    style: {
      fontFamily: options.style?.fontFamily ?? DEFAULT_FONT_FAMILY,
      fontSize: options.style?.fontSize ?? 42,
      color: options.style?.color ?? '#1f2937',
      bold: options.style?.bold ?? false,
      italic: options.style?.italic ?? false,
      underline: options.style?.underline ?? false,
      strike: options.style?.strike ?? false,
      emphasis: options.style?.emphasis ?? false,
      highlightColor: options.style?.highlightColor ?? null,
      align: options.style?.align ?? 'left',
      verticalAlign: options.style?.verticalAlign ?? 'top',
      writingMode: options.style?.writingMode ?? 'horizontal',
      lineSpacing: options.style?.lineSpacing ?? 6,
      letterSpacing: options.style?.letterSpacing ?? 0,
      padding: options.style?.padding ?? 0,
      overflow: options.style?.overflow ?? 'auto-height',
      backgroundColor: options.style?.backgroundColor ?? '#ffffff',
      backgroundOpacity: options.style?.backgroundOpacity ?? 0,
      cornerRadius: options.style?.cornerRadius ?? 0,
    },
  }
}

export function createDefaultFormulaAst(): FormulaAstNode {
  return {
    type: 'row',
    children: [
      {
        type: 'script',
        base: { type: 'token', value: 'x' },
        superscript: { type: 'token', value: '2' },
      },
      { type: 'operator', value: '+' },
      {
        type: 'fraction',
        numerator: { type: 'token', value: '1' },
        denominator: { type: 'token', value: '2' },
      },
    ],
  }
}

export function createFormulaNode(options?: FormulaNodeOptions): FormulaNode
export function createFormulaNode(x?: number, y?: number): FormulaNode
export function createFormulaNode(
  optionsOrX?: FormulaNodeOptions | number,
  legacyY?: number,
): FormulaNode {
  const options: FormulaNodeOptions = typeof optionsOrX === 'number'
    ? { x: optionsOrX, y: legacyY }
    : (optionsOrX ?? (legacyY === undefined ? {} : { y: legacyY }))
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 420
  const height = options.height ?? 160
  const nodeId = nextId('formula', options.id, idFactory)
  return {
    id: nodeId,
    name: options.name ?? '公式',
    type: 'formula',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    formulaId: options.formulaId ?? `formula:${nodeId}`,
    accessibleText: options.accessibleText ?? 'x 的平方加二分之一',
    ast: structuredClone(options.ast ?? createDefaultFormulaAst()),
    style: {
      fontSize: options.style?.fontSize ?? 48,
      color: options.style?.color ?? '#1f2937',
      align: options.style?.align ?? 'center',
    },
  }
}

export function createImageNode(options: ImageNodeOptions): ImageNode
export function createImageNode(
  assetId: string,
  sourceWidth?: number,
  sourceHeight?: number,
  x?: number,
  y?: number,
): ImageNode
export function createImageNode(
  optionsOrAssetId: ImageNodeOptions | string,
  sourceWidth?: number,
  sourceHeight?: number,
  legacyX?: number,
  legacyY?: number,
): ImageNode {
  let options: ImageNodeOptions
  if (typeof optionsOrAssetId === 'string') {
    const validSourceSize =
      sourceWidth !== undefined &&
      sourceHeight !== undefined &&
      Number.isFinite(sourceWidth) &&
      Number.isFinite(sourceHeight) &&
      sourceWidth > 0 &&
      sourceHeight > 0
    const scale = validSourceSize
      ? Math.min(1, 640 / sourceWidth, 480 / sourceHeight)
      : 1
    options = {
      assetId: optionsOrAssetId,
      width: validSourceSize ? sourceWidth * scale : 320,
      height: validSourceSize ? sourceHeight * scale : 180,
      x: legacyX,
      y: legacyY,
    }
  } else {
    options = optionsOrAssetId
  }
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 320
  const height = options.height ?? 180
  return {
    id: nextId('image', options.id, idFactory),
    name: options.name ?? '图片',
    type: 'image',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    assetId: options.assetId,
    preserveAspectRatio: options.preserveAspectRatio ?? true,
    fit: options.fit ?? 'contain',
    crop: options.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    cropX: options.cropX ?? 0.5,
    cropY: options.cropY ?? 0.5,
    flipX: options.flipX ?? false,
    flipY: options.flipY ?? false,
    cornerRadius: options.cornerRadius ?? 0,
    feather: options.feather ?? { amount: 0, mode: 'rectangle' },
    safeAreas: structuredClone(options.safeAreas ?? []),
  }
}

export function createVideoNode(options: VideoNodeOptions): VideoNode {
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 640
  const height = options.height ?? 360
  return {
    id: nextId('video', options.id, idFactory),
    name: options.name ?? '视频',
    type: 'video',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    assetId: options.assetId,
    fit: options.fit ?? 'contain',
    autoplay: options.autoplay ?? false,
    loop: options.loop ?? false,
    muted: options.muted ?? false,
    volume: options.volume ?? 1,
    playbackRate: options.playbackRate ?? 1,
    showControls: options.showControls ?? true,
    clickToToggle: options.clickToToggle ?? true,
    startTime: options.startTime ?? 0,
    endTime: options.endTime ?? null,
    poster: {
      mode: options.poster?.mode ?? 'video-frame',
      time: options.poster?.time ?? 0,
      ...(options.poster?.assetId ? { assetId: options.poster.assetId } : {}),
    },
    backgroundAudioMode: options.backgroundAudioMode ?? 'duck',
  }
}

type TeacherControllerNodeOptions = Partial<
  Omit<TeacherControllerNode, 'id' | 'type' | 'style' | 'buttons'>
> & {
  id?: string
  style?: Partial<TeacherControllerNode['style']>
  buttons?: TeacherControllerNode['buttons']
  idFactory?: IdFactory
}

export function createTeacherControllerNode(
  options: TeacherControllerNodeOptions = {},
): TeacherControllerNode {
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 900
  const height = options.height ?? 64
  return {
    id: nextId('teacher_controller', options.id, idFactory),
    name: options.name ?? '教师控制器',
    type: 'teacher-controller',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? CANVAS_HEIGHT - height - 18,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    title: options.title ?? '教师控制台',
    showSceneProgress: options.showSceneProgress ?? true,
    compact: options.compact ?? false,
    collapsible: options.collapsible ?? true,
    defaultCollapsed: options.defaultCollapsed ?? true,
    buttons: options.buttons ?? [
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'scene.previous' }, label: '上一场景', visible: true },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'scene.next' }, label: '下一场景', visible: true },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'scene.open-picker' }, label: '场景目录', visible: true },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'scene.replay' }, label: '重播', visible: true },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'course.restart' }, label: '重新开始', visible: false },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'audio.toggle-mute' }, label: '声音', visible: true },
      { id: nextId('teacher_button', undefined, idFactory), action: { type: 'player.fullscreen.toggle' }, label: '全屏', visible: true },
    ],
    style: {
      backgroundColor: options.style?.backgroundColor ?? '#172033',
      backgroundOpacity: options.style?.backgroundOpacity ?? 0.94,
      accentColor: options.style?.accentColor ?? '#e7b85c',
      textColor: options.style?.textColor ?? '#f8fafc',
      cornerRadius: options.style?.cornerRadius ?? 16,
    },
    includeInStaticExports: options.includeInStaticExports ?? false,
  }
}

export function createShapeNode(
  shapeType: ShapeType,
  options: Omit<ShapeNodeOptions, 'shapeType'> = {},
): ShapeNode {
  const idFactory = options.idFactory ?? nanoid
  const isLinear = shapeType === 'line' || shapeType === 'elbow-arrow'
  const isStrokeOnly = isStrokeOnlyShapeType(shapeType)
  const isEmphasis = shapeType === 'emphasis-dot' || shapeType === 'emphasis-triangle'
  const width = options.width ?? (isLinear ? 320 : isEmphasis ? 32 : 320)
  const height = options.height ?? (isLinear ? 40 : isEmphasis ? 32 : 180)
  const defaultEndArrow = shapeType === 'line' ? 'none' : shapeType === 'elbow-arrow' ? 'triangle' : 'none'
  return {
    id: nextId('shape', options.id, idFactory),
    name: options.name ?? shapeName(shapeType),
    type: 'shape',
    shapeType,
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    style: {
      fillColor: options.style?.fillColor ?? '#dbeafe',
      fillOpacity: options.style?.fillOpacity ?? (isStrokeOnly ? 0 : 1),
      borderColor: options.style?.borderColor ?? '#2563eb',
      borderOpacity: options.style?.borderOpacity ?? 1,
      borderWidth: options.style?.borderWidth ?? (isStrokeOnly ? 4 : 0),
      lineStyle: options.style?.lineStyle ?? 'solid',
      cornerRadius: options.style?.cornerRadius ?? (shapeType === 'rounded-rectangle' ? 24 : 0),
      startArrow: options.style?.startArrow ?? 'none',
      endArrow: options.style?.endArrow ?? defaultEndArrow,
    },
  }
}

function shapeName(shapeType: ShapeType): string {
  const names: Record<ShapeType, string> = {
    rectangle: '矩形',
    'rounded-rectangle': '圆角矩形',
    ellipse: '椭圆',
    triangle: '三角形',
    diamond: '菱形',
    line: '直线',
    'arrow-left': '左箭头',
    'arrow-right': '右箭头',
    'arrow-up': '上箭头',
    'arrow-down': '下箭头',
    'arrow-left-right': '双向箭头',
    'elbow-arrow': '折线箭头',
    'brace-left': '左大括号',
    'brace-right': '右大括号',
    'brace-top': '上大括号',
    'brace-bottom': '下大括号',
    'brace-pair-horizontal': '横向大括号对',
    'brace-pair-vertical': '纵向大括号对',
    'bracket-left': '左方括号',
    'bracket-right': '右方括号',
    'emphasis-dot': '着重圆点',
    'emphasis-triangle': '着重三角',
  }
  return names[shapeType]
}

export function createRectangleNode(options?: ShapeNodeOptions): ShapeNode
export function createRectangleNode(x?: number, y?: number): ShapeNode
export function createRectangleNode(
  optionsOrX?: ShapeNodeOptions | number,
  legacyY?: number,
): ShapeNode {
  const options: ShapeNodeOptions =
    typeof optionsOrX === 'number'
      ? { x: optionsOrX, y: legacyY }
      : (optionsOrX ?? (legacyY === undefined ? {} : { y: legacyY }))
  return createShapeNode(
    options.shapeType ?? (options.style?.cornerRadius ? 'rounded-rectangle' : 'rectangle'),
    options,
  )
}

export function createExternalComponentNode(
  options: ExternalComponentNodeOptions,
): ExternalComponentFactoryNode
export function createExternalComponentNode(
  manifest: ComponentManifest,
  x?: number,
  y?: number,
): ExternalComponentFactoryNode
export function createExternalComponentNode(
  optionsOrManifest: ExternalComponentNodeOptions | ComponentManifest,
  legacyX?: number,
  legacyY?: number,
): ExternalComponentFactoryNode {
  const options: ExternalComponentNodeOptions =
    'schemaVersion' in optionsOrManifest
      ? {
          name: optionsOrManifest.name,
          component: {
            packageId: optionsOrManifest.id,
            version: optionsOrManifest.version,
          },
          width: optionsOrManifest.defaultSize.width,
          height: optionsOrManifest.defaultSize.height,
          props: structuredClone(optionsOrManifest.defaultProps),
          x: legacyX,
          y: legacyY,
        }
      : optionsOrManifest
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 480
  const height = options.height ?? 280
  return {
    id: nextId('component', options.id, idFactory),
    name: options.name ?? '互动组件',
    type: 'external-component',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    component: { ...options.component },
    props: { ...(options.props ?? {}) },
  }
}

export type TableFactoryNode = Omit<NativeRenderableBase, 'type'> & {
  type: 'table'
} & NativeTableContent

export type TableNodeOptions = Partial<Omit<TableFactoryNode, 'id' | 'type' | 'columns' | 'rows' | 'style'>> & {
  id?: string
  columns?: NativeTableColumn[]
  rows?: NativeTableRow[]
  headerRowCount?: number
  style?: Partial<NativeTableStyle>
  idFactory?: IdFactory
}

export function createTableNode(options: TableNodeOptions = {}): TableFactoryNode {
  const idFactory = options.idFactory ?? nanoid
  const width = options.width ?? 600
  const height = options.height ?? 120
  const colCount = 3
  const colWidth = Math.round(width / colCount)
  const columns: NativeTableColumn[] = options.columns
    ? structuredClone(options.columns)
    : Array.from({ length: colCount }, () => ({
        id: nextId('col', undefined, idFactory),
        width: colWidth,
      }))

  const rowCount = 3
  const rowHeight = Math.round(height / rowCount)
  const rows: NativeTableRow[] = options.rows
    ? structuredClone(options.rows)
    : Array.from({ length: rowCount }, (_, rowIndex) => ({
        id: nextId('row', undefined, idFactory),
        height: rowHeight,
        cells: columns.map((col, colIndex) => ({
          id: nextId('cell', undefined, idFactory),
          columnId: col.id,
          text: rowIndex === 0 ? `标题 ${colIndex + 1}` : `单元格 ${rowIndex + 1}-${colIndex + 1}`,
          style: rowIndex === 0 ? { bold: true, fillColor: '#f3f4f6' } : undefined,
        })),
      }))

  const defaultStyle: NativeTableStyle = {
    fillColor: '#ffffff',
    fillOpacity: 1,
    borderColor: '#d1d5db',
    borderOpacity: 1,
    borderWidth: 1,
    lineStyle: 'solid',
    textColor: '#1f2937',
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 16,
    horizontalAlign: 'left',
    verticalAlign: 'middle',
    cellPadding: 8,
  }

  return {
    id: nextId('table', options.id, idFactory),
    name: options.name ?? '表格',
    type: 'table',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    columns,
    rows,
    headerRowCount: options.headerRowCount ?? 1,
    style: {
      ...defaultStyle,
      ...(options.style ?? {}),
    },
  }
}

export function createTableLayerItem(node: TableFactoryNode, order = 0): NativeLayerItem {
  return {
    layerItemId: node.id,
    label: node.name,
    frame: {
      mode: 'absolute',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    },
    order,
    visible: node.visible,
    locked: node.locked,
    rotation: node.rotation,
    opacity: node.opacity,
    hitPolicy: 'auto',
    playbackInitialVisibility: node.playbackInitialVisibility,
    kind: 'native',
    content: {
      nativeType: 'table',
      data: {
        columns: structuredClone(node.columns),
        rows: structuredClone(node.rows),
        headerRowCount: node.headerRowCount,
        style: structuredClone(node.style),
      },
    },
  }
}

export function rebuildTableItemIds(
  content: NativeTableContent,
  idFactory: IdFactory = nanoid,
): NativeTableContent {
  const colIdMap = new Map<string, string>()
  const nextColumns = content.columns.map((col) => {
    const newId = nextId('col', undefined, idFactory)
    colIdMap.set(col.id, newId)
    return { ...col, id: newId }
  })
  const nextRows = content.rows.map((row) => {
    const newRowId = nextId('row', undefined, idFactory)
    const newCells = row.cells.map((cell) => {
      const newCellId = nextId('cell', undefined, idFactory)
      const newColId = colIdMap.get(cell.columnId) ?? cell.columnId
      return {
        ...cell,
        id: newCellId,
        columnId: newColId,
        style: cell.style ? { ...cell.style } : undefined,
      }
    })
    return {
      ...row,
      id: newRowId,
      cells: newCells,
    }
  })
  return {
    ...content,
    columns: nextColumns,
    rows: nextRows,
    style: { ...content.style },
  }
}

export type ChartFactoryNode = Omit<NativeRenderableBase, 'type'> & {
  type: 'chart'
} & NativeChartContent

export type ChartNodeOptions = Partial<Omit<ChartFactoryNode, 'id' | 'type' | 'categories' | 'series' | 'style'>> & {
  id?: string
  chartType?: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  categories?: NativeChartCategory[]
  series?: NativeChartSeries[]
  style?: Partial<NativeChartContent['style']>
  idFactory?: IdFactory
}

export function createChartNode(options: ChartNodeOptions = {}): ChartFactoryNode {
  const idFactory = options.idFactory ?? nanoid
  const chartType = options.chartType ?? 'bar'
  const width = options.width ?? 600
  const height = options.height ?? 400

  const defaultTitle =
    chartType === 'pie'
      ? '饼图'
      : chartType === 'donut'
        ? '环形图'
        : chartType === 'line'
          ? '折线图'
          : chartType === 'area'
            ? '面积图'
            : '柱状图'

  const categories: NativeChartCategory[] = options.categories
    ? structuredClone(options.categories)
    : [
        { id: nextId('cat', undefined, idFactory), label: '类别 1' },
        { id: nextId('cat', undefined, idFactory), label: '类别 2' },
        { id: nextId('cat', undefined, idFactory), label: '类别 3' },
      ]

  let series: NativeChartSeries[]
  if (options.series) {
    series = structuredClone(options.series)
  } else if (chartType === 'pie' || chartType === 'donut') {
    series = [
      {
        id: nextId('ser', undefined, idFactory),
        name: '系列 1',
        color: '#2563eb',
        points: [
          { id: nextId('pt', undefined, idFactory), categoryId: categories[0]!.id, value: 30 },
          { id: nextId('pt', undefined, idFactory), categoryId: categories[1]!.id, value: 50 },
          { id: nextId('pt', undefined, idFactory), categoryId: categories[2]!.id, value: 20 },
        ],
      },
    ]
  } else {
    series = [
      {
        id: nextId('ser', undefined, idFactory),
        name: '系列 1',
        color: '#2563eb',
        points: [
          { id: nextId('pt', undefined, idFactory), categoryId: categories[0]!.id, value: 10 },
          { id: nextId('pt', undefined, idFactory), categoryId: categories[1]!.id, value: 25 },
          { id: nextId('pt', undefined, idFactory), categoryId: categories[2]!.id, value: 15 },
        ],
      },
    ]
  }

  const commonStyle: NativeChartCommonStyle = {
    backgroundColor: '#ffffff',
    backgroundOpacity: 1,
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 14,
    textColor: '#1f2937',
    showLegend: true,
    legendPosition: 'top',
    showDataLabels: false,
  }

  let style: NativeChartContent['style']
  if (chartType === 'bar' || chartType === 'line' || chartType === 'area') {
    style = {
      ...commonStyle,
      showCategoryAxis: true,
      showValueAxis: true,
      showGridLines: true,
      ...(options.style as object ?? {}),
    }
  } else if (chartType === 'donut') {
    style = {
      ...commonStyle,
      holeSize: 50,
      ...(options.style as object ?? {}),
    }
  } else {
    style = {
      ...commonStyle,
      ...(options.style as object ?? {}),
    }
  }

  return {
    id: nextId('chart', options.id, idFactory),
    name: options.name ?? defaultTitle,
    type: 'chart',
    x: options.x ?? (CANVAS_WIDTH - width) / 2,
    y: options.y ?? (CANVAS_HEIGHT - height) / 2,
    width,
    height,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    playbackInitialVisibility: options.playbackInitialVisibility ?? 'inherit',
    chartType,
    title: options.title ?? defaultTitle,
    categories,
    series: series as [NativeChartSeries],
    style: style as any,
  } as ChartFactoryNode
}

export function createChartLayerItem(node: ChartFactoryNode, order = 0): NativeLayerItem {
  return {
    layerItemId: node.id,
    label: node.name,
    frame: {
      mode: 'absolute',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    },
    order,
    visible: node.visible,
    locked: node.locked,
    rotation: node.rotation,
    opacity: node.opacity,
    hitPolicy: 'auto',
    playbackInitialVisibility: node.playbackInitialVisibility,
    kind: 'native',
    content: {
      nativeType: 'chart',
      data: structuredClone({
        chartType: node.chartType,
        title: node.title,
        categories: node.categories,
        series: node.series,
        style: node.style,
      }) as NativeChartContent,
    },
  }
}

export function rebuildChartItemIds(
  content: NativeChartContent,
  idFactory: IdFactory = nanoid,
): NativeChartContent {
  const catIdMap = new Map<string, string>()
  const nextCategories = content.categories.map((cat) => {
    const newId = nextId('cat', undefined, idFactory)
    catIdMap.set(cat.id, newId)
    return { ...cat, id: newId }
  })
  const nextSeries = content.series.map((ser) => {
    const newSerId = nextId('ser', undefined, idFactory)
    const nextPoints = ser.points.map((pt) => {
      const newPtId = nextId('pt', undefined, idFactory)
      const newCatId = catIdMap.get(pt.categoryId) ?? pt.categoryId
      return {
        ...pt,
        id: newPtId,
        categoryId: newCatId,
      }
    })
    return {
      ...ser,
      id: newSerId,
      points: nextPoints,
    }
  })
  return {
    ...content,
    categories: nextCategories,
    series: nextSeries as typeof content.series,
    style: { ...content.style },
  } as NativeChartContent
}
