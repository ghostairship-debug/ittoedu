import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { CopyPlus, Trash2 } from 'lucide-react'
import type { EditorSession, SelectionPane, SlideEditor } from '@web-ppt/editor'
import type { Selection, SlideId, TextPosition } from '@web-ppt/edit-core'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { PptxPreviewSnapshot } from '../../../shared/workbench/officePreview'
import type { OfficeEditorHandle } from './officeEditorHandle'
import { PptxFilePreview } from './PptxFilePreview'
import { PptxObjectPanel } from './PptxObjectPanel'
import { localOfficeProjection } from './localOfficeProjection'
import type { PptxObjectEdit } from '../../../shared/workbench/officeFiles'
import { arrangePptxObjects, copyPptxObjects, deletePptxObjects, editPptxTable, formatPptxObjectText, insertPptxShape, pastePptxObjects, pptxClipboardNeedsTableProjection, pptxFocus, pptxObjectSelection, pptxSelectionIds, queryPptxObjectRunProps, restorePptxSelection, selectAllPptxObjects, selectPptxContextTarget } from './pptxCanvasCommands'
import type { PptxTableAction, PptxTextFormat } from './pptxCanvasCommands'
import { QuickBarButton, QuickBarPopoverButton } from '../../editing/quickbar/SelectionQuickBar'
import { unionBoxes } from '../../editing/quickbar/placeQuickBar'
import { OfficeSelectionTools, type OfficeSelection } from './OfficeSelectionTools'
import './pptxFileEditor.css'

export interface PptxFileEditorProps {
  snapshot: PptxPreviewSnapshot
  name: string
  active?: boolean
  autoSave?: boolean
  onAutoSaveChange?(enabled: boolean): void
  onSave?(): Promise<boolean>
  onSaveAs?(): Promise<boolean>
  onCommit(binding: FileArtifactBinding, bytes: Uint8Array): Promise<PptxPreviewSnapshot>
  onEdit?(edits: PptxObjectEdit[]): Promise<void>
  onUndo(): Promise<void>
  onRedo(): Promise<void>
  onReload(): Promise<unknown>
  onDirtyChange(dirty: boolean): void
  onOpenExternal?(): Promise<void> | void
  onImportToCourse?(): Promise<void> | void
  onFocusChange?(focus: { page: number; part?: string; shapeIds: string[] }): void
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const sameBinding = (a: FileArtifactBinding, b: FileArtifactBinding) => a.path === b.path && a.bindingVersion === b.bindingVersion && a.fileVersion === b.fileVersion
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function capturePptxText(known: Extract<Selection, { kind: 'text' }>, paragraphs: readonly { runs: readonly { text: string; field?: string }[] }[]) {
  const order = (a: TextPosition, b: TextPosition) => a.p - b.p || a.r - b.r || a.off - b.off
  const [start, end] = order(known.anchor, known.focus) <= 0 ? [known.anchor, known.focus] : [known.focus, known.anchor]
  const valid = (point: TextPosition) => {
    const runs = paragraphs[point.p]?.runs
    return runs && point.off >= 0 && (point.r === runs.length ? point.off === 0
      : point.r >= 0 && point.r < runs.length && point.off <= runs[point.r]!.text.length)
  }
  if (!valid(start) || !valid(end)) return undefined
  const selectedParagraphs = paragraphs.slice(start.p, end.p + 1)
  if (selectedParagraphs.some(paragraph => paragraph.runs.some(run => Boolean(run.field)))) return undefined
  const rendered = selectedParagraphs.map(paragraph => paragraph.runs.map(run => run.text))
  const spans: Array<{ paragraph: number; run: number; from: number; to: number; prefix: string; suffix: string }> = []
  const selected = rendered.map((runs, index) => {
    const paragraph = start.p + index
    return runs.map((text, run) => {
      if (paragraph === start.p && run < start.r || paragraph === end.p && run > end.r) return ''
      const from = paragraph === start.p && run === start.r ? start.off : 0
      const to = paragraph === end.p && run === end.r ? end.off : text.length
      if (from === to) return ''
      spans.push({ paragraph, run, from, to, prefix: text.slice(0, from), suffix: text.slice(to) })
      return text.slice(from, to)
    }).join('')
  }).join('\n')
  return spans.length ? { spans, selected, rendered, firstParagraph: start.p } : undefined
}

/** One editable projection, one existing physical writer and one user-visible history. */
export const PptxFileEditor = forwardRef<OfficeEditorHandle, PptxFileEditorProps>(function PptxFileEditor(props, ref) {
  const latest = useRef(props); latest.current = props
  const root = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const unregisterSelectionUi = useRef<(() => void) | null>(null)
  const registerSelectionUi = useCallback((node: HTMLSpanElement | null) => {
    unregisterSelectionUi.current?.()
    const tools = node?.closest<HTMLElement>('[data-selection-quick-bar]')
    unregisterSelectionUi.current = tools ? view.current?.registerTextUi(tools) ?? null : null
  }, [])
  const objectPane = useRef<HTMLDivElement>(null), selectionPane = useRef<SelectionPane | null>(null)
  const session = useRef<EditorSession | null>(null), view = useRef<SlideEditor | null>(null)
  const source = useRef(props.snapshot)
  const submitted = useRef<Uint8Array | null>(null), pending = useRef<Promise<boolean> | null>(null)
  const composing = useRef(false), pointerDown = useRef(false), sequence = useRef(0), alive = useRef(true)
  const rememberedPart = useRef<string | undefined>(undefined), rememberedIndex = useRef(0)
  const rememberedShapes = useRef<string[]>([]), deferredSnapshot = useRef(false)
  const unwatch = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(0), [slides, setSlides] = useState<SlideId[]>([])
  const [page, setPage] = useState<SlideId | null>(null), [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null), [openError, setOpenError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [propertyTarget, setPropertyTarget] = useState<{ part: string; shapeId: string } | null>(null)
  const propertyProjection = useRef<{ part: string; shapeId: string;
    slide: NonNullable<PptxPreviewSnapshot['inspection']>['slides'][number];
    object: NonNullable<PptxPreviewSnapshot['inspection']>['slides'][number]['shapes'][number] } | null>(null)
  const [propertyDirty, setPropertyDirty] = useState(false), propertyDraft = useRef(false)
  const [showObjects, setShowObjects] = useState(false), [clipboardBusy, setClipboardBusy] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const reportDirty = () => {
    const value = Boolean(session.current?.editor.isDirty()) || composing.current || propertyDraft.current
    if (alive.current) setDirty(value)
    latest.current.onDirtyChange(value)
  }
  const propertyDirtyChanged = useCallback((value: boolean) => {
    propertyDraft.current = value; setPropertyDirty(value); reportDirty()
    if (!value && deferredSnapshot.current && !session.current?.editor.isDirty() && !pending.current) setReload(n => n + 1)
  }, [])
  const publishFocus = () => {
    const current = session.current?.editor, slide = view.current?.slideId
    if (!current || !slide) return
    const focus = pptxFocus(current, slide)
    rememberedPart.current = focus.part; rememberedIndex.current = focus.page; rememberedShapes.current = focus.shapeIds
    latest.current.onFocusChange?.(focus)
  }
  const historyPending = useRef<Promise<boolean> | null>(null)
  async function flush(fromHistory = false): Promise<boolean> {
    if (!fromHistory && historyPending.current && !await historyPending.current) return false
    if (propertyDraft.current) { setError('请先应用或取消属性中的输入。'); return false }
    if (pending.current) { if (!await pending.current) return false }
    const current = session.current
    if (!current || current.disposed) return !latest.current.snapshot.editingError
    if (composing.current || pointerDown.current) {
      setError('请完成当前输入或拖动后再保存。'); return false
    }
    if (!current.editor.isDirty()) {
      if (deferredSnapshot.current) setReload(n => n + 1)
      return true
    }
    const expected = source.current.binding, version = sequence.current, confirm = current.editor.captureSavepoint()
    const work = (async () => {
      setSaving(true); setError(null)
      try {
        if (!current.editor.doc.package || current.editor.doc.meta.readonly) throw new Error('当前文件缺少可保全原件的编辑上下文；原件未修改。')
        const { serializeEditDoc } = await import('@web-ppt/edit-core/save')
        const result = await serializeEditDoc(current.editor.doc)
        try {
          if (version !== sequence.current || composing.current || pointerDown.current) {
            throw new Error('保存准备期间内容发生变化，当前草稿已保留，请完成输入后保存。')
          }
          submitted.current = result.bytes
          const saved = await latest.current.onCommit(expected, result.bytes)
          // The shared draft acknowledges this exact canvas savepoint.
          source.current = saved
          submitted.current = saved.bytes
          confirm(); reportDirty(); publishFocus()
          // The canvas stays editable while onCommit is pending. A savepoint
          // acknowledges only its captured prefix, not any later input.
          return !current.editor.isDirty() && !composing.current && !pointerDown.current && !propertyDraft.current
        } finally {
          // Serialization may adopt this result as the active package; the session owns it.
          // Dispose only a detached result.
          if (result.package !== current.editor.doc.package) (await import('@web-ppt/edit-core/opc')).disposeOpcPackage(result.package)
        }
      } catch (reason) {
        if (alive.current) setError(message(reason))
        reportDirty(); return false
      } finally {
        pending.current = null
        if (alive.current) {
          setSaving(false)
          if (deferredSnapshot.current && !current.editor.isDirty() && !propertyDraft.current) setReload(n => n + 1)
        }
      }
    })()
    pending.current = work
    return work
  }
  const flushRef = useRef(flush); flushRef.current = flush
  useImperativeHandle(ref, () => ({ flush: () => flushRef.current() }), [])
  const history = (action: 'undo' | 'redo') => {
    if (historyPending.current) return historyPending.current
    const work = Promise.resolve().then(async () => {
      if (!await flush(true)) return false
      try { await latest.current[action === 'undo' ? 'onUndo' : 'onRedo'](); return true }
      catch (reason) { setError(message(reason)); return false }
    })
    historyPending.current = work
    void work.finally(() => { if (historyPending.current === work) historyPending.current = null })
    return work
  }
  const historyRef = useRef(history); historyRef.current = history
  const objectClipboardRef = useRef({ clipboard, duplicateObjects }); objectClipboardRef.current = { clipboard, duplicateObjects }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; unwatch.current?.()
      selectionPane.current?.destroy(); view.current?.destroy(); session.current?.dispose()
      latest.current.onDirtyChange(false)
    }
  }, [])

  useEffect(() => {
    if (session.current && sameBytes(source.current.bytes, props.snapshot.bytes)) {
      source.current = props.snapshot; deferredSnapshot.current = false; return
    }
    if (session.current && submitted.current && sameBytes(submitted.current, props.snapshot.bytes)) {
      source.current = props.snapshot; deferredSnapshot.current = false; return
    }
    if (session.current?.editor.isDirty() || composing.current || pointerDown.current || propertyDraft.current || pending.current) {
      deferredSnapshot.current = true
      setError('原件已由其他操作更新；当前人工草稿仍保留，未覆盖新版本。请先保留或处理当前修改。')
      return
    }
    let cancelled = false
    deferredSnapshot.current = false
    unwatch.current?.(); selectionPane.current?.destroy(); selectionPane.current = null; view.current?.destroy(); view.current = null
    session.current?.dispose(); session.current = null
    propertyProjection.current = null
    setReady(0); setOpenError(null); setError(null); setPropertyTarget(null); setContextMenu(null)
    void (async () => {
      try {
        const { openEditor } = await import('@web-ppt/editor')
        const opened = await openEditor(Uint8Array.from(props.snapshot.bytes), { historyLimit: 0 })
        if (cancelled) { opened.dispose(); return }
        if (!opened.editor.doc.package || opened.editor.doc.meta.readonly) { opened.dispose(); throw new Error('此文稿暂不能保全原件编辑，可继续查看原件。') }
        // Initial and incremental canvas rendering both receive local-only copies.
        const toSlide = opened.editor.toSlide.bind(opened.editor), renderedElement = opened.editor.renderedElement.bind(opened.editor)
        opened.editor.toSlide = (...args) => localOfficeProjection(toSlide(...args))
        opened.editor.renderedElement = (...args) => localOfficeProjection(renderedElement(...args))
        session.current = opened; source.current = props.snapshot
        submitted.current = null; sequence.current = 0
        const doc = opened.editor.doc
        const chosen = doc.slideOrder.find(id => doc.slides[id]?.origin?.part === rememberedPart.current)
          ?? doc.slideOrder[Math.min(rememberedIndex.current, doc.slideOrder.length - 1)] ?? null
        if (chosen) restorePptxSelection(opened.editor, chosen, rememberedShapes.current)
        setSlides([...doc.slideOrder]); setPage(chosen); setSelection(opened.editor.selection); reportDirty()
        unwatch.current = opened.editor.subscribe(change => {
          setSelection(change.selection)
          if (change.source !== 'selection') {
            sequence.current++; setSlides([...opened.editor.doc.slideOrder]); reportDirty()
          }
          publishFocus()
          // SDK listeners update their DOM/text selection after the model notification.
          queueMicrotask(() => { if (alive.current && session.current === opened) setSelection({ ...opened.editor.selection }) })
        })
        setReady(value => value + 1)
      } catch (reason) { if (!cancelled) setOpenError(message(reason)) }
    })()
    return () => { cancelled = true }
  }, [props.snapshot.bytes, reload])

  useEffect(() => {
    const current = session.current, container = surface.current, available = viewport.current
    if (!ready || !current || !container || !available || props.active === false || playing) return
    const initial = current.editor.doc.slideOrder.find(id => current.editor.doc.slides[id]?.origin?.part === rememberedPart.current)
      ?? current.editor.doc.slideOrder[Math.min(rememberedIndex.current, current.editor.doc.slideOrder.length - 1)]
    const mounted = current.mount(container, {
      mode: 'edit', slideId: initial, textMode: 'auto',
      onSlideChange: id => {
        setPage(id); rememberedIndex.current = current.editor.doc.slideOrder.indexOf(id)
        rememberedPart.current = current.editor.doc.slides[id]?.origin?.part; publishFocus()
      },
      onLinkFollow: () => { setError('链接已保留。可在播放或外部应用中访问。'); return true },
      onContextRequest: request => showContextMenu(request.screen.x, request.screen.y, request.targetId),
      onError: reason => setError(message(reason)),
    })
    view.current = mounted
    const unregister = toolbar.current ? mounted.registerTextUi(toolbar.current) : () => {}
    const fit = () => {
      const { width, height } = current.editor.doc.meta
      const scale = Math.min(Math.max(1, available.clientWidth - 48) / width, Math.max(1, available.clientHeight - 48) / height)
      container.style.width = width * scale + 'px'; container.style.height = height * scale + 'px'
      mounted.setZoom(scale)
    }
    const observer = new ResizeObserver(fit); observer.observe(available); fit(); publishFocus()
    return () => { unregister(); observer.disconnect(); mounted.destroy(); if (view.current === mounted) view.current = null }
  }, [ready, props.active, playing])

  useEffect(() => {
    const current = session.current, container = objectPane.current, slideId = view.current?.slideId
    if (!showObjects || !ready || !current || !container || !slideId || playing || props.active === false) return
    const pane = current.mountSelectionPane(container, { slideId, ariaLabel: '幻灯片对象', onError: reason => setError(message(reason)) })
    selectionPane.current = pane
    return () => { pane.destroy(); if (selectionPane.current === pane) selectionPane.current = null }
  }, [showObjects, ready, playing, props.active])
  useEffect(() => {
    if (page && selectionPane.current && !selectionPane.current.destroyed) selectionPane.current.setSlide(page)
  }, [page])
  useEffect(() => { selectionPane.current?.setMode(propertyDirty ? 'view' : 'edit') }, [propertyDirty, showObjects, ready])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('.pptx-editor__context-menu')) setContextMenu(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [contextMenu])

  useEffect(() => {
    const element = root.current
    if (!element) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
      if (event.isComposing || !(event.ctrlKey || event.metaKey) || props.active === false) return
      const key = event.key.toLowerCase()
      if (key === 's' || key === 'z' || key === 'y') {
        event.preventDefault(); event.stopImmediatePropagation()
        if (key === 's') void (latest.current.onSave?.() ?? flushRef.current())
        else void historyRef.current(key === 'y' || event.shiftKey ? 'redo' : 'undo')
      } else if (!event.altKey && !event.shiftKey && ['c', 'x', 'd'].includes(key)
        && session.current && view.current?.element.contains(event.target as Node)
        && !(event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')
        && pptxClipboardNeedsTableProjection(session.current.editor, view.current.slideId)) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (key === 'd') objectClipboardRef.current.duplicateObjects()
        else void objectClipboardRef.current.clipboard(key === 'x' ? 'cut' : 'copy')
      } else if (!event.altKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')
        && session.current?.editor.selection.kind === 'elements' && view.current?.element.contains(event.target as Node)
        && !(event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')) {
        // 0.5's native layer shortcut splits a consecutive multiselection. Route
        // only this object shortcut through the same public SetZ commands as UI.
        event.preventDefault(); event.stopImmediatePropagation()
        const forward = event.code === 'BracketRight'
        canvas((editor, slideId) => arrangePptxObjects(editor, slideId, forward ? event.shiftKey ? 'front' : 'forward' : event.shiftKey ? 'back' : 'backward'))
      }
    }
    const beforeinput = (event: Event) => {
      const input = event as InputEvent
      if (input.inputType === 'historyUndo' || input.inputType === 'historyRedo') {
        event.preventDefault(); event.stopImmediatePropagation()
        void historyRef.current(input.inputType === 'historyUndo' ? 'undo' : 'redo')
      }
    }
    const endPointer = () => { if (pointerDown.current) { pointerDown.current = false; reportDirty() } }
    element.addEventListener('keydown', keydown, true); element.addEventListener('beforeinput', beforeinput, true)
    window.addEventListener('pointerup', endPointer); window.addEventListener('pointercancel', endPointer)
    return () => {
      element.removeEventListener('keydown', keydown, true); element.removeEventListener('beforeinput', beforeinput, true)
      window.removeEventListener('pointerup', endPointer); window.removeEventListener('pointercancel', endPointer)
    }
  }, [props.active])

  function canvas(action: (editor: EditorSession['editor'], slideId: SlideId) => unknown) {
    const current = session.current, slideId = view.current?.slideId
    if (!current || !slideId || playing || propertyDraft.current) return
    if (composing.current || pointerDown.current) { setError('请先完成当前输入或拖动。'); return }
    try { action(current.editor, slideId); setError(null); publishFocus() } catch (reason) { setError(message(reason)) }
  }
  function duplicateObjects() {
    canvas((editor, slideId) => {
      const payload = copyPptxObjects(editor, slideId), selection = editor.selection
      if (payload) pastePptxObjects(editor, slideId, payload, selection.kind === 'elements' ? selection.enteredGroup : null)
    })
  }
  function formatText(format: PptxTextFormat) {
    canvas((editor, slideId) => {
      if (editor.selection.kind === 'elements') return formatPptxObjectText(editor, slideId, format)
      if (format.kind === 'clear') return view.current?.clearFormat()
      return format.kind === 'run' ? view.current?.setRunProps(format.props) : view.current?.setParaProps(format.props)
    })
  }
  async function clipboard(action: 'copy' | 'cut' | 'paste') {
    const current = session.current, mounted = view.current, slideId = mounted?.slideId
    if (!current || !mounted || !slideId || propertyDraft.current || composing.current || pointerDown.current || playing || clipboardBusy) return
    const version = sequence.current, ids = pptxObjectSelection(current.editor, slideId)
    const chosen = current.editor.selection, enteredGroup = chosen.kind === 'elements' ? chosen.enteredGroup : null
    setClipboardBusy(true)
    try {
      if (action === 'paste') {
        if (!navigator.clipboard?.readText) throw new Error('请聚焦画布后按 Ctrl+V 粘贴。')
        const text = await navigator.clipboard.readText()
        let payload: ReturnType<typeof copyPptxObjects>
        try { payload = JSON.parse(text) } catch { throw new Error('剪贴板中没有演示对象；文字或图片请在画布中按 Ctrl+V 粘贴。') }
        if (!payload || payload.format !== 'web-ppt-elements') throw new Error('剪贴板中没有演示对象；文字或图片请在画布中按 Ctrl+V 粘贴。')
        const currentSelection = current.editor.selection
        if (session.current !== current || view.current !== mounted || mounted.slideId !== slideId || sequence.current !== version
          || (currentSelection.kind === 'elements' ? currentSelection.enteredGroup : null) !== enteredGroup) {
          throw new Error('等待剪贴板期间编辑目标已改变，请重新粘贴。')
        }
        pastePptxObjects(current.editor, slideId, payload, enteredGroup)
      } else {
        const payload = copyPptxObjects(current.editor, slideId)
        if (!payload) return
        if (!navigator.clipboard?.writeText) throw new Error('请聚焦画布后按 Ctrl+C 复制或 Ctrl+X 剪切。')
        await navigator.clipboard.writeText(JSON.stringify(payload))
        if (action === 'cut') {
          if (session.current !== current || view.current !== mounted || mounted.slideId !== slideId || sequence.current !== version
            || JSON.stringify(pptxObjectSelection(current.editor, slideId)) !== JSON.stringify(ids)) {
            throw new Error('等待剪贴板期间选区或内容已改变；对象已复制，尚未剪切。')
          }
          deletePptxObjects(current.editor, slideId)
        }
      }
      if (alive.current) { setError(null); publishFocus(); mounted.element.focus({ preventScroll: true }) }
    } catch (reason) { if (alive.current) setError(message(reason)) }
    finally { if (alive.current) setClipboardBusy(false) }
  }
  function showContextMenu(x: number, y: number, targetId: string | null) {
    const editor = session.current?.editor, slideId = view.current?.slideId, box = root.current?.getBoundingClientRect()
    if (!editor || !slideId || !box || playing || propertyDraft.current || composing.current) return
    selectPptxContextTarget(editor, slideId, targetId)
    setContextMenu({ x: Math.max(0, Math.min(x - box.left, box.width - 190)), y: Math.max(0, Math.min(y - box.top, box.height - 360)) })
  }
  function navigate(id: SlideId) {
    if (composing.current || propertyDraft.current) { setError('请先完成当前输入。'); return }
    setPropertyTarget(null); setContextMenu(null)
    try { view.current?.setSlide(id); setPage(id); publishFocus() }
    catch (reason) { setError(message(reason)) }
  }
  function changeSlide(action: 'add' | 'duplicate' | 'delete' | 'up' | 'down') {
    const editor = session.current?.editor
    if (!editor || !page) return
    try {
      const index = editor.doc.slideOrder.indexOf(page)
      if (action === 'add') {
        const layoutId = editor.doc.slides[page]?.layoutId ?? editor.doc.layoutOrder[0]
        if (!layoutId) throw new Error('此文稿没有可用于新增页的版式；可以复制当前页。')
        const result = editor.exec({ type: 'AddSlide', layoutId, at: { after: page } })
        const created = [...result.createdSlides][0]; if (created) navigate(created)
      } else if (action === 'duplicate') {
        const result = editor.exec({ type: 'DuplicateSlide', id: page })
        const created = [...result.createdSlides][0]; if (created) navigate(created)
      } else if (action === 'delete') {
        if (editor.doc.slideOrder.length <= 1) throw new Error('请至少保留一张幻灯片。')
        editor.exec({ type: 'RemoveSlide', id: page })
        navigate(editor.doc.slideOrder[Math.min(index, editor.doc.slideOrder.length - 1)]!)
      } else {
        const order = editor.doc.slideOrder
        const after = action === 'up' ? (index > 1 ? order[index - 2]! : null) : order[index + 1]
        if (action === 'up' && index === 0 || action === 'down' && !after) return
        editor.exec({ type: 'MoveSlide', id: page, at: { after: after ?? null } })
      }
    } catch (reason) { setError(message(reason)) }
  }
  const selectedIds = session.current && page ? pptxSelectionIds(session.current.editor, page, selection) : []
  const objectIds = selection.kind === 'elements' ? selectedIds : []
  const single = selectedIds.length === 1 ? session.current?.editor.doc.elements[selectedIds[0]] : undefined
  const livePropertySlide = props.snapshot.inspection?.slides.find(slide => slide.part === propertyTarget?.part)
  const livePropertyObject = livePropertySlide?.shapes.find(shape => shape.shapeId === propertyTarget?.shapeId)
  if (propertyTarget && !propertyDraft.current && livePropertySlide && livePropertyObject) {
    propertyProjection.current = { ...propertyTarget, slide: livePropertySlide, object: livePropertyObject }
  }
  // A refreshed file may remove this object or page. Its dirty panel must stay
  // mounted until Apply/Cancel, otherwise its cleanup would silently drop input.
  const retainedProperty = propertyTarget && propertyProjection.current?.part === propertyTarget.part
    && propertyProjection.current.shapeId === propertyTarget.shapeId ? propertyProjection.current : null
  const propertySlide = propertyDraft.current ? retainedProperty?.slide : livePropertySlide ?? retainedProperty?.slide
  const propertyObject = propertyDraft.current ? retainedProperty?.object : livePropertyObject ?? retainedProperty?.object
  const canEdit = Boolean(ready && !playing && !propertyDirty)
  const runProps = canEdit ? view.current?.queryRunProps() ?? (session.current && page ? queryPptxObjectRunProps(session.current.editor, page) : null) : null
  const fontSize = runProps?.size.value ? Math.round(runProps.size.value * .75 * 10) / 10 : ''
  const fontSizes = [...new Set([10,12,14,16,18,20,24,28,32,40,48,60,72, ...(fontSize ? [fontSize] : [])])].sort((a,b) => a - b)
  const rgb = runProps?.color.value?.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)?.slice(1, 4)
  const textColor = runProps?.color.value?.match(/^#?([a-f\d]{6})$/i)?.[1]
    ?? rgb?.map(value => Number(value).toString(16).padStart(2, '0')).join('') ?? '000000'
  const tableHasCell = selection.kind === 'table' && selection.cells.length > 0 || selection.kind === 'text' && Boolean(selection.cell)
  const index = page ? slides.indexOf(page) : 0
  const button = (label: string, title: string, action: () => void, disabled = false) =>
    <button type="button" title={title} aria-label={title} disabled={!canEdit || disabled} onClick={action}>{label}</button>
  const arrangement = (value: string) => canvas((editor, slideId) => arrangePptxObjects(editor, slideId, value))
  const tableAction = (value: PptxTableAction) => canvas((editor, slideId) => editPptxTable(editor, slideId, value))
  function measureSelection() {
    const root = surface.current
    if (!root) return null
    const text = window.getSelection()
    if (selection.kind === 'text' && text?.rangeCount && !text.isCollapsed && root.contains(text.anchorNode)) {
      return text.getRangeAt(0).getBoundingClientRect()
    }
    if (!selectedIds.length) return null
    return unionBoxes(Array.from(root.querySelectorAll('[data-edit-id]'))
      .filter(node => selectedIds.includes(node.getAttribute('data-edit-id') ?? ''))
      .map(node => node.getBoundingClientRect())) ?? root.getBoundingClientRect()
  }
  const editor = session.current?.editor
  const focus = editor && page ? pptxFocus(editor, page) : null
  const objectName = focus?.shapeIds.length === 1 ? props.snapshot.inspection?.slides.find(slide => slide.part === focus.part)
    ?.shapes.find(shape => shape.shapeId === focus.shapeIds[0])?.name : undefined
  const textSelection = selection.kind === 'text' && (selection.anchor.p !== selection.focus.p
    || selection.anchor.r !== selection.focus.r || selection.anchor.off !== selection.focus.off) ? selection : null
  const textObject = textSelection && editor?.effectiveElement(textSelection.id)
  const editableText = textSelection && !textSelection.cell && textObject?.kind === 'shape' && textObject.text
    ? capturePptxText(textSelection, textObject.text.paragraphs) : undefined
  const tableSelection = selection.kind === 'table' || selection.kind === 'text' && Boolean(selection.cell)
  const hasObjectReference = Boolean(focus?.shapeIds.length && focus.shapeIds.length === selectedIds.length)
  const officeSelection: OfficeSelection | null = focus && focus.page >= 0 && selectedIds.length > 0 ? {
      scope: hasObjectReference ? 'object' : 'page', focus: hasObjectReference ? focus : { page: focus.page, part: focus.part },
      label: `第 ${focus.page + 1} 页 · ${textSelection ? '所选文字' : tableSelection ? '表格选区' : selectedIds.length === 1 ? objectName || '所选对象' : `${selectedIds.length} 个对象`}`,
      text: editableText?.selected,
      readText: textSelection ? () => {
        const native = window.getSelection()
        return native?.anchorNode && surface.current?.contains(native.anchorNode) ? native.toString() : undefined
      } : undefined,
      editScope: focus.part && hasObjectReference && !tableSelection && (!textSelection || editableText)
        ? { format: 'pptx', page: focus.page, part: focus.part, shapeIds: focus.shapeIds, ...(editableText ? { text: editableText.spans } : {}) }
        : undefined,
      readEditVersion: () => sequence.current,
      validatePrepared: binding => {
        if (source.current.binding.fileVersion !== binding.fileVersion || source.current.binding.bindingVersion !== binding.bindingVersion)
          throw new Error('画布和草稿版本不一致，请重新选择。')
        const slide = source.current.inspection?.slides.find(value => value.part === focus.part && value.index === focus.page)
        if (!slide || !focus.shapeIds.every(id => slide.shapes.some(shape => shape.shapeId === id))) {
          throw new Error('所选对象在草稿中找不到，请重新选择。')
        }
        if (editableText) {
          const object = slide.shapes.find(shape => shape.shapeId === focus.shapeIds[0])
          const matches = editableText.rendered.every((renderedRuns, paragraph) => {
            const runs = object?.runs[editableText.firstParagraph + paragraph]
            return runs?.length === renderedRuns.length && runs.every((item, index) => item.text === renderedRuns[index])
          })
          if (!object?.editable.includes('runText') || !matches) {
            throw new Error('所选文字无法对应到原件中的文字片段，请重新选择。')
          }
        }
      } } : null
  const hasUnsavedChanges = dirty || props.snapshot.draftDirty
  return <div className="pptx-editor" ref={root} aria-label="PPT 原件编辑器"
    onCompositionStartCapture={event => { if (surface.current?.contains(event.target as Node)) { composing.current = true; reportDirty() } }}
    onCompositionEndCapture={event => { if (surface.current?.contains(event.target as Node)) { composing.current = false; reportDirty() } }}
    onPointerDownCapture={event => { if (surface.current?.contains(event.target as Node)) pointerDown.current = true }}>
    <div className="pptx-editor__toolbar" ref={toolbar} role="toolbar" aria-label="演示文稿编辑工具">
      <strong title={props.name}>{props.name}</strong>
      <span className="file-save-pair">
        <button type="button" onClick={() => { void (props.onSave?.() ?? flushRef.current()) }} disabled={!ready || propertyDirty || saving}>保存</button>
        {props.onSaveAs && <button type="button" disabled={!ready || propertyDirty || saving} onClick={() => void props.onSaveAs?.()}>另存为</button>}
      </span>
      {props.onAutoSaveChange && <label className="office-autosave-toggle"><input type="checkbox" role="switch" checked={props.autoSave ?? false}
        onChange={event => props.onAutoSaveChange?.(event.target.checked)} />自动保存</label>}
      <button type="button" title="撤销（Ctrl+Z）" disabled={!canEdit || saving || !dirty && !props.snapshot.history?.undoDepth}
        onClick={() => { void history('undo') }}>撤销</button>
      <button type="button" title="重做（Ctrl+Y）" disabled={!canEdit || saving || !props.snapshot.history?.redoDepth}
        onClick={() => { void history('redo') }}>重做</button>
      <span className="pptx-editor__divider" />
      {button('文本框', '插入文本框', () => canvas((editor, slideId) => insertPptxShape(editor, slideId, 'rect', true)))}
      <QuickBarPopoverButton label="插入对象" text="插入" disabled={!canEdit}>{close => <div className="office-selection-options" onClick={event => {
        if ((event.target as HTMLElement).closest('button')) close()
      }} onChange={() => close()}>
      <select aria-label="插入形状" value="" disabled={!canEdit} onChange={event => {
        const preset = event.target.value; if (preset) canvas((editor, slideId) => insertPptxShape(editor, slideId, preset))
      }}><option value="">形状</option><option value="rect">矩形</option><option value="roundRect">圆角矩形</option>
        <option value="ellipse">椭圆</option><option value="triangle">三角形</option><option value="rightArrow">箭头</option><option value="line">直线</option></select>
      {button('图片', '插入图片', () => { void view.current?.chooseImage().catch(reason => setError(message(reason))) })}
      {button('表格', '插入表格', () => { try { view.current?.insertTable(3,3) } catch (reason) { setError(message(reason)) } })}
      </div>}</QuickBarPopoverButton>
      <QuickBarPopoverButton label="页面操作" text="页面" disabled={!canEdit}>{close => <div className="office-selection-options" onClick={() => close()}>
        {button('粘贴', '粘贴对象（Ctrl+V）', () => { void clipboard('paste') }, clipboardBusy)}
        {button('全选', '全选本页对象（Ctrl+A）', () => canvas(selectAllPptxObjects))}
      </div>}</QuickBarPopoverButton>
      <button type="button" aria-label="对象选择窗格" aria-pressed={showObjects} disabled={!canEdit}
        onClick={() => setShowObjects(value => !value)}>对象</button>
      {button('查找', '查找或替换文字', () => view.current?.openTextSearch())}
      {props.onEdit && <button type="button" disabled={!ready || playing || propertyDirty || !propertyTarget && selectedIds.length !== 1} onClick={() => { void (async () => {
        if (propertyTarget) { setPropertyTarget(null); return }
        const current = session.current, slideId = view.current?.slideId
        if (!current || !slideId) return
        const ids = pptxSelectionIds(current.editor, slideId)
        if (!await flushRef.current()) return
        if (session.current !== current || view.current?.slideId !== slideId || JSON.stringify(pptxSelectionIds(current.editor, slideId)) !== JSON.stringify(ids)) {
          setError('保存期间选区已改变，请重新打开精细属性。'); return
        }
        const slide = current.editor.doc.slides[slideId]
        const origin = ids.length === 1 ? current.editor.doc.elements[ids[0]]?.meta.origin : undefined
        if (!slide?.origin?.part || !origin || origin.part !== slide.origin.part) { setError('请选择当前页中可编辑的对象。'); return }
        setPropertyTarget({ part: slide.origin.part, shapeId: String(origin.spid) })
      })() }}>{propertyTarget ? '收起属性' : '精细属性'}</button>}
      <span className="pptx-editor__status" role="status">{saving ? '正在处理…' : hasUnsavedChanges ? '未保存' : '已保存'}</span>
      <button type="button" disabled={saving || !ready} onClick={() => { void (async () => {
        if (playing) setPlaying(false)
        else if (await flushRef.current()) setPlaying(true)
      })() }}>{playing ? '返回编辑' : '播放'}</button>
    </div>
    {error && <div className="pptx-editor__notice" role="alert">{error}</div>}
    {openError ? <><div className="pptx-editor__notice" role="alert">{openError}</div>
      <PptxFilePreview bytes={props.snapshot.bytes} name={props.name} active={props.active}
        onOpenExternal={props.onOpenExternal} onImportToCourse={props.onImportToCourse}
        onReload={async () => { await props.onReload(); setReload(n => n + 1) }} /></>
      : playing ? <PptxFilePreview bytes={props.snapshot.bytes} name={props.name} active={props.active}
        onOpenExternal={props.onOpenExternal} onImportToCourse={props.onImportToCourse} />
      : <div className="pptx-editor__body">
        <aside className="pptx-editor__pages" aria-label="幻灯片页面栏">
          <div className="pptx-editor__page-actions">
            {button('+', '新增幻灯片', () => changeSlide('add'))}
            {button('复制', '复制幻灯片', () => changeSlide('duplicate'))}
            {button('删除', '删除幻灯片', () => changeSlide('delete'), slides.length < 2)}
          </div>
          <ol>{slides.map((id, at) => <li key={id}>
            <button type="button" className={page === id ? 'is-active' : ''} aria-current={page === id ? 'page' : undefined}
              aria-label={'幻灯片 ' + (at + 1)} onClick={() => navigate(id)}>
              <span className="pptx-editor__page-number">{at + 1}</span>
              <span>{session.current?.editor.doc.slides[id]?.children.map(child => {
                const el = session.current?.editor.effectiveElement(child) as unknown as { text?: { paragraphs?: Array<{ runs?: Array<{ text?: string }> }> } }
                return el?.text?.paragraphs?.map(p => p.runs?.map(r => r.text ?? '').join('')).join(' ')
              }).filter(Boolean).join(' ').slice(0,60) || '幻灯片 ' + (at + 1)}</span>
            </button>
          </li>)}</ol>
          <div className="pptx-editor__page-actions">
            {button('上移', '上移幻灯片', () => changeSlide('up'), index <= 0)}
            {button('下移', '下移幻灯片', () => changeSlide('down'), index >= slides.length - 1)}
          </div>
        </aside>
        <div className="pptx-editor__viewport" ref={viewport}>
          {!ready && <p role="status">正在打开可编辑文稿…</p>}
          <div ref={surface} className="pptx-editor__surface" data-testid="pptx-edit-surface" inert={propertyDirty || undefined}
            onContextMenu={event => {
              const target = event.target as Element
              if (target.closest('[contenteditable="true"]')) return
              event.preventDefault()
              showContextMenu(event.clientX, event.clientY, target.closest<HTMLElement>('[data-edit-id]')?.dataset.editId ?? null)
            }} />
        </div>
        {showObjects && <aside className="pptx-editor__objects" aria-label="对象选择窗格" inert={propertyDirty || undefined}>
          <div className="pptx-editor__objects-heading"><strong>本页对象</strong><button type="button" aria-label="关闭对象选择窗格" onClick={() => setShowObjects(false)}>×</button></div>
          <div ref={objectPane} className="pptx-editor__object-list" />
        </aside>}
        {propertyTarget && propertySlide && propertyObject && props.onEdit && <PptxObjectPanel
          key={propertyTarget.part + ':' + propertyTarget.shapeId} object={propertyObject} slide={propertySlide}
          disabled={saving || !ready} onDirtyChange={propertyDirtyChanged}
          onApply={async edits => {
            if (session.current?.editor.isDirty()) throw new Error('画布中有尚未保存的修改，请先保存再应用精细属性。')
            if (!sameBinding(source.current.binding, latest.current.snapshot.binding)) throw new Error('属性输入基于旧版本，未覆盖新内容。请取消输入并重新选择对象。')
            await latest.current.onEdit!(edits)
          }} />}
      </div>}
    <OfficeSelectionTools active={props.active !== false && !playing}
      viewport={() => viewport.current} measure={measureSelection} aboveOffset={32} selectionKey={JSON.stringify([page, selection, sequence.current])}
      suspended={!canEdit || Boolean(contextMenu) || composing.current}
      selection={officeSelection}>
      {runProps && (['b','i','u'] as const).map((flag, at) => <QuickBarButton key={flag} label={['加粗','斜体','下划线'][at]}
        icon={<span className={'pptx-editor__format-' + flag}>{['B','I','U'][at]}</span>}
        pressed={runProps[flag].mixed ? 'mixed' : Boolean(runProps[flag].value)}
        onClick={() => formatText({ kind: 'run', props: { [flag]: !runProps[flag].value } })} />)}
      {objectIds.length > 0 && <>
        <QuickBarButton label="创建对象副本（Ctrl+D）" icon={<CopyPlus size={14} />} onClick={duplicateObjects} />
        <QuickBarButton label="删除选中对象" icon={<Trash2 size={14} />} danger onClick={() => canvas(deletePptxObjects)} />
      </>}
      <QuickBarPopoverButton label="更多对象与文字操作" text="更多">{() => <div className="pptx-selection-more">
      <div className="pptx-editor__tools" role="group" aria-label="对象与文字工具">
        {button('复制', '复制对象（Ctrl+C）', () => { void clipboard('copy') }, !objectIds.length || clipboardBusy)}
        {button('剪切', '剪切对象（Ctrl+X）', () => { void clipboard('cut') }, !objectIds.length || clipboardBusy)}
        <span className="pptx-editor__divider" />
        {button('组合', '组合选中对象', () => canvas((editor, slideId) => {
          editor.exec({ type: 'Group', ids: pptxObjectSelection(editor, slideId) })
        }), objectIds.length < 2)}
        {button('解组', '解组', () => canvas((editor, slideId) => {
          const [id] = pptxObjectSelection(editor, slideId); if (id) editor.exec({ type: 'Ungroup', id })
        }), objectIds.length !== 1 || single?.src.kind !== 'group')}
        <select aria-label="排列对象" value="" disabled={!canEdit || !objectIds.length} onChange={event => arrangement(event.target.value)}>
          <option value="">排列</option>
          <optgroup label="层级"><option value="front">置于顶层</option><option value="forward">上移一层</option><option value="backward">下移一层</option><option value="back">置于底层</option></optgroup>
          <optgroup label="对齐" disabled={objectIds.length < 2}><option value="left">左对齐</option><option value="center">水平居中</option><option value="right">右对齐</option><option value="top">顶部对齐</option><option value="middle">垂直居中</option><option value="bottom">底部对齐</option></optgroup>
          <optgroup label="分布" disabled={objectIds.length < 3}><option value="horizontal">水平分布</option><option value="vertical">垂直分布</option></optgroup>
          <optgroup label="旋转"><option value="rotate">旋转 15 度</option><option value="flipH">水平翻转</option><option value="flipV">垂直翻转</option></optgroup>
        </select>
        <span className="pptx-editor__divider" />
        <select aria-label="字体" value={runProps?.font.value ?? ''} disabled={!canEdit || !runProps} onChange={event => formatText({ kind: 'run', props: { font: event.target.value } })}>
          <option value="">{runProps?.font.mixed ? '混合字体' : '字体'}</option>
          {[...new Set(['Microsoft YaHei','SimSun','Arial','Calibri','Times New Roman', ...(runProps?.font.value ? [runProps.font.value] : [])])].map(font => <option key={font} value={font}>{font === 'Microsoft YaHei' ? '微软雅黑' : font === 'SimSun' ? '宋体' : font}</option>)}
        </select>
        <select aria-label="字号" title="字号（磅）" value={fontSize} disabled={!canEdit || !runProps} onChange={event => {
          const size = Number(event.target.value) / .75; if (size) formatText({ kind: 'run', props: { size } })
        }}><option value="">{runProps?.size.mixed ? '混合字号' : '字号'}</option>{fontSizes.map(n => <option key={n} value={n}>{n}</option>)}</select>
        <label className="pptx-editor__color">字色<input type="color" aria-label="文字颜色" value={'#' + textColor} disabled={!canEdit || !runProps}
          onChange={event => formatText({ kind: 'run', props: { color: event.target.value } })} /></label>
        <select aria-label="段落格式" value="" disabled={!canEdit || !runProps} onChange={event => {
          const value = event.target.value
          formatText(value === 'clear' ? { kind: 'clear' } : { kind: 'paragraph', props: value === 'bullet'
            ? { bullet: { kind: 'char', char: '•' } } : value === 'number'
              ? { bullet: { kind: 'autoNum', type: 'arabicPeriod' } } : value === 'noBullet'
                ? { bullet: { kind: 'none' } } : { align: value as 'left' | 'center' | 'right' | 'justify' } })
        }}><option value="">段落</option><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option><option value="bullet">项目符号</option><option value="number">编号</option><option value="noBullet">取消列表</option><option value="clear">清除字符格式</option></select>
        {button('格式刷', '复制文字与对象格式', () => canvas(() => view.current?.startFormatPainter()), selectedIds.length !== 1)}
      </div>
      {canEdit && single?.src.kind === 'image' && <div className="pptx-editor__tools" role="group" aria-label="图片工具">
        <span>图片</span>{button('裁剪', '裁剪选中图片', () => canvas(() => view.current?.startImageCrop()))}
        {button('完成裁剪', '完成图片裁剪', () => view.current?.endImageCrop())}
        {button('替换图片', '替换选中图片', () => { void view.current?.chooseReplacementImage().catch(reason => setError(message(reason))) })}
      </div>}
      {canEdit && objectIds.length > 0 && objectIds.every(id => session.current?.editor.doc.elements[id]?.src.kind === 'shape') && <div className="pptx-editor__tools" role="group" aria-label="形状工具">
        <span>形状</span><label className="pptx-editor__color">填充<input type="color" aria-label="形状填充颜色" defaultValue="#719ed8"
          onChange={event => { const color = event.target.value; canvas((editor, slideId) => editor.exec(...pptxObjectSelection(editor, slideId).map(id => ({ type: 'SetFill' as const, id, fill: { type: 'solid' as const, color } })))) }} /></label>
        {button('无填充', '清除形状填充', () => canvas((editor, slideId) => editor.exec(...pptxObjectSelection(editor, slideId).map(id => ({ type: 'SetFill' as const, id, fill: { type: 'none' as const } })))))}
      </div>}
      {canEdit && single?.src.kind === 'table' && <div className="pptx-editor__tools" role="group" aria-label="表格工具">
        <span>表格</span>{button('添加行', '表格添加行', () => tableAction('addRow'))}{button('添加列', '表格添加列', () => tableAction('addColumn'))}
        {button('删除行', '删除所选单元格所在行', () => tableAction('removeRow'), !tableHasCell)}
        {button('删除列', '删除所选单元格所在列', () => tableAction('removeColumn'), !tableHasCell)}
        {button('合并', '合并所选单元格', () => tableAction('merge'), selection.kind !== 'table' || selection.cells.length < 2)}
        {button('拆分', '拆分所选单元格', () => tableAction('split'), !tableHasCell)}
      </div>}
      </div>}</QuickBarPopoverButton>
      <span ref={registerSelectionUi} />
    </OfficeSelectionTools>
    <footer className="pptx-editor__footer">
      <span>{slides.length ? '第 ' + (index + 1) + ' / ' + slides.length + ' 页' : ''}</span>
      <span>{selectedIds.length ? '已选 ' + selectedIds.length + ' 个对象 · ' : ''}双击文字编辑 · Shift 多选 / 空白处框选 · Ctrl+D 创建副本</span>
      {props.snapshot.history?.notice && <span>{props.snapshot.history.notice}</span>}
      {props.onOpenExternal && <button type="button" onClick={() => { void props.onOpenExternal?.() }}>外部打开</button>}
    </footer>
    {contextMenu && <div className="pptx-editor__context-menu" role="menu" aria-label="对象快捷操作" style={{ left: contextMenu.x, top: contextMenu.y }}>
      {[
        ['复制', () => { void clipboard('copy') }, !objectIds.length || clipboardBusy],
        ['剪切', () => { void clipboard('cut') }, !objectIds.length || clipboardBusy],
        ['粘贴', () => { void clipboard('paste') }, clipboardBusy],
        ['创建副本', duplicateObjects, !objectIds.length],
        ['删除', () => canvas(deletePptxObjects), !objectIds.length],
        ['置于顶层', () => arrangement('front'), !objectIds.length],
        ['置于底层', () => arrangement('back'), !objectIds.length],
        ['全选本页对象', () => canvas(selectAllPptxObjects), false],
      ].map(([label, action, disabled]) => <button key={String(label)} type="button" role="menuitem" disabled={!canEdit || Boolean(disabled)}
        onClick={() => { setContextMenu(null); (action as () => void)() }}>{String(label)}</button>)}
    </div>}
  </div>
})
