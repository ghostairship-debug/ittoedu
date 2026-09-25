import { _electron as electron, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../src/core/drivers/codecs/archivePath'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const packageId = 'com.example.v9-quiz'
const packageVersion = '4.0.0'
const packageKey = componentPackageKey(packageId, packageVersion)
const runtimePath = `components/${packageId}@${packageVersion}/runtime.js`
async function createCourseFixture(coursePath: string) {
  const sourceArchive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/component.h5lesson'))))
  const fallback = new Uint8Array(await sharp({ create: { width: 400, height: 240, channels: 4, background: '#dbeafe' } }).png().toBuffer())
  const project = structuredClone(sourceArchive.project)
  const fallbackMeta = project.assets['quiz-fallback']
  if (!fallbackMeta || fallbackMeta.kind !== 'image') throw new Error('Component fixture fallback missing')
  project.assets['quiz-fallback'] = { ...fallbackMeta, mimeType: 'image/png', byteLength: fallback.byteLength, width: 400, height: 240 }
  writeFileSync(coursePath, createCourseProjectArchive({
    project, assetFiles: { ...sourceArchive.assetFiles, 'quiz-fallback': fallback }, componentFiles: sourceArchive.componentFiles,
  }))
  return { originalSource: new TextDecoder().decode(sourceArchive.componentFiles[packageKey]!['runtime.js']),
    beforeHash: project.componentPackages[packageId]!.contentSha256 }
}
const route = process.env.G20_S13_ROUTE === 'deepseek' ? {
  provider: 'deepseek-official', baseURL: 'https://api.deepseek.com/v1', key: process.env.DEEPSEEK_API_KEY,
} : {
  provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', key: process.env.TEAMOROUTER_API_KEY,
}
const model = process.env.G20_S13_MODEL || 'deepseek-flash'
test.use({ trace: 'off' }) // Playwright traces can capture page.evaluate arguments, including the test credential.

test('S13 initialization preflight authorizes the workspace and preserves an unsent V9 draft without model traffic', async () => {
  test.skip(process.env.G20_S13_PREFLIGHT !== '1', 'Run only when explicitly checking the zero-network setup')
  const directory = mkdtempSync(join(tmpdir(), 'g20-s13-preflight-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const coursePath = join(workspace, '受控构建预检.h5lesson')
  await createCourseFixture(coursePath)
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await page.evaluate(async () => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 's13-preflight-local-only', connection: {
        provider: 's13-preflight-local', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:9/v1', accountId: 'fixture',
        authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: connection.connection.id, model: 's13-preflight' },
        vision: null, imageGenerate: null, imageEdit: null,
      } })
    })
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.locator('.lesson-directory-tree').getByRole('button', { name: '受控构建预检.h5lesson', exact: true })).toBeVisible()
    const initialized = await page.evaluate(async input => {
      const document = await window.desktopAPI!.documents!.open(input.coursePath)
      const execution = window.desktopAPI!.execution!
      const space = await execution.workspace(input.workspace)
      const conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const draft = await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        expectedRevision: conversation.revision, text: 'S13 受控构建预检草稿',
        documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision,
          writable: [{ kind: 'document' }] }], attachments: [] })
      return { kind: document.model.kind, documentId: document.documentId, workspaceId: space.workspace.workspaceId,
        draft: draft.inputDraft, submissions: await execution.submissions({ workspaceId: space.workspace.workspaceId,
          conversationId: conversation.conversationId }), runIds: draft.runIndex.builtinRunIds }
    }, { coursePath, workspace })
    expect(initialized).toMatchObject({ kind: 'course-v9', draft: 'S13 受控构建预检草稿', submissions: [], runIds: [] })
    expect(initialized.documentId).toBeTruthy()
    expect(initialized.workspaceId).toBeTruthy()
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('S13-T01 actual API repairs a Component through one Engine, real admission, import and reopen', async ({}, info) => {
  test.skip(process.env.G20_S13_REAL_API !== '1', 'Run only with an explicitly selected actual API connection')
  test.setTimeout(900_000)
  if (!route.key) throw new Error('Selected API credential is unavailable in this test process')
  const output = join(root, 'output/g20/s13/real-api')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'g20-s13-real-api-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const coursePath = join(workspace, '受控构建真实模型.h5lesson')
  const { originalSource, beforeHash } = await createCourseFixture(coursePath)
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const admissionWindows = new Set<string>()
  app.on('window', worker => {
    const observe = () => { if (worker.url().includes('/admission.html')) admissionWindows.add(worker.url()) }
    observe(); worker.on('framenavigated', observe)
  })
  let runId = '', documentId = '', workspaceId = '', conversationId = '', submissionId = '', setupStage = 'launch'
  let catalog: { source: 'product-discover-models'; checkedAt: string; modelCount: number; selectedModelId: string;
    selectedModelPresent: true; capabilitiesVerified: false } | null = null
  let pageErrors: string[] = []
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    setupStage = 'connection'
    const connection = await page.evaluate(async input => {
      const settings = window.desktopAPI!.executionSettings!
      return settings.saveConnection({ apiKey: input.key, connection: {
        provider: input.provider, protocol: 'openai-chat', baseURL: input.baseURL, accountId: 'owner-s13-test',
        authKind: 'api-key', billing: { kind: 'unknown' },
      } })
    }, route)
    setupStage = 'model.catalog'
    const discovered = await page.evaluate(async input => {
      const models = await window.desktopAPI!.executionSettings!.discoverModels(input.connectionId, input.connectionRevision)
      if (!models.models.some(entry => entry.id === input.model)) throw new Error('Requested model is absent from the current supplier catalog')
      return { modelCount: models.models.length, selectedModelId: input.model,
        selectedModelPresent: true as const, capabilitiesVerified: models.capabilitiesVerified }
    }, { connectionId: connection.connection.id, connectionRevision: connection.connection.revision, model })
    catalog = { source: 'product-discover-models', checkedAt: new Date().toISOString(), ...discovered }
    setupStage = 'profile'
    await page.evaluate(async input => {
      await window.desktopAPI!.executionSettings!.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: input.connectionId, model: input.model },
        vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, { connectionId: connection.connection.id, model })
    setupStage = 'workspace.authorize'
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.locator('.lesson-directory-tree').getByRole('button', { name: '受控构建真实模型.h5lesson', exact: true })).toBeVisible()
    setupStage = 'document.open'
    const document = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), coursePath)
    documentId = document.documentId
    setupStage = 'workspace'
    const space = await page.evaluate(async directory => window.desktopAPI!.execution!.workspace(directory), workspace)
    workspaceId = space.workspace.workspaceId
    setupStage = 'conversation'
    const conversation = space.conversations[0] ?? await page.evaluate(async id => window.desktopAPI!.execution!.createConversation(id), space.workspace.workspaceId)
    conversationId = conversation.conversationId
    const instruction = [
        '在当前唯一 V9 文档的组件包 com.example.v9-quiz 里修改 runtime.js。目标：保持已有 API 4 组件和按钮“显示答案”，点击后显示“答案已解锁：构建修复成功。”，保持 update/resize/suspend/resume/destroy 生命周期。',
        `只用同一执行器的 build 工具，路径为 ${runtimePath}。先 build.create，读取 runtime.js 和 project.json。`,
        '为了验证错误修复闭环，先在 scratch 的 runtime.js 写入确切的坏源码 window.CoursewareComponent.define({create:function(，调用 build.compile 并读取 build.logs 里的真实语法错误。随后依据原源码重新写出完整有效组件源码，重新 compile。',
        '接着 build.check，buttonCheck 使用 instanceId slide-quiz、label 显示答案。若日志报告组件暂存内容校验值不一致，请读取 project.json，只更新 componentPackages 中该组件的 contentSha256 为日志给出的值，写回完整 JSON 并重新 build.check。',
        '收到 ready artifact 后调用 build.import；只有 applied 才报告已经应用。不要调用外部 CLI 或 shell，不要改正式文件路径。预算内有错误就读取精确日志修复。',
      ].join('\n')
    const reference = { documentId: document.documentId, epoch: document.epoch, revision: document.revision,
      writable: [{ kind: 'document' as const }] }
    setupStage = 'draft'
    const draft = await page.evaluate(async input => window.desktopAPI!.execution!.draft(input), {
      workspaceId: space.workspace.workspaceId, conversationId, expectedRevision: conversation.revision,
      text: instruction, documents: [reference], attachments: [],
    })
    setupStage = 'send'
    submissionId = randomUUID()
    const sent = await page.evaluate(async input => window.desktopAPI!.execution!.send(input), {
      workspaceId: space.workspace.workspaceId, conversationId, expectedRevision: draft.revision,
      submissionId, text: instruction, documents: [reference], attachments: [],
    })
    if (!sent.run) throw new Error('The actual model run did not start')
    runId = sent.run.runId
    setupStage = 'run'
    const run = await expect.poll(async () => {
      const current = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId)
      return current && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(current.status) ? current : null
    }, { timeout: 780_000, intervals: [1000, 2000, 3000] }).toBeTruthy()
    void run
    const result = await page.evaluate(async input => ({
      run: await window.desktopAPI!.execution!.run(input.runId),
      submission: await window.desktopAPI!.execution!.submission({ workspaceId: input.workspaceId,
        conversationId: input.conversationId, submissionId: input.submissionId }),
      document: await window.desktopAPI!.documents!.read(input.documentId),
      events: await window.desktopAPI!.execution!.events(input.conversationId, 0, 500),
    }), { runId, documentId, workspaceId, conversationId, submissionId })
    const tools = result.run!.tools.map(tool => ({ name: tool.call.name, state: tool.state,
      resultKind: tool.result?.kind ?? null,
      resultStatus: tool.result?.kind === 'document-operation' ? tool.result.result.status
        : tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
          ? ('status' in tool.result.data ? tool.result.data.status : 'ok' in tool.result.data ? tool.result.data.ok : null)
          : null }))
    const usage = result.events.events.filter(event => event.type === 'usage').map(event => event.data)
    const evidence = {
      route: route.provider, endpoint: route.baseURL, requestedModel: model, accountBillingType: 'unknown',
      catalog,
      submissionState: result.submission?.state ?? null, submissionFailure: result.submission?.failure ?? null,
      runStatus: result.run!.status, runFailure: result.run!.failure ?? null,
      requests: result.run!.requests.map(request => ({ state: request.state, actualModel: request.actualModel ?? null,
        failure: request.failure ?? null })),
      tools, usage, admissionWindows: [...admissionWindows], pageErrors,
      beforeRevision: 0, afterRevision: result.document.revision, undoDepth: result.document.undoDepth,
      beforeHash, afterHash: result.document.model.kind === 'course-v9'
        ? result.document.model.project.componentPackages[packageId]?.contentSha256 : null,
    }
    const evidenceFile = join(output, `run-${runId}.json`)
    writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2)
      .replaceAll(route.key, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]'))
    await info.attach('S13 actual API result', { path: evidenceFile, contentType: 'application/json' })
    expect(result.run!.status).toBe('completed')
    expect(tools.some(tool => tool.name === 'build.compile' && tool.resultStatus === false)).toBe(true)
    expect(tools.some(tool => tool.name === 'build.logs')).toBe(true)
    expect(tools.some(tool => tool.name === 'build.check' && tool.resultStatus === 'ready')).toBe(true)
    expect(tools.some(tool => tool.name === 'build.import' && tool.resultStatus === 'applied')).toBe(true)
    expect(admissionWindows.size).toBeGreaterThan(0)
    expect(result.document.model.kind).toBe('course-v9')
    if (result.document.model.kind !== 'course-v9') throw new Error('Expected V9 course')
    const changedSource = new TextDecoder().decode(result.document.model.resources.components[packageKey]!['runtime.js'])
    expect(changedSource).not.toBe(originalSource)
    expect(changedSource).toContain('答案已解锁：构建修复成功。')
    expect(result.document.model.project.componentPackages[packageId]!.contentSha256)
      .toBe(componentContentSha256(result.document.model.resources.components[packageKey]!))
    expect(result.document.undoDepth).toBe(1)
    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const imported = await documents.read(input.documentId)
      const undo = await documents.dispatch({ documentId: imported.documentId, epoch: imported.epoch,
        baseRevision: imported.revision, operationId: 's13-real-undo', actor: 'human', mutation: { type: 'undo' } })
      const undone = await documents.read(input.documentId)
      const redo = await documents.dispatch({ documentId: undone.documentId, epoch: undone.epoch,
        baseRevision: undone.revision, operationId: 's13-real-redo', actor: 'human', mutation: { type: 'redo' } })
      const redone = await documents.read(input.documentId)
      await documents.save(input.documentId)
      await documents.close(input.documentId)
      const reopened = await documents.open(input.coursePath)
      return { undoStatus: undo.status, undoDepth: undone.undoDepth, redoDepth: undone.redoDepth,
        redoStatus: redo.status, redoneUndoDepth: redone.undoDepth,
        reopenedDirty: reopened.dirty, reopenedRevision: reopened.revision }
    }, { documentId, coursePath })
    expect(history).toMatchObject({ undoStatus: 'applied', undoDepth: 0, redoDepth: 1,
      redoStatus: 'applied', redoneUndoDepth: 1, reopenedDirty: false })
    const reopened = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(new TextDecoder().decode(reopened.componentFiles[packageKey]!['runtime.js'])).toBe(changedSource)
    copyFileSync(coursePath, join(output, `run-${runId}.h5lesson`))
    writeFileSync(join(output, `run-${runId}-history.json`), JSON.stringify(history, null, 2))
    expect(pageErrors).toEqual([])
  } catch (error) {
    const page = app.windows()[0]
    const submission = page && workspaceId && conversationId && submissionId
      ? await page.evaluate(async input => window.desktopAPI!.execution!.submission(input), { workspaceId, conversationId, submissionId }).catch(() => null)
      : null
    const knownRunId = runId || submission?.runId || ''
    const run = page && knownRunId ? await page.evaluate(async id => window.desktopAPI!.execution!.run(id), knownRunId).catch(() => null) : null
    const profile = join(directory, 'profile', 'workbench-v2')
    const count = (relative: string) => existsSync(join(profile, relative)) ? readdirSync(join(profile, relative)).length : 0
    const diagnostics = join(directory, 'profile', 'diagnostics', 'editor-diagnostics.jsonl')
    writeFileSync(join(output, 'last-failure.json'), JSON.stringify({ route: route.provider, requestedModel: model, catalog,
      runId: knownRunId, documentId, setupStage, submissionState: submission?.state ?? null,
      submissionFailure: submission?.failure ?? null, status: run?.status ?? null,
      requests: run?.requests.map(request => ({ state: request.state,
        actualModel: request.actualModel ?? null, failure: request.failure ?? null })) ?? [],
      tools: run?.tools.map(tool => ({ name: tool.call.name, state: tool.state,
        resultKind: tool.result?.kind ?? null })) ?? [], runFileCount: count('runs'), submissionFileCount: count('submissions'),
      diagnostics: existsSync(diagnostics) ? readFileSync(diagnostics, 'utf8').slice(-8000) : null,
      admissionWindows: [...admissionWindows], pageErrors,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    }, null, 2).replaceAll(route.key, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]'))
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    rmSync(directory, { recursive: true, force: true })
  }
})
