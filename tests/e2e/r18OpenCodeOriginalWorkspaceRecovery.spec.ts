import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeNativeEditor, nativeRecords, readSaved, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '../..')
const sourceRoot = resolve(productRoot, '../courseware-r18-worktrees/20260908-development/flow/output/r18-native-authoring/opencode-3-2026-09-08T14-14-21-479Z')
const sourceProfile = join(sourceRoot, 'profile'), projectPath = join(sourceRoot, 'lesson.h5lesson')
const nativeId = 'ses_f7ea062c3ffexFCcEEF1LeOaZR'
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)])
}
function copyProfile(source: string, destination: string) {
  mkdirSync(destination)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isDirectory()) copyProfile(from, to)
    else if (entry.isFile()) copyFileSync(from, to)
    else throw new Error(`Unsupported profile entry: ${from}`)
  }
}
async function current(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
    const state = useEditorStore.getState()
    return { project: selectActiveCourseProjectDocument(state), projectPath: state.projectPath }
  })
}

test('restore actual OpenCode rev2 to its working path with copied native history and zero model calls', async ({}, info) => {
  test.skip(process.env.COURSEWARE_R18_ORIGINAL_WORKSPACE_RECOVERY !== 'opencode-3', 'Explicit working-file recovery gate is closed')
  test.setTimeout(150_000)
  const trace = info.project.use.trace
  expect(typeof trace === 'object' ? trace.mode : trace).toBe('off')
  expect(info.retry).toBe(0)
  const before = readSaved(projectPath), recoveryPath = join(sourceProfile, 'project-data/recovery.h5lesson')
  const recovered = readSaved(recoveryPath)
  expect(before.project.revision).toBe(1)
  expect(recovered.project.revision).toBe(2)
  expect(recovered.project.id).toBe(before.project.id)
  expect(before).toEqual(readSaved(join(sourceRoot, 'T02.h5lesson')))
  const sourceRecords = nativeRecords({ userData: sourceProfile } as NativeRun)
  expect([...new Set(sourceRecords.map(record => record.externalSessionId))]).toEqual([nativeId])
  const sourceRecordFiles = files(join(sourceProfile, 'local-agent/v2')).map(path => ({ path, bytes: readFileSync(path) }))
  const runRoot = join(sourceRoot, 'attempts', `same-workspace-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  // The working lesson is mutable. Preserve its exact pre-recovery artifact;
  // original stage archives, profile, recovery and native records stay untouched.
  const beforePath = join(runRoot, 'before-working-lesson.h5lesson')
  copyFileSync(projectPath, beforePath)
  const userData = join(runRoot, 'execution-profile')
  copyProfile(sourceProfile, userData)
  let server: ViteDevServer | undefined, run: NativeRun | undefined
  const manifest: Record<string, unknown> = { sourceRoot, projectPath, sourceProfile, recoveryPath, beforePath,
    executionProfilePath: userData, modelCalls: 0, status: 'running', originalStageArchivesRetained: true,
    allowedWrites: [runRoot, projectPath], externalSessionId: nativeId, ownerAcceptance: false }
  const persist = () => writeFileSync(join(runRoot, 'recovery-result.json'), JSON.stringify(manifest, null, 2))
  persist()
  try {
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('No isolated renderer address')
    const app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    run = { app, page, runRoot, workspaceRoot: runRoot, projectPath, userData, pageErrors: [], consoleErrors: [] }
    const pageErrors = run.pageErrors
    page.on('pageerror', error => pageErrors.push(error.message))
    await expectBackgroundWindowsIsolated(app, true)
    const dialog = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect(dialog).toBeVisible({ timeout: 20000 })
    await dialog.getByRole('button', { name: '恢复课件', exact: true }).click()
    await expect.poll(async () => (await current(page)).project?.revision).toBe(2)
    expect((await current(page)).projectPath).toBeNull()
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, projectPath)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await current(page)).projectPath).toBe(projectPath)
    await expect.poll(() => readSaved(projectPath).project.revision).toBe(2)
    expect(readSaved(projectPath)).toEqual(recovered)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect.poll(async () => (await current(page)).project?.revision).toBe(2)
    expect((await current(page)).project).toEqual(recovered.project)
    const boundary = await page.evaluate(async owner => ({
      workspace: (await window.desktopAPI.localAgent({ operation: 'workspace', ...owner })).workspace,
      records: (await window.desktopAPI.localAgent({ operation: 'list', ...owner })).records,
    }), { projectId: recovered.project.id, projectPath })
    expect(boundary.workspace).toEqual(sourceRecords[0]!.workspace)
    expect(boundary.records?.map(record => record.id).sort()).toEqual(sourceRecords.map(record => record.id).sort())
    expect([...new Set(boundary.records?.map(record => record.externalSessionId))]).toEqual([nativeId])
    expect(nativeRecords(run)).toEqual(sourceRecords)
    copyFileSync(projectPath, join(runRoot, 'recovered-current.h5lesson'))
    await page.screenshot({ path: join(runRoot, 'recovered-current.png') })
    expect(pageErrors).toEqual([])
    manifest.status = 'same-workspace-recovered-saved-reopened-zero-model'
    manifest.boundary = boundary
    manifest.nativeIdentityContinuity = 'same workspace and retained external-session reference; no provider turn attempted'
    manifest.savedPath = join(runRoot, 'recovered-current.h5lesson')
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = String(error)
    await run?.page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    await server?.close()
    expect(readSaved(beforePath)).toEqual(before)
    expect(readSaved(join(sourceRoot, 'T02.h5lesson'))).toEqual(before)
    expect(readSaved(recoveryPath)).toEqual(recovered)
    expect(sourceRecordFiles.every(file => readFileSync(file.path).equals(file.bytes))).toBe(true)
    manifest.originalHistoryPreserved = true; persist()
  }
})
