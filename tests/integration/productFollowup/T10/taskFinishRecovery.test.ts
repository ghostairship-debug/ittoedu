// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { prepareExecutionContentOutput } from '../../../../src/core/tools/ToolTargets'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../../../src/main/workbench/execution/EditSessionService'
import type { ExecutionRunRecord, ExecutionStart } from '../../../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function reply(request: ModelRequest, tools: Array<{ name: string; input: unknown }>, content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = tools.map((tool, index) => ({ id: `${request.requestId}-${index}`, name: tool.name, argumentsText: JSON.stringify(tool.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'controlled', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function actual(request: ModelRequest, name: string) { expect(request.tools?.some(tool => tool.name === name), `Actual catalog: ${name}`).toBe(true); return name }

it.each([false, true])('recovering a finish-executing crash slice keeps the committed body once and preserves an additional unknown write: %s', async unknownWrite => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-finish-recovery-'))
  const host = new DocumentHostService(path.join(directory, 'documents')), project = createBlankCourseProjectV10('finish恢复')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData('原稿')).value }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body'] }]
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'finish.h5lesson')
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'] }
  const contentOutput = prepareExecutionContentOutput(initial, target)
  expect(contentOutput).toBeTruthy()
  const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  let finishCheckpoint: ExecutionRunRecord | undefined
  const persist = runs.save.bind(runs)
  runs.save = async record => {
    await persist(record)
    if (finishCheckpoint || !record.tools.some(tool => tool.call.name === 'task.finish' && tool.state === 'executing')) return
    // Observe the actual durable checkpoint while Engine is still awaiting save:
    // executeTool checkpoints executing BEFORE running finish or publishing its ACK.
    // The final checkpoint and publishEnd occur later, so their events cannot enter this prefix.
    finishCheckpoint = structuredClone(record)
    await events.flushPending()
    const prefix = await events.readPage({ conversationId: record.input.conversationId, limit: 5000 })
    expect(prefix.hasMore).toBe(false)
    expect(prefix.events.some(event => event.type === 'run.end')).toBe(false)
    expect(prefix.events.some(event => event.type === 'document.commit' && event.data.status === 'applied')).toBe(true)
    await fs.cp(path.join(directory, 'events'), path.join(directory, 'crash-events'), { recursive: true })
  }
  let phase: 'write' | 'continue' = 'write', continuedRequests = 0, attemptedWrites = 0
  const provider: ModelProvider = { async *stream(request) {
    if (phase === 'write') {
      attemptedWrites++
      yield reply(request, [{ name: actual(request, 'text.replace'), input: { content: '已正式提交的修订正文' } }, { name: actual(request, 'task.finish'), input: {} }]); return
    }
    if (++continuedRequests === 1) { yield reply(request, [{ name: actual(request, 'task.finish'), input: {} }]); return }
    yield reply(request, [], '先查明旧写入的结果，正文不重放。')
  } }
  const createEngine = (owner = host, runStore = runs, eventStore = events) => new ExecutionEngine({ registry: owner.registry, gateway: owner.tools, provider, files: owner.agentFiles, runs: runStore, events: eventStore,
    edits: new EditSessionService(owner.registry, owner.tools) })
  const engine = createEngine()
  const input: ExecutionStart = { conversationId: 'finish-crash', taskId: 'rewrite', instruction: '改写所选正文，然后明确结束任务。', selection,
    documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput!, workspaceRoot: directory, permission: 'workspace' }
  let fresh: ExecutionEngine | undefined, resumedId: string | undefined
  try {
    const started = await engine.start(input), completed = await engine.wait(started.runId)
    expect(completed.status, JSON.stringify({ failure: completed.failure, tools: completed.tools })).toBe('completed')
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1 })
    expect(finishCheckpoint, 'Actual finish-executing persistence boundary must have been observed').toBeTruthy()
    const crash = structuredClone(finishCheckpoint!)
    expect(crash.status).toBe('running')
    const finish = crash.tools.find(tool => tool.call.name === 'task.finish')!
    expect(finish).toMatchObject({ state: 'executing' })
    expect(finish.result).toBeUndefined()
    expect(crash.messages.some(message => message.role === 'tool' && message.tool_call_id === finish.providerCallId)).toBe(false)
    if (unknownWrite) {
      crash.tools.splice(crash.tools.indexOf(finish), 0, { callId: 'unknown-second-body', providerCallId: 'unknown-second-body', requestId: crash.requests[0].requestId,
        state: 'executing', call: { name: 'text.replace', input: { content: '结果未知的另一次写入' } }, effectTargets: structuredClone(crash.tools[0].effectTargets) })
      const assistant = crash.messages.find(message => message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.some(call => call !== null && typeof call === 'object' && !Array.isArray(call) && call.id === finish.providerCallId))
      if (!assistant || assistant.role !== 'assistant' || !Array.isArray(assistant.tool_calls)) throw new Error('Actual paired tool-call response required')
      assistant.tool_calls.splice(assistant.tool_calls.findIndex(call => call !== null && typeof call === 'object' && !Array.isArray(call) && call.id === finish.providerCallId), 0,
        { id: 'unknown-second-body', type: 'function', function: { name: 'text.replace', arguments: JSON.stringify({ content: '结果未知的另一次写入' }) } })
    }
    // The positive crash slice and event prefix are captured from the real checkpoint, not rewound from a terminal run.
    // The optional unknown invocation is a negative recovery input: no success/receipt is manufactured for it.
    // This is a persistence-boundary test, not a power-loss hardware test.
    await new ExecutionRunStore(path.join(directory, 'crash-runs')).save(crash)
    // A cold owner restores the formal Session, History and receipts from the durable journal.
    // Reusing the old Gateway would retain the old run registration and is not a restart.
    const freshHost = new DocumentHostService(path.join(directory, 'documents'))
    const restored = await freshHost.internalAPI.restore(initial.documentId)
    expect(restored.epoch).not.toBe(initial.epoch)
    expect(restored).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '已正式提交的修订正文' }] } } } } } } })
    const freshRuns = new ExecutionRunStore(path.join(directory, 'crash-runs'))
    const freshEvents = new ExecutionEventStore({ directory: path.join(directory, 'crash-events') })
    expect(await freshEvents.findEvent(input.conversationId, `${crash.runId}:terminal`)).toBeNull()
    fresh = createEngine(freshHost, freshRuns, freshEvents)
    await fresh.recover(crash.runId)
    expect(attemptedWrites).toBe(1)
    expect(await freshHost.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1 })
    const recovered = (await freshRuns.read(crash.runId))!
    const recoveredFinish = recovered.tools.find(tool => tool.call.name === 'task.finish')?.result
    expect(recoveredFinish?.kind === 'error' && recoveredFinish.code === 'tool-outcome-unknown').toBe(false)
    phase = 'continue'
    const resumed = await fresh.resume(crash.runId, input); resumedId = resumed.runId
    const ended = await fresh.wait(resumed.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe(unknownWrite ? 'partial' : 'completed')
    expect(ended.tools.some(tool => tool.call.name === 'text.replace')).toBe(false)
    if (unknownWrite) expect(ended.tools.find(tool => tool.call.name === 'task.finish')?.result).toMatchObject({ kind: 'error' })
    expect(attemptedWrites).toBe(1)
    expect(await freshHost.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '已正式提交的修订正文' }] } } } } } } })
  } finally {
    if (fresh && resumedId) { await fresh.stop(resumedId); await fresh.wait(resumedId) }
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
