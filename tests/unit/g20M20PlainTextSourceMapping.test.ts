import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { applyEditorChanges, editorText, reconcileEditorText } from '../../src/renderer/documentFiles/plainTextSourceMapping'

describe('M20 plain text source mapping', () => {
  it('keeps the BOM, CRLF and final newline after a local edit', () => {
    const source = '\ufeffone\r\ntwo\r\n'
    const state = EditorState.create({ doc: source })
    const change = state.update({ changes: { from: 1, to: 4, insert: 'ONE' } })
    expect(applyEditorChanges(source, change.changes)).toBe('\ufeffONE\r\ntwo\r\n')
  })

  it('preserves untouched mixed separators and uses the local separator for inserted lines', () => {
    const source = 'first\r\nsecond\nthird\rrest'
    const state = EditorState.create({ doc: source })
    expect(editorText(source)).toBe('first\nsecond\nthird\nrest')
    const change = state.update({ changes: { from: 6, to: 12, insert: 'SECOND\nagain' } })
    expect(applyEditorChanges(source, change.changes)).toBe('first\r\nSECOND\nagain\nthird\rrest')
    expect(reconcileEditorText(source, 'first\nsecond\nTHIRD\nrest')).toBe('first\r\nsecond\nTHIRD\rrest')
  })

  it('applies simultaneous changes against the same original source', () => {
    const source = 'a\r\nb\nc\r\n'
    const state = EditorState.create({ doc: source })
    const change = state.update({ changes: [{ from: 0, to: 1, insert: 'A' }, { from: 4, to: 5, insert: 'C' }] })
    expect(applyEditorChanges(source, change.changes)).toBe('A\r\nb\nC\r\n')
  })
})
