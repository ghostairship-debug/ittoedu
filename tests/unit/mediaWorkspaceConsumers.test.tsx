import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDocumentTabsController, type DocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { MediaArtifactBindingChanged, MediaFileSnapshot, MediaFilesRequest } from '../../src/shared/workbench/mediaFiles'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('opens a recreated original media path as a second tab after the first tab is renamed', async () => {
  let tabs!: DocumentTabsController
  let relocate!: (event: MediaArtifactBindingChanged) => void
  vi.stubGlobal('desktopAPI', undefined)
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: {
    onMediaArtifactBindingChanged: (listener: typeof relocate) => { relocate = listener; return () => {} },
  } })
  const original = { path: '/workspace/A.png', fileVersion: 'version-A', bindingVersion: 1 }
  const mediaFiles = async (request: MediaFilesRequest) => ({ binding: request.type === 'media-file.open-path'
    ? { ...original, path: request.path } : original,
    content: { kind: 'image' as const, bytes: new Uint8Array([1]), mimeType: 'image/png', width: 30, height: 10, editable: true } })
  function Harness() {
    tabs = useDocumentTabsController({ documentPort: { documents: { subscribe: () => () => {} } } as unknown as RecoverableDocumentFilePort, mediaFiles })
    return null
  }
  render(<Harness />)
  await act(async () => { await tabs.openTab({ kind: 'media', path: original.path, name: 'A.png', lesson: null }) })
  const firstId = tabs.tabs[0].id
  act(() => { relocate({ before: original, binding: { ...original, path: '/workspace/B.png', bindingVersion: 2 } }) })
  await act(async () => { await tabs.openTab({ kind: 'media', path: original.path, name: 'A.png', lesson: null }) })
  expect(tabs.tabs.map(tab => tab.path)).toEqual(['/workspace/B.png', '/workspace/A.png'])
  expect(tabs.tabs[0].id).toBe(firstId)
  expect(tabs.tabs[1].id).not.toBe(firstId)
  expect(tabs.activeTab).toBe(tabs.tabs[1].id)
  delete (window as unknown as { desktopAPI?: unknown }).desktopAPI
})

it('sends the selected Explorer current-copy directly to the formal file owner', async () => {
  const requests: WorkspaceFilesRequest[] = []
  const files = Object.assign(async (request: WorkspaceFilesRequest) => {
    requests.push(request)
    if (request.type === 'root') return { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: '/workspace' }
    if (request.type === 'watch') return { workspaceId: 'workspace', watching: true }
    if (request.type === 'list') return { entries: request.directoryEntryId === 'root' ? [
      { entryId: 'picture', status: 'accessible', name: 'picture.png', kind: 'file' },
      { entryId: 'target', status: 'accessible', name: 'target', kind: 'directory' },
    ] : [] }
    if (request.type === 'copy') return { operationId: request.operationId, status: 'success', affectedPaths: [],
      items: [{ status: 'success', affectedPaths: [], copied: 'current-draft' }] }
    throw new Error(`unexpected ${request.type}`)
  }, { subscribe: () => () => {} }) as unknown as WorkspaceFilesAPI
  render(<WorkspaceFilesTree directory='/workspace' files={files} onFile={() => {}} onDirectory={() => {}} />)
  const picture = await screen.findByRole('button', { name: 'picture.png' })
  fireEvent.click(picture); fireEvent.contextMenu(picture)
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '复制到…' }))
  fireEvent.change(await screen.findByLabelText('复制内容'), { target: { value: 'current' } })
  const folder = await screen.findByLabelText('目标文件夹')
  await waitFor(() => expect([...folder.querySelectorAll('option')].some(option => option.value === 'target')).toBe(true))
  fireEvent.change(folder, { target: { value: 'target' } })
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await waitFor(() => expect(requests.find(request => request.type === 'copy')).toMatchObject({
    sourceEntryIds: ['picture'], targetDirectoryId: 'target', sourceVersion: 'current',
  }))
  expect(screen.queryByText('当前输入尚未同步')).not.toBeInTheDocument()
})

it('deduplicates concurrent media opens by their actual binding path while preserving a stable tab identity', async () => {
  let tabs!: DocumentTabsController
  const pending: Array<(value: MediaFileSnapshot) => void> = []
  const mediaFiles = () => new Promise<MediaFileSnapshot>(resolve => { pending.push(resolve) })
  function Harness() {
    tabs = useDocumentTabsController({ documentPort: {} as RecoverableDocumentFilePort, mediaFiles })
    return null
  }
  render(<Harness />)
  await act(async () => {
    const first = tabs.openTab({ kind: 'media', path: '/workspace/A.pdf', name: 'A.pdf', lesson: null })
    const second = tabs.openTab({ kind: 'media', path: '/workspace/A.pdf', name: 'A.pdf', lesson: null })
    const snapshot = { binding: { path: '/workspace/A.pdf', fileVersion: 'pdf-version', bindingVersion: 1 },
      content: { kind: 'pdf' as const, bytes: new Uint8Array([1]), mimeType: 'application/pdf' as const, pages: [{ width: 120, height: 80, rotation: 0 }], editable: true as const } }
    pending[0](snapshot); pending[1](snapshot)
    await Promise.all([first, second])
  })
  expect(tabs.tabs).toHaveLength(1)
  expect(tabs.tabs[0].path).toBe('/workspace/A.pdf')
  expect(tabs.activeTab).toBe(tabs.tabs[0].id)
})
