import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

// Experimental opt-in only. Running the ordinary E2E suite never requests a
// model or starts this experiment. PREFLIGHT enables the real UI/domain path
// without a model; only RUN=1 adds --run to the isolated controller process.
const runModels = process.env.GUOLING_PI_DOMAIN_RUN === '1'
const enabled = runModels || process.env.GUOLING_PI_DOMAIN_PREFLIGHT === '1'
const root = resolve(__dirname, '../..')
const requireFromRepo = createRequire(join(root, 'package.json'))
const fileName = 'pi-domain-native-edit.glx'
const targetId = 'pi-target-text', manualId = 'pi-manual-text', neighborId = 'pi-neighbor-text'
const originalTarget = '这是一段需要修改的课堂提示。'
const firstTarget = '请先观察画面，再分享你的发现。'
const finalTarget = '请先观察画面，再用一句话分享你的发现。'
const originalManual = '教师补充：课堂记录等待填写。'
const changedManual = '教师补充：保留我亲自填写的第七组观察。'
const neighborText = '邻近对象：这段文字与本次修改无关。'
const allowedToolNames = ['workbench.state', 'read', 'text.replace', 'file.save', 'tools.load', 'operation.read']
type Facts = Record<string, unknown>
type ControllerSummary = {
  state: string; run: boolean; error: unknown; cleanupError?: unknown; transportCloseError?: unknown
  modelSendAttempted: boolean; domainTerminationAcknowledged?: boolean
  actualProviderRequests: Array<{ phase: string; model: string; toolResultCount: number | null; tools: unknown[] }>
  phases: Array<{ label: string; successfulSaveCalls: number; nativeSessionId: string; nativeSessionFile: string
    diskCheckpoint: { sha256: string; changed: boolean }; calls: Array<{ tool: string; isError: boolean }> }>
  reopen?: { nativeSessionId: string; nativeSessionFile: string; restoredMessageCount: number; restoredToolResults: number }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const archiveAt = (path: string) => openCourseProjectV10Archive(new Uint8Array(readFileSync(path)))

function bounded<T>(pending: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    pending.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function fixture() {
  const project = createBlankCourseProjectV10('Pi 原生会话 · 人工修改保留')
  project.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  const rows = [
    { id: targetId, name: '本轮唯一修改目标', text: originalTarget, y: 100, color: '#143c63', background: '#edf5ff' },
    { id: manualId, name: '人工修改保留区', text: originalManual, y: 280, color: '#225039', background: '#eff8f0' },
    { id: neighborId, name: '不可变邻近对象', text: neighborText, y: 460, color: '#5a3c21', background: '#fff6e9' },
  ]
  for (const row of rows) {
    const data = createTextComponentData(row.text)
    data.appearance = { ...data.appearance, fontSize: 28, color: row.color, padding: 12,
      backgroundColor: row.background, backgroundOpacity: 1, cornerRadius: 12 }
    data.sizing = { mode: 'fixed', minHeight: 0, overflow: 'visible' }
    project.instances[row.id] = { id: row.id, definitionId: 'text', name: row.name,
      data: JSON.parse(JSON.stringify(data)),
      frame: { width: 1080, height: 100, transform: [1, 0, 0, 1, 90, row.y] } }
  }
  testContainerInstance(project, 0).childIds = rows.map(row => row.id)
  return { project, resources: { assets: {}, components: {} } }
}

function packageRoot(name: string, environmentName: string) {
  const configured = process.env[environmentName]
  let candidate: string
  if (configured) {
    if (!isAbsolute(configured)) throw new Error(`${environmentName} must be an absolute package directory`)
    candidate = configured
  } else {
    try { candidate = dirname(requireFromRepo.resolve(name)) }
    catch { throw new Error(`Cannot resolve installed ${name}; set ${environmentName} to its existing package directory. No installation was attempted.`) }
  }
  for (;;) {
    const file = join(candidate, 'package.json')
    if (existsSync(file)) {
      const info = JSON.parse(readFileSync(file, 'utf8'))
      if (info.name === name) return candidate
    }
    const parent = dirname(candidate)
    if (configured || parent === candidate) throw new Error(`${environmentName ?? name} does not identify ${name}`)
    candidate = parent
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local experiment port')
  return address.port
}

async function read(page: Page, documentId: string) {
  const snapshot = await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the production course document Session')
  return { ...snapshot, model: snapshot.model }
}

async function configureDomain(page: Page, enabled: boolean, port?: number) {
  return page.evaluate(async ({ enabled, port }) => {
    if (!window.desktopAPI.externalMcp) throw new Error('The production external MCP API is unavailable')
    return window.desktopAPI.externalMcp.configure({ enabled, ...(port === undefined ? {} : { port }), permission: 'workspace' })
  }, { enabled, port })
}

async function launch(profile: string, workspace: string) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '0' } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setContentSize(1600, 1000)
      window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { buttons: string[] }
        const response = options.buttons.indexOf('退出')
        if (response < 0) throw new Error(`Unexpected dialog: ${options.buttons.join(',')}`)
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: fileName, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toBeVisible()
    if (await frame.getAttribute('data-editor-mode') !== 'deep') {
      await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    }
    await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Opened document has no formal identity')
    return { app, page, documentId }
  } catch (error) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app.close().catch(() => undefined)
    throw error
  }
}

function visibleText(page: Page, text: string) {
  return page.locator('.course-editor-frame:visible').getByText(text, { exact: true }).first()
}

async function textPoint(page: Page, text: string) {
  const target = visibleText(page, text)
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  if (!box) throw new Error('The visible native text has no pointer target')
  return { box, x: box.x + Math.min(box.width / 2, 150), y: box.y + Math.min(box.height / 2, 18) }
}

async function manuallyEdit(page: Page, facts: Facts) {
  const point = await textPoint(page, originalManual)
  facts.manualEditPointer = point
  await page.mouse.dblclick(point.x, point.y)
  const editor = page.locator('[data-component-professional-editor] [contenteditable="true"]').first()
  await expect(editor).toBeVisible()
  await expect(editor).toContainText(originalManual)
  await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(changedManual)
  await page.keyboard.press('Control+Enter')
  await expect(editor).not.toBeVisible()
  await expect(visibleText(page, changedManual)).toBeVisible()
}

async function selectTarget(page: Page, facts: Facts) {
  const point = await textPoint(page, originalTarget)
  facts.selectionPointer = point
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('[data-component-professional-editor] [contenteditable="true"]').first()).not.toBeVisible()
  // The controller's workbench.state/read bootstrap obtains the real session's
  // handles from this UI selection. The test never fabricates a target handle.
}

function textOf(project: CourseProjectV10, id: string) {
  return textComponentDataSchema.parse(project.instances[id]!.data).content.inlines
    .map(inline => inline.type === 'text' ? inline.text : '').join('')
}

function expectOnlyTextChange(project: CourseProjectV10, baseline: CourseProjectV10, changedId: string, text: string) {
  expect(textOf(project, changedId)).toBe(text)
  expect(Object.keys(project.instances).sort()).toEqual(Object.keys(baseline.instances).sort())
  for (const [id, before] of Object.entries(baseline.instances)) {
    if (id !== changedId) expect(project.instances[id], `Unrelated object ${id} must retain all author fields`).toEqual(before)
    else {
      const data = textComponentDataSchema.parse(project.instances[id]!.data)
      const expected = { ...before, data: { ...textComponentDataSchema.parse(before.data), content: data.content } }
      expect(project.instances[id], 'Only the selected native text content may change').toEqual(expected)
    }
  }
  const { revision: _revision, instances: _instances, ...author } = project
  const { revision: _beforeRevision, instances: _beforeInstances, ...beforeAuthor } = baseline
  expect(author).toEqual(beforeAuthor)
}

async function expectCanvas(page: Page, target: string) {
  for (const text of [target, changedManual, neighborText]) await expect(visibleText(page, text)).toBeVisible()
}

async function waitSaved(page: Page, documentId: string) {
  await expect.poll(async () => {
    const snapshot = await read(page, documentId)
    return { dirty: snapshot.dirty, saving: snapshot.saving }
  }, { timeout: 15_000 }).toEqual({ dirty: false, saving: false })
  return read(page, documentId)
}

function diagnostic(text: string) {
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/("(?:apiKey|api_key|authorization|accessToken|access_token|secret|password)"\s*:\s*")[^"]*/gi, '$1[redacted]')
}

async function runController(settingsFile: string, run: boolean, directory: string,
  register: (child: ChildProcess | undefined) => void, revoke: () => Promise<unknown>) {
  // This runs in Playwright's Node worker, never app.evaluate/Electron's main
  // process. Therefore process.execPath is the normal Node executable.
  if (process.versions.electron) throw new Error('Launch this experimental spec with the normal Node Playwright runner')
  const label = run ? 'model' : 'preflight'
  const args = [join(root, 'scripts/experiments/pi-domain-controller.mjs'), '--settings', settingsFile, ...(run ? ['--run'] : [])]
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env }, windowsHide: true, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'] })
  register(child)
  let stdout = '', stderr = '', timedOut = false, spawnError: Error | undefined, revokeFailure: string | undefined
  let forceKill: ReturnType<typeof setTimeout> | undefined
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2_000_000) })
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2_000_000) })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('error', error => { spawnError = error })
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const timeout = setTimeout(() => {
    timedOut = true
    // Revoke this profile's host port before terminating our own controller.
    // A kill alone does not establish revocation of in-flight document work.
    void bounded(revoke(), 10_000, 'Host revocation did not acknowledge within 10 seconds')
      .catch(error => { revokeFailure = diagnostic(String(error)) })
      .finally(() => {
        child.kill('SIGTERM')
        forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000)
      })
  }, run ? 420_000 : 90_000)
  let status: Awaited<typeof exit>
  try { status = await exit } finally { clearTimeout(timeout); clearTimeout(forceKill); register(undefined) }
  writeFileSync(join(directory, `${label}-controller.stdout.log`), diagnostic(stdout))
  writeFileSync(join(directory, `${label}-controller.stderr.log`), diagnostic(stderr))
  if (spawnError) throw spawnError
  if (timedOut) throw new Error(`${label} controller exceeded its deadline; ${revokeFailure ?? 'host revocation acknowledged'}; see preserved diagnostics`)
  const lastLine = stdout.trim().split(/\r?\n/).at(-1)
  let pointer: { summaryFile: string; eventsFile: string }
  try { pointer = JSON.parse(lastLine ?? '') }
  catch { throw new Error(`${label} controller returned no summary pointer (exit ${status.code}); inspect its diagnostics`) }
  if (!pointer.summaryFile || !existsSync(pointer.summaryFile)) throw new Error(`${label} controller did not preserve its summary`)
  const summary = JSON.parse(readFileSync(pointer.summaryFile, 'utf8')) as ControllerSummary
  expect(summary.error, `Controller failure: ${pointer.summaryFile}`).toBeNull()
  expect(summary.cleanupError).toBeUndefined()
  expect(summary.transportCloseError).toBeUndefined()
  expect(status.code, `Controller exit: ${pointer.summaryFile}`).toBe(0)
  expect(summary.domainTerminationAcknowledged).toBe(true)
  return { ...pointer, summary }
}

async function normalQuit(app: ElectronApplication) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

test('@experiment Pi full AgentSession edits selected native text, preserves a real manual edit, and cold-reopens the saved document', async ({}, testInfo) => {
  test.skip(!enabled, 'Opt in with GUOLING_PI_DOMAIN_PREFLIGHT=1; only GUOLING_PI_DOMAIN_RUN=1 requests the real model')
  test.setTimeout(600_000)
  const base = join(root, 'output/next-execution-20261027/pi-ui')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, fileName), initial = fixture(), controllerOutput = join(directory, 'controller')
  writeFileSync(file, createCourseProjectV10Archive(initial))
  const facts: Facts = { directory, file, runModels, sourceStage: 'not-exercised-native-first-vertical',
    input: 'Visible dedicated Electron UI, real native text edit and pointer selection; document reads only.',
    modelGate: 'Only GUOLING_PI_DOMAIN_RUN=1 appends --run. No default-suite model calls.',
    visualReview: 'Screenshots require independent inspection; automated checks do not constitute visual acceptance.' }
  let app: ElectronApplication | undefined, page: Page | undefined, child: ChildProcess | undefined
  let domainEnabled = false
  const revoke = async () => {
    if (domainEnabled && page && !page.isClosed()) {
      const status = await configureDomain(page, false)
      domainEnabled = false
      facts.domainDisabled = status.state
      return status
    }
  }
  try {
    const piPackageRoot = packageRoot('@earendil-works/pi-coding-agent', 'GUOLING_PI_PACKAGE_ROOT')
    const mcpSdkRoot = packageRoot('@modelcontextprotocol/sdk', 'GUOLING_MCP_SDK_ROOT')
    let view = await launch(join(directory, 'profile-author'), workspace)
    app = view.app; page = view.page
    await expect(visibleText(page, originalTarget)).toBeVisible()
    await expect(visibleText(page, originalManual)).toBeVisible()
    await expect(visibleText(page, neighborText)).toBeVisible()
    const before = await read(page, view.documentId)
    await manuallyEdit(page, facts)
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(before.undoDepth + 1)
    const manual = await read(page, view.documentId)
    expectOnlyTextChange(manual.model.project, initial.project, manualId, changedManual)
    await page.keyboard.press('Control+s')
    const baseline = await waitSaved(page, view.documentId)
    expect(archiveAt(file).project.instances).toEqual(baseline.model.project.instances)
    facts.manualBaseline = { revision: baseline.revision, undoDepth: baseline.undoDepth,
      dirty: baseline.dirty, sha256: sha256(readFileSync(file)), instances: baseline.model.project.instances }
    await selectTarget(page, facts)
    await page.screenshot({ path: join(directory, '01-manual-edit-saved-target-selected.png'), fullPage: true })

    const port = await freePort(), configured = await configureDomain(page, true, port)
    domainEnabled = true
    expect(configured.state).toBe('running')
    const endpoint = new URL(configured.endpoint)
    expect(endpoint.hostname).toBe('127.0.0.1')
    expect(Number(endpoint.port)).toBe(port)
    facts.domain = { state: configured.state, endpoint: configured.endpoint, permission: configured.settings.permission }
    const settingsFile = join(directory, 'controller-settings.json')
    const config = {
      piPackageRoot, mcpSdkRoot, cwd: workspace, outputDirectory: controllerOutput,
      fixture: { file, initialHash: sha256(readFileSync(file)) }, expectedDocumentId: view.documentId,
      mcpUrl: configured.endpoint, requireSelection: true, readSelection: true, allowedToolNames,
      label: 'selected-native-text', maxTokens: 4096, timeoutMs: 180_000,
      prompt: `请只修改当前界面选中的原生文字对象。先读取实际目标与当前正文，确认正文为“${originalTarget}”，再把整段正文精确改为“${firstTarget}”，最后通过正式 file.save 保存当前文档。保留所有其他对象、外观和位置，尤其保留我刚刚手动填写的“${changedManual}”。这轮不编辑源码，不创建对象。若读取与预期不符，请停止修改并说明，不要转而修改别的对象。`,
      followupPrompt: `继续同一份文档和同一个已选中的文字对象。请先读取当前真实状态，确认上一轮已保存的正文为“${firstTarget}”，然后仅把它精确改为“${finalTarget}”，再用正式 file.save 保存。保留“${changedManual}”和全部邻近对象、外观与位置；不要重放上一轮修改，也不要改源码。若真实状态不符，请停止修改并说明。`,
    }
    writeFileSync(settingsFile, JSON.stringify(config, null, 2))
    facts.controllerSettings = settingsFile
    const preflight = await runController(settingsFile, false, directory, value => { child = value }, revoke)
    facts.preflight = preflight
    expect(preflight.summary.state).toBe('ready-no-model')
    expect(preflight.summary.run).toBe(false)
    expect(preflight.summary.modelSendAttempted).toBe(false)
    expect(preflight.summary.actualProviderRequests).toHaveLength(0)
    expect(existsSync(join(controllerOutput, 'model-send-attempted.json'))).toBe(false)
    expect(sha256(readFileSync(file))).toBe(config.fixture.initialHash)
    expect((await read(page, view.documentId)).model.project.instances).toEqual(baseline.model.project.instances)
    await expectCanvas(page, originalTarget)
    await page.screenshot({ path: join(directory, '02-real-domain-preflight-no-model.png'), fullPage: true })

    const expectedTarget = runModels ? finalTarget : originalTarget
    if (runModels) {
      // One controller owns both turns and the same live domain port. Its second
      // turn reopens Pi's native JSONL; the driver never reconstructs history.
      await selectTarget(page, facts)
      const result = await runController(settingsFile, true, directory, value => { child = value }, revoke)
      facts.model = result
      expect(result.summary.run).toBe(true)
      expect(result.summary.modelSendAttempted).toBe(true)
      expect(result.summary.state).toBe('real-domain-turn-complete-pending-independent-verification')
      expect(result.summary.phases).toHaveLength(2)
      const [first, second] = result.summary.phases
      expect(first!.successfulSaveCalls).toBeGreaterThan(0)
      expect(second!.successfulSaveCalls).toBeGreaterThan(0)
      expect(second!.nativeSessionId).toBe(first!.nativeSessionId)
      expect(second!.nativeSessionFile).toBe(first!.nativeSessionFile)
      expect(result.summary.reopen?.restoredToolResults).toBeGreaterThan(0)
      expect(result.summary.actualProviderRequests.find(request => request.phase === 'native-reopen-followup')?.toolResultCount).toBeGreaterThan(0)
      const checkpointRoot = dirname(result.summaryFile)
      expectOnlyTextChange(archiveAt(join(checkpointRoot, '1.after.glx')).project, baseline.model.project, targetId, firstTarget)
      expectOnlyTextChange(archiveAt(join(checkpointRoot, '2.after.glx')).project, baseline.model.project, targetId, finalTarget)
      facts.modelRequestsObserved = result.summary.actualProviderRequests.length
    }
    // No UI save after the model: its own domain save must establish this state.
    await expectCanvas(page, expectedTarget)
    const saved = await waitSaved(page, view.documentId)
    expectOnlyTextChange(saved.model.project, baseline.model.project, targetId, expectedTarget)
    const disk = archiveAt(file)
    expectOnlyTextChange(disk.project, baseline.model.project, targetId, expectedTarget)
    expect(disk.project.instances).toEqual(saved.model.project.instances)
    facts.saved = { revision: saved.revision, dirty: saved.dirty, undoDepth: saved.undoDepth,
      sha256: sha256(readFileSync(file)), instances: saved.model.project.instances }
    await page.screenshot({ path: join(directory, '03-saved-result-human-edit-preserved.png'), fullPage: true })
    await bounded(revoke(), 10_000, 'The experiment host did not acknowledge shutdown')
    await normalQuit(app); app = undefined; facts.firstNormalQuit = true

    view = await launch(join(directory, 'profile-cold'), workspace)
    app = view.app; page = view.page
    await expectCanvas(page, expectedTarget)
    const reopened = await read(page, view.documentId)
    expect(reopened).toMatchObject({ dirty: false, undoDepth: 0, redoDepth: 0, revision: saved.revision })
    expectOnlyTextChange(reopened.model.project, baseline.model.project, targetId, expectedTarget)
    expect(reopened.model.project.instances).toEqual(saved.model.project.instances)
    facts.reopened = { revision: reopened.revision, dirty: reopened.dirty, undoDepth: reopened.undoDepth,
      target: textOf(reopened.model.project, targetId), manual: textOf(reopened.model.project, manualId), neighbor: textOf(reopened.model.project, neighborId) }
    await page.screenshot({ path: join(directory, '04-independent-profile-cold-reopen.png'), fullPage: true })
    await normalQuit(app); app = undefined; facts.secondNormalQuit = true
    facts.result = runModels ? 'model-and-ui-automated-pass-awaiting-image-review' : 'preflight-and-ui-automated-pass-no-model'
  } catch (error) {
    facts.result = 'fail'; facts.error = diagnostic(String(error))
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
      writeFileSync(join(directory, 'failure-dom.html'), await page.content().catch(() => 'DOM unavailable'))
    }
    throw error
  } finally {
    await bounded(revoke(), 10_000, 'Final host revocation remained unconfirmed').catch(error => { facts.revokeError = diagnostic(String(error)) })
    if (child && child.exitCode === null) child.kill('SIGTERM')
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('Pi real-domain UI facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app?.close().catch(() => undefined)
  }
})
