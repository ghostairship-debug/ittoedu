import * as commands from '../../renderer/course/tableContentOperations'
import type { NativeTableCellStyle, NativeTableStyle } from '../../shared/contracts/native-v1/types'
import type { TableMergeRegion } from '../../shared/tableMerge'
import { parseTableData, toNativeTableData, tableCellContent, type TableData } from './data'
import type { NativeTableContent } from '../../shared/contracts/native-v1/types'
import type { FlowTextContent } from '../../shared/document/content'

export type TableEdit =
  | { kind: 'cell-text'; cellId: string; text: string }
  | { kind: 'cell-content'; cellId: string; content: FlowTextContent }
  | { kind: 'last-cell-append'; cellId:string; content:FlowTextContent }
  | { kind: 'cell-style'; cellId: string; stylePatch: Partial<NativeTableCellStyle> }
  | { kind: 'table-style'; stylePatch: Partial<NativeTableStyle> }
  | { kind: 'row-height'; rowId: string; height: number }
  | { kind: 'column-width'; columnId: string; width: number }
  | { kind: 'merge'; region: TableMergeRegion }
  | { kind: 'split'; rowId: string; columnId: string }
  | { kind: 'insert-row'; referenceRowId: string; position: 'before' | 'after' }
  | { kind: 'delete-row'; rowId: string }
  | { kind: 'reorder-rows'; orderedRowIds: readonly string[] }
  | { kind: 'insert-column'; referenceColumnId: string; position: 'before' | 'after'; width?: number }
  | { kind: 'delete-column'; columnId: string }
  | { kind: 'reorder-columns'; orderedColumnIds: readonly string[] }

/** A pure data proposal; the host submits it through its existing transaction/history. */
export function editTableData(source: TableData, edit: TableEdit): TableData {
  const data = parseTableData(source)
  if(edit.kind==='cell-content' || edit.kind==='last-cell-append') {
    let found=false
    const next={...data,rows:data.rows.map(row=>({...row,cells:row.cells.map(cell=>{
      if(cell.id!==edit.cellId)return cell
      found=true;const {text:_text,content:_content,...fields}=cell
      return {...fields,content:edit.content}
    })}))}
    if(!found)throw new Error('表格单元格已不存在')
    if(edit.kind==='cell-content')return parseTableData(next)
    const appended=commands.commitTableLastCellAndAppendRow(toNativeTableData(next,false),{cellId:edit.cellId,text:toNativeTableData(next,false).rows.flatMap(row=>row.cells).find(cell=>cell.id===edit.cellId)!.text})
    return parseTableData(restoreRich(next,appended.table))
  }
  const native=toNativeTableData(data,false)
  let next:NativeTableContent
  switch (edit.kind) {
    case 'cell-text': next=commands.patchTableCellText(native, edit); break
    case 'cell-style': next=commands.patchTableCellStyle(native, edit); break
    case 'table-style': next=commands.patchTableStyle(native, edit); break
    case 'row-height': next=commands.patchTableRowHeight(native, edit); break
    case 'column-width': next=commands.patchTableColumnWidth(native, edit); break
    case 'merge': next=commands.mergeTableCells(native, edit.region); break
    case 'split': next=commands.splitTableCells(native, edit); break
    case 'insert-row': next=commands.insertTableRow(native, edit); break
    case 'delete-row': next=commands.deleteTableRow(native, edit); break
    case 'reorder-rows': next=commands.reorderTableRows(native, edit); break
    case 'insert-column': next=commands.insertTableColumn(native, edit); break
    case 'delete-column': next=commands.deleteTableColumn(native, edit); break
    case 'reorder-columns': next=commands.reorderTableColumns(native, edit); break
  }
  const restored=restoreRich(data,next)
  if(edit.kind==='cell-text') {
    for(const row of restored.rows)for(const cell of row.cells)if(cell.id===edit.cellId){delete cell.content;cell.text=edit.text}
  }
  if(edit.kind==='merge') {
    const cells=edit.region.rowIds.flatMap(rowId=>edit.region.columnIds.map(columnId=>data.rows.find(row=>row.id===rowId)?.cells.find(cell=>cell.columnId===columnId))).filter((cell):cell is NonNullable<typeof cell>=>Boolean(cell))
    const rich=cells.some(cell=>cell.content)
    if(rich) {
      const inlines=cells.flatMap((cell,index)=>[...(index ? [{type:'text' as const,text:'\n'}]:[]),...tableCellContent(cell).inlines])
      for(const row of restored.rows)for(const cell of row.cells)if(edit.region.rowIds.includes(row.id)&&edit.region.columnIds.includes(cell.columnId)) {
        delete cell.text;cell.content={inlines:row.id===edit.region.rowIds[0]&&cell.columnId===edit.region.columnIds[0] ? inlines:[]}
      }
    }
  }
  return parseTableData(restored)
}
function restoreRich(source:TableData,native:NativeTableContent):TableData {
  const cells=new Map(source.rows.flatMap(row=>row.cells).map(cell=>[cell.id,cell]))
  return {...native,...(source.caption ? {caption:source.caption}:{}),...(source.headerEnabled!==undefined ? {headerEnabled:source.headerEnabled}:{}),columns:native.columns.map(column=>({...column,...(source.columns.find(value=>value.id===column.id)?.header ? {header:source.columns.find(value=>value.id===column.id)!.header}:{})})),
    rows:native.rows.map(row=>({...row,cells:row.cells.map(cell=>{const original=cells.get(cell.id);if(!original?.content)return cell;const {text:_text,...fields}=cell;return {...fields,content:original.content}})}))}
}
