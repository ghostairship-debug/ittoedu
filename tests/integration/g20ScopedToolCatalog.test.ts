// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { OpenAIChatProvider, modelToolWireName, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { workbenchServiceToolCatalog } from '../../src/core/tools/WorkbenchServiceTools'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import { toolFamilies } from '../../src/core/tools/ToolCatalog'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'

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
  // Services and engine controls are independent of the scoped document editing catalog.
  const serviceAndControlNames = new Set([...workbenchServiceToolCatalog.map(tool => modelToolWireName(tool.name)), 'context_read', 'task_note', 'task_finish', 'ask_user', 'tools_load'])
  expect(wireNames.filter((name: string) => !serviceAndControlNames.has(name)).sort()).toEqual(['read', 'inspect', 'listChildren', 'text_replace', 'batch'].sort())
  expect(bodies.map(body => body.data.tools.map((tool: any) => tool.function.name))).toEqual(Array(3).fill(wireNames))
  const batch = bodies[0].data.tools.find((tool: any) => tool.function.name === 'batch')
  expect(JSON.stringify(batch.function.parameters)).toContain('text.replace')
  expect(JSON.stringify(batch.function.parameters)).not.toContain('document.insert')
  expect(run.requests.map((request, index) => request.payload?.serializedBytes === bodies[index].bytes)).toEqual([true, true, true])
  expect((await host.internalAPI.read(session.documentId))).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'X YY CC' } })
})

function currentProject() {
  const project = createBlankCourseProjectV10('当前课件')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.box = { id: 'box', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } }
  project.instances.box = { id: 'box', definitionId: 'box', data: {}, childIds: ['a'] }
  project.instances.a = { id: 'a', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData('ABC')).value }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['box'] }]
  return project
}

it('projects current V10 grants without widening a frozen range or a deleted container, and rejects an unauthorized batch before any write', async () => {
  const { host } = await workspace()
  const project = currentProject()
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'scoped.h5lesson')
  const range: ToolTarget = { kind: 'course-instance', surfaceId: 'flow', instanceId: 'a', dataPath: ['content'], from: 0, to: 1 }
  await host.tools.beginRun({ runId: 'range', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [range] }] })
  const first = await host.tools.describeRun('range')
  expect(first.map(tool => tool.name)).toContain('text.replace')
  expect(first.map(tool => tool.name)).not.toContain('course.configure')
  await host.tools.loadToolFamilies('range', toolFamilies)
  expect(await host.tools.describeRun('range')).toEqual(first)
  const text = await host.tools.issueTarget('range', initial.documentId, range)
  const outside = await host.tools.issueTarget('range', initial.documentId, { kind: 'course-surface', surfaceId: 'flow' })
  expect(await host.tools.execute('range', 'inspect', { name: 'inspect', input: { target: text } })).toMatchObject({ kind: 'read', data: { writable: true } })
  expect(await host.tools.execute('range', 'out-of-scope-batch', { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target: text, content: 'MUST NOT WRITE' } },
    { name: 'object.insert', input: { target: outside, kind: 'text', text: 'NO' } },
  ] } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await host.internalAPI.read(initial.documentId)).toEqual(initial)
  await host.tools.beginRun({ runId: 'whole', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
  const whole = await host.tools.describeRun('whole'), wholeNames = whole.map(tool => tool.name)
  expect(wholeNames).toEqual(expect.arrayContaining(['object.insert', 'object.update', 'batch']))
  expect(wholeNames.some(name => name.startsWith('build.'))).toBe(false)
  expect(wholeNames).not.toContain('job.status')
  expect(wholeNames).not.toContain('compute.run')
  expect(JSON.stringify(whole.find(tool => tool.name === 'batch')!.schema)).toContain('object.insert')
  expect((await host.tools.describe()).map(tool => tool.name)).toEqual(expect.arrayContaining(wholeNames))

  await host.tools.beginRun({ runId: 'parent', actor: 'agent', documents: [{ documentId: initial.documentId,
    writable: [{ kind: 'course-instance', surfaceId: 'flow', instanceId: 'box' }] }] })
  const parent = await host.tools.issueTarget('parent', initial.documentId, { kind: 'course-instance', surfaceId: 'flow', instanceId: 'box' })
  const frozenCatalog = await host.tools.describeRun('parent')
  expect(frozenCatalog.map(tool => tool.name)).toContain('object.insert')
  expect(await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, actor: 'human', operationId: 'remove-parent',
    mutation: { type: 'command', command: captureComponentOperation(project, [{ type: 'instance.remove', instanceId: 'box' }]) } })).toMatchObject({ status: 'applied' })
  const removed = await host.internalAPI.read(initial.documentId)
  expect(await host.tools.execute('parent', 'late-insert', { name: 'object.insert', input: { target: parent, kind: 'text', text: 'NO' } })).toMatchObject({ kind: 'error' })
  expect(await host.internalAPI.read(initial.documentId)).toEqual(removed)
  expect(removed.undoDepth).toBe(1)
  // The catalog describes the frozen grant; current target validation owns the actual write boundary.
  expect(await host.tools.describeRun('parent')).toEqual(frozenCatalog)
})

it('sends current authoring tools by default and keeps repeated family loading idempotent while preserving frozen grants and exact provider payload bytes', async () => {
  const { directory, host } = await workspace()
  const session = await host.internalAPI.create({ kind: 'course-v10', project: currentProject(), resources: { assets: {}, components: {} } }, 'current.h5lesson')
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
  const grant = { documentId: session.documentId, writable: [{ kind: 'document' as const }] }
  const started = await engine.start({ conversationId: 'c', taskId: 't', instruction: '查看当前组件插入工具', documents: [grant], selection, permission: 'workspace' })
  const result = await engine.wait(started.runId)
  expect(result.status).toBe('completed')
  expect(result.input.permission).toBe('workspace')
  expect(result.input.documents).toEqual([grant])
  expect(observed).toHaveLength(3)
  expect(observed[0].names).toEqual(expect.arrayContaining(['tools.load', 'object.insert', 'object.update']))
  expect(observed.map(value => value.names)).toEqual(Array(3).fill(observed[0].names))
  expect(observed.map(value => value.bytes)).toEqual(Array(3).fill(observed[0].bytes))
  expect(result.requests.map((request, index) => request.payload?.serializedBytes === observed[index]?.payloadBytes)).toEqual([true, true, true])
  expect(await host.internalAPI.read(session.documentId)).toEqual(session)
})
