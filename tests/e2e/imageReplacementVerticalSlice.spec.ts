import { createHash } from 'node:crypto'
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, chromium, expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import type { BrowserContext, ElectronApplication, Locator, Page } from 'playwright'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
const fixtureDirectory = join(root, 'tests', 'fixtures', 'architecture-baseline')
const fixtureManifestPath = join(fixtureDirectory, 'manifest.json')
const slideSourcePath = join(fixtureDirectory, 'slide-heavy.h5lesson')
const flowSourcePath = join(fixtureDirectory, 'flow-heavy.h5lesson')
const mixedSourcePath = join(fixtureDirectory, 'mixed-spatial.h5lesson')
const replacementImagePath = join(
  root,
  'examples',
  'sample-counter-component',
  'thumbnail.png',
)
const evidenceDirectory = join(
  root,
  'output',
  'arch-1-vs-06',
  `run-${process.pid}`,
)
const staleCopyPath = join(evidenceDirectory, 'slide-stale-copy.h5lesson')
const undoCopyPath = join(evidenceDirectory, 'slide-undo-copy.h5lesson')
const redoneCopyPath = join(evidenceDirectory, 'slide-redone-copy.h5lesson')
const htmlPath = join(evidenceDirectory, 'slide-replacement.html')
const webPackagePath = join(evidenceDirectory, 'slide-replacement-web.zip')
const webExtractDirectory = join(evidenceDirectory, 'slide-replacement-web')
const flowCopyPath = join(evidenceDirectory, 'flow-heavy-copy.h5lesson')
const mixedCopyPath = join(evidenceDirectory, 'mixed-spatial-copy.h5lesson')
const replacementBytes = new Uint8Array(readFileSync(replacementImagePath))
let launchSequence = 0

interface FixtureManifest {
  fixtures: Array<{ filename: string; sha256: string }>
}

interface Diagnostics {
  pageErrors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  externalRequests: string[]
}

interface LaunchedEditor extends Diagnostics {
  app: ElectronApplication
  context: BrowserContext
  page: Page
  userDataPath: string
}

interface DialogPaths {
  projectSave?: string
  projectOpen?: string
  imageOpen?: string
  htmlSave?: string
  webPackageSave?: string
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fixtureHashes(): Record<string, string> {
  return Object.fromEntries(
    [slideSourcePath, flowSourcePath, mixedSourcePath]
      .map((path) => [path, sha256(path)]),
  )
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array): boolean {
  return Boolean(
    left &&
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]),
  )
}

async function expectPublishedImageRendered(
  root: Locator,
  layerItemId: string,
  expectedSrc: string,
): Promise<void> {
  const layer = root.locator(`[data-slide-layer-item="${layerItemId}"]`)
  const source = layer.locator('img')
  await expect(layer).toBeVisible()
  await expect(source).toHaveAttribute('src', expectedSrc)
  await expect.poll(() => source.evaluate((element) => {
    const image = element as HTMLImageElement
    return image.complete && image.naturalWidth > 0
  })).toBe(true)
  await expect.poll(async () => (
    await layer.locator('canvas[aria-hidden="true"]').isVisible()
    || await source.isVisible()
  )).toBe(true)
}

function imageAssetId(
  project: CourseProjectDocument,
  locationId: string,
  layerItemId: string,
): string {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') {
    throw new Error(`Missing Slide location: ${locationId}`)
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('Missing Slide surface')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('Missing Slide scene')
  const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'image') {
    throw new Error(`Missing Slide image: ${layerItemId}`)
  }
  const stateId = location.stateId ?? null
  const state = stateId === null
    ? undefined
    : scene.presentation?.states.find((candidate) => candidate.id === stateId)
  const overrideAssetId = state?.layerItemOverrides[layerItemId]?.nativeData?.assetId
  return typeof overrideAssetId === 'string'
    ? overrideAssetId
    : item.content.data.assetId
}

function payloadAssignment(text: string) {
  const marker = 'window.__H5_COURSE_PAYLOAD__='
  const start = text.indexOf(marker)
  if (start < 0) throw new Error('Published payload assignment is missing')
  const payloadStart = start + marker.length
  const scriptEnd = text.indexOf('</script>', payloadStart)
  const assignment = (scriptEnd < 0
    ? text.slice(payloadStart)
    : text.slice(payloadStart, scriptEnd))
    .trim()
    .replace(/;\s*$/, '')
  return publishedCourseV2Schema.parse(JSON.parse(assignment))
}

function writeArchiveEvidence(
  outputRoot: string,
  archivePath: string,
  bytes: Uint8Array,
): void {
  const segments = archivePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    archivePath.includes('\\') ||
    /^[A-Za-z]:|^\//.test(archivePath)
  ) {
    throw new Error(`Unsafe Web package path: ${archivePath}`)
  }
  const rootPath = resolve(outputRoot)
  const outputPath = resolve(rootPath, ...segments)
  const scoped = relative(rootPath, outputPath)
  if (!scoped || scoped === '..' || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(scoped)) {
    throw new Error(`Web package path escapes evidence directory: ${archivePath}`)
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, bytes)
}

function attachDiagnostics(page: Page, diagnostics: Diagnostics): void {
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text())
  })
}

async function launchEditor(): Promise<LaunchedEditor> {
  const userDataPath = mkdtempSync(
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-vs06-${process.pid}-${launchSequence++}-`),
  )
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
    const context = app.context()
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
      attachDiagnostics(target, diagnostics)
    }
    context.on('request', (request) => {
      if (/^https?:/i.test(request.url())) diagnostics.externalRequests.push(request.url())
    })
    context.on('page', attach)
    const page = await app.firstWindow()
    attach(page)
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const recoveryDialog = page.getByRole('alertdialog', {
      name: '发现未完成的本地恢复副本',
    })
    if (await recoveryDialog.isVisible().catch(() => false)) {
      await recoveryDialog.getByRole('button', { name: '丢弃副本' }).click()
    }
    const professional = page.getByRole('button', { name: '专业' })
    if (await professional.getAttribute('aria-pressed') !== 'true') {
      await professional.click()
    }
    return { app, context, page, userDataPath, ...diagnostics }
  } catch (error) {
    if (app) await closeEditor(app, userDataPath).catch(() => undefined)
    else removeVs06Profile(userDataPath)
    throw error
  }
}

function removeVs06Profile(userDataPath: string): void {
  const absolute = resolve(userDataPath)
  const temporaryRoot = resolve(tmpdir())
  const scoped = relative(temporaryRoot, absolute)
  if (
    !scoped ||
    scoped === '..' ||
    scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(scoped) ||
    !scoped.split(/[\\/]/)[0]!.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-vs06-`)
  ) {
    throw new Error(`Refusing to remove an unscoped VS-06 profile: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeEditor(
  app: ElectronApplication,
  userDataPath: string,
): Promise<void> {
  const child = app.process()
  await cancelDeferredImageDialog(app).catch(() => undefined)
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
  removeVs06Profile(userDataPath)
}

async function patchDialogs(app: ElectronApplication, paths: DialogPaths): Promise<void> {
  await app.evaluate(({ dialog }, values) => {
    dialog.showSaveDialog = (async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('网页')
          ? values.webPackageSave ?? values.projectSave ?? ''
          : options.title?.includes('HTML')
            ? values.htmlSave ?? values.projectSave ?? ''
            : values.projectSave ?? '',
      }
    }) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (...args:
      | [Electron.BaseWindow, Electron.OpenDialogOptions]
      | [Electron.OpenDialogOptions]
    ): Promise<Electron.OpenDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      const selected = options.title === '选择图片'
        ? values.imageOpen
        : values.projectOpen
      return {
        canceled: !selected,
        filePaths: selected ? [selected] : [],
      }
    }) as typeof dialog.showOpenDialog
  }, paths)
}

async function armDeferredImageDialog(
  app: ElectronApplication,
  selectedPath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    type OpenDialog = typeof dialog.showOpenDialog
    type State = {
      phase: 'armed' | 'pending' | 'resolved'
      selectedPath: string
      previous: OpenDialog
      resolve?: (value: Electron.OpenDialogReturnValue) => void
    }
    const host = globalThis as unknown as { __VS06_IMAGE_DIALOG__?: State }
    if (host.__VS06_IMAGE_DIALOG__?.phase === 'pending') {
      throw new Error('VS-06 deferred image dialog is already pending')
    }
    const previous = dialog.showOpenDialog
    const state: State = { phase: 'armed', selectedPath: path, previous }
    host.__VS06_IMAGE_DIALOG__ = state
    dialog.showOpenDialog = (async (...args:
      | [Electron.BaseWindow, Electron.OpenDialogOptions]
      | [Electron.OpenDialogOptions]
    ): Promise<Electron.OpenDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      if (options.title !== '选择图片') {
        return (previous as (...input: typeof args) => Promise<Electron.OpenDialogReturnValue>)(...args)
      }
      if (state.phase !== 'armed') throw new Error('VS-06 image dialog called more than once')
      state.phase = 'pending'
      return new Promise<Electron.OpenDialogReturnValue>((resolveDialog) => {
        state.resolve = resolveDialog
      })
    }) as OpenDialog
  }, selectedPath)
}

async function deferredImageDialogPhase(app: ElectronApplication): Promise<string> {
  return app.evaluate(() => {
    const host = globalThis as unknown as {
      __VS06_IMAGE_DIALOG__?: { phase?: string }
    }
    return host.__VS06_IMAGE_DIALOG__?.phase ?? 'missing'
  })
}

async function releaseDeferredImageDialog(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    type State = {
      phase: 'armed' | 'pending' | 'resolved'
      selectedPath: string
      previous: typeof dialog.showOpenDialog
      resolve?: (value: Electron.OpenDialogReturnValue) => void
    }
    const host = globalThis as unknown as { __VS06_IMAGE_DIALOG__?: State }
    const state = host.__VS06_IMAGE_DIALOG__
    if (!state || state.phase !== 'pending' || !state.resolve) {
      throw new Error('VS-06 deferred image dialog is not pending')
    }
    dialog.showOpenDialog = state.previous
    state.phase = 'resolved'
    state.resolve({ canceled: false, filePaths: [state.selectedPath] })
  })
}

async function cancelDeferredImageDialog(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    type State = {
      phase: 'armed' | 'pending' | 'resolved'
      previous: typeof dialog.showOpenDialog
      resolve?: (value: Electron.OpenDialogReturnValue) => void
    }
    const host = globalThis as unknown as { __VS06_IMAGE_DIALOG__?: State }
    const state = host.__VS06_IMAGE_DIALOG__
    if (!state) return
    dialog.showOpenDialog = state.previous
    if (state.phase === 'pending') {
      state.resolve?.({ canceled: true, filePaths: [] })
    }
    delete host.__VS06_IMAGE_DIALOG__
  })
}

async function openProject(
  app: ElectronApplication,
  page: Page,
  projectPath: string,
  expectedLocationTestId: string,
): Promise<void> {
  await patchDialogs(app, { projectOpen: projectPath })
  await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
  await expect(page.getByTestId(expectedLocationTestId)).toBeVisible({ timeout: 15_000 })
}

async function saveAs(
  app: ElectronApplication,
  page: Page,
  path: string,
  otherPaths: DialogPaths = {},
): Promise<void> {
  await patchDialogs(app, { ...otherPaths, projectSave: path })
  await page.getByRole('button', { name: '另存为' }).click()
  await expect.poll(
    () => existsSync(path) ? statSync(path).size : 0,
    { timeout: 15_000 },
  ).toBeGreaterThan(100)
}

async function selectSlideImage(page: Page, itemId = 'slide-intro-hero'): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const row = page.getByTestId(`node-item-${itemId}`)
  await expect(row).toBeVisible()
  await row.locator('.node-name').click()
  await page.getByRole('tab', { name: '属性' }).click()
  await expect(page.getByRole('button', { name: '替换图片' })).toBeVisible()
}

async function makeBaselineBannerExportable(page: Page): Promise<void> {
  await page.getByRole('button', { name: /全局层（全课）/ }).click()
  await page.getByRole('tab', { name: '图层' }).click()
  const banner = page.getByTestId('node-item-slide-global-banner')
  await expect(banner).toBeVisible()
  await banner.locator('.node-name').click()
  await page.getByRole('tab', { name: '属性' }).click()
  const height = page.locator('.property-section').first().getByLabel('高', { exact: true })
  await height.fill('80')
  await height.press('Enter')
}

async function enterTryRun(page: Page): Promise<void> {
  const button = page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '当前位置试运行', exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function returnToEdit(page: Page): Promise<void> {
  await page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '编辑状态', exact: true })
    .click()
}

async function exportHtmlAndWeb(
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  await patchDialogs(app, { htmlSave: htmlPath, webPackageSave: webPackagePath })
  await page.getByTestId('export-menu-trigger').click()
  await page.getByTestId('export-single-html').click()
  const htmlPreflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
  await expect(htmlPreflight).toContainText('0 个错误')
  await htmlPreflight.getByRole('button', { name: '继续导出' }).click()
  await expect.poll(() => existsSync(htmlPath) ? statSync(htmlPath).size : 0, {
    timeout: 30_000,
  }).toBeGreaterThan(1_000)

  await page.getByTestId('export-menu-trigger').click()
  await page.getByTestId('export-web-package').click()
  const webPreflight = page.getByRole('alertdialog', { name: '网页包 导出预检' })
  await expect(webPreflight).toContainText('0 个错误')
  await webPreflight.getByRole('button', { name: '继续导出' }).click()
  await expect.poll(() => existsSync(webPackagePath) ? statSync(webPackagePath).size : 0, {
    timeout: 30_000,
  }).toBeGreaterThan(1_000)
}

function unexpectedConsoleErrors(errors: readonly string[]): string[] {
  return errors.filter((message) => !(
    message.includes('UserFacingError') &&
    (
      message.includes('编辑会话已过期')
      || message.includes('当前页面或呈现状态已改变')
      || message.includes('工程已发生变化')
    )
  ))
}

function expectCleanDiagnostics(
  diagnostics: Diagnostics,
  options: { allowExpectedStaleError?: boolean } = {},
): void {
  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.externalRequests).toEqual([])
  expect(
    options.allowExpectedStaleError
      ? unexpectedConsoleErrors(diagnostics.consoleErrors)
      : diagnostics.consoleErrors,
  ).toEqual([])
  expect(diagnostics.consoleWarnings.filter((message) => !(
    message.includes('A props object containing a "key" prop is being spread into JSX') ||
    message.includes('WebGL: INVALID_VALUE: texImage2D: bad image data')
  ))).toEqual([])
}

test.describe.serial('ARCH-1 VS-06 image replacement desktop regression', () => {
  const sourceHashesBefore = fixtureHashes()

  test.beforeAll(() => {
    mkdirSync(evidenceDirectory, { recursive: true })
    const manifest = JSON.parse(readFileSync(fixtureManifestPath, 'utf8')) as FixtureManifest
    for (const fixture of manifest.fixtures) {
      const path = join(fixtureDirectory, fixture.filename)
      expect(sha256(path)).toBe(fixture.sha256)
    }
  })

  test.afterAll(() => {
    expect(fixtureHashes()).toEqual(sourceHashesBefore)
  })

  test('deferred cross-location completion is stale and project switching is busy-unreachable', async () => {
    test.setTimeout(90_000)
    const launch = await launchEditor()
    const source = openCourseProjectArchive(new Uint8Array(readFileSync(slideSourcePath)))
    try {
      await openProject(
        launch.app,
        launch.page,
        slideSourcePath,
        'course-page-node-slide-surface',
      )
      await selectSlideImage(launch.page)
      await patchDialogs(launch.app, {
        projectOpen: flowSourcePath,
        projectSave: staleCopyPath,
        imageOpen: replacementImagePath,
      })
      await armDeferredImageDialog(launch.app, replacementImagePath)
      await launch.page.getByRole('button', { name: '替换图片' }).click()
      await expect.poll(() => deferredImageDialogPhase(launch.app)).toBe('pending')
      await expect(launch.page.getByRole('button', { name: '新建课件（Ctrl+N）' }))
        .toBeDisabled()
      await expect(launch.page.getByRole('button', { name: '打开工程（Ctrl+O）' }))
        .toBeDisabled()
      await launch.page.screenshot({
        path: join(evidenceDirectory, '01-stale-dialog-pending.png'),
        fullPage: true,
      })
      await launch.page.keyboard.press('Control+N')
      await expect(launch.page.getByRole('main', { name: '课件画布' }))
        .toContainText('判别式导入 · 基础态')
      await launch.page.keyboard.press('Control+O')
      await expect(launch.page.getByRole('main', { name: '课件画布' }))
        .toContainText('判别式导入 · 基础态')
      await expect(launch.page.getByTestId('course-page-node-flow-surface')).toHaveCount(0)

      await launch.page.getByTestId('scene-item-slide-location-summary').click()
      await selectSlideImage(launch.page, 'slide-summary-hero')
      await releaseDeferredImageDialog(launch.app)
      const staleAlert = launch.page.getByRole('alert')
      await expect(staleAlert).toContainText(
        /编辑会话已过期|当前页面或呈现状态已改变|工程已发生变化/,
      )
      await expect(staleAlert).toContainText('重新选择')
      await expect(launch.page.getByRole('button', { name: '撤销（Ctrl+Z）' }))
        .toBeDisabled()
      await launch.page.screenshot({
        path: join(evidenceDirectory, '02-stale-dialog-rejected.png'),
        fullPage: true,
      })

      await saveAs(launch.app, launch.page, staleCopyPath, {
        projectOpen: slideSourcePath,
        imageOpen: replacementImagePath,
      })
      const staleCopy = openCourseProjectArchive(new Uint8Array(readFileSync(staleCopyPath)))
      expect(staleCopy.project.revision).toBe(source.project.revision)
      expect(staleCopy.project.assets).toEqual(source.project.assets)
      expect(imageAssetId(staleCopy.project, 'slide-location-intro', 'slide-intro-hero'))
        .toBe(imageAssetId(source.project, 'slide-location-intro', 'slide-intro-hero'))
      expect(imageAssetId(staleCopy.project, 'slide-location-summary', 'slide-summary-hero'))
        .toBe(imageAssetId(source.project, 'slide-location-summary', 'slide-summary-hero'))
      expect(Object.keys(staleCopy.assetFiles).sort()).toEqual(Object.keys(source.assetFiles).sort())
      for (const [assetId, bytes] of Object.entries(source.assetFiles)) {
        expect(staleCopy.assetFiles[assetId]).toEqual(bytes)
      }
      expectCleanDiagnostics(launch, { allowExpectedStaleError: true })
    } finally {
      await closeEditor(launch.app, launch.userDataPath)
    }
  })

  test('normal replacement round-trips undo/redo, Preview, standalone HTML and Web bytes', async () => {
    test.setTimeout(240_000)
    const launch = await launchEditor()
    const source = openCourseProjectArchive(new Uint8Array(readFileSync(slideSourcePath)))
    const originalAssetId = imageAssetId(
      source.project,
      'slide-location-summary',
      'slide-summary-hero',
    )
    try {
      await openProject(
        launch.app,
        launch.page,
        slideSourcePath,
        'course-page-node-slide-surface',
      )
      await launch.page.getByTestId('scene-item-slide-location-summary').click()
      await selectSlideImage(launch.page, 'slide-summary-hero')
      await patchDialogs(launch.app, {
        projectOpen: slideSourcePath,
        imageOpen: replacementImagePath,
      })
      const canvas = launch.page.getByTestId('canvas-stage')
      const before = await canvas.screenshot()
      await launch.page.getByRole('button', { name: '替换图片' }).click()
      await expect(launch.page.getByRole('button', { name: '撤销（Ctrl+Z）' })).toBeEnabled()
      await launch.page.waitForTimeout(500)
      const editorPixelsChanged = Buffer.compare(before, await canvas.screenshot()) !== 0
      test.info().annotations.push({
        type: 'editor-stage-pixel-change',
        description: String(editorPixelsChanged),
      })
      expect(editorPixelsChanged).toBe(true)
      await launch.page.screenshot({
        path: join(evidenceDirectory, '03-normal-replaced.png'),
        fullPage: true,
      })

      await launch.page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await saveAs(launch.app, launch.page, undoCopyPath, {
        projectOpen: slideSourcePath,
        imageOpen: replacementImagePath,
      })
      const undone = openCourseProjectArchive(new Uint8Array(readFileSync(undoCopyPath)))
      expect(imageAssetId(undone.project, 'slide-location-summary', 'slide-summary-hero'))
        .toBe(originalAssetId)
      expect(undone.assetFiles[originalAssetId]).toEqual(source.assetFiles[originalAssetId])
      expect(Object.values(undone.assetFiles).some((bytes) => sameBytes(bytes, replacementBytes)))
        .toBe(false)
      await launch.page.screenshot({
        path: join(evidenceDirectory, '04-normal-undone.png'),
        fullPage: true,
      })

      await launch.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
      await saveAs(launch.app, launch.page, redoneCopyPath, {
        projectOpen: slideSourcePath,
        imageOpen: replacementImagePath,
      })
      const redone = openCourseProjectArchive(new Uint8Array(readFileSync(redoneCopyPath)))
      const replacementEntry = Object.entries(redone.assetFiles).find(([, bytes]) => (
        sameBytes(bytes, replacementBytes)
      ))
      if (!replacementEntry) throw new Error('Saved replacement bytes are missing')
      const replacementAssetId = replacementEntry[0]
      expect(replacementAssetId).not.toBe(originalAssetId)
      expect(imageAssetId(redone.project, 'slide-location-summary', 'slide-summary-hero'))
        .toBe(replacementAssetId)
      expect(imageAssetId(redone.project, 'slide-location-intro', 'slide-intro-hero'))
        .toBe(originalAssetId)
      expect(redone.project.assets[originalAssetId]).toEqual(source.project.assets[originalAssetId])
      expect(redone.assetFiles[originalAssetId]).toEqual(source.assetFiles[originalAssetId])
      await launch.page.screenshot({
        path: join(evidenceDirectory, '05-normal-redone.png'),
        fullPage: true,
      })

      await patchDialogs(launch.app, { projectOpen: redoneCopyPath })
      await launch.page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await launch.page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(launch.page.getByTestId('course-page-node-slide-surface'))
        .toBeVisible()
      await launch.page.getByTestId('scene-item-slide-location-summary').click()
      await selectSlideImage(launch.page, 'slide-summary-hero')

      const expectedDataUrl = `data:image/png;base64,${Buffer.from(replacementBytes).toString('base64')}`
      await enterTryRun(launch.page)
      const currentLocationHost = launch.page.getByTestId('course-try-run-host')
      await expect(currentLocationHost).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => currentLocationHost.getAttribute('data-course-player-ready'))
        .toBe('true')
      await expectPublishedImageRendered(
        currentLocationHost,
        'slide-summary-hero',
        expectedDataUrl,
      )
      await currentLocationHost.screenshot({
        path: join(evidenceDirectory, '06-current-location-try-run.png'),
      })
      await returnToEdit(launch.page)

      await launch.page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
      const preview = launch.page.getByTestId('course-preview-overlay')
      const previewHost = launch.page.getByTestId('course-preview-host')
      const previewAdapter = previewHost.locator('.slide-published-adapter')
      await expect(previewAdapter).toBeVisible({ timeout: 15_000 })
      for (const locationId of [
        'slide-location-evidence',
        'slide-location-practice',
        'slide-location-summary',
      ]) {
        await launch.page.getByTestId('course-preview-next').click()
        await expect.poll(() => previewAdapter.getAttribute('data-location-id'))
          .toBe(locationId)
      }
      await expectPublishedImageRendered(
        previewHost,
        'slide-summary-hero',
        expectedDataUrl,
      )
      await previewHost.screenshot({ path: join(evidenceDirectory, '06-preview.png') })
      await preview.getByRole('button', { name: '关闭预览' }).click()

      await makeBaselineBannerExportable(launch.page)
      await exportHtmlAndWeb(launch.app, launch.page)
      const html = readFileSync(htmlPath, 'utf8')
      const htmlPayload = payloadAssignment(html)
      expect(htmlPayload.assets[replacementAssetId]?.url).toBe(expectedDataUrl)
      const webArchive = unzipSync(new Uint8Array(readFileSync(webPackagePath)))
      expect(Object.keys(webArchive)).toEqual(expect.arrayContaining([
        'index.html',
        'course-data.js',
        'player/player.iife.js',
        'player/player.css',
      ]))
      expect(Object.keys(webArchive)).not.toEqual(expect.arrayContaining([
        'project.json',
        'course.json',
      ]))
      const webPayload = payloadAssignment(strFromU8(webArchive['course-data.js']!))
      const webAssetUrl = webPayload.assets[replacementAssetId]?.url
      expect(webAssetUrl).toMatch(/^\.\/assets\//)
      const webAssetPath = webAssetUrl!.replace(/^\.\//, '')
      expect(webArchive[webAssetPath]).toEqual(replacementBytes)

      for (const [archivePath, bytes] of Object.entries(webArchive)) {
        expect(archivePath).not.toMatch(/^[A-Za-z]:|^\/|\\/)
        writeArchiveEvidence(webExtractDirectory, archivePath, bytes)
      }
      const browser = await chromium.launch({ headless: true })
      try {
        for (const exported of [
          { path: htmlPath, screenshot: '07-standalone-html.png' },
          { path: join(webExtractDirectory, 'index.html'), screenshot: '08-web-package.png' },
        ]) {
          const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
          const errors: string[] = []
          const requests: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text())
          })
          page.on('request', (request) => {
            if (/^https?:/i.test(request.url())) requests.push(request.url())
          })
          await page.goto(pathToFileURL(exported.path).toString())
          const publishedAdapter = page.locator('.slide-published-adapter')
          await expect(publishedAdapter).toBeVisible({ timeout: 15_000 })
          const nextButton = page.locator('[data-controller-button-id="next"]')
          await expect(nextButton).toHaveText('下一场景', { timeout: 15_000 })
          for (const locationId of [
            'slide-location-evidence',
            'slide-location-practice',
            'slide-location-summary',
          ]) {
            const bounds = await nextButton.boundingBox()
            if (!bounds) throw new Error('Exported player next-scene button has no bounds')
            await page.mouse.click(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            )
            await expect.poll(() => publishedAdapter.getAttribute('data-location-id'))
              .toBe(locationId)
          }
          await expectPublishedImageRendered(
            publishedAdapter,
            'slide-summary-hero',
            exported.path === htmlPath ? expectedDataUrl : webAssetUrl!,
          )
          await page.screenshot({
            path: join(evidenceDirectory, exported.screenshot),
            fullPage: true,
          })
          expect(errors).toEqual([])
          expect(requests).toEqual([])
          await page.close()
        }
      } finally {
        await browser.close()
      }
      expectCleanDiagnostics(launch)
    } finally {
      await closeEditor(launch.app, launch.userDataPath)
    }
  })

  test('Flow-heavy and Mixed/Spatial copies reopen and current-location try-run', async () => {
    test.setTimeout(150_000)
    const launch = await launchEditor()
    try {
      await openProject(
        launch.app,
        launch.page,
        flowSourcePath,
        'course-page-node-flow-surface',
      )
      await saveAs(launch.app, launch.page, flowCopyPath, { projectOpen: flowSourcePath })
      await patchDialogs(launch.app, { projectOpen: flowCopyPath })
      await launch.page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await launch.page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await enterTryRun(launch.page)
      await expect(launch.page.getByTestId('flow-runtime-article')).toBeVisible()
      await launch.page.getByRole('main').screenshot({
        path: join(evidenceDirectory, '09-flow-try-run.png'),
      })
      await returnToEdit(launch.page)

      await patchDialogs(launch.app, { projectOpen: mixedSourcePath })
      await launch.page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(launch.page.getByTestId('course-page-node-mixed-slide-surface')).toBeVisible()
      await saveAs(launch.app, launch.page, mixedCopyPath, { projectOpen: mixedSourcePath })
      await patchDialogs(launch.app, { projectOpen: mixedCopyPath })
      await launch.page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await launch.page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()

      await launch.page.getByTestId('flow-page-mixed-flow-surface').click()
      await enterTryRun(launch.page)
      await expect(launch.page.getByTestId('flow-runtime-article')).toBeVisible()
      await launch.page.getByRole('main').screenshot({
        path: join(evidenceDirectory, '10-mixed-flow-try-run.png'),
      })
      await returnToEdit(launch.page)

      await launch.page.getByTestId('spatial-camera-mixed-location-spatial-home').click()
      await enterTryRun(launch.page)
      await expect(launch.page.getByTestId('spatial-world-html')).toBeVisible()
      await launch.page.getByRole('main').screenshot({
        path: join(evidenceDirectory, '11-mixed-spatial-try-run.png'),
      })
      await returnToEdit(launch.page)

      expect(openCourseProjectArchive(new Uint8Array(readFileSync(flowCopyPath))).project.id)
        .toBe('arch-0-flow-heavy')
      expect(openCourseProjectArchive(new Uint8Array(readFileSync(mixedCopyPath))).project.id)
        .toBe('arch-0-mixed-spatial')
      expectCleanDiagnostics(launch)
    } finally {
      await closeEditor(launch.app, launch.userDataPath)
    }
  })
})
