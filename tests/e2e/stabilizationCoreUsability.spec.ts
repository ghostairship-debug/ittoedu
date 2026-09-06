import {
  existsSync,
  mkdtempSync,
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
import { pptxImportFixture } from '../fixtures/pptxImport'
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
import { teacherControllerAuthoringRecoveryBounds } from '../../src/shared/teacherControllerLayout'
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

type TeacherControllerItem = NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'teacher-controller' }>
}

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

async function launchEditor(): Promise<LaunchedEditor> {
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
        VITE_DEV_SERVER_URL: '',
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
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
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
    entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
  ))?.item
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') {
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
    await page.screenshot({ path: 'output/playwright/r13-review/r14-builder-v2-flow.png' })
    await paintedClick(page.getByRole('button', { name: '下一场景', exact: true }))
    await expect(page.getByText('4 / 5 · 分数关系图 · 全景', { exact: true })).toBeVisible()
    await paintedClick(page.getByRole('button', { name: '下一场景', exact: true }))
    await expect(page.getByText('5 / 5 · 分数关系图 · 观察二分之一', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'output/playwright/r13-review/r14-builder-v2-spatial.png' })
    expect(pageErrors).toEqual([])
  } finally {
    await browser?.close()
    removeRunRoot(runRoot)
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
    expect(result.distantComponentPreserved).toBe(true)
    expect(result.commits).toBe(5)
    expect(result.packageVersion).toBe('1.0.1')
    expect(result.leakedRoots).toBe(0)
  } finally {
    await browser.close()
    await server.close()
  }
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
    const fallback = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==', 'base64'))
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
    await paragraph.dblclick()
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
      const recovery = teacherControllerAuthoringRecoveryBounds(
        clampedController.content.data,
        clampedController.frame,
        clampedController.rotation,
      )
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
      await page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
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
