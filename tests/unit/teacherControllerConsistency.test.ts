import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import type { CourseProjectDocument, GlobalLayerEntry } from '../../src/shared/courseProjectTypes'
import {
  hasCourseDeliveryVisibleTeacherController,
  isCourseTeacherControllerLayerItem,
  synchronizeCourseTeacherControllerControls,
} from '../../src/shared/teacherControllerConsistency'

function controllerEntry(project: CourseProjectDocument): GlobalLayerEntry {
  const entry = project.globalLayerItems.find((candidate) => (
    isCourseTeacherControllerLayerItem(candidate.item)
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
  ['no visible navigation action', (entry) => {
    if (!isCourseTeacherControllerLayerItem(entry.item)) return
    entry.item.content.data.buttons.forEach((button) => {
      button.visible = button.action.type === 'audio.toggle-mute'
    })
  }],
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
