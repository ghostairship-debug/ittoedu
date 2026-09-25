// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import { toolFamilies } from '../../src/core/tools/ToolCatalog'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })))
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    // ExecutionEventStore serializes durable writes; on Windows the final
    // segment can still be closing when the test reaches teardown. Retry the
    // scoped temporary directory cleanup instead of turning that timing race
    // into a false tool-catalog failure.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-scoped-tools-'))
  directories.push(directory)
  return { directory, host: new DocumentHostService(path.join(directory, 'documents')) }
}

const toolCall = (id: string, name: string, args: unknown) => ({ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const wire = (delta: unknown, finishReason: string) => `data: ${JSON.stringify({ id: 'fixture-response', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`

it('sends a narrow Markdown catalog on every real HTTP turn and commits one canonical batch', async () => {
  const { directory, host } = await workspace()
  const session = await host.internalAPI.create({ kind: 'markdown', source: 'AA BB CC', resources: { assets: {}, components: {} } }, 'draft.md')
  const bodies: Array<{ data: any; bytes: number }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const buffer = Buffer.concat(chunks), data = JSON.parse(buffer.toString('utf8'))
    bodies.push({ data, bytes: buffer.byteLength })
    const references = JSON.parse(data.messages[1].content.split('：')[1])
    const call = bodies.length === 1 ? toolCall('read-doc', 'read', { target: references[0].target })
      : toolCall('edit-batch', 'batch', { operations: [
        { name: 'text.replace', input: { target: references[0].writable[0].target, content: 'X' } },
        { name: 'text.replace', input: { target: references[0].writable[1].target, content: 'YY' } },
      ] })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(bodies.length < 3
      ? wire({ role: 'assistant', tool_calls: [call] }, 'tool_calls')
      : wire({ role: 'assistant', content: '完成' }, 'stop'))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local server')
  const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture-ref' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools,
    provider: new OpenAIChatProvider({ credentialResolver: async () => 'local-only' }),
    runs: new ExecutionRunStore(path.join(directory, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const start = await engine.start({ conversationId: 'conversation', taskId: 'task', instruction: '先读再改两处', selection,
    documents: [{ documentId: session.documentId, writable: [
      { kind: 'markdown-range', from: 0, to: 2 }, { kind: 'markdown-range', from: 3, to: 5 },
    ] }] })
  const run = await engine.wait(start.runId)
  expect(run.status).toBe('completed')
  expect(bodies).toHaveLength(3)
  const wireNames = bodies[0].data.tools.map((tool: any) => tool.function.name)
  // The scoped document catalog, then the built-in loop's own question tool (M09-T04); it is not a document tool.
  expect(wireNames).toEqual(['read', 'inspect', 'listChildren', expect.stringMatching(/^tool_[a-f0-9]+$/), 'batch', 'ask_user'])
  expect(bodies.map(body => body.data.tools.map((tool: any) => tool.function.name))).toEqual(Array(3).fill(wireNames))
  const batch = bodies[0].data.tools.find((tool: any) => tool.function.name === 'batch')
  expect(JSON.stringify(batch.function.parameters)).toContain('text.replace')
  expect(JSON.stringify(batch.function.parameters)).not.toContain('document.insert')
  expect(bodies[0].bytes).toBeLessThan(10_000)
  expect(run.requests.map((request, index) => request.payload?.serializedBytes === bodies[index].bytes)).toEqual([true, true, true])
  expect((await host.internalAPI.read(session.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'X YY CC' } })
})

it('projects V9 local grants and the canonical batch while preserving full V9 and MCP discovery', async () => {
  const { host } = await workspace()
  host.tools.configureHostServices({ images: {} as HostToolServices['images'], builds: {} as HostToolServices['builds'] })
  const bytes = await readFile('tests/fixtures/course-project-v9/mixed.h5lesson')
  const model = new CourseV9Driver().load(new Uint8Array(bytes))
  if (model.kind !== 'course-v9') throw new Error('V9 fixture required')
  const session = await host.internalAPI.create(model, 'mixed.h5lesson')
  const flow = model.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Flow fixture required')
  const block = flow.blocks.find(value => value.type === 'paragraph')
  if (!block) throw new Error('Paragraph fixture required')
  const range: ToolTarget = { kind: 'flow-range', surfaceId: flow.id, blockId: block.id, parentId: null,
    slot: { kind: 'field', field: 'content' }, from: 0, to: 1 }
  await host.tools.beginRun({ runId: 'flow', actor: 'agent', documents: [{ documentId: session.documentId, writable: [range] }] })
  const flowNames = (await host.tools.describeRun('flow')).map(tool => tool.name)
  expect(flowNames).toEqual(['read', 'inspect', 'listChildren', 'text.replace', 'flow.content', 'batch'])
  expect(await host.tools.execute('flow', 'not-loaded-image', { name: 'image.generate', input: {} })).toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  await host.tools.loadToolFamilies('flow', ['media'])
  const expandedFlow = await host.tools.describeRun('flow')
  expect(expandedFlow.map(tool => tool.name)).toEqual(['image.generate', 'image.edit', 'image.status', 'read', 'inspect', 'listChildren', 'text.replace', 'flow.content', 'batch'])
  const flowBatch = expandedFlow.find(tool => tool.name === 'batch')!
  expect(JSON.stringify(flowBatch.schema)).toContain('flow.content')
  expect(JSON.stringify(flowBatch.schema)).not.toContain('document.insert')
  expect(Buffer.byteLength(JSON.stringify(flowBatch))).toBeLessThan(1600)
  expect(Buffer.byteLength(JSON.stringify(await host.tools.describeRun('flow')))).toBeLessThan(12_000)
  const handle = await host.tools.issueTarget('flow', session.documentId, range)
  expect(await host.tools.execute('flow', 'not-advertised', { name: 'document.insert', input: { target: handle } })).toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  expect(await host.tools.execute('flow', 'bad-batch', { name: 'batch', input: { operations: [{ name: 'document.insert', input: { target: handle } }] } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  const inspected = await host.tools.execute('flow', 'inspect', { name: 'inspect', input: { target: handle } })
  expect(inspected).toMatchObject({ kind: 'read', data: { writable: true, tools: ['read', 'inspect', 'text.replace', 'flow.content', 'batch'] } })
  expect((await host.internalAPI.read(session.documentId)).revision).toBe(model.project.revision)

  await host.tools.beginRun({ runId: 'flow-container', actor: 'agent', documents: [{ documentId: session.documentId,
    writable: [{ kind: 'flow-container', surfaceId: flow.id, parentId: null }] }] })
  await host.tools.loadToolFamilies('flow-container', ['content'])
  expect((await host.tools.describeRun('flow-container')).map(tool => tool.name)).toContain('document.insert')

  await host.tools.beginRun({ runId: 'whole', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const initialWhole = await host.tools.describeRun('whole')
  expect(initialWhole.map(tool => tool.name)).toEqual(['read', 'inspect', 'listChildren', 'text.replace', 'flow.content', 'batch'])
  expect(await host.tools.execute('whole', 'not-loaded-insert', { name: 'document.insert', input: {} })).toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  await host.tools.loadToolFamilies('whole', toolFamilies)
  const full = await host.tools.describeRun('whole')
  expect(full.map(tool => tool.name)).toContain('build.create')
  expect(full.map(tool => tool.name)).toContain('document.insert')
  expect(full.map(tool => tool.name)).toContain('native.insert')
  expect(JSON.stringify(full.find(tool => tool.name === 'batch')!.schema)).toContain('document.insert')
  expect(Buffer.byteLength(JSON.stringify(full.find(tool => tool.name === 'batch')))).toBeLessThan(2800)
  expect(await host.tools.execute('whole', 'bad-loaded-batch', { name: 'batch', input: { operations: [{ name: 'document.insert', input: { nonsense: true } }] } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect((await host.tools.describe()).map(tool => tool.name)).toEqual(full.map(tool => tool.name))
  expect(full.length).toBeGreaterThan(flowNames.length * 4)
})

it('does not offer Flow insertion in a slide-only whole-document grant', async () => {
  const { host } = await workspace()
  const project = createBlankCourseProject()
  const component = createDefaultTeacherControllerPackage()
  const session = await host.internalAPI.create({ kind: 'course-v9', project, resources: { assets: {}, components: { [`${component.manifest.id}@${component.manifest.version}`]: component.files } } }, 'slide-only.h5lesson')
  await host.tools.beginRun({ runId: 'slide-only', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  await host.tools.loadToolFamilies('slide-only', ['content'])
  expect((await host.tools.describeRun('slide-only')).map(tool => tool.name)).not.toContain('document.insert')
  expect((await host.tools.describe()).map(tool => tool.name)).toContain('document.insert')
})

it('removes insertion disclosure when a frozen Flow parent is deleted during the run', async () => {
  const { host } = await workspace()
  const model = new CourseV9Driver().load(new Uint8Array(await readFile('tests/fixtures/course-project-v9/mixed.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('V9 fixture required')
  const flow = model.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Flow fixture required')
  flow.blocks.push({ id: 'temporary-section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [] })
  const session = await host.internalAPI.create(model, 'nested.h5lesson')
  const container: ToolTarget = { kind: 'flow-container', surfaceId: flow.id, parentId: 'temporary-section' }
  await host.tools.beginRun({ runId: 'stale-parent', actor: 'agent', documents: [{ documentId: session.documentId, writable: [container] }] })
  await host.tools.loadToolFamilies('stale-parent', ['content'])
  expect((await host.tools.describeRun('stale-parent')).map(tool => tool.name)).toContain('document.insert')
  await host.tools.beginRun({ runId: 'remove-parent', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const target = await host.tools.issueTarget('remove-parent', session.documentId, { kind: 'flow-block', surfaceId: flow.id, blockId: 'temporary-section', parentId: null })
  expect(await host.tools.execute('remove-parent', 'delete-parent', { name: 'flow.delete', input: { target } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect((await host.tools.describeRun('stale-parent')).map(tool => tool.name)).not.toContain('document.insert')
})

it('loads a course tool family on demand without changing the frozen permission or duplicating schemas on repeat', async () => {
  const { directory, host } = await workspace()
  const model = new CourseV9Driver().load(new Uint8Array(await readFile('tests/fixtures/course-project-v9/mixed.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('V9 fixture required')
  const session = await host.internalAPI.create(model, 'mixed.h5lesson')
  const observed: { names: string[]; bytes: number; payloadBytes: number }[] = []
  const complete = (request: ModelRequest, index: number, call?: { name: string; input: unknown }): Extract<ModelEvent, { type: 'response.completed' }> => {
    const calls = call ? [{ id: `load-${index}`, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.input) } }] : []
    return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r-${index}`, actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
      toolCalls: calls.map(item => ({ id: item.id, name: item.function.name, argumentsText: item.function.arguments })), assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
  }
  const provider: ModelProvider = { async *stream(request) {
    const index = observed.length
    observed.push({ names: request.tools?.map(tool => tool.name) ?? [], bytes: Buffer.byteLength(JSON.stringify(request.tools)), payloadBytes: Buffer.byteLength(serializeModelRequest(request)) })
    yield complete(request, index, index < 2 ? { name: 'tools.load', input: { families: ['content'] } } : undefined)
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'family-runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'family-events') }) })
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const started = await engine.start({ conversationId: 'c', taskId: 't', instruction: '查看讲义插入工具', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }], selection, permission: 'workspace' })
  const result = await engine.wait(started.runId)
  expect(result.status).toBe('completed')
  expect(result.input.permission).toBe('workspace')
  expect(observed).toHaveLength(3)
  expect(observed[0]!.names).toContain('tools.load')
  expect(observed[0]!.names).not.toContain('document.insert')
  expect(observed[0]!.bytes).toBeLessThan(10_000)
  expect(observed[1]!.names).toContain('document.insert')
  expect(observed[1]!.names).toEqual(observed[2]!.names)
  expect(observed[1]!.bytes).toBe(observed[2]!.bytes)
  expect(observed[1]!.bytes).toBeLessThan(90_000)
  expect(result.requests.map((request, index) => request.payload?.serializedBytes === observed[index]?.payloadBytes)).toEqual([true, true, true])
})
