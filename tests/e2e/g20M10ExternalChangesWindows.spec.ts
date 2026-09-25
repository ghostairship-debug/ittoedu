import { _electron as electron, expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const lockScript = String.raw`
$stream = [System.IO.File]::Open($env:G20_LOCK_SOURCE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
try {
  [System.IO.File]::WriteAllText($env:G20_LOCK_READY, 'ready')
  while (-not [System.IO.File]::Exists($env:G20_LOCK_RELEASE)) { Start-Sleep -Milliseconds 25 }
} finally { $stream.Dispose() }
`

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve() }, 3_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

test('M10-T04 external changes retain tree state and an occupied file gives an honest partial batch', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M10 desktop file moves are accepted on Windows.')
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/m10/changes'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), folder = join(workspace, 'folder'), target = join(workspace, 'target')
  mkdirSync(folder, { recursive: true }); mkdirSync(target)
  writeFileSync(join(folder, 'keep.md'), 'keep')
  writeFileSync(join(workspace, 'available.md'), 'available')
  const busy = join(workspace, 'busy.md'), ready = join(directory, 'lock-ready'), release = join(directory, 'lock-release')
  writeFileSync(busy, 'occupied')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let locker: ChildProcess | undefined
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const files = page.locator('.workspace-files-tree'), tree = files.getByRole('tree', { name: '工作空间文件' })
    await expect(tree.getByRole('button', { name: 'folder', exact: true })).toBeVisible()
    await page.evaluate(async directory => {
      const files = window.desktopAPI!.workspaceFiles!, root = await files({ type: 'root', directory })
      await files({ type: 'watch', workspaceId: root.workspaceId })
    }, workspace)

    writeFileSync(join(workspace, 'external.md'), 'new')
    await expect(tree.getByRole('button', { name: 'external.md', exact: true })).toBeVisible()
    const folderRow = tree.getByRole('button', { name: 'folder', exact: true })
    await folderRow.dblclick()
    const nested = tree.getByRole('button', { name: 'keep.md', exact: true })
    await nested.click()
    const selectedId = await nested.getAttribute('data-entry-id'), folderId = await folderRow.getAttribute('data-entry-id')
    renameSync(folder, join(workspace, 'renamed-folder'))
    const renamedFolder = tree.getByRole('button', { name: 'renamed-folder', exact: true })
    await expect(renamedFolder).toBeVisible()
    await expect(renamedFolder).toHaveAttribute('data-entry-id', folderId!)
    await expect(renamedFolder.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-open', 'true')
    await expect(tree.getByRole('button', { name: 'keep.md', exact: true })).toHaveAttribute('data-entry-id', selectedId!)
    await expect(tree.getByRole('button', { name: 'keep.md', exact: true })).toHaveAttribute('aria-pressed', 'true')

    let lockError = ''
    locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lockScript], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, G20_LOCK_SOURCE: busy, G20_LOCK_READY: ready, G20_LOCK_RELEASE: release },
    })
    locker.stderr?.on('data', chunk => { lockError += String(chunk) })
    await expect.poll(() => existsSync(ready) || locker?.exitCode !== null, { timeout: 8_000 }).toBe(true)
    if (!existsSync(ready)) throw new Error(`Could not hold Windows file handle: ${lockError}`)
    await tree.getByRole('button', { name: 'available.md', exact: true }).click()
    await tree.getByRole('button', { name: 'busy.md', exact: true }).click({ modifiers: ['Control'] })
    await files.getByRole('button', { name: '移动到…' }).click()
    await files.getByLabel('目标文件夹').selectOption({ label: 'target' })
    await files.getByRole('button', { name: '确认' }).click()
    const results = files.getByRole('list', { name: '文件操作结果' })
    await expect(results).toBeVisible()
    await expect(results.locator('[data-status="success"]')).toContainText('available.md')
    await expect(results.locator('[data-status="failed"]')).toContainText('busy.md')
    expect(readFileSync(join(target, 'available.md'), 'utf8')).toBe('available')
    expect(readFileSync(busy, 'utf8')).toBe('occupied')
    expect(existsSync(join(target, 'busy.md'))).toBe(false)
    const partialScreenshot = join(directory, 'occupied-partial-result.png')
    await page.screenshot({ path: partialScreenshot })
    await info.attach('occupied-partial-result', { path: partialScreenshot, contentType: 'image/png' })

    writeFileSync(release, 'release'); await waitForExit(locker); locker = undefined
    await files.getByRole('button', { name: '确认' }).click()
    await expect(files.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => existsSync(join(target, 'busy.md'))).toBe(true)
    expect(existsSync(busy)).toBe(false)
    expect(errors).toEqual([])
    const screenshot = join(directory, 'external-and-retried-batch.png')
    await page.screenshot({ path: screenshot })
    await info.attach('external-and-retried-batch', { path: screenshot, contentType: 'image/png' })
  } finally {
    writeFileSync(release, 'release')
    if (locker) await waitForExit(locker)
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
