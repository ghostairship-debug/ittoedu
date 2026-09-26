import { describe, expect, it } from 'vitest'
import { changeFlowTableStructure } from '../../src/core/tools/flowTableContentOperations'
import { changeDocumentTable, documentTableOperation, type DocumentTableSelection } from '../../src/renderer/document/documentTableCommands'
import type { FlowTableBlock } from '../../src/shared/courseProjectTypes'

const empty = () => ({ inlines: [] })
const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const source = (): FlowTableBlock => ({
  id: 'table-1', type: 'table', caption: text('Caption'),
  columns: [{ id: 'a', header: text('A') }, { id: 'b', header: text('B') }, { id: 'c', header: text('C') }],
  rows: [
    { id: 'r1', cells: { a: text('first'), b: { inlines: [{ type: 'math', formulaId: 'f1', latex: 'x^2', accessibleText: 'x squared' }] }, c: empty() } },
    { id: 'r2', cells: { a: text('second'), b: text('third'), c: empty() } },
  ],
})
const at = (rowId: string, columnId: string): DocumentTableSelection => ({ anchor: { rowId, columnId }, head: { rowId, columnId } })

describe('M16 canonical document table commands', () => {
  it('inserts on all four explicit sides and preserves old cells, rich inlines and identities', () => {
    const table = source()
    const above = changeDocumentTable(table, at('r1', 'a'), 'insert-row-above', () => 'above')
    expect(above.rows.map(row => row.id)).toEqual(['row-above', 'r1', 'r2'])
    const below = changeDocumentTable(table, at('r1', 'a'), 'insert-row-below', () => 'below')
    expect(below.rows.map(row => row.id)).toEqual(['r1', 'row-below', 'r2'])
    const left = changeDocumentTable(table, at('r1', 'a'), 'insert-column-left', () => 'left')
    expect(left.columns.map(column => column.id)).toEqual(['col-left', 'a', 'b', 'c'])
    const right = changeDocumentTable(table, at('r1', 'a'), 'insert-column-right', () => 'right')
    expect(right.columns.map(column => column.id)).toEqual(['a', 'col-right', 'b', 'c'])
    for (const result of [above, below, left, right]) {
      expect(result.rows.find(row => row.id === 'r1')?.cells.b).toEqual(table.rows[0]!.cells.b)
      expect(result.caption).toEqual(table.caption)
    }
    expect(table.rows.map(row => row.id)).toEqual(['r1', 'r2'])
    expect(table.columns.map(column => column.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps append behavior for the existing tool contract and rejects stale or ambiguous references', () => {
    const table = source()
    expect(changeFlowTableStructure(table, { kind: 'insert-row' }, () => 'last').rows.at(-1)?.id).toBe('row-last')
    expect(changeFlowTableStructure(table, { kind: 'insert-column' }, () => 'last').columns.at(-1)?.id).toBe('col-last')
    expect(() => changeFlowTableStructure(table, { kind: 'insert-row', beforeId: 'missing' })).toThrow('表格行已失效')
    expect(() => changeFlowTableStructure(table, { kind: 'insert-column', afterId: 'missing' })).toThrow('表格列已失效')
    expect(() => changeFlowTableStructure(table, { kind: 'insert-row', beforeId: 'r1', afterId: 'r2' })).toThrow('只能指定一个插入位置')
    expect(() => documentTableOperation(table, at('missing', 'a'), 'insert-row-above')).toThrow('表格选区已失效')
  })

  it('merges rectangular selection in stable table order, retains text and formulas, and splits without loss', () => {
    const table = source()
    const selection: DocumentTableSelection = { anchor: { rowId: 'r2', columnId: 'b' }, head: { rowId: 'r1', columnId: 'a' } }
    const merged = changeDocumentTable(table, selection, 'merge-cells')
    expect(merged.merges).toEqual([{ rowIds: ['r1', 'r2'], columnIds: ['a', 'b'] }])
    const content = merged.rows[0]!.cells.a.inlines
    expect(content.some(atom => atom.type === 'math' && atom.formulaId === 'f1' && atom.latex === 'x^2')).toBe(true)
    expect(content.filter(atom => atom.type === 'text').map(atom => atom.text).join('')).toBe('first\n\nsecond\nthird')
    expect(merged.rows[0]!.cells.b.inlines).toEqual([])
    expect(merged.rows[1]!.cells.a.inlines).toEqual([])
    const split = changeDocumentTable(merged, at('r2', 'b'), 'split-cell')
    expect(split.merges).toEqual([])
    expect(split.rows[0]!.cells.a.inlines).toEqual(content)
    expect(split.rows[0]!.cells.b.inlines).toEqual([])
    expect(table.rows[0]!.cells.b.inlines[0]).toMatchObject({ type: 'math', formulaId: 'f1' })
  })

  it('rejects merge damage and returns a single immutable replacement for undo', () => {
    const table = source()
    const merged = changeDocumentTable(table, { anchor: { rowId: 'r1', columnId: 'a' }, head: { rowId: 'r1', columnId: 'b' } }, 'merge-cells')
    expect(() => changeDocumentTable(merged, at('r1', 'a'), 'insert-column-right')).toThrow()
    expect(() => changeDocumentTable(merged, at('r1', 'a'), 'delete-column')).toThrow()
    expect(merged.columns.map(column => column.id)).toEqual(['a', 'b', 'c'])
    const deleted = changeDocumentTable(table, at('r1', 'c'), 'delete-column')
    expect(deleted.columns.map(column => column.id)).toEqual(['a', 'b'])
    expect(table.columns.map(column => column.id)).toEqual(['a', 'b', 'c'])
    expect(() => changeDocumentTable(table, at('r1', 'a'), 'merge-cells')).toThrow()
  })
})
