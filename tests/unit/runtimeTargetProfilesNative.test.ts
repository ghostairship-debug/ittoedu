// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('keeps native form/CSS editable with small mount/update targets, upgrades before content and retains Source cross-page reads/actions', async () => {
  const formHtml = await readFile('tests/fixtures/component-platform/target-profiles/form.html', 'utf8')
  const bundle = await build({ stdin: { contents: `
    export { prepareSandboxComponent } from './src/renderer/components/SandboxComponentImplementation';
    export { ComponentPlatformRuntime } from './src/player/components/ComponentPlatformRuntime';
    export { webContentRealmSource } from './src/components/web/contentRealmImplementation';
    export { mountPublishedCourseV3 } from './src/player/componentPlatform/publishedPlayer';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'TargetProfileProbe', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text : '<!doctype html><div id="form" style="width:800px;height:600px"></div><div id="upgrade"></div><div id="player" style="width:800px;height:600px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing isolated fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'runtime-target-profiles-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory,'profile'))});
      app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    const nativeEnv: Record<string,string> = { ...Object.fromEntries(Object.entries(process.env)
      .filter(([key,value])=>key!=='ELECTRON_RUN_AS_NODE'&&value!==undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 5000, env: nativeEnv })
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => Boolean((window as any).TargetProfileProbe), undefined, { timeout: 5000 })
    const initial = await page.evaluate(async html => {
      const api = (window as any).TargetProfileProbe, messages: any[] = [], profiles: string[] = []
      const NativeChannel = MessageChannel
      ;(window as any).MessageChannel = class {
        port1: MessagePort; port2: MessagePort
        constructor() {
          const channel = new NativeChannel(); this.port1 = channel.port1; this.port2 = channel.port2
          const send = this.port1.postMessage.bind(this.port1)
          this.port1.postMessage = (message: any, ...rest: any[]) => {
            if (['mount','update'].includes(message.type)) messages.push({ type:message.type,id:message.instance.id,
              targets:structuredClone(message.targets), bytes:new TextEncoder().encode(JSON.stringify(message.targets)).length })
            send(message, ...rest as [any])
          }
        }
      }
      const instance = { id:'form',definitionId:'web',data:{html},frame:{width:800,height:600,transform:[1,0,0,1,0,0]} }
      const project = {schemaVersion:10,id:'target-profile-project',revision:0,title:'Full title',
        definitions:{web:{id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.web'}}},
        instances:{form:instance,unvisited:{id:'unvisited',definitionId:'web',data:{html:'<p>Untouched</p>',sentinel:'unvisited-data'}}},
        surfaces:[{id:'page',kind:'slide',title:'Page',childIds:['form']},{id:'unvisited-page',kind:'slide',title:'Unvisited page',childIds:['unvisited']}],
        global:{underlay:[],overlay:[]},assets:{}}
      const world = new api.ComponentPlatformRuntime('profiles-native',{mode:'edit'})
      await world.sync(project,{assets:{},components:{}})
      const target = world.target.bind(world);let targetReads=0
      world.target=(reference:any)=>{targetReads++;return target(reference)}
      const controller=new AbortController(),cleanups:Array<()=>void>=[]
      const scope={runScopeId:'direct',instanceId:'form',generation:1,signal:controller.signal,isActive:()=>!controller.signal.aborted,
        cleanup:(fn:()=>void)=>cleanups.push(fn),target,events:{emit(){},subscribe:()=>()=>{}},state:{get(){},set(){},subscribe:()=>()=>{}}}
      const prepared=await api.prepareSandboxComponent({format:'esm',code:api.webContentRealmSource(),css:'',diagnostics:[]},controller.signal,
        {builtinKey:'guoling.web',htmlAuthoring:true,state:()=>({}),targets:(profile:string)=>{profiles.push(profile);return world.targetSnapshots(profile)}})
      const mounted=await prepared.implementation.mount({root:document.getElementById('form'),instance,scope})
      ;(window as any).__profiles={api,world,project,instance,controller,cleanups,prepared,mounted,scope,messages,profiles,targetReads:()=>targetReads}
      return {profiles,messages,reads:targetReads}
    }, formHtml)
    expect(initial.profiles).toEqual(['references']);expect(initial.reads).toBe(0)
    expect(initial.messages[0].targets.every((target:any)=>!Object.hasOwn(target,'value'))).toBe(true)
    const form = page.frameLocator('#form iframe')
    expect(await form.locator('.answer').isVisible()).toBe(false)
    await form.locator('label[for="pg4rOn"]').click();expect(await form.locator('.answer').isVisible()).toBe(true)
    await form.locator('button[type="reset"]').click();expect(await form.locator('.answer').isVisible()).toBe(false)
    const updated=await page.evaluate(async()=>{const q=(window as any).__profiles
      q.instance={...q.instance,data:{...q.instance.data,css:'.answer{background:rgb(224,255,224)}'}}
      await q.mounted.update(q.instance)
      return {profiles:q.profiles,messages:q.messages,reads:q.targetReads()}
    })
    expect(updated.profiles).toEqual(['references','references']);expect(updated.reads).toBe(0)
    expect(updated.messages.every((message:any)=>message.targets.every((target:any)=>!Object.hasOwn(target,'value')))).toBe(true)
    await form.locator('label[for="pg4rOn"]').click();expect(await form.locator('.answer').textContent()).toBe('总电压为 6 V')
    expect(await form.locator('.answer').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(224, 255, 224)')
    await form.locator('button[type="reset"]').click();expect(await form.locator('.answer').isVisible()).toBe(false)

    const upgrade=await page.evaluate(async()=>{const q=(window as any).__profiles,seen:string[]=[]
      const author={id:'upgrade',definitionId:'web',data:{html:'<p>Static author data</p>'}}
      const prepared=await q.api.prepareSandboxComponent({format:'esm',css:'',diagnostics:[],code:`export default {mount({root,scope}){
        root.textContent='mounted';return {update(){root.textContent=scope.target({kind:'project'}).read()?.title??'missing-full'},dispose(){}}}}`},q.controller.signal,
        {builtinKey:'guoling.web',state:()=>({}),targets:(profile:string)=>{seen.push(profile);return q.world.targetSnapshots(profile)},
          instance:(instance:any)=>({...instance,data:{...instance.data,html:instance.data.phase==='execute'?'<p onclick="answer()">Projected execution</p>':'<p>Static projection</p>'}})})
      const mounted=await prepared.implementation.mount({root:document.getElementById('upgrade'),instance:author,scope:{...q.scope,instanceId:'upgrade',generation:2}})
      const realm=document.querySelector<HTMLIFrameElement>('#upgrade iframe')!.contentWindow
      await mounted.update({...author,data:{...author.data,phase:'execute'}})
      const fullBeforeExecution=document.querySelector<HTMLIFrameElement>('#upgrade iframe')!.contentWindow===realm
      await mounted.update(author)
      q.upgrade={prepared,mounted}
      return {seen,fullBeforeExecution,messages:q.messages.filter((message:any)=>message.id==='upgrade')}
    })
    expect(upgrade.seen).toEqual(['references','full','full']);expect(upgrade.fullBeforeExecution).toBe(true)
    expect(await page.frameLocator('#upgrade iframe').locator('#component-root').textContent()).toBe('Full title')
    expect(upgrade.messages.map((message:any)=>message.targets.some((target:any)=>Object.hasOwn(target,'value')))).toEqual([false,true,true])

    const source=await page.evaluate(async()=>{const q=(window as any).__profiles
      const code=`export default {mount({root,scope,instance}){
        const values={project:scope.target({kind:'project'}).read().id,surface:scope.target({kind:'surface',surfaceId:'unvisited-page'}).read().title,
          instance:scope.target({kind:'instance',instanceId:'unvisited'}).read().sentinel};
        scope.state.set('read.'+instance.id,values);scope.events.subscribe('r1.parent.'+instance.id,value=>scope.state.set('parent.'+instance.id,value));
        scope.target({kind:'instance',instanceId:'unvisited'}).emit('r1.parent.'+instance.id,'parent-action');
        root.textContent=values.instance;return {update(){},dispose(){}}}}`
      const source={kind:'source',language:'javascript',source:code,compiled:{code}}
      const payload={schemaVersion:3,id:'source-project',title:'Source project',definitions:{
        shared:{id:'shared',role:'content',implementation:source},web:{id:'web',role:'content',implementation:{kind:'builtin',key:'guoling.web'}}},
        instances:{shared:{id:'shared',definitionId:'shared',data:{}},private:{id:'private',definitionId:'web',data:{html:'<p>Nominal builtin</p>'},implementationOverride:source},
          unvisited:{id:'unvisited',definitionId:'web',data:{html:'<p>Unvisited</p>',sentinel:'formal-unvisited-data'}}},
        surfaces:[{id:'first',kind:'slide',title:'First',childIds:['shared','private'],designSize:{width:800,height:600}},
          {id:'unvisited-page',kind:'slide',title:'Unvisited page',childIds:['unvisited'],designSize:{width:800,height:600}}],global:{underlay:[],overlay:[]},assets:{}}
      q.player=await q.api.mountPublishedCourseV3(payload,document.getElementById('player'),{initialSurfaceId:'first',keyboardNavigation:false})
      return {state:q.player.stateSnapshot(),messages:q.messages.filter((message:any)=>['shared','private'].includes(message.id)),
        unvisitedMounted:Boolean(document.querySelector('[data-component-object="unvisited"] iframe'))}
    })
    expect(source.unvisitedMounted).toBe(false)
    for(const id of ['shared','private']) {
      expect(source.state['read.'+id]).toEqual({project:'source-project',surface:'Unvisited page',instance:'formal-unvisited-data'})
      expect(source.messages.find((message:any)=>message.id===id).targets.every((target:any)=>Object.hasOwn(target,'value'))).toBe(true)
    }
    await page.waitForFunction(()=>{const state=(window as any).__profiles.player.stateSnapshot();return state['parent.shared']==='parent-action'&&state['parent.private']==='parent-action'},undefined,{timeout:3000})
    const released=await page.evaluate(async()=>{const q=(window as any).__profiles;await q.player.dispose();await q.upgrade.mounted.dispose();await q.mounted.dispose();q.controller.abort();await q.world.dispose()
      return {frames:document.querySelectorAll('iframe').length,staticBytes:q.messages.filter((message:any)=>message.id==='form').map((message:any)=>message.bytes)}})
    expect(released.frames).toBe(0);expect(errors).toEqual([])
    console.log('R1 native target profile evidence',JSON.stringify({staticBytes:released.staticBytes,staticTargetReads:updated.reads,upgrade:upgrade.seen,source:['shared','private'],framesAfter:released.frames}))
  } finally {
    await app?.close()
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    const finalDirectory=resolve(directory),taskRoot=resolve(tmpdir())
    if (!finalDirectory.startsWith(taskRoot + '\\') && !finalDirectory.startsWith(taskRoot + '/')) throw new Error('Unexpected fixture directory')
    await rm(finalDirectory,{recursive:true,force:true})
  }
},25_000)
