import { afterEach, describe, expect, it, vi } from 'vitest'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '@/shared/flowParagraphAnchors'
import { measureFlowParagraphLayout, observeFlowParagraphLayout } from '@/renderer/ui/flow/flowParagraphLayout'

const blocks: FlowParagraphBlockRect[] = [
  { blockId: 'section', depth: 0, x: 20, y: 20, width: 600, height: 220 },
  { blockId: 'first', depth: 1, x: 32, y: 40, width: 560, height: 30 },
  { blockId: 'second', depth: 1, x: 32, y: 120, width: 560, height: 30 },
  { blockId: 'after', depth: 0, x: 20, y: 300, width: 600, height: 40 },
]
const frame = { x: 200, y: 130, width: 90, height: 50 }

describe('Flow paragraph anchor geometry', () => {
  it('selects the deepest visible block at the frame top and preserves its offset and horizontal ratio', () => {
    const anchor = flowParagraphAnchorAt(frame, 800, blocks)
    expect(anchor).toEqual({ blockId: 'second', offsetY: 10, xRatio: 0.25 })
    expect(flowParagraphAnchoredFrame(anchor!, frame, 1000, blocks.map(block => block.blockId === 'second' ? { ...block, y: 180 } : block)))
      .toEqual({ x: 250, y: 190, width: 90, height: 50 })
    expect(frame).toEqual({ x: 200, y: 130, width: 90, height: 50 })
  })

  it('uses the previous visible block in gaps, first block above the document, and permits off-paper ratios', () => {
    expect(flowParagraphAnchorAt({ ...frame, x: -40, y: 90 }, 800, blocks)).toEqual({ blockId: 'first', offsetY: 50, xRatio: -0.05 })
    expect(flowParagraphAnchorAt({ ...frame, y: -10 }, 800, blocks)).toEqual({ blockId: 'section', offsetY: -30, xRatio: 0.25 })
    expect(flowParagraphAnchorAt({ ...frame, x: 880, y: 400 }, 800, blocks)).toEqual({ blockId: 'after', offsetY: 100, xRatio: 1.1 })
  })

  it('uses a visible ancestor for a collapsed target while retaining the authored block id', () => {
    const anchor = { blockId: 'second', offsetY: 10, xRatio: 0.25 }
    expect(flowParagraphAnchoredFrame(anchor, frame, 800, [blocks[0], blocks[3]], ['section']))
      .toEqual({ ...frame, y: 30 })
    expect(anchor.blockId).toBe('second')
    expect(flowParagraphAnchoredFrame(anchor, frame, 800, [blocks[3]])).toBeNull()
  })

  it('does not invent anchors before paper and block layout exists', () => {
    expect(flowParagraphAnchorAt(frame, 0, blocks)).toBeNull()
    expect(flowParagraphAnchorAt(frame, 800, [])).toBeNull()
    expect(flowParagraphAnchorAt(frame, 800, [{ ...blocks[0], width: 0 }])).toBeNull()
    expect(flowParagraphAnchoredFrame({ blockId: 'first', offsetY: 0, xRatio: 0.2 }, frame, 0, blocks)).toBeNull()
  })
})

describe('Flow paragraph layout observation', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

  it('reads nested visible block rectangles relative to the paper without creating project state', () => {
    const paper = document.createElement('article'), parent = document.createElement('section'), child = document.createElement('p')
    parent.dataset.flowBlockId = 'section'; child.dataset.flowBlockId = 'first'; parent.append(child); paper.append(parent); document.body.append(paper)
    const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) })
    paper.getBoundingClientRect = () => rect(100, 200, 800, 600)
    parent.getBoundingClientRect = () => rect(120, 240, 600, 200)
    child.getBoundingClientRect = () => rect(130, 260, 560, 40)
    parent.getClientRects = () => [parent.getBoundingClientRect()] as unknown as DOMRectList
    child.getClientRects = () => [child.getBoundingClientRect()] as unknown as DOMRectList
    expect(measureFlowParagraphLayout(paper, 2)).toEqual([
      { blockId: 'section', depth: 0, x: 10, y: 20, width: 300, height: 100 },
      { blockId: 'first', depth: 1, x: 15, y: 30, width: 280, height: 20 },
    ])
  })

  it('coalesces updates into one animation frame and stops after disposal', () => {
    const paper = document.createElement('article'), callback = vi.fn()
    paper.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    let next = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.set(++next, fn); return next })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
    const stop = observeFlowParagraphLayout(paper, callback)
    window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'))
    expect(callbacks.size).toBe(1)
    callbacks.get(1)?.(0)
    expect(callback).toHaveBeenCalledTimes(1)
    stop(); window.dispatchEvent(new Event('resize'))
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callbacks.size).toBe(1)
  })
})
