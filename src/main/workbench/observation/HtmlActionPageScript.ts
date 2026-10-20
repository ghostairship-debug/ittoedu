/** Code in this file executes only in the sandboxed HTML preview frame. Its
 * return values are observations, never authority to read or write host files. */

export interface HtmlPageElement {
  /** Host-captured child realm inside the current preview; never a caller-supplied frame selector. */
  frameToken?: string
  frameProcessId?: number
  path: number[]
  fingerprint: string
  tag: string
  role: string
  label: string
  text: string
  editable: boolean
  value?: string
  rect: { x: number; y: number; width: number; height: number }
}

export interface HtmlPageState {
  url: string
  title: string
  readyState: string
  pageIndex: number
  pageCount: number
  structure: string[]
  diagnostics: string[]
  elements: HtmlPageElement[]
  observationScope?: { kind: 'visible-preview-frames'; frames: HtmlFrameObservationScope[];
    coordinateSpace?: 'preview-viewport-css-pixels'; viewport?: { width: number; height: number };
    limitations?: string[]; truncatedStructureSegments?: number; truncatedDiagnostics?: number }
  matchedElements?: number
  viewport?: { width: number; height: number }
}

export interface HtmlFrameObservationScope {
  frameId: number
  url: string
  status: 'observed' | 'not-visible' | 'unavailable'
  returnedElements: number
  matchedElements: number
  truncatedElements: number
  reason?: string
}

export type HtmlPageOperation =
  | { type: 'observe'; clip?: HtmlPageElement['rect'] }
  | { type: 'click'; path: number[]; fingerprint: string; frameToken?: string; frameProcessId?: number; point?: { x: number; y: number } }
  | { type: 'input'; path: number[]; fingerprint: string; value: string; frameToken?: string; frameProcessId?: number; point?: { x: number; y: number }; requireFocus?: boolean; expectedIdentity?: string }

export type HtmlPageActionResult = { applied: boolean; reason?: string; point?: { x: number; y: number }; rect?: HtmlPageElement['rect']; selectIndex?: number;
  identityFingerprint?: string; value?: string; inputType?: string; range?: { min: number; max: number; step: number };
  /** Trusted input completed, but the control did not retain the requested value. */
  inputOutcome?: { status: 'value-mismatch'; requestedValue: string; actualValue: string };
  dateParts?: string[] }

/** The exported player already owns scene order, guards, and navigation lifecycle. */
interface HtmlCoursePlayer {
  navigation: { read(): { locationId: string | null; scenes: { id: string }[] } }
  go(id: string): Promise<boolean>
}

/** Returns false only when this is an ordinary HTML preview, whose pagination stays in charge. */
export async function htmlCourseNavigateOperation(index: number): Promise<boolean> {
  const courseWindow = window as Window & { coursePlayerReady?: Promise<HtmlCoursePlayer>; coursePlayer?: HtmlCoursePlayer }
  const player = courseWindow.coursePlayerReady ? await courseWindow.coursePlayerReady : courseWindow.coursePlayer
  if (typeof player?.navigation?.read !== 'function' || typeof player.go !== 'function') return false
  const state = player.navigation.read()
  if (!Array.isArray(state.scenes) || state.scenes.length === 0) return false
  const destination = state.scenes[Math.max(0, Math.min(state.scenes.length - 1, index))]!
  if (!await player.go(destination.id)) throw new Error('HTML 课件未接受页面导航')
  return true
}

export function htmlCourseNavigateScript(index: number): string {
  return `(${htmlCourseNavigateOperation.toString()})(${JSON.stringify(index)})`
}

/** Hash/query navigation retains the same loaded HTML document and sandbox origin. */
export function sameHtmlPreviewDocumentUrl(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual), b = new URL(expected)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch { return false }
}

/** Kept self-contained so its compiled source can be evaluated by WebFrameMain. */
export function htmlActionPageOperation(input: HtmlPageOperation): HtmlPageState | HtmlPageActionResult {
  const pathOf = (element: Element): number[] => {
    const result: number[] = []
    for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
      const parent = node.parentElement
      if (!parent) return []
      result.unshift(Array.prototype.indexOf.call(parent.children, node) as number)
    }
    return result
  }
  const resolve = (path: number[]): Element | null => {
    if (!Array.isArray(path) || path.length > 64 || path.some(index => !Number.isSafeInteger(index) || index < 0)) return null
    let node: Element | null = document.documentElement
    for (const index of path) node = node?.children.item(index) ?? null
    return node
  }
  const labelOf = (element: Element): string => {
    const html = element as HTMLElement
    return (element.getAttribute('aria-label') ?? element.getAttribute('title')
      ?? element.getAttribute('placeholder') ?? html.innerText ?? element.textContent ?? '').trim().slice(0, 180)
  }
  const editable = (element: Element): boolean => {
    if (element instanceof HTMLInputElement) return !['file', 'password', 'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio'].includes(element.type)
    return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      || (element instanceof HTMLElement && (element.isContentEditable || element.getAttribute('role') === 'textbox'))
  }
  const fingerprint = (element: Element): string => {
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.value : ''
    return JSON.stringify([element.localName, element.getAttribute('id'), element.getAttribute('name'),
      element.getAttribute('role'), element.getAttribute('type'), labelOf(element), value])
  }
  const stableIdentity = (element: Element): string => JSON.stringify([element.localName, element.id, element.getAttribute('name'),
    element.getAttribute('role'), element.getAttribute('type'), element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('placeholder')])
  // Root overflow clips the viewport. In HTML, a visible root propagates the
  // body's overflow to that same viewport, even when absolute children leave
  // the body's own box empty. Ordinary overflow containers still clip normally.
  const rootStyle = getComputedStyle(document.documentElement)
  const bodyOverflowAtViewport = (!rootStyle.overflowX || rootStyle.overflowX === 'visible')
    && (!rootStyle.overflowY || rootStyle.overflowY === 'visible')
    && !/(?:paint|layout|strict|content)/.test(rootStyle.contain)
    && (!document.body || !/(?:paint|layout|strict|content)/.test(getComputedStyle(document.body).contain))
  const bodyOverflowClips = (element: Element) => {
    // Absolutely positioned descendants whose containing block is outside body
    // escape its box clip, even when root overflow itself is hidden.
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position
      if (position !== 'absolute' && position !== 'fixed') continue
      let contained = false
      for (let parent = node.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (position === 'absolute' && style.position && style.position !== 'static'
          || style.transform && style.transform !== 'none' || style.perspective && style.perspective !== 'none'
          || style.filter && style.filter !== 'none' || /(?:paint|layout|strict|content)/.test(style.contain)) { contained = true; break }
      }
      if (!contained) return false
    }
    return true
  }
  const overflowRect = (element: Element, descendant: Element) => element === document.documentElement
    || element === document.body && (bodyOverflowAtViewport || !bodyOverflowClips(descendant))
      ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : element.getBoundingClientRect()
  const visibleRectOf = (element: Element) => {
    const rect = element.getBoundingClientRect()
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    if (input.type === 'observe' && input.clip) {
      left = Math.max(left, input.clip.x); top = Math.max(top, input.clip.y)
      right = Math.min(right, input.clip.x + input.clip.width); bottom = Math.min(bottom, input.clip.y + input.clip.height)
    }
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.visibility === 'hidden' || style.display === 'none') return null
      if (parent === element) continue
      const clip = overflowRect(parent, element)
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null
  }
  if (input.type !== 'observe') {
    const element = resolve(input.path)
    if (!element?.isConnected || (input.type === 'input' && input.expectedIdentity
      ? stableIdentity(element) !== input.expectedIdentity : fingerprint(element) !== input.fingerprint))
      return { applied: false, reason: 'stale-element' }
    if ((input.type === 'input' && !(element instanceof HTMLElement))
      || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true')
      return { applied: false, reason: 'not-clickable' }
    if (input.type === 'input' && (input.value.length > 8192 || !editable(element)
      || element instanceof HTMLInputElement && element.readOnly || element instanceof HTMLTextAreaElement && element.readOnly))
      return { applied: false, reason: 'not-editable' }
    let selectIndex: number | undefined
    let range: { min: number; max: number; step: number } | undefined
    let dateParts: string[] | undefined
    if (input.type === 'input' && element instanceof HTMLSelectElement) {
      selectIndex = Array.from(element.options).filter(option => !option.disabled && !option.closest('optgroup:disabled')).findIndex(option => option.value === input.value)
      if (selectIndex < 0) return { applied: false, reason: 'invalid-option' }
    }
    if (input.type === 'input' && element instanceof HTMLInputElement && element.type === 'range') {
      range = { min: Number(element.min || 0), max: Number(element.max || 100), step: element.step === 'any' ? 1 : Number(element.step || 1) }
      const requested = Number(input.value)
      if (!input.value.trim() || !Number.isFinite(requested) || requested < range.min || requested > range.max)
        return { applied: false, reason: 'invalid-range-value' }
    }
    if (input.type === 'input' && element instanceof HTMLInputElement && element.type === 'date') {
      if (input.value && !/^\d{4,}-\d{2}-\d{2}$/.test(input.value)) return { applied: false, reason: 'invalid-date-value' }
      const [year = '', month = '', day = ''] = input.value.split('-')
      const values: Record<string, string> = { year, month, day }
      dateParts = Intl.DateTimeFormat(navigator.language, { calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(2001, 10, 23)).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => values[part.type]!)
    }
    if (input.type === 'input' && input.requireFocus && document.activeElement !== element && !element.contains(document.activeElement))
      return { applied: false, reason: 'input-focus-changed' }
    const visibleRect = visibleRectOf(element)
    if (!visibleRect) return { applied: false, reason: 'not-visible' }
    const { left, top, right, bottom } = visibleRect
    const point = input.point ?? { x: (left + right) / 2, y: (top + bottom) / 2 }
    if (point.x < left || point.x >= right || point.y < top || point.y >= bottom) return { applied: false, reason: 'not-visible' }
    const hit = document.elementFromPoint(point.x, point.y)
    if (hit !== element && !element.contains(hit)) return { applied: false, reason: 'covered-element' }
    // Preparation only. The Main port delivers trusted browser mouse/keyboard input.
    return { applied: true, point, rect: { x: left, y: top, width: right - left, height: bottom - top },
      identityFingerprint: stableIdentity(element),
      value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : element.textContent ?? '',
      ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}), ...(range ? { range } : {}),
      ...(dateParts ? { dateParts } : {}),
      ...(selectIndex !== undefined ? { selectIndex } : {}) }
  }
  const pageRoot = document.body?.querySelector(':scope > main') ?? document.body
  const pages = pageRoot ? Array.from(pageRoot.children).filter(child => child.localName === 'section') : []
  const visibleIndex = pages.findIndex(element => getComputedStyle(element).display !== 'none')
  const player = (window as Window & { coursePlayer?: HtmlCoursePlayer }).coursePlayer
  const courseState = typeof player?.navigation?.read === 'function' && typeof player.go === 'function'
    ? player.navigation.read() : undefined
  const courseScenes = Array.isArray(courseState?.scenes) ? courseState.scenes : []
  const courseIndex = courseScenes.findIndex(scene => scene.id === courseState?.locationId)
  const elements: HtmlPageElement[] = []
  const candidates = document.body ? Array.from(document.body.querySelectorAll('*')) : []
  const isEditingHost = (element: Element) => element instanceof HTMLElement && element.isContentEditable
    && !(element.parentElement instanceof HTMLElement && element.parentElement.isContentEditable)
  const isControl = (element: Element) => ['button', 'a', 'input', 'textarea', 'select', 'summary', 'label'].includes(element.localName)
    || element.hasAttribute('onclick') || element.hasAttribute('tabindex') || element.hasAttribute('role') || isEditingHost(element)
  // Observe rendered text once, at its text/control owner. Container innerText and
  // textContent repeat descendants and can expose hidden source or offscreen results.
  // This is intentionally separate from action preparation and its fingerprint.
  const observationRect = (rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, element: Element) => {
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    if (input.clip) {
      left = Math.max(left, input.clip.x); top = Math.max(top, input.clip.y)
      right = Math.min(right, input.clip.x + input.clip.width); bottom = Math.min(bottom, input.clip.y + input.clip.height)
    }
    const visibility = getComputedStyle(element).visibility
    if (visibility === 'hidden' || visibility === 'collapse') return null
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') return null
      const clip = overflowRect(parent, element)
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null
  }
  const normalizedText = (text: string) => text.replace(/\s+/g, ' ').trim()
  const renderedText = (node: Text): string => {
    const parent = node.parentElement
    if (!parent || parent.closest('script,style,noscript,template')) return ''
    const text = node.data
    const range = document.createRange()
    range.selectNodeContents(node)
    // Chromium supplies text ranges; the fallback supports DOM-only consumers.
    if (typeof range.getClientRects !== 'function') return observationRect(parent.getBoundingClientRect(), parent) ? text : ''
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    if (!rects.some(rect => observationRect(rect, parent))) return ''
    if (rects.every(rect => {
      const visible = observationRect(rect, parent)
      return visible && visible.left === rect.left && visible.top === rect.top && visible.right === rect.right && visible.bottom === rect.bottom
    })) return text
    // A wrapping text node can straddle the viewport or a scroll container.
    // Only that partial node needs glyph ranges, so its hidden tail stays hidden.
    let result = '', previous = -1
    for (let index = 0; index < text.length; index += 1) {
      range.setStart(node, index); range.setEnd(node, index + 1)
      if (!Array.from(range.getClientRects()).some(rect => observationRect(rect, parent))) continue
      if (previous >= 0 && previous !== index - 1) result += ' '
      result += text[index]; previous = index
    }
    return result
  }
  const ownsDescendantText = (element: Element) => ['button', 'a', 'input', 'textarea', 'select', 'summary', 'label', 'output'].includes(element.localName)
    || element.hasAttribute('onclick') || element.hasAttribute('tabindex') || isEditingHost(element)
    || /^(button|checkbox|combobox|gridcell|link|listbox|menuitem|menuitemcheckbox|menuitemradio|option|radio|scrollbar|searchbox|slider|spinbutton|switch|tab|textbox|treeitem|alert|status|log|progressbar|meter|timer)$/.test(element.getAttribute('role') ?? '')
  const textSeparator = (previous: Text | undefined, current: Text, owner: Element): string => {
    if (!previous) return ''
    const ancestors = new Set<Element>()
    for (let parent = previous.parentElement; parent; parent = parent.parentElement) {
      ancestors.add(parent)
      if (parent === owner) break
    }
    let common = current.parentElement!
    while (!ancestors.has(common) && common.parentElement) common = common.parentElement
    const blockBoundary = (element: Element) => {
      const display = getComputedStyle(element).display
      return display && display !== 'none' && display !== 'contents' && !display.startsWith('inline') && !display.startsWith('ruby')
    }
    for (let parent = previous.parentElement; parent && parent !== common; parent = parent.parentElement) if (blockBoundary(parent)) return ' '
    for (let parent = current.parentElement; parent && parent !== common; parent = parent.parentElement) if (blockBoundary(parent)) return ' '
    const between = document.createRange()
    between.setStartAfter(previous); between.setEndBefore(current)
    return Array.from(common.querySelectorAll('br')).some(element => between.intersectsNode(element) && element.getClientRects().length > 0) ? ' ' : ''
  }
  const textByOwner = new Map<Element, string[]>()
  const previousTextByOwner = new Map<Element, Text>()
  const segments: Array<{ owner: Element; text: string }> = []
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = renderedText(node as Text)
      if (!text) continue
      let owner: Element = node.parentElement!
      for (let parent: Element | null = owner; parent && parent !== document.body; parent = parent.parentElement) {
        if (ownsDescendantText(parent)) { owner = parent; break }
      }
      const owned = textByOwner.get(owner) ?? []
      const separator = textSeparator(previousTextByOwner.get(owner), node as Text, owner)
      owned.push(separator, text); textByOwner.set(owner, owned); previousTextByOwner.set(owner, node as Text)
      const previous = segments.at(-1)
      if (previous?.owner === owner) previous.text += separator + text
      else segments.push({ owner, text })
    }
  }
  candidates.sort((a, b) => Number(isControl(b)) - Number(isControl(a)))
  let matchedElements = 0
  for (const element of candidates) {
    if (element.closest('script,style,noscript,template')) continue
    const rect = observationRect(element.getBoundingClientRect(), element)
    if (!rect) continue
    const tag = element.localName
    const role = element.getAttribute('role') ?? ''
    const text = normalizedText((textByOwner.get(element) ?? []).join(''))
    const label = (element.getAttribute('aria-label') ?? element.getAttribute('title')
      ?? element.getAttribute('placeholder') ?? text).trim()
    const meaningful = label || isEditingHost(element) || element.hasAttribute('onclick') || element.hasAttribute('tabindex')
      || ['button', 'a', 'input', 'textarea', 'select', 'summary', 'img', 'video', 'audio'].includes(tag)
    if (!meaningful) continue
    matchedElements += 1
    elements.push({ path: pathOf(element), fingerprint: fingerprint(element), tag, role, label,
      text, editable: editable(element),
      ...(editable(element) ? { value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value : text } : {}),
      rect: { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top } })
  }
  const diagnostics: string[] = []
  if (document.readyState !== 'complete') diagnostics.push(`页面仍在加载：${document.readyState}`)
  for (const image of Array.from(document.images).slice(0, 24)) {
    if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) diagnostics.push(`图片加载失败：${image.getAttribute('src')!.slice(0, 180)}`)
  }
  const layoutRoots: ParentNode[] = [document]
  for (let index = 0; index < layoutRoots.length; index++) for (const element of layoutRoots[index]!.querySelectorAll('*'))
    if (element.shadowRoot) layoutRoots.push(element.shadowRoot)
  const observedStages = layoutRoots.flatMap(root => Array.from(root.querySelectorAll('[data-gl-runtime-layout]')))
  for (const stage of observedStages.slice(0, 12)) {
    try {
      const fact = JSON.parse(stage.getAttribute('data-gl-runtime-layout') ?? '{}')
      if (!fact.viewport || !Array.isArray(fact.issues)) continue
      diagnostics.push(`局部布局 ${String(fact.target).slice(0, 120)}：${JSON.stringify({ viewport: fact.viewport,
        contentBox: fact.contentBox, status: fact.status, variant: fact.variant, tried: fact.tried, issues: fact.issues.slice(0, 8),
        needsContentDecision: fact.needsContentDecision }).slice(0, 1800)}`)
    } catch { /* Derived observations do not affect authored content or action facts. */ }
  }
  return { url: location.href, title: document.title.slice(0, 240), readyState: document.readyState,
    pageIndex: courseScenes.length ? Math.max(0, courseIndex) : visibleIndex < 0 ? 0 : visibleIndex,
    pageCount: courseScenes.length || pages.length || 1,
    structure: segments.map(segment => normalizedText(segment.text)).filter(Boolean),
    diagnostics: diagnostics.slice(0, 32), elements, matchedElements, viewport: { width: innerWidth, height: innerHeight } }
}

export function htmlActionScript(input: HtmlPageOperation): string {
  return `(${htmlActionPageOperation.toString()})(${JSON.stringify(input)})`
}
