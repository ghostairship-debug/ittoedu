export interface QuickBarRect { left: number; top: number; width: number; height: number }
export interface QuickBarBounds { left: number; top: number; right: number; bottom: number }
export type QuickBarPlacement = 'above' | 'below' | 'inside'

/**
 * Place the selection quick bar like the text editing toolbar: above the selection when it fits, otherwise below,
 * aligned to the selection's left edge. When neither side fits (a selection taller than the view) it is pinned
 * inside the top of the selection. The bar never leaves `bounds` and never participates in layout.
 */
export function placeQuickBar(anchor: QuickBarRect, bounds: QuickBarBounds, size: { width: number; height: number }, gap = 8): { left: number; top: number; placement: QuickBarPlacement } {
  const leftEdge = bounds.left + gap, rightEdge = bounds.right - gap
  const topEdge = bounds.top + gap, bottomEdge = bounds.bottom - gap
  const width = Math.min(size.width, Math.max(0, rightEdge - leftEdge))
  const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - width))
  const above = anchor.top - gap - size.height
  if (above >= topEdge) return { left, top: above, placement: 'above' }
  const below = anchor.top + anchor.height + gap
  if (below + size.height <= bottomEdge) return { left, top: below, placement: 'below' }
  return { left, top: Math.max(topEdge, Math.min(anchor.top + gap, bottomEdge - size.height)), placement: 'inside' }
}

/** Axis-aligned box of a rectangle rotated (degrees) about its centre. */
export function rotatedBoundingBox(box: QuickBarRect & { rotation?: number }): QuickBarRect {
  const rotation = box.rotation ?? 0
  if (!rotation) return { left: box.left, top: box.top, width: box.width, height: box.height }
  const radians = rotation * Math.PI / 180
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians))
  const width = box.width * cos + box.height * sin, height = box.width * sin + box.height * cos
  const centerX = box.left + box.width / 2, centerY = box.top + box.height / 2
  return { left: centerX - width / 2, top: centerY - height / 2, width, height }
}

/** Smallest box containing every selected box; null when nothing is on screen. */
export function unionBoxes(boxes: readonly QuickBarRect[]): QuickBarRect | null {
  if (!boxes.length) return null
  const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top))
  const right = Math.max(...boxes.map(box => box.left + box.width)), bottom = Math.max(...boxes.map(box => box.top + box.height))
  return { left, top, width: right - left, height: bottom - top }
}

/** Visible part of `element` after clipping by every scrolling or clipping ancestor and the window. */
export function visibleBounds(element: Element, inset = 0): QuickBarBounds {
  const rect = element.getBoundingClientRect()
  let left = Math.max(inset, rect.left), right = Math.min(window.innerWidth - inset, rect.right)
  let top = Math.max(inset, rect.top), bottom = Math.min(window.innerHeight - inset, rect.bottom)
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const box = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
  }
  return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) }
}
