import { Fragment, Slice } from 'prosemirror-model'
import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { baseKeymap, splitBlock, toggleMark } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { goToNextCell, tableEditing } from 'prosemirror-tables'
import { toWordEditorDocument, wordEditorSchema, wordParagraphs, wordTransactionEdits, type WordEdit, type WordInspection } from './wordEditorModel'

export interface WordKernelOptions {
  changed(edits: WordEdit[]): void
  selection(state: EditorState): void
  composition(active: boolean): void
  input?(pending: boolean): void
  error(message: string): void
  save(): void
  history(redo: boolean): void
}

/** Input/selection belongs to ProseMirror; persistence and history remain in the Office file owner. */
export function createWordEditor(element: HTMLElement, inspection: WordInspection, options: WordKernelOptions) {
  let editable = true
  const plugins = [keymap({
    'Mod-s': () => { options.save(); return true },
    'Mod-z': () => { options.history(false); return true }, 'Mod-y': () => { options.history(true); return true }, 'Shift-Mod-z': () => { options.history(true); return true },
    'Mod-b': toggleMark(wordEditorSchema.marks.bold), 'Mod-i': toggleMark(wordEditorSchema.marks.italic), 'Mod-u': toggleMark(wordEditorSchema.marks.underline),
    'Shift-Enter': splitBlock, Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1),
  }), keymap(baseKeymap), tableEditing()]
  const state = (document: ReturnType<typeof toWordEditorDocument>, selection?: Selection) => EditorState.create({ schema: wordEditorSchema, doc: document, selection, plugins })
  const view = new EditorView(element, {
    state: state(toWordEditorDocument(inspection)), editable: () => editable,
    attributes: { class: 'office-word-prosemirror', 'aria-label': 'Word 正文输入区', 'data-word-kernel': 'prosemirror' },
    clipboardTextParser(text, context) {
      const style = context.parent.type === wordEditorSchema.nodes.paragraph ? context.parent.attrs.style : {}
      const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map(line => wordEditorSchema.nodes.paragraph.create({ style }, line ? wordEditorSchema.text(line, context.marks()) : undefined))
      return new Slice(Fragment.from(paragraphs), 1, 1)
    },
    handleDOMEvents: {
      compositionstart: () => { options.composition(true); return false },
      compositionend: () => { options.composition(false); return false },
      input: () => { options.input?.(true); queueMicrotask(() => options.input?.(false)); return false },
    },
    dispatchTransaction(transaction) {
      if (transaction.docChanged && !editable) return
      try {
        const edits = wordTransactionEdits(transaction)
        let next = view.state.apply(transaction)
        const indexed = next.tr
        for (const paragraph of wordParagraphs(next.doc)) if (paragraph.node.attrs.index !== paragraph.index) indexed.setNodeMarkup(paragraph.pos, undefined, { ...paragraph.node.attrs, index: paragraph.index })
        if (indexed.docChanged) next = next.apply(indexed)
        view.updateState(next)
        if (edits.length) options.changed(edits)
        options.selection(next)
        if (edits.some(edit => edit.type === 'textStyle' || edit.type === 'paragraphStyle' || edit.type === 'replaceRange' && (edit.paragraphs.length > 1 || edit.start.paragraph !== edit.end.paragraph))) queueMicrotask(() => { if (!view.composing) options.save() })
      } catch (error) {
        view.updateState(view.state)
        options.error(error instanceof Error ? error.message : String(error))
      }
    },
  })
  return {
    view,
    setEditable(value: boolean) { editable = value; view.setProps({ editable: () => editable }) },
    reset(value: WordInspection) {
      const document = toWordEditorDocument(value)
      let selection: Selection
      try { selection = view.state.selection.getBookmark().resolve(document) }
      catch { selection = Selection.near(document.resolve(Math.min(document.content.size, view.state.selection.head))) }
      view.updateState(state(document, selection)); options.selection(view.state)
    },
    focusParagraph(index: number, offset = 0) {
      const paragraph = wordParagraphs(view.state.doc)[index]
      if (!paragraph) return
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paragraph.from + Math.min(offset, paragraph.node.content.size))))
      view.focus()
    },
    destroy() { view.destroy() },
  }
}
