// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import { HtmlTextDraftRecovery } from '../../src/renderer/documentFiles/html/htmlTextDraftRecovery'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('p4-html-host-')) throw new Error('Unexpected fixture path')
  await fs.rm(root, { recursive: true, force: true })
} })
const source = '<p>original text</p>'
function selected(documentId: string, epoch: string): HtmlSelectedTarget {
  return { report: { handle: 'field', kind: 'text', rawText: 'original text', domPath: [], sectionOrder: null, attributeName: null,
    rect: { x: 0, y: 0, width: 100, height: 20 }, scriptCreated: false }, resolved: { handle: 'field', status: 'editable', locator: {
    documentId, epoch, revision: 0, bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: source.length },
    valueSpan: { start: 3, end: source.length - 4 }, expectedRaw: 'original text', attributeName: null,
  } } }
}

it('preserves HTML input through the real Main ownership gate during a formal edit, then saves and finds it in a new Host from the original directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-html-host-')); roots.push(root)
  const directory = path.join(root, 'canonical'), filename = path.join(root, 'lesson.html')
  await fs.writeFile(filename, source)
  const first = createMarkdownTestHost(directory), snapshot = await first.documents.open(filename)
  if (snapshot.model.kind !== 'text') throw new Error('Expected HTML text document')
  const changed = '<p>current formal text</p>', drafts = new HtmlTextDrafts()
  drafts.change(selected(snapshot.documentId, snapshot.epoch), source, 'unapplied original input')
  const recovery = new HtmlTextDraftRecovery(drafts, snapshot, first.documents, () => {})
  const editing = first.documents.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'formal-current-edit',
    baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: changed, resources: snapshot.model.resources } } })
  const preparing = recovery.prepare(changed, [], changed)
  expect((await editing).status).toBe('applied')
  expect(await preparing).toEqual({ ready: true, source: changed })
  expect((await first.documents.readAuthoringDrafts(snapshot.documentId))?.advanced).toEqual([expect.objectContaining({
    kind: 'source', projectId: snapshot.documentId, documentId: snapshot.documentId, epoch: snapshot.epoch,
  })])
  await first.host.saveToPath(snapshot.documentId)
  recovery.dispose()
  await first.documents.close(snapshot.documentId)
  expect(await fs.readFile(filename, 'utf8')).toBe(changed)
  const second = createMarkdownTestHost(directory), cold = await second.documents.open(filename)
  expect(cold.documentId).not.toBe(snapshot.documentId)
  if (cold.model.kind !== 'text') throw new Error('Expected reopened HTML')
  const restored = new HtmlTextDrafts(), next = new HtmlTextDraftRecovery(restored, cold, second.documents, () => {})
  expect(await next.prepare(cold.model.source, [], cold.model.source)).toEqual({ ready: true, source: changed })
  expect(restored.read()[0]).toMatchObject({ original: 'original text', value: 'unapplied original input', issue: expect.any(String) })
  next.dispose(); await second.documents.close(cold.documentId)
})

it.each(['lesson.html', 'notes.md'])('accepts only the current source input owner for %s', async filename => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-html-host-')); roots.push(root)
  const file = path.join(root, filename)
  await fs.writeFile(file, source)
  const { documents } = createMarkdownTestHost(path.join(root, 'canonical')), snapshot = await documents.open(file)
  const record = { kind: 'source' as const, projectId: snapshot.documentId, documentId: snapshot.documentId,
    epoch: snapshot.epoch, key: 'source-input', payload: { value: 'keep this input' } }
  await expect(documents.writeAuthoringDrafts(snapshot.documentId, { advanced: [record] }, snapshot.epoch)).resolves.toBeUndefined()
  await expect(documents.writeAuthoringDrafts(snapshot.documentId, { advanced: [{ ...record, projectId: 'different-owner' }] }, snapshot.epoch)).rejects.toThrow('不属于当前文档')
  await expect(documents.writeAuthoringDrafts(snapshot.documentId, { advanced: [{ ...record, documentId: 'different-document' }] }, snapshot.epoch)).rejects.toThrow('不属于当前文档')
  await expect(documents.writeAuthoringDrafts(snapshot.documentId, { advanced: [record] }, 'stale-epoch')).rejects.toThrow('已关闭或重开')
  expect((await documents.readAuthoringDrafts(snapshot.documentId))?.advanced).toEqual([record])
  await documents.close(snapshot.documentId)
})
