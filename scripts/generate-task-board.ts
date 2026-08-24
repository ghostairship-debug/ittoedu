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

const legacyCompatibleStatuses = new Set<TaskStatus>([
  'done',
  'wave-validated',
  'parked',
  'rolled-back',
])

const policy2RiskTiers = ['S0', 'S1', 'S2'] as const
type Policy2RiskTier = (typeof policy2RiskTiers)[number]

const policy2TaskClasses = [
  'docs',
  'implementation',
  'integration',
  'wave-gate',
  'phase-gate',
  'final-candidate',
] as const
type Policy2TaskClass = (typeof policy2TaskClasses)[number]

const policy2ValidationCeilingByClass: Record<Policy2TaskClass, string> = {
  docs: 'V0',
  implementation: 'V1',
  integration: 'V2',
  'wave-gate': 'V2',
  'phase-gate': 'V3',
  'final-candidate': 'V4',
}

const validationLimitedTaskClasses = new Set<Policy2TaskClass>([
  'docs',
  'implementation',
  'integration',
  'wave-gate',
])

const forbiddenLimitedValidationPatterns = [
  {
    label: 'unfiltered npm test',
    pattern: /\bnpm\s+(?:run\s+)?test(?=\s|$|\x60)/im,
  },
  {
    label: 'full npm run test:product',
    pattern: /\bnpm\s+run\s+test:product(?=\s|$|\x60)/im,
  },
  {
    label: 'full npm run test:e2e',
    pattern: /\bnpm\s+run\s+test:e2e(?=\s|$|:|\x60)/im,
  },
  {
    label: 'npm run verify',
    pattern: /\bnpm\s+run\s+verify(?=\s|$|:|\x60)/im,
  },
  {
    label: 'npm run build:desktop',
    pattern: /\bnpm\s+run\s+build:desktop(?=\s|$|\x60)/im,
  },
  {
    label: 'full architecture performance measurement',
    pattern:
      /measure-architecture-baseline|(?:full|complete)\s+(?:architecture\s+)?performance|完整(?:架构)?性能/i,
  },
  {
    label: 'npm run repo:index:quality',
    pattern: /\bnpm\s+run\s+repo:index:quality(?=\s|$|\x60)/im,
  },
] as const

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

function readOptionalBulletField(markdown: string, label: string): string | undefined {
  try {
    return readBulletField(markdown, label)
  } catch (error) {
    if (error instanceof Error && error.message === '任务卡缺少字段 “' + label + '”') {
      return undefined
    }
    throw error
  }
}

function readPolicy2Enum<T extends string>(
  markdown: string,
  taskId: string,
  label: string,
  values: readonly T[],
): T {
  const value = readBulletField(markdown, label)
  if (!values.includes(value as T)) {
    throw new Error('任务 ' + taskId + ' 的 ' + label + ' 无效：' + value)
  }
  return value as T
}

function readPolicy2Constraint(markdown: string, taskId: string, label: string): string {
  const value = readBulletField(markdown, label)
  if (/^(?:tbd|none|n\/?a|[-—–]|待定|无)$/i.test(value)) {
    throw new Error('任务 ' + taskId + ' 的 ' + label + ' 不得使用空占位：' + value)
  }
  return value
}

function readValidationSections(markdown: string): string {
  const sections: string[] = []
  const headingPattern = /^##\s+(?:Minimal validation|Validation|Validation plan)\s*$/gim
  let match: RegExpExecArray | null
  while ((match = headingPattern.exec(markdown)) !== null) {
    const remaining = markdown.slice(headingPattern.lastIndex)
    const nextHeading = remaining.search(/^##\s+/m)
    sections.push(nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining)
  }
  return sections.join('\n')
}

const supportedValidationHeadingPattern = /^(?:Minimal validation|Validation|Validation plan)$/i
const resultEvidenceHeadingPattern = /^(?:Result evidence|Result and rollback)$/i
const commandStyleValidationPattern = /^(?:npx\s+(?:vitest|playwright)(?=\s|$)|vitest\s+(?:run|related|watch|dev|bench)(?=\s|$)|playwright\s+test(?=\s|$)|npm\s+(?:test(?=\s|$)|run\s+(?:test(?::[\w-]+)*|verify(?::[\w-]+)*|build:desktop|repo:index:quality)(?=\s|$)))/i

function normalizeCommandStyleLine(line: string): string {
  return line
    .trim()
    .replace(/^>\s*/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^`{1,3}\s*/, '')
    .replace(/\s*`{1,3}$/, '')
    .replace(/^(?:command|命令)\s*:\s*/i, '')
    .trimStart()
}

function validateValidationCommandPlacement(markdown: string, taskId: string): void {
  let currentHeading = ''
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1]
    if (heading) {
      if (resultEvidenceHeadingPattern.test(heading)) return
      currentHeading = heading
      continue
    }
    if (supportedValidationHeadingPattern.test(currentHeading)) continue
    if (commandStyleValidationPattern.test(normalizeCommandStyleLine(line))) {
      throw new Error(
        '任务 ' +
          taskId +
          ' 的验证命令只能写在 Minimal validation、Validation 或 Validation plan 段',
      )
    }
  }
}

const directProductTestRunnerPattern = /\b(?:npx\s+)?(?:vitest|playwright)\b/i
const explicitTestFilePattern = /(?:^|[\\/])[^*?\[\]{}]+\.(?:test|spec)\.[cm]?[jt]sx?$/i
const testTargetGlobPattern = /[*?\[\]{}]/

function readTargetedTestCommandArguments(command: RegExpMatchArray): string[] {
  const commandArguments = (command[1] ?? '').split(/\x60|&&|\|\||[;|]/, 1)[0] ?? ''
  return commandArguments
    .replace(/['"(),]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function isExplicitTestFileTarget(argument: string, index: number, arguments_: string[]): boolean {
  if (argument.startsWith('-') || !explicitTestFilePattern.test(argument)) return false
  const previous = arguments_[index - 1]
  const previousConsumesValue =
    previous !== undefined &&
    previous !== '--' &&
    previous.startsWith('-') &&
    !previous.includes('=')
  return !previousConsumesValue
}

function hasBroadImplementationInvalidatingPath(value: string): boolean {
  return value
    .split(/[;,|]/)
    .map((entry) => entry.trim().toLowerCase().replaceAll('\\', '/'))
    .filter(Boolean)
    .some(
      (entry) =>
        /^(?:all\b|repo(?:sitory)?-wide\b|entire\s+(?:repo|repository)\b|全仓|全库)/i.test(
          entry,
        ) ||
        /[*?\[\]{}]/.test(entry) ||
        /^(?:src|tests)(?:$|\/\*)/.test(entry),
    )
}

function reviewerBudgetLimit(riskTier: Policy2RiskTier, taskClass: Policy2TaskClass): number {
  if (taskClass === 'docs') return 1
  if (taskClass === 'wave-gate' || taskClass === 'phase-gate' || taskClass === 'final-candidate') {
    return 2
  }
  if (taskClass === 'implementation' && riskTier === 'S0') return 0
  return 1
}

function validatePolicy2TaskCard(
  markdown: string,
  taskId: string,
  phase: string,
  status: TaskStatus,
): void {
  const policyVersion = readOptionalBulletField(markdown, 'Policy version')
  if (!policyVersion) {
    if (legacyCompatibleStatuses.has(status)) return
    throw new Error('任务 ' + taskId + ' 缺少必需的 Policy version 2 字段')
  }
  if (policyVersion !== '2') {
    throw new Error('任务 ' + taskId + ' 使用不支持的 Policy version：' + policyVersion)
  }

  const riskTier = readPolicy2Enum(markdown, taskId, 'Risk tier', policy2RiskTiers)
  const taskClass = readPolicy2Enum(markdown, taskId, 'Task class', policy2TaskClasses)
  readPolicy2Constraint(markdown, taskId, 'Necessity / skip condition')
  const complexityDelta = readPolicy2Enum(markdown, taskId, 'Complexity delta', [
    'subtractive',
    'neutral',
    'additive-exception',
  ] as const)
  if (complexityDelta === 'additive-exception') {
    readPolicy2Constraint(markdown, taskId, 'Additive exception')
  } else if (readOptionalBulletField(markdown, 'Additive exception') !== undefined) {
    throw new Error(
      '任务 ' + taskId + ' 只有 additive-exception 才能声明 Additive exception',
    )
  }

  const validationCeiling = readBulletField(markdown, 'Validation ceiling')
  const expectedCeiling = policy2ValidationCeilingByClass[taskClass]
  if (validationCeiling !== expectedCeiling) {
    throw new Error(
      '任务 ' +
        taskId +
        ' 的 ' +
        taskClass +
        ' 类别必须使用 Validation ceiling ' +
        expectedCeiling +
        '，实际为 ' +
        validationCeiling,
    )
  }

  const validationBudget = readBulletField(markdown, 'Validation budget')
  if (!/^[1-9]\d*\s*(?:minutes?|mins?|分钟)$/i.test(validationBudget)) {
    throw new Error('任务 ' + taskId + ' 的 Validation budget 必须是正整数分钟')
  }

  const reviewerBudget = readBulletField(markdown, 'Reviewer budget')
  if (!/^(?:0|[1-9]\d*)$/.test(reviewerBudget)) {
    throw new Error('任务 ' + taskId + ' 的 Reviewer budget 必须是非负整数')
  }
  const reviewerLimit = reviewerBudgetLimit(riskTier, taskClass)
  if (Number(reviewerBudget) > reviewerLimit) {
    throw new Error(
      '任务 ' +
        taskId +
        ' 的 Reviewer budget 超过 ' +
        riskTier +
        ' ' +
        taskClass +
        ' 上限 ' +
        reviewerLimit,
    )
  }

  readPolicy2Constraint(markdown, taskId, 'Evidence reuse')
  const invalidatingPaths = readPolicy2Constraint(markdown, taskId, 'Invalidating paths')
  if (taskClass === 'implementation' && hasBroadImplementationInvalidatingPath(invalidatingPaths)) {
    throw new Error(
      '任务 ' + taskId + ' 的 implementation Invalidating paths 必须使用最窄可解释路径',
    )
  }

  if (taskClass === 'final-candidate' && !/\bARCH-5\b/i.test(phase)) {
    throw new Error('任务 ' + taskId + ' 只能在 ARCH-5 使用 final-candidate')
  }

  const validationSections = readValidationSections(markdown)
  if (!validationSections.trim()) {
    throw new Error(
      '任务 ' + taskId + ' 必须包含非空的 Minimal validation、Validation 或 Validation plan 段',
    )
  }
  validateValidationCommandPlacement(markdown, taskId)
  if (validationLimitedTaskClasses.has(taskClass)) {
    for (const forbidden of forbiddenLimitedValidationPatterns) {
      if (forbidden.pattern.test(validationSections)) {
        throw new Error(
          '任务 ' +
            taskId +
            ' 的 ' +
            taskClass +
            ' 验证超过 ' +
            expectedCeiling +
            '：' +
            forbidden.label,
        )
      }
    }
    if (taskClass === 'docs' && directProductTestRunnerPattern.test(validationSections)) {
      throw new Error('任务 ' + taskId + ' 的 docs/V0 验证不得运行 Vitest 或 Playwright')
    }
    const targetedTestCommands = Array.from(
      validationSections.matchAll(
        /\b(?:npx\s+)?(?:vitest\s+run|playwright\s+test)\b([^\r\n]*)/gi,
      ),
    )
    const explicitTestTargets = new Set<string>()
    for (const command of targetedTestCommands) {
      const argumentsAfterCommand = readTargetedTestCommandArguments(command)
      const hasGlobTarget = argumentsAfterCommand.some(
        (argument) =>
          testTargetGlobPattern.test(argument) &&
          (/[\\/]/.test(argument) || /\.(?:test|spec)\./i.test(argument)),
      )
      const commandTargets = argumentsAfterCommand.filter((argument, index, arguments_) =>
        isExplicitTestFileTarget(argument, index, arguments_),
      )
      if (hasGlobTarget || commandTargets.length === 0) {
        throw new Error(
          '任务 ' +
            taskId +
            ' 的 ' +
            taskClass +
            ' 目标测试命令必须包含无 glob 的明确 .test/.spec 文件',
        )
      }
      for (const target of commandTargets) {
        explicitTestTargets.add(target.replaceAll('\\', '/').toLowerCase())
      }
    }
    if (taskClass === 'implementation' && explicitTestTargets.size > 3) {
      throw new Error('任务 ' + taskId + ' 的 implementation 不得超过 3 个明确 test target 文件')
    }
  }
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
  const phase = readBulletField(markdown, 'Phase / wave')
  validatePolicy2TaskCard(markdown, id, phase, status as TaskStatus)
  return {
    id,
    phase,
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
