import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { isControllerFixture } from '../fixtures/teacherController'
import { PLAYBACK_VIEW_CHROME_GUTTER } from '@/shared/playbackViewGeometry'
import { afterEach, describe, expect, it } from 'vitest'
import { PlaybackViewSession, playbackGestureOccupied, playbackPanRange } from '@/player/playbackViewSession'

import { addCourseFlowPage } from '@/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createPublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'


const size = (element: HTMLElement, width: number, height: number) => {
  Object.defineProperties(element, { clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height } })
}
function mountView() {
  const container = document.createElement('div'); document.body.appendChild(container)
  const view = new PlaybackViewSession(); const viewport = view.mount(container)
  size(viewport, 800, 600); view.resize()
  return { view, viewport, container }
}
afterEach(() => document.body.replaceChildren())
describe('Playback observation ownership', () => {
  
  it('keeps observation bars outside the Flow document scrollbar and preserves independent scroll state', () => {
    const { view, viewport, container } = mountView()
    const article = document.createElement('article')
    article.style.overflow = 'auto'; viewport.append(article); article.scrollTop = 230
    const vertical = container.querySelector<HTMLElement>('[data-playback-chrome="y-bar"]')!
    const horizontal = container.querySelector<HTMLElement>('[data-playback-chrome="x-bar"]')!
    expect(viewport.contains(vertical)).toBe(false)
    expect(viewport.contains(horizontal)).toBe(false)
    expect(parseFloat(viewport.style.inset)).toBe(0)
    expect(vertical.hidden).toBe(true)
    expect(horizontal.hidden).toBe(true)
    expect(vertical.tabIndex).toBe(-1)
    view.zoomTo(2)
    expect(vertical.hidden).toBe(false)
    expect(horizontal.hidden).toBe(false)
    expect(view.chrome.insets).toEqual({ right: PLAYBACK_VIEW_CHROME_GUTTER, bottom: PLAYBACK_VIEW_CHROME_GUTTER })
    vertical.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(view.state.pan.y).toBe(-618)
    expect(article.scrollTop).toBe(230)
    article.scrollTop = 410
    expect(view.state.pan.y).toBe(-618)
    view.reset()
    expect(vertical.hidden).toBe(true)
    expect(view.chrome.insets).toEqual({ right: 0, bottom: 0 })
    expect(article.scrollTop).toBe(410)
    view.destroy()
  })
  it('shows only the overflowing axis at 100%, tolerates subpixels and returns hidden bar focus to the viewport', () => {
    const { view, viewport, container } = mountView()
    const root = document.createElement('div'), content = document.createElement('div'), item = document.createElement('div')
    item.dataset.playbackBounds = 'true'; content.append(item); root.append(content); viewport.append(root)
    let extraWidth = 60, extraHeight = 0.25
    item.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 800 + extraWidth, height: 600 + extraHeight })
    view.register({ id: 'flow', kind: 'flow', root, content }); view.activate('flow')
    const horizontal = container.querySelector<HTMLElement>('[data-playback-chrome="x-bar"]')!
    const vertical = container.querySelector<HTMLElement>('[data-playback-chrome="y-bar"]')!
    expect(horizontal.hidden).toBe(false); expect(vertical.hidden).toBe(true)
    horizontal.focus(); extraWidth = 0; extraHeight = 0; view.refreshBounds()
    expect(horizontal.hidden).toBe(true); expect(document.activeElement).toBe(viewport)
    expect(view.state.viewport).toEqual({ width: 800, height: 600 })
    view.destroy()
  })
  it('keeps the pointed content fixed, exposes every corner and clamps after shrinking or resize', () => {
    const { view, viewport } = mountView()
    view.zoomTo(2, { x: 200, y: 150 })
    expect(view.state.pan).toEqual({ x: -200, y: -150 })
    expect((200 - view.state.pan.x) / view.state.zoom).toBe(200)
    expect(playbackPanRange(view.state)).toEqual({ x: { min: -818, max: 0 }, y: { min: -618, max: 0 } })
    view.panTo({ x: -800, y: -600 })
    view.zoomTo(.5)
    expect(view.state.pan).toEqual({ x: 0, y: 0 })
    view.zoomTo(4); view.panTo({ x: -2400, y: -1800 })
    size(viewport, 400, 300); view.resize()
    expect(view.state.pan).toEqual({ x: -1218, y: -918 })
    view.destroy()
  })
  it('measures bounds against the new DOM matrix after resize and switching hosts', () => {
    const { view, viewport } = mountView()
    const host = (id: string) => {
      const root = document.createElement('div'), content = document.createElement('div'), runtime = document.createElement('div')
      runtime.dataset.playbackBounds = 'true'; content.append(runtime); root.append(content); viewport.append(root)
      runtime.getBoundingClientRect = () => {
        const base = Number(root.dataset.stageFitScale)
        const transform = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(content.style.transform)!
        const z = Number(transform[3])
        return DOMRect.fromRect({ x: parseFloat(root.style.left) + Number(transform[1]) * base,
          y: parseFloat(root.style.top) + Number(transform[2]) * base, width: 1280 * base * z, height: 720 * base * z })
      }
      view.register({ id, kind: 'slide', root, content })
    }
    host('a'); host('b'); view.activate('a'); view.zoomTo(2); view.panTo({ x: -800, y: -600 })
    size(viewport, 400, 300); view.resize()
    expect(view.state.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    view.activate('b')
    expect(view.state.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(view.state.zoom).toBe(1)
    const button = document.createElement('button'); viewport.append(button); view.openZoomPanel(button)
    view.resize()
    expect(viewport.parentElement!.querySelector('[data-playback-chrome="zoom-panel"]')).toBeNull()
    view.destroy()
  })
  it('uses the same state for keyboard bars, wheel and restore, and ignores dynamic/input focus', () => {
    const { view, viewport, container } = mountView()
    const content = document.createElement('div'), dynamic = document.createElement('div'), input = document.createElement('input')
    dynamic.dataset.layerKind = 'runtime'; dynamic.append(input); viewport.append(content, dynamic)
    const blocked = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -300 })
    dynamic.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(false); expect(view.state.zoom).toBe(1)
    content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -Math.log(2) / .002 }))
    expect(view.state.zoom).toBeCloseTo(2)
    const bar = container.querySelector<HTMLElement>('[aria-label="左右移动视图"]')!
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    expect(view.state.pan.x).toBeCloseTo(-818)
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(view.state.zoom).toBeCloseTo(2)
    viewport.focus(); viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(view.state.zoom).toBe(1); expect(view.state.pan).toEqual({ x: 0, y: 0 })
    view.destroy()
  })
  it('cancels a frozen bar drag when zoom changes and keeps focus while the panel value changes', () => {
    const { view, container } = mountView(); view.zoomTo(2)
    const bar = container.querySelector<HTMLElement>('[aria-label="左右移动视图"]')!
    bar.firstElementChild!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 9, clientX: 200, bubbles: true }))
    view.zoomTo(3)
    const expected = view.state.pan
    bar.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500, bubbles: true }))
    expect(view.state.pan).toEqual(expected)
    const button = document.createElement('button'); container.append(button); view.openZoomPanel(button)
    const plus = container.querySelector<HTMLButtonElement>('[aria-label="放大"]')!
    plus.focus(); plus.click()
    expect(document.activeElement).toBe(plus)
    expect(container.querySelector('output')?.textContent).toBe('325%')
    container.querySelector<HTMLButtonElement>('[aria-label="恢复视图"]')!.click()
    expect(view.state.zoom).toBe(1)
    view.destroy()
  })
  it('never assumes unknown targets or mixed touch starts are transferable', () => {
    const { view, viewport } = mountView()
    const native = document.createElement('div'), frame = document.createElement('iframe'); viewport.append(native, frame)
    expect(playbackGestureOccupied(frame, viewport)).toBe(true)
    const a = { identifier: 1, target: native, clientX: 50, clientY: 50 }
    const b = { identifier: 2, target: frame, clientX: 100, clientY: 50 }
    const send = (type: string, touches: unknown[], changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
      native.dispatchEvent(event); return event
    }
    send('touchstart', [a], [a]); send('touchstart', [a, b], [b])
    expect(send('touchmove', [a, { ...b, clientX: 200 }]).defaultPrevented).toBe(false)
    expect(view.state.zoom).toBe(1)
    send('touchend', [], [a, b])
    const c = { ...b, target: native }
    send('touchstart', [a, c]); send('touchmove', [a, { ...c, clientX: 150 }])
    expect(view.state.zoom).toBe(2)
    send('touchmove', [a, { ...c, clientX: 175 }])
    expect(view.state.zoom).toBe(2.5)
    view.destroy()
  })
  
  it('hands two native touches to observation without also dragging Flow paper', async () => {
    const initial = createBlankCourseProject({ id: 'touch-flow', now: '2026-09-07T00:00:00.000Z' })
    const added = addCourseFlowPage(initial, { title: '阅读', now: '2026-09-07T00:00:00.000Z', expectedRevision: initial.revision })
    if (!added.ok) throw new Error(added.reason)
    const payload = buildPublishedCourseV2Payload({ project: added.project, assetFiles: {}, components: {} })
    const location = payload.locations.find(item => item.kind === 'flow-block')!
    const session = createPublishedCourseSession(payload, { initialLocationId: location.id })
    const container = document.createElement('div'); document.body.append(container); await session.mount(container)
    const article = container.querySelector<HTMLElement>('.flow-runtime-article')!
    Object.defineProperties(article, { scrollHeight: { value: 3000 }, clientHeight: { value: 600 } })
    article.scrollTop = 1000
    const pointer = (type: string, id: number, y: number) => article.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, button: 0, clientY: y }))
    const a = { identifier: 1, target: article, clientX: 50, clientY: 50 }, b = { identifier: 2, target: article, clientX: 100, clientY: 50 }
    const touch = (type: string, touches: unknown[], changedTouches = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } }); article.dispatchEvent(event)
    }
    pointer('pointerdown', 1, 50); touch('touchstart', [a], [a])
    pointer('pointerdown', 2, 50); touch('touchstart', [a, b], [b])
    pointer('pointermove', 2, 100)
    touch('touchmove', [a, { ...b, clientX: 150 }])
    expect(session.playbackView!.state.zoom).toBe(2)
    expect(article.scrollTop).toBe(1000)
    touch('touchend', [a], [b]); pointer('pointermove', 1, 120)
    expect(article.scrollTop).toBe(1000)
    await session.destroy()
  })
  it('preserves the actual host and navigation across zoom and restore', async () => {
    const project = createBlankCourseProject({ id: 'view-test', now: '2026-09-07T00:00:00.000Z' })
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const session = createPublishedCourseSession(payload)
    const container = document.createElement('div'); document.body.append(container)
    await session.mount(container)
    const root = container.querySelector('.slide-published-adapter')
    const location = session.navigator.current
    const state = session.playbackView!
    state.zoomTo(2); state.panTo({ x: -100, y: -100 }); state.reset()
    expect(container.querySelector('.slide-published-adapter')).toBe(root)
    expect(session.navigator.current).toEqual(location)
    await session.destroy()
    expect(container.querySelector('[data-playback-view]')).toBeNull()
  })
})
