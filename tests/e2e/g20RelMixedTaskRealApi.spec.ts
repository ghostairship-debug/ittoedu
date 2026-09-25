import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'
import type { ExecutionPermissionMode } from '../../src/shared/workbench/executionPermission'
import { disclosedExecutionSettings } from '../../src/shared/workbench/executionDesktop'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { summarizeRelMixedRun } from './helpers/g20RelMixedEvidence'
import { relToolDiagnostics } from './helpers/g20RelToolDiagnostics'
import { relProtocolDiagnostics } from './helpers/g20RelProtocolDiagnostics'
import { preserveRelFailureEvidence, relTransportDiagnostics } from './helpers/g20RelTransportDiagnostics'
import { advanceRelResumeManifest, collectRelUsage, createRelRecoveryDirectory, readRelResumeManifest,
  relResumeRunIds, validateRelRecoveryDirectory, verifyRelResumeLineage, writeRelResumeManifest,
  type RelResumeManifest } from './helpers/g20RelMixedRecovery'

const root = resolve(__dirname, '../..')
const model = 'deepseek-flash'
const imageModel = 'gpt-image-2'
const route = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', keyName: 'TEAMOROUTER_API_KEY' } as const
const terminal = ['completed', 'partial', 'failed', 'stopped', 'interrupted']

test.use({ trace: 'off' }) // The test passes a runtime API key through page.evaluate.
test.describe.configure({ retries: 0 }) // A paid run must never be replayed by Playwright.

test('REL-T11 one actual built-in Engine run covers a complete mixed teacher task', async ({}, info) => {
  test.skip(process.env.G20_REL_REAL_API !== '1', 'Actual provider run is explicitly gated')
  test.setTimeout(0)
  if (process.env.G20_REL_TEXT_ROUTE && process.env.G20_REL_TEXT_ROUTE !== 'teamorouter')
    throw new Error('REL-T11 now requires the TeamoRouter text and image route')
  const resumePath = process.env.G20_REL_RESUME_MANIFEST
  if (resumePath && process.env.G20_REL_RESUME_PAID !== '1')
    throw new Error('REL continuation requires the explicit G20_REL_RESUME_PAID=1 gate')
  const resumeManifest = resumePath ? readRelResumeManifest(resolve(resumePath)) : null
  const legacyOAuthResume = resumeManifest?.schemaVersion === 1
    || resumeManifest?.schemaVersion === 3 && resumeManifest.requestedImageProvider === 'openai'
  const key = process.env[route.keyName]
  if (!resumeManifest && !key) throw new Error(`${route.keyName} is absent`)
  const output = join(root, 'output/g20/rel-t11')
  mkdirSync(output, { recursive: true })
  const directory = resumeManifest ? dirname(resolve(resumePath!)) : mkdtempSync(join(output, 'real-'))
  const recoveryDirectory = resumeManifest?.recoveryDirectory ?? createRelRecoveryDirectory()
  const profile = join(recoveryDirectory, 'profile')
  const workspace = resumeManifest?.workspacePath ?? join(directory, 'workspace')
  try {
    if (!resumeManifest) mkdirSync(workspace)
  } catch (error) {
    if (!resumeManifest) rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
    throw error
  }
  const courseName = '光合作用互动课件.h5lesson'
  const coursePath = join(workspace, courseName), htmlPath = join(directory, '光合作用互动课件.html')
  const materialPath = join(workspace, '光合作用材料.md')
  try {
    if (resumeManifest) {
      if (!existsSync(materialPath) || !readFileSync(materialPath, 'utf8').trim())
        throw new Error('REL resume material is missing or unreadable')
    } else {
      writeFileSync(materialPath, [
        '# 光合作用课堂材料',
        '现象：绿色叶片在光照下吸收二氧化碳和水，生成有机物并释放氧气。',
        '教学顺序：第一页引出预测；第二页先观察，再由学生操作揭示解释。',
        '互动原型有一处故意保留的语法错误，需要先在受控构建区编译观察错误，再修复：',
        "CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){const button=;ctx.dom.root.appendChild(button)}});",
        '修复后的互动应显示“显示答案”按钮，点击后揭示“光合作用把光能转化为化学能”。',
      ].join('\n'))
    }
  } catch (error) {
    if (!resumeManifest) rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
    throw error
  }
  let app: Awaited<ReturnType<typeof electron.launch>>
  try {
    app = await electron.launch({ cwd: root,
      args: [legacyOAuthResume ? join(root, 'tests/e2e/helpers/g20RelMixedRealPreflightBootstrap.cjs') : '.',
        `--user-data-dir=${profile}`],
      env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '',
        VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  } catch (error) {
    if (!resumeManifest) rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
    throw error
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  let windowPage: Page | null = null
  let cancellationRequested = false
  let stopRequested = false
  const requestCancellation = () => { cancellationRequested = true }
  process.on('SIGINT', requestCancellation)
  process.on('SIGTERM', requestCancellation)
  const startedAt = Date.now(), stage = { value: 'launch' }
  let sent = false, runId: string | null = null, runStatus: string | null = null
  let postSendFailure = false
  let priorRuns: ExecutionRunRecord[] = []
  let canResumePaid = false, preserveFailureEvidence = false
  let finalObservedRun: ExecutionRunRecord | null = null
  let sendIdentityMatched = true
  let frozenImageConnection: { id: string; revision: number } | null = null
  let sentIdentity: { workspaceId: string; conversationId: string; submissionId: string } | null = null
  const manualIntervention: string[] = []
  let evidence: Record<string, unknown> = { caseId: 'REL-T11',
    route: legacyOAuthResume ? 'TeamoRouter text + frozen GPT OAuth image continuation' : 'TeamoRouter text + OpenAI Images API',
    requestedTextModel: model, requestedImageModel: imageModel, textBilling: 'metered-declared',
    imageBilling: legacyOAuthResume ? 'subscription-declared' : 'metered-declared', actualCharge: 'unknown', sent: false,
    firstPass: false, repair: 'not_observed', manualIntervention, exportedHtml: null }
  try {
    const page = await app.firstWindow(); windowPage = page; page.setDefaultTimeout(20_000)
    stage.value = 'settings-preflight'
    const initialSettings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(initialSettings.secureStorageAvailable).toBe(true)
    if (legacyOAuthResume) {
      stage.value = 'legacy-oauth-preflight'
      const oauth = await app.evaluate(async () => (globalThis as any).__G20_REL_REAL_PREFLIGHT__.ready)
      expect(oauth).toMatchObject({ provider: 'openai', protocol: 'chatgpt-responses',
        billing: 'subscription', credentialReadable: true, secureStorageAvailable: true, sourceIsIsolated: true })
      expect(oauth.imageRole.model).toBe(imageModel)
      expect(oauth.imageRole.parameters ?? {}).toEqual({})
      expect(oauth.imageEditRole === null || (oauth.imageEditRole.connectionId === oauth.imageRole.connectionId
        && oauth.imageEditRole.model === imageModel
        && Object.keys(oauth.imageEditRole.parameters ?? {}).length === 0)).toBe(true)
      evidence.legacyOAuthAccessTokenExpired = oauth.expired
    }
    if (!resumeManifest) expect(initialSettings.connections).toEqual([])
    if (!resumeManifest) {
      stage.value = 'teamorouter-connection'
      const connection = await page.evaluate(async apiKey => window.desktopAPI!.executionSettings!.saveConnection({
        apiKey: apiKey.key, connection: { provider: apiKey.provider, protocol: 'openai-chat',
          imageProtocol: 'openai-images', baseURL: apiKey.baseURL, accountId: 'owner-authorized-runtime-key',
          authKind: 'api-key', billing: { kind: 'metered' } },
      }), { key: key!, provider: route.provider, baseURL: route.baseURL })
      stage.value = 'model-catalog'
      const catalog = await page.evaluate(async selected => window.desktopAPI!.executionSettings!.discoverModels(
        selected.connection.id, selected.connection.revision), connection)
      expect(catalog.models.some(entry => entry.id === model)).toBe(true)
      expect(catalog.models.some(entry => entry.id === imageModel)).toBe(true)
      evidence.catalog = { textSelectedPresent: true, imageSelectedPresent: true,
        count: catalog.models.length, capabilitiesVerified: catalog.capabilitiesVerified }
      stage.value = 'role-binding'
      await page.evaluate(async ({ connectionId, model, imageModel }) => {
        const api = window.desktopAPI!.executionSettings!, current = await api.read()
        return api.saveProfile({ expectedRevision: current.profile.revision, roles: {
          conversation: { connectionId, model }, vision: null,
          imageGenerate: { connectionId, model: imageModel, parameters: {} },
          imageEdit: { connectionId, model: imageModel, parameters: {} },
        } })
      }, { connectionId: connection.connection.id, model, imageModel })
    }
    const frozen = await page.evaluate(async () => window.desktopAPI!.executionSettings!.read())
    expect(frozen.profile.roles).toMatchObject({ conversation: { model }, imageGenerate: { model: imageModel } })
    if (legacyOAuthResume) expect(frozen.profile.roles.imageGenerate?.parameters ?? {}).toEqual({})
    else {
      expect(frozen.profile.roles.imageGenerate).toMatchObject({ parameters: {} })
      expect(frozen.profile.roles.imageEdit).toMatchObject({ model: imageModel, parameters: {} })
    }
    const textConnection = frozen.connections.find(entry => entry.connection.id === frozen.profile.roles.conversation?.connectionId)
    expect(textConnection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: route.provider, protocol: 'openai-chat', baseURL: route.baseURL,
      billing: { kind: 'metered' }, auth: { kind: 'api-key' },
    } })
    const imageConnection = frozen.connections.find(entry => entry.connection.id === frozen.profile.roles.imageGenerate?.connectionId)
    if (legacyOAuthResume) {
      expect(imageConnection).toMatchObject({ hasCredential: true, revoked: false, connection: {
        provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
        billing: { kind: 'subscription' }, auth: { kind: 'oauth' },
      } })
      frozenImageConnection = { id: imageConnection!.connection.id, revision: imageConnection!.connection.revision }
    } else {
      expect(textConnection?.connection.imageProtocol).toBe('openai-images')
      expect(imageConnection?.connection.id).toBe(textConnection?.connection.id)
      expect(frozen.profile.roles.imageEdit?.connectionId).toBe(textConnection?.connection.id)
      frozenImageConnection = { id: textConnection!.connection.id, revision: textConnection!.connection.revision }
      if (resumeManifest?.schemaVersion === 2 || resumeManifest?.schemaVersion === 3) {
        expect(frozenImageConnection).toEqual({ id: resumeManifest.imageConnectionId,
          revision: resumeManifest.imageConnectionRevision })
      }
    }
    if (legacyOAuthResume && resumeManifest?.schemaVersion === 3)
      expect(frozenImageConnection).toEqual({ id: resumeManifest.imageConnectionId,
        revision: resumeManifest.imageConnectionRevision })
    const disclosedSettings = disclosedExecutionSettings(frozen)
    expect(disclosedSettings.roles.conversation).toMatchObject({
      provider: route.provider, model, billingKind: 'metered',
    })
    expect(disclosedSettings.roles.imageGenerate).toMatchObject(legacyOAuthResume
      ? { connectionId: imageConnection?.connection.id, provider: 'openai', model: imageModel, billingKind: 'subscription' }
      : { connectionId: textConnection?.connection.id, provider: route.provider, model: imageModel, billingKind: 'metered' })
    if (!legacyOAuthResume) expect(disclosedSettings.roles.imageEdit).toEqual(disclosedSettings.roles.imageGenerate)
    evidence.frozenRoles = { conversation: frozen.profile.roles.conversation,
      imageGenerate: frozen.profile.roles.imageGenerate, imageEdit: frozen.profile.roles.imageEdit }
    evidence.textRoute = { provider: route.provider, baseURL: route.baseURL,
      requestedModel: model, billingKind: 'metered', credentialReady: textConnection?.hasCredential === true }
    evidence.imageRoute = legacyOAuthResume
      ? { provider: 'openai', protocol: 'chatgpt-responses', requestedModel: imageModel,
        billingKind: 'subscription', credentialReady: imageConnection?.hasCredential === true }
      : { provider: route.provider, protocol: 'openai-images',
        endpoint: `${route.baseURL}/images/generations`, requestedModel: imageModel,
        billingKind: 'metered', credentialReady: textConnection?.hasCredential === true }
    evidence.disclosedSettings = disclosedSettings
    stage.value = 'workspace'
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    // The click starts an async native selection. Wait until Main has registered the root;
    // a renderer click receipt alone does not grant the conversation service access.
    await expect.poll(() => page.evaluate(async directory => {
      try { return await window.desktopAPI!.workspaceFiles!({ type: 'root', directory }) }
      catch { return null }
    }, workspace), { timeout: 20_000 }).toMatchObject({ resolvedPath: workspace })
    const prepared = await page.evaluate(async input => {
      const execution = window.desktopAPI!.execution!, space = await execution.workspace(input.workspace)
      const conversation = input.conversationId
        ? await execution.conversation(space.workspace.workspaceId, input.conversationId)
        : space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      if (!conversation) throw new Error('REL resume conversation is missing')
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        revision: conversation.revision }
    }, { workspace, conversationId: resumeManifest?.conversationId ?? null })
    const instruction = [
      '读取工作空间中的《光合作用材料.md》，基于材料创建并保存《光合作用互动课件.h5lesson》V9。',
      '创建至少两页：第一页提出预测并说明材料中的现象，第二页给观察事实和解释；直接编辑课件文字。',
      '调用 image.generate 为叶片和阳光生成一张教学插图，并用 media.insert 实际放到第二页。',
      '第二页加入可重复点击揭示答案的局部 DOM Runtime 互动。材料中原型故意有语法错误：',
      '先在 build scratch 写入原型并调用 build.compile，读取真实错误日志，再修复源码、重新编译。',
      'Runtime 按钮默认“显示答案”，点击后显示“光合作用把光能转化为化学能”。',
      '构建候选的 staticFallback 必须含真实 assetId，coverage 为 surface；按钮要能接收点击。',
      '调用 build.check 完成真实准入，仅在 ready 后 build.import。普通文字和图片直接提交。',
      '需要工具时按需用 tools.load 展开工具族；不要使用外部 CLI 或 shell。最后简要报告成功和修复情况。',
    ].join('\n')
    let sendText = instruction
    let sendDocuments: ExecutionDocumentReference[] = []
    let sendAttachments: InputAttachmentReference[] = []
    let sendPermission: ExecutionPermissionMode | undefined
    if (resumeManifest) {
      stage.value = 'resume-verification'
      expect(prepared.workspaceId).toBe(resumeManifest.workspaceId)
      expect(prepared.conversationId).toBe(resumeManifest.conversationId)
      const state = await page.evaluate(async identity => {
        const api = window.desktopAPI!.execution!
        return { runs: await Promise.all(identity.runIds.map(id => api.run(id))),
          submissions: await api.submissions({ workspaceId: identity.workspaceId, conversationId: identity.conversationId }),
          conversation: await api.conversation(identity.workspaceId, identity.conversationId) }
      }, { ...resumeManifest, runIds: relResumeRunIds(resumeManifest) })
      expect(state.runs.every(Boolean)).toBe(true)
      priorRuns = state.runs as ExecutionRunRecord[]
      verifyRelResumeLineage(resumeManifest, priorRuns, state.submissions)
      const previous = priorRuns.at(-1)!
      expect(previous?.runId).toBe(resumeManifest.runId)
      expect(['failed', 'partial', 'interrupted']).toContain(previous?.status)
      expect(previous?.input.conversationId).toBe(resumeManifest.conversationId)
      expect(previous?.input.workspaceRoot).toBe(workspace)
      expect(previous?.input.selection.model).toBe(model)
      expect(previous?.input.selection.connection).toMatchObject({ provider: route.provider,
        protocol: 'openai-chat', baseURL: route.baseURL,
        billing: { kind: 'metered' } })
      if (!legacyOAuthResume) expect(previous?.input.selection.connection.imageProtocol).toBe('openai-images')
      expect(previous?.input.selection.connection.id).toBe(disclosedSettings.roles.conversation?.connectionId)
      expect(previous?.input.selection.connection.revision).toBe(disclosedSettings.roles.conversation?.connectionRevision)
      expect(previous?.input.selection.parameters ?? {}).toEqual(frozen.profile.roles.conversation?.parameters ?? {})
      expect(previous?.input.disclosedSettings).toEqual(disclosedSettings)
      const source = state.submissions.find(item => item.submissionId === previous.input.taskId)
      expect(source?.runId).toBe(previous?.runId)
      expect(source?.text).toBe(previous?.input.instruction)
      expect(source?.workspaceId).toBe(resumeManifest.workspaceId)
      expect(source?.conversationId).toBe(resumeManifest.conversationId)
      expect(source?.model).toMatchObject({ provider: route.provider, model, billing: 'metered' })
      expect(state.submissions.some(item => item.submissionId !== source?.submissionId
        && ['queued', 'starting', 'accepted'].includes(item.state))).toBe(false)
      expect(state.conversation?.revision).toBe(prepared.revision)
      sendText = source!.text
      sendDocuments = source!.documents
      sendAttachments = source!.attachments
      sendPermission = source!.permission
      evidence.continuedFrom = previous!.runId
      evidence.resumeVerified = true
      manualIntervention.push('explicit paid continuation of original frozen task')
    }
    if (cancellationRequested) throw new Error('Cancelled before paid model request')
    stage.value = 'send'
    const submissionId = randomUUID()
    sentIdentity = { workspaceId: prepared.workspaceId, conversationId: prepared.conversationId, submissionId }
    writeFileSync(join(directory, `send-intent-${submissionId}.json`), JSON.stringify({ ...sentIdentity,
      attempted: true, createdAt: new Date().toISOString(),
      retryOfRunId: resumeManifest?.runId ?? null,
      retryPolicy: 'never create a second submission after an unknown ACK' }, null, 2))
    sent = true; evidence.sendInvoked = true
    const accepted = await page.evaluate(async input => {
      const result = await window.desktopAPI!.execution!.send({ workspaceId: input.prepared.workspaceId,
        conversationId: input.prepared.conversationId, expectedRevision: input.prepared.revision,
        submissionId: input.submissionId, text: input.instruction, documents: input.documents,
        attachments: input.attachments, permission: input.permission,
        ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
        disclosedSettings: input.disclosedSettings })
      return { runId: result.run?.runId ?? null, submissionState: result.submission.state,
        submissionId: result.submission.submissionId }
    }, { prepared, instruction: sendText, documents: sendDocuments, attachments: sendAttachments,
      permission: sendPermission, retryOfRunId: resumeManifest?.runId ?? null, submissionId, disclosedSettings })
    runId = accepted.runId
    sendIdentityMatched = accepted.submissionId === submissionId
    if (!sendIdentityMatched) throw new Error('REL parent already has a different child submission; reconcile the durable child before another send')
    evidence.submissionState = accepted.submissionState
    expect(runId).toBeTruthy(); evidence.sent = true; evidence.runId = runId
    stage.value = 'run'
    while (true) {
      if (cancellationRequested && !stopRequested) {
        stopRequested = true
        manualIntervention.push('user cancelled; formal Engine stop')
        await page.evaluate(async id => window.desktopAPI!.execution!.stop(id), runId!)
      }
      const current = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!)
      writeFileSync(join(directory, 'progress.json'), JSON.stringify({ runId, stage: stage.value,
        updatedAt: new Date().toISOString(), status: current?.status ?? null,
        requestCount: current?.requests.length ?? 0, toolCount: current?.tools.length ?? 0,
        cancellationRequested }, null, 2))
      if (current && terminal.includes(current.status)) break
      await new Promise<void>(resolveWait => setTimeout(resolveWait, 3000))
    }
    const run = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!)
    expect(run).toBeTruthy()
    runStatus = run?.status ?? null
    if (run) {
      expect(run.input.selection.model).toBe(model)
      if (priorRuns.length) {
        const priorRun = priorRuns.at(-1)!
        expect(run.continuedFrom).toBe(priorRun.runId)
        expect(run.input.selection.connection.id).toBe(priorRun.input.selection.connection.id)
        expect(run.input.selection.connection.revision).toBe(priorRun.input.selection.connection.revision)
        expect(run.input.selection.parameters ?? {}).toEqual(priorRun.input.selection.parameters ?? {})
        expect(run.input.disclosedSettings).toEqual(disclosedSettings)
      }
      evidence.frozenRequestedModel = run.input.selection.model
    }
    evidence.runStatus = runStatus
    evidence.runFailure = run?.failure ?? null
    const allRuns = [...priorRuns, run!]
    const combinedRun = { ...run!, requests: allRuns.flatMap(item => item.requests),
      tools: allRuns.flatMap(item => item.tools) }
    evidence.requests = combinedRun.requests.map(request => ({ actualModel: request.actualModel ?? null,
      state: request.state, failure: request.failure ?? null }))
    evidence.tools = combinedRun.tools.map(tool => ({ name: tool.call.name, state: tool.state,
      resultKind: tool.result?.kind ?? null }))
    evidence.toolDiagnostics = relToolDiagnostics(allRuns)
    evidence.lineage = { runIds: allRuns.map(item => item.runId),
      paidContinuations: priorRuns.length,
      requestCount: combinedRun.requests.length, toolCount: combinedRun.tools.length,
      runElapsedMs: allRuns.reduce((sum, item) => sum + item.updatedAt - item.createdAt, 0) }
    let receipts = summarizeRelMixedRun(allRuns)
    evidence.receipts = receipts
    evidence.firstPass = priorRuns.length === 0 && receipts.firstPass
    evidence.repair = receipts.repairedSuccess ? 'verified failed compile, corrected compile, ready check, applied import'
      : receipts.compile.failed ? 'compile failed; full repair unverified' : 'not_observed'
    const usage = await collectRelUsage({ events: (conversationId, after, limit) => page.evaluate(
      args => window.desktopAPI!.execution!.events(args.conversationId, args.after, args.limit),
      { conversationId, after, limit }) }, prepared.conversationId, allRuns.map(item => item.runId))
    evidence.usage = usage.usage
    evidence.usagePagination = { pages: usage.pages, eventCount: usage.eventCount,
      cursor: usage.cursor, complete: usage.complete }
    stage.value = 'save-reopen'
    if (existsSync(coursePath)) {
      const opened = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), coursePath)
      await page.evaluate(async id => { await window.desktopAPI!.documents!.save(id); await window.desktopAPI!.documents!.close(id) }, opened.documentId)
      const reopened = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), coursePath)
      const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
      receipts = summarizeRelMixedRun(allRuns, archive)
      evidence.receipts = receipts
      evidence.firstPass = priorRuns.length === 0 && receipts.firstPass
      evidence.repair = receipts.repairedSuccess ? 'verified failed compile, corrected compile, ready check, applied import'
        : receipts.compile.failed ? 'compile failed; full repair unverified' : 'not_observed'
      evidence.reopenedClean = !reopened.dirty
      evidence.locations = archive.project.locations.length
      evidence.runtimeCount = archive.project.surfaces.flatMap(surface => surface.type === 'slide'
        ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime')) : []).length
      evidence.assetCount = Object.keys(archive.project.assets).length
      stage.value = 'export'
      const tree = page.locator('.lesson-directory-tree')
      await tree.getByRole('button', { name: courseName, exact: true }).dblclick()
      await page.getByRole('button', { name: '深度编辑', exact: true }).click()
      await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, htmlPath)
      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-single-html').click()
      const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
      evidence.exportPreflight = await preflight.textContent()
      await expect(preflight).toContainText('0 个错误')
      await preflight.getByRole('button', { name: '继续导出' }).click()
      const large = page.getByRole('alertdialog', { name: '单 HTML 文件较大' })
      if (await large.isVisible().catch(() => false)) await large.getByRole('button', { name: '仍导出单 HTML' }).click()
      await expect.poll(() => existsSync(htmlPath) ? readFileSync(htmlPath).byteLength : 0,
        { timeout: 120_000 }).toBeGreaterThan(100_000)
      evidence.exportedHtml = htmlPath
      manualIntervention.push('UI export after model run')
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({ offline: true }), exported = await context.newPage()
      const errors: string[] = []
      exported.on('pageerror', error => errors.push(error.message))
      await exported.goto(pathToFileURL(htmlPath).href)
      await exported.keyboard.press('PageDown')
      if (runStatus === 'completed' && receipts.build.importAppliedAfterReady
        && typeof evidence.runtimeCount === 'number' && evidence.runtimeCount > 0) {
        const quiz = exported.getByRole('button', { name: '显示答案', exact: true })
        const quizHandle = await quiz.elementHandle({ timeout: 20_000 })
        expect(quizHandle).toBeTruthy()
        await quizHandle!.click({ timeout: 20_000 })
        await expect(exported.getByText('光合作用把光能转化为化学能')).toBeVisible({ timeout: 20_000 })
        await quizHandle!.click({ timeout: 20_000 })
        await expect(exported.getByText('光合作用把光能转化为化学能')).toBeVisible({ timeout: 20_000 })
        evidence.offlineInteraction = true
      } else {
        evidence.offlineInteraction = false
        evidence.offlineSkippedReason = 'run partial or no admitted Runtime; exported HTML opened without interaction assertion'
      }
      evidence.offlinePageErrors = errors
      expect(errors).toEqual([])
      await context.close()
    }
    expect(runStatus).toBe('completed')
    expect(evidence.reopenedClean).toBe(true)
    expect(evidence.locations).toBeGreaterThanOrEqual(2)
    expect(evidence.runtimeCount).toBeGreaterThanOrEqual(1)
    expect(evidence.assetCount).toBeGreaterThanOrEqual(1)
    expect(evidence.offlineInteraction).toBe(true)
    expect(receipts.imageReady).toBe(true)
    expect(receipts.mediaLinked).toBe(true)
    expect(receipts.compile.failed).toBe(true)
    expect(receipts.compile.fixedAfterFailure).toBe(true)
    expect(receipts.build.checkReady).toBe(true)
    expect(receipts.build.importAppliedAfterReady).toBe(true)
  } catch (error) {
    postSendFailure = sent
    throw error
  } finally {
    process.off('SIGINT', requestCancellation)
    process.off('SIGTERM', requestCancellation)
    let preserveLiveApp = false
    if (sentIdentity && !runId && windowPage) {
      try {
        const submission = await windowPage.evaluate(async input => window.desktopAPI!.execution!.submission(input), sentIdentity)
        runId = submission?.runId ?? null
        evidence.submissionAfterInterruptedSend = { state: submission?.state ?? null, runId }
        if (!runId) preserveLiveApp = true // An accepted queued send may start later.
      } catch (error) {
        preserveLiveApp = true
        evidence.submissionLookupFailure = error instanceof Error ? error.message : String(error)
      }
    }
    if (sent && runId && windowPage) {
      try {
        let finalRun = await windowPage.evaluate(async id => window.desktopAPI!.execution!.run(id), runId)
        if (finalRun && !terminal.includes(finalRun.status)) {
          evidence.cleanup = 'formal Engine stop before closing the test app'
          await windowPage.evaluate(async id => window.desktopAPI!.execution!.stop(id), runId)
          finalRun = await windowPage.evaluate(async id => window.desktopAPI!.execution!.run(id), runId)
        }
        runStatus = finalRun?.status ?? runStatus
        if (!finalRun || !terminal.includes(finalRun.status)) preserveLiveApp = true
        finalObservedRun = finalRun
        if (finalRun) canResumePaid = ['partial', 'failed', 'interrupted'].includes(finalRun.status)
        if (finalRun && !evidence.receipts) {
          const receipts = summarizeRelMixedRun([...priorRuns, finalRun])
          evidence.receipts = receipts
          evidence.firstPass = priorRuns.length === 0 && receipts.firstPass
          evidence.repair = receipts.repairedSuccess
            ? 'verified failed compile, corrected compile, ready check, applied import'
            : receipts.compile.failed ? 'compile failed; full repair unverified' : 'not_observed'
        }
        if (finalRun) evidence.toolDiagnostics = relToolDiagnostics([...priorRuns, finalRun])
        if (sentIdentity && !evidence.usage) {
          try {
            const usage = await collectRelUsage({ events: (conversationId, after, limit) => windowPage!.evaluate(
              args => window.desktopAPI!.execution!.events(args.conversationId, args.after, args.limit),
              { conversationId, after, limit }) }, sentIdentity.conversationId,
              [...priorRuns.map(item => item.runId), finalRun?.runId].filter((id): id is string => Boolean(id)))
            evidence.usage = usage.usage
            evidence.usagePagination = { pages: usage.pages, eventCount: usage.eventCount,
              cursor: usage.cursor, complete: usage.complete }
          } catch (error) {
            evidence.usageReadError = error instanceof Error ? error.message : String(error)
          }
        }
        evidence.finalRun = finalRun && { status: finalRun.status, failure: finalRun.failure ?? null,
          requestCount: finalRun.requests.length,
          requests: finalRun.requests.map(request => ({ state: request.state, actualModel: request.actualModel ?? null })),
          committedTools: finalRun.tools.filter(tool => tool.result?.kind === 'document-operation'
            && tool.result.result.status === 'applied').map(tool => tool.call.name),
          unresolvedTools: finalRun.tools.filter(tool => tool.state !== 'returned').map(tool => tool.call.name) }
        if (finalRun && !evidence.lineage) {
          const allRuns = [...priorRuns, finalRun]
          evidence.lineage = { runIds: allRuns.map(item => item.runId),
            paidContinuations: priorRuns.length,
            requestCount: allRuns.reduce((sum, item) => sum + item.requests.length, 0),
            toolCount: allRuns.reduce((sum, item) => sum + item.tools.length, 0),
            runElapsedMs: allRuns.reduce((sum, item) => sum + item.updatedAt - item.createdAt, 0) }
        }
      } catch (error) {
        preserveLiveApp = true
        evidence.cleanup = 'Engine stop/read failed; provider outcome and committed facts require journal inspection'
        evidence.cleanupError = error instanceof Error ? error.message : String(error)
      }
    }
    evidence.protocolDiagnostics = relProtocolDiagnostics(profile)
    evidence.transportDiagnostics = relTransportDiagnostics(profile)
    if (finalObservedRun && ['partial', 'failed', 'interrupted'].includes(finalObservedRun.status))
      canResumePaid = true
    canResumePaid &&= Boolean(frozenImageConnection) && sendIdentityMatched
    preserveFailureEvidence = preserveRelFailureEvidence({ sent, status: runStatus, postSendFailure,
      outcome: (evidence.runFailure as { outcome?: string } | undefined)?.outcome
        ?? (evidence.finalRun as { failure?: { outcome?: string } } | undefined)?.failure?.outcome })
    if (canResumePaid && sentIdentity && runId && finalObservedRun && terminal.includes(finalObservedRun.status)) {
      const manifest = advanceRelResumeManifest(resumeManifest, { recoveryDirectory, workspacePath: workspace,
        workspaceId: sentIdentity.workspaceId, conversationId: sentIdentity.conversationId,
        runId, submissionId: sentIdentity.submissionId,
        requestedTextModel: model, requestedProvider: 'teamorouter',
        requestedImageModel: imageModel, requestedImageProvider: legacyOAuthResume ? 'openai' : 'teamorouter',
        requestedImageProtocol: legacyOAuthResume ? 'chatgpt-responses' : 'openai-images',
        imageConnectionId: frozenImageConnection!.id, imageConnectionRevision: frozenImageConnection!.revision })
      writeRelResumeManifest(join(directory, 'resume.json'), manifest)
      evidence.resume = { available: true, manifest: join(directory, 'resume.json'),
        explicitPaidGate: 'G20_REL_RESUME_PAID=1', profileLocation: 'per-user LOCALAPPDATA only' }
    }
    const existingResumePending = Boolean(resumeManifest && (!sent || !finalObservedRun
      || ['partial', 'failed', 'interrupted'].includes(finalObservedRun.status)))
    const privateProfilePreserved = preserveFailureEvidence || preserveLiveApp || canResumePaid || existingResumePending
    if (resumeManifest && !canResumePaid) evidence.resume = { available: !sent,
      manifest: resolve(resumePath!), reason: sent ? 'send outcome requires durable reconciliation' : 'continuation was not sent' }
    evidence.failureEvidence = { privateProfilePreserved, postSendFailure,
      ...(privateProfilePreserved ? { recoveryDirectory } : {}),
      paidContinuationAvailable: Boolean(canResumePaid && finalObservedRun && sentIdentity && runId) }
    evidence = { ...evidence, stage: stage.value, sent, runStatus, elapsedMs: Date.now() - startedAt,
      cost: 'unknown', scope: 'one actual built-in Engine run; no embedded CLI' }
    const evidenceFile = join(directory, resumeManifest ? `continuation-evidence-${Date.now()}.json` : 'evidence.json')
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
    if (resumeManifest && finalObservedRun?.status === 'completed') rmSync(join(directory, 'resume.json'), { force: true })
    await info.attach('REL-T11 actual route evidence', { path: evidenceFile, contentType: 'application/json' })
    await browser?.close().catch(() => undefined)
    if (!preserveLiveApp) {
      await app.evaluate(({ app, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
      if (!privateProfilePreserved) {
        rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
        if (resumeManifest) rmSync(join(directory, 'resume.json'), { force: true })
      }
    }
  }
})
