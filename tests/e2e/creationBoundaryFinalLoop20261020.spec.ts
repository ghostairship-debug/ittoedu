import { _electron as electron, chromium, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { wave } from './helpers/g20M22Harness'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/creation-boundary-implementation-20261020/F03')
const title = 'Boundary title', revised = 'Boundary title revised'
const feedback = 'The current input is retained. This deliberately longer feedback wraps inside the local activity while its main actions remain reachable. Supporting text stays available in the auxiliary scroll area.'
const pointerFacts: unknown[] = []

async function materials(directory: string) {
  const activity = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%}*{box-sizing:border-box}#stage{font:20px/1.3 Arial;padding:18px;background:#eff6ff;--gl-font-min:20;--gl-gap-min:8px;--gl-gap-max:20px;--gl-padding-min:14px}h2,p{margin:0}h2{font-size:26px}button{font:inherit;padding:8px 16px}#cards{min-height:350px;display:grid;grid-template-columns:1fr 1fr;gap:18px}[data-gl-runtime-variant="compact"] #cards{min-height:130px}#reference{height:90px}#feedback{min-height:0}nav{display:flex;gap:10px;flex-wrap:wrap}@media(max-width:650px){#cards{grid-template-columns:1fr}#reference{height:55px}}
  </style></head><body><section id="stage" data-gl-layout="stage" data-gl-variants="wide compact">
  <header data-gl-slot="heading"><h2>Local activity</h2></header><div id="cards" data-gl-slot="body"><p>Keep the ordinary title and figure independently editable. Reveal feedback, then play the local sound.</p><aside id="reference" data-gl-scroll="auxiliary">${'<p>Supporting information remains available.</p>'.repeat(12)}</aside></div>
  <div id="feedback" data-gl-slot="feedback"></div><nav data-gl-slot="actions"><button id="reveal">Reveal feedback</button><button id="play">Play local audio</button><output id="audio-status">Not played</output></nav>
  <audio id="voice" src="voice.wav"></audio></section><script>
  const stage=document.getElementById('stage'),audio=document.getElementById('voice'),status=document.getElementById('audio-status');
  document.getElementById('reveal').onclick=event=>{stage.dataset.clicked=String(event.isTrusted);document.getElementById('feedback').textContent=${JSON.stringify(feedback)}};
  document.getElementById('play').onclick=event=>{status.dataset.trusted=String(event.isTrusted);audio.play().then(()=>status.textContent='Playing').catch(error=>status.textContent='Audio failed: '+error.message)};
  audio.addEventListener('ended',()=>status.textContent='Audio ended');
  </script></body></html>`
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  await writeFile(path.join(directory, 'voice.wav'), wave())
  await writeFile(path.join(directory, 'figure.png'), Buffer.from(png, 'base64'))
  await writeFile(path.join(directory, 'activity.html'), activity)
  await writeFile(path.join(directory, 'mixed.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;font:24px Arial}h1{position:absolute;left:40px;top:24px;width:1160px;height:65px;margin:0;font-size:36px}p{position:absolute;left:40px;top:105px;width:1100px;height:35px;margin:0}img{position:absolute;left:40px;top:170px;width:220px;height:150px}iframe{position:absolute;left:300px;top:160px;width:920px;height:480px;border:0}</style></head><body><h1>${title}</h1><p>Ordinary content and a local program share one formal page.</p><img alt="Fixture figure" src="figure.png"><iframe title="Local activity" src="activity.html"></iframe></body></html>`)
}

function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(entry[0])))
  delete env.ELECTRON_RUN_AS_NODE
  return { ...env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
}
async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: environment() })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1600, 1000); window?.show(); window?.focus() })
  await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
  return { app, page }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}
async function counters(app: ElectronApplication) {
  return app.evaluate(async ({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
    const { executionDesktopService } = requireProduct('./dist-electron/main/workbench/execution/ExecutionDesktopService.js')
    const runs = await (await executionDesktopService()).runs.list()
    return { pid: process.pid, main: `${app.getAppPath()}/dist-electron/main/index.js`, profile: app.getPath('userData'),
      runs: runs.length, authorRequests: runs.reduce((sum: number, run: { requests: unknown[] }) => sum + run.requests.length, 0) }
  })
}
async function openWorkspace(app: ElectronApplication, page: Page, directory: string, filename: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, directory)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: filename, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible'); await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  const documentId = await frame.getAttribute('data-document-id'); if (!documentId) throw new Error('No formal DocumentSession in the editor')
  return documentId
}
async function activity(page: Page): Promise<Locator> {
  let found: Locator | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const locator = frame.locator('#stage')
      if (await locator.count() && await locator.isVisible()) { found = locator; return true }
    }
    return false
  }).toBe(true)
  return found!
}
async function trustedClick(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  const local = await target.evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    Reflect.set(window, '__f03PointerEvents', [])
    for (const name of ['pointerdown', 'pointerup', 'click']) window.addEventListener(name, event => Reflect.get(window, '__f03PointerEvents').push({ type: event.type, trusted: event.isTrusted, target: (event.target as Element)?.id, x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }), { capture: true, once: true, passive: true })
    return { x, y, hit: element.contains(document.elementFromPoint(x, y)), handler: typeof (element as HTMLButtonElement).onclick, viewport: { width: innerWidth, height: innerHeight } }
  })
  expect(local.hit).toBe(true)
  let point = { x: local.x, y: local.y }
  let frame = await (await target.elementHandle())!.ownerFrame()
  // The workbench scales its presentation canvas. Map each real nested frame's
  // local viewport through its painted border box before sending trusted input.
  const frames: unknown[] = []
  while (frame?.parentFrame()) {
    const element = await frame.frameElement()
    const box = await element.evaluate(node => { const iframe = node as HTMLIFrameElement; return { rect: iframe.getBoundingClientRect().toJSON(), width: iframe.offsetWidth, height: iframe.offsetHeight, left: iframe.clientLeft, top: iframe.clientTop } })
    const painted = frame.parentFrame() === page.mainFrame() ? await element.boundingBox() : box.rect
    if (!painted) throw new Error('Content frame has no painted main-page pointer box')
    point = { x: painted.x + (box.left + point.x) * painted.width / box.width, y: painted.y + (box.top + point.y) * painted.height / box.height }
    frames.push({ box, painted, point })
    frame = frame.parentFrame()
  }
  await page.mouse.click(point.x, point.y)
  pointerFacts.push({ local, frames, point, topHit: await page.evaluate(point => { const node = document.elementFromPoint(point.x, point.y); return { tag: node?.tagName, id: node?.id, className: node?.className } }, point), events: await target.evaluate(() => Reflect.get(window, '__f03PointerEvents')) })
  return point
}
async function runActivity(page: Page) {
  const stage = await activity(page)
  await expect.poll(async () => JSON.parse((await stage.getAttribute('data-gl-runtime-layout')) ?? '{}').issues).toEqual([])
  await trustedClick(page, stage.locator('#reveal'))
  await expect(stage.locator('#feedback')).toHaveText(feedback)
  await expect.poll(async () => JSON.parse((await stage.getAttribute('data-gl-runtime-layout')) ?? '{}').issues).toEqual([])
  await trustedClick(page, stage.locator('#play'))
  await expect(stage.locator('#audio-status')).toHaveText('Audio ended')
  return stage.evaluate(element => {
    const stage = element as HTMLElement, audio = stage.querySelector('audio')!, button = stage.querySelector('#play')!, status = stage.querySelector('#audio-status')!
    const bounds = stage.getBoundingClientRect(), action = button.getBoundingClientRect()
    return { layout: JSON.parse(stage.getAttribute('data-gl-runtime-layout')!), trustedReveal: stage.dataset.clicked,
      trustedAudio: status.getAttribute('data-trusted'), audio: { ended: audio.ended, currentTime: audio.currentTime, duration: audio.duration, source: audio.currentSrc },
      actionReachable: action.bottom <= bounds.bottom + 1 && action.left >= bounds.left - 1 && action.right <= bounds.right + 1 }
  })
}
async function decodedImage(page: Page, id: string) {
  const image = page.locator(`[data-component-instance="${id}"] img,[data-compiled-node="${id}"] img`).first()
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  return image.evaluate(node => { const image = node as HTMLImageElement; return { width: image.naturalWidth, height: image.naturalHeight, source: image.currentSrc } })
}
async function exportOffline(app: ElectronApplication, documentId: string, workspace: string, destination: string) {
  return app.evaluate(async ({ app }, serialized) => {
    const input = JSON.parse(serialized), { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
    const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
    await host.tools.beginRun({ runId: 'f03-export', actor: 'human', documents: [{ documentId: input.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    await host.tools.loadToolFamilies('f03-export', ['build'])
    const opened = await host.tools.completeOpenedDocument('f03-export', { documentId: input.documentId, writable: true }, { selection: 'preserve' })
    const receipt = await host.tools.execute('f03-export', 'f03-export-offline', { name: 'document.export', input: { target: opened.target, format: 'html-offline', destination: input.destination } })
    await host.tools.stop('f03-export')
    return { opened: { kind: opened.kind, target: opened.target }, receipt }
  }, JSON.stringify({ documentId, workspace, destination }))
}
async function consumeOffline(facts: Record<string, any>, htmlPath: string, directory: string, errors: string[]) {
  const html = await readFile(htmlPath, 'utf8')
  expect(html).toContain('compiled-course-v1'); expect(html).toContain(revised)
  facts.offlineHtml = htmlPath
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } }), page = await context.newPage(), network: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    await page.goto(pathToFileURL(htmlPath).href)
    await page.evaluate(async () => { await Reflect.get(window, 'coursePlayerReady'); return true })
    facts.offlineImage = await decodedImage(page, facts.creation.imageId)
    facts.offlineRuntime = await runActivity(page)
    expect(facts.offlineRuntime).toMatchObject({ trustedReveal: 'true', trustedAudio: 'true', audio: { ended: true }, actionReachable: true })
    await page.screenshot({ path: path.join(directory, 'offline-running.png') })
    await page.getByText('Formal Next', { exact: true }).click(); await expect(page.getByText('Formal Next arrived', { exact: true })).toBeVisible()
    await page.screenshot({ path: path.join(directory, 'offline-formal-next.png') })
    facts.offlineFormalNext = 'arrival-page visible after trusted native object click'
    facts.offline = { url: page.url(), network, diagnostic: await page.locator('#course-diagnostic').textContent() }
    expect(network).toEqual([]); expect(facts.offline.diagnostic).not.toContain('课件加载失败')
  } finally { await browser.close() }
}

test('F03 final built app preserves a mixed project through edit Undo, save, a new-profile process and offline playback', async ({}, info) => {
  test.setTimeout(180_000)
  await mkdir(base, { recursive: true })
  if (process.env.F03_FROZEN_RUN) {
    // The compiler's native-child prefix changed after the first real loop.
    // Preserve its valid creation/warm/cold facts and re-export the frozen GLX
    // through the rebuilt product, retaining the original failing HTML.
    const sourceRun = path.resolve(process.env.F03_FROZEN_RUN), facts = JSON.parse(await readFile(path.join(sourceRun, 'facts.json'), 'utf8'))
    const directory = await mkdtemp(path.join(sourceRun, 'final-')), workspace = path.join(sourceRun, 'workspace'), errors: string[] = []
    let h: Awaited<ReturnType<typeof launch>> | undefined
    try {
      h = await launch(path.join(directory, 'profile')); h.page.on('pageerror', error => errors.push(error.message))
      facts.finalization = { directory, sourceRun, reused: 'unchanged formal creation, Undo, warm run and new-profile cold UI evidence', before: await counters(h.app) }
      const id = await openWorkspace(h.app, h.page, workspace, 'mixed-saved.glx')
      const htmlPath = path.join(directory, 'mixed-offline.html')
      facts.export = await exportOffline(h.app, id, sourceRun, path.relative(sourceRun, htmlPath))
      expect(facts.export.receipt).toMatchObject({ kind: 'read', data: { status: 'written', format: 'html-offline' } })
      facts.finalization.after = await counters(h.app)
      expect(facts.finalization.after.authorRequests).toBe(0)
      await close(h.app); h = undefined
      await consumeOffline(facts, htmlPath, directory, errors)
      expect(errors).toEqual([])
    } finally {
      facts.finalization ??= { directory, sourceRun }; facts.finalization.errors = errors; facts.finalization.pointerFacts = pointerFacts
      await writeFile(path.join(directory, 'facts-final.json'), JSON.stringify(facts, null, 2))
      await writeFile(path.join(base, 'latest.json'), JSON.stringify({ directory, facts: path.join(directory, 'facts-final.json'), html: facts.offlineHtml }, null, 2))
      if (h) { await h.page.screenshot({ path: path.join(directory, 'final-export-failure.png') }).catch(() => undefined); await close(h.app) }
      await info.attach('F03 final frozen export', { path: path.join(directory, 'facts-final.json'), contentType: 'application/json' })
    }
    return
  }
  const directory = await mkdtemp(path.join(base, 'run-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace); await materials(workspace)
  const facts: Record<string, any> = { directory, workspace, scope: 'isolated technical fixture; no model author or new provider request' }
  let warm: Awaited<ReturnType<typeof launch>> | undefined, cold: Awaited<ReturnType<typeof launch>> | undefined
  const errors: string[] = []
  try {
    warm = await launch(path.join(directory, 'warm-profile')); warm.page.on('pageerror', error => errors.push(error.message))
    facts.warmBefore = await counters(warm.app)
    facts.creation = await warm.app.evaluate(async ({ app }, serialized) => {
      const input = JSON.parse(serialized), { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { documentHost } = requireProduct('./dist-electron/main/workbench/documentHost.js')
      const { createBlankCourseProjectV10 } = requireProduct('./dist-electron/core/course/createCourseProjectV10.js')
      const { componentProjectFiles } = requireProduct('./dist-electron/core/projectFiles/componentPlatform/index.js')
      const fs = requireProduct('node:fs/promises'), path = requireProduct('node:path'), host = documentHost()
      const project = createBlankCourseProjectV10('Creation boundary final loop')
      const firstRoot = project.instances[project.rootIds[0]]
      firstRoot.name = 'Mixed page'
      project.instances['arrival-page'] = { id: 'arrival-page', name: 'Arrival', definitionId: firstRoot.definitionId, data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 1280, height: 720 } } }
      project.rootIds.push('arrival-page')
      const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'mixed-initial.glx')
      await host.tools.beginRun({ runId: 'f03-operator', actor: 'human', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
      await host.tools.loadToolFamilies('f03-operator', ['content'])
      let serial = 0
      const receipts: unknown[] = [], call = async (name: string, value: unknown) => {
        const result = await host.tools.execute('f03-operator', `f03-${++serial}`, { name, input: value }); receipts.push({ name, result })
        if (result.kind === 'error') throw new Error(`${name}: ${result.code}: ${result.message}`)
        return result
      }
      const files = () => host.internalAPI.read(initial.documentId).then((snapshot: any) => componentProjectFiles(snapshot.model.project, snapshot.model.resources))
      const pages = componentProjectFiles(project, { assets: {}, components: {} }).filter((file: any) => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface')
      await call('project.read', { path: pages[0].path }); await call('project.apply', { path: pages[0].path, intent: 'insert', from: 'mixed.html' })
      await call('project.read', { path: pages[1].path }); await call('project.apply', { path: pages[1].path, intent: 'insert', content: '<h1>Formal Next arrived</h1>', region: { width: 1000, height: 100, transform: [1, 0, 0, 1, 80, 80] } })
      await call('object.insert', { path: pages[0].path, kind: 'text', text: 'Formal Next', x: 1050, y: 660, width: 180, height: 50, click: { action: 'scene.next' } })
      const before = await host.internalAPI.read(initial.documentId), instances = before.model.project.instances
      const titleInstance = Object.values(instances).find((instance: any) => JSON.stringify(instance.data).includes(input.title)) as any
      const program = Object.values(instances).find((instance: any) => typeof instance.data?.html === 'string' && instance.data.html.includes('<iframe')) as any
      const image = Object.values(instances).find((instance: any) => before.model.project.definitions[instance.definitionId]?.implementation.key === 'guoling.image') as any
      if (!titleInstance || !program) throw new Error('Mixed assembly did not yield separate ordinary title and local program')
      const titleFile = (await files()).find((file: any) => file.kind === 'data' && file.target?.instanceId === titleInstance.id)
      await call('project.read', { path: titleFile.path }); await call('project.apply', { path: titleFile.path, edits: [{ old: input.title, new: input.revised }] })
      const edited = await host.internalAPI.read(initial.documentId)
      const unchangedPeers = Object.keys(instances).filter(id => id !== titleInstance.id).every(id => JSON.stringify(instances[id]) === JSON.stringify(edited.model.project.instances[id]))
      const framePreserved = JSON.stringify(titleInstance.frame) === JSON.stringify(edited.model.project.instances[titleInstance.id].frame)
      const undo = await host.internalAPI.dispatch({ documentId: edited.documentId, epoch: edited.epoch, baseRevision: edited.revision, operationId: 'f03-undo', actor: 'human', mutation: { type: 'undo' } })
      receipts.push({ name: 'human.undo', result: undo }); if (undo.status !== 'applied') throw new Error('Ordinary Undo failed: ' + JSON.stringify(undo))
      const undone = await host.internalAPI.read(initial.documentId)
      const undoRestored = JSON.stringify(undone.model.project.instances) === JSON.stringify(instances)
      const redo = await host.internalAPI.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision, operationId: 'f03-redo', actor: 'human', mutation: { type: 'redo' } })
      receipts.push({ name: 'human.redo', result: redo }); if (redo.status !== 'applied') throw new Error('Ordinary Redo failed: ' + JSON.stringify(redo))
      await host.internalAPI.save(initial.documentId, path.join(input.workspace, 'mixed-initial.glx'))
      const saved = await host.internalAPI.read(initial.documentId)
      await fs.writeFile(path.join(input.directory, 'formal-model.json'), JSON.stringify(saved.model, null, 2))
      await fs.writeFile(path.join(input.directory, 'creation-receipts.json'), JSON.stringify(receipts, null, 2))
      await host.tools.stop('f03-operator')
      return { documentId: initial.documentId, titleId: titleInstance.id, programId: program.id, imageId: image?.id, framePreserved, unchangedPeers, undoRestored,
        revision: saved.revision, dirty: saved.dirty, assets: Object.values(saved.model.project.assets).map((asset: any) => ({ id: asset.id, mimeType: asset.mimeType, bytes: saved.model.resources.assets[asset.id]?.byteLength })),
        kinds: Object.values(saved.model.project.instances).map((instance: any) => saved.model.project.definitions[instance.definitionId]?.implementation.key) }
    }, JSON.stringify({ directory, workspace, title, revised }))
    expect(facts.creation).toMatchObject({ framePreserved: true, unchangedPeers: true, undoRestored: true, dirty: false })
    expect(facts.creation.kinds).toEqual(expect.arrayContaining(['guoling.text', 'guoling.image', 'guoling.html-program']))
    expect(facts.creation.assets.some((asset: any) => asset.mimeType === 'audio/wav' && asset.bytes > 32000)).toBe(true)
    const documentId = await openWorkspace(warm.app, warm.page, workspace, 'mixed-initial.glx')
    const mode = warm.page.getByRole('group', { name: '画布模式', exact: true })
    await mode.getByRole('button', { name: '试运行', exact: true }).click()
    facts.warmImage = await decodedImage(warm.page, facts.creation.imageId)
    facts.warmRuntime = await runActivity(warm.page)
    expect(facts.warmRuntime).toMatchObject({ trustedReveal: 'true', trustedAudio: 'true', audio: { ended: true }, actionReachable: true })
    await warm.page.screenshot({ path: path.join(directory, 'warm-running.png') })
    await warm.page.getByText('Formal Next', { exact: true }).click()
    await expect(warm.page.getByText('Formal Next arrived', { exact: true })).toBeVisible()
    facts.warmFormalNext = 'arrival-page visible after trusted native object click'
    await warm.page.getByTestId('course-try-run-previous').click()
    await mode.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(mode.getByRole('button', { name: '编辑', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const savedPath = path.join(workspace, 'mixed-saved.glx')
    await warm.app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, savedPath)
    await warm.page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => warm!.page.evaluate(id => window.desktopAPI.documents!.read(id).then(snapshot => ({ dirty: snapshot.dirty, binding: snapshot.binding.kind === 'file' ? snapshot.binding.path : '' })), documentId)).toEqual({ dirty: false, binding: savedPath })
    facts.savedPath = savedPath; facts.warmAfter = await counters(warm.app)
    expect(facts.warmAfter.authorRequests - facts.warmBefore.authorRequests).toBe(0)
    await close(warm.app); warm = undefined

    cold = await launch(path.join(directory, 'cold-profile')); cold.page.on('pageerror', error => errors.push(error.message))
    facts.coldBefore = await counters(cold.app)
    expect(facts.coldBefore.pid).not.toBe(facts.warmAfter.pid)
    const coldId = await openWorkspace(cold.app, cold.page, workspace, 'mixed-saved.glx')
    await expect(cold.page.getByText(revised, { exact: true }).first()).toBeVisible()
    await expect(cold.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '编辑', exact: true })).toHaveAttribute('aria-pressed', 'true')
    facts.coldImage = await decodedImage(cold.page, facts.creation.imageId)
    const titleBounds = await cold.page.getByText(revised, { exact: true }).first().boundingBox()
    if (!titleBounds) throw new Error('Cold-open title has no painted bounds')
    await cold.page.mouse.dblclick(titleBounds.x + Math.min(60, titleBounds.width / 2), titleBounds.y + titleBounds.height / 2)
    const nativeEditor = cold.page.locator('[data-component-professional-editor] [contenteditable="true"]').first()
    await expect(nativeEditor).toBeVisible(); await expect(nativeEditor).toContainText(revised)
    facts.coldNativeEditor = { openedByTrustedDoubleClick: true, text: await nativeEditor.textContent() }
    await cold.page.keyboard.press('Escape'); await expect(nativeEditor).toHaveCount(0)
    facts.coldDocument = await cold.page.evaluate(id => window.desktopAPI.documents!.read(id).then(snapshot => ({ documentId: snapshot.documentId, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth, model: snapshot.model.kind })), coldId)
    expect(facts.coldDocument).toMatchObject({ dirty: false, undoDepth: 0, model: 'course-v10' })
    await cold.page.screenshot({ path: path.join(directory, 'cold-editor.png') })
    await cold.page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name: '试运行', exact: true }).click()
    facts.coldRuntime = await runActivity(cold.page)
    expect(facts.coldRuntime).toMatchObject({ audio: { ended: true }, actionReachable: true })
    await cold.page.screenshot({ path: path.join(directory, 'cold-running.png') })
    facts.export = await exportOffline(cold.app, coldId, workspace, 'mixed-offline.html')
    expect(facts.export.receipt).toMatchObject({ kind: 'read', data: { status: 'written', format: 'html-offline' } })
    facts.coldAfter = await counters(cold.app)
    expect(facts.coldAfter.authorRequests - facts.coldBefore.authorRequests).toBe(0)
    expect(facts.coldAfter.authorRequests).toBe(0)
    await close(cold.app); cold = undefined

    await consumeOffline(facts, path.join(workspace, 'mixed-offline.html'), directory, errors)
    expect(errors).toEqual([])
  } finally {
    facts.errors = errors
    facts.pointerFacts = pointerFacts
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await writeFile(path.join(base, 'latest.json'), JSON.stringify({ directory, facts: path.join(directory, 'facts.json'), html: facts.offlineHtml }, null, 2))
    if (warm) { await warm.page.screenshot({ path: path.join(directory, 'warm-failure.png') }).catch(() => undefined); await close(warm.app) }
    if (cold) { await cold.page.screenshot({ path: path.join(directory, 'cold-failure.png') }).catch(() => undefined); await close(cold.app) }
    await info.attach('F03 facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})
