import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'
import type { ExecutionPermissionMode } from '../../src/shared/workbench/executionPermission'
import { disclosedExecutionSettings } from '../../src/shared/workbench/executionDesktop'
import { modelCapabilityRecord } from '../../src/shared/workbench/modelCapabilities'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { summarizeRelMixedRun } from './helpers/g20RelMixedEvidence'
import { relM18StageEvidence } from './helpers/g20RelMixedM18Evidence'
import { relToolDiagnostics } from './helpers/g20RelToolDiagnostics'
import { relProtocolDiagnostics } from './helpers/g20RelProtocolDiagnostics'
import { preserveRelFailureEvidence, relTransportDiagnostics } from './helpers/g20RelTransportDiagnostics'
import { advanceRelResumeManifest, collectRelUsage, readRelResumeManifest,
  relResumeRunIds, validateRelRecoveryDirectory, verifyRelResumeLineage, writeRelResumeManifest,
  type RelResumeManifest } from './helpers/g20RelMixedRecovery'

const root = resolve(__dirname, '../..')
const model = 'deepseek-flash'
const imageModel = 'gpt-image-2.5-sunburst'
const route = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1' } as const
const terminal = ['completed', 'partial', 'failed', 'stopped', 'interrupted']

test.use({ trace: 'off' }) // The test passes a runtime API key through page.evaluate.
test.describe.configure({ retries: 0 }) // A paid run must never be replayed by Playwright.

test('REL-T11 one actual built-in Engine run covers a complete mixed teacher task', async ({}, info) => {
  test.skip(process.env.G20_REL_REAL_API !== '1', 'Actual provider run is explicitly gated')
  test.setTimeout(0)
  if (process.env.G20_REL_TEXT_ROUTE && process.env.G20_REL_TEXT_ROUTE !== 'teamorouter')
    throw new Error('REL-T11 requires the TeamoRouter text route')
  if (process.env.G20_REL_OWNER_RELEASE !== '1')
    throw new Error('REL-T11 needs the Owner-approved route, models, image channel and single-run policy')
  const resumePath = process.env.G20_REL_RESUME_MANIFEST
  if (resumePath && process.env.G20_REL_RESUME_PAID !== '1')
    throw new Error('REL continuation requires the explicit G20_REL_RESUME_PAID=1 gate')
  const resumeManifest = resumePath ? readRelResumeManifest(resolve(resumePath)) : null
  if (resumeManifest && resumeManifest.requestedImageModel !== imageModel)
    throw new Error('REL continuation image model differs from the current gpt-image-2.5-sunburst route')
  if (resumeManifest && !(resumeManifest.schemaVersion === 1
    || resumeManifest.schemaVersion === 3 && resumeManifest.requestedImageProvider === 'openai'))
    throw new Error('REL-T11 current run never continues a TeamoRouter Images route')
  const output = join(root, 'output/g20/rel-t11')
  mkdirSync(output, { recursive: true })
  const directory = resumeManifest ? dirname(resolve(resumePath!)) : mkdtempSync(join(output, 'real-'))
  if (!resumeManifest && !process.env.G20_REL_OAUTH_PROFILE_RECOVERY_DIR)
    throw new Error('Fresh REL-T11 workspace requires a formally logged-in private OAuth profile')
  const recoveryDirectory = resumeManifest?.recoveryDirectory
    ?? validateRelRecoveryDirectory(resolve(process.env.G20_REL_OAUTH_PROFILE_RECOVERY_DIR!))
  const profile = join(recoveryDirectory, 'profile')
  const workspace = resumeManifest?.workspacePath ?? join(directory, 'workspace')
  try {
    if (!resumeManifest) mkdirSync(workspace)
  } catch (error) {
    throw error
  }
  const courseName = '光合作用互动课件.h5lesson'
  const coursePath = join(workspace, courseName), htmlPath = join(workspace, '光合作用互动课件.html')
  const materialPath = join(workspace, '光合作用材料.md')
  try {
    if (resumeManifest) {
      if (!existsSync(materialPath) || !readFileSync(materialPath, 'utf8').trim())
        throw new Error('REL resume material is missing or unreadable')
    } else {
      writeFileSync(materialPath, [
        '# 光合作用课堂材料',
        '现象：绿色叶片在光照下吸收二氧化碳和水，生成有机物并释放氧气。',
        '教学顺序：第一页回顾植物生长条件并提出预测；第二页观察记录、叶片图片与学生操作揭示解释。至少两页，每页可独立导航。',
        '教学图片：在第二页放一张叶片、阳光与气体交换的简明图，并允许教师日后替换。',
        '下面是教师提供的互动原型，含有一处语法错误。它只是素材线索，不能原样作为最终成品：',
        "CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){const button=;ctx.dom.root.appendChild(button)}});",
        '修复后的互动应显示“显示答案”按钮，点击后揭示“光合作用把光能转化为化学能”。',
      ].join('\n'))
    }
  } catch (error) {
    throw error
  }
  let app: Awaited<ReturnType<typeof electron.launch>>
  try {
    app = await electron.launch({ cwd: root,
      args: [join(root, 'tests/e2e/helpers/g20RelMixedRealPreflightBootstrap.cjs'), `--user-data-dir=${profile}`],
      env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '',
        VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  } catch (error) {
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
    route: 'TeamoRouter text + private GPT OAuth image',
    requestedTextModel: model, requestedImageModel: imageModel, textBilling: 'metered-declared',
    imageBilling: 'subscription-declared', actualCharge: 'unknown', sent: false,
    runPolicy: { capabilityProbe: 'one vision check on current conversation model',
      fullRun: 'one run, no retries; record actual requests, usage and charge when available' },
    firstPass: false, repair: 'not_observed', manualIntervention, exportedHtml: null }
  try {
    const page = await app.firstWindow(); windowPage = page; page.setDefaultTimeout(20_000)
    stage.value = 'settings-preflight'
    const initialSettings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(initialSettings.secureStorageAvailable).toBe(true)
    stage.value = 'oauth-preflight'
    const oauth = await app.evaluate(async () => (globalThis as any).__G20_REL_REAL_PREFLIGHT__.ready)
    expect(oauth).toMatchObject({ provider: 'openai', protocol: 'chatgpt-responses',
      billing: 'subscription', credentialReadable: true, expired: false,
      secureStorageAvailable: true, sourceIsIsolated: true })
    expect(oauth.imageRole).toMatchObject({ model: imageModel })
    expect(oauth.imageRole?.parameters ?? {}).toEqual({})
    const oauthConnection = initialSettings.connections.find(item => item.connection.id === oauth.imageRole.connectionId)
    expect(oauthConnection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: 'openai', protocol: 'chatgpt-responses', billing: { kind: 'subscription' },
      auth: { kind: 'oauth' },
    } })
    if (!resumeManifest) {
      const textConnection = initialSettings.connections.find(item => item.connection.provider === route.provider
        && item.connection.baseURL === route.baseURL && item.connection.protocol === 'openai-chat'
        && item.connection.imageProtocol === null && item.hasCredential && !item.revoked)
      expect(textConnection).toBeTruthy()
      const catalog = await page.evaluate(async selected => window.desktopAPI!.executionSettings!.discoverModels(
        selected.id, selected.revision), { id: textConnection!.connection.id, revision: textConnection!.connection.revision })
      expect(catalog.source).toBe('live')
      expect(catalog.models.some(entry => entry.id === model)).toBe(true)
      evidence.catalog = { textSelectedPresent: true, source: catalog.source,
        checkedAt: catalog.checkedAt, count: catalog.models.length, capabilitiesVerified: catalog.capabilitiesVerified }
    }
    const frozen = await page.evaluate(async () => window.desktopAPI!.executionSettings!.read())
    expect(frozen.profile.roles).toMatchObject({ conversation: { model }, imageGenerate: { model: imageModel } })
    expect(frozen.profile.roles.imageGenerate?.parameters ?? {}).toEqual({})
    const textConnection = frozen.connections.find(entry => entry.connection.id === frozen.profile.roles.conversation?.connectionId)
    expect(textConnection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: route.provider, protocol: 'openai-chat', imageProtocol: null, baseURL: route.baseURL,
      billing: { kind: 'metered' }, auth: { kind: 'api-key' },
    } })
    const imageConnection = frozen.connections.find(entry => entry.connection.id === frozen.profile.roles.imageGenerate?.connectionId)
    expect(imageConnection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
      billing: { kind: 'subscription' }, auth: { kind: 'oauth' },
    } })
    expect(imageConnection?.connection.id).not.toBe(textConnection?.connection.id)
    frozenImageConnection = { id: imageConnection!.connection.id, revision: imageConnection!.connection.revision }
    if (resumeManifest?.schemaVersion === 3)
      expect(frozenImageConnection).toEqual({ id: resumeManifest.imageConnectionId,
        revision: resumeManifest.imageConnectionRevision })
    const conversationRole = frozen.profile.roles.conversation
    const visionFact = textConnection && conversationRole && modelCapabilityRecord(frozen.capabilityRecords ?? [], {
      connection: textConnection.connection, model: conversationRole.model, parameters: conversationRole.parameters })?.facts.vision
    evidence.capabilityPreflight = { vision: { model, route: 'conversation', status: visionFact?.status ?? 'unknown',
      observedAt: visionFact?.observedAt ?? null, actualModel: visionFact?.actualModel ?? null },
      image: { model: imageModel, connectionId: imageConnection?.connection.id,
        credentialReady: imageConnection?.hasCredential === true, generationUnverified: true }, paidRequests: 0 }
    const disclosedSettings = disclosedExecutionSettings(frozen)
    expect(disclosedSettings.roles.conversation).toMatchObject({
      provider: route.provider, model, billingKind: 'metered',
    })
    expect(disclosedSettings.roles.imageGenerate).toMatchObject({ connectionId: imageConnection?.connection.id,
      provider: 'openai', model: imageModel, billingKind: 'subscription' })
    evidence.frozenRoles = { conversation: frozen.profile.roles.conversation,
      imageGenerate: frozen.profile.roles.imageGenerate, imageEdit: frozen.profile.roles.imageEdit }
    evidence.textRoute = { provider: route.provider, baseURL: route.baseURL,
      requestedModel: model, billingKind: 'metered', credentialReady: textConnection?.hasCredential === true }
    evidence.imageRoute = { provider: 'openai', protocol: 'chatgpt-responses', requestedModel: imageModel,
      billingKind: 'subscription', credentialReady: imageConnection?.hasCredential === true }
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
      '根据材料自动创作：读取《光合作用材料.md》，按随产品提供的 orchestrate-courseware 和 build-courseware-project 两个 Skill 完成整课，不中途提问或等待确认。',
      '先保存 01-teaching-plan.md；再保存整个课程的 02-course-frame.html（body 下每个顶层 section 为一页）和一页讲解操作说明 02-presentation-script.md。框架确认阶段之前不要读取编辑器能力说明或展开课件编辑工具；框架页只写布局、大致功能与无 src 的媒体占位，不生成素材。',
      '随后只读一次不超过 1500 字符的短能力简介，逐节决定表面及原生、素材、互动表示，保存 03-representation-plan.md。',
      '按每个 section 机械导入与组装为《光合作用互动课件.h5lesson》V9，一页进一页，不让模型照 HTML 重写整件作品。依据占位生成叶片与阳光插图，实际插入课件。',
      '材料要求可重复点击揭示解释的局部互动，请实现并在真实离线播放中可用。材料附有一个错误互动原型；遇到真实编译或准入错误时读取诊断、修复后再继续，不把错误原型当最终成品。',
      '组装后逐页看真实画面并精修排版、字号、对齐、溢出与配色；由你调用 file.save 保存课件和中间稿，并调用 document.export 将离线单 HTML 写成工作空间中的《光合作用互动课件.html》。随后重新打开已保存课件，核对页、图片与互动，报告首次成功、修复、假设和未满足要求。',
      '只使用果铃内置工具，不调用外部 CLI 或 shell。不能完成的要求逐条如实说明。',
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
      expect(previous?.input.selection.connection.imageProtocol).toBeNull()
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
      const verifiedRunsBySubmission = new Map(priorRuns.map(run => [run.input.taskId, run.runId]))
      expect(state.submissions.some(item => {
        const boundToVerifiedRun = Boolean(item.runId && verifiedRunsBySubmission.get(item.submissionId) === item.runId)
        return item.state === 'queued' || item.state === 'starting'
          || (item.state === 'accepted' || Boolean(item.runId)) && !boundToVerifiedRun
      })).toBe(false)
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
    const stages = relM18StageEvidence(allRuns)
    evidence.m18 = stages
    evidence.receipts = receipts
    evidence.firstPassCompleted = priorRuns.length === 0 && runStatus === 'completed'
      && stages.m18T01 && stages.m18T02 && stages.m18T03
    evidence.firstPass = evidence.firstPassCompleted && stages.indexes.failedBuilds.length === 0
    evidence.repair = stages.repairObserved ? 'real build error repaired and admitted'
      : stages.indexes.failedBuilds.length ? 'build error observed; repair unverified' : 'not_observed'
    const usage = await collectRelUsage({ events: (conversationId, after, limit) => page.evaluate(
      args => window.desktopAPI!.execution!.events(args.conversationId, args.after, args.limit),
      { conversationId, after, limit }) }, prepared.conversationId, allRuns.map(item => item.runId))
    evidence.usage = usage.usage
    evidence.usagePagination = { pages: usage.pages, eventCount: usage.eventCount,
      cursor: usage.cursor, complete: usage.complete }
    stage.value = 'artifact-review'
    if (existsSync(coursePath)) {
      const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
      receipts = summarizeRelMixedRun(allRuns, archive)
      evidence.receipts = receipts
      const reopened = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), coursePath)
      evidence.reopenedClean = !reopened.dirty
      evidence.locations = archive.project.locations.length
      evidence.runtimeCount = archive.project.surfaces.flatMap(surface => surface.type === 'slide'
        ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime')) : []).length
      evidence.assetCount = Object.keys(archive.project.assets).length
    }
    const planPath = join(workspace, '01-teaching-plan.md')
    const framePath = join(workspace, '02-course-frame.html')
    const scriptPath = join(workspace, '02-presentation-script.md')
    const representationPath = join(workspace, '03-representation-plan.md')
    if ([planPath, framePath, scriptPath, representationPath].every(existsSync)) {
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({ offline: true })
      const framePage = await context.newPage()
      const frameFacts = await framePage.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return { sectionCount: doc.querySelectorAll('body > section').length,
          mediaWithSource: doc.querySelectorAll('img[src],audio[src],video[src],source[src]').length,
          remoteDependencies: doc.querySelectorAll('script[src],link[href^="http"]').length }
      }, readFileSync(framePath, 'utf8'))
      evidence.framework = frameFacts
      const planText = readFileSync(planPath, 'utf8')
      const representationText = readFileSync(representationPath, 'utf8')
      evidence.teachingPlanBytes = Buffer.byteLength(planText)
      evidence.presentationScriptBytes = readFileSync(scriptPath).byteLength
      evidence.representationPlanBytes = Buffer.byteLength(representationText)
      expect(frameFacts.sectionCount).toBeGreaterThanOrEqual(2)
      expect(frameFacts.mediaWithSource).toBe(0)
      expect(frameFacts.remoteDependencies).toBe(0)
      expect(representationText.trim().length).toBeGreaterThan(100)
      expect(new Set(stages.indexes.observations.map(item => item.locationId).filter(Boolean)).size)
        .toBeGreaterThanOrEqual(frameFacts.sectionCount)
      expect(stages.indexes.imported.length).toBeGreaterThanOrEqual(frameFacts.sectionCount)
      await framePage.close()
      await context.close()
    }
    if (existsSync(htmlPath)) {
      evidence.exportedHtml = htmlPath
      if (!browser) browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({ offline: true }), exported = await context.newPage()
      const errors: string[] = []
      exported.on('pageerror', error => errors.push(error.message))
      await exported.goto(pathToFileURL(htmlPath).href)
      await exported.getByRole('button', { name: '展', exact: true }).click()
      await exported.getByRole('button', { name: '下一步', exact: true }).click()
      const lesson = exported.frameLocator('iframe')
      const quiz = lesson.getByRole('button', { name: '显示答案', exact: true })
      const answer = lesson.getByText('光合作用把光能转化为化学能')
      await expect(answer).toBeHidden({ timeout: 20_000 })
      await quiz.click({ timeout: 20_000 })
      await expect(answer).toBeVisible({ timeout: 20_000 })
      await quiz.click({ timeout: 20_000 })
      await expect(answer).toBeHidden({ timeout: 20_000 })
      await quiz.click({ timeout: 20_000 })
      await expect(answer).toBeVisible({ timeout: 20_000 })
      evidence.offlineInteraction = true
      evidence.offlinePageErrors = errors
      expect(errors).toEqual([])
      await context.close()
    }
    expect(runStatus).toBe('completed')
    expect(stages.indexes.orchestrateSkill).toBeGreaterThanOrEqual(0)
    expect(stages.indexes.buildSkill).toBeGreaterThanOrEqual(0)
    expect(stages.m18T01).toBe(true)
    expect(stages.m18T02).toBe(true)
    expect(stages.m18T03).toBe(true)
    expect(evidence.reopenedClean).toBe(true)
    expect(evidence.locations).toBeGreaterThanOrEqual(2)
    expect(evidence.assetCount).toBeGreaterThanOrEqual(1)
    expect(evidence.offlineInteraction).toBe(true)
    expect(receipts.imageReady).toBe(true)
    expect(receipts.mediaLinked).toBe(true)
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
          const stages = relM18StageEvidence([...priorRuns, finalRun])
          evidence.firstPassCompleted = priorRuns.length === 0 && finalRun.status === 'completed'
            && stages.m18T01 && stages.m18T02 && stages.m18T03
          evidence.firstPass = evidence.firstPassCompleted && stages.indexes.failedBuilds.length === 0
          evidence.repair = stages.repairObserved ? 'real build error repaired and admitted'
            : stages.indexes.failedBuilds.length ? 'build error observed; repair unverified' : 'not_observed'
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
        requestedImageModel: imageModel, requestedImageProvider: 'openai',
        requestedImageProtocol: 'chatgpt-responses',
        imageConnectionId: frozenImageConnection!.id, imageConnectionRevision: frozenImageConnection!.revision })
      writeRelResumeManifest(join(directory, 'resume.json'), manifest)
      evidence.resume = { available: true, manifest: join(directory, 'resume.json'),
        explicitPaidGate: 'G20_REL_RESUME_PAID=1', profileLocation: 'per-user LOCALAPPDATA only' }
    }
    const existingResumePending = Boolean(resumeManifest && (!sent || !finalObservedRun
      || ['partial', 'failed', 'interrupted'].includes(finalObservedRun.status)))
    const privateProfilePreserved = true // The formally logged-in profile predates this fresh workspace and is never test-owned.
    if (resumeManifest && !canResumePaid) evidence.resume = { available: !sent,
      manifest: resolve(resumePath!), reason: sent ? 'send outcome requires durable reconciliation' : 'continuation was not sent' }
    evidence.failureEvidence = { privateProfilePreserved, postSendFailure, preserveFailureEvidence,
      existingResumePending,
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
      const child = app.process()
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
        else child.kill('SIGKILL')
      }
      await app.close().catch(() => undefined)
    }
  }
})
