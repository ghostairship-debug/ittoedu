import { describe, expect, it } from 'vitest'
import type { ExecutionItem } from '../../src/shared/workbench/executionEvents'
import { collapseInterruptedAttempts } from '../../src/renderer/workbench/executionTimelineModel'

let clock = 0
const item = (itemId: string, type: ExecutionItem['type'] = 'text', status?: string): ExecutionItem => {
  clock += 1
  return { taskId: 'task', runId: 'run', itemId, source: 'builtin', type, time: clock, sequence: clock, data: status ? { status } : {}, content: [] }
}
const pair = (round: string, attempt: number, status = 'interrupted') => [
  item(`${round}.attempt-${attempt}:text.delta`, 'text', status),
  item(`${round}.attempt-${attempt}:reasoning.delta`, 'reasoning', status),
]

describe('collapseInterruptedAttempts', () => {
  it('collapses interrupted attempts of one logical round into one summary card and keeps the final attempt pair', () => {
    const items = [...pair('round-a', 1), ...pair('round-a', 2), ...pair('round-a', 3, 'completed')]
    const result = collapseInterruptedAttempts(items)
    expect(result.map(entry => entry.itemId)).toEqual([
      'round-a:retry-summary',
      'round-a.attempt-3:text.delta',
      'round-a.attempt-3:reasoning.delta',
    ])
    const summary = result[0]!
    expect(summary.type).toBe('run.state')
    expect(summary.data.status).toBe('interrupted')
    expect(summary.data.label).toBe('自动重发 2 次')
    expect(summary.time).toBe(items[0]!.time)
    expect(summary.sequence).toBe(items[0]!.sequence)
  })

  it('does not merge different logical rounds', () => {
    const items = [...pair('round-a', 1), ...pair('round-b', 1), ...pair('round-a', 2, 'completed'), ...pair('round-b', 2, 'completed')]
    const result = collapseInterruptedAttempts(items)
    expect(result.map(entry => entry.itemId)).toEqual([
      'round-a:retry-summary',
      'round-b:retry-summary',
      'round-a.attempt-2:text.delta',
      'round-a.attempt-2:reasoning.delta',
      'round-b.attempt-2:text.delta',
      'round-b.attempt-2:reasoning.delta',
    ])
    expect(result[0]!.time).toBe(items[0]!.time)
    expect(result[1]!.time).toBe(items[2]!.time)
  })

  it('keeps the final attempt pair even when the whole run failed and collapses only the earlier attempts', () => {
    const items = [...pair('round-a', 1), ...pair('round-a', 2), ...pair('round-a', 3)]
    const result = collapseInterruptedAttempts(items)
    expect(result.map(entry => entry.itemId)).toEqual([
      'round-a:retry-summary',
      'round-a.attempt-3:text.delta',
      'round-a.attempt-3:reasoning.delta',
    ])
    expect(result[0]!.data.label).toBe('自动重发 2 次')
    expect(result[1]!.data.status).toBe('interrupted')
    expect(result[2]!.data.status).toBe('interrupted')
  })

  it('passes through non-attempt items and keeps partially completed attempts', () => {
    const items = [
      item('user-message', 'run.state', 'running'),
      ...pair('round-a', 1),
      item('round-a.attempt-2:text.delta', 'text', 'completed'),
      item('round-a.attempt-2:reasoning.delta', 'reasoning', 'interrupted'),
      item('round-a:usage', 'usage'),
      item('round-a:tool-call', 'tool', 'completed'),
    ]
    const result = collapseInterruptedAttempts(items)
    expect(result.map(entry => `${entry.itemId}:${entry.type}`)).toEqual([
      'user-message:run.state',
      'round-a:retry-summary:run.state',
      'round-a.attempt-2:text.delta:text',
      'round-a.attempt-2:reasoning.delta:reasoning',
      'round-a:usage:usage',
      'round-a:tool-call:tool',
    ])
    expect(result[1]!.data.label).toBe('自动重发 1 次')
  })

  it('returns the original array when nothing collapses', () => {
    const items = [item('plain-text', 'text', 'completed'), item('round-a.attempt-1:text.delta', 'text', 'completed')]
    expect(collapseInterruptedAttempts(items)).toBe(items)
  })
})
