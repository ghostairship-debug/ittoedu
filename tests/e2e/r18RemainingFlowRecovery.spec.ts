import { plainDocumentText } from '../../src/shared/document/content'
import { requireProjectWorkspace } from './r18NativeAuthoringFixture'
import { copyFileSync, readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeNativeEditor, nativeRecords, readSaved, type NativeRun } from './r18NativeAuthoringFixture'
import { REMAINING_IDS, REMAINING_PROMPTS, SECOND_PARAGRAPH, flowParagraph, flowSurface } from './r18NativeAuthoringRemainingFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')
const sourceRoot = join(productRoot, 'output/r18-native-authoring-remaining/opencode-once-2026-09-08T14-17-22-173Z')
const sourceProfile = join(sourceRoot, 'profile'), sourceProjectPath = join(sourceRoot, 'remaining.h5lesson')
// Avoid Node 24 Windows recursive cpSync native crash; preserve the entire profile.
function copyProfile(source: string, destination: string) {
  mkdirSync(destination)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isDirectory()) copyProfile(from, to)
    else if (entry.isFile()) copyFileSync(from, to)
    else throw new Error('Unsupported profile entry: ' + from)
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

test('recover and save the actual partial Flow commit while retaining the original failed native workspace', async () => {
  test.setTimeout(150_000)
  const runRoot = join(sourceRoot, 'attempts', `zero-model-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const profilePath = join(runRoot, 'execution-profile'), projectPath = join(runRoot, 'recovered-Flow.h5lesson')
  const mark = (stage: string) => writeFileSync(join(runRoot, 'progress.txt'), stage + '\n', { flag: 'a' })
  mark('read original')
  const original = readSaved(sourceProjectPath), recoveryPath = join(sourceProfile, 'project-data/recovery.h5lesson')
  mark('read recovery')
  const recovery = readSaved(recoveryPath)
  mark('read native records')
  const sourceRecords = nativeRecords({ userData: sourceProfile } as NativeRun)
  mark('assert preconditions')
  const failed = sourceRecords.find(record => record.tasks.at(-1)?.goal === REMAINING_PROMPTS.T09Flow)
  expect(original.project.revision).toBe(5); expect(recovery.project.revision).toBe(6)
  expect(failed?.tasks.at(-1)?.status).toBe('partial')
  expect(failed?.hostResults.flatMap(result => result.receipts).filter(receipt => receipt.status === 'committed'))
    .toMatchObject([{ beforeRevision: 5, afterRevision: 6 }])
  expect(recovery.project.id).toBe(original.project.id)
  const paragraph = flowParagraph(recovery.project, REMAINING_IDS.paragraphTwo)
  expect(plainDocumentText(paragraph.content).length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
  expect(plainDocumentText(paragraph.content)).toMatch(/周期/)
  expect(flowParagraph(recovery.project, REMAINING_IDS.paragraphOne)).toEqual(flowParagraph(original.project, REMAINING_IDS.paragraphOne))
  const execution = { runRoot, profilePath, projectPath }
  const source = { runRoot: sourceRoot, profilePath: sourceProfile, projectPath: sourceProjectPath, recoveryPath,
    recordId: failed!.id, externalSessionId: failed!.externalSessionId }
  mark('copy profile')
  copyProfile(sourceProfile, profilePath)
  mark('profile copied')
  let server: ViteDevServer | undefined, run: NativeRun | undefined
  try {
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing isolated renderer address')
    const app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${profilePath}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow(), pageErrors: string[] = []
    run = { app, page, runRoot, workspaceRoot: sourceRoot, projectPath, userData: profilePath, pageErrors, consoleErrors: [] }
    page.on('pageerror', error => pageErrors.push(error.message))
    await expectBackgroundWindowsIsolated(app, true)
    const dialog = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect(dialog).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: join(runRoot, '01-recovery-offer.png') })
    await dialog.getByRole('button', { name: '恢复课件', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await current(page)).project?.revision, { timeout: 15000 }).toBe(6)
    expect(await current(page)).toEqual({ project: recovery.project, projectPath: null })
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, projectPath)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => existsSync(projectPath), { timeout: 15000 }).toBe(true)
    await expect.poll(async () => (await current(page)).projectPath).toBe(projectPath)
    expect(readSaved(projectPath)).toEqual(recovery)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect.poll(async () => (await current(page)).projectPath).toBe(projectPath)
    expect((await current(page)).project).toEqual(recovery.project)
    const target = flowSurface(recovery.project)
    await page.evaluate(async surfaceId => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
      state.activateCourseLocation(project.locations.find((location: any) => location.surfaceId === surfaceId).id)
    }, target.id)
    await expect(page.getByTestId(`flow-block-${REMAINING_IDS.paragraphTwo}`)).toContainText(plainDocumentText(paragraph.content))
    await page.screenshot({ path: join(runRoot, '02-recovered-flow.png') })
    const boundary = await page.evaluate(async ({ projectId, projectPath }) => {
      const workspace = await window.desktopAPI.localAgent({ operation: 'workspace', projectId, projectPath })
      const records = await window.desktopAPI.localAgent({ operation: 'list', projectId, projectPath })
      return { workspace: workspace.workspace, records: records.records ?? [] }
    }, { projectId: recovery.project.id, projectPath })
    expect(boundary.records).toEqual([])
    if (!boundary.workspace || !failed) throw new Error('Missing project workspace recovery evidence')
    expect(requireProjectWorkspace(boundary.workspace).normalizedPath).not.toBe(requireProjectWorkspace(failed.workspace).normalizedPath)
    expect(nativeRecords(run)).toEqual(sourceRecords)
    expect(pageErrors).toEqual([])
    writeFileSync(join(runRoot, 'recovery-result.json'), JSON.stringify({ version: 1, kind: 'remaining-Flow-recovery',
      status: 'recovered-saved-reopened-zero-model', source, execution, modelCalls: 0,
      sourceRevision: 5, restoredRevision: 6, paragraph: plainDocumentText(paragraph.content),
      sourceNativeStatus: 'partial', originalNativeHistoryPreserved: true, workspaceBoundary: boundary,
      nativeIdentityContinuity: 'not-claimed-across-save-as', modelCandidateReplayed: false, fixtureRestored: false,
      futureCoverage: ['T09 Flow feedback after repair', 'T09 Spatial', 'T10', 'T11', 'T12', '050'], ownerAcceptance: false,
    }, null, 2))
  } finally {
    if (run) await closeNativeEditor(run)
    await server?.close()
    expect(readSaved(sourceProjectPath)).toEqual(original)
    expect(readSaved(recoveryPath)).toEqual(recovery)
    expect(nativeRecords({ userData: sourceProfile } as NativeRun)).toEqual(sourceRecords)
  }
})


