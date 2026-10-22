import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant, type ExecutionAssistantHandle } from '../../src/renderer/workbench/ExecutionAssistant'
import { createRef } from 'react'
import { WorkbenchSessionDock, WorkbenchSessionPortalProvider, useWorkbenchSessionDock } from '../../src/renderer/workbench/WorkbenchSessionPortal'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import { ExecutionTimelineReadModel } from '../../src/shared/workbench/executionTimelineReadModel'
import type { ExecutionTimelineEntryPage } from '../../src/shared/workbench/executionTimelineWindow'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { executionInputMessages } from '../../src/shared/workbench/executionInputMessages'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('windowed Assistant uses bounded page/body IPC and global pending facts without downloading raw history', async () => {
  const original = conversation('a', '窗口会话')
  original.messages.push({ messageId: 'user', role: 'user', text: '当前目标', createdAt: 1, attachmentIds: [] })
  const { api, emit } = executionFixture([original])
  let projection = foldExecutionEvents(emptyExecutionProjection('a'), Array.from({ length: 220 }, (_, index): ExecutionEvent => ({
    conversationId: 'a', taskId: 'task', runId: 'run', eventId: `window-${index}`, itemId: `row-${index}`, time: index + 100,
    sequence: index + 1, source: 'builtin', type: 'reasoning', update: 'snapshot', data: { text: `历史行 ${index}` },
  })))
  const long = '完整答复正文'.repeat(5000)
  projection = foldExecutionEvents(projection, [
    { ...streamEvent(221, long), time: 1000 },
    { ...streamEvent(222, ''), time: 0, runId: 'waiting', itemId: 'question', type: 'tool', data: { toolName: 'ask_user', status: 'waiting', question: { text: '全局选择仍可用？', multiple: false, options: [{ label: '继续当前稿' }] } } },
    { ...streamEvent(223, '', 'ended'), time: 0 },
  ])
  const reader = new ExecutionTimelineReadModel(projection, original.messages)
  api.timelineWindow = vi.fn(async input => structuredClone(reader.entryPage(input)))
  api.timelineGroup = vi.fn(async input => structuredClone(reader.groupPage(input)))
  api.timelineBody = vi.fn(async input => structuredClone(reader.readBody(input)))
  api.releaseTimeline = vi.fn(async () => {})
  vi.mocked(api.conversation).mockResolvedValue({ ...original, revision: 2, messages: [...original.messages,
    { messageId: 'ended-reply', role: 'assistant', text: '任务收尾', createdAt: 2, attachmentIds: [], runId: 'ended' }] })
  const view = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} />)
  await screen.findByText('全局选择仍可用？')
  await waitFor(() => expect(api.conversation).toHaveBeenCalledTimes(1))
  expect(api.timeline).not.toHaveBeenCalled(); expect(api.events).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /继续读取内容/ }))
  await waitFor(() => expect(api.timelineBody).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run', itemId: 'answer', part: 0, maxChars: 24000 })))
  const next = { ...streamEvent(224, '新后缀'), time: 1001 }
  projection = foldExecutionEvents(projection, [next]); reader.update(projection)
  act(() => emit(next))
  await waitFor(() => expect(vi.mocked(api.timelineWindow!).mock.calls.length).toBeGreaterThan(1))
  expect(api.timeline).not.toHaveBeenCalled(); expect(api.events).not.toHaveBeenCalled(); expect(api.conversation).toHaveBeenCalledTimes(1)
  const consumer = vi.mocked(api.timelineWindow!).mock.calls[0]![0].consumerId
  view.unmount(); expect(api.releaseTimeline).toHaveBeenCalledWith('a', consumer)
})

it('windowed Assistant preserves a requested older range through streaming and rejects its stale response facts', async () => {
  const original = conversation('a', '窗口顺序')
  original.messages.push({ messageId: 'user', role: 'user', text: '目标', createdAt: 0, attachmentIds: [] })
  const { api, emit } = executionFixture([original])
  let projection = foldExecutionEvents(emptyExecutionProjection('a'), Array.from({ length: 250 }, (_, index): ExecutionEvent => ({
    ...streamEvent(index + 1, `窗口行 ${index}`), itemId: `row-${index}`,
  })))
  const reader = new ExecutionTimelineReadModel(projection, original.messages), old = deferred<ExecutionTimelineEntryPage>()
  let pendingPage: ExecutionTimelineEntryPage | undefined
  api.timelineWindow = vi.fn(async input => {
    if (input.start !== undefined && !pendingPage) { pendingPage = structuredClone(reader.entryPage(input)); return old.promise }
    return structuredClone(reader.entryPage(input))
  })
  api.timelineGroup = vi.fn(async input => structuredClone(reader.groupPage(input)))
  api.timelineBody = vi.fn(async input => structuredClone(reader.readBody(input)))
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} />)
  await screen.findByText('窗口行 249')
  fireEvent.click(screen.getByRole('button', { name: /读取更早记录/ }))
  await waitFor(() => expect(pendingPage).toBeDefined())
  const next = { ...streamEvent(251, '最新可见行'), itemId: 'row-250' }
  projection = foldExecutionEvents(projection, [next]); reader.update(projection)
  act(() => emit(next)); await screen.findByText('窗口行 50')
  expect(screen.queryByText('最新可见行')).toBeNull()
  await act(async () => { old.resolve(pendingPage!); await old.promise })
  expect(screen.getByText('窗口行 50')).toBeInTheDocument()
  expect(screen.queryByText('最新可见行')).toBeNull()
  const latestRead = vi.mocked(api.timelineWindow!).mock.calls.at(-1)![0]
  expect(latestRead.start).toBe(pendingPage!.start)
  fireEvent.click(screen.getByRole('button', { name: /回到最新/ }))
  await screen.findByText('最新可见行')
  expect(api.timeline).not.toHaveBeenCalled(); expect(api.events).not.toHaveBeenCalled()
})

it('windowed Assistant restores the existing reading range before its first read after switching conversations', async () => {
  const first = conversation('a', '甲会话'), second = conversation('b', '乙会话')
  for (const record of [first, second]) record.messages.push({ messageId: `user-${record.conversationId}`, role: 'user', text: '目标', createdAt: 0, attachmentIds: [] })
  const { api, emit } = executionFixture([first, second])
  let a = foldExecutionEvents(emptyExecutionProjection('a'), Array.from({ length: 250 }, (_, index): ExecutionEvent => ({ ...streamEvent(index + 1, `甲历史 ${index}`), itemId: `row-${index}` })))
  const b = foldExecutionEvents(emptyExecutionProjection('b'), [{ ...streamEvent(1, '乙当前内容'), conversationId: 'b' }])
  const readers = new Map([['a', new ExecutionTimelineReadModel(a, first.messages)], ['b', new ExecutionTimelineReadModel(b, second.messages)]])
  api.timelineWindow = vi.fn(async input => structuredClone(readers.get(input.conversationId)!.entryPage(input)))
  api.timelineGroup = vi.fn(async input => structuredClone(readers.get(input.conversationId)!.groupPage(input)))
  api.timelineBody = vi.fn(async input => structuredClone(readers.get(input.conversationId)!.readBody(input)))
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} />)
  await screen.findByText('甲历史 249')
  fireEvent.click(screen.getByRole('button', { name: /读取更早记录/ })); await screen.findByText('甲历史 50')
  const previous = vi.mocked(api.timelineWindow!).mock.calls.at(-1)![0]
  fireEvent.click(screen.getByRole('button', { name: '乙会话' })); await screen.findByText('乙当前内容')
  const calls = vi.mocked(api.timelineWindow!).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '甲会话' })); await screen.findByText('甲历史 50')
  const resumed = vi.mocked(api.timelineWindow!).mock.calls.slice(calls).find(([input]) => input.conversationId === 'a')![0]
  expect(resumed.start).toBe(previous.start)
  expect(resumed.anchorKey).toBeDefined()
  expect(screen.queryByText('甲历史 249')).toBeNull()
  const next = { ...streamEvent(251, '甲新的尾部'), itemId: 'row-250' }
  a = foldExecutionEvents(a, [next]); readers.get('a')!.update(a); act(() => emit(next))
  await waitFor(async () => {
    const last = vi.mocked(api.timelineWindow!).mock.results.at(-1)!
    expect((await last.value).cursor).toBe(251)
  })
  expect(screen.getByText('甲历史 50')).toBeInTheDocument(); expect(screen.queryByText('甲新的尾部')).toBeNull()
})

const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation = (id: string, title: string, inputDraft = ''): ConversationRecord => ({
  conversationId: id, workspaceId: workspace.workspaceId, title, messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft, inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1,
})
const run = (conversationId: string): ExecutionRunRecord => ({
  schemaVersion: 1, runId: 'run', version: 1, input: { conversationId, taskId: 'task', instruction: 'instruction',
    selection: { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'model' }, documents: [] }, status: 'running', createdAt: 1, updatedAt: 1,
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
it('releases the actual timeline consumer when the mounted Assistant closes', async () => {
  const { api } = executionFixture([conversation('a', '原会话')])
  api.releaseTimeline = vi.fn(async () => {})
  const view = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={async () => []} prepareSend={async () => true} />)
  await waitFor(() => expect(api.timeline).toHaveBeenCalledWith('a', expect.any(String)))
  const consumer = vi.mocked(api.timeline).mock.calls[0]![1]!
  view.unmount()
  expect(api.releaseTimeline).toHaveBeenCalledWith('a', consumer)
})

it('does not pin or save a late current-document capture into a different conversation', async () => {
  const { api, state } = executionFixture([conversation('a', '原会话', '原稿'), conversation('b', '新会话', '另一稿')])
  const incoming = deferred<any>()
  const capture = vi.fn((_writable: boolean, prepare?: boolean) => prepare === false ? Promise.resolve([]) : incoming.promise)
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={capture} prepareSend={async () => true} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('原稿'))
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '引用当前文档' }))
  expect(capture).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '新会话' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿'))
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '另一稿的新输入' } })
  await act(async () => incoming.resolve([{ documentId: 'original-document', epoch: 'epoch-a', revision: 1, displayLabel: '文档', writable: [{ kind: 'document' }] }]))
  expect(screen.queryByRole('button', { name: /移除引用.*文档/ })).toBeNull()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿的新输入')
  expect(state.get('a')!.frozenContextRefs).toEqual([])
  expect(state.get('b')!.frozenContextRefs).toEqual([])
  expect(vi.mocked(api.draft).mock.calls.flatMap(([input]) => input.documents)).toEqual([])
  expect(api.send).not.toHaveBeenCalled()
})

it('finishes attachment intake in the original conversation after switching, keeping both text drafts', async () => {
  const { api, state } = executionFixture([conversation('a', '原会话', '原稿'), conversation('b', '新会话', '另一稿')])
  const incoming = deferred<any>()
  const prior = window.desktopAPI
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { ...prior, attachments: {
    receive: vi.fn(() => incoming.promise), snapshot: vi.fn(async () => ({ id: 'snap', name: '材料.txt', gaps: [], source: { kind: 'drop' }, representations: [{ id: 'text', kind: 'text' }] })),
    release: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
  } } })
  try {
    render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={async () => []} prepareSend={async () => true} />)
    const input = await screen.findByRole('textbox', { name: '给果铃AI发消息' })
    fireEvent.change(input, { target: { value: '原稿的新输入' } })
    fireEvent.drop(input, { dataTransfer: { files: [new File(['材料'], '材料.txt')], getData: () => '' } })
    await waitFor(() => expect(window.desktopAPI!.attachments!.receive).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '新会话' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿'))
    fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '另一稿的新输入' } })
    await act(async () => incoming.resolve({ id: 'snap', name: '材料.txt', gaps: [], source: { kind: 'drop' }, representations: [{ id: 'text', kind: 'text' }] }))
    await waitFor(() => expect(state.get('a')!.inputAttachments).toHaveLength(1))
    expect(state.get('a')!.inputDraft).toBe('原稿的新输入')
    expect(state.get('b')!.inputAttachments).toEqual([])
    expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿的新输入')
    expect(window.desktopAPI!.attachments!.cancel).not.toHaveBeenCalled()
  } finally { Object.defineProperty(window, 'desktopAPI', { configurable: true, value: prior }) }
})
const streamEvent = (sequence: number, text: string, endedRun?: string): ExecutionEvent => ({
  conversationId: 'a', taskId: endedRun ?? 'task', runId: endedRun ?? 'run', time: sequence, source: 'builtin',
  eventId: `event-${sequence}`, sequence, itemId: endedRun ? 'end' : 'answer', type: endedRun ? 'run.end' : 'text',
  update: endedRun ? 'snapshot' : 'append', data: endedRun ? { status: 'failed' } : { text },
})

it('keeps queued intake and unsaved text on the original workspace after the view changes', async () => {
  const { api, state } = executionFixture([conversation('a', '原会话', '原稿')])
  const intake = deferred<any>(), queued = deferred<void>()
  const write = api.draft
  vi.mocked(api.draft).mockImplementationOnce(async input => { await queued.promise; return write(input) })
  const other = { ...workspace, workspaceId: 'other', rootPath: 'C:/other' }
  const otherConversation = { ...conversation('b', '其他工作空间', '另一稿'), workspaceId: 'other' }
  state.set('b', otherConversation)
  vi.mocked(api.workspace).mockImplementation(async root => root === other.rootPath ? { workspace: other, conversations: [otherConversation] } : { workspace, conversations: [state.get('a')!] })
  const prior = window.desktopAPI
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { ...prior, attachments: {
    receive: vi.fn(() => intake.promise), snapshot: vi.fn(async () => ({ id: 'snap', name: '材料.txt', gaps: [], source: { kind: 'drop' }, representations: [{ id: 'text', kind: 'text' }] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
  } } })
  try {
    const handle = createRef<ExecutionAssistantHandle>()
    const props = { api, settingsAPI: settingsFixture(false), captureDocuments: async () => [], prepareSend: async () => true }
    const view = render(<ExecutionAssistant ref={handle} root={workspace.rootPath} {...props} />)
    const input = await screen.findByRole('textbox', { name: '给果铃AI发消息' })
    fireEvent.change(input, { target: { value: '切换前未保存文字' } })
    fireEvent.drop(input, { dataTransfer: { files: [new File(['材料'], '材料.txt')], getData: () => '' } })
    await waitFor(() => expect(window.desktopAPI!.attachments!.receive).toHaveBeenCalled())
    let preservation!: Promise<unknown>
    act(() => { preservation = handle.current!.preserveDraft() })
    await waitFor(() => expect(api.draft).toHaveBeenCalled())
    await act(async () => intake.resolve({ id: 'snap', name: '材料.txt', gaps: [], source: { kind: 'drop' }, representations: [{ id: 'text', kind: 'text' }] }))
    view.rerender(<ExecutionAssistant ref={handle} root={other.rootPath} {...props} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿'))
    await act(async () => { queued.resolve(); await preservation })
    await waitFor(() => expect(state.get('a')!.inputAttachments).toHaveLength(1))
    expect(state.get('a')!.inputDraft).toBe('切换前未保存文字')
    expect(state.get('b')!.inputDraft).toBe('另一稿')
    expect(state.get('b')!.inputAttachments).toEqual([])
  } finally { Object.defineProperty(window, 'desktopAPI', { configurable: true, value: prior }) }
})

const settingsView = (configured: boolean): ExecutionSettingsView => ({
  secureStorageAvailable: true,
  modelFavorites: [],
  connections: configured ? [{ connection: { id: 'connection', revision: 1, provider: 'fixture-provider', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'teacher-account',
    auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false }] : [],
  profile: { revision: 1, updatedAt: '2026-09-23T00:00:00.000Z', roles: { conversation: configured ? { connectionId: 'connection', model: 'fixture-model' } : null, vision: null, imageGenerate: null, imageEdit: null } },
})
const settingsFixture = (configured: boolean): ExecutionSettingsAPI => ({
  read: vi.fn(async () => settingsView(configured)),
  probeCapabilities: vi.fn(async () => { throw new Error('unused') }),
  saveConnection: vi.fn(async () => { throw new Error('unused') }), saveProfile: vi.fn(async () => { throw new Error('unused') }),
  setModelFavorite: vi.fn(async () => []),
  knownModels: vi.fn(async () => []),
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

it('observes automatic references without draining inputs, but prepares them when sending', async () => {
  const { api } = executionFixture([conversation('observation', '引用观察')])
  const settingsAPI = settingsFixture(true)
  const drain = vi.fn(async () => {})
  const capture = vi.fn(async (_writable: boolean, prepare = true) => {
    if (prepare) await drain()
    return [{ documentId: 'document-a', epoch: 'epoch', revision: 1, writable: [{ kind: 'document' as const }] }]
  })
  const host = () => <ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={(writable, prepare) => capture(writable, prepare)} prepareSend={async () => { await drain(); return true }} />
  const view = render(host())
  await waitFor(() => expect(capture).toHaveBeenCalledWith(true, false))
  view.rerender(host()) // The real host creates a new callback on document-view publication.
  await waitFor(() => expect(capture.mock.calls.length).toBeGreaterThan(1))
  expect(drain).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '修改当前稿' } })
  fireEvent.click(screen.getByRole('button', { name: /^发送$/ }))
  await waitFor(() => expect(api.send).toHaveBeenCalled())
  expect(drain).toHaveBeenCalledTimes(1)
})

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
  expect(api.conversation).toHaveBeenCalledTimes(1) // Main answers that read with its final record; nothing is polled again.
  vi.mocked(api.events).mockResolvedValueOnce({ events: [streamEvent(5, '继续')], cursor: 5, hasMore: false })
  await act(async () => emit(streamEvent(5, '继续')))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段中段尾段继续')
  expect(api.conversation).toHaveBeenCalledTimes(1)

  vi.mocked(api.events)
    .mockResolvedValueOnce({ events: [streamEvent(6, '补齐')], cursor: 6, hasMore: true })
    .mockRejectedValueOnce(new Error('A later page is temporarily unavailable'))
    .mockResolvedValueOnce({ events: [], cursor: 6, hasMore: false })
  await act(async () => emit(streamEvent(6, '补齐')))
  await act(async () => emit(streamEvent(6, '补齐')))
  expect(screen.getByRole('article', { name: '回复' })).toHaveTextContent('首段中段尾段继续补齐')
  expect(api.conversation).toHaveBeenCalledTimes(1)
})

it('refreshes new terminal messages without replacing local draft attachments, newer revisions, or another conversation', async () => {
  const initial = { ...conversation('a', '会话 A', '原草稿'), inputAttachments: [
    { attachmentId: '11111111-1111-4111-8111-111111111111', representationId: 'source' },
  ] }
  const { api, state, emit } = executionFixture([initial, conversation('b', '会话 B', '乙会话草稿')])
  const terminalReads = [deferred<ConversationRecord | null>(), deferred<ConversationRecord | null>(), deferred<ConversationRecord | null>()]
  let readIndex = 0, terminalReadPending = false
  vi.mocked(api.conversation).mockImplementation(async (_workspaceId, id) => {
    if (id === 'a' && terminalReadPending) { terminalReadPending = false; return terminalReads[readIndex++]!.promise }
    return structuredClone(state.get(id) ?? null)
  })
  const events: ExecutionEvent[] = []
  vi.mocked(api.events).mockImplementation(async (id, after = 0) => ({ events: events.filter(event => event.conversationId === id && event.sequence > after), cursor: id === 'a' ? events.length : 0, hasMore: false }))
  const ref = createRef<ExecutionAssistantHandle>()
  render(<ExecutionAssistant ref={ref} root="C:/workspace" api={api} settingsAPI={settingsFixture(true)}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(api.events).toHaveBeenCalledTimes(1))
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  const end = (sequence: number) => { terminalReadPending = true; const event = streamEvent(sequence, '', `ended-${sequence}`); events.push(event); emit(event) }
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
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('乙会话草稿'))
  await act(async () => terminalReads[2]!.resolve({ ...replied, revision: 6 }))
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('乙会话草稿')
  expect(screen.getByRole('button', { name: '会话 B' })).toHaveAttribute('aria-current', 'page')
})

it('preserves a focused unsent composer through the existing close handle and waits for its write', async () => {
  const { api, state } = executionFixture([conversation('a', '未发送要求')])
  const ref = createRef<ExecutionAssistantHandle>()
  render(<ExecutionAssistant ref={ref} root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).not.toBeDisabled())
  const input = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  input.focus()
  fireEvent.change(input, { target: { value: '保持焦点，关闭后还要继续写。' } })
  expect(input).toHaveFocus()
  await ref.current!.preserveDraft()
  expect(state.get('a')?.inputDraft).toBe('保持焦点，关闭后还要继续写。')
})

it('continues on a conversation revision Main wrote after a task ended instead of failing every later save and send', async () => {
  // Main writes the ended task's restored input and its reply after this view last read the record; Main refuses the older revision.
  const { api, state } = executionFixture([conversation('a', '会话 A', '继续')])
  const refusal = () => new Error(`消息尚未发送：${executionInputMessages['conversation-draft-changed'][0]}`)
  const draft = vi.mocked(api.draft).getMockImplementation()!, send = vi.mocked(api.send).getMockImplementation()!
  vi.mocked(api.draft).mockImplementation(input => draft(input).catch(() => { throw refusal() }))
  vi.mocked(api.send).mockImplementation(input => send(input).catch(() => { throw refusal() }))
  const reply = (revision: number) => state.set('a', { ...state.get('a')!, revision, messages: [...state.get('a')!.messages,
    { messageId: `reply-${revision}`, role: 'assistant' as const, text: '任务回复', runId: 'run', createdAt: revision, attachmentIds: [] }] })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  const composer = () => screen.getByRole('textbox', { name: '给果铃AI发消息' })
  await waitFor(() => expect(composer()).toHaveValue('继续'))
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  // The restored input sent unchanged is exactly the stored draft, so the same payload goes once more on the new revision.
  reply(2)
  fireEvent.keyDown(composer(), { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.send).mock.calls.map(([input]) => input.expectedRevision)).toEqual([1, 2])
  await waitFor(() => expect(screen.getByRole('button', { name: '新建会话' })).toBeEnabled())
  expect(composer()).toHaveValue('')
  // A new teacher draft is saved on the latest record instead of the older revision.
  reply(4)
  fireEvent.change(composer(), { target: { value: '新的问题' } })
  fireEvent.blur(composer())
  await waitFor(() => expect(state.get('a')!.inputDraft).toBe('新的问题'))
  expect(vi.mocked(api.draft).mock.calls.map(([input]) => input.expectedRevision)).toEqual([4])
  expect(screen.queryByRole('alert')).toBeNull()
})

it('labels a send Main refused before acceptance as not executed and keeps "unconfirmed" for an outcome it cannot read', async () => {
  const { api } = executionFixture([conversation('a', '会话 A')])
  vi.mocked(api.send).mockRejectedValue(new Error(`消息尚未发送：${executionInputMessages['vision-unsupported'][0]}`))
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  // The composer remounts once the conversation is loaded.
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeEnabled())
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  fireEvent.change(composer, { target: { value: '这张图是什么？' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  const refused = await screen.findByRole('article', { name: '待处理消息' })
  await waitFor(() => expect(refused).toHaveTextContent('已拒绝，未执行'))
  expect(refused).toHaveTextContent('已确认不支持图片输入')
  expect(refused).not.toHaveTextContent('未确认执行器是否收到')
  expect(within(refused).queryByRole('button', { name: '用同一提交确认' })).toBeNull()
  expect(composer).toHaveValue('这张图是什么？')
  // Only a send whose record cannot be read afterwards stays unknown and offers the same-submission confirmation.
  const unreachable = new Error('桌面功能暂时不可用。请重新启动编辑器后重试。')
  vi.mocked(api.send).mockRejectedValue(unreachable); vi.mocked(api.submission).mockRejectedValue(unreachable)
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
  fireEvent.keyDown(composer, { key: 'Enter' })
  await waitFor(() => expect(screen.getAllByRole('article', { name: '待处理消息' })).toHaveLength(2))
  const unknown = screen.getAllByRole('article', { name: '待处理消息' })[1]!
  await waitFor(() => expect(unknown).toHaveTextContent('未确认执行器是否收到'))
  expect(within(unknown).getByRole('button', { name: '用同一提交确认' })).toBeInTheDocument()
})

it('shows the specific reason Main gives when a blurred draft or a session rename is not saved', async () => {
  const { api } = executionFixture([conversation('a', '会话 A')])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeEnabled())
  const draftRefusal = `草稿未保存：${executionInputMessages['attachment-unavailable'][0]}\n${executionInputMessages['attachment-unavailable'][1]}`
  vi.mocked(api.draft).mockRejectedValueOnce(new Error(draftRefusal))
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '要保留的草稿' } })
  fireEvent.blur(screen.getByRole('textbox', { name: '给果铃AI发消息' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(executionInputMessages['attachment-unavailable'][0]))
  expect(screen.getByRole('alert')).toHaveTextContent('草稿未保存')
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('要保留的草稿')
  vi.mocked(api.renameConversation).mockRejectedValueOnce(new Error('会话名称未保存：会话刚被另一项操作更新（例如任务结束时写入的回复），这次操作没有生效。\n请再操作一次，会按最新记录处理。'))
  fireEvent.click(screen.getByRole('button', { name: '管理会话 会话 A' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
  fireEvent.change(screen.getByRole('textbox', { name: '重命名 会话 A' }), { target: { value: '新名称' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('会话刚被另一项操作更新'))
  expect(screen.getByRole('alert')).not.toHaveTextContent('请重试。')
})

it('restoring an old failed message keeps a different new draft until an explicit replacement choice', async () => {
  const { api } = executionFixture([conversation('a', '失败消息')])
  vi.mocked(api.submissions).mockResolvedValue([{ submissionId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace', conversationId: 'a',
    state: 'failed', mode: 'queue', text: '旧要求', documents: [], attachments: [], createdAt: 1, updatedAt: 1,
    failure: { code: 'model-not-configured', message: '未连接' }, model: { provider: 'fixture', model: 'fixture', accountId: 'fixture', billing: 'unknown' } }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  const restore = await screen.findByRole('button', { name: '恢复到输入框' })
  const input = screen.getByRole('textbox', { name: '给果铃AI发消息' })
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
  expect(captureDocuments).toHaveBeenCalledWith(true, false)
  expect(api.draft).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('继续改这段文字')
  fireEvent.click(screen.getByRole('button', { name: '重新引用当前文档' }))
  await waitFor(() => expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ text: '继续改这段文字', documents: [expect.objectContaining({ epoch: 'new-epoch' })] })))
  await waitFor(() => expect(screen.queryByText(/原引用需要重新选择/)).toBeNull())
})

it('keeps a visible reference name current after save-as without rebinding the frozen reference', async () => {
  const { api } = executionFixture([conversation('renamed', '引用另存为')])
  let notify!: (event: any) => void
  const snapshot = { documentId: 'doc-rename', epoch: 'same-epoch', binding: { kind: 'file', path: 'C:/workspace/原文件.glx' } }
  const read = vi.fn(async (_id: string) => snapshot)
  vi.stubGlobal('desktopAPI', { documents: { read, subscribe: (listener: typeof notify) => { notify = listener; return () => {} } } })
  const capture = vi.fn(async () => [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: 1, writable: [{ kind: 'document' as const }] }])
  const settings = settingsFixture(false)
  const view = render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settings} captureDocuments={capture} prepareSend={async () => true} />)
  await screen.findByRole('button', { name: /移除引用 原文件.glx/ })
  await act(async () => notify({ type: 'changed', snapshot: { ...snapshot, binding: { kind: 'file', path: 'C:/workspace/另存为.glx' } } }))
  expect(screen.getByRole('button', { name: /移除引用 另存为.glx/ })).toBeInTheDocument()
  expect(api.draft).not.toHaveBeenCalled()
  await act(async () => notify({ type: 'closed', documentId: snapshot.documentId, epoch: snapshot.epoch }))
  expect(screen.getByRole('button', { name: /移除引用 另存为.glx/ })).toBeInTheDocument()
  expect(screen.getByText(/另存为.glx：原文档尚未打开/)).toBeInTheDocument()
  read.mockImplementation(async id => {
    if (id === snapshot.documentId) throw new Error('文档已关闭')
    return { ...snapshot, documentId: id, binding: { kind: 'file', path: 'C:/workspace/另一文档.txt' } }
  })
  view.rerender(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settings} captureDocuments={async () => [
    ...(await capture()), { documentId: 'another-document', epoch: snapshot.epoch, revision: 1, writable: [{ kind: 'document' }] },
  ]} prepareSend={async () => true} />)
  await screen.findByRole('button', { name: /移除引用 另一文档.txt/ })
  expect(screen.getByRole('button', { name: /移除引用 另存为.glx/ })).toBeInTheDocument()
})

it('offers an explicit resume for a user-paused queue through the existing resume operation', async () => {
  const { api } = executionFixture([conversation('a', '暂停队列会话')])
  vi.mocked(api.submissions).mockResolvedValue([{ submissionId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace', conversationId: 'a',
    state: 'queued', mode: 'queue', text: '已接收的要求', documents: [], attachments: [], createdAt: 1, updatedAt: 1,
    queuePausedReason: 'user', model: { provider: 'fixture', model: 'fixture', accountId: 'fixture', billing: 'unknown' } }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  expect(await screen.findByText(/后续任务已暂停，消息和草稿仍保留。/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '继续排队任务' }))
  await waitFor(() => expect(api.resumeQueue).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'a' }))
  expect(screen.getByRole('button', { name: '立即执行（先停止当前任务）' })).toBeVisible()
})

it('keeps sessions parallel in the workspace and preserves historical homes without using them as filters', async () => {
  const a = { ...conversation('a', '甲', '继续写'), home: { kind: 'file' as const, path: 'Unit/a.md', workspaceId: 'workspace' } }
  const b = { ...conversation('b', '乙'), home: { kind: 'folder' as const, path: 'Unit/Sub', workspaceId: 'workspace' } }
  const { api, state } = executionFixture([a, b, conversation('d', '根会话')])
  render(<WorkbenchSessionPortalProvider><ScopeControls /><WorkbenchSessionDock /><ExecutionAssistant root="C:/workspace" api={api}
    settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} /></WorkbenchSessionPortalProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '甲' })).toHaveAttribute('aria-current', 'page'))
  fireEvent.click(screen.getByRole('button', { name: '筛选 Unit' }))
  expect(screen.getByRole('button', { name: '乙' })).toBeVisible()
  expect(screen.getByRole('button', { name: '根会话' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('继续写')
  expect(state.get('a')!.home).toEqual(a.home)
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }))
  await waitFor(() => expect(api.createConversation).toHaveBeenCalledWith('workspace'))
  expect(api.setConversationHome).not.toHaveBeenCalled()
})

it('opens ChatGPT OAuth setup directly from the assistant model menu without changing the saved model', async () => {
  const { api } = executionFixture([conversation('a', '会话 A')])
  const settingsAPI = settingsFixture(true)
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveAttribute('title', expect.stringContaining('fixture-provider · fixture-model')))
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
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  fireEvent.change(composer, { target: { value: '保留这份草稿' } })
  await waitFor(() => expect(captureDocuments).toHaveBeenCalledWith(true, false))
  fireEvent.click(screen.getByRole('button', { name: '会话 B' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '会话 B' })).toHaveAttribute('aria-current', 'page'))
  expect(api.draft).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'a', expectedRevision: 1,
    text: '保留这份草稿', documents: [{ documentId: 'document-a', epoch: 'epoch', revision: 3, writable: [{ kind: 'document' }], referenceId: 'document-a:page:', pinned: false, displayLabel: '文档' }], attachments: [] })
  fireEvent.click(screen.getByRole('button', { name: '会话 A' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('保留这份草稿'))
  expect(captureDocuments).toHaveBeenCalledWith(true, false)
  expect(screen.getByLabelText('当前模型')).toHaveAttribute('title', expect.stringContaining('fixture-provider · fixture-model'))
  const references = screen.getByLabelText('本条消息的引用')
  expect(references).toHaveTextContent('已绑定文档')
  expect(references).not.toHaveTextContent('document-a')
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '直接发送' } })
  fireEvent.blur(screen.getByRole('textbox', { name: '给果铃AI发消息' }))
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(vi.mocked(api.send).mock.calls[0]![0]).toMatchObject({ workspaceId: 'workspace', conversationId: 'a', text: '直接发送', permission: 'workspace',
    documents: [{ documentId: 'document-a', writable: [{ kind: 'document' }] }],
    disclosedSettings: { profileRevision: 1, roles: { conversation: { provider: 'fixture-provider', model: 'fixture-model', billingKind: 'token-plan' } } } })
  // Read-only strips writes at send; a later level change never touches a task already sent.
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '权限：完全访问（工作空间）' }))
  const levels = screen.getByRole('menu', { name: '权限模式' })
  expect(within(levels).getAllByRole('menuitemradio').map(item => item.firstElementChild?.textContent)).toEqual(['完全访问', '完全访问（工作空间）', '修改前询问', '只读'])
  fireEvent.click(within(levels).getByRole('menuitemradio', { name: /^只读/ }))
  expect(screen.getByRole('button', { name: '权限：只读' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '只读发送' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.send).mock.calls[1]![0]).toMatchObject({ permission: 'read-only', documents: [{ documentId: 'document-a', writable: [] }] })
  expect(localStorage.getItem('guoling.execution.permission.v1:workspace')).toBe('read-only')
  // A changed route in settings is simply what the next send pins; there is no notice to acknowledge.
  const changedSettings = settingsView(true)
  changedSettings.connections[0]!.connection.revision = 2
  vi.mocked(settingsAPI.read).mockResolvedValue(changedSettings)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '新路由' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { key: 'Enter' })
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(3))
  expect(vi.mocked(api.send).mock.calls[2]![0]).toMatchObject({ disclosedSettings: { roles: { conversation: { connectionRevision: 2 } } } })
  expect(container.querySelector('.execution-assistant__toolbar')).toContainElement(screen.getByRole('button', { name: '切换模型' }))
})

it('shows an actionable configuration error and does not prepare or send an unconfigured request', async () => {
  const { api } = executionFixture([conversation('a', '新会话')])
  const prepareSend = vi.fn(async () => true)
  render(<ExecutionAssistant root={null} api={api} settingsAPI={settingsFixture(false)} captureDocuments={vi.fn(async () => [])} prepareSend={prepareSend} />)
  await screen.findByText('未配置对话模型')
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '保持用户原话' } })
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
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  fireEvent.change(composer, { target: { value: '教师刚写的新草稿' } })
  fireEvent.blur(composer)
  await waitFor(() => expect(api.draft).toHaveBeenCalled())
  fireEvent.click(retry)
  expect(api.send).not.toHaveBeenCalled()
  releaseDraft()
  await screen.findByText(/输入框已有新的文字、附件或文档引用；新草稿已保留/)
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('教师刚写的新草稿')
  expect(state.get('a')?.inputDraft).toBe('教师刚写的新草稿')
  expect(api.send).not.toHaveBeenCalled()
})

function selectionContinuationFixture(fault: 'auth' | 'transport' | 'unknown' = 'auth') {
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
  vi.mocked(api.run).mockResolvedValue({ ...run('a'), status: 'failed', requests: [{ requestId: 'request', state: 'failed', failure: fault === 'auth'
      ? { outcome: 'rejected', kind: 'auth', code: 'http-401', message: 'HTTP 401', httpStatus: 401 }
      : { outcome: 'unknown', kind: fault === 'transport' ? 'transport' : 'protocol', code: 'response-incomplete', message: '结果未知' } }] })
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
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  fireEvent.change(composer, { target: { value: '' } })
  fireEvent.blur(composer)
  await waitFor(() => expect(state.get('a')?.inputDraft).toBe(''))
  fireEvent.click(retry)
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ text: '原任务', documents, retryOfRunId: 'run' })
})

it('continues the frozen task once after an authentication failure', async () => {
  const { api, documents } = selectionContinuationFixture('auth')
  const retry = await screen.findByRole('button', { name: '连接恢复后继续此任务' })
  expect(screen.getByRole('alert')).toHaveTextContent('模型连接认证失败')
  fireEvent.click(retry); fireEvent.click(retry)
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ text: '原任务', documents, retryOfRunId: 'run' })
})

it('explains a transport interruption and offers a manual continuation', async () => {
  const { api } = selectionContinuationFixture('transport')
  expect(await screen.findByRole('alert')).toHaveTextContent('模型连接中断')
  fireEvent.click(screen.getByRole('button', { name: '连接恢复后继续此任务' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
})

it('keeps a newer draft when a connection fails', async () => {
  const { api } = selectionContinuationFixture('auth')
  const retry = await screen.findByRole('button', { name: '连接恢复后继续此任务' })
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '新的草稿' } })
  fireEvent.click(retry)
  await screen.findByText(/输入框已有新的文字、附件或文档引用；新草稿已保留/)
  expect(api.send).not.toHaveBeenCalled()
})

it('does not label an unknown provider outcome as a local request limit', async () => {
  selectionContinuationFixture('unknown')
  await screen.findByRole('textbox', { name: '给果铃AI发消息' })
  expect(screen.queryByRole('button', { name: '连接恢复后继续此任务' })).toBeNull()
  expect(screen.queryByText(/本次已达到.*模型请求上限/)).toBeNull()
})

it('gives IME and menus priority, keeps Shift+Enter multiline, and funnels Enter and the button through one submission path', async () => {
  const { api } = executionFixture([conversation('a', '输入测试')])
  render(<ExecutionAssistant root={null} api={api} settingsAPI={settingsFixture(true)} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await screen.findByRole('textbox', { name: '给果铃AI发消息' })
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeEnabled())
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
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
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(20)
  expect(screen.getByText('消息-26')).toBeInTheDocument()
  expect(screen.queryByText('消息-25')).toBeNull()
  expect(screen.getByText('第 3 / 3 组 · 共 45 条')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '查看更早的用户消息' }))
  expect(screen.getAllByLabelText('用户消息')).toHaveLength(20)
  expect(screen.getByText('消息-06')).toBeInTheDocument()
  expect(screen.getByText('消息-25')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBe(composer)

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
  await screen.findByRole('textbox', { name: '给果铃AI发消息' })
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveAttribute('title', expect.stringContaining('fixture-provider · fixture-model')))
  expect(container.querySelector('.execution-assistant__title')).toHaveTextContent('课堂讨论')
  expect(screen.queryByRole('textbox', { name: '会话名称' })).toBeNull()
  expect(screen.queryByRole('button', { name: '保存名称' })).toBeNull()
  expect(screen.queryByText('当前没有正在运行的任务')).toBeNull()
  expect(screen.queryByRole('textbox', { name: '历史关键词' })).toBeNull()
  expect(container.querySelector('.execution-assistant__composer')).not.toHaveTextContent('没有引用也可以直接对话')
  fireEvent.click(container.querySelector('.execution-assistant__more > summary')!)
  fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
  expect(screen.getByRole('textbox', { name: '历史关键词' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toBeInTheDocument()
})

it('switches a verified configured conversation model from the composer and confirms the saved route', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  const alternate = structuredClone(current.connections[0]!)
  alternate.connection.id = 'alternate'
  alternate.connection.provider = 'alternate-provider'
  alternate.connection.accountId = 'alternate-account'
  current.connections.push(alternate)
  current.capabilityRecords = [{ connectionId: 'alternate', connectionRevision: 1, model: 'alternate-model', parametersKey: '{"protocol":"openai-chat","parameters":{}}',
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
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveAttribute('title', expect.stringContaining('fixture-provider · fixture-model')))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const choices = screen.getByRole('group', { name: '对话模型选择' })
  expect(choices).toHaveTextContent('alternate-account · Token Plan')
  fireEvent.click(within(choices).getByRole('button', { name: /alternate-modelalternate-provider/ }))
  await waitFor(() => expect(settingsAPI.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1,
    roles: expect.objectContaining({ conversation: { connectionId: 'alternate', model: 'alternate-model', parameters: {} } }) })))
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveAttribute('title', expect.stringContaining('alternate-provider · alternate-model')))
  expect(screen.queryByRole('group', { name: '对话模型选择' })).toBeNull()
  expect(api.send).not.toHaveBeenCalled()
})

it('reports an empty directory and retries into a selectable model without losing the current choice', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.discoverModels).mockResolvedValueOnce({ connectionId: 'connection', connectionRevision: 1,
    models: [], capabilitiesVerified: false, source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
    .mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
      models: [{ id: 'retry-model', displayName: '重试模型' }], capabilitiesVerified: false,
      source: 'live', checkedAt: '2026-09-25T00:00:00.000Z' })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const menu = screen.getByRole('group', { name: '对话模型选择' })
  const retry = await within(menu).findByRole('button', { name: '重试目录' })
  expect(within(menu).getByText(/服务返回了空模型目录/)).toBeVisible()
  expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model')
  expect(settingsAPI.saveProfile).not.toHaveBeenCalled()
  fireEvent.click(retry)
  const model = await within(menu).findByRole('button', { name: /重试模型/ })
  fireEvent.click(model)
  await waitFor(() => expect(settingsAPI.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
    roles: expect.objectContaining({ conversation: expect.objectContaining({ model: 'retry-model' }) }),
  })))
  expect(settingsAPI.discoverModels).toHaveBeenCalledTimes(2)
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
  await waitFor(() => expect(effort).toHaveTextContent('模型文档补充；当前连接目录未声明，实际支持尚未验证'))
  expect(effort).not.toHaveTextContent('工具调用在此模式下要求 Responses')
  for (const label of ['关闭', '低', '中', '高', '极高', '最高']) expect(within(effort).getByRole('button', { name: label })).toBeInTheDocument()
  expect(within(effort).queryByRole('button', { name: '极低' })).toBeNull()
  fireEvent.click(within(effort).getByRole('button', { name: '最高' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ reasoning: { effort: 'max' } }))
  expect(api.send).not.toHaveBeenCalled()
})

it('explains GPT Chat tool compatibility without blocking effort selection and removes the hint for thinking off', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.profile.roles.conversation = { connectionId: 'connection', model: 'gpt-6-luna', parameters: { reasoning_effort: 'high' } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('gpt-6-luna'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const effort = screen.getByRole('group', { name: '推理强度' })
  expect(effort).toHaveTextContent('工具调用在此模式下要求 Responses')
  expect(within(effort).getByRole('button', { name: '最高' })).toBeEnabled()
  fireEvent.click(within(effort).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('group', { name: '对话模型选择' })).toBeNull())
  expect(current.profile.roles.conversation?.parameters).toEqual({ reasoning_effort: 'none' })
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  expect(screen.getByRole('group', { name: '推理强度' })).not.toHaveTextContent('工具调用在此模式下要求 Responses')
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
  await waitFor(() => expect(effort).not.toHaveTextContent('模型文档补充'))
  expect(within(effort).getByRole('button', { name: '高' })).toBeInTheDocument()
  expect(within(effort).queryByRole('button', { name: '最高' })).toBeNull()
  expect(within(effort).queryByRole('button', { name: '关闭' })).toBeNull()
  expect(effort).not.toHaveTextContent('模型文档补充')
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

it('shows all account models immediately, pins favorites first, and searches without auto-favoriting OAuth models', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const current = settingsView(true)
  const account = '123e4567-e89b-12d3-a456-426614173762'
  current.connections[0]!.connection.provider = 'openai'
  current.connections[0]!.connection.protocol = 'chatgpt-responses'
  current.connections[0]!.connection.accountId = account
  current.connections[0]!.connection.auth.kind = 'oauth'
  current.modelFavorites = [{ connectionId: 'connection', model: 'gpt-6-sol' }]
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
  const list = within(menu).getByRole('group', { name: '全部连接与模型' })
  expect(menu.children[1]).toBe(effort)
  expect(menu.children[2]).toBe(list)
  expect(list).toContainElement(within(menu).getByRole('button', { name: /gpt-6-solopenai/ }))
  expect(list).not.toContainElement(within(menu).getByRole('button', { name: '管理模型与连接…' }))
  expect(menu).toHaveTextContent('ChatGPT 账号 · 尾号 3762')
  expect(menu).not.toHaveTextContent(account)
  expect(menu).toHaveTextContent('目录能力未验证')
  expect(within(list).getByRole('button', { name: /gpt-6-lunaopenai/ })).toBeVisible()
  expect(within(list).getByRole('button', { name: /gpt-6-astraopenai/ })).toBeVisible()
  expect(within(menu).getByRole('textbox', { name: '搜索模型' })).toBeVisible()
  expect(within(list).getAllByRole('button')[0]).toHaveTextContent('gpt-6-sol')
  expect(settingsAPI.setModelFavorite).not.toHaveBeenCalled()
  const groups = within(menu).getByRole('group', { name: '全部连接与模型' })
  expect(within(groups).getByRole('group', { name: /连接 openai/ })).toHaveTextContent('简单、快速的任务')
  expect(groups).toHaveTextContent('复杂任务与架构分析')
  fireEvent.change(within(menu).getByRole('textbox', { name: '搜索模型' }), { target: { value: 'older-4' } })
  expect(within(groups).getByRole('button', { name: /older-4openai/ })).toBeInTheDocument()
  expect(within(groups).queryByRole('button', { name: /gpt-6-solopenai/ })).toBeNull()
  expect(api.send).not.toHaveBeenCalled()
})

it('persists favorites by route without switching models, keeps them through directory failure, and preserves preferences on save failure', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.profile.roles.conversation!.parameters = { temperature: 0.4 }
  const alternate = structuredClone(current.connections[0]!)
  alternate.connection.id = 'alternate'
  alternate.connection.provider = 'second-provider'
  alternate.connection.billing.kind = 'subscription'
  current.connections.push(alternate)
  const selected = structuredClone(current.profile.roles)
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.discoverModels).mockImplementation(async id => {
    if (id === 'connection') throw new Error('directory-unavailable')
    return { connectionId: id, connectionRevision: 1, models: [{ id: 'fixture-model' }], capabilitiesVerified: false,
      source: 'live', checkedAt: '2026-10-03T00:00:00.000Z' }
  })
  vi.mocked(settingsAPI.setModelFavorite).mockImplementation(async ({ connectionId, model, favorite }) => {
    const remaining = (current.modelFavorites ?? []).filter(value => value.connectionId !== connectionId || value.model !== model)
    current = { ...current, modelFavorites: favorite ? [...remaining, { connectionId, model }] : remaining }
    return structuredClone(current.modelFavorites!)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  let menu = screen.getByRole('group', { name: '对话模型选择' })
  expect(within(menu).getByRole('button', { name: /fixture-modelfixture-provider/ })).toBeVisible()
  const originalGroup = within(menu).getByRole('group', { name: /连接 fixture-provider/ })
  fireEvent.click(within(originalGroup).getByRole('button', { name: /收藏 fixture-model/ }))
  await waitFor(() => expect(within(originalGroup).getByRole('button', { name: /取消收藏 fixture-model/ })).toBeEnabled())
  const otherGroup = within(menu).getByRole('group', { name: /连接 second-provider/ })
  fireEvent.click(await within(otherGroup).findByRole('button', { name: /收藏 fixture-model/ }))
  await waitFor(() => expect(current.modelFavorites).toEqual([
    { connectionId: 'connection', model: 'fixture-model' }, { connectionId: 'alternate', model: 'fixture-model' },
  ]))
  expect(menu.querySelector('button button')).toBeNull()
  expect(settingsAPI.saveProfile).not.toHaveBeenCalled()
  expect(current.profile.roles).toEqual(selected)
  expect(within(menu).getByRole('group', { name: '全部连接与模型' }).querySelectorAll('.execution-assistant__model-option')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  menu = screen.getByRole('group', { name: '对话模型选择' })
  const favoriteList = within(menu).getByRole('group', { name: '全部连接与模型' })
  expect(within(favoriteList).getByRole('button', { name: /fixture-modelfixture-provider/ })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(favoriteList).getByRole('button', { name: /取消收藏 fixture-model · fixture-provider/ }))
  await waitFor(() => expect(current.modelFavorites).toEqual([{ connectionId: 'alternate', model: 'fixture-model' }]))
  expect(current.profile.roles).toEqual(selected)
  vi.mocked(settingsAPI.setModelFavorite).mockRejectedValueOnce(new Error('save-failed'))
  fireEvent.click(within(favoriteList).getByRole('button', { name: /取消收藏 fixture-model · second-provider/ }))
  await within(menu).findByRole('alert')
  expect(menu).toHaveTextContent('收藏未保存；原偏好保留')
  expect(within(favoriteList).getByRole('button', { name: /fixture-modelsecond-provider/ })).toBeInTheDocument()
  expect(current.modelFavorites).toEqual([{ connectionId: 'alternate', model: 'fixture-model' }])
  expect(current.profile.roles).toEqual(selected)
  expect(api.send).not.toHaveBeenCalled()
})

it('shows favorites for revoked or missing connections as unavailable without changing the current role', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  const current = settingsView(true)
  const revoked = structuredClone(current.connections[0]!)
  revoked.connection.id = 'revoked'
  revoked.revoked = true
  current.connections.push(revoked)
  current.modelFavorites = [{ connectionId: 'revoked', model: 'saved-model' }, { connectionId: 'removed', model: 'missing-model' }]
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockResolvedValue(current)
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('fixture-model'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const favorites = screen.getByRole('group', { name: '全部连接与模型' })
  expect(within(favorites).getByRole('button', { name: /saved-modelfixture-provider/ })).toBeDisabled()
  expect(within(favorites).getByRole('button', { name: /missing-modelremoved/ })).toBeDisabled()
  expect(favorites).toHaveTextContent('连接不可用')
  expect(settingsAPI.saveProfile).not.toHaveBeenCalled()
  expect(api.send).not.toHaveBeenCalled()
})

it('maps DeepSeek reasoning off, restored low, and default from the UI while preserving unrelated advanced parameters', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.provider = 'teamorouter'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'deepseek-flash',
    parameters: { thinking: { type: 'enabled', extra: 'keep' }, reasoning_effort: 'max', temperature: 0.4 } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('deepseek-flash'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  fireEvent.click(within(screen.getByRole('group', { name: '推理强度' })).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ thinking: { type: 'disabled', extra: 'keep' }, temperature: 0.4 }))
  await waitFor(() => expect(screen.queryByRole('group', { name: '对话模型选择' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  let effort = screen.getByRole('group', { name: '推理强度' })
  expect(within(effort).getByRole('button', { name: '关闭' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(effort).getByRole('button', { name: '默认' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(within(effort).getByRole('button', { name: '低' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ thinking: { type: 'enabled', extra: 'keep' }, reasoning_effort: 'low', temperature: 0.4 }))
  await waitFor(() => expect(screen.queryByRole('group', { name: '对话模型选择' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  effort = screen.getByRole('group', { name: '推理强度' })
  expect(within(effort).getByRole('button', { name: '低' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(effort).getByRole('button', { name: '默认' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ thinking: { extra: 'keep' }, temperature: 0.4 }))
  expect(api.send).not.toHaveBeenCalled()
})

it('does not present historical folder bindings as current workspace session constraints', async () => {
  const old = { ...conversation('a', '历史会话', '历史草稿'), home: { kind: 'file' as const, path: 'Unit/deleted.md', workspaceId: 'workspace', missing: true as const } }
  const { api, state } = executionFixture([old, conversation('b', '平行会话', '另一稿')])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} />)
  expect(await screen.findByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('历史草稿')
  expect(screen.queryByText(/所属文件已删除/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Unit\/deleted/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '平行会话' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue('另一稿'))
  expect(state.get('a')!.home).toEqual(old.home)
})

it('automatically maps catalog Claude effort to Messages controls on the same metered connection', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.baseURL = 'https://api.teamorouter.com/v1'
  current.connections[0]!.connection.billing.kind = 'metered'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'claude-opus-4-6', parameters: { temperature: 0.4 } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.discoverModels).mockResolvedValue({ connectionId: 'connection', connectionRevision: 1,
    models: [{ id: 'claude-opus-4-6', metadata: { id: 'claude-opus-4-6', provider: 'anthropic', reasoning: { kind: 'effort', efforts: ['low', 'high', 'max'] } }, metadataSource: 'models.dev' }],
    capabilitiesVerified: false, source: 'live', checkedAt: '2026-10-03T00:00:00.000Z' })
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('claude-opus-4-6'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const group = screen.getByRole('group', { name: '推理强度' })
  fireEvent.click(await within(group).findByRole('button', { name: '最高' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ temperature: 0.4, thinking: { type: 'adaptive' }, output_config: { effort: 'max' } }))
  expect(current.connections[0]!.connection).toMatchObject({ protocol: 'openai-chat', billing: { kind: 'metered' } })
  expect(api.send).not.toHaveBeenCalled()
})

it('selects a searchable capability reference for an unknown alias without JSON or changing its request model', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.baseURL = 'https://api.teamorouter.com/v1'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'private-alias', parameters: { temperature: 0.4, thinking: { type: 'enabled', budget_tokens: 12000 } } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.knownModels).mockResolvedValue([{ id: 'anthropic/claude-opus-4-6', provider: 'another-router', reasoning: { kind: 'effort', efforts: ['none', 'low', 'high'] } },
    { id: 'claude-opus-4-6', provider: 'anthropic', reasoning: { kind: 'effort', efforts: ['low', 'high', 'max'] } }, { id: 'gpt-5.4-mini', provider: 'openai' }])
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('private-alias'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const reference = await screen.findByLabelText('参考型号')
  await within(reference).findByRole('option', { name: 'claude-opus-4-6' })
  fireEvent.change(screen.getByLabelText('搜索参考型号'), { target: { value: 'claude' } })
  expect(within(reference).queryByRole('option', { name: 'gpt-5.4-mini' })).toBeNull()
  fireEvent.change(reference, { target: { value: 'anthropic/claude-opus-4-6' } })
  await waitFor(() => expect(current.profile.roles.conversation).toMatchObject({ model: 'private-alias', capabilityModel: 'anthropic/claude-opus-4-6', parameters: { temperature: 0.4 } }))
  expect(within(screen.getByRole('group', { name: '推理强度' })).queryByRole('button', { name: '关闭' })).toBeNull()
  fireEvent.click(await within(screen.getByRole('group', { name: '推理强度' })).findByRole('button', { name: '高' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ temperature: 0.4, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }))
  expect(current.profile.roles.conversation?.model).toBe('private-alias')
  expect(current.profile.roles.conversation?.connectionId).toBe('connection')
  expect(api.send).not.toHaveBeenCalled()
})

it('sets Haiku thinking tokens directly and supports disabling or default without fabricating a task limit', async () => {
  const { api } = executionFixture([conversation('a', '课堂讨论')])
  let current = settingsView(true)
  current.connections[0]!.connection.baseURL = 'https://api.teamorouter.com/v1'
  current.profile.roles.conversation = { connectionId: 'connection', model: 'claude-haiku-4-5', parameters: { temperature: 0.4 } }
  const settingsAPI = settingsFixture(true)
  vi.mocked(settingsAPI.read).mockImplementation(async () => structuredClone(current))
  vi.mocked(settingsAPI.saveProfile).mockImplementation(async input => {
    current = { ...current, profile: { ...current.profile, revision: current.profile.revision + 1, roles: input.roles } }
    return structuredClone(current.profile)
  })
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByLabelText('当前模型')).toHaveTextContent('claude-haiku-4-5'))
  fireEvent.click(screen.getByRole('button', { name: '切换模型' }))
  const group = screen.getByRole('group', { name: '思考 token 设置' })
  expect(within(group).getByRole('button', { name: '开启思考' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('思考 token 数'), { target: { value: '12000' } })
  fireEvent.click(within(group).getByRole('button', { name: '开启思考' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ temperature: 0.4, thinking: { type: 'enabled', budget_tokens: 12000 } }))
  fireEvent.click(within(group).getByRole('button', { name: '关闭思考' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ temperature: 0.4, thinking: { type: 'disabled' } }))
  fireEvent.click(within(group).getByRole('button', { name: '默认' }))
  await waitFor(() => expect(current.profile.roles.conversation?.parameters).toEqual({ temperature: 0.4 }))
  expect(api.send).not.toHaveBeenCalled()
})


it('sends a text-only adjustment on the existing task without capturing temporary targets, new materials or a new model route', async () => {
  const active = conversation('a', '原任务正在执行', '改变后续要求')
  active.runIndex.builtinRunIds.push('run')
  const { api } = executionFixture([active])
  vi.mocked(api.run).mockResolvedValue(run('a'))
  api.prepareDocuments = vi.fn(async () => { throw new Error('A steering input must not prepare a new document grant') })
  const prepareSend = vi.fn(async () => false)
  const captureMaterials = vi.fn(async () => { throw new Error('A steering input must not capture new materials') })
  const settingsAPI = settingsFixture(false) // The original run still owns its frozen route.
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsAPI}
    captureDocuments={vi.fn(async () => [{ documentId: 'temporary', epoch: 'temporary-epoch', revision: 1, writable: [{ kind: 'document' as const }] }])}
    captureMaterials={captureMaterials} prepareSend={prepareSend} />)
  const adjust = await screen.findByRole('button', { name: '调整当前任务' })
  await waitFor(() => expect(adjust).toBeEnabled())
  const settingsReads = vi.mocked(settingsAPI.read).mock.calls.length
  fireEvent.click(adjust)
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0][0]).toMatchObject({ mode: 'adjust', text: '改变后续要求', documents: [], attachments: [], permission: 'workspace' })
  expect(vi.mocked(api.send).mock.calls[0][0].disclosedSettings).toBeUndefined()
  expect(api.stop).not.toHaveBeenCalled(); expect(api.prepareDocuments).not.toHaveBeenCalled()
  expect(prepareSend).not.toHaveBeenCalled(); expect(captureMaterials).not.toHaveBeenCalled()
  expect(settingsAPI.read).toHaveBeenCalledTimes(settingsReads)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给果铃AI发消息' })).toHaveValue(''))
  fireEvent.change(screen.getByRole('textbox', { name: '给果铃AI发消息' }), { target: { value: '新授权应加入队列' } })
  fireEvent.click(screen.getByRole('button', { name: '权限：完全访问（工作空间）' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /只读/ }))
  expect(screen.getByRole('button', { name: '调整当前任务' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '加入队列' })).toBeEnabled()
})

it('removing the current automatic page drops its dependent automatic elements and actual point selection while keeping an independent pin', async () => {
  const { api } = executionFixture([conversation('page-context', '当前页面')])
  const a1 = { kind: 'course-instance' as const, surfaceId: 'A', instanceId: 'A1' }
  const a2 = { kind: 'course-instance' as const, surfaceId: 'A', instanceId: 'A2' }
  workbenchSelection.setManual('page-project', { documentId: 'page-project', epoch: 'epoch', revision: 1, targets: [a1, a2], label: '所选对象' })
  const clear = vi.fn(), release = workbenchSelection.registerSelectionClearer('page-project', clear)
  const capture = vi.fn(async () => [{ documentId: 'page-project', epoch: 'epoch', revision: 1, writable: [{ kind: 'document' as const }], selection: [a1, a2] }])
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={capture} prepareSend={async () => true} />)
  await screen.findByRole('button', { name: /移除引用.*当前页面/ })
  const pins = screen.getAllByRole('button', { name: /固定 .*所选对象/ })
  fireEvent.click(pins[0]!)
  await waitFor(() => expect(api.draft).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: /移除引用.*当前页面/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /移除引用.*当前页面/ })).toBeNull())
  expect(screen.getAllByRole('button', { name: /移除引用.*所选对象/ })).toHaveLength(1)
  expect(clear).toHaveBeenCalledWith([a2])
  expect(workbenchSelection.getManual('page-project')?.targets).toEqual([a1])
  await act(async () => workbenchSelection.setManual('unrelated-focus', null))
  expect(screen.getAllByRole('button', { name: /移除引用.*所选对象/ })).toHaveLength(1)
  release(); workbenchSelection.setManual('page-project', null)
})

it('does not let a late older task record overwrite the newer task model and coalesces text-burst reads', async () => {
  const initial = conversation('a', '并发状态'); initial.runIndex.builtinRunIds = ['older']
  const { api, emit } = executionFixture([initial])
  const olderRead = deferred<ExecutionRunRecord | null>(), newerRead = deferred<ExecutionRunRecord | null>()
  vi.mocked(api.run).mockImplementation(id => id === 'older' ? olderRead.promise : newerRead.promise)
  render(<ExecutionAssistant root="C:/workspace" api={api} settingsAPI={settingsFixture(false)} captureDocuments={async () => []} prepareSend={async () => true} />)
  await waitFor(() => expect(api.run).toHaveBeenCalledWith('older'))
  await act(async () => { for (let index = 0; index < 15; index++) emit({ ...streamEvent(1, '过程'), runId: 'newer' }) })
  expect(vi.mocked(api.run).mock.calls.filter(call => call[0] === 'newer')).toHaveLength(1)
  const newer = { ...run('a'), runId: 'newer', createdAt: 20, version: 7, input: { ...run('a').input, selection: { ...run('a').input.selection, model: 'new-task-model' } } }
  await act(async () => newerRead.resolve(newer))
  expect(screen.getByText(/当前任务：new-task-model/)).toBeTruthy()
  await act(async () => olderRead.resolve({ ...run('a'), runId: 'older', createdAt: 10, version: 99 }))
  expect(screen.getByText(/当前任务：new-task-model/)).toBeTruthy()
})
