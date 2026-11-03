import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { DataGrid, type Column, type ColumnWidths, type DataGridHandle } from 'react-data-grid'
import { cellName, columnName, parsedMergedRanges, position, rangeBetween, rangeContains, serializeTsv } from './xlsxGridModel'
import 'react-data-grid/lib/styles.css'
import './xlsxCellGrid.css'

export interface XlsxCellPresentation { display: string; editor: string; formula: boolean }
export interface XlsxCellGridHandle { jump(cell: string): void }
interface Props {
  sheetName: string; rowCount: number; columnCount: number; busy: boolean; selectedCell: string
  mergedRanges?: string[]
  cell(cell: string): XlsxCellPresentation
  columnWidth(column: number): number
  onFocus(cell: string): void
  onDraft(cell: string, text: string): void
  onColumnWidth(column: number, pixels: number): void
  onPaste(text: string, cell: string): void
  onComposition(active: boolean): void
}
const rowKey = (row: number) => row
/** RDG owns viewport, focus traversal and resizing. Drafts and durable history stay with the file owner. */
export const XlsxCellGrid = forwardRef<XlsxCellGridHandle, Props>(function XlsxCellGrid(props, ref) {
  const grid = useRef<DataGridHandle>(null), extensionTarget = useRef<string | null>(null)
  const [selection, setSelection] = useState({ anchor: props.selectedCell, end: props.selectedCell }), [rawCell, setRawCell] = useState<string | null>(null)
  const rows = useMemo(() => Array.from({ length: props.rowCount }, (_, index) => index + 1), [props.rowCount])
  const merges = useMemo(() => parsedMergedRanges(props.mergedRanges), [props.mergedRanges])
  const range = rangeBetween(selection.anchor, selection.end), multiple = selection.anchor !== selection.end
  const merged = (cell: string) => { const target = position(cell)!; return merges.find(value => rangeContains(value, target)) }
  const input = (cell: string) => grid.current?.element?.querySelector<HTMLInputElement>(`[data-cell="${cell}"]`)
  function select(cell: string, extend = false, focus = true) {
    const target = position(cell)!
    extensionTarget.current = extend ? cell : null
    setRawCell(null)
    setSelection(previous => ({ anchor: extend ? previous.anchor : cell, end: cell }))
    props.onFocus(cell)
    grid.current?.setActivePosition({ idx: target.column, rowIdx: target.row - 1 }, { shouldFocus: focus })
  }
  useImperativeHandle(ref, () => ({ jump: cell => select(cell) }))
  useLayoutEffect(() => { const target = position(props.selectedCell)!; grid.current?.setActivePosition({ idx: target.column, rowIdx: target.row - 1 }, { shouldFocus: false }) }, [])
  function editRaw(cell: string) {
    const merge = merged(cell)
    if (merge && cellName(merge.first) !== cell) { select(cellName(merge.first)); return }
    setRawCell(cell)
    requestAnimationFrame(() => { const field = input(cell); field?.focus(); field?.select() })
  }
  function copy(event: ClipboardEvent<HTMLDivElement>) {
    const field = event.target instanceof HTMLInputElement ? event.target : null
    // Preserve ordinary substring copying while editing a single cell.
    if (!multiple && field && field.selectionStart !== field.selectionEnd) return
    const values: string[][] = []
    for (let row = range.first.row; row <= range.last.row; row++) {
      const valuesRow: string[] = []
      for (let column = range.first.column; column <= range.last.column; column++) valuesRow.push(props.cell(columnName(column) + row).display)
      values.push(valuesRow)
    }
    event.preventDefault(); event.clipboardData.setData('text/plain', serializeTsv(values))
  }
  const widths: ColumnWidths = new Map(Array.from({ length: props.columnCount }, (_, index) => [columnName(index + 1), { type: 'resized' as const, width: props.columnWidth(index + 1) }]))
  const columns: Column<number>[] = [{ key: 'row', name: '', width: 56, frozen: true, cellClass: 'office-xlsx-row-number', headerCellClass: 'office-xlsx-row-number', renderCell: ({ row }) => row }, ...Array.from({ length: props.columnCount }, (_, index): Column<number> => {
    const number = index + 1, key = columnName(number)
    return {
      key, name: key, width: props.columnWidth(number), minWidth: 36, maxWidth: 1790, resizable: !props.busy,
      cellClass: row => rangeContains(range, { row, column: number }) ? 'office-xlsx-cell office-xlsx-cell--selected' : 'office-xlsx-cell',
      colSpan: args => { if (args.type !== 'ROW') return; const merge = merges.find(value => value.first.column === number && args.row >= value.first.row && args.row <= value.last.row); return merge ? merge.last.column - number + 1 : undefined },
      renderCell: ({ row, tabIndex }) => {
        const cell = key + row, value = props.cell(cell), merge = merged(cell), subordinate = !!merge && cellName(merge.first) !== cell
        return <input data-cell={cell} aria-label={`${props.sheetName}!${cell}`} className="office-xlsx-cell-input" tabIndex={tabIndex}
          disabled={props.busy} readOnly={subordinate} title={subordinate ? `合并单元格，请编辑 ${cellName(merge!.first)}` : value.formula ? value.editor : undefined}
          placeholder={subordinate ? `合并：${cellName(merge!.first)}` : undefined}
          value={rawCell === cell ? value.editor : value.display}
          onFocus={() => { grid.current?.setActivePosition({ idx: number, rowIdx: row - 1 }, { shouldFocus: false }); props.onFocus(cell) }}
          onChange={event => { if (!subordinate) props.onDraft(cell, event.target.value) }}
          onCompositionStart={() => props.onComposition(true)} onCompositionEnd={() => props.onComposition(false)} />
      },
    }
  })]
  return <div className="office-xlsx-grid-shell" onCopy={copy} onPaste={event => {
    const text = event.clipboardData.getData('text/plain')
    if (props.busy) { event.preventDefault(); return }
    if (multiple || rawCell !== selection.end || /[\t\r\n]/.test(text) || !(event.target instanceof HTMLInputElement)) { event.preventDefault(); props.onPaste(text, cellName(range.first)) }
  }}>
    <DataGrid ref={grid} className="office-xlsx-grid" aria-label={props.sheetName || '工作表'} columns={columns} rows={rows} rowKeyGetter={rowKey} rowHeight={30} headerRowHeight={30}
      columnWidths={widths} onColumnWidthsChange={() => { /* Width changes are already staged by onColumnResize. */ }}
      onColumnResize={(column, width) => { const cell = position(column.key + '1'); if (cell && !props.busy) props.onColumnWidth(cell.column, width) }}
      onCellMouseDown={({ column, row }, event) => {
        if (column.key === 'row') return
        if (event.shiftKey) { event.preventDefault(); event.preventGridDefault(); select(column.key + row, true); return }
        if (event.target instanceof HTMLInputElement) event.preventGridDefault()
        setSelection({ anchor: column.key + row, end: column.key + row }); setRawCell(null)
      }}
      onCellDoubleClick={({ column, row }, event) => { if (column.key !== 'row') { event.preventGridDefault(); editRaw(column.key + row) } }}
      onActivePositionChange={({ column, row }) => {
        if (!column || !row || column.key === 'row') return
        const cell = column.key + row, extending = extensionTarget.current === cell
        extensionTarget.current = null
        setSelection(previous => ({ anchor: extending ? previous.anchor : cell, end: cell })); props.onFocus(cell)
      }}
      onCellKeyDown={(args, event) => {
        if (!args.column || args.column.key === 'row' || event.nativeEvent.isComposing) return
        const cell = args.column.key + args.row, point = position(cell)!, field = event.target instanceof HTMLInputElement
        const arrow = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key]
        if (event.shiftKey && arrow) { event.preventDefault(); event.preventGridDefault(); select(cellName({ row: Math.max(1, Math.min(props.rowCount, point.row + arrow[0])), column: Math.max(1, Math.min(props.columnCount, point.column + arrow[1])) }), true); return }
        if (event.key === 'Enter') { event.preventDefault(); event.preventGridDefault(); select(columnName(point.column) + Math.max(1, Math.min(props.rowCount, point.row + (event.shiftKey ? -1 : 1)))); return }
        if (event.key === 'F2') { event.preventDefault(); event.preventGridDefault(); editRaw(cell); return }
        if (event.key === 'Escape') { setRawCell(null); setSelection({ anchor: cell, end: cell }) }
        if (field && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventGridDefault(); return }
        if (!field && !props.busy && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) {
          const merge = merged(cell)
          if (merge && cellName(merge.first) !== cell) return
          event.preventDefault(); event.preventGridDefault(); props.onDraft(cell, event.key.length === 1 ? event.key : '')
          requestAnimationFrame(() => { const target = input(cell); target?.focus(); if (target) target.setSelectionRange(target.value.length, target.value.length) })
        }
      }} />
    <div className="office-xlsx-selection-status" aria-live="polite">{multiple ? `${cellName(range.first)}:${cellName(range.last)}` : selection.end}<span>Shift + 单击或方向键选择区域 · 双击或 F2 编辑原内容</span></div>
  </div>
})
