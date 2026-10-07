// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { prepareExecutionContentOutput } from '../../../../src/core/tools/ToolTargets'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../../../src/main/workbench/execution/EditSessionService'
import type { ExecutionStart } from '../../../../src/shared/workbench/execution'
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
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('原稿') }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body'] }]; project.global = { underlay: [], overlay: [] }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'finish.h5lesson')
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'] }
  const contentOutput = prepareExecutionContentOutput(initial, target)
  expect(contentOutput).toBeTruthy()
  const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  let phase: 'write' | 'continue' = 'write', continuedRequests = 0, attemptedWrites = 0
  const provider: ModelProvider = { async *stream(request) {
    if (phase === 'write') {
      attemptedWrites++
      yield reply(request, [{ name: actual(request, 'text.replace'), input: { content: '已正式提交的修订正文' } }, { name: actual(request, 'task.finish'), input: {} }]); return
    }
    if (++continuedRequests === 1) { yield reply(request, [{ name: actual(request, 'task.finish'), input: {} }]); return }
    yield reply(request, [], '先查明旧写入的结果，正文不重放。')
  } }
  const createEngine = () => new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles, runs, events,
    edits: new EditSessionService(host.registry, host.tools) })
  const engine = createEngine()
  const input: ExecutionStart = { conversationId: 'finish-crash', taskId: 'rewrite', instruction: '改写所选正文，然后明确结束任务。', selection,
    documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput!, workspaceRoot: directory, permission: 'workspace' }
  let fresh: ExecutionEngine | undefined, resumedId: string | undefined
  try {
    const started = await engine.start(input), completed = await engine.wait(started.runId)
    expect(completed.status, JSON.stringify({ failure: completed.failure, tools: completed.tools })).toBe('completed')
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1 })
    const crash = structuredClone(completed)
    crash.status = 'running'; delete crash.failure
    const finish = crash.tools.find(tool => tool.call.name === 'task.finish')!
    finish.state = 'executing'; delete finish.result; delete finish.receiptTime
    crash.messages = crash.messages.filter(message => !(message.role === 'tool' && message.tool_call_id === finish.providerCallId))
    if (unknownWrite) {
      crash.tools.splice(crash.tools.indexOf(finish), 0, { callId: 'unknown-second-body', providerCallId: 'unknown-second-body', requestId: crash.requests[0].requestId,
        state: 'executing', call: { name: 'text.replace', input: { content: '结果未知的另一次写入' } }, effectTargets: structuredClone(crash.tools[0].effectTargets) })
      const assistant = crash.messages.find(message => message.role === 'assistant' && message.tool_calls?.some(call => call.id === finish.providerCallId))
      if (!assistant || assistant.role !== 'assistant' || !assistant.tool_calls) throw new Error('Actual paired tool-call response required')
      assistant.tool_calls.splice(assistant.tool_calls.findIndex(call => call.id === finish.providerCallId), 0,
        { id: 'unknown-second-body', type: 'function', function: { name: 'text.replace', arguments: JSON.stringify({ content: '结果未知的另一次写入' }) } })
    }
    // Legal persisted crash slice: the actual writer receipt exists; finish has no business effect and no returned ACK.
    // The optional second executing write has no receipt, so its outcome must remain unknown. This is not a power-loss hardware test.
    await runs.save(crash)
    fresh = createEngine()
    await fresh.recover(crash.runId)
    expect(attemptedWrites).toBe(1)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1 })
    const recovered = (await runs.read(crash.runId))!
    const recoveredFinish = recovered.tools.find(tool => tool.call.name === 'task.finish')?.result
    expect(recoveredFinish?.kind === 'error' && recoveredFinish.code === 'tool-outcome-unknown').toBe(false)
    phase = 'continue'
    const resumed = await fresh.resume(crash.runId, input); resumedId = resumed.runId
    const ended = await fresh.wait(resumed.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe(unknownWrite ? 'partial' : 'completed')
    expect(ended.tools.some(tool => tool.call.name === 'text.replace')).toBe(false)
    if (unknownWrite) expect(ended.tools.find(tool => tool.call.name === 'task.finish')?.result).toMatchObject({ kind: 'error' })
    expect(attemptedWrites).toBe(1)
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '已正式提交的修订正文' }] } } } } } } })
  } finally {
    if (fresh && resumedId) { await fresh.stop(resumedId); await fresh.wait(resumedId) }
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
