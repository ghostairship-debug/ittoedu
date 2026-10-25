/** Browser paint order, including decorations whose authored pointer-events are none.
 * The temporary rule is removed synchronously; it never handles or replays input.
 * Self contained because the same reader is embedded in HTML content realms.
 */
export function componentPaintStack(root: Element | ShadowRoot, x: number, y: number, ignore = '', shadowOf?: (element: Element) => ShadowRoot | null | undefined,
  scope?: { prepared: Map<Element | ShadowRoot, { inline: HTMLElement[]; styles: string[] }>; restore: Array<() => void>;
    paint: Map<Element, (x: number, y: number) => boolean>; shown: Map<Element, boolean> }): Element[] {
  const doc = root.ownerDocument, win = doc.defaultView
  if (!win) return []
  const tree = root.getRootNode() as Document | ShadowRoot
  let prepared = scope?.prepared.get(root), restore: (() => void) | undefined
  let elements: Element[]
  try {
    if (!prepared) {
      const rule = new win.CSSStyleSheet(), previousSheets = [...tree.adoptedStyleSheets]
      const priority = ':is(*,#guoling-hit#guoling-hit#guoling-hit#guoling-hit)'
      rule.replaceSync(`${priority},${priority}::before,${priority}::after{pointer-events:auto!important}${ignore ? `${priority}:is(${ignore}),${priority}:is(${ignore}) *,${priority}:is(${ignore})::before,${priority}:is(${ignore})::after{pointer-events:none!important}` : ''}`)
      tree.adoptedStyleSheets = [...previousSheets, rule]
      restore = () => { tree.adoptedStyleSheets = previousSheets }
      if (scope) scope.restore.push(restore)
      const inline = [root, ...root.querySelectorAll('[style]')].filter((element): element is HTMLElement =>
        element instanceof win.HTMLElement && element.style.getPropertyPriority('pointer-events') === 'important'
        && element.style.pointerEvents === 'none' && !(ignore && element.closest(ignore)))
      prepared = { inline, styles: inline.map(element => element.getAttribute('style')!) }
      scope?.prepared.set(root, prepared)
    }
    for (const element of prepared.inline) element.style.setProperty('pointer-events', 'auto', 'important')
    elements = (tree as Document).elementsFromPoint(x, y).filter(element => root.contains(element))
  }
  finally {
    // Inline important declarations affect authored selectors too. Restore them
    // after each hit; only the software stylesheet and its lookup span the batch.
    prepared?.inline.forEach((element, index) => element.setAttribute('style', prepared!.styles[index]!))
    if (!scope) restore?.()
  }
  const color = (value: string) => Boolean(value && value !== 'none' && value !== 'transparent'
    && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value) && !/\/\s*0(?:\.0+)?\s*\)$/.test(value))
  const shown = (element: Element): boolean => {
    const parents: Element[] = []
    let visible = true
    for (let parent: Element | null = element; parent; parent = parent.parentElement ?? (parent.getRootNode() as ShadowRoot).host ?? null) {
      const cached = scope?.shown.get(parent)
      if (cached !== undefined) { visible = cached; break }
      parents.push(parent)
      const css = win.getComputedStyle(parent)
      if (css.display === 'none' || css.opacity !== '' && Number(css.opacity) === 0) { visible = false; break }
    }
    for (const parent of parents) scope?.shown.set(parent, visible)
    return visible
  }
  // The same paint owner is tested at many coordinates in a marker pass. Cache
  // its paint facts only within that synchronous read; border/text membership
  // still depends on each actual point and elementsFromPoint still runs there.
  const paintTest = (element: Element): ((x: number, y: number) => boolean) => {
    const style = win.getComputedStyle(element)
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || !shown(element)) return () => false
    if (color(style.backgroundColor) || style.backgroundImage && style.backgroundImage !== 'none') return () => true
    if (['box-shadow', 'filter', 'backdrop-filter', 'mask-image', 'border-image-source'].some(name => {
      const value = style.getPropertyValue(name); return Boolean(value && value !== 'none')
    })) return () => true
    for (const pseudo of ['::before', '::after']) {
      const css = win.getComputedStyle(element, pseudo), value = css.content
      if (!value || value === 'none' || value === 'normal' || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity || '1') === 0) continue
      if (color(css.backgroundColor) || css.backgroundImage && css.backgroundImage !== 'none'
        || css.boxShadow && css.boxShadow !== 'none'
        || value !== '""' && (color(css.getPropertyValue('-webkit-text-fill-color') || css.color) || /^url\(/.test(value))) return () => true
    }
    const rect = element.getBoundingClientRect()
    const sx = element instanceof win.HTMLElement && element.offsetWidth ? rect.width / element.offsetWidth : 1
    const sy = element instanceof win.HTMLElement && element.offsetHeight ? rect.height / element.offsetHeight : 1
    const borders = ['top', 'right', 'bottom', 'left'].flatMap(side => {
      const width = parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
      if (!width || /^(none|hidden)$/.test(style.getPropertyValue(`border-${side}-style`)) || !color(style.getPropertyValue(`border-${side}-color`))) return []
      return [{ side, width }]
    })
    const border = (x: number, y: number) => borders.some(({ side, width }) => side === 'top' ? y < rect.top + width * sy : side === 'bottom' ? y > rect.bottom - width * sy
      : side === 'left' ? x < rect.left + width * sx : x > rect.right - width * sx)
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
      const fill = !['svg', 'g', 'defs', 'symbol', 'a', 'switch'].includes(element.localName)
        && (element.localName !== 'line' && color(style.fill) && Number(style.fillOpacity || '1') > 0
          || color(style.stroke) && Number(style.strokeOpacity || '1') > 0 && parseFloat(style.strokeWidth || '1') > 0)
      return (x, y) => fill || border(x, y)
    }
    if (/^(img|video|canvas|iframe|object|embed|input|button|select|textarea)$/.test(element.localName)) return () => true
    const boxes: DOMRect[] = []
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      if (!color(style.getPropertyValue('-webkit-text-fill-color') || style.color) && (!style.textShadow || style.textShadow === 'none')) continue
      const range = doc.createRange(); range.selectNodeContents(node)
      boxes.push(...range.getClientRects())
    }
    return (x, y) => border(x, y) || boxes.some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
  }
  return elements.flatMap(element => {
    const shadow = shadowOf?.(element) ?? element.shadowRoot
    return shadow ? [...componentPaintStack(shadow, x, y, ignore, shadowOf, scope), element] : [element]
  }).filter(element => {
    let test = scope?.paint.get(element)
    if (!test) { test = paintTest(element); scope?.paint.set(element, test) }
    return test(x, y)
  })
}
