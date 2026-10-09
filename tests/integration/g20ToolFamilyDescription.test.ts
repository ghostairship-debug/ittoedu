// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { modelToolWireName, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolTarget } from '../../src/shared/workbench/tools'

const cleanup: string[] = []
afterEach(async () => { for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }

function completed(request: ModelRequest, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = name ? [{ id: `${name}-${request.requestId}`, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r-${request.requestId}`, actualModel: 'fixture', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })),
    assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
}

it('directly exposes object styling in the first wire request and preserves frozen text, read-only and graph authority', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-family-route-')); cleanup.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const { model } = createCurrentSelectionFixture()
  const original = structuredClone(model)
  const snapshot = await host.internalAPI.create(model, 'mixed.glx')
  const selected: ToolTarget = { kind: 'course-instance', surfaceId: 'page', instanceId: 'scene-text' }
  const firstWire: any[] = [], requestNames: string[][] = []
  const provider: ModelProvider = { async *stream(request) {
    const index = requestNames.length
    requestNames.push(request.tools?.map(tool => tool.name) ?? [])
    if (index === 0) {
      const wire = JSON.parse(serializeModelRequest(request)) as { tools: any[] }
      firstWire.push(...wire.tools)
      const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]) as { selection: { writableTarget?: string }[] }[]
      expect(refs[0]!.selection[0]!.writableTarget).toBeTruthy()
      yield completed(request, 'object.update', { target: refs[0]!.selection[0]!.writableTarget,
        properties: { data: { appearance: { color: '#0057B8' } } } })
    } else yield completed(request)
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const run = await engine.wait((await engine.start({ conversationId: 'c', taskId: 'style', instruction: '把选中标题改成蓝色，文字不变', selection,
    documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }], selection: [selected] }] })).runId)
  expect(run.status).toBe('completed')
  const update = firstWire.find(tool => tool.function.name === modelToolWireName('object.update'))
  expect(update?.function.description).toContain('data/style')
  expect(update?.function.description).toContain('frame')
  expect(firstWire.find(tool => tool.function.name === modelToolWireName('text.replace'))?.function.description).toContain('替换')
  expect(firstWire.map(tool => tool.function.name)).toContain(modelToolWireName('object.update'))
  expect(requestNames).toHaveLength(2)
  expect(run.tools).toMatchObject([{ call: { name: 'object.update' }, result: { kind: 'document-operation', result: { status: 'applied' } } }])
  const current = host.registry.get(snapshot.documentId).read()
  if (current.model.kind !== 'course-v10') throw new Error('V10 expected')
  const title = current.model.project.instances['scene-text']!
  expect(title.data).toMatchObject({ content: (original.project.instances['scene-text']!.data as any).content,
    appearance: { color: '#0057B8' } })
  expect(title.frame).toEqual(original.project.instances['scene-text']!.frame)
  expect(current.model.project.instances['scene-other']).toEqual(original.project.instances['scene-other'])
  expect(current.model.project.surfaces.find(surface => surface.kind === 'flow')).toEqual(original.project.surfaces.find(surface => surface.kind === 'flow'))

  // A text-field grant permits its text edit, while object-style authority stays narrower.
  const textRange: ToolTarget = { kind: 'course-instance', surfaceId: 'flow', instanceId: 'flow-paragraph', dataPath: ['content'], from: 0, to: 2 }
  await host.tools.beginRun({ runId: 'text-only', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [textRange] }] })
  const before = host.registry.get(snapshot.documentId).read()
  const readonlyObject = await host.tools.issueTarget('text-only', snapshot.documentId,
    { kind: 'course-instance', surfaceId: 'flow', instanceId: 'flow-paragraph' }, { readOnly: true })
  expect(await host.tools.execute('text-only', 'no-object-style', { name: 'object.update', input: {
    target: readonlyObject, properties: { data: { appearance: { color: '#ff0000' } } },
  } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(host.registry.get(snapshot.documentId).read()).toEqual(before)
  await host.tools.beginRun({ runId: 'readonly', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [] }] })
  const readonlyTools = (await host.tools.describeRun('readonly')).map(tool => tool.name)
  expect(readonlyTools).toContain('read')
  expect(readonlyTools).not.toContain('text.replace')
  expect(readonlyTools).not.toContain('object.update')

  // An existing graph grant exposes the current scoped project writer, without object authority.
  const spatial = model.project.surfaces.find(surface => surface.id === 'spatial')!
  if (spatial.kind !== 'spatial') throw new Error('Spatial fixture required')
  spatial.spatial = { home: { x: 0, y: 0, zoom: 1 }, frames: [], paths: [{ id: 'route', title: 'Route', frameIds: [], instanceIds: ['spatial-label'] }] }
  const graphDocument = await host.internalAPI.create(model, 'graph.glx')
  const graph: ToolTarget = { kind: 'spatial-graph', surfaceId: 'spatial', graph: 'path', graphId: 'route' }
  await host.tools.beginRun({ runId: 'graph-only', actor: 'agent', documents: [{ documentId: graphDocument.documentId, writable: [graph] }] })
  const graphTools = (await host.tools.describeRun('graph-only')).map(tool => tool.name)
  expect(graphTools).toContain('project.apply')
  expect(graphTools).not.toContain('object.update')
  expect(graphTools).not.toContain('project.save')
  expect((await host.tools.availableToolFamilies('graph-only')).find(family => family.family === 'content')).toBeDefined()
  expect((await host.tools.availableToolFamilies('graph-only')).find(family => family.family === 'layout')).toBeUndefined()
})
