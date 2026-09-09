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
import type { ElectronApplication, Locator, Page } from 'playwright'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'

const root = resolve(__dirname, '..', '..')
const fixturePath = join(root, 'tests', 'fixtures', 'architecture-baseline', 'mixed-spatial.h5lesson')
const evidenceDirectory = join(root, 'output', 'r18-089')
const mixedCopyPath = join(evidenceDirectory, 'mixed-spatial-copy.h5lesson')
const htmlPath = join(evidenceDirectory, 'mixed-spatial.html')
const WINDOWS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
] as const

function prepareMixedCopy(): void {
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
  flow.blocks.splice(1, 0, {
    id: 'r18-089-flow-state', type: 'component',
    component: { packageId: 'com.ittoedu.baseline.evidence-panel', version: '4.0.0' },
    props: { title: '观察变换不重置互动', body: '输入答案、增加计数，再缩放、平移和改变窗口。', accent: '#2563eb' },
    staticFallbackAssetId: 'mixed-component-fallback',
  })
  for (let index = 0; index < 24; index += 1) {
    flow.blocks.push({
      id: `r18-089-scroll-${index}`, type: 'paragraph',
      text: `第 ${index + 1} 段：${'正文随窗口宽度重排，纸张滚动与课件观察缩放保持独立。'.repeat(8)}`,
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
  expect(zoomed.x).toBeCloseTo(controllerBefore.x)
  expect(zoomed.y).toBeCloseTo(controllerBefore.y)
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

async function closeEditor(app: ElectronApplication, userDataPath: string): Promise<void> {
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
    if (!exited && child.exitCode === null) child.kill()
  }
  removeProfile(userDataPath)
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

test('mixed-global-controller stays reachable at 1280×720 and 1440×900', async () => {
  // Hidden Windows Electron can deliver animation frames at 1 Hz. Preserve
  // all eight-frame stability checks while allowing both viewport matrices.
  test.setTimeout(420_000)
  mkdirSync(evidenceDirectory, { recursive: true })
  prepareMixedCopy()
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

      await launch.page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
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
      return block && block.type === 'paragraph' ? block.text : null
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
})
