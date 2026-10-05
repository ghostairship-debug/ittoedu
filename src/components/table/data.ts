import { z } from 'zod'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type { NativeTableContent, NativeTableCell, NativeTableColumn, NativeTableRow } from '../../shared/contracts/native-v1/types'
import { documentTextContentSchema, plainDocumentText, type FlowTextContent } from '../../shared/document/content'
import { nanoid } from 'nanoid'
export type TableCell = Omit<NativeTableCell,'text'> & ({text:string;content?:never}|{content:FlowTextContent;text?:never})
export type TableColumn = NativeTableColumn & {header?:FlowTextContent}
export type TableRow = Omit<NativeTableRow,'cells'> & {cells:TableCell[]}
export type TableData = Omit<NativeTableContent,'rows'|'columns'> & {rows:TableRow[];columns:TableColumn[];caption?:FlowTextContent;headerEnabled?:boolean}
const native = tableNativeContentObjectSchema
const cell = native.shape.rows.element.shape.cells.element
const richCell = cell.omit({text:true}).extend({content:documentTextContentSchema}).strict()
export function tableCellContent(value: TableCell): FlowTextContent { return value.content ?? {inlines:[{type:'text',text:value.text}]} }
export function tableLayoutCellContent(data:TableData,cell:{id:string;columnId:string;text:string}):FlowTextContent {
  const body=data.rows.flatMap(row=>row.cells).find(value=>value.id===cell.id)
  if(body)return tableCellContent(body)
  const header=cell.id===`flow_header_${cell.columnId}` ? data.columns.find(column=>column.id===cell.columnId)?.header : undefined
  return header ?? {inlines:[{type:'text',text:cell.text}]}
}
/** Disposable measurement/algorithm input. It is never written as a second author body. */
export function toNativeTableData(data:TableData, includeHeaders=true):NativeTableContent {
  const rows=data.rows.map(row=>({...row,cells:row.cells.map(cell=>{const {content,...fields}=cell;return {...fields,text:content ? plainDocumentText(content) : cell.text!}})}))
  const headers=includeHeaders && data.headerEnabled!==false && data.columns.some(column=>column.header)
  if(headers) rows.unshift({id:'flow_table_header',height:40,cells:data.columns.map(column=>({id:`flow_header_${column.id}`,columnId:column.id,text:plainDocumentText(column.header ?? {inlines:[]})}))})
  return {columns:data.columns.map(({header,...column})=>column),rows,headerRowCount:headers ? data.headerRowCount+1 : data.headerRowCount,style:data.style,...(data.merges ? {merges:data.merges}:{})}
}
export const tableDataSchema=z.object({...native.shape,columns:z.array(native.shape.columns.element.extend({header:documentTextContentSchema.optional()}).strict()).min(1).max(100),
  rows:z.array(native.shape.rows.element.extend({cells:z.array(z.union([cell,richCell])).min(1).max(100)}).strict()).max(1000),caption:documentTextContentSchema.optional(),headerEnabled:z.boolean().optional()}).strict().superRefine((data,ctx)=>{
  const result=tableNativeContentObjectSchema.safeParse(toNativeTableData(data as TableData))
  if(!result.success)for(const issue of result.error.issues)ctx.addIssue({code:'custom',message:issue.message,path:issue.path})
})
export function parseTableData(value:unknown):TableData{return tableDataSchema.parse(value) as TableData}
export function createTableData(options:{rows?:number;columns?:number;idFactory?:()=>string}={}):TableData {
  const id=options.idFactory ?? nanoid,columns=Array.from({length:options.columns ?? 3},()=>({id:`col_${id()}`,width:200}))
  return parseTableData({columns,rows:Array.from({length:options.rows ?? 3},()=>({id:`row_${id()}`,height:40,cells:columns.map(column=>({id:`cell_${id()}`,columnId:column.id,text:''}))})),headerRowCount:0,
    style:{fillColor:'#ffffff',fillOpacity:1,borderColor:'#d1d5db',borderOpacity:1,borderWidth:1,lineStyle:'solid',textColor:'#1f2937',fontFamily:'sans-serif',fontSize:16,horizontalAlign:'left',verticalAlign:'middle',cellPadding:8}})
}
