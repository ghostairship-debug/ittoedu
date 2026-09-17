import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLessonAuthoringPrompt, readLessonAuthoringMethod } from '../../src/main/lessonAuthoringPrompt'

const base = {
  editorRoot: path.resolve('.'),
  mode: 'manual' as const,
  instruction: '解释闭合电路并安排一次观察操作',
  candidatePath: path.join(path.resolve('.'), 'candidate.md'),
  lessonDirectory: path.resolve('.'),
  materials: [],
}

describe('lesson authoring stage input', () => {
  it('U08-stage-input selects the current stage contract and keeps Builder guidance internal', async () => {
    const teachingBrief = await buildLessonAuthoringPrompt({ ...base, stage: 'teaching-brief', roleLabel: '教学简报' })
    const teachingPlan = await buildLessonAuthoringPrompt({ ...base, stage: 'teaching-plan', roleLabel: '教学策划' })
    const presentation = await buildLessonAuthoringPrompt({ ...base, stage: 'presentation-script', roleLabel: '呈现脚本' })
    const build = await buildLessonAuthoringPrompt({ ...base, stage: 'build', roleLabel: '课件构建模块' })
    const automaticBuild = await buildLessonAuthoringPrompt({ ...base, mode: 'automatic', stage: 'build', roleLabel: '课件构建模块' })
    expect(automaticBuild).toContain('文稿标为 draft 不构成阻断')
    expect(automaticBuild).toContain('外部独立 Skill 的教师确认停点不适用于本轮')
    expect(build).toContain('前置阶段当前稿的逐稿确认')
    expect(build).not.toContain('文稿标为 draft 不构成阻断')

    expect(teachingBrief).toContain('正文主推进设计合同')
    expect(teachingPlan).toContain('教学设计质量判断')
    expect(presentation).toContain('让互动产生可观察的学习')
    expect(teachingBrief).toContain('支持：1–6 级标题')
    expect(teachingBrief).not.toContain('课例 Markdown 候选校验')
    expect(teachingBrief).not.toContain('npx --no-install tsx scripts/validate-lesson-markdown.ts')
    expect(build).toContain('软件内 Builder V2 适用范围')
    expect(build).toContain('api.createCourseProject')
    expect(build).toContain('片段 → 学生动作')
    expect(build).toContain('原生节点 + 声明式交互')
    expect(build).toContain('保持可编辑')
    expect(build).toContain('真实视觉/互动复核')
    expect(build).not.toContain('npm --prefix')
    expect(build).not.toContain('npx --no-install')
    expect(build).not.toContain('npm run')
    expect(build).not.toContain('另起进程')
    expect(build).not.toContain('另起浏览器')
  })

  it('U08-stage-input rejects a build projection with a missing shared marker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lesson-stage-input-'))
    const referenceDirectory = path.join(root, '.agents', 'skills', 'build-courseware-project', 'references')
    await fs.mkdir(referenceDirectory, { recursive: true })
    await fs.writeFile(
      path.join(referenceDirectory, 'build-method.md'),
      [
        '## 软件内 Builder V2 适用范围',
        'api.createCourseProject',
        '<!-- lesson-authoring-shared:carrier:start -->',
        'carrier',
        '<!-- lesson-authoring-shared:carrier:end -->',
      ].join('\n'),
      'utf8',
    )
    try {
      await expect(readLessonAuthoringMethod(root, 'build')).rejects.toThrow('同源章节或标记')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
