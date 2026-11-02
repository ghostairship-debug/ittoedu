// @vitest-environment node
import {build} from 'esbuild'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
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
it('D5 bounded central wrap: product renderer candidate and explicit failure evidence',async()=>{
 const base=resolve('output/goal-correction-20261102/flow-central-sample');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'run-'))
 const started = Date.now(), facts: Record<string, unknown> = { started: new Date(started).toISOString(), checks: {}, limitations: ['Browser-rendered product editor harness; synthetic insertText does not prove native Chinese IME composition.'] }
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
  const checks = facts.checks as Record<string, unknown>
  const image = block('image'), para = block('para')
  const initialImage = await image.boundingBox(), target = await para.boundingBox()
  if (!initialImage || !target) throw Error('missing central sample geometry')
  await page.mouse.move(initialImage.x + initialImage.width / 2, initialImage.y + 30)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + Math.min(60, target.height / 2), { steps: 8 })
  checks.centralPreviewCount = await page.locator('[data-flow-layout-preview]').count()
  checks.centralPreview = await page.locator('[data-flow-layout-preview]').first().evaluate(e => ({ cssFloat: getComputedStyle(e).cssFloat, rect: e.getBoundingClientRect().toJSON(), html: e.outerHTML.slice(0, 1500) })).catch(() => null)
  await page.screenshot({ path: join(directory, '01-central-preview.png') })
  await page.mouse.up()
  const afterDrop = await snapshot()
  checks.centralPlacement = afterDrop.model.project.instances.image.flowLayout
  // Character ranges, rather than whole block bounds, prove whether lines exist
  // on both sides of the visible object at overlapping vertical positions.
  async function sides() {
    return page.evaluate(() => {
      const image = document.querySelector('[data-flow-block-id="image"]')!, text = document.querySelector('[data-flow-block-id="para"]')!
      const object = image.getBoundingClientRect(), walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
      let left = 0, right = 0, overlap = 0, node: Node | null
      while ((node = walker.nextNode())) for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1)
        for (const r of Array.from(range.getClientRects())) {
          if (r.bottom <= object.top || r.top >= object.bottom || r.width === 0) continue
          if (r.right <= object.left + .5) left++
          else if (r.left >= object.right - .5) right++
          else overlap++
        }
      }
      return { left, right, overlap, object: object.toJSON() }
    })
  }
  checks.centralCharacters = await sides()
  await page.screenshot({ path: join(directory, '02-central-drop.png') })
  // Test actual editable selection and insertion; this is not native IME.
  try {
    await para.dblclick()
    checks.selection = await page.evaluate(() => {
      const element = document.querySelector('[data-flow-block-id="para"]')!, walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), node = walker.nextNode()
      if (!node || (node.textContent?.length ?? 0) < 4) return ''
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4)
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
      return selection.toString()
    })
    await page.keyboard.insertText('中文测试')
    await page.keyboard.press('Escape')
    checks.chineseInserted = await para.innerText().then(text => text.includes('中文测试'))
  } catch (error) { checks.textEditingFailure = String(error) }
  // Exercise a second independently dragged object, even if the first candidate
  // did not establish central wrapping; collect the failure rather than rerun.
  try {
    const widget = block('widget'), w = await widget.boundingBox(), p = await para.boundingBox()
    if (!w || !p) throw Error('second object unavailable')
    await page.mouse.move(w.x + w.width / 2, w.y + 20); await page.mouse.down()
    await page.mouse.move(p.x + 30, p.y + 80, { steps: 8 }); await page.mouse.up()
    checks.secondObjectPlacement = (await snapshot()).model.project.instances.widget.flowLayout
    checks.secondObjectVisible = await widget.isVisible()
  } catch (error) { checks.secondObjectFailure = String(error) }
  await page.screenshot({ path: join(directory, '03-multiple-objects.png') })
  await page.setViewportSize({ width: 390, height: 900 })
  checks.narrow = await sides().catch(error => ({ error: String(error) }))
  await page.screenshot({ path: join(directory, '04-narrow.png') })
  const final = await snapshot(), savePath = join(directory, 'central.glx')
  if (final.model.kind !== 'course-v10') throw new Error('Expected the current V10 owner')
  await host.internalAPI.save(initial.documentId, savePath)
  const reopened = new CourseV10Driver().load(await readFile(savePath))
  if (reopened.kind !== 'course-v10') throw new Error('Expected a V10 archive')
  checks.archiveReopened = JSON.stringify(reopened.project.instances) === JSON.stringify(final.model.project.instances)
  checks.pageErrors = errors
  facts.elapsedMs = Date.now() - started
  const positions = checks.centralCharacters as { left: number; right: number; overlap: number }
  facts.status = positions.left > 0 && positions.right > 0 && positions.overlap === 0 ? 'candidate-needs-native-IME-and-app-confirmation' : 'central-two-sided-not-supported-by-this-sample'
  await writeFile(join(directory, 'result.json'), JSON.stringify(facts, null, 2))
  expect(errors).toEqual([])
 } catch(error) {
  await page.screenshot({path:join(directory,'failure.png')}).catch(()=>{})
  await writeFile(join(directory,'failure.json'),JSON.stringify({ ...facts, elapsedMs: Date.now()-started, error:String(error),errors },null,2))
  throw error
 } finally { await page.evaluate(()=>(window as any).flowHarness?.dispose()).catch(()=>{}); off(); await browser.close() }
},90_000)
