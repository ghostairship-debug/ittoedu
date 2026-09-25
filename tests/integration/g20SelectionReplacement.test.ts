import sharp from 'sharp'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createShapeNode, createImageNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { composeCourseProjectLocation } from '../../src/shared/courseLayerComposition'
import { allocateCourseLayerOrder, sortAllCourseLayerLists } from '../../src/core/tools/layerOrder'
import { composeSlideInteraction } from '../../src/core/tools/interactionCompose'
import { flowSurfaceIn, syncFlowCourseLocations } from '../../src/core/tools/flowDocumentModel'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
const load = (name: string) => driver.load(new Uint8Array(readFileSync(`tests/fixtures/course-project-v9/${name}.h5lesson`))) as Extract<DocumentModel, { kind: 'course-v9' }>
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result)); return result }
async function harness(model: ReturnType<typeof load>) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'replacement.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id), { prepareImage: prepareImageResource })
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  return { session, gateway, issue: (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }),
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }),
    project: () => (session.read().model as ReturnType<typeof load>).project,
    undo: async () => { const s = session.read(); await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId: 'undo', actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } }) } }
}
function slide(named = false) {
  const model = load('slide-native'), surface = model.project.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0], location = model.project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === scene.id)!
  for (const node of [createShapeNode('rectangle', { id: 'before', x: 20, y: 30, width: 80, height: 40 }), createImageNode({ id: 'replacement', assetId: Object.keys(model.resources.assets)[0] })]) {
    const item = sceneNodeToCourseLayerItem(node); item.order = allocateCourseLayerOrder(model.project, 0); scene.layerItems.push(item)
  }
  if (named) {
    scene.presentation = { initialStateId: 'a', states: [{ id: 'a', name: 'A', layerItemOverrides: { before: { frame: { x: 75 } } } }, { id: 'b', name: 'B', layerItemOverrides: {} }] }
    if (location.kind === 'slide-scene') location.stateId = 'a'
    scene.layerItems.find(item => item.layerItemId === 'replacement')!.visible = false
    scene.presentation.states[0].layerItemOverrides.replacement = { visible: true }
  }
  scene.interactions.push(composeSlideInteraction(model.project, { locationId: location.id, surfaceId: surface.id, ...(named ? { stateId: 'a' } : {}) }, scene, 'click-before', { operation: 'compose', trigger: { kind: 'click', node: 'before' }, effects: [{ kind: 'next-scene' }] }))
  if (named) scene.interactions.at(-1)!.conditions = [{ type: 'presentation.in', stateIds: ['a'] }]
  sortAllCourseLayerLists(model.project)
  return { model, scene, location, surface }
}

it('replaces Native carriers with derived references, resources, durable replay, one History and original-format reopen', async () => {
  const v = slide(), f = await harness(v.model), before = f.session.read()
  const t = (itemId: string): ToolTarget => ({ kind: 'course-object', locationId: v.location.id, itemId })
  const target = await f.issue(t('before')), replacement = await f.issue(t('replacement'))
  expect(await f.invoke('readonly', 'selection.replace', { target, replacement: await f.issue(t('replacement'), true) })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const call = { target, replacement }, result = applied(await f.invoke('replace', 'selection.replace', call))
  expect(await f.invoke('replace', 'selection.replace', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const surface = f.project().surfaces.find(surface => surface.id === v.surface.id)!
  if (surface.type !== 'slide') throw new Error('slide')
  expect(surface.scenes[0].layerItems.some(item => item.layerItemId === 'before')).toBe(false)
  expect(surface.scenes[0].layerItems.find(item => item.layerItemId === 'replacement')!.frame).toEqual(v.scene.layerItems.find(item => item.layerItemId === 'before')!.frame)
  expect(surface.scenes[0].interactions.at(-1)!.trigger).toMatchObject({ nodeId: 'replacement' })
  expect(await f.gateway.resolveEditTarget('r', result.affected[0])).toMatchObject({ target: { itemId: 'replacement' } })
  const after = f.session.read(); expect(after.undoDepth).toBe(1); expect(after.model.resources).toEqual(before.model.resources)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await f.undo(); expect(f.project().surfaces).toEqual(v.model.project.surfaces)
})

it('keeps inherited base and other named state while replacing only exact state and refuses cross-state or incompatible unscoped references atomically', async () => {
  const v = slide(true), f = await harness(v.model)
  const target = await f.issue({ kind: 'course-object', locationId: v.location.id, stateId: 'a', itemId: 'before' })
  const replacement = await f.issue({ kind: 'course-object', locationId: v.location.id, stateId: 'a', itemId: 'replacement' })
  const other = await f.issue({ kind: 'course-object', locationId: v.location.id, stateId: 'b', itemId: 'replacement' })
  expect(await f.invoke('wrong-state', 'batch', { operations: [{ name: 'object.update', input: { target, properties: { opacity: 0.2 } } }, { name: 'selection.replace', input: { target, replacement: other } }] })).toMatchObject({ kind: 'error' })
  expect(f.session.read().undoDepth).toBe(0)
  applied(await f.invoke('replace', 'selection.replace', { target, replacement }))
  const view = (stateId: string | null) => composeCourseProjectLocation({ project: f.project(), locationId: v.location.id, stateId }).entries
  expect(view('a').find(entry => entry.item.layerItemId === 'before')!.mounted).toBe(false)
  expect(view('a').find(entry => entry.item.layerItemId === 'replacement')!.item.frame.x).toBe(75)
  expect(view('b').find(entry => entry.item.layerItemId === 'before')!.mounted).toBe(true)
  expect(view('b').find(entry => entry.item.layerItemId === 'replacement')!.mounted).toBe(false)
  expect(view(null).find(entry => entry.item.layerItemId === 'before')!.item).toEqual(v.scene.layerItems.find(item => item.layerItemId === 'before'))
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(v.model.project.surfaces)
  const invalid = slide(true); invalid.scene.interactions.at(-1)!.conditions = []
  const g = await harness(invalid.model)
  expect(await g.invoke('unscoped', 'selection.replace', { target: await g.issue({ kind: 'course-object', locationId: invalid.location.id, stateId: 'a', itemId: 'before' }), replacement: await g.issue({ kind: 'course-object', locationId: invalid.location.id, stateId: 'a', itemId: 'replacement' }) })).toMatchObject({ kind: 'error' })
  expect(g.session.read().undoDepth).toBe(0)
})

it('replaces unmounted Flow headings at their exact parent while preserving navigation identity, adjacent content, resources and undo', async () => {
  const model = load('flow'), surface = model.project.surfaces.find(surface => surface.type === 'flow')!
  if (surface.type !== 'flow') throw new Error('flow')
  surface.blocks = [{ id: 'old-heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Old' }] } }, { id: 'adjacent', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Keep' }] } }, { id: 'new-heading', type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: 'New' }] } }]
  syncFlowCourseLocations(model.project, surface.id)
  const anchor = model.project.locations.find(location => location.kind === 'flow-block' && location.blockId === 'old-heading')!
  const f = await harness(model), target = await f.issue({ kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'old-heading' })
  const paragraph = await f.issue({ kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'adjacent' })
  expect(await f.invoke('bad-anchor', 'selection.replace', { target, replacement: paragraph })).toMatchObject({ kind: 'error' })
  expect(f.session.read().undoDepth).toBe(0)
  applied(await f.invoke('flow-replace', 'selection.replace', { target, replacement: await f.issue({ kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'new-heading' }) }))
  expect(flowSurfaceIn(f.project(), surface.id).blocks.map(block => block.id)).toEqual(['new-heading', 'adjacent'])
  expect(f.project().locations.find(location => location.id === anchor.id)).toMatchObject({ blockId: 'new-heading' })
  expect(f.session.read().model.resources).toEqual(model.resources); expect(f.session.read().undoDepth).toBe(1)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(model.project.surfaces); expect(f.project().locations).toEqual(model.project.locations)
})

it('atomically imports, creates and replaces a named-state shape from a previous batch result with resource undo and no leaked failed creation', async () => {
  const v = slide(true), f = await harness(v.model), before = f.session.read()
  const ownerTarget: ToolTarget = { kind: 'course-owner', owner: 'scene', locationId: v.location.id, stateId: 'a' }
  const owner = await f.issue(ownerTarget), target = await f.issue({ kind: 'course-object', locationId: v.location.id, stateId: 'a', itemId: 'before' })
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#aacc00' } }).png().toBuffer()
  const resource = await f.gateway.provideImage('r', f.session.documentId, { filename: 'batch.png', mimeType: 'image/png', bytes })
  const operations = [{ name: 'media.insert', input: { target: owner, resource, properties: {} } }, { name: 'selection.replace', input: { target, replacement: { $result: { step: 0 } } } }]
  expect(await f.invoke('readonly-create', 'batch', { operations: [{ ...operations[0], input: { ...operations[0].input, target: await f.issue(ownerTarget, true) } }, operations[1]] })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('invalid-final', 'batch', { operations: [...operations, { name: 'owner.background', input: { target: await f.issue({ kind: 'course-background', owner: 'course' }), properties: { backgroundAssetId: 'does-not-exist' } } }] })).toMatchObject({ kind: 'error' })
  expect(f.session.read().undoDepth).toBe(0); expect(f.session.read().model).toEqual(before.model)
  const result = applied(await f.invoke('batch-result', 'batch', { operations }))
  const created = (await f.gateway.resolveEditTarget('r', result.affected[1])).target
  if (created.kind !== 'course-object') throw new Error('object')
  expect(created.itemId).not.toBe('before'); expect(created.stateId).toBe('a')
  const view = (stateId: string | null) => composeCourseProjectLocation({ project: f.project(), locationId: v.location.id, stateId }).entries
  expect(view('a').find(entry => entry.item.layerItemId === created.itemId)).toMatchObject({ mounted: true, item: { frame: { x: 75 } } })
  expect(view('a').find(entry => entry.item.layerItemId === 'before')!.mounted).toBe(false)
  expect(view('b').find(entry => entry.item.layerItemId === created.itemId)!.mounted).toBe(false)
  expect(Object.keys(f.session.read().model.resources.assets)).toHaveLength(Object.keys(v.model.resources.assets).length + 1)
  expect(f.session.read().undoDepth).toBe(1)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  applied(await f.invoke('batch-result', 'batch', { operations })); expect(f.session.read().undoDepth).toBe(1)
  await f.undo(); expect(f.project().surfaces).toEqual(v.model.project.surfaces); expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('binds only earlier creation results for Flow replacement and rejects forged, forward, modified or standalone result bindings', async () => {
  const model = load('flow'), surface = model.project.surfaces.find(surface => surface.type === 'flow')!
  if (surface.type !== 'flow') throw new Error('flow')
  surface.blocks = [{ id: 'old-heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Old' }] } }]
  syncFlowCourseLocations(model.project, surface.id)
  const f = await harness(model), target = await f.issue({ kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'old-heading' }), parent = await f.issue({ kind: 'flow-container', surfaceId: surface.id, parentId: null })
  const insert = { name: 'document.insert', input: { target: parent, block: { type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: 'Created' }] } } } }
  const replace = { name: 'selection.replace', input: { target, replacement: { $result: { step: 0 } } } }
  expect(await f.invoke('standalone-result', replace.name, replace.input)).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await f.invoke('forward', 'batch', { operations: [replace, insert] })).toMatchObject({ kind: 'error', code: 'invalid-result-reference' })
  expect(await f.invoke('modified-result', 'batch', { operations: [{ name: 'text.replace', input: { target, content: 'Uncommitted' } }, replace] })).toMatchObject({ kind: 'error', code: 'invalid-result-reference' })
  expect(await f.invoke('forged', 'batch', { operations: [insert, { ...replace, input: { target, replacement: { $result: { step: 0, itemId: 'forged' } } } }] })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(f.session.read().undoDepth).toBe(0); expect(f.project().surfaces).toEqual(model.project.surfaces)
  applied(await f.invoke('flow-batch-result', 'batch', { operations: [insert, replace] }))
  expect(flowSurfaceIn(f.project(), surface.id).blocks).toHaveLength(1)
  expect(flowSurfaceIn(f.project(), surface.id).blocks[0]).toMatchObject({ type: 'heading', content: { inlines: [{ text: 'Created' }] } })
  expect(f.session.read().undoDepth).toBe(1)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(model.project.surfaces)
})
