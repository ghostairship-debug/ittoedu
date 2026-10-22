import type { ExecutionItem, ExecutionProjection } from './executionEvents'
import { emptyExecutionProjection, executionProjectionChange, executionProjectionToken, type ExecutionProjectionPlan } from './executionEvents'
import { ExecutionTimelineBody } from './executionTimelineBody'
import type { ExecutionTimelineBodyRequest, ExecutionTimelineEntryPage, ExecutionTimelineGroupPage,
  ExecutionTimelineGroupRequest, ExecutionTimelineItemFact, ExecutionTimelinePageRequest, ExecutionTimelineWindowItem } from './executionTimelineWindow'
import { USER_QUESTION_TOOL, type UserQuestionView } from './userQuestion'
import type { ApprovalView } from './executionPermission'
import type { ConversationMessage } from './conversations'

const terminal = new Set(['completed', 'failed', 'stopped', 'partial', 'interrupted', 'cancelled'])
/** A text/tool/usage item's completion does not end its containing built-in run. */
export function executionActivity(projection: ExecutionProjection) {
  const builtIn = new Set<string>(), ended = new Set<string>(), waiting = new Set<string>()
  const external = new Map<string, number>()
  for (const item of projection.items) {
    if (item.source === 'external-mcp') {
      if (item.type === 'run.end') ended.add(item.runId)
      if (item.type === 'tool' && ['running', 'executing', 'pending', 'queued', 'stopping'].includes(item.data.status ?? '')) external.set(item.runId, (external.get(item.runId) ?? 0) + 1)
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
  const externalTools = [...external].reduce((total, [runId, count]) => total + (ended.has(runId) ? 0 : count), 0)
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

type OrderedTimelineEntry = Exclude<TimelineEntry, { kind: 'tools' }>
type TimelineOrderSlot = { kind: 'item' | 'message'; order: number; time: number }
type ItemOrderIdentity = { runId: string; itemId: string; time: number }
type MessageOrderIdentity = { messageId: string; time: number }
const compareTimelineSlots = (left: TimelineOrderSlot, right: TimelineOrderSlot) => left.time - right.time
  || (left.kind === right.kind ? left.order - right.order : left.kind === 'message' ? -1 : 1)

/** Mounted read-only ordering cache. It retains identities/times, never old streamed bodies.
 * Body updates reuse slots; appends merge only new slots; changed history/retry shapes rebuild. */
export class ExecutionTimelineOrdering {
  private items: ItemOrderIdentity[] = []
  private messages: MessageOrderIdentity[] = []
  private slots: TimelineOrderSlot[] = []

  order(items: readonly ExecutionItem[], messages: readonly ConversationMessage[]): OrderedTimelineEntry[] {
    const nextItems = items.map(item => ({ runId: item.runId, itemId: item.itemId, time: item.firstTime ?? item.time }))
    const nextMessages = messages.map(message => ({ messageId: message.messageId, time: message.createdAt }))
    const appendOnly = this.items.length <= nextItems.length && this.messages.length <= nextMessages.length
      && this.items.every((item, index) => item.runId === nextItems[index]!.runId && item.itemId === nextItems[index]!.itemId && item.time === nextItems[index]!.time)
      && this.messages.every((message, index) => message.messageId === nextMessages[index]!.messageId && message.time === nextMessages[index]!.time)
    const itemSlots = (from: number) => nextItems.slice(from).map((item, index): TimelineOrderSlot => ({ kind: 'item', order: from + index, time: item.time }))
    const messageSlots = (from: number) => nextMessages.slice(from).map((message, index): TimelineOrderSlot => ({ kind: 'message', order: from + index, time: message.time }))
    if (appendOnly) {
      const added = [...itemSlots(this.items.length), ...messageSlots(this.messages.length)]
      if (added.length) {
        added.sort(compareTimelineSlots)
        const merged: TimelineOrderSlot[] = []
        let oldIndex = 0, newIndex = 0
        while (oldIndex < this.slots.length && newIndex < added.length)
          merged.push(compareTimelineSlots(this.slots[oldIndex]!, added[newIndex]!) <= 0 ? this.slots[oldIndex++]! : added[newIndex++]!)
        this.slots = [...merged, ...this.slots.slice(oldIndex), ...added.slice(newIndex)]
      }
    } else this.slots = [...itemSlots(0), ...messageSlots(0)].sort(compareTimelineSlots)
    this.items = nextItems; this.messages = nextMessages
    return this.slots.map((slot): OrderedTimelineEntry => slot.kind === 'item'
      ? { kind: 'item', item: items[slot.order]!, time: slot.time, order: slot.order }
      : { kind: 'message', message: messages[slot.order]!, time: slot.time, order: slot.order })
  }
}

/** Group before paging, using first appearance rather than the latest streamed update. */
export function executionTimelineEntries(projection: ExecutionProjection, messages: readonly ConversationMessage[], ordering?: ExecutionTimelineOrdering): TimelineEntry[] {
  const ends = executionTimelineIndex(projection).ends
  const items = collapseInterruptedAttempts(projection.items).filter(item => item.type !== 'run.state' || item.itemId.endsWith(':retry-summary'))
  const ordered = (ordering ?? new ExecutionTimelineOrdering()).order(items, messages)
  const result: TimelineEntry[] = []
  for (const entry of ordered) {
    if (entry.kind === 'message') { result.push(entry); continue }
    const { item } = entry
    const groupable = timelineGroupable(item, ends)
    if (!groupable) { result.push(entry); continue }
    const previous = result.at(-1)
    if (previous?.kind === 'tools' && previous.items[0]!.runId === item.runId && previous.items[0]!.source === item.source) previous.items.push(item)
    else result.push({ kind: 'tools', items: [item], key: `${item.runId}:${item.itemId}:group`, time: entry.time, order: entry.order })
  }
  return result
}
function timelineGroupable(item: ExecutionItem, ends: ReadonlyMap<string, ExecutionItem>): boolean {
  const failedEnd = ['partial', 'failed', 'interrupted'].includes(ends.get(item.runId)?.data.status ?? '')
  return !item.data.question && !item.data.approval && !(failedEnd && item.data.status === 'failed')
    && ['tool', 'edit', 'build', 'usage', 'document.commit', 'document.save', 'run.state', 'run.end'].includes(item.type)
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

type DelegationReference = NonNullable<ExecutionItem['data']['delegationRef']>
export interface PendingApproval { runId: string; callId: string; approval: ApprovalView; delegation?: DelegationReference }
/** A built-in modification waiting for the user's approval in a run that has not ended. */
export function pendingApproval(projection: ExecutionProjection): PendingApproval | null {
  const ends = executionTimelineIndex(projection).ends
  for (let index = projection.items.length - 1; index >= 0; index--) {
    const item = projection.items[index]!
    if (item.type === 'tool' && item.source === 'builtin' && item.data.approval && item.data.status === 'approval'
      && !ends.has(item.runId)) return { runId: item.data.delegationRef?.runId ?? item.runId,
        callId: item.data.delegationRef?.callId ?? item.itemId, approval: item.data.approval,
        ...(item.data.delegationRef ? { delegation: item.data.delegationRef } : {}) }
  }
  return null
}
export interface PendingQuestion { runId: string; callId: string; question: UserQuestionView; delegation?: DelegationReference }
/** The open ask_user question of a built-in run that has not ended. At most one per run; the latest wins. */
export function pendingQuestion(projection: ExecutionProjection): PendingQuestion | null {
  const ends = executionTimelineIndex(projection).ends
  for (let index = projection.items.length - 1; index >= 0; index--) {
    const item = projection.items[index]!
    if (item.type === 'tool' && item.source === 'builtin' && item.data.toolName === USER_QUESTION_TOOL && item.data.question
      && item.data.status === 'waiting' && !ends.has(item.runId)) return { runId: item.data.delegationRef?.runId ?? item.runId,
        callId: item.data.delegationRef?.callId ?? item.itemId, question: item.data.question,
        ...(item.data.delegationRef ? { delegation: item.data.delegationRef } : {}) }
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

const displayKey = (item: Pick<ExecutionItem, 'runId' | 'itemId'>) => JSON.stringify([item.runId, item.itemId])
const activeTool = (item: ExecutionItem) => item.type === 'tool' && ['running', 'executing', 'pending', 'queued', 'stopping'].includes(item.data.status ?? '')
const savedFile = (item: ExecutionItem) => item.type === 'tool' && item.data.saveStatus === 'saved' && ['file.save', 'file.write'].includes(item.data.toolName ?? '')
const entryKey = (entry: TimelineEntry) => entry.kind === 'message' ? entry.message.messageId : entry.kind === 'tools' ? entry.key : `${entry.item.runId}:${entry.item.itemId}`
type ReaderIndex = ReturnType<typeof buildIndex>
type GroupState = { entry: Extract<TimelineEntry, { kind: 'tools' }>; summary: string; files: ExecutionItem[]; facts: ToolGroupFacts }
type RunActivity = { members: number; terminal: number; waiting: Map<number, boolean> }
function sameSummaryInput(left: ExecutionItem, right: ExecutionItem): boolean {
  return left.type === right.type && left.data.status === right.data.status && left.data.label === right.data.label
    && left.data.toolName === right.data.toolName && left.data.applicationStatus === right.data.applicationStatus && left.data.operationId === right.data.operationId
}
/** Exact counters behind the existing group summary; only actual changed contributions move. */
class ToolGroupFacts {
  private items = new Map<string, ExecutionItem>()
  private modifications = new Map<string, number>()
  private contributed = new Map<string, string>()
  private callOperations = new Map<string, string>()
  private active = new Map<number, ExecutionItem>()
  private activePosition = -1
  private calls = 0
  private failures = 0
  constructor(items: readonly ExecutionItem[]) { items.forEach((item, position) => this.update(item, position)) }
  private key(item: ExecutionItem): string { return `${item.runId}:${item.itemId}` }
  private operation(item: ExecutionItem): string | undefined {
    if (item.type === 'document.commit' && (item.data.applicationStatus ?? item.data.status) === 'applied') return item.data.operationId ?? this.key(item)
    if (item.type === 'tool' && item.data.applicationStatus === 'applied') return item.data.operationId ?? this.callOperations.get(this.key(item)) ?? this.key(item)
  }
  update(item: ExecutionItem, position: number): void {
    const key = this.key(item), previous = this.items.get(key)
    this.items.set(key, item)
    if (previous && sameSummaryInput(previous, item)) { if (this.active.has(position)) this.active.set(position, item); return }
    const affected = new Set([key])
    for (const [value, direction] of [[previous, -1], [item, 1]] as const) {
      if (!value) continue
      if (value.type === 'tool') { this.calls += direction; if (value.data.status === 'failed') this.failures += direction }
      if (value.type === 'document.commit' && (value.data.applicationStatus ?? value.data.status) === 'applied'
        && value.itemId.endsWith(':commit') && value.data.operationId) {
        const call = `${value.runId}:${value.itemId.slice(0, -':commit'.length)}`
        affected.add(call)
        if (direction < 0) this.callOperations.delete(call); else this.callOperations.set(call, value.data.operationId)
      }
    }
    for (const affectedKey of affected) {
      const prior = this.contributed.get(affectedKey)
      if (prior) { const remaining = this.modifications.get(prior)! - 1; if (remaining) this.modifications.set(prior, remaining); else this.modifications.delete(prior); this.contributed.delete(affectedKey) }
      const value = this.items.get(affectedKey), operation = value && this.operation(value)
      if (operation) { this.contributed.set(affectedKey, operation); this.modifications.set(operation, (this.modifications.get(operation) ?? 0) + 1) }
    }
    if (item.type === 'tool' && ['running', 'executing', 'pending', 'queued'].includes(item.data.status ?? '')) {
      this.active.set(position, item); this.activePosition = Math.max(this.activePosition, position)
    } else {
      this.active.delete(position)
      if (this.activePosition === position) this.activePosition = Math.max(-1, ...this.active.keys())
    }
  }
  summary(): string {
    const active = this.active.get(this.activePosition)
    return [this.calls ? `${this.calls} 次工具调用` : '执行记录', this.modifications.size ? `${this.modifications.size} 项修改` : '',
      active ? `正在${active.data.label || active.data.toolName || '执行'}` : '', this.failures ? `${this.failures} 次调用有错误` : ''].filter(Boolean).join(' · ')
  }
}

/** One current read model owned by an EventStore conversation or a mounted view.
 * It accepts real fold generations, retains no projection history, and emits explicit display windows. */
export class ExecutionTimelineReadModel {
  private current = emptyExecutionProjection('')
  private token: object = executionProjectionToken(this.current)
  private messages: readonly ConversationMessage[] = []
  private index: ReaderIndex = buildIndex(this.current)
  private entries: TimelineEntry[] = []
  private positions = new Map<string, { entry: TimelineEntry; position?: number }>()
  private groups = new Map<string, GroupState>()
  private bodies = new Map<string, ExecutionTimelineBody>()
  private visibleEntryBodies = new Set<string>()
  private visibleGroupBodies = new Map<string, Set<string>>()
  private bodyOwners = new Set<string>()
  private runs = new Map<string, RunActivity>()
  private external = new Map<string, number>()
  private externalEnds = new Map<string, number>()
  private activityValue = { busy: false, activeRuns: 0, waitingRuns: 0, externalTools: 0 }
  private statusCandidates = new Map<number, ExecutionItem>()
  private fallbackCandidates = new Map<number, ExecutionItem>()
  private questions = new Map<number, ExecutionItem>()
  private approvals = new Map<number, ExecutionItem>()
  private statusDirty = true
  private statusValue: string | null = null
  private endBuckets = new Map<string, Map<number, ExecutionItem>>()
  private commitBuckets = new Map<string, Map<number, ExecutionItem>>()
  private runCommits = new Map<string, Map<number, ExecutionItem>>()
  private saveBuckets = new Map<string, Map<number, ExecutionItem>>()
  private docVersions = new Map<string, number>()
  private operationVersions = new Map<string, number>()
  private factCache = new Map<string, { signature: string; fact: ExecutionTimelineItemFact }>()

  constructor(projection?: ExecutionProjection, messages: readonly ConversationMessage[] = []) { if (projection) this.reset(projection, messages) }
  get cursor(): number { return this.current.cursor }
  get conversationId(): string { return this.current.conversationId }
  /** Borrowed current read view, never a historic projection snapshot. */
  timelineEntries(): readonly TimelineEntry[] { return this.entries }
  activity() { return { ...this.activityValue } }
  currentStatus(): string | null { return this.status() }
  itemFact(item: ExecutionItem): ExecutionTimelineItemFact { return this.fact(item) }
  itemBody(item: ExecutionItem) { return this.body(item).window(this.current.cursor) }
  groupInfo(key: string) { const group = this.groups.get(key); return group ? { summary: group.summary, files: group.files } : undefined }
  reset(projection: ExecutionProjection, messages: readonly ConversationMessage[] = []): this {
    this.current = { conversationId: projection.conversationId, cursor: projection.cursor, items: projection.items.slice() }
    this.token = executionProjectionToken(projection); this.messages = messages
    this.index = buildIndex(this.current); indexes.set(this.current, this.index)
    this.bodies.clear(); this.visibleEntryBodies.clear(); this.visibleGroupBodies.clear(); this.bodyOwners.clear()
    this.runs.clear(); this.external.clear(); this.externalEnds.clear(); this.endBuckets.clear(); this.commitBuckets.clear(); this.runCommits.clear(); this.saveBuckets.clear()
    this.docVersions.clear(); this.operationVersions.clear(); this.factCache.clear()
    this.statusCandidates.clear(); this.fallbackCandidates.clear(); this.questions.clear(); this.approvals.clear()
    this.activityValue = { busy: false, activeRuns: 0, waitingRuns: 0, externalTools: 0 }
    projection.items.forEach((item, index) => {
      this.activityChange(undefined, item, index); this.statusItem(item, index)
      // buildIndex already derived the complete first/max/ordered facts once. Seed
      // mutation buckets directly; replaying incremental recomputation here would
      // sort every prefix of a long same-document save history during a cold read.
      if (item.type === 'run.end') this.bucket(this.endBuckets, item.runId, index, item)
      if (item.type === 'document.commit') {
        if (item.data.operationId) this.bucket(this.commitBuckets, JSON.stringify([item.runId, item.data.operationId]), index, item)
        this.bucket(this.runCommits, item.runId, index, item)
      }
      if (item.type === 'document.save' && item.data.documentId) this.bucket(this.saveBuckets, item.data.documentId, index, item)
    })
    this.statusDirty = true; this.rebuildEntries()
    return this
  }
  update(projection: ExecutionProjection, messages: readonly ConversationMessage[] = this.messages): this {
    const token = executionProjectionToken(projection)
    if (token === this.token && messages === this.messages) return this
    const plan = executionProjectionChange(projection)
    if (plan && plan.baseToken === this.token && plan.conversationId === this.current.conversationId && messages === this.messages) this.apply(plan)
    else this.reset(projection, messages)
    return this
  }
  apply(plan: ExecutionProjectionPlan): this {
    if (plan.baseToken !== this.token || plan.conversationId !== this.current.conversationId || plan.fromCursor !== this.current.cursor
      || plan.fromItemCount !== this.current.items.length) throw new Error('时间线读模型不属于事件计划的基线')
    let rebuild = false
    for (const change of plan.upserts) {
      const { index, item } = change, previous = this.current.items[index]
      this.current.items[index] = item
      this.index.items.set(displayKey(item), item)
      this.bodies.get(displayKey(item))?.update(change)
      this.activityChange(previous, item, index)
      this.bucketItem(previous, item, index)
      this.statusItem(item, index)
      const place = this.positions.get(displayKey(item))
      const retryShape = attemptPattern.test(item.itemId) && (!previous || previous.data.status !== item.data.status)
      const groupShape = previous && (Boolean(previous.data.question) !== Boolean(item.data.question) || Boolean(previous.data.approval) !== Boolean(item.data.approval)
        || (previous.data.status === 'failed') !== (item.data.status === 'failed'))
      const failedEnd = (status?: string) => ['partial', 'failed', 'interrupted'].includes(status ?? '')
      if (retryShape || groupShape || item.type === 'run.end' && failedEnd(previous?.data.status) !== failedEnd(item.data.status)
        || previous && (previous.firstTime ?? previous.time) !== (item.firstTime ?? item.time)) rebuild = true
      else if (!previous) { if (!this.appendItem(item, index)) rebuild = true }
      else if (place?.entry.kind === 'item') place.entry.item = item
      else if (place?.entry.kind === 'tools') {
        const group = this.groups.get(place.entry.key)!
        group.entry.items[place.position!] = item
        group.facts.update(item, place.position!); group.summary = group.facts.summary()
        if (savedFile(previous) || savedFile(item)) {
          const fileIndex = group.files.findIndex(file => displayKey(file) === displayKey(item))
          if (savedFile(item)) { if (fileIndex >= 0) group.files[fileIndex] = item; else group.files = group.entry.items.filter(savedFile) }
          else if (fileIndex >= 0) group.files.splice(fileIndex, 1)
        }
      }
    }
    this.current.cursor = plan.cursor; this.token = plan.token
    if (rebuild) this.rebuildEntries()
    return this
  }
  /** Replace the explicitly selected authoritative user-message window. */
  setMessages(messages: readonly ConversationMessage[]): this {
    if (messages !== this.messages) { this.messages = messages; this.rebuildEntries() }
    return this
  }
  private rebuildEntries(): void {
    this.entries = executionTimelineEntries({ ...this.current, items: this.current.items.filter(item => item.type !== 'usage') }, this.messages)
    this.positions.clear(); this.groups.clear()
    for (const entry of this.entries) {
      if (entry.kind === 'item') this.positions.set(displayKey(entry.item), { entry })
      else if (entry.kind === 'tools') {
        const facts = new ToolGroupFacts(entry.items)
        this.groups.set(entry.key, { entry, summary: facts.summary(), files: entry.items.filter(savedFile), facts })
        entry.items.forEach((item, position) => this.positions.set(displayKey(item), { entry, position }))
      }
    }
  }
  private appendItem(item: ExecutionItem, order: number): boolean {
    if (item.type === 'usage' || item.type === 'run.state') return true
    const previous = this.entries.at(-1)
    const lastTime = previous?.kind === 'tools' ? (previous.items.at(-1)!.firstTime ?? previous.items.at(-1)!.time) : previous?.time
    const time = item.firstTime ?? item.time
    if (lastTime !== undefined && time < lastTime) return false
    const key = displayKey(item)
    if (timelineGroupable(item, this.index.ends)) {
      if (previous?.kind === 'tools' && previous.items[0]!.runId === item.runId && previous.items[0]!.source === item.source) {
        const group = this.groups.get(previous.key)!, position = previous.items.length
        previous.items.push(item); group.facts.update(item, position); group.summary = group.facts.summary()
        if (savedFile(item)) group.files.push(item)
        this.positions.set(key, { entry: previous, position })
      } else {
        const entry: Extract<TimelineEntry, { kind: 'tools' }> = { kind: 'tools', key: `${item.runId}:${item.itemId}:group`, time, order, items: [item] }
        const facts = new ToolGroupFacts(entry.items)
        this.entries.push(entry); this.groups.set(entry.key, { entry, summary: facts.summary(), files: savedFile(item) ? [item] : [], facts })
        this.positions.set(key, { entry, position: 0 })
      }
    } else {
      const entry: TimelineEntry = { kind: 'item', item, time, order }
      this.entries.push(entry); this.positions.set(key, { entry })
    }
    return true
  }
  private runClass(run: RunActivity): 'activeRuns' | 'waitingRuns' | undefined {
    if (!run.members || run.terminal) return
    let last = -1, waiting = false
    for (const [index, value] of run.waiting) if (index > last) { last = index; waiting = value }
    return waiting ? 'waitingRuns' : 'activeRuns'
  }
  private activityChange(previous: ExecutionItem | undefined, item: ExecutionItem, index: number): void {
    if (previous && previous.source === item.source && previous.type === item.type && previous.data.status === item.data.status) return
    for (const [value, direction] of [[previous, -1], [item, 1]] as const) {
      if (!value) continue
      const externalBefore = this.externalEnds.get(value.runId) ? 0 : this.external.get(value.runId) ?? 0
      if (value.type === 'run.end') this.externalEnds.set(value.runId, (this.externalEnds.get(value.runId) ?? 0) + direction)
      if (value.source === 'external-mcp' && activeTool(value)) this.external.set(value.runId, (this.external.get(value.runId) ?? 0) + direction)
      const externalAfter = this.externalEnds.get(value.runId) ? 0 : this.external.get(value.runId) ?? 0
      this.activityValue.externalTools += externalAfter - externalBefore
      if (value.source === 'external-mcp') continue
      if (value.type === 'document.save' || value.type === 'usage') continue
      const run = this.runs.get(value.runId) ?? { members: 0, terminal: 0, waiting: new Map<number, boolean>() }
      const before = this.runClass(run); if (before) this.activityValue[before]--
      run.members += direction
      if (value.type === 'run.end' || value.type === 'run.state' && terminal.has(value.data.status ?? '')) run.terminal += direction
      if (value.type === 'run.state') { if (direction < 0) run.waiting.delete(index); else run.waiting.set(index, value.data.status === 'waiting') }
      this.runs.set(value.runId, run)
      const after = this.runClass(run); if (after) this.activityValue[after]++
    }
    this.activityValue.busy = this.activityValue.activeRuns > 0 || this.activityValue.externalTools > 0
  }
  private statusItem(item: ExecutionItem, index: number): void {
    if (item.type === 'run.state' || item.type === 'tool') {
      if (item.type === 'run.state' && !terminal.has(item.data.status ?? '') || activeTool(item)) this.statusCandidates.set(index, item)
      else this.statusCandidates.delete(index)
      this.statusDirty = true
    }
    if (item.type === 'run.state' || item.type === 'run.end') { this.fallbackCandidates.set(index, item); this.statusDirty = true }
    if (item.type === 'tool') {
      if (item.source === 'builtin' && item.data.question && item.data.toolName === USER_QUESTION_TOOL && item.data.status === 'waiting') this.questions.set(index, item)
      else this.questions.delete(index)
      if (item.source === 'builtin' && item.data.approval && item.data.status === 'approval') this.approvals.set(index, item)
      else this.approvals.delete(index)
    }
  }
  private bucket(map: Map<string, Map<number, ExecutionItem>>, key: string, index: number, item?: ExecutionItem): Map<number, ExecutionItem> {
    const values = map.get(key) ?? new Map<number, ExecutionItem>()
    if (item) values.set(index, item); else values.delete(index)
    if (values.size) map.set(key, values); else map.delete(key)
    return values
  }
  private first(values: Map<number, ExecutionItem>): ExecutionItem | undefined {
    let first = Infinity, result: ExecutionItem | undefined
    for (const [index, item] of values) if (index < first) { first = index; result = item }
    return result
  }
  private bucketItem(previous: ExecutionItem | undefined, item: ExecutionItem, position: number): void {
    if (item.type === 'run.end') {
      const values = this.bucket(this.endBuckets, item.runId, position, item)
      this.index.ends.set(item.runId, this.first(values)!)
    }
    if (item.type === 'document.commit') {
      const keys = new Set([previous?.data.operationId, item.data.operationId].filter((id): id is string => Boolean(id)).map(id => JSON.stringify([item.runId, id])))
      for (const key of keys) {
        const values = this.bucket(this.commitBuckets, key, position, key === JSON.stringify([item.runId, item.data.operationId]) ? item : undefined)
        const first = this.first(values); if (first) this.index.commits.set(key, first); else this.index.commits.delete(key)
        this.operationVersions.set(key, (this.operationVersions.get(key) ?? 0) + 1)
      }
      const values = this.bucket(this.runCommits, item.runId, position, item)
      this.index.runCommitSequences.set(item.runId, Math.max(...[...values.values()].map(value => value.sequence)))
    }
    if (item.type === 'document.save') {
      for (const id of new Set([previous?.data.documentId, item.data.documentId].filter((id): id is string => Boolean(id)))) {
        const values = this.bucket(this.saveBuckets, id, position, id === item.data.documentId ? item : undefined)
        this.index.saves.set(id, [...values].sort(([left], [right]) => left - right).map(([, value]) => value))
        this.docVersions.set(id, (this.docVersions.get(id) ?? 0) + 1)
      }
    }
  }
  private status(): string | null {
    if (!this.statusDirty) return this.statusValue
    let active: ExecutionItem | undefined, fallback: ExecutionItem | undefined
    for (const item of this.statusCandidates.values()) if (!this.index.ends.has(item.runId) && (!active || item.sequence > active.sequence)) active = item
    for (const item of this.fallbackCandidates.values()) if (!fallback || item.sequence > fallback.sequence) fallback = item
    // Reuse the existing formatter on the small set of live candidates/current end.
    const items = [...(active ? [active] : fallback ? [fallback] : [])]
    const end = (active ?? fallback) && this.index.ends.get((active ?? fallback)!.runId)
    if (end && !items.includes(end)) items.push(end)
    this.statusValue = currentExecutionStatus({ conversationId: this.current.conversationId, cursor: this.current.cursor, items })
    this.statusDirty = false
    return this.statusValue
  }
  private pending<T>(values: Map<number, ExecutionItem>, make: (item: ExecutionItem) => T): T | null {
    let last = -1, result: T | null = null
    for (const [position, item] of values) if (!this.index.ends.has(item.runId) && position > last) { last = position; result = make(item) }
    return result
  }
  private fact(item: ExecutionItem): ExecutionTimelineItemFact {
    const key = displayKey(item), operation = item.data.operationId ? JSON.stringify([item.runId, item.data.operationId]) : ''
    const commit = operation ? this.index.commits.get(operation) : undefined, documentId = item.data.documentId ?? commit?.data.documentId
    const end = this.index.ends.get(item.runId), parent = item.parentItemId ? this.index.items.get(JSON.stringify([item.runId, item.parentItemId])) : undefined
    const signature = JSON.stringify([item.data.documentId, item.data.revision, item.data.applicationStatus, item.data.saveStatus, item.data.operationId,
      item.type, item.data.status, this.operationVersions.get(operation), this.docVersions.get(documentId ?? ''), Boolean(end), end?.data.status,
      parent?.type, parent?.data.label, this.index.runCommitSequences.get(item.runId)])
    const cached = this.factCache.get(key); if (cached?.signature === signature) return cached.fact
    const facts = executionDocumentFacts(item, this.current)
    const fact = { runId: item.runId, itemId: item.itemId, ...facts, ended: Boolean(end), endStatus: end?.data.status,
      ...(parent ? { parent: { type: parent.type, label: parent.data.label } } : {}), runCommitSequence: this.index.runCommitSequences.get(item.runId) }
    this.factCache.set(key, { signature, fact }); return fact
  }
  private body(item: ExecutionItem): ExecutionTimelineBody {
    const key = displayKey(item)
    if (!this.bodyOwners.has(key)) return new ExecutionTimelineBody(item)
    let body = this.bodies.get(key)
    if (!body) { body = new ExecutionTimelineBody(item); this.bodies.set(key, body) }
    return body
  }
  private refreshBodyOwners(): void {
    this.bodyOwners = new Set([...this.visibleEntryBodies, ...[...this.visibleGroupBodies.values()].flatMap(keys => [...keys])])
    for (const key of this.bodies.keys()) if (!this.bodyOwners.has(key)) this.bodies.delete(key)
  }
  private windowItem(item: ExecutionItem): ExecutionTimelineWindowItem {
    const { content: _content, ...metadata } = item
    return { ...metadata, body: this.body(item).window(this.current.cursor) }
  }
  readBody(input: ExecutionTimelineBodyRequest) {
    const item = this.index.items.get(displayKey(input))
    if (!item) throw new RangeError('运行项不存在')
    return this.body(item).read(this.current.cursor, input)
  }
  groupPage(input: ExecutionTimelineGroupRequest): ExecutionTimelineGroupPage {
    const group = this.groups.get(input.key)
    if (!group) throw new RangeError('工具组不存在或已因实际重试分组变化，请刷新当前窗口')
    const { entry } = group, first = entry.items[0]!
    const itemStart = Math.min(entry.items.length, Math.max(0, Math.floor(input.itemStart ?? 0))), fileStart = Math.min(group.files.length, Math.max(0, Math.floor(input.fileStart ?? 0)))
    const selected = entry.items.slice(itemStart, itemStart + Math.max(1, Math.floor(input.itemLimit ?? 100)))
    const files = group.files.slice(fileStart, fileStart + Math.max(1, Math.floor(input.fileLimit ?? 100)))
    const visible = new Map([...selected, ...files].map(item => [displayKey(item), item]))
    if (this.visibleGroupBodies.has(input.key)) {
      this.visibleGroupBodies.set(input.key, new Set(visible.keys())); this.refreshBodyOwners()
    }
    return { kind: 'tools', cursor: this.current.cursor, key: entry.key, time: entry.time, order: entry.order, runId: first.runId, firstItemId: first.itemId, source: first.source,
      summary: group.summary, itemCount: entry.items.length, fileCount: group.files.length,
      itemStart, itemEnd: itemStart + selected.length, items: selected.map(item => this.windowItem(item)),
      fileStart, fileEnd: fileStart + files.length, files: files.map(item => this.windowItem(item)), itemFacts: [...visible.values()].map(item => this.fact(item)) }
  }
  entryPage(input: ExecutionTimelinePageRequest = {}): ExecutionTimelineEntryPage {
    const total = this.entries.length, limit = Math.max(1, Math.floor(input.limit ?? 100))
    const anchor = input.anchorKey ? this.entries.findIndex(entry => entryKey(entry) === input.anchorKey) : -1
    const start = Math.max(0, Math.min(total, anchor >= 0 ? anchor : Math.floor(input.start ?? Math.max(0, total - limit))))
    const selected = this.entries.slice(start, start + limit), itemFacts: ExecutionTimelineItemFact[] = []
    this.visibleEntryBodies = new Set(selected.filter(entry => entry.kind === 'item').map(entry => displayKey(entry.item)))
    const groupKeys = new Set(selected.filter(entry => entry.kind === 'tools').map(entry => entry.key))
    for (const key of this.visibleGroupBodies.keys()) if (!groupKeys.has(key)) this.visibleGroupBodies.delete(key)
    for (const key of groupKeys) if (!this.visibleGroupBodies.has(key)) this.visibleGroupBodies.set(key, new Set())
    this.refreshBodyOwners()
    const entries = selected.map(entry => {
      if (entry.kind === 'message') return entry
      if (entry.kind === 'tools') {
        const page = this.groupPage({ key: entry.key, ...input.groups?.[entry.key] })
        itemFacts.push(...page.itemFacts)
        return page
      }
      itemFacts.push(this.fact(entry.item))
      return { ...entry, item: this.windowItem(entry.item) }
    })
    return { conversationId: this.current.conversationId, cursor: this.current.cursor, start, end: start + entries.length, total,
      anchorKey: this.entries[start] ? entryKey(this.entries[start]!) : undefined, entries, itemFacts,
      activity: { ...this.activityValue }, status: this.status(),
      pendingQuestion: this.pending(this.questions, item => ({ runId: item.data.delegationRef?.runId ?? item.runId, callId: item.data.delegationRef?.callId ?? item.itemId,
        question: item.data.question!, ...(item.data.delegationRef ? { delegation: item.data.delegationRef } : {}) })),
      pendingApproval: this.pending(this.approvals, item => ({ runId: item.data.delegationRef?.runId ?? item.runId, callId: item.data.delegationRef?.callId ?? item.itemId,
        approval: item.data.approval!, ...(item.data.delegationRef ? { delegation: item.data.delegationRef } : {}) })),
      ...(input.includeEndedRuns ? { endedRunIds: [...this.index.ends.keys()] } : {}) }
  }
}


