import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectFit, isOffPageColour, openInWorkbench, pixelAt, rectOf, root, slideCourse } from './helpers/g20M19Harness'

test('M19-T04 fullscreen playback shows the page on black, whole and clipped, and leaves it again', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/m19/fullscreen'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  const offPage = { x: 1180, y: 300, width: 300, height: 120 }
  writeFileSync(join(workspace, 'landscape.h5lesson'), slideCourse('M19 fullscreen', { width: 1280, height: 720 }, offPage))
  const evidence: Record<string, unknown> = { run: directory }
  const errors: string[] = []
  // Fullscreen needs a real, visible window: this spec runs in the foreground and holds fullscreen for a moment.
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '' } })
  try {
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openInWorkbench(page, 'landscape.h5lesson')
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const frame = page.locator('.course-try-run-host [data-playback-view]')
    await expect(frame).toBeVisible()
    // The default controller starts collapsed; open it, then use its 全屏.
    const controller = await rectOf(page, '.course-try-run-host .published-component-mount')
    await page.mouse.click(controller.x + controller.width / 2, controller.y + controller.height / 2)
    await page.getByRole('button', { name: '全屏', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-playback-view') ?? false)).toBe(true)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true)
    await expect(frame).toHaveCSS('background-color', 'rgb(0, 0, 0)')
    const screen = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const pageRect = await rectOf(page, '.course-try-run-host [data-slide-scene-stage]')
    // The whole 16:9 page, centred, no margins.
    expectFit(pageRect, { x: 0, y: 0, ...screen }, { width: 1280, height: 720 }, { top: 0, right: 0, bottom: 0, left: 0 })
    const scale = pageRect.width / 1280, row = pageRect.y + (offPage.y + offPage.height / 2) * scale
    expect(isOffPageColour(await pixelAt(page, page, pageRect.x + pageRect.width - 6, row))).toBe(true)
    if (pageRect.x + pageRect.width + 8 < screen.width) expect(await pixelAt(page, page, pageRect.x + pageRect.width + 8, row)).toEqual([0, 0, 0])
    else expect(await pixelAt(page, page, pageRect.x + 8, pageRect.y - 8 > 0 ? pageRect.y - 8 : pageRect.y + pageRect.height + 8)).toEqual([0, 0, 0])
    await page.screenshot({ path: join(shots, 'fullscreen.png') })
    evidence.fullscreen = { screen, pageRect }
    // 全屏 again leaves fullscreen and the workspace shows around the page once more.
    await page.getByRole('button', { name: '全屏', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(frame).not.toHaveCSS('background-color', 'rgb(0, 0, 0)')
    await page.screenshot({ path: join(shots, 'after-fullscreen.png') })
    expect(errors).toEqual([])
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, errors }, null, 2))
    await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
