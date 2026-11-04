// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { WorkspaceContentHost } from '../../src/renderer/lessonWorkspace/view/WorkspaceContentHost'

vi.mock('../../src/renderer/documents/useContentEditorMode', () => ({ useContentEditorMode: () => ({}) }))
vi.mock('../../src/renderer/lessonWorkspace/view/WorkspaceDocumentTabs', () => ({ WorkspaceDocumentTabs: () => null }))
vi.mock('../../src/renderer/lessonWorkspace/view/WorkspaceDocumentStatus', () => ({ WorkspaceDocumentStatus: () => null }))
vi.mock('../../src/renderer/lessonWorkspace/view/usePptxPicker', () => ({ usePptxPicker: () => ({ element: null }) }))
vi.mock('../../src/renderer/documentFiles/office/DocxFileEditor', () => ({ DocxFileEditor: () => <input aria-label="正文" /> }))
vi.mock('../../src/renderer/documentFiles/office/OfficeSelectionTools', () => ({ OfficeSelectionHost: React.createContext(null) }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('delayed close freezes the actual editor host and failure or window cancellation restores input', async () => {
  const snapshot = { binding: { path: 'book.docx', fileVersion: 'v1', bindingVersion: 1 },
    inspection: { format: 'docx', paragraphs: [] }, history: { undoDepth: 0, redoDepth: 0, entries: [] }, draftDirty: true }
  let rejectClose!: (error: Error) => void
  const officeDocument = vi.fn((request: { type: string }) => request.type === 'office-document.close'
    ? new Promise((_resolve, reject) => { rejectClose = reject })
    : Promise.resolve(request.type === 'office-document.save' ? { ...snapshot, draftDirty: false } : snapshot))
  vi.stubGlobal('desktopAPI', { officeDocument })
  let controller!: ReturnType<typeof useDocumentTabsController>
  function App() {
    controller = useDocumentTabsController({ documentPort: {} as never })
    const props = { state: { lesson: null }, actions: {}, tabs: controller, documentPort: {} } as never
    const layout = { prefs: { contentClosed: false } } as never
    return <WorkspaceContentHost props={props} layout={layout} editorFocus={false} enterEditor={() => {}} exitEditor={() => {}} />
  }
  render(<App />)
  await act(async () => { await controller.openTab({ path: 'book.docx', name: 'book.docx', kind: 'word', lesson: null }) })
  const input = await screen.findByLabelText('正文'), host = input.closest('.office-file-view')!
  expect(host).not.toHaveAttribute('inert')
  const tab = controller.tabs[0]
  act(() => { controller.officeEditorRef(tab.id)({ flush: async () => true }) })
  await act(async () => { await controller.closeTab(tab) })
  expect(host).not.toHaveAttribute('inert')
  let closing!: Promise<boolean>
  act(() => { closing = controller.resolveOfficeClose(tab.id, 'save') })
  await waitFor(() => expect(officeDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'office-document.close' })))
  expect(host).toHaveAttribute('inert')
  expect(officeDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'office-document.save' }))
  expect(screen.getByRole('button', { name: '取消关闭' })).toBeDisabled()
  await act(async () => { rejectClose(new Error('close failed')); expect(await closing).toBe(false) })
  expect(host).not.toHaveAttribute('inert')
  expect(screen.getByRole('button', { name: '取消关闭' })).toBeEnabled()
  act(() => { controller.suspendForClose() })
  expect(host).toHaveAttribute('inert')
  act(() => { controller.resumeAfterCloseCancelled() })
  expect(host).not.toHaveAttribute('inert')
})
