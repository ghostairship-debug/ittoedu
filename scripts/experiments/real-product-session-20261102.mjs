// Root-operated product acceptance transport. It never calls a native Agent outside the App.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createInterface} from 'node:readline'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {constants as fsConstants,writeFileSync} from 'node:fs'
import {_electron as electron} from '@playwright/test'
import {atomicJson,bounded,chooseWorkspaceBounded,restoreWorkspace} from './builtin-moon-cleanup-recovery-20261101.mjs'
import {captureAcpState,isolatedForeground,selectAcpUi,sendAcpUi,stopAcpUi} from '../../output/goal-correction-20261102/acp-ui-driver.mjs'
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'))
assert(path.isAbsolute(cfg.out??'')&&path.isAbsolute(cfg.originalProfile??''),'out and originalProfile must be absolute')
const root=process.cwd(),out=path.resolve(cfg.out),resume=cfg.resume
process.on('uncaughtExceptionMonitor',error=>{
 try{writeFileSync(path.join(out,'startup-or-transport-failure.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,message:String(error),stack:error?.stack,next:'Inspect owned processes and saved owner state. Do not replay operations or force-close an unknown App.'},null,2),{flag:'wx'})}catch{}
})
const workspace=resume?path.resolve(resume.workspace):path.join(out,'workspace')
if(resume){
 assert(process.platform==='win32','Resume preflight requires Windows process inspection')
 assert(path.isAbsolute(resume.workspace??'')&&path.isAbsolute(resume.previousSessionOut??'')&&resume.workspaceId&&resume.conversationId,'Resume requires workspace, previousSessionOut, workspaceId and conversationId')
 assert(!(cfg.copyFiles?.length),'Resume never copies or replaces workspace files')
 assert((await fs.stat(workspace)).isDirectory(),'Existing workspace required')
 const previous=JSON.parse(await fs.readFile(path.join(resume.previousSessionOut,'identity.json'),'utf8'))
 assert.equal(path.resolve(previous.workspace).toLowerCase(),workspace.toLowerCase(),'Previous workspace identity mismatch')
 assert.equal(previous.workspaceId,resume.workspaceId,'Previous workspace ID mismatch')
 assert.equal(previous.conversationId,resume.conversationId,'Previous conversation ID mismatch')
 const oldLock=path.join(resume.previousSessionOut,'session.lock')
 assert(!(await fs.stat(oldLock).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})),'Previous session lock exists; inspect and resolve the old session before resuming')
 // Inspect the actual process command lines, not merely a stale Chromium lock.
 // A process whose command line cannot be read but has the target exe name is
 // treated as ambiguous. Never print command lines or change another process.
 const script=`$ErrorActionPreference='Stop'; $ps=Get-CimInstance Win32_Process; $hits=@($ps | Where-Object { ($_.CommandLine -and $_.CommandLine.IndexOf($env:GUOLING_RESUME_PROFILE,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '--user-data-dir') -or (!$_.CommandLine -and $_.Name -ieq $env:GUOLING_RESUME_EXE_NAME) }); $hits.Count`
 const check=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,GUOLING_RESUME_PROFILE:path.resolve(cfg.originalProfile),GUOLING_RESUME_EXE_NAME:path.basename(cfg.executable)}})
 assert(!check.error&&check.status===0&&/^\s*\d+\s*$/.test(check.stdout),'Cannot safely inspect existing profile processes')
 assert.equal(Number(check.stdout.trim()),0,'Existing or uninspectable App process may own the profile; resume blocked')
}
await fs.mkdir(out)
if(!resume){
 await fs.mkdir(workspace)
 for(const source of cfg.copyFiles??[]){assert(source.name&&path.basename(source.name)===source.name,'Copy target must be a basename');await fs.copyFile(path.resolve(source.path),path.join(workspace,source.name),fsConstants.COPYFILE_EXCL)}
}
const lock=await fs.open(path.join(out,'session.lock'),'wx');await lock.writeFile(String(process.pid));await lock.sync()
const env={...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0',COURSEWARE_COMPONENT_PACKAGES_DIR:path.join(out,'no-development-component-directory')};delete env.ELECTRON_RUN_AS_NODE
const exe=path.resolve(cfg.executable)
const app=await electron.launch({executablePath:exe,cwd:out,args:['--user-data-dir='+cfg.originalProfile],env,timeout:60000})
// Cache the owned child before Playwright retires its process handle on close.
const ownedChild=app.process()
await atomicJson(out,'launched-process.json',{pid:ownedChild.pid,executable:exe,profile:cfg.originalProfile,at:new Date().toISOString(),workspaceChangeStarted:false})
const page=await app.firstWindow();page.setDefaultTimeout(15000)
await page.waitForFunction(()=>window.desktopAPI?.execution?.acp,undefined,{timeout:60000})
await page.getByLabel('切换工作空间',{exact:true}).waitFor({state:'visible',timeout:60000})
// The switcher is visible before persisted workspace hydration finishes.
// Reading its placeholder title once made a valid cold launch look like failure.
const workspaceTitleDeadline=Date.now()+30000
let originalWorkspace=await page.getByLabel('切换工作空间',{exact:true}).getAttribute('title')
while((!originalWorkspace||!path.isAbsolute(originalWorkspace))&&Date.now()<workspaceTitleDeadline){
 await new Promise(resolve=>setTimeout(resolve,100))
 originalWorkspace=await page.getByLabel('切换工作空间',{exact:true}).getAttribute('title')
}
assert(originalWorkspace&&path.isAbsolute(originalWorkspace),'Original workspace unavailable; preserved')
const build=await app.evaluate(({app})=>({isPackaged:app.isPackaged,execPath:process.execPath,resourcesPath:process.resourcesPath,appPath:app.getAppPath(),userData:app.getPath('userData')}))
assert(build.isPackaged&&path.resolve(build.execPath).toLowerCase()===exe.toLowerCase(),'Wrong executable')
await atomicJson(out,'recovery.json',{originalWorkspace,workspace,ownedAppPid:app.process().pid,build,next:'Reconnect/read this session and public owner. Never replay a send or close an active/unknown task.'})
if(path.resolve(originalWorkspace).toLowerCase()!==workspace.toLowerCase())await chooseWorkspaceBounded(app,page,workspace,15000)
let space=await page.evaluate(p=>window.desktopAPI.execution.workspace(p),workspace)
const deadline=Date.now()+30000
while(space.conversations.length===0&&Date.now()<deadline){await new Promise(r=>setTimeout(r,300));space=await page.evaluate(p=>window.desktopAPI.execution.workspace(p),workspace)}
if(resume){
 assert.equal(space.workspace.workspaceId,resume.workspaceId,'Resumed workspace ID changed')
 assert.equal(space.conversations.length,1,'This transport requires one conversation to establish foreground identity')
 assert(space.conversations.some(c=>c.conversationId===resume.conversationId),'Resumed conversation is unavailable')
}else assert.equal(space.conversations.length,1)
const identity={workspace,workspaceId:space.workspace.workspaceId,conversationId:resume?.conversationId??space.conversations[0].conversationId}
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setContentSize(1600,1050))
await atomicJson(out,'identity.json',{...identity,build,startedAt:new Date().toISOString()})
let sequence=0,queue=Promise.resolve(),closing=false
async function state(){
 const s=await captureAcpState(page,identity)
 const builtins=await page.evaluate(async ids=>Promise.all(ids.map(async id=>{const r=await window.desktopAPI.execution.run(id);return r?{runId:id,status:r.status,model:r.input.selection.model,permission:r.input.permission,requests:r.requests.length,tools:r.tools.map(t=>({name:t.call.name,state:t.state,resultKind:t.result?.kind})),final:r.messages.filter(m=>m.role==='assistant'&&!m.tool_calls?.length).at(-1)?.content}:null})),s.conversation.runIndex?.builtinRunIds??[])
 return{...s,builtins}
}
async function record(name,value){
 const filename=String(++sequence).padStart(3,'0')+'-'+name+'.json'
 await atomicJson(out,filename,value)
 const v=JSON.stringify(value);console.log(JSON.stringify({file:path.join(out,filename),value:v.length<6500?value:'Read saved result; '+v.length+' characters'}))
}
console.log(JSON.stringify({ready:true,identity,build,pid:app.process().pid}))
const input=createInterface({input:process.stdin})
input.on('line',line=>{queue=queue.then(async()=>{
 let req
 try{
  req=JSON.parse(line)
  if(req.file)req=JSON.parse(await fs.readFile(path.resolve(req.file),'utf8'))
  if(req.action==='state'){const s=await state();await record('state',s);console.log(JSON.stringify({agent:s.snapshot.selectedAgentId,phase:s.snapshot.phase,agents:s.snapshot.agents,configuration:s.snapshot.configuration,messages:s.conversation.messages.slice(-3),runIndex:s.conversation.runIndex,builtins:s.builtins}));return}
  if(req.action==='screenshot'){
   assert(typeof req.name==='string'&&/^[A-Za-z0-9_-]+$/.test(req.name),'Screenshot name must be a safe basename')
   const shot=path.join(out,req.name+'.png'),reservation=await fs.open(shot,'wx');await reservation.close()
   await page.screenshot({path:shot,timeout:10000});console.log(JSON.stringify({screenshot:shot}));return
  }
  if(req.action==='script'){const m=await import(pathToFileURL(path.resolve(req.path)).href);await record('script',await m.run({app,page,out,workspace,identity,state,config:cfg}));return}
  const current=await captureAcpState(page,identity)
  const common={page,outputDirectory:out,actionId:req.id,identity,assertForeground:isolatedForeground(req.expectedAgent,req.expectedPhase),evidenceFiles:req.evidenceFiles??[]}
  if(req.action==='select'){
   const target=current.snapshot.agents.find(a=>a.id===req.agentId)
   assert(target?.nativeInstalled&&target?.adapterInstalled,'No new installation or authorization allowed')
   await record('select',await selectAcpUi(common,target.name));return
  }
  if(req.action==='send'){assert.equal(current.snapshot.phase,'ready');const text=await fs.readFile(path.resolve(req.promptFile),'utf8');await record('send',await sendAcpUi({...common,text}));return}
  if(req.action==='stop'){assert.equal(current.snapshot.phase,'prompting');await record('stop',await stopAcpUi(common));return}
  if(req.action==='close'){
   const s=await state();assert(['idle','ready'].includes(s.snapshot.phase),'Active/unknown Agent; no close')
   assert(s.builtins.every(r=>r&&['completed','failed','stopped','partial','interrupted'].includes(r.status)),'Builtin task active/unknown')
   const readDocuments=()=>page.evaluate(async()=>{
    const api=window.desktopAPI.documents
    if(!api?.list||!api?.read||!api?.readAuthoringDrafts)throw Error('Cannot inspect saved documents and raw input drafts')
    const entries=await api.list()
    return Promise.all(entries.map(async entry=>{const snapshot=await api.read(entry.documentId),drafts=await api.readAuthoringDrafts(entry.documentId)
     return {documentId:entry.documentId,epoch:snapshot.epoch,revision:snapshot.revision,dirty:snapshot.dirty,saving:snapshot.saving,
      rawDrafts:!!(drafts&&(drafts.advanced?.length||drafts.properties?.length||drafts.flow?.length||drafts.sourceConflict||drafts.sourceConflicts?.length))}}))
   })
   const documents=await readDocuments()
   assert(documents.every(d=>d.dirty===false&&d.saving===false&&!d.rawDrafts),'Dirty, saving or uncommitted input exists; no close')
   await record('close-before',s)
   await record('close-documents',documents)
   const restoration=await restoreWorkspace(app,page,{originalWorkspace,workspace},15000)
   assert(restoration.restored,'Workspace restoration unresolved')
   const afterRestoration=await readDocuments()
   assert.deepEqual(afterRestoration,documents,'Document state changed during workspace restoration; no close')
   // A bounded graceful close only. Never force-exit or kill an app that may
   // still be protecting a draft or an unresolved save.
   await atomicJson(out,'workspace-restored.json',{...restoration,at:new Date().toISOString()})
   let closeError
   try{await bounded('Close saved owned Electron app',()=>app.close(),8000)}catch(error){closeError=String(error)}
   if(ownedChild.exitCode===null&&ownedChild.signalCode===null){
    try{await bounded('Confirm owned process graceful exit',()=>new Promise(resolve=>ownedChild.once('exit',resolve)),5000)}
    catch(error){closeError=closeError??String(error)}
   }
   const closed={closed:ownedChild.exitCode!==null||ownedChild.signalCode!==null,mode:'graceful',pid:ownedChild.pid,...(closeError?{closeError}:{})}
   await atomicJson(out,'cleanup.json',{restoration,closed,finishedAt:new Date().toISOString()})
   assert(closed.closed,'Owned App exit not confirmed; lock retained')
   closing=true;await lock.close();await fs.rm(path.join(out,'session.lock'));input.close();console.log(JSON.stringify({closed:true}));return
  }
  throw Error('Unknown operation')
 }catch(error){await record('error',{action:req?.action,message:String(error),at:new Date().toISOString(),next:'Inspect original owner; do not replay uncertain writes.'})}
})})
input.on('close',()=>{if(!closing)console.log(JSON.stringify({status:'input-closed-app-preserved',pid:app.process().pid}))})


