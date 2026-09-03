import { nanoid } from 'nanoid'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import { isStrokeOnlyShapeType } from '@/shared/contracts/native-v1'
import type {
  FormulaAstNode,
  FormulaNode,
  ImageNode,
  NativeRenderableBase,
  ShapeNode,
  ShapeType,
  TeacherControllerNode,
  TextNode,
  VideoNode,
} from '@/shared/contracts/native-v1'
import type { ComponentManifest } from '@/shared/componentTypes'

const DEFAULT_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

export type IdFactory = () => string

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
