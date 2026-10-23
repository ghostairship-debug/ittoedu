'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const write=(n,v)=>fs.writeFileSync(path.join(base,'evidence',n),JSON.stringify(v,null,2));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const cfg=path.join(base,'background-stages.js');let text=fs.readFileSync(cfg,'utf8').replace(/\r\n/g,'\n');const stages=JSON.parse(text.match(/export const STAGES = ([\s\S]*?);\nexport const READING_KNOTS/)[1]);
 Object.assign(stages[2],{x:.565,y:.175,scale:.64,mx:.97});
 Object.assign(stages[3],{x:.45,y:.25,scale:.64,mx:.99});
 Object.assign(stages[4],{x:.29,y:.86,scale:.68,mx:1.035});
 Object.assign(stages[5],{x:.875,y:.085,scale:.82,mx:1.035});
 text=text.replace(/export const STAGES = [\s\S]*?;\nexport const READING_KNOTS/,'export const STAGES = '+JSON.stringify(stages,null,2)+';\nexport const READING_KNOTS');
 const measured=JSON.parse(fs.readFileSync(path.join(base,'evidence/final-offline-verification.json'),'utf8'));
 const knots=Object.fromEntries(measured.map(row=>[row.width<700?'mobile':'desktop',row.chapters.map(c=>JSON.parse(c.reading).progress)]));
 text=text.replace(/export const READING_KNOTS = [\s\S]*?;\nexport const TRANSITION_NOTES/,'export const READING_KNOTS = '+JSON.stringify(knots,null,2)+';\nexport const TRANSITION_NOTES');
 fs.writeFileSync(cfg,text);
 let w,cold;try{
  w=await require('./session.cjs')({profile:'composition-polish-'+stamp,hidden:true});const before=await w.snapshot();
  const source=(await w.files()).find(f=>f.kind==='source'&&f.path.startsWith('components/')&&f.path.includes('underlay-poc.js.source/underlay-poc.js'));assert(source);
  const apply=await w.invoke([{name:'project.read',input:{path:source.path}},{name:'project.apply',input:{path:source.path,intent:'content',from:path.join(base,'background-entry.js')}}],base);
  for(const r of apply)assert.notEqual(r.kind,'error',JSON.stringify(r));
  const group='403273c0-8b31-41ad-ae6b-0ebd75a8370a',padding='clamp(55px,calc(67.343px - .85714cqi),64px) 0 45px';
  const roastGroup='20b6839d-2a3a-4cfb-9bdf-0b6031d30803';
  const native=await w.commit([{type:'style.set',instanceId:group,path:['padding'],value:padding},{type:'style.set',instanceId:roastGroup,path:['paddingTop'],value:'clamp(0px,calc(49.18px - 4.918cqi),30px)'}],'authored-mobile-chapter-clearance');assert.equal(native.status,'applied');
  const after=await w.snapshot();for(const id of Object.keys(before.project.instances))if(![group,roastGroup].includes(id))assert.deepEqual(after.project.instances[id],before.project.instances[id]);
  const saved=await w.save('coffee-journey-v07.glx'),state=await w.snapshot(),oldPid=w.app.process().pid;write('composition-polish.json',{stages,knots,sourceReceipt:apply,nativeReceipt:native,reason:'U03/U04 use the real typographic gutter; U05 lower-left negative space; U06 above the intro. U01 authored mobile top padding clears its own pinned navigation, no navigation offset or host code changed.',saved,errors:w.errors});
  await w.close();w=null;cold=await require('./session.cjs')({profile:'final-cold-'+stamp,hidden:true});const reopened=await cold.snapshot();assert.deepEqual(reopened.project,state.project);assert.equal(reopened.dirty,false);const newPid=cold.app.process().pid;assert.notEqual(oldPid,newPid);
  const exported=await cold.exportHtml('coffee-journey-v07-offline.html');write('final-export.json',exported);assert.notEqual(exported.kind,'error',JSON.stringify(exported));
  const baseline=JSON.parse(fs.readFileSync(path.join(base,'evidence/before-final-assembly.json'),'utf8')),changed=[];
  for(const id of Object.keys(baseline.project.instances)){assert.equal(reopened.project.instances[id].definitionId,baseline.project.instances[id].definitionId);if(JSON.stringify(reopened.project.instances[id])!==JSON.stringify(baseline.project.instances[id]))changed.push(id)}
  assert.deepEqual(reopened.project.rootIds,baseline.project.rootIds);assert.deepEqual(reopened.project.global,baseline.project.global);
  const preserved={revision:reopened.revision,instances:Object.keys(reopened.project.instances).length,allInstanceAndDefinitionIdsPreserved:true,rootAndGlobalPreserved:true,changedInstances:changed,sourceDefinitionUpdated:true,v06Hash:hash(path.join(base,'../v06/native/coffee-journey-v06.glx'))};
  write('final-assembly-preservation.json',preserved);write('final-cold-open.json',{revision:reopened.revision,fullProjectEqual:true,dirty:false,oldPid,newPid,errors:cold.errors,export:exported});write('current-project.json',reopened);fs.writeFileSync(path.join(base,'native/OBJECT_INDEX.json'),JSON.stringify(await cold.files(),null,2));
  console.log('FINAL_COMPOSITION',JSON.stringify({revision:reopened.revision,preserved,fullProjectColdEqual:true,oldPid,newPid,export:exported,errors:cold.errors},null,2));
 }finally{if(w)await w.close();if(cold)await cold.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});