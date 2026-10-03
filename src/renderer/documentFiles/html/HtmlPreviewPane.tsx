import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { decodeHtmlEntities, scanHtmlSource } from '../../../shared/html/htmlSourceScanner'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { HtmlLightEditOverlay } from './HtmlLightEditOverlay'
import { HtmlPreviewController, type HtmlSelectedTarget } from './htmlPreviewController'
import type { HtmlTextDrafts } from './htmlTextDrafts'
import './htmlPreview.css'
import { HtmlStructureEditor } from './HtmlStructureEditor'

type Patch = { handle: string; kind: 'text' | 'image'; value: string }
type ChangeRecord = { revision: number; beforeSource: string; afterSource?: string; beforeValue: string; patch: Patch }

/** Patch a selected text node only when the canonical change is exactly that source span. */
function selectedTextChange(before: string, after: string, selected: HtmlSelectedTarget | null,
  revision: number): { patch: Patch; beforeValue: string } | null {
  if (!selected || selected.report.kind !== 'text' || selected.resolved.status !== 'editable') return null
  const locator = selected.resolved.locator
  const span = locator.valueSpan
  if (!span || locator.revision !== revision - 1 || locator.targetKind !== 'text'
    || before.slice(span.start, span.end) !== locator.expectedRaw) return null
  const prefix = before.slice(0, span.start), suffix = before.slice(span.end)
  if (!after.startsWith(prefix) || !after.endsWith(suffix)) return null
  const rawEnd = after.length - suffix.length
  if (rawEnd < span.start) return null
  const raw = after.slice(span.start, rawEnd)
  const scan = scanHtmlSource(after)
  if (scan.diagnostics.length || (raw && !scan.tokens.some(token => token.kind === 'text'
    && token.span.start <= span.start && token.span.end >= rawEnd))) return null
  return { patch: { handle: selected.report.handle, kind: 'text',
    value: decodeHtmlEntities(raw.replace(/\r\n?/g, '\n')) }, beforeValue: selected.report.rawText }
}

export interface HtmlPreviewPaneProps {
  lease: HtmlPreviewLease
  committed: DocumentSnapshot
  tabId: string
  textDrafts: HtmlTextDrafts
  onUndo(): void
  onRedo(): void
  onSave?(): void
  /** True while the preview tab is shown; stale source refreshes on activation. */
  active?: boolean
  toolbarLeading?: ReactNode
  pendingSourceDraft?: boolean
  onReloadRequest?(): void
  reloadIssue?: string | null
}

/** Keeps one sandbox frame mounted across canonical text revisions. */
export function HtmlPreviewPane({ lease, committed, textDrafts, onUndo, onRedo, onSave, active = true, toolbarLeading,
  pendingSourceDraft = false, onReloadRequest, reloadIssue }: HtmlPreviewPaneProps) {
  const retainedDrafts = useSyncExternalStore(textDrafts.subscribe, textDrafts.read)
  const frame = useRef<HTMLIFrameElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const controller = useRef<HtmlPreviewController | null>(null)
  const selectedTarget = useRef<HtmlSelectedTarget | null>(null)
  const activeRef = useRef(active); activeRef.current = active
  void onSave
  const source = committed.model.kind === 'text' ? committed.model.source : ''
  const latestSource = useRef(source)
  const history = useRef<ChangeRecord[]>([])
  const pendingEdit = useRef<{ beforeSource: string; observedSource?: string; observedRevision?: number } | null>(null)
  const view = useRef({ index: 0, scroll: 0 })
  const restoreAfterLoad = useRef<{ index: number; scroll: number } | null>(null)
  const editModeRef = useRef(false)
  const [selected, setSelected] = useState<HtmlSelectedTarget | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [responsiveNotice, setResponsiveNotice] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const [page, setPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [ambiguous, setAmbiguous] = useState(false)
  const [stale, setStale] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [modePending, setModePending] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [structureOpen, setStructureOpen] = useState(false)
  useEffect(() => {
    if (!active) return
    const onTrustedHistory = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || !('url' in detail)
        || typeof detail.url !== 'string' || detail.url.split('#', 1)[0] !== lease.url) return
      if ('direction' in detail && detail.direction === 'undo') onUndo()
      else if ('direction' in detail && detail.direction === 'redo') onRedo()
    }
    window.addEventListener('courseware:html-preview-history', onTrustedHistory)
    return () => window.removeEventListener('courseware:html-preview-history', onTrustedHistory)
  }, [active, lease.url, onUndo, onRedo])
  const refreshPreservingView = () => {
    if (!frame.current) return
    setFrameReady(false)
    setModePending(editModeRef.current)
    setEditMode(false)
    restoreAfterLoad.current = { ...view.current }
    history.current = []
    pendingEdit.current = null
    setSelected(null)
    controller.current?.beginReload()
    if (onReloadRequest) onReloadRequest()
    else frame.current.src = lease.url
    setStale(false)
  }

  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    setFrameReady(false)
    setModePending(editModeRef.current)
    setEditMode(false)
    latestSource.current = source
    history.current = []
    pendingEdit.current = null
    const instance = new HtmlPreviewController(iframe, lease, {
      onTarget(target, message) {
        selectedTarget.current = target
        setSelected(target)
        setIssue(message ?? null)
        if (target && container.current) {
          const outer = container.current.getBoundingClientRect()
          const inner = iframe.getBoundingClientRect()
          setPosition({ left: Math.max(8, inner.left - outer.left + target.report.rect.x),
            top: Math.max(8, inner.top - outer.top + target.report.rect.y + target.report.rect.height + 4) })
        }
      },
      onReady(count, isAmbiguous) {
        instance.setVisibility(activeRef.current)
        setPageCount(count); setAmbiguous(isAmbiguous); setStale(false)
        setFrameReady(true)
        setModePending(editModeRef.current)
        instance.setEditMode(editModeRef.current)
        const restore = restoreAfterLoad.current
        if (restore) { restoreAfterLoad.current = null; instance.restore(restore.index, restore.scroll) }
      },
      onEditModeReady(enabled) {
        if (enabled !== editModeRef.current) return
        setEditMode(enabled)
        setModePending(false)
      },
      onPage(index, scroll) { view.current = { index, scroll }; setPage(index) },
      onEditing() { pendingEdit.current = { beforeSource: latestSource.current } },
      onApplied(revision, patch, beforeValue) {
        if (patch.rewroteResponsive) setResponsiveNotice('已把旧备用图指向新图（可撤销）')
        history.current.push({ revision, patch, beforeValue,
          beforeSource: pendingEdit.current?.beforeSource ?? latestSource.current,
          ...(pendingEdit.current?.observedRevision === revision && pendingEdit.current.observedSource
            ? { afterSource: pendingEdit.current.observedSource } : {}) })
        if (history.current.length > 100) history.current.shift()
      },
      onEditSettled() {
        const pending = pendingEdit.current
        pendingEdit.current = null
        if (pending?.observedSource && !history.current.some(item => item.beforeSource === pending.beforeSource && item.afterSource === pending.observedSource)) setStale(true)
      },
      onPatchMismatch() { setStale(true) },
    })
    controller.current = instance
    return () => { instance.dispose(); if (controller.current === instance) controller.current = null }
    // The lease/load owns the frame. A source revision is reconciled below.
  }, [lease.leaseId, lease.loadId])

  useEffect(() => {
    const instance = controller.current
    if (!active) { instance?.updateCommitted(committed); if (source !== latestSource.current) setStale(true); return }
    if (!instance || source === latestSource.current) { instance?.updateCommitted(committed); return }
    const previous = latestSource.current
    if (pendingEdit.current) {
      pendingEdit.current.observedSource = source
      pendingEdit.current.observedRevision = committed.revision
      latestSource.current = source
      instance.updateCommitted(committed)
      return
    }
    const pending = history.current.find(item => item.revision === committed.revision && item.beforeSource === previous && !item.afterSource)
    if (pending) pending.afterSource = source
    else {
      const reverse = [...history.current].reverse().find(item => item.afterSource === previous && item.beforeSource === source)
      const forward = [...history.current].reverse().find(item => item.beforeSource === previous && item.afterSource === source)
      if (reverse) { instance.patch({ ...reverse.patch, value: reverse.beforeValue, expected: reverse.patch.value }); setResponsiveNotice(null) }
      else if (forward) instance.patch({ ...forward.patch, expected: forward.beforeValue })
      else {
        const exact = selectedTextChange(previous, source, selectedTarget.current, committed.revision)
        if (exact) {
          instance.patch({ ...exact.patch, expected: exact.beforeValue })
          history.current.push({ revision: committed.revision, beforeSource: previous, afterSource: source,
            beforeValue: exact.beforeValue, patch: exact.patch })
          if (history.current.length > 100) history.current.shift()
        } else setStale(true)
      }
    }
    latestSource.current = source
    instance.updateCommitted(committed)
  }, [committed, source, active])

  useEffect(() => { controller.current?.setVisibility(active) }, [active, lease.leaseId, lease.loadId])
  useEffect(() => { if (active && stale) refreshPreservingView() }, [active, stale, lease.url])

  return <div ref={container} className="html-preview-pane">
    <div className="html-preview-pane__toolbar" role="toolbar" aria-label="HTML 分页">
      {toolbarLeading}
      <button type="button" className="html-preview-pane__edit" title="编辑模式中双击文字或单击图片，Esc 关闭编辑框" aria-pressed={editMode} disabled={!frameReady || modePending} onClick={() => {
        const next = !editModeRef.current
        editModeRef.current = next
        setModePending(true)
        setSelected(null)
        controller.current?.setEditMode(next)
      }}>{modePending ? '正在切换编辑模式…' : editMode ? '完成编辑' : '编辑预览'}</button>
      {pageCount > 1 && <div className="html-preview-pane__pages" role="group" aria-label="页面导航">
        <button type="button" disabled={page === 0} onClick={() => controller.current?.navigate(page - 1)}>上一页</button>
        <span>{page + 1} / {pageCount}</span>
        <button type="button" disabled={page >= pageCount - 1} onClick={() => controller.current?.navigate(page + 1)}>下一页</button>
      </div>}
      {editMode && <span className="html-preview-pane__edit-hint">双击文字 · 单击图片</span>}
      <button type="button" aria-pressed={structureOpen} onClick={() => setStructureOpen(value => !value)}>结构与样式</button>
      <details className="html-preview-pane__more"><summary aria-label="预览更多操作">更多</summary>
        <button type="button" title="重新加载当前源码；页面内运行状态将重置，文档和未发送输入保持不变" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); refreshPreservingView() }}>重新加载预览</button>
      </details>
      {ambiguous && <span role="status">分页结构不明确，按连续页面预览。</span>}
    </div>
    {responsiveNotice && <p role="status" className="html-preview-pane__notice">{responsiveNotice}</p>}
    {reloadIssue && <p role="alert" className="html-preview-pane__notice">{reloadIssue}
      <button type="button" onClick={refreshPreservingView}>重试预览</button></p>}
    {stale && <div role="status" className="html-preview-pane__notice">
      源码已从其他编辑入口变化。<button type="button" onClick={refreshPreservingView}>刷新预览</button>
    </div>}
    <div className="html-preview-pane__body">
    <iframe ref={frame} title="HTML 预览" src={lease.url} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      style={{ pointerEvents: modePending ? 'none' : undefined }}
      onLoad={() => controller.current?.frameLoaded()} onError={() => { setModePending(false); setIssue('预览未能加载。可重新加载预览或切换源码；文档和输入均保留。') }} />
    {structureOpen && <HtmlStructureEditor committed={committed} lease={lease}
      pendingDraft={pendingSourceDraft || retainedDrafts.length > 0} loading={!frameReady} />}
    </div>
    {selected && <HtmlLightEditOverlay target={selected} committed={committed} position={position}
      value={textDrafts.find(selected, source)?.value ?? selected.report.rawText}
      onValue={value => textDrafts.change(selected, source, value)}
      onText={async value => {
        const result = await controller.current!.editText(value)
        if (result.status === 'applied' || result.status === 'unchanged') textDrafts.applied(selected, source, value)
        return result
      }} onImage={image => controller.current!.editImage(image)}
      onClose={() => setSelected(null)} />}
    {issue && <p role="alert" className="html-preview-pane__notice">{issue}</p>}
  </div>
}
