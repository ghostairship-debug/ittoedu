// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
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

it('routes object style to the authorized layout family in the first wire request, then edits style without changing content', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-family-route-')); cleanup.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const model = new CourseV9Driver().load(new Uint8Array(await readFile('tests/fixtures/course-project-v9/mixed.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('V9 fixture required')
  const snapshot = await host.internalAPI.create(model, 'mixed.h5lesson')
  const location = model.project.locations.find(item => item.kind === 'slide-scene')!
  const selected: ToolTarget = { kind: 'course-object', locationId: location.id, itemId: 'slide-title' }
  const firstWire: any[] = [], requestNames: string[][] = []
  const provider: ModelProvider = { async *stream(request) {
    const index = requestNames.length
    requestNames.push(request.tools?.map(tool => tool.name) ?? [])
    if (index === 0) {
      const wire = JSON.parse(serializeModelRequest(request)) as { tools: any[] }
      firstWire.push(...wire.tools)
      const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]) as { selection: { writableTarget?: string }[] }[]
      expect(refs[0]!.selection[0]!.writableTarget).toBeTruthy()
      yield completed(request, 'tools.load', { families: ['layout'] })
    } else if (index === 1) {
      const refs = JSON.parse(String(request.messages[1]!.content).split('：')[1]) as { selection: { writableTarget?: string }[] }[]
      yield completed(request, 'object.update', { target: refs[0]!.selection[0]!.writableTarget, properties: { nativeTextStyle: { color: '#0057B8' } } })
    } else yield completed(request)
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const run = await engine.wait((await engine.start({ conversationId: 'c', taskId: 'style', instruction: '把选中标题改成蓝色，文字不变', selection,
    documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }], selection: [selected] }] })).runId)
  expect(run.status).toBe('completed')
  const load = firstWire.find(tool => tool.function.name === modelToolWireName('tools.load'))
  expect(load?.function.description).toContain('layout 对象属性')
  expect(load?.function.description).toContain('object.update')
  expect(load?.function.description).toContain('properties.nativeTextStyle')
  expect(load?.function.description).toContain('properties.frame')
  expect(firstWire.find(tool => tool.function.name === modelToolWireName('text.replace'))?.function.description).toContain('只替换')
  expect(firstWire.map(tool => tool.function.name)).not.toContain(modelToolWireName('object.update'))
  expect(requestNames[1]).toContain('object.update')
  expect(run.tools).toMatchObject([{ call: { name: 'tools.load' }, result: { kind: 'read' } },
    { call: { name: 'object.update' }, result: { kind: 'document-operation', result: { status: 'applied' } } }])
  const current = host.registry.get(snapshot.documentId).read()
  if (current.model.kind !== 'course-v9') throw new Error('V9 expected')
  const slide = current.model.project.surfaces.find(surface => surface.type === 'slide')!
  const title = slide.type === 'slide' ? slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-title') : null
  expect(title && 'content' in title ? title.content : null).toMatchObject({ data: { text: 'Mixed 起始页', style: { color: '#0057B8' } } })
  expect(current.model.project.surfaces.find(surface => surface.type === 'flow')).toEqual(model.project.surfaces.find(surface => surface.type === 'flow'))

  const flow = model.project.surfaces.find(surface => surface.type === 'flow')!
  if (flow.type !== 'flow') throw new Error('Flow required')
  const container: ToolTarget = { kind: 'flow-container', surfaceId: flow.id, parentId: null }
  let restrictedDescription = ''
  const restrictedProvider: ModelProvider = { async *stream(request) {
    const wire = JSON.parse(serializeModelRequest(request)) as { tools: any[] }
    restrictedDescription = wire.tools.find(tool => tool.function.name === modelToolWireName('tools.load'))?.function.description ?? ''
    yield completed(request)
  } }
  const restrictedEngine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider: restrictedProvider,
    runs: new ExecutionRunStore(path.join(directory, 'restricted-runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'restricted-events') }) })
  const restricted = await restrictedEngine.wait((await restrictedEngine.start({ conversationId: 'c', taskId: 'restricted', instruction: '查看授权工具族', selection,
    documents: [{ documentId: snapshot.documentId, writable: [container] }] })).runId)
  expect(restricted.status).toBe('completed')
  expect(restrictedDescription).toContain('content ')
  expect(restrictedDescription).not.toContain('layout ')
  expect(restrictedDescription).not.toContain('object.update')

  // A spatial graph grant can expose layout's spatial.structure without authorizing object.update.
  const spatial = model.project.surfaces.find(surface => surface.type === 'spatial-2d')
  const camera = model.project.locations.find(item => item.kind === 'spatial-camera')
  if (!spatial || spatial.type !== 'spatial-2d' || !camera) throw new Error('Spatial fixture required')
  await host.tools.beginRun({ runId: 'path-builder', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }] })
  await host.tools.loadToolFamilies('path-builder', ['layout'])
  const owner = await host.tools.issueTarget('path-builder', snapshot.documentId, { kind: 'course-surface', surfaceId: spatial.id })
  const item = await host.tools.issueTarget('path-builder', snapshot.documentId,
    { kind: 'course-object', locationId: camera.id, itemId: spatial.world.layerItems[0]!.layerItemId }, { readOnly: true })
  expect(await host.tools.execute('path-builder', 'add-path', { name: 'spatial.structure', input: {
    target: owner, operation: 'add-path', path: { name: 'Route', layerItemIds: [item] },
  } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const withPath = host.registry.get(snapshot.documentId).read()
  if (withPath.model.kind !== 'course-v9') throw new Error('V9 expected')
  const spatialAfter = withPath.model.project.surfaces.find(surface => surface.id === spatial.id)
  if (!spatialAfter || spatialAfter.type !== 'spatial-2d') throw new Error('Spatial surface expected')
  const graph: ToolTarget = { kind: 'spatial-graph', surfaceId: spatial.id, graph: 'path', graphId: spatialAfter.world.paths![0]!.id }
  await host.tools.beginRun({ runId: 'graph-only', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [graph] }] })
  expect((await host.tools.describeRun('graph-only')).map(tool => tool.name)).not.toContain('object.update')
  const graphLayout = (await host.tools.availableToolFamilies('graph-only')).find(family => family.family === 'layout')
  expect(graphLayout).toMatchObject({ family: 'layout', count: 1 })
  expect(graphLayout?.description).not.toContain('object.update')
})
