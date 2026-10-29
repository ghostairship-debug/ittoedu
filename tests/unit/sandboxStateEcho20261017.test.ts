// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('retains three ordinary Source get+set increments when an earlier host echo arrives before the third click', async () => {
  // Same temporary Electron carrier as offscreenSandbox20261013. Freeze only the
  // bridge entry for the red run; its unchanged imports still resolve from src.
  const sourcePath = process.env.SANDBOX_STATE_ECHO_BEFORE === '1'
    ? resolve('output/page-action-repair-20261017/before/SandboxComponentRuntime.ts')
    : resolve('src/player/components/runtime/SandboxComponentRuntime.ts')
  const bundle = await build({ stdin: { contents: await readFile(sourcePath, 'utf8'),
    resolveDir: resolve('src/player/components/runtime'), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'EchoProbe', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text
      : '<!doctype html><div id="source" style="width:320px;height:160px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const directory = await mkdtemp(join(tmpdir(), 'sandbox-state-echo-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 8000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => Boolean((window as any).EchoProbe))
    await page.evaluate(async () => {
      const q: any = { value: 0, attempts: [], hold: false, inbox: [], replies: new Map(), sequence: 0 }
      const NativeChannel = MessageChannel
      // Delay incoming delivery, never reorder it. Parent-to-child state
      // notifications use the untouched native port and its normal FIFO order.
      ;(window as any).MessageChannel = class {
        port1: MessagePort; port2: MessagePort
        constructor() {
          const channel = new NativeChannel(); this.port1 = channel.port1; this.port2 = channel.port2
          let handler: ((event: { data: any }) => void) | null = null
          Object.defineProperty(this.port1, 'onmessage', { configurable: true, get: () => handler, set: value => { handler = value } })
          this.port1.addEventListener('message', event => {
            const deliver = () => handler?.({ data: event.data })
            if (q.hold) q.inbox.push({ message: event.data, deliver }); else deliver()
          })
        }
      }
      const events = new Map<string, Set<(value: any) => void>>(), stateListeners = new Set<(value: any) => void>()
      const emit = (name: string, value: any) => { for (const listener of events.get(name) ?? []) listener(value) }
      q.abort = new AbortController()
      q.scope = { instanceId: 'counter', runScopeId: 'state-echo', generation: 1, signal: q.abort.signal,
        isActive: () => !q.abort.signal.aborted, cleanup() {}, target: () => null,
        state: { get: () => q.value, set: (name: string, value: any) => {
          q.attempts.push(value)
          if (Object.is(q.value, value)) return
          q.value = structuredClone(value)
          for (const listener of stateListeners) listener(structuredClone(value))
          emit('__runtime.state', { name, value })
        }, subscribe: (_name: string, listener: (value: any) => void) => { stateListeners.add(listener); return () => stateListeners.delete(listener) } },
        events: { emit, subscribe(name: string, listener: (value: any) => void) {
          const listeners = events.get(name) ?? new Set(); events.set(name, listeners); listeners.add(listener)
          return () => listeners.delete(listener)
        } },
      }
      q.releaseOneWrite = () => {
        while (q.inbox.length) { const entry = q.inbox.shift(); entry.deliver(); if (entry.message.type === 'state.set') return }
        throw new Error('No queued state write')
      }
      q.releaseAll = () => { while (q.inbox.length) q.inbox.shift().deliver(); q.hold = false }
      window.addEventListener('message', event => {
        if (event.data?.type === 'state-echo.barrier') { q.replies.get(event.data.token)?.(event.data); q.replies.delete(event.data.token) }
      })
      q.barrier = () => new Promise(done => { const token = ++q.sequence; q.replies.set(token, done); emit('state-echo.barrier', token) })
      const code = `export default {mount({root,scope}){
        const button=document.createElement('button'),same=document.createElement('button'),output=document.createElement('output');button.textContent='Increment';same.textContent='Set same';root.append(button,same,output);
        const read=()=>Number(scope.state.get('count')??0),render=()=>output.textContent=String(read());
        const probe=window.echoProbe={notifications:0,feedback:false,feedbackLimit:0};
        button.addEventListener('click',()=>scope.state.set('count',read()+1));same.addEventListener('click',()=>scope.state.set('count',read()));
        scope.state.subscribe('count',()=>{probe.notifications++;render();if(probe.feedback&&probe.notifications<probe.feedbackLimit)scope.state.set('count',read())});render();
        scope.events.subscribe('state-echo.barrier',token=>parent.postMessage({type:'state-echo.barrier',token,value:read(),render:output.textContent},'*'));
        return{update(){},dispose(){}}}}`
      q.prepared = await (window as any).EchoProbe.preparePublishedNativeComponent({ format: 'esm', code, css: '', diagnostics: [] }, q.abort.signal,
        { state: () => ({ count: q.value }), targets: () => [] })
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'),
        instance: { id: 'counter', definitionId: 'counter', data: {} }, scope: q.scope })
      ;(window as any).__stateEcho = q
    })
    const button = page.frameLocator('#source iframe').getByRole('button', { name: 'Increment', exact: true })
    const barrier = () => page.evaluate(() => (window as any).__stateEcho.barrier())
    for (let expected = 1; expected <= 3; expected++) {
      await button.click()
      await page.waitForFunction(expected => (window as any).__stateEcho.attempts.length === expected, expected)
      expect(await barrier()).toMatchObject({ value: expected, render: String(expected) })
    }
    const normal = await page.evaluate(() => (window as any).__stateEcho.value)
    await page.evaluate(() => { const q = (window as any).__stateEcho; q.scope.state.set('count', 0); q.attempts = [] })
    expect(await barrier()).toMatchObject({ value: 0, render: '0' })
    await page.evaluate(() => { (window as any).__stateEcho.hold = true })
    await button.click(); await button.click()
    await page.waitForFunction(() => (window as any).__stateEcho.inbox.filter((entry: any) => entry.message.type === 'state.set').length === 2)
    await page.evaluate(() => (window as any).__stateEcho.releaseOneWrite())
    const earlierEcho = await barrier()
    await button.click()
    await page.waitForFunction(() => (window as any).__stateEcho.inbox.filter((entry: any) => entry.message.type === 'state.set').length === 2)
    await page.evaluate(() => (window as any).__stateEcho.releaseAll())
    const settled = await barrier()
    const host = await page.evaluate(() => ({ value: (window as any).__stateEcho.value, attempts: (window as any).__stateEcho.attempts }))
    expect(errors).toEqual([])
    expect({ host: host.value, ...settled }, JSON.stringify({ sourcePath, normal, earlierEcho, settled, host }))
      .toMatchObject({ host: 3, value: 3, render: '3' })
    const child = page.frameLocator('#source iframe')
    // A last no-op write must retain the first pending write's real change,
    // whose notification was suppressed while the newer write awaited ACK.
    const notificationsBeforePair = await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)
    await page.evaluate(() => { (window as any).__stateEcho.hold = true })
    await button.click()
    await child.getByRole('button', { name: 'Set same', exact: true }).click()
    await page.waitForFunction(() => (window as any).__stateEcho.inbox.filter((entry: any) => entry.message.type === 'state.set').length === 2)
    await page.evaluate(() => (window as any).__stateEcho.releaseAll())
    expect(await barrier()).toMatchObject({ value: 4, render: '4' })
    expect(await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)).toBe(notificationsBeforePair + 1)
    // A completed local write must not suppress a later external update.
    await page.evaluate(() => (window as any).__stateEcho.scope.state.set('count', 9))
    expect(await barrier()).toMatchObject({ value: 9, render: '9' })
    const notifications = await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)
    // Bound only this deliberately self-writing diagnostic listener, so a bad
    // ACK candidate reports duplicates instead of spinning the fixture forever.
    await child.locator('output').evaluate(() => { const probe = (window as any).echoProbe; probe.feedback = true; probe.feedbackLimit = probe.notifications + 5 })
    const writesBeforeSame = await page.evaluate(() => (window as any).__stateEcho.attempts.length)
    await child.getByRole('button', { name: 'Set same', exact: true }).click()
    await page.waitForFunction(count => (window as any).__stateEcho.attempts.length > count, writesBeforeSame)
    expect(await barrier()).toMatchObject({ value: 9, render: '9' })
    expect(await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)).toBe(notifications)
    await page.evaluate(() => (window as any).__stateEcho.scope.state.set('count', 10))
    // One external write and the listener's same-value feedback must both reach
    // the host. Its latest ACK can clear pending without creating a new event.
    await page.waitForFunction(() => (window as any).__stateEcho.attempts.filter((value: number) => value === 10).length >= 2)
    expect(await barrier()).toMatchObject({ value: 10, render: '10' })
    expect(await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)).toBe(notifications + 1)
    await page.evaluate(() => (window as any).__stateEcho.scope.state.set('count', 11))
    await page.waitForFunction(() => (window as any).__stateEcho.attempts.filter((value: number) => value === 11).length >= 2)
    expect(await barrier()).toMatchObject({ value: 11, render: '11' })
    expect(await child.locator('output').evaluate(() => (window as any).echoProbe.notifications)).toBe(notifications + 2)
    await page.evaluate(async () => { const q = (window as any).__stateEcho; await q.mounted.dispose(); q.prepared.release() })
  } finally {
    await app?.close(); await new Promise<void>(done => server.close(() => done()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
}, 20_000)
it('delivers shared state during remote subscription setup without initial replay or duplicate mirrors', async () => {
  const bundle = await build({ stdin: { contents: await readFile(resolve('src/player/components/runtime/SandboxComponentRuntime.ts'), 'utf8'),
    resolveDir: resolve('src/player/components/runtime'), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'StateProbe', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/probe.js' ? bundle.outputFiles[0]!.text
      : '<!doctype html><div id="source" style="width:320px;height:160px"></div><script src="/probe.js"></script>')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const directory = await mkdtemp(join(tmpdir(), 'sandbox-state-coldstart-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}));`)
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 8000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => Boolean((window as any).StateProbe))
    await page.evaluate(async () => {
      const q: any = { value: { total: 1 }, holdSubscriptions: true, inbox: [], replies: new Map(), sequence: 0 }
      const NativeChannel = MessageChannel
      // Only delay child-to-host named subscription registration. A mounted
      // Source has already subscribed locally, while other Source components
      // can publish through the normal permanent world-state bridge.
      ;(window as any).MessageChannel = class {
        port1: MessagePort; port2: MessagePort
        constructor() {
          const channel = new NativeChannel(); this.port1 = channel.port1; this.port2 = channel.port2
          let handler: ((event: { data: any }) => void) | null = null
          Object.defineProperty(this.port1, 'onmessage', { configurable: true, get: () => handler, set: value => { handler = value } })
          this.port1.addEventListener('message', event => {
            const deliver = () => handler?.({ data: event.data })
            if (q.holdSubscriptions && event.data.type === 'subscribe' && event.data.kind === 'state') q.inbox.push(deliver)
            else deliver()
          })
        }
      }
      const events = new Map<string, Set<(value: any) => void>>(), stateListeners = new Set<(value: any) => void>()
      const emit = (name: string, value: any) => { for (const listener of events.get(name) ?? []) listener(structuredClone(value)) }
      q.abort = new AbortController()
      q.scope = { instanceId: 'subscriber', runScopeId: 'state-coldstart', generation: 1, signal: q.abort.signal,
        isActive: () => !q.abort.signal.aborted, cleanup() {}, target: () => null,
        state: { get: () => structuredClone(q.value), set: (name: string, value: any) => {
          q.value = structuredClone(value)
          for (const listener of stateListeners) listener(structuredClone(value))
          emit('__runtime.state', { name, value })
        }, subscribe: (_name: string, listener: (value: any) => void) => { stateListeners.add(listener); return () => stateListeners.delete(listener) } },
        events: { emit, subscribe(name: string, listener: (value: any) => void) {
          const listeners = events.get(name) ?? new Set(); events.set(name, listeners); listeners.add(listener)
          return () => listeners.delete(listener)
        } },
      }
      q.releaseSubscriptions = () => { q.holdSubscriptions = false; while (q.inbox.length) q.inbox.shift()() }
      window.addEventListener('message', event => {
        if (event.data?.type === 'state-coldstart.barrier') { q.replies.get(event.data.token)?.(event.data); q.replies.delete(event.data.token) }
      })
      q.barrier = () => new Promise(done => { const token = ++q.sequence; q.replies.set(token, done); emit('state-coldstart.barrier', token) })
      const code = `export default {mount({root,scope}){
        const output=document.createElement('output');root.append(output);
        const read=()=>scope.state.get('result')?.total,render=()=>output.textContent=String(read());
        const probe=window.coldProbe={stateNotifications:0,eventNotifications:0,laterNotifications:0};
        probe.unsubscribe=scope.state.subscribe('result',()=>{probe.stateNotifications++;render()});
        probe.subscribeLater=()=>scope.state.subscribe('result',()=>{probe.laterNotifications++});
        scope.events.subscribe('__runtime.state',value=>{if(value.name==='result')probe.eventNotifications++});render();
        scope.events.subscribe('state-coldstart.barrier',token=>parent.postMessage({type:'state-coldstart.barrier',token,
          value:read(),render:output.textContent,stateNotifications:probe.stateNotifications,eventNotifications:probe.eventNotifications,laterNotifications:probe.laterNotifications},'*'));
        return{update(){},dispose(){}}}}`
      q.prepared = await (window as any).StateProbe.preparePublishedNativeComponent({ format: 'esm', code, css: '', diagnostics: [] }, q.abort.signal,
        { state: () => ({ result: structuredClone(q.value) }), targets: () => [] })
      q.mounted = await q.prepared.implementation.mount({ root: document.getElementById('source'),
        instance: { id: 'subscriber', definitionId: 'subscriber', data: {} }, scope: q.scope })
      ;(window as any).__stateColdstart = q
    })
    const barrier = () => page.evaluate(() => (window as any).__stateColdstart.barrier())
    expect(await barrier()).toMatchObject({ value: 1, render: '1', stateNotifications: 0, eventNotifications: 0 })
    await page.evaluate(() => (window as any).__stateColdstart.scope.state.set('result', { total: 42 }))
    // This assertion fails on the old bridge: get() becomes 42 but the view
    // remains 1, with no named callback and two __runtime.state callbacks.
    expect(await barrier()).toMatchObject({ value: 42, render: '42', stateNotifications: 1, eventNotifications: 1 })
    await page.evaluate(() => (window as any).__stateColdstart.releaseSubscriptions())
    expect(await barrier()).toMatchObject({ value: 42, render: '42', stateNotifications: 1, eventNotifications: 1 })
    await page.evaluate(() => (window as any).__stateColdstart.scope.state.set('result', { total: 43 }))
    expect(await barrier()).toMatchObject({ value: 43, render: '43', stateNotifications: 2, eventNotifications: 2 })
    const output = page.frameLocator('#source iframe').locator('output')
    await output.evaluate(() => { (window as any).coldProbe.unsubscribe(); (window as any).coldProbe.subscribeLater() })
    expect(await barrier()).toMatchObject({ value: 43, render: '43', stateNotifications: 2, eventNotifications: 2, laterNotifications: 0 })
    await page.evaluate(() => (window as any).__stateColdstart.scope.state.set('result', { total: 44 }))
    expect(await barrier()).toMatchObject({ value: 44, render: '43', stateNotifications: 2, eventNotifications: 3, laterNotifications: 1 })
    expect(errors).toEqual([])
    await page.evaluate(() => (window as any).__stateColdstart.abort.abort())
  } finally {
    await app?.close().catch(() => undefined)
    await new Promise<void>(done => server.close(() => done()))
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
}, 20_000)
