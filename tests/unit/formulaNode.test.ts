import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFormulaNode } from '../../src/core/tools/nativeNodeFactories'
import { analyzeFormulaNodeLayout, renderFormulaNodeCanvas } from '../../src/shared/formulaRenderer'
import { formulaAstSchema } from '../../src/shared/contracts/native-v1/schema'
import type { FormulaAstNode } from '../../src/shared/contracts/native-v1'

const completeAst: FormulaAstNode = {
  type: 'row',
  children: [
    {
      type: 'fenced',
      open: '(',
      close: ')',
      body: {
        type: 'fraction',
        numerator: {
          type: 'root',
          index: { type: 'token', value: '3' },
          radicand: { type: 'token', value: 'x' },
        },
        denominator: {
          type: 'script',
          base: { type: 'token', value: 'y' },
          superscript: { type: 'token', value: '2' },
          subscript: { type: 'token', value: 'i' },
        },
      },
    },
    { type: 'operator', value: '=' },
    { type: 'token', value: '1' },
  ],
}

function measuringContext(): CanvasRenderingContext2D {
  return {
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 12),
    })),
  } as unknown as CanvasRenderingContext2D
}

function deterministicFormulaCanvasContext(): CanvasRenderingContext2D & {
  drawImage: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
  lineTo: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
} {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 14),
    })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D & {
    drawImage: ReturnType<typeof vi.fn>
    fillText: ReturnType<typeof vi.fn>
    lineTo: ReturnType<typeof vi.fn>
    stroke: ReturnType<typeof vi.fn>
  }
}


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('professional formula rendering', () => {
  it('accepts recursive minimum AST kinds, rejects an empty script and diagnoses clipped layout', () => {
    expect(formulaAstSchema.parse(completeAst)).toEqual(completeAst)
    expect(formulaAstSchema.safeParse({ type: 'script', base: { type: 'token', value: 'x' } }).success).toBe(false)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(measuringContext())
    const fitting = createFormulaNode({ width: 520, height: 210, ast: completeAst })
    const clipped = createFormulaNode({ width: 24, height: 24, ast: completeAst, style: { fontSize: 80 } })
    expect(analyzeFormulaNodeLayout(fitting)).toMatchObject({ overflowsWidth: false, overflowsHeight: false })
    expect(analyzeFormulaNodeLayout(clipped)).toMatchObject({ overflowsWidth: true, overflowsHeight: true })
  })
  it('draws recursive layout deterministically and exposes exact overflow metrics', () => {
    const context = deterministicFormulaCanvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const formula = createFormulaNode({
      width: 520,
      height: 210,
      ast: {
        type: 'row',
        children: [
          {
            type: 'fraction',
            numerator: { type: 'token', value: '1' },
            denominator: {
              type: 'root',
              radicand: { type: 'token', value: 'x' },
            },
          },
          { type: 'operator', value: '+' },
          {
            type: 'script',
            base: { type: 'token', value: 'y' },
            superscript: { type: 'token', value: '2' },
          },
        ],
      },
    })

    const rendered = renderFormulaNodeCanvas(formula, formula.width, formula.height, 2)
    const analysis = analyzeFormulaNodeLayout(formula)

    expect(rendered.canvas.width).toBe(formula.width * 2)
    expect(rendered.canvas.height).toBe(formula.height * 2)
    expect(rendered.contentWidth).toBeGreaterThan(0)
    expect(rendered.contentHeight).toBeGreaterThan(formula.style.fontSize)
    expect(analysis).toMatchObject({
      overflowsWidth: false,
      overflowsHeight: false,
    })
    expect(context.fillText).toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalled()
    expect(context.lineTo).toHaveBeenCalled()
  })
})
