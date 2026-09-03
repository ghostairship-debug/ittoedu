import type { TextNode, TextRunStyle, WritingMode } from './contracts/native-v1/types'
import {
  resolveLayoutMeasureContext,
  type LayoutMeasureContext,
  type LayoutMeasurementMode,
} from './layoutMeasure'

export interface RenderedTextCanvas {
  canvas: HTMLCanvasElement
  width: number
  height: number
  fontSize: number
}

export interface TextNodeLayoutAnalysis {
  measurementMode: LayoutMeasurementMode
  fontSize: number
  requiredWidth: number
  requiredHeight: number
  availableWidth: number
  availableHeight: number
  overflowsWidth: boolean
  overflowsHeight: boolean
}

interface CharacterBox {
  value: string
  index: number
  width: number
  style: Required<TextRunStyle>
}

interface TextLine {
  characters: CharacterBox[]
  width: number
}

interface TextColumn {
  characters: CharacterBox[]
}

export function isVerticalWritingMode(
  writingMode: WritingMode,
): writingMode is 'vertical-rl' | 'vertical-lr' {
  return writingMode !== 'horizontal'
}

const DEFAULT_RUN_STYLE: Required<TextRunStyle> = {
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  emphasis: false,
  highlightColor: null,
  fontFamily: '',
  fontSize: 0,
}

function runStyle(node: TextNode, index: number): Required<TextRunStyle> {
  const base: Required<TextRunStyle> = {
    ...DEFAULT_RUN_STYLE,
    color: node.style.color,
    bold: node.style.bold,
    italic: node.style.italic,
    underline: node.style.underline,
    strike: node.style.strike,
    emphasis: node.style.emphasis,
    highlightColor: node.style.highlightColor,
    fontFamily: '',
    fontSize: 0,
  }
  for (const run of node.runs) {
    if (index >= run.start && index < run.end) Object.assign(base, run.style)
  }
  return base
}

function characterUsesEmphasis(character: CharacterBox): boolean {
  return character.style.emphasis && !/^\s$/u.test(character.value)
}

/** Whether this node needs a visual emphasis-mark surface (not merely a stored default). */
export function textNodeHasEmphasis(node: TextNode): boolean {
  return Array.from(node.text).some((value, index) => (
    !/^\s$/u.test(value) && runStyle(node, index).emphasis
  ))
}

function emphasisReserve(fontSize: number): number {
  return Math.max(3, fontSize * 0.28)
}

function font(node: TextNode, fontSize: number, style: Required<TextRunStyle>): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${fontSize}px ${node.style.fontFamily}`
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function layoutHorizontal(
  context: LayoutMeasureContext,
  node: TextNode,
  fontSize: number,
  availableWidth: number,
): TextLine[] {
  const lines: TextLine[] = []
  let line: TextLine = { characters: [], width: 0 }
  const push = () => {
    lines.push(line)
    line = { characters: [], width: 0 }
  }
  Array.from(node.text).forEach((value, index) => {
    if (value === '\n') {
      push()
      return
    }
    const style = runStyle(node, index)
    context.font = font(node, fontSize, style)
    const width = context.measureText(value).width + node.style.letterSpacing
    if (line.characters.length > 0 && line.width + width > availableWidth) push()
    line.characters.push({ value, index, width, style })
    line.width += width
  })
  if (line.characters.length > 0 || lines.length === 0 || node.text.endsWith('\n')) push()
  return lines
}

function horizontalLineHeight(
  node: TextNode,
  fontSize: number,
  line: TextLine,
): number {
  const lineHeight = fontSize * 1.22 + node.style.lineSpacing
  return lineHeight + (
    line.characters.some(characterUsesEmphasis) ? emphasisReserve(fontSize) : 0
  )
}

function horizontalContentHeight(
  node: TextNode,
  fontSize: number,
  lines: TextLine[],
): number {
  if (lines.length === 0) return fontSize * 1.22
  return lines.reduce(
    (height, line) => height + horizontalLineHeight(node, fontSize, line),
    0,
  ) - node.style.lineSpacing
}

function requiredHorizontalHeight(
  node: TextNode,
  fontSize: number,
  lines: TextLine[],
): number {
  return node.style.padding * 2 + horizontalContentHeight(node, fontSize, lines)
}

function layoutVertical(
  context: LayoutMeasureContext,
  node: TextNode,
  fontSize: number,
  availableHeight: number,
): TextColumn[] {
  const lineHeight = fontSize * 1.22 + node.style.lineSpacing
  const rows = Math.max(1, Math.floor(availableHeight / lineHeight))
  const columns: TextColumn[] = [{ characters: [] }]
  let row = 0
  Array.from(node.text).forEach((value, index) => {
    if (value === '\n') {
      columns.push({ characters: [] })
      row = 0
      return
    }
    if (row >= rows) {
      columns.push({ characters: [] })
      row = 0
    }
    const style = runStyle(node, index)
    context.font = font(node, fontSize, style)
    columns.at(-1)!.characters.push({
      value,
      index,
      width: context.measureText(value).width,
      style,
    })
    row += 1
  })
  return columns
}

function verticalCharacterWidth(node: TextNode, fontSize: number): number {
  return Math.max(1, fontSize + node.style.letterSpacing)
}

function verticalColumnWidth(
  node: TextNode,
  fontSize: number,
  column: TextColumn,
): number {
  return verticalCharacterWidth(node, fontSize) + (
    column.characters.some(characterUsesEmphasis) ? emphasisReserve(fontSize) : 0
  )
}

function requiredVerticalWidth(
  node: TextNode,
  fontSize: number,
  columns: TextColumn[],
): number {
  const contentWidth = columns.length > 0
    ? columns.reduce(
        (width, column) => width + verticalColumnWidth(node, fontSize, column),
        0,
      )
    : verticalCharacterWidth(node, fontSize)
  return node.style.padding * 2 + contentWidth
}

function drawEmphasisDot(
  context: CanvasRenderingContext2D,
  color: string,
  fontSize: number,
  x: number,
  y: number,
): void {
  context.beginPath()
  context.fillStyle = color
  context.arc(x, y, Math.max(1.2, fontSize * 0.06), 0, Math.PI * 2)
  context.fill()
}

function drawCharacter(
  context: CanvasRenderingContext2D,
  node: TextNode,
  character: CharacterBox,
  fontSize: number,
  x: number,
  baseline: number,
  height: number,
): void {
  const style = character.style
  context.font = font(node, fontSize, style)
  context.textBaseline = 'alphabetic'
  if (style.highlightColor) {
    context.fillStyle = style.highlightColor
    context.fillRect(x, baseline - fontSize, character.width, height)
  }
  context.fillStyle = style.color
  context.fillText(character.value, x, baseline)
  context.strokeStyle = style.color
  context.lineWidth = Math.max(1, fontSize / 18)
  if (style.underline) {
    context.beginPath()
    context.moveTo(x, baseline + fontSize * 0.1)
    context.lineTo(x + character.width - node.style.letterSpacing, baseline + fontSize * 0.1)
    context.stroke()
  }
  if (style.strike) {
    context.beginPath()
    context.moveTo(x, baseline - fontSize * 0.32)
    context.lineTo(x + character.width - node.style.letterSpacing, baseline - fontSize * 0.32)
    context.stroke()
  }
}

function fitFontSize(
  context: LayoutMeasureContext,
  node: TextNode,
  availableWidth: number,
  availableHeight: number,
): number {
  if (node.style.overflow !== 'shrink') return node.style.fontSize
  for (let size = node.style.fontSize; size >= 8; size -= 1) {
    if (isVerticalWritingMode(node.style.writingMode)) {
      const columns = layoutVertical(context, node, size, availableHeight)
      if (
        requiredVerticalWidth(node, size, columns)
          <= availableWidth + node.style.padding * 2
      ) {
        return size
      }
    } else {
      const lines = layoutHorizontal(context, node, size, availableWidth)
      if (requiredHorizontalHeight(node, size, lines) <= node.height) return size
    }
  }
  return 8
}

/** Uses the exact editor/Player wrapping model without drawing a visible frame. */
export function analyzeTextNodeLayout(
  node: TextNode,
  width = node.width,
): TextNodeLayoutAnalysis {
  const { context: measure, mode: measurementMode } = resolveLayoutMeasureContext()
  const padding = node.style.padding
  const availableWidth = Math.max(1, width - padding * 2)
  const availableHeight = Math.max(1, node.height - padding * 2)
  const fontSize = fitFontSize(measure, node, availableWidth, availableHeight)
  if (isVerticalWritingMode(node.style.writingMode)) {
    const columns = layoutVertical(measure, node, fontSize, availableHeight)
    const requiredWidth = requiredVerticalWidth(node, fontSize, columns)
    const lineHeight = fontSize * 1.22 + node.style.lineSpacing
    const longestColumn = Math.max(
      0,
      ...columns.map((column) => column.characters.length),
    )
    const requiredHeight = padding * 2 + Math.max(
      fontSize * 1.22,
      longestColumn * lineHeight - node.style.lineSpacing,
    )
    return {
      measurementMode,
      fontSize,
      requiredWidth,
      requiredHeight,
      availableWidth,
      availableHeight,
      overflowsWidth: requiredWidth > width + 0.5,
      overflowsHeight: requiredHeight > node.height + 0.5,
    }
  }

  const lines = layoutHorizontal(measure, node, fontSize, availableWidth)
  const requiredWidth = padding * 2 + Math.max(
    0,
    ...lines.map((line) => line.width),
  )
  const requiredHeight = requiredHorizontalHeight(node, fontSize, lines)
  return {
    measurementMode,
    fontSize,
    requiredWidth,
    requiredHeight,
    availableWidth,
    availableHeight,
    overflowsWidth: requiredWidth > width + 0.5,
    overflowsHeight: requiredHeight > node.height + 0.5,
  }
}

export function renderTextNodeCanvas(
  node: TextNode,
  width = node.width,
  resolution = 1,
): RenderedTextCanvas {
  const measureCanvas = document.createElement('canvas')
  const measure = measureCanvas.getContext('2d')
  if (!measure) throw new Error('无法创建文字排版画布')
  const padding = node.style.padding
  const availableWidth = Math.max(1, width - padding * 2)
  const availableHeight = Math.max(1, node.height - padding * 2)
  const fontSize = fitFontSize(measure, node, availableWidth, availableHeight)

  let outputWidth = width
  let outputHeight = node.height
  let lines: TextLine[] = []
  let columns: TextColumn[] = []
  if (node.style.writingMode === 'horizontal') {
    lines = layoutHorizontal(measure, node, fontSize, availableWidth)
    if (node.style.overflow === 'auto-height') {
      outputHeight = Math.max(16, requiredHorizontalHeight(node, fontSize, lines))
    }
  } else {
    columns = layoutVertical(measure, node, fontSize, availableHeight)
    if (node.style.overflow === 'auto-height') {
      outputWidth = Math.max(
        16,
        requiredVerticalWidth(node, fontSize, columns),
      )
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(outputWidth * resolution))
  canvas.height = Math.max(1, Math.ceil(outputHeight * resolution))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建文字绘制画布')
  context.scale(resolution, resolution)
  context.imageSmoothingEnabled = true
  if (node.style.backgroundOpacity > 0) {
    roundedRectPath(
      context,
      0,
      0,
      outputWidth,
      outputHeight,
      node.style.cornerRadius,
    )
    context.globalAlpha = node.style.backgroundOpacity
    context.fillStyle = node.style.backgroundColor
    context.fill()
    context.globalAlpha = 1
  }

  context.save()
  roundedRectPath(
    context,
    0,
    0,
    outputWidth,
    outputHeight,
    node.style.cornerRadius,
  )
  context.clip()

  if (isVerticalWritingMode(node.style.writingMode)) {
    const lineHeight = fontSize * 1.22 + node.style.lineSpacing
    let consumedColumnWidth = 0
    columns.forEach((column) => {
      const characterWidth = verticalCharacterWidth(node, fontSize)
      const columnWidth = verticalColumnWidth(node, fontSize, column)
      const contentHeight = Math.max(
        0,
        column.characters.length * lineHeight - node.style.lineSpacing,
      )
      const verticalOffset = node.style.verticalAlign === 'middle'
        ? Math.max(0, (outputHeight - padding * 2 - contentHeight) / 2)
        : node.style.verticalAlign === 'bottom'
          ? Math.max(0, outputHeight - padding * 2 - contentHeight)
          : 0
      column.characters.forEach((character, rowIndex) => {
        const columnLeft = node.style.writingMode === 'vertical-lr'
          ? padding + consumedColumnWidth
          : outputWidth - padding - consumedColumnWidth - columnWidth
        const x = columnLeft + (characterWidth - character.width) / 2
        const y = padding + verticalOffset + rowIndex * lineHeight + fontSize
        drawCharacter(
          context,
          node,
          character,
          fontSize,
          x,
          y,
          lineHeight,
        )
        if (characterUsesEmphasis(character)) {
          const radius = Math.max(1.2, fontSize * 0.06)
          drawEmphasisDot(
            context,
            character.style.color,
            fontSize,
            columnLeft + characterWidth + fontSize * 0.12 + radius,
            y - fontSize * 0.42,
          )
        }
      })
      consumedColumnWidth += columnWidth
    })
  } else {
    const lineHeight = fontSize * 1.22 + node.style.lineSpacing
    const contentHeight = horizontalContentHeight(node, fontSize, lines)
    const verticalOffset = node.style.verticalAlign === 'middle'
      ? Math.max(0, (outputHeight - padding * 2 - contentHeight) / 2)
      : node.style.verticalAlign === 'bottom'
        ? Math.max(0, outputHeight - padding * 2 - contentHeight)
        : 0
    let lineTop = padding + verticalOffset
    lines.forEach((line) => {
      const alignOffset = node.style.align === 'center'
        ? (availableWidth - line.width) / 2
        : node.style.align === 'right'
          ? availableWidth - line.width
          : 0
      let x = padding + Math.max(0, alignOffset)
      const baseline = lineTop + fontSize
      for (const character of line.characters) {
        drawCharacter(context, node, character, fontSize, x, baseline, lineHeight)
        if (characterUsesEmphasis(character)) {
          const glyphWidth = Math.max(
            0,
            character.width - node.style.letterSpacing,
          )
          const radius = Math.max(1.2, fontSize * 0.06)
          drawEmphasisDot(
            context,
            character.style.color,
            fontSize,
            x + glyphWidth / 2,
            baseline + fontSize * 0.23 + radius,
          )
        }
        x += character.width
      }
      lineTop += horizontalLineHeight(node, fontSize, line)
    })
  }
  context.restore()
  return { canvas, width: outputWidth, height: outputHeight, fontSize }
}
