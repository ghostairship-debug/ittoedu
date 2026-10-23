const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));
const ok=results=>{for(const r of results)if(r.kind==='error'||r.data?.commit==='not_committed'||r.data?.receipt?.status==='failed')throw Error(JSON.stringify(r))};
(async()=>{
 const w=await require('./session.cjs')({filename:'coffee-journey-v07.glx',profile:'assemble-01',hidden:true});
 try{
  const before=await w.snapshot(),originalPath=path.join(w.base,'../v06/native/coffee-journey-v06.glx');
  const baselineHash=crypto.createHash('sha256').update(fs.readFileSync(originalPath)).digest('hex');
  write(path.join(w.base,'evidence','before-assembly.json'),{revision:before.revision,instances:Object.keys(before.project.instances).length,originalPath,baselineHash});
  const files=await w.files(),source=files.find(f=>f.kind==='source'&&f.path.startsWith('components/')&&f.path.includes('underlay-poc.js.source/underlay-poc.js'));
  assert(source,'Observed shared background source path exists');
  console.log('APPLY_BACKGROUND',source.path);
  const results=await w.invoke([{name:'project.read',input:{path:source.path}},{name:'project.apply',input:{path:source.path,intent:'content',from:path.join(w.base,'background-entry.js')}}],w.base);
  write(path.join(w.base,'evidence','background-assembly-receipt.json'),results);ok(results);
  const u03=path.join(w.base,'programs/u03/u03.html');
  if(fs.existsSync(u03)&&process.argv.includes('--u03-ready')){
   const target=(await w.files()).find(f=>f.target?.instanceId==='8bc2720a-0b46-439a-98c1-dc505b1cb456'&&f.path.endsWith('.content.html'));assert(target);
   const r=await w.invoke([{name:'project.read',input:{path:target.path}},{name:'project.apply',input:{path:target.path,intent:'content',from:u03}}],w.base);ok(r);write(path.join(w.base,'evidence','u03-assembly-receipt.json'),r);console.log('APPLY_U03',target.path);
  }
  const after=(await w.snapshot()).project;assert.deepEqual(Object.keys(after.instances).sort(),Object.keys(before.project.instances).sort());assert.deepEqual(after.rootIds,before.project.rootIds);assert.deepEqual(after.global,before.project.global);
  for(const id of Object.keys(before.project.instances))if(!['926a6155-1814-4a16-ba47-24c1c1f5dbc8','8bc2720a-0b46-439a-98c1-dc505b1cb456'].includes(id))assert.deepEqual(after.instances[id],before.project.instances[id],'Preserved instance '+id);
  console.log('IDENTITIES_PRESERVED',Object.keys(after.instances).length);
  const saved=await w.save('coffee-journey-v07.glx');console.log('SAVED',JSON.stringify(saved));
  const exported=await w.exportHtml('coffee-journey-v07-offline.html');write(path.join(w.base,'evidence','initial-export.json'),exported);console.log('EXPORTED',JSON.stringify({kind:exported.kind,commit:exported.data?.commit,warnings:exported.data?.warnings,path:exported.data?.path}));
  write(path.join(w.base,'evidence','current-project.json'),await w.snapshot());write(path.join(w.base,'native','OBJECT_INDEX.json'),await w.files());
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(originalPath)).digest('hex'),baselineHash);console.log('V06_UNCHANGED',baselineHash);
 }finally{await w.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
