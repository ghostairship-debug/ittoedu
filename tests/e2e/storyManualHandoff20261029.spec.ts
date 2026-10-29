import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const root=resolve(__dirname,'../..'),out=resolve(root,'output/creation-editing-completion-20261029/resume-story-ui')
const titleId='0fe5beca-0f75-4e65-9f9c-3a1ad72b182d',eveningId='9096bdc3-2818-458b-a5e4-0b41fba9002b',imageId='7b53f056-8478-4299-955f-b6666c6da72e',noonId='e7dc79ff-aa59-4e50-aa47-7862acd846f3'
const oldTitle='旧站的一天',newTitle='旧站的一天 · 社区试运行版',oldNoon='12:00 候车厅档案',newNoon='12:00 记忆候车厅'
const oldEvening='傍晚摊位可以撤收。',newEvening='傍晚摊位在闭市后统一撤收。'
const replacementPath=resolve(root,'output/audit-remediation-20261027/benchmark/assets/platform-alt.png')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const text=(project:CourseProjectV10,id:string)=>{
 const data=project.instances[id]?.data as {content?:{inlines?:{type:string;text?:string}[]}}|undefined
 return data?.content?.inlines?.map(i=>i.type==='text'?i.text??'':'').join('')??''
}
async function close(app:ElectronApplication){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}
async function launch(profile:string,workspace:string,fileName:string){
 mkdirSync(profile,{recursive:true})
 const app=await electron.launch({cwd:root,args:['.','--user-data-dir='+profile],env:{...process.env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}})
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(12_000)
  await app.evaluate(({BrowserWindow,dialog},directory)=>{const window=BrowserWindow.getAllWindows()[0];window?.setContentSize(1600,1050);window?.show();window?.focus();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:fileName,exact:true}).dblclick()
  const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
  if(await editor.getAttribute('data-editor-mode')!=='deep')await editor.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
  await expect(editor).toHaveAttribute('data-editor-mode','deep');await expect(page.getByTestId('flow-workspace')).toBeVisible()
  const documentId=await editor.getAttribute('data-document-id');if(!documentId)throw Error('Missing document identity')
  await page.evaluate(()=>document.fonts.ready)
  return{app,page,documentId}
 }catch(error){await close(app);throw error}
}
async function snapshot(page:Page,id:string){const s=await page.evaluate(id=>window.desktopAPI.documents!.read(id),id);if(s.model.kind!=='course-v10')throw Error('Wrong document kind');return{...s,model:s.model}}
const block=(page:Page,id:string)=>page.locator('.course-editor-frame:visible .ProseMirror [data-flow-block-id="'+id+'"]').first()
async function properties(page:Page){
 const panel=page.getByTestId('properties-tab'),opener=page.getByRole('button',{name:'属性与素材',exact:true})
 if(!await panel.isVisible()&&await opener.isVisible())await opener.click()
 const tab=page.getByRole('tab',{name:'属性',exact:true});if(await tab.isVisible())await tab.click()
 await expect(panel).toBeVisible();return panel
}
async function replaceFlowText(page:Page,id:string,before:string,after:string,run:string){
 const heading=block(page,id);await expect(heading).toHaveText(before);await heading.scrollIntoViewIfNeeded()
 // Resolve the first real glyph, then use native pointer/keyboard selection and insertion.
 const firstGlyph=()=>heading.evaluate(element=>{
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT)
  for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent?.trim()){
   const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const rect=range.getClientRects()[0];if(rect?.width)return{x:rect.left+1,y:rect.top+rect.height/2}
  }
  throw Error('Flow text has no visible glyph')
 })
 let point=await firstGlyph()
 const diagnose=async(phase:string)=>{const observed=await heading.evaluate((element,{point,phase})=>{
  const doc=element.ownerDocument,selection=doc.getSelection(),describe=(node:Node|null)=>node?{type:node.nodeType,name:node.nodeName,text:node.textContent?.slice(0,120),html:node instanceof Element?node.outerHTML.slice(0,3500):null}:null
  const ancestors=[];for(let parent:HTMLElement|null=element as HTMLElement;parent&&ancestors.length<8;parent=parent.parentElement)ancestors.push({tag:parent.tagName,classes:parent.className,contenteditable:parent.getAttribute('contenteditable'),isContentEditable:parent.isContentEditable,tabindex:parent.getAttribute('tabindex')})
  return{phase,point,activeElement:describe(doc.activeElement),heading:element.outerHTML,ancestors,selection:{text:selection?.toString(),rangeCount:selection?.rangeCount,anchor:describe(selection?.anchorNode??null),anchorOffset:selection?.anchorOffset,focus:describe(selection?.focusNode??null),focusOffset:selection?.focusOffset},hitStack:doc.elementsFromPoint(point.x,point.y).slice(0,12).map(e=>({tag:e.tagName,classes:e.className,html:e.outerHTML.slice(0,800),pointerEvents:getComputedStyle(e).pointerEvents}))}
 },{point,phase});writeFileSync(join(run,'flow-input-'+id+'-'+phase+'.json'),JSON.stringify(observed,null,2))}
 await diagnose('before-click');await page.mouse.dblclick(point.x,point.y);await diagnose('after-activate')
 const inputOwner=page.locator('.course-editor-frame:visible .ProseMirror').first();await expect(inputOwner).toHaveAttribute('data-flow-input-active','true');await expect(inputOwner).toHaveAttribute('contenteditable','true')
 point=await firstGlyph();await page.mouse.click(point.x,point.y);await diagnose('after-click');await page.keyboard.press('Home')
 await page.keyboard.down('Shift');for(const _ of Array.from(before))await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift')
 await diagnose('after-selection');expect(await page.evaluate(()=>document.getSelection()?.toString())).toBe(before)
 await page.keyboard.insertText(after);await page.keyboard.press('Escape');await expect(heading).toHaveText(after)
}
async function diagnoseStoryImage(page:Page,run:string,phase:string){
 const observed=await page.evaluate(({imageId,paragraphId,phase})=>{
  const picture=document.querySelector<HTMLElement>('.ProseMirror [data-flow-block-id="'+imageId+'"]'),paragraph=document.querySelector<HTMLElement>('.ProseMirror [data-flow-block-id="'+paragraphId+'"]'),img=picture?.querySelector<HTMLImageElement>('img')
  const styleKeys=['display','position','cssFloat','clear','zIndex','pointerEvents','width','height','overflow','overflowX','overflowY','transform','boxSizing','margin','padding','contain','visibility','opacity','whiteSpace','lineHeight','fontSize','objectFit','clipPath','isolation'] as const
  const info=(element:Element|null,htmlLimit=3000)=>{if(!element)return null;const css=getComputedStyle(element),clone=element.cloneNode(true) as Element;for(const media of[clone,...clone.querySelectorAll('[src]')]){const src=media.getAttribute('src');if(src&&src.length>180)media.setAttribute('src',src.slice(0,90)+'…('+src.length+')')}return{tag:element.tagName,classes:element.className,rect:element.getBoundingClientRect().toJSON(),style:Object.fromEntries(styleKeys.map(key=>[key,css[key]])),contenteditable:element.getAttribute('contenteditable'),...(htmlLimit?{html:clone.outerHTML.slice(0,htmlLimit)}:{})}}
  const ancestors=(element:Element|null)=>{const result=[];for(let current=element;current&&result.length<8;current=current.parentElement)result.push(info(current,0));return result}
  const points=(element:Element|null,prefix:string)=>{if(!element)return[];const r=element.getBoundingClientRect(),ix=Math.min(4,r.width/4),iy=Math.min(4,r.height/4);return[{name:prefix+' center',x:r.x+r.width/2,y:r.y+r.height/2},{name:prefix+' tl',x:r.left+ix,y:r.top+iy},{name:prefix+' tr',x:r.right-ix,y:r.top+iy},{name:prefix+' bl',x:r.left+ix,y:r.bottom-iy},{name:prefix+' br',x:r.right-ix,y:r.bottom-iy}]}
  const hitPoints=[...points(img??null,'img'),...points(picture??null,'block')].map(point=>({...point,stack:document.elementsFromPoint(point.x,point.y).slice(0,5).map(e=>({tag:e.tagName,classes:e.className,id:e.closest('[data-flow-block-id]')?.getAttribute('data-flow-block-id'),html:e.outerHTML.slice(0,250)}))}))
  const ranges=[];if(paragraph){const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){if(!node.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(node);ranges.push({text:node.textContent,rects:[...range.getClientRects()].map(r=>r.toJSON()),parent:info(node.parentElement,0)})}}
  const pm=picture?.closest('.ProseMirror');return{phase,picture:info(picture??null),image:info(img??null),imageNatural:img?{width:img.naturalWidth,height:img.naturalHeight,complete:img.complete}:null,paragraph:info(paragraph??null),pictureAncestors:ancestors(picture??null),paragraphAncestors:ancestors(paragraph??null),hitPoints,ranges,pm:pm?{contenteditable:pm.getAttribute('contenteditable'),inputActive:pm.getAttribute('data-flow-input-active')}:null,activeElement:info(document.activeElement),selection:document.getSelection()?.toString()}
 },{imageId,paragraphId:'56672960-224b-45d8-8d0b-03ac98f7efa5',phase})
 writeFileSync(join(run,'image-input-'+phase+'.json'),JSON.stringify(observed))
}
function assertManual(project:CourseProjectV10,baseline:CourseProjectV10){
 expect(text(project,titleId)).toBe(newTitle);expect(text(project,eveningId)).toBe(text(baseline,eveningId).replace(oldEvening,newEvening));expect(text(project,noonId)).toBe(oldNoon)
 expect(project.instances[imageId].flowLayout).toMatchObject({widthPercent:48,wrap:'right'})
 const image=project.instances[imageId].data as any;expect(image.assetId).not.toBe((baseline.instances[imageId].data as any).assetId);expect(image.fit).toBe('cover');expect(image.crop.left).toBeGreaterThan(0)
 const changed=new Set([titleId,eveningId,imageId]);for(const[id,value]of Object.entries(baseline.instances))if(!changed.has(id))expect(project.instances[id],id).toEqual(value)
 expect(Object.keys(project.instances)).toEqual(Object.keys(baseline.instances));expect(project.definitions).toEqual(baseline.definitions)
 for(const id of[titleId,eveningId]){const{content:_before,...originalData}=baseline.instances[id].data as Record<string,unknown>,{content:_after,...currentData}=project.instances[id].data as Record<string,unknown>;expect(currentData,id).toEqual(originalData)}
 expect((project.instances[titleId].data as any).content.inlines[0].style).toEqual((baseline.instances[titleId].data as any).content.inlines[0].style)
}

test('story manual handoff preserves real text, image crop, width, history and independent cold reopen',async()=>{
 test.skip(!process.env.GUOLING_STORY_INPUT,'Set the existing S1 GLX fixture path; no product fixture is invented by this test.')
 test.setTimeout(180_000)
 const source=resolve(process.env.GUOLING_STORY_INPUT!),sourceHash=hash(readFileSync(source)),sourceModel=await new CourseV10Driver().load(readFileSync(source));if(sourceModel.kind!=='course-v10')throw Error('Wrong source model');mkdirSync(out,{recursive:true})
 const run=mkdtempSync(join(out,'manual-')),workspace=join(run,'workspace'),fileName='story-manual.glx',projectPath=join(workspace,fileName);mkdirSync(workspace);copyFileSync(source,projectPath)
 let current=await launch(join(run,'profile'),workspace,fileName);const errors:string[]=[]
 try{
  const{page,documentId}=current;page.on('pageerror',error=>errors.push(error.message));const before=await snapshot(page,documentId),started=Date.now()
  await replaceFlowText(page,titleId,oldTitle,newTitle,run);await expect.poll(async()=>text((await snapshot(page,documentId)).model.project,titleId)).toBe(newTitle)
  const eveningBefore=text(before.model.project,eveningId),eveningAfter=eveningBefore.replace(oldEvening,newEvening)
  await replaceFlowText(page,eveningId,eveningBefore,eveningAfter,run)
  await expect.poll(async()=>text((await snapshot(page,documentId)).model.project,eveningId)).toBe(text(before.model.project,eveningId).replace(oldEvening,newEvening))
  const picture=block(page,imageId);await picture.scrollIntoViewIfNeeded();await diagnoseStoryImage(page,run,'before-click');try{await picture.locator('img').click()}catch(error){await diagnoseStoryImage(page,run,'blocked');throw error}const panel=await properties(page)
  await current.app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},replacementPath)
  await panel.getByRole('button',{name:'替换图片',exact:true}).click()
  await expect.poll(async()=>((await snapshot(page,documentId)).model.project.instances[imageId].data as any).assetId).not.toBe((before.model.project.instances[imageId].data as any).assetId)
  await panel.getByLabel('显示方式',{exact:true}).selectOption('cover')
  const crop=panel.getByRole('slider',{name:'左裁剪',exact:true});await expect(crop).toBeVisible();await crop.focus();await crop.press('Home');for(let i=0;i<8;i++)await crop.press('ArrowRight');await crop.blur()
  await expect.poll(async()=>((await snapshot(page,documentId)).model.project.instances[imageId].data as any).crop.left).toBeGreaterThan(0)
  const beforeWidth=await snapshot(page,documentId),width=panel.getByLabel('正文占宽（%）',{exact:true});await expect(width).toHaveValue('42');await width.fill('48');await width.press('Enter');await width.blur()
  await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[imageId].flowLayout?.widthPercent).toBe(48)
  const resized=await snapshot(page,documentId);expect(resized.undoDepth-beforeWidth.undoDepth).toBe(1)
  await picture.click();await page.keyboard.press('Control+z');await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[imageId]).toEqual(beforeWidth.model.project.instances[imageId])
  await page.keyboard.press('Control+y');await expect.poll(async()=>(await snapshot(page,documentId)).model.project.instances[imageId]).toEqual(resized.model.project.instances[imageId])
  const edited=await snapshot(page,documentId);assertManual(edited.model.project,before.model.project);await page.screenshot({path:join(run,'manual-edited.png')})
  await page.keyboard.press('Control+s');await expect.poll(async()=>(await snapshot(page,documentId)).dirty).toBe(false)
  const saved=await snapshot(page,documentId),driver=new CourseV10Driver(),disk=await driver.load(readFileSync(projectPath));if(disk.kind!=='course-v10')throw Error('Wrong saved model')
  const assetId=(disk.project.instances[imageId].data as any).assetId;expect(Buffer.from(disk.resources.assets[assetId])).toEqual(readFileSync(replacementPath))
  for(const[id,bytes]of Object.entries(sourceModel.resources.assets))expect(disk.resources.assets[id]).toEqual(bytes)
  await close(current.app);current=await launch(join(run,'cold-profile'),workspace,fileName)
  const cold=await snapshot(current.page,current.documentId);expect(cold.model.project.instances).toEqual(saved.model.project.instances);assertManual(cold.model.project,before.model.project)
  await expect(block(current.page,titleId)).toHaveText(newTitle);await current.page.screenshot({path:join(run,'manual-cold-open.png')});expect(hash(readFileSync(source))).toBe(sourceHash)
  const baselinePath=join(run,'manual-baseline.json');writeFileSync(baselinePath,JSON.stringify({project:saved.model.project,resourceHashes:Object.fromEntries(Object.entries(disk.resources.assets).map(([id,bytes])=>[id,hash(bytes)]))},null,2))
  const result={status:'passed',source,sourceHash,projectPath,baselinePath,elapsedMs:Date.now()-started,savedRevision:saved.revision,coldRevision:cold.revision,newAssetId:assetId,imageCrop:(disk.project.instances[imageId].data as any).crop,widthPercent:48,errors,scope:'Real UI title/body text, replace image/crop/width, Undo/Redo/save and independent cold open; AI T3 has not yet run',aiFollowup:{targetInstanceId:noonId,before:oldNoon,after:newNoon}}
  writeFileSync(join(run,'result.json'),JSON.stringify(result,null,2));writeFileSync(join(out,'latest-manual.json'),JSON.stringify(result,null,2));expect(errors).toEqual([])
 }catch(error){await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});writeFileSync(join(run,'failure.json'),JSON.stringify({error:String(error),errors},null,2));throw error}
 finally{await close(current.app)}
})

async function visibleNavigationButton(page:Page,preview:Locator,name:string):Promise<Locator|null>{
 const accessibleName=new RegExp('(?:^|：)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')
 const own=preview.getByRole('button',{name:accessibleName});for(let i=0;i<await own.count();i++)if(await own.nth(i).isVisible())return own.nth(i)
 for(const frame of page.frames()){
  if(frame===page.mainFrame())continue
  const element=await frame.frameElement().catch(()=>null);if(!element||!await element.isVisible())continue
  if(!await element.evaluate(el=>el instanceof Element&&Boolean(el.closest('[data-testid="course-preview-host"]'))))continue
  const candidate=frame.getByRole('button',{name:accessibleName});for(let i=0;i<await candidate.count();i++)if(await candidate.nth(i).isVisible())return candidate.nth(i)
 }
 return null
}

test('story after AI exact heading edit keeps the manual handoff and updates real navigation',async()=>{
 test.skip(!process.env.GUOLING_STORY_AFTER_AI||!process.env.GUOLING_STORY_MANUAL_BASELINE,'Run after the main Agent has performed the actual MCP T3 edit.')
 test.setTimeout(120_000)
 const source=resolve(process.env.GUOLING_STORY_AFTER_AI!),baseline=JSON.parse(readFileSync(process.env.GUOLING_STORY_MANUAL_BASELINE!,'utf8')) as {project:CourseProjectV10;resourceHashes:Record<string,string>}
 mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,'after-ai-')),workspace=join(run,'workspace'),fileName=basename(source);mkdirSync(workspace);copyFileSync(source,join(workspace,fileName))
 const current=await launch(join(run,'profile'),workspace,fileName),errors:string[]=[]
 try{
  const{page,documentId}=current;page.on('pageerror',e=>errors.push(e.message));const after=await snapshot(page,documentId),expected=structuredClone(baseline.project.instances)
  const data=expected[noonId].data as {content:{inlines:{type:string;text?:string}[]}};expect(data.content.inlines).toHaveLength(1);data.content.inlines[0].text=newNoon
  expect(after.model.project.instances).toEqual(expected);expect(after.model.project.definitions).toEqual(baseline.project.definitions);expect(after.model.project.assets).toEqual(baseline.project.assets)
  const disk=await new CourseV10Driver().load(readFileSync(source));if(disk.kind!=='course-v10')throw Error('Wrong T3 model')
  expect(Object.fromEntries(Object.entries(disk.resources.assets).map(([id,bytes])=>[id,hash(bytes)]))).toEqual(baseline.resourceHashes)
  await expect(block(page,noonId)).toHaveText(newNoon)
  const editor=page.locator('.course-editor-frame:visible');await editor.locator('.course-light-tools').getByRole('button',{name:'整课预览',exact:true}).click()
  const preview=page.getByTestId('course-preview-host'),overlay=page.getByTestId('course-preview-overlay');await expect(overlay).toBeVisible()
  // The product gives author navigation a two-second mount grace; the host directory starts collapsed.
  await page.waitForTimeout(2100)
  const directoryToggle=preview.getByTestId('flow-runtime-toc-toggle');await expect(directoryToggle).toBeVisible()
  if(await directoryToggle.getAttribute('aria-expanded')!=='true')await directoryToggle.click()
  await expect.poll(async()=>Boolean(await visibleNavigationButton(page,preview,newNoon))).toBe(true)
  expect(await visibleNavigationButton(page,preview,oldNoon)).toBeNull()
  const button=await visibleNavigationButton(page,preview,newNoon);await button!.click()
  await expect(preview.locator('[data-component-object="'+noonId+'"],[data-component-instance="'+noonId+'"],[data-flow-block-id="'+noonId+'"]').first()).toBeInViewport({ratio:.5})
  await page.screenshot({path:join(run,'after-ai-navigation.png')});expect(errors).toEqual([])
  writeFileSync(join(run,'result.json'),JSON.stringify({status:'passed',source,manualStatePreserved:true,exactHeadingOnly:true,resourceBytesPreserved:true,realNavigationUpdated:true,coldRevision:after.revision,errors},null,2))
 }catch(error){await current.page.screenshot({path:join(run,'failure.png')}).catch(()=>{});writeFileSync(join(run,'failure.json'),JSON.stringify({error:String(error),errors},null,2));throw error}
 finally{await close(current.app)}
})
