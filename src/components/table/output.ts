import type { BuildNativeTableLayoutOptions } from '../../shared/nativeTableLayout'
import { layoutTable } from './render'
import { tableLayoutCellContent, type TableData } from './data'
import { renderDocumentText } from '../../shared/document/render'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Semantic editable output; Office adapters can consume the same layout/data directly. */
export function outputTableHtml(data: TableData, frame: BuildNativeTableLayoutOptions = {}): string {
  const layout = layoutTable(data, frame)
  const columns = layout.columns.map(column => `<col style="width:${column.width}px">`).join('')
  const rowHtml = (row: (typeof layout.rows)[number]) => {
    const cells = row.cells.map(cell => {
      const tag = cell.isHeader ? 'th' : 'td'
      const s = cell.style
      const css = `background:${s.fillColor};color:${s.textColor};font-family:${s.fontFamily};font-size:${s.fontSize}px;font-weight:${s.bold ? 700 : 400};font-style:${s.italic ? 'italic' : 'normal'};text-align:${s.horizontalAlign};vertical-align:${s.verticalAlign};border:${s.borderWidth}px ${s.lineStyle} ${s.borderColor};padding:${s.cellPadding}px;white-space:pre-wrap`
      return `<${tag} data-table-cell-id="${escapeHtml(cell.id)}" rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}" style="${escapeHtml(css)}">${renderDocumentText(tableLayoutCellContent(data,cell))}</${tag}>`
    }).join('')
    return `<tr style="height:${row.height}px">${cells}</tr>`
  }
  const header = layout.rows.filter(row => row.isHeader).map(rowHtml).join('')
  const body = layout.rows.filter(row => !row.isHeader).map(rowHtml).join('')
  return `<table style="border-collapse:collapse;table-layout:fixed;width:${layout.width}px">${data.caption ? `<caption>${renderDocumentText(data.caption)}</caption>`:''}<colgroup>${columns}</colgroup>${header ? `<thead>${header}</thead>` : ''}<tbody>${body}</tbody></table>`
}
