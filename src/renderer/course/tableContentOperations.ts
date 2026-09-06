import { reorderTableItems } from './tableStructure'
import { nanoid } from 'nanoid'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type { NativeTableCell, NativeTableCellStyle, NativeTableColumn, NativeTableContent, NativeTableRow, NativeTableStyle } from '../../shared/contracts/native-v1/types'

type IdFactory = () => string
export class TableContentError extends Error {
  constructor(readonly reason: string, message: string) { super(message) }
}

export function patchTableCellText(source: NativeTableContent, input: {
    readonly cellId: string
    readonly text: string
  }): NativeTableContent {
  const table = structuredClone(source)
  if (typeof input.text !== 'string' || input.text.length > 20000) {
        throw new TableContentError('invalid-data', '单元格文本长度超出上限')
      }
  let found = false
  for (const row of table.rows) {
    const cell = row.cells.find((c) => c.id === input.cellId)
    if (cell) {
      cell.text = input.text
      found = true
      break
    }
  }
  if (!found) {
    throw new TableContentError('invalid-target', `找不到单元格：${input.cellId}`)
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function patchTableStyle(source: NativeTableContent, input: {
    readonly stylePatch: Partial<NativeTableStyle>
  }): NativeTableContent {
  const table = structuredClone(source)
  table.style = {
    ...table.style,
    ...input.stylePatch,
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function patchTableCellStyle(source: NativeTableContent, input: {
    readonly cellId: string
    readonly stylePatch: Partial<NativeTableCellStyle>
  }): NativeTableContent {
  const table = structuredClone(source)
  let targetCell: NativeTableCell | undefined
  for (const row of table.rows) {
    const found = row.cells.find((c) => c.id === input.cellId)
    if (found) {
      targetCell = found
      break
    }
  }
  if (!targetCell) {
    throw new TableContentError('invalid-target', `找不到单元格：${input.cellId}`)
  }

  const nextStyle = {
    ...(targetCell.style ?? {}),
    ...input.stylePatch,
  }
  for (const key of Object.keys(nextStyle) as (keyof NativeTableCellStyle)[]) {
    if (nextStyle[key] === undefined) delete nextStyle[key]
  }
  targetCell.style = Object.keys(nextStyle).length > 0 ? nextStyle : undefined
  return tableNativeContentObjectSchema.parse(table)
}

export function patchTableRowHeight(source: NativeTableContent, input: {
    readonly rowId: string
    readonly height: number
  }): NativeTableContent {
  const table = structuredClone(source)
  if (!Number.isFinite(input.height) || input.height < 20 || input.height > 2000) {
        throw new TableContentError('invalid-data', '行高必须介于 20 到 2000 之间')
      }
  const row = table.rows.find((r) => r.id === input.rowId)
  if (!row) throw new TableContentError('invalid-target', `找不到行：${input.rowId}`)
  row.height = input.height
  return tableNativeContentObjectSchema.parse(table)
}

export function patchTableColumnWidth(source: NativeTableContent, input: {
    readonly columnId: string
    readonly width: number
  }): NativeTableContent {
  const table = structuredClone(source)
  if (!Number.isFinite(input.width) || input.width < 24 || input.width > 2000) {
        throw new TableContentError('invalid-data', '列宽必须介于 24 到 2000 之间')
      }
  const col = table.columns.find((c) => c.id === input.columnId)
  if (!col) throw new TableContentError('invalid-target', `找不到列：${input.columnId}`)
  col.width = input.width
  return tableNativeContentObjectSchema.parse(table)
}

export function insertTableRow(source: NativeTableContent, input: {
    readonly referenceRowId: string
    readonly position: 'before' | 'after'
    readonly idFactory?: IdFactory
  }): NativeTableContent {
  const table = structuredClone(source)
  const idFactory = input.idFactory ?? nanoid
  if (table.rows.length >= 1000) {
    throw new TableContentError('invalid-data', '表格行数已达上限（1000 行）')
  }

  const refIndex = table.rows.findIndex((r) => r.id === input.referenceRowId)
  if (refIndex < 0) {
    throw new TableContentError('invalid-target', `找不到参考行：${input.referenceRowId}`)
  }

  const insertIndex = input.position === 'before' ? refIndex : refIndex + 1
  const refRow = table.rows[refIndex]!

  const newRowId = `row_${idFactory()}`
  const newCells: NativeTableCell[] = table.columns.map((col) => ({
    id: `cell_${idFactory()}`,
    columnId: col.id,
    text: '',
  }))

  const newRow: NativeTableRow = {
    id: newRowId,
    height: refRow.height,
    cells: newCells,
  }

  table.rows.splice(insertIndex, 0, newRow)
  return tableNativeContentObjectSchema.parse(table)
}

export function deleteTableRow(source: NativeTableContent, input: {
    readonly rowId: string
  }): NativeTableContent {
  const table = structuredClone(source)
  if (table.rows.length <= 1) {
    throw new TableContentError('invalid-data', '表格至少需要保留一行')
  }

  const index = table.rows.findIndex((r) => r.id === input.rowId)
  if (index < 0) {
    throw new TableContentError('invalid-target', `找不到行：${input.rowId}`)
  }

  table.rows.splice(index, 1)
  if (table.headerRowCount > table.rows.length) {
    table.headerRowCount = table.rows.length
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function reorderTableRows(source: NativeTableContent, input: {
    readonly orderedRowIds: readonly string[]
  }): NativeTableContent {
  const table = structuredClone(source)
  let nextItems
  try { nextItems = reorderTableItems(table.rows, input.orderedRowIds) }
  catch (error) { throw new TableContentError('invalid-data', error instanceof Error ? error.message : '重排失败') }
  table.rows = nextItems
  return tableNativeContentObjectSchema.parse(table)
}

export function insertTableColumn(source: NativeTableContent, input: {
    readonly referenceColumnId: string
    readonly position: 'before' | 'after'
    readonly width?: number
    readonly idFactory?: IdFactory
  }): NativeTableContent {
  const table = structuredClone(source)
  const idFactory = input.idFactory ?? nanoid
  if (table.columns.length >= 100) {
    throw new TableContentError('invalid-data', '表格列数已达上限（100 列）')
  }

  const refIndex = table.columns.findIndex((c) => c.id === input.referenceColumnId)
  if (refIndex < 0) {
    throw new TableContentError('invalid-target', `找不到参考列：${input.referenceColumnId}`)
  }

  const insertIndex = input.position === 'before' ? refIndex : refIndex + 1
  const refCol = table.columns[refIndex]!

  const newColId = `col_${idFactory()}`
  const newColumn: NativeTableColumn = {
    id: newColId,
    width: input.width ?? refCol.width,
  }

  table.columns.splice(insertIndex, 0, newColumn)

  // Insert matching cell in every row at insertIndex
  for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
    const row = table.rows[rIdx]!
    const isHeader = rIdx < table.headerRowCount
    const newCell: NativeTableCell = {
      id: `cell_${idFactory()}`,
      columnId: newColId,
      text: '',
      style: isHeader ? { bold: true, fillColor: '#f3f4f6' } : undefined,
    }
    row.cells.splice(insertIndex, 0, newCell)
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function deleteTableColumn(source: NativeTableContent, input: {
    readonly columnId: string
  }): NativeTableContent {
  const table = structuredClone(source)
  if (table.columns.length <= 1) {
    throw new TableContentError('invalid-data', '表格至少需要保留一列')
  }

  const colIndex = table.columns.findIndex((c) => c.id === input.columnId)
  if (colIndex < 0) {
    throw new TableContentError('invalid-target', `找不到列：${input.columnId}`)
  }

  table.columns.splice(colIndex, 1)

  // Remove matching cell in every row
  for (const row of table.rows) {
    row.cells = row.cells.filter((c) => c.columnId !== input.columnId)
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function reorderTableColumns(source: NativeTableContent, input: {
    readonly orderedColumnIds: readonly string[]
  }): NativeTableContent {
  const table = structuredClone(source)
  let nextItems
  try { nextItems = reorderTableItems(table.columns, input.orderedColumnIds) }
  catch (error) { throw new TableContentError('invalid-data', error instanceof Error ? error.message : '重排失败') }
  table.columns = nextItems
  const nextColumns = nextItems

  // Reorder cells in each row to match nextColumns order
  for (const row of table.rows) {
    const cellByColId = new Map(row.cells.map((cell) => [cell.columnId, cell]))
    row.cells = nextColumns.map((col) => {
      const cell = cellByColId.get(col.id)
      if (!cell) throw new Error(`列 ${col.id} 缺少对应单元格`)
      return cell
    })
  }
  return tableNativeContentObjectSchema.parse(table)
}

export function commitTableLastCellAndAppendRow(
  source: NativeTableContent,
  input: { readonly cellId: string; readonly text: string; readonly idFactory?: IdFactory },
): { table: NativeTableContent; focusResult: { newRowId: string; newCellId: string; targetColumnId: string } } {
  const lastRow = source.rows.at(-1)
  const lastColumn = source.columns.at(-1)
  if (!lastRow || !lastColumn) throw new TableContentError('invalid-target', '表格必须包含行与列')
  const cell = lastRow.cells.find((candidate) => candidate.id === input.cellId)
  if (!cell || cell.columnId !== lastColumn.id) {
    throw new TableContentError('invalid-target', '所选单元格不是表格末格')
  }
  const table = insertTableRow(patchTableCellText(source, input), {
    referenceRowId: lastRow.id,
    position: 'after',
    idFactory: input.idFactory,
  })
  const newRow = table.rows.at(-1)!
  return { table, focusResult: {
    newRowId: newRow.id,
    newCellId: newRow.cells[0]!.id,
    targetColumnId: table.columns[0]!.id,
  } }
}
