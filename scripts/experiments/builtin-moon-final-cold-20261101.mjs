/** Cold-read the existing r9 in an isolated App/profile, preserving every author original. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { _electron as electron, expect } from '@playwright/test'
import { atomicJson, closeOwnedApp, errorSummary } from './builtin-moon-cleanup-recovery-20261101.mjs'
const root=process.cwd(), config=JSON.parse(await fs.readFile(process.argv[2],'utf8')), out=path.resolve(process.argv[3]), executable=process.argv[4]
await fs.mkdir(out,{recursive:true});assert.equal((await fs.readdir(out)).length,0,'Use a fresh cold-read evidence directory.')
const workspace=path.join(out,'workspace'),profile=path.join(out,'profile');await fs.mkdir(workspace);await fs.mkdir(profile)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'), source=config.continuation.newGlx
const sourceBytes=await fs.readFile(source),sourceHash=hash(sourceBytes),document=path.join(workspace,path.basename(source))
await fs.writeFile(document,sourceBytes,{flag:'wx'})
const handoff=JSON.parse(await fs.readFile('output/comprehensive-execution-20261101/creation/builtin-moon-source-handoff/run-KRvHjc/result.json','utf8'))
const previous=JSON.parse(await fs.readFile(handoff.authorJSON,'utf8'))
const report={kind:'existing-r9-independent-cold',startedAt:new Date().toISOString(),phase:'launch',source,sourceHash,document,workspace,profile,modelSends:0,errors:[],network:[]}
const persist=()=>atomicJson(out,'result.json',report)
let app,page
async function author(id){
 return page.evaluate(async id=>{
  const s=await window.desktopAPI.documents.read(id);if(s.model.kind!=='course-v10')throw Error('Expected course')
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('')
  return {project:s.model.project,revision:s.revision,dirty:s.dirty,assets:Object.fromEntries(await Promise.all(Object.entries(s.model.resources.assets).map(async([k,v])=>[k,await sha(v)]))),
   components:Object.fromEntries(await Promise.all(Object.entries(s.model.resources.components).map(async([k,files])=>[k,Object.fromEntries(await Promise.all(Object.entries(files).map(async([n,b])=>[n,await sha(b)])))])))}
 },id)
}
async function click(frame,selector){
 const target=frame.locator(selector);await target.scrollIntoViewIfNeeded()
 let point=await target.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
 for(let current=frame;current.parentFrame();current=current.parentFrame()){
  const owner=await current.frameElement(),g=await owner.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,sx:r.width/el.offsetWidth,sy:r.height/el.offsetHeight,bx:el.clientLeft,by:el.clientTop}})
  point={x:g.x+(point.x+g.bx)*g.sx,y:g.y+(point.y+g.by)*g.sy}
  assert.equal(await owner.evaluate((el,p)=>el.getRootNode().elementFromPoint(p.x,p.y)===el,point),true)
 }
 await page.mouse.click(point.x,point.y)
}
try{
 await persist()
 const env={...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({cwd:root,...(executable?{executablePath:path.resolve(executable)}:{}),args:[...(executable?[]:['.']),'--user-data-dir='+profile],env,timeout:45000})
 report.pid=app.process().pid;report.application=await app.evaluate(({app})=>({isPackaged:app.isPackaged,appPath:app.getAppPath(),version:app.getVersion()}))
 if(executable)assert.equal(report.application.isPackaged,true)
 page=await app.firstWindow();page.setDefaultTimeout(15000)
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url())})
 await app.evaluate(({BrowserWindow,dialog},directory)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,1000);w.show();w.focus();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace)
 await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
 await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:path.basename(document),exact:true}).dblclick()
 const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
 const id=await editor.getAttribute('data-document-id');assert(id)
 const before=await author(id);assert.equal(before.revision,9);assert.equal(before.dirty,false)
 const nativeBefore=structuredClone(before.project),nativePrevious=structuredClone(previous.project)
 delete nativeBefore.instances[handoff.programId];delete nativePrevious.instances[handoff.programId];nativeBefore.revision=nativePrevious.revision
 assert.deepEqual(nativeBefore,nativePrevious,'Every non-lab author field, identity, geometry and native text remains exact')
 assert.deepEqual(before.assets,previous.assets);assert.deepEqual(before.components,previous.components)
 assert(JSON.stringify(before.project.instances[handoff.titleId].data).includes('月光的几何·课堂'))
 assert.equal(typeof before.project.instances[handoff.programId].data.html,'string')
 await expect(page.locator('[data-component-instance="'+handoff.titleId+'"]:visible')).toContainText('月光的几何·课堂')
 report.phase='try-run';await persist()
 await page.getByTestId('course-try-run-chrome').getByRole('button',{name:'试运行',exact:true}).click()
 let lab;await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('#angle').count().catch(()=>0)){lab=f;return true}return false}).toBe(true)
 await expect(lab.locator('#reset')).toHaveText('重置实验');await click(lab,'[data-angle="180"]')
 await expect(lab.locator('#phaseName')).toHaveText('满月');await expect(lab.locator('#fraction')).toHaveText('100%')
 await click(lab,'#reset');await expect(lab.locator('#phaseName')).toHaveText('新月')
 assert.deepEqual(await author(id),before,'Transient interaction must not dirty the author')
 await page.screenshot({path:path.join(out,'r9-packaged-cold.png')})
 report.phase='formal-source-and-export';await persist()
 const destination=path.join(workspace,'r9-cold-export.html'),runId='r9-cold-'+randomUUID()
 report.receipts=await app.evaluate(async({app},input)=>{
  const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json')
  const host=req('./dist-electron/main/workbench/documentHost.js').documentHost()
  await host.tools.beginRun({runId:input.runId,actor:'human',documents:[{documentId:input.id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:input.workspace}})
  try{
   const list=await host.tools.execute(input.runId,'source-list',{name:'project.list',input:{limit:1000}})
   const source=await host.tools.execute(input.runId,'source-read',{name:'project.read',input:{path:input.programPath,full:true}})
   await host.tools.loadToolFamilies(input.runId,['build'])
   const opened=await host.tools.completeOpenedDocument(input.runId,{documentId:input.id,writable:true},{selection:'preserve'})
   const exported=await host.tools.execute(input.runId,'export',{name:'document.export',input:{target:opened.target,format:'html-offline',destination:input.destination}})
   return{list,source,exported}
  }finally{await host.tools.stop(input.runId)}
 },{runId,id,workspace,destination,programPath:handoff.programPath})
 assert.equal(report.receipts.source.kind,'read');assert.equal(report.receipts.source.data.complete,true)
 assert(report.receipts.source.data.content.includes('重置实验'));assert.equal(report.receipts.source.data.revision,9)
 assert.equal(report.receipts.exported.kind,'read');assert.equal(report.receipts.exported.data.status,'written')
 assert.equal(report.receipts.exported.data.exportedRevision,9);assert.equal(report.receipts.exported.data.currentRevision,9)
 assert.deepEqual(await author(id),before)
 await fs.writeFile(path.join(out,'author.json'),JSON.stringify(before,null,2))
 report.export={path:destination,revision:9,sha256:hash(await fs.readFile(destination)),sourceHTMLHash:hash(await fs.readFile(config.continuation.newHtml))}
 report.preserved=[]
 for(const item of config.continuation.protectedFiles){const actual=hash(await fs.readFile(item.path));assert.equal(actual,item.sha256);report.preserved.push({path:item.path,sha256:actual,unchanged:true})}
 assert.equal(hash(await fs.readFile(source)),sourceHash);assert.equal(hash(await fs.readFile(document)),sourceHash)
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[])
 report.status='r9-cold-source-export-passed';report.humanTitlePreserved=true;report.nonTargetAuthorPreserved=true;report.resetPreserved=true;report.phase='complete'
}catch(e){report.status='failed';report.error=errorSummary(e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}
finally{report.close=await closeOwnedApp(app);report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,export:report.export,close:report.close,out}));process.exitCode=report.status==='r9-cold-source-export-passed'?0:1;setTimeout(()=>process.exit(process.exitCode),1500).unref()}
