// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { planNativeInsertion } from '../../src/core/tools/nativeInsertion'
import { addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
function applied(r: ToolResult) { expect(r, JSON.stringify(r)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (r.kind !== 'document-operation') throw new Error('ACK'); return r }
function fixture() { return driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }> }
async function harness(model = fixture(), scope: ToolTarget[] = [{ kind: 'document' }]) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'pages.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: scope }] })
  return { model, session, gateway, issue: (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }), project: () => (session.read().model as typeof model).project,
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }), undo: async (operationId = 'undo') => { const s = session.read(); await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId, actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } }) } }
}

import { spatialSurfaceIn } from '../../src/core/tools/spatialInsertion'
import { resolveSpatialPlaybackSchedule } from '../../src/core/tools/spatialPath'
import { openSpatialAuthoringSession } from '../../src/renderer/course/spatialEditorCommands'
import { spatialSessionCameraFittingWorldContent } from '../../src/renderer/course/spatialCameraCommands'

function spatialFixture() {
  const model = fixture(); let nextId = 0
  for (let n = 0; n < 2; n++) {
    const result = addCourseSpatialPage(model.project, { title: `World ${n}` }); if (!result.ok) throw new Error(result.reason)
    model.project = result.project
    for (let i = 0; i < 2; i++) model.project = planNativeInsertion(model.project, { kind: 'course-owner', owner: 'world', locationId: result.activatedLocationId }, { nativeType: 'shape', shapeType: 'rectangle', x: 100 + i * 300, y: 50 + i * 100, width: 100, height: 80 }, () => `sp-${++nextId}`).project
  }
  const locations = model.project.locations.filter(location => location.kind === 'spatial-camera')
  return { model, locations, surface: spatialSurfaceIn(model.project, locations[0].surfaceId) }
}

it('spatial graph and camera CRUD share canonical History, readonly world references, playback identity and archive reopen', async () => {
  const { model, locations, surface } = spatialFixture(), f = await harness(model)
  const owner = await f.issue({ kind: 'course-surface', surfaceId: surface.id })
  const refs = await Promise.all(surface.world.layerItems.map(item => f.issue({ kind: 'course-object', locationId: locations[0].id, itemId: item.layerItemId }, true)))
  const created = applied(await f.invoke('create-structure', 'batch', { operations: [
    { name: 'spatial.structure', input: { target: owner, operation: 'add-camera', name: 'Second', pose: { x: 600, y: 400, zoom: 2 } } },
    { name: 'spatial.structure', input: { target: owner, operation: 'add-path', path: { name: 'Route', layerItemIds: refs, style: { color: '#112233', width: 3 } } } },
    { name: 'spatial.structure', input: { target: owner, operation: 'add-relation', relation: { sourceLayerItemId: refs[0], targetLayerItemId: refs[1], kind: 'arrow', label: 'Relationship' } } },
  ] }))
  expect(f.session.read().undoDepth).toBe(1)
  let after = spatialSurfaceIn(f.project(), surface.id)
  expect(after.world.paths![0].layerItemIds).toEqual(surface.world.layerItems.map(item => item.layerItemId))
  expect(resolveSpatialPlaybackSchedule(f.project(), surface.id, after.world.paths![0].id).map(stop => stop.kind)).toEqual(['path-waypoint', 'path-waypoint'])
  expect(f.project().mixedPrintPlan!.entries.find(entry => entry.kind === 'spatial-frames' && entry.surfaceId === surface.id)).toMatchObject({ cameraFrameIds: after.camera.frames.map(frame => frame.id) })
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  const childRead = await f.invoke('discover', 'listChildren', { target: await f.issue({ kind: 'course-surface', surfaceId: surface.id }) })
  expect(childRead.kind).toBe('read')
  const [camera, path, relation] = created.affected
  applied(await f.invoke('update-structure', 'batch', { operations: [
    { name: 'spatial.structure', input: { target: camera, operation: 'update-camera', name: 'New name', pose: { x: 800, y: 300, zoom: 1.5 } } },
    { name: 'spatial.structure', input: { target: path, operation: 'update-path', path: { name: 'Renamed' } } },
    { name: 'spatial.structure', input: { target: relation, operation: 'update-relation', relation: { label: 'New relation' } } },
  ] }))
  after = spatialSurfaceIn(f.project(), surface.id)
  expect(after.world.paths![0].style).toEqual({ color: '#112233', width: 3 })
  expect(after.world.relations![0].sourceLayerItemId).toBe(surface.world.layerItems[0].layerItemId)
  expect(f.project().locations.find(entry => entry.id === after.camera.frames[1].id)?.label).toContain('New name')
  expect(f.session.read().undoDepth).toBe(2)
  const cameraTarget = await f.issue({ kind: 'course-location', locationId: after.camera.frames[1].id })
  const pathTarget = await f.issue({ kind: 'spatial-graph', surfaceId: surface.id, graph: 'path', graphId: after.world.paths![0].id })
  const relationTarget = await f.issue({ kind: 'spatial-graph', surfaceId: surface.id, graph: 'relation', graphId: after.world.relations![0].id })
  applied(await f.invoke('delete-structure', 'batch', { operations: [
    { name: 'spatial.structure', input: { target: cameraTarget, operation: 'delete-camera' } },
    { name: 'spatial.structure', input: { target: pathTarget, operation: 'delete-path' } },
    { name: 'spatial.structure', input: { target: relationTarget, operation: 'delete-relation' } },
  ] }))
  expect(spatialSurfaceIn(f.project(), surface.id).world.paths).toEqual([])
  expect(f.session.read().undoDepth).toBe(3); await f.undo()
  expect(spatialSurfaceIn(f.project(), surface.id)).toEqual(after)
  expect(f.session.read().model.resources).toEqual(model.resources)
  expect(spatialSurfaceIn(f.project(), locations[1].surfaceId)).toEqual(spatialSurfaceIn(model.project, locations[1].surfaceId))
})

it('spatial fit uses shared visible world geometry and design viewport, updates only selected frame/home, and empty worlds stay unchanged', async () => {
  const { model, locations, surface } = spatialFixture()
  const originalLocation = locations[0]
  model.project = planNativeInsertion(model.project, { kind: 'course-owner', owner: 'global', locationId: model.project.locations[0].id }, { nativeType: 'shape', shapeType: 'rectangle', x: -9000, y: -9000, width: 1000, height: 1000 }, () => 'hud').project
  const f = await harness(model), owner = await f.issue({ kind: 'course-surface', surfaceId: surface.id })
  applied(await f.invoke('second-camera', 'spatial.structure', { target: owner, operation: 'add-camera', pose: { x: 40, y: 60, zoom: 2 } }))
  const before = f.project(), beforeSurface = spatialSurfaceIn(before, surface.id)
  const manual = spatialSessionCameraFittingWorldContent(openSpatialAuthoringSession(before, { locationId: originalLocation.id }), { viewportWidth: 1280, viewportHeight: 720 })
  expect(manual).toEqual({ x: 300, y: 140, zoom: Math.min(1280 / 480, 720 / 260) })
  const location = await f.issue({ kind: 'course-location', locationId: originalLocation.id })
  applied(await f.invoke('fit', 'spatial.structure', { target: location, operation: 'fit-world-content', surface: await f.issue({ kind: 'course-surface', surfaceId: surface.id }) }))
  const after = spatialSurfaceIn(f.project(), surface.id)
  expect(after.camera.home).toEqual(manual); expect(after.camera.frames[0]).toMatchObject(manual)
  expect(after.camera.frames[1]).toEqual(beforeSurface.camera.frames[1])
  expect(f.session.read().undoDepth).toBe(2); expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(spatialSurfaceIn(f.project(), surface.id)).toEqual(beforeSurface)
  const empty = spatialFixture(); empty.surface.world.layerItems = []
  const e = await harness(empty.model), eLocation = await e.issue({ kind: 'course-location', locationId: empty.locations[0].id }), eSurface = await e.issue({ kind: 'course-surface', surfaceId: empty.surface.id })
  expect(await e.invoke('empty-fit', 'spatial.structure', { target: eLocation, surface: eSurface, operation: 'fit-world-content' })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(e.session.read().undoDepth).toBe(0)
})

it('spatial scope and reference failures reject the entire batch, stale endpoints and graph-kind confusion without expanding grants', async () => {
  const { model, locations, surface } = spatialFixture(), f = await harness(model)
  const owner = await f.issue({ kind: 'course-surface', surfaceId: surface.id }), location = await f.issue({ kind: 'course-location', locationId: locations[0].id })
  const item = surface.world.layerItems[0], local = await f.issue({ kind: 'course-object', locationId: locations[0].id, itemId: item.layerItemId }, true)
  const foreignSurface = spatialSurfaceIn(model.project, locations[1].surfaceId), foreign = await f.issue({ kind: 'course-object', locationId: locations[1].id, itemId: foreignSurface.world.layerItems[0].layerItemId })
  expect(await f.invoke('cross-world', 'batch', { operations: [
    { name: 'spatial.structure', input: { target: owner, operation: 'set-home', pose: { x: 3, y: 4, zoom: 5 } } },
    { name: 'spatial.structure', input: { target: owner, operation: 'add-path', path: { name: 'Invalid', layerItemIds: [local, foreign] } } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read().undoDepth).toBe(0); expect(f.project()).toEqual(model.project)
  expect(await f.invoke('last-camera', 'spatial.structure', { target: location, operation: 'delete-camera' })).toMatchObject({ kind: 'error' })
  const created = applied(await f.invoke('one-path', 'spatial.structure', { target: owner, operation: 'add-path', path: { name: 'Only', layerItemIds: [local] } }))
  expect(await f.invoke('wrong-kind', 'spatial.structure', { target: created.affected[0], operation: 'delete-relation' })).toMatchObject({ kind: 'error' })
  const graph = (await f.gateway.resolveEditTarget('r', created.affected[0])).target
  const restricted = await harness(f.session.read().model as typeof model, [graph])
  expect(await restricted.invoke('no-home', 'spatial.structure', { target: await restricted.issue({ kind: 'course-surface', surfaceId: surface.id }), operation: 'set-home', pose: { x: 0, y: 0, zoom: 1 } })).toMatchObject({ kind: 'error' })
  applied(await restricted.invoke('graph-only', 'spatial.structure', { target: await restricted.issue(graph), operation: 'update-path', path: { name: 'Allowed' } }))
  const writableItem = await f.issue({ kind: 'course-object', locationId: locations[0].id, itemId: item.layerItemId })
  applied(await f.invoke('move-endpoint', 'object.update', { target: writableItem, properties: { frame: { x: 900 } } }))
  // Reissue the surface so this conflict specifically comes from the old read-only endpoint footprint.
  expect(await f.invoke('stale-endpoint', 'spatial.structure', { target: await f.issue({ kind: 'course-surface', surfaceId: surface.id }), operation: 'add-path', path: { name: 'Stale', layerItemIds: [local] } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
})
