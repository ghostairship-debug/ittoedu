import { serialize, deserialize } from 'node:v8'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'
import type { DurableDocumentState, DocumentOperation, DocumentPersistence } from '../../src/shared/workbench/document'
import type { HtmlPreviewEditContext } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { applyHtmlSourceEdit } from '../../src/main/workbench/htmlPreview/htmlSourceEdits'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords, extractHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { decorateHtmlFrameAuthoring } from '../../src/shared/html/htmlFrameAuthoring'
import { inspectHtmlSource, flattenHtmlSourceNodes } from '../../src/shared/html/htmlSourceStructure'
import { sourceEditsFromChanges } from '../../src/shared/document/sourceMerge'

const keptBody = 'UNTOUCHED_AUTHOR_BODY_'.repeat(32_000)
const authorSource = `<html><head></head><body><p>Original</p><script type="application/json">${JSON.stringify(keptBody)}</script></body></html>`
const record: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0 }], textIndex: 0, baseline: 'Original' }, overrides: { text: 'Before' } }
const legacySource = () => authorSource.replace('<head>', `<head><script id="cw-html-authoring-records" type="application/json">${JSON.stringify({ version: 1, records: { selected: record } })}</script><script id="cw-html-frame-bootstrap">window.oldBridge=true;</script>`)
  .replace('</body>', '<script id="cw-html-authoring-consumer">window.oldConsumer=true;</script></body>')

it('preserves the real wrapper patch execution facts across accepted effects, Undo/Redo and cold recovery', async () => {
  const source = legacySource(), driver = new TextDriver()
  let durable!: DurableDocumentState
  const persistence: DocumentPersistence = { async append(state) { durable = state }, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('Expected file binding')
    return input.binding
  } }
  const filename = path.resolve('output/known-source-ranges-virtual.html')
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: filename, version: 'original', bindingVersion: 1 }, saved: true }, driver, persistence)
  const execute = vi.fn((operation: DocumentOperation) => session.execute(operation))
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute, withFileAccess: work => work() })
  const context: HtmlPreviewEditContext = { lease: { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0, bindingVersion: 1, loadId: 'load', url: 'https://preview.invalid' },
    tabId: 'tab', entryRealPath: filename, rootRealPath: path.dirname(filename), bindingPath: filename, snapshot: session.read() }
  await service.resolveTarget({ type: 'html-preview.resolve-target', leaseId: 'lease', loadId: 'load', revision: 0,
    targets: [{ handle: 'dynamic', kind: 'text', domPath: [], sectionOrder: null, rawText: 'Before', attributeName: null,
      rect: { x: 0, y: 0, width: 20, height: 10 }, scriptCreated: true, authoring: { authorKey: 'selected', record } }] }, context)
  expect(await service.edit({ type: 'html-preview.edit', operationId: 'wrapper-text', documentId: 'doc', epoch: 'epoch', baseRevision: 0,
    bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'dynamic', change: { kind: 'text', value: 'After 中😀' } }, context)).toMatchObject({ status: 'applied' })
  const updated = (session.read().model as { source: string }).source
  expect(extractHtmlAuthoringRecords(updated).source).toBe(authorSource)
  expect(readHtmlAuthoringRecords(updated).selected.overrides.text).toBe('After 中😀')
  expect(execute.mock.calls[0]![0].textChanges!.source.length).toBeGreaterThan(3)
  const effect = durable.past[0]!.effects![0]!
  if (effect.kind !== 'source') throw new Error('Expected source facts')
  expect(effect.edits.length).toBeGreaterThan(1)
  expect(effect.edits.every(edit => !edit.removed.includes(keptBody) && !edit.text.includes(keptBody))).toBe(true)
  expect(effect.edits.reduce((sum, edit) => sum + edit.removed.length + edit.text.length, 0)).toBeLessThan(keptBody.length)
  const cold = await DocumentSession.restore(deserialize(serialize(durable)), 'cold', driver, persistence)
  expect(cold.read().model).toMatchObject({ source: updated })
  expect(await cold.execute({ documentId: 'doc', epoch: 'cold', baseRevision: 1, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(cold.read().model).toMatchObject({ source })
  expect(await cold.execute({ documentId: 'doc', epoch: 'cold', baseRevision: 2, operationId: 'redo', actor: 'human', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
  expect(cold.read().model).toMatchObject({ source: updated })
  for (const receipt of durable.operations) if (receipt.effect?.kind === 'source') {
    expect(receipt.effect.edits.every(edit => !edit.removed.includes(keptBody) && !edit.text.includes(keptBody))).toBe(true)
  }
})

it('reports the actual nested frame decoration ranges against the containing source', () => {
  const source = `<html><head><script id="cw-html-frame-bootstrap">old();</script></head><body>${keptBody}<iframe srcdoc="&lt;p&gt;Child&lt;/p&gt;"></iframe></body></html>`
  const changes: Array<{ from: number; to: number; inserted: number }> = []
  const updated = decorateHtmlFrameAuthoring(source, 'window.currentBridge=true;', {}, changes)
  const edits = sourceEditsFromChanges(source, updated, changes)!
  expect(edits).toBeDefined()
  expect(edits).toHaveLength(2)
  expect(edits.every(edit => !edit.text.includes(keptBody) && !source.slice(edit.from, edit.to).includes(keptBody))).toBe(true)
})

it('keeps each source batch stage in its executed coordinate system', () => {
  const source = `<html><body><p>First</p>${keptBody}<p>Second</p></body></html>`
  const nodes = flattenHtmlSourceNodes(inspectHtmlSource(source).roots)
  const first = nodes.find(node => node.kind === 'text' && node.value === 'First')!, second = nodes.find(node => node.kind === 'text' && node.value === 'Second')!
  const result = applyHtmlSourceEdit(source, { type: 'batch', commands: [
    { type: 'text', target: first.address!, text: 'First extended' }, { type: 'text', target: second.address!, text: '二😀' },
  ] })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const edits = sourceEditsFromChanges(source, result.source, result.changes)!
  expect(edits).toHaveLength(2)
  expect(edits.map(edit => source.slice(edit.from, edit.to))).toEqual(['First', 'Second'])
  expect(edits.map(edit => edit.text)).toEqual(['First extended', '二😀'])
})

it('leaves the ordinary string helper result unchanged when range capture is requested', () => {
  const source = legacySource(), records = { selected: { ...record, overrides: { text: 'Exact & <value>' } } }
  const changes: Array<{ from: number; to: number; inserted: number }> = []
  expect(patchHtmlAuthoringRecords(source, records, {}, changes)).toBe(patchHtmlAuthoringRecords(source, records))
  expect(changes.length).toBeGreaterThan(3)
})

