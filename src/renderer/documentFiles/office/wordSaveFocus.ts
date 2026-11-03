import type { EditorView } from 'prosemirror-view'

/** History and OOXML-only commands temporarily disable input, which Chromium blurs. */
export function captureWordSaveFocus(view: EditorView | undefined, stillActive: () => boolean) {
  if (!view?.hasFocus() || !view.dom.ownerDocument.hasFocus()) return (_restore: boolean) => {}
  const document = view.dom.ownerDocument, window = document.defaultView
  let cancelled = false, released = false
  const cancel = () => { cancelled = true }
  const focus = (event: FocusEvent) => {
    if (event.target !== view.dom && event.target !== document.body) cancel()
  }
  document.addEventListener('pointerdown', cancel, true)
  document.addEventListener('focusin', focus, true)
  window?.addEventListener('blur', cancel)
  return (restore: boolean) => {
    if (released) return
    released = true
    document.removeEventListener('pointerdown', cancel, true)
    document.removeEventListener('focusin', focus, true)
    window?.removeEventListener('blur', cancel)
    if (restore && !cancelled && stillActive() && !view.isDestroyed && view.dom.isConnected && document.hasFocus() &&
      (!document.activeElement || document.activeElement === document.body || document.activeElement === view.dom)) view.focus()
  }
}
