import type { PublishedCompositionLayerItem } from '../../shared/publishedCourseTypes'
import type { CompositionContentEdit } from '../../shared/composition/edit'
import type { CompositionBounds, CompositionLayoutObservation } from '../../player/composition/mountWebComposition'
import { compositionContainingBox, compositionDom, compositionGestureLength, compositionStyleFact, compositionStylePatch, compositionToFlow, compositionToFree } from './compositionLayout'

type Node = PublishedCompositionLayerItem['content']['root']
type ElementNode = Extract<Node, { kind: 'element' }>
export interface CompositionPoint { x: number; y: number }
export interface CompositionDragPlan {
  nodeId: string
  mode: 'free' | 'automatic'
  layout: CompositionLayoutObservation
  parent?: ElementNode
  parentLayout?: CompositionLayoutObservation
  siblings: { node: Node; layout: CompositionLayoutObservation }[]
  root: Node
  observe(id: string): CompositionLayoutObservation | null
}

function parentOf(root: Node, id: string): ElementNode | undefined {
  if (root.kind !== 'element') return undefined
  if (root.children.some(node => node.id === id)) return root
  for (const child of root.children) { const parent = parentOf(child, id); if (parent) return parent }
  return undefined
}

export function compositionDragPlan(root: Node, nodeId: string,
  observe: (id: string) => CompositionLayoutObservation | null): { plan?: CompositionDragPlan; issue?: string } {
  const layout = observe(nodeId)
  if (!layout || layout.bounds.width <= 0 || layout.bounds.height <= 0) return { issue: '此内容没有可拖动的显示区域。' }
  if (layout.transformed) return { issue: '此区域使用 CSS 变换；请通过属性调整，暂不支持在此区域拖拽或缩放。' }
  if (!layout.horizontal) return { issue: '竖排内容请通过属性调整布局。' }
  const parent = parentOf(root, nodeId)
  if (!parent) return { issue: '组合根容器请通过布局属性调整。' }
  if (layout.position === 'absolute' || layout.position === 'fixed') {
    if (parent.children.find(node => node.id === nodeId)?.kind !== 'element') return { issue: '专业内容请拖动其外部布局容器。' }
    if (![layout.left, layout.top, layout.width, layout.height].every(Number.isFinite)) return { issue: '当前尺寸无法换算为拖拽几何，请使用布局属性。' }
    return { plan: { nodeId, mode: 'free', layout, parent, parentLayout: observe(parent.id) ?? undefined, siblings: [], root, observe } }
  }
  const parentLayout = observe(parent.id)
  if (!parentLayout) return { issue: '此内容的排版容器不能拖拽重排。' }
  const siblings = parent.children.flatMap(node => {
    const layout = observe(node.id)
    return layout && layout.display !== 'none' && layout.bounds.width > 0 && layout.bounds.height > 0
      && layout.position !== 'absolute' && layout.position !== 'fixed' ? [{ node, layout }] : []
  })
  if (!siblings.some(sibling => sibling.node.id === nodeId)) return { issue: '此容器没有可重排的兄弟内容。' }
  if (siblings.some(sibling => sibling.layout.order !== 0)
    || parentLayout.display.includes('grid') && siblings.some(sibling => sibling.layout.gridPlaced))
    return { issue: '此区域的顺序由 CSS 位置规则指定，请通过布局属性调整。' }
  return { plan: { nodeId, mode: 'automatic', layout, parent, parentLayout, siblings, root, observe } }
}

export function compositionDrop(plan: CompositionDragPlan, point: CompositionPoint): { edit: CompositionContentEdit; marker: CompositionBounds } | null {
  if (plan.mode !== 'automatic' || !plan.parent || !plan.parentLayout) return null
  const candidates = plan.siblings.filter(sibling => sibling.node.id !== plan.nodeId)
  const distance = (rect: CompositionBounds) => Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
    Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height))
  const nearest = [...candidates].sort((a, b) => distance(a.layout.bounds) - distance(b.layout.bounds))[0]
  if (!nearest) return null
  const css = plan.parentLayout, rect = nearest.layout.bounds
  const horizontal = css.display.includes('flex') ? css.flexDirection.startsWith('row')
    : css.display.includes('grid') ? !css.gridAutoFlow.startsWith('column') : false
  const reverse = horizontal ? (css.direction === 'rtl') !== css.flexDirection.endsWith('reverse') : css.flexDirection === 'column-reverse'
  let after = horizontal ? point.x > rect.x + rect.width / 2 : point.y > rect.y + rect.height / 2
  if (horizontal && (point.y < rect.y || point.y > rect.y + rect.height)) after = point.y > rect.y + rect.height
  else if (reverse) after = !after
  const remaining = plan.parent.children.filter(node => node.id !== plan.nodeId)
  const index = remaining.findIndex(node => node.id === nearest.node.id) + (after ? 1 : 0)
  if (index === plan.parent.children.findIndex(node => node.id === plan.nodeId)) return null
  return { edit: { type: 'move', nodeId: plan.nodeId, parentId: plan.parent.id, index },
    marker: horizontal ? { x: rect.x + (after !== reverse ? rect.width : 0), y: rect.y, width: 2, height: rect.height }
      : { x: rect.x, y: rect.y + (after !== reverse ? rect.height : 0), width: rect.width, height: 2 } }
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`
export function compositionFreeDrag(plan: CompositionDragPlan, delta: CompositionPoint, resize: boolean, element?: HTMLElement | null, allowPixelOverride = false): {
  edit: CompositionContentEdit; bounds: CompositionBounds
} {
  const { layout } = plan
  const box = element ? compositionContainingBox(element, element.parentElement, layout.position === 'fixed') : null
  const length = (property: string, value: number, base: number) => element ? compositionGestureLength(element, property, value, base, allowPixelOverride) : px(value)
  const patch = (values: Record<string, string | null>) => element ? compositionStylePatch(element, values) : values
  if (resize) {
    const width = Math.max(Math.max(1, layout.minWidth), Math.min(layout.maxWidth, layout.width + delta.x))
    const height = Math.max(Math.max(1, layout.minHeight), Math.min(layout.maxHeight, layout.height + delta.y))
    return { edit: { type: 'style', nodeId: plan.nodeId, patch: patch({ ...(delta.x ? { width: length('width', width, box?.width ?? 0) } : {}), ...(delta.y ? { height: length('height', height, box?.height ?? 0) } : {}) }) },
      bounds: { ...layout.bounds, width: layout.bounds.width + width - layout.width, height: layout.bounds.height + height - layout.height } }
  }
  const offsets: Record<string, string | null> = {}
  const axis = (start: 'left' | 'top', end: 'right' | 'bottom', delta: number, base: number, initial: number) => {
    if (!delta) return
    const startFact = element ? compositionStyleFact(element, start) : null, endFact = element ? compositionStyleFact(element, end) : null
    const anchoredEnd = Boolean(endFact && endFact.value !== 'auto' && Number.isFinite(Number.parseFloat(endFact.computed)))
    if (!anchoredEnd || startFact?.value !== 'auto') offsets[start] = length(start, initial + delta, base)
    else offsets[start] = 'auto'
    offsets[end] = anchoredEnd ? length(end, Number.parseFloat(endFact!.computed) - delta, base) : 'auto'
  }
  axis('left', 'right', delta.x, box?.width ?? 0, layout.left)
  axis('top', 'bottom', delta.y, box?.height ?? 0, layout.top)
  return { edit: { type: 'style', nodeId: plan.nodeId, patch: patch(offsets) },
    bounds: { ...layout.bounds, x: layout.bounds.x + delta.x, y: layout.bounds.y + delta.y } }
}


/** A cross-container drop changes the existing tree through the same move command. */
export function compositionCrossDrop(plan: CompositionDragPlan, point: CompositionPoint, document: Document, draggedBounds?: CompositionBounds): {
  edit: CompositionContentEdit; marker: CompositionBounds
} | null {
  const contains = (bounds: CompositionBounds) => point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  if (plan.mode === 'automatic' && plan.parentLayout && contains(plan.parentLayout.bounds)) return null
  const excluded = new Set<string>()
  const collectSource = (node: Node) => {
    if (node.id === plan.nodeId || excluded.has(node.id)) {
      excluded.add(node.id)
      if (node.kind === 'element') node.children.forEach(child => { excluded.add(child.id); collectSource(child) })
    } else if (node.kind === 'element') node.children.forEach(collectSource)
  }
  collectSource(plan.root)
  const targets: { node: ElementNode; layout: CompositionLayoutObservation; depth: number }[] = []
  const visit = (node: Node, depth: number) => {
    if (node.kind !== 'element' || excluded.has(node.id)) return
    const layout = plan.observe(node.id)
    const semanticContainer = /^(?:div|section|main|article|aside|nav|header|footer|form|ul|ol|li|body)$/i.test(node.tagName)
    const children = node.children.filter(child => child.kind !== 'text' && child.kind !== 'comment')
    const freeChildren = children.length > 0 && children.every(child => ['absolute', 'fixed'].includes(plan.observe(child.id)?.position ?? ''))
    if (node.id !== plan.parent?.id && semanticContainer && layout && !layout.transformed && layout.horizontal
      && contains(layout.bounds) && (/flex|grid/.test(layout.display) || !children.length || freeChildren)) targets.push({ node, layout, depth })
    node.children.forEach(child => visit(child, depth + 1))
  }
  visit(plan.root, 0)
  const target = targets.sort((a, b) => b.depth - a.depth || a.layout.bounds.width * a.layout.bounds.height - b.layout.bounds.width * b.layout.bounds.height)[0]
  if (!target) return null
  const children = target.node.children.flatMap(node => {
    const layout = plan.observe(node.id)
    return layout && layout.display !== 'none' && layout.bounds.width > 0 && layout.bounds.height > 0
      && !['absolute', 'fixed'].includes(layout.position) ? [{ node, layout }] : []
  })
  const freeTarget = !/flex|grid/.test(target.layout.display) && target.layout.position !== 'static' && !children.length
  let move: Extract<CompositionContentEdit, { type: 'move' }>
  let style: Extract<CompositionContentEdit, { type: 'style' }> | undefined
  const element = compositionDom(document, plan.nodeId)
  if (freeTarget) {
    if (!element) throw new Error('此专业对象请先放入布局容器，再自由摆放。')
    const destination = compositionDom(document, target.node.id)
    if (!destination) return null
    const bounds = draggedBounds ?? { ...plan.layout.bounds, x: point.x - plan.layout.bounds.width / 2, y: point.y - plan.layout.bounds.height / 2 }
    style = compositionToFree(element, plan.nodeId, bounds, destination)
    move = { type: 'move', nodeId: plan.nodeId, parentId: target.node.id, index: target.node.children.length }
  } else {
    if (children.some(child => child.layout.order !== 0) || target.layout.display.includes('grid') && children.some(child => child.layout.gridPlaced))
      throw new Error('目标容器的顺序由 CSS 规则指定，请通过布局属性放置。')
    const nearest = [...children].sort((a, b) => Math.hypot(point.x - a.layout.bounds.x - a.layout.bounds.width / 2, point.y - a.layout.bounds.y - a.layout.bounds.height / 2)
      - Math.hypot(point.x - b.layout.bounds.x - b.layout.bounds.width / 2, point.y - b.layout.bounds.y - b.layout.bounds.height / 2))[0]
    const horizontal = target.layout.display.includes('flex') ? target.layout.flexDirection.startsWith('row') : target.layout.display.includes('grid')
    const after = nearest && (horizontal ? point.x > nearest.layout.bounds.x + nearest.layout.bounds.width / 2 : point.y > nearest.layout.bounds.y + nearest.layout.bounds.height / 2)
    const index = nearest ? target.node.children.findIndex(child => child.id === nearest.node.id) + (after ? 1 : 0) : target.node.children.length
    move = { type: 'move', nodeId: plan.nodeId, parentId: target.node.id, index }
    if (plan.mode === 'free' && element) style = compositionToFlow(element, plan.nodeId)
  }
  return { edit: style ? { type: 'batch', nodeId: plan.nodeId, edits: [move, style] } : move, marker: target.layout.bounds }
}
