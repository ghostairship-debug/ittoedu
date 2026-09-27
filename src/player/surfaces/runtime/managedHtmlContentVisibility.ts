interface VisibleBox { area: number; visible: number }

function visibleBox(element: Element, rect: DOMRect): VisibleBox {
  const view = element.ownerDocument.defaultView!
  const area = Math.max(0, rect.width) * Math.max(0, rect.height)
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
  let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom)
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor)
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return { area, visible: 0 }
    // A bounding rectangle cannot prove paint coverage through an arbitrary mask.
    if (style.clipPath !== 'none' || style.maskImage !== 'none') throw new Error('无法证明遮罩内容在调整高度后仍完整可见。')
    if (ancestor === element) continue
    const box = ancestor.getBoundingClientRect()
    const html = ancestor as HTMLElement
    if (style.overflowX !== 'visible') {
      left = Math.max(left, box.left + html.clientLeft)
      right = Math.min(right, box.left + html.clientLeft + html.clientWidth)
    }
    if (style.overflowY !== 'visible') {
      top = Math.max(top, box.top + html.clientTop)
      bottom = Math.min(bottom, box.top + html.clientTop + html.clientHeight)
    }
  }
  return { area, visible: Math.max(0, right - left) * Math.max(0, bottom - top) }
}

function sumBoxes(element: Element, rects: DOMRect[]): VisibleBox {
  return rects.reduce((total, rect) => {
    const box = visibleBox(element, rect)
    return { area: total.area + box.area, visible: total.visible + box.visible }
  }, { area: 0, visible: 0 })
}

function textBoxes(element: Element): DOMRect[] {
  const rects: DOMRect[] = []
  for (const child of element.childNodes) {
    if (child.nodeType !== 3 || !child.textContent?.trim()) continue
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(child)
    rects.push(...range.getClientRects())
    range.detach()
  }
  return rects
}

/** Reject new clipping and shrinking actual text/media, not just a small scrollHeight. */
export function preservesManagedHtmlVisibility(pairs: Array<[Element, Element]>): boolean {
  const preserves = (before: VisibleBox, after: VisibleBox, preserveSize = false): boolean => {
    if (before.area <= 0 || before.visible <= 0) return true
    if (after.area <= 0) return false
    if (preserveSize && after.area + 1 < before.area * 0.98) return false
    // One CSS pixel of edge rounding is allowed, not a hidden strip of content.
    return after.visible / after.area + 0.01 >= before.visible / before.area
  }
  return pairs.every(([original, copy]) => {
    if (!copy.isConnected) return true
    const view = original.ownerDocument.defaultView!
    if (view.innerHeight !== copy.ownerDocument.defaultView!.innerHeight) {
      // Generated paint has no DOM Range/box API. Do not claim that it survived clipping.
      for (const pseudo of ['::before', '::after']) {
        const style = view.getComputedStyle(original, pseudo)
        if (style.display !== 'none' && style.content !== 'none' && style.content !== 'normal') return false
      }
      if (view.getComputedStyle(original).backgroundImage !== 'none'
        && !preserves(sumBoxes(original, [...original.getClientRects()]), sumBoxes(copy, [...copy.getClientRects()]), true)) return false
    }
    if (!preserves(sumBoxes(original, [...original.getClientRects()]), sumBoxes(copy, [...copy.getClientRects()]))) return false
    if (!preserves(sumBoxes(original, textBoxes(original)), sumBoxes(copy, textBoxes(copy)), true)) return false
    if (['img', 'video', 'canvas', 'svg', 'input', 'textarea', 'select', 'button'].includes(original.localName)) {
      return preserves(sumBoxes(original, [...original.getClientRects()]), sumBoxes(copy, [...copy.getClientRects()]), true)
    }
    return true
  })
}
