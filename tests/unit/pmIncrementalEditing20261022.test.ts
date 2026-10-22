import { describe, expect, it, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { DecorationSet } from 'prosemirror-view'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { documentEditorSchema as schema } from '../../src/renderer/document/editorSchema'
import { editorTextChangeBlockIds } from '../../src/renderer/document/documentTransactionChanges'
import { documentInlineDefaultsPlugin } from '../../src/renderer/document/SharedDocumentEditor'

const paragraph = (id: string, text: string) => ({ id, type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text }] } })
function state() { return EditorState.create({ doc: toEditorDocument({ blocks: [paragraph('first', 'First'), paragraph('second', 'Second')] }) }) }

describe('local PM changes retain their real scope', () => {
  it('recognizes plain text and mark edits while retaining structural and inline-atom repair boundaries', () => {
    const initial = state()
    expect(editorTextChangeBlockIds([initial.tr.insertText('!', 2)])).toEqual(['first'])
    expect(editorTextChangeBlockIds([initial.tr.addMark(1, 4, schema.marks.style.create({ value: { bold: true } }))])).toEqual(['first'])
    expect(editorTextChangeBlockIds([initial.tr.split(3)])).toBeUndefined()
    const formula = schema.nodes.math.create({ data: { type: 'math', formulaId: 'math', latex: 'x', accessibleText: 'x' } })
    const withFormula = initial.apply(initial.tr.insert(2, formula))
    expect(editorTextChangeBlockIds([withFormula.tr.delete(2, 3)])).toBeUndefined()
  })

  it('does not rebuild presentation defaults for a caret and rebuilds only the edited textblock', () => {
    const defaults = vi.fn((_id: string) => ({ fontSize: 24, color: '#123456' }))
    const plugin = documentInlineDefaultsPlugin(() => defaults)
    let current = EditorState.create({ doc: state().doc, plugins: [plugin] })
    defaults.mockClear()
    current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 3)))
    expect(defaults).not.toHaveBeenCalled()
    current = current.apply(current.tr.insertText('!', 2))
    expect(defaults.mock.calls.map(call => call[0])).toEqual(['first'])
    const decorations = plugin.props.decorations!.call(plugin, current)!
    expect((decorations as DecorationSet).find().length).toBe(2)
  })
})
