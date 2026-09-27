import { preservesManagedHtmlVisibility } from './managedHtmlContentVisibility'
import { inspectManagedHtmlFlowProfile, managedHtmlPaintSnapshot, managedHtmlStylesheetSignature } from './managedHtmlFlowAdmissionProfile'

/** A measurement document never runs the imported page's code or changes its viewport. */
export interface ManagedHtmlMeasurementSource {
  kind: 'managed-document'
  iframe: HTMLIFrameElement
  origin: HTMLElement
  minimumHeight: number
}

const FAILURE = '此 HTML 页面无法自动适配 Flow 高度；请使用固定视口的演示页。'


function unsupported(reason: string): Error { return new Error(`${FAILURE} ${reason}`) }

function abortError(): DOMException { return new DOMException('HTML 高度测量已取消', 'AbortError') }

function requireCurrent(source: ManagedHtmlMeasurementSource, signal: AbortSignal): void {
  if (signal.aborted || !source.iframe.isConnected || source.iframe.contentDocument !== source.origin.ownerDocument) throw abortError()
}

interface MeasuredImageIntrinsicSize { width: number; height: number }

function readLoadedImageSize(image: HTMLImageElement): MeasuredImageIntrinsicSize {
  const width = image.naturalWidth, height = image.naturalHeight
  if (!image.complete || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw unsupported('图片尚未完成加载或没有有效固有尺寸。')
  }
  return { width, height }
}

function createMeasurementImageSource({ width, height }: MeasuredImageIntrinsicSize): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"/>`)}`
}

/** Copy CSS through CSSOM: the browser, rather than a rule heuristic, owns the cascade. */
function copyDocument(source: Document, destination: Document): Array<[Element, Element]> {
  const inert = source.implementation.createHTMLDocument('')
  const copy = inert.importNode(source.documentElement, true)
  const originals = [source.documentElement, ...source.documentElement.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  const pairs: Array<[Element, Element]> = []
  for (let index = 0; index < originals.length; index += 1) {
    const original = originals[index]!
    const element = copies[index]!
    if (original.shadowRoot || original.localName.includes('-')) throw unsupported('不支持隔离复制自定义元素或 Shadow DOM。')
    if (['iframe', 'frame', 'object', 'embed'].includes(original.localName)) throw unsupported('页面包含另一嵌入文档。')
    if (['script', 'base'].includes(original.localName) || (original.localName === 'meta' && original.hasAttribute('http-equiv'))) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['autofocus', 'autoplay'].includes(attribute.name)) element.removeAttribute(attribute.name)
    }
    if (original.localName === 'style' || (original.localName === 'link' && original.getAttribute('rel')?.toLowerCase() === 'stylesheet')) {
      const sheet = (original as HTMLStyleElement | HTMLLinkElement).sheet
      const style = inert.createElement('style')
      if (sheet) {
        try { style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n') }
        catch { throw unsupported('样式表无法在隔离文档中读取。') }
        if (sheet.disabled) style.media = 'not all'
        else if (sheet.media.mediaText) style.media = sheet.media.mediaText
      }
      element.replaceWith(style)
      continue
    }
    if (original.localName === 'link') { element.remove(); continue }
    if (original.localName === 'img') {
      const size = readLoadedImageSize(original as HTMLImageElement)
      element.removeAttribute('srcset')
      element.removeAttribute('sizes')
      // Only the inert mirror sees this no-network placeholder; live capture keeps the real image.
      element.setAttribute('src', createMeasurementImageSource(size))
    }
    if (['audio', 'video', 'source', 'track'].includes(original.localName)) {
      element.removeAttribute('src')
      element.removeAttribute('srcset')
      if (original.localName === 'source') element.removeAttribute('sizes')
      if (original.localName === 'video') {
        const video = original as HTMLVideoElement
        // The inert poster preserves the loaded video's intrinsic ratio without playback.
        if (video.videoWidth && video.videoHeight) element.setAttribute('poster', `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${video.videoWidth}" height="${video.videoHeight}"/>`)}`)
      }
    }
    if (original.localName === 'input') {
      const input = original as HTMLInputElement
      ;(element as HTMLInputElement).value = input.value
      ;(element as HTMLInputElement).checked = input.checked
    }
    if (original.localName === 'textarea') (element as HTMLTextAreaElement).value = (original as HTMLTextAreaElement).value
    if (original.localName === 'option') (element as HTMLOptionElement).selected = (original as HTMLOptionElement).selected
    pairs.push([original, element])
  }
  if (source.adoptedStyleSheets.length) throw unsupported('页面使用了无法独立复制的 adoptedStyleSheets。')
  const head = copy.querySelector('head')!
  const policy = inert.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  head.prepend(policy)
  // adoptNode retains form property state and the pair identities used for layout validation.
  destination.replaceChild(destination.adoptNode(copy), destination.documentElement)
  return pairs
}

function bounds(document: Document): number {
  return Math.ceil(Math.max(document.documentElement.scrollHeight, document.documentElement.getBoundingClientRect().bottom + (document.defaultView?.scrollY ?? 0)))
}

function equivalentLayout(pairs: Array<[Element, Element]>, source: Document, mirror: Document): boolean {
  const sy = source.defaultView?.scrollY ?? 0
  const my = mirror.defaultView?.scrollY ?? 0
  const sx = source.defaultView?.scrollX ?? 0
  const mx = mirror.defaultView?.scrollX ?? 0
  return pairs.every(([original, copy]) => {
    if (!copy.isConnected) return true
    const left = original.getBoundingClientRect()
    const right = copy.getBoundingClientRect()
    return Math.abs(left.width - right.width) <= 1 && Math.abs(left.height - right.height) <= 1
      && Math.abs(left.top + sy - right.top - my) <= 1 && Math.abs(left.left + sx - right.left - mx) <= 1
  })
}

export async function measureManagedHtmlContent(source: ManagedHtmlMeasurementSource, signal: AbortSignal): Promise<number> {
  requireCurrent(source, signal)
  const live = source.origin.ownerDocument
  const profile = inspectManagedHtmlFlowProfile(live)
  const parent = source.iframe.ownerDocument
  const frame = parent.createElement('iframe')
  frame.dataset.htmlHeightMeasurement = 'true'
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-100000px;top:0;border:0;visibility:hidden;pointer-events:none;width:${source.iframe.clientWidth}px;height:${source.iframe.clientHeight}px;`
  const remove = () => frame.remove()
  signal.addEventListener('abort', remove, { once: true })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const abort = () => { cleanup(); reject(abortError()) }
        const cleanup = () => { frame.onload = null; signal.removeEventListener('abort', abort) }
        signal.addEventListener('abort', abort, { once: true })
        frame.onload = () => { cleanup(); resolve() }
        frame.srcdoc = `${live.compatMode === 'CSS1Compat' ? '<!doctype html>' : ''}<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:"></head><body></body></html>`
        parent.body.append(frame)
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(unsupported('隔离文档加载超时。')), 3000) }),
    ])
    requireCurrent(source, signal)
    const mirror = frame.contentDocument!
    const pairs = copyDocument(live, mirror)
    // Force layout before waiting so the clone starts the fonts and image loads it needs.
    bounds(mirror)
    await Promise.race([
      Promise.all([mirror.fonts.ready, ...[...mirror.images].filter(image => image.getAttribute('src')).map(image => image.decode().catch(() => { throw unsupported('隔离图片加载失败。') }))]),
      new Promise<never>((_, reject) => { if (timeout) clearTimeout(timeout); timeout = setTimeout(() => reject(unsupported('隔离资源加载超时。')), 3000) }),
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true })),
    ])
    requireCurrent(source, signal)
    for (const [original, copy] of pairs) { copy.scrollTop = original.scrollTop; copy.scrollLeft = original.scrollLeft }
    if (!equivalentLayout(pairs, live, mirror)) throw unsupported('隔离布局与当前页面不一致。')
    for (const [original, copy] of pairs) {
      if (profile.minimumRoots.has(original)) (copy as HTMLElement).style.setProperty('min-height', '0px', 'important')
    }
    frame.style.height = '1px'
    const height = Math.max(Math.ceil(source.minimumHeight), bounds(mirror))
    if (!Number.isFinite(height) || height > 1_000_000) throw unsupported('页面高度超过可测量范围。')
    frame.style.height = `${height}px`
    if (bounds(mirror) > height || !preservesManagedHtmlVisibility(pairs)) throw unsupported('无法证明调整高度后的内容可见性。')
    for (const [original, copy] of pairs) {
      if (!copy.isConnected) continue
      const a = original.getBoundingClientRect(), b = copy.getBoundingClientRect()
      const container = profile.transparentRoots.has(original)
      if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.width - b.width) > 1 || (!container && Math.abs(a.height - b.height) > 1)) throw unsupported('内容几何在调整高度时改变。')
      const left = managedHtmlPaintSnapshot(original, container, profile.minimumRoots.has(original))
      const right = managedHtmlPaintSnapshot(copy, container, profile.minimumRoots.has(original))
      if (left.length !== right.length || left.some((value, index) => value !== right[index])) throw unsupported('内容绘制样式在调整高度时改变。')
    }
    requireCurrent(source, signal)
    if (managedHtmlStylesheetSignature(live) !== profile.stylesheetSignature) throw unsupported('测量期间样式表发生变化。')
    return height
  } finally {
    if (timeout) clearTimeout(timeout)
    signal.removeEventListener('abort', remove)
    remove()
  }
}
