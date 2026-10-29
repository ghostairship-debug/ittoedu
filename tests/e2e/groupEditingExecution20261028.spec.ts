import { _electron as electron, expect, test, type Page, type ElectronApplication } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { frameCorners, composeMatrices, invertMatrix, rotationMatrix, scaleMatrix, translationMatrix, IDENTITY_MATRIX } from '../../src/core/components/geometry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { freeSurfaceTargets } from '../../src/renderer/componentPlatform/surfaces/slide/targets'

const root=resolve(__dirname,'../..')
const out=resolve(root,'output/creation-editing-20261028-execution')
const original=resolve(root,'output/continuation-20261028/product-ui/workspace/market.glx')
const g0='d727eeb0-7039-439b-91b5-1bfd973cd88e',g1='dbe2724a-509e-47af-a012-0a13462f29ed',g2='617cd7f7-6ec9-4a64-9316-80b9b172ad53'
const leaf='aba03ab8-5767-4124-b107-bbe0eb0f7794', sibling='53be18d7-6363-4880-9bfd-0770d3b4b38e'
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex')
async function launch(profile:string,workspace:string) {
 mkdirSync(profile,{recursive:true})
 const app=await electron.launch({cwd:root,args:['.', '--user-data-dir='+profile],env:{...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}})
 try {
  const page=await app.firstWindow()
  await app.evaluate(({BrowserWindow,dialog},directory)=>{
   const window=BrowserWindow.getAllWindows()[0];window?.setContentSize(1600,1000);window?.show();window?.focus()
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})
  },workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click()
  await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:'market.glx',exact:true}).dblclick()
  const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
  if(await editor.getAttribute('data-editor-mode')!=='deep')await editor.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
  await expect(editor).toHaveAttribute('data-editor-mode','deep')
  const documentId=await editor.getAttribute('data-document-id');if(!documentId)throw Error('Missing document identity')
  await expect(page.getByRole('main',{name:'画布',exact:true})).toBeVisible()
  await page.getByText('雨后开市',{exact:true}).first().click()
  await expect(page.locator('.course-editor-frame:visible .canvas-stage [data-component-instance="'+leaf+'"]').first()).toBeVisible()
  await page.evaluate(()=>document.fonts.ready)
  return {app,page,documentId}
 } catch(e) {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});throw e}
}
async function snapshot(page:Page,id:string) {const s=await page.evaluate(id=>window.desktopAPI.documents!.read(id),id);if(s.model.kind!=='course-v10')throw Error('Wrong model');return {...s,model:s.model}}
async function center(page:Page,id:string) {
 const element=page.locator('.course-editor-frame:visible .canvas-stage [data-component-instance="'+id+'"]').first()
 await expect(element).toBeVisible()
 return element.evaluate(el=>{
  // A text frame can contain empty space. Exercise the visible text, not the background beneath that whitespace.
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT)
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
   if(!node.textContent?.trim() || node.parentElement?.closest('script,style'))continue
   const range=document.createRange();range.selectNodeContents(node)
   const rect=[...range.getClientRects()].find(r=>r.width>0&&r.height>0)
   if(rect)for(const ry of [.5,.15,.85])for(const rx of [.5,.15,.85]) {
    const point={x:rect.x+rect.width*rx,y:rect.y+rect.height*ry},stack=document.elementsFromPoint(point.x,point.y)
    if(stack.some(e=>e.closest('.selection-quick-bar,.text-edit-toolbar,[data-handle]')))continue
    const front=stack.find(e=>!e.closest('[data-slide-authoring-hit-plane],.canvas-authoring-targets,.author-field-affordances,.teacher-controller-overlay,[data-group-context],[data-next-click-target]'))
    if(front?.closest('[data-component-instance]')?.getAttribute('data-component-instance')===el.getAttribute('data-component-instance'))return point
   }
  }
  const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}
 })
}
async function click(page:Page,id:string) {const p=await center(page,id);console.log('REAL_CLICK',id,p,await page.evaluate(point=>document.elementsFromPoint(point.x,point.y).slice(0,5).map(el=>({tag:el.tagName,classes:el.className,id:el.closest('[data-component-instance]')?.getAttribute('data-component-instance'),text:el.textContent?.slice(0,70)})),p));await page.mouse.click(p.x,p.y)}
async function selected(page:Page,ids:string[]) {await expect(page.getByRole('main',{name:'画布',exact:true})).toHaveAttribute('data-author-selection-ids',JSON.stringify(ids))}
async function drag(page:Page,id:string,dx:number,dy:number) {const p=await center(page,id);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.keyboard.down('Alt');await page.mouse.move(p.x+dx,p.y+dy,{steps:8});await page.mouse.up();await page.keyboard.up('Alt')}
async function close(app:ElectronApplication) {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}

test('market r32 uses real first-group/second-member gestures, ancestor return, Undo and saved cold reopen',async()=>{
 test.setTimeout(180_000)
 mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,'market-ui-')),workspace=join(run,'workspace');mkdirSync(workspace);copyFileSync(original,join(workspace,'market.glx'))
 const originalHash=hash(original),errors:string[]=[]
 let current=await launch(join(run,'profile'),workspace)
 try {
  const {page,documentId}=current;page.on('pageerror',e=>errors.push(String(e)))
  await page.keyboard.press('Escape');await page.keyboard.press('Escape')
  await click(page,leaf);await selected(page,[g0])
  await expect(page.getByRole('main',{name:'画布',exact:true})).toHaveAttribute('data-author-group','')
  const before=await snapshot(page,documentId)
  await drag(page,leaf,26,17)
  await expect.poll(async()=>JSON.stringify((await snapshot(page,documentId)).model.project.instances[g0].frame)).not.toBe(JSON.stringify(before.model.project.instances[g0].frame))
  const movedGroup=await snapshot(page,documentId)
  expect(movedGroup.model.project.instances[leaf]).toEqual(before.model.project.instances[leaf])
  expect(movedGroup.model.project.instances[sibling]).toEqual(before.model.project.instances[sibling])
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>JSON.stringify((await snapshot(page,documentId)).model.project.instances[g0].frame)).toBe(JSON.stringify(before.model.project.instances[g0].frame))
  await click(page,leaf);await selected(page,[leaf])
  await expect(page.getByRole('main',{name:'画布',exact:true})).toHaveAttribute('data-author-group',g0)
  await expect(page.locator('[data-group-context="'+g0+'"]')).toBeVisible()
  const memberBefore=await snapshot(page,documentId)
  await drag(page,leaf,31,21)
  await expect.poll(async()=>JSON.stringify((await snapshot(page,documentId)).model.project.instances[leaf].frame)).not.toBe(JSON.stringify(memberBefore.model.project.instances[leaf].frame))
  const movedMember=await snapshot(page,documentId)
  expect(movedMember.model.project.instances[sibling]).toEqual(memberBefore.model.project.instances[sibling])
  await click(page,sibling);await selected(page,[sibling])
  await expect(page.getByRole('main',{name:'画布',exact:true})).toHaveAttribute('data-author-group',g0)
  await click(page,leaf);await selected(page,[leaf])
  await page.keyboard.press('Escape');await selected(page,[g2])
  await page.keyboard.press('Escape');await selected(page,[g1])
  await page.keyboard.press('Escape');await selected(page,[g0])
  await page.keyboard.press('Escape');await selected(page,[])
  const p=await center(page,leaf);await page.keyboard.down('Control');await page.mouse.click(p.x,p.y);await page.keyboard.up('Control');await selected(page,[leaf])
  await page.screenshot({path:join(run,'member-context.png')})
  await page.keyboard.press('Escape');await selected(page,[g2])
  await page.keyboard.press('Escape');await selected(page,[g1])
  const beforeStructure=await snapshot(page,documentId),memberIds=beforeStructure.model.project.instances[g1].childIds!
  const corners=(project:typeof beforeStructure.model.project,id:string)=>{const target=freeSurfaceTargets(project,project.rootIds[0]).find(t=>t.instanceId===id)!;return frameCorners(target.frame,target.parentToSurface)}
  const originalCorners=Object.fromEntries(memberIds.map(id=>[id,corners(beforeStructure.model.project,id)]))
  const assertCorners=(project:typeof beforeStructure.model.project)=>{for(const id of memberIds)corners(project,id).forEach((point,index)=>{expect(point.x).toBeCloseTo(originalCorners[id][index].x,7);expect(point.y).toBeCloseTo(originalCorners[id][index].y,7)})}
  await page.getByRole('button',{name:'解除组合',exact:true}).click()
  await expect.poll(async()=>Boolean((await snapshot(page,documentId)).model.project.instances[g1])).toBe(false)
  await selected(page,memberIds)
  const ungrouped=await snapshot(page,documentId);assertCorners(ungrouped.model.project)
  for(const id of memberIds)expect(ungrouped.model.project.instances[id].data).toEqual(beforeStructure.model.project.instances[id].data)
  expect(ungrouped.model.project.instances[leaf]).toEqual(beforeStructure.model.project.instances[leaf])
  await page.getByRole('button',{name:'组合',exact:true}).click()
  const regrouped=await snapshot(page,documentId),newGroup=Object.values(regrouped.model.project.instances).find(i=>!ungrouped.model.project.instances[i.id])!
  expect(newGroup.childIds).toEqual(memberIds);assertCorners(regrouped.model.project)
  await selected(page,[newGroup.id]);await page.screenshot({path:join(run,'regrouped.png')})
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>Boolean((await snapshot(page,documentId)).model.project.instances[newGroup.id])).toBe(false)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances).toEqual(beforeStructure.model.project.instances)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>Boolean((await snapshot(page,documentId)).model.project.instances[g1])).toBe(false)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>Boolean((await snapshot(page,documentId)).model.project.instances[newGroup.id])).toBe(true)
  await page.keyboard.press('Control+s')
  await expect.poll(async()=>(await snapshot(page,documentId)).dirty).toBe(false)
  const saved=await snapshot(page,documentId)
  await close(current.app);current=await launch(join(run,'cold-profile'),workspace)
  const cold=await snapshot(current.page,current.documentId)
  expect(cold.model.project.instances).toEqual(saved.model.project.instances)
  expect(hash(original)).toBe(originalHash)
  await current.page.screenshot({path:join(run,'cold-open.png')})
  writeFileSync(join(run,'result.json'),JSON.stringify({status:'passed',sourceHash:originalHash,savedRevision:saved.revision,coldRevision:cold.revision,errors,scope:'Market real UI selection/drag/ungroup/regroup/Undo/Redo/save/cold-open; offline export not claimed here'},null,2))
 } catch(e) {await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});writeFileSync(join(run,'failure.json'),JSON.stringify({error:String(e),errors},null,2));throw e}
 finally {await close(current.app)}
})


test('transformed nested market groups preserve sibling world geometry through real member boundary drag, ungroup and saved cold reopen',async()=>{
 test.setTimeout(180_000)
 const completionOut=resolve(root,'output/creation-editing-completion-20261029/resume-geometry')
 mkdirSync(completionOut,{recursive:true});const run=mkdtempSync(join(completionOut,'transformed-ui-')),workspace=join(run,'workspace');mkdirSync(workspace)
 const originalHash=hash(original),driver=new CourseV10Driver(),model=await driver.load(readFileSync(original))
 if(model.kind!=='course-v10')throw Error('Wrong transformed fixture model')
 const corners=(project:typeof model.project,id:string)=>{const target=freeSurfaceTargets(project,project.rootIds[0]).find(t=>t.instanceId===id)!;return frameCorners(target.frame,target.parentToSurface)}
 const point=(m:readonly number[],x:number,y:number)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]})
 const transformParent=(id:string,angle:number,sx:number,sy:number)=>{
  const targets=freeSurfaceTargets(model.project,model.project.rootIds[0]),parent=targets.find(t=>t.instanceId===id)!,member=targets.find(t=>t.instanceId===leaf)!
  const centerInSurface=point(composeMatrices(member.parentToSurface??IDENTITY_MATRIX,member.frame.transform),member.frame.width/2,member.frame.height/2)
  const anchor=point(invertMatrix(parent.parentToSurface??IDENTITY_MATRIX),centerInSurface.x,centerInSurface.y)
  const frame=model.project.instances[id].frame!
  model.project.instances[id].frame={...frame,transform:[...composeMatrices(translationMatrix(anchor.x,anchor.y),rotationMatrix(angle),scaleMatrix(sx,sy),translationMatrix(-anchor.x,-anchor.y),frame.transform)]}
 }
 // Only the isolated fixture is prepared here. The measured editing and persistence below use the UI.
 transformParent(g0,Math.PI/6,1.6,.7);transformParent(g1,Math.PI/9,1,1)
 writeFileSync(join(workspace,'market.glx'),await driver.serialize(model))
 const errors:string[]=[];let current=await launch(join(run,'profile'),workspace)
 try{
  const {page,documentId}=current;page.on('pageerror',e=>errors.push(String(e)))
  await page.keyboard.press('Escape');await page.keyboard.press('Escape')
  await click(page,leaf);await selected(page,[g0]);await click(page,leaf);await selected(page,[leaf])
  const before=await snapshot(page,documentId),beforeSibling=corners(before.model.project,sibling),beforeLeaf=corners(before.model.project,leaf)
  const target=freeSurfaceTargets(before.model.project,before.model.project.rootIds[0]).find(t=>t.instanceId===leaf)!
  const localCorners=frameCorners(target.frame),dx=-Math.min(...localCorners.map(p=>p.x))-48,dy=-Math.min(...localCorners.map(p=>p.y))-28
  const parentToSurface=target.parentToSurface??IDENTITY_MATRIX,desiredSurfaceDelta={x:parentToSurface[0]*dx+parentToSurface[2]*dy,y:parentToSurface[1]*dx+parentToSurface[3]*dy}
  const box=await page.locator('.course-editor-frame:visible .canvas-stage [data-component-instance="'+leaf+'"]').first().boundingBox();if(!box)throw Error('Missing rendered member')
  const scale=box.width/(Math.max(...beforeLeaf.map(p=>p.x))-Math.min(...beforeLeaf.map(p=>p.x)))
  const hit=await center(page,leaf),start={x:Math.round(hit.x),y:Math.round(hit.y)},end={x:Math.round(hit.x+desiredSurfaceDelta.x*scale),y:Math.round(hit.y+desiredSurfaceDelta.y*scale)}
  await page.screenshot({path:join(run,'before-boundary-drag.png')})
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.down('Alt');await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();await page.keyboard.up('Alt')
  await expect.poll(async()=>JSON.stringify((await snapshot(page,documentId)).model.project.instances[leaf].frame)).not.toBe(JSON.stringify(before.model.project.instances[leaf].frame))
  const changed=await snapshot(page,documentId),afterLeaf=corners(changed.model.project,leaf),afterSibling=corners(changed.model.project,sibling)
  afterSibling.forEach((p,i)=>{expect(p.x).toBeCloseTo(beforeSibling[i].x,8);expect(p.y).toBeCloseTo(beforeSibling[i].y,8)})
  const delta={x:(end.x-start.x)/scale,y:(end.y-start.y)/scale}
  afterLeaf.forEach((p,i)=>{expect(Math.abs(p.x-beforeLeaf[i].x-delta.x)*scale).toBeLessThanOrEqual(.5);expect(Math.abs(p.y-beforeLeaf[i].y-delta.y)*scale).toBeLessThanOrEqual(.5)})
  expect(changed.model.project.instances[leaf].data).toEqual(before.model.project.instances[leaf].data)
  expect(changed.model.project.instances[sibling].data).toEqual(before.model.project.instances[sibling].data)
  expect(changed.model.project.instances[g2].frame!.width>before.model.project.instances[g2].frame!.width||changed.model.project.instances[g2].frame!.height>before.model.project.instances[g2].frame!.height).toBe(true)
  expect(changed.undoDepth-before.undoDepth).toBe(1)
  await page.screenshot({path:join(run,'after-boundary-drag.png')})
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances).toEqual(before.model.project.instances)
  await page.keyboard.press('Control+y');await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances).toEqual(changed.model.project.instances)
  await page.keyboard.press('Escape');await selected(page,[g2]);await page.keyboard.press('Escape');await selected(page,[g1])
  const beforeUngroup=await snapshot(page,documentId),memberIds=beforeUngroup.model.project.instances[g1].childIds!,worldBefore=Object.fromEntries(memberIds.map(id=>[id,corners(beforeUngroup.model.project,id)]))
  await page.getByRole('button',{name:'解除组合',exact:true}).click();await expect.poll(async()=>Boolean((await snapshot(page,documentId)).model.project.instances[g1])).toBe(false)
  const ungrouped=await snapshot(page,documentId)
  for(const id of memberIds){corners(ungrouped.model.project,id).forEach((p,i)=>{expect(p.x).toBeCloseTo(worldBefore[id][i].x,8);expect(p.y).toBeCloseTo(worldBefore[id][i].y,8)});expect(ungrouped.model.project.instances[id].data).toEqual(beforeUngroup.model.project.instances[id].data)}
  await page.keyboard.press('Control+s');await expect.poll(async()=>(await snapshot(page,documentId)).dirty).toBe(false)
  const saved=await snapshot(page,documentId);await close(current.app);current=await launch(join(run,'cold-profile'),workspace)
  const cold=await snapshot(current.page,current.documentId);expect(cold.model.project.instances).toEqual(saved.model.project.instances);expect(hash(original)).toBe(originalHash)
  await current.page.screenshot({path:join(run,'cold-open.png')})
  writeFileSync(join(run,'result.json'),JSON.stringify({status:'passed',sourceHash:originalHash,parentRotationDegrees:30,parentScale:[1.6,.7],nestedRotationDegrees:20,realBoundaryDrag:true,siblingWorldPreserved:true,oneHistory:true,ungroupWorldPreserved:true,savedRevision:saved.revision,coldRevision:cold.revision,errors,scope:'Real selection, transformed member drag, nested expansion, Undo/Redo, ungroup, save and independent cold reopen; resize and rotate handles not claimed'},null,2))
 }catch(e){await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});writeFileSync(join(run,'failure.json'),JSON.stringify({error:String(e),errors},null,2));throw e}
 finally{await close(current.app)}
})
