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

function readProject(projectPath: string): CourseProjectDocument {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
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
      await defaultCollapsed.locator('..').locator('.toggle-track').click()
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
