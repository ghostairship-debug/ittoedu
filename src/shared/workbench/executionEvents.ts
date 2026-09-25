import { z } from 'zod'
import { userAnswerSchema, userQuestionViewSchema } from './userQuestion'
import { approvalDecisionSchema, approvalViewSchema } from './executionPermission'

const id = z.string().min(1).max(512)
const count = z.number().int().nonnegative()
export const executionBlobRefSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), bytes: count, mime: z.literal('text/plain;charset=utf-8') }).strict()
export type ExecutionBlobRef = z.infer<typeof executionBlobRefSchema>
export const executionDetailKeys = ['input', 'output', 'diff', 'error'] as const
const eventData = {
  text: z.string().optional(), status: z.string().min(1).max(128).optional(), label: z.string().max(2048).optional(),
  input: z.string().optional(), output: z.string().optional(), diff: z.string().optional(), error: z.string().optional(),
  documentName: z.string().max(2048).optional(), targetLabel: z.string().max(2048).optional(),
  applicationStatus: z.enum(['applied', 'unchanged', 'conflict', 'denied', 'cancelled', 'failed']).optional(),
  saveStatus: z.enum(['saving', 'saved', 'failed']).optional(),
  toolName: id.optional(), operationId: id.optional(), documentId: id.optional(), revision: count.optional(),
  jobId: id.optional(), resourceIds: z.array(id).max(1000).optional(),
  // Built-in ask_user only: the question the option card shows, then what the user actually answered.
  question: userQuestionViewSchema.optional(), answer: userAnswerSchema.optional(),
  // A modification waiting for the user's approval, then the user's actual decision.
  approval: approvalViewSchema.optional(), decision: approvalDecisionSchema.optional(),
  // Actual reported counters only. Absence is unknown, never an inferred zero or charge.
  usage: z.object({ inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(), reasoningTokens: count.optional(), cachedInputTokens: count.optional() }).strict().optional(),
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
  data: Omit<ExecutionEvent['data'], 'text' | 'textRef'>
  content: ExecutionContent[]
}
export interface ExecutionProjection { conversationId: string; cursor: number; items: ExecutionItem[] }
export const emptyExecutionProjection = (conversationId: string): ExecutionProjection => ({ conversationId, cursor: 0, items: [] })

// Non-owning lookup hints. Each lookup validates against the actual immutable array,
// so replaying or branching an older projection never observes a newer branch's item.
const itemIndexHints = new WeakMap<ExecutionProjection, Map<string, number>>()
const itemKey = (item: { runId: string; itemId: string }) => JSON.stringify([item.runId, item.itemId])
/** Pure, read-only timeline fold. No tools, documents, providers, subscriptions or run state transitions. */
export function foldExecutionEvents(previous: ExecutionProjection, events: readonly ExecutionEvent[]): ExecutionProjection {
  const state = { ...previous, items: previous.items.slice() } // Only changed items are rebuilt.
  const hints = itemIndexHints.get(previous) ?? new Map(previous.items.map((item, index) => [itemKey(item), index]))
  for (const input of events) {
    const event = executionEventSchema.parse(input)
    if (event.conversationId !== state.conversationId) throw new Error('事件不属于当前会话')
    if (event.sequence <= state.cursor) continue // A replayed page or snapshot cannot append the same content again.
    if (event.sequence !== state.cursor + 1) throw new Error('事件游标不连续，请先补拉缺失事件')
    const key = itemKey(event), hint = hints.get(key)
    const index = hint !== undefined && state.items[hint] && itemKey(state.items[hint]) === key
      ? hint : hint === undefined ? -1 : state.items.findIndex(item => itemKey(item) === key)
    const current = index < 0 ? undefined : state.items[index]
    if (current && (current.type !== event.type || current.source !== event.source || current.taskId !== event.taskId || current.parentItemId !== event.parentItemId)) throw new Error('同一运行项不能改变类型、来源或父项')
    const { text, textRef, ...data } = event.data
    const content: ExecutionContent[] = text !== undefined ? [{ kind: 'text', text }] : textRef ? [{ kind: 'blob', ref: textRef }] : []
    const item: ExecutionItem = {
      taskId: event.taskId, runId: event.runId, itemId: event.itemId, ...(event.parentItemId === undefined ? {} : { parentItemId: event.parentItemId }),
      source: event.source, type: event.type, time: event.time, sequence: event.sequence,
      // Final snapshots replace the visible text, while immutable tool parameters and
      // independently reported application/save facts survive status-only updates.
      data: { ...current?.data, ...data },
      content: event.update === 'snapshot' ? content : [...current?.content ?? [], ...content],
    }
    for (const field of executionDetailKeys) {
      if (event.data[field] !== undefined) delete item.data[`${field}Ref`]
      if (event.data[`${field}Ref`] !== undefined) delete item.data[field]
    }
    if (index < 0) { hints.set(key, state.items.length); state.items.push(item) }
    else { hints.set(key, index); state.items[index] = item }
    state.cursor = event.sequence
  }
  itemIndexHints.set(state, hints)
  return state
}
