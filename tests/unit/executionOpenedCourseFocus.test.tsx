import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false,
  authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation = (conversationId: string, title: string): ConversationRecord => ({
  conversationId, title, workspaceId: workspace.workspaceId, messages: [], attachmentIds: [], inputDraft: '', inputAttachments: [],
  frozenContextRefs: [], runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, revision: 1, createdAt: 1, updatedAt: 1,
})
const opened = (name: 'file.create' | 'file.open', documentId = 'new-course', writable = true) => ({ kind: 'read', data: {
  documentId, target: 'host-issued-target', writable,
  ...(name === 'file.create' ? { course: { surfaceCount: 1, surfaces: [{ title: '第 1 页', kind: 'slide', childCount: 0 }] } } : { kind: 'course-v10' }),
} })
const resultEvent = (sequence: number, toolName: string, result: unknown, changes: Partial<ExecutionEvent> = {}): ExecutionEvent => ({
  eventId: `event-${sequence}`, conversationId: 'a', taskId: 'task', runId: 'run', itemId: `call-${sequence}`,
  time: sequence, sequence, source: 'builtin', type: 'tool', update: 'snapshot',
  data: { status: toolName === 'file.create' ? 'written' : 'completed', toolName, output: JSON.stringify(result) }, ...changes,
})

function fixture(history: ExecutionEvent[] = []) {
  const conversations = [conversation('a', '当前会话'), conversation('b', '其他会话')]
  const events = [...history], listeners = new Set<(event: ExecutionEvent) => void>()
  const api = {
    workspace: vi.fn(async () => ({ workspace, conversations: structuredClone(conversations) })),
    conversation: vi.fn(async (_workspaceId: string, id: string) => structuredClone(conversations.find(value => value.conversationId === id)!)),
    submissions: vi.fn(async () => []), run: vi.fn(async () => null),
    timeline: vi.fn(async (id: string) => foldExecutionEvents(emptyExecutionProjection(id), events.filter(event => event.conversationId === id))),
    events: vi.fn(async (id: string, after = 0) => ({ events: events.filter(event => event.conversationId === id && event.sequence > after), cursor: after, hasMore: false })),
    blob: vi.fn(async () => ''), edits: vi.fn(async () => []),
    subscribe: vi.fn((listener: (event: ExecutionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
  } satisfies Partial<ExecutionDesktopAPI>
  const locate = vi.fn(async (_documentId: string) => {})
  const props = { root: workspace.rootPath, api: api as unknown as ExecutionDesktopAPI,
    captureDocuments: async () => [], prepareSend: async () => true, onLocateDocument: locate }
  return { api, locate, props, emit: (event: ExecutionEvent) => {
    if (!events.some(value => value.eventId === event.eventId)) events.push(event)
    listeners.forEach(listener => listener(event))
  } }
}
async function mount(value: ReturnType<typeof fixture>) {
  const view = render(<ExecutionAssistant {...value.props} />)
  await waitFor(() => expect(value.api.events).toHaveBeenCalledWith('a', expect.any(Number), 5000))
  return view
}
async function switchConversation(title: string) {
  fireEvent.click(screen.getByRole('button', { name: title }))
  await waitFor(() => expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-current', 'page'))
}

it('shows a newly created formal course, and an explicit live open of the same course, through the existing document locator', async () => {
  const value = fixture()
  await mount(value)
  act(() => value.emit(resultEvent(1, 'file.create', opened('file.create'))))
  await waitFor(() => expect(value.locate).toHaveBeenCalledWith('new-course'))
  act(() => value.emit(resultEvent(2, 'file.open', opened('file.open'))))
  await waitFor(() => expect(value.locate.mock.calls).toEqual([['new-course'], ['new-course']]))
})

it('keeps readonly, reference, text, failed, external MCP and background results from changing the foreground document', async () => {
  const value = fixture()
  await mount(value)
  const ignored = [
    resultEvent(1, 'file.open', opened('file.open', 'reference-course', false)),
    resultEvent(2, 'file.read', { kind: 'read', data: { text: '参考正文', documentId: 'reference', writable: true } }),
    resultEvent(3, 'file.open', { kind: 'read', data: { kind: 'text', documentId: 'notes', target: 'target', writable: true } }),
    resultEvent(4, 'file.create', { kind: 'read', data: { path: 'saved.glx', openError: '文件已创建，但暂时无法打开' } }),
    resultEvent(5, 'file.open', { kind: 'error', code: 'file-tool-failed', message: '无法打开' }, { data: { toolName: 'file.open', status: 'failed' } }),
    resultEvent(6, 'file.open', opened('file.open'), { source: 'external-mcp' }),
  ]
  act(() => ignored.forEach(value.emit))
  act(() => value.emit(resultEvent(1, 'file.open', opened('file.open', 'background-course'), { eventId: 'background', conversationId: 'b', runId: 'background-run' })))
  await act(async () => {})
  expect(value.locate).not.toHaveBeenCalled()
  act(() => value.emit(resultEvent(7, 'file.create', opened('file.create'))))
  await waitFor(() => expect(value.locate).toHaveBeenCalledOnce())
})

it('does not navigate for loaded history or repeat a consumed result after rerendering or switching conversations', async () => {
  const prior = resultEvent(1, 'file.create', opened('file.create', 'old-course'))
  const value = fixture([prior]), view = await mount(value)
  expect(value.locate).not.toHaveBeenCalled()
  const live = resultEvent(2, 'file.create', opened('file.create'))
  act(() => value.emit(live))
  await waitFor(() => expect(value.locate).toHaveBeenCalledOnce())
  view.rerender(<ExecutionAssistant {...value.props} onLocateDocument={id => value.locate(id)} />)
  act(() => value.emit(live))
  await switchConversation('其他会话')
  await switchConversation('当前会话')
  act(() => value.emit(live))
  await act(async () => {})
  expect(value.locate).toHaveBeenCalledOnce()
})

it('discards a delayed open result after the selected conversation changes', async () => {
  const value = fixture()
  let resolve!: (output: string) => void
  value.api.blob.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
  await mount(value)
  const pending = resultEvent(1, 'file.open', null, { data: { toolName: 'file.open', status: 'completed',
    outputRef: { id: 'a'.repeat(64), bytes: 50000, mime: 'text/plain;charset=utf-8' } } })
  act(() => value.emit(pending))
  await waitFor(() => expect(value.api.blob).toHaveBeenCalledOnce())
  await switchConversation('其他会话')
  await act(async () => resolve(JSON.stringify(opened('file.open'))))
  expect(value.locate).not.toHaveBeenCalled()
  await switchConversation('当前会话')
  act(() => value.emit(pending))
  await act(async () => {})
  expect(value.api.blob).toHaveBeenCalledOnce()
  expect(value.locate).not.toHaveBeenCalled()
})

it('does not let an older asynchronous receipt pull focus back from a newer opened course', async () => {
  const value = fixture()
  let resolve!: (output: string) => void
  value.api.blob.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
  await mount(value)
  act(() => value.emit(resultEvent(1, 'file.open', null, { data: { toolName: 'file.open', status: 'completed',
    outputRef: { id: 'a'.repeat(64), bytes: 50000, mime: 'text/plain;charset=utf-8' } } })))
  act(() => value.emit(resultEvent(2, 'file.open', opened('file.open', 'latest-course'))))
  await waitFor(() => expect(value.locate.mock.calls).toEqual([['latest-course']]))
  await act(async () => resolve(JSON.stringify(opened('file.open', 'older-course'))))
  expect(value.locate.mock.calls).toEqual([['latest-course']])
})
