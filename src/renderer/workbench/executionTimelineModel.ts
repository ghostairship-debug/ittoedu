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

const sensitiveKey = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credential(?:ref)?)$/i
function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[凭据已隐藏]')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/[A-Za-z]:[\\/](?:[^\s"<>|]+[\\/])*([^\\/\s"<>|]+)/g, '[本地路径]/$1')
    .replace(/\/(?:Users|home)\/[^\s"<>]+/g, '[本地路径]')
}
/** Presentation only: never interprets HTML, opens links, or replays tool arguments. */
export function readableExecutionData(value: string): string {
  const redact = (input: unknown): unknown => {
    if (typeof input === 'string') return redactString(input)
    if (Array.isArray(input)) return input.map(redact)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, sensitiveKey.test(key) ? '[已隐藏]' : redact(child)]))
    return input
  }
  try { return JSON.stringify(redact(JSON.parse(value)), null, 2) }
  catch { return redactString(value) }
}
