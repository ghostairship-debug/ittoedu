// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimelineOrdering, executionTimelineEntries } from '../../src/renderer/workbench/executionTimelineModel'
import type { ExecutionItem, ExecutionProjection } from '../../src/shared/workbench/executionEvents'
import type { ConversationMessage } from '../../src/shared/workbench/conversations'

afterEach(() => vi.restoreAllMocks())
const item = (index: number, time = index): ExecutionItem => ({ taskId: 'task', runId: 'run', itemId: `item-${index}`,
  source: 'builtin', type: 'text', time, sequence: index + 1, data: {}, content: [] })
const message = (messageId: string, createdAt: number): ConversationMessage => ({ messageId, role: 'user', text: messageId, createdAt, attachmentIds: [] })

it('reuses sorted identities for body updates and merges only appended slots with unchanged tie order', () => {
  const ordering = new ExecutionTimelineOrdering(), items = Array.from({ length: 1000 }, (_, index) => item(index))
  const messages = [message('before', -1), message('tie', 0)]
  const sort = vi.spyOn(Array.prototype, 'sort')
  ordering.order(items, messages)
  const calls = sort.mock.calls.length
  const updated = [...items.slice(0, -1), { ...items[999]!, time: 2000, firstTime: 999, content: [{ kind: 'text' as const, text: '最新流式正文' }] }]
  const sameOrder = ordering.order(updated, messages)
  expect(sort.mock.calls.length).toBe(calls)
  expect(sameOrder.at(-1)).toMatchObject({ kind: 'item', item: updated[999] })
  const appended = [...updated, item(1000, .5)], laterMessages = [...messages, message('same-late-time', .5)]
  const merged = ordering.order(appended, laterMessages)
  expect((sort.mock.contexts.at(-1) as unknown[]).length).toBe(2)
  const atHalf = merged.filter(entry => entry.time === .5)
  expect(atHalf.map(entry => entry.kind)).toEqual(['message', 'item'])
  expect(merged).toEqual(new ExecutionTimelineOrdering().order(appended, laterMessages))
})

it('rebuilds changed history and retry-collapse shapes without keeping obsolete bodies', () => {
  const ordering = new ExecutionTimelineOrdering()
  let projection: ExecutionProjection = { conversationId: 'conversation', cursor: 4, items: [
    { ...item(0), itemId: 'round.attempt-1:text.delta', data: { status: 'interrupted' } },
    { ...item(1), itemId: 'round.attempt-1:reasoning.delta', type: 'reasoning', data: { status: 'interrupted' } },
    { ...item(2), itemId: 'round.attempt-2:text.delta', data: { status: 'running' } },
    { ...item(3), itemId: 'round.attempt-2:reasoning.delta', type: 'reasoning', data: { status: 'running' } },
  ] }
  expect(executionTimelineEntries(projection, [], ordering)).toEqual(executionTimelineEntries(projection, []))
  projection = { ...projection, cursor: 6, items: [...projection.items.slice(0, 2),
    { ...projection.items[2]!, data: { status: 'interrupted' } }, { ...projection.items[3]!, data: { status: 'interrupted' } },
    { ...item(4), itemId: 'round.attempt-3:text.delta', data: { status: 'completed' } },
    { ...item(5), itemId: 'round.attempt-3:reasoning.delta', type: 'reasoning', data: { status: 'completed' } },
  ] }
  expect(executionTimelineEntries(projection, [], ordering)).toEqual(executionTimelineEntries(projection, []))
  const earlier = [message('earlier', -10)]
  expect(executionTimelineEntries({ ...projection, items: projection.items.slice(2) }, earlier, ordering))
    .toEqual(executionTimelineEntries({ ...projection, items: projection.items.slice(2) }, earlier))
})
