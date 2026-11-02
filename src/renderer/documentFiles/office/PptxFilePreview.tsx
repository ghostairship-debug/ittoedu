import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Presentation, Slide } from '@web-ppt/core'
import type { Viewer } from '@web-ppt/viewer-core'
import type { OfficeContentInspection, OfficeHistorySnapshot, PptxObjectEdit, PptxObjectInspection } from '../../../shared/workbench/officeFiles'
import { PptxObjectPanel } from './PptxObjectPanel'
import './pptxFilePreview.css'

export interface PptxFilePreviewProps {
  /** A snapshot read by the existing file owner. This view never writes these bytes. */
  bytes: Uint8Array
  name: string
  active?: boolean
  onOpenExternal?(): Promise<void> | void
  onImportToCourse?(): Promise<void> | void
  onReload?(): Promise<void> | void
  inspection?: Extract<OfficeContentInspection, { format: 'pptx' }>
  history?: OfficeHistorySnapshot
  onEdit?(edits: PptxObjectEdit[]): Promise<void>
  onUndo?(): Promise<void>
  onRedo?(): Promise<void>
  onDraftDirtyChange?(dirty: boolean): void
}

interface PageNotice { externalAssets: number; media: number; unsupported: string[] }
interface LoadedPresentation {
  bytes: Uint8Array
  presentation: Presentation
  notices: Map<number, PageNotice>
  fonts(slides: Iterable<Slide>): Array<{ family: string }>
  embeddedFamilies: Set<string>
  embeddedFontFailures: string[]
}
const emptyPage = { index: 0, count: 0, done: 0, total: 0, pending: false }
interface SelectionRect { left: number; top: number; width: number; height: number }
interface ObjectDrag {
  pointer: number; mode: 'move' | 'resize'; x: number; y: number; startX: number; startY: number
  rect: SelectionRect; object: PptxObjectInspection; identity: { slide: number; part: string; partVersion: string; shapeId: string }
  inverse: DOMMatrix | null; pointsPerUnit: number
}

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
async function missingLocalFonts(families: string[], embeddedFamilies: Set<string>): Promise<string[]> {
  if (typeof FontFace === 'undefined') return []
  const generic = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace)$/i
  const missing = await Promise.all([...new Set(families)].filter(family => family && !generic.test(family) && !embeddedFamilies.has(family.toLocaleLowerCase())).map(async family => {
    try { await new FontFace('GuolingPreviewFontProbe', `local(${JSON.stringify(family)})`).load(); return null }
    catch { return family }
  }))
  return missing.filter((family): family is string => family !== null)
}

export function PptxFilePreview({ bytes, name, active = true, onOpenExternal, onImportToCourse, onReload, inspection, history, onEdit, onUndo, onRedo, onDraftDirtyChange }: PptxFilePreviewProps) {
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
  const [selection, setSelection] = useState<{ slide: number; id: string } | null>(null)
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null)
  const [fieldDirty, setFieldDirty] = useState(false)
  const draftListener = useRef(onDraftDirtyChange)
  draftListener.current = onDraftDirtyChange
  const drag = useRef<ObjectDrag | null>(null)
  const previousName = useRef(name)
  const currentSlide = inspection?.slides[page.index]
  const selected = selection?.slide === page.index ? currentSlide?.shapes.find(object => object.shapeId === selection.id) : undefined
  const editing = Boolean(onEdit && inspection)
  useEffect(() => { draftListener.current?.(fieldDirty) }, [fieldDirty])
  useEffect(() => () => draftListener.current?.(false), [])

  useEffect(() => {
    let live = true
    let presentation: Presentation | undefined
    if (previousName.current !== name) { rememberedIndex.current = 0; setSelection(null); previousName.current = name }
    setLoaded(null); setPage({ ...emptyPage, index: rememberedIndex.current }); setError(null); setMissingFonts([]); setLinkNotice(null)
    void (async () => {
      try {
        const core = await import('@web-ppt/core')
        if (!live) return
        // The viewer owns a copy, so even a future parser using transfer cannot
        // detach the file owner's snapshot or turn a preview into a file edit.
        let decodingFailure: string | null = null
        try { presentation = await core.parse(Uint8Array.from(bytes), { embeddedFonts: 'decode' }) }
        catch (reason) {
          // A bad embedded font must not make an otherwise readable presentation inaccessible.
          const fallback = await core.parse(Uint8Array.from(bytes), { embeddedFonts: 'source' })
          if (!fallback.embeddedFontSources?.length) { fallback.dispose?.(); throw reason }
          presentation = fallback; decodingFailure = '文稿嵌入字体无法解码，已保留原件并使用本机字体。'
        }
        if (!live) { presentation.dispose?.(); return }
        if (presentation.source !== 'pptx' || !presentation.slides.length
          || !(presentation.width > 0) || !(presentation.height > 0)) throw new Error('未找到可预览的 PPTX 幻灯片')
        const embeddedFamilies = new Set<string>(), embeddedFontFailures: string[] = []
        if (decodingFailure) embeddedFontFailures.push(decodingFailure)
        if (!live) { presentation.dispose?.(); return }
        setLoaded({ bytes, presentation, notices: prepareLocalPreview(presentation), fonts: core.collectFonts, embeddedFamilies, embeddedFontFailures })
      } catch (reason) {
        if (live) { presentation?.dispose?.(); setError(reason instanceof Error ? reason.message : String(reason)) }
      }
    })()
    return () => {
      live = false
      if (viewer.current && viewer.current.presentation === presentation) {
        for (const media of Array.from(surface.current?.querySelectorAll<HTMLMediaElement>('video,audio') ?? [])) media.pause()
        viewer.current.destroy(); viewer.current = null
      }
      presentation?.dispose?.()
    }
  }, [bytes, retry, name])

  useEffect(() => {
    if (!active || loaded?.bytes !== bytes || !surface.current || !viewport.current) return
    let live = true
    let current: Viewer | undefined
    let observer: ResizeObserver | undefined
    let fontTicket = 0
    let fontPage = -1
    const registeredFonts: FontFace[] = []
    let previousMedia: HTMLMediaElement[] = []
    const container = surface.current, available = viewport.current
    setError(null)
    const fail = (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    const playbackError = (event: Event) => {
      if (current && viewer.current === current) {
        for (const media of Array.from(container.querySelectorAll<HTMLMediaElement>('video,audio'))) media.pause()
        current.destroy(); viewer.current = null
      }
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
      for (const media of previousMedia) media.pause()
      previousMedia = Array.from(container.querySelectorAll<HTMLMediaElement>('video,audio'))
      fontPage = current.index
      const ticket = ++fontTicket
      setMissingFonts([])
      void missingLocalFonts(loaded.fonts([current.slide]).map(font => font.family), loaded.embeddedFamilies).then(missing => {
        if (live && ticket === fontTicket) setMissingFonts(missing)
      })
    }
    void (async () => {
      try {
        const { Viewer: PreviewViewer } = await import('@web-ppt/viewer-core')
        if (!live) return
        // Only the active document registers its embedded font faces. Hidden tabs must not
        // replace another presentation's same-named font with a different embedded subset.
        loaded.embeddedFamilies.clear()
        if (typeof FontFace !== 'undefined') await Promise.all((loaded.presentation.embeddedFonts ?? []).map(async font => {
          try {
            if (!/^(?:blob:|data:)/i.test(font.src)) throw new Error('只加载原件内的字体')
            const face = await new FontFace(font.family, `url(${JSON.stringify(font.src)})`, { weight: font.bold ? '700' : '400', style: font.italic ? 'italic' : 'normal' }).load()
            if (!live) return
            document.fonts.add(face); registeredFonts.push(face); loaded.embeddedFamilies.add(font.family.toLocaleLowerCase())
            loaded.embeddedFontFailures = loaded.embeddedFontFailures.filter(failure => failure !== font.family)
          } catch { if (live && !loaded.embeddedFontFailures.includes(font.family)) loaded.embeddedFontFailures.push(font.family) }
        }))
        if (!live) return
        current = new PreviewViewer(container, loaded.presentation, {
          index: Math.min(rememberedIndex.current, loaded.presentation.slides.length - 1), animate: playing, autoAdvance: playing, skipHidden: playing,
          media: 'player', textMode: 'auto',
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
      for (const media of [...previousMedia, ...Array.from(container.querySelectorAll<HTMLMediaElement>('video,audio'))]) media.pause()
      if (current && viewer.current === current) {
        rememberedIndex.current = current.index; current.destroy(); viewer.current = null
      }
      for (const font of registeredFonts) document.fonts.delete(font)
      container.replaceChildren()
    }
  }, [active, bytes, loaded, playing])

  useEffect(() => {
    if (!selected || !active || playing || !surface.current || !viewport.current) { setSelectionRect(null); return }
    const container = surface.current, available = viewport.current
    let ticket = 0, live = true
    const refresh = () => {
      if (!live || drag.current) return
      const element = Array.from(container.querySelectorAll('[data-el]')).find(node => node.getAttribute('data-el') === selected.shapeId)
      if (!element) { setSelectionRect(null); return }
      const bounds = element.getBoundingClientRect(), parent = available.getBoundingClientRect()
      const next = { left: bounds.left - parent.left, top: bounds.top - parent.top, width: bounds.width, height: bounds.height }
      setSelectionRect(previous => previous && (Object.keys(next) as Array<keyof SelectionRect>).every(key => Math.abs(previous[key] - next[key]) < .1) ? previous : next)
    }
    const schedule = () => { cancelAnimationFrame(ticket); ticket = requestAnimationFrame(refresh) }
    const observer = new MutationObserver(schedule), size = new ResizeObserver(schedule)
    observer.observe(container, { childList: true, subtree: true, attributes: true })
    size.observe(available); schedule()
    return () => { live = false; cancelAnimationFrame(ticket); observer.disconnect(); size.disconnect() }
  }, [active, loaded, playing, selected, page.index])

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
    if (!active || event.altKey || event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,a,video,audio,[contenteditable="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && editing) {
      event.preventDefault(); event.stopPropagation()
      if (busy || fieldDirty) return
      const action = event.shiftKey ? onRedo : onUndo, depth = event.shiftKey ? history?.redoDepth : history?.undoDepth
      if (action && depth) void runAction(action)
      return
    }
    if (event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape' && !drag.current && !fieldDirty) { setSelection(null); return }
    if (!playing && editing && selected?.frame && currentSlide && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (busy || fieldDirty) return
      const distance = event.shiftKey ? 10 : 1
      const x = selected.frame.x + (event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0)
      const y = selected.frame.y + (event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0)
      void commitEdits([{ slide: currentSlide.index, part: currentSlide.part, partVersion: currentSlide.partVersion, shapeId: selected.shapeId, type: 'transform', x, y }]).catch(() => {})
      return
    }
    if (fieldDirty && !playing) return
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
  const commitEdits = async (edits: PptxObjectEdit[]) => {
    if (!onEdit || busy) throw new Error('当前正在处理上一项修改，请稍后再试')
    setBusy(true); setActionError(null)
    try { await onEdit(edits) }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); throw reason }
    finally { setBusy(false) }
  }
  const selectObject = (id: string) => {
    if (fieldDirty && id !== selected?.shapeId) { setActionError('当前对象还有尚未应用的输入，请先应用或取消'); return false }
    setSelection({ slide: page.index, id }); setActionError(null); return true
  }
  const startDrag = (event: PointerEvent<HTMLElement>, object: PptxObjectInspection, mode: 'move' | 'resize') => {
    if (!editing || playing || busy || !ready || !object.frame || !currentSlide || !viewport.current || !surface.current) return
    if (fieldDirty) { setActionError('请先应用或取消当前输入，再拖动对象'); return }
    const element = Array.from(surface.current.querySelectorAll('[data-el]')).find(node => node.getAttribute('data-el') === object.shapeId)
    if (!(element instanceof SVGGraphicsElement)) return
    const parent = mode === 'resize' ? element : element.parentElement
    let inverse: DOMMatrix | null = null
    try { inverse = parent instanceof SVGGraphicsElement ? parent.getScreenCTM()?.inverse() ?? null : null } catch { /* use the visible slide scale */ }
    const bounds = element.getBoundingClientRect(), view = viewport.current.getBoundingClientRect()
    const rect = { left: bounds.left - view.left, top: bounds.top - view.top, width: bounds.width, height: bounds.height }
    const pointsPerUnit = inverse ? (inspection!.width / (loaded?.presentation.width ?? inspection!.width))
      : inspection!.width / Math.max(1, surface.current.getBoundingClientRect().width)
    const point = inverse ? new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse) : new DOMPoint(event.clientX, event.clientY)
    drag.current = { pointer: event.pointerId, mode, x: point.x, y: point.y, startX: event.clientX, startY: event.clientY, rect, object,
      identity: { slide: currentSlide.index, part: currentSlide.part, partVersion: currentSlide.partVersion, shapeId: object.shapeId }, inverse, pointsPerUnit }
    viewport.current.setPointerCapture(event.pointerId); setSelectionRect(rect)
    event.preventDefault(); event.stopPropagation()
  }
  const surfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editing || playing || !(event.target instanceof Element)) return
    if (event.target.closest('video,audio,button,input,[data-media-toggle]')) return
    const id = event.target.closest('[data-el]')?.getAttribute('data-el')
    if (!id) { if (!fieldDirty) setSelection(null); return }
    const object = currentSlide?.shapes.find(value => value.shapeId === id)
    if (object && selectObject(id)) startDrag(event, object, 'move')
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY
    setSelectionRect(current.mode === 'move' ? { ...current.rect, left: current.rect.left + dx, top: current.rect.top + dy }
      : { ...current.rect, width: Math.max(4, current.rect.width + dx), height: Math.max(4, current.rect.height + dy) })
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
    if (cancelled || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 2) { setSelectionRect(current.rect); return }
    const point = current.inverse ? new DOMPoint(event.clientX, event.clientY).matrixTransform(current.inverse) : new DOMPoint(event.clientX, event.clientY)
    const dx = (point.x - current.x) * current.pointsPerUnit, dy = (point.y - current.y) * current.pointsPerUnit, frame = current.object.frame!
    const change = current.mode === 'move' ? { x: frame.x + dx, y: frame.y + dy } : { width: Math.max(.1, frame.width + dx), height: Math.max(.1, frame.height + dy) }
    void commitEdits([{ ...current.identity, type: 'transform', ...change }]).catch(() => setSelectionRect(current.rect))
  }
  const ready = loaded?.bytes === bytes && page.count > 0 && !error
  const notice = ready && loaded ? loaded.notices.get(page.index) : undefined
  return <section className="pptx-file-preview" aria-label={`${name} PPTX ${editing ? '对象共编' : '只读预览'}`} hidden={!active} onKeyDown={keydown}>
    <header className="pptx-file-preview__toolbar">
      <span className="pptx-file-preview__identity"><strong title={name}>{name}</strong><span>{editing ? busy ? '正在保存…' : fieldDirty ? '有未应用输入' : '原演示文稿 · 已自动保存' : '原演示文稿 · 只读'}</span></span>
      <div className="pptx-file-preview__actions">
        {editing && <><button type="button" disabled={busy || fieldDirty || !history?.undoDepth || !onUndo} onClick={() => onUndo && void runAction(onUndo)}>撤销</button><button type="button" disabled={busy || fieldDirty || !history?.redoDepth || !onRedo} onClick={() => onRedo && void runAction(onRedo)}>重做</button></>}
        {onImportToCourse && <button type="button" disabled={busy} onClick={() => void runAction(onImportToCourse)}>导入为果铃作品</button>}
        {onOpenExternal && <button type="button" disabled={busy} onClick={() => void runAction(onOpenExternal)}>用系统应用打开</button>}
        <button type="button" disabled={busy || fieldDirty} onClick={() => void runAction(async () => { await onReload?.(); setRetry(value => value + 1) })}>重新载入</button>
      </div>
    </header>
    <div className="pptx-file-preview__navigation" role="group" aria-label="幻灯片导航">
      <button type="button" disabled={fieldDirty || !ready || page.index === 0 && page.done === 0} onClick={() => navigate(current => current.prev())}>{playing ? '上一步' : '上一页'}</button>
      <span aria-live="polite">{ready ? `第 ${page.index + 1} / ${page.count} 页` : 'PPTX 预览'}</span>
      <button type="button" disabled={fieldDirty || !ready || page.index === page.count - 1 && !page.pending} onClick={() => navigate(current => current.next())}>{playing ? '下一步' : '下一页'}</button>
      <button type="button" aria-pressed={playing} disabled={fieldDirty || !ready} onClick={() => setPlaying(value => !value)}>{playing ? '结束播放' : '播放动画'}</button>
      {playing && ready && <span className="pptx-file-preview__step">本页动画 {page.done} / {page.total}</span>}
      {editing && !playing && <label className="pptx-file-preview__object-picker">当前对象 <select aria-label="选择幻灯片对象" disabled={!ready || busy} value={selected?.shapeId ?? ''} onChange={event => { if (event.target.value) selectObject(event.target.value); else if (!fieldDirty) setSelection(null) }}><option value="">点击画面或从此选择</option>{currentSlide?.shapes.map((object, index) => <option key={object.shapeId} value={object.shapeId}>{object.name || `对象 ${index + 1}`}</option>)}</select></label>}
    </div>
    <div className="pptx-file-preview__messages">
      <p>{editing ? '可选择原件对象修改。应用与拖动结束后自动保存；人工与 AI 修改共用撤销历史。' : '修改内容请导入为果铃作品，或用系统应用编辑原件。'} 复杂对象与动画可能与 PowerPoint 不同。</p>
      {notice?.unsupported.length ? <p role="status">本页包含受限对象：{[...new Set(notice.unsupported)].join('、')}。请在原应用核对显示。</p> : null}
      {notice?.externalAssets ? <p role="status">本页有 {notice.externalAssets} 处外链资源未加载，原文件保持不变。</p> : null}
      {notice?.media ? <p role="status">本页音视频可用播放器控件播放；无法解码的媒体可用系统应用核对。</p> : null}
      {missingFonts.length ? <p role="status">本机未匹配到这些字体，可能使用替代字体：{missingFonts.join('、')}。</p> : null}
      {loaded?.embeddedFontFailures.length ? <p role="status">这些嵌入字体未能载入，已使用本机字体：{[...new Set(loaded.embeddedFontFailures)].join('、')}。</p> : null}
      {linkNotice && <p role="status">{linkNotice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {history?.notice && <p role="status">{history.notice}</p>}
      {editing && history?.entries.length ? <details><summary>共同编辑历史（{history.entries.length}）</summary><ol>{history.entries.slice(-12).map(entry => <li key={entry.id}>{entry.actor === 'human' ? '手动' : 'AI'} · {entry.label}</li>)}</ol></details> : null}
      {error && <p role="alert">PPTX 预览失败：{error}。可重新载入或用系统应用打开原件。</p>}
    </div>
    <div className="pptx-file-preview__body">
    <div className="pptx-file-preview__viewport" ref={viewport} tabIndex={0} aria-label="幻灯片画面；选择对象可移动，播放时空格推进动画" onPointerMove={pointerMove} onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)}>
      {!ready && !error && <p className="pptx-file-preview__loading" role="status">正在载入演示文稿…</p>}
      <div className="pptx-file-preview__surface" ref={surface} aria-hidden={Boolean(error)} onPointerDown={surfacePointerDown} />
      {editing && !playing && ready && selected && selectionRect && <div className="pptx-file-preview__selection" style={selectionRect} aria-label={`已选择 ${selected.name || '对象'}`} onPointerDown={event => startDrag(event, selected, 'move')}>
        {selected.frame && selected.editable.includes('transform') && Math.abs(selected.frame.rotation % 180) < .001 && <button className="pptx-file-preview__resize" type="button" aria-label="拖动调整对象尺寸" disabled={busy || fieldDirty} onPointerDown={event => startDrag(event, selected, 'resize')} />}
      </div>}
    </div>
    {editing && !playing && selected && currentSlide && <PptxObjectPanel key={`${currentSlide.part}:${selected.shapeId}`} object={selected} slide={currentSlide} disabled={busy || !ready} onApply={commitEdits} onDirtyChange={setFieldDirty} />}
    </div>
  </section>
}
