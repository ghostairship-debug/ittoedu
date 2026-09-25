// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createShapeNode, createImageNode, createTableNode, createChartNode, createTableLayerItem, createChartLayerItem } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { allocateCourseLayerOrder, sortAllCourseLayerLists } from '../../src/core/tools/layerOrder'
import { composeSlideInteraction } from '../../src/core/tools/interactionCompose'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolTarget, ToolResult } from '../../src/shared/workbench/tools'

const driver = new CourseV9Driver()
function fixture() {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const surface = model.project.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0], location = model.project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === scene.id)!
  const assetId = Object.keys(model.resources.assets)[0]
  for (const node of [createShapeNode('rectangle', { id: 'shape-a', x: 20, y: 30, width: 100, height: 60 }), createShapeNode('rectangle', { id: 'shape-b', x: 230, y: 110, width: 80, height: 70 }), createShapeNode('rectangle', { id: 'shape-c', x: 650, y: 230, width: 120, height: 90 }), createImageNode({ id: 'picture', assetId }), createTableNode({ id: 'table' }), createChartNode({ id: 'chart' })]) {
    const item = node.type === 'table' ? createTableLayerItem(node) : node.type === 'chart' ? createChartLayerItem(node) : sceneNodeToCourseLayerItem(node); item.order = allocateCourseLayerOrder(model.project, 0); scene.layerItems.push(item)
  }
  for (const [id, plane] of [['global-back', 'underlay'], ['global-front', 'overlay']] as const) {
    const item = sceneNodeToCourseLayerItem(createShapeNode('rectangle', { id, x: 10, y: 10 })); item.order = allocateCourseLayerOrder(model.project, 0)
    model.project.globalLayerItems.push({ item, plane, visibility: { mode: 'all', locationIds: [] } })
  }
  sortAllCourseLayerLists(model.project)
  return { model, scene, location, surface }
}
async function harness(localOnly = false) {
  const f = fixture(); let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('not requested') } } })
  const session = await registry.create(f.model, 'layers.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  const owner: ToolTarget = { kind: 'course-owner', locationId: f.location.id, owner: 'scene' }
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [localOnly ? owner : { kind: 'document' }] }] })
  return { ...f, registry, session, gateway, object: (itemId: string) => gateway.issueTarget('r', session.documentId, { kind: 'course-object', locationId: f.location.id, itemId }), owner: (scope: 'scene' | 'global' = 'scene') => gateway.issueTarget('r', session.documentId, { kind: 'course-owner', locationId: f.location.id, owner: scope }), invoke: (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input }) }
}
function applied(result: ToolResult) { expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result)); return result }
function project(snapshot: DocumentSnapshot) { if (snapshot.model.kind !== 'course-v9') throw new Error('course'); return snapshot.model.project }
async function undo(f: Awaited<ReturnType<typeof harness>>, id: string) { const before = f.session.read(); await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: id, actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } }) }

it('duplicates real Native images/table/chart with independent identities, preserved resources, reopen and a single undo under local owner authority', async () => {
  const f = await harness(true), owner = await f.owner(), before = f.session.read()
  const sourceIds = ['picture', 'table', 'chart'], sources = await Promise.all(sourceIds.map(f.object))
  const result = applied(await f.invoke('copies', 'batch', { operations: sources.map(target => ({ name: 'layer.duplicate', input: { target, owner, placement: { side: 'right', gap: 12 } } })) }))
  const after = f.session.read(); expect(after.undoDepth).toBe(1); expect(after.model.resources).toEqual(before.model.resources)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  for (let index = 0; index < result.affected.length; index++) {
    const target = (await f.gateway.resolveEditTarget('r', result.affected[index])).target
    if (target.kind !== 'course-object') throw new Error('object')
    expect(target.itemId).not.toBe(sourceIds[index])
    const original = locateCourseLayer(project(before), sourceIds[index])!.item, copied = locateCourseLayer(project(after), target.itemId)!.item
    expect(copied.frame.x).toBe(original.frame.x + original.frame.width + 12)
    if (original.kind === 'native' && copied.kind === 'native' && original.content.nativeType === 'table' && copied.content.nativeType === 'table') {
      expect(copied.content.data.rows.map(row => row.id).some(id => original.content.nativeType === 'table' && original.content.data.rows.some(row => row.id === id))).toBe(false)
      expect(copied.content.data.columns.map(column => column.id).some(id => original.content.nativeType === 'table' && original.content.data.columns.some(column => column.id === id))).toBe(false)
    }
    if (original.kind === 'native' && copied.kind === 'native' && original.content.nativeType === 'chart' && copied.content.nativeType === 'chart') expect(copied.content.data.series[0].id).not.toBe(original.content.data.series[0].id)
  }
  const global = await f.object('global-front')
  expect(await f.invoke('scope-escape', 'layer.delete', { target: global })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  await undo(f, 'undo-copies'); expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces); expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('deletes referenced Native objects atomically, cleans rules, retains archive assets and restores references on undo', async () => {
  const f = await harness(), state = f.session.read(), next = structuredClone(project(state))
  const surface = next.surfaces.find(surface => surface.id === f.surface.id)!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0]
  scene.interactions.push(composeSlideInteraction(next, { locationId: f.location.id, surfaceId: f.surface.id }, scene, 'click-picture', { operation: 'compose', trigger: { kind: 'click', node: 'picture' }, effects: [{ kind: 'next-scene' }] }))
  await f.session.execute({ documentId: state.documentId, epoch: state.epoch, operationId: 'seed-rule', actor: 'human', baseRevision: state.revision, mutation: { type: 'command', command: { type: 'course.replace', project: next } } })
  const before = f.session.read(), picture = await f.object('picture'), shape = await f.object('shape-a')
  applied(await f.invoke('delete', 'batch', { operations: [{ name: 'layer.delete', input: { target: picture } }, { name: 'layer.delete', input: { target: shape } }] }))
  const after = f.session.read(); expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(locateCourseLayer(project(after), 'picture')).toBeNull(); expect(locateCourseLayer(project(after), 'shape-a')).toBeNull()
  expect(JSON.stringify(project(after))).not.toContain('click-picture'); expect(after.model.resources).toEqual(before.model.resources)
  expect(project(after).globalLayerItems).toEqual(project(before).globalLayerItems)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await undo(f, 'undo-delete'); expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces)
})

it('aligns and distributes unmounted layers through shared geometry while rejecting cross-owner/plane reorder and partial batches', async () => {
  const f = await harness(), owner = await f.owner(), globalOwner = await f.owner('global'), ids = ['shape-a', 'shape-b', 'shape-c'], handles = await Promise.all(ids.map(f.object))
  const global = await f.object('global-front'), underlay = await f.object('global-back'), baseline = f.session.read()
  expect(await f.invoke('plane', 'layer.reorder', { target: global, owner: globalOwner, position: { kind: 'before', sibling: underlay } })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('owner', 'layer.duplicate', { target: handles[0], owner: globalOwner, placement: { side: 'right', gap: 4 } })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('atomic-invalid', 'batch', { operations: [{ name: 'layer.delete', input: { target: handles[0] } }, { name: 'layer.align', input: { target: handles[1], targets: [handles[1], global], mode: 'top' } }] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(baseline)
  applied(await f.invoke('layout', 'batch', { operations: [{ name: 'layer.align', input: { target: handles[0], targets: handles, mode: 'top' } }, { name: 'layer.distribute', input: { target: handles[0], targets: handles, axis: 'horizontal' } }, { name: 'layer.reorder', input: { target: handles[0], owner, position: { kind: 'front' } } }] }))
  const after = f.session.read(), items = ids.map(id => locateCourseLayer(project(after), id)!.item)
  expect(new Set(items.map(item => item.frame.y)).size).toBe(1)
  expect(items[1].frame.x - items[0].frame.x - items[0].frame.width).toBe(items[2].frame.x - items[1].frame.x - items[1].frame.width)
  expect(project(after).globalLayerItems).toEqual(project(baseline).globalLayerItems)
  expect(after.undoDepth).toBe(1); expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await undo(f, 'undo-layout'); expect(project(f.session.read()).surfaces).toEqual(project(baseline).surfaces)
})
