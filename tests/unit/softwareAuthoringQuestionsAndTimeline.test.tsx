import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { currentExecutionStatus, executionTimelineEntries, toolGroupSummary } from '../../src/renderer/workbench/executionTimelineModel'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent, type ExecutionItem } from '../../src/shared/workbench/executionEvents'
import { advancementModeForAnswer, answerForModel, answerProblem, userQuestionInputSchema, userQuestionView, userQuestionViewSchema } from '../../src/shared/workbench/userQuestion'

afterEach(cleanup)
const item = (id: string, type: ExecutionItem['type'], time: number, data: ExecutionItem['data'] = {}): ExecutionItem => ({
  runId: 'r', taskId: 't', itemId: id, source: 'builtin', type, time, sequence: time, data, content: [],
})

it('accepts zero, one and several genuine options in input and rebuilt history, independently of response kind', () => {
  for (const responseKind of ['choice', 'free-text', 'confirm'] as const) for (const size of [0, 1, 3]) {
    const question = userQuestionViewSchema.parse(userQuestionView(userQuestionInputSchema.parse({ question: '怎么调整？', responseKind,
      options: Array.from({ length: size }, (_, index) => ({ label: `选择${index}` })) })))
    const answer = { choices: [], other: '请缩减到12页' }
    expect(answerProblem(question, answer)).toBeNull()
    expect(answerForModel(question, answer)).toMatchObject({ selected: [], other: '请缩减到12页' })
  }
})

it('remembers only an actual stable mode selection, keeping other ideas as their original text', () => {
  const question = userQuestionView(userQuestionInputSchema.parse({ question: '怎样推进？', purpose: 'advancement-mode',
    options: [{ label: '自动推进', value: 'automatic' }, { label: '逐步确认', value: 'stepwise' }] }))
  expect(advancementModeForAnswer(question, { choices: [1] })).toBe('stepwise')
  expect(advancementModeForAnswer(question, { choices: [], other: '先给我看当前稿' })).toBeUndefined()
  expect(answerForModel(question, { choices: [], other: '先给我看当前稿' })).toMatchObject({ selected: [], other: '先给我看当前稿' })
})

it('keeps streamed updates on their original side of a message and collapses tool receipts without double counting', () => {
  const base = { conversationId: 'c', runId: 'r', taskId: 't', source: 'builtin' as const }
  const events: ExecutionEvent[] = [
    { ...base, eventId: '1', itemId: 'read', type: 'tool', sequence: 1, time: 1, update: 'snapshot', data: { toolName: 'project.read', status: 'running' } },
    { ...base, eventId: '2', itemId: 'write', type: 'tool', sequence: 2, time: 2, update: 'snapshot', data: { applicationStatus: 'applied', status: 'completed' } },
    { ...base, eventId: '3', itemId: 'write:commit', type: 'document.commit', sequence: 3, time: 3, update: 'snapshot', data: { operationId: 'op', status: 'applied' } },
    { ...base, eventId: '4', itemId: 'read', type: 'tool', sequence: 4, time: 8, update: 'snapshot', data: { status: 'completed' } },
  ]
  const projection = foldExecutionEvents(emptyExecutionProjection('c'), events)
  const entries = executionTimelineEntries(projection, [{ messageId: 'm', role: 'user', text: '保留布局', createdAt: 4, attachmentIds: [] }])
  expect(entries.map(entry => entry.kind)).toEqual(['tools', 'message'])
  expect(entries[0].kind === 'tools' && toolGroupSummary(entries[0].items)).toBe('2 次工具调用 · 1 项修改')
  const { container } = render(<ExecutionTimeline projection={projection} />)
  expect(screen.getAllByRole('article', { name: '工具组' })).toHaveLength(1)
  expect(screen.queryByRole('article', { name: '工具执行' })).toBeNull()
  const group = container.querySelector<HTMLDetailsElement>('.execution-timeline__tool-group>details')!
  group.open = true; fireEvent(group, new Event('toggle'))
  expect(screen.getAllByRole('article', { name: '工具执行' })).toHaveLength(2)
})

it('does not merge across prose, user decisions, or a terminal error', () => {
  const projection = { conversationId: 'c', cursor: 7, items: [
    item('one', 'tool', 1), { ...item('prose', 'text', 2), content: [{ kind: 'text' as const, text: '当前稿已形成。' }] },
    item('two', 'tool', 3), item('question', 'tool', 4, { question: { text: '继续吗？', multiple: false, options: [{ label: '继续' }] }, status: 'waiting' }),
    item('usage', 'usage', 5), item('failure', 'tool', 6, { status: 'failed', error: '必须修正目标' }), item('end', 'run.end', 7, { status: 'partial' }),
  ] }
  expect(executionTimelineEntries(projection, []).map(entry => entry.kind)).toEqual(['tools', 'item', 'tools', 'item', 'tools', 'item', 'item'])
})

it('reads the current phase from all history and never turns a heartbeat into thinking or an ended run into working', () => {
  const projection = { conversationId: 'c', cursor: 1001, items: [
    item('state', 'run.state', 1001, { status: 'running', phase: 'waiting-response', lastReceivedAt: 10, receivedSource: 'heartbeat' }),
    ...Array.from({ length: 1000 }, (_, index) => item(`tool${index}`, 'tool', index + 1)),
  ] }
  expect(currentExecutionStatus(projection)).toBe('等待模型响应 · 最近收到服务心跳')
  const ended = { ...projection, cursor: 1002, items: [...projection.items, item('end', 'run.end', 1002, { status: 'completed' })] }
  expect(currentExecutionStatus(ended)).toBe('本轮已结束')
  const external = { ...ended, cursor: 1003, items: [...ended.items,
    { ...item('external', 'tool', 1003, { status: 'running', toolName: 'project.read' }), runId: 'external-run', source: 'external-mcp' as const }] }
  expect(currentExecutionStatus(external)).toBe('外部工具执行中 · project.read')
})
