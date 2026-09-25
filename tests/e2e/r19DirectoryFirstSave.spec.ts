import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('canonical first-save binds an untitled course without creating or rebinding a conversation', async () => {
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
    await page.getByLabel('新建标签页').click()
    await page.locator('.lesson-new-tab-popover').getByRole('button', { name: '新建课件', exact: true }).click()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(1)
    const before = await page.evaluate(async workspace => ({
      documents: await window.desktopAPI!.documents!.list(),
      conversations: (await window.desktopAPI!.execution!.workspace(workspace)).conversations.map(value => value.conversationId),
    }), workspace)
    const document = before.documents.find(value => value.model.kind === 'course-v9' && value.dirty)!
    expect(document.binding.kind).toBe('untitled')
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
    await expect.poll(async () => page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).binding, document.documentId)).toMatchObject({ kind: 'file', path: firstPath })
    const after = await page.evaluate(async ({ id, workspace }) => ({
      document: await window.desktopAPI!.documents!.read(id),
      conversations: (await window.desktopAPI!.execution!.workspace(workspace)).conversations.map(value => value.conversationId),
    }), { id: document.documentId, workspace })
    expect(after.document.documentId).toBe(document.documentId)
    expect(after.document.dirty).toBe(false)
    expect(after.conversations).toEqual(before.conversations)
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    if (!resolve(directory).startsWith(resolve(tmpdir()) + require('node:path').sep) || !directory.includes('r19-dir-first-save-')) throw new Error('Unsafe test directory')
    rmSync(directory, { recursive: true, force: true })
  }
})
