import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { decodeHtmlEntities } from '../../../shared/html/htmlSourceScanner'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { HtmlLightEditOverlay } from './HtmlLightEditOverlay'
import { HtmlPreviewController, type HtmlSelectedTarget } from './htmlPreviewController'
import type { HtmlTextDrafts } from './htmlTextDrafts'
import './htmlPreview.css'
import { HtmlSourceAnalysis } from './htmlSourceAnalysis'
import { LocalAuthorTransformGesture } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { frameToSpaceMatrix, transformPoint } from '../../../core/components/geometry'
import type { ComponentFrame } from '../../../shared/contracts/component-platform/frame'
import type { ComponentAuthorGeometry } from '../../../shared/contracts/component-platform/runtime'
import { workbenchSelection } from '../../workbench/SelectionContextController'
import { htmlNodePath, htmlTargetFromPreview, htmlTargetNode, type HtmlEditingTarget } from './htmlEditingTarget'
import { CanvasPlainTextEditor, type PlainTextSelectionIntent } from '../../ui/CanvasPlainTextEditor'

const HtmlStructureEditor = lazy(() => import('./HtmlStructureEditor').then(module => ({ default: module.HtmlStructureEditor })))

type Patch = { handle: string; kind: 'text' | 'image'; value: string }
type ChangeRecord = { revision: number; beforeSource: string; afterSource?: string; beforeValue: string; patch: Patch }
const targetStamp = (target: HtmlEditingTarget, loadId: string) => `${loadId}:${target.revision}:${target.source?.kind ?? ''}:${target.source?.from ?? ''}:${target.source?.to ?? ''}:${target.authorKey ?? ''}`

/** Patch a selected text node only when the canonical change is exactly that source span. */
function selectedTextChange(before: string, after: string, selected: HtmlSelectedTarget | null,
  revision: number, analysis: HtmlSourceAnalysis): { patch: Patch; beforeValue: string } | null {
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
  const scan = analysis.scan
  if (scan.diagnostics.length || (raw && !scan.tokens.some(token => token.kind === 'text'
    && token.span.start <= span.start && token.span.end >= rawEnd))) return null
  return { patch: { handle: selected.report.handle, kind: 'text',
    value: decodeHtmlEntities(raw.replace(/\r\n?/g, '\n')) }, beforeValue: selected.report.rawText }
}

export interface HtmlPreviewPaneProps {
  lease: HtmlPreviewLease
  committed: DocumentSnapshot
  analysis?: HtmlSourceAnalysis
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
  target?: HtmlEditingTarget | null
  onTargetChange?(target: HtmlEditingTarget | null): void
}

/** Keeps one sandbox frame mounted across canonical text revisions. */
export function HtmlPreviewPane({ lease, committed, analysis: providedAnalysis, textDrafts, onUndo, onRedo, onSave, active = true, toolbarLeading,
  pendingSourceDraft = false, onReloadRequest, reloadIssue, target, onTargetChange }: HtmlPreviewPaneProps) {
  const retainedDrafts = useSyncExternalStore(textDrafts.subscribe, textDrafts.read)
  const frame = useRef<HTMLIFrameElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const controller = useRef<HtmlPreviewController | null>(null)
  const selectedTarget = useRef<HtmlSelectedTarget | null>(null)
  const activeRef = useRef(active); activeRef.current = active
  const targetPublisher = useRef(onTargetChange); targetPublisher.current = onTargetChange
  const synchronizingTarget = useRef(false)
  const locatedTarget = useRef<string | null>(null)
  const currentRevision = useRef(committed.revision); currentRevision.current = committed.revision
  void onSave
  const source = committed.model.kind === 'text' ? committed.model.source : ''
  const analysis = useMemo(() => providedAnalysis?.source === source ? providedAnalysis : new HtmlSourceAnalysis(source), [providedAnalysis, source])
  const latestSource = useRef(source)
  const latestAnalysis = useRef(analysis)
  const history = useRef<ChangeRecord[]>([])
  const pendingEdit = useRef<{ beforeSource: string; observedSource?: string; observedRevision?: number } | null>(null)
  const view = useRef({ index: 0, scroll: 0 })
  const restoreAfterLoad = useRef<{ index: number; scroll: number } | null>(null)
  const editModeRef = useRef(true)
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
  const [inlineSelection, setInlineSelection] = useState<PlainTextSelectionIntent | undefined>(undefined)
  const inlineSubmitting = useRef<Promise<boolean> | null>(null)
  useEffect(() => {
    if (!active) return
    const clear = workbenchSelection.registerSelectionClearer(committed.documentId, () => controller.current?.clearSelection())
    const unregister = workbenchSelection.registerTargetView(committed.documentId, {
      root: () => frame.current,
      rect: target => target.kind === 'html-author-field' ? controller.current?.cardRect(target.authorKey) ?? null : null,
      select: target => target.kind === 'html-author-field' ? controller.current?.selectAuthor(target.authorKey) ?? false : false,
    })
    return () => { clear(); unregister() }
  }, [committed.documentId, active])
  const [structureOpen, setStructureOpen] = useState(false)
  const [structureMounted, setStructureMounted] = useState(false)
  const [gestureFrame, setGestureFrame] = useState<ComponentFrame | null>(null)
  const transform = useRef<{ pointerId: number; authorKey: string; broker: HtmlPreviewController; gesture: LocalAuthorTransformGesture; geometry: ComponentAuthorGeometry | null } | null>(null)
  const transformFrame = useRef(0)
  const transformPointIntent = useRef<{ x: number; y: number; shift: boolean; alt: boolean } | null>(null)
  const cancelTransform = () => {
    if (transformFrame.current) cancelAnimationFrame(transformFrame.current)
    transformFrame.current = 0; transformPointIntent.current = null
    const current = transform.current
    if (current) current.broker.previewGeometry(current.authorKey, null)
    transform.current = null; setGestureFrame(null)
  }
  useEffect(() => { if (!active || !selected) cancelTransform() }, [active, selected?.report.handle])
  useEffect(() => () => {
    if (transformFrame.current) cancelAnimationFrame(transformFrame.current)
    transformFrame.current = 0; transformPointIntent.current = null
    const current = transform.current; if (current) current.broker.previewGeometry(current.authorKey, null); transform.current = null
  }, [])
  const beginTransform = (event: ReactPointerEvent<HTMLButtonElement>, mode: 'drag' | 'resize') => {
    const geometry = selected?.report.geometry, authorKey = selected?.report.authoring?.authorKey, iframe = frame.current
    if (!geometry || !authorKey || !iframe || !controller.current || event.button !== 0 || transform.current) return
    const box = iframe.getBoundingClientRect(), sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    try {
      transform.current = { pointerId: event.pointerId, authorKey, broker: controller.current, geometry: null,
        gesture: new LocalAuthorTransformGesture({ geometry, kind: selected!.report.kind, mode,
          ...(mode === 'resize' ? { handle: 'se' as const } : {}), rootToSurface: [1, 0, 0, 1, 0, 0],
          surfaceToPointer: [sx, 0, 0, sy, box.left + iframe.clientLeft * sx, box.top + iframe.clientTop * sy],
          pointer: { x: event.clientX, y: event.clientY } }) }
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
      setGestureFrame(geometry.frame)
    } catch (reason) { setIssue(reason instanceof Error ? reason.message : String(reason)); cancelTransform() }
  }
  const previewTransform = (point: { x: number; y: number; shift: boolean; alt: boolean }) => {
    const current = transform.current
    if (!current) return
    const result = current.gesture.update(point, { shift: point.shift, alt: point.alt })
    current.geometry = result.geometry
    setGestureFrame(result.frame)
    current.broker.previewGeometry(current.authorKey, result.geometry)
  }
  const updateTransform = (event: ReactPointerEvent) => {
    if (!transform.current || event.pointerId !== transform.current.pointerId) return
    transformPointIntent.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey }
    if (!transformFrame.current) transformFrame.current = requestAnimationFrame(() => {
      transformFrame.current = 0
      const point = transformPointIntent.current; transformPointIntent.current = null
      if (point) previewTransform(point)
    })
    event.preventDefault(); event.stopPropagation()
  }
  const finishTransform = async (event: ReactPointerEvent) => {
    const current = transform.current
    if (!current || event.pointerId !== current.pointerId) return
    if (transformFrame.current) cancelAnimationFrame(transformFrame.current)
    transformFrame.current = 0; transformPointIntent.current = null
    // The pointerup point is authoritative even if the last preview frame was not sent.
    previewTransform({ x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey })
    transform.current = null
    event.preventDefault(); event.stopPropagation()
    try {
      if (current.geometry && Object.keys(current.geometry).length) {
        const result = await current.broker.editGeometry(current.geometry)
        if (result?.status === 'rejected') setIssue('对象已变化，位置未应用；请重新选择。')
      }
    } catch (reason) { setIssue(reason instanceof Error ? reason.message : String(reason)) }
    finally { current.broker.previewGeometry(current.authorKey, null); setGestureFrame(null) }
  }
  const selectedBox = (() => {
    const geometry = selected?.report.geometry, iframe = frame.current, owner = container.current
    if (!geometry || !iframe || !owner) return null
    const local = gestureFrame ?? geometry.frame, matrix = frameToSpaceMatrix(local, geometry.parentToInstance)
    const points = [{ x: 0, y: 0 }, { x: local.width, y: 0 }, { x: 0, y: local.height }, { x: local.width, y: local.height }].map(point => transformPoint(matrix, point))
    const box = iframe.getBoundingClientRect(), outer = owner.getBoundingClientRect()
    const sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    const xs = points.map(point => box.left - outer.left + (point.x + iframe.clientLeft) * sx)
    const ys = points.map(point => box.top - outer.top + (point.y + iframe.clientTop) * sy)
    return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  })()
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
    latestAnalysis.current = analysis
    history.current = []
    pendingEdit.current = null
    const instance = new HtmlPreviewController(iframe, lease, {
      onTarget(target, message) {
        if (!synchronizingTarget.current) {
          if (target) {
            const value = htmlTargetFromPreview(target, target.resolved.status === 'editable' ? target.resolved.locator.revision : currentRevision.current)
            locatedTarget.current = targetStamp(value, lease.loadId)
            targetPublisher.current?.(value)
          } else if (selectedTarget.current) { locatedTarget.current = null; targetPublisher.current?.(null) }
        }
        selectedTarget.current = target
        setInlineSelection(target?.report.selection)
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
      onSelection(handle, selection) { if (selectedTarget.current?.report.handle === handle) setInlineSelection(selection) },
    })
    controller.current = instance
    return () => { instance.dispose(); if (controller.current === instance) controller.current = null }
    // The lease/load owns the frame. A source revision is reconciled below.
  }, [lease.leaseId, lease.loadId])

  useEffect(() => {
    const instance = controller.current
    if (!active) { instance?.updateCommitted(committed, analysis); if (source !== latestSource.current) setStale(true); return }
    if (!instance || source === latestSource.current) { instance?.updateCommitted(committed, analysis); return }
    const previous = latestSource.current
    if ((latestAnalysis.current.source === previous ? latestAnalysis.current : new HtmlSourceAnalysis(previous)).authoring.source === analysis.authoring.source) {
      latestSource.current = source
      latestAnalysis.current = analysis
      instance.updateCommitted(committed, analysis)
      return
    }
    if (pendingEdit.current) {
      pendingEdit.current.observedSource = source
      pendingEdit.current.observedRevision = committed.revision
      latestSource.current = source
      latestAnalysis.current = analysis
      instance.updateCommitted(committed, analysis)
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
        const exact = selectedTextChange(previous, source, selectedTarget.current, committed.revision, analysis)
        if (exact) {
          instance.patch({ ...exact.patch, expected: exact.beforeValue })
          history.current.push({ revision: committed.revision, beforeSource: previous, afterSource: source,
            beforeValue: exact.beforeValue, patch: exact.patch })
          if (history.current.length > 100) history.current.shift()
        } else setStale(true)
      }
    }
    latestSource.current = source
    latestAnalysis.current = analysis
    instance.updateCommitted(committed, analysis)
  }, [committed, source, active])

  useEffect(() => { controller.current?.setVisibility(active) }, [active, lease.leaseId, lease.loadId])
  useEffect(() => {
    const instance = controller.current
    if (!active || !target) { locatedTarget.current = null; return }
    if (!frameReady || target.revision !== committed.revision || !instance) return
    const stamp = targetStamp(target, lease.loadId)
    if (locatedTarget.current === stamp) return
    locatedTarget.current = stamp
    // A source/group selection retires the former field popover without
    // publishing a second author target from this disposable view.
    synchronizingTarget.current = true
    try { instance.clearSelection() } finally { synchronizingTarget.current = false }
    if (target.source) {
      const node = htmlTargetNode(target, analysis.nodes, committed.revision)
      const path = node && htmlNodePath(analysis.structure.roots, node.key)
      if (node && path) instance.selectSource(path, node.name === 'img' ? 'image' : node.kind === 'text' ? 'text' : null, node.value)
    } else if (target.authorKey) instance.selectAuthor(target.authorKey)
  }, [active, frameReady, target, analysis, committed.revision, lease.loadId])
  useEffect(() => { if (active && stale) refreshPreservingView() }, [active, stale, lease.url])

  const finishInline = (value: string): Promise<boolean> => {
    if (inlineSubmitting.current) return inlineSubmitting.current
    const target = selectedTarget.current, broker = controller.current
    if (!target || target.report.kind !== 'text' || !broker) return Promise.resolve(true)
    textDrafts.change(target, latestSource.current, value)
    if (value === target.report.rawText) { broker.clearSelection(); return Promise.resolve(true) }
    const pending = broker.editText(value, target).then(result => {
      if (result.status === 'applied' || result.status === 'unchanged') { textDrafts.applied(target, latestSource.current, value); if (result.status === 'unchanged') broker.clearSelection(); return true }
      setIssue('文字尚未应用，草稿已保留；请重新定位原文字。'); return false
    }).catch(error => { setIssue(String(error)); return false }).finally(() => { inlineSubmitting.current = null })
    inlineSubmitting.current = pending
    return pending
  }
  const setEditing = async (next: boolean) => {
    const target = selectedTarget.current
    if (target?.report.kind === 'text') { const value = textDrafts.find(target, source)?.value ?? target.report.rawText; if (!await finishInline(value)) return }
    editModeRef.current = next; setModePending(true); setSelected(null); controller.current?.setEditMode(next)
  }
  const inlineBox = (() => {
    const iframe = frame.current, outer = container.current
    if (!selected || !iframe || !outer) return null
    const box = iframe.getBoundingClientRect(), owner = outer.getBoundingClientRect(), sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    return { left: box.left - owner.left + selected.report.rect.x * sx, top: box.top - owner.top + selected.report.rect.y * sy,
      transform: `scale(${sx},${sy})`, transformOrigin: 'top left' }
  })()
  const canTransform = Boolean(selectedBox && selected?.resolved.status === 'editable' && selected.report.authoring?.authorKey)
  return <div ref={container} className="html-preview-pane" onPointerMove={updateTransform} onPointerUp={event => void finishTransform(event)}
    onPointerCancel={cancelTransform} onKeyDown={event => { if (event.key === 'Escape' && transform.current) cancelTransform() }}>
    <div className="html-preview-pane__toolbar" role="toolbar" aria-label="HTML 分页">
      {toolbarLeading}
      <div role="group" aria-label="HTML 操作模式">
        <button type="button" aria-pressed={editMode} disabled={!frameReady || modePending} onClick={() => void setEditing(true)}>编辑</button>
        <button type="button" aria-pressed={!editMode} disabled={!frameReady || modePending} onClick={() => void setEditing(false)}>试运行</button>
      </div>
      {editMode && <span role="status">点文字编辑；可移动对象选中后显示手柄</span>}
      {pageCount > 1 && <div className="html-preview-pane__pages" role="group" aria-label="页面导航">
        <button type="button" disabled={page === 0} onClick={() => controller.current?.navigate(page - 1)}>上一页</button>
        <span>{page + 1} / {pageCount}</span>
        <button type="button" disabled={page >= pageCount - 1} onClick={() => controller.current?.navigate(page + 1)}>下一页</button>
      </div>}
      <button type="button" aria-pressed={structureOpen} onClick={() => { setStructureMounted(true); setStructureOpen(value => !value) }}>结构与样式</button>
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
    {structureMounted && <Suspense fallback={structureOpen && active ? <p role="status">正在加载结构与样式…</p> : null}>
    <HtmlStructureEditor committed={committed} lease={lease} analysis={analysis} active={active && structureOpen} target={target ?? null}
      onTargetChange={(value, node, path) => {
        controller.current?.clearSelection()
        targetPublisher.current?.(value)
        if (path) controller.current?.selectSource(path, node.name === 'img' ? 'image' : node.kind === 'text' ? 'text' : null, node.value)
      }}
      pendingDraft={pendingSourceDraft || retainedDrafts.length > 0} loading={!frameReady} />
    </Suspense>}
    </div>
    {canTransform && selectedBox && active && editMode && <div aria-label="HTML 内部对象变换"
      style={{ ...selectedBox, position: 'absolute', border: '1px solid #1677ff', pointerEvents: 'none', boxSizing: 'border-box', zIndex: 10 }}>
      <button type="button" aria-label="移动 HTML 内部对象" onPointerDown={event => beginTransform(event, 'drag')}
        onLostPointerCapture={() => { if (transform.current) cancelTransform() }}
        style={{ position: 'absolute', left: 0, top: -25, pointerEvents: 'auto', cursor: 'move', touchAction: 'none' }}>移动</button>
      <button type="button" aria-label={selected?.report.kind === 'text' ? '调整 HTML 文字内容盒' : '缩放 HTML 图片'} onPointerDown={event => beginTransform(event, 'resize')}
        onLostPointerCapture={() => { if (transform.current) cancelTransform() }}
        style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, padding: 0, background: '#1677ff', pointerEvents: 'auto', cursor: 'nwse-resize', touchAction: 'none' }} />
    </div>}
    {selected?.report.kind === 'text' && selected.resolved.status === 'editable' && inlineBox && active && editMode && <div data-component-professional-editor="" style={{ ...inlineBox, position: 'absolute', zIndex: 20, pointerEvents: 'auto' }}>
      <CanvasPlainTextEditor key={selected.report.handle} presentation="inline" bounds={{ x: 0, y: 0, width: selected.report.rect.width, height: selected.report.rect.height }}
        multiline label="编辑此处文字" textStyle={selected.report.textStyle} selectionIntent={inlineSelection} initialCaret={selected.report.selection?.anchor}
        value={textDrafts.find(selected, source)?.value ?? selected.report.rawText}
        onDraftChange={value => textDrafts.change(selected, source, value)} onCommit={value => { void finishInline(value) }} onCancel={() => setSelected(null)} />
    </div>}
    {selected && selected.report.kind !== 'text' && editMode && <HtmlLightEditOverlay target={selected} committed={committed} position={position}
      value={textDrafts.find(selected, source)?.value ?? selected.report.rawText}
      onValue={value => textDrafts.change(selected, source, value)}
      onText={async value => {
        const result = await controller.current!.editText(value)
        if (result.status === 'applied' || result.status === 'unchanged') textDrafts.applied(selected, source, value)
        return result
      }} onImage={image => controller.current!.editImage(image)} onStyle={patch => controller.current!.editStyle(patch)}
      onClose={() => setSelected(null)} />}
    {issue && <p role="alert" className="html-preview-pane__notice">{issue}</p>}
  </div>
}
