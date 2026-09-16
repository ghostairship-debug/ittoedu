import { describe, expect, it } from 'vitest'
import { documentContentSchema, documentTextLength, normalizeDocumentText, plainDocumentText } from '../../src/shared/document/content'
import { documentObjectSchema, documentRelativePathSchema, validateDocumentResources } from '../../src/shared/document/resources'
import { sharedDocumentFixture, body } from '../fixtures/shared-document/content'

describe('shared document strict content', () => {
  it('accepts every carrier with real object fields', () => { const doc = sharedDocumentFixture(); expect(documentContentSchema.parse(doc.content)).toEqual(doc.content); expect(() => validateDocumentResources(doc.content.blocks, doc.resources, 'file')).not.toThrow() })
  it('projects math descriptions and uses code points, not UTF-16 offsets', () => {
    const content = { inlines: [{ type: 'text' as const, text: '甲😀' }, { type: 'math' as const, formulaId: 'f', latex: 'x', accessibleText: '未知数' }] }
    expect(documentTextLength(content)).toBe(3)
    expect(plainDocumentText(content)).toBe('甲😀未知数')
  })
  it('normalizes adjacent runs without mutating input or losing marks', () => {
    const content = { inlines: [{ type: 'text' as const, text: '甲', style: { bold: true, color: '#000000' } }, { type: 'text' as const, text: '乙', style: { color: '#000000', bold: true } }, { type: 'text' as const, text: '丙', code: true }] }
    expect(normalizeDocumentText(content).inlines).toHaveLength(2)
    expect(content.inlines[0]!.text).toBe('甲')
  })
  it.each([
    { id: 'p', type: 'paragraph', text: '旧文字' },
    { id: 'p', type: 'paragraph', content: { inlines: [], text: '多余字段' } },
    { id: 'p', type: 'formula', formulaId: 'f', accessibleText: 'x', ast: { type: 'symbol', value: 'x' } },
    { id: 'p', type: 'callout', tone: 'note', body: '旧字符串' },
    { id: 'p', type: 'section', title: '旧字符串', collapsedByDefault: false, blocks: [] },
    { id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'x', style: { css: 'display:none' } }] } },
  ])('rejects old or unknown content %j', block => expect(documentContentSchema.safeParse({ blocks: [block] }).success).toBe(false))
  it('rejects duplicate identities across nested blocks, inline math, and table slots', () => {
    const doc = sharedDocumentFixture().content
    doc.blocks.push({ id: 'title', type: 'paragraph', content: body('duplicate') })
    expect(documentContentSchema.safeParse(doc).success).toBe(false)
    doc.blocks.pop()
    doc.blocks.push({ id: 'other', type: 'formula', formulaId: 'inline-ohm', latex: 'x', accessibleText: 'x' })
    expect(documentContentSchema.safeParse(doc).success).toBe(false)
  })
  it('rejects hidden text in merged cells and invalid row structure', () => {
    const doc = sharedDocumentFixture().content
    const table = doc.blocks.find(b => b.id === 'merged-table')!
    if (table.type !== 'table') throw new Error('fixture')
    table.rows[0]!.cells['c-m2'] = body('不可隐藏')
    expect(documentContentSchema.safeParse(doc).success).toBe(false)
    table.rows[0]!.cells['c-m2'] = body('')
    table.rows[0]!.cells.extra = body('额外格')
    expect(documentContentSchema.safeParse(doc).success).toBe(false)
  })
  it('rejects missing, duplicate, extra and temporary resources', () => {
    const doc = sharedDocumentFixture()
    const block = doc.content.blocks.find(b => b.type === 'component')!
    expect(documentObjectSchema.safeParse({ kind: 'flow-block', block, resources: { assets: [], components: [] } }).success).toBe(false)
    expect(() => validateDocumentResources(doc.content.blocks, { ...doc.resources, assets: [...doc.resources.assets, doc.resources.assets[0]!] })).toThrow('重复')
    expect(() => validateDocumentResources(doc.content.blocks, { ...doc.resources, assets: [...doc.resources.assets, { assetId: 'unused', source: { kind: 'project' } }] })).toThrow('素材')
    doc.resources.assets[0]!.source = { kind: 'project' }
    expect(() => validateDocumentResources(doc.content.blocks, doc.resources, 'file')).toThrow('相对资源')
  })
  it.each(['../a.png', '/a.png', 'C:/a.png', 'a\\b.png', 'a/../b.png', 'a//b.png'])('rejects non-local resource paths %s', path => expect(documentRelativePathSchema.safeParse(path).success).toBe(false))
})
