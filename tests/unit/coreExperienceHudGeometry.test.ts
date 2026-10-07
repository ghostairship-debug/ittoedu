import { expect, it } from 'vitest'
import type { ComponentFrame, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { createTeacherControllerData, TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller'
import { frameCorners, transformPoint } from '../../src/core/components/geometry'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits,
  teacherControllerReferenceSize } from '../../src/shared/teacherControllerViewportGeometry'

const project = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'hud', revision: 0, title: 'Mixed', definitions: { [TEACHER_CONTROLLER_DEFINITION.id]: TEACHER_CONTROLLER_DEFINITION },
  instances: { teacher: { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: JSON.parse(JSON.stringify({ ...createTeacherControllerData(), defaultCollapsed: false })),
    frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] } } }, global: { underlay: [], overlay: ['teacher'] }, assets: {},
  surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [], designSize: { width: 1280, height: 720 } },
    { id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }, { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [], designSize: { width: 960, height: 640 } }] })

it('projects directly into the actual HUD rect from one global reference, with the same inverse for hit and handles', () => {
  const original = project(), saved = structuredClone(original)
  const hud = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(original), viewportRect: { x: 40, y: 20, width: 1000, height: 500 } })
  const display = projectTeacherControllerInstances(original, hud), frame = display.instances.teacher.frame!
  const corners = frameCorners(frame)
  expect(corners.every(point => point.x >= 40 && point.x <= 1040 && point.y >= 20 && point.y <= 520)).toBe(true)
  const author = { x: 480, y: 650 }
  expect(hud.toAuthor(hud.toViewport(author)).x).toBeCloseTo(author.x)
  expect(hud.toAuthor(hud.toViewport(author)).y).toBeCloseTo(author.y)
  expect(frame.transform).toEqual([hud.scale, 0, 0, hud.scale, 40 + (1000 - 1280 * hud.scale) / 2 + 200 * hud.scale, 20 + 638 * hud.scale])
  expect(display.global).toBe(original.global)
  expect(original).toEqual(saved)
})

it('writes HUD movement and resized handles back to author coordinates once, preserving untouched axes and identity', () => {
  const original = project(), hud = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(original), viewportRect: { x: 0, y: 0, width: 640, height: 360 } })
  const display = projectTeacherControllerInstances(original, hud), before = display.instances.teacher.frame!
  const moved: ComponentFrame = { ...before, transform: [...before.transform] }
  moved.transform[5] -= 50
  const [edit] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId: 'teacher', frame: moved }], original, display, hud)
  expect(edit.type).toBe('frame.set')
  if (edit.type !== 'frame.set') return
  expect(edit.frame).toEqual({ width: 880, height: 64, transform: [1, 0, 0, 1, 200, 538] })
  const resized: ComponentFrame = { ...before, width: before.width + 100, transform: [...before.transform] }
  const [resize] = restoreTeacherControllerFrameEdits([{ type: 'frame.set', instanceId: 'teacher', frame: resized }], original, display, hud)
  expect(resize.type === 'frame.set' && resize.frame?.width).toBe(980)
  expect(transformPoint(hud.viewportToAuthor, { x: moved.transform[4], y: moved.transform[5] })).toEqual({ x: 200, y: 538 })
})
