import { describe, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { courseAuthorFieldTarget, containsTarget, mapExternalCourseTextTarget, readTarget, targetFootprint } from '../../src/core/tools/ToolTargets'
import { executionSelectionTargetSchema } from '../../src/shared/workbench/executionDesktop'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import type { DocumentModel } from '../../src/shared/workbench/document'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { elementCardKey } from '../../src/renderer/workbench/elementCards/elementCardController'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
function fixture(source='<h1>Same</h1><p>Same</p>') {
  const project=createBlankCourseProjectV10('Precise'),surfaceId=project.surfaces[0].id
  project.definitions[WEB_DEFINITION.id]=structuredClone(WEB_DEFINITION)
  project.instances.box={id:'box',definitionId:WEB_DEFINITION.id,data:{html:source},frame:{width:300,height:200,transform:[1,0,0,1,0,0]}}
  project.surfaces[0].childIds=['box']
  const model:DocumentModel={kind:'course-v10',project,resources:{assets:{},components:{}}}
  const spot:ComponentAuthorSpot={id:'s',instanceId:'box',kind:'text',mountGeneration:1,initialValue:'Same',localBounds:{width:10,height:10,transform:[1,0,0,1,0,0]},sourceRegion:{kind:'data',path:['html'],start:4,end:8,encoding:'html-text'}}
  return {model,project,spot,surfaceId,target:courseAuthorFieldTarget(surfaceId,spot)}
}
async function harness(f=fixture()){
 const driver=new CourseV10Driver();let seq=0
 const registry=new DocumentRegistry({persistence:{async append(){},async save(){throw Error('unused')}},drivers:[driver],createId:()=>String(++seq),bindingKey:b=>b.path})
 const session=await registry.create(f.model,'author.glx'),gateway=new DocumentToolGateway(registry,[driver],()=>String(++seq))
 await gateway.beginRun({runId:'r',actor:'agent',documents:[{documentId:session.documentId,writable:[f.target]}]})
 const handle=await gateway.issueTarget('r',session.documentId,f.target)
 return {...f,driver,registry,session,gateway,handle}
}
describe('A01 exact author field targets',()=>{
 it('serializes only field identity and never grants the object or sibling',()=>{
  const f=fixture();expect(executionSelectionTargetSchema.parse(f.target)).toEqual(f.target)
  expect(elementCardKey('doc',f.target)).not.toBe(elementCardKey('doc',{kind:'course-instance',surfaceId:f.surfaceId,instanceId:'box'}))
  expect(f.target.authorField).not.toHaveProperty('localBounds')
  expect(readTarget(f.model,f.target)).toBe('Same')
  expect(containsTarget(f.target,{kind:'course-instance',surfaceId:f.surfaceId,instanceId:'box'},f.model)).toBe(false)
  expect(containsTarget(f.target,{...f.target,authorField:{...f.target.authorField!,sourceRegion:{...f.spot.sourceRegion!,start:16,end:20}}},f.model)).toBe(false)
  expect(containsTarget({kind:'course-instance',surfaceId:f.surfaceId,instanceId:'box'},f.target,f.model)).toBe(true)
 })
 it('retains native dataPath scope and allows image references without whole-object replacement authority',()=>{
  const f=fixture();f.project.instances.box.data={title:'Same',neighbor:'Same',assetId:'image-asset'}
  const text=courseAuthorFieldTarget(f.surfaceId,{...f.spot,sourceRegion:undefined,dataPath:['title']})
  expect(text).toMatchObject({dataPath:['title'],fieldScope:'data'});expect(text.authorField).toBeUndefined()
  expect(readTarget(f.model,text)).toBe('Same')
  expect(containsTarget(text,{...text,dataPath:['neighbor']},f.model)).toBe(false)
  const image=courseAuthorFieldTarget(f.surfaceId,{...f.spot,kind:'image',sourceRegion:undefined,dataPath:['assetId'],initialValue:'image-asset'})
  expect(readTarget(f.model,image)).toBe('image-asset')
  expect(containsTarget(image,{kind:'course-instance',surfaceId:f.surfaceId,instanceId:'box'},f.model)).toBe(false)
 })
 it('relocates exact source addresses after a disjoint insertion and conflicts on overlap',()=>{
  const f=fixture(),next=structuredClone(f.model);next.project.instances.box.data={html:'<!--prefix--><h1>Same</h1><p>Other</p>'}
  const mapped=mapExternalCourseTextTarget(f.model,next,f.target)
  expect(readTarget(next,mapped)).toBe('Same');expect(targetFootprint(next,mapped)).toBe(targetFootprint(f.model,f.target))
  next.project.instances.box.data={html:'<h1>Changed</h1><p>Same</p>'}
  expect(()=>mapExternalCourseTextTarget(f.model,next,f.target)).toThrow()
 })
 it('writes the source field through Gateway and preserves the equal-text neighbor',async()=>{
  const h=await harness()
  const result=await h.gateway.execute('r','replace',{name:'text.replace',input:{target:h.handle,content:'Only title'}})
  expect(result).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Only title</h1><p>Same</p>'}}}}})
  expect(h.session.read().undoDepth).toBe(1)
  const continued=await continueDocumentTargets(h.session,{documentId:h.session.documentId,epoch:h.session.read().epoch,revision:0,writable:[h.target]},new Set(['r']))
  expect(readTarget(h.session.read().model,continued.writable[0])).toBe('Only title')
  const second=await h.gateway.execute('r','again',{name:'text.replace',input:{target:result.kind==='document-operation'?result.affected?.[0]:h.handle,content:'Twice'}})
  expect(second).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Twice</h1><p>Same</p>'}}}}})
 })
 it('keeps author records out of component data and edits only the chosen record',async()=>{
  const f=fixture();const binding={kind:'dom' as const,path:[{tag:'h1',index:0}],baseline:'Same'}
  f.spot={...f.spot,sourceRegion:undefined,authorKey:'title',binding,bindingStatus:'bound',fieldScope:'authoring',dataPath:['records','title','overrides','text']}
  f.project.instances.box.authoring={records:{title:{kind:'text',binding,overrides:{}},other:{kind:'text',binding:{...binding,path:[{tag:'p',index:0}]},overrides:{text:'Same'}}}}
  f.target=courseAuthorFieldTarget(f.surfaceId,f.spot)
  const h=await harness(f),result=await h.gateway.execute('r','record',{name:'text.replace',input:{target:h.handle,content:'Title only'}})
  expect(result).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Same</h1><p>Same</p>'},authoring:{records:{title:{overrides:{text:'Title only'}},other:{overrides:{text:'Same'}}}}}}}})
 })
 it('keeps affected author addresses current after a reverse-order batch before continuing a field',async()=>{
  const h=await harness(),tail=courseAuthorFieldTarget(h.surfaceId,{...h.spot,id:'tail',sourceRegion:{...h.spot.sourceRegion!,start:16,end:20}})
  await h.gateway.beginRun({runId:'batch',actor:'agent',documents:[{documentId:h.session.documentId,writable:[h.target,tail]}]})
  const headingHandle=await h.gateway.issueTarget('batch',h.session.documentId,h.target)
  const tailHandle=await h.gateway.issueTarget('batch',h.session.documentId,tail)
  const result=await h.gateway.execute('batch','reverse-order',{name:'batch',input:{operations:[
    {name:'text.replace',input:{target:tailHandle,content:'Tail'}},
    {name:'text.replace',input:{target:headingHandle,content:'Very long heading'}},
  ]}})
  expect(result).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  if(result.kind!=='document-operation')throw Error('Expected applied batch')
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Very long heading</h1><p>Tail</p>'}}}}})
  expect(h.session.read().undoDepth).toBe(1)
  expect(await h.gateway.execute('batch','read-tail',{name:'read',input:{target:result.affected[0]}})).toMatchObject({kind:'read',data:{text:'Tail'}})
  expect(await h.gateway.execute('batch','read-heading',{name:'read',input:{target:result.affected[1]}})).toMatchObject({kind:'read',data:{text:'Very long heading'}})
  expect(await h.gateway.execute('batch','continue-tail',{name:'text.replace',input:{target:result.affected[0],content:'Tail2'}}))
    .toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Very long heading</h1><p>Tail2</p>'}}}}})
 })
 it('retains source-field identity when its existing geometry record advances the binding baseline',async()=>{
  const f=fixture(),binding={kind:'dom' as const,path:[{tag:'h1',index:0}],baseline:'Same'}
  f.spot={...f.spot,authorKey:'title',binding,bindingStatus:'bound'}
  f.project.instances.box.authoring={records:{title:{kind:'text',binding,overrides:{geometry:{translateX:8}}}}}
  f.target=courseAuthorFieldTarget(f.surfaceId,f.spot)
  const h=await harness(f),first=await h.gateway.execute('r','source-record',{name:'text.replace',input:{target:h.handle,content:'Changed'}})
  expect(first).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  const next=await h.gateway.execute('r','source-record-again',{name:'text.replace',input:{target:first.kind==='document-operation'?first.affected[0]:h.handle,content:'Again'}})
  expect(next).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<h1>Again</h1><p>Same</p>'},authoring:{records:{title:{binding:{baseline:'Again'},overrides:{geometry:{translateX:8}}}}}}}}})
 })
 it.each(['definition','override'])('uses exact %s Source address and preserves its surrounding program',async owner=>{
  const f=fixture(),source='const title="Same"; const neighbor="Same";'
  const implementation={kind:'source' as const,language:'javascript' as const,source}
  if(owner==='override')f.project.instances.box.implementationOverride=implementation
  else f.project.definitions[WEB_DEFINITION.id].implementation=implementation
  f.spot={...f.spot,sourceRegion:{kind:'implementation',start:13,end:17}}
  f.target=courseAuthorFieldTarget(f.surfaceId,f.spot)
  const h=await harness(f),result=await h.gateway.execute('r','source',{name:'text.replace',input:{target:h.handle,content:'New title'}})
  expect(result).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{implementationOverride:{source:'const title="New title"; const neighbor="Same";'}}}}})
 })
 it('keeps quoted multiline Source text decoded across an acknowledged follow-up without changing its neighbor',async()=>{
  const f=fixture(),source='const title="Same"; const neighbor="Same";'
  f.project.definitions[WEB_DEFINITION.id].implementation={kind:'source',language:'javascript',source}
  f.spot={...f.spot,sourceRegion:{kind:'implementation',start:13,end:17}}
  f.target=courseAuthorFieldTarget(f.surfaceId,f.spot)
  const h=await harness(f),content='He said "Hello"\nsecond \\ line'
  const first=await h.gateway.execute('r','quoted-source',{name:'text.replace',input:{target:h.handle,content}})
  expect(first).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  if(first.kind!=='document-operation')throw Error('Expected Source replacement')
  expect(await h.gateway.execute('r','read-quoted-source',{name:'read',input:{target:first.affected[0]}}))
    .toMatchObject({kind:'read',data:{text:content}})
  const values=()=>{
    const model=h.session.read().model
    if(model.kind!=='course-v10')throw Error('Expected V10')
    const implementation=model.project.instances.box.implementationOverride
    if(implementation?.kind!=='source')throw Error('Expected local Source')
    return new Function(`${implementation.source}; return [title, neighbor]`)()
  }
  expect(values()).toEqual([content,'Same'])
  const nextContent='Second "quote"\nnext line'
  const next=await h.gateway.execute('r','quoted-source-followup',{name:'text.replace',input:{target:first.affected[0],content:nextContent}})
  expect(next).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  if(next.kind!=='document-operation')throw Error('Expected Source follow-up')
  expect(await h.gateway.execute('r','read-source-followup',{name:'read',input:{target:next.affected[0]}}))
    .toMatchObject({kind:'read',data:{text:nextContent}})
  expect(values()).toEqual([nextContent,'Same'])
 })
 it('keeps a frozen field writable after a neighbor change, while read coverage detects a changed field',async()=>{
  const h=await harness();await h.gateway.execute('r','observe',{name:'read',input:{target:h.handle}})
  const before=h.session.read();if(before.model.kind!=='course-v10')throw Error('fixture')
  await h.session.execute({documentId:before.documentId,epoch:before.epoch,baseRevision:before.revision,operationId:'human',actor:'human',mutation:{type:'command',command:captureComponentOperation(before.model.project,[{type:'data.set',instanceId:'box',path:['html'],value:'<!--new--><h1>Same</h1><p>Neighbor edited</p>'}])}})
  const result=await h.gateway.execute('r','after-neighbor',{name:'text.replace',input:{target:h.handle,content:'Title'}})
  expect(result).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<!--new--><h1>Title</h1><p>Neighbor edited</p>'}}}}})
  const now=h.session.read();if(now.model.kind!=='course-v10')throw Error('fixture')
  await h.session.execute({documentId:now.documentId,epoch:now.epoch,baseRevision:now.revision,operationId:'overlap',actor:'human',mutation:{type:'command',command:captureComponentOperation(now.model.project,[{type:'data.set',instanceId:'box',path:['html'],value:'<!--new--><h1>Human title</h1><p>Neighbor edited</p>'}])}})
  const rejected=await h.gateway.execute('r','overwritten',{name:'text.replace',input:{target:result.kind==='document-operation'?result.affected[0]:h.handle,content:'BAD'}})
  expect(rejected.kind).toBe('error')
  expect(h.session.read().model).toMatchObject({project:{instances:{box:{data:{html:'<!--new--><h1>Human title</h1><p>Neighbor edited</p>'}}}}})
 })
 it('does not authorize whole-object mutations from a field handle',async()=>{
  const h=await harness()
  const result=await h.gateway.execute('r','wide',{name:'object.update',input:{target:h.handle,properties:{name:'wide'}}})
  expect(result.kind).toBe('error');expect(h.session.read().undoDepth).toBe(0)
 })
})
