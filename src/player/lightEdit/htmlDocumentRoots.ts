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
  const documents = new Map<Document, MutationObserver>()
  const rootObserver = new (root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver)(sync)
  function sync(): void {
    const current = managedHtmlDocuments(root)
    const currentFrames = new Set(current.map(item => item.iframe))
    for (const frame of frames) if (!currentFrames.has(frame)) { frame.removeEventListener('load', sync); frames.delete(frame) }
    for (const frame of currentFrames) if (!frames.has(frame)) { frame.addEventListener('load', sync); frames.add(frame) }
    const currentDocs = new Set(current.map(item => item.document))
    for (const [document, observer] of documents) if (!currentDocs.has(document)) { observer.disconnect(); documents.delete(document) }
    for (const item of current) if (!documents.has(item.document)) {
      const Observer = item.document.defaultView?.MutationObserver
      if (!Observer) continue
      const observer = new Observer(onChange)
      observer.observe(item.root, { subtree: true, childList: true, characterData: true, attributes: true })
      documents.set(item.document, observer)
    }
    onChange()
  }
  rootObserver.observe(root, { subtree: true, childList: true })
  sync()
  return () => {
    rootObserver.disconnect()
    for (const frame of frames) frame.removeEventListener('load', sync)
    for (const observer of documents.values()) observer.disconnect()
  }
}

/** An iframe has a separate event tree; authoring gestures reach the outer surface here. */
export function bridgeManagedHtmlEvents(root: HTMLElement): () => void {
  const listeners = new Map<Document, { iframe: HTMLIFrameElement; listener: (event: MouseEvent) => void }>()
  const types = ['pointerdown', 'pointerup', 'dblclick', 'contextmenu'] as const
  const stop = watchManagedHtmlDocuments(root, () => {
    const current = managedHtmlDocuments(root)
    const active = new Set(current.map(item => item.document))
    for (const [document, entry] of listeners) if (!active.has(document)) {
      for (const type of types) document.removeEventListener(type, entry.listener, true)
      listeners.delete(document)
    }
    for (const item of current) if (!listeners.has(item.document)) {
      const listener = (event: MouseEvent) => {
        const point = managedHtmlRect(new DOMRect(event.clientX, event.clientY, 0, 0), item)
        const view = root.ownerDocument.defaultView
        if (!view) return
        const options = {
          bubbles: true, cancelable: true, clientX: point.left, clientY: point.top,
          button: event.button, buttons: event.buttons,
          ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
        }
        const pointer = event as PointerEvent
        const forwarded = event.type.startsWith('pointer') && view.PointerEvent
          ? new view.PointerEvent(event.type, { ...options, pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary })
          : new view.MouseEvent(event.type, options)
        item.iframe.dispatchEvent(forwarded)
      }
      for (const type of types) item.document.addEventListener(type, listener, true)
      listeners.set(item.document, { iframe: item.iframe, listener })
    }
  })
  return () => {
    stop()
    for (const [document, entry] of listeners) for (const type of types) document.removeEventListener(type, entry.listener, true)
    listeners.clear()
  }
}
