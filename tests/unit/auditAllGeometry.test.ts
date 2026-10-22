import { withTestTeacherController } from '../helpers/glxWorkFixture'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { defaultShapeData, SHAPE_DEFINITION } from '../../src/components/shape'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { freeSurfaceTargets, hitFreeObject } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import { FreeTransformGesture, LocalAuthorTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareCourseTeacherControllerEdits } from '../../src/core/course/courseElementInsertion'
import { addSpatialGraphItemEdit } from '../../src/core/course/courseSpatialEdits'
import { spatialPathPoints, spatialTourStops, spatialFramePose } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { commitCrop } from '../../src/shared/imageCrop'
import { componentPropertiesEdits } from '../../src/renderer/ui/properties/componentProperties'
import { mixedGlobalGeometryEdits } from '../../src/renderer/ui/workspaces/mixedGlobalGeometry'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances } from '../../src/shared/teacherControllerViewportGeometry'
import { IDENTITY_MATRIX, frameCorners } from '../../src/core/components/geometry'
import type { ComponentFrame, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { selectPropertiesAuthoringReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { singleObjectCommands } from '../../src/renderer/editing/commands/objectCommands'

const frame = (width: number, height: number, x = 0, y = 0): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })
function shapes(): CourseProjectV10 {
  const project = createBlankCourseProjectV10('Geometry'); project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = { shape: { ...SHAPE_DEFINITION, id: 'shape' } }
  setRootContainers(project, [...componentSurfaces(project).slice(0, 0), { id: 'S', kind: 'slide', childIds: ['box', 'line', 'singular'], title: 'S' }, ...componentSurfaces(project).slice(0 + 1)])
  project.instances.box = { id: 'box', definitionId: 'shape', data: defaultShapeData(), frame: frame(60, 40, 150, 10) }
  project.instances.line = { id: 'line', definitionId: 'shape', data: defaultShapeData('line'), frame: frame(200, 200) }
  project.instances.singular = { id: 'singular', definitionId: 'shape', data: defaultShapeData(), frame: { ...frame(100, 100, 220, 220), transform: [0, 0, 0, 1, 220, 220] } }
  return project
}
it('CA159/350 actual formal shape targets skip far stroke and singular candidate while healthy object stays selectable', () => {
  const targets = freeSurfaceTargets(shapes(), 'S')
  expect(hitFreeObject(targets, { x: 180, y: 30 })?.instanceId).toBe('box')
  expect(hitFreeObject(targets, { x: 100, y: 100 })?.instanceId).toBe('line')
  expect(hitFreeObject(targets, { x: 190, y: 50 }, true, [2, 0, 0, 2, 0, 0])?.instanceId).toBe('box')
})
it('CA070 drag excludes itself and selected descendants from snapping and still snaps an unchanged neighbor', () => {
  const project = shapes(); testContainerInstance(project, 0).childIds = ['box']; project.instances.box.frame = frame(100, 100)
  const target = freeSurfaceTargets(project, 'S')[0]!
  const gesture = new FreeTransformGesture({ mode: 'drag', targets: [target], pointer: { x: 0, y: 0 }, surfaceToPointer: IDENTITY_MATRIX, snapTargets: [target] })
  expect(gesture.update({ x: 4, y: 3 }).edits).toMatchObject([{ frame: { transform: [1, 0, 0, 1, 4, 3] } }])
  const neighbor = { ...target, instanceId: 'neighbor', frame: frame(50, 50, 200, 0) }
  const near = new FreeTransformGesture({ mode: 'drag', targets: [target], pointer: { x: 0, y: 0 }, surfaceToPointer: IDENTITY_MATRIX, snapTargets: [target, neighbor] })
  expect(near.update({ x: 96, y: 0 }).edits).toMatchObject([{ frame: { transform: [1, 0, 0, 1, 100, 0] } }])
})
it('CA071 local image resize crossing its opposite anchor remains a supported positive author scale', () => {
  const observation = { frame: frame(100, 100), parentToInstance: [...IDENTITY_MATRIX] as ComponentFrame['transform'], author: {}, boxInsets: { width: 0, height: 0 } }
  const gesture = new LocalAuthorTransformGesture({ geometry: observation, kind: 'image', mode: 'resize', handle: 'se', rootToSurface: IDENTITY_MATRIX, surfaceToPointer: IDENTITY_MATRIX, pointer: { x: 100, y: 100 } })
  const changed = gesture.update({ x: -20, y: -30 }).geometry
  expect(changed.scaleX).toBeGreaterThan(0); expect(changed.scaleY).toBeGreaterThan(0)
})
it('CA312 crop moves origin by author affine and keeps accepted local box dimensions', () => {
  const result = commitCrop({ frame: { x: 50, y: 20, width: 100, height: 80, transform: [2, 0, .5, 3, 50, 20] }, source: { width: 100, height: 80 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 }, fit: 'stretch', cropX: .5, cropY: .5, flipX: false, flipY: false }, { x: 10, y: 5, width: 80, height: 60 })
  expect(result.frame).toEqual({ x: 72.5, y: 35, width: 80, height: 60 })
})
it('CA028/076 camera path uses the live followed center and an explicit empty path has no stops', () => {
  const project = shapes(), targets = freeSurfaceTargets(project, 'S')
  const spatial = { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'follow', pose: { x: 9, y: 8, zoom: 1 }, targetInstanceId: 'box' }],
    paths: [{ id: 'live', frameIds: ['follow'] }, { id: 'empty', frameIds: [], instanceIds: [] }] }
  expect(spatialPathPoints(spatial, spatial.paths[0]!, targets)).toEqual([{ x: 180, y: 30 }])
  expect(spatialTourStops(spatial, 'empty', { width: 1280, height: 720 }, targets)).toEqual([])
  expect(spatialTourStops(spatial, 'live', { width: 1280, height: 720 }, targets)).toHaveLength(1)
})
it('CA146 author graph rejects a deleted or headless endpoint before returning a formal edit', () => {
  const project = shapes(); testContainerInstance(project, 0).container.kind = 'spatial'; project.definitions.behavior = { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.feedback' } }
  project.instances.behavior = { id: 'behavior', definitionId: 'behavior', data: {}, frame: frame(20, 20) }; testContainerInstance(project, 0).childIds.push('behavior')
  expect(() => addSpatialGraphItemEdit(project, 'S', 'relations', { sourceInstanceId: 'box', targetInstanceId: 'missing', kind: 'arrow' })).toThrow('输入已保留')
  expect(() => addSpatialGraphItemEdit(project, 'S', 'paths', { title: 'bad', instanceIds: ['behavior'], frameIds: [] })).toThrow('输入已保留')
})
it('CA381 restore existing teacher reuses identity/frame/source and restores actual visibility and controls in one operation', () => {
  const project = withTestTeacherController(createBlankCourseProjectV10('Teacher')), id = project.global.overlay[0]!, instance = project.instances[id]!
  instance.visible = false; instance.data = { ...(instance.data as object), enabled: false }; project.playback = { ...project.playback!, controls: 'none' }
  const plan = prepareCourseTeacherControllerEdits(project, componentSurfaces(project)[0]!.id)
  const next = applyComponentOperation(project, captureComponentOperation(project, plan.edits))
  expect(plan.instanceIds).toEqual([id]); expect(next.instances[id]!.frame).toEqual(instance.frame); expect(next.instances[id]!.visible).toBe(true)
  expect(next.instances[id]!.data).toMatchObject({ enabled: true }); expect(next.playback?.controls).toBe('canvas')
})
it('CA227 explicit quick fill removes the gradient while other color edits keep it', () => {
  const project = shapes(), instance = project.instances.box!
  instance.data = { ...defaultShapeData(), style: { ...defaultShapeData().style, fillGradient: { kind: 'linear', start: [0, 0], end: [1, 0], stops: [{ offset: 0, color: '#fff', opacity: 1 }, { offset: 1, color: '#000', opacity: 1 }] } } }
  const next = applyComponentOperation(project, captureComponentOperation(project, componentPropertiesEdits(instance, project.definitions.shape, { solidFillColor: '#ff0000' })))
  expect(next.instances.box!.data).toMatchObject({ style: { fillColor: '#ff0000' } }); expect(Reflect.get(next.instances.box!.data as object, 'style').fillGradient).toBeUndefined()
})
it('CA356 mixed teacher and logo alignment is equal in the actual shared viewport after canonical inverse', () => {
  const project = withTestTeacherController(createBlankCourseProjectV10('Align')), id = project.global.overlay[0]!
  project.instances.logo = { id: 'logo', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(), frame: frame(100, 40, 100, 50) }
  project.global.overlay.push('logo'); project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  const hud = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 960, height: 640 } })
  const edits = mixedGlobalGeometryEdits(project, [id, 'logo'], { kind: 'align', alignment: 'left' }, [1.25, 0, 0, 1.25, 10, 20], hud)
  const next = applyComponentOperation(project, captureComponentOperation(project, edits)), shown = projectTeacherControllerInstances(next, hud)
  const teacherX = Math.min(...frameCorners(shown.instances[id]!.frame!).map(point => point.x)), logoX = next.instances.logo!.frame!.transform[4] * 1.25 + 10
  expect(teacherX).toBeCloseTo(logoX)
})
it('CA198 tiny followed content uses its real positive extent', () => {
  const project = shapes(); project.instances.box.frame = frame(.5, .25)
  expect(spatialFramePose({ id: 'tiny', targetInstanceId: 'box', pose: { x: 0, y: 0, zoom: 1 } }, { width: 100, height: 100 }, freeSurfaceTargets(project, 'S')).zoom).toBe(200)
})
it('CA299 new elbow arrow defaults to a triangle without replacing an explicit no-arrow author choice', () => {
  expect(defaultShapeData('elbow-arrow').style.endArrow).toBe('triangle')
  const instance = { id: 'elbow', definitionId: SHAPE_DEFINITION.id, data: { ...defaultShapeData('elbow-arrow'), style: { ...defaultShapeData('elbow-arrow').style, endArrow: 'none' } } }
  const edits = componentPropertiesEdits(instance, SHAPE_DEFINITION, { style: { borderColor: '#ff0000' } })
  expect(edits.some(edit => edit.type === 'data.set' && edit.path.at(-1) === 'endArrow')).toBe(false)
})
it('CA374 fixed text clipping and CA127 effective parent lock use actual canonical data and separate own lock', () => {
  const project = shapes(); project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.parent = { id: 'parent', definitionId: 'shape', data: defaultShapeData(), frame: frame(200, 100), locked: true, childIds: ['text'] }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('Text'))), frame: frame(100, 50) }
  testContainerInstance(project, 0).childIds.push('parent')
  const state = useEditorStore.getState(), read = selectPropertiesAuthoringReadModel({ ...state, editingScope: 'scene', slideContentEdit: null,
    courseView: { ...state.courseView, activeDocumentId: 'geometry', project, editingProject: project, surfaceId: 'S', activeStateId: null, selectedInstanceIds: ['text'], views: [], error: null } })
  expect(read.selectedView).toMatchObject({ locked: true, ownLocked: false })
  const menu = singleObjectCommands({ locked: read.selectedView!.locked, ownLocked: read.selectedView!.ownLocked, visible: true,
    setLocked() {}, setVisible() {}, editText() {} }, { copy() {}, paste() {}, duplicate() {}, remove() {}, canReorder: () => true, reorder() {} }, { primary: true })
  expect(menu.find(item => item.id === 'object.edit-text')?.disabledReason).toBeTruthy()
  expect(menu.find(item => item.id === 'object.delete')?.disabledReason).toBeTruthy()
  expect(menu.find(item => item.id === 'object.lock')?.disabledReason).toBeNull()
  expect(menu.some(item => item.id === 'object.unlock')).toBe(false)
  expect(() => applyComponentOperation(project, captureComponentOperation(project, componentPropertiesEdits(project.instances.text!, TEXT_DEFINITION, { style: { overflow: 'fixed' } })))).toThrow('对象已锁定')
  project.instances.parent.locked = false
  const next = applyComponentOperation(project, captureComponentOperation(project, componentPropertiesEdits(project.instances.text!, TEXT_DEFINITION, { style: { overflow: 'fixed' } })))
  expect(next.instances.text!.data).toMatchObject({ sizing: { mode: 'fixed', overflow: 'clip' } })
})
it('CA288 source teacher collapse projects the actual compact frame instead of an invisible full controller box', () => {
  const project = withTestTeacherController(createBlankCourseProjectV10()), id = project.global.overlay[0]!
  project.instances[id]!.implementationOverride = { kind: 'source', language: 'typescript', source: 'export function mount() {}' }
  project.instances[id]!.data = { ...(project.instances[id]!.data as object), collapsible: true, defaultCollapsed: true }
  const hud = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 1280, height: 720 } })
  expect(projectTeacherControllerInstances(project, hud).instances[id]!.frame).toMatchObject({ width: 52, height: 52 })
})
