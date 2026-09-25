// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    // Engine timing is diagnostic and queued independently of the run receipt.
    const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    await Promise.all(['task', 'continued'].map(taskId => events.readTiming('conversation', taskId)))
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})

const selection: ModelSelection = { model: 'local-fixture', connection: {
  id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
  accountId: 'local', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
} }
const refs = (request: ModelRequest) => JSON.parse(String(request.messages[1].content).split('：')[1]) as {
  documentId: string; target: string; writable: { target: string }[]
}[]
const latestToolResult = (request: ModelRequest) => JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)?.content)) as {
  kind: string; data?: { target?: string; truncated?: boolean }
}
function complete(request: ModelRequest, calls: { id: string; name: string; input: unknown }[] = [], content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`,
    actualModel: 'local-fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
    toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) })),
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}) },
  }
}
async function fixture(provider: ModelProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s05-context-'))
  directories.push(directory)
  const documentDirectory = path.join(directory, 'documents'), runDirectory = path.join(directory, 'runs'), eventDirectory = path.join(directory, 'events')
  const host = new DocumentHostService(documentDirectory)
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'draft.md')
  const runs = new ExecutionRunStore(runDirectory), events = new ExecutionEventStore({ directory: eventDirectory })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs, events })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '把 AAA 改为 FIRST，再把 BBB 改为 SECOND', selection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }, { kind: 'markdown-range', from: 4, to: 7 }] }] }
  return { host, document, runs, events, engine, input, documentDirectory, runDirectory, eventDirectory }
}

it('compacts a large completed turn while retaining canonical commit facts and enough room to finish the goal', async () => {
  const observed: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    observed.push(structuredClone(request))
    const reference = refs(request)[0]!
    if (observed.length === 1) {
      yield complete(request, [{ id: 'first', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'FIRST' } }], '工作过程。'.repeat(20_000))
    } else if (observed.length === 2) {
      expect(request.messages.some(message => String(message.content).includes('"status":"applied"'))).toBe(true)
      expect(request.messages.some(message => String(message.content).includes('工作过程。工作过程。'))).toBe(false)
      yield complete(request, [{ id: 'observe', name: 'read', input: { target: reference.target } }])
    } else if (observed.length === 3) {
      expect(request.messages.some(message => message.role === 'tool' && String(message.content).includes('FIRST BBB'))).toBe(true)
      yield complete(request, [{ id: 'second', name: 'text.replace', input: { target: reference.writable[1]!.target, content: 'SECOND' } }])
    } else yield complete(request, [], '两项均完成')
  } }
  const h = await fixture(provider)
  h.input.budget = { maxContextBytes: 35_000 }
  const run = await h.engine.start(h.input), final = await h.engine.wait(run.runId)
  expect(final.status).toBe('completed')
  expect(final.compacted?.facts).toContain('FIRST') // Original user goal remains in the summary.
  expect(final.compacted?.facts).toContain('applied')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['text.replace', 'read', 'text.replace'])
  expect((await h.host.internalAPI.read(h.document.documentId))).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'FIRST SECOND' } })
  expect(observed).toHaveLength(4)
})

it('records an unknown model outcome without retrying it and requires fresh observation before resumed writes', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    const reference = refs(request)[0]!
    if (requests === 1) yield complete(request, [{ id: 'first', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'FIRST' } }])
    else if (requests === 2) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'timeout', code: 'network-lost', message: '上游请求结果未知' } }
    else if (requests === 3) {
      expect(request.messages.some(message => String(message.content).includes('network-lost'))).toBe(true)
      expect(request.messages.some(message => String(message.content).includes('"status":"applied"'))).toBe(true)
      yield complete(request, [{ id: 'too-early', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'SECOND' } }])
    } else if (requests === 4) {
      expect(request.messages.some(message => message.role === 'tool' && String(message.content).includes('resume-observation-required'))).toBe(true)
      yield complete(request, [{ id: 'fresh-read', name: 'read', input: { target: reference.target } }])
    } else if (requests === 5) {
      expect(request.messages.some(message => message.role === 'tool' && String(message.content).includes('FIRST BBB'))).toBe(true)
      yield complete(request, [{ id: 'remaining', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'SECOND' } }])
    } else yield complete(request, [], '目标完成')
  } }
  const h = await fixture(provider)
  const initial = await h.engine.start(h.input), interrupted = await h.engine.wait(initial.runId)
  expect(interrupted).toMatchObject({ status: 'partial', requests: [{ state: 'completed' }, { state: 'failed', failure: { outcome: 'unknown' } }] })
  expect(requests).toBe(2)
  expect((await h.host.internalAPI.read(h.document.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })
  const continued = await h.engine.resume(initial.runId, { ...h.input, taskId: 'continued',
    documents: [{ documentId: h.document.documentId, writable: [{ kind: 'markdown-range', from: 6, to: 9 }] }] })
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('partial') // Premature write was rejected and remains a visible failure fact.
  expect(final.tools[0].result).toMatchObject({ kind: 'error', code: 'resume-observation-required' })
  expect(final.tools[1].result?.kind).toBe('read')
  expect(final.tools[2].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(requests).toBe(6)
  expect((await h.host.internalAPI.read(h.document.documentId))).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'FIRST SECOND' } })
})

it('allows read-only file listing during recovery observation but still requires the frozen document read before writing', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    const reference = refs(request)[0]!
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'network-lost', message: '连接中断' } }
    else if (requests === 2) yield complete(request, [{ id: 'list', name: 'file.list', input: {} }])
    else if (requests === 3) yield complete(request, [{ id: 'search', name: 'file.search', input: { query: 'documents' } }])
    else if (requests === 4) yield complete(request, [{ id: 'read', name: 'read', input: { target: reference.target } }])
    else yield complete(request, [], '观察完成')
  } }
  const h = await fixture(provider)
  const directory = path.dirname(h.documentDirectory)
  const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider,
    runs: h.runs, events: h.events, files: new AgentFileService(h.host) })
  h.input.workspaceRoot = directory
  const first = await engine.start(h.input)
  expect((await engine.wait(first.runId)).status).toBe('failed')
  const continued = await engine.resume(first.runId, { ...h.input, taskId: 'continued' })
  const final = await engine.wait(continued.runId)
  expect(final.status).toBe('completed')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['file.list', 'file.search', 'read'])
  expect(final.tools.every(tool => tool.result?.kind === 'read')).toBe(true)
  expect(requests).toBe(5)
  expect((await h.host.internalAPI.read(h.document.documentId)).revision).toBe(0)
})

it('accepts a complete read of an inspect-refreshed document root before resumed writing', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    const reference = refs(request)[0]!
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'network-lost', message: '连接中断' } }
    else if (requests === 2) yield complete(request, [{ id: 'inspect-root', name: 'inspect', input: { target: reference.target } }])
    else if (requests === 3) {
      const refreshed = latestToolResult(request).data?.target
      expect(refreshed).toBeTruthy()
      expect(refreshed).not.toBe(reference.target)
      yield complete(request, [{ id: 'read-refreshed-root', name: 'read', input: { target: refreshed } }])
    } else if (requests === 4) {
      expect(latestToolResult(request).data?.truncated).toBe(false)
      yield complete(request, [{ id: 'write-after-observation', name: 'text.replace',
        input: { target: reference.writable[0]!.target, content: 'FIRST' } }])
    } else yield complete(request, [], '已重新观察并修改')
  } }
  const h = await fixture(provider)
  const first = await h.engine.start(h.input)
  expect((await h.engine.wait(first.runId)).status).toBe('failed')
  const continued = await h.engine.resume(first.runId, { ...h.input, taskId: 'continued' })
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('completed')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['inspect', 'read', 'text.replace'])
  expect(final.tools[2]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect((await h.host.internalAPI.read(h.document.documentId)).model).toMatchObject({ source: 'FIRST BBB' })
})

it('does not let a range read stand in for observing the whole document', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    const reference = refs(request)[0]!
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'network-lost', message: '连接中断' } }
    else if (requests === 2) yield complete(request, [{ id: 'read-range', name: 'read', input: { target: reference.writable[0]!.target } }])
    else if (requests === 3) yield complete(request, [{ id: 'premature-write', name: 'text.replace',
      input: { target: reference.writable[0]!.target, content: 'FIRST' } }])
    else yield complete(request, [], '未修改')
  } }
  const h = await fixture(provider)
  const first = await h.engine.start(h.input)
  expect((await h.engine.wait(first.runId)).status).toBe('failed')
  const continued = await h.engine.resume(first.runId, { ...h.input, taskId: 'continued' })
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('partial')
  expect(final.tools[0]?.result?.kind).toBe('read')
  expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'resume-observation-required' })
  expect((await h.host.internalAPI.read(h.document.documentId)).model).toMatchObject({ source: 'AAA BBB' })
})

it('does not unlock recovery after a truncated document read', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    const reference = refs(request)[0]!
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'network-lost', message: '连接中断' } }
    else if (requests === 2) yield complete(request, [{ id: 'truncated-root', name: 'read', input: { target: reference.target, limit: 1 } }])
    else if (requests === 3) {
      expect(latestToolResult(request).data?.truncated).toBe(true)
      yield complete(request, [{ id: 'premature-write', name: 'text.replace',
        input: { target: reference.writable[0]!.target, content: 'FIRST' } }])
    } else yield complete(request, [], '未修改')
  } }
  const h = await fixture(provider)
  const source = `AAA ${'B'.repeat(250)}`
  const long = await h.host.internalAPI.create({ kind: 'markdown', source, resources: { assets: {}, components: {} } }, 'long.md')
  h.input.documents = [{ documentId: long.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }]
  const first = await h.engine.start(h.input)
  expect((await h.engine.wait(first.runId)).status).toBe('failed')
  const continued = await h.engine.resume(first.runId, { ...h.input, taskId: 'continued' })
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('partial')
  expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'resume-observation-required' })
  expect((await h.host.internalAPI.read(long.documentId)).model).toMatchObject({ source })
})

it('rejects a prior-revision root handle as a current recovery observation', async () => {
  const h = await fixture({ async *stream() { /* Gateway-only guard check; no provider call. */ } })
  const gateway = h.host.tools, runId = 'version-guard'
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: h.document.documentId,
    writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
  const oldRoot = await gateway.issueTarget(runId, h.document.documentId, { kind: 'document' })
  const writable = await gateway.issueTarget(runId, h.document.documentId, { kind: 'markdown-range', from: 0, to: 3 })
  expect(await gateway.resolveObservationTarget(runId, oldRoot)).toMatchObject({ documentId: h.document.documentId, revision: 0, target: { kind: 'document' } })
  expect(await gateway.execute(runId, 'change', { name: 'text.replace', input: { target: writable, content: 'FIRST' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  await expect(gateway.resolveObservationTarget(runId, oldRoot)).rejects.toMatchObject({ code: 'target-conflict' })
  await gateway.stop(runId)
})

it('queries a terminal run lost tool receipt on recovery without replaying the old operation', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    if (requests === 1) yield complete(request, [{ id: 'first', name: 'text.replace', input: { target: refs(request)[0]!.writable[0]!.target, content: 'FIRST' } }])
    else yield complete(request)
  } }
  const h = await fixture(provider)
  const run = await h.engine.start(h.input), final = await h.engine.wait(run.runId)
  expect(final.status).toBe('completed')
  const lost = (await h.runs.read(run.runId))!
  lost.tools[0]!.state = 'executing'
  delete lost.tools[0]!.result
  await h.runs.save(lost)
  const restoredHost = new DocumentHostService(h.documentDirectory)
  await restoredHost.internalAPI.restore(h.document.documentId)
  const reloaded = new ExecutionEngine({ registry: restoredHost.registry, gateway: restoredHost.tools, provider,
    runs: new ExecutionRunStore(h.runDirectory), events: new ExecutionEventStore({ directory: h.eventDirectory }) })
  expect(await reloaded.recover()).toEqual([])
  expect(await reloaded.recover()).toEqual([])
  const restored = (await h.runs.read(run.runId))!
  expect(restored.tools[0]).toMatchObject({ state: 'returned', result: { kind: 'document-operation', result: { status: 'applied' } } })
  expect(requests).toBe(2)
  expect((await restoredHost.internalAPI.read(h.document.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })
  expect((await h.events.snapshot('conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(1)
})

it('blocks a fresh same-name side effect when the previous tool has no recoverable receipt', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'lost-response', message: '结果未知' } }
    else if (requests === 2) yield complete(request, [{ id: 'observe', name: 'read', input: { target: refs(request)[0]!.target } }])
    else if (requests === 3) yield complete(request, [{ id: 'replay-attempt', name: 'text.replace',
      input: { target: refs(request)[0]!.writable[0]!.target, content: 'DUPLICATE' } }])
    else yield complete(request)
  } }
  const h = await fixture(provider)
  const started = await h.engine.start(h.input)
  expect((await h.engine.wait(started.runId)).status).toBe('failed')
  const uncertain = (await h.runs.read(started.runId))!
  uncertain.tools.push({ callId: 'unconfirmed-call', providerCallId: 'provider-unconfirmed', requestId: 'old-request',
    call: { name: 'text.replace', input: { target: 'old-handle', content: 'DUPLICATE' } }, state: 'executing' })
  await h.runs.save(uncertain)
  const continued = await h.engine.resume(started.runId, { ...h.input, taskId: 'continued' })
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('partial')
  expect(final.tools.map(tool => tool.result?.kind)).toEqual(['read', 'error'])
  expect(final.tools[1].result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(requests).toBe(4)
  expect((await h.host.internalAPI.read(h.document.documentId))).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'AAA BBB' } })
})

it('rebuilds queued continuation facts from the run journal instead of trusting a stale queued summary', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    requests += 1
    if (requests === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
      failure: { outcome: 'unknown', kind: 'transport', code: 'queued-lost', message: '响应未知' } }
    else {
      expect(request.messages.some(message => String(message.content).includes('queued-lost'))).toBe(true)
      expect(request.messages.some(message => String(message.content).includes('FAKE_COMMIT'))).toBe(false)
      yield complete(request)
    }
  } }
  const h = await fixture(provider)
  const previous = await h.engine.start(h.input)
  expect((await h.engine.wait(previous.runId)).status).toBe('failed')
  const queued = await h.engine.start({ ...h.input, taskId: 'queued-follow-up', instruction: '继续原任务' },
    { runId: previous.runId, facts: 'FAKE_COMMIT' })
  expect((await h.engine.wait(queued.runId)).continuedFrom).toBe(previous.runId)
  expect(requests).toBe(2)
})

it('rejects oversized frozen history as initial input without treating an old assistant message as compressible work', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) { requests += 1; yield complete(request) } }
  const h = await fixture(provider)
  const run = await h.engine.start({ ...h.input, context: [{ role: 'assistant', content: '历史上下文'.repeat(2_000) }],
    budget: { maxContextBytes: 1_000 } })
  const final = await h.engine.wait(run.runId)
  expect(final.status).toBe('failed')
  expect(final.failure?.message).toContain('初始输入超过模型预算')
  expect(final.requests).toEqual([])
  expect(final.compacted).toBeUndefined()
  expect(requests).toBe(0)
})
