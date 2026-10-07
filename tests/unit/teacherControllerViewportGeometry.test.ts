import { expect, it } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { frameCorners, multiplyMatrices, type AffineMatrix } from '../../src/core/components/geometry'
import { projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, type TeacherControllerDisplayPort } from '../../src/shared/teacherControllerViewportGeometry'
import { createTeacherControllerData, TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'

const project = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'teacher-viewport', revision: 0, title: 'Mixed',
  definitions: { [TEACHER_CONTROLLER_DEFINITION.id]: TEACHER_CONTROLLER_DEFINITION },
  instances: { teacher: { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: { ...createTeacherControllerData(), defaultCollapsed: false },
    frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] } } },
  global: { underlay: [], overlay: ['teacher'] }, assets: {},
  surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [], designSize: { width: 1280, height: 720 } },
    { id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }, { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [], designSize: { width: 960, height: 640 } }] })

it('shows the same CSS frame in one actual viewport despite the three existing parent fits', () => {
  const original = project(), saved = structuredClone(original), viewport = { width: 1000, height: 500 }
  const parents: AffineMatrix[] = [[.5, 0, 0, .5, 24, 16], [1, 0, 0, 1, 0, 0], [.75, 0, 0, .75, 140, 10]]
  for (const parent of parents) {
    const display = projectTeacherControllerInstances(original, viewport, parent), frame = display.instances.teacher.frame!
    expect([frame.width, frame.height]).toEqual([880, 64])
    const screen = multiplyMatrices(parent, frame.transform)
    ;[1, 0, 0, 1, 120, 436].forEach((expected, index) => expect(screen[index]).toBeCloseTo(expected, 8))
    expect(display.global).toBe(original.global)
    expect(display.surfaces).toBe(original.surfaces)
  }
  expect(original).toEqual(saved)
})

it('saves an upward drag from the visible clamped position without shrinking or moving the untouched axis', () => {
  const original = project(), viewport = { width: 800, height: 400 }, parent: AffineMatrix = [.5, 0, 0, .5, 0, 0]
  const display = projectTeacherControllerInstances(original, viewport, parent), before = display.instances.teacher.frame!
  const moved = { ...before, transform: [...before.transform] as typeof before.transform }
  moved.transform[5] -= 100
  const edits = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId: 'teacher', frame: moved }], original, display, viewport, parent)
  expect(edits).toEqual([{ type: 'frame.set', instanceId: 'teacher', frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 286] } }])
  const reopened = { ...original, instances: { ...original.instances, teacher: { ...original.instances.teacher, frame: edits[0].type === 'frame.set' ? edits[0].frame! : before } } }
  const shownAgain = projectTeacherControllerInstances(reopened, viewport, parent).instances.teacher.frame!
  expect(multiplyMatrices(parent, shownAgain.transform)[5]).toBe(286)
})

it('keeps collapsed footprint and session offsets in CSS pixels without changing the author frame', () => {
  const original = project(), viewport = { width: 1400, height: 900 }, parent: AffineMatrix = [.5, 0, 0, .5, 10, 20]
  const port: TeacherControllerDisplayPort = { read: () => ({ locationId: 'flow', scenes: [], progress: null, collapsed: true, zoom: 1, muted: false, fullscreen: false }),
    subscribe: () => () => {}, setCollapsed() {}, placement: () => ({ x: 30, y: -20 }) }
  const frame = projectTeacherControllerInstances(original, viewport, parent, port).instances.teacher.frame!
  expect([frame.width, frame.height]).toEqual([52, 52])
  expect(multiplyMatrices(parent, frame.transform)).toEqual([1, 0, 0, 1, 1058, 630])
  expect(original.instances.teacher.frame).toEqual({ width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] })
})

it('fits an existing resized affine frame by its actual bounds without changing the saved frame', () => {
  const original = project(), viewport = { width: 1000, height: 500 }, parent: AffineMatrix = [.5, 0, 0, .5, 20, 10]
  original.instances.teacher.frame!.transform = [2, 0, 0, 2, 200, 638]
  const saved = structuredClone(original.instances.teacher.frame)
  const frame = projectTeacherControllerInstances(original, viewport, parent).instances.teacher.frame!
  const corners = frameCorners(frame, parent)
  expect(Math.min(...corners.map(point => point.x))).toBeGreaterThanOrEqual(0)
  expect(Math.max(...corners.map(point => point.x))).toBeLessThanOrEqual(1000)
  expect(Math.min(...corners.map(point => point.y))).toBeGreaterThanOrEqual(0)
  expect(Math.max(...corners.map(point => point.y))).toBeLessThanOrEqual(500)
  expect(original.instances.teacher.frame).toEqual(saved)
})

it('starts runtime dragging at the visible clamped position using the original session offset owner', () => {
  const original = project(), saved = structuredClone(original), viewport = { width: 1000, height: 500 }
  const navigation = new ComponentNavigationOwner({ project: () => original, surfaceId: () => 'flow', select() {},
    viewportBounds: () => ({ left: 100, top: 50, right: 1100, bottom: 550 }) })
  navigation.moveBy(-50, -50)
  const frame = projectTeacherControllerInstances(original, viewport, undefined, navigation).instances.teacher.frame!
  expect(frame.transform).toEqual([1, 0, 0, 1, 70, 386])
  navigation.moveBy(-10, -10)
  expect(projectTeacherControllerInstances(original, viewport, undefined, navigation).instances.teacher.frame!.transform).toEqual([1, 0, 0, 1, 60, 376])
  expect(original).toEqual(saved)
  navigation.dispose()
})

it('defaults to the original collapsed author value and lets the formal quick-bar value control editing after playback', () => {
  const original = project()
  original.instances.teacher.data = JSON.parse(JSON.stringify(createTeacherControllerData()))
  let playing = false
  const navigation = new ComponentNavigationOwner({ project: () => original, surfaceId: () => 'flow', select() {}, interactive: () => playing })
  expect(navigation.read().collapsed).toBe(true)
  expect(projectTeacherControllerInstances(original, { width: 1000, height: 500 }, undefined, navigation).instances.teacher.frame!.width).toBe(52)
  playing = true; navigation.setCollapsed(false)
  expect(navigation.read().collapsed).toBe(false)
  playing = false
  expect(navigation.read().collapsed).toBe(true)
  ;(original.instances.teacher.data as Record<string, unknown>).defaultCollapsed = false
  expect(navigation.read().collapsed).toBe(false)
  navigation.dispose()
})
