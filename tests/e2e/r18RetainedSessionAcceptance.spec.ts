import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { localAgentMessages } from '../../src/shared/localAgentText'
import { localAgentRecordV2Schema } from '../../src/shared/localAgentTaskContract'
import { readSaved, nativeRecords, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '../..')

async function enterStandaloneEditorFromLanding(page: Page): Promise<void> {
  const landing = page.locator('.lesson-workspace-landing')
  const editor = page.getByTestId('canvas-stage')
  await Promise.race([
    landing.waitFor({ state: 'visible', timeout: 15_000 }),
    editor.waitFor({ state: 'visible', timeout: 15_000 }),
  ])
  if (!await landing.isVisible()) return
  const more = page.locator('.lesson-workspace-more > summary')
  if (!await more.isVisible()) return
  await more.click()
  const create = page.getByRole('button', { name: '新建独立课件', exact: true })
  if (await create.isVisible()) await create.click()
}
const sourceRoot = resolve(process.env.COURSEWARE_R18_RETAINED_SOURCE_ROOT
  ?? 'C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path')
const retained = [
  { adapter: 'claude', directory: 'claude-text-preview-2026-09-10T15-16-47-848Z',
    projectId: 'project_IHN3NoE7UcjwjchRAPCzf', sessionId: '60e9e9d7-852a-4395-a280-9c73181b5c5c',
    externalSessionId: '3d5c9495-dcd4-497c-ba38-56131f777b7f' },
  { adapter: 'codex', directory: 'codex-layout-auto-2026-09-10T12-56-40-701Z',
    projectId: 'project_l_0_vzT5JAIYW9btHefD5', sessionId: 'c793e9b2-892f-41c2-bb1c-cd5566857e64',
    externalSessionId: '01a08b64-ef16-7f42-826d-5e7fb349a21f' },
  { adapter: 'opencode', directory: 'opencode-interaction-auto-2026-09-10T13-21-41-927Z',
    projectId: 'project_CeG5P2Qvuwe5RYyg7aGby', sessionId: 'f91e5c4f-bd16-490e-b145-d9081c40f0c2',
    externalSessionId: 'ses_f74841854ffeR5ZFaEURI7DsZw' },
] as const

function contained(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../') && !isAbsolute(rel)
}

function profileFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return profileFiles(path)
    if (!entry.isFile()) throw new Error(`Unsupported profile entry: ${path}`)
    return [path]
  }).sort()
}

function profileMetadata(root: string) {
  return profileFiles(root).map(path => {
    const stat = statSync(path)
    return { path: relative(root, path), size: stat.size, mtimeMs: stat.mtimeMs }
  })
}

// Explicit recursion avoids the known Windows Node recursive-cp failure. Only
// the destination profile is ever opened by Electron; no credential is printed.
function copyProfile(source: string, destination: string): void {
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
    const { useEditorStore, selectActiveCourseProjectDocument, selectCanUndoActiveSurface,
      selectCanRedoActiveSurface } = await load('/src/renderer/store/editorStore.ts')
    const state = useEditorStore.getState()
    return { project: selectActiveCourseProjectDocument(state), projectPath: state.projectPath,
      canUndo: selectCanUndoActiveSurface(state), canRedo: selectCanRedoActiveSurface(state) }
  })
}

async function closeReadOnly(app: ElectronApplication): Promise<void> {
  // Destroy without Save, recovery materialization, Stop, or another UI command.
  await app.evaluate(({ app: native, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
    setTimeout(() => native.quit(), 0)
  }).catch(() => {})
  await app.close().catch(() => {})
}

test('R18 retained three-CLI sessions restore read-only without replay or document changes', async ({}, info) => {
  test.skip(process.env.COURSEWARE_R18_RETAINED_SESSION_GATE !== 'read-only',
    'Explicit retained-profile gate is closed; a skipped case is not recovery evidence')
  test.setTimeout(240_000)
  expect(info.retry, 'Do not hide a restoration failure behind retries').toBe(0)
  const trace = info.project.use.trace
  expect(typeof trace === 'object' ? trace.mode : trace, 'Retain targeted screenshots/JSON only').toBe('off')
  for (const artifact of ['dist-electron/main/index.js', 'dist-player/player.iife.js']) {
    expect(existsSync(join(productRoot, artifact)), `Build current candidate first: ${artifact}`).toBe(true)
  }
  const outputRoot = resolve(process.env.COURSEWARE_R18_RETAINED_OUTPUT_ROOT
    ?? join(productRoot, 'output/r18-final-acceptance-20260910'))
  const runRoot = join(outputRoot, `retained-sessions-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  expect(contained(sourceRoot, runRoot), 'Evidence must be outside original run/profile trees').toBe(false)
  mkdirSync(runRoot, { recursive: true })
  const results: Record<string, unknown>[] = []
  const failures: string[] = []
  let server: ViteDevServer | undefined
  const persist = () => writeFileSync(join(runRoot, 'result.json'), JSON.stringify({
    productRoot, sourceRoot, runRoot, rendererMode: 'current-source-isolated-vite',
    mainMode: 'current-dist-electron', results,
    modelBoundary: 'No Send, native start/resume/generate/continue/input, or candidate apply is requested; normal capability discovery may probe CLI configuration. No provider request counter is exposed.',
    scope: 'Retained application history, UI messages, task terminal state, unchanged in-memory project/Undo and original lesson. Does not claim native transport reconnection, physical input, or Owner S3 acceptance.',
    ownerAcceptance: false,
  }, null, 2))
  try {
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
        watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('No isolated renderer address')
    for (const fixture of retained) {
      const originalRun = join(sourceRoot, fixture.directory), sourceProfile = join(originalRun, 'profile')
      const projectPath = join(originalRun, 'lesson.h5lesson'), caseRoot = join(runRoot, fixture.adapter)
      const userData = join(caseRoot, 'execution-profile')
      const baselineBytes = readFileSync(projectPath), baseline = readSaved(projectPath)
      const profileBefore = profileMetadata(sourceProfile)
      const recordsBefore = nativeRecords({ userData: sourceProfile } as NativeRun)
      const historical = localAgentRecordV2Schema.parse(JSON.parse(readFileSync(join(originalRun, 'reopened.native.json'), 'utf8')).records[0])
      const originalRecordFiles = profileFiles(join(sourceProfile, 'local-agent/v2'))
        .filter(path => /[a-f0-9-]{36}(?:\.display)?\.json$/i.test(path))
        .map(path => ({ path, bytes: readFileSync(path) }))
      const result: Record<string, unknown> = { ...fixture, projectPath, sourceProfile, userData, status: 'running' }
      results.push(result); persist()
      let app: ElectronApplication | undefined, page: Page | undefined
      try {
        expect(baseline.project.id).toBe(fixture.projectId)
        expect(historical).toMatchObject({ id: fixture.sessionId, adapter: fixture.adapter,
          externalSessionId: fixture.externalSessionId,
          workspace: { projectId: fixture.projectId, normalizedPath: projectPath.replace(/\\/g, '/').toLowerCase() } })
        expect(recordsBefore.find(record => record.id === fixture.sessionId)).toEqual(historical)
        expect(historical.tasks.at(-1)?.status).toBe('completed')
        mkdirSync(caseRoot)
        copyProfile(sourceProfile, userData)
        app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${userData}`],
          env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, [BACKGROUND_E2E_ENV]: '1' } })
        page = await app.firstWindow()
        await enterStandaloneEditorFromLanding(page)
        const pageErrors: string[] = []
        page.on('pageerror', error => pageErrors.push(error.message))
        expect(resolve(await app.evaluate(({ app: native }) => native.getPath('userData'))).toLowerCase()).toBe(userData.toLowerCase())
        await expectBackgroundWindowsIsolated(app, true)
        await page.locator('[data-testid="canvas-stage"]').waitFor()
        const recovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
        // Dismiss only an offered recovery in the copied profile, never materialize it.
        if (await recovery.isVisible()) await recovery.getByRole('button', { name: '丢弃副本', exact: true }).click()
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
        }, projectPath)
        await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
        await expect.poll(async () => (await current(page!)).project?.id).toBe(fixture.projectId)
        const opened = await current(page)
        expect(opened).toEqual({ project: baseline.project, projectPath, canUndo: false, canRedo: false })
        await page.screenshot({ path: join(caseRoot, 'opened-course.png'), animations: 'allow' })
        const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
        if (!await chat.isVisible()) await page.getByRole('button', { name: '创作助手', exact: true }).click()
        const sessions = chat.getByLabel('会话', { exact: true })
        await expect(sessions.locator(`option[value="${fixture.sessionId}"]`)).toHaveCount(1)
        await sessions.selectOption(fixture.sessionId)
        await expect(chat.getByLabel('CLI', { exact: true })).toHaveValue(fixture.adapter)
        await expect(sessions.locator('option:checked')).toContainText('已完成')
        const goal = historical.tasks.at(-1)!.goal
        await expect(chat.getByRole('region', { name: '历史任务要求' }).getByText(goal, { exact: true })).toBeVisible()
        const summary = historical.hostResults.at(-1)?.summary
        expect(summary, 'A completed historical edit must retain its actual host summary').toBeTruthy()
        await expect(chat.getByRole('region', { name: '实际应用结果' }).getByText(summary!, { exact: true })).toBeVisible()
        // Wait until history pagination completes, including the >200-event records.
        const projected = await page.evaluate(async owner => {
          const events = []; let after = 0
          for (;;) {
            const response = await window.desktopAPI.localAgent({ operation: 'read', ...owner, after })
            const record = response.records?.[0]
            if (!record) throw new Error('Selected retained record missing from actual IPC read')
            const next = record.events.filter(event => event.sequence > after)
            events.push(...next); after = events.at(-1)?.sequence ?? after
            if (record.events.length < 200) return { ...record, events }
            if (!next.length) throw new Error('Historical pagination did not advance')
          }
        }, { projectId: fixture.projectId, projectPath, sessionId: fixture.sessionId })
        expect(projected).toMatchObject({ id: fixture.sessionId, adapter: fixture.adapter,
          externalSessionId: fixture.externalSessionId, status: 'completed', task: { status: 'completed' } })
        await expect(chat.getByText(/诊断详情|原生事件/)).toHaveCount(0)
        const messages = localAgentMessages(projected.events)
        await expect(chat.locator('.chat-transcript [data-message-id]')).toHaveCount(messages.length)
        expect(await chat.locator('.chat-transcript [data-message-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-message-id')))).toEqual(messages.map(message => message.id))
        await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeDisabled()
        await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
        await expect(chat.getByRole('region', { name: '候选变更预览' })).toHaveCount(0)
        await expect(chat.getByRole('button', { name: '应用候选', exact: true })).toHaveCount(0)
        expect(await current(page)).toEqual(opened)
        expect(nativeRecords({ userData } as NativeRun)).toEqual(recordsBefore)
        await page.screenshot({ path: join(caseRoot, 'restored-session.png'), animations: 'allow' })
        result.status = 'passed-read-only-restoration'
        result.terminal = projected.task
        result.visibleHistory = { goal, summary, eventCount: projected.events.length, text: await chat.locator('.chat-scroll').innerText() }
        result.historicalConfiguration = historical.events.filter(event => event.kind === 'configuration').at(-1)
        result.currentConfigurationUI = { model: await chat.getByLabel('模型', { exact: true }).inputValue(),
          effort: await chat.getByLabel('强度', { exact: true }).inputValue() }
        result.documentRevision = baseline.project.revision
        result.zeroNewTasksEventsOrHostResults = true
        expect(pageErrors).toEqual([])
      } catch (error) {
        result.status = 'failed'; result.failure = String(error); failures.push(`${fixture.adapter}: ${String(error)}`)
        await page?.screenshot({ path: join(caseRoot, 'failure.png') }).catch(() => {})
      } finally {
        if (app) await closeReadOnly(app)
        try {
          expect(readFileSync(projectPath).equals(baselineBytes), 'Opening must never write the original lesson').toBe(true)
          expect(readSaved(projectPath)).toEqual(baseline)
          expect(profileMetadata(sourceProfile), 'Original profile file set, sizes and write times must stay unchanged').toEqual(profileBefore)
          expect(originalRecordFiles.every(file => readFileSync(file.path).equals(file.bytes)), 'Original record/display bytes must stay unchanged').toBe(true)
          if (existsSync(join(userData, 'local-agent/v2'))) {
            expect(nativeRecords({ userData } as NativeRun), 'Closing history review must not create or advance a native task').toEqual(recordsBefore)
          }
          result.originalLessonAndProfilePreserved = true
        } catch (error) {
          result.status = 'failed'; result.preservationFailure = String(error); failures.push(`${fixture.adapter} preservation: ${String(error)}`)
        }
        persist()
      }
    }
  } finally { await server?.close(); persist() }
  expect(failures, `Retained screenshots, profile copies and details: ${runRoot}`).toEqual([])
})
