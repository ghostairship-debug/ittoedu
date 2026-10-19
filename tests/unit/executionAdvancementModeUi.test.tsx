import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, ExecutionAdvancementMode } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI, ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const selection: ExecutionRunRecord['input']['selection'] = { connection: {
  id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
  auth: { kind: 'api-key', credentialRef: 'fixture-only' }, billing: { kind: 'token-plan' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
}, model: 'fixture-model' }

function fixture(options: { advancementMode?: ExecutionAdvancementMode; run?: 'running' | 'failed'; draft?: string } = {}) {
  let conversation: ConversationRecord = { conversationId: 'conversation', workspaceId: 'workspace', title: '推进方式', messages: [], attachmentIds: [],
    runIndex: { builtinRunIds: options.run ? ['run'] : [], externalRunIds: [], externalPortIds: [] }, inputDraft: options.draft ?? '', inputAttachments: [],
    frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1, ...(options.advancementMode ? { advancementMode: options.advancementMode } : {}) }
  let run: ExecutionRunRecord | null = options.run ? { schemaVersion: 1, runId: 'run', version: 1,
    input: { conversationId: conversation.conversationId, taskId: 'original', instruction: '原任务', selection, documents: [], ...(options.advancementMode ? { advancementMode: options.advancementMode } : {}) },
    status: options.run, createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, tools: [],
    requests: options.run === 'failed' ? [{ requestId: 'request', state: 'failed',
      failure: { kind: 'protocol', code: 'provider-unknown-sse', message: 'fixture failure', outcome: 'rejected' } }] : [],
  } : null
  const submissions: ExecutionSubmissionRecord[] = options.run ? [{ submissionId: 'original', workspaceId: 'workspace', conversationId: 'conversation',
    state: 'accepted', mode: 'queue', text: '原任务', documents: [], attachments: [], runId: 'run', createdAt: 1, updatedAt: 1,
    model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' } }] : []
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const api: ExecutionDesktopAPI = {
    workspace: vi.fn(async () => ({ workspace: { workspaceId: 'workspace', rootPath: 'C:/mode-ui', managed: false, authorization: 'user-selected' as const, revision: 1, createdAt: 1, updatedAt: 1 }, conversations: [structuredClone(conversation)] })),
    conversations: vi.fn(async () => [structuredClone(conversation)]), createConversation: vi.fn(async () => structuredClone(conversation)),
    conversation: vi.fn(async () => structuredClone(conversation)),
    setAdvancementMode: vi.fn(async input => {
      conversation = { ...conversation, advancementMode: input.advancementMode, updatedAt: conversation.updatedAt + 1 }
      if (run && ['queued', 'running'].includes(run.status)) run = { ...run, version: run.version + 1,
        steering: [...run.steering ?? [], { submissionId: 'mode-choice', text: '用户选择', advancementMode: input.advancementMode, acceptedAt: 2 }] }
      return structuredClone(conversation)
    }),
    draft: vi.fn(async input => {
      conversation = { ...conversation, inputDraft: input.text, inputAttachments: input.attachments ?? [], revision: conversation.revision + 1,
        updatedAt: conversation.updatedAt + 1 }
      return structuredClone(conversation)
    }),
    send: vi.fn(async input => {
      conversation = { ...conversation, inputDraft: '', inputAttachments: [], revision: conversation.revision + 1, updatedAt: conversation.updatedAt + 1 }
      const submission: ExecutionSubmissionRecord = { submissionId: input.submissionId, workspaceId: 'workspace', conversationId: 'conversation',
        state: 'accepted', mode: input.mode ?? 'queue', text: input.text, documents: input.documents, attachments: input.attachments ?? [],
        ...(input.advancementMode ? { advancementMode: input.advancementMode } : {}), runId: 'next-run', createdAt: 3, updatedAt: 3,
        model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' } }
      return { submission, conversation: structuredClone(conversation) }
    }),
    run: vi.fn(async () => structuredClone(run)), stop: vi.fn(async () => null),
    submission: vi.fn(async () => null), submissions: vi.fn(async () => structuredClone(submissions)),
    renameConversation: vi.fn(async () => structuredClone(conversation)), deleteConversation: vi.fn(async () => {}),
    deleteSubmission: vi.fn(async () => { throw new Error('unused') }), pauseQueue: vi.fn(async () => {}), resumeQueue: vi.fn(async () => {}),
    events: vi.fn(async (_id, after = 0) => ({ events: [], cursor: after, hasMore: false })),
    searchEvents: vi.fn(async () => ({ hits: [], cursor: 0, hasMore: false })), timeline: vi.fn(async id => emptyExecutionProjection(id)),
    blob: vi.fn(async () => ''), edits: vi.fn(async () => []), subscribe: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener) }), subscribeEdits: vi.fn(() => () => {}),
  }
  const settings: ExecutionSettingsView = { secureStorageAvailable: true, modelFavorites: [],
    connections: [{ connection: selection.connection, hasCredential: true, revoked: false }],
    profile: { revision: 1, updatedAt: '2026-10-12T00:00:00.000Z', roles: { conversation: { connectionId: 'connection', model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } } }
  const settingsAPI: ExecutionSettingsAPI = { read: vi.fn(async () => settings), probeCapabilities: vi.fn(async () => { throw new Error('unused') }),
    saveConnection: vi.fn(async () => { throw new Error('unused') }), saveProfile: vi.fn(async () => { throw new Error('unused') }),
    setModelFavorite: vi.fn(async () => []), knownModels: vi.fn(async () => []), revokeConnection: vi.fn(async () => {}),
    discoverModels: vi.fn(async () => ({ connectionId: 'connection', connectionRevision: 1, models: [], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '' })),
    startOAuthLogin: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })), oauthLoginStatus: vi.fn(async () => ({ loginId: 'login', status: 'pending' as const })), cancelOAuthLogin: vi.fn(async () => {}) }
  const view = () => render(<ExecutionAssistant root="C:/mode-ui" api={api} settingsAPI={settingsAPI} captureDocuments={async () => []} prepareSend={async () => true} />)
  return { api, view, readConversation: () => conversation, readRun: () => run,
    changeFromModel: (advancementMode: ExecutionAdvancementMode) => {
      conversation = { ...conversation, advancementMode, updatedAt: conversation.updatedAt + 1 }
      if (run) run = { ...run, version: run.version + 1, steering: [...run.steering ?? [], { submissionId: 'model-accepted', text: '用户原话', advancementMode, acceptedAt: 4 }] }
      listeners.forEach(listener => listener({ eventId: 'mode-state', itemId: 'run-state', source: 'builtin', update: 'snapshot', sequence: 1, type: 'run.state', conversationId: 'conversation', runId: 'run', taskId: 'original', time: 4, data: { status: 'running' } }))
    } }
}

it('offers no advancement selector and sends without an invented mode', async () => {
  const f = fixture({ draft: '开始创作' }); f.view()
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
  expect(screen.queryByRole('combobox', { name: '推进方式' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(f.api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(f.api.send).mock.calls[0][0].advancementMode).toBeUndefined()
  expect(f.api.setAdvancementMode).not.toHaveBeenCalled()
})

it('does not send a legacy conversation mode and preserves explicit confirmation instructions in the user text', async () => {
  const text = '先给我看策划，等我确认后再继续'
  const f = fixture({ advancementMode: 'stepwise', draft: text }); f.view()
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
  expect(screen.queryByRole('combobox', { name: '推进方式' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(f.api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(f.api.send).mock.calls[0][0]).toMatchObject({ mode: 'queue', text })
  expect(vi.mocked(f.api.send).mock.calls[0][0].advancementMode).toBeUndefined()
  expect(f.readConversation().advancementMode).toBe('stepwise')
  expect(f.api.setAdvancementMode).not.toHaveBeenCalled()
})

it('keeps an unsent draft through a running mode event and adjusts using the actual user text', async () => {
  const f = fixture({ advancementMode: 'automatic', run: 'running', draft: '补充要求' }); f.view()
  await screen.findByRole('button', { name: '调整当前任务' })
  const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
  fireEvent.change(composer, { target: { value: '先让我确认当前图示' } })
  await act(async () => f.changeFromModel('stepwise'))
  expect(composer).toHaveValue('先让我确认当前图示')
  expect(f.api.draft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '调整当前任务' }))
  await waitFor(() => expect(f.api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(f.api.send).mock.calls[0][0]).toMatchObject({ mode: 'adjust', text: '先让我确认当前图示', documents: [], attachments: [] })
  expect(vi.mocked(f.api.send).mock.calls[0][0].advancementMode).toBeUndefined()
  expect(f.api.setAdvancementMode).not.toHaveBeenCalled()
})

it('continues a failed task without copying its old selector value', async () => {
  const f = fixture({ advancementMode: 'stepwise', run: 'failed' }); f.view()
  await screen.findByRole('button', { name: '连接恢复后继续此任务' })
  fireEvent.click(screen.getByRole('button', { name: '连接恢复后继续此任务' }))
  await waitFor(() => expect(f.api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(f.api.send).mock.calls[0][0]).toMatchObject({ retryOfRunId: 'run', text: '原任务' })
  expect(vi.mocked(f.api.send).mock.calls[0][0].advancementMode).toBeUndefined()
  expect(f.readRun()?.input.advancementMode).toBe('stepwise')
})

it('keeps an unsent draft when an older workspace file-notification read arrives later', async () => {
  const f = fixture({ advancementMode: 'stepwise', draft: '已存草稿' })
  const oldSnapshot = await f.api.workspace('C:/mode-ui')
  let resolve!: (value: typeof oldSnapshot) => void
  const oldRead = new Promise<typeof oldSnapshot>(done => { resolve = done })
  vi.mocked(f.api.workspace).mockResolvedValueOnce(oldSnapshot).mockImplementationOnce(async () => oldRead)
  let changed!: () => void
  const previous = window.desktopAPI
  window.desktopAPI = { ...previous, onWorkspaceFilesChanged: listener => { changed = () => listener({ workspaceId: 'workspace' }); return () => {} } }
  try {
    f.view()
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
    const composer = screen.getByRole('textbox', { name: '给果铃AI发消息' })
    fireEvent.change(composer, { target: { value: '还未保存的新草稿' } })
    act(() => changed())
    await waitFor(() => expect(f.api.workspace).toHaveBeenCalledTimes(3))
    await act(async () => resolve(oldSnapshot))
    expect(screen.queryByRole('combobox', { name: '推进方式' })).not.toBeInTheDocument()
    expect(composer).toHaveValue('还未保存的新草稿')
    expect(f.api.draft).not.toHaveBeenCalled()
    expect(f.api.send).not.toHaveBeenCalled()
  } finally { window.desktopAPI = previous }
})
