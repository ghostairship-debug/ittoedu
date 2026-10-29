// @vitest-environment node
import {build} from 'esbuild'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'
import {expect,it} from 'vitest'
import {DocumentHostService} from '../../src/main/workbench/DocumentHostService'
import {CourseV10Driver} from '../../src/core/drivers/CourseV10Driver'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {TEXT_DEFINITION} from '../../src/components/text/adapters'
import {createTextComponentData} from '../../src/components/text/data'
import {IMAGE_DEFINITION,createImageData} from '../../src/components/image'
import {POPOVER_DEFINITION,createPopoverData} from '../../src/components/popover'
import type {DocumentEvent} from '../../src/shared/workbench/document'
import {setRootContainers} from '../helpers/glxWorkFixture'
const json=(value:unknown)=>JSON.parse(JSON.stringify(value,(_key,item)=>item instanceof Uint8Array?[...item]:item))
it('real Flow object drag previews wrapping, commits once, resizes manually, follows preceding text, cancels and survives save/reopen',async()=>{
 const directory=resolve('output/creation-editing-completion-20261029/flow-browser');await mkdir(directory,{recursive:true})
 const project=createBlankCourseProjectV10('绕排手调'),surfaceId='flow'
 project.definitions[TEXT_DEFINITION.id]=TEXT_DEFINITION;project.definitions[IMAGE_DEFINITION.id]=IMAGE_DEFINITION;project.definitions[POPOVER_DEFINITION.id]=POPOVER_DEFINITION
 for(const [id,text] of [['intro','正文开头。'],['para','这是环绕组件的正文，图片和互动组件应当直接拖动，并让文字按照真实阅读宽度重新排版。'.repeat(12)],['tail','下一段仍然按照正文顺序排列，不应被浮层挡住。'.repeat(8)]])project.instances[id]={id,definitionId:TEXT_DEFINITION.id,data:json(createTextComponentData(text))}
 const picture=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#93c5fd"/><circle cx="120" cy="60" r="38" fill="#1d4ed8"/></svg>')
 project.assets.image={id:'image',path:'assets/image.svg',mimeType:'image/svg+xml',kind:'image',width:240,height:120,byteLength:picture.length}
 project.instances.image={id:'image',definitionId:IMAGE_DEFINITION.id,data:json(createImageData('image')),frame:{width:240,height:120,transform:[1,0,0,1,0,0]},flowLayout:{width:'content-width',widthPercent:35}}
 project.instances.widget={id:'widget',definitionId:POPOVER_DEFINITION.id,data:json({...createPopoverData(),label:'互动说明'}),frame:{width:240,height:110,transform:[1,0,0,1,0,0]},flowLayout:{width:'content-width',widthPercent:40}}
 setRootContainers(project,[{id:surfaceId,kind:'flow',title:'绕排',childIds:['intro','image','para','widget','tail'],flow:{layout:{widthMode:'reading',readingWidth:800,wideContentWidth:1000,toc:'hidden'}}}])
 const host=new DocumentHostService(join(directory,'recovery-'+Date.now())),initial=await host.internalAPI.create({kind:'course-v10',project,resources:{assets:{image:picture},components:{}}},'flow.glx')
 const typingTrace:{at:number;revision:number;undoDepth:number;intro:string}[]=[]
 const events:DocumentEvent[]=[],off=host.subscribeEvents(event=>{events.push(event);const s=(event as any).snapshot;if(s?.model?.kind==='course-v10'){const content=s.model.project.instances.intro?.data?.content;typingTrace.push({at:Date.now(),revision:s.revision,undoDepth:s.undoDepth,intro:content?.inlines?.map((item:any)=>item.type==='text'?item.text??'':'').join('')??''})}}),errors:string[]=[]
 const bundle=await build({stdin:{contents:'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness"',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'FlowEditing',write:false,outfile:join(directory,'editor.js'),loader:{'.css':'css','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl'},logLevel:'silent'})
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1200,height:960}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().startsWith('FLOW_DEBUG'))console.log(message.text())})
 const snapshot=async()=>{const s=await host.internalAPI.read(initial.documentId);if(s.model.kind!=='course-v10')throw Error('wrong document');return {...s,model:s.model}}
 const block=(id:string)=>page.locator('.ProseMirror [data-flow-block-id="'+id+'"]')
 try{
  await page.route('http://localhost/flow-completion',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body,#editor{width:100%;height:100%;margin:0}#editor{position:relative}</style><div id="editor"></div>'}));await page.goto('http://localhost/flow-completion')
  await page.exposeFunction('flowDocumentCall',async(name:string,args:unknown[])=>{const result=name==='bootstrapCourse'?await host.internalAPI.read(initial.documentId):['readAuthoringDrafts','writeAuthoringDrafts','clearAuthoringDrafts'].includes(name)?await (host as any)[name](...args):await(host.internalAPI as any)[name](...args);return json({result,events:events.splice(0)})})
  for(const file of bundle.outputFiles.filter(f=>f.path.endsWith('.css')))await page.addStyleTag({content:file.text})
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text})
  await page.evaluate(async()=>{
   const listeners=new Set<(event:any)=>void>(),hydrate=(s:any)=>{if(s?.model?.resources)for(const[id,bytes]of Object.entries(s.model.resources.assets))s.model.resources.assets[id]=Uint8Array.from(bytes as number[]);return s}
   const names=['list','read','dispatch','lookup','restore','save','bootstrapCourse','readAuthoringDrafts','writeAuthoringDrafts','clearAuthoringDrafts']
   const api={...Object.fromEntries(names.map(name=>[name,async(...args:any[])=>{const p=await(window as any).flowDocumentCall(name,args);p.events.forEach((event:any)=>{if(event.snapshot)hydrate(event.snapshot);listeners.forEach(l=>l(event))});return Array.isArray(p.result)?p.result.map(hydrate):hydrate(p.result)}])),subscribe:(l:(e:any)=>void)=>{listeners.add(l);return()=>listeners.delete(l)}}
   ;(window as any).flowHarness=await(window as any).FlowEditing.mountCurrentCourseBrowserHarness(document.getElementById('editor'),api)
  })
  await block('image').locator('img').waitFor();await block('para').waitFor()
  const original=await snapshot(),pictureBox=await block('image').boundingBox(),paragraph=await block('para').boundingBox();if(!pictureBox||!paragraph)throw Error('missing visible body')
  await page.mouse.move(pictureBox.x+pictureBox.width/2,pictureBox.y+30);await page.mouse.down();await page.mouse.move(paragraph.x+35,paragraph.y+60,{steps:6})
  await expect.poll(()=>page.locator('[data-flow-layout-preview]').count()).toBe(1)
  expect((await snapshot()).revision).toBe(original.revision)
  const preview=await page.locator('[data-flow-layout-preview]').evaluate(e=>({float:getComputedStyle(e).cssFloat,width:e.getBoundingClientRect().width}))
  expect(preview.float).toBe('left');await page.screenshot({path:join(directory,'wrap-preview.png')});await page.mouse.up()
  await expect.poll(async()=>(await snapshot()).model.project.instances.image.flowLayout?.wrap).toBe('left')
  const afterDrop=await snapshot();expect(afterDrop.undoDepth-original.undoDepth).toBe(1);expect(afterDrop.model.project.instances.image.data).toEqual(original.model.project.instances.image.data)
  // Wrapped text must leave the visible image reachable through an ordinary pointer click.
  // Native text's identity flip transform used to put its transparent full-width box above the image.
  await block('image').locator('img').click()
  const handle=block('image').getByRole('button',{name:'拖动调整正文占宽'});await expect.poll(()=>handle.isVisible()).toBe(true)
  const hb=await handle.boundingBox();if(!hb)throw Error('missing width handle')
  await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+hb.width/2+60,hb.y+hb.height/2,{steps:6})
  expect((await snapshot()).revision).toBe(afterDrop.revision)
  const resizing=await block('image').boundingBox();expect(resizing!.width).toBeGreaterThan(preview.width+45)
  await page.mouse.up();await expect.poll(async()=>(await snapshot()).model.project.instances.image.flowLayout?.widthPercent??0).toBeGreaterThan(35)
  const afterResize=await snapshot();expect(afterResize.undoDepth-afterDrop.undoDepth).toBe(1)
  // A cancelled real pointer gesture leaves the persisted object and history untouched.
  const currentHandle=await handle.boundingBox();await page.mouse.move(currentHandle!.x+5,currentHandle!.y+10);await page.mouse.down();await page.mouse.move(currentHandle!.x+40,currentHandle!.y+10,{steps:3});await page.keyboard.press('Escape');await page.mouse.up()
  expect((await snapshot()).model.project.instances.image).toEqual(afterResize.model.project.instances.image)
  const beforeTop=(await block('image').boundingBox())!.y
  await block('intro').dblclick();await page.keyboard.press('End');const beforeTyping=await snapshot(),typed=' More preceding content. '.repeat(10),typingStarted=Date.now();await page.keyboard.type(typed);await page.keyboard.press('Escape')
  await expect.poll(async()=>{const data=(await snapshot()).model.project.instances.intro.data as any;return data.content.inlines.map((item:any)=>item.type==='text'?item.text??'':'').join('')}).toBe('正文开头。'+typed)
  const afterTyping=await snapshot(),typingElapsedMs=Date.now()-typingStarted,typingCommits=afterTyping.revision-beforeTyping.revision;console.log('COALESCED_TYPING_COMMITS',typingCommits)
  await writeFile(join(directory,'typing-commits.json'),JSON.stringify({started:typingStarted,elapsedMs:typingElapsedMs,typedCharacters:typed.length,typingCommits,undoDepthDelta:afterTyping.undoDepth-beforeTyping.undoDepth,finalIntro:afterTyping.model.project.instances.intro.data,commits:typingTrace.filter(item=>item.revision>beforeTyping.revision)},null,2))
  // Input duration changes with machine load. Bound publication cadence, not a fixed
  // total for Playwright's per-key round trips; allow the final completion flush.
  expect(typingCommits).toBeLessThanOrEqual(Math.ceil(typingElapsedMs/50)+1)
  expect(afterTyping.undoDepth-beforeTyping.undoDepth).toBe(1)
  await expect.poll(async()=>(await block('image').boundingBox())!.y).toBeGreaterThan(beforeTop)
  // This isolated Flow harness does not mount the Workbench shortcut dispatcher.
  // Enter the real native text editor so its PM history keymap owns these keys.
  await block('intro').dblclick()
  await expect.poll(()=>block('intro').evaluate(element=>{const owner=element.closest('.ProseMirror');return [owner?.getAttribute('data-flow-input-active'),owner?.getAttribute('contenteditable')]})).toEqual(['true','true'])
  await page.keyboard.press('Control+z');await expect.poll(async()=>(await snapshot()).model.project.instances.intro).toEqual(beforeTyping.model.project.instances.intro)
  await page.keyboard.press('Control+y');await expect.poll(async()=>(await snapshot()).model.project.instances.intro).toEqual(afterTyping.model.project.instances.intro)
  await page.keyboard.press('Escape')
  await block('widget').scrollIntoViewIfNeeded();await block('tail').scrollIntoViewIfNeeded()
  const widget=await block('widget').boundingBox(),tail=await block('tail').boundingBox();if(!widget||!tail)throw Error('missing component')
  console.log('WIDGET_DRAG',widget,tail);await page.evaluate(()=>{(window as any).flowPointerTrace=[];for(const kind of ['pointerdown','pointermove','pointerup'])document.addEventListener(kind,event=>{const p=event as PointerEvent;if(kind==='pointermove'&&!p.buttons)return;const e=event.target as HTMLElement;(window as any).flowPointerTrace.push({kind,target:e?.outerHTML?.slice(0,220),path:event.composedPath().slice(0,7).map((n:any)=>n.tagName+':'+(n.dataset?.componentInstance??n.dataset?.flowBlockId??n.className??''))})},true)})
  const button=block('widget').getByRole('button',{name:'互动说明',exact:true}),buttonRect=await button.boundingBox();if(!buttonRect)throw Error('missing interactive component button')
  await page.mouse.move(buttonRect.x+buttonRect.width/2,buttonRect.y+buttonRect.height/2);await page.mouse.down();await page.mouse.move(tail.x+tail.width-25,tail.y+45,{steps:6});
  await expect.poll(()=>page.locator('[data-flow-layout-preview]').count()).toBe(1);await page.mouse.up()
  await expect.poll(async()=>(await snapshot()).model.project.instances.widget.flowLayout?.wrap).toBe('right')
  const final=await snapshot();expect(final.model.project.instances.widget.data).toEqual(original.model.project.instances.widget.data)
  await page.setViewportSize({width:390,height:900});await expect.poll(()=>block('image').evaluate(e=>getComputedStyle(e).cssFloat)).toBe('none')
  await page.setViewportSize({width:1200,height:960});await expect.poll(()=>block('image').evaluate(e=>getComputedStyle(e).cssFloat)).toBe('left')
  const savePath=join(directory,'saved-'+Date.now()+'.glx');await host.internalAPI.save(initial.documentId,savePath);const reopened=new CourseV10Driver().load(await readFile(savePath));expect(reopened).toMatchObject({project:{instances:final.model.project.instances}})
  expect(errors).toEqual([]);expect(await page.evaluate(()=>(window as any).flowHarness.errors)).toEqual([])
  await page.screenshot({path:join(directory,'flow-final.png')});await writeFile(join(directory,'result.json'),JSON.stringify({status:'passed',previewNoWrite:true,oneDropHistory:true,oneResizeHistory:true,savedRevision:final.revision,errors},null,2))
 }catch(error){await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{});await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error),errors,harness:await page.evaluate(()=>(window as any).flowHarness?.errors).catch(()=>[]),pointerTrace:await page.evaluate(()=>(window as any).flowPointerTrace).catch(()=>[])},null,2));throw error}
 finally{await page.evaluate(()=>(window as any).flowHarness?.dispose()).catch(()=>{});off();await browser.close()}
},90_000)
