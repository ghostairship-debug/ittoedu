import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { insertCourseElement } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { useDocumentTabsController, type CourseDocumentsPort } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

afterEach(cleanup)

it.each(['open', 'create'] as const)('CA177 late course %s attaches its tab without stealing the later navigation', async action => {
  const h = await createCourseDocumentHost(), gate = deferred(), started = deferred()
  const previous = h.bridge.read().activeDocumentId!
  if (action === 'open') {
    await h.seedFile('late.h5lesson', 'late')
    const original = h.api.open
    h.api.open = async path => { started.resolve(); await gate.promise; return original(path) }
  } else {
    const original = h.api.create
    h.api.create = async (...args) => { started.resolve(); await gate.promise; return original(...args) }
  }
  const pending = action === 'open' ? h.bridge.open('late.h5lesson') : h.bridge.create()
  await started.promise
  await h.bridge.activate(previous)
  gate.resolve(); await pending
  expect(h.bridge.read().activeDocumentId).toBe(previous)
  expect(h.bridge.read().documents).toHaveLength(2)
  h.dispose()
})

it('CA177 focus read and close ACK preserve the current tab chosen during their waits', async () => {
  const h = await createCourseDocumentHost()
  await h.seedFile('b.h5lesson', 'B'); await h.seedFile('c.h5lesson', 'C')
  const a = h.bridge.read().activeDocumentId!, b = (await h.api.open('b.h5lesson')).documentId, c = (await h.api.open('c.h5lesson')).documentId
  const closeGate = deferred(), closeStarted = deferred()
  const courses: CourseDocumentsPort = { documents: await h.api.list(), activeDocumentId: a, activation: 1,
    activate: id => h.bridge.activate(id), close: async () => { closeStarted.resolve(); await closeGate.promise; return true } }
  const unavailable = async (): Promise<never> => { throw new Error('Unexpected legacy path') }
  const { result } = renderHook(() => useDocumentTabsController({ courseDocuments: courses,
    documentPort: { documents: h.api, openDocument: unavailable, saveDocument: unavailable, watchDocument: () => () => {} } }))
  let closing!: Promise<boolean>
  act(() => { closing = result.current.closeTab(result.current.tabs.find(tab => tab.id === a)!) })
  await closeStarted.promise
  await act(async () => { result.current.setActiveTab(b); await Promise.resolve() })
  await act(async () => { closeGate.resolve(); await closing })
  expect(result.current.activeTab).toBe(b)
  expect(result.current.tabs.some(tab => tab.id === a)).toBe(false)
  const readGate = deferred(), readStarted = deferred(), originalRead = h.api.read
  h.api.read = async id => { readStarted.resolve(); await readGate.promise; return originalRead(id) }
  let focusing!: Promise<void | boolean>
  act(() => { focusing = result.current.focusDocument(c) }); await readStarted.promise
  await act(async () => { result.current.setActiveTab(b); await Promise.resolve() })
  await act(async () => { readGate.resolve(); await focusing })
  expect(result.current.activeTab).toBe(b)
  expect(h.bridge.read().activeDocumentId).toBe(b)
  h.dispose()
})

it('CA178 insertion commits to its captured course but a changed state keeps its selection', async () => {
  const h = await createCourseDocumentHost(), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  const initial = h.bridge.captureTarget(), surfaceId = initial.surfaceId!
  await h.bridge.edit([{ type: 'surface.presentation.set', surfaceId, presentation: { initialStateId: 'a', states: [
    { id: 'a', title: 'A', overrides: {} }, { id: 'b', title: 'B', overrides: {} },
  ] } }])
  h.bridge.selectPresentationState(initial.documentId, 'a', surfaceId)
  const target = h.bridge.captureTarget(), gate = deferred(), started = deferred()
  h.controls.beforeAppend = async () => { started.resolve(); await gate.promise }
  const inserting = insertCourseElement(kernel, target, 'text')
  await started.promise
  h.bridge.selectPresentationState(target.documentId, 'b', surfaceId)
  gate.resolve(); const inserted = await inserting
  expect(h.bridge.read().activeStateId).toBe('b')
  expect(h.bridge.read().selectedInstanceIds).toEqual(target.instanceIds)
  expect(h.bridge.read().project!.instances[inserted.instanceIds[0]!]).toBeDefined()
  h.dispose()
})

it('CA134 a directory resolve from the previous workspace cannot navigate the new workspace', async () => {
  const gate = deferred(), started = deferred(), onDirectory = vi.fn(), requests: WorkspaceFilesRequest[] = []
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    requests.push(request)
    if (request.type === 'root') return { workspaceId: request.directory, rootEntryId: 'root', resolvedPath: request.directory }
    if (request.type === 'watch') return { workspaceId: request.workspaceId, watching: true }
    if (request.type === 'list') return { entries: request.workspaceId === 'A' ? [{ status: 'accessible', entryId: 'folder', name: 'old-folder', kind: 'directory' }] : [] }
    if (request.type === 'resolve') { started.resolve(); await gate.promise; return { workspaceId: 'A', entryId: 'folder', kind: 'directory', resolvedPath: 'A/old-folder' } }
    throw new Error(`Unexpected ${request.type}`)
  }, { subscribe: () => () => {} }) as WorkspaceFilesAPI
  const view = render(<WorkspaceFilesTree directory="A" files={files} onDirectory={onDirectory} onFile={() => {}} />)
  fireEvent.doubleClick(await screen.findByRole('button', { name: 'old-folder' })); await started.promise
  view.rerender(<WorkspaceFilesTree directory="B" files={files} onDirectory={onDirectory} onFile={() => {}} />)
  await waitFor(() => expect(requests.some(request => request.type === 'watch' && request.workspaceId === 'B')).toBe(true))
  await act(async () => { gate.resolve(); await gate.promise })
  expect(onDirectory).not.toHaveBeenCalled()
  expect(requests.some(request => request.type === 'list' && request.directoryEntryId === 'folder')).toBe(false)
})
