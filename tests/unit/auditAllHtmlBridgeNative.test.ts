// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('R50/51 real realm bridge preserves results, current facts and owned document interaction state', async () => {
  const popover = await build({ stdin: { contents: "export {popoverRuntimeImplementation as default} from './src/components/popover';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const bundle = await build({ stdin: { contents: `
    export { prepareSandboxComponent } from './src/renderer/components/SandboxComponentImplementation';
    export { webContentRealmSource } from './src/components/web/contentRealmImplementation';
    export { resolveWebResourceBindings } from './src/components/web/resources';
    export { mount as mountTeacher } from './src/components/teacher-controller/defaultController';
    export { createTeacherControllerData } from './src/components/teacher-controller/data';
    export { flowContentClientMatrix } from './src/renderer/ui/flow/flowParagraphLayout';
    export { transformPoint } from './src/core/components/geometry';
    export const popoverSource=${JSON.stringify(popover.outputFiles[0]!.text)};`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'AuditHtmlBridge', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-raw', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text : '<!doctype html><div id="source"></div><div id="web"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'audit-html-bridge-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 8000, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => Boolean((window as any).AuditHtmlBridge), undefined, { timeout: 5000 })
    await page.evaluate(async () => {
      const api = (window as any).AuditHtmlBridge, abort = new AbortController(), events = new Map<string, Set<(value: any) => void>>(), states: Record<string, any> = {}, mounts: any[] = []
      const scope = { instanceId: 'source', runScopeId: 'audit', generation: 1, signal: abort.signal, isActive: () => !abort.signal.aborted, cleanup() {}, target() { return null },
        state: { get: (name: string) => states[name], set: (name: string, value: any) => { states[name] = value }, subscribe: () => () => {} },
        events: { emit(name: string, value: any) { for (const fn of events.get(name) ?? []) fn(value) }, subscribe(name: string, fn: (value: any) => void) { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(fn); return () => set.delete(fn) } } }
      const teacher = (result: boolean) => ({ read: () => ({ scenes: [{ id: 'B', title: 'B' }], zoom: 1 }), canExecute: () => true, execute: async () => result, subscribe: () => () => {}, setCollapsed() {}, moveBy() {}, setZoom() {}, resetView() {} })
      const q: any = { api, abort, scope, states, mounts, clicks: 0 }
      events.set('__runtime.node-click', new Set([() => { q.clicks++ }]))
      const prepared = await api.prepareSandboxComponent({ format: 'esm', css: '', diagnostics: [], code: `export default {mount({root,scope,teacherController,interactions}){
        const button=document.createElement('button');button.textContent='navigate';root.append(button);
        button.addEventListener('click',event=>{event.stopPropagation();teacherController.execute({type:'scene.go',sceneId:'B'}).then(result=>scope.state.set('navigation',result))});
        scope.events.subscribe('read',()=>scope.state.set('fact',scope.target({kind:'instance',instanceId:'B'}).read()));
        interactions.subscribeTrigger({type:'presenter.command',command:'next'},async mode=>{if(mode==='throw')throw new Error('author failure');if(mode==='wait')await new Promise(done=>window.finishTrigger=done);return mode!=='false'});
        return {update(){scope.state.set('unexpectedUpdate',true)},dispose(){}}}}` }, abort.signal,
        { state: () => ({}), targets: () => [{ reference: { kind: 'instance', instanceId: 'B' }, instanceId: 'B', value: { text: 'before' } }], teacherController: teacher(true) })
      const mounted = await prepared.implementation.mount({ root: document.getElementById('source'), instance: { id: 'source', definitionId: 'custom', data: {} }, scope, teacherController: teacher(false),
        interactions: { currentSurfaceId: () => 'A', currentStateId: () => null, courseState: scope.state, report(message: string) { states.diagnostic = message }, executeAction: () => false,
          subscribeTrigger(_trigger: any, listener: any) { q.trigger = listener; return () => { q.trigger = undefined } } } })
      mounts.push(mounted); (window as any).__htmlBridge = q
    })
    await page.waitForFunction(() => Boolean((window as any).__htmlBridge.trigger))
    const source = page.frameLocator('#source iframe')
    await source.locator('button').click()
    await page.waitForFunction(() => (window as any).__htmlBridge.states.navigation === false)
    expect(await page.evaluate(() => (window as any).__htmlBridge.clicks)).toBe(1)
    expect(await page.evaluate(async () => (window as any).__htmlBridge.trigger('false'))).toBe(false)
    expect(await page.evaluate(async () => (window as any).__htmlBridge.trigger('true'))).toBe(true)
    expect(await page.evaluate(async () => { try { await (window as any).__htmlBridge.trigger('throw'); return 'fulfilled' } catch (error) { return String(error) } })).toContain('author failure')
    await page.evaluate(() => { const q = (window as any).__htmlBridge; q.settled = false; q.pending = q.trigger('wait').then((value: boolean) => { q.settled = true; return value }); q.scope.events.emit('__runtime.targets', [{ reference: { kind: 'instance', instanceId: 'B' }, instanceId: 'B', value: { text: 'after' } }]); q.scope.events.emit('read', {}) })
    await page.waitForFunction(() => (window as any).__htmlBridge.states.fact?.text === 'after')
    expect(await page.evaluate(() => ({ settled: (window as any).__htmlBridge.settled, updated: (window as any).__htmlBridge.states.unexpectedUpdate }))).toEqual({ settled: false, updated: undefined })
    await source.locator('button').evaluate(() => (window as any).finishTrigger())
    expect(await page.evaluate(() => (window as any).__htmlBridge.pending)).toBe(true)

    await page.evaluate(async () => {
      const q = (window as any).__htmlBridge, escape = (html: string) => html.replace(/&/g, '&amp;').replace(/"/g, '&quot;'), image = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="${color}"/></svg>`)}`
      q.resources = { asset: image('red') }; q.nextImage = image('blue')
      const grandchild = '<input value="grandchild"><img src="cw-resource:r1"><button onclick="event.stopPropagation()">grandchild</button>'
      const child = `<input value="child"><img src="cw-resource:r1"><iframe id="grandchild" srcdoc="${escape(grandchild)}"></iframe>`
      const instance = { id: 'web', definitionId: 'web', data: { html: `<!doctype html><html><body><iframe id="child" srcdoc="${escape(child)}"></iframe></body></html>`, resourceBindings: { 'cw-resource:r1': 'asset' } } }
      const prepared = await q.api.prepareSandboxComponent({ format: 'esm', code: q.api.webContentRealmSource(), css: '', diagnostics: [] }, q.abort.signal,
        { builtinKey: 'guoling.html-program', state: () => ({}), targets: () => [], resources: () => q.resources, instance: (value: any) => q.api.resolveWebResourceBindings(value, (id: string) => q.resources[id]) })
      const mounted = await prepared.implementation.mount({ root: document.getElementById('web'), instance, scope: { ...q.scope, instanceId: 'web', generation: 2 } }); q.mounts.push(mounted)
    })
    const child = page.frameLocator('#web iframe').frameLocator('#child'), grandchild = child.frameLocator('#grandchild')
    await child.locator('input').fill('kept child'); await grandchild.locator('input').fill('kept grandchild')
    await grandchild.locator('button').click()
    await page.waitForFunction(() => (window as any).__htmlBridge.clicks === 2)
    await page.evaluate(() => { const q = (window as any).__htmlBridge; q.resources = { asset: q.nextImage }; q.scope.events.emit('__runtime.resources', q.resources) })
    const next = await page.evaluate(() => (window as any).__htmlBridge.nextImage)
    await expect.poll(() => grandchild.locator('img').getAttribute('src'), { timeout: 3000 }).toBe(next)
    expect(await child.locator('img').getAttribute('src')).toBe(next)
    expect(await child.locator('input').inputValue()).toBe('kept child'); expect(await grandchild.locator('input').inputValue()).toBe('kept grandchild')
    expect(await page.evaluate(() => (window as any).__htmlBridge.clicks)).toBe(2)

    await page.evaluate(async () => {
      const q = (window as any).__htmlBridge, root = document.createElement('div'); root.id = 'teacher'; document.body.append(root)
      Object.assign(root.style, { position: 'absolute', left: '100px', top: '440px', width: '880px', height: '64px', transform: 'scale(.5)', transformOrigin: '0 0' })
      const subscribers = new Set<() => void>(), state = { scenes: Array.from({ length: 12 }, (_unused, index) => ({ id: `scene${index}`, name: `Scene ${index}` })), locationId: 'scene0', collapsed: false, zoom: 1, interactive: true }
      const host = { read: () => state, viewportBounds: () => ({ left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight }), canExecute: () => true,
        execute: async (action: any) => { q.sceneAction = action; return true }, subscribe: (listener: () => void) => { subscribers.add(listener); return () => subscribers.delete(listener) },
        moveBy(dx: number, dy: number) { q.dragX = (q.dragX ?? 0) + dx; q.dragY = (q.dragY ?? 0) + dy; root.style.left = `${100 + q.dragX}px`; root.style.top = `${440 + q.dragY}px`; for (const fn of subscribers) fn() },
        setCollapsed(value: boolean) { state.collapsed = value; for (const fn of subscribers) fn() }, setZoom() {}, resetView() {} }
      const instance = { id: 'teacher', definitionId: 'teacher-source', frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] }, data: { ...q.api.createTeacherControllerData(), defaultCollapsed: false } }
      q.teacherInstance = instance; q.teacherFrame = JSON.stringify(instance.frame)
      const prepared = await q.api.prepareSandboxComponent({ format: 'esm', code: `export default {mount:(${q.api.mountTeacher.toString()})}`, css: '', diagnostics: [] }, q.abort.signal, { state: () => ({}), targets: () => [], teacherController: host })
      q.mounts.push(await prepared.implementation.mount({ root, instance, scope: { ...q.scope, instanceId: 'teacher', generation: 3 }, teacherController: host }))
    })
    const teacher = page.frameLocator('#teacher iframe'), identity = teacher.locator('.identity')
    const clientPoint = async (locator: ReturnType<typeof identity.getByRole>, hostId = 'teacher') => {
      const local = await locator.evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })
      return page.evaluate(({ point, id }) => { const api = (window as any).__htmlBridge.api; return api.transformPoint(api.flowContentClientMatrix(document.querySelector(`#${id} iframe`)), point) }, { point: local, id: hostId })
    }
    const start = await clientPoint(identity)
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down(); await page.mouse.move(start.x + 20, start.y)
    await page.waitForFunction(() => Math.abs((window as any).__htmlBridge.dragX - 20) < .5)
    await page.mouse.move(start.x + 40, start.y); await page.mouse.up()
    await page.waitForFunction(() => Math.abs((window as any).__htmlBridge.dragX - 40) < .5)
    expect(Math.abs(await page.evaluate(() => (window as any).__htmlBridge.dragY))).toBeLessThan(.5)
    const directoryPoint = await clientPoint(teacher.getByRole('button', { name: '场景目录', exact: true })); await page.mouse.click(directoryPoint.x, directoryPoint.y)
    const scene = await clientPoint(teacher.getByRole('button', { name: 'Scene 0', exact: true }))
    await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y) === document.querySelector('#teacher iframe'), scene)).toBe(true)
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await page.mouse.click(scene.x, scene.y)
    await page.waitForFunction(() => (window as any).__htmlBridge.sceneAction?.sceneId === 'scene0')
    const collapse = await clientPoint(teacher.getByRole('button', { name: '收起教师控制器', exact: true })); await page.mouse.click(collapse.x, collapse.y)
    await expect.poll(() => page.evaluate(() => {
      const root = document.getElementById('teacher')!, rect = root.getBoundingClientRect()
      return document.elementFromPoint(rect.left + 20, rect.top + 10) === document.querySelector('#teacher iframe')
    })).toBe(false)
    expect(await page.evaluate(() => JSON.stringify((window as any).__htmlBridge.teacherInstance.frame) === (window as any).__htmlBridge.teacherFrame)).toBe(true)

    await page.evaluate(async () => {
      const q = (window as any).__htmlBridge, root = document.createElement('div'); root.id = 'popover'; document.body.append(root)
      Object.assign(root.style, { position: 'absolute', left: '80px', top: '100px', width: '180px', height: '40px' })
      const prepared = await q.api.prepareSandboxComponent({ format: 'esm', code: q.api.popoverSource, css: '', diagnostics: [] }, q.abort.signal, { state: () => ({}), targets: () => [] })
      q.mounts.push(await prepared.implementation.mount({ root, instance: { id: 'popover', definitionId: 'popover-source', frame: { width: 180, height: 40, transform: [1, 0, 0, 1, 80, 100] }, data: { label: 'show portal', content: 'ordinary body portal' } }, scope: { ...q.scope, instanceId: 'popover', generation: 4 } }))
    })
    const portal = page.frameLocator('#popover iframe')
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const clicksBeforePortal = await page.evaluate(() => (window as any).__htmlBridge.clicks)
    await portal.getByRole('button', { name: 'show portal', exact: true }).click()
    const portalBox = await portal.getByRole('dialog').boundingBox(); if (!portalBox) throw new Error('body portal')
    expect(portalBox.height).toBeGreaterThan(40)
    const closePoint = await clientPoint(portal.getByRole('button', { name: '关闭', exact: true }), 'popover')
    await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y) === document.querySelector('#popover iframe'), closePoint)).toBe(true)
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await page.mouse.click(closePoint.x, closePoint.y)
    await expect.poll(() => portal.getByRole('dialog').isVisible()).toBe(false)
    expect(await page.evaluate(() => (window as any).__htmlBridge.clicks)).toBe(clicksBeforePortal + 2)
    await page.evaluate(async () => { const q = (window as any).__htmlBridge; for (const mounted of q.mounts) await mounted.dispose(); q.abort.abort() })
    expect(errors).toEqual([])
  } finally {
    await app?.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    const target = resolve(directory), base = resolve(tmpdir())
    if (!target.startsWith(base + '\\') && !target.startsWith(base + '/')) throw new Error('unexpected fixture directory')
    await rm(target, { recursive: true, force: true })
  }
}, 30_000)
