import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { chooseM20Workspace, closeM20, launchM20, m20Fixture, m20Row } from './helpers/g20M20Harness'

test('Word close freezes real keyboard input until a failed save releases the editor', async () => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(120000)
  const fixture = m20Fixture(), name = 'close-lease.docx'
  const created = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Original' }] })
  writeFileSync(join(fixture.workspace, name), created.bytes)
  const { app, page } = await launchM20(fixture)
  try {
    await chooseM20Workspace(app, page, fixture.workspace)
    await m20Row(page, name).dblclick()
    const editor = page.locator('.office-word-editor').filter({ visible: true })
    const paragraph = editor.getByRole('textbox', { name: '第 1 段', exact: true })
    await expect(paragraph).toHaveText('Original', { timeout: 45000 })
    await paragraph.fill('Draft')
    await expect(editor.locator('.office-leaf-status')).toHaveText('有未保存修改')
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, input: { type?: string }) => unknown> })._invokeHandlers
      const original = handlers.get('office-document:operate')
      if (!original) throw new Error('Office IPC handler is unavailable')
      const state = globalThis as typeof globalThis & { closeLeaseEntered?: boolean; closeLeaseReject?: () => void }
      handlers.set('office-document:operate', (event, input) => {
        if (input.type !== 'office-document.save') return original(event, input)
        state.closeLeaseEntered = true
        return new Promise((_resolve, reject) => { state.closeLeaseReject = () => reject(new Error('test delayed save failure')) })
      })
    })
    await page.getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    const prompt = page.getByRole('group', { name: '关闭前处理未保存的修改' })
    await prompt.getByRole('button', { name: '保存并关闭' }).click()
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as typeof globalThis & { closeLeaseEntered?: boolean }).closeLeaseEntered))).toBe(true)
    const host = editor.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " office-file-view ")]')
    await expect(host).toHaveAttribute('inert', '')
    await page.evaluate(() => {
      const state = window as typeof window & { closeLeaseKeys?: number }
      state.closeLeaseKeys = 0
      document.addEventListener('keydown', event => { if (event.isTrusted) state.closeLeaseKeys!++ }, { capture: true })
    })
    await paragraph.evaluate(node => (node as HTMLElement).focus())
    expect(await paragraph.evaluate(node => node.contains(document.activeElement))).toBe(false)
    await page.keyboard.type('TAIL')
    expect(await page.evaluate(() => (window as typeof window & { closeLeaseKeys?: number }).closeLeaseKeys)).toBeGreaterThan(0)
    await expect(paragraph).toHaveText('Draft')
    await app.evaluate(() => (globalThis as typeof globalThis & { closeLeaseReject?: () => void }).closeLeaseReject?.())
    await expect(host).not.toHaveAttribute('inert', '')
    await expect(prompt.getByRole('button', { name: '取消关闭' })).toBeEnabled()
    await prompt.getByRole('button', { name: '取消关闭' }).click()
    await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type('Z')
    await expect(paragraph).toHaveText('DraftZ')
  } finally { await closeM20(app) }
})
