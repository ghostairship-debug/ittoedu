// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OfficeDocumentSnapshot } from '../../src/shared/workbench/officeDocument'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const opened = (path: string): OfficeDocumentSnapshot => ({ binding: { path, fileVersion: 'v1', bindingVersion: 1 }, bytes: new Uint8Array(),
  inspection: { format: 'docx', paragraphs: [{ index: 0, text: 'saved' }], tables: [] }, history: { undoDepth: 0, redoDepth: 0, entries: [] } })
async function fixture() {
  vi.stubGlobal('desktopAPI', { officeDocument: vi.fn(async (request: { path: string }) => opened(request.path)) })
  const port = { documents: { subscribe: () => () => {} } } as unknown as RecoverableDocumentFilePort
  const hook = renderHook(() => useDocumentTabsController({ documentPort: port }))
  for (const path of ['D:/captured.docx', 'D:/later.docx']) await act(async () => {
    await hook.result.current.openTab({ path, name: path.split('/').at(-1)!, kind: 'word', lesson: null })
  })
  return hook
}
describe('Office input preparation before AI submission', () => {
  it('flushes captured Office files despite native document references being empty and later focus changes', async () => {
    const hook = await fixture(), [first, second] = hook.result.current.tabs
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const flushFirst = vi.fn(async () => { await pending; hook.result.current.updateDirty(first.id, false); return true })
    const flushLater = vi.fn(async () => true)
    act(() => {
      hook.result.current.officeEditorRef(first.id)({ flush: flushFirst })
      hook.result.current.officeEditorRef(second.id)({ flush: flushLater })
      hook.result.current.updateDirty(first.id, true)
    })
    let ready!: Promise<boolean>
    act(() => { ready = hook.result.current.prepareOfficeFiles([first.path]) })
    act(() => hook.result.current.setActiveTab(second.id))
    await act(async () => { release(); expect(await ready).toBe(true) })
    expect(flushFirst).toHaveBeenCalledOnce()
    expect(flushLater).not.toHaveBeenCalled()
    expect(hook.result.current.activeTab).toBe(second.id)
  })
  it('blocks submission and retains dirty input when the file owner refuses a flush', async () => {
    const hook = await fixture(), tab = hook.result.current.tabs[0]
    act(() => {
      hook.result.current.officeEditorRef(tab.id)({ flush: async () => false })
      hook.result.current.updateDirty(tab.id, true)
    })
    await act(async () => { expect(await hook.result.current.prepareOfficeFiles([tab.path])).toBe(false) })
    expect(hook.result.current.tabs.find(item => item.id === tab.id)?.dirty).toBe(true)
    expect(hook.result.current.activeTab).toBe(tab.id)
  })
  it('rejects a new draft in an earlier file while a later captured file is saving', async () => {
    const hook = await fixture(), [first, second] = hook.result.current.tabs
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    act(() => {
      hook.result.current.officeEditorRef(first.id)({ flush: async () => {
        hook.result.current.updateDirty(first.id, false); return true
      } })
      hook.result.current.officeEditorRef(second.id)({ flush: async () => {
        entered(); await waiting; hook.result.current.updateDirty(second.id, false); return true
      } })
      hook.result.current.updateDirty(first.id, true)
      hook.result.current.updateDirty(second.id, true)
    })
    let ready!: Promise<boolean>
    await act(async () => {
      ready = hook.result.current.prepareOfficeFiles([first.path, second.path])
      await started
    })
    act(() => hook.result.current.updateDirty(first.id, true))
    await act(async () => { release(); expect(await ready).toBe(false) })
    expect(hook.result.current.tabs.find(tab => tab.id === first.id)?.dirty).toBe(true)
    expect(hook.result.current.activeTab).toBe(first.id)
  })
})
