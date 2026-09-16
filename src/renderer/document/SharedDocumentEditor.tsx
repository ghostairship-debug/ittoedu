import { FONT_FAMILY_OPTIONS } from '../../shared/fonts/fontFamilyCatalog'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorState as SourceState } from '@codemirror/state'
import { EditorView as SourceView, keymap as sourceKeymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { foldGutter, foldEffect } from '@codemirror/language'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument, type MarkdownOptions } from '../../shared/document/markdown'
import type { DocumentDiagnostic, DocumentSelection } from '../../shared/document/ports'
import type { TextRunStyle } from '../../shared/contracts/native-v1/types'
import { createLayoutEditor, type DocumentOperation } from './editorSession'
import { documentEditorSchema } from './editorSchema'
import { NodeSelection, Selection, type EditorState } from 'prosemirror-state'
import { toggleMark, setBlockType } from 'prosemirror-commands'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'
import type { DocumentBlock } from '../../shared/document/content'
import type { DocumentClipboardResourcePort } from './documentClipboard'
import './sharedDocumentEditor.css'
import 'katex/dist/katex.min.css'

const FORMAT_FLAGS = ['bold', 'italic', 'underline', 'strike', 'emphasis'] as const
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
  onUndo(): void
  onRedo(): void
}
export interface SharedDocumentEditorHandle { flush(): { ready: boolean; source: string; diagnostics: DocumentDiagnostic[] } }

/** The caller owns persistence and undo; neither editor installs a history extension. */
export const SharedDocumentEditor = forwardRef<SharedDocumentEditorHandle, SharedDocumentEditorProps>(function SharedDocumentEditor(props, ref) {
  const latest = useRef(props); latest.current = props
  const [format, setFormat] = useState<ReturnType<typeof readDocumentFormatting>>({ fontFamily: undefined, fontSize: undefined, flags: { bold: false, italic: false, underline: false, strike: false, emphasis: false } })
  const [mode, setMode] = useState<'layout' | 'source'>(props.initialMode ?? (props.sourceDraft === undefined ? 'layout' : 'source'))
  const [diagnostics, setDiagnostics] = useState<DocumentDiagnostic[]>([])
  const [mathDraft, setMathDraft] = useState<{ latex: string; accessibleText: string; display: boolean; formulaId: string; from: number; to: number } | null>(null)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
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
  const fail = (message: string) => setDiagnostics([{ message, offset: 0, endOffset: 0, line: 1, column: 1 }])
  function acceptSource(text: string) {
    draft.current = text
    const current = latest.current
    const result = parseDocumentMarkdown(text, { createId: () => crypto.randomUUID(), target: current.target, resolveImage: current.resolveImage })
    setDiagnostics(result.diagnostics)
    current.onDraft(text, result.diagnostics)
    if (result.status === 'valid') {
      if (Date.now() - sourceGroup.current.time > 800) sourceGroup.current.id = crypto.randomUUID()
      sourceGroup.current.time = Date.now()
      const accepted = current.onChange(result.document, { operationId: crypto.randomUUID(), historyGroup: sourceGroup.current.id, source: 'source' })
      if (accepted === false) { const issues = [{ message: '正文未能提交，请修正后重试或丢弃草稿', offset: 0, endOffset: 0, line: 1, column: 1 }]; setDiagnostics(issues); current.onDraft(text, issues); return false }
    }
    return result.status === 'valid'
  }
  const options = () => ({ presentation: latest.current.target === 'flow' ? 'flow' as const : undefined, stateChanged: (state: EditorState) => setFormat(readDocumentFormatting(state)), document: latest.current.document, revision: latest.current.revision,
    readOnly: latest.current.readOnly, renderObject: latest.current.renderObject, objectRevision: latest.current.objectRevision,
    clipboardContext: latest.current.clipboardContext, clipboardResourcePort: latest.current.clipboardResourcePort,
    change: (document: MarkdownDocument, operation: DocumentOperation) => {
      draft.current = serializeDocumentMarkdown(document, latest.current.target); setDiagnostics([]); latest.current.onDraft(draft.current, [])
      const result = latest.current.onChange(document, operation)
      if (result === false) { const issues = [{ message: '正文未能提交，请修正后重试或丢弃草稿', offset: 0, endOffset: 0, line: 1, column: 1 }]; setDiagnostics(issues); latest.current.onDraft(draft.current, issues); setMode('source') }
      return result
    },
    selection: (selection: DocumentSelection | null) => latest.current.onSelection?.(selection),
    undo: () => latest.current.onUndo(), redo: () => latest.current.onRedo(), diagnostic: fail,
  })
  useEffect(() => {
    if (mode === 'layout' && layoutHost.current) {
      const editor = createLayoutEditor(layoutHost.current, options()); layout.current = editor
      if (layoutSelection.current) {
        try { editor.view.updateState(editor.view.state.apply(editor.view.state.tr.setSelection(Selection.fromJSON(editor.view.state.doc, layoutSelection.current)))) } catch { /* The owner may have replaced the selected block. */ }
      }
      if (focusAfterSwitch.current) { editor.view.focus(); focusAfterSwitch.current = false }
      return () => { layoutSelection.current = editor.view.state.selection.toJSON(); editor.destroy(); if (layout.current === editor) layout.current = null }
    }
    if (mode === 'source' && sourceHost.current) {
      source.current = new SourceView({ parent: sourceHost.current, state: SourceState.create({ doc: draft.current, extensions: [markdown(), foldGutter(), SourceView.lineWrapping, SourceState.readOnly.of(Boolean(latest.current.readOnly)),
        SourceView.contentAttributes.of({ 'aria-label': '正文源文编辑' }),
        sourceKeymap.of([{ key: 'Mod-z', run: () => { latest.current.onUndo(); return true } }, { key: 'Mod-Shift-z', run: () => { latest.current.onRedo(); return true } }]),
        SourceView.domEventHandlers({ compositionstart: () => { sourceComposing.current = true }, compositionend: (_event, view) => { sourceComposing.current = false; queueMicrotask(() => { if (source.current === view) acceptSource(view.state.doc.toString()) }) } }),
        SourceView.updateListener.of(update => { if (update.docChanged) { draft.current = update.state.doc.toString(); if (!sourceComposing.current && !syncingSource.current) acceptSource(draft.current) } }),
      ] }) })
      const editor = source.current
      if (sourceSelection.current) editor.dispatch({ selection: { anchor: Math.min(editor.state.doc.length, sourceSelection.current.anchor), head: Math.min(editor.state.doc.length, sourceSelection.current.head) } })
      const folds = [...draft.current.matchAll(/^```cw-object-v1\s*\n[\s\S]*?^```/gm)].map(match => foldEffect.of({ from: match.index! + match[0].indexOf('\n'), to: match.index! + match[0].length - 3 }))
      if (folds.length) source.current.dispatch({ effects: folds })
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
      source.current.dispatch({ changes: { from: 0, to: source.current.state.doc.length, insert: text } })
      syncingSource.current = false
    }
    const result = parseDocumentMarkdown(text, { createId: () => crypto.randomUUID(), target: props.target, resolveImage: props.resolveImage })
    setDiagnostics(result.diagnostics)
  }, [props.revision, props.sourceDraft])
  useImperativeHandle(ref, () => ({ flush: () => ({ ready: !sourceComposing.current && (layout.current?.flush() ?? true), source: draft.current, diagnostics }) }), [diagnostics])
  function switchMode() {
    if (mode === 'layout') { if (!layout.current?.flush()) return; focusAfterSwitch.current = true; setMode('source') }
    else if (!sourceComposing.current && diagnostics.length === 0) { focusAfterSwitch.current = true; setMode('layout') }
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
  const toolbar = <div className="shared-document-toolbar" onPointerDownCapture={() => layout.current?.syncDomTextSelection()} role="toolbar" aria-label="正文工具">
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={switchMode}>{mode === 'layout' ? '源文' : '排版'}</button>
      <button type="button" onClick={props.onUndo}>撤销</button><button type="button" onClick={props.onRedo}>重做</button>
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
        <select aria-label="段落类型" defaultValue="paragraph" onChange={event => { const editor = layout.current; if (!editor) return; const type = event.target.value; const node = editor.view.state.selection.$from.parent; editor.boundary(); setBlockType(documentEditorSchema.nodes[type === 'paragraph' ? 'paragraph' : 'heading'], { id: node.attrs.id, data: { ...node.attrs.data, type: type === 'paragraph' ? 'paragraph' : 'heading', ...(type === 'paragraph' ? {} : { level: Number(type) }) } })(editor.view.state, editor.view.dispatch) }}><option value="paragraph">正文</option>{[1,2,3,4,5,6].map(level => <option key={level} value={level}>标题 {level}</option>)}</select>
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
  return <div className={`shared-document-editor${props.target === 'flow' ? ' shared-document-editor--flow' : ''}`} onCompositionStartCapture={() => props.onCompositionChange?.(true, draft.current)} onCompositionEndCapture={() => queueMicrotask(() => props.onCompositionChange?.(false, draft.current))}>
    {!props.readOnly && (props.toolbarHost ? createPortal(<details className="flow-document-format"><summary onMouseDown={event => event.preventDefault()}>正文格式</summary>{toolbar}{editorForms}</details>, props.toolbarHost) : <>{toolbar}{editorForms}</>)}
    {mode === 'layout' ? <div ref={layoutHost} /> : <div ref={sourceHost} />}
    {diagnostics.length > 0 && <ul role="alert">{diagnostics.map((diagnostic, index) => <li key={index}><button type="button" onClick={() => { const editor = source.current; if (!editor) return; const position = Math.min(editor.state.doc.length, diagnostic.offset); editor.dispatch({ selection: { anchor: position }, effects: SourceView.scrollIntoView(position) }); editor.focus() }}>第 {diagnostic.line} 行：{diagnostic.message}</button></li>)}</ul>}
  </div>
})
