import { expect, it } from 'vitest'
import { applyExecutionProjectionOwned, emptyExecutionProjection, prepareExecutionEvents, type ExecutionEvent, type ExecutionItem } from '../../src/shared/workbench/executionEvents'
import { ExecutionTimelineReadModel, currentExecutionStatus, executionActivity, toolGroupSummary } from '../../src/shared/workbench/executionTimelineReadModel'

const item = (data: ExecutionItem['data']): ExecutionItem => ({ runId: 'run', taskId: 'task', itemId: 'delegate', source: 'builtin', type: 'tool', time: 1, sequence: 1, data, content: [] })
const receipt = { toolName: 'delegate.agent', label: '执行操作', status: 'pending', output: '{"kind":"read","data":{"status":"running","jobId":"child"}}' }

it('does not show a returned asynchronous receipt as a still-executing call, without declaring the job completed', () => {
  const call = item(receipt)
  expect(toolGroupSummary([call])).toBe('1 次工具调用')
  expect(call.data.status).toBe('pending')
  const state: ExecutionItem = { ...call, itemId: 'state', type: 'run.state', data: { status: 'running', phase: 'waiting-response' } }
  const projection = { conversationId: 'conversation', cursor: 2, items: [state, call] }
  expect(currentExecutionStatus(projection)).toBe('等待模型响应')
  expect(executionActivity(projection).busy).toBe(true)
  const external = { ...projection, items: [{ ...call, source: 'external-mcp' as const }] }
  expect(executionActivity(external)).toMatchObject({ busy: false, externalTools: 0 })
  for (const status of ['running', 'executing', 'pending', 'queued']) expect(toolGroupSummary([item({ status, label: '执行操作' })])).toContain('正在执行操作')
  expect(toolGroupSummary([item({ ...receipt, status: 'running' })])).toContain('正在执行操作')
  const unknown = item({ status: 'unknown', output: receipt.output })
  expect(toolGroupSummary([unknown])).not.toContain('正在')
  expect(unknown.data.status).toBe('unknown')
})

it('updates the cached group when the pending receipt arrives inline or by blob, and preserves active calls', () => {
  for (const output of [{ output: receipt.output }, { outputRef: { id: 'a'.repeat(64), bytes: 30, mime: 'text/plain;charset=utf-8' as const } }]) {
    const projection = emptyExecutionProjection('conversation'), reader = new ExecutionTimelineReadModel(projection)
    const base = { conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'delegate', source: 'builtin' as const, type: 'tool' as const, update: 'append' as const }
    const apply = (event: ExecutionEvent) => { const plan = prepareExecutionEvents(projection, [event]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan) }
    apply({ ...base, eventId: 'start', sequence: 1, time: 1, data: { status: 'pending', label: '执行操作' } })
    const group = reader.entryPage().entries.find(entry => entry.kind === 'tools')!
    expect(group.kind === 'tools' && group.summary).toContain('正在执行操作')
    apply({ ...base, eventId: 'receipt', sequence: 2, time: 2, data: { status: 'pending', ...output } })
    const returned = reader.entryPage().entries.find(entry => entry.kind === 'tools')!
    expect(returned.kind === 'tools' && returned.summary).toBe('1 次工具调用')
    expect(projection.items[0]!.data.status).toBe('pending')
    apply({ ...base, itemId: 'later', eventId: 'later-start', sequence: 3, time: 3, data: { status: 'running', label: '读取结果' } })
    const active = reader.entryPage().entries.find(entry => entry.kind === 'tools')!
    expect(active.kind === 'tools' && active.summary).toBe('2 次工具调用 · 正在读取结果')
  }
})
