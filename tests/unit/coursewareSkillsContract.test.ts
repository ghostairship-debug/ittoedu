import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { courseAgentMethodSkills, courseAgentBundledSkills } from '@/shared/courseAgentSkills'
import { BundledSkillService } from '@/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '@/main/workbench/skills/ScopedSkillService'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { createBlankCourseProjectV10 } from '@/core/course/createCourseProjectV10'
import { CourseV10Driver } from '@/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '@/core/drivers/courseV10Operations'
import { componentRuleEdits } from '@/shared/componentInteractionData'
import { ComponentPlatformRuntime } from '@/player/components/ComponentPlatformRuntime'
import type { InteractionRule } from '@/shared/interactionTypes'
const repoRoot = process.cwd()
const read = (name: string) => readFile(path.join(repoRoot, name), 'utf8')

describe('courseware skill contracts: staged project authoring and external import', () => {
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
    expect(orchestrator).toContain('策划、框架默认各确认一次')
    expect(orchestrator).toContain('关键知识不能只出现在答案反馈或素材说明中')
    expect(orchestrator).toContain('图甲')
    expect(contract).toContain('默认教师演示允许讲解后')
    expect(contract).toContain('用户明确要求自主学习')
    expect(builder).toContain('新课创作从框架起写入工程内文件')
    expect(builder).toContain('不删除互动逻辑')
  })
  it('keeps one bundled method source, includes the short HTML contract and matches editable skill files', async () => {
    const brief = await read('.agents/skills/build-courseware-project/references/representation-capabilities.md')
    const bundled = JSON.parse(await read('src/shared/generated/bundledSkills.json'))
    const resources = JSON.parse(await read('artifacts/ai-capabilities/discovery-data.json')).resourcePaths as string[]
    expect(brief.length).toBeLessThanOrEqual(1500)
    expect(bundled.manifest.skills.map((skill: { name: string }) => skill.name)).toEqual(courseAgentBundledSkills.map(skill => skill.name))
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
  it('discovers a shared guide and reads every method link without crossing a Skill root', async () => {
    const bundle = JSON.parse(await read('src/shared/generated/bundledSkills.json'))
    const service = new BundledSkillService(bundle)
    expect((await service.catalog()).map(skill => skill.name)).toContain('workbench-usage')
    for (const { name } of courseAgentMethodSkills) {
      const entry = await service.read({ skill: name, path: 'SKILL.md', offset: 0, limit: 64_000 })
      expect(entry.status).toBe('read')
      if (entry.status !== 'read') throw new Error(`Unreadable method: ${name}`)
      const links = [...entry.content.matchAll(/\]\(([^)]+\.md)\)/g)].map(match => match[1]!)
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) {
        const resolved = path.posix.normalize(`skills/${name}/${link}`)
        const [, skill, ...parts] = resolved.split('/')
        const resourcePath = parts.join('/')
        const result = await service.read({ skill: skill!, path: resourcePath, offset: 0, limit: 64_000 })
        expect(result).toMatchObject({ status: 'read', content: await read(`.agents/${resolved}`), truncated: false })
      }
    }
    const edit = await service.read({ skill: 'edit-content', path: 'SKILL.md', offset: 0, limit: 64_000 })
    if (edit.status !== 'read') throw new Error('Unreadable editing method')
    expect(edit.content).not.toContain('../orchestrate-courseware/')
    // Sharing a separate source does not relax the existing root boundary.
    expect(await service.read({ skill: 'edit-content', path: '../workbench-usage/SKILL.md', offset: 0, limit: 100 }))
      .toMatchObject({ status: 'unknown-path' })
  })
  it('installs actual sources into an isolated destination and discovers the same shared files through scoped reads', async () => {
    const destination = await mkdtemp(path.join(os.tmpdir(), 'ni06-skills-install-'))
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(repoRoot, 'scripts/install-courseware-skills.ps1'), '-SourceRoot', path.join(repoRoot, '.agents/skills'),
        '-DestinationRoot', destination], { windowsHide: true })
      const service = new ScopedSkillService(new BundledSkillService({ manifest: { skills: [] }, files: {} }),
        async () => [{ source: 'user', directory: destination, authorizedRoot: destination }])
      expect((await service.list('isolated-install')).entries.map(skill => skill.name))
        .toEqual(expect.arrayContaining(courseAgentBundledSkills.map(skill => `user/${skill.name}`)))
      for (const resource of ['SKILL.md', 'references/selection-and-editing.md', 'references/project-files.md',
        'references/resources-and-artifacts.md', 'references/sources-and-continuation.md', 'references/files-and-delivery.md']) {
        expect(await service.read({ skill: 'user/workbench-usage', path: resource, offset: 0, limit: 64_000 }, 'isolated-install'))
          .toMatchObject({ status: 'read', content: await read(`.agents/skills/workbench-usage/${resource}`), truncated: false })
      }
    } finally { await rm(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
  })
  it('retains the real declarative state constraints without forcing them onto every draft page', async () => {
    const progression = await read('.agents/skills/build-courseware-project/references/main-progression.md')
    let project = createBlankCourseProjectV10('自主学习状态')
    project.logic = { navigationGuards: [], courseState: [
      { key: 'ready', valueType: 'boolean', defaultValue: false },
      { key: 'existsSeen', valueType: 'boolean', defaultValue: false },
      { key: 'comparedTrue', valueType: 'boolean', defaultValue: false },
    ] }
    const rules: InteractionRule[] = [
      { id: 'exists', name: '已声明', enabled: true, trigger: { type: 'presenter.command', command: 'next' },
        conditions: [{ type: 'course-state.exists', key: 'ready', exists: true }],
        actions: [{ id: 'exists-action', start: 'after-previous', delayMs: 0,
          action: { type: 'course-state.set', key: 'existsSeen', value: true } }] },
      { id: 'compare', name: '已完成', enabled: true, trigger: { type: 'presenter.command', command: 'previous' },
        conditions: [{ type: 'course-state.compare', key: 'ready', operator: 'eq', value: true }],
        actions: [{ id: 'compare-action', start: 'after-previous', delayMs: 0,
          action: { type: 'course-state.set', key: 'comparedTrue', value: true } }] },
    ]
    const driver = new CourseV10Driver(), resources = { assets: {}, components: {} }
    const applyRules = () => {
      const result = driver.apply({ kind: 'course-v10', project, resources },
        captureComponentOperation(project, componentRuleEdits(project, { kind: 'project' }, rules)))
      if (result.kind !== 'course-v10') throw new Error('Expected V10 state authoring')
      project = result.project
    }
    applyRules()
    const world = new ComponentPlatformRuntime('skill-state-contract')
    try {
      await world.sync(project, resources)
      expect(world.getState('ready')).toBe(false)
      expect(await world.dispatchPresenterCommand('previous')).toBe(false)
      expect(world.getState('comparedTrue')).toBe(false)
      expect(await world.dispatchPresenterCommand('next')).toBe(true)
      expect(world.getState('existsSeen')).toBe(true)
      expect(world.getState('ready')).toBe(false)
      rules.push({ id: 'complete', name: '完成任务', enabled: true, trigger: { type: 'presenter.command', command: 'next' },
        conditions: [{ type: 'course-state.compare', key: 'ready', operator: 'eq', value: false }],
        actions: [{ id: 'complete-action', start: 'after-previous', delayMs: 0,
          action: { type: 'course-state.set', key: 'ready', value: true } }] })
      applyRules()
      await world.sync(project, resources)
      expect(await world.dispatchPresenterCommand('next')).toBe(true)
      expect(world.getState('ready')).toBe(true)
      expect(world.getState('comparedTrue')).toBe(false)
      expect(await world.dispatchPresenterCommand('previous')).toBe(true)
      expect(world.getState('comparedTrue')).toBe(true)
    } finally { await world.dispose() }
    expect(progression).toContain('自主学习确需状态时')
    expect(progression).toContain('不要把 `exists` 误当“已完成”')
    expect(progression).toContain('不直接改 document 绕过正式命令')
  })
})
