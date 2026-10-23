import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFlowReadingNavigation } from '../../src/shared/flowReading'

let clock = 0, nextFrame = 0
let frames = new Map<number, FrameRequestCallback>()
let resized: ResizeObserverCallback[] = []
beforeEach(() => {
  clock = 0; nextFrame = 0; frames = new Map(); resized = []
  vi.spyOn(window.performance, 'now').mockImplementation(() => clock)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.set(++nextFrame, cb); return nextFrame })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { resized.push(cb) }
    observe() {} disconnect() {} unobserve() {}
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
function tick(ms: number) {
  clock += ms
  const pending = [...frames.values()]; frames.clear()
  for (const callback of pending) callback(clock)
}
function fixture(scale = 1, chapterInset = 0) {
  const scroll = document.createElement('div'), body = document.createElement('article')
  scroll.append(body); document.body.append(scroll)
  let top = 0, shift = 0
  Object.defineProperties(scroll, {
    clientHeight: { value: 400 }, clientTop: { value: 2 }, scrollHeight: { get: () => 4000 + shift },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(3600 + shift, value)) } },
  })
  Object.defineProperty(body, 'offsetWidth', { value: 600 })
  scroll.getBoundingClientRect = () => new DOMRect(0, 10, 600 * scale, 404 * scale)
  body.getBoundingClientRect = () => new DOMRect(0, 10 + (2 - top) * scale, 600 * scale, (4000 + shift) * scale)
  const chapters: HTMLElement[] = []
  const stops = [0, 800, 1800, 3300].map((position, index) => {
    const chapter = document.createElement('section'); body.append(chapter); chapters.push(chapter)
    chapter.getBoundingClientRect = () => new DOMRect(0, 10 + (2 + position - chapterInset + (index ? shift : 0) - top) * scale, 600 * scale, 600 * scale)
    const element = document.createElement('h2'); chapter.append(element); element.style.scrollMarginTop = '40px'
    element.getBoundingClientRect = () => new DOMRect(0, 10 + (2 + position + (index ? shift : 0) - top) * scale, 600 * scale, 30 * scale)
    return element
  })
  const nav = createFlowReadingNavigation(() => ({ scroll, body }), (id, kind) => kind === 'chapter' && chapterInset ? chapters[Number(id)] : stops[Number(id)])
  nav.readReading(['0', '1', '2', '3'])
  return { scroll, body, stops, nav, shift(value: number) { shift = value }, resize() { for (const cb of resized) cb([], {} as ResizeObserver) } }
}

it('reports a finite, real scroll presentation and precise scaled scroll-margin docking', async () => {
  const h = fixture(1.75), facts: unknown[] = []
  h.nav.subscribe(() => facts.push(h.nav.readMotion()))
  const pending = h.nav.goToInstance('3', undefined, { kind: 'chapter' })
  expect(h.scroll.scrollTop).toBe(0)
  expect(h.nav.readMotion()).toMatchObject({ status: 'running', progress: 0, targetScrollTop: 3260, kind: 'chapter' })
  tick(100)
  expect(h.scroll.scrollTop).toBeGreaterThan(0); expect(h.scroll.scrollTop).toBeLessThan(3260)
  expect(h.nav.readReading(['0', '1', '2', '3'])?.activeInstanceId).not.toBe('3')
  tick(1000)
  expect(await pending).toBe(true); expect(h.scroll.scrollTop).toBeCloseTo(3260)
  expect(h.nav.readMotion()).toMatchObject({ status: 'completed', progress: 1 })
  expect(facts[0]).toMatchObject({ status: 'running', progress: 0 })
  expect(frames.size).toBe(0); h.nav.dispose()
})

it('reverses from the actual intermediate position and settles the replaced request', async () => {
  const h = fixture(), first = h.nav.goToInstance('3')
  tick(180); const intermediate = h.scroll.scrollTop
  const second = h.nav.goToInstance('0')
  expect(await first).toBe(false)
  expect(h.nav.readMotion()?.startScrollTop).toBe(intermediate)
  tick(100); expect(h.scroll.scrollTop).toBeLessThan(intermediate)
  tick(1000); expect(await second).toBe(true); expect(h.scroll.scrollTop).toBe(0)
  expect(frames.size).toBe(0); h.nav.dispose()
})

it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('lets %s take over and never restores the old anchor', async event => {
  const h = fixture(), pending = h.nav.goToInstance('3')
  tick(100)
  h.scroll.dispatchEvent(event === 'keydown' ? new KeyboardEvent(event, { key: 'PageDown', bubbles: true }) : new Event(event, { bubbles: true }))
  expect(await pending).toBe(false)
  const manual = h.scroll.scrollTop = 123
  h.shift(250); h.resize(); tick(2000)
  expect(h.scroll.scrollTop).toBe(manual); expect(h.nav.readMotion()?.status).toBe('cancelled')
  expect(frames.size).toBe(0); h.nav.dispose()
})

it('retargets layout changes during motion and corrects later loads only until user takeover', async () => {
  const h = fixture(), pending = h.nav.goToInstance('2')
  tick(100); h.shift(220); tick(1000)
  expect(await pending).toBe(true); expect(h.scroll.scrollTop).toBe(1980)
  h.shift(350); h.resize(); tick(16)
  expect(h.scroll.scrollTop).toBe(2110); expect(frames.size).toBe(0)
  h.scroll.dispatchEvent(new Event('wheel', { bubbles: true }))
  expect(h.nav.readMotion()).toBeUndefined()
  h.scroll.scrollTop = 100; h.shift(500); h.resize(); tick(16)
  expect(h.scroll.scrollTop).toBe(100); h.nav.dispose()
})

it('supports AbortSignal, disposal and reduced motion without a residual frame', async () => {
  const h = fixture(), abort = new AbortController(), pending = h.nav.goToInstance('2', abort.signal)
  tick(100); abort.abort(); expect(await pending).toBe(false); expect(frames.size).toBe(0)
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  expect(h.nav.goToInstance('3')).toBe(true); expect(h.scroll.scrollTop).toBe(3260)
  expect(h.nav.readMotion()).toMatchObject({ status: 'completed', durationMs: 0, progress: 1 })
  h.nav.dispose(); expect(h.nav.goToInstance('0')).toBe(false); expect(frames.size).toBe(0)
})

it('leaves presenter-consumed and repeated navigation keys to the navigation owner', async () => {
  const h = fixture(), pending = h.nav.goToInstance('3')
  const presenter = (event: KeyboardEvent) => { if (event.key === 'PageDown') event.preventDefault() }
  window.addEventListener('keydown', presenter)
  try {
    h.scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', repeat: true, bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(h.nav.readMotion()?.status).toBe('running')
    tick(1000); expect(await pending).toBe(true)
  } finally { window.removeEventListener('keydown', presenter); h.nav.dispose() }
})

it('recognizes iframe scroll chaining from actual displacement while allowing layout scroll anchoring', async () => {
  const h = fixture(), first = h.nav.goToInstance('3')
  tick(100); h.shift(200); h.scroll.scrollTop += 200
  tick(100)
  expect(h.nav.readMotion()?.status).toBe('running')
  h.scroll.scrollTop -= 120
  const manual = h.scroll.scrollTop
  // No parent-document wheel event is available from the nested browsing context.
  h.scroll.dispatchEvent(new Event('scroll'))
  expect(await first).toBe(false); tick(1000)
  expect(h.scroll.scrollTop).toBe(manual); expect(frames.size).toBe(0)
  await h.nav.goToInstance('2', undefined, { behavior: 'instant' })
  h.scroll.scrollTop -= 90; h.scroll.dispatchEvent(new Event('scroll'))
  expect(h.nav.readMotion()).toBeUndefined()
  await h.nav.goToInstance('2', undefined, { behavior: 'instant' })
  h.shift(400); h.scroll.scrollTop += 200; h.resize(); tick(16)
  expect(h.nav.readMotion()?.scrollTop).toBe(h.scroll.scrollTop)
  h.scroll.scrollTop -= 80; h.scroll.dispatchEvent(new Event('scroll'))
  expect(h.nav.readMotion()).toBeUndefined()
  h.nav.dispose()
})

it('keeps an owned chapter selection after native layout anchoring, including a preceding geometry read', () => {
  const h = fixture(1, 200)
  h.nav.goToInstance('2', undefined, { kind: 'chapter', behavior: 'instant' })
  expect(h.scroll.scrollTop).toBe(1600)
  expect(h.nav.readReading(['0', '1', '2', '3'])?.activeInstanceId).toBe('2')
  h.shift(200); h.scroll.scrollTop += 200
  h.nav.readReading(['0', '1', '2', '3'])
  h.resize(); tick(16)
  expect(h.scroll.scrollTop).toBe(1800)
  expect(h.nav.readReading(['0', '1', '2', '3'])?.activeInstanceId).toBe('2')
  h.scroll.scrollTop -= 90; h.scroll.dispatchEvent(new Event('scroll'))
  expect(h.nav.readMotion()).toBeUndefined(); h.nav.dispose()
})
