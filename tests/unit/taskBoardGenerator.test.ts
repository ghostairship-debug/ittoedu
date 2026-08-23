import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkTaskBoard,
  generateTaskBoard,
  parseTaskCard,
  writeTaskBoard,
} from '../../scripts/generate-task-board'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })),
  )
})

function card(id: string, status = 'ready'): string {
  return `# S1 Task Card

## State and assignment

- Task ID: \`${id}\`
- Phase / wave: \`ARCH-0A / wave 1\`
- Status: \`${status}\`
- Owner / Reviewer / Integrator: \`Worker / Reviewer / Coordinator\`
- Depends on: \`none\`
- Blocks: \`next-task\`

## Product outcome

One observable outcome for ${id}.

## Current fact and evidence

Evidence.
`
}

async function createTaskRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ittoedu-task-board-'))
  temporaryRoots.push(projectRoot)
  await fs.mkdir(path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a'), {
    recursive: true,
  })
  return projectRoot
}

describe('task board generator', () => {
  it('parses the stable task fields and rejects file/id mismatches', () => {
    const parsed = parseTaskCard(
      card('arch-0a-sample'),
      'docs/development-plan/tasks/arch-0a/arch-0a-sample.md',
    )
    expect(parsed).toMatchObject({
      id: 'arch-0a-sample',
      status: 'ready',
      phase: 'ARCH-0A / wave 1',
      outcome: 'One observable outcome for arch-0a-sample.',
    })
    expect(() =>
      parseTaskCard(card('wrong-id'), 'docs/development-plan/tasks/arch-0a/right-id.md'),
    ).toThrow(/文件名不一致/)
  })

  it('renders cards deterministically and detects a stale generated board', async () => {
    const projectRoot = await createTaskRoot()
    const tasksRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a')
    await fs.writeFile(path.join(tasksRoot, 'task-b.md'), card('task-b', 'claimed'), 'utf8')
    await fs.writeFile(path.join(tasksRoot, 'task-a.md'), card('task-a', 'done'), 'utf8')

    const first = await generateTaskBoard(projectRoot)
    const second = await generateTaskBoard(projectRoot)
    expect(first).toBe(second)
    expect(first.indexOf('[task-a]')).toBeLessThan(first.indexOf('[task-b]'))
    expect(first).not.toMatch(/20\d\d-|[A-Z]:\\/)

    await writeTaskBoard(projectRoot)
    await expect(checkTaskBoard(projectRoot)).resolves.toBeUndefined()
    await fs.writeFile(path.join(tasksRoot, 'task-b.md'), card('task-b', 'target-green'), 'utf8')
    await expect(checkTaskBoard(projectRoot)).rejects.toThrow(/已过期/)
  })

  it('rejects unknown statuses and duplicate IDs', async () => {
    expect(() =>
      parseTaskCard(
        card('bad-status', 'almost-done'),
        'docs/development-plan/tasks/arch-0a/bad-status.md',
      ),
    ).toThrow(/未知状态/)

    const projectRoot = await createTaskRoot()
    const firstRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a')
    const secondRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0b')
    await fs.mkdir(secondRoot, { recursive: true })
    await fs.writeFile(path.join(firstRoot, 'same.md'), card('same'), 'utf8')
    await fs.writeFile(path.join(secondRoot, 'same.md'), card('same'), 'utf8')
    await expect(generateTaskBoard(projectRoot)).rejects.toThrow(/重复任务 ID/)
  })
})
