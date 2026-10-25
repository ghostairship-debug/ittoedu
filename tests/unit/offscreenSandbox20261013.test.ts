// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

let bundled: Promise<string> | undefined
async function fixture() {
  bundled ??= build({ stdin: { contents: `
    export {preparePublishedNativeComponent} from './src/player/components/runtime/SandboxComponentRuntime';
    export {resolveWebResourceBindings} from './src/components/web/resources';
    export {webRuntimeResourceAddress} from './src/components/web/resourceUrlLease';
    export {webContentRealmSource} from './src/components/web/contentRealmImplementation';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'OffscreenSandbox', target: 'es2022',
    plugins: [{ name: 'raw', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] }).then(result => result.outputFiles[0]!.text)
  const bundle = await bundled
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle : '<!doctype html><div id="source" style="width:640px;height:360px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const directory = await mkdtemp(join(tmpdir(), 'offscreen-sandbox-'))
  const entry = join(directory, 'main.cjs')
  await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
  const app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 8000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean((window as any).OffscreenSandbox))
  await page.evaluate(() => {
    const abort = new AbortController(), events = new Map<string, Set<(value: any) => void>>()
    const q: any = { abort, events, activity: { active: true, visible: true, playing: true }, teacherCalls: 0, diagnostics: [], disposals: 0 }
    q.activityChange = (value: any) => { q.activity = value; for (const listener of events.get('__runtime.activity') ?? []) listener(value) }
    q.scope = { instanceId: 'source', runScopeId: 'offscreen-test', generation: 1, signal: abort.signal, isActive: () => !abort.signal.aborted, cleanup() {}, target: () => null,
      state: { get: () => undefined, set() {}, subscribe: () => () => {} },
      events: { emit(name: string, value: any) { if (name === 'component.diagnostic') q.diagnostics.push(value); for (const listener of events.get(name) ?? []) listener(value) },
        subscribe(name: string, listener: (value: any) => void) { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(listener); if (name === '__runtime.activity') listener(q.activity); return () => set.delete(listener) } } }
    q.teacher = { read: () => ({ scenes: [{ id: 'B', title: 'B' }], zoom: 1 }), canExecute: () => true,
      execute: async () => { q.teacherCalls++; return true }, subscribe: () => () => {},
      setCollapsed() { q.teacherCalls++ }, moveBy() { q.teacherCalls++ }, setZoom() { q.teacherCalls++ }, resetView() { q.teacherCalls++ } }
    window.addEventListener('message', event => { if (event.data === 'offscreen.probe.disposed') q.disposals++ })
    ;(window as any).__offscreenSandbox = q
  })
  const close = async () => {
    await app.close(); await new Promise<void>(done => server.close(() => done()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Fixture cleanup escaped temporary directory')
    await rm(directory, { recursive: true, force: true })
  }
  return { page, errors, close }
}
async function record(name: string, value: unknown) {
  const directory = resolve('output/repair-offscreen-20261013/sandbox')
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2))
}

it('prepares opaque parser resource URLs once, preserves parser scripts and exposes the formal navigation promise', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox, api = (window as any).OffscreenSandbox
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
      const paint = canvas.getContext('2d')!; paint.fillStyle = '#e24432'; paint.fillRect(0, 0, 8, 8)
      q.resources = { picture: canvas.toDataURL('image/png') }
      q.instance = { id: 'source', definitionId: 'web', data: {
        html: '<!doctype html><html><head><script>window.navigationPromiseEarly=courseNavigationReady instanceof Promise;courseNavigationReady.then(port=>window.formalNavigation=port);window.scriptImage=new Image();scriptImage.src="cw-resource:picture";</script></head><body><img id="picture" src="cw-resource:picture"><button onclick="this.textContent=\'clicked\'">click</button></body></html>',
        css: 'body{background:#fff}', resourceBindings: { 'cw-resource:picture': 'picture' },
      } }
      const nested = '<!doctype html><html><head><script>window.scriptImage=new Image();scriptImage.src="cw-resource:picture";</script></head><body><img id="picture" src="cw-resource:picture"></body></html>'
      q.instance.data.html = q.instance.data.html.replace('</body>', `<iframe id="nested" srcdoc="${nested.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body>`)
      q.prepared = await api.preparePublishedNativeComponent({ format: 'esm', code: api.webContentRealmSource(), css: '', diagnostics: [] }, q.abort.signal,
        { state: () => ({}), targets: () => [], builtinKey: 'guoling.web', nativeDocument: true, teacherController: q.teacher,
          resources: () => q.resources, instance: (value: any) => api.resolveWebResourceBindings(value, api.webRuntimeResourceAddress) })
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope, teacherController: q.teacher })
    })
    const child = f.page.frameLocator('#source iframe')
    await expect.poll(() => child.locator('#picture').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(8)
    const first = await child.locator('#picture').evaluate(async (node: HTMLImageElement) => {
      const scope = window as any
      if (!scope.scriptImage.complete) await new Promise(done => scope.scriptImage.onload = done)
      return { url: node.src, scriptUrl: scope.scriptImage.src, scriptWidth: scope.scriptImage.naturalWidth,
        marker: node.getAttribute('data-component-resource-bindings'), early: scope.navigationPromiseEarly,
        navigation: await scope.formalNavigation.execute({ type: 'scene.go', sceneId: 'B' }) }
    })
    expect(first.url).toMatch(/^blob:/); expect(first.scriptUrl).toBe(first.url); expect(first.scriptWidth).toBe(8)
    expect(first.marker).not.toContain('data:image'); expect(first.early).toBe(true); expect(first.navigation).toBe(true)
    const nested = child.frameLocator('#nested')
    await expect.poll(() => nested.locator('#picture').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(8)
    const firstNested = await nested.locator('#picture').evaluate((node: HTMLImageElement) => ({ url: node.src, scriptUrl: (window as any).scriptImage.src }))
    expect(firstNested.url).toMatch(/^blob:/); expect(firstNested.scriptUrl, JSON.stringify({ first, firstNested })).toBe(firstNested.url); expect(firstNested.url).not.toBe(first.url)
    await child.getByRole('button', { name: 'click', exact: true }).click()
    expect(await child.getByRole('button').textContent()).toBe('clicked')
    await f.page.evaluate(() => {
      const q = (window as any).__offscreenSandbox, canvas = document.createElement('canvas'); canvas.width = canvas.height = 10
      const paint = canvas.getContext('2d')!; paint.fillStyle = '#2385c4'; paint.fillRect(0, 0, 10, 10)
      q.resources = { picture: canvas.toDataURL('image/png') }
      for (const listener of q.events.get('__runtime.resources') ?? []) listener(q.resources)
    })
    await expect.poll(() => child.locator('#picture').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(10)
    await expect.poll(() => nested.locator('#picture').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(10)
    const changedNested = await nested.locator('#picture').evaluate((node: HTMLImageElement) => node.src)
    const changedRoot = await child.locator('#picture').evaluate((node: HTMLImageElement) => node.src)
    expect(changedNested).not.toBe(firstNested.url)
    expect(changedNested).not.toBe(changedRoot)
    await f.page.evaluate(async () => { const q = (window as any).__offscreenSandbox; await q.mounted.update(q.instance) })
    expect(await child.locator('#picture').evaluate((node: HTMLImageElement) => node.src)).toBe(changedRoot)
    expect(await child.getByRole('button').textContent()).toBe('clicked')
    expect(f.errors).toEqual([])
  } finally { await f.close() }
})

it('restores a Source image edit after a fresh realm when resources.url used an asset ID without token bindings', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox, api = (window as any).OffscreenSandbox
      const canvas = document.createElement('canvas'), paint = canvas.getContext('2d')!
      canvas.width = canvas.height = 8; paint.fillStyle = '#c43'; paint.fillRect(0, 0, 8, 8)
      const first = canvas.toDataURL('image/png')
      canvas.width = canvas.height = 10; paint.fillStyle = '#38c'; paint.fillRect(0, 0, 10, 10)
      q.resources = { first, picture: first, replacement: canvas.toDataURL('image/png') }; q.spots = []
      q.authoring = { register(input: any) { q.spots.push(input); return () => {} } }
      q.instance = { id: 'source', definitionId: 'source', data: {} }
      q.artifact = { format: 'esm', css: '', diagnostics: [], code: 'export default {mount({root,resources}){const image=document.createElement("img");image.id="source-image";image.src=resources.url("picture");root.append(image);return{update(){},dispose(){}}}}' }
      q.prepare = () => api.preparePublishedNativeComponent(q.artifact, q.abort.signal, { state: () => ({}), targets: () => [], resources: () => q.resources, htmlAuthoring: true })
      q.prepared = await q.prepare()
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope, authoring: q.authoring })
    })
    const child = f.page.frameLocator('#source iframe')
    await expect.poll(() => child.locator('#source-image').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(8)
    await expect.poll(() => f.page.evaluate(() => (window as any).__offscreenSandbox.spots.some((spot: any) => spot.kind === 'image'))).toBe(true)
    const baseline = await f.page.evaluate(() => (window as any).__offscreenSandbox.spots.find((spot: any) => spot.kind === 'image').binding.baseline)
    expect(baseline).toBe('picture')
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox, spot = q.spots.find((spot: any) => spot.kind === 'image')
      q.instance.authoring = JSON.parse(JSON.stringify({ records: { [spot.authorKey]: { kind: 'image', binding: spot.binding, overrides: { src: 'replacement' } } } }))
      await q.mounted.dispose(); await q.prepared.release(); q.spots = []
      q.prepared = await q.prepare()
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope, authoring: q.authoring })
    })
    await expect.poll(() => child.locator('#source-image').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(10)
    // Existing supported records saved before short runtime URLs used the
    // original data URL as both baseline and resource override.
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox
      const records = JSON.parse(JSON.stringify(q.instance.authoring.records))
      const record = records[Object.keys(records)[0]]
      record.binding.baseline = q.resources.picture; record.overrides.src = q.resources.replacement
      q.instance.authoring = { records }
      await q.mounted.dispose(); await q.prepared.release(); q.spots = []
      q.prepared = await q.prepare()
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'), instance: q.instance, scope: q.scope, authoring: q.authoring })
    })
    await expect.poll(() => child.locator('#source-image').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(10)
    expect(f.errors).toEqual([])
  } finally { await f.close() }
})

it('retains the Source realm across cooperative suspend/resume, replays activity during async mount, and rejects sleeping teacher commands', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox, api = (window as any).OffscreenSandbox
      const source = `export default {async mount({root,scope,teacherController}){
        const probe=window.probe={counter:7,suspends:0,resumes:0,events:[],boot:Math.random()},input=document.createElement('input');input.value='original';root.append(input);
        window.scopeAlive=()=>scope.isActive()&&!scope.signal.aborted;
        let timer;const start=()=>{timer=setInterval(()=>probe.counter++,15)};start();
        window.navigate=()=>teacherController.execute({type:'scene.go',sceneId:'B'});
        window.views=()=>{teacherController.setCollapsed(true);teacherController.moveBy(1,2);teacherController.setZoom(2);teacherController.resetView()};
        await new Promise(done=>setTimeout(done,35));
        scope.events.subscribe('__runtime.activity',value=>probe.events.push(value));
        return {update(){},async suspend(){probe.suspends++;clearInterval(timer);await new Promise(done=>setTimeout(done,10))},resume(){probe.resumes++;start()},dispose(){clearInterval(timer);parent.postMessage('offscreen.probe.disposed','*')}}}}`
      q.prepared = await api.preparePublishedNativeComponent({ format: 'esm', code: source, css: '', diagnostics: [] }, q.abort.signal,
        { state: () => ({}), targets: () => [], instance: async (value: any) => { await new Promise(done => setTimeout(done,35)); return value } })
      q.mount = q.prepared.implementation.mount({ root: document.getElementById('source'), instance: { id: 'source', definitionId: 'custom', data: {} }, scope: q.scope, teacherController: q.teacher })
      q.activityChange({ active: false, visible: false, playing: true })
      q.mounted = await q.mount; q.frame = document.querySelector('iframe'); q.src = q.frame.src
    })
    const child = f.page.frameLocator('#source iframe')
    const paused = await child.locator('input').evaluate(() => ({ ...((window as any).probe), alive: (window as any).scopeAlive() }))
    expect(paused.suspends).toBe(1); expect(paused.resumes).toBe(0)
    expect(paused.alive).toBe(true)
    expect(paused.events).toEqual([{ active: false, visible: false, playing: true }])
    await f.page.waitForTimeout(70)
    expect(await child.locator('input').evaluate(() => (window as any).probe.counter)).toBe(paused.counter)
    expect(await child.locator('input').evaluate(async () => (window as any).navigate())).toBe(false)
    await child.locator('input').evaluate(() => (window as any).views())
    await f.page.waitForTimeout(30)
    expect(await f.page.evaluate(() => (window as any).__offscreenSandbox.teacherCalls)).toBe(0)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: true, visible: false, playing: true }))
    expect(await child.locator('input').evaluate(async () => (window as any).navigate())).toBe(true)
    expect(await child.locator('input').evaluate(() => (window as any).probe.suspends)).toBe(1)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: true, visible: true, playing: false }))
    expect(await child.locator('input').evaluate(async () => (window as any).navigate())).toBe(false)
    await child.locator('input').evaluate(() => (window as any).views())
    await f.page.waitForTimeout(20)
    expect(await f.page.evaluate(() => (window as any).__offscreenSandbox.teacherCalls)).toBe(1)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: true, visible: true, playing: true }))
    await child.locator('input').fill('human value')
    await f.page.waitForTimeout(40)
    expect(await child.locator('input').evaluate(() => (window as any).probe.counter)).toBeGreaterThan(paused.counter)
    expect(await child.locator('input').evaluate(() => (window as any).probe.resumes)).toBe(1)
    await f.page.evaluate(() => { const q = (window as any).__offscreenSandbox; q.activityChange({ active: false, visible: false, playing: true }); document.getElementById('source')!.style.visibility = 'hidden' })
    await f.page.waitForTimeout(20)
    const sleeping = await child.locator('input').evaluate(() => (window as any).probe.counter)
    await f.page.waitForTimeout(50)
    expect(await child.locator('input').evaluate(() => (window as any).probe.counter)).toBe(sleeping)
    await f.page.evaluate(() => { const q = (window as any).__offscreenSandbox; document.getElementById('source')!.style.visibility = ''; q.activityChange({ active: true, visible: true, playing: true }) })
    expect(await child.locator('input').inputValue()).toBe('human value')
    const final = await child.locator('input').evaluate(() => (window as any).probe)
    expect(final.boot).toBe(paused.boot); expect(final.suspends).toBe(2); expect(final.resumes).toBe(2)
    expect(await f.page.evaluate(() => { const q = (window as any).__offscreenSandbox; return { frame: q.frame === document.querySelector('iframe'), src: q.frame.src === q.src, aborted: q.abort.signal.aborted, diagnostics: q.diagnostics } }))
      .toEqual({ frame: true, src: true, aborted: false, diagnostics: [] })
    await record('source-cooperation', { paused, final, retainedFrame: true, retainedSrc: true, scopeAlive: true, sleepingNavigation: false,
      playbackPausedNavigation: false, sleepingViewCommands: 0, invisibleGlobalNavigation: true, errors: f.errors })
    await f.page.evaluate(async () => { const q = (window as any).__offscreenSandbox; await q.mounted.dispose(); q.prepared.release() })
    await f.page.waitForFunction(() => (window as any).__offscreenSandbox.disposals === 1)
    expect(f.errors).toEqual([])
  } finally { await f.close() }
}, 20000)

it('keeps native HTML and owned srcdoc state while publishing cooperative activity snapshots; uncooperative timers remain live', async () => {
  const f = await fixture()
  try {
    await f.page.evaluate(async () => {
      const q = (window as any).__offscreenSandbox, api = (window as any).OffscreenSandbox
      const nested = `<input value="nested original"><script>window.probe={boot:Math.random(),initialEvents:[],events:[]};window.addEventListener('__runtime.activity',event=>probe.initialEvents.push(event.detail));window.subscribeLateActivity=()=>{probe.late=window.__guolingRuntimeActivity;window.addEventListener('__runtime.activity',event=>probe.events.push(event.detail))};<\/script>`
      const html = `<!doctype html><html><body><input id="human" value="original"><iframe id="owned" srcdoc="${nested.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe><script>
        window.probe={boot:Math.random(),initialEvents:[],events:[],ticks:0,blackbox:0};let timer=setInterval(()=>probe.ticks++,15);setInterval(()=>probe.blackbox++,15);
        window.addEventListener('__runtime.activity',event=>probe.initialEvents.push(event.detail));
        const activity=value=>{probe.events.push(value);if(!(value.active&&value.visible&&value.playing)){clearInterval(timer);timer=null}else if(!timer)timer=setInterval(()=>probe.ticks++,15)};
        window.subscribeLateActivity=()=>{probe.late=window.__guolingRuntimeActivity;activity(probe.late);window.addEventListener('__runtime.activity',event=>activity(event.detail))};
      <\/script></body></html>`
      q.prepared = await api.preparePublishedNativeComponent({ format: 'esm', code: api.webContentRealmSource(), css: '', diagnostics: [] }, q.abort.signal,
        { builtinKey: 'guoling.html-program', nativeDocument: true, state: () => ({}), targets: () => [], instance: async (value: any) => { await new Promise(done => setTimeout(done,30)); return value } })
      q.mount = q.prepared.implementation.mount({ root: document.getElementById('source'), instance: { id: 'source', definitionId: 'guoling.html-program', data: { html } }, scope: q.scope })
      q.activityChange({ active: false, visible: false, playing: true })
      q.mounted = await q.mount; q.frame = document.querySelector('iframe'); q.src = q.frame.src
    })
    const child = f.page.frameLocator('#source > iframe'), nested = child.frameLocator('#owned')
    // A late subscriber starts after the real snapshot is ready in each realm;
    // parser timers and a host sleep do not establish that ordering.
    const inactive = { active: false, visible: false, playing: true }
    await expect.poll(() => child.locator('#human').evaluate(() => (window as any).__guolingRuntimeActivity)).toEqual(inactive)
    await expect.poll(() => nested.locator('input').evaluate(() => (window as any).__guolingRuntimeActivity)).toEqual(inactive)
    await expect.poll(() => child.locator('#human').evaluate(() => (window as any).probe.initialEvents)).toContainEqual(inactive)
    await expect.poll(() => nested.locator('input').evaluate(() => (window as any).probe.initialEvents)).toContainEqual(inactive)
    await child.locator('#human').evaluate(() => (window as any).subscribeLateActivity())
    await nested.locator('input').evaluate(() => (window as any).subscribeLateActivity())
    const paused = await child.locator('#human').evaluate(() => ({ ...((window as any).probe), snapshot: (window as any).__guolingRuntimeActivity,
      readonly: !Object.getOwnPropertyDescriptor(window, '__guolingRuntimeActivity')!.set }))
    expect(paused.snapshot).toEqual({ active: false, visible: false, playing: true }); expect(paused.readonly).toBe(true)
    expect(paused.late).toEqual(paused.snapshot)
    const nestedBefore = await nested.locator('input').evaluate(() => ({ ...((window as any).probe), snapshot: (window as any).__guolingRuntimeActivity }))
    expect(nestedBefore.snapshot).toEqual(paused.snapshot); expect(nestedBefore.late).toEqual(paused.snapshot)
    await f.page.waitForTimeout(55)
    const after = await child.locator('#human').evaluate(() => (window as any).probe)
    expect(after.ticks).toBe(paused.ticks); expect(after.blackbox).toBeGreaterThan(paused.blackbox)
    await child.locator('#human').evaluate(() => { const copy = (window as any).__guolingRuntimeActivity; copy.active = true })
    expect(await child.locator('#human').evaluate(() => (window as any).__guolingRuntimeActivity.active)).toBe(false)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: true, visible: true, playing: true }))
    await child.locator('#human').fill('human retained')
    await nested.locator('input').fill('nested retained')
    await expect.poll(() => nested.locator('input').evaluate(() => (window as any).probe.events))
      .toContainEqual({ active: true, visible: true, playing: true })
    await f.page.waitForTimeout(35)
    expect(await child.locator('#human').evaluate(() => (window as any).probe.ticks)).toBeGreaterThan(paused.ticks)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: false, visible: false, playing: true }))
    await f.page.waitForTimeout(25)
    await f.page.evaluate(() => (window as any).__offscreenSandbox.activityChange({ active: true, visible: true, playing: true }))
    expect(await child.locator('#human').inputValue()).toBe('human retained'); expect(await nested.locator('input').inputValue()).toBe('nested retained')
    expect(await child.locator('#human').evaluate(() => (window as any).probe.boot)).toBe(paused.boot)
    expect(await nested.locator('input').evaluate(() => (window as any).probe.boot)).toBe(nestedBefore.boot)
    expect(await f.page.evaluate(() => { const q = (window as any).__offscreenSandbox; return { frame: q.frame === document.querySelector('iframe'), src: q.frame.src === q.src, aborted: q.abort.signal.aborted, diagnostics: q.diagnostics } }))
      .toEqual({ frame: true, src: true, aborted: false, diagnostics: [] })
    await record('html-cooperation', { paused, after, nestedBefore, readonlySnapshot: true, sourceAndNestedInputsRetained: true,
      retainedFrame: true, retainedSrc: true, scopeAlive: true, blackboxHardPaused: false, errors: f.errors })
    await f.page.evaluate(async () => { const q = (window as any).__offscreenSandbox; await q.mounted.dispose(); q.prepared.release() })
    expect(f.errors).toEqual([])
  } finally { await f.close() }
}, 20000)
