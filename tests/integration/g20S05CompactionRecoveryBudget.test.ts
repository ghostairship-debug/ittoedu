// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const directories: string[] = []
const closeServers: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closeServers.splice(0)) await close()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true })
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
function complete(request: ModelRequest, calls: { id: string; name: string; input: unknown }[] = [], content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`,
    actualModel: 'local-fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
    toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) })),
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}) },
  }
}
async function markdownFixture(name: string, provider: ModelProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), `g20-s05-${name}-`))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'draft.md')
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs, events })
  const input: ExecutionStart = { conversationId: name, taskId: 'first', instruction: '把 AAA 改成 FIRST', selection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] }
  return { host, document, runs, events, engine, input }
}
async function writeEvidence(name: string, value: unknown) {
  const directory = path.join(process.cwd(), 'output', 'g20', 's05', 't09')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`)
}

it('keeps committed and unresolved facts through compaction, lost tool ACK, network faults, restart, and multiple continuations', async () => {
  let timeoutRequests = 0, disconnectedRequests = 0
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the actual HTTP model request. */ }
    if (timeoutRequests === 0) {
      timeoutRequests += 1
      // Keep the accepted connection open until the provider's local deadline.
    } else {
      disconnectedRequests += 1
      response.destroy() // Accepted request, then lost the response connection.
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  closeServers.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const port = (server.address() as { port: number }).port
  const localSelection: ModelSelection = { ...selection, connection: { ...selection.connection, baseURL: `http://127.0.0.1:${port}/v1` } }
  const timeoutProvider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 120 })
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request, options) {
    requests.push(structuredClone(request))
    const reference = refs(request)[0]!
    switch (requests.length) {
      case 1:
        yield complete(request, [{ id: 'first', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'FIRST' } }], '冗长过程。'.repeat(20_000))
        return
      case 2:
        yield complete(request, [{ id: 'lost-read', name: 'read', input: { target: reference.target } }])
        return
      case 3:
      case 4:
        yield* timeoutProvider.stream(request, options)
        return
      case 5:
        yield complete(request, [{ id: 'fresh-read', name: 'read', input: { target: reference.target } }])
        return
      case 6:
        yield complete(request, [{ id: 'remaining', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'SECOND' } }])
        return
      default:
        yield complete(request, [], '剩余工作已完成')
    }
  } }
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s05-t09-'))
  directories.push(directory)
  const documentDirectory = path.join(directory, 'documents')
  const runDirectory = path.join(directory, 'runs')
  const eventDirectory = path.join(directory, 'events')
  const host = new DocumentHostService(documentDirectory)
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'draft.md')
  const runs = new ExecutionRunStore(runDirectory)
  const events = new ExecutionEventStore({ directory: eventDirectory })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs, events })
  const maxContextBytes = 35_000
  const input: ExecutionStart = { conversationId: 't09-conversation', taskId: 't09-original',
    instruction: '把 AAA 改为 FIRST，再把 BBB 改为 SECOND', selection: localSelection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }],
    budget: { maxContextBytes, maxRequests: 4 } }
  const execute = host.tools.execute.bind(host.tools)
  const oldCalls: string[] = []
  vi.spyOn(host.tools, 'execute').mockImplementation(async (runId, callId, call) => {
    oldCalls.push(`${runId}:${callId}:${call.name}`)
    const result = await execute(runId, callId, call)
    if (call.name === 'read') {
      expect(result.kind).toBe('read')
      throw new Error('fixture: read ran, but its acknowledgement was lost')
    }
    return result
  })

  const first = await engine.start(input)
  const partial = await engine.wait(first.runId)
  expect(partial.status).toBe('partial')
  expect(partial.compacted?.atRequest).toBe(1)
  expect(partial.compacted?.facts).toContain('"status":"applied"')
  expect(partial.tools.map(tool => tool.result?.kind)).toEqual(['document-operation', 'error'])
  expect(partial.tools[1]?.result).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
  expect(requests).toHaveLength(2)
  expect((await host.internalAPI.read(document.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })

  const restoredHost = new DocumentHostService(documentDirectory)
  await restoredHost.internalAPI.restore(document.documentId)
  const resumedCalls: string[] = []
  const restoredExecute = restoredHost.tools.execute.bind(restoredHost.tools)
  vi.spyOn(restoredHost.tools, 'execute').mockImplementation((runId, callId, call) => {
    resumedCalls.push(`${runId}:${callId}:${call.name}`)
    return restoredExecute(runId, callId, call)
  })
  const restoredEvents = new ExecutionEventStore({ directory: eventDirectory })
  const restored = new ExecutionEngine({ registry: restoredHost.registry, gateway: restoredHost.tools, provider,
    runs: new ExecutionRunStore(runDirectory), events: restoredEvents })
  expect(await restored.recover()).toEqual([])
  expect(requests).toHaveLength(2)
  expect(oldCalls).toHaveLength(2)
  expect(resumedCalls).toEqual([])
  const remainingInput: ExecutionStart = { ...input, taskId: 't09-continue',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 6, to: 9 }] }] }
  const second = await restored.resume(first.runId, remainingInput)
  const timedOut = await restored.wait(second.runId)
  expect(timedOut).toMatchObject({ status: 'failed', requests: [{ state: 'failed', failure: { outcome: 'unknown', kind: 'timeout', code: 'timeout' } }] })
  expect(requests).toHaveLength(3) // Neither recover nor timeout starts an automatic model retry.
  expect(timeoutRequests).toBe(1)
  expect(disconnectedRequests).toBe(0)
  const firstContinuation = requests[2]!.messages.map(message => String(message.content)).join('\n')
  expect(firstContinuation).toContain('"status":"applied"')
  expect(firstContinuation).toContain('"pending"')

  const third = await restored.resume(second.runId, { ...remainingInput, taskId: 't09-after-timeout' })
  const disconnected = await restored.wait(third.runId)
  expect(disconnected).toMatchObject({ status: 'failed', requests: [{ state: 'failed', failure: { outcome: 'unknown', kind: 'transport', code: 'transport' } }] })
  expect(requests).toHaveLength(4)
  expect(disconnectedRequests).toBe(1)
  const secondContinuation = requests[3]!.messages.map(message => String(message.content)).join('\n')
  const fourth = await restored.resume(third.runId, { ...remainingInput, taskId: 't09-after-disconnect' })
  const final = await restored.wait(fourth.runId)
  const finalContinuation = requests[4]!.messages.map(message => String(message.content)).join('\n')
  const snapshot = await restoredHost.internalAPI.read(document.documentId)
  const evidence = {
    scenario: 'S05-T09 local provider fault injection; no paid request',
    firstRun: { status: partial.status, compactedAtRequest: partial.compacted?.atRequest,
      committed: partial.tools[0]?.result, unresolved: partial.tools[1]?.result },
    timeoutRun: { status: timedOut.status, failure: timedOut.requests[0]?.failure },
    disconnectedRun: { status: disconnected.status, failure: disconnected.requests[0]?.failure },
    finalRun: { status: final.status, continuedFrom: final.continuedFrom, toolNames: final.tools.map(tool => tool.call.name) },
    requests: requests.length, timeoutHttpRequests: timeoutRequests, disconnectedHttpRequests: disconnectedRequests,
    oldToolExecutions: oldCalls, resumedToolExecutions: resumedCalls,
    revision: snapshot.revision, undoDepth: snapshot.undoDepth,
    source: snapshot.model.kind === 'markdown' ? snapshot.model.source : null,
    secondContinuationRetainsOriginalGoal: secondContinuation.includes(input.instruction),
    secondContinuationRetainsCommit: secondContinuation.includes('"status":"applied"'),
    secondContinuationRetainsPendingTool: secondContinuation.includes('"pending"'),
    secondContinuationRetainsUnknownRequest: secondContinuation.includes('"code":"timeout"'),
    finalContinuationRetainsCommit: finalContinuation.includes('"status":"applied"'),
    finalContinuationRetainsPendingTool: finalContinuation.includes('"pending"'),
    finalContinuationRetainsNetworkFailures: finalContinuation.includes('"code":"timeout"') && finalContinuation.includes('"code":"transport"'),
    maxSerializedRequestBytes: Math.max(...requests.map(request => Buffer.byteLength(serializeModelRequest(request), 'utf8'))),
    budgetBytes: maxContextBytes,
  }
  const evidenceDirectory = path.join(process.cwd(), 'output', 'g20', 's05', 't09')
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(path.join(evidenceDirectory, 'compaction-recovery-budget.json'), `${JSON.stringify(evidence, null, 2)}\n`)

  expect(final.status).toBe('completed')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['read', 'text.replace'])
  expect(snapshot).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'FIRST SECOND' } })
  expect(evidence.secondContinuationRetainsOriginalGoal).toBe(true)
  expect(evidence.secondContinuationRetainsCommit).toBe(true)
  expect(evidence.secondContinuationRetainsPendingTool).toBe(true)
  expect(evidence.secondContinuationRetainsUnknownRequest).toBe(true)
  expect(evidence.finalContinuationRetainsCommit).toBe(true)
  expect(evidence.finalContinuationRetainsPendingTool).toBe(true)
  expect(evidence.finalContinuationRetainsNetworkFailures).toBe(true)
  expect(evidence.maxSerializedRequestBytes).toBeLessThanOrEqual(evidence.budgetBytes)
  expect(oldCalls).toHaveLength(2)
  expect(resumedCalls).toHaveLength(2)
  expect(resumedCalls.every(call => !call.startsWith(`${first.runId}:`))).toBe(true)
  await events.readTiming('t09-conversation', 't09-original')
  await restoredEvents.readTiming('t09-conversation', 't09-continue')
  await restoredEvents.readTiming('t09-conversation', 't09-after-timeout')
  await restoredEvents.readTiming('t09-conversation', 't09-after-disconnect')
})

it('does not release an unresolved side effect after a no-op continuation and another resume', async () => {
  let requestCount = 0
  const provider: ModelProvider = { async *stream(request) {
    requestCount += 1
    const reference = refs(request)[0]!
    if (requestCount === 1) {
      yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
        failure: { outcome: 'unknown', kind: 'transport', code: 'fixture-response-lost', message: '结果未知' } }
    } else if (requestCount === 3) {
      yield complete(request, [{ id: 'observe', name: 'read', input: { target: reference.target } }])
    } else if (requestCount === 4) {
      yield complete(request, [{ id: 'duplicate-attempt', name: 'text.replace',
        input: { target: reference.writable[0]!.target, content: 'DUPLICATE' } }])
    } else yield complete(request)
  } }
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s05-t09-side-effect-'))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'draft.md')
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs,
    events })
  const input: ExecutionStart = { conversationId: 't09-side-effect', taskId: 'first', instruction: '把 AAA 改成 FIRST', selection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] }
  const first = await engine.start(input)
  expect((await engine.wait(first.runId)).status).toBe('failed')
  // A crash after the invocation checkpoint can leave a side-effecting call without an ACK.
  const crashed = (await runs.read(first.runId))!
  crashed.tools.push({ callId: 'unconfirmed-call', providerCallId: 'provider-unconfirmed', requestId: crashed.requests[0]!.requestId,
    call: { name: 'text.replace', input: { target: 'old-run-handle', content: 'DUPLICATE' } }, state: 'executing' })
  await runs.save(crashed)
  const execute = vi.spyOn(host.tools, 'execute')
  const second = await engine.resume(first.runId, { ...input, taskId: 'no-op-continuation' })
  expect((await engine.wait(second.runId)).status).toBe('completed')
  const third = await engine.resume(second.runId, { ...input, taskId: 'second-continuation' })
  const final = await engine.wait(third.runId)
  expect(final.status).toBe('partial')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['read', 'text.replace'])
  expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(execute).toHaveBeenCalledTimes(1) // The fresh read only; neither old nor new write executes.
  const snapshot = await host.internalAPI.read(document.documentId)
  expect(snapshot).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'AAA BBB' } })
  const evidenceDirectory = path.join(process.cwd(), 'output', 'g20', 's05', 't09')
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(path.join(evidenceDirectory, 'unresolved-side-effect.json'), `${JSON.stringify({
    scenario: 'S05-T09 crash-window side effect preserved across two continuations; no paid request',
    firstRunId: first.runId, secondRunId: second.runId, finalStatus: final.status,
    finalToolNames: final.tools.map(tool => tool.call.name), rejectedWrite: final.tools[1]?.result,
    gatewayExecutions: execute.mock.calls.length, revision: snapshot.revision, undoDepth: snapshot.undoDepth,
  }, null, 2)}\n`)
  await events.readTiming('t09-side-effect', 'first')
  await events.readTiming('t09-side-effect', 'no-op-continuation')
  await events.readTiming('t09-side-effect', 'second-continuation')
})

it('lets a pending, never-invoked write proceed after the earlier read ACK was lost', async () => {
  let requestCount = 0
  const observed: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    observed.push(structuredClone(request))
    const reference = refs(request)[0]!
    if (++requestCount === 1) yield complete(request, [
      { id: 'lost-read', name: 'read', input: { target: reference.target } },
      { id: 'pending-write', name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'FIRST' } },
    ])
    else if (requestCount === 2) yield complete(request, [{ id: 'fresh-read', name: 'read', input: { target: reference.target } }])
    else if (requestCount === 3) yield complete(request, [{ id: 'remaining-write', name: 'text.replace',
      input: { target: reference.writable[0]!.target, content: 'FIRST' } }])
    else yield complete(request, [], '完成')
  } }
  const h = await markdownFixture('pending-not-invoked', provider)
  const calls: { runId: string; name: string }[] = []
  const execute = h.host.tools.execute.bind(h.host.tools)
  let loseReadAck = true
  vi.spyOn(h.host.tools, 'execute').mockImplementation(async (runId, callId, call) => {
    calls.push({ runId, name: call.name })
    const result = await execute(runId, callId, call)
    if (call.name === 'read' && loseReadAck) { loseReadAck = false; throw new Error('fixture: read ACK lost') }
    return result
  })
  const first = await h.engine.start(h.input)
  const failed = await h.engine.wait(first.runId)
  expect(failed.status).toBe('failed')
  expect(failed.tools.map(tool => [tool.call.name, tool.state])).toEqual([['read', 'returned'], ['text.replace', 'pending']])
  expect(calls.map(call => call.name)).toEqual(['read'])
  const second = await h.engine.resume(first.runId, { ...h.input, taskId: 'resume' })
  const final = await h.engine.wait(second.runId)
  const snapshot = await h.host.internalAPI.read(h.document.documentId)
  expect(final.status).toBe('completed')
  expect(final.tools[1]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(calls.map(call => call.name)).toEqual(['read', 'read', 'text.replace'])
  expect(calls.filter(call => call.runId === first.runId)).toHaveLength(1)
  expect(observed[1]!.messages.map(message => String(message.content)).join('\n')).toContain('"kind":"not-invoked"')
  expect(snapshot).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })
  await writeEvidence('pending-not-invoked.json', { firstStatus: failed.status, firstToolStates: failed.tools.map(tool => tool.state),
    finalStatus: final.status, finalWrite: final.tools[1]?.result, invocations: calls, revision: snapshot.revision, undoDepth: snapshot.undoDepth })
  await h.events.readTiming(h.input.conversationId, 'first')
  await h.events.readTiming(h.input.conversationId, 'resume')
})

it.each([['text.replace', 'batch'], ['batch', 'text.replace']] as const)(
  'blocks an unknown %s side effect replayed through %s after a fresh read', async (oldName, newName) => {
    let requestCount = 0
    const provider: ModelProvider = { async *stream(request) {
      const reference = refs(request)[0]!
      if (++requestCount === 1) yield { requestId: request.requestId, sequence: 1, type: 'response.failed',
        failure: { outcome: 'unknown', kind: 'transport', code: 'fixture-response-lost', message: '结果未知' } }
      else if (requestCount === 2) yield complete(request, [{ id: 'fresh-read', name: 'read', input: { target: reference.target } }])
      else if (requestCount === 3) {
        const mutation = { name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'DUPLICATE' } }
        yield complete(request, [{ id: 'replay-attempt', name: newName,
          input: newName === 'batch' ? { operations: [mutation] } : mutation.input }])
      } else yield complete(request)
    } }
    const h = await markdownFixture(`${oldName}-to-${newName}`, provider)
    const first = await h.engine.start(h.input)
    expect((await h.engine.wait(first.runId)).status).toBe('failed')
    const crashed = (await h.runs.read(first.runId))!
    const mutation = { name: 'text.replace', input: { target: 'old-run-handle', content: 'DUPLICATE' } }
    crashed.tools.push({ callId: 'unconfirmed-call', providerCallId: 'provider-unconfirmed', requestId: crashed.requests[0]!.requestId,
      call: { name: oldName, input: oldName === 'batch' ? { operations: [mutation] } : mutation.input }, state: 'executing' })
    await h.runs.save(crashed)
    const execute = vi.spyOn(h.host.tools, 'execute')
    const second = await h.engine.resume(first.runId, { ...h.input, taskId: 'resume' })
    const final = await h.engine.wait(second.runId)
    const snapshot = await h.host.internalAPI.read(h.document.documentId)
    expect(final.status).toBe('partial')
    expect(final.tools.map(tool => tool.call.name)).toEqual(['read', newName])
    expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(snapshot).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'AAA BBB' } })
    await writeEvidence(`${oldName}-to-${newName}.json`, { oldName, newName, status: final.status,
      rejectedWrite: final.tools[1]?.result, gatewayExecutions: execute.mock.calls.length,
      revision: snapshot.revision, undoDepth: snapshot.undoDepth })
    await h.events.readTiming(h.input.conversationId, 'first')
    await h.events.readTiming(h.input.conversationId, 'resume')
  },
)

it.each([['text.replace', 'batch'], ['batch', 'text.replace']] as const)(
  'blocks %s to %s when execution returned a real tool-outcome-unknown record', async (oldName, newName) => {
    let requestCount = 0
    const provider: ModelProvider = { async *stream(request) {
      const reference = refs(request)[0]!
      const mutation = { name: 'text.replace', input: { target: reference.writable[0]!.target, content: 'FIRST' } }
      if (++requestCount === 1) yield complete(request, [{ id: 'lost-write', name: oldName,
        input: oldName === 'batch' ? { operations: [mutation] } : mutation.input }])
      else if (requestCount === 2) yield complete(request, [{ id: 'fresh-read', name: 'read', input: { target: reference.target } }])
      else if (requestCount === 3) yield complete(request, [{ id: 'replay-attempt', name: newName,
        input: newName === 'batch' ? { operations: [mutation] } : mutation.input }])
      else yield complete(request)
    } }
    const h = await markdownFixture(`returned-${oldName}-to-${newName}`, provider)
    const calls: string[] = []
    const execute = h.host.tools.execute.bind(h.host.tools)
    let loseWriteAck = true
    vi.spyOn(h.host.tools, 'execute').mockImplementation((runId, callId, call) => {
      calls.push(call.name)
      if (call.name === oldName && loseWriteAck) {
        loseWriteAck = false
        throw new Error('fixture: invocation began but no response was received')
      }
      return execute(runId, callId, call)
    })
    const first = await h.engine.start(h.input)
    const failed = await h.engine.wait(first.runId)
    expect(failed).toMatchObject({ status: 'failed', tools: [{ state: 'returned', result: { kind: 'error', code: 'tool-outcome-unknown' } }] })
    const second = await h.engine.resume(first.runId, { ...h.input, taskId: 'resume' })
    const final = await h.engine.wait(second.runId)
    const snapshot = await h.host.internalAPI.read(h.document.documentId)
    expect(final.status).toBe('partial')
    expect(final.tools[1]?.result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
    expect(calls).toEqual([oldName, 'read'])
    expect(snapshot).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'AAA BBB' } })
    await writeEvidence(`returned-${oldName}-to-${newName}.json`, { oldName, newName,
      firstResult: failed.tools[0]?.result, finalResult: final.tools[1]?.result,
      gatewayExecutions: calls, revision: snapshot.revision, undoDepth: snapshot.undoDepth })
    await h.events.readTiming(h.input.conversationId, 'first')
    await h.events.readTiming(h.input.conversationId, 'resume')
  },
)
