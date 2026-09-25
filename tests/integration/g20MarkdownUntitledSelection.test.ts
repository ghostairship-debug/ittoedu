import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import { captureMarkdownSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'

it('M05-T03 an unsaved Markdown input can be selected and changed through the Gateway before Save As', async () => {
  const driver = new MarkdownDriver(), saves: unknown[] = []
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) { saves.push(input); throw new Error('Save As must not be required') } } })
  const session = await registry.create(driver.load(new Uint8Array()), '未保存.md')
  const initial = session.read()
  expect(initial.binding.kind).toBe('untitled')
  expect(await session.execute({ documentId: initial.documentId, epoch: initial.epoch, operationId: randomUUID(), actor: 'human',
    baseRevision: initial.revision, mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: '先预测😀\n' } } }))
    .toMatchObject({ status: 'applied' })
  const typed = session.read()
  expect(typed.binding.kind).toBe('untitled')
  expect(typed.dirty).toBe(true)
  const source = typed.model.kind === 'markdown' ? typed.model.source : ''
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID() })
  if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
  const block = parsed.document.content.blocks[0]
  const mapped = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: String(typed.revision),
    anchor: { blockId: block.id, slot: { kind: 'field', field: 'content' }, offset: 0, affinity: 'after' },
    head: { blockId: block.id, slot: { kind: 'field', field: 'content' }, offset: 4, affinity: 'before' } })
  expect(mapped).toEqual({ status: 'mapped', ranges: [{ from: 0, to: 5, before: '先预测😀' }] })
  if (mapped.status !== 'mapped') throw new Error('new input was not mapped')
  const selection = captureMarkdownSelection(typed, { mode: 'layout', source, revision: String(typed.revision), label: '未保存正文', selection: null, ranges: mapped.ranges })
  const reference = selectionReference(selection, true), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'untitled', actor: 'agent', documents: [{ documentId: typed.documentId, writable: reference.writable }] })
  const handle = await gateway.issueTarget('untitled', typed.documentId, reference.writable[0])
  expect(await gateway.execute('untitled', 'replace-input', { name: 'text.replace', input: { target: handle, content: '先讨论😀' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const changed = session.read()
  expect(changed.model).toMatchObject({ source: '先讨论😀\n' })
  expect(changed.binding.kind).toBe('untitled')
  expect(changed.undoDepth).toBe(2)
  expect(saves).toHaveLength(0)
  expect(await session.execute({ documentId: changed.documentId, epoch: changed.epoch, operationId: randomUUID(), actor: 'human',
    baseRevision: changed.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(session.read().model).toMatchObject({ source: '先预测😀\n' })
})
