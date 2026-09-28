type PlaceholderTarget = HTMLImageElement | HTMLAudioElement | HTMLVideoElement
type PlaceholderRecord = { overlay: HTMLDivElement; width: string; height: string; display: string; widthPriority: string; heightPriority: string; displayPriority: string; fallbackWidth: string; fallbackHeight: string; fallbackDisplay: string }

function missingSource(target: PlaceholderTarget): boolean {
  if (target.getAttribute('src')?.trim()) return false
  if (target instanceof HTMLImageElement) {
    if (target.getAttribute('srcset')?.trim()) return false
    return !Array.from(target.closest('picture')?.querySelectorAll('source') ?? []).some(source => Boolean(source.getAttribute('srcset')?.trim()))
  }
  return !Array.from(target.querySelectorAll('source')).some(source => Boolean(source.getAttribute('src')?.trim()))
}

function description(target: PlaceholderTarget): string {
  const type = target instanceof HTMLImageElement ? '图片' : target instanceof HTMLAudioElement ? '音频' : '视频'
  const text = target instanceof HTMLImageElement ? target.getAttribute('alt') : target.getAttribute('title')
  return text?.trim() ? `${type}：${text.trim()}` : type
}

/** Runtime-only overlays leave the original media nodes available for selection and replacement. */
export function mountPlaceholders(root: Document | Element): { refresh(): void; destroy(): void } {
  const doc = root instanceof Document ? root : root.ownerDocument
  const win = doc.defaultView
  const records = new Map<PlaceholderTarget, PlaceholderRecord>()
  let destroyed = false
  const observer = win?.ResizeObserver ? new win.ResizeObserver(() => position()) : null
  const visibleAncestors = (target: PlaceholderTarget) => {
    for (let node = target.parentElement; node; node = node.parentElement) {
      const style = win?.getComputedStyle(node)
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.contentVisibility === 'hidden') return false
    }
    return true
  }
  const ensureFallback = (target: PlaceholderTarget, record: PlaceholderRecord) => {
    if (!target.isConnected || !visibleAncestors(target)) return
    const style = win?.getComputedStyle(target)
    if (style?.display === 'none' || style?.visibility === 'hidden') return
    if (target instanceof HTMLImageElement && style?.display === 'inline' && !record.fallbackDisplay) {
      record.fallbackDisplay = 'inline-block'
      target.style.setProperty('display', record.fallbackDisplay)
    }
    const rect = target.getBoundingClientRect()
    if (rect.width < 1 && !record.width && !record.fallbackWidth && !target.hasAttribute('width')) {
      record.fallbackWidth = target instanceof HTMLImageElement ? '160px' : '240px'
      target.style.setProperty('width', record.fallbackWidth)
    }
    if (rect.height < 1 && !record.height && !record.fallbackHeight && !target.hasAttribute('height')) {
      record.fallbackHeight = '90px'
      target.style.setProperty('height', record.fallbackHeight)
    }
  }
  const position = () => {
    if (destroyed) return
    for (const [target, record] of records) {
      ensureFallback(target, record)
      const targetStyle = win?.getComputedStyle(target)
      if (!(target instanceof HTMLImageElement) && targetStyle?.display === 'none') {
        if (record.overlay.previousSibling !== target) target.after(record.overlay)
        record.overlay.style.position = 'relative'
        record.overlay.style.left = ''
        record.overlay.style.top = ''
        record.overlay.style.width = targetStyle.width && targetStyle.width !== 'auto' && targetStyle.width !== '0px' ? targetStyle.width : '240px'
        record.overlay.style.height = targetStyle.height && targetStyle.height !== 'auto' && targetStyle.height !== '0px' ? targetStyle.height : '72px'
        record.overlay.style.display = 'inline-flex'
        continue
      }
      const rect = target.getBoundingClientRect()
      const visible = rect.width > 0 && rect.height > 0 && targetStyle?.visibility !== 'hidden' && visibleAncestors(target)
      if (record.overlay.parentNode !== doc.body) doc.body.append(record.overlay)
      record.overlay.style.position = 'fixed'
      record.overlay.style.display = visible ? 'flex' : 'none'
      if (!visible) continue
      record.overlay.style.left = `${rect.left}px`
      record.overlay.style.top = `${rect.top}px`
      record.overlay.style.width = `${rect.width}px`
      record.overlay.style.height = `${rect.height}px`
    }
  }
  const remove = (target: PlaceholderTarget) => {
    const record = records.get(target)
    if (!record) return
    if (record.fallbackWidth && target.style.width === record.fallbackWidth) {
      target.style.removeProperty('width')
      if (record.width) target.style.setProperty('width', record.width, record.widthPriority)
    }
    if (record.fallbackHeight && target.style.height === record.fallbackHeight) {
      target.style.removeProperty('height')
      if (record.height) target.style.setProperty('height', record.height, record.heightPriority)
    }
    if (record.fallbackDisplay && target.style.display === record.fallbackDisplay) {
      target.style.removeProperty('display')
      if (record.display) target.style.setProperty('display', record.display, record.displayPriority)
    }
    record.overlay.remove()
    observer?.unobserve(target)
    records.delete(target)
  }
  const refresh = () => {
    if (destroyed) return
    const targets = Array.from(root.querySelectorAll('img, audio, video')).filter((element): element is PlaceholderTarget =>
      element instanceof HTMLImageElement || element instanceof HTMLAudioElement || element instanceof HTMLVideoElement)
    const needed = new Set(targets.filter(missingSource))
    for (const target of records.keys()) if (!needed.has(target) || !target.isConnected) remove(target)
    for (const target of needed) {
      const existing = records.get(target)
      if (existing) { existing.overlay.textContent = description(target); continue }
      const record: PlaceholderRecord = {
        overlay: doc.createElement('div'),
        width: target.style.getPropertyValue('width'), height: target.style.getPropertyValue('height'),
        display: target.style.getPropertyValue('display'),
        widthPriority: target.style.getPropertyPriority('width'), heightPriority: target.style.getPropertyPriority('height'),
        displayPriority: target.style.getPropertyPriority('display'),
        fallbackWidth: '', fallbackHeight: '', fallbackDisplay: '',
      }
      record.overlay.dataset.htmlPreviewPlaceholder = target.tagName.toLowerCase()
      record.overlay.setAttribute('aria-hidden', 'true')
      record.overlay.textContent = description(target)
      Object.assign(record.overlay.style, {
        position: 'fixed', boxSizing: 'border-box', zIndex: '2147483646', pointerEvents: 'none',
        alignItems: 'center', justifyContent: 'center', padding: '8px', overflow: 'hidden',
        color: '#333', background: '#f3f4f6', border: '1px dashed #9ca3af', font: '14px sans-serif',
      })
      doc.body.append(record.overlay)
      records.set(target, record)
      observer?.observe(target)
    }
    position()
  }
  observer?.observe(doc.documentElement)
  win?.addEventListener('resize', position)
  win?.addEventListener('scroll', position, { passive: true })
  refresh()
  return {
    refresh,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      observer?.disconnect()
      win?.removeEventListener('resize', position)
      win?.removeEventListener('scroll', position)
      for (const target of Array.from(records.keys())) remove(target)
    },
  }
}
