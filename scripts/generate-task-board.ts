import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

export const taskStatuses = ['queued', 'active', 'blocked'] as const

export type TaskStatus = (typeof taskStatuses)[number]

const taskStatusSet = new Set<string>(taskStatuses)

export const writeLockTags = [
  'none',
  'editor-store-history',
  'app-save-recovery',
  'workspace-properties',
  'published-producer',
  'contracts-schema',
  'legacy-inventory',
  'main-preload',
  'generated-index',
] as const

export type WriteLockTag = (typeof writeLockTags)[number]

const writeLockTagSet = new Set<string>(writeLockTags)

export interface TaskBoardRecord {
  id: string
  title: string
  cardPath: string
  status: TaskStatus
  owner: string
  writeLocks: WriteLockTag[]
  outcome: string
  writeScope: string
  acceptance: string
  validation: string
}

function readBulletField(markdown: string, label: string): string {
  const pattern = new RegExp(`^-[ \\t]*${label.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}[ \\t]*:[ \\t]*(.*)$`, 'mu')
  const match = markdown.match(pattern)
  return match ? match[1].trim() : ''
}

export function parseTaskCard(markdown: string, cardPath: string): TaskBoardRecord {
  const heading = markdown.match(/^#\s+(\S+)\s*(.*)$/mu)
  if (!heading) throw new Error(`任务卡缺少一级标题（# <task-id> <标题>）：${cardPath}`)
  const id = heading[1].trim()
  const title = heading[2].trim()

  const statusOwner = readBulletField(markdown, 'Status / Owner')
  if (!statusOwner) throw new Error(`任务卡缺少字段 “Status / Owner”：${cardPath}`)
  const statusOwnerSplit = statusOwner.split('/')
  const status = statusOwnerSplit[0]?.trim() ?? ''
  const owner = statusOwnerSplit.slice(1).join('/').trim()
  if (!taskStatusSet.has(status)) {
    throw new Error(`任务状态无效（只允许 queued | active | blocked）：${status || '<空>'}（${cardPath}）`)
  }
  if (status === 'active' && !owner) {
    throw new Error(`active 任务必须有唯一 Owner：${cardPath}`)
  }

  const writeLockText = readBulletField(markdown, 'Write locks')
  if (!writeLockText) throw new Error(`任务卡缺少字段 “Write locks”：${cardPath}`)
  const writeLocks = writeLockText
    ? writeLockText.split(',').map((tag) => tag.trim()).filter(Boolean)
    : []
  if (writeLocks.length === 0) {
    throw new Error(`Write locks 不能为空；无共享写锁时写 none：${cardPath}`)
  }
  for (const tag of writeLocks) {
    if (!writeLockTagSet.has(tag)) {
      throw new Error(`未知写锁标签：${tag}（${cardPath}；允许值：${writeLockTags.join(' | ')}）`)
    }
  }
  if (writeLocks.includes('none') && writeLocks.length > 1) {
    throw new Error(`Write locks 为 none 时不得再列其他标签：${cardPath}`)
  }

  const outcome = readBulletField(markdown, 'Outcome / Evidence')
  if (!outcome) throw new Error(`任务卡缺少字段 “Outcome / Evidence”：${cardPath}`)
  const writeScope = readBulletField(markdown, 'Write scope')
  if (!writeScope) throw new Error(`任务卡缺少字段 “Write scope”：${cardPath}`)
  const acceptance = readBulletField(markdown, 'Acceptance')
  if (!acceptance) throw new Error(`任务卡缺少字段 “Acceptance”：${cardPath}`)
  const validation = readBulletField(markdown, 'Validation')
  if (!validation) throw new Error(`任务卡缺少字段 “Validation”：${cardPath}`)

  return {
    id,
    title,
    cardPath,
    status: status as TaskStatus,
    owner,
    writeLocks: writeLocks as WriteLockTag[],
    outcome,
    writeScope,
    acceptance,
    validation,
  }
}

async function listTaskCardPaths(tasksRoot: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile() && entry.name.endsWith('.md')) output.push(absolutePath)
    }
  }
  await visit(tasksRoot)
  return output.sort((left, right) =>
    left.replaceAll('\\', '/').localeCompare(right.replaceAll('\\', '/'), 'en'),
  )
}

export async function readTaskCards(projectRoot: string): Promise<TaskBoardRecord[]> {
  const tasksRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks')
  const records: TaskBoardRecord[] = []
  const ids = new Set<string>()
  for (const absolutePath of await listTaskCardPaths(tasksRoot)) {
    const relativePath = path.relative(projectRoot, absolutePath).replaceAll('\\', '/')
    const markdown = await fs.readFile(absolutePath, 'utf8')
    const record = parseTaskCard(markdown, relativePath)
    if (ids.has(record.id)) throw new Error(`重复任务 ID：${record.id}`)
    ids.add(record.id)
    records.push(record)
  }

  const activeLockOwners = new Map<string, string>()
  for (const record of records) {
    if (record.status !== 'active') continue
    for (const tag of record.writeLocks) {
      if (tag === 'none') continue
      const existing = activeLockOwners.get(tag)
      if (existing) {
        throw new Error(`写锁并发冲突：${tag} 同时出现在 active 任务 ${existing} 与 ${record.id} 上`)
      }
      activeLockOwners.set(tag, record.id)
    }
  }

  return records.sort(
    (left, right) =>
      taskStatuses.indexOf(left.status) - taskStatuses.indexOf(right.status) ||
      left.id.localeCompare(right.id, 'en'),
  )
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ')
}

export function renderTaskBoard(records: readonly TaskBoardRecord[]): string {
  const counts = new Map<TaskStatus, number>(taskStatuses.map((status) => [status, 0]))
  for (const record of records) counts.set(record.status, (counts.get(record.status) ?? 0) + 1)
  const nonZeroCounts = taskStatuses
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${status}: ${counts.get(status)}`)
    .join(' · ')
  const rows = records.map((record) => {
    const link = `[${escapeTableCell(record.id)}](${record.cardPath.replace('docs/development-plan/', '')})`
    return `| ${link} | ${record.status} | ${escapeTableCell(record.owner || '—')} | ${escapeTableCell(record.writeLocks.join(', '))} | ${escapeTableCell(record.outcome)} |`
  })
  return [
    '# Active Task Board',
    '',
    '> Generated by `npm run generate:task-board`. 当前协调任务摘要（queued/active/blocked）；完成后删除卡，完成事实由实质 diff / commit 与检查结果承载。本文件不可手改。',
    '',
    `Tasks: ${records.length}${nonZeroCounts ? ` · ${nonZeroCounts}` : ''}`,
    '',
    '| Task | Status | Owner | Write locks | Outcome |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

export async function generateTaskBoard(projectRoot: string): Promise<string> {
  return renderTaskBoard(await readTaskCards(projectRoot))
}

export async function writeTaskBoard(projectRoot: string): Promise<void> {
  const outputPath = path.join(projectRoot, 'docs', 'development-plan', 'TASK_BOARD.md')
  const content = await generateTaskBoard(projectRoot)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, content, 'utf8')
}

export async function checkTaskBoard(projectRoot: string): Promise<void> {
  const outputPath = path.join(projectRoot, 'docs', 'development-plan', 'TASK_BOARD.md')
  const expected = await generateTaskBoard(projectRoot)
  let actual: string
  try {
    actual = await fs.readFile(outputPath, 'utf8')
  } catch {
    throw new Error('任务板缺失；请运行 npm run generate:task-board。')
  }
  if (actual !== expected) {
    throw new Error('任务板已过期；请运行 npm run generate:task-board。')
  }
}

interface CliOptions {
  check: boolean
  projectRoot: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let check = false
  let projectRoot = defaultProjectRoot
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--project-root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--project-root 缺少路径参数。')
      projectRoot = path.resolve(value)
      index += 1
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return { check, projectRoot }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  if (options.check) {
    await checkTaskBoard(options.projectRoot)
    console.log('任务板已是最新状态。')
    return
  }
  await writeTaskBoard(options.projectRoot)
  console.log('已从任务卡生成 docs/development-plan/TASK_BOARD.md。')
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
