// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

it('creates Editor realms only for the current/visited pages while preserving the original World and formal project', async () => {
  const bundle = await build({ stdin: { contents: `
    export { CourseV10RuntimeView } from './src/renderer/components/CourseV10RuntimeView';
    export { SlideLocationWorkspace } from './src/renderer/ui/workspaces/SlideLocationWorkspace';
    export { createElement, useState } from 'react';
    export { createRoot } from 'react-dom/client';
    export { flushSync } from 'react-dom';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, outdir: 'editor-fixture', format: 'iife', globalName: 'EditorSurfaceProbe', platform: 'browser', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const server = createServer(async (request, response) => {
    if (request.url === '/compile') {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(await compilation.compile(JSON.parse(Buffer.concat(chunks).toString('utf8')))))
      } catch (error) { response.statusCode = 500; response.end(String(error)) }
      return
    }
    const suffix = request.url === '/editor.js' ? '.js' : request.url === '/editor.css' ? '.css' : null
    response.setHeader('Content-Type', suffix === '.js' ? 'text/javascript; charset=utf-8' : suffix === '.css' ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(suffix ? bundle.outputFiles.find(file => file.path.endsWith(suffix))?.text ?? ''
      : '<!doctype html><link rel="stylesheet" href="/editor.css"><style>html,body{margin:0;width:100%;height:100%}#editor{width:900px;height:700px}</style><div id="editor"></div><script src="/editor.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing Editor fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'creation-editor-surfaces-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const { app, BrowserWindow } = require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
      app.commandLine.appendSwitch('disable-background-timer-throttling');app.whenReady().then(()=>{
      const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});window.loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)});});`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 5000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    console.log('Editor lazy native carrier', await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome })))
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => !!(window as any).EditorSurfaceProbe, undefined, { timeout: 5000 })
    await page.evaluate(() => {
      const api=(window as any).EditorSurfaceProbe
      ;(window as any).desktopAPI={compileComponent:async(input:unknown)=>{
        const response=await fetch('/compile',{method:'POST',body:JSON.stringify(input)});if(!response.ok)throw new Error(await response.text());return response.json()
      }}
      const source=`export default {mount({root,instance,scope}){const id=instance.id;let clicks=0;
        scope.state.set('mounts.'+id,Number(scope.state.get('mounts.'+id)||0)+1);
        scope.state.set('reference.'+id,scope.target({kind:'instance',instanceId:'unvisited-program'})?.read()?.sentinel??null);
        const button=document.createElement('button'),input=document.createElement('input');button.textContent='increment '+id;input.value='initial '+id;root.append(button,input);
        button.addEventListener('click',()=>{scope.state.set('clicks.'+id,++clicks);button.textContent='clicks '+clicks});
        window.mountToken=id+':'+crypto.randomUUID();window.initialDocument=document;
        let ticks=0;const timer=id==='global-program'?setInterval(()=>scope.state.set('ticks.global',++ticks),30):undefined;
        const stop=()=>{if(timer!==undefined)clearInterval(timer)};scope.cleanup(stop);return{update(){},dispose(){stop();root.replaceChildren()}}}}`
      const unsafe=`throw new Error('unvisited Editor source executed');export default{mount(){throw new Error('unvisited mount')}}`
      const definition=(id:string,code=source)=>({id,role:'content',implementation:{kind:'source',language:'javascript',source:code}})
      const instance=(id:string,definitionId:string,y=30)=>({id,definitionId,data:{sentinel:'formal-unvisited'},frame:{width:300,height:120,transform:[1,0,0,1,30,y]}})
      const project={schemaVersion:10,id:'editor-lazy',revision:0,title:'Editor lazy',definitions:{counter:definition('counter'),unsafe:definition('unsafe',unsafe)},
        instances:{'a-program':instance('a-program','counter'),'b-program':instance('b-program','counter'),'unvisited-program':instance('unvisited-program','unsafe'),'global-program':instance('global-program','counter',350)},
        surfaces:[{id:'a',kind:'slide',title:'A',childIds:['a-program'],designSize:{width:800,height:600}},
          {id:'b',kind:'slide',title:'B',childIds:['b-program'],designSize:{width:800,height:600}},
          {id:'unvisited',kind:'slide',title:'Unvisited',childIds:['unvisited-program'],designSize:{width:800,height:600}}],global:{underlay:[],overlay:['global-program']},assets:{}}
      const model={kind:'course-v10',project,resources:{assets:{},components:{}}}, root=api.createRoot(document.getElementById('editor'))
      const q:any={project,root,diagnostics:[],frames:new Map()};(window as any).__editor=q
      const unused=()=>{throw new Error('Author operation outside lifecycle fixture')}
      function Harness(){const [surfaceId,setSurface]=api.useState('a');q.select=(id:string)=>api.flushSync(()=>setSurface(id))
        return api.createElement(api.CourseV10RuntimeView,{documentId:'editor-doc',model,surfaceId,selectedInstanceId:null,player:false,onSelect:()=>{},onSurfaceSelect:setSurface,
          report:(message:string)=>q.diagnostics.push(message),projectionKey:`true:${surfaceId}:light`,renderWorkspace:(runtime:any)=>{
            q.world=runtime.world
            const snapshot={project:runtime.project,documentId:'editor-doc',surfaceId,selectedInstanceIds:[],canvasMode:'edit',contentEdit:null,drawTool:null,activation:0,activeStateId:null,assetUrls:{}}
            const ports={read:()=>snapshot,capture:unused,commit:unused,edit:unused,select:()=>{},selectSurface:setSurface,setCanvasMode:unused,setDrawTool:unused,
              report:(message:string)=>q.diagnostics.push(message),paste:unused,selectAll:unused,beginTextEdit:()=>null,updateDataDraft:unused,setTextComposing:unused,
              commitTextEdit:unused,cancelTextEdit:unused,undo:unused,redo:unused,onElement:runtime.onElement,onTargetElement:runtime.onTargetElement,
              addTextNode:unused,addFormulaNode:unused,addRectangleNode:unused,addShapeNode:unused,addTableNode:unused,addChartNode:unused,addExternalComponentNode:unused,drawShapeNode:unused,
              authorSpots:()=>[],registerObservation:runtime.registerObservation,teacherController:runtime.navigation,navigationChanged:runtime.navigation.changed}
            return api.createElement(api.SlideLocationWorkspace,{snapshot,ports,onAddImage:unused,onAddVideo:unused,onSelectImageAsset:async()=>null})}})
      }
      api.flushSync(()=>root.render(api.createElement(Harness)))
    })
    await page.waitForFunction(() => { const q=(window as any).__editor;return q.world.stateSnapshot()['mounts.a-program']===1&&q.world.stateSnapshot()['mounts.global-program']===1 }, undefined, { timeout: 5000 })
    const initial=await page.evaluate(()=>{const q=(window as any).__editor;for(const id of ['a-program','global-program']){const frame=document.querySelector<HTMLIFrameElement>('[data-component-render="'+id+'"] iframe')!;q.frames.set(id,{frame,realm:frame.contentWindow})}
      return{frames:document.querySelectorAll('iframe').length,state:q.world.stateSnapshot(),diagnostics:q.diagnostics,unvisited:!!document.querySelector('[data-component-instance="unvisited-program"]')}})
    expect(initial.frames).toBe(2);expect(initial.unvisited).toBe(false);expect(initial.diagnostics).toEqual([]);expect(initial.state['reference.a-program']).toBe('formal-unvisited')
    const a=page.frameLocator('[data-component-render="a-program"] iframe'),global=page.frameLocator('[data-component-render="global-program"] iframe')
    // Real native DOM events prove realm state; hidden windows do not prove OS pointer targeting.
    await a.locator('button').evaluate(button=>(button as HTMLButtonElement).click());await a.locator('input').fill('teacher A')
    await global.locator('button').evaluate(button=>(button as HTMLButtonElement).click())
    const aToken=await a.locator('body').evaluate(()=>(window as any).mountToken),ticks=await page.evaluate(()=>(window as any).__editor.world.stateSnapshot()['ticks.global']??0)
    await page.evaluate(()=>(window as any).__editor.select('b'))
    await page.waitForFunction(()=>(window as any).__editor.world.stateSnapshot()['mounts.b-program']===1,undefined,{timeout:5000})
    expect(await page.evaluate(()=>{const q=(window as any).__editor;const frame=document.querySelector<HTMLIFrameElement>('[data-component-render="b-program"] iframe')!;q.frames.set('b-program',{frame,realm:frame.contentWindow});return document.querySelectorAll('iframe').length})).toBe(3)
    const b=page.frameLocator('[data-component-render="b-program"] iframe')
    await b.locator('button').evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await b.locator('input').fill('teacher B')
    const bToken=await b.locator('body').evaluate(()=>(window as any).mountToken)
    await page.evaluate(()=>(window as any).__editor.select('a'))
    expect(await a.locator('input').inputValue()).toBe('teacher A');expect(await a.locator('body').evaluate(()=>(window as any).mountToken)).toBe(aToken)
    await page.evaluate(()=>(window as any).__editor.select('b'))
    expect(await b.locator('input').inputValue()).toBe('teacher B');expect(await b.locator('body').evaluate(()=>(window as any).mountToken)).toBe(bToken)
    expect(await b.locator('body').evaluate(()=>document===(window as any).initialDocument)).toBe(true)
    await page.waitForFunction((previous:number)=>(window as any).__editor.world.stateSnapshot()['ticks.global']>previous,ticks,{timeout:3000})
    const retained=await page.evaluate(()=>{const q=(window as any).__editor;return{state:q.world.stateSnapshot(),diagnostics:q.diagnostics,
      realms:[...q.frames.values()].map((saved:any)=>saved.frame.isConnected&&saved.frame.contentWindow===saved.realm),
      formal:q.world.targetSnapshots().find((target:any)=>target.reference.kind==='project').value.surfaces.map((surface:any)=>surface.id)}})
    expect(retained.realms).toEqual([true,true,true]);expect(retained.formal).toEqual(['a','b','unvisited']);expect(retained.diagnostics).toEqual([])
    expect(retained.state).toMatchObject({'mounts.a-program':1,'mounts.b-program':1,'mounts.global-program':1,'clicks.a-program':1,'clicks.b-program':2,'clicks.global-program':1})
    expect(retained.state['mounts.unvisited-program']).toBeUndefined()
    expect(await page.evaluate(async()=>{const q=(window as any).__editor;(window as any).EditorSurfaceProbe.flushSync(()=>q.root.unmount());await Promise.resolve();await q.world.dispose();return document.querySelectorAll('iframe').length})).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await app?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true})
  }
},20_000)
