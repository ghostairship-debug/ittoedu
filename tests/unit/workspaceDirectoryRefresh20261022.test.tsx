import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { WorkspaceFilesAPI, WorkspaceFilesChange, WorkspaceFilesRequest, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads only the expanded folder or changed parent, retaining unknown-path refresh and watch cleanup', async () => {
  const root = { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: '/work' }
  const entry = (entryId: string, name: string, kind: 'file' | 'directory'): WorkspaceListItem => ({ status: 'accessible', entryId, name, kind })
  const pages: Record<string, WorkspaceListItem[]> = { root: [entry('a', 'unit-a', 'directory'), entry('b', 'unit-b', 'directory')], a: [entry('note-a', 'a.md', 'file')], b: [entry('note-b', 'b.md', 'file')] }
  const listeners = new Set<(event: WorkspaceFilesChange) => void>()
  const requests: WorkspaceFilesRequest[] = []
  const listCalls = (id: string) => requests.filter(request => request.type === 'list' && request.directoryEntryId === id).length
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    requests.push(request)
    if (request.type === 'root') return root
    if (request.type === 'watch' || request.type === 'unwatch') return { workspaceId: root.workspaceId, watching: request.type === 'watch' }
    if (request.type === 'list') return { entries: pages[request.directoryEntryId] ?? [] }
    throw new Error(`Unexpected request ${request.type}`)
  }, { subscribe(listener: (event: WorkspaceFilesChange) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }) as unknown as WorkspaceFilesAPI
  const view = render(<WorkspaceFilesTree directory="/work" files={files} onFile={vi.fn()} onDirectory={vi.fn()} />)
  await screen.findByRole('button', { name: 'unit-a' })
  fireEvent.click(screen.getByRole('button', { name: '展开 unit-a' }))
  await screen.findByRole('button', { name: 'a.md' })
  fireEvent.click(screen.getByRole('button', { name: '展开 unit-b' }))
  await screen.findByRole('button', { name: 'b.md' })
  expect(listCalls('root')).toBe(1)
  expect(listCalls('a')).toBe(1)
  expect(listCalls('b')).toBe(1)
  pages.a = [...pages.a!, entry('new', 'new.md', 'file')]
  act(() => { for (const listener of listeners) listener({ workspaceId: root.workspaceId, changedPaths: ['unit-a/new.md'] }) })
  await screen.findByRole('button', { name: 'new.md' })
  expect(listCalls('root')).toBe(1)
  expect(listCalls('a')).toBe(2)
  expect(listCalls('b')).toBe(1)
  act(() => { for (const listener of listeners) listener({ workspaceId: root.workspaceId }) })
  await waitFor(() => expect(listCalls('b')).toBe(2))
  expect(listCalls('root')).toBe(2)
  expect(listCalls('a')).toBe(3)
  // Some watcher backends report only the new directory name. Resolve its
  // parent first, then reload that expanded handle without refreshing siblings.
  pages.root = [entry('a', 'renamed', 'directory'), entry('b', 'unit-b', 'directory')]
  pages.a = [...pages.a!, entry('renamed-note', 'after-rename.md', 'file')]
  act(() => { for (const listener of listeners) listener({ workspaceId: root.workspaceId, changedPaths: ['renamed'] }) })
  await screen.findByRole('button', { name: 'after-rename.md' })
  expect(screen.getByRole('button', { name: 'renamed' })).toHaveAttribute('data-entry-id', 'a')
  expect(listCalls('root')).toBe(3)
  expect(listCalls('a')).toBe(4)
  expect(listCalls('b')).toBe(2)
  const watched = requests.find((request): request is Extract<WorkspaceFilesRequest, { type: 'watch' }> => request.type === 'watch')!
  view.unmount()
  expect(requests).toContainEqual({ type: 'unwatch', workspaceId: root.workspaceId, watchId: watched.watchId })
})
