import { expect, it } from 'vitest'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { flowDocumentEdits, projectFlowDocument,isDocumentBlock } from '../../src/core/components/document/flowDocumentProjection'
import { flowProfessionalTextStyleEdits } from '../../src/renderer/componentPlatform/surfaces/flow/documentSelection'
import { createTableData,parseTableData } from '../../src/components/table/data'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import {parseDocumentMarkdown,serializeDocumentMarkdown} from '../../src/shared/document/markdown'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const text = (id: string) => ({id,definitionId:TEXT_DEFINITION.id,data:JSON.parse(JSON.stringify(createTextComponentData(id)))})
it('inserts new Flow roots at their final reading slot without capturing a nonexistent owner',()=>{
  const project:CourseProjectV10={schemaVersion:10,id:'order',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION,[IMAGE_DEFINITION.id]:IMAGE_DEFINITION},
    instances:{a:text('a'),b:text('b'),float:{...text('float'),flowPlacement:{space:'paper',plane:'overlay'}}},
    surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['a','b','float']}],global:{underlay:[],overlay:[]},assets:{image:{id:'image',path:'assets/image.svg'}}}
  const body=projectFlowDocument(project,'flow').content.blocks
  const edits=flowDocumentEdits(project,'flow',[...body,{id:'new-image',type:'media',mediaKind:'image',assetId:'image',layout:'content-width'}])
  expect(edits.filter(edit=>edit.type==='instance.move' && edit.instanceId==='new-image')).toEqual([])
  const result=applyComponentOperation(project,captureComponentOperation(project,edits))
  expect(result.surfaces[0].childIds).toEqual(['a','b','new-image','float'])
  const interleaved={...project,surfaces:[{...project.surfaces[0],childIds:['a','float','b']}]}
  const reordered=applyComponentOperation(interleaved,captureComponentOperation(interleaved,
    flowDocumentEdits(interleaved,'flow',[body[1],{id:'new',type:'paragraph',content:{inlines:[{type:'text',text:'新正文'}]}},body[0]])))
  expect(reordered.surfaces[0].childIds).toEqual(['b','float','new','a'])
})
it.each(['instance-override','shared-rebound'] as const)('keeps %s text and table runtime implementations opaque while editing their professional data fields',mode=>{
  const source={kind:'source' as const,language:'javascript' as const,source:'export default ({ root }) => { root.textContent = "自定义视图" }'}
  const table=createTableData({rows:1,columns:1});table.rows[0].cells[0].text='单元';table.columns[0].header={inlines:[{type:'text',text:'表头'}]}
  const project:CourseProjectV10={schemaVersion:10,id:'override',revision:0,title:'Flow',definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION,[TABLE_DEFINITION.id]:TABLE_DEFINITION},
    instances:{body:{...text('body'),implementationOverride:source},table:{id:'table',definitionId:TABLE_DEFINITION.id,data:JSON.parse(JSON.stringify(table)),implementationOverride:source}},
    surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body','table']}],global:{underlay:[],overlay:[]},assets:{}}
  if(mode==='shared-rebound') {
    project.definitions={'library-text':{...TEXT_DEFINITION,id:'library-text',professionalBuiltinKey:TEXT_DEFINITION.id,implementation:source},'library-table':{...TABLE_DEFINITION,id:'library-table',professionalBuiltinKey:TABLE_DEFINITION.id,implementation:source}}
    project.instances.body.definitionId='library-text';project.instances.table.definitionId='library-table'
    delete project.instances.body.implementationOverride;delete project.instances.table.implementationOverride
  }
  expect(isDocumentBlock(project,project.instances.body)).toBe(true)
  const original=projectFlowDocument(project,'flow')
  expect(original.content.blocks.map(block=>block.type)).toEqual(['course-instance','course-instance'])
  const parsed=parseDocumentMarkdown(serializeDocumentMarkdown(original),{target:'flow',createId:()=>crypto.randomUUID()})
  if(parsed.status!=='valid')throw new Error('Opaque source invalid')
  expect(parsed.document.content.blocks.map(block=>block.id)).toEqual(['body','table'])
  const edits=[...flowProfessionalTextStyleEdits(project,'body',{bold:true}),...flowProfessionalTextStyleEdits(project,'table',{color:'#123456'})]
  expect(edits.every(edit=>edit.type==='data.set')).toBe(true)
  const edited=applyComponentOperation(project,captureComponentOperation(project,edits))
  expect(textComponentDataSchema.parse(edited.instances.body.data).content.inlines[0].style?.bold).toBe(true)
  const changed=parseTableData(edited.instances.table.data)
  expect(changed.columns[0].header!.inlines[0].style?.color).toBe('#123456');expect(changed.rows[0].cells[0].content!.inlines[0].style?.color).toBe('#123456')
  expect(edited.instances.body.implementationOverride).toEqual(project.instances.body.implementationOverride);expect(edited.instances.table.implementationOverride).toEqual(project.instances.table.implementationOverride)
  expect(edited.definitions).toEqual(project.definitions)
  expect(projectFlowDocument(edited,'flow').content.blocks).toEqual(original.content.blocks)
})
it('preserves a rebound professional definition and its authored fields during a body edit',()=>{
  const data=createTextComponentData('原文');data.appearance.color='#123456';data.appearance.fontSize=37
  const project:CourseProjectV10={schemaVersion:10,id:'alias',revision:0,title:'Flow',definitions:{library:{...TEXT_DEFINITION,id:'library'}},
    instances:{body:{id:'body',definitionId:'library',data:JSON.parse(JSON.stringify(data))}},
    surfaces:[{id:'flow',kind:'flow',title:'Flow',childIds:['body']}],global:{underlay:[],overlay:[]},assets:{}}
  const [block]=projectFlowDocument(project,'flow').content.blocks
  if(block.type!=='paragraph')throw new Error('Expected professional paragraph')
  block.content.inlines.push({type:'text',text:'新内容'})
  const edited=applyComponentOperation(project,captureComponentOperation(project,flowDocumentEdits(project,'flow',[block])))
  expect(edited.instances.body.definitionId).toBe('library')
  expect(textComponentDataSchema.parse(edited.instances.body.data).appearance).toEqual(data.appearance)
  expect(edited.definitions[TEXT_DEFINITION.id]).toBeUndefined()
})
