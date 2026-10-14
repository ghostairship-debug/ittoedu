import type { ExecutionItem, ExecutionProjection } from '../../shared/workbench/executionEvents'
import { USER_QUESTION_TOOL, type UserQuestionView } from '../../shared/workbench/userQuestion'
import type { ApprovalView } from '../../shared/workbench/executionPermission'
import type { ConversationMessage } from '../../shared/workbench/conversations'

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

/** The current phase comes from the complete projection, independently of history pagination. */
export function currentExecutionStatus(projection: ExecutionProjection): string | null {
  const ends = executionTimelineIndex(projection).ends
  const active = projection.items.filter(item => !ends.has(item.runId) && (item.type === 'run.state' && !terminal.has(item.data.status ?? '')
    || item.type === 'tool' && ['running', 'executing', 'pending', 'queued', 'stopping'].includes(item.data.status ?? '')))
    .sort((left, right) => right.sequence - left.sequence)[0]
  if (active?.type === 'tool') return `${active.source === 'external-mcp' ? '外部工具' : '工具'}执行中${active.data.label || active.data.toolName ? ` · ${active.data.label || active.data.toolName}` : ''}`
  const current = active ?? projection.items.filter(item => item.type === 'run.state' || item.type === 'run.end')
    .sort((left, right) => right.sequence - left.sequence)[0]
  if (!current) return null
  const end = executionTimelineIndex(projection).ends.get(current.runId)
  const item = end ?? current
  if (item.type === 'run.end' || terminal.has(item.data.status ?? '')) {
    return item.data.status === 'completed' ? '本轮已结束'
      : item.data.label || ({ partial: '部分完成', failed: '已中断', interrupted: '已中断', stopped: '已停止', cancelled: '已停止' } as Record<string, string>)[item.data.status ?? ''] || '本轮已结束'
  }
  const phase = item.data.phase
  const labels = { 'waiting-response': '等待模型响应', generating: '正在生成／思考', tool: '工具执行中', retry: '等待重试', user: '等待你的回答', context: '正在整理上下文', ended: '本轮已结束' }
  const label = phase ? labels[phase] : item.data.label || (item.data.status === 'waiting' ? '等待你的回答' : '等待模型响应')
  return phase === 'waiting-response' && item.data.lastReceivedAt !== undefined
    ? `${label} · 最近收到${item.data.receivedSource === 'heartbeat' ? '服务心跳' : '服务数据'}` : label
}

export type TimelineEntry =
  | { kind: 'item'; item: ExecutionItem; time: number; order: number }
  | { kind: 'message'; message: ConversationMessage; time: number; order: number }
  | { kind: 'tools'; items: ExecutionItem[]; key: string; time: number; order: number }

/** Group before paging, using first appearance rather than the latest streamed update. */
export function executionTimelineEntries(projection: ExecutionProjection, messages: readonly ConversationMessage[]): TimelineEntry[] {
  const ends = executionTimelineIndex(projection).ends
  const ordered = [
    ...collapseInterruptedAttempts(projection.items).filter(item => item.type !== 'run.state' || item.itemId.endsWith(':retry-summary'))
      .map((item, order) => ({ kind: 'item' as const, item, time: item.firstTime ?? item.time, order })),
    ...messages.map((message, order) => ({ kind: 'message' as const, message, time: message.createdAt, order })),
  ].sort((left, right) => left.time - right.time || (left.kind === right.kind ? left.order - right.order : left.kind === 'message' ? -1 : 1))
  const result: TimelineEntry[] = []
  for (const entry of ordered) {
    if (entry.kind === 'message') { result.push(entry); continue }
    const { item } = entry
    const interaction = item.data.question || item.data.approval
    const failedEnd = ['partial', 'failed', 'interrupted'].includes(ends.get(item.runId)?.data.status ?? '')
    const groupable = !interaction && !(failedEnd && item.data.status === 'failed')
      && ['tool', 'edit', 'build', 'usage', 'document.commit', 'document.save', 'run.state'].includes(item.type)
    if (!groupable) { result.push(entry); continue }
    const previous = result.at(-1)
    if (previous?.kind === 'tools' && previous.items[0]!.runId === item.runId && previous.items[0]!.source === item.source) previous.items.push(item)
    else result.push({ kind: 'tools', items: [item], key: `${item.runId}:${item.itemId}:group`, time: entry.time, order: entry.order })
  }
  return result
}

export function toolGroupSummary(items: readonly ExecutionItem[]): string {
  const calls = items.filter(item => item.type === 'tool')
  const commits = items.filter(item => item.type === 'document.commit' && (item.data.applicationStatus ?? item.data.status) === 'applied')
  const callOperations = new Map(commits.filter(item => item.itemId.endsWith(':commit') && item.data.operationId)
    .map(item => [`${item.runId}:${item.itemId.slice(0, -':commit'.length)}`, item.data.operationId!]))
  const modifications = new Set([...commits, ...calls.filter(item => item.data.applicationStatus === 'applied')]
    .map(item => item.data.operationId ?? callOperations.get(`${item.runId}:${item.itemId}`) ?? `${item.runId}:${item.itemId}`))
  const active = calls.findLast(item => ['running', 'executing', 'pending', 'queued'].includes(item.data.status ?? ''))
  const failed = calls.filter(item => item.data.status === 'failed').length
  return [calls.length ? `${calls.length} 次工具调用` : '执行记录', modifications.size ? `${modifications.size} 项修改` : '',
    active ? `正在${active.data.label || active.data.toolName || '执行'}` : '', failed ? `${failed} 次调用有错误` : ''].filter(Boolean).join(' · ')
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
  const runCommitSequences = new Map<string, number>()
  for (const item of projection.items) {
    items.set(JSON.stringify([item.runId, item.itemId]), item)
    if (item.type === 'run.end' && !ends.has(item.runId)) ends.set(item.runId, item)
    if (item.type === 'document.commit' && item.data.operationId) {
      const key = JSON.stringify([item.runId, item.data.operationId]); if (!commits.has(key)) commits.set(key, item)
      runCommitSequences.set(item.runId, Math.max(runCommitSequences.get(item.runId) ?? 0, item.sequence))
    }
    if (item.type === 'document.save' && item.data.documentId) { const prior = saves.get(item.data.documentId) ?? []; prior.push(item); saves.set(item.data.documentId, prior) }
  }
  return { items, ends, commits, saves, runCommitSequences }
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
