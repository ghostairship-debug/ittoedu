import { describe, expect, it } from 'vitest'
import {
  courseAgentTaskGuidance,
  generationRepairFeedbackGuidance,
  teacherControllerGuidance,
  titleAlignmentGuidance,
} from '../../src/shared/courseAgentTaskGuidance'
import { courseAgentSkillMarkdown, courseAgentSkills } from '../../src/shared/courseAgentSkills'

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
    expect(courseAgentSkillMarkdown(courseAgentSkills.find(skill => skill.name === 'course-design')!))
      .not.toContain(teacherControllerGuidance)
  })

  it('U02-repair-feedback preserves continuation and terminal guards without a model call', () => {
    const repair = courseAgentSkillMarkdown(courseAgentSkills.find(skill => skill.name === 'qa-repair')!)
    expect(repair).toContain('失败或明确的具体差距可在当前任务预算')
    expect(repair).toContain('committed/unchanged')
    expect(repair).toContain('Stop')
    expect(repair).toContain(generationRepairFeedbackGuidance)
    expect(repair).toContain('不复活过期候选')
  })
})
