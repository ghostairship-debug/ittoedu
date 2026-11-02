import { _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { atomicJson, bounded, canonical, cleanupStage, closeOwnedApp, chooseWorkspaceBounded, errorSummary, observeCleanup, restoreRoles, restoreWorkspace } from './builtin-moon-cleanup-recovery-20261101.mjs'
import { findContinuationSubmission, prepareContinuationFiles, selectContinuation, verifyProtectedFiles } from './builtin-moon-continuation-20261101.mjs'

// Real normal-App consumer: UI send, existing OAuth owner, public IPC reads.
// It never supplies author code, mocks a provider, or completes the AI's work.
const root = process.cwd(), config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const continuation = config.continuation
const out = path.resolve(config.out), workspace = continuation ? path.resolve(continuation.workspace) : path.join(out, 'workspace')
const model = 'gpt-6.1-terra', parameters = { reasoning: { effort: 'xhigh' } }
const terminal = new Set(['completed', 'failed', 'stopped', 'partial', 'interrupted'])
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const stable = canonical
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const write = (name, value) => atomicJson(out, name, value)

await fs.mkdir(out, { recursive: true })
assert.equal((await fs.readdir(out)).length, 0, 'Use a new output directory; never replay an existing attempt.')
await fs.copyFile(path.join(root, 'dist-electron/main/build-info.json'), path.join(out, 'build-info.json'))
if (continuation) {
  assert((await fs.stat(workspace)).isDirectory(), 'The original workspace must already exist.')
  assert(typeof continuation.prompt === 'string' && continuation.prompt.trim(), 'A single explicit continuation request is required.')
  for (const field of ['workspaceId', 'conversationId', 'previousRunId']) assert(continuation[field], `continuation.${field} is required.`)
} else await fs.mkdir(workspace)
const lock = await fs.open(path.join(out, 'consumer.lock'), 'wx'); await lock.writeFile(String(process.pid))
const brief = JSON.parse(await fs.readFile(path.resolve(config.briefFile), 'utf8')).commonBrief
const prompt = continuation?.prompt ?? `请在当前空白工作空间中独立创作一份精美、可深度编辑的《${brief.title}》，面向${brief.audience}。\n内容要求：${brief.content.join('；')}。\n交互要求：${brief.interaction.join('；')}。\n验收：${brief.acceptance.join('；')}。\n请使用果铃现有内置创作指引并自主决定设计、布局与实现。普通标题和解释须可单独编辑，交互保留局部源码编辑入口，不能把整份作品封成一个大Web对象。只有可独立交付且能减少主链等待的单元才使用果铃原生子任务；短小或强依赖工作直接完成，主任务负责集成，不用外部CLI Agent。最终保存可继续编辑的GLX，并导出同版本断网可运行的单HTML到当前工作空间。请自己实际观察、核对主路径并完成必要修正。不要寻找或复制之前同题作品。长期保护要求：任何后续改写或Agent交接都必须保留教学假设说明，不得把这个模型改称真实工程预测。科学依据：${brief.source}。`
await fs.writeFile(path.join(out, 'prompt.txt'), prompt)
await write('brief.json', { commonBrief: brief, route: continuation ? 'C-normal-App-built-in-AI-continuation' : 'C-normal-App-built-in-AI', originalBaseline: config.briefFile, receivedPromptAt: null, qualityStatus: 'not-reviewed', learningEffect: continuation ? 'Continuation of an existing completed candidate; not a fresh creation-speed comparison.' : 'Fresh task and frozen common acceptance; compare only candidates that meet the same gates.' })
let app, page, workspaceId, conversationId, runId, priorWorkspace, oldRoles, temporaryRoles, changedProfile = false, finalRun, interrupted = false, profileRestoreRecord, workspaceChangePending = false, continuationBaseline, preservation
const childRuns = new Map()
const report = { status: 'preparing', startedAt: new Date().toISOString(), source: 'current-production-build/normal-App/UI-send', mode: continuation ? 'continuation' : 'creation', model, parameters, budgetMs: config.budgetMs ?? 600000, cleanup: {}, qualityStatus: 'not-reviewed', uiSendAttempts: 0 }
process.once('SIGTERM', () => { interrupted = true }); process.once('SIGINT', () => { interrupted = true })
async function safeRun(id) {
  return bounded('Read the public run without resending', () => page.evaluate(async id => {
    const run = await window.desktopAPI.execution.run(id)
    if (!run) return null
    const selection = run.input.selection
    const safe = text => {
      let result = typeof text === 'string' ? text : ''
      for (const secret of [selection.connection.id, selection.connection.accountId, selection.connection.auth.credentialRef])
        if (secret) result = result.split(secret).join('[connection-identity-omitted]')
      return result
    }
    return { runId: run.runId, conversationId: run.input.conversationId, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt,
      model: selection.model, parameters: selection.parameters, permission: run.input.permission, workspaceRoot: run.input.workspaceRoot,
      failure: run.failure ? { code: run.failure.code, outcome: run.failure.outcome } : null,
      requests: run.requests.map(r => ({ requestId: r.requestId, state: r.state, actualModel: r.actualModel ?? null,
        finishReason: r.finishReason ?? null, timing: r.timing ?? null, usage: r.usage ?? null,
        inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null,
        failure: r.failure ? { kind: r.failure.kind, code: r.failure.code, httpStatus: r.failure.httpStatus } : null })),
      tools: run.tools.map(t => ({ callId: t.callId, requestId: t.requestId, name: t.call.name, state: t.state, receiptTime: t.receiptTime ?? null,
        resultKind: t.result?.kind ?? null, errorCode: t.result?.kind === 'error' ? t.result.code : null,
        path: t.call.input?.path ?? null, skill: t.call.input?.skill ?? null,
        ...(t.call.name === 'project.apply' ? { intent: t.call.input?.intent ?? null, from: t.call.input?.from ?? null,
          usesContent: typeof t.call.input?.content === 'string', commit: t.result?.kind === 'read' ? t.result.data?.commit ?? null : null } : {}),
        result: ['file.create', 'file.save', 'document.export', 'delegate.start', 'delegate.agent', 'delegate.resume'].includes(t.call.name) ? t.result : undefined })),
      finalText: safe(run.messages.filter(m => m.role === 'assistant' && !m.tool_calls?.length).map(m => typeof m.content === 'string' ? m.content : '').filter(Boolean).at(-1) ?? '') }
  }, id))
}
const chooseWorkspace = directory => chooseWorkspaceBounded(app, page, directory, 15000)
async function persistCandidate(run) {
  report.terminalObservedAt ??= new Date().toISOString()
  report.elapsedMs = Date.parse(report.terminalObservedAt) - report.sendStartedAt
  report.status = run.status === 'completed' ? 'candidate-awaiting-independent-acceptance' : 'candidate-incomplete'
  report.collectorStatus = 'collecting-candidate-evidence'
  report.publicRunStatus = run.status; report.actualModel = run.model
  report.runId = runId; report.conversationId = conversationId; report.workspaceId = workspaceId
  report.requests = run.requests.length; report.tools = run.tools.length
  report.childRequests = [...childRuns.values()].reduce((n, child) => n + child.requests.length, 0)
  report.childCount = childRuns.size
  // This is a candidate receipt, not a quality pass. Persist it before screenshots or cleanup can hang.
  await write('result.json', report)
}

try {
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }; delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), cwd: root,
    args: ['.', `--user-data-dir=${config.originalProfile}`], env, timeout: 45000 })
  page = await bounded('Open consumer app window', () => app.firstWindow(), 20000); await page.waitForFunction(() => window.desktopAPI?.execution && window.desktopAPI?.executionSettings, undefined, { timeout: 30000 })
  await page.getByLabel('切换工作空间', { exact: true }).waitFor({ state: 'visible', timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1050))
  priorWorkspace = await page.getByLabel('切换工作空间', { exact: true }).getAttribute('title')
  const priorAttemptChecks = []
  for (const directory of config.reconcileEmptyWorkspaces ?? []) {
    const started = Date.now()
    const checked = await bounded('Reconcile prior uncertain UI click without replaying', () => page.evaluate(async root => {
      const current = await window.desktopAPI.execution.workspace(root)
      const conversations = []
      for (const c of current.conversations) {
        const submissions = await window.desktopAPI.execution.submissions({ workspaceId: current.workspace.workspaceId, conversationId: c.conversationId })
        conversations.push({ conversationId: c.conversationId, builtinRunIds: c.runIndex?.builtinRunIds ?? [], acpRunIds: c.runIndex?.acpRunIds ?? [],
          submissions: submissions.map(s => ({ submissionId: s.submissionId, state: s.state, runId: s.runId, createdAt: s.createdAt })) })
      }
      return { workspaceId: current.workspace.workspaceId, conversations }
    }, path.resolve(directory)), 180000)
    priorAttemptChecks.push({ directory, ...checked, elapsedMs: Date.now() - started, checkedAt: new Date().toISOString() })
    await write('prior-attempt-reconcile.json', priorAttemptChecks)
    assert(checked.conversations.every(c => !c.builtinRunIds.length && !c.acpRunIds.length && !c.submissions.length),
      'Prior attempt has a public submission or run; inspect it before any fresh task is sent.')
  }
  report.initialOwnerReadyMs = Date.now() - Date.parse(report.startedAt)
  const view = await page.evaluate(() => window.desktopAPI.executionSettings.read())
  const selected = view.profile.roles.conversation
  const connection = selected && view.connections.find(c => c.connection.id === selected.connectionId)
  assert(connection?.hasCredential && !connection.revoked && connection.connection.protocol === 'chatgpt-responses', 'Existing ChatGPT connection is unavailable.')
  oldRoles = view.profile.roles
  temporaryRoles = { ...oldRoles, conversation: { connectionId: connection.connection.id, model, parameters } }
  profileRestoreRecord = stable(oldRoles) === stable(temporaryRoles) ? null
    : { originalRoles: oldRoles, temporaryRoles, expectedRevision: view.profile.revision }
  // Save both restoration intents before an IPC write whose acknowledgement may be lost.
  if (profileRestoreRecord) await write('profile-restore.json', profileRestoreRecord)
  await write('recovery.json', { originalWorkspace: priorWorkspace, workspace, changedProfile: false,
    profileChange: profileRestoreRecord ? 'pending' : 'not-needed', model,
    next: 'Read result/progress and the public run; never submit again. Use the one-shot cleanup recovery if this collector is gone.' })
  if (profileRestoreRecord) {
    await page.evaluate(input => window.desktopAPI.executionSettings.saveProfile(input), { expectedRevision: view.profile.revision, roles: temporaryRoles })
    changedProfile = true
    await write('recovery.json', { originalWorkspace: priorWorkspace, workspace, changedProfile, profileChange: 'applied', model,
      next: 'Read result/progress and the public run; never submit again. Use the one-shot cleanup recovery if this collector is gone.' })
  }
  workspaceChangePending = true
  await chooseWorkspace(workspace)
  const space = await page.evaluate(directory => window.desktopAPI.execution.workspace(directory), workspace)
  workspaceId = space.workspace.workspaceId
  if (continuation) {
    const readiness = { kind: 'continuation-owner-readiness', startedAt: new Date().toISOString(), reads: [] }
    report.readinessPath = path.join(out, 'continuation-readiness.json'); await write('result.json', report)
    continuationBaseline = await selectContinuation(page, continuation, { report: readiness,
      persist: () => write('continuation-readiness.json', readiness) })
    conversationId = continuation.conversationId
    report.continuation = { workspaceId, conversationId, previousRunId: continuation.previousRunId,
      sourceGlx: continuation.sourceGlx, sourceRevision: continuation.sourceRevision,
      newGlx: continuation.newGlx, newHtml: continuation.newHtml }
    await write('continuation-preflight.json', continuationBaseline)
    preservation = await prepareContinuationFiles(continuation, out)
    await write('preservation.json', preservation)
    const checked = await verifyProtectedFiles(preservation)
    assert(checked.unchanged, 'Protected files changed while preparing the continuation; no message was sent.')
  }
  await page.getByRole('textbox', { name: '给果铃AI发消息', exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('textbox', { name: '给果铃AI发消息', exact: true }).fill(prompt)
  const readyStart = Date.now(), sendButton = page.getByRole('button', { name: '发送', exact: true })
  while (!await sendButton.isEnabled()) {
    await write('send-readiness.json', { at: new Date().toISOString(), elapsedMs: Date.now() - readyStart, status: 'waiting-for-enabled-formal-ui', uiSendAttempts: 0 })
    assert(Date.now() - readyStart < 180000, 'Formal UI did not become ready; no send intent has been recorded.')
    await pause(1000)
  }
  report.sendReadyWaitMs = Date.now() - readyStart
  await write('send-readiness.json', { at: new Date().toISOString(), elapsedMs: report.sendReadyWaitMs, status: 'formal-ui-enabled', uiSendAttempts: 0 })
  await bounded('Capture before the one-shot send', () => page.screenshot({ path: path.join(out, 'before-send.png'), timeout: 8000 }), 10000)
  report.sendStartedAt = Date.now(); report.status = 'running'
  const sendIntent = await fs.open(path.join(out, 'send-intent.json'), 'wx')
  try {
    await sendIntent.writeFile(JSON.stringify({ at: new Date().toISOString(), workspaceId, conversationId,
      previousRunId: continuation?.previousRunId, promptSha256: hash(prompt), uiSendAttempts: 1,
      next: 'Read the public submission/run. Never click send again for this attempt.' }, null, 2))
    await sendIntent.sync()
  } finally { await sendIntent.close() }
  report.uiSendAttempts = 1; report.sendState = 'attempting-single-ui-click'; await write('result.json', report)
  try { await page.getByRole('button', { name: '发送', exact: true }).click({ timeout: 15000 }); report.sendState = 'clicked-awaiting-public-receipt' }
  catch (error) { report.sendState = 'click-receipt-uncertain'; report.sendError = errorSummary(error) }
  await write('result.json', report)
  const deadline = report.sendStartedAt + report.budgetMs
  while (Date.now() < deadline && !interrupted) {
    if (!runId) {
      if (continuation) {
        const submission = await findContinuationSubmission(page, continuation, continuationBaseline, prompt, report.sendStartedAt)
        if (submission) {
          report.submission = submission; await write('submission.json', submission)
          assert(!['failed', 'cancelled'].includes(submission.state), 'The single continuation submission failed; its record is preserved and will not be replayed.')
          if (submission.runId) {
            const observed = await safeRun(submission.runId)
            assert.equal(observed?.conversationId, conversationId, 'The new run belongs to another conversation.')
            runId = submission.runId
          }
        }
      } else {
        const current = await page.evaluate(directory => window.desktopAPI.execution.workspace(directory), workspace)
        for (const c of current.conversations) {
          const candidate = c.runIndex?.builtinRunIds?.at(-1)
          if (candidate) { const run = await safeRun(candidate); if (run?.createdAt >= report.sendStartedAt - 1000) { runId = candidate; conversationId = c.conversationId; break } }
        }
      }
      if (!runId && Date.now() - report.sendStartedAt > 30000) throw new Error('UI send has no public built-in run after 30 seconds; inspect screenshot and submissions before retrying.')
    }
    if (runId) {
      finalRun = await safeRun(runId)
      await write('run-safe.json', finalRun)
      if (finalRun && terminal.has(finalRun.status)) await persistCandidate(finalRun)
      const allChildren = await page.evaluate(input => window.desktopAPI.execution.delegationChildren?.(input) ?? [], { workspaceId, conversationId })
      const children = continuation ? allChildren.filter(child => child.parentRunId === runId) : allChildren
      await write('children.json', children.map(({ parentRunId, jobId, childRunId, status, terminal, role, reason, summary, artifacts }) => ({ parentRunId, jobId, childRunId, status, terminal, role, reason, summary, artifacts })))
      for (const child of children) if (child.childRunId && !terminal.has(childRuns.get(child.childRunId)?.status)) {
        const snapshot = await safeRun(child.childRunId)
        if (snapshot) { childRuns.set(child.childRunId, snapshot); await write(`child-${child.childRunId}.json`, snapshot) }
      }
      await write('progress.json', { at: new Date().toISOString(), runId, conversationId, workspaceId, status: finalRun?.status,
        elapsedMs: Date.now() - report.sendStartedAt, requests: finalRun?.requests.length ?? 0, tools: finalRun?.tools.length ?? 0,
        children: children.map(c => ({ jobId: c.jobId, state: c.state, status: c.status })), next: 'Wait/read this run; do not submit again.' })
      if (finalRun && terminal.has(finalRun.status)) break
    }
    await pause(1800)
  }
  report.elapsedMs ??= Date.now() - report.sendStartedAt
  if (!finalRun || !terminal.has(finalRun.status)) throw new Error('Bounded creation attempt ended before a terminal result.')
  await persistCandidate(finalRun)
  assert.equal(finalRun.model, model)
  report.files = []
  const files = continuation ? [continuation.newGlx, continuation.newHtml]
    : (await fs.readdir(workspace, { withFileTypes: true })).filter(item => item.isFile() && /\.(glx|html)$/i.test(item.name)).map(item => path.join(workspace, item.name))
  for (const filename of files) {
    const bytes = await fs.readFile(filename); report.files.push({ path: filename, bytes: bytes.length, sha256: hash(bytes) })
  }
  if (continuation) assert.notEqual(report.files[0].sha256, preservation.workingCopy.sha256, 'The continuation did not change its working GLX copy.')
  await write('result.json', report)
  await bounded('Capture completed candidate', () => page.screenshot({ path: path.join(out, 'after-run.png'), timeout: 8000 }), 10000)
  report.collectorStatus = 'completed'; await write('result.json', report)
} catch (error) {
  if (!finalRun || !terminal.has(finalRun.status)) report.status = 'blocked'
  else if (finalRun.model !== model) report.status = 'candidate-model-mismatch'
  report.collectorStatus = 'failed'; report.error = errorSummary(error)
  await write('result.json', report)
  if (page) await bounded('Capture collector failure', () => page.screenshot({ path: path.join(out, 'failure.png'), timeout: 4000 }), 5000).catch(() => {})
} finally {
  const persist = () => write('result.json', report)
  await persist()
  if (page) await observeCleanup(page, report, persist, 'before-restoration')
  if (page && runId && !terminal.has(finalRun?.status)) {
    const stopped = await cleanupStage(report, persist, 'stop-own-run', () => bounded('Stop only the consumer run',
      () => page.evaluate(id => window.desktopAPI.execution.stop(id), runId), 10000))
    report.cleanup.ownRunStopped = terminal.has(stopped?.status)
  }
  if (page && profileRestoreRecord) {
    const restored = await cleanupStage(report, persist, 'profile', () => restoreRoles(page, profileRestoreRecord))
    report.cleanup.profileRestored = restored?.restored === true
  } else report.cleanup.profileRestored = !profileRestoreRecord && !changedProfile
  await persist()
  if (page && workspaceChangePending) {
    const restored = await cleanupStage(report, persist, 'workspace', () => restoreWorkspace(app, page, { originalWorkspace: priorWorkspace, workspace }))
    report.cleanup.workspaceRestored = restored?.restored === true
  } else report.cleanup.workspaceRestored = !workspaceChangePending
  await persist()
  if (page) await observeCleanup(page, report, persist, 'before-owned-app-close')
  const closed = await cleanupStage(report, persist, 'app', () => closeOwnedApp(app, async phase => {
    report.cleanup.appClosePhase = phase; await persist()
    if (page && phase !== 'graceful-app-close') await observeCleanup(page, report, persist, phase)
  }))
  report.cleanup.appClosed = closed?.closed === true
  if (preservation) {
    const protectedResult = await cleanupStage(report, persist, 'protected-artifacts', () => bounded('Verify original and human artifacts after app close', () => verifyProtectedFiles(preservation)))
    report.cleanup.protectedFilesUnchanged = protectedResult?.unchanged === true
  }
  await cleanupStage(report, persist, 'collector-lock', () => bounded('Release owned collector lock', async () => {
    await lock.close(); await fs.rm(path.join(out, 'consumer.lock'), { force: true }); return { released: true }
  }, 3000))
  report.cleanup.currentStage = 'finished'
  report.cleanup.recoveryNeeded = !report.cleanup.profileRestored || !report.cleanup.workspaceRestored || !report.cleanup.appClosed || report.cleanup.protectedFilesUnchanged === false
  report.finishedAt = new Date().toISOString(); await persist()
  console.log(JSON.stringify(report))
  const code = report.status === 'candidate-awaiting-independent-acceptance' && report.collectorStatus === 'completed'
    && !report.cleanup.recoveryNeeded ? 0 : 1
  process.exitCode = code
  setTimeout(() => process.exit(code), 1500).unref()
}

