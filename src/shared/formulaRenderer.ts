import type { FormulaAstNode, FormulaNode } from './contracts/native-v1/types'
import { BUNDLED_MATH_FONT_FAMILY } from './fonts/bundledFontFamilies'
import {
  resolveLayoutMeasureContext,
  type LayoutMeasureContext,
  type LayoutMeasurementMode,
} from './layoutMeasure'

export interface RenderedFormulaCanvas {
  canvas: HTMLCanvasElement
  width: number
  height: number
  contentWidth: number
  contentHeight: number
}

export interface FormulaNodeLayoutAnalysis {
  measurementMode: LayoutMeasurementMode
  requiredWidth: number
  requiredHeight: number
  availableWidth: number
  availableHeight: number
  overflowsWidth: boolean
  overflowsHeight: boolean
}

interface FormulaBox {
  width: number
  ascent: number
  descent: number
  draw(context: CanvasRenderingContext2D, x: number, baseline: number): void
}

/**
 * The bundled math family comes first so authoring shows what students see.
 *
 * `Cambria Math` ships with Windows, which is what teachers author on, while a
 * student on a tablet, a phone or a Mac has no math font at all and gets the
 * face this project embeds into the export. Leaving Cambria first therefore made
 * the authoring preview disagree with every delivered lesson by construction —
 * different glyph shapes, different advance widths, and so different line breaks
 * in the frozen canvas measurement. Naming the bundled family first makes the
 * editor, the Player, the PPTX rasterization and the PDF all measure against the
 * one face the export carries.
 *
 * The system math fonts stay on as fallbacks: they are what keeps a formula
 * legible on a host where the bundled face failed to load.
 */
const MATH_FONT_FAMILY =
  `"${BUNDLED_MATH_FONT_FAMILY}", "Cambria Math", "Times New Roman", serif`

function formulaPadding(fontSize: number): number {
  return Math.max(6, fontSize * 0.18)
}

function font(size: number, italic = false): string {
  return `${italic ? 'italic ' : ''}400 ${size}px ${MATH_FONT_FAMILY}`
}

function textBox(
  measure: LayoutMeasureContext,
  value: string,
  size: number,
  color: string,
  italic = false,
  horizontalPadding = 0,
): FormulaBox {
  measure.font = font(size, italic)
  const glyphWidth = Math.max(size * 0.22, measure.measureText(value).width)
  const width = glyphWidth + horizontalPadding * 2
  return {
    width,
    ascent: size * 0.8,
    descent: size * 0.22,
    draw(context, x, baseline) {
      context.font = font(size, italic)
      context.fillStyle = color
      context.textAlign = 'left'
      context.textBaseline = 'alphabetic'
      context.fillText(value, x + horizontalPadding, baseline)
    },
  }
}

function buildFormulaBox(
  measure: LayoutMeasureContext,
  ast: FormulaAstNode,
  size: number,
  color: string,
): FormulaBox {
  switch (ast.type) {
    case 'token':
      return textBox(
        measure,
        ast.value,
        size,
        color,
        /^[A-Za-z]+$/u.test(ast.value),
      )
    case 'operator':
      return textBox(measure, ast.value, size, color, false, size * 0.14)
    case 'row': {
      const children = ast.children.map((child) => (
        buildFormulaBox(measure, child, size, color)
      ))
      return {
        width: children.reduce((sum, child) => sum + child.width, 0),
        ascent: Math.max(...children.map((child) => child.ascent)),
        descent: Math.max(...children.map((child) => child.descent)),
        draw(context, x, baseline) {
          let cursor = x
          children.forEach((child) => {
            child.draw(context, cursor, baseline)
            cursor += child.width
          })
        },
      }
    }
    case 'fraction': {
      const childSize = Math.max(6, size * 0.72)
      const numerator = buildFormulaBox(measure, ast.numerator, childSize, color)
      const denominator = buildFormulaBox(measure, ast.denominator, childSize, color)
      const padding = size * 0.13
      const gap = Math.max(2, size * 0.1)
      const lineWidth = Math.max(1, size * 0.045)
      const barOffset = size * 0.12
      const width = Math.max(numerator.width, denominator.width) + padding * 2
      const ascent = barOffset + gap + numerator.ascent + numerator.descent
      const descent = Math.max(
        size * 0.22,
        gap + lineWidth + denominator.ascent + denominator.descent - barOffset,
      )
      return {
        width,
        ascent,
        descent,
        draw(context, x, baseline) {
          const barY = baseline - barOffset
          const numeratorBaseline = barY - gap - numerator.descent
          const denominatorBaseline = barY + gap + lineWidth + denominator.ascent
          numerator.draw(context, x + (width - numerator.width) / 2, numeratorBaseline)
          denominator.draw(context, x + (width - denominator.width) / 2, denominatorBaseline)
          context.save()
          context.beginPath()
          context.strokeStyle = color
          context.lineWidth = lineWidth
          context.moveTo(x, barY)
          context.lineTo(x + width, barY)
          context.stroke()
          context.restore()
        },
      }
    }
    case 'root': {
      const radicand = buildFormulaBox(measure, ast.radicand, size, color)
      const index = ast.index
        ? buildFormulaBox(measure, ast.index, Math.max(6, size * 0.48), color)
        : null
      const radicalWidth = size * 0.58
      const indexReserve = index ? Math.max(size * 0.2, index.width * 0.62) : 0
      const overlineGap = Math.max(2, size * 0.08)
      const lineWidth = Math.max(1, size * 0.045)
      const ascent = Math.max(
        radicand.ascent + overlineGap + lineWidth,
        size * 0.9,
        index ? radicand.ascent * 0.72 + index.ascent : 0,
      )
      const descent = Math.max(radicand.descent, size * 0.2)
      const width = indexReserve + radicalWidth + radicand.width + size * 0.06
      return {
        width,
        ascent,
        descent,
        draw(context, x, baseline) {
          const radicalX = x + indexReserve
          const bodyX = radicalX + radicalWidth
          const top = baseline - radicand.ascent - overlineGap
          const bottom = baseline + radicand.descent * 0.38
          if (index) {
            index.draw(
              context,
              x,
              baseline - radicand.ascent * 0.63,
            )
          }
          context.save()
          context.beginPath()
          context.strokeStyle = color
          context.lineWidth = lineWidth
          context.lineJoin = 'round'
          context.lineCap = 'round'
          context.moveTo(radicalX, baseline - size * 0.18)
          context.lineTo(radicalX + radicalWidth * 0.22, baseline - size * 0.02)
          context.lineTo(radicalX + radicalWidth * 0.43, bottom)
          context.lineTo(radicalX + radicalWidth * 0.7, top)
          context.lineTo(x + width, top)
          context.stroke()
          context.restore()
          radicand.draw(context, bodyX, baseline)
        },
      }
    }
    case 'script': {
      const base = buildFormulaBox(measure, ast.base, size, color)
      const scriptSize = Math.max(6, size * 0.62)
      const superscript = ast.superscript
        ? buildFormulaBox(measure, ast.superscript, scriptSize, color)
        : null
      const subscript = ast.subscript
        ? buildFormulaBox(measure, ast.subscript, scriptSize, color)
        : null
      const scriptWidth = Math.max(
        superscript?.width ?? 0,
        subscript?.width ?? 0,
      )
      const gap = scriptWidth > 0 ? Math.max(1, size * 0.04) : 0
      const superscriptBaselineOffset = size * 0.54
      const subscriptBaselineOffset = size * 0.42
      return {
        width: base.width + gap + scriptWidth,
        ascent: Math.max(
          base.ascent,
          superscript
            ? superscriptBaselineOffset + superscript.ascent
            : 0,
        ),
        descent: Math.max(
          base.descent,
          subscript
            ? subscriptBaselineOffset + subscript.descent
            : 0,
        ),
        draw(context, x, baseline) {
          base.draw(context, x, baseline)
          const scriptX = x + base.width + gap
          superscript?.draw(context, scriptX, baseline - superscriptBaselineOffset)
          subscript?.draw(context, scriptX, baseline + subscriptBaselineOffset)
        },
      }
    }
    case 'fenced': {
      const body = buildFormulaBox(measure, ast.body, size, color)
      const fenceSize = Math.max(size, (body.ascent + body.descent) * 1.02)
      const open = textBox(measure, ast.open, fenceSize, color)
      const close = textBox(measure, ast.close, fenceSize, color)
      return {
        width: open.width + body.width + close.width,
        ascent: Math.max(open.ascent, body.ascent, close.ascent),
        descent: Math.max(open.descent, body.descent, close.descent),
        draw(context, x, baseline) {
          open.draw(context, x, baseline)
          body.draw(context, x + open.width, baseline)
          close.draw(context, x + open.width + body.width, baseline)
        },
      }
    }
  }
}

function measureFormulaNode(node: FormulaNode): {
  box: FormulaBox
  measurementMode: LayoutMeasurementMode
} {
  const { context, mode } = resolveLayoutMeasureContext()
  return {
    box: buildFormulaBox(context, node.ast, node.style.fontSize, node.style.color),
    measurementMode: mode,
  }
}

/** Measures a FormulaNode with the exact AST layout used by every renderer. */
export function analyzeFormulaNodeLayout(
  node: FormulaNode,
  width = node.width,
  height = node.height,
): FormulaNodeLayoutAnalysis {
  const { box, measurementMode } = measureFormulaNode(node)
  const padding = formulaPadding(node.style.fontSize)
  const requiredWidth = box.width + padding * 2
  const requiredHeight = box.ascent + box.descent + padding * 2
  return {
    measurementMode,
    requiredWidth,
    requiredHeight,
    availableWidth: Math.max(0, width - padding * 2),
    availableHeight: Math.max(0, height - padding * 2),
    overflowsWidth: requiredWidth > width + 0.5,
    overflowsHeight: requiredHeight > height + 0.5,
  }
}

/**
 * Renders the semantic AST directly. The same function is used by the editor,
 * Player, thumbnails, HTML/PDF capture, and PPTX rasterization.
 */
export function renderFormulaNodeCanvas(
  node: FormulaNode,
  width = node.width,
  height = node.height,
  resolution = 1,
): RenderedFormulaCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * resolution))
  canvas.height = Math.max(1, Math.ceil(height * resolution))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建公式绘制画布')
  context.scale(resolution, resolution)
  context.imageSmoothingEnabled = true

  const box = buildFormulaBox(context, node.ast, node.style.fontSize, node.style.color)
  const contentHeight = box.ascent + box.descent
  const padding = formulaPadding(node.style.fontSize)
  const x = node.style.align === 'center'
    ? (width - box.width) / 2
    : node.style.align === 'right'
      ? width - padding - box.width
      : padding
  const baseline = (height - contentHeight) / 2 + box.ascent

  context.save()
  context.beginPath()
  context.rect(0, 0, width, height)
  context.clip()
  box.draw(context, x, baseline)
  context.restore()

  return {
    canvas,
    width,
    height,
    contentWidth: box.width,
    contentHeight,
  }
}
