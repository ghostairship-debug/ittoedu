import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { resolveDocumentTableEditorTarget } from '../../src/renderer/document/documentTableEditorPort'
import { restoreDocumentTableSelection } from '../../src/renderer/document/documentTableSelectionRestore'
import type { DocumentContent } from '../../src/shared/document/content'
import type { FlowTableBlock } from '../../src/shared/courseProjectTypes'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const table = (): FlowTableBlock => ({
  id: 'table-1', type: 'table', caption: text('Caption'),
  columns: ['a', 'b', 'c'].map(id => ({ id, header: text(id) })),
  rows: ['r1', 'r2', 'r3'].map(id => ({ id, cells: Object.fromEntries(['a', 'b', 'c'].map(column => [column, text(`${id}-${column}`)])) })),
})
const content = (value: FlowTableBlock, nested = false): DocumentContent => ({ blocks: nested
  ? [{ id: 'section-1', type: 'section', title: text('Section'), collapsedByDefault: false, blocks: [{ id: 'intro', type: 'paragraph', content: text('Intro') }, value] }]
  : [{ id: 'intro', type: 'paragraph', content: text('Intro') }, value] })
const key = (row: string, column: string) => `cell:${JSON.stringify([row, column])}`
function position(doc: ReturnType<typeof toEditorDocument>, wanted: string): number {
  let found = -1
  doc.descendants((node, at) => { if (found < 0 && node.type.spec.tableRole && node.firstChild?.attrs.key === wanted) found = at; return found < 0 })
  if (found < 0) throw new Error(`Missing ${wanted}`)
  return found
}
function restore(before: FlowTableBlock, after: FlowTableBlock, anchor: string, head = anchor, nested = false, cells = false) {
  const original = toEditorDocument(content(before, nested))
  const selection = cells ? CellSelection.create(original, position(original, anchor), position(original, head))
    : TextSelection.create(original, position(original, anchor) + 2)
  const state = EditorState.create({ doc: original, selection })
  const target = resolveDocumentTableEditorTarget(state)!
  const next = content(after, nested)
  const replacement = toEditorDocument(next)
  const tr = state.tr.replaceWith(0, original.content.size, replacement.content)
  const result = restoreDocumentTableSelection(tr, { ...target, previousTable: before, wasCellSelection: cells }, next)
  const selected = EditorState.create({ doc: result.doc, selection: result.selection })
  return { selected, target: resolveDocumentTableEditorTarget(selected), result }
}

describe('M16 table selection restoration after one document replacement', () => {
  it('restores a surviving cell by stable identity and never lands in the caption', () => {
    const before = table()
    const after = { ...before, caption: text('A longer caption changes all positions'), rows: [before.rows[2]!, before.rows[0]!, before.rows[1]!] }
    const { selected, target, result } = restore(before, after, key('r2', 'b'))
    expect(selected.selection).toBeInstanceOf(TextSelection)
    expect(target?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r2', columnId: 'b' } })
    expect(fromEditorDocument(result.doc)).toEqual(content(after))
  })

  it('moves a deleted row or column to its closest surviving old neighbor', () => {
    const before = table()
    const rowsGone = { ...before, rows: [before.rows[0]!, before.rows[2]!] }
    expect(restore(before, rowsGone, key('r2', 'b')).target?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r1', columnId: 'b' } })
    const columnsGone = { ...before, columns: [before.columns[0]!, before.columns[2]!], rows: before.rows.map(row => ({ ...row, cells: { a: row.cells.a!, c: row.cells.c! } })) }
    expect(restore(before, columnsGone, key('r3', 'b')).target?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r3', columnId: 'a' } })
    expect(restore(before, columnsGone, 'column:b').target?.anchor).toEqual({ kind: 'header', columnId: 'a' })
  })

  it('preserves a rectangular CellSelection and collapses when both ends resolve to one cell', () => {
    const before = table()
    const next = { ...before, rows: [before.rows[0]!, before.rows[2]!] }
    const rectangle = restore(before, next, key('r1', 'a'), key('r3', 'c'), false, true)
    expect(rectangle.selected.selection).toBeInstanceOf(CellSelection)
    expect(rectangle.target).toMatchObject({ anchor: { cell: { rowId: 'r1', columnId: 'a' } }, head: { cell: { rowId: 'r3', columnId: 'c' } } })
    const collapsed = restore(before, { ...before, rows: [before.rows[0]!] }, key('r2', 'b'), key('r3', 'b'), false, true)
    expect(collapsed.selected.selection).toBeInstanceOf(CellSelection)
    expect(collapsed.target?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r1', columnId: 'b' } })
  })

  it('locates a table inside a section, and uses the table node if its rows disappear', () => {
    const before = table()
    const nested = restore(before, { ...before, rows: [before.rows[0]!, before.rows[2]!] }, key('r2', 'c'), key('r2', 'c'), true)
    expect(nested.target?.anchor).toEqual({ kind: 'cell', cell: { rowId: 'r1', columnId: 'c' } })
    const noRows = restore(before, { ...before, rows: [] }, key('r2', 'c'), key('r2', 'c'), true)
    expect(noRows.target?.anchor).toEqual({ kind: 'header', columnId: 'c' })
    const doc = noRows.result.doc
    expect(noRows.selected.selection).not.toBeInstanceOf(NodeSelection)
    expect(doc.textContent).toContain('Caption')
  })
})
