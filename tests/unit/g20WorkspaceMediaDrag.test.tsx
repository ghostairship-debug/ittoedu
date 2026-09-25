import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import {
  parseWorkspaceEntryDrag, parseWorkspaceMediaDrag, resolveWorkspaceMediaDrag,
  WORKSPACE_ENTRIES_DRAG_TYPE, WORKSPACE_MEDIA_DRAG_TYPE,
} from '../../src/renderer/lessonWorkspace/workspaceMediaDrag'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'

afterEach(cleanup)

const entries: WorkspaceListItem[] = [
  { status: 'accessible', entryId: 'image', name: 'photo.PNG', kind: 'file' },
  { status: 'accessible', entryId: 'audio', name: 'sound.mp3', kind: 'file' },
  { status: 'accessible', entryId: 'note', name: 'notes.md', kind: 'file' },
  { status: 'accessible', entryId: 'folder', name: 'media', kind: 'directory' },
]

function files(onMove = vi.fn()) {
  const operate = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    if (request.type === 'root') return { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: 'C:\\lesson' }
    if (request.type === 'watch') return { workspaceId: 'workspace', watching: true }
    if (request.type === 'list') return { entries: request.directoryEntryId === 'root' ? entries : [] }
    if (request.type === 'resolve') return { workspaceId: 'workspace', entryId: request.entryId, kind: 'file', resolvedPath: `C:\\lesson\\${request.entryId}.${request.entryId === 'audio' ? 'mp3' : 'png'}` }
    if (request.type === 'move') { onMove(request); return { operationId: request.operationId, status: 'success', items: request.sourceEntryIds.map(sourceEntryId => ({ status: 'success', sourceEntryId, affectedPaths: [] })), affectedPaths: [] } }
    throw new Error(`Unexpected ${request.type}`)
  }, { subscribe: () => () => {} }) as WorkspaceFilesAPI
  return operate
}

function transfer() {
  const data = new Map<string, string>()
  return {
    data,
    value: { setData: (type: string, value: string) => { data.set(type, value) }, getData: (type: string) => data.get(type) ?? '', get types() { return [...data.keys()] }, effectAllowed: 'uninitialized', dropEffect: 'none' },
  }
}

it('adds a path-free media payload only for a pure media selection, while preserving tree move transport', async () => {
  const onMove = vi.fn()
  render(<WorkspaceFilesTree directory="C:\\lesson" files={files(onMove)} onFile={vi.fn()} onDirectory={vi.fn()} />)
  const image = await screen.findByRole('button', { name: 'photo.PNG' })
  const audio = screen.getByRole('button', { name: 'sound.mp3' })
  fireEvent.click(image)
  fireEvent.click(audio, { ctrlKey: true })
  const mediaDrag = transfer()
  fireEvent.dragStart(image, { dataTransfer: mediaDrag.value })
  expect(parseWorkspaceEntryDrag(mediaDrag.value.getData(WORKSPACE_ENTRIES_DRAG_TYPE))).toEqual({ workspaceId: 'workspace', ids: ['image', 'audio'] })
  expect(parseWorkspaceMediaDrag(mediaDrag.value.getData(WORKSPACE_MEDIA_DRAG_TYPE))).toEqual({ version: 1, workspaceId: 'workspace', entryIds: ['image', 'audio'] })
  expect(JSON.stringify([...mediaDrag.data.values()])).not.toContain('C:\\lesson')
  expect(mediaDrag.value.effectAllowed).toBe('copyMove')
  fireEvent.click(screen.getByRole('button', { name: 'notes.md' }), { ctrlKey: true })
  const mixedDrag = transfer()
  fireEvent.dragStart(image, { dataTransfer: mixedDrag.value })
  expect(parseWorkspaceEntryDrag(mixedDrag.value.getData(WORKSPACE_ENTRIES_DRAG_TYPE))?.ids).toEqual(['image', 'audio', 'note'])
  expect(mixedDrag.data.has(WORKSPACE_MEDIA_DRAG_TYPE)).toBe(false)
  const folderDrag = transfer()
  fireEvent.dragStart(screen.getByRole('button', { name: 'media' }), { dataTransfer: folderDrag.value })
  expect(folderDrag.data.has(WORKSPACE_ENTRIES_DRAG_TYPE)).toBe(true)
  expect(folderDrag.data.has(WORKSPACE_MEDIA_DRAG_TYPE)).toBe(false)
  fireEvent.drop(screen.getByRole('button', { name: 'media' }).closest('.workspace-tree-row')!, { dataTransfer: mediaDrag.value })
  await waitFor(() => expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ type: 'move', sourceEntryIds: ['image', 'audio'], targetDirectoryId: 'folder' })))
})

it('rejects malformed, duplicated, foreign and changed handles before a target imports anything', async () => {
  expect(() => parseWorkspaceMediaDrag('{')).toThrow('媒体拖拽数据无效')
  expect(() => parseWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['a', 'a'] }))).toThrow('媒体拖拽数据无效')
  expect(() => parseWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['a'], resolvedPath: 'C:\\fake.png' }))).toThrow('媒体拖拽数据无效')
  expect(() => parseWorkspaceMediaDrag('C:\\fake.png')).toThrow('媒体拖拽数据无效')
  const host = files()
  await expect(resolveWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'other', entryIds: ['image'] }), 'C:\\lesson', host)).rejects.toThrow('媒体不属于当前工作空间')
  await expect(resolveWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['image', 'audio'] }), 'C:\\lesson', host)).resolves.toEqual([
    { workspaceId: 'workspace', entryId: 'image', kind: 'file', resolvedPath: 'C:\\lesson\\image.png', mediaKind: 'image' },
    { workspaceId: 'workspace', entryId: 'audio', kind: 'file', resolvedPath: 'C:\\lesson\\audio.mp3', mediaKind: 'audio' },
  ])
  const changed = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => request.type === 'root'
    ? { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: 'C:\\lesson' }
    : { workspaceId: 'workspace', entryId: 'image', kind: 'directory', resolvedPath: 'C:\\lesson\\image.png' }) as WorkspaceFilesAPI
  await expect(resolveWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['image'] }), 'C:\\lesson', changed)).rejects.toThrow('媒体文件已变化')
  const renamed = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => request.type === 'root'
    ? { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: 'C:\\lesson' }
    : { workspaceId: 'workspace', entryId: 'image', kind: 'file', resolvedPath: 'C:\\lesson\\notes.md' }) as WorkspaceFilesAPI
  await expect(resolveWorkspaceMediaDrag(JSON.stringify({ version: 1, workspaceId: 'workspace', entryIds: ['image'] }), 'C:\\lesson', renamed)).rejects.toThrow('媒体文件已变化')
})
