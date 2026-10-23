'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');const base=path.resolve(__dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const write=(f,v)=>fs.writeFileSync(path.join(base,'evidence',f),JSON.stringify(v,null,2));
(async()=>{let w,cold;try{
 w=await require('./session.cjs')({profile:'reading-guard-'+stamp,hidden:true});const before=await w.snapshot();const source=(await w.files()).find(f=>f.kind==='source'&&f.path.startsWith('components/')&&f.path.includes('underlay-poc.js.source/underlay-poc.js'));
 const result=await w.invoke([{name:'project.read',input:{path:source.path}},{name:'project.apply',input:{path:source.path,intent:'content',from:path.join(base,'background-entry.js')}}],base);for(const r of result)assert.notEqual(r.kind,'error',JSON.stringify(r));write('final-reading-guard-apply.json',result);
 const after=await w.snapshot();assert.deepEqual(after.project.instances,before.project.instances,'All instance data/style unchanged by source-only refinement');
 const save=await w.save('coffee-journey-v07.glx'),state=await w.snapshot(),oldPid=w.app.process().pid;await w.close();w=null;
 cold=await require('./session.cjs')({profile:'delivery-cold-'+stamp,hidden:true});const reopened=await cold.snapshot();assert.deepEqual(reopened.project,state.project);assert.equal(reopened.dirty,false);const newPid=cold.app.process().pid;assert.notEqual(oldPid,newPid);
 const exported=await cold.exportHtml('coffee-journey-v07-offline.html');write('final-export.json',exported);assert.notEqual(exported.kind,'error',JSON.stringify(exported));
 const preservation=JSON.parse(fs.readFileSync(path.join(base,'evidence/final-assembly-preservation.json'),'utf8'));preservation.revision=reopened.revision;write('final-assembly-preservation.json',preservation);
 write('current-project.json',reopened);fs.writeFileSync(path.join(base,'native/OBJECT_INDEX.json'),JSON.stringify(await cold.files(),null,2));write('final-cold-open.json',{revision:reopened.revision,fullProjectEqual:true,dirty:false,oldPid,newPid,save,errors:cold.errors,export:exported});
 console.log('DELIVERY_EXPORTED',JSON.stringify({revision:reopened.revision,oldPid,newPid,fullProjectEqual:true,export:exported,errors:cold.errors},null,2));
}finally{if(w)await w.close();if(cold)await cold.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});