import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLessonWorkspaceController, type LessonWorkspaceControllerProps } from '../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../src/shared/lessonDesktopContract'
import type { LessonProject } from '../../src/shared/lessonWorkspace'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest, WorkspaceOperationResult } from '../../src/shared/workbench/workspaceFiles'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}

const project = (directory: string): LessonProject => ({ schemaVersion: 1, normalizedPath: `${directory}/project`, workspaceRoot: directory, name: directory, createdAt: 1 })
function controllerProps(lessonOperation: LessonWorkspaceControllerProps['lessonOperation']): LessonWorkspaceControllerProps {
  return { lessonOperation, projectPath: null, onOpenProject: async () => true, onNewProject: async () => true,
    tabs: { captureNavigationIdentity: () => '0', cancelNavigation: vi.fn(), showCurrentCourse: vi.fn(), drainAll: async () => true, setActiveTab: vi.fn() } as unknown as LessonWorkspaceControllerProps['tabs'] }
}

it.each(['list-lessons', 'list-projects'] as const)('keeps the newer workspace when the old %s returns late', async phase => {
  const delayed = deferred<LessonDesktopResult>()
  const operation = vi.fn(async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => {
    if (request.operation === 'recent-workspaces') return { recent: [] }
    if (request.operation === 'open-workspace') return { directory: request.directory }
    if ('directory' in request && request.directory === 'C:/A' && request.operation === phase) return delayed.promise
    if (request.operation === 'list-lessons') return { lessons: [] }
    if (request.operation === 'list-projects') return { projects: [project(request.directory)] }
    throw new Error(`Unexpected ${request.operation}`)
  })
  const hook = renderHook(() => useLessonWorkspaceController(controllerProps(operation)))
  let old!: Promise<void>
  act(() => { old = hook.result.current.actions.run(() => hook.result.current.actions.openWorkspace('C:/A')) })
  await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: phase, directory: 'C:/A' }))
  await act(async () => hook.result.current.actions.run(() => hook.result.current.actions.openWorkspace('C:/B')))
  expect(hook.result.current.state.busy).toBe(false)
  await act(async () => { delayed.resolve(phase === 'list-projects' ? { projects: [project('C:/A')] } : { lessons: [] }); await old })
  expect(hook.result.current.state.workspace).toBe('C:/B')
  expect(hook.result.current.state.projects).toEqual([project('C:/B')])
  expect(hook.result.current.state.activeDirectory).toEqual({ kind: 'workspace' })
  expect(localStorage.getItem('guoling-last-workspace')).toBe('C:/B')
})

it('does not let delayed startup restoration override a manual workspace choice', async () => {
  localStorage.setItem('guoling-last-workspace', 'C:/A')
  const recent = deferred<LessonDesktopResult>()
  const operation = vi.fn(async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => {
    if (request.operation === 'recent-workspaces') return recent.promise
    if (request.operation === 'open-workspace') return { directory: request.directory }
    if (request.operation === 'list-lessons') return { lessons: [] }
    if (request.operation === 'list-projects') return { projects: [] }
    throw new Error(`Unexpected ${request.operation}`)
  })
  const hook = renderHook(() => useLessonWorkspaceController(controllerProps(operation)))
  await act(async () => hook.result.current.actions.openWorkspace('C:/B'))
  await act(async () => { recent.resolve({ recent: ['C:/A'] }); await recent.promise })
  expect(hook.result.current.state.workspace).toBe('C:/B')
  expect(operation).not.toHaveBeenCalledWith({ operation: 'open-workspace', directory: 'C:/A' })
})

it('does not invalidate the current project listing while reading another workspace', async () => {
  const delayed = deferred<LessonDesktopResult>()
  const operation = async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => {
    if (request.operation === 'open-workspace') return { directory: request.directory }
    if (request.operation === 'list-projects') return request.directory === 'C:/B' ? delayed.promise : { projects: [project(request.directory)] }
    return { recent: [], lessons: [] }
  }
  const hook = renderHook(() => useLessonWorkspaceController(controllerProps(operation)))
  let opening!: Promise<void>
  act(() => { opening = hook.result.current.actions.openWorkspace('C:/B') })
  await waitFor(() => expect(hook.result.current.state.workspace).toBe('C:/B'))
  await act(async () => { await hook.result.current.actions.loadProjects('C:/A') })
  await act(async () => { delayed.resolve({ projects: [project('C:/B')] }); await opening })
  expect(hook.result.current.state.projects).toEqual([project('C:/B')])
})

it('does not start an old native project open after its input drain finishes in another workspace', async () => {
  const drain = deferred<void>()
  const operation = async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => request.operation === 'open-workspace'
    ? { directory: request.directory } : { recent: [], lessons: [], projects: [] }
  const props = { ...controllerProps(operation), onBeforeWorkspaceChange: vi.fn().mockImplementationOnce(() => drain.promise).mockResolvedValue(undefined),
    onOpenProject: vi.fn(async () => true) }
  const hook = renderHook(() => useLessonWorkspaceController(props))
  let opening!: Promise<void>
  act(() => { opening = hook.result.current.actions.openFile({ name: 'old.glx', path: 'C:/A/old.glx', kind: 'file' }) })
  await waitFor(() => expect(props.onBeforeWorkspaceChange).toHaveBeenCalledTimes(1))
  await act(async () => hook.result.current.actions.openWorkspace('C:/B'))
  await act(async () => { drain.resolve(); await opening })
  expect(props.onOpenProject).not.toHaveBeenCalled()
  expect(hook.result.current.state.workspace).toBe('C:/B')
  expect(hook.result.current.state.standalone).toBe(false)
})

it.each(['cancel', 'workspace', 'unmount'] as const)('aborts only the current PPT import on %s', async exit => {
  const opened = deferred<boolean>()
  let signal: AbortSignal | undefined
  const imported = vi.fn((_file, current?: AbortSignal) => { signal = current; return opened.promise })
  const operation = async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => request.operation === 'open-workspace'
    ? { directory: request.directory } : { recent: [], lessons: [], projects: [] }
  const props = { ...controllerProps(operation), onNewProjectFromPptx: imported }
  const hook = renderHook(() => useLessonWorkspaceController(props))
  const file = { name: 'lesson.pptx', arrayBuffer: async () => new Uint8Array([1, 2]).buffer } as File
  let pending!: Promise<void>
  act(() => { pending = hook.result.current.actions.run(async () => { await hook.result.current.actions.newCourseFromPptx(file) }) })
  await waitFor(() => expect(imported).toHaveBeenCalledTimes(1))
  expect(signal?.aborted).toBe(false)
  if (exit === 'cancel') act(() => hook.result.current.actions.cancelNewCourseFromPptx())
  else if (exit === 'workspace') await act(async () => hook.result.current.actions.openWorkspace('C:/B'))
  else hook.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { opened.resolve(true); await pending })
  if (exit !== 'unmount') {
    expect(hook.result.current.state.importingCourse).toBe(false)
    expect(hook.result.current.state.error).toBeNull()
    expect(hook.result.current.state.standalone).toBe(false)
  }
})

it.each(['keep-dialog', 'complete-new-operation'] as const)('keeps the new workspace while an old file refresh completes (%s)', async mode => {
  const delayed = deferred<{ entries: [] }>()
  let created = false, held = false
  const files = Object.assign(vi.fn(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    if (request.type === 'root') return { workspaceId: request.directory, rootEntryId: `${request.directory}/root`, resolvedPath: request.directory }
    if (request.type === 'watch' || request.type === 'unwatch') return { workspaceId: request.workspaceId, watching: request.type === 'watch' }
    if (request.type === 'create-text') {
      created = true
      const targetPath = `${request.workspaceId}/new.txt`
      return { operationId: request.operationId, status: 'success', affectedPaths: [targetPath],
        items: [{ status: 'success', targetPath, affectedPaths: [targetPath] }] } satisfies WorkspaceOperationResult
    }
    if (request.type === 'list') {
      if (created && request.workspaceId === 'C:/A') { held = true; return delayed.promise }
      return { entries: [] }
    }
    throw new Error(`Unexpected ${request.type}`)
  }), { subscribe: () => () => {} }) as unknown as WorkspaceFilesAPI
  const onFile = vi.fn(), onSaveDirectoryChange = vi.fn()
  const props = { files, onFile, onDirectory: vi.fn(), onSaveDirectoryChange }
  const view = render(<WorkspaceFilesTree directory="C:/A" {...props} />)
  await screen.findByRole('button', { name: '工作空间根目录' })
  fireEvent.click(screen.getByLabelText('新建文件或文件夹'))
  fireEvent.click(screen.getByRole('menuitem', { name: '新建 TXT 文档' }))
  fireEvent.click(within(await screen.findByRole('dialog', { name: '文件操作' })).getByRole('button', { name: '确认' }))
  await waitFor(() => expect(held).toBe(true))
  view.rerender(<WorkspaceFilesTree directory="C:/B" {...props} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '工作空间根目录' })).toHaveAttribute('title', 'C:/B'))
  fireEvent.click(screen.getByLabelText('新建文件或文件夹'))
  fireEvent.click(screen.getByRole('menuitem', { name: '新建 TXT 文档' }))
  const currentDialog = await screen.findByRole('dialog', { name: '文件操作' })
  if (mode === 'complete-new-operation') {
    fireEvent.click(within(currentDialog).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: 'new.txt', kind: 'file', path: 'C:/B/new.txt' }))
  }
  await act(async () => { delayed.resolve({ entries: [] }); await delayed.promise })
  if (mode === 'keep-dialog') {
    expect(currentDialog).toBeInTheDocument()
    expect(onFile).not.toHaveBeenCalled()
    expect(within(currentDialog).getByRole('button', { name: '确认' })).toBeEnabled()
  } else expect(onFile).toHaveBeenCalledTimes(1)
  expect(onSaveDirectoryChange).toHaveBeenLastCalledWith({ workspaceId: 'C:/B', directoryEntryId: 'C:/B/root' })
})
