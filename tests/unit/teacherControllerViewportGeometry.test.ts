import { expect, it } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { frameCorners } from '../../src/core/components/geometry'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, projectTeacherControllerInstances, isGlobalTeacherController,
  restoreTeacherControllerFrameEdits, type TeacherControllerDisplayPort } from '../../src/shared/teacherControllerViewportGeometry'
import { createTeacherControllerData, TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const project = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'teacher-viewport', revision: 0, title: 'Mixed',
  definitions: { [TEACHER_CONTROLLER_DEFINITION.id]: TEACHER_CONTROLLER_DEFINITION },
  instances: { teacher: { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: JSON.parse(JSON.stringify({ ...createTeacherControllerData(), defaultCollapsed: false })),
    frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] } } },
  global: { underlay: [], overlay: ['teacher'] }, assets: {},
  surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [], designSize: { width: 1280, height: 720 } },
    { id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }, { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [], designSize: { width: 960, height: 640 } }] })
const hud = (original: CourseProjectV10, viewport: { width: number; height: number }) => createTeacherControllerHudGeometry({
  referenceSize: teacherControllerReferenceSize(original), viewportRect: { x: 0, y: 0, ...viewport },
})

it('shows the common direct HUD frame on mixed surfaces without a content parent matrix', () => {
  const original = project(), saved = structuredClone(original), geometry = hud(original, { width: 1000, height: 500 })
  const display = projectTeacherControllerInstances(original, geometry), frame = display.instances.teacher.frame!
  expect([frame.width, frame.height]).toEqual([880, 64])
  ;[500 / 720, 0, 0, 500 / 720, 194.44444444444446, 443.05555555555554].forEach((expected, index) => expect(frame.transform[index]).toBeCloseTo(expected, 8))
  expect(display.global).toBe(original.global)
  expect(display.surfaces).toBe(original.surfaces)
  expect(original).toEqual(saved)
})

it('saves an upward screen drag from the clamped position in author units without shrinking or moving the untouched axis', () => {
  const original = project(), geometry = hud(original, { width: 800, height: 400 })
  original.instances.teacher.frame!.transform[5] = 1000
  const display = projectTeacherControllerInstances(original, geometry), before = display.instances.teacher.frame!
  expect(before.transform[5]).toBeCloseTo(400 - 64 * 400 / 720, 8)
  const moved = { ...before, transform: [...before.transform] as typeof before.transform }
  moved.transform[5] -= 100
  const [edit] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId: 'teacher', frame: moved }], original, display, geometry)
  expect(edit.type).toBe('frame.set')
  if (edit.type !== 'frame.set') return
  expect([edit.frame!.width, edit.frame!.height]).toEqual([880, 64])
  ;[1, 0, 0, 1, 200, 476].forEach((expected, index) => expect(edit.frame!.transform[index]).toBeCloseTo(expected, 8))
  const reopened = { ...original, instances: { ...original.instances, teacher: { ...original.instances.teacher, frame: edit.frame! } } }
  const shownAgain = projectTeacherControllerInstances(reopened, geometry).instances.teacher.frame!
  expect(shownAgain.transform[5]).toBeCloseTo(before.transform[5] - 100, 8)
})

it('keeps the collapsed author footprint and session offsets in screen pixels without changing the saved frame', () => {
  const original = project(), geometry = hud(original, { width: 1400, height: 900 })
  const port: TeacherControllerDisplayPort = { read: () => ({ locationId: 'flow', scenes: [], progress: null, collapsed: true, zoom: 1, muted: false, fullscreen: false }),
    subscribe: () => () => {}, setCollapsed() {}, placement: () => ({ x: 30, y: -20 }) }
  const frame = projectTeacherControllerInstances(original, geometry, port).instances.teacher.frame!
  expect([frame.width, frame.height]).toEqual([52, 52])
  expect(frame.transform).toEqual([1.09375, 0, 0, 1.09375, 1154.375, 747.1875])
  expect(original.instances.teacher.frame).toEqual({ width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] })
})

it('clamps an existing resized affine frame by its actual HUD bounds without changing its saved frame', () => {
  const original = project(), geometry = hud(original, { width: 1000, height: 500 })
  original.instances.teacher.frame!.transform = [2, 0, 0, 2, 200, 638]
  const saved = structuredClone(original.instances.teacher.frame)
  const frame = projectTeacherControllerInstances(original, geometry).instances.teacher.frame!
  const corners = frameCorners(frame)
  expect(Math.min(...corners.map(point => point.x))).toBeGreaterThanOrEqual(0)
  expect(Math.max(...corners.map(point => point.x))).toBeLessThanOrEqual(1000)
  expect(Math.min(...corners.map(point => point.y))).toBeGreaterThanOrEqual(0)
  expect(Math.max(...corners.map(point => point.y))).toBeLessThanOrEqual(500)
  expect(original.instances.teacher.frame).toEqual(saved)
})

it('moves the actual default collapsed producer by screen pixels through the existing navigation offset owner', () => {
  const original = createBlankCourseProjectV10(), saved = structuredClone(original), geometry = hud(original, { width: 640, height: 360 })
  const surfaceId = original.surfaces[0].id, teacherId = original.global.overlay.find(id => isGlobalTeacherController(original, id))!
  const navigation = new ComponentNavigationOwner({ project: () => original, surfaceId: () => surfaceId, select() {},
    viewportBounds: () => ({ left: 100, top: 50, right: 740, bottom: 410 }) })
  const show = () => projectTeacherControllerInstances(original, geometry, navigation).instances[teacherId].frame!
  const before = show(); expect(navigation.read().collapsed).toBe(true)
  navigation.moveBy(-10, -10)
  const once = show()
  expect(once.transform[4]).toBeCloseTo(before.transform[4] - 10, 8)
  expect(once.transform[5]).toBeCloseTo(before.transform[5] - 10, 8)
  navigation.moveBy(-10, -10)
  expect(show().transform[4]).toBeCloseTo(before.transform[4] - 20, 8)
  expect(show().transform[5]).toBeCloseTo(before.transform[5] - 20, 8)
  expect(original).toEqual(saved)
  navigation.dispose()
})

it('defaults to the formal collapsed value and lets the quick bar control editing after playback', () => {
  const original = project(), geometry = hud(original, { width: 1000, height: 500 })
  original.instances.teacher.data = JSON.parse(JSON.stringify(createTeacherControllerData()))
  let playing = false
  const navigation = new ComponentNavigationOwner({ project: () => original, surfaceId: () => 'flow', select() {}, interactive: () => playing })
  expect(navigation.read().collapsed).toBe(true)
  expect(projectTeacherControllerInstances(original, geometry, navigation).instances.teacher.frame!.width).toBe(52)
  playing = true; navigation.setCollapsed(false)
  expect(navigation.read().collapsed).toBe(false)
  playing = false
  expect(navigation.read().collapsed).toBe(true)
  ;(original.instances.teacher.data as Record<string, unknown>).defaultCollapsed = false
  expect(navigation.read().collapsed).toBe(false)
  navigation.dispose()
})
