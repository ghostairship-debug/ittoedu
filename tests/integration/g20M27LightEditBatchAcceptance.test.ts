// @vitest-environment node
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'

const driver = new CourseV9Driver()
type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
const load = (): CourseModel => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as CourseModel
const ref = (step: number) => ({ $result: { step } })
function applied(result: ToolResult): asserts result is Extract<ToolResult, { kind: 'document-operation' }> {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
}
async function harness() {
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-${++serial}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('save is not used') } } })
  const model = load(), session = await registry.create(model, 'batch.h5lesson')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('slide fixture missing')
  const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
  if (!location) throw new Error('location fixture missing')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial))
  await gateway.beginRun({ runId: 'batch', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const owner = await gateway.issueTarget('batch', session.documentId, { kind: 'course-owner', owner: 'scene', locationId: location.id })
  return { registry, gateway, model, session, owner, surfaceId: surface.id, sceneId: surface.scenes[0]!.id,
    invoke: (id: string, operations: unknown[]) => gateway.execute('batch', id, { name: 'batch', input: { operations } }) }
}
const create = (owner: string) => ({ name: 'native.insert', input: { target: owner,
  template: { nativeType: 'shape', shapeType: 'rectangle', label: '批处理按钮', x: 48, y: 52, width: 160, height: 72 } } })
const style = (step: number) => ({ name: 'object.update', input: { target: ref(step), properties: { opacity: 0.45 } } })
const interaction = (owner: string, step: number) => ({ name: 'interaction.compose', input: { target: owner,
  interaction: { name: '点按隐藏新按钮', trigger: { kind: 'click', node: ref(step) }, effects: [{ kind: 'hide', nodes: [ref(step)] }] } } })

it('M27-T06 creates, styles and binds an interaction to one earlier batch result with one ACK and one Undo', async () => {
  const h = await harness(), before = h.session.read()
  const result = await h.invoke('three-steps', [create(h.owner), style(0), interaction(h.owner, 0)])
  applied(result)
  const after = h.session.read()
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(after.revision).toBe(before.revision + 1)
  if (after.model.kind !== 'course-v9') throw new Error('course result missing')
  const surface = after.model.project.surfaces.find(value => value.id === h.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('slide result missing')
  const scene = surface.scenes.find(value => value.id === h.sceneId)!
  const item = scene.layerItems.find(value => value.label === '批处理按钮')
  expect(item).toMatchObject({ opacity: 0.45 })
  expect(scene.interactions.find(value => value.name === '点按隐藏新按钮')).toMatchObject({
    trigger: { type: 'node.click', nodeId: item?.layerItemId }, actions: [{ action: { type: 'node.exit', nodeId: item?.layerItemId } }],
  })
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  const undo = await h.session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'human-undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied')
  const undone = h.session.read()
  expect(undone.undoDepth).toBe(before.undoDepth)
  expect(undone.model.resources).toEqual(before.model.resources)
  if (undone.model.kind !== 'course-v9' || before.model.kind !== 'course-v9') throw new Error('course result missing')
  expect(undone.model.project.surfaces).toEqual(before.model.project.surfaces)
  expect(undone.model.project.locations).toEqual(before.model.project.locations)
})

it('M27-T06 rejects a forward result reference before any candidate becomes formal', async () => {
  const h = await harness(), before = h.session.read()
  const result = await h.invoke('forward', [style(1), create(h.owner)])
  expect(result).toMatchObject({ kind: 'error', code: 'invalid-result-reference' })
  expect(h.session.read()).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: before.model })
})

it('M27-T06 rejects a reference to a modifier result rather than a created object', async () => {
  const h = await harness(), before = h.session.read()
  const result = await h.invoke('wrong-result-type', [create(h.owner), style(0), style(1)])
  expect(result).toMatchObject({ kind: 'error', code: 'invalid-result-reference' })
  expect(h.session.read()).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: before.model })
})

it('M27-T06 rejects cross-document references and leaves both sessions unchanged', async () => {
  const h = await harness(), other = await h.registry.create(load(), 'other.h5lesson')
  await h.gateway.beginRun({ runId: 'cross', actor: 'agent', documents: [h.session, other].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
  const owner = await h.gateway.issueTarget('cross', h.session.documentId, { kind: 'course-owner', owner: 'scene',
    locationId: h.model.project.locations.find(value => value.kind === 'slide-scene')!.id })
  const item = other.read().model
  if (item.kind !== 'course-v9') throw new Error('course fixture missing')
  const surface = item.project.surfaces.find(value => value.type === 'slide')!
  const location = item.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)!
  const otherOwner = await h.gateway.issueTarget('cross', other.documentId, { kind: 'course-owner', owner: 'scene', locationId: location.id })
  const first = h.session.read(), second = other.read()
  const result = await h.gateway.execute('cross', 'cross-document', { name: 'batch', input: { operations: [create(owner), interaction(otherOwner, 0)] } })
  expect(result).toMatchObject({ kind: 'error', code: 'cross-document-batch' })
  expect(h.session.read()).toMatchObject({ revision: first.revision, undoDepth: first.undoDepth, model: first.model })
  expect(other.read()).toMatchObject({ revision: second.revision, undoDepth: second.undoDepth, model: second.model })
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
      const owner = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-owner', owner: 'scene',
        locationId: h.model.project.locations.find(value => value.kind === 'slide-scene')!.id })
      calls = [{ id: `batch-${turn}`, name: 'batch', input: { operations: [create(owner), style(0), interaction(owner, 0)] } }]
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
    expect(approvals[0]).toMatchObject({ runId, reason: 'ask', preview: expect.stringContaining('interaction.compose') })
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
      const owner = await h.gateway.issueTarget(await runReady, h.session.documentId, { kind: 'course-owner', owner: 'scene',
        locationId: h.model.project.locations.find(value => value.kind === 'slide-scene')!.id })
      calls = [{ id: 'invalid-forward', name: 'batch', input: { operations: [style(1), create(owner)] } }]
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
    expect(result.tools.find(tool => tool.call.name === 'batch')?.result).toMatchObject({ kind: 'error', code: 'invalid-result-reference' })
    expect(h.session.read().undoDepth).toBe(0)
  } finally {
    if (runId) await engine.stop(runId)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 20_000)

it('M27-T03 discovers a Runtime text target and commits its edit with one Undo and reopen', async () => {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Runtime fixture missing')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Runtime slide missing')
  const runtime = surface.scenes[0]?.layerItems.find(value => value.kind === 'runtime')
  if (!runtime || runtime.kind !== 'runtime') throw new Error('Runtime object missing')
  // This fixture deliberately has no static fallback, so the model tool can be
  // checked without a preview capture port. Fallback refresh has its own gate.
  delete runtime.runtime.staticFallback
  driver.validate(model)
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-runtime-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('save is not used') } } })
  const session = await registry.create(model, 'runtime.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial))
  await gateway.beginRun({ runId: 'runtime-light-edit', actor: 'agent',
    documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  await gateway.loadToolFamilies('runtime-light-edit', ['content'])
  expect((await gateway.describeRun('runtime-light-edit')).map(tool => tool.name)).toContain('content.targets')
  const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
  if (!location) throw new Error('Runtime location missing')
  const object = await gateway.issueTarget('runtime-light-edit', session.documentId,
    { kind: 'course-object', locationId: location.id, itemId: runtime.layerItemId })
  const targets = await gateway.execute('runtime-light-edit', 'discover-runtime',
    { name: 'content.targets', input: { target: object } })
  expect(targets.kind, JSON.stringify(targets)).toBe('read')
  if (targets.kind !== 'read') throw new Error('Runtime targets unavailable')
  const entries = (targets.data as { targets?: { target: string; kind: string; text?: string }[] }).targets
  const title = entries?.find(entry => entry.kind === 'text' && entry.text === '动态标题')
  expect(title?.target, JSON.stringify(targets)).toEqual(expect.any(String))
  const before = session.read()
  const updated = await gateway.execute('runtime-light-edit', 'update-runtime',
    { name: 'content.update', input: { target: title!.target, text: '编辑后的动态标题' } })
  applied(updated)
  const after = session.read()
  expect(after.revision).toBe(before.revision + 1)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  if (after.model.kind !== 'course-v9') throw new Error('Runtime result missing')
  const saved = driver.load(driver.serialize(after.model))
  if (saved.kind !== 'course-v9') throw new Error('Runtime reopen failed')
  const reopened = saved.project.surfaces.find(value => value.id === surface.id)
  if (!reopened || reopened.type !== 'slide') throw new Error('Runtime reopened slide missing')
  const edited = reopened.scenes[0]?.layerItems.find(value => value.layerItemId === runtime.layerItemId)
  if (!edited || edited.kind !== 'runtime') throw new Error('Runtime reopened object missing')
  expect(edited.runtime.content.values.title).toBe('编辑后的动态标题')
  expect(edited.runtime.source).toBe(runtime.runtime.source)
  const undo = await session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'runtime-human-undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied')
  const restored = session.read()
  if (restored.model.kind !== 'course-v9') throw new Error('Runtime undo model missing')
  expect(restored.model.project.surfaces).toEqual(before.model.kind === 'course-v9' ? before.model.project.surfaces : [])
  expect(restored.undoDepth).toBe(before.undoDepth)
})

it('M27-T03 replaces a Runtime picture and its resource in one formal edit and Undo', async () => {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Runtime fixture missing')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Runtime slide missing')
  const runtime = surface.scenes[0]?.layerItems.find(value => value.kind === 'runtime')
  if (!runtime || runtime.kind !== 'runtime') throw new Error('Runtime object missing')
  delete runtime.runtime.staticFallback
  driver.validate(model)
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-picture-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('save is not used') } } })
  const session = await registry.create(model, 'picture.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial), { prepareImage: prepareImageResource })
  await gateway.beginRun({ runId: 'runtime-picture', actor: 'agent',
    documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  await gateway.loadToolFamilies('runtime-picture', ['content'])
  const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
  if (!location) throw new Error('Runtime location missing')
  const object = await gateway.issueTarget('runtime-picture', session.documentId,
    { kind: 'course-object', locationId: location.id, itemId: runtime.layerItemId })
  const targets = await gateway.execute('runtime-picture', 'discover-picture',
    { name: 'content.targets', input: { target: object } })
  expect(targets.kind, JSON.stringify(targets)).toBe('read')
  if (targets.kind !== 'read') throw new Error('Runtime picture targets unavailable')
  const entries = (targets.data as { targets?: { target: string; kind: string; asset?: string }[] }).targets
  const hero = entries?.find(entry => entry.kind === 'image')
  expect(hero?.target, JSON.stringify(targets)).toEqual(expect.any(String))
  const image = Uint8Array.from(await sharp({ create: { width: 2, height: 2, channels: 4,
    background: { r: 235, g: 40, b: 60, alpha: 1 } } }).png().toBuffer())
  const resource = await gateway.provideImage('runtime-picture', session.documentId,
    { bytes: image, filename: 'new-hero.png', mimeType: 'image/png' })
  const before = session.read()
  const result = await gateway.execute('runtime-picture', 'replace-picture',
    { name: 'content.update', input: { target: hero!.target, resource } })
  applied(result)
  const after = session.read()
  expect(after.revision).toBe(before.revision + 1)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  if (after.model.kind !== 'course-v9') throw new Error('Runtime result missing')
  const saved = driver.load(driver.serialize(after.model))
  if (saved.kind !== 'course-v9') throw new Error('Runtime reopen failed')
  const reopened = saved.project.surfaces.find(value => value.id === surface.id)
  if (!reopened || reopened.type !== 'slide') throw new Error('Runtime reopened slide missing')
  const edited = reopened.scenes[0]?.layerItems.find(value => value.layerItemId === runtime.layerItemId)
  if (!edited || edited.kind !== 'runtime') throw new Error('Runtime reopened object missing')
  const oldId = runtime.runtime.assets.hero.assetId, newId = edited.runtime.assets.hero.assetId
  expect(newId).not.toBe(oldId)
  expect(saved.resources.assets[newId]).toEqual(image)
  expect(edited.runtime.source).toBe(runtime.runtime.source)
  const undo = await session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'picture-human-undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied')
  const restored = session.read()
  if (restored.model.kind !== 'course-v9') throw new Error('Runtime undo model missing')
  expect(restored.model.project.surfaces).toEqual(before.model.kind === 'course-v9' ? before.model.project.surfaces : [])
  expect(restored.model.resources.assets[newId]).toBeUndefined()
})

it('M27-T03 leaves a Runtime with an existing static fallback unchanged when no candidate capture port is available', async () => {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Runtime fixture missing')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Runtime slide missing')
  const runtime = surface.scenes[0]?.layerItems.find(value => value.kind === 'runtime')
  if (!runtime || runtime.kind !== 'runtime' || !runtime.runtime.staticFallback) throw new Error('Runtime fallback missing')
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-fallback-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('save is not used') } } })
  const session = await registry.create(model, 'fallback.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial))
  await gateway.beginRun({ runId: 'runtime-fallback', actor: 'agent',
    documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  await gateway.loadToolFamilies('runtime-fallback', ['content'])
  const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
  if (!location) throw new Error('Runtime location missing')
  const object = await gateway.issueTarget('runtime-fallback', session.documentId,
    { kind: 'course-object', locationId: location.id, itemId: runtime.layerItemId })
  const targets = await gateway.execute('runtime-fallback', 'discover-fallback',
    { name: 'content.targets', input: { target: object } })
  expect(targets.kind, JSON.stringify(targets)).toBe('read')
  if (targets.kind !== 'read') throw new Error('Runtime fallback target unavailable')
  const entries = (targets.data as { targets?: { target: string; kind: string; text?: string }[] }).targets
  const title = entries?.find(entry => entry.kind === 'text' && entry.text === '动态标题')
  expect(title?.target).toEqual(expect.any(String))
  const before = session.read()
  const result = await gateway.execute('runtime-fallback', 'update-without-capture',
    { name: 'content.update', input: { target: title!.target, text: '不应提交' } })
  expect(result.kind, JSON.stringify(result)).toBe('error')
  expect(session.read()).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: before.model })
})

it('M27-T03 consumes a fresh host observed Component image and commits picture, fallback and Undo together', async () => {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/component.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Component fixture missing')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Component slide missing')
  const component = surface.scenes[0]?.layerItems.find(value => value.kind === 'component')
  if (!component || component.kind !== 'component') throw new Error('Component object missing')
  const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
  if (!location) throw new Error('Component location missing')
  const image = Uint8Array.from(await sharp({ create: { width: 2, height: 2, channels: 4,
    background: { r: 20, g: 145, b: 190, alpha: 1 } } }).png().toBuffer())
  const packageKey = `${component.component.packageId}@${component.component.version}`
  const files = model.resources.components[packageKey]
  if (!files) throw new Error('Component package missing')
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { assets: Record<string, string> }
  manifest.assets.hero = 'hero.png'
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
  files['hero.png'] = image
  model.project.componentPackages[component.component.packageId]!.contentSha256 = componentContentSha256(files)
  driver.validate(model)
  const packageBefore = structuredClone(files)
  let serial = 0, observations = 0, captures = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `m27-component-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('save is not used') } } })
  const session = await registry.create(model, 'component.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial), {
    prepareImage: prepareImageResource,
    dynamicContentObservations: { async read(input) {
      observations++
      expect(input).toMatchObject({ documentId: session.documentId, epoch: session.read().epoch,
        revision: session.read().revision, locationId: location.id })
      return { targets: [{ kind: 'component.image', source: 'auto', revision: input.revision,
        locationId: input.locationId, itemId: component.layerItemId, assetKey: 'hero' }] }
    } },
    dynamicContentFallback: { async capture(input) {
      captures++
      expect(input.documentId).toBe(session.documentId)
      expect(input.target.field).toMatchObject({ kind: 'component.image', key: 'hero' })
      const candidateSurface = input.candidate.project.surfaces.find(value => value.id === surface.id)
      if (!candidateSurface || candidateSurface.type !== 'slide') throw new Error('Candidate slide missing')
      const candidateItem = candidateSurface.scenes[0]?.layerItems.find(value => value.layerItemId === component.layerItemId)
      expect(candidateItem?.kind === 'component' ? candidateItem.assetOverrides?.hero?.assetId : null).toEqual(expect.any(String))
      return { asset: { id: 'component-fallback-capture', filename: 'component-fallback-capture.png',
        mimeType: 'image/png', kind: 'image', path: 'assets/component-fallback-capture.png', byteLength: image.byteLength,
        width: 2, height: 2 }, bytes: image }
    } },
  })
  await gateway.beginRun({ runId: 'component-picture', actor: 'agent',
    documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  await gateway.loadToolFamilies('component-picture', ['content'])
  const object = await gateway.issueTarget('component-picture', session.documentId,
    { kind: 'course-object', locationId: location.id, itemId: component.layerItemId })
  const targets = await gateway.execute('component-picture', 'discover-component',
    { name: 'content.targets', input: { target: object } })
  expect(targets.kind, JSON.stringify(targets)).toBe('read')
  if (targets.kind !== 'read') throw new Error('Component targets unavailable')
  const entries = (targets.data as { targets?: { target: string; kind: string; source: string }[] }).targets
  const hero = entries?.find(entry => entry.kind === 'image' && entry.source === 'host-observed')
  expect(hero?.target, JSON.stringify(targets)).toEqual(expect.any(String))
  const resource = await gateway.provideImage('component-picture', session.documentId,
    { bytes: image, filename: 'new-component-hero.png', mimeType: 'image/png' })
  const before = session.read()
  const result = await gateway.execute('component-picture', 'update-component',
    { name: 'content.update', input: { target: hero!.target, resource } })
  applied(result)
  expect(observations).toBe(1)
  expect(captures).toBe(1)
  const after = session.read()
  expect(after.revision).toBe(before.revision + 1)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  if (after.model.kind !== 'course-v9') throw new Error('Component result missing')
  const saved = driver.load(driver.serialize(after.model))
  if (saved.kind !== 'course-v9') throw new Error('Component reopen failed')
  const reopened = saved.project.surfaces.find(value => value.id === surface.id)
  if (!reopened || reopened.type !== 'slide') throw new Error('Component reopened slide missing')
  const edited = reopened.scenes[0]?.layerItems.find(value => value.layerItemId === component.layerItemId)
  if (!edited || edited.kind !== 'component') throw new Error('Component reopened object missing')
  const newId = edited.assetOverrides?.hero?.assetId
  expect(newId).toEqual(expect.any(String))
  expect(saved.resources.assets[newId!]).toEqual(image)
  expect(edited.staticFallbackAssetId).toBe('component-fallback-capture')
  expect(saved.resources.assets['component-fallback-capture']).toEqual(image)
  expect(saved.resources.components[packageKey]).toEqual(packageBefore)
  const undo = await session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'component-human-undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied')
  const restored = session.read()
  if (restored.model.kind !== 'course-v9') throw new Error('Component undo model missing')
  expect(restored.model.project.surfaces).toEqual(before.model.kind === 'course-v9' ? before.model.project.surfaces : [])
  expect(restored.model.resources.assets[newId!]).toBeUndefined()
  expect(restored.model.resources.assets['component-fallback-capture']).toBeUndefined()
})
