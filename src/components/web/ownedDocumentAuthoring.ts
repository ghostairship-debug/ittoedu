import type { createDomAuthoring } from './authoringDom'
import type { ComponentAuthorGeometry, ComponentAuthorGeometryObservation, ComponentAuthorRecord, ComponentAuthorSpotInput } from '../../shared/contracts/component-platform/runtime'
import type { DomTextOverrideController } from '../../player/lightEdit/domTextOverrides'

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
  bindings?(): Readonly<Record<string, string>>
  activity?(): { active: boolean; visible: boolean; playing: boolean } | undefined
  refreshResources?(root: Document, resources: Record<string, string>, bindings: Readonly<Record<string, string>>): void
  observe?: boolean
  onChange?(): void
  onDoubleClick?(point: { x: number; y: number; authorKey?: string }): void
  report?(authorKey: string, status: 'bound' | 'unmounted' | 'unresolved'): void
} = {}) {
  type Matrix = ComponentAuthorGeometryObservation['parentToInstance']
  type State = { records: Record<string, ComponentAuthorRecord>; resources: Record<string, string>; bindings: Readonly<Record<string, string>>; observe: boolean }
  type Child = { reports: OwnedAuthorReport[]; width: number; height: number }
  let state: State = { records: {}, resources: {}, bindings: {}, observe: false }
  let ended = false, queued = false, consumer: ReturnType<typeof factory> | undefined, sequence = 0
  const initialPendingPath = options.pendingPath ?? (documentPath.includes('pending:') ? documentPath : undefined)
  const scope = documentPath ? { 'document:path': documentPath } : undefined
  const children = new Map<HTMLIFrameElement, Child>()
  const pending = new Map<number, { frame: HTMLIFrameElement; resolve(value?: string): void }>()
  const frames = () => [...document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')]
  const post = (frame: HTMLIFrameElement, value: object) => frame.contentWindow?.postMessage({ ...value, token }, '*')
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
    const rect = frame.getBoundingClientRect(), css = getComputedStyle(frame), number = (value: string) => parseFloat(value) || 0
    if (css.display === 'none' || css.visibility === 'hidden' || !rect.width || !rect.height || !child.width || !child.height) return
    const paddingX = number(css.paddingLeft) + number(css.paddingRight), paddingY = number(css.paddingTop) + number(css.paddingBottom)
    const borderX = number(css.borderLeftWidth) + number(css.borderRightWidth), borderY = number(css.borderTopWidth) + number(css.borderBottomWidth)
    const width = number(css.width) + (css.boxSizing === 'border-box' ? 0 : paddingX + borderX)
    const height = number(css.height) + (css.boxSizing === 'border-box' ? 0 : paddingY + borderY)
    if (!(width > 0 && height > 0)) return
    let linear: Matrix = [1, 0, 0, 1, 0, 0]
    for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      const transform = new DOMMatrix(style.transform === 'none' ? undefined : style.transform)
      if (!transform.is2D) return
      const rotate = style.rotate && style.rotate !== 'none' ? /^(?:z\s+)?(-?[\d.]+)(deg|rad|turn)$/.exec(style.rotate) : undefined
      if (style.rotate && style.rotate !== 'none' && !rotate) return
      const angle = rotate ? Number(rotate[1]) * (rotate[2] === 'deg' ? Math.PI / 180 : rotate[2] === 'turn' ? Math.PI * 2 : 1) : 0
      const scale = style.scale && style.scale !== 'none' ? style.scale.split(/\s+/).map(Number) : [1, 1]
      if (scale.some(value => !Number.isFinite(value)) || scale.length > 2) return
      const zoom = number(style.zoom) || 1, x = scale[0]! * zoom, y = (scale[1] ?? scale[0])! * zoom
      linear = multiply(multiply([Math.cos(angle) * x, Math.sin(angle) * x, -Math.sin(angle) * y, Math.cos(angle) * y, 0, 0],
        [transform.a, transform.b, transform.c, transform.d, 0, 0]), linear)
    }
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => point(linear, x!, y!))
    linear[4] = rect.left - Math.min(...corners.map(value => value.x)); linear[5] = rect.top - Math.min(...corners.map(value => value.y))
    return multiply(linear, [(width - borderX - paddingX) / child.width, 0, 0, (height - borderY - paddingY) / child.height,
      number(css.borderLeftWidth) + number(css.paddingLeft), number(css.borderTopWidth) + number(css.paddingTop)])
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
          rect: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } })
      }
    }
    return result
  }
  const publish = () => {
    if (ended) return
    if (documentPath) parent.postMessage({ type: 'guoling.authoring.observe', token, reports: reports(), width: innerWidth, height: innerHeight }, '*')
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
    if (documentPath) options.refreshResources?.(document, state.resources, state.bindings)
    consumer?.refresh()
    for (const frame of frames()) sendState(frame)
    enqueue()
  }
  const hit = async (x: number, y: number): Promise<string | undefined> => {
    if (ended || !state.observe) return
    const top = document.elementsFromPoint(x, y)[0]
    if (top instanceof HTMLIFrameElement && top.hasAttribute('srcdoc')) {
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
  const doubleClick = (value: { x: number; y: number; authorKey?: string }) => {
    if (documentPath) parent.postMessage({ type: 'guoling.authoring.double-click', token, ...value }, '*')
    else options.onDoubleClick?.(value)
  }
  const receive = (event: MessageEvent) => {
    const data = event.data
    if (ended || data?.token !== token) return
    if (documentPath && event.source === parent) {
      if (data.type === 'guoling.authoring.update' && data.state) { state = data.state; update() }
      else if (data.type === 'guoling.authoring.hit') void hit(Number(data.x), Number(data.y)).then(authorKey => {
        if (!ended) parent.postMessage({ type: 'guoling.authoring.hit-result', token, requestId: data.requestId, authorKey }, '*')
      })
      else if (data.type === 'guoling.authoring.preview') preview(data.authorKey, data.geometry)
      return
    }
    const frame = frames().find(frame => frame.contentWindow === event.source)
    if (!frame) return
    if (data.type === 'guoling.authoring.ready') sendState(frame)
    else if (data.type === 'guoling.authoring.observe' && Array.isArray(data.reports)) {
      children.set(frame, { reports: data.reports, width: data.width, height: data.height }); enqueue()
    } else if (data.type === 'guoling.authoring.hit-result') {
      const request = pending.get(data.requestId)
      if (request?.frame === frame) { pending.delete(data.requestId); request.resolve(typeof data.authorKey === 'string' ? data.authorKey : undefined) }
    } else if (data.type === 'guoling.authoring.double-click') {
      const child = children.get(frame), matrix = child && frameMatrix(frame, child)
      if (matrix) doubleClick({ ...point(matrix, Number(data.x), Number(data.y)), ...(typeof data.authorKey === 'string' ? { authorKey: data.authorKey } : {}) })
    } else if (data.type === 'guoling.authoring.status') {
      if (documentPath) parent.postMessage(data, '*')
      else options.report?.(data.authorKey, data.status)
    }
  }
  const loaded = (event: Event) => {
    if (!(event.target instanceof HTMLIFrameElement) || !event.target.hasAttribute('srcdoc')) return
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
  const ready = () => {
    if (ended) return
    if (documentPath) consumer = factory(document.documentElement, { records: localRecords, scope,
      originalText: node => pageText()?.originalText(node), claimText: (node, text) => pageText()?.setLocalText(node, text),
      resolveResource: reference => state.resources[state.bindings[reference] ?? reference] ?? reference,
      resourceReference: url => Object.entries(state.bindings).find(([, id]) => state.resources[id] === url)?.[0],
      onChange: enqueue, report: (authorKey, status) => parent.postMessage({ type: 'guoling.authoring.status', token, authorKey, status }, '*') })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    resize.observe(document.documentElement)
    document.fonts.addEventListener('loadingdone', enqueue)
    update()
    if (documentPath) parent.postMessage({ type: 'guoling.authoring.ready', token }, '*')
  }
  const dblclick = (event: MouseEvent) => { if (state.observe) doubleClick({ x: event.clientX, y: event.clientY, authorKey: consumer?.hit(event.clientX, event.clientY)?.authorKey }) }
  const dispose = () => {
    if (ended) return
    ended = true; consumer?.dispose(); observer.disconnect(); resize.disconnect(); children.clear()
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
  return { update, reports, hit, preview, dispose }
}
