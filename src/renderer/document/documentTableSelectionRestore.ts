import { CellSelection } from 'prosemirror-tables'
import { NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { DocumentContent } from '../../shared/document/content'
import type { FlowTableBlock } from '../../shared/courseProjectTypes'
import type { DocumentTableEditorTarget } from './documentTableEditorPort'

export interface PreviousDocumentTableSelection extends Pick<DocumentTableEditorTarget, 'tableId' | 'anchor' | 'head'> {
  previousTable: FlowTableBlock
  /** Pass true only for an original ProseMirror CellSelection. */
  wasCellSelection?: boolean
}

type Slot = NonNullable<DocumentTableEditorTarget['anchor']>

function findTable(blocks: DocumentContent['blocks'], id: string): FlowTableBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block.type === 'table' ? block : null
    if (block.type === 'section') {
      const nested = findTable(block.blocks, id)
      if (nested) return nested
    }
  }
  return null
}

/** Preserve a surviving identity; otherwise choose the nearest old neighbor, then the same grid index. */
function nearestId(oldIds: string[], newIds: string[], wanted: string): string | null {
  if (newIds.includes(wanted)) return wanted
  if (!newIds.length) return null
  const oldIndex = oldIds.indexOf(wanted)
  if (oldIndex < 0) return null
  const surviving = newIds.filter(id => oldIds.includes(id))
  if (surviving.length) {
    surviving.sort((a, b) => {
      const da = Math.abs(oldIds.indexOf(a) - oldIndex), db = Math.abs(oldIds.indexOf(b) - oldIndex)
      return da - db || oldIds.indexOf(a) - oldIds.indexOf(b)
    })
    return surviving[0]!
  }
  return newIds[Math.min(oldIndex, newIds.length - 1)]!
}

function recoverSlot(slot: Slot | null, before: FlowTableBlock, after: FlowTableBlock): Slot | null {
  if (!slot) return null
  const oldColumns = before.columns.map(column => column.id)
  const newColumns = after.columns.map(column => column.id)
  const columnId = nearestId(oldColumns, newColumns, slot.kind === 'header' ? slot.columnId : slot.cell.columnId)
  if (!columnId) return null
  if (slot.kind === 'header') return { kind: 'header', columnId }
  const rowId = nearestId(before.rows.map(row => row.id), after.rows.map(row => row.id), slot.cell.rowId)
  if (!rowId) return { kind: 'header', columnId }
  const merged = after.merges?.find(region => region.rowIds.includes(rowId) && region.columnIds.includes(columnId))
  return { kind: 'cell', cell: { rowId: merged?.rowIds[0] ?? rowId, columnId: merged?.columnIds[0] ?? columnId } }
}

function slotPosition(tableNode: PMNode, tablePosition: number, slot: Slot | null): number {
  if (!slot) return -1
  const key = slot.kind === 'header' ? `column:${slot.columnId}` : `cell:${JSON.stringify([slot.cell.rowId, slot.cell.columnId])}`
  let result = -1
  tableNode.descendants((node, offset) => {
    if (result < 0 && node.type.spec.tableRole && node.firstChild?.attrs.key === key) result = tablePosition + 1 + offset
    return result < 0
  })
  return result
}

/** Set the selection on an already replaced transaction, without making a second history entry. */
export function restoreDocumentTableSelection(
  transaction: Transaction,
  previous: PreviousDocumentTableSelection,
  nextContent: DocumentContent,
): Transaction {
  const after = findTable(nextContent.blocks, previous.tableId)
  if (!after) return transaction
  let tablePosition = -1
  transaction.doc.descendants((node, position) => {
    if (tablePosition < 0 && node.type.name === 'table_container' && node.attrs.id === previous.tableId) tablePosition = position
    return tablePosition < 0
  })
  const tableNode = tablePosition < 0 ? null : transaction.doc.nodeAt(tablePosition)
  if (!tableNode) return transaction
  const anchor = slotPosition(tableNode, tablePosition, recoverSlot(previous.anchor, previous.previousTable, after))
  const head = slotPosition(tableNode, tablePosition, recoverSlot(previous.head, previous.previousTable, after))
  if (anchor >= 0 && head >= 0 && previous.wasCellSelection && previous.anchor?.kind === 'cell' && previous.head?.kind === 'cell') {
    try { return transaction.setSelection(CellSelection.create(transaction.doc, anchor, head)) } catch { /* A changed merge may erase the rectangle. */ }
  }
  const chosen = anchor >= 0 ? anchor : head
  if (chosen >= 0) return transaction.setSelection(TextSelection.create(transaction.doc, chosen + 2))
  if (NodeSelection.isSelectable(tableNode)) return transaction.setSelection(NodeSelection.create(transaction.doc, tablePosition))
  return transaction
}
