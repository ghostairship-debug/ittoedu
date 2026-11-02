import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeFlowD5Archive } from '../helpers/flowD5Fixture'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { execFileSync } from 'node:child_process'

const root = resolve(__dirname, '../..')
type NativeTarget = { hwnd:number; processId:number }
function native(action:string,target?:NativeTarget,extra?:string|number) {
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(__dirname,'helpers/g20WindowsImeInput.ps1'),'-Action',action]
  if(target)args.push('-Window',String(target.hwnd),'-ProcessId',String(target.processId))
  if(action==='type')args.push('-Text',String(extra))
  if(action==='restore')args.push('-Previous',String(extra))
  if(action==='candidate'&&extra)args.push('-CapturePath',String(extra))
  const output=execFileSync('powershell.exe',args,{encoding:'utf8',timeout:20000}).trim()
  return output?JSON.parse(output):undefined
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const p = document.querySelector<HTMLElement>('[data-flow-block-id="d5-tail"],[data-compiled-node="d5-tail"]')!
    const object = document.querySelector<HTMLElement>('[data-flow-block-id="d5-widget"],[data-compiled-node="d5-widget"]')!
    const box = object.getBoundingClientRect(), rows = new Map<number, {left: number;right: number}>()
    let leftGlyphs = 0, rightGlyphs = 0, overlappingGlyphs = 0
    const samples: {left?:{x:number;y:number};right?:{x:number;y:number}} = {}
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    for (let node=walker.nextNode() as Text|null;node;node=walker.nextNode() as Text|null) {
      if (!node.data.trim()) continue
      for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.data)) {
        if(!part.segment.trim())continue
        const range=document.createRange();range.setStart(node,part.index);range.setEnd(node,part.index+part.segment.length)
        const r=range.getBoundingClientRect();if(r.bottom<=box.top||r.top>=box.bottom)continue
        const key=Math.round(r.top),row=rows.get(key)??{left:0,right:0};rows.set(key,row)
        if(r.right<=box.left+.3){leftGlyphs++;row.left++;samples.left??={x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}}
        else if(r.left>=box.right-.3){rightGlyphs++;row.right++;samples.right??={x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}}
        else overlappingGlyphs++
      }
    }
    return {leftGlyphs,rightGlyphs,overlappingGlyphs,pairedRows:[...rows.values()].filter(r=>r.left&&r.right).length,
      samples,object:{x:box.x,y:box.y,width:box.width,height:box.height},text:p.textContent,
      gapCount:p.querySelectorAll('[data-flow-bilateral-gap]').length,style:object.getAttribute('style'),
      input:p.closest('[role=textbox]')?.getAttribute('contenteditable')}
  })
}
test('central Flow has real text on both sides through editing, runtime resize and cold reopen', async ({browser},info)=>{
  test.skip(process.platform!=='win32','Actual Windows App')
  test.setTimeout(240000)
  const out=info.outputPath('flow-bilateral'),workspace=join(out,'workspace'),profile=join(out,'profile')
  await fs.mkdir(workspace,{recursive:true});await fs.mkdir(profile,{recursive:true})
  const driver=new CourseV10Driver(),model=driver.load(makeFlowD5Archive())
  if(model.kind!=='course-v10')throw Error('Expected course')
  model.project.instances['d5-widget'].flowLayout={width:'content-width',widthPercent:32,wrap:'both'}
  const name='中央双侧正文.glx',filename=join(workspace,name)
  await fs.writeFile(filename,driver.serialize(model),{flag:'wx'})
  const facts:any={startedAt:new Date().toISOString(),samples:[],checks:{},errors:[]}
  const saveFacts=()=>fs.writeFile(join(out,'result.json'),JSON.stringify(facts,null,2))
  let app:ElectronApplication|undefined,page:Page|undefined,phase='launch'
  const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),VITE_DEV_SERVER_URL:'',COURSEWARE_CLI_DOGFOOD:'',COURSEWARE_E2E_BACKGROUND:'0'};delete env.ELECTRON_RUN_AS_NODE
  const launch=async()=>{
    app=await electron.launch({cwd:root,args:['.','--user-data-dir='+profile],env,timeout:45000})
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>facts.errors.push(e.message))
    page.on('console',message=>{if(message.type()==='error')(facts.consoleErrors??=[]).push(message.text())})
    await app.evaluate(({BrowserWindow,dialog},directory)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,1000);w.show();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]})},workspace)
    await page.getByLabel('切换工作空间',{exact:true}).click();await page.getByRole('button',{name:'选择其他工作空间文件夹…',exact:true}).click()
    await page.getByRole('tree',{name:'工作空间文件'}).getByRole('button',{name,exact:true}).dblclick()
    const editor=page.locator('.course-editor-frame:visible');await expect(editor).toBeVisible()
    const open=editor.getByRole('button',{name:'在编辑器中打开',exact:true});if(await open.count())await open.click()
    const id=await editor.getAttribute('data-document-id');if(!id)throw Error('No document')
    return{id,pid:app.process().pid}
  }
  const close=async()=>{if(app){
    // A failed author-input assertion must preserve its isolated fixture and
    // flush it before graceful close, rather than hanging on a dirty dialog.
    if(page&&!page.isClosed()){
      const snapshots=await page.evaluate(async()=>{const api=window.desktopAPI.documents!;return Promise.all((await api.list()).map(d=>api.read(d.documentId)))})
      await fs.writeFile(join(out,'exit-snapshots.json'),JSON.stringify(snapshots,null,2))
      for(const snapshot of snapshots)if(snapshot.dirty){
        expect(snapshot.binding.kind).toBe('file')
        if(snapshot.binding.kind!=='file'||resolve(snapshot.binding.path)!==resolve(filename))throw Error('Unexpected file owner during fixture cleanup')
        await page.evaluate(id=>window.desktopAPI.documents!.save(id),snapshot.documentId)
      }
    }
    await app.close();app=undefined
  }}
  const stable=async(label:string,bilateral=true)=>{
    let stableSince=0,lastSize=''
    const valid=(g:Awaited<ReturnType<typeof geometry>>)=>g.object.height>1&&g.overlappingGlyphs===0&&(!bilateral||g.pairedRows>=2)
    await expect.poll(async()=>{const g=await geometry(page!),size=JSON.stringify([g.object.width,g.object.height,g.gapCount]);
      if(!valid(g)||size!==lastSize){stableSince=Date.now();lastSize=size;return false}return Date.now()-stableSince>=600
    },{timeout:15000,intervals:[100]}).toBe(true)
    const g=await geometry(page!);expect(valid(g),'Captured evidence must still satisfy geometry, not only an earlier poll').toBe(true)
    facts.samples.push({label,...g});await page!.screenshot({path:join(out,label+'.png')});await saveFacts();return g
  }
  try{
    const first=await launch(),read=()=>page!.evaluate(id=>window.desktopAPI.documents!.read(id),first.id)
    facts.pid=first.pid
    phase='initial-bilateral';let g=await stable('01-initial')
    const baseline=await read();expect(baseline.dirty).toBe(false)
    phase='free-edit-left'
    const p=page!.locator('[data-flow-block-id="d5-tail"]')
    await page!.mouse.dblclick(g.samples.left!.x,g.samples.left!.y);await page!.keyboard.press('ArrowRight');await page!.keyboard.insertText('左侧补充。')
    await expect.poll(async()=>JSON.stringify((await read()).model)).toContain('左侧补充。')
    g=await stable('02-left-edit')
    phase='free-edit-right';await page!.mouse.click(g.samples.right!.x,g.samples.right!.y);await page!.keyboard.press('ArrowRight');await page!.keyboard.press('ArrowLeft');await page!.keyboard.insertText('右侧补充。')
    await expect.poll(async()=>JSON.stringify((await read()).model)).toContain('右侧补充。')
    g=await stable('03-right-edit');facts.checks.freeEditing=true
    phase='cross-side-selection';await page!.mouse.move(g.samples.left!.x,g.samples.left!.y);await page!.mouse.down();await page!.mouse.move(g.samples.right!.x+8,g.samples.right!.y,{steps:10});await page!.mouse.up()
    const selection=await page!.evaluate(()=>getSelection()?.toString()??'');expect(selection.length).toBeGreaterThan(1);expect(g.text).toContain(selection);facts.checks.logicalSelection=true
    phase='history';const beforeUndo=await read();await page!.keyboard.press('Control+z')
    await expect.poll(async()=>JSON.stringify((await read()).model)).not.toContain('右侧补充。');expect(JSON.stringify((await read()).model)).toContain('左侧补充。')
    await page!.keyboard.press('Control+y');await expect.poll(async()=>JSON.stringify((await read()).model)).toContain('右侧补充。')
    const afterRedo=await read(),restored=structuredClone(afterRedo.model)
    if(restored.kind!=='course-v10'||beforeUndo.model.kind!=='course-v10')throw Error('Expected course history')
    expect(afterRedo.revision).toBeGreaterThan(beforeUndo.revision)
    restored.project.revision=beforeUndo.model.project.revision;expect(restored).toEqual(beforeUndo.model)
    facts.checks.sharedHistory=true
    phase='native-ime'
    g=await geometry(page!);await page!.mouse.dblclick(g.samples.left!.x,g.samples.left!.y);await page!.keyboard.press('ArrowRight')
    await page!.evaluate(()=>{const events:{type:string;trusted:boolean;data:string}[]=[];(window as unknown as {flowIme:typeof events}).flowIme=events;for(const type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,event=>events.push({type:event.type,trusted:event.isTrusted,data:(event as CompositionEvent).data}),true)})
    const foreground=native('snapshot'),target=await app!.evaluate(({BrowserWindow})=>({hwnd:Number(BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE()),processId:process.pid}))
    try{
      native('focus',target);g=await geometry(page!);await page!.mouse.click(g.samples.left!.x,g.samples.left!.y);native('type',target,'nihao')
      await expect.poll(()=>page!.evaluate(()=>(window as unknown as {flowIme:{type:string;trusted:boolean}[]}).flowIme.some(e=>e.type==='compositionstart'&&e.trusted))).toBe(true)
      facts.imeCandidate=native('candidate',target,join(out,'native-ime-candidate.png'))
      native('space',target)
      await expect.poll(async()=>JSON.stringify((await read()).model)).toContain('你好')
      facts.imeEvents=await page!.evaluate(()=>(window as unknown as {flowIme:unknown}).flowIme)
      expect(facts.imeEvents.some((e:any)=>e.type==='compositionupdate'&&e.trusted&&e.data==='你好')).toBe(true)
      expect(facts.imeEvents.some((e:any)=>e.type==='compositionend'&&e.data==='你好')).toBe(true)
      // An actual caret move starts a new editing group before testing deletion undo.
      await page!.keyboard.press('ArrowLeft');await page!.keyboard.press('ArrowRight')
      await page!.keyboard.press('Backspace');await expect.poll(async()=>JSON.stringify((await read()).model)).not.toContain('你好')
      await page!.keyboard.press('Control+z');await expect.poll(async()=>JSON.stringify((await read()).model)).toContain('你好')
      await stable('03b-native-ime');facts.checks.nativeIme=true
    }finally{native('restore',target,foreground.foreground)}
    await page!.keyboard.press('Escape')
    phase='width-edit';await page!.locator('[data-flow-block-id="d5-widget"]').click({position:{x:3,y:3}})
    const handle=page!.getByRole('button',{name:'拖动调整正文占宽',exact:true});await handle.focus();await page!.keyboard.press('ArrowRight')
    await expect.poll(async()=>{const s=await read();return s.model.kind==='course-v10'?s.model.project.instances['d5-widget'].flowLayout?.widthPercent:0}).toBe(33)
    await stable('04-width-edit')
    phase='runtime';await page!.getByTestId('course-try-run-chrome').getByRole('button',{name:'试运行',exact:true}).click()
    const frame=page!.frameLocator('[data-flow-block-id="d5-widget"] iframe:visible')
    await expect(frame.getByRole('button',{name:'增长文字',exact:true})).toBeVisible()
    const history=await read(),before=await geometry(page!)
    await frame.getByRole('button',{name:'增长文字',exact:true}).click()
    const grown=await stable('05-grown');expect(grown.object.height).toBeGreaterThan(before.object.height+.5)
    await page!.waitForTimeout(1000)
    const stability=[];for(let i=0;i<9;i++){const s=await geometry(page!);stability.push(s.object.height);await page!.waitForTimeout(250)}
    expect(Math.max(...stability)-Math.min(...stability)).toBeLessThanOrEqual(.5)
    const after=await read();expect({revision:after.revision,undo:after.undoDepth,redo:after.redoDepth}).toEqual({revision:history.revision,undo:history.undoDepth,redo:history.redoDepth})
    facts.runtimeHistory={before:{revision:history.revision,undo:history.undoDepth,redo:history.redoDepth},after:{revision:after.revision,undo:after.undoDepth,redo:after.redoDepth},heights:stability};facts.checks.runtimeHistoryStable=true
    phase='narrow';await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,1000));await stable('06-narrow',false)
    expect((await geometry(page!)).style).not.toContain('--flow-bilateral: 1')
    await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,1000));const wide=await stable('07-wide-again')
    expect(Math.abs(wide.object.height-grown.object.height)).toBeLessThanOrEqual(.5)
    phase='save';await page!.getByTestId('course-try-run-chrome').getByRole('button',{name:'编辑',exact:true}).click()
    const savePoint=(await geometry(page!)).samples.left!;await page!.mouse.click(savePoint.x,savePoint.y);await page!.keyboard.press('Control+s')
    await expect.poll(async()=>(await read()).dirty).toBe(false);const saved=await read();facts.savedRevision=saved.revision
    await close();phase='cold-open';const cold=await launch();expect(cold.pid).not.toBe(first.pid)
    const reopened=await page!.evaluate(id=>window.desktopAPI.documents!.read(id),cold.id);expect(reopened.model).toEqual(saved.model);expect(reopened.dirty).toBe(false)
    facts.bilateral=await stable('08-cold');facts.checks.savedCold=true;facts.coldPid=cold.pid;expect(facts.errors).toEqual([])
    phase='offline-export'
    facts.export=await app!.evaluate(async({app},{id,workspace})=>{
      const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),host=require('./dist-electron/main/workbench/documentHost.js').documentHost(),runId='flow-export-'+Date.now()
      await host.tools.beginRun({runId,actor:'human',documents:[{documentId:id,writable:[{kind:'document'}]}],fileAccess:{permission:'workspace',workspaceRoot:workspace}})
      try{await host.tools.loadToolFamilies(runId,[],['document.export']);const opened=await host.tools.completeOpenedDocument(runId,{documentId:id,writable:true},{selection:'preserve'})
        return await host.tools.execute(runId,'export',{name:'document.export',input:{target:opened.target,format:'html-offline',destination:'central-flow.html'}})
      }finally{await host.tools.stop(runId)}
    },{id:cold.id,workspace})
    expect(facts.export).toMatchObject({kind:'read',data:{status:'written'}})
    const context=await browser.newContext({viewport:{width:1500,height:1000},offline:true}),consumer=await context.newPage()
    consumer.setDefaultTimeout(12000)
    try{
      consumer.on('pageerror',e=>facts.errors.push(e.message));await consumer.goto(pathToFileURL(join(workspace,'central-flow.html')).href)
      const consumerStable=async()=>{await expect.poll(async()=>{const s=await geometry(consumer);return s.object.height>1&&s.pairedRows>=2&&s.overlappingGlyphs===0}).toBe(true);return geometry(consumer)}
      facts.offlineInitial=await consumerStable();await consumer.screenshot({path:join(out,'09-offline.png')})
      let grew=false
      for(const frame of consumer.frames()){const button=frame.getByRole('button',{name:'增长文字',exact:true});if(await button.isVisible().catch(()=>false)){await button.click();grew=true;break}}
      expect(grew).toBe(true);facts.offlineGrown=await consumerStable();expect(facts.offlineGrown.object.height).toBeGreaterThan(facts.offlineInitial.object.height)
      await consumer.screenshot({path:join(out,'10-offline-grown.png')});facts.checks.offlinePlayer=true
    }finally{await context.close()}
    for(let turn=0;turn<2;turn++){await close();phase='repeat-cold-'+turn;const next=await launch();await stable('11-repeat-cold-'+turn)
      const s=await page!.evaluate(id=>window.desktopAPI.documents!.read(id),next.id);expect(s.model).toEqual(saved.model);expect(s.dirty).toBe(false)}
    facts.checks.repeatedCold=true
    facts.status='passed-awaiting-visual-review'
  }catch(error){facts.status='failed';facts.phase=phase;facts.failure=String(error);if(page&&!page.isClosed()){facts.lastGeometry=await geometry(page).catch(()=>null);facts.runtimeDom=await page.locator('[data-flow-block-id="d5-widget"]').evaluate(n=>n.outerHTML).catch(()=>null);facts.visibleText=(await page.locator('body').innerText()).slice(-3000);await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}throw error}
  finally{facts.finishedAt=new Date().toISOString();await saveFacts();await close()}
})

