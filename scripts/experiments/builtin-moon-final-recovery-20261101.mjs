import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { atomicJson, bounded, closeOwnedApp, errorSummary, restoreRoles } from './builtin-moon-cleanup-recovery-20261101.mjs'
import { observeReadOperation } from './builtin-moon-readiness-probe-20261101.mjs'
const root=process.cwd(), config=JSON.parse(await fs.readFile(process.argv[2],'utf8')), out=path.resolve(process.argv[3])
await fs.mkdir(out,{recursive:true});assert.equal((await fs.readdir(out)).length,0,'Preserve earlier recovery evidence')
const identity={workspaceId:'7ad071ed-cbf1-4ebe-9fe2-760bf97fe828',conversationId:'87452db6-99f4-4609-bc39-2ed4e6746215',runId:'0345c62a-cda6-412b-89bf-a7a4494d5df7'}
const report={kind:'existing-run-readonly-recovery',startedAt:new Date().toISOString(),modelSendInvocations:0,reads:[],identity}
const persist=()=>atomicJson(out,'public-recovery.json',report)
const read=(name,operation)=>observeReadOperation(report,persist,name,operation,{timeoutMs:90000,heartbeatMs:2000})
let app,page
try {
 await persist()
 const env={...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'};delete env.ELECTRON_RUN_AS_NODE
 const {_electron:electron}=await import('@playwright/test')
 app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),cwd:root,args:['.','--user-data-dir='+config.originalProfile],env,timeout:45000})
 report.ownedAppPid=app.process().pid;await persist()
 page=await app.firstWindow();await page.waitForFunction(()=>window.desktopAPI?.executionSettings&&window.desktopAPI?.execution,undefined,{timeout:20000})
 report.beforeWorkspace=await page.getByLabel('切换工作空间',{exact:true}).getAttribute('title')
 const rolesRecord=JSON.parse(await fs.readFile(path.resolve(config.out,'profile-restore.json'),'utf8'))
 report.modelRestoration=await restoreRoles(page,rolesRecord,15000);await persist()
 await read('conversations',()=>page.evaluate(async id=>{
 const rows=await window.desktopAPI.execution.conversations(id.workspaceId);const c=rows.find(c=>c.conversationId===id.conversationId)
 return c?{workspaceId:c.workspaceId,conversationId:c.conversationId,title:c.title,revision:c.revision,runIds:c.runIndex.builtinRunIds,hasDraft:!!c.inputDraft,attachments:c.inputAttachments.length}:null
 },identity))
 const run=await read('run',()=>page.evaluate(async id=>{
 const r=await window.desktopAPI.execution.run(id.runId);if(!r)return null
 return {runId:r.runId,status:r.status,version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt,model:r.input.selection.model,workspaceRoot:r.input.workspaceRoot,conversationId:r.input.conversationId,
 requestCount:r.requests.length,toolCount:r.tools.length,requests:r.requests.map(x=>({requestId:x.requestId,state:x.state,finishReason:x.finishReason,timing:x.timing,inputTokens:x.inputTokens,outputTokens:x.outputTokens})),
 tools:r.tools.map(t=>({origin:t.origin,callId:t.callId,requestId:t.requestId,name:t.call.name,state:t.state,receiptTime:t.receiptTime,input:t.call.name==='compute.run'?{outputNames:t.call.input.outputNames}:t.call.input,result:t.result})),
 messages:r.messages.filter(m=>m.role==='assistant').map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content?.filter?.(p=>p.type==='text')}))}
 },identity))
 assert.equal(run?.runId,identity.runId);assert.equal(run?.conversationId,identity.conversationId)
 await read('submissions',()=>page.evaluate(async id=>(await window.desktopAPI.execution.submissions(id)).map(s=>({submissionId:s.submissionId,state:s.state,runId:s.runId,createdAt:s.createdAt,updatedAt:s.updatedAt})),{workspaceId:identity.workspaceId,conversationId:identity.conversationId}))
 await read('model-settings',()=>page.evaluate(async()=>{const s=await window.desktopAPI.executionSettings.read();return {revision:s.profile.revision,roles:s.profile.roles}}))
 await read('workspace-read',()=>page.evaluate(async root=>{const s=await window.desktopAPI.execution.workspace(root);return {workspace:s.workspace,recoveryIssues:s.recoveryIssues,conversationCount:s.conversations.length}},config.continuation.workspace))
 await read('documents',()=>page.evaluate(async()=>(await window.desktopAPI.documents.list()).map(d=>({documentId:d.documentId,revision:d.revision,dirty:d.dirty,binding:d.binding}))))
 report.artifacts=[]
 for(const p of [...config.continuation.protectedFiles.map(x=>x.path),config.continuation.newGlx,config.continuation.newHtml]){const b=await fs.readFile(p);report.artifacts.push({path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})}
 assert.equal(report.reads.find(x=>x.name==='submissions').result.filter(s=>s.runId===identity.runId).length,1)
 report.status='observed-no-submit';await page.screenshot({path:path.join(out,'existing-state.png')});await persist()
} catch(e){report.status='observation-failed';report.error=errorSummary(e);await persist()}
finally {report.close=await closeOwnedApp(app);report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,run:report.reads.find(x=>x.name==='run')?.result&&{status:report.reads.find(x=>x.name==='run').result.status,requests:report.reads.find(x=>x.name==='run').result.requestCount,tools:report.reads.find(x=>x.name==='run').result.toolCount},modelRestoration:report.modelRestoration,beforeWorkspace:report.beforeWorkspace,close:report.close,error:report.error,result:path.join(out,'public-recovery.json')}));process.exitCode=report.status==='observed-no-submit'?0:1;setTimeout(()=>process.exit(process.exitCode),1500).unref()}
