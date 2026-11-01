import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Recovery for this consumer only. No model request, direct profile-file edit, or retry of creation.
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
export const errorSummary = error => ({ name: error?.name ?? 'Error', code: error?.code,
  message: String(error?.message ?? error).slice(0, 1000) })

export async function atomicJson(out, name, value) {
  const file = path.join(out, name), temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const handle = await fs.open(temp, 'wx')
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync() }
  finally { await handle.close() }
  try { await fs.rename(temp, file) } catch (error) { await fs.rm(temp, { force: true }); throw error }
}

export async function bounded(label, operation, timeoutMs = 8000) {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} did not settle within ${timeoutMs} ms; do not replay an uncertain mutation.`),
        { code: 'cleanup_timeout' })), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

export async function cleanupStage(report, persist, key, operation) {
  report.cleanup ??= {}; report.cleanup.steps ??= {}
  const step = report.cleanup.steps[key] = { status: 'running', startedAt: new Date().toISOString() }
  report.cleanup.currentStage = key
  await persist()
  try { step.result = await operation(); step.status = 'completed'; return step.result }
  catch (error) { step.status = 'failed'; step.error = errorSummary(error); return undefined }
  finally { step.finishedAt = new Date().toISOString(); await persist() }
}

export async function observeCleanup(page, report, persist, stage) {
  const observation = { stage, at: new Date().toISOString() }
  try {
    observation.ui = await bounded('Read cleanup UI without changing drafts or dismissing dialogs', () => page.evaluate(() => {
      const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
      const label = node => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 1200)
      return {
        workspace: document.querySelector('[aria-label="切换工作空间"]')?.getAttribute('title') ?? null,
        dialogs: [...new Set(document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]'))].filter(visible).slice(0, 12)
          .map(node => ({ label: label(node), buttons: [...node.querySelectorAll('button')].filter(visible).map(label) })),
        recoveryControls: [...document.querySelectorAll('button')].filter(visible).filter(node => /恢复稿|未保存/.test(label(node))).slice(0, 20).map(label),
        tabs: [...document.querySelectorAll('[role="tab"]')].filter(visible).slice(0, 100).map(node => ({
          label: label(node), title: node.getAttribute('title'), selected: node.getAttribute('aria-selected'),
          dirtyAttribute: node.getAttribute('data-dirty'),
        })),
        dirtyEvidenceScope: 'Visible UI only; absence of an indicator does not prove all document owners are clean.',
      }
    }), 4000)
  } catch (error) { observation.error = errorSummary(error) }
  try {
    observation.documents = await bounded('Read public document dirty facts without changing content', () => page.evaluate(async () => {
      if (!window.desktopAPI?.documents?.list) return null
      const documents = await window.desktopAPI.documents.list()
      return documents.map(entry => ({ documentId: entry.documentId, revision: entry.revision, dirty: entry.dirty,
        binding: { kind: entry.binding.kind, ...(entry.binding.kind === 'file' ? { path: entry.binding.path } : {}) } }))
    }), 4000)
  } catch (error) { observation.documentsError = errorSummary(error) }
  report.cleanup.observations ??= []; report.cleanup.observations.push(observation)
  await persist()
}

export async function restoreRoles(page, restore, timeoutMs = 8000) {
  if (!restore) return { restored: true, state: 'no-role-change-record' }
  assert(restore.originalRoles && restore.temporaryRoles, 'The saved role restoration record is incomplete.')
  const read = () => bounded('Read current public model settings', () => page.evaluate(() => window.desktopAPI.executionSettings.read()), timeoutMs)
  const current = await read(), beforeRevision = current.profile.revision
  if (canonical(current.profile.roles) === canonical(restore.originalRoles)) return { restored: true, state: 'already-original', revision: beforeRevision }
  if (canonical(current.profile.roles) !== canonical(restore.temporaryRoles)) return { restored: false, state: 'concurrent-role-change-preserved', revision: beforeRevision }
  let saveError
  try {
    await bounded('Restore original roles by current revision CAS', () => page.evaluate(input => window.desktopAPI.executionSettings.saveProfile(input),
      { expectedRevision: beforeRevision, roles: restore.originalRoles }), timeoutMs)
  } catch (error) { saveError = errorSummary(error) }
  // Read back after a failed/lost save receipt. Never issue that mutation again automatically.
  const after = await read()
  const restored = canonical(after.profile.roles) === canonical(restore.originalRoles)
  return { restored, state: restored ? saveError ? 'original-confirmed-after-uncertain-save' : 'restored'
    : canonical(after.profile.roles) === canonical(restore.temporaryRoles) ? 'restoration-not-confirmed' : 'concurrent-role-change-preserved',
  beforeRevision, revision: after.profile.revision, ...(saveError ? { saveError } : {}) }
}

const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && (process.platform === 'win32' ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right))

export async function chooseWorkspaceBounded(app, page, directory, timeoutMs = 10000) {
  const key = `__moonDialog_${randomUUID().replaceAll('-', '')}`
  await bounded('Install owned workspace dialog response', () => app.evaluate(({ dialog }, input) => {
    globalThis[input.key] = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.directory] })
  }, { key, directory }), timeoutMs)
  try {
    await page.getByLabel('切换工作空间', { exact: true }).click({ timeout: timeoutMs })
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click({ timeout: timeoutMs })
    await page.waitForFunction(directory => document.querySelector('[aria-label="切换工作空间"]')?.getAttribute('title') === directory,
      directory, { timeout: timeoutMs })
  } finally {
    await bounded('Restore owned workspace dialog handler', () => app.evaluate(({ dialog }, key) => {
      if (globalThis[key]) { dialog.showOpenDialog = globalThis[key]; delete globalThis[key] }
    }, key), 3000)
  }
}

export async function restoreWorkspace(app, page, recovery, timeoutMs = 8000) {
  const original = recovery?.originalWorkspace
  if (!original || !path.isAbsolute(original)) return { restored: false, state: 'original-workspace-unavailable' }
  const current = await page.getByLabel('切换工作空间', { exact: true }).getAttribute('title', { timeout: timeoutMs })
  if (samePath(current, original)) return { restored: true, state: 'already-original' }
  if (!samePath(current, recovery.workspace)) return { restored: false, state: 'concurrent-workspace-change-preserved', current }
  await chooseWorkspaceBounded(app, page, original, timeoutMs)
  const actual = await page.getByLabel('切换工作空间', { exact: true }).getAttribute('title', { timeout: timeoutMs })
  return { restored: samePath(actual, original), state: samePath(actual, original) ? 'restored' : 'restoration-not-confirmed' }
}

export async function closeOwnedApp(app, checkpoint = async () => {}, timeoutMs = 8000) {
  if (!app) return { closed: true, mode: 'not-started' }
  const child = app.process(), pid = child.pid
  const exited = () => child.exitCode !== null || child.signalCode !== null
  const waitExit = ms => exited() ? Promise.resolve() : new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('exit', done); resolve() }
    const timer = setTimeout(done, ms); child.once('exit', done)
  })
  if (exited()) return { closed: true, mode: 'already-exited', pid }
  await checkpoint('graceful-app-close')
  let gracefulError
  try { await bounded('Close owned Electron app', () => app.close(), timeoutMs) }
  catch (error) { gracefulError = errorSummary(error) }
  if (exited()) return { closed: true, mode: 'graceful', pid, ...(gracefulError ? { gracefulError } : {}) }
  await checkpoint('owned-app-exit')
  await bounded('Exit owned Electron app', () => app.evaluate(({ app }) => app.exit(0)), 2000).catch(() => {})
  await waitExit(500)
  if (exited()) return { closed: true, mode: 'app-exit', pid, gracefulError }
  await checkpoint('owned-process-tree-termination')
  assert(Number.isInteger(pid) && pid > 0, 'The owned app PID is unavailable; no unrelated process may be terminated.')
  let terminationError
  try {
    if (process.platform === 'win32') await bounded('Terminate only the owned Electron process tree', () => new Promise((resolve, reject) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 4000, windowsHide: true }, error => error ? reject(error) : resolve())
    }), 5000)
    else child.kill('SIGKILL')
  } catch (error) { terminationError = errorSummary(error) }
  await waitExit(1000)
  return { closed: exited(), mode: 'forced-owned-tree', pid, gracefulError, ...(terminationError ? { terminationError } : {}) }
}

async function recoveryMain() {
  const root = process.cwd(), configPath = path.resolve(process.argv[2] ?? '')
  assert(process.argv[2], 'Pass the original consumer config path; this command never starts creation.')
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')), out = path.resolve(config.out)
  const resultName = process.argv[3] ?? 'cleanup-recovery.json'
  assert.equal(path.basename(resultName), resultName, 'Recovery result must be a new basename inside the original output directory.')
  assert.match(resultName, /^cleanup-recovery(?:-[A-Za-z0-9_-]+)?\.json$/, 'Use a separate cleanup-recovery JSON; never replace original consumer evidence.')
  const claim = await fs.open(path.join(out, resultName), 'wx')
  const report = { kind: 'one-shot-consumer-cleanup-recovery', status: 'starting', startedAt: new Date().toISOString(),
    originalConsumerResultUnchanged: true, modelRequestsSent: 0, cleanup: {}, configPath }
  await claim.writeFile(JSON.stringify(report, null, 2)); await claim.sync(); await claim.close()
  const persist = () => atomicJson(out, resultName, report)
  let app, page
  try {
    const recovery = JSON.parse(await fs.readFile(path.join(out, 'recovery.json'), 'utf8'))
    const restore = await fs.readFile(path.join(out, 'profile-restore.json'), 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT' && !recovery.changedProfile && recovery.profileChange !== 'pending') return null
      throw error
    })
    assert(config.originalProfile && path.isAbsolute(config.originalProfile), 'Original absolute app profile path is required.')
    report.status = 'launching-owned-recovery-app'; await persist()
    const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    const { _electron: electron } = await import('@playwright/test')
    app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), cwd: root,
      args: ['.', `--user-data-dir=${config.originalProfile}`], env, timeout: 45000 })
    report.ownedAppPid = app.process().pid; await persist()
    page = await bounded('Open recovery app window', () => app.firstWindow(), 20000)
    await page.waitForFunction(() => window.desktopAPI?.executionSettings, undefined, { timeout: 20000 })
    await page.getByLabel('切换工作空间', { exact: true }).waitFor({ state: 'visible', timeout: 20000 })
    await observeCleanup(page, report, persist, 'before-restoration')
    const profile = await cleanupStage(report, persist, 'profile', () => restoreRoles(page, restore))
    report.cleanup.profileRestored = profile?.restored === true; await persist()
    const space = await cleanupStage(report, persist, 'workspace', () => restoreWorkspace(app, page, recovery))
    report.cleanup.workspaceRestored = space?.restored === true; await persist()
    await observeCleanup(page, report, persist, 'after-restoration')
  } catch (error) { report.error = errorSummary(error); report.status = 'blocked'; await persist() }
  finally {
    if (page) await observeCleanup(page, report, persist, 'before-owned-app-close')
    const closed = await cleanupStage(report, persist, 'app', () => closeOwnedApp(app, async phase => {
      report.cleanup.appClosePhase = phase; await persist()
      if (page && phase !== 'graceful-app-close') await observeCleanup(page, report, persist, phase)
    }))
    report.cleanup.appClosed = closed?.closed === true
    report.status = report.cleanup.profileRestored && report.cleanup.workspaceRestored && report.cleanup.appClosed ? 'recovery-confirmed' : 'recovery-incomplete'
    report.finishedAt = new Date().toISOString(); await persist()
    console.log(JSON.stringify({ status: report.status, resultPath: path.join(out, resultName), modelRequestsSent: 0, cleanup: report.cleanup }))
    const code = report.status === 'recovery-confirmed' ? 0 : 1
    process.exitCode = code
    // A rejected Playwright close must not retain this evidence collector indefinitely.
    setTimeout(() => process.exit(code), 1500).unref()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await recoveryMain()
