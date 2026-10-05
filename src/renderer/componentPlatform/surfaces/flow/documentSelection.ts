import { componentDefinitionBuiltinKey,type CourseProjectV10,type ComponentEdit,type JsonValue } from '../../../../shared/contracts/component-platform'
import type { TextRunStyle } from '../../../../shared/contracts/native-v1'
import {createTextComponentData,formatTextComponentRange,textComponentDataSchema} from '../../../../components/text/data'
import {parseTableData,tableCellContent} from '../../../../components/table/data'
import { documentTextLength,type FlowTextContent } from '../../../../shared/document/content'
import type { DocumentPoint, DocumentSelection,DocumentSlot } from '../../../../shared/document/ports'
import { courseInstanceSlotPath } from '../../../workbench/SelectionContextController'

function slotPath(project: CourseProjectV10, point: DocumentPoint): string[] | null {
  const instance = project.instances[point.blockId]
  if (!instance) return null
  try { return courseInstanceSlotPath(instance.data, point.slot) } catch { return null }
}
/** A field range is bound to the instance and exact professional data slot, never to a guessed body offset. */
export function flowRangeDataPath(project: CourseProjectV10, selection: DocumentSelection): {
  instanceId: string; root:'data'|'flowLayout'; path: string[]; from: number; to: number
} | null {
  if (selection.kind !== 'text' || selection.anchor.blockId !== selection.head.blockId) return null
  const instance=project.instances[selection.anchor.blockId]
  const key=instance && componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  const media=key && ['guoling.image','guoling.video','guoling.audio'].includes(key)
  if(media && selection.anchor.slot.kind==='field' && selection.head.slot.kind==='field' && selection.anchor.slot.field==='caption' && selection.head.slot.field==='caption' && instance?.flowLayout?.caption) {
    return {instanceId:instance.id,root:'flowLayout',path:['caption'],from:Math.min(selection.anchor.offset,selection.head.offset),to:Math.max(selection.anchor.offset,selection.head.offset)}
  }
  const anchor = slotPath(project, selection.anchor), head = slotPath(project, selection.head)
  if (!anchor || !head || anchor.join('/') !== head.join('/')) return null
  return { instanceId: selection.anchor.blockId, root:'data',path: anchor,
    from: Math.min(selection.anchor.offset, selection.head.offset), to: Math.max(selection.anchor.offset, selection.head.offset) }
}
/** Shared by the formal command and the property preview; caret style stays in the existing editor. */
export function flowTextStyleEdits(project:CourseProjectV10,selection:DocumentSelection,style:TextRunStyle):ComponentEdit[] {
  const range=flowRangeDataPath(project,selection)
  if(!range)throw new Error('请选择同一正文对象内的文字范围')
  if(range.from===range.to)return []
  const instance=project.instances[range.instanceId]
  let value:any=range.root==='flowLayout' ? instance.flowLayout:instance.data
  for(const key of range.path)value=value?.[key]
  if(typeof value!=='string' && !Array.isArray(value?.inlines))throw new Error('当前对象没有所选正文文字字段，请重新选择')
  const formatted=formatTextComponentRange(createTextComponentData(value),range.from,range.to,style).content
  if(JSON.stringify(formatted)===JSON.stringify(value))return []
  if(range.root==='flowLayout')return [{type:'instance.flowLayout.set',instanceId:instance.id,flowLayout:{...instance.flowLayout!,caption:formatted}}]
  if(typeof value==='string' && range.path.at(-1)==='text') {
    let cell:any=instance.data;const path=range.path.slice(0,-1);for(const key of path)cell=cell[key]
    const {text:_text,...fields}=cell
    return [{type:'data.set',instanceId:instance.id,path,value:JSON.parse(JSON.stringify({...fields,content:formatted})) as JsonValue}]
  }
  return [{type:'data.set',instanceId:instance.id,path:range.path,value:JSON.parse(JSON.stringify(formatted)) as JsonValue}]
}

/** Professional fields remain editable when their runtime is an opaque source implementation. */
export function flowProfessionalTextStyleEdits(project:CourseProjectV10,instanceId:string,style:TextRunStyle,range?:'all'|{start:number;end:number}):ComponentEdit[] {
  const instance=project.instances[instanceId],definition=instance && project.definitions[instance.definitionId]
  const key=componentDefinitionBuiltinKey(definition)
  const slots:{slot:DocumentSlot;content:FlowTextContent}[]=[]
  if(key==='guoling.text')slots.push({slot:{kind:'field',field:'content'},content:textComponentDataSchema.parse(instance.data).content})
  else if(key==='guoling.table') {
    const data=parseTableData(instance.data)
    for(const column of data.columns)if(column.header)slots.push({slot:{kind:'header',columnId:column.id},content:column.header})
    for(const row of data.rows)for(const cell of row.cells)slots.push({slot:{kind:'cell',rowId:row.id,columnId:cell.columnId},content:tableCellContent(cell)})
    if(data.caption)slots.push({slot:{kind:'field',field:'caption'},content:data.caption})
  } else throw new Error('当前对象没有可设置格式的专业文字字段')
  return slots.flatMap(({slot,content})=>{
    const from=typeof range==='object' ? range.start:0,to=typeof range==='object' ? range.end:documentTextLength(content)
    if(from===to)return []
    const point={blockId:instanceId,slot,affinity:'after' as const}
    return flowTextStyleEdits(project,{kind:'text',revision:String(project.revision),anchor:{...point,offset:from},head:{...point,offset:to}},style)
  })
}
