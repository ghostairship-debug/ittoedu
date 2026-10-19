// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionDelegationProjection } from '../../src/main/workbench/execution/ExecutionDelegationProjection'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'
import { executionActivity, pendingApproval, pendingQuestion } from '../../src/renderer/workbench/executionTimelineModel'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function run(runId: string, delegatedBy?: ExecutionRunRecord['delegatedBy']): ExecutionRunRecord {
  return { schemaVersion: 1, runId, version: 1, status: 'running', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0,
    requests: [], tools: [], ...(delegatedBy ? { delegatedBy } : {}), input: { conversationId: `${runId}-conversation`, taskId: `${runId}-task`,
      instruction: 'fixture', documents: [], selection: { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
        protocol: 'openai-chat', baseURL: 'https://fixture.invalid', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' },
        billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } } }
}
async function fixture(records: ExecutionRunRecord[]) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'delegation-projection-'))
  const events = new ExecutionEventStore({ directory }), runs = new Map(records.map(record => [record.runId, record]))
  const projection = new ExecutionDelegationProjection({ readRun: async runId => runs.get(runId) ?? null, append: event => events.append(event) })
  const unsubscribe = events.subscribe(event => projection.enqueue(event))
  const flush = async () => { await events.flushPending(); await projection.flush(); await events.flushPending() }
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  cleanups.push(async () => { await flush(); unsubscribe() })
  const append = async (runId: string, eventId: string, type: ExecutionEventInput['type'], itemId: string, data: ExecutionEventInput['data']) => {
    const owner = runs.get(runId)!
    return events.append({ conversationId: owner.input.conversationId, taskId: owner.input.taskId, runId, eventId, type, itemId,
      time: 10, source: 'builtin', update: 'snapshot', data })
  }
  return { directory, events, runs, projection, flush, append }
}

it('shows one original interaction through a nested owner chain without forwarding chats, usage or child terminal status', async () => {
  const h = await fixture([run('root'), run('child', { runId: 'root', jobId: 'root-job' }),
    run('grandchild', { runId: 'child', jobId: 'child-job' }), run('unrelated')])
  await h.append('root', 'root-active', 'run.state', 'run-state', { status: 'running', phase: 'generating' })
  await h.append('grandchild', 'private-text', 'text', 'reply', { status: 'completed', text: 'PRIVATE_CHAT' })
  await h.append('grandchild', 'private-usage', 'usage', 'tokens', { usage: { inputTokens: 123, outputTokens: 45 } })
  const source = await h.append('grandchild', 'question-open', 'tool', 'choice', { status: 'waiting', toolName: 'ask_user',
    question: { text: '选哪个场景？', multiple: false, options: [{ label: '甲' }, { label: '乙' }] } })
  await h.flush()
  const reference = { runId: 'grandchild', callId: 'choice', parentRunId: 'child', jobId: 'child-job' }
  for (const parent of ['root', 'child']) {
    const timeline = await h.events.snapshot(`${parent}-conversation`)
    expect(pendingQuestion(timeline)).toMatchObject({ runId: 'grandchild', callId: 'choice', delegation: reference })
    const item = timeline.items.find(item => item.data.delegationRef)!
    expect(item).toMatchObject({ runId: parent, taskId: `${parent}-task`, type: 'tool', data: { delegationRef: reference } })
    expect(JSON.stringify(timeline)).not.toContain('PRIVATE_CHAT')
    expect(timeline.items.some(item => item.type === 'usage')).toBe(false)
  }
  expect((await h.events.snapshot('unrelated-conversation')).items).toEqual([])
  const cursor = (await h.events.snapshot('root-conversation')).cursor
  h.projection.enqueue(source)
  await h.flush()
  expect((await h.events.snapshot('root-conversation')).cursor).toBe(cursor)
  await h.append('grandchild', 'question-answer', 'tool', 'choice', { status: 'answered', toolName: 'ask_user', answer: { choices: [1] } })
  await h.append('grandchild', 'child-end', 'run.end', 'run', { status: 'completed' })
  await h.flush()
  const parent = await h.events.snapshot('root-conversation')
  expect(pendingQuestion(parent)).toBeNull()
  expect(parent.items.find(item => item.data.delegationRef)?.data.answer).toEqual({ choices: [1] })
  expect(parent.items.some(item => item.type === 'run.end')).toBe(false)
  expect(executionActivity(parent)).toMatchObject({ activeRuns: 1, waitingRuns: 0, busy: true })
  const recovered = new ExecutionEventStore({ directory: h.directory })
  expect((await recovered.snapshot('root-conversation')).items).toEqual(parent.items)
})

it('closes an unanswered child approval and keeps a sibling with the same call ID independently addressable', async () => {
  const h = await fixture([run('root'), run('first', { runId: 'root', jobId: 'first-job' }), run('second', { runId: 'root', jobId: 'second-job' })])
  await h.append('root', 'root-active', 'run.state', 'run-state', { status: 'running', phase: 'tool' })
  for (const child of ['first', 'second']) await h.append(child, `${child}-approval`, 'tool', 'same-call-id', {
    status: 'approval', toolName: 'file.write', approval: { reason: 'outside-workspace', summary: '修改指定文件', documents: [child] },
  })
  await h.flush()
  expect(pendingApproval(await h.events.snapshot('root-conversation'))).toMatchObject({ runId: 'second', callId: 'same-call-id' })
  await h.append('second', 'second-ended', 'run.end', 'run', { status: 'stopped' })
  await h.flush()
  const timeline = await h.events.snapshot('root-conversation')
  expect(timeline.items.filter(item => item.data.delegationRef)).toHaveLength(2)
  expect(pendingApproval(timeline)).toMatchObject({ runId: 'first', callId: 'same-call-id', delegation: { jobId: 'first-job' } })
  expect(timeline.items.find(item => item.data.delegationRef?.runId === 'second')?.data).toMatchObject({ status: 'cancelled' })
  expect(timeline.items.find(item => item.data.delegationRef?.runId === 'second')?.data.decision).toBeUndefined()
  expect(executionActivity(timeline)).toMatchObject({ activeRuns: 1, busy: true })
  await h.append('first', 'first-approved', 'tool', 'same-call-id', { status: 'approved', decision: 'allow' })
  await h.flush()
  expect(pendingApproval(await h.events.snapshot('root-conversation'))).toBeNull()
})
