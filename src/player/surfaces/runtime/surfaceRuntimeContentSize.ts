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
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  let controller: AbortController | null = null
  let generation = 0
  let failure: Error | null = null
  let consecutiveChanges = 0
  let cssFrame = 0
  let cssSignature: string | null = null
  let verifyPublishedLayout: (() => boolean) | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  const waiters = new Set<{ resolve(): void; reject(error: Error): void }>()
  const settle = (error?: Error): void => {
    if (deadline) clearTimeout(deadline)
    deadline = null
    for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve()
    waiters.clear()
  }
  const fail = (cause: unknown): void => {
    if (destroyed || failure) return
    failure = cause instanceof Error ? cause : new Error(String(cause))
    controller?.abort()
    if (frame && view) view.cancelAnimationFrame(frame)
    if (cssFrame && view) view.cancelAnimationFrame(cssFrame)
    frame = cssFrame = 0
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    settle(failure)
    options.onError?.(failure)
  }
  const monitorStyles = (): void => {
    cssFrame = 0
    if (destroyed || failure || !view || observedSource?.kind !== 'managed-document') return
    const source = observedSource
    if (source.iframe.contentDocument !== source.origin.ownerDocument) { schedule(); return }
    try {
      const signature = managedHtmlStylesheetSignature(source.origin.ownerDocument)
      if (cssSignature !== null && signature !== cssSignature) throw new Error('Flow HTML 不允许动态修改样式表；请使用演示页。')
      cssSignature = signature
    } catch (cause) { fail(cause); return }
    cssFrame = view.requestAnimationFrame(monitorStyles)
  }
  const sourceRoot = (source: SurfaceRuntimeContentSource): HTMLElement => source.kind === 'intrinsic' ? source.element : source.origin
  const bindResizeNodes = (): void => {
    resizeObserver?.disconnect()
    if (!observedSource || !resizeObserver) return
    const root = sourceRoot(observedSource)
    resizeObserver.observe(root)
    for (const child of root.querySelectorAll('*')) resizeObserver.observe(child)
  }
  const schedule = (): void => {
    if (destroyed || failure || !view) return
    if (observedSource?.kind === 'managed-document' && !deadline) deadline = setTimeout(() => fail(new Error('Flow HTML 布局持续变化或测量超时；请使用演示页。')), 3000)
    generation += 1
    controller?.abort()
    if (frame) return
    frame = view.requestAnimationFrame(async () => {
      frame = 0
      if (destroyed) return
      const currentGeneration = generation
      const source = options.source ? options.source() : defaultSource
      if (!sameSource(source, observedSource)) attach(source)
      if (!source) { settle(); return }
      const pending = new AbortController()
      controller = pending
      try {
        if (verifyPublishedLayout && source.kind === 'managed-document') await waitForManagedHtmlResize(source.origin.ownerDocument, pending.signal)
        if (verifyPublishedLayout && !verifyPublishedLayout()) throw new Error('Flow HTML 在调整视口后删除、移动或改变了正文；请使用演示页。')
        const height = source.kind === 'managed-document'
          ? await measureManagedHtmlContent(source, pending.signal)
          : contentHeight(source)
        if (destroyed || pending.signal.aborted || currentGeneration !== generation) return
        // Navigation can replace the child document without a mutation in the old tree.
        if (source.kind === 'managed-document' && source.iframe.contentDocument !== source.origin.ownerDocument) { schedule(); return }
        if (height !== lastHeight) {
          if (source.kind === 'managed-document' && ++consecutiveChanges > 12) throw new Error('HTML 页面在调整 Flow 高度后持续改变布局，无法稳定显示；请使用演示页。')
          lastHeight = height
          if (source.kind === 'managed-document') verifyPublishedLayout = freezeManagedHtmlLayout(source.origin.ownerDocument)
          options.onHeightChange(height)
          // The real page may react to its one final resize. Check that result before readiness.
          if (source.kind === 'managed-document') { schedule(); return }
        } else consecutiveChanges = 0
        if (verifyPublishedLayout && !verifyPublishedLayout()) throw new Error('Flow HTML 在调整视口后删除、移动或改变了正文；请使用演示页。')
        verifyPublishedLayout = null
        settle()
      } catch (cause) {
        if (destroyed || pending.signal.aborted || currentGeneration !== generation) return
        if (cause instanceof Error && cause.name === 'AbortError') { schedule(); return }
        fail(cause)
      }
    })
  }
  const attach = (source: SurfaceRuntimeContentSource | null): void => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    if (cssFrame && view) view.cancelAnimationFrame(cssFrame)
    cssFrame = 0
    cssSignature = null
    verifyPublishedLayout = null
    observedSource = source
    if (deadline) clearTimeout(deadline)
    deadline = source?.kind === 'managed-document' ? setTimeout(() => fail(new Error('Flow HTML 布局持续变化或测量超时；请使用演示页。')), 3000) : null
    if (source?.kind === 'managed-document' && view) cssFrame = view.requestAnimationFrame(monitorStyles)
    if (!source) return
    const root = sourceRoot(source)
    const sourceView = root.ownerDocument.defaultView
    const Resize = sourceView?.ResizeObserver
    resizeObserver = Resize ? new Resize(schedule) : null
    const Mutation = sourceView?.MutationObserver
    mutationObserver = Mutation ? new Mutation(() => { bindResizeNodes(); schedule() }) : null
    bindResizeNodes()
    mutationObserver?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
  }
  attach(options.source ? options.source() : defaultSource)
  schedule()
  return {
    refresh: schedule,
    waitForReady() {
      if (failure) return Promise.reject(failure)
      if (destroyed) return Promise.reject(new Error('内容高度观察器已销毁'))
      const result = new Promise<void>((resolve, reject) => waiters.add({ resolve, reject }))
      schedule()
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
