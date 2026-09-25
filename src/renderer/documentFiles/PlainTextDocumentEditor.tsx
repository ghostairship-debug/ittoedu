import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

export interface PlainTextDocumentEditorHandle {
  flush(): { ready: boolean; source: string }
}
export interface PlainTextDocumentEditorProps {
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
  const draft = useRef(props.source)
  const syncing = useRef(false)
  const composing = useRef(false)
  useImperativeHandle(ref, () => ({ flush: () => ({ ready: !composing.current, source: draft.current }) }), [])
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const editor = new EditorView({ parent, state: EditorState.create({ doc: draft.current, extensions: [
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '纯文本编辑' }),
      keymap.of([
        { key: 'Mod-z', run: () => { latest.current.onUndo(); return true } },
        { key: 'Mod-y', mac: 'Mod-Shift-z', run: () => { latest.current.onRedo(); return true } },
      ]),
      EditorView.domEventHandlers({
        compositionstart: () => { composing.current = true },
        compositionend: (_event, current) => { composing.current = false; queueMicrotask(() => { if (view.current === current) { draft.current = current.state.doc.toString(); latest.current.onDraft(draft.current) } }) },
      }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged || syncing.current || composing.current) return
        draft.current = update.state.doc.toString()
        latest.current.onDraft(draft.current)
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
    const previous = editor.state.doc.toString()
    let from = 0, before = previous.length, after = text.length
    while (from < before && from < after && previous[from] === text[from]) from++
    while (before > from && after > from && previous[before - 1] === text[after - 1]) { before--; after-- }
    editor.dispatch({ changes: { from, to: before, insert: text.slice(from, after) } })
    syncing.current = false
  }, [props.source, props.revision])
  return <div ref={host} className="plain-text-document-editor" />
})
