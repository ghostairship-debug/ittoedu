import { indexHtmlElements } from '../../shared/html/htmlSourceScanner'
import { mountPagination, type HtmlPreviewPagination } from './htmlPreviewPagination'
import { mountPlaceholders } from './htmlPreviewPlaceholders'
import { HTML_PREVIEW_TARGET_MAX, htmlPreviewTargetReportSchema } from '../../shared/workbench/htmlPreview'
import type { z } from 'zod'
import { createDomAuthoring } from '../../components/web/authoringDom'
import { createNestedDomAuthoring } from '../../components/web/nestedAuthoringDom'
import { installHtmlFrameAuthoring } from '../../shared/html/htmlFrameAuthoring'
import type { ComponentAuthorRecord, ComponentAuthorGeometry } from '../../shared/contracts/component-platform/runtime'
import { componentAuthorRecordsSchema } from '../../shared/contracts/component-platform/schema'
import { installAuthoringInputArbitration, authoringCaretOffset } from '../../components/web/ownedDocumentAuthoring'
import { createAuthoringFrameGeometry } from '../../components/web/authoringFrame'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>

type Init = { type: 'html-preview.init'; leaseId: string; loadId: string }
type Patch = { type: 'html-preview.patch'; loadId: string; handle: string; kind: 'text' | 'image'; value: string; expected: string; authoringAnchor?: string; authoringRecords?: Record<string, ComponentAuthorRecord> }
type Navigate = { type: 'html-preview.navigate'; loadId: string; index: number }
type Restore = { type: 'html-preview.restore'; loadId: string; index: number; scroll: number }
type EditMode = { type: 'html-preview.edit-mode'; loadId: string; requestId: string; enabled: boolean }
type Visibility = { type: 'html-preview.visibility'; loadId: string; active: boolean }
type ConfirmTargets = { type: 'html-preview.confirm-targets'; loadId: string; scanId: string; handles: string[] }
type RefreshTargets = { type: 'html-preview.refresh-targets'; loadId: string }
type Selection = { type: 'html-preview.selection'; loadId: string; handle: string | null; editable: boolean; editing?: boolean }
type AuthoringRecords = { type: 'html-preview.authoring-records'; loadId: string; records: Record<string, ComponentAuthorRecord> }
type AuthoringPreview = { type: 'html-preview.authoring-preview'; loadId: string; authorKey: string; geometry: ComponentAuthorGeometry | null }
type CardTargets = { type: 'html-preview.card-targets'; loadId: string; authorKeys: string[] }
type SelectAuthor = { type: 'html-preview.select-author'; loadId: string; authorKey: string }
type SelectSource = { type: 'html-preview.select-source'; loadId: string; domPath: HtmlPreviewTargetReport['domPath']; kind: 'text' | 'image' | null; expectedText?: string }
type Command = Init | Patch | Navigate | Restore | EditMode | Visibility | ConfirmTargets | RefreshTargets | Selection | AuthoringRecords | AuthoringPreview | CardTargets | SelectAuthor | SelectSource

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

const isImage = (node: unknown): node is HTMLImageElement => Boolean(node && typeof node === 'object'
  && (node as Node).nodeType === 1 && (node as Element).localName === 'img')
const isText = (node: unknown): node is Text => Boolean(node && typeof node === 'object' && (node as Node).nodeType === 3)
const isNode = (node: unknown): node is Node => Boolean(node && typeof node === 'object' && 'nodeType' in node)

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
type PreviewInputOwner = { options: Parameters<typeof installAuthoringInputArbitration>[1]; release(): void }

export function mountHtmlPreviewAgent(doc: Document, inheritedTracking?: RuntimeNodeTracking, inheritedInput?: PreviewInputOwner): () => void {
  const win = doc.defaultView
  if (!win || !doc.body) return () => {}
  const tracking = inheritedTracking ?? trackScriptMutations(doc)
  const inputOptions: PreviewInputOwner['options'] = inheritedInput?.options ?? { editing: () => false, select: () => {} }
  const releaseInput = inheritedInput?.release ?? installAuthoringInputArbitration(doc, inputOptions)
  const inputWindow = win as Window & { __cwHtmlPreviewInputOwner?: PreviewInputOwner['options'] }
  Object.defineProperty(inputWindow, '__cwHtmlPreviewInputOwner', { configurable: true, value: inputOptions })
  const frameWindow = win as Window & { __cwHtmlFrameAuthoring?: ReturnType<typeof installHtmlFrameAuthoring> }
  const ownsFrameBridge = !frameWindow.__cwHtmlFrameAuthoring
  const frameBridge = installHtmlFrameAuthoring(createDomAuthoring, doc)
  const authorWindow = win as Window & { __cwHtmlAuthoringRecords?: Record<string, ComponentAuthorRecord>;
    __cwHtmlAuthoringConsumer?: ReturnType<typeof createNestedDomAuthoring> | ReturnType<typeof createDomAuthoring>;
    __cwPageTextOverrides?: { originalText(node: Text): string; setLocalText(node: Text, text: string | null): void } }
  if (!authorWindow.__cwHtmlAuthoringRecords) {
    try {
      const value = JSON.parse(doc.getElementById('cw-html-authoring-records')?.textContent ?? '{}')
      const parsed = componentAuthorRecordsSchema.safeParse(value.records ?? value)
      authorWindow.__cwHtmlAuthoringRecords = parsed.success ? parsed.data : {}
    } catch { authorWindow.__cwHtmlAuthoringRecords = {} }
  }
  // Saved HTML may carry the older single-document software consumer. Upgrade
  // that projection while retaining its records and the original program DOM.
  const previousConsumer = authorWindow.__cwHtmlAuthoringConsumer
  const inheritedConsumer = previousConsumer && 'documents' in previousConsumer && typeof previousConsumer.setActive === 'function' && typeof previousConsumer.targets === 'function'
    ? previousConsumer : undefined
  if (previousConsumer && previousConsumer !== inheritedConsumer) previousConsumer.dispose()
  let syncDocuments = () => {}
  const authoring = inheritedConsumer ?? createNestedDomAuthoring(doc.documentElement, createDomAuthoring, {
    records: () => authorWindow.__cwHtmlAuthoringRecords ?? {},
    shadowRoot: host => frameBridge.shadowRoot(host),
    resourceReference: value => frameBridge.resourceReference(value),
    resolveResource: value => frameBridge.resolveResource(value),
    matchesResource: (value, live) => frameBridge.matchesResource(value, live),
    originalText: node => authorWindow.__cwPageTextOverrides?.originalText(node),
    claimText: (node, text) => authorWindow.__cwPageTextOverrides?.setLocalText(node, text),
    onDocumentsChanged: () => queueMicrotask(() => { if (!disposed) { syncDocuments(); scheduleDiscovery() } }),
  })
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
  // Pagination consumes only the direct body/main section skeleton. Serializing
  // the live document needlessly copies embedded programs and large data URLs.
  const tag = (element: Element) => `<${element.localName}${element.id ? ` id="${element.id.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''}>`
  const skeleton = `<body>${[...doc.body.children].map(element => element.localName === 'main'
    ? `${tag(element)}${[...element.children].map(child => `${tag(child)}</${child.localName}>`).join('')}</main>`
    : `${tag(element)}</${element.localName}>`).join('')}</body>`
  const indexed = indexHtmlElements(skeleton)
  const placeholders = mountPlaceholders(doc.body)
  const send = (message: Record<string, unknown>) => {
    if (!leaseId || !loadId || disposed) return
    win.parent.postMessage({ ...message, protocol: 1, leaseId, loadId, ...(message.event === 'ready' ? {} : { seq: ++seq }) }, '*')
  }
  const pagination: HtmlPreviewPagination = mountPagination(doc, indexed.sections, view => {
    send({ event: 'page', pageIndex: view.pageIndex, perPageScroll: view.perPageScroll })
  })
  const readAuthoring = <T>(work: () => T): T => {
    const current = authoring as typeof authoring & { withReadScope?<T>(work: () => T): T }
    return current.withReadScope ? current.withReadScope(work) : work()
  }
  const handleOf = (node: Node): string => {
    let handle = handles.get(node)
    if (!handle) { handle = `html-target-${++nextHandle}`; handles.set(node, handle); nodes.set(handle, node) }
    return handle
  }
  const report = (node: Text | HTMLImageElement): HtmlPreviewTargetReport | null => {
    const element = isImage(node) ? node : node.parentElement
    if (!element || !element.isConnected) return null
    const rect = authoring.rect(node)
    if (!rect.width || !rect.height) return null
    if (isImage(node)) imageObservations.set(node, {
      src: node.getAttribute('src'), srcset: node.getAttribute('srcset'), sizes: node.getAttribute('sizes'),
      sources: Array.from(node.parentElement?.localName === 'picture' ? node.parentElement.querySelectorAll('source') : [])
        .map(source => ({ node: source, srcset: source.getAttribute('srcset'), sizes: source.getAttribute('sizes'), type: source.getAttribute('type') })),
    })
    const observation = authoring.describe(node)
    const geometry = authoring.geometry(node)
    const textStyle = authoring.textStyle(node)
    return { handle: handleOf(node), kind: isImage(node) ? 'image' : 'text',
      domPath: pathFor(element), sectionOrder: sectionOrder(element),
      rawText: isImage(node) ? node.getAttribute('src') ?? '' : node.data,
      attributeName: isImage(node) ? 'src' : null,
      // A child DOM path must never resolve against an accidentally similar
      // element in the outer source. Nested edits use the bound author record.
      rect, scriptCreated: node.ownerDocument !== doc || tracking.isRuntimeNode(node), ...(geometry ? { geometry } : {}),
      ...(textStyle ? { textStyle } : {}),
      ...(observation ? { bindingStatus: observation.bindingStatus, authoring: { authorKey: observation.authorKey, record: observation.record } } : {}) }
  }
  let visible = true
  let scanSerial = 0
  let scanId = ''
  let discoveryFrame = 0
  let discoveryDirty = true, discoveryFull = true
  const dirtyRoots = new Set<Node>()
  const discoveredNodes = new Set<Text | HTMLImageElement>()
  const intersecting = new Set<Element>()
  const nodesByElement = new Map<Element, Set<Text | HTMLImageElement>>()
  const visibilityElement = new WeakMap<Node, Element>()
  const Intersection = (win as Window & typeof globalThis).IntersectionObserver
  const intersection = typeof Intersection === 'function' ? new Intersection(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) intersecting.add(entry.target)
      else intersecting.delete(entry.target)
    }
    scheduleDiscovery(false)
  }) : null
  const forgetDiscovered = (node: Text | HTMLImageElement) => {
    discoveredNodes.delete(node)
    const element = visibilityElement.get(node), targets = element && nodesByElement.get(element)
    targets?.delete(node)
    if (element && !targets?.size) {
      intersection?.unobserve(element); intersecting.delete(element); nodesByElement.delete(element)
    }
    visibilityElement.delete(node)
  }
  const rememberDiscovered = (node: Text | HTMLImageElement) => {
    if (!node.isConnected || isText(node) && !editableText(node)) return
    // display:contents has no own intersection box; observe its layout ancestor.
    let element: Element | null = isImage(node) ? node : node.parentElement
    while (element?.parentElement && element.ownerDocument.defaultView?.getComputedStyle(element).display === 'contents') element = element.parentElement
    if (!element) return
    const oldElement = visibilityElement.get(node)
    if (oldElement === element) return
    if (oldElement) forgetDiscovered(node)
    discoveredNodes.add(node); visibilityElement.set(node, element)
    let targets = nodesByElement.get(element)
    if (!targets) { targets = new Set(); nodesByElement.set(element, targets); intersection?.observe(element) }
    targets.add(node)
  }
  let cardAuthorKeys: string[] = []
  const cardReports = () => {
    if (!cardAuthorKeys.length) return
    const reports: HtmlPreviewTargetReport[] = []
    for (const node of nodes.values()) {
      if (!isImage(node) && !isText(node)) continue
      const observation = authoring.describe(node)
      if (observation && cardAuthorKeys.includes(observation.authorKey)) {
        const value = report(node); if (value && !reports.some(previous => previous.authoring?.authorKey === value.authoring?.authorKey)) reports.push(value)
      }
    }
    if (cardAuthorKeys.length) send({ event: 'card-targets', targets: reports.slice(0, HTML_PREVIEW_TARGET_MAX) })
  }
  let hovered: string | null = null
  let selected: string | null = null
  let editingHandle: string | null = null
  const cursorSheets = new Map<Document, { sheet: CSSStyleSheet; cursor: string }>()
  const setCursor = (document: Document, cursor: string) => {
    const view = document.defaultView as (Window & typeof globalThis) | null
    if (!view?.CSSStyleSheet || !('adoptedStyleSheets' in document)) return
    let current = cursorSheets.get(document)
    if (!current) {
      const sheet = new view.CSSStyleSheet()
      if (!sheet.replaceSync) return
      current = { sheet, cursor: '' }; cursorSheets.set(document, current)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    }
    if (current.cursor === cursor) return
    current.cursor = cursor
    current.sheet.replaceSync(cursor ? `html,body,body *{cursor:${cursor}!important}` : '')
  }
  const resetCursors = () => { for (const document of cursorSheets.keys()) setCursor(document, '') }
  const candidates = new Set<string>()
  const confirmed = new Set<string>()
  let markers: HTMLDivElement | null = null
  let markerContent: ShadowRoot | null = null
  const markerByHandle = new Map<string, HTMLDivElement>()
  const drawMarkers = () => {
    if (!visible) { tracking.withoutTracking(() => markers?.remove()); return }
    const measurements = readAuthoring(() => {
      cardReports()
      if (!editMode || !visible) return []
      const documents = authoring.documents()
      return [...new Set([...confirmed, ...(selected ? [selected] : [])])].flatMap(handle => {
        const node = nodes.get(handle)
        if (!node?.isConnected || !documents.includes(node.ownerDocument!)) return []
        const element = visibilityElement.get(node)
        if (intersection && handle !== selected && (!element || !intersecting.has(element))) return []
        const rect = authoring.rect(node)
        if (!rect.width || !rect.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0
          || rect.x >= win.innerWidth || rect.y >= win.innerHeight) return []
        const editable = confirmed.has(handle)
        if (!editable && handle !== selected) return []
        if (handle === selected) return [] // The host owns the one selected frame and its handles.
        return [{ handle, rect, editable, active: handle === hovered,
          state: handle === selected ? 'selected' : handle === hovered ? 'hovered' : 'editable' }]
      })
    })
    tracking.withoutTracking(() => {
      if (!editMode || !visible) { markers?.remove(); return }
      if (!markers) {
        markers = doc.createElement('div')
        markers.dataset.htmlPreviewEditMarkers = ''
        markers.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;'
        markerContent = markers.attachShadow({ mode: 'open' })
      }
      // Marker writes follow all author geometry reads in this batch.
      if (!markers.isConnected) doc.documentElement.appendChild(markers)
      const shown = new Set<string>()
      for (const { handle, rect, editable, active, state } of measurements) {
        shown.add(handle)
        let mark = markerByHandle.get(handle)
        if (!mark) { mark = doc.createElement('div'); markerByHandle.set(handle, mark); markerContent!.appendChild(mark) }
        mark.dataset.htmlPreviewEditTarget = handle
        mark.dataset.state = state
        mark.dataset.editable = String(editable)
        mark.textContent = state === 'hovered' ? isImage(nodes.get(handle)) ? '图片 · 点此选中' : '文字 · 点此编辑' : ''
        const style = `position:fixed;box-sizing:border-box;pointer-events:none;left:${rect.x - 2}px;top:${rect.y - 2}px;width:${rect.width + 4}px;height:${rect.height + 4}px;border:1px ${editable && !active ? 'dashed' : 'solid'} ${editable ? active ? '#2563eb' : 'rgba(37,99,235,.22)' : '#b45309'};background:transparent;color:#174b8b;font:11px/1.3 sans-serif;text-shadow:0 0 3px white,0 0 3px white;`
        if (mark.getAttribute('style') !== style) mark.setAttribute('style', style)
      }
      for (const [handle, mark] of markerByHandle) if (!shown.has(handle)) { mark.remove(); markerByHandle.delete(handle) }
    })
  }
  const discoverTargets = () => {
    discoveryFrame = 0
    if (!editMode || !visible || disposed) return
    if (discoveryDirty) {
      syncDocuments()
      authoring.refresh()
      const owner = authoring as typeof authoring & { targets?(scope?: Node): Array<Text | HTMLImageElement> }
      if (discoveryFull || !owner.targets) {
        const latest = new Set(owner.targets ? owner.targets() : authoring.scan().map(({ node }) => node))
        for (const node of discoveredNodes) if (!latest.has(node)) forgetDiscovered(node)
        for (const node of latest) if (isImage(node) || isText(node)) rememberDiscovered(node)
      } else for (const root of dirtyRoots) {
        const latest = new Set(owner.targets(root))
        for (const node of discoveredNodes) if ((node === root || root.contains(node)) && !latest.has(node)) forgetDiscovered(node)
        for (const node of latest) rememberDiscovered(node)
      }
      for (const node of discoveredNodes) if (!node.isConnected) forgetDiscovered(node)
      dirtyRoots.clear(); discoveryFull = false; discoveryDirty = false
    }
    scanId = `edit-scan-${++scanSerial}`
    frameBridge.confirm([], scanId)
    frameBridge.refresh()
    candidates.clear()
    const reports = readAuthoring(() => {
      const reports: HtmlPreviewTargetReport[] = []
      const visibleNodes: Iterable<Text | HTMLImageElement> = intersection
        ? new Set([...intersecting].flatMap(element => [...(nodesByElement.get(element) ?? [])])) : discoveredNodes
      for (const node of visibleNodes) {
        if (!node.isConnected) continue
        if (node === markers || markers?.contains(node)) continue
        if (!isImage(node) && !(isText(node) && editableText(node))) continue
        const observation = report(node)
        if (!observation || observation.rect.x + observation.rect.width <= 0 || observation.rect.y + observation.rect.height <= 0
          || observation.rect.x >= win.innerWidth || observation.rect.y >= win.innerHeight) continue
        candidates.add(observation.handle)
        if (!confirmed.has(observation.handle)) reports.push(observation)
      }
      return reports
    })
    drawMarkers()
    for (let start = 0; start < reports.length; start += HTML_PREVIEW_TARGET_MAX) {
      send({ event: 'edit-targets', scanId, targets: reports.slice(start, start + HTML_PREVIEW_TARGET_MAX) })
    }
  }
  const scheduleDiscovery = (invalidate = true, roots?: readonly Node[]) => {
    if (invalidate) {
      discoveryDirty = true
      if (!roots) { discoveryFull = true; dirtyRoots.clear() }
      else if (!discoveryFull) for (const root of roots) {
        if ([...dirtyRoots].some(previous => previous === root || previous.contains(root))) continue
        for (const previous of dirtyRoots) if (root.contains(previous)) dirtyRoots.delete(previous)
        dirtyRoots.add(root)
      }
    }
    if (!editMode || !visible) return
    if (invalidate) { confirmed.clear(); scanId = ''; drawMarkers() }
    if (discoveryFrame) return
    discoveryFrame = win.requestAnimationFrame(discoverTargets)
  }
  const stopFrameTargets = frameBridge.onTargets(message => {
    if (!editMode || !visible || !loadId) return
    if (message.event === 'selection' || message.event === 'gesture') { send(message); return }
    if (message.event === 'targets') send({ event: 'targets', targets: message.targets, ...(message.intent ? { intent: message.intent } : {}) })
    else {
      for (const target of message.targets) candidates.add(target.handle)
      send({ event: 'edit-targets', scanId, targets: message.targets })
    }
  })
  const mutationRoots = (records: readonly MutationRecord[]) => records.filter(record => record.target !== markers && !markers?.contains(record.target)
    && !(record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node === markers))).map(record => record.target)
  const pruneDisconnected = () => {
    // A node stays isConnected inside an old Document after frame navigation.
    // Retire only registered realms whose live parent chain no longer reaches
    // this preview; discovering new documents remains the active scan's job.
    const liveDocuments = new Set<Document>([doc]), pending = new Set(childDocuments.keys())
    let advanced = true
    while (advanced && pending.size) {
      advanced = false
      for (const document of pending) {
        const entry = childDocuments.get(document)!
        try {
          const frame = entry.view?.frameElement
          if (entry.view?.document === document && frame?.isConnected && liveDocuments.has(frame.ownerDocument)) {
            liveDocuments.add(document); pending.delete(document); advanced = true
          }
        } catch { /* Navigation outside the accessible realm retires this owner. */ }
      }
    }
    for (const document of pending) { const entry = childDocuments.get(document)!; detachChild(document, entry); childDocuments.delete(document) }
    for (const [handle, node] of nodes) if (!node.isConnected || !liveDocuments.has(node.ownerDocument!)) {
      nodes.delete(handle); candidates.delete(handle); confirmed.delete(handle)
      if (selected === handle) selected = null
    }
    for (const node of discoveredNodes) if (!node.isConnected || !liveDocuments.has(node.ownerDocument!)) forgetDiscovered(node)
  }
  const observer = new MutationObserver(records => {
    const roots = mutationRoots(records)
    if (roots.length) { pruneDisconnected(); scheduleDiscovery(true, roots) }
  })
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true })
  const onViewportChange = () => scheduleDiscovery(false)
  win.addEventListener('scroll', onViewportChange, true)
  win.addEventListener('resize', onViewportChange)
  const pausedMedia = new Set<HTMLMediaElement>(), pausedAnimations = new Set<Animation>()
  const pauseControlledActivity = () => {
    for (const document of authoring.documents()) {
      for (const media of document.querySelectorAll<HTMLMediaElement>('video,audio')) if (!media.paused) { pausedMedia.add(media); media.pause() }
      for (const animation of document.getAnimations?.() ?? []) if (animation.playState === 'running') { pausedAnimations.add(animation); animation.pause() }
    }
  }
  const setVisible = (value: boolean) => {
    if (visible === value) return
    visible = value
    authoring.setActive?.(value)
    frameBridge.setVisibility(value)
    if (!visible) { hovered = null; authoring.suppressText(); resetCursors(); drawMarkers() }
    else {
      const node = editingHandle && nodes.get(editingHandle)
      authoring.suppressText(isText(node) ? node : undefined)
      scheduleDiscovery()
    }
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
  type PointerLocation = Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>
  const pickTarget = (event: PointerLocation): Text | HTMLImageElement | null => {
    const document = isNode(event.target) ? event.target.ownerDocument ?? doc : doc
    const capturedAtRoot = event.target === document.documentElement || event.target === document.body || event.target === document
    const rootPoint = capturedAtRoot && pointInRoot(document, { x: event.clientX, y: event.clientY })
    const observed = rootPoint && authoring.hit(rootPoint.x, rootPoint.y)?.node
    if (isText(observed) || isImage(observed)) return observed
    // Pointer capture can retarget click/dblclick to documentElement. The
    // painted point remains authoritative, including the image under it.
    const painted = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target
    if (isImage(painted)) return painted
    const text = textAtPoint(document, event.clientX, event.clientY)
    return text && editableText(text) && isNode(painted) && painted.contains(text) ? text : null
  }
  const targetReportAt = (event: MouseEvent) => {
    const target = pickTarget(event)
    if (isImage(target)) return report(target)
    const text = isText(target) ? target : null
    const value = text && report(text)
    const offset = text && authoringCaretOffset(text.ownerDocument, text, event.clientX, event.clientY)
    if (value && offset !== null && offset !== undefined) value.selection = { anchor: offset, focus: offset, ...(event.type === 'dblclick' ? { word: true } : {}) }
    if (value && text) selectingText = { node: text, handle: value.handle, anchor: offset ?? 0 }
    return value
  }
  let selectingText: { node: Text; handle: string; anchor: number } | undefined
  const onClick = (event: MouseEvent) => {
    if (!visible || !loadId || !editMode || event.button !== 0) return
    authoring.refresh()
    const targetReport = targetReportAt(event)
    if (targetReport) {
      selected = targetReport.handle; drawMarkers()
      send({ event: 'targets', targets: [targetReport], intent: 'select' })
      event.preventDefault(); event.stopImmediatePropagation()
    } else { selected = null; send({ event: 'targets', targets: [], intent: 'select' }) }
  }
  const onDoubleClick = (event: MouseEvent) => {
    if (!visible || !loadId || !editMode || event.button !== 0) return
    const targetReport = targetReportAt(event)
    if (targetReport) {
      selected = targetReport.handle; drawMarkers()
      send({ event: 'targets', targets: [targetReport], intent: 'edit' })
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }
  inputOptions.editing = () => inputWindow.__cwHtmlPreviewInputOwner === inputOptions && !disposed && visible && Boolean(loadId) && editMode
  inputOptions.select = (_point, event) => onClick(event as MouseEvent)
  inputOptions.edit = (_point, event) => onDoubleClick(event as MouseEvent)
  const contentEditing: NonNullable<PreviewInputOwner['options']['contentEditing']> = (point, event) => {
    const node = editingHandle ? nodes.get(editingHandle) : undefined
    return Boolean(node && pickTarget({ target: event.target, clientX: point.x, clientY: point.y }) === node)
  }
  inputOptions.contentEditing = contentEditing
  const extendSelection = (point: { x: number; y: number }) => {
    if (!selectingText || !editMode || !visible) return
    const focus = authoringCaretOffset(selectingText.node.ownerDocument, selectingText.node, point.x, point.y)
    if (focus !== undefined) send({ event: 'selection', handle: selectingText.handle, anchor: selectingText.anchor, focus })
  }
  inputOptions.extend = extendSelection
  const frameFacts = createAuthoringFrameGeometry()
  const pointInRoot = (document: Document, point: { x: number; y: number }) => {
    let current = point, owner = document
    while (owner !== doc) {
      const frame = owner.defaultView?.frameElement as HTMLIFrameElement | null, matrix = frame && frameFacts.frameMatrix(frame)
      if (!matrix || !frame) return
      current = { x: matrix[0] * current.x + matrix[2] * current.y + matrix[4], y: matrix[1] * current.x + matrix[3] * current.y + matrix[5] }
      owner = frame.ownerDocument
    }
    return current
  }
  let pointerTarget: { handle: string; pointerId: number; document: Document } | undefined
  const gesture: NonNullable<PreviewInputOwner['options']['gesture']> = (point, event, phase) => {
    if (phase === 'start') {
      const target = selected ? nodes.get(selected) : undefined
      const value = isText(target) || isImage(target) ? report(target) : undefined
      pointerTarget = value?.geometry && value.authoring && isNode(event.target)
        ? { handle: value.handle, pointerId: (event as PointerEvent).pointerId ?? 0, document: event.target.ownerDocument ?? doc } : undefined
    }
    const current = pointerTarget
    if (!current) return
    const rootPoint = pointInRoot(current.document, point)
    if (rootPoint) send({ event: 'gesture', phase, handle: current.handle, pointerId: current.pointerId,
      x: rootPoint.x, y: rootPoint.y, shift: (event as MouseEvent).shiftKey === true, alt: (event as MouseEvent).altKey === true })
    if (phase === 'end' || phase === 'cancel') pointerTarget = undefined
  }
  inputOptions.gesture = gesture
  const onPointerMove = (event: PointerLocation) => {
    if (!editMode || !visible) return
    const document = isNode(event.target) ? event.target.ownerDocument : null
    const target = pickTarget(event)
    const handle = target ? handles.get(target) ?? null : null
    if (document) setCursor(document, target && handle !== editingHandle && authoring.geometry(target) ? 'move' : handle === editingHandle ? 'text' : 'default')
    const next = handle && confirmed.has(handle) ? handle : null
    if (hovered !== next) { hovered = next; drawMarkers() }
  }
  inputOptions.hover = point => {
    const target = doc.elementFromPoint?.(point.x, point.y)
    if (target) onPointerMove({ target, clientX: point.x, clientY: point.y })
  }
  const onPointerLeave = () => { resetCursors(); if (hovered) { hovered = null; drawMarkers() } }
  type ChildDocument = { root: Element; observer: MutationObserver; view: Window | null; inputOwner: PreviewInputOwner['options'] }
  const childDocuments = new Map<Document, ChildDocument>()
  const childLoaded = (event: Event) => {
    if (isNode(event.target) && (event.target as Element).localName === 'iframe') { syncDocuments(); scheduleDiscovery() }
  }
  const detachChild = (document: Document, entry: ChildDocument) => {
    entry.observer.disconnect()
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('mousemove', onPointerMove, true)
    document.removeEventListener('scroll', onViewportChange, true)
    document.removeEventListener('load', childLoaded, true)
    document.removeEventListener('play', onActivity, true)
    document.removeEventListener('animationstart', onActivity, true)
    document.removeEventListener('transitionrun', onActivity, true)
    try {
      entry.view?.removeEventListener('resize', onViewportChange)
      const child = entry.view as (Window & { __cwHtmlPreviewInputOwner?: PreviewInputOwner['options'] }) | null
      if (child?.__cwHtmlPreviewInputOwner === entry.inputOwner) Reflect.deleteProperty(child, '__cwHtmlPreviewInputOwner')
    } catch { /* A navigated WindowProxy no longer grants access to the retired realm. */ }
  }
  syncDocuments = () => {
    const current = new Set(authoring.documents())
    for (const node of discoveredNodes) if (!node.isConnected || !current.has(node.ownerDocument!)) forgetDiscovered(node)
    for (const [document, entry] of childDocuments) if (!current.has(document) || entry.root !== document.documentElement) { detachChild(document, entry); childDocuments.delete(document) }
    for (const document of current) {
      if (document === doc || childDocuments.has(document) || !document.documentElement) continue
      const view = document.defaultView
      const Observer = (view as Window & typeof globalThis | null)?.MutationObserver
      if (!Observer) continue
      const observer = new Observer(records => {
        const roots = mutationRoots(records)
        if (roots.length) { pruneDisconnected(); scheduleDiscovery(true, roots) }
      })
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
      const inputOwner: PreviewInputOwner['options'] = { editing: () => !disposed && visible && editMode,
        select: (_point, event) => onClick(event as MouseEvent), edit: (_point, event) => onDoubleClick(event as MouseEvent),
        contentEditing, extend: extendSelection, gesture }
      inputOwner.hover = point => {
        const target = document.elementFromPoint?.(point.x, point.y)
        if (target) onPointerMove({ target, clientX: point.x, clientY: point.y })
      }
      if (view) Object.defineProperty(view, '__cwHtmlPreviewInputOwner', { configurable: true, value: inputOwner })
      childDocuments.set(document, { root: document.documentElement, observer, view, inputOwner })
      document.addEventListener('click', onClick, true)
      document.addEventListener('dblclick', onDoubleClick, true)
      document.addEventListener('mousemove', onPointerMove, true)
      document.addEventListener('scroll', onViewportChange, true)
      document.addEventListener('load', childLoaded, true)
      document.addEventListener('play', onActivity, true)
      document.addEventListener('animationstart', onActivity, true)
      document.addEventListener('transitionrun', onActivity, true)
      view?.addEventListener('resize', onViewportChange)
    }
    for (const [handle, node] of nodes) if (!node.isConnected || !current.has(node.ownerDocument!)) {
      nodes.delete(handle); candidates.delete(handle); confirmed.delete(handle)
      if (selected === handle) selected = null
    }
  }
  syncDocuments()
  doc.addEventListener('load', childLoaded, true)
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
    if (message.type === 'html-preview.select-source' && visible) {
      const path = htmlPreviewTargetReportSchema.shape.domPath.safeParse(message.domPath)
      if (!path.success || !path.data.length) return
      let owner: Document | Element = doc
      for (const step of path.data) {
        const element: Element | null = owner.children.item(step.index)
        if (!element || element.localName !== step.name) return
        owner = element
      }
      const element = owner as Element
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      if (!editMode) return
      let node: Text | HTMLImageElement | undefined
      if (message.kind === 'image' && isImage(element)) node = element
      else if (message.kind === 'text' && typeof message.expectedText === 'string') {
        const matching = [...element.childNodes].filter((node): node is Text => isText(node) && node.data === message.expectedText && editableText(node))
        if (matching.length === 1) node = matching[0]
      }
      const value = node && report(node)
      if (value) { selected = value.handle; drawMarkers(); send({ event: 'targets', targets: [value] }) }
      return
    }
    if (message.type === 'html-preview.card-targets') {
      if (!Array.isArray(message.authorKeys) || message.authorKeys.length > HTML_PREVIEW_TARGET_MAX || message.authorKeys.some(key => typeof key !== 'string' || !key)) return
      cardAuthorKeys = message.authorKeys; cardReports(); return
    }
    if (message.type === 'html-preview.select-author' && typeof message.authorKey === 'string' && editMode && visible) {
      const node = [...nodes.values()].find(node => authoring.describe(node)?.authorKey === message.authorKey)
      const value = isText(node) || isImage(node) ? report(node) : null
      if (value) { selected = value.handle; drawMarkers(); send({ event: 'targets', targets: [value] }) }
      return
    }
    if (message.type === 'html-preview.authoring-preview') {
      if (typeof message.authorKey !== 'string' || message.geometry !== null && (!message.geometry || typeof message.geometry !== 'object'
        || Object.values(message.geometry).some(value => typeof value !== 'number' || !Number.isFinite(value)))) return
      tracking.withoutTracking(() => authoring.previewGeometry(message.authorKey, message.geometry))
      frameBridge.previewGeometry(message.authorKey, message.geometry)
      drawMarkers()
      return
    }
    if (message.type === 'html-preview.authoring-records') {
      const parsed = componentAuthorRecordsSchema.safeParse(message.records)
      if (!parsed.success) return
      authorWindow.__cwHtmlAuthoringRecords = parsed.data
      frameBridge.setRecords(parsed.data)
      tracking.withoutTracking(() => authoring.refresh())
      scheduleDiscovery()
      return
    }
    if (message.type === 'html-preview.visibility' && typeof message.active === 'boolean') { setVisible(message.active); return }
    if (message.type === 'html-preview.edit-mode' && typeof message.enabled === 'boolean'
      && typeof message.requestId === 'string' && message.requestId.length > 0 && message.requestId.length <= 256) {
      const previousMode = editMode
      try {
        editMode = message.enabled
        if (!editMode) resetCursors()
        authoring.suppressText()
        selected = null; editingHandle = null; hovered = null; confirmed.clear()
        if (editMode) discoverTargets()
        else { scanId = ''; if (discoveryFrame) win.cancelAnimationFrame(discoveryFrame); discoveryFrame = 0; drawMarkers() }
        frameBridge.setEditMode(editMode)
        send({ event: 'edit-mode-ready', requestId: message.requestId, enabled: editMode })
      } catch (error) {
        editMode = previousMode
        try { frameBridge.setEditMode(previousMode) } catch { /* Report the original preparation failure, not a second rollback error. */ }
        send({ event: 'edit-mode-error', requestId: message.requestId, enabled: message.enabled,
          message: error instanceof Error ? error.message : '预览编辑未能准备完成，可重试或在源码中继续。' })
      }
    }
    if (message.type === 'html-preview.refresh-targets') {
      const node = selected ? nodes.get(selected) : undefined
      const value = isText(node) || isImage(node) ? report(node) : undefined
      if (value) send({ event: 'targets', targets: [value], intent: 'observe' })
      scheduleDiscovery()
    }
    if (message.type === 'html-preview.confirm-targets' && editMode && message.scanId === scanId && Array.isArray(message.handles)) {
      for (const handle of message.handles) if (candidates.has(handle)) confirmed.add(handle)
      frameBridge.confirm(message.handles, scanId)
      drawMarkers()
    }
    if (message.type === 'html-preview.selection' && editMode) {
      frameBridge.select(message.handle, message.editable, message.editing === true)
      selected = typeof message.handle === 'string' && nodes.has(message.handle) ? message.handle : null
      editingHandle = message.editing === true ? message.handle : null
      if (selected && !message.editable) confirmed.delete(selected)
      else if (selected) confirmed.add(selected)
      const selectedNode = selected && message.editable && message.editing === true ? nodes.get(selected) : undefined
      tracking.withoutTracking(() => authoring.suppressText(isText(selectedNode) ? selectedNode : undefined))
      drawMarkers()
    }
    if (message.type === 'html-preview.navigate' && Number.isSafeInteger(message.index)) pagination.navigate(message.index)
    if (message.type === 'html-preview.restore' && Number.isSafeInteger(message.index) && Number.isFinite(message.scroll)) {
      pagination.restore({ pageIndex: message.index, perPageScroll: Math.max(0, message.scroll) })
    }
    if (message.type === 'html-preview.patch' && typeof message.value === 'string') {
      if (frameBridge.isRemoteHandle(message.handle) && message.authoringRecords) {
        const parsed = componentAuthorRecordsSchema.safeParse(message.authoringRecords)
        if (!parsed.success) return
        authorWindow.__cwHtmlAuthoringRecords = parsed.data
        frameBridge.setRecords(parsed.data)
        return
      }
      const node = nodes.get(message.handle)
      if (node?.isConnected && node.ownerDocument !== doc && message.authoringRecords) {
        // Nested records own the projection, including the entry-relative image
        // base. A raw patch here would resolve replacement URLs in the child.
        const parsed = componentAuthorRecordsSchema.safeParse(message.authoringRecords)
        if (!parsed.success) return
        authorWindow.__cwHtmlAuthoringRecords = parsed.data
        authoring.refresh(); scheduleDiscovery()
        return
      }
      const current = node?.nodeType === Node.TEXT_NODE ? (node as Text).data
        : isImage(node) ? node.getAttribute('src') ?? '' : null
      if (!node?.isConnected || current === null || current !== message.expected) {
        win.parent.postMessage({ event: 'html-preview.patch-result', protocol: 1, leaseId, loadId,
          handle: message.handle, ok: false }, '*')
        return
      }
      if (message.kind === 'image' && isImage(node)) {
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
      if (typeof message.authoringAnchor === 'string' && message.authoringAnchor) {
        const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element
        element?.setAttribute('data-cw-author-key', message.authoringAnchor)
      }
      if (message.kind === 'text' && node.nodeType === Node.TEXT_NODE) (node as Text).data = message.value
      if (message.kind === 'image' && isImage(node)) {
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
      authoring.refresh()
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
    releaseInput()
    if (inputWindow.__cwHtmlPreviewInputOwner === inputOptions) Reflect.deleteProperty(inputWindow, '__cwHtmlPreviewInputOwner')
    stopFrameTargets()
    if (frameWindow.__cwHtmlFrameAuthoring === frameBridge) {
      if (ownsFrameBridge) frameBridge.dispose(); else frameBridge.setEditMode(false)
    }
    disposed = true
    doc.removeEventListener('play', onActivity, true)
    doc.removeEventListener('animationstart', onActivity, true)
    doc.removeEventListener('transitionrun', onActivity, true)
    pausedMedia.clear(); pausedAnimations.clear()
    for (const [document, value] of cursorSheets) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== value.sheet)
    cursorSheets.clear()
    win.removeEventListener('click', onClick, true)
    win.removeEventListener('dblclick', onDoubleClick, true)
    win.removeEventListener('mousemove', onPointerMove, true)
    doc.documentElement.removeEventListener('mouseleave', onPointerLeave)
    win.removeEventListener('scroll', onViewportChange, true)
    win.removeEventListener('resize', onViewportChange)
    observer.disconnect()
    doc.removeEventListener('load', childLoaded, true)
    for (const [document, entry] of childDocuments) detachChild(document, entry)
    childDocuments.clear()
    if (discoveryFrame) win.cancelAnimationFrame(discoveryFrame)
    tracking.withoutTracking(() => markers?.remove())
    win.removeEventListener('message', onMessage)
    pagination.destroy()
    placeholders.destroy()
    nodes.clear()
    intersection?.disconnect(); intersecting.clear(); nodesByElement.clear(); discoveredNodes.clear(); dirtyRoots.clear(); markerByHandle.clear()
    if (!inheritedConsumer) {
      authoring.dispose()
      if (authorWindow.__cwHtmlAuthoringConsumer === authoring) delete authorWindow.__cwHtmlAuthoringConsumer
    }
    tracking.destroy()
  }
}

if (typeof document !== 'undefined' && document.currentScript) {
  const tracking = trackScriptMutations(document)
  const inputOptions: PreviewInputOwner['options'] = { editing: () => false, select: () => {} }
  const release = installAuthoringInputArbitration(document, inputOptions)
  const mount = () => { mountHtmlPreviewAgent(document, tracking, { options: inputOptions, release }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}
import { replaceSrcsetUrls, imageMimeFromUrl } from '../../shared/html/responsiveImage'
