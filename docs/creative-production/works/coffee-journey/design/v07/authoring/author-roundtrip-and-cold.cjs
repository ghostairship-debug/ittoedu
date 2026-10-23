'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const write=(f,v)=>fs.writeFileSync(path.join(base,'evidence',f),JSON.stringify(v,null,2));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const findFrame=async(w,selector)=>{let found;await w.expect.poll(async()=>{for(const f of w.page.frames()){if(await f.locator(selector).count()){found=f;return true}}return false},{timeout:30000}).toBe(true);return found};
(async()=>{
 let w,cold;const facts={date:new Date().toISOString()};
 try{
  w=await require('./session.cjs')({profile:'author-check-'+stamp,hidden:true});
  const before=await w.snapshot(),baseline=JSON.parse(fs.readFileSync(path.join(base,'evidence/before-final-assembly.json'),'utf8')),project=before.project;
  assert.equal(Object.keys(project.instances).length,183);
  const changed=[];for(const [id,previous]of Object.entries(baseline.project.instances)){
   assert.equal(project.instances[id].definitionId,previous.definitionId);
   if(JSON.stringify(project.instances[id])!==JSON.stringify(previous))changed.push(id);
   if(!['926a6155-1814-4a16-ba47-24c1c1f5dbc8','8bc2720a-0b46-439a-98c1-dc505b1cb456'].includes(id))assert.deepEqual(project.instances[id],previous);
  }
  assert.deepEqual(project.rootIds,baseline.project.rootIds);assert.deepEqual(project.global,baseline.project.global);
  facts.preservation={instances:183,allInstanceAndDefinitionIdsPreserved:true,rootAndGlobalPreserved:true,otherInstancesDeepEqual:true,changedInstances:changed,v06Hash:hash(path.join(base,'../v06/native/coffee-journey-v06.glx'))};
  const target=project.instances['dd6eb479-a0f3-4284-8f56-af846f15f328'],content=structuredClone(target.data.content),old=content.inlines[0].text,next=old+'〔v07验收〕';content.inlines[0].text=next;
  const receipt=await w.commit([{type:'data.set',instanceId:target.id,path:['content'],value:content}],'native-edit-roundtrip');assert.equal(receipt.status,'applied');
  const after=(await w.snapshot()).project;for(const id of Object.keys(project.instances))if(id!==target.id)assert.deepEqual(after.instances[id],project.instances[id]);
  const value=async()=>(await w.snapshot()).project.instances[target.id].data.content.inlines[0].text;
  await w.frame.getByRole('button',{name:'撤销',exact:true}).click({force:true});await w.expect.poll(value).toBe(old);
  await w.frame.getByRole('button',{name:'重做',exact:true}).click({force:true});await w.expect.poll(value).toBe(next);
  await w.frame.getByRole('button',{name:'撤销',exact:true}).click({force:true});await w.expect.poll(value).toBe(old);
  facts.nativeEdit={instanceId:target.id,receipt,neighboursUnchanged:true,undo:true,redo:true,restored:true};
  await w.frame.getByRole('button',{name:'试运行',exact:true}).click({force:true});
  const bg=await findFrame(w,'[data-coffee-underlay]'),root=bg.locator('[data-coffee-underlay]');await w.expect(root).toHaveAttribute('data-assets-ready','6',{timeout:30000});
  const mount=await root.getAttribute('data-mount-id');const nav=await findFrame(w,'nav[aria-label="作品章节"]');await nav.locator('nav[aria-label="作品章节"] button').nth(3).click({force:true});
  await w.expect(root).toHaveAttribute('data-chapter','4',{timeout:10000});await w.expect(root).toHaveAttribute('data-idle','true');
  facts.trial=await root.evaluate(e=>({dataset:{...e.dataset},rect:e.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight}}));assert.equal(facts.trial.rect.width,facts.trial.viewport.width);assert.equal(facts.trial.rect.height,facts.trial.viewport.height);
  await w.page.screenshot({path:path.join(base,'previews/final-editor-trial.png')});
  await w.frame.getByRole('button',{name:'编辑',exact:true}).click({force:true});await w.expect(root).toHaveAttribute('data-suspended','true');
  await w.frame.getByRole('button',{name:'试运行',exact:true}).click({force:true});await w.expect(root).toHaveAttribute('data-suspended','false');assert.equal(await root.getAttribute('data-mount-id'),mount);facts.editorLifecycle={sameMount:true,suspendResume:true};
  await w.frame.getByRole('button',{name:'编辑',exact:true}).click({force:true});
  facts.save=await w.save('coffee-journey-v07.glx');const saved=await w.snapshot();facts.oldPid=w.app.process().pid;facts.warmErrors=[...w.errors];write('author-roundtrip-intermediate.json',facts);write('pre-cold-project.json',saved);await w.close();w=null;
  cold=await require('./session.cjs')({profile:'cold-check-'+stamp,hidden:true});
  const reopened=await cold.snapshot();assert.deepEqual(reopened.project,saved.project);assert.equal(reopened.dirty,false);facts.newPid=cold.app.process().pid;assert.notEqual(facts.newPid,facts.oldPid);facts.coldOpen={fullProjectEqual:true,dirty:false,revision:reopened.revision};
  const exported=await cold.exportHtml('coffee-journey-v07-offline.html');write('final-export.json',exported);if(exported.kind==='error')throw Error(JSON.stringify(exported));facts.export=exported;facts.coldErrors=[...cold.errors];
  write('current-project.json',await cold.snapshot());fs.writeFileSync(path.join(base,'native/OBJECT_INDEX.json'),JSON.stringify(await cold.files(),null,2));write('final-author-roundtrip-and-cold.json',facts);write('final-assembly-preservation.json',facts.preservation);
  console.log(JSON.stringify({revision:reopened.revision,preservation:facts.preservation,nativeEdit:{undo:true,redo:true,restored:true},trial:facts.trial,editorLifecycle:facts.editorLifecycle,coldOpen:facts.coldOpen,oldPid:facts.oldPid,newPid:facts.newPid,export:exported,warmErrors:facts.warmErrors,coldErrors:facts.coldErrors},null,2));
 }finally{if(w)await w.close();if(cold)await cold.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});