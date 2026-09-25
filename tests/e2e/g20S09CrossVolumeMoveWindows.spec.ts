import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, parse, resolve, sep } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('S09-T03 authorized workspace handles move a file across real C: and D: volumes via desktop IPC', async () => {
  test.skip(process.platform !== 'win32', 'This case requires the Windows C: and D: volumes.')
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/s09'); mkdirSync(base, { recursive: true })
  const evidenceDirectory = join(base, 'cross-volume-move'), evidenceFile = join(evidenceDirectory, 'ipc-evidence.json')
  rmSync(evidenceFile, { force: true })
  const sourceRoot = mkdtempSync(join(os.tmpdir(), 'g20-s09-ipc-source-'))
  const targetRoot = mkdtempSync(join(base, 'cross-volume-ipc-target-'))
  const sourceFile = join(sourceRoot, 'good.md'), targetFile = join(targetRoot, 'good.md')
  writeFileSync(sourceFile, 'real C to D')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    expect(parse(sourceRoot).root.toLowerCase()).toBe('c:\\')
    expect(parse(targetRoot).root.toLowerCase()).toBe('d:\\')
    const sourceDevice = statSync(sourceRoot).dev, targetDevice = statSync(targetRoot).dev
    expect(sourceDevice).not.toBe(targetDevice)
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(targetRoot, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    const chooseWorkspace = async (directory: string) => {
      await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, directory)
      await page.getByLabel('切换工作空间').click()
      await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    }
    await chooseWorkspace(sourceRoot)
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await expect(tree.getByRole('button', { name: 'good.md', exact: true })).toBeVisible()
    await chooseWorkspace(targetRoot)

    const observed = await page.evaluate(async ({ sourceDirectory, targetDirectory }) => {
      const files = window.desktopAPI!.workspaceFiles!
      const source = await files({ type: 'root', directory: sourceDirectory })
      const target = await files({ type: 'root', directory: targetDirectory })
      const listed = await files({ type: 'list', workspaceId: source.workspaceId, directoryEntryId: source.rootEntryId })
      const item = listed.entries.find(entry => entry.status === 'accessible' && entry.name === 'good.md')
      if (!item || item.status !== 'accessible') throw new Error('Source handle is missing')
      const denied = async (targetWorkspaceId?: string) => {
        try {
          const result = await files({ type: 'move', operationId: `rejected-${targetWorkspaceId ?? 'omitted'}`,
            workspaceId: source.workspaceId, ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
            sourceEntryIds: [item.entryId], targetDirectoryId: target.rootEntryId })
          return { accepted: result.status === 'success' || result.status === 'partial',
            status: result.status, errorCode: result.items[0]?.error?.code }
        } catch (error) { return { accepted: false, errorName: typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : 'unknown' } }
      }
      const ungrantedRoot = await denied('not-an-authorized-workspace')
      const omittedRoot = await denied()
      const moved = await files({ type: 'move', operationId: 'authorized-cross-volume-move', workspaceId: source.workspaceId,
        targetWorkspaceId: target.workspaceId, sourceEntryIds: [item.entryId], targetDirectoryId: target.rootEntryId })
      const resolved = await files({ type: 'resolve', workspaceId: target.workspaceId, entryId: item.entryId })
      return { ungrantedRoot, omittedRoot, moved, resolved, sourceEntryId: item.entryId,
        sourceWorkspaceId: source.workspaceId, targetWorkspaceId: target.workspaceId }
    }, { sourceDirectory: sourceRoot, targetDirectory: targetRoot })
    expect(observed.ungrantedRoot.accepted).toBe(false)
    expect(observed.omittedRoot.accepted).toBe(false)
    expect(observed.omittedRoot).toMatchObject({ status: 'failed', errorCode: 'unknown-entry' })
    expect(observed.moved).toMatchObject({ status: 'success', items: [{ status: 'success',
      sourceEntryId: observed.sourceEntryId, entryId: observed.sourceEntryId, targetPath: targetFile }] })
    expect(observed.resolved).toMatchObject({ workspaceId: observed.targetWorkspaceId, resolvedPath: targetFile })
    expect(existsSync(sourceFile)).toBe(false)
    expect(readFileSync(targetFile, 'utf8')).toBe('real C to D')
    await expect(tree.getByRole('button', { name: 'good.md', exact: true })).toBeVisible()

    mkdirSync(evidenceDirectory, { recursive: true })
    const builtFiles = ['dist-electron/main/index.js', 'dist-electron/main/ipc.js',
      'dist-electron/main/workbench/WorkspaceFiles.js', 'dist-electron/main/workbench/workspaceFilesDesktopService.js']
    writeFileSync(evidenceFile, JSON.stringify({
      caseId: 'S09-T03-CROSS-VOLUME-IPC', result: 'passed', capturedAt: new Date().toISOString(),
      testLayer: 'Playwright Electron main-window IPC', platform: process.platform,
      buildSha256ByRelativePath: Object.fromEntries(builtFiles.map(file => [file,
        createHash('sha256').update(readFileSync(join(root, file))).digest('hex')])),
      volumes: { sourceDrive: 'C:', targetDrive: 'D:', distinctDeviceIds: sourceDevice !== targetDevice },
      authorizedRoots: { sourceSelectedByNativePicker: true, targetSelectedByNativePicker: true },
      denied: { ungrantedTargetRoot: !observed.ungrantedRoot.accepted, omittedTargetRoot: !observed.omittedRoot.accepted },
      receipt: { status: observed.moved.status, itemStatus: observed.moved.items[0]?.status,
        sourceHandleMigratedToTargetRoot: observed.resolved.workspaceId === observed.targetWorkspaceId },
      disk: { sourceAbsent: !existsSync(sourceFile), targetContentReadBack: readFileSync(targetFile, 'utf8') === 'real C to D' },
    }, null, 2), 'utf8')
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    if (!resolve(sourceRoot).startsWith(resolve(os.tmpdir()) + sep) || !resolve(targetRoot).startsWith(resolve(base) + sep)) {
      throw new Error('Unsafe S09 cross-volume IPC fixture cleanup')
    }
    rmSync(sourceRoot, { recursive: true, force: true })
    rmSync(targetRoot, { recursive: true, force: true })
  }
})
