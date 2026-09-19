import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

/** Same launch shape as r19TaskDrivenTeacherChain.spec.ts. `background: false` shows the window;
 *  the chat specs currently run with the default background launch. */
export async function launchEditor(profile: string, background = true) {
  return electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: background ? '1' : '0' } })
}

export function runDirectory(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix))
}

export async function destroyEditor(app: ElectronApplication | undefined, directory: string) {
  if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
  await app?.close().catch(() => {})
  rmSync(directory, { recursive: true, force: true })
}

export async function dismissOverlays(page: Page) {
  const backdrop = page.locator('.lesson-popover-backdrop')
  if (await backdrop.count()) await backdrop.first().click({ force: true })
  const reopen = page.getByRole('button', { name: '展开资源与会话侧栏', exact: true })
  if (await reopen.isVisible().catch(() => false)) await reopen.click({ force: true })
  // 三个顶栏/标签行弹层（工作空间切换器 / 布局 / ＋新建）都是 <details class="lesson-workspace-more">，
  // 点开后才会挂载 .lesson-popover-backdrop（lessonWorkspaceShell.css:169，position:fixed;inset:0;z-index:13，
  // 遮挡整个界面且不会自愈）。revealWorkbench 展开内容区走的是「布局」弹层，弹层里的展开/收起按钮
  // 不负责关弹层，而展开点击用的是 force、不做可见性等待，所以上面「先 count() 再点一下」会稳定扑空：
  // backdrop 在 helper 返回之后才挂载，之后每一次普通点击（刷新工作空间根目录 / ＋新建标签页……）
  // 都被它拦下并 30s 超时。
  // 收口动作按产品自己的关闭路径走：优先点 backdrop（onClick 置 state=false），没有 backdrop 时点 summary
  // 走浏览器原生开合；并以「没有打开的弹层、也没有 backdrop」连续两次观测都成立为终态——React 的 toggle
  // 事件晚于浏览器默认开合（实测约 80ms），单次判空不足以外推。
  const openMenu = page.locator('details.lesson-workspace-more[open]')
  for (let attempt = 0, clean = 0; attempt < 8 && clean < 2; attempt += 1) {
    if (await backdrop.count()) { clean = 0; await backdrop.first().click({ force: true }); continue }
    if (await openMenu.count()) { clean = 0; await openMenu.first().locator('summary').click({ force: true }); continue }
    clean += 1
    if (clean < 2) await page.waitForTimeout(150)
  }
  await expect(openMenu).toHaveCount(0)
  await expect(backdrop).toHaveCount(0)
}

export async function revealWorkbench(page: Page) {
  const closed = page.locator('.lesson-workspace-columns[data-content-closed="true"]')
  if (await closed.count()) {
    await page.getByLabel('布局').click()
    await page.getByRole('button', { name: '展开内容区', exact: true }).click({ force: true })
  }
  await dismissOverlays(page)
  const workbenchTab = page.getByRole('tab', { name: '文档与课件' })
  if (await workbenchTab.count()) await workbenchTab.click({ force: true })
}

export async function openWorkspaceAndSession(app: ElectronApplication, workspace: string) {
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
  await page.getByRole('button', { name: '新建工作空间会话' }).first().click()
  await expect(page.locator('.course-chat--embedded')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始自动创作' })).toHaveCount(0)
  await revealWorkbench(page)
  return page
}

export async function firstSave(app: ElectronApplication, page: Page, firstPath: string) {
  const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）', exact: true })
  await expect(saveButton).toBeVisible()
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, firstPath)
  await saveButton.click({ force: true })
  await page.keyboard.press('Control+s')
  await expect.poll(() => existsSync(firstPath), { timeout: 20_000 }).toBe(true)
}

export async function typeAndSubmit(chat: Locator, text: string) {
  await expect(chat.getByRole('button', { name: '正在保存配置…' })).toHaveCount(0)
  await chat.getByRole('textbox', { name: '发送给创作助手' }).fill(text)
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await chat.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
}

export function archiveHasMarker(path: string, marker: string) {
  const files = unzipSync(readFileSync(path))
  const json = files['project.json']
  if (!json) throw new Error(`archive missing project.json: ${path}`)
  return Buffer.from(json).toString('utf8').includes(marker)
}
