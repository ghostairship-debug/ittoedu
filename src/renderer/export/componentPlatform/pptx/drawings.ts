import type { ComponentInstance } from '../../../../shared/contracts/component-platform'
import { textComponentDataSchema } from '../../../../components/text/data'
import { textOutputAdapter } from '../../../../components/text/adapters'
import { tableDataSchema } from '../../../../components/table/data'
import { toNativeTableData, tableLayoutCellContent } from '../../../../components/table/data'
import { buildNativeTableLayout } from '../../../../shared/nativeTableLayout'
import type { FlowTextContent } from '../../../../shared/document/content'
import type PptxGenJS from 'pptxgenjs'
import { tableOutputAdapter } from '../../../../components/table/adapters'
import { chartDataSchema } from '../../../../components/chart/data'
import { chartOutputAdapter } from '../../../../components/chart/output'
import { shapeDataSchema } from '../../../../components/shape/data'
import { imageDataSchema } from '../../../../components/image/data'
import { inputDataSchema } from '../../../../components/input'
import { choiceDataSchema } from '../../../../components/choice'
import { disclosureDataSchema } from '../../../../components/disclosure'
import { popoverDataSchema } from '../../../../components/popover'
import type { ImageNode, ShapeNode, TextNode } from '../../../../shared/contracts/native-v1/types'
import { renderImageNodeCanvas } from '../../../../shared/imageEffects'
import { addPptxTextNode, addPptxShapeNode } from '../../pptxTextAndShape'
import { addPptxTableNode, addPptxChartNode } from '../../pptxTableAndChart'
import { pptxColor, pptxColorAlpha, pptxRotation, pptxTransparency, type PptxDrawingTarget } from '../../pptxShared'
import type { PptxShapeExtensions } from '../../pptxShapeGeometry'
import type { officeFrame } from './frame'

type Frame = ReturnType<typeof officeFrame>
const pixelScale = { x: 1 / 96, y: 1 / 96 }
export function instanceOpacity(instance: ComponentInstance): number {
  const opacity = Number(instance.style?.opacity ?? 1)
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1
}
const base = (instance: ComponentInstance, frame: Frame) => ({
  id: instance.id, name: instance.name ?? instance.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height,
  rotation: frame.rotation, opacity: instanceOpacity(instance),
  visible: true, locked: false, playbackInitialVisibility: 'inherit' as const,
})

function reflectedTarget(target: PptxDrawingTarget, flipY: boolean): PptxDrawingTarget {
  if (!flipY) return target
  return { ...target, addShape: (type, options) => target.addShape(type, { ...options, flipV: !options?.flipV }) }
}

/** Disposable format projections only; these never create or persist old carrier nodes. */
export function drawProfessional(target: PptxDrawingTarget, key: string, instance: ComponentInstance,
  frame: Frame, extensions: PptxShapeExtensions): string[] | null {
  const warnings: string[] = []
  if (key === 'guoling.text') {
    const data = textComponentDataSchema.parse(instance.data)
    const inlines = textOutputAdapter.inlines(data)
    if (inlines.some(inline => inline.type === 'math')) return null
    let cursor = 0
    const runs = inlines.flatMap(inline => {
      if (inline.type !== 'text') return []
      const start = cursor; cursor += Array.from(inline.text).length
      if (inline.link) warnings.push('文字链接的点击行为不带入 PPTX。')
      return inline.style ? [{ start, end: cursor, style: { ...inline.style,
        ...(inline.style.fontSize ? { fontSize: inline.style.fontSize * frame.scaleY } : {}) } }] : []
    })
    const { appearance: style } = data
    if (style.lineHeight === 'normal' && style.lineSpacing === undefined) warnings.push('PPTX 使用自身字体度量计算普通行距；浏览器 normal 行高在 HTML 中原样保留。')
    if ((style.highlightColor && pptxColorAlpha(style.highlightColor) < 1)
      || inlines.some(inline => inline.type === 'text' && inline.style?.highlightColor && pptxColorAlpha(inline.style.highlightColor) < 1))
      warnings.push('PPTX 原生文字高亮不支持透明色，保留高亮 RGB 与可编辑文字；原透明度保留在工程。')
    const node: TextNode = { ...base(instance, frame), type: 'text', text: textOutputAdapter.text(data), runs,
      flipX: style.flipX, flipY: style.flipY !== frame.flipY,
      style: { ...style, fontSize: style.fontSize * frame.scaleY,
        lineSpacing: (style.lineSpacing ?? style.fontSize * ((style.lineHeight === 'normal' ? 1.22 : style.lineHeight) - 1.22)) * frame.scaleY,
        letterSpacing: style.letterSpacing * frame.scaleX, padding: style.padding * frame.scaleY,
        cornerRadius: style.cornerRadius * Math.min(frame.scaleX, frame.scaleY),
        overflow: data.sizing.mode === 'shrink-text' ? 'shrink' : data.sizing.mode === 'fixed' ? 'fixed' : 'auto-height',
      } }
    addPptxTextNode({ ...target, addImage: options => {
      target.addImage(options)
      warnings.push('文字的着重号或从左到右竖排由现有专业渲染器输出静态图面；其余文字保持可编辑，原文字与样式保留在工程中。')
    }, addText: (text, options) => target.addText(text, { ...options,
      line: style.borderWidth && style.borderOpacity ? { color: pptxColor(style.borderColor),
        width: style.borderWidth * frame.scaleY * 0.75, transparency: pptxTransparency(node.opacity * style.borderOpacity) }
        : options?.line,
    }) }, node, pixelScale)
    if (Math.abs(frame.scaleX - frame.scaleY) > 1e-7) warnings.push('PPTX 文字保留框和字号，横向非均匀缩放的字形比例无法原生表达。')
    if (data.sizing.overflow === 'clip') warnings.push('PPTX 原生文字不保留 CSS 裁切；超出框的文字仍可编辑。')
    return warnings
  }
  if (key === 'guoling.table') {
    const data = tableOutputAdapter.data(tableDataSchema.parse(instance.data))
    const native = toNativeTableData(data)
    const node = { ...native, style: { ...native.style, fontSize: native.style.fontSize * frame.scaleY,
      borderWidth: data.style.borderWidth * frame.scaleY, cellPadding: data.style.cellPadding * frame.scaleY },
      ...base(instance, frame), type: 'table' as const }
    const layout = buildNativeTableLayout(node, { width: node.width, height: node.height })
    const richRuns = (content: FlowTextContent): PptxGenJS.TextProps[] => content.inlines.map(inline => {
      const style = inline.style
      const textStyle = inline.type === 'text' ? inline.style : undefined
      if (inline.type === 'math') warnings.push('表格公式在 PPTX 中保留可编辑的替代说明文字；原公式保留在工程和 DOCX 的 OMML 中。')
      if (inline.type === 'text' && (style && ('baseline' in style || 'emphasis' in style))) warnings.push('表格文字的基线偏移与着重标记尚不映射到 PPTX。')
      if (textStyle?.highlightColor && pptxColorAlpha(textStyle.highlightColor) < 1) warnings.push('PPTX 原生表格文字高亮不支持透明色，保留高亮 RGB 与可编辑文字；原透明度保留在工程。')
      return { text: inline.type === 'text' ? inline.text : inline.accessibleText, options: {
        ...(style?.fontSize ? { fontSize: style.fontSize * frame.scaleY * 0.75 } : {}),
        ...(style?.color ? { color: pptxColor(style.color) } : {}),
        transparency: pptxTransparency(node.opacity * (style?.color ? pptxColorAlpha(style.color) : 1)),
        ...(inline.type === 'text' ? { ...(textStyle?.bold !== undefined ? { bold: textStyle.bold } : {}),
          ...(textStyle?.italic !== undefined ? { italic: textStyle.italic } : {}),
          ...(textStyle?.underline !== undefined ? { underline: { style: textStyle.underline ? 'sng' as const : 'none' as const } } : {}),
          ...(textStyle?.strike !== undefined ? { strike: textStyle.strike } : {}),
          ...(textStyle?.highlightColor ? { highlight: pptxColor(textStyle.highlightColor) } : {}),
          ...(textStyle?.fontFamily ? { fontFace: textStyle.fontFamily } : inline.code ? { fontFace: 'Consolas' } : {}) } : {}),
        ...(inline.link ? { hyperlink: { url: inline.link.href, ...(inline.link.title ? { tooltip: inline.link.title } : {}) } } : {}),
      } }
    })
    // The native mapper remains the sole owner of merge geometry and effective cell
    // styles; replace only its disposable text payload with formal rich content.
    warnings.push(...addPptxTableNode({ ...target, addTable: (rows, options) => target.addTable(rows.map((row, ri) => row.map((cell, ci) => {
      const owner = layout.rows[ri]!.cells[ci]!
      return { ...(typeof cell === 'object' ? cell : {}), text: richRuns(tableLayoutCellContent(data, owner)) }
    })), options) }, node, pixelScale))
    if (data.caption) target.addText(richRuns(data.caption), { x: frame.x / 96, y: (frame.y + frame.height) / 96,
      w: frame.width / 96, h: 0.4, fontFace: data.style.fontFamily, fontSize: data.style.fontSize * frame.scaleY * 0.75,
      color: pptxColor(data.style.textColor), align: 'center', margin: 0, objectName: `${instance.id} caption` })
    if (frame.flipY) warnings.push('PPTX 专业表格保留数据，不支持整体镜像。')
    return [...new Set(warnings)]
  }
  if (key === 'guoling.chart') {
    const data = chartDataSchema.parse(instance.data)
    const semantic = chartOutputAdapter.semantic(data)
    // The existing mapper owns axes, colors, horizontal order and editable OOXML.
    data.series.forEach((series, i) => series.points.forEach((point, j) => { point.value = semantic.series[i]!.values[j]! }))
    data.title = semantic.title; data.style.fontSize *= frame.scaleY
    warnings.push(...addPptxChartNode(target, { ...data, ...base(instance, frame), type: 'chart' }, pixelScale))
    if (frame.flipY) warnings.push('PPTX 专业图表保留数据，不支持整体镜像。')
    return warnings
  }
  if (key === 'guoling.shape') {
    const data = shapeDataSchema.parse(instance.data)
    // Keep professional paths/gradients through the existing DrawingML extension.
    const node: ShapeNode = { ...data, style: { ...data.style, borderWidth: data.style.borderWidth * frame.scaleY,
      cornerRadius: data.style.cornerRadius * Math.min(frame.scaleX, frame.scaleY) }, ...base(instance, frame), type: 'shape' }
    return addPptxShapeNode(reflectedTarget(target, frame.flipY), node, pixelScale, extensions)
  }
  const pos = { x: frame.x / 96, y: frame.y / 96, w: frame.width / 96, h: frame.height / 96,
    rotate: pptxRotation(frame.rotation), flipV: frame.flipY, objectName: instance.id,
    fontFace: 'Microsoft YaHei', fontSize: 18 * frame.scaleY * 0.75, margin: 0, valign: 'top' as const }
  let text: string
  if (key === 'guoling.input') {
    const data = inputDataSchema.parse(instance.data)
    text = `${data.label}\n${data.initialValue || data.placeholder || '________'}\n${data.submitLabel}`
  } else if (key === 'guoling.choice') {
    const data = choiceDataSchema.parse(instance.data)
    text = [data.label, ...data.options.map(option => `□ ${option.label}`)].join('\n')
  } else if (key === 'guoling.disclosure') {
    const data = disclosureDataSchema.parse(instance.data)
    text = data.label + (data.initiallyOpen ? `\n${data.content}` : '')
  } else if (key === 'guoling.popover') {
    text = popoverDataSchema.parse(instance.data).label
  } else return null
  target.addText(text, pos)
  return ['互动组件仅输出作者初态的可编辑文字，答题、提交、收展及临时运行状态不带入 PPTX。']
}

/** Display effects reuse the current image algorithm and CSS filter values. */
export async function drawImage(target: PptxDrawingTarget, instance: ComponentInstance, frame: Frame, assetUrl: string): Promise<void> {
  const data = imageDataSchema.parse(instance.data)
  if (!/^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(assetUrl)) throw new Error('图片需要可解码的内嵌资源')
  const image = new Image()
  if (typeof image.decode === 'function') { image.src = assetUrl; await image.decode() }
  else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片素材无法解码')); image.src = assetUrl })
  const local = instance.frame!
  const node: ImageNode = { ...data, ...base(instance, frame), type: 'image', preserveAspectRatio: data.fit !== 'stretch', safeAreas: [] }
  const canvas = renderImageNodeCanvas(image, image.naturalWidth, image.naturalHeight, node, local.width, local.height)
  const effects = data.filters
  let output = canvas
  if (effects.brightness !== 1 || effects.contrast !== 1 || effects.saturation !== 1 || effects.grayscale !== 0 || effects.blur !== 0) {
    output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height
    const ctx = output.getContext('2d')
    if (!ctx || !('filter' in ctx)) throw new Error('当前图片输出环境不支持作者滤镜，需实际运行捕获')
    ctx.filter = `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation}) grayscale(${effects.grayscale}) blur(${effects.blur}px)`
    ctx.drawImage(canvas, 0, 0)
  }
  target.addImage({ data: output.toDataURL('image/png'), x: frame.x / 96, y: frame.y / 96,
    w: frame.width / 96, h: frame.height / 96, rotate: pptxRotation(frame.rotation), flipV: frame.flipY,
    transparency: pptxTransparency(node.opacity), objectName: instance.id, altText: data.alt })
  canvas.width = canvas.height = 1
  if (output !== canvas) output.width = output.height = 1
}

export function drawContainerStyle(target: PptxDrawingTarget, instance: ComponentInstance, frame: Frame): string[] {
  const style = instance.style ?? {}
  const warnings: string[] = []
  const colorValue = typeof style.backgroundColor === 'string' ? style.backgroundColor : undefined
  const validColor = (value: string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
  const color = colorValue && validColor(colorValue) ? colorValue : undefined
  if (colorValue && !color && colorValue !== 'transparent') warnings.push(`外框颜色 ${colorValue} 没有原生 PPTX 映射，未使用默认颜色替换。`)
  const borderValue = typeof style.borderColor === 'string' ? style.borderColor : '#000000'
  const border = validColor(borderValue) ? borderValue : undefined
  if (!border && style.borderWidth) warnings.push(`外框边框色 ${borderValue} 没有原生 PPTX 映射，未使用默认颜色替换。`)
  const widthValue = style.borderWidth ?? 0
  const borderWidth = typeof widthValue === 'number' ? widthValue : typeof widthValue === 'string' && /^\d+(?:\.\d+)?(?:px)?$/.test(widthValue) ? Number.parseFloat(widthValue) : 0
  if (widthValue && !borderWidth) warnings.push('此外框 CSS 边框宽度未表达。')
  if (color || borderWidth) target.addShape('rect', { x: frame.x / 96, y: frame.y / 96, w: frame.width / 96, h: frame.height / 96,
    rotate: pptxRotation(frame.rotation), fill: color ? { color: pptxColor(color), transparency: pptxTransparency(base(instance, frame).opacity) } : { type: 'none' },
    line: borderWidth && border ? { color: pptxColor(border), width: borderWidth * 0.75, transparency: pptxTransparency(base(instance, frame).opacity) } : { type: 'none' }, objectName: `${instance.id} background` })
  const represented = new Set(['backgroundColor', 'borderColor', 'borderWidth', 'opacity', 'transform', 'position', 'left', 'top', 'width', 'height', 'zIndex'])
  const missing = Object.keys(style).filter(key => !represented.has(key))
  if (missing.length) warnings.push(`PPTX 未表达这些外框 CSS：${missing.join('、')}；专业数据与作者样式仍保存在工程中。`)
  return warnings
}
