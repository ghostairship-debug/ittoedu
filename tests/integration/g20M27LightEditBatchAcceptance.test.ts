// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { interactionBehavior, interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
const driver = new CourseV10Driver()
const ref = (step: number) => ({ $result: { step } })
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }
async function harness() {
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-${++serial}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const project = createBlankCourseProjectV10('批量按钮'), surfaceId = project.surfaces[0].id
  project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  project.instances.button = { id: 'button', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(), frame: { width: 160, height: 72, transform: [1, 0, 0, 1, 48, 52] } }
  project.surfaces[0].childIds = ['button']
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const session = await registry.create(model, 'batch.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++serial))
  await gateway.beginRun({ runId: 'batch', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const owner = await gateway.issueTarget('batch', session.documentId, { kind: 'course-surface', surfaceId })
  const item = await gateway.issueTarget('batch', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'button' })
  return { registry, gateway, model, session, owner, item, surfaceId,
    invoke: (id: string, operations: unknown[]) => gateway.execute('batch', id, { name: 'batch', input: { operations } }) }
}
const create = (owner: string) => ({ name: 'object.insert', input: { target: owner, kind: 'shape', shapeType: 'rectangle', x: 240, y: 52, width: 160, height: 72 } })
const style = (target: unknown) => ({ name: 'object.update', input: { target, properties: { opacity: .45 } } })
const interaction = (owner: string, target: string) => ({ name: 'interaction.update', input: { target: owner,
  change: { kind: 'add', rule: { enabled: true, trigger: { type: 'node.click', nodeId: target }, conditions: [], actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: target, durationMs: 0, easing: 'linear', effect: 'none' } }] } } } })
it('atomically inserts, styles and binds observed identities with one ACK, save/reopen and Undo', async () => {
  const h = await harness(), before = h.session.read()
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  applied(await h.invoke('three-steps', [create(h.owner), style(h.item), interaction(h.owner, h.item)]))
  const after = h.session.read(); expect(after.revision).toBe(before.revision + 1); expect(after.undoDepth).toBe(before.undoDepth + 1)
  if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  const authored = after.model.project
  expect(authored.instances.button.style?.opacity).toBe(.45)
  expect(authored.instances.button.frame).toEqual(h.model.project.instances.button.frame)
  const children = authored.surfaces[0].childIds
  expect(children.filter(id => authored.definitions[authored.instances[id].definitionId].role !== 'behavior')).toHaveLength(2)
  expect(children.filter(id => authored.definitions[authored.instances[id].definitionId].role === 'behavior')).toHaveLength(1)
  const rules = interactionRules(interactionBehavior(authored, { kind: 'surface', surfaceId: h.surfaceId }))
  expect(rules[0]).toMatchObject({ trigger: { type: 'node.click', nodeId: 'button' }, actions: [{ action: { type: 'node.exit', nodeId: 'button' } }] })
  expect(rules[0].id).toBeTruthy(); expect(rules[0].actions[0].id).toBeTruthy()
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  expect(await h.session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = h.session.read().model
  if (undone.kind !== 'course-v10') throw new Error('Expected V10')
  expect({ ...undone.project, revision: before.model.project.revision }).toEqual(before.model.project)
  expect(undone.resources).toEqual(before.model.resources); expect(h.session.read().undoDepth).toBe(before.undoDepth)
})
it('rejects unsupported forward/modifier references and cross-document batches without a partial commit', async () => {
  const h = await harness(), before = h.session.read()
  for (const operations of [[style(ref(1)), create(h.owner)], [create(h.owner), style(h.item), style(ref(1))]]) {
    expect(await h.invoke(JSON.stringify(operations), operations)).toMatchObject({ kind: 'error', code: 'invalid-input' })
    expect(h.session.read()).toEqual(before)
  }
  const other = await h.registry.create(h.model, 'other.h5lesson'), second = other.read()
  await h.gateway.beginRun({ runId: 'cross', actor: 'agent', documents: [h.session, other].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
  const owner = await h.gateway.issueTarget('cross', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const foreign = await h.gateway.issueTarget('cross', other.documentId, { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'button' })
  expect(await h.gateway.execute('cross', 'cross', { name: 'batch', input: { operations: [create(owner), style(foreign)] } })).toMatchObject({ kind: 'error', code: 'cross-document-batch' })
  expect(h.session.read()).toEqual(before); expect(other.read()).toEqual(second)
})
it('M27-T06 asks once for the whole known batch, then asks again for a later batch instead of silently extending approval', async () => {
  const h = await harness(), directory = await mkdtemp(path.join(os.tmpdir(), 'g20-m27-batch-approval-'))
  let provideRun!: (runId: string) => void
  const runReady = new Promise<string>(resolve => { provideRun = resolve })
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    turn++
    let calls: { id: string; name: string; input: unknown }[] = []
    if (turn === 1) calls = [{ id: 'load-families', name: 'tools.load', input: { families: ['content', 'layout', 'interaction'] } }]
    else if (turn === 2 || turn === 3) {
      const runId = await runReady
      const owner = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId }); const item = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'button' })
      calls = [{ id: `batch-${turn}`, name: 'batch', input: { operations: [create(owner), style(item), interaction(owner, item)] } }]
    }
    const nativeCalls = calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.input) } }))
    const response: Extract<ModelEvent, { type: 'response.completed' }> = { requestId: request.requestId, sequence: 1,
      type: 'response.completed', responseId: `fixture-${turn}`, actualModel: 'fixture', nativeResponse: {},
      finishReason: calls.length ? 'tool_calls' : 'stop',
      toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) })),
      assistant: { role: 'assistant', content: calls.length ? '' : '已处理批准的修改。', ...(calls.length ? { tool_calls: nativeCalls } : {}) } }
    yield response
  } }
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const approvals: { runId: string; callId: string; reason: string; preview?: string }[] = []
  engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') approvals.push({
    runId: event.runId, callId: event.itemId, reason: event.data.approval?.reason ?? '', preview: event.data.approval?.preview,
  }) })
  let runId: string | undefined
  try {
    const started = await engine.start({ conversationId: 'c', taskId: 'batch-approval', instruction: '创建可点击的按钮，修改样式并添加互动',
      documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }], selection,
      permission: 'ask', workspaceRoot: directory })
    runId = started.runId; provideRun(runId)
    await expect.poll(() => approvals.length, { timeout: 8000 }).toBe(1)
    expect(approvals[0]).toMatchObject({ runId, reason: 'ask', preview: expect.stringContaining('interaction.update') })
    expect(h.session.read().undoDepth).toBe(0)
    await engine.decide({ runId, callId: approvals[0]!.callId, decision: 'allow' })
    await expect.poll(() => approvals.length, { timeout: 8000 }).toBe(2)
    expect(h.session.read().undoDepth).toBe(1)
    expect(approvals[1]).toMatchObject({ runId, reason: 'ask' })
    await engine.decide({ runId, callId: approvals[1]!.callId, decision: 'deny' })
    await engine.wait(runId)
    expect(h.session.read().undoDepth).toBe(1)
  } finally {
    if (runId) await engine.stop(runId)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 20_000)

it('M27-T06 rejects an invalid forward batch reference before asking for editing approval', async () => {
  const h = await harness(), directory = await mkdtemp(path.join(os.tmpdir(), 'g20-m27-batch-invalid-'))
  let provideRun!: (runId: string) => void
  const runReady = new Promise<string>(resolve => { provideRun = resolve })
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    turn++
    let calls: { id: string; name: string; input: unknown }[] = []
    if (turn === 1) calls = [{ id: 'load', name: 'tools.load', input: { families: ['content', 'layout'] } }]
    if (turn === 2) {
      const owner = await h.gateway.issueTarget(await runReady, h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
      calls = [{ id: 'invalid-forward', name: 'batch', input: { operations: [style(ref(1)), create(owner)] } }]
    }
    const nativeCalls = calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.input) } }))
    yield { requestId: request.requestId, sequence: 1, type: 'response.completed' as const, responseId: `fixture-${turn}`,
      actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
      toolCalls: calls.map(call => ({ id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) })),
      assistant: { role: 'assistant' as const, content: calls.length ? '' : '已说明无法执行。', ...(calls.length ? { tool_calls: nativeCalls } : {}) } }
  } }
  const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const engine = new ExecutionEngine({ registry: h.registry, gateway: h.gateway, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const approvals: string[] = []
  engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') {
    approvals.push(event.itemId)
    // Keep this regression bounded on the old behavior: an invalid batch must
    // never require the user to deny it before the Gateway can inspect it.
    void engine.decide({ runId: event.runId, callId: event.itemId, decision: 'deny' })
  } })
  let runId: string | undefined
  try {
    const started = await engine.start({ conversationId: 'c', taskId: 'invalid-batch', instruction: '创建并设置按钮',
      documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }], selection,
      permission: 'ask', workspaceRoot: directory })
    runId = started.runId; provideRun(runId)
    const result = await engine.wait(runId)
    expect(approvals).toEqual([])
    expect(result.tools.find(tool => tool.call.name === 'batch')?.result).toMatchObject({ kind: 'error', code: 'invalid-input' })
    expect(h.session.read().undoDepth).toBe(0)
  } finally {
    if (runId) await engine.stop(runId)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 20_000)
