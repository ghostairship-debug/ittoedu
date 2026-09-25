// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

const selection: ModelSelection = { model: 'local-fixture', connection: { id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'local', auth: { kind: 'api-key', credentialRef: 'unused' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }

function reply(request: ModelRequest, call?: { id: string; name: string; input: unknown }): Extract<ModelEvent, { type: 'response.completed' }> {
  const argumentsText = call ? JSON.stringify(call.input) : ''
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `reply-${request.requestId}`,
    actualModel: 'local-fixture', nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop',
    toolCalls: call ? [{ id: call.id, name: call.name, argumentsText }] : [],
    assistant: { role: 'assistant', content: '', ...(call ? { tool_calls: [{ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: argumentsText } }] } : {}) } }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-release-security-'))
  roots.push(root)
  const filename = path.join(root, 'outside.md')
  await writeFile(filename, 'OLD text')
  const host = new DocumentHostService(path.join(root, 'journals'))
  const document = await host.open(filename)
  const engine = (provider: ModelProvider) => new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  return { filename, host, document, engine }
}

const frozen = (request: ModelRequest) => JSON.parse(String(request.messages[1]!.content).split('：')[1]) as
  { target: string; writable: { target: string }[] }[]

it('rejects a fabricated mutation in a read-only run even when the model calls an unoffered write tool', async () => {
  const h = await fixture()
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    yield reply(request, turn++ === 0 ? { id: 'forged-write', name: 'text.replace', input: { target: frozen(request)[0]!.target, content: 'BAD' } } : undefined)
  } }
  const engine = h.engine(provider)
  const started = await engine.start({ conversationId: 'read-only', taskId: 'read-only', instruction: '查看', selection,
    permission: 'read-only', documents: [{ documentId: h.document.documentId, writable: [] }] })
  const result = await engine.wait(started.runId)
  expect(result.tools[0]?.result).toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: 'OLD text' } })
  expect(await readFile(h.filename, 'utf8')).toBe('OLD text')
})

it('full access to an external file still commits through its DocumentSession and one History entry', async () => {
  const h = await fixture()
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    yield reply(request, turn++ === 0 ? { id: 'formal-edit', name: 'text.replace',
      input: { target: frozen(request)[0]!.writable[0]!.target, content: 'NEW' } } : undefined)
  } }
  const engine = h.engine(provider)
  const started = await engine.start({ conversationId: 'full', taskId: 'full', instruction: '修改外部文件', selection,
    permission: 'full', workspaceRoot: path.join(path.dirname(h.filename), 'other-workspace'),
    documents: [{ documentId: h.document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 3 }] }] })
  const result = await engine.wait(started.runId)
  expect(result).toMatchObject({ status: 'completed', tools: [{ result: { kind: 'document-operation', result: { status: 'applied' } } }] })
  expect(h.host.registry.get(h.document.documentId).read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'NEW text' } })
  expect(await readFile(h.filename, 'utf8')).toBe('OLD text') // editing does not bypass the formal save path
})

it('provider credential echoes do not enter durable run records or timeline events', async () => {
  const h = await fixture()
  const secret = 'release-fixture-secret-never-persist'
  const provider = new OpenAIChatProvider({ credentialResolver: async () => secret,
    fetch: async () => new Response(JSON.stringify({ error: { message: `Authorization Bearer ${secret}` } }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'x-request-id': secret } }) })
  const engine = h.engine(provider)
  const started = await engine.start({ conversationId: 'credential', taskId: 'credential', instruction: '查看', selection,
    permission: 'read-only', documents: [] })
  const result = await engine.wait(started.runId)
  expect(result.status).toBe('failed')
  const stored = await new ExecutionRunStore(path.join(path.dirname(h.filename), 'runs')).read(started.runId)
  const timeline = await new ExecutionEventStore({ directory: path.join(path.dirname(h.filename), 'events') }).snapshot('credential')
  expect(JSON.stringify({ stored, timeline })).not.toContain(secret)
  expect(timeline.items.some(item => item.type === 'run.end' && item.data.status === 'failed')).toBe(true)
})
