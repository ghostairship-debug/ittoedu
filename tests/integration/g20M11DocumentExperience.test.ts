// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { prepareDocumentWindowClose } from '../../src/main/workbench/documentCloseCoordinator'
import { documentSaveLabel } from '../../src/renderer/lessonWorkspace/view/WorkspaceDocumentStatus'

const roots: string[] = [], views: DocumentFileSession[] = []
const readonlyFiles: string[] = []
afterEach(async () => {
  for (const view of views.splice(0)) view.dispose()
  for (const filename of readonlyFiles.splice(0)) await fs.chmod(filename, 0o666)
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-')); roots.push(root)
  const journal = path.join(root, 'journal'), h = createMarkdownTestHost(journal)
  const filename = path.join(root, 'notes.md'); await fs.writeFile(filename, 'A\nB\nC')
  const snapshot = await h.documents.open(filename)
  const edit = async (id: string, source: string) => {
    const s = await h.documents.read(id)
    await h.documents.dispatch({ documentId: id, epoch: s.epoch, baseRevision: s.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
  }
  return { ...h, root, journal, filename, id: snapshot.documentId, edit }
}

it('M11 projects real saving, failed and restored-draft facts; retry clears failure only after a real save', async () => {
  const h = await fixture(), labels: string[] = []
  h.documents.subscribe(event => { if (event.type === 'changed') labels.push(documentSaveLabel(event.snapshot)) })
  await h.edit(h.id, 'unsaved recovery')
  expect(documentSaveLabel(await h.documents.read(h.id))).toBe('未保存')
  await fs.writeFile(h.filename, 'external copy')
  await expect(h.documents.save(h.id)).rejects.toThrow()
  expect(labels).toContain('保存中'); expect(labels.at(-1)).toBe('保存失败')
  expect(await h.documents.read(h.id)).toMatchObject({ dirty: true, saving: false, saveError: expect.any(String), recovered: false })
  const restarted = createMarkdownTestHost(h.journal)
  const restored = await restarted.documents.restore(h.id)
  expect(documentSaveLabel(restored)).toBe('恢复稿 · 原文件未保存')
  expect(await fs.readFile(h.filename, 'utf8')).toBe('external copy')
  const saved = await restarted.documents.save(h.id, path.join(h.root, 'recovered.md'))
  expect(saved).toMatchObject({ dirty: false, recovered: false, saveError: null })
  expect(documentSaveLabel(saved)).toBe('已保存')
})

it('M11 automatically merges separate disk edits and resolves only overlapping locations without losing either side', async () => {
  const h = await fixture()
  const files = createLessonDocumentFiles({ documents: h.documents, recoveryDirectory: path.join(h.root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: h.filename }, { ...files, documents: h.documents }, h.id)
  views.push(session); await session.open()
  session.edit('Ax\nB\nC'); await session.drain()
  await fs.writeFile(h.filename, 'A\nB\nCy')
  await session.flush()
  await vi.waitFor(() => expect(session.getSnapshot().source).toBe('Ax\nB\nCy'))
  expect(session.getSnapshot().conflictHunks).toEqual([])
  expect(await session.flush()).toBe(true)
  expect(await fs.readFile(h.filename, 'utf8')).toBe('Ax\nB\nCy')
  session.edit('Ax local\nB teacher\nCy'); await session.drain()
  await fs.writeFile(h.filename, 'Ax disk\nB\nCy external')
  expect(await session.flush()).toBe(false)
  expect(session.getSnapshot().conflictHunks).toHaveLength(1)
  expect(session.getSnapshot().source).toContain('B teacher')
  await session.resolveConflictHunk(session.getSnapshot().conflictHunks[0]!.id, 'remote')
  expect(await fs.readFile(h.filename, 'utf8')).toBe('Ax disk\nB teacher\nCy external')
})

it('M11 multi-document exit preserves every live draft and identifies the exact failed save', async () => {
  const h = await fixture()
  const secondPath = path.join(h.root, 'second.md'); await fs.writeFile(secondPath, 'second base')
  const second = await h.documents.open(secondPath)
  const third = await h.documents.create({ kind: 'markdown', source: 'third draft', resources: { assets: {}, components: {} } }, 'third.md')
  await h.edit(h.id, 'first draft'); await h.edit(second.documentId, 'second draft')
  if (process.platform === 'win32') { readonlyFiles.push(secondPath); await fs.chmod(secondPath, 0o444) }
  else await fs.writeFile(secondPath, 'external second')
  const onBlocked = vi.fn(), save = vi.fn((id: string) => h.documents.save(id))
  await expect(prepareDocumentWindowClose({ list: () => h.host.registry.list(), drain: async () => {}, rendererDirty: async () => false,
    confirm: () => 'save', prepareRenderer: async () => true, save, onBlocked })).rejects.toThrow()
  expect(onBlocked).toHaveBeenCalledExactlyOnceWith(second.documentId, 'failed')
  expect(save.mock.calls.map(args => args[0])).toEqual([h.id, second.documentId])
  expect(h.host.registry.list()).toHaveLength(3)
  expect(await h.documents.read(second.documentId)).toMatchObject({ dirty: true, model: { source: 'second draft' } })
  if (process.platform === 'win32') expect((await h.documents.read(second.documentId)).saveError).toContain('EPERM')
  expect(await h.documents.read(third.documentId)).toMatchObject({ dirty: true, model: { source: 'third draft' } })
  expect(await fs.readFile(secondPath, 'utf8')).toBe(process.platform === 'win32' ? 'second base' : 'external second')
})
