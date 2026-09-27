/** First-version Flow support: natural vertical documents, not arbitrary viewport applications. */
export const MAX_FLOW_CSS_RULES = 1000
const fail = (reason: string): never => { throw new Error(`Flow HTML 无法证明页面调整高度后无裁切：${reason}；请使用演示页。`) }
const displays = new Set(['block', 'inline', 'inline-block', 'none', 'list-item', 'table', 'inline-table', 'table-caption', 'table-column-group', 'table-column', 'table-header-group', 'table-row-group', 'table-footer-group', 'table-row', 'table-cell'])
const simple = new Map<string, RegExp>([
  // Chromium expands a solid `background` shorthand into these inert reset longhands.
  // The painted result is still checked through the full computed-style snapshot.
  ...['background-image', 'background-position-x', 'background-position-y', 'background-size',
    'background-repeat', 'background-attachment', 'background-origin', 'background-clip']
    .map(name => [name, /^initial$/] as [string, RegExp]),
  ['box-sizing', /^(content-box|border-box)$/], ['position', /^static$/],
  ['overflow', /^visible$/], ['overflow-x', /^visible$/], ['overflow-y', /^visible$/],
  ['float', /^none$/], ['clear', /^none$/], ['opacity', /^(0(?:\.\d+)?|1(?:\.0+)?)$/],
  ['font-weight', /^(normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/],
  ['font-style', /^(normal|italic|oblique)$/], ['font-variant', /^(normal|small-caps)$/],
  // Chromium expands `font` into these reset longhands. Admit only the defaults proven by this profile.
  ['font-variant-caps', /^normal$/], ['font-variant-ligatures', /^normal$/],
  ['font-variant-numeric', /^normal$/], ['font-variant-east-asian', /^normal$/],
  ['font-variant-alternates', /^normal$/], ['font-variant-position', /^normal$/],
  ['font-variant-emoji', /^normal$/], ['font-size-adjust', /^none$/],
  ['font-language-override', /^normal$/], ['font-kerning', /^auto$/],
  ['font-optical-sizing', /^auto$/], ['font-feature-settings', /^normal$/],
  ['font-variation-settings', /^normal$/], ['font-stretch', /^normal$/],
  ['text-align', /^(start|end|left|right|center|justify)$/],
  ['text-transform', /^(none|capitalize|uppercase|lowercase)$/],
  ['white-space', /^(normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/],
  ['overflow-wrap', /^(normal|break-word|anywhere)$/], ['word-break', /^(normal|break-all|keep-all|break-word)$/],
  ['text-decoration-line', /^(none|(?:(?:underline|overline|line-through)\s*)+)$/],
  ['text-decoration-style', /^(solid|double|dotted|dashed|wavy)$/],
  ['border-collapse', /^(collapse|separate)$/], ['table-layout', /^(auto|fixed)$/],
  ['caption-side', /^(top|bottom)$/], ['empty-cells', /^(show|hide)$/],
  ['list-style-position', /^(inside|outside)$/], ['list-style-type', /^(none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-roman|upper-roman)$/],
  ['object-fit', /^(fill|contain|cover|none|scale-down)$/],
  ['visibility', /^(visible|hidden|collapse)$/], ['cursor', /^(auto|default|pointer|text|not-allowed)$/],
  ['user-select', /^(auto|none|text|all)$/], ['-webkit-user-select', /^(auto|none|text|all)$/],
  ['appearance', /^(auto|none)$/], ['-webkit-appearance', /^(auto|none)$/],
  ['writing-mode', /^horizontal-tb$/], ['direction', /^(ltr|rtl)$/],
])

function length(value: string, percent = false, keywords = ''): boolean {
  if (keywords.split('|').includes(value)) return true
  if (!percent && value.includes('%')) return false
  // These functions and units depend only on the fixed width, font, or explicit lengths.
  const rest = value.replace(/\b(?:calc|min|max|clamp)\s*\(/g, '(')
    .replace(/(?:\d*\.)?\d+(?:px|em|rem|vw|cm|mm|in|pt|pc|%)?/g, '')
  return value.length > 0 && /^[\s()+*/.,-]*$/.test(rest)
}

function color(value: string, view: Window): boolean {
  return !/\b(?:var|url|env|attr)\s*\(/i.test(value) && (view as Window & typeof globalThis).CSS.supports('color', value)
}

function declaration(name: string, value: string, view: Window): void {
  let allowed = false
  if (name === 'display') allowed = displays.has(value)
  else if (simple.has(name)) allowed = simple.get(name)!.test(value)
  else if (['color', 'background', 'background-color', 'text-decoration-color', 'outline-color'].includes(name)) allowed = color(value, view)
  else if (name === 'font-family') allowed = !/[()]/.test(value) && (view as Window & typeof globalThis).CSS.supports(name, value)
  else if (name === 'font-size') allowed = length(value, false, 'xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger')
  else if (['width', 'min-width', 'max-width'].includes(name)) allowed = length(value, true, 'auto|none|min-content|max-content|fit-content')
  else if (['height', 'min-height', 'max-height'].includes(name)) allowed = length(value, false, 'auto|none') || (name === 'min-height' && value === '100vh')
  else if (/^(?:margin|padding)(?:-(?:top|right|bottom|left))?$/.test(name)) allowed = length(value, true, name.startsWith('margin') ? 'auto' : '')
  else if (['line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'border-spacing'].includes(name)) allowed = length(value, name === 'text-indent', 'normal')
  else if (/^border(?:-(?:top|right|bottom|left))?-width$/.test(name) || name === 'outline-width') allowed = length(value, false, 'thin|medium|thick')
  else if (/^border(?:-(?:top|right|bottom|left))?-color$/.test(name)) allowed = color(value, view)
  else if (/^border(?:-(?:top|right|bottom|left))?-style$/.test(name) || name === 'outline-style') allowed = /^(none|hidden|solid|double|dotted|dashed|groove|ridge|inset|outset)$/.test(value)
  else if (name === 'border-radius' || /^border-(?:top|bottom)-(?:left|right)-radius$/.test(name)) allowed = length(value)
  else if (name === 'vertical-align') allowed = length(value, false, 'baseline|sub|super|text-top|text-bottom|middle|top|bottom')
  else if (name === 'aspect-ratio') allowed = /^(?:auto\s+)?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(value)
  else if (name === 'object-position') allowed = length(value, true, 'center|top|bottom|left|right')
  if (!allowed || /\b(?:var|env|attr)\s*\(/i.test(value)) fail(`${name}: ${value}`)
}

export function managedHtmlStylesheetSignature(document: Document): string {
  if (document.adoptedStyleSheets.length) fail('adoptedStyleSheets')
  let count = 0
  let bytes = 0
  if (document.styleSheets.length > 64) fail('样式表数量超过 64')
  const signatures: string[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { return fail('无法读取样式表') }
    const countRules = (items: CSSRuleList): void => {
      for (const rule of items) {
        if (++count > MAX_FLOW_CSS_RULES) fail(`超过 ${MAX_FLOW_CSS_RULES} 条样式规则`)
        if ('cssRules' in rule) countRules((rule as CSSGroupingRule).cssRules)
      }
    }
    countRules(rules)
    if (sheet.media.mediaText && sheet.media.mediaText !== 'screen' && sheet.media.mediaText !== 'all') fail('样式表媒体条件')
    const text = [...rules].map(rule => rule.cssText).join('\n')
    bytes += text.length
    if (bytes > 262144) fail('样式表超过 256 KiB')
    signatures.push(`${sheet.disabled}:${sheet.media.mediaText}:${text}`)
  }
  return signatures.join('\n---sheet---\n')
}

export interface ManagedHtmlFlowProfile { minimumRoots: ReadonlySet<Element>; transparentRoots: ReadonlySet<Element>; stylesheetSignature: string }

export function inspectManagedHtmlFlowProfile(document: Document): ManagedHtmlFlowProfile {
  const view = document.defaultView!
  const stylesheetSignature = managedHtmlStylesheetSignature(document)
  const styles: Array<{ selector: string; style: CSSStyleDeclaration }> = []
  const inspectStyle = (style: CSSStyleDeclaration): void => {
    for (const name of style) declaration(name, style.getPropertyValue(name).trim().toLowerCase(), view)
  }
  const inspectRules = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule.type === 1) {
        const styled = rule as CSSStyleRule
        if ('cssRules' in styled && styled.cssRules.length) fail('嵌套选择器')
        inspectStyle(styled.style)
        styles.push({ selector: styled.selectorText, style: styled.style })
      } else if (rule.type === 4) {
        const media = rule as CSSMediaRule
        if (!/^(?:screen\s+and\s+)?\((?:min-|max-)?width\s*:\s*[\d.]+(?:px|em|rem)\)(?:\s+and\s+\((?:min-|max-)?width\s*:\s*[\d.]+(?:px|em|rem)\))*$/i.test(media.conditionText)) fail(`媒体条件 ${media.conditionText}`)
        inspectRules(media.cssRules)
      } else if (rule.type === 12 || rule.constructor.name === 'CSSLayerBlockRule') {
        inspectRules((rule as CSSGroupingRule).cssRules)
      } else if (rule.constructor.name !== 'CSSLayerStatementRule') fail(`样式规则 ${rule.cssText.slice(0, 80)}`)
    }
  }
  for (const sheet of document.styleSheets) inspectRules(sheet.cssRules)
  const elements = [document.documentElement, ...document.documentElement.querySelectorAll('*')]
  const minimumRoots = new Set<Element>()
  const transparentRoots = new Set<Element>()
  for (const element of elements) {
    if (['svg', 'canvas', 'math'].includes(element.localName)) fail('非 HTML 绘制元素')
    if (element.shadowRoot || element.localName.includes('-')) fail('自定义元素或 Shadow DOM')
    const inline = (element as HTMLElement).style
    if (inline) inspectStyle(inline)
    const computed = view.getComputedStyle(element)
    if (computed.display === 'none') continue
    if (!displays.has(computed.display) || computed.position !== 'static' || computed.float !== 'none'
      || computed.writingMode !== 'horizontal-tb' || computed.transform !== 'none'
      || (!['img', 'video', 'audio'].includes(element.localName) && (computed.overflowX !== 'visible' || computed.overflowY !== 'visible'))
      || computed.backgroundImage !== 'none' || computed.boxShadow !== 'none' || computed.textShadow !== 'none'
      || computed.clip !== 'auto' || computed.clipPath !== 'none' || computed.maskImage !== 'none'
      || computed.filter !== 'none' || computed.mixBlendMode !== 'normal'
      || computed.animationName !== 'none' || computed.transitionDuration.split(',').some(value => Number.parseFloat(value) !== 0)) fail(`元素 ${element.localName} 使用了非自然流布局或绘制效果`)
    for (const pseudo of ['::before', '::after']) {
      const paint = view.getComputedStyle(element, pseudo)
      if (paint.content !== 'none' && paint.content !== 'normal') fail('伪元素生成内容')
    }
    const minimums = [inline?.minHeight ?? '']
    for (const rule of styles) {
      try { if (element.matches(rule.selector) && rule.style.minHeight) minimums.push(rule.style.minHeight) }
      catch { return fail('无法匹配样式选择器') }
    }
    const transparent = computed.backgroundColor === 'rgba(0, 0, 0, 0)' && Number(computed.opacity) === 1 && ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'].every(name => Number.parseFloat(computed[name as keyof CSSStyleDeclaration] as string) === 0)
    if ((element === document.documentElement || element === document.body) && transparent) transparentRoots.add(element)
    if (!minimums.includes('100vh')) continue
    if (minimums.some(value => value && value !== '100vh')) fail('根最小高度存在竞争声明')
    if (computed.backgroundColor !== 'rgba(0, 0, 0, 0)' || Number(computed.opacity) !== 1
      || ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(name => Number.parseFloat(computed[name as keyof CSSStyleDeclaration] as string) !== 0)) fail('视口最小高度根不是透明空白容器')
    for (let current = element; current !== document.documentElement; current = current.parentElement!) {
      if (!current.parentElement || [...current.parentElement.children].filter(child => view.getComputedStyle(child).display !== 'none').length !== 1) fail('视口最小高度只允许单一根容器链')
    }
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = view.getComputedStyle(current)
      if (['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(name => Number.parseFloat(style[name as keyof CSSStyleDeclaration] as string) !== 0) || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || [...current.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim())) fail('根容器链含绘制或文字')
      transparentRoots.add(current)
    }
    minimumRoots.add(element)
  }
  return { minimumRoots, transparentRoots, stylesheetSignature }
}


/** Every browser-computed property participates, so admission cannot grow beyond its proof.
 * Only unpainted root height and inactive transform origins may vary with the viewport.
 */
export function managedHtmlPaintSnapshot(element: Element, transparentRoot: boolean, minimumRoot: boolean): string[] {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element)
  return [...style].filter(property => {
    if (transparentRoot && ['height', 'block-size'].includes(property)) return false
    if (minimumRoot && ['min-height', 'min-block-size'].includes(property)) return false
    if (style.transform === 'none' && style.perspective === 'none' && ['transform-origin', 'perspective-origin'].includes(property)) return false
    return true
  }).map(property => `${property}:${style.getPropertyValue(property)}`)
}

/** Frozen before publishing the size; author resize handlers may not erase or repaint its content. */
export function freezeManagedHtmlLayout(document: Document): () => boolean {
  const { transparentRoots, minimumRoots } = inspectManagedHtmlFlowProfile(document)
  const view = document.defaultView!
  const painted = () => [document.documentElement, ...document.documentElement.querySelectorAll('*')].filter(element => view.getComputedStyle(element).display !== 'none')
  const elements = painted()
  const values = (element: Element): Array<string | number> => {
    const rect = element.getBoundingClientRect(), style = view.getComputedStyle(element)
    const values: Array<string | number> = [rect.x + view.scrollX, rect.y + view.scrollY, rect.width]
    if (!transparentRoots.has(element)) values.push(rect.height)
    values.push(...managedHtmlPaintSnapshot(element, transparentRoots.has(element), minimumRoots.has(element)))
    // Attribute names are sorted: adding/removing a same-size srcset, poster, type, etc. is a change.
    // data-* alone is metadata; any selector effect is covered by the full computed signature.
    for (const attribute of [...element.attributes].filter(attribute => !attribute.name.startsWith('data-')).sort((a, b) => a.name.localeCompare(b.name))) values.push(attribute.name, attribute.value)
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      values.push(node.textContent)
      const range = document.createRange(); range.selectNodeContents(node)
      for (const box of range.getClientRects()) values.push(box.x + view.scrollX, box.y + view.scrollY, box.width, box.height)
      range.detach()
    }
    if (['img', 'video', 'audio'].includes(element.localName)) values.push((element as HTMLImageElement | HTMLMediaElement).currentSrc)
    if (['input', 'textarea', 'select'].includes(element.localName)) values.push((element as HTMLInputElement).value, String((element as HTMLInputElement).checked), String((element as HTMLInputElement).indeterminate), String((element as HTMLSelectElement).selectedIndex))
    return values
  }
  const snapshots = elements.map(values)
  return () => {
    const current = painted()
    return current.length === elements.length && current.every((element, i) => {
      if (element !== elements[i]) return false
      const before = snapshots[i]!, after = values(element)
      return before.length === after.length && before.every((value, j) => typeof value === 'number' && typeof after[j] === 'number' ? Math.abs(value - (after[j] as number)) <= 1 : value === after[j])
    })
  }
}


/** Child resize events run on the child rendering turn, after the parent's RAF may have run. */
export function waitForManagedHtmlResize(document: Document, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const view = document.defaultView!
    let frame = 0
    const cleanup = () => { view.cancelAnimationFrame(frame); view.clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')) }
    const timeout = view.setTimeout(() => { cleanup(); reject(new Error('Flow HTML 子页面 resize 等待超时；请使用演示页。')) }, 3000)
    if (signal.aborted) { cancel(); return }
    signal.addEventListener('abort', cancel, { once: true })
    frame = view.requestAnimationFrame(() => {
      frame = view.requestAnimationFrame(() => { cleanup(); resolve() })
    })
  })
}
