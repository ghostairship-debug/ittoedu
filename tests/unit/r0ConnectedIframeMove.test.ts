// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('parks and restores connected source iframes beyond the native counter boundary without reloading their state', async () => {
  const bundle = await build({ stdin: { contents: `export { ComponentPlatformRuntime } from './src/player/components/ComponentPlatformRuntime';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'WorldProbe', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'existing-raw-import', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw-text' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw-text' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/world.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/world.js' ? bundle.outputFiles[0]!.text : '<!doctype html><div id="first"></div><div id="second"></div><script src="/world.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing isolated runtime fixture address')
  const directory = await mkdtemp(join(tmpdir(), 'r0-connected-frame-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const entry = join(directory, 'main.cjs')
    await writeFile(entry, `const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.commandLine.appendSwitch('disable-background-timer-throttling');
      app.whenReady().then(() => { const window = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
        window.loadURL(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}); });`)
    console.log('Connected iframe stage: launch')
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 5000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const versions = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }))
    console.log('Connected iframe native carrier', versions)
    const page = await app.firstWindow()
    page.on('console', message => console.log('Connected iframe renderer:', message.text()))
    page.on('pageerror', error => console.error('Connected iframe pageerror:', error.message))
    const nativeCrash = new Promise<never>((_resolve, reject) => page.once('crash', () => {
      console.error('Connected iframe renderer native crash')
      reject(new Error('Connected iframe renderer native crash'))
    }))
    console.log('Connected iframe stage: load World', page.url())
    await page.waitForFunction(() => !!(window as any).WorldProbe, undefined, { timeout: 5000 })
    console.log('Connected iframe stage: mount/move')
    const observed = await Promise.race([nativeCrash, page.evaluate(async () => {
      const first = document.getElementById('first')!, second = document.getElementById('second')!
      let mounts = 0, disposals = 0
      const errors: string[] = []
      const world = new (window as any).WorldProbe.ComponentPlatformRuntime('native-move', { mode: 'edit', report: (error: string) => errors.push(error),
        resolveSource: async () => ({ implementation: { async mount({ root }: any) {
          mounts++
          const inside = document.createElement('div')
          inside.innerHTML = '<span>before</span><iframe id="realm-a"></iframe><iframe id="realm-b"></iframe><span>after</span>'
          root.append(inside)
          await Promise.all([...inside.querySelectorAll('iframe')].map((frame, index) => new Promise<void>(resolve => {
            frame.onload = () => resolve()
            frame.srcdoc = `<input value="initial"><script>window.marker={id:${index}};window.ticks=0;setInterval(()=>window.ticks++,5)<\/script>`
          })))
          return { update() {}, dispose() { disposals++; inside.remove() } }
        } } }) })
      world.bind('program', first)
      const project = { schemaVersion: 10, revision: 0, id: 'native-move', title: '移动源组件',
        definitions: { program: { id: 'program', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
        instances: { program: { id: 'program', definitionId: 'program', data: {}, frame: { width: 320, height: 180, transform: [1,0,0,1,0,0] } } },
        surfaces: [{ id: 'page', kind: 'flow', title: '讲义', childIds: ['program'] }], global: { underlay: [], overlay: [] }, assets: {} }
      await world.sync(project, { assets: {}, components: {} })
      console.log('Connected iframe source mounted')
      const frames = [...first.querySelectorAll('iframe')]
      const saved = frames.map((frame, index) => {
        const realm = frame.contentWindow! as any, input = realm.document.querySelector('input')!
        input.value = `teacher-input-${index}`
        return { frame, realm, document: realm.document, marker: realm.marker, input }
      })
      for (let iteration = 0; iteration < 1100; iteration++) {
        world.beforeProjectionMutation()
        world.bind('program', null)
        world.bind('program', iteration % 2 ? first : second)
        world.afterProjectionMutation()
        if (iteration % 100 === 0) console.log('Connected iframe cycle', iteration)
      }
      await new Promise(resolve => setTimeout(resolve, 30))
      const current = [...first.querySelectorAll('iframe')]
      const retained = saved.map(({ frame, realm, document, marker, input }, index) => ({
        sameFrame: current[index] === frame, sameWindow: frame.contentWindow === realm, sameDocument: realm.document === document,
        sameMarker: realm.marker === marker, sameInput: realm.document.querySelector('input') === input,
        inputValue: input.value, ticks: realm.ticks, connected: frame.isConnected,
      }))
      const order = [...frames[0]!.parentElement!.children].map(element => element.id || element.textContent)
      const result = { retained, order, mounts, disposals, errors }
      await world.dispose()
      return { ...result, retiredFrameCount: document.querySelectorAll('iframe').length, finalDisposals: disposals }
    })])
    expect(observed.mounts).toBe(1); expect(observed.disposals).toBe(0); expect(observed.errors).toEqual([])
    expect(observed.order).toEqual(['before', 'realm-a', 'realm-b', 'after'])
    observed.retained.forEach((frame, index) => {
      expect(frame).toMatchObject({ sameFrame: true, sameWindow: true, sameDocument: true, sameMarker: true, sameInput: true, connected: true, inputValue: `teacher-input-${index}` })
      expect(frame.ticks).toBeGreaterThan(0)
    })
    expect(observed.retiredFrameCount).toBe(0); expect(observed.finalDisposals).toBe(1)
  } finally {
    await app?.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
