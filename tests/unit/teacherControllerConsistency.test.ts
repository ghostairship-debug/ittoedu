import { isControllerFixture } from '../fixtures/teacherController'
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import type { CourseProjectDocument, GlobalLayerEntry } from '../../src/shared/courseProjectTypes'
import {
  hasCourseDeliveryVisibleTeacherController,
  synchronizeCourseTeacherControllerControls,
} from '../../src/shared/teacherControllerConsistency'

function controllerEntry(project: CourseProjectDocument): GlobalLayerEntry {
  const entry = project.globalLayerItems.find((candidate) => (
    isControllerFixture(candidate.item)
  ))
  if (!entry) throw new Error('测试工程缺少教师控制器')
  return entry
}

const unusableCases: Array<[
  string,
  (entry: GlobalLayerEntry) => void,
]> = [
  ['transparent', (entry) => { entry.item.opacity = 0 }],
  ['outside canvas', (entry) => { entry.item.frame.x = 1280 }],

]

describe('teacher controller delivery consistency', () => {
  it('requires explicit controls when the default controller is omitted', () => {
    expect(() => createBlankCourseProject({ includeDefaultController: false } as never))
      .toThrow('必须显式设置 controls')
  })

  it('accepts the default overlay controller as statically usable', () => {
    const project = createBlankCourseProject()
    expect(hasCourseDeliveryVisibleTeacherController(project)).toBe(true)
  })

  it.each(unusableCases)(
    'rejects a canvas controller that is %s and heals controls to none',
    (_label, mutate) => {
      const project = createBlankCourseProject()
      mutate(controllerEntry(project))

      expect(hasCourseDeliveryVisibleTeacherController(project)).toBe(false)
      synchronizeCourseTeacherControllerControls(project)
      expect(project.playback.controls).toBe('none')
    },
  )
})


it('keeps a step-only controller usable without rewriting its authored buttons', () => {
  const project = createBlankCourseProject()
  const entry = controllerEntry(project)
  if (!isControllerFixture(entry.item)) throw new Error('missing controller')
  entry.item.props.buttons = [
    { id: 'only-step', action: { type: 'step.next' }, label: '继续讲解', visible: true },
  ]
  const before = structuredClone(entry.item.props.buttons)
  expect(hasCourseDeliveryVisibleTeacherController(project)).toBe(true)
  synchronizeCourseTeacherControllerControls(project)
  expect(project.playback.controls).toBe('canvas')
  expect(entry.item.props.buttons).toEqual(before)
})
