import type { HtmlSectionRef } from '../../shared/html/htmlSourceScanner'
import { mountHtmlPreviewGeometry } from './htmlPreviewGeometry'

export type HtmlPreviewView = { pageIndex: number; perPageScroll: number }
export type HtmlPreviewPagination = {
  navigate(index: number): void
  readView(): HtmlPreviewView
  restore(view: HtmlPreviewView): void
  destroy(): void
}

let paginationInstance = 0

function pageElements(doc: Document, sections: readonly HtmlSectionRef[]): HTMLElement[] {
  if (sections.length === 0) return []
  const bodySections = Array.from(doc.body.children).filter((child): child is HTMLElement => child.tagName === 'SECTION')
  const mains = Array.from(doc.body.children).filter((child): child is HTMLElement => child.tagName === 'MAIN')
  if (bodySections.length > 0 && mains.length > 0) return []
  const domSections = bodySections.length > 0
    ? bodySections
    : mains.length === 1 ? Array.from(mains[0]!.children).filter((child): child is HTMLElement => child.tagName === 'SECTION') : []
  if (domSections.length !== sections.length) return []
  if (sections.some((section, index) => section.id && domSections[index]!.id !== section.id)) return []
  return domSections
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
}

export function mountPagination(doc: Document, sections: readonly HtmlSectionRef[], onState: (state: HtmlPreviewView) => void): HtmlPreviewPagination {
  const pages = pageElements(doc, sections)
  const win = doc.defaultView
  // Authored visibility already selects pages (for example an .active navigation).
  // Keep that consumer in charge instead of pinning its pages behind a second hidden class.
  const authorPagination = pages.some(page => page.hidden || win?.getComputedStyle(page).display === 'none')
  const hiddenClass = `html-preview-hidden-page-${++paginationInstance}`
  const hiddenStyle = doc.createElement('style')
  hiddenStyle.textContent = `.${hiddenClass}{display:none!important}`
  if (pages.length && !authorPagination) doc.head.append(hiddenStyle)
  const pageScroll = new Map<number, number>()
  pageScroll.set(0, win?.scrollY ?? 0)
  let pageIndex = 0
  let composing = false
  let destroyed = false
  let geometry: ReturnType<typeof mountHtmlPreviewGeometry> | null = null
  const readView = (): HtmlPreviewView => ({ pageIndex, perPageScroll: pageScroll.get(pageIndex) ?? win?.scrollY ?? 0 })
  const emit = () => { if (!destroyed) onState(readView()) }
  const show = (index: number) => {
    if (!authorPagination) pages.forEach((page, position) => { page.classList.toggle(hiddenClass, position !== index) })
    geometry?.destroy()
    geometry = pages[index] ? mountHtmlPreviewGeometry(pages[index]!) : null
  }
  const navigate = (index: number) => {
    if (destroyed || pages.length === 0 || authorPagination || !Number.isFinite(index)) return
    const next = Math.max(0, Math.min(pages.length - 1, Math.trunc(index)))
    if (next === pageIndex) return
    pageScroll.set(pageIndex, win?.scrollY ?? 0)
    pageIndex = next
    show(pageIndex)
    win?.scrollTo(0, pageScroll.get(pageIndex) ?? 0)
    emit()
  }
  const restore = (view: HtmlPreviewView) => {
    if (destroyed || pages.length === 0 || authorPagination) return
    const index = Number.isFinite(view.pageIndex) ? Math.max(0, Math.min(pages.length - 1, Math.trunc(view.pageIndex))) : 0
    const scroll = Number.isFinite(view.perPageScroll) ? Math.max(0, view.perPageScroll) : 0
    pageIndex = index
    pageScroll.set(index, scroll)
    show(index)
    win?.scrollTo(0, scroll)
    emit()
  }
  const onScroll = () => { if (pages.length) { pageScroll.set(pageIndex, win?.scrollY ?? 0); emit() } }
  const onCompositionStart = () => { composing = true }
  const onCompositionEnd = () => { composing = false }
  const onKeyDown = (event: KeyboardEvent) => {
    if (destroyed || authorPagination || pages.length < 2 || event.defaultPrevented || event.isComposing || composing || editableTarget(event.target)) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const next = pageIndex + (event.key === 'ArrowRight' ? 1 : -1)
    if (next < 0 || next >= pages.length) return
    event.preventDefault()
    navigate(next)
  }
  doc.addEventListener('compositionstart', onCompositionStart)
  doc.addEventListener('compositionend', onCompositionEnd)
  win?.addEventListener('keydown', onKeyDown)
  win?.addEventListener('scroll', onScroll, { passive: true })
  const syncAuthorPage = () => {
    const index = pages.findIndex(page => !page.hidden && win?.getComputedStyle(page).display !== 'none')
    if (index < 0 || index === pageIndex && geometry) return
    pageIndex = index; show(index); emit()
  }
  const authorChanges = authorPagination && win ? new win.MutationObserver(syncAuthorPage) : null
  if (authorChanges) for (const page of pages) authorChanges.observe(page, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
  if (pages.length) authorPagination ? syncAuthorPage() : show(pageIndex)
  emit()
  return {
    navigate, readView, restore,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      authorChanges?.disconnect()
      geometry?.destroy()
      doc.removeEventListener('compositionstart', onCompositionStart)
      doc.removeEventListener('compositionend', onCompositionEnd)
      win?.removeEventListener('keydown', onKeyDown)
      win?.removeEventListener('scroll', onScroll)
      pages.forEach(page => { page.classList.remove(hiddenClass) })
      hiddenStyle.remove()
    },
  }
}
