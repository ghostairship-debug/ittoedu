'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const record=(file,value)=>fs.writeFileSync(path.join(base,'evidence',file),JSON.stringify(value,null,2));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function checked(results){for(const r of results)if(r.kind==='error'||r.data?.commit==='not_committed'||r.data?.receipt?.status==='failed')throw Error(JSON.stringify(r))}
(async()=>{
 const w=await require('./session.cjs')({profile:'final-assembly-'+stamp,hidden:true});
 try{
  const before=await w.snapshot(),v06=path.join(base,'../v06/native/coffee-journey-v06.glx'),v06Hash=hash(v06);record('before-final-assembly.json',before);
  const files=await w.files(),source=files.find(f=>f.kind==='source'&&f.path.startsWith('components/')&&f.path.includes('underlay-poc.js.source/underlay-poc.js'));
  assert(source,'Shared Source entry observed');
  let results=await w.invoke([{name:'project.read',input:{path:source.path}},{name:'project.apply',input:{path:source.path,intent:'content',from:path.join(base,'background-entry.js')}}],base);
  record('final-background-apply.json',results);checked(results);console.log('BACKGROUND_APPLIED');
  const target=(await w.files()).find(f=>f.target?.instanceId==='8bc2720a-0b46-439a-98c1-dc505b1cb456'&&f.path.endsWith('.content.html'));assert(target,'U03 native program identity observed');
  results=await w.invoke([{name:'project.read',input:{path:target.path}},{name:'project.apply',input:{path:target.path,intent:'content',from:path.join(base,'programs/u03/u03.html')}}],base);
  record('final-u03-apply.json',results);checked(results);console.log('U03_APPLIED');
  const after=await w.snapshot();assert.deepEqual(Object.keys(after.project.instances).sort(),Object.keys(before.project.instances).sort());
  assert.deepEqual(after.project.rootIds,before.project.rootIds);assert.deepEqual(after.project.global,before.project.global);
  const changed=[];for(const id of Object.keys(before.project.instances)){
   if(JSON.stringify(after.project.instances[id])!==JSON.stringify(before.project.instances[id]))changed.push(id);
   if(!['926a6155-1814-4a16-ba47-24c1c1f5dbc8','8bc2720a-0b46-439a-98c1-dc505b1cb456'].includes(id))assert.deepEqual(after.project.instances[id],before.project.instances[id],'Preserved '+id);
   assert.equal(after.project.instances[id].definitionId,before.project.instances[id].definitionId,'Definition identity '+id);
  }
  const saved=await w.save('coffee-journey-v07.glx');console.log('SAVED',JSON.stringify(saved));
  const exported=await w.exportHtml('coffee-journey-v07-offline.html');record('final-export.json',exported);checked([exported]);
  record('current-project.json',await w.snapshot());fs.writeFileSync(path.join(base,'native/OBJECT_INDEX.json'),JSON.stringify(await w.files(),null,2));
  assert.equal(hash(v06),v06Hash);record('final-assembly-preservation.json',{revision:saved.revision,instances:Object.keys(after.project.instances).length,changedInstances:changed,allInstanceAndDefinitionIdsPreserved:true,rootAndGlobalPreserved:true,otherInstancesDeepEqual:true,v06Hash,pid:w.app.process().pid,errors:w.errors,build:JSON.parse(fs.readFileSync(path.join(base,'evidence/final-pass-baseline.json'),'utf8'))});
  console.log('EXPORTED',JSON.stringify(exported));console.log('PRESERVED',JSON.stringify({instances:Object.keys(after.project.instances).length,changed,v06Hash,errors:w.errors}));
 }finally{await w.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});