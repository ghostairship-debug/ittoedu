import { z } from 'zod'
import { userAnswerSchema, userQuestionViewSchema } from './userQuestion'
import { approvalDecisionSchema, approvalViewSchema } from './executionPermission'

const id = z.string().min(1)
const count = z.number().int().nonnegative()
export const executionBlobRefSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), bytes: count, mime: z.literal('text/plain;charset=utf-8') }).strict()
export type ExecutionBlobRef = z.infer<typeof executionBlobRefSchema>
export const executionDetailKeys = ['input', 'output', 'diff', 'error'] as const
const eventData = {
  text: z.string().optional(), status: z.string().min(1).optional(), label: z.string().optional(),
  phase: z.enum(['waiting-response', 'generating', 'tool', 'retry', 'user', 'context', 'ended']).optional(),
  requestId: id.optional(), lastReceivedAt: z.number().finite().nonnegative().optional(),
  receivedSource: z.enum(['data', 'heartbeat']).optional(), remainingGoal: z.array(z.string()).optional(),
  input: z.string().optional(), output: z.string().optional(), diff: z.string().optional(), error: z.string().optional(),
  documentName: z.string().optional(), targetLabel: z.string().optional(),
  applicationStatus: z.enum(['applied', 'unchanged', 'conflict', 'denied', 'cancelled', 'failed']).optional(),
  saveStatus: z.enum(['saving', 'saved', 'failed']).optional(),
  toolName: id.optional(), operationId: id.optional(), documentId: id.optional(), revision: count.optional(),
  jobId: id.optional(), resourceIds: z.array(id).optional(),
  /** A display reference to the original child interaction. Only that run may accept its user decision. */
  delegationRef: z.object({ runId: id, callId: id, parentRunId: id, jobId: id }).strict().optional(),
  webSources: z.array(z.object({ title: z.string(), url: z.string().min(1) }).strict()).optional(),
  // Built-in ask_user only: the question the option card shows, then what the user actually answered.
  question: userQuestionViewSchema.optional(), answer: userAnswerSchema.optional(),
  // A modification waiting for the user's approval, then the user's actual decision.
  approval: approvalViewSchema.optional(), decision: approvalDecisionSchema.optional(),
  // Actual reported counters only. Absence is unknown, never an inferred zero or charge.
  usage: z.object({ inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(), reasoningTokens: count.optional(), cachedInputTokens: count.optional(), cacheWriteInputTokens: count.optional() }).strict().optional(),
}
const envelope = {
  eventId: id, conversationId: id, taskId: id, runId: id, itemId: id, parentItemId: id.optional(),
  time: z.number().finite().nonnegative(), source: z.enum(['builtin', 'external-mcp']),
  type: z.enum(['text', 'reasoning', 'tool', 'edit', 'image', 'build', 'usage', 'document.commit', 'document.save', 'run.state', 'run.end']),
  update: z.enum(['append', 'snapshot']),
  providerPayloadRef: z.object({ id, access: z.literal('restricted-provider') }).strict().optional(),
}
export const executionEventInputSchema = z.object({ ...envelope, data: z.object(eventData).strict() }).strict()
export const executionEventSchema = z.object({ ...envelope,
  /** The sole timeline cursor: assigned durably by Store, monotonic within a conversation, not a Provider/run sequence. */
  sequence: z.number().int().positive(), data: z.object({ ...eventData, textRef: executionBlobRefSchema.optional(),
    inputRef: executionBlobRefSchema.optional(), outputRef: executionBlobRefSchema.optional(), diffRef: executionBlobRefSchema.optional(), errorRef: executionBlobRefSchema.optional(),
  }).strict().refine(data => (['text', ...executionDetailKeys] as const).every(key => data[key] === undefined || data[`${key}Ref`] === undefined), 'inline content and blob references are exclusive'),
}).strict()
export type ExecutionEventInput = z.infer<typeof executionEventInputSchema>
export type ExecutionEvent = z.infer<typeof executionEventSchema>
export interface ExecutionEventSearchInput { conversationId: string; query: string; after?: number; limit?: number }
export interface ExecutionEventSearchPage { hits: { event: ExecutionEvent; excerpt: string }[]; cursor: number; hasMore: boolean }
export interface ExecutionEventPage { events: ExecutionEvent[]; cursor: number; hasMore: boolean }
export type ExecutionContent = { kind: 'text'; text: string } | { kind: 'blob'; ref: ExecutionBlobRef }
export interface ExecutionItem {
  taskId: string; runId: string; itemId: string; parentItemId?: string
  source: ExecutionEvent['source']; type: ExecutionEvent['type']; time: number; sequence: number
  /** Derived from the first event; later snapshots must not move a conversation boundary. */
  firstTime?: number; firstSequence?: number
  data: Omit<ExecutionEvent['data'], 'text' | 'textRef'>
  content: ExecutionContent[]
}
export interface ExecutionProjection { conversationId: string; cursor: number; items: ExecutionItem[] }
export const emptyExecutionProjection = (conversationId: string): ExecutionProjection => ({ conversationId, cursor: 0, items: [] })

// Non-owning lookup hints. Each lookup validates against the actual immutable array,
// so replaying or branching an older projection never observes a newer branch's item.
const itemIndexHints = new WeakMap<ExecutionProjection, Map<string, number>>()
const itemKey = (item: { runId: string; itemId: string }) => JSON.stringify([item.runId, item.itemId])
const generations = new WeakMap<ExecutionProjection, object>()
const changes = new WeakMap<ExecutionProjection, ExecutionProjectionPlan>()
export interface ExecutionProjectionPlan {
  conversationId: string; fromCursor: number; cursor: number; fromItemCount: number; itemCount: number
  /** Opaque same-process generations distinguish branches with equal cursors/counts. */
  baseToken: object; token: object
  upserts: readonly { index: number; item: ExecutionItem; contentChange?: { replace: boolean; parts: readonly ExecutionContent[] } }[]
}
export function executionProjectionToken(projection: ExecutionProjection): object {
  let token = generations.get(projection)
  if (!token) { token = {}; generations.set(projection, token) }
  return token
}
/** Same-process hint only; it never owns a previous projection or crosses IPC. */
export function executionProjectionChange(projection: ExecutionProjection): ExecutionProjectionPlan | undefined { return changes.get(projection) }

/** Binary carries keep each adjacent inline run in geometrically decreasing chunks.
 * Text/blob order and the full UTF-16 string are unchanged; event boundaries live in the event log. */
export function appendExecutionContent(previous: readonly ExecutionContent[], added: readonly ExecutionContent[]): ExecutionContent[] {
  if (!added.length) return previous as ExecutionContent[]
  const content = previous.slice()
  for (const part of added) {
    if (part.kind === 'blob') { content.push(part); continue }
    let text = part.text
    if (!text.length && content.at(-1)?.kind === 'text') continue
    while (content.at(-1)?.kind === 'text' && (content.at(-1) as { kind: 'text'; text: string }).text.length <= text.length) {
      const prior = content.pop() as { kind: 'text'; text: string }
      text = prior.text + text
    }
    content.push({ kind: 'text', text })
  }
  return content
}

/** Stage complete changed items without publishing or copying the unchanged item array. */
export function prepareExecutionEvents(previous: ExecutionProjection, events: readonly ExecutionEvent[]): ExecutionProjectionPlan {
  const hints = itemIndexHints.get(previous) ?? new Map(previous.items.map((item, index) => [itemKey(item), index]))
  itemIndexHints.set(previous, hints)
  const updates = new Map<number, ExecutionItem>(), stagedKeys = new Map<string, number>()
  const bodyChanges = new Map<number, { replace: boolean; parts: readonly ExecutionContent[] }>()
  let cursor = previous.cursor, itemCount = previous.items.length
  for (const input of events) {
    const event = executionEventSchema.parse(input)
    if (event.conversationId !== previous.conversationId) throw new Error('事件不属于当前会话')
    if (event.sequence <= cursor) continue
    if (event.sequence !== cursor + 1) throw new Error('事件游标不连续，请先补拉缺失事件')
    const key = itemKey(event), hint = stagedKeys.get(key) ?? hints.get(key)
    const hinted = hint === undefined ? undefined : updates.get(hint) ?? previous.items[hint]
    let index = hinted && itemKey(hinted) === key ? hint! : hint === undefined ? -1 : previous.items.findIndex(item => itemKey(item) === key)
    const current = index < 0 ? undefined : updates.get(index) ?? previous.items[index]
    if (current && (current.type !== event.type || current.source !== event.source || current.taskId !== event.taskId || current.parentItemId !== event.parentItemId)) throw new Error('同一运行项不能改变类型、来源或父项')
    const { text, textRef, ...data } = event.data
    const content: ExecutionContent[] = text !== undefined ? [{ kind: 'text', text }] : textRef ? [{ kind: 'blob', ref: textRef }] : []
    const item: ExecutionItem = {
      taskId: event.taskId, runId: event.runId, itemId: event.itemId, ...(event.parentItemId === undefined ? {} : { parentItemId: event.parentItemId }),
      source: event.source, type: event.type, time: event.time, sequence: event.sequence,
      firstTime: current?.firstTime ?? current?.time ?? event.time,
      firstSequence: current?.firstSequence ?? current?.sequence ?? event.sequence,
      // Final snapshots replace the visible text, while immutable tool parameters and
      // independently reported application/save facts survive status-only updates.
      data: { ...current?.data, ...data },
      content: event.update === 'snapshot' ? content : appendExecutionContent(current?.content ?? [], content),
    }
    for (const field of executionDetailKeys) {
      if (event.data[field] !== undefined) delete item.data[`${field}Ref`]
      if (event.data[`${field}Ref`] !== undefined) delete item.data[field]
    }
    if (index < 0) index = itemCount++
    updates.set(index, item); stagedKeys.set(key, index)
    if (event.update === 'snapshot') bodyChanges.set(index, { replace: true, parts: content })
    else if (content.length) {
      const prior = bodyChanges.get(index)
      bodyChanges.set(index, { replace: prior?.replace ?? false, parts: [...prior?.parts ?? [], ...content] })
    }
    cursor = event.sequence
  }
  return { conversationId: previous.conversationId, fromCursor: previous.cursor, cursor,
    fromItemCount: previous.items.length, itemCount, baseToken: executionProjectionToken(previous), token: {},
    upserts: [...updates].map(([index, item]) => ({ index, item, ...(bodyChanges.has(index) ? { contentChange: bodyChanges.get(index)! } : {}) })) }
}

/** Explicit owned-state API. Main calls only after its append/fsync succeeds, under the existing owner. */
export function applyExecutionProjectionOwned(state: ExecutionProjection, plan: ExecutionProjectionPlan): ExecutionProjection {
  if (state.conversationId !== plan.conversationId || state.cursor !== plan.fromCursor || state.items.length !== plan.fromItemCount
    || executionProjectionToken(state) !== plan.baseToken) throw new Error('事件投影计划不属于当前代')
  const hints = itemIndexHints.get(state) ?? new Map(state.items.map((item, index) => [itemKey(item), index]))
  for (const { index, item } of plan.upserts) { state.items[index] = item; hints.set(itemKey(item), index) }
  state.cursor = plan.cursor
  itemIndexHints.set(state, hints); generations.set(state, plan.token); changes.set(state, plan)
  return state
}

/** Pure, read-only timeline fold. Old projections/branches retain their exact prior values. */
export function foldExecutionEvents(previous: ExecutionProjection, events: readonly ExecutionEvent[]): ExecutionProjection {
  const plan = prepareExecutionEvents(previous, events)
  if (plan.cursor === previous.cursor) return previous
  const state = { ...previous, items: previous.items.slice() }
  generations.set(state, plan.baseToken)
  const hints = itemIndexHints.get(previous)
  if (hints) itemIndexHints.set(state, hints)
  return applyExecutionProjectionOwned(state, plan)
}
