import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

const ROADMAP_RELATIVE_ROOT = 'docs/development-plan/roadmap'
const MANIFEST_KEYS = ['schemaVersion', 'tasks'] as const
const TASK_KEYS = [
  'id',
  'release',
  'title',
  'dependencies',
  'optional',
  'writeLocks',
  'spec',
] as const
const RELEASES = ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.0'] as const
const RELEASE_BY_PREFIX = new Map(RELEASES.map((release) => [`r${release.replace('.', '')}`, release]))
const TASK_ID_PATTERN = /^r(?:1[1-9]|20)-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/
const TASK_SHORT_ID_PATTERN = /^r(?:1[1-9]|20)-\d{3}$/
const TASK_REFERENCE_PATTERN = /\br(?:1[1-9]|20)-\d{3}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?\b/g
export const ROADMAP_WRITE_LOCKS = [
  'none',
  'contracts-schema',
  'generated-index',
  'legacy-inventory',
  'store-kernel',
  'store-slide',
  'store-flow',
  'store-spatial',
  'store-course',
  'props-shared',
  'props-slide',
  'props-flow',
  'props-spatial',
  'props-global',
  'workspace-shell',
  'authoring-slide',
  'authoring-flow',
  'authoring-spatial',
  'authoring-interaction',
  'authoring-recipe',
  'published-slide',
  'published-flow',
  'published-spatial',
  'published-interaction',
  'published-dynamic',
  'published-producer',
  'export-pptx',
  'export-docx-print',
  'app-save-recovery',
  'diagnostics',
  'main-preload',
  'cli-adapters',
  'ai-session',
  'mcp-server',
  'chat-ui',
] as const
const roadmapWriteLockSet = new Set<string>(ROADMAP_WRITE_LOCKS)
export const OLD_PLAN_TASK_IDS = [
  'r11-000-governance-route',
  'r11-001-fix-published-zindex-assertion',
  'r11-002-refresh-current-generated-fixtures',
  'r11-003-fixed-baseline-gate',
  'r11-010-legacy-boundary-ratchet',
  'r11-011-remove-renderer-v8-load-entry',
  'r11-012-isolate-v8-migrator',
  'r11-020-slide-v9-hit-selection-read-model',
  'r11-021-slide-native-properties-v9',
  'r11-022-slide-clipboard-delete-reorder-v9',
  'r11-023-flow-viewstate-without-v8-project',
  'r11-024-spatial-viewstate-without-v8-project',
  'r11-025-remove-editorstate-v8-document',
  'r11-026-retire-slide-editor-projection',
  'r11-030-focused-validation-map',
  'r11-040-stability-release-gate',
  'r12-000-v9-native-variant-exception',
  'r12-001-published-table-chart-adr',
  'r12-010-table-contract-and-factory',
  'r12-011-table-shared-render-and-published',
  'r12-012-table-authoring-commands-history',
  'r12-013-table-authoring-ui',
  'r12-014-table-export-diagnostics-capability',
  'r12-020-chart-contract-and-factory',
  'r12-021-chart-shared-render-and-published',
  'r12-022-chart-authoring-commands-and-ui',
  'r12-023-chart-export-diagnostics-capability',
  'r12-030-line-direct-draw-endpoints',
  'r12-031-line-hit-snap-elbow',
  'r12-040-background-asset-scope-authoring',
  'r12-050-native-closure-release-gate',
  'r13-000-recipe-contract-and-catalog',
  'r13-010-page-recipe-cover',
  'r13-011-page-recipe-concept',
  'r13-012-page-recipe-worked-example',
  'r13-020-interaction-recipe-step-reveal',
  'r13-021-interaction-recipe-choice-feedback',
  'r13-022-interaction-recipe-classify-sort',
  'r13-030-reference-page-clone',
  'r13-040-batch-find-replace',
  'r13-041-batch-design-token-application',
  'r13-050-fast-v9-diagnostics',
  'r13-060-design-production-release-gate',
  'r14-000-authoring-tool-wire-contract',
  'r14-010-read-and-inspect-tools',
  'r14-011-page-and-deck-write-tools',
  'r14-012-native-atomic-write-tools',
  'r14-013-component-runtime-code-tools',
  'r14-014-course-logic-global-background-tools',
  'r14-015-tool-receipts-stale-and-undo',
  'r14-020-courseware-case-builder-api-v2',
  'r14-021-refactor-external-builder-skill',
  'r14-022-weak-model-external-builder-benchmark',
  'r14-030-authoring-tools-release-gate',
  'r15-000-material-source-contract',
  'r15-010-material-ingest-read-search',
  'r15-020-material-context-authoring-tools',
  'r15-030-pptx-import-minimum',
  'r15-040-style-remix-from-reference',
  'r15-050-openmaic-bridge-and-license',
  'r15-060-content-correctness-checks',
  'r15-070-materials-quality-release-gate',
  'r16-000-provider-security-adr',
  'r16-010-provider-core-and-ipc',
  'r16-011-provider-secret-storage',
  'r16-020-provider-cancel-timeout-retry',
  'r16-030-ai-log-redaction',
  'r16-040-internal-provider-gate',
  'r17-000-generation-request-contract',
  'r17-010-single-page-generation',
  'r17-020-course-plan-generation',
  'r17-021-course-build-orchestrator',
  'r17-030-generated-component-runtime-path',
  'r17-040-risk-preview-single-repair',
  'r17-050-weak-model-generation-benchmark',
  'r17-060-internal-generation-gate',
  'r18-000-agent-tool-registry',
  'r18-010-agent-runner-and-session',
  'r18-020-product-skill-manifest-loader',
  'r18-021-course-design-build-skills',
  'r18-022-editing-visual-interaction-qa-skills',
  'r18-030-agent-human-concurrency',
  'r18-040-agent-skill-weak-model-benchmark',
  'r18-050-internal-agent-skills-gate',
  'r19-000-internal-chat-shell',
  'r19-010-chat-context-references',
  'r19-020-chat-tool-timeline',
  'r19-021-chat-markdown-formula-rendering',
  'r19-030-chat-confirmation-and-undo-ux',
  'r19-040-internal-dogfood-privacy',
  'r19-050-internal-workbench-gate',
  'r20-000-public-ai-governance',
  'r20-010-provider-settings-ui',
  'r20-020-public-generate-and-edit-flows',
  'r20-030-public-built-in-skill-controls',
  'r20-040-public-materials-and-privacy-controls',
  'r20-050-release-docs-accessibility-compatibility',
  'r20-060-teacher-acceptance-and-release',
] as const

type Release = (typeof RELEASES)[number]
type CrosswalkClassification = 'replaced' | 'merged' | 'retired' | 'optional'
type InventoryAccess = 'none' | 'read' | 'write'

const INDEPENDENT_SPEC_RELEASES = new Set<Release>(['1.1', '1.2'])

function hasIndependentSpecs(release: Release): boolean {
  return INDEPENDENT_SPEC_RELEASES.has(release)
}

export interface DevelopmentRoadmapTask {
  id: string
  release: Release
  title: string
  dependencies: string[]
  optional: boolean
  writeLocks: string[]
  spec: string
}

export interface DevelopmentRoadmapReport {
  taskCount: number
  specCount: number
  crosswalkCount: number
  releaseTaskCounts: Record<string, number>
  parallelFrontier: string[]
}

interface ReleaseReadmeRow {
  id: string
  title: string
  dependencies: string[]
  optional: boolean
  writeLocks: string[]
  specLink: string | null
  line: number
}

export class DevelopmentRoadmapValidationError extends Error {
  readonly issues: string[]

  constructor(issues: readonly string[]) {
    super(`开发路线校验失败（${issues.length} 项）：\n- ${issues.join('\n- ')}`)
    this.name = 'DevelopmentRoadmapValidationError'
    this.issues = [...issues]
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed)
  return Object.keys(record).filter((key) => !allowedSet.has(key)).sort()
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function cleanMarkdownCell(value: string): string {
  const trimmed = value.trim()
  const fullyWrapped = trimmed.match(/^`([^`]*)`$/)
  return (fullyWrapped?.[1] ?? trimmed).trim()
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  const body = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined)
  const cells: string[] = []
  let current = ''
  let escaped = false
  let inCode = false
  for (const character of body) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      current += character
      escaped = true
      continue
    }
    if (character === '`') inCode = !inCode
    if (character === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  cells.push(current.trim())
  return cells
}

function resolveTaskReference(
  reference: string,
  tasks: readonly DevelopmentRoadmapTask[],
  label: string,
  issues: string[],
): string | null {
  if (TASK_ID_PATTERN.test(reference)) {
    if (tasks.some((task) => task.id === reference)) return reference
    issues.push(`${label} 引用不存在的任务 ID ${reference}。`)
    return null
  }
  if (!TASK_SHORT_ID_PATTERN.test(reference)) {
    issues.push(`${label} 含无效任务引用 ${reference}。`)
    return null
  }
  const matches = tasks.filter((task) => task.id.startsWith(`${reference}-`)).map((task) => task.id)
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) issues.push(`${label} 引用不存在的任务 ID ${reference}。`)
  else issues.push(`${label} 的任务短 ID ${reference} 有歧义：${matches.join(', ')}。`)
  return null
}

function parseTaskReferences(
  value: string,
  tasks: readonly DevelopmentRoadmapTask[],
  label: string,
  issues: string[],
): string[] {
  const cleaned = value.replaceAll('`', '').trim()
  if (!cleaned || /^(?:none|—)$/i.test(cleaned)) return []
  const references = cleaned.match(TASK_REFERENCE_PATTERN) ?? []
  const remainder = cleaned
    .replace(TASK_REFERENCE_PATTERN, '')
    .replace(/[,，\s]/g, '')
  if (remainder) issues.push(`${label} 的依赖单元无法解析：${value}。`)
  const resolved = references
    .map((reference) => {
      if (TASK_SHORT_ID_PATTERN.test(reference)) {
        issues.push(`${label} 的 dependencies 必须使用完整 task ID，不得缩写为 ${reference}。`)
        return null
      }
      return resolveTaskReference(reference, tasks, label, issues)
    })
    .filter((reference): reference is string => reference !== null)
  const repeated = duplicates(resolved)
  if (repeated.length > 0) issues.push(`${label} 含重复依赖：${repeated.join(', ')}。`)
  return resolved
}

function parseWriteLocks(value: string, label: string, issues: string[]): string[] {
  const cleaned = value.replaceAll('`', '').trim()
  if (!cleaned || cleaned === '—') return []
  const locks = cleaned.split(/[,，]/).map((entry) => entry.trim()).filter(Boolean)
  const repeated = duplicates(locks)
  if (repeated.length > 0) issues.push(`${label} 含重复写锁：${repeated.join(', ')}。`)
  return locks
}

function formatValues(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none'
}

function normalizeRoadmapRelativePath(value: string): string {
  const slashPath = value.replaceAll('\\', '/')
  const prefix = `${ROADMAP_RELATIVE_ROOT}/`
  return slashPath.startsWith(prefix) ? slashPath.slice(prefix.length) : slashPath
}

function resolveRoadmapPath(roadmapRoot: string, value: string): string | null {
  const relativePath = normalizeRoadmapRelativePath(value)
  if (!relativePath || path.posix.isAbsolute(relativePath) || /^[a-zA-Z]:\//.test(relativePath)) return null
  const resolved = path.resolve(roadmapRoot, ...relativePath.split('/'))
  const relative = path.relative(roadmapRoot, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return resolved
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

function parseManifest(value: unknown, issues: string[]): DevelopmentRoadmapTask[] {
  if (!isObject(value)) {
    issues.push('manifest.json 顶层必须是对象。')
    return []
  }

  const topUnknown = sortedUnknownKeys(value, MANIFEST_KEYS)
  if (topUnknown.length > 0) issues.push(`manifest.json 含未授权顶层字段：${topUnknown.join(', ')}。`)
  if (value.schemaVersion !== 1) issues.push('manifest.json schemaVersion 必须严格等于 1。')
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    issues.push('manifest.json tasks 必须是非空数组。')
    return []
  }

  const tasks: DevelopmentRoadmapTask[] = []
  value.tasks.forEach((candidate, index) => {
    const label = `tasks[${index}]`
    if (!isObject(candidate)) {
      issues.push(`${label} 必须是对象。`)
      return
    }
    const unknown = sortedUnknownKeys(candidate, TASK_KEYS)
    if (unknown.length > 0) issues.push(`${label} 含未授权字段（路线不得保存执行状态）：${unknown.join(', ')}。`)

    const id = typeof candidate.id === 'string' ? candidate.id : ''
    const release = typeof candidate.release === 'string' ? candidate.release : ''
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const dependencies = Array.isArray(candidate.dependencies) && candidate.dependencies.every((entry) => typeof entry === 'string')
      ? candidate.dependencies as string[]
      : null
    const optional = typeof candidate.optional === 'boolean' ? candidate.optional : null
    const writeLocks = Array.isArray(candidate.writeLocks) && candidate.writeLocks.every((entry) => typeof entry === 'string')
      ? candidate.writeLocks as string[]
      : null
    const spec = typeof candidate.spec === 'string' ? candidate.spec : ''

    if (!TASK_ID_PATTERN.test(id)) issues.push(`${label}.id 无效：${id || '<空>'}。`)
    if (!RELEASES.includes(release as Release)) issues.push(`${label}.release 无效：${release || '<空>'}。`)
    const expectedRelease = RELEASE_BY_PREFIX.get(id.slice(0, 3))
    if (expectedRelease && release && expectedRelease !== release) {
      issues.push(`${id} 的 ID 前缀属于 ${expectedRelease}，但 release 写为 ${release}。`)
    }
    if (!title) issues.push(`${label}.title 不能为空。`)
    if (!dependencies) issues.push(`${label}.dependencies 必须是字符串数组。`)
    else {
      const repeated = duplicates(dependencies)
      if (repeated.length > 0) issues.push(`${id || label} 含重复依赖：${repeated.join(', ')}。`)
      if (dependencies.includes(id)) issues.push(`${id || label} 不得依赖自身。`)
    }
    if (optional === null) issues.push(`${label}.optional 必须是布尔值。`)
    if (!writeLocks || writeLocks.length === 0 || writeLocks.some((entry) => !entry.trim())) {
      issues.push(`${id || label}.writeLocks 必须是非空、非空白字符串数组。`)
    } else {
      const repeated = duplicates(writeLocks)
      if (repeated.length > 0) issues.push(`${id} 含重复写锁：${repeated.join(', ')}。`)
      const unknownLocks = writeLocks.filter((entry) => !roadmapWriteLockSet.has(entry))
      if (unknownLocks.length > 0) {
        issues.push(`${id} 含任务卡协议未定义的写锁：${unknownLocks.join(', ')}；允许值为 ${ROADMAP_WRITE_LOCKS.join(', ')}。`)
      }
      if (writeLocks.includes('none') && writeLocks.length > 1) {
        issues.push(`${id} 的 writeLocks 为 none 时不得混列其他锁。`)
      }
    }
    if (!spec || resolveRoadmapPath('C:\\roadmap-root-placeholder', spec) === null) {
      issues.push(`${id || label}.spec 必须是 roadmap 内的相对路径。`)
    }

    if (
      TASK_ID_PATTERN.test(id)
      && RELEASES.includes(release as Release)
      && title
      && dependencies
      && optional !== null
      && writeLocks
      && writeLocks.length > 0
      && spec
    ) {
      tasks.push({
        id,
        release: release as Release,
        title,
        dependencies: [...dependencies],
        optional,
        writeLocks: [...writeLocks],
        spec,
      })
    }
  })
  return tasks
}

function validateGraph(tasks: readonly DevelopmentRoadmapTask[], issues: string[]): string[] {
  const ids = tasks.map((task) => task.id)
  const repeatedIds = duplicates(ids)
  if (repeatedIds.length > 0) issues.push(`manifest.json 含重复任务 ID：${repeatedIds.join(', ')}。`)
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!taskById.has(dependency)) issues.push(`${task.id} 引用不存在的依赖 ${dependency}。`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  let reportedCycle = false
  const visit = (id: string): void => {
    if (visited.has(id) || reportedCycle) return
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      issues.push(`任务图存在环：${[...stack.slice(start), id].join(' -> ')}。`)
      reportedCycle = true
      return
    }
    visiting.add(id)
    stack.push(id)
    for (const dependency of taskById.get(id)?.dependencies ?? []) {
      if (taskById.has(dependency)) visit(dependency)
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)

  for (const task of tasks.filter((entry) => !entry.optional)) {
    const pending = [...task.dependencies]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const dependency = pending.pop() as string
      if (seen.has(dependency)) continue
      seen.add(dependency)
      const dependencyTask = taskById.get(dependency)
      if (!dependencyTask) continue
      if (dependencyTask.optional) {
        issues.push(`核心任务 ${task.id} 的依赖闭包包含可选任务 ${dependencyTask.id}。`)
        break
      }
      pending.push(...dependencyTask.dependencies)
    }
  }

  const indegree = new Map(tasks.map((task) => [task.id, 0]))
  const dependents = new Map(tasks.map((task) => [task.id, [] as string[]]))
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!taskById.has(dependency)) continue
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1)
      dependents.get(dependency)?.push(task.id)
    }
  }

  let frontier = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id).sort()
  let parallelFrontier: string[] = []
  const lockSet = (task: DevelopmentRoadmapTask): Set<string> =>
    new Set(task.writeLocks.filter((entry) => entry !== 'none'))
  const largestLockDisjointSet = (candidates: readonly DevelopmentRoadmapTask[]): string[] => {
    let best: string[] = []
    const visit = (index: number, chosen: string[], heldLocks: Set<string>): void => {
      if (chosen.length + candidates.length - index <= best.length) return
      if (index >= candidates.length) {
        best = [...chosen]
        return
      }
      const candidate = candidates[index]
      const candidateLocks = lockSet(candidate)
      if (![...candidateLocks].some((lock) => heldLocks.has(lock))) {
        visit(
          index + 1,
          [...chosen, candidate.id],
          new Set([...heldLocks, ...candidateLocks]),
        )
      }
      visit(index + 1, chosen, heldLocks)
    }
    visit(0, [], new Set())
    return best
  }
  while (frontier.length > 0 && parallelFrontier.length === 0) {
    const coreCandidates = frontier
      .map((id) => taskById.get(id))
      .filter((task): task is DevelopmentRoadmapTask => task !== undefined && !task.optional)
    const earliestReleaseIndex = coreCandidates.reduce<number>(
      (current, task) => Math.min(current, RELEASES.indexOf(task.release)),
      RELEASES.length,
    )
    const core = coreCandidates.filter((task) => RELEASES.indexOf(task.release) === earliestReleaseIndex)
    const compatible = largestLockDisjointSet(core)
    if (compatible.length >= 2) parallelFrontier = compatible
    const next: string[] = []
    for (const id of frontier) {
      for (const dependent of dependents.get(id) ?? []) {
        const nextDegree = (indegree.get(dependent) ?? 0) - 1
        indegree.set(dependent, nextDegree)
        if (nextDegree === 0) next.push(dependent)
      }
    }
    frontier = next.sort()
  }
  return parallelFrontier
}

function parseReleaseReadmeRows(
  release: Release,
  markdown: string,
  tasks: readonly DevelopmentRoadmapTask[],
  issues: string[],
): ReleaseReadmeRow[] {
  const displayPath = `${release}/README.md`
  const lines = markdown.split(/\r?\n/)
  const expectedColumns = release === '1.1' ? 5 : release === '1.2' ? 7 : 6
  const header = lines.find((line) => {
    const firstCell = splitMarkdownTableRow(line)[0]?.replaceAll('`', '').trim().toLowerCase()
    return firstCell === 'task' || firstCell === 'task id'
  })
  if (!header || splitMarkdownTableRow(header).length !== expectedColumns) {
    issues.push(`${displayPath} 缺少 ${expectedColumns} 列的标准任务表。`)
  }

  const rows: ReleaseReadmeRow[] = []
  for (const [index, line] of lines.entries()) {
    const cells = splitMarkdownTableRow(line)
    if (cells.length === 0) continue
    const id = cleanMarkdownCell(cells[0] ?? '')
    if (!/^r(?:1[1-9]|20)-\d{3}/.test(id)) continue
    if (!TASK_ID_PATTERN.test(id)) {
      issues.push(`${displayPath}:${index + 1} 的任务 ID 无效：${id}。`)
      continue
    }
    if (cells.length !== expectedColumns) {
      issues.push(`${displayPath}:${index + 1} 必须有 ${expectedColumns} 列，当前 ${cells.length} 列。`)
      continue
    }

    const dependencies = parseTaskReferences(
      cells[2] ?? '',
      tasks,
      `${displayPath}:${index + 1}`,
      issues,
    )
    let optional = false
    let writeLocksCell = cells[3] ?? ''
    let specLink: string | null = null
    if (release === '1.1') {
      const match = (cells[4] ?? '').match(/\[[^\]]+\]\(([^)\s]+)\)/)
      if (!match) issues.push(`${displayPath}:${index + 1} 缺少可解析的 spec 链接。`)
      else specLink = match[1].replace(/^<|>$/g, '')
    } else {
      const optionalValue = cleanMarkdownCell(cells[3] ?? '').toLowerCase()
      if (optionalValue === '是' || optionalValue === 'true' || optionalValue === 'yes') optional = true
      else if (optionalValue === '否' || optionalValue === 'false' || optionalValue === 'no') optional = false
      else issues.push(`${displayPath}:${index + 1} 的 Optional 必须是“是/否”：${cells[3] || '<空>'}。`)
      writeLocksCell = cells[4] ?? ''
      if (release === '1.2') {
        const match = (cells[5] ?? '').match(/\[[^\]]+\]\(([^)\s]+)\)/)
        if (!match) issues.push(`${displayPath}:${index + 1} 缺少可解析的 spec 链接。`)
        else specLink = match[1].replace(/^<|>$/g, '')
      }
    }
    rows.push({
      id,
      title: cleanMarkdownCell(cells[1] ?? ''),
      dependencies,
      optional,
      writeLocks: parseWriteLocks(writeLocksCell, `${displayPath}:${index + 1}`, issues),
      specLink,
      line: index + 1,
    })
  }
  return rows
}

function validateReleaseReadmes(
  tasks: readonly DevelopmentRoadmapTask[],
  markdownFiles: ReadonlyMap<string, { absolutePath: string; text: string }>,
  issues: string[],
): void {
  for (const release of RELEASES) {
    const relativePath = `${release}/README.md`
    const markdown = markdownFiles.get(relativePath)?.text
    if (!markdown) continue
    const rows = parseReleaseReadmeRows(release, markdown, tasks, issues)
    const rowIds = rows.map((row) => row.id)
    const repeated = duplicates(rowIds)
    if (repeated.length > 0) issues.push(`${relativePath} 含重复任务行：${repeated.join(', ')}。`)

    const manifestTasks = tasks.filter((task) => task.release === release)
    const expectedIds = new Set(manifestTasks.map((task) => task.id))
    const actualIds = new Set(rowIds)
    const missing = [...expectedIds].filter((id) => !actualIds.has(id)).sort()
    const extra = [...actualIds].filter((id) => !expectedIds.has(id)).sort()
    if (missing.length > 0 || extra.length > 0) {
      issues.push(`${relativePath} 与 manifest 任务 ID 不一致：缺失 [${missing.join(', ')}]，额外 [${extra.join(', ')}]。`)
    }

    const taskById = new Map(manifestTasks.map((task) => [task.id, task]))
    for (const row of rows) {
      const task = taskById.get(row.id)
      if (!task) continue
      const label = `${relativePath}:${row.line} ${row.id}`
      if (row.title !== task.title) {
        issues.push(`${label} 的 title 与 manifest 不一致：表为“${row.title}”，manifest 为“${task.title}”。`)
      }
      if (!sameStringSet(row.dependencies, task.dependencies)) {
        issues.push(`${label} 的 dependencies 与 manifest 不一致：表为 [${formatValues(row.dependencies)}]，manifest 为 [${formatValues(task.dependencies)}]。`)
      }
      if (!sameStringSet(row.writeLocks, task.writeLocks)) {
        issues.push(`${label} 的 writeLocks 与 manifest 不一致：表为 [${formatValues(row.writeLocks)}]，manifest 为 [${formatValues(task.writeLocks)}]。`)
      }
      if (release === '1.1') {
        if (task.optional) issues.push(`${label} 是 1.1 核心规格，manifest optional 不得为 true。`)
      } else if (row.optional !== task.optional) {
        issues.push(`${label} 的 optional 与 manifest 不一致：表为 ${row.optional}，manifest 为 ${task.optional}。`)
      }
      if (hasIndependentSpecs(release) && row.specLink) {
        const target = path.posix.normalize(path.posix.join(release, row.specLink.replaceAll('\\', '/')))
        if (target !== normalizeRoadmapRelativePath(task.spec)) {
          issues.push(`${label} 的 spec 链接与 manifest 不一致：表为 ${target}，manifest 为 ${normalizeRoadmapRelativePath(task.spec)}。`)
        }
      }
    }
  }
}

function inventoryWriteClaims(markdown: string): Array<{ line: number; text: string }> {
  const claims: Array<{ line: number; text: string }> = []
  const inventoryTerm = /(?:legacy-consumers\.json|\binventory\b|\bLEG-\d{3}\b|台账)/i
  const writeVerb = /(?:更新|修改|修正|写入|刷新|重算|维护|重写|改写|提交|删除|加入|移除|记录到|设为|标记|\bwrite\b|\bupdate\b|\bmodify\b|\brefresh\b|\breconcile\b)/i
  const prohibition = /(?:禁止|不得|不能|不可|不允许|不修改|不更新|不写|只读|read[- ]only)/i
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (/^-\s*Inventory access:/i.test(line)) continue
    for (const clause of line.split(/[。；;]/)) {
      if (inventoryTerm.test(clause) && writeVerb.test(clause) && !prohibition.test(clause)) {
        claims.push({ line: index + 1, text: clause.trim() })
      }
    }
  }
  return claims
}

function parseInventoryAccess(spec: string): InventoryAccess | null {
  const value = spec.match(/^-\s*Inventory access:\s*(.+)$/im)?.[1]
  if (!value) return null
  const normalized = cleanMarkdownCell(value).toLowerCase()
  return normalized === 'none' || normalized === 'read' || normalized === 'write'
    ? normalized
    : null
}

function validateIndependentSpecMetadata(
  tasks: readonly DevelopmentRoadmapTask[],
  markdownFiles: ReadonlyMap<string, { absolutePath: string; text: string }>,
  actualIndependentSpecPaths: readonly string[],
  issues: string[],
): void {
  const expectedPaths = new Set(
    tasks.filter((task) => hasIndependentSpecs(task.release)).map((task) => normalizeRoadmapRelativePath(task.spec)),
  )
  const actualPaths = new Set(actualIndependentSpecPaths)
  const orphanSpecs = [...actualPaths].filter((spec) => !expectedPaths.has(spec)).sort()
  if (orphanSpecs.length > 0) issues.push(`独立规格目录含 manifest 未登记的孤儿规格：${orphanSpecs.join(', ')}。`)

  for (const task of tasks.filter((entry) => hasIndependentSpecs(entry.release))) {
    const relativeSpec = normalizeRoadmapRelativePath(task.spec)
    const spec = markdownFiles.get(relativeSpec)?.text
    if (!spec) continue
    const displayPath = `${ROADMAP_RELATIVE_ROOT}/${relativeSpec}`
    const heading = spec.match(/^#\s+([^\r\n]+)$/m)?.[1].trim() ?? ''
    const headingMatch = heading.match(/^(r(?:1[1-9]|20)-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\s*[｜|]\s*(.+))?$/)
    if (!headingMatch || headingMatch[1] !== task.id) {
      issues.push(`${task.id} 的独立规格一级标题必须与 manifest task ID 一致。`)
    } else if ((headingMatch[2] ?? '').trim() !== task.title) {
      issues.push(`${task.id} 的独立规格标题与 manifest title 不一致：规格为“${(headingMatch[2] ?? '').trim()}”，manifest 为“${task.title}”。`)
    }

    const releaseDependencies = spec.match(/^-\s*Release\s*\/\s*Dependencies:\s*([^/\r\n]+?)\s*\/\s*(.+)$/im)
    if (!releaseDependencies) {
      issues.push(`${task.id} 缺少可解析的 Release / Dependencies 元数据。`)
    } else {
      const release = releaseDependencies[1].trim()
      if (release !== task.release) {
        issues.push(`${task.id} 的 spec release 为 ${release}，manifest 为 ${task.release}。`)
      }
      const dependencies = parseTaskReferences(
        releaseDependencies[2],
        tasks,
        `${displayPath} Release / Dependencies`,
        issues,
      )
      if (!sameStringSet(dependencies, task.dependencies)) {
        issues.push(`${task.id} 的 spec dependencies 与 manifest 不一致：规格为 [${formatValues(dependencies)}]，manifest 为 [${formatValues(task.dependencies)}]。`)
      }
    }

    const locksValue = spec.match(/^-\s*Write locks:\s*(.+)$/im)?.[1]
    if (!locksValue) {
      issues.push(`${task.id} 缺少 Write locks 元数据。`)
    } else {
      const locks = parseWriteLocks(locksValue, `${displayPath} Write locks`, issues)
      if (!sameStringSet(locks, task.writeLocks)) {
        issues.push(`${task.id} 的 spec writeLocks 与 manifest 不一致：规格为 [${formatValues(locks)}]，manifest 为 [${formatValues(task.writeLocks)}]。`)
      }
    }

    const rawInventoryAccess = spec.match(/^-\s*Inventory access:\s*(.+)$/im)?.[1]
    const inventoryAccess = parseInventoryAccess(spec)
    if (!rawInventoryAccess || !inventoryAccess) {
      issues.push(`${task.id} 的 Inventory access 必须严格是 none、read 或 write。`)
    }
    const holdsInventoryLock = task.writeLocks.includes('legacy-inventory')
    if (inventoryAccess === 'write' && !holdsInventoryLock) {
      issues.push(`${task.id} 声明 Inventory access: write 但未持有 legacy-inventory 写锁。`)
    }
    if (inventoryAccess !== 'write' && holdsInventoryLock) {
      issues.push(`${task.id} 持有 legacy-inventory 写锁，但 Inventory access 不是 write。`)
    }
    const claims = inventoryWriteClaims(spec)
    if (claims.length > 0 && inventoryAccess !== 'write') {
      issues.push(`${task.id} 不是 inventory writer 却声称写入 inventory/LEG：${claims.map((claim) => `${displayPath}:${claim.line}`).join(', ')}。`)
    }
    if (claims.length > 0 && !holdsInventoryLock) {
      issues.push(`${task.id} 声称写入 inventory/LEG 但未持有 legacy-inventory 写锁。`)
    }
    if (inventoryAccess === 'write' && claims.length === 0) {
      issues.push(`${task.id} 声明 Inventory access: write，但规格未声明精确 inventory 写入。`)
    }
    if (task.id.split('-').includes('gate') && (inventoryAccess === 'write' || holdsInventoryLock || claims.length > 0)) {
      issues.push(`${task.id} 是 gate，必须只读 inventory，不得持锁或修改台账/检查器。`)
    }

    for (const [index, line] of spec.split(/\r?\n/).entries()) {
      for (const reference of line.match(TASK_REFERENCE_PATTERN) ?? []) {
        resolveTaskReference(reference, tasks, `${displayPath}:${index + 1}`, issues)
      }
    }

    if (task.release === '1.2') {
      const requiredSections = [
        'Outcome / current evidence',
        'Read first',
        'Write scope',
        'Execution',
        'Stop conditions',
        'Acceptance',
        'Focused validation',
        'Rollback / handoff',
      ]
      const headings = new Set(
        [...spec.matchAll(/^##\s+([^\r\n]+)$/gm)].map((match) => match[1].trim()),
      )
      const missingSections = requiredSections.filter((section) => !headings.has(section))
      if (missingSections.length > 0) {
        issues.push(`${task.id} 的 1.2 执行规格缺少标准章节：${missingSections.join(', ')}。`)
      }
      if (!spec.includes('IMPLEMENTATION_CONTRACT.md')) {
        issues.push(`${task.id} 的 1.2 执行规格未引用共享 IMPLEMENTATION_CONTRACT.md。`)
      }
      const focusedValidation = spec.match(
        /(?:^|\n)## Focused validation[^\n]*\n([\s\S]*?)(?=\n##\s|$)/,
      )?.[1] ?? ''
      const validationCommands = focusedValidation
        .split(/\r?\n/)
        .filter((line) => /^\s*-\s+`(?:npm|npx|git)\b/.test(line))
      if (validationCommands.length < 1 || validationCommands.length > 3) {
        issues.push(`${task.id} 的 Focused validation 必须含 1–3 条精确命令，当前 ${validationCommands.length} 条。`)
      }
    }
  }
}

function validateLegacyInventoryWriterOrder(tasks: readonly DevelopmentRoadmapTask[], issues: string[]): void {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dependsOn = (taskId: string, dependencyId: string): boolean => {
    const pending = [...(taskById.get(taskId)?.dependencies ?? [])]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop() as string
      if (current === dependencyId) return true
      if (seen.has(current)) continue
      seen.add(current)
      pending.push(...(taskById.get(current)?.dependencies ?? []))
    }
    return false
  }
  const writers = tasks.filter((task) => task.writeLocks.includes('legacy-inventory'))
  for (let left = 0; left < writers.length; left += 1) {
    for (let right = left + 1; right < writers.length; right += 1) {
      const leftTask = writers[left]
      const rightTask = writers[right]
      if (!dependsOn(leftTask.id, rightTask.id) && !dependsOn(rightTask.id, leftTask.id)) {
        issues.push(`legacy-inventory writer 必须在依赖图中全序，但 ${leftTask.id} 与 ${rightTask.id} 可并行。`)
      }
    }
  }
}

function sectionRequiresLiveCodeReference(section: string): boolean {
  const normalized = section.trim().toLowerCase()
  return normalized.includes('read first')
    || normalized.includes('focused validation')
    || normalized.includes('精确验证入口')
    || normalized.includes('验证入口')
    || normalized === '验证'
    || normalized.includes('evidence command')
}

function markdownCodeFragments(markdown: string, displayPath: string): string[] {
  const fragments: string[] = []
  const matrixEvidence = displayPath.endsWith('PRESERVATION_MATRIX.md')
  let section = ''
  let inFence = false

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (!inFence && heading) section = heading[1].trim()

    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      if (line.trim()) fragments.push(line)
      continue
    }

    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const code = match[1]
      const explicitCommand = /\b(?:npm|npx|pnpm|yarn)\b/.test(code)
      if (matrixEvidence || explicitCommand || sectionRequiresLiveCodeReference(section)) {
        fragments.push(code)
      }
    }
  }

  return fragments
}

function lineIsOnlyDocumentingAProhibition(line: string): boolean {
  return /禁止|不得|不允许|拒绝|校验器|检查器|不会调用|不存在/.test(line)
}

async function validateMarkdown(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
  markdown: string,
  packageScripts: ReadonlySet<string>,
  issues: string[],
): Promise<void> {
  const lines = markdown.split(/\r?\n/)
  lines.forEach((line, index) => {
    const lineLabel = `${displayPath}:${index + 1}`
    if (line.includes('最小等价') && !lineIsOnlyDocumentingAProhibition(line)) {
      issues.push(`${lineLabel} 仍允许“最小等价”验证。`)
    }
    if (line.includes('verify:installer') && !lineIsOnlyDocumentingAProhibition(line)) {
      issues.push(`${lineLabel} 引用了不存在的 verify:installer。`)
    }
    if (line.includes('NEXT_TASK') && !lineIsOnlyDocumentingAProhibition(line)) {
      issues.push(`${lineLabel} 含 NEXT_TASK 自授权文本。`)
    }
  })

  for (const code of markdownCodeFragments(markdown, displayPath)) {
    const commandMatches = [...code.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)]
    for (const match of commandMatches) {
      const scriptName = match[1]
      if (!packageScripts.has(scriptName)) {
        issues.push(`${displayPath} 的 npm 命令引用不存在的 package script：${scriptName}。`)
      }
      if (/[*?]|\[[^\]]+\]/.test(code)) {
        issues.push(`${displayPath} 的验证命令含通配符：${code}。`)
      }
    }

    const testPaths = [...code.matchAll(/\btests\/[a-zA-Z0-9_.@/-]+/g)]
      .map((match) => match[0].replace(/[.,;:]+$/, ''))
    for (const testPath of testPaths) {
      if (!await pathExists(path.resolve(projectRoot, ...testPath.split('/')))) {
        issues.push(`${displayPath} 引用不存在的测试文件：${testPath}。`)
      }
    }
  }

  const linkTargets = [
    ...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g),
    ...markdown.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm),
  ].map((match) => match[1].replace(/^<|>$/g, ''))
  for (const target of linkTargets) {
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const withoutFragment = target.split('#', 1)[0].split('?', 1)[0]
    if (!withoutFragment) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(withoutFragment)
    } catch {
      issues.push(`${displayPath} 含无法解码的本地链接：${target}。`)
      continue
    }
    const resolved = path.resolve(path.dirname(absolutePath), ...decoded.replaceAll('\\', '/').split('/'))
    if (!await pathExists(resolved)) issues.push(`${displayPath} 含失效本地链接：${target}。`)
  }
}

interface CrosswalkRow {
  id: string
  classification: CrosswalkClassification
  targetIds: string[]
  reason: string
}

function parseCrosswalk(markdown: string, issues: string[]): CrosswalkRow[] {
  const classifications = new Set<CrosswalkClassification>(['replaced', 'merged', 'retired', 'optional'])
  const rows: CrosswalkRow[] = []
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (!/^\s*\|/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const oldId = cells[0]?.match(/r(?:1[1-9]|20)-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*/)?.[0]
    if (!oldId) continue
    const classification = cells[1]?.replaceAll('`', '') as CrosswalkClassification
    if (!classifications.has(classification)) {
      issues.push(`OLD_PLAN_CROSSWALK.md:${index + 1} 的归类无效：${cells[1] || '<空>'}。`)
      continue
    }
    const targetIds = [...new Set(cells[2]?.match(/r(?:1[1-9]|20)-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])]
    rows.push({ id: oldId, classification, targetIds, reason: cells[3] ?? '' })
  }
  return rows
}

function validateCrosswalk(
  markdown: string,
  tasks: readonly DevelopmentRoadmapTask[],
  issues: string[],
): number {
  const rows = parseCrosswalk(markdown, issues)
  const ids = rows.map((row) => row.id)
  const repeated = duplicates(ids)
  if (repeated.length > 0) issues.push(`OLD_PLAN_CROSSWALK.md 含重复旧任务 ID：${repeated.join(', ')}。`)
  const knownOldIds = new Set<string>(OLD_PLAN_TASK_IDS)
  const unknownOldIds = ids.filter((id) => !knownOldIds.has(id))
  if (unknownOldIds.length > 0) {
    issues.push(`OLD_PLAN_CROSSWALK.md 含不属于归档旧路线的任务 ID：${unknownOldIds.join(', ')}。`)
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  for (const row of rows) {
    if (!row.reason || row.reason === '—') issues.push(`${row.id} 缺少迁移理由。`)
    if (row.classification === 'replaced' && row.targetIds.length !== 1) {
      issues.push(`${row.id} 归类 replaced 时必须且只能映射一个新节点。`)
    }
    if ((row.classification === 'merged' || row.classification === 'optional') && row.targetIds.length === 0) {
      issues.push(`${row.id} 归类 ${row.classification} 时必须映射新节点。`)
    }
    if (row.classification === 'retired' && row.targetIds.length === 0 && row.reason.length < 8) {
      issues.push(`${row.id} 归类 retired 且无新节点时必须给出可审计理由。`)
    }
    for (const targetId of row.targetIds) {
      const target = taskById.get(targetId)
      if (!target) issues.push(`${row.id} 映射到不存在的新节点 ${targetId}。`)
      else if (row.classification === 'optional' && !target.optional) {
        issues.push(`${row.id} 归类 optional，但目标 ${targetId} 不是可选节点。`)
      }
    }
  }
  return rows.length
}

function validatePreservationReferences(
  tasks: readonly DevelopmentRoadmapTask[],
  markdownFiles: ReadonlyMap<string, { absolutePath: string; text: string }>,
  issues: string[],
): void {
  const matrix = markdownFiles.get('PRESERVATION_MATRIX.md')?.text ?? ''
  const matrixIds = [...matrix.matchAll(/^\|\s*(PM-\d{2})\s*\|/gm)].map((match) => match[1])
  const repeated = duplicates(matrixIds)
  if (matrixIds.length === 0) issues.push('PRESERVATION_MATRIX.md 必须包含带稳定 PM-xx ID 的行为行。')
  if (repeated.length > 0) issues.push(`PRESERVATION_MATRIX.md 含重复 ID：${repeated.join(', ')}。`)
  const validIds = new Set(matrixIds)
  for (const task of tasks.filter((entry) => entry.release === '1.1')) {
    const relativeSpec = normalizeRoadmapRelativePath(task.spec)
    const spec = markdownFiles.get(relativeSpec)?.text
    if (!spec) continue
    const headingPattern = new RegExp(`^#\\s+${escapeRegExp(task.id)}(?:\\s|[｜|]|$)`, 'm')
    if (!headingPattern.test(spec)) issues.push(`${task.id} 的独立规格一级标题必须以完整 task ID 开头。`)
    const references = [...new Set(spec.match(/PM-\d{2}/g) ?? [])]
    if (references.length === 0) issues.push(`${task.id} 的独立规格未引用不可降级矩阵 ID。`)
    const unknown = references.filter((id) => !validIds.has(id))
    if (unknown.length > 0) issues.push(`${task.id} 引用不存在的不可降级矩阵 ID：${unknown.join(', ')}。`)
  }
}

export async function checkDevelopmentRoadmap(
  projectRoot = defaultProjectRoot,
): Promise<DevelopmentRoadmapReport> {
  const issues: string[] = []
  const roadmapRoot = path.join(projectRoot, ...ROADMAP_RELATIVE_ROOT.split('/'))
  const manifestPath = path.join(roadmapRoot, 'manifest.json')
  let manifestText = ''
  let manifestValue: unknown = null
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8')
    manifestValue = JSON.parse(manifestText)
  } catch (error) {
    issues.push(`无法读取或解析 ${ROADMAP_RELATIVE_ROOT}/manifest.json：${error instanceof Error ? error.message : String(error)}。`)
  }

  const tasks = parseManifest(manifestValue, issues)
  const parallelFrontier = validateGraph(tasks, issues)
  validateLegacyInventoryWriterOrder(tasks, issues)
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  const independentSpecs = tasks.filter((task) => hasIndependentSpecs(task.release))
  const repeatedIndependentSpecs = duplicates(independentSpecs.map((task) => normalizeRoadmapRelativePath(task.spec)))
  if (repeatedIndependentSpecs.length > 0) {
    issues.push(`1.1/1.2 节点必须各有独立规格；重复规格：${repeatedIndependentSpecs.join(', ')}。`)
  }
  for (const task of independentSpecs) {
    const relativeSpec = normalizeRoadmapRelativePath(task.spec)
    if (relativeSpec !== `${task.release}/${task.id}.md`) {
      issues.push(`${task.id} 必须指向 ${task.release} 目录内同名独立规格文件。`)
    }
  }
  for (const task of tasks.filter((entry) => !hasIndependentSpecs(entry.release))) {
    const relativeSpec = normalizeRoadmapRelativePath(task.spec)
    if (relativeSpec !== `${task.release}/README.md`) {
      issues.push(`${task.id} 必须指向对应版本的 ${task.release}/README.md。`)
    }
  }

  let packageScripts = new Set<string>()
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as unknown
    if (isObject(packageJson) && isObject(packageJson.scripts)) packageScripts = new Set(Object.keys(packageJson.scripts))
    else issues.push('package.json scripts 缺失或不是对象。')
  } catch (error) {
    issues.push(`无法读取 package.json：${error instanceof Error ? error.message : String(error)}。`)
  }

  const actualIndependentSpecPaths: string[] = []
  for (const release of INDEPENDENT_SPEC_RELEASES) {
    try {
      const entries = await fs.readdir(path.join(roadmapRoot, release), { withFileTypes: true })
      const prefix = `r${release.replace('.', '')}-`
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.md')) {
          actualIndependentSpecPaths.push(`${release}/${entry.name}`)
        }
      }
    } catch (error) {
      issues.push(`无法枚举 ${ROADMAP_RELATIVE_ROOT}/${release} 规格：${error instanceof Error ? error.message : String(error)}。`)
    }
  }
  actualIndependentSpecPaths.sort()

  const markdownFiles = new Map<string, { absolutePath: string; text: string }>()
  const requiredDocs = [
    'README.md',
    'PRESERVATION_MATRIX.md',
    'OLD_PLAN_CROSSWALK.md',
    '1.2/EXECUTION_GUIDE.md',
    '1.2/IMPLEMENTATION_CONTRACT.md',
    ...RELEASES.map((release) => `${release}/README.md`),
  ]
  const specPaths = [...new Set(tasks.map((task) => normalizeRoadmapRelativePath(task.spec)))]
  for (const relativePath of [...new Set([...requiredDocs, ...specPaths, ...actualIndependentSpecPaths])]) {
    const absolutePath = resolveRoadmapPath(roadmapRoot, relativePath)
    if (!absolutePath) {
      issues.push(`路线文档路径越界或无效：${relativePath}。`)
      continue
    }
    try {
      const text = await fs.readFile(absolutePath, 'utf8')
      markdownFiles.set(relativePath, { absolutePath, text })
    } catch {
      issues.push(`路线文档不存在：${ROADMAP_RELATIVE_ROOT}/${relativePath}。`)
    }
  }

  for (const [relativePath, document] of markdownFiles) {
    await validateMarkdown(
      projectRoot,
      document.absolutePath,
      `${ROADMAP_RELATIVE_ROOT}/${relativePath}`,
      document.text,
      packageScripts,
      issues,
    )
  }

  validateReleaseReadmes(tasks, markdownFiles, issues)
  validateIndependentSpecMetadata(tasks, markdownFiles, actualIndependentSpecPaths, issues)

  for (const task of tasks.filter((entry) => !hasIndependentSpecs(entry.release))) {
    const relativeSpec = normalizeRoadmapRelativePath(task.spec)
    const spec = markdownFiles.get(relativeSpec)?.text
    if (spec && !new RegExp(`^\\|\\s*\`?${escapeRegExp(task.id)}\`?\\s*\\|`, 'm').test(spec)) {
      issues.push(`${task.id} 未列在其版本 README 的任务表中。`)
    }
  }

  validatePreservationReferences(tasks, markdownFiles, issues)

  const crosswalk = markdownFiles.get('OLD_PLAN_CROSSWALK.md')?.text ?? ''
  const crosswalkCount = crosswalk ? validateCrosswalk(crosswalk, tasks, issues) : 0
  if (issues.length > 0) throw new DevelopmentRoadmapValidationError(issues)

  const releaseTaskCounts: Record<string, number> = {}
  for (const task of taskById.values()) {
    releaseTaskCounts[task.release] = (releaseTaskCounts[task.release] ?? 0) + 1
  }
  return {
    taskCount: tasks.length,
    specCount: specPaths.length,
    crosswalkCount,
    releaseTaskCounts,
    parallelFrontier,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let projectRoot = defaultProjectRoot
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--project-root') throw new Error('用法：check-development-roadmap [--project-root <path>]')
    projectRoot = path.resolve(args[1])
  }
  const report = await checkDevelopmentRoadmap(projectRoot)
  const frontier = report.parallelFrontier.length > 0 ? report.parallelFrontier.join(' + ') : '当前无可并行核心节点'
  console.log(`开发路线校验通过：${report.taskCount} 个节点，${report.specCount} 份规格，归档旧任务映射 ${report.crosswalkCount} 行；首个并行 frontier：${frontier}。`)
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
