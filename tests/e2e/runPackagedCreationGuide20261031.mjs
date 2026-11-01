/** Real installed-App, read-only built-in AI consumer. Root runs this explicitly, never alongside another profile consumer.
 * Usage: node tests/e2e/runPackagedCreationGuide20261031.mjs absolute-config.json
 * Config: { executable, originalProfile, out, w3ProducerResult, budgetMs?: 180000 }.
 * No private stores, credential copies, custom Provider, network hooks, or request-header overrides. */
import { _electron as electron } from '@playwright/test'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { verifyGuideRequestEvidence } from './packagedGuideRequestEvidence20261031.mjs'

const VERSION = 'packaged-creation-guide-20261031-v1'
const MODEL = 'gpt-6.1-terra', PARAMETERS = { reasoning: { effort: 'xhigh' } }
const SKILL = 'orchestrate-courseware'
const GUIDES = ['SKILL.md', 'references/teacher-controller.md', 'references/learning-progress.md']
const MARKERS = {
  'SKILL.md': ['project.apply', '局部', '正式'],
  'references/teacher-controller.md': ['局部增强的最短路径', 'project.apply', 'enhancementPath'],
  'references/learning-progress.md': ['本设备', 'expectedRevision', 'clear(namespace'],
}
const ALLOWED_TOOLS = ['skills.read', 'skills.list', 'tools.load', 'file.read', 'task.note']
const TERMINAL = new Set(['stopped', 'partial', 'completed', 'failed', 'interrupted'])
const sha = value => createHash('sha256').update(value).digest('hex')
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
const stable = value => JSON.stringify((function sort(item) {
  if (Array.isArray(item)) return item.map(sort)
  if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]))
  return item
})(value))
const business = ({ revision: _revision, updatedAt: _updatedAt, ...rest }) => rest
const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { checkCode: code }) }
const safeError = error => ({ check: typeof error?.checkCode === 'string' ? error.checkCode : null,
  code: ['ENOENT', 'EACCES', 'EEXIST', 'ETIMEDOUT'].includes(error?.code) ? error.code : null,
  kind: error?.checkCode ? 'verification' : 'operation-failed-details-omitted' })
const write = (filename, value) => fs.writeFile(filename, JSON.stringify(value, null, 2))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bounded(promise, ms, code) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { checkCode: code })), ms) })]) }
  finally { clearTimeout(timer) }
}
async function fileHash(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
async function settings(page) {
  return page.evaluate(async () => {
    const view = await window.desktopAPI.executionSettings.read()
    const selected = view.profile.roles.conversation
    const item = selected && view.connections.find(value => value.connection.id === selected.connectionId)
    const connection = item?.connection
    // Profile is transient in this runner. Neither it nor connection/account/credential identities are written to evidence.
    return { profile: view.profile, selected: connection ? { id: connection.id, revision: connection.revision,
      provider: connection.provider, protocol: connection.protocol, baseURL: connection.baseURL,
      authKind: connection.auth.kind, hasCredential: item.hasCredential, revoked: Boolean(item.revoked) } : null }
  })
}
async function workspaceLabel(page) {
  const control = page.getByLabel('切换工作空间', { exact: true })
  await control.waitFor({ state: 'visible', timeout: 15000 })
  return control.evaluate(element => ({ text: element.textContent, title: element.getAttribute('title'), label: element.getAttribute('aria-label') }))
}
async function readSafeRun(page, runId, expectedConnectionId, referencePath) {
  return page.evaluate(async input => {
    const run = await window.desktopAPI.execution.run(input.runId)
    if (!run) return null
    const selection = run.input.selection
    const numberFields = (object, keys) => Object.fromEntries(keys.map(key => [key, Number.isFinite(object?.[key]) ? object[key] : null]))
    const redact = text => {
      let safe = typeof text === 'string' ? text : ''
      for (const value of [selection.connection.id, selection.connection.accountId, selection.connection.auth.credentialRef])
        if (typeof value === 'string' && value.length) safe = safe.split(value).join('[connection-identity-omitted]')
      return safe
    }
    const same = (a, b) => String(a).replaceAll('\\', '/').toLowerCase() === String(b).replaceAll('\\', '/').toLowerCase()
    const tools = run.tools.map(tool => {
      const raw = tool.call.input ?? {}, data = tool.result?.kind === 'read' ? tool.result.data : null
      const guide = tool.call.name === 'skills.read' && raw.skill === input.skill && input.guides.includes(raw.path ?? 'SKILL.md')
      const reference = tool.call.name === 'file.read' && same(raw.path, input.referencePath)
      const result = { callId: tool.callId, providerCallId: tool.providerCallId, requestId: tool.requestId,
        name: tool.call.name, state: tool.state, resultKind: tool.result?.kind ?? null,
        errorCode: tool.result?.kind === 'error' ? tool.result.code : null,
        receiptTime: Number.isFinite(tool.receiptTime) ? tool.receiptTime : null,
        expectedRead: guide || reference,
        scopeViolation: !input.allowedTools.includes(tool.call.name)
          || tool.call.name === 'skills.read' && !guide || tool.call.name === 'file.read' && !reference }
      if (guide) result.input = { skill: raw.skill, path: raw.path ?? 'SKILL.md', offset: raw.offset ?? 0, limit: raw.limit ?? null, version: raw.version ?? null }
      if (reference) result.input = { path: raw.path, cursor: raw.cursor ?? null, limit: raw.limit ?? null }
      if ((guide || reference) && data && typeof data === 'object') {
        result.data = guide ? { status: data.status, skill: data.skill, path: data.path, version: data.version,
          content: typeof data.content === 'string' ? data.content : null, truncated: data.truncated, nextOffset: data.nextOffset ?? null }
          : { path: data.path, text: typeof data.text === 'string' ? data.text : null, version: data.version,
            offset: data.offset, total: data.total, truncated: data.truncated, nextCursor: data.nextCursor ?? null, dirty: data.dirty }
        const messageIndex = run.messages.findIndex(message => message.role === 'tool' && message.tool_call_id === tool.providerCallId)
        const message = run.messages[messageIndex]
        result.projectedJournal = message ? { messageIndex, text: typeof message.content === 'string' ? message.content : null } : null
      }
      return result
    })
    return { runId: run.runId, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt,
      permission: run.input.permission, workspaceRoot: run.input.workspaceRoot,
      selection: { model: selection.model, parameters: selection.parameters ?? {}, provider: selection.connection.provider,
        protocol: selection.apiProtocol ?? selection.connection.protocol, sameOriginalConnection: selection.connection.id === input.expectedConnectionId },
      failure: run.failure ? { code: run.failure.code, outcome: run.failure.outcome ?? null } : null,
      requests: run.requests.map(request => ({ requestId: request.requestId, kind: request.kind ?? 'conversation',
        state: request.state, selectedModel: request.selection?.model ?? selection.model, actualModel: request.actualModel ?? null,
        sameOriginalConnection: !request.selection || request.selection.connectionId === input.expectedConnectionId,
        finishReason: request.finishReason ?? null, assistantMessageIndex: request.assistantMessageIndex ?? null,
        firstEventWaitMs: request.firstEventWaitMs ?? null, firstContentWaitMs: request.firstContentWaitMs ?? null,
        timing: { ...numberFields(request.timing, ['preparationStartedAt', 'preparationFinishedAt', 'adapterEnteredAt']),
          provider: numberFields(request.timing?.provider, ['startedAt', 'credentialReadyAt', 'fetchStartedAt', 'headersReceivedAt',
            'firstBodyReadAt', 'firstSseFrameAt', 'firstNormalizedEventAt', 'firstToolNameAt', 'firstReasoningAt', 'firstContentAt', 'terminalEventAt']),
          consumption: numberFields(request.timing?.consumption, ['events', 'totalMs', 'maxMs']) },
        usage: numberFields(request.usage, ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens', 'cacheWriteInputTokens']),
        inputTokens: request.inputTokens ?? null, outputTokens: request.outputTokens ?? null,
        payload: request.payload ? { phase: request.payload.phase, digest: request.payload.digest, serializedBytes: request.payload.serializedBytes } : null,
        failure: request.failure ? { outcome: request.failure.outcome, kind: request.failure.kind, code: request.failure.code, httpStatus: request.failure.httpStatus ?? null } : null })),
      compacted: Boolean(run.compacted), tools,
      finalText: redact(run.messages.filter(message => message.role === 'assistant' && !message.tool_calls?.length)
        .map(message => typeof message.content === 'string' ? message.content : '').filter(Boolean).at(-1) ?? '') }
  }, { runId, expectedConnectionId, referencePath, skill: SKILL, guides: GUIDES, allowedTools: ALLOWED_TOOLS })
}
async function publicToolEvidence(page, conversationId, runId, toolIds) {
  return page.evaluate(async input => {
    const results = [], wanted = new Set(input.toolIds)
    let cursor = 0, hasMore = true
    for (let pages = 0; hasMore && pages < 20; pages++) {
      const page = await window.desktopAPI.execution.events(input.conversationId, cursor, 1000)
      for (const event of page.events) {
        if (event.runId !== input.runId || event.type !== 'tool' || !wanted.has(event.itemId)) continue
        const data = event.data
        if (data.output === undefined && !data.outputRef) continue
        // Public blob only. providerPayloadRef is deliberately never dereferenced.
        const output = data.output ?? await window.desktopAPI.execution.blob(input.conversationId, data.outputRef)
        results.push({ sequence: event.sequence, time: event.time, itemId: event.itemId, requestId: data.requestId ?? null,
          toolName: data.toolName, status: data.status, via: data.outputRef ? 'public-blob' : 'public-inline', output })
      }
      if (page.hasMore && page.cursor <= cursor) throw new Error('public-event-cursor-did-not-advance')
      cursor = page.cursor; hasMore = page.hasMore
    }
    return { records: results, cursor, complete: !hasMore }
  }, { conversationId, runId, toolIds })
}
function assembleRead(tools, guide) {
  const skill = guide !== null
  const reads = tools.filter(tool => tool.expectedRead && tool.resultKind === 'read' && tool.data
    && (skill ? tool.name === 'skills.read' && tool.input.path === guide : tool.name === 'file.read'))
  check(reads.length > 0, skill ? `missing-${path.basename(guide)}` : 'missing-installed-reference-read')
  const versions = new Set(reads.map(tool => tool.data.version)); check(versions.size === 1, 'read-version-mixed')
  const chunks = new Map()
  for (const read of reads) {
    if (skill) check(read.data.status === 'read' && read.data.skill === SKILL && read.data.path === guide, 'guide-read-identity-mismatch')
    const offset = skill ? read.input.offset : read.data.offset
    const content = skill ? read.data.content : read.data.text
    check(Number.isSafeInteger(offset) && offset >= 0 && typeof content === 'string', 'invalid-read-page')
    if (chunks.has(offset)) check(chunks.get(offset).content === content, 'duplicate-read-page-changed')
    chunks.set(offset, { tool: read, content })
  }
  let offset = 0, content = '', ended = false
  const consumed = []
  for (let pages = 0; pages <= chunks.size; pages++) {
    const chunk = chunks.get(offset); check(chunk, 'read-pages-have-gap')
    content += chunk.content; consumed.push(chunk.tool)
    if (chunk.tool.data.truncated === false) { ended = true; break }
    const next = skill ? chunk.tool.data.nextOffset : offset + chunk.content.length
    check(Number.isSafeInteger(next) && next > offset, 'read-pagination-did-not-advance'); offset = next
  }
  check(ended, 'read-did-not-reach-end')
  return { content, version: [...versions][0], consumed }
}

let config, lock, lockPath, app, page, originalProfile, temporaryProfile, runId, identity, safeRunContext, initialWorkspaceLabel, sendAttempted = false
let stage = 'configuration', lastRun = null, roleChangeAttempted = false, expectedTemporaryBusiness, savedTemporaryBusiness, interrupted = false
const interrupt = () => { interrupted = true }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
let report = { version: VERSION, status: 'not-started', modelRequests: 0, cleanup: {} }
try {
  check(process.argv.length === 3, 'expected-one-config-file')
  const supplied = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
  config = { executable: supplied.executable, originalProfile: supplied.originalProfile, out: supplied.out,
    w3ProducerResult: supplied.w3ProducerResult, budgetMs: supplied.budgetMs ?? 180000 }
  for (const key of ['executable', 'originalProfile', 'out', 'w3ProducerResult']) check(typeof config[key] === 'string' && path.isAbsolute(config[key]), `absolute-${key}-required`)
  check(Number.isSafeInteger(config.budgetMs) && config.budgetMs > 0 && config.budgetMs <= 180000, 'budget-over-180-seconds')
  config.originalProfile = await fs.realpath(config.originalProfile); config.executable = await fs.realpath(config.executable)
  await fs.mkdir(config.out, { recursive: true }); config.out = await fs.realpath(config.out)
  check(!inside(config.originalProfile, config.out), 'evidence-must-be-outside-original-profile')
  check(!inside(config.out, config.originalProfile), 'original-profile-must-not-be-inside-evidence')
  check(!(await fs.readdir(config.out)).length, 'output-must-be-new-empty-directory')
  lockPath = path.join(config.out, 'consumer-running.lock'); lock = await fs.open(lockPath, 'wx'); await lock.writeFile(String(process.pid))
  const workspace = path.join(config.out, 'workspace'); await fs.mkdir(workspace)
  const producer = JSON.parse(await fs.readFile(config.w3ProducerResult, 'utf8'))
  const expectedTeacherVersions = [...new Set((producer.consumedGuide?.reads ?? []).map(read => read.version))]
  check(expectedTeacherVersions.length === 1 && /^sha256:[a-f0-9]{64}$/.test(expectedTeacherVersions[0]), 'w3-producer-guide-version-unavailable')
  const expectedTeacherVersion = expectedTeacherVersions[0]
  report = { ...report, startedAt: new Date().toISOString(), budgetMs: config.budgetMs,
    evidenceScope: 'real-packaged-App/public-desktop-API/read-only-built-in-AI', expectedTeacherVersion,
    toolScopeAudit: 'post-call public receipt audit and stop on deviation; host read-only permission is the mutation boundary, no injected dispatch guard',
    originalProfilePolicy: 'original-crypto-owner; no credential copies; public profile CAS only', cleanup: {} }
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'))
  Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0', PATH: 'C:\\Windows\\System32;C:\\Windows' })
  delete env.ELECTRON_RUN_AS_NODE
  stage = 'launch-real-package'
  app = await electron.launch({ executablePath: config.executable, cwd: path.dirname(config.executable),
    args: [`--user-data-dir=${config.originalProfile}`], env, timeout: 45000 })
  const application = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, executable: process.execPath,
    appPath: app.getAppPath(), resourcesPath: process.resourcesPath, userData: app.getPath('userData') }))
  check(application.isPackaged, 'consumer-did-not-launch-a-package')
  check(samePath(await fs.realpath(application.executable), config.executable), 'wrong-packaged-executable')
  check(samePath(await fs.realpath(application.userData), config.originalProfile), 'wrong-original-profile')
  check(samePath(application.appPath, path.join(application.resourcesPath, 'app.asar')), 'package-not-loaded-from-app-asar')
  const asarPath = await fs.realpath(application.appPath)
  const referenceRoot = await fs.realpath(path.join(application.resourcesPath, 'reference-library'))
  const referencePath = await fs.realpath(path.join(referenceRoot, 'creative-reference', 'README.md'))
  check(inside(referenceRoot, referencePath), 'installed-reference-crossed-package-root')
  const referenceBytes = await fs.readFile(referencePath)
  const referenceContent = new TextDecoder('utf-8', { fatal: true }).decode(referenceBytes)
  report.application = { isPackaged: true, executable: config.executable, appPath: application.appPath,
    asarSha256: await fileHash(asarPath), asarBytes: (await fs.stat(asarPath)).size,
    referenceRoot, referencePath, referenceSha256: sha(referenceBytes), originalProfileMatched: true }
  page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.desktopAPI?.executionSettings && window.desktopAPI?.execution), undefined, { timeout: 30000 })
  // desktopAPI is ready before the existing profile's workspace UI restores.
  // Do not freeze the startup placeholder as the user's workspace identity.
  const priorSpaces = await page.evaluate(() => window.desktopAPI.lesson({ operation: 'recent-workspaces' }))
  if (priorSpaces.recent?.length) await page.waitForFunction(() => {
    const control = document.querySelector('[aria-label="切换工作空间"]')
    return control?.getAttribute('title') && control.getAttribute('title') !== '选择工作空间'
  }, undefined, { timeout: 30000 })
  const labelBefore = await workspaceLabel(page)
  initialWorkspaceLabel = labelBefore
  report.activeWorkspace = { checkScope: 'visible switch-workspace control text/title/aria-label only; no private preference-store claim', beforeSha256: sha(stable(labelBefore)) }
  stage = 'public-workspace-authorization'
  const dialogKey = `__packagedGuideDialog_${randomUUID().replaceAll('-', '')}`
  await app.evaluate(({ dialog }, input) => {
    globalThis[input.key] = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.directory] })
  }, { key: dialogKey, directory: workspace })
  try {
    const chosen = await page.evaluate(() => window.desktopAPI.lesson({ operation: 'choose-workspace' }))
    check(!chosen.cancelled && typeof chosen.directory === 'string' && samePath(chosen.directory, workspace), 'public-native-workspace-choice-failed')
  } finally {
    await app.evaluate(({ dialog }, key) => { if (globalThis[key]) { dialog.showOpenDialog = globalThis[key]; delete globalThis[key] } }, dialogKey)
  }
  const space = await page.evaluate(directory => window.desktopAPI.execution.workspace(directory), workspace)
  const conversation = await page.evaluate(workspaceId => window.desktopAPI.execution.createConversation(workspaceId, '安装版创作指引只读验证'), space.workspace.workspaceId)
  identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, submissionId: randomUUID() }
  check(identity.conversationId, 'public-conversation-has-no-identity')
  report.workspace = { directory: workspace, registeredThroughPublicOwner: true, uiSwitchRequested: false, conversationId: identity.conversationId }
  stage = 'temporary-conversation-role'
  check(!interrupted, 'consumer-interrupted-before-profile-change')
  const before = await settings(page); originalProfile = before.profile
  const connection = before.selected
  check(connection?.hasCredential && !connection.revoked && connection.provider === 'openai' && connection.protocol === 'chatgpt-responses'
    && connection.authKind === 'oauth' && connection.baseURL.replace(/\/$/, '') === 'https://chatgpt.com/backend-api/codex', 'original-conversation-oauth-owner-unavailable')
  safeRunContext = { expectedConnectionId: connection.id, referencePath }
  const roles = structuredClone(originalProfile.roles)
  roles.conversation = { connectionId: connection.id, model: MODEL, parameters: PARAMETERS }
  expectedTemporaryBusiness = { ...business(originalProfile), roles }
  roleChangeAttempted = true
  temporaryProfile = await page.evaluate(input => window.desktopAPI.executionSettings.saveProfile(input), { expectedRevision: originalProfile.revision, roles })
  savedTemporaryBusiness = business(temporaryProfile)
  check(stable(business(temporaryProfile)) === stable(expectedTemporaryBusiness), 'temporary-profile-changed-unrequested-fields')
  const prepared = await settings(page)
  check(stable(business(prepared.profile)) === stable(expectedTemporaryBusiness), 'temporary-profile-not-current')
  report.profile = { originalRevision: originalProfile.revision, temporaryRevision: temporaryProfile.revision,
    changedRole: 'conversation', model: MODEL, parameters: PARAMETERS, sameOriginalOAuthConnection: prepared.selected?.id === connection.id,
    otherBusinessFieldsUnchanged: true, originalBusinessSha256: sha(stable(business(originalProfile))) }
  check(report.profile.sameOriginalOAuthConnection, 'temporary-role-switched-connection')
  const prompt = `这是一项只读的安装版指引消费核查，不是创作任务。请只使用当前内置模型和正式工具，不委派、不调用其他模型、不联网、不运行程序、不创建/修改/保存/导出任何文件，也不打开或修改现有作品。实际调用 skills.read，skill="${SKILL}"，依次读取 path="SKILL.md"、"references/teacher-controller.md"、"references/learning-progress.md"，每次 limit=64000；若截断则按回执 version/nextOffset 续读直到完整。只读当前内置同名资料，不用用户或工作区副本。然后用 file.read 实际读取本安装包真实入口 ${referencePath}，limit=64000；如截断沿回执 cursor 续读。必要时仅 tools.load 发现对应正式读取工具。不要顺着资料继续读其他文件或执行其建议。最后用中文最多四条简短说明你刚读到的局部增强最短路径、expectedRevision/CAS 与清档语义、参考采用边界，并说明本次只读；不要声称完成任何创作或功能验收。`
  await fs.writeFile(path.join(config.out, 'prompt.txt'), prompt)
  stage = 'read-only-real-model-run'
  check(!interrupted, 'consumer-interrupted-before-send')
  const started = Date.now(), deadline = started + config.budgetMs
  report.sendStartedAt = started; sendAttempted = true; report.modelRequests = null
  const sent = await bounded(page.evaluate(async input => {
    const view = await window.desktopAPI.executionSettings.read(), roles = {}
    for (const key of ['conversation', 'vision', 'imageGenerate', 'imageEdit', 'compression']) {
      if (key === 'compression' && !Object.hasOwn(view.profile.roles, key)) continue
      const selected = view.profile.roles[key], connection = selected && view.connections.find(item => item.connection.id === selected.connectionId)?.connection
      roles[key] = selected && connection ? { connectionId: connection.id, connectionRevision: connection.revision,
        provider: connection.provider, model: selected.model, billingKind: connection.billing.kind } : null
    }
    const result = await window.desktopAPI.execution.send({ ...input.identity, expectedRevision: input.revision, text: input.prompt,
      documents: [], attachments: [], permission: 'read-only', disclosedSettings: { profileRevision: view.profile.revision, roles } })
    return { runId: result.run?.runId ?? result.submission.runId ?? null, state: result.submission.state }
  }, { identity, revision: conversation.revision, prompt }), Math.max(1, deadline - Date.now()), 'send-budget-exceeded')
  runId = sent.runId
  while (Date.now() < deadline) {
    check(!interrupted, 'consumer-interrupted-during-run')
    if (!runId) {
      const submission = await bounded(page.evaluate(async input => {
        const value = await window.desktopAPI.execution.submission(input)
        return value ? { runId: value.runId ?? null, state: value.state } : null
      }, identity), Math.max(1, deadline - Date.now()), 'submission-budget-exceeded')
      runId = submission?.runId
      check(submission && !['failed', 'cancelled'].includes(submission.state), 'submission-ended-before-run')
    }
    if (runId) {
      lastRun = await bounded(readSafeRun(page, runId, connection.id, referencePath), Math.max(1, deadline - Date.now()), 'run-read-budget-exceeded')
      if (lastRun) {
        check(!lastRun.tools.some(tool => tool.scopeViolation), 'model-attempted-an-out-of-scope-tool')
        if (TERMINAL.has(lastRun.status)) break
      }
    }
    await pause(Math.min(400, Math.max(0, deadline - Date.now())))
  }
  report.runElapsedMs = Date.now() - started
  check(lastRun && TERMINAL.has(lastRun.status) && report.runElapsedMs <= config.budgetMs, 'read-only-run-exceeded-budget')
  check(lastRun.status === 'completed', 'read-only-run-not-completed')
  check(lastRun.permission === 'read-only' && samePath(lastRun.workspaceRoot, workspace), 'frozen-run-scope-mismatch')
  check(lastRun.selection.sameOriginalConnection && lastRun.selection.model === MODEL && stable(lastRun.selection.parameters) === stable(PARAMETERS), 'frozen-model-selection-mismatch')
  const requests = lastRun.requests.filter(request => Number.isFinite(request.timing.provider.fetchStartedAt))
  check(requests.length > 0, 'no-observed-real-model-request')
  check(requests.length === lastRun.requests.length, 'request-fetch-evidence-incomplete')
  report.requestOutcomes = verifyGuideRequestEvidence(requests, MODEL)
  report.modelRequests = requests.length
  report.requestEvidenceScope = 'public run fetchStartedAt, frozen parameters, actualModel, timings and reported usage; no headers or raw provider payload'
  stage = 'verify-real-tool-consumption'
  const reads = {}
  for (const guide of GUIDES) {
    const assembled = assembleRead(lastRun.tools, guide)
    check(assembled.version === `sha256:${sha(`skills/${SKILL}/${guide}${assembled.content}`)}`, 'bundled-guide-content-version-mismatch')
    check(MARKERS[guide].every(marker => assembled.content.includes(marker)), `guide-markers-missing-${path.basename(guide)}`)
    if (guide === 'references/teacher-controller.md') check(assembled.version === expectedTeacherVersion, 'packaged-teacher-version-differs-from-w3-producer')
    reads[guide] = { version: assembled.version, contentSha256: sha(assembled.content), utf8Bytes: Buffer.byteLength(assembled.content),
      markers: MARKERS[guide], callIds: assembled.consumed.map(tool => tool.callId), complete: true }
    await fs.writeFile(path.join(config.out, `consumed-${path.basename(guide)}`), assembled.content)
  }
  const reference = assembleRead(lastRun.tools, null)
  check(reference.consumed.every(tool => samePath(tool.data.path, referencePath) && tool.data.dirty === false), 'reference-read-not-installed-original')
  check(reference.content === referenceContent, 'reference-tool-content-differs-from-installed-file')
  await fs.writeFile(path.join(config.out, 'consumed-creative-reference.md'), reference.content)
  report.consumed = { skills: reads, reference: { path: referencePath, version: reference.version, contentSha256: sha(reference.content),
    complete: true, matchedInstalledFile: true, withinPackagedReferenceRoot: true, callIds: reference.consumed.map(tool => tool.callId) }, teacherVersionMatchesW3Producer: true }
  const expectedReads = lastRun.tools.filter(tool => tool.expectedRead && tool.resultKind === 'read')
  const events = await publicToolEvidence(page, identity.conversationId, runId, expectedReads.map(tool => tool.callId))
  check(events.complete, 'public-tool-event-pagination-incomplete')
  report.deliveryEvidence = expectedReads.map(tool => {
    const matching = events.records.filter(event => event.itemId === tool.callId)
    const content = tool.data.content ?? tool.data.text, markers = tool.name === 'skills.read' ? MARKERS[tool.input.path] : ['创作参考入口', 'file.read']
    const eventMatched = matching.some(event => event.output.includes(tool.data.version) && markers.every(marker => event.output.includes(marker)))
    check(eventMatched, 'public-tool-event-did-not-match-real-read')
    const journal = tool.projectedJournal
    const later = journal ? requests.filter(request => request.requestId !== tool.requestId && Number.isInteger(request.assistantMessageIndex)
      && request.assistantMessageIndex > journal.messageIndex && (!tool.receiptTime || request.timing.provider.fetchStartedAt >= tool.receiptTime)) : []
    check(later.length > 0, 'guide-read-has-no-later-observed-model-request')
    let journalContainsFullContent = false
    if (journal?.text) {
      try { const projected = JSON.parse(journal.text); journalContainsFullContent = projected?.data?.content === content || projected?.data?.text === content } catch { /* Explicitly unknown, never a fabricated payload. */ }
    }
    return { callId: tool.callId, providerCallId: tool.providerCallId, toolName: tool.name,
      publicEventMatched: true, eventSequences: matching.map(event => event.sequence),
      projectedJournalSha256: journal?.text ? sha(journal.text) : null,
      projectedJournalContainsVersion: Boolean(journal?.text?.includes(tool.data.version)),
      projectedJournalMarkers: markers.filter(marker => journal?.text?.includes(marker)), journalContainsFullContent,
      laterActualRequestIds: later.map(request => request.requestId),
      wirePayloadDelivery: 'not-publicly-observable; public journal and later actual request only' }
  })
  await write(path.join(config.out, 'public-tool-events.json'), events)
  await write(path.join(config.out, 'requests.json'), { selection: lastRun.selection, requests: lastRun.requests })
  await write(path.join(config.out, 'tools.json'), lastRun.tools)
  await fs.writeFile(path.join(config.out, 'model-summary.txt'), lastRun.finalText)
  check(lastRun.finalText.trim().length > 0, 'model-did-not-report-read-rules')
  check(!(await fs.readdir(workspace)).length, 'read-only-workspace-was-mutated')
  report.workspace.remainedEmpty = true
  const labelAfter = await workspaceLabel(page)
  report.activeWorkspace.afterSha256 = sha(stable(labelAfter)); report.activeWorkspace.visibleLabelUnchanged = stable(labelBefore) === stable(labelAfter)
  check(report.activeWorkspace.visibleLabelUnchanged, 'visible-active-workspace-changed')
  report.status = 'verified-awaiting-cleanup'
} catch (error) {
  report.status = 'failed'; report.failedStage = stage; report.error = safeError(error)
} finally {
  if (page && identity && sendAttempted && !runId) {
    try { runId = await bounded(page.evaluate(async input => (await window.desktopAPI.execution.submission(input))?.runId ?? null, identity), 5000, 'cleanup-submission-timeout') }
    catch { report.cleanup.submissionLookup = false }
    if (!runId) {
      try { await bounded(page.evaluate(input => window.desktopAPI.execution.deleteSubmission(input), identity), 5000, 'cleanup-submission-cancel-timeout'); report.cleanup.ownPendingSubmissionRemoved = true }
      catch { report.cleanup.ownPendingSubmissionRemoved = false }
    }
  }
  if (page && runId && (!lastRun || !TERMINAL.has(lastRun.status))) {
    try {
      const stopped = await bounded(page.evaluate(async id => {
        const record = await window.desktopAPI.execution.stop(id)
        return record ? { status: record.status } : null
      }, runId), 12000, 'cleanup-stop-timeout')
      report.cleanup.stopRequested = true; report.cleanup.ownRunTerminal = stopped ? TERMINAL.has(stopped.status) : null
    } catch { report.cleanup.stopRequested = false }
  }
  if (page && roleChangeAttempted && originalProfile) {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = (await bounded(settings(page), 12000, 'restore-profile-read-timeout')).profile
        if (stable(business(current)) === stable(business(originalProfile))) {
          report.cleanup.profileRestored = true; report.cleanup.restoredRevision = current.revision
          report.cleanup.otherOriginalBusinessFieldsUnchanged = true
          report.cleanup.restoredBusinessSha256 = sha(stable(business(current))); break
        }
        check(stable(business(current)) === stable(savedTemporaryBusiness ?? expectedTemporaryBusiness), 'profile-concurrent-business-change-refuse-restore')
        try {
          report.cleanup.restoreExpectedRevision = current.revision
          await bounded(page.evaluate(input => window.desktopAPI.executionSettings.saveProfile(input),
            { expectedRevision: current.revision, roles: originalProfile.roles }), 12000, 'restore-profile-save-timeout')
        } catch (error) { if (attempt === 1) throw error; continue }
        const restored = (await bounded(settings(page), 12000, 'restore-profile-verify-timeout')).profile
        check(stable(business(restored)) === stable(business(originalProfile)), 'profile-restoration-did-not-match-original')
        report.cleanup.profileRestored = true; report.cleanup.restoredRevision = restored.revision
        report.cleanup.otherOriginalBusinessFieldsUnchanged = true
        report.cleanup.restoredBusinessSha256 = sha(stable(business(restored))); break
      }
    } catch (error) { report.cleanup.profileRestored = false; report.cleanup.profileError = safeError(error) }
  } else report.cleanup.profileRestored = !roleChangeAttempted
  if (page && runId && safeRunContext) {
    try {
      const refreshed = await bounded(readSafeRun(page, runId, safeRunContext.expectedConnectionId, safeRunContext.referencePath), 8000, 'final-run-evidence-timeout')
      report.cleanup.finalRunRefresh = refreshed !== null
      lastRun = refreshed ?? lastRun
    }
    catch { report.cleanup.finalRunRefresh = false }
  }
  if (page && lastRun && config) {
    const observed = lastRun.requests.filter(request => Number.isFinite(request.timing.provider.fetchStartedAt)).length
    const countComplete = report.cleanup.finalRunRefresh === true && TERMINAL.has(lastRun.status) && lastRun.requests.length === observed
    report.modelRequests = countComplete ? observed : null
    report.modelRequestCounting = countComplete ? 'terminal-public-run-all-fetch-starts-observed' : 'partial-or-unconfirmed-public-run; integer-total-unknown'
    report.observedModelFetches = observed; report.runStatus = lastRun.status
    // Safe whitelist only; never persist the complete run/input selection or raw native response.
    await write(path.join(config.out, 'run-safe.json'), lastRun).catch(() => {})
  } else if (!sendAttempted) report.modelRequests = 0
  if (page && initialWorkspaceLabel) {
    try {
      const finalLabel = await workspaceLabel(page)
      report.cleanup.activeWorkspaceLabelUnchanged = stable(finalLabel) === stable(initialWorkspaceLabel)
      report.activeWorkspace.afterCleanupSha256 = sha(stable(finalLabel))
      await page.screenshot({ path: path.join(config.out, 'packaged-app.png') })
      report.screenshot = { path: 'packaged-app.png', scope: 'normal App after restoration attempt, original visible workspace; no UI workspace switch' }
    } catch { report.cleanup.activeWorkspaceLabelUnchanged = null }
  }
  if (app) {
    try { await bounded(app.close(), 15000, 'own-app-close-timeout'); report.cleanup.ownAppClosed = true }
    catch {
      await bounded(app.evaluate(({ app }) => app.exit(0)), 5000, 'own-app-exit-timeout').catch(() => {})
      for (let attempt = 0; attempt < 20 && app.process().exitCode === null; attempt++) await pause(100)
      report.cleanup.ownAppClosed = app.process().exitCode !== null
    }
  }
  if (report.status === 'verified-awaiting-cleanup') report.status = report.cleanup.profileRestored && report.cleanup.ownAppClosed
    && report.cleanup.activeWorkspaceLabelUnchanged === true ? 'passed' : 'cleanup-failed'
  if (config && lock) {
    await lock.close(); await fs.rm(lockPath, { force: true }); report.cleanup.lockReleased = true
    report.finishedAt = new Date().toISOString(); await write(path.join(config.out, 'result.json'), report)
  }
  console.log(JSON.stringify({ version: VERSION, status: report.status, phase: report.failedStage ?? 'complete',
    modelRequests: report.modelRequests, profileRestored: report.cleanup.profileRestored ?? null,
    ownAppClosed: report.cleanup.ownAppClosed ?? null, teacherVersionMatchesW3Producer: report.consumed?.teacherVersionMatchesW3Producer ?? null,
    wirePayloadDelivery: 'not-publicly-observable', report: lock ? 'result.json' : null, error: report.error ?? null }))
  process.exitCode = report.status === 'passed' ? 0 : 1
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
}
