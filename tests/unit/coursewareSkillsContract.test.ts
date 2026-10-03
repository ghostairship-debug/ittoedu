import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { courseAgentMethodSkills } from '@/shared/courseAgentSkills'
import { BundledSkillService } from '@/main/workbench/skills/BundledSkillService'
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
  it('keeps the default task entry short and makes opt-in engineering references readable from the installed bundle', async () => {
    const entry = await read('.agents/skills/build-courseware-project/SKILL.md')
    const method = await read('.agents/skills/build-courseware-project/references/build-method.md')
    expect(Buffer.byteLength(entry)).toBeLessThanOrEqual(6 * 1024)
    expect(entry).toContain('[build-method.md](references/build-method.md)')
    expect(entry).toContain('course.createFromHtml')
    expect(entry).not.toContain('file.create → html.import → file.save')
    expect(method).toContain('外部 Builder V2')
    const bundle = JSON.parse(await read('src/shared/generated/bundledSkills.json'))
    const service = new BundledSkillService(bundle)
    for (const reference of ['references/build-method.md', 'references/external-case-build.md', 'references/page-design.md']) {
      const result = await service.read({ skill: 'build-courseware-project', path: reference, offset: 0, limit: 64_000 })
      expect(result).toMatchObject({ status: 'read', content: await read(`.agents/skills/build-courseware-project/${reference}`), truncated: false })
    }
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
  })
  it('keeps one bundled method source, includes the short HTML contract and matches editable skill files', async () => {
    const brief = await read('.agents/skills/build-courseware-project/references/representation-capabilities.md')
    const bundled = JSON.parse(await read('src/shared/generated/bundledSkills.json'))
    const resources = JSON.parse(await read('artifacts/ai-capabilities/discovery-data.json')).resourcePaths as string[]
    expect(brief.length).toBeLessThanOrEqual(1500)
    expect(bundled.manifest.skills.map((skill: { name: string }) => skill.name)).toEqual(courseAgentMethodSkills.map(skill => skill.name))
    expect(bundled.manifest.skills.map((skill: { name: string }) => skill.name)).toContain('edit-content')
    expect(resources).toContain('skills/build-courseware-project/references/html-draft-contract.md')
    for (const { name } of courseAgentMethodSkills)
      expect(await read(`artifacts/ai-capabilities/skills/${name}/SKILL.md`)).toBe(await read(`.agents/skills/${name}/SKILL.md`))
    const assemblyPath = 'skills/orchestrate-courseware/scripts/assemble-html.mjs'
    expect(resources).toContain(assemblyPath)
    const service = new BundledSkillService(bundled)
    expect(await service.read({ skill: 'orchestrate-courseware', path: 'scripts/assemble-html.mjs', offset: 0, limit: 64_000 }))
      .toMatchObject({ status: 'read', content: await read('.agents/skills/orchestrate-courseware/scripts/assemble-html.mjs'), truncated: false })
    expect(await service.read({ skill: 'office-content', path: 'SKILL.md', offset: 0, limit: 64_000 }))
      .toMatchObject({ status: 'read', content: await read('.agents/skills/office-content/SKILL.md'), truncated: false })
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
