import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PdfPagePreview } from '../media/PdfPagePreview'
import './docxFilePreview.css'

export interface DocxFilePreviewProps {
  /** Paginated PDF projection produced from a snapshot of the original DOCX. */
  bytes: Uint8Array
  name: string
  pageCount: number
  sourceSha256?: string
  engine?: { name: string; version: string }
  notices?: readonly string[]
  active?: boolean
  onOpenExternal?(): Promise<void> | void
  onImportToCourse?(): Promise<void> | void
  onReload?(): Promise<void> | void
}

/** Display-only: all reads and revision changes belong to the existing file owner. */
export function DocxFilePreview({ bytes, name, pageCount, sourceSha256, engine, notices = [], active = true,
  onOpenExternal, onImportToCourse, onReload }: DocxFilePreviewProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const count = Math.max(0, Math.floor(pageCount))
  const page = Math.max(0, Math.min(index, count - 1))

  useEffect(() => { setIndex(0); setActionError(null) }, [name])
  useEffect(() => { setIndex(value => Math.max(0, Math.min(value, count - 1))) }, [count])
  // A new page, projection or active view cannot inherit the old canvas's completion.
  useLayoutEffect(() => { setReady(false) }, [bytes, page, active])
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0, left: 0 })
  }, [bytes, page])

  const navigate = (target: number) => setIndex(Math.max(0, Math.min(target, count - 1)))
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (!active || !count || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return
    const target = event.key === 'ArrowRight' || event.key === 'PageDown' ? page + 1
      : event.key === 'ArrowLeft' || event.key === 'PageUp' ? page - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : undefined
    if (target === undefined) return
    event.preventDefault(); event.stopPropagation(); navigate(target)
  }
  const runAction = async (action: () => Promise<void> | void, reload = false) => {
    setBusy(true); setActionError(null)
    try { await action() }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setActionError(reload ? `重新载入未完成，当前仍显示上一次预览。${message}` : message)
    } finally { setBusy(false) }
  }

  return <section className="docx-file-preview" aria-label={`${name} Word 原件分页预览`} hidden={!active}
    data-source-sha256={sourceSha256} onKeyDown={keydown}>
    <header className="docx-file-preview__toolbar">
      <span className="docx-file-preview__identity"><strong title={name}>{name}</strong><span>原 Word 文稿 · 只读预览</span></span>
      <div className="docx-file-preview__actions">
        {onImportToCourse && <button type="button" disabled={busy} onClick={() => void runAction(onImportToCourse)}>导入为果铃作品</button>}
        {onOpenExternal && <button type="button" disabled={busy} onClick={() => void runAction(onOpenExternal)}>用系统应用打开</button>}
        {onReload && <button type="button" disabled={busy} onClick={() => void runAction(onReload, true)}>{busy ? '正在处理…' : '重新载入'}</button>}
      </div>
    </header>
    <div className="docx-file-preview__navigation" role="group" aria-label="Word 页面导航">
      <button type="button" disabled={!count || page === 0} onClick={() => navigate(page - 1)}>上一页</button>
      <span aria-live="polite">{count ? `第 ${page + 1} / ${count} 页` : 'Word 分页预览'}</span>
      <button type="button" disabled={!count || page === count - 1} onClick={() => navigate(page + 1)}>下一页</button>
      {count > 1 && <label className="docx-file-preview__jump">转到第 <input type="number" min={1} max={count} value={page + 1}
        aria-label="转到 Word 页码" onChange={event => {
          const value = event.currentTarget.valueAsNumber
          if (Number.isFinite(value)) navigate(value - 1)
        }} /> 页</label>}
    </div>
    {(notices.length > 0 || actionError) && <div className="docx-file-preview__messages">
      {notices.map((notice, position) => <p role="status" key={`${position}:${notice}`}>{notice}</p>)}
      {actionError && <p role="alert">{actionError}</p>}
    </div>}
    <div className="docx-file-preview__viewport" ref={viewport} tabIndex={0} aria-label="Word 分页画面；左右方向键翻页">
      {count > 0 ? <div className="docx-file-preview__paper" data-ready={ready} aria-busy={!ready}>
        {active && <PdfPagePreview bytes={bytes} page={page} onReady={setReady} />}
      </div> : <p role="alert">此文稿没有可显示的页面。</p>}
    </div>
    {engine && <footer className="docx-file-preview__footer">{engine.name} {engine.version} 排版</footer>}
  </section>
}
