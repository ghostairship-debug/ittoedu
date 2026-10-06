// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('mounts only the initial Published target/global, preserves visited native realms and observes a direct capture target', async () => {
  const bundle = await build({ stdin: { contents: `export { mountPublishedCourseV3 } from './src/player/componentPlatform/publishedPlayer';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'LazySurfaceProbe', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/player.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/player.js' ? bundle.outputFiles[0]!.text : '<!doctype html><style>body{margin:0}#player{width:800px;height:600px}</style><div id="player"></div><script src="/player.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing isolated fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'creation-lazy-surfaces-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.commandLine.appendSwitch('disable-background-timer-throttling');
      app.whenReady().then(() => { const window = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
        window.loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}); });`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 5000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    console.log('Lazy surfaces native carrier', await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome })))
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const crash = new Promise<never>((_resolve, reject) => page.once('crash', () => reject(new Error('Lazy surfaces renderer native crash'))))
    await page.waitForFunction(() => !!(window as any).LazySurfaceProbe, undefined, { timeout: 5000 })
    const initial = await Promise.race([crash, page.evaluate(async () => {
      const code = `export default {mount({root,instance,scope}) {
        const id=instance.id;let clicks=0;
        scope.state.set('mounts.'+id,Number(scope.state.get('mounts.'+id)||0)+1);
        scope.state.set('reference.'+id,scope.target({kind:'instance',instanceId:'unvisited-program'})?.read()?.sentinel??null);
        const button=document.createElement('button'),input=document.createElement('input');
        button.textContent='increment '+id;input.value='initial '+id;root.append(button,input);
        window.localClicks=0;button.onclick=()=>{clicks++;window.localClicks=clicks;button.textContent='increment '+id+' '+clicks;scope.state.set('clicks.'+id,clicks)};
        window.mountToken=id+':'+crypto.randomUUID();
        let ticks=0;const timer=id==='global-program'?setInterval(()=>scope.state.set('ticks.global',++ticks),30):undefined;
        const cleanup=()=>{if(timer!==undefined)clearInterval(timer)};scope.cleanup(cleanup);
        return {update(){},dispose(){cleanup();root.replaceChildren()}};
      }}`
      const unsafe = `throw new Error('unvisited source executed');export default {mount(){throw new Error('unvisited mount')}}`
      const definition = (id: string, source = code) => ({ id, role: 'content', implementation: { kind: 'source', language: 'javascript', source, compiled: { code: source } } })
      const instance = (id: string, definitionId: string, y = 20) => ({ id, definitionId, data: { sentinel: 'formal-unvisited-data' }, frame: { width: 300, height: 120, transform: [1,0,0,1,20,y] } })
      const payload = { schemaVersion: 3, id: 'lazy-real-runtime', title: 'Lazy real runtime', definitions: { counter: definition('counter'), unsafe: definition('unsafe', unsafe) },
        instances: { 'cover-program': instance('cover-program','unsafe'), 'a-program': instance('a-program','counter'), 'b-program': instance('b-program','counter'),
          'unvisited-program': instance('unvisited-program','unsafe'), 'global-program': instance('global-program','counter',350) },
        surfaces: [{ id: 'cover', title: 'Cover', kind: 'slide', childIds: ['cover-program'], designSize: { width:800,height:600 } },
          { id: 'a', title: 'A', kind: 'slide', childIds: ['a-program'], designSize: { width:800,height:600 } },
          { id: 'b', title: 'B', kind: 'flow', childIds: ['b-program'] },
          { id: 'unvisited', title: 'Unvisited', kind: 'slide', childIds: ['unvisited-program'], designSize: { width:800,height:600 } }],
        global: { underlay: [], overlay: ['global-program'] }, assets: {} }
      const root=document.getElementById('player')!, diagnostics: string[]=[]
      const player=await (window as any).LazySurfaceProbe.mountPublishedCourseV3(payload,root,{initialSurfaceId:'a',keyboardNavigation:false,report:(message:string)=>diagnostics.push(message)})
      const frames=new Map<string,{frame:HTMLIFrameElement;realm:Window|null}>()
      for(const id of ['a-program','global-program']){const frame=root.querySelector<HTMLIFrameElement>('[data-component-object="'+id+'"] iframe')!;frames.set(id,{frame,realm:frame.contentWindow})}
      ;(window as any).__lazy={player,payload,root,diagnostics,frames}
      return { location:player.navigation.read().locationId, frameCount:root.querySelectorAll('iframe').length,state:player.stateSnapshot(),diagnostics }
    })])
    expect(initial.location).toBe('a'); expect(initial.frameCount).toBe(2); expect(initial.diagnostics).toEqual([])
    expect(initial.state).toMatchObject({ 'mounts.a-program':1,'mounts.global-program':1,'reference.a-program':'formal-unvisited-data' })
    const a = page.frameLocator('[data-component-object="a-program"] iframe'), global = page.frameLocator('[data-component-object="global-program"] iframe')
    // Stimulate the real native realm's handler directly: this hidden carrier
    // proves lifecycle/state preservation, not foreground OS pointer targeting.
    await a.locator('button').evaluate(button => (button as HTMLButtonElement).click())
    await a.locator('input').fill('teacher A')
    await global.locator('button').evaluate(button => (button as HTMLButtonElement).click())
    console.log('Lazy surfaces click A/global', {
      a: await a.locator('button').evaluate(button => ({ handler:typeof (button as HTMLButtonElement).onclick, local:(window as any).localClicks,label:button.textContent })),
      global: await global.locator('button').evaluate(button => ({ handler:typeof (button as HTMLButtonElement).onclick, local:(window as any).localClicks,label:button.textContent })),
      state:await page.evaluate(()=> (window as any).__lazy.player.stateSnapshot()), errors,
    })
    const aToken=await a.locator('body').evaluate(()=> (window as any).mountToken)
    const firstGlobalTicks=await page.evaluate(()=> (window as any).__lazy.player.stateSnapshot()['ticks.global']??0)
    const bFirst = await page.evaluate(async () => {
      const q=(window as any).__lazy, ok=q.player.revealSurface('b')
      const immediateGeometry=!!q.root.querySelector('[data-component-surface="b"]'), immediateObservation=!!q.player.observation('b')
      q.player.observation('b')?.setZoom(1.25)
      await q.player.ready
      const frame=q.root.querySelector('[data-component-object="b-program"] iframe');q.frames.set('b-program',{frame,realm:frame.contentWindow})
      return {ok,immediateGeometry,immediateObservation,state:q.player.stateSnapshot(),zoom:q.player.navigation.read().zoom,frames:q.root.querySelectorAll('iframe').length}
    })
    expect(bFirst.ok).toBe(true);expect(bFirst.immediateGeometry).toBe(true);expect(bFirst.immediateObservation).toBe(true)
    expect(bFirst.zoom).toBe(1.25);expect(bFirst.frames).toBe(3);expect(bFirst.state['mounts.b-program']).toBe(1)
    const b=page.frameLocator('[data-component-object="b-program"] iframe')
    await b.locator('button').evaluate(button => { (button as HTMLButtonElement).click();(button as HTMLButtonElement).click() })
    await b.locator('input').fill('teacher B')
    console.log('Lazy surfaces click B', {
      b:await b.locator('button').evaluate(button => ({ handler:typeof (button as HTMLButtonElement).onclick,local:(window as any).localClicks,label:button.textContent })),
      state:await page.evaluate(()=> (window as any).__lazy.player.stateSnapshot()),errors,
    })
    const bToken=await b.locator('body').evaluate(()=> (window as any).mountToken)
    expect(await page.evaluate(()=>{const q=(window as any).__lazy;q.player.navigation.setZoom(1.6);return q.player.navigation.read().zoom})).toBe(1.6)
    expect(await page.evaluate(async()=> (window as any).__lazy.player.go('a'))).toBe(true)
    expect(await a.locator('input').inputValue()).toBe('teacher A');expect(await a.locator('body').evaluate(()=> (window as any).mountToken)).toBe(aToken)
    expect(await page.evaluate(async()=> (window as any).__lazy.player.go('b'))).toBe(true)
    expect(await b.locator('input').inputValue()).toBe('teacher B');expect(await b.locator('body').evaluate(()=> (window as any).mountToken)).toBe(bToken)
    await page.waitForFunction((previous:number)=> (window as any).__lazy.player.stateSnapshot()['ticks.global']>previous,firstGlobalTicks,{timeout:3000})
    const retained=await page.evaluate(()=>{const q=(window as any).__lazy;return {state:q.player.stateSnapshot(),zoom:q.player.navigation.read().zoom,diagnostics:q.diagnostics,
      realms:[...q.frames.values()].map((saved:any)=>saved.frame.isConnected&&saved.frame.contentWindow===saved.realm&&q.root.contains(saved.frame)),
      formal:q.player.runtime.targetSnapshots().find((target:any)=>target.reference.kind==='project').value.surfaces.map((surface:any)=>surface.id)} })
    expect(retained.realms).toEqual([true,true,true]);expect(retained.zoom).toBe(1.6);expect(retained.diagnostics).toEqual([])
    expect(retained.state).toMatchObject({'mounts.a-program':1,'mounts.b-program':1,'mounts.global-program':1,'clicks.a-program':1,'clicks.b-program':2,'clicks.global-program':1})
    expect(retained.formal).toEqual(['cover','a','b','unvisited'])
    const capture=await page.evaluate(async()=>{const q=(window as any).__lazy;await q.player.dispose();const retired=document.querySelectorAll('iframe').length;
      const captured=await (window as any).LazySurfaceProbe.mountPublishedCourseV3(q.payload,q.root,{capture:true,initialSurfaceId:'b',keyboardNavigation:false,report:(message:string)=>q.diagnostics.push(message)});
      const result={retired,location:captured.navigation.read().locationId,state:captured.stateSnapshot(),frames:q.root.querySelectorAll('iframe').length,diagnostics:q.diagnostics};
      await captured.dispose();return {...result,finalFrames:document.querySelectorAll('iframe').length}})
    expect(capture.retired).toBe(0);expect(capture.location).toBe('b');expect(capture.frames).toBe(2);expect(capture.finalFrames).toBe(0);expect(capture.diagnostics).toEqual([])
    expect(capture.state['mounts.b-program']).toBe(1);expect(capture.state['mounts.global-program']).toBe(1);expect(capture.state['mounts.a-program']).toBeUndefined();expect(capture.state['mounts.cover-program']).toBeUndefined()
    expect(errors).toEqual([])
  } finally {
    await app?.close()
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    await rm(directory,{recursive:true,force:true})
  }
},20_000)
