import type PptxGenJS from 'pptxgenjs'
import {
  isStrokeOnlyShapeType,
  type FormulaNode,
  type ShapeNode,
  type TextNode,
} from '../../shared/contracts/native-v1/types'
import { renderFormulaNodeCanvas } from '../../shared/formulaRenderer'
import {
  renderTextNodeCanvas,
  textNodeHasEmphasis,
} from '../../shared/textLayout'
import {
  clamp,
  PIXELS_TO_POINTS,
  pptxColor,
  pptxFontFace,
  pptxNodePosition,
  pptxObjectName,
  pptxRotation,
  pptxTransparency,
  type CanvasScale,
  type PptxSlide,
} from './pptxShared'

interface ResolvedTextStyle {
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  highlightColor: string | null
}

function resolvedTextStyle(node: TextNode, index: number): ResolvedTextStyle {
  const resolved: ResolvedTextStyle = {
    color: node.style.color,
    bold: node.style.bold,
    italic: node.style.italic,
    underline: node.style.underline,
    strike: node.style.strike,
    highlightColor: node.style.highlightColor,
  }
  for (const run of node.runs) {
    if (index >= run.start && index < run.end) Object.assign(resolved, run.style)
  }
  return resolved
}

function textStyleKey(style: ResolvedTextStyle): string {
  return [
    style.color,
    style.bold ? '1' : '0',
    style.italic ? '1' : '0',
    style.underline ? '1' : '0',
    style.strike ? '1' : '0',
    style.highlightColor ?? '',
  ].join('|')
}

function pptxTextRuns(node: TextNode, fontSize: number): PptxGenJS.TextProps[] {
  const boundaries = new Set<number>([0, node.text.length])
  for (const run of node.runs) {
    boundaries.add(clamp(Math.floor(run.start), 0, node.text.length))
    boundaries.add(clamp(Math.floor(run.end), 0, node.text.length))
  }
  const ordered = [...boundaries].sort((left, right) => left - right)
  const segments: Array<{ text: string; style: ResolvedTextStyle }> = []
  for (let boundaryIndex = 0; boundaryIndex < ordered.length - 1; boundaryIndex += 1) {
    const start = ordered[boundaryIndex]
    const end = ordered[boundaryIndex + 1]
    if (end <= start) continue
    const style = resolvedTextStyle(node, start)
    const previous = segments.at(-1)
    const text = node.text.slice(start, end)
    if (previous && textStyleKey(previous.style) === textStyleKey(style)) previous.text += text
    else segments.push({ text, style })
  }
  if (segments.length === 0) {
    segments.push({ text: '', style: resolvedTextStyle(node, 0) })
  }

  return segments.map(({ text, style }) => ({
    text,
    options: {
      bold: style.bold,
      italic: style.italic,
      underline: style.underline ? { style: 'sng' } : undefined,
      strike: style.strike ? 'sngStrike' : undefined,
      color: pptxColor(style.color),
      highlight: style.highlightColor
        ? pptxColor(style.highlightColor, 'FFFF00')
        : undefined,
      fontFace: pptxFontFace(node.style.fontFamily),
      fontSize: fontSize * PIXELS_TO_POINTS,
      charSpacing: node.style.letterSpacing * PIXELS_TO_POINTS,
      transparency: pptxTransparency(node.opacity),
      lang: 'zh-CN',
    },
  }))
}

export function addPptxTextNode(
  slide: PptxSlide,
  node: TextNode,
  scale: CanvasScale,
): void {
  if (
    node.style.writingMode === 'vertical-lr' ||
    textNodeHasEmphasis(node)
  ) {
    // OOXML's East Asian vertical text flow is right-to-left. Preserve the
    // authored left-to-right column order as a deterministic image instead of
    // silently reversing it in PowerPoint. OOXML/PptxGenJS also has no run-level
    // East Asian emphasis-mark primitive, so only text nodes that visibly use
    // emphasis are rasterized; ordinary text remains editable.
    const rendered = renderTextNodeCanvas(node, node.width)
    slide.addImage({
      data: rendered.canvas.toDataURL('image/png'),
      x: node.x * scale.x,
      y: node.y * scale.y,
      w: rendered.width * scale.x,
      h: rendered.height * scale.y,
      rotate: pptxRotation(node.rotation),
      transparency: pptxTransparency(node.opacity),
      objectName: pptxObjectName(node),
    })
    return
  }
  const verticalRendered = node.style.writingMode === 'vertical-rl'
    ? renderTextNodeCanvas(node, node.width)
    : null
  const effectiveNode = verticalRendered
    ? {
        ...node,
        width: verticalRendered.width,
        height: verticalRendered.height,
      }
    : node
  const renderedFontSize = node.style.overflow === 'shrink'
    ? verticalRendered?.fontSize ??
      renderTextNodeCanvas(node, node.width).fontSize
    : node.style.fontSize
  const backgroundAlpha = node.opacity * node.style.backgroundOpacity
  const cornerRatio = Math.min(effectiveNode.width, effectiveNode.height) > 0
    ? clamp(
        node.style.cornerRadius /
          Math.min(effectiveNode.width, effectiveNode.height),
        0,
        1,
      )
    : 0

  slide.addText(pptxTextRuns(node, renderedFontSize), {
    ...pptxNodePosition(effectiveNode, scale),
    objectName: pptxObjectName(node),
    shape: node.style.cornerRadius > 0 ? 'roundRect' : 'rect',
    rectRadius: cornerRatio,
    rotate: pptxRotation(node.rotation),
    margin: node.style.padding * PIXELS_TO_POINTS,
    align: node.style.align,
    valign: node.style.verticalAlign,
    vert: node.style.writingMode === 'vertical-rl' ? 'eaVert' : 'horz',
    lineSpacing: (
      renderedFontSize * 1.22
      + node.style.lineSpacing
    ) * PIXELS_TO_POINTS,
    fill: backgroundAlpha > 0
      ? {
          color: pptxColor(node.style.backgroundColor, 'FFFFFF'),
          transparency: pptxTransparency(backgroundAlpha),
        }
      : { type: 'none', transparency: 100 },
    line: { type: 'none', transparency: 100 },
    fit: 'none',
    wrap: true,
    isTextBox: true,
  })
}

/**
 * PPTX has no dependable editable mapping for the recursive Native formula AST.
 * Export one transparent PNG so its authored geometry remains deterministic;
 * Formula ID and accessible text remain available as object metadata.
 */
export function addPptxFormulaNode(
  slide: PptxSlide,
  node: FormulaNode,
  scale: CanvasScale,
): void {
  const rendered = renderFormulaNodeCanvas(node, node.width, node.height, 2)
  slide.addImage({
    data: rendered.canvas.toDataURL('image/png'),
    ...pptxNodePosition(node, scale),
    rotate: pptxRotation(node.rotation),
    transparency: pptxTransparency(node.opacity),
    objectName: `${pptxObjectName(node)} · 静态公式`,
    altText: `${node.accessibleText}（公式 ID：${node.formulaId}）`,
  })
}

const SHAPE_TYPE_MAP: Record<
  ShapeNode['shapeType'],
  PptxGenJS.SHAPE_NAME
> = {
  rectangle: 'rect',
  'rounded-rectangle': 'roundRect',
  ellipse: 'ellipse',
  triangle: 'triangle',
  diamond: 'diamond',
  line: 'line',
  'arrow-left': 'leftArrow',
  'arrow-right': 'rightArrow',
  'arrow-up': 'upArrow',
  'arrow-down': 'downArrow',
  'arrow-left-right': 'leftRightArrow',
  'elbow-arrow': 'bentArrow',
  'brace-left': 'leftBrace',
  'brace-right': 'rightBrace',
  'brace-top': 'leftBrace',
  'brace-bottom': 'rightBrace',
  'brace-pair-horizontal': 'bracePair',
  'brace-pair-vertical': 'bracePair',
  'bracket-left': 'leftBracket',
  'bracket-right': 'rightBracket',
  'emphasis-dot': 'ellipse',
  'emphasis-triangle': 'triangle',
}

function arrowType(
  value: ShapeNode['style']['startArrow'],
): PptxGenJS.ShapeLineProps['beginArrowType'] {
  if (value === 'circle') return 'oval'
  return value
}

function shapeLine(node: ShapeNode): PptxGenJS.ShapeLineProps {
  if (
    node.style.borderWidth <= 0
    || node.style.borderOpacity <= 0
    || node.opacity <= 0
  ) {
    return { type: 'none', transparency: 100 }
  }
  return {
    color: pptxColor(node.style.borderColor),
    transparency: pptxTransparency(node.opacity * node.style.borderOpacity),
    width: Math.max(0.1, node.style.borderWidth * PIXELS_TO_POINTS),
    dashType: node.style.lineStyle === 'dotted'
      ? 'sysDot'
      : node.style.lineStyle === 'dashed'
        ? 'dash'
        : 'solid',
    beginArrowType: arrowType(node.style.startArrow),
    endArrowType: arrowType(node.style.endArrow),
  }
}

function shapeFill(node: ShapeNode): PptxGenJS.ShapeFillProps {
  if (
    isStrokeOnlyShapeType(node.shapeType)
    || node.style.fillOpacity <= 0
    || node.opacity <= 0
  ) {
    return { type: 'none', transparency: 100 }
  }
  return {
    color: pptxColor(node.style.fillColor),
    transparency: pptxTransparency(node.opacity * node.style.fillOpacity),
  }
}

export function addPptxShapeNode(
  slide: PptxSlide,
  node: ShapeNode,
  scale: CanvasScale,
): void {
  if (node.shapeType === 'line') {
    slide.addShape('line', {
      x: node.x * scale.x,
      y: (node.y + node.height / 2) * scale.y,
      w: node.width * scale.x,
      h: 0,
      rotate: pptxRotation(node.rotation),
      objectName: pptxObjectName(node),
      fill: { type: 'none', transparency: 100 },
      line: shapeLine(node),
    })
    return
  }

  const rotateQuarterTurn = node.shapeType === 'brace-top'
    || node.shapeType === 'brace-bottom'
    || node.shapeType === 'brace-pair-vertical'
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  const geometry = rotateQuarterTurn
    ? {
        x: (centerX - node.height / 2) * scale.x,
        y: (centerY - node.width / 2) * scale.y,
        w: node.height * scale.x,
        h: node.width * scale.y,
      }
    : pptxNodePosition(node, scale)

  // PptxGenJS has no one-object elbow connector. bentArrow keeps this node
  // independently editable and is PowerPoint's closest built-in equivalent.
  const isElbow = node.shapeType === 'elbow-arrow'
  slide.addShape(SHAPE_TYPE_MAP[node.shapeType], {
    ...geometry,
    rotate: pptxRotation(node.rotation + (rotateQuarterTurn ? 90 : 0)),
    objectName: pptxObjectName(node),
    fill: isElbow
      ? {
          color: pptxColor(node.style.borderColor),
          transparency: pptxTransparency(
            node.opacity * node.style.borderOpacity,
          ),
        }
      : shapeFill(node),
    line: isElbow
      ? { type: 'none', transparency: 100 }
      : shapeLine(node),
    rectRadius: node.shapeType === 'rounded-rectangle'
      ? clamp(
          node.style.cornerRadius
            / Math.max(1, Math.min(node.width, node.height)),
          0,
          1,
        )
      : undefined,
  })
}
