import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { documentEditorSchema as schema } from '../../src/renderer/document/editorSchema'
import { createDocumentInputRuleResult, matchDocumentInputRule, recognizeDocumentInputMarker } from '../../src/renderer/document/documentInputRules'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'

const makeState = (prefix: string, suffix = '') => {
  const paragraph = schema.nodes.paragraph.create({ id: 'block-1', data: { type: 'paragraph' } }, prefix + suffix ? schema.text(prefix + suffix) : undefined)
  const doc = schema.nodes.doc.create(null, paragraph)
  return EditorState.create({ doc, selection: TextSelection.create(doc, prefix.length + 1) })
}

describe('M16 document input rules', () => {
  it.each([
    ['#', ' ', 'heading', 'heading'], ['-',' ', 'bullet-list', 'list'], ['1.',' ', 'ordered-list', 'list'], ['>',' ', 'quote', 'quote'],
    ['``','`', 'code', 'code'], ['--','-', 'divider', 'divider'],
  ] as const)('converts %s%s into %s', (prefix, typed, kind, blockType) => {
    const state = makeState(prefix)
    const match = matchDocumentInputRule(state, state.selection.from, state.selection.to, typed)
    expect(match?.kind).toBe(kind)
    const result = createDocumentInputRuleResult(state, match!, () => 'new-id')
    expect(result.kind).toBe('transaction')
    if (result.kind !== 'transaction') return
    const content = fromEditorDocument(result.transaction.doc)
    expect(content.blocks[0]).toMatchObject({ id: 'block-1', type: blockType })
    if (kind === 'heading') expect(content.blocks[0]).toMatchObject({ level: 1 })
    if (kind === 'ordered-list') expect(content.blocks[0]).toMatchObject({ ordered: true, items: [{ id: 'new-id', content: { inlines: [] } }] })
    if (kind === 'bullet-list') expect(content.blocks[0]).toMatchObject({ ordered: false })
    if (kind === 'divider') expect(content.blocks[1]).toMatchObject({ type: 'paragraph' })
  })

  it('recognizes all heading levels but no seventh-level heading', () => {
    expect(recognizeDocumentInputMarker('###### ')).toEqual({ kind: 'heading', level: 6 })
    expect(recognizeDocumentInputMarker('####### ')).toBeNull()
  })

  it('preserves $$ until a nonempty math draft is confirmed', () => {
    const state = makeState('$')
    const match = matchDocumentInputRule(state, 2, 2, '$')!
    const result = createDocumentInputRuleResult(state, match, () => 'formula-1')
    expect(result.kind).toBe('formula-draft')
    if (result.kind !== 'formula-draft') return
    expect(result.draft).toEqual({ from: 0, to: 4, display: true, latex: '', formulaId: 'formula-1' })
    expect(fromEditorDocument(result.transaction.doc).blocks[0]).toMatchObject({ type: 'paragraph', content: { inlines: [{ text: '$$' }] } })
  })

  it('ignores IME, marked text, suffix text, and non-leading marker text', () => {
    const state = makeState('#')
    expect(matchDocumentInputRule(state, 2, 2, ' ', true)).toBeNull()
    expect(matchDocumentInputRule(state, 1, 2, ' ')).toBeNull()
    expect(matchDocumentInputRule(makeState('#', 'tail'), 2, 2, ' ')).toBeNull()
    expect(matchDocumentInputRule(makeState('x#'), 3, 3, ' ')).toBeNull()
  })

  it('ignores code blocks and inline code marks', () => {
    const node = schema.nodes.code_block.create({ id: 'code-1', data: { type: 'code', code: '#' } }, schema.text('#'))
    const doc = schema.nodes.doc.create(null, node)
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) })
    expect(matchDocumentInputRule(state, 2, 2, ' ')).toBeNull()
    const marked = schema.nodes.paragraph.create({ id: 'block-1', data: { type: 'paragraph' } }, schema.text('#', [schema.marks.code.create()]))
    const markedDoc = schema.nodes.doc.create(null, marked)
    expect(matchDocumentInputRule(EditorState.create({ doc: markedDoc, selection: TextSelection.create(markedDoc, 2) }), 2, 2, ' ')).toBeNull()
  })
})
