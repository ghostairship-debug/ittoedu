/** One reviewed local Source change through an owned formal MCP host. No model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const root=process.cwd(), [sourceArg,editsArg,outArg,resumeArg]=process.argv.slice(2);
assert.ok(sourceArg&&editsArg&&outArg,'source, exact edits, new output directory required');
const source=path.resolve(sourceArg),out=path.resolve(outArg),prior=resumeArg?JSON.parse(await fs.readFile(path.resolve(resumeArg),'utf8')):null;
const workspace=prior?.workspace??path.join(out,'workspace'),profile=prior?.profile??path.join(out,'profile');
const document=path.join(workspace,'月光的几何-课堂可读版.glx'),html=document.replace(/\.glx$/i,'.html');
const programId='ba18b327-1d77-4ada-a372-9ff2c59c9c0f';
const sha=b=>createHash('sha256').update(b).digest('hex');
const archive=b=>{const entries=unzipSync(b);return {project:JSON.parse(strFromU8(entries['project.json'])),
 resources:Object.fromEntries(Object.entries(entries).filter(([k])=>k!=='project.json').map(([k,v])=>[k,sha(v)]))}};
const originalBytes=await fs.readFile(source),before=archive(originalBytes),edits=JSON.parse(await fs.readFile(path.resolve(editsArg),'utf8'));
assert.ok([10,11].includes(before.project.revision));const nextRevision=before.project.revision+1;assert.ok(JSON.stringify(before.project).includes('借来的月光，变化的形。'));
let expected=before.project.instances[programId].data.html;
for(const edit of edits){assert.equal(expected.split(edit.old).length-1,1,'Each reviewed edit is unique');expected=expected.replace(edit.old,edit.new)}
assert.ok(expected.includes('回到上弦'));
if(prior){
 assert.equal(prior.status,'failed');assert.equal(prior.close?.code,0);assert.equal(prior.sourceHash,sha(originalBytes));
 const applied=prior.operations.filter(op=>op.name==='project.apply');assert.equal(applied.length,1);
 const receipt=JSON.parse(await fs.readFile(applied[0].receipt,'utf8')).result.structuredContent.result;
 assert.equal(receipt.kind,'read');assert.equal(receipt.data.commit,'committed');assert.equal(receipt.data.receipt.revision,nextRevision);
 assert.equal(prior.operations.some(op=>['file.save','document.export'].includes(op.name)),false);
}
await fs.mkdir(out,{recursive:false});
if(!prior){await fs.mkdir(workspace);await fs.writeFile(document,originalBytes,{flag:'wx'})}
const report={kind:'a2-reviewed-source-readability',startedAt:new Date().toISOString(),phase:'launch-owned-mcp',
 source,sourceHash:sha(originalBytes),document,html,workspace,profile,modelRequests:0,operations:[],programId};
if(prior)report.resumeFrom=path.resolve(resumeArg);
const write=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const checkpoint=async()=>write('state.json',report);
await checkpoint();
const log=createWriteStream(path.join(out,'host.log'),{flags:'wx'});
let child,client,closed,connection;
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function call(name,args){
 const operation={sequence:report.operations.length+1,name,startedAt:new Date().toISOString(),status:'invoking'};
 report.operations.push(operation);await checkpoint();
 const start=performance.now();
 try {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:60000});
  operation.elapsedMs=performance.now()-start;operation.finishedAt=new Date().toISOString();operation.status='returned';
  const filename=String(operation.sequence).padStart(2,'0')+'-'+name+'.json';operation.receipt=path.join(out,filename);
  await write(filename,{...operation,arguments:args,result});await checkpoint();
  const receipt=result.structuredContent?.result;
  assert.equal(result.isError===true,false,JSON.stringify(receipt));assert.equal(receipt?.kind,'read',JSON.stringify(receipt));
  return receipt.data;
 } catch(error){operation.status=operation.status==='invoking'?'outcome-unconfirmed':'returned-error';operation.error=String(error);await checkpoint();throw error}
}
try {
 const port=await freePort();
 child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/launch-mcp-server.ts','--workspace',workspace,'--permission','workspace','--port',String(port),'--user-data-dir='+profile,'--ready-json'],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,VITE_DEV_SERVER_URL:''}});
 report.launcherPid=child.pid;
 closed=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 child.stderr.pipe(log);const lines=createInterface({input:child.stdout});
 connection=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Owned MCP startup exceeded 45000ms')),45000);
  lines.on('line',line=>{try{const value=JSON.parse(line);if(value.endpoint){clearTimeout(timer);resolve(value)}else log.write(line+'\n')}catch{log.write(line+'\n')}});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('MCP exited before connection: '+code))});
 });
 await write('connection.json',connection);assert.equal(connection.ownership,'owned');assert.equal(connection.workspaceMismatch===true,false);
 report.hostPid=connection.pid;report.phase='formal-open-and-current-source';await checkpoint();
 client=new Client({name:'guoling-a2-readability-20261101',version:'1'},{capabilities:{}});
 await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
 const catalog=await client.listTools();await write('tool-names.json',catalog.tools.map(t=>t.name));
 await call('tools.load',{names:['file.save','document.export']});
 const opened=await call('file.open',{path:document});report.documentId=opened.documentId;
 const require=createRequire(import.meta.url);
 const {componentProjectFiles}=require(path.join(root,'dist-electron/core/projectFiles/componentPlatform/projection.js'));
 const candidates=componentProjectFiles(before.project,{assets:{},components:{}}).filter(f=>f.kind==='html'&&f.target?.kind==='instance'&&f.target.instanceId===programId);
 assert.equal(candidates.length,1);const programPath=candidates[0].path;report.programPath=programPath;
 let directory=await call('project.list',{limit:1000}),found=directory.files.some(f=>f.path===programPath);
 while(!found&&directory.nextOffset!=null){directory=await call('project.list',{limit:1000,offset:directory.nextOffset});found=directory.files.some(f=>f.path===programPath)}
 assert.equal(found,true,'Current formal map must contain the exact lab');
 const read=await call('project.read',{path:programPath,full:true});assert.equal(read.complete,true);assert.equal(read.revision,prior?nextRevision:before.project.revision);
 let formal=read.content;
 if(prior){assert.equal(formal,expected,'Restore the already committed Source before any save; never replay apply');report.recoveredWithoutApply=true}
 else {
  for(const edit of edits){assert.equal(formal.split(edit.old).length-1,1);formal=formal.replace(edit.old,edit.new)}
  report.phase='single-formal-source-commit';await checkpoint();
  const applied=await call('project.apply',{path:programPath,edits});assert.equal(applied.commit,'committed');assert.equal(applied.receipt.revision,nextRevision);
 }
 const fresh=await call('project.read',{path:programPath,full:true,refresh:true});assert.equal(fresh.complete,true);assert.equal(fresh.revision,nextRevision);assert.equal(fresh.content,formal);
 report.phase='formal-save-and-export';await checkpoint();
 const saved=await call('file.save',{target:opened.target});assert.equal(saved.status,'saved');assert.equal(saved.savedRevision,nextRevision);assert.equal(saved.dirty,false);
 const bytes=await fs.readFile(document),after=archive(bytes),normalized=structuredClone(after.project);
 assert.equal(after.project.instances[programId].data.html,expected);
 normalized.revision=before.project.revision;normalized.instances[programId].data.html=before.project.instances[programId].data.html;
 assert.deepEqual(normalized,before.project,'All non-target author fields and geometry must remain exact');
 assert.deepEqual(after.resources,before.resources,'Every original resource/index byte must be preserved');
 const exported=await call('document.export',{target:opened.target,format:'html-offline',destination:html});
 assert.equal(exported.status,'written');assert.equal(exported.exportedRevision,nextRevision);assert.equal(exported.currentRevision,nextRevision);
 assert.equal(sha(await fs.readFile(source)),report.sourceHash);
 Object.assign(report,{status:'formal-source-saved-exported-awaiting-visual-and-cold',revision:nextRevision,savedHash:sha(bytes),htmlHash:sha(await fs.readFile(html)),
  sourceUnchanged:true,nonTargetAuthorPreserved:true,resourcesPreserved:true,edits,phase:'closing-owned-mcp'});
} catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;throw error}
finally {
 await client?.close().catch(error=>{report.clientCloseError=String(error)});
 if(child?.connected)child.send({type:'mcp-stop'});
 if(closed){let timer;try{report.close=await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned MCP close exceeded 15000ms')),15000)})])}catch(error){report.close={status:'unconfirmed',error:String(error)}}finally{clearTimeout(timer)}}
 log.end();report.finishedAt=new Date().toISOString();await write('result.json',report);await checkpoint();
}
assert.equal(report.close?.code,0,'Owned host must close normally');
console.log(JSON.stringify({status:report.status,revision:report.revision,operations:report.operations.length,document,html,out}));
