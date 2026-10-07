import type { FlowParagraphBlockRect } from '../../../shared/flowParagraphAnchors'
import type { ComponentContainer, ComponentEdit, ComponentFrame, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { containerChildIds, owningContainer } from '../../../shared/contracts/component-platform/project'
import { flowDocumentBlock } from '../../componentPlatform/surfaces/flow/documentProjection'
import { flowParagraphAnchorAt } from '../../../shared/flowParagraphAnchors'
import { multiplyMatrices, transformPoint, type AffineMatrix } from '../../../core/components/geometry'

/** Actual component content local coordinates to client coordinates, including every Flow stage and parent transform. */
export function flowContentClientMatrix(element: HTMLElement): AffineMatrix | null {
  const view = element.ownerDocument.defaultView
  if (!view) return null
  const css = view.getComputedStyle(element), rect = element.getBoundingClientRect()
  const width = element.offsetWidth || Number.parseFloat(css.width), height = element.offsetHeight || Number.parseFloat(css.height)
  if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null
  let matrix: AffineMatrix = [1, 0, 0, 1, 0, 0]
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node), raw = style.transform
    if (raw && raw !== 'none') {
      const values = typeof view.DOMMatrixReadOnly === 'function' ? new view.DOMMatrixReadOnly(raw) : null
      const fallback = /^matrix\(([^)]+)\)$/.exec(raw)?.[1].split(',').map(Number)
      if (values && !values.is2D) return null
      const linear: AffineMatrix | null = values ? [values.a, values.b, values.c, values.d, 0, 0]
        : fallback?.length === 6 ? [fallback[0], fallback[1], fallback[2], fallback[3], 0, 0] : null
      if (linear) matrix = multiplyMatrices(linear, matrix)
    }
  }
  if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12) return null
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map(point => transformPoint(matrix, point))
  return [matrix[0], matrix[1], matrix[2], matrix[3], rect.left - Math.min(...corners.map(point => point.x)), rect.top - Math.min(...corners.map(point => point.y))]
}

export function flowReadingMembers(project: CourseProjectV10, container: ComponentContainer): string[] {
  return containerChildIds(project, container).filter(id => {
    const instance = project.instances[id]
    return instance && !instance.flowPlacement && project.definitions[instance.definitionId]?.role !== 'behavior'
  })
}

/** Reorder reading members while retaining the actual mixed ownership list. */
export function flowReadingMove(project: CourseProjectV10, id: string, direction: 'up' | 'down'): ComponentEdit[] {
  const container = owningContainer(project, id)
  if (!container) return []
  const members = flowReadingMembers(project, container), at = members.indexOf(id)
  if (at < 0) return []
  const neighbor = members[at + (direction === 'up' ? -1 : 1)]
  if (!neighbor) return []
  const remaining = containerChildIds(project, container).filter(member => member !== id)
  return [{ type: 'instance.move', instanceId: id, container, index: remaining.indexOf(neighbor) + (direction === 'down' ? 1 : 0) }]
}

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
