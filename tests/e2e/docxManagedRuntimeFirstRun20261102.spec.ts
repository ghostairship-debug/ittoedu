/** Isolated packaged App first-use acceptance; no runtime or download mocks. */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { chooseM20Workspace, closeM20, m20Evidence, m20Row } from './helpers/g20M20Harness'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const release = '26.2.4'

test('packaged App prepares Word runtime on first open and reuses it in an offline cold process', async ({}, info) => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'The managed runtime is prepared on Windows x64.')
  test.setTimeout(1_200_000)
  const exeArg = process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE?.trim()
  if (!exeArg) throw new Error('Set COURSEWARE_E2E_PACKAGED_EXECUTABLE to the isolated packaged executable.')
  const executablePath = path.resolve(exeArg)
  if (!existsSync(executablePath)) throw new Error('Packaged executable does not exist.')
  const systemRoot = process.env.SystemRoot
  if (!systemRoot) throw new Error('SystemRoot is required for a minimal child-process search path.')
  const base = path.resolve('output/goal-correction-20261102/word-first-run')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(path.join(base, 'ui-')), workspace = path.join(directory, 'workspace')
  const profile = path.join(directory, 'profile'), emptyProgramFiles = path.join(directory, 'empty-program-files')
  const runtime = path.join(profile, 'workbench-v2', 'word-layout', `libreoffice-${release}`)
  mkdirSync(workspace); mkdirSync(emptyProgramFiles)
  const fixture = { directory, workspace, profile }
  const name = '首次运行中文.docx', filename = path.join(workspace, name)
  writeFileSync(filename, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('首次打开：本地排版与中文预览。')] }] })))
  const before = hash(readFileSync(filename))
  // Windows executable lookup can search the executable directory, cwd, Windows
  // and System32 in addition to PATH. Refuse to claim isolation if any has soffice.
  for (const root of [directory, path.dirname(executablePath), systemRoot, path.join(systemRoot, 'System32'), path.join(systemRoot, 'System')]) {
    if (existsSync(path.join(root, 'soffice.com'))) throw new Error(`Cannot isolate system candidates: soffice.com exists in search directory ${root}`)
  }
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'
    && !['path', 'programfiles', 'programfiles(x86)', 'programw6432', 'electron_run_as_node'].includes(entry[0].toLowerCase())))
  Object.assign(env, { PATH: [path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter),
    ProgramFiles: emptyProgramFiles, 'ProgramFiles(x86)': emptyProgramFiles, ProgramW6432: emptyProgramFiles,
    VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0', COURSEWARE_COMPONENTS_DIR: path.join(directory, 'missing-packaged-components') })
  const evidence: Record<string, unknown> = { case: 'packaged Word first managed preparation', phase: 'launch', before,
    isolation: 'child-only empty ProgramFiles candidates and restricted search path; system installation untouched' }
  let running: { app: ElectronApplication; page: Awaited<ReturnType<ElectronApplication['firstWindow']>> } | undefined
  const waitForPreview = async (page: Page, preview: Locator, timeout: number) => {
    const outcome: { state: 'pending' | 'ready' | 'error'; message: string } = { state: 'pending', message: '' }
    await expect.poll(async () => {
      const alert = page.locator('.office-file-view > p[role="alert"]:visible').first()
      if (await alert.isVisible()) { outcome.message = (await alert.innerText()).trim(); return outcome.state = 'error' }
      return outcome.state = await preview.isVisible() ? 'ready' : 'pending'
    }, { timeout, message: 'Word preview must open or report an error' }).not.toBe('pending')
    if (outcome.state === 'error') { evidence.productError = outcome.message; throw new Error(`Word preview reported an error: ${outcome.message}`) }
  }
  const launch = async (offline: boolean) => {
    const app = await electron.launch({ executablePath, cwd: directory, args: [`--user-data-dir=${profile}`], env, timeout: 45_000 })
    try {
    const page = await app.firstWindow({ timeout: 45_000 })
    page.setDefaultTimeout(15_000)
    const identity = await app.evaluate(({ app, session, BrowserWindow }, input) => {
      const state = globalThis as unknown as { wordNetwork: { hosts: string[]; blocked: number } }
      state.wordNetwork = { hosts: [], blocked: 0 }
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        state.wordNetwork.hosts.push(new URL(details.url).hostname)
        if (input.offline) state.wordNetwork.blocked++
        callback({ cancel: input.offline })
      })
      if (input.offline) session.defaultSession.enableNetworkEmulation({ offline: true })
      BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 900)
      return { packaged: app.isPackaged, appPath: app.getAppPath(), execPath: process.execPath, userData: app.getPath('userData'), pid: process.pid,
        programFiles: process.env.ProgramFiles, programFilesX86: process.env['ProgramFiles(x86)'], programW6432: process.env.ProgramW6432,
        searchPath: process.env.PATH }
    }, { offline })
    expect(identity.packaged).toBe(true)
    expect(path.resolve(identity.execPath).toLowerCase()).toBe(executablePath.toLowerCase())
    expect(path.resolve(identity.appPath).toLowerCase()).toBe(path.join(path.dirname(executablePath), 'resources', 'app.asar').toLowerCase())
    expect(path.resolve(identity.userData).toLowerCase()).toBe(profile.toLowerCase())
    expect(identity.programFiles).toBe(emptyProgramFiles)
    expect(identity.programFilesX86).toBe(emptyProgramFiles)
    expect(identity.programW6432).toBe(emptyProgramFiles)
    expect(identity.searchPath).toBe(env.PATH)
    return { app, page, identity }
    } catch (error) { await closeM20(app); throw error }
  }
  try {
    expect(existsSync(profile)).toBe(false)
    const first = await launch(false); running = first
    evidence.initialPid = first.identity.pid
    expect(existsSync(runtime)).toBe(false)
    await chooseM20Workspace(first.app, first.page, workspace)
    evidence.phase = 'first-network-preparation'
    await m20Row(first.page, name).dblclick()
    const preview = first.page.locator('.docx-file-preview').filter({ has: first.page.locator('strong', { hasText: name }) })
    await waitForPreview(first.page, preview, 900_000)
    await expect(preview).toHaveAttribute('data-source-sha256', before)
    await expect(preview).toContainText('第 1 / 1 页')
    await expect(preview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
    const manifest = JSON.parse(readFileSync(path.join(runtime, 'guoling-word-runtime.json'), 'utf8'))
    expect(manifest.version).toBe(release)
    expect(manifest.sha256).toBe('4bde93374aef4409243505b20d16561a4628ac7591457dd01fc6e1ccf571ba65')
    const executable = [runtime, path.join(runtime, 'LibreOfficePortable'), path.join(runtime, '$INSTDIR')]
      .map(root => path.join(root, 'App', 'libreoffice', 'program', 'soffice.com')).find(existsSync)
    expect(executable).toBeTruthy()
    const firstNetwork = await first.app.evaluate(() => (globalThis as unknown as { wordNetwork: { hosts: string[] } }).wordNetwork)
    expect(firstNetwork.hosts).toContain('download.documentfoundation.org')
    expect(hash(readFileSync(filename))).toBe(before)
    evidence.runtime = { directory: runtime, executable, manifest, executableSha256: hash(readFileSync(executable!)) }
    evidence.firstNetwork = firstNetwork
    await first.page.screenshot({ path: path.join(directory, '01-first-preview.png'), fullPage: true })
    await closeM20(first.app); running = undefined

    evidence.phase = 'offline-cold-reopen'
    const cold = await launch(true); running = cold
    expect(cold.identity.pid).not.toBe(first.identity.pid)
    await chooseM20Workspace(cold.app, cold.page, workspace)
    await m20Row(cold.page, name).dblclick()
    const coldPreview = cold.page.locator('.docx-file-preview').filter({ has: cold.page.locator('strong', { hasText: name }) })
    await waitForPreview(cold.page, coldPreview, 120_000)
    await expect(coldPreview).toHaveAttribute('data-source-sha256', before)
    await expect(coldPreview).toContainText('第 1 / 1 页')
    await expect(coldPreview.locator('.docx-file-preview__paper')).toHaveAttribute('data-ready', 'true')
    expect(existsSync(runtime)).toBe(true)
    expect(hash(readFileSync(executable!))).toBe((evidence.runtime as { executableSha256: string }).executableSha256)
    expect(hash(readFileSync(filename))).toBe(before)
    const coldNetwork = await cold.app.evaluate(() => (globalThis as unknown as { wordNetwork: { hosts: string[]; blocked: number } }).wordNetwork)
    expect(coldNetwork.hosts).not.toContain('download.documentfoundation.org')
    evidence.coldPid = cold.identity.pid; evidence.coldNetwork = coldNetwork
    evidence.offlineBoundary = 'Electron default session blocked; native process system network is not disabled.'
    evidence.phase = 'complete'; evidence.status = 'first-network-prepare-and-cold-reuse-passed'
    await m20Evidence(info, fixture, cold.page, evidence)
  } catch (error) {
    evidence.finalHash = hash(readFileSync(filename))
    if (running) await m20Evidence(info, fixture, running.page, evidence, error)
    else writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ ...evidence, failure: String(error) }, null, 2))
    throw error
  } finally { if (running) await closeM20(running.app) }
})
