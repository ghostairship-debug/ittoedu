// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentInputRecovery } from '../../src/main/workbench/DocumentInputRecovery'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import { HtmlTextDraftRecovery } from '../../src/renderer/documentFiles/html/htmlTextDraftRecovery'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('p4-html-input-')) throw new Error('Unexpected test directory')
  await fs.rm(root, { recursive: true, force: true })
} })
const source = '<p>first</p><p>second</p>'
function target(text = 'second'): HtmlSelectedTarget {
  const start = source.indexOf(text)
  return { report: { handle: text, kind: 'text', rawText: text, attributeName: null, domPath: [], sectionOrder: null,
    rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }, resolved: { handle: text, status: 'editable', locator: {
    documentId: 'original', epoch: 'epoch', revision: 1, bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: source.length },
    valueSpan: { start, end: start + text.length }, expectedRaw: text, attributeName: null,
  } } }
}
function owner(root: string, documentId = 'original', epoch = 'epoch'): DocumentSnapshot {
  return { documentId, epoch, revision: 1, model: { kind: 'text', source, resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: path.join(root, 'lesson.html'), version: 'v1', bindingVersion: 1 }, dirty: false, saving: false,
    recoverable: true, undoDepth: 0, redoDepth: 0 }
}
function api(storage: DocumentInputRecovery, value: DocumentSnapshot): Pick<DocumentHostAPI, 'readAuthoringDrafts' | 'writeAuthoringDrafts' | 'claimAuthoringDrafts'> {
  return { readAuthoringDrafts: () => storage.read(value), writeAuthoringDrafts: (_id, drafts) => storage.write(value, drafts),
    claimAuthoringDrafts: (_id, _epoch, records) => storage.claim(value, records) }
}

it('saves canonical HTML while retaining a conflicting text input, then finds it from the same directory in a new owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-html-input-')); roots.push(root)
  const original = owner(root), drafts = new HtmlTextDrafts(), changed = source.replace('second', 'external')
  drafts.change(target(), source, 'my unpublished input')
  drafts.reconcile(changed)
  const recovery = new HtmlTextDraftRecovery(drafts, original, api(new DocumentInputRecovery(root), original), vi.fn())
  expect(await recovery.prepare(changed, [], changed)).toEqual({ ready: true, source: changed })
  expect(drafts.read()[0]).toMatchObject({ value: 'my unpublished input', issue: expect.any(String) })
  recovery.dispose()
  const reopened = owner(root, 'fresh-document', 'fresh-epoch'), cold = new HtmlTextDrafts()
  const next = new HtmlTextDraftRecovery(cold, reopened, api(new DocumentInputRecovery(root), reopened), vi.fn())
  expect(await next.prepare(changed, [], changed)).toEqual({ ready: true, source: changed })
  expect(cold.read()[0]).toMatchObject({ original: 'second', value: 'my unpublished input' })
  cold.discard(cold.read()[0]!.id)
  await next.prepare(changed, [], changed)
  expect(await new DocumentInputRecovery(root).read(reopened)).toBeNull()
  next.dispose()
})

it('waits for the recovery ACK and keeps the input when that write fails, then retries the same preservation', async () => {
  const drafts = new HtmlTextDrafts(), changed = source.replace('second', 'external')
  drafts.change(target(), source, 'mine'); drafts.reconcile(changed)
  let finish!: () => void
  const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
  const recovery = new HtmlTextDraftRecovery(drafts, { documentId: 'doc', epoch: 'epoch' }, {
    readAuthoringDrafts: async () => null, writeAuthoringDrafts: write,
  }, vi.fn())
  let ready = false
  const preparing = recovery.prepare(changed, [], changed).then(value => { ready = value.ready; return value })
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
  expect(ready).toBe(false); expect(drafts.read()[0]?.value).toBe('mine')
  finish(); expect((await preparing).ready).toBe(true)
  drafts.changeRetained(drafts.read()[0]!.id, 'newer')
  write.mockRejectedValueOnce(new Error('temporary disk failure'))
  expect((await recovery.prepare(changed, [], changed)).ready).toBe(false)
  expect(drafts.read()[0]?.value).toBe('newer')
  expect((await recovery.prepare(changed, [], changed)).ready).toBe(true)
  recovery.dispose()
})

it('does not restore an already applied input as a new conflict and preserves an unrelated auxiliary record', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-html-input-')); roots.push(root)
  const value = owner(root), storage = new DocumentInputRecovery(root), drafts = new HtmlTextDrafts()
  const unrelated = { kind: 'source' as const, projectId: 'other', documentId: value.documentId, epoch: value.epoch, key: 'other-input', payload: { text: 'keep me' } }
  await storage.write(value, { advanced: [unrelated] })
  drafts.change(target(), source, 'already saved')
  const first = new HtmlTextDraftRecovery(drafts, value, api(storage, value), vi.fn())
  await first.persist(); first.dispose()
  const cold = new HtmlTextDrafts(), next = new HtmlTextDraftRecovery(cold, value, api(new DocumentInputRecovery(root), value), vi.fn())
  const current = source.replace('second', 'already saved')
  expect(await next.prepare(current, [], current)).toEqual({ ready: true, source: current })
  expect(cold.read()).toEqual([])
  expect((await storage.read(value))?.advanced).toEqual([unrelated])
  next.dispose()
})

it('keeps recovered alternatives and applies only a separate valid field', () => {
  const drafts = new HtmlTextDrafts(), start = source.indexOf('second')
  drafts.restore(['one', 'two'].map(value => ({ source, from: start, to: start + 6, original: 'second', value })))
  drafts.change(target('first'), source, 'valid')
  expect(drafts.prepare(source).ready).toBe(false)
  expect(drafts.prepare(source, [], true)).toEqual({ ready: true, source: '<p>valid</p><p>second</p>' })
  expect(drafts.read().filter(draft => draft.alternative).map(draft => draft.value)).toEqual(['one', 'two'])
})

it('retains a dynamic author input without copying the outer embedded HTML into recovery', async () => {
  const drafts = new HtmlTextDrafts(), record = { kind: 'text' as const, binding: { kind: 'dom' as const,
    path: [{ tag: 'p', index: 0 }], textIndex: 0, baseline: 'dynamic' }, overrides: {} }
  const dynamic: HtmlSelectedTarget = { report: { ...target().report, scriptCreated: true, rawText: 'dynamic', authoring: { authorKey: 'field', record } },
    resolved: { handle: 'field', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1,
      targetKind: 'text', elementSpan: { start: 0, end: 0 }, valueSpan: null, expectedRaw: 'dynamic', attributeName: null,
      authoring: { authorKey: 'field', record } } } }
  drafts.change(dynamic, '<script type="application/json">EMBEDDED_MEDIA</script>', 'my dynamic input')
  const write = vi.fn(async () => {})
  const recovery = new HtmlTextDraftRecovery(drafts, { documentId: 'doc', epoch: 'epoch' }, {
    readAuthoringDrafts: async () => null, writeAuthoringDrafts: write,
  }, vi.fn())
  await recovery.persist()
  const input = write.mock.calls[0] as unknown as [string, { advanced: Array<{ payload: { sources: string[]; drafts: Array<{ value: string }> } }> }]
  expect(input[1].advanced[0]?.payload.sources).toEqual([''])
  expect(input[1].advanced[0]?.payload.drafts[0]?.value).toBe('my dynamic input')
  recovery.dispose()
})
