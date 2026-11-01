// Observe the existing public recovery gate. No send, profile edit, navigation, or artifact operation.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { atomicJson, bounded, cleanupStage, closeOwnedApp, errorSummary, observeCleanup } from './builtin-moon-cleanup-recovery-20261101.mjs'

export async function observeReadOperation(report, persist, name, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90000, originalBudgetMs = options.originalBudgetMs ?? 8000
  const heartbeatMs = options.heartbeatMs ?? 2000, started = Date.now()
  const step = { name, status: 'running', startedAt: new Date(started).toISOString(), elapsedMs: 0, originalBudgetMs, timeoutMs, invocationCount: 0 }
  report.reads ??= []; report.reads.push(step); report.currentStage = name
  await persist() // Node owns this checkpoint; a stalled renderer cannot swallow it.
  let settled = false, result, failure, failed = false
  step.invocationCount = 1
  const pending = Promise.resolve().then(operation).then(value => { result = value; settled = true }, error => { failure = error; failed = true; settled = true })
  try {
    while (!settled && Date.now() - started < timeoutMs) {
      let timer
      try { await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, Math.min(heartbeatMs, timeoutMs - (Date.now() - started))) })]) }
      finally { clearTimeout(timer) }
      step.elapsedMs = Date.now() - started
      if (!settled) step.status = step.elapsedMs >= originalBudgetMs ? 'waiting-on-original-read-past-eight-seconds' : 'running'
      await persist()
    }
    if (!settled) throw Object.assign(new Error(`${name} remained unresolved after ${timeoutMs} ms; this single public read was not repeated.`), { code: 'diagnostic_read_timeout' })
    if (failed) throw failure
    step.status = 'completed'; step.result = result
    return result
  } catch (error) { step.status = 'failed'; step.error = errorSummary(error); throw error }
  finally { step.elapsedMs = Date.now() - started; step.finishedAt = new Date().toISOString(); await persist() }
}

async function main() {
  assert(process.argv[2] && process.argv[3], 'Pass the original continuation config and a fresh diagnostic output directory.')
  const root = process.cwd(), configPath = path.resolve(process.argv[2]), out = path.resolve(process.argv[3])
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')), target = config.continuation
  assert(target?.workspace && target.workspaceId && target.conversationId && target.previousRunId)
  assert(config.originalProfile && path.isAbsolute(config.originalProfile))
  await fs.mkdir(out, { recursive: true })
  assert.equal((await fs.readdir(out)).length, 0, 'Keep every prior probe and failed consumer result; use a fresh diagnostic directory.')
  const lock = await fs.open(path.join(out, 'probe.lock'), 'wx'); await lock.writeFile(String(process.pid)); await lock.sync()
  const report = { kind: 'public-continuation-readiness-observation', status: 'starting', startedAt: new Date().toISOString(),
    configPath, collectorPid: process.pid, modelSendInvocations: 0, profileWriteInvocations: 0, workspaceNavigationInvocations: 0,
    artifactWriteInvocations: 0, originalConsumerResultUnchanged: true, reads: [], cleanup: {} }
  const persist = () => atomicJson(out, 'diagnostic.json', report)
  let app, page
  await persist()
  try {
    const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    report.currentStage = 'launch-owned-observer-app'; await persist()
    const { _electron: electron } = await import('@playwright/test')
    app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), cwd: root,
      args: ['.', `--user-data-dir=${config.originalProfile}`], env, timeout: 45000 })
    report.ownedAppPid = app.process().pid; await persist()
    page = await bounded('Open readiness observer window', () => app.firstWindow(), 20000)
    await page.waitForFunction(() => window.desktopAPI?.execution, undefined, { timeout: 20000 })
    await observeCleanup(page, report, persist, 'before-public-reads')
    const read = (name, operation) => observeReadOperation(report, persist, name, operation)
    // The existing id avoids a new workspace-root authorization. It preserves the public bootstrap path.
    await read('conversations-bootstrap', () => page.evaluate(async input => {
      const conversations = await window.desktopAPI.execution.conversations(input.workspaceId)
      const current = conversations.find(item => item.conversationId === input.conversationId)
      return { requestedWorkspaceId: input.workspaceId, conversationCount: conversations.length,
        target: current ? { workspaceId: current.workspaceId, conversationId: current.conversationId, revision: current.revision,
          hasDraft: Boolean(current.inputDraft), lastRunId: current.runIndex.builtinRunIds.at(-1) } : null }
    }, target))
    await read('submissions', () => page.evaluate(async input => {
      const records = await window.desktopAPI.execution.submissions({ workspaceId: input.workspaceId, conversationId: input.conversationId })
      return { count: records.length, records: records.map(item => ({ submissionId: item.submissionId, state: item.state, runId: item.runId })) }
    }, target))
    await read('run', () => page.evaluate(async input => {
      const run = await window.desktopAPI.execution.run(input.previousRunId)
      return run ? { runId: run.runId, conversationId: run.input.conversationId, status: run.status, version: run.version,
        requestCount: run.requests.length, toolCount: run.tools.length, createdAt: run.createdAt, updatedAt: run.updatedAt } : null
    }, target))
    await read('acp-status', () => page.evaluate(async input => {
      const state = await window.desktopAPI.execution.acp({ action: 'status', workspaceId: input.workspaceId, conversationId: input.conversationId })
      return { selectedAgentId: state.snapshot.selectedAgentId, phase: state.snapshot.phase, agentCount: state.snapshot.agents.length }
    }, target))
    report.status = 'all-public-reads-completed'; await persist()
  } catch (error) { report.status = 'public-read-observation-incomplete'; report.error = errorSummary(error); await persist() }
  finally {
    if (page) await observeCleanup(page, report, persist, 'after-public-reads-before-close')
    const closed = await cleanupStage(report, persist, 'app', () => closeOwnedApp(app, async phase => {
      report.cleanup.appClosePhase = phase; await persist()
      if (page && phase !== 'graceful-app-close') await observeCleanup(page, report, persist, phase)
    }))
    report.cleanup.appClosed = closed?.closed === true
    await lock.close(); await fs.rm(path.join(out, 'probe.lock'), { force: true })
    report.finishedAt = new Date().toISOString(); await persist()
    const code = report.status === 'all-public-reads-completed' && report.cleanup.appClosed ? 0 : 1
    console.log(JSON.stringify({ status: report.status, diagnostic: path.join(out, 'diagnostic.json'), modelSendInvocations: 0,
      reads: report.reads.map(step => ({ name: step.name, status: step.status, elapsedMs: step.elapsedMs, invocationCount: step.invocationCount, error: step.error })),
      appClosed: report.cleanup.appClosed }))
    process.exitCode = code; setTimeout(() => process.exit(code), 1500).unref()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
