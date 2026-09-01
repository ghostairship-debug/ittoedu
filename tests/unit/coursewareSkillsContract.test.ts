import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

describe('courseware skill contracts', () => {
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
