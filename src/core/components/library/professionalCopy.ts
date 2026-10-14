import type { JsonValue } from '../../../shared/contracts/component-platform/project'
import { documentTextSlots, type DocumentBlock, type FlowTextContent } from '../../../shared/document/content'

/** The native professional consumer owns inner formulas, list items and table row/column/cell identities. */
export function createProfessionalDocumentIdentityCopy(idMap:ReadonlyMap<string,string>,moving:boolean|((id:string)=>boolean)=false) {
  const professionalIds=new Map<string,string>(), sourceIdentities = new Set<string>()
  const professionalId=(id:string)=>{sourceIdentities.add(id);if(typeof moving === 'function' ? moving(id) : moving)return id;let next=professionalIds.get(id);if(!next){next=crypto.randomUUID();professionalIds.set(id,next)}return next}
  const professionalText=(content:FlowTextContent,collect=false)=>{for(const inline of content.inlines){
    for (const id of inline.rangeIds ?? []) professionalId(id)
    if (!collect && inline.rangeIds) inline.rangeIds = inline.rangeIds.map(professionalId)
    if (!collect && inline.type === 'component') inline.instanceId = idMap.get(inline.instanceId) ?? inline.instanceId
if(inline.type==='math'){if(collect)professionalId(inline.formulaId);else inline.formulaId=professionalId(inline.formulaId)}
    if(!collect && inline.link?.href.startsWith('#')){const old=inline.link.href.slice(1),id=idMap.get(old) ?? professionalIds.get(old);if(id)inline.link={...inline.link,href:`#${id}`}}}}
  const professionalData=(data:JsonValue,key:string|undefined,id:string,collect=false)=>{
    const value=data as Record<string,any>
    if(key==='guoling.text')professionalText(value.content,collect)
    else if(key==='guoling.formula') {if(collect)professionalId(value.formula.formulaId);else value.formula.formulaId=professionalId(value.formula.formulaId)}
    else if(key==='guoling.table') {
      for(const column of value.columns){const old=column.id;if(collect)professionalId(old);else column.id=professionalId(old);if(column.header)professionalText(column.header,collect)}
      for(const row of value.rows){const old=row.id;if(collect)professionalId(old);else row.id=professionalId(old)
        for(const cell of row.cells){if(collect)professionalId(cell.id);else {cell.id=professionalId(cell.id);cell.columnId=professionalId(cell.columnId)};if(cell.content)professionalText(cell.content,collect)}}
      if(value.caption)professionalText(value.caption,collect)
      if(!collect)for(const merge of value.merges ?? []){merge.rowIds=merge.rowIds.map(professionalId);merge.columnIds=merge.columnIds.map(professionalId)}
    } else if(key==='guoling.document-block') {
      const block={...value,id, ...(value.type==='section'?{blocks:[]}: {})} as DocumentBlock
      for(const slot of documentTextSlots(block))professionalText(slot.content,collect)
      if(block.type==='list')for(const item of block.items){if(collect)professionalId(item.id);else item.id=professionalId(item.id)}
      if(block.type==='formula'){if(collect)professionalId(block.formulaId);else value.formulaId=professionalId(block.formulaId)}
      if(block.type==='table'){
        for(const column of block.columns){if(collect)professionalId(column.id);else column.id=professionalId(column.id)}
        for(const row of block.rows){if(collect)professionalId(row.id);else {row.id=professionalId(row.id);row.cells=Object.fromEntries(Object.entries(row.cells).map(([column,content])=>[professionalId(column),content]))}}
        if(!collect)for(const merge of block.merges ?? []){merge.rowIds=merge.rowIds.map(professionalId);merge.columnIds=merge.columnIds.map(professionalId)}
      }
    }
    return data
  }
  return Object.assign(professionalData, { identity: professionalId, identities: professionalIds, sourceIdentities, path: (path: readonly string[]) => path.map(value => professionalIds.get(value) ?? value) })
}

