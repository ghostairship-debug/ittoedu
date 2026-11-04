// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { OfficeDocumentRequest, OfficeDocumentSnapshot } from '../../src/shared/workbench/officeDocument'
import type { FileArtifactSaveAsResult } from '../../src/shared/workbench/fileArtifactSaveAs'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const opened = (path: string): OfficeDocumentSnapshot => ({ binding: { path, fileVersion: 'v1', bindingVersion: 1 }, bytes: new Uint8Array(),
  inspection: { format: 'docx', paragraphs: [{ index: 0, text: 'saved' }], tables: [] }, history: { undoDepth: 0, redoDepth: 0, entries: [] } })
async function fixture(saveFileArtifactAs?: () => Promise<FileArtifactSaveAsResult | null>) {
  vi.stubGlobal('desktopAPI', { officeDocument: vi.fn(async (request: { path: string }) => opened(request.path)), saveFileArtifactAs })
  const port = { documents: { subscribe: () => () => {} } } as unknown as RecoverableDocumentFilePort
  const hook = renderHook(() => useDocumentTabsController({ documentPort: port }))
  for (const path of ['D:/captured.docx', 'D:/later.docx']) await act(async () => {
    await hook.result.current.openTab({ path, name: path.split('/').at(-1)!, kind: 'word', lesson: null })
  })
  return hook
}
describe('Office input preparation before AI submission', () => {
  it('closes the main draft after a replaced initial open can no longer recreate it', async () => {
    const path = 'D:/pending.docx'
    const openReplies: Array<(snapshot: OfficeDocumentSnapshot) => void> = []
    let mainDraftOpen = false
    const request = vi.fn(async (input: OfficeDocumentRequest) => {
      if (input.type === 'office-document.open') {
        const snapshot = await new Promise<OfficeDocumentSnapshot>(resolve => { openReplies.push(resolve) })
        mainDraftOpen = true
        return snapshot
      }
      if (input.type === 'office-document.close') mainDraftOpen = false
    })
    vi.stubGlobal('desktopAPI', { officeDocument: request })
    const port = { documents: { subscribe: () => () => {} } } as unknown as RecoverableDocumentFilePort
    const hook = renderHook(() => useDocumentTabsController({ documentPort: port }))
    let initial!: Promise<void>
    act(() => { initial = hook.result.current.openTab({ path, name: 'pending.docx', kind: 'word', lesson: null }) })
    const tab = hook.result.current.tabs[0]
    await act(async () => {
      const reload = hook.result.current.reloadOffice(tab.id)
      openReplies[1](opened(path))
      await reload
    })
    let closed!: Promise<boolean>
    await act(async () => {
      closed = hook.result.current.closeTab(hook.result.current.tabs[0])
      await Promise.resolve()
    })
    expect(request.mock.calls.map(([input]) => input.type)).toEqual(['office-document.open', 'office-document.open'])
    await act(async () => { openReplies[0](opened(path)); await initial; expect(await closed).toBe(true) })
    expect(mainDraftOpen).toBe(false)
    expect(hook.result.current.tabs).toEqual([])
  })
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

it('drains input before Save As and keeps the same Office tab bound to the returned copy', async () => {
  const target = 'D:/copy.docx', snapshot = opened(target)
  const saveAs = vi.fn<() => Promise<FileArtifactSaveAsResult | null>>().mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ kind: 'office', snapshot: { ...snapshot, binding: { ...snapshot.binding, bindingVersion: 2 } } })
  const hook = await fixture(saveAs), [first, second] = hook.result.current.tabs
  const flush = vi.fn(async () => {
    hook.result.current.updateDirty(first.id, false)
    return true
  })
  act(() => {
    hook.result.current.setActiveTab(first.id)
    hook.result.current.officeEditorRef(first.id)({ flush })
  })
  await act(async () => { expect(await hook.result.current.saveOfficeAs(first.id)).toBe(false) })
  expect(hook.result.current.tabs[0].path).toBe(first.path)
  await act(async () => { expect(await hook.result.current.saveOfficeAs(first.id)).toBe(true) })
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(saveAs.mock.invocationCallOrder[0])
  expect(saveAs).toHaveBeenCalledWith({ kind: 'office', binding: first.officeSnapshot?.binding, openPaths: [first.path, second.path] })
  expect(hook.result.current.activeTab).toBe(first.id)
  expect(hook.result.current.tabs[0]).toMatchObject({ id: first.id, path: target, name: 'copy.docx', dirty: false })
  expect(hook.result.current.tabs[1].path).toBe(second.path)
  await act(async () => { await hook.result.current.openTab({ path: first.path, name: first.name, kind: 'word', lesson: null }) })
  expect(hook.result.current.tabs).toHaveLength(3)
  expect(hook.result.current.tabs[2]).toMatchObject({ path: first.path, name: first.name })
  expect(hook.result.current.tabs[2].id).not.toBe(first.id)
})
