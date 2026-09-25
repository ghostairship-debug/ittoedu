import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'

const root = resolve(__dirname, '../..')
const toLocalUnc = (local: string) => {
  if (!/^D:\\/i.test(local)) throw new Error('This Windows UNC fixture requires the D: workspace drive')
  return `\\\\localhost\\D$\\${local.slice(3)}`
}

test('S09-T05 real localhost UNC root keeps IPC reads and writes inside its authorized directory', async () => {
  test.skip(process.platform !== 'win32', 'UNC and Electron sender checks require Windows.')
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/s09'); mkdirSync(base, { recursive: true })
  const evidenceDirectory = join(base, 'unc-workspace-boundary')
  const evidenceFile = join(evidenceDirectory, 'evidence.json')
  rmSync(evidenceFile, { force: true })
  const directory = mkdtempSync(join(base, 'unc-boundary-'))
  const workspace = join(directory, 'workspace'), outside = join(directory, 'outside')
  mkdirSync(workspace); mkdirSync(outside)
  const keep = join(workspace, 'keep.md'), secret = join(outside, 'secret.md'), junction = join(workspace, 'escape')
  writeFileSync(keep, 'keep'); writeFileSync(secret, 'outside')
  symlinkSync(outside, junction, 'junction')
  const uncWorkspace = toLocalUnc(workspace), uncOutside = toLocalUnc(outside)
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    test.skip(!existsSync(uncWorkspace) || !realpathSync(uncWorkspace).startsWith('\\\\localhost\\'),
      'This host does not expose a usable \\\\localhost\\D$ filesystem share.')
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, uncWorkspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await expect(tree.getByRole('button', { name: 'keep.md', exact: true })).toBeVisible()

    const observed = await page.evaluate(async ({ authorized, unauthorized }) => {
      const files = window.desktopAPI!.workspaceFiles!
      const denied = async (input: Parameters<typeof files>[0]) => {
        try { await files(input); return { accepted: true, name: '' } }
        catch (error) { return { accepted: false, name: error instanceof Error ? error.name : String(error) } }
      }
      const granted = await files({ type: 'root', directory: authorized })
      const listed = await files({ type: 'list', workspaceId: granted.workspaceId, directoryEntryId: granted.rootEntryId })
      const outsideRoot = await denied({ type: 'root', directory: unauthorized })
      const outsideEntry = await denied({ type: 'resolve', workspaceId: granted.workspaceId, entryId: unauthorized })
      const injectedName = await files({ type: 'mkdir', workspaceId: granted.workspaceId, operationId: 'unc-injected-name',
        targetDirectoryId: granted.rootEntryId, name: '..\\outside\\injected' })
      const created = await files({ type: 'mkdir', workspaceId: granted.workspaceId, operationId: 'unc-valid-directory',
        targetDirectoryId: granted.rootEntryId, name: 'legitimate' })
      const text = await files({ type: 'create-text', workspaceId: granted.workspaceId, operationId: 'unc-valid-file',
        targetDirectoryId: granted.rootEntryId, name: 'created.txt' })
      return { granted, listed, outsideRoot, outsideEntry, injectedName, created, text }
    }, { authorized: uncWorkspace, unauthorized: uncOutside })
    expect(observed.granted.resolvedPath).toMatch(/^\\\\localhost\\D\$/i)
    expect(observed.listed.entries).toContainEqual({ status: 'blocked', name: 'escape', reason: 'outside-workspace' })
    expect(observed.outsideRoot.accepted).toBe(false)
    expect(observed.outsideEntry.accepted).toBe(false)
    expect(observed.injectedName).toMatchObject({ status: 'failed', items: [{ status: 'failed', error: { code: 'invalid-entry-name' } }] })
    expect(observed.created.status).toBe('success')
    expect(observed.text.status).toBe('success')
    expect(existsSync(join(uncWorkspace, 'legitimate'))).toBe(true)
    expect(readFileSync(join(uncWorkspace, 'created.txt'), 'utf8')).toBe('')
    expect(readFileSync(secret, 'utf8')).toBe('outside')
    expect(existsSync(join(outside, 'injected'))).toBe(false)

    const forged = await app.evaluate(async ({ BrowserWindow }, input) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      try {
        await window.loadURL('about:blank')
        return await window.webContents.executeJavaScript(
          `require('electron').ipcRenderer.invoke(${JSON.stringify(input.channel)}, ${JSON.stringify(input.request)})`,
        )
      } finally { window.destroy() }
    }, { channel: IPC_CHANNELS.workspaceFiles, request: { type: 'mkdir', workspaceId: observed.granted.workspaceId,
      operationId: 'unc-forged-directory', targetDirectoryId: observed.granted.rootEntryId, name: 'forged' } })
    expect(forged).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_IPC_SOURCE' } })
    expect(existsSync(join(workspace, 'forged'))).toBe(false)
    expect(readFileSync(keep, 'utf8')).toBe('keep')
    expect(readFileSync(secret, 'utf8')).toBe('outside')

    const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    const buildFiles = [
      'dist-electron/main/index.js',
      'dist-electron/main/ipc.js',
      'dist-electron/main/workbench/WorkspaceFiles.js',
      'dist-electron/main/workbench/workspaceFilesDesktopService.js',
    ]
    const buildIdentity = Object.fromEntries(buildFiles.map(file => [
      file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex'),
    ]))
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(evidenceFile, JSON.stringify({
      caseId: 'S09-T05-UNC-WINDOWS-IPC',
      result: 'passed',
      capturedAt: new Date().toISOString(),
      testLayer: 'Playwright Electron real window and raw IPC',
      platform: process.platform,
      build: { packageVersion: packageInfo.version, sha256ByRelativePath: buildIdentity },
      authorizedRoot: {
        share: '\\\\localhost\\D$',
        temporaryWorkspace: true,
        resolvedPathStayedOnShare: /^\\\\localhost\\D\$/i.test(observed.granted.resolvedPath),
      },
      rejections: {
        junction: 'outside-workspace',
        unauthorizedRoot: { accepted: observed.outsideRoot.accepted, errorName: observed.outsideRoot.name },
        forgedEntry: { accepted: observed.outsideEntry.accepted, errorName: observed.outsideEntry.name },
        injectedName: observed.injectedName.items[0]?.error?.code,
        forgedSender: forged.error?.code,
      },
      legitimateReadback: {
        mkdirStatus: observed.created.status,
        createTextStatus: observed.text.status,
        directoryOnUncExists: existsSync(join(uncWorkspace, 'legitimate')),
        createdTextOnUncIsEmpty: readFileSync(join(uncWorkspace, 'created.txt'), 'utf8') === '',
      },
      outsideWrites: {
        injectedAbsent: !existsSync(join(outside, 'injected')),
        forgedAbsent: !existsSync(join(workspace, 'forged')),
        outsideSecretUnchanged: readFileSync(secret, 'utf8') === 'outside',
        authorizedKeepUnchanged: readFileSync(keep, 'utf8') === 'keep',
      },
    }, null, 2), 'utf8')
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    if (existsSync(junction)) rmSync(junction, { force: true })
    if (!resolve(directory).startsWith(resolve(base) + sep)) throw new Error('Unsafe S09 UNC fixture cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})
