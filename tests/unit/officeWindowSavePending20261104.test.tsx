// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('window save waits for a clean-looking in-flight Office edit before selecting drafts to save', async () => {
  const snapshot = { binding: { path: 'book.xlsx', bindingVersion: 1, fileVersion: 'v1' },
    inspection: { format: 'xlsx', sheets: [] }, history: { undoDepth: 0, redoDepth: 0, entries: [] }, draftDirty: false }
  const edited = { ...snapshot, binding: { ...snapshot.binding, bindingVersion: 2, fileVersion: 'v2' }, draftDirty: true }
  const saved = { ...edited, draftDirty: false }
  let finishEdit!: () => void
  const officeDocument = vi.fn((request: { type: string }) => {
    if (request.type === 'office-document.edit') return new Promise(resolve => { finishEdit = () => resolve(edited) })
    return Promise.resolve(request.type === 'office-document.save' ? saved : snapshot)
  })
  vi.stubGlobal('desktopAPI', { officeDocument })
  const { result } = renderHook(() => useDocumentTabsController({ documentPort: {} as never }))
  await act(async () => { await result.current.openTab({ path: 'book.xlsx', name: 'book.xlsx', kind: 'spreadsheet', lesson: null }) })
  const id = result.current.tabs[0].id
  let edit!: Promise<unknown>, closing!: Promise<boolean>
  act(() => { edit = result.current.editOffice(id, snapshot.binding, { format: 'xlsx', edits: [{ type: 'sheetAdd', name: 'New' }] }) })
  expect(result.current.tabs[0].dirty).toBe(false)
  act(() => { result.current.suspendForClose(); closing = result.current.preserveAll('save') })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(officeDocument).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'office-document.save' }))
  await act(async () => { finishEdit(); await edit; expect(await closing).toBe(true) })
  expect(officeDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'office-document.save', binding: edited.binding }))
  expect(result.current.tabs[0].dirty).toBe(false)
})
