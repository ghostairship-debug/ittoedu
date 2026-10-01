import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const repoRoot = process.cwd()
const read = (name: string) => readFile(path.join(repoRoot, name), 'utf8')

describe('courseware skill contracts: reliable draft and user-led refinement', () => {
  it('rejects an invalid explicit product root before consulting a cached alternate product', async () => {
    let failure: { stdout?: string } | undefined
    try { await promisify(execFile)(process.execPath, [path.join(repoRoot, '.agents/skills/build-courseware-project/scripts/resolve-editor-root.mjs'), '--no-cache'],
      { windowsHide: true, env: { ...process.env, COURSEWARE_EDITOR_ROOT: path.join(repoRoot, 'output', `missing-product-${crypto.randomUUID()}`) } }) }
    catch (error) { failure = error as { stdout?: string } }
    expect(JSON.parse(failure?.stdout ?? '{}')).toMatchObject({ ok: false, error: 'explicit_editor_root_invalid' })
  })
  it('keeps short default entries while preserving opt-in external engineering methods', async () => {
    const entry = await read('.agents/skills/build-courseware-project/SKILL.md')
    const method = await read('.agents/skills/build-courseware-project/references/build-method.md')
    expect(Buffer.byteLength(entry)).toBeLessThanOrEqual(6 * 1024)
    expect(entry).toContain('[build-method.md](references/build-method.md)')
    expect(entry).toContain('默认不展开逐页 AI 视觉精修')
    expect(entry).toContain('只有外部 Builder 或用户要求完整工程')
    expect(entry).toContain('file.create → html.import → file.save')
    for (const topic of ['载体所有权', '资产与任务图', '先做最高风险纵切', '增量构建与 Worker', '保持可编辑', '验证与交付', '停止条件']) expect(method).toContain(topic)
    expect(method).toContain('分类与排序必须分开选载体')
    expect(method).toContain('外部 Builder V2')
  })
  it('keeps real teaching content and separates teacher navigation from self-study gates', async () => {
    const orchestrator = await read('.agents/skills/orchestrate-courseware/SKILL.md')
    const contract = await read('.agents/skills/orchestrate-courseware/references/main-progression.md')
    const builder = await read('.agents/skills/build-courseware-project/SKILL.md')
    expect(orchestrator).toContain('不固定插入两次确认')
    expect(orchestrator).toContain('关键知识不能只出现在答案反馈或素材说明中')
    expect(orchestrator).toContain('图甲')
    expect(contract).toContain('默认教师演示允许讲解后')
    expect(contract).toContain('用户明确要求自主学习')
    expect(builder).toContain('核心教学呈现必须存在')
    expect(builder).toContain('不删除互动逻辑')
    expect(builder).toContain('文件字节回读')
  })
  it('keeps one bundled method source, includes the short HTML contract and matches editable skill files', async () => {
    const brief = await read('.agents/skills/build-courseware-project/references/representation-capabilities.md')
    const bundled = JSON.parse(await read('src/shared/generated/bundledSkills.json'))
    const resources = JSON.parse(await read('artifacts/ai-capabilities/discovery-data.json')).resourcePaths as string[]
    expect(brief.length).toBeLessThanOrEqual(1500)
    expect(bundled.manifest.skills.map((skill: { name: string }) => skill.name)).toEqual(['orchestrate-courseware', 'build-courseware-project'])
    expect(resources).toContain('skills/build-courseware-project/references/html-draft-contract.md')
    for (const name of ['orchestrate-courseware', 'build-courseware-project'])
      expect(await read(`artifacts/ai-capabilities/skills/${name}/SKILL.md`)).toBe(await read(`.agents/skills/${name}/SKILL.md`))
    for (const old of ['courseware-session', 'course-design', 'course-build', 'qa-repair', 'style-remix', 'pro-editing', 'visual-craft', 'interaction-craft']) expect(resources).not.toContain(`skills/${old}/SKILL.md`)
  })
  it('retains the real declarative state constraints without forcing them onto every draft page', async () => {
    const progression = await read('.agents/skills/build-courseware-project/references/main-progression.md')
    const index = JSON.parse(await read('artifacts/ai-capabilities/index.json'))
    expect(index.interactions.publishedPlayback.conditionTypes).toEqual(expect.arrayContaining(['course-state.exists', 'course-state.compare']))
    expect(index.interactions.publishedPlayback.actionTypes).toContain('course-state.set')
    expect(progression).toContain('自主学习确需状态时')
    expect(progression).toContain('不要把 `exists` 误当“已完成”')
    expect(progression).toContain('不直接改 document 绕过正式命令')
  })
})
