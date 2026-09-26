import { changeFlowTableStructure, type FlowTableStructureOperation } from '../../core/tools/flowTableContentOperations'
import type { FlowTableBlock } from '../../shared/courseProjectTypes'

export interface DocumentTableCell { rowId: string; columnId: string }
export interface DocumentTableSelection { anchor: DocumentTableCell; head: DocumentTableCell }
export type DocumentTableCommand = 'insert-row-above' | 'insert-row-below' | 'insert-column-left' | 'insert-column-right'
  | 'delete-row' | 'delete-column' | 'merge-cells' | 'split-cell'

export const documentTableCommandLabels: Record<DocumentTableCommand, string> = {
  'insert-row-above': '上方插入行', 'insert-row-below': '下方插入行',
  'insert-column-left': '左侧插入列', 'insert-column-right': '右侧插入列',
  'delete-row': '删除行', 'delete-column': '删除列', 'merge-cells': '合并单元格', 'split-cell': '拆分单元格',
}

/** Resolve against the canonical table identities, never against ProseMirror's rendered grid. */
export function documentTableOperation(table: FlowTableBlock, selection: DocumentTableSelection, command: DocumentTableCommand): FlowTableStructureOperation {
  const rowIndex = (id: string) => table.rows.findIndex(row => row.id === id)
  const columnIndex = (id: string) => table.columns.findIndex(column => column.id === id)
  const ar = rowIndex(selection.anchor.rowId), hr = rowIndex(selection.head.rowId)
  const ac = columnIndex(selection.anchor.columnId), hc = columnIndex(selection.head.columnId)
  if (ar < 0 || hr < 0 || ac < 0 || hc < 0) throw new Error('表格选区已失效')
  switch (command) {
    case 'insert-row-above': return { kind: 'insert-row', beforeId: selection.anchor.rowId }
    case 'insert-row-below': return { kind: 'insert-row', afterId: selection.anchor.rowId }
    case 'insert-column-left': return { kind: 'insert-column', beforeId: selection.anchor.columnId }
    case 'insert-column-right': return { kind: 'insert-column', afterId: selection.anchor.columnId }
    case 'delete-row': return { kind: 'delete-row', id: selection.anchor.rowId }
    case 'delete-column': return { kind: 'delete-column', id: selection.anchor.columnId }
    case 'split-cell': return { kind: 'split', rowId: selection.anchor.rowId, columnId: selection.anchor.columnId }
    case 'merge-cells': {
      const rowIds = table.rows.slice(Math.min(ar, hr), Math.max(ar, hr) + 1).map(row => row.id)
      const columnIds = table.columns.slice(Math.min(ac, hc), Math.max(ac, hc) + 1).map(column => column.id)
      return { kind: 'merge', region: { rowIds, columnIds } }
    }
  }
}

/** One pure result for the host's single replacement transaction and undo entry. */
export function changeDocumentTable(table: FlowTableBlock, selection: DocumentTableSelection, command: DocumentTableCommand, idFactory?: () => string): FlowTableBlock {
  return changeFlowTableStructure(table, documentTableOperation(table, selection, command), idFactory)
}
