import { plainDocumentText } from '../../src/shared/document/content'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, chromium, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
const sourcePath = resolve(process.env.COURSEWARE_R18_FLOW_EVIDENCE_FIXTURE ?? join(root, 'output', 'r18-089', 'mixed-spatial-copy.h5lesson'))
const originalText = '人工改稿后仍可保存重开。'
const manualText = '并排助手复核：人工改稿已进入本次新导出。'

async function setContentSize(app: ElectronApplication, page: Page): Promise<void> {
  const host = await app.browserWindow(page)
  await host.evaluate(window => { window.setMinimumSize(640, 480); window.setContentSize(1280, 720) })
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (Math.abs(actual.width - 1280) <= 2 && Math.abs(actual.height - 720) <= 2) break
    await host.evaluate((window, delta) => {
      const bounds = window.getBounds()
      window.setBounds({ width: bounds.width + delta.width, height: bounds.height + delta.height })
    }, { width: 1280 - actual.width, height: 720 - actual.height })
  }
  await expect.poll(() => page.evaluate(() => Math.max(Math.abs(innerWidth - 1280), Math.abs(innerHeight - 720))))
    .toBeLessThanOrEqual(2)
  await expectBackgroundWindowsIsolated(app, true)
}

async function expectUnclipped(target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  await expect.poll(() => target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
      if (!(parent instanceof HTMLElement)) continue
      const sx = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1
      const sy = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1
      if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft * sx)
        right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * sx)
      }
      if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop * sy)
        bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * sy)
      }
      const inset = /^inset\(([^)]*?)(?: round [^)]*)?\)$/.exec(style.clipPath)
      if (inset) {
        const values = inset[1]!.trim().split(/\s+/).map(value => parseFloat(value))
        const t = values[0]!, r = values[1] ?? t, b = values[2] ?? t, l = values[3] ?? r
        left = Math.max(left, bounds.left + l * sx); right = Math.min(right, bounds.right - r * sx)
        top = Math.max(top, bounds.top + t * sy); bottom = Math.min(bottom, bounds.bottom - b * sy)
      }
    }
    return Math.max(rect.width - Math.max(0, right - left), rect.height - Math.max(0, bottom - top))
  })).toBeLessThan(1)
}

async function clickController(page: Page, host: Locator): Promise<void> {
  const collapse = host.getByRole('button', { name: '收起教师控制器', exact: true })
  const zoom = host.getByRole('button', { name: '缩放', exact: true })
  await expectUnclipped(collapse); await expectUnclipped(zoom)
  const box = (await collapse.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const expand = host.getByRole('button', { name: '展开教师控制器', exact: true })
  await expectUnclipped(expand)
  const expandedBox = (await expand.boundingBox())!
  await page.mouse.click(expandedBox.x + expandedBox.width / 2, expandedBox.y + expandedBox.height / 2)
  await expectUnclipped(collapse); await expectUnclipped(zoom)
  await zoom.click()
  const panel = host.getByRole('group', { name: '课件观察缩放' })
  await panel.getByRole('button', { name: '放大', exact: true }).click()
  await expect(panel.locator('output')).toHaveText('125%')
  await panel.getByRole('button', { name: '恢复视图', exact: true }).click()
  await expect(panel.locator('output')).toHaveText('100%')
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
}

test('Flow 1280 docked assistant preserves selection and controller; fresh manual edit reaches new HTML', async () => {
  test.skip(!existsSync(sourcePath), 'Prepare the existing r18-089 lesson or set COURSEWARE_R18_FLOW_EVIDENCE_FIXTURE; skipping is not evidence')
  test.setTimeout(180_000)
  const runRoot = join(root, 'output/r18-evidence-refresh', `flow-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'current-flow-copy.h5lesson'), htmlPath = join(runRoot, 'fresh-flow.html')
  const original = openCourseProjectArchive(new Uint8Array(readFileSync(sourcePath)))
  const flow = original.project.surfaces.find(surface => surface.id === 'mixed-flow-surface')
  const spatial = original.project.surfaces.find(surface => surface.id === 'mixed-spatial-surface')
  expect(flow?.type).toBe('flow'); expect(spatial?.type).toBe('spatial-2d')
  if (!flow || flow.type !== 'flow') throw new Error('Source archive has no formal Flow surface')
  const block = flow.blocks.find(entry => entry.id === 'mixed-flow-paragraph')
  expect(block?.type === 'paragraph' ? plainDocumentText(block.content) : null).toBe(originalText)
  copyFileSync(sourcePath, projectPath)
  expect(existsSync(htmlPath)).toBe(false)
  const result: Record<string, unknown> = { status: 'running', sourcePath, projectPath, htmlPath, sourceRevision: original.project.revision, modelCalls: 0 }
  writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2))
  let app: ElectronApplication | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let page: Page | undefined
  const pageErrors: string[] = [], externalRequests: string[] = []
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_E2E_BACKGROUND: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    app.context().on('page', target => target.on('pageerror', error => pageErrors.push(error.message)))
    page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    // Enter only the landing page; never replace an already opened editor or recovery draft.
    const startupMore = page.locator('.lesson-workspace-more > summary')
    const startupEditor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
    const startupRecovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect.poll(async () => await startupEditor.isVisible() || await startupMore.isVisible() || await startupRecovery.isVisible()).toBe(true)
    if (!await startupEditor.isVisible() && await startupMore.isVisible() && !await startupRecovery.isVisible()) {
      await startupMore.click()
      await page.getByRole('button', { name: '新建独立课件', exact: true }).click()
    }
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    await setContentSize(app, page)
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.projectPath] })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async (...args: any[]) => {
        const options = args.length === 1 ? args[0] : args[1]
        return { canceled: false, filePath: options.title?.includes('HTML') ? paths.htmlPath : paths.projectPath }
      }) as typeof dialog.showSaveDialog
    }, { projectPath, htmlPath })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.getByTestId('flow-page-mixed-flow-surface').click()
    await expect(page.getByTestId('flow-workspace')).toBeVisible()
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible()
    const paragraph = page.getByTestId('flow-paper').locator('[data-flow-block-id="mixed-flow-paragraph"]')
    await paragraph.click()
    await expect(paragraph).toHaveAttribute('aria-selected', 'true')
    const center = await page.locator('.editor-center').boundingBox(), chatBox = await chat.boundingBox()
    expect(center!.width).toBeGreaterThan(250)
    expect(center!.x + center!.width).toBeLessThan(chatBox!.x)
    result.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    result.center = center; result.chat = chatBox
    await page.screenshot({ path: join(runRoot, 'flow-selection-docked.png') })
    await paragraph.dblclick()
    await page.getByTestId('flow-inline-editor').fill(manualText)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    const readSaved = () => openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
    await expect.poll(() => {
      const savedFlow = readSaved().surfaces.find(surface => surface.id === flow.id)
      const savedBlock = savedFlow?.type === 'flow' ? savedFlow.blocks.find(entry => entry.id === block!.id) : null
      return savedBlock?.type === 'paragraph' ? plainDocumentText(savedBlock.content) : null
    }).toBe(manualText)
    const saved = readSaved()
    expect(saved.revision).toBe(original.project.revision + 1)
    expect(saved.globalLayerItems).toEqual(original.project.globalLayerItems)
    expect(saved.surfaces.find(surface => surface.id === spatial!.id)).toEqual(spatial)
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const trial = page.getByTestId('flow-try-run-host')
    await expect(trial).toBeVisible()
    await clickController(page, trial)
    await expect(chat).toBeVisible()
    await expectBackgroundWindowsIsolated(app, true)
    await page.screenshot({ path: join(runRoot, 'flow-controller-docked.png') })
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect.poll(() => existsSync(htmlPath) && readFileSync(htmlPath, 'utf8').includes(manualText), { timeout: 45_000 }).toBe(true)
    result.savedRevision = saved.revision; result.htmlBytes = statSync(htmlPath).size
    await expectBackgroundWindowsIsolated(app, true)
    browser = await chromium.launch({ headless: true })
    const offline = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    offline.on('pageerror', error => pageErrors.push(error.message))
    offline.on('request', request => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()) })
    await offline.context().setOffline(true)
    await offline.goto(pathToFileURL(htmlPath).href)
    await expect.poll(() => offline.evaluate(() => Boolean((window as any).__H5_LESSON_PLAYER__))).toBe(true)
    await offline.evaluate(() => (window as any).__H5_LESSON_PLAYER__.goToScene(1))
    const article = offline.getByTestId('flow-runtime-article')
    await expect(article).toContainText(manualText)
    await expect(article.locator('[data-flow-block-id="mixed-flow-paragraph"]')).toBeVisible()
    await clickController(offline, offline.locator('[data-playback-view]'))
    await offline.getByTestId('r18-089-counter').click()
    await expect(offline.getByTestId('r18-089-counter')).toHaveText('互动计数：1')
    await offline.screenshot({ path: join(runRoot, 'fresh-html.png') })
    expect(pageErrors).toEqual([]); expect(externalRequests).toEqual([])
    result.status = 'passed'; result.pageErrors = pageErrors; result.externalRequests = externalRequests
    result.scope = 'Current production renderer, real Electron UI and fresh offline HTML; no model, no full matrix or Owner acceptance'
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.stack : String(error)
    result.pageErrors = pageErrors; result.externalRequests = externalRequests
    if (page) {
      await page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => undefined)
      writeFileSync(join(runRoot, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => 'unavailable'))
    }
    throw error
  } finally {
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2))
    await browser?.close()
    if (app) {
      await expectBackgroundWindowsIsolated(app, true).catch(() => undefined)
      await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0) }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
})
