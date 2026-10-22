import type { ComponentFlowReading } from './contracts/component-platform/teacherController'

export interface FlowReadingTarget { id: string; element: HTMLElement | null | undefined }
const clamp = (value: number) => Math.max(0, Math.min(1, value))
function scaleOf(body: HTMLElement): number {
  const scale = body.offsetWidth > 0 ? body.getBoundingClientRect().width / body.offsetWidth : 0
  return Number.isFinite(scale) && scale > 0 ? scale : 0
}
function marginOf(target: HTMLElement): number {
  return parseFloat(target.ownerDocument.defaultView?.getComputedStyle(target).scrollMarginTop ?? '') || 0
}

/** Facts from one mounted Flow. Authoring's extra blank paper is outside body. */
export function readFlowReading(scroll: HTMLElement, body: HTMLElement,
  targets: readonly FlowReadingTarget[]): Omit<ComponentFlowReading, 'containerId'> | null {
  const scale = scaleOf(body)
  if (!scale || !scroll.isConnected || !body.isConnected) return null
  const scrollRect = scroll.getBoundingClientRect(), origin = scrollRect.top + scroll.clientTop * scale
  const contentEnd = (body.getBoundingClientRect().bottom - origin) / scale + scroll.scrollTop
  const range = Math.max(0, contentEnd - scroll.clientHeight)
  let activeInstanceId: string | null = null, lastVisible: string | null = null
  for (const { id, element } of targets) {
    if (!element || !body.contains(element)) continue
    const rect = element.getBoundingClientRect()
    if (!rect.width && !rect.height) continue
    if (rect.top < scrollRect.bottom) lastVisible = id
    if (activeInstanceId === null && rect.top < scrollRect.bottom) activeInstanceId = id
    if ((rect.top - origin) / scale <= marginOf(element) + 1) activeInstanceId = id
  }
  if (range > 0 && scroll.scrollTop >= range - 1 && lastVisible) activeInstanceId = lastVisible
  return { activeInstanceId, progress: range > 0 ? clamp(scroll.scrollTop / range) : 1 }
}

/** The same scroll coordinates and authored scroll-margin apply to every carrier. */
export function scrollFlowTarget(scroll: HTMLElement, body: HTMLElement, target: HTMLElement): boolean {
  const scale = scaleOf(body)
  if (!scale || !body.contains(target) || !scroll.isConnected) return false
  for (let parent = target.parentElement; parent && parent !== body; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
  scroll.scrollTop += (target.getBoundingClientRect().top - scroll.getBoundingClientRect().top) / scale - scroll.clientTop - marginOf(target)
  return true
}

/** The mounted reading owner retains an explicit heading when scrolling is clamped.
 * Real scrolling releases that target; this is view state, never author state. */
export function createFlowReadingNavigation(
  elements: () => { scroll: HTMLElement; body: HTMLElement } | null | undefined,
  target: (id: string) => HTMLElement | null | undefined,
) {
  let selected: { id: string; scroll: HTMLElement; body: HTMLElement; top: number; left: number } | undefined
  return {
    readReading(ids: readonly string[]): Omit<ComponentFlowReading, 'containerId'> | null {
      const view = elements()
      if (!view) { selected = undefined; return null }
      const reading = readFlowReading(view.scroll, view.body, ids.map(id => ({ id, element: target(id) })))
      if (selected) {
        const element = ids.includes(selected.id) ? target(selected.id) : null
        const rect = element?.getBoundingClientRect()
        if (selected.scroll !== view.scroll || selected.body !== view.body || selected.top !== view.scroll.scrollTop
          || selected.left !== view.scroll.scrollLeft || !element || !view.body.contains(element) || !rect || !rect.width && !rect.height) selected = undefined
      }
      return reading && selected ? { ...reading, activeInstanceId: selected.id } : reading
    },
    goToInstance(id: string | null, signal?: AbortSignal): boolean {
      if (signal?.aborted) return false
      const view = elements()
      if (!view) return false
      if (id === null) { selected = undefined; view.scroll.scrollTop = 0; view.scroll.scrollLeft = 0; return true }
      const element = target(id)
      if (!element || !scrollFlowTarget(view.scroll, view.body, element)) return false
      selected = { id, ...view, top: view.scroll.scrollTop, left: view.scroll.scrollLeft }
      return true
    },
  }
}

/** Observe existing geometry, coalescing notifications without creating author state. */
export function observeFlowReading(scroll: HTMLElement, body: HTMLElement, listener: () => void): () => void {
  const view = scroll.ownerDocument.defaultView
  if (!view) return () => {}
  let frame: number | undefined, previous = '', retired = false
  const changed = () => {
    if (retired || frame !== undefined) return
    frame = view.requestAnimationFrame(() => {
      frame = undefined
      if (retired) return
      const signature = [scroll.scrollTop, scroll.scrollLeft, scroll.clientWidth, scroll.clientHeight, body.offsetWidth, body.offsetHeight, body.scrollHeight].join('/')
      if (signature !== previous) { previous = signature; listener() }
    })
  }
  scroll.addEventListener('scroll', changed, { passive: true })
  const Observer = view.ResizeObserver
  const observer = Observer ? new Observer(changed) : undefined
  observer?.observe(scroll); observer?.observe(body)
  changed()
  return () => {
    retired = true; scroll.removeEventListener('scroll', changed); observer?.disconnect()
    if (frame !== undefined) view.cancelAnimationFrame(frame)
  }
}
