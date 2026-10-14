// @vitest-environment node
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('runs real Published source snapshot navigation, host cancellation, realm retirement and camera easing', async () => {
  const bundle = await build({ stdin: { contents: `
    export { mountPublishedCourseV3 } from './src/player/componentPlatform/publishedPlayer';
    export { createComponentSpatialCameraPort } from './src/player/surfaces/spatial/componentPlatform/camera';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'R06', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-raw', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text : '<!doctype html><div id="course" style="width:800px;height:600px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'r06-motion-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 10000,
      env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined)) })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => { errors.push(error.message); console.info('R06 page error:', error.message) })
    await page.waitForFunction(() => Boolean((window as any).R06))
    console.info('R06 bundle loaded')
    await page.evaluate(async () => {
      const api = (window as any).R06, diagnostics: string[] = []
      const source = `export function mount({root,scope,teacherController}) {
        root.textContent = scope.instanceId; let tick=0;
        const timer=setInterval(()=>scope.state.set('tick:'+scope.instanceId,++tick),16);
        if(scope.instanceId==='a') {
          const dot=document.createElement('span');dot.id='dot';dot.textContent='●';dot.style.cssText='display:inline-block;color:blue';root.append(dot);
          const effect=document.createElement('button');effect.id='effect';effect.textContent='effect';root.append(effect);
          effect.onclick=async()=>{
            const local=dot.animate([{transform:'rotate(0deg) scale(1)'},{transform:'rotate(137deg) scale(1.4)',offset:.4},{transform:'rotate(360deg) scale(1)'}],{duration:500,easing:'linear'});
            const tasks=['a','global'].map((id,i)=>scope.target({kind:'instance',instanceId:id}).motion.replace('custom-'+id,context=>context.animate([
              {transform:'translateX(0px)',opacity:1},{transform:'translateX('+(50+i*35)+'px) rotate('+(13+i*7)+'deg)',opacity:.5,offset:.5},{transform:'translateX(0px)',opacity:1}],{duration:500,easing:'linear'})));
            await Promise.all([local.finished,...tasks.map(task=>task.finished)]);dot.style.color='green';scope.state.set('effect:done',true);
          };
          const button=document.createElement('button'); button.id='go';button.textContent='go';
          button.onclick=()=>{scope.state.set('clicked:a',true);void teacherController.execute({type:'scene.go',sceneId:'B',transition:{
            outgoing:{keyframes:[{transform:'translateX(0)',opacity:1},{transform:'translateX(-40%)',opacity:0}],timing:{duration:600,easing:'linear'}},
            incoming:{keyframes:[{transform:'scale(.7)',opacity:0},{transform:'scale(1)',opacity:1}],timing:{duration:600,easing:'ease-out'}}}}).catch(()=>{});};root.append(button); }
        return {update(){},dispose(){clearInterval(timer)}}
      }`
      const frame = { width: 160, height: 100, transform: [1, 0, 0, 1, 20, 20] }
      const payload = { schemaVersion: 3, id: 'r06', title: 'R06',
        definitions: { source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source, compiled: { code: source } } } },
        instances: Object.fromEntries(['a', 'b', 'global'].map(id => [id, { id, definitionId: 'source', data: {}, frame: id === 'global' ? { ...frame, transform: [1, 0, 0, 1, 20, 300] } : frame }])),
        surfaces: [{ id: 'A', kind: 'slide', title: 'A', childIds: ['a'], designSize: { width: 800, height: 600 } }, { id: 'B', kind: 'slide', title: 'B', childIds: ['b'], designSize: { width: 800, height: 600 } }],
        global: { underlay: [], overlay: ['global'] }, assets: {} }
      const original = JSON.stringify(payload), player = await api.mountPublishedCourseV3(payload, document.getElementById('course'), { report: (message: string) => diagnostics.push(message), keyboardNavigation: false })
      ;(window as any).probe = { player, payload, original, diagnostics, globalFrame: player.runtime.contentElement('global').querySelector('iframe') }
    })
    await page.waitForFunction(() => (window as any).probe.player.runtime.getState('tick:a') > 1)
    const sourceFrame = page.frames().find(frame => frame.url().startsWith('blob:') && frame !== page.mainFrame())
    let effectFrame: typeof sourceFrame
    for (const frame of page.frames()) if (await frame.locator('#effect').count()) { effectFrame = frame; break }
    if (!effectFrame) throw new Error('Missing actual source effect control')
    await effectFrame.locator('#effect').click()
    await page.waitForFunction(() => document.getAnimations().filter(animation => !(animation.effect as KeyframeEffect)?.pseudoElement).length >= 2)
    const crossObjectFrames = await page.evaluate(() => document.getAnimations().map(animation => (animation.effect as KeyframeEffect).getKeyframes()))
    expect(crossObjectFrames.some(frames => frames.some(frame => frame.transform === 'translateX(85px) rotate(20deg)'))).toBe(true)
    const localMiddle = await effectFrame.locator('#dot').evaluate(element => getComputedStyle(element).transform)
    expect(localMiddle).not.toBe('none')
    await page.waitForFunction(() => (window as any).probe.player.runtime.getState('effect:done') === true)
    expect(await effectFrame.locator('#dot').evaluate(element => getComputedStyle(element).color)).toBe('rgb(0, 128, 0)')
    // Find the actual isolated source document, independent of generated iframe ordering.
    let clicked = false
    for (const frame of page.frames()) if (await frame.locator('#go').count()) { await frame.locator('#go').click(); clicked = true; break }
    expect(clicked).toBe(true)
    await page.waitForFunction(() => (window as any).probe.player.runtime.getState('clicked:a') === true)
    await page.waitForFunction(() => (window as any).probe.player.navigation.read().locationId === 'B'
      && document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition-old'))).catch(async error => {
        console.info('R06 failed transition state:', await page.evaluate(() => ({ visibility: document.visibilityState, state: (window as any).probe.player.navigation.read(), diagnostics: (window as any).probe.diagnostics, animations: document.getAnimations().map(a => ({ state: a.playState, pseudo: (a.effect as KeyframeEffect)?.pseudoElement })) })))
        throw error
      })
    const during = await page.evaluate(() => {
      const q = (window as any).probe
      return { oldTicks: q.player.runtime.getState('tick:a'), globals: q.player.runtime.contentElement('global').querySelector('iframe') === q.globalFrame,
        visual: document.getAnimations().filter(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition-')).map(animation => (animation.effect as KeyframeEffect).getKeyframes()) }
    })
    expect(during.globals).toBe(true); expect(during.visual.some(frames => frames.some(frame => frame.transform === 'translateX(-40%)'))).toBe(true)
    const evidenceDirectory = resolve('output/authoring-playback-repair-20261012')
    await mkdir(evidenceDirectory, { recursive: true })
    await page.screenshot({ path: join(evidenceDirectory, 'R06-custom-transition.png') })
    await page.waitForFunction(() => !document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition-')))
    const outcome = await page.evaluate(async (ticks: number) => {
      const q = (window as any).probe, { player } = q
      const oldStopped = player.runtime.getState('tick:a') === ticks
      const controller = new AbortController()
      const cancelled = player.navigation.execute({ type: 'scene.go', sceneId: 'A', transition: {} }, controller.signal); controller.abort()
      const beforeCommit = await cancelled === false && player.navigation.read().locationId === 'B'
      const first = player.navigation.execute({ type: 'scene.go', sceneId: 'A', transition: { outgoing: { keyframes: [{ opacity: 1 }, { opacity: 0 }], timing: { duration: 500 } } } })
      while (player.navigation.read().locationId !== 'A') await new Promise(requestAnimationFrame)
      const second = await player.navigation.execute({ type: 'scene.go', sceneId: 'B' })
      const replaced = await first === false && second && player.navigation.read().locationId === 'B'
      let time = 0, tick: ((time: number) => void) | undefined
      const camera = (window as any).R06.createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 }, { now: () => time, request: (fn: (time: number) => void) => { tick = fn; return 1 }, cancel: () => { tick = undefined } })
      const moving = camera.present({ x: 100, y: 0, zoom: 1 }, { durationMs: 100, easing: 'cubic-bezier(.42,0,1,1)' })
      time = 50; tick!(time); const midpoint = camera.read().x
      camera.set({ x: 9, y: 4, zoom: 1 }); const cameraCancelled = await moving === false && camera.read().x === 9; camera.dispose()
      const unchanged = JSON.stringify(q.payload) === q.original, diagnostics = [...q.diagnostics]
      await player.dispose()
      const spatial = { id: 'A', kind: 'spatial', title: 'Start', childIds: ['a'], spatial: { home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'first', title: 'First', pose: { x: 100, y: 0, zoom: 1 } }, { id: 'second', title: 'Default start', pose: { x: 200, y: 0, zoom: 1 } }],
        paths: [{ id: 'route', title: 'Reverse', frameIds: ['second', 'first'] }], defaultPathId: 'route' } }
      const restarted = await (window as any).R06.mountPublishedCourseV3({ ...q.payload, surfaces: [spatial, q.payload.surfaces[1]] }, document.getElementById('course'), { keyboardNavigation: false, report: (message: string) => diagnostics.push(message) })
      await restarted.navigation.execute({ type: 'scene.go', sceneId: 'B' })
      const restartAccepted = await restarted.navigation.execute({ type: 'course.restart' }), restart = restarted.navigation.read()
      await restarted.dispose()
      return { oldStopped, beforeCommit, replaced, midpoint, cameraCancelled, unchanged, diagnostics, restartAccepted, restart }
    }, during.oldTicks)
    expect(outcome).toMatchObject({ oldStopped: true, beforeCommit: true, replaced: true, cameraCancelled: true, unchanged: true, diagnostics: [] })
    expect(outcome.midpoint).toBeCloseTo(31.5356734, 4); expect(errors).toEqual([])
    expect(outcome.restartAccepted).toBe(true)
    expect(outcome.restart).toMatchObject({ locationId: 'A', camera: { x: 200 }, progress: { stepName: 'Default start' } })
    await writeFile(join(evidenceDirectory, 'R06-native-motion-result.json'), JSON.stringify({ crossObjectFrames, localMiddle, during, outcome, errors }, null, 2))
  } finally {
    await app?.close(); await new Promise<void>(done => server.close(() => done()))
    const cleanupPath = resolve(directory), temporaryRoot = resolve(tmpdir()) + sep
    if (!cleanupPath.startsWith(temporaryRoot) || !cleanupPath.slice(temporaryRoot.length).startsWith('r06-motion-')) throw new Error('Unexpected test cleanup path')
    await rm(cleanupPath, { recursive: true, force: true })
  }
}, 30000)
