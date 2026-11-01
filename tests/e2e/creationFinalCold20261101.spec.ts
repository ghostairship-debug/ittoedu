/** Cold App acceptance of root-authored deliverables; production document and UI owners. */
import { _electron as electron, expect, test, type ElectronApplication, type Page, type Frame } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root=path.resolve(__dirname,'../..'),base=path.join(root,'output/comprehensive-execution-20261101/creation')
const artifacts=[
 {name:'月光的几何-教师版.glx',kind:'slide',roots:3,initial:0},
 {name:'灯塔守夜人.glx',kind:'program',roots:1,initial:3},
 {name:'夜航补给站.glx',kind:'program',roots:1,initial:3},
 {name:'夜航补给站-低储能情景.glx',kind:'program',roots:1,initial:2},
]
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
// Chromium's OOPIF box protocol omits an ancestor canvas scale in Electron.
// Compose actual browser rectangles through every iframe and verify each hit before a real pointer click.
async function clickAuthored(page:Page,frame:Frame,selector:string){
 let point=await frame.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})
 const chain:unknown[]=[]
 for(let current=frame;current.parentFrame();current=current.parentFrame()!){
  const owner=await current.frameElement()
  const geometry=await owner.evaluate(el=>{const e=el as HTMLElement,r=e.getBoundingClientRect();return{left:r.left,top:r.top,sx:r.width/e.offsetWidth,sy:r.height/e.offsetHeight,bx:e.clientLeft,by:e.clientTop}})
  point={x:geometry.left+(point.x+geometry.bx)*geometry.sx,y:geometry.top+(point.y+geometry.by)*geometry.sy}
  const hit=await owner.evaluate((el,p)=>el.ownerDocument?.elementFromPoint(p.x,p.y)===el,point)
  expect(hit,'actual frame paint hit').toBe(true);chain.push({point,geometry})
 }
 await page.mouse.click(point.x,point.y);return chain
}
async function close(app:ElectronApplication|undefined){if(!app)return;await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
async function author(page:Page,id:string){return page.evaluate(async id=>{const s=await window.desktopAPI.documents!.read(id);if(s.model.kind!=='course-v10')throw Error('course required')
 const sha=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(b)))].map(x=>x.toString(16).padStart(2,'0')).join('')
 const assets=Object.fromEntries(await Promise.all(Object.entries(s.model.resources.assets).map(async([id,b])=>[id,await sha(b)])))
 const components=Object.fromEntries(await Promise.all(Object.entries(s.model.resources.components).map(async([id,files])=>[id,Object.fromEntries(await Promise.all(Object.entries(files).map(async([name,b])=>[name,await sha(b)])))])))
 return {project:s.model.project,assets,components,revision:s.revision,dirty:s.dirty}
 },id)}
test('final works cold open with author state intact and actual native/program interactions',async()=>{
 test.setTimeout(210_000)
 const out=await fs.mkdtemp(path.join(base,'final-cold-')),workspace=path.join(out,'workspace'),profile=path.join(out,'profile')
 await fs.mkdir(workspace);await fs.mkdir(profile)
 const original=new Map<string,string>(),initialSnapshots=new Map<string,Awaited<ReturnType<typeof author>>>()
 for(const item of artifacts){const bytes=await fs.readFile(path.join(base,'workspace',item.name));original.set(item.name,hash(bytes));await fs.writeFile(path.join(workspace,item.name),bytes,{flag:'wx'})}
 const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))
 Object.assign(env,{VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'});delete env.ELECTRON_RUN_AS_NODE
 let app:ElectronApplication|undefined,page:Page|undefined,phase='start';const errors:string[]=[],network:string[]=[],pids:number[]=[],facts:unknown[]=[]
 try{
  for(const pass of ['initial','cold']){
   phase=pass+' launch';app=await electron.launch({cwd:root,args:['.','--user-data-dir='+profile],env,timeout:30000});pids.push(app.process().pid!)
   page=await app.firstWindow();page.setDefaultTimeout(15000)
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())})
   await app.evaluate(({BrowserWindow,dialog},workspace)=>{const w=BrowserWindow.getAllWindows()[0];w?.setContentSize(1500,1050);w?.show();w?.focus();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]})},workspace)
   await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
   for(const [index,item]of artifacts.entries()){
    phase=pass+' '+item.name
    await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:item.name,exact:true}).dblclick()
    const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
    await expect.poll(async()=>{const id=await editor.getAttribute('data-document-id');if(!id)return false;return page!.evaluate(async({id,name})=>{try{const s=await window.desktopAPI.documents!.read(id);return s.binding.kind==='file'&&s.binding.path.split(/[\\/]/).at(-1)===name}catch{return false}},{id,name:item.name})}).toBe(true)
    const id=(await editor.getAttribute('data-document-id'))!
    const before=await author(page,id);expect(before.project.rootIds).toHaveLength(item.roots);expect(before.dirty).toBe(false)
    if(pass==='initial')initialSnapshots.set(item.name,before)
    else expect(before).toEqual(initialSnapshots.get(item.name))
    if(item.kind==='slide'){
     expect(before.project.instances[before.project.rootIds[0]].name).toBe('看见光')
     await expect(page.locator('[data-component-instance="c6c4c035-2078-4bda-98b6-22b87dccbd39"]:visible')).toContainText('借来的月光，变化的形。')
     const chrome=page.getByTestId('course-try-run-chrome');await chrome.getByRole('button',{name:'试运行',exact:true}).click()
     await chrome.getByTestId('course-try-run-next').click()
     await expect.poll(async()=>{for(const f of page!.frames())if(await f.locator('#fraction').count())return true;return false}).toBe(true)
     const moonFrame=(await Promise.all(page.frames().map(async f=>(await f.locator('#fraction').count())?f:null))).find(Boolean)!
     await expect(moonFrame.locator('#reset')).toHaveText('回到上弦');await expect(moonFrame.locator('[data-phase="90"]')).toHaveAttribute('aria-pressed','true')
     const pointerChain=await clickAuthored(page,moonFrame,'[data-phase="180"]');await expect(moonFrame.locator('#fraction')).toHaveText('100%')
     await moonFrame.locator('[data-phase="90"]').focus();await page.keyboard.press('Enter');await expect(moonFrame.locator('#fraction')).toHaveText('50%')
     await fs.writeFile(path.join(out,pass+'-pointer.json'),JSON.stringify({pointerChain,actualPointer:true,keyboard:true},null,2))
     await chrome.getByTestId('course-try-run-previous').click();await chrome.getByRole('button',{name:'编辑',exact:true}).click()
    }else{
     const instance=before.project.instances[before.project.rootIds[0]];expect(instance.container).toBeUndefined();expect(instance.frame).toBeUndefined()
     const chrome=page.getByTestId('course-try-run-chrome');await chrome.getByRole('button',{name:'试运行',exact:true}).click()
     const frame=page.frameLocator('[data-program-viewport]:visible iframe').first()
     await expect(frame.locator('#battery')).toHaveText(String(item.initial));await frame.locator('#execute').click();await expect(frame.locator('#battery')).toHaveText(String(item.initial+2))
     await frame.locator('#undo').click();await expect(frame.locator('#battery')).toHaveText(String(item.initial));await chrome.getByRole('button',{name:'编辑',exact:true}).click()
    }
    expect(await author(page,id)).toEqual(before)
    expect(hash(await fs.readFile(path.join(workspace,item.name)))).toBe(original.get(item.name))
    await page.screenshot({path:path.join(out,pass+'-'+index+'.png')})
    facts.push({pass,name:item.name,revision:before.revision,roots:item.roots,authorUnchanged:true,interacted:true})
   }
   await close(app);app=undefined
  }
  expect(pids[0]).not.toBe(pids[1]);expect(errors).toEqual([]);expect(network).toEqual([])
  for(const item of artifacts)expect(hash(await fs.readFile(path.join(base,'workspace',item.name)))).toBe(original.get(item.name))
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'cold-app-verified',checkedAt:new Date().toISOString(),pids,facts,errors,network,originalsUnchanged:true,modelRequests:0},null,2))
  await fs.writeFile(path.join(base,'final-cold-latest.json'),JSON.stringify({out},null,2))
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'frames.json'),JSON.stringify(await Promise.all(page.frames().map(async f=>({url:f.url(),facts:await f.evaluate(()=>({activity:Reflect.get(window,'__guolingRuntimeActivity'),log:Reflect.get(window,'__coldClickLog'),button:typeof (document.querySelector('[data-phase="180"]') as HTMLElement)?.onclick})).catch(()=>null),html:await f.content().catch(()=>'<detached>')}))),null,2)).catch(()=>{})}await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({phase,error:String(error),stack:error instanceof Error?error.stack:'',errors,network,facts},null,2));throw error}
 finally{await close(app)}
})

