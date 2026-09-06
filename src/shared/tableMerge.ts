import { z } from 'zod'

/** Ordered stable row/column identities, with the upper-left cell as the only content owner. */
export const tableMergeRegionSchema = z.object({
  rowIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100000),
  columnIds: z.array(z.string().trim().min(1).max(200)).min(1).max(256),
}).strict()
export type TableMergeRegion = z.infer<typeof tableMergeRegionSchema>
export interface TableMergeView {
  readonly rows: readonly { readonly id: string }[]
  readonly columns: readonly { readonly id: string }[]
  readonly merges?: readonly { readonly rowIds: readonly string[]; readonly columnIds: readonly string[] }[]
}
export interface TableCellSpan { rowSpan: number; columnSpan: number; covered: boolean; rowOffset: number; columnOffset: number }
export function tableCellSpan(table: TableMergeView, rowId: string, columnId: string): TableCellSpan {
  const region = table.merges?.find(merge => merge.rowIds.includes(rowId) && merge.columnIds.includes(columnId))
  if (!region) return { rowSpan: 1, columnSpan: 1, covered: false, rowOffset: 0, columnOffset: 0 }
  return { rowSpan: region.rowIds.length, columnSpan: region.columnIds.length, covered: region.rowIds[0] !== rowId || region.columnIds[0] !== columnId, rowOffset: region.rowIds.indexOf(rowId), columnOffset: region.columnIds.indexOf(columnId) }
}
export function tableMergeIssues(table: TableMergeView): string[] {
  const issues: string[] = []
  const rows = table.rows.map(row => row.id); const columns = table.columns.map(column => column.id)
  const occupied = new Set<string>()
  const contiguous = (all: string[], selected: readonly string[]) => {
    const start = all.indexOf(selected[0] ?? '')
    return start >= 0 && selected.every((id, index) => all[start + index] === id)
  }
  for (const region of table.merges ?? []) {
    if (!contiguous(rows, region.rowIds) || !contiguous(columns, region.columnIds) || region.rowIds.length * region.columnIds.length < 2) {
      issues.push('合并区域必须包含至少两个连续且存在的单元格；修改行列前请先拆分受影响区域')
      continue
    }
    for (const rowId of region.rowIds) for (const columnId of region.columnIds) {
      const key = JSON.stringify([rowId, columnId])
      if (occupied.has(key)) issues.push('合并区域不能重叠')
      occupied.add(key)
    }
  }
  return issues
}
