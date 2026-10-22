import type { FlowParagraphBlockRect } from '../../../shared/flowParagraphAnchors'
import type { ComponentContainer, ComponentEdit, ComponentFrame, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { containerChildIds, owningContainer } from '../../../shared/contracts/component-platform/project'
import { flowDocumentBlock } from '../../componentPlatform/surfaces/flow/documentProjection'
import { flowParagraphAnchorAt } from '../../../shared/flowParagraphAnchors'
import { flowReadingMembers } from '../../../core/course/courseFlowEdits'

export { componentClientMatrix as flowContentClientMatrix } from '../../../player/components/runtime/componentClientMatrix'

/** Capture the real reading container beneath the pointer, including nested sections. */
export function flowDocumentInsertionAt(paper: HTMLElement, project: CourseProjectV10, surfaceId: string, point: { x: number; y: number }) {
  const observed = [...paper.querySelectorAll<HTMLElement>('[data-flow-block-id]')]
    .filter(element => flowDocumentBlock(project, surfaceId, element.dataset.flowBlockId!))
  const hit = observed.filter(element => {
    const rect = element.getBoundingClientRect()
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  }).sort((a, b) => depthWithin(b, paper) - depthWithin(a, paper))[0]
  const id = hit?.dataset.flowBlockId
  const block = id && flowDocumentBlock(project, surfaceId, id)
  const container: ComponentContainer = block && block.type === 'section'
    ? { kind: 'instance', instanceId: block.id }
    : id ? owningContainer(project, id) ?? { kind: 'surface', surfaceId } : { kind: 'surface', surfaceId }
  const members = flowReadingMembers(project, container)
  let afterBlockId: string | null = null
  for (const member of members) {
    const element = observed.find(element => element.dataset.flowBlockId === member)
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (point.y < rect.top + rect.height / 2) break
    afterBlockId = member
  }
  const all = containerChildIds(project, container)
  const index = afterBlockId ? all.indexOf(afterBlockId) + 1 : members.length ? all.indexOf(members[0]) : all.length
  return { container, index, afterBlockId }
}

export type FlowFloatingMode = 'fixed' | 'paragraph' | 'viewport'

/** Freeze the displayed frame when changing mode; anchors are created only by an explicit mode command. */
export function flowFloatingModeEdits(instanceId: string, displayed: ComponentFrame, placement: NonNullable<CourseProjectV10['instances'][string]['flowPlacement']>,
  mode: FlowFloatingMode, paperWidth: number, blocks: readonly FlowParagraphBlockRect[], paperOffset: { x: number; y: number }): ComponentEdit[] {
  const space = mode === 'viewport' ? 'viewport' : 'paper'
  const delta = placement.space === space ? { x: 0, y: 0 } : space === 'viewport' ? paperOffset : { x: -paperOffset.x, y: -paperOffset.y }
  const frame: ComponentFrame = { ...displayed, transform: [...displayed.transform.slice(0, 4), displayed.transform[4] + delta.x, displayed.transform[5] + delta.y] as ComponentFrame['transform'] }
  const anchor = mode === 'paragraph' ? flowParagraphAnchorAt({ x: frame.transform[4], y: frame.transform[5], width: frame.width, height: frame.height }, paperWidth, blocks) : null
  if (mode === 'paragraph' && !anchor) throw new Error('正文尚未完成布局，暂时不能随段落移动')
  const { paragraphAnchor: _anchor, ...rest } = placement
  return [{ type: 'frame.set', instanceId, frame }, { type: 'instance.flowPlacement.set', instanceId,
    flowPlacement: { ...rest, space, ...(anchor ? { paragraphAnchor: anchor } : {}) } }]
}

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

export interface FlowParagraphLayoutChange {
  /** New/replaced slot DOM needs projection paint; downstream reflow does not. */
  paint: readonly HTMLElement[]
  moved: readonly HTMLElement[]
  retired: readonly HTMLElement[]
}
export type FlowParagraphLayoutObservation = (() => void) & { invalidate(elements?: Iterable<HTMLElement>): void }

/** Keep the current DOM index across ACKs. A native layout tree is measured as
 * one unit; size/flow changes also invalidate its following reading trees. */
export function observeFlowParagraphLayout(paper: HTMLElement,
  onLayout: (blocks: readonly FlowParagraphBlockRect[], change: FlowParagraphLayoutChange) => void,
  scale = () => 1): FlowParagraphLayoutObservation {
  let pending = 0, disposed = false, full = true, structure = true, suffix = Infinity
  let width = -1, zoom = -1, ordered: HTMLElement[] = [], roots: HTMLElement[] = []
  let published: readonly FlowParagraphBlockRect[] = []
  const elements = new Set<HTMLElement>(), rects = new Map<HTMLElement, FlowParagraphBlockRect | null>()
  const trees = new Map<HTMLElement, HTMLElement[]>(), rootIndexes = new Map<HTMLElement, number>()
  const dirty = new Set<HTMLElement>(), paint = new Set<HTMLElement>(), retired = new Set<HTMLElement>()
  const top = (element: HTMLElement) => {
    let root = element
    for (let parent = element.parentElement?.closest<HTMLElement>('[data-flow-block-id]'); parent && paper.contains(parent);
      parent = parent.parentElement?.closest<HTMLElement>('[data-flow-block-id]')) root = parent
    return root
  }
  const mark = (node: Node, flow: boolean, repaint = false) => {
    const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-flow-block-id]')
    if (!element || !paper.contains(element)) { full = true; return }
    const root = top(element); dirty.add(root)
    if (repaint) paint.add(element)
    if (flow) { const index = rootIndexes.get(root); if (index === undefined) full = true; else suffix = Math.min(suffix, index) }
  }
  const same = (a: FlowParagraphBlockRect | null | undefined, b: FlowParagraphBlockRect | null) => a === b || Boolean(a && b
    && a.blockId === b.blockId && a.depth === b.depth && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
  const flush = () => {
    pending = 0
    if (disposed) return
    if (structure) {
      ordered = [...elements].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      roots = []; trees.clear(); rootIndexes.clear()
      for (const element of ordered) {
        const root = top(element)
        let tree = trees.get(root)
        if (!tree) { tree = []; trees.set(root, tree); rootIndexes.set(root, roots.length); roots.push(root) }
        tree.push(element)
      }
    }
    const paperRect = paper.getBoundingClientRect(), currentScale = scale()
    if (paperRect.width !== width || currentScale !== zoom) full = true
    width = paperRect.width; zoom = currentScale
    const moved: HTMLElement[] = [], measured = new Set<HTMLElement>()
    let changed = structure
    const measure = (element: HTMLElement) => {
      if (measured.has(element)) return false
      measured.add(element)
      let value: FlowParagraphBlockRect | null = null
      if (Number.isFinite(zoom) && zoom > 0 && width > 0 && element.getClientRects().length) {
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) value = { blockId: element.dataset.flowBlockId!, depth: depthWithin(element, paper),
          x: (rect.left - paperRect.left) / zoom, y: (rect.top - paperRect.top) / zoom, width: rect.width / zoom, height: rect.height / zoom }
      }
      if (same(rects.get(element), value)) return false
      rects.set(element, value); moved.push(element); changed = true
      return true
    }
    if (full) ordered.forEach(measure)
    else {
      for (const root of dirty) {
        let treeChanged = false
        for (const element of trees.get(root) ?? []) treeChanged = measure(element) || treeChanged
        if (treeChanged) suffix = Math.min(suffix, rootIndexes.get(root) ?? Infinity)
      }
      if (suffix < Infinity) for (const root of roots.slice(suffix)) for (const element of trees.get(root) ?? []) measure(element)
    }
    if (changed) {
      const seen = new Set<string>()
      published = ordered.flatMap(element => { const value = rects.get(element); if (!value || seen.has(value.blockId)) return []
        seen.add(value.blockId); return [value] })
    }
    const repaint = [...paint].filter(element => elements.has(element))
    const removed = [...retired].filter(element => !elements.has(element))
    full = false; structure = false; suffix = Infinity; dirty.clear(); paint.clear()
    retired.clear()
    onLayout(published, { paint: repaint, moved, retired: removed })
  }
  const schedule = () => { if (!pending && !disposed) pending = requestAnimationFrame(flush) }
  const invalidate = (values?: Iterable<HTMLElement>) => {
    if (!values) full = true
    else for (const element of values) mark(element, true)
    schedule()
  }
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(records => {
    for (const record of records) if (record.target !== paper) mark(record.target, false)
    schedule()
  })
  const watch = (element: HTMLElement) => {
    const present = paper.contains(element) && element.hasAttribute('data-flow-block-id')
    if (present) paint.add(element)
    if (present && !elements.has(element)) { elements.add(element); resize?.observe(element); paint.add(element); retired.delete(element); structure = true }
    else if (!present && elements.delete(element)) { resize?.unobserve(element); rects.delete(element); paint.delete(element); retired.add(element); structure = true }
  }
  const tree = (node: Node) => {
    if (!(node instanceof HTMLElement)) return
    const own = node.hasAttribute('data-flow-block-id') || elements.has(node)
    const children = node.querySelectorAll<HTMLElement>('[data-flow-block-id]')
    // A same-paper move keeps membership, but changes reading order and the
    // suffix that a later resize must invalidate.
    if (own || children.length) structure = true
    if (own) watch(node)
    children.forEach(watch)
  }
  const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
    for (const record of records) {
      mark(record.target, record.type !== 'characterData', record.type === 'childList' || record.type === 'attributes')
      if (record.type === 'childList') { record.removedNodes.forEach(tree); record.addedNodes.forEach(tree) }
      else if (record.attributeName === 'data-flow-block-id' && record.target instanceof HTMLElement) watch(record.target)
    }
    schedule()
  })
  const all = () => invalidate()
  resize?.observe(paper); tree(paper)
  mutation?.observe(paper, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-flow-block-id'] })
  window.addEventListener('resize', all)
  const fonts = paper.ownerDocument.fonts
  fonts?.addEventListener('loadingdone', all); fonts?.addEventListener('loadingerror', all)
  void fonts?.ready.then(() => { if (!disposed) all() })
  schedule()
  return Object.assign(() => { disposed = true; if (pending) cancelAnimationFrame(pending); resize?.disconnect(); mutation?.disconnect()
    elements.clear(); rects.clear(); trees.clear(); rootIndexes.clear(); dirty.clear(); paint.clear(); retired.clear(); ordered = []; roots = []
    window.removeEventListener('resize', all)
    fonts?.removeEventListener('loadingdone', all); fonts?.removeEventListener('loadingerror', all)
  }, { invalidate })
}
