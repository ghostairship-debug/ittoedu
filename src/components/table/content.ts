import { nanoid } from 'nanoid'
import { plainDocumentText } from '../../shared/document/content'
import { editTableCellText } from './edit'
import { createTableData, parseTableData, tableCellContent, tableContentInputSchema, type TableContentInput, type TableData, type TableRow } from './data'

/** Replace the explicitly supplied table content; correspondence is its current row/column order. */
export function replaceTableContentData(source: TableData, input: TableContentInput, idFactory: () => string = nanoid): TableData {
  const before = parseTableData(source), content = tableContentInputSchema.parse(input)
  const visibleColumnHeader = before.headerEnabled !== false && before.columns.some(column => column.header)
  const requestedHeaderCount = content.headerRowCount ?? Math.min(before.headerRowCount + (visibleColumnHeader ? 1 : 0), content.rows.length)
  const keepColumnHeader = visibleColumnHeader && requestedHeaderCount > 0
  const columns = content.rows[0]!.map((text, index) => {
    const column = before.columns[index] ?? { id: `col_${idFactory()}`, width: 200 }
    if (keepColumnHeader) return { ...column, header: editTableCellText(column.header ?? { inlines: [] }, text) }
    if (visibleColumnHeader) { const { header: _header, ...fields } = column; return fields }
    return column
  })
  // A visible Flow column header is the first matrix row, not an extra old heading.
  // Explicitly removing header status turns that row into ordinary authored cells.
  const previousRows: TableRow[] = visibleColumnHeader && !keepColumnHeader ? [{ id: `row_${idFactory()}`, height: 40,
    cells: before.columns.map(column => ({ id: `cell_${idFactory()}`, columnId: column.id, content: column.header ?? { inlines: [] } })) }, ...before.rows] : before.rows
  const rows = (keepColumnHeader ? content.rows.slice(1) : content.rows).map((values, rowIndex) => {
    const previous = previousRows[rowIndex]
    return { ...(previous ?? { id: `row_${idFactory()}`, height: 40 }), cells: values.map((text, columnIndex) => {
      const column = columns[columnIndex]!, cell = previous?.cells.find(value => value.columnId === column.id)
      if (!cell) return { id: `cell_${idFactory()}`, columnId: column.id, text }
      if (!cell.content) return { ...cell, text }
      const { text: _text, ...fields } = cell
      return { ...fields, content: editTableCellText(cell.content, text) }
    }) }
  })
  const headerRowCount = requestedHeaderCount - (keepColumnHeader ? 1 : 0)
  const merges = before.merges?.filter(merge => {
    const start = rows.findIndex(row => row.id === merge.rowIds[0])
    const columnStart = columns.findIndex(column => column.id === merge.columnIds[0])
    if (start < 0 || columnStart < 0
      || !merge.rowIds.every((id, offset) => rows[start + offset]?.id === id)
      || !merge.columnIds.every((id, offset) => columns[columnStart + offset]?.id === id)
      || start < headerRowCount && start + merge.rowIds.length > headerRowCount) return false
    // New covered-cell content must stay visible; only that affected merge is removed.
    return merge.rowIds.every((_, rowOffset) => merge.columnIds.every((_, columnOffset) =>
      rowOffset === 0 && columnOffset === 0 || !plainDocumentText(tableCellContent(rows[start + rowOffset]!.cells[columnStart + columnOffset]!))))
  })
  return parseTableData({ ...before, columns, rows, headerRowCount, ...(merges ? { merges } : {}) })
}

export function createTableContentData(input: TableContentInput, idFactory: () => string = nanoid): TableData {
  const content = tableContentInputSchema.parse(input)
  return replaceTableContentData(createTableData({ rows: content.rows.length, columns: content.rows[0]!.length, idFactory }), content, idFactory)
}
