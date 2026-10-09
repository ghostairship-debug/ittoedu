// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { defaultShapeData } from '../../src/components/shape/data'
import { fitSpatialComponentWorld } from '../../src/renderer/componentPlatform/surfaces/spatial/cameraCommands'
import { spatialWorldTargets } from '../../src/renderer/componentPlatform/surfaces/spatial/targets'
import { spatialTourStops } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { updateSpatialGraphItemEdit } from '../../src/core/course/courseSpatialEdits'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { ToolResult } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver(), roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function harness(empty = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-spatial-')); roots.push(root)
  const project = createBlankCourseProjectV10('Spatial'), surfaceId = project.surfaces[0].id
  project.surfaces[0] = { id: surfaceId, kind: 'spatial', title: 'World', childIds: [], designSize: { width: 1280, height: 720 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'first', title: 'First', pose: { x: 0, y: 0, zoom: 1 } }] } }
  project.surfaces.push({ id: 'other', kind: 'spatial', title: 'Other world', childIds: ['foreign'], spatial: { home: { x: 100, y: 100, zoom: 1 }, frames: [] } })
  project.definitions.shape = { id: 'shape', role: 'content', implementation: { kind: 'builtin', key: 'guoling.shape' } }
  for (const [id, x, y] of [['a', 100, 50], ['b', 400, 150], ['foreign', 100, 50], ['hud', -9000, -9000]] as const) {
    project.instances[id] = { id, definitionId: 'shape', data: defaultShapeData(), frame: { width: 100, height: 80, transform: [1, 0, 0, 1, x, y] } }
    if (id === 'a' || id === 'b') project.surfaces[0].childIds.push(id)
  }
  project.global.overlay.push('hud')
  if (empty) { project.surfaces[0].childIds = []; delete project.instances.a; delete project.instances.b }
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.original = { id: 'original', path: 'assets/original.svg', mimeType: 'image/svg+xml', byteLength: bytes.length }
  const model = { kind: 'course-v10' as const, project, resources: { assets: { original: bytes }, components: {} } }, filename = path.join(root, 'spatial.glx')
  await fs.writeFile(filename, driver.serialize(model))
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(filename), session = host.registry.get(opened.documentId)
  await host.tools.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }], fileAccess: { workspaceRoot: root, permission: 'workspace' } })
  const current = () => { const next = session.read().model; if (next.kind !== 'course-v10') throw new Error('Expected V10'); return next }
  const invoke = (name: string, input: unknown, runId = 'r') => host.tools.execute(runId, randomUUID(), { name, input })
  const listed = await invoke('project.list', {}); expect(listed.kind).toBe('read'); if (listed.kind !== 'read') throw new Error(JSON.stringify(listed))
  const files = (listed.data as { files: { path: string; type: string }[] }).files
  const sourcePath = files.find(file => file.path.endsWith('.spatial.json'))!.path
  const projected = componentProjectFiles(current().project, current().resources)
  const objectPath = (id: string) => projected.find(file => file.kind === 'data' && file.target?.kind === 'instance' && file.target.instanceId === id)!.path
  return { model, host, session, surfaceId, sourcePath, files, objectPath, current, invoke,
    spatial: () => current().project.surfaces[0].spatial!,
    read: async (runId = 'r', selector?: string) => { const result = await invoke('project.read', { path: sourcePath, ...(selector ? { project: selector } : {}) }, runId); expect(result.kind).toBe('read'); if (result.kind !== 'read') throw new Error(JSON.stringify(result)); return JSON.parse((result.data as { content: string }).content) },
    apply: (value: unknown, runId = 'r', selector?: string) => invoke('project.apply', { path: sourcePath, content: JSON.stringify(value), ...(selector ? { project: selector } : {}) }, runId),
    reopen: async () => { await host.internalAPI.save(session.documentId); return (await new DocumentHostService(path.join(root, 'reopen')).open(filename)).model },
    undo: async () => { const before = session.read(); expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function committed(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } }) }
function rejected(result: ToolResult) { expect(result.kind === 'error' || result.kind === 'read' && (result.data as { commit?: string }).commit === 'not_committed', JSON.stringify(result)).toBe(true) }

it('edits camera/path/relation source through observed refs in one History, retains playback identities and original resources through save/reopen and Undo', async () => {
  const f = await harness(), source = await f.read(), before = f.session.read(), a = f.objectPath('a'), b = f.objectPath('b')
  committed(await f.apply({ ...source, stops: [...source.stops, { title: 'Second', pose: { x: 600, y: 400, zoom: 2 } }],
    paths: [{ title: 'Route', stops: [1, 2], objects: [a, b], style: { color: '#112233', width: 3 } }], relations: [{ from: a, to: b, kind: 'arrow', label: 'Relationship' }] }))
  expect(f.session.read().undoDepth).toBe(1)
  expect(f.spatial().paths![0].instanceIds).toEqual(['a', 'b'])
  expect(spatialTourStops(f.spatial(), f.spatial().paths![0].id, { width: 1280, height: 720 }, spatialWorldTargets(f.current().project, f.surfaceId))).toMatchObject([{ instanceId: 'a' }, { instanceId: 'b' }])
  expect(f.spatial().frames[0].id).toBe('first'); const cameraId = f.spatial().frames[1].id, pathId = f.spatial().paths![0].id, relationId = f.spatial().relations![0].id
  const observed = await f.read()
  committed(await f.apply({ ...observed, stops: observed.stops.map((stop: unknown, index: number) => index === 1 ? { ...(stop as object), title: 'New name', pose: { x: 800, y: 300, zoom: 1.5 } } : stop),
    paths: observed.paths.map((value: object) => ({ ...value, title: 'Renamed' })), relations: observed.relations.map((value: object) => ({ ...value, label: 'New relation' })) }))
  expect(f.spatial().frames[1]).toMatchObject({ id: cameraId, title: 'New name', pose: { x: 800, y: 300, zoom: 1.5 } })
  expect(f.spatial().paths![0]).toMatchObject({ id: pathId, title: 'Renamed', style: { color: '#112233', width: 3 } })
  expect(f.spatial().relations![0]).toMatchObject({ id: relationId, sourceInstanceId: 'a', targetInstanceId: 'b', label: 'New relation' })
  const updated = f.current(); expect(await f.reopen()).toEqual(updated)
  const fresh = await f.read(); committed(await f.apply({ ...fresh, stops: [fresh.stops[0]], paths: [], relations: [] }))
  expect(f.spatial().frames.map(frame => frame.id)).toEqual(['first']); expect(f.spatial().paths).toEqual([]); expect(f.session.read().undoDepth).toBe(3)
  await f.undo(); expect(f.current().project.surfaces).toEqual(updated.project.surfaces)
  expect(f.current().resources).toEqual(before.model.resources); expect(f.current().project.surfaces[1]).toEqual(f.model.project.surfaces[1])
  await f.undo(); await f.undo(); expect(f.current().project.surfaces).toEqual(f.model.project.surfaces)
})

it('captures the original fitted view transiently and persists only selected camera/home with unchanged other frames, while empty worlds are a no-op', async () => {
  const f = await harness(), viewport = { width: 1280, height: 720 }, fit = fitSpatialComponentWorld(f.current().project, f.surfaceId, viewport)
  expect(fit).toEqual({ x: 300, y: 140, zoom: Math.min(1280 / 400, 720 / 180) * .9 })
  const source = await f.read(); committed(await f.apply({ ...source, stops: [...source.stops, { title: 'Second', pose: { x: 40, y: 60, zoom: 2 } }] }))
  const before = f.current(), depth = f.session.read().undoDepth
  f.host.setSpatialViewportPreparer(async request => ({ ...request, revision: f.session.read().revision, pose: fit, viewport, source: 'spatial-view-state' }))
  expect(f.current()).toEqual(before); expect(f.session.read().undoDepth).toBe(depth)
  const observed = await f.read(); committed(await f.apply({ ...observed, home: 'currentViewport', stops: [{ ...observed.stops[0], pose: 'currentViewport' }, observed.stops[1]] }))
  expect(f.spatial().home).toEqual(fit); expect(f.spatial().frames[0].pose).toEqual(fit); expect(f.spatial().frames[1]).toEqual(before.project.surfaces[0].spatial!.frames[1])
  expect(f.current().project.instances.hud).toEqual(f.model.project.instances.hud); expect(await f.reopen()).toEqual(f.current())
  await f.undo(); expect(f.current().project.surfaces).toEqual(before.project.surfaces)
  const empty = await harness(true), initial = empty.session.read(), emptyFit = fitSpatialComponentWorld(empty.current().project, empty.surfaceId, viewport)
  expect(emptyFit).toEqual(empty.spatial().home)
  empty.host.setSpatialViewportPreparer(async request => ({ ...request, revision: empty.session.read().revision, pose: emptyFit, viewport, source: 'spatial-view-state' }))
  const emptySource = await empty.read()
  expect(await empty.apply({ ...emptySource, home: 'currentViewport' })).toMatchObject({ kind: 'read', data: { commit: 'unchanged', receipt: { status: 'unchanged' } } })
  expect(empty.session.read()).toEqual(initial)
})

it('preserves single-graph editing with manual equality, Undo and persistence while rejecting scope escape, foreign/stale refs and Stop without writes', async () => {
  const f = await harness(), initial = await f.read()
  committed(await f.apply({ ...initial, paths: [{ title: 'Selected route', stops: [1], objects: [f.objectPath('a'), f.objectPath('b')] },
    { title: 'Other route', stops: [1], objects: [f.objectPath('b')] }], relations: [{ from: f.objectPath('a'), to: f.objectPath('a'), kind: 'arrow' }] }))
  const source = await f.read(), graphBefore = f.session.read(), graphModelBefore = f.current()
  const graph = { kind: 'spatial-graph' as const, surfaceId: f.surfaceId, graph: 'path' as const, graphId: f.spatial().paths![0].id }
  const surfaceHandle = await f.host.tools.issueTarget('r', f.session.documentId, { kind: 'course-surface', surfaceId: f.surfaceId })
  const children = await f.invoke('listChildren', { target: surfaceHandle })
  expect(children).toMatchObject({ kind: 'read', data: expect.arrayContaining([{ target: expect.any(String), kind: 'spatial-graph', label: 'Selected route' }]) })
  await f.host.tools.beginRun({ runId: 'graph', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [graph] }] })
  const handle = await f.host.tools.issueTarget('graph', f.session.documentId, graph)
  const observedGraph = await f.invoke('read', { target: handle }, 'graph')
  expect(observedGraph).toMatchObject({ kind: 'read', data: { authoring: { project: expect.any(String), files: [{ path: f.sourcePath }] } } })
  const graphSource = await f.read('graph', handle)
  expect(await f.invoke('project.read', { project: handle, path: 'assets/original.svg' }, 'graph')).toMatchObject({ kind: 'error' })
  const renamed = { ...graphSource, paths: graphSource.paths.map((item: object, index: number) => index ? item : { ...item, title: 'Allowed' }) }
  const manual = updateSpatialGraphItemEdit(f.current().project, f.surfaceId, 'paths', graph.graphId, { title: 'Allowed' })
  committed(await f.apply(renamed, 'graph', handle))
  expect(manual.type).toBe('spatial.set'); if (manual.type !== 'spatial.set') throw new Error('Expected spatial command')
  expect(f.spatial()).toEqual(manual.spatial); expect(f.session.read().undoDepth).toBe(graphBefore.undoDepth + 1)
  expect(f.current().resources).toEqual(graphBefore.model.resources); expect(await f.reopen()).toEqual(f.current())
  await f.undo(); expect(f.current()).toEqual({ ...graphModelBefore, project: { ...graphModelBefore.project, revision: f.current().project.revision } })
  expect(f.session.read().revision).toBe(graphBefore.revision + 2)
  const freshHandle = await f.host.tools.issueTarget('graph', f.session.documentId, graph), fresh = await f.read('graph', freshHandle), protectedSnapshot = f.session.read()
  for (const value of [
    { ...fresh, paths: fresh.paths.map((item: object, index: number) => index ? item : { ...item, title: 'Partial' }), home: { x: 7, y: 8, zoom: 2 } },
    { ...fresh, paths: fresh.paths.map((item: object, index: number) => index ? { ...item, title: 'Other changed' } : item) },
    { ...fresh, stops: fresh.stops.map((item: object) => ({ ...item, title: 'Other camera' })) },
    { ...fresh, paths: [...fresh.paths, { title: 'Added', stops: [1] }] },
    { ...fresh, paths: fresh.paths.slice(1) },
    { ...fresh, paths: fresh.paths.map((item: object, index: number) => index ? item : { ...item, objects: [f.objectPath('foreign')] }) },
  ]) { rejected(await f.apply(value, 'graph', freshHandle)); expect(f.session.read()).toEqual(protectedSnapshot) }
  // The final Gateway independently rejects canonical commands even if source preparation is bypassed.
  const bypassBaseline = { ...protectedSnapshot, model: f.current() }
  const bypassEdits: ComponentEdit[][] = [
    [{ type: 'spatial.set', surfaceId: f.surfaceId, spatial: { ...f.spatial(), home: { x: 1, y: 2, zoom: 3 } } }],
    [{ type: 'spatial.set', surfaceId: f.surfaceId, spatial: { ...f.spatial(), paths: f.spatial().paths!.map((item, index) => index ? { ...item, title: 'Other graph' } : { ...item, title: 'Partial' }) } }],
    [updateSpatialGraphItemEdit(f.current().project, f.surfaceId, 'paths', graph.graphId, { title: 'Partial' }),
      { type: 'asset.add', asset: { id: 'bypass', path: 'assets/bypass.txt', mimeType: 'text/plain', byteLength: 1 }, bytes: new Uint8Array([1]) }],
  ]
  for (const edits of bypassEdits) {
    await expect(f.host.tools.applyComponentContent('graph', randomUUID(), bypassBaseline, { intent: 'canonical', edits, diagnostics: [] })).rejects.toMatchObject({ code: 'not-authorized' })
    expect(f.session.read()).toEqual(protectedSnapshot)
  }
  rejected(await f.apply(renamed, 'graph')); expect(f.session.read()).toEqual(protectedSnapshot)
  rejected(await f.invoke('project.save', { project: freshHandle }, 'graph')); expect(f.session.read()).toEqual(protectedSnapshot)
  const readOnly = await f.host.tools.issueTarget('r', f.session.documentId, graph, { readOnly: true })
  await f.read('r', readOnly); rejected(await f.apply(renamed, 'r', readOnly)); expect(f.session.read()).toEqual(protectedSnapshot)
  const protectedPaths = structuredClone(f.spatial().paths)
  const relation = { ...graph, graph: 'relation' as const, graphId: f.spatial().relations![0].id }
  await f.host.tools.beginRun({ runId: 'relation', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [relation] }] })
  const relationHandle = await f.host.tools.issueTarget('relation', f.session.documentId, relation), relationSource = await f.read('relation', relationHandle)
  committed(await f.apply({ ...relationSource, relations: relationSource.relations.map((item: object) => ({ ...item, label: 'Allowed relation' })) }, 'relation', relationHandle))
  expect(f.spatial().paths).toEqual(protectedPaths); await f.undo()
  // A newly selected endpoint was observed in this source: the final Session CAS also freezes its geometry.
  const raceHandle = await f.host.tools.issueTarget('relation', f.session.documentId, relation), raceSource = await f.read('relation', raceHandle), beforeRace = f.session.read()
  let raceEntered!: () => void, raceRelease!: () => void
  const racePreparing = new Promise<void>(resolve => { raceEntered = resolve }), raceHeld = new Promise<void>(resolve => { raceRelease = resolve })
  f.host.setSpatialViewportPreparer(async request => { raceEntered(); await raceHeld; return { ...request, revision: f.session.read().revision, pose: f.spatial().home, viewport: { width: 1280, height: 720 }, source: 'spatial-view-state' } })
  const racing = f.apply({ ...raceSource, home: 'currentViewport', relations: raceSource.relations.map((item: object) => ({ ...item, to: f.objectPath('b'), label: 'New endpoint' })) }, 'relation', raceHandle)
  await racePreparing
  expect(await f.session.execute({ documentId: beforeRace.documentId, epoch: beforeRace.epoch, operationId: 'human-new-endpoint', actor: 'human', baseRevision: beforeRace.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'frame.set', instanceId: 'b', frame: { ...f.current().project.instances.b.frame!, transform: [1, 0, 0, 1, 600, 600] } }]) } })).toMatchObject({ status: 'applied' })
  const duringRace = f.session.read(); raceRelease(); const raceResult = await racing
  expect(raceResult, JSON.stringify(raceResult)).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } }); expect(f.session.read()).toEqual(duringRace); await f.undo()
  const stopGraphHandle = await f.host.tools.issueTarget('graph', f.session.documentId, graph), stopSource = await f.read('graph', stopGraphHandle), stopBefore = f.session.read()
  let entered!: () => void, release!: () => void
  const preparing = new Promise<void>(resolve => { entered = resolve }), held = new Promise<void>(resolve => { release = resolve })
  f.host.setSpatialViewportPreparer(async request => { entered(); await held; return { ...request, revision: f.session.read().revision, pose: f.spatial().home, viewport: { width: 1280, height: 720 }, source: 'spatial-view-state' } })
  const pending = f.apply({ ...stopSource, home: 'currentViewport', paths: stopSource.paths.map((item: object, index: number) => index ? item : { ...item, title: 'Stopped' }) }, 'graph', stopGraphHandle)
  await preparing; await f.host.tools.stop('graph'); release(); rejected(await pending); expect(f.session.read()).toEqual(stopBefore)
  await f.host.tools.beginRun({ runId: 'camera-graph', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [graph] }] })
  const cameraHandle = await f.host.tools.issueTarget('camera-graph', f.session.documentId, graph), cameraSource = await f.read('camera-graph', cameraHandle), beforeCamera = f.session.read()
  expect(await f.session.execute({ documentId: beforeCamera.documentId, epoch: beforeCamera.epoch, operationId: 'human-path-camera', actor: 'human', baseRevision: beforeCamera.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'spatial.set', surfaceId: f.surfaceId, spatial: { ...f.spatial(), frames: f.spatial().frames.map(frame => ({ ...frame, pose: { x: 5, y: 6, zoom: 2 } })) } }]) } })).toMatchObject({ status: 'applied' })
  const changedCamera = f.session.read(); rejected(await f.apply({ ...cameraSource, paths: cameraSource.paths.map((item: object, index: number) => index ? item : { ...item, title: 'Stale camera' }) }, 'camera-graph', cameraHandle)); expect(f.session.read()).toEqual(changedCamera); await f.undo()
  const before = f.session.read()
  rejected(await f.apply({ ...source, home: { x: 3, y: 4, zoom: 5 }, relations: [{ from: f.objectPath('a'), to: f.objectPath('foreign'), kind: 'arrow' }] }))
  rejected(await f.apply({ ...source, stops: [{ ...source.stops[0], ref: 'relations-1' }] }))
  expect(f.session.read()).toEqual(before)
  await f.host.tools.beginRun({ runId: 'readonly', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [] }] })
  await f.read('readonly')
  rejected(await f.apply({ ...source, home: { x: 1, y: 2, zoom: 3 } }, 'readonly'))
  await f.host.tools.beginRun({ runId: 'page-only', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'course-surface', surfaceId: f.surfaceId }] }],
    fileAccess: { workspaceRoot: path.dirname((before.binding as { path: string }).path), permission: 'workspace' } })
  await f.read('page-only')
  expect(await f.apply({ ...source, home: { x: 1, y: 2, zoom: 3 } }, 'page-only')).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(f.session.read()).toEqual(before)
  await f.host.tools.beginRun({ runId: 'object', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'a' }] }], fileAccess: { workspaceRoot: path.dirname((before.binding as { path: string }).path), permission: 'workspace' } })
  rejected(await f.apply({ ...source, home: { x: 1, y: 2, zoom: 3 } }, 'object'))
  expect(f.session.read()).toEqual(before)
  f.host.setSpatialViewportPreparer(async request => ({ ...request, surfaceId: 'other', revision: f.session.read().revision, pose: { x: 1, y: 2, zoom: 3 }, viewport: { width: 1280, height: 720 }, source: 'spatial-view-state' }))
  rejected(await f.apply({ ...source, home: 'currentViewport' })); expect(f.session.read()).toEqual(before)
  const staleHandle = await f.host.tools.issueTarget('relation', f.session.documentId, relation), staleSource = await f.read('relation', staleHandle), beforeMove = f.session.read()
  const movedFrame = { ...f.current().project.instances.a.frame!, transform: [1, 0, 0, 1, 300, 400] as [number, number, number, number, number, number] }
  expect(await f.session.execute({ documentId: beforeMove.documentId, epoch: beforeMove.epoch, operationId: 'human-endpoint', actor: 'human', baseRevision: beforeMove.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'frame.set', instanceId: 'a', frame: movedFrame }]) } })).toMatchObject({ status: 'applied' })
  const moved = f.session.read(); rejected(await f.apply({ ...staleSource, relations: staleSource.relations.map((item: object) => ({ ...item, label: 'Stale endpoint' })) }, 'relation', staleHandle)); expect(f.session.read()).toEqual(moved)
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-camera', actor: 'human', baseRevision: f.session.read().revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'spatial.set', surfaceId: f.surfaceId, spatial: { ...f.spatial(), home: { x: 99, y: 88, zoom: 2 } } }]) } })).toMatchObject({ status: 'applied' })
  const human = f.session.read()
  rejected(await f.apply({ ...source, home: { x: 0, y: 0, zoom: 1 } })); expect(f.session.read()).toEqual(human)
})
