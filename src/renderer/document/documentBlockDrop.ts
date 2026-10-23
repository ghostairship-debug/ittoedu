import { documentBlockChildren, type DocumentBlock, type DocumentContent } from '../../shared/document/content'

export interface DocumentBlockDropTarget {
  targetId: string
  side: 'before' | 'after' | 'inside'
  left: number
  top: number
  width: number
}

/** The shared pointer target for block moves and media insertion. */
export function documentBlockContainerAt(content: DocumentContent, root: HTMLElement, point: { x: number; y: number }, excluded: ReadonlySet<string> = new Set()) {
  const elements = new Map([...root.querySelectorAll<HTMLElement>('[data-flow-block-id]')]
    .map(element => [element.dataset.flowBlockId!, element]))
  const rect = (block: DocumentBlock) => {
    const bounds = elements.get(block.id)?.getBoundingClientRect()
    return bounds && bounds.height > 0 && bounds.width > 0 ? bounds : null
  }
  const horizontal = (bounds: DOMRect) => point.x >= bounds.left && point.x <= bounds.right
  const contains = (bounds: DOMRect) => horizontal(bounds) && point.y >= bounds.top && point.y <= bounds.bottom
  function container(blocks: readonly DocumentBlock[], parent: DocumentBlock | null): { blocks: readonly DocumentBlock[]; parent: DocumentBlock | null } {
    const children = blocks.filter(block => !excluded.has(block.id) && documentBlockChildren(block) && rect(block))
    let child = children.find(block => contains(rect(block)!))
    // A short column still owns the blank space beside a taller sibling. This is
    // limited to actual side-by-side reading containers, not arbitrary CSS order.
    if (!child && parent?.type === 'course-instance') child = children.find(block => {
      const bounds = rect(block)!
      return horizontal(bounds) && children.some(other => {
        const sibling = rect(other)!
        return sibling.left >= bounds.right || sibling.right <= bounds.left
      })
    })
    return child ? container(documentBlockChildren(child)!, child) : { blocks, parent }
  }
  return { ...container(content.blocks, null), rect }
}

/** Resolve the reading container in two dimensions, then its logical insertion edge.
 * The document tree supplies order; DOM rectangles supply only the user's column. */
export function documentBlockDropTarget(content: DocumentContent, root: HTMLElement, sourceId: string,
  point: { x: number; y: number }): DocumentBlockDropTarget | null {
  const excluded = new Set<string>()
  const exclude = (blocks: readonly DocumentBlock[]) => {
    for (const block of blocks) { excluded.add(block.id); const children = documentBlockChildren(block); if (children) exclude(children) }
  }
  let found = false
  const find = (blocks: readonly DocumentBlock[]) => {
    for (const block of blocks) {
      if (block.id === sourceId) { found = true; exclude([block]); return }
      const children = documentBlockChildren(block); if (children) find(children)
    }
  }
  find(content.blocks)
  if (!found) return null
  const destination = documentBlockContainerAt(content, root, point, excluded), { rect } = destination
  const candidates = destination.blocks.filter(block => !excluded.has(block.id) && rect(block))
  if (!candidates.length) {
    const bounds = destination.parent && rect(destination.parent)
    return bounds ? { targetId: destination.parent!.id, side: 'inside', top: bounds.top, left: bounds.left, width: bounds.width } : null
  }
  let closest: DocumentBlockDropTarget | null = null, distance = Infinity
  for (const block of candidates) {
    const bounds = rect(block)!
    for (const side of ['before', 'after'] as const) {
      const top = side === 'before' ? bounds.top : bounds.bottom
      if (Math.abs(point.y - top) < distance) {
        distance = Math.abs(point.y - top)
        closest = { targetId: block.id, side, top, left: bounds.left, width: bounds.width }
      }
    }
  }
  return closest
}
