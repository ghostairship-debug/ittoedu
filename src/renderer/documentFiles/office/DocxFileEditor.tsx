import { forwardRef, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { EditorState } from 'prosemirror-state'
import { toggleMark } from 'prosemirror-commands'
import type { DocxParagraphStyle, DocxTextStyle } from '../../../shared/workbench/officeFiles'
import type { OfficeDocumentSnapshot } from '../../../shared/workbench/officeDocument'
import type { OfficeEditorHandle } from './officeEditorHandle'
import type { OfficeLeafEditorProps } from './officeLeafEditorProps'
import { createWordEditor } from './wordEditorKernel'
import { captureWordSaveFocus } from './wordSaveFocus'
import { wordEditorSchema, wordFormatting, wordParagraphs, wordSelectedParagraphs, type WordEdit } from './wordEditorModel'
import { QuickBarButton, QuickBarPopoverButton } from '../../editing/quickbar/SelectionQuickBar'
import { OfficeSelectionHost, OfficeSelectionTools } from './OfficeSelectionTools'
import './officeLeafEditor.css'
import './wordEditorKernel.css'

type WordPoint = { paragraph: number; offset: number }
type SelectionSummary = { index: number; from: number; to: number; text: string; style: DocxParagraphStyle; flags: DocxTextStyle;
  editScope: { format: 'docx'; start: WordPoint; end: WordPoint; wholeParagraphs?: number[] } | null }

const wordInlineFormats = [
  { flag: 'bold', label: '加粗', icon: <b>B</b> },
  { flag: 'italic', label: '斜体', icon: <i>I</i> },
  { flag: 'underline', label: '下划线', icon: <u>U</u> },
] as const

/** ProseMirror supplies input and selection; the existing Office file service owns every write/history entry. */
export const DocxFileEditor = forwardRef<OfficeEditorHandle, OfficeLeafEditorProps>(function DocxFileEditor({
  snapshot, name, active = true, onEdit, onUndo, onRedo, onDirtyChange, onFocusChange, autoSave, onAutoSaveChange, onSave, onSaveAs,
}, ref) {
  const host = useRef<HTMLDivElement>(null), kernel = useRef<ReturnType<typeof createWordEditor> | null>(null)
  const officeHost = useContext(OfficeSelectionHost)
  const viewport = useRef<HTMLDivElement>(null), editVersion = useRef(0)
  const pending = useRef<WordEdit[]>([]), baseline = useRef<OfficeDocumentSnapshot | null>(null)
  const source = useRef(snapshot)
  const displayedBinding = useRef(JSON.stringify(snapshot.binding))
  const composing = useRef(false), inFlight = useRef<Promise<boolean> | null>(null), domInputPending = useRef(false)
  const commandLock = useRef(false)
  const saveFocus = useRef<ReturnType<typeof captureWordSaveFocus> | null>(null)
  const [, update] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<SelectionSummary | null>(null)
  const [engaged, setEngaged] = useState(false)
  const dirty = pending.current.length > 0 || domInputPending.current || composing.current
  const changedOutside = dirty && JSON.stringify(snapshot.binding) !== JSON.stringify((baseline.current ?? source.current).binding)
  const callbacks = useRef({ active, onDirtyChange, onFocusChange, stage: commit, save: onSave ?? commit, history })
  callbacks.current = { active, onDirtyChange, onFocusChange, stage: commit, save: onSave ?? commit, history }

  function selectionChanged(state: EditorState) {
    const paragraphs = wordSelectedParagraphs(state)
    const paragraph = paragraphs[0] ?? wordParagraphs(state.doc)[0], last = paragraphs.at(-1) ?? paragraph
    const { from, to } = state.selection
    const editScope = paragraph && last && state.selection.ranges.length === 1 && paragraphs.every(value => value.node.attrs.editable !== false)
      ? { format: 'docx' as const, start: { paragraph: paragraph.index, offset: from === to ? 0 : Math.max(0, from - paragraph.from) },
        end: { paragraph: last.index, offset: from === to ? paragraph.to - paragraph.from : Math.min(last.to, to) - last.from },
        wholeParagraphs: from === to ? [paragraph.index] : paragraphs.filter(value => from <= value.from && to >= value.to).map(value => value.index) }
      : null
    setSelection(paragraph ? { index: paragraph.index, from, to, text: state.doc.textBetween(from, to, '\n'),
      style: paragraph.node.attrs.style, flags: wordFormatting(state), editScope } : null)
    if (paragraph && callbacks.current.active) callbacks.current.onFocusChange?.({ paragraph: paragraph.index })
  }
  useLayoutEffect(() => {
    if (!host.current || source.current.inspection.format !== 'docx') return
    kernel.current = createWordEditor(host.current, source.current.inspection, {
      changed(edits) {
        editVersion.current++
        baseline.current ??= source.current
        domInputPending.current = false; pending.current.push(...edits); callbacks.current.onDirtyChange?.(true); setError(null); update(value => value + 1)
      },
      selection: selectionChanged,
      composition(value) {
        composing.current = value
        if (value) baseline.current ??= source.current
        callbacks.current.onDirtyChange?.(value || domInputPending.current || pending.current.length > 0); update(revision => revision + 1)
      },
      input(value) {
        domInputPending.current = value
        if (value) baseline.current ??= source.current
        else if (!pending.current.length && !composing.current && !inFlight.current) baseline.current = null
        callbacks.current.onDirtyChange?.(value || composing.current || pending.current.length > 0); update(revision => revision + 1)
      },
      error: setError,
      stage() { void callbacks.current.stage() },
      save() { void callbacks.current.save() },
      history(redo) { void callbacks.current.history(redo) },
    })
    selectionChanged(kernel.current.view.state)
    return () => { saveFocus.current?.(false); saveFocus.current = null; kernel.current?.destroy(); kernel.current = null }
  }, [])
  useEffect(() => {
    if (pending.current.length || domInputPending.current || composing.current || kernel.current?.view.composing || inFlight.current || commandLock.current || snapshot.inspection.format !== 'docx') return
    if (snapshot.binding.path === source.current.binding.path && snapshot.binding.bindingVersion < source.current.binding.bindingVersion) return
    baseline.current = null; source.current = snapshot
    const binding = JSON.stringify(snapshot.binding)
    if (binding !== displayedBinding.current) { kernel.current?.reset(snapshot.inspection); displayedBinding.current = binding }
  }, [snapshot, busy, dirty])
  useEffect(() => { if (active && selection) onFocusChange?.({ paragraph: selection.index }) }, [active, selection?.index])

  function setSaving(value: boolean, lockInput = false) {
    // Body transactions are already projected in PM and can accept a suffix
    // while their prefix is written. History and OOXML-only toolbar commands
    // have no such projection, so keep their bounded input/focus lease.
    const wasLocked = commandLock.current
    commandLock.current = value && lockInput
    if (commandLock.current) {
      saveFocus.current?.(false); saveFocus.current = captureWordSaveFocus(kernel.current?.view, () => callbacks.current.active)
      kernel.current?.setEditable(false)
    }
    setBusy(value)
    if (!value) {
      if (wasLocked) kernel.current?.setEditable(true)
      const release = saveFocus.current; saveFocus.current = null; release?.(true)
    }
  }
  function hasDraft() {
    return pending.current.length > 0 || domInputPending.current || composing.current || !!kernel.current?.view.composing
  }
  async function commit(extra: WordEdit[] = []): Promise<boolean> {
    // Native DOM input is observed by PM in a microtask. Capture its original
    // binding synchronously above, then drain that observation before saving.
    await Promise.resolve()
    const previous = inFlight.current
    if (previous && !await previous) return false
    // Another waiter may already have captured this suffix. Do not create a
    // second writer or an unbounded drain loop; a caller can retry stable flush.
    if (inFlight.current) return false
    if (composing.current || kernel.current?.view.composing) { setError('请先完成当前输入，再保存或切换。'); return false }
    const edits = [...pending.current, ...extra]
    if (!edits.length) return !domInputPending.current
    if (commandLock.current) return false
    const prefixLength = pending.current.length, binding = (baseline.current ?? source.current).binding
    setSaving(true, extra.length > 0); setError(null)
    const writing = Promise.resolve().then(async () => {
      try {
        const saved = await onEdit(binding, { format: 'docx', edits })
        // Let a native DOM mutation already queued in this turn reach PM before
        // deciding that the acknowledged projection can safely replace the view.
        await Promise.resolve()
        pending.current.splice(0, prefixLength); source.current = saved
        displayedBinding.current = JSON.stringify(saved.binding)
        const remaining = hasDraft()
        baseline.current = remaining ? saved : null
        if (!remaining && saved.inspection.format === 'docx') kernel.current?.reset(saved.inspection)
        onDirtyChange?.(remaining); update(value => value + 1)
        return true
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false }
      finally { inFlight.current = null; setSaving(false) }
    })
    inFlight.current = writing
    return await writing && !hasDraft()
  }
  useImperativeHandle(ref, () => ({ flush: () => commit() }))
  async function history(redo: boolean) {
    if (commandLock.current || !await commit() || commandLock.current) return
    setSaving(true, true); setError(null)
    try { await (redo ? onRedo : onUndo)() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  function format(style: DocxParagraphStyle) {
    const state = kernel.current?.view.state
    if (state) void commit(wordSelectedParagraphs(state).map(paragraph => ({ type: 'paragraphStyle', index: paragraph.index, style })))
  }
  function toggleFormat(flag: keyof DocxTextStyle) {
    const view = kernel.current?.view
    if (!view || !selection) return
    if (view.state.selection.empty) format({ [flag]: !selection.flags[flag] })
    else { toggleMark(wordEditorSchema.marks[flag])(view.state, view.dispatch, view); view.focus() }
  }
  async function insert() {
    const after = selection?.index ?? -1
    if (await commit([{ type: 'insertParagraph', after, text: '' }])) kernel.current?.focusParagraph(after + 1)
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || event.altKey || event.nativeEvent.isComposing) return
    const key = event.key.toLowerCase()
    if (key === 's') { event.preventDefault(); event.stopPropagation(); void (onSave ?? commit)() }
    if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); void history(key === 'y' || event.shiftKey) }
  }
  function measureSelection() {
    const view = kernel.current?.view
    if (!view || !selection) return null
    const { from, to } = view.state.selection
    const native = window.getSelection()
    if (from !== to && native?.rangeCount && !native.isCollapsed && host.current?.contains(native.anchorNode)) {
      return native.getRangeAt(0).getBoundingClientRect()
    }
    if (from === to) {
      const block = host.current?.querySelector(`[data-paragraph-index="${selection.index}"]`)
      if (block) return block.getBoundingClientRect()
    }
    const start = view.coordsAtPos(from), end = view.coordsAtPos(to)
    const left = Math.min(start.left, end.left), top = Math.min(start.top, end.top)
    return { left, top, width: Math.max(1, Math.max(start.right, end.right) - left),
      height: Math.max(start.bottom, end.bottom) - top }
  }
  const hasUnsavedChanges = dirty || snapshot.draftDirty

  return <section className="office-leaf-editor office-word-editor" aria-label={`${name} Word 编辑器`} aria-busy={busy} hidden={!active} onKeyDown={keydown}>
    <header className="office-leaf-toolbar">
      <strong title={name}>{name}</strong><span className="office-leaf-status" role="status">{busy ? '正在处理…' : hasUnsavedChanges ? '有未保存修改' : '已保存'}</span>
      <span className="file-save-pair">
        <button type="button" disabled={busy || !hasUnsavedChanges} onClick={() => void (onSave ?? commit)()}>保存</button>
        {onSaveAs && <button type="button" disabled={busy} onClick={() => void onSaveAs()}>另存为</button>}
      </span>
      {onAutoSaveChange && <label className="office-autosave-toggle"><input type="checkbox" role="switch" checked={autoSave ?? false} onChange={event => onAutoSaveChange(event.target.checked)} />自动保存</label>}
      <button type="button" disabled={busy || (!dirty && !snapshot.history.undoDepth)} onClick={() => void history(false)}>撤销</button>
      <button type="button" disabled={busy || dirty || !snapshot.history.redoDepth} onClick={() => void history(true)}>重做</button>
      {officeHost?.toolbarTrailing}
    </header>
    <div className="office-leaf-toolbar" role="toolbar" aria-label="Word 正文格式">
      {wordInlineFormats.map(({ flag, label, icon }) => <QuickBarButton key={flag} label={label} icon={icon}
        disabled={busy || !selection?.editScope} pressed={!!selection?.flags[flag]} onClick={() => toggleFormat(flag)} />)}
      <select aria-label="段落样式" disabled={busy || !selection?.editScope} value={selection?.style.heading ?? 'Normal'}
        onChange={event => format({ heading: event.target.value as DocxParagraphStyle['heading'] })}>
        <option value="Normal">正文</option><option value="Title">标题</option><option value="Heading1">标题 1</option><option value="Heading2">标题 2</option><option value="Heading3">标题 3</option>
      </select>
      <select aria-label="段落对齐" disabled={busy || !selection?.editScope} value={selection?.style.alignment ?? 'left'}
        onChange={event => format({ alignment: event.target.value as DocxParagraphStyle['alignment'] })}>
        <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="both">两端对齐</option>
      </select>
    </div>
    {changedOutside && <p className="office-leaf-message" role="alert">文件已被其他操作更新。当前输入已保留；保存时将检查原版本，避免覆盖新内容。</p>}
    {error && <p className="office-leaf-message" role="alert">{error}</p>}
    <div ref={viewport} className="office-leaf-scroll"><article className="office-word-paper" aria-label="Word 正文">
      <p className="office-leaf-hint">正文编辑 · 原件分页可在预览中查看</p>
      <div ref={host} onFocusCapture={() => setEngaged(true)} />
      {!selection && <button type="button" disabled={busy} onClick={() => void insert()}>添加第一段</button>}
    </article></div>
    <OfficeSelectionTools active={active && engaged} viewport={() => viewport.current} measure={measureSelection}
      suspended={busy || composing.current} selectionKey={selection ? `${selection.from}:${selection.to}` : ''}
      selection={selection ? { scope: 'paragraph', focus: { paragraph: selection.index }, text: selection.text, editScope: selection.editScope ?? undefined,
        label: `第 ${selection.index + 1}${selection.editScope && selection.editScope.end.paragraph !== selection.index ? `–${selection.editScope.end.paragraph + 1}` : ''} 段${selection.text ? ' · 所选文字' : ''}`,
        readEditVersion: () => editVersion.current } : null}>
      {wordInlineFormats.map(({ flag, label, icon }) => <QuickBarButton key={flag} label={label} icon={icon}
        pressed={!!selection?.flags[flag]} onClick={() => toggleFormat(flag)} />)}
      <QuickBarPopoverButton label="段落格式与操作" text="段落">{close => <div className="office-selection-options">
        <select aria-label="段落样式" disabled={busy || !selection} value={selection?.style.heading ?? 'Normal'} onChange={event => { format({ heading: event.target.value as DocxParagraphStyle['heading'] }); close() }}>
          <option value="Normal">正文</option><option value="Title">标题</option><option value="Heading1">标题 1</option><option value="Heading2">标题 2</option><option value="Heading3">标题 3</option>
        </select>
        <select aria-label="段落对齐" disabled={busy || !selection} value={selection?.style.alignment ?? 'left'} onChange={event => { format({ alignment: event.target.value as DocxParagraphStyle['alignment'] }); close() }}>
          <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="both">两端对齐</option>
        </select>
        <button type="button" disabled={busy} onClick={() => { void insert(); close() }}>新增段落</button>
        <button type="button" disabled={busy || !selection} onClick={() => { if (selection) void commit([{ type: 'deleteParagraph', index: selection.index }]); close() }}>删除段落</button>
      </div>}</QuickBarPopoverButton>
    </OfficeSelectionTools>
  </section>
})
