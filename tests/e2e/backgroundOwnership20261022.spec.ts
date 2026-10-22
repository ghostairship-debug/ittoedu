import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { createTextComponentData } from '../../src/components/text/data'
const { PNG } = require('pngjs')
const root = path.resolve(__dirname, '../..'), base = path.join(root, 'output/background-unification-20261022')
const directory = path.join(base, process.env.BACKGROUND_LAB_RUN ?? `live-${Date.now()}`), workspace = path.join(directory, 'workspace')
const green = [32, 128, 96], blue = [48, 80, 160]
const runtimeSource = `export default { mount(context) {
  const root=context.root; root.dataset.backgroundLabRuntime='';root.style.cssText='width:100%;height:100%;background:rgb(32,128,96);pointer-events:none';
  const dot=document.createElement('div');dot.style.cssText='position:absolute;top:12px;width:24px;height:24px;background:#ffe070;border-radius:50%';root.append(dot);
  let tick=0; const paint=()=>{root.dataset.tick=String(++tick);dot.style.left=(tick%120)+'px'};paint();const timer=setInterval(paint,40);
  return { update(){}, dispose(){clearInterval(timer);root.replaceChildren()} };
} }`
function fixture() {
  const local = createTextComponentData('Native object background'); local.appearance.backgroundColor = '#ff9900'; local.appearance.backgroundOpacity = 1
  return migrateCourseProjectV10({ schemaVersion: 10, id: 'background-lab', revision: 0, title: 'Background ownership laboratory',
    background: { color: '#ddeeff' },
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      runtime: { id: 'runtime', role: 'content', implementation: { kind: 'source', language: 'javascript', source: runtimeSource } } },
    instances: { under: { id: 'under', definitionId: 'runtime', data: {}, frame: { width: 1600, height: 1400, transform: [1,0,0,1,0,0] } },
      body: { id: 'body', definitionId: 'text', data: createTextComponentData('Transparent Flow foreground — background laboratory') },
      local: { id: 'local', definitionId: 'text', data: local, frame: { width: 200, height: 80, transform: [1,0,0,1,40,140] }, flowPlacement: { space: 'paper', plane: 'overlay' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow sample', childIds: ['body','local'], flow: { layout: { toc: 'hidden', widthMode: 'fluid', edgeToEdge: true, readingWidth: 860, wideContentWidth: 1100 } } },
      { id: 'slide', kind: 'slide', title: 'Slide sample', childIds: [], designSize: { width: 1280, height: 720 }, background: { mode: 'own', color: '#3050a0' } },
      { id: 'spatial', kind: 'spatial', title: 'Spatial sample', childIds: [], designSize: { width: 1280, height: 720 }, background: { mode: 'own', color: '#3050a0' }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }],
    assets: {}, global: { underlay: ['under'], overlay: [] } })
}
function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => typeof entry[1] === 'string' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(entry[0])))
  delete env.ELECTRON_RUN_AS_NODE
  return { ...env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
}
async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: environment() })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  await app.evaluate(({BrowserWindow}) => { const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,1100);w.show();w.focus() })
  await expect(page.getByLabel('切换工作空间',{exact:true})).toBeVisible(); return {app,page}
}
async function close(app: ElectronApplication) {
  await app.evaluate(({app,BrowserWindow}) => { BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(0) }).catch(()=>undefined)
  await app.close().catch(()=>undefined)
}
async function open(app:ElectronApplication,page:Page,filename:string) {
  await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace)
  await page.getByLabel('切换工作空间',{exact:true}).click()
  await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
  await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name:filename,exact:true}).dblclick()
  const frame=page.locator('.course-editor-frame:visible');await expect(frame).toBeVisible()
  if(await frame.getAttribute('data-editor-mode')!=='deep')await frame.getByRole('button',{name:'在编辑器中打开',exact:true}).click()
  return (await frame.getAttribute('data-document-id'))!
}
async function snapshot(app:ElectronApplication,id:string) {
  return app.evaluate(async({app},id)=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),s=await r('./dist-electron/main/workbench/documentHost.js').documentHost().internalAPI.read(id);return {revision:s.revision,dirty:s.dirty,undoDepth:s.undoDepth,project:s.model.project}},id)
}
async function history(app:ElectronApplication,id:string,type:'undo'|'redo') {
  return app.evaluate(async({app},{id,type})=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),host=r('./dist-electron/main/workbench/documentHost.js').documentHost(),s=await host.internalAPI.read(id);return host.internalAPI.dispatch({documentId:id,epoch:s.epoch,baseRevision:s.revision,operationId:`bg-${type}-${Date.now()}`,actor:'human',mutation:{type}})}, {id,type})
}
async function pixel(page:Page,selector:string,dx=420,dy=300) {
  const box=await page.locator(selector).boundingBox();if(!box)throw Error(`Missing ${selector}`)
  const x=Math.round(box.x+Math.min(dx,box.width/2)),y=Math.round(box.y+Math.min(dy,box.height/2))
  const png=PNG.sync.read(await page.screenshot({clip:{x,y,width:1,height:1}}));return [...png.data.slice(0,3)]
}
async function animated(page:Page) {
  await expect.poll(async()=>{for(const f of page.frames())if(await f.locator('[data-background-lab-runtime]').count())return true;return false}).toBe(true)
  let ticks:string[]=[]
  for(const f of page.frames()){const node=f.locator('[data-background-lab-runtime]');if(await node.count()){const first=await node.getAttribute('data-tick');await expect.poll(()=>node.getAttribute('data-tick')).not.toBe(first);ticks=[first!, (await node.getAttribute('data-tick'))!]}}
  expect(ticks).toHaveLength(2);return ticks
}
async function exportHtml(app:ElectronApplication,id:string) {
  return app.evaluate(async({app},{id,workspace})=>{const r=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`),host=r('./dist-electron/main/workbench/documentHost.js').documentHost(),runId=`background-export-${Date.now()}`;
    await host.tools.beginRun({runId,actor:'human',documents:[{documentId:id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:workspace}})
    await host.tools.loadToolFamilies(runId,['build']);const opened=await host.tools.completeOpenedDocument(runId,{documentId:id,writable:true},{selection:'preserve'})
    const result=await host.tools.execute(runId,'offline',{name:'document.export',input:{target:opened.target,format:'html-offline',destination:'background-offline.html'}});await host.tools.stop(runId);return result
  },{id,workspace})
}

test('real background editor history save cold open runtime and official offline HTML',async()=>{
  test.setTimeout(180_000);await mkdir(workspace,{recursive:true})
  await writeFile(path.join(workspace,'background-lab.glx'),createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
  let warm:Awaited<ReturnType<typeof launch>>|undefined,cold:Awaited<ReturnType<typeof launch>>|undefined
  const facts:any={directory,errors:[]};
  try {
    warm=await launch(path.join(directory,'warm-profile'));warm.page.on('pageerror',error=>facts.errors.push(error.message))
    const id=await open(warm.app,warm.page,'background-lab.glx');await expect(warm.page.getByTestId('flow-paper')).toBeVisible()
    const alphaCapture = await warm.page.evaluate(async (textData) => {
      const published: any = { schemaVersion: 4, id: 'alpha-capture', title: 'Alpha capture', background: { color: 'transparent' },
        definitions: { container: { id: 'container', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } } },
        instances: { alpha: { id: 'alpha', definitionId: 'container', data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 160, height: 120 },
          background: { mode: 'own', paint: { layers: [{ style: { 'background-color': 'rgba(200,100,50,0.5)' }, resourceBindings: {} }] } } } } },
        rootIds: ['alpha'], entry: { rootInstanceId: 'alpha' }, global: { underlay: [], overlay: [] }, assets: {} }
      const surface = await window.desktopAPI.captureAuthoringObservation!({ kind: 'published', published, surfaceId: 'alpha', staticExport: true })
      published.background = { color: '#ff0000' }; published.instances.alpha.container.background = { mode: 'own', color: '#0000ff' }
      published.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
      published.instances.alpha.childIds = ['text']; published.instances.text = { id: 'text', definitionId: 'text', data: textData,
        frame: { width: 160, height: 120, transform: [1,0,0,1,0,0] } }
      const instance = await window.desktopAPI.captureAuthoringObservation!({ kind: 'published', published, surfaceId: 'alpha', instanceId: 'text', staticExport: true })
      return { surface, instance }
    }, createTextComponentData('Local capture'))
    const alphaPng=PNG.sync.read(Buffer.from(alphaCapture.surface.dataUrl.split(',')[1], 'base64')), alphaIndex=(60*alphaPng.width+80)*4
    facts.captureAlpha=[...alphaPng.data.slice(alphaIndex,alphaIndex+4)];expect(facts.captureAlpha[3]).toBeCloseTo(128, -1)
    await writeFile(path.join(directory,'surface-alpha.png'),Buffer.from(alphaCapture.surface.dataUrl.split(',')[1],'base64'))
    const localPng=PNG.sync.read(Buffer.from(alphaCapture.instance.dataUrl.split(',')[1], 'base64')),localIndex=(100*localPng.width+140)*4
    facts.localCaptureAlpha=[...localPng.data.slice(localIndex,localIndex+4)];expect(facts.localCaptureAlpha[3]).toBe(0)
    facts.initialTicks=await animated(warm.page)
    await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(green)
    facts.inheritPixel=await pixel(warm.page,'[data-testid="flow-paper"]')
    await expect(warm.page.getByTestId('flow-paper').locator(':scope > [data-component-background-paint]')).toHaveCount(0)
    await warm.page.getByRole('button',{name:'页面属性',exact:true}).click()
    const panel=warm.page.getByTestId('flow-surface-background-properties');await expect(panel).toBeVisible()
    await panel.getByLabel('背景来源').selectOption('own')
    await expect.poll(async()=>(await snapshot(warm!.app,id)).project.instances.flow.container.background.mode).toBe('own')
    await warm.page.screenshot({path:path.join(directory,'after-mode.png')})
    facts.afterModeText=await warm.page.locator('body').innerText()
    const color=panel.locator('input[id$="-text"]');await color.fill('#3050a0');await color.press('Enter')
    await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(blue)
    facts.ownPixel=await pixel(warm.page,'[data-testid="flow-paper"]');facts.own=await snapshot(warm.app,id)
    await warm.page.screenshot({path:path.join(directory,'editor-own.png')})
    await panel.getByTestId('flow-surface-background-properties-transparent').click()
    await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(green)
    await history(warm.app,id,'undo');await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(blue)
    await history(warm.app,id,'redo');await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(green)
    await panel.getByLabel('背景来源').selectOption('inherit');facts.final=await snapshot(warm.app,id)
    expect(facts.final.project.instances.flow.container.background.mode).toBe('inherit')
    await warm.page.screenshot({path:path.join(directory,'editor-inherit.png')})
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'试运行',exact:true}).click()
    facts.trialTicks=await animated(warm.page)
    await expect.poll(()=>pixel(warm!.page,'[data-testid="flow-paper"]')).toEqual(green)
    await warm.page.getByRole('group',{name:'画布模式',exact:true}).getByRole('button',{name:'编辑',exact:true}).click()
    const saved=path.join(workspace,'background-saved.glx')
    await warm.app.evaluate(({dialog},filename)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:filename})},saved)
    await warm.page.getByRole('button',{name:'另存为',exact:true}).click()
    await expect.poll(async()=>(await snapshot(warm!.app,id)).dirty).toBe(false)
    facts.saved=await snapshot(warm.app,id);await close(warm.app);warm=undefined
    cold=await launch(path.join(directory,'cold-profile'));cold.page.on('pageerror',error=>facts.errors.push(error.message))
    const coldId=await open(cold.app,cold.page,'background-saved.glx');facts.cold=await snapshot(cold.app,coldId)
    expect(facts.cold.dirty).toBe(false);expect(facts.cold.project).toEqual(facts.saved.project)
    facts.coldTicks=await animated(cold.page);await expect.poll(()=>pixel(cold!.page,'[data-testid="flow-paper"]')).toEqual(green)
    await cold.page.screenshot({path:path.join(directory,'cold-inherit.png')})
    facts.export=await exportHtml(cold.app,coldId);expect(facts.export).toMatchObject({kind:'read',data:{status:'written',format:'html-offline'}})
    await close(cold.app);cold=undefined
    const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:900},offline:true}),page=await context.newPage()
    page.on('pageerror',error=>facts.errors.push(error.message));await page.goto(pathToFileURL(path.join(workspace,'background-offline.html')).href)
    facts.offlineTicks=await animated(page)
    await expect.poll(()=>pixel(page,'[data-compiled-flow-paper]')).toEqual(green)
    facts.offlinePixel=await pixel(page,'[data-compiled-flow-paper]')
    await expect(page.locator('[data-compiled-flow-paper] > [data-component-background-paint]')).toHaveCount(0)
    await page.screenshot({path:path.join(directory,'offline-inherit.png')})
    await browser.close();expect(facts.errors).toEqual([])
  }finally{if(warm)await close(warm.app);if(cold)await close(cold.app);await writeFile(path.join(directory,'facts.json'),JSON.stringify(facts,null,2));await writeFile(path.join(base,'latest-live.txt'),directory)}
})

test('three Surface editors retain independent cover and restore live Underlay through transparency',async()=>{
  test.setTimeout(100_000);await mkdir(workspace,{recursive:true})
  await writeFile(path.join(workspace,'three-surfaces.glx'),createCourseProjectV10Archive({project:fixture(),resources:{assets:{},components:{}}}))
  const live=await launch(path.join(directory,'three-surface-profile')),facts:any={errors:[]}
  live.page.on('pageerror',error=>facts.errors.push(error.message))
  try{
    const id=await open(live.app,live.page,'three-surfaces.glx')
    for(const item of [{id:'slide',name:/^Slide sample/,panel:'scene-background-properties',viewport:'.canvas-stage-stack'},
      {id:'spatial',name:'Spatial sample',panel:'spatial-surface-background-properties',viewport:'[data-testid="spatial-world-stage"]'}]){
      await live.page.getByTestId('scene-item-'+item.id).click()
      await expect.poll(()=>pixel(live.page,item.viewport)).toEqual(blue)
      facts[item.id]={own:await pixel(live.page,item.viewport)}
      await live.page.getByRole('button',{name:'页面属性',exact:true}).click()
      const panel=live.page.getByTestId(item.panel);await expect(panel).toBeVisible()
      await panel.getByTestId(item.panel+'-transparent').click()
      await expect.poll(()=>pixel(live.page,item.viewport)).toEqual(green)
      facts[item.id].transparent=await pixel(live.page,item.viewport);facts[item.id].ticks=await animated(live.page)
      await history(live.app,id,'undo');await expect.poll(()=>pixel(live.page,item.viewport)).toEqual(blue)
      await history(live.app,id,'redo');await expect.poll(()=>pixel(live.page,item.viewport)).toEqual(green)
      await panel.getByLabel('背景来源').selectOption('inherit');await expect.poll(()=>pixel(live.page,item.viewport)).toEqual(green)
      await live.page.screenshot({path:path.join(directory,item.id+'-transparent.png')})
    }
    expect(facts.errors).toEqual([])
  }finally{await close(live.app);await writeFile(path.join(directory,'facts-three-surfaces.json'),JSON.stringify(facts,null,2));await writeFile(path.join(base,'latest-three-surfaces.txt'),directory)}
})

