// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent, DocumentOperation, DurableDocumentState } from '../../src/shared/workbench/document'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import { useEditorStore, selectActiveCourseProjectDocument, selectActiveCourseLocationId, selectSelectedNodeId } from '../../src/renderer/store/editorStore'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { createCoursewareBuilderV2WithOwner } from '../../src/renderer/course/coursewareBuilderV2'
import { captureBackgroundTargets } from '../../src/renderer/authoring/tools/backgroundTool'
import { CourseDocumentBridge } from '../../src/renderer/documents/CourseDocumentBridge'
import type { CourseDocumentView } from '../../src/renderer/documents/CourseDocumentView'

const driver = new CourseV9Driver()
const fixture = () => driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson')))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
async function host() {
  let count = 0
  const durable = new Map<string, DurableDocumentState>(), disk = new Map<string, Uint8Array>(), listeners = new Set<(event: DocumentEvent) => void>()
  const controls: { before?(operation: DocumentOperation): Promise<void>; after?(operation: DocumentOperation): Promise<void>; save?(): Promise<void> } = {}
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `course-${++count}`, bindingKey: binding => binding.path,
    persistence: { async append(state) { durable.set(state.documentId, structuredClone(state)) }, async save(input) {
      await controls.save?.(); if (input.binding.kind !== 'file') throw new Error('path')
      disk.set(input.binding.path, input.bytes.slice()); return { ...input.binding, version: `saved-${input.revision}` }
    } } })
  const observed = new Set<string>()
  const subscribeSession = (id: string) => { if (!observed.has(id)) { observed.add(id); registry.get(id).subscribe(event => { for (const listener of listeners) listener(event) }) } }
  const first = await registry.create(fixture(), 'mixed.h5lesson'); subscribeSession(first.documentId)
  const api: DocumentHostAPI = {
    async bootstrapCourse() { return first.read() },
    async list() { return registry.list() }, async read(id) { return registry.get(id).read() },
    async create(model, name) { const value = await registry.create(model, name); subscribeSession(value.documentId); return value.read() },
    async open(path) { const value = await registry.open({ kind: 'file', path, version: null, bindingVersion: 1 }, async () => driver.load(disk.get(path)!)); subscribeSession(value.documentId); return value.read() },
    async dispatch(operation) { await controls.before?.(operation); const result = await registry.get(operation.documentId).execute(operation); await controls.after?.(operation); return result },
    async lookup(id, operationId) { return registry.get(id).lookupOperation(operationId) },
    async save(id, path) { return registry.save(id, path ? { kind: 'file', path, version: null, bindingVersion: 1 } : undefined) },
    async saveWithDialog(id) { return api.save(id, 'saved.h5lesson') },
    async closeWithDialog(id) { await registry.close(id, { discardDirty: true }); return true },
    async close(id, discardDirty) { await registry.close(id, { discardDirty }) },
    async recoverable() { return registry.list() },
    async restore(id) { const value = await registry.restore(durable.get(id)!); subscribeSession(id); return value.read() },
    async discardRecovery(id) { durable.delete(id) },
    async observeFile() { throw new Error('Not part of this transport fixture') }, async reconcileFile() { throw new Error('Not part of this transport fixture') },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  await useEditorStore.getState().connectCourseDocuments(api)
  return { api, registry, first, controls, disk }
}
const state = () => useEditorStore.getState()
const project = () => selectActiveCourseProjectDocument(state())!
const noLocalHistory = () => {
  const value = state().spatialSession?.history ?? state().flowSession?.history ?? state().slideBackend?.getSession().history
  expect(value?.past).toHaveLength(0); expect(value?.future).toHaveLength(0)
  expect(state().courseAssetSidecarPast).toHaveLength(0); expect(state().courseComponentPackagesPast).toHaveLength(0)
}

describe('G20 default course writer projection', () => {
  it('S04-T01 gives renderer authoring and AI Gateway the same background content, validation and undo semantics', async () => {
    const h = await host()
    const before = structuredClone(h.first.read().model)
    const baseRevision = h.first.read().revision
    const agentDocument = await h.registry.create(before, 'agent.h5lesson')
    const builder = createCoursewareBuilderV2WithOwner(state().createCoursewareBuilderOwner())
    const uiTarget = captureBackgroundTargets({ document: project(), sessionToken: state().courseAuthoringSession!.token, stateId: null, reference: 'page' })[0]!.target
    const location = project().locations.find(entry => entry.id === uiTarget.locationId)
    const aiTarget: ToolTarget = uiTarget.owner === 'scene' && location?.kind === 'slide-scene'
      ? { kind: 'course-background', owner: 'scene', surfaceId: uiTarget.surfaceId, sceneId: location.sceneId }
      : uiTarget.owner === 'surface'
        ? { kind: 'course-background', owner: 'surface', surfaceId: uiTarget.surfaceId }
        : (() => { throw new Error('Expected a page background') })()
    const gateway = new DocumentToolGateway(h.registry, [driver], () => 'parity-id')
    await gateway.beginRun({ runId: 'parity', actor: 'agent', documents: [{ documentId: agentDocument.documentId, writable: [{ kind: 'document' }] }] })
    const handle = await gateway.issueTarget('parity', agentDocument.documentId, aiTarget)

    const invalid = { backgroundAssetId: 'missing-asset' }
    const uiRejected = await builder.execute('owner.background', invalid, { kind: 'update', target: uiTarget })
    const aiRejected = await gateway.execute('parity', 'invalid', { name: 'owner.background', input: { target: handle, properties: invalid } })
    expect(uiRejected.status).not.toBe('committed')
    expect(aiRejected.kind).toBe('error')
    expect(h.first.read().revision).toBe(baseRevision)
    expect(agentDocument.read().revision).toBe(baseRevision)

    const color = { backgroundColor: '#112233' }
    expect((await builder.execute('owner.background', color, { kind: 'update', target: uiTarget })).status).toBe('committed')
    expect(await gateway.execute('parity', 'valid', { name: 'owner.background', input: { target: handle, properties: color } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: baseRevision + 1 } })
    const ui = h.first.read(), agent = agentDocument.read()
    if (ui.model.kind !== 'course-v9' || agent.model.kind !== 'course-v9' || before.kind !== 'course-v9') throw new Error('Course fixture required')
    expect(agent.model.project.surfaces).toEqual(ui.model.project.surfaces)
    expect(agent.model.resources).toEqual(ui.model.resources)
    expect(ui.undoDepth).toBe(1)
    expect(agent.undoDepth).toBe(1)
    state().undo()
    await vi.waitFor(() => expect(h.first.read().undoDepth).toBe(0))
    const current = agentDocument.read()
    expect((await agentDocument.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'agent-undo', actor: 'human',
      baseRevision: current.revision, mutation: { type: 'undo' } })).status).toBe('applied')
    const undoneUi = h.first.read().model, undoneAgent = agentDocument.read().model
    if (undoneUi.kind !== 'course-v9' || undoneAgent.kind !== 'course-v9') throw new Error('Course fixture required')
    expect(undoneUi.project.surfaces).toEqual(before.project.surfaces)
    expect(undoneAgent.project.surfaces).toEqual(before.project.surfaces)
    expect(undoneUi.resources).toEqual(before.resources)
    expect(undoneAgent.resources).toEqual(before.resources)
    noLocalHistory()
  })

  it('keeps a user-focused restored course when bootstrap replies after navigation', async () => {
    const h = await host(), held = deferred()
    const bootstrap = h.api.bootstrapCourse
    h.api.bootstrapCourse = async () => { await held.promise; return bootstrap() }
    const recovered = await h.api.create(fixture(), 'recovered.h5lesson')
    let view = { ...state() } as CourseDocumentView
    const bridge = new CourseDocumentBridge({ read: () => view, patch: patch => { view = { ...view, ...patch } as CourseDocumentView } })
    const connecting = bridge.connect(h.api)
    await bridge.activate(recovered.documentId)
    expect(bridge.connection().documentId).toBe(recovered.documentId)
    held.resolve(); await connecting
    expect(bridge.connection().documentId).toBe(recovered.documentId)
    expect(bridge.connection().documents.map(item => item.documentId)).toContain(recovered.documentId)
  })

  it('M02 hides bootstrap and keeps same-project copies independent through cancel/close and last-tab empty state', async () => {
    const h = await host()
    expect(state().courseDocument.documents).toEqual([])
    const one = await h.api.create(fixture(), 'one.h5lesson')
    const two = await h.api.create(fixture(), 'two.h5lesson')
    await state().activateCourseDocument(one.documentId)
    state().renameProject('Only first copy'); await state().drainCourseDocument()
    await state().activateCourseDocument(two.documentId)
    expect(project().id).toBe((one.model as { project: { id: string } }).project.id)
    expect(project().title).not.toBe('Only first copy')
    expect(h.registry.get(one.documentId).read().undoDepth).toBe(1)
    expect(h.registry.get(two.documentId).read().undoDepth).toBe(0)
    const close = h.api.closeWithDialog
    h.api.closeWithDialog = async () => false
    expect(await state().closeCourseDocument(two.documentId)).toBe(false)
    expect(state().courseDocument.documents).toHaveLength(2)
    h.api.closeWithDialog = close
    expect(await state().closeCourseDocument(two.documentId)).toBe(true)
    expect(state().courseDocument.documentId).toBe(one.documentId)
    expect(project().title).toBe('Only first copy')
    expect(h.registry.get(one.documentId).read().undoDepth).toBe(1)
    expect(await state().closeCourseDocument(one.documentId)).toBe(true)
    expect(state().courseDocument.documents).toEqual([])
    expect(state().courseDocument.documentId).toBeNull()
    expect(h.registry.list()).toHaveLength(1) // internal bootstrap, never a replacement blank
    await state().connectCourseDocuments(h.api)
    expect(state().courseDocument.documentId).toBeNull()
    await state().createCourseDocument('flow')
    expect(state().courseDocument.documents).toHaveLength(1)
  })

  it('prepares background course drafts for close, waits for their ACK and restores the foreground', async () => {
    const h = await host()
    state().addTextNode(); await state().drainCourseDocument()
    const itemId = selectSelectedNodeId(state())!
    state().beginTextEdit(itemId, 'properties'); state().updateTextEditDraft(itemId, 'background unfinished input', [])
    expect(state().v9ContentEdit).toBeTruthy()
    await state().createCourseDocument('flow')
    const foreground = state().courseDocument.documentId!
    const entered = deferred(), release = deferred()
    h.controls.after = async operation => { if (operation.documentId === h.first.documentId) { entered.resolve(); await release.promise } }
    let settled = false
    const prepared = state().drainAllCourseDocuments().then(value => { settled = true; return value })
    await entered.promise
    expect(settled).toBe(false)
    expect(state().courseDocument.documentId).toBe(foreground)
    release.resolve(); await prepared
    const actual = h.first.read().model
    if (actual.kind !== 'course-v9') throw new Error('fixture')
    expect(locateCourseLayer(actual.project, itemId)?.item).toMatchObject({ content: { data: { text: 'background unfinished input' } } })
    expect(state().courseDocument.documentId).toBe(foreground)
    await state().activateCourseDocument(h.first.documentId)
    expect(state().v9ContentEdit).toBeNull()
    noLocalHistory()
  })

  it('blocks close when fresh temporary input arrives while another course ACK is pending', async () => {
    const h = await host()
    state().addTextNode(); await state().drainCourseDocument()
    const itemId = selectSelectedNodeId(state())!
    const entered = deferred(), release = deferred()
    h.controls.after = async () => { entered.resolve(); await release.promise }
    state().renameProject('pending before close')
    const prepared = state().drainAllCourseDocuments()
    await entered.promise
    state().beginTextEdit(itemId, 'properties'); state().updateTextEditDraft(itemId, 'new input after preparation', [])
    release.resolve()
    await expect(prepared).rejects.toThrow('新的输入')
    expect(state().v9ContentEdit).toMatchObject({ draft: { text: 'new input after preparation' } })
    expect(h.first.read().model).toMatchObject({ project: { title: 'pending before close' } })
  })

  it('routes rapid edits across all three surfaces to one real Session and preserves navigation while ACKs arrive', async () => {
    const h = await host(), held = deferred(), applied = deferred(); let first = true
    h.controls.after = async () => { if (first) { first = false; applied.resolve(); await held.promise } }
    const locations = project().locations
    state().renameProject('first input')
    state().renameProject('latest input')
    expect(project().title).toBe('latest input'); noLocalHistory()
    const flow = locations.find(value => value.kind === 'flow-block')!
    state().activateCourseLocation(flow.id)
    await applied.promise
    expect(selectActiveCourseLocationId(state())).toBe(flow.id)
    held.resolve(); await state().drainCourseDocument()
    expect(project().title).toBe('latest input'); expect(selectActiveCourseLocationId(state())).toBe(flow.id)
    state().renameProject('flow input'); await state().drainCourseDocument(); noLocalHistory()
    const spatial = locations.find(value => value.kind === 'spatial-camera')!
    state().activateCourseLocation(spatial.id); state().renameProject('spatial input'); await state().drainCourseDocument(); noLocalHistory()
    expect(h.first.read().undoDepth).toBe(4)
    state().undo(); await vi.waitFor(() => expect(h.first.read().model).toMatchObject({ project: { title: 'flow input' } }))
    await state().drainCourseDocument(); expect(selectActiveCourseLocationId(state())).toBe(spatial.id); noLocalHistory()
    state().redo(); await vi.waitFor(() => expect(project().title).toBe('spatial input'))
  })

  it('saves a fixed acknowledged version with real archive bytes and reopens it without taking later edits', async () => {
    const h = await host(), held = deferred(), saving = deferred()
    state().renameProject('saved version'); await state().drainCourseDocument()
    h.controls.save = async () => { saving.resolve(); await held.promise }
    const save = state().saveCourseDocument()
    await saving.promise
    state().renameProject('later edit'); await state().drainCourseDocument()
    held.resolve(); await save
    expect(driver.load(h.disk.get('saved.h5lesson')!)).toMatchObject({ project: { title: 'saved version' } })
    expect(project().title).toBe('later edit'); expect(state().dirty).toBe(true)
    const previousId = state().courseDocument.documentId!
    await state().createCourseDocument('flow')
    await h.api.close(previousId, true)
    await state().openCourseDocument('saved.h5lesson')
    expect(project().title).toBe('saved version'); expect(state().dirty).toBe(false); noLocalHistory()
  })

  it('keeps a rejected human draft visible, preserves the external result, and leaves another document editable', async () => {
    const h = await host(), held = deferred(), sent = deferred()
    h.controls.before = async () => { sent.resolve(); await held.promise }
    state().renameProject('retained human input'); await sent.promise
    const baseline = h.first.read()
    if (baseline.model.kind !== 'course-v9') throw new Error('fixture')
    await h.first.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId: 'external', baseRevision: baseline.revision, actor: 'external',
      mutation: { type: 'command', command: { type: 'course.replace', project: { ...baseline.model.project, title: 'external preserved' } } } })
    held.resolve()
    await expect(state().drainCourseDocument()).rejects.toThrow()
    expect(project().title).toBe('retained human input')
    expect(state().courseDocument.error).toBeTruthy()
    expect(h.first.read().model).toMatchObject({ project: { title: 'external preserved' } })
    h.controls.before = undefined
    await state().createCourseDocument('slide'); state().renameProject('independent document'); await state().drainCourseDocument()
    expect(project().title).toBe('independent document')
    await state().activateCourseDocument(baseline.documentId)
    expect(project().title).toBe('retained human input'); expect(state().courseDocument.error).toBeTruthy(); noLocalHistory()
  })

  it('does not publish a tool committed receipt before the real main ACK and keeps the background destination explicit', async () => {
    const h = await host(), applied = deferred(), held = deferred()
    const builder = createCoursewareBuilderV2WithOwner(state().createCoursewareBuilderOwner())
    const target = captureBackgroundTargets({ document: project(), sessionToken: state().courseAuthoringSession!.token, stateId: null, reference: 'page' })[0]!.target
    h.controls.after = async () => { applied.resolve(); await held.promise }
    let settled = false
    const receipt = builder.execute('owner.background', { backgroundColor: '#112233' }, { kind: 'update', target }).then(result => { settled = true; return result })
    expect(await Promise.race([applied.promise.then(() => null), receipt])).toBeNull()
    expect(settled).toBe(false)
    const other = project().locations.find(location => location.kind === 'flow-block')!
    state().activateCourseLocation(other.id)
    held.resolve()
    expect((await receipt).status).toBe('committed')
    expect(h.first.read().undoDepth).toBe(1)
    expect(selectActiveCourseLocationId(state())).toBe(other.id)
    noLocalHistory()
  })
})
