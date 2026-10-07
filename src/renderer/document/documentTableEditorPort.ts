import { NodeSelection, type EditorState } from 'prosemirror-state'
import type { ResolvedPos } from 'prosemirror-model'
import { fromEditorDocument } from './documentAdapter'
import { changeDocumentTable, type DocumentTableCell, type DocumentTableCommand, type DocumentTableSelection } from './documentTableCommands'
import { documentContentSchema, type DocumentContent } from '../../shared/document/content'
import type { FlowTableBlock } from '../../shared/courseProjectTypes'
import { changeFlowTableStructure } from '../../core/tools/flowTableContentOperations'

export interface DocumentTableEditorTarget {
  tableId: string
  tablePosition: number
  anchor: { kind: 'cell'; cell: DocumentTableCell } | { kind: 'header'; columnId: string } | null
  head: { kind: 'cell'; cell: DocumentTableCell } | { kind: 'header'; columnId: string } | null
}

function tableAt(position: ResolvedPos): { tableId: string; tablePosition: number } | null {
  for (let depth = position.depth; depth > 0; depth--) {
    const node = position.node(depth)
    if (node.type.name === 'table_container') return { tableId: node.attrs.id, tablePosition: position.before(depth) }
  }
  return null
}

function slotAt(position: ResolvedPos): DocumentTableEditorTarget['anchor'] {
  for (let depth = position.depth; depth >= 0; depth--) {
    const node = position.node(depth)
    if (node.type.spec.tableRole !== 'cell' && node.type.spec.tableRole !== 'header_cell') continue
    const key = node.firstChild?.attrs.key as string | undefined
    if (key?.startsWith('column:')) return { kind: 'header', columnId: key.slice(7) }
    if (key?.startsWith('cell:')) {
      const value: unknown = JSON.parse(key.slice(5))
      if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string')) {
        return { kind: 'cell', cell: { rowId: value[0], columnId: value[1] } }
      }
    }
    return null
  }
  const next = position.nodeAfter
  if (next?.type.spec.tableRole === 'cell' || next?.type.spec.tableRole === 'header_cell') {
    const key = next.firstChild?.attrs.key as string | undefined
    if (key?.startsWith('column:')) return { kind: 'header', columnId: key.slice(7) }
    if (key?.startsWith('cell:')) {
      const value: unknown = JSON.parse(key.slice(5))
      if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string')) {
        return { kind: 'cell', cell: { rowId: value[0], columnId: value[1] } }
      }
    }
  }
  return null
}

export function resolveDocumentTableEditorTarget(state: EditorState): DocumentTableEditorTarget | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'table_container') {
    return { tableId: selection.node.attrs.id as string, tablePosition: selection.from, anchor: null, head: null }
  }
  const anchorPos = '$anchorCell' in selection ? selection.$anchorCell as ResolvedPos : selection.$anchor
  const headPos = '$headCell' in selection ? selection.$headCell as ResolvedPos : selection.$head
  const anchorTable = tableAt(anchorPos) ?? (state.doc.nodeAt(selection.from)?.type.name === 'table_container'
    ? { tableId: state.doc.nodeAt(selection.from)!.attrs.id as string, tablePosition: selection.from } : null)
  const headTable = tableAt(headPos) ?? (selection.from === selection.to ? anchorTable : null)
  if (!anchorTable || !headTable || anchorTable.tablePosition !== headTable.tablePosition) return null
  return { ...anchorTable, anchor: slotAt(anchorPos), head: slotAt(headPos) }
}

/** Produce one canonical document for the host's existing single transaction and History entry. */
export function changeDocumentTableFromEditorState(
  state: EditorState,
  command: DocumentTableCommand | 'toggle-header',
  createId?: () => string,
): DocumentContent {
  const target = resolveDocumentTableEditorTarget(state)
  if (!target) throw new Error('当前选区不在表格中')
  const content = fromEditorDocument(state.doc)
  let found = false
  const change = (blocks: DocumentContent['blocks']): DocumentContent['blocks'] => blocks.map(block => {
    if (block.id === target.tableId) {
      if (block.type !== 'table') throw new Error('表格选区已失效')
      found = true
      const table = block as FlowTableBlock
      if (command === 'toggle-header') {
        const next = { ...table }
        if (table.headerEnabled === false) delete next.headerEnabled
        else next.headerEnabled = false
        return next
      }
      if (!target.anchor || !target.head) throw new Error('请选择表格单元格')
      if (target.anchor.kind === 'header') {
        const columnId = target.anchor.columnId
        if (!table.columns.some(column => column.id === columnId)) throw new Error('表格选区已失效')
        if (command === 'insert-column-left') return changeFlowTableStructure(table, { kind: 'insert-column', beforeId: columnId }, createId)
        if (command === 'insert-column-right') return changeFlowTableStructure(table, { kind: 'insert-column', afterId: columnId }, createId)
        if (command === 'delete-column') return changeFlowTableStructure(table, { kind: 'delete-column', id: columnId }, createId)
        throw new Error('请选择表格数据行')
      }
      const cell = (point: NonNullable<DocumentTableEditorTarget['anchor']>): DocumentTableCell => {
        if (point.kind === 'cell') return point.cell
        throw new Error('请选择表格数据行')
      }
      const selection: DocumentTableSelection = { anchor: cell(target.anchor), head: cell(target.head) }
      return changeDocumentTable(table, selection, command, createId)
    }
    return block.type === 'section' ? { ...block, blocks: change(block.blocks) } : block
  })
  const result = { blocks: change(content.blocks) }
  if (!found) throw new Error('表格选区已失效')
  return documentContentSchema.parse(result)
}
