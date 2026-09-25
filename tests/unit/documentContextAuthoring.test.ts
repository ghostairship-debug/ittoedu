import { describe, expect, it, vi } from 'vitest'
import { documentSourceEdits } from '../../src/shared/document/sourceMerge'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'

const ref = { kind: 'file' as const, path: '/workspace/lesson.md' }
const inlineFormula = '$x^2$' + '{cw:formulaId="formula" cw:accessibleText="x 的平方"}'
const source = `<!--cw:block {"id":"paragraph"}-->
阅读 [旧链接](https://example.com) 与 ${inlineFormula}。

<!--cw:block {"id":"list"}-->
- <!--cw:item {"id":"item-1"}-->第一项
- <!--cw:item {"id":"item-2"}-->第二项

<!--cw:block {"id":"table"}-->
| <!--cw:column {"id":"column-1"}-->列一 | <!--cw:column {"id":"column-2"}-->列二 |
| --- | --- |
| <!--cw:row {"id":"row-1"}-->甲 | 乙 |
`

describe('contextual document authoring contracts', () => {
  it('round trips links, inline LaTeX, list identities and table identities through the document model', () => {
    const parsed = parseDocumentMarkdown(source, { target: 'file', createId: kind => `generated-${kind}` })
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return

    const serialized = serializeDocumentMarkdown(parsed.document, 'file')
    const reopened = parseDocumentMarkdown(serialized, { target: 'file', createId: kind => `reopened-${kind}` })
    expect(reopened.status).toBe('valid')
    if (reopened.status !== 'valid') return
    expect(reopened.document.content).toEqual(parsed.document.content)

    const paragraph = reopened.document.content.blocks.find(block => block.id === 'paragraph')
    expect(paragraph).toMatchObject({ type: 'paragraph' })
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.content.inlines).toEqual(expect.arrayContaining([
        { type: 'text', text: '旧链接', link: { href: 'https://example.com' } },
        expect.objectContaining({ type: 'math', latex: 'x^2', formulaId: 'formula' }),
      ]))
    }
    const list = reopened.document.content.blocks.find(block => block.id === 'list')
    expect(list).toMatchObject({ type: 'list', items: [{ id: 'item-1' }, { id: 'item-2' }] })
    const table = reopened.document.content.blocks.find(block => block.id === 'table')
    expect(table).toMatchObject({ type: 'table', columns: [{ id: 'column-1' }, { id: 'column-2' }], rows: [{ id: 'row-1' }] })
  })

  it('applies a selected source range without damaging surrounding link, formula, list or table syntax', () => {
    const from = source.indexOf('旧链接')
    expect(from).toBeGreaterThan(0)
    const next = `${source.slice(0, from)}新链接${source.slice(from + '旧链接'.length)}`
    const edits = documentSourceEdits(source, next)
    expect(edits).toEqual([{ from, to: from + 1, text: '新' }])
    const parsed = parseDocumentMarkdown(next, { target: 'file', createId: kind => `edited-${kind}` })
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    const paragraph = parsed.document.content.blocks.find(block => block.id === 'paragraph')
    expect(paragraph).toMatchObject({ type: 'paragraph' })
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.content.inlines).toEqual(expect.arrayContaining([
        { type: 'text', text: '新链接', link: { href: 'https://example.com' } },
        expect.objectContaining({ type: 'math', latex: 'x^2', formulaId: 'formula' }),
      ]))
    }
    expect(parsed.document.content.blocks.map(block => block.id)).toEqual(['paragraph', 'list', 'table'])
  })

})
