import { bindMarkdownIdentities, type MarkdownProjection } from '../../shared/document/markdownIdentity'
import { editMarkdownSource, sameMarkdownContent } from '../../shared/document/markdownSourceEdit'
import { editorPositionToPoint } from './documentAdapter'
import type { ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'
import { pinnedSelectionKey, pinnedSelectionPlugin, sourcePinnedSelectionEffect, sourcePinnedSelectionField } from './selectionDecorations'
import { FONT_FAMILY_OPTIONS } from '../../shared/fonts/fontFamilyCatalog'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useMemo, useId, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EditorState as SourceState } from '@codemirror/state'
import { EditorView as SourceView, keymap as sourceKeymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { foldGutter, foldEffect } from '@codemirror/language'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument, type MarkdownOptions } from '../../shared/document/markdown'
import type { DocumentDiagnostic, DocumentSelection, DocumentContextSelection } from '../../shared/document/ports'
import { mapDocumentSelectionToSource, type MarkdownSourceMap } from '../../shared/document/markdownSourceMap'
import type { TextRunStyle } from '../../shared/contracts/native-v1/types'
import { createLayoutEditor, type DocumentOperation } from './editorSession'
import { documentEditorSchema } from './editorSchema'
import { NodeSelection, Selection, TextSelection, type EditorState } from 'prosemirror-state'
import { toggleMark, setBlockType } from 'prosemirror-commands'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'
import { type DocumentBlock } from '../../shared/document/content'
import type { DocumentClipboardResourcePort } from './documentClipboard'
import './sharedDocumentEditor.css'
import 'katex/dist/katex.min.css'
import { layoutPreviewClipboard, layoutPreviewKey, layoutPreviewPlugin, layoutPreviewRange, sourcePreviewEffect, sourcePreviewExtensions, sourcePreviewRange, type DocumentEditPreview } from './editPreviewWidgets'

const FORMAT_FLAGS = ['bold', 'italic', 'underline', 'strike', 'emphasis'] as const

function visibleEditorBounds(editor: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const bounds = editor.getBoundingClientRect()
  let left = Math.max(8, bounds.left), right = Math.min(window.innerWidth - 8, bounds.right)
  let top = Math.max(8, bounds.top), bottom = Math.min(window.innerHeight - 8, bounds.bottom)
  for (let parent = editor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const rect = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
  }
  return { left, right, top, bottom }
}

export function readDocumentFormatting(state: EditorState) {
  const samples: TextRunStyle[] = []
  const sample = (marks: typeof state.selection.$from.parent.marks) => samples.push(marks.find(mark => mark.type === documentEditorSchema.marks.style)?.attrs.value ?? {})
  if (state.selection.empty) sample(state.storedMarks ?? state.selection.$from.marks())
  else state.doc.nodesBetween(state.selection.from, state.selection.to, node => { if (node.isInline && !node.isTextblock) sample(node.marks) })
  const values = <T,>(get: (style: TextRunStyle) => T): T | 'mixed' => {
    const first = get(samples[0] ?? {})
    return samples.some(style => get(style) !== first) ? 'mixed' : first
  }
  return { fontFamily: values(style => style.fontFamily), fontSize: values(style => style.fontSize),
    flags: Object.fromEntries(FORMAT_FLAGS.map(key => [key, values(style => Boolean(style[key]))])) as Record<typeof FORMAT_FLAGS[number], boolean | 'mixed'> }
}

export interface SharedDocumentEditorProps {
  toolbarHost?: HTMLElement | null
  document: MarkdownDocument
  revision: string
  sourceDraft?: string
  sourceMap?: MarkdownSourceMap
  initialMode?: 'layout' | 'source'
  readOnly?: boolean
  renderObject?(block: DocumentBlock, container: HTMLElement): (() => void) | void
  objectRevision?: unknown
  clipboardContext?: unknown
  clipboardResourcePort?(context: unknown): DocumentClipboardResourcePort<unknown>
  target?: 'flow' | 'file'
  resolveImage?: MarkdownOptions['resolveImage']
  onChange(document: MarkdownDocument, operation: DocumentOperation): boolean | void
  onDraft(source: string, diagnostics: DocumentDiagnostic[]): void
  onCompositionChange?(composing: boolean, source: string): void
  onSelection?(selection: DocumentSelection | null): void
  onContextualTargetChange?(target: DocumentContextSelection | null): void
  onContextualCommand?(instruction: string, target: DocumentContextSelection): void | Promise<void>
  renderContextualProperties?(target: DocumentContextSelection): ReactNode
  pinnedTargets?: readonly ExecutionSelectionTarget[]
  contextualCommandIssue?(target: DocumentContextSelection): string | null
  contextualCardSuppressed?: boolean
  editPreview?: DocumentEditPreview
  onContextualDismiss?(target: DocumentContextSelection | null): void
  onUndo(): void
  onRedo(): void
}
export interface SharedDocumentEditorHandle {
  flush(): { ready: boolean; source: string; diagnostics: DocumentDiagnostic[] }
  getContextualEditTarget(): DocumentContextSelection | null
  /** Focus a committed editable paragraph without authoring a transaction. */
  focusBlock(blockId: string): boolean
}

/** The caller owns persistence and undo; neither editor installs a history extension. */
export const SharedDocumentEditor = forwardRef<SharedDocumentEditorHandle, SharedDocumentEditorProps>(function SharedDocumentEditor(props, ref) {
  const latest = useRef(props); latest.current = props
  const [format, setFormat] = useState<ReturnType<typeof readDocumentFormatting>>({ fontFamily: undefined, fontSize: undefined, flags: { bold: false, italic: false, underline: false, strike: false, emphasis: false } })
  const [mode, setMode] = useState<'layout' | 'source'>(props.initialMode ?? (props.sourceDraft === undefined ? 'layout' : 'source'))
  const [diagnostics, setDiagnostics] = useState<DocumentDiagnostic[]>([])
  const [mathDraft, setMathDraft] = useState<{ latex: string; accessibleText: string; display: boolean; formulaId: string; from: number; to: number } | null>(null)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [contextualTarget, setContextualTarget] = useState<DocumentContextSelection | null>(null)
  const [contextualCardOpen, setContextualCardOpen] = useState(false)
  const [contextualPropertiesOpen, setContextualPropertiesOpen] = useState(false)
  const [contextualInstruction, setContextualInstruction] = useState('')
  const instructionRef = useRef(''); instructionRef.current = contextualInstruction
  const manualTarget = useRef<DocumentContextSelection | null>(null)
  const [localPin, setLocalPin] = useState<{mode: 'layout' | 'source'; from: number; to: number; revision: string} | null>(null)
  const [commandError, setCommandError] = useState('')
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number; maxWidth?: number; maxHeight?: number; visibility?: 'hidden' }>({ left: 8, top: 8, visibility: 'hidden' })
  const [retainedPosition, setRetainedPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const draft = useRef(props.sourceDraft ?? serializeDocumentMarkdown(props.document, props.target))
  const layoutHost = useRef<HTMLDivElement>(null)
  const sourceHost = useRef<HTMLDivElement>(null)
  const layout = useRef<ReturnType<typeof createLayoutEditor> | null>(null)
  const source = useRef<SourceView | null>(null)
  const sourceComposing = useRef(false)
  const syncingSource = useRef(false)
  const layoutSelection = useRef<ReturnType<Selection['toJSON']> | null>(null)
  const sourceSelection = useRef<{ anchor: number; head: number } | null>(null)
  const focusAfterSwitch = useRef(false)
  const sourceGroup = useRef({ id: crypto.randomUUID(), time: 0 })
  const contextualTargetRef = useRef<DocumentContextSelection | null>(null)
  const inputId = useId()
  const suppliedProjection = useMemo<MarkdownProjection>(() => {
    const source = props.sourceDraft ?? serializeDocumentMarkdown(props.document, props.target)
    if (props.sourceMap) return { source, document: props.document, sourceMap: props.sourceMap }
    const result = parseDocumentMarkdown(source, { createId: () => crypto.randomUUID(), target: props.target, resolveImage: props.resolveImage })
    if (result.status === 'valid' && sameMarkdownContent(result.document, props.document)) { bindMarkdownIdentities(result, props.document); return result }
    return { source, document: props.document, sourceMap: { blocks: [] } }
  }, [props.sourceMap, props.sourceDraft, props.document, props.target, props.revision])
  const projection = useRef(suppliedProjection), receivedProjection = useRef(suppliedProjection)
  if (receivedProjection.current !== suppliedProjection) { projection.current = suppliedProjection; receivedProjection.current = suppliedProjection }
  const fallbackMap = projection.current.sourceMap
  const mapRef = useRef(fallbackMap); mapRef.current = fallbackMap
  const restoreSourceSelection = useRef(false)
  useEffect(() => {
    if (!contextualTarget) return
    const position = () => {
      let point: { left: number; top: number; bottom: number } | null = null
      try {
        if (mode === 'layout' && layout.current) point = layout.current.view.coordsAtPos(layout.current.view.state.selection.from)
        else if (source.current) point = source.current.coordsAtPos(source.current.state.selection.main.from)
      } catch { /* Detached text during owner replacement has no screen position. */ }
      const editor = editorRoot.current
      if (!editor) return
      const bounds = visibleEditorBounds(editor)
      const availableWidth = Math.max(0, bounds.right - bounds.left)
      const availableHeight = Math.max(0, bounds.bottom - bounds.top)
      if (availableWidth < 1 || availableHeight < 1) {
        setRetainedPosition(null)
        setCardPosition(current => current.visibility === 'hidden' ? current : { left: 8, top: 8, visibility: 'hidden' })
        return
      }
      const maxWidth = Math.floor(availableWidth), maxHeight = Math.floor(availableHeight)
      const width = Math.min(cardRef.current?.offsetWidth || 430, maxWidth)
      const height = Math.min(cardRef.current?.scrollHeight || 155, maxHeight)
      const left = Math.max(bounds.left, Math.min(point?.left ?? bounds.left, bounds.right - width))
      const below = (point?.bottom ?? 0) + 8
      const top = Math.max(bounds.top, Math.min(below + height <= bounds.bottom ? below : (point?.top ?? bounds.top) - height - 8, bounds.bottom - height))
      setCardPosition(current => current.left === left && current.top === top && current.maxWidth === maxWidth && current.maxHeight === maxHeight && current.visibility !== 'hidden'
        ? current : { left, top, maxWidth, maxHeight })
      const barWidth = Math.min(680, maxWidth)
      const retained = { left: bounds.right - barWidth, bottom: window.innerHeight - bounds.bottom, width: barWidth, maxHeight }
      setRetainedPosition(current => current && Object.keys(retained).every(key => current[key as keyof typeof retained] === retained[key as keyof typeof retained]) ? current : retained)
    }
    position()
    window.addEventListener('scroll', position, true); window.addEventListener('resize', position)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(position)
    for (let parent: HTMLElement | null = editorRoot.current; parent && parent !== document.body; parent = parent.parentElement) {
      observer?.observe(parent)
      mutation?.observe(parent, { attributes: true, attributeFilter: ['style', 'class'] })
    }
    if (cardRef.current) observer?.observe(cardRef.current)
    return () => { window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); observer?.disconnect(); mutation?.disconnect() }
  }, [contextualTarget, mode, contextualCardOpen, contextualPropertiesOpen, commandError])
  const fail = (message: string) => setDiagnostics([{ message, offset: 0, endOffset: 0, line: 1, column: 1 }])
  const previewBlocked = () => setCommandError('正在生成的范围暂时只读。请先停止生成，再编辑这一处。')
  const pinPlugin = useMemo(() => pinnedSelectionPlugin(), [])
  const previewPlugin = useMemo(() => layoutPreviewPlugin(previewBlocked), [])
  function publishContextualTarget(target: DocumentContextSelection | null) {
    manualTarget.current = target
    latest.current.onContextualTargetChange?.(target)
    if (instructionRef.current.trim() && contextualTargetRef.current) return
    if (target) {
      const selected = mode === 'layout' ? layout.current?.view.state.selection : source.current?.state.selection.main
      const nextPin = selected && selected.from < selected.to ? { mode, from: selected.from, to: selected.to, revision: target.revision } : null
      setLocalPin(previous => JSON.stringify(previous) === JSON.stringify(nextPin) ? previous : nextPin)
    } else setLocalPin(null)
    contextualTargetRef.current = target
    setContextualTarget(target)
    setContextualCardOpen(Boolean(target))
    setContextualPropertiesOpen(false)
  }
  function publishLayoutSelection(selection: DocumentSelection | null) {
    latest.current.onSelection?.(selection)
    if (!selection) { publishContextualTarget(null); return }
    if (selection.kind === 'text' && JSON.stringify(selection.anchor.slot) === JSON.stringify(selection.head.slot) && selection.anchor.blockId === selection.head.blockId && selection.anchor.offset === selection.head.offset) { publishContextualTarget(null); return }
    const mapped = mapDocumentSelectionToSource(draft.current, mapRef.current, selection)
    const ranges = mapped.status === 'mapped' ? mapped.ranges : null
    const blockId = selection.kind === 'cells' ? selection.tableId : selection.kind === 'object' ? selection.blockId : selection.head.blockId
    const block = latest.current.document.content.blocks.find(item => item.id === blockId)
    const labels: Record<string, string> = { paragraph: '段落', heading: '标题', quote: '引用', list: '列表项', table: '单元格', formula: '公式', media: '媒体', chart: '图表', component: '互动组件', divider: '分隔线' }
    publishContextualTarget({ selection, ranges, revision: latest.current.revision, mode: 'layout', source: draft.current,
      label: selection.kind === 'cells' ? '所选单元格' : selection.kind === 'text' && selection.anchor.blockId !== selection.head.blockId ? '所选内容' : labels[block?.type ?? ''] ?? '所选对象',
      ...(mapped.status === 'unmapped' ? { message: mapped.message } : {}) })
  }
  function publishSourceSelection(view: SourceView) {
    const current = view.state.selection.main
    const from = Math.min(current.from, current.to), to = Math.max(current.from, current.to)
    if (from === to || sourceComposing.current) { publishContextualTarget(null); return }
    publishContextualTarget({ selection: null, ranges: [{ from, to, before: draft.current.slice(from, to) }], revision: latest.current.revision, mode: 'source', source: draft.current, label: '所选源文' })
  }
  function acceptSource(text: string) {
    draft.current = text
    const current = latest.current
    const result = parseDocumentMarkdown(text, { createId: () => crypto.randomUUID(), target: current.target, resolveImage: current.resolveImage, previous: projection.current })
    setDiagnostics(result.diagnostics)
    current.onDraft(text, result.diagnostics)
    if (result.status === 'valid') {
      projection.current = result; mapRef.current = result.sourceMap
      if (Date.now() - sourceGroup.current.time > 800) sourceGroup.current.id = crypto.randomUUID()
      sourceGroup.current.time = Date.now()
      const accepted = current.onChange(result.document, { operationId: crypto.randomUUID(), historyGroup: sourceGroup.current.id, source: 'source' })
      if (accepted === false) { const issues = [{ message: '正文未能提交，请修正后重试或丢弃草稿', offset: 0, endOffset: 0, line: 1, column: 1 }]; setDiagnostics(issues); current.onDraft(text, issues); return false }
    }
    return result.status === 'valid'
  }
  const options = () => ({ presentation: latest.current.target === 'flow' ? 'flow' as const : undefined, stateChanged: (state: EditorState) => setFormat(readDocumentFormatting(state)), document: projection.current.document, sourceMap: mapRef.current, revision: latest.current.revision,
    projectionPlugins: [previewPlugin, pinPlugin], projectionClipboard: (view: Parameters<typeof layoutPreviewClipboard>[0], event: ClipboardEvent, cut: boolean) => {
      const handled = layoutPreviewClipboard(view, event, cut)
      if (handled && cut) previewBlocked()
      return handled
    },
    readOnly: latest.current.readOnly, renderObject: latest.current.renderObject, objectRevision: latest.current.objectRevision,
    clipboardContext: latest.current.clipboardContext, clipboardResourcePort: latest.current.clipboardResourcePort,
    change: (document: MarkdownDocument, operation: DocumentOperation) => {
      const current = projection.current
      const text = latest.current.target === 'file' ? editMarkdownSource(draft.current, current.document, document, current.sourceMap,
        { createId: () => crypto.randomUUID(), target: 'file', resolveImage: latest.current.resolveImage }) : serializeDocumentMarkdown(document, latest.current.target)
      const parsed = parseDocumentMarkdown(text, { createId: () => crypto.randomUUID(), target: latest.current.target, resolveImage: latest.current.resolveImage })
      if (parsed.status !== 'valid') throw new Error('修改无法完整对应源文，原输入仍保留。')
      bindMarkdownIdentities(parsed, document); projection.current = parsed; mapRef.current = parsed.sourceMap
      draft.current = text; setDiagnostics([]); latest.current.onDraft(text, [])
      const result = latest.current.onChange(document, operation)
      if (result === false) { const issues = [{ message: '正文未能提交，请修正后重试或丢弃草稿', offset: 0, endOffset: 0, line: 1, column: 1 }]; setDiagnostics(issues); latest.current.onDraft(draft.current, issues); setMode('source') }
      return result
    },
    selection: publishLayoutSelection,
    undo: () => latest.current.editPreview ? latest.current.editPreview.cancel() : latest.current.onUndo(), redo: () => latest.current.onRedo(), diagnostic: fail,
  })
  useEffect(() => {
    if (mode === 'layout' && layoutHost.current) {
      const editor = createLayoutEditor(layoutHost.current, options()); layout.current = editor
      if (restoreSourceSelection.current && sourceSelection.current) {
        restoreSourceSelection.current = false
        const selected = sourceSelection.current
        const range = layoutPreviewRange(editor.view.state.doc, { editId: 'mode-selection', target: { kind: 'markdown-range', from: Math.min(selected.anchor, selected.head), to: Math.max(selected.anchor, selected.head) }, value: '', cancel() {} }, mapRef.current)
        if (range) editor.view.updateState(editor.view.state.apply(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, selected.anchor <= selected.head ? range.from : range.to, selected.anchor <= selected.head ? range.to : range.from))))
      } else if (layoutSelection.current) {
        try { editor.view.updateState(editor.view.state.apply(editor.view.state.tr.setSelection(Selection.fromJSON(editor.view.state.doc, layoutSelection.current)))) } catch { /* The owner may have replaced the selected block. */ }
      }
      if (focusAfterSwitch.current) { editor.view.focus(); focusAfterSwitch.current = false }
      return () => { layoutSelection.current = editor.view.state.selection.toJSON(); editor.destroy(); if (layout.current === editor) layout.current = null }
    }
    if (mode === 'source' && sourceHost.current) {
      source.current = new SourceView({ parent: sourceHost.current, state: SourceState.create({ doc: draft.current, extensions: [sourcePinnedSelectionField, ...sourcePreviewExtensions(previewBlocked), markdown(), foldGutter(), SourceView.lineWrapping, SourceState.readOnly.of(Boolean(latest.current.readOnly)),
        SourceView.contentAttributes.of({ 'aria-label': '正文源文编辑' }),
        sourceKeymap.of([{ key: 'Mod-z', run: () => { latest.current.editPreview ? latest.current.editPreview.cancel() : latest.current.onUndo(); return true } }, { key: 'Mod-Shift-z', run: () => { latest.current.onRedo(); return true } }]),
        SourceView.domEventHandlers({ compositionstart: () => { sourceComposing.current = true }, compositionend: (_event, view) => { sourceComposing.current = false; queueMicrotask(() => { if (source.current === view) { acceptSource(view.state.doc.toString()); publishSourceSelection(view) } }) } }),
        SourceView.updateListener.of(update => {
          if (update.docChanged) { draft.current = update.state.doc.toString(); if (!sourceComposing.current && !syncingSource.current) acceptSource(draft.current) }
          if (update.selectionSet && !syncingSource.current) publishSourceSelection(update.view)
        }),
      ] }) })
      const editor = source.current
      if (sourceSelection.current) editor.dispatch({ selection: { anchor: Math.min(editor.state.doc.length, sourceSelection.current.anchor), head: Math.min(editor.state.doc.length, sourceSelection.current.head) } })
      const folds = [...draft.current.matchAll(/^```cw-object-v1\s*\n[\s\S]*?^```/gm)].map(match => foldEffect.of({ from: match.index! + match[0].indexOf('\n'), to: match.index! + match[0].length - 3 }))
      if (folds.length) source.current.dispatch({ effects: folds })
      publishSourceSelection(editor)
      setDiagnostics(parseDocumentMarkdown(draft.current, { createId: () => crypto.randomUUID(), target: latest.current.target, resolveImage: latest.current.resolveImage }).diagnostics)
      if (focusAfterSwitch.current) { editor.focus(); focusAfterSwitch.current = false }
      return () => { sourceSelection.current = { anchor: editor.state.selection.main.anchor, head: editor.state.selection.main.head }; editor.destroy(); if (source.current === editor) source.current = null; sourceComposing.current = false }
    }
  }, [mode])
  useEffect(() => { layout.current?.update(options()) }, [props.document, props.revision, props.objectRevision, props.readOnly])
  useEffect(() => {
    if (sourceComposing.current) return
    const text = props.sourceDraft ?? serializeDocumentMarkdown(props.document, props.target)
    if (text === draft.current) return
    draft.current = text
    if (source.current) {
      syncingSource.current = true
      const previous = source.current.state.doc.toString()
      let from = 0, before = previous.length, after = text.length
      while (from < before && from < after && previous[from] === text[from]) from++
      while (before > from && after > from && previous[before - 1] === text[after - 1]) { before--; after-- }
      source.current.dispatch({ changes: { from, to: before, insert: text.slice(from, after) }, effects: sourcePreviewEffect.of(null) })
      syncingSource.current = false
    }
    const result = parseDocumentMarkdown(text, { createId: () => crypto.randomUUID(), target: props.target, resolveImage: props.resolveImage })
    setDiagnostics(result.diagnostics)
  }, [props.revision, props.sourceDraft])
  useEffect(() => {
    if (layout.current) {
      const view = layout.current.view
      view.dispatch(view.state.tr.setMeta(layoutPreviewKey, layoutPreviewRange(view.state.doc, props.editPreview, mapRef.current)))
    }
    if (source.current) source.current.dispatch({ effects: sourcePreviewEffect.of(sourcePreviewRange(props.editPreview, mapRef.current)) })
  }, [mode, props.editPreview, props.revision, props.document, fallbackMap])
  useEffect(() => {
    const current = contextualTargetRef.current
    if (current && current.revision !== props.revision) publishContextualTarget(null)
  }, [props.revision])
  useEffect(() => {
    const pins = (props.pinnedTargets ?? []).filter(target => target.kind !== 'course-object').map(target => ({ editId: 'pinned-selection', target, value: '', cancel() {} }))
    if (layout.current) {
      const view = layout.current.view
      view.dispatch(view.state.tr.setMeta(pinnedSelectionKey, [...pins.flatMap(pin => { const range = layoutPreviewRange(view.state.doc, pin, mapRef.current); return range ? [range] : [] }), ...(localPin?.mode === 'layout' && localPin.revision === props.revision ? [localPin] : [])]))
    }
    if (source.current) source.current.dispatch({ effects: sourcePinnedSelectionEffect.of([...pins.flatMap(pin => { const range = sourcePreviewRange(pin, mapRef.current); return range ? [range] : [] }), ...(localPin?.mode === 'source' && localPin.revision === props.revision ? [localPin] : [])]) })
  }, [mode, props.pinnedTargets, props.revision, fallbackMap, localPin])
  useImperativeHandle(ref, () => ({
    flush: () => ({ ready: !sourceComposing.current && (layout.current?.flush() ?? true), source: draft.current, diagnostics }),
    getContextualEditTarget: () => contextualTargetRef.current,
    focusBlock: (blockId) => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly) return false
      let position: number | null = null
      editor.view.state.doc.descendants((node, offset) => {
        if (node.attrs.id === blockId && node.type.name === 'paragraph') {
          position = offset + 1
          return false
        }
        return true
      })
      if (position === null) return false
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position)).scrollIntoView())
      editor.view.focus()
      return true
    },
  }), [diagnostics, mode])
  function switchMode() {
    publishContextualTarget(null)
    if (mode === 'layout') {
      if (!layout.current?.flush()) return
      const state = layout.current.view.state, anchor = editorPositionToPoint(state.doc, state.selection.anchor), head = editorPositionToPoint(state.doc, state.selection.head)
      if (anchor && head) {
        const mapped = mapDocumentSelectionToSource(draft.current, mapRef.current, { kind: 'text', revision: latest.current.revision, anchor, head })
        if (mapped.status === 'mapped' && mapped.ranges.length) { const from = mapped.ranges[0].from, to = mapped.ranges.at(-1)!.to; sourceSelection.current = state.selection.anchor <= state.selection.head ? { anchor: from, head: to } : { anchor: to, head: from } }
      }
      focusAfterSwitch.current = true; setMode('source')
    }
    else if (!sourceComposing.current && diagnostics.length === 0) { restoreSourceSelection.current = true; sourceSelection.current = source.current ? { anchor: source.current.state.selection.main.anchor, head: source.current.state.selection.main.head } : sourceSelection.current; focusAfterSwitch.current = true; setMode('layout') }
  }
  function style(patch: TextRunStyle) {
    const editor = layout.current
    if (!editor) return
    editor.syncDomTextSelection()
    editor.boundary()
    const { state } = editor.view
    const type = documentEditorSchema.marks.style
    const tr = state.tr
    if (state.selection.empty) {
      const current = (state.storedMarks ?? state.selection.$from.marks()).find(mark => mark.type === type)?.attrs.value ?? {}
      tr.addStoredMark(type.create({ value: { ...current, ...patch } }))
    } else state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (!node.isInline) return
      const current = node.marks.find(mark => mark.type === type)?.attrs.value ?? {}
      tr.addMark(Math.max(state.selection.from, pos), Math.min(state.selection.to, pos + node.nodeSize), type.create({ value: { ...current, ...patch } }))
    })
    editor.view.dispatch(tr)
    editor.view.focus()
  }
  function toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike' | 'emphasis') {
    layout.current?.syncDomTextSelection()
    const state = layout.current?.view.state
    if (!state) return
    style({ [key]: readDocumentFormatting(state).flags[key] !== true })
  }
  function applyParagraphType(value: string) {
    const editor = layout.current
    if (!editor) return
    editor.syncDomTextSelection()
    const type = value === 'paragraph' ? 'paragraph' : 'heading'
    const node = editor.view.state.selection.$from.parent
    editor.boundary()
    setBlockType(documentEditorSchema.nodes[type], { id: node.attrs.id, data: { ...node.attrs.data, type, ...(type === 'paragraph' ? {} : { level: Number(value) }) } })(editor.view.state, editor.view.dispatch)
    editor.view.focus()
  }
  function dismissContextualTarget() {
    const current = contextualTargetRef.current
    instructionRef.current = ''; setContextualInstruction('')
    publishContextualTarget(null)
    latest.current.onContextualDismiss?.(current)
  }
  async function submitContextualCommand(event: FormEvent) {
    event.preventDefault()
    const instruction = contextualInstruction.trim(), target = contextualTargetRef.current
    if (!instruction || !target || contextualIssue(target) || diagnostics.length || !latest.current.onContextualCommand) return
    try { await latest.current.onContextualCommand(instruction, target); setContextualInstruction(''); setCommandError('') }
    catch (error) { setCommandError(error instanceof Error ? error.message : String(error)) }
  }
  function contextualIssue(target: DocumentContextSelection) {
    if (target.revision !== props.revision) return '选中的内容已改变，请改为当前选择；原指令仍保留。'
    return props.contextualCommandIssue ? props.contextualCommandIssue(target) : target.ranges?.length ? null : target.message ?? '请重新选择要修改的内容。'
  }
  function openMath() {
    const editor = layout.current
    if (!editor) return
    const { selection } = editor.view.state
    const node = selection instanceof NodeSelection ? selection.node : null
    const data = node?.type.name === 'math' || node?.type.name === 'formula' ? node.attrs.data : null
    setMathDraft({ latex: data?.latex ?? 'x^2', accessibleText: data?.accessibleText ?? '', display: node?.type.name === 'formula', formulaId: data?.formulaId ?? crypto.randomUUID(), from: selection.from, to: selection.to })
  }
  function applyMath() {
    const editor = layout.current
    if (!editor || !mathDraft) return
    try {
      const parsedMath = parseDocumentMath(mathDraft.latex)
      const data = { type: 'math', formulaId: mathDraft.formulaId, latex: mathDraft.latex, accessibleText: mathDraft.accessibleText || describeDocumentMath(parsedMath) }
      const current = editor.view.state.doc.nodeAt(mathDraft.from)
      let node = mathDraft.display ? documentEditorSchema.nodes.formula.create({ id: current?.type.name === 'formula' ? current.attrs.id : crypto.randomUUID(), data: { ...data, type: 'formula' } }) : documentEditorSchema.nodes.math.create({ data })
      if (!mathDraft.display && current?.type.name === 'formula') node = documentEditorSchema.nodes.paragraph.create({ id: current.attrs.id, data: { type: 'paragraph' } }, node)
      editor.boundary()
      editor.view.dispatch(editor.view.state.tr.replaceRangeWith(mathDraft.from, mathDraft.to, node))
      setMathDraft(null); editor.view.focus()
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  const toolbar = <div ref={toolbarRef} tabIndex={-1} className="shared-document-toolbar" onPointerDownCapture={() => layout.current?.syncDomTextSelection()} role="toolbar" aria-label="正文工具">
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={switchMode}>{mode === 'layout' ? '源文' : '正文'}</button>
      <button type="button" onClick={() => props.editPreview ? props.editPreview.cancel() : props.onUndo()}>撤销</button><button type="button" onClick={props.onRedo}>重做</button>
      {mode === 'layout' && <>
        {([['bold', '粗体'], ['italic', '斜体'], ['underline', '下划线'], ['strike', '删除线'], ['emphasis', '着重号']] as const).map(([key, label]) => <button key={key} type="button" onMouseDown={event => event.preventDefault()} aria-pressed={format.flags[key]} onClick={() => toggleStyle(key)}>{label}</button>)}
        <label>字号<input aria-label="字号" type="number" min="8" max="400" value={format.fontSize === 'mixed' ? '' : format.fontSize ?? ''} placeholder={format.fontSize === 'mixed' ? '混合' : '默认'} onChange={event => { const value = Number(event.target.value); if (value >= 8 && value <= 400) style({ fontSize: value }) }} /></label>
        <label>字体<select aria-label="字体" value={format.fontFamily === 'mixed' ? '__mixed' : format.fontFamily ?? ''} onChange={event => { if (event.target.value && event.target.value !== '__mixed') style({ fontFamily: event.target.value }) }}><option value="">默认字体</option>{format.fontFamily === 'mixed' && <option value="__mixed">混合字体</option>}{format.fontFamily && format.fontFamily !== 'mixed' && !FONT_FAMILY_OPTIONS.some(option => option.family === format.fontFamily) && <option value={format.fontFamily}>{format.fontFamily}</option>}{FONT_FAMILY_OPTIONS.map(option => <option key={option.family} value={option.family}>{option.label}</option>)}</select></label>
        <label>颜色<input type="color" aria-label="文字颜色" defaultValue="#1f2937" onChange={event => style({ color: event.target.value })} /></label>
        <label>高亮<input type="color" aria-label="高亮颜色" defaultValue="#fff3a3" onChange={event => style({ highlightColor: event.target.value })} /></label>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => style({ baseline: 0.35 })}>上标</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => style({ baseline: -0.25 })}>下标</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { const editor = layout.current; if (editor) toggleMark(documentEditorSchema.marks.code)(editor.view.state, editor.view.dispatch) }}>行内代码</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { const state = layout.current?.view.state; setLinkDraft(state?.selection.$from.marks().find(mark => mark.type === documentEditorSchema.marks.link)?.attrs.href ?? '') }}>链接</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={openMath}>公式</button>
        <select aria-label="段落类型" defaultValue="paragraph" onChange={event => applyParagraphType(event.target.value)}><option value="paragraph">正文</option>{[1,2,3,4,5,6].map(level => <option key={level} value={level}>标题 {level}</option>)}</select>
      </>}
      {diagnostics.length > 0 && <button type="button" onClick={() => { draft.current = serializeDocumentMarkdown(props.document, props.target); setDiagnostics([]); props.onDraft(draft.current, []); setMode('layout') }}>丢弃待修草稿</button>}
    </div>
  const editorForms = <>
    {linkDraft !== null && <form className="shared-document-form" aria-label="链接编辑" onSubmit={event => {
      event.preventDefault(); const editor = layout.current; if (!editor) return
      if (linkDraft && !/^(https?:|mailto:|#|\.\/|\.\.\/)/i.test(linkDraft)) { fail('请输入 https、mailto 或文档内相对链接'); return }
      editor.boundary(); const state = editor.view.state
      if (!linkDraft) editor.view.dispatch(state.tr.removeMark(state.selection.from, state.selection.to, documentEditorSchema.marks.link))
      else if (state.selection.empty) editor.view.dispatch(state.tr.insertText(linkDraft).addMark(state.selection.from, state.selection.from + linkDraft.length, documentEditorSchema.marks.link.create({ href: linkDraft })))
      else editor.view.dispatch(state.tr.addMark(state.selection.from, state.selection.to, documentEditorSchema.marks.link.create({ href: linkDraft })))
      setLinkDraft(null); editor.view.focus()
    }}><label>链接地址<input aria-label="链接地址" value={linkDraft} onChange={event => setLinkDraft(event.target.value)} /></label><button type="submit">应用链接</button><button type="button" onClick={() => setLinkDraft(null)}>取消</button></form>}
    {mathDraft && <form className="shared-document-form" aria-label="公式编辑" onSubmit={event => { event.preventDefault(); applyMath() }}>
      <label>LaTeX<input value={mathDraft.latex} onChange={event => setMathDraft({ ...mathDraft, latex: event.target.value })} /></label>
      <label>朗读说明<input value={mathDraft.accessibleText} onChange={event => setMathDraft({ ...mathDraft, accessibleText: event.target.value })} /></label>
      <label><input type="checkbox" checked={mathDraft.display} onChange={event => setMathDraft({ ...mathDraft, display: event.target.checked })} />独立公式</label>
      <button type="submit">应用公式</button><button type="button" onClick={() => setMathDraft(null)}>取消</button>
    </form>}
  </>
  const contextualProperties = contextualTarget && props.renderContextualProperties?.(contextualTarget)
  const contextualCard = contextualTarget && !props.readOnly && !props.contextualCardSuppressed && (contextualCardOpen
    ? <aside ref={cardRef} className="shared-document-contextual-card" style={cardPosition} aria-label="当前编辑目标" onPointerDownCapture={() => layout.current?.syncDomTextSelection()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (contextualPropertiesOpen) setContextualPropertiesOpen(false); else { setContextualCardOpen(false); layout.current?.view.focus(); source.current?.focus() } } }}>
        <div className="shared-document-contextual-card__header"><strong>{contextualTarget.label}</strong>{contextualTarget.ranges && <span>{contextualTarget.ranges.reduce((count, range) => count + Array.from(range.before).length, 0)} 字</span>}<button type="button" aria-label="关闭当前编辑目标" onClick={dismissContextualTarget}>关闭</button></div>
        {mode === 'layout' && contextualTarget.selection?.kind !== 'object' && <div className="shared-document-contextual-card__actions" role="group" aria-label="当前选区格式"><button type="button" onClick={() => toggleStyle('bold')} aria-label="当前选区加粗">加粗</button><button type="button" onClick={() => toggleStyle('italic')} aria-label="当前选区斜体">斜体</button>{['段落', '标题'].includes(contextualTarget.label) && <select aria-label="当前段落类型" defaultValue="paragraph" onChange={event => applyParagraphType(event.target.value)}><option value="paragraph">正文</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>标题 {level}</option>)}</select>}</div>}
        {props.onContextualCommand && <form className="shared-document-contextual-card__command" onSubmit={submitContextualCommand} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}><label htmlFor={inputId}>AI 指令</label><input id={inputId} value={contextualInstruction} onChange={event => setContextualInstruction(event.target.value)} placeholder="告诉 AI 如何修改这里" autoComplete="off" /><button type="submit" disabled={!contextualInstruction.trim() || Boolean(contextualIssue(contextualTarget)) || diagnostics.length > 0}>发送</button></form>}
        <button type="button" onClick={() => { const next = manualTarget.current; instructionRef.current = ''; publishContextualTarget(next); instructionRef.current = contextualInstruction }}>改为当前选择</button>
        <button type="button" onClick={() => { setContextualCardOpen(false); const details = toolbarRef.current?.closest('details'); if (details) details.open = true; toolbarRef.current?.scrollIntoView?.({ block: 'nearest' }); toolbarRef.current?.focus() }}>更多格式</button>
        {contextualProperties && <button type="button" aria-expanded={contextualPropertiesOpen} onClick={() => setContextualPropertiesOpen(value => !value)}>属性</button>}
        {contextualProperties && contextualPropertiesOpen && <div aria-label="正文选中属性" style={{ maxHeight: 'min(50vh, 420px)', overflow: 'auto' }}>{contextualProperties}</div>}
        {commandError && <p role="alert">{commandError}</p>}
        {contextualIssue(contextualTarget) && <p role="status">{contextualIssue(contextualTarget)}</p>}<button className="shared-document-contextual-card__retain" type="button" onClick={() => setContextualCardOpen(false)}>保留目标</button>
      </aside>
    : <div className="shared-document-contextual-target" style={retainedPosition ?? { visibility: 'hidden' }} role="status"><span>已保留目标：{contextualTarget.label}</span><button type="button" onClick={() => setContextualCardOpen(true)}>展开编辑卡</button><button type="button" aria-label="关闭已保留目标" onClick={dismissContextualTarget}>关闭</button></div>)
  return <div ref={editorRoot} className={`shared-document-editor${props.target === 'flow' ? ' shared-document-editor--flow' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape' && contextualTarget) { event.preventDefault(); setContextualCardOpen(false) }
    if (event.altKey && event.key === 'Enter' && contextualTarget) { event.preventDefault(); setContextualCardOpen(true); requestAnimationFrame(() => cardRef.current?.querySelector<HTMLInputElement>('input')?.focus()) }
  }} onCompositionStartCapture={() => props.onCompositionChange?.(true, draft.current)} onCompositionEndCapture={() => queueMicrotask(() => props.onCompositionChange?.(false, draft.current))}>
     {!props.readOnly && (props.toolbarHost ? createPortal(<details className="flow-document-format"><summary onMouseDown={event => event.preventDefault()}>正文格式</summary>{toolbar}{editorForms}</details>, props.toolbarHost) : <>{toolbar}{editorForms}</>)}
     {contextualCard && createPortal(contextualCard, window.document.body)}
     {props.editPreview && <div className="document-generation-status" role="status">正文正在生成，生成部分尚未保存。<button type="button" onClick={props.editPreview.cancel}>停止生成</button>{commandError && <span role="alert">{commandError}</span>}</div>}
     {mode === 'layout' ? <div ref={layoutHost} /> : <div ref={sourceHost} />}
    {diagnostics.length > 0 && <ul role="alert">{diagnostics.map((diagnostic, index) => <li key={index}><button type="button" onClick={() => { const editor = source.current; if (!editor) return; const position = Math.min(editor.state.doc.length, diagnostic.offset); editor.dispatch({ selection: { anchor: position }, effects: SourceView.scrollIntoView(position) }); editor.focus() }}>第 {diagnostic.line} 行：{diagnostic.message}</button></li>)}</ul>}
  </div>
})
