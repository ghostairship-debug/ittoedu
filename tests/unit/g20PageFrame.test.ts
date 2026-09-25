import { afterEach, describe, expect, it } from 'vitest'
import { fitPage, pageFrameStyle, parsePageInsets, WINDOW_PAGE_INSETS } from '@/shared/pageFrame'
import { createStageViewportTransform, stageViewportPanRange } from '@/renderer/authoring/stageViewportTransform'
import { PlaybackViewSession } from '@/player/playbackViewSession'
import { flowViewportOverlayFrameAt, flowViewportOverlayPoint } from '@/shared/flowViewportGeometry'

const LANDSCAPE = { width: 1280, height: 720 }
const PORTRAIT = { width: 720, height: 1280 }

afterEach(() => document.body.replaceChildren())

describe('M19 one page frame', () => {
  it('shows a landscape page whole and fills the width with a portrait page, top first', () => {
    expect(fitPage({ width: 1000, height: 1000 }, LANDSCAPE)).toEqual({ scale: 1000 / 1280, left: 0, top: (1000 - 562.5) / 2 })
    const portrait = fitPage({ width: 900, height: 600 }, PORTRAIT)
    expect(portrait).toEqual({ scale: 900 / 720, left: 0, top: 0 })
    // A portrait page shorter than a very tall window is centred, not glued to the top.
    expect(fitPage({ width: 360, height: 1000 }, PORTRAIT).top).toBe((1000 - 640) / 2)
    // A Spatial camera frame is always whole.
    expect(fitPage({ width: 900, height: 600 }, PORTRAIT, undefined, 'contain').scale).toBe(600 / 1280)
    // Window margins come off the available space.
    const inset = fitPage({ width: 932, height: 632 }, LANDSCAPE, WINDOW_PAGE_INSETS)
    expect(inset.scale).toBe(900 / 1280)
    expect(inset.left).toBe(16)
  })

  it('reads CSS-like margins and draws the same frame on screen at any fit', () => {
    expect(parsePageInsets('42 22 22 22')).toEqual({ top: 42, right: 22, bottom: 22, left: 22 })
    expect(parsePageInsets('16')).toEqual({ top: 16, right: 16, bottom: 16, left: 16 })
    expect(parsePageInsets('8 12')).toEqual({ top: 8, right: 12, bottom: 8, left: 12 })
    expect(parsePageInsets('abc')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(pageFrameStyle(0.5, true)).toEqual({ boxShadow: '0 36px 84px rgba(0, 0, 0, 0.34)', outline: '2px solid rgba(23, 34, 29, 0.066)', borderRadius: '8px' })
    expect(pageFrameStyle(1, false).boxShadow).toBe('none')
  })

  it('places the edited portrait page like playback and scrolls it edge to edge', () => {
    const viewport = { x: 10, y: 20, width: 900, height: 600 }
    const transform = createStageViewportTransform({ viewport, stage: PORTRAIT, fit: 'page' })
    expect(transform.stageRect).toEqual({ x: 10, y: 20, width: 900, height: 1600 })
    const range = stageViewportPanRange(transform)
    expect(range.x).toBeNull()
    expect(range.y).toEqual({ min: 600 - 1600, max: 0 })
    const scrolled = createStageViewportTransform({ viewport, stage: PORTRAIT, fit: 'page', pan: { x: 0, y: -1000 } })
    expect(scrolled.stageRect.y + scrolled.stageRect.height).toBe(20 + 600)
    // Landscape and the default contain mode keep the whole stage centred, as before.
    expect(createStageViewportTransform({ viewport, stage: LANDSCAPE, fit: 'page' }).stageRect)
      .toEqual(createStageViewportTransform({ viewport, stage: LANDSCAPE }).stageRect)
    expect(stageViewportPanRange(createStageViewportTransform({ viewport, stage: LANDSCAPE, fit: 'page' }))).toEqual({ x: null, y: null })
    expect(createStageViewportTransform({ viewport, stage: PORTRAIT }).stageRect.height).toBe(600)
  })

  it('keeps a screen-anchored Flow overlay in proportion to the view and inside it', () => {
    const canvas = { width: 1280, height: 720 }
    expect(flowViewportOverlayPoint({ x: 640, y: 360, width: 100, height: 40 }, canvas, { width: 640, height: 360 })).toEqual({ x: 320, y: 180 })
    expect(flowViewportOverlayPoint({ x: 1100, y: 700, width: 200, height: 80 }, canvas, { width: 906, height: 606 })).toEqual({ x: 706, y: 526 })
    // A drag writes what is shown back on the canvas.
    expect(flowViewportOverlayFrameAt({ x: 320, y: 180, width: 100, height: 40 }, canvas, { width: 640, height: 360 })).toEqual({ x: 640, y: 360, width: 100, height: 40 })
  })

  it('scrolls a portrait page in playback with the plain wheel and keeps Flow to its own paper', () => {
    const container = document.createElement('div')
    container.dataset.pageInsets = '16'
    document.body.append(container)
    const view = new PlaybackViewSession()
    const viewport = view.mount(container)
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 932 }, clientHeight: { configurable: true, value: 632 } })
    view.resize()
    const root = document.createElement('div'), content = document.createElement('div')
    root.dataset.canvasWidth = '720'; root.dataset.canvasHeight = '1280'
    root.append(content); viewport.append(root)
    view.register({ id: 'slide', kind: 'slide', root, content }); view.activate('slide')
    expect(Number(root.dataset.stageFitScale)).toBe(900 / 720)
    expect(root.style.top).toBe('16px')
    expect(content.style.overflow).toBe('clip')
    const pageBottom = 16 + 1280 * 900 / 720 + 16
    expect(view.state.bounds.height).toBe(pageBottom)
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 300 }))
    expect(view.state.pan.y).toBe(-300)
    const end = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100000 })
    viewport.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(true)
    expect(view.state.pan.y).toBeLessThan(-300)
    const past = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
    viewport.dispatchEvent(past)
    // At the end the wheel is left to the page.
    expect(past.defaultPrevented).toBe(false)

    const flowRoot = document.createElement('div'), flowContent = document.createElement('div')
    flowRoot.append(flowContent); viewport.append(flowRoot)
    view.register({ id: 'flow', kind: 'flow', root: flowRoot, content: flowContent }); view.activate('flow')
    expect(view.scrollBy({ x: 0, y: 100 })).toBe(false)
    view.destroy()
  })
})
