import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentModel, DocumentPersistence } from '../../src/shared/workbench/document'
import type { CapturedComponentOperation, CapturedCourseTarget, CourseV10ViewState } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createCrossSurfaceCommands, type CrossSurfaceCommandPorts } from '../../src/renderer/composition/crossSurfaceCommands'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { createInitialSpatialOwnedState, createSpatialAuthoringSlice } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import { FreeTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import { spatialWorldTargets } from '../../src/renderer/componentPlatform/surfaces/spatial/targets'
import { componentSpatialCameraMatrix } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { transformPoint, invertMatrix } from '../../src/core/components/geometry'
import { spatialTourSteps } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { SpatialCameraPanel } from '../../src/renderer/ui/SpatialCameraPanel'
import { SpatialPathEditor } from '../../src/renderer/ui/SpatialPathEditor'

afterEach(cleanup)
const sample = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'w0', revision: 0, title: '空间作者', assets: {},
  definitions: { card: { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.card' } } },
  instances: { neighbor: { id: 'neighbor', definitionId: 'card', data: {},
    frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 3000, 2000] } } },
  global: { underlay: [], overlay: [] }, surfaces: [{ id: 'world', title: '世界', kind: 'spatial', childIds: ['neighbor'],
    designSize: { width: 800, height: 400 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }] })
const course = (model: DocumentModel) => { if (model.kind !== 'course-v10') throw new Error('V10 required'); return model.project }
async function harness(seed: CourseProjectV10 = sample()) {
  const driver = new CourseV10Driver()
  let saved: Uint8Array = new Uint8Array(), sequence = 0
  const binding = { kind: 'file' as const, path: 'w0-fixture.h5lesson', version: null, bindingVersion: 0 }
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    saved = input.bytes.slice(); return binding
  } }
  const sessions = new Map<string, DocumentSession>()
  for (const id of ['a', 'b']) sessions.set(id, await DocumentSession.create({ documentId: id, epoch: id,
    binding: { kind: 'untitled', suggestedName: id }, model: { kind: 'course-v10', project: structuredClone(seed), resources: { assets: {}, components: {} } } }, driver, persistence))
  let active = 'a', slideOwned = createInitialSlideOwnedState(), spatialOwned = createInitialSpatialOwnedState()
  const project = (id = active) => course(sessions.get(id)!.read().model)
  const readView = () => ({ activeDocumentId: active, surfaceId: 'world', activeStateId: null,
    views: [...sessions].map(([documentId, session]) => ({ documentId, model: session.read().model })) }) as unknown as CourseV10ViewState
  const captureTarget = (documentId = active): CapturedCourseTarget => {
    const snapshot = sessions.get(documentId)!.read(), value = structuredClone(project(documentId))
    return { documentId, epoch: snapshot.epoch, project: value, editingProject: value, resources: { assets: {}, components: {} },
      surfaceId: 'world', activeStateId: null, instanceId: null, instanceIds: [] }
  }
  const selected = vi.fn(), feedback = vi.fn()
  const kernel = { bridge: { captureTarget }, readView, readDocument: project, readEditingDocument: project, captureTarget,
    capture: (edits: ComponentEdit[], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: target.documentId, epoch: target.epoch }),
    editCaptured: async (captured: CapturedComponentOperation) => {
      const { documentId, epoch, ...command } = captured, session = sessions.get(documentId)!
      const result = await session.execute({ documentId, epoch, baseRevision: session.read().revision,
        operationId: `w0-${++sequence}`, actor: 'human', mutation: { type: 'command', command } })
      if (result.status !== 'applied') throw new Error(JSON.stringify(result))
      return result
    }, selectSurface() {}, selectInstances: selected, setFeedback: feedback,
  } as unknown as EditorStoreKernel
  const content = { begin() {}, async commit() {}, cancel() {} }
  const spatial = createSpatialAuthoringSlice(kernel, { read: () => spatialOwned,
    patch: patch => { spatialOwned = { ...spatialOwned, ...patch } }, content })
  const slide = createSlideAuthoringSlice(kernel, { read: () => slideOwned, patch: patch => { slideOwned = { ...slideOwned, ...patch } } })
  const rootPorts = { kernel, shell: { read: () => ({ canvasMode: 'edit' as const, editingTextNodeId: null }), patch() {} },
    slide, flow: {}, spatial: { ...slide, ...spatial }, structure: {}, lifecycle: {},
  } as unknown as CrossSurfaceCommandPorts
  const commands = createCrossSurfaceCommands(rootPorts)
  const undo = async () => {
    const session = sessions.get(active)!, snapshot = session.read()
    return session.execute({ documentId: active, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: `undo-${++sequence}`, actor: 'human', mutation: { type: 'undo' } })
  }
  return { project, sessions, driver, persistence, binding, kernel, content, spatial, slide, commands, rootPorts, selected, feedback, captureTarget, undo,
    activate(id: string) { active = id }, saved: () => saved }
}

it('routes real generic creation into the observed world or HUD and preserves camera-independent frames through drag, undo and saved reopen', async () => {
  const h = await harness(), originalNeighbor = structuredClone(h.project().instances.neighbor)
  const camera = { x: 1000, y: -2000, zoom: 2, rotation: 15 }
  h.spatial.setSpatialSessionCamera(camera)
  // This is the old composition root's actual Slide fallback, not a fabricated failure.
  const fallback = createCrossSurfaceCommands({ ...h.rootPorts, spatial: { ...h.slide, readSpatialView: h.spatial.readSpatialView } })
  await fallback.addTextNode()
  const fallbackId = h.project().surfaces[0].childIds.at(-1)!
  expect(h.project().instances[fallbackId].frame!.transform.slice(4)).toEqual([80, 80])
  await h.undo()
  await h.commands.addTextNode()
  const worldId = h.project().surfaces[0].childIds.at(-1)!, originalFrame = structuredClone(h.project().instances[worldId].frame!)
  expect(originalFrame.transform.slice(4)).toEqual([860, -2040])
  expect(h.selected).toHaveBeenLastCalledWith([worldId], 'world', 'a')
  h.spatial.setSpatialEditingScope('global')
  await h.commands.addTextNode()
  const hudId = h.project().global.overlay.at(-1)!
  expect(h.project().instances[hudId].frame!.transform.slice(4)).toEqual([240, 160])
  expect(h.project().surfaces[0].childIds).not.toContain(hudId)
  h.spatial.setSpatialEditingScope('world')
  const frozen = h.captureTarget(), target = spatialWorldTargets(frozen.project, 'world').find(value => value.instanceId === worldId)!
  const matrix = componentSpatialCameraMatrix(camera, { x: 0, y: 0, width: 800, height: 400 })
  const start = transformPoint(matrix, { x: 1020, y: -2000 }), end = { x: start.x + 24, y: start.y + 38 }
  const gesture = new FreeTransformGesture({ mode: 'drag', targets: [target], pointer: start, surfaceToPointer: matrix })
  const { edits } = gesture.update(end)
  await h.kernel.editCaptured(h.kernel.capture(edits, frozen))
  const a = transformPoint(invertMatrix(matrix), start), b = transformPoint(invertMatrix(matrix), end)
  expect(h.project().instances[worldId].frame!.transform[4]).toBeCloseTo(originalFrame.transform[4] + b.x - a.x)
  expect(h.project().instances[worldId].frame!.transform[5]).toBeCloseTo(originalFrame.transform[5] + b.y - a.y)
  expect(h.project().instances.neighbor).toEqual(originalNeighbor)
  expect(h.project().surfaces[0].spatial!.home).toEqual({ x: 0, y: 0, zoom: 1 })
  await h.undo()
  expect(h.project().instances[worldId].frame).toEqual(originalFrame)
  const savedProject = structuredClone(h.project())
  await h.sessions.get('a')!.save(h.binding)
  await h.sessions.get('a')!.close()
  const reopened = await DocumentSession.create({ documentId: 'reopened', epoch: 'fresh', binding: h.binding,
    model: h.driver.load(h.saved()) }, h.driver, h.persistence)
  expect(course(reopened.read().model)).toEqual(savedProject)
  expect(reopened.read().undoDepth).toBe(0)
})

it('keeps the insertion target and placement captured while pending input is drained in another document', async () => {
  const h = await harness()
  h.spatial.setSpatialSessionCamera({ x: 700, y: -500, zoom: 3 })
  let finish!: () => void
  h.content.commit = () => new Promise<void>(resolve => { finish = resolve })
  const operation = h.spatial.addTextNode()
  h.activate('b')
  h.spatial.setSpatialSessionCamera({ x: -700, y: 800, zoom: 1 })
  h.spatial.setSpatialEditingScope('global')
  finish(); await operation
  const id = h.project('a').surfaces[0].childIds.at(-1)!
  expect(h.project('a').instances[id].frame!.transform.slice(4)).toEqual([560, -540])
  expect(h.project('a').global.overlay).toEqual([])
  expect(h.project('b')).toEqual(sample())
  expect(h.selected).toHaveBeenLastCalledWith([id], 'world', 'a')
})

it('uses camera follow and ordered frame paths from the mature forms, preserving author pose and station fragments in save data', async () => {
  const h = await harness()
  await h.commands.addTextNode(1000, 1000)
  const instanceId = h.project().surfaces[0].childIds.at(-1)!
  h.spatial.setSpatialSessionCamera({ x: 1, y: 2, zoom: 3 })
  await h.spatial.addSpatialCameraFrameFromSession('world')
  h.spatial.setSpatialSessionCamera({ x: 900, y: 500, zoom: 1 })
  await h.spatial.addSpatialCameraFrameFromSession('world')
  const [first, second] = h.project().surfaces[0].spatial!.frames
  const updateTarget = vi.fn((frameId: string, id: string | null) => h.spatial.updateSpatialCameraFrameTarget('world', frameId, id))
  const spatial = h.project().surfaces[0].spatial!
  const panel = render(<SpatialCameraPanel surfaceTitle="世界" frames={spatial.frames} home={spatial.home}
    sessionCamera={h.spatial.readSpatialView().camera} activeCameraFrameId={null} showCameraFrames={false}
    worldInstances={Object.values(h.project().instances)} semanticZoomRules={[]}
    onShowCameraFramesChange={() => {}} onAddFrame={() => {}} onRenameFrame={() => {}} onReorderFrame={() => {}}
    onDeleteFrame={() => {}} onSetHome={() => {}} onActivateFrame={() => {}} onUpdateFrameTarget={updateTarget}
    onAddSemanticZoomRule={() => {}} onUpdateSemanticZoomRule={() => {}} onDeleteSemanticZoomRule={() => {}} />)
  fireEvent.change(screen.getByLabelText(`镜头跟随对象 ${first.title}`), { target: { value: instanceId } })
  await updateTarget.mock.results[0].value
  expect(h.project().surfaces[0].spatial!.frames[0]).toEqual({ ...first, targetInstanceId: instanceId })
  panel.unmount()
  const addPath = vi.fn((input: { title: string; instanceIds: string[]; frameIds?: string[] }) => h.spatial.addSpatialPath('world', input))
  const graph = render(<SpatialPathEditor surfaceTitle="世界" worldInstances={Object.values(h.project().instances)}
    paths={[]} frames={spatial.frames} relations={[]} pageSection onAddPath={addPath} onRenamePath={() => {}}
    onUpdatePathStyle={() => {}} onDeletePath={() => {}} onAddRelation={() => {}} onUpdateRelationLabel={() => {}}
    onUpdateRelationKind={() => {}} onDeleteRelation={() => {}} />)
  fireEvent.change(screen.getByLabelText('路径点类型'), { target: { value: 'frames' } })
  fireEvent.change(screen.getByLabelText('路径名称'), { target: { value: '停靠巡游' } })
  fireEvent.click(screen.getByLabelText(`路径镜头 ${first.title}`))
  fireEvent.click(screen.getByLabelText(`路径镜头 ${second.title}`))
  fireEvent.click(screen.getByRole('button', { name: /添加路径/ }))
  await act(async () => { await addPath.mock.results[0].value })
  const authored = h.project().surfaces[0].spatial!, path = authored.paths![0]
  expect(path.frameIds).toEqual([first.id, second.id]); expect(path.instanceIds).toEqual([])
  expect(authored.frames[0].pose).toEqual({ x: 1, y: 2, zoom: 3 })
  const counts = new Map([[instanceId, 2]])
  const steps = spatialTourSteps(authored, path.id, { width: 800, height: 400 }, spatialWorldTargets(h.project(), 'world'), counts)
  expect(steps.map(step => [step.frameId, step.fragmentStep])).toEqual([[first.id, 0], [first.id, 1], [first.id, 2], [second.id, undefined]])
  const saved = course(h.driver.load(h.driver.serialize(h.sessions.get('a')!.read().model)))
  expect(saved.surfaces[0].spatial).toEqual(authored)
  graph.unmount()
  const reorder = vi.fn()
  render(<SpatialPathEditor surfaceTitle="世界" worldInstances={Object.values(h.project().instances)} paths={[path]}
    frames={authored.frames} relations={[]} selectedPathId={path.id} onReorderPathFrames={reorder}
    onAddPath={() => {}} onRenamePath={() => {}} onUpdatePathStyle={() => {}} onDeletePath={() => {}}
    onAddRelation={() => {}} onUpdateRelationLabel={() => {}} onUpdateRelationKind={() => {}} onDeleteRelation={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: `上移路径镜头 ${second.title}` }))
  expect(reorder).toHaveBeenCalledWith(path.id, [second.id, first.id])
})

it('keeps a rejected path draft visible and clears it only after a successful retry ACK', async () => {
  let reject!: (error: Error) => void, accept!: () => void
  const first = new Promise<void>((_resolve, fail) => { reject = fail })
  const second = new Promise<void>(resolve => { accept = resolve })
  const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
  render(<SpatialPathEditor surfaceTitle="世界" worldInstances={[]} paths={[]} frames={[
    { id: 'station', title: '停靠点', pose: { x: 0, y: 0, zoom: 1 } },
  ]} relations={[]} pageSection onAddPath={create} onRenamePath={() => {}} onUpdatePathStyle={() => {}}
    onDeletePath={() => {}} onAddRelation={() => {}} onUpdateRelationLabel={() => {}}
    onUpdateRelationKind={() => {}} onDeleteRelation={() => {}} />)
  fireEvent.change(screen.getByLabelText('路径点类型'), { target: { value: 'frames' } })
  fireEvent.change(screen.getByLabelText('路径名称'), { target: { value: '教师草稿' } })
  fireEvent.click(screen.getByLabelText('路径镜头 停靠点'))
  fireEvent.click(screen.getByRole('button', { name: /添加路径/ }))
  expect(screen.getByLabelText('路径名称')).toHaveValue('教师草稿')
  expect(screen.getByRole('button', { name: /添加路径/ })).toBeDisabled()
  await act(async () => { reject(new Error('目标已变化，原输入保留')) })
  expect(screen.getByRole('alert')).toHaveTextContent('目标已变化，原输入保留')
  expect(screen.getByLabelText('路径名称')).toHaveValue('教师草稿')
  expect(screen.getByLabelText('路径镜头 停靠点')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: /添加路径/ }))
  expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0])
  await act(async () => { accept() })
  expect(screen.getByLabelText('路径名称')).toHaveValue('')
  expect(screen.getByLabelText('路径镜头 停靠点')).not.toBeChecked()
})

it('saves the current camera as a fixed frame, keeps explicit following, and exposes authored names and both fit scopes', async () => {
  const seed = sample(); seed.instances.neighbor.name = '远处的观察对象'; seed.instances.neighbor.data = { title: '旧数据标题' }
  const h = await harness(seed), pose = { x: 21, y: 42, zoom: 1.5 }
  await h.spatial.addSpatialCameraFrameFromSession('world')
  const frameId = h.project().surfaces[0].spatial!.frames[0].id
  await h.spatial.updateSpatialCameraFrameTarget('world', frameId, 'neighbor')
  h.spatial.activateSpatialCameraFrame('world', frameId)
  expect(h.spatial.readSpatialView().camera.x).toBe(3040)
  h.spatial.setSpatialSessionCamera(pose)
  const spatial = h.project().surfaces[0].spatial!, save = vi.fn(() => h.spatial.updateActiveSpatialCameraFrameFromSession('world')), fit = vi.fn()
  const before = h.sessions.get('a')!.read().undoDepth
  const panel = render(<SpatialCameraPanel surfaceTitle="世界" frames={spatial.frames} home={spatial.home}
    sessionCamera={pose} activeCameraFrameId={frameId} showCameraFrames={false}
    worldInstances={Object.values(h.project().instances)} semanticZoomRules={[]}
    onShowCameraFramesChange={() => {}} onAddFrame={() => {}} onRenameFrame={() => {}} onReorderFrame={() => {}}
    onDeleteFrame={() => {}} onSetHome={() => {}} onActivateFrame={() => {}} onUpdateFrameTarget={() => {}}
    onUpdateActiveFromSession={save} onFitWorldContent={fit}
    onAddSemanticZoomRule={() => {}} onUpdateSemanticZoomRule={() => {}} onDeleteSemanticZoomRule={() => {}} />)
  expect(screen.getByRole('option', { name: '远处的观察对象' })).toHaveValue('neighbor')
  fireEvent.click(screen.getByRole('button', { name: '适配可见内容' }))
  fireEvent.click(screen.getByRole('button', { name: '适配全部内容' }))
  expect(fit.mock.calls).toEqual([['visible'], ['all']])
  fireEvent.click(screen.getByRole('button', { name: '将当前画面保存为固定镜头' }))
  await act(async () => { await save.mock.results[0].value })
  expect(h.sessions.get('a')!.read().undoDepth).toBe(before + 1)
  expect(h.project().surfaces[0].spatial!.frames[0]).toMatchObject({ pose })
  expect(h.project().surfaces[0].spatial!.frames[0].targetInstanceId).toBeUndefined()
  const frozen = h.captureTarget()
  await h.kernel.editCaptured(h.kernel.capture([{ type: 'frame.set', instanceId: 'neighbor',
    frame: { ...frozen.project.instances.neighbor.frame!, transform: [1, 0, 0, 1, 6000, 2000] } }], frozen))
  h.spatial.activateSpatialCameraFrame('world', frameId)
  expect(h.spatial.readSpatialView().camera).toEqual(pose)
  const saved = course(h.driver.load(h.driver.serialize(h.sessions.get('a')!.read().model)))
  expect(saved.surfaces[0].spatial!.frames[0]).toEqual(h.project().surfaces[0].spatial!.frames[0])
  await h.spatial.updateSpatialCameraFrameTarget('world', frameId, 'neighbor')
  h.spatial.activateSpatialCameraFrame('world', frameId)
  expect(h.spatial.readSpatialView().camera.x).toBe(6040)
  expect(h.project().surfaces[0].spatial!.frames[0].pose).toEqual(pose)
  panel.unmount()
  render(<SpatialPathEditor surfaceTitle="世界" worldInstances={Object.values(h.project().instances)} paths={[]}
    frames={[]} relations={[]} pageSection onAddPath={() => {}} onRenamePath={() => {}} onUpdatePathStyle={() => {}}
    onDeletePath={() => {}} onAddRelation={() => {}} onUpdateRelationLabel={() => {}}
    onUpdateRelationKind={() => {}} onDeleteRelation={() => {}} />)
  expect(screen.getByLabelText('远处的观察对象')).toBeInstanceOf(HTMLInputElement)
  expect(screen.getByLabelText('关系起点')).toHaveTextContent('远处的观察对象')
  expect(screen.getByLabelText('关系终点')).toHaveTextContent('远处的观察对象')
})

it('fits all visible world content including offscreen objects while respecting effective hidden ancestors, scope and semantic zoom', async () => {
  const seed = sample(); seed.instances = {}; seed.surfaces[0].childIds = []
  const add = (id: string, x: number) => {
    seed.instances[id] = { id, definitionId: 'card', data: {}, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, x, 0] } }
    seed.surfaces[0].childIds.push(id)
  }
  add('near', 0); add('offscreen', 1000); add('hidden', 6000); add('hidden-group', 8000)
  seed.instances.hidden.visible = false
  seed.instances['hidden-group'].visible = false; seed.instances['hidden-group'].childIds = ['child']
  seed.instances.child = { id: 'child', definitionId: 'card', data: {}, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 3000, 0] } }
  add('excluded', 12000); seed.instances.excluded.visibility = { mode: 'exclude', surfaceIds: ['world'] }
  add('semantic', 14000); seed.surfaces[0].spatial!.semanticZoom = [{ id: 'detail', instanceIds: ['semantic'], minZoom: 0, maxZoom: 2, visible: false }]
  add('state-only', 16000)
  seed.instances.hud = { id: 'hud', definitionId: 'card', data: {}, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 20000, 0] } }
  seed.global.overlay = ['hud']
  const h = await harness(seed), effective = structuredClone(h.project()), before = h.sessions.get('a')!.read()
  effective.instances['state-only'].visible = false
  vi.spyOn(h.kernel, 'readEditingDocument').mockReturnValue(effective)
  h.spatial.fitSpatialSessionToWorldContent()
  expect(h.spatial.readSpatialView().camera).toMatchObject({ x: 550, y: 50 })
  expect(h.spatial.readSpatialView().camera.zoom).toBeCloseTo(800 / 1100 * 0.9)
  h.spatial.fitSpatialSessionToWorldContent(undefined, 'world', 'all')
  expect(h.spatial.readSpatialView().camera).toMatchObject({ x: 8050, y: 50 })
  expect(h.spatial.readSpatialView().camera.zoom).toBeCloseTo(800 / 16100 * 0.9)
  h.spatial.setSpatialSessionCamera({ x: 0, y: 0, zoom: 2.5 })
  h.spatial.fitSpatialSessionToWorldContent()
  expect(h.spatial.readSpatialView().camera).toMatchObject({ x: 7050, y: 50 })
  expect(h.project()).toEqual(seed)
  expect(h.sessions.get('a')!.read().undoDepth).toBe(before.undoDepth)
  expect(h.sessions.get('a')!.read().revision).toBe(before.revision)
})
