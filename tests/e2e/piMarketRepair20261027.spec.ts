import { _electron as electron, chromium, expect, test, type Browser, type BrowserContext, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { blockOfflineServiceWorkers } from '../helpers/blockOfflineServiceWorkers'

// This experiment repairs an isolated copy of the real pre-T3 work. It never
// participates in the default regression suite or writes the source archive.
const verifyDirectory = process.env.GUOLING_MARKET_VERIFY_DIRECTORY?.trim()
const verifyOnly = Boolean(verifyDirectory)
const useAcp = verifyOnly || process.env.GUOLING_ACP_MARKET_RUN === '1' || process.env.GUOLING_ACP_MARKET_PREFLIGHT === '1'
// Verification takes precedence even if an earlier model-run flag is inherited.
const runModels = !verifyOnly && (useAcp ? process.env.GUOLING_ACP_MARKET_RUN === '1' : process.env.GUOLING_PI_MARKET_RUN === '1')
const repaired = runModels || verifyOnly
const enabled = verifyOnly || runModels || useAcp || process.env.GUOLING_PI_MARKET_PREFLIGHT === '1'
const root = resolve(__dirname, '../..')
const requireFromRepo = createRequire(join(root, 'package.json'))
const fileName = 'market.glx'
const originalFile = join(root, 'output/audit-remediation-20261027/benchmark/C/t3/control/pre-T3-market.glx')
const tableId = 'instance_P6Zm-yGayXO-rSrxOAMOU'
const defaultsId = 'instance_fhkc99oi0aGS0NxASHsC5'
const controlId = 'bcd718da-4d78-4869-a177-fa8e0ae637cf'
const chartIds = ['instance_11rTV8cnAc2Ye21Lkjhvv', 'instance_r-lCGHGkCM_JRJR3hYT9w']
const allowedToolNames = ['workbench.state', 'read', 'project.list', 'project.read', 'project.apply', 'file.save', 'document.export', 'tools.load', 'operation.read']
type Facts = Record<string, unknown>
type ControllerSummary = {
  state: string; run: boolean; error: unknown; cleanupError?: unknown; transportCloseError?: unknown
  modelSendAttempted: boolean; domainTerminationAcknowledged?: boolean
  actualProviderRequests: Array<{ phase: string; model: string; toolResultCount: number | null; tools: unknown[] }>
  phases: Array<{ label: string; successfulSaveCalls: number; nativeSessionId: string; nativeSessionFile: string
    diskCheckpoint: { sha256: string; changed: boolean }; calls: Array<{ tool: string; isError: boolean }> }>
}
type AcpControllerSummary = {
  state: string; run: boolean; error: unknown; cleanupError?: unknown; domainStopError?: unknown; logError?: unknown
  modelSendAttempted: boolean; domainTerminationAcknowledged: boolean; modelId: string; effort: string; sessionId: string
  cleanup: { phase: string; pendingRequests: number; pendingPermissions: number }
  phases: Array<{ name: string; elapsedMs: number; result?: { stopReason: string } }>
  diskCheckpoints: Array<{ file: string; sha256: string; changed: boolean; observedModels: string[] }>
}
type AcpToolEvent = {
  kind?: string; at?: string; elapsedMs?: number
  data?: { sessionId?: string; replay?: boolean; update?: {
    sessionUpdate?: string; toolCallId?: string; status?: string; rawInput?: { tool?: string }
    rawOutput?: { error?: unknown; result?: { isError?: boolean; structuredContent?: { result?: { data?: Record<string, unknown> } } } }
  } }
}
type PreservedFile = { path: string; bytes: number; sha256: string }
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const archiveAt = (path: string) => openCourseProjectV10Archive(new Uint8Array(readFileSync(path)))
type Archive = ReturnType<typeof archiveAt>

function fingerprintFile(path: string): PreservedFile {
  const bytes = readFileSync(path)
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
}

function preservationState(files: PreservedFile[]) {
  return files.map(before => {
    try {
      const after = fingerprintFile(before.path)
      return { ...before, afterSha256: after.sha256, unchanged: before.sha256 === after.sha256 && before.bytes === after.bytes }
    } catch (error) { return { ...before, unchanged: false, error: diagnostic(String(error)) } }
  })
}

function assertAcpReceipts(eventsFile: string, expected: {
  sessionId: string; revision: number; file: string; offlineFile: string; documentId?: string
}) {
  const calls = new Map<string, { tool: string; line: number }>()
  const receipts: Array<{ tool: string; toolCallId: string; callLine: number; line: number; at?: string;
    elapsedMs?: number; status?: string; error?: unknown; isError?: boolean; data?: Record<string, unknown> }> = []
  for (const [index, line] of readFileSync(eventsFile, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const event = JSON.parse(line) as AcpToolEvent, update = event.data?.update
    if (event.kind !== 'session.update' || event.data?.replay === true || !update?.toolCallId) continue
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') continue
    expect(event.data?.sessionId, `ACP event session at ${eventsFile}:${index + 1}`).toBe(expected.sessionId)
    if (update.sessionUpdate === 'tool_call' && update.rawInput?.tool) {
      calls.set(update.toolCallId, { tool: update.rawInput.tool, line: index + 1 })
    } else if (update.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(update.status ?? '')) {
      const call = calls.get(update.toolCallId)
      if (!call || !['file.save', 'document.export'].includes(call.tool)) continue
      receipts.push({ tool: call.tool, toolCallId: update.toolCallId, callLine: call.line, line: index + 1,
        at: event.at, elapsedMs: event.elapsedMs, status: update.status, error: update.rawOutput?.error,
        isError: update.rawOutput?.result?.isError, data: update.rawOutput?.result?.structuredContent?.result?.data })
    }
  }
  const lastReceipt = (tool: string) => {
    const receipt = receipts.filter(item => item.tool === tool).at(-1)
    if (!receipt) throw new Error(`No correlated ${tool} completion in ${eventsFile}`)
    expect(receipt.status, `${tool} ${receipt.toolCallId}`).toBe('completed')
    expect(receipt.error ?? null).toBeNull()
    expect(receipt.isError).not.toBe(true)
    if (!receipt.data) throw new Error(`${tool} lacks its formal structured receipt in ${eventsFile}`)
    return { ...receipt, data: receipt.data }
  }
  const save = lastReceipt('file.save'), exported = lastReceipt('document.export')
  expect(save.data).toMatchObject({ status: 'saved', savedRevision: expected.revision,
    currentRevision: expected.revision, dirty: false, path: expected.file, fileVersion: fingerprintFile(expected.file).sha256 })
  expect(exported.data).toMatchObject({ status: 'written', format: 'html-offline', exportedRevision: expected.revision,
    currentRevision: expected.revision, path: expected.offlineFile, fileVersion: fingerprintFile(expected.offlineFile).sha256 })
  expect(typeof save.data.documentId).toBe('string')
  expect(String(save.data.documentId).length).toBeGreaterThan(0)
  if (expected.documentId) expect(save.data.documentId).toBe(expected.documentId)
  expect(exported.data.documentId).toBe(save.data.documentId)
  expect(exported.data.epoch).toBe(save.data.epoch)
  expect(exported.line).toBeGreaterThan(save.line)
  return { eventsFile, sessionId: expected.sessionId, save, exported }
}

function assertAcpDelivery(summary: AcpControllerSummary, eventsFile: string, expected: {
  revision: number; file: string; offlineFile: string; documentId?: string
}) {
  expect(summary).toMatchObject({ state: 'turns-finished', run: true, error: null, modelSendAttempted: true,
    domainTerminationAcknowledged: true, modelId: 'gpt-6.1-terra',
    cleanup: { phase: 'closed', pendingRequests: 0, pendingPermissions: 0 } })
  expect(summary.cleanupError).toBeUndefined()
  expect(summary.domainStopError).toBeUndefined()
  expect(summary.logError).toBeUndefined()
  const prompts = summary.phases.filter(phase => phase.name.startsWith('prompt-'))
  expect(prompts).toHaveLength(1)
  expect(prompts[0]!.result?.stopReason).toBe('end_turn')
  expect(summary.diskCheckpoints).toHaveLength(1)
  const checkpoint = summary.diskCheckpoints[0]!
  expect(checkpoint.changed).toBe(true)
  expect(checkpoint.observedModels.length).toBeGreaterThan(0)
  expect(checkpoint.observedModels.every(model => model === 'gpt-6.1-terra')).toBe(true)
  expect(fingerprintFile(checkpoint.file).sha256).toBe(checkpoint.sha256)
  expect(fingerprintFile(expected.file).sha256).toBe(checkpoint.sha256)
  expect(typeof summary.sessionId).toBe('string')
  expect(summary.sessionId.length).toBeGreaterThan(0)
  return { checkpointFile: checkpoint.file, receipts: assertAcpReceipts(eventsFile, { ...expected, sessionId: summary.sessionId }) }
}

function bounded<T>(pending: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    pending.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
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
  if (verifyOnly) throw new Error('Verification-only runs cannot configure domain permissions')
  return page.evaluate(async ({ enabled, port }) => {
    if (!window.desktopAPI.externalMcp) throw new Error('The production external MCP API is unavailable')
    return window.desktopAPI.externalMcp.configure({ enabled, ...(port === undefined ? {} : { port }), permission: 'workspace' })
  }, { enabled, port })
}

async function launch(profile: string, workspace: string, observe: (page: Page) => void) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '0' } })
  try {
    const page = await app.firstWindow()
    // Source preparation starts while the file opens. Register before opening
    // the archive so cold-start failures cannot fall into an observation gap.
    observe(page)
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

function diagnostic(text: string) {
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/("(?:apiKey|api_key|authorization|accessToken|access_token|secret|password)"\s*:\s*")[^"]*/gi, '$1[redacted]')
}

async function frameInventory(page: Page) {
  const frames = page.frames()
  return Promise.all(frames.map(async (frame, index) => {
    const result: Facts = { index, main: frame === page.mainFrame(), parent: frames.indexOf(frame.parentFrame()!),
      name: frame.name(), url: diagnostic(frame.url()), detached: frame.isDetached() }
    if (frame.isDetached()) return result
    if (frame !== page.mainFrame()) {
      result.host = await bounded(frame.frameElement().then(element => element.evaluate(node => {
        if (!(node instanceof Element)) throw new Error('Expected an iframe element')
        const box = node.getBoundingClientRect(), style = getComputedStyle(node)
        const ancestors = []
        for (let current: Element | null = node, depth = 0; current && depth < 9; current = current.parentElement, depth++) {
          ancestors.push({ tag: current.tagName, id: current.id, class: current.getAttribute('class'),
            data: Object.fromEntries(Array.from(current.attributes).filter(attribute => attribute.name.startsWith('data-'))
              .map(attribute => [attribute.name, attribute.value.slice(0, 500)])) })
        }
        return { box: { x: box.x, y: box.y, width: box.width, height: box.height },
          display: style.display, visibility: style.visibility, opacity: style.opacity, ancestors }
      })), 2_000, 'Frame host inspection timed out').catch(error => ({ error: diagnostic(String(error)) }))
    }
    result.document = await bounded(frame.evaluate(() => ({ readyState: document.readyState, title: document.title,
      bodyText: document.body?.innerText.slice(0, 40_000) ?? '',
      svgText: Array.from(document.querySelectorAll('svg text')).map(element => element.textContent ?? ''),
      controls: Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')).map(element => ({
        tag: element.tagName, label: element.getAttribute('aria-label'), type: element.getAttribute('type'), value: element.value,
      })),
      runtimeRoots: Array.from(document.querySelectorAll('[data-component-runtime-root],[data-instance-id],[data-component-instance]'))
        .slice(0, 80).map(element => Object.fromEntries(Array.from(element.attributes)
          .filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value.slice(0, 500)]))),
    })), 2_000, 'Frame document inspection timed out').catch(error => ({ error: diagnostic(String(error)) }))
    return result
  }))
}

async function runController(settingsFile: string, run: boolean, directory: string,
  register: (child: ChildProcess | undefined) => void, revoke: () => Promise<unknown>) {
  if (verifyOnly) throw new Error('Verification-only runs cannot launch any agent controller')
  // This runs in Playwright's Node worker, never app.evaluate/Electron's main
  // process. Therefore process.execPath is the normal Node executable.
  if (process.versions.electron) throw new Error('Launch this experimental spec with the normal Node Playwright runner')
  const label = run ? 'model' : 'preflight'
  const args = [...(useAcp ? ['--import', 'tsx'] : []), join(root, `scripts/experiments/${useAcp ? 'acp' : 'pi'}-domain-controller.mjs`),
    '--settings', settingsFile, ...(run ? ['--run'] : [])]
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env }, windowsHide: true, shell: false,
    stdio: useAcp ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] })
  register(child)
  let stdout = '', stderr = '', timedOut = false, spawnError: Error | undefined, revokeFailure: string | undefined
  let forceKill: ReturnType<typeof setTimeout> | undefined
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2_000_000) })
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2_000_000) })
  child.on('message', message => {
    if (!message || typeof message !== 'object') return
    const request = message as { type?: unknown; requestId?: unknown }
    if (request.type !== 'guoling-acp-domain-revoke' || typeof request.requestId !== 'string') return
    // The owning UI profile acknowledges its existing host shutdown before the
    // ACP child may cancel/close. A child process exit alone cannot revoke writes.
    void bounded(revoke(), 10_000, 'ACP host revocation timed out').then(
      () => { if (child.connected) child.send({ type: 'guoling-acp-domain-revoke-result', requestId: request.requestId, ok: true }) },
      error => { if (child.connected) child.send({ type: 'guoling-acp-domain-revoke-result', requestId: request.requestId,
        ok: false, error: diagnostic(String(error)) }) },
    )
  })
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
  const summary = JSON.parse(readFileSync(pointer.summaryFile, 'utf8')) as ControllerSummary | AcpControllerSummary
  expect(summary.error, `Controller failure: ${pointer.summaryFile}`).toBeNull()
  expect(summary.cleanupError).toBeUndefined()
  if (useAcp) {
    expect((summary as AcpControllerSummary).domainStopError).toBeUndefined()
    expect((summary as AcpControllerSummary).logError).toBeUndefined()
  } else expect((summary as ControllerSummary).transportCloseError).toBeUndefined()
  expect(status.code, `Controller exit: ${pointer.summaryFile}`).toBe(0)
  expect(summary.domainTerminationAcknowledged).toBe(!useAcp || run)
  return { ...pointer, summary }
}

async function prepareNativeAcp(settingsFile: string, directory: string, register: (child: ChildProcess | undefined) => void) {
  if (verifyOnly) throw new Error('Verification-only runs cannot prepare model authorization')
  const child = spawn(process.execPath, [join(root, 'scripts/experiments/prepare-acp-domain.mjs'), '--settings', settingsFile],
    { cwd: root, env: { ...process.env }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  register(child)
  let stdout = '', stderr = '', spawnError: Error | undefined
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-500_000) })
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-500_000) })
  try {
    const code = await bounded(new Promise<number | null>(resolve => {
      child.once('error', error => { spawnError = error })
      child.once('close', resolve)
    }), 90_000, 'Native ACP authorization preflight timed out; no model prompt was requested')
    if (spawnError) throw spawnError
    if (code !== 0) throw new Error(`Native ACP authorization unavailable (exit ${code}); see native-preflight diagnostics`)
    return JSON.parse(readFileSync(settingsFile, 'utf8'))
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    register(undefined)
    writeFileSync(join(directory, 'native-preflight.stdout.log'), diagnostic(stdout))
    writeFileSync(join(directory, 'native-preflight.stderr.log'), diagnostic(stderr))
  }
}

async function normalQuit(app: ElectronApplication) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

type TableData = { columns: unknown[]; rows: Array<{ cells: Array<{ text: string }> }> }
type Change = { path: string; before: unknown; after: unknown }
type MarketView = { control: Frame; table: Frame; revenue: Frame; balance: Frame }
const stalls = [
  { name: '手冲咖啡', rate: 12, price: 30, variable: 11, fixed: 600 },
  { name: '独立书摊', rate: 6, price: 42, variable: 27, fixed: 450 },
  { name: '植物工坊', rate: 4, price: 65, variable: 24, fixed: 700 },
  { name: '夜间小食', rate: 15, price: 32, variable: 13, fixed: 850 },
  { name: '手作陶器', rate: 3, price: 88, variable: 39, fixed: 500 },
]

function expectedMarket(n: number, weatherPercent: number, coffeePrice: number) {
  // Integer percentages preserve floor(1000 * 0.65 * 0.12) exactly. This is an
  // independent oracle, not a read of the work's code or prefilled derived cells.
  const rows = stalls.map((stall, index) => {
    const price = index === 0 ? coffeePrice : stall.price
    const orders = Math.floor(n * weatherPercent * stall.rate / 10_000)
    const revenue = orders * price, cost = orders * stall.variable + stall.fixed
    return { ...stall, price, orders, revenue, cost, net: revenue - cost }
  })
  return { rows, totals: rows.reduce((sum, row) => [sum[0]! + row.orders, sum[1]! + row.revenue,
    sum[2]! + row.cost, sum[3]! + row.net], [0, 0, 0, 0]) }
}

function tableData(project: CourseProjectV10, id: string): TableData {
  const value = project.instances[id]?.data as unknown as TableData | undefined
  if (!value || !Array.isArray(value.rows) || !Array.isArray(value.columns)) throw new Error(`Missing canonical table data: ${id}`)
  return value
}

function assertAuthorInputs(project: CourseProjectV10, coffeePrice: '28' | '30') {
  const table = tableData(project, tableId), defaults = tableData(project, defaultsId)
  expect(table.columns).toHaveLength(9)
  expect(table.rows).toHaveLength(6)
  expect(table.rows[0]!.cells.map(cell => cell.text)).toEqual([
    '摊位', '转化率', '客单价/元', '单笔变动成本/元', '固定成本/元', '订单/笔', '营业额/元', '总成本/元', '净结余/元',
  ])
  expect(table.rows.slice(1).map(row => row.cells.slice(0, 5).map(cell => cell.text))).toEqual(
    stalls.map((row, index) => [row.name, `${row.rate}%`, index === 0 ? coffeePrice : String(row.price), String(row.variable), String(row.fixed)]))
  // This small author table is the actual default owner. The controller HTML
  // still contains old value="1000" markup and must not be rewritten to 1200.
  expect(defaults.rows.map(row => row.cells.map(cell => cell.text))).toEqual([
    ['默认人数 N', '默认天气 W'], ['1200', '1.00'],
  ])
  for (const id of [tableId, defaultsId, controlId, ...chartIds]) {
    expect(project.instances[id]?.implementationOverride?.kind, `Preserve real Source implementation ${id}`).toBe('source')
  }
}

function authorDifferences(before: unknown, after: unknown, path = 'project'): Change[] {
  if (Object.is(before, after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && Array.isArray(before) === Array.isArray(after)) {
    const left = before as Record<string, unknown>, right = after as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    return keys.flatMap(key => authorDifferences(left[key], right[key], `${path}.${key}`))
  }
  return [{ path, before, after }]
}

function resourceManifest(resources: Archive['resources']) {
  const files = (values: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bytes]) => [name, { bytes: bytes.byteLength, sha256: sha256(bytes) }]))
  return { assets: files(resources.assets), components: Object.fromEntries(Object.entries(resources.components)
    .sort(([a], [b]) => a.localeCompare(b)).map(([owner, entries]) => [owner, files(entries)])) }
}

function assertOnlyRepair(project: CourseProjectV10, original: CourseProjectV10, repaired: boolean) {
  assertAuthorInputs(project, repaired ? '30' : '28')
  const changes = authorDifferences(original, project)
  if (!repaired) expect(changes).toEqual([])
  else {
    expect(project.revision).toBe(original.revision + 1)
    expect(changes).toEqual([
      { path: `project.instances.${tableId}.data.rows.1.cells.2.text`, before: '28', after: '30' },
      { path: 'project.revision', before: original.revision, after: project.revision },
    ].sort((left, right) => left.path.localeCompare(right.path)))
  }
  return changes
}

async function setEditorMode(page: Page, name: '编辑' | '试运行') {
  const button = page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function clickReal(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  await target.scrollIntoViewIfNeeded()
  const element = await target.elementHandle()
  if (!element) throw new Error('The live control has no pointer target')
  try {
    let point = await element.evaluate(node => {
      const box = node.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    let frame = await element.ownerFrame()
    // The component iframe may itself live inside a scaled Source iframe.
    // Resolve every child viewport through its live iframe border box, retaining
    // trusted main-page mouse input rather than synthesizing a DOM event.
    while (frame && frame !== page.mainFrame()) {
      const host = await frame.frameElement()
      try {
        point = await host.evaluate((node, point) => {
          const iframe = node as HTMLIFrameElement, box = iframe.getBoundingClientRect()
          if (!iframe.offsetWidth || !iframe.offsetHeight || !box.width || !box.height) throw new Error('Iframe pointer mapping has an empty border box')
          return { x: box.x + (iframe.clientLeft + point.x) * box.width / iframe.offsetWidth,
            y: box.y + (iframe.clientTop + point.y) * box.height / iframe.offsetHeight }
        }, point)
        frame = await host.ownerFrame()
      } finally { await host.dispose() }
    }
    if (frame !== page.mainFrame()) throw new Error('The live control is not attached to the expected main page')
    await page.mouse.click(point.x, point.y)
  } finally { await element.dispose() }
}

async function revealDashboard(page: Page) {
  // The current work may open its cover or its dashboard. Navigate with the
  // authored link when needed, without changing project.entry or author state.
  const entry = page.getByText(/进入运营沙盘\s*→/).first()
  if (await entry.isVisible().catch(() => false)) await clickReal(page, entry)
}

async function marketFrames(page: Page): Promise<MarketView> {
  let found: Partial<MarketView> = {}
  await expect.poll(async () => {
    found = {}
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() || frame.isDetached()) continue
      const element = await frame.frameElement().catch(() => undefined)
      if (!element || !await element.isVisible().catch(() => false)) continue
      const body = await frame.locator('body').innerText({ timeout: 700 }).catch(() => '')
      if (await frame.getByRole('spinbutton', { name: '预计到场人数', exact: true }).count()) found.control = frame
      if (/^摊位(?:\s|$)/.test(body.trim())) found.table = frame
      if (body.trim().startsWith('各摊位营业额 / 元')) found.revenue = frame
      if (body.trim().startsWith('成本与净结余 / 元')) found.balance = frame
    }
    return Object.keys(found).sort()
  }, { timeout: 20_000, message: 'The real control, source table and both source chart frames must be visible' })
    .toEqual(['balance', 'control', 'revenue', 'table'])
  return found as MarketView
}

const normalizeNumber = (text: string) => text.replaceAll(',', '').replace(/[−–]/g, '-').trim()
async function readStats(view: MarketView) {
  return Promise.all(['orders', 'revenue', 'cost', 'net'].map(async key =>
    Number(normalizeNumber(await view.control.locator(`[data-${key}]`).innerText()))))
}

async function readTable(view: MarketView) {
  const text = await view.table.locator('body').innerText()
  const tokens = text.split(/[\t\r\n]+/).map(value => value.trim()).filter(Boolean)
  return stalls.map(row => {
    const start = tokens.indexOf(row.name)
    if (start < 0) return []
    return tokens.slice(start, start + 9).map(normalizeNumber)
  })
}

async function chartFacts(view: MarketView) {
  const revenue = await view.revenue.locator('body').innerText(), balance = await view.balance.locator('body').innerText()
  const numbers = (text: string) => (normalizeNumber(text).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  return { revenue, balance, revenueNumbers: numbers(revenue), balanceNumbers: numbers(balance) }
}

async function verifyScenario(page: Page, view: MarketView, n: number, weather: number, coffeePrice: number,
  label: string, directory: string, cases: unknown[]) {
  const expected = expectedMarket(n, weather, coffeePrice)
  await expect(view.control.getByRole('spinbutton', { name: '预计到场人数', exact: true })).toHaveValue(String(n))
  await expect(view.control.getByRole('slider', { name: '人数滑杆', exact: true })).toHaveValue(String(n))
  await expect(view.control.getByRole('combobox', { name: '天气到场系数', exact: true })).toHaveValue(String(weather))
  await expect.poll(() => readStats(view), { timeout: 10_000 }).toEqual(expected.totals)
  const rows = expected.rows.map(row => [row.name, `${row.rate}%`, String(row.price), String(row.variable), String(row.fixed),
    String(row.orders), String(row.revenue), String(row.cost), String(row.net)])
  await expect.poll(() => readTable(view), { timeout: 10_000 }).toEqual(rows)
  await expect.poll(async () => {
    const charts = await chartFacts(view)
    return expected.rows.every(row => charts.revenueNumbers.includes(row.revenue)
      && charts.balanceNumbers.includes(row.cost) && charts.balanceNumbers.includes(row.net))
  }, { timeout: 10_000, message: 'Both real charts must show every current revenue, cost and signed net value' }).toBe(true)
  const charts = await chartFacts(view)
  for (const row of expected.rows) {
    expect(charts.revenue).toContain(row.name)
    expect(charts.balance).toContain(row.name)
  }
  const body = await view.control.locator('body').innerText()
  expect(body).toContain('总订单不等于独立访客人数')
  cases.push({ label, n, weather, coffeePrice, expected, actualTotals: await readStats(view), tableRows: await readTable(view), charts, controlText: body })
  await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true })
}

async function setAttendees(page: Page, view: MarketView, n: number) {
  const input = view.control.getByRole('spinbutton', { name: '预计到场人数', exact: true })
  await clickReal(page, input)
  await expect(input).toBeFocused()
  await page.keyboard.press('Control+a'); await page.keyboard.insertText(String(n)); await page.keyboard.press('Tab')
  await expect(input).toHaveValue(String(n))
}

async function setWeather(page: Page, view: MarketView, percent: 100 | 85 | 65) {
  const input = view.control.getByRole('combobox', { name: '天气到场系数', exact: true })
  await clickReal(page, input)
  await expect(input).toBeFocused()
  await page.keyboard.press('Home')
  for (let index = 0; index < [100, 85, 65].indexOf(percent); index++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab')
  await expect(input).toHaveValue(String(percent))
}

async function exerciseMarket(page: Page, directory: string, prefix: string, cases: unknown[], coffeePrice = 30) {
  await revealDashboard(page)
  const view = await marketFrames(page)
  await verifyScenario(page, view, 1200, 100, coffeePrice, `${prefix}-default-1200`, directory, cases)
  await setAttendees(page, view, 0)
  await verifyScenario(page, view, 0, 100, coffeePrice, `${prefix}-zero`, directory, cases)
  await setAttendees(page, view, 1000)
  await setWeather(page, view, 65)
  await verifyScenario(page, view, 1000, 65, coffeePrice, `${prefix}-rain-1000-65`, directory, cases)
  await clickReal(page, view.control.getByRole('button', { name: '恢复默认情景', exact: true }))
  await verifyScenario(page, view, 1200, 100, coffeePrice, `${prefix}-reset-keeps-author-inputs`, directory, cases)
}

async function waitSaved(page: Page, documentId: string) {
  await expect.poll(async () => {
    const snapshot = await read(page, documentId)
    return { dirty: snapshot.dirty, saving: snapshot.saving }
  }, { timeout: 20_000 }).toEqual({ dirty: false, saving: false })
  return read(page, documentId)
}

test('@experiment external agent repairs only market coffee price, preserves the real work, and validates UI plus offline delivery', async ({}, testInfo) => {
  test.skip(!enabled, 'Use GUOLING_MARKET_VERIFY_DIRECTORY for existing delivery verification without a model; GUOLING_ACP_MARKET_RUN=1 authorizes the exact Terra experiment')
  test.setTimeout(600_000)
  const base = join(root, 'output/next-execution-20261027/market-ui')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, fileName), offlineFile = join(workspace, 'market-offline.html')
  const originalBytes = readFileSync(originalFile), originalHash = sha256(originalBytes)
  const original = openCourseProjectV10Archive(new Uint8Array(originalBytes))
  const preservedFiles: PreservedFile[] = [{ path: originalFile, bytes: originalBytes.byteLength, sha256: originalHash }]
  const cases: unknown[] = [], pageErrors: string[] = [], runtimeDiagnostics: unknown[] = [], offlineErrors: string[] = [], networkAttempts: unknown[] = []
  const facts: Facts = { originalFile, originalHash, file, offlineFile, directory, runModels, verifyOnly,
    route: verifyOnly ? 'acp-native-terra-existing-delivery-verification' : useAcp ? 'acp-native-terra' : 'pi-historical',
    cases, pageErrors, runtimeDiagnostics, offlineErrors, networkAttempts,
    frozenTask: 'Only coffee unit price 28 -> 30; preserve book fixed cost 450, saved defaults N1200/W1.00, all other author fields, and export offline HTML.',
    priceAccounting: 'Provider money cost remains unmeasured; SDK cost placeholders are not actual charges.',
    input: 'New visible Electron profiles and real mouse/keyboard; no author writes through evaluate; offline HTTP(S) requests are blocked and recorded.',
    visualReview: 'Screenshots require independent inspection; numeric checks do not establish visual acceptance.' }
  let app: ElectronApplication | undefined, page: Page | undefined, child: ChildProcess | undefined
  let browser: Browser | undefined, context: BrowserContext | undefined, offlinePage: Page | undefined, domainEnabled = false
  const observeRuntime = (label: string) => (observed: Page) => {
    observed.on('pageerror', error => pageErrors.push(`${label}: ${diagnostic(error.stack ?? String(error))}`))
    observed.on('console', message => {
      if (!['warning', 'error'].includes(message.type())) return
      if (runtimeDiagnostics.length < 300) runtimeDiagnostics.push({ label, at: new Date().toISOString(),
        type: message.type(), text: diagnostic(message.text()).slice(0, 8_000), location: message.location() })
      else facts.runtimeDiagnosticsDropped = Number(facts.runtimeDiagnosticsDropped ?? 0) + 1
    })
    observed.on('crash', () => pageErrors.push(`${label}: renderer crashed`))
  }
  const revoke = async () => {
    if (domainEnabled) {
      if (!page || page.isClosed()) throw new Error('The granted domain host has no live owning UI; revocation is unconfirmed')
      const status = await configureDomain(page, false)
      if (status.state !== 'disabled') throw new Error(`Domain host shutdown was not confirmed: ${status.state}`)
      domainEnabled = false; facts.domainDisabled = status.state
      return status
    }
  }
  try {
    expect(expectedMarket(1200, 100, 30).totals).toEqual([480, 19392, 11524, 7868])
    expect(expectedMarket(0, 100, 30).totals).toEqual([0, 0, 3100, -3100])
    expect(expectedMarket(1000, 65, 30).totals).toEqual([259, 10444, 7637, 2807])
    expect(original.project.revision).toBe(28)
    expect(Object.keys(original.project.instances)).toHaveLength(38)
    assertAuthorInputs(original.project, '28')
    facts.initial = { revision: original.project.revision, defaults: tableData(original.project, defaultsId),
      businessInputs: tableData(original.project, tableId).rows.map(row => row.cells.slice(0, 5).map(cell => cell.text)),
      resourceManifest: resourceManifest(original.resources) }
    if (verifyOnly) {
      if (!verifyDirectory || !isAbsolute(verifyDirectory)) throw new Error('GUOLING_MARKET_VERIFY_DIRECTORY must identify an absolute existing paid run directory')
      const sourceDirectory = resolve(verifyDirectory), sourceFactsFile = join(sourceDirectory, 'facts.json')
      const sourceFile = join(sourceDirectory, 'workspace', fileName), sourceOfflineFile = join(sourceDirectory, 'workspace', 'market-offline.html')
      preservedFiles.push(...[sourceFactsFile, sourceFile, sourceOfflineFile].map(fingerprintFile))
      const sourceFacts = JSON.parse(readFileSync(sourceFactsFile, 'utf8')) as {
        runModels: boolean; route: string; originalFile: string; originalHash: string; file: string; offlineFile: string
        result: string; error?: unknown; saved?: { revision: number; dirty: boolean; saving: boolean; archiveSha256: string }
        model?: { summaryFile: string; eventsFile: string; summary: AcpControllerSummary }
      }
      expect(sourceFacts).toMatchObject({ runModels: true, route: 'acp-native-terra', originalFile, originalHash,
        file: sourceFile, offlineFile: sourceOfflineFile })
      if (!sourceFacts.model?.summaryFile || !sourceFacts.model.eventsFile) throw new Error('Existing delivery has no original paid ACP evidence pointers')
      const { summaryFile, eventsFile } = sourceFacts.model
      expect(dirname(resolve(summaryFile))).toBe(join(sourceDirectory, 'controller'))
      expect(summaryFile.endsWith('.json')).toBe(true)
      expect(resolve(eventsFile)).toBe(resolve(summaryFile.replace(/\.json$/, '.jsonl')))
      preservedFiles.push(...[summaryFile, eventsFile].map(fingerprintFile))
      const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as AcpControllerSummary
      expect(sourceFacts.model.summary).toEqual(summary)
      const sourceArchive = archiveAt(sourceFile)
      const changes = assertOnlyRepair(sourceArchive.project, original.project, true)
      expect(resourceManifest(sourceArchive.resources)).toEqual(resourceManifest(original.resources))
      expect(sourceFacts.saved).toMatchObject({ revision: sourceArchive.project.revision, dirty: false, saving: false,
        archiveSha256: fingerprintFile(sourceFile).sha256 })
      const evidence = assertAcpDelivery(summary, eventsFile, { revision: sourceArchive.project.revision,
        file: sourceFile, offlineFile: sourceOfflineFile })
      preservedFiles.push(fingerprintFile(evidence.checkpointFile))
      expect(readFileSync(sourceOfflineFile).byteLength).toBeGreaterThan(1000)
      facts.verificationSource = { directory: sourceDirectory, factsFile: sourceFactsFile,
        previousResult: sourceFacts.result, previousError: sourceFacts.error, summaryFile, eventsFile, summary,
        authorDiffs: changes, ...evidence }
      // The prior failure and paid receipts remain in their original directory.
      // Only copies enter the new runtime profiles; no save/export fallback exists.
      copyFileSync(sourceFile, file, constants.COPYFILE_EXCL)
      copyFileSync(sourceOfflineFile, offlineFile, constants.COPYFILE_EXCL)
      expect(fingerprintFile(file).sha256).toBe(fingerprintFile(sourceFile).sha256)
      expect(fingerprintFile(offlineFile).sha256).toBe(fingerprintFile(sourceOfflineFile).sha256)
      facts.reusedArtifacts = { archive: fingerprintFile(file), offline: fingerprintFile(offlineFile) }
      facts.modelSendAttempted = false
      facts.authorizationConfigured = false
    } else copyFileSync(originalFile, file, constants.COPYFILE_EXCL)

    let view = await launch(join(directory, 'profile-repair'), workspace, observeRuntime('repair-profile'))
    app = view.app; page = view.page
    if (!verifyOnly) {
      const piPackages = useAcp ? {} : {
        piPackageRoot: packageRoot('@earendil-works/pi-coding-agent', 'GUOLING_PI_PACKAGE_ROOT'),
        mcpSdkRoot: packageRoot('@modelcontextprotocol/sdk', 'GUOLING_MCP_SDK_ROOT'),
      }
      await setEditorMode(page, '试运行')
      await revealDashboard(page)
      const baselineView = await marketFrames(page)
      await verifyScenario(page, baselineView, 1200, 100, 28, '01-pre-T3-default-from-author-data', directory, cases)
      const before = await waitSaved(page, view.documentId)
      assertOnlyRepair(before.model.project, original.project, false)
      await setEditorMode(page, '编辑')

      const port = await freePort(), configured = await configureDomain(page, true, port)
      domainEnabled = true
      expect(configured.state).toBe('running')
      expect(new URL(configured.endpoint).hostname).toBe('127.0.0.1')
      expect(Number(new URL(configured.endpoint).port)).toBe(port)
      facts.domain = { endpoint: configured.endpoint, permission: configured.settings.permission }
      const settingsFile = join(directory, 'controller-settings.json'), outputDirectory = join(directory, 'controller')
      const config = { ...piPackages, cwd: workspace, outputDirectory,
        ...(useAcp ? { modelId: 'gpt-6.1-terra', effort: 'medium', mcpName: `guoling_market_${port}`,
          turnBudgetMs: 300_000, revokeTimeoutMs: 10_000 } : {}),
        fixture: { file, initialHash: sha256(readFileSync(file)) }, expectedDocumentId: view.documentId,
        mcpUrl: configured.endpoint, requireSelection: false, readSelection: false, allowedToolNames,
        label: 'frozen-market-T3-repair', maxTokens: 8192, timeoutMs: 180_000,
        prompt: `请对当前打开的隔离副本 market.glx 执行唯一的冻结 T3 返修：仅将“手冲咖啡”的客单价从 28 改为 30，确保现有表格、汇总和两张图表消费该值。首先用实际 workbench.state/project.list/project.read 发现并读取此作品的正式表格数据路径，不得编造目标句柄或文件路径。前置作者状态是五个摊位、九列；“独立书摊”固定成本450；右上默认参数表已保存N=1200/W=1.00。核实这些状态后，只通过现有 project.apply 修改咖啡行的客单价这个字符串字段。保留所有其他经营输入、既有人工编辑、默认参数、身份、布局、格式、素材、原生数据及Source源码；不要重写派生值、控制HTML中的旧初始markup、图表或实现。若发现状态不符，停止并说明。通过正式 file.save 保存 market.glx，然后通过正式 document.export 更新离线HTML到同一隔离工作空间的 ${offlineFile}，等待导出完成。不要改原作品，也不要创建新作品。这一轮只完成上述一次返修、保存和离线交付。`,
      }
      writeFileSync(settingsFile, JSON.stringify(config, null, 2))
      if (useAcp) {
        const prepared = await prepareNativeAcp(settingsFile, directory, value => { child = value })
        facts.nativePreflight = JSON.parse(readFileSync(prepared.preflightEvidence, 'utf8'))
        expect((facts.nativePreflight as { status: string }).status).toBe('ready-no-model')
      }
      const preflight = await runController(settingsFile, false, directory, value => { child = value }, revoke)
      facts.preflight = preflight
      expect(preflight.summary.state).toBe(useAcp ? 'preflight-ready' : 'ready-no-model')
      expect(preflight.summary.modelSendAttempted).toBe(false)
      if (useAcp) {
        expect((preflight.summary as AcpControllerSummary).modelId).toBe('gpt-6.1-terra')
        expect(preflight.summary.phases.map(phase => 'name' in phase && phase.name)).toEqual(['preflight'])
      } else expect((preflight.summary as ControllerSummary).actualProviderRequests).toHaveLength(0)
      expect(sha256(readFileSync(file))).toBe(config.fixture.initialHash)
      expect(existsSync(offlineFile)).toBe(false)
      assertOnlyRepair((await read(page, view.documentId)).model.project, original.project, false)

      if (runModels) {
        const result = await runController(settingsFile, true, directory, value => { child = value }, revoke)
        facts.model = result
        expect(result.summary.modelSendAttempted).toBe(true)
        let checkpointFile: string
        if (useAcp) {
          const summary = result.summary as AcpControllerSummary
          const evidence = assertAcpDelivery(summary, result.eventsFile, { revision: original.project.revision + 1,
            file, offlineFile, documentId: view.documentId })
          facts.domainReceipts = evidence.receipts
          checkpointFile = evidence.checkpointFile
        } else {
          const summary = result.summary as ControllerSummary
          expect(summary.state).toBe('real-domain-turn-complete-pending-independent-verification')
          expect(summary.phases).toHaveLength(1)
          expect(summary.phases[0]!.successfulSaveCalls).toBeGreaterThan(0)
          expect(summary.phases[0]!.calls.some(call => call.tool === 'document.export' && !call.isError)).toBe(true)
          checkpointFile = join(dirname(result.summaryFile), '1.after.glx')
        }
        await expect.poll(() => existsSync(offlineFile), { timeout: 20_000 }).toBe(true)
        expect(readFileSync(offlineFile).byteLength).toBeGreaterThan(1000)
        const checkpoint = archiveAt(checkpointFile)
        assertOnlyRepair(checkpoint.project, original.project, true)
        expect(resourceManifest(checkpoint.resources)).toEqual(resourceManifest(original.resources))
      }
    }
    // No direct author edits or save/export fallback in this driver. The model's
    // own domain operations must establish the file and document state.
    const saved = await waitSaved(page, view.documentId), archive = archiveAt(file)
    facts.authorDiffs = assertOnlyRepair(archive.project, original.project, repaired)
    assertOnlyRepair(saved.model.project, original.project, repaired)
    expect(saved.model.project).toEqual(archive.project)
    expect(resourceManifest(archive.resources)).toEqual(resourceManifest(original.resources))
    const savedHash = sha256(readFileSync(file))
    const deliveredOfflineHash = repaired ? fingerprintFile(offlineFile).sha256 : undefined
    facts.saved = { revision: saved.revision, dirty: saved.dirty, saving: saved.saving, archiveSha256: savedHash }
    await setEditorMode(page, '试运行')
    if (repaired) await exerciseMarket(page, directory, '02-live-T3', cases)
    else {
      await revealDashboard(page)
      await verifyScenario(page, await marketFrames(page), 1200, 100, 28, '02-preflight-unchanged', directory, cases)
    }
    const afterInteractions = await waitSaved(page, view.documentId)
    expect(afterInteractions.model.project).toEqual(saved.model.project)
    expect(sha256(readFileSync(file))).toBe(savedHash)
    expect(pageErrors).toEqual([])
    await bounded(revoke(), 10_000, 'The experiment host did not acknowledge shutdown')
    await normalQuit(app); app = undefined; facts.firstNormalQuit = true

    view = await launch(join(directory, 'profile-cold'), workspace, observeRuntime('cold-profile'))
    app = view.app; page = view.page
    const reopened = await read(page, view.documentId)
    facts.coldOpened = { revision: reopened.revision, dirty: reopened.dirty, undoDepth: reopened.undoDepth,
      redoDepth: reopened.redoDepth, archiveSha256: sha256(readFileSync(file)) }
    expect(reopened).toMatchObject({ dirty: false, undoDepth: 0, redoDepth: 0, revision: saved.revision })
    assertOnlyRepair(reopened.model.project, original.project, repaired)
    expect(reopened.model.project).toEqual(saved.model.project)
    await setEditorMode(page, '试运行')
    if (repaired) await exerciseMarket(page, directory, '03-cold-T3', cases)
    else {
      await revealDashboard(page)
      await verifyScenario(page, await marketFrames(page), 1200, 100, 28, '03-cold-preflight', directory, cases)
    }
    expect((await waitSaved(page, view.documentId)).model.project).toEqual(saved.model.project)
    expect(sha256(readFileSync(file))).toBe(savedHash)
    expect(pageErrors).toEqual([])
    facts.coldReopen = { revision: reopened.revision, dirty: reopened.dirty, undoDepth: reopened.undoDepth }
    await normalQuit(app); app = undefined; facts.secondNormalQuit = true

    if (repaired) {
      browser = await chromium.launch({ headless: true })
      context = await browser.newContext({ viewport: { width: 1440, height: 1080 } })
      await blockOfflineServiceWorkers(context)
      await context.route(/^https?:\/\//, async route => {
        networkAttempts.push({ url: route.request().url(), method: route.request().method(), resourceType: route.request().resourceType() })
        await route.abort('blockedbyclient')
      })
      offlinePage = await context.newPage()
      offlinePage.on('pageerror', error => offlineErrors.push(String(error)))
      await offlinePage.goto(pathToFileURL(offlineFile).href, { waitUntil: 'load' })
      await exerciseMarket(offlinePage, directory, '04-offline-T3', cases)
      const back = offlinePage.getByText('← 回到雨后市集', { exact: true }).first()
      if (await back.isVisible()) {
        await clickReal(offlinePage, back)
        await expect(offlinePage.getByText('雨后周末市集', { exact: true }).first()).toBeVisible()
        await offlinePage.screenshot({ path: join(directory, '05-offline-cover-preserved.png'), fullPage: true })
      }
      expect(offlineErrors).toEqual([])
      expect(networkAttempts).toEqual([])
      expect(sha256(readFileSync(file))).toBe(savedHash)
      expect(fingerprintFile(offlineFile).sha256).toBe(deliveredOfflineHash)
      facts.offline = { file: offlineFile, sha256: sha256(readFileSync(offlineFile)), httpRequestsBlockedAndRecorded: true,
        networkAttempts: networkAttempts.length, pageErrors: offlineErrors.length }
      await context.close(); context = undefined
      await browser.close(); browser = undefined
    }
    expect(sha256(readFileSync(originalFile))).toBe(originalHash)
    facts.originalUnchanged = true
    const preservation = preservationState(preservedFiles)
    expect(preservation.every(file => file.unchanged), 'Original pre-T3 and paid evidence/artifacts must remain byte-identical').toBe(true)
    facts.preservedFiles = preservation
    facts.result = verifyOnly ? 'existing-T3-delivery-ui-cold-reopen-offline-automated-pass-no-model-awaiting-image-review'
      : runModels ? 'T3-repair-ui-cold-reopen-offline-automated-pass-awaiting-image-review' : 'preflight-and-original-state-pass-no-model-no-export'
  } catch (error) {
    facts.result = 'fail'; facts.error = diagnostic(String(error))
    for (const [label, surface] of [['electron', page], ['offline', offlinePage]] as const) {
      if (surface && !surface.isClosed()) {
        await surface.screenshot({ path: join(directory, `failure-${label}.png`), fullPage: true }).catch(() => undefined)
        writeFileSync(join(directory, `failure-${label}-dom.html`), await surface.content().catch(() => 'DOM unavailable'))
        const frames = await bounded(frameInventory(surface), 8_000, 'Failure frame inventory timed out')
          .catch(error => ({ error: diagnostic(String(error)) }))
        writeFileSync(join(directory, `failure-${label}-frames.json`), JSON.stringify(frames, null, 2))
        facts[`failureFrames-${label}`] = frames
      }
    }
    throw error
  } finally {
    await bounded(revoke(), 10_000, 'Final host revocation remained unconfirmed').catch(error => { facts.revokeError = diagnostic(String(error)) })
    if (child && child.exitCode === null) child.kill('SIGTERM')
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app?.close().catch(() => undefined)
    const preservation = preservationState(preservedFiles)
    facts.originalUnchanged = preservation[0]?.unchanged === true
    facts.preservedFiles = preservation
    if (preservation.some(file => !file.unchanged)) {
      facts.result = 'fail'; facts.preservationError = 'An original source artifact or evidence file changed during verification'
    }
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('External agent real-market T3 repair facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    expect(preservation.every(file => file.unchanged), 'Preserve original pre-T3 and paid artifacts/evidence through cleanup').toBe(true)
  }
})
