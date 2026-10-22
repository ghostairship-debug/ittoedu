import { _electron as electron, chromium, expect, test, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/glx-work-containers-20261020/final-ui')
const pointerFacts: unknown[] = []
test.beforeEach(() => { pointerFacts.length = 0 })
const env = () => Object.fromEntries(Object.entries({ ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_E2E_BACKGROUND: '1' })
  .filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(key))) as Record<string, string>
async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: env() })
  const page = await app.firstWindow()
  const windowFacts = await app.evaluate(({ BrowserWindow, screen }, hwndMode) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setContentSize(1600, 1000)
    // Windows routes OOPIF input only through a shown HWND at normal coordinates.
    // Transparency and showInactive preserve real input without taking focus.
    if (hwndMode !== 'offscreen') { window.setPosition(0, 0); window.setSkipTaskbar(true); window.setOpacity(hwndMode === 'foreground' ? 1 : 0); window.showInactive(); if (hwndMode === 'foreground') window.focus() }
    return { bounds: window.getBounds(), content: window.getContentBounds(), visible: window.isVisible(), focused: window.isFocused(), opacity: window.getOpacity(), deviceScaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor, hwndMode }
  }, process.env.GLX_OOPIF_HWND ?? 'transparent')
  await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
  return { app, page, windowFacts }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}
async function open(app: ElectronApplication, page: Page, workspace: string, filename: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: filename, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  const id = await frame.getAttribute('data-document-id')
  if (!id) throw new Error('No formal editor document')
  return id
}
async function snapshot(page: Page, id: string) {
  const value = await page.evaluate(id => window.desktopAPI.documents!.read(id), id)
  if (value.model.kind !== 'course-v10') throw new Error('Expected canonical work')
  return { ...value, model: value.model }
}
async function saveAs(app: ElectronApplication, page: Page, id: string, filename: string) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, filename)
  await page.getByRole('button', { name: '另存为', exact: true }).click()
  await expect.poll(() => snapshot(page, id).then(value => value.dirty)).toBe(false)
  return snapshot(page, id)
}
async function tools(app: ElectronApplication, id: string, workspace: string, calls: Array<{ name: string; input: unknown }>, family = 'content') {
  return app.evaluate(async ({ app }, input) => {
    const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
    const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
    const runId = `mixed-loop-${Date.now()}`
    await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: input.id, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    await host.tools.loadToolFamilies(runId, [input.family])
    try {
      const opened = await host.tools.completeOpenedDocument(runId, { documentId: input.id, writable: true }, { selection: 'preserve' })
      const receipts = []
      for (const [index, call] of input.calls.entries()) {
        const result = await host.tools.execute(runId, `call-${index}`, { name: call.name, input: call.name === 'document.export' ? { ...(call.input as object), target: opened.target } : call.input })
        receipts.push({ name: call.name, result })
        if (result.kind === 'error') throw new Error(`${call.name}: ${JSON.stringify(result)}`)
      }
      return receipts
    } finally { await host.tools.stop(runId) }
  }, { id, workspace, calls, family })
}
async function contentFrame(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.locator(selector).count().catch(() => 0)) { found = frame; return true }
    return false
  }, { message: `Actual content frame for ${selector}` }).toBe(true)
  return found!
}
async function diagnostics(page: Page) {
  return {
    alerts: await page.getByRole('alert').allTextContents(),
    host: await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="program-workspace"],[data-program-viewport],[data-component-instance],iframe')].map(element => ({
      tag: element.tagName, data: { ...element.dataset }, rect: element.getBoundingClientRect().toJSON(), style: element.getAttribute('style'),
      ancestors: (() => { const result = []; for (let node: HTMLElement | null = element; node && result.length < 7; node = node.parentElement) result.push({ tag: node.tagName, className: node.className, height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility, hidden: node.hidden }); return result })(),
    }))),
    frames: await Promise.all(page.frames().map(frame => frame.evaluate(() => ({ url: location.href, viewport: { width: innerWidth, height: innerHeight }, readyState: document.readyState,
      activity: Reflect.get(window, '__guolingRuntimeActivity'), scripts: [...document.scripts].map(script => ({ type: script.type, src: script.src, length: script.textContent?.length })),
      buttons: [...document.querySelectorAll('button')].slice(0, 12).map(button => ({ text: button.textContent, handler: typeof button.onclick, disabled: button.disabled, pointer: getComputedStyle(button).pointerEvents, rect: button.getBoundingClientRect().toJSON() })),
      title: document.querySelector('h1')?.textContent, body: { html: document.body.outerHTML.slice(0, 1200), style: getComputedStyle(document.body).cssText, rect: document.body.getBoundingClientRect().toJSON() } })).catch(error => ({ error: String(error) })))),
  }
}
async function runMode(page: Page) {
  const program = page.getByTestId('program-workspace')
  if (await program.count()) {
    const button = program.getByRole('button', { name: '运行', exact: true })
    if (await button.count()) await button.click()
  } else await page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
}
async function trustedClick(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  const local = await target.evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const ancestors = []
    for (let node: HTMLElement | null = element as HTMLElement; node && ancestors.length < 6; node = node.parentElement) ancestors.push({ tag: node.tagName, data: { ...node.dataset }, pointer: getComputedStyle(node).pointerEvents, hidden: node.hidden, inert: node.inert })
    return { x, y, hit: element.contains(document.elementFromPoint(x, y)), ancestors }
  })
  expect(local.hit).toBe(true)
  let point = { x: local.x, y: local.y }, frame = await (await target.elementHandle())!.ownerFrame()
  while (frame?.parentFrame()) {
    const element = await frame.frameElement()
    const box = await element.evaluate(node => { const iframe = node as HTMLIFrameElement; return { rect: iframe.getBoundingClientRect().toJSON(), width: iframe.offsetWidth, height: iframe.offsetHeight, left: iframe.clientLeft, top: iframe.clientTop } })
    const painted = frame.parentFrame() === page.mainFrame() ? await element.boundingBox() : box.rect
    if (!painted) throw new Error('Source iframe has no real pointer box')
    point = { x: painted.x + (box.left + point.x) * painted.width / box.width, y: painted.y + (box.top + point.y) * painted.height / box.height }
    frame = frame.parentFrame()
  }
  const topHit = await page.evaluate(({ x, y }) => { const element = document.elementFromPoint(x, y); return element && { tag: element.tagName, id: element.id, classes: element.className } }, point)
  pointerFacts.push({ local, point, topHit })
  await page.mouse.click(point.x, point.y)
}
async function offline(filename: string, work: (page: Page) => Promise<unknown>) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, offline: true })
  const page = await context.newPage(), errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route(/^https?:/i, route => { requests.push(route.request().url()); return route.abort() })
  try {
    await page.goto(pathToFileURL(filename).href)
    await page.evaluate(async () => { await (window as any).coursePlayerReady })
    const facts = await work(page)
    expect(errors).toEqual([]); expect(requests).toEqual([])
    return { facts, errors, requests }
  } finally { await browser.close() }
}

const v2Html = `<!doctype html><html><head><meta charset="utf-8"><title>V2 program</title><style>
html,body{margin:0;width:100%;height:100%;background:#15334c;color:#fff;font:24px Arial}main{padding:40px;box-sizing:border-box}button,input{font:inherit;padding:10px;margin:12px}canvas{display:block;background:#234d6b;width:360px;height:100px}output{display:block;margin:20px}</style></head>
<body data-step="2"><main data-v2-root><h1>V2 original title</h1><label>Answer<input id="v2-answer" value="initial"></label><button id="v2-apply">Apply input</button><output id="v2-result">Ready</output><canvas id="v2-canvas" width="360" height="100"></canvas></main>
<script>document.getElementById('v2-apply').onclick=()=>{document.getElementById('v2-result').textContent=document.getElementById('v2-answer').value+' / '+(Number(document.body.dataset.step) + 0)};let ticks=0;const canvas=document.getElementById('v2-canvas');function paint(){canvas.dataset.ticks=String(++ticks);const ctx=canvas.getContext('2d');ctx.fillStyle='#69dbb0';ctx.fillRect(ticks%360,20,2,40);requestAnimationFrame(paint)};paint();</script></body></html>`
async function probeProgram(page: Page, title: string, result: string, entered: string) {
  const content = await contentFrame(page, '[data-v2-root]')
  await expect(content.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await content.getByRole('textbox', { name: 'Answer', exact: true }).fill(entered)
  await trustedClick(page, content.getByRole('button', { name: 'Apply input', exact: true }))
  await expect(content.locator('#v2-result')).toHaveText(`${entered} / ${result}`)
  const ticks = Number(await content.locator('#v2-canvas').getAttribute('data-ticks'))
  await expect.poll(async () => Number(await content.locator('#v2-canvas').getAttribute('data-ticks'))).toBeGreaterThan(ticks)
  return { result: await content.locator('#v2-result').textContent(), ticksBefore: ticks, ticksAfter: Number(await content.locator('#v2-canvas').getAttribute('data-ticks')) }
}

test('V2 public program entry keeps input and animation through local edits, GLX cold reopen and offline HTML', async ({}, info) => {
  test.setTimeout(150_000)
  await mkdir(path.join(base, 'v2'), { recursive: true })
  const directory = await mkdtemp(path.join(base, 'v2/run-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace); await writeFile(path.join(directory, 'input.html'), v2Html)
  const facts: Record<string, any> = { directory, scope: 'isolated formal technical carrier; no model or provider requests' }, errors: string[] = []
  let warm: Awaited<ReturnType<typeof launch>> | undefined, cold: Awaited<ReturnType<typeof launch>> | undefined
  try {
    warm = await launch(path.join(directory, 'warm-profile')); warm.page.on('pageerror', error => errors.push(error.message))
    facts.warmWindow = warm.windowFacts
    facts.created = await warm.app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      await requireProduct('./dist-electron/core/components/source/builtinSources.js').loadBuiltinComponentSource('guoling.html-program')
      const project = requireProduct('./dist-electron/core/course/createCourseProjectV10.js').createBlankProgramProject('V2 program')
      const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'v2-initial.glx')
      const runId = 'v2-program-create'
      await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
      await host.tools.loadToolFamilies(runId, ['content'])
      try {
        const receipt = await host.tools.execute(runId, 'set', { name: 'project.apply', input: { path: 'entry.html', intent: 'program.set', content: input.html } })
        if (receipt.kind === 'error') throw new Error(JSON.stringify(receipt))
        await host.internalAPI.save(initial.documentId, input.filename)
        return { receipt, documentId: initial.documentId, rootIds: (await host.internalAPI.read(initial.documentId)).model.project.rootIds }
      } finally { await host.tools.stop(runId) }
    }, { workspace, filename: path.join(workspace, 'v2-initial.glx'), html: v2Html })
    const id = await open(warm.app, warm.page, workspace, 'v2-initial.glx')
    await expect(warm.page.getByTestId('program-workspace')).toBeVisible()
    const original = await snapshot(warm.page, id)
    expect(Object.values(original.model.project.instances).some(instance => instance.container?.kind === 'slide')).toBe(false)
    await runMode(warm.page); facts.warmInput = await probeProgram(warm.page, 'V2 original title', '2', 'warm input')
    facts.edits = await tools(warm.app, id, workspace, [
      { name: 'project.read', input: { path: 'entry.html', full: true } },
      { name: 'project.apply', input: { path: 'entry.html', edits: [
        { old: 'V2 original title', new: 'V2 locally revised title' },
        { old: 'data-step="2"', new: 'data-step="3"' },
        { old: 'Number(document.body.dataset.step) + 0', new: 'Number(document.body.dataset.step) + 1' },
      ] } },
    ])
    facts.authorAfterEdits = await snapshot(warm.page, id)
    facts.editedInput = await probeProgram(warm.page, 'V2 locally revised title', '4', 'edited input')
    await warm.page.getByTestId('program-workspace').getByRole('button', { name: '编辑', exact: true }).click()
    await warm.page.keyboard.press('Control+z')
    await expect.poll(() => snapshot(warm!.page, id).then(value => value.model.project.instances)).toEqual(original.model.project.instances)
    await warm.page.keyboard.press('Control+Shift+z')
    await expect.poll(() => snapshot(warm!.page, id).then(value => value.model.project.instances)).toEqual(facts.authorAfterEdits.model.project.instances)
    await runMode(warm.page)
    facts.redoneInput = await probeProgram(warm.page, 'V2 locally revised title', '4', 'redone input')
    facts.history = { undoRestoredOriginalInstances: true, redoRestoredEditedInstances: true }
    const destination = path.join(workspace, 'v2-saved.glx'), saved = await saveAs(warm.app, warm.page, id, destination)
    expect(saved.model.project.rootIds).toEqual(original.model.project.rootIds)
    facts.warmPid = await warm.app.evaluate(() => process.pid)
    await warm.page.screenshot({ path: path.join(directory, 'warm-edited.png') })
    await close(warm.app); warm = undefined
    cold = await launch(path.join(directory, 'cold-profile')); cold.page.on('pageerror', error => errors.push(error.message))
    facts.coldWindow = cold.windowFacts
    facts.coldPid = await cold.app.evaluate(() => process.pid); expect(facts.coldPid).not.toBe(facts.warmPid)
    const coldId = await open(cold.app, cold.page, workspace, 'v2-saved.glx'), reopened = await snapshot(cold.page, coldId)
    expect(reopened.model).toEqual(saved.model); expect(reopened.dirty).toBe(false)
    await runMode(cold.page); facts.coldInput = await probeProgram(cold.page, 'V2 locally revised title', '4', 'cold input')
    await cold.page.screenshot({ path: path.join(directory, 'cold-running.png') })
    facts.export = await tools(cold.app, coldId, workspace, [{ name: 'document.export', input: { format: 'html-offline', destination: 'v2-offline.html' } }], 'build')
    expect(facts.export[0].result).toMatchObject({ kind: 'read', data: { status: 'written' } })
    await close(cold.app); cold = undefined
    facts.offline = await offline(path.join(workspace, 'v2-offline.html'), async page => {
      const actual = await probeProgram(page, 'V2 locally revised title', '4', 'offline input')
      expect(await page.locator('[data-compiled-surface]').count()).toBe(0)
      await page.screenshot({ path: path.join(directory, 'offline-running.png') })
      return actual
    })
    expect(errors).toEqual([])
  } catch (error) { facts.failure = String(error); if (warm) facts.failureGeometry = await diagnostics(warm.page).catch(String); throw error }
  finally {
    if (warm) { await warm.page.screenshot({ path: path.join(directory, 'failure-warm.png') }).catch(() => undefined); await close(warm.app) }
    if (cold) { await cold.page.screenshot({ path: path.join(directory, 'failure-cold.png') }).catch(() => undefined); await close(cold.app) }
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ ...facts, errors, pointerFacts }, null, 2))
    await info.attach('V2 facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})

const v3Source = `export default { mount(context) {
  const side=context.instance.data.side,nav=context.teacherController.forContainer?.(side)??context.teacherController,cameraId=side+'-camera',cameraNav=context.teacherController.forContainer?.(cameraId)??context.teacherController,root=context.root;
  root.dataset.v3Controls=side;root.style.cssText='font:16px Arial;display:flex;flex-wrap:wrap;align-items:center;gap:8px;pointer-events:auto';
  const detail=document.createElement('button'),zoom=document.createElement('button'),pan=document.createElement('button'),canvas=document.createElement('canvas'),readout=document.createElement('output');
  detail.textContent=side+' source detail';zoom.textContent=side+' source zoom';readout.dataset.camera=side;
  pan.textContent=side+' program pan';canvas.width=96;canvas.height=32;canvas.dataset.programView=side;canvas.dataset.localViewX='0';canvas.style.background='#0b2740';let localViewX=0;const paintProgram=()=>{const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,localViewX,0);ctx.fillStyle='#66e0b5';ctx.fillRect(4,6,20,20);canvas.dataset.localViewX=String(localViewX)};pan.onclick=()=>{localViewX+=8;paintProgram()};paintProgram();
  let detailClicks=0,zoomClicks=0;detail.onclick=async()=>{detail.dataset.clicks=String(++detailClicks);const ok=await nav.execute({type:'scene.go',containerId:side,sceneId:side,targetStateId:'detail'});detail.dataset.applied=String(ok)};
  zoom.onclick=async()=>{zoom.dataset.clicks=String(++zoomClicks);const ok=await cameraNav.execute({type:'camera.present',containerId:cameraId,pose:{x:350,y:160,zoom:1.15},motion:{durationMs:0}});zoom.dataset.applied=String(ok)};
  const paint=()=>{const current=cameraNav.read();readout.textContent=side+' camera '+(current.camera?.zoom??1).toFixed(2)};root.append(detail,zoom,pan,canvas,readout);const off=nav.subscribe(paint);paint();
  return{update(){paint()},dispose(){off();root.replaceChildren()}};
} }`
async function probeMixed(page: Page) {
  const left = await contentFrame(page, '[data-v3-controls="left"]'), right = await contentFrame(page, '[data-v3-controls="right"]')
  await expect(page.getByText('left overview', { exact: true })).toBeVisible()
  await expect(page.getByText('right overview', { exact: true })).toBeVisible()
  await trustedClick(page, left.getByRole('button', { name: 'left source detail', exact: true }))
  await expect(left.getByRole('button', { name: 'left source detail', exact: true })).toHaveAttribute('data-clicks', '1')
  await expect(page.getByText('left detail', { exact: true })).toBeVisible()
  await expect(page.getByText('right overview', { exact: true })).toBeVisible()
  await trustedClick(page, page.getByText('left native overview', { exact: true }))
  await expect(page.getByText('left overview', { exact: true })).toBeVisible()
  await trustedClick(page, left.getByRole('button', { name: 'left source zoom', exact: true }))
  await expect(left.locator('[data-camera="left"]')).toHaveText('left camera 1.15')
  await expect(right.locator('[data-camera="right"]')).toHaveText('right camera 1.00')
  await trustedClick(page, page.getByText('left native home', { exact: true }))
  await expect(left.locator('[data-camera="left"]')).toHaveText('left camera 1.00')
  await trustedClick(page, left.getByRole('button', { name: 'left program pan', exact: true }))
  await expect(left.locator('[data-program-view="left"]')).toHaveAttribute('data-local-view-x', '8')
  expect(await left.locator('[data-program-view="left"]').evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getTransform().e)).toBe(8)
  expect(await right.locator('[data-program-view="right"]').evaluate(element => (element as HTMLCanvasElement).getContext('2d')!.getTransform().e)).toBe(0)
  await expect(left.locator('[data-camera="left"]')).toHaveText('left camera 1.00'); await expect(right.locator('[data-camera="right"]')).toHaveText('right camera 1.00')
  await trustedClick(page, right.getByRole('button', { name: 'right source detail', exact: true }))
  await expect(page.getByText('right detail', { exact: true })).toBeVisible()
  await expect(page.getByText('left overview', { exact: true })).toBeVisible()
  await trustedClick(page, page.getByText('right native overview', { exact: true }))
  await expect(page.getByText('right overview', { exact: true })).toBeVisible()
  return { leftCamera: await left.locator('[data-camera="left"]').textContent(), rightCamera: await right.locator('[data-camera="right"]').textContent(), localProgramView: { leftCanvasTranslateX: 8, rightCanvasTranslateX: 0, platformCamerasUnchanged: true }, stateControls: 'Source detail → native overview for both independent containers', cameraControls: 'Source camera.present → native scene.go(camera-home)' }
}

async function createMixedFixture(app: ElectronApplication, source: string, filename: string) {
  return app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      const { TEXT_DEFINITION } = requireProduct('./dist-electron/components/text/adapters.js'), { createTextComponentData } = requireProduct('./dist-electron/components/text/data.js')
      const text = (value: string) => JSON.parse(JSON.stringify(createTextComponentData(value)))
      const frame = (width: number, height: number, x: number, y: number) => ({ width, height, transform: [1, 0, 0, 1, x, y] })
      const project: any = { schemaVersion: 11, id: 'v3-mixed', revision: 0, title: 'V3 mixed work', rootIds: ['flow', 'slide'], entry: { rootInstanceId: 'flow' },
        playback: { controls: 'none', keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } }, assets: {}, global: { underlay: [], overlay: [] },
        definitions: { text: { ...TEXT_DEFINITION, id: 'text' }, flow: { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
          slide: { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
          spatial: { id: 'spatial', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } },
          source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: input.source } },
          behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } } },
        instances: { flow: { id: 'flow', definitionId: 'flow', name: 'Mixed Flow', data: {}, childIds: ['left', 'right'], container: { kind: 'flow', flow: { layout: { readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } } } } }
      for (const side of ['left', 'right']) {
        project.instances[side] = { id: side, definitionId: 'slide', name: side === 'left' ? 'Left slide' : 'Right slide', data: {},
          frame: frame(700, 320, 0, 0), childIds: [`${side}-title`, `${side}-source`, `${side}-overview`, `${side}-home`, `${side}-note`, `${side}-rules`, `${side}-camera`],
          container: { kind: 'slide', designSize: { width: 700, height: 320 }, background: { mode: 'own', color: side === 'left' ? '#e0f2fe' : '#fef3c7' },
            presentation: { initialStateId: 'overview', states: [
              { id: 'overview', title: 'overview', overrides: {} },
              { id: 'detail', title: 'detail', overrides: { [`${side}-title`]: { data: text(`${side} detail`) } } },
            ] } } }
        project.instances[`${side}-camera`] = { id: `${side}-camera`, definitionId: 'spatial', name: `${side} camera`, data: {},
          frame: frame(120, 45, 550, 10), childIds: [`${side}-camera-marker`], container: { kind: 'spatial',
            spatial: { home: { x: 350, y: 160, zoom: 1 }, frames: [{ id: 'camera-home', title: 'Home camera', pose: { x: 350, y: 160, zoom: 1 } }] } } }
        const node = (id: string, value: string, box: unknown) => { project.instances[id] = { id, definitionId: 'text', name: value, data: text(value), frame: box } }
        node(`${side}-title`, `${side} overview`, frame(300, 50, 20, 15))
        node(`${side}-overview`, `${side} native overview`, frame(280, 45, 20, 185))
        node(`${side}-home`, `${side} native home`, frame(270, 45, 340, 185))
        node(`${side}-note`, `${side} editable note`, frame(500, 45, 20, 250))
        node(`${side}-camera-marker`, `${side} camera marker`, frame(200, 40, 300, 150))
        project.instances[`${side}-source`] = { id: `${side}-source`, definitionId: 'source', data: { side }, frame: frame(650, 90, 20, 75) }
        const rule = (id: string, nodeId: string, action: unknown) => ({ id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [], actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action }] })
        project.instances[`${side}-rules`] = { id: `${side}-rules`, definitionId: 'behavior', data: { rules: [
          rule(`${side}-overview-rule`, `${side}-overview`, { type: 'presentation.set', containerId: side, stateId: 'overview' }),
          rule(`${side}-home-rule`, `${side}-home`, { type: 'scene.go', sceneId: `${side}-camera`, targetStateId: 'camera-home' }),
        ] } }
      }
      project.instances.slide = { id: 'slide', definitionId: 'slide', name: 'Mixed Slide', data: {}, childIds: ['slide-title'], container: { kind: 'slide', designSize: { width: 960, height: 640 }, background: { mode: 'own', color: '#f0fdf4' } } }
      project.instances['slide-title'] = { id: 'slide-title', definitionId: 'text', name: 'Slide preserved title', data: text('Slide preserved title'), frame: frame(700, 90, 50, 50) }
      const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'v3-initial.glx')
      await host.internalAPI.save(initial.documentId, input.filename)
      return { documentId: initial.documentId, rootIds: project.rootIds, containers: ['flow', 'left', 'right', 'slide'] }
    }, { source, filename })
}

const v3TransitionSource = v3Source
  .replace("targetStateId:'detail'", "targetStateId:'detail',transition:{effect:'fade',durationMs:1200,easing:'linear'}")
  .replace('detail.dataset.applied=String(ok)', 'detail.dataset.applied=String(ok);detail.dataset.settles=String((Number(detail.dataset.settles)||0)+1)')
  .replace('const paint=()=>', "let nativeHits=0;root.dataset.nativeOverviewHits='0';const nativeOff=context.interactions.subscribeTrigger({type:'node.click',nodeId:side+'-overview'},()=>{root.dataset.nativeOverviewHits=String(++nativeHits)});const paint=()=>")
  .replace('dispose(){off();root.replaceChildren()}', 'dispose(){off();nativeOff();root.replaceChildren()}')

test('A06 exported mixed containers cancel only the replaced fade and keep the sibling action', async ({}, info) => {
  test.setTimeout(75_000)
  await mkdir(path.join(base, 'v3'), { recursive: true })
  const directory = await mkdtemp(path.join(base, 'v3/a06-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace); await writeFile(path.join(directory, 'controls.js'), v3TransitionSource)
  const facts: Record<string, any> = { directory, scope: 'public exported HTML, native mouse input, independent container transition cancellation' }
  let session: Awaited<ReturnType<typeof launch>> | undefined
  try {
    session = await launch(path.join(directory, 'profile'))
    facts.created = await createMixedFixture(session.app, v3TransitionSource, path.join(workspace, 'a06-mixed.glx'))
    const id = await open(session.app, session.page, workspace, 'a06-mixed.glx')
    facts.export = await tools(session.app, id, workspace, [{ name: 'document.export', input: { format: 'html-offline', destination: 'a06-mixed.html' } }], 'build')
    await close(session.app); session = undefined
    facts.offline = await offline(path.join(workspace, 'a06-mixed.html'), async page => {
      const left = await contentFrame(page, '[data-v3-controls="left"]'), right = await contentFrame(page, '[data-v3-controls="right"]')
      const leftDetail = left.getByRole('button', { name: 'left source detail', exact: true }), rightDetail = right.getByRole('button', { name: 'right source detail', exact: true })
      const running = (id: string) => page.locator(`[data-compiled-surface="${id}"]`).evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).length)
      try {
      await trustedClick(page, leftDetail); await trustedClick(page, rightDetail)
      await expect.poll(() => running('left')).toBeGreaterThan(0); await expect.poll(() => running('right')).toBeGreaterThan(0)
      await expect(page.getByText('left overview', { exact: true })).toBeVisible()
      await expect(page.getByText('right overview', { exact: true })).toBeVisible()
      await trustedClick(page, page.getByText('left native overview', { exact: true }))
      await expect(leftDetail).toHaveAttribute('data-applied', 'false'); await expect(rightDetail).toHaveAttribute('data-applied', 'true')
      for (const button of [leftDetail, rightDetail]) { await expect(button).toHaveAttribute('data-clicks', '1'); await expect(button).toHaveAttribute('data-settles', '1') }
      await expect(left.locator('[data-v3-controls="left"]')).toHaveAttribute('data-native-overview-hits', '1')
      await expect.poll(() => running('left')).toBe(0); await expect.poll(() => running('right')).toBe(0)
      await expect(page.getByText('left overview', { exact: true })).toBeVisible(); await expect(page.getByText('right detail', { exact: true })).toBeVisible()
      await page.screenshot({ path: path.join(directory, 'offline-final.png') })
      return { left: 'overview; replaced fade returned false', right: 'detail; independent fade returned true', sourceClicksEach: 1, sourceSettlesEach: 1, nativeOverviewHits: 1, animationsRemaining: 0 }
      } finally {
        facts.offlineObserved = { left: await left.locator('[data-v3-controls="left"]').evaluate(element => ({ data: { ...(element as HTMLElement).dataset }, buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.textContent, data: { ...button.dataset } })) })),
          right: await right.locator('[data-v3-controls="right"]').evaluate(element => ({ data: { ...(element as HTMLElement).dataset }, buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.textContent, data: { ...button.dataset } })) })),
          nativeTitles: await page.locator('[data-compiled-node$="-title"]').allTextContents(), leftRunning: await running('left'), rightRunning: await running('right') }
      }
    })
  } catch (error) { facts.failure = String(error); throw error }
  finally {
    if (session) await close(session.app)
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ ...facts, pointerFacts }, null, 2))
    await info.attach('A06 facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})

test('V3 mixed Flow and two Spatial containers retain local controls, native editing, cold reopen and offline interaction', async ({}, info) => {
  test.setTimeout(180_000)
  await mkdir(path.join(base, 'v3'), { recursive: true })
  const directory = await mkdtemp(path.join(base, 'v3/run-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace); await writeFile(path.join(directory, 'controls.js'), v3Source)
  const facts: Record<string, any> = { directory, scope: 'isolated formal technical carrier; library/source deep-edit acceptance reuses separate scoped evidence' }, errors: string[] = []
  let warm: Awaited<ReturnType<typeof launch>> | undefined, cold: Awaited<ReturnType<typeof launch>> | undefined
  try {
    warm = await launch(path.join(directory, 'warm-profile')); warm.page.on('pageerror', error => errors.push(error.message))
    facts.warmWindow = warm.windowFacts
    facts.created = await createMixedFixture(warm.app, v3Source, path.join(workspace, 'v3-initial.glx'))
    const id = await open(warm.app, warm.page, workspace, 'v3-initial.glx'), original = await snapshot(warm.page, id)
    await warm.page.getByTestId('scene-item-slide').click()
    await expect(warm.page.getByText('Slide preserved title', { exact: true }).first()).toBeVisible()
    await warm.page.getByTestId('flow-page-flow').click()
    await expect(warm.page.getByTestId('flow-workspace-shell')).toBeVisible()
    facts.rootNavigation = { directory: 'Flow → Slide → Flow', rootIds: original.model.project.rootIds, entry: original.model.project.entry, slideTitle: 'Slide preserved title' }
    await runMode(warm.page); facts.warmControls = await probeMixed(warm.page)
    await warm.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '编辑', exact: true }).click()
    await warm.page.getByTestId('flow-heading-left').click()
    await expect(warm.page.getByTestId('canvas-stage').first()).toBeVisible()
    const note = warm.page.getByText('left editable note', { exact: true }).first()
    await expect(note).toBeVisible()
    const noteBox = await note.boundingBox(); if (!noteBox) throw new Error('Native note has no visible edit bounds')
    await warm.page.mouse.dblclick(noteBox.x + Math.min(40, noteBox.width / 2), noteBox.y + noteBox.height / 2)
    const editor = warm.page.locator('[data-component-professional-editor] [contenteditable="true"]').first()
    await expect(editor).toBeVisible(); await editor.click(); await warm.page.keyboard.press('Control+a')
    await warm.page.keyboard.insertText('left edited and preserved'); await warm.page.keyboard.press('Control+Enter')
    await expect(warm.page.getByText('left edited and preserved', { exact: true }).first()).toBeVisible()
    const edited = await snapshot(warm.page, id)
    await warm.page.keyboard.press('Control+z')
    await expect(warm.page.getByText('left editable note', { exact: true }).first()).toBeVisible()
    await expect.poll(() => snapshot(warm!.page, id).then(value => value.model.project.instances)).toEqual(original.model.project.instances)
    await warm.page.keyboard.press('Control+Shift+z')
    await expect(warm.page.getByText('left edited and preserved', { exact: true }).first()).toBeVisible()
    await expect.poll(() => snapshot(warm!.page, id).then(value => value.model.project.instances)).toEqual(edited.model.project.instances)
    facts.history = { undoRestoredOriginalInstances: true, redoRestoredEditedInstances: true }
    await warm.page.getByTestId('container-edit-return').click()
    await expect(warm.page.getByTestId('spatial-workspace')).toHaveCount(0)
    await expect(warm.page.getByText('left edited and preserved', { exact: true }).first()).toBeVisible()
    const destination = path.join(workspace, 'v3-saved.glx'), saved = await saveAs(warm.app, warm.page, id, destination)
    const expectedInstances = structuredClone(original.model.project.instances)
    const expectedNoteData = structuredClone(original.model.project.instances['left-note']!.data) as any
    expectedNoteData.content.inlines[0].text = 'left edited and preserved'
    expectedInstances.left!.container!.presentation!.states.find(state => state.id === 'overview')!.overrides['left-note'] = { data: expectedNoteData }
    expect(saved.model.project.instances).toEqual(expectedInstances)
    expect(saved.model.project.instances['left-note']!.frame).toEqual(original.model.project.instances['left-note']!.frame)
    facts.nativeEdit = { target: { containerId: 'left', stateId: 'overview', instanceId: 'left-note' }, onlyExpectedTextOverrideChanged: true, baseAndFramePreserved: true }; facts.warmPid = await warm.app.evaluate(() => process.pid)
    await warm.page.screenshot({ path: path.join(directory, 'warm-edited-mixed.png') }); await close(warm.app); warm = undefined
    cold = await launch(path.join(directory, 'cold-profile')); cold.page.on('pageerror', error => errors.push(error.message))
    facts.coldWindow = cold.windowFacts
    facts.coldPid = await cold.app.evaluate(() => process.pid); expect(facts.coldPid).not.toBe(facts.warmPid)
    const coldId = await open(cold.app, cold.page, workspace, 'v3-saved.glx'), reopened = await snapshot(cold.page, coldId)
    expect(reopened.model).toEqual(saved.model); expect(reopened.dirty).toBe(false)
    await expect(cold.page.getByText('left edited and preserved', { exact: true }).first()).toBeVisible()
    await runMode(cold.page); facts.coldControls = await probeMixed(cold.page)
    await cold.page.screenshot({ path: path.join(directory, 'cold-running-mixed.png') })
    facts.export = await tools(cold.app, coldId, workspace, [{ name: 'document.export', input: { format: 'html-offline', destination: 'v3-offline.html' } }], 'build')
    expect(facts.export[0].result).toMatchObject({ kind: 'read', data: { status: 'written' } })
    await close(cold.app); cold = undefined
    facts.offline = await offline(path.join(workspace, 'v3-offline.html'), async page => {
      await expect(page.getByText('left edited and preserved', { exact: true })).toBeVisible()
      const actual = await probeMixed(page)
      await page.screenshot({ path: path.join(directory, 'offline-mixed.png') })
      return actual
    })
    expect(errors).toEqual([])
  } catch (error) { facts.failure = String(error); if (warm) facts.failureGeometry = await diagnostics(warm.page).catch(String); throw error }
  finally {
    if (warm) { await warm.page.screenshot({ path: path.join(directory, 'failure-warm.png') }).catch(() => undefined); await close(warm.app) }
    if (cold) { await cold.page.screenshot({ path: path.join(directory, 'failure-cold.png') }).catch(() => undefined); await close(cold.app) }
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ ...facts, errors, pointerFacts }, null, 2))
    await info.attach('V3 facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})
