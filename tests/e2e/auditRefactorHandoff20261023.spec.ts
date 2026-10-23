import { _electron, expect, test, type Locator, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { componentDefinitionBuiltinKey, type ComponentInstance, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { documentVisibleTextSlots, plainDocumentText, walkDocument } from '../../src/shared/document/content'
import { isNativeFlowLayoutGroup } from '../../src/shared/flowNativeLayout'
import { chartDataSchema } from '../../src/components/chart/data'
import { imageDataSchema, replaceImageSource } from '../../src/components/image/data'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import type { DocumentEvent, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import { course, creationInstruction, DIAGRAM, EXPLANATION, HUMAN_NOTE, LIVE_ROUTE, modelUsed, REVISED, TITLE } from './auditRefactorHandoff20261023.node'

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
interface AuditHostPort {
  internalAPI: Record<string, (...args: any[]) => Promise<any>> & { read(documentId: string): Promise<DocumentSnapshot> }
  readAuthoringDrafts(documentId: string): Promise<unknown>
  writeAuthoringDrafts(documentId: string, input: unknown): Promise<unknown>
  clearAuthoringDrafts(documentId: string): Promise<unknown>
  saveToPath(documentId: string, filename: string): Promise<unknown>
  compileComponent(input: unknown): Promise<any>
  subscribeEvents(listener: (event: DocumentEvent) => void): () => void
}

/** One short RPC into an actual Electron Main; the default Host/Gateway remains the only document owner. */
async function launchMain(directory: string) {
  const root = resolve(__dirname, '../..'), entry = join(directory, 'audit-main.cjs'), userData = join(directory, 'electron-user-data')
  const executablePath = process.env.AUDIT_ELECTRON_EXECUTABLE ?? join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  await fs.access(executablePath).catch(() => { throw new Error('audit-setup:provide-AUDIT_ELECTRON_EXECUTABLE-or-install-local-electron-binary') })
  await fs.mkdir(userData, { recursive: true })
  await fs.access(join(root, 'dist-electron/main/workbench/DocumentHostService.js'))
    .catch(() => { throw new Error('audit-setup:run-build-electron-before-the-live-audit') })
  const helper = join(directory, 'audit-node.cjs')
  // Only the test helper is transformed. Native measurement stringifies its capture function,
  // so product modules must use the same plain JS emitted by the normal Electron build.
  await build({ entryPoints: [join(root, 'tests/e2e/auditRefactorHandoff20261023.node.ts')], outfile: helper,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'formal-main-modules', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/\.\.\/src\// }, input => {
        const path = join(root, 'dist-electron', input.path.slice('../../src/'.length)).replace(/\.js$/, '') + '.js'
        return { path: input.kind === 'dynamic-import' ? pathToFileURL(path).href : path, external: true }
      })
    } }],
  })
  await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(userData)});require(${JSON.stringify(join(root, 'dist-electron/main/protocols.js'))}).registerPrivilegedSchemes();require(${JSON.stringify(helper)}).installAuditMain(${JSON.stringify(directory)}).catch(error=>{console.error('audit-main-setup-failed:'+error.name);app.quit()});`)
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete environment.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath, args: [entry], cwd: root, env: environment, timeout: 30_000 })
  const listeners = new Map<string, Set<(event: DocumentEvent) => void>>()
  const hydrate = (snapshot: any) => {
    if (snapshot?.model?.resources) for (const family of ['assets', 'components']) for (const [id, value] of Object.entries(snapshot.model.resources[family])) {
      snapshot.model.resources[family][id] = family === 'assets' ? Uint8Array.from(value as number[])
        : Object.fromEntries(Object.entries(value as object).map(([name, bytes]) => [name, Uint8Array.from(bytes as number[])]))
    }
    return snapshot
  }
  const rpc = async (method: string, args: unknown[] = []): Promise<any> => {
    const packet = await app.evaluate(async (_electron, request) => (globalThis as any).__auditP3Rpc(request), { method, args })
    for (const { host, event } of packet.events) {
      if (event.snapshot) hydrate(event.snapshot)
      listeners.get(host)?.forEach(listener => listener(event))
    }
    return hydrate(packet.result)
  }
  const hostPort = (id: string): AuditHostPort => {
    const call = (name: string, args: unknown[]) => rpc('host', [id, name, args])
    return { internalAPI: Object.fromEntries(['list', 'read', 'dispatch', 'restore', 'save'].map(name => [name, (...args: unknown[]) => call(name, args)])) as AuditHostPort['internalAPI'],
      readAuthoringDrafts: documentId => call('readAuthoringDrafts', [documentId]),
      writeAuthoringDrafts: (documentId, input) => call('writeAuthoringDrafts', [documentId, input]),
      clearAuthoringDrafts: documentId => call('clearAuthoringDrafts', [documentId]),
      saveToPath: (documentId, filename) => call('saveToPath', [documentId, filename]),
      compileComponent: input => call('compileComponent', [input]),
      subscribeEvents(listener) { const list = listeners.get(id) ?? new Set(); listeners.set(id, list); list.add(listener); return () => { list.delete(listener) } },
    }
  }
  try {
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as any).__auditP3Rpc))).toBe(true)
  } catch (error) { await app.close(); throw error }
  return { rpc, host: hostPort('main'), close: () => app.close(),
    setup: () => rpc('setup') as Promise<{ initial: DocumentSnapshot; surfaceId: string; workspace: string;
      previous?: Parameters<typeof modelUsed>[0] & { status: string }; previousProviderRequests: number }>,
    run: (name: string, instruction: string, writable: ExecutionStart['documents'][number]['writable']) => rpc('run', [name, instruction, writable]),
    preserve: (stage: string) => rpc('preserve', [stage]), stop: () => rpc('stop'), metrics: () => rpc('metrics'),
    async openCold(filename: string) { return { host: hostPort('cold'), reopened: await rpc('cold-open', [filename]) as DocumentSnapshot } },
  }
}
const textOf = (project: CourseProjectV10, id: string) => {
  let text = ''
  walkDocument(projectFlowDocument(project, id).content.blocks, block => { for (const slot of documentVisibleTextSlots(block)) text += plainDocumentText(slot.content) + '\n' })
  return text
}

function authoredParts(project: CourseProjectV10, surfaceId: string) {
  const instances = Object.values(project.instances)
  const charts = instances.filter(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.chart'
    && chartDataSchema.safeParse(instance.data).success)
  const images = instances.filter(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.image'
    && imageDataSchema.safeParse(instance.data).success)
  const descendants = (id: string): string[] => [id, ...(project.instances[id]?.childIds ?? []).flatMap(descendants)]
  let paragraphId: string | undefined
  walkDocument(projectFlowDocument(project, surfaceId).content.blocks, block => {
    if (['paragraph', 'quote', 'heading'].includes(block.type) && documentVisibleTextSlots(block)
      .some(slot => plainDocumentText(slot.content).includes('观察解释：'))) paragraphId ??= block.id
  })
  const columns = instances.find(instance => isNativeFlowLayoutGroup(instance, project.definitions[instance.definitionId])
    && instance.style?.display === 'grid' && instance.childIds?.length === 2 && paragraphId && descendants(instance.id).includes(paragraphId)
    && descendants(instance.id).some(id => images.some(image => image.id === id)))
  const programs = instances.filter(instance => {
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
    return typeof data.html === 'string' && /<button\b/i.test(data.html)
      || implementation?.kind === 'source' && /\bbutton\b/i.test(implementation.source ?? '')
  })
  return { charts, images, columns, paragraphId, programs, text: textOf(project, surfaceId), descendants }
}

async function editorBundle(directory: string) {
  const result = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness";export {useEditorStore} from "./src/renderer/store/editorStore";export {compileCoursePlayback} from "./src/core/publish/componentPlatform/compileCoursePlayback";export {renderCompiledBuiltin} from "./src/renderer/export/componentPlatform/renderCompiledBuiltin"', resolveDir: resolve(__dirname, '../..') },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'AuditEditor', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  return `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(result.outputFiles.find(file => file.path.endsWith('.css'))!.text)};document.head.append(s)})();`
    + result.outputFiles.find(file => file.path.endsWith('.js'))!.text
}

/** Same Main/Store/Bridge/PM/World path as currentFlowBrowserHarness; no editable DOM imitation. */
async function mountEditor(page: Page, host: AuditHostPort, documentId: string, events: DocumentEvent[], bundle: string) {
  await page.route('http://localhost/audit-p3-editor', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
  await page.goto('http://localhost/audit-p3-editor')
  const api = host.internalAPI as any
  await page.exposeFunction('auditDocumentCall', async (name: string, args: unknown[]) => {
    const result = name === 'bootstrapCourse' ? await host.internalAPI.read(documentId)
      : name === 'compileComponent' ? await host.compileComponent(args[0])
      : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
      : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
      : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string) : await api[name](...args)
    return json({ result, events: events.splice(0) })
  })
  await page.evaluate(bundle)
  await page.evaluate(async () => {
    const listeners = new Set<(event: any) => void>()
    const hydrate = (snapshot: any) => {
      if (snapshot?.model?.resources) for (const family of ['assets', 'components']) for (const [id, value] of Object.entries(snapshot.model.resources[family])) {
        snapshot.model.resources[family][id] = family === 'assets' ? Uint8Array.from(value as number[])
          : Object.fromEntries(Object.entries(value as object).map(([name, bytes]) => [name, Uint8Array.from(bytes as number[])]))
      }
      return snapshot
    }
    const receive = (events: any[]) => events.forEach(event => { if (event.snapshot) hydrate(event.snapshot); listeners.forEach(listener => listener(event)) })
    ;(window as any).auditReceive = receive
    ;(window as any).auditCompilationResults = []
    ;(window as any).desktopAPI = { compileComponent: async (input: unknown) => {
      const packet = await (window as any).auditDocumentCall('compileComponent', [input])
      receive(packet.events); (window as any).auditCompilationResults.push(packet.result.status)
      return packet.result
    } }
    const methods = ['list', 'read', 'dispatch', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
    const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
      const packet = await (window as any).auditDocumentCall(name, args); receive(packet.events)
      return Array.isArray(packet.result) ? packet.result.map(hydrate) : hydrate(packet.result)
    }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
    ;(window as any).auditHarness = await (window as any).AuditEditor.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api)
  })
}

async function sourceViewportKeyboardAndFlowScroll(page: Page, root: Locator) {
  const frame = root.locator('iframe').first()
  await expect(frame).toHaveCount(1)
  const realm = frame.contentFrame(), card = realm.locator('#component-root > div')
  const before = await card.boundingBox()
  expect(before).not.toBeNull()
  const scroll = () => realm.locator('body').evaluate(node => node.ownerDocument.scrollingElement?.scrollTop ?? 0)
  const scrollBefore = await scroll()
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await expect(realm.locator('button:focus')).toHaveCount(1)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const after = await card.boundingBox()
  expect(await scroll()).toBe(scrollBefore)
  expect(after!.y).toBeCloseTo(before!.y, 1)
  // The actual Flow owner scrolls its real slot; the source viewport never scrolls itself.
  await root.scrollIntoViewIfNeeded()
  return { before, after, innerScroll: scrollBefore }
}

test('P3 setup only: actual Electron Main measures ordinary HTML without a provider request', async ({}, info) => {
  test.skip(process.env.RUN_AUDIT_REFACTOR_SETUP !== '1', 'Optional local setup check; this is not P3 live acceptance')
  test.setTimeout(90_000)
  const directory = info.outputPath('p3-main-setup'); await fs.mkdir(directory, { recursive: true })
  const main = await launchMain(directory)
  try {
    const result = await main.rpc('preflight')
    expect(result.environment).toBe('actual-electron-main'); expect(result.rootKind).not.toBe('program')
    expect(result.diagnostics.filter((item: { level: string }) => item.level === 'error')).toEqual([])
    expect(result.admittedMedia).toEqual({ resultKind: 'document-operation', application: 'applied', assetCount: 1 })
    await fs.writeFile(join(directory, 'setup-evidence.json'), JSON.stringify({ ...result, providerRequests: 0, p3Accepted: false }, null, 2))
  } finally { await main.close() }
})

test('P3 offline finish: retained model result cold-opens and runs in actual HTML Player with no provider', async ({ browser }, info) => {
  test.skip(process.env.RUN_AUDIT_REFACTOR_FINISH !== '1', 'Free continuation of the retained, already checked model/human result')
  test.setTimeout(90_000)
  const filename = process.env.AUDIT_P3_FINISH_GLX!
  expect(Boolean(filename)).toBe(true)
  const directory = info.outputPath('p3-offline-finish'); await fs.mkdir(directory, { recursive: true })
  const compiledDelivery = process.env.AUDIT_P3_COMPILED === '1'
  const main = await launchMain(directory), errors: string[] = [], facts: Record<string, unknown> = {
    status: 'attempt', source: filename, providerRequests: 0, player: compiledDelivery ? 'formal-compiled-delivery' : 'published',
    scope: 'Fresh Electron process/Host from actual saved GLX; browser renderer and offline Player. No physical IME or Owner acceptance claim.' }
  const editor = await browser.newPage({ viewport: { width: 1200, height: 1000 }, offline: true })
  let stage = 'cold-open', mounted = false
  try {
    const { host, reopened } = await main.openCold(filename), cold = course(reopened), surfaceId = cold.project.rootIds[0]
    const parts = authoredParts(cold.project, surfaceId), chart = parts.charts[0], program = parts.programs[0]
    const image = parts.images.find(candidate => parts.descendants(parts.columns!.id).includes(candidate.id))!
    expect(parts.text).toContain(REVISED); expect(parts.text).toContain(HUMAN_NOTE)
    expect(chartDataSchema.parse(chart.data).series[0].points.map(point => point.value)).toEqual([82, 70, 60])
    expect(parts.columns!.style?.gridTemplateColumns).toBe('minmax(0, 2fr) minmax(0, 1fr)')
    stage = 'cold-editor'
    const bundle = await editorBundle(directory)
    editor.on('pageerror', error => errors.push(error.name))
    await mountEditor(editor, host, reopened.documentId, [], bundle); mounted = true
    await expect(editor.locator(`[data-flow-block-id="${parts.paragraphId}"]`)).toContainText(REVISED)
    await expect(editor.locator(`[data-flow-block-id="${image.id}"] img`)).toBeVisible()
    await expect.poll(() => editor.evaluate(() => (window as any).auditCompilationResults)).toContain('ready')
    expect(await editor.evaluate(() => (window as any).auditHarness.errors)).toEqual([])
    await editor.screenshot({ path: join(directory, 'cold-editor.png') })
    facts.freshProcessColdEditor = true
    stage = 'offline-player'
    const published = await buildPublishedCourseV3({ project: cold.project, assetBytes: cold.resources.assets, componentFiles: cold.resources.components },
      { compilation: { compile: input => host.compileComponent(input) } })
    expect(published.diagnostics.filter(item => item.code === 'source-not-compiled' || item.code === 'source-compile-failed')).toEqual([])
    const playerBuild = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: resolve(__dirname, '../..') },
      bundle: true, platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' })
    let html: string
    if (compiledDelivery) {
      const compiled = await editor.evaluate(async payload => {
        const api = (window as any).AuditEditor
        return api.compileCoursePlayback(payload, { document,
          renderBuiltin: (instance: unknown, key: string, project: unknown) => api.renderCompiledBuiltin(instance, key, project, document) })
      }, json(published.payload))
      expect(compiled.diagnostics).toEqual([])
      html = buildCompiledSingleHtml(compiled, await fs.readFile(resolve(__dirname, '../../dist-player/compiled-player.iife.js'), 'utf8'))
    } else html = buildComponentSingleHtml(published.payload, playerBuild.outputFiles[0].text)
    await fs.writeFile(join(directory, '降温观察-result.html'), html)
    const player = await browser.newPage({ viewport: { width: 1200, height: 1000 }, offline: true })
    const objectAttribute = compiledDelivery ? 'data-compiled-node' : 'data-component-object'
    try {
      player.on('pageerror', error => errors.push(error.name))
      await player.route('http://localhost/audit-p3-finish', route => route.fulfill({ contentType: 'text/html', body: html }))
      await player.goto('http://localhost/audit-p3-finish'); await player.evaluate(() => (window as any).coursePlayerReady)
      await expect(player.locator(`[${objectAttribute}="${parts.paragraphId}"]`)).toContainText(REVISED)
      await expect(player.locator(`[${objectAttribute}="${chart.id}"] svg[data-native-chart-id]`)).toBeVisible()
      const displayedImage = player.locator(`[${objectAttribute}="${image.id}"] img`)
      await expect(displayedImage).toBeVisible()
      expect(await displayedImage.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
      const root = player.locator(`[${objectAttribute}="${program.id}"]`), frame = root.locator('iframe').first()
      await expect.poll(async () => await frame.count() || await root.getByRole('button', { name: '显示结论', exact: true }).count()).toBeGreaterThan(0)
      if (!compiledDelivery || await frame.count()) facts.sourceViewportKeyboardStable = await sourceViewportKeyboardAndFlowScroll(player, root)
      else { await root.scrollIntoViewIfNeeded(); facts.sourceCarrier = 'formal-compiled-content-environment' }
      const controls = await frame.count() ? frame.contentFrame() : root
      await expect(controls.getByText('先做预测', { exact: true })).toBeVisible()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeHidden()
      await controls.getByRole('button', { name: '显示结论', exact: true }).click()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeVisible()
      await controls.getByRole('button', { name: '重新预测', exact: true }).click()
      await expect(controls.getByText('先做预测', { exact: true })).toBeVisible()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeHidden()
      const chartBounds = await player.locator(`[${objectAttribute}="${chart.id}"] svg[data-native-chart-id]`).boundingBox()
      const cardBounds = await controls.getByText('先做预测', { exact: true }).locator('..').boundingBox()
      expect(chartBounds).not.toBeNull(); expect(cardBounds).not.toBeNull()
      expect(cardBounds!.y).toBeGreaterThanOrEqual(chartBounds!.y + chartBounds!.height)
      facts.renderedChartAndProgramSeparated = { chart: chartBounds, programCard: cardBounds }
      await player.screenshot({ path: join(directory, 'player-after-reset.png') })
      await expect(player.locator('#course-diagnostic')).toBeHidden()
      expect(await player.locator('#course-diagnostic').getAttribute('data-has-diagnostic')).toBeNull()
      expect(await player.evaluate(() => Boolean((window as any).__coursePlaybackFailed))).toBe(false)
      facts.actualOfflinePlayerRevealAndReset = true
    } finally { await player.close() }
    expect(errors).toEqual([]); facts.status = 'passed'
  } catch (error) {
    facts.status = 'failed-attempt'; facts.failureStage = stage; facts.failureKind = error instanceof Error ? error.name : 'unknown'
    await editor.screenshot({ path: join(directory, 'failure-editor.png') }).catch(() => undefined)
    throw error
  } finally {
    facts.browserErrors = errors
    facts.actualProviderTransportAttempts = (await main.metrics()).transport.length
    await fs.writeFile(join(directory, 'finish-evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    if (mounted) await editor.evaluate(() => (window as any).auditHarness.dispose()).catch(() => undefined)
    await editor.close(); await main.close()
  }
})

test('P3 actual model creates, hands off to a human and edits only the requested content through cold Player', async ({ browser }, info) => {
  test.skip(process.env.RUN_AUDIT_REFACTOR_LIVE !== '1', 'Opt in with RUN_AUDIT_REFACTOR_LIVE=1; default skip is not P3 acceptance')
  test.setTimeout(20 * 60_000)
  const credential = process.env.AUDIT_P3_OFFICIAL === '1' ? process.env.DEEPSEEK_API_KEY : process.env.TEAMOROUTER_API_KEY
  expect(Boolean(credential), 'The existing authorized provider key is required at runtime; no credential value is printed').toBe(true)
  const directory = info.outputPath('p3-live-attempt')
  await fs.mkdir(directory, { recursive: true })
  // Build dependencies before the first charged request, so a local setup failure costs no provider call.
  const bundle = await editorBundle(directory)
  const playerBuild = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: resolve(__dirname, '../..') },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const live = await launchMain(directory)
  const setup = await live.setup().catch(async error => { await live.close(); throw error })
  const events: DocumentEvent[] = [], errors: string[] = []
  const initialDocumentId = setup.initial.documentId, surfaceId = setup.surfaceId
  const off = live.host.subscribeEvents(event => events.push(event))
  const editor = await browser.newPage({ viewport: { width: 1200, height: 1000 }, offline: true })
  editor.on('pageerror', error => errors.push(error.name))
  const facts: Record<string, unknown> = { status: 'attempt', route: LIVE_ROUTE,
    scope: 'one synthetic creation and handoff task; engineering/real-browser evidence, no comparative speedup or Owner acceptance claim',
    resumedFrom: process.env.AUDIT_P3_RESUME_GLX ?? null, previousProviderRequests: setup.previousProviderRequests }
  let stage = 'editor-setup', mounted = false
  try {
    await mountEditor(editor, live.host, initialDocumentId, events, bundle); mounted = true
    if (!setup.previous) expect(course(await live.host.internalAPI.read(initialDocumentId)).project.instances[surfaceId].childIds).toEqual([])
    stage = 'first-live-round'
    const firstRoundStartedAt = Date.now()
    const first = process.env.AUDIT_P3_SKIP_CREATION === '1' ? setup.previous! : await live.run(setup.previous ? 'repair-existing-image' : 'create', setup.previous
      ? '继续当前《一杯热水怎样降温》，只修复左列示意图：当前左列是被测量拆分的SVG图形组，请将它替换为工作区“散热示意.svg”的原生媒体图片对象（使用正式媒体插入能力）。保留已有双列容器、右列解释、标题、拓展思考、专业折线图及其80、68、59数据、独立局部互动源码与其他所有内容。不要重建整页，不生图、不联网，不保存或导出。图片可见且位于原左列后结束。'
      : creationInstruction, [{ kind: 'document' }])
    await live.preserve('first-round')
    expect(first.status, 'A stopped/failed model attempt remains a failed attempt').toBe('completed')
    const initial = course(await live.host.internalAPI.read(initialDocumentId)), parts = authoredParts(initial.project, surfaceId)
    const creation = setup.previous ?? first
    facts.adoption = { catalog: modelUsed(creation, 'asset.search'), columns: modelUsed(creation, 'object.layout', input => input.intent?.kind === 'columns'),
      initialChartData: modelUsed(creation, 'object.insert', input => input.kind === 'chart' && Boolean(input.chart)) }
    expect(facts.adoption).toEqual({ catalog: true, columns: true, initialChartData: true })
    expect(parts.text).toContain(TITLE); expect(parts.text).toContain(EXPLANATION); expect(parts.text).toContain('拓展思考：')
    expect(parts.charts).toHaveLength(1); expect(parts.columns, 'The output must contain an editable native image/text reading grid').toBeDefined()
    expect(parts.paragraphId).toBeDefined(); expect(parts.programs, 'A real local editable program must be authored by the model').toHaveLength(1)
    const chart = parts.charts[0], columns = parts.columns!, paragraphId = parts.paragraphId!, program = parts.programs[0]
    const image = parts.images.find(candidate => parts.descendants(columns.id).includes(candidate.id))!
    expect(image).toBeDefined()
    const imageColumn = columns.childIds!.find(id => parts.descendants(id).includes(image.id))!
    const paragraphColumn = columns.childIds!.find(id => parts.descendants(id).includes(paragraphId))!
    expect(imageColumn).toBeDefined(); expect(paragraphColumn).toBeDefined(); expect(imageColumn).not.toBe(paragraphColumn)
    const chartData = chartDataSchema.parse(chart.data)
    expect(chartData.chartType).toBe('line'); expect(chartData.title).toBe('降温记录'); expect(chartData.series).toHaveLength(1)
    expect(chartData.categories.map(value => value.label)).toEqual(['0分钟', '5分钟', '10分钟'])
    expect(chartData.series[0].points.map(value => value.value)).toEqual([80, 68, 59])
    await editor.evaluate(value => (window as any).auditReceive(value), json(events.splice(0)))
    await expect(editor.locator(`[data-flow-block-id="${paragraphId}"]`)).toContainText(EXPLANATION)
    await expect(editor.locator(`[data-flow-block-id="${chart.id}"] svg[data-native-chart-id]`)).toBeVisible()
    await expect(editor.locator(`[data-flow-block-id="${image.id}"] img`)).toBeVisible()
    const columnBoxes = await editor.evaluate(ids => ids.map(id => {
      const box = document.querySelector(`[data-flow-block-id="${id}"]`)!.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }), [imageColumn, paragraphColumn])
    expect(columnBoxes[0].x + columnBoxes[0].width).toBeLessThanOrEqual(columnBoxes[1].x + 1)
    facts.separateImageAndTextColumns = columnBoxes
    if (process.env.AUDIT_P3_SKIP_CREATION === '1') facts.existingFragmentVerificationMs = Date.now() - firstRoundStartedAt
    else facts.firstEditorFragmentVerifiedMs = Date.now() - firstRoundStartedAt
    await editor.screenshot({ path: join(directory, 'first-editor.png') })

    stage = 'human-pm-edit'
    const paragraph = editor.locator(`[data-flow-block-id="${paragraphId}"]`)
    await paragraph.click(); await editor.keyboard.press('End'); await editor.keyboard.insertText(' ' + HUMAN_NOTE)
    await editor.evaluate(async id => { await (window as any).AuditEditor.useEditorStore.getState().courseBridge.drain([id]) }, initialDocumentId)
    await expect.poll(async () => JSON.stringify(course(await live.host.internalAPI.read(initialDocumentId)).project.instances[paragraphId].data)).toContain(HUMAN_NOTE)

    stage = 'human-image-and-columns'
    const replacement = await prepareImageResource({ bytes: new TextEncoder().encode(DIAGRAM.replaceAll('#db6b3b', '#2563eb')),
      mimeType: 'image/svg+xml', filename: '人工更换-蓝杯.svg' }, randomUUID)
    const beforeHuman = await live.host.internalAPI.read(initialDocumentId), beforeHumanModel = course(beforeHuman)
    expect(await live.host.internalAPI.dispatch({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch, baseRevision: beforeHuman.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(beforeHumanModel.project, [
        { type: 'asset.add', asset: replacement.meta, bytes: replacement.bytes },
        { type: 'data.set', instanceId: image.id, path: [], value: json(replaceImageSource(imageDataSchema.parse(beforeHumanModel.project.instances[image.id].data), replacement.meta.id)) },
        { type: 'style.set', instanceId: columns.id, path: ['gridTemplateColumns'], value: 'minmax(0, 2fr) minmax(0, 1fr)' },
      ]) } })).toMatchObject({ status: 'applied' })
    await editor.evaluate(value => (window as any).auditReceive(value), json(events.splice(0)))
    const ratio = () => editor.evaluate(ids => {
      const elements = ids.map(id => document.querySelector(`[data-flow-block-id="${id}"]`))
      if (elements.some(element => !element)) return 0 // Wait for the acknowledged editor projection to mount.
      const boxes = elements.map(element => element!.getBoundingClientRect())
      return boxes[0].width / boxes[1].width
    }, columns.childIds!)
    await expect.poll(ratio).toBeGreaterThan(1.7)
    const manual = course(await live.host.internalAPI.read(initialDocumentId))
    facts.human = { paragraphId, imageId: image.id, replacementAssetId: replacement.meta.id, columnsId: columns.id, measuredColumnRatio: await ratio() }
    await editor.screenshot({ path: join(directory, 'human-handoff.png') }); await live.preserve('human-handoff')
    if (process.env.AUDIT_P3_HUMAN_ONLY === '1') {
      facts.status = 'passed-human-only'; facts.p3Accepted = false
      return // Free focused regression; the complete model handoff remains a separate acceptance.
    }

    stage = 'second-live-round'
    const second = await live.run('local-revision', `请在当前作品继续局部修改：把“观察解释：”段落的原解释句改成“${REVISED}”，完整保留人工批注“${HUMAN_NOTE}”。把现有“降温记录”图表的水温数值按原分类顺序改成82、70、60。只改这个段落的解释句和这个图表的数据；保留标题、拓展思考、人工换成的蓝杯图片、人工调整的双列比例、局部互动的源码与行为以及所有其他内容。读取当前事实，沿软件实际正式编辑能力完成，不重建对象、不重做整页。完成后结束，不替用户保存导出。`,
      [{ kind: 'course-instance', surfaceId, instanceId: paragraphId }, { kind: 'course-instance', surfaceId, instanceId: chart.id }])
    await live.preserve('second-round')
    expect(second.status).toBe('completed')
    const final = course(await live.host.internalAPI.read(initialDocumentId)), finalParts = authoredParts(final.project, surfaceId)
    expect(finalParts.text).toContain(REVISED); expect(finalParts.text).toContain(HUMAN_NOTE)
    expect(chartDataSchema.parse(final.project.instances[chart.id].data).series[0].points.map(value => value.value)).toEqual([82, 70, 60])
    const revisedText = (value: unknown): unknown => typeof value === 'string' ? value.replace(EXPLANATION, REVISED)
      : Array.isArray(value) ? value.map(revisedText) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revisedText(item)])) : value
    expect(final.project.instances[paragraphId].data).toEqual(revisedText(manual.project.instances[paragraphId].data))
    const expectedChart = chartDataSchema.parse(manual.project.instances[chart.id].data)
    expectedChart.series[0].points.forEach((point, index) => { point.value = [82, 70, 60][index] })
    expect(final.project.instances[chart.id].data).toEqual(expectedChart)
    const allowedData = (id: string): ComponentInstance => ({ ...manual.project.instances[id], data: final.project.instances[id].data })
    expect(final.project).toEqual({ ...manual.project, revision: final.project.revision, instances: { ...manual.project.instances,
      [paragraphId]: allowedData(paragraphId), [chart.id]: allowedData(chart.id) } })
    expect(final.resources).toEqual(manual.resources)
    expect(final.project.instances[program.id]).toEqual(manual.project.instances[program.id])
    await editor.evaluate(value => (window as any).auditReceive(value), json(events.splice(0)))
    await expect(paragraph).toContainText(REVISED); await expect(paragraph).toContainText(HUMAN_NOTE)
    await editor.screenshot({ path: join(directory, 'second-editor.png') })
    facts.localRevisionPreservedHumanState = true

    stage = 'save-and-cold-open'
    const filename = join(directory, '降温观察-result.glx')
    await live.host.saveToPath(initialDocumentId, filename)
    const { host: coldHost, reopened } = await live.openCold(filename), cold = course(reopened)
    expect(cold).toEqual(final)
    await editor.evaluate(() => (window as any).auditHarness.dispose()); mounted = false
    const coldEvents: DocumentEvent[] = [], coldOff = coldHost.subscribeEvents(event => coldEvents.push(event))
    const coldEditor = await browser.newPage({ viewport: { width: 1200, height: 1000 }, offline: true })
    try {
      await mountEditor(coldEditor, coldHost, reopened.documentId, coldEvents, bundle)
      await expect(coldEditor.locator(`[data-flow-block-id="${paragraphId}"]`)).toContainText(REVISED)
      await expect(coldEditor.locator(`[data-flow-block-id="${image.id}"] img`)).toBeVisible()
      expect(await coldEditor.evaluate(() => (window as any).auditHarness.errors)).toEqual([])
      await coldEditor.screenshot({ path: join(directory, 'cold-editor.png') })
      await coldEditor.evaluate(() => (window as any).auditHarness.dispose())
    } catch (error) {
      await coldEditor.screenshot({ path: join(directory, 'failure-cold-editor.png') }).catch(() => undefined)
      throw error
    } finally { coldOff(); await coldEditor.close() }
    facts.savedAndColdReopened = true

    stage = 'actual-html-player'
    const published = await buildPublishedCourseV3({ project: cold.project, assetBytes: cold.resources.assets, componentFiles: cold.resources.components },
      { compilation: { compile: input => live.host.compileComponent(input) } })
    expect(published.diagnostics.filter(item => item.code === 'source-not-compiled' || item.code === 'source-compile-failed')).toEqual([])
    const html = buildComponentSingleHtml(published.payload, playerBuild.outputFiles[0].text)
    await fs.writeFile(join(directory, '降温观察-result.html'), html)
    const player = await browser.newPage({ viewport: { width: 1200, height: 1000 }, offline: true })
    try {
      player.on('pageerror', error => errors.push(error.name))
      await player.route('http://localhost/audit-p3-player', route => route.fulfill({ contentType: 'text/html', body: html }))
      await player.goto('http://localhost/audit-p3-player'); await player.evaluate(() => (window as any).coursePlayerReady)
      await expect(player.locator(`[data-component-object="${paragraphId}"]`)).toContainText(REVISED)
      await expect(player.locator(`[data-component-object="${chart.id}"] svg[data-native-chart-id]`)).toBeVisible()
      const displayedImage = player.locator(`[data-component-object="${image.id}"] img`)
      await expect(displayedImage).toBeVisible()
      expect(await displayedImage.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
      const programRoot = player.locator(`[data-component-object="${program.id}"]`), frame = programRoot.locator('iframe').first()
      await expect.poll(async () => await frame.count() || await programRoot.getByRole('button', { name: '显示结论', exact: true }).count()).toBeGreaterThan(0)
      facts.sourceViewportKeyboardStable = await sourceViewportKeyboardAndFlowScroll(player, programRoot)
      const controls = await frame.count() ? frame.contentFrame() : programRoot
      await expect(controls.getByText('先做预测', { exact: true })).toBeVisible()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeHidden()
      await controls.getByRole('button', { name: '显示结论', exact: true }).click()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeVisible()
      await controls.getByRole('button', { name: '重新预测', exact: true }).click()
      await expect(controls.getByText('先做预测', { exact: true })).toBeVisible()
      await expect(controls.getByText('热水向周围散热', { exact: true })).toBeHidden()
      const chartBounds = await player.locator(`[data-component-object="${chart.id}"] svg[data-native-chart-id]`).boundingBox()
      const cardBounds = await (await frame.count() ? controls.locator('#component-root > div') : programRoot).boundingBox()
      expect(chartBounds).not.toBeNull(); expect(cardBounds).not.toBeNull()
      expect(cardBounds!.y).toBeGreaterThanOrEqual(chartBounds!.y + chartBounds!.height)
      facts.renderedChartAndProgramSeparated = { chart: chartBounds, programCard: cardBounds }
      await player.screenshot({ path: join(directory, 'player-after-clicks.png') })
      await expect(player.locator('#course-diagnostic')).toBeHidden()
      expect(await player.locator('#course-diagnostic').getAttribute('data-has-diagnostic')).toBeNull()
      expect(await player.evaluate(() => Boolean((window as any).__coursePlaybackFailed))).toBe(false)
    } catch (error) {
      await player.screenshot({ path: join(directory, 'failure-player.png') }).catch(() => undefined)
      throw error
    } finally { await player.close() }
    expect(errors).toEqual([])
    facts.actualPlayerButtonReset = true; facts.status = 'passed'
  } catch (error) {
    facts.status = 'failed-attempt'; facts.failureStage = stage
    // Synthetic fixtures remain in GLX/run/event artifacts. Exceptions may include upstream details, so public evidence uses fixed labels.
    facts.failureKind = error instanceof Error ? error.name : 'unknown-error'
    facts.failureArchiveRetained = await live.preserve('failure-current').then(() => true, () => false)
    facts.failureEditorScreenshotRetained = await editor.screenshot({ path: join(directory, 'failure-editor.png') }).then(() => true, () => false)
    throw new Error(`audit-p3-failed:${stage}:${facts.failureKind}`)
  } finally {
    facts.cleanupSettled = await live.stop().then(() => true, () => false)
    const metrics = await live.metrics()
    facts.metrics = metrics; facts.providerTransportAttempts = metrics.transport.length
    facts.providerBackendAccepted = metrics.wire.some((request: { backendAccepted?: boolean }) => request.backendAccepted === true); facts.browserErrors = errors
    await fs.writeFile(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    await info.attach('P3 attempt evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (mounted) await editor.evaluate(() => (window as any).auditHarness.dispose()).catch(() => undefined)
    off(); await editor.close(); await live.close()
  }
})
