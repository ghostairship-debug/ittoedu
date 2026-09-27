// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeSurfaceRuntimeContentSize } from '../../src/player/surfaces/runtime/surfaceRuntimeContentSize'

const mocks = vi.hoisted(() => ({ measure: vi.fn(), waitResize: vi.fn() }))
vi.mock('../../src/player/surfaces/runtime/managedHtmlContentMeasurement', () => ({ measureManagedHtmlContent: mocks.measure }))
vi.mock('../../src/player/surfaces/runtime/managedHtmlFlowAdmissionProfile', () => ({
  freezeManagedHtmlLayout: () => () => true,
  managedHtmlStylesheetSignature: () => 'stable',
  waitForManagedHtmlResize: mocks.waitResize,
}))

const realSetTimeout = globalThis.setTimeout.bind(globalThis)
const pause = () => new Promise<void>(resolve => realSetTimeout(resolve, 2))
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await pause()
  }
  throw new Error('Observer did not reach the expected phase')
}

const observers: Array<{ destroy(): void }> = []
const frames: HTMLIFrameElement[] = []
afterEach(() => {
  for (const observer of observers.splice(0)) observer.destroy()
  for (const frame of frames.splice(0)) frame.remove()
  vi.useRealTimers()
  mocks.measure.mockReset()
  mocks.waitResize.mockReset()
})

function fixture() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const origin = frame.contentDocument!.documentElement
  const source = { kind: 'managed-document' as const, iframe: frame, origin, minimumHeight: 1 }
  const heights: number[] = []
  const errors: Error[] = []
  const observer = observeSurfaceRuntimeContentSize({
    root: document.body, source: () => source,
    onHeightChange: height => heights.push(height), onError: error => errors.push(error),
  })
  observers.push(observer)
  return { frame, origin, source, observer, heights, errors }
}

function controlledMeasurements() {
  const calls: Array<{ resolve(height: number): void; signal: AbortSignal }> = []
  mocks.measure.mockImplementation((_source, signal: AbortSignal) => new Promise<number>((resolve, reject) => {
    calls.push({ resolve, signal })
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  return calls
}

it('joins one initial and one confirmation measurement even when their combined time exceeds three seconds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const calls = controlledMeasurements()
  let finishResize: (() => void) | undefined
  mocks.waitResize.mockImplementation(() => new Promise<void>(resolve => { finishResize = resolve }))
  const { observer, heights, errors } = fixture()
  const first = observer.waitForReady()
  const second = observer.waitForReady()
  observer.refresh()
  await until(() => calls.length === 1)
  await vi.advanceTimersByTimeAsync(1600)
  observer.refresh()
  expect(calls[0]!.signal.aborted).toBe(false)
  calls[0]!.resolve(900)
  await until(() => heights.length === 1 && !!finishResize)
  await vi.advanceTimersByTimeAsync(1600)
  expect(errors).toEqual([])
  finishResize!()
  await until(() => calls.length === 2)
  calls[1]!.resolve(900)
  await Promise.all([first, second])
  expect(heights).toEqual([900])
  expect(calls.map(call => call.signal.aborted)).toEqual([false, false])
  expect(errors).toEqual([])
})

it('counts actual DOM invalidations by measurement round and rejects persistent churn', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const { origin, observer, heights, errors } = fixture()
  const ready = observer.waitForReady()
  const rejected = expect(ready).rejects.toThrow('持续失效')
  for (let index = 0; index < 13; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.textContent = 'change ' + index
    await until(() => calls[index]!.signal.aborted || errors.length > 0)
  }
  await rejected
  expect(errors).toHaveLength(1)
  expect(errors[0]!.message).toContain('invalidations=13')
  expect(heights).toEqual([])
  expect(calls).toHaveLength(13)
})
