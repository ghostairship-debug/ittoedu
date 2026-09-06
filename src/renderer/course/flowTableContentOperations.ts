import { nanoid } from 'nanoid'
import { flowBlockSchema } from '../../shared/courseProjectSchema'
import type { FlowTableBlock } from '../../shared/courseProjectTypes'
import { moveTableItem } from './tableStructure'

export type FlowTableStructureOperation =
  | { kind: 'insert-row'; afterId?: string }
  | { kind: 'delete-row'; id: string }
  | { kind: 'move-row'; id: string; direction: -1 | 1 }
  | { kind: 'insert-column'; afterId?: string }
  | { kind: 'delete-column'; id: string }
  | { kind: 'move-column'; id: string; direction: -1 | 1 }

export function changeFlowTableStructure(source: FlowTableBlock, operation: FlowTableStructureOperation, idFactory: () => string = nanoid): FlowTableBlock {
  const table = structuredClone(source)
  switch (operation.kind) {
    case 'insert-row': {
      const index = operation.afterId ? table.rows.findIndex(row => row.id === operation.afterId) : table.rows.length - 1
      if (operation.afterId && index < 0) throw new Error('表格行已失效')
      table.rows.splice(index + 1, 0, { id: `row-${idFactory()}`, cells: Object.fromEntries(table.columns.map(column => [column.id, ''])) })
      break
    }
    case 'delete-row':
      if (!table.rows.some(row => row.id === operation.id)) throw new Error('表格行已失效')
      table.rows = table.rows.filter(row => row.id !== operation.id)
      break
    case 'move-row': table.rows = moveTableItem(table.rows, operation.id, operation.direction); break
    case 'insert-column': {
      const index = operation.afterId ? table.columns.findIndex(column => column.id === operation.afterId) : table.columns.length - 1
      if (operation.afterId && index < 0) throw new Error('表格列已失效')
      const id = `col-${idFactory()}`
      table.columns.splice(index + 1, 0, { id, header: '新列' })
      for (const row of table.rows) row.cells[id] = ''
      break
    }
    case 'delete-column':
      if (table.columns.length <= 1) throw new Error('表格至少保留一列')
      if (!table.columns.some(column => column.id === operation.id)) throw new Error('表格列已失效')
      table.columns = table.columns.filter(column => column.id !== operation.id)
      for (const row of table.rows) delete row.cells[operation.id]
      break
    case 'move-column': table.columns = moveTableItem(table.columns, operation.id, operation.direction); break
  }
  return flowBlockSchema.parse(table) as FlowTableBlock
}
