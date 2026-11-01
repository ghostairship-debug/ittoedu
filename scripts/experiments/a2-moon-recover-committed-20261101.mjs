/** Explicit public recovery of the already committed A2 r11. Never reapplies it. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { unzipSync,strFromU8 } from 'fflate';
import { _electron as electron } from '@playwright/test';
import { atomicJson,closeOwnedApp,errorSummary } from './builtin-moon-cleanup-recovery-20261101.mjs';
const prior=JSON.parse(await fs.readFile(process.argv[2],'utf8')),out=path.resolve(process.argv[3]),executable=path.resolve(process.argv[4]);
await fs.mkdir(out,{recursive:false});
const original=await fs.readFile(prior.source),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(original),prior.sourceHash);
const zip=unzipSync(original),before=JSON.parse(strFromU8(zip['project.json']));
const applied=prior.operations.filter(op=>op.name==='project.apply');assert.equal(applied.length,1);
const commit=JSON.parse(await fs.readFile(applied[0].receipt,'utf8')).result.structuredContent.result.data.receipt;
assert.equal(commit.revision,11);assert.equal(commit.documentId,prior.documentId);assert.equal(prior.close.code,0);
const edits=JSON.parse(await fs.readFile(path.join(path.dirname(path.dirname(prior.document)),'..','a2-source-edits.json'),'utf8'));
let expectedHtml=before.instances[prior.programId].data.html;
for(const edit of edits){assert.equal(expectedHtml.split(edit.old).length-1,1);expectedHtml=expectedHtml.replace(edit.old,edit.new)}
const report={kind:'a2-explicit-recovery-no-replay',startedAt:new Date().toISOString(),phase:'launch',prior:process.argv[2],
 document:prior.document,source:prior.source,sourceHash:prior.sourceHash,html:prior.html,workspace:prior.workspace,profile:prior.profile,
 documentId:prior.documentId,operationId:commit.operationId,modelSends:0,projectApplyInvocations:0,errors:[],network:[]};
let app,page;const persist=()=>atomicJson(out,'result.json',report);
try {
 await persist();const env={...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_E2E_BACKGROUND:'0'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:executable,cwd:out,args:['--user-data-dir='+prior.profile],env,timeout:45000});
 report.pid=app.process().pid;page=await app.firstWindow();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url())});
 report.phase='public-recovery-summary';await persist();
 report.recoverySummaries=await page.evaluate(()=>window.desktopAPI.documents.recoverySummaries());
 assert(report.recoverySummaries.some(s=>s.documentId===prior.documentId&&s.dirty&&s.recoverable));
 const restored=await page.evaluate(id=>window.desktopAPI.documents.restore(id,'original'),prior.documentId);
 assert.equal(restored.revision,11);assert.equal(restored.dirty,true);assert.equal(restored.undoDepth,1);
 assert.equal(restored.model.kind,'course-v10');assert.equal(restored.model.project.instances[prior.programId].data.html,expectedHtml);
 const normalized=structuredClone(restored.model.project);normalized.revision=before.revision;normalized.instances[prior.programId].data.html=before.instances[prior.programId].data.html;
 assert.deepEqual(normalized,before);
 report.originalOperation=await page.evaluate(({id,operationId})=>window.desktopAPI.documents.lookup(id,operationId),{id:prior.documentId,operationId:commit.operationId});
 assert.equal(report.originalOperation.status,'applied');assert.equal(report.originalOperation.revision,11);
 report.restored={documentId:restored.documentId,revision:restored.revision,dirty:restored.dirty,undoDepth:restored.undoDepth};
 report.phase='save-restored-once';await persist();
 const saved=await page.evaluate(id=>window.desktopAPI.documents.save(id),prior.documentId);
 assert.equal(saved.revision,11);assert.equal(saved.dirty,false);assert.equal(saved.undoDepth,1);assert.deepEqual(saved.model.project,restored.model.project);
 const savedBytes=await fs.readFile(prior.document),savedZip=unzipSync(savedBytes);
 assert.deepEqual(JSON.parse(strFromU8(savedZip['project.json'])),restored.model.project);
 for(const [name,bytes]of Object.entries(zip))if(name!=='project.json')assert.equal(sha(savedZip[name]),sha(bytes),'Preserve '+name);
 report.phase='formal-source-read-and-export';await persist();
 report.receipts=await app.evaluate(async({app},input)=>{
  const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),host=req('./dist-electron/main/workbench/documentHost.js').documentHost();
  await host.tools.beginRun({runId:input.runId,actor:'human',documents:[{documentId:input.id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:input.workspace}});
  try{const source=await host.tools.execute(input.runId,'source-read',{name:'project.read',input:{path:input.programPath,full:true}});
   await host.tools.loadToolFamilies(input.runId,['build']);const target=await host.tools.completeOpenedDocument(input.runId,{documentId:input.id,writable:true},{selection:'preserve'});
   const exported=await host.tools.execute(input.runId,'export',{name:'document.export',input:{target:target.target,format:'html-offline',destination:input.html}});
   return{source,exported};
  }finally{await host.tools.stop(input.runId)}
 },{runId:'a2-recovered-'+randomUUID(),id:prior.documentId,workspace:prior.workspace,programPath:prior.programPath,html:prior.html});
 assert.equal(report.receipts.source.kind,'read');assert.equal(report.receipts.source.data.revision,11);assert.equal(report.receipts.source.data.content,expectedHtml);
 assert.equal(report.receipts.exported.kind,'read');assert.equal(report.receipts.exported.data.status,'written');assert.equal(report.receipts.exported.data.exportedRevision,11);
 assert.equal(report.receipts.exported.data.currentRevision,11);assert.equal(sha(await fs.readFile(prior.source)),prior.sourceHash);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);
 Object.assign(report,{status:'recovered-r11-saved-exported-no-replay',phase:'complete',revision:11,savedHash:sha(savedBytes),htmlHash:sha(await fs.readFile(prior.html)),
  sourceUnchanged:true,nonTargetAuthorPreserved:true,resourcesPreserved:true,originalOperationPreserved:true});
}catch(error){report.status='failed';report.error=errorSummary(error)}
finally{report.close=await closeOwnedApp(app);report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,revision:report.revision,close:report.close,out}));process.exitCode=report.status==='recovered-r11-saved-exported-no-replay'?0:1;setTimeout(()=>process.exit(process.exitCode),1500).unref()}
