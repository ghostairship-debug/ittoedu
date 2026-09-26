import { describe, expect, it } from 'vitest'
import { flowMediaFloatAnchor } from '@/renderer/ui/flow/flowMediaFloatPlacement'
import { flowParagraphAnchoredFrame } from '@/shared/flowParagraphAnchors'

const frame = { x: 100, y: 300, width: 420, height: 220 }
const block = (blockId: string, y: number) => ({ blockId, depth: 0, x: 24, y, width: 600, height: 60 })

describe('Flow media float placement', () => {
  it('anchors to a preceding survivor with an offset that preserves the visible paper position', () => {
    const anchor = flowMediaFloatAnchor('media', frame, 800, [block('paragraph', 100), block('media', 300), block('later', 560)])
    expect(anchor).toEqual({ blockId: 'paragraph', offsetY: 200, xRatio: 0.125 })
    expect(flowParagraphAnchoredFrame(anchor!, frame, 800, [block('paragraph', 100), block('later', 340)]))
      .toMatchObject({ x: 100, y: 300 })
  })

  it('uses the source replacement when only a later block survives', () => {
    const first = { ...frame, y: 24 }
    const anchor = flowMediaFloatAnchor('media', first, 800, [block('media', 24), block('later', 260)])
    expect(anchor).toEqual({ blockId: 'media', offsetY: 0, xRatio: 0.125 })
    expect(flowMediaFloatAnchor('media', first, 800, [block('later', 260)])).toBeNull()
  })
})
