import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'

const root = path.resolve(__dirname, '../..')
const directory = path.join(root, 'output/playwright/flow-navigation-20261022', process.env.FLOW_NAVIGATION_RUN ?? `run-${Date.now()}`)
const coffeeSource = path.join(root, 'docs/creative-production/works/coffee-journey/design/v06/native/coffee-journey-v06.glx')
const ids = ['chapter1','chapter2','chapter3','chapter4','chapter5']
const source = `export default {mount(context){
 const root=context.root;root.dataset.flowMotionLab='';root.style.cssText='position:relative;width:100%;height:100%;background:linear-gradient(135deg,#122f3a,#315949);pointer-events:none';
 const ball=document.createElement('div');ball.style.cssText='position:absolute;top:40%;width:100px;height:100px;border-radius:50%;background:#f3bb77;box-shadow:0 0 80px #f3bb7780';root.append(ball);
 let visual=0, motionId=null, start=0, paints=0;const frames=[];const chapter=id=>Math.max(0,Number(String(id||'chapter1').replace('chapter',''))-1)/4;
 const paint=()=>{const s=context.teacherController.read(),m=s.flowMotion;
  if(m?.status==='running'){if(m.id!==motionId){motionId=m.id;start=visual}visual=start+(chapter(m.targetInstanceId)-start)*m.progress}
  else if(m?.status==='completed')visual=chapter(m.targetInstanceId);else visual=s.reading?.progress||0;
  ball.style.left=(8+visual*72)+'%';ball.style.transform='scale('+(0.6+visual)+')';ball.style.background='hsl('+(32+visual*140)+' 80% 70%)';
  const sample={time:performance.now(),reading:s.reading,motion:m,visual};frames.push(sample);if(frames.length>900)frames.shift();
  root.dataset.samples=JSON.stringify(frames);root.dataset.paints=String(++paints);root.dataset.visual=String(visual);root.dataset.motion=JSON.stringify(m||null);
 };const release=context.teacherController.subscribe(paint);paint();return {update(){},suspend(){root.dataset.suspended='true'},resume(){delete root.dataset.suspended;paint()},dispose(){release();root.replaceChildren()}};
}}`
const hudSource = `export default {mount(context){const root=context.root;root.dataset.flowMotionHud='';root.style.cssText='width:100%;height:100%;display:flex;gap:5px;align-items:center;justify-content:center;background:#112b2de6';
 const execute=action=>{root.dataset.requests=String(Number(root.dataset.requests||0)+1);context.teacherController.execute(action).then(ok=>root.dataset.result=String(ok))};
 ['Previous','U1','U2','U3','U4','U5','Next'].forEach((label,i)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='font:14px Arial;padding:10px 8px;border:0;border-radius:6px;background:#ffe4b3;color:#183d31';b.onclick=()=>execute(i===0?{type:'step.previous'}:i===6?{type:'step.next'}:{type:'scene.go',sceneId:'flow',targetInstanceId:'chapter'+i});root.append(b)});return {update(){},dispose(){root.replaceChildren()}}}}`
function fixture() {
  return migrateCourseProjectV10({schemaVersion:10,id:'flow-navigation-motion-lab',revision:0,title:'Flow navigation motion laboratory',
    definitions:{block:{id:'block',role:'content',implementation:{kind:'builtin',key:'guoling.document-block'}},
      under:{id:'under',role:'content',implementation:{kind:'source',language:'javascript',source}},
      hud:{id:'hud',role:'content',implementation:{kind:'source',language:'javascript',source:hudSource}}},
    instances:{under:{id:'under',definitionId:'under',data:{},viewportPinned:true,frame:{width:1280,height:900,transform:[1,0,0,1,0,0]},style:{width:'100%',height:'100%',pointerEvents:'none'}},
      hud:{id:'hud',definitionId:'hud',data:{},viewportPinned:true,frame:{width:720,height:64,transform:[1,0,0,1,280,820]},style:{width:'100%'}},
      ...Object.fromEntries(ids.map((id,index)=>[id,{id,definitionId:'block',name:`Chapter ${index+1}`,data:{type:'heading',level:2,content:{inlines:[{type:'text',text:`U${index+1} — Flow motion chapter`}] }},
        style:{padding:'80px 36px 760px',scrollMarginTop:'110px',color:'#fff4dc',fontSize:'34px',background:index%2?'#ffffff08':'transparent'}}]))},
    surfaces:[{id:'flow',kind:'flow',title:'Flow motion',childIds:ids,flow:{layout:{toc:'hidden',widthMode:'fluid',edgeToEdge:true,readingWidth:900,wideContentWidth:1280}}},
      {id:'slide',kind:'slide',title:'Slide check',childIds:[],designSize:{width:1280,height:900}},
      {id:'spatial',kind:'spatial',title:'Spatial check',childIds:[],designSize:{width:1280,height:900},spatial:{home:{x:0,y:0,zoom:1},frames:[]}}],
    assets:{},global:{underlay:['under'],overlay:['hud']},playback:{keyboardNavigation:true,controls:'none',presenter:{enabled:true,strategy:'scene-navigation',additionalBindings:[]}}})
}
let bundle: string
test.beforeAll(async()=>{
  await mkdir(directory,{recursive:true})
  const result=await build({stdin:{contents:`export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'CoursewarePlayer',platform:'browser',target:'es2022',loader:{'.png':'dataurl','.woff2':'dataurl'}})
  bundle=result.outputFiles[0]!.text+'\nvar CoursewareCompiledPlayer=CoursewarePlayer;'
  await writeFile(path.join(directory,'browser-harness.iife.js'),bundle)
})
async function files(page:Page,name:string,model:ReturnType<typeof openCourseProjectV10Archive>) {
  const compilation=new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const published=await buildPublishedCourseV4({project:model.project,assetBytes:model.resources.assets,componentFiles:model.resources.components},{compilation})
  expect(published.diagnostics.filter(x=>x.code==='source-compile-failed')).toEqual([])
  const modelFile=path.join(directory,`${name}-model.html`),offlineFile=path.join(directory,`${name}-offline.html`)
  await writeFile(modelFile,buildComponentSingleHtml(published.payload,bundle))
  await page.goto(pathToFileURL(modelFile).href);await page.evaluate(async()=>{await (window as any).coursePlayerReady})
  const artifact=await page.evaluate(async serialized=>{const api=(window as any).CoursewarePlayer;return api.compileCoursePlayback(JSON.parse(serialized),{document,renderBuiltin:(instance:any,key:string,project:any)=>api.renderCompiledBuiltin(instance,key,project,document)})},JSON.stringify(published.payload))
  await writeFile(offlineFile,buildCompiledSingleHtml(artifact,bundle))
  return {modelFile,offlineFile,published:{offlineComplete:published.offlineComplete,diagnostics:published.diagnostics},compileDiagnostics:artifact.diagnostics}
}
async function lab(page:Page) {
  for(const frame of page.frames())if(await frame.locator('[data-flow-motion-lab]').count())return frame.locator('[data-flow-motion-lab]')
  throw Error('Missing public-contract Underlay fixture Runtime')
}
async function button(page:Page,label:string) {
  for(const frame of page.frames())if(await frame.locator('[data-flow-motion-hud]').count())return frame.getByRole('button',{name:label,exact:true})
  throw Error('Missing fixture HUD')
}
async function samples(page:Page){return JSON.parse((await(await lab(page)).getAttribute('data-samples'))!)}
async function measure(page:Page,underId='under',hudId='hud') {
  return page.evaluate(({underId,hudId})=>{
    const find=(id:string)=>document.querySelector<HTMLElement>(`[data-compiled-node="${id}"],[data-component-object="${id}"]`)!
    const under=find(underId),hud=find(hudId),scroll=document.querySelector<HTMLElement>('[data-flow-paper-scroll]')??document.querySelector<HTMLElement>('[data-testid="flow-scroll"]')
    const rect=(node:Element|null)=>node?.getBoundingClientRect().toJSON()
    return {viewport:{width:innerWidth,height:innerHeight},under:rect(under),hud:rect(hud),scroll:rect(scroll),scrollTop:scroll?.scrollTop,scrollHeight:scroll?.scrollHeight,underCount:document.querySelectorAll(`[data-compiled-node="${underId}"],[data-component-object="${underId}"]`).length}
  },{underId,hudId})
}
async function waitIdle(page:Page) {
  await expect.poll(async()=>{const entries=await samples(page);return entries.at(-1)?.motion?.status}).not.toBe('running')
  const first=await(await lab(page)).getAttribute('data-paints');await page.waitForTimeout(180)
  expect(await(await lab(page)).getAttribute('data-paints')).toBe(first)
}
async function motionExercise(page:Page,mode:string,facts:any) {
  await(await button(page,'U5')).click()
  await expect.poll(async()=>JSON.parse((await(await lab(page)).getAttribute('data-motion'))??'null')?.status).toBe('running')
  await page.waitForTimeout(120);await page.screenshot({path:path.join(directory,`${mode}-mid-forward.png`)})
  const moving=await samples(page),forward=moving.filter((x:any)=>x.motion?.status==='running'&&x.motion.targetInstanceId==='chapter5')
  expect(forward.length).toBeGreaterThan(2);expect(forward.some((x:any)=>x.motion.progress>0&&x.motion.progress<1&&x.visual>0)).toBe(true)
  expect(new Set(forward.map((x:any)=>x.motion.id)).size).toBe(1)
  await(await button(page,'U2')).click();await waitIdle(page)
  let entries=await samples(page);const reversed=entries.filter((x:any)=>x.motion?.targetInstanceId==='chapter2')
  expect(reversed.some((x:any)=>x.motion.status==='completed')).toBe(true)
  await(await button(page,'Next')).click();await waitIdle(page)
  entries=await samples(page);expect(entries.at(-1).reading.activeInstanceId).toBe('chapter3')
  await(await button(page,'Previous')).click();await waitIdle(page)
  expect((await samples(page)).at(-1).reading.activeInstanceId).toBe('chapter2')
  await(await button(page,'U1')).click();await waitIdle(page)
  await page.locator('[data-flow-paper-scroll]').click({position:{x:25,y:350}})
  await page.keyboard.down('PageDown')
  await expect.poll(async()=>(await samples(page)).at(-1)?.motion?.targetInstanceId).toBe('chapter2')
  await page.waitForTimeout(45);await page.keyboard.up('PageDown');await page.keyboard.down('PageDown')
  await expect.poll(async()=>(await samples(page)).at(-1)?.motion?.targetInstanceId).toBe('chapter3')
  const beforeRepeat=(await samples(page)).at(-1).motion
  expect(beforeRepeat.status).toBe('running')
  await page.keyboard.down('PageDown');await page.waitForTimeout(25)
  const repeated=(await samples(page)).at(-1).motion
  expect(repeated.id).toBe(beforeRepeat.id);expect(repeated.status).toBe('running')
  await page.keyboard.up('PageDown');await waitIdle(page)
  facts.keyboard={beforeRepeat,repeated,arrived:(await samples(page)).at(-1)}
  expect(facts.keyboard.arrived.reading.activeInstanceId).toBe('chapter3')
  await page.mouse.move(80,300);await page.mouse.wheel(0,220)
  await expect.poll(async()=>(await samples(page)).at(-1)?.motion).toBeUndefined();await waitIdle(page)
  facts.completedManual=(await samples(page)).at(-1)
  expect(facts.completedManual.visual).toBeCloseTo(facts.completedManual.reading.progress,5)
  await(await button(page,'U5')).click();await page.waitForTimeout(80)
  await page.mouse.move(80,300);await page.mouse.wheel(0,-350)
  await expect.poll(async()=>{const e=await samples(page);return e.some((x:any)=>x.motion?.status==='cancelled')}).toBe(true)
  await waitIdle(page)
  facts.events=await samples(page);facts.geometry=await measure(page)
  expect(facts.geometry.underCount).toBe(1)
  await page.screenshot({path:path.join(directory,`${mode}-after-wheel.png`)})
}

test('public Runtime motion and exact viewport run together in the model Player and compiled offline delivery',async({browser})=>{
  test.setTimeout(180_000)
  const context=await browser.newContext({viewport:{width:1440,height:900},offline:true}),page=await context.newPage(),facts:any={errors:[]}
  page.on('pageerror',error=>facts.errors.push(error.message))
  try{
    const project=fixture(),model={project,resources:{assets:{},components:{}}}
    await writeFile(path.join(directory,'motion-lab.glx'),createCourseProjectV10Archive(model))
    facts.files=await files(page,'motion-lab',model)
    for(const [mode,filename]of [['model',facts.files.modelFile],['offline',facts.files.offlineFile]]){
      await page.goto(pathToFileURL(filename).href);await page.evaluate(async()=>{await(window as any).coursePlayerReady})
      facts[mode]={widths:[]}
      for(const width of [1440,1550,390]){
        await page.setViewportSize({width,height:900})
        await expect.poll(async()=>(await measure(page)).under?.width).toBe(width)
        const geometry=await measure(page);facts[mode].widths.push(geometry)
        expect(geometry.under?.x).toBe(0);expect(geometry.under?.height).toBe(900)
        expect(geometry.hud!.width).toBe(width);expect(geometry.hud!.right).toBe(width);expect(geometry.hud!.bottom).toBeLessThanOrEqual(900)
        await page.screenshot({path:path.join(directory,`${mode}-${width}.png`)})
      }
      await page.setViewportSize({width:1440,height:900});await motionExercise(page,mode,facts[mode])
      await page.emulateMedia({reducedMotion:'reduce'});await(await button(page,'U1')).click();await waitIdle(page)
      const last=(await samples(page)).at(-1);expect(last.reading.activeInstanceId).toBe('chapter1');expect(last.motion?.status).toBe('completed');expect(last.motion?.durationMs).toBe(0)
      facts[mode].reduced=last;await page.emulateMedia({reducedMotion:'no-preference'})
      for(const target of ['slide','spatial','flow']){expect(await page.evaluate(async id=>(window as any).coursePlayer.navigation.execute({type:'scene.go',sceneId:id}),target)).toBe(true);const g=await measure(page);expect(g.under!.width).toBe(1440);expect(g.under!.height).toBe(900)}
    }
    expect(facts.errors).toEqual([])
  }finally{facts.finalSamples=await samples(page).catch(()=>[]);await writeFile(path.join(directory,'facts-motion.json'),JSON.stringify(facts,null,2));await context.close()}
})

test('coffee r204 remains read only and fills the viewport in real model and offline players',async({browser})=>{
  test.setTimeout(180_000)
  const context=await browser.newContext({viewport:{width:1440,height:1000},offline:true}),page=await context.newPage(),facts:any={source:coffeeSource,errors:[]}
  page.on('pageerror',error=>facts.errors.push(error.message))
  try{
    const original=await readFile(coffeeSource),model=openCourseProjectV10Archive(original);facts.revision=model.project.revision
    expect(facts.revision).toBe(204);await writeFile(path.join(directory,'coffee-readonly-copy.glx'),original)
    facts.files=await files(page,'coffee',model)
    const underId=model.project.global.underlay.find(id=>model.project.instances[id].viewportPinned)!,hudId=model.project.global.overlay.find(id=>model.project.instances[id].viewportPinned)!
    facts.underId=underId;facts.hudId=hudId
    for(const[mode,filename]of [['model',facts.files.modelFile],['offline',facts.files.offlineFile]]){
      await page.goto(pathToFileURL(filename).href);await page.evaluate(async()=>{await(window as any).coursePlayerReady});facts[mode]=[]
      for(const width of [1440,1550,390]){
        await page.setViewportSize({width,height:1000});await expect.poll(async()=>(await measure(page,underId,hudId)).under?.width).toBe(width)
        const g=await measure(page,underId,hudId);expect(g.under!.height).toBe(1000);facts[mode].push(g)
        await page.screenshot({path:path.join(directory,`coffee-${mode}-${width}.png`)})
      }
      await page.setViewportSize({width:1440,height:1000})
      await page.evaluate(()=>{const p=(window as any).coursePlayer;(window as any).__coffeeFlowSnapshots=[];p.navigation.subscribe(()=>{const s=p.navigation.read();(window as any).__coffeeFlowSnapshots.push({time:performance.now(),reading:s.reading,motion:s.flowMotion})});const target=p.navigation.read().scenes.find((x:any)=>x.id===p.navigation.readLocation())?.targets?.at(-1);(window as any).__coffeeNavigation=p.navigation.execute(target.action)})
      await page.waitForTimeout(140);await page.screenshot({path:path.join(directory,`coffee-${mode}-mid-navigation.png`)})
      const result=await page.evaluate(async()=>{const ok=await(window as any).__coffeeNavigation;return{ok,samples:(window as any).__coffeeFlowSnapshots}})
      expect(result.ok).toBe(true);expect(result.samples.some((x:any)=>x.motion?.status==='running'&&x.motion.progress>0&&x.motion.progress<1)).toBe(true)
      facts[`${mode}Navigation`]=result
    }
    expect(facts.errors).toEqual([])
  }finally{await writeFile(path.join(directory,'facts-coffee.json'),JSON.stringify(facts,null,2));await context.close()}
})

test('the shared Flow navigation handles browser scale dynamic height and Abort without pulling manual input back',async({page})=>{
  test.setTimeout(60_000)
  const server=await createServer({configFile:path.join(root,'vite.renderer.config.ts'),server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/output/**']}}});await server.listen()
  const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No Vite address')
  const origin=`http://127.0.0.1:${address.port}`,facts:any={}
  await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"></body></html>'}))
  try{
    await page.goto(origin)
    facts.result=await page.evaluate(async()=>{
      const load=(p:string):Promise<any>=>import(p),{createFlowReadingNavigation}=await load('/src/shared/flowReading.ts')
      const scroll=document.createElement('div');scroll.style.cssText='position:absolute;left:0;top:0;width:800px;height:550px;overflow:auto;transform:scale(.75);transform-origin:0 0';const body=document.createElement('div');scroll.append(body);document.body.append(scroll)
      for(let i=0;i<5;i++){const el=document.createElement('section');el.id='target'+i;el.style.cssText='height:700px;scroll-margin-top:125px;background:hsl('+i*55+' 30% 65%)';el.textContent=el.id;body.append(el)}
      const nav=createFlowReadingNavigation(()=>({scroll,body}),(id:string)=>document.getElementById(id)),evidence:any={}
      const request=nav.goToInstance('target3');setTimeout(()=>{body.children[0].setAttribute('style','height:1100px;scroll-margin-top:125px')},80)
      evidence.dynamicResult=await request;evidence.dynamic={top:scroll.scrollTop,targetTop:(document.getElementById('target3')!.getBoundingClientRect().top-scroll.getBoundingClientRect().top)/.75,reading:nav.readReading(['target0','target1','target2','target3','target4'])}
      const abort=new AbortController(),pending=nav.goToInstance('target0',abort.signal);setTimeout(()=>abort.abort(),80);evidence.abortResult=await pending;const stopped=scroll.scrollTop
      await new Promise(r=>setTimeout(r,140));evidence.aborted={stopped,after:scroll.scrollTop}
      const manual=nav.goToInstance('target4');setTimeout(()=>{scroll.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,bubbles:true}));scroll.scrollTop=200},80);evidence.manualResult=await manual
      await new Promise(r=>setTimeout(r,180));evidence.manualTop=scroll.scrollTop
      ;(window as any).__flowWheelOwner={nav,scroll,body}
      return evidence
    })
    expect(facts.result.dynamicResult).toBe(true);expect(facts.result.dynamic.targetTop).toBeCloseTo(125,0)
    expect(facts.result.abortResult).toBe(false);expect(facts.result.aborted.after).toBe(facts.result.aborted.stopped)
    expect(facts.result.manualResult).toBe(false);expect(facts.result.manualTop).toBe(200)
    await page.screenshot({path:path.join(directory,'scale-dynamic-abort-manual.png')})
    await page.evaluate(()=>{
      const {nav,scroll,body}=(window as any).__flowWheelOwner;body.style.position='relative'
      const iframe=document.createElement('iframe');iframe.id='flow-wheel-content-frame';iframe.srcdoc='<!doctype html><html style="height:100%;overflow:hidden"><body style="margin:0;height:100%;overflow:hidden;background:#e6f1ed88;font:24px Arial">Real content iframe wheel takeover</body></html>'
      iframe.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;z-index:5';body.append(iframe)
      ;(window as any).__flowIframeWheelEvents=[]
      scroll.addEventListener('scroll',()=>{(window as any).__flowIframeWheelEvents.push({time:performance.now(),actual:scroll.scrollTop,motion:nav.readMotion?.()})},{passive:true})
    })
    await page.locator('#flow-wheel-content-frame').contentFrame().getByText('Real content iframe wheel takeover').waitFor()
    await page.mouse.move(150,200)
    await page.evaluate(()=>{
      const iframe=document.querySelector<HTMLIFrameElement>('#flow-wheel-content-frame')!,{nav}=(window as any).__flowWheelOwner;(window as any).__flowIframeWheelInputs=[]
      iframe.contentDocument!.addEventListener('wheel',event=>(window as any).__flowIframeWheelInputs.push({trusted:event.isTrusted,time:performance.now(),motion:nav.readMotion?.()}),{passive:true})
    })
    await page.evaluate(()=>{const {nav}=(window as any).__flowWheelOwner;(window as any).__flowIframeWheelPromise=nav.goToInstance('target4')})
    await page.waitForTimeout(30);await page.mouse.wheel(0,-240)
    await page.waitForTimeout(40)
    facts.iframeWheel=await page.evaluate(async()=>{const result=await(window as any).__flowIframeWheelPromise;const {scroll}=(window as any).__flowWheelOwner;const stopped=scroll.scrollTop;await new Promise(r=>setTimeout(r,150));return{result,stopped,after:scroll.scrollTop,events:(window as any).__flowIframeWheelEvents,inputs:(window as any).__flowIframeWheelInputs}})
    await page.screenshot({path:path.join(directory,'scale-iframe-wheel-takeover.png')})
    expect(facts.iframeWheel.inputs.some((entry:any)=>entry.trusted&&entry.motion?.status==='running')).toBe(true)
    expect(facts.iframeWheel.result).toBe(false);expect(facts.iframeWheel.after).toBe(facts.iframeWheel.stopped)
  }finally{await writeFile(path.join(directory,'facts-layout-cancel.json'),JSON.stringify(facts,null,2));await server.close()}
})

test('actual Electron try-run uses the same complete viewport for background and interactive HUD',async()=>{
  test.setTimeout(90_000)
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is[string,string]=>typeof entry[1]==='string'&&!/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(entry[0])));delete env.ELECTRON_RUN_AS_NODE
  const app=await electron.launch({cwd:root,args:['.',`--user-data-dir=${path.join(directory,'trial-profile')}`],env:{...env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}})
  const facts:any={errors:[]};const page=await app.firstWindow();page.on('pageerror',error=>facts.errors.push(error.message))
  try{
    await writeFile(path.join(directory,'motion-lab.glx'),createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1100);w.show();w.focus()})
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},directory)
    await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
    await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:'motion-lab.glx',exact:true}).dblclick()
    const frame=page.locator('.course-editor-frame:visible');await expect(frame).toBeVisible();if(await frame.getAttribute('data-editor-mode')!=='deep')await frame.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
    await page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'试运行',exact:true}).click()
    await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('[data-flow-motion-lab]').count())return true;return false}).toBe(true)
    facts.geometry=await page.evaluate(()=>{const under=document.querySelector<HTMLElement>('[data-component-instance="under"]')!,hud=document.querySelector<HTMLElement>('[data-component-instance="hud"]')!,plane=under.closest<HTMLElement>('[data-flow-observation-root]')!;return{under:under.getBoundingClientRect().toJSON(),hud:hud.getBoundingClientRect().toJSON(),viewport:plane.getBoundingClientRect().toJSON()}})
    expect(facts.geometry.under.width).toBeCloseTo(facts.geometry.viewport.width,0);expect(facts.geometry.under.height).toBeCloseTo(facts.geometry.viewport.height,0)
    expect(facts.geometry.hud.width).toBeCloseTo(facts.geometry.viewport.width,0)
    expect(facts.geometry.hud.right).toBeCloseTo(facts.geometry.viewport.right,0)
    expect(facts.geometry.hud.bottom).toBeLessThanOrEqual(facts.geometry.viewport.bottom)
    await(await button(page,'U5')).click();await page.waitForTimeout(120);await page.screenshot({path:path.join(directory,'electron-trial-mid-navigation.png')});await waitIdle(page)
    facts.samples=await samples(page);expect(facts.samples.some((s:any)=>s.motion?.status==='running'&&s.motion.progress>0&&s.motion.progress<1)).toBe(true)
    await page.screenshot({path:path.join(directory,'electron-trial-arrived.png')});expect(facts.errors).toEqual([])
  }finally{await writeFile(path.join(directory,'facts-electron-trial.json'),JSON.stringify(facts,null,2));await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>{});await app.close().catch(()=>{})}
})
