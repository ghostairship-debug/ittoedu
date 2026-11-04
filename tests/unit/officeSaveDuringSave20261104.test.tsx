// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('a second save drains edits made during the first disk save', async () => {
  const binding = (n: number) => ({ path: 'book.xlsx', bindingVersion: n, fileVersion: `v${n}` })
  const snapshot = (n: number, draftDirty: boolean) => ({ binding: binding(n),
    inspection: { format: 'xlsx', sheets: [] }, history: { undoDepth: 0, redoDepth: 0, entries: [] }, draftDirty })
  let finishFirst!: () => void, saves = 0
  const officeDocument = vi.fn((request: { type: string }) => {
    if (request.type === 'office-document.open') return Promise.resolve(snapshot(1, true))
    if (request.type === 'office-document.edit') return Promise.resolve(snapshot(3, true))
    if (request.type === 'office-document.save') {
      if (++saves === 1) return new Promise(resolve => { finishFirst = () => resolve(snapshot(2, false)) })
      return Promise.resolve(snapshot(4, false))
    }
    throw new Error(`unexpected request ${request.type}`)
  })
  vi.stubGlobal('desktopAPI', { officeDocument })
  const { result } = renderHook(() => useDocumentTabsController({ documentPort: {} as never }))
  await act(async () => { await result.current.openTab({ path: 'book.xlsx', name: 'book.xlsx', kind: 'spreadsheet', lesson: null }) })
  const id = result.current.tabs[0].id
  let suffix = false
  act(() => result.current.officeEditorRef(id)({ flush: async () => {
    if (suffix) {
      suffix = false
      await result.current.editOffice(id, binding(2), { format: 'xlsx', edits: [{ type: 'sheetAdd', name: 'Later' }] })
      result.current.updateDirty(id, false)
    }
    return true
  } }))
  let first!: Promise<boolean>, second!: Promise<boolean>
  act(() => { first = result.current.saveOffice(id) })
  await waitFor(() => expect(saves).toBe(1))
  act(() => { suffix = true; result.current.updateDirty(id, true); second = result.current.saveOffice(id) })
  await act(async () => { finishFirst(); expect(await first).toBe(false); expect(await second).toBe(true) })
  expect(saves).toBe(2)
  expect(officeDocument).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'office-document.save', binding: binding(3) }))
  expect(result.current.tabs[0].dirty).toBe(false)
})

test('a second save drains pending history even if the first save reports a clean snapshot', async () => {
  const binding = (n: number) => ({ path: 'book.xlsx', bindingVersion: n, fileVersion: `v${n}` })
  const snapshot = (n: number, draftDirty: boolean) => ({ binding: binding(n), inspection: { format: 'xlsx', sheets: [] },
    history: { undoDepth: 1, redoDepth: 1, entries: [] }, draftDirty })
  let finishSave!: () => void, finishHistory!: () => void
  const officeDocument = vi.fn((request: { type: string }) => {
    if (request.type === 'office-document.open') return Promise.resolve(snapshot(1, true))
    if (request.type === 'office-document.save') return new Promise(resolve => { finishSave = () => resolve(snapshot(2, false)) })
    throw new Error(`unexpected request ${request.type}`)
  })
  vi.stubGlobal('desktopAPI', { officeDocument })
  const { result } = renderHook(() => useDocumentTabsController({ documentPort: {} as never }))
  await act(async () => { await result.current.openTab({ path: 'book.xlsx', name: 'book.xlsx', kind: 'spreadsheet', lesson: null }) })
  const id = result.current.tabs[0].id
  const flush = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise<boolean>(resolve => { finishHistory = () => resolve(true) }))
  act(() => result.current.officeEditorRef(id)({ flush }))
  let first!: Promise<boolean>, second!: Promise<boolean>, secondDone = false
  act(() => { first = result.current.saveOffice(id) })
  await waitFor(() => expect(finishSave).toBeTypeOf('function'))
  act(() => { second = result.current.saveOffice(id).then(value => { secondDone = true; return value }) })
  await act(async () => { finishSave(); await first; await Promise.resolve() })
  expect(flush).toHaveBeenCalledTimes(2)
  expect(secondDone).toBe(false)
  await act(async () => { finishHistory(); expect(await second).toBe(true) })
})
