// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { waitForModelOperation } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { serverSentEvents } from '../../src/main/workbench/providers/serverSentEvents'
import { modelGenerationRetry, waitForGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'
import type { ModelFailure } from '../../src/shared/workbench/modelProvider'
afterEach(() => vi.useRealTimers())

it('M26 retry policy requires generation-only declaration, caps three attempts and preserves long Retry-After without an early retry', () => {
  const ordinary = { retrySafety: 'pure-generation' as const }, failed: ModelFailure = { outcome: 'unknown', kind: 'transport', code: 'transport', message: 'unknown' }
  expect(modelGenerationRetry(ordinary, failed, 1, () => 0)).toEqual({ kind: 'retry', delayMs: 1000 })
  expect(modelGenerationRetry(ordinary, failed, 2, () => 0)).toEqual({ kind: 'retry', delayMs: 2000 })
  expect(modelGenerationRetry(ordinary, failed, 3)).toEqual({ kind: 'stop' })
  expect(modelGenerationRetry({}, failed, 1)).toEqual({ kind: 'stop' })
  expect(modelGenerationRetry({ retrySafety: 'server-side-effects' }, failed, 1)).toEqual({ kind: 'stop' })
  for (const kind of ['auth', 'configuration', 'quota', 'aborted'] as const) expect(modelGenerationRetry(ordinary, { ...failed, kind }, 1)).toEqual({ kind: 'stop' })
  expect(modelGenerationRetry(ordinary, { ...failed, kind: 'protocol', code: 'invalid-json-event' }, 1)).toEqual({ kind: 'stop' })
  expect(modelGenerationRetry(ordinary, { ...failed, kind: 'rate-limit', httpStatus: 429, retryAfterMs: 60_000 }, 1)).toEqual({ kind: 'wait', delayMs: 60_000 })
  expect(modelGenerationRetry(ordinary, { ...failed, kind: 'server', httpStatus: 503, retryAfterMs: 3000 }, 1)).toEqual({ kind: 'retry', delayMs: 3000 })
})

it('M26 stop clears backoff and aborts a stuck local credential wait without claiming an upstream cancellation', async () => {
  vi.useFakeTimers()
  const abort = new AbortController(), waited = vi.fn()
  const backoff = waitForGenerationRetry(2000, abort.signal).then(waited)
  const resolver = waitForModelOperation(() => new Promise<never>(() => undefined), abort.signal)
  const rejected = expect(resolver).rejects.toBeDefined()
  abort.abort(); await backoff; await rejected
  expect(waited).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('decodes a single complete SSE event above the old largest event quota and leaves incomplete EOF undispatched', async () => {
  const value = 'x'.repeat(33 * 1024 * 1024)
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${value}\n\n`)); controller.close()
  } })
  const events: string[] = []
  for await (const event of serverSentEvents(stream)) events.push(event)
  expect(events).toEqual([value])
  const incomplete = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(500))); controller.close()
  } })
  const unfinished: string[] = []
  for await (const event of serverSentEvents(incomplete)) unfinished.push(event)
  expect(unfinished).toEqual([])
})
