export interface SurfaceRuntimeContentSizeOptions {
  root: HTMLElement
  source?: () => HTMLElement | Document | null
  onHeightChange(height: number): void
}

export interface SurfaceRuntimeContentSizeObserver {
  refresh(): void
  destroy(): void
}

function measuredNodes(source: HTMLElement | Document): HTMLElement[] {
  const origin = source.nodeType === 9 ? (source as Document).body ?? (source as Document).documentElement : source as HTMLElement
  return Array.from(origin.querySelectorAll('*')).filter((node): node is HTMLElement => node.nodeType === 1)
}

function measureHeight(source: HTMLElement | Document, root: HTMLElement): number {
  const origin = source.nodeType === 9 ? (source as Document).body : source as HTMLElement
  if (!origin) return 0
  const originRect = origin.getBoundingClientRect()
  const scaleY = origin.offsetHeight > 0 && originRect.height > 0 ? originRect.height / origin.offsetHeight : 1
  let bottom = 0
  const layoutBottom = (rect: DOMRect): number => (rect.bottom - originRect.top) / scaleY
  const measureText = (element: HTMLElement): number => {
    let textBottom = 0
    for (const child of element.childNodes) {
      if (child.nodeType !== 3 || !child.textContent?.trim()) continue
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(child)
      if (typeof range.getBoundingClientRect === 'function') textBottom = Math.max(textBottom, layoutBottom(range.getBoundingClientRect()))
      range.detach()
    }
    return textBottom
  }
  const originHeight = originRect.height / scaleY
  const viewportHeight = origin.ownerDocument.defaultView?.innerHeight ?? 0
  for (const node of [origin, ...measuredNodes(source)]) {
    const textBottom = measureText(node)
    bottom = Math.max(bottom, textBottom)
    if (node === origin && (source.nodeType === 9 || source === root)) continue
    if (node.children.length > 0) continue
    const rect = node.getBoundingClientRect()
    const height = rect.height / scaleY
    const fillsHost = Math.abs(height - originHeight) < 0.5 || Math.abs(height - viewportHeight) < 0.5
    if (textBottom > 0 && fillsHost) continue
    bottom = Math.max(bottom, layoutBottom(rect))
  }
  return Math.max(0, Math.ceil(bottom))
}

export function observeSurfaceRuntimeContentSize(options: SurfaceRuntimeContentSizeOptions): SurfaceRuntimeContentSizeObserver {
  const view = options.root.ownerDocument.defaultView
  let destroyed = false
  let frame = 0
  let lastHeight: number | null = null
  let observedSource: HTMLElement | Document | null = null
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null
  const schedule = () => {
    if (destroyed || frame || !view) return
    frame = view.requestAnimationFrame(() => {
      frame = 0
      if (destroyed) return
      const source = options.source?.() ?? options.root
      if (source !== observedSource) attach(source)
      const height = measureHeight(source, options.root)
      if (height === lastHeight) return
      lastHeight = height
      options.onHeightChange(height)
    })
  }
  const attach = (source: HTMLElement | Document): void => {
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    observedSource = source
    const sourceView = source.nodeType === 9 ? (source as Document).defaultView : (source as HTMLElement).ownerDocument.defaultView
    const resize = sourceView?.ResizeObserver
    resizeObserver = resize ? new resize(schedule) : null
    const mutation = sourceView?.MutationObserver
    mutationObserver = mutation ? new mutation(() => { attach(source); schedule() }) : null
    const target = source.nodeType === 9 ? (source as Document).body ?? (source as Document).documentElement : source as HTMLElement
    for (const node of measuredNodes(source)) resizeObserver?.observe(node)
    mutationObserver?.observe(target, { childList: true, subtree: true, characterData: true, attributes: true })
  }
  attach(options.source?.() ?? options.root)
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
