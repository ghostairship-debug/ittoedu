import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Presentation, Slide } from '@web-ppt/core'
import type { Viewer } from '@web-ppt/viewer-core'
import './pptxFilePreview.css'

export interface PptxFilePreviewProps {
  /** A snapshot read by the existing file owner. This view never writes these bytes. */
  bytes: Uint8Array
  name: string
  active?: boolean
  onOpenExternal?(): Promise<void> | void
  onImportToCourse?(): Promise<void> | void
  onReload?(): Promise<void> | void
}

interface PageNotice { externalAssets: number; media: number; unsupported: string[] }
interface LoadedPresentation {
  bytes: Uint8Array
  presentation: Presentation
  notices: Map<number, PageNotice>
  fonts(slides: Iterable<Slide>): Array<{ family: string }>
}
const emptyPage = { index: 0, count: 0, done: 0, total: 0, pending: false }

/** Policy applies only to a disposable render projection; the original OOXML is untouched. */
function prepareLocalPreview(presentation: Presentation): Map<number, PageNotice> {
  const sourceSlides = presentation.slides
  const notices = new Map<number, PageNotice>()
  const slides = new Array<Slide>(sourceSlides.length)
  for (let index = 0; index < sourceSlides.length; index++) {
    Object.defineProperty(slides, index, { enumerable: true, configurable: true, get: () => {
      const slide = sourceSlides[index]!
      if (!notices.has(index)) {
        const notice: PageNotice = { externalAssets: 0, media: 0, unsupported: [] }
        const visited = new WeakSet<object>()
        const walk = (value: unknown) => {
          if (!value || typeof value !== 'object' || visited.has(value)) return
          visited.add(value)
          const record = value as Record<string, unknown>
          if (record.kind === 'unsupported' && typeof record.label === 'string') notice.unsupported.push(record.label)
          if ((record.kind === 'audio' || record.kind === 'video') && 'src' in record) notice.media++
          for (const [key, child] of Object.entries(record)) {
            // Package assets are blob/data URLs. A linked image must not silently
            // contact an external site merely because a teacher previews a file.
            if ((key === 'src' || key === 'preview') && typeof child === 'string'
              && /^(?:https?:|file:|ftp:|\/\/)/i.test(child)) {
              record[key] = ''; notice.externalAssets++
            } else walk(child)
          }
        }
        walk(slide)
        notices.set(index, notice)
      }
      return slide
    } })
  }
  // Retain lazy parsing: preparing the first slide must not parse a whole large deck.
  presentation.slides = slides
  return notices
}

/** Local-only font lookup; it neither enumerates fonts nor downloads replacements. */
async function missingLocalFonts(families: string[]): Promise<string[]> {
  if (typeof FontFace === 'undefined') return []
  const generic = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace)$/i
  const missing = await Promise.all([...new Set(families)].filter(family => family && !generic.test(family)).map(async family => {
    try { await new FontFace('GuolingPreviewFontProbe', `local(${JSON.stringify(family)})`).load(); return null }
    catch { return family }
  }))
  return missing.filter((family): family is string => family !== null)
}

export function PptxFilePreview({ bytes, name, active = true, onOpenExternal, onImportToCourse, onReload }: PptxFilePreviewProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const rememberedIndex = useRef(0)
  const [loaded, setLoaded] = useState<LoadedPresentation | null>(null)
  const [page, setPage] = useState(emptyPage)
  const [playing, setPlaying] = useState(false)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const [missingFonts, setMissingFonts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    let presentation: Presentation | undefined
    rememberedIndex.current = 0
    setLoaded(null); setPage(emptyPage); setError(null); setMissingFonts([]); setLinkNotice(null)
    void (async () => {
      try {
        const core = await import('@web-ppt/core')
        if (!live) return
        // The viewer owns a copy, so even a future parser using transfer cannot
        // detach the file owner's snapshot or turn a preview into a file edit.
        presentation = await core.parse(Uint8Array.from(bytes), { embeddedFonts: 'source' })
        if (!live) { presentation.dispose?.(); return }
        if (presentation.source !== 'pptx' || !presentation.slides.length
          || !(presentation.width > 0) || !(presentation.height > 0)) throw new Error('未找到可预览的 PPTX 幻灯片')
        setLoaded({ bytes, presentation, notices: prepareLocalPreview(presentation), fonts: core.collectFonts })
      } catch (reason) {
        if (live) { presentation?.dispose?.(); setError(reason instanceof Error ? reason.message : String(reason)) }
      }
    })()
    return () => {
      live = false
      if (viewer.current && viewer.current.presentation === presentation) { viewer.current.destroy(); viewer.current = null }
      presentation?.dispose?.()
    }
  }, [bytes, retry])

  useEffect(() => {
    if (!active || loaded?.bytes !== bytes || !surface.current || !viewport.current) return
    let live = true
    let current: Viewer | undefined
    let observer: ResizeObserver | undefined
    let fontTicket = 0
    let fontPage = -1
    const container = surface.current, available = viewport.current
    setError(null)
    const fail = (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    const playbackError = (event: Event) => {
      if (current && viewer.current === current) { current.destroy(); viewer.current = null }
      fail((event as CustomEvent<unknown>).detail ?? '当前动画无法播放')
    }
    container.addEventListener('web-ppt-playback-error', playbackError)
    const sync = () => {
      if (!live || !current) return
      setPage({ index: current.index, count: current.count, done: current.animationDone,
        total: current.animationTotal, pending: current.hasPendingAnimation })
      rememberedIndex.current = current.index
      setLinkNotice(null)
      if (fontPage === current.index) return
      fontPage = current.index
      const ticket = ++fontTicket
      setMissingFonts([])
      void missingLocalFonts(loaded.fonts([current.slide]).map(font => font.family)).then(missing => {
        if (live && ticket === fontTicket) setMissingFonts(missing)
      })
    }
    void (async () => {
      try {
        const { Viewer: PreviewViewer } = await import('@web-ppt/viewer-core')
        if (!live) return
        current = new PreviewViewer(container, loaded.presentation, {
          index: rememberedIndex.current, animate: playing, autoAdvance: playing, skipHidden: playing,
          media: 'badge', textMode: 'auto',
        })
        viewer.current = current
        current.onChange = sync; current.onAnimStep = sync
        current.onLinkClick = href => { setLinkNotice(`外部链接：${href}。可用系统应用打开原件后访问。`); return true }
        const fit = () => {
          if (!current || !live) return
          const width = Math.max(1, available.clientWidth - 32), height = Math.max(1, available.clientHeight - 32)
          const scale = Math.min(width / loaded.presentation.width, height / loaded.presentation.height)
          container.style.width = `${loaded.presentation.width * scale}px`
          container.style.height = `${loaded.presentation.height * scale}px`
          current.setZoom(scale)
        }
        observer = new ResizeObserver(fit); observer.observe(available); fit(); sync()
      } catch (reason) { fail(reason) }
    })()
    return () => {
      live = false; fontTicket++; observer?.disconnect()
      container.removeEventListener('web-ppt-playback-error', playbackError)
      if (current && viewer.current === current) {
        rememberedIndex.current = current.index; current.destroy(); viewer.current = null
      }
      container.replaceChildren()
    }
  }, [active, bytes, loaded, playing])

  const navigate = (operation: (current: Viewer) => void) => {
    const current = viewer.current
    if (!current || error) return
    try { operation(current) }
    catch (reason) {
      current.destroy(); viewer.current = null
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (!active || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,a,video,audio,[contenteditable="true"]')) return
    const operation = event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ' ? (v: Viewer) => v.next()
      : event.key === 'ArrowLeft' || event.key === 'PageUp' ? (v: Viewer) => v.prev()
        : event.key === 'Home' ? (v: Viewer) => v.goTo(0)
          : event.key === 'End' ? (v: Viewer) => v.goTo(v.count - 1) : null
    if (!operation) return
    event.preventDefault(); event.stopPropagation(); navigate(operation)
  }
  const runAction = async (action: () => Promise<void> | void) => {
    setBusy(true); setActionError(null)
    try { await action() }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const ready = loaded?.bytes === bytes && page.count > 0 && !error
  const notice = ready && loaded ? loaded.notices.get(page.index) : undefined
  return <section className="pptx-file-preview" aria-label={`${name} PPTX 只读预览`} hidden={!active} onKeyDown={keydown}>
    <header className="pptx-file-preview__toolbar">
      <span className="pptx-file-preview__identity"><strong title={name}>{name}</strong><span>原演示文稿 · 只读</span></span>
      <div className="pptx-file-preview__actions">
        {onImportToCourse && <button type="button" disabled={busy} onClick={() => void runAction(onImportToCourse)}>导入为果铃作品</button>}
        {onOpenExternal && <button type="button" disabled={busy} onClick={() => void runAction(onOpenExternal)}>用系统应用打开</button>}
        <button type="button" disabled={busy} onClick={() => void runAction(async () => { await onReload?.(); setRetry(value => value + 1) })}>重新载入</button>
      </div>
    </header>
    <div className="pptx-file-preview__navigation" role="group" aria-label="幻灯片导航">
      <button type="button" disabled={!ready || page.index === 0 && page.done === 0} onClick={() => navigate(current => current.prev())}>{playing ? '上一步' : '上一页'}</button>
      <span aria-live="polite">{ready ? `第 ${page.index + 1} / ${page.count} 页` : 'PPTX 预览'}</span>
      <button type="button" disabled={!ready || page.index === page.count - 1 && !page.pending} onClick={() => navigate(current => current.next())}>{playing ? '下一步' : '下一页'}</button>
      <button type="button" aria-pressed={playing} disabled={!ready} onClick={() => setPlaying(value => !value)}>{playing ? '结束播放' : '播放动画'}</button>
      {playing && ready && <span className="pptx-file-preview__step">本页动画 {page.done} / {page.total}</span>}
    </div>
    <div className="pptx-file-preview__messages">
      <p>预览使用本机字体；复杂对象与动画可能与 PowerPoint 不同。修改内容请导入为果铃作品，或用系统应用编辑原件。</p>
      {notice?.unsupported.length ? <p role="status">本页包含受限对象：{[...new Set(notice.unsupported)].join('、')}。请在原应用核对显示。</p> : null}
      {notice?.externalAssets ? <p role="status">本页有 {notice.externalAssets} 处外链资源未加载，原文件保持不变。</p> : null}
      {notice?.media ? <p role="status">本页音视频显示封面；请用系统应用打开原件播放。</p> : null}
      {missingFonts.length ? <p role="status">本机未匹配到这些字体，可能使用替代字体：{missingFonts.join('、')}。</p> : null}
      {loaded?.presentation.embeddedFontSources?.length ? <p>此预览尚未加载文稿的嵌入字体。</p> : null}
      {linkNotice && <p role="status">{linkNotice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {error && <p role="alert">PPTX 预览失败：{error}。可重新载入或用系统应用打开原件。</p>}
    </div>
    <div className="pptx-file-preview__viewport" ref={viewport} tabIndex={0} aria-label="幻灯片画面；方向键翻页，播放时空格推进动画">
      {!ready && !error && <p className="pptx-file-preview__loading" role="status">正在载入演示文稿…</p>}
      <div className="pptx-file-preview__surface" ref={surface} aria-hidden={Boolean(error)} />
    </div>
  </section>
}
