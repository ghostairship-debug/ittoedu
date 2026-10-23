import type { ComponentFlowReading, ComponentFlowNavigationMotion } from './contracts/component-platform/teacherController'

export interface FlowNavigationOptions { behavior?: 'instant' | 'smooth'; kind?: 'object' | 'chapter' }

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

/** Resolve against the current layout, in the scroll owner's unscaled CSS pixels. */
function targetTop(scroll: HTMLElement, body: HTMLElement, target: HTMLElement): number | null {
  const scale = scaleOf(body)
  if (!scale || !body.contains(target) || !scroll.isConnected || !body.isConnected) return null
  for (let parent = target.parentElement; parent && parent !== body; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
  const top = scroll.scrollTop + (target.getBoundingClientRect().top - scroll.getBoundingClientRect().top) / scale - scroll.clientTop - marginOf(target)
  return scroll.scrollHeight > 0 ? Math.max(0, Math.min(Math.max(0, scroll.scrollHeight - scroll.clientHeight), top)) : Math.max(0, top)
}

/** Immediate object reveal, also used by the historical Flow carrier. */
export function scrollFlowTarget(scroll: HTMLElement, body: HTMLElement, target: HTMLElement): boolean {
  const top = targetTop(scroll, body, target)
  if (top === null) return false
  scroll.scrollTop = top
  return true
}

/** The mounted reading owner retains an explicit heading when scrolling is clamped.
 * Real scrolling releases that target; this is view state, never author state. */
export function createFlowReadingNavigation(
  elements: () => { scroll: HTMLElement; body: HTMLElement } | null | undefined,
  target: (id: string, kind?: 'object' | 'chapter') => HTMLElement | null | undefined,
) {
  let selected: { id: string; scroll: HTMLElement; body: HTMLElement; top: number; left: number } | undefined
  let motion: Omit<ComponentFlowNavigationMotion, 'containerId'> | undefined, sequence = 0
  let active: { finish(completed: boolean): void } | undefined, releaseAnchor: (() => void) | undefined
  let retired = false, ids: readonly string[] = []
  const listeners = new Set<() => void>()
  const changed = () => { for (const listener of listeners) listener() }
  const cancel = () => { releaseAnchor?.(); releaseAnchor = undefined; selected = undefined; active?.finish(false) }
  const navigation = {
    readMotion: () => motion ? { ...motion } : undefined,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    cancel,
    dispose() { if (retired) return; cancel(); retired = true; listeners.clear() },
    readReading(ids: readonly string[]): Omit<ComponentFlowReading, 'containerId'> | null {
      // The caller supplies the formal directory; no second reading list is stored.
      rememberIds(ids)
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
    goToInstance(id: string | null, signal?: AbortSignal, options: FlowNavigationOptions = {}): boolean | Promise<boolean> {
      if (retired || signal?.aborted) return false
      const view = elements()
      if (!view) return false
      const kind = options.kind ?? 'object', element = id === null ? view.body : target(id, kind)
      const destination = element && (id === null ? 0 : targetTop(view.scroll, view.body, element))
      if (destination === null || destination === undefined || !element) return false
      const fromInstanceId = navigation.readReading(ids)?.activeInstanceId ?? null
      cancel()
      const { scroll, body } = view, win = scroll.ownerDocument.defaultView!
      const start = scroll.scrollTop, distance = Math.abs(destination - start)
      const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const duration = options.behavior === 'instant' || id === null && options.behavior !== 'smooth' || reduced || distance < 1
        ? 0 : Math.min(900, 160 + 240 * Math.log1p(distance / Math.max(1, scroll.clientHeight)))
      motion = { id: ++sequence, kind, status: 'running', fromInstanceId, targetInstanceId: id,
        startScrollTop: start, targetScrollTop: destination, scrollTop: start, progress: 0, elapsedMs: 0, durationMs: duration }
      let frame: number | undefined, settled = false, released = false, observer: ResizeObserver | undefined, result!: (value: boolean) => void
      const finished = new Promise<boolean>(resolve => { result = resolve })
      const current = motion
      const targetPosition = () => id === null ? 0 : targetTop(scroll, body, element)
      const layoutSignature = () => [body.offsetWidth, body.offsetHeight, scroll.scrollHeight, scroll.clientHeight, scaleOf(body)].join('/')
      let lastLayout = layoutSignature()
      const release = () => {
        if (released) return
        released = true
        observer?.disconnect()
        if (frame !== undefined) win.cancelAnimationFrame(frame)
        frame = undefined
        signal?.removeEventListener('abort', aborted)
        for (const name of ['wheel', 'touchstart', 'pointerdown']) scroll.ownerDocument.removeEventListener(name, takeover, true)
        scroll.ownerDocument.removeEventListener('keydown', keyboard, true)
        scroll.removeEventListener('scroll', displaced)
        releaseAnchor = undefined
      }
      const finish = (completed: boolean) => {
        if (settled) return
        settled = true; active = undefined
        if (frame !== undefined) win.cancelAnimationFrame(frame)
        frame = undefined
        signal?.removeEventListener('abort', aborted)
        current.status = completed ? 'completed' : 'cancelled'
        current.scrollTop = scroll.scrollTop
        if (completed) {
          current.progress = 1
          if (id !== null) selected = { id, ...view, top: scroll.scrollTop, left: scroll.scrollLeft }
        } else release()
        changed(); result(completed)
      }
      const aborted = () => finish(false)
      const interrupt = () => {
        release(); selected = undefined
        if (!settled) finish(false)
        else if (motion === current) { motion = undefined; changed() }
      }
      const userDisplaced = (position: number | null) => Math.abs(scroll.scrollTop - current.scrollTop) > 1
        && position !== null && Math.abs(position - current.targetScrollTop) < 0.5 && layoutSignature() === lastLayout
      // Wheel/touch events inside a source iframe do not bubble into this
      // document. Its native scroll chain still changes this real scroll owner.
      const displaced = () => { if (!released && userDisplaced(targetPosition())) interrupt() }
      const takeover = (event: Event) => {
        // Ignore a click on a separate HUD, but catch wheel/touch/scrollbar and
        // scrolling keys in this Flow. The browser then keeps its native input.
        if (event.type === 'keydown') {
          const key = (event as KeyboardEvent).key
          if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)) return
          const node = event.target as HTMLElement | null
          if (node?.closest('input,textarea,select,[contenteditable="true"]')) return
        }
        if (event.target instanceof win.Node && !scroll.contains(event.target) && event.target !== scroll.ownerDocument.body) return
        interrupt()
      }
      // PresenterInput decides at the end of bubbling whether a key is course
      // navigation. Only a remaining native scroll key takes over this motion.
      const keyboard = (event: KeyboardEvent) => win.queueMicrotask(() => {
        if (!released && !event.defaultPrevented) takeover(event)
      })
      releaseAnchor = release
      for (const name of ['wheel', 'touchstart', 'pointerdown']) scroll.ownerDocument.addEventListener(name, takeover, { capture: true, passive: true })
      scroll.ownerDocument.addEventListener('keydown', keyboard, true)
      scroll.addEventListener('scroll', displaced, { passive: true })
      signal?.addEventListener('abort', aborted, { once: true })
      active = { finish }
      const began = win.performance.now()
      const write = (time: number) => {
        frame = undefined
        if (settled) return
        const position = targetPosition()
        if (signal?.aborted || retired || !scroll.isConnected || position === null) { finish(false); return }
        if (userDisplaced(position)) { interrupt(); return }
        lastLayout = layoutSignature()
        const elapsed = Math.min(duration, Math.max(0, time - began)), t = duration ? elapsed / duration : 1
        const eased = 1 - Math.pow(1 - t, 3)
        scroll.scrollTop = start + (position - start) * eased
        current.targetScrollTop = position; current.scrollTop = scroll.scrollTop; current.elapsedMs = elapsed
        current.progress = position === start ? t : clamp((scroll.scrollTop - start) / (position - start))
        if (t === 1) { scroll.scrollTop = position; finish(true) }
        else { changed(); if (!settled) frame = win.requestAnimationFrame(write) }
      }
      // Layout changes after arrival are corrected only while this explicit
      // navigation still owns the anchor. User input releases it immediately.
      const resized = () => {
        if (released || !settled || current.status !== 'completed' || frame !== undefined) return
        frame = win.requestAnimationFrame(() => {
          frame = undefined
          if (released) return
          const position = targetPosition()
          if (position === null || !scroll.isConnected) { release(); return }
          const previousTop = current.scrollTop, previousTarget = current.targetScrollTop
          if (Math.abs(position - scroll.scrollTop) >= 0.5) scroll.scrollTop = position
          current.targetScrollTop = position; current.scrollTop = scroll.scrollTop
          lastLayout = layoutSignature()
          if (id !== null) selected = { id, ...view, top: scroll.scrollTop, left: scroll.scrollLeft }
          if (current.scrollTop !== previousTop || position !== previousTarget) changed()
        })
      }
      observer = win.ResizeObserver ? new win.ResizeObserver(resized) : undefined
      observer?.observe(body); if (element !== body) observer?.observe(element)
      changed()
      if (settled) return false
      if (id === null) scroll.scrollLeft = 0
      if (duration === 0) { write(began); return true }
      frame = win.requestAnimationFrame(write)
      return finished
    },
  }
  function rememberIds(next: readonly string[]) { ids = next }
  return navigation
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
