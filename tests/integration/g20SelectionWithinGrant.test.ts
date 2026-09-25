// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolTarget } from '../../src/shared/workbench/tools'

const cleanup: string[] = []
afterEach(async () => { for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
  auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function completed(request: ModelRequest, call?: { id: string; name: string; input: unknown }): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = call ? [{ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.input) } }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r-${request.requestId}`, actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
    toolCalls: calls.map(item => ({ id: item.id, name: item.function.name, argumentsText: item.function.arguments })), assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls } : {}) } }
}
async function fixture(provider: ModelProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-selection-grant-')); cleanup.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const model = new CourseV9Driver().load(new Uint8Array(await readFile('tests/fixtures/course-project-v9/mixed.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('V9 fixture required')
  const snapshot = await host.internalAPI.create(model, 'mixed.h5lesson')
  const location = model.project.locations.find(item => item.kind === 'slide-scene')!
  const target: ToolTarget = { kind: 'course-object', locationId: location.id, itemId: 'slide-title' }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  return { host, model, snapshot, target, engine }
}
const frozenSelection = (request: ModelRequest) => (JSON.parse(String(request.messages[1]!.content).split('：')[1]) as { selection: { target: string; writableTarget?: string; content?: { text: string } }[] }[])[0]!.selection[0]!

it('uses the known V9 object selection directly under a frozen whole-document grant in two model requests', async () => {
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    requests.push(structuredClone(request))
    if (requests.length === 1) {
      const chosen = frozenSelection(request)
      expect(chosen.content?.text).toContain('Mixed 起始页')
      expect(chosen.writableTarget).toBeTruthy()
      expect(chosen.writableTarget).not.toBe(chosen.target)
      yield completed(request, { id: 'direct-edit', name: 'text.replace', input: { target: chosen.writableTarget, content: '直接改写标题' } })
    } else yield completed(request)
  } }
  const h = await fixture(provider)
  const run = await h.engine.wait((await h.engine.start({ conversationId: 'c', taskId: 't', instruction: '改写选中的标题', selection,
    documents: [{ documentId: h.snapshot.documentId, writable: [{ kind: 'document' }], selection: [h.target] }] })).runId)
  expect(run.status).toBe('completed')
  expect(requests).toHaveLength(2)
  expect(run.tools).toMatchObject([{ call: { name: 'text.replace' }, result: { kind: 'document-operation', result: { status: 'applied' } } }])
  const current = h.host.registry.get(h.snapshot.documentId).read()
  if (current.model.kind !== 'course-v9') throw new Error('V9 expected')
  const slide = current.model.project.surfaces.find(surface => surface.type === 'slide')!
  const title = slide.type === 'slide' ? slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-title') : null
  expect(title && 'content' in title ? title.content : null).toMatchObject({ data: { text: '直接改写标题' } })
  expect(current.model.project.surfaces.find(surface => surface.type === 'flow')).toEqual(h.model.project.surfaces.find(surface => surface.type === 'flow'))
  expect(run.tools.map(tool => tool.call.name)).not.toContain('read')
  expect(run.tools.map(tool => tool.call.name)).not.toContain('tools.load')
})

it('keeps selection handles read-only when the frozen run has no grant or only an unrelated Flow grant', async () => {
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) { requests.push(structuredClone(request)); yield completed(request) } }
  const h = await fixture(provider)
  const readonly = await h.engine.wait((await h.engine.start({ conversationId: 'c', taskId: 'readonly', instruction: '看看标题', selection, permission: 'read-only',
    documents: [{ documentId: h.snapshot.documentId, writable: [], selection: [h.target] }] })).runId)
  expect(readonly.status).toBe('completed')
  expect(frozenSelection(requests[0]!).writableTarget).toBeUndefined()
  await expect(h.host.tools.issueWritableTargetWithinGrant(readonly.runId, h.snapshot.documentId, h.target)).rejects.toThrow('任务已停止')

  const flow = h.model.project.surfaces.find(surface => surface.type === 'flow')!
  const scope: ToolTarget = { kind: 'flow-container', surfaceId: flow.id, parentId: null }
  const outsideGrant = await h.engine.wait((await h.engine.start({ conversationId: 'c', taskId: 'outside', instruction: '看看标题', selection,
    documents: [{ documentId: h.snapshot.documentId, writable: [scope], selection: [h.target] }] })).runId)
  expect(outsideGrant.status).toBe('completed')
  expect(frozenSelection(requests[1]!).writableTarget).toBeUndefined()
  await h.host.tools.beginRun({ runId: 'plain-readonly', actor: 'agent', documents: [{ documentId: h.snapshot.documentId, writable: [] }] })
  expect(await h.host.tools.issueWritableTargetWithinGrant('plain-readonly', h.snapshot.documentId, h.target)).toBeNull()
})

it('rejects the direct selection write after another formal writer changed the object', async () => {
  let resume!: () => void, ready!: () => void
  let turn = 0
  const gate = new Promise<void>(resolve => { resume = resolve })
  const arrived = new Promise<void>(resolve => { ready = resolve })
  const provider: ModelProvider = { async *stream(request) {
    if (turn++ > 0) { yield completed(request); return }
    const selected = frozenSelection(request)
    ready(); await gate
    yield completed(request, { id: 'stale-selection', name: 'text.replace', input: { target: selected.writableTarget, content: '迟到改写' } })
  } }
  const h = await fixture(provider)
  const started = await h.engine.start({ conversationId: 'c', taskId: 'stale', instruction: '改写标题', selection,
    documents: [{ documentId: h.snapshot.documentId, writable: [{ kind: 'document' }], selection: [h.target] }] })
  await arrived
  await h.host.tools.beginRun({ runId: 'other-writer', actor: 'human', documents: [{ documentId: h.snapshot.documentId, writable: [{ kind: 'document' }] }] })
  const target = await h.host.tools.issueTarget('other-writer', h.snapshot.documentId, h.target)
  expect(await h.host.tools.execute('other-writer', 'prior-edit', { name: 'text.replace', input: { target, content: '人工先改' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  resume()
  const run = await h.engine.wait(started.runId)
  expect(run.tools[0]?.result).toMatchObject({ kind: 'error' })
  const current = h.host.registry.get(h.snapshot.documentId).read()
  if (current.model.kind !== 'course-v9') throw new Error('V9 expected')
  const slide = current.model.project.surfaces.find(surface => surface.type === 'slide')!
  const title = slide.type === 'slide' ? slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-title') : null
  expect(title && 'content' in title ? title.content : null).toMatchObject({ data: { text: '人工先改' } })
})
