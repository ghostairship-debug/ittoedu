import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceRecoveryPanel } from '../../src/renderer/workbench/WorkspaceRecoveryPanel'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { useDocumentTabsController, type CourseDocumentsPort, type DocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

afterEach(() => cleanup())
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}
function recovered(documentId = 'draft'): DocumentSnapshot {
  return { documentId, epoch: 'epoch', revision: 1, sequence: 1, binding: { kind: 'untitled', suggestedName: 'important.md' },
    model: { kind: 'markdown', source: 'important draft', resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 1, redoDepth: 0 }
}
function fixture() {
  const api = { recoverable: vi.fn(async () => [recovered()]), restore: vi.fn(async (_id: string) => recovered()),
    discardRecovery: vi.fn(async () => {}), subscribe: () => () => {} }
  return api
}

it.each(['draft', 'saved-copy'] as const)('retains the recovered %s for manual opening when navigation changes during Main restore', async restoredId => {
  const api = fixture(), pending = deferred<DocumentSnapshot>()
  api.restore.mockImplementationOnce(() => pending.promise)
  let navigation = 0
  const onRestored = vi.fn(async () => { navigation++ })
  render(<WorkspaceRecoveryPanel api={api} onRestored={onRestored} captureNavigationIdentity={() => String(navigation)} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  fireEvent.click(await screen.findByRole('button', { name: '恢复并打开' }))
  await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1))
  navigation++
  await act(async () => { pending.resolve(recovered(restoredId)); await pending.promise })
  const manual = await screen.findByRole('button', { name: '打开已恢复稿' })
  expect(onRestored).not.toHaveBeenCalled()
  expect(api.discardRecovery).not.toHaveBeenCalled()
  fireEvent.click(manual)
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restoredId))
  await waitFor(() => expect(screen.queryByRole('button', { name: '打开已恢复稿' })).toBeNull())
  expect(api.restore).toHaveBeenCalledExactlyOnceWith('draft')
})

it('keeps the manual-open entry if a later user navigation supersedes the focus owner', async () => {
  const api = fixture(), focused = deferred<void>()
  let navigation = 0
  const onRestored = vi.fn().mockImplementationOnce(() => { navigation++; return focused.promise })
    .mockImplementation(async () => { navigation++ })
  render(<WorkspaceRecoveryPanel api={api} onRestored={onRestored} captureNavigationIdentity={() => String(navigation)} />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  fireEvent.click(await screen.findByRole('button', { name: '恢复并打开' }))
  await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
  navigation++
  await act(async () => { focused.resolve(); await focused.promise })
  const row = screen.getByText('important.md').closest('li')!
  fireEvent.click(await within(row).findByRole('button', { name: '打开已恢复稿' }))
  await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(2))
  expect(api.restore).toHaveBeenCalledTimes(1)
  expect(api.discardRecovery).not.toHaveBeenCalled()
})

it('consumes a successfully focused Markdown row using the existing single tab navigation request', async () => {
  const api = fixture()
  const port = { documents: { subscribe: () => () => {}, read: async () => recovered() } } as unknown as RecoverableDocumentFilePort
  let tabs!: DocumentTabsController
  function Workspace() {
    tabs = useDocumentTabsController({ documentPort: port })
    return <WorkspaceRecoveryPanel api={api} onRestored={tabs.focusDocument} captureNavigationIdentity={tabs.captureNavigationIdentity} />
  }
  render(<Workspace />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  fireEvent.click(await screen.findByRole('button', { name: '恢复并打开' }))
  await waitFor(() => expect(tabs.activeTab).toBe('draft'))
  await waitFor(() => expect(screen.queryByRole('button', { name: '打开已恢复稿' })).toBeNull())
  expect(screen.queryByRole('button', { name: '恢复稿（1）' })).toBeNull()
  expect(api.restore).toHaveBeenCalledTimes(1)
  expect(api.discardRecovery).not.toHaveBeenCalled()
})

it('keeps a Main-restored row when focus loses its course scope during the original read', async () => {
  const api = fixture(), pending = deferred<DocumentSnapshot>()
  const read = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(recovered())
  const port = { documents: { subscribe: () => () => {}, read } } as unknown as RecoverableDocumentFilePort
  const current: DocumentSnapshot = { ...recovered('current-course'), model: { kind: 'course-v10',
    project: createBlankCourseProjectV10('current'), resources: { assets: {}, components: {} } } }
  let view = 0, tabs!: DocumentTabsController
  const courses: CourseDocumentsPort = { documents: [current], activeDocumentId: current.documentId,
    captureScope: () => { const captured = view; return () => captured === view }, activate: vi.fn(async () => true), close: async () => false }
  const onRestored = vi.fn((id: string) => tabs.focusDocument(id))
  function Workspace() {
    tabs = useDocumentTabsController({ documentPort: port, courseDocuments: courses })
    return <WorkspaceRecoveryPanel api={api} onRestored={onRestored} captureNavigationIdentity={tabs.captureNavigationIdentity} />
  }
  render(<Workspace />)
  fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
  fireEvent.click(await screen.findByRole('button', { name: '恢复并打开' }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  const unchangedTicket = tabs.captureNavigationIdentity()
  view++
  await act(async () => { pending.resolve(recovered()); await pending.promise })
  expect(tabs.captureNavigationIdentity()).toBe(unchangedTicket)
  expect(tabs.activeTab).toBe(current.documentId)
  const manual = await screen.findByRole('button', { name: '打开已恢复稿' })
  expect(await onRestored.mock.results[0]!.value).toBe(false)
  expect(api.restore).toHaveBeenCalledTimes(1)
  expect(api.discardRecovery).not.toHaveBeenCalled()
  fireEvent.click(manual)
  await waitFor(() => expect(tabs.activeTab).toBe('draft'))
  await waitFor(() => expect(screen.queryByRole('button', { name: '打开已恢复稿' })).toBeNull())
  expect(api.restore).toHaveBeenCalledTimes(1)
})
