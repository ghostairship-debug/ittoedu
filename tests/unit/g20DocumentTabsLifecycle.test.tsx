import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { DocumentFileSession, type RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { useDocumentTabsController, type CourseDocumentsPort } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => { cleanup(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-tabs-')); roots.push(root)
  const h = createMarkdownTestHost(root)
  const unavailable = async (): Promise<never> => { throw new Error('Legacy file path must not be used for an untitled document') }
  const port: RecoverableDocumentFilePort = { documents: h.documents, openDocument: unavailable, saveDocument: unavailable, watchDocument: () => () => {},  }
  return { ...h, root, port }
}
it('M02 creates distinct untitled Markdown sessions and cancels first-save/close without disk IO or lost drafts', async () => {
  const h = await fixture()
  const snapshot = await h.documents.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, 'new.md')
  const observe = vi.spyOn(h.documents, 'observeFile')
  const save = vi.spyOn(h.documents, 'saveWithDialog').mockResolvedValue(null)
  h.documents.closeWithDialog = vi.fn(async () => false)
  const session = new DocumentFileSession({ kind: 'file', path: 'new.md' }, h.port, snapshot.documentId)
  await session.open(); session.edit('未保存中文 draft'); await session.drain()
  expect(observe).not.toHaveBeenCalled()
  expect(await session.flush()).toBe(false)
  expect(session.getSnapshot().source).toBe('未保存中文 draft')
  expect(await session.close()).toBe(false)
  expect((await h.documents.read(snapshot.documentId)).dirty).toBe(true)
  const filename = path.join(h.root, 'saved.md')
  save.mockImplementation(id => h.documents.save(id, filename))
  expect(await session.flush()).toBe(true)
  expect(session.documentId).toBe(snapshot.documentId)
  expect(session.ref).toEqual({ kind: 'file', path: filename })
  expect(await fs.readFile(filename, 'utf8')).toBe('未保存中文 draft')
  h.documents.closeWithDialog = async id => { await h.documents.close(id); return true }
  expect(await session.close()).toBe(true)
})
it('M02 tabs use DocumentId for untitled siblings and a late course activation cannot steal Markdown selection', async () => {
  const h = await fixture()
  const course = (id: string) => ({ documentId: id, binding: { kind: 'untitled', suggestedName: 'same.h5lesson' }, dirty: false } as DocumentSnapshot)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const initial: CourseDocumentsPort = { documents: [course('a'), course('b')], activeDocumentId: 'a', activation: 1, activate: async () => wait, close: async () => false }
  const { result, rerender } = renderHook(({ courses }) => useDocumentTabsController({ documentPort: h.port, courseDocuments: courses }), { initialProps: { courses: initial } })
  await act(async () => { await result.current.createMarkdown('same'); await result.current.createMarkdown('same') })
  const documents = result.current.tabs.filter(tab => tab.kind === 'document')
  expect(documents).toHaveLength(2)
  expect(documents[0].id).not.toBe(documents[1].id)
  expect(documents.every(tab => tab.id === tab.documentId && tab.path === '')).toBe(true)
  act(() => { result.current.setActiveTab('b'); result.current.setActiveTab(documents[0].id) })
  await act(async () => { rerender({ courses: { ...initial, activeDocumentId: 'b', activation: 2 } }); release(); await wait })
  expect(result.current.activeTab).toBe(documents[0].id)
  expect(result.current.isCourseActive).toBe(false)
  expect(await result.current.closeTab(result.current.tabs.find(tab => tab.id === 'b')!)).toBe(false)
  expect(result.current.tabs.some(tab => tab.id === 'b')).toBe(true)
})
