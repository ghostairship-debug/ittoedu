// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'
import type { DocumentOperation } from '../../src/shared/workbench/document'
import { documentHostRequestSchema, type DocumentDispatchOptions } from '../../src/shared/workbench/desktop'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { sourceEditsFromChanges } from '../../src/shared/document/sourceMerge'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'

const roots: string[] = [], views: DocumentFileSession[] = []
afterEach(async () => {
  for (const view of views.splice(0)) view.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const keptBody = 'UNTOUCHED_DRAFT_BODY_'.repeat(16_000)
const field = (index: number, text: string): ComponentAuthorRecord => ({ kind: 'text', binding: {
  kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index }], textIndex: 0, baseline: text,
}, overrides: { text } })
const records = { first: field(0, 'First before'), second: field(1, 'Second before') }
const author = `<html><head></head><body><p>Static before</p><script type="application/json">${JSON.stringify(keptBody)}</script></body></html>`
const source = author.replace('<head>', `<head><script id="cw-html-authoring-records" type="application/json">${JSON.stringify({ version: 1, records })}</script><script id="cw-html-frame-bootstrap">window.oldBridge=true;</script>`)
  .replace('</body>', '<script id="cw-html-authoring-consumer">window.oldConsumer=true;</script></body>')
const dynamicTarget = (key: keyof typeof records): HtmlSelectedTarget => ({ report: {
  handle: key, kind: 'text', domPath: [], sectionOrder: null, rawText: records[key].overrides.text!, attributeName: null,
  rect: { x: 0, y: 0, width: 30, height: 10 }, scriptCreated: true, authoring: { authorKey: key, record: records[key] },
}, resolved: { handle: key, status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 0,
  bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: 0 }, valueSpan: null, attributeName: null,
  expectedRaw: records[key].overrides.text!, authoring: { authorKey: key, record: records[key] } } } })
const staticAt = source.indexOf('<p>Static before</p>') + 3
const staticTarget: HtmlSelectedTarget = { report: { handle: 'static', kind: 'text', domPath: [], sectionOrder: null,
  rawText: 'Static before', attributeName: null, rect: { x: 0, y: 0, width: 30, height: 10 }, scriptCreated: false },
resolved: { handle: 'static', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 0,
  bindingVersion: 1, targetKind: 'text', elementSpan: { start: staticAt - 3, end: staticAt + 17 },
  valueSpan: { start: staticAt, end: staticAt + 'Static before'.length }, attributeName: null, expectedRaw: 'Static before' } } }
const pending = () => {
  const drafts = new HtmlTextDrafts()
  drafts.change(dynamicTarget('first'), source, 'First after 中😀')
  drafts.change(dynamicTarget('second'), source, 'Second after')
  drafts.change(staticTarget, source, 'Static after & <value>')
  return drafts
}

it('saves unblurred static and dynamic HTML fields once with advisory ranges through the real strict dispatch and cold History', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-draft-hints-')); roots.push(root)
  const filename = path.join(root, 'lesson.html'), journal = path.join(root, 'journal')
  await fs.writeFile(filename, source)
  const h = createMarkdownTestHost(journal)
  const dispatch = vi.fn((operation: DocumentOperation, options?: DocumentDispatchOptions) => {
    const request = documentHostRequestSchema.parse({ type: 'dispatch', operation, ...options })
    if (request.type !== 'dispatch') throw new Error('Expected dispatch request')
    return h.documents.dispatch(request.operation, request.sourceChangeHints ? { sourceChangeHints: request.sourceChangeHints } : undefined)
  })
  const documents = { ...h.documents, dispatch }
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), validateTarget: async () => {}, documents })
  const ref = { kind: 'file' as const, path: filename }
  const view = new DocumentFileSession(ref, { ...files, documents }); views.push(view); await view.open()
  const drafts = pending(), hints: Array<{ from: number; to: number; inserted: number }> = []
  const prepared = drafts.prepare(source, hints)
  expect(prepared.ready).toBe(true)
  view.edit(prepared.source, undefined, hints)
  const originalFirst = { ...hints[0]! }; hints[0]!.from += 100
  expect(await view.flush()).toBe(true)
  expect(view.committedDocument).toMatchObject({ undoDepth: 1, dirty: false, model: { source: prepared.source } })
  expect(dispatch).toHaveBeenCalledOnce()
  expect(dispatch.mock.calls[0]![0]).not.toHaveProperty('textChanges')
  expect(dispatch.mock.calls[0]![0]).not.toHaveProperty('sourceChangeHints')
  expect(dispatch.mock.calls[0]![1]!.sourceChangeHints![0]).toEqual(originalFirst)
  expect(await fs.readFile(filename, 'utf8') === prepared.source).toBe(true)
  const documentId = view.documentId!
  const state = await createDocumentJournal({ directory: journal }).recover(documentId)
  const effect = state!.past[0]!.effects![0]!
  if (effect.kind !== 'source') throw new Error('Expected precise source facts')
  expect(effect.edits.length).toBeGreaterThan(1)
  expect(effect.edits.every(edit => !edit.removed.includes(keptBody) && !edit.text.includes(keptBody))).toBe(true)
  expect(state!.operations[0]).not.toHaveProperty('sourceChangeHints')
  await view.undo(); expect(view.getSnapshot().source === source).toBe(true)
  await view.redo(); expect(view.getSnapshot().source === prepared.source).toBe(true)
  view.dispose()
  const cold = createMarkdownTestHost(journal)
  const restored = await cold.documents.restore(documentId)
  expect(restored.documentId).toBe(documentId)
  expect(restored.undoDepth).toBe(1)
  expect(restored.model.kind === 'text' && restored.model.source === prepared.source).toBe(true)
  const kernel = cold.host.registry.get(documentId)
  for (const type of ['undo', 'redo'] as const) {
    const identity = kernel.readIdentity()
    expect((await kernel.execute({ documentId, epoch: identity.epoch, baseRevision: identity.revision,
      operationId: `cold-${type}`, actor: 'human', mutation: { type } })).status).toBe('applied')
    const model = kernel.read().model
    expect(model.kind === 'text' && model.source === (type === 'undo' ? source : prepared.source)).toBe(true)
  }
})

it('keeps later input after its save preparation ACK and emits a new provable range plan', () => {
  const drafts = pending(), firstHints: Array<{ from: number; to: number; inserted: number }> = []
  const first = drafts.prepare(source, firstHints)
  const retained = drafts.read().find(draft => draft.authoring?.authorKey === 'first')!
  drafts.changeRetained(retained.id, 'Typed after Save')
  drafts.reconcile(first.source)
  expect(drafts.read()).toHaveLength(1)
  const secondHints: Array<{ from: number; to: number; inserted: number }> = [], second = drafts.prepare(first.source, secondHints)
  expect(second.ready).toBe(true)
  expect(readHtmlAuthoringRecords(second.source).first.overrides.text).toBe('Typed after Save')
  expect(sourceEditsFromChanges(first.source, second.source, secondHints)).toBeDefined()
})

it('keeps every draft and sends no partial hint plan when one field conflicts', () => {
  const drafts = pending()
  const changed = patchHtmlAuthoringRecords(source, { ...records, second: { ...records.second,
    binding: { ...records.second.binding, textIndex: 2 } } })
  const hints: Array<{ from: number; to: number; inserted: number }> = []
  expect(drafts.prepare(changed, hints)).toEqual({ ready: false, source: changed })
  expect(drafts.read()).toHaveLength(3)
  expect(hints).toEqual([])
})
