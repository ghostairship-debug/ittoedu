import type { ExecutionItem, ExecutionProjection } from '../../shared/workbench/executionEvents'
import { USER_QUESTION_TOOL, type UserQuestionView } from '../../shared/workbench/userQuestion'
import type { ApprovalView } from '../../shared/workbench/executionPermission'

const terminal = new Set(['completed', 'failed', 'stopped', 'partial', 'interrupted', 'cancelled'])
/** A text/tool/usage item's completion does not end its containing built-in run. */
export function executionActivity(projection: ExecutionProjection) {
  const builtIn = new Set<string>(), ended = new Set<string>(), waiting = new Set<string>()
  let externalTools = 0
  for (const item of projection.items) {
    if (item.source === 'external-mcp') {
      if (item.type === 'tool' && ['running', 'executing', 'pending', 'queued', 'stopping'].includes(item.data.status ?? '')) externalTools++
      continue
    }
    if (item.type === 'document.save') continue
    builtIn.add(item.runId)
    if (item.type === 'run.end' || item.type === 'run.state' && terminal.has(item.data.status ?? '')) ended.add(item.runId)
    // run.state is one snapshot item per run, so its status is the run's current state.
    if (item.type === 'run.state') { if (item.data.status === 'waiting') waiting.add(item.runId); else waiting.delete(item.runId) }
  }
  const open = [...builtIn].filter(id => !ended.has(id))
  const waitingRuns = open.filter(id => waiting.has(id)).length, activeRuns = open.length - waitingRuns
  // A run waiting for the user's choice is open but produces nothing until answered.
  return { busy: activeRuns > 0 || externalTools > 0, activeRuns, waitingRuns, externalTools }
}

export interface PendingApproval { runId: string; callId: string; approval: ApprovalView }
/** A built-in modification waiting for the user's approval in a run that has not ended. */
export function pendingApproval(projection: ExecutionProjection): PendingApproval | null {
  const ends = executionTimelineIndex(projection).ends
  for (let index = projection.items.length - 1; index >= 0; index--) {
    const item = projection.items[index]!
    if (item.type === 'tool' && item.source === 'builtin' && item.data.approval && item.data.status === 'approval'
      && !ends.has(item.runId)) return { runId: item.runId, callId: item.itemId, approval: item.data.approval }
  }
  return null
}
export interface PendingQuestion { runId: string; callId: string; question: UserQuestionView }
/** The open ask_user question of a built-in run that has not ended. At most one per run; the latest wins. */
export function pendingQuestion(projection: ExecutionProjection): PendingQuestion | null {
  const ends = executionTimelineIndex(projection).ends
  for (let index = projection.items.length - 1; index >= 0; index--) {
    const item = projection.items[index]!
    if (item.type === 'tool' && item.source === 'builtin' && item.data.toolName === USER_QUESTION_TOOL && item.data.question
      && item.data.status === 'waiting' && !ends.has(item.runId)) return { runId: item.runId, callId: item.itemId, question: item.data.question }
  }
  return null
}

const indexes = new WeakMap<ExecutionProjection, ReturnType<typeof buildIndex>>()
function buildIndex(projection: ExecutionProjection) {
  const items = new Map<string, ExecutionItem>(), ends = new Map<string, ExecutionItem>(), commits = new Map<string, ExecutionItem>(), saves = new Map<string, ExecutionItem[]>()
  for (const item of projection.items) {
    items.set(JSON.stringify([item.runId, item.itemId]), item)
    if (item.type === 'run.end' && !ends.has(item.runId)) ends.set(item.runId, item)
    if (item.type === 'document.commit' && item.data.operationId) { const key = JSON.stringify([item.runId, item.data.operationId]); if (!commits.has(key)) commits.set(key, item) }
    if (item.type === 'document.save' && item.data.documentId) { const prior = saves.get(item.data.documentId) ?? []; prior.push(item); saves.set(item.data.documentId, prior) }
  }
  return { items, ends, commits, saves }
}
export function executionTimelineIndex(projection: ExecutionProjection) {
  let index = indexes.get(projection)
  if (!index) { index = buildIndex(projection); indexes.set(projection, index) }
  return index
}
export function executionDocumentFacts(item: ExecutionItem, projection: ExecutionProjection) {
  const index = executionTimelineIndex(projection)
  const commit = item.data.operationId ? index.commits.get(JSON.stringify([item.runId, item.data.operationId])) : undefined
  const application = item.data.applicationStatus ?? commit?.data.applicationStatus
    ?? (item.type === 'document.commit' || commit ? (commit?.data.status ?? item.data.status) : undefined)
  const documentId = item.data.documentId ?? commit?.data.documentId
  const revision = item.data.revision ?? commit?.data.revision
  const relevant = documentId && revision !== undefined
    ? index.saves.get(documentId)?.filter(candidate => candidate.data.revision !== undefined && candidate.data.revision >= revision) ?? [] : []
  // Once a revision was saved, a later failed attempt for newer edits cannot undo
  // that historical disk receipt. Before the first successful save, show the
  // latest actual attempt (saving or failed) for this revision.
  const save = relevant.some(candidate => candidate.data.saveStatus === 'saved')
    ? 'saved' : relevant.at(-1)?.data.saveStatus
  return { documentId, application, save: item.data.saveStatus ?? save }
}

const attemptPattern = /^(.+)\.attempt-(\d+):(text|reasoning)\.delta$/
/**
 * Presentation-only fold: retry attempts of one logical round leave one
 * interrupted text card plus one interrupted reasoning card per attempt.
 * Keep the final attempt's pair (whatever its status) and replace the earlier
 * interrupted pairs with a single synthesized run.state summary card. Items
 * without the attempt shape pass through untouched; rounds never merge.
 */
export function collapseInterruptedAttempts(items: readonly ExecutionItem[]): ExecutionItem[] {
  const groups = new Map<string, { index: number; attempt: number; stream: 'text' | 'reasoning' }[]>()
  items.forEach((item, index) => {
    const match = attemptPattern.exec(item.itemId)
    if (!match) return
    const key = match[1]!, entry = { index, attempt: Number(match[2]), stream: match[3] as 'text' | 'reasoning' }
    const group = groups.get(key)
    if (group) group.push(entry); else groups.set(key, [entry])
  })
  const removed = new Set<number>(), summaries: { index: number; item: ExecutionItem }[] = []
  for (const [round, group] of groups) {
    const attempts = new Map<number, { index: number; stream: 'text' | 'reasoning' }[]>()
    for (const entry of group) {
      const bucket = attempts.get(entry.attempt)
      if (bucket) bucket.push(entry); else attempts.set(entry.attempt, [entry])
    }
    const finalAttempt = Math.max(...attempts.keys())
    const collapsed: { index: number; attempt: number }[] = []
    for (const [attempt, entries] of attempts) {
      if (attempt === finalAttempt) continue
      if (entries.every(entry => items[entry.index]!.data.status === 'interrupted')) {
        for (const entry of entries) collapsed.push({ index: entry.index, attempt })
      }
    }
    if (!collapsed.length) continue
    collapsed.sort((left, right) => left.index - right.index)
    const first = items[collapsed[0]!.index]!
    const retries = new Set(collapsed.map(entry => entry.attempt)).size
    for (const entry of collapsed) removed.add(entry.index)
    summaries.push({
      index: collapsed[0]!.index,
      item: {
        taskId: first.taskId, runId: first.runId, itemId: `${round}:retry-summary`,
        source: first.source, type: 'run.state', time: first.time, sequence: first.sequence,
        data: { status: 'interrupted', label: `自动重发 ${retries} 次` }, content: [],
      },
    })
  }
  if (!summaries.length) return items as ExecutionItem[]
  const byIndex = new Map(summaries.map(summary => [summary.index, summary.item]))
  const result: ExecutionItem[] = []
  items.forEach((item, index) => {
    if (removed.has(index)) { const summary = byIndex.get(index); if (summary) result.push(summary); return }
    result.push(item)
  })
  return result
}

const sensitiveKey = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credential(?:ref)?)$/i
function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[凭据已隐藏]')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/\b[A-Za-z]:[\\/](?:[^\s"<>|]+[\\/])*([^\\/\s"<>|]+)/g, '[本地路径]/$1')
    .replace(/\/(?:Users|home)\/[^\s"<>]+/g, '[本地路径]')
}
// By-content memo for redaction. Streaming replays the same strings every
// turn, so without a cache each render runs 5 regex passes over every visible
// label/text/detail. Bounded LRU: refresh on hit, drop the oldest entry when full.
const READABLE_CACHE_LIMIT = 2000
const readableCache = new Map<string, string>()
function computeReadable(value: string): string {
  const redact = (input: unknown): unknown => {
    if (typeof input === 'string') return redactString(input)
    if (Array.isArray(input)) return input.map(redact)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, sensitiveKey.test(key) ? '[已隐藏]' : redact(child)]))
    return input
  }
  try { return JSON.stringify(redact(JSON.parse(value)), null, 2) }
  catch { return redactString(value) }
}
/** Presentation only: never interprets HTML, opens links, or replays tool arguments. */
export function readableExecutionData(value: string): string {
  const hit = readableCache.get(value)
  if (hit !== undefined) {
    readableCache.delete(value)
    readableCache.set(value, hit)
    return hit
  }
  const result = computeReadable(value)
  if (readableCache.size >= READABLE_CACHE_LIMIT) {
    const oldest = readableCache.keys().next().value
    if (oldest !== undefined) readableCache.delete(oldest)
  }
  readableCache.set(value, result)
  return result
}
