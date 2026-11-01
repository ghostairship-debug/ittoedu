/** Interactive transport for this root-authored experiment; no model, prompts or agent loop. */
import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root=process.cwd(), out=path.resolve('output/comprehensive-execution-20261101/creation');
const workspace=path.join(out,'workspace'),profile=path.join(out,'profile');
await fs.mkdir(workspace,{recursive:true});
const log=createWriteStream(path.join(out,'host.log'),{flags:'a'});
const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/launch-mcp-server.ts','--workspace',workspace,'--permission','workspace','--port','45271','--user-data-dir='+profile,'--ready-json'],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,VITE_DEV_SERVER_URL:''}});
child.stderr.pipe(log);
const lines=createInterface({input:child.stdout});
const connection=await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>reject(new Error('MCP startup did not finish')),60000);
 lines.on('line',line=>{try{const value=JSON.parse(line);if(value.endpoint){clearTimeout(timeout);resolve(value)}else log.write(line+'\n')}catch{log.write(line+'\n')}});
 child.once('exit',code=>{clearTimeout(timeout);reject(new Error('MCP exited before connection: '+code))});
});
await fs.writeFile(path.join(out,'connection.json'),JSON.stringify(connection,null,2));
if(connection.workspaceMismatch||connection.ownership!=='owned')throw new Error('Experiment requires its own isolated host');
const client=new Client({name:'guoling-root-creation-20261101',version:'1'},{capabilities:{}});
await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
let sequence=Math.max(0,...(await fs.readdir(out)).map(name=>Number(/^(\d+)-/.exec(name)?.[1]??0))),queue=Promise.resolve(),stopping=false;
const output=async(value,label)=>{
 const filename=String(++sequence).padStart(3,'0')+'-'+label.replace(/[^a-zA-Z0-9.-]/g,'_')+'.json';
 await fs.writeFile(path.join(out,filename),JSON.stringify(value,null,2));
 const text=JSON.stringify(value);
 console.log(JSON.stringify({file:path.join(out,filename),bytes:Buffer.byteLength(text),value:text.length<4500?value:'Read the recorded JSON for the full result.'}));
};
const catalog=await client.listTools();
await fs.writeFile(path.join(out,'tools.json'),JSON.stringify(catalog,null,2));
console.log(JSON.stringify({ready:true,workspace,endpoint:connection.endpoint,tools:catalog.tools.map(t=>t.name)}));
async function stop(){
 if(stopping)return;stopping=true;
 await client.close().catch(()=>{});
 if(child.connected)child.send({type:'mcp-stop'});
 log.end();setTimeout(()=>process.exit(0),500).unref();
}
const input=createInterface({input:process.stdin});
input.on('line',line=>{
 queue=queue.then(async()=>{
  try{
   const request=JSON.parse(line);
   if(request.close){input.close();await stop();return}
   if(request.schema){const list=await client.listTools();await output(list.tools.filter(t=>request.schema.includes(t.name)),'schemas');return}
   if(request.file){Object.assign(request,JSON.parse(await fs.readFile(path.resolve(request.file),'utf8')))}
   const startedAt=new Date().toISOString(),started=performance.now();
   const result=await client.callTool({name:request.name,arguments:request.arguments??{}},undefined,{timeout:180000});
   for(const [index,item]of (result.content??[]).entries())if(item.type==='image'){
    const imagePath=path.join(out,'image-'+String(sequence+1).padStart(3,'0')+'-'+index+'.png');
    await fs.writeFile(imagePath,Buffer.from(item.data,'base64'));item.data='[saved to '+imagePath+']';
   }
   const record=result.structuredContent?{...result.structuredContent,isError:result.isError,
    images:result.content?.filter(item=>item.type==='image')}:result;
   await output({tool:request.name,startedAt,elapsedMs:performance.now()-started,result:record},request.name);
  }catch(error){console.log(JSON.stringify({error:String(error)}))}
 });
});
input.on('close',()=>queue.then(stop));
process.once('SIGINT',()=>input.close());

