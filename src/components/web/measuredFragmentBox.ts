import type { ComponentDefinition, ComponentInstance, ComponentLayoutInput } from '../../shared/contracts/component-platform'

interface MeasuredWebBoxInput {
  definitionId: string
  frame?: { width: number; height: number }
  implementationOverride?: { kind: string; key?: string }
  style?: Readonly<Record<string, unknown>>
}

/** A formal Web frame owns the outer box; CSS snapshots are not an ownership tag. */
export function isMeasuredWebFragmentBox(instance: MeasuredWebBoxInput, documentKind: 'document' | 'fragment',
  _rootStyle?: Readonly<Record<string, unknown>>, definition?: Pick<ComponentDefinition, 'implementation'>): boolean {
  if (documentKind !== 'fragment' || !instance.frame) return false
  const implementation = instance.implementationOverride ?? definition?.implementation
  return implementation ? implementation.kind === 'builtin' && implementation.key === 'guoling.web'
    : instance.definitionId === 'guoling.web'
}

/** Only the measured outer element is normalized; its descendants keep their authored layout/scrolling. */
export function measuredFragmentBoxStyle(style: Readonly<Record<string, string>>, layout?: ComponentLayoutInput,
  outerStyle?: Readonly<Record<string, unknown>>): Record<string, string>
export function measuredFragmentBoxStyle(style: Readonly<Record<string, unknown>>, layout?: ComponentLayoutInput,
  outerStyle?: Readonly<Record<string, unknown>>): Record<string, string | number>
export function measuredFragmentBoxStyle(style: Readonly<Record<string, unknown>>, layout?: ComponentLayoutInput,
  outerStyle?: Readonly<Record<string, unknown>>): Record<string, string | number> {
  const placement = /^(?:position|inset(?:-.+)?|top|right|bottom|left|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|box-sizing|transform(?:-.+)?|translate|rotate|scale|zoom|z-index|float|clear|order|flex(?:-(?:basis|grow|shrink))?|grid(?:-(?:area|row(?:-start|-end)?|column(?:-start|-end)?))?|align-self|justify-self)$/
  const result: Record<string, string | number> = {}
  let movedOuterGeometry = outerStyle === undefined
  for (const [key, value] of Object.entries(style)) {
    // At assembly all root placement is moved into frame. At runtime only those
    // same outer declarations are removed; unrelated authored internal sizes survive.
    if (placement.test(key) && (outerStyle === undefined || outerStyle[key] === value)) { movedOuterGeometry = true; continue }
    if (typeof value === 'string' || typeof value === 'number') result[key] = value
  }
  if (!movedOuterGeometry) return result
  const display = result.display
  if (display === 'inline' || display === 'inline-block') result.display = 'block'
  else if (display === 'inline-flex') result.display = 'flex'
  else if (display === 'inline-grid') result.display = 'grid'
  else if (display === 'inline-table') result.display = 'table'
  return { position: 'static', width: '100%', height: layout?.mode === 'flow-content' ? 'auto' : '100%', margin: '0px', 'box-sizing': 'border-box', ...result }
}

/** Visible overflow is a runtime projection. Explicit scrolling/clipping remains an internal author boundary. */
export function measuredFragmentExtent(element: Element, frame: { width: number; height: number },
  mode: ComponentLayoutInput['mode'] = 'free-frame'): { width: number; height: number } {
  const origin = element.getBoundingClientRect(), view = element.ownerDocument.defaultView
  let width = frame.width, height = mode === 'flow-content' ? origin.height : frame.height
  const include = (rect: DOMRect, horizontal: boolean, vertical: boolean) => {
    if (horizontal) width = Math.max(width, rect.right - origin.left)
    if (vertical) height = Math.max(height, rect.bottom - origin.top)
  }
  const walk = (parent: Element, horizontal: boolean, vertical: boolean) => {
    const style = view?.getComputedStyle(parent)
    horizontal &&= !/^(?:auto|scroll|hidden|clip)$/.test(style?.overflowX || style?.overflow || '')
    vertical &&= !/^(?:auto|scroll|hidden|clip)$/.test(style?.overflowY || style?.overflow || '')
    if (!horizontal && !vertical) return
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = element.ownerDocument.createRange(); range.selectNodeContents(node)
        if (typeof range.getBoundingClientRect === 'function') include(range.getBoundingClientRect(), horizontal, vertical)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node as Element, childStyle = view?.getComputedStyle(child)
        if (childStyle?.display === 'none' || childStyle?.visibility === 'hidden' || !child.getClientRects().length) continue
        include(child.getBoundingClientRect(), horizontal, vertical); walk(child, horizontal, vertical)
      }
    }
  }
  walk(element, true, true)
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

/** Parsed CSS layout values, rather than text mentioning viewport unit names. */
export function cssUsesViewport(style: CSSStyleDeclaration, blockOnly = false): boolean {
  const numericCss = (globalThis as unknown as { CSSNumericValue?: { parse(value: string): unknown } }).CSSNumericValue
  const units = new Set(blockOnly ? ['vh', 'vb', 'vmin', 'vmax', 'svh', 'svb', 'svmin', 'svmax',
    'lvh', 'lvb', 'lvmin', 'lvmax', 'dvh', 'dvb', 'dvmin', 'dvmax']
    : ['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax',
      'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', 'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax'])
  const contains = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (units.has(Reflect.get(value, 'unit'))) return true
    const values = Reflect.get(value, 'values') as ArrayLike<unknown> | undefined
    return Boolean(values && Array.from(values).some(contains)) || contains(Reflect.get(value, 'value'))
  }
  if (!numericCss) return false
  for (const name of Array.from(style)) {
    try { if (contains(numericCss.parse(style.getPropertyValue(name)))) return true }
    catch { /* Non-numeric declarations keep their authored semantics. */ }
  }
  return false
}

/** Only a whole design region is fixed; a local canvas in an article stays in normal flow. */
export function webUsesFixedViewport(html: string, css = ''): boolean {
  if (typeof DOMParser === 'undefined') return false
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const roots = [...parsed.body.children].filter(element => !['script', 'style', 'template'].includes(element.localName))
  if (roots.length === 1 && ['canvas', 'iframe', 'object', 'embed'].includes(roots[0]!.localName)) return true
  const inspect = (style: CSSStyleDeclaration, documentBox = false) => cssUsesViewport(style, true)
    || documentBox && ['height', 'block-size', 'min-height', 'min-block-size'].some(name => /%$/.test(style.getPropertyValue(name).trim()))
  for (const element of [...parsed.querySelectorAll<HTMLElement>('[style]')])
    if (inspect(element.style, element === parsed.body || element === parsed.documentElement)) return true
  if (typeof CSSStyleSheet === 'undefined' || !CSSStyleSheet.prototype.replaceSync) return false
  const sheet = new CSSStyleSheet()
  sheet.replaceSync([...parsed.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n') + '\n' + css)
  const visit = (rules: CSSRuleList): boolean => [...rules].some(rule => {
    if (rule.type === CSSRule.MEDIA_RULE && /(?:^|[^\w-])(?:(?:min-|max-)?(?:height|aspect-ratio)|orientation)(?:[^\w-]|$)/.test((rule as CSSMediaRule).conditionText)) return true
    if (rule.type === CSSRule.STYLE_RULE) {
      const styled = rule as CSSStyleRule
      let documentBox = false
      try { documentBox = parsed.body.matches(styled.selectorText) || parsed.documentElement.matches(styled.selectorText) } catch { /* Browser unsupported selector remains authored CSS. */ }
      if (inspect(styled.style, documentBox)) return true
    }
    return 'cssRules' in rule && visit((rule as CSSGroupingRule).cssRules)
  })
  return visit(sheet.cssRules)
}

/** Software derives Surface input; the returned height is never a formal edit. */
export function componentLayoutInput(instance: ComponentInstance, host: {
  kind: 'free-frame' | 'flow'; inlineSize: number; viewport?: { width: number; height: number }; definition?: ComponentDefinition
}, fixedViewport?: boolean): ComponentLayoutInput {
  const width = instance.frame?.width ?? host.viewport?.width ?? host.inlineSize
  const height = instance.frame?.height ?? host.viewport?.height ?? 0
  if (host.kind === 'free-frame') return { mode: 'free-frame', inlineSize: width, blockSize: height }
  const declared = host.definition?.implementation
  const key = declared?.kind === 'builtin' ? declared.key : instance.definitionId
  const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : null
  const web = ['guoling.web', 'guoling.html-program'].includes(key)
  const viewport = fixedViewport ?? (key !== 'guoling.document-block' && Boolean(instance.childIds?.length) || (web && typeof data?.html === 'string' ? webUsesFixedViewport(data.html, typeof data.css === 'string' ? data.css : '')
    : key !== 'guoling.document-block' && (instance.implementationOverride ?? declared)?.kind === 'source' && Boolean(instance.frame)))
  return viewport ? { mode: 'flow-viewport', inlineSize: width, blockSize: height } : { mode: 'flow-content', inlineSize: host.inlineSize }
}
