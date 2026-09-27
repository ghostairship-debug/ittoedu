// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { CourseDocumentBridge } from '../../src/renderer/documents/CourseDocumentBridge'
import type { CourseDocumentView } from '../../src/renderer/documents/CourseDocumentView'
import { PrecommitDynamicFallback, type DynamicFallbackIntent } from '../../src/renderer/composition/runtime/precommitDynamicFallback'
import { captureCourseRuntimeContentTextTarget } from '../../src/renderer/runtime/runtimeContentTextAuthoringCommands'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent, DocumentOperation, DurableDocumentState } from '../../src/shared/workbench/document'

const driver = new CourseV9Driver()
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
type Course = Extract<ReturnType<typeof driver.load>, { kind: 'course-v9' }>
function source(withB = false, fixtureName = 'surface-runtime'): Course {
  const model = driver.load(new Uint8Array(readFileSync(`tests/fixtures/course-project-v9/${fixtureName}.h5lesson`)))
  if (model.kind !== 'course-v9') throw new Error('course fixture')
  if (withB) {
    const surface = model.project.surfaces[0]
    if (surface.type !== 'slide') throw new Error('slide fixture')
    const copy = structuredClone(surface.scenes[0]!.layerItems[0]!)
    copy.layerItemId = 'runtime-b'; copy.label = 'runtime-b'; copy.order = 3
    surface.scenes[0]!.layerItems.push(copy)
  }
  driver.validate(model)
  return model
}
async function host(withB = false, fixtureName = 'surface-runtime') {
  const durable = new Map<string, DurableDocumentState>()
  const listeners = new Set<(event: DocumentEvent) => void>()
  const operations: DocumentOperation[] = []
  let ids = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `precommit-document-${++ids}`, bindingKey: binding => binding.path,
    persistence: { async append(state) { durable.set(state.documentId, structuredClone(state)) }, async save(input) { if (input.binding.kind !== 'file') throw new Error('file required'); return input.binding } } })
  const session = await registry.create(source(withB, fixtureName), 'precommit.h5lesson')
  session.subscribe(event => { for (const listener of listeners) listener(event) })
  const api: DocumentHostAPI = {
    async bootstrapCourse() { return session.read() }, async list() { return registry.list() },
    async create(model, name) { return (await registry.create(model, name)).read() },
    async open() { throw new Error('unused') }, async read(id) { return registry.get(id).read() },
    async dispatch(operation) { operations.push(structuredClone(operation)); return registry.get(operation.documentId).execute(operation) },
    async lookup(id, operationId) { return registry.get(id).lookupOperation(operationId) },
    async save(id) { return registry.save(id) }, async saveWithDialog() { throw new Error('unused') },
    async close(id, discardDirty) { await registry.close(id, { discardDirty }) }, async closeWithDialog() { throw new Error('unused') },
    async recoverable() { return registry.list() }, async restore(id) { return (await registry.restore(durable.get(id)!)).read() },
    async discardRecovery() { throw new Error('unused') }, async observeFile() { throw new Error('unused') },
    async reconcileFile() { throw new Error('unused') }, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const projection = await DocumentProjection.attach(api, session.documentId)
  return { session, projection, api, operations, durable }
}
function item(model: Course, id: string) {
  const surface = model.project.surfaces[0]
  if (surface.type !== 'slide') throw new Error('slide fixture')
  const found = surface.scenes[0]!.layerItems.find(value => value.layerItemId === id)
  if (!found || found.kind !== 'runtime') throw new Error('runtime fixture')
  return found
}
function intent(h: Awaited<ReturnType<typeof host>>, id: string, value: string): DynamicFallbackIntent {
  const snapshot = h.session.read(), model = snapshot.model as Course
  const target = captureCourseRuntimeContentTextTarget({ sessionToken: { locationId: 'location-scene-1', surfaceType: 'slide', revision: model.project.revision, generation: 0 },
    projectId: model.project.id, surfaceId: 'surface-slide', stateId: null, owner: 'scene', sceneId: 'scene-1', itemId: id,
    contentKey: 'title', initialValue: item(model, id).runtime.content.values.title! })
  return { kind: 'runtime.text', documentId: snapshot.documentId, projectId: model.project.id,
    locationId: 'location-scene-1', itemId: id, target, value }
}
function capture() {
  let number = 0
  const seen: string[] = []
  const service = new PrecommitDynamicFallback(async (model, input) => {
    const id = `fallback-new-${++number}`
    seen.push(`${input.itemId}:${item(model, input.itemId).runtime.content.values.title}`)
    return { bytes: png, meta: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image', path: `assets/${id}.png`, byteLength: png.length, width: 1, height: 1 } }
  })
  return { service, seen }
}
const history = async (h: Awaited<ReturnType<typeof host>>, type: 'undo' | 'redo') => {
  const snapshot = h.session.read()
  return h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: crypto.randomUUID(), baseRevision: snapshot.revision,
    actor: 'human', mutation: { type } })
}

describe('M16 precommit dynamic fallback', () => {
  it('commits A then B as separate text + PNG history entries and retains A on Undo B, WAL restore and archive reopen', async () => {
    const h = await host(true), { service, seen } = capture()
    const a = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'A edited'))
    const b = service.submit(h.projection, intent(h, 'runtime-b', 'B edited'))
    expect((await a.settled).status).toBe('applied')
    expect((await b.settled).status).toBe('applied')
    expect(seen).toEqual(['slide-surface-runtime:A edited', 'runtime-b:B edited'])
    expect(h.operations).toHaveLength(2)
    expect(h.session.read().undoDepth).toBe(2)
    expect(await history(h, 'undo')).toMatchObject({ status: 'applied' })
    const undone = h.session.read().model as Course
    expect(item(undone, 'slide-surface-runtime').runtime.content.values.title).toBe('A edited')
    expect(item(undone, 'slide-surface-runtime').runtime.staticFallback?.assetId).toBe('fallback-new-1')
    expect(undone.resources.assets['fallback-new-1']).toEqual(png)
    expect(item(undone, 'runtime-b').runtime.content.values.title).toBe('动态标题')
    expect(await history(h, 'redo')).toMatchObject({ status: 'applied' })
    const archive = await driver.serialize(h.session.read().model as Course)
    expect((driver.load(archive) as Course).resources.assets['fallback-new-2']).toEqual(png)
    const restored = await DocumentSession.restore(h.durable.get(h.session.documentId)!, 'restored-epoch', driver,
      { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('file required'); return input.binding } })
    expect(item(restored.read().model as Course, 'runtime-b').runtime.content.values.title).toBe('B edited')
    h.projection.dispose()
  })

  it('replans A1 then A2 from the first ACK and Undo restores A1 text with its own PNG', async () => {
    const h = await host(), { service } = capture()
    const first = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'A1'))
    const second = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'A2'))
    expect((await first.settled).status).toBe('applied')
    expect((await second.settled).status).toBe('applied')
    expect(h.session.read().undoDepth).toBe(2)
    await history(h, 'undo')
    const undone = h.session.read().model as Course
    expect(item(undone, 'slide-surface-runtime').runtime.content.values.title).toBe('A1')
    expect(item(undone, 'slide-surface-runtime').runtime.staticFallback?.assetId).toBe('fallback-new-1')
    h.projection.dispose()
  })

  it('holds normal edits and drain during capture, and capture failure leaves zero formal writes with retryable state', async () => {
    const h = await host(), held = deferred()
    let fail = true
    const service = new PrecommitDynamicFallback(async () => { await held.promise; if (fail) throw new Error('capture failed')
      return { bytes: png, meta: { id: 'retry-image', filename: 'retry.png', mimeType: 'image/png', kind: 'image', path: 'assets/retry.png', byteLength: png.length, width: 1, height: 1 } } })
    const handle = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'draft'))
    expect(service.state(h.session.documentId)).toMatchObject([{ taskId: handle.taskId, status: 'queued' }])
    let drained = false
    const drain = h.projection.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    await expect(h.projection.edit({ type: 'course.replace', project: (h.session.read().model as Course).project,
      resources: (h.session.read().model as Course).resources })).rejects.toThrow('动态内容正在准备')
    held.resolve()
    expect(await handle.settled).toMatchObject({ status: 'failed', taskId: handle.taskId, reason: 'capture failed' })
    expect(h.operations).toHaveLength(0)
    expect(() => service.assertReady(h.session.documentId)).toThrow('capture failed')
    expect(drained).toBe(false)
    fail = false
    expect((await service.retry(handle.taskId)).status).toBe('applied')
    await drain
    expect(drained).toBe(true)
    expect(h.operations).toHaveLength(1)
    h.projection.dispose()
  })

  it('rejects a stale candidate after an external Main writer and retries the semantic intent on the new ACK', async () => {
    const h = await host(), held = deferred(), entered = deferred()
    const { service: ordinary } = capture()
    const service = new PrecommitDynamicFallback(async (model, input) => {
      entered.resolve(); await held.promise
      return ordinaryCapture(model, input)
    })
    let sequence = 0
    async function ordinaryCapture(model: Course, input: DynamicFallbackIntent) {
      const id = `external-retry-${++sequence}`
      expect(item(model, input.itemId).runtime.content.values.title).toBe('semantic edit')
      return { bytes: png, meta: { id, filename: `${id}.png`, mimeType: 'image/png' as const,
        kind: 'image' as const, path: `assets/${id}.png`, byteLength: png.length, width: 1, height: 1 } }
    }
    void ordinary
    const handle = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'semantic edit'))
    await entered.promise
    const before = h.session.read(), model = structuredClone(before.model as Course)
    model.project.title = 'external writer title'
    expect(await h.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'external-write', baseRevision: before.revision,
      actor: 'agent', mutation: { type: 'command', command: { type: 'course.replace', project: model.project, resources: model.resources } } })).toMatchObject({ status: 'applied' })
    held.resolve()
    expect((await handle.settled).status).toBe('conflict')
    expect(h.operations).toHaveLength(0)
    expect((h.session.read().model as Course).project.assets).not.toHaveProperty('external-retry-1')
    expect((await service.retry(handle.taskId)).status).toBe('applied')
    expect(h.operations).toHaveLength(1)
    expect((h.session.read().model as Course).project.title).toBe('external writer title')
    h.projection.dispose()
  })

  it('keeps the exact operation ID across an unknown ACK and a failed lookup retry', async () => {
    const h = await host(), { service } = capture()
    const dispatch = h.api.dispatch, lookup = h.api.lookup
    let lookupCount = 0
    h.api.lookup = async (id, operationId) => { if (++lookupCount === 2 || lookupCount === 3) throw new Error('lookup offline'); return lookup(id, operationId) }
    h.api.dispatch = async operation => { await dispatch(operation); throw new Error('reply lost') }
    const handle = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'unknown ACK'))
    expect((await handle.settled).status).toBe('unknown')
    expect(h.operations).toHaveLength(1)
    expect(() => service.discard(handle.taskId)).toThrow('回执未知')
    expect((await service.retry(handle.taskId)).status).toBe('unknown')
    expect((await service.retry(handle.taskId)).status).toBe('applied')
    expect(h.operations).toHaveLength(1)
    expect(h.session.read().undoDepth).toBe(1)
    h.projection.dispose()
  })

  it('keeps a later blocked draft discoverable and allows explicit sequential recovery or discard', async () => {
    const h = await host(true)
    let fail = true, image = 0
    const service = new PrecommitDynamicFallback(async () => {
      if (fail) throw new Error('capture denied')
      const id = `recovered-${++image}`
      return { bytes: png, meta: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image',
        path: `assets/${id}.png`, byteLength: png.length, width: 1, height: 1 } }
    })
    const first = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'A edit'))
    const second = service.submit(h.projection, intent(h, 'runtime-b', 'B edit'))
    expect((await first.settled).status).toBe('failed')
    expect((await second.settled).status).toBe('blocked')
    expect(service.state(h.session.documentId).map(task => task.taskId)).toEqual([first.taskId, second.taskId])
    expect(() => service.assertReady(h.session.documentId)).toThrow('capture denied')
    fail = false
    expect((await service.retry(first.taskId)).status).toBe('applied')
    expect(service.state(h.session.documentId)).toMatchObject([{ status: 'done' }, { status: 'blocked' }])
    expect((await service.retry(second.taskId)).status).toBe('applied')
    await service.wait(h.session.documentId)
    expect(h.session.read().undoDepth).toBe(2)
    const after = service.submit(h.projection, intent(h, 'runtime-b', 'B again'))
    expect((await after.settled).status).toBe('applied')
    expect(h.session.read().undoDepth).toBe(3)
    h.projection.dispose()
  })

  it('drains ordinary pending input first, then plans a dynamic intent from its acknowledged model', async () => {
    const h = await host(), { service } = capture(), held = deferred(), entered = deferred()
    const dispatch = h.api.dispatch
    let firstDispatch = true
    h.api.dispatch = async operation => { if (firstDispatch) { firstDispatch = false; entered.resolve(); await held.promise } return dispatch(operation) }
    const before = h.session.read(), model = structuredClone(before.model as Course)
    model.project.title = 'normal acknowledged title'
    const ordinary = h.projection.edit({ type: 'course.replace', project: model.project, resources: model.resources })
    await entered.promise
    const handle = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'after normal'))
    expect(service.state(h.session.documentId)).toHaveLength(1)
    held.resolve()
    expect((await ordinary).status).toBe('applied')
    expect((await handle.settled).status).toBe('applied')
    expect((h.session.read().model as Course).project.title).toBe('normal acknowledged title')
    expect(h.session.read().undoDepth).toBe(2)
    h.projection.dispose()
  })

  it('switches documents while capture is pending and restores the original view draft without presenting it as saved', async () => {
    const h = await host(), held = deferred(), entered = deferred()
    const service = new PrecommitDynamicFallback(async () => { entered.resolve(); await held.promise
      return { bytes: png, meta: { id: 'navigation-image', filename: 'navigation.png', mimeType: 'image/png', kind: 'image',
        path: 'assets/navigation.png', byteLength: png.length, width: 1, height: 1 } } })
    let view = {} as CourseDocumentView
    const bridge = new CourseDocumentBridge({ read: () => view, patch: patch => { view = { ...view, ...patch } as CourseDocumentView } }, service)
    await bridge.connect(h.api)
    const another = await h.api.create(source(), 'another.h5lesson')
    const handle = bridge.submitDynamicFallback(intent(h, 'slide-surface-runtime', 'background edit'))
    await entered.promise
    const draft = { marker: 'unsaved local view' }
    view = { ...view, flowTextEdit: draft } as unknown as CourseDocumentView
    let prepareCalled = false
    await bridge.activatePrepared(another.documentId, async () => { prepareCalled = true })
    expect(prepareCalled).toBe(false)
    expect(bridge.connection().documentId).toBe(another.documentId)
    expect(bridge.connection().documents.find(value => value.documentId === h.session.documentId)?.dirty).toBe(true)
    await bridge.activatePrepared(h.session.documentId, async () => undefined)
    expect(view.flowTextEdit).toEqual(draft)
    expect(() => bridge.readCommitted()).toThrow('动态内容及静态后备图尚未完成')
    held.resolve()
    expect((await handle.settled).status).toBe('applied')
    expect(bridge.readCommitted().documentId).toBe(h.session.documentId)
    h.projection.dispose()
  })

  it('commits a Runtime item without static fallback once without invoking capture', async () => {
    const h = await host()
    const before = h.session.read(), model = structuredClone(before.model as Course)
    delete item(model, 'slide-surface-runtime').runtime.staticFallback
    expect(await h.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'remove-fallback', baseRevision: before.revision,
      actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project: model.project, resources: model.resources } } })).toMatchObject({ status: 'applied' })
    const service = new PrecommitDynamicFallback(async () => { throw new Error('capture should not run') })
    const handle = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'plain edit'))
    expect((await handle.settled).status).toBe('applied')
    expect(h.operations).toHaveLength(1)
    expect(h.session.read().undoDepth).toBe(2)
    expect(item(h.session.read().model as Course, 'slide-surface-runtime').runtime.staticFallback).toBeUndefined()
    h.projection.dispose()
  })

  it('replans two component text rules with the same original expected text after its own ACK', async () => {
    const h = await host(false, 'component')
    let sequence = 0
    const service = new PrecommitDynamicFallback(async () => {
      const id = `component-new-${++sequence}`
      return { bytes: png, meta: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image',
        path: `assets/${id}.png`, byteLength: png.length, width: 1, height: 1 } }
    })
    const model = h.session.read().model as Course
    const common = { kind: 'component.text' as const, documentId: h.session.documentId, projectId: model.project.id,
      locationId: 'location-scene-1', itemId: 'slide-quiz', original: '标题', expectedText: '标题' }
    const first = service.submit(h.projection, { ...common, text: '一' })
    const second = service.submit(h.projection, { ...common, text: '二' })
    expect((await first.settled).status).toBe('applied')
    expect((await second.settled).status).toBe('applied')
    expect(h.session.read().undoDepth).toBe(2)
    await history(h, 'undo')
    const undo = h.session.read().model as Course
    const surface = undo.project.surfaces[0]
    if (surface.type !== 'slide') throw new Error('slide fixture')
    const card = surface.scenes[0]!.layerItems.find(value => value.layerItemId === 'slide-quiz')
    if (!card || card.kind !== 'component') throw new Error('component fixture')
    expect(card.textOverrides).toMatchObject([{ original: '标题', text: '一' }])
    expect(card.staticFallbackAssetId).toBe('component-new-1')
    expect(undo.resources.assets['component-new-1']).toEqual(png)
    h.projection.dispose()
  })

  it('starts an intent submitted immediately from the previous settled callback', async () => {
    const h = await host(), { service } = capture()
    const first = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'first'))
    expect((await first.settled).status).toBe('applied')
    const second = service.submit(h.projection, intent(h, 'slide-surface-runtime', 'second'))
    expect((await second.settled).status).toBe('applied')
    expect(h.session.read().undoDepth).toBe(2)
    await service.wait(h.session.documentId)
    expect(service.state(h.session.documentId)).toEqual([])
    await expect(service.retry(first.taskId)).rejects.toThrow('没有可重试')
    h.projection.dispose()
  })
})
