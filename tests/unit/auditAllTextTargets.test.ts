// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { containsTarget, flowTextSelectionTarget, formatCourseInstanceText, readEditableTargetContent } from '../../src/core/tools/ToolTargets'
import { ElementChangeTracker } from '../../src/main/workbench/execution/ElementChangeTracker'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { plainDocumentText } from '../../src/shared/document/content'
import { captureFlowSelection } from '../../src/renderer/workbench/SelectionContextController'
import { createCourseProductivityPreview, planCourseProductivityEdits } from '../../src/core/course/courseProductivityEdits'
import { courseObjectOrder, courseObjectOrderEdits } from '../../src/core/course/courseObjectEdits'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { createCourseDocumentClipboardContext,readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { createFormulaComponentData } from '../../src/components/text/data'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createProductivityPreview, applyProductivityPreview } from '../../src/renderer/authoring/productivity'
import { resolveComponentPresentation, type CourseProjectV10, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import type { DocumentToolGatewayOptions } from '../../src/core/tools/DocumentToolGateway'
import type { ProductivityContext } from '../../src/renderer/authoring/productivity'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
const text=(value:string)=>({inlines:[{type:'text' as const,text:value}]})
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as JsonValue
function project(flow=false){const value=createBlankCourseProjectV10();if(flow){value.surfaces[0].kind='flow';delete value.surfaces[0].designSize}
  value.definitions.text={id:'text',role:'mixed',implementation:{kind:'builtin',key:'guoling.text'}}
  for(const [id,content] of [['a','TARGET tail'],['b','SUMMARY']])value.instances[id]={id,definitionId:'text',data:json(createTextComponentData(content))}
  value.surfaces[0].childIds=['a','b'];return value}
async function fixture(value=project(),writable?:ToolTarget[],options:DocumentToolGatewayOptions={}) {
  const driver=new CourseV10Driver(),registry=new DocumentRegistry({drivers:[driver],createId:()=>crypto.randomUUID(),bindingKey:binding=>binding.path,persistence:{async append(){},async save(){throw new Error('unused')}}})
  const session=await registry.create({kind:'course-v10',project:value,resources:{assets:{},components:{}}},'audit.h5lesson'),gateway=new DocumentToolGateway(registry,[driver],()=>crypto.randomUUID(),options),surfaceId=value.surfaces[0].id
  await gateway.beginRun({runId:'run',actor:'agent',documents:[{documentId:session.documentId,writable:writable??[{kind:'document'}]}]})
  const issue=(target:ToolTarget)=>gateway.issueTarget('run',session.documentId,target)
  const execute=(name:string,input:Record<string,unknown>)=>gateway.execute('run',crypto.randomUUID(),{name,input} as Parameters<typeof gateway.execute>[2])
  const read=(target:string,other:Record<string,unknown>={})=>execute('read',{target,...other})
  const human=async(edits:ComponentEdit[])=>{const snapshot=session.read();if(snapshot.model.kind!=='course-v10')throw new Error('fixture');expect(await session.execute({documentId:snapshot.documentId,epoch:snapshot.epoch,baseRevision:snapshot.revision,actor:'human',operationId:crypto.randomUUID(),mutation:{type:'command',command:captureComponentOperation(snapshot.model.project,edits)}})).toMatchObject({status:'applied'})}
  const model=()=>{const value=session.read().model;if(value.kind!=='course-v10')throw new Error('fixture');return value}
  const target=(instanceId='a',extra:Record<string,unknown>={}):Extract<ToolTarget,{kind:'course-instance'}>=>({kind:'course-instance',surfaceId,instanceId,...extra})
  return {driver,session,gateway,surfaceId,issue,execute,read,human,model,target}
}
it('CA011 an exact range read survives human text appended outside it while an overlapping read blocks another write',async()=>{
  const value=project(),surfaceId=value.surfaces[0].id,range:ToolTarget={kind:'course-instance',surfaceId,instanceId:'a',dataPath:['content'],from:0,to:6},f=await fixture(value,[range,{kind:'course-instance',surfaceId,instanceId:'b'}])
  const handle=await f.issue(range);expect(await f.read(handle)).toMatchObject({kind:'read'})
  await f.human([{type:'data.set',instanceId:'a',path:['content'],value:json(text('TARGET tail human'))}])
  expect(await f.execute('text.replace',{target:handle,content:'EDITED'})).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(plainDocumentText(textComponentDataSchema.parse(f.model().project.instances.a.data).content)).toBe('EDITED tail human')
  const current=await f.issue({...range,to:6});await f.read(current)
  await f.human([{type:'data.set',instanceId:'a',path:['content'],value:json(text('HUMAN tail human'))}])
  expect(await f.execute('text.replace',{target:await f.issue(f.target('b',{dataPath:['content']})),content:'stale summary'})).toMatchObject({kind:'error',code:'read-basis-changed'})
})
it('CA036 a read Flow caption participates in the same canonical content basis',async()=>{
  const value=project(true);value.definitions.video={id:'video',role:'mixed',implementation:{kind:'builtin',key:'guoling.video'}}
  value.instances.a={id:'a',definitionId:'video',data:{assetId:'remote-video'},flowLayout:{width:'content-width',caption:text('串联电流相等')}}
  const f=await fixture(value),caption=await f.issue(f.target('a',{fieldScope:'flowLayout',dataPath:['caption']}));await f.read(caption)
  await f.human([{type:'instance.flowLayout.set',instanceId:'a',flowLayout:{width:'content-width',caption:text('并联电压相等')}}])
  expect(await f.execute('text.replace',{target:await f.issue(f.target('b',{dataPath:['content']})),content:'stale summary'})).toMatchObject({kind:'error',code:'read-basis-changed'})
})
it('CA123 a failed stale page never acknowledges changed unread content',async()=>{
  const value=project();value.instances.a.data=json(createTextComponentData('2'.repeat(160)+'5'));const f=await fixture(value),handle=await f.issue(f.target('a',{dataPath:['content']})),first=await f.read(handle,{limit:1})
  expect(first.kind).toBe('read');if(first.kind!=='read'||!first.nextCursor)throw new Error('pagination')
  await f.human([{type:'data.set',instanceId:'a',path:['content'],value:json(text('9'.repeat(160)+'5'))}])
  expect(await f.read(handle,{cursor:first.nextCursor,limit:1})).toMatchObject({kind:'error',code:'stale-cursor'})
  expect(await f.execute('text.replace',{target:await f.issue(f.target('b',{dataPath:['content']})),content:'stale summary'})).toMatchObject({kind:'error',code:'read-basis-changed'})
})
it('CA012 named surface state reaches observation through both target and project-file routes',async()=>{
  const value=project();value.surfaces[0].presentation={states:[{id:'answer',title:'答案',overrides:{}}]}
  const observe=vi.fn(async(input:Record<string,unknown>)=>({source:'live' as const,identity:{documentId:String(input.documentId),epoch:String(input.epoch),revision:Number(input.revision),locationId:String(input.locationId),stateId:input.stateId as string|null},coverage:{width:1,height:1},structure:[],diagnostics:[],image:{resourceId:'image',mimeType:'image/png',width:1,height:1,byteLength:1}}))
  const f=await fixture(value,undefined,{services:{observations:{observe,async readResource(){return {mimeType:'image/png',bytes:new Uint8Array([1])}}}}}),base=await f.issue({kind:'course-surface',surfaceId:f.surfaceId}),named=await f.read(base,{state:'answer'});if(named.kind!=='read')throw new Error('named');const handle=(named.data as {target:string}).target
  expect(await f.execute('view.observe',{target:handle})).toMatchObject({kind:'read'});expect(observe.mock.calls.at(-1)?.[0]).toMatchObject({stateId:'answer'})
  const file=componentProjectFiles(value,{assets:{},components:{}}).find(file=>file.target?.kind==='container' && file.target.container.kind==='surface' && file.target.container.surfaceId===f.surfaceId)!
  expect(await f.execute('view.observe',{project:handle,path:file.path})).toMatchObject({kind:'read'});expect(observe.mock.calls.at(-1)?.[0]).toMatchObject({stateId:'answer'})
})
it('CA035 a task-created child stays inside its original group grant; an external child does not',async()=>{
  const value=project();value.definitions.group={id:'group',role:'mixed',implementation:{kind:'builtin',key:'guoling.group'}};value.instances.left={id:'left',definitionId:'group',data:{},childIds:['a']};value.surfaces[0].childIds=['left','b']
  const surfaceId=value.surfaces[0].id,f=await fixture(value,[{kind:'course-instance',surfaceId,instanceId:'left'}]),root=await f.issue(f.target('left'))
  const inserted=await f.execute('object.insert',{target:root,kind:'text',text:'created'});expect(inserted).toMatchObject({kind:'document-operation',result:{status:'applied'}});if(inserted.kind!=='document-operation')throw new Error('insert')
  const child=f.model().project.instances.left.childIds!.find(id=>id!=='a')!
  expect(await f.execute('text.replace',{target:await f.issue(f.target(child,{dataPath:['content']})),content:'continued'})).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  await f.human([{type:'instance.insert',container:{kind:'instance',instanceId:'left'},index:2,rootIds:['external'],instances:[{id:'external',definitionId:'text',data:json(createTextComponentData('human'))}]}])
  expect(await f.execute('text.replace',{target:await f.issue(f.target('external',{dataPath:['content']})),content:'forbidden'})).toMatchObject({kind:'error',code:'not-authorized'})
})
it('CA195 visible text selection excludes both disabled headers and a hidden instance',async()=>{
  const value=project(true),data=createTableData({rows:1,columns:1});data.headerEnabled=false;data.columns[0].header=text('HIDDEN');data.rows[0].cells[0].text='VISIBLE'
  value.definitions.table={id:'table',role:'mixed',implementation:{kind:'builtin',key:'guoling.table'}};value.instances.table={id:'table',definitionId:'table',data:json(data)};value.instances.secret={id:'secret',definitionId:'text',visible:false,data:json(createTextComponentData('SECRET'))};value.surfaces[0].childIds=['a','secret','table']
  const model={kind:'course-v10' as const,project:value,resources:{assets:{},components:{}}},target=flowTextSelectionTarget(model,value.surfaces[0].id,{kind:'text',revision:'0',anchor:{blockId:'a',slot:{kind:'field',field:'content'},offset:0,affinity:'after'},head:{blockId:'table',slot:{kind:'cell',rowId:data.rows[0].id,columnId:data.columns[0].id},offset:7,affinity:'before'}})
  expect(readEditableTargetContent(model,target).text).toBe('TARGET tail<br>VISIBLE')
})
it('CA218 the visible table caption binds to data even when layout owns a different caption',async()=>{
  const value=project(true),data=createTableData({rows:1,columns:1});data.caption=text('TABLE');value.definitions.table={id:'table',role:'mixed',implementation:{kind:'builtin',key:'guoling.table'}};value.instances.table={id:'table',definitionId:'table',data:json(data),flowLayout:{width:'content-width',caption:text('OTHER')}};value.surfaces[0].childIds.push('table')
  const f=await fixture(value),target=flowTextSelectionTarget(f.model(),f.surfaceId,{kind:'text',revision:'0',anchor:{blockId:'table',slot:{kind:'field',field:'caption'},offset:0,affinity:'after'},head:{blockId:'table',slot:{kind:'field',field:'caption'},offset:5,affinity:'before'}})
  expect(readEditableTargetContent(f.model(),target).text).toBe('TABLE');expect(await f.execute('text.replace',{target:await f.issue(target),content:'EDITED'})).toMatchObject({result:{status:'applied'}})
  expect(parseTableData(f.model().project.instances.table.data).caption).toEqual(text('EDITED'));expect(f.model().project.instances.table.flowLayout?.caption).toEqual(text('OTHER'))
})
function tableProject(){const value=project(true),data=createTableData({rows:1,columns:2});data.rows[0].cells[0].text='TARGET outside';data.rows[0].cells[1].text='BROTHER';value.definitions.table={id:'table',role:'mixed',implementation:{kind:'builtin',key:'guoling.table'}};value.instances.table={id:'table',definitionId:'table',data:json(data)};value.surfaces[0].childIds.push('table');return {value,data}}
it('CA259 formatting outside the selected plain table text retains its range grant after rich upgrade',async()=>{
  const {value}=tableProject(),surfaceId=value.surfaces[0].id,target:ToolTarget={kind:'course-instance',surfaceId,instanceId:'table',dataPath:['rows','0','cells','0','text'],from:0,to:6},f=await fixture(value,[target]),handle=await f.issue(target);await f.read(handle)
  await f.human([formatCourseInstanceText(f.model(),{...target,from:7,to:14},{bold:true})])
  expect(await f.execute('text.replace',{target:handle,content:'CHANGED'})).toMatchObject({kind:'document-operation',result:{status:'applied'}})
  expect(parseTableData(f.model().project.instances.table.data).rows[0].cells[0]).toMatchObject({content:{inlines:[{text:'CHANGED '},{text:'outside',style:{bold:true}}]}})
})
it('CA249 a completed card follows the original row ID after an inserted row and can Undo',async()=>{
  const {value,data}=tableProject(),f=await fixture(value),target=f.target('table',{dataPath:['rows','0','cells','0','text'],from:0,to:6}),tracker=new ElementChangeTracker('card',f.session.documentId,target,f.session,f.session.read());tracker.bindRun('run')
  expect(await f.execute('text.replace',{target:await f.issue(target),content:'CHANGED'})).toMatchObject({result:{status:'applied'}});tracker.finish()
  const current=parseTableData(f.model().project.instances.table.data),added=structuredClone(data.rows[0]);added.id='new-row';added.cells.forEach(cell=>{cell.id=crypto.randomUUID();cell.text='NEW';delete cell.content})
  await f.human([{type:'data.set',instanceId:'table',path:['rows'],value:json([added,...current.rows])}])
  expect(tracker.view('submission')).toMatchObject({state:'applied',target:{dataPath:['rows','1','cells','0','content']}})
  expect(JSON.parse(tracker.view('submission').content!)).toEqual(text('CHANGED'))
  expect(await tracker.revert('submission','undo')).toMatchObject({status:'applied'});const restored=parseTableData(f.model().project.instances.table.data).rows[1].cells[0];expect(restored.content ? plainDocumentText(restored.content) : restored.text).toBe('TARGET outside');tracker.dispose()
})
it('CA245/272 formal cell selection without source ranges authorizes only the selected stable cell',async()=>{
  const {value,data}=tableProject(),f=await fixture(value),capture=captureFlowSelection(f.session.read(),f.surfaceId,{mode:'layout',revision:'0',source:'',ranges:[],label:'所选单元格',selection:{kind:'cells',revision:'0',tableId:'table',anchor:{rowId:data.rows[0].id,columnId:data.columns[0].id},head:{rowId:data.rows[0].id,columnId:data.columns[0].id}}})
  expect(capture.targets).toHaveLength(1);expect(capture.targets[0]).toMatchObject({dataPath:['rows','0','cells','0','text'],from:0,to:14})
  expect(containsTarget(capture.targets[0] as ToolTarget,f.target('table',{dataPath:['rows','0','cells','1','text'],from:0,to:7}),f.model())).toBe(false)
})
it('CA318 course productivity scans and canonically replaces a rich Flow media caption',()=>{
  const value=project(true);value.definitions.video={id:'video',role:'mixed',implementation:{kind:'builtin',key:'guoling.video'}};value.instances.a={id:'a',definitionId:'video',data:{},flowLayout:{width:'wide',caption:{inlines:[{type:'text',text:'CAPTION-OLD',style:{bold:true}}]}}}
  const request={kind:'text' as const,scope:'course' as const,find:'OLD',replacement:'NEW'},preview=createCourseProductivityPreview(value,value.surfaces[0].id,request);expect(preview.items).toHaveLength(1)
  const result=planCourseProductivityEdits(value,value.surfaces[0].id,request),after=applyComponentOperation(value,captureComponentOperation(value,result.edits));expect(after.instances.a.flowLayout).toEqual({width:'wide',caption:{inlines:[{type:'text',text:'CAPTION-NEW',style:{bold:true}}]}})
})
it('CA321 whole-course preview and UI assembler replace each base and saved state while page scope keeps its current state',()=>{
  const value=project();value.instances.a.data=json(createTextComponentData('OLD'));value.instances.b.data=json(createTextComponentData('OLD'));value.surfaces[0].childIds=['a'];value.surfaces.push({id:'second',kind:'slide',title:'2',childIds:['b'],designSize:{width:1280,height:720}})
  value.surfaces[0].presentation={states:[{id:'talk',title:'讲解',overrides:{a:{data:json(createTextComponentData('OLD'))}}},{id:'answer',title:'答案',overrides:{a:{data:json(createTextComponentData('OLD'))}}}]};value.surfaces[1].presentation={states:[{id:'answer',title:'答案',overrides:{b:{data:json(createTextComponentData('OLD'))}}}]}
  const context={document:resolveComponentPresentation(value,value.surfaces[0].id,'talk'),target:{documentId:'d',epoch:'e',project:value,editingProject:resolveComponentPresentation(value,value.surfaces[0].id,'talk'),surfaceId:value.surfaces[0].id,activeStateId:'talk'}} as ProductivityContext
  const request={kind:'text' as const,scope:'course' as const,find:'OLD',replacement:'NEW'},preview=createProductivityPreview(context,request);expect(preview.items).toHaveLength(5)
  const applied=applyProductivityPreview(context,preview,preview.items.map(item=>item.id));if(!applied.ok||!applied.step)throw new Error('plan');const after=applyComponentOperation(value,{type:applied.step.type,edits:applied.step.edits,expected:applied.step.expected})
  for(const surface of after.surfaces)for(const stateId of [null,...surface.presentation!.states.map(state=>state.id)]){const id=surface.childIds[0],view=resolveComponentPresentation(after,surface.id,stateId);expect(plainDocumentText(textComponentDataSchema.parse(view.instances[id].data).content)).toBe('NEW')}
  const local=createProductivityPreview(context,{...request,scope:'page'}),step=applyProductivityPreview(context,local,local.items.map(item=>item.id));if(!step.ok||!step.step)throw new Error('local');const localAfter=applyComponentOperation(value,{type:step.step.type,edits:step.step.edits,expected:step.step.expected});expect(localAfter.instances.a.data).toEqual(value.instances.a.data);expect(resolveComponentPresentation(localAfter,value.surfaces[0].id,'answer').instances.a.data).toEqual(value.instances.a.data)
})
it('CA165 raising an unlocked object moves that object without a locked neighbor edit',()=>{
  const value=project();value.instances.b.locked=true;const ids=courseObjectOrder(value,'a','forward')!,edits=courseObjectOrderEdits(value,ids);expect(edits).toMatchObject([{type:'instance.move',instanceId:'a',index:1}]);expect(applyComponentOperation(value,captureComponentOperation(value,edits)).surfaces[0].childIds).toEqual(['b','a'])
})
it('CA320 inherited locks are omitted from default replacement while healthy text still applies',()=>{
  const value=project();value.definitions.group={id:'group',role:'mixed',implementation:{kind:'builtin',key:'guoling.group'}};value.instances.group={id:'group',definitionId:'group',data:{},locked:true,childIds:['a']};value.surfaces[0].childIds=['group','b'];value.instances.a.data=json(createTextComponentData('OLD'));value.instances.b.data=json(createTextComponentData('OLD'))
  const request={kind:'text' as const,scope:'course' as const,find:'OLD',replacement:'NEW'},plan=planCourseProductivityEdits(value,value.surfaces[0].id,request);expect(plan.items.map(item=>item.id)).toEqual(['b/data/content/text/0']);expect(plan.unsupported.some(message=>message.includes('(a)'))).toBe(true);const after=applyComponentOperation(value,captureComponentOperation(value,plan.edits));expect(after.instances.a.data).toEqual(value.instances.a.data);expect(plainDocumentText(textComponentDataSchema.parse(after.instances.b.data).content)).toBe('NEW')
})
it('CA304 implementation-only shared edits ignore an independent locked override but metadata still protects it',()=>{
  const value=project();value.definitions.custom={id:'custom',role:'mixed',title:'source',implementation:{kind:'source',language:'javascript',source:'export default 1'}};value.instances.a.definitionId='custom';value.instances.b.definitionId='custom';value.instances.b.locked=true;value.instances.b.implementationOverride={kind:'source',language:'javascript',source:'export default 9'}
  const definition={...value.definitions.custom,implementation:{kind:'source' as const,language:'javascript' as const,source:'export default 2'}},after=applyComponentOperation(value,captureComponentOperation(value,[{type:'definition.set',definition}]));expect(after.instances.b).toEqual(value.instances.b);expect(after.definitions.custom.implementation).toEqual(definition.implementation)
  expect(()=>applyComponentOperation(value,captureComponentOperation(value,[{type:'definition.set',definition:{...definition,title:'renamed'}}]))).toThrow('锁定')
})
it('CA294 actual transitive helper implementation and file owners are protected, while dormant bindings stay editable',()=>{
  const value=project();value.definitions.custom={id:'custom',role:'mixed',implementation:{kind:'source',language:'javascript',source:"import {value} from 'Helper'; export default value",moduleBindings:{Helper:'helper',Dormant:'dormant'}}};value.definitions.helper={id:'helper',role:'mixed',implementation:{kind:'source',language:'javascript',workspace:{ownerId:'helper-files',entry:'index.js'}}};value.definitions.dormant={id:'dormant',role:'mixed',implementation:{kind:'source',language:'javascript',source:'export default 0'}};value.instances.a.definitionId='custom';value.instances.a.locked=true
  const resources={assets:{},components:{'helper-files':{'index.js':new TextEncoder().encode('export const value=41')}}},changed={...value.definitions.helper,implementation:{kind:'source' as const,language:'javascript' as const,source:'export const value=42'}}
  expect(()=>applyComponentOperation(value,captureComponentOperation(value,[{type:'definition.set',definition:changed}]),resources)).toThrow('锁定')
  expect(()=>applyComponentOperation(value,captureComponentOperation(value,[{type:'component.files.set',ownerId:'helper-files',expectedFiles:resources.components['helper-files'],files:{'index.js':new TextEncoder().encode('export const value=42')}}]),resources)).toThrow('锁定')
  const dormant={...value.definitions.dormant,implementation:{kind:'source' as const,language:'javascript' as const,source:'export default 1'}};expect(applyComponentOperation(value,captureComponentOperation(value,[{type:'definition.set',definition:dormant}]),resources).definitions.dormant).toEqual(dormant)
})
it('CA294 a local require function does not freeze a dormant helper while the same file true outer require remains protected',async()=>{
  const value=project();value.instances.a.definitionId='custom';value.instances.a.locked=true
  value.definitions.helper={id:'helper',role:'mixed',implementation:{kind:'source',language:'javascript',source:'export default 41'}}
  value.definitions.custom={id:'custom',role:'mixed',implementation:{kind:'source',language:'javascript',source:"const require=x=>'unchanged'; export default {mount(){return require('Helper')}}",moduleBindings:{Helper:'helper'}}}
  const root=value.definitions.custom.implementation;if(root.kind!=='source')throw new Error('fixture')
  const compiled=await createEsbuildComponentCompiler().compile(componentCompilationInput(value,root));expect(compiled.status).toBe('ready')
  const helper={...value.definitions.helper,implementation:{kind:'source' as const,language:'javascript' as const,source:'export default 42'}},edits=[{type:'definition.set' as const,definition:helper}]
  expect(applyComponentOperation(value,captureComponentOperation(value,edits)).definitions.helper).toEqual(helper)
  root.source="function local(require){return require('Helper')} const obj={require:x=>x}; obj.require('Helper'); export default {mount(){return 1}}"
  expect(applyComponentOperation(value,captureComponentOperation(value,edits)).definitions.helper).toEqual(helper)
  root.source += ";const real=require('Helper')"
  expect(()=>applyComponentOperation(value,captureComponentOperation(value,edits))).toThrow('锁定')
})
it('CA294 TypeScript syntax keeps an actually imported helper protected',async()=>{
  const value=project();value.instances.a.definitionId='custom';value.instances.a.locked=true
  value.definitions.helper={id:'helper',role:'mixed',implementation:{kind:'source',language:'typescript',source:'export default 41'}}
  value.definitions.custom={id:'custom',role:'mixed',implementation:{kind:'source',language:'typescript',source:"type Value=number; import Helper from 'Helper'; export default {mount(){const n:Value=Helper;return n}}",moduleBindings:{Helper:'helper'}}}
  const root=value.definitions.custom.implementation;if(root.kind!=='source')throw new Error('fixture');expect((await createEsbuildComponentCompiler().compile(componentCompilationInput(value,root))).status).toBe('ready')
  expect(()=>applyComponentOperation(value,captureComponentOperation(value,[{type:'definition.set',definition:{...value.definitions.helper,implementation:{kind:'source',language:'typescript',source:'export default 42'}}}]))).toThrow('锁定')
})
it('CA294 typed require and TSX retain actual module dependencies without freezing a lexically local require',async()=>{
  const value=project();value.instances.a.definitionId='custom';value.instances.a.locked=true
  value.definitions.helper={id:'helper',role:'mixed',implementation:{kind:'source',language:'typescript',source:'export default 41'}}
  value.definitions.custom={id:'custom',role:'mixed',implementation:{kind:'source',language:'typescript',source:"type Value=number; const real=require('Helper'); export default {mount(){return real.default}}",moduleBindings:{Helper:'helper'}}}
  const root=value.definitions.custom.implementation;if(root.kind!=='source')throw new Error('fixture')
  const edit={type:'definition.set' as const,definition:{...value.definitions.helper,implementation:{kind:'source' as const,language:'typescript' as const,source:'export default 42'}}}
  const compiler=createEsbuildComponentCompiler();expect((await compiler.compile(componentCompilationInput(value,root))).status).toBe('ready');expect(()=>applyComponentOperation(value,captureComponentOperation(value,[edit]))).toThrow('锁定')
  root.source="type Value=number; const require=(name:string):Value=>41; export default {mount(){return require('Helper')}}"
  expect((await compiler.compile(componentCompilationInput(value,root))).status).toBe('ready');expect(applyComponentOperation(value,captureComponentOperation(value,[edit])).definitions.helper).toEqual(edit.definition)
  root.source="class Loader { value:number; constructor(public require:(name:string)=>number) { this.value=require('Helper') } } export default {mount(){return new Loader(()=>41).value}}"
  expect((await compiler.compile(componentCompilationInput(value,root))).status).toBe('ready');expect(applyComponentOperation(value,captureComponentOperation(value,[edit])).definitions.helper).toEqual(edit.definition)
  delete root.source;root.workspace={ownerId:'tsx',entry:'index.tsx'}
  value.definitions.jsx={id:'jsx',role:'mixed',implementation:{kind:'source',language:'javascript',source:'export const jsx=(tag,props)=>({tag,props})'}};root.moduleBindings!['react/jsx-runtime']='jsx'
  const resources={assets:{},components:{tsx:{'index.tsx':new TextEncoder().encode("import {jsx} from 'react/jsx-runtime';type Value=number; const real=require('Helper'); export default {mount(){return <span>{real.default}</span>}}")}}}
  expect((await compiler.compile(componentCompilationInput(value,root,resources))).status).toBe('ready');expect(()=>applyComponentOperation(value,captureComponentOperation(value,[edit]),resources)).toThrow('锁定')
  resources.components.tsx['index.tsx']=new TextEncoder().encode("import {jsx} from 'react/jsx-runtime';type Value=number; const require=(name:string):Value=>41; export default {mount(){return <span>{require('Helper')}</span>}}")
  expect((await compiler.compile(componentCompilationInput(value,root,resources))).status).toBe('ready');expect(applyComponentOperation(value,captureComponentOperation(value,[edit]),resources).definitions.helper).toEqual(edit.definition)
})
it('CA175 a normal formal formula copy renews its inner identity and the resulting Flow body serializes',()=>{
  const value=project(true);value.definitions.formula={id:'formula',role:'mixed',implementation:{kind:'builtin',key:'guoling.formula'}};value.instances.a.definitionId='formula';value.instances.a.data=json(createFormulaComponentData('math-1','x^2'))
  const target={documentId:'same',epoch:'e',surfaceId:value.surfaces[0].id,activeStateId:null,project:value,editingProject:value,resources:{assets:{},components:{}}} as CapturedCourseTarget
  const copied=prepareCourseObjectPaste({documentId:'same',project:value,resources:target.resources,roots:['a']},{capturedTarget:target,container:{kind:'surface',surfaceId:target.surfaceId!},index:2}),after=applyComponentOperation(value,captureComponentOperation(value,copied.edits)),id=copied.rootIds[0]
  expect((after.instances[id].data as any).formula.formulaId).not.toBe('math-1');expect(()=>serializeDocumentMarkdown(projectFlowDocument(after,target.surfaceId!),'flow')).not.toThrow()
})
it('CA254 copying a frameless Flow table to Slide prepares an editable free frame with fresh professional cell IDs',()=>{
  const {value,data}=tableProject(),destination=project(),target={documentId:'destination',epoch:'e',surfaceId:destination.surfaces[0].id,activeStateId:null,project:destination,editingProject:destination,resources:{assets:{},components:{}}} as CapturedCourseTarget
  const copied=prepareCourseObjectPaste({documentId:'source',project:value,resources:target.resources,roots:['table']},{capturedTarget:target,container:{kind:'surface',surfaceId:target.surfaceId!},index:2}),after=applyComponentOperation(destination,captureComponentOperation(destination,copied.edits)),instance=after.instances[copied.rootIds[0]]
  expect(instance.frame).toMatchObject({width:600,height:220});expect(instance.frame?.transform.every(Number.isFinite)).toBe(true)
  const table=parseTableData(instance.data);expect(table.rows[0].cells[0].text).toBe('TARGET outside');expect(table.rows[0].cells[0].id).not.toBe(data.rows[0].cells[0].id);expect(table.rows[0].cells[0].columnId).toBe(table.columns[0].id)
  const resized=applyComponentOperation(after,captureComponentOperation(after,[{type:'frame.set',instanceId:instance.id,frame:{...instance.frame!,width:800}}]));expect(resized.instances[instance.id].frame?.width).toBe(800)
})
it('CA302 a course clipboard carries the selected object closure without unrelated pages or private prose',()=>{
  const value=project(true);value.surfaces[0].childIds=['a'];value.surfaces.push({id:'private-page',title:'PRIVATE_PAGE',kind:'flow',childIds:['b']});value.instances.b.data=json(createTextComponentData('PRIVATE_TEXT'))
  const context=createCourseDocumentClipboardContext({documentId:'source',project:value,resources:{assets:{},components:{}},roots:['a']}),encoded=JSON.stringify(context)
  expect(encoded).not.toContain('PRIVATE_PAGE');expect(encoded).not.toContain('PRIVATE_TEXT');expect(Object.keys(context.project.instances)).toEqual(['a']);expect(context.project.surfaces).toHaveLength(1);expect(readCourseDocumentClipboardContext(context).project.instances.a.data).toEqual(value.instances.a.data)
})
