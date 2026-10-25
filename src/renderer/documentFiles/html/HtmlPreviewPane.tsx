import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent, type ClipboardEvent as ReactClipboardEvent } from 'react'
import { editorShortcut } from '../../../shared/editorShortcuts'
import { isEditorTextInputEvent, isEditorTextInputTarget } from '../../course/editorActionRouting'
import { decodeHtmlEntities } from '../../../shared/html/htmlSourceScanner'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewEditOutcome, HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { HtmlLightEditOverlay } from './HtmlLightEditOverlay'
import { HtmlPreviewController, type HtmlPreviewGesture, type HtmlSelectedTarget } from './htmlPreviewController'
import type { HtmlTextDrafts } from './htmlTextDrafts'
import './htmlPreview.css'
import { HtmlSourceAnalysis } from './htmlSourceAnalysis'
import { LocalAuthorTransformGesture, type FreeResizeHandle } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { frameToSpaceMatrix, transformPoint } from '../../../core/components/geometry'
import type { ComponentFrame } from '../../../shared/contracts/component-platform/frame'
import type { ComponentAuthorGeometry } from '../../../shared/contracts/component-platform/runtime'
import { workbenchSelection } from '../../workbench/SelectionContextController'
import { htmlNodePath, htmlTargetFromPreview, htmlTargetNode, type HtmlEditingTarget } from './htmlEditingTarget'
import { CanvasPlainTextEditor, type CanvasPlainTextEditorHandle, type PlainTextSelectionIntent } from '../../ui/CanvasPlainTextEditor'
import { HtmlSelectionToolbar, type HtmlSelectionToolbarHandle } from './HtmlSelectionToolbar'

const HtmlStructureEditor = lazy(() => import('./HtmlStructureEditor').then(module => ({ default: module.HtmlStructureEditor })))

type Patch = Extract<HtmlPreviewEditOutcome, { status: 'applied' }>['patch']
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
  if (raw && !scan.tokens.some(token => token.kind === 'text'
    && token.span.start <= span.start && token.span.end >= rawEnd)) return null
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
  /** A structure operation may proceed after unapplied text is durably retained. */
  preserveTextDrafts?(): Promise<boolean>
  onReloadRequest?(): void
  reloadIssue?: string | null
  target?: HtmlEditingTarget | null
  onTargetChange?(target: HtmlEditingTarget | null): void
}

/** Keeps one sandbox frame mounted across canonical text revisions. */
export function HtmlPreviewPane({ lease, committed, analysis: providedAnalysis, textDrafts, onUndo, onRedo, onSave, active = true, toolbarLeading,
  pendingSourceDraft = false, preserveTextDrafts, onReloadRequest, reloadIssue, target, onTargetChange }: HtmlPreviewPaneProps) {
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
  const [modeIssue, setModeIssue] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [contentEditing, setContentEditing] = useState(false)
  const contentEditingRef = useRef(false)
  const finishInlineRef = useRef<(value: string, retainSelection?: boolean) => Promise<boolean>>(async () => true)
  const handleGestureRef = useRef<(gesture: HtmlPreviewGesture, target: HtmlSelectedTarget) => void>(() => {})
  const [inlineSelection, setInlineSelection] = useState<PlainTextSelectionIntent | undefined>(undefined)
  const inlineSubmitting = useRef<Promise<boolean> | null>(null)
  const clipboardWrite = useRef<Promise<void> | null>(null)
  const clipboardScope = useRef({})
  const [inlineComposing, setInlineComposing] = useState(false)
  const inlineEditor = useRef<CanvasPlainTextEditorHandle>(null)
  const selectionCommands = useRef<HtmlSelectionToolbarHandle>(null)
  const selectAllOnEdit = useRef(false)
  useLayoutEffect(() => {
    if (contentEditing && selectAllOnEdit.current && inlineEditor.current) {
      selectAllOnEdit.current = false
      inlineEditor.current.selectAll()
    }
  }, [contentEditing])
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
  const transform = useRef<{ pointerId: number; authorKey: string; broker: HtmlPreviewController; gesture: LocalAuthorTransformGesture;
    target: HtmlSelectedTarget; origin: { x: number; y: number }; started: boolean; frame: ComponentFrame | null; geometry: ComponentAuthorGeometry | null } | null>(null)
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
  const beginTransformAt = (point: { x: number; y: number }, pointerId: number, target: HtmlSelectedTarget,
    mode: 'drag' | 'resize', handle?: FreeResizeHandle) => {
    const geometry = target.report.geometry, authorKey = target.report.authoring?.authorKey, iframe = frame.current
    if (!geometry || !authorKey || !iframe || !controller.current || transform.current || target.resolved.status !== 'editable') return false
    const box = iframe.getBoundingClientRect(), sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    try {
      transform.current = { pointerId, authorKey, broker: controller.current, geometry: null, frame: null, target, origin: point, started: false,
        gesture: new LocalAuthorTransformGesture({ geometry, kind: target.report.kind, mode,
          ...(mode === 'resize' ? { handle: handle ?? 'se' } : {}), rootToSurface: [1, 0, 0, 1, 0, 0],
          surfaceToPointer: [sx, 0, 0, sy, box.left + iframe.clientLeft * sx, box.top + iframe.clientTop * sy],
          pointer: point }) }
      return true
    } catch (reason) { setIssue(reason instanceof Error ? reason.message : String(reason)); cancelTransform(); return false }
  }
  const beginTransform = (event: ReactPointerEvent<HTMLButtonElement>, mode: 'drag' | 'resize', handle?: FreeResizeHandle) => {
    if (!selected || contentEditing || event.button !== 0) return
    if (!beginTransformAt({ x: event.clientX, y: event.clientY }, event.pointerId, selected, mode, handle)) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
  }
  const previewTransform = (point: { x: number; y: number; shift: boolean; alt: boolean }) => {
    const current = transform.current
    if (!current) return
    if (!current.started && Math.hypot(point.x - current.origin.x, point.y - current.origin.y) < 3) return
    current.started = true
    const result = current.gesture.update(point, { shift: point.shift, alt: point.alt })
    current.geometry = result.geometry
    current.frame = result.frame
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
  const finishTransformAt = async (point: { x: number; y: number; shift: boolean; alt: boolean }, pointerId: number) => {
    const current = transform.current
    if (!current || pointerId !== current.pointerId) return
    if (transformFrame.current) cancelAnimationFrame(transformFrame.current)
    transformFrame.current = 0; transformPointIntent.current = null
    // The pointerup point is authoritative even if the last preview frame was not sent.
    previewTransform(point)
    transform.current = null
    try {
      if (current.geometry && Object.keys(current.geometry).length) {
        const result = await current.broker.editGeometry(current.geometry, current.target, current.frame ?? undefined)
        if (result?.status === 'rejected') setIssue('对象已变化，位置未应用；请重新选择。')
      }
    } catch (reason) { setIssue(reason instanceof Error ? reason.message : String(reason)) }
    finally { current.broker.previewGeometry(current.authorKey, null); setGestureFrame(null) }
  }
  const finishTransform = async (event: ReactPointerEvent) => {
    if (!transform.current || event.pointerId !== transform.current.pointerId) return
    event.preventDefault(); event.stopPropagation()
    await finishTransformAt({ x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey }, event.pointerId)
  }
  handleGestureRef.current = (gesture, target) => {
    const iframe = frame.current
    if (!iframe) return
    const box = iframe.getBoundingClientRect(), sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    const point = { x: box.left + (gesture.x + iframe.clientLeft) * sx, y: box.top + (gesture.y + iframe.clientTop) * sy,
      shift: gesture.shift, alt: gesture.alt }
    if (gesture.phase === 'start') beginTransformAt(point, gesture.pointerId, target, 'drag')
    else if (gesture.phase === 'cancel') cancelTransform()
    else if (gesture.phase === 'end') void finishTransformAt(point, gesture.pointerId)
    else previewTransform(point)
  }
  const selectedBox = (() => {
    const geometry = selected?.report.geometry, iframe = frame.current, owner = container.current
    if (!selected || !iframe || !owner) return null
    if (!geometry) {
      const box = iframe.getBoundingClientRect(), outer = owner.getBoundingClientRect()
      const sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight, rect = selected.report.rect
      return { left: box.left - outer.left + rect.x * sx, top: box.top - outer.top + rect.y * sy, width: rect.width * sx, height: rect.height * sy, points: undefined }
    }
    const local = gestureFrame ?? geometry.frame, matrix = frameToSpaceMatrix(local, geometry.parentToInstance)
    const points = [{ x: 0, y: 0 }, { x: local.width, y: 0 }, { x: local.width, y: local.height }, { x: 0, y: local.height }].map(point => transformPoint(matrix, point))
    const box = iframe.getBoundingClientRect(), outer = owner.getBoundingClientRect()
    const sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    const xs = points.map(point => box.left - outer.left + (point.x + iframe.clientLeft) * sx)
    const ys = points.map(point => box.top - outer.top + (point.y + iframe.clientTop) * sy)
    const left = Math.min(...xs), top = Math.min(...ys)
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top, points: xs.map((x, index) => ({ x: x - left, y: ys[index]! - top })) }
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
    setModeIssue(null)
    setModePending(editModeRef.current)
    setEditMode(false)
    restoreAfterLoad.current = { ...view.current }
    history.current = []
    pendingEdit.current = null
    clipboardWrite.current = null
    clipboardScope.current = {}
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
    setModeIssue(null)
    setModePending(editModeRef.current)
    setEditMode(false)
    latestSource.current = source
    latestAnalysis.current = analysis
    history.current = []
    pendingEdit.current = null
    clipboardWrite.current = null
    clipboardScope.current = {}
    const instance = new HtmlPreviewController(iframe, lease, {
      onTarget(target, message) {
        const changed = target?.report.handle !== selectedTarget.current?.report.handle
        if (changed || target?.resolved.status !== 'editable') selectAllOnEdit.current = false
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
        // A selected HTML field has a keyboard owner too. Repeated target
        // refreshes must not pull focus out of a toolbar or another input.
        const focused = iframe.ownerDocument.activeElement
        if (target && changed && (focused === iframe || !isEditorTextInputTarget(focused))) container.current?.focus({ preventScroll: true })
        if (target && container.current) {
          const outer = container.current.getBoundingClientRect()
          const inner = iframe.getBoundingClientRect()
          const sx = inner.width / iframe.offsetWidth, sy = inner.height / iframe.offsetHeight
          setPosition({ left: Math.max(8, Math.min(container.current.clientWidth - 230, inner.left - outer.left + target.report.rect.x * sx)),
            top: Math.max(8, Math.min(container.current.clientHeight - 36, inner.top - outer.top + (target.report.rect.y + target.report.rect.height) * sy + 4)) })
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
        setModeIssue(null)
      },
      onEditModeError(message) { setModePending(false); setModeIssue(message); setSelected(null) },
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
        // A committed prop can arrive while the applied receipt is refreshing
        // its handle. It still belongs to that exact revision, not an unrelated
        // source change requiring a page reload and loss of the selected field.
        const applied = pending?.observedRevision === undefined ? undefined : history.current.find(item =>
          item.revision === pending.observedRevision && item.beforeSource === pending.beforeSource)
        if (applied && pending?.observedSource && !applied.afterSource) applied.afterSource = pending.observedSource
        if (pending?.observedSource && !history.current.some(item => item.beforeSource === pending.beforeSource && item.afterSource === pending.observedSource)) setStale(true)
      },
      onPatchMismatch() { setStale(true) },
      onSelection(handle, selection) { if (selectedTarget.current?.report.handle === handle) setInlineSelection(selection) },
      onContentEditing(editing) {
        const wasEditing = contentEditingRef.current
        contentEditingRef.current = editing; setContentEditing(editing)
        const focused = document.activeElement, input = container.current?.querySelector('.canvas-plain-text-editor__inline')
        if (wasEditing && !editing && (focused === input || document.activeElement === document.body)) container.current?.focus({ preventScroll: true })
      },
      async beforeTargetChange() {
        const previous = selectedTarget.current
        if (!contentEditingRef.current || previous?.report.kind !== 'text') return true
        return finishInlineRef.current(textDrafts.find(previous, latestSource.current)?.value ?? previous.report.rawText, false)
      },
      onGesture(gesture, target) { handleGestureRef.current(gesture, target) },
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
      if (reverse) { instance.patch({ ...reverse.patch, value: reverse.beforeValue, expected: reverse.patch.value, authoringRecords: analysis.authoring.authoringRecords }); setResponsiveNotice(null) }
      else if (forward) instance.patch({ ...forward.patch, expected: forward.beforeValue, authoringRecords: analysis.authoring.authoringRecords })
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

  const finishInline = (value: string, retainSelection = true): Promise<boolean> => {
    if (inlineSubmitting.current) return inlineSubmitting.current
    const target = selectedTarget.current, broker = controller.current
    if (!target || target.report.kind !== 'text' || !broker) return Promise.resolve(true)
    textDrafts.change(target, latestSource.current, value)
    const complete = () => {
      // A handoff retires the input without selecting its old address again.
      // The controller publishes the next target after this owner has settled.
      broker.setContentEditing(false)
      if (!retainSelection) { contentEditingRef.current = false; setContentEditing(false) }
    }
    if (value === target.report.rawText) { complete(); return Promise.resolve(true) }
    const pending = broker.editText(value, target).then(result => {
      if (result.status === 'applied' || result.status === 'unchanged') { textDrafts.applied(target, latestSource.current, value); complete(); return true }
      setIssue('这处文字尚未应用，原稿已保留；可重新定位，其他内容可继续编辑。'); return false
    }).catch(() => { setIssue('这处文字尚未应用，原稿已保留；可稍后重试或在源码中修改。'); return false }).finally(() => { inlineSubmitting.current = null })
    inlineSubmitting.current = pending
    return pending
  }
  finishInlineRef.current = finishInline
  const setEditing = async (next: boolean) => {
    if (inlineComposing) return
    const target = selectedTarget.current
    if (contentEditingRef.current && target?.report.kind === 'text') { const value = textDrafts.find(target, source)?.value ?? target.report.rawText; await finishInline(value) }
    // A failed field remains in its document draft owner; it does not own the
    // preview mode. The business program is enabled only after the real ACK.
    editModeRef.current = next; setModeIssue(null); setModePending(true); setSelected(null); controller.current?.setEditMode(next)
  }
  const inlineBox = (() => {
    const iframe = frame.current, outer = container.current
    if (!selected || !iframe || !outer) return null
    const box = iframe.getBoundingClientRect(), owner = outer.getBoundingClientRect(), sx = box.width / iframe.offsetWidth, sy = box.height / iframe.offsetHeight
    return { left: box.left - owner.left + selected.report.rect.x * sx, top: box.top - owner.top + selected.report.rect.y * sy,
      transform: `scale(${sx},${sy})`, transformOrigin: 'top left' }
  })()
  const canTransform = Boolean(selected?.report.geometry && selectedBox && selected.resolved.status === 'editable' && selected.report.authoring?.authorKey)
  const handlePosition = (handle: FreeResizeHandle) => {
    const corners = selectedBox?.points
    if (!corners) return { left: -5, top: -5 }
    const indexes = { nw: [0, 0], n: [0, 1], ne: [1, 1], e: [1, 2], se: [2, 2], s: [2, 3], sw: [3, 3], w: [3, 0] }[handle]
    const a = corners[indexes[0]!]!, b = corners[indexes[1]!]!
    return { left: (a.x + b.x) / 2 - 5, top: (a.y + b.y) / 2 - 5 }
  }
  const handleCursor = (handle: FreeResizeHandle) => {
    const point = handlePosition(handle), box = selectedBox
    if (!box) return 'default'
    const direction = Math.round(Math.atan2(point.top + 5 - box.height / 2, point.left + 5 - box.width / 2) / (Math.PI / 4))
    return `${['ew', 'nwse', 'ns', 'nesw'][(direction % 4 + 4) % 4]}-resize`
  }
  const finishContentEditing = () => {
    if (inlineComposing) return
    const target = selectedTarget.current
    if (target?.report.kind === 'text') void finishInline(textDrafts.find(target, source)?.value ?? target.report.rawText)
    else controller.current?.setContentEditing(false)
  }
  const prepareSelectedTarget = async () => {
    const captured = selectedTarget.current
    if (!captured) throw new Error('对象已变化，请重新选择。')
    const value = textDrafts.find(captured, latestSource.current)?.value ?? captured.report.rawText
    if (contentEditingRef.current && captured.report.kind === 'text' && !await finishInline(value)) throw new Error('文字尚未应用，输入已保留。')
    const current = selectedTarget.current
    if (!current || current.report.handle !== captured.report.handle) throw new Error('对象已变化，请重新选择；输入已保留。')
    if (current.report.rawText !== value || current.resolved.status === 'editable' && current.resolved.locator.revision !== currentRevision.current) {
      const refreshed = await controller.current?.refreshSelectedTarget({ ...current.report, rawText: value })
      if (!refreshed || refreshed.resolved.status !== 'editable') throw new Error('源码已变化，请重新选择；输入已保留。')
      return refreshed
    }
    return current
  }
  const quickBar = (() => {
    if (!selectedBox || !container.current) return null
    const rect = container.current.getBoundingClientRect()
    return { anchor: { left: rect.left + selectedBox.left, top: rect.top + selectedBox.top, width: selectedBox.width, height: selectedBox.height },
      bounds: { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(window.innerWidth, rect.right), bottom: Math.min(window.innerHeight, rect.bottom) } }
  })()
  const ownsSelectedClipboard = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const range = window.getSelection()
    const nativeRange = range?.toString() && container.current?.contains(range.anchorNode) && container.current.contains(range.focusNode)
    return active && editMode && !contentEditing && !inlineComposing && !event.defaultPrevented && !isEditorTextInputEvent(event.nativeEvent)
      && !nativeRange && selectedTarget.current?.report.kind === 'text'
  }
  const applySelectedText = (value: string) => {
    const captured = selectedTarget.current, broker = controller.current
    const scope = clipboardScope.current
    if (!captured || !broker || captured.resolved.status !== 'editable') return
    const perform = async () => {
      if (controller.current !== broker || !activeRef.current || clipboardScope.current !== scope) return
      const current = selectedTarget.current
      if (!editModeRef.current || contentEditingRef.current || current?.report.handle !== captured.report.handle || current.resolved.status !== 'editable') {
        setIssue('文字位置已变化，修改未应用；请重新选择。'); return
      }
      const result = await broker.editText(value, current)
      if (result.status === 'rejected' && clipboardScope.current === scope) setIssue('文字位置已变化，修改未应用；请重新选择。')
    }
    // A cut receipt refreshes this same handle's formal revision. Preserve a
    // following paste until that existing controller handoff has completed.
    const pending = (clipboardWrite.current ? clipboardWrite.current.then(perform) : perform())
      .catch(error => { if (controller.current === broker && clipboardScope.current === scope) setIssue(error instanceof Error ? error.message : '文字修改未应用，请重试。') })
      .finally(() => { if (clipboardWrite.current === pending) clipboardWrite.current = null })
    clipboardWrite.current = pending
  }
  const copySelected = (event: ReactClipboardEvent<HTMLDivElement>, cut = false) => {
    if (!ownsSelectedClipboard(event)) return
    const captured = selectedTarget.current!
    if (cut && captured.resolved.status !== 'editable') return
    // Clipboard storage must succeed before the canonical cut can remove text.
    try { event.clipboardData.setData('text/plain', captured.report.rawText) }
    catch (error) { setIssue(error instanceof Error ? error.message : '未能写入剪贴板，文字保持不变。'); return }
    event.preventDefault(); event.stopPropagation()
    if (cut) applySelectedText('')
  }
  return <div ref={container} className="html-preview-pane" tabIndex={-1} onPointerMove={updateTransform} onPointerUp={event => void finishTransform(event)}
    onCopy={event => copySelected(event)} onCut={event => copySelected(event, true)} onPaste={event => {
      if (!ownsSelectedClipboard(event) || selectedTarget.current?.resolved.status !== 'editable') return
      const text = event.clipboardData.getData('text/plain')
      if (!text) return
      event.preventDefault(); event.stopPropagation(); applySelectedText(text)
    }} onPointerCancel={cancelTransform} onKeyDown={event => {
      if (event.key === 'Escape' && transform.current) cancelTransform()
      if (!active || !editMode || event.defaultPrevented || inlineComposing || event.nativeEvent.isComposing || event.keyCode === 229 || isEditorTextInputEvent(event.nativeEvent)) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); controller.current?.clearSelection(); return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTarget.current?.report.kind === 'text' && selectedTarget.current.resolved.status === 'editable') {
        event.preventDefault(); event.stopPropagation(); applySelectedText(''); return
      }
      const shortcut = editorShortcut(event)
      if (shortcut === 'undo' || shortcut === 'redo') {
        event.preventDefault(); event.stopPropagation()
        if (shortcut === 'undo') onUndo(); else onRedo()
      } else if (shortcut === 'bold' || shortcut === 'italic' || shortcut === 'underline') {
        if (selectedTarget.current?.report.geometry) { event.preventDefault(); event.stopPropagation(); selectionCommands.current?.toggleFormat(shortcut) }
      } else if (shortcut === 'select-all' && selectedTarget.current?.report.kind === 'text' && selectedTarget.current.resolved.status === 'editable') {
        event.preventDefault(); event.stopPropagation()
        if (inlineEditor.current) inlineEditor.current.selectAll()
        else { selectAllOnEdit.current = true; controller.current?.beginContentEditing() }
      }
    }}>
    <div className="html-preview-pane__toolbar" role="toolbar" aria-label="HTML 分页">
      {toolbarLeading}
      <button type="button" className="html-preview-pane__edit" aria-pressed={editMode} disabled={!frameReady || modePending || inlineComposing || Boolean(modeIssue)}
        onClick={() => void setEditing(!editModeRef.current)}>{editMode ? '完成编辑' : '编辑'}</button>
      {editMode && <span role="status" className="html-preview-pane__edit-hint">单击选中，拖动对象，双击编辑；Esc 完成编辑</span>}
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
    {(modePending || modeIssue || !frameReady) && <p role={modeIssue ? 'alert' : 'status'} className="html-preview-pane__notice">
      {modeIssue ?? (modePending ? '正在准备编辑模式…' : '正在连接预览…')}
      <button type="button" onClick={refreshPreservingView}>重新连接预览</button>
    </p>}
    {reloadIssue && <p role="alert" className="html-preview-pane__notice">{reloadIssue}
      <button type="button" onClick={refreshPreservingView}>重试预览</button></p>}
    {stale && <div role="status" className="html-preview-pane__notice">
      源码已从其他编辑入口变化。<button type="button" onClick={refreshPreservingView}>刷新预览</button>
    </div>}
    <div className="html-preview-pane__body">
    <iframe ref={frame} title="HTML 预览" src={lease.url} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      style={{ pointerEvents: modePending || modeIssue ? 'none' : undefined }}
      onLoad={() => controller.current?.frameLoaded()} onError={() => { setModePending(false); setModeIssue('预览未能加载。可重新连接或切换源码，文档和输入均保留。') }} />
    {structureMounted && <Suspense fallback={structureOpen && active ? <p role="status">正在加载结构与样式…</p> : null}>
    <HtmlStructureEditor committed={committed} lease={lease} analysis={analysis} active={active && structureOpen} target={target ?? null}
      onTargetChange={(value, node, path) => {
        controller.current?.clearSelection()
        targetPublisher.current?.(value)
        if (path) controller.current?.selectSource(path, node.name === 'img' ? 'image' : node.kind === 'text' ? 'text' : null, node.value)
      }}
      pendingDraft={pendingSourceDraft} beforeSourceEdit={async () => !retainedDrafts.length || await preserveTextDrafts?.() === true} loading={!frameReady} />
    </Suspense>}
    </div>
    {selected && selectedBox && active && editMode && <div aria-label="HTML 对象选框"
      style={{ left: selectedBox.left, top: selectedBox.top, width: selectedBox.width, height: selectedBox.height,
        position: 'absolute', border: selectedBox.points ? undefined : '1px solid #1677ff', pointerEvents: 'none', boxSizing: 'border-box', zIndex: 10 }}>
      {selectedBox.points && <svg width="100%" height="100%" style={{ position: 'absolute', overflow: 'visible' }} aria-hidden="true">
        <polygon points={selectedBox.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#1677ff" strokeWidth="1" />
      </svg>}
      {canTransform && !contentEditing && (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map(handle => <button key={handle} type="button"
        aria-label={`缩放 HTML 对象 ${handle}`} onPointerDown={event => beginTransform(event, 'resize', handle)}
        onLostPointerCapture={() => { if (transform.current) cancelTransform() }}
        style={{ position: 'absolute', ...handlePosition(handle),
          width: 10, height: 10, padding: 0, border: '1px solid #1677ff', background: '#fff', pointerEvents: 'auto',
          cursor: handleCursor(handle), touchAction: 'none' }} />)}
    </div>}
    {selected && quickBar && active && editMode && !(contentEditing && selected.report.kind === 'image') && <HtmlSelectionToolbar
      key={selected.report.handle} commands={selectionCommands} target={selected} committed={committed} lease={lease} {...quickBar} editing={contentEditing} composing={inlineComposing}
      style={{ ...selected.report.textStyle, ...selected.report.authoring?.record.overrides.style,
        ...analysis.authoring.authoringRecords[selected.report.authoring?.authorKey ?? '']?.overrides.style }}
      onEdit={() => contentEditing ? finishContentEditing() : controller.current?.beginContentEditing()} prepareTarget={prepareSelectedTarget}
      onStyle={async patch => { const target = await prepareSelectedTarget(); return controller.current!.editStyle(patch, target) }} />}
    {selected?.report.kind === 'text' && selected.resolved.status === 'editable' && inlineBox && active && editMode && contentEditing && <div data-component-professional-editor="" style={{ ...inlineBox, position: 'absolute', zIndex: 20, pointerEvents: 'auto' }}>
      <CanvasPlainTextEditor key={selected.report.handle} editorRef={inlineEditor} presentation="inline" bounds={{ x: 0, y: 0, width: selected.report.rect.width, height: selected.report.rect.height }}
        onFormatShortcut={selected.report.geometry ? format => selectionCommands.current?.toggleFormat(format) : undefined}
        multiline label="编辑此处文字" textStyle={selected.report.textStyle} selectionIntent={inlineSelection} initialCaret={selected.report.selection?.anchor}
        value={textDrafts.find(selected, source)?.value ?? selected.report.rawText}
        onDraftChange={(value, composing) => { setInlineComposing(composing); textDrafts.change(selected, source, value) }} onCommit={value => { void finishInline(value) }} onCancel={finishContentEditing} />
    </div>}
    {selected && selected.report.kind !== 'text' && editMode && contentEditing && <HtmlLightEditOverlay target={selected} committed={committed} lease={lease} position={position}
      value={textDrafts.find(selected, source)?.value ?? selected.report.rawText}
      onValue={value => textDrafts.change(selected, source, value)}
      onText={async value => {
        const result = await controller.current!.editText(value)
        if (result.status === 'applied' || result.status === 'unchanged') textDrafts.applied(selected, source, value)
        return result
      }} onImage={image => controller.current!.editImage(image, selected)} onStyle={patch => controller.current!.editStyle(patch)}
      onClose={() => controller.current?.setContentEditing(false)} />}
    {issue && <p role="alert" className="html-preview-pane__notice">{issue}</p>}
  </div>
}
