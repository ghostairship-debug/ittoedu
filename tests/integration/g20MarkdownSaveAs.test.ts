// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'

const roots: string[] = []
const sessions: DocumentFileSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

it('M11 keeps a moved Markdown draft on Save As cancel and rebinds the same document only after a real save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-save-as-'))
  roots.push(root)
  const original = path.join(root, 'original.md')
  const moved = path.join(root, 'moved-externally.md')
  const destination = path.join(root, 'new-location.md')
  await fs.writeFile(original, 'Original source')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(original)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: original }, { ...files, documents }, opened.documentId)
  sessions.push(session)
  await session.open()
  session.edit('Teacher draft')
  expect(await session.drain()).toBe(true)
  await fs.rename(original, moved)
  await vi.waitFor(() => expect(session.getSnapshot().conflict).toBe('deleted'), { timeout: 4_000 })

  const dialog = vi.spyOn(documents, 'saveWithDialog').mockResolvedValueOnce(null)
    .mockImplementationOnce((documentId, saveAs) => {
      expect(documentId).toBe(opened.documentId)
      expect(saveAs).toBe(true)
      return host.saveToPath(documentId, destination)
    })
  expect(await session.saveAs()).toBe(false)
  expect(session.getSnapshot()).toMatchObject({ source: 'Teacher draft', dirty: true, conflict: 'deleted' })
  expect((await documents.read(opened.documentId)).binding).toMatchObject({ kind: 'file', path: original })
  expect(await fs.readFile(moved, 'utf8')).toBe('Original source')

  expect(await session.saveAs()).toBe(true)
  expect(dialog).toHaveBeenCalledTimes(2)
  expect(session.documentId).toBe(opened.documentId)
  expect(session.ref).toEqual({ kind: 'file', path: destination })
  expect(session.getSnapshot()).toMatchObject({ source: 'Teacher draft', dirty: false, conflict: null })
  expect(await fs.readFile(destination, 'utf8')).toBe('Teacher draft')
  expect(await fs.readFile(moved, 'utf8')).toBe('Original source')
  await expect(fs.stat(original)).rejects.toMatchObject({ code: 'ENOENT' })

  await session.undo()
  expect(session.getSnapshot().source).toBe('Original source')
  await session.redo()
  expect(session.getSnapshot().source).toBe('Teacher draft')
  expect(await session.flush()).toBe(true)
  expect(await fs.readFile(destination, 'utf8')).toBe('Teacher draft')
  session.dispose()
  await documents.close(opened.documentId)
  const reopened = await documents.open(destination)
  expect(reopened.documentId).not.toBe(opened.documentId)
  expect(reopened.model).toMatchObject({ kind: 'markdown', source: 'Teacher draft' })
})

it('M11 waits for an in-flight disk observation before rebinding Save As', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-save-as-race-'))
  roots.push(root)
  const original = path.join(root, 'original.md')
  const destination = path.join(root, 'new-location.md')
  await fs.writeFile(original, 'Original source')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(original)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: original }, { ...files, documents }, opened.documentId)
  sessions.push(session)
  await session.open()
  await fs.writeFile(original, 'External source')
  const realRead = documents.read.bind(documents)
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(documents, 'read').mockImplementationOnce(async documentId => {
    enter()
    await gate
    return realRead(documentId)
  })
  await entered
  vi.spyOn(documents, 'saveWithDialog').mockImplementation((documentId, saveAs) => {
    expect(saveAs).toBe(true)
    return host.saveToPath(documentId, destination)
  })
  let settled = false
  const save = session.saveAs().finally(() => { settled = true })
  try {
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(settled).toBe(false)
  } finally { release() }
  expect(await save).toBe(true)
  expect(session.getSnapshot()).toMatchObject({ source: 'Original source', conflict: null, error: null })
  expect(await fs.readFile(destination, 'utf8')).toBe('Original source')
  expect(await fs.readFile(original, 'utf8')).toBe('External source')
})

it('M11 finishes an already requested normal save before opening Save As', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-save-as-order-'))
  roots.push(root)
  const original = path.join(root, 'original.md')
  const destination = path.join(root, 'copy.md')
  await fs.writeFile(original, 'Original source')
  const { host, documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(original)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: original }, { ...files, documents }, opened.documentId)
  sessions.push(session)
  await session.open()
  session.edit('Teacher draft')
  expect(await session.drain()).toBe(true)
  const events: string[] = []
  const realRead = documents.read.bind(documents)
  const realSave = documents.save.bind(documents)
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(documents, 'read').mockImplementationOnce(async documentId => { enter(); await gate; return realRead(documentId) })
  vi.spyOn(documents, 'save').mockImplementation(async documentId => {
    events.push('normal-save')
    return realSave(documentId)
  })
  vi.spyOn(documents, 'saveWithDialog').mockImplementation((documentId, saveAs) => {
    expect(saveAs).toBe(true)
    events.push('save-dialog')
    return host.saveToPath(documentId, destination)
  })
  const flush = session.flush()
  await entered
  const saveAs = session.saveAs()
  expect(events).toEqual([])
  release()
  expect(await flush).toBe(true)
  expect(await saveAs).toBe(true)
  expect(events).toEqual(['normal-save', 'save-dialog'])
  expect(await fs.readFile(original, 'utf8')).toBe('Teacher draft')
  expect(await fs.readFile(destination, 'utf8')).toBe('Teacher draft')
})

it('M11 asks to resolve overlapping conflict hunks before Save As can commit a merged draft', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-save-as-conflict-'))
  roots.push(root)
  const original = path.join(root, 'original.md')
  await fs.writeFile(original, 'A\nB\nC')
  const { documents } = createMarkdownTestHost(path.join(root, 'journal'))
  const opened = await documents.open(original)
  const files = createLessonDocumentFiles({ documents, recoveryDirectory: path.join(root, 'metadata'), validateTarget: async () => {} })
  const session = new DocumentFileSession({ kind: 'file', path: original }, { ...files, documents }, opened.documentId)
  sessions.push(session)
  await session.open()
  session.edit('A local\nB\nC')
  expect(await session.drain()).toBe(true)
  await fs.writeFile(original, 'A remote\nB\nC remote')
  expect(await session.flush()).toBe(false)
  expect(session.getSnapshot().conflictHunks).toHaveLength(1)
  const before = await documents.read(opened.documentId)
  const source = session.getSnapshot().source
  const dialog = vi.spyOn(documents, 'saveWithDialog')
  expect(await session.saveAs()).toBe(false)
  expect(dialog).not.toHaveBeenCalled()
  expect((await documents.read(opened.documentId)).revision).toBe(before.revision)
  expect(session.getSnapshot()).toMatchObject({ source, conflictHunks: expect.any(Array) })
  expect(session.getSnapshot().conflictHunks).toHaveLength(1)
  expect(await fs.readFile(original, 'utf8')).toBe('A remote\nB\nC remote')
})
