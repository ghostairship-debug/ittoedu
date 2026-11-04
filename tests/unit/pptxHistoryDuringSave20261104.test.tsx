// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('redo waits for the preceding disk save and uses its updated binding', async () => {
  const binding = (n: number) => ({ path: 'deck.pptx', bindingVersion: n, fileVersion: `v${n}` })
  const snapshot = (n: number, dirty: boolean) => ({ binding: binding(n), bytes: [], draftDirty: dirty,
    inspection: { format: 'pptx', slides: [] }, history: { undoDepth: 1, redoDepth: 1, entries: [] } })
  let finish!: () => void
  const pptxPreview = vi.fn((request: { type: string }) => {
    if (request.type === 'pptx-preview.save') return new Promise(resolve => { finish = () => resolve(snapshot(2, false)) })
    return Promise.resolve(request.type === 'pptx-preview.redo' ? snapshot(3, true) : snapshot(1, true))
  })
  vi.stubGlobal('desktopAPI', { pptxPreview })
  const { result } = renderHook(() => useDocumentTabsController({ documentPort: {} as never }))
  await act(async () => { await result.current.openTab({ path: 'deck.pptx', name: 'deck.pptx', kind: 'presentation', lesson: null }) })
  const id = result.current.tabs[0].id
  let saving!: Promise<boolean>, redo!: Promise<void>
  act(() => { saving = result.current.saveOffice(id) })
  await waitFor(() => expect(pptxPreview).toHaveBeenCalledWith(expect.objectContaining({ type: 'pptx-preview.save' })))
  act(() => { redo = result.current.movePptxHistory(id, 'redo') })
  expect(pptxPreview).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'pptx-preview.redo' }))
  await act(async () => { finish(); await saving; await redo })
  expect(pptxPreview).toHaveBeenCalledWith(expect.objectContaining({ type: 'pptx-preview.redo', binding: binding(2) }))
})
