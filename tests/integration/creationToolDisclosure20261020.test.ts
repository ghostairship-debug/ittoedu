// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { batchInputSchema, describeTools, toolRegistration } from '../../src/core/tools/ToolCatalog'
import { ProgrammaticToolRunner } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { serializeChatGPTResponsesRequest, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelSelection, ModelJsonObject } from '../../src/shared/workbench/modelProvider'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelEvent, ModelProvider } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 }) })

it('discovers complete tools without a document, keeps valid mixed names and enforces actual targets after discovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'creation-disclosure-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  await host.tools.beginRun({ runId: 'new', actor: 'agent', documents: [], fileAccess: { workspaceRoot: root, permission: 'workspace' } })
  await host.tools.loadToolFamilies('new', ['layout'], ['object.author', 'missing.tool'])
  const first = await host.tools.describeRun('new')
  expect(first.map(tool => tool.name)).toEqual(expect.arrayContaining(['course.configure', 'object.author']))
  await host.tools.loadToolFamilies('new', ['layout'], ['missing.tool', 'object.author'])
  expect(await host.tools.describeRun('new')).toEqual(first)
  expect(await host.tools.execute('new', 'no-target', { name: 'course.configure', input: { target: 'missing-target', settings: { title: 'NO WRITE' } } }))
    .toMatchObject({ kind: 'error' })
  expect(host.registry.size).toBe(0)

  const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Original'), resources: { assets: {}, components: {} } }, 'new.glx')
  await host.tools.attachRunDocument('new', document.documentId, true, 'initialize')
  const target = await host.tools.issueTarget('new', document.documentId, { kind: 'document' })
  expect(await host.tools.execute('new', 'configure', { name: 'course.configure', input: { target, settings: { title: 'Ready' } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })

  await host.tools.beginRun({ runId: 'external', actor: 'external', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
  expect((await host.tools.describeRun('external')).map(tool => tool.name)).not.toContain('course.configure')
  const externalTarget = await host.tools.issueTarget('external', document.documentId, { kind: 'document' })
  const call = { name: 'course.configure', input: { target: externalTarget, settings: { title: 'External direct' } } }
  expect(await host.tools.execute('external', 'direct', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })

  const runner = new ProgrammaticToolRunner({ async execute(input) {
    await input.call('course.configure', { target: externalTarget, settings: { title: 'Programmatic direct' } })
    return { status: 'completed', value: 'done' }
  } })
  expect(await runner.execute({ runId: 'external', callId: 'ptc', code: '', definitions: [],
    executeTool: (callId, operation) => host.tools.execute('external', callId, operation) })).toMatchObject({ kind: 'read', data: { status: 'completed' } })
  expect(await host.internalAPI.read(document.documentId)).toMatchObject({ revision: 3, model: { project: { title: 'Programmatic direct' } } })
})

it('serializes compact batch and tagged professional inputs while canonical parsers still reject invalid edits', () => {
  const tools = describeTools(['batch', 'object.author', 'interaction.update'])
  const valid = [
    { name: 'object.author', input: { target: 'object', change: { kind: 'text-interaction', intent: { kind: 'annotation', content: 'A note' } } } },
    { name: 'interaction.update', input: { target: 'button', change: { kind: 'click', action: 'scene.next' } } },
  ]
  for (const operation of valid) expect(toolRegistration(operation.name)!.inputSchema.safeParse(operation.input).success).toBe(true)
  expect(batchInputSchema.safeParse({ operations: valid }).success).toBe(true)
  expect(batchInputSchema.safeParse({ operations: [{ ...valid[1], input: { target: 'button', change: { kind: 'click', action: 'location-go' } } }] }).success).toBe(false)
  expect(toolRegistration('object.author')!.inputSchema.safeParse({ target: 'object', change: { kind: 'table', edit: { kind: 'row-height', rowId: 'row', height: -1 } } }).success).toBe(false)
  expect(JSON.stringify(tools.find(tool => tool.name === 'batch')!.schema)).not.toContain('row-height')
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const input = { selection, messages: [{ role: 'user' as const, content: 'fixture' }], tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema as ModelJsonObject })) }
  const chat = JSON.parse(serializeModelRequest(input))
  const oauth = JSON.parse(serializeChatGPTResponsesRequest({ ...input, selection: { ...selection,
    connection: { ...selection.connection, protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL, auth: { kind: 'oauth', credentialRef: 'fixture' } } } }))
  expect(chat.tools.map((tool: any) => tool.function.parameters)).toEqual(oauth.tools.map((tool: any) => tool.parameters))
  expect(oauth).not.toHaveProperty('prompt_cache_key')
})

it('routes view observations and actions through the exact HTML document service without changing its author source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'creation-view-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const source = '<button>Reveal</button>', filename = path.join(root, 'lesson.html')
  const session = await host.registry.open({ kind: 'file', path: filename, version: null, bindingVersion: 0 },
    async () => ({ kind: 'text', source, resources: { assets: {}, components: {} } }))
  const calls: Array<{ documentId: string; name: string; input: unknown }> = []
  host.tools.configureHostServices({ htmlActions: { async execute(_runId, document, action) {
    calls.push({ documentId: document.documentId, name: action.name, input: action.input })
    return { source: 'isolated-html-preview', identity: { ...document, loadId: 'load' }, structure: ['Revealed'], generation: calls.length }
  }, async readResource() { throw new Error('No pixels in this routing test') } } })
  await host.tools.beginRun({ runId: 'view', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { workspaceRoot: root, permission: 'workspace' } })
  const target = await host.tools.issueTarget('view', session.documentId, { kind: 'document' })
  expect(await host.tools.execute('view', 'observe', { name: 'view.observe', input: { target, query: 'Reveal' } })).toMatchObject({ kind: 'read' })
  expect(await host.tools.execute('view', 'click', { name: 'view.click', input: { handle: 'html-handle' } })).toMatchObject({ kind: 'read' })
  expect(await host.tools.execute('view', 'input', { name: 'view.input', input: { handle: 'html-input', value: 'Answer' } })).toMatchObject({ kind: 'read' })
  expect(calls.map(call => call.name)).toEqual(['html.observe', 'html.click', 'html.input'])
  expect(calls.every(call => call.documentId === session.documentId)).toBe(true)
  expect(session.read()).toMatchObject({ revision: 0, model: { source } })
})

it('keeps undisclosed file and programmatic definitions discoverable inside a narrow programmatic run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'creation-ptc-discovery-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'documents'))
  const document = await host.internalAPI.create({ kind: 'markdown', source: 'Before', resources: { assets: {}, components: {} } }, 'draft.md')
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    const tools = ++turns === 1 ? [{ id: 'ptc', name: 'programmatic.execute', argumentsText: '{"code":"inspect definitions"}' }] : []
    if (turns === 1) expect(request.tools?.map(tool => tool.name)).not.toContain('file.read')
    yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture', actualModel: 'fixture', nativeResponse: {},
      finishReason: tools.length ? 'tool_calls' : 'stop', toolCalls: tools, assistant: { role: 'assistant', content: tools.length ? '' : 'Definitions checked',
        ...(tools.length ? { tool_calls: tools.map(tool => ({ id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.argumentsText } })) } : {}) } } as ModelEvent
  } }
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
    accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ provider, registry: host.registry, gateway: host.tools, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }),
    programmatic: new ProgrammaticToolRunner({ async execute(input) {
      expect(input.definitions.map(tool => tool.name)).toEqual(expect.arrayContaining(['file.read', 'file.write', 'programmatic.read', 'course.configure']))
      expect(new Set(input.definitions.map(tool => tool.name)).size).toBe(input.definitions.length)
      return { status: 'completed', value: 'metadata' }
    } }) })
  const started = await engine.start({ conversationId: 'c', taskId: 't', instruction: 'Inspect tool definitions', selection, workspaceRoot: root,
    contentOutput: { kind: 'content', documentId: document.documentId, target: { kind: 'markdown-range', from: 0, to: 6 } },
    documents: [{ documentId: document.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 6 }] }] })
  expect((await engine.wait(started.runId)).tools[0]?.result).toMatchObject({ kind: 'read', data: { status: 'completed' } })
  await engine.shutdown()
})
