// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { conversationHistoryIndex } from '../../src/main/workbench/execution/ConversationHistoryIndex'
import { modelContextBudget, estimateSerializedTokens } from '../../src/core/execution/modelContextBudget'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
const cleanup: Array<()=>Promise<unknown>>=[]
afterEach(async()=>{vi.restoreAllMocks(); for(const fn of cleanup.splice(0).reverse()) await fn()})
const selection: ModelSelection={model:'fixture',connection:{id:'fixture',revision:1,provider:'fixture',protocol:'openai-chat',baseURL:'http://127.0.0.1:1/v1',accountId:'fixture',auth:{kind:'api-key',credentialRef:'fixture'},billing:{kind:'unknown'},capabilities:{tools:'supported',vision:'supported',stream:'supported',reasoning:'supported'}}}
const result=(request:ModelRequest,text:string,calls:Array<{name:string,input:unknown}>=[]):Extract<ModelEvent,{type:'response.completed'}>=>{
 const toolCalls=calls.map((call,index)=>({id:`${request.requestId}:${index}`,name:call.name,argumentsText:JSON.stringify(call.input)}))
 return {requestId:request.requestId,sequence:1,type:'response.completed',responseId:request.requestId,actualModel:'fixture',finishReason:calls.length?'tool_calls':'stop',nativeResponse:{},toolCalls,assistant:{role:'assistant',content:text,...(calls.length?{tool_calls:toolCalls.map(call=>({id:call.id,type:'function' as const,function:{name:call.name,arguments:call.argumentsText}}))}:{})}}
}
async function engineFixture(provider:ModelProvider,source='OLD'){
 const directory=await mkdtemp(path.join(tmpdir(),'execution-repair-'));cleanup.push(()=>rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:25}))
 const driver=new MarkdownDriver(),registry=new DocumentRegistry({drivers:[driver],createId:randomUUID,bindingKey:b=>b.path,persistence:createDocumentJournal({directory:path.join(directory,'documents')})})
 const gateway=new DocumentToolGateway(registry,[driver],randomUUID),runs=new ExecutionRunStore(path.join(directory,'runs')),events=new ExecutionEventStore({directory:path.join(directory,'events')})
 const engine=new ExecutionEngine({provider,registry,gateway,runs,events});cleanup.push(()=>engine.shutdown())
 const session=await registry.create(driver.load(new TextEncoder().encode(source)),'draft.md'),snapshot=session.read()
 const input:ExecutionStart={conversationId:'conversation',taskId:randomUUID(),instruction:'完成两次局部修改',selection,advancementMode:'automatic',documents:[{documentId:session.documentId,epoch:snapshot.epoch,revision:snapshot.revision,writable:[{kind:'markdown-range',from:0,to:source.length}],selection:[{kind:'markdown-range',from:0,to:source.length}]}],contentOutput:{kind:'content',documentId:session.documentId,target:{kind:'markdown-range',from:0,to:source.length}}}
 return {engine,session,input,runs,events}
}
it('repair16 continues a premature goal exit once using receipts and never replays an already committed write',async()=>{
 let turn=0
 const provider:ModelProvider={retrySafety:'pure-generation',async *stream(request){
  if(++turn===1){yield result(request,'先完成第一项',[{name:'text.replace',input:{content:'NEW'}},{name:'task.note',input:{remaining:['完成第二项局部修改']}}]);return}
  if(turn===2){yield result(request,'第一项完成，第二项尚未处理');return}
  if(turn===3){expect(JSON.stringify(request.messages)).toContain('最近工作笔记仍有剩余事项');yield result(request,'完成第二项',[{name:'text.replace',input:{content:'DONE'}},{name:'task.note',input:{remaining:[]}}]);return}
  yield result(request,'两项修改已应用')
 }}
 const h=await engineFixture(provider),start=await h.engine.start(h.input),end=await h.engine.wait(start.runId)
 expect(end.status).toBe('completed');expect(turn).toBe(4)
 expect(h.session.read()).toMatchObject({revision:2,undoDepth:2,model:{source:'DONE'}})
 expect(end.tools.filter(t=>t.call.name==='text.replace')).toHaveLength(2)
 const page=await h.events.readPage({conversationId:'conversation',limit:1000});expect(page.events.find(e=>e.type==='run.end')?.data.label).toBe('本轮已结束')
})
it('repair16 rewording a note does not reset the single no-progress exit, while an explicit empty note can retire stale work',async()=>{
 let turn=0
 const provider:ModelProvider={retrySafety:'pure-generation',async *stream(request){
  if(++turn===1)yield result(request,'计划',[{name:'task.note',input:{remaining:['第二项修改']}}])
  else if(turn===2)yield result(request,'阶段结果')
  else if(turn===3)yield result(request,'更新表述',[{name:'task.note',input:{remaining:['继续第二项处理']}}])
  else yield result(request,'本轮结束')
 }}
 const h=await engineFixture(provider),start=await h.engine.start(h.input),end=await h.engine.wait(start.runId)
 expect(end.status).toBe('partial');expect(end.failure?.code).toBe('model-goal-no-progress');expect(turn).toBe(4);expect(h.session.read().revision).toBe(0)
 let next=0
 provider.stream=async function*(request){if(++next===1)yield result(request,'这次只讨论阶段成果，旧待办不属于本次范围',[{name:'task.note',input:{remaining:[]}}]);else yield result(request,'阶段成果已说明')}
 const continued=await h.engine.start({...h.input,taskId:randomUUID(),instruction:'本次只说明阶段成果'}, {runId:end.runId,facts:'',sameTask:true})
 const final=await h.engine.wait(continued.runId);expect(final.status).toBe('completed');expect(next).toBe(2);expect(final.workingNote?.remaining).toEqual([])
})
const wire=(payload:any,text:string,calls:Array<{name:string,input:unknown}>=[])=>new Response(`data: ${JSON.stringify({id:randomUUID(),model:payload.model,choices:[{index:0,delta:{role:'assistant',content:text,...(calls.length?{tool_calls:calls.map((call,index)=>({index,id:randomUUID(),type:'function',function:{name:modelToolWireName(call.name),arguments:JSON.stringify(call.input)}}))}:{})},finish_reason:calls.length?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})
async function desktopFixture(fetcher:typeof fetch){
 const root=await mkdtemp(path.join(tmpdir(),'desktop-repair-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:25}));const workspace=path.join(root,'workspace');await mkdir(workspace)
 const documents=new DocumentHostService(path.join(root,'documents')),settings=new ExecutionSettingsStore({directory:path.join(root,'settings'),encryption:{isEncryptionAvailable:()=>true,encryptString:t=>Buffer.from(t),decryptString:b=>Buffer.from(b).toString()}})
 const saved=await settings.saveConnection({apiKey:'fixture',connection:{provider:'fixture',protocol:'openai-chat',baseURL:'http://127.0.0.1:1/v1',accountId:'fixture',authKind:'api-key',billing:{kind:'unknown'},capabilities:{tools:'supported',vision:'supported',stream:'supported',reasoning:'supported'}}})
 await settings.saveProfile({expectedRevision:0,roles:{conversation:{connectionId:saved.connection.id,model:'fixture'},vision:null,imageGenerate:null,imageEdit:null}})
 const service=new ExecutionDesktopService({directory:path.join(root,'desktop'),documents,settings,fetch:fetcher,authorizeWorkspaceRoot:async p=>({resolvedPath:p})});cleanup.push(()=>service.shutdown())
 const space=await service.operate({type:'workspace',root:workspace}) as {workspace:{workspaceId:string}},current=await service.operate({type:'create-conversation',workspaceId:space.workspace.workspaceId}) as ConversationRecord
 return {service,settings,documents,root,workspace,current,identity:{workspaceId:current.workspaceId,conversationId:current.conversationId}}
}
it.each(['automatic','stepwise'] as const)('repair18 persists the real first mode choice %s and accepts ordered UI switching without changing frozen input',async mode=>{
 let turn=0,release!:()=>void,arrived!:()=>void;const gated=new Promise<void>(r=>release=r),received=new Promise<void>(r=>arrived=r)
 const h=await desktopFixture(async(_url,init)=>{const payload=JSON.parse(String(init?.body));if(++turn===1)return wire(payload,'选择推进方式',[{name:'ask_user',input:{purpose:'advancement-mode',question:'采用哪种推进方式？',options:[{label:'自动推进',value:'automatic'},{label:'逐步确认',value:'stepwise'}]}}]);if(turn===2){arrived();await gated;return wire(payload,'当前阶段已准备')}return wire(payload,'按新选择完成本轮')})
 const sent=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:h.current.revision,text:'新建短作品',documents:[]}) as {run:ExecutionRunRecord}
 await vi.waitFor(async()=>expect((await h.service.engine.read(sent.run.runId))?.tools.some(t=>t.call.name==='ask_user'&&t.state==='executing')).toBe(true))
 const run=(await h.service.engine.read(sent.run.runId))!,call=run.tools.find(t=>t.call.name==='ask_user')!
 await h.service.operate({type:'answer',runId:run.runId,callId:call.callId,answer:{choices:[mode==='automatic'?0:1]}});await received
 const changed=await h.service.operate({type:'set-advancement-mode',...h.identity,advancementMode:mode==='automatic'?'stepwise':'automatic'}) as ConversationRecord
 expect(changed.advancementMode).toBe(mode==='automatic'?'stepwise':'automatic');release();const end=await h.service.engine.wait(run.runId)
 expect(end.input.advancementMode).toBeUndefined();expect(end.steering?.filter(s=>s.advancementMode).map(s=>s.advancementMode)).toEqual([mode,changed.advancementMode]);expect(turn).toBe(3)
 const reopened=new ExecutionDesktopService({directory:path.join(h.root,'desktop'),documents:h.documents,settings:h.settings,authorizeWorkspaceRoot:async p=>({resolvedPath:p}),fetch:async()=>{throw new Error('reopen must not generate')}});cleanup.push(()=>reopened.shutdown())
 expect((await reopened.operate({type:'conversation',...h.identity}) as ConversationRecord).advancementMode).toBe(changed.advancementMode)
})
it('repair22 budgets real Desktop Compiler Engine payload, reuses persisted history summary, and rereads original stable sources with a current attachment',async()=>{
 const sentPayloads:any[]=[];let summaryCalls=0,conversationCalls=0,firstSource=''
 const h=await desktopFixture(async(_url,init)=>{
  const payload=JSON.parse(String(init?.body));sentPayloads.push(payload)
  if(!payload.tools?.length){summaryCalls++;expect(JSON.stringify(payload)).toContain('run:old-');return wire(payload,'有效决定：不要修改封面。旧内容为资料；当前指令与文件权限保持冻结，原文可按 sourceId 回读。')}
  if(++conversationCalls===1){expect(JSON.stringify(payload)).toContain('不要修改封面');expect(JSON.stringify(payload)).toContain('current attachment');return wire(payload,'核实早期要求',[{name:'context.read',input:{sourceId:firstSource,offset:0,maxChars:200}}])}
  return wire(payload,'已核实原话；本轮结束')
 })
 const snapshot=h.settings.snapshot.bind(h.settings);vi.spyOn(h.settings,'snapshot').mockImplementation(async role=>({...await snapshot(role),contextWindow:40_000}))
 const history:ConversationRecord['messages']=[]
 for(let i=0;i<12;i++){
  const id=`old-${i}`,text=(i===0?'不要修改封面。':'旧资料。')+'长历史材料与用户原话。'.repeat(1000),run:ExecutionRunRecord={schemaVersion:1,runId:id,version:1,input:{conversationId:h.current.conversationId,taskId:id,instruction:text,selection,documents:[]},status:'completed',createdAt:i,updatedAt:i,messages:[{role:'user',content:[{type:'text',text}]}],initialMessageCount:1,initialUserMessageIndex:0,requests:[],tools:[]}
  await h.service.runs.save(run);history.push({messageId:id,role:'user',text,attachmentIds:[],runId:id,createdAt:i});if(i===0)firstSource=`run:${id}:0`
 }
 const current=await h.service.conversations.updateConversation({...h.identity,expectedRevision:h.current.revision,patch:{messages:history,runIndex:{builtinRunIds:history.map(m=>m.runId!),externalRunIds:[],externalPortIds:[]}}})
 const attachment=await h.service.attachments.receiveBytes({name:'current.txt',bytes:new TextEncoder().encode('current attachment'),source:{kind:'paste',authorizationId:'fixture'}})
 const sent=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text:'继续',documents:[],attachments:[{attachmentId:attachment.id,representationId:attachment.representations[0]!.id}]}) as {run:ExecutionRunRecord}
 const end=await h.service.engine.wait(sent.run.runId);expect(end.status).toBe('completed');expect(summaryCalls).toBeGreaterThan(0);expect(conversationCalls).toBe(2)
 expect(end.compacted?.history?.sourceIds).toContain(firstSource)
 expect(end.initialPayload?.userMessageIndex).toBeLessThan(end.initialUserMessageIndex!)
 expect(end.initialPayload?.explicitAttachments[0]?.messageIndex).toBe(end.initialPayload?.userMessageIndex)
 expect(end.tools.find(t=>t.call.name==='context.read')?.result).toMatchObject({kind:'read',data:{text:expect.stringContaining('不要修改封面')}})
 const initialPayload=sentPayloads.find(p=>p.tools?.length);expect(estimateSerializedTokens(JSON.stringify(initialPayload))).toBeLessThan(modelContextBudget({...selection,contextWindow:40_000}).inputTokens)
 const saved=await h.service.runs.read(end.runId);expect(saved?.messages[saved.initialUserMessageIndex!].content).toEqual(expect.arrayContaining([expect.objectContaining({text:'继续'})]))
 const updated=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord
 const indexed=await conversationHistoryIndex(updated,id=>h.service.runs.read(id));expect(JSON.stringify(indexed.context)).toContain('historicalSummary');expect(indexed.context.map(e=>e.provenance.id)).toContain(firstSource)
 const before=summaryCalls;const ready=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord;const next=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:ready.revision,text:'继续说明',documents:[]}) as {run:ExecutionRunRecord};expect((await h.service.engine.wait(next.run.runId)).status).toBe('completed');expect(summaryCalls).toBe(before)
})
it('repair16 ordinary Desktop continuation carries the original goal and untouched old remaining; explicit empty notes and new discussion end naturally',async()=>{
 let turn=0,link='origin-goal'
 const h=await desktopFixture(async(_url,init)=>{
  const payload=JSON.parse(String(init?.body));turn++
  if(turn===1||turn===5)return wire(payload,'继续先前任务',[{name:'task.note',input:{continuationRunId:link}}])
  if(turn===2)return wire(payload,'阶段结果，文件尚未写入')
  if(turn===3){expect(JSON.stringify(payload)).toContain('最近工作笔记仍有剩余事项');return wire(payload,'完成文件交付',[{name:'file.write',input:{path:'result.txt',content:'已完成授权结果',mode:'create'}},{name:'task.note',input:{remaining:[]}}])}
  return wire(payload,'本轮结果已说明')
 })
 const old:ExecutionRunRecord={schemaVersion:1,runId:link,version:1,input:{conversationId:h.current.conversationId,taskId:link,instruction:'创建 result.txt 并交付完整结果',selection,documents:[]},status:'partial',createdAt:1,updatedAt:1,messages:[{role:'user',content:'创建 result.txt 并交付完整结果'}],initialMessageCount:1,initialUserMessageIndex:0,requests:[],tools:[],workingNote:{goal:'创建 result.txt 并交付完整结果',userConstraints:['保留已有文件'],decisions:[],remaining:['写入 result.txt'],openQuestions:[],risks:[]},workingNoteRemainingUpdated:true}
 await h.service.runs.save(old)
 let current=await h.service.conversations.updateConversation({...h.identity,expectedRevision:h.current.revision,patch:{messages:[{messageId:link,role:'user',text:old.input.instruction,attachmentIds:[],runId:link,createdAt:1}],runIndex:{builtinRunIds:[link],externalRunIds:[],externalPortIds:[]}}})
 const first=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text:'继续',documents:[]}) as {run:ExecutionRunRecord}
 const completed=await h.service.engine.wait(first.run.runId);expect(completed.status).toBe('completed');expect(completed.taskContinuedFrom).toBeUndefined();expect(completed.goalContinuationRunId).toBe(link);expect(completed.workingNote?.goal).toBe(old.input.instruction);expect(completed.tools.filter(t=>t.call.name==='file.write')).toHaveLength(1);expect(await import('node:fs/promises').then(fs=>fs.readFile(path.join(h.workspace,'result.txt'),'utf8'))).toBe('已完成授权结果');expect(turn).toBe(4)
 link=completed.runId;current=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord
 const second=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text:'继续说明本次结果',documents:[]}) as {run:ExecutionRunRecord}
 const ended=await h.service.engine.wait(second.run.runId);expect(ended.status).toBe('completed');expect(ended.workingNote?.remaining).toEqual([]);expect(ended.workingNote?.goal).toBe(old.input.instruction);expect(turn).toBe(6)
 current=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord
 const discussion=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text:'只讨论自动推进的含义',documents:[]}) as {run:ExecutionRunRecord}
 const natural=await h.service.engine.wait(discussion.run.runId);expect(natural.status).toBe('completed');expect(natural.goalContinuationRunId).toBeUndefined();expect(turn).toBe(7)
})
it.each(['server_error','authentication_error'] as const)('repair10 consumes a real Responses SSE %s, retains usage and diagnostics, and never retries the committed tool',async errorCode=>{
 let requests=0
 const frame=(event:unknown)=>`data: ${JSON.stringify(event)}\n\n`
 const provider=new ChatGPTResponsesProvider({credentialResolver:async()=>({accessToken:'fixture',accountId:'fixture'}),fetch:async()=>{
  const turn=++requests,id=`response-${turn}`
  let body=': heartbeat\n\n'+frame({type:'response.created',response:{id,model:'actual-fixture'}})
  if(turn===1)body+=frame({type:'response.completed',response:{id,model:'actual-fixture',status:'completed',usage:{input_tokens:10,output_tokens:3},output:[{type:'function_call',id:'write-output',call_id:'write-once',name:modelToolWireName('text.replace'),arguments:JSON.stringify({content:'NEW'}),status:'completed'}]}})
  else if(turn===2)body+=frame({type:'response.failed',response:{id,model:'actual-fixture',status:'failed',usage:{input_tokens:20,output_tokens:4},error:{code:errorCode,type:errorCode,request_id:'provider-trace',message:'opaque provider detail'}}})
  else body+=frame({type:'response.completed',response:{id,model:'actual-fixture',status:'completed',output:[{type:'message',id:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'修改已应用'}]}]}})
  return new Response(body,{headers:{'content-type':'text/event-stream','x-request-id':'provider-trace'}})
 }})
 const h=await engineFixture(provider),oauth:ModelSelection={...selection,connection:{...selection.connection,provider:'openai',protocol:'chatgpt-responses',baseURL:CHATGPT_RESPONSES_BASE_URL,auth:{kind:'oauth',credentialRef:'fixture'}}}
 const started=await h.engine.start({...h.input,selection:oauth}),ended=await h.engine.wait(started.runId)
 expect(ended.status).toBe(errorCode==='server_error'?'completed':'partial');expect(requests).toBe(errorCode==='server_error'?3:2)
 expect(ended.tools.filter(t=>t.call.name==='text.replace')).toHaveLength(1);expect(h.session.read()).toMatchObject({revision:1,undoDepth:1,model:{source:'NEW'}})
 expect(ended.requests[1]?.failure).toMatchObject({kind:errorCode==='server_error'?'server':'auth',providerCode:errorCode,providerType:errorCode,providerRequestId:'provider-trace'})
 expect(ended.requests[1]?.inputTokens).toBe(20);expect(ended.requests[1]?.outputTokens).toBe(4)
 const page=await h.events.readPage({conversationId:'conversation',limit:1000});expect(page.events).toEqual(expect.arrayContaining([expect.objectContaining({type:'run.state',data:expect.objectContaining({phase:'waiting-response',label:'仍在等待模型响应'})}),expect.objectContaining({type:'run.state',data:expect.objectContaining({phase:'generating'})}),expect.objectContaining({type:'run.state',data:expect.objectContaining({phase:'tool'})}),expect.objectContaining({type:'run.end',data:expect.objectContaining({phase:'ended'})})]))
 expect(page.events.filter(e=>e.type==='usage'&&e.itemId===`${ended.requests[1]!.requestId}:usage`)).toHaveLength(1)
 if(errorCode==='server_error')expect(page.events.some(e=>e.type==='run.state'&&e.data.phase==='retry')).toBe(true)
},15_000)
it('repair18 natural-language explicit mode uses the same persistent owner and a redundant mode question is not displayed',async()=>{
 let turn=0
 const h=await desktopFixture(async(_url,init)=>{const payload=JSON.parse(String(init?.body));if(++turn===1)return wire(payload,'采用自动推进',[{name:'task.setMode',input:{advancementMode:'automatic',sourceRef:'task:instruction'}}]);if(turn===2)return wire(payload,'已存在偏好',[{name:'ask_user',input:{purpose:'advancement-mode',question:'采用哪种方式？',options:[{label:'自动',value:'automatic'},{label:'逐步',value:'stepwise'}]}}]);expect(JSON.stringify(payload)).toContain('already-selected');return wire(payload,'按自动推进完成本轮')})
 const sent=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:h.current.revision,text:'请自动推进完成这个短作品',documents:[]}) as {run:ExecutionRunRecord}
 const ended=await h.service.engine.wait(sent.run.runId);expect(ended.status).toBe('completed');expect(ended.input.advancementMode).toBeUndefined();expect(ended.steering?.at(-1)?.advancementMode).toBe('automatic')
 const current=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord;expect(current.advancementMode).toBe('automatic')
 const events=await h.service.events.readPage({conversationId:current.conversationId,limit:1000});expect(events.events.some(e=>e.type==='tool'&&e.data.question&&e.data.status==='waiting')).toBe(false)
})
it.each(['unknown-source', 'run:unknown-source:0'])('repair16 semantic continuation via %s restricts a real unknown prior effect without granting its old operation or replaying it',async reference=>{
 let turn=0
 const h=await desktopFixture(async(_url,init)=>{const payload=JSON.parse(String(init?.body));if(++turn===1)return wire(payload,'承接原目标',[{name:'task.note',input:{continuationRunId:reference}}]);if(turn===2)return wire(payload,'尝试剩余操作',[{name:'file.write',input:{path:'unknown.txt',content:'must not replay',mode:'create'}}]);return wire(payload,'原写入结果未知，本次没有重放')})
 const original:ExecutionRunRecord={schemaVersion:1,runId:'unknown-source',version:1,input:{conversationId:h.current.conversationId,taskId:'original',instruction:'完成 unknown.txt',selection,documents:[]},status:'partial',createdAt:1,updatedAt:1,messages:[{role:'user',content:'完成 unknown.txt'}],initialMessageCount:1,initialUserMessageIndex:0,requests:[],tools:[{callId:'unknown-effect',providerCallId:'unknown-effect',requestId:'old',call:{name:'file.write',input:{path:'unknown.txt',content:'before',mode:'create'}},state:'returned',result:{kind:'error',code:'tool-outcome-unknown',message:'原写入结果未知'},effectPaths:[path.join(h.workspace,'unknown.txt')]}],workingNote:{goal:'完成 unknown.txt',userConstraints:[],decisions:[],remaining:['核实原写入结果'],openQuestions:[],risks:[]},workingNoteRemainingUpdated:true}
 await h.service.runs.save(original);const current=await h.service.conversations.updateConversation({...h.identity,expectedRevision:h.current.revision,patch:{messages:[{messageId:'unknown-source',role:'user',text:original.input.instruction,attachmentIds:[],runId:original.runId,createdAt:1}],runIndex:{builtinRunIds:[original.runId],externalRunIds:[],externalPortIds:[]}}})
 const sent=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text:'继续',documents:[]}) as {run:ExecutionRunRecord};const ended=await h.service.engine.wait(sent.run.runId)
 expect(ended.goalContinuationRunId).toBe(original.runId);expect(ended.status).toBe('partial');expect(ended.taskContinuedFrom).toBeUndefined();expect(ended.tools.find(t=>t.call.name==='file.write')?.result).toMatchObject({kind:'error',code:'unresolved-prior-tool'});expect(ended.remainingGoal).toEqual(['核实原写入结果']);await expect(import('node:fs/promises').then(fs=>fs.access(path.join(h.workspace,'unknown.txt')))).rejects.toMatchObject({code:'ENOENT'})
})
it('repair16 repeated paged reads of the same content and revision do not reset the no-progress reminder',async()=>{
 let turn=0,target=''
 const provider:ModelProvider={retrySafety:'pure-generation',async *stream(request){turn++
  if(turn===1){target=JSON.parse(String(request.messages.find(message=>String(message.content).startsWith('当前默认语义目标 target='))!.content).match(/target=("[^"]+")/)![1]!);yield result(request,'留下剩余事项',[{name:'task.note',input:{remaining:['完成第二项修改']}}]);return}
  if(turn===2||turn===4||turn===6){yield result(request,'尚有待处理内容');return}
  if(turn===3||turn===5){yield result(request,'回读当前内容',[{name:'read',input:{target,limit:1}}]);return}
  throw new Error('重复原事实不应再发起模型请求')
 }}
 const h=await engineFixture(provider,'同一份长正文。'.repeat(100))
 const started=await h.engine.start(h.input),ended=await h.engine.wait(started.runId)
 expect(ended.status).toBe('partial');expect(ended.failure?.code).toBe('model-goal-no-progress');expect(turn).toBe(6);expect(h.session.read().revision).toBe(0)
 const reads=ended.tools.filter(t=>t.call.name==='read');expect(reads).toHaveLength(2);expect(reads[0]?.result).toMatchObject({kind:'read',data:{offset:0,truncated:true}});expect(reads[1]?.result).toMatchObject({kind:'read',data:{offset:0,truncated:true}})
 expect((reads[0]?.result as {nextCursor?:string}).nextCursor).not.toBe((reads[1]?.result as {nextCursor?:string}).nextCursor)
})
it('repair18 explicit recovery freezes the accepted mode after a first-choice answer rather than rejecting the original unset mode',async()=>{
 let turn=0
 const h=await desktopFixture(async(_url,init)=>{const payload=JSON.parse(String(init?.body));if(++turn===1)return wire(payload,'选择推进方式',[{name:'ask_user',input:{purpose:'advancement-mode',question:'采用哪种推进方式？',options:[{label:'自动',value:'automatic'},{label:'逐步',value:'stepwise'}]}}]);if(turn===2)return new Response('',{status:401});expect(JSON.stringify(payload)).toContain('本次推进偏好：automatic');return wire(payload,'按已选方式继续完成')})
 const text='新建短作品',sent=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:h.current.revision,text,documents:[]}) as {run:ExecutionRunRecord}
 await vi.waitFor(async()=>expect((await h.service.engine.read(sent.run.runId))?.tools.some(t=>t.call.name==='ask_user'&&t.state==='executing')).toBe(true));const asking=(await h.service.engine.read(sent.run.runId))!,call=asking.tools.find(t=>t.call.name==='ask_user')!
 await h.service.operate({type:'answer',runId:asking.runId,callId:call.callId,answer:{choices:[0]}});const interrupted=await h.service.engine.wait(asking.runId);expect(interrupted.status).toBe('failed');expect(interrupted.input.advancementMode).toBeUndefined()
 const current=await h.service.operate({type:'conversation',...h.identity}) as ConversationRecord;expect(current.advancementMode).toBe('automatic')
 const recovered=await h.service.operate({type:'send',...h.identity,submissionId:randomUUID(),expectedRevision:current.revision,text,documents:[],retryOfRunId:interrupted.runId,advancementMode:'automatic'}) as {run:ExecutionRunRecord};const completed=await h.service.engine.wait(recovered.run.runId)
 expect(completed.status).toBe('completed');expect(completed.input.advancementMode).toBe('automatic');expect(completed.taskContinuedFrom).toBe(interrupted.runId);expect(turn).toBe(3)
})
