import type { HtmlDesignCapture, HtmlAssemblyDiagnostic, MeasuredHtmlChild, MeasuredHtmlElement } from '../../../../core/contentApply/assembly/htmlAssembly'
import { cssUsesViewport } from '../../../../components/web/measuredFragmentBox'

/** Host-owned browser function; author scripts are disabled by the measurement document's CSP. */
export async function captureHtmlDesignViewport(resourceWaitMs: number, viewportCss = cssUsesViewport): Promise<HtmlDesignCapture> {
  const diagnostics: HtmlAssemblyDiagnostic[] = []
  const styleOf = (style: CSSStyleDeclaration): Record<string, string> => Object.fromEntries(Array.from(style, name => [name, style.getPropertyValue(name)]))
  const referenceOf = (image: HTMLImageElement) => image.getAttribute('src') ?? image.currentSrc
  let timedOut = false
  let timeout!: ReturnType<typeof setTimeout>
  const deadline = new Promise<void>(resolve => { timeout = setTimeout(() => { timedOut = true; resolve() }, resourceWaitMs) })
  const waits: Promise<unknown>[] = []
  if (document.fonts) waits.push(document.fonts.ready.then(() => {
    document.fonts.forEach(font => {
      if (font.status === 'error') diagnostics.push({ level: 'warning', code: 'html-font-load', message: `字体 ${font.family} 未加载，测量保留浏览器实际替代字体。`, reference: font.family })
    })
  }))
  for (const image of Array.from(document.images)) {
    image.loading = 'eager'
    waits.push(image.decode().catch(() => { diagnostics.push({ level: 'warning', code: 'html-image-decode', message: '局部图片未能解码；其余内容继续测量。', reference: referenceOf(image) }) }))
  }
  // CSS images affect paint and, in a few cases, intrinsic sizing. Decode them before the single read.
  const cssImages = new Set<string>()
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const style = getComputedStyle(element)
    for (const name of ['background-image', 'mask-image', 'border-image-source', 'list-style-image']) {
      for (const match of style.getPropertyValue(name).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
        const reference = (match[1] ?? match[2] ?? match[3] ?? '').trim()
        if (reference && !cssImages.has(reference)) {
          cssImages.add(reference)
          const image = new Image(); image.src = reference
          waits.push(image.decode().catch(() => { diagnostics.push({ level: 'warning', code: 'html-css-image-decode', message: '局部 CSS 图片未能解码；保留样式及资源引用。', reference }) }))
        }
      }
    }
  }
  await Promise.race([Promise.all(waits), deadline])
  clearTimeout(timeout)
  if (timedOut) diagnostics.push({ level: 'warning', code: 'html-resource-wait', message: '部分字体或图片仍未返回；按当前可用内容测量并保留引用。' })
  // This disposable copy reserves standard finite disclosure content before free
  // placement. Only the copy is opened; the returned author attributes stay unchanged.
  const disclosures = [...document.querySelectorAll('details')].map(element => ({ element, open: element.open }))
  for (const { element } of disclosures) element.open = true
  // Give font/image completion one layout/paint turn. No foreground window or editor state is read.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

  const elements: MeasuredHtmlElement[] = []
  const all = Array.from(document.body.querySelectorAll('*'))
  const body = document.body
  const nodes = [body, ...all]
  const indices = new Map<Element, number>(nodes.map((element, index) => [element, index]))
  const styles = new Map<Element, CSSStyleDeclaration>(nodes.map(element => [element, getComputedStyle(element)]))
  let contentBounds: HtmlDesignCapture['contentBounds'], viewportDependent = false
  const includeBox = (rect: DOMRect): void => {
    if (!(rect.width > 0 && rect.height > 0)) return
    if (!contentBounds) { contentBounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }; return }
    const right = Math.max(contentBounds.x + contentBounds.width, rect.right)
    const bottom = Math.max(contentBounds.y + contentBounds.height, rect.bottom)
    const x = Math.min(contentBounds.x, rect.left), y = Math.min(contentBounds.y, rect.top)
    contentBounds = { x, y, width: right - x, height: bottom - y }
  }
  const inspectSpecifiedStyle = (style: CSSStyleDeclaration): void => {
    viewportDependent ||= viewportCss(style)
  }
  for (const child of Array.from(body.childNodes)) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
    const range = document.createRange(); range.selectNodeContents(child); includeBox(range.getBoundingClientRect())
  }
  const linears = new Map<Element, DOMMatrix | null>()
  const angularDegrees = (value: string): number | undefined => {
    const match = /^([+-]?(?:\d*\.)?\d+)(deg|rad|turn|grad)$/.exec(value)
    if (!match) return undefined
    const number = Number(match[1])
    const units: Record<string, number> = { deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 }
    return number * units[match[2]!]!
  }
  const linearOf = (element: Element): DOMMatrix | null => {
    if (linears.has(element)) return linears.get(element)!
    const style = styles.get(element) ?? getComputedStyle(element)
    const parent = element.parentElement ? linearOf(element.parentElement) : new DOMMatrix()
    let result: DOMMatrix | null = parent
    if (result && style.perspective !== 'none') result = null
    if (result) {
      const own = new DOMMatrix(style.transform === 'none' ? undefined : style.transform)
      if (!own.is2D) result = null
      else {
        const rotate = style.rotate ?? 'none'
        if (rotate !== 'none') {
          const parts = rotate.split(/\s+/)
          const angle = angularDegrees(parts.at(-1)!)
          const aroundZ = parts.length === 1 || parts.length === 2 && parts[0] === 'z'
            || parts.length === 4 && Number(parts[0]) === 0 && Number(parts[1]) === 0 && Number(parts[2]) === 1
          if (angle === undefined || !aroundZ) result = null
          else result = result.rotate(angle)
        }
        const scale = style.scale ?? 'none'
        if (result && scale !== 'none') {
          const factors = scale.split(/\s+/).map(value => value.endsWith('%') ? parseFloat(value) / 100 : Number(value))
          if (factors.length > 2 && factors[2] !== 1) result = null
          else result = result.scale(factors[0], factors[1] ?? factors[0])
        }
        if (result) result = result.multiply(own)
        const zoom = (style.zoom ?? '').endsWith('%') ? parseFloat(style.zoom) / 100 : parseFloat(style.zoom ?? '1')
        if (result && Number.isFinite(zoom) && zoom !== 1) result = result.scale(zoom)
      }
    }
    linears.set(element, result)
    return result
  }
  const borderSize = (element: Element, style: CSSStyleDeclaration, axis: 'width' | 'height'): number => {
    const value = parseFloat(style.getPropertyValue(axis))
    if (Number.isFinite(value)) {
      if (style.boxSizing === 'border-box') return value
      const sides = axis === 'width' ? ['left', 'right'] : ['top', 'bottom']
      return value + sides.reduce((sum, side) => sum + (parseFloat(style.getPropertyValue(`padding-${side}`)) || 0) + (parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0), 0)
    }
    return element instanceof HTMLElement ? axis === 'width' ? element.offsetWidth : element.offsetHeight : 0
  }
  const pathOf = (element: Element): number[] => {
    if (element === body) return []
    const parent = element.parentElement!
    return [...pathOf(parent), Array.from(parent.childNodes).indexOf(element)]
  }
  // All style/geometry reads finish before the result is converted into parent-local frames.
  for (const element of nodes) {
    const style = styles.get(element)!
    const rect = element.getBoundingClientRect()
    if (element !== body && style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility)) {
      includeBox(rect)
      if (style.position === 'fixed') viewportDependent = true
    }
    if ('style' in element) inspectSpecifiedStyle((element as HTMLElement).style)
    const width = borderSize(element, style, 'width'), height = borderSize(element, style, 'height')
    const linear = linearOf(element)
    let frame: MeasuredHtmlElement['frame']
    let geometryIssue: string | undefined
    if (!linear) geometryIssue = 'non-affine-3d-transform'
    else if (width > 0 && height > 0 && style.display !== 'none') {
      const { a, b, c, d } = linear
      // AABB supplies translation only. Local size and the complete accumulated linear transform
      // recover the upper-left even with reflection, skew, non-central origins and nested rotation.
      const e = rect.left - Math.min(0, a * width, c * height, a * width + c * height)
      const f = rect.top - Math.min(0, b * width, d * height, b * width + d * height)
      const corners = { width: Math.abs(a * width) + Math.abs(c * height), height: Math.abs(b * width) + Math.abs(d * height) }
      // Fragmented inline boxes or perspective must not be mislabeled as one free affine rectangle.
      if (Math.abs(corners.width - rect.width) > 0.1 || Math.abs(corners.height - rect.height) > 0.1) geometryIssue = 'non-rectangular-layout-box'
      else frame = { width, height, transform: [a, b, c, d, e, f] }
    }
    const pseudoElements: MeasuredHtmlElement['pseudoElements'] = {}
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(element, pseudo)
      if (!['none', 'normal', ''].includes(computed.content)) pseudoElements[pseudo] = styleOf(computed)
    }
    elements.push({ sourcePath: pathOf(element), tagName: element.localName, namespace: element.namespaceURI ?? undefined,
      attributes: Object.fromEntries(Array.from(element.attributes, attribute => [attribute.name, attribute.value])), sourceHtml: element.outerHTML,
      style: styleOf(style), parentDisplay: element.parentElement ? (styles.get(element.parentElement) ?? getComputedStyle(element.parentElement)).display : undefined,
      pseudoElements, frame, geometryIssue,
      children: Array.from(element.childNodes).flatMap<MeasuredHtmlChild>(child => {
        if (child instanceof Element) return [{ kind: 'element' as const, index: indices.get(child)! }]
        if (child.nodeType === Node.TEXT_NODE) return [{ kind: 'text' as const, text: child.textContent ?? '' }]
        if (child.nodeType === Node.COMMENT_NODE) return [{ kind: 'comment' as const, text: child.textContent ?? '' }]
        return []
      }) })
  }
  const pageStyle = styleOf(getComputedStyle(document.documentElement))
  const bodyStyle = styles.get(body)!
  // CSS propagates the body's background to the document canvas if html has no own background.
  if (pageStyle['background-image'] === 'none' && ['transparent', 'rgba(0, 0, 0, 0)'].includes(pageStyle['background-color'] ?? 'transparent')) {
    for (const name of Array.from(bodyStyle).filter(name => name.startsWith('background-'))) pageStyle[name] = bodyStyle.getPropertyValue(name)
  }
  const supportRules: string[] = []
  const selectors: string[] = []
  let unreadableStylesheet = false
  const collectRules = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE || rule.type === CSSRule.KEYFRAMES_RULE || rule.cssText.startsWith('@property')) supportRules.push(rule.cssText)
      else if ('cssRules' in rule) collectRules((rule as CSSGroupingRule).cssRules)
      if (rule.type === CSSRule.STYLE_RULE) {
        const styled = rule as CSSStyleRule
        selectors.push(styled.selectorText)
        try {
          if (body.matches(styled.selectorText) || body.querySelector(styled.selectorText)) inspectSpecifiedStyle(styled.style)
        } catch { /* A selector unsupported by querySelector does not invalidate its browser layout. */ }
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { collectRules(sheet.cssRules) }
    catch { unreadableStylesheet = true; diagnostics.push({ level: 'warning', code: 'html-stylesheet-read', message: '样式表可用于当前排版，但浏览器未开放其字体/动效规则读取。', reference: sheet.href ?? undefined }) }
  }
  for (const { element, open } of disclosures) element.open = open
  // Geometry/styles came from the reserved copy. HTML/state always comes from
  // the original disclosure state, including ancestors containing a details node.
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    elements[index]!.attributes = Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]))
    elements[index]!.sourceHtml = node.outerHTML
  }
  const scopes = new Map<Element, Set<string>>()
  const commonRoot = (related: Element[]): Element => {
    let root = related[0] ?? body
    while (root !== body && !related.every(value => root.contains(value))) root = root.parentElement ?? body
    return body.contains(root) ? root : body
  }
  const retain = (related: Element[], reason: string) => {
    if (!related.length) return
    const root = commonRoot(related)
    const reasons = scopes.get(root) ?? new Set<string>(); reasons.add(reason); scopes.set(root, reasons)
  }
  // Browser ownership, including form= controls and labels outside the form subtree.
  for (const form of Array.from(document.forms)) {
    const controls = Array.from(form.elements)
    if (controls.length) retain([form, ...controls], 'form')
  }
  for (const label of Array.from(body.querySelectorAll('label'))) if (label.control) retain([label, label.control], 'label-control')
  const radios = Array.from(body.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
  for (const radio of radios) if (radio.name) retain(radios.filter(value => value.name === radio.name && value.form === radio.form), 'radio-group')
  for (const details of Array.from(body.querySelectorAll('details'))) retain([details], 'disclosure')

  const state = /:(?:checked|indeterminate|disabled|enabled|required|optional|valid|invalid|user-valid|user-invalid|read-only|read-write|placeholder-shown|focus-within|focus-visible|focus|hover|active|open)\b|\[open\]/g
  const checkedAnchors = new Set<HTMLInputElement>()
  const potentialSelector = (selector: string) => selector.replace(state, '').replace(/::[\w-]+(?:\([^)]*\))?/g, '')
  const matches = (selector: string): Element[] => Array.from(document.querySelectorAll(selector))
  for (const selectorText of selectors) {
    if (!selectorText.match(state)) continue
    // The browser resolves ordinary selectors. Nested functional state selectors
    // need their complete input context; no arbitrary CSS dependency parser is introduced.
    if (/:[\w-]+\([^)]*(?::(?:checked|indeterminate|disabled|enabled|required|optional|valid|invalid|user-valid|user-invalid|read-only|read-write|placeholder-shown|focus|hover|active|open)\b|\[open\])/.test(selectorText)) {
      retain([body], 'state-css-context'); continue
    }
    for (const selector of selectorText.split(',')) {
      const found = [...selector.matchAll(state)]
      if (!found.length) continue
      try {
        const targets = matches(potentialSelector(selector).trim() || '*')
        const anchors = found.flatMap(match => matches(potentialSelector(selector.slice(0, match.index)).trim() || '*'))
        if (selector.includes(':checked')) for (const anchor of anchors) if (anchor instanceof HTMLInputElement && ['radio', 'checkbox'].includes(anchor.type)) checkedAnchors.add(anchor)
        if (targets.length || anchors.length) retain([...anchors, ...targets], 'state-css')
      } catch { retain([body], 'state-css-context') }
    }
  }
  if (unreadableStylesheet && scopes.size) retain([body], 'stylesheet-context')

  // A live state can resize normal-flow ancestors or move later siblings outside
  // the selector's subject. Keep that measured layout relationship in the same
  // source scope, rather than leaving fixed fragments over its newly shown controls.
  const checkedInputs = Array.from(body.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]'))
  const checkedState = checkedInputs.map(input => input.checked)
  const boxes = nodes.map(node => node.getBoundingClientRect())
  for (const anchor of checkedAnchors) {
    anchor.checked = !anchor.checked
    const changed = nodes.filter((node, index) => {
      if (node === body) return false
      const before = boxes[index]!, after = node.getBoundingClientRect()
      return ['x', 'y', 'width', 'height'].some(axis => Math.abs(before[axis as keyof DOMRect] as number - (after[axis as keyof DOMRect] as number)) > 0.1)
    })
    if (changed.length) retain([anchor, ...changed], 'state-layout')
    checkedInputs.forEach((input, index) => { input.checked = checkedState[index]! })
  }

  for (const [root] of [...scopes]) for (const node of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const style = styles.get(node)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') continue
    const position = style?.position
    if (position === 'fixed') retain([body], 'viewport-layout')
    else if (position === 'absolute' && node instanceof HTMLElement && node.offsetParent && !root.contains(node.offsetParent)) {
      retain([root, node.offsetParent], 'positioned-layout')
    }
  }

  // Ancestor shells preserve inherited CSS and descendant selectors. Test their
  // actual selector matches before using them; outside sibling/nth-child context
  // is retained as the whole input when pruning would change a relevant match.
  for (const [root, reasons] of [...scopes]) {
    if (root === body) continue
    const cloned = document.cloneNode(true) as Document
    const cloneAt = (path: readonly number[]) => path.reduce<Node | undefined>((node, index) => node?.childNodes[index], cloned.body)
    const path = pathOf(root), target = cloneAt(path) as Element
    let current = target
    while (current !== cloned.body) {
      const parent = current.parentElement!
      for (const child of Array.from(parent.childNodes)) if (child !== current) child.remove()
      current = parent
    }
    const originals = [root, ...root.querySelectorAll('*')], copies = [target, ...target.querySelectorAll('*')]
    let changed = false
    for (const selector of selectors) {
      try {
        const potential = potentialSelector(selector)
        if (!potential.trim()) continue
        if (originals.some((value, index) => value.matches(potential) !== copies[index]!.matches(potential))) { changed = true; break }
      } catch { /* Unsupported selectors keep their native browser behavior. */ }
    }
    if (changed) { scopes.delete(root); retain([body], 'selector-context') }
    else if (!elements[indices.get(root)!]?.frame || elements[indices.get(root)!]?.geometryIssue) {
      scopes.delete(root)
      let measurable = root.parentElement ?? body
      while (measurable !== body && (!elements[indices.get(measurable)!]?.frame || elements[indices.get(measurable)!]?.geometryIssue)) measurable = measurable.parentElement ?? body
      retain([measurable], [...reasons].join(', '))
    }
  }
  const sourceScopes = [...scopes].filter(([root]) => ![...scopes.keys()].some(parent => parent !== root && parent.contains(root)))
    .map(([root, reasons]) => ({ index: indices.get(root)!, reason: [...reasons].join(', ') }))
  return { viewport: { width: innerWidth, height: innerHeight }, contentBounds, viewportDependent,
    body: 0, pageStyle, supportCss: supportRules.join('\n'), sourceScopes, elements, diagnostics }
}
