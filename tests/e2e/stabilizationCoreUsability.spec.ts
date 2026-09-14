import { isControllerFixture } from '../fixtures/teacherController'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, chromium, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { contentQaFixture } from '../fixtures/contentQa'
import { createProjectFontDeliveryFixture } from '../fixtures/projectFontDelivery'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { runDynamicAdmissionProbe } from './dynamicAdmissionProbe'
import { runFlowReviewProbe } from './flowReviewProbe'
import { runLocalCliFailureProbe } from './localCliFailureProbe'
import { installChatFailureFixture } from './chatFailureFixture'
import { fractionFallback, fractionComponentInstruction, exerciseFractionComponent, oscillationFallback, oscillationRuntimeInstruction, exerciseOscillationRuntime } from './generatedCarrierProbe'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { pptxImportFixture, pptxInheritanceFixture, pptxCommonMappingFixture, pptxEditableChartsFixture, pptxEditablePathsFixture } from '../fixtures/pptxImport'
import { pptxEquationFixture } from '../fixtures/pptxEquation'
import { pptxDiagramFixture } from '../fixtures/pptxDiagram'
import { buildCoursePptx } from '../../src/renderer/export/course/buildCoursePptx'
import { createServer } from 'vite'
import type { CoursewareCaseBuildSummary } from '../../scripts/build-courseware-case'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
} from '../../src/shared/courseProjectTypes'
import {
  APP_E2E_TEMP_DIRECTORY_NAME,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
} from '../../src/shared/constants'
import { rotatedRectangleAabb } from '../../src/shared/geometry'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
const FLOW_SELECTION_TEXT = '真实鼠标拖选应跨越多个文字范围'

interface Diagnostics {
  pageErrors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  externalRequests: string[]
}

interface LaunchedEditor extends Diagnostics {
  app: ElectronApplication
  page: Page
  runRoot: string
}

type TeacherControllerItem = import('../fixtures/teacherController').ControllerFixture

function removeRunRoot(runRoot: string): void {
  const absolute = resolve(runRoot)
  const temporaryRoot = resolve(tmpdir())
  const scoped = relative(temporaryRoot, absolute)
  const leaf = scoped.split(/[\\/]/)[0] ?? ''
  if (
    !scoped ||
    scoped === '..' ||
    scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(scoped) ||
    !leaf.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-wave-a-`)
  ) {
    throw new Error(`Refusing to remove an unscoped Wave A directory: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeEditor(app: ElectronApplication, runRoot: string): Promise<void> {
  const child = app.process()
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
  if (child.exitCode === null) {
    const exited = await Promise.race([
      new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
      new Promise<boolean>((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
    ])
    if (!exited && child.exitCode === null) {
      child.kill()
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null) return resolveExit()
        child.once('exit', () => resolveExit())
        setTimeout(resolveExit, 5_000)
      })
    }
  }
  removeRunRoot(runRoot)
}

async function launchEditor(developmentUrl = ''): Promise<LaunchedEditor> {
  const runRoot = mkdtempSync(
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-wave-a-${process.pid}-`),
  )
  const userDataPath = join(runRoot, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataPath}`],
      cwd: root,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: developmentUrl,
        COURSEWARE_CLI_DOGFOOD: '',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        [BACKGROUND_E2E_ENV]: '1',
      },
    })
    const diagnostics: Diagnostics = {
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: [],
      externalRequests: [],
    }
    const attached = new WeakSet<Page>()
    const attach = (target: Page) => {
      if (attached.has(target)) return
      attached.add(target)
      target.on('pageerror', (error) => diagnostics.pageErrors.push(error.message))
      target.on('console', (message) => {
        if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
        if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text())
      })
    }
    const context = app.context()
    context.on('page', attach)
    context.on('request', (request) => {
      if (/^https?:/i.test(request.url())) diagnostics.externalRequests.push(request.url())
    })
    const page = await app.firstWindow()
    attach(page)
    await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const professional = page.getByRole('button', { name: '专业' })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    return { app, page, runRoot, ...diagnostics }
  } catch (error) {
    if (app) await closeEditor(app, runRoot).catch(() => undefined)
    else removeRunRoot(runRoot)
    throw error
  }
}

async function patchProjectDialogs(
  app: ElectronApplication,
  paths: { projectSave?: string; projectOpen?: string },
): Promise<void> {
  await app.evaluate(({ dialog }, values) => {
    dialog.showSaveDialog = (async (): Promise<Electron.SaveDialogReturnValue> => ({
      canceled: !values.projectSave,
      filePath: values.projectSave ?? '',
    })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: !values.projectOpen,
      filePaths: values.projectOpen ? [values.projectOpen] : [],
    })) as typeof dialog.showOpenDialog
  }, paths)
}

async function pressDesktopSaveShortcut(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Editor window is unavailable')
    window.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'S',
      modifiers: ['control'],
    })
    window.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'S',
      modifiers: ['control'],
    })
  })
}

function readProject(projectPath: string): CourseProjectDocument {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
}

function spatialWorldTextContents(project: CourseProjectDocument): string[] {
  return project.surfaces.flatMap((surface) => (
    surface.type === 'spatial-2d'
      ? surface.world.layerItems.flatMap((item) => (
          item.kind === 'native' && item.content.nativeType === 'text'
            ? [item.content.data.text]
            : []
        ))
      : []
  ))
}

function flowTextContents(project: CourseProjectDocument): string[] {
  const collect = (blocks: Extract<CourseProjectDocument['surfaces'][number], { type: 'flow' }>['blocks']): string[] => (
    blocks.flatMap((block) => {
      const own = 'text' in block && typeof block.text === 'string' ? [block.text] : []
      return block.type === 'section' ? [...own, ...collect(block.blocks)] : own
    })
  )
  return project.surfaces.flatMap((surface) => (
    surface.type === 'flow' ? collect(surface.blocks) : []
  ))
}

async function saveAs(
  app: ElectronApplication,
  page: Page,
  projectPath: string,
): Promise<CourseProjectDocument> {
  await patchProjectDialogs(app, { projectSave: projectPath, projectOpen: projectPath })
  await page.getByRole('button', { name: '另存为' }).click()
  await expect.poll(
    () => existsSync(projectPath) ? statSync(projectPath).size : 0,
    { timeout: 15_000 },
  ).toBeGreaterThan(100)
  return readProject(projectPath)
}

async function saveCurrent(page: Page, projectPath: string): Promise<CourseProjectDocument> {
  const previousMtime = statSync(projectPath).mtimeMs
  await page.waitForTimeout(25)
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
  await expect.poll(() => statSync(projectPath).mtimeMs, { timeout: 15_000 })
    .toBeGreaterThan(previousMtime)
  return readProject(projectPath)
}

function courseTreeKind(page: Page, kind: string): Locator {
  return page.getByTestId('course-page-tree').locator(`[data-kind="${kind}"]`)
}

async function openSlide(page: Page): Promise<void> {
  await courseTreeKind(page, 'slide-scene').first().locator('button.course-page-tree__label').first().click()
  await expect(page.locator('[data-testid="canvas-stage"] canvas')).toBeVisible()
}

async function openSpatial(page: Page): Promise<void> {
  await courseTreeKind(page, 'spatial-camera').first().locator('button.course-page-tree__label').first().click()
  await expect(page.getByTestId('spatial-workspace')).toBeVisible()
}

async function openFlow(page: Page): Promise<void> {
  await courseTreeKind(page, 'flow-page').first().locator('button.course-page-tree__label').first().click()
  await expect(page.getByTestId('flow-workspace')).toBeVisible()
}

async function addSurface(page: Page, kind: 'spatial' | 'flow'): Promise<void> {
  await page.getByTitle('新增其他类型页面').click()
  await expect(page.getByTestId('add-content-menu')).toBeVisible()
  await page.getByTestId(`add-${kind}-page`).click()
}

function commonNodeField(page: Page, label: 'X' | 'Y' | '宽' | '高'): Locator {
  return page.locator('.property-section').first().getByLabel(label, { exact: true })
}

async function setCurrentNodeGeometry(
  page: Page,
  geometry: Record<'X' | 'Y' | '宽' | '高', number>,
): Promise<void> {
  for (const [label, value] of Object.entries(geometry) as Array<
    ['X' | 'Y' | '宽' | '高', number]
  >) {
    const field = commonNodeField(page, label)
    await field.fill(String(value))
    await field.press('Enter')
  }
}

function teacherControllerRows(page: Page): Locator {
  return page.getByTestId('nodes-tab').locator('.node-item').filter({
    has: page.locator('.node-type-icon[title="teacher-controller"]'),
  })
}

function teacherController(project: CourseProjectDocument): TeacherControllerItem {
  const item = project.globalLayerItems.find((entry) => (
    isControllerFixture(entry.item)
  ))?.item
  if (!item || !isControllerFixture(item)) {
    throw new Error('Saved project is missing its global teacher controller')
  }
  return item as TeacherControllerItem
}

function effectiveItems(project: CourseProjectDocument): LayerItem[] {
  const items = project.globalLayerItems.map((entry) => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map((entry) => entry.item))
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) items.push(...scene.layerItems)
    } else if (surface.type === 'spatial-2d') {
      items.push(...surface.world.layerItems)
    }
  }
  return items
}

async function flowTextPoint(
  editor: Locator,
  offset: number,
  edge: 'start' | 'end',
): Promise<{ x: number; y: number }> {
  return editor.evaluate((root, input) => {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let remaining = input.offset
    let textNode: Text | null = null
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text
      if (remaining <= candidate.data.length) {
        textNode = candidate
        break
      }
      remaining -= candidate.data.length
    }
    if (!textNode) throw new Error(`Cannot resolve Flow text offset ${input.offset}`)
    const start = Math.min(remaining, Math.max(0, textNode.data.length - 1))
    const range = root.ownerDocument.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, Math.min(textNode.data.length, start + 1))
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    return {
      x: input.edge === 'start' ? rect.left + 1 : rect.right - 1,
      y: rect.top + rect.height / 2,
    }
  }, { offset, edge })
}

async function expectInertPageController(
  page: Page,
  surface: 'flow' | 'spatial',
): Promise<void> {
  const rootLocator = surface === 'flow'
    ? page.getByTestId('flow-workspace')
    : page.getByTestId('spatial-hud-layer')
  const chrome = rootLocator.getByTestId('teacher-controller-authoring-chrome')
  await expect(chrome).toBeVisible()
  await expect(chrome).toHaveAttribute('data-controller-preview-collapsed', 'true')
  await expect(chrome).toHaveAttribute('aria-hidden', 'true')
  expect(await chrome.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none')
  const nav = chrome.locator('nav')
  await expect(nav).toHaveAttribute('inert', '')
  await expect(nav).toHaveAttribute('tabindex', '-1')
  const point = await chrome.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const left = Math.max(1, rect.left)
    const right = Math.min(innerWidth - 1, rect.right)
    const top = Math.max(1, rect.top)
    const bottom = Math.min(innerHeight - 1, rect.bottom)
    if (right <= left || bottom <= top) throw new Error('Controller preview is outside the viewport')
    const x = left + (right - left) * 0.45
    const y = top + (bottom - top) / 2
    const hit = document.elementFromPoint(x, y)
    return { x, y, hitInside: Boolean(hit && element.contains(hit)) }
  })
  expect(point.hitInside).toBe(false)
  await page.mouse.click(point.x, point.y)
  await expect(rootLocator).toBeVisible()
  await expect(page.getByTestId('teacher-controller-overlay')).toHaveCount(0)
}

async function beginControllerDrag(page: Page): Promise<{
  workspace: Locator
  target: { x: number; y: number }
}> {
  const box = page.locator('.teacher-controller-overlay__box')
  await expect(box).toBeVisible()
  const bounds = await box.boundingBox()
  if (!bounds) throw new Error('Teacher controller selection box is not visible')
  const workspace = page.getByRole('main', { name: '课件画布' })
  const workspaceBounds = await workspace.boundingBox()
  if (!workspaceBounds) throw new Error('Course workspace is not visible')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  const target = { x: workspaceBounds.x + 4, y: workspaceBounds.y + 4 }
  await page.mouse.move(target.x, target.y, { steps: 8 })
  return { workspace, target }
}

function expectCleanDiagnostics(diagnostics: Diagnostics): void {
  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.consoleErrors).toEqual([])
  expect(diagnostics.externalRequests).toEqual([])
  const knownBadImageWarnings = diagnostics.consoleWarnings.filter((message) => (
    /^WebGL: INVALID_VALUE: texImage2D: bad image data$/.test(message)
  ))
  expect(knownBadImageWarnings.length).toBeLessThanOrEqual(1)
  expect(diagnostics.consoleWarnings.filter((message) => !(
    /^WebGL: INVALID_VALUE: texImage2D: bad image data$/.test(message)
  ))).toEqual([])
}

test('S2 Builder V2：两份 Markdown 生成三 Surface 并在离线 HTML 连续操作', async () => {
  test.setTimeout(120_000)
  const runRoot = mkdtempSync(join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-wave-a-builder-v2-`))
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const fixture = join(root, 'tests/fixtures/builder-v2-case')
    for (const name of ['build.mjs', '01-teaching-plan.md', '02-presentation-script.md']) writeFileSync(join(runRoot, name), readFileSync(join(fixture, name)))
    const processResult = await promisify(execFile)(process.execPath, ['--import', 'tsx', join(root, 'scripts/build-courseware-case.ts'),
      '--case-dir', runRoot, '--builder', 'build.mjs', '--project', 'lesson.h5lesson', '--html', 'lesson.html'],
    { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 90_000 })
    const built = JSON.parse(processResult.stdout) as CoursewareCaseBuildSummary
    expect(built.surfaces).toBe(3)
    expect(built.validation.error).toBe(0)
    expect(built.receipts).toHaveLength(14)
    expect(built.receipts!.every(receipt => receipt.status === 'committed')).toBe(true)
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(built.project)))
    const spatial = reopened.project.surfaces.find(surface => surface.type === 'spatial-2d')!
    if (spatial.type !== 'spatial-2d') throw new Error('Missing Spatial')
    expect(spatial.world.paths).toHaveLength(1)
    expect(spatial.world.relations).toHaveLength(1)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(pathToFileURL(built.html).href)
    await page.getByRole('button', { name: '1/2 · 点击改变总份数', exact: true }).click()
    await expect(page.getByRole('button', { name: '1/4 · 点击改变总份数', exact: true })).toBeVisible()
    const paintedClick = async (locator: Locator) => {
      const box = await locator.boundingBox()
      if (!box) throw new Error('Painted control missing')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await paintedClick(page.getByRole('button', { name: '展开教师控制器', exact: true }))
    await paintedClick(page.getByRole('button', { name: '下一场景', exact: true }))
    await paintedClick(page.getByText('B. 平均分的总份数', { exact: true }))
    await expect(page.getByText('正确：分母表示平均分的总份数。', { exact: true })).toBeVisible()
    await paintedClick(page.getByRole('button', { name: '下一场景', exact: true }))
    await expect(page.getByRole('heading', { name: '分数复习讲义', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: '平均分成四份，取一份', exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/r18-short-path/builder-v2-flow.png' })
    await paintedClick(page.getByRole('button', { name: '下一场景', exact: true }))
    const spatialRegion = page.getByRole('region', { name: '分数关系图 空间探索', exact: true })
    await expect(spatialRegion).toBeVisible()
    await expect(spatialRegion.getByText('场景 4/4 · 步骤 1/2', { exact: true })).toBeVisible()
    await paintedClick(spatialRegion.getByRole('button', { name: '下一步', exact: true }))
    await expect(spatialRegion.getByText('场景 4/4 · 步骤 2/2', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/r18-short-path/builder-v2-spatial.png' })
    expect(pageErrors).toEqual([])
  } finally {
    await browser?.close()
    removeRunRoot(runRoot)
  }
})

test('Flow review: video lifecycle, anchor continuity and overlay visibility', async () => {
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`)
    const result = await runFlowReviewProbe(page)
    const { rotation, ...checks } = result
    for (const [name, passed] of Object.entries(checks)) expect(passed, name).toBe(true)
    expect(rotation).toBe('matrix(0.866025, 0.5, -0.5, 0.866025, 0, 0)')
  } finally {
    await browser.close()
    await server.close()
  }
})

test('S3 独立动态准入：正常候选、同步死循环终止与编辑保存响应', async () => {
  test.setTimeout(120_000)
  const { app, page, runRoot } = await launchEditor()
  const markers: string[] = []
  app.context().on('page', worker => worker.on('console', message => {
    if (message.text().startsWith('ADMISSION_SYNC_')) markers.push(message.text())
  }))
  try {
    const font = new Uint8Array(readFileSync(join(root, 'node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2')))
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
    const sources = await createProjectFontDeliveryFixture(font, fallback)
    const payload = { project: sources.project,
      assetFiles: Object.fromEntries(Object.entries(sources.assetFiles).map(([id, data]) => [id, Buffer.from(data).toString('base64')])),
      componentFiles: Object.fromEntries(Object.entries(sources.components).map(([id, data]) => [id,
        Object.fromEntries(Object.entries(data.files).map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]))])),
      targets: [{ locationId: sources.project.startLocationId, instanceIds: ['runtime-font'] }] }
    const good = await page.evaluate(payload => window.desktopAPI.dynamicAdmission!({ operation: 'run', id: crypto.randomUUID(), payload }), payload)
    expect(good.ok, good.message).toBe(true)
    const mainPid = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.getOSProcessId())
    expect(good.processId).not.toBe(mainPid)
    const filename = join(runRoot, 'admission-responsive.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const original = readProject(filename)
    for (const phase of ['register', 'create', 'capture'] as const) {
      const input = structuredClone(payload)
      const surface = input.project.surfaces[0]!
      if (surface.type !== 'slide') throw new Error('Wrong fixture surface')
      const runtime = surface.scenes[0]!.layerItems.find(item => item.kind === 'runtime')!
      if (runtime.kind !== 'runtime') throw new Error('Missing fixture runtime')
      runtime.runtime.source = phase === 'register'
        ? 'console.info("ADMISSION_SYNC_register");for(;;){};CoursewareRuntime.define({runtimeApiVersion:2,create(){return {}}})'
        : phase === 'create'
        ? 'CoursewareRuntime.define({runtimeApiVersion:2,create(){console.info("ADMISSION_SYNC_create");for(;;){}}})'
        : 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {prepareCapture(){console.info("ADMISSION_SYNC_capture");for(;;){}},destroy(){}}}})'
      const id = await page.evaluate(payload => {
        const id = crypto.randomUUID()
        Reflect.set(window, '__admissionPending', window.desktopAPI.dynamicAdmission!({ operation: 'run', id, payload }))
        return id
      }, input)
      await expect.poll(() => markers.includes(`ADMISSION_SYNC_${phase}`)).toBe(true)
      await page.getByTestId('add-content-primary').click({ timeout: 3000 })
      const saved = await saveCurrent(page, filename)
      expect(saved.revision).toBeGreaterThan(original.revision)
      expect(saved.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : []).some(item => item.kind === 'runtime')).toBe(false)
      if (phase === 'capture') await page.evaluate(id => window.desktopAPI.dynamicAdmission!({ operation: 'cancel', id }), id)
      const result = await page.evaluate(() => Reflect.get(window, '__admissionPending'))
      expect(result.ok).toBe(false)
      expect(result.message).toContain(phase === 'capture' ? '取消' : '超时')
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('admission.html')).length)).toBe(0)
    }
  } finally { await closeEditor(app, runRoot) }
})

test('S3 独立动态工具：组件与 Runtime 的三 Surface 准入回归', async () => {
  test.setTimeout(180_000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
  let launch: LaunchedEditor | undefined
  try {
    launch = await launchEditor(`http://127.0.0.1:${address.port}/`)
    const result = await runDynamicAdmissionProbe(launch.page)
    for (const key of ['good', 'componentGood', 'disabled', 'configured', 'componentConfigured'] as const) expect(result[key].status, JSON.stringify(result[key])).toBe('committed')
    for (const key of ['bad', 'componentBad', 'missing', 'timeout', 'conflict'] as const) expect(result[key].status, JSON.stringify(result[key])).toBe('failed')
    expect(result.stale.status).toBe('stale')
    expect(result.stateOnlyFailure.status).toBe('failed')
    expect(result.stateOnlyFailure.after).toBe(result.stateOnlyFailure.before)
    expect(result.missing.diagnostics[0].path).toContain('source')
    for (const inserted of result.insertedRuntimes) expect(inserted.status, JSON.stringify(inserted)).toBe(inserted.surfaceType === 'spatial-2d' ? 'failed' : 'committed')
    for (const inserted of result.insertedComponents) expect(inserted.status, JSON.stringify(inserted)).toBe('committed')
    expect(result.componentPlacements).toHaveLength(2)
    for (const placed of result.componentPlacements) {
      expect(placed.status, JSON.stringify(placed)).toBe('committed')
      expect(placed.frame).toMatchObject({ x: 40, y: 80, width: 320, height: 180 })
      expect(placed.label).toBe('Placed component')
    }
    expect(result.captureFailures).toHaveLength(17)
    expect(result.runtimeUpdateFailures).toHaveLength(10)
    for (const failure of result.runtimeUpdateFailures) {
      expect(failure.status, JSON.stringify(failure)).toBe('failed')
      expect(failure.diagnostics.some((entry: { code: string }) => entry.code === 'dynamic-host-failed')).toBe(true)
      expect(failure.projectUnchanged).toBe(true)
      expect(failure.resourcesUnchanged).toBe(true)
    }
    for (const failure of result.captureFailures) {
      expect(failure.status, JSON.stringify(failure)).toBe('failed')
      expect(failure.after).toBe(failure.before)
      expect(failure.projectUnchanged).toBe(true)
      expect(failure.resourcesUnchanged).toBe(true)
    }
  } finally {
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 聊天失败注入：一次修复、无进展停止、取消与人工撤销后旧结果零写入', async () => {
  test.setTimeout(90000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    fixture = await installChatFailureFixture(app, runRoot)
    const filename = join(runRoot, 'failure-chat.h5lesson')
    const original = await saveAs(app, page, filename)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('应用方式', { exact: true }).selectOption('preview')
    const readSession = async (sessionId: string) => (await page.evaluate(input => window.desktopAPI.localAgent(input), {
      operation: 'read' as const, sessionId, after: 0, projectId: original.id, projectPath: filename,
    })).records![0]!
    const assertContinuation = (runs: ReturnType<NonNullable<typeof fixture>['runs']>) => {
      expect(new Set(runs.map(run => run.nativeThreadId)).size).toBe(1)
      expect(new Set(runs.map(run => run.nativeTurnId)).size).toBe(runs.length)
      expect(new Set(runs.map(run => run.requestId)).size).toBe(runs.length)
      expect(runs[0].previousRequestId).toBeNull()
      for (let index = 1; index < runs.length; index++) expect(runs[index].previousRequestId).toBe(runs[index - 1].requestId)
    }
    const send = async () => {
      await chat.getByLabel('发送给创作助手').fill('添加平均分讲解')
      await chat.getByRole('button', { name: '发送', exact: true }).click()
    }
    fixture.mode('repair'); await send()
    await expect.poll(() => fixture!.runs().length).toBeGreaterThanOrEqual(1)
    await expect(chat.getByLabel('会话', { exact: true })).not.toHaveValue('')
    const repairSessionId = await chat.getByLabel('会话', { exact: true }).inputValue()
    const repairTaskId = (await readSession(repairSessionId)).task!.taskId
    await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toBeEnabled({ timeout: 20000 })
    expect(fixture.runs().map(run => [run.revision, run.repair])).toEqual([[0, false], [0, true]])
    assertContinuation(fixture.runs())
    expect(await chat.getByLabel('会话', { exact: true }).inputValue()).toBe(repairSessionId)
    expect((await readSession(repairSessionId)).task!.taskId).toBe(repairTaskId)
    expect(await saveCurrent(page, filename)).toEqual(original)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    await expect(chat.getByLabel('会话', { exact: true })).toBeEnabled()
    const applied = await saveCurrent(page, filename)
    expect(applied.revision).toBe(1)
    fixture.mode('no-progress'); await send()
    await expect.poll(() => fixture!.runs().length).toBeGreaterThanOrEqual(3)
    await expect(chat.getByLabel('会话', { exact: true })).not.toHaveValue(repairSessionId)
    const stagnantSessionId = await chat.getByLabel('会话', { exact: true }).inputValue()
    const stagnantTaskId = (await readSession(stagnantSessionId)).task!.taskId
    await expect(chat.getByRole('alert')).toContainText('连续两轮没有进展', { timeout: 20000 })
    await expect(chat.getByLabel('会话', { exact: true })).toBeEnabled()
    // The first rejected candidate establishes the baseline; two repeats stop
    // this same task without dispatching a fourth native turn.
    expect(fixture.runs().slice(2).map(run => [run.revision, run.repair])).toEqual([[1, false], [1, true], [1, true]])
    assertContinuation(fixture.runs().slice(2))
    expect(await chat.getByLabel('会话', { exact: true }).inputValue()).toBe(stagnantSessionId)
    expect((await readSession(stagnantSessionId)).task!.taskId).toBe(stagnantTaskId)
    expect(await saveCurrent(page, filename)).toEqual(applied)
    expect(fixture.runs()).toHaveLength(5)
    fixture.mode('delayed'); await send()
    await expect.poll(() => fixture!.runs().length).toBe(6)
    const cancelledSessionId = await chat.getByLabel('会话', { exact: true }).inputValue()
    await chat.getByRole('button', { name: '停止', exact: true }).click()
    await expect(chat.getByRole('status').filter({ hasText: '已停止' })).toBeVisible()
    await expect.poll(async () => (await readSession(cancelledSessionId)).status).toBe('cancelled')
    await expect.poll(() => Date.now(), { timeout: 6000 }).toBeGreaterThan(fixture.runs()[5].lateAt!)
    expect(await saveCurrent(page, filename)).toEqual(applied)
    expect(fixture.runs()).toHaveLength(6)
    await send()
    await expect.poll(() => fixture!.runs().length).toBe(7)
    // The dedicated AI undo is disabled during a task. A real editor undo must
    // still invalidate a candidate captured against the pre-undo revision.
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(chat.getByRole('alert')).toContainText('课件或任务已变化，本次未应用的修改已丢弃', { timeout: 10000 })
    await expect(chat.getByLabel('会话', { exact: true })).toBeEnabled()
    expect(fixture.runs()).toHaveLength(7)
    expect(await saveCurrent(page, filename)).toEqual(original)
    const records = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: original.id, projectPath: filename })
    expect(records.records?.map(record => record.hostResult?.status)).toEqual(expect.arrayContaining(['committed', 'rejected']))
    // Undo invalidates this task before its delayed candidate enters host preparation.
    // No candidate result should be invented for a turn that was cancelled while waiting.
    const invalidatedRequestId = fixture.runs()[6].requestId
    const invalidatedRecord = async () => {
      const value = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: original.id, projectPath: filename })
      const record = value.records?.find(record => record.generationRequestId === invalidatedRequestId)
      return record ? readSession(record.id) : undefined
    }
    await expect.poll(async () => (await invalidatedRecord())?.status).toBe('cancelled')
    expect((await invalidatedRecord())?.hostResult).toBeUndefined()
    expect((await invalidatedRecord())?.task?.committedStages).toBe(0)
    await expect.poll(() => Date.now(), { timeout: 6000 }).toBeGreaterThan(fixture.runs()[6].lateAt!)
    expect(await saveCurrent(page, filename)).toEqual(original)
    expect(fixture.runs()).toHaveLength(7)
    await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
    await send()
    try {
      await expect.poll(() => fixture!.runs().length).toBe(8)
    } finally {
      const diagnosticRoot = join(root, 'output', 'r18-ux', `failure-injection-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      mkdirSync(diagnosticRoot, { recursive: true })
      const snapshots = await Promise.allSettled([
        chat.ariaSnapshot(),
        chat.getByRole('alert').allTextContents(),
        page.evaluate(async owner => {
          const listed = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
          return Promise.all((listed.records ?? []).map(record => window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: record.id, after: 0 })))
        }, { projectId: original.id, projectPath: filename }),
        page.screenshot({ path: join(diagnosticRoot, 'after-eighth-send.png') }),
      ])
      writeFileSync(join(diagnosticRoot, 'after-eighth-send.json'), JSON.stringify({
        fixtureRuns: fixture.runs(), pageErrors: launch.pageErrors,
        snapshots: snapshots.slice(0, 3).map(result => result.status === 'fulfilled' ? result.value : { error: String(result.reason) }),
      }, null, 2))
      console.log(`Failure-injection diagnostic: ${diagnosticRoot}`)
    }
    const newPath = join(runRoot, 'new-workspace.h5lesson')
    expect(await saveAs(app, page, newPath)).toEqual(original)
    await expect.poll(async () => {
      const result = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: original.id, projectPath: filename })
      return result.records?.find(record => record.generationRequestId === fixture!.runs()[7].requestId)?.status
    }).toBe('cancelled')
    await expect.poll(() => Date.now(), { timeout: 6000 }).toBeGreaterThan(fixture!.runs()[7].lateAt!)
    const newRecords = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: original.id, projectPath: newPath })
    expect(newRecords.records).toEqual([])
    expect(await saveCurrent(page, newPath)).toEqual(original)
    expect(fixture.runs()).toHaveLength(8)
    expect(launch.pageErrors).toEqual([])
  } finally {
    if (fixture) await fixture.restore()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 候选格式：非法JSON与缺通道共用一次修复预算', async () => {
  test.setTimeout(90000)
  const launch = await launchEditor()
  const { app, page, runRoot } = launch
  const fixture = await installChatFailureFixture(app, runRoot)
  try {
    const filename = join(runRoot, 'format-repair.h5lesson')
    const original = await saveAs(app, page, filename)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('应用方式', { exact: true }).selectOption('preview')
    for (const mode of ['format-repair', 'missing-candidate', 'format-repeat'] as const) {
      const count = fixture.runs().length
      const previousSessionId = await chat.getByLabel('会话', { exact: true }).inputValue()
      fixture.mode(mode)
      await chat.getByLabel('发送给创作助手').fill('添加平均分讲解')
      await chat.getByRole('button', { name: '发送', exact: true }).click()
      await expect.poll(() => fixture.runs().length).toBeGreaterThan(count)
      await expect(chat.getByLabel('会话', { exact: true })).not.toHaveValue(previousSessionId)
      const sessionId = await chat.getByLabel('会话', { exact: true }).inputValue()
      const readSession = async () => (await page.evaluate(input => window.desktopAPI.localAgent(input), {
        operation: 'read' as const, sessionId, after: 0, projectId: original.id, projectPath: filename,
      })).records![0]!
      const taskId = (await readSession()).task!.taskId
      if (mode === 'format-repeat') {
        await expect(chat.getByRole('alert')).toContainText('连续两轮没有进展', { timeout: 20000 })
        await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
      } else await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toBeEnabled({ timeout: 20000 })
      const runs = fixture.runs().slice(count)
      expect(runs.map(run => [run.revision, run.repair])).toEqual([[original.revision, false], [original.revision, true]])
      expect(runs.map(run => run.injection)).toEqual(mode === 'format-repeat' ? ['invalid-json', 'missing-channel'] : [mode === 'format-repair' ? 'invalid-json' : 'missing-channel', null])
      expect(runs[1].previousRequestId).toBe(runs[0].requestId)
      expect(runs[1].nativeThreadId).toBe(runs[0].nativeThreadId)
      expect(runs[1].nativeTurnId).not.toBe(runs[0].nativeTurnId)
      expect(await chat.getByLabel('会话', { exact: true }).inputValue()).toBe(sessionId)
      expect((await readSession()).task!.taskId).toBe(taskId)
      expect(await saveCurrent(page, filename)).toEqual(original)
      if (mode !== 'format-repeat') await chat.getByRole('button', { name: '停止', exact: true }).click()
      await expect(chat.getByLabel('会话', { exact: true })).toBeEnabled()
      expect(fixture.runs()).toHaveLength(count + 2)
    }
    expect(launch.pageErrors).toEqual([])
  } finally { await fixture.restore(); await closeEditor(app, runRoot) }
})

test('S3 默认可见与普通讨论：安全消息、完整历史及零工程写入', async () => {
  test.setTimeout(90000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    fixture = await installChatFailureFixture(app, runRoot); fixture.mode('discussion')
    const filename = join(runRoot, 'discussion.h5lesson')
    const original = await saveAs(app, page, filename)
    const requests: string[] = []; page.on('request', request => { if (request.url().includes('invalid.example')) requests.push(request.url()) })
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('意图', { exact: true }).selectOption('discuss')
    await chat.getByLabel('发送给创作助手').fill('讨论如何解释平均分，先不修改课件。')
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect(chat.getByRole('heading', { name: '只讨论，不修改课件' })).toBeVisible({ timeout: 20000 })
    await expect(chat.getByRole('button', { name: '发送输入', exact: true })).toBeDisabled()
    await expect(chat.getByLabel('会话', { exact: true })).toBeEnabled({ timeout: 10000 })
    await expect(chat.getByText(/诊断详情|原生事件/)).toHaveCount(0)
    await expect(chat.locator('.chat-transcript [data-message-id]')).toHaveCount(2)
    await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
    expect(await saveCurrent(page, filename)).toEqual(original)
    expect(await page.evaluate(() => Reflect.get(window, '__unsafeChatExecuted'))).toBeUndefined()
    await expect(chat.getByText('<script>window.__unsafeChatExecuted=true</script>', { exact: true })).toBeVisible()
    await expect(chat.locator('script, iframe, img, a[href^="javascript:"]')).toHaveCount(0)
    expect(requests).toEqual([])
    const id = await chat.getByLabel('会话', { exact: true }).inputValue()
    await chat.getByLabel('会话', { exact: true }).selectOption('')
    await chat.getByLabel('会话', { exact: true }).selectOption(id)
    await expect(chat.getByText(/诊断详情|原生事件/)).toHaveCount(0)
    await expect(chat.getByRole('heading', { name: '只讨论，不修改课件' })).toBeVisible()
    await expect(chat.getByText('平均分是分数的前提。', { exact: true })).toBeVisible()
    await expect(chat.locator('.chat-transcript [data-message-id]')).toHaveCount(2)
    await expect(chat.getByRole('region', { name: '用户消息' })).toHaveText(/讨论如何解释平均分，先不修改课件。/)
    const recorded = (await page.evaluate(input => window.desktopAPI.localAgent(input), {
      operation: 'read' as const, sessionId: id, after: 200, projectId: original.id, projectPath: filename,
    })).records![0]!
    expect(recorded.events.length).toBeGreaterThan(0)
    expect(recorded.events.some(event => event.kind === 'completed')).toBe(true)
    expect(await saveCurrent(page, filename)).toEqual(original)
    expect(launch.pageErrors).toEqual([])
  } finally {
    if (fixture) await fixture.restore()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

for (const adapter of ['codex', 'claude', 'opencode'] as const) test(`S3 真实聊天：${adapter} 生成候选、继续修改、单次撤销与保存`, async () => {
  test.setTimeout(600000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const path = join(runRoot, `chat-${adapter}.h5lesson`)
    await saveAs(app, page, path)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem').filter({ hasText: '教学材料库' }).click()
    const library = page.getByRole('dialog', { name: '教学材料库' })
    await library.getByLabel('标题', { exact: true }).fill('分数含义基准材料')
    await library.getByLabel('来源定位', { exact: true }).fill('S3 固定工程夹具')
    await library.getByLabel('材料正文', { exact: true }).fill('分数表示把一个整体平均分成若干份，取其中的一份或几份。')
    await library.getByRole('button', { name: '保存文本材料' }).click()
    await expect(library.getByText('1 条材料', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    const waitCandidate = async () => {
      try {
        await expect.poll(async () => {
          const alert = chat.getByRole('alert')
          if (await alert.count()) throw new Error(await alert.innerText())
          return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
        }, { timeout: 245000 }).toBe(true)
      } catch (error) {
      const evidence = join(root, `output/playwright/r18-cli-${adapter}`); mkdirSync(evidence, { recursive: true })
      const records = await page.evaluate(async owner => {
        const listed = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
        return Promise.all((listed.records ?? []).map(async record => {
          const events = []; let after = 0
          for (;;) {
            const response = await window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: record.id, after })
            const batch = response.records?.[0]?.events ?? []; events.push(...batch)
            if (batch.length < 200) break
            after = batch.at(-1)!.sequence
          }
          return { ...record, events }
        }))
      }, { projectId: readProject(path).id, projectPath: path })
      writeFileSync(join(evidence, 'failure-records.json'), JSON.stringify(records, null, 2))
        throw error
      }
    }
    await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
    await chat.getByText('引用教学材料（0）', { exact: true }).click()
    await chat.getByLabel('分数含义基准材料', { exact: true }).check()
    const started = Date.now()
    await chat.getByLabel('发送给创作助手').fill('在当前空白页只添加一个可编辑 Native 文字对象，文字必须完整使用已引用“分数含义基准材料”的正文，位置 x=100 y=100，宽900高180。不需要调查文件，直接依据提供的工具输入合同返回一个候选。')
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await waitCandidate()
    expect(readProject(path).revision).toBe(0)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    await expect(chat.getByText('宿主已提交，可一次撤销', { exact: true })).toBeVisible()
    const first = await saveCurrent(page, path)
    expect(JSON.stringify(first)).toContain('分数表示把一个整体平均分成若干份')
    await chat.getByLabel('发送给创作助手').fill('继续修改本轮快照中的刚才文字对象，只把它的 label 改成“分数知识讲解”，保持文字内容与位置不变。使用 native.content 的 properties 操作。直接返回一个候选。')
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await waitCandidate()
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    const second = await saveCurrent(page, path)
    expect(JSON.stringify(second)).toContain('分数知识讲解')
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    const undone = await saveCurrent(page, path)
    expect(undone).toEqual(first)
    if (adapter === 'codex') {
      await chat.getByLabel('发送给创作助手').fill('本轮仅讨论，不修改课件，也不要产生候选：请用一句话解释为什么认识分数前要先理解平均分。')
      await chat.getByRole('button', { name: '发送', exact: true }).click()
      await expect(chat.getByText('回复完成；本轮没有可应用的修改候选。', { exact: true })).toBeVisible({ timeout: 120000 })
      await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
      expect(await saveCurrent(page, path)).toEqual(first)
    }
    const sessions = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: first.id, projectPath: path })
    expect(sessions.records?.every(record => JSON.stringify(record.generationRequest?.context).includes('分数含义基准材料'))).toBe(true)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    const textNode = effectiveItems(first).find(item => item.kind === 'native' && item.content.nativeType === 'text')!
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${textNode.layerItemId}"] .node-name`).click()
    const textInput = page.getByRole('textbox', { name: '文字内容', exact: true })
    await textInput.fill('教师复核：平均分是分数的前提。'); await textInput.press('Tab')
    expect(JSON.stringify(await saveCurrent(page, path))).toContain('教师复核：平均分是分数的前提。')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect(await saveCurrent(page, path)).toEqual(first)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(path)))
    expect(reopened.project).toEqual(first)
    const evidence = join(root, `output/playwright/r18-cli-${adapter}`); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(path))
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ adapter, elapsedMs: Date.now() - started, runs: sessions.records?.map(record => ({ status: record.status, hostResult: record.hostResult, revision: record.generationRequest?.documentRevision })) }, null, 2))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    await expect(player.getByText('分数表示把一个整体平均分成若干份，取其中的一份或几份。', { exact: true })).toBeVisible()
    await player.screenshot({ path: join(evidence, 'player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

for (const carrier of ['recipe', 'existing-component'] as const) test(`S3 真实载体：${carrier} 目录复用、人工编辑与离线重开`, async () => {
  test.setTimeout(240000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, `${carrier}.h5lesson`)
    const original = await saveAs(app, page, filename)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    await chat.getByLabel('发送给创作助手').fill(carrier === 'recipe'
      ? '请复用现成 concept-v1 概念讲解配方，在当前页之后生成一页。标题“理解平均分”，解释“平均分就是每份同样多。”，例证“把一个整体分成四份，每份同样多才叫平均分。”，视觉槽位说明“观察各份是否同样大”。这个现成结构与需要完全匹配，使用 recipe.apply 一步完成并说明选阶理由，不自行堆砌 Native。只返回候选，不读取文件。'
      : '请从当前可信组件目录复用“语文朗读标注”，插入当前场景，使用其默认内容和尺寸，位置x80 y120。需要重音、停顿和连读标记的现成语义呈现，Native与Recipe不足而目录已有该组件；说明理由。使用 component.insert operation:catalog，身份和摘要严格取自context.componentCatalog，不生成源码、不读取文件。必要时用component.configure配置位置。只返回候选。')
    const started = Date.now()
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => {
      const alert = chat.getByRole('alert')
      if (await alert.count()) throw new Error(await alert.innerText())
      return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
    }, { timeout: 150000 }).toBe(true)
    expect(await saveCurrent(page, filename)).toEqual(original)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    const generated = await saveCurrent(page, filename)
    expect(generated.revision).toBe(original.revision + 1)
    const slide = generated.surfaces.find(surface => surface.type === 'slide')!
    if (slide.type !== 'slide') throw new Error('Missing Slide')
    const item = carrier === 'recipe'
      ? slide.scenes.at(-1)!.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text' && JSON.stringify(item).includes('理解平均分'))!
      : effectiveItems(generated).find(item => item.kind === 'component')!
    expect(item).toBeDefined()
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    expect(await saveCurrent(page, filename)).toEqual(original)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(await saveCurrent(page, filename)).toEqual(generated)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    if (carrier === 'recipe') await courseTreeKind(page, 'slide-scene').last().locator('button.course-page-tree__label').first().click()
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${item.layerItemId}"] .node-name`).click()
    const input = page.getByRole('textbox', { name: carrier === 'recipe' ? '文字内容' : '标题', exact: true })
    await input.fill('教师修改后的标题'); await input.press('Tab')
    const edited = await saveCurrent(page, filename)
    expect(JSON.stringify(edited)).toContain('教师修改后的标题')
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const evidence = join(root, `output/playwright/r18-${carrier}`); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(filename))
    const sessions = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: generated.id, projectPath: filename })
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ adapter: 'codex', carrier, elapsedMs: Date.now() - started, runs: sessions.records?.map(record => ({ status: record.status, hostResult: record.hostResult })) }, null, 2))
    const components = Object.fromEntries(Object.entries(reopened.componentFiles).map(([id, files]) => [id, parseComponentPackageFiles(files)]))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    if (carrier === 'recipe') for (const name of ['展开教师控制器', '下一场景']) {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(player.getByText('教师修改后的标题', { exact: true })).toBeVisible()
    await player.screenshot({ path: join(evidence, 'player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally { await browser?.close(); if (launch) await closeEditor(launch.app, launch.runRoot); await server.close() }
})

test('S3 真实整课：Codex 从确认文档生成、重开与离线逐页运行', async () => {
  test.setTimeout(240000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'whole-course.h5lesson')
    const original = await saveAs(app, page, filename)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    await chat.getByText('从已确认文档生成整课', { exact: true }).click()
    await chat.getByLabel('生成包含多个片段的完整课件').check()
    // These are a fixed engineering fixture, not a teacher acceptance signature.
    await chat.getByLabel('教学策划 Markdown').fill('# 平均分与分数\n目标：理解平均分是分数的前提，认识二分之一。\n路径：先比较平均分与不平均分；再用一个整体的两等份解释分母和分子；最后判断迁移例并解释理由。')
    await chat.getByLabel('已审阅并确认当前教学策划').check()
    await chat.getByLabel('呈现脚本 Markdown').fill('# 三个演示片段\n1. 使用现有空白演示页。标题“认识平均分”，正文“平均分就是每份同样多。把一个整体分成两份，只有两份同样多时才是平均分。”\n2. 新建演示页。标题“认识二分之一”，正文“把一个整体平均分成两份，每份是这个整体的二分之一。分母2表示平均分成两份，分子1表示取其中一份。”\n3. 新建演示页。标题“判断与解释”，正文“一个圆被分成大小不同的两块，每块能叫二分之一吗？不能，因为没有平均分。”\n每页标题 x80 y60 宽1120高80，正文 x80 y200 宽1120高300。全部使用可编辑 Native 文字，黑字白底，字号至少32。每页只有标题与正文，采用默认教师控制器翻页。')
    await chat.getByLabel('已审阅并确认当前呈现脚本').check()
    await chat.getByLabel('发送给创作助手').fill('按照已确认的两份文档生成完整三页课件。保留现有第一页并写入内容，另建两页；严格遵循三页顺序。使用正式 slide.structure 创建页和 created-scope 引用新页。只输出一个候选，不调查文件。')
    const started = Date.now()
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => {
      const alert = chat.getByRole('alert')
      if (await alert.count()) throw new Error(await alert.innerText())
      return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
    }, { timeout: 150000 }).toBe(true)
    expect(await saveCurrent(page, filename)).toEqual(original)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    const generated = await saveCurrent(page, filename)
    expect(generated.revision).toBe(original.revision + 1)
    expect(generated.locations).toHaveLength(3)
    const titles = ['认识平均分', '认识二分之一', '判断与解释']
    const slide = generated.surfaces.find(surface => surface.type === 'slide')!
    if (slide.type !== 'slide') throw new Error('Missing Slide surface')
    expect(slide.scenes.flatMap(scene => scene.layerItems).every(item => item.kind === 'native')).toBe(true)
    const sceneText = slide.scenes.map(scene => JSON.stringify(scene.layerItems))
    for (const [index, title] of titles.entries()) expect(sceneText[index]).toContain(title)
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    expect(await saveCurrent(page, filename)).toEqual(original)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(await saveCurrent(page, filename)).toEqual(generated)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(generated)
    const evidence = join(root, 'output/playwright/r18-whole-course'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(filename))
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ adapter: 'codex', elapsedMs: Date.now() - started, locations: generated.locations, revision: generated.revision }, null, 2))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    const clickControl = async (name: string) => {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await clickControl('展开教师控制器')
    for (const [index, title] of titles.entries()) {
      await expect(player.getByText(title, { exact: true })).toBeVisible()
      await player.screenshot({ path: join(evidence, `page-${index + 1}.png`) })
      if (index < 2) await clickControl('下一场景')
    }
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 真实生成组件：Codex 候选、教师改属性、保存重开与连续互动', async () => {
  test.setTimeout(360000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'generated-component.h5lesson')
    await saveAs(app, page, filename)
    const fallbackPath = join(runRoot, 'fraction-fallback.png')
    writeFileSync(fallbackPath, Buffer.from(await fractionFallback(page), 'base64'))
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: fallbackPath })
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    await page.getByRole('tab', { name: '媒体', exact: true }).click()
    await page.getByRole('button', { name: '导入图片', exact: true }).click()
    await expect(page.getByText('fraction-fallback.png', { exact: true }).first()).toBeVisible()
    const original = await saveCurrent(page, filename)
    const fallbackAsset = Object.values(original.assets).find(asset => asset.filename === 'fraction-fallback.png')!
    expect(fallbackAsset.kind).toBe('image')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    await chat.getByLabel('发送给创作助手').fill(fractionComponentInstruction(fallbackAsset.id))
    const started = Date.now()
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => {
      const alert = chat.getByRole('alert')
      if (await alert.count()) throw new Error(await alert.innerText())
      return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
    }, { timeout: 270000 }).toBe(true)
    expect(await saveCurrent(page, filename)).toEqual(original)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    const generated = await saveCurrent(page, filename)
    expect(generated.revision).toBe(original.revision + 1)
    const component = effectiveItems(generated).find(item => item.kind === 'component')!
    expect(component?.kind).toBe('component')
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    expect(await saveCurrent(page, filename)).toEqual(original)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(await saveCurrent(page, filename)).toEqual(generated)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${component.layerItemId}"] .node-name`).click()
    const title = page.getByRole('textbox', { name: '探索标题', exact: true })
    await expect(title).toHaveValue('平均分探索')
    await title.fill('平均分实验'); await title.press('Tab')
    const edited = await saveCurrent(page, filename)
    expect(JSON.stringify(edited)).toContain('平均分实验')
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const components = Object.fromEntries(Object.entries(reopened.componentFiles).map(([id, files]) => [id, parseComponentPackageFiles(files)]))
    const evidence = join(root, 'output/playwright/r18-generated-component'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(filename))
    const sessions = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: generated.id, projectPath: filename })
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ adapter: 'codex', elapsedMs: Date.now() - started, runs: sessions.records?.map(record => ({ status: record.status, hostResult: record.hostResult })) }, null, 2))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    const errors: string[] = []; player.on('pageerror', error => errors.push(String(error)))
    await player.goto(pathToFileURL(htmlPath).href)
    await exerciseFractionComponent(player, join(evidence, 'interaction.png'))
    expect(errors).toEqual([])
    expect(launch.pageErrors).toEqual([])
  } catch (error) {
    if (launch) {
      const filename = join(launch.runRoot, 'generated-component.h5lesson')
      if (existsSync(filename)) {
        const project = readProject(filename)
        const records = await launch.page.evaluate(async owner => {
          const list = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
          return Promise.all((list.records ?? []).map(async record => (await window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: record.id, after: 0 })).records?.[0]))
        }, { projectId: project.id, projectPath: filename }).catch(() => [])
        const evidence = join(root, 'output/playwright/r18-generated-component'); mkdirSync(evidence, { recursive: true })
        writeFileSync(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), projectRevision: project.revision, records }, null, 2))
      }
    }
    throw error
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 真实生成Runtime：连续动画、文案编辑、历史与离线互动', async () => {
  test.setTimeout(360000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'generated-runtime.h5lesson')
    await saveAs(app, page, filename)
    const fallbackPath = join(runRoot, 'oscillation-fallback.png')
    writeFileSync(fallbackPath, Buffer.from(await oscillationFallback(page), 'base64'))
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: fallbackPath })
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    await page.getByRole('tab', { name: '媒体', exact: true }).click()
    await page.getByRole('button', { name: '导入图片', exact: true }).click()
    await expect(page.getByText('oscillation-fallback.png', { exact: true }).first()).toBeVisible()
    const original = await saveCurrent(page, filename)
    const fallbackAsset = Object.values(original.assets).find(asset => asset.filename === 'oscillation-fallback.png')!
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    await chat.getByLabel('发送给创作助手').fill(oscillationRuntimeInstruction(fallbackAsset.id))
    const started = Date.now()
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => {
      const alert = chat.getByRole('alert')
      if (await alert.count()) throw new Error(await alert.innerText())
      return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
    }, { timeout: 270000 }).toBe(true)
    expect(await saveCurrent(page, filename)).toEqual(original)
    await chat.getByRole('button', { name: '应用候选', exact: true }).click()
    const generated = await saveCurrent(page, filename)
    expect(generated.revision).toBe(original.revision + 1)
    const runtime = effectiveItems(generated).find(item => item.kind === 'runtime')!
    expect(runtime?.kind).toBe('runtime')
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    expect(await saveCurrent(page, filename)).toEqual(original)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect(await saveCurrent(page, filename)).toEqual(generated)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${runtime.layerItemId}"] .node-name`).click()
    const titleTarget = page.getByRole('button', { name: '动画标题，双击编辑文字', exact: true })
    await expect(titleTarget).toBeVisible()
    const titleBounds = await titleTarget.boundingBox()
    if (!titleBounds) throw new Error('Runtime 标题没有实际编辑位置')
    // The canvas owns pointer hit testing; the semantic target is keyboard-only.
    await page.mouse.dblclick(titleBounds.x + titleBounds.width / 2, titleBounds.y + titleBounds.height / 2)
    const title = page.getByTestId('canvas-plain-text-editor').getByRole('textbox', { name: '动画标题', exact: true })
    await expect(title).toHaveValue('振动探索')
    await title.fill('振幅实验'); await title.press('Enter')
    const edited = await saveCurrent(page, filename)
    expect(JSON.stringify(edited)).toContain('振幅实验')
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const evidence = join(root, 'output/playwright/r18-generated-runtime'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(filename))
    const sessions = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), { projectId: generated.id, projectPath: filename })
    writeFileSync(join(evidence, 'result.json'), JSON.stringify({ adapter: 'codex', elapsedMs: Date.now() - started, runs: sessions.records?.map(record => ({ status: record.status, hostResult: record.hostResult })) }, null, 2))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    const errors: string[] = []; player.on('pageerror', error => errors.push(String(error)))
    await player.goto(pathToFileURL(htmlPath).href)
    await exerciseOscillationRuntime(player, join(evidence, 'interaction.png'))
    expect(errors).toEqual([])
    expect(launch.pageErrors).toEqual([])
  } catch (error) {
    if (launch) {
      const filename = join(launch.runRoot, 'generated-runtime.h5lesson')
      if (existsSync(filename)) {
        const project = readProject(filename)
        const records = await launch.page.evaluate(async owner => {
          const list = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
          return Promise.all((list.records ?? []).map(async record => (await window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: record.id, after: 0 })).records?.[0]))
        }, { projectId: project.id, projectPath: filename }).catch(() => [])
        const evidence = join(root, 'output/playwright/r18-generated-runtime'); mkdirSync(evidence, { recursive: true })
        writeFileSync(join(evidence, 'failure.json'), JSON.stringify({ error: String(error), projectRevision: project.revision, records }, null, 2))
        writeFileSync(join(evidence, 'failed-project.h5lesson'), readFileSync(filename))
      }
    }
    throw error
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S2 动态工具：真实宿主拒绝坏源码且工程与资源零写入', async () => {
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`)
    const result = await runDynamicAdmissionProbe(page)
    expect(result.good.status).toBe('committed')
    expect(result.componentGood.status).toBe('committed')
    expect(result.bad.status).toBe('failed')
    expect(result.componentBad.status).toBe('failed')
    expect(result.missing.status).toBe('failed')
    expect(result.timeout.status).toBe('failed')
    expect(result.stale.status).toBe('stale')
    expect(result.missing.diagnostics[0].path).toContain('source')
    expect(result.disabled.status).toBe('committed')
    expect(result.configured.status).toBe('committed')
    expect(result.conflict.status).toBe('failed')
    expect(result.componentConfigured.status, JSON.stringify(result.componentConfigured.diagnostics)).toBe('committed')
    expect(result.runtimeEnabled).toBe(false)
    expect(result.runtimeCaption).toBe('after')
    expect(result.componentVisible).toBe(false)
    expect(result.componentBaseProps).toEqual({})
    expect(result.componentStateProps).toEqual({ caption: 'state only' })
    expect(result.stateOnlyFailure.status).toBe('failed')
    expect(result.stateOnlyFailure.after).toBe(result.stateOnlyFailure.before)
    for (const inserted of result.insertedRuntimes) {
      expect(inserted.status, JSON.stringify(inserted)).toBe(inserted.surfaceType === 'spatial-2d' ? 'failed' : 'committed')
      if (inserted.surfaceType === 'spatial-2d') expect(inserted.after).toBe(inserted.before)
    }
    for (const inserted of result.insertedComponents) expect(inserted.status, JSON.stringify(inserted)).toBe('committed')
    expect(result.captureFailures).toHaveLength(17)
    for (const failure of result.captureFailures) {
      expect(failure.status, JSON.stringify(failure)).toBe('failed')
      expect(failure.after).toBe(failure.before)
      expect(failure.projectUnchanged).toBe(true)
      expect(failure.resourcesUnchanged).toBe(true)
      expect(failure.diagnostics.some((entry: { code: string }) => entry.code === 'dynamic-host-failed')).toBe(true)
    }
    expect(result.distantComponentPreserved).toBe(true)
    expect(result.commits).toBe(5)
    expect(result.packageVersion).toBe('1.0.1')
    expect(result.leakedRoots).toBe(0)
  } finally {
    await browser.close()
    await server.close()
  }
})

test('S2 回归：删除初始场景与页面，并导入可编辑线条', async () => {
  test.setTimeout(180_000)
  const { app, page, runRoot, pageErrors } = await launchEditor()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const filename = join(runRoot, 'initial-delete-lines.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const initial = readProject(filename)
    await page.getByTestId('add-content-primary').click()
    const beforeDelete = await saveCurrent(page, filename)
    await page.locator('[data-kind="slide-scene"]').first().getByRole('button', { name: /^删除“/ }).click()
    await page.getByRole('button', { name: '删除场景', exact: true }).click()
    const removedScene = await saveCurrent(page, filename)
    expect(removedScene.locations).toHaveLength(1)
    expect(removedScene.startLocationId).not.toBe(initial.startLocationId)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveCurrent(page, filename)).locations).toEqual(beforeDelete.locations)

    const { default: PptxGenJS } = await import('pptxgenjs')
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'
    const slide = pptx.addSlide()
    slide.addShape(pptx.ShapeType.line, { x: 1, y: 1, w: 8, h: 0, line: { color: '2563EB', width: 4, endArrowType: 'triangle' } })
    slide.addShape(pptx.ShapeType.line, { x: 1, y: 2, w: 0, h: 3, line: { color: '16A34A', width: 4 } })
    slide.addShape(pptx.ShapeType.line, { x: 3, y: 2, w: 5, h: 3, flipH: true, line: { color: 'DC2626', width: 4, endArrowType: 'stealth' } })
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'lines.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await pptx.write({ outputType: 'uint8array' }) as Uint8Array) })
    await expect(page.getByRole('button', { name: '确认导入可用内容' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'PPTX 导入提示' })).toHaveCount(0)
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    await page.locator('[data-kind="slide-page"]').first().getByRole('button', { name: /^删除页面/ }).click()
    await page.getByRole('button', { name: '删除页面', exact: true }).click()
    const removedPage = await saveCurrent(page, filename)
    expect(removedPage.surfaces).toHaveLength(1)
    expect(removedPage.startLocationId).toBe(removedPage.locations[0]!.id)
    expect(removedPage.surfaces[0]!.id).not.toBe(initial.surfaces[0]!.id)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveCurrent(page, filename)).surfaces).toEqual(imported.surfaces)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect(page.locator('[data-kind="slide-page"]')).toHaveCount(1)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    const surface = archive.project.surfaces[0]!
    expect(surface.type === 'slide' && surface.scenes[0]!.layerItems.every(item => item.kind === 'native' && item.content.nativeType === 'shape' && item.content.data.lineGeometry)).toBeTruthy()
    const html = buildPublishedCourseStandaloneHtml({ project: archive.project, assetFiles: {}, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(runRoot, 'lines.html'); writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    await expect(player.locator('[data-native-type="shape"]')).toHaveCount(3)
    const painted = await player.locator('[data-native-type="shape"] canvas').evaluateAll(elements => elements.map(element => {
      const canvas = element as HTMLCanvasElement
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]! > 20) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
      return { width: maxX - minX + 1, height: maxY - minY + 1, clipped: minX <= 0 || minY <= 0 || maxX >= canvas.width - 1 || maxY >= canvas.height - 1 }
    }))
    writeFileSync(join(root, 'output/r15-lines-render-check.json'), JSON.stringify({ painted, surface }, null, 2))
    await player.screenshot({ path: 'output/playwright/r13-review/r15-imported-lines-player.png' })
    expect(painted).toHaveLength(3)
    expect(painted[0]!.height).toBeGreaterThan(15) // Blue arrow head survives, rather than a one-pixel horizontal stroke.
    expect(painted[1]!.width).toBeGreaterThan(4)
    expect(painted.every(shape => !shape.clipped)).toBe(true)
    expect(pageErrors).toEqual([])
  } finally { await browser?.close(); await closeEditor(app, runRoot) }
})

test('S3 PPTX 自由路径：渐变连续编辑、历史、保存重开和离线 Player', async () => {
  test.setTimeout(120000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'paths.h5lesson')
    await saveAs(app, page, filename)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'paths.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(pptxEditablePathsFixture(true)) })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    const surface = imported.surfaces.at(-1)!
    if (surface.type !== 'slide') throw new Error('Missing imported surface')
    const item = surface.scenes[0].layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'shape')!
    const shapeId = item.layerItemId
    const painted = page.getByTestId('published-authoring-host').locator(`[data-slide-layer-item="${shapeId}"] svg`)
    await expect(painted.locator('path')).toHaveCount(1)
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${shapeId}"] .node-name`).click()
    const color = page.locator('#shape-gradient-0-text')
    await color.fill('#00ff00')
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#00ff00')
    await color.fill('#ff0000'); await color.press('Enter')
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#ff0000')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#2563eb')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#ff0000')
    await page.getByLabel('图形类型', { exact: true }).selectOption('ellipse')
    await expect(painted).toHaveCount(0)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#ff0000')
    const brace = surface.scenes[0].layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'shape' && item.content.data.braceGeometry)!
    const bracePath = page.getByTestId('published-authoring-host').locator(`[data-slide-layer-item="${brace.layerItemId}"] path`)
    const originalBrace = await bracePath.getAttribute('d')
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${brace.layerItemId}"] .node-name`).click()
    await page.getByRole('spinbutton', { name: '括号曲率', exact: true }).fill('0.4')
    await page.getByRole('spinbutton', { name: '括号曲率', exact: true }).press('Enter')
    await expect(bracePath).not.toHaveAttribute('d', originalBrace!)
    const changedBrace = await bracePath.getAttribute('d')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(bracePath).toHaveAttribute('d', originalBrace!)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(bracePath).toHaveAttribute('d', changedBrace!)
    const edited = await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await courseTreeKind(page, 'slide-scene').nth(1).locator('button.course-page-tree__label').first().click()
    await expect(painted.locator('stop').first()).toHaveAttribute('stop-color', '#ff0000')
    await expect(bracePath).toHaveAttribute('d', changedBrace!)
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const sources = { project: reopened.project, assetFiles: reopened.assetFiles, components: {} }
    const exported = await page.evaluate(async sources => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { buildCoursePptx } = await load('/src/renderer/export/course/buildCoursePptx.ts')
      const { parsePptxImport } = await load('/src/renderer/project/pptxImport.ts')
      const result = await buildCoursePptx(sources)
      const draft = await parsePptxImport(result.bytes)
      const shape = draft.slides.flatMap((slide: any) => slide.items).find((item: any) => item.content?.data.pathGeometry)
      return { bytes: Array.from(result.bytes) as number[], shape: shape?.content.data }
    }, sources)
    expect(exported.shape.pathGeometry).toEqual(item.kind === 'native' && item.content.nativeType === 'shape' ? item.content.data.pathGeometry : undefined)
    expect(exported.shape.style.fillGradient.stops[0].color).toBe('#ff0000')
    const evidence = join(root, 'output/playwright/r17-paths'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'edited.pptx'), new Uint8Array(exported.bytes))
    const htmlPath = join(evidence, 'edited.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml(sources, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    for (const name of ['展开教师控制器', '下一场景']) {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(player.locator(`[data-slide-layer-item="${shapeId}"] svg stop`).first()).toHaveAttribute('stop-color', '#ff0000')
    await expect(player.locator(`[data-slide-layer-item="${brace.layerItemId}"] svg path`)).toHaveAttribute('d', changedBrace!)
    await player.screenshot({ path: join(evidence, 'edited-player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 PPTX 图表：横向切换、真实数据编辑、历史、重开及离线 Player 与可编辑导出', async () => {
  test.setTimeout(120000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'charts.h5lesson')
    await saveAs(app, page, filename)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'charts.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await pptxEditableChartsFixture()) })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    const surface = imported.surfaces.at(-1)!
    if (surface.type !== 'slide') throw new Error('Missing imported surface')
    const chartId = surface.scenes[0].layerItems[0].layerItemId
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${chartId}"] .node-name`).click()
    const value = page.getByRole('textbox', { name: '人数 在 乙班 的值', exact: true })
    const direction = page.getByLabel('条形方向', { exact: true })
    await direction.selectOption('horizontal')
    const chartSvg = page.getByTestId('published-authoring-host').locator(`[data-slide-layer-item="${chartId}"] svg desc`)
    await expect(chartSvg).toContainText('横向条形图')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(direction).toHaveValue('vertical')
    await expect(chartSvg).toContainText('柱状图')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(direction).toHaveValue('horizontal')
    await expect(chartSvg).toContainText('横向条形图')
    await value.fill('36')
    await page.getByRole('button', { name: '应用数据', exact: true }).click()
    const edited = await saveCurrent(page, filename)
    expect(JSON.stringify(effectiveItems(edited).find(item => item.layerItemId === chartId))).toContain('36')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(value).toHaveValue('18')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(value).toHaveValue('36')
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const sources = { project: reopened.project, assetFiles: reopened.assetFiles, components: {} }
    const exported = await buildCoursePptx(sources)
    expect(exported.bytes.length).toBeGreaterThan(1000)
    const evidence = join(root, 'output/playwright/r17-charts'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'edited.pptx'), exported.bytes)
    const exportedValues = await page.evaluate(async bytes => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { parsePptxImport } = await load('/src/renderer/project/pptxImport.ts')
      const draft = await parsePptxImport(new Uint8Array(bytes))
      return draft.slides.flatMap((slide: any) => slide.items).filter((item: any) => item.content?.nativeType === 'chart').map((item: any) => ({ direction: item.content.data.style.barDirection, values: item.content.data.series[0].points.map((point: any) => point.value) }))
    }, Array.from(exported.bytes))
    expect(exportedValues[0]).toEqual({ direction: 'horizontal', values: [12, 36, 24] })
    const htmlPath = join(evidence, 'edited.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml(sources, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    for (const name of ['展开教师控制器', '下一场景']) {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(player.locator(`[data-slide-layer-item="${chartId}"] svg desc`)).toContainText('36')
    await expect(player.locator(`[data-slide-layer-item="${chartId}"] svg desc`)).toContainText('横向条形图')
    const bars = await player.locator(`[data-slide-layer-item="${chartId}"] svg svg rect`).evaluateAll(elements => elements.map(element => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')), width: Number(element.getAttribute('width')) })))
    expect(bars).toHaveLength(3)
    expect(bars[0]!.x).toBe(bars[1]!.x)
    expect(bars[0]!.y).toBeLessThan(bars[1]!.y)
    expect(bars[1]!.width / bars[0]!.width).toBeCloseTo(3)
    await player.screenshot({ path: join(evidence, 'edited-player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 PPTX SmartArt：文字与位置编辑、历史、重开和导出', async () => {
  test.setTimeout(120000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'diagram.h5lesson')
    await saveAs(app, page, filename)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'diagram.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(pptxDiagramFixture()) })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    const node = effectiveItems(imported).find(item => item.kind === 'native' && item.content.nativeType === 'text' && item.content.data.text === '观察')!
    const nodeId = node.layerItemId
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${nodeId}"] .node-name`).click()
    const input = page.getByRole('textbox', { name: '文字内容', exact: true })
    await input.fill('比较'); await input.press('Tab')
    const painted = page.getByTestId('published-authoring-host').locator(`[data-slide-layer-item="${nodeId}"]`)
    await expect(painted).toContainText('比较')
    const x = page.getByRole('spinbutton', { name: 'X', exact: true })
    await x.fill('500'); await x.press('Enter')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(x).toHaveValue(String(Number(node.frame.x.toFixed(1))))
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(x).toHaveValue('500')
    const edited = await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await courseTreeKind(page, 'slide-scene').nth(1).locator('button.course-page-tree__label').first().click()
    await expect(painted).toContainText('比较')
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const sources = { project: reopened.project, assetFiles: reopened.assetFiles, components: {} }
    const exported = await page.evaluate(async sources => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { buildCoursePptx } = await load('/src/renderer/export/course/buildCoursePptx.ts')
      const { parsePptxImport } = await load('/src/renderer/project/pptxImport.ts')
      const result = await buildCoursePptx(sources)
      const draft = await parsePptxImport(result.bytes)
      const item = draft.slides.flatMap((slide: any) => slide.items).find((item: any) => item.content?.data.text === '比较')
      return { bytes: Array.from(result.bytes) as number[], item }
    }, sources)
    expect(exported.item.frame.x).toBeCloseTo(500, 1)
    const evidence = join(root, 'output/playwright/r18-diagrams'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'edited.h5lesson'), readFileSync(filename))
    writeFileSync(join(evidence, 'edited.pptx'), new Uint8Array(exported.bytes))
    const htmlPath = join(evidence, 'edited.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml(sources, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    for (const name of ['展开教师控制器', '下一场景']) {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(player.locator(`[data-slide-layer-item="${nodeId}"]`)).toContainText('比较')
    await player.screenshot({ path: join(evidence, 'edited-player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S3 PPTX 旧公式：可编辑 AST、历史、保存重开及离线 Player 与导出', async () => {
  test.setTimeout(120000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const filename = join(runRoot, 'equations.h5lesson')
    await saveAs(app, page, filename)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'equations.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(pptxEquationFixture()) })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    const formula = effectiveItems(imported).find(item => item.kind === 'native' && item.content.nativeType === 'formula')!
    const formulaId = formula.layerItemId
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${formulaId}"] .node-name`).click()
    const input = page.getByRole('textbox', { name: '公式内容（线性输入）', exact: true })
    await expect(input).toHaveValue('\\frac{1}{2}')
    await input.fill('\\frac{1}{3}')
    await page.getByRole('button', { name: '应用公式', exact: true }).click()
    const painted = page.getByTestId('published-authoring-host').locator(`[data-slide-layer-item="${formulaId}"][role="math"]`)
    await expect(painted).toHaveAttribute('aria-label', '三分之一')
    await expect(painted.locator('canvas')).toHaveCount(1)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(input).toHaveValue('\\frac{1}{2}')
    await expect(painted).toHaveAttribute('aria-label', '二分之一')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(input).toHaveValue('\\frac{1}{3}')
    const edited = await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await courseTreeKind(page, 'slide-scene').nth(1).locator('button.course-page-tree__label').first().click()
    await expect(painted).toHaveAttribute('aria-label', '三分之一')
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const sources = { project: reopened.project, assetFiles: reopened.assetFiles, components: {} }
    const exported = await page.evaluate(async sources => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { buildCoursePptx } = await load('/src/renderer/export/course/buildCoursePptx.ts')
      const result = await buildCoursePptx(sources)
      return Array.from(result.bytes) as number[]
    }, sources)
    expect(exported.length).toBeGreaterThan(1000)
    const evidence = join(root, 'output/playwright/r18-equations'); mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, 'edited.h5lesson'), readFileSync(filename))
    writeFileSync(join(evidence, 'edited.pptx'), new Uint8Array(exported))
    const htmlPath = join(evidence, 'edited.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml(sources, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    for (const name of ['展开教师控制器', '下一场景']) {
      const control = player.getByRole('button', { name, exact: true }); await expect(control).toBeVisible()
      const box = await control.boundingBox(); if (!box) throw new Error('Missing teacher control')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    const output = player.locator(`[data-slide-layer-item="${formulaId}"][role="math"]`)
    await expect(output).toHaveAttribute('aria-label', '三分之一')
    const pixels = await output.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50 && data[i + 3] > 200) red++
      return red
    })
    expect(pixels).toBeGreaterThan(30)
    await player.screenshot({ path: join(evidence, 'edited-player.png') })
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})

test('S2 PPTX 普通映射收尾：逐页画布、小尺寸增量同步、历史与重开', async () => {
  test.setTimeout(process.env.COURSEWARE_S2_PPTX ? 600_000 : 180_000)
  const { app, page, runRoot, pageErrors } = await launchEditor()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const evidence = join(root, 'output/playwright/r15-common-closure')
  mkdirSync(evidence, { recursive: true })
  try {
    const filename = join(runRoot, 'common.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const baseline = readProject(filename)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    const input = process.env.COURSEWARE_S2_PPTX
    await page.getByLabel('选择 PPTX').setInputFiles({ name: '普通映射.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: input ? readFileSync(input) : Buffer.from(pptxCommonMappingFixture()) })
    await expect(page.getByRole('button', { name: '确认导入可用内容' })).toBeEnabled()
    await page.screenshot({ path: join(evidence, 'preview.png') })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    const surface = imported.surfaces.at(-1)!
    if (surface.type !== 'slide') throw new Error('imported Slide missing')
    expect(surface.scenes).toHaveLength(input ? 29 : 1)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveCurrent(page, filename)).surfaces).toEqual(baseline.surfaces)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    const host = page.getByTestId('published-authoring-host')
    const ready = async () => {
      await expect(host.locator('[data-slide-layer-item]').first()).toBeAttached()
      await expect(page.locator('.runtime-preview-loading')).toHaveCount(0)
    }
    for (const [index, scene] of surface.scenes.entries()) {
      await courseTreeKind(page, 'slide-scene').nth(index + 1).locator('button.course-page-tree__label').first().click()
      await expect(host.locator(`[data-slide-layer-item="${scene.layerItems[0]!.layerItemId}"]`)).toBeAttached()
      await ready()
      if (input && index === 12) {
        for (const label of ['文本框 2 文字', '文本框 3 文字', '文本框 4 文字']) {
          const item = scene.layerItems.find(i => i.label === label)!
          const clipped = await host.locator(`[data-slide-layer-item="${item.layerItemId}"]`).evaluate(wrap => {
            const frame = wrap.getBoundingClientRect()
            return [...wrap.querySelectorAll('span')].some(span => {
              const range = document.createRange(); range.selectNodeContents(span)
              return [...range.getClientRects()].some(rect => rect.right > frame.right + 2 || rect.bottom > frame.bottom + 2)
            })
          })
          expect(clipped, `${label} must paint its complete question`).toBe(false)
        }
      }
      await page.screenshot({ path: join(evidence, `editor-page-${index + 1}.png`) })
    }
    const smallSceneIndex = surface.scenes.findIndex(s => s.layerItems.some(i => i.frame.width < 16 || i.frame.height < 16))
    expect(smallSceneIndex).toBeGreaterThanOrEqual(0)
    const small = surface.scenes[smallSceneIndex]!.layerItems.find(i => i.frame.width < 16 || i.frame.height < 16)!
    await courseTreeKind(page, 'slide-scene').nth(smallSceneIndex + 1).locator('button.course-page-tree__label').first().click()
    await ready()
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${small.layerItemId}"] .node-name`).click()
    const movedX = Math.round(small.frame.x) + 12
    await page.getByLabel('X', { exact: true }).fill(String(movedX))
    await page.getByLabel('X', { exact: true }).press('Enter')
    const painted = host.locator(`[data-slide-layer-item="${small.layerItemId}"]`)
    await expect(painted).toHaveCSS('left', `${movedX}px`)
    await ready()
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect.poll(() => painted.evaluate(el => parseFloat((el as HTMLElement).style.left))).toBeCloseTo(small.frame.x, 2)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(painted).toHaveCSS('left', `${movedX}px`)
    const groupSceneIndex = input ? 23 : 0
    const groupedText = surface.scenes[groupSceneIndex]!.layerItems.find(i => i.kind === 'native' && i.content.nativeType === 'text' && i.content.data.text === (input ? 'A盘' : '树状图'))!
    expect(groupedText).toBeTruthy()
    await courseTreeKind(page, 'slide-scene').nth(groupSceneIndex + 1).locator('button.course-page-tree__label').first().click()
    await ready()
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator(`[data-testid^="node-item-"][data-testid$="${groupedText.layerItemId}"] .node-name`).click()
    const textField = page.getByRole('textbox', { name: '文字内容', exact: true })
    await textField.fill('A组')
    await textField.press('Tab')
    await expect(host.locator(`[data-slide-layer-item="${groupedText.layerItemId}"]`)).toContainText('A组')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(textField).toHaveValue(input ? 'A盘' : '树状图')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(textField).toHaveValue('A组')
    const edited = await saveCurrent(page, filename)
    const savedSmall = effectiveItems(edited).find(i => i.layerItemId === small.layerItemId)!
    expect(savedSmall.frame).toEqual({ ...small.frame, x: movedX })
    expect(effectiveItems(edited).find(i => i.layerItemId === groupedText.layerItemId)).toMatchObject({ content: { data: { text: 'A组' } } })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await courseTreeKind(page, 'slide-scene').nth(smallSceneIndex + 1).locator('button.course-page-tree__label').first().click()
    await ready()
    await expect(painted).toHaveCSS('left', `${movedX}px`)
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    writeFileSync(join(evidence, 'edited.h5lesson'), readFileSync(filename))
    const html = buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(evidence, 'edited.html'); writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    for (const [index, scene] of surface.scenes.entries()) {
      const expand = player.getByRole('button', { name: '展开教师控制器', exact: true })
      if (await expand.isVisible()) {
        const box = await expand.boundingBox()
        if (!box) throw new Error('controller missing')
        await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      }
      const next = player.getByRole('button', { name: '下一场景', exact: true })
      await expect(next).toBeVisible()
      const box = await next.boundingBox()
      if (!box) throw new Error('next control missing')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(player.locator(`[data-slide-layer-item="${scene.layerItems[0]!.layerItemId}"]`)).toBeAttached()
      await player.screenshot({ path: join(evidence, `player-page-${index + 1}.png`) })
    }
    expect(pageErrors).toEqual([])
  } finally { await browser?.close(); await closeEditor(app, runRoot) }
})

test('S2 PPTX 原生收口：母版继承、共享编辑、表格编辑与离线往返', async () => {
  test.setTimeout(180_000)
  const { app, page, runRoot, pageErrors, externalRequests } = await launchEditor()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const filename = join(runRoot, 'pptx-native.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const baseline = readProject(filename)
    await page.context().setOffline(true)
    await page.getByLabel('创作工具', { exact: true }).click()
    await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
    await page.getByLabel('生产力操作').selectOption('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: '母版与表格.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await pptxInheritanceFixture()) })
    await expect(page.getByRole('heading', { name: '母版与表格：4 页，0 个素材' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '设计生产力' })).toContainText('2 个共享对象')
    await expect(page.getByRole('dialog', { name: '设计生产力' })).toContainText('0 个共享对象')
    await page.screenshot({ path: 'output/playwright/r13-review/r15-native-import-preview.png' })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    const imported = await saveCurrent(page, filename)
    expect(imported.locations).toHaveLength(baseline.locations.length + 4)
    const importedSurface = imported.surfaces.at(-1)!
    if (importedSurface.type !== 'slide') throw new Error('Slide missing')
    expect(importedSurface.surfaceLayerItems).toHaveLength(4)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveCurrent(page, filename)).surfaces).toEqual(baseline.surfaces)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await courseTreeKind(page, 'slide-scene').nth(1).locator('button.course-page-tree__label').first().click()
    const selectLayer = async (name: string) => {
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-item').filter({ has: page.getByText(name, { exact: true }) }).locator('.node-name').click()
      await expect(page.getByLabel('名称', { exact: true })).toHaveValue(name)
    }
    await selectLayer('装饰A')
    await page.getByLabel('X', { exact: true }).fill('64')
    await page.getByLabel('X', { exact: true }).press('Enter')
    await selectLayer('Table 0')
    const cell = page.getByRole('textbox', { name: /^单元格 / }).nth(3)
    await cell.fill('平均分成两份，表示其中一份')
    await cell.press('Shift+Tab')
    await page.getByText('合并与拆分单元格', { exact: true }).click()
    await page.getByRole('button', { name: '合并所选区域', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^单元格 / })).toHaveCount(3)
    await page.getByRole('button', { name: /拆分第 1 行、第 1 列/ }).click()
    await expect(page.getByRole('textbox', { name: /^单元格 / })).toHaveCount(4)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^单元格 / })).toHaveCount(3)
    await page.getByRole('tab', { name: '图层' }).click()
    const titleId = importedSurface.scenes[0]!.layerItems[0]!.layerItemId
    await page.locator(`[data-testid^="node-item-"][data-testid$="${titleId}"] .node-name`).click()
    await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue('第1页标题')
    await page.getByRole('textbox', { name: '文字内容' }).fill('第一课：认识分数')
    await page.getByRole('textbox', { name: '文字内容' }).press('Tab')
    const edited = await saveCurrent(page, filename)
    const surface = edited.surfaces.at(-1)!
    if (surface.type !== 'slide') throw new Error('Slide missing')
    const shared = surface.surfaceLayerItems.find(e => e.item.label === '装饰A')!
    expect(shared.item.frame.x).toBe(64)
    expect(shared.visibility.locationIds).toHaveLength(2)
    expect(surface.scenes[1]!.layerItems[0]).toMatchObject({ content: { data: { text: '第2页标题' } } })
    expect(surface.scenes[2]!.layerItems[0]).toMatchObject({ content: { data: { text: '第3页标题' } } })
    const table = surface.scenes[0]!.layerItems.find(i => i.kind === 'native' && i.content.nativeType === 'table')!
    expect(table).toMatchObject({ content: { data: { rows: [{}, { cells: [{}, { text: '平均分成两份，表示其中一份' }] }] } } })
    expect(table).toMatchObject({ content: { data: { merges: [{ rowIds: [expect.any(String)], columnIds: [expect.any(String), expect.any(String)] }] } } })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await expect(courseTreeKind(page, 'slide-scene')).toHaveCount(edited.locations.length)
    await courseTreeKind(page, 'slide-scene').nth(1).locator('button.course-page-tree__label').first().click()
    await page.screenshot({ path: 'output/playwright/r13-review/r15-native-import-editor.png' })
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(reopened.project).toEqual(edited)
    const html = buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(runRoot, 'native.html'); writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    const next = async () => {
      const expand = player.getByRole('button', { name: '展开教师控制器', exact: true })
      if (await expand.isVisible()) { const box = await expand.boundingBox(); if (box) await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2) }
      const button = player.getByRole('button', { name: '下一场景', exact: true })
      await expect(button).toBeVisible()
      const box = await button.boundingBox(); if (!box) throw new Error('controller missing')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await next()
    await expect(player.getByText('第一课：认识分数', { exact: true })).toBeVisible()
    await expect(player.getByText('平均分成两份，表示其中一份', { exact: true })).toBeVisible()
    const sharedSelector = `[data-slide-layer-item="${shared.item.layerItemId}"]`
    await expect(player.locator(sharedSelector)).toBeVisible()
    await expect(player.locator(sharedSelector)).toHaveCSS('left', '64px')
    await player.screenshot({ path: 'output/playwright/r13-review/r15-native-import-player.png' })
    await next()
    await expect(player.getByText('第2页标题', { exact: true })).toBeVisible()
    await expect(player.locator(sharedSelector)).toHaveCount(0)
    await next()
    await expect(player.getByText('第3页标题', { exact: true })).toBeVisible()
    await expect(player.locator(sharedSelector)).toBeVisible()
    await next()
    await expect(player.getByText('第4页标题', { exact: true })).toBeVisible()
    await expect(player.locator('[data-layer-source="surface"]')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(externalRequests).toEqual([])
  } finally { await browser?.close(); await closeEditor(app, runRoot) }
})

test('S2 PPTX 与样板：真实导入、整体撤销、重开、槽位改写与离线播放', async () => {
  test.setTimeout(180_000)
  const { app, page, runRoot, pageErrors } = await launchEditor()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const filename = join(runRoot, 'pptx-remix.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const baseline = readProject(filename)
    const openTools = async (mode: string) => {
      await page.getByLabel('创作工具', { exact: true }).click()
      await page.getByRole('menuitem', { name: /批量编辑与参考页/ }).click()
      await page.getByLabel('生产力操作').selectOption(mode)
    }
    await openTools('pptx')
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'broken.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(pptxImportFixture({ brokenRelationship: true })) })
    await expect(page.getByRole('alert')).toContainText('第 1 页：损坏关系')
    await expect(page.getByRole('button', { name: '确认导入可用内容' })).toHaveCount(0)
    expect(readProject(filename)).toEqual(baseline)
    await page.getByLabel('选择 PPTX').setInputFiles({ name: 'imported.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(pptxImportFixture({ image: true, unsupported: true })) })
    await expect(page.getByRole('region', { name: 'PPTX 导入提示' })).toContainText('第 1 页：表格、图表等图形对象')
    await expect(page.getByRole('button', { name: '确认导入可用内容' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'imported：1 页，1 个素材' })).toBeVisible()
    await page.screenshot({ path: 'output/playwright/r13-review/r15-partial-pptx-preview.png' })
    await page.getByRole('button', { name: '确认导入可用内容' }).click()
    await expect(page.getByRole('dialog', { name: '设计生产力' })).toHaveCount(0)
    const imported = await saveCurrent(page, filename)
    expect(imported.locations).toHaveLength(baseline.locations.length + 1)
    expect(Object.keys(imported.assets)).toHaveLength(Object.keys(baseline.assets).length + 1)
    await page.screenshot({ path: 'output/playwright/r13-review/r15-imported-editor.png' })
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveCurrent(page, filename)
    expect(undone.surfaces).toEqual(baseline.surfaces)
    expect(undone.assets).toEqual(baseline.assets)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await expect(courseTreeKind(page, 'slide-scene')).toHaveCount(imported.locations.length)
    await openTools('remix')
    const importedSurface = imported.surfaces.at(-1)!
    if (importedSurface.type !== 'slide') throw new Error('Imported Slide missing')
    await page.getByLabel('样板来源').selectOption(importedSurface.scenes[0]!.id)
    await page.getByRole('button', { name: '预览样板改写' }).click()
    await expect(page.getByText('请填写此槽位', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '确认新增改写页' })).toBeDisabled()
    await page.getByLabel('替换槽位 课题 文字').fill('新课题')
    await page.getByRole('button', { name: '预览样板改写' }).click()
    await page.screenshot({ path: 'output/playwright/r13-review/r15-remix-preview.png' })
    await page.getByRole('button', { name: '确认新增改写页' }).click()
    const remixed = await saveCurrent(page, filename)
    expect(remixed.locations).toHaveLength(imported.locations.length + 1)
    const texts = (project: CourseProjectDocument) => project.surfaces.flatMap(s => s.type === 'slide' ? s.scenes.flatMap(scene => scene.layerItems.flatMap(i => i.kind === 'native' && i.content.nativeType === 'text' ? [i.content.data.text] : [])) : [])
    expect(texts(remixed)).toContain('知识 😀')
    expect(texts(remixed)).toContain('新课题')
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect(texts(await saveCurrent(page, filename))).not.toContain('新课题')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    const html = buildPublishedCourseStandaloneHtml({ project: archive.project, assetFiles: archive.assetFiles, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(runRoot, 'pptx-remix.html'); writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    // Native controller delegates painted hit testing to its parent, like the Builder test above.
    const clickController = async (name: string) => {
      if (name !== '展开教师控制器') {
        const collapsed = player.getByRole('button', { name: '展开教师控制器', exact: true })
        if (await collapsed.isVisible()) {
          const pill = await collapsed.boundingBox()
          if (!pill) throw new Error('Collapsed controller missing')
          await player.mouse.click(pill.x + pill.width / 2, pill.y + pill.height / 2)
        }
      }
      const button = player.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      if (!box) throw new Error('Painted controller button missing')
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await clickController('展开教师控制器')
    await clickController('下一场景')
    await expect(player.getByText('知识 😀', { exact: true })).toBeVisible()
    await expect.poll(() => player.locator('[data-native-type="image"] img').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    await clickController('下一场景')
    await expect(player.getByText('新课题', { exact: true })).toBeVisible()
    await player.screenshot({ path: 'output/playwright/r13-review/r15-remix-player.png' })
    expect(pageErrors).toEqual([])
  } finally { await browser?.close(); await closeEditor(app, runRoot) }
})

test('S2 内容 QA：四类错误显示依据与建议并定位正确对象，检查零写入', async () => {
  const { app, page, runRoot, pageErrors } = await launchEditor()
  try {
    const project = contentQaFixture(), filename = join(runRoot, 'qa.h5lesson')
    writeFileSync(filename, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    for (const [code, name] of [['content-math-parse', '公式检查'], ['content-answer-mismatch', '答案检查'], ['content-chart-mismatch', '图表检查'], ['content-source-missing', '来源检查']]) {
      await page.getByRole('button', { name: /^工程检查：/ }).click()
      const row = page.locator('.project-health-issue').filter({ has: page.getByText(code!, { exact: true }) })
      await expect(row).toContainText('依据：')
      await expect(row).toContainText('建议：')
      if (code === 'content-math-parse') await page.screenshot({ path: 'output/playwright/r13-review/r15-content-qa.png' })
      await row.getByRole('button', { name: '定位' }).click()
      await expect(page.getByLabel('名称', { exact: true })).toHaveValue(name!)
    }
    const saved = await saveCurrent(page, filename)
    expect(saved).toEqual(project)
    expect(pageErrors).toEqual([])
  } finally { await closeEditor(app, runRoot) }
})

test('S2 工程字体：Component 和 Runtime 在离线 HTML 中加载直接引用字体', async () => {
  const { app, runRoot } = await launchEditor()
  try {
    const font = new Uint8Array(readFileSync(join(root, 'node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2')))
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
    const sources = await createProjectFontDeliveryFixture(font, fallback)
    const html = buildPublishedCourseStandaloneHtml(sources, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const filename = join(runRoot, 'font-offline.html')
    writeFileSync(filename, html)
    await app.context().setOffline(true)
    const opened = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, filename) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
      await window.loadFile(filename)
    }, filename)
    const player = await opened
    await expect(player.getByText('ComponentFont loaded', { exact: true })).toBeVisible()
    await expect(player.getByText('RuntimeFont loaded', { exact: true })).toBeVisible()
    for (const name of ['ComponentFont', 'RuntimeFont']) {
      await expect.poll(() => player.locator(`[data-direct-image="${name}"]`).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
      await expect.poll(() => player.locator(`[data-direct-audio="${name}"]`).evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1)
    }
    expect(await player.evaluate(() => document.fonts.check('32px ComponentFont') && document.fonts.check('32px RuntimeFont'))).toBe(true)
    await player.screenshot({ path: 'output/playwright/r13-review/r14-font-offline.png' })
  } finally { await closeEditor(app, runRoot) }
})

test('S2 材料库：导入检索、可携带引用和另存为隔离', async () => {
  const launched = await launchEditor()
  const { app, page, runRoot } = launched
  try {
    const filename = join(runRoot, 'materials.h5lesson')
    await patchProjectDialogs(app, { projectSave: filename })
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(() => existsSync(filename)).toBe(true)
    const openMaterials = async () => {
      await page.getByLabel('创作工具', { exact: true }).click()
      await page.getByRole('menuitem').filter({ hasText: '教学材料库' }).click()
      return page.getByRole('dialog', { name: '教学材料库' })
    }
    let library = await openMaterials()
    await library.getByLabel('标题', { exact: true }).fill('分数的含义')
    await library.getByLabel('来源定位', { exact: true }).fill('教材第 12 页')
    await library.getByLabel('材料正文', { exact: true }).fill('分母表示平均分的份数。')
    await library.getByRole('button', { name: '保存文本材料' }).click()
    await expect(library.getByText('1 条材料', { exact: true })).toBeVisible()
    await library.getByLabel('搜索标题、正文或来源').fill('12 页')
    await expect(library.getByText('1 条材料', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/playwright/r13-review/r15-material-library.png' })
    await library.getByRole('button', { name: '插入正文与来源' }).click()
    await expect(library).toHaveCount(0)
    await saveCurrent(page, filename)
    const savedAs = join(runRoot, 'materials-copy.h5lesson')
    await patchProjectDialogs(app, { projectSave: savedAs, projectOpen: filename })
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(savedAs)).toBe(true)
    library = await openMaterials()
    await expect(library.getByText('0 条材料', { exact: true })).toBeVisible()
    const sourceFile = join(runRoot, 'source.txt')
    writeFileSync(sourceFile, '文件材料：平均分是分数意义的基础。', 'utf8')
    await patchProjectDialogs(app, { projectSave: savedAs, projectOpen: sourceFile })
    await library.getByRole('button', { name: '从文件导入（TXT / MD / CSV）' }).click()
    await expect(library.getByText('1 条材料', { exact: true })).toBeVisible()
    await expect(library.getByText('文件材料：平均分是分数意义的基础。', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: '清空当前工程材料' }).click()
    await expect(library.getByText('0 条材料', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: '关闭', exact: true }).click()
    await patchProjectDialogs(app, { projectSave: filename, projectOpen: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    library = await openMaterials()
    await expect(library.getByText('1 条材料', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: '删除材料', exact: true }).click()
    await expect(library.getByText('0 条材料', { exact: true })).toBeVisible()
    await library.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
    await expect.poll(async () => {
      const reopened = await openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
      return JSON.stringify(reopened)
    }).toContain('教材第 12 页')
    expect(launched.pageErrors).toEqual([])
  } finally { await closeEditor(app, runRoot) }
})

test('活动文字草稿：Slide、Spatial、Flow 不失焦保存并可重开', async () => {
  test.setTimeout(120_000)
  const launch = await launchEditor()
  const projectPath = join(launch.runRoot, 'focused-live-drafts.h5lesson')
  const { app, page } = launch
  const slideText = 'Slide 不失焦保存草稿'
  const spatialText = 'Spatial 不失焦保存草稿'
  const flowText = 'Flow 不失焦保存草稿'
  try {
    await patchProjectDialogs(app, { projectSave: projectPath, projectOpen: projectPath })

    await page.getByRole('tab', { name: '元素' }).click()
    await page.getByRole('tab', { name: '常用' }).click()
    await page.getByTestId('add-text').click()
    await page.getByRole('tab', { name: '属性' }).click()
    await page.getByRole('button', { name: '编辑局部文字格式' }).click()
    let editor = page.getByTestId('text-edit-overlay')
    await expect(editor).toBeFocused()
    await editor.fill(slideText)
    await expect(editor).toBeFocused()
    await pressDesktopSaveShortcut(app)
    await expect.poll(
      () => existsSync(projectPath) ? readProject(projectPath) : null,
      { timeout: 15_000 },
    ).not.toBeNull()
    expect(
      readProject(projectPath).surfaces
        .filter((surface) => surface.type === 'slide')
        .flatMap((surface) => surface.type === 'slide'
          ? surface.scenes.flatMap((scene) => scene.layerItems)
          : [])
        .flatMap((item) => item.kind === 'native' && item.content.nativeType === 'text'
          ? [item.content.data.text]
          : []),
    ).toContain(slideText)

    await addSurface(page, 'spatial')
    await page.getByRole('tab', { name: '元素' }).click()
    await page.getByRole('tab', { name: '常用' }).click()
    await page.getByTestId('add-text').click()
    await page.getByRole('tab', { name: '属性' }).click()
    await page.getByRole('button', { name: '编辑局部文字格式' }).click()
    editor = page.getByTestId('text-edit-overlay')
    await expect(editor).toBeFocused()
    await editor.fill(spatialText)
    await expect(editor).toBeFocused()
    await pressDesktopSaveShortcut(app)
    await expect.poll(
      () => spatialWorldTextContents(readProject(projectPath)),
      { timeout: 15_000 },
    ).toContain(spatialText)

    await addSurface(page, 'flow')
    const paragraph = page.getByTestId('flow-paper').locator('.flow-block-paragraph').first()
    const diagnoseFlowHit = process.env.COURSEWARE_R18_FLOW_DIAGNOSTICS === '1'
    const flowHitEvidence: unknown[] = []
    const captureFlowHit = async (phase: string) => {
      const geometry = await paragraph.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const describe = (node: Element) => ({ tag: node.tagName, class: node.getAttribute('class'),
          testId: node.getAttribute('data-testid'), label: node.getAttribute('aria-label'),
          blockId: node.closest('[data-flow-block-id]')?.getAttribute('data-flow-block-id') })
        const points = [0.05, 0.25, 0.5, 0.75, 0.95].flatMap(fx => [0.15, 0.5, 0.85].map(fy => {
          const x = rect.x + rect.width * fx, y = rect.y + rect.height * fy
          const hits = document.elementsFromPoint(x, y)
          return { fx, fy, x, y, paragraphReceivesPoint: !!hits[0] && element.contains(hits[0]),
            hits: hits.slice(0, 5).map(describe) }
        }))
        return { paragraph: { ...describe(element), rect: rect.toJSON(), text: element.textContent }, points,
          toolbars: [...document.querySelectorAll<HTMLElement>('[data-testid="flow-block-context-toolbar"], [data-testid="flow-range-toolbar"]')]
            .map(toolbar => ({ ...describe(toolbar), rect: toolbar.getBoundingClientRect().toJSON(),
              placement: toolbar.dataset.flowToolbarPlacement, pointerEvents: getComputedStyle(toolbar).pointerEvents })),
          selectedBlocks: [...document.querySelectorAll('.flow-block[aria-selected="true"]')].map(describe),
          viewport: { width: innerWidth, height: innerHeight },
          scroll: [...document.querySelectorAll<HTMLElement>('[data-testid="flow-workspace-scroll"]')].map(node => ({
            rect: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop, scrollLeft: node.scrollLeft,
            clientWidth: node.clientWidth, offsetWidth: node.offsetWidth })) }
      })
      flowHitEvidence.push({ phase, geometry })
      writeFileSync(test.info().outputPath('flow-paragraph-hit.json'), JSON.stringify(flowHitEvidence, null, 2))
    }
    if (diagnoseFlowHit) {
      await captureFlowHit('before-original-double-click')
      await page.screenshot({ path: test.info().outputPath('flow-paragraph-hit-ready.png') })
    }
    try {
      await paragraph.dblclick()
    } catch (error) {
      if (diagnoseFlowHit) {
        await captureFlowHit('original-double-click-failed')
        await page.screenshot({ path: test.info().outputPath('flow-paragraph-hit-failure.png') })
      }
      throw error
    }
    editor = page.getByTestId('flow-inline-editor')
    await expect(editor).toBeFocused()
    await editor.fill(flowText)
    await expect(editor).toBeFocused()
    await pressDesktopSaveShortcut(app)
    await expect.poll(
      () => flowTextContents(readProject(projectPath)),
      { timeout: 15_000 },
    ).toContain(flowText)

    await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await openSlide(page)
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator('.node-item').filter({
      has: page.locator('.node-type-icon[title="text"]'),
    }).first().locator('.node-name').click()
    await page.getByRole('tab', { name: '属性' }).click()
    await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(slideText)

    await openSpatial(page)
    await page.getByRole('tab', { name: '图层' }).click()
    await page.locator('.node-item').filter({
      has: page.locator('.node-type-icon[title="text"]'),
    }).first().locator('.node-name').click()
    await page.getByRole('tab', { name: '属性' }).click()
    await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(spatialText)

    await openFlow(page)
    await expect(page.getByTestId('flow-paper')).toContainText(flowText)
    expectCleanDiagnostics(launch)
  } finally {
    await closeEditor(app, launch.runRoot)
  }
})

test('Wave A core authoring remains usable across Mixed surfaces', async () => {
  test.setTimeout(180_000)
  const launch = await launchEditor()
  const projectPath = join(launch.runRoot, 'wave-a-core-usability.h5lesson')
  const { app, page } = launch
  try {
    await test.step('default Slide adds Spatial and two distinct world kinds', async () => {
      await expect(page.getByRole('button', { name: '创作助手', exact: true })).toBeVisible()
      await runLocalCliFailureProbe(app, page, launch.runRoot)
      await expect(courseTreeKind(page, 'slide-scene')).toHaveCount(1)
      await addSurface(page, 'spatial')
      await expect(page.getByTestId('spatial-workspace')).toBeVisible()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-text').click()
      await page.getByTestId('add-rectangle').click()
      const world = page.getByTestId('spatial-world-layer')
      await expect(world.locator('.spatial-world-item--text')).toHaveCount(1)
      await expect(world.locator('.spatial-world-item--shape')).toHaveCount(1)
    })

    await test.step('Flow keeps empty geometry and a real mouse-created native range', async () => {
      await addSurface(page, 'flow')
      await expect(page.getByTestId('flow-workspace')).toBeVisible()
      const paragraph = page.getByTestId('flow-paper').locator('.flow-block-paragraph').first()
      await paragraph.dblclick()
      const editor = page.getByTestId('flow-inline-editor')
      await expect(editor).toBeFocused()
      const emptyGeometry = await editor.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const selection = element.ownerDocument.getSelection()
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null
        const inside = (node: Node | null) => Boolean(node && (node === element || element.contains(node)))
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          collapsed: range?.collapsed ?? false,
          inside: inside(range?.startContainer ?? null) && inside(range?.endContainer ?? null),
        }
      })
      expect(emptyGeometry.width).toBeGreaterThan(0)
      expect(emptyGeometry.height).toBeGreaterThan(0)
      expect(emptyGeometry.collapsed).toBe(true)
      expect(emptyGeometry.inside).toBe(true)

      await page.keyboard.insertText('首')
      await expect(editor).toHaveText('首')
      const firstGeometry = await editor.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      })
      for (const key of ['left', 'top', 'width', 'height'] as const) {
        expect(Math.abs(firstGeometry[key] - emptyGeometry[key])).toBeLessThanOrEqual(1)
      }

      await editor.press('Control+A')
      await page.keyboard.insertText(FLOW_SELECTION_TEXT)
      await expect(editor).toHaveText(FLOW_SELECTION_TEXT)
      const start = await flowTextPoint(editor, 1, 'start')
      const end = await flowTextPoint(editor, FLOW_SELECTION_TEXT.length - 2, 'end')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 12 })
      await page.mouse.up()
      const nativeRange = await editor.evaluate((element) => {
        const selection = element.ownerDocument.getSelection()
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null
        const inside = (node: Node | null) => Boolean(node && (node === element || element.contains(node)))
        return {
          text: selection?.toString() ?? '',
          collapsed: range?.collapsed ?? true,
          inside: inside(range?.startContainer ?? null) && inside(range?.endContainer ?? null),
        }
      })
      expect(nativeRange.collapsed).toBe(false)
      expect(nativeRange.inside).toBe(true)
      expect(nativeRange.text.length).toBeGreaterThanOrEqual(2)
      await expect(page.getByTestId('flow-range-toolbar')).toBeVisible()
      await openSlide(page)
      await expect(editor).toHaveCount(0)
    })

    await test.step('controller ownership, cancel/clamp, roundtrip, order and Player stay safe', async () => {
      await openSlide(page)
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-rectangle').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await setCurrentNodeGeometry(page, { X: 190, Y: 638, 宽: 900, 高: 64 })

      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(teacherControllerRows(page)).toHaveCount(1)
      await teacherControllerRows(page).locator('.node-name').click()
      await page.getByRole('tab', { name: '属性' }).click()
      const defaultCollapsed = page.getByLabel('打开课件时默认折叠')
      await expect(defaultCollapsed).toBeChecked()

      await openSlide(page)
      await expect(page.getByTestId('global-layer-entry')).toHaveAttribute('aria-pressed', 'false')
      await page.getByRole('tab', { name: '图层' }).click()
      const shapeRows = page.getByTestId('nodes-tab').locator('.node-item').filter({
        has: page.locator('.node-type-icon[title="shape"]'),
      })
      await expect(shapeRows).toHaveCount(1)
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      const canvasBounds = await canvas.boundingBox()
      if (!canvasBounds) throw new Error('Slide canvas is not visible')
      const overlapPoint = {
        x: canvasBounds.x + (640 / CANVAS_WIDTH) * canvasBounds.width,
        y: canvasBounds.y + (670 / CANVAS_HEIGHT) * canvasBounds.height,
      }
      const browserHit = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return {
          tagName: hit?.tagName ?? null,
          testId: hit?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null,
        }
      }, overlapPoint)
      expect(browserHit).toEqual({ tagName: 'CANVAS', testId: 'canvas-stage' })
      await page.mouse.click(overlapPoint.x, overlapPoint.y)
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(shapeRows).toHaveClass(/node-item--selected/)
      await expect(teacherControllerRows(page)).toHaveCount(0)

      await openSpatial(page)
      await expectInertPageController(page, 'spatial')
      await openFlow(page)
      await expectInertPageController(page, 'flow')

      await openSlide(page)
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '图层' }).click()
      await teacherControllerRows(page).locator('.node-name').click()
      const baseline = await saveAs(app, page, projectPath)
      const baselineController = structuredClone(teacherController(baseline))

      const cancelledDrag = await beginControllerDrag(page)
      // Chromium has no API for a trusted OS pointercancel. The drag itself is a
      // real mouse gesture; only the cancellation event is synthesized.
      await cancelledDrag.workspace.dispatchEvent('pointercancel', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX: cancelledDrag.target.x,
        clientY: cancelledDrag.target.y,
      })
      await page.mouse.up()
      const afterCancel = await saveCurrent(page, projectPath)
      expect(afterCancel.revision).toBe(baseline.revision)
      expect(teacherController(afterCancel).frame).toEqual(baselineController.frame)

      await page.getByRole('tab', { name: '图层' }).click()
      await page.getByTestId('nodes-tab').locator('.tree-root').click()
      await teacherControllerRows(page).locator('.node-name').click()
      await beginControllerDrag(page)
      await page.mouse.up()
      const afterClamp = await saveCurrent(page, projectPath)
      expect(afterClamp.revision).toBe(baseline.revision + 1)
      const clampedController = teacherController(afterClamp)
      const recovery = rotatedRectangleAabb({ ...clampedController.frame, rotation: clampedController.rotation })
      expect(recovery.left).toBeGreaterThanOrEqual(-0.01)
      expect(recovery.top).toBeGreaterThanOrEqual(-0.01)
      expect(recovery.right).toBeLessThanOrEqual(CANVAS_WIDTH + 0.01)
      expect(recovery.bottom).toBeLessThanOrEqual(CANVAS_HEIGHT + 0.01)

      const allItems = effectiveItems(afterClamp)
      expect(new Set(allItems.map((item) => item.order)).size).toBe(allItems.length)
      const spatial = afterClamp.surfaces.find((surface) => surface.type === 'spatial-2d')
      if (!spatial || spatial.type !== 'spatial-2d') throw new Error('Saved Spatial surface is missing')
      expect(spatial.world.layerItems).toHaveLength(2)
      expect(new Set(spatial.world.layerItems.map((item) => item.layerItemId)).size).toBe(2)
      expect(new Set(spatial.world.layerItems.flatMap((item) => (
        item.kind === 'native' ? [item.content.nativeType] : []
      )))).toEqual(new Set(['text', 'shape']))

      await patchProjectDialogs(app, { projectSave: projectPath, projectOpen: projectPath })
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(courseTreeKind(page, 'spatial-camera')).toHaveCount(1)
      await openSpatial(page)
      const reopenedWorld = page.getByTestId('spatial-world-layer')
      await expect(reopenedWorld.locator('.spatial-world-item--text')).toHaveCount(1)
      await expect(reopenedWorld.locator('.spatial-world-item--shape')).toHaveCount(1)
      await openFlow(page)
      await expect(page.getByTestId('flow-paper').locator('.flow-block-paragraph').first())
        .toContainText(FLOW_SELECTION_TEXT)

      await openSlide(page)
      await page.getByRole('button', { name: '整课预览' }).click()
      const preview = page.getByTestId('course-preview-overlay')
      const previewHost = page.getByTestId('course-preview-host')
      await expect(preview).toBeVisible()
      const publishedSlide = previewHost.locator('.slide-published-adapter')
      await expect(publishedSlide).toBeVisible({ timeout: 15_000 })
      const publishedController = publishedSlide.locator('.slide-native-teacher-controller')
      await expect(publishedController).toBeVisible()
      const recoveryButton = publishedController.getByRole('button', { name: '展开教师控制器' })
      await expect(recoveryButton).toBeVisible()
      const publishedRecovery = await recoveryButton.evaluate((button) => {
        const stage = button.closest<HTMLElement>('.slide-published-adapter')
        const controller = button.closest<HTMLElement>('.slide-native-teacher-controller')
        if (!stage) throw new Error('Published recovery button is missing its Slide stage')
        if (!controller) throw new Error('Published recovery button is missing its controller root')
        const buttonRect = button.getBoundingClientRect()
        const stageRect = stage.getBoundingClientRect()
        const centerX = buttonRect.left + buttonRect.width / 2
        const centerY = buttonRect.top + buttonRect.height / 2
        const hit = button.ownerDocument.elementFromPoint(centerX, centerY)
        return {
          button: {
            left: buttonRect.left,
            top: buttonRect.top,
            right: buttonRect.right,
            bottom: buttonRect.bottom,
          },
          stage: {
            left: stageRect.left,
            top: stageRect.top,
            right: stageRect.right,
            bottom: stageRect.bottom,
          },
          center: { x: centerX, y: centerY },
          hitInsideController: Boolean(hit && controller.contains(hit)),
        }
      })
      expect(publishedRecovery.button.left).toBeGreaterThanOrEqual(publishedRecovery.stage.left - 0.5)
      expect(publishedRecovery.button.top).toBeGreaterThanOrEqual(publishedRecovery.stage.top - 0.5)
      expect(publishedRecovery.button.right).toBeLessThanOrEqual(publishedRecovery.stage.right + 0.5)
      expect(publishedRecovery.button.bottom).toBeLessThanOrEqual(publishedRecovery.stage.bottom + 0.5)
      // The visual button delegates pointer handling to the draggable controller root.
      expect(publishedRecovery.hitInsideController).toBe(true)
      await page.mouse.click(publishedRecovery.center.x, publishedRecovery.center.y)
      await expect(publishedController.getByRole('button', { name: '收起教师控制器' })).toBeVisible()
      await expectBackgroundWindowsIsolated(app, true)
      await preview.getByRole('button', { name: '关闭预览' }).click()
      await expect(preview).toHaveCount(0)
    })

    expectCleanDiagnostics(launch)
  } finally {
    await closeEditor(app, launch.runRoot)
  }
})


for (const adapter of ['claude', 'opencode', 'codex'] as const) test(`S3 真实组件源码：${adapter} 读取既有包并连续修订`, async () => {
  test.setTimeout(600000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const evidence = join(root, `output/playwright/r18-source-${adapter}`)
  mkdirSync(evidence, { recursive: true })
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing source fixture server')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const font = new Uint8Array(readFileSync(join(root, 'node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2')))
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
    const sources = await createProjectFontDeliveryFixture(font, fallback)
    const filename = join(runRoot, `component-source-${adapter}.h5lesson`)
    writeFileSync(filename, createCourseProjectArchive({ project: sources.project, assetFiles: sources.assetFiles,
      componentFiles: Object.fromEntries(Object.entries(sources.components ?? {}).map(([id, data]) => [id, data.files])) }))
    await patchProjectDialogs(app, { projectOpen: filename, projectSave: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('CLI', { exact: true }).selectOption(adapter)
    const records = () => page.evaluate(async owner => {
      const response = await window.desktopAPI.localAgent({ operation: 'list', ...owner })
      return Promise.all((response.records ?? []).map(async record => {
        const events = []; let after = 0
        for (;;) {
          const read = await window.desktopAPI.localAgent({ operation: 'read', ...owner, sessionId: record.id, after })
          const batch = read.records?.[0]?.events ?? []; events.push(...batch)
          if (batch.length < 200) break
          after = batch.at(-1)!.sequence
        }
        return { ...record, events }
      }))
    }, { projectId: sources.project.id, projectPath: filename })
    const send = async (instruction: string) => {
      await chat.getByLabel('发送给创作助手').fill(instruction)
      await chat.getByRole('button', { name: '发送', exact: true }).click()
      try {
        await expect.poll(async () => {
          const alert = chat.getByRole('alert')
          if (await alert.count()) throw new Error(await alert.innerText())
          return chat.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
        }, { timeout: 245000 }).toBe(true)
      } catch (error) { writeFileSync(join(evidence, 'failure-records.json'), JSON.stringify(await records(), null, 2)); throw error }
      await chat.getByRole('button', { name: '应用候选', exact: true }).click()
      await expect(chat.getByText('宿主已提交，可一次撤销', { exact: true })).toBeVisible()
    }
    await send('修改当前快照中已有的font-demo组件包源码：在runtime.js内把可见文字“ComponentFont loaded”改为“AI源码修订”，其余源码/文件/实例props/位置全部保留。必须读取context.componentSources提供的完整文件，使用其精确package target及baseVersion/baseContentIdentity，component.package operation revise提交完整files；manifest的id/version保持基线，由宿主生成版本。不能新建包、不能fork、不能改成Native或另造组件。本任务必须改原组件内部实现，Native/Recipe无法完成。只输出一个严格候选，JSON转义必须有效，不要读文件或调用外部工具。')
    const first = await saveCurrent(page, filename)
    expect(Object.keys(first.componentPackages)).toEqual(['font-demo'])
    expect(first.componentPackages['font-demo']!.version).not.toBe('1.0.0')
    await send('继续修改同一个font-demo组件包：将上一轮的可见文字“AI源码修订”改为“AI再次修订”，其他文件字节、实例props、位置与功能保持不变。从本轮context.componentSources取最新package target/baseVersion/baseContentIdentity，使用component.package operation revise返回完整files；manifest id/version仍保持本轮基线。不要新建包。本任务仍是原组件内部实现修改，Native/Recipe不足。只输出一个严格候选。')
    const second = await saveCurrent(page, filename)
    expect(second.componentPackages['font-demo']!.version).not.toBe(first.componentPackages['font-demo']!.version)
    expect(Object.keys(second.assets).filter(id => id.startsWith('component-capture-'))).toHaveLength(1)
    await chat.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    expect(await saveCurrent(page, filename)).toEqual(first)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    const components = Object.fromEntries(Object.values(reopened.componentFiles).map(files => { const data = parseComponentPackageFiles(files); return [data.manifest.id, data] }))
    expect(components['font-demo']!.runtimeSource).toContain('AI再次修订')
    const runs = await records()
    expect(runs.every(record => JSON.stringify(record.generationRequest?.context).includes('componentSources'))).toBe(true)
    writeFileSync(join(evidence, 'records.json'), JSON.stringify(runs, null, 2))
    writeFileSync(join(evidence, 'generated.h5lesson'), readFileSync(filename))
    const htmlPath = join(evidence, 'generated.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: reopened.project, assetFiles: reopened.assetFiles, components }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage(); await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    await expect(player.getByText('AI再次修订', { exact: true })).toBeVisible()
    await player.screenshot({ path: join(evidence, 'player.png') })
  } finally { await browser?.close(); if (launch) await closeEditor(launch.app, launch.runRoot); await server.close() }
})

test('S3 共享组件源码：两文件草稿、嵌套正文目标、真实准入与一次资源历史', async () => {
  test.setTimeout(180000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing server')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const { createBlankCourseProject } = await import('../../src/renderer/project/createCourseProject')
    const { addCourseFlowPage, addCourseSpatialPage } = await import('../../src/renderer/course/courseLocationCommands')
    const { componentPackageMeta } = await import('../../src/renderer/components/editableComponentPackage')
    const { visitCourseComponentPackageInstances } = await import('../../src/renderer/components/courseComponentPackageTransactions')
    const added = addCourseFlowPage(createBlankCourseProject())
    if (!added.ok) throw new Error(added.reason)
    const mixed = addCourseSpatialPage(added.project)
    if (!mixed.ok) throw new Error(mixed.reason)
    const project = mixed.project, id = 'com.example.shared-source'
    const source = (marker: string) => `CoursewareComponent.define({id:${JSON.stringify(id)},runtimeApiVersion:4,create(ctx){var p=document.createElement('div');p.textContent=${JSON.stringify(marker)}+' '+ctx.props.label;p.style.cssText='background:#dbeafe;color:#153e75;padding:16px;font-size:22px';ctx.dom.root.appendChild(p);return{destroy(){p.remove()}}}})`
    const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id, name: '共享源码样例', version: '1.0.0', entry: 'runtime.js',
      defaultSize: { width: 320, height: 150 }, minSize: { width: 16, height: 16 }, preserveAspectRatio: false,
      assets: {}, defaultProps: {}, supportedScopes: ['scene', 'global'], renderMode: 'dom' }
    const encoder = new TextEncoder()
    const data = parseComponentPackageFiles({ 'manifest.json': encoder.encode(JSON.stringify(manifest)), 'runtime.js': encoder.encode(source('原始布局')), 'spare.js': encoder.encode('// preserve this file') })
    project.componentPackages[id] = componentPackageMeta(data)
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
    project.assets.fallback = { id: 'fallback', filename: 'fallback.png', path: 'assets/fallback.png', kind: 'image', mimeType: 'image/png', byteLength: fallback.length, width: 1, height: 1 }
    const layer = (instanceId: string, x: number, y: number) => ({ kind: 'component' as const, layerItemId: instanceId, label: instanceId,
      frame: { mode: 'absolute' as const, x, y, width: 320, height: 150 }, order: 10, visible: true, locked: false, rotation: 0, opacity: 1,
      hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const, component: { packageId: id, version: '1.0.0' }, props: { label: instanceId }, staticFallbackAssetId: 'fallback' })
    const slide = project.surfaces.find(surface => surface.type === 'slide')!, flow = project.surfaces.find(surface => surface.type === 'flow')!, spatial = project.surfaces.find(surface => surface.type === 'spatial-2d')!
    if (slide.type !== 'slide' || flow.type !== 'flow' || spatial.type !== 'spatial-2d') throw new Error('Incomplete Mixed')
    slide.scenes[0]!.layerItems.push(layer('shared-slide', 100, 200))
    flow.blocks.push({ id: 'shared-section', type: 'section', title: '嵌套组件', collapsedByDefault: false, blocks: [
      { id: 'shared-flow', type: 'component', component: { packageId: id, version: '1.0.0' }, props: { label: 'shared-flow' }, staticFallbackAssetId: 'fallback', wrap: 'none' },
    ] })
    spatial.world.layerItems.push(layer('shared-spatial', -160, -75))
    const filename = join(runRoot, 'shared-source.h5lesson')
    writeFileSync(filename, createCourseProjectArchive({ project, assetFiles: { fallback }, componentFiles: { [id]: data.files } }))
    await patchProjectDialogs(app, { projectOpen: filename, projectSave: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const selectComponent = async (instanceId: string) => page.evaluate(async instanceId => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')
      useEditorStore.getState().selectNode(instanceId)
      useEditorStore.setState({ activeTab: 'developer' })
    }, instanceId)
    await selectComponent('shared-slide')
    await page.getByRole('tab', { name: /组件代码/ }).click()
    const runtime = page.getByLabel('组件 Runtime', { exact: true })
    await expect(runtime).toBeEditable()
    await runtime.fill(source('修订布局'))
    await page.getByRole('tab', { name: 'manifest.json', exact: true }).click()
    await page.getByLabel('组件 Manifest', { exact: true }).fill(JSON.stringify({ ...manifest, name: '共享源码修订' }))
    await page.getByRole('tab', { name: 'runtime.js', exact: true }).click()
    await expect(runtime).toHaveValue(source('修订布局'))
    await page.getByRole('button', { name: '校验并应用组件源码', exact: true }).click()
    await expect(page.getByText('源码已应用，所有引用实例已同步。', { exact: true })).toBeVisible({ timeout: 45000 })
    const updated = await saveCurrent(page, filename)
    expect(updated.revision).toBe(project.revision + 1)
    expect(updated.componentPackages[id]!.version).not.toBe('1.0.0')
    const refs: string[] = []
    visitCourseComponentPackageInstances(updated, id, (instance, reference) => {
      expect(instance.component.version).toBe(updated.componentPackages[id]!.version)
      expect(instance.props).toEqual({ label: reference.instanceId })
      expect(instance.staticFallbackAssetId).toMatch(/^component-capture-/)
      refs.push(reference.instanceId)
    })
    expect(refs.sort()).toEqual(['shared-flow', 'shared-slide', 'shared-spatial'])
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveCurrent(page, filename)
    expect(undone.componentPackages[id]!.version).toBe('1.0.0')
    expect(Object.keys(undone.assets)).toEqual(['fallback'])
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await openFlow(page)
    await selectComponent('shared-flow')
    await page.getByRole('tab', { name: /组件代码/ }).click()
    await expect(runtime).toHaveValue(source('修订布局'))
    await page.getByRole('tab', { name: 'manifest.json', exact: true }).click()
    await expect(page.getByLabel('组件 Manifest', { exact: true })).toHaveValue(/共享源码修订/)
    const rebase = page.getByRole('button', { name: '载入当前基线并保留草稿', exact: true })
    if (await rebase.isVisible()) await rebase.click()
    await page.getByRole('tab', { name: 'runtime.js', exact: true }).click()
    await runtime.fill(source('正文发起修订'))
    await page.getByRole('button', { name: '校验并应用组件源码', exact: true }).click()
    await expect(page.getByText('源码已应用，所有引用实例已同步。', { exact: true })).toBeVisible({ timeout: 45000 })
    const fromFlow = await saveCurrent(page, filename)
    expect(fromFlow.componentPackages[id]!.version).not.toBe(updated.componentPackages[id]!.version)
    expect(Object.keys(fromFlow.assets).filter(key => key.startsWith('component-capture-'))).toHaveLength(3)
    visitCourseComponentPackageInstances(fromFlow, id, instance => expect(instance.component.version).toBe(fromFlow.componentPackages[id]!.version))
    await page.getByRole('button', { name: '为当前实例创建独立副本', exact: true }).click()
    const forked = await saveCurrent(page, filename)
    expect(Object.keys(forked.componentPackages)).toHaveLength(2)
    const sharedRefs: string[] = []
    visitCourseComponentPackageInstances(forked, id, (_instance, reference) => sharedRefs.push(reference.instanceId))
    expect(sharedRefs.sort()).toEqual(['shared-slide', 'shared-spatial'])
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const unforked = await saveCurrent(page, filename)
    expect(Object.keys(unforked.componentPackages)).toEqual([id])
    expect(unforked.componentPackages[id]!.version).toBe(fromFlow.componentPackages[id]!.version)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    const components = Object.fromEntries(Object.values(archive.componentFiles).map(files => { const data = parseComponentPackageFiles(files); return [data.manifest.id, data] }))
    expect(new TextDecoder().decode(components[id]!.files['spare.js'])).toBe('// preserve this file')
    const htmlPath = join(runRoot, 'shared-source.html')
    writeFileSync(htmlPath, buildPublishedCourseStandaloneHtml({ project: { ...archive.project, startLocationId: archive.project.locations.find(location => location.surfaceId === flow.id)!.id }, assetFiles: archive.assetFiles, components }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8')))
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage()
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    await expect(player.getByText('正文发起修订 shared-flow', { exact: true })).toBeVisible()
    mkdirSync(join(root, 'output/playwright/r18-integration'), { recursive: true })
    await player.screenshot({ path: 'output/playwright/r18-integration/shared-source-flow.png' })
  } finally { await browser?.close(); if (launch) await closeEditor(launch.app, launch.runRoot); await server.close() }
})

test('S3 三表面整合：控制器保全与响应式浮层几何', async () => {
  test.setTimeout(120000)
  const { app, page, runRoot, pageErrors } = await launchEditor()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const { createBlankCourseProject } = await import('../../src/renderer/project/createCourseProject')
    const { addCourseFlowPage, addCourseSpatialPage } = await import('../../src/renderer/course/courseLocationCommands')
    const { createTextNode } = await import('../../src/renderer/project/nativeNodeFactories')
    const { sceneNodeToCourseLayerItem } = await import('../../src/shared/courseProjectModel')
    const added = addCourseFlowPage(createBlankCourseProject())
    if (!added.ok) throw new Error(added.reason)
    const mixed = addCourseSpatialPage(added.project)
    if (!mixed.ok) throw new Error(mixed.reason)
    const project = mixed.project
    const original = project.locations[0]!
    const controller = project.globalLayerItems.find(entry => isControllerFixture(entry.item))!
    controller.visibility = { mode: 'include', locationIds: [original.id] }
    const flow = project.surfaces.find(surface => surface.type === 'flow')!
    if (flow.type !== 'flow') throw new Error('Missing Flow')
    flow.blocks.push(...Array.from({ length: 40 }, (_, i) => ({ id: `geometry-p-${i}`, type: 'paragraph' as const, text: `响应式文档段落 ${i}。窗口改变时重新换行，浮层仍与正文采用同一尺度。`.repeat(3) })))
    const topItem = sceneNodeToCourseLayerItem(createTextNode({ id: 'geometry-top', text: '顶部浮层 · 原生文字', x: 40, y: 0, width: 300, height: 65, style: { fontSize: 24, color: '#164c96', backgroundColor: '#dbeafe', backgroundOpacity: 1, cornerRadius: 9 } }))
    topItem.order = Math.max(...project.globalLayerItems.map(entry => entry.item.order), 0) + 1
    project.globalLayerItems.push({ item: topItem, plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
    const farItem = sceneNodeToCourseLayerItem(createTextNode({ id: 'geometry-far', text: '屏外旧浮层', x: 1150, y: 660, width: 200, height: 100, style: { fontSize: 24 } }))
    farItem.order = topItem.order + 1
    project.globalLayerItems.push({ item: farItem, visibility: { mode: 'all', locationIds: [] } })
    const paperItem = sceneNodeToCourseLayerItem(createTextNode({ id: 'geometry-paper', text: '随纸张滚动', x: 40, y: 340, width: 240, height: 60, style: { fontSize: 22 } }))
    paperItem.paperSpace = 'paper'
    paperItem.order = Math.max(...flow.surfaceLayerItems.map(entry => entry.item.order), 0) + 1
    flow.surfaceLayerItems.push({ item: paperItem, visibility: { mode: 'all', locationIds: [] } })
    const filename = join(runRoot, 'surface-integration.h5lesson')
    writeFileSync(filename, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
    await patchProjectDialogs(app, { projectOpen: filename, projectSave: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.locator('[data-kind="slide-page"]').first().getByRole('button', { name: /^删除页面/ }).click()
    await page.getByRole('button', { name: '删除页面', exact: true }).click()
    const deleted = await saveCurrent(page, filename)
    const survivingController = deleted.globalLayerItems.find(entry => entry.item.layerItemId === controller.item.layerItemId)!
    expect(survivingController.item).toEqual(controller.item)
    expect(survivingController.visibility).toEqual({ mode: 'include', locationIds: deleted.locations.map(location => location.id) })
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await saveCurrent(page, filename)).globalLayerItems.find(entry => entry.item.layerItemId === controller.item.layerItemId)).toEqual(controller)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await openFlow(page)
    const measure = () => page.getByTestId('flow-workspace').evaluate(workspace => {
      const viewport = workspace.getBoundingClientRect()
      const paper = workspace.querySelector('[data-testid="flow-paper"]')!.getBoundingClientRect()
      const top = workspace.querySelector('[data-layer-item-id="geometry-top"]')!.getBoundingClientRect()
      const overlay = workspace.querySelector('[data-layer-item-id="geometry-paper"]')!.getBoundingClientRect()
      return { width: viewport.width, top: top.top - viewport.top, x: top.left - viewport.left, itemWidth: top.width, paperX: overlay.left - paper.left, paperY: overlay.top - paper.top }
    })
    mkdirSync(join(root, 'output/playwright/r18-integration'), { recursive: true })
    for (const [width, height] of [[1400, 900], [1000, 760]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size[0]!, size[1]!), [width!, height!])
      await expect.poll(async () => (await measure()).top).toBeCloseTo(0, 1)
      await expect.poll(async () => (await measure()).itemWidth).toBeCloseTo(300, 1)
      expect((await measure()).x).toBeCloseTo(40, 1)
      expect((await measure()).paperX).toBeCloseTo(40, 1)
      expect((await measure()).paperY).toBeCloseTo(340, 1)
      await page.screenshot({ path: `output/playwright/r18-integration/flow-${width}.png` })
    }
    const scroll = page.getByTestId('flow-workspace-scroll')
    await scroll.evaluate(element => { element.scrollTop = 180; element.dispatchEvent(new Event('scroll')) })
    await expect.poll(async () => (await measure()).paperY).toBeCloseTo(340, 1)
    expect((await measure()).top).toBeCloseTo(0, 1)
    // A real pointer gesture on the paper item must not treat scroll as resize displacement.
    const card = page.getByTestId('flow-layer-card-geometry-paper')
    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + 90, box.y + 25)
    await page.mouse.down()
    await page.mouse.move(box.x + 120, box.y + 55, { steps: 6 })
    await page.mouse.up()
    const moved = await saveCurrent(page, filename)
    const movedFlow = moved.surfaces.find(surface => surface.type === 'flow')!
    if (movedFlow.type !== 'flow') throw new Error('Missing moved Flow')
    expect(movedFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === 'geometry-paper')!.item.frame).toMatchObject({ x: 70, y: 370 })
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await page.locator('[data-testid^="node-item-"][data-testid$="geometry-far"] .node-name').click()
    const far = page.getByTestId('flow-layer-selection-geometry-far')
    await expect(page.getByRole('button', { name: '回到文档原位', exact: true })).toBeVisible()
    const viewport = (await page.getByTestId('flow-workspace').boundingBox())!, revealed = (await far.boundingBox())!
    expect(revealed.x).toBeGreaterThanOrEqual(viewport.x + 15)
    expect(revealed.y).toBeGreaterThanOrEqual(viewport.y + 15)
    expect(revealed.x + revealed.width).toBeLessThanOrEqual(viewport.x + viewport.width - 15)
    expect(revealed.y + revealed.height).toBeLessThanOrEqual(viewport.y + viewport.height - 15)
    expect(await saveCurrent(page, filename)).toEqual(moved)
    await page.mouse.move(revealed.x + 50, revealed.y + 40)
    await page.mouse.down()
    await page.mouse.move(revealed.x + 70, revealed.y + 50, { steps: 5 })
    await page.mouse.up()
    expect((await saveCurrent(page, filename)).globalLayerItems.find(entry => entry.item.layerItemId === 'geometry-far')!.item.frame).toMatchObject({ x: 1170, y: 670 })
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await saveCurrent(page, filename)
    await page.getByRole('button', { name: '回到文档原位', exact: true }).click()
    expect((await measure()).top).toBeCloseTo(0, 1)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    const html = buildPublishedCourseStandaloneHtml({ project: { ...archive.project, startLocationId: archive.project.locations.find(location => location.surfaceId === flow.id)!.id }, assetFiles: {}, components: {} }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(runRoot, 'surface-integration.html')
    writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 847, height: 721 } })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    const runtimeTop = player.locator('[data-flow-overlay-item="geometry-top"]')
    await expect(runtimeTop).toBeVisible()
    expect((await runtimeTop.boundingBox())!.width).toBeCloseTo(300, 1)
    expect((await runtimeTop.boundingBox())!.y).toBeCloseTo((await player.locator('.flow-surface-host').boundingBox())!.y, 1)
    await player.screenshot({ path: 'output/playwright/r18-integration/flow-offline.png' })
    expect(pageErrors).toEqual([])
  } finally { await browser?.close(); await closeEditor(app, runRoot) }
})

test('S3 Flow 所见即所得：空段、连续换行、选择与保存重开', async () => {
  test.setTimeout(120000)
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    launch = await launchEditor(`http://127.0.0.1:${address.port}`)
    const { app, page, runRoot } = launch
    const { createBlankCourseProject } = await import('../../src/renderer/project/createCourseProject')
    const { addCourseFlowPage } = await import('../../src/renderer/course/courseLocationCommands')
    const created = addCourseFlowPage(createBlankCourseProject())
    if (!created.ok) throw new Error(created.reason)
    const project = created.project
    const flow = project.surfaces.find(surface => surface.type === 'flow')!
    if (flow.type !== 'flow') throw new Error('Missing Flow')
    const { createChartNode, createChartLayerItem } = await import('../../src/renderer/project/nativeNodeFactories')
    const chart = createChartLayerItem(createChartNode()).content
    if (chart.nativeType !== 'chart') throw new Error('Missing chart')
    flow.blocks.push(
      { id: 'spacing-a', type: 'paragraph', text: '第一行\n\n第三行', runs: [] },
      { id: 'spacing-empty', type: 'paragraph', text: '', runs: [] },
      { id: 'spacing-next', type: 'paragraph', text: '空段之后仍保留位置', runs: [] },
      { id: 'spacing-rich', type: 'heading', level: 2, text: '字号与强调\n\n均须一致', runs: [{ start: 0, end: 2, style: { fontSize: 28, bold: false, emphasis: true } }] },
      { id: 'spacing-quote', type: 'quote', text: '引用第一行\n\n引用第三行', citation: '来源' },
      { id: 'spacing-list', type: 'list', ordered: true, items: [{ id: 'l1', text: '列表一\n\n保留换行' }, { id: 'l2', text: '列表二' }] },
      { id: 'spacing-section', type: 'section', title: '小节标题', collapsedByDefault: false, blocks: [{ id: 'section-body', type: 'paragraph', text: '小节正文' }] },
      { id: 'spacing-chart', type: 'chart', chart: chart.data, height: 180 },
    )
    const filename = join(runRoot, 'flow-spacing.h5lesson')
    writeFileSync(filename, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
    await patchProjectDialogs(app, { projectOpen: filename, projectSave: filename })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await openFlow(page)
    const paper = page.getByTestId('flow-paper')
    await expect(paper).toBeVisible()
    const measure = (scope: Locator) => scope.evaluate(element => {
      const rootRect = element.getBoundingClientRect()
      const scale = rootRect.width / (element as HTMLElement).offsetWidth
      return ['spacing-a', 'spacing-empty', 'spacing-next', 'spacing-rich', 'spacing-quote', 'spacing-list', 'spacing-section', 'spacing-chart'].map(id => {
        const block = element.querySelector<HTMLElement>(`[data-flow-block-id="${id}"]`)!
        const rect = block.getBoundingClientRect()
        return { id, x: (rect.x - rootRect.x) / scale, y: (rect.y - rootRect.y) / scale, width: rect.width / scale, height: rect.height / scale }
      })
    })
    const before = await measure(paper)
    const screenBefore = await paper.locator('[data-flow-block-id="spacing-a"]').boundingBox()
    const diagnoseFlowLayout = process.env.COURSEWARE_R18_FLOW_DIAGNOSTICS === '1'
    const flowLayoutEvidence: unknown[] = []
    const captureFlowLayout = async (scope: Locator, phase: string) => {
      const geometry = await scope.evaluate(element => {
        const chain = []; let node: HTMLElement | null = element as HTMLElement
        while (node) {
          const style = getComputedStyle(node), rect = node.getBoundingClientRect()
          chain.push({ tag: node.tagName, class: node.className, testId: node.dataset.testid,
            rect: rect.toJSON(), clientWidth: node.clientWidth, offsetWidth: node.offsetWidth,
            clientHeight: node.clientHeight, offsetHeight: node.offsetHeight,
            scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
            scrollLeft: node.scrollLeft, scrollTop: node.scrollTop,
            verticalScrollbarWidth: node.offsetWidth - node.clientWidth
              - Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth),
            style: { overflowX: style.overflowX, overflowY: style.overflowY,
              scrollbarWidth: style.scrollbarWidth, scrollbarGutter: style.scrollbarGutter,
              boxSizing: style.boxSizing, width: style.width, maxWidth: style.maxWidth,
              paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
              marginLeft: style.marginLeft, marginRight: style.marginRight, transform: style.transform } })
          node = node.parentElement
        }
        const block = element.querySelector<HTMLElement>('[data-flow-block-id="spacing-a"]')!
        const bounds = block.getBoundingClientRect()
        return { chain, block: bounds.toJSON(), viewport: { width: innerWidth, height: innerHeight },
          centerHits: document.elementsFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            .slice(0, 6).map(hit => ({ tag: hit.tagName, class: hit.getAttribute('class'), testId: hit.getAttribute('data-testid') })) }
      })
      flowLayoutEvidence.push({ phase, geometry })
      writeFileSync(test.info().outputPath('flow-edit-run-geometry.json'), JSON.stringify(flowLayoutEvidence, null, 2))
    }
    if (diagnoseFlowLayout) await captureFlowLayout(paper, 'initial-editor-baseline')
    expect(before[0].height).toBeGreaterThan(70)
    expect(before[1].height).toBeGreaterThan(20)
    await paper.locator('[data-flow-block-id="spacing-a"]').click()
    expect(await measure(paper)).toEqual(before)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await chat.getByLabel('本轮引用', { exact: true }).selectOption('selection')
    await chat.getByLabel('发送给创作助手').fill('解释当前选择的文字')
    await expect(chat.getByLabel('本轮引用摘要')).not.toContainText('未选择对象')
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    if (diagnoseFlowLayout) await captureFlowLayout(paper, 'editor-after-chat-close')
    await paper.locator('[data-flow-block-id="spacing-a"]').dblclick()
    await page.getByTestId('flow-inline-editor').fill('第一行\n\n第三行')
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const runtime = page.locator('.flow-runtime-reading')
    await expect(runtime).toBeVisible()
    expect(await runtime.locator('[data-flow-block-id="spacing-list"] li').first().evaluate(element => getComputedStyle(element).display)).toBe('list-item')
    const hostBounds = await page.locator('.flow-surface-host').boundingBox()
    const tocBounds = await page.getByTestId('flow-runtime-toc-toggle').boundingBox()
    expect(tocBounds!.x).toBeCloseTo(hostBounds!.x, 0)
    const running = await measure(runtime)
    const screenRunning = await runtime.locator('[data-flow-block-id="spacing-a"]').boundingBox()
    if (diagnoseFlowLayout) await captureFlowLayout(runtime, 'current-position-runtime')
    try {
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(screenRunning![key], `screen ${key}`).toBeCloseTo(screenBefore![key], 0)
      for (let i = 0; i < before.length; i++) for (const key of ['x', 'y', 'width', 'height'] as const) expect(running[i][key], `${before[i].id}.${key}`).toBeCloseTo(before[i][key], 0)
    } catch (error) {
      if (diagnoseFlowLayout) {
        flowLayoutEvidence.push({ phase: 'comparison-failed', screenBefore, screenRunning, before, running })
        writeFileSync(test.info().outputPath('flow-edit-run-geometry.json'), JSON.stringify(flowLayoutEvidence, null, 2))
        await page.screenshot({ path: test.info().outputPath('flow-edit-run-geometry-failure.png') })
      }
      throw error
    }
    const evidence = join(root, 'output', 'playwright', 'r18-flow-spacing')
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'run.png') })
    await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.screenshot({ path: join(evidence, 'edit.png') })
    const saved = await saveCurrent(page, filename)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await openFlow(page)
    expect(await measure(page.getByTestId('flow-paper'))).toEqual(before)
    const sources = { project: saved, assetFiles: {}, components: {} }
    const offlineProject = { ...saved, startLocationId: created.activatedLocationId, locations: [...saved.locations.filter(location => location.id === created.activatedLocationId), ...saved.locations.filter(location => location.id !== created.activatedLocationId)] }
    const html = buildPublishedCourseStandaloneHtml({ ...sources, project: offlineProject }, readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'))
    const htmlPath = join(evidence, 'flow.html'); writeFileSync(htmlPath, html)
    browser = await chromium.launch({ headless: true })
    const offline = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await offline.goto(pathToFileURL(htmlPath).href)
    await expect(offline.locator('.flow-runtime-reading')).toBeVisible()
    const published = await measure(offline.locator('.flow-runtime-reading'))
    for (let i = 0; i < before.length; i++) for (const key of ['x', 'y', 'width', 'height'] as const) expect(published[i][key], `offline ${before[i].id}.${key}`).toBeCloseTo(before[i][key], 0)
    await offline.screenshot({ path: join(evidence, 'offline.png') })
    writeFileSync(join(evidence, 'geometry.json'), JSON.stringify({ before, running, published }, null, 2))
    expect(launch.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
    await server.close()
  }
})
