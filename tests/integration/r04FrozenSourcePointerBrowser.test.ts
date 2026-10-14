// @vitest-environment node
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'

it('R04 frozen A2 source retains held pointer and continuous drag without rebuilding controls', async () => {
  const teacher = { outputFiles: [{ text: await readFile('output/authoring-quality-20261012/diagnostics/a2-navigation-pointer/a2.navigation.js', 'utf8') }] }
  const bundle = await build({ stdin: { contents: `
    export {prepareSandboxComponent} from './src/renderer/components/SandboxComponentImplementation';
    export {ComponentNavigationOwner} from './src/renderer/components/ComponentNavigationOwner';
    export {createTeacherControllerData,TEACHER_CONTROLLER_DEFINITION} from './src/components/teacher-controller/data';
    export const teacherSource=${JSON.stringify(teacher.outputFiles[0]!.text)};`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'TeacherPointerFixture', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'fixture-raw', setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }))
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text', resolveDir: dirname(args.path) }))
    } }] })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0]!.text : '<!doctype html><body style="margin:0"><div id="teacher" style="position:absolute;left:120px;top:560px;width:880px;height:64px"></div><script src="/fixture.js"></script>')
  })
  let browser: Browser | undefined, browserPid: number | undefined, port: number | undefined
  const lifecycle: Record<string, unknown> = { nodePid: process.pid, started: new Date().toISOString() }
  try {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    port = address.port
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    const processSession = await browser.newBrowserCDPSession()
    const processInfo = await processSession.send('SystemInfo.getProcessInfo')
    browserPid = processInfo.processInfo.find((process: { type: string }) => process.type === 'browser')?.id
    await processSession.detach()
    console.info(`teacher-pointer isolated HTTP port=${port} nodePID=${process.pid} ChromiumPID=${browserPid}`)
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors: string[] = []
    page.setDefaultTimeout(4000); page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.evaluate(async () => {
      const api = Reflect.get(window, 'TeacherPointerFixture'), abort = new AbortController(), records: any[] = []
      const original = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (...args) {
        const message = args[0]
        if (message && ['source.viewport', 'teacher.snapshot', 'mount'].includes(message.type)) records.push({ type: message.type,
          viewport: structuredClone(message.viewport ?? message.sourceViewport), collapsed: message.teacher?.snapshot?.collapsed,
          locationId: message.teacher?.snapshot?.locationId, generation: message.generation })
        return Reflect.apply(original, this, args)
      }
      const root = document.getElementById('teacher')!, frame = { width: 880, height: 64, transform: [1, 0, 0, 1, 120, 560] }
      const instance = { id: 'teacher', definitionId: api.TEACHER_CONTROLLER_DEFINITION.id, frame,
        data: { ...api.createTeacherControllerData(), defaultCollapsed: true } }
      const project = { schemaVersion: 10, revision: 0, id: 'pointer', title: 'Pointer', assets: {},
        definitions: { [instance.definitionId]: api.TEACHER_CONTROLLER_DEFINITION }, instances: { teacher: instance },
        global: { underlay: [], overlay: ['teacher'] }, surfaces: [
          { id: 'A', kind: 'slide', title: 'Alpha', childIds: [], canvas: { width: 1280, height: 720 } },
          { id: 'B', kind: 'slide', title: 'Beta', childIds: [], canvas: { width: 1280, height: 720 } },
        ] }
      let surfaceId = 'A'
      const navigation = new api.ComponentNavigationOwner({ project: () => project, surfaceId: () => surfaceId,
        select: (id: string) => { surfaceId = id; return true }, interactive: () => true,
        viewportBounds: () => ({ left: 0, top: 0, right: 1280, bottom: 720 }) })
      const teacherPort = navigation.teacherPort().forInstance!('teacher'), cleanups = new Set<() => void>()
      navigation.subscribePlacement(() => { const offset = teacherPort.placement!(); root.style.left = `${120 + offset.x}px`; root.style.top = `${560 + offset.y}px` })
      const scope = { instanceId: 'teacher', runScopeId: 'pointer', generation: 1, signal: abort.signal, isActive: () => !abort.signal.aborted,
        cleanup(fn: () => void) { cleanups.add(fn) }, target() { return null }, state: { get() {}, set() {}, subscribe: () => () => {} },
        events: { emit() {}, subscribe: () => () => {} } }
      const mount = async (generation: number) => {
        const prepared = await api.prepareSandboxComponent({ format: 'esm', code: `${api.teacherSource}\n// source generation ${generation}`, css: '', diagnostics: [] }, abort.signal,
          { state: () => ({}), targets: () => [], teacherController: teacherPort })
        return prepared.implementation.mount({ root, instance, scope: { ...scope, generation }, teacherController: teacherPort })
      }
      const fixture = { navigation, teacherPort, records, root, frame, instance, mounted: await mount(1), mount,
        async remount() { await this.mounted.dispose(); this.mounted = await mount(2) },
        async dispose() { await this.mounted.dispose(); abort.abort(); navigation.dispose(); for (const fn of cleanups) fn(); MessagePort.prototype.postMessage = original },
      }
      Reflect.set(window, 'fixture', fixture)
    })
    const teacherFrame = () => page.frameLocator('#teacher iframe')
    const launcher = teacherFrame().getByRole('button', { name: '展开教师控制器', exact: true })
    await launcher.waitFor()
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const pressed = await launcher.elementHandle(), box = await launcher.boundingBox()
    if (!pressed || !box) throw new Error('Missing native launcher')
    const before = await page.evaluate(() => Reflect.get(window, 'fixture').records.length)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down(); await page.waitForTimeout(120)
    expect(await pressed.evaluate(element => element.isConnected)).toBe(true)
    expect(await page.evaluate(from => Reflect.get(window, 'fixture').records.slice(from).filter((record: any) => record.type === 'source.viewport'), before)).toEqual([])
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').teacherPort.read().collapsed)).toBe(false)
    await teacherFrame().getByRole('button', { name: '收起教师控制器', exact: true }).waitFor()

    const dragButton = teacherFrame().getByRole('button', { name: '收起教师控制器', exact: true })
    const dragHandle = await dragButton.elementHandle(), dragBox = await dragButton.boundingBox()
    if (!dragHandle || !dragBox) throw new Error('Missing drag button')
    const dragStart = await page.evaluate(() => Reflect.get(window, 'fixture').records.length)
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
    await page.mouse.down(); await page.waitForTimeout(100)
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(dragBox.x + dragBox.width / 2 - step * 6, dragBox.y + dragBox.height / 2 - step * 3)
      await page.waitForTimeout(18)
      expect(await dragHandle.evaluate(element => element.isConnected)).toBe(true)
    }
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').teacherPort.placement().x)).toBeCloseTo(-72, 0)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').teacherPort.placement().y)).toBeCloseTo(-36, 0)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').teacherPort.read().collapsed)).toBe(false)
    expect(await page.evaluate(from => Reflect.get(window, 'fixture').records.slice(from).filter((record: any) => record.type === 'teacher.snapshot'), dragStart)).toEqual([])
    await page.screenshot({ path: 'output/authoring-playback-repair-20261012/R04-frozen-source.png' })

    const semanticStart = await page.evaluate(() => Reflect.get(window, 'fixture').records.length)
    await teacherFrame().getByRole('button', { name: '下一步', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').navigation.read().locationId)).toBe('B')
    await expect.poll(() => teacherFrame().locator('.progress').textContent()).toContain('2 / 2 页')
    await teacherFrame().getByRole('button', { name: '收起教师控制器', exact: true }).click()
    await teacherFrame().getByRole('button', { name: '展开教师控制器', exact: true }).waitFor()
    const semantic = await page.evaluate(from => Reflect.get(window, 'fixture').records.slice(from), semanticStart)
    expect(semantic.some((record: any) => record.type === 'teacher.snapshot' && record.locationId === 'B')).toBe(true)
    expect(semantic.some((record: any) => record.type === 'teacher.snapshot' && record.collapsed === true)).toBe(true)
    expect(semantic.filter((record: any) => record.type === 'source.viewport')).toEqual([])

    await page.evaluate(() => { const root = Reflect.get(window, 'fixture').root; root.style.width = '780px'; root.style.height = '90px' })
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixture').records.filter((record: any) => record.type === 'source.viewport').at(-1)?.viewport)).toMatchObject({ width: 780, height: 90 })
    await expect.poll(() => teacherFrame().locator('#component-root').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))).toEqual({ width: 780, height: 90 })
    const viewport = await page.evaluate(() => Reflect.get(window, 'fixture').records.filter((record: any) => record.type === 'source.viewport').at(-1).viewport)
    const previousIframe = await page.locator('#teacher iframe').elementHandle()
    await page.evaluate(() => Reflect.get(window, 'fixture').remount())
    expect(await previousIframe!.evaluate(element => element.isConnected)).toBe(false)
    const mount = await page.evaluate(() => Reflect.get(window, 'fixture').records.filter((record: any) => record.type === 'mount').at(-1))
    expect(mount).toMatchObject({ generation: 2, viewport })
    expect(await teacherFrame().locator('#component-root').evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))).toEqual({ width: 780, height: 90 })
    expect(await teacherFrame().getByRole('button', { name: '展开教师控制器', exact: true }).isVisible()).toBe(true)
    expect(await page.evaluate(() => Reflect.get(window, 'fixture').instance.frame)).toEqual({ width: 880, height: 64, transform: [1, 0, 0, 1, 120, 560] })
    expect(errors).toEqual([])
    lifecycle.evidence = { heldMs: 120, sameGeometryMessagesWhileHeld: 0, scene: 'B', collapsed: true, resized: { width: 780, height: 90 }, freshGeneration: 2 }
    await page.evaluate(() => Reflect.get(window, 'fixture').dispose())
    await page.close()
  } finally {
    await browser?.close()
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    Object.assign(lifecycle, { port, browserPid, closed: new Date().toISOString(), browserConnected: browser?.isConnected() ?? false, serverListening: server.listening })
    const output = resolve('output/authoring-playback-repair-20261012')
    await mkdir(output, { recursive: true })
    await writeFile(resolve(output, `R04-frozen-browser-${Date.now()}.json`), JSON.stringify(lifecycle, null, 2))
  }
}, 30_000)
