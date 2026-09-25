import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { executionActivity, pendingQuestion } from '../../src/renderer/workbench/executionTimelineModel'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import { USER_QUESTION_TOOL, type UserQuestionView } from '../../src/shared/workbench/userQuestion'

// M09-T04: the AI's question pops up as an option card; one click answers it.
afterEach(() => { cleanup(); localStorage.clear() })
const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false, authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const conversation: ConversationRecord = { conversationId: 'c1', workspaceId: 'workspace', title: '课堂讨论', messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1 }
const single: UserQuestionView = { text: '这一段改成哪种写法？', multiple: false, options: [{ label: '简洁版' }, { label: '详细版', description: '保留例子' }] }
const base = { conversationId: 'c1', taskId: 'task', runId: 'run', time: 1, source: 'builtin' as const }
function events(question: UserQuestionView, extra: ExecutionEvent[] = []): ExecutionEvent[] {
  return [
    { ...base, eventId: 'e1', itemId: 'run-state', sequence: 1, type: 'run.state', update: 'snapshot', data: { status: 'waiting', label: '等待你的选择' } },
    { ...base, eventId: 'e2', itemId: 'request:0', sequence: 2, type: 'tool', update: 'snapshot', data: { toolName: USER_QUESTION_TOOL, label: '向你提问', status: 'waiting', question, text: question.text } },
    ...extra,
  ]
}
const settingsAPI = (): ExecutionSettingsAPI => ({
  read: vi.fn(async () => ({ secureStorageAvailable: true, connections: [], profile: { revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
    roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } } })),
  probeCapabilities: vi.fn(async () => { throw new Error('unused') }), saveConnection: vi.fn(async () => { throw new Error('unused') }),
  saveProfile: vi.fn(async () => { throw new Error('unused') }), revokeConnection: vi.fn(async () => {}),
  discoverModels: vi.fn(async () => ({ connectionId: 'c', connectionRevision: 1, models: [], capabilitiesVerified: false as const, source: 'live' as const, checkedAt: '2026-09-25T00:00:00.000Z' })),
  startOAuthLogin: vi.fn(async () => ({ loginId: 'l', status: 'pending' as const })), oauthLoginStatus: vi.fn(async () => ({ loginId: 'l', status: 'pending' as const })),
  cancelOAuthLogin: vi.fn(async () => {}),
})
function api(timeline: ExecutionEvent[], answer?: ExecutionDesktopAPI['answer'], gate: Promise<void> = Promise.resolve()) {
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const value: ExecutionDesktopAPI = {
    workspace: vi.fn(async () => ({ workspace, conversations: [structuredClone(conversation)] })), conversations: vi.fn(async () => [structuredClone(conversation)]),
    createConversation: vi.fn(async () => structuredClone(conversation)), conversation: vi.fn(async () => structuredClone(conversation)),
    draft: vi.fn(async () => structuredClone(conversation)), renameConversation: vi.fn(async () => structuredClone(conversation)), deleteConversation: vi.fn(async () => {}),
    send: vi.fn(async () => { throw new Error('unused') }), submission: vi.fn(async () => null), submissions: vi.fn(async () => []),
    deleteSubmission: vi.fn(async () => { throw new Error('unused') }), pauseQueue: vi.fn(async () => {}), resumeQueue: vi.fn(async () => {}),
    run: vi.fn(async () => null), stop: vi.fn(async () => null),
    events: vi.fn(async (_id, after = 0) => ({ events: [], cursor: after, hasMore: false })), searchEvents: vi.fn(async () => ({ hits: [], cursor: 0, hasMore: false })),
    timeline: vi.fn(async id => { await gate; return foldExecutionEvents(emptyExecutionProjection(id), timeline) }), blob: vi.fn(async () => ''), edits: vi.fn(async () => []),
    subscribe: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener) }), subscribeEdits: vi.fn(() => () => {}),
    ...(answer ? { answer } : {}),
  }
  return value
}
const mount = (value: ExecutionDesktopAPI) => render(<ExecutionAssistant root="C:/workspace" api={value} settingsAPI={settingsAPI()}
  captureDocuments={vi.fn(async () => [])} prepareSend={vi.fn(async () => true)} />)

it('pops up clickable options for the open question and answers with one click without taking focus', async () => {
  const answer = vi.fn<NonNullable<ExecutionDesktopAPI['answer']>>(async () => ({ runId: 'run' }) as Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['answer']>>>)
  let release!: () => void
  mount(api(events(single), answer, new Promise<void>(resolve => { release = resolve })))
  // The composer remounts once the conversation is selected; take the live, enabled one.
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toBeEnabled())
  const composer = screen.getByRole('textbox', { name: '给创作助手发消息' })
  composer.focus()
  expect(screen.queryByRole('region', { name: 'AI 的提问' })).toBeNull()
  release() // The question arrives while the teacher is typing.
  const card = await screen.findByRole('region', { name: 'AI 的提问' })
  expect(card).toHaveTextContent('这一段改成哪种写法？')
  const options = within(within(card).getByRole('group', { name: '可选答案' })).getAllByRole('button')
  expect(options.map(button => button.textContent)).toEqual(['简洁版', '详细版保留例子'])
  expect(document.activeElement).toBe(composer)
  // The timeline keeps a read-only record; only the card answers.
  const record = screen.getByRole('article', { name: 'AI 提问' })
  expect(record).toHaveTextContent('等待你选择')
  expect(within(record).queryByRole('button')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('1 个任务等待你的选择')
  fireEvent.click(options[1]!)
  await waitFor(() => expect(answer).toHaveBeenCalledWith({ runId: 'run', callId: 'request:0', answer: { choices: [1] } }))
  await screen.findByText('已提交回答，任务继续中…')
  for (const button of within(card).getAllByRole('button')) expect(button).toBeDisabled()
})

it('answers with free text, supports multiple choice, and keeps the card open with the reason when Main refuses', async () => {
  const answer = vi.fn<NonNullable<ExecutionDesktopAPI['answer']>>()
    .mockRejectedValueOnce(new Error('回答没有提交：任务已停止或已结束，这个问题不能再回答。'))
    .mockResolvedValue({ runId: 'run' } as Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['answer']>>>)
  const multiple: UserQuestionView = { text: '再加哪些？', multiple: true, options: [{ label: '图示' }, { label: '练习' }, { label: '小结' }] }
  mount(api(events(multiple), answer))
  const card = await screen.findByRole('region', { name: 'AI 的提问' })
  const submit = within(card).getByRole('button', { name: '提交选择' })
  expect(submit).toBeDisabled()
  fireEvent.click(within(card).getByRole('button', { name: '小结' }))
  fireEvent.click(within(card).getByRole('button', { name: '图示' }))
  expect(within(card).getByRole('button', { name: '图示' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(within(card).getByRole('textbox', { name: '其他（自己填写）' }), { target: { value: ' 每项一句话 ' } })
  fireEvent.click(submit)
  await within(card).findByRole('alert')
  expect(within(card).getByRole('alert')).toHaveTextContent('这个问题不能再回答')
  expect(within(card).getByRole('button', { name: '小结' })).toBeEnabled()
  fireEvent.click(submit)
  await waitFor(() => expect(answer).toHaveBeenLastCalledWith({ runId: 'run', callId: 'request:0', answer: { choices: [0, 2], other: '每项一句话' } }))
})

it('shows no option card once the run has ended, and the record states the question went unanswered', async () => {
  const ended = events(single, [{ ...base, eventId: 'e3', itemId: 'run', sequence: 3, type: 'run.end', update: 'snapshot', data: { status: 'interrupted', label: '上次运行已中断' } }])
  const projection = foldExecutionEvents(emptyExecutionProjection('c1'), ended)
  expect(pendingQuestion(projection)).toBeNull()
  expect(executionActivity(projection)).toMatchObject({ busy: false, waitingRuns: 0 })
  mount(api(ended, vi.fn()))
  expect(await screen.findByRole('article', { name: 'AI 提问' })).toHaveTextContent('任务已结束，未回答')
  expect(screen.queryByRole('region', { name: 'AI 的提问' })).toBeNull()
})

it('keeps the answered choice visible in the timeline record', () => {
  const answered = events(single, [{ ...base, eventId: 'e3', itemId: 'request:0', sequence: 3, type: 'tool', update: 'snapshot',
    data: { toolName: USER_QUESTION_TOOL, label: '向你提问', status: 'answered', answer: { choices: [0], other: '只改第一句' }, text: single.text } }])
  const projection = foldExecutionEvents(emptyExecutionProjection('c1'), answered)
  expect(pendingQuestion(projection)).toBeNull()
  render(<ExecutionTimeline projection={projection} />)
  const record = screen.getByRole('article', { name: 'AI 提问' })
  expect(record).toHaveTextContent('已回答')
  expect(within(record).getByText(/简洁版/).closest('li')).toHaveAttribute('data-chosen', 'true')
  expect(record).toHaveTextContent('你的补充：只改第一句')
})

it('never turns an external MCP event into a question card or an answerable record', () => {
  const external = events(single).map(event => ({ ...event, source: 'external-mcp' as const }))
  const projection = foldExecutionEvents(emptyExecutionProjection('c1'), external)
  expect(pendingQuestion(projection)).toBeNull()
  render(<ExecutionTimeline projection={projection} />)
  expect(screen.queryByRole('article', { name: 'AI 提问' })).toBeNull()
  expect(screen.getByRole('article', { name: '工具执行' })).toHaveTextContent('外部 MCP · 仅显示实际工具事实')
})
