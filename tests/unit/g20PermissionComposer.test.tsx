import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import { pendingApproval } from '../../src/renderer/workbench/executionTimelineModel'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI, ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'

// S10-T07 / M07-T07 (Owner 2026-09-24): approval card for "修改前询问", "+" menu and "立即执行" on a queued message.
afterEach(() => { cleanup(); localStorage.clear() })
const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation: ConversationRecord = { conversationId: 'c1', workspaceId: 'workspace', title: '权限会话', messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1 }
const base = { conversationId: 'c1', taskId: 'task', runId: 'run', time: 1, source: 'builtin' as const }
const approvalEvents: ExecutionEvent[] = [
  { ...base, eventId: 'e1', itemId: 'run-state', sequence: 1, type: 'run.state', update: 'snapshot', data: { status: 'waiting', label: '等待你批准修改' } },
  { ...base, eventId: 'e2', itemId: 'request:0', sequence: 2, type: 'tool', update: 'append', data: { toolName: 'text.replace', label: '修改正文', status: 'approval',
    approval: { summary: '修改正文', documents: ['教案.md'], reason: 'ask', preview: '原文：旧句子\n改为：新句子' } } },
]
const settingsAPI = (): ExecutionSettingsAPI => ({
  read: vi.fn(async (): Promise<ExecutionSettingsView> => ({ secureStorageAvailable: true,
    connections: [{ connection: { id: 'connection', revision: 1, provider: 'fixture-provider', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'metered' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false }],
    profile: { revision: 1, updatedAt: '2026-09-24T00:00:00.000Z', roles: { conversation: { connectionId: 'connection', model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } } })),
  probeCapabilities: vi.fn(async () => { throw new Error('unused') }), saveConnection: vi.fn(async () => { throw new Error('unused') }),
  saveProfile: vi.fn(async () => { throw new Error('unused') }), revokeConnection: vi.fn(async () => {}),
  discoverModels: vi.fn(async () => ({ connectionId: 'c', connectionRevision: 1, models: [], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '2026-09-25T00:00:00.000Z' })),
  startOAuthLogin: vi.fn(async () => ({ loginId: 'l', status: 'pending' as const })), oauthLoginStatus: vi.fn(async () => ({ loginId: 'l', status: 'pending' as const })),
  cancelOAuthLogin: vi.fn(async () => {}),
})
function api(timeline: ExecutionEvent[], extra: Partial<ExecutionDesktopAPI> = {}) {
  const value: ExecutionDesktopAPI = {
    workspace: vi.fn(async () => ({ workspace, conversations: [structuredClone(conversation)] })), conversations: vi.fn(async () => [structuredClone(conversation)]),
    createConversation: vi.fn(async () => structuredClone(conversation)), conversation: vi.fn(async () => structuredClone(conversation)),
    draft: vi.fn(async input => ({ ...structuredClone(conversation), inputDraft: input.text, revision: input.expectedRevision + 1 })),
    renameConversation: vi.fn(async () => structuredClone(conversation)), deleteConversation: vi.fn(async () => {}),
    send: vi.fn(async () => { throw new Error('unused') }), submission: vi.fn(async () => null), submissions: vi.fn(async () => []),
    deleteSubmission: vi.fn(async () => { throw new Error('unused') }), pauseQueue: vi.fn(async () => {}), resumeQueue: vi.fn(async () => {}),
    run: vi.fn(async () => null), stop: vi.fn(async () => null),
    events: vi.fn(async (_id, after = 0) => ({ events: [], cursor: after, hasMore: false })), searchEvents: vi.fn(async () => ({ hits: [], cursor: 0, hasMore: false })),
    timeline: vi.fn(async id => foldExecutionEvents(emptyExecutionProjection(id), timeline)), blob: vi.fn(async () => ''), edits: vi.fn(async () => []),
    subscribe: vi.fn(() => () => {}), subscribeEdits: vi.fn(() => () => {}), ...extra,
  }
  return value
}

it('S10-T07 shows the pending modification as an approval card and sends the chosen decision', async () => {
  expect(pendingApproval(foldExecutionEvents(emptyExecutionProjection('c1'), approvalEvents))).toMatchObject({ runId: 'run', callId: 'request:0' })
  const approve = vi.fn<NonNullable<ExecutionDesktopAPI['approve']>>(async () => ({ runId: 'run' }) as Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['approve']>>>)
  render(<ExecutionAssistant root="C:/workspace" api={api(approvalEvents, { approve })} settingsAPI={settingsAPI()} captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  const card = await screen.findByRole('region', { name: '修改请求' })
  expect(card).toHaveTextContent('修改正文 · 教案.md')
  expect(within(card).getByLabelText('修改内容')).toHaveTextContent('原文：旧句子')
  expect(within(card).getByLabelText('修改内容')).toHaveTextContent('改为：新句子')
  expect(within(within(card).getByRole('group', { name: '是否允许' })).getAllByRole('button').map(button => button.textContent)).toEqual(['允许', '本任务都允许', '拒绝'])
  fireEvent.click(within(card).getByRole('button', { name: '本任务都允许' }))
  await waitFor(() => expect(approve).toHaveBeenCalledWith({ runId: 'run', callId: 'request:0', decision: 'allow-all' }))
  await screen.findByText('已提交决定，任务继续中…')
})

it('M07-T07 "+" offers attachments and references; referencing a missing selection keeps the draft and explains why', async () => {
  const captureDocuments = vi.fn(async () => [{ documentId: 'doc', epoch: 'e', revision: 1, writable: [{ kind: 'document' as const }] }])
  render(<ExecutionAssistant root="C:/workspace" api={api([])} settingsAPI={settingsAPI()} captureDocuments={captureDocuments} prepareSend={vi.fn(async () => true)} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '添加' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  const menu = screen.getByRole('menu', { name: '添加内容' })
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['添加附件（图片或文档）', '引用工作空间文件', '引用当前文档', '引用当前选区'])
  fireEvent.click(within(menu).getByRole('menuitem', { name: '引用当前选区' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('当前没有有效选区')
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '添加内容' })).getByRole('menuitem', { name: '引用当前文档' }))
  const chips = await screen.findByLabelText('本条消息的引用')
  expect(within(chips).getByRole('button', { name: '移除引用 已绑定文档' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu', { name: '添加内容' })).toBeNull()
})

it('M07-T07 a queued message can run now: it leaves the queue and is sent as an explicit stop-and-continue', async () => {
  const queued: ExecutionSubmissionRecord = { submissionId: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace', conversationId: 'c1', state: 'queued', mode: 'queue',
    text: '排队的修改', documents: [], attachments: [], permission: 'ask', model: { provider: 'fixture-provider', model: 'fixture-model', accountId: 'account', billing: 'metered' }, createdAt: 1, updatedAt: 1, position: 1 }
  const send = vi.fn<ExecutionDesktopAPI['send']>(async input => ({ submission: { ...queued, submissionId: input.submissionId, state: 'accepted', mode: 'adjust' }, conversation: structuredClone(conversation) }))
  const deleteSubmission = vi.fn<ExecutionDesktopAPI['deleteSubmission']>(async () => ({ ...queued, state: 'cancelled' }))
  render(<ExecutionAssistant root="C:/workspace" api={api([], { submissions: vi.fn(async () => [queued]), deleteSubmission, send })} settingsAPI={settingsAPI()}
    captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)
  fireEvent.click(await screen.findByRole('button', { name: '立即执行（先停止当前任务）' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(deleteSubmission).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'c1', submissionId: queued.submissionId })
  expect(send.mock.calls[0]![0]).toMatchObject({ text: '排队的修改', mode: 'adjust', permission: 'ask' })
})
