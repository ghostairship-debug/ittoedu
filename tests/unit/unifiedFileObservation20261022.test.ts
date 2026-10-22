// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'

const roots: string[] = []
const views: DocumentFileSession[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const view of views.splice(0)) view.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(source = 'original') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-files-')); roots.push(root)
  const filename = path.join(root, 'notes.md')
  await fs.writeFile(filename, source)
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const files = createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'raw'), validateTarget: async () => {}, documents })
  return { root, filename, host, documents, files }
}

it('reuses a pristine open snapshot without a second read or immediate disk recapture', async () => {
  const f = await fixture()
  const read = vi.spyOn(f.documents, 'read'), observe = vi.spyOn(f.documents, 'observeFile')
  const view = new DocumentFileSession({ kind: 'file', path: f.filename }, { ...f.files, documents: f.documents }); views.push(view)
  await view.open(); view.setActive(false)
  expect(view.getSnapshot().source).toBe('original')
  expect(read).not.toHaveBeenCalled()
  expect(observe).not.toHaveBeenCalled()
})

it('reads the newer current document when a formal change races the open snapshot', async () => {
  const f = await fixture()
  const open = f.documents.open.bind(f.documents)
  vi.spyOn(f.documents, 'open').mockImplementation(async filename => {
    const snapshot = await open(filename)
    await f.documents.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
      operationId: 'edit-between-open-and-attach', baseRevision: snapshot.revision, actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: 'new ' } } })
    return snapshot
  })
  const read = vi.spyOn(f.documents, 'read')
  const view = new DocumentFileSession({ kind: 'file', path: f.filename }, { ...f.files, documents: f.documents }); views.push(view)
  await view.open(); view.setActive(false)
  expect(view.getSnapshot().source).toBe('new original')
  expect(read).toHaveBeenCalledTimes(1)
})

it('unchanged foreground observation does not reread source or dependencies and still detects a replaced attachment', async () => {
  const f = await fixture('![image](image.png)')
  const image = path.join(f.root, 'image.png'); await fs.writeFile(image, new Uint8Array([1, 2]))
  const snapshot = await f.documents.open(f.filename)
  if (snapshot.binding.kind !== 'file') throw new Error('Expected file binding')
  await f.documents.observeFile(snapshot.documentId, snapshot.binding.version)
  const read = vi.spyOn(fs, 'readFile')
  const unchanged = await f.documents.observeFile(snapshot.documentId, snapshot.binding.version)
  expect(unchanged.version).toBe(snapshot.binding.version)
  expect(unchanged.model).toBeNull()
  expect(read.mock.calls.filter(([filename]) => String(filename) === f.filename || String(filename) === image)).toEqual([])
  await fs.writeFile(image, new Uint8Array([3, 4, 5]))
  const changed = await f.documents.observeFile(snapshot.documentId, snapshot.binding.version)
  expect(changed.model).not.toBeNull()
  expect(Array.from(changed.model!.resources.assets['image.png']!)).toEqual([3, 4, 5])
})

it('keeps the unadopted remote model through repeated observations during composition', async () => {
  const f = await fixture()
  const view = new DocumentFileSession({ kind: 'file', path: f.filename }, { ...f.files, documents: f.documents }); views.push(view)
  await view.open(); view.setActive(false); view.setComposing(true)
  await fs.writeFile(f.filename, 'remote input')
  const initial = await f.documents.observeFile(view.documentId!)
  const observer = view as unknown as { observe(value: typeof initial): Promise<void> }
  await observer.observe(initial)
  const repeated = await f.documents.observeFile(view.documentId!, initial.version)
  expect(repeated.model?.kind === 'markdown' && repeated.model.source).toBe('remote input')
  await observer.observe(repeated)
  expect(view.getSnapshot().conflict).not.toBe('deleted')
  view.setComposing(false)
  await view.drain()
  expect(view.getSnapshot().source).toBe('remote input')
})

it('clears only a deleted-file conflict when the identical saved file reappears', async () => {
  const f = await fixture()
  const view = new DocumentFileSession({ kind: 'file', path: f.filename }, { ...f.files, documents: f.documents }); views.push(view)
  await view.open(); view.setActive(false)
  const moved = path.join(f.root, 'temporarily-moved.md')
  const observer = view as unknown as { observe(value: Awaited<ReturnType<typeof f.documents.observeFile>>): Promise<void> }
  await fs.rename(f.filename, moved)
  await observer.observe(await f.documents.observeFile(view.documentId!))
  expect(view.getSnapshot().conflict).toBe('deleted')
  await fs.rename(moved, f.filename)
  await observer.observe(await f.documents.observeFile(view.documentId!))
  expect(view.getSnapshot()).toMatchObject({ conflict: null, source: 'original', dirty: false })
  view.edit('teacher continues')
  expect(await view.flush()).toBe(true)
  expect(await fs.readFile(f.filename, 'utf8')).toBe('teacher continues')
})

it('lists cold recovery metadata without reading the journal model, then restores it on request', async () => {
  const f = await fixture()
  const snapshot = await f.documents.open(f.filename)
  await f.documents.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'retained-input',
    baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: 'edited ' } } })
  const cold = createMarkdownTestHost(path.join(f.root, 'journal'))
  const read = vi.spyOn(fs, 'readFile')
  const open = vi.spyOn(fs, 'open')
  const summaries = await cold.documents.recoverySummaries!()
  expect(summaries).toMatchObject([{ documentId: snapshot.documentId, name: 'notes.md', dirty: true }])
  expect(summaries[0]).not.toHaveProperty('model')
  expect(read.mock.calls.filter(([filename]) => String(filename).endsWith('.journal'))).toEqual([])
  expect(open.mock.calls.filter(([filename]) => String(filename).endsWith('.journal'))).toEqual([])
  const restored = await cold.documents.restore(snapshot.documentId)
  expect(restored.model.kind === 'markdown' && restored.model.source).toBe('edited original')
})
