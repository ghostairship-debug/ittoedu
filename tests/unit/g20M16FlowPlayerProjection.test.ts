import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { FlowSurfaceHost } from '@/player/surfaces/flow/FlowSurfaceHost'
import type { FlowPublishedPlaybackDocument } from '@/player/surfaces/flow/flowModel'
import type { PublishedNativeLayerItem } from '@/shared/publishedCourseTypes'
import type { PlaybackViewSession } from '@/player/playbackViewSession'

function source(): FlowPublishedPlaybackDocument {
  const anchored = sceneNodeToCourseLayerItem(createTextNode({ id: 'anchored', text: '跟随段落', x: 50, y: 60 })) as PublishedNativeLayerItem
  const fixed = sceneNodeToCourseLayerItem(createTextNode({ id: 'fixed', text: '固定', x: 30, y: 40 })) as PublishedNativeLayerItem
  const global = sceneNodeToCourseLayerItem(createTextNode({ id: 'global', text: '屏幕', x: 12, y: 24 })) as PublishedNativeLayerItem
  anchored.paperSpace = 'paper'; fixed.paperSpace = 'paper'; global.paperSpace = 'viewport'
  return {
    courseId: 'm16-player', title: 'Flow Player', assets: { photo: { mimeType: 'image/png', url: 'https://example.test/photo.png' } },
    locations: [{ id: 'loc', label: '标题', kind: 'flow-block', surfaceId: 'flow', blockId: 'h' }], startLocationId: 'loc',
    globalLayerItems: [{ item: global, visibility: { mode: 'all', locationIds: [] } }],
    surfaces: [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 800, wideContentWidth: 1000 }, blocks: [
      { id: 'h', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '标题' }] } },
      { id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } },
      { id: 'image', type: 'media', mediaKind: 'image', assetId: 'photo', altText: '照片', caption: { inlines: [{ type: 'text', text: '说明' }] }, layout: 'content-width', crop: { left: 0.1, top: 0.1, right: 0.2, bottom: 0.1 }, cropX: 0.4, cropY: 0.6 },
    ], surfaceLayerItems: [
      { item: anchored, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: 'p', offsetY: 10, xRatio: 0.25 } },
      { item: fixed, visibility: { mode: 'all', locationIds: [] } },
    ] }],
  }
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('Published Flow Player paragraph and crop projection', () => {
  it('uses live paragraph layout for anchored paper layers while fixed/global layers retain their positions', async () => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') HTMLElement.prototype.scrollIntoView = function () {}
    const host = new FlowSurfaceHost(source())
    const container = document.createElement('div'); document.body.appendChild(container)
    await host.mount(container); await host.activate()
    const paper = container.querySelector<HTMLElement>('.flow-runtime-reading')!
    const article = container.querySelector<HTMLElement>('.flow-runtime-article')!
    const heading = container.querySelector<HTMLElement>('[data-flow-block-id="h"]')!
    const paragraph = container.querySelector<HTMLElement>('[data-flow-block-id="p"]')!
    let paperWidth = 800, paragraphTop = 100
    paper.getBoundingClientRect = () => box(0, 0, paperWidth, 600)
    heading.getBoundingClientRect = () => box(0, 20, 600, 30)
    paragraph.getBoundingClientRect = () => box(0, paragraphTop, 600, 30)
    heading.getClientRects = () => [heading.getBoundingClientRect()] as unknown as DOMRectList
    paragraph.getClientRects = () => [paragraph.getBoundingClientRect()] as unknown as DOMRectList
    const anchored = container.querySelector<HTMLElement>('[data-flow-overlay-item="anchored"]')!
    const fixed = container.querySelector<HTMLElement>('[data-flow-overlay-item="fixed"]')!
    const global = container.querySelector<HTMLElement>('[data-flow-overlay-item="global"]')!
    const globalBefore = { left: global.style.left, top: global.style.top }
    article.dispatchEvent(new Event('scroll'))
    expect({ left: anchored.style.left, top: anchored.style.top }).toEqual({ left: '200px', top: '110px' })
    expect({ left: fixed.style.left, top: fixed.style.top }).toEqual({ left: '30px', top: '40px' })
    paperWidth = 1000; paragraphTop = 160
    article.dispatchEvent(new Event('scroll'))
    expect({ left: anchored.style.left, top: anchored.style.top }).toEqual({ left: '250px', top: '170px' })
    expect({ left: fixed.style.left, top: fixed.style.top }).toEqual({ left: '30px', top: '40px' })
    expect({ left: global.style.left, top: global.style.top }).toEqual(globalBefore)
    await host.destroy()
  })

  it('renders a cropped body image from the managed asset and retains its caption', async () => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') HTMLElement.prototype.scrollIntoView = function () {}
    const host = new FlowSurfaceHost(source())
    const container = document.createElement('div'); document.body.appendChild(container)
    await host.mount(container); await host.activate()
    const figure = container.querySelector<HTMLElement>('[data-flow-block-id="image"]')!
    const clipped = figure.querySelector<HTMLElement>('div')!
    const image = clipped.querySelector<HTMLImageElement>('img')!
    Object.defineProperties(image, { naturalWidth: { value: 640, configurable: true }, naturalHeight: { value: 360, configurable: true } })
    image.dispatchEvent(new Event('load'))
    expect(image.src).toBe('https://example.test/photo.png')
    expect(clipped.style.aspectRatio).toBe('448 / 288')
    expect(clipped.style.overflow).toBe('hidden')
    expect(Number.parseFloat(image.style.left)).toBeCloseTo(-14.285714, 5)
    expect(figure.querySelector('figcaption')?.textContent).toBe('说明')
    await host.destroy()
  })

  it('projects a hidden nested anchor from its visible section without changing the stored anchor', async () => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') HTMLElement.prototype.scrollIntoView = function () {}
    const course = source()
    const surface = course.surfaces[0]!
    surface.blocks = [{ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: '分节' }] }, collapsedByDefault: true,
      blocks: [{ id: 'nested', type: 'paragraph', content: { inlines: [{ type: 'text', text: '隐藏正文' }] } }] }]
    surface.surfaceLayerItems[0]!.paragraphAnchor = { blockId: 'nested', offsetY: 12, xRatio: 0.25 }
    const location = course.locations[0]!
    if (location.kind !== 'flow-block') throw new Error('Expected Flow location')
    location.blockId = 'section'
    const host = new FlowSurfaceHost(course)
    const container = document.createElement('div'); document.body.appendChild(container)
    await host.mount(container); await host.activate()
    const paper = container.querySelector<HTMLElement>('.flow-runtime-reading')!
    const article = container.querySelector<HTMLElement>('.flow-runtime-article')!
    const section = container.querySelector<HTMLElement>('[data-flow-block-id="section"]')!
    const nested = container.querySelector<HTMLElement>('[data-flow-block-id="nested"]')!
    paper.getBoundingClientRect = () => box(0, 0, 800, 600)
    section.getBoundingClientRect = () => box(0, 70, 600, 100)
    section.getClientRects = () => [section.getBoundingClientRect()] as unknown as DOMRectList
    nested.getClientRects = () => [] as unknown as DOMRectList
    article.dispatchEvent(new Event('scroll'))
    const anchored = container.querySelector<HTMLElement>('[data-flow-overlay-item="anchored"]')!
    expect({ left: anchored.style.left, top: anchored.style.top }).toEqual({ left: '200px', top: '82px' })
    expect(host.surface.surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe('nested')
    await host.destroy()
  })

  it('updates an anchor on body resize with zoom and scroll, then disconnects its observer', async () => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') HTMLElement.prototype.scrollIntoView = function () {}
    const observers: Array<{ targets: Set<Element>; disconnected: boolean; notify(): void }> = []
    class FakeResizeObserver {
      targets = new Set<Element>()
      disconnected = false
      constructor(private readonly callback: ResizeObserverCallback) { observers.push(this) }
      observe(target: Element) { this.targets.add(target) }
      unobserve(target: Element) { this.targets.delete(target) }
      disconnect() { this.disconnected = true; this.targets.clear() }
      notify() { this.callback([], this as unknown as ResizeObserver) }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const view = { state: { zoom: 2, pan: { x: 0, y: 0 } }, register: () => {}, refreshBounds: () => {} } as unknown as PlaybackViewSession
    const host = new FlowSurfaceHost(source(), { playbackView: view })
    const container = document.createElement('div'); document.body.appendChild(container)
    await host.mount(container); await host.activate()
    const root = container.querySelector<HTMLElement>('.flow-surface-host')!
    const paper = container.querySelector<HTMLElement>('.flow-runtime-reading')!
    const article = container.querySelector<HTMLElement>('.flow-runtime-article')!
    const heading = container.querySelector<HTMLElement>('[data-flow-block-id="h"]')!
    const paragraph = container.querySelector<HTMLElement>('[data-flow-block-id="p"]')!
    root.getBoundingClientRect = () => box(0, 0, 1000, 700)
    paper.getBoundingClientRect = () => box(0, -40, 1600, 1200)
    heading.getBoundingClientRect = () => box(0, 0, 1200, 60)
    heading.getClientRects = () => [heading.getBoundingClientRect()] as unknown as DOMRectList
    let paragraphTop = 100
    paragraph.getBoundingClientRect = () => box(0, -40 + paragraphTop * 2, 1200, 60)
    paragraph.getClientRects = () => [paragraph.getBoundingClientRect()] as unknown as DOMRectList
    article.scrollTop = 20
    const bodyObserver = observers.find(observer => [...observer.targets].some(target => target.classList.contains('flow-runtime-reading')))
    expect(bodyObserver).toBeDefined()
    bodyObserver!.notify()
    const anchored = container.querySelector<HTMLElement>('[data-flow-overlay-item="anchored"]')!
    expect({ left: anchored.style.left, top: anchored.style.top }).toEqual({ left: '200px', top: '90px' })
    paragraphTop = 160
    bodyObserver!.notify()
    expect({ left: anchored.style.left, top: anchored.style.top }).toEqual({ left: '200px', top: '150px' })
    await host.destroy()
    expect(bodyObserver!.disconnected).toBe(true)
    paragraphTop = 300; bodyObserver!.notify()
    expect(anchored.style.top).toBe('150px')
  })

  it.each([false, true])('keeps the image asset with zero crop field present=%s', async explicitCrop => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') HTMLElement.prototype.scrollIntoView = function () {}
    const course = source()
    const imageBlock = course.surfaces[0]!.blocks.find(block => block.id === 'image')!
    if (imageBlock.type !== 'media') throw new Error('Expected image block')
    if (explicitCrop) imageBlock.crop = { left: 0, top: 0, right: 0, bottom: 0 }
    else delete imageBlock.crop
    const host = new FlowSurfaceHost(course)
    const container = document.createElement('div'); document.body.appendChild(container)
    await host.mount(container); await host.activate()
    const figure = container.querySelector<HTMLElement>('[data-flow-block-id="image"]')!
    const image = figure.querySelector<HTMLImageElement>('img')!
    expect(image.src).toBe('https://example.test/photo.png')
    expect(Boolean(image.parentElement === figure)).toBe(!explicitCrop)
    if (explicitCrop) {
      Object.defineProperties(image, { naturalWidth: { value: 640, configurable: true }, naturalHeight: { value: 360, configurable: true } })
      image.dispatchEvent(new Event('load'))
      expect(image.parentElement?.style.aspectRatio).toBe('640 / 360')
    }
    await host.destroy()
  })
})
