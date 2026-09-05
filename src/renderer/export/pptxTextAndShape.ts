import type PptxGenJS from 'pptxgenjs'
import {
  isStrokeOnlyShapeType,
  type FormulaNode,
  type ShapeNode,
  type TextNode,
} from '../../shared/contracts/native-v1/types'
import { renderFormulaNodeCanvas } from '../../shared/formulaRenderer'
import { resolveNativeLinePoints } from '../../shared/nativeLineGeometry'
import {
  renderTextNodeCanvas,
  textNodeHasEmphasis,
} from '../../shared/textLayout'
import { rotateWorldPoint } from '../authoring/stageViewportTransform'
import { bytesToDataUrl } from './base64'
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

/**
 * Rotates each node-local point around the node's own center (matching the
 * authoring/canvas convention in `stageViewportTransform.rotateWorldPoint`),
 * then translates into unscaled absolute canvas coordinates. Shared by the
 * straight-line exporter and the elbow static-fallback exporter so both
 * honor authored rotation identically.
 */
function absoluteShapePoints(
  node: ShapeNode,
  localPoints: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  const center = { x: node.width / 2, y: node.height / 2 }
  return localPoints.map((point) => {
    const rotated = node.rotation === 0
      ? point
      : rotateWorldPoint(point, center, node.rotation)
    return { x: node.x + rotated.x, y: node.y + rotated.y }
  })
}

/**
 * Straight lines keep their authored endpoints by exporting a native PPTX
 * `line` connector positioned at the segment's own bounding box (not the
 * node's full frame). PptxGenJS's `line` preset geometry always runs local
 * (0,0) → (w,h) — the box's own top-left → bottom-right — before any flip,
 * and `beginArrowType`/`endArrowType` (start/end arrowheads) attach to those
 * two local ends. `flipH`/`flipV` each independently mirror which bbox
 * corner a local end lands on, so setting both from the authored start→end
 * direction reproduces the exact drawn orientation *and* keeps arrowheads on
 * the correct end for a segment drawn in any of the four diagonal
 * directions — not only the default top-left→bottom-right one. (The node
 * spec's own flipV-only formula gets the line's position right but can swap
 * which end an asymmetric arrowhead lands on when a line is drawn from its
 * bottom/right point toward its top/left point; using flipH too closes that
 * gap. Verified directly against pptxgenjs's XML writer, which applies
 * flipH/flipV to every shape's `<a:xfrm>` unconditionally, regardless of
 * preset geometry — see `node_modules/pptxgenjs/dist/pptxgen.cjs.js`,
 * `addShapeDefinition` and the `SLIDE_OBJECT_TYPES.text` slide-render case.)
 */
function addPptxStraightLine(
  slide: PptxSlide,
  node: ShapeNode,
  scale: CanvasScale,
): string[] {
  const localPoints = resolveNativeLinePoints(node.lineGeometry, node.width, node.height, 'line')
  const points = absoluteShapePoints(node, localPoints)
  const start = points[0]!
  const end = points[1]!
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  const flipH = start.x > end.x
  const flipV = start.y > end.y

  slide.addShape('line', {
    x: left * scale.x,
    y: top * scale.y,
    w: width * scale.x,
    h: height * scale.y,
    flipH,
    flipV,
    rotate: 0,
    objectName: pptxObjectName(node),
    fill: { type: 'none', transparency: 100 },
    line: shapeLine(node),
  })
  return []
}

function pptxElbowDashArray(node: ShapeNode): string {
  const width = Math.max(1, node.style.borderWidth)
  if (node.style.lineStyle === 'dashed') return `${Math.max(6, width * 3)} ${Math.max(4, width * 2)}`
  if (node.style.lineStyle === 'dotted') return `${Math.max(1, width)} ${Math.max(3, width * 1.8)}`
  return ''
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * PptxGenJS has no editable multi-segment connector, so an elbow polyline is
 * rasterized to a standalone SVG using the same point resolver the canvas
 * and Published renderers call, then embedded as a static image. Position
 * and dash style are preserved; arrowheads and further edits are not — the
 * returned warning is this function's `pptx-static-elbow` degradation
 * notice, not a silent shape substitution, and callers must surface it.
 */
function addPptxElbowArrowStaticFallback(
  slide: PptxSlide,
  node: ShapeNode,
  scale: CanvasScale,
): string[] {
  const localPoints = resolveNativeLinePoints(node.lineGeometry, node.width, node.height, 'elbow-arrow')
  const points = absoluteShapePoints(node, localPoints)
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const dashArray = pptxElbowDashArray(node)
  const polylinePoints = points
    .map((point) => `${point.x - left},${point.y - top}`)
    .join(' ')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" '
    + `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<polyline points="${polylinePoints}" fill="none" `
    + `stroke="${escapeSvgAttribute(node.style.borderColor)}" `
    + `stroke-opacity="${clamp(node.opacity * node.style.borderOpacity, 0, 1)}" `
    + `stroke-width="${Math.max(1, node.style.borderWidth)}" `
    + 'stroke-linejoin="round" stroke-linecap="round"'
    + (dashArray ? ` stroke-dasharray="${dashArray}"` : '')
    + '/></svg>'

  slide.addImage({
    data: bytesToDataUrl(new TextEncoder().encode(svg), 'image/svg+xml'),
    x: left * scale.x,
    y: top * scale.y,
    w: width * scale.x,
    h: height * scale.y,
    objectName: `${pptxObjectName(node)} · 静态折线`,
    altText: `${pptxObjectName(node)}（PPTX 静态折线后备）`,
  })
  return [
    `折线箭头“${pptxObjectName(node)}”在 PPTX 中没有原生可编辑连接线，已按 pptx-static-elbow `
    + '规则使用静态图片后备：折点位置与虚线样式保留，箭头样式与可编辑性不保留，如需精确调整请在 PowerPoint 中手动重绘。',
  ]
}

export function addPptxShapeNode(
  slide: PptxSlide,
  node: ShapeNode,
  scale: CanvasScale,
): string[] {
  if (node.shapeType === 'line') {
    return addPptxStraightLine(slide, node, scale)
  }
  if (node.shapeType === 'elbow-arrow') {
    return addPptxElbowArrowStaticFallback(slide, node, scale)
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

  slide.addShape(SHAPE_TYPE_MAP[node.shapeType], {
    ...geometry,
    rotate: pptxRotation(node.rotation + (rotateQuarterTurn ? 90 : 0)),
    objectName: pptxObjectName(node),
    fill: shapeFill(node),
    line: shapeLine(node),
    rectRadius: node.shapeType === 'rounded-rectangle'
      ? clamp(
          node.style.cornerRadius
            / Math.max(1, Math.min(node.width, node.height)),
          0,
          1,
        )
      : undefined,
  })
  return []
}
