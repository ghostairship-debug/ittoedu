import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { changeDocumentTableFromEditorState, resolveDocumentTableEditorTarget } from '../../src/renderer/document/documentTableEditorPort'
import { fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import type { DocumentContent } from '../../src/shared/document/content'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const content = (): DocumentContent => ({ blocks: [
  { id: 'before', type: 'paragraph', content: text('before') },
  { id: 'table-1', type: 'table', caption: text('caption'), columns: [
    { id: 'a', header: text('Alpha') }, { id: 'b', header: text('Beta') },
  ], rows: [
    { id: 'r1', cells: { a: text('first'), b: { inlines: [{ type: 'math', formulaId: 'math-1', latex: 'x^2', accessibleText: 'x squared' }] } } },
    { id: 'r2', cells: { a: text('second'), b: text('third') } },
  ] },
  { id: 'after', type: 'paragraph', content: text('after') },
] })

function slotPosition(doc: ReturnType<typeof toEditorDocument>, key: string) {
  let found = -1
  doc.descendants((node, position) => {
    if (found < 0 && node.type.spec.tableRole && node.firstChild?.attrs.key === key) found = position
    return found < 0
  })
  if (found < 0) throw new Error(`missing ${key}`)
  return found
}
const cell = (rowId: string, columnId: string) => `cell:${JSON.stringify([rowId, columnId])}`
const stateAt = (source: DocumentContent, anchor: string, head = anchor) => {
  const doc = toEditorDocument(source)
  return EditorState.create({ doc, selection: CellSelection.create(doc, slotPosition(doc, anchor), slotPosition(doc, head)) })
}
const table = (source: DocumentContent) => source.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>

describe('M16 table editor port', () => {
  it('reads current PM slots, resolves stable identities, and emits one deterministic undoable document', () => {
    const start = stateAt(content(), cell('r2', 'b'), cell('r1', 'a'))
    expect(resolveDocumentTableEditorTarget(start)).toMatchObject({ tableId: 'table-1', anchor: { cell: { rowId: 'r2', columnId: 'b' } }, head: { cell: { rowId: 'r1', columnId: 'a' } } })
    const edited = start.apply(start.tr.insertText(' edited', slotPosition(start.doc, cell('r1', 'a')) + 2 + 5))
    const merged = changeDocumentTableFromEditorState(edited, 'merge-cells')
    expect(table(merged).rows[0]!.cells.a.inlines[0]).toEqual({ type: 'text', text: 'first edited\n' })
    expect(table(merged).rows[0]!.cells.a.inlines).toContainEqual({ type: 'math', formulaId: 'math-1', latex: 'x^2', accessibleText: 'x squared' })
    expect(table(merged).merges).toEqual([{ rowIds: ['r1', 'r2'], columnIds: ['a', 'b'] }])
    expect(merged.blocks[0]).toEqual(content().blocks[0])
    expect(merged.blocks[2]).toEqual(content().blocks[2])
    const replay = changeDocumentTableFromEditorState(edited, 'merge-cells')
    expect(replay).toEqual(merged)
    const undone = fromEditorDocument(edited.doc)
    expect(table(undone).merges).toBeUndefined()
    expect(table(changeDocumentTableFromEditorState(stateAt(undone, cell('r2', 'b'), cell('r1', 'a')), 'merge-cells')).merges).toEqual(table(merged).merges)
  })

  it('uses the first visible row as ordinary cells when header is disabled and retains title text', () => {
    const original = content()
    const header = stateAt(original, 'column:a')
    expect(resolveDocumentTableEditorTarget(header)?.anchor).toEqual({ kind: 'header', columnId: 'a' })
    const disabled = changeDocumentTableFromEditorState(header, 'toggle-header')
    expect(table(disabled).headerEnabled).toBe(false)
    expect(table(disabled).columns.map(column => column.header)).toEqual(table(original).columns.map(column => column.header))
    expect(toEditorDocument(disabled).textContent).toContain('AlphaBeta')
    const enabled = changeDocumentTableFromEditorState(stateAt(disabled, 'column:a'), 'toggle-header')
    expect(table(enabled).headerEnabled).not.toBe(false)
    expect(enabled).toEqual(original)
    const inserted = changeDocumentTableFromEditorState(stateAt(disabled, 'column:a'), 'insert-column-right', () => 'new')
    expect(table(inserted).columns.map(column => column.id)).toEqual(['a', 'col-new', 'b'])
    expect(table(inserted).columns[0]!.header).toEqual(text('Alpha'))
    expect(() => changeDocumentTableFromEditorState(stateAt(disabled, 'column:a'), 'insert-row-above')).toThrow('请选择表格数据行')
  })

  it('resolves a whole-table node selection without inventing a cell or row identity', () => {
    const original = content()
    const doc = toEditorDocument(original)
    let tablePosition = -1
    doc.descendants((node, position) => { if (node.attrs.id === 'table-1') tablePosition = position })
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, tablePosition) })
    expect(resolveDocumentTableEditorTarget(state)).toEqual({ tableId: 'table-1', tablePosition, anchor: null, head: null })
    const disabled = changeDocumentTableFromEditorState(state, 'toggle-header')
    expect(table(disabled).headerEnabled).toBe(false)
    expect(table(disabled).columns.map(column => column.header)).toEqual(table(original).columns.map(column => column.header))
    expect(() => changeDocumentTableFromEditorState(state, 'insert-row-above')).toThrow('请选择表格单元格')
  })

  it('handles caret in a cell and rejects a selection outside a table', () => {
    const doc = toEditorDocument(content())
    const position = slotPosition(doc, cell('r1', 'a')) + 2
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, position) })
    expect(resolveDocumentTableEditorTarget(state)?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r1', columnId: 'a' } })
    const above = changeDocumentTableFromEditorState(state, 'insert-row-above', () => 'new')
    expect(table(above).rows.map(row => row.id)).toEqual(['row-new', 'r1', 'r2'])
    const outside = EditorState.create({ doc, selection: TextSelection.create(doc, 2) })
    expect(() => changeDocumentTableFromEditorState(outside, 'delete-row')).toThrow('当前选区不在表格中')
  })

  it('routes every structural command through canonical table data', () => {
    const original = content()
    const at = (source: DocumentContent, key = cell('r1', 'a')) => stateAt(source, key)
    expect(table(changeDocumentTableFromEditorState(at(original), 'insert-row-below', () => 'below')).rows.map(row => row.id)).toEqual(['r1', 'row-below', 'r2'])
    expect(table(changeDocumentTableFromEditorState(at(original), 'insert-column-left', () => 'left')).columns.map(column => column.id)).toEqual(['col-left', 'a', 'b'])
    expect(table(changeDocumentTableFromEditorState(at(original), 'insert-column-right', () => 'right')).columns.map(column => column.id)).toEqual(['a', 'col-right', 'b'])
    expect(table(changeDocumentTableFromEditorState(at(original), 'delete-row')).rows.map(row => row.id)).toEqual(['r2'])
    expect(table(changeDocumentTableFromEditorState(at(original), 'delete-column')).columns.map(column => column.id)).toEqual(['b'])
    const merged = changeDocumentTableFromEditorState(stateAt(original, cell('r1', 'a'), cell('r2', 'b')), 'merge-cells')
    const split = changeDocumentTableFromEditorState(at(merged), 'split-cell')
    expect(table(split).merges).toEqual([])
    expect(table(split).rows[0]!.cells.a.inlines).toContainEqual({ type: 'math', formulaId: 'math-1', latex: 'x^2', accessibleText: 'x squared' })
    expect(original).toEqual(content())
  })
})
