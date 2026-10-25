import { createDomAuthoring, domAuthoringFactorySource } from '../../components/web/authoringDom'
import { installHtmlBlobCapture, type HtmlBlobCaptureEntry } from '../../components/web/htmlBlobCapture'
import { installAuthoringInputArbitration, authoringCaretOffset } from '../../components/web/ownedDocumentAuthoring'
import { createAuthoringFrameGeometry } from '../../components/web/authoringFrame'
import type { ComponentAuthorRecord, ComponentAuthorScope } from '../contracts/component-platform/runtime'
import type { HtmlPreviewRequest } from '../workbench/htmlPreview'
import { decodeHtmlEntities, indexHtmlElements, scanHtmlSource } from './htmlSourceScanner'
import { mapSrcsetUrls } from './responsiveImage'

type HtmlPreviewTargetReport = Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }>['targets'][number]

export type HtmlFrameSources = Record<string, { html: string; base: string; resources?: Record<string, string> }>
export type HtmlFrameTargetEvent = { event: 'targets' | 'edit-targets'; targets: HtmlPreviewTargetReport[]; intent?: 'select' | 'edit' }
  | { event: 'selection'; handle: string; anchor: number; focus: number; word?: boolean }
  | { event: 'gesture'; handle: string; phase: 'start' | 'update' | 'end' | 'cancel'; pointerId: number; x: number; y: number; shift: boolean; alt: boolean }
export interface HtmlFrameAuthoringBridge {
  setRecords(records: Record<string, ComponentAuthorRecord>): void
  setSources(sources: HtmlFrameSources): void
  setEditMode(enabled: boolean): void
  setVisibility(active: boolean): void
  refresh(): void
  confirm(handles: string[], scanId?: string): void
  select(handle: string | null, editable: boolean, editing?: boolean): void
  previewGeometry(authorKey: string, geometry: ComponentAuthorRecord['overrides']['geometry'] | null): void
  isRemoteHandle(handle: string): boolean
  onTargets(listener: (event: HtmlFrameTargetEvent) => void): () => void
  shadowRoot(host: Element): ShadowRoot | null | undefined
  resourceReference(value: string, relativeBase?: string): string | undefined
  resolveResource(value: string): string | undefined
  matchesResource(reference: string, live: string, relativeBase?: string): boolean
  controlState?(): { editMode: boolean; visible: boolean }
  dispose(): void
}

/** Select only the static source ancestors needed to replay this target. */
export function neededHtmlFrameSources(scope: ComponentAuthorScope | undefined, available: HtmlFrameSources): HtmlFrameSources {
  let references: string[] = []
  try { const value = JSON.parse(scope?.['html:sources'] ?? '[]'); if (Array.isArray(value)) references = value.filter((item): item is string => typeof item === 'string') } catch { /* Previous local-only records use the frame path below. */ }
  if (!references.length && scope?.['html:frame']) references = Object.keys(available).filter(key => scope['html:frame']!.includes(`@${key}`))
  const entity = (value: string) => { try { return decodeURIComponent(value.split(/[?#]/, 1)[0]!) } catch { return value.split(/[?#]/, 1)[0]! } }
  return Object.fromEntries(references.flatMap(reference => {
    const key = Object.hasOwn(available, reference) ? reference : Object.keys(available).find(key => entity(key) === entity(reference))
    return key ? [[reference, available[key]!]] : []
  }))
}

/** The bridge runs with page privileges only. Its source is also embedded in saved HTML. */
export function installHtmlFrameAuthoring(factory: typeof createDomAuthoring, targetDocument: Document = document,
  inputFactory: typeof installAuthoringInputArbitration = installAuthoringInputArbitration, replaceExisting = false,
  captureFactory: typeof installHtmlBlobCapture = installHtmlBlobCapture,
  frameFactory: typeof createAuthoringFrameGeometry = createAuthoringFrameGeometry,
  caretFactory: typeof authoringCaretOffset = authoringCaretOffset): HtmlFrameAuthoringBridge {
  const win = targetDocument.defaultView as Window & typeof globalThis & { __cwHtmlFrameAuthoring?: HtmlFrameAuthoringBridge }
  const previous = win.__cwHtmlFrameAuthoring
  if (previous && !replaceExisting) return previous
  const initialControl = previous?.controlState?.()
  previous?.dispose()
  const doc = targetDocument, protocol = 'cw-html-frame-authoring', roots = new WeakMap<Element, ShadowRoot>()
  const listeners = new Set<(event: HtmlFrameTargetEvent) => void>()
  const frameGeometry = frameFactory()
  const children = new Map<HTMLIFrameElement, { route: string; source: string; sources: string[]; ready: boolean; aliasesSent?: boolean; token?: string; deltaState?: boolean; recordsVersion?: number; sourcesVersion?: number }>()
  const remoteHandles = new Set<string>(), handles = new WeakMap<Node, string>(), nodes = new Map<string, Node>()
  const selectedRoots = new Map<EventTarget, () => void>()
  const navigation = new WeakMap<HTMLIFrameElement, number>()
  const frameSources = new WeakMap<HTMLIFrameElement, string>()
  const replayUrls = new Map<HTMLIFrameElement, { current?: string; retired: Set<string>; connected: boolean }>()
  let records: Record<string, ComponentAuthorRecord> = {}, sources: HtmlFrameSources = {}
  let recordsVersion = 0, sourcesVersion = 0
  let aliasesRead = false, aliasesInherited = false
  const urlAliases = new Map<string, string>(), aliasUrls = new Map<string, string>()
  const fileAliases = new Map<string, string>(), fileUrls = new Map<string, string>()
  let route = '', sourceChain: string[] = [], base = doc.baseURI, observe = false, editMode = initialControl?.editMode ?? false, visible = initialControl?.visible ?? true
  let adapter: ReturnType<typeof createDomAuthoring> | undefined, disposed = false, scanQueued = false, childrenDirty = false, serial = 0, selected: string | null = null
  let marker: HTMLDivElement | undefined, confirmationScan: string | undefined
  let editingHandle: string | null = null
  let cursorSheet: CSSStyleSheet | undefined, currentCursor = ''
  const cursor = (value: string) => {
    if (value === currentCursor || !('adoptedStyleSheets' in doc) || !win.CSSStyleSheet?.prototype.replaceSync) return
    if (!cursorSheet) { cursorSheet = new win.CSSStyleSheet(); doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, cursorSheet] }
    currentCursor = value; cursorSheet.replaceSync(value ? `html,body,body *{cursor:${value}!important}` : '')
  }
  const confirmed = new Set<string>()
  let selectingText: { node: Node; handle: string; anchor: number } | undefined
  let pointerTarget: { handle: string; pointerId: number } | undefined
  const pausedMedia = new Set<HTMLMediaElement>(), pausedAnimations = new Set<Animation>()
  const token = Math.random().toString(36).slice(2)
  const restore: Array<() => void> = []
  const absolute = (value: string, relativeBase = base) => { try { return new URL(value, relativeBase).href } catch { return value } }
  const fileKey = (value: string) => { const path = value.split(/[?#]/, 1)[0]!; try { return decodeURIComponent(path) } catch { return path } }
  const readAliases = () => {
    if (aliasesRead || aliasesInherited) return
    const element = doc.getElementById('course-data')
    // The bootstrap precedes the data script. Absence while parsing is not a
    // result: the first resource observation/child handshake reads it lazily.
    if (!element) { if (doc.readyState !== 'loading') aliasesRead = true; return }
    if (element.localName !== 'script' || element.getAttribute('type')?.trim().toLowerCase() !== 'application/json') { aliasesRead = true; return }
    try {
      // Export bootstrap retains the decoded payload on its existing data
      // element; avoid serializing a second full copy merely for author aliases.
      const decoded = (element as HTMLElement & { __courseDecodedPayload?: any }).__courseDecodedPayload
      if (!decoded && doc.getElementById('course-resource-pool')) return // file:// byte preparation may still be pending.
      const value = decoded ?? JSON.parse(element.textContent ?? '')
      aliasesRead = true
      if (!['compiled-course-v1', 'compiled-course-v2'].includes(value?.format) || !value.course?.assets || typeof value.course.assets !== 'object' || Array.isArray(value.course.assets)) return
      for (const id of Object.keys(value.course.assets).sort()) {
        const url = value.course.assets[id]?.url
        if (typeof url !== 'string') continue
        const data = /^data:((?:image|audio|video|font)\/[^,;]+|application\/(?:font-woff|vnd\.ms-fontobject))(?:;[^,]*)?;base64,/i.test(url)
        const projected = /^courseware-preview:\/\/[^/]+\/[^/]+\/_embedded\/asset-/i.test(url)
        if ((!data && !projected) || urlAliases.has(url)) continue
        const alias = `cw-resource:${id}`
        urlAliases.set(url, alias); aliasUrls.set(alias, url)
      }
    } catch { if (doc.readyState !== 'loading') aliasesRead = true /* An incomplete parser-owned script can be read on its first later observation. */ }
  }
  const resourceReference = (value: string, relativeBase = doc.baseURI) => {
    readAliases()
    const reference = entryReference(value, relativeBase), key = fileUrls.has(reference) ? reference : fileKey(reference)
    return urlAliases.get(value) ?? urlAliases.get(absolute(value, relativeBase)) ?? fileAliases.get(value) ?? (fileUrls.has(key) ? key : undefined)
  }
  const resolveResource = (value: string) => { readAliases(); return aliasUrls.get(value) ?? fileUrls.get(value) ?? fileUrls.get(fileKey(value)) }
  const matchesResource = (reference: string, live: string, relativeBase = doc.baseURI) => {
    const expected = resolveResource(reference)
    return expected !== undefined && (expected === live || expected === absolute(live, relativeBase)
      || fileUrls.has(fileKey(reference)) && fileKey(entryReference(live, relativeBase)) === fileKey(reference))
  }
  const entryReference = (value: string, relativeBase = doc.baseURI) => {
    try {
      const url = new URL(value, relativeBase), entry = new URL(base)
      if (url.protocol !== entry.protocol || url.host !== entry.host || !url.pathname.startsWith('/')) return url.href
      const directory = entry.pathname.split('/'); directory.pop(); const destination = url.pathname.split('/')
      while (directory.length && destination.length && directory[0] === destination[0]) { directory.shift(); destination.shift() }
      return `${'../'.repeat(directory.length)}${destination.join('/')}${url.search}${url.hash}`
    } catch { return value }
  }
  const registerResources = () => {
    fileAliases.clear(); fileUrls.clear()
    for (const source of Object.values(sources)) for (const key of Object.keys(source.resources ?? {}).sort()) {
      const value = source.resources![key]!
      fileUrls.set(key, value); if (!fileAliases.has(value)) fileAliases.set(value, key)
    }
  }
  const localRect = (node: Node) => {
    const bounds = node.nodeType === 1 ? (node as Element).getBoundingClientRect() : (() => {
      const range = doc.createRange(); range.selectNodeContents(node); const value = range.getBoundingClientRect(); range.detach(); return value
    })()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
  const allRoots = (): Array<Document | ShadowRoot> => {
    const result: Array<Document | ShadowRoot> = [doc]
    for (let i = 0; i < result.length; i++) for (const host of result[i]!.querySelectorAll('*')) {
      const shadow = roots.get(host) ?? host.shadowRoot
      if (shadow && !result.includes(shadow)) result.push(shadow)
    }
    return result
  }
  const allFrames = () => allRoots().flatMap(root => [...root.querySelectorAll<HTMLIFrameElement>('iframe')])
  const pauseActivity = () => {
    for (const root of allRoots()) {
      for (const media of root.querySelectorAll<HTMLMediaElement>('audio,video')) if (!media.paused) { pausedMedia.add(media); media.pause() }
      for (const animation of root.getAnimations?.() ?? []) if (animation.playState === 'running') { pausedAnimations.add(animation); animation.pause() }
    }
  }
  const activity = () => { if (!visible) pauseActivity() }
  const setVisible = (value: boolean) => {
    const previous = visible; visible = value
    adapter?.setActive(value)
    if (!value) cursor('')
    if (!value) adapter?.suppressText()
    else adapter?.suppressText(editingHandle ? nodes.get(editingHandle) : undefined)
    if (!visible) pauseActivity()
    else if (!previous) {
      for (const media of pausedMedia) if (media.isConnected) void media.play().catch(() => undefined)
      for (const animation of pausedAnimations) if (animation.playState === 'paused') animation.play()
      pausedMedia.clear(); pausedAnimations.clear()
      if (childrenDirty) { childrenDirty = false; syncChildren() }
      schedule()
    }
  }
  const framePath = (frame: HTMLIFrameElement) => {
    const parts: string[] = []
    for (let node: Element | null = frame; node;) {
      const parent: Element | null = node.parentElement
      const container: ParentNode = parent ?? node.getRootNode() as ParentNode
      parts.unshift(`${node.localName}:${[...container.children].indexOf(node)}`)
      if (parent) node = parent
      else { const shadow = node.getRootNode() as ShadowRoot; node = shadow.host ?? null; if (node) parts.unshift('#shadow-root') }
    }
    return parts.join('/')
  }
  const isFrame = (node: unknown): node is HTMLIFrameElement => Boolean(node && typeof node === 'object' && (node as Element).localName === 'iframe')
  const isImage = (node: unknown): node is HTMLImageElement => Boolean(node && typeof node === 'object' && (node as Element).localName === 'img')
  const emit = (event: 'targets' | 'edit-targets', targets: HtmlPreviewTargetReport[], intent?: 'select' | 'edit') => {
    if (disposed || !targets.length && event !== 'targets') return
    if (route) win.parent.postMessage({ protocol, type: 'targets', event, targets, ...(intent ? { intent } : {}) }, '*')
    else for (const listener of listeners) listener({ event, targets, ...(intent ? { intent } : {}) })
  }
  const emitSelection = (selection: { handle: string; anchor: number; focus: number; word?: boolean }) => {
    if (disposed) return
    if (route) win.parent.postMessage({ protocol, type: 'selection', ...selection }, '*')
    else for (const listener of listeners) listener({ event: 'selection', ...selection })
  }
  const emitGesture = (gesture: Omit<Extract<HtmlFrameTargetEvent, { event: 'gesture' }>, 'event'>) => {
    if (disposed) return
    if (route) win.parent.postMessage({ protocol, type: 'gesture', ...gesture }, '*')
    else for (const listener of listeners) listener({ event: 'gesture', ...gesture })
  }
  const childState = (frame: HTMLIFrameElement) => {
    const persisted = frame.getAttribute('data-cw-frame-source')
    let source = frameSources.get(frame) ?? persisted ?? frame.getAttribute('src') ?? ''
    if (/^(?:blob:|about:|data:)/i.test(source) || frame.hasAttribute('srcdoc') && !frame.hasAttribute('data-cw-frame-source')) source = ''
    else if (source) source = entryReference(source, persisted ? base : doc.baseURI)
    const path = `${route}/${framePath(frame)}${source ? `@${source}` : ''}`
    return { route: path, source, sources: [...sourceChain, ...(source ? [source] : [])], ready: false }
  }
  const sendState = (frame: HTMLIFrameElement) => {
    const state = children.get(frame)
    if (!state?.ready || !frame.contentWindow) return
    let accessible = false
    try { accessible = Boolean(frame.contentDocument?.documentElement) } catch { /* Opaque sandbox remains opaque. */ }
    readAliases()
    const aliases = !state.aliasesSent && aliasUrls.size ? Object.fromEntries(aliasUrls) : undefined
    if (aliases) state.aliasesSent = true
    const changedRecords = !state.deltaState || state.recordsVersion !== recordsVersion, changedSources = !state.deltaState || state.sourcesVersion !== sourcesVersion
    state.recordsVersion = recordsVersion; state.sourcesVersion = sourcesVersion
    frame.contentWindow.postMessage({ protocol, type: 'state', route: state.route, base, sourcesChain: state.sources,
      ...(changedRecords ? { records } : {}), ...(changedSources ? { sources } : {}),
      observe: !accessible, editMode, visible, ...(aliases ? { aliases } : {}) }, '*')
  }
  const broadcast = (type: string, values: Record<string, unknown> = {}) => {
    for (const [frame, state] of children) if (state.ready) frame.contentWindow?.postMessage({ protocol, type, ...values }, '*')
  }
  const report = (node: Node): HtmlPreviewTargetReport | undefined => {
    const value = adapter?.describe(node)
    if (!value) return undefined
    const bounds = localRect(node)
    if (!bounds.width || !bounds.height) return undefined
    let handle = handles.get(node)
    if (!handle) { handle = `html-frame-${token}-${++serial}`; handles.set(node, handle); nodes.set(handle, node) }
    const textStyle = adapter?.textStyle(node)
    return { handle, kind: value.record.kind, domPath: [], sectionOrder: null,
      rawText: isImage(node) ? node.getAttribute('src') ?? '' : node.nodeValue ?? '', attributeName: isImage(node) ? 'src' : null,
      rect: bounds, scriptCreated: true, authoring: { authorKey: value.authorKey, record: value.record }, bindingStatus: value.bindingStatus,
      geometry: adapter?.geometry(node), ...(textStyle ? { textStyle } : {}) }
  }
  const draw = () => {
    marker?.remove(); marker = undefined
    if (!editMode || !visible) return
    const root = doc.createElement('div'); root.dataset.htmlPreviewEditMarkers = ''
    root.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;'
    adapter?.withReadScope(() => { for (const handle of new Set([...confirmed, ...(selected ? [selected] : [])])) {
      if (handle === selected) continue // Selected chrome is drawn once by the workbench host.
      const node = nodes.get(handle)
      if (!node?.isConnected || !adapter?.painted(node)) continue
      const bounds = localRect(node), element = doc.createElement('div'), active = handle === selected
      element.style.cssText = `position:absolute!important;pointer-events:none!important;box-sizing:border-box!important;left:${bounds.x}px!important;top:${bounds.y}px!important;width:${bounds.width}px!important;height:${bounds.height}px!important;border:${active ? '2px solid #2563eb' : '1px dashed rgba(37,99,235,.55)'}!important;`
      root.append(element)
    } })
    if (root.childElementCount) { doc.documentElement.append(root); marker = root }
  }
  const scan = () => {
    scanQueued = false
    if (!adapter || !editMode || !visible || disposed) return
    attachEvents()
    const targets = adapter.scan().flatMap(value => { const target = report(value.node); return target ? [target] : [] })
    for (let start = 0; start < targets.length; start += 64) emit('edit-targets', targets.slice(start, start + 64))
    draw()
  }
  const schedule = () => {
    if (scanQueued || disposed || !visible || !editMode || !adapter) return
    scanQueued = true; win.requestAnimationFrame(scan)
  }
  const clicked = (event: Event, point?: { x: number; y: number }, intent: 'select' | 'edit' = event.type === 'dblclick' ? 'edit' : 'select') => {
    const pointer = event as MouseEvent
    if (!adapter || !editMode || !visible || pointer.button !== 0) return
    const x = point?.x ?? pointer.clientX, y = point?.y ?? pointer.clientY
    const node = adapter.hit(x, y)?.node
    const value = node && report(node)
    if (!value) { selected = null; emit('targets', [], 'select'); return }
    const offset = node && caretFactory(doc, node, x, y)
    selectingText = node && offset !== undefined ? { node, handle: value.handle, anchor: offset } : undefined
    if (offset !== undefined) value.selection = { anchor: offset, focus: offset, ...(intent === 'edit' ? { word: true } : {}) }
    selected = value.handle; draw()
    emit('targets', [value], intent)
    event.preventDefault(); event.stopImmediatePropagation()
  }
  // Accessible child documents keep the top preview's author target owner;
  // opaque children report through their existing local adapter and bridge.
  const releaseInput = inputFactory(doc, {
    editing: () => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      return !disposed && (owner ? owner.editing() : editMode && visible)
    },
    select: (point, event) => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) owner.select(point, event)
      else clicked(event, point, 'select')
    },
    edit: (point, event) => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) owner.edit?.(point, event)
      else clicked(event, point, 'edit')
    },
    contentEditing: (point, event) => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) return owner.contentEditing?.(point, event) ?? false
      return Boolean(editingHandle && nodes.get(editingHandle) === adapter?.hit?.(point.x, point.y)?.node)
    },
    gesture: (point, event, phase) => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) { owner.gesture?.(point, event, phase); return }
      if (phase === 'start') {
        const node = selected ? nodes.get(selected) : undefined, value = node ? report(node) : undefined
        pointerTarget = value?.geometry && value.authoring ? { handle: value.handle, pointerId: (event as PointerEvent).pointerId ?? 0 } : undefined
      }
      if (!pointerTarget) return
      emitGesture({ ...pointerTarget, phase, x: point.x, y: point.y,
        shift: (event as MouseEvent).shiftKey === true, alt: (event as MouseEvent).altKey === true })
      if (phase === 'end' || phase === 'cancel') pointerTarget = undefined
    },
    hover: point => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) { owner.hover?.(point); return }
      const node = adapter?.hit?.(point.x, point.y)?.node, handle = node && handles.get(node)
      cursor(node && handle !== editingHandle && adapter?.geometry(node) ? 'move' : handle === editingHandle ? 'text' : 'default')
    },
    extend: (point, event) => {
      const owner = (win as Window & { __cwHtmlPreviewInputOwner?: Parameters<typeof inputFactory>[1] }).__cwHtmlPreviewInputOwner
      if (owner?.editing()) owner.extend?.(point, event)
      else if (selectingText && editMode && visible) {
        const focus = caretFactory(doc, selectingText.node, point.x, point.y)
        if (focus !== undefined) emitSelection({ handle: selectingText.handle, anchor: selectingText.anchor, focus })
      }
    },
  })
  restore.push(releaseInput)
  function attachEvents(): void {
    const current = new Set<EventTarget>(adapter?.roots() ?? [])
    for (const [root, release] of selectedRoots) if (!current.has(root)) { release(); selectedRoots.delete(root) }
    for (const root of current) if (!selectedRoots.has(root)) {
      root.addEventListener('click', clicked, true); root.addEventListener('dblclick', clicked, true)
      for (const type of ['play', 'animationstart', 'transitionrun']) root.addEventListener(type, activity, true)
      selectedRoots.set(root, () => { root.removeEventListener('click', clicked, true); root.removeEventListener('dblclick', clicked, true)
        for (const type of ['play', 'animationstart', 'transitionrun']) root.removeEventListener(type, activity, true) })
    }
  }
  const configureAdapter = () => {
    adapter?.dispose(); adapter = undefined
    confirmed.clear(); selected = null; selectingText = undefined; draw()
    if (!observe || !doc.documentElement) { attachEvents(); return }
    adapter = factory(doc.documentElement, { records: () => records,
      scope: { 'html:frame': route, 'html:sources': JSON.stringify(sourceChain) }, shadowRoot: host => roots.get(host) ?? host.shadowRoot,
      resourceReference: value => resourceReference(value) ?? entryReference(value), resolveResource: value => resolveResource(value) ?? absolute(value),
      matchesResource: (value, live) => matchesResource(value, live) || absolute(value) === absolute(live, doc.baseURI), onChange: schedule })
    adapter.setActive(visible)
    attachEvents(); schedule()
  }
  const sourceScript = () => `(${installHtmlFrameAuthoring.toString()})((${factory.toString()}),undefined,(${inputFactory.toString()}),true,(${captureFactory.toString()}),(${frameFactory.toString()}),(${caretFactory.toString()}));`
  // The portable bootstrap has no module loader; retain the shared srcset
  // candidate semantics here rather than splitting data URL commas.
  const mapSrcset = (srcset: string, resolve: (value: string) => string | undefined) => {
    let cursor = 0, copied = 0, result = ''
    while (cursor < srcset.length) {
      while (cursor < srcset.length && /[\s,]/.test(srcset[cursor]!)) cursor++
      const start = cursor
      while (cursor < srcset.length && !/\s/.test(srcset[cursor]!)) cursor++
      let end = cursor
      while (end > start && srcset[end - 1] === ',') end--
      if (end === start) continue
      result += srcset.slice(copied, start) + (resolve(srcset.slice(start, end)) ?? srcset.slice(start, end)); copied = end
      if (end < cursor) continue
      let depth = 0
      while (cursor < srcset.length) {
        const character = srcset[cursor++]
        if (character === '(') depth++
        else if (character === ')') depth--
        else if (character === ',' && depth === 0) break
      }
    }
    return result + srcset.slice(copied)
  }
  const decorate = (html: string, sourceBase = doc.baseURI, resources?: Record<string, string>) => {
    if (/^(?:\s|<!doctype[^>]*>|<html\b[^>]*>|<head\b[^>]*>)*<script\b[^>]*\bid=["']cw-html-frame-bootstrap["']/i.test(html.slice(0, 1024))) return html
    let authoredBase = false
    if (/<base\b/i.test(html) || resources && Object.keys(resources).length) {
      const parsed = new win.DOMParser().parseFromString(html, 'text/html'), baseElement = parsed.querySelector('base[href]')
      let effectiveBase = sourceBase
      if (baseElement) {
        effectiveBase = absolute(baseElement.getAttribute('href')!, sourceBase)
        baseElement.setAttribute('href', effectiveBase); authoredBase = true
      }
      if (resources) {
        const reference = (value: string) => { const key = entryReference(value, effectiveBase); return resources[key] ?? resources[fileKey(key)] }
        const css = (value: string) => value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
          (original, double: string, single: string, bare: string) => { const next = reference(double ?? single ?? bare); return next ? `url("${next}")` : original })
          .replace(/(@import\s+)(["'])(.*?)\2/gi, (original, prefix: string, quote: string, value: string) => { const next = reference(value); return next ? `${prefix}${quote}${next}${quote}` : original })
        for (const element of parsed.querySelectorAll('link[rel~="stylesheet"],img,source,audio,video,track,input[type="image"]')) {
          for (const attribute of ['src', 'href', 'poster']) if (element.hasAttribute(attribute)) {
            const next = reference(element.getAttribute(attribute)!); if (next) {
              element.setAttribute(attribute, next)
              if (element.localName === 'link' && attribute === 'href') element.removeAttribute('integrity')
            }
          }
          // Only local candidates are rewritten; descriptors and data URLs retain their carriers.
          if (element.hasAttribute('srcset')) element.setAttribute('srcset', mapSrcset(element.getAttribute('srcset')!, reference))
        }
        for (const element of parsed.querySelectorAll('[style]')) element.setAttribute('style', css(element.getAttribute('style')!))
        for (const element of parsed.querySelectorAll('style')) element.textContent = css(element.textContent ?? '')
      }
      const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? ''
      html = doctype + parsed.documentElement.outerHTML
    }
    const safeScript = sourceScript().replace(/<\/script/gi, '<\\/script')
    const escapedBase = sourceBase.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const prefix = `<script id="cw-html-frame-bootstrap">${safeScript}</script>${authoredBase ? '' : `<base href="${escapedBase}">`}`
    const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
    return doctype ? html.slice(0, doctype[0].length) + prefix + html.slice(doctype[0].length) : prefix + html
  }
  const blobCapture = captureFactory(win, decorate), blobs = blobCapture?.entries ?? new Map<string, HtmlBlobCaptureEntry>()
  const nativeCreate = blobCapture?.nativeCreate ?? win.URL.createObjectURL?.bind(win.URL), nativeRevoke = blobCapture?.nativeRevoke ?? win.URL.revokeObjectURL?.bind(win.URL)
  const releaseReplay = (frame: HTMLIFrameElement, includeCurrent: boolean) => {
    const owned = replayUrls.get(frame)
    if (!owned) return
    for (const url of owned.retired) nativeRevoke?.(url)
    owned.retired.clear()
    if (includeCurrent) {
      if (owned.current) nativeRevoke?.(owned.current)
      replayUrls.delete(frame)
    }
  }
  const retireReplay = (frame: HTMLIFrameElement, next?: string) => {
    let owned = replayUrls.get(frame)
    if (!owned && !next) return
    if (!owned) { owned = { retired: new Set(), connected: frame.isConnected }; replayUrls.set(frame, owned) }
    if (owned.current && owned.current !== next) owned.retired.add(owned.current)
    owned.current = next
  }
  const nativeSetAttribute = win.Element.prototype.setAttribute
  const srcDescriptor = Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'src')
  const srcdocDescriptor = Object.getOwnPropertyDescriptor(win.HTMLIFrameElement.prototype, 'srcdoc')
  const setFrameSource = (frame: HTMLIFrameElement, value: string, apply: (url: string) => void) => {
    const ticket = (navigation.get(frame) ?? 0) + 1; navigation.set(frame, ticket)
    const blob = blobs.get(value), material = sources[entryReference(value)]
    if (!/^(?:blob:|about:|data:)/i.test(value)) frameSources.set(frame, value)
    const navigate = (url: string, replay = false) => {
      // Software srcdoc is a replay carrier, not a permanent override of the
      // author's subsequent src navigation. Authored srcdoc retains its semantics.
      const software = frame.hasAttribute('data-cw-frame-source')
      retireReplay(frame, replay ? url : undefined)
      apply(url)
      if (software) { frame.removeAttribute('srcdoc'); frame.removeAttribute('data-cw-frame-source') }
    }
    if (blob) {
      void blob.ready.then(url => { if (!disposed && !blob.revoked && navigation.get(frame) === ticket) navigate(url) })
    } else if (material && nativeCreate) {
      const url = nativeCreate(new win.Blob([decorate(material.html, absolute(material.base), material.resources)], { type: 'text/html' }))
      navigate(url, true)
    } else navigate(value)
  }
  if (srcDescriptor?.set) {
    Object.defineProperty(win.HTMLIFrameElement.prototype, 'src', { ...srcDescriptor, set(this: HTMLIFrameElement, value: string) { setFrameSource(this, String(value), url => srcDescriptor.set!.call(this, url)) } })
    restore.push(() => Object.defineProperty(win.HTMLIFrameElement.prototype, 'src', srcDescriptor))
  }
  if (srcdocDescriptor?.set) {
    Object.defineProperty(win.HTMLIFrameElement.prototype, 'srcdoc', { ...srcdocDescriptor, set(this: HTMLIFrameElement, value: string) {
      navigation.set(this, (navigation.get(this) ?? 0) + 1); retireReplay(this)
      srcdocDescriptor.set!.call(this, decorate(String(value)))
    } })
    restore.push(() => Object.defineProperty(win.HTMLIFrameElement.prototype, 'srcdoc', srcdocDescriptor))
  }
  win.Element.prototype.setAttribute = function (name, value) {
    if (isFrame(this) && name.toLowerCase() === 'src') { setFrameSource(this, String(value), url => nativeSetAttribute.call(this, name, url)); return }
    if (isFrame(this) && name.toLowerCase() === 'srcdoc') {
      navigation.set(this, (navigation.get(this) ?? 0) + 1); retireReplay(this)
      nativeSetAttribute.call(this, name, decorate(String(value))); return
    }
    nativeSetAttribute.call(this, name, value)
  }
  restore.push(() => { win.Element.prototype.setAttribute = nativeSetAttribute })
  const originalAttach = win.Element.prototype.attachShadow
  win.Element.prototype.attachShadow = function (init) { const shadow = originalAttach.call(this, init); roots.set(this, shadow); schedule(); return shadow }
  restore.push(() => { win.Element.prototype.attachShadow = originalAttach })
  const syncChildren = () => {
    const current = new Set(allFrames())
    for (const frame of children.keys()) if (!current.has(frame)) children.delete(frame)
    for (const [frame, owned] of replayUrls) {
      if (current.has(frame)) owned.connected = true
      else if (owned.connected) { navigation.set(frame, (navigation.get(frame) ?? 0) + 1); releaseReplay(frame, true) }
    }
    for (const frame of current) if (!children.has(frame)) {
      children.set(frame, childState(frame))
      frame.addEventListener('load', () => { if (!disposed && children.has(frame)) {
        releaseReplay(frame, false)
        const previous = children.get(frame)!
        children.set(frame, { ...childState(frame), token: previous.token, aliasesSent: previous.aliasesSent })
        frame.contentWindow?.postMessage({ protocol, type: 'hello-request' }, '*')
      } })
      frame.contentWindow?.postMessage({ protocol, type: 'hello-request' }, '*')
    }
  }
  const message = (event: MessageEvent) => {
    const value = event.data
    if (disposed || value?.protocol !== protocol || typeof value.type !== 'string') return
    if (event.source === win.parent && win.parent !== win) {
      if (value.type === 'hello-request') { win.parent.postMessage({ protocol, type: 'hello', token, deltaState: true }, '*'); return }
      if (value.type === 'state') {
        const changed = route !== value.route || observe !== value.observe
        const changedRecords = Object.hasOwn(value, 'records'), changedSources = Object.hasOwn(value, 'sources')
        route = value.route; sourceChain = value.sourcesChain ?? []; base = value.base
        if (changedRecords) { records = value.records ?? {}; recordsVersion++ }
        if (changedSources) { sources = value.sources ?? {}; sourcesVersion++; registerResources() }
        if (value.aliases && typeof value.aliases === 'object' && !Array.isArray(value.aliases)) {
          aliasesInherited = true; aliasUrls.clear(); urlAliases.clear()
          for (const [alias, url] of Object.entries(value.aliases)) if (alias.startsWith('cw-resource:') && typeof url === 'string') {
            aliasUrls.set(alias, url); urlAliases.set(url, alias)
          }
          for (const state of children.values()) state.aliasesSent = false
        }
        observe = Boolean(value.observe)
        if (editMode !== Boolean(value.editMode)) { confirmed.clear(); confirmationScan = undefined; selectingText = undefined; editingHandle = null; pointerTarget = undefined }
        editMode = Boolean(value.editMode); setVisible(Boolean(value.visible))
        if (!editMode) cursor('')
        if (changed) configureAdapter(); else if (changedRecords) adapter?.refresh()
        if (visible) schedule()
        if (visible) syncChildren(); else childrenDirty = true
        for (const frame of children.keys()) { const previous = children.get(frame)!; children.set(frame, { ...childState(frame), ready: previous.ready,
          aliasesSent: previous.aliasesSent, token: previous.token, deltaState: previous.deltaState,
          recordsVersion: previous.recordsVersion, sourcesVersion: previous.sourcesVersion }); sendState(frame) }
        return
      }
      if (value.type === 'confirm') { applyConfirmation(value.handles, value.scanId); return }
      if (value.type === 'select') {
        selected = nodes.has(value.handle) ? value.handle : null
        editingHandle = selected && value.editing === true && value.editable ? selected : null
        adapter?.suppressText(editingHandle ? nodes.get(editingHandle) : undefined)
        draw(); broadcast('select', { handle: value.handle, editable: value.editable, editing: value.editing === true }); return
      }
      if (value.type === 'preview') { adapter?.previewGeometry(value.authorKey, value.geometry ?? null); draw(); broadcast('preview', { authorKey: value.authorKey, geometry: value.geometry }); return }
    }
    const frame = allFrames().find(frame => frame.contentWindow === event.source)
    if (!frame) return
    if (!children.has(frame)) children.set(frame, childState(frame))
    if (value.type === 'hello') {
      const state = children.get(frame)!
      if (state.token !== value.token) { state.token = value.token; state.aliasesSent = false; state.deltaState = false; state.recordsVersion = undefined; state.sourcesVersion = undefined }
      state.deltaState = value.deltaState === true
      state.ready = true; sendState(frame); return
    }
    if (value.type === 'selection' && typeof value.handle === 'string'
      && Number.isSafeInteger(value.anchor) && value.anchor >= 0 && Number.isSafeInteger(value.focus) && value.focus >= 0) {
      emitSelection({ handle: value.handle, anchor: value.anchor, focus: value.focus, ...(value.word === true ? { word: true } : {}) })
      return
    }
    if (value.type === 'gesture' && typeof value.handle === 'string' && ['start', 'update', 'end', 'cancel'].includes(value.phase)
      && Number.isSafeInteger(value.pointerId) && value.pointerId >= 0 && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      const map = frameGeometry.frameMatrix(frame)
      if (!map) return
      emitGesture({ handle: value.handle, phase: value.phase, pointerId: value.pointerId,
        x: map[0] * value.x + map[2] * value.y + map[4], y: map[1] * value.x + map[3] * value.y + map[5],
        shift: value.shift === true, alt: value.alt === true })
      return
    }
    if (value.type === 'targets' && (value.event === 'targets' || value.event === 'edit-targets') && Array.isArray(value.targets)) {
      const map = frameGeometry.frameMatrix(frame)
      if (!map) return
      const targets = value.targets.slice(0, 64).map((target: HtmlPreviewTargetReport) => {
        remoteHandles.add(target.handle)
        const rect = frameGeometry.transformRect(target.rect, map)
        const geometry = target.geometry
        const parent = geometry?.parentToInstance
        const textStyle = frameGeometry.transformTextStyle(target.textStyle, map)
        return { ...target, rect, ...(textStyle ? { textStyle } : {}),
          ...(geometry && parent ? { geometry: { ...geometry, parentToInstance: frameGeometry.multiply(map, parent) } } : {}) }
      }) as HtmlPreviewTargetReport[]
      emit(value.event, targets, value.intent === 'edit' ? 'edit' : value.intent === 'select' ? 'select' : undefined)
    }
  }
  const applyConfirmation = (handles: string[], scanId?: string) => {
    if (scanId !== undefined && scanId !== confirmationScan) { confirmed.clear(); confirmationScan = scanId }
    for (const handle of handles) if (nodes.has(handle)) confirmed.add(handle)
    draw(); broadcast('confirm', { handles, scanId })
  }
  win.addEventListener('message', message)
  const observer = new win.MutationObserver(changes => {
    const software = (node: Node) => node.nodeType === 1 && (node as Element).hasAttribute('data-html-preview-edit-markers')
    if (changes.every(change => software(change.target) || change.type === 'childList'
      && [...change.addedNodes, ...change.removedNodes].every(software))) return
    if (!visible) {
      childrenDirty = true
      for (const [frame, owned] of replayUrls) {
        if (frame.isConnected) owned.connected = true
        else if (owned.connected) { navigation.set(frame, (navigation.get(frame) ?? 0) + 1); releaseReplay(frame, true); children.delete(frame) }
      }
      return
    }
    syncChildren(); schedule()
  })
  observer.observe(doc, { subtree: true, childList: true })
  win.addEventListener('scroll', schedule, true)
  win.addEventListener('resize', schedule)
  const api: HtmlFrameAuthoringBridge = {
    setRecords(value) { records = value; recordsVersion++; adapter?.refresh(); for (const frame of children.keys()) sendState(frame); schedule() },
    setSources(value) { sources = value; sourcesVersion++; registerResources(); for (const frame of children.keys()) sendState(frame) },
    setEditMode(value) { if (editMode !== value) { confirmed.clear(); confirmationScan = undefined; selectingText = undefined; editingHandle = null; pointerTarget = undefined }
      editMode = value; if (!value) { adapter?.suppressText(); cursor('') }; for (const frame of children.keys()) sendState(frame); schedule(); draw() },
    setVisibility(value) { setVisible(value); for (const frame of children.keys()) sendState(frame); draw() },
    refresh() { adapter?.refresh(); syncChildren(); for (const frame of children.keys()) sendState(frame); schedule() },
    confirm(handles, scanId) { applyConfirmation(handles, scanId) },
    select(handle, editable, editing = false) {
      selected = nodes.has(handle ?? '') ? handle : null; editingHandle = selected && editable && editing ? selected : null
      adapter?.suppressText(editingHandle ? nodes.get(editingHandle) : undefined); draw(); broadcast('select', { handle, editable, editing })
    },
    previewGeometry(authorKey, geometry) { adapter?.previewGeometry(authorKey, geometry ?? null); broadcast('preview', { authorKey, geometry }); draw() },
    isRemoteHandle(handle) { return remoteHandles.has(handle) },
    onTargets(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    shadowRoot(host) { return roots.get(host) ?? host.shadowRoot },
    resourceReference,
    resolveResource,
    matchesResource,
    controlState: () => ({ editMode, visible }),
    dispose() {
      if (cursorSheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(sheet => sheet !== cursorSheet)
      if (disposed) return; disposed = true; observer.disconnect(); win.removeEventListener('message', message)
      win.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule)
      for (const release of selectedRoots.values()) release(); adapter?.dispose(); marker?.remove()
      blobCapture?.dispose()
      for (const frame of replayUrls.keys()) releaseReplay(frame, true)
      for (const release of restore.reverse()) release(); children.clear(); listeners.clear(); nodes.clear(); selectedRoots.clear()
      pausedMedia.clear(); pausedAnimations.clear(); confirmed.clear(); selectingText = undefined
      if (win.__cwHtmlFrameAuthoring === api) delete win.__cwHtmlFrameAuthoring
    },
  }
  win.__cwHtmlFrameAuthoring = api
  try {
    const stored = JSON.parse(doc.getElementById('cw-html-authoring-records')?.textContent ?? '{}')
    records = stored.records ?? {}; sources = stored.sources ?? {}; registerResources()
  } catch { /* Source validation reports malformed author data separately. */ }
  syncChildren()
  if (win.parent !== win) win.parent.postMessage({ protocol, type: 'hello', token, deltaState: true }, '*')
  return api
}

export function htmlFrameAuthoringBootstrapSource(): string {
  return `(${installHtmlFrameAuthoring.toString()})(${domAuthoringFactorySource()},undefined,(${installAuthoringInputArbitration.toString()}),true,(${installHtmlBlobCapture.toString()}),(${createAuthoringFrameGeometry.toString()}),(${authoringCaretOffset.toString()}));`.replace(/<\/script/gi, '<\\/script')
}

/** Inject the same ordinary DOM bridge before authored scripts, retaining source outside software additions. */
export function decorateHtmlFrameAuthoring(source: string, bootstrap = htmlFrameAuthoringBootstrapSource(), options: { sources?: HtmlFrameSources; base?: string; resources?: Record<string, string> } = {},
  changes?: Array<{ from: number; to: number; inserted: number }>, preparedTokens?: readonly import('./htmlSourceScanner').HtmlSourceToken[]): string {
  const marker = 'cw-html-frame-bootstrap'
  const tokens = preparedTokens ?? scanHtmlSource(source).tokens
  const installed = source.includes(marker) ? indexHtmlElements(source, tokens).elements
    .filter(element => element.name === 'script' && element.id === marker && element.endTag) : []
  const patches: Array<{ start: number; end: number; value: string }> = []
  // A saved bridge is software-owned. Refresh only its script body so the new
  // realm guard still precedes authored listeners, retaining its original tag.
  for (const element of installed) if (source.slice(element.content.start, element.content.end) !== bootstrap) {
    patches.push({ ...element.content, value: bootstrap })
  }
  const logicalRoot = 'https://cw-html-entry.invalid/'
  let logicalBase = new URL(options.base || '.', logicalRoot)
  const originalBase = tokens.find(token => token.kind === 'start-tag' && token.name === 'base'
    && token.attributes?.some(attribute => attribute.name === 'href'))?.attributes?.find(attribute => attribute.name === 'href')
  if (originalBase?.valueSpan) {
    const href = originalBase.decodedValue ?? decodeHtmlEntities(source.slice(originalBase.valueSpan.start, originalBase.valueSpan.end))
    try { logicalBase = new URL(href, logicalBase) } catch { /* Preserve an unusable authored base unchanged. */ }
  }
  const entryPath = (value: string) => {
    try { const url = new URL(value, logicalBase); return url.origin === new URL(logicalRoot).origin ? url.pathname.slice(1) + url.search + url.hash : url.href } catch { return value }
  }
  const resource = (value: string) => {
    const key = entryPath(value), path = key.split(/[?#]/, 1)[0]!
    let decoded = path; try { decoded = decodeURIComponent(path) } catch { /* Unusable escapes retain their authored reference. */ }
    return options.resources?.[key] ?? options.resources?.[decoded]
  }
  const css = (value: string) => value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
    (original, double: string, single: string, bare: string) => { const next = resource(double ?? single ?? bare); return next ? `url("${next}")` : original })
    .replace(/(@import\s+)(["'])(.*?)\2/gi, (original, prefix: string, quote: string, value: string) => { const next = resource(value); return next ? `${prefix}${quote}${next}${quote}` : original })
  if (options.resources) for (const token of tokens) {
    if (token.kind === 'raw-text' && token.rawKind === 'style') {
      const value = css(source.slice(token.span.start, token.span.end)); patches.push({ ...token.span, value }); continue
    }
    if (token.kind !== 'start-tag') continue
    for (const attribute of token.attributes ?? []) {
      if (!attribute.valueSpan) continue
      const original = attribute.decodedValue ?? decodeHtmlEntities(source.slice(attribute.valueSpan.start, attribute.valueSpan.end))
      let value: string | undefined
      if (attribute.name === 'style') value = css(original)
      else if (['img', 'source', 'audio', 'video', 'track', 'input'].includes(token.name ?? '')) {
        if (attribute.name === 'srcset') value = mapSrcsetUrls(original, resource)
        else if (['src', 'poster'].includes(attribute.name)) value = resource(original)
      } else if (token.name === 'link' && attribute.name === 'href'
        && token.attributes?.some(value => value.name === 'rel' && /(?:^|\s)stylesheet(?:\s|$)/i.test(value.decodedValue ?? ''))) value = resource(original)
      if (value === undefined || value === original) continue
      const quote = attribute.quote || '"', encoded = value.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;')
      patches.push(attribute.quote ? { ...attribute.valueSpan, value: encoded } : { start: attribute.span.start, end: attribute.valueSpan.end, value: `${attribute.rawName}="${encoded}"` })
      if (token.name === 'link' && attribute.name === 'href') {
        const integrity = token.attributes?.find(value => value.name === 'integrity')
        if (integrity) patches.push({ start: integrity.span.start, end: integrity.valueSpan ? integrity.valueSpan.end + (integrity.quote ? 1 : 0) : integrity.span.end, value: '' })
      }
    }
  }
  for (const token of tokens) if (token.kind === 'start-tag' && token.name === 'iframe') {
    const attribute = token.attributes?.find(attribute => attribute.name === 'srcdoc')
    const software = token.attributes?.find(attribute => attribute.name === 'data-cw-frame-source')
    if (!attribute?.valueSpan || software) {
      const src = token.attributes?.find(attribute => attribute.name === 'src')
      const reference = src?.decodedValue ?? (src?.valueSpan ? decodeHtmlEntities(source.slice(src.valueSpan.start, src.valueSpan.end)) : '')
      const key = reference && entryPath(reference), material = key && options.sources?.[key]
      if (!material) continue
      const target = new URL(material.base, logicalRoot), directory = logicalBase.pathname.split('/'); directory.pop()
      const destination = target.pathname.split('/')
      while (directory.length && destination.length && directory[0] === destination[0]) { directory.shift(); destination.shift() }
      const relativeBase = `${'../'.repeat(directory.length)}${destination.join('/')}${target.search}${target.hash}`
      const child = decorateHtmlFrameAuthoring(material.html, bootstrap, { ...options, base: material.base, resources: material.resources })
      const childTokens = scanHtmlSource(child).tokens, childHead = childTokens.find(token => token.kind === 'start-tag' && token.name === 'head')
      const baseAt = childHead?.span.end ?? /^\s*<!doctype[^>]*>/i.exec(child)?.[0].length ?? 0
      const authoredBase = childTokens.find(token => token.kind === 'start-tag' && token.name === 'base'
        && token.attributes?.some(attribute => attribute.name === 'href'))?.attributes?.find(attribute => attribute.name === 'href')
      let withBase = child
      if (authoredBase?.valueSpan) {
        const originalHref = authoredBase.decodedValue ?? decodeHtmlEntities(child.slice(authoredBase.valueSpan.start, authoredBase.valueSpan.end))
        const effective = new URL(originalHref, target)
        let href = effective.href
        if (effective.origin === new URL(logicalRoot).origin) {
          const from = logicalBase.pathname.split('/'); from.pop(); const to = effective.pathname.split('/')
          while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
          href = `${'../'.repeat(from.length)}${to.join('/')}${effective.search}${effective.hash}`
        }
        const quote = authoredBase.quote || '"', encoded = href.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;')
        const span = authoredBase.quote ? authoredBase.valueSpan : authoredBase.span
        withBase = child.slice(0, span.start) + (authoredBase.quote ? encoded : `${authoredBase.rawName}="${encoded}"`) + child.slice(span.end)
      } else withBase = child.slice(0, baseAt) + `<base href="${relativeBase.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` + child.slice(baseAt)
      const encoded = withBase.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      if (attribute?.valueSpan) patches.push({ start: attribute.span.start, end: attribute.valueSpan.end + (attribute.quote ? 1 : 0), value: `${attribute.rawName}="${encoded}"` })
      else patches.push({ start: token.span.end - (token.selfClosing ? 2 : 1), end: token.span.end - (token.selfClosing ? 2 : 1), value: ` srcdoc="${encoded}"` })
      if (!software) patches.push({ start: token.span.end - (token.selfClosing ? 2 : 1), end: token.span.end - (token.selfClosing ? 2 : 1),
        value: ` data-cw-frame-source="${key.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` })
      continue
    }
    const original = attribute.decodedValue ?? decodeHtmlEntities(source.slice(attribute.valueSpan.start, attribute.valueSpan.end))
    const decorated = decorateHtmlFrameAuthoring(original, bootstrap, options)
    if (decorated === original) continue
    const quote = attribute.quote || '"'
    const encoded = decorated.replace(/&/g, '&amp;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;')
    patches.push(attribute.quote ? { ...attribute.valueSpan, value: encoded }
      : { ...attribute.span, value: `${attribute.rawName}="${encoded}"` })
  }
  const head = tokens.find(token => token.kind === 'start-tag' && token.name === 'head')
  const html = tokens.find(token => token.kind === 'start-tag' && token.name === 'html')
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source)
  const at = head?.span.end ?? html?.span.end ?? doctype?.[0].length ?? 0
  if (!installed.length) patches.push({ start: at, end: at, value: `<script id="${marker}">${bootstrap}</script>` })
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    if (source.slice(patch.start, patch.end) === patch.value) continue
    source = source.slice(0, patch.start) + patch.value + source.slice(patch.end)
    changes?.push({ from: patch.start, to: patch.end, inserted: patch.value.length })
  }
  return source
}
