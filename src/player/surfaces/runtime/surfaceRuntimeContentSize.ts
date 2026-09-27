import { measureManagedHtmlContent, type ManagedHtmlMeasurementSource } from './managedHtmlContentMeasurement'
import { freezeManagedHtmlLayout, managedHtmlStylesheetSignature, waitForManagedHtmlResize } from './managedHtmlFlowAdmissionProfile'

export type SurfaceRuntimeContentSource =
  | { kind: 'intrinsic'; element: HTMLElement }
  | { kind: 'viewport'; origin: HTMLElement; viewportElements: ReadonlySet<HTMLElement> }
  | ManagedHtmlMeasurementSource

export interface SurfaceRuntimeContentSizeOptions {
  root: HTMLElement
  source?: () => SurfaceRuntimeContentSource | null
  onHeightChange(height: number): void
  onError?(error: Error): void
}

export interface SurfaceRuntimeContentSizeObserver {
  refresh(): void
  waitForReady(): Promise<void>
  destroy(): void
}

function sameSource(left: SurfaceRuntimeContentSource | null, right: SurfaceRuntimeContentSource | null): boolean {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'intrinsic' && right.kind === 'intrinsic') return left.element === right.element
  if (left.kind === 'managed-document' && right.kind === 'managed-document') return left.iframe === right.iframe && left.origin === right.origin
  if (left.kind !== 'viewport' || right.kind !== 'viewport' || left.origin !== right.origin) return false
  return left.viewportElements.size === right.viewportElements.size
    && [...left.viewportElements].every(element => right.viewportElements.has(element))
}

function layoutBottom(rect: DOMRect, originTop: number, scaleY: number): number {
  return (rect.bottom - originTop) / scaleY
}

function directTextBottom(element: HTMLElement, originTop: number, scaleY: number): number {
  let bottom = 0
  for (const child of element.childNodes) {
    if (child.nodeType !== 3 || !child.textContent?.trim()) continue
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(child)
    if (typeof range.getBoundingClientRect === 'function') bottom = Math.max(bottom, layoutBottom(range.getBoundingClientRect(), originTop, scaleY))
    range.detach()
  }
  return bottom
}

function contentHeight(source: Exclude<SurfaceRuntimeContentSource, ManagedHtmlMeasurementSource>): number {
  if (source.kind === 'intrinsic') return Math.max(0, source.element.offsetHeight)
  const origin = source.origin
  const originRect = origin.getBoundingClientRect()
  const scaleY = origin.offsetHeight > 0 && originRect.height > 0 ? originRect.height / origin.offsetHeight : 1
  const viewportElements = new Set(source.viewportElements)
  viewportElements.add(origin)
  const walk = (element: HTMLElement): number => {
    let bottom = directTextBottom(element, originRect.top, scaleY)
    for (const child of element.children) {
      if (child.nodeType === 1) bottom = Math.max(bottom, walk(child as HTMLElement))
    }
    if (!viewportElements.has(element)) return Math.max(bottom, layoutBottom(element.getBoundingClientRect(), originRect.top, scaleY))
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const trailing = (Number.parseFloat(style?.paddingBottom ?? '') || 0) + (Number.parseFloat(style?.borderBottomWidth ?? '') || 0)
    return bottom + trailing
  }
  return Math.max(0, Math.ceil(walk(origin)))
}

export function observeSurfaceRuntimeContentSize(options: SurfaceRuntimeContentSizeOptions): SurfaceRuntimeContentSizeObserver {
  const view = options.root.ownerDocument.defaultView
  const defaultSource: SurfaceRuntimeContentSource = { kind: 'viewport', origin: options.root, viewportElements: new Set([options.root]) }
  let destroyed = false
  let frame = 0
  let lastHeight: number | null = null
  let observedSource: SurfaceRuntimeContentSource | null = null
  let observedSize: string | null = null
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let controller: AbortController | null = null
  let generation = 0
  let countedGeneration = -1
  let failure: Error | null = null
  let heightChanges = 0
  let invalidations = 0
  let lastInvalidation = 'none'
  let phase = 'idle'
  let ready = false
  let dirty = true
  let publishingHeight = false
  let cssFrame = 0
  let cssSignature: string | null = null
  let verifyPublishedLayout: (() => boolean) | null = null
  const resizeSizes = new WeakMap<Element, string>()
  const waiters = new Set<{ resolve(): void; reject(error: Error): void }>()
  const settle = (error?: Error): void => {
    for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve()
    waiters.clear()
  }
  const fail = (cause: unknown): void => {
    if (destroyed || failure) return
    const error = cause instanceof Error ? cause : new Error(String(cause))
    failure = error.message.includes('phase=') ? error
      : new Error(`${error.message}（phase=${phase}, invalidations=${invalidations}, lastHeight=${lastHeight ?? 'none'}, reason=${lastInvalidation}）`)
    controller?.abort()
    if (frame && view) view.cancelAnimationFrame(frame)
    if (cssFrame && view) view.cancelAnimationFrame(cssFrame)
    frame = cssFrame = 0
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    settle(failure)
    options.onError?.(failure)
  }
  const sourceSize = (source: SurfaceRuntimeContentSource | null): string | null =>
    source?.kind === 'managed-document' ? `${source.iframe.clientWidth}x${source.iframe.clientHeight}` : null
  const sourceRoot = (source: SurfaceRuntimeContentSource): HTMLElement => source.kind === 'intrinsic' ? source.element : source.origin
  const bindResizeNodes = (): void => {
    resizeObserver?.disconnect()
    if (!observedSource || !resizeObserver) return
    const root = sourceRoot(observedSource)
    resizeObserver.observe(root)
    for (const child of root.querySelectorAll('*')) resizeObserver.observe(child)
  }
  const monitorStyles = (): void => {
    cssFrame = 0
    if (destroyed || failure || !view || observedSource?.kind !== 'managed-document') return
    const source = observedSource
    if (source.iframe.contentDocument !== source.origin.ownerDocument) { request('refresh'); return }
    try {
      const signature = managedHtmlStylesheetSignature(source.origin.ownerDocument)
      if (cssSignature !== null && signature !== cssSignature) throw new Error('Flow HTML 不允许动态修改样式表；请使用演示页。')
      cssSignature = signature
    } catch (cause) { fail(cause); return }
    cssFrame = view.requestAnimationFrame(monitorStyles)
  }
  const attach = (source: SurfaceRuntimeContentSource | null): void => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    if (cssFrame && view) view.cancelAnimationFrame(cssFrame)
    cssFrame = 0
    cssSignature = null
    verifyPublishedLayout = null
    observedSource = source
    observedSize = sourceSize(source)
    lastHeight = null
    ready = false
    if (source?.kind === 'managed-document' && view) cssFrame = view.requestAnimationFrame(monitorStyles)
    if (!source) return
    const root = sourceRoot(source)
    const sourceView = root.ownerDocument.defaultView
    const Resize = sourceView?.ResizeObserver
    resizeObserver = Resize ? new Resize(entries => {
      let changed = false
      for (const entry of entries) {
        const size = `${entry.contentRect.width}x${entry.contentRect.height}`
        const previous = resizeSizes.get(entry.target)
        if (previous !== undefined && previous !== size) changed = true
        resizeSizes.set(entry.target, size)
      }
      if (changed) request('descendant resize')
    }) : null
    const Mutation = sourceView?.MutationObserver
    mutationObserver = Mutation ? new Mutation(records => {
      if (records.some(record => record.type === 'childList')) bindResizeNodes()
      // data-* is metadata unless a stylesheet selector can use it; paint/size checks still run for such selectors.
      const selectorsMayUseData = source.kind !== 'managed-document' || cssSignature === null
        || /\[\s*data-|:has\s*\(/i.test(cssSignature)
      if (records.some(record => record.type !== 'attributes' || !record.attributeName?.startsWith('data-') || selectorsMayUseData)) {
        request('DOM mutation')
      }
    }) : null
    bindResizeNodes()
    mutationObserver?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
  }
  const request = (reason: 'refresh' | 'verify' | 'DOM mutation' | 'descendant resize' = 'refresh'): void => {
    if (destroyed || failure || !view) return
    const source = options.source ? options.source() : defaultSource
    const replaced = !sameSource(source, observedSource)
    if (replaced) attach(source)
    const size = sourceSize(source)
    const resized = size !== observedSize
    // The host's synchronous height publication belongs to the confirmation pass.
    const expectedResize = publishingHeight || (!!verifyPublishedLayout && source?.kind === 'managed-document'
      && observedSize?.split('x')[0] === size?.split('x')[0] && reason === 'refresh')
    if (resized) observedSize = size
    const changed = replaced || reason === 'DOM mutation' || reason === 'descendant resize' || (resized && !expectedResize)
    if (changed) {
      lastInvalidation = replaced ? 'source replacement' : resized ? 'viewport resize' : reason
      dirty = true
      ready = false
      if (controller && !controller.signal.aborted) {
        if (countedGeneration !== generation) {
          countedGeneration = generation
          if (++invalidations > 12) {
            fail(new Error(`Flow HTML 持续失效，无法稳定测量（phase=measurement, invalidations=${invalidations}, lastHeight=${lastHeight ?? 'none'}, reason=${lastInvalidation}）；请使用演示页。`))
            return
          }
        }
        // During confirmation the frozen live layout must run and reject author resize edits.
        if (!verifyPublishedLayout || replaced) controller.abort()
      }
    } else if (reason === 'verify' && ready) {
      dirty = true
      ready = false
    }
    if (controller || frame) return
    if (!source) { ready = false; dirty = false; return }
    if (!dirty && ready) { settle(); return }
    frame = view.requestAnimationFrame(run)
  }
  const run = async (): Promise<void> => {
    frame = 0
    if (destroyed || failure || !observedSource) return
    const source = observedSource
    const pending = new AbortController()
    controller = pending
    const currentGeneration = ++generation
    dirty = false
    try {
      phase = verifyPublishedLayout ? 'await-child-resize' : 'initial-measure'
      if (verifyPublishedLayout && source.kind === 'managed-document') await waitForManagedHtmlResize(source.origin.ownerDocument, pending.signal)
      if (pending.signal.aborted) return
      phase = verifyPublishedLayout ? 'confirm-measure' : 'initial-measure'
      if (verifyPublishedLayout && !verifyPublishedLayout()) throw new Error('Flow HTML 在调整视口后删除、移动或改变了正文；请使用演示页。')
      const height = source.kind === 'managed-document'
        ? await measureManagedHtmlContent(source, pending.signal)
        : contentHeight(source)
      if (destroyed || pending.signal.aborted || currentGeneration !== generation) return
      if (source.kind === 'managed-document' && source.iframe.contentDocument !== source.origin.ownerDocument) {
        request('refresh')
        return
      }
      if (height !== lastHeight) {
        if (source.kind === 'managed-document' && ++heightChanges > 12) {
          throw new Error(`HTML 页面在调整 Flow 高度后持续改变布局（phase=publish-height, invalidations=${invalidations}, lastHeight=${lastHeight ?? 'none'}, reason=${lastInvalidation}）；请使用演示页。`)
        }
        lastHeight = height
        phase = 'publish-height'
        if (source.kind === 'managed-document') verifyPublishedLayout = freezeManagedHtmlLayout(source.origin.ownerDocument)
        publishingHeight = true
        try { options.onHeightChange(height) } finally { publishingHeight = false }
        observedSize = sourceSize(source)
        if (source.kind === 'managed-document') { dirty = true; return }
      }
      if (verifyPublishedLayout && !verifyPublishedLayout()) throw new Error('Flow HTML 在调整视口后删除、移动或改变了正文；请使用演示页。')
      verifyPublishedLayout = null
      if (dirty) return
      ready = true
      phase = 'ready'
      heightChanges = invalidations = 0
      settle()
    } catch (cause) {
      if (destroyed || pending.signal.aborted || currentGeneration !== generation) return
      if (cause instanceof Error && cause.name === 'AbortError') { dirty = true; return }
      fail(cause)
    } finally {
      if (controller === pending) controller = null
      if (!destroyed && !failure && dirty) request('refresh')
    }
  }
  attach(options.source ? options.source() : defaultSource)
  request()
  return {
    refresh: () => request('refresh'),
    waitForReady() {
      if (failure) return Promise.reject(failure)
      if (destroyed) return Promise.reject(new Error('内容高度观察器已销毁'))
      const result = new Promise<void>((resolve, reject) => waiters.add({ resolve, reject }))
      request('verify')
      return result
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      controller?.abort()
      settle(new Error('内容高度观察器已销毁'))
      if (frame && view) view.cancelAnimationFrame(frame)
      if (cssFrame && view) view.cancelAnimationFrame(cssFrame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    },
  }
}
