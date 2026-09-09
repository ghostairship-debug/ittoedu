import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGenerationProfile } from '../../src/main/localAgent/profile'
import type { GenerationRequest } from '../../src/shared/generationContract'
import { courseAgentSkills } from '../../src/shared/courseAgentSkills'

describe('neutral CLI candidate profiles', () => {
  it('loads identical skill guidance and declares each implemented candidate channel', () => {
    const request = { requestId: '89e7b74a-2ba4-4f03-ad94-89aef212a776', purpose: 'single-page' } as GenerationRequest
    const profiles = ['codex', 'claude', 'opencode'].map(adapter => createGenerationProfile(adapter as 'codex' | 'claude' | 'opencode', request))
    expect(profiles[0]?.skills).toEqual(profiles[1]?.skills)
    expect(profiles[1]?.skills).toEqual(profiles[2]?.skills)
    expect(profiles.map(profile => [profile.resultChannel, profile.capability.candidateFileIngestion])).toEqual([
      ['app-server-json-schema', false],
      ['session-staging-file', true],
      ['session-staging-file', true],
    ])
    expect(profiles.every(profile => profile.resultContract.mode === 'reply-or-edit')).toBe(true)
    expect(createGenerationProfile('codex', { ...request, expectedResult: 'candidate' }).resultContract).toEqual({
      mode: 'candidate', candidateInputEncoding: 'json-string',
    })
    expect(profiles.every(profile => profile.capability.liveProjectTools === false)).toBe(true)
    expect(courseAgentSkills).toHaveLength(7)
    const build = createGenerationProfile('codex', { ...request, purpose: 'whole-course' })
    expect(build.skills.map(skill => skill.name)).toContain('course-build')
    expect(() => createGenerationProfile('claude', request, 'live-mcp')).toThrow('未开放')
    expect(() => createGenerationProfile('codex', request, 'session-staging-file')).toThrow('不支持')
  })
})

const repoRoot = process.cwd()

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

describe('courseware skill contracts', () => {
  it('rejects an invalid explicit product root before consulting a cached or alternate product', async () => {
    let failure: { stdout?: string } | undefined
    try {
      await promisify(execFile)(process.execPath, [path.join(repoRoot, '.agents/skills/build-courseware-project/scripts/resolve-editor-root.mjs'), '--no-cache'],
        { windowsHide: true, env: { ...process.env, COURSEWARE_EDITOR_ROOT: path.join(repoRoot, 'output', `missing-product-${crypto.randomUUID()}`) } })
    } catch (error) { failure = error as { stdout?: string } }
    expect(JSON.parse(failure?.stdout ?? '{}')).toMatchObject({ ok: false, error: 'explicit_editor_root_invalid' })
  })

  it('keeps the cold entry small while preserving the full teaching, carrier, visual and verification methods', async () => {
    const [entry, methods, resolver] = await Promise.all([
      readRepoFile('.agents/skills/build-courseware-project/SKILL.md'),
      readRepoFile('.agents/skills/build-courseware-project/references/build-method.md'),
      readRepoFile('.agents/skills/build-courseware-project/scripts/resolve-editor-root.mjs'),
    ])
    expect(Buffer.byteLength(entry)).toBeLessThanOrEqual(6 * 1024)
    expect(entry).toContain('[build-method.md](references/build-method.md)')
    expect(entry).toContain('教师看过并明确确认')
    expect(entry).toContain('observe()')
    expect(entry).toContain('readReceipts')
    for (const topic of ['载体所有权', '资产与任务图', '先做最高风险纵切', '增量构建与 Worker', '保持可编辑', '验证与交付', '停止条件']) expect(methods).toContain(topic)
    expect(methods).toContain('分类与排序必须分开选载体')
    expect(methods).not.toContain('编辑器内没有可见 AI')
    expect(resolver).toContain('semanticVersion')
    expect(resolver).not.toContain('b.indexMtime - a.indexMtime')
  })

  it('loads the body-first progression contract from both workflow entrypoints', async () => {
    const [orchestrator, builder] = await Promise.all([
      readRepoFile('.agents/skills/orchestrate-courseware/SKILL.md'),
      readRepoFile('.agents/skills/build-courseware-project/SKILL.md'),
    ])

    expect(orchestrator).toContain('[main-progression.md](references/main-progression.md)')
    expect(orchestrator).toContain('教师控制器只作课堂兜底')
    expect(builder).toContain('[main-progression.md](references/main-progression.md)')
    expect(builder).toContain('先证明控制器隐藏时的正文主路径')
  })

  it('requires every nonterminal script position to expose a recoverable body action', async () => {
    const contract = await readRepoFile(
      '.agents/skills/orchestrate-courseware/references/main-progression.md',
    )

    expect(contract).toContain('每个非终点位置')
    expect(contract).toContain('包括分支位置')
    expect(contract).toContain('正文内看见并使用什么触发面')
    expect(contract).toContain('触发后去往哪个位置')
    expect(contract).toContain('失败、未完成或守卫拦截后怎样获得反馈并继续')
    expect(contract).toContain('不为控制器预留正文安全区')
    expect(contract).toContain('控制器按钮、缩略导航、键盘快捷键')
  })

  it('returns incomplete paths to orchestration and proves body navigation before fallback controls', async () => {
    const contract = await readRepoFile(
      '.agents/skills/build-courseware-project/references/main-progression.md',
    )
    const bodyGate = contract.indexOf('隐藏或收起教师控制器')
    const controllerGate = contract.indexOf('单独验证控制器的恢复')

    expect(contract).toContain('停止构建并返回 `$orchestrate-courseware`')
    expect(contract).toContain('至少存在一条有限的起点到终点正文路径')
    expect(contract).toContain('每个非终点分支都能经正文动作到达某个教学终点')
    expect(contract).toContain('不为控制器预留安全区')
    expect(contract).toContain('守卫拦截、错误反馈、重试、揭示和自动推进')
    expect(contract).toContain('执行重新开始')
    expect(bodyGate).toBeGreaterThan(-1)
    expect(controllerGate).toBeGreaterThan(bodyGate)
    expect(contract).toContain('控制器成功不能补偿正文路径失败')
  })

  it('routes the real declarative course-state slice without restoring stale limitations', async () => {
    const [builder, capabilities, progression, generatedIndex] = await Promise.all([
      readRepoFile('.agents/skills/build-courseware-project/SKILL.md'),
      readRepoFile('.agents/skills/build-courseware-project/references/current-capabilities.md'),
      readRepoFile('.agents/skills/build-courseware-project/references/main-progression.md'),
      readRepoFile('artifacts/ai-capabilities/index.json'),
    ])
    const index = JSON.parse(generatedIndex) as {
      interactions: {
        publishedPlayback: {
          actionTypes: string[]
          conditionTypes: string[]
        }
      }
    }

    expect(index.interactions.publishedPlayback.conditionTypes).toEqual(expect.arrayContaining([
      'course-state.exists',
      'course-state.compare',
    ]))
    expect(index.interactions.publishedPlayback.actionTypes).toContain('course-state.set')
    expect(progression).toContain('`course-state.exists` / `course-state.compare`')
    expect(progression).toContain('同步 `course-state.set`')
    expect(progression).toContain('不要把 `exists` 误当“已完成”')
    expect(progression).toContain('没有通用作者命令时')
    expect(progression).toContain('不直接改 document 绕过正式命令')
    expect(`${builder}\n${capabilities}`).not.toContain('声明式交互当前**读不到也写不到**')
    expect(`${builder}\n${capabilities}`).not.toContain('状态写入：仅 Runtime/Component')
  })
})
