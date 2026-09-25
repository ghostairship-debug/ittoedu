// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { plainDocumentText, type DocumentBlock } from '../../src/shared/document/content'
import { resolveFileDocumentImage } from '../../src/shared/document/fileImageReference'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import type { DocumentPoint, DocumentSlot } from '../../src/shared/document/ports'
import { captureMarkdownSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'

const originalSource = '# 保真检查\r\n\r\n- 列表保留\r\n  缩进续行 **重点** 和 [链接文](https://example.test/path?x=1&y=2)\r\n- 第二项\r\n\r\n> 引用内容\r\n> 保留说明\r\n\r\n| 名称 | 说明 |\r\n| --- | --- |\r\n| 第一 | 表格值 |\r\n\r\n重复短语\r\n\r\n重复短语\r\n\r\n![示意图](media/diagram.svg)\r\n'
const asset = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>')

type SelectionSlot = { blockId: string; slot: DocumentSlot; visible: string }
function bodySlot(blocks: DocumentBlock[], kind: string): SelectionSlot {
  if (kind === 'repeated-second') {
    const repeated = blocks.filter(block => block.type === 'paragraph' && plainDocumentText(block.content) === '重复短语')
    const block = repeated[1]
    if (!block || block.type !== 'paragraph') throw new Error('second repeated paragraph missing')
    return { blockId: block.id, slot: { kind: 'field', field: 'content' }, visible: plainDocumentText(block.content) }
  }
  const block = blocks.find(item => item.type === (kind === 'table' ? 'table' : kind === 'quote' ? 'quote' : 'list'))
  if (!block) throw new Error(`${kind} block missing`)
  if (block.type === 'table') {
    const row = block.rows[0], column = block.columns[1]
    return { blockId: block.id, slot: { kind: 'cell', rowId: row.id, columnId: column.id }, visible: plainDocumentText(row.cells[column.id]) }
  }
  if (block.type === 'quote') return { blockId: block.id, slot: { kind: 'field', field: 'content' }, visible: plainDocumentText(block.content) }
  if (block.type !== 'list') throw new Error(`${kind} is not a list`)
  return { blockId: block.id, slot: { kind: 'item', itemId: block.items[0].id }, visible: plainDocumentText(block.items[0].content) }
}

it('S06-T02 edits ordinary Markdown from layout selections without changing unselected markup, resources or CRLF', async () => {
  const driver = new MarkdownDriver()
  const loaded = driver.load(new TextEncoder().encode(originalSource))
  if (loaded.kind !== 'markdown') throw new Error('Markdown fixture did not load')
  loaded.resources.assets['media/diagram.svg'] = asset
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No save needed for a local body edit') } } })
  const session = await registry.create(loaded, '保真检查.md')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const originalResources = session.read().model.resources
  let expectedSource = originalSource
  const edits = [
    { id: 'list', kind: 'list', selected: '列表保留', replacement: '列表已改', before: '- 列表保留\r\n  缩进续行', after: '- 列表已改\r\n  缩进续行' },
    { id: 'quote', kind: 'quote', selected: '引用内容', replacement: '观察结论', before: '> 引用内容\r\n> 保留说明', after: '> 观察结论\r\n> 保留说明' },
    { id: 'emphasis', kind: 'list', selected: '重点', replacement: '要点', before: '**重点**', after: '**要点**' },
    { id: 'link', kind: 'list', selected: '链接文', replacement: '说明文', before: '[链接文](https://example.test/path?x=1&y=2)', after: '[说明文](https://example.test/path?x=1&y=2)' },
    { id: 'table', kind: 'table', selected: '表格值', replacement: '新表格值', before: '| 第一 | 表格值 |', after: '| 第一 | 新表格值 |' },
    { id: 'repeated-second', kind: 'repeated-second', selected: '重复短语', replacement: '只改第二段', before: '重复短语\r\n\r\n重复短语\r\n', after: '重复短语\r\n\r\n只改第二段\r\n' },
  ] as const

  for (const [index, edit] of edits.entries()) {
    const before = session.read()
    if (before.model.kind !== 'markdown') throw new Error('Session changed document kind')
    const parsed = parseDocumentMarkdown(before.model.source, { target: 'file', createId: () => randomUUID(), resolveImage: href => resolveFileDocumentImage('保真检查.md', href) })
    if (parsed.status !== 'valid') throw new Error(`Source invalid before ${edit.id}: ${JSON.stringify(parsed.diagnostics)}`)
    const selectedSlot = bodySlot(parsed.document.content.blocks, edit.kind)
    const utf16Offset = selectedSlot.visible.indexOf(edit.selected)
    if (utf16Offset < 0) throw new Error(`Selected text missing from ${edit.id} body slot`)
    const from = Array.from(selectedSlot.visible.slice(0, utf16Offset)).length
    const to = from + Array.from(edit.selected).length
    const anchor: DocumentPoint = { blockId: selectedSlot.blockId, slot: selectedSlot.slot, offset: from, affinity: 'after' }
    const head: DocumentPoint = { blockId: selectedSlot.blockId, slot: selectedSlot.slot, offset: to, affinity: 'before' }
    const selection = { kind: 'text' as const, revision: String(before.revision), anchor, head }
    const mapped = mapDocumentSelectionToSource(before.model.source, parsed.sourceMap, selection)
    expect(mapped.status, edit.id).toBe('mapped')
    if (mapped.status !== 'mapped') throw new Error(`Layout selection did not map: ${edit.id}`)
    expect(mapped.ranges.map(range => range.before), edit.id).toEqual([edit.selected])
    const capture = captureMarkdownSelection(before, { mode: 'layout', source: before.model.source, revision: String(before.revision), label: edit.id, selection, ranges: mapped.ranges })
    const reference = selectionReference(capture, true)
    expect(reference.writable, edit.id).toHaveLength(1)
    const runId = `s06-fidelity-${index}`
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: reference.writable }] })
    const target = await gateway.issueTarget(runId, session.documentId, reference.writable[0])
    expect(await gateway.execute(runId, `edit-${index}`, { name: 'text.replace', input: { target, content: edit.replacement } }), edit.id)
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })

    expect(expectedSource.includes(edit.before), edit.id).toBe(true)
    expectedSource = expectedSource.replace(edit.before, edit.after)
    const changed = session.read()
    expect(changed.model, edit.id).toMatchObject({ kind: 'markdown', source: expectedSource })
    expect(changed.model.resources, edit.id).toEqual(originalResources)
    expect(changed.undoDepth, edit.id).toBe(index + 1)
    expect(new TextDecoder().decode(driver.serialize(changed.model)), edit.id).toBe(expectedSource)
  }
  expect(session.read().model.resources.assets['media/diagram.svg']).toEqual(asset)
  expect(expectedSource).toContain('  缩进续行 **要点** 和 [说明文](https://example.test/path?x=1&y=2)')
  expect(expectedSource).toContain('![示意图](media/diagram.svg)\r\n')
})
