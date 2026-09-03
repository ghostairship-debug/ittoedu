import { describe, expect, it } from 'vitest'
import {
  FORMULA_SLOT,
  FormulaLinearParseError,
  formulaAstContainsSlot,
  formulaAstToAccessibleText,
  insertFormulaTemplate,
  parseFormulaLinear,
  serializeFormulaAst,
} from '@/shared/formulaLinear'
import { formulaAstSchema } from '@/shared/projectSchema'
import type { FormulaAstNode } from '@/shared/contracts/native-v1'

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

describe('restricted formula linear adapter', () => {
  it('parses ordinary Word-like input into semantic fraction, root, script, fence, row, token, and operator nodes', () => {
    expect(parseFormulaLinear('(\\sqrt[3]{x} / y_i^2) = 1')).toEqual(completeAst)
    expect(parseFormulaLinear('a/b + √(x+1)')).toEqual({
      type: 'row',
      children: [
        {
          type: 'fraction',
          numerator: { type: 'token', value: 'a' },
          denominator: { type: 'token', value: 'b' },
        },
        { type: 'operator', value: '+' },
        {
          type: 'root',
          radicand: {
            type: 'fenced',
            open: '(',
            close: ')',
            body: {
              type: 'row',
              children: [
                { type: 'token', value: 'x' },
                { type: 'operator', value: '+' },
                { type: 'token', value: '1' },
              ],
            },
          },
        },
      ],
    })
  })

  it('round-trips all seven AST kinds without silently flattening uncommon data', () => {
    const uncommonAst: FormulaAstNode = {
      type: 'row',
      children: [
        { type: 'token', value: 'a b{c}\\' },
        { type: 'operator', value: '/' },
        {
          type: 'fraction',
          numerator: {
            type: 'row',
            children: [{ type: 'token', value: '½' }],
          },
          denominator: completeAst,
        },
        {
          type: 'fenced',
          open: '⟨',
          close: '⟩',
          body: {
            type: 'script',
            base: {
              type: 'row',
              children: [{ type: 'token', value: 'z' }],
            },
            subscript: { type: 'token', value: 'n' },
          },
        },
      ],
    }

    const linear = serializeFormulaAst(uncommonAst)
    expect(linear).toContain('\\text{')
    expect(linear).toContain('\\operator{/}')
    expect(linear).toContain('\\row{')
    expect(linear).toContain('\\fenced{')
    expect(parseFormulaLinear(linear)).toEqual(uncommonAst)
  })

  it('supports readable templates, operator aliases, Greek letters, braces, and Unicode superscripts', () => {
    const examples: Array<[string, FormulaAstNode['type']]> = [
      ['\\frac{a}{b}', 'fraction'],
      ['\\sqrt{x}', 'root'],
      ['\\sqrt[n]{x}', 'root'],
      ['x^{2}', 'script'],
      ['x_{i}', 'script'],
      ['x_{i}^{2}', 'script'],
      ['(x)', 'fenced'],
      ['[x]', 'fenced'],
      ['\\{x\\}', 'fenced'],
      ['x²', 'script'],
    ]
    examples.forEach(([source, type]) => {
      expect(parseFormulaLinear(source).type).toBe(type)
    })
    expect(parseFormulaLinear('\\alpha <= \\beta \\times \\pi')).toEqual({
      type: 'row',
      children: [
        { type: 'token', value: 'α' },
        { type: 'operator', value: '≤' },
        { type: 'token', value: 'β' },
        { type: 'operator', value: '×' },
        { type: 'token', value: 'π' },
      ],
    })
  })

  it('rejects unknown, incomplete, unsafe shorthand, and over-limit structures explicitly', () => {
    expect(() => parseFormulaLinear('\\unknown{x}')).toThrow(FormulaLinearParseError)
    expect(() => parseFormulaLinear('\\frac{x}')).toThrow(/分母/)
    expect(() => parseFormulaLinear('(x+1')).toThrow(/\)/)
    expect(() => parseFormulaLinear('½')).toThrow(/竖式分数/)
    expect(() => parseFormulaLinear('/x')).toThrow(/分子/)

    const oversized = parseFormulaLinear(
      Array.from({ length: 129 }, (_, index) => `x${index}`).join(' '),
    )
    expect(formulaAstSchema.safeParse(oversized).success).toBe(false)
  })

  it('derives an accessible default while keeping slot detection independent', () => {
    expect(formulaAstToAccessibleText({
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
    })).toBe('x 的平方加二分之一')
    expect(formulaAstContainsSlot(parseFormulaLinear(`\\sqrt{${FORMULA_SLOT}}`))).toBe(true)
    expect(formulaAstContainsSlot(completeAst)).toBe(false)
  })

  it('inserts templates around selections and points to the next editable slot', () => {
    expect(insertFormulaTemplate('a+b', 0, 3, `\\frac{${FORMULA_SLOT}}{${FORMULA_SLOT}}`))
      .toEqual({
        value: `\\frac{a+b}{${FORMULA_SLOT}}`,
        selectionStart: 11,
        selectionEnd: 12,
      })
    expect(insertFormulaTemplate('x=', 2, 2, `\\sqrt{${FORMULA_SLOT}}`)).toEqual({
      value: `x=\\sqrt{${FORMULA_SLOT}}`,
      selectionStart: 8,
      selectionEnd: 9,
    })
    expect(insertFormulaTemplate(
      'x+1',
      0,
      3,
      `\\sqrt[${FORMULA_SLOT}]{${FORMULA_SLOT}}`,
      1,
    )).toEqual({
      value: `\\sqrt[${FORMULA_SLOT}]{x+1}`,
      selectionStart: 6,
      selectionEnd: 7,
    })
  })
})
