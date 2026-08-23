import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

export const taskStatuses = [
  'draft',
  'ready',
  'claimed',
  'characterizing',
  'implementing',
  'target-green',
  'reviewed',
  'integrating',
  'wave-validated',
  'done',
  'retrying',
  'parked',
  'rolled-back',
  'product-decision',
] as const

export type TaskStatus = (typeof taskStatuses)[number]

const taskStatusSet = new Set<string>(taskStatuses)

export interface TaskBoardRecord {
  id: string
  phase: string
  status: TaskStatus
  owner: string
  dependsOn: string
  blocks: string
  outcome: string
  cardPath: string
}

function stripInlineMarkdown(value: string): string {
  return value
    .trim()
    .replaceAll('`', '')
    .replace(/\s+/g, ' ')
}

function readBulletField(markdown: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`^- ${escapedLabel}:\\s*(.+?)\\s*$`, 'm'))
  if (!match?.[1]) throw new Error(`任务卡缺少字段 “${label}”`)
  return stripInlineMarkdown(match[1])
}

function readOutcome(markdown: string): string {
  const heading = '## Product outcome'
  const start = markdown.indexOf(heading)
  if (start < 0) throw new Error(`任务卡缺少 “${heading}”`)
  const bodyStart = start + heading.length
  const remaining = markdown.slice(bodyStart)
  const nextHeading = remaining.search(/^##\s+/m)
  const section = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining
  const paragraphs = section
    .split(/\r?\n\s*\r?\n/)
    .map(stripInlineMarkdown)
    .filter(Boolean)
  if (!paragraphs[0]) throw new Error('任务卡 Product outcome 为空')
  return paragraphs[0]
}

export function parseTaskCard(
  markdown: string,
  cardPath: string,
): TaskBoardRecord {
  const normalizedCardPath = cardPath.replaceAll('\\', '/')
  const id = readBulletField(markdown, 'Task ID')
  const fileName = path.posix.basename(normalizedCardPath, '.md')
  if (id !== fileName) {
    throw new Error(`任务 ID 与文件名不一致：${id} != ${fileName}`)
  }
  const status = readBulletField(markdown, 'Status')
  if (!taskStatusSet.has(status)) {
    throw new Error(`任务 ${id} 使用未知状态：${status}`)
  }
  return {
    id,
    phase: readBulletField(markdown, 'Phase / wave'),
    status: status as TaskStatus,
    owner: readBulletField(markdown, 'Owner / Reviewer / Integrator'),
    dependsOn: readBulletField(markdown, 'Depends on'),
    blocks: readBulletField(markdown, 'Blocks'),
    outcome: readOutcome(markdown),
    cardPath: normalizedCardPath,
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
  return records.sort((left, right) => {
    const phase = left.phase.localeCompare(right.phase, 'en', { numeric: true })
    return phase === 0 ? left.id.localeCompare(right.id, 'en') : phase
  })
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
    return `| ${link} | ${escapeTableCell(record.phase)} | ${record.status} | ${escapeTableCell(record.owner)} | ${escapeTableCell(record.dependsOn)} | ${escapeTableCell(record.blocks)} | ${escapeTableCell(record.outcome)} |`
  })
  return [
    '# Architecture Stabilization Task Board',
    '',
    '> Generated by `npm run generate:task-board`. Do not edit this file; task cards are the only writable task-state truth.',
    '',
    `Tasks: ${records.length}${nonZeroCounts ? ` · ${nonZeroCounts}` : ''}`,
    '',
    '| Task | Phase / wave | Status | Owner / reviewer / integrator | Depends on | Blocks | Product outcome |',
    '|---|---|---|---|---|---|---|',
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
    console.log('架构任务板已是最新状态。')
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
