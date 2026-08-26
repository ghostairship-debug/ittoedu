import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkTaskBoard,
  generateTaskBoard,
  hotspotTags,
  parseTaskCard,
  readTaskCards,
  renderTaskBoard,
  taskStatuses,
  writeTaskBoard,
} from '../../scripts/generate-task-board'

const tempRoots: string[] = []

async function createProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'lean-task-board-'))
  tempRoots.push(root)
  return root
}

async function writeCard(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, 'docs', 'development-plan', 'tasks', relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

function s1Card(overrides: Partial<Record<string, string>> = {}): string {
  const fields = {
    statusOwner: 'queued /',
    riskHotspot: 'S1 / none',
    outcome: '修复一个可观察的用户行为',
    writeScope: 'src/renderer/ui/SomeTab.tsx',
    acceptance: '行为 X 在真实浏览器中可观察',
    focused: 'npm run test -- --run tests/unit/someTab.test.tsx',
    ...overrides,
  }
  return [
    '# repair-demo-01 演示任务',
    '',
    `- Status / Owner: ${fields.statusOwner}`,
    `- Risk / Hotspot: ${fields.riskHotspot}`,
    `- Outcome / Why now: ${fields.outcome}`,
    `- Write scope / Baseline: ${fields.writeScope}`,
    `- Acceptance: ${fields.acceptance}`,
    `- Focused validation: ${fields.focused}`,
    '',
  ].join('\n')
}

function s2Card(id: string, statusOwner: string, hotspot: string, safety = '回滚到 baseline；使用 fixture 副本'): string {
  return [
    `# ${id} 高风险演示任务`,
    '',
    `- Status / Owner: ${statusOwner}`,
    `- Risk / Hotspot: S2 / ${hotspot}`,
    '- Outcome / Why now: 某个 S2 用户行为与证据',
    '- Write scope / Baseline: src/main/**; baseline a7d11e9',
    '- Acceptance: 行为可观察且失败路径可回滚',
    '- Focused validation: npm run test -- --run tests/unit/mainSecurity.test.ts',
    `- S2 safety / rollback: ${safety}`,
    '',
  ].join('\n')
}

describe('lean task card parsing', () => {
  it('parses a minimal queued S1 card', () => {
    const record = parseTaskCard(s1Card(), 'docs/development-plan/tasks/repair/repair-demo-01.md')
    expect(record.id).toBe('repair-demo-01')
    expect(record.status).toBe('queued')
    expect(record.owner).toBe('')
    expect(record.risk).toBe('S1')
    expect(record.hotspots).toEqual(['none'])
  })

  it('parses an active S2 card with multiple hotspots and owner', () => {
    const record = parseTaskCard(
      s2Card('repair-sec-01', 'active / integrator', 'main-preload, contracts-schema'),
      'docs/development-plan/tasks/repair/repair-sec-01.md',
    )
    expect(record.status).toBe('active')
    expect(record.owner).toBe('integrator')
    expect(record.hotspots).toEqual(['main-preload', 'contracts-schema'])
    expect(record.safetyRollback).toContain('回滚')
  })

  it('rejects legacy or unknown statuses', () => {
    for (const status of ['ready', 'claimed', 'done', 'implementing']) {
      expect(() =>
        parseTaskCard(s1Card({ statusOwner: `${status} / someone` }), 'card.md'),
      ).toThrow(/任务状态无效/)
    }
    expect(taskStatuses).toEqual(['queued', 'active', 'blocked'])
  })

  it('requires an owner for active cards', () => {
    expect(() => parseTaskCard(s1Card({ statusOwner: 'active /' }), 'card.md')).toThrow(
      /active 任务必须有唯一 Owner/,
    )
  })

  it('requires a write scope for every persisted card', () => {
    expect(() => parseTaskCard(s1Card({ writeScope: '' }), 'card.md')).toThrow(
      /Write scope \/ Baseline/,
    )
  })

  it('requires S2 safety / rollback for S2 cards', () => {
    const card = s2Card('repair-x', 'queued /', 'main-preload', '')
    expect(() => parseTaskCard(card, 'card.md')).toThrow(/S2 任务必须填写/)
  })

  it('rejects unknown, empty, or mixed-none hotspot tags', () => {
    expect(() => parseTaskCard(s1Card({ riskHotspot: 'S1 / editor-store' }), 'card.md')).toThrow(
      /未知热点标签/,
    )
    expect(() => parseTaskCard(s1Card({ riskHotspot: 'S1 /' }), 'card.md')).toThrow(
      /Hotspot 不能为空/,
    )
    expect(() =>
      parseTaskCard(s1Card({ riskHotspot: 'S1 / none, main-preload' }), 'card.md'),
    ).toThrow(/none 时不得再列其他标签/)
    expect(hotspotTags).toContain('none')
  })

  it('rejects risk values outside S1/S2', () => {
    expect(() => parseTaskCard(s1Card({ riskHotspot: 'S0 / none' }), 'card.md')).toThrow(
      /风险级别无效/,
    )
  })
})

describe('lean task board aggregation', () => {
  it('returns an empty board when the tasks directory is missing', async () => {
    const root = await createProjectRoot()
    const board = await generateTaskBoard(root)
    expect(board).toContain('Tasks: 0')
    expect(board).toContain('# Active Task Board')
  })

  it('rejects duplicate task ids across files', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', s1Card())
    await writeCard(root, 'repair/b.md', s1Card())
    await expect(readTaskCards(root)).rejects.toThrow(/重复任务 ID/)
  })

  it('rejects two active cards sharing one hotspot tag', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', s2Card('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', s2Card('repair-b', 'active / worker-b', 'main-preload'))
    await expect(readTaskCards(root)).rejects.toThrow(/热点并发冲突/)
  })

  it('allows the same hotspot on queued cards and none on active cards', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', s2Card('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', s2Card('repair-b', 'queued /', 'main-preload'))
    const records = await readTaskCards(root)
    expect(records).toHaveLength(2)
    expect(records[0].status).toBe('queued')
    expect(records[1].status).toBe('active')
  })

  it('renders status counts and one row per card', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', s2Card('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', s2Card('repair-b', 'queued /', 'contracts-schema'))
    const board = renderTaskBoard(await readTaskCards(root))
    expect(board).toContain('Tasks: 2 · queued: 1 · active: 1')
    expect(board).toContain('| [repair-a](tasks/repair/a.md) | active | worker-a | S2 | main-preload |')
    expect(board).toContain('| [repair-b](tasks/repair/b.md) | queued | — | S2 | contracts-schema |')
  })

  it('check mode detects a stale committed board', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', s2Card('repair-a', 'queued /', 'main-preload'))
    await writeTaskBoard(root)
    await expect(checkTaskBoard(root)).resolves.toBeUndefined()
    await writeCard(root, 'repair/b.md', s1Card())
    await expect(checkTaskBoard(root)).rejects.toThrow(/任务板已过期/)
  })
})
