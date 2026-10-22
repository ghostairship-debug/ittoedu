/** Browser paint order, including decorations whose authored pointer-events are none.
 * The temporary rule is removed synchronously; it never handles or replays input.
 * Self contained because the same reader is embedded in HTML content realms.
 */
export function componentPaintStack(root: Element | ShadowRoot, x: number, y: number, ignore = '', shadowOf?: (element: Element) => ShadowRoot | null | undefined): Element[] {
  const doc = root.ownerDocument, win = doc.defaultView
  if (!win) return []
  const tree = root.getRootNode() as Document | ShadowRoot
  const rule = new win.CSSStyleSheet(), previousSheets = [...tree.adoptedStyleSheets]
  const priority = ':is(*,#guoling-hit#guoling-hit#guoling-hit#guoling-hit)'
  rule.replaceSync(`${priority},${priority}::before,${priority}::after{pointer-events:auto!important}${ignore ? `${priority}:is(${ignore}),${priority}:is(${ignore}) *,${priority}:is(${ignore})::before,${priority}:is(${ignore})::after{pointer-events:none!important}` : ''}`)
  tree.adoptedStyleSheets = [...previousSheets, rule]
  const inline = [root, ...root.querySelectorAll('[style]')].filter((element): element is HTMLElement =>
    element instanceof win.HTMLElement && element.style.getPropertyPriority('pointer-events') === 'important'
    && element.style.pointerEvents === 'none' && !(ignore && element.closest(ignore)))
  const inlineStyles = inline.map(element => element.getAttribute('style')!)
  for (const element of inline) element.style.setProperty('pointer-events', 'auto', 'important')
  let elements: Element[]
  try { elements = (tree as Document).elementsFromPoint(x, y).filter(element => root.contains(element)) }
  finally {
    tree.adoptedStyleSheets = previousSheets
    inline.forEach((element, index) => element.setAttribute('style', inlineStyles[index]!))
  }
  const color = (value: string) => Boolean(value && value !== 'none' && value !== 'transparent'
    && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value) && !/\/\s*0(?:\.0+)?\s*\)$/.test(value))
  return elements.flatMap(element => {
    const shadow = shadowOf?.(element) ?? element.shadowRoot
    return shadow ? [...componentPaintStack(shadow, x, y, ignore, shadowOf), element] : [element]
  }).filter(element => {
    const style = win.getComputedStyle(element)
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    for (let parent: Element | null = element; parent; parent = parent.parentElement ?? (parent.getRootNode() as ShadowRoot).host ?? null) {
      const css = win.getComputedStyle(parent)
      if (css.display === 'none' || css.opacity !== '' && Number(css.opacity) === 0) return false
    }
    if (color(style.backgroundColor) || style.backgroundImage && style.backgroundImage !== 'none') return true
    if (['box-shadow', 'filter', 'backdrop-filter', 'mask-image', 'border-image-source'].some(name => {
      const value = style.getPropertyValue(name); return Boolean(value && value !== 'none')
    })) return true
    for (const pseudo of ['::before', '::after']) {
      const css = win.getComputedStyle(element, pseudo), value = css.content
      if (!value || value === 'none' || value === 'normal' || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity || '1') === 0) continue
      if (color(css.backgroundColor) || css.backgroundImage && css.backgroundImage !== 'none'
        || css.boxShadow && css.boxShadow !== 'none'
        || value !== '""' && (color(css.getPropertyValue('-webkit-text-fill-color') || css.color) || /^url\(/.test(value))) return true
    }
    const rect = element.getBoundingClientRect()
    const sx = element instanceof win.HTMLElement && element.offsetWidth ? rect.width / element.offsetWidth : 1
    const sy = element instanceof win.HTMLElement && element.offsetHeight ? rect.height / element.offsetHeight : 1
    if (['top', 'right', 'bottom', 'left'].some(side => {
      const width = parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
      if (!width || /^(none|hidden)$/.test(style.getPropertyValue(`border-${side}-style`)) || !color(style.getPropertyValue(`border-${side}-color`))) return false
      return side === 'top' ? y < rect.top + width * sy : side === 'bottom' ? y > rect.bottom - width * sy
        : side === 'left' ? x < rect.left + width * sx : x > rect.right - width * sx
    })) return true
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
      if (['svg', 'g', 'defs', 'symbol', 'a', 'switch'].includes(element.localName)) return false
      return element.localName !== 'line' && color(style.fill) && Number(style.fillOpacity || '1') > 0
        || color(style.stroke) && Number(style.strokeOpacity || '1') > 0 && parseFloat(style.strokeWidth || '1') > 0
    }
    if (/^(img|video|canvas|iframe|object|embed|input|button|select|textarea)$/.test(element.localName)) return true
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      if (!color(style.getPropertyValue('-webkit-text-fill-color') || style.color) && (!style.textShadow || style.textShadow === 'none')) continue
      const range = doc.createRange(); range.selectNodeContents(node)
      if ([...range.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) return true
    }
    return false
  })
}
