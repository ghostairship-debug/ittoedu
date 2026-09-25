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
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { runEndSummary } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelJsonObject, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
async function fixture(provider: ModelProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-engine-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const edits = new EditSessionService(registry, gateway)
  const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events, provider })
  const session = await registry.create(driver.load(new TextEncoder().encode('前文 OLD 后文')), '未保存.md')
  const other = await registry.create(driver.load(new TextEncoder().encode('另一份文档')), '另一份.md')
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '把局部改成新内容', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 3, to: 6 }] }] }
  return { directory, journal, registry, gateway, edits, runs, events, engine, session, other, input, driver }
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
    expect(final.failure?.code).toBe('image-rate-limited-for-run')
    expect(turns).toBe(2)
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
    expect(turns).toBe(sameRole ? 2 : 3)
  })
  it('stops repeated tool rounds with a stable no-progress reason', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      yield complete(request, [{ id: `read-${requests}`, name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) }])
    } }
    const h = await fixture(provider)
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.status).toBe('failed')
    expect(final.failure?.code).toBe('execution-no-progress')
    expect(final.requests).toHaveLength(8)
    expect(final.tools).toHaveLength(8)
    expect(requests).toBe(8)
  })
  it('stops an alternating A-B-A-B read loop without a false content change', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      const target = refsOf(request)[requests++ % 2]!.target
      yield complete(request, [{ id: `read-${requests}`, name: 'read', argumentsText: JSON.stringify({ target }) }])
    } }
    const h = await fixture(provider)
    h.input.documents = [h.input.documents[0]!, { documentId: h.other.documentId, writable: [] }]
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.failure?.code).toBe('execution-no-progress')
    expect(final.requests).toHaveLength(8)
  })
  it('does not treat repeated unchanged edits as progress', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      yield complete(request, [{ id: `unchanged-${requests}`, name: 'text.replace',
        argumentsText: JSON.stringify({ target: refsOf(request)[0]!.writable[0]!.target, content: 'OLD' }) }])
    } }
    const h = await fixture(provider)
    const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
    expect(final.failure?.code).toBe('execution-no-progress')
    expect(final.requests).toHaveLength(8)
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
  ] as const)('keeps an unidentifiable $failedName failure partial after a later read and edit', async ({ failedName, retry, retryOther, commit }) => {
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
    expect(final.status).toBe('partial')
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
    expect(end?.data.status).toBe('partial')
    const publicEnd = await h.events.findEvent('conversation', `${final.runId}:terminal`)
    if (commit) {
      expect(runEndSummary(final)).toContain('读取尝试失败，修改已应用；是否遗漏参考内容仍需确认')
      expect(runEndSummary(final)).not.toContain('剩余工作未完成')
      expect(publicEnd?.data.text).toContain('读取尝试失败，修改已应用；是否遗漏参考内容仍需确认')
    } else expect(runEndSummary(final)).toContain('剩余工作未完成')
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
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('checkpoint rename interrupted'))
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
    let budget = 0
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) {
        const refs = refsOf(request)
        yield complete(request, [
          { id: 'read', name: 'read', argumentsText: JSON.stringify({ target: refs[0].target }) },
          { id: 'allowed', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[0].writable[0].target, content: 'YES' }) },
          { id: 'denied', name: 'text.replace', argumentsText: JSON.stringify({ target: refs[1].target, content: 'NO' }) },
        ], '完整的中间推理与过程。'.repeat(budget))
      } else yield complete(request)
    } }
    const h = await fixture(provider)
    const tools = (await h.gateway.describe()).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema as ModelJsonObject }))
    budget = Buffer.byteLength(serializeModelRequest({ selection, tools, messages: [{ role: 'user', content: 'x' }] })) + 10000
    h.input.budget = { maxContextBytes: budget }
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
    expect(requests[1].messages.some(message => message.role === 'assistant' || message.role === 'tool')).toBe(false)
    expect(Buffer.byteLength(serializeModelRequest(requests[1]))).toBeLessThanOrEqual(budget)
    expect(h.session.read()).toMatchObject({ undoDepth: 1, model: { source: '前文 YES 后文' } })
    expect(h.other.read()).toMatchObject({ undoDepth: 0, model: { source: '另一份文档' } })
  })

  it('rejects oversized initial payloads before sending and enforces request and complete tool-round budgets', async () => {
    let requests = 0
    const provider: ModelProvider = { async *stream(request) {
      requests++
      const target = refsOf(request)[0].writable[0].target
      yield complete(request, [
        { id: 'one', name: 'text.replace', argumentsText: JSON.stringify({ target, content: 'YES' }) },
        { id: 'two', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0].target }) },
      ])
    } }
    const h = await fixture(provider)
    const oversized = await h.engine.start({ ...h.input, budget: { maxContextBytes: 1 } })
    expect(await h.engine.wait(oversized.runId)).toMatchObject({ status: 'failed', requests: [] })
    expect(requests).toBe(0)
    const toolLimited = await h.engine.start({ ...h.input, budget: { maxToolCalls: 1 } })
    expect(await h.engine.wait(toolLimited.runId)).toMatchObject({ status: 'failed', tools: [], failure: { code: 'tool-call-budget-exhausted' } })
    expect(h.session.read().undoDepth).toBe(0); expect(requests).toBe(1)
    const requestLimited = await h.engine.start({ ...h.input, budget: { maxRequests: 1 } })
    const final = await h.engine.wait(requestLimited.runId)
    expect(final.status).toBe('partial'); expect(final.requests).toHaveLength(1); expect(requests).toBe(2)
    expect(h.session.read()).toMatchObject({ undoDepth: 1, model: { source: '前文 YES 后文' } })
    expect(final.tools.every(tool => tool.state === 'returned')).toBe(true)
  })

  it('keeps bounded image and build receipts visible after the local request cap without repeating generation', async () => {
    let requests = 0, continuedFacts = ''
    const provider: ModelProvider = { async *stream(request) {
      requests++
      if (requests === 1) {
        yield complete(request, [{ id: 'initial-read', name: 'read', argumentsText: JSON.stringify({ target: refsOf(request)[0]!.target }) }]); return
      }
      continuedFacts = request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n')
      yield complete(request, [], '已看到既有图片和构建错误，不重新生成图片')
    } }
    const h = await fixture(provider)
    const started = await h.engine.start({ ...h.input, budget: { maxRequests: 1 } })
    const exhausted = await h.engine.wait(started.runId)
    expect(exhausted.failure?.code).toBe('model-request-budget-exhausted')
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
    const resumed = await h.engine.start({ ...h.input, budget: { maxRequests: 1 } }, { runId: exhausted.runId, facts: 'stale caller summary' })
    const final = await h.engine.wait(resumed.runId)
    expect(final.status).toBe('completed')
    expect(requests).toBe(2)
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
