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
import { pathToFileURL } from 'node:url'
import { _electron as electron, chromium, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '../../src/shared/courseProjectTypes'
import {
  APP_E2E_TEMP_DIRECTORY_NAME,
} from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const root = resolve(__dirname, '..', '..')
const evidenceRoot = join(root, 'output', 'playwright', 'r18-076')
const projectPath = join(evidenceRoot, 'spatial-global-runtime-authoring.h5lesson')
const htmlPath = join(evidenceRoot, 'spatial-global-runtime-offline.html')
const authoringScreenshotPath = join(evidenceRoot, 'spatial-global-runtime-authoring.png')
const offlineScreenshotPath = join(evidenceRoot, 'spatial-global-runtime-offline.png')
const firstRuntimeId = 'spatial-global-api2-one'
const secondRuntimeId = 'spatial-global-api2-two'
const firstInitialTitle = '空间 Runtime 一：初始标题'
const secondInitialTitle = '空间 Runtime 二：保持不变'
const editedTitle = '空间 Runtime 一：作者已修改'

interface Diagnostics {
  pageErrors: string[]
  consoleErrors: string[]
  externalRequests: string[]
}

interface LaunchedEditor extends Diagnostics {
  app: ElectronApplication
  page: Page
  runRoot: string
}

const runtimeSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    authoringApiVersion: 1,
    create: function (ctx) {
      var carrier = ctx.content.get('carrier');
      var probe = window.__r18076SpatialRuntimeProbe || { creates: {}, destroys: {} };
      window.__r18076SpatialRuntimeProbe = probe;
      probe.creates[carrier] = (probe.creates[carrier] || 0) + 1;
      var title = document.createElement('h2');
      title.dataset.coursewareEditKey = 'title';
      title.dataset.coursewareEditLabel = carrier === 'one' ? '空间标题一' : '空间标题二';
      title.dataset.r18076Carrier = carrier;
      title.textContent = ctx.content.get('title');
      Object.assign(title.style, {
        position: 'absolute',
        left: '24px',
        top: '28px',
        width: '365px',
        height: '78px',
        boxSizing: 'border-box',
        margin: '0',
        padding: '18px 22px',
        border: carrier === 'one' ? '2px solid #38bdf8' : '2px solid #a78bfa',
        borderRadius: '14px',
        color: '#f8fafc',
        background: carrier === 'one' ? '#075985' : '#5b21b6',
        font: '600 18px Microsoft YaHei',
        lineHeight: '38px'
      });
      ctx.dom.overlay.append(title);
      return {
        destroy: function () {
          probe.destroys[carrier] = (probe.destroys[carrier] || 0) + 1;
          title.remove();
        }
      };
    }
  });
`

function createSpatialRuntimeProject(): CourseProjectDocument {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: firstRuntimeId, renderMode: 'dom', source: runtimeSource },
    { itemId: secondRuntimeId, renderMode: 'dom', source: runtimeSource },
  ], { includeSpatial: true })
  const project = structuredClone(fixture.project)
  const runtimes: RuntimeLayerItem[] = []
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      runtimes.push(...scene.layerItems.filter((item): item is RuntimeLayerItem => (
        item.kind === 'runtime' && fixture.itemIds.includes(item.layerItemId)
      )))
      scene.layerItems = scene.layerItems.filter(
        (item) => !fixture.itemIds.includes(item.layerItemId),
      )
    }
  }
  if (runtimes.length !== 2) throw new Error('Spatial Runtime fixture carriers are missing')
  runtimes.forEach((runtime, index) => {
    const first = index === 0
    runtime.label = first ? '空间全局运行时一' : '空间全局运行时二'
    runtime.order = 100 + index
    runtime.frame = {
      mode: 'absolute',
      x: first ? 110 : 690,
      y: first ? 170 : 390,
      width: 420,
      height: 170,
    }
    runtime.runtime.content.values = {
      ...runtime.runtime.content.values,
      carrier: first ? 'one' : 'two',
      title: first ? firstInitialTitle : secondInitialTitle,
    }
    runtime.runtime.content.metadata = {
      ...runtime.runtime.content.metadata,
      title: { label: first ? '空间标题一' : '空间标题二' },
    }
    project.globalLayerItems.push({
      item: runtime,
      visibility: { mode: 'all', locationIds: [] },
      plane: first ? 'underlay' : 'overlay',
    })
  })
  const locationId = fixture.spatialLocationId
  if (!locationId) throw new Error('Spatial Runtime fixture location is missing')
  project.startLocationId = locationId
  return courseProjectDocumentSchema.parse(project)
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
    || !leaf.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-r18-076-`)
  ) {
    throw new Error(`Refusing to remove an unscoped r18-076 directory: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function launchEditor(): Promise<LaunchedEditor> {
  const runRoot = mkdtempSync(
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-r18-076-${process.pid}-`),
  )
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`],
      cwd: root,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        COURSEWARE_CLI_DOGFOOD: '',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        [BACKGROUND_E2E_ENV]: '1',
      },
    })
    const diagnostics: Diagnostics = {
      pageErrors: [],
      consoleErrors: [],
      externalRequests: [],
    }
    const page = await app.firstWindow()
    page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    })
    app.context().on('request', (request) => {
      if (/^https?:/i.test(request.url())) diagnostics.externalRequests.push(request.url())
    })
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

async function patchDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: false,
      filePaths: [paths.projectPath],
    })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('HTML') ? paths.htmlPath : paths.projectPath,
      }
    }) as typeof dialog.showSaveDialog
  }, { projectPath, htmlPath })
}

function readProject(): CourseProjectDocument {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
}

function globalRuntime(project: CourseProjectDocument, itemId: string): RuntimeLayerItem {
  const item = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === itemId,
  )?.item
  if (!item || item.kind !== 'runtime') throw new Error(`Missing global Runtime ${itemId}`)
  return item
}

async function saveCurrent(page: Page): Promise<CourseProjectDocument> {
  const previousMtime = statSync(projectPath).mtimeMs
  await page.waitForTimeout(25)
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
  await expect.poll(() => statSync(projectPath).mtimeMs, { timeout: 15_000 })
    .toBeGreaterThan(previousMtime)
  return readProject()
}

async function selectSpatialGlobalScope(page: Page): Promise<void> {
  await expect(page.getByTestId('spatial-workspace')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('global-layer-entry').click()
}

function authoringRuntimeText(page: Page, itemId: string) {
  return page.locator(
    `[data-spatial-global-runtime-mount="${itemId}"] [data-courseware-edit-key="title"]`,
  )
}

function authoringRuntimeInner(page: Page, itemId: string) {
  return page.locator(
    `[data-spatial-global-runtime-mount="${itemId}"] `
    + `[data-published-global-runtime-inner="${itemId}"]`,
  )
}

function offlineRuntimeText(page: Page, itemId: string) {
  return page.locator(
    `[data-layer-source="global"][data-layer-item-id="${itemId}"] `
    + `[data-courseware-edit-key="title"]`,
  )
}

test('Spatial global API2：真实作者双击编辑、单 carrier 历史往返、保存重开与离线 HTML', async () => {
  test.setTimeout(120_000)
  mkdirSync(evidenceRoot, { recursive: true })
  for (const artifact of [projectPath, htmlPath, authoringScreenshotPath, offlineScreenshotPath]) {
    if (existsSync(artifact)) rmSync(artifact)
  }
  const project = createSpatialRuntimeProject()
  writeFileSync(projectPath, createCourseProjectArchive({
    project,
    assetFiles: {},
    componentFiles: {},
  }, { mtime: '2026-09-07T08:00:00.000Z' }))

  let launch: LaunchedEditor | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    launch = await launchEditor()
    const { app, page } = launch
    await patchDialogs(app)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await selectSpatialGlobalScope(page)

    const firstText = authoringRuntimeText(page, firstRuntimeId)
    const secondText = authoringRuntimeText(page, secondRuntimeId)
    await expect(firstText).toHaveText(firstInitialTitle, { timeout: 15_000 })
    await expect(secondText).toHaveText(secondInitialTitle, { timeout: 15_000 })
    const firstInnerBefore = await authoringRuntimeInner(page, firstRuntimeId).elementHandle()
    const secondInnerBefore = await authoringRuntimeInner(page, secondRuntimeId).elementHandle()
    if (!firstInnerBefore || !secondInnerBefore) throw new Error('Spatial Runtime mounts are missing')

    const target = page.getByRole('button', {
      name: '空间标题一，双击编辑文字',
    })
    await expect(target).toBeVisible({ timeout: 15_000 })
    await target.dblclick()
    const editor = page.getByTestId('canvas-plain-text-editor')
    const textbox = editor.getByRole('textbox', { name: '空间标题一' })
    await expect(textbox).toHaveValue(firstInitialTitle)
    await textbox.fill(editedTitle)
    await textbox.press('Enter')
    await expect(editor).toHaveCount(0)
    await expect(firstText).toHaveText(editedTitle)
    await expect(secondText).toHaveText(secondInitialTitle)
    await expect.poll(() => authoringRuntimeInner(page, firstRuntimeId).evaluate(
      (current, previous) => current === previous,
      firstInnerBefore,
    )).toBe(false)
    await expect.poll(() => authoringRuntimeInner(page, secondRuntimeId).evaluate(
      (current, previous) => current === previous,
      secondInnerBefore,
    )).toBe(true)

    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(firstText).toHaveText(firstInitialTitle)
    await expect(secondText).toHaveText(secondInitialTitle)
    await page.getByRole('button', {
      name: '重做（Ctrl+Y / Ctrl+Shift+Z）',
      exact: true,
    }).click()
    await expect(firstText).toHaveText(editedTitle)
    await expect(secondText).toHaveText(secondInitialTitle)
    await expect.poll(() => page.evaluate(() => {
      const probe = (window as Window & {
        __r18076SpatialRuntimeProbe?: {
          creates?: Record<string, number>
          destroys?: Record<string, number>
        }
      }).__r18076SpatialRuntimeProbe
      return {
        secondCreates: probe?.creates?.two ?? 0,
        secondDestroys: probe?.destroys?.two ?? 0,
      }
    })).toEqual({ secondCreates: 1, secondDestroys: 0 })

    const saved = await saveCurrent(page)
    expect(globalRuntime(saved, firstRuntimeId).runtime.content.values.title).toBe(editedTitle)
    expect(globalRuntime(saved, secondRuntimeId).runtime.content.values.title)
      .toBe(secondInitialTitle)

    await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await selectSpatialGlobalScope(page)
    await expect(authoringRuntimeText(page, firstRuntimeId)).toHaveText(editedTitle, {
      timeout: 15_000,
    })
    await expect(authoringRuntimeText(page, secondRuntimeId)).toHaveText(secondInitialTitle)
    await expect(page.getByRole('button', {
      name: '空间标题一，双击编辑文字',
    })).toBeVisible()
    await page.screenshot({ path: authoringScreenshotPath, fullPage: true })

    await page.getByRole('button', { name: '放大画布', exact: true }).click()
    await page.getByRole('button', { name: '放大画布', exact: true }).click()
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const runHost = page.getByTestId('spatial-try-run-host')
    await expect(runHost.locator('[data-playback-view]')).toBeVisible()
    expect(await runHost.evaluate(element => element.closest('.canvas-stage-stack'))).toBeNull()
    const runText = runHost.locator(`[data-layer-source="global"][data-layer-item-id="${firstRuntimeId}"] [data-courseware-edit-key="title"]`)
    await expect(runText).toHaveText(editedTitle)
    const runInstance = await runText.elementHandle()
    const beforeSize = await runText.boundingBox()
    if (!runInstance || !beforeSize) throw new Error('Missing Spatial try-run instance')
    const zoomButton = runHost.getByRole('button', { name: '缩放', exact: true })
    await zoomButton.click()
    const zoomPanel = runHost.getByRole('group', { name: '课件观察缩放' })
    for (let step = 0; step < 4; step++) await zoomPanel.getByRole('button', { name: '放大', exact: true }).click()
    const enlarged = await runText.boundingBox()
    expect(enlarged!.width / beforeSize.width).toBeCloseTo(2, 1)
    expect(await runText.evaluate((element, before) => element === before, runInstance)).toBe(true)
    await zoomPanel.getByRole('button', { name: '关闭', exact: true }).click()
    for (const label of ['左右移动视图', '上下移动视图']) {
      const bar = runHost.getByRole('scrollbar', { name: label })
      await bar.focus(); await bar.press('End')
    }
    await zoomButton.click()
    await zoomPanel.getByRole('button', { name: '恢复视图', exact: true }).click()
    await zoomPanel.getByRole('button', { name: '关闭', exact: true }).click()
    await page.screenshot({ path: join(evidenceRoot, 'spatial-global-runtime-try-run.png'), fullPage: true })
    await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    expect(await saveCurrent(page)).toEqual(saved)

    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出' }).click()
    await expect.poll(
      () => existsSync(htmlPath) ? statSync(htmlPath).size : 0,
      { timeout: 15_000 },
    ).toBeGreaterThan(1_000)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1280, height: 900 },
    })
    const offline = await context.newPage()
    const offlineErrors: string[] = []
    const offlineRequests: string[] = []
    offline.on('pageerror', (error) => offlineErrors.push(error.message))
    offline.on('console', (message) => {
      if (message.type() === 'error') offlineErrors.push(message.text())
    })
    offline.on('request', (request) => {
      if (/^https?:/i.test(request.url())) offlineRequests.push(request.url())
    })
    await offline.goto(pathToFileURL(htmlPath).href)
    await expect(offlineRuntimeText(offline, firstRuntimeId)).toHaveText(editedTitle, {
      timeout: 15_000,
    })
    await expect(offlineRuntimeText(offline, secondRuntimeId)).toHaveText(secondInitialTitle)
    await offline.screenshot({ path: offlineScreenshotPath, fullPage: true })
    expect(offlineErrors).toEqual([])
    expect(offlineRequests).toEqual([])
    expect(launch.pageErrors).toEqual([])
    expect(launch.consoleErrors).toEqual([])
    expect(launch.externalRequests).toEqual([])
  } finally {
    await browser?.close()
    if (launch) await closeEditor(launch.app, launch.runRoot)
  }
})
