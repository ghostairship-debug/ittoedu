import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

export const PRESERVATION_PM_IDS = Array.from({ length: 28 }, (_, index) =>
  `PM-${String(index + 1).padStart(2, '0')}`,
) as readonly string[]

export const PRESERVATION_FAILURE_CATEGORIES = [
  'missing-pm',
  'duplicate-pm',
  'malformed-map',
  'stale-candidate',
  'related-dirty',
  'underlying-failure',
] as const

export type PreservationFailureCategory = (typeof PRESERVATION_FAILURE_CATEGORIES)[number]

const MAP_ROOT_KEYS = ['schemaVersion', 'release', 'fixtures', 'rows'] as const
const FIXTURE_KEYS = ['id', 'path', 'identity', 'generateCommand', 'checkCommand'] as const
const ROW_SHARED_KEYS = ['id', 'type', 'fixtureIds', 'inputClosure', 'invalidation'] as const
const AUTOMATED_ROW_KEYS = [...ROW_SHARED_KEYS, 'evidenceCommand'] as const
const OWNER_ROW_KEYS = [...ROW_SHARED_KEYS, 'observer'] as const
const EVIDENCE_DEFINITION_PATHS = [
  'package.json',
  'scripts/check-preservation.ts',
  'tests/unit/preservationChecker.test.ts',
  'docs/development-plan/baselines/V1_1_PRESERVATION_BASELINE.md',
  'docs/development-plan/roadmap/PRESERVATION_MATRIX.md',
] as const

export class PreservationCheckError extends Error {
  readonly category: PreservationFailureCategory

  constructor(category: PreservationFailureCategory, message: string) {
    super(message)
    this.name = 'PreservationCheckError'
    this.category = category
  }
}

export interface PreservationCheckHooks {
  readHead?: () => string
  listDirtyFiles?: () => string[]
  runCommand?: (command: string, cwd: string) => { status: number; stdout: string; stderr: string }
}

export interface PreservationCheckOptions {
  projectRoot?: string
  mapPath?: string
  reportPath?: string
  executeAutomated?: boolean
  expectedCandidate?: string
  previousReportPath?: string
  requireClean?: boolean
  hooks?: PreservationCheckHooks
}

export interface PreservationRowResult {
  id: string
  type: 'automated' | 'owner-observation'
  status: 'pass' | 'fail' | 'owner-observation-required'
  fixtureIds: string[]
  evidence: string
}

export interface PreservationCheckResult {
  candidate: string
  closureDigest: string
  release: string
  rows: PreservationRowResult[]
  ownerObservationRequired: string[]
  dirtyFiles: string[]
  relatedDirtyFiles: string[]
  reusedFrom?: PreservationReuseProvenance
}

export interface PreservationReuseProvenance {
  reportPath: string
  candidate: string
  closureDigest: string
  candidateMatches: true
  closureMatches: true
}

interface PreservationFixture {
  id: string
  path: string
  identity: Record<string, unknown>
  generateCommand: string
  checkCommand: string
}

interface PreservationRow {
  id: string
  type: 'automated' | 'owner-observation'
  evidenceCommand?: string
  observer?: string
  fixtureIds: string[]
  inputClosure: string[]
  invalidation: string
}

interface PreservationMap {
  schemaVersion: number
  release: string
  fixtures: PreservationFixture[]
  rows: PreservationRow[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PreservationCheckError('malformed-map', `${label} 必须是非空字符串`)
  }
  return value
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new PreservationCheckError('malformed-map', `${label} 必须是非空字符串数组`)
  }
  return value
}

function posix(relative: string): string {
  return relative.replaceAll('\\', '/')
}

function parseFixture(value: unknown, index: number): PreservationFixture {
  if (!isPlainRecord(value)) {
    throw new PreservationCheckError('malformed-map', `fixtures[${index}] 必须是对象`)
  }
  const extra = unknownKeys(value, FIXTURE_KEYS)
  if (extra.length > 0) {
    throw new PreservationCheckError('malformed-map', `fixture 含未知字段：${extra.join(', ')}`)
  }
  if (!isPlainRecord(value.identity)) {
    throw new PreservationCheckError('malformed-map', `fixtures[${index}].identity 必须是对象`)
  }
  return {
    id: requireString(value.id, `fixtures[${index}].id`),
    path: requireString(value.path, `fixtures[${index}].path`),
    identity: value.identity,
    generateCommand: requireString(value.generateCommand, `fixtures[${index}].generateCommand`),
    checkCommand: requireString(value.checkCommand, `fixtures[${index}].checkCommand`),
  }
}

function parseRow(value: unknown, index: number): PreservationRow {
  if (!isPlainRecord(value)) {
    throw new PreservationCheckError('malformed-map', `rows[${index}] 必须是对象`)
  }
  const type = requireString(value.type, `rows[${index}].type`)
  if (type !== 'automated' && type !== 'owner-observation') {
    throw new PreservationCheckError('malformed-map', `rows[${index}].type 非法：${type}`)
  }
  const allowed = type === 'automated' ? AUTOMATED_ROW_KEYS : OWNER_ROW_KEYS
  const extra = unknownKeys(value, allowed)
  if (extra.length > 0) {
    throw new PreservationCheckError('malformed-map', `${value.id ?? `rows[${index}]`} 含未知字段：${extra.join(', ')}`)
  }
  const row: PreservationRow = {
    id: requireString(value.id, `rows[${index}].id`),
    type,
    fixtureIds: requireStringArray(value.fixtureIds, `rows[${index}].fixtureIds`),
    inputClosure: requireStringArray(value.inputClosure, `rows[${index}].inputClosure`),
    invalidation: requireString(value.invalidation, `rows[${index}].invalidation`),
  }
  if (type === 'automated') {
    row.evidenceCommand = requireString(value.evidenceCommand, `rows[${index}].evidenceCommand`)
    if (value.observer !== undefined) {
      throw new PreservationCheckError('malformed-map', `${row.id} automated 行不得含 observer`)
    }
  } else {
    row.observer = requireString(value.observer, `rows[${index}].observer`)
    if (value.evidenceCommand !== undefined) {
      throw new PreservationCheckError('malformed-map', `${row.id} owner-observation 行不得含 evidenceCommand`)
    }
  }
  return row
}

export function parsePreservationMap(raw: unknown): PreservationMap {
  if (!isPlainRecord(raw)) {
    throw new PreservationCheckError('malformed-map', '映射必须是 JSON 对象')
  }
  const extra = unknownKeys(raw, MAP_ROOT_KEYS)
  if (extra.length > 0) {
    throw new PreservationCheckError('malformed-map', `映射含未知字段：${extra.join(', ')}`)
  }
  if (raw.schemaVersion !== 1) {
    throw new PreservationCheckError('malformed-map', `schemaVersion 必须为 1`)
  }
  if (raw.release !== '1.1') {
    throw new PreservationCheckError('malformed-map', 'release 必须为 1.1')
  }
  if (!Array.isArray(raw.fixtures) || raw.fixtures.length === 0) {
    throw new PreservationCheckError('malformed-map', 'fixtures 不能为空')
  }
  if (!Array.isArray(raw.rows)) {
    throw new PreservationCheckError('malformed-map', 'rows 必须是数组')
  }
  const fixtures = raw.fixtures.map((fixture, index) => parseFixture(fixture, index))
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id))
  if (fixtureIds.size !== fixtures.length) {
    throw new PreservationCheckError('malformed-map', 'fixture id 重复')
  }
  const rows = raw.rows.map((row, index) => parseRow(row, index))
  const seen = new Map<string, number>()
  for (const row of rows) {
    seen.set(row.id, (seen.get(row.id) ?? 0) + 1)
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  if (duplicates.length > 0) {
    throw new PreservationCheckError('duplicate-pm', `重复 PM：${duplicates.join(', ')}`)
  }
  const missing = PRESERVATION_PM_IDS.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    throw new PreservationCheckError('missing-pm', `缺少 PM：${missing.join(', ')}`)
  }
  const unknownIds = rows.map((row) => row.id).filter((id) => !PRESERVATION_PM_IDS.includes(id))
  if (unknownIds.length > 0) {
    throw new PreservationCheckError('malformed-map', `未知 PM：${unknownIds.join(', ')}`)
  }
  for (const row of rows) {
    for (const fixtureId of row.fixtureIds) {
      if (!fixtureIds.has(fixtureId)) {
        throw new PreservationCheckError('malformed-map', `${row.id} 引用了不存在的 fixture：${fixtureId}`)
      }
    }
  }
  return {
    schemaVersion: 1,
    release: '1.1',
    fixtures,
    rows,
  }
}

function defaultReadHead(projectRoot: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new PreservationCheckError('stale-candidate', '无法读取 Git HEAD 作为 candidate identity')
  }
  return result.stdout.trim()
}

function defaultListDirtyFiles(projectRoot: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new PreservationCheckError('related-dirty', '无法读取 git status')
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const tracked = line.slice(3)
      const renamed = tracked.split(' -> ').pop() ?? tracked
      return posix(renamed.replaceAll('"', ''))
    })
}

function defaultRunCommand(command: string, cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function commandEvidencePaths(command: string): string[] {
  return command
    .split(/\s+/)
    .map((part) => part.replaceAll('\\', '/'))
    .filter((part) => (
      part.startsWith('tests/')
      || part.startsWith('scripts/')
      || part.startsWith('src/')
      || part.startsWith('examples/')
      || part.startsWith('artifacts/')
    ))
}

function closureMatches(dirtyFile: string, closureEntry: string): boolean {
  const dirty = posix(dirtyFile)
  const entry = posix(closureEntry).replace(/\/$/, '')
  return dirty === entry || dirty.startsWith(`${entry}/`)
}

function assertEntriesExist(projectRoot: string, map: PreservationMap): void {
  for (const fixture of map.fixtures) {
    const absolute = path.join(projectRoot, ...fixture.path.split('/'))
    if (!existsSync(absolute)) {
      throw new PreservationCheckError('malformed-map', `不存在的 fixture 入口：${fixture.path}`)
    }
  }
  for (const row of map.rows) {
    for (const entry of row.inputClosure) {
      const absolute = path.join(projectRoot, ...entry.split('/'))
      if (!existsSync(absolute)) {
        throw new PreservationCheckError('malformed-map', `${row.id} 的 inputClosure 不存在：${entry}`)
      }
    }
    if (row.type === 'automated' && row.evidenceCommand) {
      for (const evidencePath of commandEvidencePaths(row.evidenceCommand)) {
        const absolute = path.join(projectRoot, ...evidencePath.split('/'))
        if (!existsSync(absolute)) {
          throw new PreservationCheckError('malformed-map', `${row.id} 的证据入口不存在：${evidencePath}`)
        }
      }
    }
  }
}

async function readPreviousReport(
  reportPath: string,
): Promise<{ candidate: string; closureDigest: string }> {
  let raw: string
  try {
    raw = await fs.readFile(reportPath, 'utf8')
  } catch {
    throw new PreservationCheckError('stale-candidate', `无法读取候选报告：${reportPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PreservationCheckError('stale-candidate', '候选报告损坏：不是合法 JSON')
  }
  if (!isPlainRecord(parsed) || typeof parsed.candidate !== 'string' || typeof parsed.closureDigest !== 'string') {
    throw new PreservationCheckError('stale-candidate', '候选报告损坏：缺少 candidate / closureDigest')
  }
  if (parsed.accepted === true || parsed.status === 'accepted') {
    throw new PreservationCheckError('stale-candidate', '候选报告不得把 automation 结果写成 accepted')
  }
  return { candidate: parsed.candidate, closureDigest: parsed.closureDigest }
}

function assertCandidateReportPath(projectRoot: string, candidate: string, reportPath: string): void {
  const expected = path.resolve(
    projectRoot,
    'artifacts',
    'release-evidence',
    'v1.1',
    candidate,
    'preservation.json',
  )
  if (path.resolve(reportPath) !== expected) {
    throw new PreservationCheckError(
      'malformed-map',
      `候选报告只能写入 ${posix(path.relative(projectRoot, expected))}`,
    )
  }
}

async function writeJsonAtomically(reportPath: string, value: unknown): Promise<void> {
  const directory = path.dirname(reportPath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `.${path.basename(reportPath)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await fs.rename(temporaryPath, reportPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function evidenceClosureEntries(
  projectRoot: string,
  mapPath: string,
  map: PreservationMap,
): string[] {
  const mapRelative = path.relative(projectRoot, mapPath)
  const mapEntry = mapRelative === '..' || mapRelative.startsWith(`..${path.sep}`) || path.isAbsolute(mapRelative)
    ? []
    : [posix(mapRelative)]
  return [...new Set([
    ...EVIDENCE_DEFINITION_PATHS,
    ...mapEntry,
    ...map.fixtures.map((fixture) => fixture.path),
    ...map.rows.flatMap((row) => [
      ...row.inputClosure,
      ...(row.evidenceCommand ? commandEvidencePaths(row.evidenceCommand) : []),
    ]),
  ])].sort()
}

async function collectClosureFiles(projectRoot: string, entries: readonly string[]): Promise<string[]> {
  const files = new Set<string>()

  const visit = async (absolutePath: string): Promise<void> => {
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) {
      files.add(absolutePath)
      return
    }
    const children = await fs.readdir(absolutePath)
    children.sort()
    for (const child of children) {
      await visit(path.join(absolutePath, child))
    }
  }

  for (const entry of entries) {
    await visit(path.resolve(projectRoot, ...entry.split('/')))
  }
  return [...files].sort((left, right) => posix(path.relative(projectRoot, left)).localeCompare(
    posix(path.relative(projectRoot, right)),
  ))
}

async function closureDigest(
  projectRoot: string,
  entries: readonly string[],
): Promise<string> {
  const hash = createHash('sha256')
  for (const absolutePath of await collectClosureFiles(projectRoot, entries)) {
    hash.update(posix(path.relative(projectRoot, absolutePath)))
    hash.update('\0')
    hash.update(await fs.readFile(absolutePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function checkPreservation(
  options: PreservationCheckOptions = {},
): Promise<PreservationCheckResult> {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const mapPath = options.mapPath
    ?? path.join(projectRoot, 'docs', 'development-plan', 'baselines', 'v1.1-preservation-map.json')
  const executeAutomated = options.executeAutomated ?? true
  const hooks = options.hooks ?? {}

  let mapRaw: unknown
  try {
    mapRaw = JSON.parse(await fs.readFile(mapPath, 'utf8'))
  } catch {
    throw new PreservationCheckError('malformed-map', `无法读取映射：${mapPath}`)
  }
  const map = parsePreservationMap(mapRaw)
  assertEntriesExist(projectRoot, map)
  const closureEntries = evidenceClosureEntries(projectRoot, mapPath, map)
  for (const entry of EVIDENCE_DEFINITION_PATHS) {
    if (!existsSync(path.resolve(projectRoot, ...entry.split('/')))) {
      throw new PreservationCheckError('malformed-map', `证据定义入口不存在：${entry}`)
    }
  }
  const currentClosureDigest = await closureDigest(projectRoot, closureEntries)

  const candidate = (hooks.readHead ?? (() => defaultReadHead(projectRoot)))()
  if (options.expectedCandidate && options.expectedCandidate !== candidate) {
    throw new PreservationCheckError(
      'stale-candidate',
      `候选身份不符：当前 ${candidate}，期望 ${options.expectedCandidate}`,
    )
  }
  if (options.reportPath) {
    assertCandidateReportPath(projectRoot, candidate, options.reportPath)
  }
  let reusedFrom: PreservationReuseProvenance | undefined
  if (options.previousReportPath) {
    const previous = await readPreviousReport(options.previousReportPath)
    if (previous.candidate !== candidate) {
      throw new PreservationCheckError(
        'stale-candidate',
        `复用证据的 candidate 已失效：报告 ${previous.candidate}，当前 ${candidate}`,
      )
    }
    if (previous.closureDigest !== currentClosureDigest) {
      throw new PreservationCheckError('stale-candidate', '复用证据的输入闭包已失效')
    }
    reusedFrom = {
      reportPath: posix(path.relative(projectRoot, path.resolve(options.previousReportPath))),
      candidate: previous.candidate,
      closureDigest: previous.closureDigest,
      candidateMatches: true,
      closureMatches: true,
    }
  }

  const dirtyFiles = (hooks.listDirtyFiles ?? (() => defaultListDirtyFiles(projectRoot)))()
  const relatedDirtyFiles = dirtyFiles.filter((dirty) => (
    closureEntries.some((entry) => closureMatches(dirty, entry))
  ))
  if (options.requireClean && relatedDirtyFiles.length > 0) {
    throw new PreservationCheckError(
      'related-dirty',
      `脏文件命中证据闭包：${[...new Set(relatedDirtyFiles)].join(', ')}`,
    )
  }

  const runCommand = hooks.runCommand ?? defaultRunCommand
  const rows: PreservationRowResult[] = []
  const ownerObservationRequired: string[] = []

  for (const row of map.rows) {
    if (row.type === 'owner-observation') {
      ownerObservationRequired.push(row.id)
      rows.push({
        id: row.id,
        type: row.type,
        status: 'owner-observation-required',
        fixtureIds: row.fixtureIds,
        evidence: row.observer ?? '',
      })
      continue
    }
    if (!executeAutomated) {
      rows.push({
        id: row.id,
        type: row.type,
        status: 'pass',
        fixtureIds: row.fixtureIds,
        evidence: row.evidenceCommand ?? '',
      })
      continue
    }
    const command = row.evidenceCommand ?? ''
    const executed = runCommand(command, projectRoot)
    if (executed.status !== 0) {
      throw new PreservationCheckError(
        'underlying-failure',
        `${row.id} 证据命令失败（exit ${executed.status}）：${command}\n${executed.stderr || executed.stdout}`,
      )
    }
    rows.push({
      id: row.id,
      type: row.type,
      status: 'pass',
      fixtureIds: row.fixtureIds,
      evidence: command,
    })
  }

  const result: PreservationCheckResult = {
    candidate,
    closureDigest: currentClosureDigest,
    release: map.release,
    rows,
    ownerObservationRequired,
    dirtyFiles,
    relatedDirtyFiles,
    ...(reusedFrom ? { reusedFrom } : {}),
  }

  if (options.reportPath) {
    const report = {
      schemaVersion: 1,
      release: map.release,
      candidate,
      closureDigest: currentClosureDigest,
      status: relatedDirtyFiles.length === 0 ? 'engineering-candidate' : 'working-tree-validated',
      accepted: false,
      clean: relatedDirtyFiles.length === 0,
      dirtyFiles,
      relatedDirtyFiles,
      ownerObservationRequired,
      rows,
      ...(reusedFrom ? { reusedFrom } : {}),
    }
    await writeJsonAtomically(options.reportPath, report)
  }

  return result
}

interface CliOptions {
  projectRoot: string
  mapPath?: string
  reportPath?: string
  previousReportPath?: string
  requireClean: boolean
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let projectRoot = defaultProjectRoot
  let mapPath: string | undefined
  let reportPath: string | undefined
  let previousReportPath: string | undefined
  let requireClean = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--require-clean') {
      requireClean = true
      continue
    }
    const next = argv[index + 1]
    if (argument === '--project-root' || argument === '--map' || argument === '--report' || argument === '--from-report') {
      if (!next) throw new Error(`${argument} 缺少路径参数`)
      index += 1
      if (argument === '--project-root') projectRoot = path.resolve(next)
      else if (argument === '--map') mapPath = path.resolve(next)
      else if (argument === '--report') reportPath = path.resolve(next)
      else previousReportPath = path.resolve(next)
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return { projectRoot, mapPath, reportPath, previousReportPath, requireClean }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const result = await checkPreservation({
    projectRoot: options.projectRoot,
    mapPath: options.mapPath,
    reportPath: options.reportPath,
    previousReportPath: options.previousReportPath,
    requireClean: options.requireClean,
  })
  const observation = result.ownerObservationRequired.length > 0
    ? `；Owner 观察未签署：${result.ownerObservationRequired.join(', ')}`
    : ''
  console.log(
    `1.1 保全检查通过：candidate ${result.candidate}，${result.rows.filter((row) => row.status === 'pass').length} 个 automated pass${observation}。自动化结果不是 Owner accepted。`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    if (error instanceof PreservationCheckError) {
      console.error(`preservation:${error.category}: ${error.message}`)
    } else {
      console.error(error instanceof Error ? error.message : String(error))
    }
    process.exitCode = 1
  })
}
