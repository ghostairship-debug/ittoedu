import type { FlowRect } from './flowViewportGeometry'

export interface FlowParagraphAnchor { readonly blockId: string; readonly offsetY: number; readonly xRatio: number }
export interface FlowParagraphBlockRect extends FlowRect { readonly blockId: string; readonly depth: number }

function laidOut(paperWidth: number, blocks: readonly FlowParagraphBlockRect[]): boolean {
  return Number.isFinite(paperWidth) && paperWidth > 0 && blocks.some(block => block.width > 0 && block.height > 0)
}

function visible(block: FlowParagraphBlockRect): boolean {
  return Boolean(block.blockId) && [block.x, block.y, block.width, block.height].every(Number.isFinite) && block.width > 0 && block.height > 0
}

/** Resolve a paper frame's top edge to the last visible document block at or before it. */
export function flowParagraphAnchorAt(frame: FlowRect, paperWidth: number, blocks: readonly FlowParagraphBlockRect[]): FlowParagraphAnchor | null {
  if (!laidOut(paperWidth, blocks) || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) return null
  const ordered = blocks.filter(visible).sort((a, b) => a.y - b.y || a.depth - b.depth)
  if (ordered.length === 0) return null
  let target = ordered[0]
  for (const block of ordered) {
    if (block.y > frame.y) break
    target = block
  }
  return { blockId: target.blockId, offsetY: frame.y - target.y, xRatio: frame.x / paperWidth }
}

/** Project an authored paper frame without modifying its width, height, or stored absolute position. */
export function flowParagraphAnchoredFrame(
  anchor: FlowParagraphAnchor,
  frame: FlowRect,
  paperWidth: number,
  blocks: readonly FlowParagraphBlockRect[],
  visibleAncestorIds: readonly string[] = [],
): FlowRect | null {
  if (!laidOut(paperWidth, blocks) || ![anchor.offsetY, anchor.xRatio, frame.width, frame.height].every(Number.isFinite)) return null
  const target = [anchor.blockId, ...visibleAncestorIds]
    .map(id => blocks.find(block => block.blockId === id && visible(block)))
    .find((block): block is FlowParagraphBlockRect => Boolean(block))
  if (!target) return null
  return { ...frame, x: anchor.xRatio * paperWidth, y: target.y + anchor.offsetY }
}
