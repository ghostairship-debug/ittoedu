import { describe, expect, it } from 'vitest'
import type { FormulaAstNode } from '@/shared/contracts/native-v1'
import { parseMtefEquation } from '@/renderer/project/mtefEquation'
import { readEquationOle } from '@/renderer/project/pptxEquationImport'
import { parsePptxImport } from '@/renderer/project/pptxImport'
import { formulaAstToAccessibleText } from '@/shared/formulaLinear'
import { CANVAS_WIDTH } from '@/shared/constants'
import { equationNativeBytes, equationOleFixture, pptxEquationFixture } from '../fixtures/pptxEquation'
import equations from '../fixtures/pptxLegacyEquations.json'

const text = (ast: FormulaAstNode): string => {
  switch (ast.type) {
    case 'token': case 'operator': return ast.value
    case 'row': return ast.children.map(text).join('')
    case 'fraction': return `${text(ast.numerator)}/${text(ast.denominator)}`
    default: throw new Error('not used by the reference course')
  }
}
const char = (code: string) => [2, 0, 0x88, code.charCodeAt(0) & 255, code.charCodeAt(0) >> 8]
const line = (...content: number[]) => [1, 0, ...content, 0]
const mtef = (...content: number[]) => Uint8Array.from([5, 1, 0, 6, 9, 0, 0, ...content, 0])

describe('legacy Equation OLE import', () => {
  it.each(equations)('decodes reference $part on page $page without altering its expression', ({ hex, expected, part }) => {
    const result = readEquationOle(equationOleFixture(equationNativeBytes(hex)))
    expect(text(result.ast)).toBe(expected)
    const index = Number(/Object(\d+)/.exec(part)![1])
    expect(result.color).toBe(index >= 4 && index <= 6 ? '#0000ff' : index >= 12 && index <= 18 ? '#000000' : '#ff0000')
    expect(formulaAstToAccessibleText(result.ast).length).toBeGreaterThan(0)
  })

  it('maps subscript, superscript and both slots onto the preceding base', () => {
    for (const selector of [27, 28, 29]) {
      const ast = parseMtefEquation(mtef(...line(...char('x'), 3, 0, selector, 0, 0,
        ...(selector === 28 ? [1, 1] : line(...char('1'))),
        ...(selector === 27 ? [1, 1] : line(...char('2'))), 0))).ast
      expect(ast).toEqual({ type: 'script', base: { type: 'token', value: 'x' },
        ...(selector !== 28 ? { subscript: { type: 'token', value: '1' } } : {}),
        ...(selector !== 27 ? { superscript: { type: 'token', value: '2' } } : {}),
      })
    }
  })

  it('rejects truncated data, unsupported templates and corrupt native length', () => {
    expect(() => parseMtefEquation(mtef(...line(...char('1'))).slice(0, -2))).toThrow('截断')
    expect(() => parseMtefEquation(mtef(...line(3, 0, 37, 0, 0, ...line(...char('1')), 0)))).toThrow('模板 37')
    const native = equationNativeBytes(equations[0]!.hex)
    native[8] ^= 1
    expect(() => readEquationOle(equationOleFixture(native))).toThrow('长度不匹配')
  })

  it('imports a missing-progId placement as semantic Native content and reports layout normalization', async () => {
    const draft = await parsePptxImport(pptxEquationFixture())
    const formula = draft.slides[0]!.items.find(item => item.kind === 'native' && item.content.nativeType === 'formula')!
    expect(formula).toMatchObject({ label: '概率公式', content: { nativeType: 'formula', data: { ast: { type: 'fraction' }, style: { color: '#ff0000' } } } })
    expect(formula.frame.x).toBeCloseTo(7000000 * CANVAS_WIDTH / 12192000)
    expect(formula.frame.y).toBeCloseTo(4000000 * CANVAS_WIDTH / 12192000)
    expect(draft.assets).toHaveLength(0)
    expect(draft.issues).toEqual([expect.objectContaining({ page: 1, type: '公式排版' })])
  })

  it('reports external OLE relations without importing a formula', async () => {
    const draft = await parsePptxImport(pptxEquationFixture(undefined, true))
    expect(draft.slides[0]!.items.some(item => item.kind === 'native' && item.content.nativeType === 'formula')).toBe(false)
    expect(draft.issues).toEqual([expect.objectContaining({ page: 1, type: '旧版公式（OLE）', message: expect.stringContaining('指向外部') })])
  })
})
