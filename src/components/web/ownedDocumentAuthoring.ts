import type { createDomAuthoring } from './authoringDom'
import type { ComponentAuthorGeometry, ComponentAuthorGeometryObservation, ComponentAuthorRecord, ComponentAuthorSpotInput } from '../../shared/contracts/component-platform/runtime'
import type { DomTextOverrideController } from '../../player/lightEdit/domTextOverrides'
import type { installHtmlBlobCapture } from './htmlBlobCapture'
import { createAuthoringFrameGeometry } from './authoringFrame'

export interface OwnedDocumentBlobCarriers {
  frames(): HTMLIFrameElement[]
  channel(frame: HTMLIFrameElement): string | undefined
  subscribe(listener: (frame: HTMLIFrameElement) => void): () => void
  dispose(): void
}

/** Only source-known frames receiving an HTML Blob created by this realm are owned. */
export function installOwnedDocumentBlobCarriers(win: Window & typeof globalThis, bootstraps: Record<string, string>, captureFactory: typeof installHtmlBlobCapture): OwnedDocumentBlobCarriers {
  const doc = win.document, capture = captureFactory(win), listeners = new Set<(frame: HTMLIFrameElement) => void>()
  const known = new Map<HTMLIFrameElement, { channel: string; entry: NonNullable<typeof capture>['entries'] extends Map<string, infer Entry> ? Entry : never; url: string }>()
  const navigation = new WeakMap<HTMLIFrameElement, number>()
  let ended = false, sequence = 0
  const changed = (frame: HTMLIFrameElement) => { for (const listener of listeners) listener(frame) }
  const retire = (frame: HTMLIFrameElement) => {
    const previous = known.get(frame)
    if (previous) { known.delete(frame); capture?.release(previous.entry, previous.url); changed(frame) }
  }
  const sourceBootstrap = (frame: HTMLIFrameElement) => {
    const key = frame.getAttribute('data-cw-author-key')
    if (!key || !Object.hasOwn(bootstraps, key) || frame.ownerDocument !== doc) return
    if ([...doc.querySelectorAll('iframe')].filter(value => value.getAttribute('data-cw-author-key') === key).length !== 1) return
    return bootstraps[key]
  }
  // Only the initial document prefix matters. Do not match a head-looking
  // string inside a comment or run an authored script before the bootstrap.
  const bootstrapAt = (html: string) => {
    let index = 0, insertion = 0
    const tagEnd = (start: number) => {
      let quote = ''
      for (let at = start; at < html.length; at++) {
        const char = html[at]!
        if (quote) { if (char === quote) quote = '' }
        else if (char === '"' || char === "'") quote = char
        else if (char === '>') return at + 1
      }
      return html.length
    }
    while (index < html.length) {
      while (/\s/.test(html[index] ?? '') && index < html.length) index++
      if (html.startsWith('<!--', index)) { const end = html.indexOf('-->', index + 4); if (end < 0) return insertion; index = end + 3; continue }
      if (/^<!doctype\b/i.test(html.slice(index))) { index = tagEnd(index); insertion = index; continue }
      const tag = /^<(html|head)(?=[\t\n\f\r />])/i.exec(html.slice(index))
      if (!tag) return insertion
      index = tagEnd(index); insertion = index
      if (tag[1]!.toLowerCase() === 'head') return index
    }
    return insertion
  }
  const assign = (frame: HTMLIFrameElement, value: string, apply: (url: string) => void) => {
    const ticket = (navigation.get(frame) ?? 0) + 1
    navigation.set(frame, ticket); retire(frame)
    const entry = capture?.entries.get(value), bootstrap = sourceBootstrap(frame)
    if (!entry || !bootstrap) { apply(value); return }
    void entry.source.then(html => {
      if (ended || entry.revoked || navigation.get(frame) !== ticket || sourceBootstrap(frame) !== bootstrap) return
      const activity = (win as Window & { __guolingRuntimeActivity?: { active: boolean; visible: boolean; playing: boolean } }).__guolingRuntimeActivity
      const channel = String(++sequence), script = `<script>(${bootstrap})(${JSON.stringify(channel)},${JSON.stringify(activity)});<\/script>`
      const at = bootstrapAt(html)
      const url = capture!.project(entry, html.slice(0, at) + script + html.slice(at))
      known.set(frame, { channel, entry, url }); apply(url); changed(frame)
    }).catch(() => { if (!ended && !entry.revoked && navigation.get(frame) === ticket) apply(value) })
  }
  const src = Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'src')
  const srcdoc = Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'srcdoc')
  const nativeSet = win.Element.prototype.setAttribute
  const setSrc = src?.set && function(this: HTMLIFrameElement, value: string) { assign(this, String(value), url => src.set!.call(this, url)) }
  const setSrcdoc = srcdoc?.set && function(this: HTMLIFrameElement, value: string) {
    navigation.set(this, (navigation.get(this) ?? 0) + 1); retire(this); srcdoc.set!.call(this, value)
  }
  const setAttribute = function(this: Element, name: string, value: string) {
    if (this instanceof win.HTMLIFrameElement && name.toLowerCase() === 'src') assign(this, String(value), url => nativeSet.call(this, name, url))
    else {
      if (this instanceof win.HTMLIFrameElement && name.toLowerCase() === 'srcdoc') { navigation.set(this, (navigation.get(this) ?? 0) + 1); retire(this) }
      nativeSet.call(this, name, value)
    }
  }
  if (capture) {
    if (setSrc) Object.defineProperty(win.HTMLIFrameElement.prototype, 'src', { ...src, set: setSrc })
    if (setSrcdoc) Object.defineProperty(win.HTMLIFrameElement.prototype, 'srcdoc', { ...srcdoc, set: setSrcdoc })
    win.Element.prototype.setAttribute = setAttribute
  }
  const observer = new win.MutationObserver(() => { for (const frame of known.keys()) if (!frame.isConnected) {
    navigation.set(frame, (navigation.get(frame) ?? 0) + 1); retire(frame)
  } })
  observer.observe(doc, { childList: true, subtree: true })
  const dispose = () => {
    if (ended) return
    ended = true; observer.disconnect()
    for (const frame of [...known.keys()]) retire(frame)
    listeners.clear(); capture?.dispose()
    if (setSrc && Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'src')?.set === setSrc) Object.defineProperty(win.HTMLIFrameElement.prototype, 'src', src!)
    if (setSrcdoc && Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'srcdoc')?.set === setSrcdoc) Object.defineProperty(win.HTMLIFrameElement.prototype, 'srcdoc', srcdoc!)
    if (win.Element.prototype.setAttribute === setAttribute) win.Element.prototype.setAttribute = nativeSet
    win.removeEventListener('pagehide', dispose)
  }
  win.addEventListener('pagehide', dispose, { once: true })
  return { frames: () => [...known.keys()], channel: frame => known.get(frame)?.channel,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, dispose }
}

/** Installed before authored listeners in this realm. It reports selection only;
 * workbench commands remain owned by the outer trusted input path. */
export function installAuthoringInputArbitration(doc: Document, options: {
  editing(): boolean
  select(point: { x: number; y: number }, event: Event, word?: boolean): void
  extend?(point: { x: number; y: number }, event: Event): void
  hover?(point: { x: number; y: number }): void
}) {
  const win = doc.defaultView
  if (!win) return () => {}
  let pointerSelected = false, selecting = false
  let lastPress: { x: number; y: number; time: number } | undefined
  const receive = (event: Event) => {
    if (!options.editing()) { pointerSelected = false; return }
    if (event.type === 'pointermove' || event.type === 'pointerup') {
      if (selecting) { const pointer = event as PointerEvent; options.extend?.({ x: pointer.clientX, y: pointer.clientY }, event) }
      else if (event.type === 'pointermove') { const pointer = event as PointerEvent; options.hover?.({ x: pointer.clientX, y: pointer.clientY }) }
      if (event.type === 'pointerup') selecting = false
      if (event.type === 'pointermove') return
    }
    if (event.type === 'dblclick') {
      const pointer = event as MouseEvent
      if (pointer.button === 0) options.select({ x: pointer.clientX, y: pointer.clientY }, event, true)
    }
    if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'click') {
      const pointer = event as MouseEvent
      if (pointer.button === 0 && (event.type === 'pointerdown' || !pointerSelected)) {
        const time = event.timeStamp, word = event.type === 'pointerdown' && lastPress !== undefined && time - lastPress.time <= 500
          && Math.hypot(pointer.clientX - lastPress.x, pointer.clientY - lastPress.y) <= 5
        options.select({ x: pointer.clientX, y: pointer.clientY }, event, word)
        if (event.type === 'pointerdown') lastPress = word ? undefined : { x: pointer.clientX, y: pointer.clientY, time }
        pointerSelected = true
        if (event.type === 'pointerdown') { selecting = true; try { doc.documentElement.setPointerCapture((event as PointerEvent).pointerId) } catch { /* Mouse-only input has no pointer capture. */ } }
      }
      if (event.type === 'click') pointerSelected = false
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    // Preventing pointerdown keeps native editing focus outside this document.
    // A program may have focused itself earlier; return subsequent input to the
    // same parent workbench without executing a command supplied by the page.
    if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'keydown') {
      try { if (win.parent !== win) win.parent.focus() } catch { /* The host's next explicit input still owns focus. */ }
    }
  }
  const events = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
    'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'submit', 'dragstart']
  for (const name of events) win.addEventListener(name, receive, { capture: true, passive: false })
  const release = () => {
    for (const name of events) win.removeEventListener(name, receive, true)
    win.removeEventListener('pagehide', release)
  }
  win.addEventListener('pagehide', release, { once: true })
  return release
}

/** UTF-16 caret intent is valid only for the exact painted text leaf. */
export function authoringCaretOffset(doc: Document, node: Node | undefined, x: number, y: number): number | undefined {
  if (node?.nodeType !== 3) return
  const position = doc.caretPositionFromPoint?.(x, y)
  const range = position ? undefined : (doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y)
  const container = position?.offsetNode ?? range?.startContainer, offset = position?.offset ?? range?.startOffset
  if (container === node && Number.isSafeInteger(offset) && offset! >= 0 && offset! <= (node.textContent?.length ?? 0)) return offset
}

interface OwnedAuthorReport {
  handle: string
  kind: 'text' | 'image'
  domPath: []
  sectionOrder: null
  rawText: string
  attributeName: 'src' | null
  scriptCreated: true
  authoring: { authorKey: string; record: ComponentAuthorRecord }
  bindingStatus: 'bound' | 'unresolved'
  geometry?: ComponentAuthorGeometryObservation
  textStyle?: ComponentAuthorSpotInput['textStyle']
  rect: { x: number; y: number; width: number; height: number }
}

/** Serialized into owned parser realms; the root only aggregates child owners. */
export function installOwnedDocumentAuthoring(token: string, documentPath: string, factory: typeof createDomAuthoring, options: {
  /** Same live chain remains re-editable after Undo removes its first identity. */
  pendingPath?: string
  records?(): Record<string, ComponentAuthorRecord>
  resources?(): Record<string, string>
  runtimeResources?(resources: Record<string, string>): Record<string, string>
  resolveResource?(reference: string, bindings: Readonly<Record<string, string>>): string | undefined
  matchesResource?(reference: string, liveUrl: string, bindings: Readonly<Record<string, string>>): boolean
  bindings?(): Readonly<Record<string, string>>
  activity?(): { active: boolean; visible: boolean; playing: boolean } | undefined
  refreshResources?(root: Document, resources: Record<string, string>, bindings: Readonly<Record<string, string>>): void
  observe?: boolean
  onChange?(): void
  onPointer?(point: { x: number; y: number; authorKey?: string; caretOffset?: number }): void
  onDoubleClick?(point: { x: number; y: number; authorKey?: string; caretOffset?: number }): void
  onSelection?(selection: { authorKey: string; anchor: number; focus: number; word?: boolean }): void
  onHover?(authorKey: string | undefined): void
  paintedElementAt?(x: number, y: number): Element | undefined
  caret?: typeof authoringCaretOffset
  input?: typeof installAuthoringInputArbitration
  channel?: string
  blobCarriers?(): OwnedDocumentBlobCarriers | undefined
  report?(authorKey: string, status: 'bound' | 'unmounted' | 'unresolved'): void
} = {}, frameFactory: typeof createAuthoringFrameGeometry = createAuthoringFrameGeometry) {
  type Matrix = ComponentAuthorGeometryObservation['parentToInstance']
  type State = { records: Record<string, ComponentAuthorRecord>; resources: Record<string, string>; bindings: Readonly<Record<string, string>>; observe: boolean }
  type Child = { reports: OwnedAuthorReport[]; width: number; height: number }
  const frameFacts = frameFactory()
  let state: State = { records: {}, resources: {}, bindings: {}, observe: options.observe === true }
  const resourceUrls = () => options.runtimeResources?.(state.resources) ?? state.resources
  let ended = false, queued = false, consumer: ReturnType<typeof factory> | undefined, sequence = 0
  let selectingText: { node: Node; authorKey: string; anchor: number } | undefined
  const releaseInput = documentPath ? options.input?.(document, {
    editing: () => {
      const activity = options.activity?.() ?? (window as Window & { __guolingRuntimeActivity?: { active: boolean; visible: boolean; playing: boolean } }).__guolingRuntimeActivity
      return !ended && state.observe && activity?.active === true && activity.visible && !activity.playing
    },
    select: (point, event, word) => {
      const observed = consumer?.hit(point.x, point.y)
      const caretOffset = options.caret?.(document, observed?.node, point.x, point.y)
      const value = { ...point, authorKey: observed?.authorKey, ...(caretOffset === undefined ? {} : { caretOffset }) }
      selectingText = observed && caretOffset !== undefined ? { node: observed.node, authorKey: observed.authorKey, anchor: caretOffset } : undefined
      if (event.type === 'dblclick') doubleClick(value); else pointer(value)
      if ((word || event.type === 'dblclick') && selectingText) selection({ authorKey: selectingText.authorKey, anchor: caretOffset!, focus: caretOffset!, word: true })
    },
    extend: point => { if (selectingText) { const focus = options.caret?.(document, selectingText.node, point.x, point.y); if (focus !== undefined) selection({ authorKey: selectingText.authorKey, anchor: selectingText.anchor, focus }) } },
    hover: point => hover(consumer?.hit(point.x, point.y)?.authorKey),
  }) : undefined
  const initialPendingPath = options.pendingPath ?? (documentPath.includes('pending:') ? documentPath : undefined)
  const scope = documentPath ? { 'document:path': documentPath } : undefined
  const children = new Map<HTMLIFrameElement, Child>()
  const pending = new Map<number, { frame: HTMLIFrameElement; resolve(value?: string): void }>()
  const frames = () => [...new Set([...document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]'), ...(options.blobCarriers?.()?.frames() ?? [])])]
  const parentMessage = (value: object) => parent.postMessage({ ...value, token, ...(options.channel ? { channel: options.channel } : {}) }, '*')
  const post = (frame: HTMLIFrameElement, value: object) => {
    const channel = options.blobCarriers?.()?.channel(frame)
    frame.contentWindow?.postMessage({ ...value, token, ...(channel ? { channel } : {}) }, '*')
  }
  const localRecords = () => Object.fromEntries(Object.entries(state.records).filter(([, record]) => (record.scope?.['document:path'] ?? '') === documentPath))
  const pageText = () => (window as Window & { __cwPageTextOverrides?: DomTextOverrideController }).__cwPageTextOverrides
  const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
  const point = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
  const inversePoint = (m: Matrix, x: number, y: number) => {
    const determinant = m[0] * m[3] - m[1] * m[2]
    return Math.abs(determinant) < 1e-10 ? undefined : { x: (m[3] * (x - m[4]) - m[2] * (y - m[5])) / determinant,
      y: (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / determinant }
  }
  // Child coordinates are its viewport CSS pixels. Include border/padding,
  // individual transforms and ancestor zoom before composing the next realm.
  const frameMatrix = (frame: HTMLIFrameElement, child: Child): Matrix | undefined => {
    if (consumer && !consumer.visible(frame)) return
    return frameFacts.frameMatrix(frame, child)
  }
  const prune = () => {
    const current = frames()
    for (const frame of children.keys()) if (!current.includes(frame)) children.delete(frame)
    for (const [id, request] of pending) if (!current.includes(request.frame)) { request.resolve(); pending.delete(id) }
  }
  const reports = (): OwnedAuthorReport[] => {
    if (ended || !state.observe) return []
    prune()
    const result: OwnedAuthorReport[] = []
    for (const observed of consumer?.scan() ?? []) {
      const { node, authorKey, record, initialValue, bindingStatus, geometry, textStyle } = observed
      const rect = node.nodeType === 3 ? (() => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() })() : (node as Element).getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      result.push({ handle: `owned:${documentPath}:${authorKey}`, kind: record.kind, domPath: [], sectionOrder: null,
        rawText: initialValue, attributeName: record.kind === 'image' ? 'src' : null, scriptCreated: true,
        authoring: { authorKey, record }, bindingStatus: documentPath.split('/').some(part => part.startsWith('ambiguous:')) ? 'unresolved' : bindingStatus,
        ...(geometry ? { geometry } : {}), ...(textStyle ? { textStyle } : {}),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
    }
    for (const [frame, child] of children) {
      const matrix = frameMatrix(frame, child)
      if (!matrix) continue
      for (const report of child.reports) {
        const rect = report.rect, corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
          .map(([x, y]) => point(matrix, x!, y!))
        const xs = corners.map(value => value.x), ys = corners.map(value => value.y)
        result.push({ ...report, ...(report.geometry ? { geometry: { ...report.geometry, parentToInstance: multiply(matrix, report.geometry.parentToInstance) } } : {}),
          ...(report.textStyle ? { textStyle: frameFacts.transformTextStyle(report.textStyle, matrix) } : {}),
          rect: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } })
      }
    }
    return result
  }
  const publish = () => {
    if (ended) return
    if (documentPath) parentMessage({ type: 'guoling.authoring.observe', reports: reports(), width: innerWidth, height: innerHeight })
    else options.onChange?.()
  }
  const enqueue = () => {
    if (ended || queued) return
    queued = true; queueMicrotask(() => { queued = false; publish() })
  }
  const sendState = (frame: HTMLIFrameElement) => {
    post(frame, { type: 'guoling.authoring.update', state })
    // Fragment carriers have no root parser bridge. Child parser bridges keep
    // this activity and propagate it through their existing load lifecycle.
    const activity = options.activity?.()
    if (activity) post(frame, { type: 'guoling.runtime.activity', value: activity })
  }
  const update = () => {
    if (ended) return
    if (!documentPath) state = { records: options.records?.() ?? {}, resources: options.resources?.() ?? {}, bindings: options.bindings?.() ?? {}, observe: options.observe === true }
    if (initialPendingPath) {
      const anchoredPath = initialPendingPath.replace(/(^|\/)pending:\d+:([^/]+)/g, '$1key:$2')
      documentPath = Object.values(state.records).some(record => record.scope?.['document:path'] === anchoredPath
        || record.scope?.['document:path']?.startsWith(anchoredPath + '/')) ? anchoredPath : initialPendingPath
      if (scope) scope['document:path'] = documentPath
    }
    if (documentPath) options.refreshResources?.(document, resourceUrls(), state.bindings)
    consumer?.refresh()
    for (const frame of frames()) sendState(frame)
    enqueue()
  }
  const hit = async (x: number, y: number): Promise<string | undefined> => {
    if (ended || !state.observe) return
    const top = consumer ? consumer.paintedElementAt(x, y) : options.paintedElementAt ? options.paintedElementAt(x, y) : document.elementsFromPoint(x, y)[0]
    if (top instanceof HTMLIFrameElement && frames().includes(top)) {
      const child = children.get(top), matrix = child && frameMatrix(top, child), local = matrix && inversePoint(matrix, x, y)
      if (!local) return
      return new Promise(resolve => {
        const requestId = ++sequence; pending.set(requestId, { frame: top, resolve })
        post(top, { type: 'guoling.authoring.hit', requestId, ...local })
      })
    }
    return consumer?.hit(x, y)?.authorKey
  }
  const preview = (authorKey: string, geometry: ComponentAuthorGeometry | null) => {
    consumer?.previewGeometry(authorKey, geometry)
    for (const frame of frames()) post(frame, { type: 'guoling.authoring.preview', authorKey, geometry })
    enqueue()
  }
  const input = (authorKey?: string) => { consumer?.suppressText(authorKey); for (const frame of frames()) post(frame, { type: 'guoling.authoring.input', authorKey }) }
  const pointer = (value: { x: number; y: number; authorKey?: string; caretOffset?: number }) => {
    if (documentPath) parentMessage({ type: 'guoling.authoring.pointer', ...value })
    else options.onPointer?.(value)
  }
  const doubleClick = (value: { x: number; y: number; authorKey?: string; caretOffset?: number }) => {
    if (documentPath) parentMessage({ type: 'guoling.authoring.double-click', ...value })
    else options.onDoubleClick?.(value)
  }
  const selection = (value: { authorKey: string; anchor: number; focus: number; word?: boolean }) => {
    if (documentPath) parentMessage({ type: 'guoling.authoring.selection', ...value }); else options.onSelection?.(value)
  }
  let hoveredKey: string | undefined
  const hover = (authorKey: string | undefined) => {
    if (hoveredKey === authorKey) return
    hoveredKey = authorKey
    if (documentPath) parentMessage({ type: 'guoling.authoring.hover', authorKey }); else options.onHover?.(authorKey)
  }
  const receive = (event: MessageEvent) => {
    const data = event.data
    if (ended || data?.token !== token) return
    if (documentPath && event.source === parent) {
      if (options.channel && data.channel !== options.channel) return
      if (data.type === 'guoling.authoring.update' && data.state) { state = data.state; update() }
      else if (data.type === 'guoling.authoring.hit') void hit(Number(data.x), Number(data.y)).then(authorKey => {
        if (!ended) parentMessage({ type: 'guoling.authoring.hit-result', requestId: data.requestId, authorKey })
      })
      else if (data.type === 'guoling.authoring.preview') preview(data.authorKey, data.geometry)
      else if (data.type === 'guoling.authoring.input') input(typeof data.authorKey === 'string' ? data.authorKey : undefined)
      return
    }
    const frame = frames().find(frame => frame.contentWindow === event.source)
    if (!frame) return
    const channel = options.blobCarriers?.()?.channel(frame)
    if (channel && data.channel !== channel) return
    if (data.type === 'guoling.authoring.ready') sendState(frame)
    else if (data.type === 'guoling.authoring.observe' && Array.isArray(data.reports)) {
      children.set(frame, { reports: data.reports, width: data.width, height: data.height }); enqueue()
    } else if (data.type === 'guoling.authoring.hit-result') {
      const request = pending.get(data.requestId)
      if (request?.frame === frame) { pending.delete(data.requestId); request.resolve(typeof data.authorKey === 'string' ? data.authorKey : undefined) }
    } else if (data.type === 'guoling.authoring.pointer' || data.type === 'guoling.authoring.double-click') {
      const child = children.get(frame), matrix = child && frameMatrix(frame, child)
      if (matrix) (data.type === 'guoling.authoring.pointer' ? pointer : doubleClick)({ ...point(matrix, Number(data.x), Number(data.y)), ...(typeof data.authorKey === 'string' ? { authorKey: data.authorKey } : {}),
        ...(Number.isSafeInteger(data.caretOffset) && data.caretOffset >= 0 ? { caretOffset: data.caretOffset } : {}) })
    } else if (data.type === 'guoling.authoring.hover') {
      hover(typeof data.authorKey === 'string' ? data.authorKey : undefined)
    } else if (data.type === 'guoling.authoring.selection' && typeof data.authorKey === 'string'
      && Number.isSafeInteger(data.anchor) && data.anchor >= 0 && Number.isSafeInteger(data.focus) && data.focus >= 0) {
      selection({ authorKey: data.authorKey, anchor: data.anchor, focus: data.focus, ...(data.word === true ? { word: true } : {}) })
    } else if (data.type === 'guoling.authoring.status') {
      if (documentPath) parentMessage(data)
      else options.report?.(data.authorKey, data.status)
    }
  }
  const loaded = (event: Event) => {
    if (!(event.target instanceof HTMLIFrameElement) || !frames().includes(event.target)) return
    children.delete(event.target)
    for (const [id, request] of pending) if (request.frame === event.target) { request.resolve(); pending.delete(id) }
    sendState(event.target); enqueue()
  }
  const observer = new MutationObserver(records => {
    for (const record of records) if (record.type === 'attributes' && record.target instanceof HTMLIFrameElement && ['src', 'srcdoc'].includes(record.attributeName ?? '')) {
      children.delete(record.target)
      for (const [id, request] of pending) if (request.frame === record.target) { request.resolve(); pending.delete(id) }
    }
    prune(); enqueue()
  })
  const resize = new ResizeObserver(enqueue)
  let releaseCarriers: (() => void) | undefined
  const ready = () => {
    if (ended) return
    if (documentPath) consumer = factory(document.documentElement, { records: localRecords, scope,
      originalText: node => pageText()?.originalText(node), claimText: (node, text) => pageText()?.setLocalText(node, text),
      resolveResource: reference => options.resolveResource?.(reference, state.bindings) ?? resourceUrls()[state.bindings[reference] ?? reference] ?? reference,
      matchesResource: (reference, liveUrl) => options.matchesResource?.(reference, liveUrl, state.bindings) ?? false,
      resourceReference: url => Object.entries(state.bindings).find(([, id]) => resourceUrls()[id] === url)?.[0]
        ?? Object.entries(resourceUrls()).find(([, value]) => value === url)?.[0],
      onChange: enqueue, report: (authorKey, status) => parentMessage({ type: 'guoling.authoring.status', authorKey, status }) })
    releaseCarriers = options.blobCarriers?.()?.subscribe(frame => {
      children.delete(frame)
      for (const [id, request] of pending) if (request.frame === frame) { request.resolve(); pending.delete(id) }
      if (frames().includes(frame)) sendState(frame)
      enqueue()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    resize.observe(document.documentElement)
    document.fonts.addEventListener('loadingdone', enqueue)
    update()
    if (documentPath) parentMessage({ type: 'guoling.authoring.ready' })
  }
  const dblclick = (event: MouseEvent) => { if (state.observe) doubleClick({ x: event.clientX, y: event.clientY, authorKey: consumer?.hit(event.clientX, event.clientY)?.authorKey }) }
  const dispose = () => {
    if (ended) return
    ended = true; consumer?.dispose(); observer.disconnect(); resize.disconnect(); children.clear()
    releaseCarriers?.()
    releaseInput?.()
    for (const request of pending.values()) request.resolve()
    pending.clear(); window.removeEventListener('message', receive); window.removeEventListener('load', loaded, true)
    window.removeEventListener('scroll', enqueue, true); window.removeEventListener('resize', enqueue)
    document.removeEventListener('DOMContentLoaded', ready); document.removeEventListener('dblclick', dblclick, true)
    document.fonts.removeEventListener('loadingdone', enqueue); window.removeEventListener('pagehide', dispose)
  }
  window.addEventListener('message', receive); window.addEventListener('load', loaded, true)
  window.addEventListener('scroll', enqueue, true); window.addEventListener('resize', enqueue)
  if (documentPath) document.addEventListener('dblclick', dblclick, true)
  window.addEventListener('pagehide', dispose, { once: true })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready()
  return { update, reports, hit, preview, input, dispose, pointer }
}
