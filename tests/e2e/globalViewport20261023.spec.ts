import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
const { PNG } = require('pngjs')

const root = path.resolve(__dirname, '../..')
const directory = path.join(root, 'output/playwright/global-viewport-20261023', process.env.GLOBAL_VIEWPORT_RUN ?? `run-${Date.now()}`)
const workspace = path.join(directory, 'workspace')
const ids = ['chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5']
const underSource = `export default {mount(context){const root=context.root;root.dataset.globalViewportUnder='';root.style.cssText='width:100%;height:100%;background:rgb(32,128,96);pointer-events:none';return{update(){},dispose(){root.replaceChildren()}}}}`
const stickySource = `export default {mount(context){const root=context.root;root.dataset.nativeStickyNav='';root.style.cssText='box-sizing:border-box;width:100%;height:48px;background:#f5c456;display:flex;align-items:center;padding:0 16px;gap:12px;font:16px Arial';root.textContent='Native sticky navigation';const b=document.createElement('button');b.textContent='Sticky U5';b.onclick=()=>context.teacherController.execute({type:'scene.go',sceneId:'flow',targetInstanceId:'chapter5'});root.append(b);return{update(){},dispose(){root.replaceChildren()}}}}`
const navSource = `export default {mount(context){const root=context.root;root.dataset.globalViewportNav='';root.style.cssText='position:relative;width:100%;height:100%;pointer-events:none';
 const nav=document.createElement('nav');nav.style.cssText='position:absolute;bottom:0;box-sizing:border-box;width:100%;height:64px;display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgb(20,44,60);border-bottom:3px solid rgb(245,196,86);pointer-events:auto';root.append(nav);
 ['U1','U3','U5'].forEach((label,i)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='font:16px Arial;padding:8px;border:0;background:#ffe4b3';b.onclick=()=>context.teacherController.execute({type:'scene.go',sceneId:'flow',targetInstanceId:'chapter'+[1,3,5][i]});nav.append(b)});
 const edge=document.createElement('button');edge.textContent='Right edge';edge.style.cssText='margin-left:auto;font:14px Arial;padding:8px 5px;border:0;background:#ffe4b3;white-space:nowrap';edge.onclick=()=>root.dataset.edgeClicks=String(Number(root.dataset.edgeClicks||0)+1);nav.append(edge);
 const corner=document.createElement('div');corner.dataset.globalViewportCorner='';corner.style.cssText='position:absolute;right:0;top:0;width:12px;height:12px;background:rgb(203,38,132);pointer-events:none';root.append(corner);
 const samples=[];const paint=()=>{const s=context.teacherController.read();samples.push({reading:s.reading,motion:s.flowMotion});if(samples.length>700)samples.shift();root.dataset.samples=JSON.stringify(samples);root.dataset.reading=JSON.stringify(s.reading||null);root.dataset.motion=JSON.stringify(s.flowMotion||null)};const release=context.teacherController.subscribe(paint);paint();
 return{update(){},dispose(){release();root.replaceChildren()}}}}`

function fixture() {
  return migrateCourseProjectV10({ schemaVersion: 10, id: 'global-viewport-lab', revision: 0, title: 'Global viewport laboratory',
    definitions: { block: { id: 'block', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } },
      under: { id: 'under', role: 'content', implementation: { kind: 'source', language: 'javascript', source: underSource } },
      nav: { id: 'nav', role: 'content', implementation: { kind: 'source', language: 'javascript', source: navSource } },
      sticky: { id: 'sticky', role: 'content', implementation: { kind: 'source', language: 'javascript', source: stickySource } } },
    instances: { under: { id: 'under', definitionId: 'under', data: {}, viewportPinned: true, frame: { width: 1280, height: 900, transform: [1,0,0,1,0,0] }, style: { width: '100%', height: '100%', pointerEvents: 'none' } },
      nav: { id: 'nav', definitionId: 'nav', data: {}, viewportPinned: true, frame: { width: 1280, height: 64, transform: [1,0,0,1,0,10000] }, style: { width: '100%' } },
      title: { id:'title',definitionId:'block',data:{type:'heading',level:1,content:{inlines:[{type:'text',text:'Title before sticky navigation'}]}},style:{padding:'24px 30px 70px',color:'#fff9e8',fontSize:'28px'} },
      sticky: { id:'sticky',definitionId:'sticky',data:{},style:{position:'sticky',top:0,zIndex:10} },
      ...Object.fromEntries(ids.map((id, i) => [id, { id, definitionId: 'block', name: `Chapter ${i+1}`, data: { type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: `U${i+1} — Native Flow chapter` }] } },
        style: { padding: '110px 30px 650px', scrollMarginTop: '90px', color: '#fff9e8', fontSize: '30px' } }])) },
    surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow viewport', childIds: ['title','sticky',...ids], flow: { layout: { toc: 'hidden', widthMode: 'fluid', edgeToEdge: true, readingWidth: 900, wideContentWidth: 1280 } } },
      { id: 'slide', kind: 'slide', title: 'Slide viewport', childIds: [], designSize: { width: 1280, height: 900 } },
      { id: 'spatial', kind: 'spatial', title: 'Spatial viewport', childIds: [], designSize: { width: 1280, height: 900 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }],
    assets: {}, global: { underlay: ['under'], overlay: ['nav'] }, playback: { keyboardNavigation: true, controls: 'none', presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } } })
}

async function runtime(page: Page): Promise<Locator> {
  for (const frame of page.frames()) { const node = frame.locator('[data-global-viewport-nav]'); if (await node.count()) return node }
  throw Error('Missing public Runtime viewport fixture')
}
async function button(page: Page, label: string) {
  for (const frame of page.frames()) if (await frame.locator('[data-global-viewport-nav]').count()) return frame.getByRole('button', { name: label, exact: true })
  throw Error('Missing public Runtime navigation')
}
async function ready(page: Page) { await expect.poll(async () => { try { return await (await runtime(page)).count() } catch { return 0 } }).toBe(1) }
async function measure(page: Page) {
  return page.evaluate(() => {
    const node = (id: string) => document.querySelector<HTMLElement>(`[data-component-instance="${id}"],[data-component-object="${id}"],[data-compiled-node="${id}"]`)!
    const under=node('under'), nav=node('nav'), plane=under.closest<HTMLElement>('[data-flow-observation-root]') ?? document.getElementById('course-root')!
    const scroll=document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!
    const rect=(el:Element)=>el.getBoundingClientRect().toJSON()
    return { viewport:rect(plane), under:rect(under), nav:rect(nav), scroll:rect(scroll), scrollTop:scroll.scrollTop, scrollHeight:scroll.scrollHeight,
      clientHeight:scroll.clientHeight, nativeScrollbar:{right:scroll.offsetWidth-scroll.clientWidth,bottom:scroll.offsetHeight-scroll.clientHeight},
      panBars:[...document.querySelectorAll<HTMLElement>('[data-playback-chrome$="-bar"]')].map(el=>({label:el.getAttribute('aria-label'),display:getComputedStyle(el).display,rect:rect(el)})),
      observationTransform:document.querySelector<HTMLElement>('[data-playback-content]')?.style.transform }
  })
}
async function fullViewport(page:Page,navBottomOffset=0) {
  await expect.poll(async()=>{const g=await measure(page);return Math.abs(g.nav.width-g.viewport.width)+Math.abs(g.nav.bottom-g.viewport.bottom+navBottomOffset)}).toBeLessThan(1)
  const g=await measure(page)
  for(const property of ['x','y','right','bottom','width','height'] as const)expect(g.under[property]).toBeCloseTo(g.viewport[property],0)
  for(const property of ['x','right','width'] as const)expect(g.nav[property]).toBeCloseTo(g.viewport[property],0)
  expect(g.nav.bottom).toBeCloseTo(g.viewport.bottom-navBottomOffset,0)
  expect(g.nav.height).toBe(64)
  expect(g.scrollHeight).toBeGreaterThan(g.clientHeight+500)
  return g
}
async function clickEdge(page:Page) {
  const node=await runtime(page),before=Number(await node.getAttribute('data-edge-clicks')??0)
  await(await button(page,'Right edge')).click()
  await expect(node).toHaveAttribute('data-edge-clicks',String(before+1))
}
async function edgePixels(page:Page){const g=await measure(page),png=PNG.sync.read(await page.screenshot()),pixel=(x:number,y:number)=>{const i=(Math.floor(y)*png.width+Math.floor(x))*4;return[...png.data.slice(i,i+3)]};const facts={background:pixel(g.viewport.right-2,g.viewport.bottom-30),lowerBorder:pixel(g.viewport.right-2,g.viewport.bottom-2),underlay:pixel(g.viewport.right-40,g.viewport.top+450)};expect(facts.background).toEqual([20,44,60]);expect(facts.lowerBorder).toEqual([245,196,86]);expect(facts.underlay).toEqual([32,128,96]);return facts}
async function motionRegression(page:Page) {
  const nav=await runtime(page)
  await(await button(page,'U5')).click()
  await expect.poll(async()=>JSON.parse(await nav.getAttribute('data-motion')??'null')?.status).toBe('running')
  await page.waitForTimeout(80)
  await(await button(page,'U3')).click()
  await expect.poll(async()=>JSON.parse(await nav.getAttribute('data-motion')??'null')?.status).toBe('completed')
  expect(JSON.parse(await nav.getAttribute('data-reading')??'null').activeInstanceId).toBe('chapter3')
  await(await button(page,'U5')).click();await page.waitForTimeout(80)
  const g=await measure(page);await page.mouse.move(g.viewport.x+70,g.viewport.y+240);await page.mouse.wheel(0,-260)
  await expect.poll(async()=>JSON.parse(await nav.getAttribute('data-samples')??'[]').some((s:any)=>s.motion?.status==='cancelled')).toBe(true)
  const stopped=(await measure(page)).scrollTop;await page.waitForTimeout(150)
  expect((await measure(page)).scrollTop).toBeCloseTo(stopped,0)
  return JSON.parse(await nav.getAttribute('data-samples')??'[]')
}
async function stickyGeometry(page:Page){return page.evaluate(()=>{const target=document.querySelector<HTMLElement>('[data-component-instance="sticky"],[data-component-object="sticky"],[data-compiled-node="sticky"]')!,title=document.querySelector<HTMLElement>('[data-component-instance="title"],[data-component-object="title"],[data-compiled-node="title"],[data-flow-block-id="title"]')!,scroll=document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!;return{nav:target.getBoundingClientRect().toJSON(),title:title.getBoundingClientRect().toJSON(),scroll:scroll.getBoundingClientRect().toJSON(),scrollTop:scroll.scrollTop,position:getComputedStyle(target).position,transform:document.querySelector<HTMLElement>('[data-playback-content]')?.style.transform}})}
async function stickyExercise(page:Page,name:string){
  await page.evaluate(()=>{document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.scrollTop=0})
  await expect.poll(async()=>(await stickyGeometry(page)).scrollTop).toBe(0)
  const initial=await stickyGeometry(page);expect(initial.position).toBe('sticky');expect(initial.nav.top).toBeGreaterThan(initial.title.top+70)
  const visible=(await measure(page)).viewport
  await page.mouse.move(visible.x+70,visible.y+400);await page.mouse.wheel(0,500)
  await expect.poll(async()=>(await stickyGeometry(page)).scrollTop).toBeGreaterThan(200)
  const pinned=await stickyGeometry(page);expect(pinned.nav.top).toBeCloseTo(pinned.scroll.top,0);expect(pinned.title.bottom).toBeLessThan(pinned.scroll.top)
  await page.screenshot({path:path.join(directory,`${name}-sticky-forward.png`)})
  await page.mouse.wheel(0,-1000)
  await expect.poll(async()=>(await stickyGeometry(page)).scrollTop).toBe(0)
  const reversed=await stickyGeometry(page);expect(reversed.nav.top).toBeCloseTo(initial.nav.top,0)
  await page.screenshot({path:path.join(directory,`${name}-sticky-reversed.png`)})
  return{initial,pinned,reversed}
}

test.beforeAll(async()=>{await mkdir(workspace,{recursive:true})})

test('production model and compiled players keep interactive globals on the full viewport at desktop and mobile widths',async({browser})=>{
  test.setTimeout(150_000)
  const context=await browser.newContext({viewport:{width:1440,height:900},offline:true}),page=await context.newPage(),facts:any={errors:[]}
  page.on('pageerror',e=>facts.errors.push(e.message))
  try{
    const glx=path.join(workspace,'viewport-lab.glx');await writeFile(glx,createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
    const model=openCourseProjectV10Archive(await readFile(glx));facts.archive={path:glx,id:model.project.id}
    const published=await buildPublishedCourseV4({project:model.project,assetBytes:model.resources.assets,componentFiles:model.resources.components},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
    expect(published.diagnostics.filter(x=>x.code==='source-compile-failed')).toEqual([])
    const modelFile=path.join(directory,'production-model.html'),compiledFile=path.join(directory,'production-compiled.html')
    await writeFile(modelFile,buildComponentSingleHtml(published.payload,await readFile(path.join(root,'dist-player/player.iife.js'),'utf8')))
    await page.goto(pathToFileURL(modelFile).href);await page.evaluate(async()=>{await(window as any).coursePlayerReady});await ready(page)
    const helper=await build({stdin:{contents:`export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'ViewportCompileHelper',platform:'browser',target:'es2022',loader:{'.png':'dataurl','.woff2':'dataurl'}})
    await page.addScriptTag({content:helper.outputFiles[0]!.text})
    const artifact=await page.evaluate(async serialized=>{const h=(window as any).ViewportCompileHelper;return h.compileCoursePlayback(JSON.parse(serialized),{document,renderBuiltin:(instance:any,key:string,project:any)=>h.renderCompiledBuiltin(instance,key,project,document)})},JSON.stringify(published.payload))
    expect(artifact.diagnostics).toEqual([])
    await writeFile(compiledFile,buildCompiledSingleHtml(artifact,await readFile(path.join(root,'dist-player/compiled-player.iife.js'),'utf8')))
    facts.files={modelFile,compiledFile};facts.publishedDiagnostics=published.diagnostics
    for(const[mode,file]of [['model',modelFile],['compiled',compiledFile]]){
      await page.goto(pathToFileURL(file).href);await page.evaluate(async()=>{await(window as any).coursePlayerReady});await ready(page)
      facts[mode]={widths:[]}
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:900});await ready(page)
        facts[mode].widths.push({geometry:await fullViewport(page),pixels:await edgePixels(page)});await clickEdge(page)
        await page.screenshot({path:path.join(directory,`${mode}-${width}.png`)})
      }
      await page.setViewportSize({width:1440,height:900});facts[mode].sticky=await stickyExercise(page,mode);facts[mode].motion=await motionRegression(page)
      for(const target of ['slide','spatial','flow']){
        expect(await page.evaluate(async id=>(window as any).coursePlayer.navigation.execute({type:'scene.go',sceneId:id}),target)).toBe(true)
        await ready(page)
        if(target==='flow')facts[mode].returned=await fullViewport(page)
        else{const g=await page.evaluate(()=>{const el=document.querySelector<HTMLElement>('[data-component-object="nav"],[data-compiled-node="nav"]')!;return el.getBoundingClientRect().toJSON()});expect(g.width).toBe(1440);expect(g.height).toBe(64);expect(g.bottom).toBe(900)}
      }
    }
    expect(facts.errors).toEqual([])
  }finally{await writeFile(path.join(directory,'facts-production-players.json'),JSON.stringify(facts,null,2));await context.close()}
})

function environment(){const env=Object.fromEntries(Object.entries(process.env).filter((e):e is[string,string]=>typeof e[1]==='string'&&!/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(e[0])));delete env.ELECTRON_RUN_AS_NODE;return{...env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}}
async function launch(profile:string){const app=await electron.launch({cwd:root,args:['.',`--user-data-dir=${profile}`],env:environment()}),page=await app.firstWindow();page.setDefaultTimeout(15_000);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1100);w.show();w.focus()});await expect(page.getByLabel('切换工作空间',{exact:true})).toBeVisible();return{app,page}}
async function close(app:ElectronApplication){await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>{});await app.close().catch(()=>{})}
async function open(app:ElectronApplication,page:Page,name:string){await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]})},workspace);await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click();await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name,exact:true}).dblclick();const frame=page.locator('.course-editor-frame:visible');await expect(frame).toBeVisible();if(await frame.getAttribute('data-editor-mode')!=='deep')await frame.getByRole('button',{name:'在编辑器中打开',exact:true}).click();await ready(page);return(await frame.getAttribute('data-document-id'))!}
async function snapshot(app:ElectronApplication,id:string){return app.evaluate(async({app},id)=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),s=await r('./dist-electron/main/workbench/documentHost.js').documentHost().internalAPI.read(id);return{dirty:s.dirty,project:s.model.project}},id)}
async function editGlobalDrag(app:ElectronApplication,page:Page,id:string,facts:any){
  facts.before=await snapshot(app,id)
  await page.getByTestId('global-layer-entry').click();await page.getByRole('tab',{name:'图层',exact:true}).click()
  await page.getByTestId('node-item-nav').locator('.node-name').click()
  await expect(page.locator('[data-flow-controller-selection]')).toBeVisible()
  const nav=page.locator('[data-component-instance="nav"]');const box=await nav.boundingBox();if(!box)throw Error('Missing global nav drag target')
  facts.beforeDisplay=box
  const point={x:box.x+box.width*.25,y:box.y}
  facts.hit=await page.evaluate(point=>{const e=document.elementFromPoint(point.x,point.y);return{tag:e?.tagName,html:e?.outerHTML.slice(0,600)}},point)
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(120);await page.mouse.move(point.x,point.y-30,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await snapshot(app,id)).project.instances.nav.frame!.transform[5]).not.toBe(facts.before.project.instances.nav.frame.transform[5])
  facts.after=await snapshot(app,id);facts.afterDisplay=await nav.boundingBox()
  expect(facts.afterDisplay.y).toBeCloseTo(box.y-30,0)
  expect(facts.after.project.instances.nav.frame.width).toBe(facts.before.project.instances.nav.frame.width)
  expect(facts.after.project.instances.nav.frame.height).toBe(facts.before.project.instances.nav.frame.height)
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=>(await snapshot(app,id)).project.instances.nav.frame).toEqual(facts.before.project.instances.nav.frame)
  facts.undoDisplay=await nav.boundingBox();expect(facts.undoDisplay.y).toBeCloseTo(box.y,0)
  await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(async()=>(await snapshot(app,id)).project.instances.nav.frame).toEqual(facts.after.project.instances.nav.frame)
  facts.redoDisplay=await nav.boundingBox();expect(facts.redoDisplay.y).toBeCloseTo(box.y-30,0)
  await page.screenshot({path:path.join(directory,'electron-global-real-drag-redo.png')})
  await page.getByTestId('flow-page-flow').click()
}

test('production Electron editor zoom trial save cold reopen and official HTML export share the global viewport',async({browser})=>{
  test.setTimeout(210_000)
  await writeFile(path.join(workspace,'viewport-editor.glx'),createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
  let warm:Awaited<ReturnType<typeof launch>>|undefined,cold:Awaited<ReturnType<typeof launch>>|undefined
  const facts:any={errors:[]}
  try{
    warm=await launch(path.join(directory,'warm-profile'));warm.page.on('pageerror',e=>facts.errors.push(e.message))
    const id=await open(warm.app,warm.page,'viewport-editor.glx');facts.editor=await fullViewport(warm.page)
    await warm.page.getByLabel('放大画布',{exact:true}).click();await warm.page.getByLabel('放大画布',{exact:true}).click()
    await expect(warm.page.getByLabel('画布缩放比例',{exact:true})).toHaveText('120%')
    facts.editorZoom=await fullViewport(warm.page)
    expect(facts.editorZoom.panBars.some((b:any)=>b.display!=='none')).toBe(true)
    await warm.page.screenshot({path:path.join(directory,'electron-editor-zoom-scrollbars.png')})
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'试运行',exact:true}).click();await ready(warm.page)
    facts.trialZoom=await fullViewport(warm.page);await clickEdge(warm.page)
    await warm.page.screenshot({path:path.join(directory,'electron-trial-zoom.png')})
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'编辑',exact:true}).click();await warm.page.getByLabel('适合窗口',{exact:true}).click()
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'试运行',exact:true}).click();await ready(warm.page)
    facts.trial=await fullViewport(warm.page);facts.sticky=await stickyExercise(warm.page,'electron-trial');facts.motion=await motionRegression(warm.page)
    await warm.page.screenshot({path:path.join(directory,'electron-trial.png')})
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'编辑',exact:true}).click()
    facts.drag={};await editGlobalDrag(warm.app,warm.page,id,facts.drag)
    const saved=path.join(workspace,'viewport-saved.glx');await warm.app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},saved)
    await warm.page.getByRole('button',{name:'另存为',exact:true}).click();await expect.poll(async()=>{try{return(await readFile(saved)).length}catch{return 0}}).toBeGreaterThan(0)
    facts.saved=await snapshot(warm.app,id);await close(warm.app);warm=undefined
    cold=await launch(path.join(directory,'cold-profile'));cold.page.on('pageerror',e=>facts.errors.push(e.message));const coldId=await open(cold.app,cold.page,'viewport-saved.glx')
    facts.cold=await snapshot(cold.app,coldId);expect(facts.cold.project).toEqual(facts.saved.project)
    const coldBase=await measure(cold.page),navY=facts.cold.project.instances.nav.frame.transform[5],coldOffset=Math.max(0,coldBase.viewport.height-64-navY)
    facts.coldGeometry=await fullViewport(cold.page,coldOffset)
    await cold.page.getByTestId('global-layer-entry').click();await cold.page.getByRole('tab',{name:'图层',exact:true}).click();await cold.page.getByTestId('node-item-nav').locator('.node-name').click();await expect(cold.page.locator('[data-flow-controller-selection]')).toBeVisible();facts.coldGlobalDisplay=await cold.page.locator('[data-component-instance="nav"]').boundingBox();expect(facts.coldGlobalDisplay.y).toBeCloseTo(facts.drag.redoDisplay.y,0);await cold.page.getByTestId('flow-page-flow').click()
    facts.export=await cold.app.evaluate(async({app},{id,workspace})=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),host=r('./dist-electron/main/workbench/documentHost.js').documentHost(),runId=`viewport-export-${Date.now()}`;await host.tools.beginRun({runId,actor:'human',documents:[{documentId:id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:workspace}});await host.tools.loadToolFamilies(runId,['build']);const opened=await host.tools.completeOpenedDocument(runId,{documentId:id,writable:true},{selection:'preserve'});const receipt=await host.tools.execute(runId,'offline',{name:'document.export',input:{target:opened.target,format:'html-offline',destination:'viewport-official.html'}});await host.tools.stop(runId);return receipt},{id:coldId,workspace})
    expect(facts.export).toMatchObject({kind:'read',data:{status:'written',format:'html-offline'}})
    await close(cold.app);cold=undefined
    const context=await browser.newContext({viewport:{width:1440,height:900},offline:true}),page=await context.newPage();page.on('pageerror',e=>facts.errors.push(e.message))
    try{await page.goto(pathToFileURL(path.join(workspace,'viewport-official.html')).href);await ready(page);facts.official=[];const exportOffset=Math.max(0,900-64-navY);for(const width of [1440,390]){await page.setViewportSize({width,height:900});facts.official.push(await fullViewport(page,exportOffset));await clickEdge(page);await page.screenshot({path:path.join(directory,`official-export-${width}.png`)})}await page.setViewportSize({width:1440,height:900});facts.officialSticky=await stickyExercise(page,'official-export')}finally{await context.close()}
    expect(facts.errors).toEqual([])
  }finally{if(warm)await close(warm.app);if(cold)await close(cold.app);await writeFile(path.join(directory,'facts-electron.json'),JSON.stringify(facts,null,2));await writeFile(path.join(root,'output/playwright/global-viewport-20261023/latest-run.txt'),directory)}
})
