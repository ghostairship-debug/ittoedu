// @vitest-environment node
// Settlement proof: the compute owner and its durable job receipts are real;
// the backend execution result is controlled, not a Python/runtime acceptance.
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { ComputeJobService } from '../../../../src/main/workbench/compute/ComputeJobService'
import { HostJobService } from '../../../../src/main/workbench/jobs/HostJobService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { prepareExecutionContentOutput } from '../../../../src/core/tools/ToolTargets'
import type { ComputeBackend, ComputeProcessResult } from '../../../../src/main/workbench/compute/ComputeBackend'
import type { ImageGenerationService } from '../../../../src/main/workbench/images/ImageGenerationService'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function reply(request: ModelRequest, tools: Array<{ name: string; input: unknown }>, content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  for (const tool of tools) expect(request.tools?.some(value => value.name === tool.name), `Actual default catalog: ${tool.name}`).toBe(true)
  const calls = tools.map((tool, index) => ({ id: `${request.requestId}-${index}`, name: tool.name, argumentsText: JSON.stringify(tool.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'controlled', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function lastReceipt(request: ModelRequest): any {
  const message = request.messages.filter(value => value.role === 'tool').at(-1)
  if (!message || typeof message.content !== 'string') throw new Error('A real tool receipt must reach the provider')
  return JSON.parse(message.content)
}
function namedReceipt(request: ModelRequest, name: string): any {
  const call = request.messages.filter(value => value.role === 'assistant').flatMap(value =>
    value.role === 'assistant' ? value.tool_calls ?? [] : []).filter(value => value.function.name === name).at(-1)
  const message = request.messages.find(value => value.role === 'tool' && value.tool_call_id === call?.id)
  if (!message || typeof message.content !== 'string') throw new Error(`Real paired receipt required: ${name}`)
  return JSON.parse(message.content)
}

async function journey(pending: boolean) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-terminal-job-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('任务结束与失败计算')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('原稿') }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body'] }]
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'finish.h5lesson')
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'] }
  const contentOutput = prepareExecutionContentOutput(initial, target)
  expect(contentOutput).toBeTruthy()
  let backendStarts = 0, resolveProcess!: (value: ComputeProcessResult) => void
  const processResult = new Promise<ComputeProcessResult>(resolve => { resolveProcess = resolve })
  const failed: ComputeProcessResult = { exitCode: 3, stdout: '', stderr: 'diagnostic computation exited 3', truncated: false, cancelled: false, outputs: [] }
  const backend: ComputeBackend = { kind: 'pyodide', async availability() { return { available: true } }, async start() {
    backendStarts++
    if (!pending) resolveProcess(failed)
    return { done: processResult, async cancel() {
      resolveProcess({ ...failed, exitCode: null, cancelled: true }); return true
    } }
  } }
  const compute = new ComputeJobService({ directory: path.join(directory, 'compute'), backend })
  const jobs = new HostJobService({ compute, images: {} as ImageGenerationService })
  host.tools.configureHostServices({ compute, jobs })
  let requests = 0, job = ''
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (requests === 1) {
      yield reply(request, [{ name: 'text.replace', input: { content: '已提交正文保留，计算未成功。' } }]); return
    }
    if (requests === 2) {
      expect(lastReceipt(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      yield reply(request, [{ name: 'compute.run', input: { code: 'raise SystemExit(3)', outputNames: [] } }]); return
    }
    if (requests === 3) {
      const receipt = lastReceipt(request)
      expect(receipt.kind).toBe('read'); job = receipt.data.job; expect(job).toBeTruthy()
      // A finish sent alongside wait cannot acknowledge its yet-undelivered
      // failure. The provider must first receive the real failed job receipt.
      yield reply(request, [{ name: 'job.wait', input: { kind: 'compute', job, milliseconds: pending ? 1 : 1000 } },
        { name: 'task.finish', input: {} }]); return
    }
    if (requests === 4) {
      expect(lastReceipt(request)).toMatchObject({ kind: 'error', code: 'task-unfinished' })
      const receipt = namedReceipt(request, 'job.wait')
      expect(receipt).toMatchObject({ kind: 'read', data: { kind: 'compute', jobId: job,
        terminal: !pending } })
      if (pending) expect(receipt.data.status).toMatch(/^(preparing|running)$/)
      else expect(receipt.data).toMatchObject({ status: 'failed', snapshot: { exitCode: 3, artifacts: [] } })
      if (pending) yield reply(request, [], '计算仍在运行，不能宣称已结束。')
      else yield reply(request, [{ name: 'job.status', input: { kind: 'compute', job } }, { name: 'task.finish', input: {} }])
      return
    }
    throw new Error('A terminal failed job must not trigger another provider request after explicit finish')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  try {
    const started = await engine.start({ conversationId: 'terminal-job', taskId: 'diagnostic', selection,
      instruction: '修改正文；计算诊断若失败，保留修改并如实结束。', workspaceRoot: directory, permission: 'workspace',
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput! })
    const ended = await engine.wait(started.runId)
    const finishes = ended.tools.filter(tool => tool.call.name === 'task.finish')
    const finish = finishes.at(-1)!
    const waited = ended.tools.find(tool => tool.call.name === 'job.wait')!
    expect(waited.call.input).toMatchObject({ job })
    expect(ended.status, JSON.stringify({ failure: ended.failure, finish: finish?.result })).toBe('partial')
    expect(finishes[0].result).toMatchObject({ kind: 'error', code: 'task-unfinished', data: {
      remaining: expect.arrayContaining([expect.objectContaining({ status: pending ? 'pending' : 'failed', job, kind: 'compute' })]) } })
    if (pending) expect(finish.result).toMatchObject({ kind: 'error', code: 'task-unfinished', data: {
      remaining: expect.arrayContaining([expect.objectContaining({ status: 'pending', job, kind: 'compute' })]) } })
    else {
      expect(finish.result).toMatchObject({ kind: 'read', data: { status: 'partial',
        remaining: expect.arrayContaining([expect.objectContaining({ status: 'failed', job, kind: 'compute' })]) } })
    }
    expect(requests).toBe(4)
    expect(backendStarts).toBe(1)
    const current = await host.internalAPI.read(initial.documentId)
    expect(current).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: {
      data: { content: { inlines: [{ type: 'text', text: '已提交正文保留，计算未成功。' }] } } }, } } } })
    expect(ended.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  } finally {
    resolveProcess({ ...failed, exitCode: null, cancelled: true })
    await engine.shutdown()
    expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true)
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
}
it('rejects finish beside a new failed wait, then ends truthfully partial once its real receipt reaches the provider without replay or a fifth request', () => journey(false))
it('still refuses finish while the actual compute owner has a running job', () => journey(true))
