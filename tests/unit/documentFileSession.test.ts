// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFileSession, mergeDocumentSources } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'

const roots: string[] = [], views: DocumentFileSession[] = []
afterEach(async () => {
  for (const view of views.splice(0)) view.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(source = 'old\n\nnotes') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-main-session-')); roots.push(root)
  const filename = path.join(root, 'notes.md'); await fs.writeFile(filename, source)
  const ref = { kind: 'file' as const, path: filename }
  const journal = path.join(root, 'journal'), metadata = path.join(root, 'metadata')
  const { host, documents } = createMarkdownTestHost(journal)
  const files = createLessonDocumentFiles({ recoveryDirectory: metadata, validateTarget: async () => {}, documents })
  const port = { ...files, documents }, session = new DocumentFileSession(ref, port); views.push(session)
  await session.open()
  return { root, filename, ref, journal, metadata, host, documents, files, port, session }
}

describe('Markdown projection on the main document owner', () => {
  it('follows a renamed main binding without mutating an already frozen task reference or losing History', async () => {
    const f = await fixture()
    const originalRef = f.session.ref
    f.session.edit('教师未保存稿'); await f.session.drain()
    const id = f.session.documentId!
    const root = await f.host.files.registerRoot(f.root)
    const entries = (await f.host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })).entries
    const file = entries.find(entry => entry.status === 'accessible' && entry.name === 'notes.md')!
    if (file.status !== 'accessible') throw new Error('fixture')
    expect(await f.host.files.rename({ operationId: 'rename', workspaceId: root.workspaceId, sourceEntryId: file.entryId, name: '新名字.md' })).toMatchObject({ status: 'success' })
    expect(f.session.documentId).toBe(id)
    expect(f.session.ref).toEqual({ kind: 'file', path: path.join(f.root, '新名字.md') })
    expect(originalRef).toEqual(f.ref)
    await f.session.undo(); expect(f.session.getSnapshot().source).toBe('old\n\nnotes')
    await f.session.redo(); expect(await f.session.flush()).toBe(true)
    expect(await fs.readFile(path.join(f.root, '新名字.md'), 'utf8')).toBe('教师未保存稿')
    await expect(fs.stat(f.filename)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps IME local until complete and restores one host history with resources after renderer reconstruction', async () => {
    const f = await fixture()
    f.session.setComposing(true); f.session.edit('中文输入', 'typing')
    expect((await f.documents.list())[0]!.model).toMatchObject({ source: 'old\n\nnotes' })
    expect(await fs.readFile(f.filename, 'utf8')).toBe('old\n\nnotes')
    f.session.setComposing(false); expect(await f.session.drain()).toBe(true)
    expect((await f.documents.list())[0]).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '中文输入' } })
    f.session.prepareAttachments([{ relativePath: 'assets/image.png', bytes: new Uint8Array([0, 255, 1]) }])
    f.session.edit('中文输入\n![图](assets/image.png)')
    await f.session.drain()
    const committed = (await f.documents.list())[0]!
    expect(committed.undoDepth).toBe(2)
    f.session.dispose()
    const rebuilt = new DocumentFileSession(f.ref, f.port); views.push(rebuilt); await rebuilt.open()
    expect((await f.documents.list())[0]!.documentId).toBe(committed.documentId)
    expect(await rebuilt.readResource('assets/image.png')).toMatchObject({ bytes: new Uint8Array([0, 255, 1]) })
    await rebuilt.undo()
    expect(rebuilt.getSnapshot().source).toBe('中文输入')
    await expect(rebuilt.readResource('assets/image.png')).rejects.toThrow('未包含')
    await rebuilt.redo(); expect(await rebuilt.flush()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('中文输入\n![图](assets/image.png)')
    expect(await fs.readFile(path.join(f.root, 'assets/image.png'))).toEqual(Buffer.from([0, 255, 1]))
    expect(await rebuilt.close()).toBe(true)
    expect(await f.documents.list()).toEqual([])
  })

  it('keeps external overlapping edits explicit and adopts the selected merge through main without resetting history', async () => {
    const f = await fixture('第一段\n第二段\n第三段')
    f.session.edit('第一段本地\n第二段教师\n第三段'); await f.session.drain()
    await fs.writeFile(f.filename, '第一段磁盘\n第二段\n第三段磁盘')
    await vi.waitFor(() => expect(f.session.getSnapshot().conflictHunks).toHaveLength(1), { timeout: 3000 })
    expect(f.session.getSnapshot().source).toContain('第二段教师')
    expect(f.session.getSnapshot().source).toContain('第三段磁盘')
    expect(await f.session.flush()).toBe(false)
    await f.session.resolveConflictHunk(f.session.getSnapshot().conflictHunks[0]!.id, 'remote')
    expect(f.session.getSnapshot()).toMatchObject({ source: '第一段磁盘\n第二段教师\n第三段磁盘', conflict: null, dirty: false })
    expect((await f.documents.list())[0]!.undoDepth).toBe(2)
    await f.session.undo(); expect(f.session.getSnapshot().source).toBe('第一段本地\n第二段教师\n第三段')
    expect(mergeDocumentSources('A\nB', 'Ax\nB', 'A\nBy')).toBe('Ax\nBy')
  })

  it('preserves unsaved content and resources in the host journal without renderer recovery files', async () => {
    const f = await fixture('base')
    f.session.prepareAttachments([{ relativePath: 'images/a.png', bytes: new Uint8Array([1, 2, 3]) }])
    f.session.edit('![保留](images/a.png)')
    expect(await f.session.preserveAndClose()).toBe(true)
    expect(await fs.readFile(f.filename, 'utf8')).toBe('base')
    const restarted = createMarkdownTestHost(f.journal)
    const files = createLessonDocumentFiles({ recoveryDirectory: f.metadata, validateTarget: async () => {}, documents: restarted.documents })
    const view = new DocumentFileSession(f.ref, { ...files, documents: restarted.documents }); views.push(view)
    await view.open()
    expect(view.getSnapshot()).toMatchObject({ source: '![保留](images/a.png)', recovery: true, dirty: true })
    expect(await view.readResource('images/a.png')).toMatchObject({ bytes: new Uint8Array([1, 2, 3]) })
    await view.resolveConflict('recovery')
    expect(await fs.readFile(f.filename, 'utf8')).toBe('![保留](images/a.png)')
    expect(view.getSnapshot().dirty).toBe(false)
  })
})
