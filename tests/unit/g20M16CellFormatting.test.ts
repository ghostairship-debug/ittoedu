import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { documentEditorSchema } from '../../src/renderer/document/editorSchema'
import { readDocumentFormatting } from '../../src/renderer/document/SharedDocumentEditor'
import { documentContentSchema } from '../../src/shared/document/content'

describe('Flow table cell formatting selection', () => {
  it('reads style from every selected cell and ignores cells outside the rectangle', () => {
    const doc = toEditorDocument(documentContentSchema.parse({ blocks: [{
      id: 'table-1', type: 'table',
      columns: [
        { id: 'a', header: { inlines: [{ type: 'text', text: '甲' }] } },
        { id: 'b', header: { inlines: [{ type: 'text', text: '乙' }] } },
        { id: 'c', header: { inlines: [{ type: 'text', text: '丙' }] } },
      ],
      rows: [{ id: 'row-1', cells: {
        a: { inlines: [{ type: 'text', text: '一', style: { bold: true, color: '#ff0000' } }] },
        b: { inlines: [{ type: 'text', text: '二', style: { color: '#0000ff' } }] },
        c: { inlines: [{ type: 'text', text: '三', style: { bold: true, color: '#ff0000', fontSize: 24 } }] },
      } }],
    }] }))
    const cells: number[] = []
    doc.descendants((node, position) => { if (node.type.name === 'table_cell') cells.push(position) })
    expect(cells).toHaveLength(3)
    const selection = CellSelection.create(doc, cells[0], cells[1])
    expect(selection.ranges).toHaveLength(2)
    const state = EditorState.create({ schema: documentEditorSchema, doc, selection })
    expect(readDocumentFormatting(state).flags.bold).toBe('mixed')
    expect(readDocumentFormatting(state).fontSize).toBeUndefined()
  })
})
