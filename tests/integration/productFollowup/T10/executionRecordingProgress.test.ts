// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../../../src/main/workbench/execution/EditSessionService'
import { prepareExecutionContentOutput } from '../../../../src/core/tools/ToolTargets'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'local-recording', connection: { id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 3000) })]) }
  finally { clearTimeout(timer) }
}
function replace(request: ModelRequest): Extract<ModelEvent, { type: 'response.completed' }> {
  const call = { id: 'replace-once', name: 'text.replace', argumentsText: JSON.stringify({ content: 'Already committed teaching text\n' }) }
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: selection.model,
    finishReason: 'tool_calls', nativeResponse: {}, toolCalls: [call], assistant: { role: 'assistant', content: '',
      tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] } }
}

it('real Engine tool receipt and Stop finish while timeline disk append is pending and later flush preserves the applied outcome exactly once', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-recording-progress-'))
  const entered = defer(), release = defer(), nextRequest = defer()
  let engine: ExecutionEngine | undefined, events: ExecutionEventStore | undefined, held = false
  try {
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const filename = path.join(directory, 'lesson.md'); await fs.writeFile(filename, 'Original teaching text\n')
    const initial = await host.open(filename)
    const target = { kind: 'markdown-range' as const, from: 0, to: 'Original teaching text\n'.length }
    const contentOutput = prepareExecutionContentOutput(initial, target)
    expect(contentOutput).toBeDefined()
    const runs = new ExecutionRunStore(path.join(directory, 'runs')), eventDirectory = path.join(directory, 'events')
    events = new ExecutionEventStore({ directory: eventDirectory })
    const realOpen = fs.open.bind(fs)
    // Delay the first real timeline segment write. Document journal, run checkpoints and timing writes use their original owners.
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await realOpen(...args)
      const requested = path.resolve(String(args[0]))
      if (!held && requested.startsWith(path.resolve(eventDirectory) + path.sep) && requested.endsWith('.events') && args[1] === 'a+') {
        held = true
        return new Proxy(handle, { get(owner, key) {
          if (key === 'writeFile') return async (...write: Parameters<typeof handle.writeFile>) => { entered.resolve(); await release.promise; return owner.writeFile(...write) }
          const value = Reflect.get(owner, key, owner)
          return typeof value === 'function' ? value.bind(owner) : value
        } })
      }
      return handle
    })
    let requests = 0
    const provider: ModelProvider = { async *stream(request, options) {
      if (++requests === 1) {
        expect(request.tools?.map(tool => tool.name)).toContain('text.replace')
        yield replace(request); return
      }
      nextRequest.resolve()
      await new Promise<void>(done => { if (options?.signal?.aborted) done(); else options?.signal?.addEventListener('abort', () => done(), { once: true }) })
      yield { requestId: request.requestId, sequence: 1, type: 'response.failed', failure: { outcome: 'unknown', kind: 'aborted', code: 'controlled-stop', message: 'Stopped pending model turn' } }
    } }
    engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider, runs, events,
      edits: new EditSessionService(host.registry, host.tools) })
    const started = await engine.start({ conversationId: 'recording', taskId: 'edit-once', instruction: 'Rewrite the selected teaching text, then wait for the teacher.',
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput!,
      workspaceRoot: directory, permission: 'workspace', selection })
    await within(entered.promise, 'Actual timeline segment write was never reached')
    // Arrival at the second model request proves the real public tool completed across the blocked recording write.
    await within(nextRequest.promise, 'Timeline disk write blocked the formal tool receipt')
    const committed = await host.internalAPI.read(initial.documentId)
    expect(committed).toMatchObject({ undoDepth: 1, model: { kind: 'markdown', source: 'Already committed teaching text\n' } })
    const checkpoint = (await runs.read(started.runId))!
    expect(checkpoint.tools).toHaveLength(1)
    expect(checkpoint.tools[0]).toMatchObject({ call: { name: 'text.replace' }, state: 'returned', result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(events.getPendingState().pendingEvents).toBeGreaterThan(0)
    const stopped = await within(engine.stop(started.runId), 'Timeline disk write blocked Stop')
    expect(stopped).toMatchObject({ status: 'stopped', tools: [{ result: { kind: 'document-operation', result: { status: 'applied' } } }] })
    expect(events.getPendingState().pendingEvents).toBeGreaterThan(0)
    let flushed = false
    const draining = events.flushPending().then(() => { flushed = true })
    await new Promise<void>(done => setImmediate(done))
    expect(flushed).toBe(false)
    release.resolve(); await draining
    expect(events.getPendingState()).toEqual({ pendingEvents: 0, pendingTiming: 0 })
    const cold = new ExecutionEventStore({ directory: eventDirectory })
    const page = await cold.readPage({ conversationId: 'recording', limit: 5000 })
    expect(page.hasMore).toBe(false)
    const commits = page.events.filter(event => event.type === 'document.commit' && event.data.status === 'applied')
    expect(commits).toHaveLength(1)
    const terminal = page.events.filter(event => event.type === 'run.end')
    expect(terminal).toHaveLength(1)
    expect(terminal[0].data.status).toBe('stopped')
    expect(commits[0].sequence).toBeLessThan(terminal[0].sequence)
    expect(page.events.filter(event => event.type === 'tool' && event.data.toolName === 'text.replace').at(-1)?.data).toMatchObject({ status: 'returned', applicationStatus: 'applied' })
    expect((await host.internalAPI.read(initial.documentId)).revision).toBe(committed.revision)
    expect((await runs.read(started.runId))!.tools).toHaveLength(1)
    expect(requests).toBe(2)
  } finally {
    release.resolve()
    await engine?.shutdown()
    await events?.flushPending()
    vi.restoreAllMocks()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 15_000)
