import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionDelegationChildDetail, ExecutionDelegationChildView } from '../../src/shared/workbench/delegation'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import { ExecutionDelegationChildren } from '../../src/renderer/workbench/ExecutionDelegationChildren'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'

afterEach(cleanup)

const view = (jobId: string, status = 'running'): ExecutionDelegationChildView => ({ parentRunId: 'parent', jobId,
  childRunId: `run-${jobId}`, goal: `制作${jobId}场景`, status, terminal: status !== 'running', stopped: false,
  target: { project: '演示', path: `pages/${jobId}`, region: { width: 480, height: 280, transform: [1, 0, 0, 1, 40, 60] } },
  artifacts: status === 'ready' ? [{ name: 'scene.html', byteLength: 64 }] : [],
})
const event = (jobId: string, sequence: number, type: ExecutionEvent['type'], data: ExecutionEvent['data']): ExecutionEvent => ({
  eventId: `event-${jobId}-${sequence}`, conversationId: `conversation-${jobId}`, taskId: `task-${jobId}`, runId: `run-${jobId}`,
  itemId: `${type}-${sequence}`, source: 'builtin', sequence, time: sequence, type, update: 'snapshot', data,
})
function detail(child: ExecutionDelegationChildView): ExecutionDelegationChildDetail {
  const projection = foldExecutionEvents(emptyExecutionProjection(`conversation-${child.jobId}`), [
    event(child.jobId, 1, 'text', { text: `子任务${child.jobId}的回复` }),
    event(child.jobId, 2, 'tool', { toolName: 'file.read', label: '读取素材', status: 'returned', output: '素材正文' }),
    event(child.jobId, 3, 'usage', { usage: { inputTokens: 12345, outputTokens: 67890 } }),
  ])
  const run: ExecutionRunRecord = { schemaVersion: 1, runId: child.childRunId!, version: 1, delegatedBy: { runId: child.parentRunId, jobId: child.jobId },
    input: { conversationId: projection.conversationId, taskId: `task-${child.jobId}`, instruction: child.goal, documents: [],
      selection: { model: 'fixture', connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'private' },
        billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } } },
    status: child.terminal ? 'completed' : 'running', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, requests: [], tools: [],
    steering: [{ submissionId: 'message-1', text: '补充：保持红色按钮', acceptedAt: 2 }],
  }
  return { view: structuredClone(child), run, projection }
}
function fixture(initial: ExecutionDelegationChildView[]) {
  const state = new Map(initial.map(child => [child.jobId, structuredClone(child)]))
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const api = {
    delegationChildren: vi.fn(async () => [...state.values()].map(child => structuredClone(child))),
    delegationChild: vi.fn(async ({ jobId }: { jobId: string }) => detail(state.get(jobId)!)),
    delegationStop: vi.fn(async ({ jobId }: { jobId: string }) => {
      const child = { ...state.get(jobId)!, status: 'cancelled', terminal: true, stopped: true }; state.set(jobId, child); return structuredClone(child)
    }),
    delegationMessage: vi.fn(async ({ jobId }: { jobId: string }) => structuredClone(state.get(jobId)!)),
    delegationResume: vi.fn(async () => { const child = view('continued'); state.set(child.jobId, child); return structuredClone(child) }),
    delegationArtifact: vi.fn(async ({ name }: { name: string }) => ({ name, byteLength: 64, text: '<script>window.candidateExecuted = true</script><h1>场景</h1>' })),
    blob: vi.fn(async () => '完整记录'),
    subscribe: vi.fn((listener: (event: ExecutionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
  } satisfies Partial<ExecutionDesktopAPI>
  return { api: api as unknown as ExecutionDesktopAPI, state, emit: (entry: ExecutionEvent) => listeners.forEach(listener => listener(entry)) }
}
const mount = (api: ExecutionDesktopAPI) => render(<ExecutionDelegationChildren api={api} workspaceId="workspace" conversationId="parent-conversation" />)
const identity = { workspaceId: 'workspace', conversationId: 'parent-conversation', parentRunId: 'parent', jobId: 'A' }

it('opens the original child records, frozen target and candidate source while keeping the parent list compact', async () => {
  const { api } = fixture([view('A', 'ready'), view('B')])
  mount(api)
  await screen.findByRole('button', { name: /制作A场景.*候选已就绪.*1 份候选/ })
  expect(screen.queryByRole('region', { name: '子任务详情' })).toBeNull()
  expect(api.delegationChild).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /制作A场景.*候选已就绪.*1 份候选/ }))
  const panel = await screen.findByRole('region', { name: '子任务详情' })
  await within(panel).findByText('子任务A的回复')
  expect(panel).toHaveTextContent('演示 / pages/A')
  expect(panel).toHaveTextContent('宽 480 × 高 280 · 位置 40, 60')
  expect(panel).toHaveTextContent('补充：保持红色按钮')
  const group = within(panel).getByRole('article', { name: '工具组' }).querySelector('details')!
  group.open = true; fireEvent(group, new Event('toggle'))
  await within(panel).findByText('读取素材')
  const tool = within(panel).getByRole('article', { name: '工具执行' }).querySelector('details')!
  tool.open = true; fireEvent(tool, new Event('toggle'))
  await within(panel).findByText('素材正文')
  expect(panel).not.toHaveTextContent('12345')
  expect(panel).not.toHaveTextContent('本次用量')
  fireEvent.click(within(panel).getByRole('button', { name: '查看候选：scene.html' }))
  const candidate = await within(panel).findByRole('region', { name: '候选内容' })
  expect(candidate).toHaveTextContent('<script>window.candidateExecuted = true</script>')
  expect(candidate.querySelector('script')).toBeNull()
  expect(api.delegationArtifact).toHaveBeenCalledWith({ ...identity, name: 'scene.html' })
})

it('sends and retries only the selected child, then stops only that child and explicitly continues its history', async () => {
  const { api } = fixture([view('A'), view('B')])
  vi.mocked(api.delegationMessage!).mockRejectedValueOnce(new Error('消息回执未确认'))
  mount(api)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  const composer = screen.getByRole('textbox', { name: '给子任务补充消息' })
  fireEvent.change(composer, { target: { value: '先完成关键互动' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给这个子任务' }))
  await screen.findByText('消息回执未确认')
  expect(composer).toHaveValue('先完成关键互动')
  fireEvent.click(screen.getByRole('button', { name: /制作B场景.*进行中/ }))
  await screen.findByText('子任务B的回复')
  fireEvent.click(screen.getByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  fireEvent.click(screen.getByRole('button', { name: '发送给这个子任务' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue(''))
  expect(api.delegationMessage).toHaveBeenCalledTimes(2)
  const messages = vi.mocked(api.delegationMessage!).mock.calls.map(([input]) => input)
  expect(messages[0]).toEqual({ ...identity, text: '先完成关键互动', submissionId: expect.any(String) })
  expect(messages[1]).toEqual(messages[0])
  fireEvent.click(screen.getByRole('button', { name: '停止这个子任务' }))
  await screen.findByRole('textbox', { name: '子任务续接要求' })
  expect(api.delegationStop).toHaveBeenCalledWith(identity)
  fireEvent.change(screen.getByRole('textbox', { name: '子任务续接要求' }), { target: { value: '沿当前成果修正按钮' } })
  fireEvent.click(screen.getByRole('button', { name: '继续这个子任务' }))
  await screen.findByText('子任务continued的回复')
  expect(api.delegationResume).toHaveBeenCalledWith({ ...identity, text: '沿当前成果修正按钮', submissionId: expect.any(String) })
  expect(screen.getByRole('button', { name: /制作B场景.*进行中/ })).toBeInTheDocument()
})

it('keeps child drafts and ignores a late detail read after a different child is selected', async () => {
  const { api } = fixture([view('A'), view('B')])
  mount(api)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  fireEvent.change(screen.getByRole('textbox', { name: '给子任务补充消息' }), { target: { value: 'A的未发消息' } })
  let resolve!: (value: ExecutionDelegationChildDetail) => void
  vi.mocked(api.delegationChild!).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: /制作B场景.*进行中/ }))
  await waitFor(() => expect(api.delegationChild).toHaveBeenCalledWith({ ...identity, jobId: 'B' }))
  fireEvent.click(screen.getByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  await act(async () => resolve(detail(view('B'))))
  expect(screen.queryByText('子任务B的回复')).toBeNull()
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue('A的未发消息')
})

it('folds a selected child live reply without refetching the full detail for every text event', async () => {
  const { api, emit } = fixture([view('A')])
  mount(api)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  const reads = vi.mocked(api.delegationChild!).mock.calls.length
  await act(async () => emit(event('A', 4, 'text', { text: '实时新增回复' })))
  expect(screen.getByText('实时新增回复')).toBeInTheDocument()
  expect(api.delegationChild).toHaveBeenCalledTimes(reads)
})

it('shows the host frozen current-object frame when no placement region was requested', async () => {
  const child = view('A')
  child.target = { project: '现稿', path: 'surface:main/object:focus' }
  child.frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 24, 36] }
  const { api } = fixture([child])
  mount(api)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  expect(screen.getByRole('region', { name: '子任务详情' })).toHaveTextContent('宽 320 × 高 180 · 位置 24, 36')
  expect(api.delegationMessage).not.toHaveBeenCalled()
  expect(api.delegationResume).not.toHaveBeenCalled()
})

it('keeps an in-flight child operation busy across panel switches and releases only its own draft', async () => {
  const { api } = fixture([view('A'), view('B')])
  let resolve!: (value: ExecutionDelegationChildView) => void
  vi.mocked(api.delegationMessage!).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  mount(api)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  fireEvent.change(screen.getByRole('textbox', { name: '给子任务补充消息' }), { target: { value: 'A的发送内容' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给这个子任务' }))
  fireEvent.click(screen.getByRole('button', { name: /制作B场景.*进行中/ }))
  await screen.findByText('子任务B的回复')
  fireEvent.change(screen.getByRole('textbox', { name: '给子任务补充消息' }), { target: { value: 'B的未发草稿' } })
  fireEvent.click(screen.getByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '发送给这个子任务' })).toBeDisabled()
  await act(async () => resolve(view('A')))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: /制作B场景.*进行中/ }))
  await screen.findByText('子任务B的回复')
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue('B的未发草稿')
})

it('hides usage from ordinary chat and its history search while retaining the provider records', async () => {
  const source = detail(view('A')).projection
  const usageEvent = event('A', 3, 'usage', { text: '合计 80235', usage: { totalTokens: 80235 } })
  const searchEvents = vi.fn(async () => ({ hits: [{ event: usageEvent, excerpt: '合计 80235' }], cursor: 3, hasMore: false }))
  render(<ExecutionTimeline projection={source} searchEvents={searchEvents} />)
  expect(screen.queryByText('本次用量')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
  fireEvent.change(screen.getByRole('textbox', { name: '历史关键词' }), { target: { value: '合计' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索全部历史' }))
  await screen.findByText('本页找到 0 条历史事件，已搜索到末尾。历史快照可能已被后续更新替换。')
  expect(screen.queryByText('合计 80235')).toBeNull()
  expect(source.items.some(item => item.type === 'usage')).toBe(true)
})

it('retains a child draft and unconfirmed submission identity after switching parent conversations', async () => {
  const { api } = fixture([view('A'), view('B')])
  const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/fixture', managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
  const conversations: ConversationRecord[] = ['A', 'B'].map(id => ({ conversationId: `parent-${id}`, workspaceId: 'workspace', title: `父会话 ${id}`,
    messages: [{ messageId: `user-${id}`, role: 'user', text: `父任务${id}`, createdAt: 1, attachmentIds: [] }], attachmentIds: [],
    runIndex: { builtinRunIds: ['parent'], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1 }))
  Object.assign(api, {
    workspace: vi.fn(async () => ({ workspace, conversations })), conversations: vi.fn(async () => conversations),
    conversation: vi.fn(async (_workspaceId: string, conversationId: string) => conversations.find(value => value.conversationId === conversationId) ?? null),
    submissions: vi.fn(async () => []), run: vi.fn(async () => null),
    timeline: vi.fn(async (conversationId: string) => emptyExecutionProjection(conversationId)),
    events: vi.fn(async (_conversationId: string, after = 0) => ({ events: [], cursor: after, hasMore: false })),
  })
  vi.mocked(api.delegationChildren!).mockImplementation(async ({ conversationId }) => [view(conversationId === 'parent-A' ? 'A' : 'B')])
  vi.mocked(api.delegationMessage!).mockRejectedValueOnce(new Error('消息回执未确认'))
  render(<ExecutionAssistant root="C:/fixture" api={api} captureDocuments={async () => []} prepareSend={async () => true} />)
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  fireEvent.change(screen.getByRole('textbox', { name: '给子任务补充消息' }), { target: { value: '父A子任务的未确认消息' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给这个子任务' }))
  await screen.findByText('消息回执未确认')
  fireEvent.click(screen.getByRole('button', { name: '父会话 B' }))
  fireEvent.click(await screen.findByRole('button', { name: /制作B场景.*进行中/ }))
  await screen.findByText('子任务B的回复')
  fireEvent.change(screen.getByRole('textbox', { name: '给子任务补充消息' }), { target: { value: '父B子任务的新草稿' } })
  fireEvent.click(screen.getByRole('button', { name: '父会话 A' }))
  fireEvent.click(await screen.findByRole('button', { name: /制作A场景.*进行中/ }))
  await screen.findByText('子任务A的回复')
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue('父A子任务的未确认消息')
  fireEvent.click(screen.getByRole('button', { name: '发送给这个子任务' }))
  await waitFor(() => expect(api.delegationMessage).toHaveBeenCalledTimes(2))
  const [first, second] = vi.mocked(api.delegationMessage!).mock.calls.map(([input]) => input)
  expect(second).toEqual(first)
  fireEvent.click(screen.getByRole('button', { name: '父会话 B' }))
  fireEvent.click(await screen.findByRole('button', { name: /制作B场景.*进行中/ }))
  await screen.findByText('子任务B的回复')
  expect(screen.getByRole('textbox', { name: '给子任务补充消息' })).toHaveValue('父B子任务的新草稿')
})
