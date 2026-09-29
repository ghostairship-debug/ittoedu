/** Code in this file executes only in the sandboxed HTML preview frame. Its
 * return values are observations, never authority to read or write host files. */

export interface HtmlPageElement {
  path: number[]
  fingerprint: string
  tag: string
  role: string
  label: string
  text: string
  editable: boolean
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
}

export type HtmlPageOperation =
  | { type: 'observe' }
  | { type: 'click'; path: number[]; fingerprint: string }
  | { type: 'input'; path: number[]; fingerprint: string; value: string }

export type HtmlPageActionResult = { applied: boolean; reason?: string }

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
  if (input.type !== 'observe') {
    const element = resolve(input.path)
    if (!element?.isConnected || fingerprint(element) !== input.fingerprint)
      return { applied: false, reason: 'stale-element' }
    if (input.type === 'click') {
      if (!(element instanceof HTMLElement)) return { applied: false, reason: 'not-clickable' }
      element.click()
      return { applied: true }
    }
    if (input.value.length > 8192 || !editable(element)) return { applied: false, reason: 'not-editable' }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const owner = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(owner, 'value')?.set
      if (!setter) return { applied: false, reason: 'not-editable' }
      setter.call(element, input.value)
    } else if (element instanceof HTMLSelectElement) {
      if (!Array.from(element.options).some(option => option.value === input.value))
        return { applied: false, reason: 'invalid-option' }
      element.value = input.value
    } else element.textContent = input.value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return { applied: true }
  }
  const pageRoot = document.body?.querySelector(':scope > main') ?? document.body
  const pages = pageRoot ? Array.from(pageRoot.children).filter(child => child.localName === 'section') : []
  const visibleIndex = pages.findIndex(element => getComputedStyle(element).display !== 'none')
  const elements: HtmlPageElement[] = []
  const candidates = document.body ? Array.from(document.body.querySelectorAll('*')) : []
  const isControl = (element: Element) => ['button', 'a', 'input', 'textarea', 'select', 'summary', 'label'].includes(element.localName)
    || element.hasAttribute('onclick') || element.hasAttribute('tabindex') || element.hasAttribute('role')
  candidates.sort((a, b) => Number(isControl(b)) - Number(isControl(a)))
  for (const element of candidates) {
    if (elements.length >= 120) break
    if (element.closest('script,style,noscript,template')) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility === 'hidden') continue
    const tag = element.localName
    const role = element.getAttribute('role') ?? ''
    const label = labelOf(element)
    const meaningful = label || element.hasAttribute('onclick') || element.hasAttribute('tabindex')
      || ['button', 'a', 'input', 'textarea', 'select', 'summary', 'img', 'video', 'audio'].includes(tag)
    if (!meaningful) continue
    elements.push({ path: pathOf(element), fingerprint: fingerprint(element), tag, role, label,
      text: (element.textContent ?? '').trim().slice(0, 240), editable: editable(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
  }
  const diagnostics: string[] = []
  if (document.readyState !== 'complete') diagnostics.push(`页面仍在加载：${document.readyState}`)
  for (const image of Array.from(document.images).slice(0, 24)) {
    if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) diagnostics.push(`图片加载失败：${image.getAttribute('src')!.slice(0, 180)}`)
  }
  return { url: location.href, title: document.title.slice(0, 240), readyState: document.readyState,
    pageIndex: visibleIndex < 0 ? 0 : visibleIndex, pageCount: pages.length || 1,
    structure: [document.body?.innerText?.slice(0, 4000) ?? document.body?.textContent?.slice(0, 4000) ?? ''],
    diagnostics: diagnostics.slice(0, 32), elements }
}

export function htmlActionScript(input: HtmlPageOperation): string {
  return `(${htmlActionPageOperation.toString()})(${JSON.stringify(input)})`
}
