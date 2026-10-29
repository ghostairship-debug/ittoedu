import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ChartData } from '../../src/components/chart/data'

const root=resolve(__dirname,'../..'),out=resolve(root,'output/creation-editing-completion-20261029/resume-market-chart-ui')
const chartId='instance_11rTV8cnAc2Ye21Lkjhvv',originalTitle='各摊位营业额 / 元',changedTitle='各摊位营业额 · 人工复核 / 元',changedFont=22
const chartSelector='svg[data-native-chart-id="'+chartId+'"]',titleSelector=chartSelector+' text[data-chart-text="title"]'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
type Model=Awaited<ReturnType<CourseV10Driver['load']>>
const chart=(project:CourseProjectV10)=>project.instances[chartId].data as unknown as ChartData
async function read(page:Page,id:string){const value=await page.evaluate(id=>window.desktopAPI.documents!.read(id),id);if(value.model.kind!=='course-v10')throw Error('Expected the formal course Session');return{...value,model:value.model}}
async function close(app:ElectronApplication){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
async function launch(profile:string,workspace:string,fileName:string,errors:string[]){
 mkdirSync(profile,{recursive:true})
 const app=await electron.launch({cwd:root,args:['.','--user-data-dir='+profile],env:{...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}})
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(15_000);page.on('pageerror',error=>errors.push(error.message))
  await app.evaluate(({BrowserWindow,dialog},directory)=>{const window=BrowserWindow.getAllWindows()[0];window?.setContentSize(1600,1050);window?.show();window?.focus();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:fileName,exact:true}).dblclick()
  const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
  if(await editor.getAttribute('data-editor-mode')!=='deep')await editor.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
  await expect(editor).toHaveAttribute('data-editor-mode','deep');const documentId=await editor.getAttribute('data-document-id');if(!documentId)throw Error('Missing document identity')
  return{app,page,documentId}
 }catch(error){await close(app);throw error}
}
async function mode(page:Page,name:'编辑'|'试运行'){
 const button=page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true')
}
async function visibleFrame(page:Page,selector:string):Promise<Frame>{
 let found:Frame|undefined
 await expect.poll(async()=>{
  found=undefined
  for(const frame of page.frames()){
   if(frame.isDetached())continue
   if(frame!==page.mainFrame()){const host=await frame.frameElement().catch(()=>null);if(!host)continue;try{if(!await host.isVisible())continue}finally{await host.dispose()}}
   if(await frame.locator(selector).first().isVisible().catch(()=>false)){found=frame;break}
  }
  return Boolean(found)
 },{timeout:25_000,message:'The actual live Source consumer must be visible: '+selector}).toBe(true)
 return found!
}
async function pointerPoint(page:Page,target:Locator){
 await expect(target).toBeVisible();await target.scrollIntoViewIfNeeded();const element=await target.elementHandle();if(!element)throw Error('Missing actual pointer target')
 try{
  let point=await element.evaluate(node=>{const box=node.getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2}}),frame=await element.ownerFrame()
  while(frame&&frame!==page.mainFrame()){
   const host=await frame.frameElement()
   try{point=await host.evaluate((node,point)=>{const iframe=node as HTMLIFrameElement,box=iframe.getBoundingClientRect();if(!iframe.offsetWidth||!iframe.offsetHeight||!box.width||!box.height)throw Error('Empty iframe pointer geometry');return{x:box.x+(iframe.clientLeft+point.x)*box.width/iframe.offsetWidth,y:box.y+(iframe.clientTop+point.y)*box.height/iframe.offsetHeight}},point);frame=await host.ownerFrame()}
   finally{await host.dispose()}
  }
  if(frame!==page.mainFrame())throw Error('Detached Source pointer target');return point
 }finally{await element.dispose()}
}
async function clickReal(page:Page,target:Locator){const point=await pointerPoint(page,target);await page.mouse.click(point.x,point.y)}
async function dashboard(page:Page){
 await mode(page,'试运行');const entry=page.getByText(/进入运营沙盘\s*→/).first();if(await entry.isVisible().catch(()=>false))await clickReal(page,entry)
 await visibleFrame(page,chartSelector)
}
async function title(page:Page){return(await visibleFrame(page,chartSelector)).locator(titleSelector)}
async function chartView(page:Page){
 const frame=await visibleFrame(page,chartSelector)
 return frame.locator(chartSelector).evaluate(element=>({title:element.querySelector('[data-chart-text="title"]')?.textContent,fontSize:element.querySelector('[data-chart-text="title"]')?.getAttribute('font-size'),values:[...element.querySelectorAll('[data-chart-data-label]')].map(node=>node.textContent)}))
}
async function expectPresentation(page:Page,expectedTitle:string,fontSize:number){await expect.poll(()=>chartView(page)).toMatchObject({title:expectedTitle,fontSize:String(fontSize)})}
async function editTitle(page:Page){
 await mode(page,'编辑');let label=await title(page);await expect(label).toHaveText(originalTitle)
 // Explicit deep selection is a real user gesture, including when the chart is in an ordinary group.
 let point=await pointerPoint(page,label);await page.keyboard.down('Control');try{await page.mouse.click(point.x,point.y)}finally{await page.keyboard.up('Control')}
 label=await title(page);point=await pointerPoint(page,label);await page.mouse.dblclick(point.x,point.y)
 const input=page.getByTestId('canvas-plain-text-editor').getByRole('textbox',{name:'编辑此处文字',exact:true})
 await expect(input).toBeVisible();await expect(input).toHaveAttribute('contenteditable','true');await expect(input).toHaveText(originalTitle)
 await input.click();await page.keyboard.press('Control+a');await page.keyboard.insertText(changedTitle);await expect(input).toHaveText(changedTitle)
 await page.keyboard.press('Control+Enter');await expect(input).toHaveCount(0);await expect(await title(page)).toHaveText(changedTitle)
}
async function chartProperties(page:Page){
 const panel=page.getByTestId('properties-tab'),opener=page.getByRole('button',{name:'属性与素材',exact:true});if(!await panel.isVisible()&&await opener.isVisible())await opener.click()
 const tab=page.getByRole('tab',{name:'属性',exact:true});if(await tab.isVisible())await tab.click()
 const owner=panel.getByRole('button',{name:/^选择整体：/});if(await owner.isVisible())await owner.click()
 const chartPanel=panel.getByTestId('chart-properties');await expect(chartPanel).toBeVisible();return chartPanel
}
async function changeAttendees(page:Page,n?:number){
 const frame=await visibleFrame(page,'input[aria-label="预计到场人数"]'),input=frame.getByRole('spinbutton',{name:'预计到场人数',exact:true}),before=Number(await input.inputValue()),next=n??(before===1000?800:1000)
 const beforeChart=await chartView(page);await clickReal(page,input);await expect(input).toBeFocused();await page.keyboard.press('Control+a');await page.keyboard.insertText(String(next));await page.keyboard.press('Tab')
 await expect(input).toHaveValue(String(next));await expect(frame.getByRole('slider',{name:'人数滑杆',exact:true})).toHaveValue(String(next))
 await expect.poll(async()=>(await chartView(page)).values).not.toEqual(beforeChart.values)
 return{before,next,beforeChart,afterChart:await chartView(page)}
}
function assertAuthors(actual:CourseProjectV10,before:CourseProjectV10,expectedTitle:string,fontSize:number){
 const expected=structuredClone(before.instances);chart({...before,instances:expected}).title=expectedTitle;chart({...before,instances:expected}).style.fontSize=fontSize
 expect(actual.instances).toEqual(expected);expect(actual.definitions).toEqual(before.definitions);expect(actual.assets).toEqual(before.assets);expect(actual.rootIds).toEqual(before.rootIds);expect(actual.global).toEqual(before.global);expect(actual.entry).toEqual(before.entry)
}
function resources(model:Model){
 if(model.kind!=='course-v10')throw Error('Expected course resources')
 const files=(entries:Record<string,Uint8Array>)=>Object.fromEntries(Object.entries(entries).map(([name,bytes])=>[name,hash(bytes)]))
 return{assets:files(model.resources.assets),components:Object.fromEntries(Object.entries(model.resources.components).map(([owner,entries])=>[owner,files(entries)]))}
}

test('market Source chart keeps real author title and font edits through live results, history and a cold host',async()=>{
 test.skip(!process.env.GUOLING_MARKET_MANUAL_INPUT,'Set the existing D1 quality GLX path; this journey only edits an isolated copy.')
 test.setTimeout(240_000)
 const source=resolve(process.env.GUOLING_MARKET_MANUAL_INPUT!),sourceHash=hash(readFileSync(source)),originalModel=await new CourseV10Driver().load(readFileSync(source));if(originalModel.kind!=='course-v10')throw Error('Wrong fixture kind')
 mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,'manual-')),workspace=join(run,'workspace'),fileName='market-chart-manual.glx',file=join(workspace,fileName);mkdirSync(workspace);copyFileSync(source,file)
 const errors:string[]=[],facts:Record<string,unknown>={source,sourceHash,file,chartId,paidCalls:0,input:'Trusted mouse and keyboard; formal document APIs are read-only observations.'}
 let current=await launch(join(run,'profile'),workspace,fileName,errors)
 try{
  const{page,documentId}=current;const baseline=await read(page,documentId),oldFont=chart(baseline.model.project).style.fontSize;expect(chart(baseline.model.project).title).toBe(originalTitle);expect(oldFont).not.toBe(changedFont)
  await dashboard(page);await expectPresentation(page,originalTitle,oldFont);await mode(page,'编辑');const started=Date.now()
  await editTitle(page);await expect.poll(async()=>chart((await read(page,documentId)).model.project).title).toBe(changedTitle)
  const titleEdited=await read(page,documentId);expect(titleEdited.undoDepth-baseline.undoDepth).toBe(1);assertAuthors(titleEdited.model.project,baseline.model.project,changedTitle,oldFont)
  const panel=await chartProperties(page),font=panel.getByLabel('字号',{exact:true});await expect(font).toHaveValue(String(oldFont));await font.fill(String(changedFont));await font.press('Enter');await font.blur()
  await expect.poll(async()=>chart((await read(page,documentId)).model.project).style.fontSize).toBe(changedFont)
  const edited=await read(page,documentId);expect(edited.undoDepth-titleEdited.undoDepth).toBe(1);assertAuthors(edited.model.project,baseline.model.project,changedTitle,changedFont);await expectPresentation(page,changedTitle,changedFont)
  await page.screenshot({path:join(run,'01-title-font-edited.png')})
  await mode(page,'试运行');const scenario=await changeAttendees(page);await expectPresentation(page,changedTitle,changedFont)
  expect((await read(page,documentId)).model.project).toEqual(edited.model.project);await page.screenshot({path:join(run,'02-runtime-update-keeps-author-fields.png')});facts.scenario=scenario
  await mode(page,'编辑');await expectPresentation(page,changedTitle,changedFont)
  await page.keyboard.press('Control+z');await expect.poll(async()=>chart((await read(page,documentId)).model.project).style.fontSize).toBe(oldFont);assertAuthors((await read(page,documentId)).model.project,baseline.model.project,changedTitle,oldFont);await expectPresentation(page,changedTitle,oldFont)
  await page.keyboard.press('Control+z');await expect.poll(async()=>chart((await read(page,documentId)).model.project).title).toBe(originalTitle);assertAuthors((await read(page,documentId)).model.project,baseline.model.project,originalTitle,oldFont);await expectPresentation(page,originalTitle,oldFont)
  await page.keyboard.press('Control+y');await expect.poll(async()=>chart((await read(page,documentId)).model.project).title).toBe(changedTitle)
  await page.keyboard.press('Control+y');await expect.poll(async()=>chart((await read(page,documentId)).model.project).style.fontSize).toBe(changedFont);assertAuthors((await read(page,documentId)).model.project,baseline.model.project,changedTitle,changedFont);await expectPresentation(page,changedTitle,changedFont)
  await page.keyboard.press('Control+s');await expect.poll(async()=>{const snapshot=await read(page,documentId);return{dirty:snapshot.dirty,saving:snapshot.saving}}).toEqual({dirty:false,saving:false})
  const saved=await read(page,documentId),disk=await new CourseV10Driver().load(readFileSync(file));if(disk.kind!=='course-v10')throw Error('Wrong saved model');expect(disk.project.instances).toEqual(saved.model.project.instances);expect(resources(disk)).toEqual(resources(originalModel))
  await close(current.app);current=await launch(join(run,'cold-profile'),workspace,fileName,errors)
  const cold=await read(current.page,current.documentId);expect(cold.model.project).toEqual(saved.model.project);assertAuthors(cold.model.project,baseline.model.project,changedTitle,changedFont)
  await dashboard(current.page);await expectPresentation(current.page,changedTitle,changedFont);const coldScenario=await changeAttendees(current.page,scenario.next);await expectPresentation(current.page,changedTitle,changedFont)
  expect((await read(current.page,current.documentId)).model.project).toEqual(saved.model.project);expect(coldScenario.afterChart.values).toEqual(scenario.afterChart.values);await current.page.screenshot({path:join(run,'03-cold-runtime-keeps-author-fields.png')})
  expect(hash(readFileSync(source))).toBe(sourceHash);expect(errors).toEqual([])
  Object.assign(facts,{status:'passed',elapsedMs:Date.now()-started,oldFont,newFont:changedFont,oldTitle:originalTitle,newTitle:changedTitle,editedRevision:edited.revision,savedRevision:saved.revision,coldRevision:cold.revision,coldScenario,errors,sourceUnchanged:true,sourceOverridesUnchanged:true,resourcesUnchanged:true,history:'one title edit + one font edit; actual Undo twice and Redo twice'})
  writeFileSync(join(run,'result.json'),JSON.stringify(facts,null,2));writeFileSync(join(out,'latest-manual.json'),JSON.stringify(facts,null,2))
 }catch(error){await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});Object.assign(facts,{status:'failed',error:String(error),errors,ui:await current.page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,1500),editors:[...document.querySelectorAll('[data-component-professional-editor],[data-testid="canvas-plain-text-editor"]')].map(node=>node.outerHTML.slice(0,4000)),spots:[...document.querySelectorAll('[data-author-spot]')].map(node=>({id:node.getAttribute('data-author-spot'),label:node.getAttribute('aria-label'),rect:node.getBoundingClientRect().toJSON()}))})).catch(()=>null)});writeFileSync(join(run,'failure.json'),JSON.stringify(facts,null,2));throw error}
 finally{await close(current.app)}
})
