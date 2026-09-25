import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
test('M02 close cancellation, first save, discard and M01 empty-state preserve a real untitled document', async ({}, info) => {
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/b07/documents'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), saved = join(directory, 'saved.md')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const tabs = page.locator('.workspace-document-tabs')
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    await page.getByLabel('新建标签页').click()
    await page.getByLabel('Markdown 文档名').fill('独立草稿')
    await page.getByRole('button', { name: '创建文档', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: /^独立草稿\.md/ })).toBeVisible()
    const editor = page.getByRole('region', { name: '教学文档 独立草稿.md', exact: true })
    await editor.getByRole('button', { name: '源文', exact: true }).click()
    const source = editor.getByLabel('正文源文编辑')
    await source.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('# Untitled draft\n\nKeep this text.'); await source.press('Tab')
    const draft = await page.evaluate(async () => (await window.desktopAPI!.documents!.list()).find(document => document.model.kind === 'markdown'))
    expect(draft).toBeDefined()
    await expect.poll(async () => page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).dirty, draft!.documentId)).toBe(true)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }) })
    await tabs.getByRole('button', { name: '关闭 独立草稿.md', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: /^独立草稿\.md/ })).toBeVisible()
    await expect(source).toContainText('Keep this text.')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await tabs.getByRole('button', { name: '关闭 独立草稿.md', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: /^独立草稿\.md/ })).toBeVisible()
    await expect(source).toContainText('Keep this text.')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, saved)
    await tabs.getByRole('button', { name: '关闭 独立草稿.md', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    expect(readFileSync(saved, 'utf8')).toContain('Keep this text.')
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    // Closing the last document keeps the shell and new-document affordance available.
    await page.getByLabel('新建标签页').click()
    await page.getByLabel('Markdown 文档名').fill('放弃草稿')
    await page.getByRole('button', { name: '创建文档', exact: true }).click()
    const discardEditor = page.getByRole('region', { name: '教学文档 放弃草稿.md', exact: true })
    await discardEditor.getByRole('button', { name: '源文', exact: true }).click()
    await discardEditor.getByLabel('正文源文编辑').click(); await page.keyboard.type('discard this'); await page.keyboard.press('Tab')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    await tabs.getByRole('button', { name: '关闭 放弃草稿.md', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.screenshot({ path: join(directory, 'empty-after-close.png') })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ originalDocumentId: draft!.documentId, savedSource: readFileSync(saved, 'utf8'), errors }, null, 2))
    await info.attach('empty-after-close', { path: join(directory, 'empty-after-close.png'), contentType: 'image/png' })
    expect(errors).toEqual([])
  } catch (error) {
    const page = await app.firstWindow(); await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
