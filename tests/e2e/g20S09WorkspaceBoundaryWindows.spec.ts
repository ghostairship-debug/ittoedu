import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

const root = resolve(__dirname, '../..')

test('S09 Windows IPC preserves originals on recycle failure and rejects external junction and forged sender', async () => {
  test.skip(process.platform !== 'win32', 'Windows junction and Electron sender behavior require the Windows carrier.')
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/s09'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'boundary-'))
  const workspace = join(directory, 'workspace'), outside = join(directory, 'outside')
  mkdirSync(workspace); mkdirSync(outside)
  const keep = join(workspace, 'keep.md'), secret = join(outside, 'secret.md'), junction = join(workspace, 'escape')
  writeFileSync(keep, 'keep')
  writeFileSync(secret, 'outside')
  symlinkSync(outside, junction, 'junction')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await expect(tree.getByRole('button', { name: 'keep.md', exact: true })).toBeVisible()

    const observed = await page.evaluate(async directory => {
      const files = window.desktopAPI!.workspaceFiles!
      const granted = await files({ type: 'root', directory })
      const listed = await files({ type: 'list', workspaceId: granted.workspaceId, directoryEntryId: granted.rootEntryId })
      const created = await files({ type: 'mkdir', workspaceId: granted.workspaceId, operationId: 'valid-directory',
        targetDirectoryId: granted.rootEntryId, name: 'legitimate' })
      return { granted, listed, created }
    }, workspace)
    expect(observed.listed.entries).toContainEqual({ status: 'blocked', name: 'escape', reason: 'outside-workspace' })
    expect(observed.created.status).toBe('success')
    expect(existsSync(join(workspace, 'legitimate'))).toBe(true)
    expect(readFileSync(secret, 'utf8')).toBe('outside')

    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      shell.trashItem = async () => { throw Object.assign(new Error('recycle unavailable'), { code: 'EACCES' }) }
    })
    const selected = tree.getByRole('button', { name: 'keep.md', exact: true })
    await selected.click(); await selected.press('Delete')
    await expect(page.getByRole('list', { name: '文件操作结果' })).toContainText('recycle unavailable')
    expect(readFileSync(keep, 'utf8')).toBe('keep')
    expect(readFileSync(secret, 'utf8')).toBe('outside')

    const forged = await app.evaluate(async ({ BrowserWindow }, input) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      try {
        await window.loadURL('about:blank')
        return await window.webContents.executeJavaScript(
          `require('electron').ipcRenderer.invoke(${JSON.stringify(input.channel)}, ${JSON.stringify(input.request)})`,
        )
      } finally { window.destroy() }
    }, { channel: IPC_CHANNELS.workspaceFiles, request: { type: 'root', directory: workspace } })
    expect(forged).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_IPC_SOURCE' } })
    expect(readFileSync(keep, 'utf8')).toBe('keep')
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    if (existsSync(junction)) rmSync(junction, { force: true })
    if (!resolve(directory).startsWith(resolve(base) + sep)) throw new Error('Unsafe S09 fixture cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})
