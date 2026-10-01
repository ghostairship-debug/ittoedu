import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceResources } from '../../src/renderer/lessonWorkspace/view/WorkspaceResources'
import type { LessonWorkspaceViewProps } from '../../src/renderer/lessonWorkspace/view/lessonWorkspaceViewTypes'
import { useWorkbenchLayoutPrefs } from '../../src/renderer/lessonWorkspace/view/useWorkbenchLayoutPrefs'
import { WorkbenchSessionPortalProvider, useWorkbenchSessionDock } from '../../src/renderer/workbench/WorkbenchSessionPortal'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'

afterEach(() => { cleanup(); localStorage.clear() })

function Navigation({ props }: { props: LessonWorkspaceViewProps }) {
  const layout = useWorkbenchLayoutPrefs()
  const { scope } = useWorkbenchSessionDock()
  return <><WorkspaceResources props={props} layout={layout} /><output aria-label="当前会话范围">{scope?.path ?? '全部会话'}</output></>
}

it('uses one named root for file navigation and keeps scope reset available to the existing read-only consumer', async () => {
  const directory = 'C:\\教材\\自然科学'
  const root = { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: directory }
  const longName = '第一课-串联与并联电路的完整互动演示.html'
  const entries: WorkspaceListItem[] = [
    { status: 'accessible', entryId: 'unit', kind: 'directory', name: '电学单元' },
    { status: 'accessible', entryId: 'lesson', kind: 'file', name: longName },
  ]
  const requests: WorkspaceFilesRequest[] = []
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    requests.push(request)
    if (request.type === 'root') return root
    if (request.type === 'list') return { entries: request.directoryEntryId === 'root' ? entries : [] }
    if (request.type === 'watch') return { workspaceId: 'workspace', watching: true }
    if (request.type === 'resolve') return { ...root, entryId: request.entryId,
      resolvedPath: `${directory}\\${request.entryId === 'unit' ? '电学单元' : longName}` }
    throw new Error(`Unexpected file operation: ${request.type}`)
  }, { subscribe: () => () => {} }) as WorkspaceFilesAPI
  const onSaveDirectoryChange = vi.fn(), openFile = vi.fn(async () => {})
  const props = {
    state: { workspace: directory, treeVersion: 0 }, workspaceFiles: files, onSaveDirectoryChange,
    operation: vi.fn(async () => ({ entries: [{ name: '只读说明.md', kind: 'file', path: `${directory}\\只读说明.md` }] })),
    actions: { setSelectedDirectory: vi.fn(), setMobilePane: vi.fn(), openFile, run: async (action: () => Promise<void>) => action() },
  } as unknown as LessonWorkspaceViewProps
  const view = (value: LessonWorkspaceViewProps) => <WorkbenchSessionPortalProvider><Navigation props={value} /></WorkbenchSessionPortalProvider>
  const { rerender } = render(view(props))

  const rootButton = await screen.findByRole('button', { name: '工作空间根目录' })
  expect(screen.getAllByText('自然科学')).toHaveLength(1)
  expect(rootButton).toHaveTextContent('自然科学')
  expect(rootButton).toHaveAttribute('title', directory)
  expect(rootButton.querySelector('.lucide-folder')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: '电学单元' }))
  await waitFor(() => expect(screen.getByLabelText('当前会话范围')).toHaveTextContent('电学单元'))
  expect(onSaveDirectoryChange).toHaveBeenLastCalledWith({ workspaceId: 'workspace', directoryEntryId: 'unit' })
  fireEvent.click(rootButton)
  expect(screen.getByLabelText('当前会话范围')).toHaveTextContent('全部会话')
  expect(onSaveDirectoryChange).toHaveBeenLastCalledWith({ workspaceId: 'workspace', directoryEntryId: 'root' })

  const fileButton = screen.getByRole('button', { name: longName })
  expect(fileButton.querySelector('span')).toHaveAttribute('title', longName)
  fireEvent.click(fileButton)
  expect(fileButton).toHaveAttribute('aria-pressed', 'true')
  expect(openFile).not.toHaveBeenCalled()
  fireEvent.keyDown(fileButton, { key: 'Enter' })
  await waitFor(() => expect(openFile).toHaveBeenCalledWith({ name: longName, kind: 'file', path: `${directory}\\${longName}` }))
  const listed = requests.filter(request => request.type === 'list').length
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(requests.filter(request => request.type === 'list').length).toBeGreaterThan(listed))

  rerender(view({ ...props, workspaceFiles: undefined }))
  fireEvent.click(await screen.findByRole('button', { name: '只读说明.md' }))
  await waitFor(() => expect(screen.getByLabelText('当前会话范围')).toHaveTextContent('只读说明.md'))
  expect(screen.getAllByRole('button', { name: '工作空间根目录' })).toHaveLength(1)
  expect(screen.getAllByText('自然科学')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '工作空间根目录' }))
  expect(screen.getByLabelText('当前会话范围')).toHaveTextContent('全部会话')
})
