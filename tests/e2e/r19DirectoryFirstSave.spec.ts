import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('r19 V02 directory conversation first-save uses the Save button without a pre-bound archive', async () => {
  test.setTimeout(180_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-dir-first-save-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'first.h5lesson')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
    await page.getByRole('button', { name: '新建工作空间会话' }).first().click()
    await expect(page.locator('.course-chat--embedded')).toBeVisible()
    await expect(page.getByRole('button', { name: '开始自动创作' })).toHaveCount(0)
    await expect(page.locator('.course-chat-launch')).toHaveCount(0)
    await page.getByLabel('布局').click()
    await page.getByRole('button', { name: '展开内容区' }).click({ force: true })
    const workbenchTab = page.getByRole('tab', { name: '文档与课件' })
    if (await workbenchTab.count()) await workbenchTab.click({ force: true })
    const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）', exact: true })
    await expect(saveButton).toBeVisible()
    const backdrop = page.locator('.lesson-popover-backdrop')
    if (await backdrop.count()) await backdrop.click({ force: true })
    await app.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename })
    }, firstPath)
    await saveButton.click({ force: true })
    await page.keyboard.press('Control+s')
    await expect.poll(() => existsSync(firstPath), { timeout: 20_000 }).toBe(true)
    expect(readFileSync(firstPath).subarray(0, 2).toString()).toBe('PK')
    const normalizedWorkspace = workspace.replace(/\\/g, '/').toLowerCase()
    await expect.poll(async () => {
      const conversations = await page.evaluate(async workspace => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', owner: { kind: 'workspace', workspaceRoot: workspace } })).conversations!, normalizedWorkspace)
      return conversations?.[0]?.projectTarget?.normalizedPath ?? ''
    }).toBe(firstPath.replace(/\\/g, '/').toLowerCase())
    const conversations = await page.evaluate(async workspace => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', owner: { kind: 'workspace', workspaceRoot: workspace } })).conversations!, normalizedWorkspace)
    expect(conversations).toHaveLength(1)
    expect(conversations[0]!.projectTarget?.projectId).toBeTruthy()
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
