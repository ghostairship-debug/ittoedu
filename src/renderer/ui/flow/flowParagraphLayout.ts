import type { FlowParagraphBlockRect } from '../../../shared/flowParagraphAnchors'

function depthWithin(element: Element, root: Element): number {
  let depth = 0
  for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent.hasAttribute('data-flow-block-id')) depth += 1
  }
  return depth
}

/** Read DOM layout in unscaled paper coordinates. This observation is never canonical project state. */
export function measureFlowParagraphLayout(paper: HTMLElement, scale = 1): readonly FlowParagraphBlockRect[] {
  const paperRect = paper.getBoundingClientRect()
  if (!Number.isFinite(scale) || scale <= 0 || paperRect.width <= 0) return []
  const seen = new Set<string>()
  const blocks: FlowParagraphBlockRect[] = []
  for (const element of paper.querySelectorAll<HTMLElement>('[data-flow-block-id]')) {
    const blockId = element.dataset.flowBlockId
    if (!blockId || seen.has(blockId) || element.getClientRects().length === 0) continue
    const rect = element.getBoundingClientRect()
    const width = rect.width / scale, height = rect.height / scale
    if (width <= 0 || height <= 0) continue
    seen.add(blockId)
    blocks.push({ blockId, depth: depthWithin(element, paper), x: (rect.left - paperRect.left) / scale,
      y: (rect.top - paperRect.top) / scale, width, height })
  }
  return blocks
}

/** Batch DOM, size, and viewport changes into one read per animation frame. */
export function observeFlowParagraphLayout(paper: HTMLElement, onLayout: (blocks: readonly FlowParagraphBlockRect[]) => void, scale = () => 1): () => void {
  let pending = 0
  let disposed = false
  const schedule = () => {
    if (!pending && !disposed) pending = requestAnimationFrame(() => { pending = 0; if (!disposed) onLayout(measureFlowParagraphLayout(paper, scale())) })
  }
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { watchSizes(); schedule() })
  const observed = new Set<Element>()
  const watchSizes = () => {
    if (!resize) return
    const present = new Set<Element>([paper, ...paper.querySelectorAll('[data-flow-block-id]')])
    for (const element of observed) {
      if (present.has(element)) continue
      resize.unobserve(element); observed.delete(element)
    }
    for (const element of present) {
      if (observed.has(element)) continue
      observed.add(element); resize.observe(element)
    }
  }
  watchSizes()
  mutation?.observe(paper, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-flow-block-id'] })
  window.addEventListener('resize', schedule)
  schedule()
  return () => { disposed = true; if (pending) cancelAnimationFrame(pending); resize?.disconnect(); mutation?.disconnect(); window.removeEventListener('resize', schedule) }
}
