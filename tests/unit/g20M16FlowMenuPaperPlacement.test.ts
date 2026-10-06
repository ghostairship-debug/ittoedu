import { describe, expect, it } from 'vitest'
import { flowMenuPaperPlacement } from '../../src/renderer/ui/flow/flowMenuPaperPlacement'
import type { FlowMenuPageCapture } from '../../src/renderer/document/flowWorkspaceRegistry'

type CapturedPage = Extract<FlowMenuPageCapture, { ok: true }>
const page: CapturedPage = {
  ok: true, documentId: 'doc', projectId: 'project', revision: 3,
  locationId: 'location', surfaceId: 'surface', generation: 2,
  selectedBlockId: 'second', selectionSignature: '{}', paperWidth: 800, bodyWidth: 728,
  paragraphRects: [
    { blockId: 'first', depth: 0, x: 36, y: 28, width: 728, height: 24 },
    { blockId: 'second', depth: 0, x: 36, y: 80, width: 728, height: 32 },
  ],
}

describe('Flow paper menu placement', () => {
  it('anchors the new object to the selected paragraph at its observed paper position', () => {
    const result = flowMenuPaperPlacement(page, { width: 280, height: 120 })
    expect(result).toEqual({
      frame: { mode: 'absolute', x: 36, y: 128, width: 280, height: 120 },
      paragraphAnchor: { blockId: 'second', offsetY: 48, xRatio: 36 / 800 },
    })
  })

  it('uses the block under the object top edge when another paragraph starts before the chosen position', () => {
    const dense = { ...page, selectedBlockId: 'first', paragraphRects: [
      { blockId: 'first', depth: 0, x: 36, y: 28, width: 728, height: 24 },
      { blockId: 'second', depth: 0, x: 36, y: 55, width: 728, height: 24 },
    ] }
    expect(flowMenuPaperPlacement(dense, { width: 280, height: 120 }).paragraphAnchor)
      .toEqual({ blockId: 'second', offsetY: 13, xRatio: 36 / 800 })
  })

  it('uses the deepest visible nested block at the object top edge', () => {
    const nested = { ...page, paragraphRects: [
      { blockId: 'section', depth: 0, x: 36, y: 20, width: 728, height: 220 },
      { blockId: 'second', depth: 1, x: 48, y: 80, width: 700, height: 32 },
      { blockId: 'third', depth: 1, x: 48, y: 115, width: 700, height: 24 },
    ] }
    expect(flowMenuPaperPlacement(nested, { width: 280, height: 120 }).paragraphAnchor)
      .toEqual({ blockId: 'third', offsetY: 13, xRatio: 48 / 800 })
  })

  it('uses the empty-body anchor only for a genuinely empty page', () => {
    const empty = flowMenuPaperPlacement({ ...page, selectedBlockId: null, paragraphRects: [] }, { width: 280, height: 120 })
    expect(empty.paragraphAnchor).toEqual({ kind: 'empty-body', offsetY: 24, xRatio: 36 / 800 })
    expect(() => flowMenuPaperPlacement({ ...page, selectedBlockId: null }, { width: 280, height: 120 })).toThrow('请选择')
  })

  it('waits for paper or paragraph layout rather than saving an unanchored item', () => {
    expect(() => flowMenuPaperPlacement({ ...page, paperWidth: 0 }, { width: 280, height: 120 })).toThrow('纸面')
    expect(() => flowMenuPaperPlacement({ ...page, paragraphRects: [] }, { width: 280, height: 120 })).toThrow('段落')
  })
})
