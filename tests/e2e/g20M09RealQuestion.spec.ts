import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { USER_QUESTION_TOOL } from '../../src/shared/workbench/userQuestion'
import { openSelectionFile, readSelectionDocument, selectVisibleText } from './helpers/g20SelectionHarness'

// M09-T04 real half: one ordinary task on the owner-authorized DeepSeek route (TeamoRouter, the
// executor's API tool-calling path). The model must ask with the option card, not in plain text,
// then continue the same run with the choice. Keys are read at run time and never written.
const root = resolve(__dirname, '../..')
const endpoint = 'https://api.teamorouter.com/v1'
const requestedModel = process.env.G20_M09_MODEL || 'deepseek-flash'
const source = '# 电路\n\n并联电路中各支路两端的电压相等。\n'
const sentence = '并联电路中各支路两端的电压相等'
function userKey(): string {
  const value = process.env.TEAMOROUTER_API_KEY || execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('TEAMOROUTER_API_KEY','User')"], { encoding: 'utf8' }).trim()
  if (!value || /[\r\n]/.test(value)) throw new Error('TEAMOROUTER_API_KEY is not configured in the process or Windows User environment')
  return value
}

test('M09-T04 real DeepSeek task asks through the option card and continues with the chosen option', async () => {
  test.setTimeout(900_000)
  const key = userKey(), scrub = (value: unknown) => String(value).split(key).join('[redacted]')
  const output = join(root, 'output/g20/m09/real-question'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), profile = join(directory, 'profile'), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '真实提问.md'); writeFileSync(filename, source)
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY'].includes(name.toUpperCase())))
  const evidence: Record<string, unknown> = { caseId: 'M09-T04', mode: 'real-model', provider: 'teamorouter', endpoint, requestedModel,
    billing: 'metered (Owner 2026-09-24); actual charge unknown', manualIntervention: ['脚本通过界面发送一次任务并点选一项'] }
  let app: ElectronApplication | undefined, stage = 'launch', connectionId = '', runId = ''
  const startedAt = Date.now(), errors: string[] = []
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
    page.on('pageerror', error => errors.push(scrub(error.message)))
    stage = 'connection'
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('teamorouter')
    await page.getByLabel('账号标识', { exact: true }).fill('owner-m09-real-question')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill(key)
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
    const connection = settings.connections.find(entry => entry.connection.provider === 'teamorouter' && entry.connection.accountId === 'owner-m09-real-question')!
    connectionId = connection.connection.id
    const catalog = await page.evaluate(async input => (await window.desktopAPI.executionSettings!.discoverModels(input.id, input.revision)).models.map(model => model.id),
      { id: connection.connection.id, revision: connection.connection.revision })
    evidence.catalog = { checkedAt: new Date().toISOString(), modelCount: catalog.length, requestedModelPresent: catalog.includes(requestedModel) }
    expect(catalog, 'Requested model must be in the live supplier catalog before paid traffic').toContain(requestedModel)
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(connection.connection.id)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption(requestedModel)
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    stage = 'workspace'
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const document = await openSelectionFile(page, workspace, '真实提问.md')
    const scope = await page.evaluate(async selected => {
      const space = await window.desktopAPI.execution!.workspace(selected)
      const conversation = space.conversations[0] ?? await window.desktopAPI.execution!.createConversation(space.workspace.workspaceId)
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
    }, workspace)

    stage = 'send'
    await selectVisibleText(page, page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true }), sentence)
    const target = page.getByLabel('当前编辑目标', { exact: true })
    const instruction = '把选中的句子改写成适合初二学生的讲解。动手前先问我要“简洁版”还是“详细版”，再按我的选择改写。'
    await target.getByLabel('AI 指令', { exact: true }).fill(instruction)
    await target.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    evidence.instruction = instruction
    runId = await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.execution!.conversation(input.workspaceId, input.conversationId), scope))
      ?.runIndex.builtinRunIds.at(-1) ?? null, { timeout: 60_000 }).not.toBeNull().then(() => page.evaluate(async input =>
      (await window.desktopAPI.execution!.conversation(input.workspaceId, input.conversationId))!.runIndex.builtinRunIds.at(-1)!, scope))
    evidence.runId = runId

    stage = 'question'
    const card = page.getByRole('region', { name: 'AI 的提问', exact: true })
    const askedOrEnded = await expect.poll(async () => await card.isVisible() ? 'asked'
      : ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes((await page.evaluate(id => window.desktopAPI.execution!.run(id), runId))?.status ?? '') ? 'ended' : null,
    { timeout: 300_000, intervals: [500] }).not.toBeNull().then(async () => await card.isVisible() ? 'asked' : 'ended')
    if (askedOrEnded === 'ended') {
      const run = await page.evaluate(id => window.desktopAPI.execution!.run(id), runId)
      evidence.noQuestion = { status: run?.status, tools: run?.tools.map(tool => tool.call.name), finalText: run?.messages.filter(message => message.role === 'assistant').map(message => message.content) }
      throw new Error('model-ended-without-option-card-question')
    }
    const question = { text: (await card.locator('.execution-question__text').innerText()).trim(),
      options: await card.getByRole('group', { name: '可选答案', exact: true }).getByRole('button').allInnerTexts() }
    evidence.question = question
    evidence.questionShownAfterMs = Date.now() - startedAt
    await page.screenshot({ path: join(directory, 'real-question-card.png') })
    const buttons = card.getByRole('group', { name: '可选答案', exact: true }).getByRole('button')
    const simple = buttons.filter({ hasText: '简洁' })
    const chosen = await simple.count() ? simple.first() : buttons.first()
    const chosenLabel = (await chosen.locator('span').first().innerText()).trim()
    evidence.chosen = chosenLabel
    await chosen.click()

    stage = 'continue'
    await expect(card).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.execution!.run(id), runId))?.status, { timeout: 600_000, intervals: [1_000] })
      .toMatch(/^(completed|partial|failed|stopped|interrupted)$/)
    const run = (await page.evaluate(id => window.desktopAPI.execution!.run(id), runId))!
    const usage = await page.evaluate(async id => {
      const all = []; let after = 0, more = true
      while (more) { const chunk = await window.desktopAPI.execution!.events(id, after, 5000); all.push(...chunk.events); after = chunk.cursor; more = chunk.hasMore }
      return all.filter(item => item.type === 'usage').map(item => item.data.usage ?? null)
    }, scope.conversationId)
    const after = await readSelectionDocument(page, document.documentId)
    const askIndex = run.tools.findIndex(tool => tool.call.name === USER_QUESTION_TOOL)
    const firstMutation = run.tools.findIndex(tool => tool.result?.kind === 'document-operation')
    const facts = {
      status: run.status, failure: run.failure ? { code: run.failure.code, message: scrub(run.failure.message) } : null,
      requests: run.requests.map(request => ({ state: request.state, actualModel: request.actualModel ?? null, failure: request.failure?.code ?? null })),
      tools: run.tools.map(tool => ({ name: tool.call.name, result: tool.result?.kind ?? null, code: tool.result?.kind === 'error' ? tool.result.code : null,
        status: tool.result?.kind === 'document-operation' ? tool.result.result.status : null })),
      askAnswer: askIndex >= 0 ? run.tools[askIndex]!.result : null, askBeforeFirstEdit: askIndex >= 0 && (firstMutation < 0 || askIndex < firstMutation),
      usageEvents: usage.length, usageTotals: ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'].reduce((total, key) =>
        ({ ...total, [key]: usage.reduce((sum, item) => sum + ((item as Record<string, number> | null)?.[key] ?? 0), 0) }), {}),
      sourceAfter: after.model.kind === 'markdown' ? after.model.source : null, pageErrors: errors, elapsedMs: Date.now() - startedAt,
    }
    evidence.facts = facts
    await page.screenshot({ path: join(directory, 'real-after-answer.png') })
    expect(askIndex, 'the model asked through ask_user').toBeGreaterThanOrEqual(0)
    expect(facts.askBeforeFirstEdit).toBe(true)
    expect(run.tools[askIndex]!.result).toMatchObject({ kind: 'read', data: { status: 'answered', selected: [{ label: chosenLabel }] } })
    expect(run.status).toBe('completed')
    expect(run.tools.some(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toBe(true)
    expect(facts.sourceAfter).not.toBe(source)
    expect(facts.sourceAfter).toContain('# 电路')
    expect(errors).toEqual([])
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'; evidence.stage = stage; evidence.failure = scrub(error instanceof Error ? error.message : error)
    if (app) await app.firstWindow().then(page => page.screenshot({ path: join(directory, 'failure.png') })).catch(() => undefined)
    throw error
  } finally {
    if (app) {
      // Settle any open run first, then remove the runtime credential from this throwaway profile.
      const page = await app.firstWindow().catch(() => undefined)
      if (page && runId) await page.evaluate(id => window.desktopAPI.execution!.stop(id), runId).catch(() => undefined)
      if (page && connectionId) evidence.credentialRevoked = await page.evaluate(id => window.desktopAPI.executionSettings!.revokeConnection(id), connectionId)
        .then(() => true, () => false)
    }
    writeFileSync(join(directory, 'evidence.json'), scrub(JSON.stringify(evidence, null, 2)))
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
  }
})
