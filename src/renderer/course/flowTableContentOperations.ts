import { nanoid } from 'nanoid'
import { flowBlockSchema } from '../../shared/courseProjectSchema'
import type { FlowTableBlock } from '../../shared/courseProjectTypes'
import { moveTableItem } from './tableStructure'
import { tableMergeIssues, tableMergeRegionSchema, type TableMergeRegion } from '../../shared/tableMerge'
import { decodeFlowTableCell } from '../../shared/courseProjectModel'
import type { TextRun } from '../../shared/contracts/native-v1'

export type FlowTableStructureOperation =
  | { kind: 'merge'; region: TableMergeRegion }
  | { kind: 'split'; rowId: string; columnId: string }
  | { kind: 'insert-row'; afterId?: string }
  | { kind: 'delete-row'; id: string }
  | { kind: 'move-row'; id: string; direction: -1 | 1 }
  | { kind: 'insert-column'; afterId?: string }
  | { kind: 'delete-column'; id: string }
  | { kind: 'move-column'; id: string; direction: -1 | 1 }

export function changeFlowTableStructure(source: FlowTableBlock, operation: FlowTableStructureOperation, idFactory: () => string = nanoid): FlowTableBlock {
  const table = structuredClone(source)
  switch (operation.kind) {
    case 'merge': {
      const region = tableMergeRegionSchema.parse(operation.region)
      table.merges = [...(table.merges ?? []), region]
      const issues = tableMergeIssues(table)
      if (issues.length) throw new Error(issues[0])
      let text = ''; const runs: TextRun[] = []
      for (const rowId of region.rowIds) for (const columnId of region.columnIds) {
        const row = table.rows.find(row => row.id === rowId)!
        const cell = decodeFlowTableCell(row.cells[columnId]!)
        if (cell.text) {
          if (text) text += '\n'
          const offset = Array.from(text).length
          runs.push(...cell.runs.filter(run => Object.keys(run.style).length > 0).map(run => ({ ...run, start: run.start + offset, end: run.end + offset })))
          text += cell.text
        }
        row.cells[columnId] = ''
      }
      table.rows.find(row => row.id === region.rowIds[0])!.cells[region.columnIds[0]!] = runs.length ? { text, runs } : text
      break
    }
    case 'split': {
      const region = table.merges?.find(merge => merge.rowIds.includes(operation.rowId) && merge.columnIds.includes(operation.columnId))
      if (!region) throw new Error('所选单元格没有合并')
      table.merges = table.merges!.filter(merge => merge !== region)
      break
    }
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
