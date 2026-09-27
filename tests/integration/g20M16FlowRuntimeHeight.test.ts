import { expect, it } from 'vitest'
import { createPublishedSurfaceRuntimeSession, mountPublishedSurfaceRuntime } from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { observeSurfaceRuntimeContentSize } from '@/player/surfaces/runtime/surfaceRuntimeContentSize'
import { resolveFlowRuntimePaperSlots } from '@/shared/flowRuntimePaperLayout'
import type { PublishedRuntimeLayerItem } from '@/shared/publishedCourseTypes'

function encodeSource(source: string): PublishedRuntimeLayerItem['runtime']['code'] {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); bytes[index * 2] = code & 0xff; bytes[index * 2 + 1] = code >>> 8 }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

const SOURCE = `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
  ctx.actions.goToScene('other-scene');
  const content = ctx.dom.root.ownerDocument.createElement('main');
  content.textContent = '互动状态 0';
  ctx.dom.root.append(content);
  ctx.dom.root.ownerDocument.defaultView.__m16Creates = (ctx.dom.root.ownerDocument.defaultView.__m16Creates || 0) + 1;
  return {resize(width,height){ctx.dom.root.dataset.size = width + 'x' + height},destroy(){content.remove()}};
}})`

it('reports real Runtime content growth and shrink without remount or duplicate notifications', () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const view = frame.contentWindow as (Window & typeof globalThis) | null
  const doc = frame.contentDocument
  if (!view || !doc) throw new Error('iframe realm unavailable')
  const callbacks: FrameRequestCallback[] = []
  Object.defineProperty(view, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length } })
  Object.defineProperty(view, 'cancelAnimationFrame', { configurable: true, value: () => undefined })
  let notifyResize: (() => void) | undefined
  let disconnected = 0
  Object.defineProperty(view, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: () => void) { notifyResize = callback }
    observe() {}
    disconnect() { disconnected += 1 }
  } })
  const flush = () => { while (callbacks.length) callbacks.shift()!(0) }
  let contentHeight = 1200
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: function (this: HTMLElement) {
    const height = this.tagName === 'MAIN' ? contentHeight : 300
    return { x: 0, y: 0, left: 0, top: 0, width: 640, height, right: 640, bottom: height, toJSON: () => ({}) }
  } })
  const container = doc.createElement('div')
  doc.body.append(container)
  const heights: number[] = []
  let navigationCalls = 0
  const session = createPublishedSurfaceRuntimeSession()
  const handle = mountPublishedSurfaceRuntime(container, {
    instanceId: 'flow-long-runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: encodeSource(SOURCE), content: { values: {} }, assets: {} },
    width: 640, height: 300, visible: true, mode: 'authoring', resolveAsset: () => undefined, session,
    onContentHeightChange: height => heights.push(height),
    actions: { goToScene: () => { navigationCalls += 1; return true }, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
  })
  expect(handle.ok).toBe(true)
  expect(navigationCalls).toBe(0)
  flush()
  expect(heights).toEqual([1200])
  const main = container.querySelector('main')
  expect(Reflect.get(view, '__m16Creates')).toBe(1)
  contentHeight = 1600
  notifyResize?.(); notifyResize?.()
  flush()
  expect(heights).toEqual([1200, 1600])
  handle.updateSize(640, 1600)
  flush()
  expect(heights).toEqual([1200, 1600])
  expect(container.querySelector('main')).toBe(main)
  expect(container.querySelector('[data-surface-runtime-root]')?.getAttribute('data-size')).toBe('640x1600')
  contentHeight = 500
  handle.updateSize(640, 1600)
  flush()
  expect(heights).toEqual([1200, 1600, 500])
  expect(Reflect.get(view, '__m16Creates')).toBe(1)
  handle.destroy()
  notifyResize?.()
  flush()
  expect(heights).toEqual([1200, 1600, 500])
  expect(disconnected).toBeGreaterThan(0)
  session.destroy()
  frame.remove()
})

it('places same-anchor Runtime slots in stable order and shifts later blocks once', () => {
  const layout = resolveFlowRuntimePaperSlots(
    [{ blockId: 'a', top: 0, bottom: 100 }, { blockId: 'b', top: 100, bottom: 220 }],
    [{ id: 'z', blockId: 'a', order: 2, observedHeight: 160 }, { id: 'x', blockId: 'a', order: 1, observedHeight: 140 }, { id: 'b-runtime', blockId: 'b', order: 0, observedHeight: 130 }],
  )
  expect(layout.slots).toEqual([
    { id: 'x', blockId: 'a', top: 0, height: 140, bottom: 140 },
    { id: 'z', blockId: 'a', top: 140, height: 160, bottom: 300 },
    { id: 'b-runtime', blockId: 'b', top: 300, height: 130, bottom: 430 },
  ])
  expect(layout.addedAfterBlock).toMatchObject({ a: 200, b: 10 })
  expect(layout.totalAddedHeight).toBe(210)
  const withinBlock = resolveFlowRuntimePaperSlots([{ blockId: 'a', top: 0, bottom: 100 }], [{ id: 'short', blockId: 'a', order: 0, observedHeight: 40, offsetY: 20 }])
  expect(withinBlock.slots[0]?.top).toBe(20)
  expect(withinBlock.addedAfterBlock.a).toBe(0)
})

it('accepts a managed document as the content source and measures its page instead of the fixed host', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const page = frame.contentDocument
  if (!page) throw new Error('iframe document unavailable')
  const article = page.createElement('article')
  page.body.append(article)
  let pageHeight = 920
  Object.defineProperty(article, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: pageHeight, height: pageHeight }) })
  const root = document.createElement('div')
  root.style.height = '300px'
  document.body.append(root)
  const heights: number[] = []
  const observer = observeSurfaceRuntimeContentSize({ root, source: () => page, onHeightChange: height => heights.push(height) })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([920])
  pageHeight = 480
  observer.refresh()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(heights).toEqual([920, 480])
  observer.destroy()
  root.remove()
  frame.remove()
})
