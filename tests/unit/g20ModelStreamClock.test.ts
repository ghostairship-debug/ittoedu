// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { ModelStreamClock, waitForModelOperation } from '../../src/main/workbench/providers/ModelStreamClock'
import { serverSentEvents } from '../../src/main/workbench/providers/serverSentEvents'
import { modelGenerationRetry, waitForGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'
import type { ModelFailure } from '../../src/shared/workbench/modelProvider'
afterEach(() => vi.useRealTimers())

it('M26 valid keepalive extends activity, never meaningful progress, while incomplete garbage cannot extend activity', async () => {
  vi.useFakeTimers()
  const expired = vi.fn(), clock = new ModelStreamClock({ timeoutMs: 100, progressTimeoutMs: 250, maxDurationMs: 500 }, expired)
  let input!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(controller) { input = controller } })
  const consumed = (async () => { for await (const _event of serverSentEvents(stream, 10000, () => clock.activity())) { /* no semantic progress */ } })()
  const heartbeat = async () => { input.enqueue(new TextEncoder().encode(': ping\n\n')); await Promise.resolve(); await Promise.resolve() }
  await vi.advanceTimersByTimeAsync(70); await heartbeat()
  await vi.advanceTimersByTimeAsync(70); await heartbeat()
  await vi.advanceTimersByTimeAsync(70); await heartbeat()
  expect(expired).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(40)
  expect(expired).toHaveBeenCalledExactlyOnceWith('progress')
  input.close(); await consumed; clock.dispose()
  const garbageExpired = vi.fn(), garbageClock = new ModelStreamClock({ timeoutMs: 100, progressTimeoutMs: 250 }, garbageExpired)
  const garbage = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('not-a-frame')); controller.close() } })
  for await (const _event of serverSentEvents(garbage, 1000, () => garbageClock.activity())) { /* no activity */ }
  await vi.advanceTimersByTimeAsync(100)
  expect(garbageExpired).toHaveBeenCalledExactlyOnceWith('idle')
})

it('M26 meaningful output outlives the old idle total but never extends the hard total deadline; local consumers do not count as idle', async () => {
  vi.useFakeTimers()
  const expired = vi.fn(), clock = new ModelStreamClock({ timeoutMs: 100, progressTimeoutMs: 180, maxDurationMs: 300 }, expired)
  for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(80); clock.activity(); clock.progress() }
  expect(expired).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60)
  expect(expired).toHaveBeenCalledExactlyOnceWith('total')
  const slowConsumer = vi.fn(), consuming = new ModelStreamClock({ timeoutMs: 100, progressTimeoutMs: 180, maxDurationMs: 600 }, slowConsumer)
  await vi.advanceTimersByTimeAsync(50); consuming.pause()
  await vi.advanceTimersByTimeAsync(250)
  expect(slowConsumer).not.toHaveBeenCalled()
  consuming.progress(); consuming.resume()
  await vi.advanceTimersByTimeAsync(80); expect(slowConsumer).not.toHaveBeenCalled(); consuming.dispose()
})

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

it('allows a live reasoning stream beyond five minutes but retains a finite no-progress deadline', async () => {
  vi.useFakeTimers()
  const expired = vi.fn(), clock = new ModelStreamClock({}, expired)
  try {
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(60_000); clock.activity() }
    expect(expired).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(60_000); clock.activity() }
    await vi.advanceTimersByTimeAsync(60_000)
    expect(expired).toHaveBeenCalledWith('progress')
  } finally { clock.dispose(); vi.useRealTimers() }
})

it.each([undefined, null])('lets continuing generation pass the old twenty-minute total (%s)', async maxDurationMs => {
  vi.useFakeTimers()
  const expired = vi.fn(), clock = new ModelStreamClock({ maxDurationMs }, expired)
  try {
    for (let i = 0; i < 40; i++) { await vi.advanceTimersByTimeAsync(60_000); clock.activity(); clock.progress() }
    expect(expired).not.toHaveBeenCalled()
  } finally { clock.dispose() }
})
it('consumes streams larger than the old accumulated quota while bounding one unfinished event', async () => {
  const event = new TextEncoder().encode(`data: ${'x'.repeat(1024 * 1024)}\n\n`)
  let remaining = 40
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (remaining--) controller.enqueue(event); else controller.close() } })
  let count = 0
  for await (const value of serverSentEvents(stream, 2 * 1024 * 1024)) { expect(value.length).toBe(1024 * 1024); count++ }
  expect(count).toBe(40)
  const malformed = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(500))); controller.close() } })
  await expect((async () => { for await (const _ of serverSentEvents(malformed, 100)) {} })()).rejects.toThrow('response-too-large')
})
