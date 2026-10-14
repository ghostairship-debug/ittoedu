import { describe, expect, it } from 'vitest'
import { documentTextLength, plainDocumentText, normalizeDocumentText } from '../../src/shared/document/content'
import { documentTextRanges, markDocumentRange, replaceDocumentText, remapDocumentRanges, projectDataTextRanges, remapDocumentData, documentReplacementEdits } from '../../src/shared/document/textInteraction'
import { serializeDocumentMarkdown, parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { inlineHtml, parseFlowHtml } from '../../src/shared/document/html'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
describe('formal body ranges and inline atoms', () => {
  it('maps before/inside edits, full replacement and deletion with Unicode positions', () => {
    const body = markDocumentRange({ inlines: [{ type: 'text', text: '😀甲' }, { type: 'text', text: '乙丙', style: { bold: true }, link: { href: 'https://example.com' } }, { type: 'math', formulaId: 'math', latex: 'x', accessibleText: 'x' }, { type: 'text', text: '丁' }] }, 2, 4, 'range')
    const before = replaceDocumentText(body, 0, 0, text('前'))
    expect(documentTextRanges(before).get('range')).toEqual({ from: 3, to: 5 })
    const inside = replaceDocumentText(before, 4, 4, text('新'))
    expect(documentTextRanges(inside).get('range')).toEqual({ from: 3, to: 6 })
    expect(inside.inlines.find(inline => inline.type === 'math')).toMatchObject({ formulaId: 'math' })
    expect(inside.inlines.some(inline => inline.type === 'text' && inline.text === '乙' && inline.style?.bold && inline.link?.href === 'https://example.com')).toBe(true)
    const all = replaceDocumentText(inside, 3, 6, text('改字'))
    expect(documentTextRanges(all).get('range')).toEqual({ from: 3, to: 5 })
    expect(documentTextRanges(replaceDocumentText(all, 3, 5, text(''))).has('range')).toBe(false)
  })
  it('keeps separated whole-source changes on the same semantic map', () => {
    const before = markDocumentRange(text('前甲乙丙后'), 1, 4, 'range')
    const next = remapDocumentRanges(before, text('新前甲乙改丙后尾'))
    expect(documentTextRanges(next).get('range')).toEqual({ from: 2, to: 6 })
  })
  it('consumes exact selection and actual projection facts for repeated text without a second inferred remap', () => {
    const before = markDocumentRange(text('甲甲甲'), 0, 1, 'range'), next = replaceDocumentText(before, 0, 1, text(''))
    const exact = remapDocumentData({ content: before }, { content: next }, { textEdits: [{ path: ['content'], edits: documentReplacementEdits(before, next, 0, 1) }] }) as { content: typeof next }
    expect(documentTextRanges(exact.content).has('range')).toBe(false)
    const projection = remapDocumentData({ content: before }, { content: next }, { rangeProjection: projectDataTextRanges({ content: next }) }) as { content: typeof next }
    expect(documentTextRanges(projection.content).has('range')).toBe(false)
    const inside = replaceDocumentText(markDocumentRange(text('甲甲甲'), 1, 2, 'middle'), 0, 0, text('甲'))
    expect(documentTextRanges((remapDocumentData({ content: markDocumentRange(text('甲甲甲'), 1, 2, 'middle') }, { content: inside }) as {content:typeof inside}).content).get('middle')).toEqual({from:2,to:3})
  })
  it('round trips range marks, inline references, links and formulas in source and HTML', () => {
    const content = normalizeDocumentText({ inlines: [{ type: 'text', text: '甲', rangeIds: ['note'], style: { bold: true }, link: { href: '#here' } }, { type: 'component', instanceId: 'answer', accessibleText: '填写答案' }, { type: 'math', formulaId: 'math', latex: 'x', accessibleText: 'x' }] })
    expect(documentTextLength(content)).toBe(3); expect(plainDocumentText(content)).toBe('甲填写答案x')
    const doc = { content: { blocks: [{ type: 'paragraph' as const, id: 'paragraph', content }] }, resources: emptyDocumentResources() }
    const source = serializeDocumentMarkdown(doc)
    const parsed = parseDocumentMarkdown(source, { createId: () => crypto.randomUUID() })
    expect(parsed.status).toBe('valid')
    if (parsed.status === 'valid') expect(parsed.document.content).toEqual(doc.content)
    const html = parseFlowHtml(`<p>${inlineHtml(content)}</p>`, { assets: {} })
    expect(html.blocks[0]).toMatchObject({ content: { inlines: [{ type: 'text', text: '甲', rangeIds: ['note'] }, { type: 'component', instanceId: 'answer', accessibleText: '填写答案' }, { type: 'math', latex: 'x' }] } })
  })
})
