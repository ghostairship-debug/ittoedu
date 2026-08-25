import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  SpatialSurfaceDocument,
} from '../../src/shared/courseProjectTypes'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
const SPATIAL_MOVE_REASON =
  '空间画布中的全课图层固定在视口，本页和世界图层跟随画布；当前不能跨这两种定位移动。'
const SPATIAL_MOVE_ALERT = '操作未完成。请重新选择目标后再试。'
const SPATIAL_GLOBAL_INSERTION_REASON =
  '文本：无限画布全局层暂不支持插入；请切换到无限画布世界层'

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

type ControllerKind = 'slide' | 'flow' | 'spatial'

type TeacherControllerItem = NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'teacher-controller' }>
}

function removeRunRoot(runRoot: string): void {
  const absolute = resolve(runRoot)
  const temporaryRoot = resolve(tmpdir())
  const scoped = relative(temporaryRoot, absolute)
  const leaf = scoped.split(/[\\/]/)[0] ?? ''
  if (
    !scoped
    || scoped === '..'
    || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(scoped)
    || !leaf.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-wave-b-`)
  ) {
    throw new Error(`Refusing to remove an unscoped Wave B directory: ${absolute}`)
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
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-wave-b-${process.pid}-`),
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
  projectPath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async (): Promise<Electron.SaveDialogReturnValue> => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, projectPath)
}

function readProject(projectPath: string): CourseProjectDocument {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
}

async function saveAs(
  app: ElectronApplication,
  page: Page,
  projectPath: string,
): Promise<CourseProjectDocument> {
  await patchProjectDialogs(app, projectPath)
  await page.getByRole('button', { name: '另存为' }).click()
  await expect.poll(
    () => existsSync(projectPath) ? statSync(projectPath).size : 0,
    { timeout: 15_000 },
  ).toBeGreaterThan(100)
  return readProject(projectPath)
}

async function saveCurrent(page: Page, projectPath: string): Promise<CourseProjectDocument> {
  const previousMtime = statSync(projectPath).mtimeMs
  const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）' })
  await page.waitForTimeout(25)
  await saveButton.click()
  await expect.poll(() => statSync(projectPath).mtimeMs, { timeout: 15_000 })
    .toBeGreaterThan(previousMtime)
  await expect(saveButton).toBeEnabled()
  return readProject(projectPath)
}

function courseTreeKind(page: Page, kind: string): Locator {
  return page.getByTestId('course-page-tree').locator(`[data-kind="${kind}"]`)
}

async function addSurface(page: Page, kind: 'flow' | 'spatial'): Promise<void> {
  await page.getByTitle('新增其他类型页面').click()
  await expect(page.getByTestId('add-content-menu')).toBeVisible()
  await page.getByTestId(`add-${kind}-page`).click()
}

async function openSlide(page: Page): Promise<void> {
  await courseTreeKind(page, 'slide-scene').first()
    .locator('button.course-page-tree__label').first().click()
  await expect(page.locator('[data-testid="canvas-stage"] canvas')).toBeVisible()
}

async function openSpatial(page: Page): Promise<void> {
  await courseTreeKind(page, 'spatial-camera').first()
    .locator('button.course-page-tree__label').first().click()
  await expect(page.getByTestId('spatial-workspace')).toBeVisible()
}

function teacherControllerRows(page: Page): Locator {
  return page.getByTestId('nodes-tab').locator('.node-item').filter({
    has: page.locator('.node-type-icon[title="teacher-controller"]'),
  })
}

function nodeRow(page: Page, layerItemId: string): Locator {
  return page.getByTestId(`node-item-${layerItemId}`)
}

async function renameSelectedNode(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const selected = page.locator('.node-item--selected')
  await expect(selected).toHaveCount(1)
  await selected.locator('.node-name').dblclick()
  const input = selected.locator('.node-name-input')
  await input.fill(name)
  await input.press('Enter')
  await expect(selected.locator('.node-name')).toHaveText(name)
}

async function renameLayer(page: Page, layerItemId: string, name: string): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const row = nodeRow(page, layerItemId)
  await row.locator('.node-name').dblclick()
  const input = row.locator('.node-name-input')
  await input.fill(name)
  await input.press('Enter')
  await expect(row.locator('.node-name')).toHaveText(name)
}

async function selectLayer(page: Page, layerItemId: string): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  await nodeRow(page, layerItemId).locator('.node-name').click()
  await expect(page.getByRole('tab', { name: '属性' }))
    .toHaveAttribute('aria-selected', 'true')
}

function teacherController(project: CourseProjectDocument): TeacherControllerItem {
  const item = project.globalLayerItems.find((entry) => (
    entry.item.kind === 'native'
    && entry.item.content.nativeType === 'teacher-controller'
  ))?.item
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') {
    throw new Error('Saved project is missing its global teacher controller')
  }
  return item as TeacherControllerItem
}

function spatialSurface(project: CourseProjectDocument): SpatialSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'spatial-2d')
  if (!surface || surface.type !== 'spatial-2d') {
    throw new Error('Saved project is missing its Spatial surface')
  }
  return surface
}

function textLabel(item: LayerItem): string | null {
  return item.kind === 'native' && item.content.nativeType === 'text'
    ? item.label
    : null
}

function requireGlobalText(project: CourseProjectDocument, label: string): LayerItem {
  const item = project.globalLayerItems.find((entry) => textLabel(entry.item) === label)?.item
  if (!item) throw new Error(`Global text is missing: ${label}`)
  return item
}

function requireGlobalEntry(
  project: CourseProjectDocument,
  layerItemId: string,
): CourseProjectDocument['globalLayerItems'][number] {
  const entry = project.globalLayerItems.find((candidate) => (
    candidate.item.layerItemId === layerItemId
  ))
  if (!entry) throw new Error(`Global layer item is missing: ${layerItemId}`)
  return entry
}

function createdGlobalEntries(
  before: CourseProjectDocument,
  after: CourseProjectDocument,
): CourseProjectDocument['globalLayerItems'] {
  const beforeIds = new Set(before.globalLayerItems.map((entry) => entry.item.layerItemId))
  return after.globalLayerItems.filter((entry) => !beforeIds.has(entry.item.layerItemId))
}

function requireWorldText(project: CourseProjectDocument, label: string): LayerItem {
  const item = spatialSurface(project).world.layerItems.find((candidate) => (
    textLabel(candidate) === label
  ))
  if (!item) throw new Error(`Spatial world text is missing: ${label}`)
  return item
}

function requireWorldItem(project: CourseProjectDocument, layerItemId: string): LayerItem {
  const item = spatialSurface(project).world.layerItems.find((candidate) => (
    candidate.layerItemId === layerItemId
  ))
  if (!item) throw new Error(`Spatial world item is missing: ${layerItemId}`)
  return item
}

function createdWorldItems(
  before: CourseProjectDocument,
  after: CourseProjectDocument,
): LayerItem[] {
  const beforeIds = new Set(spatialSurface(before).world.layerItems.map((item) => item.layerItemId))
  return spatialSurface(after).world.layerItems.filter((item) => !beforeIds.has(item.layerItemId))
}

function previewSurface(host: Locator, kind: ControllerKind): Locator {
  const selector = kind === 'slide'
    ? '.slide-published-adapter'
    : kind === 'flow'
      ? '.flow-surface-host'
      : '.spatial-surface'
  return host.locator(selector).first()
}

function previewControllerFrame(surface: Locator, kind: ControllerKind): Locator {
  if (kind === 'slide') {
    return surface.locator('[data-global-layer-item]:has(.slide-native-teacher-controller)').first()
  }
  if (kind === 'flow') return surface.getByTestId('flow-runtime-teacher-controller')
  return surface.locator('.spatial-screen-teacher-controller').first()
}

async function navigatePreviewSurface(
  page: Page,
  host: Locator,
  kind: ControllerKind,
  direction: 'next' | 'previous' = 'next',
): Promise<Locator> {
  await page.getByTestId(`course-preview-${direction}`).click()
  const surface = previewSurface(host, kind)
  await expect(surface).toBeVisible()
  return surface
}

async function expectDesignStage(surface: Locator): Promise<void> {
  await expect(surface).toBeVisible()
  expect(await surface.evaluate((element) => ({
    width: Number.parseFloat((element as HTMLElement).style.width),
    height: Number.parseFloat((element as HTMLElement).style.height),
  }))).toEqual({ width: 1280, height: 720 })
}

async function controllerPosition(frame: Locator): Promise<{ left: number; top: number }> {
  return frame.evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    top: Number.parseFloat((element as HTMLElement).style.top),
  }))
}

async function controllerRoot(frame: Locator): Promise<Locator> {
  const rootLocator = frame.locator('.slide-native-teacher-controller')
  await expect(rootLocator).toBeVisible()
  return rootLocator
}

async function clickControllerButton(page: Page, button: Locator): Promise<void> {
  const bounds = await button.boundingBox()
  if (!bounds) throw new Error('Teacher controller button has no visible bounds')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

/** Leaves the controller expanded after proving both halves of the hit contract. */
async function expectCollapsedFootprint(page: Page, frame: Locator): Promise<void> {
  const rootLocator = await controllerRoot(frame)
  const pill = rootLocator.getByRole('button', { name: '展开教师控制器' })
  await expect(pill).toBeVisible()
  const collapsedProof = await frame.evaluate((element) => {
    const wrapper = element as HTMLElement
    const button = wrapper.querySelector<HTMLElement>(
      '[data-teacher-controller-collapse="true"]',
    )
    if (!button) throw new Error('Collapsed controller has no recovery pill')
    const frameRect = wrapper.getBoundingClientRect()
    const pillRect = button.getBoundingClientRect()
    const formerPanel = {
      x: frameRect.left + Math.max(2, Math.min(frameRect.width * 0.12, frameRect.width - 2)),
      y: frameRect.top + frameRect.height / 2,
    }
    const pillCenter = {
      x: pillRect.left + pillRect.width / 2,
      y: pillRect.top + pillRect.height / 2,
    }
    const formerHit = wrapper.ownerDocument.elementFromPoint(formerPanel.x, formerPanel.y)
    const pillHit = wrapper.ownerDocument.elementFromPoint(pillCenter.x, pillCenter.y)
    return {
      formerPanel,
      pillCenter,
      formerInside: Boolean(formerHit && wrapper.contains(formerHit)),
      pillInside: Boolean(pillHit && wrapper.contains(pillHit)),
    }
  })
  expect(collapsedProof.formerInside).toBe(false)
  expect(collapsedProof.pillInside).toBe(true)

  await page.mouse.click(collapsedProof.pillCenter.x, collapsedProof.pillCenter.y)
  await expect(rootLocator.getByRole('button', { name: '收起教师控制器' })).toBeVisible()
  expect(await frame.evaluate((element, point) => {
    const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
    return Boolean(hit && element.contains(hit))
  }, collapsedProof.formerPanel)).toBe(true)
}

async function collapseController(page: Page, frame: Locator): Promise<void> {
  const rootLocator = await controllerRoot(frame)
  await clickControllerButton(
    page,
    rootLocator.getByRole('button', { name: '收起教师控制器' }),
  )
  await expect(rootLocator.getByRole('button', { name: '展开教师控制器' })).toBeVisible()
}

async function moveController(
  frame: Locator,
  key: 'ArrowLeft' | 'ArrowRight',
): Promise<{ left: number; top: number }> {
  const rootLocator = await controllerRoot(frame)
  await rootLocator.focus()
  await rootLocator.press(`Alt+${key}`)
  return controllerPosition(frame)
}

async function flowLayoutMetrics(surface: Locator): Promise<{
  articleMarginLeft: number
  overlayLeft: number
  controllerInlineLeft: number
  controllerInlineTop: number
  controllerRelativeLeft: number
  controllerRelativeTop: number
  pillInside: boolean
  pillHitInside: boolean
  tocToggleInside: boolean
}> {
  return surface.evaluate((element) => {
    const article = element.querySelector<HTMLElement>('.flow-runtime-article')
    const overlay = element.querySelector<HTMLElement>('.flow-runtime-overlay')
    const controller = element.querySelector<HTMLElement>(
      '[data-testid="flow-runtime-teacher-controller"]',
    )
    const pill = controller?.querySelector<HTMLElement>(
      '[data-teacher-controller-collapse="true"]',
    )
    const toggle = element.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-toggle"]')
    if (!article || !overlay || !controller || !pill || !toggle) {
      throw new Error('Flow runtime chrome is incomplete')
    }
    const hostRect = element.getBoundingClientRect()
    const controllerRect = controller.getBoundingClientRect()
    const pillRect = pill.getBoundingClientRect()
    const toggleRect = toggle.getBoundingClientRect()
    const pillHit = element.ownerDocument.elementFromPoint(
      pillRect.left + pillRect.width / 2,
      pillRect.top + pillRect.height / 2,
    )
    return {
      articleMarginLeft: Number.parseFloat(article.style.marginLeft || '0'),
      overlayLeft: Number.parseFloat(overlay.style.left || '0'),
      controllerInlineLeft: Number.parseFloat(controller.style.left),
      controllerInlineTop: Number.parseFloat(controller.style.top),
      controllerRelativeLeft: controllerRect.left - hostRect.left,
      controllerRelativeTop: controllerRect.top - hostRect.top,
      pillInside: pillRect.left >= hostRect.left - 0.5
        && pillRect.top >= hostRect.top - 0.5
        && pillRect.right <= hostRect.right + 0.5
        && pillRect.bottom <= hostRect.bottom + 0.5,
      pillHitInside: Boolean(pillHit && controller.contains(pillHit)),
      tocToggleInside: toggleRect.left >= hostRect.left - 0.5
        && toggleRect.top >= hostRect.top - 0.5
        && toggleRect.right <= hostRect.right + 0.5
        && toggleRect.bottom <= hostRect.bottom + 0.5,
    }
  })
}

async function exerciseFlowTocWithoutDrift(
  page: Page,
  surface: Locator,
  frame: Locator,
): Promise<void> {
  const rootLocator = await controllerRoot(frame)
  const recoveryPill = rootLocator.getByRole('button', { name: '展开教师控制器' })
  await expect(recoveryPill).toBeVisible()
  const toggle = surface.getByTestId('flow-runtime-toc-toggle')
  await expect(toggle).toHaveAttribute('aria-label', '打开目录')
  const baseline = await flowLayoutMetrics(surface)
  expect(baseline).toMatchObject({
    articleMarginLeft: 0,
    overlayLeft: 0,
    pillInside: true,
    pillHitInside: true,
    tocToggleInside: true,
  })
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const open = await flowLayoutMetrics(surface)
    expect(open.articleMarginLeft).toBe(260)
    expect(open.overlayLeft).toBe(0)
    expect(open.pillInside).toBe(true)
    expect(open.pillHitInside).toBe(true)
    expect(open.tocToggleInside).toBe(true)
    expect(open.controllerInlineLeft).toBe(baseline.controllerInlineLeft)
    expect(open.controllerInlineTop).toBe(baseline.controllerInlineTop)
    expect(Math.abs(open.controllerRelativeLeft - baseline.controllerRelativeLeft))
      .toBeLessThanOrEqual(0.5)
    expect(Math.abs(open.controllerRelativeTop - baseline.controllerRelativeTop))
      .toBeLessThanOrEqual(0.5)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const closed = await flowLayoutMetrics(surface)
    expect(closed.articleMarginLeft).toBe(0)
    expect(closed.overlayLeft).toBe(0)
    expect(closed.pillInside).toBe(true)
    expect(closed.pillHitInside).toBe(true)
    expect(closed.tocToggleInside).toBe(true)
    expect(closed.controllerInlineLeft).toBe(baseline.controllerInlineLeft)
    expect(closed.controllerInlineTop).toBe(baseline.controllerInlineTop)
    expect(Math.abs(closed.controllerRelativeLeft - baseline.controllerRelativeLeft))
      .toBeLessThanOrEqual(0.5)
    expect(Math.abs(closed.controllerRelativeTop - baseline.controllerRelativeTop))
      .toBeLessThanOrEqual(0.5)
  }
  await clickControllerButton(page, recoveryPill)
  await expect(rootLocator.getByRole('button', { name: '收起教师控制器' })).toBeVisible()
}

async function dragLayerRow(page: Page, fromId: string, toId: string): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const from = nodeRow(page, fromId)
  const to = nodeRow(page, toId)
  const handle = from.getByRole('button', { name: /调整.+层级/ })
  const handleBounds = await handle.boundingBox()
  const targetBounds = await to.boundingBox()
  if (!handleBounds || !targetBounds) throw new Error('Layer drag rows are not visible')
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2,
    { steps: 12 },
  )
  await page.mouse.up()
}

async function expectWorldLayerRows(
  page: Page,
  count: number,
  visibleId?: string,
): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const group = page.getByTestId('nodes-layer-group-world')
  await expect(group.locator('.node-item')).toHaveCount(count)
  if (visibleId) await expect(nodeRow(page, visibleId)).toBeVisible()
}

async function expectOnlySelectedLayer(page: Page, layerItemId: string): Promise<void> {
  const selected = page.getByTestId('nodes-tab').locator('.node-item--selected')
  await expect(selected).toHaveCount(1)
  await expect(nodeRow(page, layerItemId)).toHaveClass(/node-item--selected/)
}

async function visibleWorldLayerIds(page: Page): Promise<string[]> {
  await page.getByRole('tab', { name: '图层' }).click()
  return page.getByTestId('nodes-layer-group-world').locator('.node-item')
    .evaluateAll((rows) => rows.map((row) => (
      (row as HTMLElement).dataset.testid?.replace(/^node-item-/, '') ?? ''
    )))
}

async function expectOneUndoRedoStep(
  page: Page,
  projectPath: string,
  before: CourseProjectDocument,
  after: CourseProjectDocument,
): Promise<void> {
  await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
  expect(await saveCurrent(page, projectPath)).toEqual(before)
  await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
  expect(await saveCurrent(page, projectPath)).toEqual(after)
}

async function blankSpatialPoint(stage: Locator): Promise<{ x: number; y: number }> {
  return stage.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const blockers = [...element.querySelectorAll<HTMLElement>(
      '.spatial-world-item, .spatial-selection-overlay, .teacher-controller-overlay',
    )].map((candidate) => candidate.getBoundingClientRect())
    for (const yRatio of [0.15, 0.82, 0.5]) {
      for (const xRatio of [0.12, 0.86, 0.5]) {
        const point = {
          x: rect.left + rect.width * xRatio,
          y: rect.top + rect.height * yRatio,
        }
        if (blockers.some((blocker) => (
          point.x >= blocker.left
          && point.x <= blocker.right
          && point.y >= blocker.top
          && point.y <= blocker.bottom
        ))) continue
        const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
        if (!hit || !element.contains(hit)) continue
        if (hit.closest(
          '.spatial-world-item, .spatial-selection-overlay, .teacher-controller-overlay, button',
        )) continue
        return point
      }
    }
    throw new Error('Cannot find a blank Spatial pan point')
  })
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

test('Wave B ownership and controller contracts survive one real Mixed session', async () => {
  test.setTimeout(240_000)
  const launch = await launchEditor()
  const projectPath = join(launch.runRoot, 'wave-b-ownership-controller.h5lesson')
  const { app, page } = launch
  let globalTextId = ''
  let worldTextAId = ''
  let worldTextBId = ''
  let safeReorderProject: CourseProjectDocument | null = null
  try {
    await test.step('Player controller is viewport-safe and Session-only across three surfaces', async () => {
      await expect(courseTreeKind(page, 'slide-scene')).toHaveCount(1)
      await addSurface(page, 'flow')
      await expect(page.getByTestId('flow-workspace')).toBeVisible()
      await addSurface(page, 'spatial')
      await expect(page.getByTestId('spatial-workspace')).toBeVisible()
      await expect(courseTreeKind(page, 'flow-page')).toHaveCount(1)
      await expect(courseTreeKind(page, 'spatial-camera')).toHaveCount(1)

      await openSlide(page)
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-text').click()
      await renameSelectedNode(page, '全局文字标记')

      await page.getByRole('tab', { name: '图层' }).click()
      await teacherControllerRows(page).locator('.node-name').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByLabel('打开课件时默认折叠')).toBeChecked()
      const restartVisible = page.getByLabel('重新开始显示')
      const beforeRestart = await saveAs(app, page, projectPath)
      globalTextId = requireGlobalText(beforeRestart, '全局文字标记').layerItemId
      await expect(restartVisible).not.toBeChecked()
      await restartVisible.check()
      await expect(restartVisible).toBeChecked()
      const baseline = await saveCurrent(page, projectPath)
      await expect.poll(() => page.title()).not.toMatch(/ \* - /)
      const cleanEditorTitle = await page.title()
      const controller = teacherController(baseline)
      const authored = { left: controller.frame.x, top: controller.frame.y }
      const baselineArchiveBytes = readFileSync(projectPath)

      await openSlide(page)
      const undoBeforePreview = await page.getByRole('button', { name: '撤销（Ctrl+Z）' })
        .isEnabled()
      const redoBeforePreview = await page.getByRole('button', {
        name: '重做（Ctrl+Y / Ctrl+Shift+Z）',
      }).isEnabled()

      await page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
      const preview = page.getByTestId('course-preview-overlay')
      const host = page.getByTestId('course-preview-host')
      await expect(preview).toContainText('Published Course V2 · CoursePlayer · 1280 × 720')
      await expectBackgroundWindowsIsolated(app, true)

      const slide = previewSurface(host, 'slide')
      await expect(slide).toBeVisible()
      await expectDesignStage(slide)
      const slideFrame = previewControllerFrame(slide, 'slide')
      await expect(controllerPosition(slideFrame)).resolves.toEqual(authored)
      await expectCollapsedFootprint(page, slideFrame)
      expect(await moveController(slideFrame, 'ArrowRight')).toEqual({
        left: authored.left + 8,
        top: authored.top,
      })

      const flow = await navigatePreviewSurface(page, host, 'flow')
      await expectDesignStage(flow)
      const flowFrame = previewControllerFrame(flow, 'flow')
      await expect((await controllerRoot(flowFrame)).getByRole('button', {
        name: '收起教师控制器',
      })).toBeVisible()
      expect(await controllerPosition(flowFrame)).toEqual(authored)
      await collapseController(page, flowFrame)
      await expectCollapsedFootprint(page, flowFrame)
      await collapseController(page, flowFrame)
      await exerciseFlowTocWithoutDrift(page, flow, flowFrame)
      await moveController(flowFrame, 'ArrowRight')
      expect(await moveController(flowFrame, 'ArrowRight')).toEqual({
        left: authored.left + 16,
        top: authored.top,
      })

      const spatial = await navigatePreviewSurface(page, host, 'spatial')
      await expectDesignStage(spatial)
      const spatialFrame = previewControllerFrame(spatial, 'spatial')
      await expect((await controllerRoot(spatialFrame)).getByRole('button', {
        name: '收起教师控制器',
      })).toBeVisible()
      expect(await controllerPosition(spatialFrame)).toEqual(authored)
      await collapseController(page, spatialFrame)
      await expectCollapsedFootprint(page, spatialFrame)
      expect(await moveController(spatialFrame, 'ArrowLeft')).toEqual({
        left: authored.left - 8,
        top: authored.top,
      })

      await navigatePreviewSurface(page, host, 'flow', 'previous')
      const revisitedSlide = await navigatePreviewSurface(page, host, 'slide', 'previous')
      expect(await controllerPosition(previewControllerFrame(revisitedSlide, 'slide'))).toEqual({
        left: authored.left + 8,
        top: authored.top,
      })
      const revisitedFlow = await navigatePreviewSurface(page, host, 'flow')
      expect(await controllerPosition(previewControllerFrame(revisitedFlow, 'flow'))).toEqual({
        left: authored.left + 16,
        top: authored.top,
      })
      const revisitedSpatial = await navigatePreviewSurface(page, host, 'spatial')
      const revisitedSpatialFrame = previewControllerFrame(revisitedSpatial, 'spatial')
      expect(await controllerPosition(revisitedSpatialFrame)).toEqual({
        left: authored.left - 8,
        top: authored.top,
      })
      const restart = (await controllerRoot(revisitedSpatialFrame))
        .getByRole('button', { name: '重新开始', exact: true })
      await clickControllerButton(page, restart)

      const restartedSlide = previewSurface(host, 'slide')
      await expect(restartedSlide).toBeVisible()
      const restartedSlideFrame = previewControllerFrame(restartedSlide, 'slide')
      await expect((await controllerRoot(restartedSlideFrame)).getByRole('button', {
        name: '展开教师控制器',
      })).toBeVisible()
      expect(await controllerPosition(restartedSlideFrame)).toEqual(authored)
      const restartedFlow = await navigatePreviewSurface(page, host, 'flow')
      const restartedFlowFrame = previewControllerFrame(restartedFlow, 'flow')
      await expect((await controllerRoot(restartedFlowFrame)).getByRole('button', {
        name: '展开教师控制器',
      })).toBeVisible()
      expect(await controllerPosition(restartedFlowFrame)).toEqual(authored)
      const restartedSpatial = await navigatePreviewSurface(page, host, 'spatial')
      const restartedSpatialFrame = previewControllerFrame(restartedSpatial, 'spatial')
      await expect((await controllerRoot(restartedSpatialFrame)).getByRole('button', {
        name: '展开教师控制器',
      })).toBeVisible()
      expect(await controllerPosition(restartedSpatialFrame)).toEqual(authored)

      await preview.getByRole('button', { name: '关闭预览' }).click()
      await expect(preview).toHaveCount(0)
      await expect.poll(() => page.title()).toBe(cleanEditorTitle)
      expect(Buffer.compare(readFileSync(projectPath), baselineArchiveBytes)).toBe(0)
      expect(await saveCurrent(page, projectPath)).toEqual(baseline)
      expect(await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).isEnabled())
        .toBe(undoBeforePreview)
      expect(await page.getByRole('button', {
        name: '重做（Ctrl+Y / Ctrl+Shift+Z）',
      }).isEnabled()).toBe(redoBeforePreview)

      // The first editor undo must still be the last authored checkbox update;
      // a Player-only history frame would make this exact comparison fail.
      await expectOneUndoRedoStep(page, projectPath, beforeRestart, baseline)
    })

    await test.step('Spatial commands preserve canonical owners and reject cross-coordinate drops', async () => {
      await openSpatial(page)
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      const disabledGlobalText = page.getByTestId('add-text')
      await expect(disabledGlobalText).toBeDisabled()
      await expect(disabledGlobalText).toHaveAttribute('title', SPATIAL_GLOBAL_INSERTION_REASON)
      await expect(page.getByTestId('surface-insertion-hint')).toContainText(
        '无限画布全局层暂不支持插入元素；请切换到无限画布世界层。',
      )

      // There is intentionally no public Spatial surface-scope insertion entry.
      // Surface-owner selection remains covered by its focused dependency; this
      // gate exercises only honest reachable entries rather than seeding symmetry.
      await openSpatial(page)
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await expect(page.getByTestId('add-text')).toBeEnabled()
      await page.getByTestId('add-text').click()
      await renameSelectedNode(page, '世界文字 A')
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-text').click()
      await renameSelectedNode(page, '世界文字 B')

      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.getByTestId('nodes-layer-group-global')).toContainText('全局文字标记')
      await expect(page.getByTestId('nodes-layer-group-world')).toContainText('世界文字 A')
      await expect(page.getByTestId('nodes-layer-group-world')).toContainText('世界文字 B')
      const ownerBaseline = await saveCurrent(page, projectPath)
      worldTextAId = requireWorldText(ownerBaseline, '世界文字 A').layerItemId
      worldTextBId = requireWorldText(ownerBaseline, '世界文字 B').layerItemId
      expect(requireGlobalText(ownerBaseline, '全局文字标记').layerItemId).toBe(globalTextId)

      await selectLayer(page, globalTextId)
      await expect(page.getByLabel('名称', { exact: true })).toHaveValue('全局文字标记')
      await selectLayer(page, worldTextAId)
      const worldName = page.getByLabel('名称', { exact: true })
      await expect(worldName).toHaveValue('世界文字 A')
      const propertyWrittenName = '世界文字 A（属性写入）'
      await worldName.fill(propertyWrittenName)
      await worldName.press('Enter')
      await expect(worldName).toHaveValue(propertyWrittenName)
      const afterPropertyWrite = await saveCurrent(page, projectPath)
      expect(afterPropertyWrite.revision).toBe(ownerBaseline.revision + 1)
      expect(requireWorldItem(afterPropertyWrite, worldTextAId)).toEqual({
        ...requireWorldItem(ownerBaseline, worldTextAId),
        label: propertyWrittenName,
      })
      expect(afterPropertyWrite.globalLayerItems).toEqual(ownerBaseline.globalLayerItems)
      await expectOneUndoRedoStep(page, projectPath, ownerBaseline, afterPropertyWrite)

      await selectLayer(page, worldTextAId)
      await page.keyboard.press('Control+C')
      await expect(page.locator('.status-bar')).toContainText('已复制 1 个 Spatial 图层到剪贴板')
      const afterCopy = await saveCurrent(page, projectPath)
      expect(afterCopy).toEqual(afterPropertyWrite)
      await expectOneUndoRedoStep(page, projectPath, ownerBaseline, afterPropertyWrite)

      await page.keyboard.press('Control+V')
      const afterPaste = await saveCurrent(page, projectPath)
      const pasted = createdWorldItems(afterCopy, afterPaste)
      expect(pasted).toHaveLength(1)
      expect(afterPaste.revision).toBe(afterCopy.revision + 1)
      expect(pasted[0]!.layerItemId).not.toBe(worldTextAId)
      expect(pasted[0]!.frame.x).toBe(requireWorldItem(afterCopy, worldTextAId).frame.x + 20)
      expect(pasted[0]!.frame.y).toBe(requireWorldItem(afterCopy, worldTextAId).frame.y + 20)
      expect(pasted[0]!.locked).toBe(false)
      expect(afterPaste.globalLayerItems).toEqual(afterCopy.globalLayerItems)
      await expectWorldLayerRows(page, 3, pasted[0]!.layerItemId)
      await expectOnlySelectedLayer(page, pasted[0]!.layerItemId)
      await expectOneUndoRedoStep(page, projectPath, afterCopy, afterPaste)

      const pastedId = pasted[0]!.layerItemId
      await selectLayer(page, pastedId)
      await page.keyboard.press('Control+D')
      const afterDuplicate = await saveCurrent(page, projectPath)
      const duplicated = createdWorldItems(afterPaste, afterDuplicate)
      expect(duplicated).toHaveLength(1)
      expect(afterDuplicate.revision).toBe(afterPaste.revision + 1)
      expect(duplicated[0]!.frame.x).toBe(requireWorldItem(afterPaste, pastedId).frame.x + 20)
      expect(duplicated[0]!.frame.y).toBe(requireWorldItem(afterPaste, pastedId).frame.y + 20)
      expect(duplicated[0]!.locked).toBe(false)
      expect(afterDuplicate.globalLayerItems).toEqual(afterPaste.globalLayerItems)
      await expectWorldLayerRows(page, 4, duplicated[0]!.layerItemId)
      await expectOnlySelectedLayer(page, duplicated[0]!.layerItemId)
      await expectOneUndoRedoStep(page, projectPath, afterPaste, afterDuplicate)

      await page.getByRole('tab', { name: '图层' }).click()
      await nodeRow(page, globalTextId).getByRole('button', {
        name: '复制“全局文字标记”',
        exact: true,
      }).click()
      const afterNodesDuplicate = await saveCurrent(page, projectPath)
      const nodesDuplicate = createdGlobalEntries(afterDuplicate, afterNodesDuplicate)
      expect(nodesDuplicate).toHaveLength(1)
      expect(afterNodesDuplicate.revision).toBe(afterDuplicate.revision + 1)
      const globalSource = requireGlobalEntry(afterDuplicate, globalTextId)
      const globalDuplicate = nodesDuplicate[0]!
      expect(globalDuplicate.item.layerItemId).not.toBe(globalTextId)
      expect(globalDuplicate.item.frame.x).toBe(globalSource.item.frame.x + 20)
      expect(globalDuplicate.item.frame.y).toBe(globalSource.item.frame.y + 20)
      expect(globalDuplicate.item.locked).toBe(false)
      expect(globalDuplicate.item.visible).toBe(globalSource.item.visible)
      expect(globalDuplicate.visibility).toEqual(globalSource.visibility)
      expect(spatialSurface(afterNodesDuplicate).world.layerItems)
        .toEqual(spatialSurface(afterDuplicate).world.layerItems)
      await expect(nodeRow(page, globalDuplicate.item.layerItemId)).toBeVisible()
      await expectOnlySelectedLayer(page, globalDuplicate.item.layerItemId)
      await expectOneUndoRedoStep(page, projectPath, afterDuplicate, afterNodesDuplicate)

      await dragLayerRow(page, worldTextAId, globalTextId)
      await expect(page.getByRole('alert')).toHaveText(SPATIAL_MOVE_ALERT)
      await expect(page.getByTestId('spatial-layer-move-note')).toContainText(SPATIAL_MOVE_REASON)
      const afterRejectedDrop = await saveCurrent(page, projectPath)
      expect(afterRejectedDrop).toEqual(afterNodesDuplicate)
      await page.getByRole('button', { name: '关闭错误提示' }).click()
      await expectOneUndoRedoStep(page, projectPath, afterDuplicate, afterNodesDuplicate)

      const beforeOrder = spatialSurface(afterNodesDuplicate).world.layerItems
        .map((item) => item.layerItemId)
      await dragLayerRow(page, worldTextAId, worldTextBId)
      const afterSafeDrop = await saveCurrent(page, projectPath)
      const afterOrder = spatialSurface(afterSafeDrop).world.layerItems
        .map((item) => item.layerItemId)
      expect(afterSafeDrop.revision).toBe(afterNodesDuplicate.revision + 1)
      expect(afterOrder).not.toEqual(beforeOrder)
      expect(new Set(afterOrder)).toEqual(new Set(beforeOrder))
      const expectedVisualOrder = [...spatialSurface(afterSafeDrop).world.layerItems]
        .sort((left, right) => right.order - left.order)
        .map((item) => item.layerItemId)
      expect(await visibleWorldLayerIds(page)).toEqual(expectedVisualOrder)
      await expectOneUndoRedoStep(page, projectPath, afterNodesDuplicate, afterSafeDrop)
      safeReorderProject = afterSafeDrop
    })

    await test.step('cross-surface history remains canonical while Spatial camera stays Session-only', async () => {
      if (!safeReorderProject) throw new Error('Spatial owner step did not produce its baseline')
      await openSpatial(page)
      await renameLayer(page, worldTextAId, '跨页历史文字')
      const afterSpatialEdit = await saveCurrent(page, projectPath)
      expect(afterSpatialEdit.revision).toBe(safeReorderProject.revision + 1)
      expect(requireWorldItem(afterSpatialEdit, worldTextAId).label).toBe('跨页历史文字')

      await openSlide(page)
      await openSpatial(page)
      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      expect(await saveCurrent(page, projectPath)).toEqual(safeReorderProject)
      await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
      expect(await saveCurrent(page, projectPath)).toEqual(afterSpatialEdit)

      const archiveBeforeCamera = readFileSync(projectPath)
      const undoBeforeCamera = await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).isEnabled()
      const redoBeforeCamera = await page.getByRole('button', {
        name: '重做（Ctrl+Y / Ctrl+Shift+Z）',
      }).isEnabled()
      const stage = page.getByTestId('spatial-world-stage')
      const worldLayer = page.getByTestId('spatial-world-layer')
      const item = page.locator(`[data-layer-id="${worldTextAId}"]`)
      const geometryBefore = await item.boundingBox()
      if (!geometryBefore) throw new Error('Spatial world item is not visible before camera movement')
      const worldLayerBefore = await worldLayer.evaluate((element) => ({
        left: (element as HTMLElement).style.left,
        top: (element as HTMLElement).style.top,
        transform: (element as HTMLElement).style.transform,
      }))

      await page.getByRole('button', { name: '放大画布' }).click()
      await expect(page.getByRole('group', { name: '画布视图' })
        .getByLabel('画布缩放比例')).toHaveText('110%')
      const panStart = await blankSpatialPoint(stage)
      await page.mouse.move(panStart.x, panStart.y)
      await page.mouse.down()
      await page.mouse.move(panStart.x + 72, panStart.y + 48, { steps: 12 })
      await page.mouse.up()
      const geometryAfter = await item.boundingBox()
      if (!geometryAfter) throw new Error('Spatial world item is not visible after camera movement')
      const worldLayerAfter = await worldLayer.evaluate((element) => ({
        left: (element as HTMLElement).style.left,
        top: (element as HTMLElement).style.top,
        transform: (element as HTMLElement).style.transform,
      }))
      expect(worldLayerAfter).not.toEqual(worldLayerBefore)
      expect(geometryAfter).not.toEqual(geometryBefore)

      expect(Buffer.compare(readFileSync(projectPath), archiveBeforeCamera)).toBe(0)
      expect(await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).isEnabled())
        .toBe(undoBeforeCamera)
      expect(await page.getByRole('button', {
        name: '重做（Ctrl+Y / Ctrl+Shift+Z）',
      }).isEnabled()).toBe(redoBeforeCamera)
      expect(await saveCurrent(page, projectPath)).toEqual(afterSpatialEdit)

      // The next undo is still the prior Spatial rename, proving zoom and pan
      // did not append hidden document/history entries.
      await expectOneUndoRedoStep(page, projectPath, safeReorderProject, afterSpatialEdit)
    })

    expectCleanDiagnostics(launch)
  } finally {
    await closeEditor(app, launch.runRoot)
  }
})
