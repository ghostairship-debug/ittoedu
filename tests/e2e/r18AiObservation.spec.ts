import { plainDocumentText } from '../../src/shared/document/content'
import { serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { CurrentObservation } from './helpers/g20AuthoringObservation'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor } from './lessonWorkspaceEntry'

// The existing Vite development entry exposes the same modules imported by the UI.
// Electron Main, IPC capturePage, persisted archives, mounted surfaces and editing
// Owners are real. This spec provides development-renderer evidence, not a claim
// about the production renderer bundle or a paid CLI run.
const root = resolve(__dirname, '..', '..')
const temporaryPrefix = `${APP_E2E_TEMP_DIRECTORY_NAME}-r18-observation-`
type Surface = 'slide' | 'flow' | 'spatial-2d'
type Launch = { app: ElectronApplication; page: Page; runRoot: string; server: ViteDevServer }
type Fixture = { project: CourseProjectDocument; path: string; textId: string; surface: Surface }

function removeRunRoot(path: string): void {
  const absolute = resolve(path)
  const scoped = relative(resolve(tmpdir()), absolute)
  if (!scoped || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(scoped) || !scoped.split(/[\\/]/)[0]!.startsWith(temporaryPrefix)) {
    throw new Error(`Refusing to remove an unscoped observation profile: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
  if (child.exitCode === null) {
    const exited = await Promise.race([
      new Promise<boolean>(resolveExit => child.once('exit', () => resolveExit(true))),
      new Promise<boolean>(resolveExit => setTimeout(() => resolveExit(false), 5_000)),
    ])
    if (!exited && child.exitCode === null) child.kill()
  }
}

async function launchEditor(): Promise<Launch> {
  const runRoot = mkdtempSync(join(tmpdir(), `${temporaryPrefix}${process.pid}-`))
  let server: ViteDevServer | undefined
  let app: ElectronApplication | undefined
  try {
    server = await createServer({
      configFile: join(root, 'vite.renderer.config.ts'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
        watch: { ignored: ['**/output/**', '**/test-results/**'] } },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Missing Vite development server address')
    app = await electron.launch({
      args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' },
    })
    await expectBackgroundWindowsIsolated(app, true)
    const page = await app.firstWindow()
    // 冷启动只进入独立编辑器面（判据见 tests/e2e/lessonWorkspaceEntry.ts）。
    await enterIndependentEditor(page)
    return { app, page, runRoot, server }
  } catch (error) {
    if (app) await closeApp(app)
    if (server) await server.close()
    removeRunRoot(runRoot)
    throw error
  }
}

async function closeEditor(launch: Launch): Promise<void> {
  try { await closeApp(launch.app) }
  finally { await launch.server.close(); removeRunRoot(launch.runRoot) }
}

function fixtureAt(runRoot: string, surface: Surface): Fixture {
  const create = surface === 'slide' ? createBlankCourseProject
    : surface === 'flow' ? createBlankFlowCourseProject : createBlankSpatialCourseProject
  const project = create({ id: `observation-${surface}`, title: `观察验证 ${surface}`,
    includeDefaultController: false, controls: 'none' })
  const page = project.surfaces[0]!
  let textId = `observation-text-${surface}`
  if (page.type === 'flow') {
    const heading = page.blocks.find(block => block.type === 'heading')!
    textId = heading.id
    if (heading.type !== 'heading') throw new Error('Missing blank Flow heading')
    heading.content = { inlines: [{ type: 'text', text: `DISK ${surface}` }] }
    project.locations[0]!.label = plainDocumentText(heading.content)
  } else {
    const node = createTextNode({ id: textId, text: `DISK ${surface}`,
      x: page.type === 'slide' ? 120 : -220, y: page.type === 'slide' ? 120 : -100,
      width: 560, height: 130, style: { color: '#a51b38', fontSize: 44, bold: true } })
    const item = sceneNodeToCourseLayerItem(node, 1)
    if (page.type === 'slide') page.scenes[0]!.layerItems.push(item)
    else page.world.layerItems.push(item)
  }
  const path = join(runRoot, `${surface}.h5lesson`)
  writeFileSync(path, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
  return { project, path, textId, surface }
}

async function patchDialogs(app: ElectronApplication, paths: { open: string; saveAs?: string }): Promise<void> {
  // Only the native picker is replaced, to keep all windows hidden. Reading,
  // fingerprinting, ZIP parsing and writing still use the real Electron handlers.
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [values.open] })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async () => ({ canceled: !values.saveAs, filePath: values.saveAs })) as typeof dialog.showSaveDialog
  }, paths)
}

async function readState(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    const { readCanonicalCourse } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
    const canonical = await readCanonicalCourse()
    const history = { undoDepth: canonical.undoDepth, redoDepth: canonical.redoDepth }
    return { document, history, draft: state.v9ContentEdit ?? state.flowDocumentDraft ?? state.flowTextEdit ?? state.spatialContentEdit,
      flowSurfaceId: state.flowSession?.selection.surfaceId ?? null,
      path: state.projectPath, dirty: state.dirty, session: state.courseAuthoringSession }
  })
}

async function showEditorPanel(page: Page, name: '属性与素材' | null): Promise<void> {
  const controls = page.getByLabel('课件编辑面板', { exact: true })
  if (!await controls.isVisible()) return
  if (name) {
    const button = controls.getByRole('button', { name, exact: true })
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
    return
  }
  const close = controls.getByRole('button', { name: '关闭面板', exact: true })
  if (await close.isVisible()) await close.click()
}

async function openFixture(launch: Launch, fixture: Fixture, saveAs?: string): Promise<void> {
  await patchDialogs(launch.app, { open: fixture.path, saveAs })
  await launch.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
  await expect.poll(async () => (await readState(launch.page)).document?.id).toBe(fixture.project.id)
  if (fixture.surface === 'flow') {
    await expect.poll(async () => (await readState(launch.page)).flowSurfaceId).toBe(fixture.project.surfaces[0]!.id)
  }
  await expectBackgroundWindowsIsolated(launch.app, true)
}

async function editText(launch: Launch, fixture: Fixture, text: string, commit: boolean): Promise<void> {
  const page = launch.page
  if (fixture.surface === 'flow') {
    if (commit) {
      const block = page.getByTestId(`flow-block-${fixture.textId}`)
      await block.selectText()
      await page.keyboard.insertText(text)
      await expect(block).toContainText(text)
      await expect.poll(async () => JSON.stringify((await readState(page)).document)).toContain(text)
      return
    }
    const before = await readState(page)
    const surface = (before.document as CourseProjectDocument).surfaces.find(candidate => candidate.id === before.flowSurfaceId)
    if (!surface || surface.type !== 'flow') throw new Error('Expected active Flow surface')
    const blocks = structuredClone(surface.blocks)
    const block = blocks.find(candidate => candidate.id === fixture.textId)
    if (!block || block.type !== 'heading') throw new Error('Expected Flow heading draft target')
    block.content = { inlines: [{ type: 'text', text }] }
    const source = serializeDocumentMarkdown({ content: { blocks }, resources: { assets: [], components: [] } }, 'flow')
    const saveAs = join(launch.runRoot, `flow-memory-${Date.now()}.h5lesson`)
    await patchDialogs(launch.app, { open: fixture.path, saveAs })
    await page.evaluate(async record => {
      const recovery = window.desktopAPI.flowDocumentRecovery
      if (!recovery) throw new Error('Missing Flow document recovery API')
      const { revision, source, ...target } = record
      await recovery.read(target)
      await recovery.write({ ...target, revision, source, diagnostics: [], composing: false })
    }, { projectId: before.document.id, projectPath: saveAs, surfaceId: surface.id,
      epoch: `r18-observation-${Date.now()}`, revision: before.document.revision, source })
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(async () => (await readState(page)).path).toBe(saveAs)
    await expect.poll(async () => JSON.stringify((await readState(page)).draft)).toContain(text)
    const format = page.locator('details.flow-document-format')
    if (await format.getAttribute('open') === null) await format.locator('summary').click()
    await format.getByRole('button', { name: '源文', exact: true }).click()
    await expect(page.getByLabel('正文源文编辑')).toContainText(text)
    return
  } else {
    await page.evaluate(async textId => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      useEditorStore.getState().selectNodes([textId])
    }, fixture.textId)
    await showEditorPanel(page, '属性与素材')
    await page.getByRole('tab', { name: '属性', exact: true }).click()
    await page.getByRole('button', { name: '编辑局部文字格式', exact: true }).click()
  }
  const editor = page.getByTestId('text-edit-overlay')
  await expect(editor).toBeVisible()
  await editor.fill(text)
  await expect(editor).toHaveText(text)
  if (commit) {
    await editor.press('Control+Enter')
    await expect(editor).toHaveCount(0)
    await expect.poll(async () => JSON.stringify((await readState(page)).document)).toContain(text)
  } else {
    await expect.poll(async () => JSON.stringify((await readState(page)).draft)).toContain(text)
  }
}

async function discardTextDraft(page: Page, surface: Surface): Promise<void> {
  if (surface !== 'flow') {
    await page.getByTestId('text-edit-overlay').press('Escape')
    return
  }
  const format = page.locator('details.flow-document-format')
  if (await format.getAttribute('open') === null) await format.locator('summary').click()
  await format.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await readState(page)).draft).toBeFalsy()
  await format.getByRole('button', { name: '排版', exact: true }).click()
}

async function observationController(page: Page) {
  return page.evaluateHandle(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { createCurrentObservation } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
    return { observer: createCurrentObservation(), input: { intent: 'discuss' as const } }
  })
}

async function assertCapturedFrame(app: ElectronApplication, request: CurrentObservation, output: string) {
  const frame = request.resourceFiles?.find(file => file.path === 'observation/current-frame.png')
  expect(frame).toMatchObject({ mediaType: 'image/png', encoding: 'base64', role: 'image' })
  const bytes = Buffer.from(frame!.content, 'base64')
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const pixels = await app.evaluate(({ nativeImage }, png) => {
    const image = nativeImage.createFromDataURL(`data:image/png;base64,${png}`)
    const data = image.toBitmap()
    let light = 0, dark = 0, opaque = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3]! > 0) opaque += 1
      if (Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!) < 200) dark += 1
      if (Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!) > 235) light += 1
    }
    return { ...image.getSize(), light, dark, opaque, empty: image.isEmpty() }
  }, frame!.content)
  expect(pixels.empty).toBe(false)
  expect(pixels.width).toBeGreaterThan(100)
  expect(pixels.height).toBeGreaterThan(100)
  expect(pixels.opaque).toBeGreaterThan(10_000)
  expect(pixels.dark).toBeGreaterThan(30)
  expect(pixels.light).toBeGreaterThan(100)
  writeFileSync(output, bytes)
  return pixels
}

async function mountTemporaryCandidate(page: Page) {
  return page.evaluateHandle(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore, selectActiveCourseProjectDocument, selectMediaAssetFiles } = await load('/src/renderer/store/editorStore.ts')
    const { mountPublishedCourseTryRun, fitPublishedCourseStage } = await load('/src/renderer/ui/coursePlayerTryRun.ts')
    const state = useEditorStore.getState()
    const project = structuredClone(selectActiveCourseProjectDocument(state))
    project.revision += 1
    project.title = 'TEMPORARY CANDIDATE ONLY'
    const surface = project.surfaces[0]
    surface.scenes[0].backgroundColor = '#dbeafe'
    const container = document.createElement('div')
    container.dataset.testid = 'observation-temporary-candidate'
    // The property pane is outside the authoring capture root.
    container.style.cssText = 'position:fixed;right:12px;top:170px;width:230px;height:160px;z-index:10000;background:white;overflow:hidden'
    document.body.append(container)
    try {
      const session = await mountPublishedCourseTryRun({ container, project,
        assetFiles: selectMediaAssetFiles(state), components: state.componentPackages,
        locationId: project.startLocationId, observation: false })
      fitPublishedCourseStage(container)
      return { session, container, revision: project.revision }
    } catch (error) { container.remove(); throw error }
  })
}

async function assertAnimatedRuntimeObservation(launch: Launch, evidence: string): Promise<void> {
  const fixture = fixtureAt(launch.runRoot, 'slide')
  const slide = fixture.project.surfaces[0]!
  if (slide.type !== 'slide') throw new Error('Expected Slide fixture')
  slide.scenes[0]!.layerItems.push({
    kind: 'runtime', layerItemId: 'observation-continuous-runtime', label: 'Continuous observation probe',
    order: 2, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 100, y: 280, width: 600, height: 200 },
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      content: { values: {} }, assets: {}, source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
        const marker=document.createElement('div');marker.dataset.observationAnimation='true';
        marker.style.cssText='width:320px;height:130px;background:#a51b38;color:white;font:40px sans-serif';
        let frame=0;const tick=()=>{frame++;marker.dataset.frame=String(frame);marker.style.transform='translateX('+(frame%100)+'px)';marker.textContent='LIVE '+frame};
        tick();ctx.dom.root.append(marker);const timer=setInterval(tick,8);
        return{destroy(){clearInterval(timer);marker.remove()}}}})` },
  })
  writeFileSync(fixture.path, createCourseProjectArchive({ project: fixture.project, assetFiles: {}, componentFiles: {} }))
  await openFixture(launch, fixture)
  await launch.page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '当前位置试运行', exact: true }).click()
  const marker = launch.page.locator('[data-observation-animation="true"]').last()
  await expect(marker).toBeVisible()
  const observerHandle = await observationController(launch.page)
  const before = await readState(launch.page)
  const attempts: unknown[] = []
  let first: CurrentObservation | undefined
  let firstError: unknown
  try {
    // Exactly two observations distinguish initial observer delivery from a
    // persistent animation failure. The first failure still fails the test.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const frameBefore = await marker.getAttribute('data-frame')
      try {
        const request: CurrentObservation = await observerHandle.evaluate(value => value.observer.capture(value.input))
        const pixels = await assertCapturedFrame(launch.app, request, join(evidence, `runtime-frame-${attempt}.png`))
        attempts.push({ attempt, frameBefore, frameAfter: await marker.getAttribute('data-frame'), observation: request.observation, pixels })
        if (attempt === 0) first = request
      } catch (error) {
        attempts.push({ attempt, frameBefore, frameAfter: await marker.getAttribute('data-frame'), error: String(error) })
        if (attempt === 0) firstError = error
      }
    }
    const after = await readState(launch.page)
    writeFileSync(join(evidence, 'continuous-runtime.json'), JSON.stringify({ attempts, before, after }, null, 2))
    expect(after).toEqual(before)
    await expectBackgroundWindowsIsolated(launch.app, true)
    if (firstError) throw firstError
    expect(first!.observation).toMatchObject({ source: 'trial', documentRevision: fixture.project.revision })
    expect(first!.observation!.runtime).not.toBeNull()
  } finally {
    await observerHandle.evaluate(value => value.observer.dispose())
    await observerHandle.dispose()
  }
}

test('diagnostic: continuous Runtime frames remain observable', async () => {
  test.setTimeout(120_000)
  const launch = await launchEditor()
  const evidence = join(root, 'output', 'r18-103-observation', `runtime-${process.pid}-${Date.now()}`)
  mkdirSync(evidence, { recursive: true })
  try { await assertAnimatedRuntimeObservation(launch, evidence) }
  finally { await closeEditor(launch) }
})

test('real Electron observes each surface memory and active draft without history writes; a candidate mount stays separate', async () => {
  test.setTimeout(240_000)
  const launch = await launchEditor()
  const evidence = join(root, 'output', 'r18-103-observation', `drafts-${process.pid}-${Date.now()}`)
  mkdirSync(evidence, { recursive: true })
  const report: unknown[] = []
  try {
    for (const surface of ['slide', 'flow', 'spatial-2d'] as const) {
      const fixture = fixtureAt(launch.runRoot, surface)
      await openFixture(launch, fixture)
      await editText(launch, fixture, `MEMORY ${surface}`, true)
      const committed = await readState(launch.page)
      expect(committed.document.revision).toBe(fixture.project.revision + 1)
      await editText(launch, fixture, `DRAFT ${surface}`, false)
      const before = await readState(launch.page)
      expect(before.history.undoDepth).toBeGreaterThan(0)
      expect(before.draft).toBeTruthy()
      expect(JSON.stringify(before.document)).toContain(`MEMORY ${surface}`)
      expect(JSON.stringify(before.document)).not.toContain(`DRAFT ${surface}`)
      const observerHandle = await observationController(launch.page)
      try {
        let request: CurrentObservation
        try {
          request = await observerHandle.evaluate(value => value.observer.capture(value.input))
        } catch (error) {
          // A second capture is diagnostic only. It never converts a failed first
          // capture into a passing case or retries a CLI action/document command.
          const afterFailure = await readState(launch.page)
          const second = await observerHandle.evaluate(async value => {
            try { return { request: await value.observer.capture(value.input) } }
            catch (reason) { return { error: String(reason) } }
          })
          writeFileSync(join(evidence, `${surface}-capture-failure.json`), JSON.stringify({
            error: String(error), before, afterFailure,
            second: 'request' in second ? { observation: second.request.observation } : second,
          }, null, 2))
          if ('request' in second) await assertCapturedFrame(launch.app, second.request, join(evidence, `${surface}-diagnostic-second-frame.png`))
          throw error
        }
        const structureFile = request.resourceFiles!.find(file => file.path === 'observation/current-structure.json')!
        const structure = JSON.parse(structureFile.content)
        expect(request.observation).toMatchObject({ source: 'authoring', runtime: null,
          documentRevision: before.document.revision, surfaceId: before.document.surfaces[0].id,
          locationId: before.session.token.locationId })
        expect(structure).toMatchObject({ source: 'authoring', hasActiveDraft: true,
          canonicalDocumentRevision: before.document.revision, surfaceType: surface })
        expect(structureFile.content).toContain(`DRAFT ${surface}`)
        expect(structureFile.content).not.toContain(`DISK ${surface}`)
        expect(await readState(launch.page)).toEqual(before)
        expect(openCourseProjectArchive(readFileSync(fixture.path)).project).toEqual(fixture.project)
        const pixels = await assertCapturedFrame(launch.app, request, join(evidence, `${surface}-draft.png`))
        report.push({ surface, observation: request.observation, structure, pixels })
        if (surface === 'slide') {
          const candidate = await mountTemporaryCandidate(launch.page)
          try {
            await expect.poll(() => candidate.evaluate(value => value.session.readObservationState().ready)).toBe(true)
            expect(await candidate.evaluate(value => value.container.isConnected)).toBe(true)
            expect(await candidate.evaluate(value => value.revision)).toBe(before.document.revision + 1)
            const withCandidate: CurrentObservation = await observerHandle.evaluate(value => value.observer.capture(value.input))
            expect(withCandidate.observation).toMatchObject({ source: 'authoring', runtime: null,
              documentRevision: before.document.revision, surfaceId: request.observation!.surfaceId })
            expect(withCandidate.resourceFiles!.find(file => file.path === 'observation/current-structure.json')!.content)
              .toContain(`DRAFT ${surface}`)
            expect(await readState(launch.page)).toEqual(before)
            await assertCapturedFrame(launch.app, withCandidate, join(evidence, 'slide-with-candidate.png'))
          } finally {
            await candidate.evaluate(async value => { await value.session.destroy(); value.container.remove() })
            await candidate.dispose()
          }
        }
        await expectBackgroundWindowsIsolated(launch.app, true)
      } finally {
        await observerHandle.evaluate(value => value.observer.dispose())
        await observerHandle.dispose()
      }
      await discardTextDraft(launch.page, surface)
      await launch.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
      await expect.poll(async () => (await readState(launch.page)).dirty).toBe(false)
    }
    writeFileSync(join(evidence, 'observations.json'), JSON.stringify({ renderer: 'vite-development', report }, null, 2))
  } finally { await closeEditor(launch) }
})

test('real external file change prevents overwrite, while read-only observation and manual Save As preserve current memory', async () => {
  test.setTimeout(150_000)
  const launch = await launchEditor()
  try {
    const fixture = fixtureAt(launch.runRoot, 'flow')
    const saveAs = join(launch.runRoot, 'flow-recovered.h5lesson')
    await openFixture(launch, fixture, saveAs)
    await editText(launch, fixture, 'MEMORY TO RECOVER', true)
    const before = await readState(launch.page)
    const external = structuredClone(fixture.project)
    external.title = 'EXTERNAL DISK VERSION'
    external.revision += 7
    writeFileSync(fixture.path, createCourseProjectArchive({ project: external, assetFiles: {}, componentFiles: {} }))
    const fileStatus = () => launch.page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { readCanonicalCourse } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
      const canonical = await readCanonicalCourse()
      const api = window.desktopAPI.documents
      if (!api || canonical.binding.kind !== 'file') throw new Error('No bound document')
      const observed = await api.observeFile(canonical.documentId)
      return observed.version !== canonical.binding.version
    })
    await expect.poll(fileStatus).toBe(true)
    const observer = await observationController(launch.page)
    try {
      const captured: CurrentObservation = await observer.evaluate(value => value.observer.capture(value.input))
      expect(captured.document).toEqual(before.document)
    } finally { await observer.evaluate(value => value.observer.dispose()); await observer.dispose() }
    expect(await readState(launch.page)).toEqual(before)
    await launch.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect(launch.page.getByRole('alert')).toContainText('磁盘工程已有变化')
    expect(openCourseProjectArchive(readFileSync(fixture.path)).project).toEqual(external)
    const rejected = await readState(launch.page)
    expect(rejected.document).toEqual(before.document)
    expect(rejected.history).toEqual(before.history)
    expect(rejected.dirty).toBe(true)
    await launch.page.getByRole('button', { name: '关闭错误提示', exact: true }).click()
    await launch.page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(saveAs)).toBe(true)
    await expect.poll(async () => (await readState(launch.page)).path).toBe(saveAs)
    await expect.poll(async () => (await readState(launch.page)).dirty).toBe(false)
    expect(openCourseProjectArchive(readFileSync(saveAs)).project).toEqual(before.document)
    expect(openCourseProjectArchive(readFileSync(fixture.path)).project).toEqual(external)
    expect(await fileStatus()).toBe(false)
    await expectBackgroundWindowsIsolated(launch.app, true)
  } finally { await closeEditor(launch) }
})
