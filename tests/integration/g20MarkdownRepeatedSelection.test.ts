import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import { captureMarkdownSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'

it('M05-T05 maps the second identical paragraph to its exact source span and the Gateway changes only that span', async () => {
  const source = '相同一句😀\n\n相同一句😀\n', replacement = '只改第二句😀'
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID() })
  if (parsed.status !== 'valid') throw new Error(`fixture did not parse: ${JSON.stringify(parsed.diagnostics)}`)
  const [first, second] = parsed.document.content.blocks
  expect(first?.type).toBe('paragraph'); expect(second?.type).toBe('paragraph')
  const select = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: '0',
    anchor: { blockId: second.id, slot: { kind: 'field', field: 'content' }, offset: 0, affinity: 'after' },
    head: { blockId: second.id, slot: { kind: 'field', field: 'content' }, offset: 5, affinity: 'before' } })
  expect(select).toEqual({ status: 'mapped', ranges: [{ from: source.lastIndexOf('相同一句😀'), to: source.lastIndexOf('相同一句😀') + 6, before: '相同一句😀' }] })
  if (select.status !== 'mapped') throw new Error('selected source span was not mapped')

  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), '重复.md')
  const capture = captureMarkdownSelection(session.read(), { mode: 'layout', source, revision: '0', label: '第二段', selection: null, ranges: select.ranges })
  const reference = selectionReference(capture, true)
  expect(reference.writable).toEqual([{ kind: 'markdown-range', from: select.ranges[0].from, to: select.ranges[0].to }])
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'second-paragraph', actor: 'agent', documents: [{ documentId: session.documentId, writable: reference.writable }] })
  const selected = await gateway.issueTarget('second-paragraph', session.documentId, reference.writable[0])
  const firstOccurrence = await gateway.issueTarget('second-paragraph', session.documentId, { kind: 'markdown-range', from: 0, to: 6 })
  expect(await gateway.execute('second-paragraph', 'wrong-occurrence', { name: 'text.replace', input: { target: firstOccurrence, content: '不得改第一段' } }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await gateway.execute('second-paragraph', 'exact-occurrence', { name: 'text.replace', input: { target: selected, content: replacement } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const changed = session.read()
  expect(changed.model).toMatchObject({ source: `相同一句😀\n\n${replacement}\n` })
  expect(changed.undoDepth).toBe(1)
  expect(new TextDecoder().decode(driver.serialize(changed.model))).toBe(`相同一句😀\n\n${replacement}\n`)
  for (const type of ['undo', 'redo'] as const) {
    const current = session.read()
    expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type } })).toMatchObject({ status: 'applied' })
    expect(session.read().model).toMatchObject({ source: type === 'undo' ? source : `相同一句😀\n\n${replacement}\n` })
  }
})

it('M05-T02 keeps a cross-line quote marker and CRLF when two mapped text ranges commit together', async () => {
  const source = '# 标题\r\n\r\n> 引用中文\r\n> 下一行\r\n\r\n后文 https://e.com\r\n'
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID() })
  if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
  const quote = parsed.document.content.blocks[1]
  if (quote?.type !== 'quote') throw new Error('fixture has no quote')
  const mapped = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: '0',
    anchor: { blockId: quote.id, slot: { kind: 'field', field: 'content' }, offset: 0, affinity: 'after' },
    head: { blockId: quote.id, slot: { kind: 'field', field: 'content' }, offset: 8, affinity: 'before' } })
  expect(mapped).toMatchObject({ status: 'mapped', ranges: [{ before: '引用中文' }, { before: '下一行' }] })
  if (mapped.status !== 'mapped') throw new Error('quote was not mapped')
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), '引用.md')
  const capture = captureMarkdownSelection(session.read(), { mode: 'layout', source, revision: '0', label: '跨行引用', selection: null, ranges: mapped.ranges })
  const reference = selectionReference(capture, true), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'quote', actor: 'agent', documents: [{ documentId: session.documentId, writable: reference.writable }] })
  const handles = await Promise.all(reference.writable.map(target => gateway.issueTarget('quote', session.documentId, target)))
  expect(await gateway.execute('quote', 'rewrite-quote', { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target: handles[0], content: '观察结果' } },
    { name: 'text.replace', input: { target: handles[1], content: '说明理由' } },
  ] } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const changed = session.read()
  expect(changed.model).toMatchObject({ source: '# 标题\r\n\r\n> 观察结果\r\n> 说明理由\r\n\r\n后文 https://e.com\r\n' })
  expect(changed.undoDepth).toBe(1)
  const reparsed = parseDocumentMarkdown((changed.model as { source: string }).source, { target: 'file', createId: () => randomUUID() })
  expect(reparsed.status).toBe('valid')
})
