// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const selection: ModelSelection = { model: 'local-fixture', connection: { id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'local', auth: { kind: 'api-key', credentialRef: 'unused' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const refs = (request: ModelRequest) => JSON.parse(String(request.messages[1].content).split('：')[1]) as {
  documentId: string; target: string; writable: { kind: string; target: string }[]
}[]
function complete(request: ModelRequest, calls: { id: string; name: string; args: unknown }[] = [], content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`, actualModel: 'local-fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.args) })),
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) } }
}

it('keeps a committed first edit, discards late work after Stop, and resumes from the restored document without replay', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-s05-stop-facts-'))
  directories.push(directory)
  const documentDirectory = path.join(directory, 'documents'), runDirectory = path.join(directory, 'runs'), eventDirectory = path.join(directory, 'events')
  const host = new DocumentHostService(documentDirectory)
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'AAA BBB', resources: { assets: {}, components: {} } }, 'draft.md')
  const enteredSecond = deferred(), releaseLate = deferred()
  let oldRequests = 0, oldSecondHandle = ''
  const firstProvider: ModelProvider = { async *stream(request) {
    oldRequests += 1
    const target = refs(request)[0]
    if (oldRequests === 1) {
      yield complete(request, [{ id: 'first-edit', name: 'text.replace', args: { target: target.writable[0].target, content: 'FIRST' } }])
      return
    }
    oldSecondHandle = target.writable[1].target
    enteredSecond.resolve()
    await releaseLate.promise // Deliberately ignores AbortSignal, like a late provider callback.
    yield complete(request, [{ id: 'late-edit', name: 'text.replace', args: { target: oldSecondHandle, content: 'LATE' } }])
  } }
  const runs = new ExecutionRunStore(runDirectory), events = new ExecutionEventStore({ directory: eventDirectory })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider: firstProvider, runs, events })
  const original = await engine.start({ conversationId: 'conversation', taskId: 'original', instruction: '把第一处改为 FIRST，再把第二处改为 SECOND', selection,
    documents: [{ documentId: document.documentId, writable: [
      { kind: 'markdown-range', from: 0, to: 3 }, { kind: 'markdown-range', from: 4, to: 7 },
    ] }] })
  await enteredSecond.promise
  expect((await host.internalAPI.read(document.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })
  const stopping = engine.stop(original.runId)
  expect(await host.tools.execute(original.runId, 'late-direct', { name: 'text.replace', input: { target: oldSecondHandle, content: 'LATE' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
  releaseLate.resolve()
  const stopped = await stopping
  expect(stopped).toMatchObject({ status: 'stopped', tools: [{ state: 'returned', result: { kind: 'document-operation', result: { status: 'applied' } } }] })
  expect(stopped?.requests).toHaveLength(2)
  expect(stopped?.requests[1].failure?.outcome).toBe('unknown')
  expect((await host.internalAPI.read(document.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'FIRST BBB' } })

  const reopened = new DocumentHostService(documentDirectory)
  const recoveredDocument = await reopened.internalAPI.restore(document.documentId)
  expect(recoveredDocument.epoch).not.toBe(document.epoch)
  let newRequests = 0
  const continuationProvider: ModelProvider = { async *stream(request) {
    newRequests += 1
    const target = refs(request)[0]
    if (newRequests === 1) {
      expect(request.messages.some(message => String(message.content).includes('"status":"applied"'))).toBe(true)
      yield complete(request, [{ id: 'fresh-read', name: 'read', args: { target: target.target } }])
      return
    }
    if (newRequests === 2) {
      expect(request.messages.some(message => message.role === 'tool' && String(message.content).includes('FIRST BBB'))).toBe(true)
      yield complete(request, [{ id: 'remaining-edit', name: 'text.replace', args: { target: target.writable[0].target, content: 'SECOND' } }])
      return
    }
    yield complete(request, [], '两处已完成')
  } }
  const resumedEngine = new ExecutionEngine({ registry: reopened.registry, gateway: reopened.tools, provider: continuationProvider,
    runs: new ExecutionRunStore(runDirectory), events: new ExecutionEventStore({ directory: eventDirectory }) })
  expect(await resumedEngine.recover()).toEqual([])
  expect(newRequests).toBe(0)
  const continuation = await resumedEngine.resume(original.runId, { conversationId: 'conversation', taskId: 'continued', instruction: '新的描述不会覆盖原目标', selection,
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 6, to: 9 }] }] })
  const final = await resumedEngine.wait(continuation.runId)
  expect(final).toMatchObject({ status: 'completed', continuedFrom: original.runId, input: { instruction: '把第一处改为 FIRST，再把第二处改为 SECOND' } })
  expect(newRequests).toBe(3)
  expect(final.tools.map(tool => tool.call.name)).toEqual(['read', 'text.replace'])
  expect((await reopened.internalAPI.read(document.documentId))).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'FIRST SECOND' } })
  const timeline = await new ExecutionEventStore({ directory: eventDirectory }).snapshot('conversation')
  expect(timeline.items.filter(item => item.type === 'document.commit')).toHaveLength(2)
})
