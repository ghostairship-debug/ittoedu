import { describe, expect, it, vi } from 'vitest'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { editorPositionToPoint, fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import type { DocumentContent } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'


const content: DocumentContent = { blocks: [
  { id: 'paragraph', type: 'paragraph', content: { inlines: [
    { type: 'text', text: '中文😀' },
    { type: 'math', formulaId: 'formula', latex: 'x^2', accessibleText: 'x 的平方' },
    { type: 'text', text: '末尾' },
  ] } },
  { id: 'list', type: 'list', ordered: false, items: [{ id: 'item-1', content: { inlines: [{ type: 'text', text: '列表项' }] } }] },
  { id: 'table', type: 'table', columns: [
    { id: 'column-1', header: { inlines: [{ type: 'text', text: '表头一' }] } },
    { id: 'column-2', header: { inlines: [{ type: 'text', text: '表头二' }] } },
  ], rows: [
    { id: 'row-1', cells: { 'column-1': { inlines: [{ type: 'text', text: '单元格一' }] }, 'column-2': { inlines: [{ type: 'text', text: '单元格二' }] } } },
    { id: 'row-2', cells: { 'column-1': { inlines: [{ type: 'text', text: '第二行一' }] }, 'column-2': { inlines: [{ type: 'text', text: '第二行二' }] } } },
  ] },
] }

function mount(selection: (value: unknown) => void = () => {}) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() },
    revision: 'revision-1',
    change: vi.fn(),
    diagnostic: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selection,
  })
  return { editor, cleanup: () => { editor.destroy(); element.remove() } }
}

describe('document selection mapping', () => {
  it('maps Unicode text, a math atom, list items and table slots structurally', () => {
    const document = toEditorDocument(content)

    expect(editorPositionToPoint(document, 1)).toMatchObject({ blockId: 'paragraph', slot: { kind: 'field', field: 'content' }, offset: 0 })
    // ProseMirror uses UTF-16 positions, while a document point counts code points.
    expect(editorPositionToPoint(document, 6)).toMatchObject({ blockId: 'paragraph', offset: 4 })
    // The outer math atom consumes one document offset, regardless of LaTeX length.
    expect(editorPositionToPoint(document, 7)).toMatchObject({ blockId: 'paragraph', offset: 5 })

    const listPosition = (() => {
      let result: number | undefined
      document.descendants((node, position) => { if (node.attrs.key === 'item:item-1') result = position + 1 })
      return result
    })()
    expect(listPosition).toBeDefined()
    expect(editorPositionToPoint(document, listPosition!)).toMatchObject({ blockId: 'list', slot: { kind: 'item', itemId: 'item-1' }, offset: 0 })

    const cellPosition = (() => {
      let result: number | undefined
      document.descendants((node, position) => { if (node.type.name === 'table_cell' && result === undefined) result = position })
      return result
    })()
    expect(cellPosition).toBeDefined()
    expect(editorPositionToPoint(document, cellPosition! + 2)).toMatchObject({ blockId: 'table', slot: { kind: 'cell', rowId: 'row-1', columnId: 'column-1' } })
    expect(fromEditorDocument(document)).toEqual(content)
  })

  it('freezes the revision carried by layout text and object selections', () => {
    const selections: unknown[] = []
    const { editor, cleanup } = mount(selection => selections.push(selection))
    try {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6)))
      expect(selections.at(-1)).toEqual(expect.objectContaining({
        revision: 'revision-1',
        kind: 'text',
        anchor: expect.objectContaining({ blockId: 'paragraph', offset: 0 }),
        head: expect.objectContaining({ blockId: 'paragraph', offset: 4 }),
      }))

      editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, 0)))
      expect(selections.at(-1)).toEqual({ revision: 'revision-1', kind: 'object', blockId: 'paragraph' })
    } finally { cleanup() }
  })

  it('emits a structured table selection with stable row and column identities', () => {
    const selections: unknown[] = []
    const { editor, cleanup } = mount(selection => selections.push(selection))
    try {
      const cells: number[] = []
      editor.view.state.doc.descendants((node, position) => { if (node.type.name === 'table_cell') cells.push(position) })
      editor.view.dispatch(editor.view.state.tr.setSelection(CellSelection.create(editor.view.state.doc, cells[0]!, cells[3]!)))
      expect(selections.at(-1)).toEqual({
        revision: 'revision-1', kind: 'cells', tableId: 'table',
        anchor: { rowId: 'row-1', columnId: 'column-1' },
        head: { rowId: 'row-2', columnId: 'column-2' },
      })
    } finally { cleanup() }
  })

  it('keeps selected cells selected when the document changes around them (after an element card edit, M15)', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const options = { document: { content, resources: emptyDocumentResources() }, revision: 'revision-1', change: vi.fn(), diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(), selection: vi.fn() }
    const editor = createLayoutEditor(element, options)
    try {
      const cells: number[] = []
      editor.view.state.doc.descendants((node, position) => { if (node.type.name === 'table_cell') cells.push(position) })
      editor.view.dispatch(editor.view.state.tr.setSelection(CellSelection.create(editor.view.state.doc, cells[0]!, cells[1]!)))
      // The table gets another row from outside the editor.
      const table = content.blocks[2] as Extract<DocumentContent['blocks'][number], { type: 'table' }>
      const next: DocumentContent = { blocks: [...content.blocks.slice(0, 2),
        { ...table, rows: [...table.rows, { id: 'row-3', cells: { 'column-1': { inlines: [] }, 'column-2': { inlines: [] } } }] }] }
      editor.update({ ...options, document: { content: next, resources: emptyDocumentResources() }, revision: 'revision-2' })
      expect(fromEditorDocument(editor.view.state.doc).blocks[2]).toMatchObject({ rows: [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }] })
      expect(editor.readSelection()).toEqual({ revision: 'revision-2', kind: 'cells', tableId: 'table',
        anchor: { rowId: 'row-1', columnId: 'column-1' }, head: { rowId: 'row-1', columnId: 'column-2' } })

      // A selected object whose data changed from outside stays selected too; one that is gone is not reselected.
      const formula = { id: 'formula-block', type: 'formula' as const, formulaId: 'f', latex: 'x', accessibleText: 'x' }
      editor.update({ ...options, document: { content: { blocks: [...next.blocks, formula] }, resources: emptyDocumentResources() }, revision: 'revision-3' })
      editor.view.state.doc.descendants((node, position) => { if (node.attrs.id === 'formula-block') editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, position))) })
      editor.update({ ...options, document: { content: { blocks: [...next.blocks, { ...formula, latex: 'y', accessibleText: 'y' }] }, resources: emptyDocumentResources() }, revision: 'revision-4' })
      expect(editor.readSelection()).toEqual({ revision: 'revision-4', kind: 'object', blockId: 'formula-block' })
      editor.update({ ...options, document: { content: next, resources: emptyDocumentResources() }, revision: 'revision-5' })
      expect(editor.readSelection()).not.toMatchObject({ kind: 'object' })
    } finally { editor.destroy(); element.remove() }
  })

})
