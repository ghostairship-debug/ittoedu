// @vitest-environment node
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {expect,it} from 'vitest'
import {DocumentRegistry} from '../../src/core/documents/DocumentRegistry'
import {CourseV10Driver} from '../../src/core/drivers/CourseV10Driver'
import {DocumentToolGateway} from '../../src/core/tools/DocumentToolGateway'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {createTextComponentData} from '../../src/components/text/data'
import {createTableData} from '../../src/components/table/data'
import {captureComponentOperation} from '../../src/core/drivers/courseV10Operations'
import {prepareMeasurementDocument} from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import {prepareExistingObjectLayout,existingLayoutChanges,type ExistingLayoutRequest} from '../../src/core/course/existingObjectLayout'
import type {ComponentEdit} from '../../src/shared/contracts/component-platform/operations'
import {componentSurfaces} from '../../src/shared/contracts/component-platform/project'
const json=(value:unknown)=>JSON.parse(JSON.stringify(value))
function fixture(){const p=createBlankCourseProjectV10('既有对象大重排'),surfaceId=componentSurfaces(p)[0]!.id
 for(const key of ['text','table'])p.definitions[key]={id:key,role:'content',implementation:{kind:'builtin',key:'guoling.'+key}}
 p.definitions.runtime={id:'runtime',role:'content',implementation:{kind:'source',language:'javascript',source:'export default {mount(){throw new Error("measurement must never execute runtime")}}'}}
 const frame=(x:number,y:number,w:number,h:number)=>({width:w,height:h,transform:[1,0,0,1,x,y] as [number,number,number,number,number,number]})
 p.instances.title={id:'title',definitionId:'text',data:json(createTextComponentData('已由人工修改的标题')),frame:frame(20,20,400,70)}
 p.instances.copy={id:'copy',definitionId:'text',data:json(createTextComponentData('当前正文 '.repeat(45))),frame:frame(20,120,450,180)}
 p.instances.table={id:'table',definitionId:'table',data:json(createTableData()),frame:frame(500,100,380,220)}
 p.instances.runtime={id:'runtime',definitionId:'runtime',data:{seed:31,currentValue:7},frame:frame(500,380,380,180)}
 p.instances.outside={id:'outside',definitionId:'text',data:json(createTextComponentData('范围外内容')),frame:frame(20,650,450,50)}
 p.instances[surfaceId].childIds=['title','copy','table','runtime','outside'];return{p,surfaceId}}
const template='<style>body{margin:0}main{display:grid;grid-template-columns:360px 480px;gap:24px;padding:48px} [data-layout-ref="0"]{grid-column:1/-1} [data-layout-ref="1"]{grid-row:2/4} [data-layout-ref="2"]{height:220px} [data-layout-ref="3"]{height:180px}</style><main><div data-layout-ref="0"></div><div data-layout-ref="1"></div><div data-layout-ref="2"></div><div data-layout-ref="3"></div></main>'
it('real browser layout uses current content, preserves IDs and Source, remeasures concurrent text, merges unrelated data and rejects human geometry without replay',async()=>{
 const out=resolve('output/creation-editing-completion-20261029/layout-only');await mkdir(out,{recursive:true})
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:720}})
 const built=await build({stdin:{contents:'export {installExistingLayoutSlots} from "./src/main/workbench/contentApply/measurement/measureExistingLayoutSlots";export {captureHtmlDesignViewport} from "./src/main/workbench/contentApply/measurement/browserCapture";',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'ExistingLayoutBrowser',write:false,logLevel:'silent'})
 await page.goto('about:blank');await page.addScriptTag({content:built.outputFiles[0].text})
 const {p,surfaceId}=fixture(),driver=new CourseV10Driver(),registry=new DocumentRegistry({drivers:[driver],createId:randomUUID,bindingKey:b=>b.path,persistence:{async append(){},async save(){throw new Error('explicit archive test writes serialized file directly')}}})
 const session=await registry.create({kind:'course-v10',project:p,resources:{assets:{},components:{}}},'layout.glx')
 let calls=0,beforeMeasure:((request:ExistingLayoutRequest)=>Promise<void>)|undefined
 const measure=async(request:ExistingLayoutRequest)=>{
  calls++;await beforeMeasure?.(request)
  const prepared=prepareMeasurementDocument({html:request.html,resourceUrls:request.resourceUrls})
  await page.setViewportSize(request.viewport);await page.setContent(prepared.html)
  return page.evaluate(async request=>{
   const api=(window as any).ExistingLayoutBrowser;await api.installExistingLayoutSlots(request.slots,request.resourceUrls)
   const capture=await api.captureHtmlDesignViewport(1000)
   return request.slots.map(slot=>{const node=capture.elements.find((e:any)=>e.attributes['data-layout-ref']===slot.key);if(!node?.frame||node.geometryIssue)throw Error('invalid slot '+slot.key);return {key:slot.key,frame:node.frame,order:capture.elements.indexOf(node)}})
  },request)
 }
 const gateway=new DocumentToolGateway(registry,[driver],randomUUID,{measureExistingLayout:measure})
 const start=async(runId:string)=>{await gateway.beginRun({runId,actor:'agent',documents:[{documentId:session.documentId,writable:[{kind:'course-surface',surfaceId}]}]});return Promise.all(['title','copy','table','runtime'].map(instanceId=>gateway.issueTarget(runId,session.documentId,{kind:'course-instance',surfaceId,instanceId})))}
 const snapshot=()=>{const s=session.read();if(s.model.kind!=='course-v10')throw Error('wrong model');return{...s,model:s.model}}
 const human=async(edits:ComponentEdit[])=>{const before=snapshot();return session.execute({documentId:before.documentId,epoch:before.epoch,baseRevision:before.revision,operationId:randomUUID(),actor:'human',mutation:{type:'command',command:captureComponentOperation(before.model.project,edits)}})}
 try{
  const refs=await start('initial'),before=snapshot()
  const applied=await gateway.execute('initial','first',{name:'object.layout',input:{targets:refs,intent:{kind:'reflow',html:template}}})
  expect(applied,JSON.stringify(applied)).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  const after=snapshot();expect(Object.keys(after.model.project.instances)).toEqual(Object.keys(before.model.project.instances));expect(after.model.project.instances[surfaceId].childIds).toEqual(before.model.project.instances[surfaceId].childIds)
  for(const id of ['title','copy','table','runtime']){expect(after.model.project.instances[id].data).toEqual(before.model.project.instances[id].data);expect(after.model.project.instances[id].definitionId).toBe(before.model.project.instances[id].definitionId)}
  expect(after.model.project.definitions).toEqual(before.model.project.definitions);expect(after.model.project.instances.outside).toEqual(before.model.project.instances.outside)
  expect(after.model.project.instances.title.frame!.transform.slice(4)).toEqual([48,48]);expect(after.model.project.instances.copy.frame!.width).toBe(360)
  expect(after.undoDepth-before.undoDepth).toBe(1);await page.screenshot({path:join(out,'temporary-layout.png')})
  await writeFile(join(out,'layout.glx'),await driver.serialize(after.model));expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  // Native text is remeasured, not overwritten or sent through the model again.
  let edited=false;const second=await start('text-race'),count=calls
  beforeMeasure=async()=>{if(edited)return;edited=true;await human([{type:'data.set',instanceId:'copy',path:[],value:json(createTextComponentData('重排过程中人工增加的正文 '.repeat(80)))}])}
  const race=await gateway.execute('text-race','text-race',{name:'object.layout',input:{targets:second,intent:{kind:'reflow',html:template}}})
  expect(race,JSON.stringify(race)).toMatchObject({kind:'document-operation',result:{status:'applied'}});expect(calls-count).toBe(2)
  expect(JSON.stringify(snapshot().model.project.instances.copy.data)).toContain('重排过程中人工增加的正文')
  // A bounded Runtime's independent author data does not invalidate known frame geometry.
  const third=await start('data-race');edited=false;const beforeCalls=calls
  beforeMeasure=async()=>{if(edited)return;edited=true;await human([{type:'data.set',instanceId:'runtime',path:['currentValue'],value:99}])}
  const merged=await gateway.execute('data-race','data-race',{name:'object.layout',input:{targets:third,intent:{kind:'reflow',html:template}}})
  expect(merged,JSON.stringify(merged)).toMatchObject({kind:'document-operation'});expect(calls-beforeCalls).toBe(1);expect(snapshot().model.project.instances.runtime.data).toMatchObject({currentValue:99})
  // A moved object is not overwritten by an older candidate.
  const fourth=await start('frame-race');edited=false
  beforeMeasure=async()=>{if(edited)return;edited=true;const current=snapshot().model.project.instances.table.frame!;await human([{type:'frame.set',instanceId:'table',frame:{...current,transform:[...current.transform.slice(0,4),333,444] as any}}])}
  const conflict=await gateway.execute('frame-race','frame-race',{name:'object.layout',input:{targets:fourth,intent:{kind:'reflow',html:template}}})
  expect(conflict).toMatchObject({kind:'error',code:'layout-conflict'});expect(snapshot().model.project.instances.table.frame!.transform.slice(4)).toEqual([333,444])
  beforeMeasure=undefined
  const cancelRefs=await start('cancel');beforeMeasure=async()=>{await gateway.stop('cancel')}
  const canceled=await gateway.execute('cancel','cancel',{name:'object.layout',input:{targets:cancelRefs,intent:{kind:'reflow',html:template}}})
  expect(canceled).toMatchObject({kind:'error',code:'run-stopped'})
  await writeFile(join(out,'result.json'),JSON.stringify({status:'passed',realBrowserMeasurements:calls,identities:true,content:true,Source:true,oneHistory:true,concurrentTextRemeasured:true,unrelatedDataMerged:true,geometryConflict:true,cancel:true},null,2))
 }finally{await browser.close()}
},60_000)
it('missing/duplicate references and embedded content reject without inventing deletes, while current native text and bounded runtime remain distinct',()=>{
 const {p}=fixture(),ids=['title','copy','table','runtime'],resources={assets:{},components:{}}
 expect(()=>prepareExistingObjectLayout(p,resources,ids,'<div data-layout-ref="0"></div>')).toThrow(/每个targets/)
 expect(()=>prepareExistingObjectLayout(p,resources,ids,template.replace('<div data-layout-ref="1"','<div data-layout-ref="0"'))).toThrow(/重复/)
 expect(()=>prepareExistingObjectLayout(p,resources,ids,template.replace('data-layout-ref="0"></div>','data-layout-ref="0">重写内容</div>'))).toThrow(/留空/)
 const request=prepareExistingObjectLayout(p,resources,ids,template);expect(request.slots[0].html).toContain('已由人工修改');expect(request.slots[3].html).toBe('')
 const current=structuredClone(p);(current.instances.runtime.data as any).currentValue=33;expect(existingLayoutChanges(p,current,request)).toBe('none')
 current.instances.copy.data=json(createTextComponentData('新正文'));expect(existingLayoutChanges(p,current,request)).toBe('remeasure')
 current.instances.title.frame!.transform[4]+=1;expect(existingLayoutChanges(p,current,request)).toBe('conflict')
})

// An ancestor can change its owner without changing any of its own fields.
// Measuring a child before that move must not silently adopt the stale layout.
it('rejects a concurrent ancestor reparent even when every tracked frame and child list is unchanged',()=>{
 const {p,surfaceId}=fixture(),resources={assets:{},components:{}}
 p.definitions.group={id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}
 p.instances.parent={id:'parent',definitionId:'group',data:{},childIds:['title'],frame:{width:500,height:200,transform:[1,0,0,1,30,40]}}
 p.instances.destination={id:'destination',definitionId:'group',data:{},childIds:[],frame:{width:800,height:500,transform:[1,0,0,1,250,100]}}
 p.instances[surfaceId].childIds=['parent','destination','copy','table','runtime','outside']
 const request=prepareExistingObjectLayout(p,resources,['title'],'<div data-layout-ref="0"></div>')
 const current=structuredClone(p)
 current.instances[surfaceId].childIds=current.instances[surfaceId].childIds!.filter(id=>id!=='parent')
 current.instances.destination.childIds=['parent']
 expect(current.instances.parent).toEqual(p.instances.parent)
 expect(current.instances.title).toEqual(p.instances.title)
 expect(existingLayoutChanges(p,current,request)).toBe('conflict')
})
