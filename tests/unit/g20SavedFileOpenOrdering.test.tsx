import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import { dispatchRevealInExplorer, REVEAL_IN_EXPLORER_EVENT, takePendingReveal, type RevealInExplorerDetail } from '../../src/renderer/workbench/revealInExplorer'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionProjection } from '../../src/shared/workbench/executionEvents'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest, WorkspaceListItem, WorkspaceListPage } from '../../src/shared/workbench/workspaceFiles'

let removeRevealListener = () => {}
afterEach(() => { removeRevealListener(); cleanup(); takePendingReveal(); localStorage.clear(); vi.restoreAllMocks() })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const directory = 'C:/workspace'
const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: directory, managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation: ConversationRecord = {
  conversationId: 'conversation', workspaceId: workspace.workspaceId, title: '保存成果', messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1,
}
const savedRun = (runId: string, callId: string, path: string): ExecutionRunRecord => ({
  schemaVersion: 1, runId, version: 1, input: { conversationId: conversation.conversationId, taskId: 'task', instruction: '保存文件',
    selection: { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'fixture-model' }, documents: [] }, status: 'completed', createdAt: 1, updatedAt: 1,
  messages: [], initialMessageCount: 0, requests: [], tools: [{ callId, providerCallId: callId, requestId: 'request',
    call: { name: 'file.write', input: {} }, state: 'returned', result: { kind: 'read', data: { saved: true, path } } }],
})

it('opens only the last clicked saved-file result when an earlier run receipt returns late', async () => {
  const first = deferred<ExecutionRunRecord | null>()
  const projection: ExecutionProjection = { conversationId: conversation.conversationId, cursor: 2, items: ['A', 'B'].map((name, index) => ({
    taskId: 'task', runId: `run-${name}`, itemId: `call-${name}`, source: 'builtin', type: 'tool', time: index + 1, sequence: index + 1,
    data: { status: 'returned', toolName: 'file.write', documentName: `${name}.html`, saveStatus: 'saved' }, content: [],
  })) }
  const ports = {
    workspace: vi.fn(async () => ({ workspace, conversations: [structuredClone(conversation)] })),
    conversation: vi.fn(async () => structuredClone(conversation)), submissions: vi.fn(async () => []),
    run: vi.fn((runId: string) => runId === 'run-A' ? first.promise : Promise.resolve(savedRun('run-B', 'call-B', `${directory}/B.html`))),
    timeline: vi.fn(async () => projection), events: vi.fn(async (_id: string, after = 0) => ({ events: [], cursor: after, hasMore: false })),
    blob: vi.fn(async () => 'unused'), edits: vi.fn(async () => []), subscribe: vi.fn(() => () => {}), subscribeEdits: vi.fn(() => () => {}),
  } satisfies Partial<ExecutionDesktopAPI>
  const revealed: RevealInExplorerDetail[] = []
  const listener = (event: Event) => { revealed.push((event as CustomEvent<RevealInExplorerDetail>).detail) }
  window.addEventListener(REVEAL_IN_EXPLORER_EVENT, listener)
  removeRevealListener = () => window.removeEventListener(REVEAL_IN_EXPLORER_EVENT, listener)
  render(<ExecutionAssistant root={directory} api={ports as unknown as ExecutionDesktopAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)

  fireEvent.click(await screen.findByRole('button', { name: '打开文件：A.html' }))
  fireEvent.click(screen.getByRole('button', { name: '打开文件：B.html' }))
  await waitFor(() => expect(revealed).toEqual([{ path: `${directory}/B.html`, kind: 'file', open: true }]))
  await act(async () => first.resolve(savedRun('run-A', 'call-A', `${directory}/A.html`)))

  expect(ports.run.mock.calls.map(([runId]) => runId)).toEqual(['run-A', 'run-B'])
  expect(revealed).toEqual([{ path: `${directory}/B.html`, kind: 'file', open: true }])
})

it('keeps the newer cached file selected and open when an earlier reveal finishes loading a child directory', async () => {
  const first = deferred<WorkspaceListPage>()
  const root = { workspaceId: workspace.workspaceId, rootEntryId: 'root', resolvedPath: directory }
  const entries: WorkspaceListItem[] = [
    { status: 'accessible', entryId: 'slow', name: 'slow', kind: 'directory' },
    { status: 'accessible', entryId: 'b', name: 'B.html', kind: 'file' },
  ]
  const requests: WorkspaceFilesRequest[] = []
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    requests.push(request)
    if (request.type === 'root') return root
    if (request.type === 'list') return request.directoryEntryId === 'slow' ? first.promise : { entries }
    if (request.type === 'watch') return { workspaceId: root.workspaceId, watching: true }
    if (request.type === 'resolve') return { workspaceId: root.workspaceId, entryId: request.entryId, kind: 'file',
      resolvedPath: `${directory}/${request.entryId === 'a' ? 'slow/A.html' : 'B.html'}` }
    throw new Error(`Unexpected file operation: ${request.type}`)
  }, { subscribe: () => () => {} }) as WorkspaceFilesAPI
  const onFile = vi.fn(), onScope = vi.fn()
  render(<WorkspaceFilesTree directory={directory} files={files} onFile={onFile} onDirectory={vi.fn()} onScope={onScope} />)
  const lastFile = await screen.findByRole('button', { name: 'B.html' })

  act(() => dispatchRevealInExplorer({ path: `${directory}/slow/A.html`, kind: 'file', open: true }))
  await waitFor(() => expect(requests.some(request => request.type === 'list' && request.directoryEntryId === 'slow')).toBe(true))
  act(() => dispatchRevealInExplorer({ path: `${directory}/B.html`, kind: 'file', open: true }))
  await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: 'B.html', kind: 'file', path: `${directory}/B.html` }))
  expect(lastFile).toHaveAttribute('aria-pressed', 'true')
  await act(async () => first.resolve({ entries: [{ status: 'accessible', entryId: 'a', name: 'A.html', kind: 'file' }] }))

  expect(lastFile).toHaveAttribute('aria-pressed', 'true')
  expect(onFile).toHaveBeenCalledTimes(1)
  expect(onScope.mock.calls).toEqual([[`${directory}/B.html`, 'file', root.workspaceId]])
  expect(screen.queryByRole('button', { name: 'A.html' })).not.toBeInTheDocument()
})

it('opens an external saved file without changing the selected workspace scope or save directory', async () => {
  const root = { workspaceId: workspace.workspaceId, rootEntryId: 'root', resolvedPath: directory }
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    if (request.type === 'root') return root
    if (request.type === 'list') return { entries: [{ status: 'accessible', entryId: 'b', name: 'B.html', kind: 'file' }] }
    if (request.type === 'watch') return { workspaceId: root.workspaceId, watching: true }
    if (request.type === 'resolve') return { workspaceId: root.workspaceId, entryId: request.entryId, kind: 'file', resolvedPath: `${directory}/B.html` }
    throw new Error(`Unexpected file operation: ${request.type}`)
  }, { subscribe: () => () => {} }) as WorkspaceFilesAPI
  const onFile = vi.fn(), onScope = vi.fn(), onSaveDirectoryChange = vi.fn()
  render(<WorkspaceFilesTree directory={directory} files={files} onFile={onFile} onDirectory={vi.fn()}
    onScope={onScope} onSaveDirectoryChange={onSaveDirectoryChange} />)
  const selectedFile = await screen.findByRole('button', { name: 'B.html' })
  fireEvent.click(selectedFile)
  await waitFor(() => expect(onScope).toHaveBeenLastCalledWith(`${directory}/B.html`, 'file', root.workspaceId))
  expect(selectedFile).toHaveAttribute('aria-pressed', 'true')
  expect(onSaveDirectoryChange).toHaveBeenLastCalledWith({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  onScope.mockClear(); onSaveDirectoryChange.mockClear()

  const externalPath = 'D:/external/saved.html'
  act(() => dispatchRevealInExplorer({ path: externalPath, kind: 'file', open: true }))
  expect(onFile.mock.calls).toEqual([[{ name: 'saved.html', kind: 'file', path: externalPath }]])
  expect(selectedFile).toHaveAttribute('aria-pressed', 'true')
  expect(onScope).not.toHaveBeenCalled()
  expect(onSaveDirectoryChange).not.toHaveBeenCalled()

  act(() => dispatchRevealInExplorer({ path: externalPath, kind: 'file' }))
  expect(screen.getByText('目标文件位于当前工作空间之外')).toBeInTheDocument()
  act(() => dispatchRevealInExplorer({ path: externalPath, kind: 'folder', open: true }))
  expect(screen.getByText('目标文件位于当前工作空间之外')).toBeInTheDocument()
  expect(onFile).toHaveBeenCalledTimes(1)
  expect(selectedFile).toHaveAttribute('aria-pressed', 'true')
  expect(onScope).not.toHaveBeenCalled()
  expect(onSaveDirectoryChange).not.toHaveBeenCalled()
})
