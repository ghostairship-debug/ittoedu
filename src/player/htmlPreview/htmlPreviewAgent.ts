import { indexHtmlElements } from '../../shared/html/htmlSourceScanner'
import { mountPagination, type HtmlPreviewPagination } from './htmlPreviewPagination'
import { mountPlaceholders } from './htmlPreviewPlaceholders'
import { htmlPreviewTargetReportSchema } from '../../shared/workbench/htmlPreview'
import type { z } from 'zod'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>

type Init = { type: 'html-preview.init'; leaseId: string; loadId: string }
type Patch = { type: 'html-preview.patch'; loadId: string; handle: string; kind: 'text' | 'image'; value: string; expected: string }
type Navigate = { type: 'html-preview.navigate'; loadId: string; index: number }
type Restore = { type: 'html-preview.restore'; loadId: string; index: number; scroll: number }
type EditMode = { type: 'html-preview.edit-mode'; loadId: string; enabled: boolean }
type Command = Init | Patch | Navigate | Restore | EditMode

interface RuntimeNodeTracking {
  isRuntimeNode(node: Node): boolean
  withoutTracking(work: () => void): void
  destroy(): void
}

/** Install before author scripts: parser nodes use native DOM internals, JS mutations cross these API methods. */
function trackScriptMutations(doc: Document): RuntimeNodeTracking {
  const win = doc.defaultView as (Window & typeof globalThis) | null
  const marked = new WeakSet<Node>()
  const restores: Array<() => void> = []
  let suppressed = false
  let documentWritten = false
  const mark = (node: unknown) => {
    if (suppressed || !(node instanceof Node)) return
    marked.add(node)
    if (node instanceof DocumentFragment) for (const child of node.childNodes) marked.add(child)
  }
  const method = (owner: object, name: string, before: (self: unknown, args: unknown[]) => void,
    after?: (result: unknown) => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) return
    Object.defineProperty(owner, name, { ...descriptor, value: function (this: unknown, ...args: unknown[]) {
      before(this, args)
      const result = descriptor.value.apply(this, args) as unknown
      after?.(result)
      return result
    } })
    restores.push(() => Object.defineProperty(owner, name, descriptor))
  }
  const setter = (owner: object, name: string, target: (self: unknown) => unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    if (!descriptor?.set || !descriptor.configurable) return
    Object.defineProperty(owner, name, { ...descriptor, set: function (this: unknown, value: unknown) {
      mark(target(this))
      descriptor.set!.call(this, value)
    } })
    restores.push(() => Object.defineProperty(owner, name, descriptor))
  }
  if (win) {
    method(win.Document.prototype, 'createElement', () => {}, mark)
    method(win.Document.prototype, 'createElementNS', () => {}, mark)
    method(win.Document.prototype, 'createTextNode', () => {}, mark)
    method(win.Node.prototype, 'appendChild', (_self, args) => mark(args[0]))
    method(win.Node.prototype, 'insertBefore', (_self, args) => mark(args[0]))
    method(win.Node.prototype, 'replaceChild', (_self, args) => mark(args[0]))
    for (const name of ['append', 'prepend', 'before', 'after', 'replaceWith']) {
      method(win.Element.prototype, name, (_self, args) => { for (const item of args) mark(item) })
    }
    method(win.Element.prototype, 'replaceChildren', self => mark(self))
    method(win.Element.prototype, 'insertAdjacentHTML', (self, args) => {
      const position = String(args[0]).toLowerCase()
      mark(position === 'beforebegin' || position === 'afterend' ? (self as Element).parentNode : self)
    })
    method(win.Element.prototype, 'setAttribute', (self, args) => {
      if (self instanceof win.HTMLImageElement && ['src', 'srcset', 'sizes'].includes(String(args[0]).toLowerCase())) mark(self)
    })
    for (const name of ['appendData', 'deleteData', 'insertData', 'replaceData']) {
      method(win.CharacterData.prototype, name, self => mark(self))
    }
    setter(win.Node.prototype, 'textContent', self => self)
    setter(win.Node.prototype, 'nodeValue', self => self)
    setter(win.CharacterData.prototype, 'data', self => self)
    setter(win.Element.prototype, 'innerHTML', self => self)
    setter(win.Element.prototype, 'outerHTML', self => (self as Element).parentNode)
    setter(win.HTMLElement.prototype, 'innerText', self => self)
    setter(win.HTMLImageElement.prototype, 'src', self => self)
    method(win.Document.prototype, 'write', () => { documentWritten = true })
    method(win.Document.prototype, 'writeln', () => { documentWritten = true })
  }
  return {
    isRuntimeNode(node) {
      if (documentWritten) return true
      for (let current: Node | null = node; current; current = current.parentNode) if (marked.has(current)) return true
      return false
    },
    withoutTracking(work) { suppressed = true; try { work() } finally { suppressed = false } },
    destroy() { for (const restore of restores.reverse()) restore() },
  }
}

function pathFor(element: Element): HtmlPreviewTargetReport['domPath'] {
  const path: HtmlPreviewTargetReport['domPath'] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    const parent = current.parentElement
    const index = parent ? Array.prototype.indexOf.call(parent.children, current) as number
      : Array.prototype.indexOf.call(current.ownerDocument.children, current) as number
    path.unshift({ name: current.localName, index })
  }
  return path
}

function sectionOrder(element: Element): number | null {
  for (let section: Element | null = element; section; section = section.parentElement) {
    if (section.localName !== 'section') continue
    const parent = section.parentElement
    if (!parent || (parent !== element.ownerDocument.body && !(parent.localName === 'main' && parent.parentElement === element.ownerDocument.body))) continue
    return Array.from(parent.children).filter(child => child.localName === 'section').indexOf(section)
  }
  return null
}

function rectOf(node: Node): HtmlPreviewTargetReport['rect'] {
  const rect = node instanceof Element ? node.getBoundingClientRect() : (() => {
    const range = node.ownerDocument!.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    range.detach()
    return rect
  })()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function editableText(node: Text): boolean {
  const parent = node.parentElement
  return Boolean(parent && node.data.trim() && !parent.closest('script,style,noscript,template,textarea,title,option,[contenteditable]'))
}

function textAtPoint(doc: Document, x: number, y: number): Text | null {
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position?.offsetNode.nodeType === Node.TEXT_NODE) return position.offsetNode as Text
  const range = (doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y)
  if (range?.startContainer.nodeType === Node.TEXT_NODE) return range.startContainer as Text
  return null
}

/** Runs inside the sandboxed HTML document. It reports observations only and never writes project files. */
export function mountHtmlPreviewAgent(doc: Document, inheritedTracking?: RuntimeNodeTracking): () => void {
  const win = doc.defaultView
  if (!win || !doc.body) return () => {}
  const tracking = inheritedTracking ?? trackScriptMutations(doc)
  const handles = new WeakMap<Node, string>()
  const nodes = new Map<string, Node>()
  const imageOriginals = new WeakMap<HTMLImageElement, {
    src: string | null; srcset: string | null; sizes: string | null;
    sources: Array<{ node: Element; srcset: string | null; sizes: string | null }>
  }>()
  const imageObservations = new WeakMap<HTMLImageElement, NonNullable<ReturnType<typeof imageOriginals.get>>>()
  let nextHandle = 0
  let leaseId: string | null = null
  let loadId: string | null = null
  let seq = 0
  let disposed = false
  let editMode = false
  const indexed = indexHtmlElements(doc.documentElement.outerHTML)
  const placeholders = mountPlaceholders(doc.body)
  const send = (message: Record<string, unknown>) => {
    if (!leaseId || !loadId || disposed) return
    win.parent.postMessage({ ...message, protocol: 1, leaseId, loadId, ...(message.event === 'ready' ? {} : { seq: ++seq }) }, '*')
  }
  const pagination: HtmlPreviewPagination = mountPagination(doc, indexed.sections, view => {
    send({ event: 'page', pageIndex: view.pageIndex, perPageScroll: view.perPageScroll })
  })
  const handleOf = (node: Node): string => {
    let handle = handles.get(node)
    if (!handle) { handle = `html-target-${++nextHandle}`; handles.set(node, handle); nodes.set(handle, node) }
    return handle
  }
  const report = (node: Text | HTMLImageElement): HtmlPreviewTargetReport | null => {
    const element = node instanceof HTMLImageElement ? node : node.parentElement
    if (!element || !element.isConnected) return null
    const rect = rectOf(node)
    if (!rect.width || !rect.height) return null
    if (node instanceof HTMLImageElement) imageObservations.set(node, {
      src: node.getAttribute('src'), srcset: node.getAttribute('srcset'), sizes: node.getAttribute('sizes'),
      sources: Array.from(node.parentElement?.localName === 'picture' ? node.parentElement.querySelectorAll('source') : [])
        .map(source => ({ node: source, srcset: source.getAttribute('srcset'), sizes: source.getAttribute('sizes') })),
    })
    return { handle: handleOf(node), kind: node instanceof HTMLImageElement ? 'image' : 'text',
      domPath: pathFor(element), sectionOrder: sectionOrder(element),
      rawText: node instanceof HTMLImageElement ? node.getAttribute('src') ?? '' : node.data,
      attributeName: node instanceof HTMLImageElement ? 'src' : null,
      rect, scriptCreated: tracking.isRuntimeNode(node) }
  }
  const onClick = (event: MouseEvent) => {
    if (!loadId || !editMode || event.button !== 0) return
    const target = event.target
    const image = target instanceof HTMLImageElement ? target : null
    const targetReport = image && report(image)
    if (targetReport) send({ event: 'targets', targets: [targetReport] })
    if (targetReport) { event.preventDefault(); event.stopPropagation() }
  }
  const onDoubleClick = (event: MouseEvent) => {
    if (!loadId || !editMode || event.button !== 0 || event.target instanceof HTMLImageElement) return
    const text = textAtPoint(doc, event.clientX, event.clientY)
    const targetReport = text && editableText(text) ? report(text) : null
    if (targetReport) { send({ event: 'targets', targets: [targetReport] }); event.preventDefault(); event.stopPropagation() }
  }
  const onMessage = (event: MessageEvent<Command>) => {
    if (event.source !== win.parent || !event.data || typeof event.data !== 'object') return
    const message = event.data
    if (message.type === 'html-preview.init') {
      if (!message.leaseId || !message.loadId || leaseId) return
      leaseId = message.leaseId
      loadId = message.loadId
      send({ event: 'ready', sectionCount: indexed.sections.length, sectionsAmbiguous: indexed.sectionsAmbiguous })
      return
    }
    if (!loadId || message.loadId !== loadId) return
    if (message.type === 'html-preview.edit-mode' && typeof message.enabled === 'boolean') editMode = message.enabled
    if (message.type === 'html-preview.navigate' && Number.isSafeInteger(message.index)) pagination.navigate(message.index)
    if (message.type === 'html-preview.restore' && Number.isSafeInteger(message.index) && Number.isFinite(message.scroll)) {
      pagination.restore({ pageIndex: message.index, perPageScroll: Math.max(0, message.scroll) })
    }
    if (message.type === 'html-preview.patch' && typeof message.value === 'string') {
      const node = nodes.get(message.handle)
      const current = node?.nodeType === Node.TEXT_NODE ? (node as Text).data
        : node instanceof HTMLImageElement ? node.getAttribute('src') ?? '' : null
      if (!node?.isConnected || current === null || current !== message.expected) {
        win.parent.postMessage({ event: 'html-preview.patch-result', protocol: 1, leaseId, loadId,
          handle: message.handle, ok: false }, '*')
        return
      }
      if (message.kind === 'image' && node instanceof HTMLImageElement) {
        const original = imageOriginals.get(node)
        const observed = imageObservations.get(node)
        if (!original && (!observed || node.getAttribute('srcset') !== observed.srcset || node.getAttribute('sizes') !== observed.sizes
          || observed.sources.some(source => !source.node.isConnected
            || source.node.getAttribute('srcset') !== source.srcset || source.node.getAttribute('sizes') !== source.sizes))) {
          win.parent.postMessage({ event: 'html-preview.patch-result', protocol: 1, leaseId, loadId,
            handle: message.handle, ok: false }, '*')
          return
        }
        if (original) {
          const expectOriginal = message.expected === (original.src ?? '')
          const matches = (actual: string | null, baseline: string | null) => actual === (expectOriginal ? baseline : null)
          if (!matches(node.getAttribute('srcset'), original.srcset) || !matches(node.getAttribute('sizes'), original.sizes)
            || original.sources.some(source => !source.node.isConnected
              || !matches(source.node.getAttribute('srcset'), source.srcset)
              || !matches(source.node.getAttribute('sizes'), source.sizes))) {
            win.parent.postMessage({ event: 'html-preview.patch-result', protocol: 1, leaseId, loadId,
              handle: message.handle, ok: false }, '*')
            return
          }
        }
      }
      tracking.withoutTracking(() => {
      if (message.kind === 'text' && node.nodeType === Node.TEXT_NODE) (node as Text).data = message.value
      if (message.kind === 'image' && node instanceof HTMLImageElement) {
        let original = imageOriginals.get(node)
        if (!original) {
          original = imageObservations.get(node)!
          imageOriginals.set(node, original)
        }
        const restore = message.value === original.src || (original.src === null && message.value === '')
        const setAttribute = (target: Element, name: string, value: string | null) => {
          if (value === null) target.removeAttribute(name)
          else target.setAttribute(name, value)
        }
        setAttribute(node, 'srcset', restore ? original.srcset : null)
        setAttribute(node, 'sizes', restore ? original.sizes : null)
        for (const source of original.sources) {
          if (!source.node.isConnected) continue
          setAttribute(source.node, 'srcset', restore ? source.srcset : null)
          setAttribute(source.node, 'sizes', restore ? source.sizes : null)
        }
        if (restore && original.src === null) node.removeAttribute('src')
        else node.setAttribute('src', message.value)
      }
      })
      placeholders.refresh()
    }
  }
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('dblclick', onDoubleClick, true)
  win.addEventListener('message', onMessage)
  win.parent.postMessage({ event: 'html-preview.hello', protocol: 1 }, '*')
  return () => {
    disposed = true
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('dblclick', onDoubleClick, true)
    win.removeEventListener('message', onMessage)
    pagination.destroy()
    placeholders.destroy()
    nodes.clear()
    tracking.destroy()
  }
}

if (typeof document !== 'undefined' && document.currentScript) {
  const tracking = trackScriptMutations(document)
  const mount = () => { mountHtmlPreviewAgent(document, tracking) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}
