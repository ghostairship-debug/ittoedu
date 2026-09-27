// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { observeSurfaceRuntimeContentSize, type FlowHtmlConfirmationMode } from '../../src/player/surfaces/runtime/surfaceRuntimeContentSize'

const mocks = vi.hoisted(() => ({ measure: vi.fn(), waitResize: vi.fn(), freeze: vi.fn() }))
vi.mock('../../src/player/surfaces/runtime/managedHtmlContentMeasurement', () => ({ measureManagedHtmlContent: mocks.measure }))
vi.mock('../../src/player/surfaces/runtime/managedHtmlFlowAdmissionProfile', () => ({
  freezeManagedHtmlLayout: mocks.freeze,
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
beforeEach(() => mocks.freeze.mockImplementation(() => () => true))
afterEach(() => {
  for (const observer of observers.splice(0)) observer.destroy()
  for (const frame of frames.splice(0)) frame.remove()
  vi.useRealTimers()
  mocks.measure.mockReset()
  mocks.waitResize.mockReset()
  mocks.freeze.mockReset()
})

function fixture(flowHtmlConfirmationMode?: FlowHtmlConfirmationMode, onHeight?: (height: number, origin: HTMLElement) => void, setupFrame?: (frame: HTMLIFrameElement) => void) {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  setupFrame?.(frame)
  const origin = frame.contentDocument!.documentElement
  const source = { kind: 'managed-document' as const, iframe: frame, origin, minimumHeight: 1 }
  let currentSource: typeof source | null = source
  const heights: number[] = []
  const errors: Error[] = []
  const observer = observeSurfaceRuntimeContentSize({
    root: document.body, source: () => currentSource, flowHtmlConfirmationMode,
    onHeightChange: height => { heights.push(height); onHeight?.(height, origin) }, onError: error => errors.push(error),
  })
  observers.push(observer)
  return { frame, origin, source, observer, heights, errors, setSource(next: typeof source | null) { currentSource = next; observer.refresh() } }
}

function controlledMeasurements() {
  const calls: Array<{ resolve(height: number): void; signal: AbortSignal }> = []
  mocks.measure.mockImplementation((_source, signal: AbortSignal) => new Promise<number>((resolve, reject) => {
    calls.push({ resolve, signal })
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  return calls
}

it.each([undefined, 'admission', 'runtime'] as const)('routes the first frozen-layout mismatch in %s mode', async mode => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  mocks.freeze.mockImplementation(() => () => false)
  const { observer, heights, errors } = fixture(mode)
  const ready = observer.waitForReady()
  const rejection = mode === 'runtime' ? null : expect(ready).rejects.toThrow('删除、移动或改变了正文')
  await until(() => calls.length === 1)
  calls[0]!.resolve(900)
  await until(() => heights.length === 1)
  if (mode === 'runtime') {
    await until(() => calls.length === 2)
    calls[1]!.resolve(900)
    await ready
    expect(errors).toEqual([])
    expect(heights).toEqual([900])
  } else {
    await rejection
    expect(errors).toHaveLength(1)
    expect(calls).toHaveLength(1)
  }
})

it('restarts after the post-measurement frozen-layout mismatch without a mutation notification', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  let checks = 0
  mocks.freeze.mockImplementation(() => () => ++checks === 1)
  const { observer, heights, errors } = fixture('runtime')
  const ready = observer.waitForReady()
  await until(() => calls.length === 1)
  calls[0]!.resolve(900)
  await until(() => calls.length === 2)
  calls[1]!.resolve(900)
  await until(() => calls.length === 3)
  calls[2]!.resolve(900)
  await ready
  expect(checks).toBe(2)
  expect(heights).toEqual([900])
  expect(errors).toEqual([])
})

it('aborts the old confirmation and counts simultaneous mutation and resize only once', async () => {
  const calls = controlledMeasurements()
  let waiting: AbortSignal | undefined
  mocks.waitResize.mockImplementation((_document, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
    waiting = signal
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  let resize: ResizeObserverCallback | undefined
  const { origin, observer, heights, errors } = fixture('runtime', undefined, frame => {
    class ProbeResizeObserver {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(frame.contentWindow!, 'ResizeObserver', { configurable: true, value: ProbeResizeObserver })
  })
  const emit = (height: number) => resize!([{ target: origin, contentRect: { width: 760, height } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
  emit(300)
  const ready = observer.waitForReady()
  for (let index = 0; index < 11; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.dataset.initial = String(index)
    await until(() => calls[index]!.signal.aborted)
  }
  await until(() => calls.length === 12)
  calls[11]!.resolve(900)
  await until(() => heights.length === 1 && !!waiting)
  origin.ownerDocument.body.dataset.tick = 'one'
  emit(301)
  await until(() => waiting!.aborted)
  await until(() => calls.length === 13)
  calls[12]!.resolve(900)
  await ready
  expect(calls[11]!.signal.aborted).toBe(false)
  expect(calls).toHaveLength(13)
  expect(errors).toEqual([])
  expect(heights).toEqual([900])
})

it('counts a confirmation invalidation after publication when no controller remains', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const { origin, observer, heights, errors } = fixture('runtime', (_height, root) => {
    queueMicrotask(() => { root.ownerDocument.body.dataset.confirmation = 'stale' })
  })
  const ready = observer.waitForReady()
  const rejected = expect(ready).rejects.toThrow('invalidations=13')
  for (let index = 0; index < 12; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.dataset.initial = String(index)
    await until(() => calls[index]!.signal.aborted)
  }
  await until(() => calls.length === 13)
  calls[12]!.resolve(900)
  await rejected
  expect(heights).toEqual([900])
  expect(errors).toHaveLength(1)
  expect(calls).toHaveLength(13)
  expect(mocks.waitResize).not.toHaveBeenCalled()
})

it('allows twelve invalidations, then resets the budget after stable readiness', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const { origin, observer, heights, errors } = fixture('runtime')
  const ready = observer.waitForReady()
  for (let index = 0; index < 12; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.dataset.initial = String(index)
    await until(() => calls[index]!.signal.aborted)
  }
  await until(() => calls.length === 13)
  calls[12]!.resolve(900)
  await until(() => calls.length === 14)
  calls[13]!.resolve(900)
  await ready
  origin.ownerDocument.body.dataset.next = 'interaction'
  await until(() => calls.length === 15)
  const nextReady = observer.waitForReady()
  calls[14]!.resolve(900)
  await nextReady
  expect(heights).toEqual([900])
  expect(errors).toEqual([])
})

it('keeps profile failures fatal in runtime mode', async () => {
  const calls = controlledMeasurements()
  mocks.freeze.mockImplementation(() => { throw new Error('unsupported profile') })
  const { observer, heights, errors } = fixture('runtime')
  const ready = observer.waitForReady()
  const rejected = expect(ready).rejects.toThrow('unsupported profile')
  await until(() => calls.length === 1)
  calls[0]!.resolve(900)
  await rejected
  expect(calls).toHaveLength(1)
  expect(heights).toEqual([])
  expect(errors).toHaveLength(1)
})

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

it('rejects thirteen in-flight data attribute changes that alter visible paint', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const { origin, observer, heights, errors } = fixture()
  const style = origin.ownerDocument.createElement('style')
  style.textContent = 'body[data-tick="paint-a"]{color:red}body[data-tick="paint-b"]{color:blue}'
  origin.ownerDocument.head.append(style)
  const ready = observer.waitForReady()
  const rejected = expect(ready).rejects.toThrow('持续失效')
  for (let index = 0; index < 13; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.dataset.tick = index % 2 === 0 ? 'paint-a' : 'paint-b'
    await until(() => calls[index]!.signal.aborted || errors.length > 0)
  }
  await rejected
  expect(errors).toHaveLength(1)
  expect(errors[0]!.message).toContain('invalidations=13')
  expect(heights).toEqual([])
  expect(calls).toHaveLength(13)
})

it('settles waiters when the source disappears during an in-flight measurement', async () => {
  const calls = controlledMeasurements()
  const { observer, setSource, heights, errors } = fixture()
  const ready = observer.waitForReady()
  await until(() => calls.length === 1)
  setSource(null)
  await ready
  await observer.waitForReady()
  expect(calls[0]!.signal.aborted).toBe(true)
  expect(heights).toEqual([])
  expect(errors).toEqual([])
})

it('starts a fresh invalidation budget when a new document replaces the old one', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const { origin, observer, setSource, heights, errors } = fixture()
  const ready = observer.waitForReady()
  for (let index = 0; index < 11; index++) {
    await until(() => calls.length === index + 1)
    origin.ownerDocument.body.textContent = 'old ' + index
    await until(() => calls[index]!.signal.aborted)
  }
  await until(() => calls.length === 12)
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const nextOrigin = frame.contentDocument!.documentElement
  setSource({ kind: 'managed-document', iframe: frame, origin: nextOrigin, minimumHeight: 1 })
  await until(() => calls[11]!.signal.aborted)
  for (let index = 0; index < 2; index++) {
    await until(() => calls.length === 13 + index)
    nextOrigin.ownerDocument.body.textContent = 'new ' + index
    await until(() => calls[12 + index]!.signal.aborted)
  }
  await until(() => calls.length === 15)
  calls[14]!.resolve(900)
  await until(() => heights.length === 1 && calls.length === 16)
  calls[15]!.resolve(900)
  await ready
  expect(heights).toEqual([900])
  expect(errors).toEqual([])
})

it('ignores only the published transparent root size while keeping descendant resize observable', async () => {
  const calls = controlledMeasurements()
  mocks.waitResize.mockResolvedValue(undefined)
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const origin = frame.contentDocument!.documentElement
  const child = frame.contentDocument!.createElement('article')
  frame.contentDocument!.body.append(child)
  let rootHeight = 300
  Object.defineProperty(origin, 'clientWidth', { configurable: true, get: () => 760 })
  Object.defineProperty(origin, 'clientHeight', { configurable: true, get: () => rootHeight })
  Object.defineProperty(frame, 'clientWidth', { configurable: true, get: () => 760 })
  Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => rootHeight })
  let resize: ResizeObserverCallback | undefined
  class ProbeResizeObserver {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(frame.contentWindow!, 'ResizeObserver', { configurable: true, value: ProbeResizeObserver })
  const emit = (target: Element, width: number, height: number) => resize!([{ target, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver)
  const heights: number[] = []
  const errors: Error[] = []
  const observer = observeSurfaceRuntimeContentSize({
    root: document.body,
    source: () => ({ kind: 'managed-document', iframe: frame, origin, minimumHeight: 1 }),
    onHeightChange: height => { heights.push(height); rootHeight = height },
    onError: error => errors.push(error),
  })
  observers.push(observer)
  const ready = observer.waitForReady()
  await until(() => calls.length === 1 && !!resize)
  emit(origin, 760, 300)
  emit(child, 760, 100)
  calls[0]!.resolve(900)
  await until(() => heights.length === 1)
  emit(origin, 760, 900)
  await until(() => calls.length === 2)
  calls[1]!.resolve(900)
  await ready
  expect(calls).toHaveLength(2)
  expect(errors).toEqual([])
  emit(child, 760, 120)
  await until(() => calls.length === 3)
  emit(origin, 760, 850)
  await until(() => calls[2]!.signal.aborted && calls.length === 4)
  const nextReady = observer.waitForReady()
  calls[3]!.resolve(900)
  await nextReady
  expect(heights).toEqual([900])
  expect(errors).toEqual([])
})
