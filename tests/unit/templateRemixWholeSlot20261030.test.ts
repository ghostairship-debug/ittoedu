import { describe, expect, it } from 'vitest'
import { replaceCourseRemixText } from '../../src/core/course/courseProductivityEdits'
import { documentTextContentSchema, type FlowTextContent } from '../../src/shared/document/content'

const plain = (content: FlowTextContent) => content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')

describe('an observed whole remix slot retains its exact text and formatting contract', () => {
  it('inherits the declared attributes when filling an empty uniformly styled slot', () => {
    const style = { fontSize: 24, bold: false, underline: true, highlightColor: null }
    const source: FlowTextContent = { inlines: [{ type: 'text', text: '', style }] }
    const before = structuredClone(source)
    expect(replaceCourseRemixText(source, '河畔市集').inlines).toEqual([{ type: 'text', text: '河畔市集', style }])
    expect(source).toEqual(before)
  })

  it('retains an unchanged empty slot and its declared formatting without normalizing it away', () => {
    const source: FlowTextContent = { inlines: [{ type: 'text', text: '', style: { fontSize: 24, italic: false } }] }
    const result = replaceCourseRemixText(source, '')
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
  })

  it('clears, serializes and refills a uniform slot without losing its declared inline attributes', () => {
    const attributes = { style: { fontSize: 24, bold: false, underline: true, highlightColor: null },
      code: true, link: { href: 'https://example.org/source', title: '来源' }, rangeIds: ['template-slot-range'] }
    const source: FlowTextContent = { inlines: [
      { type: 'text', text: '原槽位', ...structuredClone(attributes) },
      { type: 'text', text: '正文', ...structuredClone(attributes) },
    ] }
    const before = structuredClone(source)
    const cleared = replaceCourseRemixText(source, '')
    expect(cleared.inlines).toEqual([{ type: 'text', text: '', ...attributes }])
    const reopened = documentTextContentSchema.parse(JSON.parse(JSON.stringify(cleared)))
    const refilled = replaceCourseRemixText(reopened, '新的槽位正文')
    expect(refilled.inlines).toEqual([{ type: 'text', text: '新的槽位正文', ...attributes }])
    expect(cleared.inlines[0]!.style).not.toBe(source.inlines[0]!.style)
    expect(source).toEqual(before)
  })

  it('replaces a long uniformly styled slot without asking a bounded diff to infer a known whole range', () => {
    const style = { fontSize: 24, bold: false, underline: true, highlightColor: null }
    const source: FlowTextContent = { inlines: [{ type: 'text', text: '雨后周末市集', style }] }
    const before = structuredClone(source)
    const replacement = '河畔市集重新开张。' + '本段是确定性容量边界探针，文字必须保留，不能用隐藏或缩小字号伪装适配。'.repeat(60)
    const result = replaceCourseRemixText(source, replacement)
    expect(plain(result)).toBe(replacement)
    expect(result.inlines).toEqual([{ type: 'text', text: replacement, style }])
    expect(source).toEqual(before)
  })

  it('uses full code-point bounds for split identical attributes, combining marks and joined emoji', () => {
    const style = { italic: false, underline: true, highlightColor: null }
    const source: FlowTextContent = { inlines: [
      { type: 'text', text: '👨‍👩‍👧‍👦', style: { ...style } },
      { type: 'text', text: 'e\u0301原文', style: { ...style } },
    ] }
    const replacement = '🌧️e\u0301河畔周末'.repeat(120)
    const result = replaceCourseRemixText(source, replacement)
    expect(plain(result)).toBe(replacement)
    expect(result.inlines).toEqual([{ type: 'text', text: replacement, style }])
  })

  it('still refuses repeated mixed-format text when the surviving style is ambiguous', () => {
    const source: FlowTextContent = { inlines: [
      { type: 'text', text: '甲', style: { bold: true } },
      { type: 'text', text: '甲' },
    ] }
    const before = structuredClone(source)
    expect(() => replaceCourseRemixText(source, '甲')).toThrow('重复文字存在多个合法格式映射')
    expect(source).toEqual(before)
  })

  it('retains the existing complexity guard when a long repeated slot contains different local attributes', () => {
    const source: FlowTextContent = { inlines: [
      { type: 'text', text: '甲'.repeat(500) },
      { type: 'text', text: '甲', style: { bold: false, highlightColor: null } },
      { type: 'text', text: '甲'.repeat(500) },
    ] }
    const before = structuredClone(source)
    expect(() => replaceCourseRemixText(source, '甲'.repeat(1000))).toThrow('无法证明局部格式归属唯一')
    expect(source).toEqual(before)
  })

  it('preserves a distinctly formatted middle when separated edge changes have a unique mapping', () => {
    const source: FlowTextContent = { inlines: [
      { type: 'text', text: '旧头' },
      { type: 'text', text: '强调', style: { bold: true } },
      { type: 'text', text: '旧尾' },
    ] }
    expect(replaceCourseRemixText(source, '新头强调新尾').inlines).toEqual([
      { type: 'text', text: '新头' },
      { type: 'text', text: '强调', style: { bold: true } },
      { type: 'text', text: '新尾' },
    ])
  })
})
