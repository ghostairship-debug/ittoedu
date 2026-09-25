import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {})
}
for (const scale of [1.25, 1.5]) test(`M01 width persistence and deep-view navigation at Windows Electron scale ${scale}`, async ({}, info) => {
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/b07/layout'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, `scale-${scale}-`)), profile = join(directory, 'profile')
  const launch = () => electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`, `--force-device-scale-factor=${scale}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(600, 500); window.setContentSize(1300, 800) })
    const splitter = page.getByRole('separator', { name: '调整资源区宽度', exact: true })
    await expect(splitter).toBeVisible()
    const initial = Number(await splitter.getAttribute('aria-valuenow')), bounds = (await splitter.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 40); await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 + 65, bounds.y + 40, { steps: 5 }); await page.mouse.up()
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(initial + 40)
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('guoling-workbench-layout-v2')!))
    expect(persisted.navWidth).toBeGreaterThan(initial + 40)
    await close(app); app = await launch(); page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(600, 500); window.setContentSize(1300, 800) })
    await expect.poll(async () => Number(await page.getByRole('separator', { name: '调整资源区宽度', exact: true }).getAttribute('aria-valuenow'))).toBe(persisted.navWidth)
    await page.getByLabel('新建标签页').click(); await page.getByRole('button', { name: '创建文档', exact: true }).click()
    await expect(page.getByRole('region', { name: /^教学文档 / })).toBeVisible()
    const identity = await page.evaluate(async () => (await window.desktopAPI!.documents!.list()).find(document => document.model.kind === 'markdown')!.documentId)
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(page.getByRole('button', { name: '返回轻量编辑', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回轻量编辑', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(620, 650))
    await page.locator('.lesson-workspace-toolbar-actions').getByRole('button', { name: '内容', exact: true }).click()
    // The top action can collapse content; restore it through the explicit mobile pane selector.
    await page.getByRole('tablist', { name: '工作台区域', exact: true }).getByRole('tab', { name: '内容', exact: true }).click()
    await expect(page.getByRole('region', { name: /^教学文档 / })).toBeVisible()
    const content = (await page.locator('.workspace-region--content').boundingBox())!
    const viewport = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth }))
    expect(content.width).toBeGreaterThan(400)
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 2)
    expect(viewport.ratio).toBeCloseTo(scale, 1)
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(page.getByRole('button', { name: '返回轻量编辑', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回轻量编辑', exact: true }).click()
    expect(await page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).documentId, identity)).toBe(identity)
    await page.screenshot({ path: join(directory, 'narrow-restored.png') })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ scaleMethod: 'Windows Electron --force-device-scale-factor (not a system-wide DPI change)', scale, persisted, viewport, content, documentId: identity }, null, 2))
    await info.attach('narrow-restored', { path: join(directory, 'narrow-restored.png'), contentType: 'image/png' })
  } catch (error) { await (await app.firstWindow()).screenshot({ path: join(directory, 'failure.png') }).catch(() => {}); throw error }
  finally { await close(app) }
})
