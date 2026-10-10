import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { DocumentContextSelection } from '../../shared/document/ports'
import { capturePlainTextSelection, workbenchSelection } from '../workbench/SelectionContextController'
import { TextAiButton } from '../workbench/elementCards/ElementTextCards'
import { prepareDocumentTextEdit } from '../document/documentSelectionCommands'
import { SelectionQuickBar } from '../editing/quickbar/SelectionQuickBar'
import { cancelEditPreview, useEditPreviews } from '../workbench/EditPreviewProjection'
import { sourcePreviewEffect, sourcePreviewExtensions } from '../document/editPreviewWidgets'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { applyEditorChanges, editorText, reconcileEditorText, sourceOffset, editorOffset } from './plainTextSourceMapping'

export interface PlainTextDocumentEditorHandle {
  flush(): { ready: boolean; source: string }
  clearSelection(): void
}
export interface PlainTextDocumentEditorProps {
  documentId?: string
  documentEpoch?: string
  active?: boolean
  source: string
  revision: number
  onDraft(source: string): void
  onUndo(): void
  onRedo(): void
}

/** Plain text only: wrapping source view, no Markdown parsing or formatting toolbar. */
export const PlainTextDocumentEditor = forwardRef<PlainTextDocumentEditorHandle, PlainTextDocumentEditorProps>(function PlainTextDocumentEditor(props, ref) {
  const latest = useRef(props); latest.current = props
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [selection, setSelection] = useState<DocumentContextSelection | null>(null)
  const [issue, setIssue] = useState('')
  const previews = useEditPreviews(props.documentId, props.revision)
  const draft = useRef(props.source)
  const syncing = useRef(false)
  const composing = useRef(false)
  useImperativeHandle(ref, () => ({ flush: () => ({ ready: !composing.current, source: draft.current }), clearSelection: () => {
    const editor = view.current; if (editor) editor.dispatch({ selection: { anchor: editor.state.selection.main.head } })
  } }), [])
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const editor = new EditorView({ parent, state: EditorState.create({ doc: draft.current, extensions: [
      EditorView.lineWrapping,
      sourcePreviewExtensions(() => setIssue('正在生成的范围暂时只读，请先停止这一处生成。')),
      EditorView.contentAttributes.of({ 'aria-label': '纯文本编辑' }),
      keymap.of([
        { key: 'Mod-z', run: () => { latest.current.onUndo(); return true } },
        { key: 'Mod-y', mac: 'Mod-Shift-z', run: () => { latest.current.onRedo(); return true } },
      ]),
      EditorView.domEventHandlers({
        compositionstart: () => { composing.current = true },
        compositionend: (_event, current) => { composing.current = false; queueMicrotask(() => { if (view.current === current) { draft.current = reconcileEditorText(draft.current, current.state.doc.toString()); latest.current.onDraft(draft.current) } }) },
      }),
      EditorView.updateListener.of(update => {
        if (composing.current) return
        if (update.docChanged && !syncing.current) {
          draft.current = applyEditorChanges(draft.current, update.changes)
          latest.current.onDraft(draft.current)
        }
        if (!update.selectionSet && !update.docChanged) return
        const current = update.state.selection.main, source = draft.current
        const from = sourceOffset(source, current.from), to = sourceOffset(source, current.to)
        const target: DocumentContextSelection | null = from === to ? null : { mode: 'source', revision: String(latest.current.revision), source, selection: null, ranges: [{ from, to, before: source.slice(from, to) }], label: '所选文字' }
        setSelection(target)
        const id = latest.current.documentId
        if (id && latest.current.active !== false) void workbenchSelection.observe(id, latest.current.revision, snapshot => target ? capturePlainTextSelection(snapshot, target) : null, () => latest.current.active !== false && view.current === update.view)
      }),
    ] }) })
    view.current = editor
    return () => { editor.destroy(); if (view.current === editor) view.current = null; composing.current = false }
  }, [])
  useEffect(() => {
    if (composing.current) return
    const text = props.source
    if (text === draft.current) return
    draft.current = text
    const editor = view.current
    if (!editor) return
    syncing.current = true
    const previous = editor.state.doc.toString(), visible = editorText(text)
    let from = 0, before = previous.length, after = visible.length
    while (from < before && from < after && previous[from] === visible[from]) from++
    while (before > from && after > from && previous[before - 1] === visible[after - 1]) { before--; after-- }
    editor.dispatch({ changes: { from, to: before, insert: visible.slice(from, after) }, effects: sourcePreviewEffect.of(null) })
    syncing.current = false
  }, [props.source, props.revision])
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    editor.dispatch({ effects: sourcePreviewEffect.of(previews.flatMap(preview => preview.target.kind === 'markdown-range' && (!latest.current.documentEpoch || preview.epoch === latest.current.documentEpoch) && (preview.status === 'finished' ? preview.revision > latest.current.revision : preview.revision === latest.current.revision) ? [{ editId: preview.editId, sequence: preview.sequence,
      from: editorOffset(draft.current, preview.target.from), to: editorOffset(draft.current, preview.target.to), value: preview.value, cancel: () => { void cancelEditPreview(preview).catch(error => setIssue(String(error))) } }] : [])) })
  }, [previews, props.revision, props.source])
  useEffect(() => {
    if (!props.documentId || props.active === false) return
    return workbenchSelection.registerTargetView(props.documentId, {
      root: () => view.current?.dom ?? null,
      rect: target => {
        if (target.kind !== 'markdown-range') return null
        try { const a = view.current?.coordsAtPos(editorOffset(draft.current, target.from)), b = view.current?.coordsAtPos(editorOffset(draft.current, target.to)); return a && b ? new DOMRect(Math.min(a.left,b.left), Math.min(a.top,b.top), Math.max(1,Math.max(a.right,b.right)-Math.min(a.left,b.left)), Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top)) : null } catch { return null }
      },
      select: target => { if (target.kind !== 'markdown-range' || !view.current) return false; view.current.dispatch({ selection: { anchor: editorOffset(draft.current, target.from), head: editorOffset(draft.current, target.to) }, scrollIntoView: true }); view.current.focus(); return true },
    })
  }, [props.documentId, props.active])
  const selected = selection?.ranges?.[0]
  let anchor: DOMRect | null = null
  try { const a = selected && view.current?.coordsAtPos(editorOffset(draft.current, selected.from)), b = selected && view.current?.coordsAtPos(editorOffset(draft.current, selected.to)); if (a && b) anchor = new DOMRect(Math.min(a.left,b.left), Math.min(a.top,b.top), Math.max(1,Math.max(a.right,b.right)-Math.min(a.left,b.left)), Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top)) } catch { /* The current source projection has no screen box while hidden. */ }
  return <><div ref={host} className="plain-text-document-editor" />
    {props.active !== false && props.documentId && selection && <SelectionQuickBar anchor={anchor} bounds={{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }} label="文本选区操作" selectionKey={JSON.stringify(selected)}>
      <TextAiButton documentId={props.documentId} selectionIdentity={JSON.stringify(selected)} start={() => prepareDocumentTextEdit(props.documentId!, selection, capturePlainTextSelection)} />
    </SelectionQuickBar>}
    {issue && <div role="alert">{issue}</div>}
  </>
})
