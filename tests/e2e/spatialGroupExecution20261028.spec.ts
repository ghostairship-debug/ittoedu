import { _electron as electron, expect, test, type Page, type ElectronApplication } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync,zipSync,strFromU8,strToU8 } from 'fflate'
import { createComponentContainerInstance,componentContainerBuiltinKey,type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { frameCorners } from '../../src/core/components/geometry'
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
  await expect(page.getByTestId('spatial-world-stage')).toBeVisible()
  await page.getByText('雨后开市',{exact:true}).first().click()
  await expect(page.locator('.course-editor-frame:visible [data-testid="spatial-world-stage"] [data-component-instance="'+leaf+'"]').first()).toBeVisible()
  await page.evaluate(()=>document.fonts.ready)
  return {app,page,documentId}
 } catch(e) {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});throw e}
}
async function snapshot(page:Page,id:string) {const s=await page.evaluate(id=>window.desktopAPI.documents!.read(id),id);if(s.model.kind!=='course-v10')throw Error('Wrong model');return {...s,model:s.model}}
async function center(page:Page,id:string) {
 const element=page.locator('.course-editor-frame:visible [data-testid="spatial-world-stage"] [data-component-instance="'+id+'"]').first()
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
async function selected(page:Page,ids:string[]) {await expect(page.getByTestId('spatial-world-stage')).toHaveAttribute('data-author-selection-ids',JSON.stringify(ids))}
async function drag(page:Page,id:string,dx:number,dy:number) {const p=await center(page,id);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.keyboard.down('Alt');await page.mouse.move(p.x+dx,p.y+dy,{steps:8});await page.mouse.up();await page.keyboard.up('Alt')}
async function close(app:ElectronApplication) {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}

test('Spatial uses the same group and member gestures, preserves other members, and cold reopens',async()=>{
 test.setTimeout(120_000);mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,'spatial-ui-')),workspace=join(run,'workspace');mkdirSync(workspace)
 const archive=unzipSync(readFileSync(original)),project=JSON.parse(strFromU8(archive['project.json'])) as CourseProjectV10,rootId=project.rootIds[0]!,key=componentContainerBuiltinKey('spatial')
 project.definitions[key]={id:key,role:'mixed',implementation:{kind:'builtin',key}}
 project.instances[rootId]=createComponentContainerInstance({id:rootId,kind:'spatial',title:'雨后开市',childIds:project.instances[rootId]!.childIds!,designSize:{width:1280,height:840},spatial:{home:{x:650,y:420,zoom:.65},frames:[]}},key)
 project.entry={rootInstanceId:rootId};archive['project.json']=strToU8(JSON.stringify(project));writeFileSync(join(workspace,'market.glx'),zipSync(archive))
 const sourceHash=hash(original);let current=await launch(join(run,'profile'),workspace)
 try{
  const {page,documentId}=current;await page.keyboard.press('Escape');await page.keyboard.press('Escape')
  const before=await snapshot(page,documentId)
  await click(page,leaf);await selected(page,[g0])
  await drag(page,leaf,22,17)
  await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[g0].frame).not.toEqual(before.model.project.instances[g0].frame)
  expect((await snapshot(page,documentId)).model.project.instances[leaf]).toEqual(before.model.project.instances[leaf])
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[g0].frame).toEqual(before.model.project.instances[g0].frame)
  await click(page,leaf);await selected(page,[leaf])
  await expect(page.getByTestId('spatial-world-stage')).toHaveAttribute('data-author-group',g0)
  await expect(page.locator('[data-group-context="'+g0+'"]')).toBeVisible()
  await drag(page,leaf,26,18)
  await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[leaf].frame).not.toEqual(before.model.project.instances[leaf].frame)
  expect((await snapshot(page,documentId)).model.project.instances[sibling]).toEqual(before.model.project.instances[sibling])
  await click(page,sibling);await selected(page,[sibling]);await click(page,leaf);await selected(page,[leaf])
  await page.keyboard.press('Escape');await selected(page,[g2])
  await page.keyboard.press('Escape');await selected(page,[g1])
  await page.keyboard.press('Escape');await selected(page,[g0]);await page.keyboard.press('Escape');await selected(page,[])
  const point=await center(page,leaf);await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);await page.keyboard.up('Control');await selected(page,[leaf])
  await page.screenshot({path:join(run,'spatial-group-context.png')});await page.keyboard.press('Control+s')
  await expect.poll(async()=>(await snapshot(page,documentId)).dirty).toBe(false)
  const saved=await snapshot(page,documentId);await close(current.app);current=await launch(join(run,'cold-profile'),workspace)
  expect((await snapshot(current.page,current.documentId)).model.project.instances).toEqual(saved.model.project.instances)
  expect(hash(original)).toBe(sourceHash);writeFileSync(join(run,'result.json'),JSON.stringify({status:'passed',sourceHash,savedRevision:saved.revision},null,2))
 }catch(e){await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});writeFileSync(join(run,'failure.json'),JSON.stringify({error:String(e)},null,2));throw e}
 finally{await close(current.app)}
})
