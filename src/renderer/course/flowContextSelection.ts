import type { DocumentSelection, DocumentSlot } from '../../shared/document/ports'
import type { DocumentBlock } from '../../shared/document/content'
import type { FlowEditorSelection, FlowTextRange } from './flowEditorSlice'
import { resolveFlowContextSelection, type FlowContextTarget } from '../../core/tools/flowTextSlot'

/** Preserve even unsupported logical selections so chat cannot fall back to a whole block/page. */
export function flowContextSelectionIntent(selection: DocumentSelection) {
  const blockId = selection.kind === 'text' ? selection.head.blockId : selection.kind === 'cells' ? selection.tableId : selection.blockId
  let textRange: FlowTextRange | null = null
  if (selection.kind === 'text' && selection.anchor.blockId === selection.head.blockId && JSON.stringify(selection.anchor.slot) === JSON.stringify(selection.head.slot)) {
    const slot = selection.head.slot, base = { blockId, start: Math.min(selection.anchor.offset, selection.head.offset), end: Math.max(selection.anchor.offset, selection.head.offset) }
    if (slot.kind === 'field' && slot.field === 'content') textRange = base
    if (slot.kind === 'item') textRange = { ...base, listItemId: slot.itemId }
    if (slot.kind === 'cell') textRange = { ...base, tableRowId: slot.rowId, tableColumnId: slot.columnId }
  }
  return { kind: 'select-blocks' as const, blockIds: [blockId], focus: selection.kind === 'object' ? 'block' as const : 'text' as const, textRange, documentSelection: structuredClone(selection) }
}
export function flowSelectionContextTarget(blocks: readonly DocumentBlock[], revision: number, selection: FlowEditorSelection): FlowContextTarget | null {
  if (selection.documentSelectionIssue) throw new Error(selection.documentSelectionIssue)
  if (selection.documentSelection) return resolveFlowContextSelection(blocks, revision, selection.documentSelection)
  if (selection.focus !== 'text') return null
  const range = selection.textRange
  if (!range) throw new Error('正文选区无法定位，请重新选择。')
  // Legacy text focus carries a caret by default; it is not an explicit range.
  if (range.start === range.end) return null
  const slot: DocumentSlot = range.listItemId ? { kind: 'item', itemId: range.listItemId } : range.tableRowId && range.tableColumnId ? { kind: 'cell', rowId: range.tableRowId, columnId: range.tableColumnId } : { kind: 'field', field: 'content' }
  return resolveFlowContextSelection(blocks, revision, { kind: 'text', revision: String(revision), anchor: { blockId: range.blockId, slot, offset: range.start, affinity: 'after' }, head: { blockId: range.blockId, slot, offset: range.end, affinity: 'before' } })
}
