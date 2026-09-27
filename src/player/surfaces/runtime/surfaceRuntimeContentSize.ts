export type SurfaceRuntimeContentSource =
  | { kind: 'intrinsic'; element: HTMLElement }
  | { kind: 'viewport'; origin: HTMLElement; viewportElements: ReadonlySet<HTMLElement> }

export interface SurfaceRuntimeContentSizeOptions {
  root: HTMLElement
  source?: () => SurfaceRuntimeContentSource | null
  onHeightChange(height: number): void
}

export interface SurfaceRuntimeContentSizeObserver {
  refresh(): void
  destroy(): void
}

function sameSource(left: SurfaceRuntimeContentSource | null, right: SurfaceRuntimeContentSource | null): boolean {
  if (!left || !right) return left === right
  if (left.kind !== right.kind) return false
  if (left.kind === 'intrinsic' && right.kind === 'intrinsic') return left.element === right.element
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

function contentHeight(source: SurfaceRuntimeContentSource): number {
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
  const sourceRoot = (source: SurfaceRuntimeContentSource): HTMLElement => source.kind === 'intrinsic' ? source.element : source.origin
  const bindResizeNodes = (): void => {
    resizeObserver?.disconnect()
    if (!observedSource || !resizeObserver) return
    const root = sourceRoot(observedSource)
    resizeObserver.observe(root)
    for (const child of root.querySelectorAll('*')) resizeObserver.observe(child)
  }
  const schedule = (): void => {
    if (destroyed || frame || !view) return
    frame = view.requestAnimationFrame(() => {
      frame = 0
      if (destroyed) return
      const source = options.source ? options.source() : defaultSource
      if (!sameSource(source, observedSource)) attach(source)
      if (!source) return
      const height = contentHeight(source)
      if (height === lastHeight) return
      lastHeight = height
      options.onHeightChange(height)
    })
  }
  const attach = (source: SurfaceRuntimeContentSource | null): void => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    observedSource = source
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
    destroy() {
      if (destroyed) return
      destroyed = true
      if (frame && view) view.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    },
  }
}
