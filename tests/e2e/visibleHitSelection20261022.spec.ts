import { _electron as electron, expect, test, type ElectronApplication, type Page, type Frame } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { createTextComponentData } from '../../src/components/text/data'
import { defaultShapeData } from '../../src/components/shape/data'
const { PNG } = require('pngjs')

const root = path.resolve(__dirname, '../..'), directory = path.join(root, 'output/visible-hit-selection-20261022', `live-${Date.now()}`), workspace = path.join(directory, 'workspace')
const source = `export default { mount(context) {
  const root=context.root;root.dataset.hitlab=context.instance.id;
  root.style.cssText='position:relative;width:280px;height:150px';
  root.innerHTML='<p id="word" style="position:absolute;left:16px;top:12px;margin:0;font:28px sans-serif;color:#101010">Was hidden</p><div id="cover" style="position:absolute;inset:0;background:#fff;pointer-events:none!important"></div><button id="reveal" style="position:absolute;left:16px;bottom:8px">Reveal</button>';
  root.querySelector('#reveal').onclick=()=>root.querySelector('#cover').hidden=true;
  return { update(){},dispose(){root.replaceChildren()} };
} }`
function fixture() {
  const instances: Record<string, any> = { under: { id: 'under', name: 'Underlay', definitionId: 'under', viewportPinned: true, data: {}, frame: { width: 960, height: 640, transform: [1,0,0,1,0,0] } } }
  instances.mixed={id:'mixed',name:'Mixed unpinned Underlay',definitionId:'mixed',data:{},frame:{width:80,height:80,transform:[1,0,0,1,500,320]}}
  instances.pinned={id:'pinned',name:'Pinned pointer',definitionId:'shape',viewportPinned:true,data:defaultShapeData(),frame:{width:100,height:80,transform:[1,0,0,1,700,450]}}
  const surfaces = ['slide','spatial','flow'].map(kind => {
    const back=`back-${kind}`, front=`front-${kind}`
    const frame={ width: 280, height: 150, transform: [1,0,0,1,100,120] }
    instances[back]={ id:back,name:back,definitionId:'text',data:createTextComponentData('Behind native'),frame, ...(kind==='flow'?{flowPlacement:{space:'paper',plane:'overlay'}}:{}) }
    instances[front]={ id:front,name:front,definitionId:'front',data:{},frame, ...(kind==='flow'?{flowPlacement:{space:'paper',plane:'overlay'}}:{}) }
    return { id:kind,kind,title:kind,childIds:[back,front],...(kind==='flow'?{flow:{layout:{toc:'hidden',widthMode:'fluid',edgeToEdge:true,readingWidth:860,wideContentWidth:1100}}}:{designSize:{width:960,height:640}}),...(kind==='spatial'?{spatial:{home:{x:0,y:0,zoom:1},frames:[]}}:{}) }
  })
  return migrateCourseProjectV10({schemaVersion:10,id:'visible-hit-lab',revision:0,title:'Visible hit selection laboratory',background:{color:'#eeeeee'},definitions:{
    text:{id:'text',role:'content',implementation:{kind:'builtin',key:'guoling.text'}},front:{id:'front',title:'Front runtime',role:'content',implementation:{kind:'source',language:'javascript',source}},
    shape:{id:'shape',role:'content',implementation:{kind:'builtin',key:'guoling.shape'}},
    mixed:{id:'mixed',title:'Mixed',role:'content',implementation:{kind:'source',language:'javascript',source:`export default {mount(c){c.root.style.cssText='width:80px;height:80px;background:#a04040';return {update(){},dispose(){}}}}`}},
    under:{id:'under',title:'Underlay',role:'content',implementation:{kind:'source',language:'javascript',source:`export default {mount(c){c.root.style.cssText='width:100%;height:100%;background:#208060';return {update(){},dispose(){}}}}`}}},instances,surfaces,assets:{},global:{underlay:['under','mixed'],overlay:['pinned']}})
}
function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => typeof entry[1] === 'string' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(entry[0])))
  delete env.ELECTRON_RUN_AS_NODE
  return {...env,VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'}
}
async function launch(profile:string) {
  const app=await electron.launch({cwd:root,args:['.',`--user-data-dir=${profile}`],env:environment()}),page=await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1100);w.show();w.focus()})
  await expect(page.getByLabel('切换工作空间',{exact:true})).toBeVisible();return {app,page}
}
async function close(app:ElectronApplication) {
  await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0)}).catch(()=>undefined)
  await app.close().catch(()=>undefined)
}
async function open(app:ElectronApplication,page:Page) {
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:'hit-lab.glx',exact:true}).dblclick()
  const frame=page.locator('.course-editor-frame:visible');await expect(frame).toBeVisible()
  if(await frame.getAttribute('data-editor-mode')!=='deep')await frame.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
  return (await frame.getAttribute('data-document-id'))!
}
async function realm(page:Page,id:string) {
  await expect.poll(async()=>{for(const frame of page.frames())if(await frame.locator(`[data-hitlab="${id}"]`).count())return true;return false}).toBe(true)
  for(const frame of page.frames())if(await frame.locator(`[data-hitlab="${id}"]`).count())return frame
  throw Error(`Realm missing: ${id}`)
}
async function sourcePoint(page:Page,frame:Frame,id:string,selector:string) {
  const local=await frame.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),root=document.getElementById('component-root')!.getBoundingClientRect();return {x:r.x-root.x+r.width/2,y:r.y-root.y+r.height/2,width:root.width,height:root.height}})
  const outer=(await page.locator(`[data-component-instance="${id}"]:visible`).first().boundingBox())!
  return {x:outer.x+local.x*outer.width/local.width,y:outer.y+local.y*outer.height/local.height}
}
test('three Surface clicks stay on the visible front; runtime reveal then permits field editing',async()=>{
  test.setTimeout(120_000);await mkdir(workspace,{recursive:true})
  await writeFile(path.join(workspace,'hit-lab.glx'),createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
  const live=await launch(path.join(directory,'profile')),facts:any={directory,errors:[],surfaces:[]}
  live.page.on('pageerror',error=>facts.errors.push(error.message))
  try{
    const id=await open(live.app,live.page)
    for(const kind of ['slide','spatial','flow']) {
      if(kind!=='slide')await live.page.getByTestId(kind==='flow' ? 'flow-page-flow' : `scene-item-${kind}`).click()
      const sourceFrame=await realm(live.page,`front-${kind}`),word=sourceFrame.locator('#word')
      await expect(sourceFrame.locator('#cover')).toBeVisible()
      const point=await sourcePoint(live.page,sourceFrame,`front-${kind}`,'#word')
      await live.page.mouse.click(point.x,point.y)
      await expect(live.page.getByTestId('canvas-plain-text-editor')).toHaveCount(0)
      await live.page.screenshot({path:path.join(directory,`${kind}-covered.png`)})
      await live.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'试运行',exact:true}).click()
      const running=await realm(live.page,`front-${kind}`)
      await expect.poll(()=>running.evaluate(()=>(window as any).__guolingRuntimeActivity?.playing)).toBe(true)
      await writeFile(path.join(directory,`${kind}-run-debug.json`),JSON.stringify(await running.evaluate(()=>{
        const button=document.getElementById('reveal')!,r=button.getBoundingClientRect();return {sheets:document.adoptedStyleSheets.map(s=>[...s.cssRules].map(r=>r.cssText)),width:innerWidth,height:innerHeight,button:{rect:r.toJSON(),css:getComputedStyle(button).cssText,pointer:getComputedStyle(button).pointerEvents},root:document.getElementById('component-root')!.getAttribute('style'),top:document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2).map(e=>({id:e.id,tag:e.tagName,pointer:getComputedStyle(e).pointerEvents}))}
      }),null,2))
      await live.page.screenshot({path:path.join(directory,`${kind}-run-debug.png`)})
      const revealPoint=await sourcePoint(live.page,running,`front-${kind}`,'#reveal');await live.page.mouse.click(revealPoint.x,revealPoint.y);await expect(running.locator('#cover')).toBeHidden()
      await live.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'编辑',exact:true}).click()
      const revealed=await realm(live.page,`front-${kind}`);await expect(revealed.locator('#cover')).toBeHidden()
      await expect.poll(()=>revealed.evaluate(()=>(window as any).__guolingRuntimeActivity?.playing)).toBe(false)
      const shown=await sourcePoint(live.page,revealed,`front-${kind}`,'#word')
      await live.page.mouse.click(shown.x,shown.y)
      const editor=live.page.getByTestId('canvas-plain-text-editor');await expect(editor).toBeVisible();await expect(editor).toContainText('Was hidden')
      await live.page.screenshot({path:path.join(directory,`${kind}-revealed-edit.png`)})
      await live.page.keyboard.press('Escape')
      await expect(live.page.getByTestId('canvas-plain-text-editor')).toHaveCount(0)
      facts.surfaces.push({kind,coveredNoField:true,runtimeRevealed:true,revealedField:'Was hidden'})
    }
    const mixed=live.page.locator('[data-flow-overlay-id="mixed"]'),pinned=live.page.locator('[data-flow-overlay-id="under"]')
    await writeFile(path.join(directory,'mixed-geometry.json'),JSON.stringify(await mixed.evaluate(element=>{const root=element.closest('[data-flow-observation-root]')!,r=element.getBoundingClientRect();return {box:r.toJSON(),style:element.getAttribute('style'),transform:getComputedStyle(element).transform,root:root.getBoundingClientRect().toJSON(),variable:getComputedStyle(root).getPropertyValue('--flow-observation-transform'),viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio}}}),null,2))
    await live.page.screenshot({path:path.join(directory,'mixed-screen.png')})
    await expect.poll(async()=>{
      const box=(await mixed.boundingBox())!
      const pixel=PNG.sync.read(await live.page.screenshot()), viewport=await live.page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      const x=Math.round((box.x+box.width/2)*pixel.width/viewport.width),y=Math.round((box.y+box.height/2)*pixel.height/viewport.height),index=(y*pixel.width+x)*4
      return facts.mixedUnderlayPixel=[...pixel.data.slice(index,index+3)]
    }).toEqual([160,64,64])
    const before=(await mixed.boundingBox())!,pinnedBefore=(await pinned.boundingBox())!
    await live.page.getByRole('button',{name:'放大画布',exact:true}).click()
    await expect.poll(async()=>(await mixed.boundingBox())!.width).toBeGreaterThan(before.width*1.05)
    expect((await pinned.boundingBox())!.width).toBeCloseTo(pinnedBefore.width,0)
    facts.mixedZoom={before:before.width,after:(await mixed.boundingBox())!.width,pinnedBefore:pinnedBefore.width,pinnedAfter:(await pinned.boundingBox())!.width}
    await live.page.getByTestId('global-layer-entry').click()
    await expect(live.page.getByTestId('global-layer-entry')).toHaveAttribute('aria-pressed','true')
    await expect(live.page.getByTestId('flow-workspace-scroll')).toBeHidden()
    await live.page.locator('[data-component-render="pinned"]').evaluate(element=>element.addEventListener('component-author-hit-test',((event:CustomEvent)=>{event.preventDefault();setTimeout(()=>event.detail.resolve({painted:true,authorKey:null}),120)}) as EventListener))
    const under=(await live.page.locator('[data-flow-overlay-id="pinned"]').boundingBox())!
    await live.page.mouse.click(under.x+under.width/2,under.y+under.height/2)
    await expect(live.page.locator('[data-flow-overlay-id="pinned"]')).toHaveAttribute('style',/outline:.*solid/)
    facts.flowPinnedQuickClick=true
    const saved=await live.app.evaluate(async({app},id)=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),s=await r('./dist-electron/main/workbench/documentHost.js').documentHost().internalAPI.read(id);return {revision:s.revision,dirty:s.dirty}},id)
    facts.document=saved;expect(saved).toEqual({revision:0,dirty:false});expect(facts.errors).toEqual([])
    await writeFile(path.join(directory,'facts.json'),JSON.stringify(facts,null,2))
  }finally{await close(live.app);await writeFile(path.join(directory,'facts-last.json'),JSON.stringify(facts,null,2))}
})
