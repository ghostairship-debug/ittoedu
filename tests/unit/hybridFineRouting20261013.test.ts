// @vitest-environment node
import {expect,it} from 'vitest'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {JSDOM} from 'jsdom'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {compilePublishedScriptModule,compilePublishedWebProgram} from '../../src/core/publish/componentPlatform/compiledScript'
import {compileCoursePlayback} from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import {webProgramRequiresNativeDocument} from '../../src/core/publish/componentPlatform/nativeProgram'
import {InMemoryComponentCompilation} from '../../src/core/components/compilation/InMemoryComponentCompilation'
import {createEsbuildComponentCompiler} from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import {buildPublishedCourseV3} from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import recipe from '../../src/core/course/courseRecipeRuntimeSource'
const output='output/repair-fine-routing-20261013'
const ordinary='<style>#x{color:rgb(20,60,90)}</style><button id="x" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>'
const source=`let mounts=0;export function mount({root,scope,instance,resources}){mounts++;let count=0;root.innerHTML='<button id="x">0</button><output id="mounts"></output>';root.querySelector('#mounts').textContent=String(mounts);const button=root.querySelector('#x');const click=()=>{button.textContent=String(++count);scope.state.set('clicked:'+instance.id,count)};button.addEventListener('click',click);return{update(){},dispose(){button.removeEventListener('click',click)}}}`

it('selects covered local programs from converter facts for every effective version without executing them',async()=>{
 const local=compilePublishedScriptModule(source);expect(local.nativeReasons).toEqual([]);expect(local.factorySource).not.toBe('')
 const preset=compilePublishedScriptModule(recipe);expect(preset.nativeReasons).toEqual([])
 for(const code of [`export function mount({root}){root.innerHTML='<style>.card{height:100vh}</style>'}`,`export function mount({root}){root.style.height='100vh'}`])expect(compilePublishedScriptModule(code).nativeReasons).toContain(code.includes('innerHTML')?'dynamic-markup':'document-style')
 const html=compilePublishedWebProgram({html:ordinary});expect(html.nativeReasons).toEqual([]);expect(webProgramRequiresNativeDocument({html:ordinary},html)).toBe(false)
 // These legal programs have no compile error, but require an environment outside local coverage.
 for(const code of [`export function mount(){return document instanceof Document}`,`export function mount({root}){root.innerHTML=unknownTemplate;return{update(){},dispose(){}}}`,`export function mount(){function dormant(){return new Worker('missing.js')}return{update(){},dispose(){}}}`])expect(compilePublishedScriptModule(code).nativeReasons.length).toBeGreaterThan(0)
 const shell='<iframe srcdoc="&lt;button onclick=&quot;this.textContent=\'1\'&quot;&gt;0&lt;/button&gt;"></iframe>'
 expect(webProgramRequiresNativeDocument({html:shell})).toBe(false)
 expect(webProgramRequiresNativeDocument({html:'<iframe srcdoc="&lt;script&gt;top.document.body.textContent=\'outer\'&lt;/script&gt;"></iframe>'})).toBe(true)
 expect(webProgramRequiresNativeDocument({html:'<iframe srcdoc="&lt;script&gt;parent.document.body.textContent=\'outer\'&lt;/script&gt;"></iframe>'})).toBe(true)
 const project=createBlankCourseProjectV10('routing versions');project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.web'}};project.instances.web={id:'web',definitionId:'web',data:{html:'<p>static</p>'}};project.surfaces[0].childIds=['web'];project.surfaces[0].presentation={initialStateId:'base',states:[{id:'base',title:'base',overrides:{}},{id:'local',title:'local',overrides:{web:{data:{html:ordinary}}}},{id:'native',title:'native',overrides:{web:{data:{html:'<script>function dormant(){document.write("full parser")}</script>'}}}}]}
 const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())})
 const document=new JSDOM('<!doctype html>').window.document,before=structuredClone(published.payload)
 const artifact=await compileCoursePlayback(published.payload,{document,renderBuiltin:async()=>''});expect(published.payload).toEqual(before);expect(artifact.webPrograms.web.map(value=>Boolean(value.program.nativeData))).toEqual([false,false,true]);expect(artifact.diagnostics).toEqual([])
 const viewport={...published.payload,definitions:{...published.payload.definitions,source:{id:'source',role:'content',implementation:{kind:'source',language:'javascript',source,compiled:{code:source,css:'.card{width:80vw}'}}}}} as any
 const withSource=await compileCoursePlayback(viewport,{document,renderBuiltin:async()=>''});expect(withSource.sourceFactories['definition:source']).toBeUndefined();expect(withSource.nativeSources?.['definition:source']).toBeDefined()
 const cold=JSON.parse(await readFile('output/repair-playback/hybrid-publish/final/cold-source.json','utf8'))
 for(const id of ['phaser','pixi','three'])expect(webProgramRequiresNativeDocument(cold.project.instances[id].data)).toBe(true)
 await mkdir(output,{recursive:true});await writeFile(`${output}/routing-facts.json`,JSON.stringify({versions:artifact.webPrograms.web.map(value=>Boolean(value.program.nativeData)),source:local.nativeReasons,preset:preset.nativeReasons,frameworks:'original cold rev14: Phaser/Pixi/Three select native',independentChild:'one native child in extracted parent; top-coupled child native parent'},null,2))
 document.defaultView?.close()
})

it('runs two local Web and Source instances plus a closed module in the real compiled player with private initialization',async()=>{
 const project=createBlankCourseProjectV10('direct isolation');project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.web'}};project.definitions.source={id:'source',role:'content',implementation:{kind:'source',language:'javascript',source}}
 for(const [id,kind,x,y]of [['web-a','web',0,0],['web-b','web',320,0],['source-a','source',0,210],['source-b','source',320,210],['module','web',640,0]] as const){project.instances[id]={id,definitionId:kind,data:kind==='web'?{html:ordinary}:{},frame:{width:300,height:180,transform:[1,0,0,1,x,y]}};project.surfaces[0].childIds.push(id)}
 project.instances.module.data={html:'<button id="x">0</button><script type="module" src="./main.js"></script>',modules:{'main.js':`import {next} from './value.js';document.getElementById('x').onclick=()=>document.getElementById('x').textContent=String(next());`,'value.js':'let count=0;export function next(){return ++count}'}}
 const before=structuredClone(project),published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())});expect(project).toEqual(before)
 const document=new JSDOM('<!doctype html>').window.document,artifact=await compileCoursePlayback(published.payload,{document,renderBuiltin:async()=>{throw Error('unexpected static renderer')}});document.defaultView?.close()
 expect(artifact.diagnostics).toEqual([]);expect(Object.keys(artifact.sourceFactories)).toEqual(['definition:source']);expect(artifact.nativeSources).toEqual({});expect(Object.values(artifact.webPrograms).flat().every(entry=>!entry.program.nativeData)).toBe(true)
 const bundle=await build({stdin:{contents:"export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'FineRouting',platform:'browser',target:'es2022'})
 const browser=await chromium.launch({headless:true});const actual:any={carrier:'actual Main InMemory compiler/publisher -> current compiledPlayer source (output-only esbuild) -> Chromium',errors:[],reports:[],network:[],routes:{web:'direct',source:'direct',module:'direct'}}
 try{const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(4000);page.on('pageerror',error=>actual.errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))actual.network.push(request.url())});await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(async serialized=>{const artifact=JSON.parse(serialized);(window as any).player=await(window as any).FineRouting.mountCompiledCourse(artifact,document.getElementById('root'),{report:(message:string)=>((window as any).reports??=[]).push(message)})},JSON.stringify(artifact))
  const button=(id:string)=>page.locator(`[data-compiled-runtime-root="${id}"] #x`)
  for(const id of ['web-a','web-b','source-a','source-b','module'])await expect.poll(()=>button(id).textContent()).toBe('0')
  await button('web-a').click();await button('source-a').click();await button('module').click()
  actual.counts=Object.fromEntries(await Promise.all(['web-a','web-b','source-a','source-b','module'].map(async id=>[id,await button(id).textContent()])));expect(actual.counts).toEqual({'web-a':'1','web-b':'0','source-a':'1','source-b':'0',module:'1'})
  actual.mounts=await page.locator('[data-compiled-runtime-root^="source-"] #mounts').allTextContents();expect(actual.mounts).toEqual(['1','1']);actual.frames=await page.locator('iframe').count();expect(actual.frames).toBe(0)
  actual.colors=await Promise.all(['web-a','web-b'].map(id=>button(id).evaluate(node=>getComputedStyle(node).color)));expect(actual.colors).toEqual(['rgb(20, 60, 90)','rgb(20, 60, 90)']);actual.reports=await page.evaluate(()=>(window as any).reports??[]);expect(actual.reports).toEqual([]);expect(actual.errors).toEqual([]);expect(actual.network).toEqual([])
  await page.screenshot({path:`${output}/direct-isolation.png`});await page.evaluate(()=>(window as any).player.dispose());actual.disposed=await page.locator('#root').evaluate(node=>node.childElementCount);expect(actual.disposed).toBe(0);actual.pass=true
 }catch(error){actual.failure=String(error);throw error}finally{await writeFile(`${output}/actual.json`,JSON.stringify(actual,null,2));await browser.close()}
},30000)

it('retires pending direct Source initialization and routes programmatic DOM URLs before native clicks',async()=>{
 const javascriptUrl='javascript:void(document.body.dataset.outsideWrite="x")'
 const urlSource=`export function mount({root}){root.innerHTML='<a id="url">native URL</a>';root.querySelector('#url').href=${JSON.stringify(javascriptUrl)};return{update(){},dispose(){}}}`
 for(const operation of [`a.href=${JSON.stringify(javascriptUrl)}`,`a.formAction=${JSON.stringify(javascriptUrl)}`,`a.action=nextUrl`,`a.setAttribute('href',${JSON.stringify(javascriptUrl)})`,`a.setAttribute('action',nextUrl)`])expect(compilePublishedScriptModule(`export function mount({root}){const a=root.querySelector('a');${operation};return{update(){},dispose(){}}}`).nativeReasons).toContain('dynamic-navigation-url')
 const pendingFactory=`await new Promise(resolve=>setTimeout(()=>resolve(),10000));export function mount(){return{update(){},dispose(){}}}`
 const pendingTimer=`export async function mount({scope}){scope.state.set('timerEntered',true);await new Promise(resolve=>setTimeout(()=>resolve(),10000));return{update(){},dispose(){}}}`
 const lateMount=`export function mount({root,scope}){root.innerHTML='<p id="late">pending</p>';scope.state.set('lateEntered',true);return new Promise(resolve=>{root.finish=()=>resolve({update(){},dispose(){root.dataset.disposals=String(Number(root.dataset.disposals||0)+1)}})})}`
 const project=createBlankCourseProjectV10('retirement and URL'),initial=project.surfaces[0].id
 project.definitions.web={id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.web'}}
 project.instances.healthy={id:'healthy',definitionId:'web',data:{html:ordinary},frame:{width:300,height:180,transform:[1,0,0,1,0,0]}}
 project.surfaces[0].childIds=['healthy','url'];project.surfaces.push({id:'pending',kind:'slide',title:'pending',childIds:['factory','timer','late'],designSize:{width:1280,height:720}})
 for(const [id,code]of Object.entries({url:urlSource,factory:pendingFactory,timer:pendingTimer,late:lateMount})){project.definitions[id]={id,role:'content',implementation:{kind:'source',language:'javascript',source:code}};project.instances[id]={id,definitionId:id,data:{},frame:{width:300,height:180,transform:[1,0,0,1,id==='url'?320:0,id==='late'?210:0]}}}
 const published=await buildPublishedCourseV3({project,assetBytes:{}},{compilation:new InMemoryComponentCompilation(createEsbuildComponentCompiler())}),document=new JSDOM('<!doctype html>').window.document
 const artifact=await compileCoursePlayback(published.payload,{document,renderBuiltin:async()=>''});document.defaultView?.close()
 expect(Object.keys(artifact.nativeSources??{})).toEqual(['definition:url']);expect(Object.keys(artifact.sourceFactories).sort()).toEqual(['definition:factory','definition:late','definition:timer'])
 const bundle=await build({stdin:{contents:"export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'FineRouting',platform:'browser',target:'es2022'})
 const browser=await chromium.launch({headless:true}),actual:any={carrier:'same actual Main compiler/cache/publisher/current compiledPlayer source -> Chromium',errors:[],network:[],initialSurface:initial}
 try{const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(4000);page.on('pageerror',error=>actual.errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))actual.network.push(request.url())})
  await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><div id="root"></div>')
  // Observe actual detached mount roots; this does not inject author state or resolve its Promise.
  await page.evaluate(()=>{(window as any).observedShadows=[];const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const shadow=original.call(this,options);(window as any).observedShadows.push(shadow);return shadow}})
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(async serialized=>{(window as any).player=await(window as any).FineRouting.mountCompiledCourse(JSON.parse(serialized),document.getElementById('root'),{report:(message:string)=>((window as any).reports??=[]).push(message)})},JSON.stringify(artifact))
  const owner=await page.locator('[data-compiled-runtime-root="url"] iframe').elementHandle(),frame=await owner!.contentFrame();await frame!.locator('#url').click()
  actual.url=await page.evaluate(()=>({outerWrite:document.body.dataset.outsideWrite??null,frames:document.querySelectorAll('iframe').length}));actual.nativeWrite=await frame!.evaluate(()=>document.body.dataset.outsideWrite??null);expect(actual.url.outerWrite).toBeNull();expect(actual.url.frames).toBe(1)
  await page.locator('[data-compiled-runtime-root="healthy"] #x').click();expect(await page.locator('[data-compiled-runtime-root="healthy"] #x').textContent()).toBe('1')
  await page.evaluate(()=>{(window as any).enterPending=(window as any).player.go('pending').catch((error:Error)=>error.name)})
  await expect.poll(()=>page.evaluate(()=>[(window as any).player.runtime.getState('timerEntered'),(window as any).player.runtime.getState('lateEntered')])).toEqual([true,true])
  await page.evaluate(()=>{(window as any).lateRoot=(window as any).observedShadows.find((shadow:ShadowRoot)=>shadow.querySelector('#late')).querySelector('body')})
  actual.pending=await page.evaluate(()=>({shadows:(window as any).observedShadows.length,lateDisposals:(window as any).lateRoot.dataset.disposals??'0'}));expect(actual.pending.lateDisposals).toBe('0')
  const disposalStarted=performance.now();await page.evaluate(async()=>{await(window as any).player.dispose();await(window as any).enterPending});actual.retirementMs=performance.now()-disposalStarted
  actual.disposed=await page.locator('#root').evaluate(node=>node.childElementCount);expect(actual.disposed).toBe(0)
  await page.evaluate(()=>{(window as any).lateRoot.finish()});await expect.poll(()=>page.evaluate(()=>(window as any).lateRoot.dataset.disposals)).toBe('1')
  actual.lateDisposals=await page.evaluate(()=>(window as any).lateRoot.dataset.disposals);actual.reports=await page.evaluate(()=>(window as any).reports??[]);expect(actual.reports).toEqual([]);expect(actual.errors).toEqual([]);expect(actual.network).toEqual([]);actual.pass=true
 }catch(error){actual.failure=String(error);throw error}finally{await writeFile(`${output}/review-fixes/actual.json`,JSON.stringify(actual,null,2));await browser.close()}
},30000)
