'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createRequire}=require('node:module');
const root='D:/果铃工作台',r=createRequire(root+'/package.json'),{_electron:electron,chromium,expect}=r('@playwright/test');
module.exports=async(options={})=>{
 const out=__dirname,base=path.join(root,'docs/creative-production/works/coffee-journey/design/v07'),workspace=options.workspace||path.join(base,'native'),filename=options.filename||'coffee-journey-v07.glx';
 const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>typeof v==='string'&&!/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(k)&&k!=='ELECTRON_RUN_AS_NODE'));
 Object.assign(env,{VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:options.hidden?'1':'0'});
 const runtimeRoot=path.join(out,'runtime-snapshot');
 const app=await electron.launch({cwd:runtimeRoot,args:['.','--user-data-dir='+path.join(out,options.profile||'warm-profile')],env});
 try {
 const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},hidden)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1100);w.setTitle('咖啡作品创作隔离窗口');if(hidden)w.hide();else w.show()},Boolean(options.hidden));
 await expect(page.getByLabel('切换工作空间',{exact:true})).toBeVisible();
 await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace);
 await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click();
 await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:filename,exact:true}).dblclick();
 const frame=page.locator('.course-editor-frame:visible');await expect(frame).toBeVisible({timeout:60000});if(await frame.getAttribute('data-editor-mode')!=='deep')await frame.getByRole('button',{name:'在编辑器中打开',exact:true}).click();
 const id=await frame.getAttribute('data-document-id');
 await app.evaluate(({app},id)=>{const r=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');globalThis.coffeeAuthor={r,host:r('./dist-electron/main/workbench/documentHost.js').documentHost(),id,sequence:0}},id);
 const snapshot=()=>app.evaluate(async()=>{const c=globalThis.coffeeAuthor,s=await c.host.internalAPI.read(c.id);return{documentId:s.documentId,revision:s.revision,dirty:s.dirty,undoDepth:s.undoDepth,redoDepth:s.redoDepth,epoch:s.epoch,project:s.model.project}});
 const files=()=>app.evaluate(async()=>{const c=globalThis.coffeeAuthor,s=await c.host.internalAPI.read(c.id);return c.r('./dist-electron/core/projectFiles/componentPlatform/index.js').componentProjectFiles(s.model.project,s.model.resources).map(f=>({path:f.path,kind:f.kind,target:f.target}))});
 const commit=(edits,label)=>app.evaluate(async({app},{edits,label})=>{const c=globalThis.coffeeAuthor,s=await c.host.internalAPI.read(c.id),command=c.r('./dist-electron/core/drivers/courseV10Operations.js').captureComponentOperation(s.model.project,edits);return c.host.internalAPI.dispatch({documentId:s.documentId,epoch:s.epoch,baseRevision:s.revision,operationId:'coffee-v07-'+label+'-'+Date.now()+'-'+(++c.sequence),actor:'human',mutation:{type:'command',command}})},{edits,label});
 const history=type=>app.evaluate(async({app},type)=>{const c=globalThis.coffeeAuthor,s=await c.host.internalAPI.read(c.id);return c.host.internalAPI.dispatch({documentId:s.documentId,epoch:s.epoch,baseRevision:s.revision,operationId:'coffee-v07-'+type+'-'+Date.now()+'-'+(++c.sequence),actor:'human',mutation:{type}})},type);
 const invoke=async(calls,assetRoot=base)=>app.evaluate(async({app},{calls,assetRoot})=>{const c=globalThis.coffeeAuthor,runId='coffee-v07-'+Date.now()+'-'+(++c.sequence),results=[];await c.host.tools.beginRun({runId,actor:'human',documents:[{documentId:c.id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:assetRoot}});await c.host.tools.loadToolFamilies(runId,['content','media','build']);try{for(const call of calls)results.push(await c.host.tools.execute(runId,'op-'+(++c.sequence),call))}finally{await c.host.tools.stop(runId)}return results},{calls,assetRoot});
 const save=filename=>app.evaluate(async({app},filename)=>{const c=globalThis.coffeeAuthor,s=await c.host.internalAPI.save(c.id,filename);return{revision:s.revision,path:s.binding?.path,dirty:s.dirty}},path.resolve(workspace,filename));
 const exportHtml=filename=>app.evaluate(async({app},{workspace,filename})=>{const c=globalThis.coffeeAuthor,runId='coffee-export-'+Date.now()+'-'+(++c.sequence);await c.host.tools.beginRun({runId,actor:'human',documents:[{documentId:c.id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:workspace}});try{await c.host.tools.loadToolFamilies(runId,['build']);const opened=await c.host.tools.completeOpenedDocument(runId,{documentId:c.id,writable:true},{selection:'preserve'});return await c.host.tools.execute(runId,'export',{name:'document.export',input:{target:opened.target,format:'html-offline',destination:filename}})}finally{await c.host.tools.stop(runId)}},{workspace,filename});
 const close=async()=>{await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>{});await app.close().catch(()=>{})};
 await fs.writeFile(path.join(out,options.profile+'-project.json'),JSON.stringify(await snapshot(),null,2));
 await fs.writeFile(path.join(out,options.profile+'-files.json'),JSON.stringify(await files(),null,2));
 return{app,page,frame,id,out,base,workspace,snapshot,files,commit,history,invoke,save,exportHtml,close,errors,expect,chromium};
 }catch(error){await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>{});await app.close().catch(()=>{});throw error}
};
