import { plainDocumentText } from '../../src/shared/document/content'
import {
  existsSync,
  appendFileSync,
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
import type { ElectronApplication, Locator, Page } from 'playwright'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { createGeneratedFlowFixture } from './flowGeneratedFixture'
import { nativeRecords, recordEvidence, sendNatural, type NativeRun } from './r18NativeAuthoringFixture'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { addCourseSpatialPage } from '../../src/renderer/course/courseLocationCommands'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'

const root = resolve(__dirname, '..', '..')
const fixturePath = join(root, 'tests', 'fixtures', 'architecture-baseline', 'mixed-spatial.h5lesson')
let evidenceDirectory = join(root, 'output', 'r18-089')
let mixedCopyPath = join(evidenceDirectory, 'mixed-spatial-copy.h5lesson')
let htmlPath = join(evidenceDirectory, 'mixed-spatial.html')
const WINDOWS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
] as const

function prepareMixedCopy(widthMode?: 'fluid'): void {
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(fixturePath)))
  const banner = archive.project.globalLayerItems.find((entry) => (
    entry.item.layerItemId === 'mixed-global-banner'
  ))?.item
  if (banner) {
    banner.frame = {
      ...banner.frame,
      width: Math.max(banner.frame.width, 560),
      height: Math.max(banner.frame.height, 80),
    }
  }
  const flow = archive.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('mixed fixture must contain Flow')
  if (widthMode) flow.layout = { ...flow.layout, widthMode }
  flow.blocks.splice(1, 0, {
    id: 'r18-089-flow-state', type: 'component',
    component: { packageId: 'com.ittoedu.baseline.evidence-panel', version: '4.0.0' },
    props: { title: '观察变换不重置互动', body: '输入答案、增加计数，再缩放、平移和改变窗口。', accent: '#2563eb' },
    staticFallbackAssetId: 'mixed-component-fallback',
  })
  for (let index = 0; index < 24; index += 1) {
    flow.blocks.push({
      id: `r18-089-scroll-${index}`, type: 'paragraph',
      content: { inlines: [{ type: 'text', text: `第 ${index + 1} 段：${'正文随窗口宽度重排，纸张滚动与课件观察缩放保持独立。'.repeat(8)}` }] },
    })
  }
  const packageId = 'com.ittoedu.baseline.evidence-panel'
  const files = archive.componentFiles[`${packageId}@4.0.0`]!
  const runtime = new TextDecoder().decode(files['runtime.js'])
  files['runtime.js'] = new TextEncoder().encode(runtime.replace('card.append(title,body);', `
      var counter=document.createElement('button'),answer=document.createElement('input'),count=0;
      counter.textContent='互动计数：0';counter.onclick=function(){counter.textContent='互动计数：'+(++count);};
      counter.setAttribute('data-testid','r18-089-counter');
      answer.setAttribute('aria-label','Flow 互动回答');answer.placeholder='保留当前答案';
      counter.style.cssText='padding:8px;margin-right:12px';answer.style.cssText='padding:8px;width:180px';
      card.append(title,body,counter,answer);
  `))
  archive.project.componentPackages[packageId] = parseComponentPackageFiles(files).metadata
  writeFileSync(mixedCopyPath, createCourseProjectArchive(archive))
}

interface LaunchedEditor {
  app: ElectronApplication
  page: Page
  userDataPath: string
}

async function expectIntersecting(target: Locator, clip: Locator): Promise<void> {
  await expect.poll(async () => {
    const box = await target.boundingBox()
    const area = await clip.boundingBox()
    if (!box || !area) return 0
    const width = Math.min(box.x + box.width, area.x + area.width) - Math.max(box.x, area.x)
    const height = Math.min(box.y + box.height, area.y + area.height) - Math.max(box.y, area.y)
    return Math.min(width, height)
  }, { timeout: 15_000 }).toBeGreaterThan(8)
}

/** Visibility must survive every clipping ancestor, not merely intersect its panel. */
async function expectUnclipped(target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  await expect.poll(() => target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    let ancestor: Element | null = element
    while (ancestor) {
      const style = getComputedStyle(ancestor)
      const bounds = ancestor.getBoundingClientRect()
      if (ancestor instanceof HTMLElement) {
        const sx = ancestor.offsetWidth ? bounds.width / ancestor.offsetWidth : 1
        const sy = ancestor.offsetHeight ? bounds.height / ancestor.offsetHeight : 1
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
          left = Math.max(left, bounds.left + ancestor.clientLeft * sx)
          right = Math.min(right, bounds.left + (ancestor.clientLeft + ancestor.clientWidth) * sx)
        }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
          top = Math.max(top, bounds.top + ancestor.clientTop * sy)
          bottom = Math.min(bottom, bounds.top + (ancestor.clientTop + ancestor.clientHeight) * sy)
        }
        const inset = /^inset\(([^)]*?)(?: round [^)]*)?\)$/.exec(style.clipPath)
        if (inset) {
          const values = inset[1]!.trim().split(/\s+/).map(value => parseFloat(value))
          const t = values[0]!, r = values[1] ?? t, b = values[2] ?? t, l = values[3] ?? r
          left = Math.max(left, bounds.left + l * sx)
          right = Math.min(right, bounds.right - r * sx)
          top = Math.max(top, bounds.top + t * sy)
          bottom = Math.min(bottom, bounds.bottom - b * sy)
        }
      }
      const root = ancestor.getRootNode()
      ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
    }
    return Math.max(rect.width - Math.max(0, right - left), rect.height - Math.max(0, bottom - top))
  }), { timeout: 15_000 }).toBeLessThan(1)
}

async function expectStableController(controller: Locator): Promise<void> {
  const maximumShift = await controller.evaluate(async element => {
    const first = element.getBoundingClientRect()
    let shift = 0
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise(requestAnimationFrame)
      const next = element.getBoundingClientRect()
      shift = Math.max(shift, Math.abs(next.left - first.left), Math.abs(next.top - first.top))
    }
    return shift
  })
  expect(maximumShift).toBeLessThan(0.5)
}

async function clickCollapse(page: Page, host: Locator, collapsed: boolean): Promise<void> {
  const button = host.getByRole('button', { name: collapsed ? '收起教师控制器' : '展开教师控制器' })
  await expectUnclipped(button)
  const box = (await button.boundingBox())!
  // Controller chrome dispatches pointer gestures through its nav hit region.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expectUnclipped(host.getByRole('button', { name: collapsed ? '展开教师控制器' : '收起教师控制器' }))
  await expectUnclipped(host.getByRole('button', { name: '缩放', exact: true }))
}

async function captureLongScroll(page: Page, scroll: Locator, clip: Locator, name: string): Promise<void> {
  const dimensions = await scroll.evaluate(element => ({
    max: element.scrollHeight - element.clientHeight, height: element.clientHeight,
  }))
  expect(dimensions.max).toBeGreaterThan(dimensions.height)
  await scroll.evaluate(element => { element.scrollTop = 0 })
  const heading = scroll.locator('[data-flow-block-id="mixed-flow-heading"]')
  const original = (await heading.boundingBox())!
  for (const [stage, amount] of [['mid', dimensions.max / 2], ['end', dimensions.max]] as const) {
    await scroll.evaluate((element, top) => { element.scrollTop = top }, amount)
    await expect.poll(() => scroll.evaluate((element, target) => Math.abs(element.scrollTop - target), amount)).toBeLessThanOrEqual(1)
    const actualScroll = await scroll.evaluate(element => element.scrollTop)
    const moved = (await heading.boundingBox())!
    expect(Math.abs(original.y - moved.y - actualScroll)).toBeLessThanOrEqual(1)
    if (stage === 'end') await expectUnclipped(scroll.locator('[data-flow-block-id="r18-089-scroll-23"]'))
    await capture(page, clip, `${name}-${stage}scroll`)
  }
  await scroll.evaluate(element => { element.scrollTop = 0 })
}

async function exercisePlayback(
  page: Page,
  host: Locator,
  name: string,
  resize?: (size: { width: number; height: number }) => Promise<void>,
): Promise<void> {
  const controller = host.getByTestId('flow-runtime-teacher-controller')
  const zoom = host.getByRole('button', { name: '缩放', exact: true })
  await expectUnclipped(zoom)
  await expectUnclipped(host.getByRole('button', { name: '收起教师控制器' }))
  await expectStableController(controller)
  await capture(page, host, name)
  await clickCollapse(page, host, true)
  await expectStableController(controller)
  await capture(page, host, `${name}-collapsed`)
  await clickCollapse(page, host, false)

  const answer = host.getByRole('textbox', { name: 'Flow 互动回答' })
  const counter = host.getByTestId('r18-089-counter')
  await answer.fill('保留答案 42')
  await counter.click()
  await expect(counter).toHaveText('互动计数：1')
  const instance = await answer.elementHandle()
  const paper = host.getByTestId('flow-runtime-article')
  await paper.evaluate(element => { element.scrollTop = 0 })
  const layoutWidth = await paper.evaluate(element => element.clientWidth)
  const controllerBefore = (await controller.boundingBox())!

  await zoom.click()
  const panel = host.getByRole('group', { name: '课件观察缩放' })
  for (let step = 0; step < 4; step += 1) await panel.getByRole('button', { name: '放大', exact: true }).click()
  await expect(panel.locator('output')).toHaveText('200%')
  expect(await paper.evaluate(element => element.clientWidth)).toBe(layoutWidth)
  const zoomed = (await controller.boundingBox())!
  // Floating chrome changes the safe anchoring region, not the controller scale.
  expect(Math.abs(zoomed.x - controllerBefore.x)).toBeLessThanOrEqual(40)
  expect(Math.abs(zoomed.y - controllerBefore.y)).toBeLessThanOrEqual(40)
  expect(zoomed.width).toBeCloseTo(controllerBefore.width)
  await capture(page, host, `${name}-zoom200`)
  if (resize) {
    const originalSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await resize({ width: originalSize.width - 80, height: originalSize.height - 40 })
    await expect.poll(() => paper.evaluate(element => element.clientWidth)).toBeLessThan(layoutWidth)
    await expectUnclipped(host.getByRole('button', { name: '收起教师控制器' }))
    await expectUnclipped(zoom)
    await expect(answer).toHaveValue('保留答案 42')
    await expect(counter).toHaveText('互动计数：1')
    expect(await instance!.evaluate(element => element.isConnected)).toBe(true)
    await expectStableController(controller)
    // Resize closes only the transient popup; the observation zoom survives.
    await expect(panel).toHaveCount(0)
    await zoom.click()
    await expect(panel.locator('output')).toHaveText('200%')
    await capture(page, host, `${name}-zoom200-resize`)
    await resize(originalSize)
    // Windows can round content sizes by one physical pixel when restoring a DIP size.
    await expect.poll(() => paper.evaluate((element, expected) => Math.abs(element.clientWidth - expected), layoutWidth)).toBeLessThanOrEqual(2)
    await expectStableController(controller)
    await expect(panel).toHaveCount(0)
    await zoom.click()
    await expect(panel.locator('output')).toHaveText('200%')
  }
  for (const [label, key] of [['左右移动视图', 'ArrowRight'], ['上下移动视图', 'ArrowDown']] as const) {
    const bar = host.getByRole('scrollbar', { name: label })
    await expectUnclipped(bar)
    const prior = Number(await bar.getAttribute('aria-valuenow'))
    await bar.press(key)
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(prior)
  }
  expect(await paper.evaluate(element => element.scrollTop)).toBe(0)
  await expect(answer).toHaveValue('保留答案 42')
  expect(await instance!.evaluate(element => element.isConnected)).toBe(true)
  await expect(counter).toHaveText('互动计数：1')
  await panel.getByRole('button', { name: '恢复视图' }).click()
  await expect(panel.locator('output')).toHaveText('100%')
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
  await expectUnclipped(zoom)
  await expectStableController(controller)
  await counter.click()
  await expect(counter).toHaveText('互动计数：2')
  await capture(page, host, `${name}-restore`)

  const box = (await paper.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.wheel(0, 180)
  await expect.poll(() => paper.evaluate(element => element.scrollTop)).toBe(180)
  await captureLongScroll(page, paper, host, name)
  await expectUnclipped(zoom)
  await expectStableController(controller)
  await expect(answer).toHaveValue('保留答案 42')
  expect(await instance!.evaluate(element => element.isConnected)).toBe(true)
  await instance!.dispose()
}

async function launchEditor(): Promise<LaunchedEditor> {
  const userDataPath = mkdtempSync(
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-r18089-${process.pid}-`),
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
    const page = await app.firstWindow()
    expect(await app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows().some(window => window.isVisible())
    ))).toBe(false)
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
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
    return { app, page, userDataPath }
  } catch (error) {
    if (app) await closeEditor(app, userDataPath).catch(() => undefined)
    else removeProfile(userDataPath)
    throw error
  }
}

function removeProfile(userDataPath: string): void {
  const absolute = resolve(userDataPath)
  const temporaryRoot = resolve(tmpdir())
  const scoped = relative(temporaryRoot, absolute)
  if (
    !scoped ||
    scoped === '..' ||
    scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(scoped) ||
    !scoped.split(/[\\/]/)[0]!.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-r18089-`)
  ) {
    throw new Error(`Refusing to remove an unscoped r18-089 profile: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeEditor(app: ElectronApplication, userDataPath: string, preserve = false): Promise<void> {
  const child = app.process()
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(done => child.once('exit', () => done()))
  await Promise.race([app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined), exited])
  await Promise.race([app.close().catch(() => undefined), exited])
  if (child.exitCode === null) {
    const exited = await Promise.race([
      new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
      new Promise<boolean>((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
    ])
    if (!exited && child.exitCode === null) child.kill()
  }
  if (!preserve) removeProfile(userDataPath)
}

async function patchDialogs(
  app: ElectronApplication,
  paths: { projectOpen?: string; htmlSave?: string },
): Promise<void> {
  await app.evaluate(({ dialog }, values) => {
    dialog.showSaveDialog = (async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('HTML')
          ? values.htmlSave ?? ''
          : values.htmlSave ?? '',
      }
    }) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: !values.projectOpen,
      filePaths: values.projectOpen ? [values.projectOpen] : [],
    })) as typeof dialog.showOpenDialog
  }, paths)
}

async function setContentSize(
  app: ElectronApplication,
  page: Page,
  size: { width: number; height: number },
): Promise<void> {
  const host = await app.browserWindow(page)
  await host.evaluate((window, next) => {
    window.setMinimumSize(640, 480)
    window.setContentSize(next.width, next.height)
  }, size)
  // Hidden offscreen windows can retain stale Windows non-client insets. Adjust
  // their outer bounds against the actual renderer viewport without showing them.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (Math.abs(actual.width - size.width) <= 2 && Math.abs(actual.height - size.height) <= 2) break
    await host.evaluate((window, correction) => {
      const bounds = window.getBounds()
      window.setBounds({ width: bounds.width + correction.width, height: bounds.height + correction.height })
    }, { width: size.width - actual.width, height: size.height - actual.height })
  }
  await expect.poll(async () => {
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    return Math.max(Math.abs(actual.width - size.width), Math.abs(actual.height - size.height))
  }).toBeLessThanOrEqual(2)
  expect(await host.evaluate(window => window.isVisible())).toBe(false)
}

async function openMixedFlow(app: ElectronApplication, page: Page): Promise<void> {
  await patchDialogs(app, { projectOpen: mixedCopyPath })
  await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
  await expect(page.getByTestId('course-page-node-mixed-slide-surface')).toBeVisible({
    timeout: 15_000,
  })
  await page.getByTestId('flow-page-mixed-flow-surface').click()
  await expect(page.getByTestId('flow-workspace')).toBeVisible()
}

async function enterTryRun(page: Page): Promise<void> {
  const button = page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '当前位置试运行', exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('flow-try-run-host')).toBeVisible()
  await expect(page.locator('[data-playback-view]')).toBeVisible()
}

async function returnToEdit(page: Page): Promise<void> {
  await page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '编辑状态', exact: true })
    .click()
  await expect(page.getByTestId('flow-workspace')).toBeVisible()
}

async function capture(
  page: Page,
  clip: Locator,
  name: string,
): Promise<void> {
  await page.screenshot({ path: join(evidenceDirectory, `${name}.png`) })
  await clip.screenshot({ path: join(evidenceDirectory, `${name}-clip.png`) }).catch(() => undefined)
}

async function verifyFlowViewport(widthMode?: 'fluid'): Promise<void> {
  // Hidden Windows Electron can deliver animation frames at 1 Hz. Preserve
  // all eight-frame stability checks while allowing both viewport matrices.
  test.setTimeout(420_000)
  evidenceDirectory = join(root, 'output', 'r18-089', `${widthMode ?? 'reading'}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mixedCopyPath = join(evidenceDirectory, 'mixed-spatial-copy.h5lesson')
  htmlPath = join(evidenceDirectory, 'mixed-spatial.html')
  mkdirSync(evidenceDirectory, { recursive: true })
  prepareMixedCopy(widthMode)
  const launch = await launchEditor()
  try {
    await openMixedFlow(launch.app, launch.page)
    for (const size of WINDOWS) {
      await setContentSize(launch.app, launch.page, size)
      await expect(launch.page.getByTestId('flow-workspace')).toBeVisible()
      const editCard = launch.page.getByTestId('flow-layer-card-mixed-global-controller')
      await expectIntersecting(editCard, launch.page.getByTestId('flow-workspace'))
      await capture(launch.page, launch.page.getByTestId('flow-workspace'), `edit-${size.name}`)

      const scroll = launch.page.getByTestId('flow-workspace-scroll')
      await captureLongScroll(launch.page, scroll, launch.page.getByTestId('flow-workspace'), `edit-${size.name}`)
      await expectIntersecting(editCard, launch.page.getByTestId('flow-workspace'))

      await enterTryRun(launch.page)
      const tryRun = launch.page.getByTestId('flow-try-run-host')
      await exercisePlayback(launch.page, tryRun, `tryrun-${size.name}`,
        next => setContentSize(launch.app, launch.page, next))
      await returnToEdit(launch.page)

      await launch.page.getByRole('button', { name: '整课预览' }).click()
      const preview = launch.page.getByTestId('course-preview-overlay')
      const previewHost = launch.page.getByTestId('course-preview-host')
      await expect(preview).toBeVisible()
      await preview.getByTestId('course-preview-next').click()
      await expect(previewHost.locator('.flow-surface-host')).toBeVisible({ timeout: 15_000 })
      await exercisePlayback(launch.page, previewHost, `preview-${size.name}`)
      await preview.getByRole('button', { name: '关闭预览' }).click()
      await expect(preview).toHaveCount(0)
    }

    const originalProject = openCourseProjectArchive(new Uint8Array(readFileSync(mixedCopyPath))).project
    const originalController = originalProject.globalLayerItems.find(entry => entry.item.layerItemId === 'mixed-global-controller')!.item
    const paragraph = launch.page.getByTestId('flow-paper').locator('[data-flow-block-id="mixed-flow-paragraph"]')
    await paragraph.dblclick()
    await launch.page.getByTestId('flow-inline-editor').fill('人工改稿后仍可保存重开。')
    await launch.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    const savedProject = () => openCourseProjectArchive(new Uint8Array(readFileSync(mixedCopyPath))).project
    await expect.poll(() => {
      const flow = savedProject().surfaces.find(surface => surface.type === 'flow')
      const block = flow?.type === 'flow' && flow.blocks.find(item => item.id === 'mixed-flow-paragraph')
      return block && block.type === 'paragraph' ? plainDocumentText(block.content) : null
    }).toBe('人工改稿后仍可保存重开。')
    expect(savedProject().revision).toBe(originalProject.revision + 1)
    expect(savedProject().globalLayerItems.find(entry => entry.item.layerItemId === 'mixed-global-controller')!.item).toEqual(originalController)
    await launch.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(paragraph).toContainText('先观察图像，再进入空间画布探索节点关系。')
    await launch.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(paragraph).toContainText('人工改稿后仍可保存重开。')
    const beforeSave = statSync(mixedCopyPath).mtimeMs
    await launch.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => statSync(mixedCopyPath).mtimeMs).toBeGreaterThan(beforeSave)
    expect(savedProject().revision).toBe(originalProject.revision + 1)
    await openMixedFlow(launch.app, launch.page)
    await expect(paragraph).toContainText('人工改稿后仍可保存重开。')
    await capture(launch.page, launch.page.getByTestId('flow-workspace'), 'edit-saved-reopened')

    await patchDialogs(launch.app, { htmlSave: htmlPath })
    await launch.page.getByTestId('export-menu-trigger').click()
    await launch.page.getByTestId('export-single-html').click()
    const htmlPreflight = launch.page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(htmlPreflight).toContainText('0 个错误')
    await htmlPreflight.getByRole('button', { name: '继续导出' }).click()
    await expect.poll(() => existsSync(htmlPath) ? statSync(htmlPath).size : 0, {
      timeout: 30_000,
    }).toBeGreaterThan(1_000)
  } finally {
    await closeEditor(launch.app, launch.userDataPath)
  }

  const browser = await chromium.launch({ headless: true })
  try {
    for (const windowConfig of WINDOWS) {
      const page = await browser.newPage({ viewport: { width: windowConfig.width, height: windowConfig.height } })
      await page.goto(pathToFileURL(htmlPath).href)
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__H5_LESSON_PLAYER__))).toBe(true)
      await page.evaluate(() => (window as any).__H5_LESSON_PLAYER__?.goToScene(1))
      const host = page.locator('.flow-surface-host')
      await expect(host).toBeVisible({ timeout: 15_000 })
      await exercisePlayback(page, page.locator('[data-playback-view]'), `html-${windowConfig.name}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

test('mixed-global-controller stays reachable at 1280×720 and 1440×900', () => verifyFlowViewport())
test('fluid Flow retains interaction state through resize, scroll and zoom at 1280×720 and 1440×900', () => verifyFlowViewport('fluid'))
async function openGeneratedFlow(app: ElectronApplication, page: Page, path: string, surfaceId: string) {
  await patchDialogs(app, { projectOpen: path })
  await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
  await expect(page.getByTestId(`flow-page-${surfaceId}`)).toBeVisible()
  await page.getByTestId(`flow-page-${surfaceId}`).click()
  await expect(page.getByTestId('flow-workspace')).toBeVisible()
}

async function measureGenerated(host: Locator) {
  return host.evaluate(root => {
    const viewport = root.querySelector<HTMLElement>('[data-playback-viewport]')!
    const paper = root.querySelector<HTMLElement>('.flow-body-content')!
    const article = root.querySelector<HTMLElement>('[data-flow-paper-scroll]')!
    const controller = root.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!
    const rect = (element: HTMLElement) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { window: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, viewport: rect(viewport), paper: rect(paper),
      bodyWidth: paper.clientWidth - 72, scrollWidth: article.clientWidth, scrollHeight: article.clientHeight,
      scrollMax: article.scrollHeight - article.clientHeight, nativeRight: article.offsetWidth - article.clientWidth,
      controller: rect(controller), bars: [...root.querySelectorAll<HTMLElement>('[role="scrollbar"]')].map(bar => ({ hidden: bar.hidden, rect: rect(bar) })) }
  })
}

async function checkNewPlayback(page: Page, host: Locator, name: string, resize?: (size: { width: number; height: number }) => Promise<void>) {
  if (await host.getByRole('button', { name: '展开教师控制器' }).count()) await clickCollapse(page, host, false)
  const metrics = await measureGenerated(host)
  writeFileSync(join(evidenceDirectory, `${name}.json`), JSON.stringify(metrics, null, 2))
  expect(metrics.bars.every(bar => bar.hidden)).toBe(true)
  expect(metrics.bodyWidth).toBeCloseTo(metrics.scrollWidth - 104, 0)
  const safeWidth = metrics.viewport.width - metrics.nativeRight
  expect(Math.abs(metrics.controller.x - metrics.viewport.x - (safeWidth - metrics.controller.width) / 2)).toBeLessThan(1.5)
  expect(Math.abs(metrics.viewport.y + metrics.viewport.height - metrics.controller.y - metrics.controller.height - 12)).toBeLessThan(1.5)
  await capture(page, host, name)
  const controller = host.getByTestId('flow-runtime-teacher-controller')
  const article = host.getByTestId('flow-runtime-article')
  const down = host.getByRole('button', { name: '第一步下移', exact: true })
  await down.click()
  await expect(host.locator('.sort .label').first()).toHaveText('1. 第二步')
  const instance = await host.locator('.sort').elementHandle()
  await article.evaluate(element => { element.scrollTop = 0 })
  await controller.locator('nav').press('Alt+ArrowUp')
  const moved = (await controller.boundingBox())!
  expect(moved.y).toBeLessThan(metrics.controller.y)
  if (resize) {
    await resize({ width: metrics.window.width - 160, height: metrics.window.height - 80 })
    await expectUnclipped(host.getByRole('button', { name: '缩放', exact: true }))
    await resize(metrics.window)
    await expect.poll(async () => Math.abs((await controller.boundingBox())!.y - moved.y)).toBeLessThanOrEqual(2)
  }
  await clickCollapse(page, host, true); await clickCollapse(page, host, false)
  await host.getByRole('button', { name: '缩放', exact: true }).click()
  const panel = host.getByRole('group', { name: '课件观察缩放' })
  for (let i = 0; i < 4; i++) await panel.getByRole('button', { name: '放大', exact: true }).click()
  await expect(panel.locator('output')).toHaveText('200%')
  expect(await article.evaluate(element => element.clientWidth)).toBe(metrics.scrollWidth)
  expect((await controller.boundingBox())!.width).toBeCloseTo(metrics.controller.width, 0)
  for (const label of ['左右移动视图', '上下移动视图']) {
    const bar = host.getByRole('scrollbar', { name: label }); await expectUnclipped(bar); await bar.press('End')
    expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  }
  const separate = await host.evaluate(root => {
    const y = root.querySelector<HTMLElement>('[data-playback-chrome="y-bar"]')!.getBoundingClientRect()
    const article = root.querySelector<HTMLElement>('[data-flow-paper-scroll]')!
    const a = article.getBoundingClientRect(), width = (article.offsetWidth - article.clientWidth) * 2
    return { left: y.left, right: y.right, nativeLeft: a.right - width, nativeRight: a.right, nativeWidth: width }
  })
  if (separate.nativeWidth > 0) expect(separate.right <= separate.nativeLeft + 1 || separate.nativeRight <= separate.left + 1).toBe(true)
  expect(await article.evaluate(element => element.scrollTop)).toBe(0)
  expect(await instance!.evaluate(element => element.isConnected)).toBe(true)
  await expect(host.locator('.sort .label').first()).toHaveText('1. 第二步')
  await capture(page, host, `${name}-zoom200`)
  await panel.getByRole('button', { name: '恢复视图' }).click()
  await expect(host.getByRole('scrollbar')).toHaveCount(0)
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(host.locator('.sort .label').first()).toHaveText('1. 第二步')
  // Physical wheel and paper/viewport overlay displacement are independent of pan.
  const paperMarker = host.locator('[data-flow-paper-space="paper"]').first()
  const before = await paperMarker.boundingBox()
  const articleBox = (await article.boundingBox())!
  await page.mouse.move(articleBox.x + 100, articleBox.y + articleBox.height / 2)
  await page.mouse.wheel(0, 150)
  await expect.poll(() => article.evaluate(element => element.scrollTop)).toBe(150)
  if (before) expect(before.y - (await paperMarker.boundingBox())!.y).toBeCloseTo(150, 0)
  await article.evaluate(element => { element.scrollTop = 0 })
  await expectStableController(controller)
  await instance!.dispose()
}

test('new formal Flow content stays consistent through normal entry points without fixture layout repair', async () => {
  test.setTimeout(300_000)
  evidenceDirectory = join(root, 'output', 'r18-089', `new-generated-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(evidenceDirectory, { recursive: true })
  const fixture = await createGeneratedFlowFixture(root, evidenceDirectory)
  htmlPath = join(evidenceDirectory, 'new-generated.html')
  const launch = await launchEditor()
  try {
    await setContentSize(launch.app, launch.page, { width: 1574, height: 983 })
    await openGeneratedFlow(launch.app, launch.page, fixture.shortPath!, fixture.surfaceId)
    await enterTryRun(launch.page)
    const short = await measureGenerated(launch.page.getByTestId('flow-try-run-host'))
    expect(short.scrollMax).toBeLessThanOrEqual(1)
    expect(short.bars.every(bar => bar.hidden)).toBe(true)
    await capture(launch.page, launch.page.getByTestId('flow-try-run-host'), 'short-no-scroll')
    await returnToEdit(launch.page)
    await openGeneratedFlow(launch.app, launch.page, fixture.path, fixture.surfaceId)
    for (const size of [{ width: 1574, height: 983 }, { width: 1280, height: 720 }]) {
      await setContentSize(launch.app, launch.page, size)
      await capture(launch.page, launch.page.getByTestId('flow-workspace'), `new-edit-${size.width}`)
      await enterTryRun(launch.page)
      await checkNewPlayback(launch.page, launch.page.getByTestId('flow-try-run-host'), `new-trial-${size.width}`, next => setContentSize(launch.app, launch.page, next))
      await returnToEdit(launch.page)
      await launch.page.getByRole('button', { name: '整课预览', exact: true }).click()
      const preview = launch.page.getByTestId('course-preview-overlay')
      await expect(preview.locator('.flow-surface-host')).toBeVisible()
      await checkNewPlayback(launch.page, launch.page.getByTestId('course-preview-host'), `new-preview-${size.width}`)
      await preview.getByRole('button', { name: '关闭预览' }).click()
    }
    const original = openCourseProjectArchive(new Uint8Array(readFileSync(fixture.path))).project
    await launch.page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await openGeneratedFlow(launch.app, launch.page, fixture.path, fixture.surfaceId)
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(fixture.path))).project).toEqual(original)
    await patchDialogs(launch.app, { htmlSave: htmlPath })
    await launch.page.getByTestId('export-menu-trigger').click(); await launch.page.getByTestId('export-single-html').click()
    const preflight = launch.page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误'); await preflight.getByRole('button', { name: '继续导出' }).click()
    await expect.poll(() => existsSync(htmlPath) ? statSync(htmlPath).size : 0, { timeout: 30_000 }).toBeGreaterThan(1000)
  } finally { await closeEditor(launch.app, launch.userDataPath) }
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1574, height: 983 } })
    await page.goto(pathToFileURL(htmlPath).href)
    await expect(page.locator('.flow-surface-host')).toBeVisible()
    await checkNewPlayback(page, page.locator('[data-playback-view]'), 'new-html-1574')
  } finally { await browser.close() }
})
test(process.env.FLOW_AI_VERIFY_EXISTING ? 'preserved real AI Flow verifies playback and HTML with bounded shutdown' : 'real AI generates Flow through the product and retains the result across playback and HTML', async () => {
  const preservedRoot = process.env.FLOW_AI_VERIFY_EXISTING
  test.skip(!preservedRoot && process.env.FLOW_REAL_AI !== '1', 'One explicit real generation run; excluded from deterministic regression')
  test.setTimeout(840_000)
  evidenceDirectory = join(root, 'output', 'r18-089', `real-ai-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(evidenceDirectory, { recursive: true })
  const preserved = preservedRoot ? openCourseProjectArchive(new Uint8Array(readFileSync(join(preservedRoot, 'ai-new-flow.h5lesson')))).project : null
  const fixture = preserved ? { path: join(preservedRoot!, 'ai-new-flow.h5lesson'), surfaceId: preserved.surfaces.find(surface => surface.type === 'flow')!.id }
    : await createGeneratedFlowFixture(root, evidenceDirectory, true)
  const launch = await launchEditor()
  const run: NativeRun = { ...launch, userData: launch.userDataPath, runRoot: evidenceDirectory, workspaceRoot: evidenceDirectory,
    projectPath: fixture.path, pageErrors: [], consoleErrors: [] }
  const page = launch.page
  launch.app.process().stderr?.on('data', chunk => appendFileSync(join(evidenceDirectory, 'electron-stderr.log'), chunk))
  page.on('pageerror', error => run.pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push(message.text()) })
  writeFileSync(join(evidenceDirectory, 'profile.json'), JSON.stringify({ userDataPath: launch.userDataPath }))
  try {
    await setContentSize(launch.app, page, { width: 1574, height: 983 })
    await openGeneratedFlow(launch.app, page, fixture.path, fixture.surfaceId)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 60_000 })
    await chat.getByLabel('本轮引用', { exact: true }).selectOption('page')
    await chat.getByLabel('意图', { exact: true }).selectOption('edit')
    await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
    const prompt = '把当前空白流式讲义制作成一页可使用的观察练习，主题是“观察小狗并描述特征”。要有标题、两小段解释、工程内现有配图，以及已有“教学排序”组件制作的观察步骤排序互动。直接完成当前页，保留全局教师控制器；复用现有素材和组件，不生成新图片，不修改组件源码。请直接提交完成结果。'
    try {
      if (!preservedRoot) await sendNatural(run, 'flow-first-generation', prompt, 600_000)
      else writeFileSync(join(evidenceDirectory, 'preserved-generation-source.json'), JSON.stringify({ sourceRoot: preservedRoot, generatedAgain: false, purpose: 'Repeat UI verification after fixing test shutdown; original generation and Undo/Redo evidence stay in the source run.' }))
    } catch (error) {
      await recordEvidence(run, 'flow-interrupted')
      await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
      writeFileSync(join(evidenceDirectory, 'generation-interruption.json'), JSON.stringify({ error: String(error), pageErrors: run.pageErrors, consoleErrors: run.consoleErrors }, null, 2))
      throw error
    }
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    const original = openCourseProjectArchive(new Uint8Array(readFileSync(fixture.path))).project
    const flow = original.surfaces.find(surface => surface.type === 'flow')!
    expect(flow.layout.widthMode).toBe('fluid')
    expect(flow.blocks.some(block => block.type === 'media')).toBe(true)
    expect(flow.blocks.some(block => block.type === 'component')).toBe(true)
    expect(flow.blocks.filter(block => block.type === 'paragraph').length).toBeGreaterThanOrEqual(2)
    const records: ReturnType<typeof nativeRecords> = preservedRoot ? JSON.parse(readFileSync(join(preservedRoot, 'flow-final.native.json'), 'utf8')).records : nativeRecords(run)
    expect(records.at(-1)!.tasks.at(-1)!.status).toBe('completed')
    expect(records.flatMap(record => record.hostResults).flatMap(result => result.receipts).some(receipt => receipt.status === 'committed')).toBe(true)
    writeFileSync(join(evidenceDirectory, 'ai-generated-project.json'), JSON.stringify(original, null, 2))
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    if (!preservedRoot) {
      await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    }
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await openGeneratedFlow(launch.app, page, fixture.path, fixture.surfaceId)
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(fixture.path))).project).toEqual(original)
    for (const size of [{ width: 1574, height: 983 }, { width: 1280, height: 720 }]) {
      await setContentSize(launch.app, page, size)
      await capture(page, page.getByTestId('flow-workspace'), `ai-edit-${size.width}`)
      await enterTryRun(page)
      const host = page.getByTestId('flow-try-run-host')
      if (await host.getByRole('button', { name: '展开教师控制器' }).count()) await clickCollapse(page, host, false)
      const metrics = await measureGenerated(host)
      expect(metrics.bodyWidth).toBeCloseTo(metrics.scrollWidth - 104, 0)
      expect(metrics.bars.every(bar => bar.hidden)).toBe(true)
      await expect(host.locator('.flow-block-media img')).toBeVisible()
      const rows = host.locator('.sort .label'), before = await rows.allTextContents()
      await host.getByRole('button', { name: /下移$/ }).first().click()
      const changed = await rows.allTextContents(); expect(changed).not.toEqual(before)
      await host.getByTestId('flow-runtime-article').evaluate(element => { element.scrollTop = 0 })
      await host.getByRole('button', { name: '缩放', exact: true }).click()
      const panel = host.getByRole('group', { name: '课件观察缩放' })
      await panel.getByRole('button', { name: '放大', exact: true }).click()
      expect(await rows.allTextContents()).toEqual(changed)
      await panel.getByRole('button', { name: '恢复视图' }).click()
      await panel.getByRole('button', { name: '关闭', exact: true }).click()
      await capture(page, host, `ai-trial-${size.width}`)
      writeFileSync(join(evidenceDirectory, `ai-trial-${size.width}.json`), JSON.stringify(metrics, null, 2))
      await returnToEdit(page)
      await page.getByRole('button', { name: '整课预览', exact: true }).click()
      const preview = page.getByTestId('course-preview-host')
      await expect(preview.locator('.sort')).toBeVisible()
      if (await preview.getByRole('button', { name: '展开教师控制器' }).count()) await clickCollapse(page, preview, false)
      const previewMetrics = await measureGenerated(preview)
      expect(previewMetrics.bodyWidth).toBeCloseTo(previewMetrics.scrollWidth - 104, 0)
      expect(previewMetrics.bars.every(bar => bar.hidden)).toBe(true)
      await capture(page, preview, `ai-preview-${size.width}`)
      writeFileSync(join(evidenceDirectory, `ai-preview-${size.width}.json`), JSON.stringify(previewMetrics, null, 2))
      await page.getByRole('button', { name: '关闭预览' }).click()
    }
    htmlPath = join(evidenceDirectory, 'ai-generated.html')
    await patchDialogs(launch.app, { htmlSave: htmlPath })
    await page.getByTestId('export-menu-trigger').click(); await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误'); await preflight.getByRole('button', { name: '继续导出' }).click()
    await expect.poll(() => existsSync(htmlPath) ? statSync(htmlPath).size : 0, { timeout: 30_000 }).toBeGreaterThan(1000)
    const browser = await chromium.launch({ headless: true })
    try {
      const html = await browser.newPage({ viewport: { width: 1574, height: 983 } })
      await html.goto(pathToFileURL(htmlPath).href)
      await expect(html.locator('.sort')).toBeVisible()
      await html.getByRole('button', { name: /下移$/ }).first().click()
      await capture(html, html.locator('[data-playback-view]'), 'ai-html')
    } finally { await browser.close() }
    writeFileSync(join(evidenceDirectory, 'ui-checks-passed.json'), JSON.stringify({ generationSource: preservedRoot ?? evidenceDirectory, undoRedo: !preservedRoot, saveReopen: true, trial: true, preview: true, html: true, outputModifiedForTest: false }))
  } finally {
    await recordEvidence(run, 'flow-final').catch(() => undefined)
    await page.screenshot({ path: join(evidenceDirectory, 'last-state.png') }).catch(() => undefined)
    await closeEditor(launch.app, launch.userDataPath)
  }
})
test('Slide and Spatial retain base fit and controller actions with floating observation bars', async () => {
  evidenceDirectory = join(root, 'output', 'r18-089', `other-surfaces-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(evidenceDirectory, { recursive: true })
  const base = createBlankCourseProject()
  const added = addCourseSpatialPage(base, { title: '空间检查', expectedRevision: base.revision })
  if (!added.ok) throw new Error(added.reason)
  const path = join(evidenceDirectory, 'other-surfaces.html')
  writeFileSync(path, buildPublishedCourseStandaloneHtml({ project: added.project, assetFiles: {}, components: {} },
    { playerBundle: readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8') }))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(pathToFileURL(path).href)
    for (const index of [0, 1]) {
      if (index) await page.evaluate(() => (window as any).__H5_LESSON_PLAYER__.goToScene(1))
      const host = page.locator('[data-playback-view]')
      await expect(host).toBeVisible()
      await expect(host.getByRole('scrollbar')).toHaveCount(0)
      const zoom = host.getByRole('button', { name: '缩放', exact: true })
      await expectUnclipped(zoom)
      const before = await zoom.boundingBox()
      await zoom.click()
      const panel = host.getByRole('group', { name: '课件观察缩放' })
      for (let i = 0; i < 4; i++) await panel.getByRole('button', { name: '放大', exact: true }).click()
      await expect(panel.locator('output')).toHaveText('200%')
      expect((await zoom.boundingBox())!.width).toBeCloseTo(before!.width, 0)
      for (const label of ['左右移动视图', '上下移动视图']) await host.getByRole('scrollbar', { name: label }).press('End')
      await capture(page, host, index ? 'spatial-zoom200' : 'slide-zoom200')
      await panel.getByRole('button', { name: '恢复视图' }).click()
      await expect(host.getByRole('scrollbar')).toHaveCount(0)
      await panel.getByRole('button', { name: '关闭', exact: true }).click()
      await expectUnclipped(zoom)
    }
  } finally { await browser.close() }
})
