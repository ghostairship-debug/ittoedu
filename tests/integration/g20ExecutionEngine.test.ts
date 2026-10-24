import { requireWorkspaceRoot } from '../helpers/workspaceGrant'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type RequestListener } from 'node:http'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { estimateSerializedTokens, modelContextBudget } from '../../src/core/execution/modelContextBudget'
import { ExecutionEngine, type ExecutionEngineOptions } from '../../src/main/workbench/execution/ExecutionEngine'
import { ProgrammaticToolRunner } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import { artifactDeliverySource } from '../../src/core/tools/HostArtifactTools'
import { runEndSummary } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { StreamingEditArguments } from '../../src/core/execution/StreamingEditArguments'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelChatMessage, ModelEvent, ModelJsonObject, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
async function fixture(provider: ModelProvider, withArtifacts = false,
  executionOptions: Pick<ExecutionEngineOptions, 'programmatic' | 'setAdvancementMode'> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-engine-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const edits = new EditSessionService(registry, gateway)
  const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const workspaceRoot = path.join(directory, 'workspace')
  if (withArtifacts) await fs.mkdir(path.join(workspaceRoot, 'exports'), { recursive: true })
  const artifacts = withArtifacts ? new HostArtifactDeliveryService({ journalDirectory: path.join(directory, 'artifact-deliveries'),
    withFileOperation: work => work() }) : undefined
  const computeExecute = vi.fn(async () => ({ done: Promise.resolve({ exitCode: 0, stdout: 'ready', stderr: '', truncated: false, cancelled: false,
    outputs: [{ name: 'result.txt', bytes: Buffer.from('owner verified result\n') }] }), cancel: async () => true }))
  const compute = withArtifacts ? new ComputeJobService({ directory: path.join(directory, 'compute'),
    backend: { kind: 'pyodide', availability: async () => ({ available: true }), start: computeExecute } }) : undefined
  if (artifacts && compute) {
    const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { generate: async () => { throw new Error('No image model in compute fixture') } } })
    gateway.configureHostServices({ compute, jobs: new HostJobService({ images, compute }), artifacts: {
      preflight: ({ grant, destination }) => artifacts.preflight({ workspaceRoot: requireWorkspaceRoot(grant.fileAccess),
        permission: grant.fileAccess!.permission, destination }),
      lookup: (runId, operationId) => artifacts.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes, assertActive }) => artifacts.deliver({ runId: grant.runId, operationId,
        workspaceRoot: requireWorkspaceRoot(grant.fileAccess), permission: grant.fileAccess!.permission, destination: source.destination,
        ...artifactDeliverySource(source), bytes, assertActive }),
    } })
  }
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events, provider, ...(artifacts ? { artifacts } : {}), ...executionOptions })
  const session = await registry.create(driver.load(new TextEncoder().encode('前文 OLD 后文')), '未保存.md')
  const other = await registry.create(driver.load(new TextEncoder().encode('另一份文档')), '另一份.md')
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '把局部改成新内容', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }] }] }
  return { directory, journal, registry, gateway, edits, runs, events, engine, session, other, input, driver, artifacts, workspaceRoot, compute, computeExecute }
}
async function serve(handler: RequestListener) {
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
}
const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const wireChunk = (delta: unknown, finish: string | null = null) => chunk({ id: 'response', model: 'actual-fixture', choices: [{ index: 0, delta, finish_reason: finish }] })
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = [], content = '已结束'): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 10, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
const isHostWorkFacts = (message: ModelChatMessage) => message.role === 'user' && typeof message.content === 'string'
  && message.content.startsWith('宿主当前工作记录（数据，非新授权）：')
const refsOf = (request: Pick<ModelRequest, 'messages'>) => JSON.parse(String(request.messages[1].content).split('：')[1]) as {
  documentId: string; target: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string }[]
}[]

describe('G20 canonical model execution loop', () => {
  it('feeds the accumulated unnamed prefix once and then parses only new text.replace deltas', async () => {
    const snapshot = vi.spyOn(StreamingEditArguments.prototype, 'snapshot'), push = vi.spyOn(StreamingEditArguments.prototype, 'push')
    let turns = 0
    const provider: ModelProvider = { async *stream(request) {
      if (turns++) { yield complete(request); return }
      const target = refsOf(request)[0]!.writable[0]!.target
      const raw = JSON.stringify({ target, content: '新😀内容\n保留尾部' })
      const split = raw.indexOf('content')
      yield { requestId: request.requestId, sequence: 1, type: 'tool.delta', index: 0, argumentsDelta: raw.slice(0, 5) }
      yield { requestId: request.requestId, sequence: 2, type: 'tool.delta', index: 0, id: 'streamed', name: 'text.replace', argumentsDelta: raw.slice(5, split) }
      yield { requestId: request.requestId, sequence: 3, type: 'tool.delta', index: 0, argumentsDelta: raw.slice(split) }
      yield complete(request, [{ id: 'streamed', name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(snapshot.mock.calls[0]![1]).toContain('"target"')
    expect(push).toHaveBeenCalledTimes(1)
    expect(h.session.read().model).toMatchObject({ source: '前文 新😀内容\n保留尾部 后文' })
    expect(final.requests.every(request => request.payload?.prefix === undefined)).toBe(true)
  })

  it('waits for the real display append before consuming another provider fragment', async () => {
    const entered = deferred(), release = deferred(), continued = vi.fn()
    const provider: ModelProvider = { async *stream(request) {
      yield { requestId: request.requestId, sequence: 1, type: 'text.delta', text: '持久化首片' }
      continued()
      yield complete(request, [], '持久化首片')
    } }
    const h = await fixture(provider), append = h.events.batchAppend.bind(h.events)
    vi.spyOn(h.events, 'batchAppend').mockImplementation(async inputs => {
      if (inputs.some(input => input.type === 'text' && input.data.status === 'running')) {
        entered.resolve(); await release.promise
      }
      return append(inputs)
    })
    const started = await h.engine.start(h.input)
    await entered.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(continued).not.toHaveBeenCalled()
    release.resolve()
    expect((await h.engine.wait(started.runId)).status).toBe('completed')
    expect(continued).toHaveBeenCalledOnce()
  })

  it('publishes the first display fragment after durable acknowledgement without waiting for the batching interval', async () => {
    const visible: string[] = []
    const provider: ModelProvider = { async *stream(request) {
      yield { requestId: request.requestId, sequence: 1, type: 'text.delta', text: '首片' }
      await h.events.flushPending()
      expect(visible).toContain('首片')
      yield { requestId: request.requestId, sequence: 2, type: 'text.delta', text: '尾片' }
      yield complete(request, [], '首片尾片')
    } }
    const h = await fixture(provider)
    const published: number[] = []
    const unsubscribe = h.engine.subscribe(event => {
      published.push(event.sequence)
      if (event.type === 'text' && event.data.status === 'running') visible.push(event.data.text ?? '')
    })
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    await h.events.flushPending()
    unsubscribe()
    expect(final.status).toBe('completed')
    expect(visible.join('')).toBe('首片尾片')
    const persisted = await h.events.readPage({ conversationId: h.input.conversationId })
    expect(persisted.events.map(event => event.sequence)).toEqual(published)
  })
  it('delivers verified compute bytes through real job owners and artifact.save in a document-free run', async () => {
    let turns = 0, job = '', source = ''
    const bytes = Buffer.from('owner verified result\n')
    const lastData = (request: ModelRequest) => JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content)).data
    const provider: ModelProvider = { async *stream(request) {
      turns++
      if (turns === 1) { yield complete(request, [{ id: 'compute-once', name: 'compute.run', argumentsText: '{"code":"result = 42"}' }]); return }
      if (turns === 2) {
        job = lastData(request).job
        yield complete(request, [{ id: 'ready-original', name: 'job.wait', argumentsText: JSON.stringify({ job, milliseconds: 1000 }) }]); return
      }
      if (turns === 3) {
        const receipt = lastData(request)
        expect(receipt.status).toBe('ready'); source = receipt.snapshot.artifacts[0].source
        expect(source).toEqual(expect.any(String))
        yield complete(request, [{ id: 'deliver-compute', name: 'artifact.save', argumentsText: JSON.stringify({ source, destination: 'exports/result.txt' }) }]); return
      }
      yield complete(request)
    } }
    const h = await fixture(provider, true)
    h.input.documents = []; h.input.workspaceRoot = h.workspaceRoot
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(final.tools.find(tool => tool.call.name === 'artifact.save')?.result).toMatchObject({ kind: 'read', data: { status: 'written', sourceKind: 'compute', sourceId: `${job}@result.txt` } })
    expect(await fs.readFile(path.join(h.workspaceRoot, 'exports', 'result.txt'))).toEqual(bytes)
    expect(await h.compute!.status(started.runId, job)).toMatchObject({ status: 'ready', stopped: false })
    expect(h.computeExecute).toHaveBeenCalledOnce()
  })
  it('Engine grants only same-task ancestor reads, keeps the original producer and current save grant, and rejects foreign workspaces', async () => {
    let originalRun = '', job = '', originalTurns = 0, currentTurns = 0, mode: 'create' | 'read' | 'new-task' = 'create', readingAllowed = true
    const provider: ModelProvider = { async *stream(request) {
      if (mode === 'create') {
        if (++originalTurns === 1) { yield complete(request, [{ id: 'original-compute', name: 'compute.run', argumentsText: '{"code":"result = 42"}' }]); return }
        if (originalTurns === 2) {
          job = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content)).data.job
          yield complete(request, [{ id: 'original-ready', name: 'job.wait', argumentsText: JSON.stringify({ job, milliseconds: 1000 }) }]); return
        }
        yield complete(request); return
      }
      if (mode === 'new-task') { yield complete(request); return }
      if (++currentTurns === 1) { yield complete(request, [{ id: 'reuse-original', name: 'job.status', argumentsText: JSON.stringify({ job }) }]); return }
      if (readingAllowed && currentTurns === 2) { yield complete(request, [{ id: 'wait-original', name: 'job.wait', argumentsText: JSON.stringify({ job, milliseconds: 0 }) }]); return }
      if (readingAllowed && currentTurns === 3) {
        const returned = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content)).data
        yield complete(request, [{ id: 'save-from-original', name: 'artifact.save', argumentsText: JSON.stringify({ source: returned.snapshot.artifacts[0].source, destination: 'exports/continued.txt' }) }]); return
      }
      if (readingAllowed && currentTurns === 4) { yield complete(request, [{ id: 'cancel-original-denied', name: 'job.cancel', argumentsText: JSON.stringify({ job }) }]); return }
      yield complete(request)
    } }
    const h = await fixture(provider, true)
    h.input.documents = []; h.input.workspaceRoot = h.workspaceRoot
    const initial = await h.engine.start(h.input); originalRun = initial.runId; await h.engine.wait(initial.runId)
    const cancel = vi.spyOn(h.compute!, 'cancel')
    mode = 'read'
    const continued = await h.engine.start({ ...h.input, taskId: 'continued' }, { runId: initial.runId, facts: '', sameTask: true })
    const final = await h.engine.wait(continued.runId)
    expect(final.tools.find(tool => tool.call.name === 'job.status')?.result).toMatchObject({ kind: 'read', data: { status: 'ready', snapshot: { runId: originalRun } } })
    expect(final.tools.find(tool => tool.call.name === 'job.wait')?.result).toMatchObject({ kind: 'read', data: { status: 'ready', snapshot: { runId: originalRun } } })
    const delivery = final.tools.find(tool => tool.call.name === 'artifact.save')!.result!
    expect(delivery).toMatchObject({ kind: 'read', data: { status: 'written' } })
    const operationId = delivery.kind === 'read' ? (delivery.data as { operationId: string }).operationId : ''
    expect(operationId).toEqual(expect.any(String))
    expect(await h.artifacts!.lookup(operationId, continued.runId)).toEqual(delivery.kind === 'read' ? delivery.data : undefined)
    await expect(h.artifacts!.lookup(operationId, originalRun)).rejects.toThrow('不属于当前运行')
    expect(await fs.readFile(path.join(h.workspaceRoot, 'exports/continued.txt'), 'utf8')).toBe('owner verified result\n')
    expect(final.tools.find(tool => tool.call.name === 'job.cancel')?.result).toMatchObject({ kind: 'error', code: 'job-not-authorized',
      message: '接续任务可读取原任务成果，但不能取消原任务的作业' })
    expect(cancel).not.toHaveBeenCalled()
    await expect(h.engine.start({ ...h.input, taskId: 'foreign', workspaceRoot: path.join(h.workspaceRoot, 'foreign') },
      { runId: initial.runId, facts: '', sameTask: true })).rejects.toThrow('工作空间')
    mode = 'new-task'
    const fresh = await h.engine.start({ ...h.input, taskId: 'new-user-task', instruction: '这是新的任务' }, { runId: initial.runId, facts: '', sameTask: false })
    await h.engine.wait(fresh.runId)
    mode = 'read'; currentTurns = 0; readingAllowed = false
    const freshContinuation = await h.engine.start({ ...h.input, taskId: 'new-user-continuation', instruction: '继续新的任务' }, { runId: fresh.runId, facts: '', sameTask: true })
    const denied = await h.engine.wait(freshContinuation.runId)
    expect(denied.tools.find(tool => tool.call.name === 'job.status')?.result).toMatchObject({ kind: 'error', code: 'job-not-authorized' })
    expect(await h.compute!.status(originalRun, job)).toMatchObject({ runId: originalRun, status: 'ready', stopped: false })
    expect(h.computeExecute).toHaveBeenCalledOnce()
  })
  it('blocks a new image request after a saved 429 in the same run while other tools continue', async () => {
    let turns = 0, imageDispatches = 0
    const provider: ModelProvider = { async *stream(request) {
      turns++
      const target = refsOf(request)[0]!.target
      if (turns <= 2) {
        yield complete(request, [{ id: `image-${turns}`, name: 'image.generate',
          argumentsText: JSON.stringify({ target, prompt: 'same image', output: { format: 'png' } }) },
        ...(turns === 2 ? [{ id: 'independent-read', name: 'read', argumentsText: JSON.stringify({ target }) }] : [])]); return
      }
      yield complete(request)
    } }
    const h = await fixture(provider), original = h.gateway.execute.bind(h.gateway)
    vi.spyOn(h.gateway, 'execute').mockImplementation(async (runId, callId, call) => {
      if (call.name !== 'image.generate') return original(runId, callId, call)
      imageDispatches++
      return { kind: 'read', data: { job: 'first-image-job', status: 'failed', resources: [], failure: {
        kind: 'rate-limit', outcome: 'rejected', code: 'image-http-429', httpStatus: 429 } } }
    })
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(imageDispatches).toBe(1)
    expect(final.tools.filter(tool => tool.call.name === 'image.generate')).toHaveLength(2)
    expect(final.tools[1]!.result).toMatchObject({ kind: 'error', code: 'image-rate-limited-for-run' })
    expect(final.tools[2]!.result).toMatchObject({ kind: 'read' })
    expect(final.status).toBe('partial')
    expect(final.failure?.code).toBeUndefined()
    expect(turns).toBe(3)
  })
  it.each([true, false])('uses frozen image role identity to decide whether an edit shares a generate 429 (%s)', async sameRole => {
    let turns = 0, dispatches = 0
    const provider: ModelProvider = { async *stream(request) {
      turns++
      const name = turns === 1 ? 'image.generate' : 'image.edit'
      if (turns <= 2) { yield complete(request, [{ id: `image-${turns}`, name,
        argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target, prompt: 'image', output: { format: 'png' } }) }]); return }
      yield complete(request)
    } }
    const h = await fixture(provider), role = { connectionId: 'image-connection', connectionRevision: 1,
      provider: 'openai', model: 'image-model', billingKind: 'subscription' as const }
    h.input.disclosedSettings = { profileRevision: 1, roles: { conversation: null, vision: null,
      imageGenerate: role, imageEdit: { ...role, model: sameRole ? role.model : 'different-image-model' } } }
    vi.spyOn(h.gateway, 'execute').mockImplementation(async (_runId, _callId, call) => {
      if (call.name !== 'image.generate' && call.name !== 'image.edit') throw new Error('unexpected tool')
      dispatches++
      return { kind: 'read', data: { job: `image-job-${dispatches}`, status: dispatches === 1 ? 'failed' : 'ready',
        resources: [], ...(dispatches === 1 ? { failure: { kind: 'rate-limit', outcome: 'rejected', code: 'image-http-429' } } : {}) } }
    })
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(dispatches).toBe(sameRole ? 1 : 2)
    expect(final.tools[1]!.result).toMatchObject(sameRole
      ? { kind: 'error', code: 'image-rate-limited-for-run' } : { kind: 'read', data: { status: 'ready' } })
    expect(turns).toBe(3)
  })
  it('keeps repeated tool rounds running until the model completes', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests > 10) { yield complete(request); return }
      yield complete(request, [{ id: `read-${requests}`, name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) }])
    } }
    const h = await fixture(provider)
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(final.status).toBe('completed'); expect(final.failure).toBeUndefined()
    expect(final.requests).toHaveLength(11)
    expect(final.tools).toHaveLength(10)
    expect(requests).toBe(11)
  })
  it('allows repeated alternating observations until the model completes', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      if (requests >= 10) { requests++; yield complete(request); return }
      const target = refsOf(request)[requests++ % 2]!.target
      yield complete(request, [{ id: `read-${requests}`, name: 'read', argumentsText: JSON.stringify({ target }) }])
    } }
    const h = await fixture(provider)
    h.input.documents = [h.input.documents[0]!, { documentId: h.other.documentId, writable: [] }]
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.failure).toBeUndefined()
    expect(final.requests).toHaveLength(11)
  })
  it('allows repeated unchanged edits without a task quota or false content change', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests > 10) { yield complete(request); return }
      yield complete(request, [{ id: `unchanged-${requests}`, name: 'text.replace',
        argumentsText: JSON.stringify({ target: refsOf(request)[0]!.writable[0]!.target, content: 'OLD' }) }])
    } }
    const h = await fixture(provider)
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.failure).toBeUndefined()
    expect(final.requests).toHaveLength(11)
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0 })
  })
  it.each(['custom', 1])('rejects unsupported streaming tool type %s before any document write', async type => {
    let requests = 0
    const server = await serve(async (request, response) => {
      requests++
      let body = ''; for await (const bytes of request) body += bytes.toString()
      const wire = (JSON.parse(body).tools as { function: { name: string } }[])
        .find(tool => tool.function.name)?.function.name
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(wireChunk({ tool_calls: [{ index: 0, id: 'unsupported-call', type,
        function: { name: wire, arguments: '{"content":"SHOULD NOT WRITE"}' } }] }, 'tool_calls') + 'data: [DONE]\n\n')
    })
    const h = await fixture(new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' }))
    h.input.selection = { ...selection, connection: { ...selection.connection, baseURL: server.url } }
    const started = await h.engine.start(h.input)
    const final = await h.engine.wait(started.runId)
    expect(requests).toBe(1)
    expect(final.tools).toHaveLength(0)
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
  })
  it.each([
    { failedName: 'read', retryOther: true, commit: true },
    { failedName: 'inspect', retryOther: false, commit: false },
  ] as const)('keeps $failedName diagnostic history while settling from delivery receipts', async ({ failedName, retryOther, commit }) => {
    let turns = 0
    const provider: ModelProvider = { async *stream(request) {
      turns++
      const target = refsOf(request)[0]!.writable[0]!.target
      if (turns === 1) {
        yield complete(request, [{ id: 'initial-read', name: 'read', argumentsText: JSON.stringify({ target }) }]); return
      }
      if (turns > 2) { yield complete(request); return }
      const lastRead = request.messages.filter(message => message.role === 'tool').at(-1)
      const renewed = (JSON.parse(String(lastRead?.content)) as { data: { target: string } }).data.target
      yield complete(request, [
        { id: 'failed-observation', name: failedName, argumentsText: JSON.stringify({ target: 'not-a-real-handle' }) },
        { id: 'retry-observation', name: failedName, argumentsText: JSON.stringify({ target: retryOther ? refsOf(request)[0]!.target : renewed }) },
        ...(commit ? [{ id: 'commit', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'NEW' }) }] : []),
      ])
    } }
    const h = await fixture(provider)
    h.input.documents = [{ documentId: h.session.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }],
      selection: [{ kind: 'markdown-range', from: 3, to: 6 }] }]
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'invalid-target' })
    if (retryOther) {
      expect(final.tools[2]?.result?.kind).toBe('read')
      expect((final.tools[2]?.call.input as { target: string }).target)
        .not.toBe((final.tools.at(-1)?.call.input as { target: string }).target)
    }
    expect(final.tools[2]?.result?.kind).toBe('read')
    if (commit) expect(final.tools.at(-1)?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.session.read().model).toMatchObject({ source: commit ? '前文 NEW 后文' : '前文 OLD 后文' })
    const timeline = await h.events.snapshot('conversation')
    expect(h.session.read().undoDepth).toBe(Number(commit))
    expect(timeline.items.filter(item => item.type === 'tool')).toHaveLength(3 + Number(commit))
    const end = timeline.items.find(item => item.type === 'run.end')
    expect(end?.data.status).toBe('completed')
    const publicEnd = await h.events.findEvent('conversation', `${final.runId}:terminal`)
    expect(runEndSummary(final)).toContain('中间操作警告 1 项')
    expect(publicEnd?.data.status).toBe('completed')
  })

  it('reuses the writable document root handle without widening frozen or read-only scopes', async () => {
    let references: ReturnType<typeof refsOf> | undefined, turns = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++turns > 1) { yield complete(request); return }
      references = refsOf(request)
      const [main, other] = references
      yield complete(request, [
        { id: 'readonly-selection', name: 'text.replace', argumentsText: JSON.stringify({ target: main.selection[0].target, content: 'DENIED' }) },
        { id: 'other-document', name: 'text.replace', argumentsText: JSON.stringify({ target: other.target, content: 'DENIED' }) },
        { id: 'allowed-range', name: 'text.replace', argumentsText: JSON.stringify({ target: main.writable[1].target, content: 'YES' }) },
      ])
    } }
    const h = await fixture(provider)
    h.input.documents = [
      { documentId: h.session.documentId, writable: [{ kind: 'document' }, { kind: 'markdown-range', from: 3, to: 6 }],
        selection: [{ kind: 'document' }] },
      { documentId: h.other.documentId, writable: [] },
    ]
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(runEndSummary(final)).toContain('中间操作警告 2 项')
    expect(references).toHaveLength(2)
    expect(references![0].target).toBe(references![0].writable[0].target)
    expect(references![0].selection[0].target).not.toBe(references![0].target)
    expect(references![0].writable[1].target).not.toBe(references![0].target)
    expect(references![1].target).not.toBe(references![0].target)
    expect(final.tools.map(tool => tool.result?.kind === 'error' ? tool.result.code : tool.result?.kind)).toEqual([
      'not-authorized', 'not-authorized', 'document-operation',
    ])
    expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 YES 后文' } })
    expect(h.other.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '另一份文档' } })
  })

  it('streams real HTTP arguments into previews, recovers a lost tool ACK and returns native history to the model', async () => {
    const requests: any[] = [], previewReady = deferred(), continueStream = deferred()
    const server = await serve(async (request, response) => {
      let body = ''; for await (const bytes of request) body += bytes.toString()
      const data = JSON.parse(body); requests.push(data)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (requests.length === 1) {
        const references = JSON.parse(data.messages[1].content.split('：')[1])
        const target = references[0].writable[0].target
        const name = data.tools.find((tool: any) => tool.function.name === modelToolWireName('text.replace'))?.function.name
        const args = JSON.stringify({ target, content: '新的😀内容\n第二行\\引用"' })
        response.write(wireChunk({ role: 'assistant', reasoning_content: '检查目标', signature: 'native-signature' }))
        response.write(wireChunk({ content: '准备修改' }))
        response.write(wireChunk({ tool_calls: [{ index: 0, id: 'provider-call-1', type: 'function', function: { name, arguments: args.slice(0, -7) } }] }))
        await continueStream.promise
        response.write(wireChunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(-7) } }] }, 'tool_calls'))
      } else response.write(wireChunk({ role: 'assistant', content: '修改已应用' }, 'stop'))
      response.end('data: [DONE]\n\n')
    })
    const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' })
    const h = await fixture(provider); h.input.selection = { ...selection, connection: { ...selection.connection, baseURL: server.url } }
    h.edits.subscribe(event => { if (event.type === 'edit.changed' && event.snapshot.value) previewReady.resolve() })
    const execute = h.gateway.execute.bind(h.gateway)
    const executeSpy = vi.spyOn(h.gateway, 'execute').mockImplementation(async (...args) => { await execute(...args); throw new Error('lost ACK') })
    const lookupSpy = vi.spyOn(h.gateway, 'lookup')
    const started = await h.engine.start(h.input)
    await previewReady.promise
    expect(h.edits.list(h.session.documentId)[0].value).toContain('新的😀内容')
    expect(h.session.read().model).toMatchObject({ source: '前文 OLD 后文' })
    expect(h.session.read().undoDepth).toBe(0)
    continueStream.resolve()
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(requests).toHaveLength(2); expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(lookupSpy).toHaveBeenLastCalledWith(started.runId, final.tools[0]!.callId, final.tools[0]!.call)
    await expect(lookupSpy.mock.results.at(-1)!.value).resolves.toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.session.read().model).toMatchObject({ source: '前文 新的😀内容\n第二行\\引用" 后文' })
    expect(h.other.read().model).toMatchObject({ source: '另一份文档' })
    expect(h.session.read().undoDepth).toBe(1); expect(h.edits.list(h.session.documentId)).toEqual([])
    const native = requests[1].messages.find((message: any) => message.role === 'assistant')
    expect(native).toMatchObject({ reasoning_content: '检查目标', signature: 'native-signature', tool_calls: [{ id: 'provider-call-1' }] })
    expect(JSON.parse(requests[1].messages.find((message: any) => message.role === 'tool').content)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const snapshot = h.session.read()
    await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })
    expect(h.session.read().model).toMatchObject({ source: '前文 OLD 后文' })
    const timeline = await h.events.snapshot('conversation')
    expect(timeline.items.find(item => item.type === 'reasoning')?.content).toEqual([{ kind: 'text', text: '检查目标' }])
    expect(timeline.items.filter(item => item.type === 'text').map(item => item.content)).toEqual([
      [{ kind: 'text', text: '准备修改' }], [{ kind: 'text', text: '修改已应用' }],
    ])
    expect(timeline.items.find(item => item.type === 'tool')?.data.output).not.toContain('检查目标')
    expect(h.session.read().model).toMatchObject({ source: '前文 OLD 后文' })
    expect(timeline.items.filter(item => item.type === 'document.commit')).toHaveLength(1)
  })

  it('S06-T06 waits for a late target before preview and commits only the complete matching argument object', async () => {
    const beforeTarget = deferred(), releaseTarget = deferred(); let turns = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++turns > 1) { yield complete(request, [], '完成'); return }
      const target = refsOf(request)[0]!.writable[0]!.target
      const raw = JSON.stringify({ content: '中文😀\n新段', target })
      const boundary = raw.indexOf('"target"') + '"target":"'.length
      const first = raw.slice(0, boundary), last = raw.slice(boundary)
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'late-target', name: 'text.replace', argumentsDelta: first }
      beforeTarget.resolve(); await releaseTarget.promise
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id: 'late-target', name: 'text.replace', argumentsDelta: last }
      yield complete(request, [{ id: 'late-target', name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider), started = await h.engine.start(h.input)
    await beforeTarget.promise
    expect(h.edits.list(h.session.documentId)).toEqual([])
    expect(h.session.read()).toMatchObject({ revision: 0, model: { source: '前文 OLD 后文' } })
    releaseTarget.resolve()
    const run = await h.engine.wait(started.runId)
    expect(run.status).toBe('completed')
    expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 中文😀\n新段 后文' } })
    expect((await h.events.snapshot('conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(1)
  })

  it.each(['invalid-target', 'not-authorized', 'preview-failed'])('C2 submits complete streamed text after %s preview failure and undoes once', async code => {
    let turns = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++turns > 1) { yield complete(request, [], '完成'); return }
      const target = refsOf(request)[0]!.writable[0]!.target
      const raw = JSON.stringify({ target, content: 'NEW' })
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'no-preview', name: 'text.replace', argumentsDelta: raw.slice(0, -3) }
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id: 'no-preview', argumentsDelta: raw.slice(-3) }
      yield complete(request, [{ id: 'no-preview', name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider)
    const begin = vi.spyOn(h.edits, 'begin').mockRejectedValue(Object.assign(new Error('preview unavailable'), { code }))
    const execute = vi.spyOn(h.gateway, 'execute')
    const started = await h.engine.start(h.input), run = await h.engine.wait(started.runId)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(started.runId, run.tools[0]!.callId, expect.objectContaining({ name: 'text.replace' }))
    expect(run).toMatchObject({ status: 'completed', tools: [{ result: { kind: 'document-operation', result: { status: 'applied' } } }] })
    const changed = h.session.read()
    expect(changed).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 NEW 后文' } })
    expect(await h.session.execute({ documentId: changed.documentId, epoch: changed.epoch, operationId: 'undo-no-preview',
      baseRevision: changed.revision, actor: 'human', mutation: { type: 'undo', expectedTopOperationId: changed.undoHead!.operationId } })).toMatchObject({ status: 'applied' })
    expect(h.session.read()).toMatchObject({ undoDepth: 0, model: { source: '前文 OLD 后文' } })
  })

  it('C2 stops after skipped preview without submitting late complete text', async () => {
    const entered = deferred(), release = deferred()
    const provider: ModelProvider = { async *stream(request) {
      const target = refsOf(request)[0]!.writable[0]!.target, raw = JSON.stringify({ target, content: 'LATE' })
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'stopped-preview', name: 'text.replace', argumentsDelta: raw.slice(0, -3) }
      entered.resolve(); await release.promise
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id: 'stopped-preview', argumentsDelta: raw.slice(-3) }
      yield complete(request, [{ id: 'stopped-preview', name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider)
    const begin = vi.spyOn(h.edits, 'begin').mockRejectedValue(Object.assign(new Error('preview unavailable'), { code: 'invalid-target' }))
    const execute = vi.spyOn(h.gateway, 'execute')
    const started = await h.engine.start(h.input); await entered.promise
    const stopped = h.engine.stop(started.runId); release.resolve(); await stopped
    expect(begin).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    const final = await h.engine.wait(started.runId)
    expect(final).toMatchObject({ status: 'stopped' })
    expect(final.requests[0]!.argumentDrafts).toEqual([{ state: 'incomplete-prefix', providerCallId: 'stopped-preview',
      toolName: 'text.replace', argumentsText: JSON.stringify({ target: refsOf({ messages: final.messages })[0]!.writable[0]!.target, content: 'LATE' }).slice(0, -3) }])
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
  })

  it('M15 a run editing a document whose other part another run is previewing commits its own edit without a preview', async () => {
    const aStreaming = deferred(), releaseA = deferred(), turns = new Map<string, number>()
    const provider: ModelProvider = { async *stream(request) {
      // Host work facts also use user-role data; route this fixture by its exact instruction.
      const which = String(request.messages.find(message => message.role === 'user' && (message.content === 'A' || message.content === 'B'))?.content)
      const turn = (turns.get(which) ?? 0) + 1; turns.set(which, turn)
      if (turn > 1) { yield complete(request, [], '完成'); return }
      const target = refsOf(request)[0]!.writable[0]!.target, id = `call-${which}`
      const raw = JSON.stringify({ target, content: which === 'A' ? '新中' : '新前' })
      if (which === 'A') {
        yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id, name: 'text.replace', argumentsDelta: raw.slice(0, -3) }
        aStreaming.resolve(); await releaseA.promise
        yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id, name: 'text.replace', argumentsDelta: raw.slice(-3) }
      } else yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id, name: 'text.replace', argumentsDelta: raw }
      yield complete(request, [{ id, name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider)
    const a = await h.engine.start({ ...h.input, instruction: 'A' })
    await aStreaming.promise
    await vi.waitFor(() => expect(h.edits.list(h.session.documentId)).toMatchObject([{ runId: a.runId, value: '新' }]))
    // Meanwhile another run (another object's card) edits another part of the same document.
    const b = await h.engine.start({ ...h.input, conversationId: 'conversation-b', taskId: 'task-b', instruction: 'B',
      documents: [{ documentId: h.session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 2 }] }] })
    const runB = await h.engine.wait(b.runId)
    expect(runB.status).toBe('completed')
    expect(runB.tools[0]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.session.read().model).toMatchObject({ source: '新前 OLD 后文' })
    // The first run's preview carries on over the other edit, then commits.
    expect(h.edits.list(h.session.documentId)).toMatchObject([{ runId: a.runId, status: 'active' }])
    releaseA.resolve()
    const runA = await h.engine.wait(a.runId)
    expect(runA.status).toBe('completed')
    expect(h.session.read()).toMatchObject({ undoDepth: 2, model: { source: '新前 新中 后文' } })
    expect(h.edits.list(h.session.documentId)).toEqual([])
  })

  it.each(['duplicate-key', 'truncated-escape'] as const)('S06-T06 rejects %s after streamed preview without a document write', async mode => {
    let turns = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++turns > 1) { yield complete(request, [], '参数失败，未应用'); return }
      const target = refsOf(request)[0]!.writable[0]!.target
      const raw = mode === 'duplicate-key'
        ? `{"target":${JSON.stringify(target)},"content":"X","content":"Y"}`
        : `{"target":${JSON.stringify(target)},"content":"X\\uD83D`
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'invalid-call', name: 'text.replace', argumentsDelta: raw }
      yield complete(request, [{ id: 'invalid-call', name: 'text.replace', argumentsText: raw }], '')
    } }
    const h = await fixture(provider), started = await h.engine.start(h.input)
    const run = await h.engine.wait(started.runId)
    expect(run.status).toBe('partial')
    expect(run.tools[0]?.result).toMatchObject({ kind: 'error', code: 'invalid-tool-arguments' })
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
    expect(h.edits.list(h.session.documentId)).toEqual([])
    expect((await h.events.snapshot('conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(0)
  })

  it('sets the stop barrier before a late model completion and never starts another paid request for an unknown response', async () => {
    const entered = deferred(), late = deferred(); let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++; entered.resolve(); await late.promise
      const refs = JSON.parse(String(request.messages[1].content).split('：')[1]), target = refs[0].writable[0].target
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'late', actualModel: 'fixture', finishReason: 'tool_calls', nativeResponse: {},
        assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'late-call', type: 'function', function: { name: 'text.replace', arguments: JSON.stringify({ target, content: 'LATE' }) } }] },
        toolCalls: [{ id: 'late-call', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'LATE' }) }] }
    } }
    const h = await fixture(provider), run = await h.engine.start(h.input); await entered.promise
    const stopped = h.engine.stop(run.runId); late.resolve(); await stopped
    expect((await h.engine.read(run.runId))?.status).toBe('stopped')
    expect((await h.engine.read(run.runId))?.requests[0].failure?.outcome).toBe('unknown')
    expect(h.session.read().model).toMatchObject({ source: '前文 OLD 后文' }); expect(h.session.read().undoDepth).toBe(0)
    expect(requests).toBe(1)
    const unknown: ModelProvider = { async *stream(request) { requests++; yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'unknown', kind: 'timeout', code: 'timeout', message: '结果未知' } } } }
    const resumedEngine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, provider: unknown, runs: h.runs, events: h.events })
    const failed = await resumedEngine.start({ ...h.input, taskId: 'uncertain' })
    expect(await resumedEngine.wait(failed.runId)).toMatchObject({ status: 'failed', failure: { outcome: 'unknown' } })
    expect(requests).toBe(2)
    expect(await resumedEngine.recover()).toEqual([]); expect(requests).toBe(2)
  })

  it('marks a late provider response.failed after stop as stopped-in-flight regardless of the upstream code', async () => {
    const entered = deferred(), release = deferred()
    const provider: ModelProvider = { async *stream(request) {
      entered.resolve(); await release.promise
      yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
        failure: { outcome: 'unknown', kind: 'transport', code: 'chatgpt-transport', message: '网络返回失败' } }
    } }
    const h = await fixture(provider), started = await h.engine.start(h.input); await entered.promise
    const stopping = h.engine.stop(started.runId); release.resolve(); await stopping
    const record = (await h.engine.read(started.runId))!
    expect(record.status).toBe('stopped')
    expect(record.requests[0].failure).toMatchObject({ outcome: 'unknown', kind: 'aborted', code: 'stopped-in-flight' })
    expect(record.requests[0].failure?.message).toBe('已停止等待模型；上游请求结果未知，未自动重发')
  })

  it('uses 回复未完成 (not 普通生成) in the retrying label and text', async () => {
    let attempts = 0
    const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
      attempts++
      if (attempts < 2) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
        failure: { outcome: 'unknown', kind: 'transport', code: 'chatgpt-transport', message: '网络中断' } }
      else yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'done', actualModel: 'fixture',
        finishReason: 'stop', nativeResponse: {}, assistant: { role: 'assistant', content: '完成' }, toolCalls: [] }
    } }
    const h = await fixture(provider), started = await h.engine.start(h.input)
    await h.engine.wait(started.runId)
    const page = await h.events.readPage({ conversationId: 'conversation' })
    const retrying = page.events.find(value => value.type === 'run.state'
      && (value.data as { status?: string }).status === 'retrying')
    expect(retrying).toBeDefined()
    const data = retrying?.data as { label?: string; text?: string }
    const label = String(data?.label ?? ''), text = String(data?.text ?? '')
    expect(label + text).not.toContain('普通')
    expect(text).toContain('回复未完成')
    expect(text).toContain('第2次尝试')
  })

  it('recovers crash-window tool facts and missing commit events read-only, then resumes with fresh handles', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) { requests++; yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'done', actualModel: 'fixture', finishReason: 'stop', nativeResponse: {}, assistant: { role: 'assistant', content: '已完成剩余检查' }, toolCalls: [] } } }
    const h = await fixture(provider), started = await h.engine.start(h.input)
    await h.engine.wait(started.runId)
    const old = (await h.runs.read(started.runId))! // Simulate process dying after canonical ACK but before checkpointing its receipt.
    const crashRun = 'crash-run'
    await h.gateway.beginRun({ runId: crashRun, actor: 'agent', documents: h.input.documents })
    const handle = await h.gateway.issueTarget(crashRun, h.session.documentId, { kind: 'markdown-range', from: 3, to: 6 })
    const call = { name: 'text.replace', input: { target: handle, content: 'X' } }
    expect(await h.gateway.execute(crashRun, 'crash-call', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    old.runId = crashRun; old.status = 'running'; old.requests.push({ requestId: 'unknown-request', state: 'sending' })
    old.tools = [{ callId: 'crash-call', providerCallId: 'p-call', requestId: 'before-crash', call, state: 'executing' }]
    await h.runs.save(old)
    const canonicalRename = fs.rename.bind(fs); let interrupted = false
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!interrupted && String(to).startsWith(path.join(h.directory, 'runs'))) { interrupted = true; throw new Error('checkpoint rename interrupted') }
      return canonicalRename(from, to)
    })
    await expect(h.runs.save({ ...old, version: old.version + 1 }, { checkpoint: true })).rejects.toThrow('checkpoint rename interrupted')
    expect((await h.runs.read(crashRun))?.version).toBe(old.version)
    const restored = new DocumentRegistry({ drivers: [h.driver], persistence: h.journal, createId: randomUUID, bindingKey: binding => binding.path })
    await restored.restore((await h.journal.recover(h.session.documentId))!)
    const gateway = new DocumentToolGateway(restored, [h.driver], randomUUID)
    const engine = new ExecutionEngine({ registry: restored, gateway, provider, runs: h.runs, events: h.events })
    const recovered = await engine.recover()
    expect(recovered).toHaveLength(1); expect(recovered[0].tools[0]).toMatchObject({ state: 'returned', result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(recovered[0].failure?.outcome).toBe('unknown'); expect(requests).toBe(1)
    expect(restored.get(h.session.documentId).read().undoDepth).toBe(1)
    const commits = (await h.events.snapshot('conversation')).items.filter(item => item.type === 'document.commit')
    expect(commits).toHaveLength(1); expect(commits[0].data.documentId).toBe(h.session.documentId)
    const resumed = await engine.resume(crashRun, { ...h.input, taskId: 'continue', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
    const final = await engine.wait(resumed.runId)
    expect(final.status).toBe('completed'); expect(final.continuedFrom).toBe(crashRun); expect(requests).toBe(2)
    expect(final.messages.some(message => String(message.content).includes('crash-call'))).toBe(true)
    expect(restored.get(h.session.documentId).read().undoDepth).toBe(1)
    expect(await engine.recover()).toEqual([])
    expect((await h.events.snapshot('conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(1)
  })

  it('compresses actual serialized payloads only after all tools return and preserves both document grants and commit facts', async () => {
    const requests: ModelRequest[] = []
    let largeTurnRepetitions = 0
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) {
        const refs = refsOf(request)
        yield complete(request, [
          { id: 'read', name: 'read', argumentsText: JSON.stringify({ target: refs[0].target }) },
          { id: 'allowed', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[0].writable[0].target, content: 'YES' }) },
          { id: 'denied', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[1].target, content: 'NO' }) },
        ], '完整的中间推理与过程。'.repeat(largeTurnRepetitions))
      } else yield complete(request)
    } }
    const h = await fixture(provider)
    const tools = (await h.gateway.describe()).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema as ModelJsonObject }))
    largeTurnRepetitions = Buffer.byteLength(serializeModelRequest({ selection, tools, messages: [{ role: 'user', content: 'x' }] })) + 10000
    h.input.selection = { ...selection, contextWindow: 50_000 }
    h.input.documents = [...h.input.documents, { documentId: h.other.documentId, writable: [] }]
    const run = await h.engine.start(h.input), final = await h.engine.wait(run.runId)
    expect(final.status).toBe('completed'); expect(requests).toHaveLength(2)
    expect(runEndSummary(final)).toContain('中间操作警告 1 项')
    expect(final.tools.map(tool => tool.state)).toEqual(['returned', 'returned', 'returned'])
    expect(final.tools[0].result?.kind).toBe('read')
    expect(final.tools[1].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(final.tools[2].result).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(final.compacted?.atRequest).toBe(1)
    expect(final.compacted?.facts).toContain('applied'); expect(final.compacted?.facts).toContain('not-authorized')
    expect(requests[1].messages.slice(0, final.initialMessageCount)).toEqual(requests[0].messages.slice(0, final.initialMessageCount))
    expect(requests[1].messages.some(message => String(message.content).includes('currentDocuments') && String(message.content).includes('\"revision\":1'))).toBe(true)
    expect(refsOf(requests[1])[1].writable).toEqual([])
    const nativeRound = requests[1].messages.slice(final.initialMessageCount + 1).filter(message => !isHostWorkFacts(message))
    expect(nativeRound.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'tool'])
    expect(nativeRound.slice(1).map(message => message.tool_call_id)).toEqual(['read', 'allowed', 'denied'])
    expect(String(nativeRound[0]!.content)).not.toContain('完整的中间推理与过程。')
    expect(final.messages.some(message => String(message.content).includes('完整的中间推理与过程。'))).toBe(true)
    expect(estimateSerializedTokens(serializeModelRequest(requests[1]))).toBeLessThanOrEqual(modelContextBudget(h.input.selection).inputTokens)
    expect(h.session.read()).toMatchObject({ undoDepth: 1, model: { source: '前文 YES 后文' } })
    expect(h.other.read()).toMatchObject({ undoDepth: 0, model: { source: '另一份文档' } })
  })

  it('sends large initial input for an unknown model window and runs complete tool rounds without quotas', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests > 1) { yield complete(request); return }
      const target = refsOf(request)[0].writable[0].target
      yield complete(request, [
        { id: 'one', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'YES' }) },
        { id: 'two', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0].target }) },
      ])
    } }
    const h = await fixture(provider)
    const started = await h.engine.start({ ...h.input, instruction: '任务内容。'.repeat(60000) })
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.requests).toHaveLength(2)
    expect(final.tools).toHaveLength(2); expect(final.tools.every(tool => tool.state === 'returned')).toBe(true)
    expect(final.compacted).toBeUndefined()
    expect(final).not.toHaveProperty('budget')
    expect(h.session.read()).toMatchObject({ undoDepth: 1, model: { source: '前文 YES 后文' } })
  })

  it('keeps bounded image and build receipts visible after a connection failure without repeating generation', async () => {
    let requests = 0, continuedFacts = ''
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests === 1) {
        yield complete(request, [{ id: 'initial-read', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) }]); return
      }
      if (requests === 2) { yield { type: 'response.failed', requestId: request.requestId, sequence: 1, failure: { outcome: 'unknown', kind: 'transport', code: 'connection-lost', message: '连接中断' } }; return }
      continuedFacts = request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n')
      yield complete(request, [], '已看到既有图片和构建错误，不重新生成图片')
    } }
    const h = await fixture(provider)
    const started = await h.engine.start({ ...h.input, })
    const exhausted = await h.engine.wait(started.runId)
    expect(exhausted.failure?.code).toBe('connection-lost')
    const old = (await h.runs.read(started.runId))!
    const call = (name: string, input: Record<string, unknown>, data: unknown, index: number) => ({
      callId: `service-${index}`, providerCallId: `provider-${index}`, requestId: old.requests[0]!.requestId,
      call: { name, input }, state: 'returned' as const, result: { kind: 'read' as const, data }, receiptTime: Date.now(),
    })
    old.tools.push(
      call('image.generate', { target: 'old-target', prompt: 'draw once' }, { job: 'image-existing', status: 'ready', stopped: false,
        resources: [{ resource: 'old-run-handle', resourceId: 'image_' + 'a'.repeat(64), mimeType: 'image/png', width: 64, height: 32 }] }, 1),
      call('build.create', { target: 'old-target' }, { job: 'build-existing', status: 'editing', sourceRevision: 0 }, 2),
      call('build.write', { job: 'old-build-handle', path: 'runtime.js', content: 'SOURCE MUST NOT ENTER FACTS' },
        { job: 'build-existing', status: 'editing', sourceRevision: 1 }, 3),
      call('build.compile', { job: 'old-build-handle', path: 'runtime.js', kind: 'runtime' },
        { ok: false, stage: 'syntax-checked', message: 'SyntaxError: Unexpected token at runtime.js:17' }, 4),
      call('build.logs', { job: 'old-build-handle', after: 0 }, { entries: [{ cursor: 1, stage: 'syntax', level: 'error',
        message: 'runtime.js:17: Unexpected token' }], nextCursor: 2 }, 5),
      call('build.read', { job: 'old-build-handle', path: 'runtime.js' }, { path: 'runtime.js', content: 'READ SOURCE MUST NOT ENTER FACTS',
        byteLength: 2048, nextOffset: null }, 6),
    )
    old.version++; await h.runs.save(old)
    const resumed = await h.engine.start({ ...h.input, }, { runId: exhausted.runId, facts: 'stale caller summary' })
    const final = await h.engine.wait(resumed.runId)
    expect(final.status).toBe('completed')
    expect(requests).toBe(3)
    expect(continuedFacts).toContain('image-existing')
    expect(continuedFacts).toContain('image_' + 'a'.repeat(64))
    expect(continuedFacts).toContain('build-existing')
    expect(continuedFacts).toContain('runtime.js:17')
    expect(continuedFacts).toContain('旧构建任务不能跨运行写入或导入')
    expect(continuedFacts).not.toContain('old-run-handle')
    expect(continuedFacts).not.toContain('SOURCE MUST NOT ENTER FACTS')
    expect(continuedFacts).not.toContain('READ SOURCE MUST NOT ENTER FACTS')
    expect(continuedFacts).not.toContain('stale caller summary')
  })

  it.each(['identity change', 'preview aborted'] as const)('never commits a complete tool after %s even without another preview', async mode => {
    let h: Awaited<ReturnType<typeof fixture>>, requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests > 1) { yield complete(request); return }
      const target = refsOf(request)[0].writable[0].target, args = JSON.stringify({ target, content: 'MUST NOT APPLY' })
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'original', name: 'text.replace', argumentsDelta: args }
      expect(h.edits.list(h.session.documentId)).toHaveLength(1)
      if (mode === 'identity change') yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id: 'changed', argumentsDelta: '' }
      else h.edits.abort(`${request.requestId}:0`, '宿主撤回正文组')
      yield complete(request, [{ id: mode === 'identity change' ? 'changed' : 'original', name: 'text.replace', argumentsText: args }])
    } }
    h = await fixture(provider)
    const execute = vi.spyOn(h.gateway, 'execute'), run = await h.engine.start(h.input), final = await h.engine.wait(run.runId)
    expect(final.status).toBe('partial')
    expect(final.tools[0].result).toMatchObject({ kind: 'error', code: 'invalid-tool-arguments' })
    expect(execute).not.toHaveBeenCalled(); expect(h.edits.list(h.session.documentId)).toEqual([])
    expect(h.session.read()).toMatchObject({ undoDepth: 0, model: { source: '前文 OLD 后文' } })
  })

  it('does not reopen a completed run when Stop races its final journal flush', async () => {
    const provider: ModelProvider = { async *stream(request) { yield complete(request) } }
    const h = await fixture(provider), entered = deferred(), release = deferred(), stop = h.gateway.stop.bind(h.gateway)
    const barrier = vi.spyOn(h.gateway, 'stop').mockImplementation(async runId => { await stop(runId); entered.resolve(); await release.promise })
    const run = await h.engine.start(h.input); await entered.promise
    expect(await h.engine.read(run.runId)).toMatchObject({ status: 'completed' })
    const stopped = h.engine.stop(run.runId)
    release.resolve()
    expect(await stopped).toMatchObject({ status: 'completed' })
    expect(await h.runs.read(run.runId)).toMatchObject({ status: 'completed' })
    expect(barrier).toHaveBeenCalledTimes(1)
    expect(await h.engine.recover()).toEqual([])
  })
  it('M04 readonly selection handles stay readonly under a whole-document grant and M09 terminal events recover idempotently', async () => {
    let h!: Awaited<ReturnType<typeof fixture>>, requests = 0
    const provider: ModelProvider = { async *stream(request) {
      if (++requests === 1) {
        const refs = JSON.parse(String(request.messages[1].content).split('：')[1])
        yield complete(request, [{ id: 'readonly-attempt', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[0].selection[0].target, content: '不准写入' }) }])
      } else yield complete(request)
    } }
    h = await fixture(provider)
    h.input.documents[0].writable = [{ kind: 'document' }]
    h.input.documents[0].selection = [{ kind: 'markdown-range', from: 3, to: 6 }]
    const run = await h.engine.start(h.input), final = await h.engine.wait(run.runId)
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
    expect(final.tools[0].result).toMatchObject({ kind: 'error', code: 'not-authorized' })
    await h.engine.recover(); await h.engine.recover()
    const page = await h.events.readPage({ conversationId: 'conversation' })
    expect(page.events.filter(value => value.type === 'run.end')).toHaveLength(1)
    expect(page.events.some(value => value.type === 'run.state' && value.data.status === 'running')).toBe(true)
    expect(page.events.some(value => value.type === 'tool' && value.update === 'append' && value.data.status === 'running' && value.data.input === undefined)).toBe(true)
    expect(page.events.every(value => value.type !== 'tool' || value.data.input === undefined)).toBe(true)
    expect(page.events.some(value => value.type === 'tool' && value.data.output?.includes('not-authorized'))).toBe(true)
    expect(page.events.filter(value => value.type === 'document.commit')).toHaveLength(0)
  })

})


it('M26 one ordinary generation retry retains unknown usage and fragments but never repeats old tools or joins half-arguments', async () => {
  let requests = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    const target = refsOf(request)[0]!.writable[0]!.target
    if (requests === 1) { yield complete(request, [{ id: 'once-read', name: 'read', argumentsText: JSON.stringify({ target }) }]); return }
    if (requests === 2) {
      yield { requestId: request.requestId, sequence: 1, type: 'text.delta', text: '中断片段' }
      yield { requestId: request.requestId, sequence: 2, type: 'tool.delta', index: 0, id: 'unfinished', name: 'text.replace', argumentsDelta: `{"target":${JSON.stringify(target)},"content":"BROKEN` }
      yield { requestId: request.requestId, sequence: 3, type: 'usage.reported', usage: { inputTokens: 7, outputTokens: 3, raw: { prompt_tokens: 7, completion_tokens: 3 } } }
      yield { requestId: request.requestId, sequence: 4, type: 'response.failed', failure: { outcome: 'unknown', kind: 'transport', code: 'socket-lost', message: '已发送但未完整返回' } }
      return
    }
    expect(JSON.stringify(request.messages)).not.toContain('BROKEN')
    expect(JSON.stringify(request.messages)).not.toContain('中断片段')
    if (requests === 3) { yield complete(request, [{ id: 'once-write', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'NEW' }) }]); return }
    yield complete(request)
  } }
  const h = await fixture(provider), abort = vi.spyOn(h.edits, 'abort')
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.requests.map(request => request.state)).toEqual(['completed', 'failed', 'completed', 'completed'])
  expect(final.requests[1]!.failure?.outcome).toBe('unknown')
  expect(final.requests[1]!.argumentDrafts).toEqual([{ state: 'incomplete-prefix', providerCallId: 'unfinished',
    toolName: 'text.replace', argumentsText: expect.stringContaining('"content":"BROKEN') }])
  expect(final.requests.filter(request => request.state === 'completed').every(request => !request.argumentDrafts)).toBe(true)
  expect(new Set(final.requests.map(request => request.requestId)).size).toBe(4)
  expect(final.tools.map(tool => tool.call.name)).toEqual(['read', 'text.replace'])
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 NEW 后文' } })
  expect(abort).toHaveBeenCalled()
  const events = await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })
  expect(events.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'usage', itemId: `${final.requests[1]!.requestId}:usage`, data: expect.objectContaining({ usage: { inputTokens: 7, outputTokens: 3 } }) })]))
  expect(final.requests[1]!.requestId.split('.attempt-')[0]).toBe(final.requests[2]!.requestId.split('.attempt-')[0])
  expect(final.requests[2]!.requestId.endsWith('.attempt-2')).toBe(true)
}, 15_000)

it('preserves incomplete project arguments locally without executing or replaying them', async () => {
  const prefix = '{"project":"observed-target","path":"pages/01.html","content":"<article>未完成'
  let requests = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    yield { requestId: request.requestId, sequence: 1, type: 'tool.delta', index: 0, id: 'unfinished-project', name: 'project.apply', argumentsDelta: prefix.slice(0, 50) }
    yield { requestId: request.requestId, sequence: 2, type: 'tool.delta', index: 0, id: 'unfinished-project', name: 'project.apply', argumentsDelta: prefix.slice(50) }
    yield { requestId: request.requestId, sequence: 3, type: 'response.failed', failure: { outcome: 'unknown', kind: 'server', code: 'chatgpt-provider-response-incomplete', message: 'provider incomplete' } }
  } }
  const h = await fixture(provider), execute = vi.spyOn(h.gateway, 'execute')
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.requests[0]!.argumentDrafts).toEqual([{ state: 'incomplete-prefix', providerCallId: 'unfinished-project', toolName: 'project.apply', argumentsText: prefix }])
  expect(final.requests[0]!.failure?.outcome).toBe('unknown')
  expect(final.tools).toEqual([])
  expect(JSON.stringify(final.messages)).not.toContain(prefix)
  expect(JSON.stringify(final.messages)).not.toContain('<article>未完成')
  expect(execute).not.toHaveBeenCalled()
  expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
  await h.engine.recover(started.runId)
  expect(requests).toBe(1)
  expect((await h.runs.read(started.runId))!.requests[0]!.argumentDrafts?.[0]!.argumentsText).toBe(prefix)
})

it('continues once after a completed empty final while retaining native history, usage and the single prior write', async () => {
  let requests = 0
  const emptyNative = { role: 'assistant' as const, content: '', reasoning_content: '准备继续处理当前工程', reasoning_signature: 'native-signature' }
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    if (requests === 1) {
      const target = refsOf(request)[0]!.writable[0]!.target
      yield complete(request, [{ id: 'write-once', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'NEW' }) }], '')
    } else if (requests === 2) {
      yield { ...complete(request, [], ''), assistant: emptyNative, usage: { inputTokens: 12, outputTokens: 7, raw: { prompt_tokens: 12, completion_tokens: 7 } } }
    } else {
      expect(request.messages).toContainEqual(emptyNative)
      expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(1)
      yield complete(request, [], '修改已经完成。')
    }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(requests).toBe(3)
  expect(final.requests.map(request => request.state)).toEqual(['completed', 'completed', 'completed'])
  expect(final.requests[1]).toMatchObject({ finishReason: 'stop', inputTokens: 12, outputTokens: 7 })
  expect(final.requests[1]).not.toHaveProperty('failure')
  expect(final.messages[final.requests[1]!.assistantMessageIndex!]).toEqual(emptyNative)
  expect(final.tools.map(tool => tool.call.name)).toEqual(['text.replace'])
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 NEW 后文' } })
}, 10_000)

it.each([undefined, 'pure-generation'] as const)('ends repeated empty finals clearly for retry safety %s without inventing request uncertainty', async retrySafety => {
  let requests = 0
  const provider: ModelProvider = { retrySafety, async *stream(request) {
    requests++
    yield { ...complete(request, [], ''), assistant: { role: 'assistant', content: '', reasoning_content: '只返回了思考' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('failed')
  expect(final.failure?.code).toBe('model-empty-final')
  expect(requests).toBe(retrySafety ? 2 : 1)
  expect(final.requests.every(request => request.state === 'completed' && !request.failure)).toBe(true)
  expect(final.tools).toEqual([])
  expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0 })
}, 10_000)

it('stops the completed-empty-final wait without sending a replacement generation', async () => {
  let requests = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    yield { ...complete(request, [], ''), assistant: { role: 'assistant', content: '', reasoning_content: '思考记录保留' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input)
  await vi.waitFor(async () => expect((await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })).events.some(event => event.data.label === '空回复，正在继续')).toBe(true))
  await h.engine.stop(started.runId)
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('stopped')
  expect(requests).toBe(1)
  expect(final.requests[0]).toMatchObject({ state: 'completed', finishReason: 'stop' })
  expect(final.requests[0]).not.toHaveProperty('failure')
})

it('applies accepted steering before ending repeated empty finals at the job-settlement boundary', async () => {
  let requests = 0, paused = false
  const entered = deferred(), release = deferred()
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    if (requests <= 2) yield complete(request, [], '')
    else {
      expect(request.messages).toContainEqual({ role: 'user', content: '按当前结果说明剩余事项' })
      yield complete(request, [], '当前剩余事项已经说明。')
    }
  } }
  const h = await fixture(provider)
  const engineBoundary = h.engine as unknown as { waitForRunningJobs(...args: unknown[]): Promise<boolean> }
  const originalWait = engineBoundary.waitForRunningJobs.bind(engineBoundary)
  vi.spyOn(engineBoundary, 'waitForRunningJobs').mockImplementation(async (...args) => {
    if (requests === 2 && !paused) { paused = true; entered.resolve(); await release.promise }
    return originalWait(...args)
  })
  const started = await h.engine.start(h.input)
  await entered.promise
  const accepted = await h.engine.steer(started.runId, 'empty-final-adjustment', '按当前结果说明剩余事项')
  expect(accepted.steering?.[0]).toMatchObject({ submissionId: 'empty-final-adjustment' })
  release.resolve()
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(requests).toBe(3)
  expect(final.steering?.[0]?.messageIndex).toBeTypeOf('number')
  expect(final.requests.every(request => request.state === 'completed' && !request.failure)).toBe(true)
}, 10_000)

it('stops both short and long same-task cooldowns without sending a replacement request', async () => {
  let requests = 0, retryAfterMs = 1000
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'rejected', kind: 'rate-limit', code: 'http-429', httpStatus: 429, retryAfterMs, message: '速率限制' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input)
  await vi.waitFor(async () => expect((await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })).events.some(event => event.runId === started.runId && event.data.status === 'retrying' && event.data.phase === 'retry')).toBe(true))
  await h.engine.stop(started.runId)
  expect((await h.engine.wait(started.runId)).status).toBe('stopped')
  expect(requests).toBe(1)
  retryAfterMs = 60_000
  const next = await h.engine.start({ ...h.input, taskId: 'long-wait' })
  await vi.waitFor(async () => expect((await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })).events.some(event => event.runId === next.runId && event.data.status === 'retrying' && event.data.phase === 'retry')).toBe(true))
  expect((await h.engine.read(next.runId))?.status).toBe('running')
  await h.engine.stop(next.runId)
  const waiting = await h.engine.wait(next.runId)
  expect(waiting.status).toBe('stopped')
  expect(waiting.requests).toHaveLength(1)
  expect(waiting.requests[0]!.failure).toMatchObject({ kind: 'rate-limit', retryAfterMs: 60_000 })
  expect(requests).toBe(2)
  expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
  expect(h.edits.list(h.session.documentId)).toEqual([])
  expect((await h.events.snapshot(h.input.conversationId)).items.filter(item => item.type === 'document.commit')).toEqual([])
})

it('M26 ordinary transport retry waits on the real bounded schedule and records every unknown outcome', async () => {
  let count = 0
  const arrivals = Array.from({ length: 6 }, () => deferred()), delays: number[] = []
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    arrivals[count++]!.resolve()
    yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'unknown', kind: 'server', httpStatus: 503, code: 'http-503', message: '临时不可用' } }
  } }
  const h = await fixture(provider), realTimeout = globalThis.setTimeout
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const fakeTimeout = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, milliseconds?: number, ...args: any[]) => {
    delays.push(milliseconds ?? 0); return fakeTimeout(callback, milliseconds, ...args)
  }) as typeof setTimeout)
  try {
    const started = await h.engine.start(h.input), result = h.engine.wait(started.runId)
    const schedule = [1000, 5000, 10000, 30000, 60000]
    for (const [index, delay] of schedule.entries()) {
      await arrivals[index]!.promise
      for (let spins = 0; vi.getTimerCount() === 0 && spins < 1000; spins++) await new Promise(resolve => realTimeout(resolve, 2))
      expect(delays[index]).toBe(delay)
      await vi.advanceTimersByTimeAsync(delay - 1); expect(count).toBe(index + 1)
      await vi.advanceTimersByTimeAsync(1)
    }
    await arrivals[5]!.promise
    const final = await result
    expect(count).toBe(6); expect(delays).toEqual(schedule)
    expect(final.status).toBe('failed')
    expect(final.requests).toHaveLength(6)
    expect(new Set(final.requests.map(request => request.requestId)).size).toBe(6)
    expect(final.requests.every(request => request.failure?.outcome === 'unknown')).toBe(true)
    expect(final.tools).toEqual([]); expect(h.session.read().revision).toBe(0)
  } finally { vi.useRealTimers() }
}, 15000)


it('M26 context.read uses an actual stored source, rejects another run, and puts selected images after the full native tool round', async () => {
  let turns = 0, sourceIndex = -1
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII='
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (turns === 1) {
      sourceIndex = request.messages.findIndex(message => Array.isArray(message.content))
      expect(sourceIndex).toBeGreaterThanOrEqual(0)
      const current = (await h.runs.list()).find(run => run.status === 'running')!
      yield complete(request, [
        { id: 'fetch-history', name: 'context.read', argumentsText: JSON.stringify({ sourceId: `run:${current.runId}:${sourceIndex}`, imageIndexes: [0] }) },
        { id: 'read-current', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) },
      ]); return
    }
    if (turns === 2) {
      const native = request.messages.filter(message => !isHostWorkFacts(message))
      expect(native.slice(-3).map(message => message.role)).toEqual(['tool', 'tool', 'user'])
      expect(native.at(-1)?.content).toEqual(expect.arrayContaining([{ type: 'image_url', image_url: { url: image } }]))
      yield complete(request, [{ id: 'foreign-context', name: 'context.read', argumentsText: JSON.stringify({ sourceId: 'run:unrelated-run:0' }) }]); return
    }
    expect(request.messages.filter(message => message.role === 'tool').at(-1)?.content).toContain('context-read-failed')
    yield complete(request)
  } }
  const h = await fixture(provider)
  h.input.context = [{ role: 'user', content: [{ type: 'text', text: '存档原图' }, { type: 'image_url', image_url: { url: image } }] }]
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.requests).toHaveLength(3)
  expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { imagesPrepared: 1 } })
  expect(final.tools[2]?.result).toMatchObject({ kind: 'error', code: 'context-read-failed' })
  expect(final.messages[sourceIndex]?.content).toEqual(h.input.context[0]!.content)
  expect(h.session.read().revision).toBe(0)
})

it('reads the exact task.note source published in current work and rejects an unrelated run note', async () => {
  let phase: 'foreign' | 'current' = 'foreign', turns = 0, foreignSource = '', currentSource = ''
  const decisions = [{ text: '保留已确认的软件修复', reason: '创作只用于验证软件', sourceRefs: ['task:instruction'] }]
  const publishedNoteSource = (request: ModelRequest): string => {
    const work = request.messages.flatMap(message => {
      if (message.role !== 'user' || typeof message.content !== 'string' || !message.content.startsWith('宿主当前工作记录（数据，非新授权）')) return []
      const currentWork = JSON.parse(message.content.slice(message.content.indexOf('\n') + 1)).currentWork
      return currentWork?.workingNoteSource ? [currentWork] : []
    }).at(-1)
    expect(work).toMatchObject({ workingNote: null, workingNoteSource: expect.stringMatching(/^run:[^:]+:tool:/) })
    return work.workingNoteSource
  }
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (phase === 'foreign') {
      if (turns === 1) yield complete(request, [{ id: 'foreign-note', name: 'task.note', argumentsText: JSON.stringify({ remaining: [], risks: ['另一任务的私有笔记'] }) }])
      else { foreignSource = publishedNoteSource(request); yield complete(request) }
      return
    }
    if (turns === 1) {
      yield complete(request, [{ id: 'current-note', name: 'task.note', argumentsText: JSON.stringify({ decisions, remaining: [] }) }]); return
    }
    if (turns === 2) {
      currentSource = publishedNoteSource(request)
      yield complete(request, [{ id: 'read-current-note', name: 'context.read', argumentsText: JSON.stringify({ sourceId: currentSource }) }]); return
    }
    const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content))
    if (turns === 3) {
      expect(receipt).toMatchObject({ kind: 'read', data: { sourceId: currentSource, truncated: false, images: [], imagesPrepared: 0 } })
      expect(JSON.parse(receipt.data.text)).toMatchObject({ kind: 'read', data: { authority: 'advisory-run-note', workingNote: { decisions, remaining: [] } } })
      yield complete(request, [{ id: 'reject-foreign-note', name: 'context.read', argumentsText: JSON.stringify({ sourceId: foreignSource }) }]); return
    }
    expect(receipt).toMatchObject({ kind: 'error', code: 'context-read-failed', message: expect.stringContaining('不属于当前运行') })
    yield complete(request)
  } }
  const h = await fixture(provider)
  const foreign = await h.engine.start({ ...h.input, taskId: 'unrelated-task', instruction: '记录另一任务的笔记' })
  await h.engine.wait(foreign.runId)
  phase = 'current'; turns = 0
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(currentSource).toContain(`run:${started.runId}:tool:`)
  expect(foreignSource).toContain(`run:${foreign.runId}:tool:`)
  expect(final.tools.map(tool => tool.call.name)).toEqual(['task.note', 'context.read', 'context.read'])
  const noteRead = final.tools[1]!.result as { kind: 'read'; data: { text: string } }
  expect(JSON.parse(noteRead.data.text).data.workingNote).toEqual(final.workingNote)
  expect(final.tools[2]?.result).toMatchObject({ kind: 'error', code: 'context-read-failed' })
  expect(h.session.read().revision).toBe(0)
})

describe('collaboration safe-boundary scheduling', () => {
  async function withSender(stream: ModelProvider['stream'], executionOptions: Pick<ExecutionEngineOptions, 'programmatic' | 'setAdvancementMode'> = {}) {
    const senderRelease = deferred(), senderInstruction = 'fixture collaboration sender stays active'
    const h = await fixture({ async *stream(request, options) {
      if (request.messages.some(message => message.role === 'user' && message.content === senderInstruction)) {
        await senderRelease.promise; yield complete(request); return
      }
      yield* stream(request, options)
    } }, false, executionOptions)
    cleanup.push(async () => { senderRelease.resolve(); await h.engine.shutdown() })
    const sender = await h.engine.start({ ...h.input, conversationId: 'sender-conversation', taskId: 'sender-task',
      instruction: senderInstruction, documents: [] })
    return { ...h, senderRunId: sender.runId }
  }
  const notices = (request: ModelRequest) => request.messages.filter(message => message.role === 'user'
    && typeof message.content === 'string' && message.content.startsWith('协作消息（'))

  it.each(['message', 'steer'] as const)('distinguishes %s before the adapter produces its original tool round', async action => {
    const entered = deferred(), release = deferred()
    let turns = 0, pausedBeforeDispatch = false
    const h = await withSender(async function* (request) {
      if (++turns === 1) {
        const target = refsOf(request)[0]!.writable[0]!.target, args = JSON.stringify({ target, content: 'NEW' })
        if (action === 'message') {
          yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'original-write', name: 'text.replace', argumentsDelta: args.slice(0, -3) }
          entered.resolve(); await release.promise
        }
        yield complete(request, [
          { id: 'original-write', name: 'text.replace', argumentsText: args },
          { id: 'original-read', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) },
        ]); return
      }
      expect(h.session.read().revision).toBe(action === 'message' ? 1 : 0)
      expect(notices(request)).toHaveLength(action === 'message' ? 2 : 0)
      if (action === 'steer') expect(request.messages).toContainEqual({ role: 'user', content: '只报告，不改原文' })
      yield complete(request)
    })
    cleanup.push(async () => { release.resolve() })
    const abortPreview = vi.spyOn(h.edits, 'abort'), execute = vi.spyOn(h.gateway, 'execute')
    // Pause after the prepared request is durable, before dispatch. A human adjustment
    // here has not entered its payload, so it must still invalidate the old calls.
    if (action === 'steer') {
      const save = h.runs.save.bind(h.runs)
      vi.spyOn(h.runs, 'save').mockImplementation(async record => {
        await save(record)
        if (!pausedBeforeDispatch && record.input.taskId === h.input.taskId && record.requests.length === 1 && record.requests[0]!.state === 'sending') {
          pausedBeforeDispatch = true; entered.resolve(); await release.promise
        }
      })
    }
    const started = await h.engine.start(h.input)
    await entered.promise
    if (action === 'message') {
      expect(h.edits.list(h.session.documentId)).toHaveLength(1)
      await h.engine.message(started.runId, 'notice-1', { senderRunId: h.senderRunId, text: '另一场景已准备好' })
      await h.engine.message(started.runId, 'notice-2', { senderRunId: h.senderRunId, text: '素材回执已返回' })
      expect(abortPreview).not.toHaveBeenCalled()
    } else {
      expect(turns).toBe(0)
      const accepted = await h.engine.steer(started.runId, 'human-before-dispatch', '只报告，不改原文')
      expect(accepted.steering?.at(-1)?.messageIndex).toBeUndefined()
    }
    release.resolve()
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.failure).toBeUndefined()
    expect(final.requests).toHaveLength(2); expect(turns).toBe(2)
    expect(final.tools.map(tool => tool.call.name)).toEqual(['text.replace', 'read'])
    expect(final.tools.every(tool => tool.notInvokedReason === (action === 'steer' ? 'steering' : undefined))).toBe(true)
    expect(execute.mock.calls.map(call => call[2].name)).toEqual(action === 'message' ? ['text.replace', 'read'] : [])
    expect(h.session.read()).toMatchObject({ revision: action === 'message' ? 1 : 0,
      model: { source: action === 'message' ? '前文 NEW 后文' : '前文 OLD 后文' } })
    const applied = final.steering?.filter(value => value.senderRunId) ?? []
    expect(applied).toHaveLength(action === 'message' ? 2 : 0)
    expect(applied.every(value => value.messageIndex! > final.messages.findIndex(message => message.role === 'tool' && message.tool_call_id === 'original-read'))).toBe(true)
  })

  it.each(['message', 'steer'] as const)('distinguishes %s between real programmatic child calls', async action => {
    const entered = deferred(), release = deferred()
    let turns = 0, target = '', scripts = 0
    const h = await withSender(async function* (request) {
      if (++turns === 1) {
        target = refsOf(request)[0]!.writable[0]!.target
        yield complete(request, [{ id: 'one-script', name: 'programmatic.execute', argumentsText: '{"code":"read then edit through the canonical writer"}' }]); return
      }
      expect(notices(request)).toHaveLength(action === 'message' ? 1 : 0)
      expect(request.messages.some(message => message.role === 'tool' && String(message.tool_call_id).includes(':ptc:'))).toBe(false)
      expect(h.session.read().revision).toBe(action === 'message' ? 1 : 0)
      if (action === 'steer') expect(request.messages.some(message => message.role === 'user' && String(message.content).includes('只报告，不改原文'))).toBe(true)
      yield complete(request)
    }, { programmatic: new ProgrammaticToolRunner({ execute: async input => {
      scripts++
      await input.call('read', { target })
      entered.resolve(); await release.promise
      await input.call('text.replace', { target, content: 'NEW' })
      return { status: 'completed', value: 'one original script' }
    } }) })
    cleanup.push(async () => { release.resolve() })
    const execute = vi.spyOn(h.gateway, 'execute'), started = await h.engine.start(h.input)
    await entered.promise
    expect((await h.engine.read(started.runId))?.tools.find(tool => tool.call.name === 'read')?.state).toBe('returned')
    if (action === 'message') await h.engine.message(started.runId, 'child-boundary-notice', { senderRunId: h.senderRunId, text: '独立素材已准备好' })
    else await h.engine.steer(started.runId, 'child-boundary-human', '只报告，不改原文')
    expect((await h.engine.read(started.runId))?.steering?.at(-1)?.messageIndex).toBeUndefined()
    release.resolve()
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.failure).toBeUndefined()
    expect(final.requests).toHaveLength(2); expect(turns).toBe(2); expect(scripts).toBe(1)
    expect(final.tools.map(tool => tool.call.name)).toEqual(['programmatic.execute', 'read', 'text.replace'])
    expect(final.tools.at(-1)).toMatchObject({ origin: 'host', state: 'returned',
      ...(action === 'steer' ? { notInvokedReason: 'steering', result: { kind: 'read', data: { status: 'not-started' } } }
        : { result: { kind: 'document-operation', result: { status: 'applied' } } }) })
    expect(final.tools[0].result).toMatchObject(action === 'steer'
      ? { kind: 'error', code: 'programmatic-cancelled', data: { status: 'cancelled' } }
      : { kind: 'read', data: { status: 'completed' } })
    expect(final.steering?.at(-1)?.messageIndex).toBeTypeOf('number')
    expect(execute.mock.calls.map(call => call[2].name)).toEqual(action === 'message' ? ['read', 'text.replace'] : ['read'])
    expect(h.session.read()).toMatchObject({ revision: action === 'message' ? 1 : 0, undoDepth: action === 'message' ? 1 : 0,
      model: { source: action === 'message' ? '前文 NEW 后文' : '前文 OLD 后文' } })
  })

  it('keeps a real question open when collaboration arrives before and after it is established', async () => {
    const preparing = deferred(), release = deferred(), waiting = deferred()
    let turns = 0, questionId = ''
    const h = await withSender(async function* (request) {
      if (++turns === 1) {
        yield complete(request, [{ id: 'real-question', name: 'ask_user', argumentsText: JSON.stringify({ question: '保留当前稿吗？', responseKind: 'confirm',
          options: [{ label: '保留' }], currentDraft: [{ target: refsOf(request)[0]!.writable[0]!.target }] }) }]); return
      }
      expect(notices(request)).toHaveLength(2)
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content))
      expect(receipt).toMatchObject({ kind: 'read', data: { status: 'answered', selected: [{ index: 0, label: '保留' }] } })
      yield complete(request)
    })
    cleanup.push(async () => { release.resolve() })
    const prepare = h.gateway.prepareQuestionDraft.bind(h.gateway)
    vi.spyOn(h.gateway, 'prepareQuestionDraft').mockImplementationOnce(async (...args) => {
      const draft = await prepare(...args)
      preparing.resolve(); await release.promise
      return draft
    })
    h.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'waiting') { questionId = event.itemId; waiting.resolve() } })
    const started = await h.engine.start(h.input)
    await preparing.promise
    await h.engine.message(started.runId, 'before-question', { senderRunId: h.senderRunId, text: '素材已备好，等待真实选择' })
    release.resolve(); await waiting.promise
    await h.engine.message(started.runId, 'during-question', { senderRunId: h.senderRunId, text: '另一个素材也已备好' })
    expect(turns).toBe(1)
    const current = await h.engine.read(started.runId)
    expect(current?.tools.find(tool => tool.call.name === 'ask_user')).toMatchObject({ state: 'executing' })
    expect(current?.steering?.every(value => value.messageIndex === undefined)).toBe(true)
    const snapshot = h.session.read()
    await h.engine.answer({ runId: started.runId, callId: questionId, answer: { choices: [0] },
      currentDraft: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision }] })
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(final.requests).toHaveLength(2)
    expect(h.session.read().revision).toBe(0)
  })

  it('retains the human mode preference CAS when collaboration arrives during its persistence', async () => {
    const persisting = deferred(), release = deferred()
    let turns = 0, accepted = false
    const h = await withSender(async function* (request) {
      if (++turns === 1) {
        yield complete(request, [{ id: 'human-mode', name: 'task.setMode', argumentsText: '{"advancementMode":"automatic","sourceRef":"task:instruction"}' }]); return
      }
      expect(notices(request)).toHaveLength(1)
      expect(JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content)))
        .toMatchObject({ kind: 'read', data: { status: 'accepted', advancementMode: 'automatic' } })
      yield complete(request)
    }, { setAdvancementMode: async (_conversationId, mode, isCurrent) => {
      expect(mode).toBe('automatic'); expect(isCurrent?.()).toBe(true)
      persisting.resolve(); await release.promise
      accepted = isCurrent?.() === true
    } })
    cleanup.push(async () => { release.resolve() })
    const started = await h.engine.start({ ...h.input, instruction: '按自动方式完成本次任务' })
    await persisting.promise
    await h.engine.message(started.runId, 'during-mode-persistence', { senderRunId: h.senderRunId, text: '素材已备好，不改变用户推进偏好' })
    release.resolve()
    const final = await h.engine.wait(started.runId)
    expect(accepted).toBe(true)
    expect(final.status).toBe('completed'); expect(final.requests).toHaveLength(2)
    expect(final.steering?.filter(value => !value.senderRunId).at(-1)?.advancementMode).toBe('automatic')
    expect(h.session.read().revision).toBe(0)
  })
})

describe('PTC model value handoff', () => {
  it('publishes a large value source through the real Engine and reads it in the current run and same-task continuation', async () => {
    const body = '0123456789abcdef'.repeat(65536)
    let phase = 0, turns = 0, source: { runId: string; callId: string; path: string[] } | undefined
    const provider: ModelProvider = { async *stream(request) {
      turns++
      if (phase === 0 && turns === 1) {
        yield complete(request, [{ id: 'large-value', name: 'programmatic.execute', argumentsText: '{"code":"fixture returns the original large value"}' }]); return
      }
      if (phase === 0 && turns === 2) {
        const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content))
        expect(receipt.data).not.toHaveProperty('value')
        source = receipt.data.valueRead.input
      }
      if (phase === 1 && turns === 1 || phase === 0 && turns === 2) {
        yield complete(request, [{ id: 'exact-value-page', name: 'programmatic.read', argumentsText: JSON.stringify({ ...source,
          path: [...source!.path, 'body'], offset: 101, limit: 73 }) }]); return
      }
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content))
      expect(receipt).toMatchObject({ kind: 'read', data: { runId: source!.runId, callId: source!.callId,
        value: body.slice(101, 174), offset: 101, total: body.length, nextOffset: 174 } })
      yield complete(request)
    } }
    const h = await fixture(provider, false, { programmatic: new ProgrammaticToolRunner({ execute: async () => ({ status: 'completed', value: { body } }) }) })
    h.input.selection = { ...selection, contextWindow: 128000 }; h.input.workspaceRoot = h.directory
    const first = await h.engine.start(h.input), original = await h.engine.wait(first.runId)
    expect(original.failure).toBeUndefined(); expect(turns).toBe(3)
    expect((original.tools[0]!.result as any).data.value.body).toBe(body)
    phase = 1; turns = 0
    const next = await h.engine.resume(first.runId, { ...h.input, taskId: 'exact-old-value' }), continued = await h.engine.wait(next.runId)
    expect(continued.failure).toBeUndefined(); expect(turns).toBe(2)
    expect(continued.taskContinuedFrom).toBe(first.runId)
    expect(continued.tools.map(tool => tool.call.name)).toEqual(['programmatic.read'])
    expect(h.session.read().revision).toBe(0)
  })

  it('prepares the frozen partial continuation within its model window and authorizes an exact old-run value page without replay', async () => {
    let turns = 0, preparedBytes = 0, preparedTokens = 0
    let archived: any, parent: any, body: string
    const provider: ModelProvider = { async *stream(request) {
      turns++
      const serialized = serializeModelPayload(request)
      preparedBytes = Math.max(preparedBytes, Buffer.byteLength(serialized))
      preparedTokens = Math.max(preparedTokens, estimateSerializedTokens(serialized))
      expect(estimateSerializedTokens(serialized)).toBeLessThan(modelContextBudget(request.selection).inputTokens)
      if (turns === 1) {
        expect(JSON.stringify(request.messages)).toContain('显式继续先前运行')
        const applied = archived.tools.findLast((tool: any) => tool.call.name === 'project.apply')
        if (applied) {
          const continuation = request.messages.find(message => message.role === 'system'
            && typeof message.content === 'string' && message.content.startsWith('显式继续先前运行'))!
          const facts = JSON.parse(String(continuation.content).split('不是权限：')[1]!)
          expect(facts.completed.find((fact: any) => fact.callId === applied.callId)).toMatchObject({ name: 'project.apply', result: {
            kind: 'content-apply', commit: 'committed', status: 'applied', revision: 10,
            operationId: applied.result.data.receipt.operationId, diagnostics: applied.result.data.diagnostics,
          } })
        }
        yield complete(request, [{ id: 'read-original-value', name: 'programmatic.read', argumentsText: JSON.stringify({ runId: archived.runId,
          callId: parent.callId, path: ['data', 'value', 'data', 'operations', 0, 'data', 'input', 'source', 'html'], offset: 211, limit: 61 }) }]); return
      }
      const read = request.messages.filter(message => message.role === 'tool' && message.tool_call_id === 'read-original-value').at(-1)
      expect(JSON.parse(String(read?.content))).toMatchObject({ kind: 'read', data: { value: body.slice(211, 272), offset: 211, total: body.length } })
      yield complete(request)
    } }
    const h = await fixture(provider)
    const frozen = process.env.PTC_FROZEN_RUN_PATH
    const lineage = new Map<string, any>()
    if (frozen) {
      archived = JSON.parse(await fs.readFile(frozen, 'utf8'))
      let current = archived
      while (current) {
        lineage.set(current.runId, current)
        const prior = current.continuedFrom
        current = prior ? JSON.parse(await fs.readFile(path.join(path.dirname(frozen), `${createHash('sha256').update(prior).digest('hex')}.json`), 'utf8')) : null
      }
      parent = archived.tools.findLast((tool: any) => tool.call.name === 'programmatic.execute')
      expect(JSON.stringify(parent.result).length).toBeGreaterThan(30_000_000)
      expect(archived.status).toBe('partial')
    } else {
      body = 'source audio data '.repeat(1000)
      const operation = { kind: 'read', data: { input: { source: { html: body } } } }
      parent = { callId: 'archived-parent', providerCallId: 'archived-parent', requestId: 'old-request', state: 'returned',
        call: { name: 'programmatic.execute', input: {} }, result: { kind: 'read', data: { status: 'completed', atomic: false,
          read: { runId: 'archived-run', callId: 'archived-parent' }, children: [], failures: [], value: { kind: 'read', data: { operations: [operation] } } } } }
      archived = { schemaVersion: 1, runId: 'archived-run', version: 1, status: 'partial', createdAt: 1, updatedAt: 2,
        input: { ...h.input, taskId: 'old-task', workspaceRoot: h.directory, selection: { ...selection, contextWindow: 128000 } },
        messages: [{ role: 'user', content: '原调用尚未发起；继续前重新观察' }], initialMessageCount: 1, requests: [], tools: [parent] }
      lineage.set(archived.runId, archived)
    }
    body = parent.result.data.value.data.operations[0].data.input.source.html
    const stored = h.runs.read.bind(h.runs)
    vi.spyOn(h.runs, 'read').mockImplementation(async runId => lineage.has(runId) ? structuredClone(lineage.get(runId)) : stored(runId))
    const execute = vi.spyOn(h.gateway, 'execute')
    const continued = await h.engine.resume(archived.runId, { ...archived.input, taskId: randomUUID() })
    const ended = await h.engine.wait(continued.runId)
    expect(ended.taskContinuedFrom).toBe(archived.runId)
    expect(ended.failure?.message ?? '').not.toContain('超过模型可用窗口')
    expect(ended.tools.map(tool => tool.call.name), JSON.stringify({ status: ended.status, failure: ended.failure, turns, preparedBytes, preparedTokens })).toEqual(['programmatic.read'])
    expect(execute.mock.calls.some(call => call[2].name === 'project.apply' || call[2].name === 'view.click')).toBe(false)
    expect(JSON.stringify(parent.result).length).toBeGreaterThan(8000)
    if (frozen) console.info('PTC_FROZEN_CONTINUATION', JSON.stringify({ sourceRunId: archived.runId, sameTask: ended.taskContinuedFrom === archived.runId,
      preparedBytes, preparedTokens, inputLimit: modelContextBudget(archived.input.selection).inputTokens, exactReadChars: 61, originalRawRetained: true }))
  }, 30000)
})


it('aligns OAuth streamed edits and multiple tools after reasoning and message items with their final calls', async () => {
  let turns = 0
  const transport: typeof fetch = async (_url, init) => {
    const wire = JSON.parse(String(init?.body))
    const responseId = `oauth-${++turns}`
    if (turns > 1) {
      const outputs = wire.input.filter((item: { type: string }) => item.type === 'function_call_output')
      expect(outputs).toHaveLength(3)
      expect(outputs.map((item: { call_id: string }) => item.call_id)).toEqual(['edit', 'inspect', 'read'])
      expect(outputs.every((item: { output: string }) => JSON.parse(item.output).kind !== 'error')).toBe(true)
      return new Response(chunk({ type: 'response.completed', response: { id: responseId, status: 'completed', output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
      ] } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    const refs = JSON.parse(wire.instructions.split('本次固定文档与权限（切换界面不改变它们）：')[1].split('\n')[0])
    const calls = [
      { id: 'edit', name: 'text.replace', args: { target: refs[0].writable[0].target, content: 'NEW' } },
      { id: 'inspect', name: 'inspect', args: { target: refs[0].target } },
      { id: 'read', name: 'read', args: { target: refs[0].target } },
    ]
    const output: ModelJsonObject[] = [{ type: 'reasoning', id: 'reason', encrypted_content: 'opaque' }]
    let packets = chunk({ type: 'response.created', response: { id: responseId } })
    for (const [ordinal, call] of calls.entries()) {
      if (ordinal === 1) output.push({ type: 'message', role: 'assistant', content: [] })
      const index = output.length, args = JSON.stringify(call.args), name = modelToolWireName(call.name)
      packets += chunk({ type: 'response.output_item.added', output_index: index,
        item: { type: 'function_call', id: `item-${call.id}`, call_id: call.id, name } })
      if (ordinal !== 1) packets += chunk({ type: 'response.function_call_arguments.delta', output_index: index, delta: args })
      packets += chunk({ type: 'response.function_call_arguments.done', output_index: index, arguments: args })
      output.push({ type: 'function_call', id: `item-${call.id}`, call_id: call.id, name, arguments: args, status: 'completed' })
    }
    packets += chunk({ type: 'response.completed', response: { id: responseId, status: 'completed', output } })
    return new Response(packets, { headers: { 'content-type': 'text/event-stream' } })
  }
  const provider = new ChatGPTResponsesProvider({ fetch: transport,
    credentialResolver: async () => ({ accessToken: 'fixture-only', accountId: 'fixture-account' }) })
  const h = await fixture(provider)
  const oauth = { ...selection, connection: { ...selection.connection, provider: 'openai',
    protocol: 'chatgpt-responses' as const, baseURL: CHATGPT_RESPONSES_BASE_URL,
    auth: { kind: 'oauth' as const, credentialRef: 'fixture-only' } } }
  const engine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, edits: h.edits,
    runs: h.runs, events: h.events, provider, serializePayload: serializeChatGPTResponsesRequest })
  const started = await engine.start({ ...h.input, selection: oauth }), final = await engine.wait(started.runId)
  expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools, requests: final.requests })).toBe('completed')
  expect(final.tools).toHaveLength(3)
  expect(final.tools.every(tool => tool.result?.kind !== 'error')).toBe(true)
  expect((await h.session.drain()).model).toMatchObject({ source: '前文 NEW 后文' })
  expect(turns).toBe(2)
})

it('archives whole OAuth rounds on actual wire and never resurrects old native payloads in later turns', async () => {
  const wires: string[] = [], requests: ModelRequest[] = []; let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    requests.push(structuredClone(request)); wires.push(serializeChatGPTResponsesRequest(request)); turns++
    if (turns > 4) { yield complete(request); return }
    const call = { id: `call-${turns}`, name: turns % 2 ? 'read' : 'inspect', argumentsText: JSON.stringify({ target: refsOf(request)[0].target }) }
    const event = complete(request, [call], `turn-${turns}`)
    event.assistant.nativeResponses = { protocol: 'chatgpt-responses', responseId: `r-${turns}`, output: [
      { type: 'reasoning', id: `opaque-${turns}`, encrypted_content: `MARKER-${turns}-` + 'x'.repeat(550_000) },
      { type: 'function_call', id: `i-${turns}`, call_id: call.id, name: modelToolWireName(call.name), arguments: call.argumentsText },
    ] }
    event.usage = { inputTokens: 90_000, outputTokens: 10, raw: {} }
    yield event
  } }
  const h = await fixture(provider)
  // Projection archives complete old native rounds before budget compaction is necessary.
  const oauth = { ...selection, contextWindow: 600_000, connection: { ...selection.connection, provider: 'openai', protocol: 'chatgpt-responses' as const,
    baseURL: CHATGPT_RESPONSES_BASE_URL, auth: { kind: 'oauth' as const, credentialRef: 'fixture-only' } } }
  const engine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, edits: h.edits, runs: h.runs,
    events: h.events, provider, serializePayload: serializeChatGPTResponsesRequest })
  const started = await engine.start({ ...h.input, selection: oauth }), final = await engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(wires).toHaveLength(5)
  expect(wires[3]).not.toContain('MARKER-1-')
  expect(wires[4]).not.toContain('MARKER-1-')
  expect(wires[3]).toContain('MARKER-2-' + 'x'.repeat(550_000))
  expect(JSON.stringify(final.messages)).toContain('MARKER-1-' + 'x'.repeat(550_000))
  const archived = requests[3].messages.find(message => typeof message.content === 'string' && message.content.includes('"archivedContext"') && message.content.includes('"call-1"'))!
  expect(archived).toBeDefined()
  const archive = JSON.parse(String(archived.content))
  expect(archive.archivedContext).toMatch(new RegExp(`^run:${started.runId}:\\d+$`))
  expect(archive.calls).toEqual([{ id: 'call-1', name: 'read', resultSourceId: expect.stringMatching(new RegExp(`^run:${started.runId}:\\d+$`)) }])
  expect(JSON.parse(wires[3]).input.filter((item: { type: string }) => item.type === 'function_call').map((item: { call_id: string }) => item.call_id)).toEqual(['call-2', 'call-3'])
  expect(final.requests[0].inputTokens).toBe(90_000)
  for (const wire of wires) {
    const input = JSON.parse(wire).input
    const calls = new Set(input.filter((item: { type: string }) => item.type === 'function_call').map((item: { call_id: string }) => item.call_id))
    for (const result of input.filter((item: { type: string }) => item.type === 'function_call_output')) expect(calls.has(result.call_id)).toBe(true)
  }
})
