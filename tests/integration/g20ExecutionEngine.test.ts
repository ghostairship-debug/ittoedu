// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type RequestListener } from 'node:http'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { estimateSerializedTokens, modelContextBudget } from '../../src/core/execution/modelContextBudget'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { HostArtifactDeliveryService } from '../../src/main/workbench/execution/HostArtifactDeliveryService'
import { runEndSummary } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelJsonObject, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
async function fixture(provider: ModelProvider, withArtifacts = false) {
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
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events, provider, ...(artifacts ? { artifacts } : {}) })
  const session = await registry.create(driver.load(new TextEncoder().encode('前文 OLD 后文')), '未保存.md')
  const other = await registry.create(driver.load(new TextEncoder().encode('另一份文档')), '另一份.md')
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '把局部改成新内容', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }] }] }
  return { directory, journal, registry, gateway, edits, runs, events, engine, session, other, input, driver, artifacts, workspaceRoot }
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
const refsOf = (request: ModelRequest) => JSON.parse(String(request.messages[1].content).split('：')[1]) as {
  documentId: string; target: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string }[]
}[]

describe('G20 canonical model execution loop', () => {
  it('publishes the first display fragment after durable acknowledgement without waiting for the batching interval', async () => {
    const visible: string[] = []
    const provider: ModelProvider = { async *stream(request) {
      yield { requestId: request.requestId, sequence: 1, type: 'text.delta', text: '首片' }
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
    unsubscribe()
    expect(final.status).toBe('completed')
    expect(visible.join('')).toBe('首片尾片')
    const persisted = await h.events.readPage({ conversationId: h.input.conversationId })
    expect(persisted.events.map(event => event.sequence)).toEqual(published)
  })
  it('delivers verified compute bytes through artifact.save in a document-free run', async () => {
    let turns = 0
    const bytes = Buffer.from('owner verified result\n')
    const provider: ModelProvider = { async *stream(request) {
      if (++turns > 1) { yield complete(request); return }
      expect(request.tools?.some(tool => tool.name === 'artifact.save')).toBe(true)
      yield complete(request, [{ id: 'deliver-compute', name: 'artifact.save', argumentsText: JSON.stringify({
        kind: 'compute', job: 'compute-one', name: 'result.txt', destination: 'exports/result.txt',
      }) }])
    } }
    const h = await fixture(provider, true)
    h.input.documents = []
    h.input.workspaceRoot = h.workspaceRoot
    vi.spyOn(h.gateway, 'readComputeArtifact').mockResolvedValue({ artifact: {
      name: 'result.txt', digest: 'owner-digest', byteLength: bytes.length, mimeType: 'text/plain',
    }, bytes })
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed')
    expect(h.gateway.readComputeArtifact).toHaveBeenCalledWith(started.runId, 'compute-one', 'result.txt')
    expect(final.tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'written', sourceKind: 'compute',
      sourceId: 'compute-one@result.txt' } })
    expect(await fs.readFile(path.join(h.workspaceRoot, 'exports', 'result.txt'))).toEqual(bytes)
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
    { failedName: 'read', retry: true, retryOther: false, commit: true },
    { failedName: 'read', retry: false, retryOther: false, commit: true },
    { failedName: 'read', retry: true, retryOther: false, commit: false },
    { failedName: 'read', retry: true, retryOther: true, commit: true },
    { failedName: 'inspect', retry: true, retryOther: false, commit: true },
  ] as const)('keeps $failedName diagnostic history while settling from delivery receipts', async ({ failedName, retry, retryOther, commit }) => {
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
        ...(retry ? [{ id: 'retry-observation', name: failedName, argumentsText: JSON.stringify({ target: retryOther ? refsOf(request)[0]!.target : renewed }) }] : []),
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
    if (commit) expect(final.tools.at(-1)?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.session.read().model).toMatchObject({ source: commit ? '前文 NEW 后文' : '前文 OLD 后文' })
    const timeline = await h.events.snapshot('conversation')
    expect(timeline.items.filter(item => item.type === 'tool')).toHaveLength(2 + Number(retry) + Number(commit))
    const end = timeline.items.find(item => item.type === 'run.end')
    expect(end?.data.status).toBe('completed')
    const publicEnd = await h.events.findEvent('conversation', `${final.runId}:terminal`)
    if (commit) {
      expect(runEndSummary(final)).toBeUndefined()
      expect(publicEnd?.data.status).toBe('completed')
    } else expect(runEndSummary(final)).toBeUndefined() // Corrected read-only exploration is not a missing requested write.
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
    expect(final.status).toBe('partial')
    expect(runEndSummary(final)).toContain('剩余工作未完成')
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
        const name = data.tools.find((tool: any) => tool.function.parameters.properties.content)?.function.name
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
    const started = await h.engine.start(h.input)
    await previewReady.promise
    expect(h.edits.list(h.session.documentId)[0].value).toContain('新的😀内容')
    expect(h.session.read().model).toMatchObject({ source: '前文 OLD 后文' })
    expect(h.session.read().undoDepth).toBe(0)
    continueStream.resolve()
    const final = await h.engine.wait(started.runId)
    expect(final.status).toBe('completed'); expect(requests).toHaveLength(2); expect(executeSpy).toHaveBeenCalledTimes(1)
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
    expect(await h.engine.wait(started.runId)).toMatchObject({ status: 'stopped' })
    expect(h.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '前文 OLD 后文' } })
  })

  it('M15 a run editing a document whose other part another run is previewing commits its own edit without a preview', async () => {
    const aStreaming = deferred(), releaseA = deferred(), turns = new Map<string, number>()
    const provider: ModelProvider = { async *stream(request) {
      const which = String([...request.messages].reverse().find(message => message.role === 'user')?.content)
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
    await expect(h.runs.save({ ...old, version: old.version + 1 })).rejects.toThrow('checkpoint rename interrupted')
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
    expect(final.status).toBe('partial'); expect(requests).toHaveLength(2)
    expect(final.tools.map(tool => tool.state)).toEqual(['returned', 'returned', 'returned'])
    expect(final.tools[0].result?.kind).toBe('read')
    expect(final.tools[1].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(final.tools[2].result).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(final.compacted?.atRequest).toBe(1)
    expect(final.compacted?.facts).toContain('applied'); expect(final.compacted?.facts).toContain('not-authorized')
    expect(requests[1].messages.slice(0, final.initialMessageCount)).toEqual(requests[0].messages)
    expect(refsOf(requests[1])[1].writable).toEqual([])
    const nativeRound = requests[1].messages.slice(final.initialMessageCount + 1)
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
  expect(new Set(final.requests.map(request => request.requestId)).size).toBe(4)
  expect(final.tools.map(tool => tool.call.name)).toEqual(['read', 'text.replace'])
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '前文 NEW 后文' } })
  expect(abort).toHaveBeenCalled()
  const events = await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })
  expect(events.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'usage', itemId: `${final.requests[1]!.requestId}:usage`, data: expect.objectContaining({ usage: { inputTokens: 7, outputTokens: 3 } }) })]))
  expect(final.requests[1]!.requestId.split('.attempt-')[0]).toBe(final.requests[2]!.requestId.split('.attempt-')[0])
  expect(final.requests[2]!.requestId.endsWith('.attempt-2')).toBe(true)
}, 15_000)

it('stops both short and long same-task cooldowns without sending a replacement request', async () => {
  let requests = 0, retryAfterMs = 1000
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    requests++
    yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'rejected', kind: 'rate-limit', code: 'http-429', httpStatus: 429, retryAfterMs, message: '速率限制' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input)
  await vi.waitFor(async () => expect((await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })).events.some(event => event.data.status === 'retrying')).toBe(true))
  await h.engine.stop(started.runId)
  expect((await h.engine.wait(started.runId)).status).toBe('stopped')
  expect(requests).toBe(1)
  retryAfterMs = 60_000
  const next = await h.engine.start({ ...h.input, taskId: 'long-wait' })
  await vi.waitFor(async () => expect((await h.events.readPage({ conversationId: h.input.conversationId, limit: 1000 })).events.some(event => event.runId === next.runId && event.data.label === '等待服务冷却')).toBe(true))
  expect((await h.engine.read(next.runId))?.status).toBe('running')
  await h.engine.stop(next.runId)
  const waiting = await h.engine.wait(next.runId)
  expect(waiting.status).toBe('stopped')
  expect(waiting.requests).toHaveLength(1)
  expect(requests).toBe(2)
})

it('M26 ordinary transport retry stops after exactly three attempts and records all unknown outcomes', async () => {
  let count = 0
  const provider: ModelProvider = { retrySafety: 'pure-generation', async *stream(request) {
    count++
    yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'unknown', kind: 'server', httpStatus: 503, code: 'http-503', message: '临时不可用' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(count).toBe(3)
  expect(final.status).toBe('failed')
  expect(final.requests).toHaveLength(3)
  expect(final.requests.every(request => request.failure?.outcome === 'unknown')).toBe(true)
  expect(final.tools).toEqual([])
  expect(h.session.read().revision).toBe(0)
}, 15_000)


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
      expect(request.messages.slice(-3).map(message => message.role)).toEqual(['tool', 'tool', 'user'])
      expect(request.messages.at(-1)?.content).toEqual(expect.arrayContaining([{ type: 'image_url', image_url: { url: image } }]))
      yield complete(request, [{ id: 'foreign-context', name: 'context.read', argumentsText: JSON.stringify({ sourceId: 'run:unrelated-run:0' }) }]); return
    }
    expect(request.messages.at(-1)?.content).toContain('context-read-failed')
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
  const wires: string[] = []; let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    wires.push(serializeChatGPTResponsesRequest(request)); turns++
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
  // A declared window whose soft pressure is reached on the fourth request (three complete rounds).
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
  expect(JSON.stringify(final.messages)).toContain('MARKER-1-')
  expect(final.compacted?.fromMessage).toBeGreaterThan(final.initialMessageCount)
  expect(final.requests[0].inputTokens).toBe(90_000)
  for (const wire of wires) {
    const input = JSON.parse(wire).input
    const calls = new Set(input.filter((item: { type: string }) => item.type === 'function_call').map((item: { call_id: string }) => item.call_id))
    for (const result of input.filter((item: { type: string }) => item.type === 'function_call_output')) expect(calls.has(result.call_id)).toBe(true)
  }
})
