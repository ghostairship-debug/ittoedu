import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection } from '../../src/shared/workbench/executionEvents'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
const captureDocuments = async () => []
const prepareSend = async () => true
const workspace = (id: string): WorkspaceRecord => ({ workspaceId: id, rootPath: `C:/${id}`, managed: false,
  authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 })
const conversation = (space: string, id: string, title: string): ConversationRecord => ({ workspaceId: space, conversationId: id, title,
  messages: [], attachmentIds: [], runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] },
  inputDraft: `${title}草稿`, inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1 })
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  const a = conversation('A', 'a', '甲会话'), a2 = conversation('A', 'a2', '甲第二会话'), b = conversation('B', 'b', '乙会话')
  const records = new Map([a, a2, b].map(value => [value.conversationId, value]))
  const api = {
    workspace: vi.fn(async (root: string | null) => root === 'C:/B' ? { workspace: workspace('B'), conversations: [b] } : { workspace: workspace('A'), conversations: [a, a2] }),
    conversation: vi.fn(async (_space: string, id: string) => records.get(id) ?? null),
    submissions: vi.fn(async () => []), run: vi.fn(async () => null),
    timeline: vi.fn(async (id: string) => emptyExecutionProjection(id)),
    events: vi.fn(async () => ({ events: [], cursor: 0, hasMore: false })),
    edits: vi.fn(async () => []), subscribe: vi.fn(() => () => {}), subscribeEdits: vi.fn(() => () => {}),
    releaseTimeline: vi.fn(async () => {}),
  } as unknown as ExecutionDesktopAPI
  const changed = new Set<() => void>()
  const unsubscribe = vi.fn()
  vi.stubGlobal('desktopAPI', { onWorkspaceFilesChanged: (listener: () => void) => {
    changed.add(listener)
    return () => { changed.delete(listener); unsubscribe() }
  } })
  const renderSpace = (root: string) => <ExecutionAssistant root={root} api={api} captureDocuments={captureDocuments} prepareSend={prepareSend} />
  return { api, a, a2, b, changed, unsubscribe, renderSpace }
}

it('ignores a workspace watcher response after the Assistant has switched roots', async () => {
  const f = fixture(), late = deferred<Awaited<ReturnType<ExecutionDesktopAPI['workspace']>>>()
  const view = render(f.renderSpace('C:/A'))
  await screen.findByRole('button', { name: '甲会话' })
  await waitFor(() => expect(f.changed.size).toBe(1))
  vi.mocked(f.api.workspace).mockImplementationOnce(() => late.promise)
  act(() => { for (const listener of f.changed) listener() })
  view.rerender(f.renderSpace('C:/B'))
  await screen.findByRole('button', { name: '乙会话' })
  await act(async () => { late.resolve({ workspace: workspace('A'), conversations: [f.a, f.a2] }); await late.promise })
  expect(screen.getByRole('button', { name: '乙会话' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '甲会话' })).toBeNull()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('乙会话草稿')
  expect(f.unsubscribe).toHaveBeenCalled()
})

it('keeps the newest conversation list when same-root watcher reads complete out of order', async () => {
  const f = fixture(), late = deferred<Awaited<ReturnType<ExecutionDesktopAPI['workspace']>>>()
  render(f.renderSpace('C:/A'))
  await screen.findByRole('button', { name: '甲会话' })
  await waitFor(() => expect(f.changed.size).toBe(1))
  const extra = conversation('A', 'a3', '新加入的会话')
  vi.mocked(f.api.workspace).mockImplementationOnce(() => late.promise)
    .mockResolvedValueOnce({ workspace: workspace('A'), conversations: [f.a, f.a2, extra] })
  act(() => { for (const listener of f.changed) listener() })
  act(() => { for (const listener of f.changed) listener() })
  await screen.findByRole('button', { name: '新加入的会话' })
  await act(async () => { late.resolve({ workspace: workspace('A'), conversations: [f.a, f.a2] }); await late.promise })
  expect(screen.getByRole('button', { name: '新加入的会话' })).toBeInTheDocument()
})

it('does not activate an old conversation whose selection read completes in another workspace', async () => {
  const f = fixture(), late = deferred<ConversationRecord | null>()
  const read = vi.mocked(f.api.conversation).getMockImplementation()!
  vi.mocked(f.api.conversation).mockImplementation((space, id) => id === f.a2.conversationId ? late.promise : read(space, id))
  const view = render(f.renderSpace('C:/A'))
  await screen.findByRole('button', { name: '甲第二会话' })
  await waitFor(() => expect(screen.getByRole('button', { name: '新建会话' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '甲第二会话' }))
  await waitFor(() => expect(f.api.conversation).toHaveBeenCalledWith('A', 'a2'))
  view.rerender(f.renderSpace('C:/B'))
  await screen.findByRole('button', { name: '乙会话' })
  await act(async () => { late.resolve(f.a2); await late.promise })
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('乙会话草稿')
  expect(screen.queryByRole('button', { name: '甲第二会话' })).toBeNull()
})
