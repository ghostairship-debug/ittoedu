import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { canonicalComponentFileEdits, ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { spatialTourStops } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { createInitialSpatialOwnedState, createSpatialAuthoringSlice } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { observeSpatialSource, prepareSpatialSourceEdit } from '../../src/core/course/courseSpatialEdits'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'

async function fixture() {
  const project = createBlankCourseProjectV10('Spatial identity')
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  for (const [id, x] of [['left', 10], ['right', 700]] as const) project.instances[id] = {
    id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))),
    frame: { width: 120, height: 80, transform: [1, 0, 0, 1, x, 0] },
  }
  project.surfaces[0] = { id: 'world', kind: 'spatial', title: '世界', childIds: ['left', 'right'], spatial: {
    home: { x: 0, y: 0, zoom: 1 }, frames: [
      { id: 'frame-left', title: '左侧镜头', pose: { x: 10, y: 20, zoom: 2 }, targetInstanceId: 'left' },
      { id: 'frame-right', title: '右侧镜头', pose: { x: 700, y: 20, zoom: 1 } },
    ], paths: [
      { id: 'left-to-right', title: '先左后右', frameIds: ['frame-left', 'frame-right'] },
      { id: 'right-to-left', title: '先右后左', frameIds: ['frame-right', 'frame-left'] },
    ], relations: [
      { id: 'outbound', sourceInstanceId: 'left', targetInstanceId: 'right', kind: 'arrow', label: '向右' },
      { id: 'return', sourceInstanceId: 'right', targetInstanceId: 'left', kind: 'line', label: '返回' },
    ], semanticZoom: [
      { id: 'near', instanceIds: ['left'], minZoom: 0, maxZoom: 3, visible: true },
      { id: 'far', instanceIds: ['right'], minZoom: 3, maxZoom: 10, visible: false },
    ],
  } }
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'spatial', epoch: 'original',
    binding: { kind: 'untitled', suggestedName: 'spatial.h5lesson' }, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } },
  driver, { async append() {}, async save() { throw new Error('archive check uses the real Driver') } })
  return { driver, session }
}

it('reorders observed Spatial cameras and paths without changing their identity or navigation references, and undoes and reopens the same result', async () => {
  const { session, driver } = await fixture()
  const before = session.read() as ComponentProjectSnapshot
  const file = componentProjectFiles(before.model.project, before.model.resources).find(file => file.binding?.kind === 'spatial')!
  const coordinator = new ComponentProjectFileCoordinator({ document: async () => session.read() as ComponentProjectSnapshot,
    async apply() { throw new Error('source identity check dispatches through the real Session') },
    async source() { throw new Error('inline source has no external file input') } })
  expect((await coordinator.execute('spatial-run', 'read', 'read', 'project.read', { path: file.path })).kind).toBe('read')
  const source = JSON.parse(file.content!)
  const originalLeftRef = source.stops[0].ref
  for (const field of ['stops', 'paths', 'relations', 'semanticZoom']) source[field].reverse()
  const edits = canonicalComponentFileEdits(before, file, JSON.stringify(source))
  const command = captureComponentOperation(before.model.project, edits)
  const result = await session.execute({ documentId: 'spatial', epoch: 'original', operationId: 'source-reorder', baseRevision: before.revision,
    actor: 'agent', mutation: { type: 'command', command } })
  expect(result.status).toBe('applied')
  const after = session.read() as ComponentProjectSnapshot, spatial = after.model.project.surfaces[0].spatial!
  expect(spatial.frames.map(frame => frame.id)).toEqual(['frame-right', 'frame-left'])
  expect(spatial.paths!.map(path => path.id)).toEqual(['right-to-left', 'left-to-right'])
  expect(spatial.paths!.find(path => path.id === 'left-to-right')!.frameIds).toEqual(['frame-left', 'frame-right'])
  expect(spatial.relations!.map(relation => relation.id)).toEqual(['return', 'outbound'])
  expect(spatial.semanticZoom!.map(rule => rule.id)).toEqual(['far', 'near'])
  expect(spatial.frames.find(frame => frame.id === 'frame-left')!.targetInstanceId).toBe('left')
  expect(spatialTourStops(spatial, 'left-to-right', { width: 800, height: 400 }, []).map(stop => stop.frameId)).toEqual(['frame-left', 'frame-right'])
  expect(after.model.project.instances).toEqual(before.model.project.instances)
  expect(after.undoDepth).toBe(1)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  coordinator.acknowledge('spatial-run', 'spatial', 'original', after.revision, command)
  const continued = coordinator.captureFile('spatial-run', after, file.path, true)
  const continuedSource = JSON.parse(continued.file.content!)
  continuedSource.stops.find((stop: { ref: string }) => stop.ref === originalLeftRef).title = '续改原左侧镜头'
  const continuedEdits = canonicalComponentFileEdits(continued.snapshot, continued.file, JSON.stringify(continuedSource))
  const continuedResult = await session.execute({ documentId: 'spatial', epoch: 'original', operationId: 'source-continue', baseRevision: after.revision,
    actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(continued.snapshot.model.project, continuedEdits) } })
  expect(continuedResult.status, JSON.stringify(continuedResult)).toBe('applied')
  const final = session.read() as ComponentProjectSnapshot
  expect(final.model.project.surfaces[0].spatial!.frames.find(frame => frame.id === 'frame-left')!.title).toBe('续改原左侧镜头')
  expect(final.model.project.surfaces[0].spatial!.frames.find(frame => frame.id === 'frame-right')!.title).toBe('右侧镜头')
  expect(final.undoDepth).toBe(2)
  expect(driver.load(driver.serialize(final.model))).toEqual(final.model)
  expect((await session.execute({ documentId: 'spatial', epoch: 'original', operationId: 'undo-continue', baseRevision: final.revision,
    actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
  expect((session.read() as ComponentProjectSnapshot).model.project.surfaces[0].spatial).toEqual(spatial)
  const undone = await session.execute({ documentId: 'spatial', epoch: 'original', operationId: 'undo-reorder', baseRevision: session.read().revision,
    actor: 'human', mutation: { type: 'undo' } })
  expect(undone.status).toBe('applied')
  expect((session.read() as ComponentProjectSnapshot).model.project.surfaces[0].spatial).toEqual(before.model.project.surfaces[0].spatial)
})

it('shares the mature identity commands with the real slice and prepares currentViewport only from its live captured facts', async () => {
  const { session, driver } = await fixture()
  let owned = createInitialSpatialOwnedState(), sequence = 0
  const captureTarget = (): CapturedCourseTarget => {
    const snapshot = session.read() as ComponentProjectSnapshot
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, project: snapshot.model.project, editingProject: snapshot.model.project,
      resources: snapshot.model.resources, surfaceId: 'world', activeStateId: null, instanceId: null, instanceIds: [] }
  }
  const kernel = { captureTarget, readView: () => ({ activeDocumentId: 'spatial', surfaceId: 'world',
    views: [{ documentId: 'spatial', model: session.read().model }] }),
  capture: (edits: ComponentEdit[], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: target.documentId, epoch: target.epoch }),
  editCaptured: async (captured: CapturedComponentOperation) => {
    const { documentId, epoch, ...command } = captured
    const result = await session.execute({ documentId, epoch, operationId: `ui-${++sequence}`, baseRevision: session.read().revision,
      actor: 'human', mutation: { type: 'command', command } })
    if (result.status !== 'applied') throw new Error('actual Session rejected the edit')
    return result
  }, setFeedback() {}, } as unknown as EditorStoreKernel
  const actions = createSpatialAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const request = { documentId: 'spatial', epoch: 'original', surfaceId: 'world' }
  expect(() => actions.captureSpatialViewport(request)).toThrow('尚未运行')
  actions.setSpatialViewport({ width: 800, height: 400 }, 'world', 'spatial')
  actions.setSpatialSessionCamera({ x: 500, y: -300, zoom: 2, rotation: 15 }, 'world', 'spatial')
  const capture = actions.captureSpatialViewport(request)
  expect(capture).toMatchObject({ ...request, source: 'spatial-view-state', pose: { x: 500, y: -300, zoom: 2, rotation: 15 }, viewport: { width: 800, height: 400 } })
  await actions.reorderSpatialCameraFrames('world', ['frame-right', 'frame-left'])
  await actions.deleteSpatialCameraFrame('world', 'frame-right')
  const current = session.read() as ComponentProjectSnapshot
  expect(current.model.project.surfaces[0].spatial!.paths!.map(path => path.frameIds)).toEqual([['frame-left'], ['frame-left']])
  const observed = observeSpatialSource(current.model.project, 'world', { left: 'left.json', right: 'right.json' })
  const source = { ...observed.source, home: 'currentViewport' }
  expect(() => prepareSpatialSourceEdit(current.model.project, 'world', source, observed.refs, { left: 'left.json', right: 'right.json' })).toThrow('尚未捕获')
  const edit = prepareSpatialSourceEdit(current.model.project, 'world', source, observed.refs, { left: 'left.json', right: 'right.json' }, capture.pose)
  await kernel.editCaptured(kernel.capture([edit], captureTarget()))
  const applied = session.read() as ComponentProjectSnapshot
  expect(applied.model.project.surfaces[0].spatial!.home).toEqual(capture.pose)
  expect(actions.readSpatialView('world', 'spatial').camera).toEqual(capture.pose)
  expect(driver.load(driver.serialize(applied.model))).toEqual(applied.model)
})
