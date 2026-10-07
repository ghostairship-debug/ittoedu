import { useState } from 'react'
import type { ComponentEdit } from '../../shared/contracts/component-platform'
import { tableCellSpan } from '../../shared/tableMerge'
import { tableEdit } from './adapters'
import { tableCellContent, type TableData } from './data'
import type { TableEdit } from './edit'
import { layoutTable } from './render'
import { TextComponentEditor } from '../text/editor'
import { createTextComponentData } from '../text/data'
import { renderDocumentText } from '../../shared/document/render'

export interface TableComponentEditorProps {
  instanceId: string
  data: TableData
  /** The host acknowledges and projects the resulting formal data through props. */
  onEdit(edit: ComponentEdit): void | Promise<void>
  onUndo(): void
  onRedo(): void
}

export function TableComponentEditor({ instanceId, data, onEdit, onUndo, onRedo }: TableComponentEditorProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const layout = layoutTable(data)
  const cell = layout.cells.find(value => selected.includes(value.id)) ?? layout.cells[0]
  const row = data.rows.find(value => value.id === cell?.rowId)
  const column = data.columns.find(value => value.id === cell?.columnId)
  const formalCell = row?.cells.find(value=>value.id===cell?.id)
  const commit = async (edit: TableEdit) => {
    try { await onEdit(tableEdit(instanceId, data, edit)); setError(''); return true }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure }
  }
  // Toolbar operations report locally; rich-text drafts must receive the rejected ACK.
  const apply = (edit: TableEdit) => commit(edit).catch(() => {})
  const merge = () => {
    const chosen = layout.cells.filter(value => selected.includes(value.id))
    if (chosen.length < 2) { setError('按住 Shift 选择至少两个单元格'); return }
    const rowStart = Math.min(...chosen.map(value => value.rowIndex))
    const rowEnd = Math.max(...chosen.map(value => value.rowIndex + value.rowSpan - 1))
    const colStart = Math.min(...chosen.map(value => value.columnIndex))
    const colEnd = Math.max(...chosen.map(value => value.columnIndex + value.columnSpan - 1))
    void apply({ kind: 'merge', region: {
      rowIds: data.rows.slice(rowStart, rowEnd + 1).map(value => value.id),
      columnIds: data.columns.slice(colStart, colEnd + 1).map(value => value.id),
    } })
  }
  return <section aria-label="表格专业编辑">
    <table style={{ borderCollapse: 'collapse', width: layout.width }}>
      <colgroup>{layout.columns.map(value => <col key={value.id} style={{ width: value.width }} />)}</colgroup>
      <tbody>{layout.rows.map(value => <tr key={value.id} style={{ height: value.height }}>
        {value.cells.map(value => <td key={value.id} rowSpan={value.rowSpan} colSpan={value.columnSpan}
          style={{ border: `1px solid ${value.style.borderColor}`, padding: value.style.cellPadding,
            background: value.style.fillColor, color: value.style.textColor,
            fontSize: value.style.fontSize, fontFamily: value.style.fontFamily,
            fontWeight: value.style.bold ? 700 : 400, fontStyle: value.style.italic ? 'italic' : 'normal',
            textAlign: value.style.horizontalAlign, verticalAlign: value.style.verticalAlign,
            whiteSpace: 'pre-wrap', outline: selected.includes(value.id) ? '2px solid #2563eb' : undefined }}>
          <button type="button" aria-label={`选择单元格 ${value.rowIndex + 1},${value.columnIndex + 1}`}
            style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', width: '100%', minHeight: 24, textAlign: 'inherit', whiteSpace: 'pre-wrap' }}
            onClick={event => setSelected(event.shiftKey ? [...new Set([...selected, value.id])] : [value.id])}>
            {data.rows.flatMap(row=>row.cells).find(cell=>cell.id===value.id)?.content
              ? <span dangerouslySetInnerHTML={{__html:renderDocumentText(data.rows.flatMap(row=>row.cells).find(cell=>cell.id===value.id)!.content!)}}/>
              : value.text || '\u00a0'}
          </button>
        </td>)}
      </tr>)}</tbody>
    </table>
    {cell && row && column && <div>
      {formalCell && <section aria-label="单元格内容"><TextComponentEditor key={formalCell.id} data={createTextComponentData(tableCellContent(formalCell))} revision={JSON.stringify(tableCellContent(formalCell))}
        onChange={next=>commit({kind:'cell-content',cellId:formalCell.id,content:next.content})} onUndo={onUndo} onRedo={onRedo} onDiagnostic={setError}/></section>
      }
      <label>行高<input type="number" min={20} max={2000} value={row.height}
        onChange={event => void apply({ kind: 'row-height', rowId: row.id, height: event.target.valueAsNumber })} /></label>
      <label>列宽<input type="number" min={24} max={2000} value={column.width}
        onChange={event => void apply({ kind: 'column-width', columnId: column.id, width: event.target.valueAsNumber })} /></label>
      <label>字号<input type="number" min={6} max={144} value={cell.style.fontSize}
        onChange={event => void apply({ kind: 'cell-style', cellId: cell.id, stylePatch: { fontSize: event.target.valueAsNumber } })} /></label>
      <label>文字颜色<input type="color" value={cell.style.textColor}
        onChange={event => void apply({ kind: 'cell-style', cellId: cell.id, stylePatch: { textColor: event.target.value } })} /></label>
      <label>填充颜色<input type="color" value={cell.style.fillColor}
        onChange={event => void apply({ kind: 'cell-style', cellId: cell.id, stylePatch: { fillColor: event.target.value } })} /></label>
      <button type="button" onClick={() => void apply({ kind: 'cell-style', cellId: cell.id, stylePatch: { bold: !cell.style.bold } })}>粗体</button>
      <label>对齐<select value={cell.style.horizontalAlign} onChange={event => void apply({ kind: 'cell-style', cellId: cell.id,
        stylePatch: { horizontalAlign: event.target.value as 'left' | 'center' | 'right' } })}>
        <option value="left">左</option><option value="center">中</option><option value="right">右</option>
      </select></label>
      <button type="button" onClick={merge}>合并所选区域</button>
      <button type="button" disabled={tableCellSpan(data, row.id, column.id).rowSpan * tableCellSpan(data, row.id, column.id).columnSpan < 2}
        onClick={() => void apply({ kind: 'split', rowId: row.id, columnId: column.id })}>拆分</button>
      <button type="button" onClick={() => void apply({ kind: 'insert-row', referenceRowId: row.id, position: 'after' })}>下方插入行</button>
      <button type="button" onClick={() => void apply({ kind: 'delete-row', rowId: row.id })}>删除行</button>
      <button type="button" onClick={() => void apply({ kind: 'insert-column', referenceColumnId: column.id, position: 'after' })}>右侧插入列</button>
      <button type="button" onClick={() => void apply({ kind: 'delete-column', columnId: column.id })}>删除列</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
