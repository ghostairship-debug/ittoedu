import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkTaskBoard,
  generateTaskBoard,
  parseTaskCard,
  readTaskCards,
  renderTaskBoard,
  taskStatuses,
  writeLockTags,
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

function taskCard(overrides: Partial<Record<string, string>> = {}): string {
  const fields = {
    statusOwner: 'queued /',
    outcome: '修复一个可观察的用户行为；当前有稳定复现',
    writeScope: 'src/renderer/ui/SomeTab.tsx',
    writeLocks: 'none',
    acceptance: '行为 X 在真实浏览器中可观察',
    validation: 'npm run test -- --run tests/unit/someTab.test.tsx',
    ...overrides,
  }
  return [
    '# repair-demo-01 演示任务',
    '',
    `- Status / Owner: ${fields.statusOwner}`,
    `- Outcome / Evidence: ${fields.outcome}`,
    `- Write scope: ${fields.writeScope}`,
    `- Write locks: ${fields.writeLocks}`,
    `- Acceptance: ${fields.acceptance}`,
    `- Validation: ${fields.validation}`,
    '',
  ].join('\n')
}

function lockedCard(id: string, statusOwner: string, writeLocks: string): string {
  return taskCard({
    statusOwner,
    outcome: `修复 ${id} 对应的已复现行为`,
    writeScope: 'src/main/**; baseline a7d11e9',
    writeLocks,
    acceptance: '目标行为可观察且失败路径可回退',
    validation: 'npm run test -- --run tests/unit/mainSecurity.test.ts',
  }).replace('# repair-demo-01 演示任务', `# ${id} 协调任务`)
}

describe('task card parsing', () => {
  it('parses a minimal queued card without a risk classification', () => {
    const record = parseTaskCard(taskCard(), 'docs/development-plan/tasks/repair/repair-demo-01.md')
    expect(record.id).toBe('repair-demo-01')
    expect(record.status).toBe('queued')
    expect(record.owner).toBe('')
    expect(record.writeLocks).toEqual(['none'])
  })

  it('parses an active card with multiple write locks and one owner', () => {
    const record = parseTaskCard(
      lockedCard('repair-sec-01', 'active / integrator', 'main-preload, contracts-schema'),
      'docs/development-plan/tasks/repair/repair-sec-01.md',
    )
    expect(record.status).toBe('active')
    expect(record.owner).toBe('integrator')
    expect(record.writeLocks).toEqual(['main-preload', 'contracts-schema'])
  })

  it('rejects legacy or unknown statuses', () => {
    for (const status of ['ready', 'claimed', 'done', 'implementing']) {
      expect(() =>
        parseTaskCard(taskCard({ statusOwner: `${status} / someone` }), 'card.md'),
      ).toThrow(/任务状态无效/)
    }
    expect(taskStatuses).toEqual(['queued', 'active', 'blocked'])
  })

  it('requires an owner for active cards', () => {
    expect(() => parseTaskCard(taskCard({ statusOwner: 'active /' }), 'card.md')).toThrow(
      /active 任务必须有唯一 Owner/,
    )
  })

  it('requires outcome, scope, acceptance, and validation', () => {
    expect(() => parseTaskCard(taskCard({ outcome: '' }), 'card.md')).toThrow(/Outcome \/ Evidence/)
    expect(() => parseTaskCard(taskCard({ writeScope: '' }), 'card.md')).toThrow(/Write scope/)
    expect(() => parseTaskCard(taskCard({ acceptance: '' }), 'card.md')).toThrow(/Acceptance/)
    expect(() => parseTaskCard(taskCard({ validation: '' }), 'card.md')).toThrow(/Validation/)
  })

  it('rejects unknown, empty, or mixed-none write locks', () => {
    expect(() => parseTaskCard(taskCard({ writeLocks: 'editor-store' }), 'card.md')).toThrow(
      /未知写锁标签/,
    )
    expect(() => parseTaskCard(taskCard({ writeLocks: '' }), 'card.md')).toThrow(
      /Write locks/,
    )
    expect(() =>
      parseTaskCard(taskCard({ writeLocks: 'none, main-preload' }), 'card.md'),
    ).toThrow(/none 时不得再列其他标签/)
    expect(writeLockTags).toContain('none')
    expect(writeLockTags).toContain('legacy-inventory')
  })
})

describe('task board aggregation', () => {
  it('returns an empty board when the tasks directory is missing', async () => {
    const root = await createProjectRoot()
    const board = await generateTaskBoard(root)
    expect(board).toContain('Tasks: 0')
    expect(board).toContain('# Active Task Board')
  })

  it('rejects duplicate task ids across files', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', taskCard())
    await writeCard(root, 'repair/b.md', taskCard())
    await expect(readTaskCards(root)).rejects.toThrow(/重复任务 ID/)
  })

  it('rejects two active cards sharing one write lock', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', lockedCard('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', lockedCard('repair-b', 'active / worker-b', 'main-preload'))
    await expect(readTaskCards(root)).rejects.toThrow(/写锁并发冲突/)
  })

  it('allows the same lock on queued cards and none on active cards', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', lockedCard('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', lockedCard('repair-b', 'queued /', 'main-preload'))
    const records = await readTaskCards(root)
    expect(records).toHaveLength(2)
    expect(records[0].status).toBe('queued')
    expect(records[1].status).toBe('active')
  })

  it('renders status counts and one row per card', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', lockedCard('repair-a', 'active / worker-a', 'main-preload'))
    await writeCard(root, 'repair/b.md', lockedCard('repair-b', 'queued /', 'contracts-schema'))
    const board = renderTaskBoard(await readTaskCards(root))
    expect(board).toContain('Tasks: 2 · queued: 1 · active: 1')
    expect(board).toContain('| [repair-a](tasks/repair/a.md) | active | worker-a | main-preload |')
    expect(board).toContain('| [repair-b](tasks/repair/b.md) | queued | — | contracts-schema |')
  })

  it('check mode detects a stale committed board', async () => {
    const root = await createProjectRoot()
    await writeCard(root, 'repair/a.md', lockedCard('repair-a', 'queued /', 'main-preload'))
    await writeTaskBoard(root)
    await expect(checkTaskBoard(root)).resolves.toBeUndefined()
    await writeCard(root, 'repair/b.md', taskCard())
    await expect(checkTaskBoard(root)).rejects.toThrow(/任务板已过期/)
  })
})
