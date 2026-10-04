import { expect, it, vi } from 'vitest'
import { createPublishedSurfaceRuntimeSession, mountPublishedSurfaceRuntime } from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { observeSurfaceRuntimeContentSize } from '@/player/surfaces/runtime/surfaceRuntimeContentSize'
import { resolveFlowRuntimePaperSlots } from '@/shared/flowRuntimePaperLayout'
import type { PublishedRuntimeLayerItem } from '@/shared/publishedCourseTypes'

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

function encodeSource(source: string): PublishedRuntimeLayerItem['runtime']['code'] {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); bytes[index * 2] = code & 0xff; bytes[index * 2 + 1] = code >>> 8 }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

const SOURCE = `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
  ctx.actions.goToScene('other-scene');
  ctx.authoring.registerText({key:'title',bounds:{x:10,y:20,width:100,height:30}});
  const content = ctx.dom.root.ownerDocument.createElement('main');
  content.textContent = '互动状态 0';
  ctx.dom.root.append(content);
  ctx.dom.root.ownerDocument.defaultView.__m16Creates = (ctx.dom.root.ownerDocument.defaultView.__m16Creates || 0) + 1;
  return {resize(width,height){ctx.dom.root.dataset.size = width + 'x' + height},destroy(){content.remove()}};
}})`

it('reports real Runtime content growth and shrink without remount or duplicate notifications', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const view = frame.contentWindow as (Window & typeof globalThis) | null
  const doc = frame.contentDocument
  if (!view || !doc) throw new Error('iframe realm unavailable')
  const callbacks: FrameRequestCallback[] = []
  Object.defineProperty(view, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length } })
  Object.defineProperty(view, 'cancelAnimationFrame', { configurable: true, value: () => undefined })
  type ResizeEntries = Array<{ target: Element; contentRect: { width: number; height: number } }>
  let resizeCallback: ((entries: ResizeEntries) => void) | undefined
  let observed: Element[] = []
  let disconnected = 0
  Object.defineProperty(view, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: (entries: ResizeEntries) => void) { resizeCallback = callback }
    observe(target: Element) { observed.push(target) }
    disconnect() { disconnected += 1; observed = [] }
  } })
  // Like the browser, a notification reports the current size of every observed element.
  const notifyResize = () => resizeCallback?.(observed.map(target => ({ target, contentRect: target.getBoundingClientRect() })))
  const flush = () => { while (callbacks.length) callbacks.shift()!(0) }
  let contentHeight = 1200
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: function (this: HTMLElement) {
    const height = this.tagName === 'MAIN' ? contentHeight : 300
    return { x: 0, y: 0, left: 0, top: 0, width: 640, height, right: 640, bottom: height, toJSON: () => ({}) }
  } })
  const container = doc.createElement('div')
  doc.body.append(container)
  const heights: number[] = []
  const registeredY: number[] = []
  let navigationCalls = 0
  const session = createPublishedSurfaceRuntimeSession()
  const handle = mountPublishedSurfaceRuntime(container, {
    instanceId: 'flow-long-runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: encodeSource(SOURCE), content: { values: { title: 'Title' } }, assets: {} },
    width: 640, height: 300, visible: true, mode: 'authoring', resolveAsset: () => undefined, session,
    onContentHeightChange: height => heights.push(height),
    authoring: { scope: 'scene', sceneId: 'flow', onTargetsChanged: update => {
      const target = update.targets.find(target => target.source === 'registered' && target.key === 'title')
      if (target) registeredY.push(target.bounds.y)
    } },
    actions: { goToScene: () => { navigationCalls += 1; return true }, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
  })
  expect(handle.ok).toBe(true)
  expect(navigationCalls).toBe(0)
  flush()
  await Promise.resolve()
  expect(heights).toEqual([1200])
  expect(registeredY[0]).toBeGreaterThan(9)
  const main = container.querySelector('main')
  expect(Reflect.get(view, '__m16Creates')).toBe(1)
  notifyResize() // The initial observation only records sizes.
  contentHeight = 1600
  notifyResize(); notifyResize()
  flush()
  expect(heights).toEqual([1200, 1600])
  handle.updateSize(640, 1600)
  flush()
  await Promise.resolve()
  expect(heights).toEqual([1200, 1600])
  expect(registeredY.at(-1)).toBeLessThan(registeredY[0]!)
  expect(container.querySelector('main')).toBe(main)
  expect(container.querySelector('[data-surface-runtime-root]')?.getAttribute('data-size')).toBe('640x1600')
  // Only a real invalidation re-measures; the shrinking content reports its new size.
  contentHeight = 500
  notifyResize()
  flush()
  expect(heights).toEqual([1200, 1600, 500])
  expect(Reflect.get(view, '__m16Creates')).toBe(1)
  handle.destroy()
  notifyResize()
  flush()
  expect(heights).toEqual([1200, 1600, 500])
  expect(disconnected).toBeGreaterThan(0)
  session.destroy()
  frame.remove()
})

it('places Runtime slots after live anchor rectangles without double-counting existing spacers', () => {
  const layout = resolveFlowRuntimePaperSlots(
    [{ blockId: 'a', top: 0, bottom: 100 }, { blockId: 'b', top: 400, bottom: 520 }],
    [{ id: 'z', blockId: 'a', order: 2, observedHeight: 160 }, { id: 'x', blockId: 'a', order: 1, observedHeight: 140 }, { id: 'b-runtime', blockId: 'b', order: 0, observedHeight: 130 }],
  )
  expect(layout.slots).toEqual([
    { id: 'x', blockId: 'a', top: 100, height: 140, bottom: 240 },
    { id: 'z', blockId: 'a', top: 240, height: 160, bottom: 400 },
    { id: 'b-runtime', blockId: 'b', top: 520, height: 130, bottom: 650 },
  ])
  expect(layout.addedAfterBlock).toMatchObject({ a: 300, b: 130 })
  expect(layout.totalAddedHeight).toBe(430)
  const withinBlock = resolveFlowRuntimePaperSlots([{ blockId: 'a', top: 0, bottom: 100 }], [{ id: 'short', blockId: 'a', order: 0, observedHeight: 40, offsetY: 20 }])
  expect(withinBlock.slots[0]?.top).toBe(100)
  expect(withinBlock.addedAfterBlock.a).toBe(40)
})

it('accepts a managed document as the content source and measures its page instead of the fixed host', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const page = frame.contentDocument
  if (!page) throw new Error('iframe document unavailable')
  const article = page.createElement('article')
  page.body.style.minHeight = '100vh'
  page.body.append(article)
  let pageHeight = 920
  Object.defineProperty(article, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: pageHeight, height: pageHeight }) })
  const root = document.createElement('div')
  root.style.height = '300px'
  document.body.append(root)
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, source: () => ({ kind: 'viewport', origin: page.body, viewportElements: new Set([page.body]) }), onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([920])
  // Only a real invalidation re-measures: the page content itself changes.
  pageHeight = 480
  article.textContent = '较短的页面'
  await nextFrame(); await nextFrame()
  expect(heights).toEqual([920, 480])
  observer.destroy()
  root.remove()
  frame.remove()
})

it.each([0.5, 2])('measures unscaled content at %sx and shrinks after a stylesheet 100%% wrapper grows', async scale => {
  const style = document.createElement('style')
  style.textContent = `.m16-host-fill { height: 100%; } .m16-viewport-fill { height: 100vh; }`
  document.head.append(style)
  const root = document.createElement('div')
  const wrapper = document.createElement('div')
  wrapper.className = 'm16-host-fill'
  const content = document.createElement('article')
  wrapper.append(content)
  root.append(wrapper)
  document.body.append(root)
  let hostHeight = 300
  let contentHeight = 1200
  Object.defineProperty(root, 'offsetHeight', { configurable: true, get: () => hostHeight })
  Object.defineProperty(root, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: hostHeight * scale, height: hostHeight * scale }) })
  Object.defineProperty(wrapper, 'getBoundingClientRect', { configurable: true, value: () => {
    const height = wrapper.className === 'm16-viewport-fill' ? 720 : hostHeight
    return { top: 0, bottom: height * scale, height: height * scale }
  } })
  Object.defineProperty(content, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: contentHeight * scale, height: contentHeight * scale }) })
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, source: () => ({ kind: 'viewport', origin: root, viewportElements: new Set([root, wrapper]) }), onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([1200])
  // Only real DOM invalidations re-measure: the host grows while the content shrinks.
  hostHeight = 1200
  contentHeight = 500
  root.style.height = '1200px'
  await nextFrame(); await nextFrame()
  expect(heights).toEqual([1200, 500])
  wrapper.className = 'm16-viewport-fill'
  contentHeight = 1200
  await nextFrame(); await nextFrame()
  contentHeight = 500
  content.dataset.step = 'shrunk'
  await nextFrame(); await nextFrame()
  expect(heights).toEqual([1200, 500, 1200, 500])
  observer.destroy()
  root.remove()
  style.remove()
})

it('measures direct visible text in an otherwise empty Runtime root', async () => {
  const root = document.createElement('div')
  root.append(document.createTextNode('Direct Runtime text'))
  document.body.append(root)
  const originalRange = document.createRange.bind(document)
  const createRange = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = originalRange()
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ top: 0, bottom: 40, height: 40 }) })
    return range
  })
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([40])
  observer.destroy()
  createRange.mockRestore()
  root.remove()
})

it('keeps fixed intrinsic boxes and viewport padding while explicit sources change', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const first = document.createElement('main')
  const paragraph = document.createElement('p')
  first.append(paragraph)
  const second = document.createElement('main')
  Object.defineProperty(first, 'offsetHeight', { configurable: true, value: 1200 })
  Object.defineProperty(second, 'offsetHeight', { configurable: true, value: 500 })
  let source: { kind: 'intrinsic'; element: HTMLElement } | null = null
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, source: () => source, onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([])
  source = { kind: 'intrinsic', element: first }
  root.append(first)
  observer.refresh()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([1200])
  source = { kind: 'intrinsic', element: second }
  root.replaceChildren(second)
  observer.refresh()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([1200, 500])
  observer.destroy()
  root.remove()
})

it('includes fixed child boxes and trailing padding inside an explicitly declared viewport', async () => {
  const root = document.createElement('div')
  const viewport = document.createElement('div')
  viewport.style.paddingBottom = '200px'
  const fixed = document.createElement('main')
  const paragraph = document.createElement('p')
  fixed.append(paragraph)
  viewport.append(fixed)
  root.append(viewport)
  document.body.append(root)
  Object.defineProperty(root, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 300, height: 300 }) })
  Object.defineProperty(viewport, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 300, height: 300 }) })
  Object.defineProperty(fixed, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 1200, height: 1200 }) })
  Object.defineProperty(paragraph, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 21, height: 21 }) })
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, source: () => ({ kind: 'viewport', origin: root, viewportElements: new Set([root, viewport]) }), onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([1400])
  observer.destroy()
  root.remove()
})
