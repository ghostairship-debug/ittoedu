import { describe, expect, it, vi } from 'vitest'
import { DocumentFileSession, type RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { documentSourceEdits } from '../../src/shared/document/sourceMerge'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import type { OpenDocumentResult } from '../../src/shared/document/ports'

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

function sessionFixture(initialSource = source) {
  let disk: OpenDocumentResult = { ref, source: initialSource, version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }
  const port: RecoverableDocumentFilePort = {
    openDocument: vi.fn(async () => disk),
    watchDocument: () => () => {},
    saveDocument: vi.fn(async request => {
      disk = { ...disk, source: request.source, version: { contentVersion: 'saved', attachments: [] } }
      return { status: 'saved' as const, operationId: request.operationId, version: disk.version }
    }),
    prepareAiEdit: vi.fn(async (_ref, ranges, epoch) => ({ status: 'ready' as const, document: disk, ranges, epoch })),
    applyAiEdit: vi.fn(async request => ({
      status: 'applied' as const,
      record: { id: request.operationId, ref, baseVersion: request.baseVersion, savedVersion: { contentVersion: 'ai-saved', attachments: [] }, applied: request.edits },
      conflicts: [],
    })),
    revertAiEdit: vi.fn(),
  }
  return { port, session: new DocumentFileSession(ref, port) }
}

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

  it('pins the prepared epoch, base version and exact ranges when applying a document edit', async () => {
    const { port, session } = sessionFixture()
    await session.open()
    const edit = { from: source.indexOf('旧'), to: source.indexOf('旧') + 1, before: '旧', after: '新' }
    const prepared = await session.prepareAiEdit([edit], 42)
    expect(prepared).toMatchObject({ status: 'ready', epoch: 42, ranges: [edit] })
    expect(port.prepareAiEdit).toHaveBeenCalledWith(ref, [edit], 42)

    const result = await session.applyAiEdit({ baseVersion: { contentVersion: 'v1', attachments: [] }, epoch: 42, operationId: 'operation-1', edits: [edit] })
    expect(result.status).toBe('applied')
    expect(port.applyAiEdit).toHaveBeenCalledWith(expect.objectContaining({ ref, baseVersion: { contentVersion: 'v1', attachments: [] }, epoch: 42, edits: [edit] }))
    expect(session.getSnapshot().aiRecords[0]).toMatchObject({ id: 'operation-1', applied: [edit] })
    session.dispose()
  })

  it('does not allow a stale prepared baseline to be treated as a current source range', async () => {
    const { port, session } = sessionFixture('新磁盘稿')
    await session.open()
    const prepared = await session.prepareAiEdit([{ from: 0, to: 1, before: '新', after: 'AI' }], 43)
    expect(prepared.status).toBe('ready')
    expect(port.prepareAiEdit).toHaveBeenCalledWith(ref, [{ from: 0, to: 1, before: '新', after: 'AI' }], 43)
    // The port is the canonical stale-version gate; the session must forward
    // its epoch and version without rewriting a selection into a full document.
    vi.mocked(port.applyAiEdit).mockResolvedValueOnce({ status: 'conflict', conflicts: [{ from: 0, to: 1, before: '新', after: 'AI' }] })
    const result = await session.applyAiEdit({ baseVersion: { contentVersion: 'old', attachments: [] }, epoch: 43, operationId: 'stale-operation', edits: [{ from: 0, to: 1, before: '新', after: 'AI' }] })
    expect(result.status).toBe('conflict')
    expect(port.applyAiEdit).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: { contentVersion: 'old', attachments: [] }, epoch: 43 }))
    expect(session.getSnapshot().source).toBe('新磁盘稿')
    session.dispose()
  })
})
