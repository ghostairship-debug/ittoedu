import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { MediaFilesService } from '../../src/main/workbench/mediaFiles/MediaFilesService'
import type { FileArtifactBinding, MediaFilesRequest } from '../../src/shared/workbench/mediaFiles'
import { MediaFileEditor } from '../../src/renderer/documentFiles/media/MediaFileEditor'
import { useDocumentTabsController, type DocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { useLessonWorkspaceController } from '../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  let bytes: Uint8Array = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
  let version = 1
  const binding = (): FileArtifactBinding => ({ path: '/workspace/picture.png', fileVersion: String(version), bindingVersion: 1 })
  const replace = vi.fn(async (target: FileArtifactBinding, candidate: Uint8Array) => {
    if (target.fileVersion !== String(version)) throw new Error('原文件已改变，请重新读取')
    bytes = candidate; version++
    return binding()
  })
  const service = new MediaFilesService({ read: async target => {
    if (target.fileVersion !== String(version)) throw new Error('原文件已改变，请重新读取')
    return bytes
  }, replace })
  const request = vi.fn(async (input: MediaFilesRequest) => {
    if (input.type === 'media-file.open-path' || input.type === 'media-file.open' || input.type === 'media-file.reload') return service.open(binding())
    return input.type === 'media-file.save' ? service.save(input.binding, input.operations) : service.preview(input.binding, input.operations)
  })
  let controller!: DocumentTabsController
  const documentPort = { documents: { subscribe: () => () => {} } } as unknown as RecoverableDocumentFilePort
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:media-test' }
    static revokeObjectURL() {}
  })
  function Harness() {
    const tabs = useDocumentTabsController({ documentPort, mediaFiles: request })
    controller = tabs
    return <>{tabs.tabs.filter(tab => tab.kind === 'media' && tab.mediaSnapshot).map(tab => <MediaFileEditor
      key={tab.id} ref={tabs.mediaEditorRef(tab.id)} snapshot={tab.mediaSnapshot!}
      port={{ preview: (binding, operations) => request({ type: 'media-file.preview', binding, operations: [...operations] }),
        save: (binding, operations) => request({ type: 'media-file.save', binding, operations: [...operations] }),
        reload: binding => request({ type: 'media-file.reload', binding }) }}
      onSaved={snapshot => tabs.updateMediaSnapshot(tab.id, snapshot)}
      onDirtyChange={dirty => tabs.updateDirty(tab.id, dirty)} />)}</>
  }
  render(<Harness />)
  await act(async () => { await controller.openTab({ path: binding().path, name: 'picture.png', kind: 'media', lesson: null }) })
  return { controller: () => controller, replace, request, externalChange: () => { version++ }, bytes: () => bytes }
}

describe('media file tabs use their actual file editor', () => {
  it('keeps a dirty tab on cancelled close, then Ctrl+S saves original bytes and clean close removes it', async () => {
    const h = await fixture()
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' }))
    await waitFor(() => expect(h.controller().tabs[0].dirty).toBe(true))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 项编辑尚未保存'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    let closed = true
    await act(async () => { closed = await h.controller().closeTab(h.controller().tabs[0]) })
    expect(closed).toBe(false); expect(h.controller().tabs).toHaveLength(1); expect(h.replace).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(h.controller().tabs[0].dirty).toBe(false))
    expect(h.replace).toHaveBeenCalledTimes(1)
    const metadata = await sharp(h.bytes()).metadata()
    expect([metadata.width, metadata.height]).toEqual([10, 20])
    expect(h.controller().tabs[0].mediaSnapshot?.binding.fileVersion).toBe('2')
    await act(async () => { closed = await h.controller().closeTab(h.controller().tabs[0]) })
    expect(closed).toBe(true); expect(h.controller().tabs).toHaveLength(0)
  })

  it('preserves a media draft on application-close preparation and a save conflict, then reload obtains a new binding', async () => {
    const h = await fixture()
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' }))
    await waitFor(() => expect(h.controller().tabs[0].dirty).toBe(true))
    let ready = true
    await act(async () => { ready = await h.controller().preserveAll() })
    expect(ready).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('请先保存或撤销')
    expect(h.replace).not.toHaveBeenCalled()
    h.externalChange()
    await act(async () => { ready = await h.controller().flushAll() })
    expect(ready).toBe(false)
    expect(h.controller().tabs[0].dirty).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('原文件已改变')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(h.controller().tabs[0].dirty).toBe(false))
    expect(h.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'media-file.reload' }))
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' }))
    await waitFor(() => expect(h.controller().tabs[0].dirty).toBe(true))
    await act(async () => { ready = await h.controller().flushAll() })
    expect(ready).toBe(true)
    expect(h.controller().tabs[0].mediaSnapshot?.binding.fileVersion).toBe('3')
  })

  it('routes PDF and image explorer entries to media tabs without a text document session or external app', async () => {
    let workspace!: ReturnType<typeof useLessonWorkspaceController>
    const openTab = vi.fn(async (_tab: Parameters<DocumentTabsController['openTab']>[0]) => {})
    const operation = vi.fn(async () => ({ recent: [] }))
    const tabs = { openTab, drainAll: async () => true, setActiveTab: () => {} } as unknown as DocumentTabsController
    function Harness() {
      workspace = useLessonWorkspaceController({ lessonOperation: operation, projectPath: null, tabs, onOpenProject: async () => true, onNewProject: async () => true })
      return null
    }
    render(<Harness />)
    await act(async () => { await workspace.actions.openFile({ path: '/workspace/notes.pdf', name: 'notes.pdf', kind: 'file' }) })
    await act(async () => { await workspace.actions.openFile({ path: '/workspace/picture.png', name: 'picture.png', kind: 'file' }) })
    expect(openTab.mock.calls.map(([tab]) => tab)).toEqual([
      { path: '/workspace/notes.pdf', name: 'notes.pdf', kind: 'media', lesson: null },
      { path: '/workspace/picture.png', name: 'picture.png', kind: 'media', lesson: null },
    ])
    expect(operation).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'open-external' }))
  })
})
