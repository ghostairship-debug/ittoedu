import { expect, it, vi } from 'vitest'
import { FairWorkQueue } from '../../src/main/workbench/FairWorkQueue'
import { conflictsWithUnresolvedEffects } from '../../src/main/workbench/execution/executionEffectScope'
import { httpFailureKind } from '../../src/main/workbench/providers/providerHttpFailure'
import { waitForGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'

it('queues the third caller FIFO, removes cancelled waiters, and releases a slot exactly once', async () => {
  const queue = new FairWorkQueue(2), first = await queue.acquire(), second = await queue.acquire()
  const abort = new AbortController()
  const cancelled = queue.acquire(abort.signal).then(() => 'granted', () => 'cancelled')
  const granted = vi.fn(), next = queue.acquire().then(release => { granted(); return release })
  await Promise.resolve(); expect(granted).not.toHaveBeenCalled()
  abort.abort(); expect(await cancelled).toBe('cancelled')
  first(); first(); const third = await next
  expect(granted).toHaveBeenCalledTimes(1); second(); third()
  const last = await queue.acquire(); last()
})
it('keeps same-document unknown splices blocked but allows independent documents and native objects', () => {
  const range = { documentId: 'A', target: { kind: 'markdown-range' as const, from: 0, to: 5 } }
  const effects = [{ names: ['text.replace'], targets: [range] }]
  expect(conflictsWithUnresolvedEffects(effects, ['text.replace'], [{ ...range, documentId: 'B' }])).toBe(false)
  expect(conflictsWithUnresolvedEffects(effects, ['text.replace'], [{ ...range, target: { ...range.target, from: 100, to: 110 } }])).toBe(true)
  expect(conflictsWithUnresolvedEffects(effects, ['text.replace'], undefined)).toBe(true)
  const object = { documentId: 'A', target: { kind: 'course-object' as const, locationId: 'page', itemId: 'one' } }
  expect(conflictsWithUnresolvedEffects([{ names: ['native.modify'], targets: [object] }], ['native.modify'], [{ ...object, target: { ...object.target, itemId: 'two' } }])).toBe(false)
})
it.each([400, 402, 403, 429])('classifies declared quota at HTTP %i without echoing provider messages', async status => {
  const response = new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'secret should not escape' } }), { status, headers: { 'Content-Type': 'application/json' } })
  expect(await httpFailureKind(response)).toBe('quota')
})
it('does not confuse denied access with quota, and cancels a long same-task cooldown without waiting it out', async () => {
  expect(await httpFailureKind(new Response('Access denied', { status: 403 }))).toBe('auth')
  const abort = new AbortController(), complete = vi.fn()
  const wait = waitForGenerationRetry(120_000, abort.signal).then(complete)
  await Promise.resolve(); expect(complete).not.toHaveBeenCalled()
  abort.abort(); await wait; expect(complete).toHaveBeenCalledTimes(1)
})
