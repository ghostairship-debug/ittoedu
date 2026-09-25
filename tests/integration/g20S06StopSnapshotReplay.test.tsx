// @vitest-environment jsdom
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { OpenAIChatProvider, modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { cleanup(); vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'g20-s06-replay-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const edits = new EditSessionService(host.registry, host.tools)
  const eventsDirectory = path.join(directory, 'events')
  const events = new ExecutionEventStore({ directory: eventsDirectory })
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'A OLD Z', resources: { assets: {}, components: {} } }, 'unsaved.md')
  const selection = (baseURL: string): ModelSelection => ({ model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL, accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } })
  const start = async (provider: ModelProvider, baseURL = 'http://127.0.0.1:1/v1') => {
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, edits, events, runs, provider })
    const run = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '替换 OLD', selection: selection(baseURL),
      documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 2, to: 5 }] }] })
    return { engine, run }
  }
  return { host, edits, events, eventsDirectory, runs, document, start }
}
const targetOf = (request: ModelRequest) => JSON.parse(String(request.messages[1].content).split('：')[1])[0].writable[0].target as string
const completion = (request: ModelRequest, args: string): Extract<ModelEvent, { type: 'response.completed' }> => ({
  type: 'response.completed', requestId: request.requestId, sequence: 4, responseId: 'response', actualModel: 'actual-fixture',
  finishReason: 'tool_calls', nativeResponse: {}, assistant: { role: 'assistant', content: null,
    tool_calls: [{ id: 'provider-call', type: 'function', function: { name: 'text.replace', arguments: args } }] },
  toolCalls: [{ id: 'provider-call', name: 'text.replace', argumentsText: args }],
})
async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read(); if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Expected production edit event did not arrive')
}

it('deduplicates a replayed provider delta, ignores an older snapshot and completes one canonical edit', async () => {
  const h = await fixture(), release = deferred()
  const wire = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'response', model: 'actual-fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  let requests = 0
  const server = createServer((request, response) => { void (async () => {
    let body = ''; for await (const bytes of request) body += bytes.toString()
    const payload = JSON.parse(body); requests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests === 1) {
      const target = JSON.parse(payload.messages[1].content.split('：')[1])[0].writable[0].target
      const args = JSON.stringify({ target, content: '新😀内容' })
      const cut = args.indexOf('新') + 1
      response.write(wire({ role: 'assistant', tool_calls: [{ index: 0, id: 'provider-call', type: 'function', function: { name: modelToolWireName('text.replace'), arguments: args.slice(0, cut) } }] }))
      response.write(wire({ tool_calls: [{ index: 0, function: { arguments: args.slice(cut) } }] }, 'tool_calls'))
      await release.promise
    } else response.write(wire({ role: 'assistant', content: '完成' }, 'stop'))
    response.end('data: [DONE]\n\n')
  })() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  cleanups.push(async () => release.resolve())
  const native = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' })
  let replayed = false
  const provider: ModelProvider = { async *stream(request, options) {
    for await (const event of native.stream(request, options)) {
      yield event
      if (event.type === 'tool.delta' && !replayed) { replayed = true; yield structuredClone(event) }
    }
  } }
  const { engine, run } = await h.start(provider, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`)
  const projected = await eventually(async () => h.edits.list(h.document.documentId)[0], value => value?.value === '新😀内容')
  const editId = projected!.editId
  expect(await h.edits.snapshot(editId, 50, '新😀内容')).toMatchObject({ sequence: 50, value: '新😀内容' })
  expect(await h.edits.snapshot(editId, 3, '旧快照')).toMatchObject({ sequence: 50, value: '新😀内容' })
  expect(await h.edits.snapshot(editId, 50, '新😀内容')).toMatchObject({ sequence: 50, value: '新😀内容' })
  expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'A OLD Z' } })
  release.resolve()
  const result = await engine.wait(run.runId)
  expect(result.status).toBe('completed')
  expect(result.tools).toHaveLength(1)
  expect(result.tools[0].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'A 新😀内容 Z' } })
  expect(h.edits.list(h.document.documentId)).toEqual([])
  expect(requests).toBe(2)
  expect((await new ExecutionEventStore({ directory: h.eventsDirectory }).snapshot('conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(1)
})

it.each(['middle-gap', 'tail-restored', 'conflicting-replay'] as const)('uses final complete arguments as an explicit snapshot for %s', async mode => {
  const h = await fixture(), execute = vi.spyOn(h.host.tools, 'execute')
  let requests = 0, lateAfterComplete = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++requests > 1) { yield { ...completion(request, ''), sequence: 1, finishReason: 'stop', toolCalls: [], assistant: { role: 'assistant', content: '完成' } }; return }
    const args = JSON.stringify({ target: targetOf(request), content: 'ABC' })
    const cut = args.indexOf('ABC')
    const first = args.slice(0, cut + 1), middle = args.slice(cut + 1, cut + 2), tail = args.slice(cut + 2)
    yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'provider-call', name: 'text.replace', argumentsDelta: first }
    if (mode === 'middle-gap') yield { type: 'tool.delta', requestId: request.requestId, sequence: 3, index: 0, argumentsDelta: tail }
    else if (mode === 'tail-restored') yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, argumentsDelta: middle }
    else yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'provider-call', name: 'text.replace', argumentsDelta: first + 'WRONG' }
    yield completion(request, args)
    if (mode === 'tail-restored') {
      lateAfterComplete++
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 5, index: 0, argumentsDelta: tail }
      yield completion(request, args)
    }
  } }
  const { engine, run } = await h.start(provider), result = await engine.wait(run.runId)
  if (mode !== 'tail-restored') {
    expect(result.status).toBe('partial')
    expect(result.tools[0].result).toMatchObject({ kind: 'error', code: 'invalid-tool-arguments' })
    expect(execute).not.toHaveBeenCalled()
    expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'A OLD Z' } })
  } else {
    expect(result.status).toBe('completed')
    expect(result.tools[0].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'A ABC Z' } })
  }
  expect(h.edits.list(h.document.documentId)).toEqual([])
  expect(lateAfterComplete).toBe(0)
})

it('stops before late delta and complete, then a reopened timeline cannot revive the draft or run', async () => {
  const h = await fixture(), release = deferred(), ready = deferred()
  const provider: ModelProvider = { async *stream(request) {
    const args = JSON.stringify({ target: targetOf(request), content: 'LATE TEXT' })
    const cut = args.indexOf('LATE') + 2
    yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'provider-call', name: 'text.replace', argumentsDelta: args.slice(0, cut) }
    ready.resolve(); await release.promise
    yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, argumentsDelta: args.slice(cut) }
    yield completion(request, args)
  } }
  const { engine, run } = await h.start(provider)
  await ready.promise
  const preview = await eventually(async () => h.edits.list(h.document.documentId)[0], value => value?.value === 'LA')
  const stop = engine.stop(run.runId)
  release.resolve()
  expect((await stop)?.status).toBe('stopped')
  expect(await h.edits.snapshot(preview!.editId, 99, 'LATE TEXT')).toBeNull()
  expect(h.edits.list(h.document.documentId)).toEqual([])
  expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'A OLD Z' } })
  expect((await engine.read(run.runId))?.tools).toHaveLength(0)
  expect(await engine.recover()).toEqual([])
  const reopened = new ExecutionEventStore({ directory: h.eventsDirectory }), projection = await reopened.snapshot('conversation')
  expect(projection.items.find(item => item.type === 'run.end')?.data.status).toBe('stopped')
  render(<ExecutionTimeline projection={projection} />)
  expect(screen.getByRole('article', { name: '工具执行' })).toHaveTextContent('任务已结束')
})
