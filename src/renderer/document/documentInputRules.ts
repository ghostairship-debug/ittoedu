import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { documentEditorSchema as schema } from './editorSchema'

export type DocumentInputRuleKind = 'heading' | 'bullet-list' | 'ordered-list' | 'quote' | 'code' | 'divider' | 'formula-draft'
export interface DocumentInputRuleMatch { kind: DocumentInputRuleKind; level?: number; from: number; to: number; blockId: string }
export interface DocumentFormulaDraftRequest { from: number; to: number; display: true; latex: ''; formulaId: string }
export type DocumentInputRuleResult = { kind: 'transaction'; transaction: Transaction } | { kind: 'formula-draft'; transaction: Transaction; draft: DocumentFormulaDraftRequest }

/** Recognizes only a complete marker in an otherwise empty top-level paragraph. */
export function recognizeDocumentInputMarker(value: string): Pick<DocumentInputRuleMatch, 'kind' | 'level'> | null {
  if (/^#{1,6} $/.test(value)) return { kind: 'heading', level: value.length - 1 }
  if (value === '- ') return { kind: 'bullet-list' }
  if (value === '1. ') return { kind: 'ordered-list' }
  if (value === '> ') return { kind: 'quote' }
  if (value === '```') return { kind: 'code' }
  if (value === '---') return { kind: 'divider' }
  if (value === '$$') return { kind: 'formula-draft' }
  return null
}

/** Call from handleTextInput before ProseMirror inserts the last marker character. */
export function matchDocumentInputRule(state: EditorState, from: number, to: number, text: string, composing = false): DocumentInputRuleMatch | null {
  if (composing || !state.selection.empty || from !== to || text.length !== 1 || from !== state.selection.from) return null
  const $from = state.doc.resolve(from)
  if ($from.depth !== 1 || $from.parent.type !== schema.nodes.paragraph || $from.parentOffset !== $from.parent.content.size) return null
  if ($from.parent.childCount > 1 || ($from.parent.childCount === 1 && (!$from.parent.firstChild?.isText || $from.parent.firstChild.marks.length))) return null
  const recognized = recognizeDocumentInputMarker($from.parent.textContent + text)
  if (!recognized) return null
  return { ...recognized, from: $from.before(), to: $from.after(), blockId: $from.parent.attrs.id }
}

/** Builds one structural edit; formula markers stay as source text until the existing math draft is confirmed. */
export function createDocumentInputRuleResult(state: EditorState, match: DocumentInputRuleMatch, createId: () => string): DocumentInputRuleResult {
  if (match.kind === 'formula-draft') {
    const tr = state.tr.insertText('$', match.to - 1)
    return { kind: 'formula-draft', transaction: tr, draft: { from: match.from, to: match.to + 1, display: true, latex: '', formulaId: createId() } }
  }
  const id = match.blockId
  const empty = { inlines: [] }
  const attrs = (data: Record<string, unknown>) => ({ id, data })
  let replacement
  let cursorOffset = 1
  switch (match.kind) {
    case 'heading': replacement = schema.nodes.heading.create(attrs({ type: 'heading', level: match.level ?? 1 })); break
    case 'bullet-list': case 'ordered-list': {
      const itemId = createId()
      replacement = schema.nodes.compound.create(attrs({ type: 'list', ordered: match.kind === 'ordered-list', items: [{ id: itemId, content: empty }] }), schema.nodes.slot.create({ key: `item:${itemId}` }))
      cursorOffset = 2
      break
    }
    case 'quote': replacement = schema.nodes.compound.create(attrs({ type: 'quote', content: empty }), schema.nodes.slot.create({ key: 'content' })); cursorOffset = 2; break
    case 'code': replacement = schema.nodes.code_block.create(attrs({ type: 'code', code: '' })); break
    case 'divider': replacement = schema.nodes.object.create(attrs({ type: 'divider' })); break
  }
  const tr = state.tr.replaceWith(match.from, match.to, replacement)
  if (match.kind === 'divider') {
    const after = match.from + replacement.nodeSize
    if (after === tr.doc.content.size || !tr.doc.nodeAt(after)?.isTextblock) {
      tr.insert(after, schema.nodes.paragraph.create({ id: createId(), data: { type: 'paragraph' } }))
    }
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  } else tr.setSelection(TextSelection.create(tr.doc, match.from + cursorOffset))
  return { kind: 'transaction', transaction: tr.scrollIntoView() }
}
