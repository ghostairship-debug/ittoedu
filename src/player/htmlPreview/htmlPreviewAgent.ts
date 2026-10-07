import { indexHtmlElements } from '../../shared/html/htmlSourceScanner'
import { mountPagination, type HtmlPreviewPagination } from './htmlPreviewPagination'
import { mountPlaceholders } from './htmlPreviewPlaceholders'
import { HTML_PREVIEW_TARGET_MAX, htmlPreviewTargetReportSchema } from '../../shared/workbench/htmlPreview'
import type { z } from 'zod'
import { createDomAuthoring } from '../../components/web/authoringDom'
import type { ComponentAuthorRecord } from '../../shared/contracts/component-platform/runtime'
import { componentAuthorRecordsSchema } from '../../shared/contracts/component-platform/schema'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>

type Init = { type: 'html-preview.init'; leaseId: string; loadId: string }
type Patch = { type: 'html-preview.patch'; loadId: string; handle: string; kind: 'text' | 'image'; value: string; expected: string }
type Navigate = { type: 'html-preview.navigate'; loadId: string; index: number }
type Restore = { type: 'html-preview.restore'; loadId: string; index: number; scroll: number }
type EditMode = { type: 'html-preview.edit-mode'; loadId: string; requestId: string; enabled: boolean }
type Visibility = { type: 'html-preview.visibility'; loadId: string; active: boolean }
type ConfirmTargets = { type: 'html-preview.confirm-targets'; loadId: string; scanId: string; handles: string[] }
type RefreshTargets = { type: 'html-preview.refresh-targets'; loadId: string }
type Selection = { type: 'html-preview.selection'; loadId: string; handle: string | null; editable: boolean }
type AuthoringRecords = { type: 'html-preview.authoring-records'; loadId: string; records: Record<string, ComponentAuthorRecord> }
type Command = Init | Patch | Navigate | Restore | EditMode | Visibility | ConfirmTargets | RefreshTargets | Selection | AuthoringRecords

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
  const authorWindow = win as Window & { __cwHtmlAuthoringRecords?: Record<string, ComponentAuthorRecord>;
    __cwHtmlAuthoringConsumer?: ReturnType<typeof createDomAuthoring> }
  if (!authorWindow.__cwHtmlAuthoringRecords) {
    try {
      const value = JSON.parse(doc.getElementById('cw-html-authoring-records')?.textContent ?? '{}')
      const parsed = componentAuthorRecordsSchema.safeParse(value)
      authorWindow.__cwHtmlAuthoringRecords = parsed.success ? parsed.data : {}
    } catch { authorWindow.__cwHtmlAuthoringRecords = {} }
  }
  const inheritedConsumer = authorWindow.__cwHtmlAuthoringConsumer
  const authoring = inheritedConsumer ?? createDomAuthoring(doc.body, { records: () => authorWindow.__cwHtmlAuthoringRecords ?? {} })
  authorWindow.__cwHtmlAuthoringConsumer = authoring
  const handles = new WeakMap<Node, string>()
  const nodes = new Map<string, Node>()
  const imageOriginals = new WeakMap<HTMLImageElement, {
    src: string | null; srcset: string | null; sizes: string | null;
    sources: Array<{ node: Element; srcset: string | null; sizes: string | null; type: string | null }>
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
        .map(source => ({ node: source, srcset: source.getAttribute('srcset'), sizes: source.getAttribute('sizes'), type: source.getAttribute('type') })),
    })
    const observation = authoring.describe(node)
    const geometry = authoring.geometry(node)
    return { handle: handleOf(node), kind: node instanceof HTMLImageElement ? 'image' : 'text',
      domPath: pathFor(element), sectionOrder: sectionOrder(element),
      rawText: node instanceof HTMLImageElement ? node.getAttribute('src') ?? '' : node.data,
      attributeName: node instanceof HTMLImageElement ? 'src' : null,
      rect, scriptCreated: tracking.isRuntimeNode(node), ...(geometry ? { geometry } : {}),
      ...(observation ? { bindingStatus: observation.bindingStatus, authoring: { authorKey: observation.authorKey, record: observation.record } } : {}) }
  }
  let visible = true
  let scanSerial = 0
  let scanId = ''
  let discoveryFrame = 0
  let hovered: string | null = null
  let selected: string | null = null
  const candidates = new Set<string>()
  const confirmed = new Set<string>()
  let markers: HTMLDivElement | null = null
  let markerContent: ShadowRoot | null = null
  const drawMarkers = () => tracking.withoutTracking(() => {
    if (!editMode || !visible) { markers?.remove(); return }
    if (!markers) {
      markers = doc.createElement('div')
      markers.dataset.htmlPreviewEditMarkers = ''
      markers.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;'
      markerContent = markers.attachShadow({ mode: 'open' })
    }
    // Keep page CSS and transformed body layouts out of the viewport marker layer.
    if (!markers.isConnected) doc.documentElement.appendChild(markers)
    markerContent!.replaceChildren()
    for (const handle of new Set([...confirmed, ...(selected ? [selected] : [])])) {
      const node = nodes.get(handle)
      if (!node?.isConnected) continue
      const rect = rectOf(node)
      if (!rect.width || !rect.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0
        || rect.x >= win.innerWidth || rect.y >= win.innerHeight) continue
      const editable = confirmed.has(handle)
      if (!editable && handle !== selected) continue
      const active = handle === selected || handle === hovered
      const mark = doc.createElement('div')
      mark.dataset.htmlPreviewEditTarget = handle
      mark.dataset.state = handle === selected ? 'selected' : handle === hovered ? 'hovered' : 'editable'
      mark.dataset.editable = String(editable)
      mark.style.cssText = `position:fixed;box-sizing:border-box;pointer-events:none;left:${rect.x - 2}px;top:${rect.y - 2}px;width:${rect.width + 4}px;height:${rect.height + 4}px;border:${active ? 2 : 1}px ${editable && !active ? 'dashed' : 'solid'} ${editable ? '#2563eb' : '#b45309'};background:${active ? editable ? 'rgba(37,99,235,.08)' : 'rgba(180,83,9,.08)' : 'transparent'};`
      markerContent!.appendChild(mark)
    }
  })
  const discoverTargets = () => {
    discoveryFrame = 0
    if (!editMode || !visible || disposed) return
    authoring.refresh()
    scanId = `edit-scan-${++scanSerial}`
    candidates.clear()
    const reports: HtmlPreviewTargetReport[] = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === markers || markers?.contains(node)) continue
      if (!(node instanceof HTMLImageElement) && !(node.nodeType === Node.TEXT_NODE && editableText(node as Text))) continue
      const observation = report(node as Text | HTMLImageElement)
      if (!observation || observation.rect.x + observation.rect.width <= 0 || observation.rect.y + observation.rect.height <= 0
        || observation.rect.x >= win.innerWidth || observation.rect.y >= win.innerHeight) continue
      candidates.add(observation.handle)
      if (!confirmed.has(observation.handle)) reports.push(observation)
    }
    drawMarkers()
    for (let start = 0; start < reports.length; start += HTML_PREVIEW_TARGET_MAX) {
      send({ event: 'edit-targets', scanId, targets: reports.slice(start, start + HTML_PREVIEW_TARGET_MAX) })
    }
  }
  const scheduleDiscovery = (invalidate = true) => {
    if (!editMode || !visible) return
    if (invalidate) { confirmed.clear(); scanId = ''; drawMarkers() }
    if (discoveryFrame) return
    discoveryFrame = win.requestAnimationFrame(discoverTargets)
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== markers && !markers?.contains(record.target)
      && !(record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node === markers)))) scheduleDiscovery()
  })
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true })
  const onViewportChange = () => { drawMarkers(); scheduleDiscovery(false) }
  win.addEventListener('scroll', onViewportChange, true)
  win.addEventListener('resize', onViewportChange)
  const pausedMedia = new Set<HTMLMediaElement>(), pausedAnimations = new Set<Animation>()
  const pauseControlledActivity = () => {
    for (const media of doc.querySelectorAll<HTMLMediaElement>('video,audio')) if (!media.paused) { pausedMedia.add(media); media.pause() }
    for (const animation of doc.getAnimations?.() ?? []) if (animation.playState === 'running') { pausedAnimations.add(animation); animation.pause() }
  }
  const setVisible = (value: boolean) => {
    if (visible === value) return
    visible = value
    if (!visible) { hovered = null; drawMarkers() }
    else scheduleDiscovery()
    if (!visible) pauseControlledActivity()
    else {
      for (const media of pausedMedia) if (media.isConnected) void media.play().catch(() => undefined)
      for (const animation of pausedAnimations) if (animation.playState === 'paused') animation.play()
      pausedMedia.clear(); pausedAnimations.clear()
    }
  }
  const onActivity = () => { if (!visible) pauseControlledActivity() }
  doc.addEventListener('play', onActivity, true)
  doc.addEventListener('animationstart', onActivity, true)
  doc.addEventListener('transitionrun', onActivity, true)
  const textReportAt = (event: MouseEvent) => {
    const text = textAtPoint(doc, event.clientX, event.clientY)
    return text && editableText(text) && event.target instanceof Node && event.target.contains(text) ? report(text) : null
  }
  const onClick = (event: MouseEvent) => {
    if (!visible || !loadId || !editMode || event.button !== 0) return
    authoring.refresh()
    const target = event.target
    const image = target instanceof HTMLImageElement ? target : null
    const targetReport = image ? report(image) : textReportAt(event)
    if (targetReport) {
      selected = targetReport.handle; drawMarkers()
      send({ event: 'targets', targets: [targetReport] })
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }
  const onDoubleClick = (event: MouseEvent) => {
    if (!visible || !loadId || !editMode || event.button !== 0 || event.target instanceof HTMLImageElement) return
    const targetReport = textReportAt(event)
    if (targetReport) {
      if (selected !== targetReport.handle) { selected = targetReport.handle; drawMarkers(); send({ event: 'targets', targets: [targetReport] }) }
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }
  const onPointerMove = (event: MouseEvent) => {
    if (!editMode || !visible) return
    const target = event.target instanceof HTMLImageElement ? event.target : textAtPoint(doc, event.clientX, event.clientY)
    const handle = target && event.target instanceof Node && event.target.contains(target) ? handles.get(target) ?? null : null
    const next = handle && confirmed.has(handle) ? handle : null
    if (hovered !== next) { hovered = next; drawMarkers() }
  }
  const onPointerLeave = () => { if (hovered) { hovered = null; drawMarkers() } }
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
    if (message.type === 'html-preview.authoring-records') {
      const parsed = componentAuthorRecordsSchema.safeParse(message.records)
      if (!parsed.success) return
      authorWindow.__cwHtmlAuthoringRecords = parsed.data
      tracking.withoutTracking(() => authoring.refresh())
      scheduleDiscovery()
      return
    }
    if (message.type === 'html-preview.visibility' && typeof message.active === 'boolean') { setVisible(message.active); return }
    if (message.type === 'html-preview.edit-mode' && typeof message.enabled === 'boolean'
      && typeof message.requestId === 'string' && message.requestId.length > 0 && message.requestId.length <= 256) {
      editMode = message.enabled
      selected = null; hovered = null; confirmed.clear()
      if (editMode) discoverTargets()
      else { scanId = ''; if (discoveryFrame) win.cancelAnimationFrame(discoveryFrame); discoveryFrame = 0; drawMarkers() }
      send({ event: 'edit-mode-ready', requestId: message.requestId, enabled: editMode })
    }
    if (message.type === 'html-preview.refresh-targets') scheduleDiscovery()
    if (message.type === 'html-preview.confirm-targets' && editMode && message.scanId === scanId && Array.isArray(message.handles)) {
      for (const handle of message.handles) if (candidates.has(handle)) confirmed.add(handle)
      drawMarkers()
    }
    if (message.type === 'html-preview.selection' && editMode) {
      selected = typeof message.handle === 'string' && nodes.has(message.handle) ? message.handle : null
      if (selected && !message.editable) confirmed.delete(selected)
      else if (selected) confirmed.add(selected)
      drawMarkers()
    }
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
            || source.node.getAttribute('srcset') !== source.srcset || source.node.getAttribute('sizes') !== source.sizes || source.node.getAttribute('type') !== source.type))) {
          win.parent.postMessage({ event: 'html-preview.patch-result', protocol: 1, leaseId, loadId,
            handle: message.handle, ok: false }, '*')
          return
        }
        if (original) {
          const expectOriginal = message.expected === (original.src ?? '')
          const expectedSrcset = (baseline: string | null) => baseline === null || expectOriginal ? baseline : replaceSrcsetUrls(baseline, message.expected)
          const expectedType = (baseline: string | null) => expectOriginal || baseline?.toLowerCase() === imageMimeFromUrl(message.expected) ? baseline : null
          if (node.getAttribute('srcset') !== expectedSrcset(original.srcset) || node.getAttribute('sizes') !== original.sizes
            || original.sources.some(source => !source.node.isConnected
              || source.node.getAttribute('srcset') !== expectedSrcset(source.srcset)
              || source.node.getAttribute('sizes') !== source.sizes || source.node.getAttribute('type') !== expectedType(source.type))) {
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
        {
          setAttribute(node, 'srcset', original.srcset === null || restore ? original.srcset : replaceSrcsetUrls(original.srcset, message.value))
          setAttribute(node, 'sizes', original.sizes)
          for (const source of original.sources) {
            if (!source.node.isConnected) continue
            setAttribute(source.node, 'srcset', source.srcset === null || restore ? source.srcset : replaceSrcsetUrls(source.srcset, message.value))
            setAttribute(source.node, 'sizes', source.sizes)
            setAttribute(source.node, 'type', restore || source.type?.toLowerCase() === imageMimeFromUrl(message.value) ? source.type : null)
          }
        }
        if (restore && original.src === null) node.removeAttribute('src')
        else node.setAttribute('src', message.value)
      }
      })
      placeholders.refresh()
    }
  }
  win.addEventListener('click', onClick, true)
  win.addEventListener('dblclick', onDoubleClick, true)
  win.addEventListener('mousemove', onPointerMove, true)
  doc.documentElement.addEventListener('mouseleave', onPointerLeave)
  win.addEventListener('message', onMessage)
  win.parent.postMessage({ event: 'html-preview.hello', protocol: 1 }, '*')
  return () => {
    disposed = true
    doc.removeEventListener('play', onActivity, true)
    doc.removeEventListener('animationstart', onActivity, true)
    doc.removeEventListener('transitionrun', onActivity, true)
    pausedMedia.clear(); pausedAnimations.clear()
    win.removeEventListener('click', onClick, true)
    win.removeEventListener('dblclick', onDoubleClick, true)
    win.removeEventListener('mousemove', onPointerMove, true)
    doc.documentElement.removeEventListener('mouseleave', onPointerLeave)
    win.removeEventListener('scroll', onViewportChange, true)
    win.removeEventListener('resize', onViewportChange)
    observer.disconnect()
    if (discoveryFrame) win.cancelAnimationFrame(discoveryFrame)
    tracking.withoutTracking(() => markers?.remove())
    win.removeEventListener('message', onMessage)
    pagination.destroy()
    placeholders.destroy()
    nodes.clear()
    if (!inheritedConsumer) {
      authoring.dispose()
      if (authorWindow.__cwHtmlAuthoringConsumer === authoring) delete authorWindow.__cwHtmlAuthoringConsumer
    }
    tracking.destroy()
  }
}

if (typeof document !== 'undefined' && document.currentScript) {
  const tracking = trackScriptMutations(document)
  const mount = () => { mountHtmlPreviewAgent(document, tracking) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}
import { replaceSrcsetUrls, imageMimeFromUrl } from '../../shared/html/responsiveImage'
