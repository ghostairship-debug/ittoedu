/** Conservative paint evidence for generated Component admission. A positive
 * result only rules out an empty host; it does not verify interaction semantics. */
function hasColor(value: string): boolean {
  if (!value || value === 'transparent') return false
  return !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value)
    && !/\/\s*0(?:\.0+)?\s*\)$/.test(value)
}

function hasBoxPaint(style: CSSStyleDeclaration): boolean {
  return hasColor(style.backgroundColor)
    || Boolean(style.backgroundImage && style.backgroundImage !== 'none')
    || Boolean(style.boxShadow && style.boxShadow !== 'none')
    || (parseFloat(style.outlineWidth || '0') > 0 && !['', 'none', 'hidden'].includes(style.outlineStyle)
      && hasColor(style.outlineColor))
    || ['Top', 'Right', 'Bottom', 'Left'].some(side => {
      const value = style as unknown as Record<string, string>
      return parseFloat(value[`border${side}Width`] ?? '0') > 0
        && !['', 'none', 'hidden'].includes(value[`border${side}Style`] ?? '')
        && hasColor(value[`border${side}Color`] ?? '')
    })
}

function displayed(style: CSSStyleDeclaration): boolean {
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
    && style.contentVisibility !== 'hidden' && (!style.opacity || Number(style.opacity) > 0)
}

/** Includes Shadow DOM and generated CSS content. Do not infer emptiness from
 * childNodes: an otherwise empty root can paint its own background or pseudo. */
export function componentHasVisibleDomPaint(root: HTMLElement): boolean {
  const view = root.ownerDocument.defaultView!
  const visit = (element: Element): boolean => {
    if (element.tagName === 'STYLE' || element.tagName === 'SCRIPT') return false
    const style = view.getComputedStyle(element)
    if (style.display === 'none' || style.contentVisibility === 'hidden' || (style.opacity && Number(style.opacity) === 0)) return false
    const rect = element.getBoundingClientRect()
    if (displayed(style) && rect.width > 0 && rect.height > 0) {
      if (hasBoxPaint(style)) return true
      // The product PNG painter does not yet paint generated CSS content.
      // Preserve it as real browser paint evidence instead of rejecting its PNG.
      for (const pseudo of ['::before', '::after']) {
        const generated = view.getComputedStyle(element, pseudo)
        if (!displayed(generated) || !generated.content || ['none', 'normal'].includes(generated.content)) continue
        if (hasBoxPaint(generated) || (hasColor(generated.color) && !['""', "''"].includes(generated.content))) return true
      }
      for (const node of element.childNodes) if (node.nodeType === 3 && node.textContent?.trim() && hasColor(style.color)) {
        const range = root.ownerDocument.createRange()
        range.selectNodeContents(node)
        const bounds = range.getBoundingClientRect()
        if (bounds.width > 0 && bounds.height > 0) return true
      }
    }
    const children = element.shadowRoot?.children ?? element.children
    for (const child of children) if (visit(child)) return true
    if (element.tagName === 'SLOT') {
      for (const assigned of (element as HTMLSlotElement).assignedElements()) if (visit(assigned)) return true
    }
    return false
  }
  return visit(root)
}

async function captureHasPaint(root: HTMLElement, png: string): Promise<boolean> {
  const image = new root.ownerDocument.defaultView!.Image()
  image.src = png
  await image.decode()
  const canvas = root.ownerDocument.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法检查组件的实际透明图面')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) return true
  return false
}

/** Reuses the already prepared transparent instance image. Canvas/WebGL,
 * images and SVG are judged by their captured pixels, never by tag existence. */
export async function componentHasVisibleContent(root: HTMLElement, png: string,
  readCapture: (root: HTMLElement, png: string) => Promise<boolean> = captureHasPaint): Promise<boolean> {
  return componentHasVisibleDomPaint(root) || await readCapture(root, png)
}
