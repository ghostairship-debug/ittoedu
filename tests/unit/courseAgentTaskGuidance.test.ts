import { describe, expect, it } from 'vitest'
import {
  courseAgentTaskGuidance,
  teacherControllerGuidance,
  titleAlignmentGuidance,
} from '../../src/shared/courseAgentTaskGuidance'

describe('course agent task guidance', () => {
  it('U02-targeted-guidance loads alignment guidance only for title/layout work', () => {
    expect(courseAgentTaskGuidance({ instruction: '添加标题并居中' })).toEqual([titleAlignmentGuidance])
    expect(courseAgentTaskGuidance({ instruction: '将正文文字居中' })).toEqual([titleAlignmentGuidance])
    expect(courseAgentTaskGuidance({ instruction: '把正文改成绿色' })).toEqual([])
    expect(courseAgentTaskGuidance({ instruction: '调整图片布局' })).toEqual([])
  })

  it('U02-targeted-guidance keeps controller guidance available for controller tasks', () => {
    expect(courseAgentTaskGuidance({ instruction: '修改控制台源码' })).toEqual([teacherControllerGuidance])
    expect(courseAgentTaskGuidance({ instruction: '修改组件参数', context: { capabilities: { toolIds: ['component.configure'] } } }))
      .toEqual([teacherControllerGuidance])
  })
})
