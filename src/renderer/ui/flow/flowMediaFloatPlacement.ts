import { flowParagraphAnchorAt, type FlowParagraphAnchor, type FlowParagraphBlockRect } from '../../../shared/flowParagraphAnchors'
import type { FlowRect } from '../../../shared/flowViewportGeometry'

/** Choose a block that keeps its paper position when the media leaves the document. */
export function flowMediaFloatAnchor(
  sourceBlockId: string,
  frame: FlowRect,
  paperWidth: number,
  rects: readonly FlowParagraphBlockRect[],
): FlowParagraphAnchor | null {
  const source = rects.find(rect => rect.blockId === sourceBlockId)
  if (!source || !Number.isFinite(paperWidth) || paperWidth <= 0
    || ![frame.x, frame.y, frame.width, frame.height, source.y, source.width, source.height].every(Number.isFinite)
    || source.width <= 0 || source.height <= 0) return null
  const preceding = rects.filter(rect => rect.blockId !== sourceBlockId && rect.y <= frame.y)
  return flowParagraphAnchorAt(frame, paperWidth, preceding)
    ?? { blockId: sourceBlockId, offsetY: frame.y - source.y, xRatio: frame.x / paperWidth }
}
