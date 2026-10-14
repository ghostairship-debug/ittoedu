import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { courseProjectV10Schema, type CourseProjectV10, type ComponentEdit } from '../../src/shared/contracts/component-platform'
import { spatialTourStops } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { observeSpatialSource, prepareSpatialSourceEdit, setSpatialDefaultPathEdit, deleteSpatialGraphItemEdit, updateSpatialGraphItemEdit, reorderSpatialCameraFramesEdit } from '../../src/core/course/courseSpatialEdits'
import { duplicateSurfaceEdits } from '../../src/core/course/courseSurfaceStructure'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { SpatialPathEditor } from '../../src/renderer/ui/SpatialPathEditor'

afterEach(cleanup)
const sample = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'routes', revision: 0, title: 'Different spatial routes', assets: {},
  definitions: {}, instances: {}, global: { underlay: [], overlay: [] }, surfaces: [
    { id: 'before', kind: 'slide', title: 'Before', childIds: [] },
    { id: 'world', kind: 'spatial', title: 'World', childIds: [], designSize: { width: 800, height: 400 }, spatial: {
      home: { x: 0, y: 0, zoom: 1 }, frames: [
        { id: 'A', title: 'A', pose: { x: 100, y: 0, zoom: 1 } },
        { id: 'B', title: 'B', pose: { x: 200, y: 0, zoom: 1 } },
        { id: 'C', title: 'C', pose: { x: 300, y: 0, zoom: 1 } },
      ], paths: [{ id: 'p', title: 'Route P', frameIds: ['B', 'A'] }, { id: 'q', title: 'Route Q', frameIds: ['C', 'B'] }],
    } }, { id: 'after', kind: 'slide', title: 'After', childIds: [] },
  ] })
const spatial = (project: CourseProjectV10) => project.surfaces[1].spatial!
const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
const route = (project: CourseProjectV10, pathId?: string | null) => spatialTourStops(spatial(project), pathId, { width: 800, height: 400 }, []).map(stop => stop.frameId)

it('reads missing default as frames without writing and resolves two different routes through navigation and replay', async () => {
  let project = courseProjectV10Schema.parse(sample())
  expect(Object.hasOwn(spatial(project), 'defaultPathId')).toBe(false)
  expect(route(project)).toEqual(['A', 'B', 'C'])
  expect(route(project, 'p')).toEqual(['B', 'A'])
  expect(Object.hasOwn(spatial(project), 'defaultPathId')).toBe(false)
  project = apply(project, [setSpatialDefaultPathEdit(project, 'world', 'q')])
  expect(route(project)).toEqual(['C', 'B'])
  expect(route(project, null)).toEqual(['A', 'B', 'C'])
  let active = 'before'
  const camera = createComponentSpatialCameraPort(spatial(project).home)
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => active, select: id => { active = id } })
  navigation.registerCamera('world', camera)
  try {
    await navigation.execute({ type: 'scene.next' })
    expect(camera.read().x).toBe(300)
    await navigation.execute({ type: 'step.next' })
    expect(camera.read().x).toBe(200)
    await navigation.replayCurrentSurface()
    expect(camera.read().x).toBe(300)
    await navigation.execute({ type: 'scene.go', sceneId: 'world', targetStateId: 'A' })
    expect(camera.read().x).toBe(100)
    project = apply(project, [setSpatialDefaultPathEdit(project, 'world', null)])
    await navigation.replayCurrentSurface()
    expect(camera.read().x).toBe(100)
  } finally { navigation.dispose(); camera.dispose() }
})

it('keeps observed refs, members and the default in source edits; deleting the default returns to frames', () => {
  let project = apply(sample(), [setSpatialDefaultPathEdit(sample(), 'world', 'q')])
  const observed = observeSpatialSource(project, 'world', {})
  const qRef = Object.entries(observed.refs.paths).find(([, id]) => id === 'q')![0]
  expect(observed.source.defaultRoute).toBe(qRef)
  const source = structuredClone(observed.source)
  source.paths!.reverse()
  source.paths![0].stops.reverse()
  project = apply(project, [prepareSpatialSourceEdit(project, 'world', source, observed.refs, {})])
  expect(spatial(project).defaultPathId).toBe('q')
  expect(route(project)).toEqual(['B', 'C'])
  expect(spatial(project).frames.map(frame => frame.id)).toEqual(['A', 'B', 'C'])
  const deletingSource = observeSpatialSource(project, 'world', {})
  deletingSource.source.paths = deletingSource.source.paths!.filter(item => item.ref !== deletingSource.source.defaultRoute)
  const sourceDeleted = apply(project, [prepareSpatialSourceEdit(project, 'world', deletingSource.source, deletingSource.refs, {})])
  expect(spatial(sourceDeleted).defaultPathId).toBe(null)
  expect(route(sourceDeleted)).toEqual(['A', 'B', 'C'])
  const deleted = deleteSpatialGraphItemEdit(project, 'world', 'paths', 'q')
  project = apply(project, [deleted])
  expect(spatial(project).defaultPathId).toBe(null)
  expect(route(project)).toEqual(['A', 'B', 'C'])
  const fresh = observeSpatialSource(sample(), 'world', {})
  const newlyAuthored = { home: fresh.source.home, stops: fresh.source.stops, paths: [{ stops: [3, 1], title: 'New' }], defaultRoute: 1 }
  const added = apply(sample(), [prepareSpatialSourceEdit(sample(), 'world', newlyAuthored, fresh.refs, {})])
  expect(spatial(added).defaultPathId).toBe(spatial(added).paths![0].id)
  expect(route(added)).toEqual(['C', 'A'])
})

it('preserves independent frames/path order and default across Main save, cold open, duplicate and actual Published mount', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-r05-routes-'))
  const service = new DocumentHostService(path.join(folder, 'recovery'))
  let project = sample()
  project = apply(project, [reorderSpatialCameraFramesEdit(project, 'world', ['B', 'A', 'C'])])
  project = apply(project, [updateSpatialGraphItemEdit(project, 'world', 'paths', 'q', { frameIds: ['C', 'A'] })])
  const created = await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'Routes')
  try {
    const applied = await service.internalAPI.dispatch({ documentId: created.documentId, epoch: created.epoch, operationId: 'choose-route', baseRevision: created.revision,
      actor: 'human', mutation: { type: 'command', command: captureComponentOperation(project, [setSpatialDefaultPathEdit(project, 'world', 'q')]) } })
    expect(applied.status).toBe('applied')
    const file = path.join(folder, 'routes.glx')
    await service.internalAPI.save(created.documentId, file)
    const cold = await new DocumentHostService(path.join(folder, 'cold')).internalAPI.open(file)
    if (cold.model.kind !== 'course-v10') throw new Error('Expected V10')
    project = cold.model.project
    expect(spatial(project).defaultPathId).toBe('q')
    expect(route(project)).toEqual(['C', 'A'])
    expect(route(project, null)).toEqual(['B', 'A', 'C'])
    const copied = duplicateSurfaceEdits(project, 'world')
    const copy = apply(project, copied.edits).surfaces.find(surface => surface.id === copied.surfaceId)!
    expect(copy.spatial!.defaultPathId).toBe(copy.spatial!.paths![1].id)
    expect(copy.spatial!.defaultPathId).not.toBe('q')
    const { payload } = await buildPublishedCourseV3({ project, assetBytes: {} })
    const root = document.createElement('div'); document.body.append(root)
    const player = await mountPublishedCourseV3(payload, root, { initialSurfaceId: 'world', keyboardNavigation: false })
    try {
      expect(player.navigation.read().progress?.stepName).toBe('C')
      await player.next(); expect(player.navigation.read().progress?.stepName).toBe('A')
      await player.navigation.replayCurrentSurface(); expect(player.navigation.read().progress?.stepName).toBe('C')
      await player.go('world', 'B'); expect(player.navigation.read().progress?.stepName).not.toBe('C')
    } finally { await player.dispose(); root.remove() }
    // A missing default must not select the first named path in Published.
    delete spatial(project).defaultPathId
    const framesPayload = (await buildPublishedCourseV3({ project, assetBytes: {} })).payload
    const frameRoot = document.createElement('div'); document.body.append(frameRoot)
    const framesPlayer = await mountPublishedCourseV3(framesPayload, frameRoot, { initialSurfaceId: 'world', keyboardNavigation: false })
    try { expect(framesPlayer.navigation.read().progress?.stepName).toBe('B'); expect(framesPlayer.navigation.read().progress?.stepCount).toBe(3) }
    finally { await framesPlayer.dispose(); frameRoot.remove() }
  } finally { await fs.rm(folder, { recursive: true, force: true }) }
})

it('edits one existing path member at a time and changes its supported member type without rewriting frames', () => {
  function Editor() {
    const [project, setProject] = useState(() => {
      const value = sample()
      value.definitions.card = { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.card' } }
      value.instances.X = { id: 'X', name: '对象 X', definitionId: 'card', data: {}, frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 0, 0] } }
      value.surfaces[1].childIds.push('X')
      return value
    })
    const value = spatial(project)
    const update = (pathId: string, patch: { frameIds: string[]; instanceIds?: string[] }) =>
      setProject(current => apply(current, [updateSpatialGraphItemEdit(current, 'world', 'paths', pathId, patch)]))
    return <><output data-testid="frames">{value.frames.map(frame => frame.id).join(',')}</output>
      <SpatialPathEditor surfaceTitle="World" worldInstances={Object.values(project.instances)} paths={value.paths!} frames={value.frames} relations={[]}
        selectedPathId="p" onAddPath={() => {}} onRenamePath={() => {}} onUpdatePathStyle={() => {}} onDeletePath={() => {}}
        onAddRelation={() => {}} onUpdateRelationLabel={() => {}} onUpdateRelationKind={() => {}} onDeleteRelation={() => {}}
        onReorderPathFrames={(pathId, frameIds) => update(pathId, { frameIds, instanceIds: undefined })}
        onReorderPathWaypoints={(pathId, instanceIds) => update(pathId, { frameIds: [], instanceIds })} />
    </>
  }
  render(<Editor />)
  fireEvent.change(screen.getByLabelText('添加路径成员'), { target: { value: 'C' } })
  expect(screen.getByLabelText('删除路径镜头 C')).toBeEnabled()
  fireEvent.click(screen.getByLabelText('上移路径镜头 C'))
  expect(screen.getByText('B → C → A')).toBeVisible()
  fireEvent.click(screen.getByLabelText('删除路径镜头 B'))
  expect(screen.getByText('C → A')).toBeVisible()
  fireEvent.change(screen.getByLabelText('路径成员类型'), { target: { value: 'instances' } })
  expect(screen.getByLabelText('路径成员类型')).toHaveValue('instances')
  expect(screen.getByText('未选择路径点')).toBeVisible()
  fireEvent.change(screen.getByLabelText('添加路径成员'), { target: { value: 'X' } })
  expect(screen.getByLabelText('删除路径点 对象 X')).toBeEnabled()
  fireEvent.click(screen.getByLabelText('删除路径点 对象 X'))
  expect(screen.getByText('未选择路径点')).toBeVisible()
  fireEvent.change(screen.getByLabelText('路径成员类型'), { target: { value: 'frames' } })
  expect(screen.getByLabelText('路径成员类型')).toHaveValue('frames')
  fireEvent.change(screen.getByLabelText('添加路径成员'), { target: { value: 'A' } })
  expect(screen.getByLabelText('删除路径镜头 A')).toBeEnabled()
  expect(screen.getByTestId('frames')).toHaveTextContent('A,B,C')
})
