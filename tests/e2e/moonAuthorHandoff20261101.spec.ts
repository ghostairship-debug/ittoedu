/** Root-authored work: OS picker is the only substituted boundary. No model calls. */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root=path.resolve(__dirname,'../..')
const source=path.join(root,'output/comprehensive-execution-20261101/creation/workspace/月光的几何.glx')
const out=path.join(root,'output/comprehensive-execution-20261101/creation/moon-author-handoff')
const titleBefore='借来的光，变化的形。',titleAfter='借来的月光，变化的形。'
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
async function close(app:ElectronApplication|undefined){if(!app)return;await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
async function read(page:Page,id:string){return page.evaluate(async id=>{const s=await window.desktopAPI.documents!.read(id);if(s.model.kind!=='course-v10')throw Error('course required');return {project:s.model.project,revision:s.revision,dirty:s.dirty,undoDepth:s.undoDepth}},id)}
test('moon work supports native edits, undo and independent cold App reopening',async()=>{
 test.setTimeout(150_000);await fs.mkdir(out,{recursive:true})
 const workspace=await fs.mkdtemp(path.join(out,'workspace-')),profile=await fs.mkdtemp(path.join(out,'profile-'))
 const document=path.join(workspace,'月光的几何-教师版.glx'),original=await fs.readFile(source),originalSha=sha(original)
 await fs.writeFile(document,original,{flag:'wx'})
 const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))
 Object.assign(env,{VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'});delete env.ELECTRON_RUN_AS_NODE
 let app:ElectronApplication|undefined,page:Page|undefined,stage='start';const errors:string[]=[],network:string[]=[]
 const launch=async()=>{
  app=await electron.launch({cwd:root,args:['.','--user-data-dir='+profile],env,timeout:30000})
  page=await app.firstWindow();page.setDefaultTimeout(15000)
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url())})
  await app.evaluate(({BrowserWindow,dialog},workspace)=>{const w=BrowserWindow.getAllWindows()[0];w?.setContentSize(1500,1000);w?.show();w?.focus();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]})},workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:path.basename(document),exact:true}).dblclick()
  const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
  const open=editor.getByRole('button',{name:'在编辑器中打开',exact:true});if(await open.count())await open.click()
  await expect(editor).toHaveAttribute('data-editor-mode','deep')
  return {id:(await editor.getAttribute('data-document-id'))!,pid:app.process().pid}
 }
 try{
  const initial=await launch(),before=await read(page!,initial.id)
  const title=Object.values(before.project.instances).find(i=>JSON.stringify(i.data).includes(titleBefore))!
  expect(title).toBeTruthy()
  const visible=page!.locator('[data-component-instance="'+title.id+'"]:visible');await expect(visible).toBeVisible()
  stage='native-title';const b=await visible.boundingBox();expect(b).toBeTruthy();await page!.mouse.dblclick(b!.x+40,b!.y+20)
  const overlay=page!.locator('.text-edit-overlay[data-component-professional-editor]:visible'),input=overlay.locator('[contenteditable=true],textarea').first()
  await expect(input).toBeVisible();await input.press('Control+a');await page!.keyboard.insertText(titleAfter);await input.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect.poll(async()=>JSON.stringify((await read(page!,initial.id)).project.instances[title.id].data)).toContain(titleAfter)
  const changed=await read(page!,initial.id)
  expect(changed.project.instances[title.id].frame).toEqual(before.project.instances[title.id].frame)
  const normalized=structuredClone(changed.project);normalized.revision=before.project.revision;normalized.instances[title.id].data=structuredClone(before.project.instances[title.id].data)
  expect(normalized).toEqual(before.project)
  stage='history';const chrome=page!.getByTestId('course-try-run-chrome');await chrome.getByRole('button',{name:'编辑',exact:true}).click()
  await page!.keyboard.press('Control+z');await expect.poll(async()=>JSON.stringify((await read(page!,initial.id)).project.instances[title.id].data)).toContain(titleBefore)
  await page!.keyboard.press('Control+Shift+z');await expect.poll(async()=>JSON.stringify((await read(page!,initial.id)).project.instances[title.id].data)).toContain(titleAfter)
  stage='save';await page!.keyboard.press('Control+s');await expect.poll(async()=>(await read(page!,initial.id)).dirty).toBe(false)
  const saved=await read(page!,initial.id);await fs.writeFile(path.join(out,'human-author.json'),JSON.stringify(saved,null,2))
  await page!.screenshot({path:path.join(out,'human.png')});await close(app);app=undefined
  stage='cold';const cold=await launch(),reopened=await read(page!,cold.id);expect(cold.pid).not.toBe(initial.pid);expect(reopened.project).toEqual(saved.project);expect(reopened.dirty).toBe(false)
  await expect(page!.locator('[data-component-instance="'+title.id+'"]:visible')).toContainText(titleAfter)
  await page!.screenshot({path:path.join(out,'cold.png')});expect(errors).toEqual([]);expect(network).toEqual([]);expect(sha(await fs.readFile(source))).toBe(originalSha)
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'human-cold-verified-awaiting-root-source-handoff',document,workspace,profile,titleId:title.id,titleBefore,titleAfter,originalSha,sha256:sha(await fs.readFile(document)),initialPid:initial.pid,coldPid:cold.pid,checkedAt:new Date().toISOString(),errors,network},null,2))
 }catch(error){if(page)await page.screenshot({path:path.join(out,'failure-'+Date.now()+'.png')}).catch(()=>{});await fs.writeFile(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({stage,error:String(error),stack:error instanceof Error?error.stack:'',errors,network},null,2));throw error}
 finally{await close(app)}
})

