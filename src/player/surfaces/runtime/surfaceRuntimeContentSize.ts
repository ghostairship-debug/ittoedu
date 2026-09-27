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
  if (source.nodeType === 9) {
    const document = source as Document
    return Array.from((document.body ?? document.documentElement).children).filter((node): node is HTMLElement => node.nodeType === 1)
  }
  const element = source as HTMLElement
  return Array.from(element.children).filter((node): node is HTMLElement => node.nodeType === 1)
}

function measureHeight(source: HTMLElement | Document, root: HTMLElement): number {
  const origin = source.nodeType === 9 ? (source as Document).body : source as HTMLElement
  if (!origin) return 0
  const originTop = origin.getBoundingClientRect().top
  let bottom = source === root ? 0 : Math.max(origin.getBoundingClientRect().height, origin.scrollHeight)
  for (const node of measuredNodes(source)) {
    const rect = node.getBoundingClientRect()
    bottom = Math.max(bottom, rect.bottom - originTop, rect.top - originTop + node.scrollHeight)
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
