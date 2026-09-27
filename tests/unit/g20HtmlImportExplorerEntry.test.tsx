import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

afterEach(cleanup)

const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
  if (request.type === 'root') return { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: 'C:\\lesson' }
  if (request.type === 'watch') return { workspaceId: 'workspace', watching: true }
  if (request.type === 'list') return { entries: request.directoryEntryId === 'root' ? [
    { status: 'accessible', entryId: 'folder', name: 'unit', kind: 'directory' },
    { status: 'accessible', entryId: 'html', name: 'page.HTML', kind: 'file' },
    { status: 'accessible', entryId: 'note', name: 'notes.md', kind: 'file' },
  ] : [] }
  if (request.type === 'resolve') return { workspaceId: 'workspace', entryId: request.entryId, kind: request.entryId === 'folder' ? 'directory' : 'file', resolvedPath: `C:\\lesson\\${request.entryId}` }
  throw new Error(`Unexpected ${request.type}`)
}, { subscribe: () => () => {} }) as WorkspaceFilesAPI

function tree(onImportHtml?: (directory: { workspaceId: string; directoryEntryId: string }, sourceEntryId?: string) => void) {
  render(<WorkspaceFilesTree directory="C:\\lesson" files={files} onFile={vi.fn()} onDirectory={vi.fn()} onImportHtml={onImportHtml} />)
}

it('offers HTML import from blank space, a folder, and an HTML file with exact handles', async () => {
  const onImportHtml = vi.fn()
  tree(onImportHtml)
  const folder = await screen.findByRole('button', { name: 'unit' })

  fireEvent.contextMenu(screen.getByRole('tree', { name: '工作空间文件' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '导入 HTML 页面…' }))
  expect(onImportHtml).toHaveBeenLastCalledWith({ workspaceId: 'workspace', directoryEntryId: 'root' }, undefined)

  fireEvent.contextMenu(folder)
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '导入 HTML 页面…' }))
  expect(onImportHtml).toHaveBeenLastCalledWith({ workspaceId: 'workspace', directoryEntryId: 'folder' }, undefined)

  fireEvent.contextMenu(screen.getByRole('button', { name: 'page.HTML' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '作为互动页导入' }))
  expect(onImportHtml).toHaveBeenLastCalledWith({ workspaceId: 'workspace', directoryEntryId: 'root' }, 'html')
  expect(onImportHtml).toHaveBeenCalledTimes(3)

  fireEvent.contextMenu(screen.getByRole('button', { name: 'notes.md' }))
  expect(within(screen.getByRole('menu', { name: '文件菜单' })).queryByRole('menuitem', { name: /导入 HTML|作为互动页导入/ })).toBeNull()
})

it('does not advertise an unwired HTML import action', async () => {
  tree()
  await screen.findByRole('button', { name: 'unit' })
  fireEvent.contextMenu(screen.getByRole('tree', { name: '工作空间文件' }))
  expect(within(screen.getByRole('menu', { name: '文件菜单' })).queryByRole('menuitem', { name: '导入 HTML 页面…' })).toBeNull()
})
