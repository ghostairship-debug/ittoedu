const MANAGED_IFRAME_SELECTOR = 'iframe[data-html-document-runtime="true"]'

export interface ManagedHtmlDocument {
  iframe: HTMLIFrameElement
  document: Document
  root: HTMLElement
}

/** Only software-created HTML document carriers participate in light editing. */
export function managedHtmlDocuments(root: ParentNode): ManagedHtmlDocument[] {
  const documents: ManagedHtmlDocument[] = []
  for (const iframe of root.querySelectorAll<HTMLIFrameElement>(MANAGED_IFRAME_SELECTOR)) {
    try {
      const document = iframe.contentDocument
      if (document?.documentElement) documents.push({ iframe, document, root: document.documentElement })
    } catch { /* An inaccessible document is not a light-edit root. */ }
  }
  return documents
}

/** The painted part of a DOM target, before any iframe coordinate mapping. */
export function visibleDomRect(rect: DOMRect, element: Element): DOMRect | null {
  const document = element.ownerDocument
  const view = document.defaultView
  const viewport = document.documentElement
  let left = Math.max(rect.left, 0)
  let top = Math.max(rect.top, 0)
  let right = Math.min(rect.right, view?.innerWidth || viewport.clientWidth)
  let bottom = Math.min(rect.bottom, view?.innerHeight || viewport.clientHeight)
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor)
    if (!style) continue
    const overflowX = style.overflowX || style.overflow
    const overflowY = style.overflowY || style.overflow
    const clipsX = /^(hidden|clip|auto|scroll)$/.test(overflowX)
    const clipsY = /^(hidden|clip|auto|scroll)$/.test(overflowY)
    if (!clipsX && !clipsY) continue
    const bounds = ancestor.getBoundingClientRect()
    const clipLeft = bounds.left + ancestor.clientLeft
    const clipTop = bounds.top + ancestor.clientTop
    if (clipsX) {
      left = Math.max(left, clipLeft)
      right = Math.min(right, clipLeft + (ancestor.clientWidth || bounds.width))
    }
    if (clipsY) {
      top = Math.max(top, clipTop)
      bottom = Math.min(bottom, clipTop + (ancestor.clientHeight || bounds.height))
    }
  }
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

/** A child document's viewport rectangle expressed in the outer document. */
export function managedHtmlRect(rect: DOMRect, managed: ManagedHtmlDocument): DOMRect {
  const frame = managed.iframe.getBoundingClientRect()
  const view = managed.document.defaultView
  const width = view?.innerWidth || managed.iframe.clientWidth || frame.width
  const height = view?.innerHeight || managed.iframe.clientHeight || frame.height
  const sx = frame.width / Math.max(1, width)
  const sy = frame.height / Math.max(1, height)
  const left = frame.left + rect.left * sx
  const top = frame.top + rect.top * sy
  return new DOMRect(left, top, rect.width * sx, rect.height * sy)
}

/** Tracks loads, React redraws, and removal without following arbitrary iframes. */
export function watchManagedHtmlDocuments(root: HTMLElement, onChange: () => void): () => void {
  const frames = new Set<HTMLIFrameElement>()
  const documents = new Map<Document, { observer: MutationObserver; scroll: () => void; view: Window | null }>()
  const rootObserver = new (root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver)(sync)
  function sync(): void {
    const current = managedHtmlDocuments(root)
    const currentFrames = new Set(current.map(item => item.iframe))
    for (const frame of frames) if (!currentFrames.has(frame)) { frame.removeEventListener('load', sync); frames.delete(frame) }
    for (const frame of currentFrames) if (!frames.has(frame)) { frame.addEventListener('load', sync); frames.add(frame) }
    const currentDocs = new Set(current.map(item => item.document))
    for (const [document, entry] of documents) if (!currentDocs.has(document)) {
      entry.observer.disconnect()
      document.removeEventListener('scroll', entry.scroll, true)
      entry.view?.removeEventListener('scroll', entry.scroll, true)
      documents.delete(document)
    }
    for (const item of current) if (!documents.has(item.document)) {
      const Observer = item.document.defaultView?.MutationObserver
      if (!Observer) continue
      const observer = new Observer(onChange)
      observer.observe(item.root, { subtree: true, childList: true, characterData: true, attributes: true })
      const scroll = () => onChange()
      item.document.addEventListener('scroll', scroll, true)
      item.document.defaultView?.addEventListener('scroll', scroll, true)
      documents.set(item.document, { observer, scroll, view: item.document.defaultView })
    }
    onChange()
  }
  rootObserver.observe(root, { subtree: true, childList: true })
  sync()
  return () => {
    rootObserver.disconnect()
    for (const frame of frames) frame.removeEventListener('load', sync)
    for (const [document, entry] of documents) {
      entry.observer.disconnect()
      document.removeEventListener('scroll', entry.scroll, true)
      entry.view?.removeEventListener('scroll', entry.scroll, true)
    }
    documents.clear()
  }
}

/** An iframe has a separate event tree; authoring gestures reach the outer surface here. */
export function bridgeManagedHtmlEvents(root: HTMLElement): () => void {
  type ActivePointer = { clientX: number; clientY: number; pointerType: string; isPrimary: boolean }
  type Entry = { iframe: HTMLIFrameElement; listener: (event: MouseEvent) => void; active: Map<number, ActivePointer>; pendingClicks: Set<number> }
  const listeners = new Map<Document, Entry>()
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'click', 'dblclick', 'contextmenu'] as const
  const view = root.ownerDocument.defaultView
  const pointerEvent = (type: string, pointerId: number, state: ActivePointer): Event | null => {
    if (!view) return null
    const options = { bubbles: true, cancelable: true, clientX: state.clientX, clientY: state.clientY, pointerId, pointerType: state.pointerType, isPrimary: state.isPrimary }
    return view.PointerEvent ? new view.PointerEvent(type, options) : new view.MouseEvent(type, options)
  }
  const cancelActive = (entry: Entry) => {
    for (const [pointerId, state] of entry.active) {
      const event = pointerEvent('pointercancel', pointerId, state)
      if (event) root.dispatchEvent(event)
    }
    entry.active.clear()
    entry.pendingClicks.clear()
  }
  const remove = (document: Document, entry: Entry) => {
    cancelActive(entry)
    for (const type of types) document.removeEventListener(type, entry.listener, true)
    listeners.delete(document)
  }
  const stop = watchManagedHtmlDocuments(root, () => {
    const current = managedHtmlDocuments(root)
    const active = new Set(current.map(item => item.document))
    for (const [document, entry] of listeners) if (!active.has(document)) remove(document, entry)
    for (const item of current) if (!listeners.has(item.document)) {
      const entry: Entry = { iframe: item.iframe, active: new Map(), pendingClicks: new Set(), listener: () => undefined }
      entry.listener = (event: MouseEvent) => {
        const pointer = event as PointerEvent
        if (event.type === 'click') {
          if (event.detail > 0 && entry.pendingClicks.delete(pointer.pointerId)) {
            event.preventDefault()
            event.stopImmediatePropagation()
          }
          return
        }
        if (event.type === 'pointerdown') entry.pendingClicks.delete(pointer.pointerId)
        const isPointer = event.type.startsWith('pointer') || event.type === 'lostpointercapture'
        const wasActive = isPointer && entry.active.has(pointer.pointerId)
        if ((event.type === 'pointermove' || event.type === 'pointercancel' || event.type === 'lostpointercapture') && !wasActive) return
        const type = event.type === 'lostpointercapture' ? 'pointercancel' : event.type
        const point = managedHtmlRect(new DOMRect(event.clientX, event.clientY, 0, 0), item)
        if (!view) return
        const options = {
          bubbles: true, cancelable: true, clientX: point.left, clientY: point.top,
          button: event.button, buttons: event.buttons,
          ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
        }
        const forwarded = isPointer && view.PointerEvent
          ? new view.PointerEvent(type, { ...options, pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary })
          : new view.MouseEvent(type, options)
        let stopped = false
        const stopPropagation = forwarded.stopPropagation.bind(forwarded)
        const stopImmediately = forwarded.stopImmediatePropagation.bind(forwarded)
        forwarded.stopPropagation = () => { stopped = true; stopPropagation() }
        forwarded.stopImmediatePropagation = () => { stopped = true; stopImmediately() }
        item.iframe.dispatchEvent(forwarded)
        const consumed = forwarded.defaultPrevented || stopped
        if (event.type === 'pointerdown' && consumed) {
          entry.active.set(pointer.pointerId, { clientX: point.left, clientY: point.top, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary })
        } else if (wasActive && (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture')) {
          entry.active.delete(pointer.pointerId)
          if (event.type === 'pointerup') entry.pendingClicks.add(pointer.pointerId)
          else entry.pendingClicks.delete(pointer.pointerId)
        } else if (wasActive) {
          entry.active.set(pointer.pointerId, { clientX: point.left, clientY: point.top, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary })
        }
        if (consumed || wasActive) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
      for (const type of types) item.document.addEventListener(type, entry.listener, true)
      listeners.set(item.document, entry)
    }
  })
  return () => {
    stop()
    for (const [document, entry] of listeners) remove(document, entry)
  }
}
