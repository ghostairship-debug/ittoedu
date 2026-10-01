import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant, type ExecutionAssistantHandle } from '../../src/renderer/workbench/ExecutionAssistant'
import { createRef } from 'react'
import { WorkbenchSessionDock, WorkbenchSessionPortalProvider, useWorkbenchSessionDock } from '../../src/renderer/workbench/WorkbenchSessionPortal'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import { EXECUTION_NO_PROGRESS, MODEL_REQUEST_BUDGET_EXHAUSTED } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation = (id: string, title: string, inputDraft = ''): ConversationRecord => ({
  conversationId: id, workspaceId: workspace.workspaceId, title, messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft, inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1,
})
const run = (conversationId: string): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'run', version: 1, input: { conversationId, taskId: 'task', instruction: 'instruction',
    selection: { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'model' }, documents: [] },
  budget: { maxRequests: 1, maxToolCalls: 1, maxContextBytes: 100 }, status: 'running', createdAt: 1, updatedAt: 1,
  messages: [], initialMessageCount: 0, requests: [], tools: [],
})

function executionFixture(initial: ConversationRecord[]) {
  const state = new Map(initial.map(value => [value.conversationId, structuredClone(value)]))
  let next = initial.length
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const api: ExecutionDesktopAPI = {
    workspace: vi.fn(async () => ({ workspace, conversations: [...state.values()].map(value => structuredClone(value)) })),
    conversations: vi.fn(async () => [...state.values()].map(value => structuredClone(value))),
    createConversation: vi.fn(async (_workspaceId, title = '新会话', home) => {
      const created = { ...conversation(`c${++next}`, title), home: home ? { ...home, workspaceId: _workspaceId } : undefined }; state.set(created.conversationId, created); return structuredClone(created)
    }),
    setConversationHome: vi.fn(async input => {
      const saved = { ...state.get(input.conversationId)!, home: input.home ? { ...input.home, workspaceId: input.workspaceId } : undefined }
      state.set(saved.conversationId, saved); return structuredClone(saved)
    }),
    conversation: vi.fn(async (_workspaceId, id) => structuredClone(state.get(id) ?? null)),
    draft: vi.fn(async (input: Parameters<ExecutionDesktopAPI['draft']>[0]) => {
      const current = state.get(input.conversationId)!
      if (current.revision !== input.expectedRevision) throw new Error('stale')
      const saved: ConversationRecord = { ...current, inputDraft: input.text, inputAttachments: input.attachments ?? [], revision: current.revision + 1,
        frozenContextRefs: input.documents.map((value, index) => ({ contextRefId: `ref-${index}`, documentId: value.documentId,
          epoch: value.epoch, revision: value.revision, writeScope: value.writable })) }
      state.set(saved.conversationId, saved); return structuredClone(saved)
    }),
    renameConversation: vi.fn(async input => {
      const saved = { ...state.get(input.conversationId)!, title: input.title, revision: input.expectedRevision + 1 }
      state.set(saved.conversationId, saved); return structuredClone(saved)
    }),
    deleteConversation: vi.fn(async input => { state.delete(input.conversationId) }),
    send: vi.fn(async input => {
      const current = state.get(input.conversationId)!
      if (current.revision !== input.expectedRevision) throw new Error('stale')
      const saved = { ...current, inputDraft: '', inputAttachments: [], revision: current.revision + 1, messages: [...current.messages,
        { messageId: 'message', role: 'user' as const, text: input.text, createdAt: 2, attachmentIds: [], runId: 'run' }],
        runIndex: { ...current.runIndex, builtinRunIds: [...current.runIndex.builtinRunIds, 'run'] } }
      state.set(saved.conversationId, saved); return { run: run(input.conversationId), conversation: structuredClone(saved), submission: {
        submissionId: input.submissionId, workspaceId: input.workspaceId, conversationId: input.conversationId, state: 'accepted' as const,
        mode: input.mode ?? 'queue' as const, text: input.text, documents: input.documents, attachments: input.attachments ?? [],
        model: { provider: 'fixture-provider', model: 'fixture-model', accountId: 'teacher-account', billing: 'token-plan' }, createdAt: 2, updatedAt: 2, runId: 'run',
      } }
    }),
    submission: vi.fn(async () => null), submissions: vi.fn(async () => []),
    deleteSubmission: vi.fn(async () => { throw new Error('unused') }), pauseQueue: vi.fn(async () => {}), resumeQueue: vi.fn(async () => {}),
    run: vi.fn(async () => null), stop: vi.fn(async () => null),
    events: vi.fn(async (_conversationId, after = 0) => ({ events: [], cursor: after, hasMore: false })),
    searchEvents: vi.fn(async () => ({ hits: [], cursor: 0, hasMore: false })),
    timeline: vi.fn(async id => emptyExecutionProjection(id)), blob: vi.fn(async () => 'blob'), edits: vi.fn(async () => []),
    subscribe: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener) }), subscribeEdits: vi.fn(() => () => {}),
  }
  return { api, state, emit: (event: ExecutionEvent) => listeners.forEach(listener => listener(event)) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const streamEvent = (sequence: number, text: string, endedRun?: string): ExecutionEvent => ({
  conversationId: 'a', taskId: endedRun ?? 'task', runId: endedRun ?? 'run', time: sequence, source: 'builtin',
  eventId: `event-${sequence}`, sequence, itemId: endedRun ? 'end' : 'answer', type: endedRun ? 'run.end' : 'text',
  update: endedRun ? 'snapshot' : 'append', data: endedRun ? { status: 'failed' } : { text },
})

const settingsView = (configured: boolean): ExecutionSettingsView => ({
  secureStorageAvailable: true,
  connections: configured ? [{ connection: { id: 'connection', revision: 1, provider: 'fixture-provider', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'teacher-account',
    auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false }] : [],
  profile: { revision: 1, updatedAt: '2026-09-23T00:00:00.000Z', roles: { conversation: configured ? { connectionId: 'connection', model: 'fixture-model' } : null, vision: null, imageGenerate: null, imageEdit: null } },
})
const settingsFixture = (configured: boolean): ExecutionSettingsAPI => ({
  read: vi.fn(async () => settingsView(configured)),
  probeCapabilities: vi.fn(async () => { throw new Error('unused') }),
  saveConnection: vi.fn(async () => { throw new Error('unused') }), saveProfile: vi.fn(async () => { throw new Error('unused') }),
  revokeConnection: vi.fn(async () => {}), discoverModels: vi.fn(async () => ({ connectionId: 'connection', connectionRevision: 1, models: [], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '2026-09-25T00:00:00.000Z' })),
  startOAuthLogin: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })),
  oauthLoginStatus: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })), cancelOAuthLogin: vi.fn(async () => {}),
})

function ScopeControls() {
  const dock = useWorkbenchSessionDock()
  return <>
    <button onClick={() => dock.setScope?.({ kind: 'folder', path: 'Unit', workspaceId: 'file-service-id' })}>筛选 Unit</button>
    <button onClick={() => dock.setScope?.({ kind: 'file', path: 'Unit/a.md', workspaceId: 'file-service-id' })}>筛选 a.md</button>
    <button onClick={() => dock.setScope?.(null)}>全部会话</button>
  </>
}

it('keeps middle and tail text flowing through notification bursts while an old failed run refreshes only once', async () => {
  const initial = conversation('a', '有失败历史的会话')
  const { api, emit } = executionFixture([initial])
  const historicalEnd = streamEvent(1, '', 'old-failure')
  const historicalRead = deferred<ConversationRecord | null>()
  const firstPage = deferred<Awaited<ReturnType<ExecutionDesktopAPI['events']>>>()
  const middlePage = deferred<Awaited<ReturnType<ExecutionDesktopAPI['events']>>>()
  vi.mocked(api.timeline).mockResolvedValue(foldExecutionEvents(emptyExecutionProjection('a'), [historicalEnd]))
  vi.mocked(api.conversation).mockImplementationOnce(() => historicalRead.promise)
  vi.mocked(api.events)
    .mockResolvedValueOnce({ events: [], cursor: 1, hasMore: false })
    .mockImplementationOnce(() => firstPage.promise)
    .mockImplementationOnce(() => middlePage.promise)
    .mockResolvedValueOnce({ events: [streamEvent(4, '尾段')], cursor: 4, hasMore: false })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(api.conversation).toHaveBeenCalledTimes(1))

  act(() => { for (let index = 0; index < 20; index += 1) emit(streamEvent(2, '首段')) })
  await waitFor(() => expect(api.events).toHaveBeenCalledTimes(2))
  await act(async () => firstPage.resolve({ events: [streamEvent(2, '首段')], cursor: 2, hasMore: false }))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段')
  expect(api.events).toHaveBeenCalledTimes(3)
  act(() => { for (let index = 0; index < 20; index += 1) emit(streamEvent(4, '尾段')) })
  await act(async () => middlePage.resolve({ events: [streamEvent(3, '中段')], cursor: 3, hasMore: false }))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段中段尾段')
  expect(vi.mocked(api.events).mock.calls.map(call => call[1])).toEqual([1, 1, 2, 3])
  expect(api.conversation).toHaveBeenCalledTimes(1) // The held terminal read did not block either text page.

  await act(async () => historicalRead.resolve(initial))
  await waitFor(() => expect(api.conversation).toHaveBeenCalledTimes(5)) // One bounded hydration retry.
  vi.mocked(api.events).mockResolvedValueOnce({ events: [streamEvent(5, '继续')], cursor: 5, hasMore: false })
  await act(async () => emit(streamEvent(5, '继续')))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段中段尾段继续')
  expect(api.conversation).toHaveBeenCalledTimes(5)

  vi.mocked(api.events)
    .mockResolvedValueOnce({ events: [streamEvent(6, '补齐')], cursor: 6, hasMore: true })
    .mockRejectedValueOnce(new Error('A later page is temporarily unavailable'))
    .mockResolvedValueOnce({ events: [], cursor: 6, hasMore: false })
  await act(async () => emit(streamEvent(6, '补齐')))
  await act(async () => emit(streamEvent(6, '补齐')))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段中段尾段继续补齐')
  expect(api.conversation).toHaveBeenCalledTimes(5)
})

it('refreshes new terminal messages without replacing local draft attachments, newer revisions, or another conversation', async () => {
  const initial = { ...conversation('a', '会话 A', '原草稿'), inputAttachments: [
    { attachmentId: '11111111-1111-4111-8111-111111111111', representationId: 'source' },
  ] }
  const { api, state, emit } = executionFixture([initial, conversation('b', '会话 B', '乙会话草稿')])
  const terminalReads = [deferred<ConversationRecord | null>(), deferred<ConversationRecord | null>(), deferred<ConversationRecord | null>()]
  let readIndex = 0
  vi.mocked(api.conversation).mockImplementation(async (_workspaceId, id) => id === 'a'
    ? terminalReads[readIndex++]!.promise : structuredClone(state.get(id) ?? null))
  const events: ExecutionEvent[] = []
  vi.mocked(api.events).mockImplementation(async (id, after = 0) => ({ events: events.filter(event => event.conversationId === id && event.sequence > after), cursor: id === 'a' ? events.length : 0, hasMore: false }))
  const ref = createRef<ExecutionAssistantHandle>()
  render(<ExecutionAssistant ref={ref} root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(api.events).toHaveBeenCalledTimes(1))
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  const end = (sequence: number) => { const event = streamEvent(sequence, '', `ended-${sequence}`); events.push(event); emit(event) }
  await act(async () => end(1))
  fireEvent.change(composer, { target: { value: '正在编辑的新草稿' } })
  const replied: ConversationRecord = { ...initial, revision: 2, inputDraft: '', inputAttachments: [], messages: [
    { messageId: 'reply', role: 'assistant', text: '任务回复', runId: 'ended-1', createdAt: 2, attachmentIds: [] },
  ] }
  state.set('a', replied)
  await act(async () => terminalReads[0]!.resolve(replied))
  expect(composer).toHaveValue('正在编辑的新草稿')
  await act(async () => ref.current!.preserveDraft())
  expect(api.draft).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 2,
    text: '正在编辑的新草稿', attachments: initial.inputAttachments }))

  await act(async () => end(2))
  fireEvent.change(composer, { target: { value: '第四版草稿' } })
  await act(async () => ref.current!.preserveDraft())
  const stale = structuredClone(state.get('a')!)
  fireEvent.change(composer, { target: { value: '第五版草稿' } })
  await act(async () => ref.current!.preserveDraft())
  await act(async () => terminalReads[1]!.resolve(stale))
  await act(async () => ref.current!.preserveDraft())
  expect(api.draft).toHaveBeenCalledTimes(3) // A late revision 4 must not replace already saved revision 5.
  expect(composer).toHaveValue('第五版草稿')

  await act(async () => end(3))
  fireEvent.click(screen.getByRole('button', { name: '会话 B' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('乙会话草稿'))
  await act(async () => terminalReads[2]!.resolve({ ...replied, revision: 6 }))
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('乙会话草稿')
  expect(screen.getByRole('button', { name: '会话 B' })).toHaveAttribute('aria-current', 'page')
})

it('preserves a focused unsent composer through the existing close handle and waits for its write', async () => {
  const { api, state } = executionFixture([conversation('a', '未发送要求')])
  const ref = createRef<ExecutionAssistantHandle>()
  render(<ExecutionAssistant ref={ref} root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).not.toBeDisabled())
  const input = screen.getByRole('textbox', { name: '给创作助手发消息' })
  input.focus()
  fireEvent.change(input, { target: { value: '保持焦点，关闭后还要继续写。' } })
  expect(input).toHaveFocus()
  await ref.current!.preserveDraft()
  expect(state.get('a')?.inputDraft).toBe('保持焦点，关闭后还要继续写。')
})

it('restoring an old failed message keeps a different new draft until an explicit replacement choice', async () => {
  const { api } = executionFixture([conversation('a', '失败消息')])
  vi.mocked(api.submissions).mockResolvedValue([{ submissionId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace', conversationId: 'a',
    state: 'failed', mode: 'queue', text: '旧要求', documents: [], attachments: [], createdAt: 1, updatedAt: 1,
    failure: { code: 'model-not-configured', message: '未连接' }, model: { provider: 'fixture', model: 'fixture', accountId: 'fixture', billing: 'unknown' } }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  const restore = await screen.findByRole('button', { name: '恢复到输入框' })
  const input = screen.getByRole('textbox', { name: '给创作助手发消息' })
  fireEvent.change(input, { target: { value: '新要求要保留' } })
  fireEvent.click(restore)
  const conflict = await screen.findByRole('alertdialog', { name: '输入框已有另一份草稿' })
  expect(input).toHaveValue('新要求要保留')
  fireEvent.click(within(conflict).getByRole('button', { name: '保留当前输入' }))
  expect(input).toHaveValue('新要求要保留')
  fireEvent.click(restore)
  fireEvent.click(await screen.findByRole('button', { name: '替换为这条消息' }))
  expect(input).toHaveValue('旧要求')
  expect(input).toHaveFocus()
})

it('labels a recovered stale document reference and only refreshes it after explicit reselection', async () => {
  const recovered: ConversationRecord = { ...conversation('a', '恢复的草稿', '继续改这段文字'), frozenContextRefs: [{ contextRefId: 'old', documentId: 'doc', epoch: 'old-epoch', revision: 1, writeScope: [{ kind: 'document' }] }] }
  const { api } = executionFixture([recovered])
  vi.stubGlobal('desktopAPI', { documents: { read: vi.fn(async () => ({ epoch: 'new-epoch', binding: { kind: 'file', path: 'C:/workspace/reopened.html' } })) } })
  const captureDocuments = vi.fn(async () => [{ documentId: 'doc', epoch: 'new-epoch', revision: 2, writable: [{ kind: 'document' as const }] }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={captureDocuments} prepareSend={vi.fn(async () => true)} />)
  await screen.findByText(/原引用需要重新选择/)
  expect(captureDocuments).not.toHaveBeenCalled()
  expect(api.draft).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('继续改这段文字')
  fireEvent.click(screen.getByRole('button', { name: '重新引用当前文档' }))
  await waitFor(() => expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ text: '继续改这段文字', documents: [expect.objectContaining({ epoch: 'new-epoch' })] })))
  await waitFor(() => expect(screen.queryByText(/原引用需要重新选择/)).toBeNull())
})

it('offers explicit reclaim for an externally paused queue through the existing resume operation', async () => {
  const { api } = executionFixture([conversation('a', '外部任务会话')])
  vi.mocked(api.submissions).mockResolvedValue([{ submissionId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace', conversationId: 'a',
    state: 'queued', mode: 'queue', text: '已接收的要求', documents: [], attachments: [], createdAt: 1, updatedAt: 1,
    queuePausedReason: 'external-handoff', model: { provider: 'fixture', model: 'fixture', accountId: 'fixture', billing: 'unknown' } }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  fireEvent.click(await screen.findByRole('button', { name: '接回并继续排队任务' }))
  await waitFor(() => expect(api.resumeQueue).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'a' }))
  expect(screen.getByRole('button', { name: '接回并立即执行' })).toBeVisible()
})

it('keeps the active conversation and draft while explorer selection filters homes and new sessions inherit the scope', async () => {
  const a = { ...conversation('a', '甲', '继续写'), home: { kind: 'file' as const, path: 'Unit/a.md', workspaceId: 'workspace' } }
  const b = { ...conversation('b', '乙'), home: { kind: 'folder' as const, path: 'Unit/Sub', workspaceId: 'workspace' } }
  const c = { ...conversation('c', '丙'), home: { kind: 'file' as const, path: 'Unit/gone.md', workspaceId: 'workspace', missing: true as const } }
  const { api } = executionFixture([a, b, c, conversation('d', '根会话')])
  const captureDocuments = vi.fn(async () => [])
  render(<WorkbenchSessionPortalProvider><ScopeControls /><WorkbenchSessionDock /><ExecutionAssistant root="C:/workspace" api={api}
    settingsAPI={settingsFixture(false)} captureDocuments={captureDocuments} prepareSend={vi.fn(async () => true)} /></WorkbenchSessionPortalProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '甲' })).toHaveAttribute('aria-current', 'page'))
  fireEvent.click(screen.getByRole('button', { name: '筛选 Unit' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /根会话/ })).toBeNull())
  expect(screen.getByRole('button', { name: '甲' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: '甲' })).toHaveTextContent('Unit/a.md')
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('继续写')
  expect(screen.getByRole('button', { name: '乙' })).toHaveTextContent('Unit/Sub')
  expect(screen.getByRole('button', { name: '丙' })).toHaveTextContent('已删除')
  fireEvent.click(screen.getByRole('button', { name: '筛选 a.md' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '乙' })).toBeNull())
  expect(screen.queryByRole('button', { name: '丙' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith('workspace', undefined, { kind: 'file', path: 'Unit/a.md' }))
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '关于这个文件' } })
  expect(screen.getByLabelText('本条消息的引用')).toHaveTextContent('默认引用 Unit/a.md')
  expect(captureDocuments).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '显示全部会话' }))
  expect(screen.getByRole('button', { name: '根会话' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '丙' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('所属文件已删除，本条消息不会自动引用该文件'))
})

it('opens ChatGPT OAuth setup directly from the assistant model menu without changing the saved model', async () => {
  const { api } = executionFixture([conversation('a', '会话 A')])
  const settingsAPI = settingsFixture(true)
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-provider · fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  fireEvent.click(within(screen.getByRole('group', { name: '对话模型选择' })).getByRole('button', { name: '登录 ChatGPT（OAuth）…' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: '连接账号' })).toBeInTheDocument())
  expect(screen.getByRole('button', { name: '登录 ChatGPT' })).toBeEnabled()
  expect(screen.queryByLabelText('API 地址')).toBeNull()
  expect(screen.queryByRole('button', { name: '保存连接' })).toBeNull()
  expect(settingsAPI.saveProfile).not.toHaveBeenCalled()
  expect(settingsAPI.startOAuthLogin).not.toHaveBeenCalled()
})

it('folds same-state increments into one card and lets a final snapshot replace provisional content without exposing internal ids', () => {
  const base = { conversationId: 'conversation', taskId: 'task', runId: 'run', time: 1, source: 'builtin' as const }
  const events: ExecutionEvent[] = [
    { ...base, eventId: 'e1', itemId: 'answer', sequence: 1, type: 'text', update: 'append', data: { text: '正' } },
    { ...base, eventId: 'e2', itemId: 'answer', sequence: 2, type: 'text', update: 'append', data: { text: '在生成' } },
    { ...base, eventId: 'e3', itemId: 'answer', sequence: 3, type: 'text', update: 'snapshot', data: { text: '最终回答', status: 'completed' } },
    { ...base, eventId: 'e4', itemId: 'tool', sequence: 4, type: 'tool', update: 'append', data: { label: '修改正文', status: 'executing', toolName: 'document.replace', operationId: 'operation-secret', documentId: 'document-secret' } },
    { ...base, eventId: 'e5', itemId: 'tool', sequence: 5, type: 'tool', update: 'snapshot', data: { label: '正文已更新', status: 'returned', toolName: 'document.replace', operationId: 'operation-secret', documentId: 'document-secret' } },
  ]
  const projection = foldExecutionEvents(emptyExecutionProjection('conversation'), events)
  render(<ExecutionTimeline projection={projection} />)
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('最终回答')
  expect(screen.queryByText('正在生成')).toBeNull()
  const tool = screen.getByRole('article', { name: '工具执行' })
  expect(tool).toHaveTextContent('正文已更新 · 已返回')
  expect(tool).not.toHaveTextContent('operation-secret')
  expect(tool).not.toHaveTextContent('document-secret')
})

it('M07-T07/S10-T05 freezes the exact send without a service notice, pins the shown route and sends the chosen permission level', async () => {
  const { api } = executionFixture([conversation('a', '会话 A'), conversation('b', '会话 B')])
  const captureDocuments = vi.fn(async () => [{ documentId: 'document-a', epoch: 'epoch', revision: 3, writable: [{ kind: 'document' as const }] }])
  const prepareSend = vi.fn(async () => true)
  const settingsAPI = settingsFixture(true)
  const { container } = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI} captureDocuments={captureDocuments} prepareSend={prepareSend} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '会话 A' })).toHaveAttribute('aria-current', 'page'))
  // The old write checkbox, scope details and inline attachment buttons are gone.
  expect(screen.queryByRole('checkbox', { name: '允许修改已绑定文档' })).toBeNull()
  expect(screen.queryByText('选择范围')).toBeNull()
  expect(screen.getByRole('button', { name: '权限：完全访问（工作空间）' })).toBeInTheDocument()
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  fireEvent.change(composer, { target: { value: '保留这份草稿' } })
  await waitFor(() => expect(captureDocuments).toHaveBeenCalledWith(true))
  fireEvent.click(screen.getByRole('button', { name: '会话 B' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话 B' })).toHaveAttribute('aria-current', 'page'))
  expect(api.draft).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'a', expectedRevision: 1,
    text: '保留这份草稿', documents: [{ documentId: 'document-a', epoch: 'epoch', revision: 3, writable: [{ kind: 'document' }] }], attachments: [] })
  fireEvent.click(screen.getByRole('button', { name: '会话 A' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('保留这份草稿'))
  expect(captureDocuments).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-provider · fixture-model')
  const references = screen.getByLabelText('本条消息的引用')
  expect(references).toHaveTextContent('已绑定文档')
  expect(references).not.toHaveTextContent('document-a')
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '直接发送' } })
  fireEvent.blur(screen.getByRole('textbox', { name: '给创作助手发消息' }))
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(vi.mocked(api.send).mock.calls[0]![0]).toMatchObject({ workspaceId: 'workspace', conversationId: 'a', text: '直接发送', permission: 'workspace',
    documents: [{ documentId: 'document-a', writable: [{ kind: 'document' }] }],
    disclosedSettings: { profileRevision: 1, roles: { conversation: { provider: 'fixture-provider', model: 'fixture-model', billingKind: 'token-plan' } } } })
  // Read-only strips writes at send; a later level change never touches a task already sent.
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '权限：完全访问（工作空间）' }))
  const levels = screen.getByRole('menu', { name: '权限模式' })
  expect(within(levels).getAllByRole('menuitemradio').map(item => item.firstElementChild?.textContent)).toEqual(['完全访问', '完全访问（工作空间）', '修改前询问', '只读'])
  fireEvent.click(within(levels).getByRole('menuitemradio', { name: /^只读/ }))
  expect(screen.getByRole('button', { name: '权限：只读' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '只读发送' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '给创作助手发消息' }), { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.send).mock.calls[1]![0]).toMatchObject({ permission: 'read-only', documents: [{ documentId: 'document-a', writable: [] }] })
  expect(localStorage.getItem('guoling.execution.permission.v1:workspace')).toBe('read-only')
  // A changed route in settings is simply what the next send pins; there is no notice to acknowledge.
  const changedSettings = settingsView(true)
  changedSettings.connections[0]!.connection.revision = 2
  vi.mocked(settingsAPI.read).mockResolvedValue(changedSettings)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '新路由' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '给创作助手发消息' }), { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(3))
  expect(vi.mocked(api.send).mock.calls[2]![0]).toMatchObject({ disclosedSettings: { roles: { conversation: { connectionRevision: 2 } } } })
  expect(container.querySelector('.execution-assistant__toolbar')).toContainElement(screen.getByRole('button', { name: '切换模型' }))
})

it('shows an actionable configuration error and does not prepare or send an unconfigured request', async () => {
  const { api } = executionFixture([conversation('a', '新会话')])
  const prepareSend = vi.fn(async () => true)
  render(<ExecutionAssistant root={null} api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={prepareSend} />)
  await screen.findByText('未配置对话模型')
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '保持用户原话' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('尚未配置可用的对话模型')
  expect(alert).toHaveTextContent('连接、模型和账号')
  expect(prepareSend).not.toHaveBeenCalled()
  expect(api.send).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button', { name: /切换模型|切换/ }).length).toBeGreaterThan(0)
})

it('M12 keeps a newer teacher draft when blur persistence overlaps an explicit connection retry', async () => {
  const restored = { ...conversation('a', '恢复会话', '原任务'),
    runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] } }
  const { api, state } = executionFixture([restored])
  const failed: ExecutionRunRecord = { ...run('a'), status: 'failed',
    requests: [{ requestId: 'request', state: 'failed', failure: {
      outcome: 'rejected', kind: 'auth', code: 'http-401', message: 'HTTP 401', httpStatus: 401 } }] }
  const source = { submissionId: 'submission', workspaceId: 'workspace', conversationId: 'a', state: 'accepted' as const,
    mode: 'queue' as const, text: '原任务', documents: [], attachments: [], runId: 'run',
    model: { provider: 'fixture-provider', model: 'fixture-model', accountId: 'teacher-account', billing: 'token-plan' },
    createdAt: 1, updatedAt: 1 }
  vi.mocked(api.run).mockResolvedValue(failed)
  vi.mocked(api.submissions).mockResolvedValue([source])
  let releaseDraft!: () => void
  const draftGate = new Promise<void>(resolve => { releaseDraft = resolve })
  vi.mocked(api.draft).mockImplementation(async input => {
    await draftGate
    const current = state.get(input.conversationId)!
    const saved = { ...current, inputDraft: input.text, inputAttachments: input.attachments ?? [], revision: current.revision + 1 }
    state.set(saved.conversationId, saved)
    return structuredClone(saved)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  const retry = await screen.findByRole('button', { name: '连接恢复后继续此任务' })
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  fireEvent.change(composer, { target: { value: '教师刚写的新草稿' } })
  fireEvent.blur(composer)
  await waitFor(() => expect(api.draft).toHaveBeenCalled())
  fireEvent.click(retry)
  expect(api.send).not.toHaveBeenCalled()
  releaseDraft()
  await screen.findByText(/输入框已有新的文字、附件或文档引用；新草稿已保留/)
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('教师刚写的新草稿')
  expect(state.get('a')?.inputDraft).toBe('教师刚写的新草稿')
  expect(api.send).not.toHaveBeenCalled()
})

function selectionContinuationFixture(fault: 'auth' | 'budget' | 'stalled' | 'unknown' = 'auth') {
  // Main stores frozen refs as `refs()` does and returns submissions in schema key
  // order (writable before selection); the restored composer view orders them differently.
  const range = { kind: 'markdown-range' as const, from: 2, to: 6 }
  const restored: ConversationRecord = { ...conversation('a', '恢复会话', '原任务'),
    runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] },
    frozenContextRefs: [{ contextRefId: 'doc', documentId: 'doc', epoch: 'epoch', revision: 3, writeScope: [range], selection: [range] }] }
  const { api, state } = executionFixture([restored])
  vi.mocked(api.draft).mockImplementation(async input => {
    const current = state.get(input.conversationId)!
    if (current.revision !== input.expectedRevision) throw new Error('stale')
    const saved: ConversationRecord = { ...current, inputDraft: input.text, inputAttachments: input.attachments ?? [], revision: current.revision + 1,
      frozenContextRefs: input.documents.map(value => ({ contextRefId: value.documentId, documentId: value.documentId, epoch: value.epoch,
        revision: value.revision, writeScope: value.writable, ...(value.selection?.length ? { selection: value.selection } : {}) })) }
    state.set(saved.conversationId, saved); return structuredClone(saved)
  })
  vi.mocked(api.run).mockResolvedValue(fault === 'budget' || fault === 'stalled'
    ? { ...run('a'), status: 'partial', failure: fault === 'budget'
      ? { code: MODEL_REQUEST_BUDGET_EXHAUSTED, message: '已达到本次 1 次模型请求上限' }
      : { code: EXECUTION_NO_PROGRESS, message: '工具结果持续重复' },
      requests: [{ requestId: 'request', state: 'completed' }] }
    : { ...run('a'), status: 'failed', requests: [{ requestId: 'request', state: 'failed', failure: fault === 'auth'
      ? { outcome: 'rejected', kind: 'auth', code: 'http-401', message: 'HTTP 401', httpStatus: 401 }
      : { outcome: 'unknown', kind: 'protocol', code: 'response-incomplete', message: '结果未知' } }] })
  const documents = [{ documentId: 'doc', epoch: 'epoch', revision: 3, writable: [range], selection: [range] }]
  vi.mocked(api.submissions).mockResolvedValue([{ submissionId: 'submission', workspaceId: 'workspace', conversationId: 'a', state: 'accepted' as const,
    mode: 'queue' as const, text: '原任务', documents, attachments: [], runId: 'run',
    model: { provider: 'fixture-provider', model: 'fixture-model', accountId: 'teacher-account', billing: 'token-plan' }, createdAt: 1, updatedAt: 1 }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  return { api, state, documents }
}

it('M12 continues a failed selection task whose restored references differ from the submission only by key order', async () => {
  const { api, documents } = selectionContinuationFixture()
  fireEvent.click(await screen.findByRole('button', { name: '连接恢复后继续此任务' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ text: '原任务', documents, attachments: [], retryOfRunId: 'run' })
  expect(screen.queryByText(/输入框已有新的文字、附件或文档引用/)).toBeNull()
})

it('M12 lets the teacher clear the restored draft and still continue the frozen task, matching Main', async () => {
  const { api, state, documents } = selectionContinuationFixture()
  const retry = await screen.findByRole('button', { name: '连接恢复后继续此任务' })
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  fireEvent.change(composer, { target: { value: '' } })
  fireEvent.blur(composer)
  await waitFor(() => expect(state.get('a')?.inputDraft).toBe(''))
  fireEvent.click(retry)
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ text: '原任务', documents, retryOfRunId: 'run' })
})

it('shows a local request limit and explicitly continues the frozen task once', async () => {
  const { api, documents } = selectionContinuationFixture('budget')
  const retry = await screen.findByRole('button', { name: '继续此任务' })
  expect(screen.getByRole('alert')).toHaveTextContent('本次已达到 1 次模型请求上限')
  expect(screen.getByRole('alert')).toHaveTextContent('已提交的修改会保留')
  fireEvent.click(retry); fireEvent.click(retry)
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ text: '原任务', documents, retryOfRunId: 'run' })
})

it('explains repeated tool results and offers a manual continuation', async () => {
  const { api } = selectionContinuationFixture('stalled')
  expect(await screen.findByRole('alert')).toHaveTextContent('工具结果持续重复，任务已暂停')
  fireEvent.click(screen.getByRole('button', { name: '继续此任务' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
})

it('keeps a newer draft when the local request limit is reached', async () => {
  const { api } = selectionContinuationFixture('budget')
  const retry = await screen.findByRole('button', { name: '继续此任务' })
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '新的草稿' } })
  fireEvent.click(retry)
  await screen.findByText(/输入框已有新的文字、附件或文档引用；新草稿已保留/)
  expect(api.send).not.toHaveBeenCalled()
})

it('does not label an unknown provider outcome as a local request limit', async () => {
  selectionContinuationFixture('unknown')
  await screen.findByRole('textbox', { name: '给创作助手发消息' })
  expect(screen.queryByRole('button', { name: '继续此任务' })).toBeNull()
  expect(screen.queryByText(/本次已达到.*模型请求上限/)).toBeNull()
})

it('gives IME and menus priority, keeps Shift+Enter multiline, and funnels Enter and the button through one submission path', async () => {
  const { api } = executionFixture([conversation('a', '输入测试')])
  render(<ExecutionAssistant root={null} api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await screen.findByRole('textbox', { name: '给创作助手发消息' })
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBeEnabled())
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  fireEvent.change(composer, { target: { value: '中文输入' } })
  fireEvent.compositionStart(composer)
  fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
  fireEvent.compositionEnd(composer)
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
  expect(api.send).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
  fireEvent.keyDown(composer, { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect((api.send as ReturnType<typeof vi.fn>).mock.calls[0]![0].submissionId).toMatch(/^[0-9a-f-]{36}$/)
})

const conversationWithMessages = (id: string, title: string, prefix: string, count: number): ConversationRecord => ({
  ...conversation(id, title),
  messages: Array.from({ length: count }, (_, index) => ({
    messageId: `${id}-user-${index + 1}`,
    role: 'user' as const,
    text: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    createdAt: index + 1,
    attachmentIds: [],
  })).flatMap((message, index) => index % 5 === 0
    ? [message, { messageId: `${id}-assistant-${index + 1}`, role: 'assistant' as const, text: `回复-${prefix}-${index + 1}`, createdAt: index + 1, attachmentIds: [] }]
    : [message]),
})

it('keeps a long user history bounded while every older message remains reachable without remounting the composer', async () => {
  const { api } = executionFixture([conversationWithMessages('a', '长会话', '消息', 45)])
  render(<ExecutionAssistant root={null} api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)

  await screen.findByText('消息-45')
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(20)
  expect(screen.getByText('消息-26')).toBeInTheDocument()
  expect(screen.queryByText('消息-25')).toBeNull()
  expect(screen.getByText('第 3 / 3 组 · 共 45 条')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(20)
  expect(screen.getByText('消息-06')).toBeInTheDocument()
  expect(screen.getByText('消息-25')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBe(composer)

  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(5)
  expect(screen.getByText('消息-01')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '跳到最新用户消息' }))
  expect(screen.getByText('消息-45')).toBeInTheDocument()
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(20)
  expect(api.subscribe).toHaveBeenCalledTimes(1)
})

it('remembers the independent user-history window when switching conversations without replacing the composer', async () => {
  const first = conversationWithMessages('a', '会话 A', '甲', 45)
  const second = conversationWithMessages('b', '会话 B', '乙', 45)
  const { api } = executionFixture([first, second])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)

  await screen.findByText('甲-45')
  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  expect(screen.getByText('甲-06')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '会话 B' }))
  await screen.findByText('乙-45')
  expect(screen.queryByText('乙-25')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  expect(screen.getByText('乙-01')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '会话 A' }))
  await screen.findByText('甲-06')
  expect(screen.getByText('甲-25')).toBeInTheDocument()
  expect(screen.queryByText('甲-26')).toBeNull()
  expect(screen.getByText('第 2 / 3 组 · 共 45 条')).toBeInTheDocument()
})

it('keeps the assistant focused on the current conversation and composer while low-frequency search stays in More', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const { container } = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await screen.findByRole('textbox', { name: '给创作助手发消息' })
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-provider · fixture-model · Token Plan'))
  expect(container.querySelector('.execution-assistant__title')).toHaveTextContent('课堂讨论')
  expect(screen.queryByRole('textbox', { name: '会话名称' })).toBeNull()
  expect(screen.queryByRole('button', { name: '保存名称' })).toBeNull()
  expect(screen.queryByText('当前没有正在运行的任务')).toBeNull()
  expect(screen.queryByRole('textbox', { name: '历史关键词' })).toBeNull()
  expect(container.querySelector('.execution-assistant__composer')).not.toHaveTextContent('没有引用也可以直接对话')
  fireEvent.click(container.querySelector('.execution-assistant__more > summary')!)
  fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
  expect(screen.getByRole('textbox', { name: '历史关键词' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBeInTheDocument()
})

it('switches a verified configured conversation model from the composer and confirms the saved route', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  const alternate = structuredClone(current.connections[0]!)
  alternate.connection.id = 'alternate'
  alternate.connection.provider = 'alternate-provider'
  alternate.connection.accountId = 'alternate-account'
  current.connections.push(alternate)
  current.capabilityRecords = [{ connectionId: 'alternate', connectionRevision: 1, model: 'alternate-model', parametersKey: '{}',
    facts: { tools: { status: 'supported', observedAt: 1, source: 'probe' } },
    lastProbe: { observedAt: 1, checks: ['tools'], requestCount: 1, outcomes: [] } }]
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-provider · fixture-model · Token Plan'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const choices = screen.getByRole('group', { name: '对话模型选择' })
  expect(choices).toHaveTextContent('alternate-account · Token Plan')
  fireEvent.click(within(choices).getByRole('button', { name: /alternate-modelalternate-provider/ }))
  await waitFor(() => expect(settingsAPI.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1,
    roles: expect.objectContaining({ conversation: { connectionId: 'alternate', model: 'alternate-model', parameters: {} } }) })))
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('alternate-provider · alternate-model · Token Plan'))
  expect(screen.queryByRole('group', { name: '对话模型选择' })).toBeNull()
  expect(api.send).not.toHaveBeenCalled()
})

it('offers a discovered model and provider-declared reasoning strengths without typing a model ID or sending a request', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'catalog-model', displayName: '目录模型', reasoningEfforts: [{ effort: 'low' }, { effort: 'high' }], defaultReasoningEffort: 'low' }],
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const menu = screen.getByRole('group', { name: '对话模型选择' })
  const discovered = await within(menu).findByRole('button', { name: /目录模型/ })
  expect(discovered).toHaveTextContent('目录能力未验证')
  fireEvent.click(discovered)
  await waitFor(() => expect(current.profile.roles.conversation).toEqual({ connectionId: 'connection', model: 'catalog-model', parameters: { reasoning_effort: 'low' } }))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  fireEvent.click(within(screen.getByRole('group', { name: '推理强度' })).getByRole('button', { name: '高' }))
  await waitFor(() => expect(current.profile.roles.conversation).toEqual({ connectionId: 'connection', model: 'catalog-model', parameters: { reasoning_effort: 'high' } }))
  expect(api.send).not.toHaveBeenCalled()
})

it('edits saved OAuth reasoning.effort without conflicting shorthand or losing reasoning summary', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.auth.kind = 'oauth'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'oauth-model',
    parameters: { reasoning: { effort: 'medium', summary: 'auto' }, temperature: 0.4 } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'oauth-model', reasoningEfforts: [{ effort: 'medium' }, { effort: 'high' }] }],
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('oauth-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const strength = await within(screen.getByRole('group', { name: '推理强度' })).findByRole('button', { name: '中' })
  expect(strength).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(screen.getByRole('group', { name: '推理强度' })).getByRole('button', { name: '高' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ reasoning: { effort: 'high', summary: 'auto' }, temperature: 0.4 }))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  fireEvent.click(within(screen.getByRole('group', { name: '推理强度' })).getByRole('button', { name: '默认' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ reasoning: { summary: 'auto' }, temperature: 0.4 }))
  expect(api.send).not.toHaveBeenCalled()
})

it('offers documented GPT-6 OAuth strengths when the directory omits them without claiming account verification', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.provider = 'openai'
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.auth.kind = 'oauth'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'gpt-6-luna' }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'gpt-6-luna' }], capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('gpt-6-luna'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const effort = within(screen.getByRole('group', { name: '对话模型选择' })).getByRole('group', { name: '推理强度' })
  await waitFor(() => expect(effort).toHaveTextContent('官方模型选项，当前连接未验证'))
  for (const label of ['关闭', '低', '中', '高', '极高', '最高']) expect(within(effort).getByRole('button', { name: label })).toBeInTheDocument()
  expect(within(effort).queryByRole('button', { name: '极低' })).toBeNull()
  fireEvent.click(within(effort).getByRole('button', { name: '最高' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ reasoning_effort: 'max' }))
  expect(api.send).not.toHaveBeenCalled()
})

it('uses explicit live OAuth effort declarations instead of documented fallbacks', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const current = settingsView(true)
  current.connections[0]!.connection.provider = 'openai'
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.auth.kind = 'oauth'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'gpt-6-astra' }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockResolvedValue(current)
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'gpt-6-astra', reasoningEfforts: [{ effort: 'low' }, { effort: 'high' }] }],
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('gpt-6-astra'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const effort = within(screen.getByRole('group', { name: '对话模型选择' })).getByRole('group', { name: '推理强度' })
  await waitFor(() => expect(effort).not.toHaveTextContent('官方模型选项'))
  expect(within(effort).getByRole('button', { name: '高' })).toBeInTheDocument()
  expect(within(effort).queryByRole('button', { name: '最高' })).toBeNull()
  expect(within(effort).queryByRole('button', { name: '关闭' })).toBeNull()
  expect(effort).not.toHaveTextContent('官方模型选项')
})

it('treats an explicit empty OAuth effort directory as authoritative', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const current = settingsView(true)
  current.connections[0]!.connection.provider = 'openai'
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.auth.kind = 'oauth'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'gpt-6-luna' }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockResolvedValue(current)
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'gpt-6-luna', reasoningEfforts: [] }], capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('gpt-6-luna'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const effort = within(screen.getByRole('group', { name: '对话模型选择' })).getByRole('group', { name: '推理强度' })
  await waitFor(() => expect(effort).toHaveTextContent('此连接目录未提供可选强度'))
  expect(within(effort).getAllByRole('button')).toHaveLength(1)
  expect(within(effort).getByRole('button', { name: '默认' })).toBeInTheDocument()
})

it('puts current and familiar OAuth models first, explains their uses, and shortens an opaque account ID', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const current = settingsView(true)
  const account = '123e4567-e89b-12d3-a456-426614173762'
  current.connections[0]!.connection.provider = 'openai'
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.accountId = account
  current.connections[0]!.connection.auth.kind = 'oauth'
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockResolvedValue(current)
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: ['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', ...Array.from({ length: 6 }, (_, index) => `older-${index}`)]
      .map(id => ({ id, description: 'Provider description' })),
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const menu = screen.getByRole('group', { name: '对话模型选择' })
  await within(menu).findByText(/日常创作与开发/)
  const effort = within(menu).getByRole('group', { name: '推理强度' })
  const list = within(menu).getByRole('group', { name: '可用模型' })
  expect(menu.children[1]).toBe(effort)
  expect(menu.children[2]).toBe(list)
  expect(list).toContainElement(within(menu).getByRole('button', { name: /gpt-6-sol/ }))
  expect(list).not.toContainElement(within(menu).getByRole('button', { name: '管理模型与连接…' }))
  expect(menu).toHaveTextContent('ChatGPT 账号 · 尾号 3762')
  expect(menu).not.toHaveTextContent(account)
  expect(menu).toHaveTextContent('简单、快速的任务')
  expect(menu).toHaveTextContent('复杂任务与架构分析')
  expect(menu).toHaveTextContent('目录能力未验证')
  expect(menu).toHaveTextContent('全部模型（另有 6 个）')
  const text = menu.textContent ?? ''
  expect(text.indexOf('fixture-model')).toBeLessThan(text.indexOf('gpt-6-sol'))
  expect(text.indexOf('gpt-6-sol')).toBeLessThan(text.indexOf('gpt-6-luna'))
  expect(text.indexOf('gpt-6-luna')).toBeLessThan(text.indexOf('gpt-6-astra'))
  fireEvent.change(within(menu).getByRole('textbox', { name: '搜索模型' }), { target: { value: 'older-4' } })
  expect(within(menu).getByRole('button', { name: /older-4/ })).toBeInTheDocument()
  expect(api.send).not.toHaveBeenCalled()
})

it('displays conversation home location for folder, file, unhomed, missing, other workspace, and empty session with hint, and dispatches reveal event on click', async () => {
  const cFolder = {
    ...conversation('c1', '会话-目录'),
    home: { kind: 'folder' as const, path: 'Unit/Sub', workspaceId: 'workspace' },
    messages: [{ messageId: 'm1', role: 'user' as const, text: 'hello', createdAt: 1, attachmentIds: [], runId: 'run' }],
  }
  const cFile = {
    ...conversation('c2', '会话-文件'),
    home: { kind: 'file' as const, path: 'Unit/a.md', workspaceId: 'workspace' },
    messages: [{ messageId: 'm2', role: 'user' as const, text: 'hello', createdAt: 1, attachmentIds: [], runId: 'run' }],
  }
  const cUnhomed = {
    ...conversation('c3', '会话-无所属'),
    messages: [{ messageId: 'm3', role: 'user' as const, text: 'hello', createdAt: 1, attachmentIds: [], runId: 'run' }],
  }
  const cMissing = {
    ...conversation('c4', '会话-已删除'),
    home: { kind: 'file' as const, path: 'Unit/deleted.md', workspaceId: 'workspace', missing: true as const },
    messages: [{ messageId: 'm4', role: 'user' as const, text: 'hello', createdAt: 1, attachmentIds: [], runId: 'run' }],
  }
  const cOtherWs = {
    ...conversation('c5', '会话-其他空间'),
    home: { kind: 'folder' as const, path: 'Shared', workspaceId: 'other-ws' },
    messages: [{ messageId: 'm5', role: 'user' as const, text: 'hello', createdAt: 1, attachmentIds: [], runId: 'run' }],
  }
  const cEmpty = conversation('c6', '会话-空')

  const { api } = executionFixture([cFolder, cFile, cUnhomed, cMissing, cOtherWs, cEmpty])
  const listener = vi.fn()
  window.addEventListener('guoling:reveal-in-explorer', listener)

  const { container } = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)

  // 1. Folder session
  await screen.findByRole('button', { name: '会话-目录' })
  let locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('workspace › Unit › Sub')
  expect(locationBtn.querySelector('.lucide-folder')).toBeInTheDocument()
  expect(locationBtn.getAttribute('title')).toContain('C:/workspace/Unit/Sub')
  expect(locationBtn.getAttribute('title')).toContain('所属位置只决定默认引用和新建文件的位置，不限制可修改的范围')
  expect(locationBtn).not.toHaveTextContent('发送首条消息后固定')

  // Click reveals folder
  fireEvent.click(locationBtn)
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({
    detail: { path: 'Unit/Sub', kind: 'folder' }
  }))

  // 2. File session
  listener.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '会话-文件' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话-文件' })).toHaveAttribute('aria-current', 'page'))
  locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('workspace › Unit › a.md')
  expect(locationBtn.querySelector('.lucide-file')).toBeInTheDocument()
  expect(locationBtn.getAttribute('title')).toContain('C:/workspace/Unit/a.md')
  fireEvent.click(locationBtn)
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({
    detail: { path: 'Unit/a.md', kind: 'file' }
  }))

  // 3. Unhomed session
  listener.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '会话-无所属' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话-无所属' })).toHaveAttribute('aria-current', 'page'))
  locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('workspace')
  expect(locationBtn.querySelector('.lucide-folder')).toBeInTheDocument()
  expect(locationBtn.getAttribute('title')).toContain('C:/workspace')
  fireEvent.click(locationBtn)
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({
    detail: { path: '', kind: 'folder' }
  }))

  // 4. Missing session
  listener.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '会话-已删除' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话-已删除' })).toHaveAttribute('aria-current', 'page'))
  locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('workspace › Unit › deleted.md')
  expect(locationBtn).toHaveTextContent('已删除')

  // 5. Other workspace session
  listener.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '会话-其他空间' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话-其他空间' })).toHaveAttribute('aria-current', 'page'))
  locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('其他工作空间 · Shared')
  expect(locationBtn).not.toHaveTextContent('workspace › Shared')
  expect(locationBtn.getAttribute('title')).not.toContain('C:/workspace')
  fireEvent.click(locationBtn)
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({
    detail: { workspaceId: 'other-ws', path: 'Shared', kind: 'folder' }
  }))

  // 6. Empty session
  listener.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '会话-空' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话-空' })).toHaveAttribute('aria-current', 'page'))
  locationBtn = container.querySelector('.execution-assistant__location')!
  expect(locationBtn).toHaveTextContent('发送首条消息后固定')

  // Typing a draft removes the hint
  fireEvent.change(screen.getByRole('textbox', { name: '给创作助手发消息' }), { target: { value: '草稿' } })
  expect(locationBtn).not.toHaveTextContent('发送首条消息后固定')

  window.removeEventListener('guoling:reveal-in-explorer', listener)
})

