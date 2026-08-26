import { _electron as electron, chromium, expect, test } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ElectronApplication, Page } from 'playwright'
import sharp from 'sharp'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type LayerItem,
} from '../../src/shared/courseProjectTypes'
import {
  APP_E2E_TEMP_DIRECTORY_NAME,
  APP_NAME,
} from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
const outputDir = join(tmpdir(), APP_E2E_TEMP_DIRECTORY_NAME)
// Independent Playwright CLI processes are not serialized by one another.
// Keep one profile inside this worker so recovery tests can relaunch against
// the same state, while preventing a concurrent diagnostic run from locking
// or deleting the full-suite profile.
const e2eUserDataPath = join(outputDir, `electron-profile-${process.pid}`)
const projectPath = join(outputDir, 'roundtrip.h5lesson')
const componentProjectPath = join(outputDir, 'component-roundtrip.h5lesson')
const globalComponentProjectPath = join(outputDir, 'global-component-roundtrip.h5lesson')
const globalNativeProjectPath = join(outputDir, 'global-native-roundtrip.h5lesson')
const globalRuntimeAuthoringProjectPath = join(
  outputDir,
  'global-runtime-authoring.h5lesson',
)
const globalRuntimeAuthoringImportedPath = join(
  outputDir,
  'global-runtime-authoring-imported.h5lesson',
)
const imageProjectPath = join(outputDir, 'image-roundtrip.h5lesson')
const formulaProjectPath = join(outputDir, 'formula-roundtrip.h5lesson')
const formulaHtmlPath = join(outputDir, 'formula-static.html')
const formulaWebPackagePath = join(outputDir, 'formula-static-web.zip')
const formulaWebPackageDirectory = join(outputDir, 'formula-static-web')
const formulaPdfPath = join(outputDir, 'formula-static.pdf')
const formulaPptxPath = join(outputDir, 'formula-static.pptx')
const htmlPath = join(outputDir, 'offline-courseware.html')
const webPackagePath = join(outputDir, 'offline-courseware-web.zip')
const webPackageDirectory = join(outputDir, 'offline-courseware-web')
const htmlPreflightReportPath = join(
  outputDir,
  'offline-courseware-single-html-preflight.json',
)
const pdfPath = join(outputDir, 'static-courseware.pdf')
const pptxPath = join(outputDir, 'static-courseware.pptx')
const runtimeApi2ExportProjectPath = join(
  outputDir,
  'runtime-api2-export.h5lesson',
)
const runtimeApi2ExportPdfPath = join(outputDir, 'runtime-api2-export.pdf')
const runtimeApi2ExportPptxPath = join(outputDir, 'runtime-api2-export.pptx')
const lessonHtmlPath = join(
  root,
  'artifacts',
  'photosynthesis-lesson',
  'photosynthesis-interactive-lesson.html',
)
const visualOutputDirectory = join(root, 'output', 'playwright')
const crossSurfaceEvidenceDirectory = join(
  visualOutputDirectory,
  'v8-cross-surface',
)
const sampleComponentPath = join(root, 'examples', 'sample-counter.h5component')
const globalComponentPath = join(outputDir, 'sample-global-nav.h5component')
const firstImagePath = join(root, 'resources', 'icons', 'icon.png')
const replacementImagePath = join(
  root,
  'examples',
  'sample-counter-component',
  'thumbnail.png',
)
const backgroundE2e = process.env[BACKGROUND_E2E_ENV] ?? '1'

interface LaunchedEditor {
  app: ElectronApplication
  page: Page
  pageErrors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  externalRequests: string[]
}

function collectCourseLayerItems(project: CourseProjectDocument): LayerItem[] {
  const items: LayerItem[] = project.globalLayerItems.map((entry) => entry.item)
  for (const surface of project.surfaces) {
    items.push(...surface.surfaceLayerItems.map((entry) => entry.item))
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) items.push(...scene.layerItems)
    }
  }
  return items
}

function firstSlideSceneLayerItems(project: CourseProjectDocument): LayerItem[] {
  const surface = project.surfaces.find((item) => item.type === 'slide')
  if (!surface || surface.type !== 'slide') {
    throw new Error('Course Project V9 缺少 Slide 表面')
  }
  const scene = surface.scenes[0]
  if (!scene) throw new Error('Course Project V9 Slide 表面缺少场景')
  return scene.layerItems
}

function nextUnifiedLayerOrder(project: CourseProjectDocument): number {
  const orders = collectCourseLayerItems(project).map((item) => item.order)
  return (orders.length === 0 ? -1 : Math.max(...orders)) + 1
}

function makeLegacyDomRuntimeLayer(input: {
  layerItemId: string
  label: string
  order: number
  source: string
  values: Record<string, string>
  metadata?: Record<string, { label?: string }>
  assets?: Record<string, { assetId: string }>
}): LayerItem {
  return {
    layerItemId: input.layerItemId,
    label: input.label,
    kind: 'runtime',
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order: input.order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      source: input.source,
      content: {
        values: input.values,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      assets: input.assets ?? {},
    },
  }
}

function nativeTextContents(project: CourseProjectDocument): string[] {
  return collectCourseLayerItems(project).flatMap((item) => (
    item.kind === 'native' && item.content.nativeType === 'text'
      ? [item.content.data.text]
      : []
  ))
}

function teacherControllerLayerRows(page: Page) {
  return page.locator('.node-item').filter({
    has: page.locator('.node-type-icon[title="teacher-controller"]'),
  })
}

function authoredLayerRows(page: Page) {
  return page.locator('.node-item').filter({
    hasNot: page.locator('.node-type-icon[title="teacher-controller"]'),
  })
}

function slideSceneItems(page: Page) {
  return page.locator('[data-testid^="scene-item-"]')
}

function slideSceneTreeNodes(page: Page) {
  return page.locator('.course-page-tree__node[data-kind="slide-scene"]')
}

async function openCoursePreviewOverlay(page: Page) {
  await page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
  const overlay = page.getByTestId('course-preview-overlay')
  const host = page.getByTestId('course-preview-host')
  const adapter = host.locator('.slide-published-adapter')
  await expect(overlay).toBeVisible()
  await expect(host).toBeVisible()
  await expect(adapter).toBeVisible({ timeout: 15_000 })
  return { overlay, host, adapter }
}

async function closeCoursePreviewOverlay(page: Page) {
  const overlay = page.getByTestId('course-preview-overlay')
  await overlay.getByRole('button', { name: '关闭预览' }).click()
  await expect(overlay).toHaveCount(0)
}

function readSavedCourseProjectArchive(filePath: string): {
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
} | null {
  if (!existsSync(filePath)) return null
  const archive = unzipSync(readFileSync(filePath))
  const entry = archive['project.json']
  if (!entry) return null
  const parsed = courseProjectDocumentSchema.safeParse(JSON.parse(strFromU8(entry)))
  if (!parsed.success) return null
  const project = parsed.data
  const assetFiles: Record<string, Uint8Array> = Object.create(null)
  for (const [assetId, meta] of Object.entries(project.assets)) {
    const bytes = archive[meta.path]
    if (bytes) assetFiles[assetId] = bytes
  }
  return { project, assetFiles }
}

async function clickCanvasTryRun(page: Page): Promise<void> {
  await page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '当前位置试运行', exact: true })
    .click()
}

async function expectCoursePlayerTryRunReady(page: Page): Promise<void> {
  const host = page.getByTestId('course-try-run-host')
  await expect(host).toBeVisible({ timeout: 15_000 })
  await expect.poll(
    () => host.getAttribute('data-course-player-ready'),
    { timeout: 15_000 },
  ).toBe('true')
  await expect(page.getByTestId('course-try-run-chrome')).toBeVisible()
  await expect(page.getByTestId('course-try-run-previous')).toBeEnabled()
  await expect(page.getByTestId('course-try-run-next')).toBeEnabled()
  await expect(page.locator('iframe[title="当前位置试运行"]')).toHaveCount(0)
  await expect(host.locator('[data-course-surface-slot]')).not.toHaveCount(0)
  await expect(host.locator('.slide-published-adapter')).toBeVisible()
  await expect(host.locator('[data-slide-scene-stage]')).toBeVisible()
  await expect(page.locator('.runtime-preview-loading')).toHaveCount(0)
}

async function launchEditor(options: {
  preserveRecoveryPrompt?: boolean
  mode?: 'simple' | 'professional'
  forceBackground?: boolean
} = {}): Promise<LaunchedEditor> {
  const requestedBackgroundE2e = options.forceBackground ? '1' : backgroundE2e
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${e2eUserDataPath}`],
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      [BACKGROUND_E2E_ENV]: requestedBackgroundE2e,
    },
  })
  const page = await app.firstWindow()
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
    if (message.type() === 'warning') consoleWarnings.push(message.text())
  })
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url())
  })
  await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
  await expectBackgroundWindowsIsolated(app, requestedBackgroundE2e === '1')
  if (!options.preserveRecoveryPrompt) {
    const recoveryDialog = page.getByRole('alertdialog', {
      name: '发现未完成的本地恢复副本',
    })
    const recoveryVisible = await recoveryDialog
      .waitFor({ state: 'visible', timeout: 800 })
      .then(() => true)
      .catch(() => false)
    if (recoveryVisible) {
      await recoveryDialog.getByRole('button', { name: '丢弃副本' }).click()
      await expect(recoveryDialog).toHaveCount(0)
    }
  }
  const modeButton = page.getByRole('button', {
    name: options.mode === 'simple' ? '简洁' : '专业',
  })
  if (await modeButton.getAttribute('aria-pressed') !== 'true') {
    await modeButton.click()
  }
  return {
    app,
    page,
    pageErrors,
    consoleErrors,
    consoleWarnings,
    externalRequests,
  }
}

async function closeEditor(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function playerSceneIndex(page: Page): Promise<number | null> {
  return page.evaluate(
    () => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() ?? null,
  )
}

async function expectCanvasPlayerScene(
  page: Page,
  expectedIndex: number,
): Promise<void> {
  await expect(page.locator('.lesson-footer')).toHaveCount(0)
  await expect(page.locator('.lesson-page-indicator')).toHaveCount(0)
  await expect.poll(() => playerSceneIndex(page)).toBe(expectedIndex)
}

async function navigateCanvasPlayerByKeyboard(
  page: Page,
  key: 'ArrowLeft' | 'ArrowRight' | 'PageUp' | 'PageDown',
  expectedIndex: number,
): Promise<void> {
  await page.keyboard.press(key)
  await expect.poll(() => playerSceneIndex(page)).toBe(expectedIndex)
}

interface TeacherControllerLogicalPosition {
  left: number
  top: number
}

async function teacherControllerLogicalPosition(
  page: Page,
): Promise<TeacherControllerLogicalPosition> {
  const controller = page.locator('.lesson-teacher-controller-accessibility')
  await expect(controller).toBeVisible()
  return controller.evaluate((element) => ({
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
  }))
}

function expectTeacherControllerPosition(
  actual: TeacherControllerLogicalPosition,
  expected: TeacherControllerLogicalPosition,
  tolerance = 0.01,
): void {
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.top - expected.top)).toBeLessThanOrEqual(tolerance)
}

async function patchDialogs(
  app: ElectronApplication,
  paths: {
    projectSave?: string
    projectOpen?: string
    componentOpen?: string
    imageOpen?: string | string[]
    htmlSave?: string
    webPackageSave?: string
    reportSave?: string
    pdfSave?: string
    pptxSave?: string
  },
) {
  await app.evaluate(({ dialog }, values) => {
    const saveDialog = async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('JSON')
        ? values.reportSave ?? values.projectSave ?? ''
        : options.title?.includes('网页')
          ? values.webPackageSave ?? values.projectSave ?? ''
          : options.title?.includes('HTML')
            ? values.htmlSave ?? values.projectSave ?? ''
            : options.title?.includes('PDF')
              ? values.pdfSave ?? values.projectSave ?? ''
              : options.title?.includes('PowerPoint')
                ? values.pptxSave ?? values.projectSave ?? ''
                : values.projectSave ?? '',
      }
    }
    dialog.showSaveDialog = saveDialog
    const openDialog = async (...args:
      | [Electron.BaseWindow, Electron.OpenDialogOptions]
      | [Electron.OpenDialogOptions]
    ): Promise<Electron.OpenDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      const selected = options.title?.includes('组件')
        ? values.componentOpen
        : options.title?.includes('图片')
          ? values.imageOpen
          : values.projectOpen
      return {
        canceled: false,
        filePaths: (Array.isArray(selected) ? selected : [selected])
          .filter((value): value is string => Boolean(value)),
      }
    }
    dialog.showOpenDialog = openDialog
  }, paths)
}

async function moveSortableUp(
  source: ReturnType<Page['locator']>,
  steps: number,
) {
  await source.focus()
  await source.press('Space')
  await source.page().waitForTimeout(100)
  for (let index = 0; index < steps; index += 1) {
    await source.press('ArrowUp')
    await source.page().waitForTimeout(60)
  }
  await source.press('Space')
  await source.page().waitForTimeout(100)
}

async function averagePixelDifference(
  first: Buffer,
  second: Buffer,
): Promise<number> {
  const [firstPixels, secondPixels] = await Promise.all([
    sharp(first).raw().toBuffer(),
    sharp(second).raw().toBuffer(),
  ])
  if (firstPixels.length !== secondPixels.length) return Number.POSITIVE_INFINITY
  let total = 0
  for (let index = 0; index < firstPixels.length; index += 1) {
    total += Math.abs(firstPixels[index]! - secondPixels[index]!)
  }
  return total / firstPixels.length
}

async function expectMeaningfulPng(
  png: Buffer,
  label: string,
): Promise<void> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  expect(info.width, `${label} 宽度`).toBeGreaterThan(320)
  expect(info.height, `${label} 高度`).toBeGreaterThan(180)
  const background = [
    data[0] ?? 0,
    data[1] ?? 0,
    data[2] ?? 0,
    data[3] ?? 0,
  ]
  let differentPixels = 0
  for (let index = 0; index < data.length; index += 4) {
    const difference =
      Math.abs((data[index] ?? 0) - background[0]!) +
      Math.abs((data[index + 1] ?? 0) - background[1]!) +
      Math.abs((data[index + 2] ?? 0) - background[2]!) +
      Math.abs((data[index + 3] ?? 0) - background[3]!)
    if (difference > 80) differentPixels += 1
  }
  const differentPixelRatio = differentPixels / (info.width * info.height)
  expect(
    differentPixelRatio,
    `${label} 与左上角背景有效区分的像素占比`,
  ).toBeGreaterThan(0.005)
}

async function capturePlayerCanvasEvidence(
  page: Page,
  screenshotPath: string,
  label: string,
): Promise<Buffer> {
  await expectCanvasPlayerScene(page, 0)
  await expect.poll(() => page.evaluate(() => {
    const player = window.__H5_LESSON_PLAYER__
    const renderedNodes = player?.playerScene?.renderedNodes ?? []
    return {
      sceneCount: player?.payload?.project?.scenes?.length ?? 0,
      textCount: renderedNodes.filter((node) => node.type === 'text').length,
      formulaCount: renderedNodes.filter((node) => node.type === 'formula').length,
    }
  })).toEqual({ sceneCount: 1, textCount: 3, formulaCount: 1 })
  await page.evaluate(async () => {
    await window.__H5_LESSON_PLAYER__?.waitForCaptureReady()
  })
  const png = await page.locator('.slide-published-adapter').screenshot({
    path: screenshotPath,
  })
  await expectMeaningfulPng(png, label)
  return png
}

async function addText(page: Page) {
  await page.getByRole('tab', { name: '元素' }).click()
  await page.getByRole('tab', { name: '常用' }).click()
  await page.getByTestId('add-text').click()
  await expect(page.locator('.runtime-preview-loading')).toHaveCount(0)
}

async function addRectangle(page: Page) {
  await page.getByRole('tab', { name: '元素' }).click()
  await page.getByRole('tab', { name: '常用' }).click()
  await page.getByTestId('add-rectangle').click()
}

async function dragElementToCanvas(
  page: Page,
  testId: string,
  logicalPoint: { x: number; y: number },
  expectedNodeCount: number,
): Promise<void> {
  const canvas = page.locator('[data-testid="canvas-stage"] canvas')
  const workspace = page.getByRole('main', { name: '课件画布' })
  const [canvasBounds, workspaceBounds] = await Promise.all([
    canvas.boundingBox(),
    workspace.boundingBox(),
  ])
  if (!canvasBounds || !workspaceBounds) {
    throw new Error('课件画布或工作区不可见')
  }
  // React owns dragover/drop on the workspace rather than the nested Phaser
  // canvas. Target the real listener while keeping the drop point inside the
  // canvas so Chromium preserves the custom courseware MIME payload.
  await page.getByTestId(testId).dragTo(workspace, {
    targetPosition: {
      x: canvasBounds.x - workspaceBounds.x +
        (logicalPoint.x / 1280) * canvasBounds.width,
      y: canvasBounds.y - workspaceBounds.y +
        (logicalPoint.y / 720) * canvasBounds.height,
    },
  })
  const elementsTab = page.getByRole('tab', { name: '元素' })
  await expect(elementsTab).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '图层' }).click()
  if (await authoredLayerRows(page).count() !== expectedNodeCount) {
    // Chromium/Electron can occasionally finish the pointer gesture without
    // delivering the HTML5 drop event. Replay the same browser-native drag
    // payload only when the store did not acknowledge the first drop.
    await elementsTab.click()
    await page.evaluate(
      ({ sourceTestId, clientX, clientY }) => {
        const source = document.querySelector<HTMLElement>(
          `[data-testid="${sourceTestId}"]`,
        )
        const target = document.querySelector<HTMLElement>(
          'main[aria-label="课件画布"]',
        )
        if (!source || !target) throw new Error('拖放源或课件画布不可见')
        const dataTransfer = new DataTransfer()
        const dispatch = (
          element: HTMLElement,
          type: 'dragstart' | 'dragover' | 'drop' | 'dragend',
        ) => element.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          dataTransfer,
        }))
        dispatch(source, 'dragstart')
        dispatch(target, 'dragover')
        dispatch(target, 'drop')
        dispatch(source, 'dragend')
      },
      {
        sourceTestId: testId,
        clientX: canvasBounds.x + (logicalPoint.x / 1280) * canvasBounds.width,
        clientY: canvasBounds.y + (logicalPoint.y / 720) * canvasBounds.height,
      },
    )
    await page.getByRole('tab', { name: '图层' }).click()
  }
  await expect(authoredLayerRows(page)).toHaveCount(expectedNodeCount)
}

function commonNodeField(page: Page, label: 'X' | 'Y' | '宽' | '高') {
  return page.locator('.property-section').first().getByLabel(label, { exact: true })
}

async function setCurrentNodeGeometry(
  page: Page,
  geometry: Partial<Record<'X' | 'Y' | '宽' | '高', number>>,
): Promise<void> {
  for (const [label, value] of Object.entries(geometry) as Array<
    ['X' | 'Y' | '宽' | '高', number]
  >) {
    const field = commonNodeField(page, label)
    await field.fill(String(value))
    await field.press('Enter')
  }
}

async function renameSelectedNode(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: '图层' }).click()
  const selectedNode = page.locator('.node-item--selected')
  await selectedNode.locator('.node-name').dblclick()
  const nameInput = selectedNode.locator('.node-name-input')
  await nameInput.fill(name)
  await nameInput.press('Enter')
  await expect(selectedNode.locator('.node-name')).toHaveText(name)
  await page.getByRole('tab', { name: '属性' }).click()
}

async function editDefaultText(page: Page, value: string) {
  await page.getByRole('tab', { name: '属性' }).click()
  await page.getByRole('button', { name: '编辑局部文字格式' }).click()
  const editor = page.getByTestId('text-edit-overlay')
  await editor.waitFor()
  await expect(editor).toBeFocused()
  await editor.fill(value)
  await expect(editor).toHaveText(value)
  await expect(editor).toBeFocused()
  await editor.press('Control+Enter')
  await expect(editor).toHaveCount(0)
  await page.waitForTimeout(500)
}

async function editDefaultTextWithComposition(page: Page, value: string) {
  await page.getByRole('tab', { name: '属性' }).click()
  await page.getByRole('button', { name: '编辑局部文字格式' }).click()
  const editor = page.getByTestId('text-edit-overlay')
  await editor.waitFor()
  await expect(editor).toBeFocused()
  await editor.dispatchEvent('compositionstart', { data: '中' })
  await editor.fill(value)
  await editor.press('Control+Enter')
  await expect(editor).toBeVisible()
  await editor.dispatchEvent('compositionend', { data: '中文' })
  // The overlay focuses itself in a deferred browser task after the pointer
  // sequence that opened it. Wait for that guard before exercising a real
  // keyboard blur so the test cannot race the initial focus transaction.
  await expect(editor).toBeFocused()
  await editor.press('Tab')
  await expect(editor).toHaveCount(0)
}

async function importExternalComponentThroughUi(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '组件', exact: true }).click()
  await page.getByTestId('import-external-components').click()
  await expect(page.getByRole('alertdialog', {
    name: '确认批量导入外部组件',
  })).toHaveCount(0)
  await expect(page.getByRole('dialog', {
    name: '外部组件批量导入结果',
  })).toHaveCount(0)
}

test.describe.serial(`${APP_NAME} 1.0 / Project V8 收敛`, () => {
  test.beforeAll(() => {
    mkdirSync(outputDir, { recursive: true })
    mkdirSync(visualOutputDirectory, { recursive: true })
    rmSync(e2eUserDataPath, { recursive: true, force: true })
    rmSync(formulaWebPackageDirectory, { recursive: true, force: true })
    rmSync(crossSurfaceEvidenceDirectory, { recursive: true, force: true })
    mkdirSync(crossSurfaceEvidenceDirectory, { recursive: true })
    for (const file of [
      projectPath,
      componentProjectPath,
      globalComponentProjectPath,
      globalNativeProjectPath,
      globalRuntimeAuthoringProjectPath,
      globalRuntimeAuthoringImportedPath,
      imageProjectPath,
      formulaProjectPath,
      formulaHtmlPath,
      formulaWebPackagePath,
      formulaPdfPath,
      formulaPptxPath,
      htmlPath,
      webPackagePath,
      htmlPreflightReportPath,
      pdfPath,
      pptxPath,
      runtimeApi2ExportProjectPath,
      runtimeApi2ExportPdfPath,
      runtimeApi2ExportPptxPath,
    ]) {
      if (existsSync(file)) rmSync(file)
    }
    const globalManifest = {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      supportedScopes: ['scene', 'global'],
      renderMode: 'phaser',
      id: 'com.example.global-nav',
      name: '全局导航条',
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 560, height: 96 },
      minSize: { width: 260, height: 64 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        content: {
          title: '课程导航',
          buttons: { replay: '重播本页', next: '下一页' },
        },
      },
      editor: {
        properties: [
          { key: 'content.title', label: '全局标题', type: 'text' },
          { key: 'content.buttons.next', label: '下一页文字', type: 'text' },
        ],
      },
    }
    const globalRuntime = `(function(){'use strict';window.CoursewareComponent.define({id:'com.example.global-nav',runtimeApiVersion:4,create:function(ctx){if(ctx.renderMode!=='phaser'){throw new Error('全局导航需要 Phaser 渲染面');}var scene=ctx.phaser.scene;var root=ctx.phaser.root;var bg=scene.add.rectangle(0,0,ctx.width,ctx.height,0x0f766e,0.96).setOrigin(0).setRounded(18);var title=scene.add.text(24,20,String(ctx.props.content.title),{fontFamily:'Microsoft YaHei',fontSize:'25px',fontStyle:'bold',color:'#ffffff'});var replay=scene.add.text(330,35,String(ctx.props.content.buttons.replay),{fontFamily:'Microsoft YaHei',fontSize:'18px',color:'#ccfbf1'}).setInteractive();var next=scene.add.text(450,35,String(ctx.props.content.buttons.next),{fontFamily:'Microsoft YaHei',fontSize:'18px',color:'#ffffff'}).setInteractive();replay.on('pointerup',ctx.actions.replayScene);next.on('pointerup',ctx.actions.nextScene);root.add([bg,title,replay,next]);return{destroy:function(){replay.off('pointerup',ctx.actions.replayScene);next.off('pointerup',ctx.actions.nextScene);}};}});})();`
    writeFileSync(
      globalComponentPath,
      Buffer.from(zipSync({
        'manifest.json': strToU8(`${JSON.stringify(globalManifest, null, 2)}\n`),
        'runtime.js': strToU8(globalRuntime),
      }, { level: 9 })),
    )
    const originalRuntimeAssetId = 'asset_runtime_authoring_original'
    const originalRuntimeAssetBytes = Uint8Array.from(readFileSync(firstImagePath))
    const authoringProject = createBlankCourseProject({
      id: 'project_runtime_authoring',
      title: '欢迎',
      now: '2026-08-18T12:00:00.000Z',
    })
    const slideSurface = authoringProject.surfaces.find((surface) => surface.type === 'slide')
    if (!slideSurface || slideSurface.type !== 'slide' || !slideSurface.scenes[0]) {
      throw new Error('空白 V9 工程缺少 Slide 场景')
    }
    const authoringScene = slideSurface.scenes[0]
    authoringScene.name = '欢迎'
    const authoringLocation = authoringProject.locations.find((location) => (
      location.kind === 'slide-scene' && location.sceneId === authoringScene.id
    ))
    if (authoringLocation) authoringLocation.label = '欢迎'
    authoringProject.assets[originalRuntimeAssetId] = {
      id: originalRuntimeAssetId,
      filename: 'runtime-authoring-original.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/runtime-authoring-original.png',
      byteLength: originalRuntimeAssetBytes.byteLength,
      width: 1024,
      height: 1024,
    }
    let nextOrder = nextUnifiedLayerOrder(authoringProject)
    authoringProject.globalLayerItems.push({
      item: makeLegacyDomRuntimeLayer({
        layerItemId: `runtime-global-${authoringProject.id}`,
        label: '全局运行时',
        order: nextOrder,
        source: `CoursewareRuntime.define({runtimeApiVersion:2,authoringApiVersion:1,create:function(ctx){var label=document.createElement('div');label.dataset.coursewareEditKey='title';label.dataset.coursewareEditLabel='全局标题';label.textContent=ctx.content.get('title');Object.assign(label.style,{position:'absolute',left:'240px',top:'160px',width:'360px',height:'72px',boxSizing:'border-box',padding:'16px 22px',border:'1px solid #60a5fa',borderRadius:'12px',color:'#eff6ff',background:'#172554',font:'600 28px Microsoft YaHei'});ctx.dom.overlay.append(label);return{destroy:function(){label.remove();}};}});`,
        values: { title: '全局画布初始标题' },
        metadata: { title: { label: '全局标题' } },
      }),
      visibility: { mode: 'all', locationIds: [] },
    })
    nextOrder += 1
    authoringScene.layerItems.push(makeLegacyDomRuntimeLayer({
      layerItemId: `runtime-${authoringScene.id}`,
      label: '场景运行时',
      order: nextOrder,
      source: `CoursewareRuntime.define({runtimeApiVersion:2,authoringApiVersion:1,create:function(ctx){var probe={mode:ctx.mode,authoring:Boolean(ctx.authoring)};if(ctx.authoring){probe.replayAccepted=ctx.actions.replayScene();ctx.courseState.set('e2e-authoring-write','changed');probe.stateAfterWrite=ctx.courseState.get('e2e-authoring-write');}window.__e2eSceneAuthoringProbe=probe;var label=document.createElement('div');label.dataset.coursewareEditKey='title';label.dataset.coursewareEditLabel='场景标题';label.textContent=ctx.content.get('title');Object.assign(label.style,{position:'absolute',left:'240px',top:'48px',width:'360px',height:'64px',boxSizing:'border-box',padding:'12px 20px',border:'1px solid #a78bfa',borderRadius:'12px',color:'#f5f3ff',background:'#4c1d95',font:'600 26px Microsoft YaHei'});var image=document.createElement('img');image.dataset.coursewareAssetKey='hero';image.dataset.coursewareEditLabel='场景主视觉';image.src=ctx.assets.url('hero');image.alt='场景主视觉';Object.assign(image.style,{position:'absolute',left:'920px',top:'480px',width:'150px',height:'150px',border:'2px solid #c4b5fd',borderRadius:'18px',objectFit:'cover'});ctx.dom.overlay.append(label,image);return{destroy:function(){label.remove();image.remove();}};}});`,
      values: { title: '场景画布初始标题' },
      metadata: { title: { label: '场景标题' } },
      assets: { hero: { assetId: originalRuntimeAssetId } },
    }))
    const persistedAuthoring = courseProjectDocumentSchema.parse(authoringProject)
    writeFileSync(
      globalRuntimeAuthoringProjectPath,
      createCourseProjectArchive({
        project: persistedAuthoring,
        assetFiles: { [originalRuntimeAssetId]: originalRuntimeAssetBytes },
        componentFiles: {},
      }, { mtime: '2026-08-18T12:00:00.000Z' }),
    )
    rmSync(webPackageDirectory, { recursive: true, force: true })
  })

  test('里程碑闭环：简洁模式完成文字、透明度、左起竖排与出现动画试运行', async () => {
    const { app, page, pageErrors, consoleErrors } = await launchEditor({
      mode: 'simple',
    })
    try {
      await expect(page.getByRole('tab', { name: '元素' })).toBeVisible()
      await expect(page.getByRole('tab', { name: '互动与动画' })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '开发' })).toHaveCount(0)
      await page.getByRole('tab', { name: '媒体' }).click()
      await expect(page.getByTestId('media-tab')).toBeVisible()
      await expect(page.getByTestId('add-image')).toHaveCount(0)
      await expect(page.getByTestId('add-video')).toHaveCount(0)
      await expect(page.getByTestId('import-audio')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '导入图片' })).toBeVisible()
      await expect(page.getByRole('button', { name: '导入声音' })).toBeVisible()
      await expect(page.getByRole('button', { name: '导入视频' })).toBeVisible()

      await addText(page)
      await page.getByRole('tab', { name: '属性' }).click()
      const transparency = page.getByLabel('透明度 %', { exact: true })
      await transparency.fill('50')
      await transparency.press('Enter')
      await expect(transparency).toHaveValue('50')

      await page.getByRole('button', { name: '展开字体列表' }).click()
      await expect(page.getByRole('option', {
        name: /微软雅黑，Microsoft YaHei，/,
      })).toBeVisible()
      await page.getByRole('button', { name: '收起字体列表' }).click()

      await page.getByLabel('文字方向').selectOption('vertical-lr')
      const height = commonNodeField(page, '高')
      await expect(height).toBeEnabled()
      await height.fill('260')
      await height.press('Enter')
      await expect(height).toHaveValue('260')

      const simpleMotion = page.getByTestId('simple-entrance-animation')
      await simpleMotion.getByRole('button', { name: '淡入' }).click()
      await expect(
        simpleMotion.getByRole('button', { name: '淡入' }),
      ).toHaveAttribute('aria-pressed', 'true')
      const authoringFrame = page.frames().find((frame) => (
        frame !== page.mainFrame() && frame.url().startsWith('blob:')
      ))
      if (!authoringFrame) throw new Error('统一编辑 Player iframe 未创建')
      const readTextMotionFrame = () => authoringFrame.evaluate(() => {
        const player = window.__H5_LESSON_PLAYER__
        const handle = player?.playerScene?.renderedNodes?.find(
          (item) => item.type === 'text',
        )
        const target = handle?.motionRoot ?? handle?.root
        return target
          ? {
              x: target.x,
              y: target.y,
              alpha: target.alpha,
              scaleX: target.scaleX,
              scaleY: target.scaleY,
              visible: target.visible,
            }
          : null
      })
      const stableMotionFrame = await readTextMotionFrame()
      if (!stableMotionFrame) throw new Error('文字动画视觉节点未创建')
      await simpleMotion.getByRole('button', { name: '预览' }).click()
      await expect.poll(async () => (await readTextMotionFrame())?.alpha ?? 1, {
        timeout: 2_000,
        intervals: [20, 30, 50],
      }).toBeLessThan(stableMotionFrame.alpha * 0.9)
      await expect.poll(async () => {
        const frame = await readTextMotionFrame()
        return frame && stableMotionFrame
          ? Math.abs(frame.alpha - stableMotionFrame.alpha) < 0.05 &&
              frame.x === stableMotionFrame.x &&
              frame.y === stableMotionFrame.y &&
              frame.scaleX === stableMotionFrame.scaleX &&
              frame.scaleY === stableMotionFrame.scaleY &&
              frame.visible === stableMotionFrame.visible
          : false
      }, { timeout: 10_000 }).toBe(true)

      await clickCanvasTryRun(page)
      await expectCoursePlayerTryRunReady(page)
      await page.getByTestId('course-try-run-next').click()
      await expect(page.getByTestId('course-try-run-host')).toBeVisible()
      await expect(page.getByTestId('course-try-run-next')).toBeEnabled()
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('里程碑闭环：专业模式创建、复制、排序规则并修改受控运行时', async () => {
    test.setTimeout(120_000)
    const { app, page, pageErrors, consoleErrors } = await launchEditor()
    try {
      await addText(page)
      await page.getByRole('tab', { name: '互动与动画' }).click()
      await page.getByRole('button', { name: '使用模板' }).click()
      await expect(page.getByRole('group', { name: '规则 1' })).toBeVisible()
      await page.getByRole('button', { name: '复制规则 1' }).click()
      await expect(page.getByRole('group', { name: '规则 2' })).toBeVisible()
      await page.getByRole('button', { name: '上移规则 2' }).click()

      await page.getByRole('tab', { name: '开发' }).click()
      await expect(page.getByText('工程开发工作台')).toBeVisible()
      await expect(page.getByRole('tab', { name: /^运行时/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^对象 JSON/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^规则 JSON/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^组件代码/ })).toBeVisible()
      expect(await page.locator('.right-sidebar--developer').evaluate(
        (element) => element.getBoundingClientRect().width,
      )).toBeGreaterThanOrEqual(450)
      await page.getByRole('button', { name: '创建运行时模板' }).click()
      const runtimeSource = page.getByRole('textbox', {
        name: '场景运行时源码',
      })
      await expect(runtimeSource).toHaveValue(/CoursewareRuntime\.define/)
      await expect(runtimeSource).toHaveAttribute('wrap', 'off')
      const runtimeEditor = runtimeSource.locator('xpath=ancestor::section[1]')
      await runtimeSource.fill(`${await runtimeSource.inputValue()}\n// Electron canonical source edit`)
      await runtimeEditor.getByRole('button', { name: '校验并应用' }).click()
      await expect(runtimeEditor.getByText(
        '校验通过，修改已写入工程历史。',
        { exact: true },
      )).toBeVisible()

      await slideSceneItems(page).first().click()
      await page.getByRole('tab', { name: '属性' }).click()
      const runtimeInspector = page.getByTestId('scene-runtime-inspector')
      await expect(runtimeInspector).toBeVisible()
      const enabled = runtimeInspector.getByRole('checkbox', { name: '启用运行时' })
      const renderMode = runtimeInspector.getByRole('combobox', { name: '渲染能力声明' })
      await expect(enabled).toBeChecked()
      await runtimeInspector.locator('.toggle-track').click()
      await expect(enabled).not.toBeChecked()
      await renderMode.selectOption('hybrid')
      await expect(renderMode).toHaveValue('hybrid')

      await page.getByRole('tab', { name: '开发' }).click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(runtimeInspector.getByRole('checkbox', { name: '启用运行时' }))
        .not.toBeChecked()
      await expect(runtimeInspector.getByRole('combobox', { name: '渲染能力声明' }))
        .toHaveValue('hybrid')
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('当前位置试运行：CoursePlayer 宿主可见且可互动', async () => {
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await page.getByLabel('导航控制方式').selectOption('none')
      await page.getByRole('button', { name: '专业' }).click()
      await page.getByRole('tab', { name: '互动与动画' }).click()
      await expect(
        page.getByRole('heading', { name: '互动与动画' }),
      ).toBeVisible()
      await page.getByTestId('add-content-primary').click()
      await expect(
        page.locator('[data-testid^="scene-item-"]').filter({ hasText: '场景 2' }),
      ).toHaveAttribute('aria-current', 'page')
      await page.getByRole('button', { name: '新建场景状态' }).click()
      await expect(page.getByRole('button', {
        name: /状态 2，命名状态/,
      })).toHaveAttribute('aria-pressed', 'true')
      await clickCanvasTryRun(page)

      await expectCoursePlayerTryRunReady(page)
      const host = page.getByTestId('course-try-run-host')
      const adapter = host.locator('.slide-published-adapter')
      const locationOnCurrent = await adapter.getAttribute('data-location-id')
      if (!locationOnCurrent) throw new Error('CoursePlayer 试运行未写入当前 location')
      await page.getByTestId('course-try-run-previous').click()
      await expect.poll(() => adapter.getAttribute('data-location-id'))
        .not.toBe(locationOnCurrent)
      await page.getByTestId('course-try-run-next').click()
      await expect.poll(() => adapter.getAttribute('data-location-id'))
        .toBe(locationOnCurrent)
      await expect(host).toHaveAttribute('data-course-player-ready', 'true')
      await expect(page.locator('iframe[title="当前位置试运行"]')).toHaveCount(0)

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('Player 与编辑交互层在 100%、150% 和重置后保持同位', async () => {
    test.setTimeout(90_000)
    const { app, page, pageErrors, consoleErrors } = await launchEditor()
    try {
      const playerFrame = page.locator('.runtime-preview-frame')
      await expect(playerFrame).toHaveAttribute('src', /^blob:/)
      const initialFrameSrc = await playerFrame.getAttribute('src')
      await addText(page)
      await expect.poll(() => playerFrame.getAttribute('src')).not.toBe(
        initialFrameSrc,
      )
      await expect(page.locator('.runtime-preview-loading')).toHaveCount(0, {
        timeout: 15_000,
      })
      await expect.poll(async () => {
        const currentSrc = await playerFrame.getAttribute('src')
        const frame = page.frames().find((candidate) => candidate.url() === currentSrc)
        return frame?.evaluate(() => (
          window.__H5_LESSON_PLAYER__?.playerScene?.renderedNodes
            ?.some((handle) => handle.type === 'text') ?? false
        )) ?? false
      }).toBe(true)
      await page.getByRole('tab', { name: '属性' }).click()
      const initialNodeBounds = {
        x: Number(await commonNodeField(page, 'X').inputValue()),
        y: Number(await commonNodeField(page, 'Y').inputValue()),
        width: Number(await commonNodeField(page, '宽').inputValue()),
        height: Number(await commonNodeField(page, '高').inputValue()),
      }
      const zoom = page.getByLabel('画布缩放比例')
      const stage = page.getByTestId('canvas-stage')
      const alignmentError = async () => {
        const [stageBounds, playerBounds] = await Promise.all([
          stage.boundingBox(),
          playerFrame.boundingBox(),
        ])
        if (!stageBounds || !playerBounds) return Number.POSITIVE_INFINITY
        return Math.max(
          Math.abs(stageBounds.x - playerBounds.x),
          Math.abs(stageBounds.y - playerBounds.y),
          Math.abs(stageBounds.width - playerBounds.width),
          Math.abs(stageBounds.height - playerBounds.height),
        )
      }
      await expect(zoom).toHaveText('100%')
      await expect.poll(alignmentError).toBeLessThan(0.75)
      const before = await stage.boundingBox()
      if (!before) throw new Error('统一画布不可见')
      for (let index = 0; index < 5; index += 1) {
        await page.getByRole('button', { name: '放大画布' }).click()
      }
      await expect(zoom).toHaveText('150%')
      await expect.poll(async () => (await stage.boundingBox())?.width ?? 0)
        .toBeCloseTo(before.width * 1.5, 0)
      await expect.poll(alignmentError).toBeLessThan(0.75)
      const viewportBounds = await page.locator('.canvas-viewport').boundingBox()
      const beforePan = await stage.boundingBox()
      if (!viewportBounds || !beforePan) throw new Error('画布平移区域不可见')
      await page.mouse.move(
        viewportBounds.x + viewportBounds.width / 2,
        viewportBounds.y + viewportBounds.height / 2,
      )
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(
        viewportBounds.x + viewportBounds.width / 2 + 84,
        viewportBounds.y + viewportBounds.height / 2 + 48,
        { steps: 4 },
      )
      await page.mouse.up({ button: 'middle' })
      await expect.poll(async () => {
        const bounds = await stage.boundingBox()
        if (!bounds) return 0
        return Math.hypot(bounds.x - beforePan.x, bounds.y - beforePan.y)
      }).toBeGreaterThan(80)
      await expect.poll(alignmentError).toBeLessThan(0.75)
      const pannedStage = await stage.boundingBox()
      if (!pannedStage) throw new Error('平移后的统一画布不可见')
      const textCenter = {
        x: pannedStage.x + (
          initialNodeBounds.x + initialNodeBounds.width / 2
        ) / 1280 * pannedStage.width,
        y: pannedStage.y + (
          initialNodeBounds.y + initialNodeBounds.height / 2
        ) / 720 * pannedStage.height,
      }
      const blankPoint = {
        x: pannedStage.x + 260 / 1280 * pannedStage.width,
        y: pannedStage.y + 140 / 720 * pannedStage.height,
      }
      await page.mouse.click(blankPoint.x, blankPoint.y)
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.locator('.node-item--selected')).toHaveCount(0)
      await page.mouse.click(textCenter.x, textCenter.y)
      await expect(page.getByRole('tab', { name: '属性' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.locator('.node-item--selected')).toHaveCount(1)
      await page.waitForTimeout(420)
      await page.getByRole('tab', { name: '属性' }).click()
      await page.mouse.move(textCenter.x, textCenter.y)
      await page.mouse.down()
      await page.mouse.move(textCenter.x + 60, textCenter.y + 30, { steps: 8 })
      await page.mouse.up()
      await expect.poll(async () => Number(
        await commonNodeField(page, 'X').inputValue(),
      )).toBeGreaterThan(initialNodeBounds.x + 30)
      await expect.poll(async () => Number(
        await commonNodeField(page, 'Y').inputValue(),
      )).toBeGreaterThan(initialNodeBounds.y + 15)
      await page.getByRole('button', { name: '适合窗口' }).click()
      await expect(zoom).toHaveText('100%')
      await expect.poll(async () => (await stage.boundingBox())?.width ?? 0)
        .toBeCloseTo(before.width, 0)
      await expect.poll(alignmentError).toBeLessThan(0.75)
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('统一画布：场景/全局运行时文字与图片可原位编辑并往返', async () => {
    test.setTimeout(120_000)
    const { app, page, pageErrors, consoleErrors } = await launchEditor()
    try {
      await patchDialogs(app, {
        projectOpen: globalRuntimeAuthoringProjectPath,
        projectSave: globalRuntimeAuthoringImportedPath,
        imageOpen: replacementImagePath,
      })
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(page.getByRole('alertdialog', { name: '需要显式导入旧版工程' }))
        .toHaveCount(0)
      await page.getByTestId('global-layer-entry').click()

      const target = page.getByRole('button', {
        name: '全局标题，双击编辑文字',
      })
      await expect(target).toBeVisible({ timeout: 15_000 })
      const playerFrame = page.locator('iframe[title="统一编辑画布"]')
      const authoringFrame = page.frames().find((frame) => (
        frame !== page.mainFrame() && frame.url().startsWith('blob:')
      ))
      if (!authoringFrame) throw new Error('统一编辑 Player iframe 未创建')
      const runtimeVisualAlignmentError = async (
        runtimeLabel: string,
        editKey: string,
        authoringTarget: typeof target,
      ) => {
        const [frameBounds, targetBounds, inner] = await Promise.all([
          playerFrame.boundingBox(),
          authoringTarget.boundingBox(),
          authoringFrame.evaluate(({ runtimeLabel: label, editKey: key }) => {
            const mounts = Array.from(
              document.querySelectorAll<HTMLElement>('.lesson-runtime-mount'),
            ).filter((candidate) => candidate.dataset.runtimeLabel?.startsWith(label))
            const element = mounts
              .map((mount) => mount.shadowRoot?.querySelector<HTMLElement>(
                `[data-courseware-edit-key="${key}"]`,
              ))
              .find((candidate): candidate is HTMLElement => Boolean(candidate))
            if (!element) return null
            const bounds = element.getBoundingClientRect()
            return {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              viewportWidth: document.documentElement.clientWidth,
              viewportHeight: document.documentElement.clientHeight,
            }
          }, { runtimeLabel, editKey }),
        ])
        if (!frameBounds || !targetBounds || !inner) {
          return Number.POSITIVE_INFINITY
        }
        const scaleX = frameBounds.width / inner.viewportWidth
        const scaleY = frameBounds.height / inner.viewportHeight
        return Math.max(
          Math.abs(targetBounds.x - (frameBounds.x + inner.x * scaleX)),
          Math.abs(targetBounds.y - (frameBounds.y + inner.y * scaleY)),
          Math.abs(targetBounds.width - inner.width * scaleX),
          Math.abs(targetBounds.height - inner.height * scaleY),
        )
      }
      const globalAlignmentError = () => runtimeVisualAlignmentError(
        '全局运行时',
        'title',
        target,
      )
      await expect.poll(globalAlignmentError).toBeLessThan(1)

      const zoom = page.getByLabel('画布缩放比例')
      for (let index = 0; index < 5; index += 1) {
        await page.getByRole('button', { name: '放大画布' }).click()
      }
      await expect(zoom).toHaveText('150%')
      await expect.poll(globalAlignmentError).toBeLessThan(1)
      const viewportBounds = await page.locator('.canvas-viewport').boundingBox()
      const beforePan = await playerFrame.boundingBox()
      if (!viewportBounds || !beforePan) throw new Error('统一画布平移区域不可见')
      await page.mouse.move(
        viewportBounds.x + viewportBounds.width / 2,
        viewportBounds.y + viewportBounds.height / 2,
      )
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(
        viewportBounds.x + viewportBounds.width / 2 + 72,
        viewportBounds.y + viewportBounds.height / 2 + 42,
        { steps: 4 },
      )
      await page.mouse.up({ button: 'middle' })
      await expect.poll(async () => {
        const bounds = await playerFrame.boundingBox()
        if (!bounds) return 0
        return Math.hypot(bounds.x - beforePan.x, bounds.y - beforePan.y)
      }).toBeGreaterThan(70)
      await expect.poll(globalAlignmentError).toBeLessThan(1)
      await target.focus()
      await page.screenshot({
        path: join(
          visualOutputDirectory,
          'editor-v17-unified-runtime-zoom-pan.png',
        ),
      })
      await page.getByRole('button', { name: '适合窗口' }).click()
      await expect(zoom).toHaveText('100%')
      await expect.poll(globalAlignmentError).toBeLessThan(1)

      await target.focus()
      await target.press('Enter')
      const editor = page.getByTestId('canvas-plain-text-editor')
      await expect(editor).toBeVisible()
      await editor.getByRole('textbox', { name: '全局标题' })
        .fill('全局画布新标题')
      await editor.getByRole('textbox', { name: '全局标题' }).press('Enter')
      await expect(editor).toHaveCount(0)

      await page.getByRole('button', {
        name: '打开场景“欢迎”；缩略图使用状态“初始”',
      }).click()
      const sceneTextTarget = page.getByRole('button', {
        name: '场景标题，双击编辑文字',
      })
      await expect(sceneTextTarget).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => authoringFrame.evaluate(
        () => window.__e2eSceneAuthoringProbe ?? null,
      )).toEqual({
        mode: 'capture',
        authoring: true,
        replayAccepted: false,
        stateAfterWrite: undefined,
      })
      await expect.poll(() => runtimeVisualAlignmentError(
        '场景运行时',
        'title',
        sceneTextTarget,
      )).toBeLessThan(1)
      await sceneTextTarget.focus()
      await sceneTextTarget.press('Enter')
      await expect(editor).toBeVisible()
      await editor.getByRole('textbox', { name: '场景标题' })
        .fill('场景画布新标题')
      await editor.getByRole('textbox', { name: '场景标题' }).press('Enter')
      await expect(editor).toHaveCount(0)

      const sceneAssetTarget = page.getByRole('button', {
        name: '场景主视觉，双击替换图片',
      })
      await expect(sceneAssetTarget).toBeVisible({ timeout: 15_000 })
      await sceneAssetTarget.focus()
      await sceneAssetTarget.press('Enter')
      await expect(page.locator('.runtime-preview-loading')).toHaveCount(0, {
        timeout: 15_000,
      })
      await expect(page.locator('.status-bar')).toContainText(
        '已替换运行时图片',
      )

      await page.getByRole('button', { name: '另存为' }).click()
      await expect.poll(() => {
        const saved = readSavedCourseProjectArchive(globalRuntimeAuthoringImportedPath)
        if (!saved) return null
        const { project, assetFiles } = saved
        const globalRuntime = project.globalLayerItems
          .map((entry) => entry.item)
          .find((item) => item.kind === 'runtime')
        const sceneRuntime = firstSlideSceneLayerItems(project)
          .find((item) => item.kind === 'runtime')
        if (globalRuntime?.kind !== 'runtime' || sceneRuntime?.kind !== 'runtime') {
          return null
        }
        const replacementAssetId = sceneRuntime.runtime.assets.hero?.assetId
        return {
          schemaVersion: project.schemaVersion,
          locationKind: project.locations[0]?.kind ?? null,
          surfaceType: project.surfaces.find((surface) => surface.type === 'slide')?.type
            ?? null,
          globalTitle: globalRuntime.runtime.content.values.title ?? null,
          sceneTitle: sceneRuntime.runtime.content.values.title ?? null,
          replacementAssetChanged:
            Boolean(replacementAssetId) &&
            replacementAssetId !== 'asset_runtime_authoring_original',
          replacementAssetExists: Boolean(
            replacementAssetId && project.assets[replacementAssetId],
          ),
          replacementBytesExist: Boolean(
            replacementAssetId && assetFiles[replacementAssetId],
          ),
        }
      }).toEqual({
        schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
        locationKind: 'slide-scene',
        surfaceType: 'slide',
        globalTitle: '全局画布新标题',
        sceneTitle: '场景画布新标题',
        replacementAssetChanged: true,
        replacementAssetExists: true,
        replacementBytesExist: true,
      })

      await patchDialogs(app, {
        projectOpen: globalRuntimeAuthoringImportedPath,
      })
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(page.getByRole('alertdialog', { name: '需要显式导入旧版工程' }))
        .toHaveCount(0)
      await page.getByTestId('global-layer-entry').click()
      const reopenedGlobalTarget = page.getByRole('button', {
        name: '全局标题，双击编辑文字',
      })
      await expect(reopenedGlobalTarget).toBeVisible({ timeout: 15_000 })
      await reopenedGlobalTarget.focus()
      await reopenedGlobalTarget.press('Enter')
      await expect(editor.getByRole('textbox', { name: '全局标题' }))
        .toHaveValue('全局画布新标题')
      await editor.getByRole('textbox', { name: '全局标题' }).press('Escape')
      await expect(editor).toHaveCount(0)

      await page.getByRole('button', {
        name: '打开场景“欢迎”；缩略图使用状态“初始”',
      }).click()
      const reopenedSceneTextTarget = page.getByRole('button', {
        name: '场景标题，双击编辑文字',
      })
      await expect(reopenedSceneTextTarget).toBeVisible({ timeout: 15_000 })
      await reopenedSceneTextTarget.focus()
      await reopenedSceneTextTarget.press('Enter')
      await expect(editor.getByRole('textbox', { name: '场景标题' }))
        .toHaveValue('场景画布新标题')
      await editor.getByRole('textbox', { name: '场景标题' }).press('Escape')
      await expect(editor).toHaveCount(0)
      await expect(page.getByRole('button', {
        name: '场景主视觉，双击替换图片',
      })).toBeVisible({ timeout: 15_000 })

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 1：场景新增、排序与删除', async () => {
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await page.getByTestId('add-content-primary').click()
      await page.getByTestId('add-content-primary').click()
      await expect(slideSceneItems(page)).toHaveCount(3)

      const before = await slideSceneItems(page).locator('span').allTextContents()
      expect(before).toEqual(['场景 1', '场景 2', '场景 3'])
      const lastItem = slideSceneTreeNodes(page).last()
      await moveSortableUp(lastItem.locator('.drag-handle'), 2)
      await expect
        .poll(() => slideSceneItems(page).locator('span').allTextContents())
        .toEqual(['场景 3', '场景 1', '场景 2'])

      await slideSceneTreeNodes(page)
        .nth(1)
        .locator('.icon-button--danger')
        .click()
      await page.getByRole('button', { name: '删除场景' }).last().click()
      await expect(slideSceneItems(page)).toHaveCount(2)
      await expect
        .poll(() => slideSceneItems(page).locator('span').allTextContents())
        .toEqual(['场景 3', '场景 2'])
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 2：中文文本、位置、样式与工程往返', async () => {
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        projectSave: projectPath,
        projectOpen: projectPath,
      })
      await addText(page)
      await editDefaultTextWithComposition(
        page,
        '中文课件标题\n第二行内容\n第三行用于验证自动高度',
      )
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.locator('.form-textarea')).toHaveValue(
        '中文课件标题\n第二行内容\n第三行用于验证自动高度',
      )
      const fontSize = page
        .locator('.property-section')
        .filter({ hasText: '文本' })
        .locator('.form-field')
        .filter({ hasText: '字号' })
        .locator('input')
      await fontSize.fill('52')
      await fontSize.press('Enter')
      await page.locator('#text-color-text').fill('#c026d3')
      await page.locator('#text-color-text').press('Enter')
      const xInput = commonNodeField(page, 'X')
      await xInput.fill('560')
      await xInput.press('Enter')

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(() => existsSync(projectPath)).toBe(true)
      expect(readFileSync(projectPath).subarray(0, 2).toString()).toBe('PK')

      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-name').filter({ hasText: '文本' }).click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.locator('.form-textarea')).toHaveValue(
        '中文课件标题\n第二行内容\n第三行用于验证自动高度',
      )
      await expect(fontSize).toHaveValue('52')
      await expect(page.locator('#text-color-text')).toHaveValue('#c026d3')
      await expect(xInput).toHaveValue('560')
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('文字编辑事务：resize、属性栏、切换节点、字体、IME 与撤销', async () => {
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await addText(page)
      await expect(page.getByRole('tab', { name: '元素' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-item--selected .node-name').click()
      await expect(page.getByRole('tab', { name: '属性' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('button', { name: '编辑局部文字格式' }).click()
      const editor = page.getByTestId('text-edit-overlay')
      const textarea = page.getByRole('textbox', { name: '文字内容' })
      await expect(editor).toBeVisible()
      await editor.fill('画布编辑中的草稿')
      await expect(textarea).toHaveValue('画布编辑中的草稿')

      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const [width, height] = window.getSize()
        window.setSize(Math.max(1100, width - 120), Math.max(720, height - 80))
      })
      await page.waitForTimeout(150)
      await expect(editor).toHaveText('画布编辑中的草稿')

      await textarea.click()
      await expect(editor).toHaveCount(0)
      await textarea.fill('属性栏最终文字')
      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await expect(textarea).toHaveValue('画布编辑中的草稿')
      await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
      await expect(textarea).toHaveValue('属性栏最终文字')

      const fontInput = page.getByRole('combobox', { name: '字体' })
      await page.getByRole('button', { name: '展开字体列表' }).click()
      await expect(page.getByRole('listbox', { name: '常用字体' })).toBeVisible()
      await expect(page.getByRole('option', {
        name: /微软雅黑，Microsoft YaHei，/,
      })).toBeVisible()
      await expect(fontInput).not.toHaveValue('')
      await page.screenshot({
        path: join(visualOutputDirectory, 'font-family-dropdown.png'),
        fullPage: true,
      })
      await page.getByRole('option', { name: /楷体，KaiTi，/ }).click()
      await expect(fontInput).toHaveValue('KaiTi')
      expect(
        await page.getByTestId('font-family-preview').evaluate(
          (element) => getComputedStyle(element).fontFamily,
        ),
      ).toContain('KaiTi')

      await addRectangle(page)
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-name').filter({ hasText: '文本' }).click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(
        '属性栏最终文字',
      )
      await expect(page.getByRole('combobox', { name: '字体' })).toHaveValue('KaiTi')

      await page.getByRole('button', { name: '编辑局部文字格式' }).click()
      await expect(editor).toBeVisible()
      await editor.dispatchEvent('compositionstart', { data: '中' })
      await editor.fill('中文组合输入')
      await editor.press('Control+Enter')
      await expect(editor).toBeVisible()
      await editor.dispatchEvent('compositionend', { data: '中文组合输入' })
      await textarea.click()
      await expect(editor).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(
        '中文组合输入',
      )

      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(
        '属性栏最终文字',
      )
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('P0：画布真实双击可持续输入、失焦单次提交且 Escape 取消', async () => {
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await addText(page)
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      await page.waitForTimeout(250)
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error('编辑画布不可见')
      const textCenter = {
        x: bounds.x + (640 / 1280) * bounds.width,
        y: bounds.y + (360 / 720) * bounds.height,
      }

      // Exercise the real Phaser pointer path instead of opening the editor
      // through the properties-panel shortcut.
      await page.mouse.dblclick(textCenter.x, textCenter.y, { delay: 40 })
      const editor = page.getByTestId('text-edit-overlay')
      const textarea = page.getByRole('textbox', { name: '文字内容' })
      await expect(editor).toBeVisible()
      await expect(editor).toBeFocused()
      await page.waitForTimeout(120)
      await expect(editor).toBeFocused()

      await editor.press('Control+A')
      await page.keyboard.insertText('画布双击可编辑')
      await expect(editor).toHaveText('画布双击可编辑')
      await expect(textarea).toHaveValue('画布双击可编辑')
      await page.screenshot({
        path: join(visualOutputDirectory, 'text-double-click-editing.png'),
      })

      // Moving directly into the properties field must commit the canvas
      // session once, then let the properties field own the next session.
      await textarea.click()
      await expect(editor).toHaveCount(0)
      await expect(textarea).toBeFocused()
      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await expect(textarea).toHaveValue('双击编辑文字')
      await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
      await expect(textarea).toHaveValue('画布双击可编辑')

      await page.waitForTimeout(450)
      await page.mouse.dblclick(textCenter.x, textCenter.y, { delay: 40 })
      await expect(editor).toBeFocused()
      await editor.press('Control+A')
      await page.keyboard.insertText('这次编辑应被取消')
      await expect(textarea).toHaveValue('这次编辑应被取消')
      await editor.press('Escape')
      await expect(editor).toHaveCount(0)
      await expect(textarea).toHaveValue('画布双击可编辑')

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 3：节点层级排序与撤销', async () => {
    const { app, page, pageErrors } = await launchEditor()
    try {
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      await addRectangle(page)
      await addText(page)
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(2)
      const before = await authoredLayerRows(page).locator('.node-name').allTextContents()
      const canvasBefore = await canvas.screenshot()
      await moveSortableUp(
        authoredLayerRows(page).last().locator('.drag-handle'),
        1,
      )
      await expect
        .poll(() => authoredLayerRows(page).locator('.node-name').allTextContents())
        .toEqual([...before].reverse())
      await expect(page.locator('.node-item--selected')).toHaveCount(1)
      await page.waitForTimeout(200)
      const canvasAfter = await canvas.screenshot()
      const reorderedDifference = await averagePixelDifference(
        canvasBefore,
        canvasAfter,
      )
      expect(reorderedDifference).toBeGreaterThan(0.05)
      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await expect
        .poll(() => authoredLayerRows(page).locator('.node-name').allTextContents())
        .toEqual(before)
      await expect(page.locator('.node-item--selected')).toHaveCount(1)
      await page.waitForTimeout(200)
      const restoredDifference = await averagePixelDifference(
        canvasBefore,
        await canvas.screenshot(),
      )
      expect(restoredDifference).toBeLessThan(reorderedDifference * 0.6)
      expect(pageErrors).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 4：组件导入、保存重开与预览交互', async () => {
    expect(existsSync(sampleComponentPath)).toBe(true)
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        projectSave: componentProjectPath,
        projectOpen: componentProjectPath,
        componentOpen: sampleComponentPath,
      })
      await importExternalComponentThroughUi(page)
      const componentCard = page.getByTestId('component-com.example.sample-counter')
      await componentCard.waitFor()
      await componentCard.click()
      await expect(page.getByRole('tab', { name: '组件', exact: true }))
        .toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(1)
      await authoredLayerRows(page).locator('.node-name').click()
      await expect(page.getByRole('tab', { name: '属性' }))
        .toHaveAttribute('aria-selected', 'true')

      const componentTitle = page.getByLabel('组件标题', { exact: true })
      const componentInitialValue = page.getByLabel('初始数值', { exact: true })
      await componentTitle.fill('课堂积分器')
      await componentTitle.blur()
      await componentInitialValue.fill('7')
      await componentInitialValue.blur()
      await expect(componentTitle).toHaveValue('课堂积分器')
      await expect(componentInitialValue).toHaveValue('7')

      const editorCanvas = page.locator('[data-testid="canvas-stage"] canvas')
      const editorBounds = await editorCanvas.boundingBox()
      if (!editorBounds) throw new Error('编辑画布不可见')
      const designPoint = (x: number, y: number) => ({
        x: editorBounds.x + (x / 1280) * editorBounds.width,
        y: editorBounds.y + (y / 720) * editorBounds.height,
      })
      const gestureSteps = backgroundE2e === '1' ? 4 : 20

      await expect(
        page.getByRole('button', { name: '组件标题，双击编辑组件文字' }),
      ).toHaveCount(1)
      const titlePoint = designPoint(470, 252)
      await page.mouse.dblclick(titlePoint.x, titlePoint.y, { delay: 40 })
      const canvasTextEditor = page.getByTestId('canvas-plain-text-editor')
      await expect(canvasTextEditor).toBeVisible()
      await canvasTextEditor.getByRole('textbox', { name: '组件标题' })
        .fill('画布内积分器')
      await canvasTextEditor.getByRole('textbox', { name: '组件标题' })
        .press('Enter')
      await expect(canvasTextEditor).toHaveCount(0)
      await expect(componentTitle).toHaveValue('画布内积分器')

      const dragStart = designPoint(460, 270)
      const dragEnd = designPoint(520, 310)
      await page.mouse.move(dragStart.x, dragStart.y)
      await page.mouse.down()
      await page.waitForTimeout(100)
      await page.mouse.move(dragEnd.x, dragEnd.y, { steps: gestureSteps })
      await page.waitForTimeout(100)
      await page.mouse.up()
      await page.waitForTimeout(200)

      const movedX = Number(await commonNodeField(page, 'X').inputValue())
      const movedY = Number(await commonNodeField(page, 'Y').inputValue())
      expect(movedX).toBeGreaterThan(400)
      expect(movedY).toBeGreaterThan(220)

      const resizeStart = designPoint(movedX + 480, movedY + 280)
      const resizeEnd = designPoint(movedX + 560, movedY + 327)
      await page.mouse.move(resizeStart.x, resizeStart.y)
      await page.mouse.down()
      await page.waitForTimeout(100)
      await page.mouse.move(resizeEnd.x, resizeEnd.y, { steps: gestureSteps })
      await page.waitForTimeout(100)
      await page.mouse.up()
      await page.waitForTimeout(200)
      const resizedWidth = Number(await commonNodeField(page, '宽').inputValue())
      const resizedHeight = Number(await commonNodeField(page, '高').inputValue())
      expect(resizedWidth).toBeGreaterThan(480)
      expect(resizedHeight).toBeGreaterThan(280)

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(() => existsSync(componentProjectPath)).toBe(true)
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(1)
      await authoredLayerRows(page).locator('.node-name').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(commonNodeField(page, 'X')).toHaveValue(String(movedX))
      await expect(commonNodeField(page, 'Y')).toHaveValue(String(movedY))
      await expect(commonNodeField(page, '宽')).toHaveValue(String(resizedWidth))
      await expect(commonNodeField(page, '高')).toHaveValue(String(resizedHeight))
      await expect(page.getByLabel('组件标题', { exact: true })).toHaveValue('画布内积分器')
      await expect(page.getByLabel('初始数值', { exact: true })).toHaveValue('7')

      const { overlay: previewOverlay, adapter: previewAdapter } =
        await openCoursePreviewOverlay(page)
      await expectBackgroundWindowsIsolated(app)
      await expect(previewAdapter).toBeVisible()
      await closeCoursePreviewOverlay(page)
      await expect(previewOverlay).toHaveCount(0)

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('V8 全局层：原生元素、双击文字、保存重开与跨场景可见性', async () => {
    test.setTimeout(90_000)
    expect(existsSync(firstImagePath)).toBe(true)
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        imageOpen: firstImagePath,
        projectSave: globalNativeProjectPath,
        projectOpen: globalNativeProjectPath,
      })
      await page.getByTestId('add-content-primary').click()
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByTestId('add-text').click()

      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      await expect(page.locator('.runtime-preview-loading')).toHaveCount(0)
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error('全局层编辑画布不可见')
      await page.mouse.dblclick(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        { delay: 40 },
      )
      const editor = page.getByTestId('text-edit-overlay')
      const textarea = page.getByRole('textbox', { name: '文字内容' })
      await expect(editor).toBeFocused()
      await editor.press('Control+A')
      await page.keyboard.insertText('全课程统一标题')
      await expect(textarea).toHaveValue('全课程统一标题')
      await textarea.click()
      await expect(editor).toHaveCount(0)

      await page.getByLabel('图层位置').selectOption('underlay')
      await page.getByLabel('场景可见范围').selectOption('include')
      await page.getByLabel('场景 1', { exact: true }).check()

      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByTestId('add-image').click()
      await page.waitForTimeout(500)
      await expect(page.getByRole('tab', { name: '元素' }))
        .toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-item--selected .node-name').click()
      await expect(page.getByRole('tab', { name: '属性' }))
        .toHaveAttribute('aria-selected', 'true')
      await commonNodeField(page, 'X').fill('1020')
      await commonNodeField(page, 'X').press('Enter')
      await commonNodeField(page, 'Y').fill('20')
      await commonNodeField(page, 'Y').press('Enter')
      await commonNodeField(page, '宽').fill('180')
      await commonNodeField(page, '宽').press('Enter')
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByTestId('add-shape-rounded-rectangle').click()
      await expect(page.getByRole('tab', { name: '元素' }))
        .toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-item--selected .node-name').click()
      await expect(page.getByRole('tab', { name: '属性' }))
        .toHaveAttribute('aria-selected', 'true')
      await commonNodeField(page, 'X').fill('40')
      await commonNodeField(page, 'X').press('Enter')
      await commonNodeField(page, 'Y').fill('620')
      await commonNodeField(page, 'Y').press('Enter')
      await commonNodeField(page, '宽').fill('1200')
      await commonNodeField(page, '宽').press('Enter')
      await commonNodeField(page, '高').fill('60')
      await commonNodeField(page, '高').press('Enter')

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(() => existsSync(globalNativeProjectPath)).toBe(true)
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.locator('.node-item')).toHaveCount(4)
      await expect(teacherControllerLayerRows(page)).toHaveCount(1)
      await page.locator('.node-item').filter({ hasText: '文本' }).locator('.node-name').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByRole('textbox', { name: '文字内容' })).toHaveValue(
        '全课程统一标题',
      )
      await expect(page.getByTestId('global-layer-settings')).toBeVisible()
      await page.screenshot({
        path: join(visualOutputDirectory, 'editor-v4-global-native-layer.png'),
        fullPage: true,
      })

      const { adapter: previewAdapter } = await openCoursePreviewOverlay(page)
      await expectBackgroundWindowsIsolated(app)
      const shownOnFirst = await previewAdapter.screenshot()
      const firstLocation = await previewAdapter.getAttribute('data-location-id')
      await page.getByTestId('course-preview-next').click()
      if (firstLocation) {
        await expect.poll(() => previewAdapter.getAttribute('data-location-id'))
          .not.toBe(firstLocation)
      }
      const hiddenOnSecond = await previewAdapter.screenshot()
      expect(await averagePixelDifference(shownOnFirst, hiddenOnSecond)).toBeGreaterThan(0.001)
      await closeCoursePreviewOverlay(page)

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('Component API 4 全局组件：组件范围、全部文案、保存重开与预览可见性', async () => {
    test.setTimeout(90_000)
    expect(existsSync(globalComponentPath)).toBe(true)
    const { app, page, pageErrors, consoleErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        projectSave: globalComponentProjectPath,
        projectOpen: globalComponentProjectPath,
        componentOpen: globalComponentPath,
      })
      await importExternalComponentThroughUi(page)
      await page.getByTestId('add-content-primary').click()
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '元素' }).click()
      await expect(page.getByTestId('global-elements-notice')).toBeVisible()
      await page.getByRole('tab', { name: '组件', exact: true }).click()
      await page.getByTestId('component-com.example.global-nav').click()

      await page.getByRole('tab', { name: '属性' }).click()
      await page.getByLabel('全局标题', { exact: true }).fill('教师全局导航')
      await page.getByLabel('全局标题', { exact: true }).blur()
      await page.getByLabel('下一页文字', { exact: true }).fill('继续学习')
      await page.getByLabel('下一页文字', { exact: true }).blur()
      const autoExposedReplay = page.getByLabel('buttons / replay', { exact: true })
      await expect(autoExposedReplay).toHaveValue('重播本页')
      await autoExposedReplay.fill('重新讲解')
      await autoExposedReplay.blur()

      await page.getByLabel('图层位置').selectOption('overlay')
      await page.getByLabel('场景可见范围').selectOption('include')
      await page.getByLabel('场景 2', { exact: true }).check()

      const geometryInputs = page.locator('.property-section').first().locator('.form-input')
      const originalX = await geometryInputs.nth(1).inputValue()
      await geometryInputs.nth(1).fill('610')
      await geometryInputs.nth(1).press('Enter')
      await expect(geometryInputs.nth(1)).toHaveValue('610')
      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await expect(geometryInputs.nth(1)).toHaveValue(originalX)
      await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）' }).click()
      await expect(geometryInputs.nth(1)).toHaveValue('610')

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(() => existsSync(globalComponentProjectPath)).toBe(true)
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.locator('.node-item')).toHaveCount(2)
      await expect(teacherControllerLayerRows(page)).toHaveCount(1)
      await page
        .locator('.node-item')
        .filter({ hasText: '全局导航条' })
        .locator('.node-name')
        .click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByLabel('全局标题', { exact: true })).toHaveValue('教师全局导航')
      await expect(page.getByLabel('下一页文字', { exact: true })).toHaveValue('继续学习')
      await expect(page.getByLabel('buttons / replay', { exact: true })).toHaveValue('重新讲解')
      await page.screenshot({
        path: join(visualOutputDirectory, 'editor-v4-global-component-layer.png'),
        fullPage: true,
      })

      const { adapter: previewAdapter } = await openCoursePreviewOverlay(page)
      await expectBackgroundWindowsIsolated(app)
      const hiddenOnFirst = await previewAdapter.screenshot()
      const firstLocation = await previewAdapter.getAttribute('data-location-id')
      await page.getByTestId('course-preview-next').click()
      if (firstLocation) {
        await expect.poll(() => previewAdapter.getAttribute('data-location-id'))
          .not.toBe(firstLocation)
      }
      const shownOnSecond = await previewAdapter.screenshot()
      expect(await averagePixelDifference(hiddenOnFirst, shownOnSecond)).toBeGreaterThan(0.02)
      await closeCoursePreviewOverlay(page)

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('Runtime API 2 / Component API 4 导出：等待 DOM 运行时后生成 PDF，并在 PPTX 保留动态层、全局 visibility 与原生文字', async () => {
    test.setTimeout(90_000)
    const sourceArchive = unzipSync(
      new Uint8Array(readFileSync(globalComponentProjectPath)),
    )
    const projectEntry = sourceArchive['project.json']
    if (!projectEntry) throw new Error('Runtime API 2 导出夹具缺少 project.json')
    const project = courseProjectDocumentSchema.parse(JSON.parse(
      strFromU8(projectEntry),
    ) as unknown)
    const globalRuntimeSource = `CoursewareRuntime.define({runtimeApiVersion:2,create:function(ctx){var banner=document.createElement('div');banner.textContent=ctx.content.get('status');Object.assign(banner.style,{position:'absolute',left:'36px',top:'32px',padding:'14px 20px',borderRadius:'12px',color:'#ffffff',background:'#be123c',font:'bold 28px Microsoft YaHei',pointerEvents:'none'});ctx.dom.overlay.append(banner);ctx.capture.waitUntil(new Promise(function(resolve){setTimeout(function(){banner.dataset.captureReady='true';resolve();},80);}));return{destroy:function(){banner.remove();}};}});`
    const sceneRuntimeSource = `CoursewareRuntime.define({runtimeApiVersion:2,create:function(ctx){var label=document.createElement('div');label.textContent=ctx.content.get('hint');Object.assign(label.style,{position:'absolute',left:'300px',top:'300px',padding:'18px 26px',color:'#ffffff',background:'#1d4ed8',font:'bold 30px Microsoft YaHei',pointerEvents:'none'});ctx.dom.underlay.append(label);ctx.capture.waitUntil(new Promise(function(resolve){setTimeout(function(){label.dataset.captureReady='true';resolve();},100);}));return{destroy:function(){label.remove();}};}});`
    const firstScene = project.surfaces.find((surface) => surface.type === 'slide')
    if (!firstScene || firstScene.type !== 'slide' || !firstScene.scenes[0]) {
      throw new Error('Runtime API 2 导出夹具缺少 Slide 场景')
    }
    const scene = firstScene.scenes[0]
    let nextOrder = nextUnifiedLayerOrder(project)
    project.globalLayerItems.push({
      item: makeLegacyDomRuntimeLayer({
        layerItemId: `runtime-global-${project.id}`,
        label: '全局运行时',
        order: nextOrder,
        source: globalRuntimeSource,
        values: { status: '全局运行时已完成捕获等待' },
      }),
      visibility: { mode: 'all', locationIds: [] },
    })
    nextOrder += 1
    scene.layerItems.push(makeLegacyDomRuntimeLayer({
      layerItemId: `runtime-${scene.id}`,
      label: '场景运行时',
      order: nextOrder,
      source: sceneRuntimeSource,
      values: { hint: '场景运行时底层快照' },
    }))
    nextOrder += 1
    scene.layerItems.push({
      layerItemId: 'runtime-api2-export-editable-text',
      label: 'Runtime API 2 导出可编辑文字',
      kind: 'native',
      frame: { mode: 'absolute', x: 300, y: 120, width: 680, height: 120 },
      order: nextOrder,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      content: {
        nativeType: 'text',
        data: {
          text: 'PPTX 原生文字仍可编辑',
          runs: [],
          style: {
            fontFamily: 'Microsoft YaHei',
            fontSize: 42,
            color: '#111827',
            bold: true,
            italic: false,
            underline: false,
            strike: false,
            emphasis: false,
            highlightColor: null,
            align: 'center',
            verticalAlign: 'middle',
            writingMode: 'horizontal',
            lineSpacing: 0,
            letterSpacing: 0,
            padding: 8,
            overflow: 'fixed',
            backgroundColor: '#ffffff',
            backgroundOpacity: 0.86,
            cornerRadius: 12,
          },
        },
      },
    })
    project.updatedAt = new Date().toISOString()
    const persisted = courseProjectDocumentSchema.parse(project)
    sourceArchive['project.json'] = strToU8(
      `${JSON.stringify(persisted, null, 2)}\n`,
    )
    writeFileSync(
      runtimeApi2ExportProjectPath,
      Buffer.from(zipSync(sourceArchive, { level: 6 })),
    )

    const globalComponent = persisted.globalLayerItems.find(
      (entry) => entry.item.kind === 'component',
    )
    if (!globalComponent) {
      throw new Error('Runtime API 2 导出夹具缺少全局组件')
    }
    const globalObjectName = `${globalComponent.item.label} · ${globalComponent.item.layerItemId}`
    const {
      app,
      page,
      pageErrors,
      consoleWarnings,
      externalRequests,
    } = await launchEditor()
    try {
      await patchDialogs(app, {
        projectOpen: runtimeApi2ExportProjectPath,
        pdfSave: runtimeApi2ExportPdfPath,
        pptxSave: runtimeApi2ExportPptxPath,
      })
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(slideSceneItems(page)).toHaveCount(2)
      await expect.poll(
        () => slideSceneItems(page).locator('span').allTextContents(),
      ).toEqual(['场景 1', '场景 2'])

      const exportMenuTrigger = page.getByTestId('export-menu-trigger')
      await expect(exportMenuTrigger).toHaveAttribute('aria-disabled', 'false')
      await exportMenuTrigger.click()
      await page.getByTestId('export-pdf').click()
      const pdfPreflight = page.getByRole('alertdialog', {
        name: 'PDF 导出预检',
      })
      await expect(pdfPreflight).toBeVisible()
      await expect(pdfPreflight).toContainText('0 个错误')
      await pdfPreflight.getByRole('button', { name: '继续导出' }).click()
      // The native save path becomes visible as soon as the writer opens it.
      // Wait for the complete multi-page payload instead of racing a partial PDF.
      await expect.poll(
        () => existsSync(runtimeApi2ExportPdfPath)
          ? statSync(runtimeApi2ExportPdfPath).size
          : 0,
        { timeout: 30_000 },
      ).toBeGreaterThan(8_000)
      const pdf = readFileSync(runtimeApi2ExportPdfPath)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdf.byteLength).toBeGreaterThan(8_000)

      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-pptx').click()
      const pptxPreflight = page.getByRole('alertdialog', {
        name: 'PPTX 导出预检',
      })
      await expect(pptxPreflight).toBeVisible()
      await expect(pptxPreflight).toContainText('0 个错误')
      await pptxPreflight.getByRole('button', { name: '继续导出' }).click()
      await expect.poll(
        () => existsSync(runtimeApi2ExportPptxPath)
          ? statSync(runtimeApi2ExportPptxPath).size
          : 0,
        { timeout: 45_000 },
      ).toBeGreaterThan(1_000)
      const pptxArchive = unzipSync(
        new Uint8Array(readFileSync(runtimeApi2ExportPptxPath)),
      )
      const slide1 = new TextDecoder().decode(
        pptxArchive['ppt/slides/slide1.xml'],
      )
      const slide2 = new TextDecoder().decode(
        pptxArchive['ppt/slides/slide2.xml'],
      )
      expect(consoleWarnings).toEqual([])
      expect(slide1).toContain('PPTX 原生文字仍可编辑')
      expect(slide1).toContain('全局自由运行时 · 顶层实际播放器快照')
      expect(slide1).toContain(
        '场景自由运行时“场景 1” · 底层实际播放器快照',
      )
      expect(slide1).not.toContain(globalObjectName)
      expect(slide2).toContain(globalObjectName)
      expect(slide2).toContain('全局自由运行时 · 顶层实际播放器快照')
      expect(slide1).not.toContain('静态导出警告')
      expect(slide2).not.toContain('静态导出警告')
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('整课预览：后台教师控制器可拖动、键盘细移并保持会话位置', async ({}, testInfo) => {
    testInfo.annotations.push({
      type: 'touch-coverage',
      description:
        'Electron Playwright 启动器不能创建 hasTouch 浏览器上下文；脚本合成的 PointerEvent.isTrusted=false，无法可靠驱动 Phaser 触控输入。触控阈值与几何换算继续由 tests/unit/teacherControllerRuntimeSession.test.ts 覆盖。',
    })
    const { app, page, pageErrors, consoleErrors, externalRequests } =
      await launchEditor({ forceBackground: true })
    try {
      await page.getByTestId('add-content-primary').click()

      const { adapter: previewAdapter } = await openCoursePreviewOverlay(page)
      await expectBackgroundWindowsIsolated(app, true)
      const firstLocation = await previewAdapter.getAttribute('data-location-id')
      await page.getByTestId('course-preview-next').click()
      if (firstLocation) {
        await expect.poll(() => previewAdapter.getAttribute('data-location-id'))
          .not.toBe(firstLocation)
      }
      const secondLocation = await previewAdapter.getAttribute('data-location-id')
      await page.getByTestId('course-preview-previous').click()
      if (firstLocation) {
        await expect.poll(() => previewAdapter.getAttribute('data-location-id'))
          .toBe(firstLocation)
      }
      await expectBackgroundWindowsIsolated(app, true)
      await closeCoursePreviewOverlay(page)

      await page.getByTestId('global-layer-entry').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await page.getByLabel('翻页笔推进方式').selectOption('authored-command')
      const authoredPreview = await openCoursePreviewOverlay(page)
      await expect(authoredPreview.adapter).toBeVisible()
      if (firstLocation) {
        await expect.poll(() => authoredPreview.adapter.getAttribute('data-location-id'))
          .toBe(firstLocation)
      }
      await page.getByTestId('course-preview-next').click()
      if (secondLocation) {
        await expect.poll(() => authoredPreview.adapter.getAttribute('data-location-id'))
          .toBe(secondLocation)
      }
      await expectBackgroundWindowsIsolated(app, true)
      await closeCoursePreviewOverlay(page)

      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 5：Presenter 在单 HTML 与网页包均可离线翻页', async () => {
    test.setTimeout(90_000)
    const { app, page, pageErrors, externalRequests } = await launchEditor({
      forceBackground: true,
    })
    try {
      await patchDialogs(app, {
        htmlSave: htmlPath,
        webPackageSave: webPackagePath,
        reportSave: htmlPreflightReportPath,
      })
      await addText(page)
      await editDefaultText(page, '第一页')
      await page.getByTestId('add-content-primary').click()
      await addText(page)
      await editDefaultText(page, '第二页')
      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-single-html').click()
      const htmlPreflight = page.getByRole('alertdialog', {
        name: '单 HTML 导出预检',
      })
      await expect(htmlPreflight).toContainText('0 个错误')
      await htmlPreflight.getByRole('button', { name: '保存报告' }).click()
      await expect.poll(() => existsSync(htmlPreflightReportPath)).toBe(true)
      const savedPreflight = JSON.parse(
        readFileSync(htmlPreflightReportPath, 'utf8'),
      ) as {
        target?: unknown
        summary?: Record<string, unknown>
        items?: unknown
      }
      expect(savedPreflight.target).toBe('single-html')
      expect(savedPreflight.summary).toEqual(expect.objectContaining({
        error: expect.any(Number),
        warning: expect.any(Number),
        info: expect.any(Number),
        canExport: true,
      }))
      expect(Array.isArray(savedPreflight.items)).toBe(true)
      await htmlPreflight.getByRole('button', { name: '继续导出' }).click()
      await expect.poll(() => existsSync(htmlPath)).toBe(true)
      expect(readFileSync(htmlPath, 'utf8')).not.toMatch(/https?:\/\//i)

      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-web-package').click()
      const webPreflight = page.getByRole('alertdialog', {
        name: '网页包 导出预检',
      })
      await expect(webPreflight).toContainText('0 个错误')
      await webPreflight.getByRole('button', { name: '继续导出' }).click()
      await expect.poll(() => existsSync(webPackagePath)).toBe(true)
      const packageArchive = unzipSync(new Uint8Array(readFileSync(webPackagePath)))
      expect(Object.keys(packageArchive)).toEqual(expect.arrayContaining([
        'index.html',
        'course-data.js',
        'player/player.iife.js',
        'player/player.css',
      ]))
      expect(Object.keys(packageArchive)).not.toContain('course.json')
      for (const [archivePath, bytes] of Object.entries(packageArchive)) {
        const targetPath = join(webPackageDirectory, ...archivePath.split('/'))
        mkdirSync(dirname(targetPath), { recursive: true })
        writeFileSync(targetPath, bytes)
      }

      for (const [testId, dialogName] of [
        ['export-pdf', 'PDF 导出预检'],
        ['export-pptx', 'PPTX 导出预检'],
      ] as const) {
        await page.getByTestId('export-menu-trigger').click()
        await page.getByTestId(testId).click()
        const staticPreflight = page.getByRole('alertdialog', {
          name: dialogName,
        })
        await expect(staticPreflight).toBeVisible()
        await expect(staticPreflight).toContainText(/\d+ 个错误、\d+ 个警告、\d+ 条说明/)
        await staticPreflight.getByRole('button', { name: '返回编辑' }).click()
      }

      const edgeCandidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
      const executablePath = edgeCandidates.find(existsSync)
      const browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      })
      try {
        const exported = await browser.newPage()
        const requests: string[] = []
        const exportedErrors: string[] = []
        exported.on('request', (request) => {
          if (/^https?:/i.test(request.url())) requests.push(request.url())
        })
        exported.on('pageerror', (error) => exportedErrors.push(error.message))
        await exported.goto(pathToFileURL(htmlPath).toString())
        await expectCanvasPlayerScene(exported, 0)
        await expect(exported.getByTestId('teacher-escape-controls')).toHaveCount(0)
        await expect(exported.locator('.slide-native-teacher-controller')).toBeVisible()
        const exportedCanvas = exported.locator('.slide-published-adapter')
        const firstPage = await exportedCanvas.screenshot()
        await navigateCanvasPlayerByKeyboard(exported, 'PageDown', 1)
        await exported.waitForTimeout(150)
        const nextPageDifference = await averagePixelDifference(
          firstPage,
          await exportedCanvas.screenshot(),
        )
        expect(nextPageDifference).toBeGreaterThan(0.05)
        await navigateCanvasPlayerByKeyboard(exported, 'PageUp', 0)
        await exported.waitForTimeout(150)
        expect(
          await averagePixelDifference(
            firstPage,
            await exportedCanvas.screenshot(),
          ),
        ).toBeLessThan(nextPageDifference * 0.6)
        expect(requests).toEqual([])
        expect(exportedErrors).toEqual([])

        const packaged = await browser.newPage()
        const packageRequests: string[] = []
        const packageErrors: string[] = []
        packaged.on('request', (request) => {
          if (/^https?:/i.test(request.url())) packageRequests.push(request.url())
        })
        packaged.on('pageerror', (error) => packageErrors.push(error.message))
        await packaged.goto(pathToFileURL(join(webPackageDirectory, 'index.html')).toString())
        await expectCanvasPlayerScene(packaged, 0)
        await expect(packaged.getByTestId('teacher-escape-controls')).toHaveCount(0)
        await expect(packaged.locator('.slide-native-teacher-controller')).toBeVisible()
        await navigateCanvasPlayerByKeyboard(packaged, 'PageDown', 1)
        await navigateCanvasPlayerByKeyboard(packaged, 'PageUp', 0)
        expect(packageRequests).toEqual([])
        expect(packageErrors).toEqual([])
      } finally {
        await browser.close()
      }
      await expectBackgroundWindowsIsolated(app, true)
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('媒体批量与连续插入：排布、入库、页签和单次撤销', async () => {
    test.setTimeout(90_000)
    expect(existsSync(firstImagePath)).toBe(true)
    expect(existsSync(replacementImagePath)).toBe(true)
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        imageOpen: [firstImagePath, replacementImagePath],
      })

      await page.getByTestId('add-image').click()
      await expect(page.locator('.status-bar')).toContainText(
        '图片批量添加：已完成 2 项',
      )
      await expect(page.getByRole('tab', { name: '元素' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(page.locator('.status-bar')).toContainText('已选 2 个图层')
      const mediaBatchScreenshotPath = join(
        visualOutputDirectory,
        'authoring-ux-media-batch.png',
      )
      rmSync(mediaBatchScreenshotPath, { force: true })
      await page.screenshot({
        path: mediaBatchScreenshotPath,
        fullPage: true,
      })

      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(2)
      const imageGeometry: Array<{
        x: number
        y: number
        width: number
        height: number
      }> = []
      for (let index = 0; index < 2; index += 1) {
        await authoredLayerRows(page).locator('.node-name').nth(index).click()
        await expect(page.getByRole('tab', { name: '属性' })).toHaveAttribute(
          'aria-selected',
          'true',
        )
        imageGeometry.push({
          x: Number(await commonNodeField(page, 'X').inputValue()),
          y: Number(await commonNodeField(page, 'Y').inputValue()),
          width: Number(await commonNodeField(page, '宽').inputValue()),
          height: Number(await commonNodeField(page, '高').inputValue()),
        })
        if (index === 0) {
          await page.getByRole('tab', { name: '图层' }).click()
        }
      }
      const [firstImage, secondImage] = imageGeometry
      expect(
        firstImage!.x < secondImage!.x + secondImage!.width &&
          firstImage!.x + firstImage!.width > secondImage!.x &&
          firstImage!.y < secondImage!.y + secondImage!.height &&
          firstImage!.y + firstImage!.height > secondImage!.y,
      ).toBe(false)

      await page.getByRole('button', { name: '撤销（Ctrl+Z）' }).click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(0)

      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '媒体' }).click()
      await page.getByRole('button', { name: '导入图片' }).click()
      await expect(page.locator('.status-bar')).toContainText(
        '图片批量入库：已完成 2 项',
      )
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(0)

      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-text').click()
      await page.getByTestId('add-text').click()
      await expect(page.getByRole('tab', { name: '元素' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(2)
      const textPositions: Array<{ x: string; y: string }> = []
      for (let index = 0; index < 2; index += 1) {
        await authoredLayerRows(page).locator('.node-name').nth(index).click()
        textPositions.push({
          x: await commonNodeField(page, 'X').inputValue(),
          y: await commonNodeField(page, 'Y').inputValue(),
        })
        if (index === 0) {
          await page.getByRole('tab', { name: '图层' }).click()
        }
      }
      expect(textPositions[0]).not.toEqual(textPositions[1])

      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('补充流程：图片导入、替换与工程往返', async () => {
    test.setTimeout(90_000)
    expect(existsSync(firstImagePath)).toBe(true)
    expect(existsSync(replacementImagePath)).toBe(true)
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        imageOpen: firstImagePath,
        projectSave: imageProjectPath,
        projectOpen: imageProjectPath,
      })
      await page.getByTestId('add-image').click()
      await page.waitForTimeout(500)
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(1)
      await authoredLayerRows(page).locator('.node-name').click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByRole('checkbox', { name: '保持宽高比' })).toBeChecked()
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      const initialX = Number(await commonNodeField(page, 'X').inputValue())
      const initialY = Number(await commonNodeField(page, 'Y').inputValue())
      const initialWidth = Number(await commonNodeField(page, '宽').inputValue())
      const initialHeight = Number(await commonNodeField(page, '高').inputValue())
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error('图片画布不可见')
      const eastHandle = {
        x: bounds.x + ((initialX + initialWidth) / 1280) * bounds.width,
        y: bounds.y + ((initialY + initialHeight / 2) / 720) * bounds.height,
      }
      await page.mouse.move(eastHandle.x, eastHandle.y)
      await page.mouse.down()
      await page.mouse.move(eastHandle.x + 70, eastHandle.y, { steps: 12 })
      await page.mouse.up()
      await expect.poll(async () => Number(await commonNodeField(page, '宽').inputValue())).toBeGreaterThan(initialWidth)
      const resizedWidth = Number(await commonNodeField(page, '宽').inputValue())
      const resizedHeight = Number(await commonNodeField(page, '高').inputValue())
      expect(resizedWidth / resizedHeight).toBeCloseTo(initialWidth / initialHeight, 2)
      const before = await canvas.screenshot()

      await patchDialogs(app, {
        imageOpen: replacementImagePath,
        projectSave: imageProjectPath,
        projectOpen: imageProjectPath,
      })
      await page.getByRole('button', { name: '替换图片' }).click()
      await page.waitForTimeout(500)
      const replaced = await canvas.screenshot()
      expect(Buffer.compare(before, replaced)).not.toBe(0)

      const imageSection = page.locator('.property-section').filter({ hasText: '图片' })
      await imageSection
        .locator('.form-field')
        .filter({ hasText: '左裁剪' })
        .locator('input[type="range"]')
        .fill('25')
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
      expect(
        await averagePixelDifference(replaced, await canvas.screenshot()),
      ).toBeGreaterThan(0.05)
      await imageSection
        .locator('.form-field')
        .filter({ hasText: '羽化形状' })
        .locator('select')
        .selectOption('ellipse')
      await imageSection
        .locator('.form-field')
        .filter({ hasText: '羽化强度' })
        .locator('input[type="range"]')
        .fill('70')
      await page.keyboard.press('Tab')
      await imageSection.getByRole('button', { name: '水平翻转' }).click()
      await page.waitForTimeout(250)
      expect(
        await averagePixelDifference(replaced, await canvas.screenshot()),
      ).toBeGreaterThan(0.05)
      await page.screenshot({
        path: join(root, 'output', 'playwright', 'editor-v1-image-effects.png'),
        fullPage: true,
      })

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(() => existsSync(imageProjectPath)).toBe(true)
      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(authoredLayerRows(page)).toHaveCount(1)
      await authoredLayerRows(page).locator('.node-name').click()
      await page.waitForTimeout(500)
      const restored = await canvas.screenshot()
      expect(Buffer.compare(before, restored)).not.toBe(0)
      await page.getByRole('tab', { name: '属性' }).click()
      const restoredImageSection = page.locator('.property-section').filter({ hasText: '图片' })
      await expect(
        restoredImageSection
          .locator('.form-field')
          .filter({ hasText: '左裁剪' })
          .locator('input[type="range"]'),
      ).toHaveValue('25')
      await expect(
        restoredImageSection
          .locator('.form-field')
          .filter({ hasText: '羽化强度' })
          .locator('input[type="range"]'),
      ).toHaveValue('70')
      await expect(
        restoredImageSection
          .locator('.form-field')
          .filter({ hasText: '羽化形状' })
          .locator('select'),
      ).toHaveValue('ellipse')
      await expect(
        restoredImageSection.getByRole('button', { name: '水平翻转' }),
      ).toHaveClass(/secondary-button--active/)
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 6：箭头、大括号与多选对齐', async () => {
    test.setTimeout(120_000)
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      const additions = [
        { testId: 'add-shape-arrow-right', x: 130, y: 70 },
        { testId: 'add-shape-brace-left', x: 340, y: 210 },
        { testId: 'add-shape-diamond', x: 550, y: 345 },
      ]
      for (const [index, item] of additions.entries()) {
        await page.getByRole('tab', { name: '元素' }).click()
        await page.getByRole('tab', { name: '常用' }).click()
        await dragElementToCanvas(
          page,
          item.testId,
          { x: item.x, y: item.y },
          index + 1,
        )
        // A drop rebuilds the Phaser/editor node bridge. Wait for its visible
        // layer entry before starting the next drag instead of racing that sync.
        await expect(authoredLayerRows(page)).toHaveCount(index + 1)
      }

      await expect(authoredLayerRows(page)).toHaveCount(3)
      await page.locator('.tree-root').click()
      for (const name of ['右箭头', '左大括号', '菱形']) {
        await page.locator('.node-name').filter({ hasText: name }).click({
          modifiers: ['Control'],
        })
      }
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByTestId('multi-selection-properties')).toContainText('3')
      await page.getByRole('button', { name: '左对齐' }).click()

      const alignedXs: number[] = []
      for (const name of ['右箭头', '左大括号', '菱形']) {
        await page.getByRole('tab', { name: '图层' }).click()
        await page.locator('.node-name').filter({ hasText: name }).click()
        await page.getByRole('tab', { name: '属性' }).click()
        alignedXs.push(Number(await commonNodeField(page, 'X').inputValue()))
      }
      expect(new Set(alignedXs.map((value) => value.toFixed(1))).size).toBe(1)

      await page.getByRole('tab', { name: '图层' }).click()
      await page.locator('.node-name').filter({ hasText: '左大括号' }).click()
      await page.getByRole('tab', { name: '属性' }).click()
      const braceProperties = page.locator('.property-section').filter({ hasText: '图形' })
      await expect(braceProperties.getByText('线条宽度', { exact: true })).toBeVisible()
      await expect(braceProperties.getByText('填充色', { exact: true })).toHaveCount(0)
      await page.getByRole('tab', { name: '元素' }).click()
      await page.screenshot({
        path: join(root, 'output', 'playwright', 'editor-v1-shapes.png'),
        fullPage: true,
      })
      await canvas.screenshot({
        path: join(root, 'output', 'playwright', 'editor-v1-shapes-canvas.png'),
      })
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 7：两页课件导出 PDF 与 PPTX', async () => {
    test.setTimeout(90_000)
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      await patchDialogs(app, {
        pdfSave: pdfPath,
        pptxSave: pptxPath,
        imageOpen: firstImagePath,
        componentOpen: sampleComponentPath,
      })
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-shape-arrow-right').click()
      await addText(page)
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-image').click()
      await page.waitForTimeout(300)
      await page.getByTestId('add-content-primary').click()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-shape-brace-pair-horizontal').click()
      await importExternalComponentThroughUi(page)
      await page.getByTestId('component-com.example.sample-counter').click()
      await page.waitForTimeout(300)

      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-pdf').click()
      const pdfPreflight = page.getByRole('alertdialog', {
        name: 'PDF 导出预检',
      })
      await expect(pdfPreflight).toBeVisible()
      await expect(pdfPreflight).toContainText('0 个错误')
      await pdfPreflight.getByRole('button', { name: '继续导出' }).click()
      await expect.poll(() => existsSync(pdfPath), { timeout: 30_000 }).toBe(true)
      const pdf = readFileSync(pdfPath)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdf.byteLength).toBeGreaterThan(5_000)

      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-pptx').click()
      const pptxPreflight = page.getByRole('alertdialog', {
        name: 'PPTX 导出预检',
      })
      await expect(pptxPreflight).toBeVisible()
      await expect(pptxPreflight).toContainText('0 个错误')
      await pptxPreflight.getByRole('button', { name: '继续导出' }).click()
      await expect.poll(() => existsSync(pptxPath), { timeout: 30_000 }).toBe(true)
      const pptx = readFileSync(pptxPath)
      expect(pptx.subarray(0, 2).toString()).toBe('PK')
      const pptxArchive = unzipSync(new Uint8Array(pptx))
      const pptxEntries = Object.keys(pptxArchive)
      expect(pptxEntries).toContain('ppt/slides/slide1.xml')
      expect(pptxEntries).toContain('ppt/slides/slide2.xml')
      const slide1 = new TextDecoder().decode(
        pptxArchive['ppt/slides/slide1.xml'],
      )
      const slide2 = new TextDecoder().decode(
        pptxArchive['ppt/slides/slide2.xml'],
      )
      const xmlErrors = await page.evaluate((slides) => slides.map((xml) => {
        const document = new DOMParser().parseFromString(xml, 'application/xml')
        return document.getElementsByTagName('parsererror')[0]?.textContent ?? null
      }), [slide1, slide2])
      expect(xmlErrors).toEqual([null, null])
      expect(slide1).toContain('双击编辑文字')
      expect(slide1.match(/<p:sp>/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(slide1.match(/<p:pic>/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(slide2.match(/<p:sp>/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(slide2.match(/<p:pic>/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 8：字体与局部富文本在内容编辑后保持同步', async () => {
    const { app, page, pageErrors, externalRequests } = await launchEditor()
    try {
      await addText(page)
      await page.getByRole('tab', { name: '属性' }).click()
      const fontFamily = page.getByLabel('字体', { exact: true })
      await fontFamily.fill('KaiTi')
      await fontFamily.press('Enter')
      await expect(fontFamily).toHaveValue('KaiTi')
      await page.getByRole('button', { name: '加粗' }).click()
      await page.getByRole('button', { name: '编辑局部文字格式' }).click()
      const editor = page.getByTestId('text-edit-overlay')
      await expect(editor).toBeVisible()
      await editor.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const text = walker.nextNode()
        if (!text) throw new Error('富文本编辑器没有文字节点')
        const range = document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, Math.min(2, text.textContent?.length ?? 0))
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      await page.getByRole('button', { name: '局部加粗' }).click()
      await page.getByRole('button', { name: '局部删除线' }).click()
      await page.getByRole('button', { name: '局部着重号' }).click()
      await page.getByRole('button', { name: '局部高亮', exact: true }).click()
      await editor.press('Control+Enter')
      await expect(editor).toHaveCount(0)

      const content = page.locator('.form-textarea')
      await content.fill('双击编辑文字！')
      await content.blur()
      await expect(fontFamily).toHaveValue('KaiTi')
      await page.getByRole('button', { name: '编辑局部文字格式' }).click()
      await expect(editor).toBeVisible()
      const firstCharacterStyle = await editor.evaluate((element) => {
        const first = element.querySelector('span')
        if (!(first instanceof HTMLElement)) throw new Error('局部格式没有被恢复')
        const style = getComputedStyle(first)
        return {
          weight: Number.parseInt(style.fontWeight, 10),
          decoration: style.textDecorationLine,
          background: style.backgroundColor,
          emphasis: style.getPropertyValue('text-emphasis-style') ||
            style.getPropertyValue('-webkit-text-emphasis-style'),
        }
      })
      expect(firstCharacterStyle.weight).toBeLessThan(600)
      expect(firstCharacterStyle.decoration).toContain('line-through')
      expect(firstCharacterStyle.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(firstCharacterStyle.emphasis).not.toBe('none')
      await editor.press('Control+Enter')
      expect(pageErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 8B：V8 着重号与语义公式跨表面导出证据', async () => {
    test.slow()
    const { app, page, pageErrors, consoleErrors, externalRequests } =
      await launchEditor({ forceBackground: true })
    try {
      await patchDialogs(app, {
        projectSave: formulaProjectPath,
        projectOpen: formulaProjectPath,
        htmlSave: formulaHtmlPath,
        webPackageSave: formulaWebPackagePath,
        pdfSave: formulaPdfPath,
        pptxSave: formulaPptxPath,
      })
      const canvas = page.locator('[data-testid="canvas-stage"] canvas')
      const emptyCanvas = await canvas.screenshot()

      await addText(page)
      await editDefaultText(page, '横排节点级着重号')
      await setCurrentNodeGeometry(page, { X: 80, Y: 70, '宽': 520 })
      const horizontalFontSize = page.getByLabel('字号', { exact: true })
      await horizontalFontSize.fill('48')
      await horizontalFontSize.press('Enter')
      const horizontalEmphasis = page.getByRole('checkbox', {
        name: '文字着重号',
      })
      await horizontalEmphasis.locator('..').click()
      await expect(horizontalEmphasis).toBeChecked()
      await renameSelectedNode(page, '横排节点级着重号')

      await addText(page)
      await editDefaultText(page, '竖排节点级着重号')
      await page.getByLabel('文字方向').selectOption('vertical-lr')
      await setCurrentNodeGeometry(page, { X: 1080, Y: 70, '高': 280 })
      const verticalFontSize = page.getByLabel('字号', { exact: true })
      await verticalFontSize.fill('44')
      await verticalFontSize.press('Enter')
      const verticalEmphasis = page.getByRole('checkbox', {
        name: '文字着重号',
      })
      await verticalEmphasis.locator('..').click()
      await expect(verticalEmphasis).toBeChecked()
      await renameSelectedNode(page, '竖排节点级着重号')

      await addText(page)
      await editDefaultText(page, '局部着重号示例文字')
      await setCurrentNodeGeometry(page, { X: 80, Y: 230, '宽': 520 })
      const runFontSize = page.getByLabel('字号', { exact: true })
      await runFontSize.fill('48')
      await runFontSize.press('Enter')
      await page.getByRole('button', { name: '编辑局部文字格式' }).click()
      const textEditor = page.getByTestId('text-edit-overlay')
      await expect(textEditor).toBeVisible()
      await expect.poll(() => textEditor.evaluate((element) => ({
        focused: document.activeElement === element,
        selection: window.getSelection()?.toString() ?? '',
      }))).toEqual({
        focused: true,
        selection: '局部着重号示例文字',
      })
      await textEditor.focus()
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press('Shift+ArrowRight')
      }
      await expect.poll(() => textEditor.evaluate(() => (
        window.getSelection()?.toString() ?? ''
      ))).toBe('局部着重')
      await page.getByRole('button', { name: '局部着重号' }).click()
      await textEditor.press('Control+Enter')
      await expect(textEditor).toHaveCount(0)
      await renameSelectedNode(page, '局部着重号示例文字')

      const beforeFormulaCanvas = await canvas.screenshot()
      await page.getByRole('tab', { name: '元素' }).click()
      await page.getByRole('tab', { name: '常用' }).click()
      await page.getByTestId('add-formula').click()
      await expect(page.locator('.runtime-preview-loading')).toHaveCount(0)
      const formulaCanvasBounds = await canvas.boundingBox()
      if (!formulaCanvasBounds) throw new Error('公式编辑画布不可见')
      await page.mouse.dblclick(
        formulaCanvasBounds.x + formulaCanvasBounds.width / 2,
        formulaCanvasBounds.y + formulaCanvasBounds.height / 2,
        { delay: 40 },
      )
      const formulaDialog = page.getByRole('dialog', { name: '编辑公式' })
      await expect(formulaDialog).toBeVisible()
      const formulaDialogEditor = formulaDialog.getByRole('textbox', {
        name: '公式内容（线性输入）',
      })
      await expect(formulaDialogEditor).toBeFocused()
      await formulaDialogEditor.fill('\\frac{1}{2} + \\sqrt{x + 1} + x_n^2')
      await expect(formulaDialog.getByTestId('formula-preview').locator('canvas')).toHaveCount(1)
      const formulaEditorScreenshotPath = join(
        visualOutputDirectory,
        'authoring-ux-formula-editor.png',
      )
      rmSync(formulaEditorScreenshotPath, { force: true })
      await page.screenshot({
        path: formulaEditorScreenshotPath,
        fullPage: true,
      })
      await formulaDialog.getByRole('button', { name: '应用公式' }).click()
      await expect(formulaDialog).toHaveCount(0)
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByTestId('formula-properties')).toBeVisible()
      await setCurrentNodeGeometry(page, { X: 300, Y: 430, '宽': 700, '高': 190 })
      const accessibleText = page.getByRole('textbox', { name: '无障碍描述' })
      await accessibleText.fill('二分之一加根号下 x 加一，再加 x 的上标二下标 n')
      await accessibleText.blur()
      const formulaFontSize = page.getByRole('spinbutton', { name: '公式字号' })
      await formulaFontSize.fill('64')
      await expect(formulaFontSize).toHaveValue('64')
      await formulaFontSize.press('Enter')
      await expect(formulaFontSize).toHaveValue('64')
      const formulaAst = {
        type: 'row',
        children: [
          {
            type: 'fraction',
            numerator: { type: 'token', value: '1' },
            denominator: { type: 'token', value: '2' },
          },
          { type: 'operator', value: '+' },
          {
            type: 'root',
            radicand: {
              type: 'row',
              children: [
                { type: 'token', value: 'x' },
                { type: 'operator', value: '+' },
                { type: 'token', value: '1' },
              ],
            },
          },
          { type: 'operator', value: '+' },
          {
            type: 'script',
            base: { type: 'token', value: 'x' },
            superscript: { type: 'token', value: '2' },
            subscript: { type: 'token', value: 'n' },
          },
        ],
      }
      await renameSelectedNode(page, '语义公式')
      await expect(formulaFontSize).toHaveValue('64')
      await page.waitForTimeout(200)
      expect(
        await averagePixelDifference(
          beforeFormulaCanvas,
          await canvas.screenshot(),
        ),
      ).toBeGreaterThan(0.01)
      expect(
        await averagePixelDifference(emptyCanvas, await canvas.screenshot()),
      ).toBeGreaterThan(0.02)

      await page.getByRole('button', { name: '保存（Ctrl+S）' }).click()
      await expect.poll(
        () => existsSync(formulaProjectPath) ? statSync(formulaProjectPath).size : 0,
      ).toBeGreaterThan(1_000)
      const savedArchive = unzipSync(
        new Uint8Array(readFileSync(formulaProjectPath)),
      )
      const savedProjectEntry = savedArchive['project.json']
      if (!savedProjectEntry) throw new Error('V9 工程归档缺少 project.json')
      const savedProject = courseProjectDocumentSchema.parse(
        JSON.parse(strFromU8(savedProjectEntry)) as unknown,
      )
      expect(savedProject.schemaVersion).toBe(COURSE_PROJECT_SCHEMA_VERSION)
      const slideSurface = savedProject.surfaces.find((surface) => surface.type === 'slide')
      if (!slideSurface || slideSurface.type !== 'slide') {
        throw new Error('保存工程缺少 Slide 表面')
      }
      expect(slideSurface.scenes).toHaveLength(1)
      const savedItems = firstSlideSceneLayerItems(savedProject)
      expect(savedItems).toHaveLength(4)
      expect(savedItems.map((item) => item.label).sort()).toEqual([
        '局部着重号示例文字',
        '横排节点级着重号',
        '竖排节点级着重号',
        '语义公式',
      ].sort())
      const horizontalText = savedItems.find((item) => (
        item.kind === 'native' &&
        item.content.nativeType === 'text' &&
        item.content.data.text === '横排节点级着重号'
      ))
      const verticalText = savedItems.find((item) => (
        item.kind === 'native' &&
        item.content.nativeType === 'text' &&
        item.content.data.text === '竖排节点级着重号'
      ))
      const runText = savedItems.find((item) => (
        item.kind === 'native' &&
        item.content.nativeType === 'text' &&
        item.content.data.text === '局部着重号示例文字'
      ))
      const formula = savedItems.find((item) => (
        item.kind === 'native' && item.content.nativeType === 'formula'
      ))
      if (
        !runText ||
        runText.kind !== 'native' ||
        runText.content.nativeType !== 'text'
      ) {
        throw new Error('保存工程缺少局部着重号文字图层')
      }
      if (
        !horizontalText ||
        horizontalText.kind !== 'native' ||
        horizontalText.content.nativeType !== 'text'
      ) {
        throw new Error('保存工程缺少横排着重号文字图层')
      }
      if (
        !verticalText ||
        verticalText.kind !== 'native' ||
        verticalText.content.nativeType !== 'text'
      ) {
        throw new Error('保存工程缺少竖排着重号文字图层')
      }
      if (
        !formula ||
        formula.kind !== 'native' ||
        formula.content.nativeType !== 'formula'
      ) {
        throw new Error('保存工程缺少公式图层')
      }
      expect(horizontalText.content.data.style).toMatchObject({
        writingMode: 'horizontal',
        emphasis: true,
      })
      expect(verticalText.content.data.style).toMatchObject({
        writingMode: 'vertical-lr',
        emphasis: true,
      })
      expect(runText.content.data.style).toMatchObject({ emphasis: false })
      expect(runText.content.data.runs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          start: 0,
          end: 4,
          style: expect.objectContaining({ emphasis: true }),
        }),
      ]))
      expect(formula.content.data).toMatchObject({
        formulaId: expect.stringMatching(/^formula:formula_/),
        accessibleText: '二分之一加根号下 x 加一，再加 x 的上标二下标 n',
        ast: formulaAst,
        style: { fontSize: 64 },
      })

      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await page.getByRole('tab', { name: '图层' }).click()
      await expect(page.locator('.node-item')).toHaveCount(4)
      await expect(teacherControllerLayerRows(page)).toHaveCount(0)
      await page.locator('.node-name').filter({ hasText: '公式' }).click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByRole('textbox', { name: '无障碍描述' }))
        .toHaveValue('二分之一加根号下 x 加一，再加 x 的上标二下标 n')
      await expect(page.getByRole('spinbutton', { name: '公式字号' }))
        .toHaveValue('64')
      await expect(page.getByRole('textbox', {
        name: '公式内容（线性输入）',
      })).toHaveValue('\\frac{1}{2} + \\sqrt{\\row{x + 1}} + x_{n}^{2}')
      const editorPng = await canvas.screenshot({
        path: join(crossSurfaceEvidenceDirectory, 'editor.png'),
      })
      await expectMeaningfulPng(editorPng, 'Editor 画布证据')

      const { adapter: previewAdapter } = await openCoursePreviewOverlay(page)
      const previewPng = await previewAdapter.screenshot({
        path: join(crossSurfaceEvidenceDirectory, 'player.png'),
      })
      await expectMeaningfulPng(previewPng, 'Player 画布证据')
      await expectBackgroundWindowsIsolated(app, true)
      await closeCoursePreviewOverlay(page)

      for (const target of [
        {
          testId: 'export-single-html',
          dialogName: '单 HTML 导出预检',
          path: formulaHtmlPath,
        },
        {
          testId: 'export-web-package',
          dialogName: '网页包 导出预检',
          path: formulaWebPackagePath,
        },
        {
          testId: 'export-pdf',
          dialogName: 'PDF 导出预检',
          path: formulaPdfPath,
        },
        {
          testId: 'export-pptx',
          dialogName: 'PPTX 导出预检',
          path: formulaPptxPath,
        },
      ] as const) {
        await page.getByTestId('export-menu-trigger').click()
        await page.getByTestId(target.testId).click()
        const preflight = page.getByRole('alertdialog', {
          name: target.dialogName,
        })
        await expect(preflight).toBeVisible()
        await expect(preflight).toContainText('0 个错误')
        if (target.testId === 'export-pptx') {
          const emphasisItems = preflight.locator('.export-preflight__item')
            .filter({ hasText: 'pptx-text-emphasis-rasterized' })
          await expect(emphasisItems).toHaveCount(6)
          for (const nodeName of [
            '横排节点级着重号',
            '竖排节点级着重号',
            '局部着重号示例文字',
          ]) {
            await expect(emphasisItems.getByText(
              `场景“场景 1”的基础画面中，节点“${nodeName}”含有文字着重号，PPTX 将按保真策略静态化该文本节点。`,
              { exact: true },
            )).toHaveCount(1)
            await expect(emphasisItems.getByText(
              `场景“场景 1”的状态“初始”中，节点“${nodeName}”含有文字着重号，PPTX 将按保真策略静态化该文本节点。`,
              { exact: true },
            )).toHaveCount(1)
          }
          const formulaItems = preflight.locator('.export-preflight__item')
            .filter({ hasText: 'pptx-formula-rasterized' })
          await expect(formulaItems).toHaveCount(2)
          for (const location of ['基础画面', '状态“初始”']) {
            await expect(formulaItems.getByText(
              `场景“场景 1”的${location}中，节点“语义公式”是递归语义公式；PPTX 没有可靠的一对一原生映射，将按共享渲染结果静态化为透明图片，并保留 Formula ID 与无障碍文本。`,
              { exact: true },
            )).toHaveCount(1)
          }
        }
        await preflight.getByRole('button', { name: '继续导出' }).click()
        await expect.poll(
          () => existsSync(target.path) ? statSync(target.path).size : 0,
          { timeout: 45_000 },
        ).toBeGreaterThan(1_000)
      }

      const standaloneHtml = readFileSync(formulaHtmlPath, 'utf8')
      // Offline portability is about references the document would fetch, not
      // about the characters `http` appearing anywhere. A formula now embeds the
      // math font, and OFL requires shipping its notice verbatim — that text
      // carries the licence URLs inside an HTML comment, which nothing loads.
      // So assert on the reference forms instead of the bare substring.
      expect(
        standaloneHtml.replace(/<!--[\s\S]*?-->/gu, ''),
        '离线便携单 HTML 的注释之外不应出现任何 http(s) 地址',
      ).not.toMatch(/https?:\/\//iu)
      const webArchive = unzipSync(
        new Uint8Array(readFileSync(formulaWebPackagePath)),
      )
      expect(Object.keys(webArchive)).toEqual(expect.arrayContaining([
        'index.html',
        'course-data.js',
        'player/player.iife.js',
        'player/player.css',
      ]))
      expect(strFromU8(webArchive['course-data.js']!)).not.toMatch(/https?:\/\//i)
      for (const [archivePath, bytes] of Object.entries(webArchive)) {
        const targetPath = join(
          formulaWebPackageDirectory,
          ...archivePath.split('/'),
        )
        mkdirSync(dirname(targetPath), { recursive: true })
        writeFileSync(targetPath, bytes)
      }

      const pdf = readFileSync(formulaPdfPath)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      const pdfText = pdf.toString('latin1')
      expect(pdfText.match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBe(1)
      expect(pdfText.match(/\/Subtype\s*\/Image\b/g)?.length ?? 0)
        .toBeGreaterThanOrEqual(1)

      const pptxArchive = unzipSync(
        new Uint8Array(readFileSync(formulaPptxPath)),
      )
      const slidePaths = Object.keys(pptxArchive).filter((entry) => (
        /^ppt\/slides\/slide\d+\.xml$/.test(entry)
      ))
      const mediaPaths = Object.keys(pptxArchive).filter((entry) => (
        /^ppt\/media\/[^/]+$/.test(entry)
      ))
      expect(slidePaths).toHaveLength(1)
      expect(mediaPaths.length).toBeGreaterThanOrEqual(4)
      const slide = strFromU8(pptxArchive[slidePaths[0]!]!)
      expect(slide).toContain('静态公式')
      expect(slide.match(/<p:pic>/g)?.length ?? 0).toBeGreaterThanOrEqual(4)

      const edgeCandidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
      const executablePath = edgeCandidates.find(existsSync)
      const browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      })
      try {
        for (const target of [
          {
            path: formulaHtmlPath,
            screenshot: 'html.png',
            label: '单 HTML 画布证据',
          },
          {
            path: join(formulaWebPackageDirectory, 'index.html'),
            screenshot: 'web.png',
            label: '网页包画布证据',
          },
        ]) {
          const exported = await browser.newPage({
            viewport: { width: 1280, height: 720 },
          })
          const requests: string[] = []
          const errors: string[] = []
          exported.on('request', (request) => {
            if (/^https?:/i.test(request.url())) requests.push(request.url())
          })
          exported.on('pageerror', (error) => errors.push(error.message))
          await exported.goto(pathToFileURL(target.path).toString())
          await capturePlayerCanvasEvidence(
            exported,
            join(crossSurfaceEvidenceDirectory, target.screenshot),
            target.label,
          )
          expect(requests).toEqual([])
          expect(errors).toEqual([])
          await exported.close()
        }
      } finally {
        await browser.close()
      }

      await expectBackgroundWindowsIsolated(app, true)
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(externalRequests).toEqual([])
    } finally {
      await closeEditor(app)
    }
  })

  test('流程 9：未保存课件自动恢复', async () => {
    const firstLaunch = await launchEditor()
    try {
      await addText(firstLaunch.page)
      await editDefaultText(firstLaunch.page, '自动恢复内容')
      await expect.poll(async () => {
        const bytes = await firstLaunch.page.evaluate(async () => {
          const recovery = await window.desktopAPI?.readRecoveryProject()
          return recovery ? Array.from(recovery.bytes) : null
        })
        if (!bytes) return null
        const recoveryArchive = unzipSync(Uint8Array.from(bytes))
        const projectEntry = recoveryArchive['project.json']
        if (!projectEntry) return null
        const recoveredProject = courseProjectDocumentSchema.parse(
          JSON.parse(strFromU8(projectEntry)) as unknown,
        )
        return {
          schemaVersion: recoveredProject.schemaVersion,
          texts: nativeTextContents(recoveredProject),
        }
      }, { timeout: 10_000 }).toEqual({
        schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
        texts: ['自动恢复内容'],
      })
      await expect(firstLaunch.page.locator('.status-bar')).toContainText(
        '已自动保存本地恢复副本',
        { timeout: 10_000 },
      )
    } finally {
      await closeEditor(firstLaunch.app)
    }

    const restoredLaunch = await launchEditor({ preserveRecoveryPrompt: true })
    try {
      const recoveryDialog = restoredLaunch.page.getByRole('alertdialog', {
        name: '发现未完成的本地恢复副本',
      })
      await expect(recoveryDialog).toBeVisible()
      await recoveryDialog.getByRole('button', { name: '恢复课件' }).click()
      await expect(recoveryDialog).toHaveCount(0)
      await restoredLaunch.page.getByRole('tab', { name: '图层' }).click()
      await expect(restoredLaunch.page.locator('.node-item')).toHaveCount(1)
      await expect(teacherControllerLayerRows(restoredLaunch.page)).toHaveCount(0)
      await restoredLaunch.page.locator('.node-item').filter({
        has: restoredLaunch.page.locator('.node-type-icon[title="text"]'),
      }).locator('.node-name').click()
      await restoredLaunch.page.getByRole('tab', { name: '属性' }).click()
      await expect(restoredLaunch.page.locator('.form-textarea')).toHaveValue('自动恢复内容')
      expect(restoredLaunch.pageErrors).toEqual([])
      expect(restoredLaunch.externalRequests).toEqual([])
    } finally {
      await restoredLaunch.page.evaluate(() => window.desktopAPI?.clearRecoveryProject())
      await closeEditor(restoredLaunch.app)
    }
  })

  test('课例验收：三页光合作用课例可离线互动', async () => {
    expect(existsSync(lessonHtmlPath)).toBe(true)
    const edgeCandidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    const executablePath = edgeCandidates.find(existsSync)
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    })
    try {
      const lesson = await browser.newPage({ viewport: { width: 1440, height: 920 } })
      const requests: string[] = []
      const pageErrors: string[] = []
      lesson.on('request', (request) => {
        if (/^https?:/i.test(request.url())) requests.push(request.url())
      })
      lesson.on('pageerror', (error) => pageErrors.push(error.message))
      await lesson.goto(pathToFileURL(lessonHtmlPath).toString())

      const stage = lesson.locator('.slide-published-adapter')
      await expectCanvasPlayerScene(lesson, 0)
      await expect(stage.locator('[data-photosynthesis-page="1"]')).toBeVisible()
      const clickDesignPoint = async (x: number, y: number) => {
        const bounds = await stage.boundingBox()
        if (!bounds) throw new Error('课例 Published V2 舞台不可见')
        await lesson.mouse.click(
          bounds.x + (x / 1280) * bounds.width,
          bounds.y + (y / 720) * bounds.height,
        )
      }

      const firstInitial = await stage.screenshot()
      for (const y of [397, 477, 557]) await clickDesignPoint(253, y)
      await lesson.waitForTimeout(1_000)
      const firstCompleted = await stage.screenshot()
      expect(await averagePixelDifference(firstInitial, firstCompleted)).toBeGreaterThan(0.1)
      await lesson.screenshot({
        path: join(visualOutputDirectory, 'lesson-page-1-complete.png'),
        fullPage: true,
      })

      await navigateCanvasPlayerByKeyboard(lesson, 'ArrowRight', 1)
      await expect(stage.locator('[data-photosynthesis-page="2"]')).toBeVisible()
      const secondInitial = await stage.screenshot()
      await clickDesignPoint(471, 402)
      await lesson.waitForTimeout(350)
      expect(
        await averagePixelDifference(secondInitial, await stage.screenshot()),
      ).toBeGreaterThan(0.02)
      await lesson.screenshot({
        path: join(visualOutputDirectory, 'lesson-page-2-experiment.png'),
        fullPage: true,
      })

      await navigateCanvasPlayerByKeyboard(lesson, 'ArrowRight', 2)
      await expect(stage.locator('[data-photosynthesis-page="3"]')).toBeVisible()
      await clickDesignPoint(214, 538)
      await clickDesignPoint(286, 413)
      await lesson.waitForTimeout(450)
      await lesson.screenshot({
        path: join(visualOutputDirectory, 'lesson-page-3-challenge.png'),
        fullPage: true,
      })

      expect(requests).toEqual([])
      expect(pageErrors).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
