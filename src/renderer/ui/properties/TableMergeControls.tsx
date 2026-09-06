import { useState } from 'react'
import type { TableMergeRegion, TableMergeView } from '../../../shared/tableMerge'

export function TableMergeControls({ table, onMerge, onSplit }: {
  table: TableMergeView
  onMerge(region: TableMergeRegion): void
  onSplit(rowId: string, columnId: string): void
}) {
  const [bounds, setBounds] = useState([0, 0, 0, 1])
  const counts = [table.rows.length, table.columns.length, table.rows.length, table.columns.length]
  const indices = bounds.map((value, index) => Math.min(value, Math.max(0, counts[index]! - 1)))
  const [r0, c0, r1, c1] = indices as [number, number, number, number]
  const rowIds = table.rows.slice(Math.min(r0, r1), Math.max(r0, r1) + 1).map(row => row.id)
  const columnIds = table.columns.slice(Math.min(c0, c1), Math.max(c0, c1) + 1).map(column => column.id)
  return <details className="property-section" data-testid="table-merge-controls">
    <summary>合并与拆分单元格</summary>
    <p className="property-hint">选择矩形的两个角。合并后文字按行汇入左上角；拆分后文字保留在左上角。</p>
    {['起始行', '起始列', '结束行', '结束列'].map((label, index) => <label key={label} className="form-field">
      <span>{label}</span><select aria-label={label} className="form-input" value={indices[index]} onChange={event => setBounds(current => current.map((value, i) => i === index ? Number(event.currentTarget.value) : value))}>
        {Array.from({ length: counts[index]! }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
      </select>
    </label>)}
    <button type="button" className="secondary-button" disabled={rowIds.length * columnIds.length < 2} onClick={() => onMerge({ rowIds, columnIds })}>合并所选区域</button>
    {table.merges?.map(region => <button type="button" className="secondary-button" key={JSON.stringify(region)} onClick={() => onSplit(region.rowIds[0]!, region.columnIds[0]!)}>
      拆分第 {table.rows.findIndex(row => row.id === region.rowIds[0]) + 1} 行、第 {table.columns.findIndex(column => column.id === region.columnIds[0]) + 1} 列的 {region.rowIds.length} × {region.columnIds.length} 区域
    </button>)}
  </details>
}
