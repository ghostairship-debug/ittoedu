import type { createDomAuthoring, DomAuthorObservation } from './authoringDom'
import type { ComponentAuthorGeometryObservation } from '../../shared/contracts/component-platform/runtime'
import { createAuthoringFrameGeometry } from './authoringFrame'

type Authoring = ReturnType<typeof createDomAuthoring>
type Options = Parameters<typeof createDomAuthoring>[1] & { onDocumentsChanged?(): void }
export interface NestedDomAuthoring extends Authoring {
  documents(): Document[]
  rect(node: Node): { x: number; y: number; width: number; height: number }
  /** One synchronous observation batch. Never retain viewport facts across an await or later layout. */
  withReadScope<Value>(read: () => Value): Value
}

/** Compose the existing DOM adapter across accessible local document carriers.
 * Keep runtime dependencies inside: saved ordinary HTML embeds this function. */
export function createNestedDomAuthoring(root: HTMLElement, factory: typeof createDomAuthoring, options: Options,
  frameFactory: typeof createAuthoringFrameGeometry = createAuthoringFrameGeometry): NestedDomAuthoring {
  type Matrix = ComponentAuthorGeometryObservation['parentToInstance']
  type Entry = { document: Document; root: HTMLElement; frame?: HTMLIFrameElement; scope: string; adapter: Authoring }
  const entryDocument = root.ownerDocument
  const frameFacts = frameFactory()
  const entries = new Map<Document, Entry>()
  const frames = new Set<HTMLIFrameElement>()
  let disposed = false, syncing = false, queued = false, observationActive = true, dirty = false
  let explicitActive = true, runtimeActive = true
  let readScope: { frames: Map<HTMLIFrameElement, Matrix | undefined>; documents: Map<Document, Matrix | undefined> } | undefined
  const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
  const identity = (): Matrix => [1, 0, 0, 1, 0, 0]
  const absolute = (value: string, base: string) => { try { return new URL(value, base).href } catch { return value } }
  // Child image addresses are persisted relative to the entry, never the lease URL.
  const reference = (value: string, document: Document) => {
    try {
      const target = new URL(value, document.baseURI), base = new URL(entryDocument.baseURI)
      if (target.protocol !== base.protocol || target.host !== base.host || !target.pathname.startsWith('/')) return target.href
      const directory = base.pathname.split('/'); directory.pop()
      const destination = target.pathname.split('/')
      while (directory.length && destination.length && directory[0] === destination[0]) { directory.shift(); destination.shift() }
      return `${'../'.repeat(directory.length)}${destination.join('/')}${target.search}${target.hash}`
    } catch { return value }
  }
  const frameIdentity = (frame: HTMLIFrameElement) => {
    const siblings = [...frame.ownerDocument.querySelectorAll('iframe')]
    if (frame.id && siblings.filter(value => value.id === frame.id).length === 1) return `id:${encodeURIComponent(frame.id)}`
    if (frame.name && siblings.filter(value => value.name === frame.name).length === 1) return `name:${encodeURIComponent(frame.name)}`
    const parts: string[] = []
    for (let node: Element | null = frame; node?.parentElement; node = node.parentElement)
      parts.unshift(`${node.localName}:${[...node.parentElement.children].indexOf(node)}`)
    return parts.join('/')
  }
  const changed = () => {
    dirty = true
    if (queued || disposed || !observationActive) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!disposed && observationActive && dirty) { dirty = false; sync(); options.onChange?.() }
    })
  }
  const updateActive = () => {
    const value = explicitActive && runtimeActive
    if (disposed || observationActive === value) return
    observationActive = value
    for (const entry of entries.values()) entry.adapter.setActive(value)
    // A hidden child may have navigated without an active observation callback.
    // Reconcile that document set once on return, rather than on every mutation.
    if (value) changed()
  }
  const setActive = (value: boolean) => { explicitActive = value; updateActive() }
  const create = (document: Document, localRoot: HTMLElement, frame?: HTMLIFrameElement, scope = ''): Entry => {
    const adapter = factory(localRoot, { ...options,
      scope: { ...options.scope, ...(scope ? { 'html:frame': scope } : {}) },
      ...(frame ? {
        resourceReference: (value: string) => options.resourceReference?.(value) ?? reference(value, document),
        resolveResource: (value: string) => options.resolveResource?.(value) ?? absolute(value, entryDocument.baseURI),
        matchesResource: (value: string, live: string) => options.matchesResource?.(value, live)
          || absolute(value, entryDocument.baseURI) === absolute(live, document.baseURI),
      } : {}),
      onChange: changed,
    })
    adapter.setActive(observationActive)
    return { document, root: localRoot, frame, scope, adapter }
  }
  function sync(): void {
    if (disposed || syncing || readScope) return
    syncing = true
    let changedDocuments = false
    try {
      const seenDocuments = new Set<Document>(), seenFrames = new Set<HTMLIFrameElement>()
      const visit = (document: Document, localRoot: HTMLElement, frame?: HTMLIFrameElement, scope = '') => {
        if (seenDocuments.has(document)) return
        seenDocuments.add(document)
        let entry = entries.get(document)
        if (entry && (entry.root !== localRoot || entry.scope !== scope)) { entry.adapter.dispose(); entries.delete(document); entry = undefined }
        if (!entry) { entry = create(document, localRoot, frame, scope); entries.set(document, entry); changedDocuments = true }
        for (const child of localRoot.querySelectorAll<HTMLIFrameElement>('iframe')) {
          seenFrames.add(child)
          if (!frames.has(child)) { frames.add(child); child.addEventListener('load', changed) }
          try {
            const nested = child.contentDocument
            if (!nested?.documentElement) continue
            const source = child.getAttribute('src')
            const childScope = `${scope}/${frameIdentity(child)}${source ? `@${reference(source, document)}` : ''}`
            visit(nested, nested.documentElement, child, childScope)
          } catch { /* Foreign/opaque documents remain outside this content adapter. */ }
        }
      }
      visit(entryDocument, root)
      for (const [document, entry] of entries) if (!seenDocuments.has(document)) {
        entry.adapter.dispose(); entries.delete(document); changedDocuments = true
      }
      for (const frame of frames) if (!seenFrames.has(frame)) { frame.removeEventListener('load', changed); frames.delete(frame) }
    } finally { syncing = false }
    if (changedDocuments) options.onDocumentsChanged?.()
  }
  const measureFrameMatrix = (frame: HTMLIFrameElement): Matrix | undefined => {
    if (!entries.get(frame.ownerDocument)?.adapter.visible(frame)) return undefined
    return frameFacts.frameMatrix(frame)
  }
  const frameMatrix = (frame: HTMLIFrameElement): Matrix | undefined => {
    if (readScope?.frames.has(frame)) return readScope.frames.get(frame)
    const value = measureFrameMatrix(frame)
    readScope?.frames.set(frame, value)
    return value
  }
  const toEntry = (document: Document): Matrix | undefined => {
    if (readScope?.documents.has(document)) return readScope.documents.get(document)
    let value: Matrix | undefined
    if (document === entryDocument) value = identity()
    else {
      const frame = entries.get(document)?.frame
      if (frame) {
        const parent = toEntry(frame.ownerDocument), local = frameMatrix(frame)
        value = parent && local ? multiply(parent, local) : undefined
      }
    }
    readScope?.documents.set(document, value)
    return value
  }
  const withReadScope = <Value,>(read: () => Value): Value => {
    if (readScope) return read()
    sync()
    readScope = { frames: new Map(), documents: new Map() }
    try { return read() } finally { readScope = undefined }
  }
  const contains = (scope: Node, node: Node): boolean => {
    if (scope === node || scope.contains(node)) return true
    const carrier = node.getRootNode() as ShadowRoot
    return Boolean(carrier.host && contains(scope, carrier.host))
  }
  const geometry = (node: Node): ComponentAuthorGeometryObservation | undefined => {
    const local = entries.get(node.ownerDocument!)?.adapter.geometry(node), matrix = toEntry(node.ownerDocument!)
    return local && matrix ? { ...local, parentToInstance: multiply(matrix, local.parentToInstance) } : undefined
  }
  const observation = (value: DomAuthorObservation | null | undefined): DomAuthorObservation | null => {
    if (!value) return null
    const matrix = toEntry(value.node.ownerDocument!)
    return { ...value, ...(value.geometry ? { geometry: geometry(value.node) } : {}),
      ...(value.textStyle && matrix ? { textStyle: frameFacts.transformTextStyle(value.textStyle, matrix) } : {}) }
  }
  const rect = (node: Node) => {
    const document = node.ownerDocument!, matrix = toEntry(document)
    const local = node.nodeType === 1 ? (node as Element).getBoundingClientRect() : (() => {
      const range = document.createRange(); range.selectNodeContents(node); const value = range.getBoundingClientRect(); range.detach(); return value
    })()
    if (!matrix) return { x: 0, y: 0, width: 0, height: 0 }
    const points = [[local.left, local.top], [local.right, local.top], [local.left, local.bottom], [local.right, local.bottom]]
      .map(([x, y]) => ({ x: matrix[0] * x! + matrix[2] * y! + matrix[4], y: matrix[1] * x! + matrix[3] * y! + matrix[5] }))
    const xs = points.map(point => point.x), ys = points.map(point => point.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  const activity = (event: Event) => {
    const value = (event as CustomEvent<{ active: boolean; visible: boolean }>).detail
    if (value && typeof value.active === 'boolean' && typeof value.visible === 'boolean') { runtimeActive = value.active && value.visible; updateActive() }
  }
  const win = entryDocument.defaultView!
  win.addEventListener('__runtime.activity', activity)
  const initialActivity = (win as Window & { __guolingRuntimeActivity?: { active: boolean; visible: boolean } }).__guolingRuntimeActivity
  if (initialActivity) { runtimeActive = initialActivity.active && initialActivity.visible; updateActive() }
  sync()
  return {
    setActive,
    withReadScope,
    targets(scope?: Node) {
      sync()
      if (!scope) return [...entries.values()].flatMap(entry => entry.adapter.targets())
      const owner = scope.nodeType === 9 ? scope as Document : scope.ownerDocument
      const entry = owner && entries.get(owner)
      if (!entry) return []
      if (scope !== owner && !contains(entry.root, scope)) return []
      const result = entry.adapter.targets(scope === owner ? entry.root : scope)
      for (const nested of entries.values()) {
        let frame = nested.frame
        while (frame) {
          if (frame.ownerDocument === owner) {
            if (contains(scope, frame)) result.push(...nested.adapter.targets())
            break
          }
          frame = entries.get(frame.ownerDocument)?.frame
        }
      }
      return result
    },
    documents() { sync(); return [...entries.keys()] },
    roots() { sync(); return [...entries.values()].flatMap(entry => entry.adapter.roots()) },
    visible(node) { return withReadScope(() => Boolean(node.ownerDocument && toEntry(node.ownerDocument) && entries.get(node.ownerDocument)?.adapter.visible(node))) },
    refresh() { sync(); for (const entry of entries.values()) entry.adapter.refresh() },
    describe(node) { return withReadScope(() => observation(entries.get(node.ownerDocument!)?.adapter.describe(node))) },
    geometry(node) { return withReadScope(() => geometry(node)) },
    textStyle(node) { return withReadScope(() => {
      const style = entries.get(node.ownerDocument!)?.adapter.textStyle(node), matrix = toEntry(node.ownerDocument!)
      return style && matrix ? frameFacts.transformTextStyle(style, matrix) : style
    }) },
    suppressText(target?: string | Node) { sync(); for (const entry of entries.values()) entry.adapter.suppressText(typeof target === 'string' || target?.ownerDocument === entry.document ? target : undefined) },
    rect,
    scan() { sync(); return withReadScope(() => [...entries.values()].flatMap(entry => toEntry(entry.document) ? entry.adapter.scan().map(value => observation(value)!) : [])) },
    previewGeometry(authorKey, value) { sync(); for (const entry of entries.values()) entry.adapter.previewGeometry(authorKey, value) },
    paintedElementAt(x, y) { sync(); return entries.get(entryDocument)?.adapter.paintedElementAt(x, y) },
    hit(x, y) {
      sync()
      let entry = entries.get(entryDocument)
      while (entry) {
        const matrix = toEntry(entry.document)
        if (!matrix) return undefined
        const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
        if (!determinant) return undefined
        const px = x - matrix[4], py = y - matrix[5]
        const local = { x: (matrix[3] * px - matrix[2] * py) / determinant, y: (-matrix[1] * px + matrix[0] * py) / determinant }
        const top = entry.adapter.paintedElementAt(local.x, local.y)
        const child = [...entries.values()].find(candidate => candidate.frame === top)
        if (child) { entry = child; continue }
        return observation(entry.adapter.hit(local.x, local.y)) ?? undefined
      }
      return undefined
    },
    dispose() {
      if (disposed) return
      disposed = true
      win.removeEventListener('__runtime.activity', activity)
      for (const frame of frames) frame.removeEventListener('load', changed)
      for (const entry of entries.values()) entry.adapter.dispose()
      frames.clear(); entries.clear()
    },
  }
}
