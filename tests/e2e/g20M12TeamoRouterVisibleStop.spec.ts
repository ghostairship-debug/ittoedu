import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const endpoint = 'https://api.teamorouter.com/v1'
const model = process.env.G20_M12_TEAMOROUTER_MODEL || 'deepseek-flash'
const billing = process.env.G20_M12_TEAMOROUTER_BILLING || 'unknown'
const source = '# 正文停止验收\n\n先预测，再观察。\n\n另一段保持原样。\n'

type StopProbe = {
  firstChangedAt: number | null
  firstVisibleAt: number | null
  stopClickedAt: number | null
  stopButton: string | null
  previewLengthAtStop: number
  finishedBeforeStop: boolean
  abortedAt: number | null
  changedLengths: number[]
}

function apiKey(): string {
  const key = process.env.TEAMOROUTER_API_KEY || execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('TEAMOROUTER_API_KEY','User')"], { encoding: 'utf8' }).trim()
  if (!key) throw new Error('TEAMOROUTER_API_KEY is absent; no model request was made')
  return key
}

async function installVisibleStopProbe(page: Page, documentId: string) {
  await page.evaluate(id => {
    const scope = window as typeof window & { __g20M12VisibleStop?: { data: StopProbe; dispose(): void } }
    scope.__g20M12VisibleStop?.dispose()
    const data: StopProbe = { firstChangedAt: null, firstVisibleAt: null, stopClickedAt: null,
      stopButton: null, previewLengthAtStop: 0, finishedBeforeStop: false, abortedAt: null, changedLengths: [] }
    let scheduled = false
    let timeout: number | undefined
    const stop = (reason: 'visible' | 'visibility-timeout') => {
      if (data.stopClickedAt) return
      const region = document.querySelector<HTMLElement>('[aria-label="创作助手"]')
      const button = [...(region?.querySelectorAll('button') ?? [])].find(item =>
        item.textContent?.trim() === '停止' && !item.disabled)
      if (!button) return
      const preview = document.querySelector<HTMLElement>('[data-edit-preview]')
      data.previewLengthAtStop = preview?.textContent?.trim().length ?? 0
      data.stopButton = reason === 'visible' ? '创作助手/停止' : '创作助手/停止（可见超时保护）'
      data.stopClickedAt = performance.now()
      button.click()
    }
    const checkVisible = () => {
      scheduled = false
      if (!data.firstChangedAt || data.firstVisibleAt || data.stopClickedAt) return
      const preview = document.querySelector<HTMLElement>('[data-edit-preview]')
      const text = preview?.textContent?.trim() ?? ''
      if (!preview || !text || text.includes('正在准备正文')) return
      const bounds = preview.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0
        || bounds.top >= innerHeight || bounds.left >= innerWidth) return
      data.firstVisibleAt = performance.now()
      stop('visible')
    }
    const observer = new MutationObserver(() => {
      if (scheduled || data.firstVisibleAt || data.stopClickedAt) return
      scheduled = true
      requestAnimationFrame(() => requestAnimationFrame(checkVisible))
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    const unsubscribe = window.desktopAPI.execution!.subscribeEdits(event => {
      if (event.snapshot.documentId !== id) return
      if (event.type === 'edit.changed' && event.snapshot.value.length > 0) {
        data.changedLengths.push(event.snapshot.value.length)
        if (data.firstChangedAt === null) {
          data.firstChangedAt = performance.now()
          requestAnimationFrame(() => requestAnimationFrame(checkVisible))
          timeout = window.setTimeout(() => stop('visibility-timeout'), 5_000)
        }
      }
      if (event.type === 'edit.finished' && !data.stopClickedAt) data.finishedBeforeStop = true
      if (event.type === 'edit.aborted') data.abortedAt = performance.now()
    })
    scope.__g20M12VisibleStop = { data, dispose() { unsubscribe(); observer.disconnect(); clearTimeout(timeout) } }
  }, documentId)
}

const readProbe = (page: Page) => page.evaluate(() =>
  (window as typeof window & { __g20M12VisibleStop?: { data: StopProbe } }).__g20M12VisibleStop?.data ?? null)

test.use({ trace: 'off' })
test('M12-T05 TeamoRouter DeepSeek visible body fragment then UI Stop leaves the Markdown unchanged', async ({}, info) => {
  test.skip(process.env.G20_M12_TEAMOROUTER_STOP !== '1', 'Opt in explicitly to the real TeamoRouter request')
  test.setTimeout(360_000)
  expect(['unknown', 'metered', 'token-plan', 'prepaid']).toContain(billing)
  const key = apiKey()
  const base = join(root, 'output/g20/m12-teamorouter-visible-stop')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const profile = join(directory, 'profile'), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '正文停止验收.md')
  writeFileSync(filename, source)
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY'].includes(name.toUpperCase())))
  const evidence: Record<string, unknown> = { caseId: 'M12-T05-partial-teamorouter-body-stream-stop',
    route: { provider: 'teamorouter', endpoint, requestedModel: model, declaredBilling: billing,
      actualCharge: 'unknown' }, requestCount: 0, result: 'incomplete' }
  let app: ElectronApplication | undefined
  let stage = 'launch'
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
      env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))

    stage = 'connection'
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('teamorouter')
    await page.getByLabel('账号标识', { exact: true }).fill('owner-m12-visible-stop')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('计费来源', { exact: true }).selectOption(billing)
    await page.getByLabel('API Key', { exact: true }).fill(key)
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
    const connection = settings.connections.find(item => item.connection.provider === 'teamorouter'
      && item.connection.accountId === 'owner-m12-visible-stop')
    expect(connection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: 'teamorouter', baseURL: endpoint, billing: { kind: billing },
    } })
    stage = 'catalog'
    const catalog = await page.evaluate(input => window.desktopAPI.executionSettings!.discoverModels(input.id, input.revision),
      { id: connection!.connection.id, revision: connection!.connection.revision })
    evidence.catalog = { checkedAt: new Date().toISOString(), modelPresent: catalog.models.some(item => item.id === model),
      count: catalog.models.length, capabilitiesVerified: catalog.capabilitiesVerified }
    expect(catalog.models.map(item => item.id), 'Catalog gate before any paid model request').toContain(model)
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(connection!.connection.id)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption(model)
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await expect(page.getByLabel('当前模型', { exact: true })).toContainText(`teamorouter · ${model}`)

    stage = 'workspace'
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const document = await openSelectionFile(page, workspace, '正文停止验收.md')
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, editor, '先预测')
    const before = await readSelectionDocument(page, document.documentId)
    await installVisibleStopProbe(page, document.documentId)

    stage = 'send-and-stop'
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await expect(card).toBeVisible()
    await card.getByLabel('AI 指令', { exact: true }).fill(
      `只修改已选中的“先预测”，调用 text.replace。将它替换为一段较长的教学正文：${'先观察电路，再比较证据，最后解释结论。'.repeat(45)} 保留其他正文。`)
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => (await readProbe(page))?.stopClickedAt ?? null,
      { timeout: 180_000, intervals: [100, 250, 500] }).not.toBeNull()
    const probe = await readProbe(page)
    evidence.probe = probe
    expect(probe?.firstChangedAt, 'Only nonempty edit.changed counts as a body fragment').not.toBeNull()
    expect(probe?.firstVisibleAt, 'The real body must appear in the visible document before Stop').not.toBeNull()
    expect(probe?.stopButton).toBe('创作助手/停止')
    expect(probe?.finishedBeforeStop).toBe(false)
    expect(probe!.firstChangedAt!).toBeLessThanOrEqual(probe!.firstVisibleAt!)
    expect(probe!.firstVisibleAt!).toBeLessThanOrEqual(probe!.stopClickedAt!)
    expect(probe!.previewLengthAtStop).toBeGreaterThan(0)

    const scope = await page.evaluate(async path => {
      const space = await window.desktopAPI.execution!.workspace(path)
      const conversation = space.conversations[0]
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
    }, workspace)
    const submissions = await page.evaluate(input => window.desktopAPI.execution!.submissions(input), scope)
    expect(submissions).toHaveLength(1)
    const runId = submissions[0]?.runId
    expect(runId).toBeTruthy()
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.execution!.run(id), runId!))?.status,
      { timeout: 60_000 }).toBe('stopped')
    const run = await page.evaluate(id => window.desktopAPI.execution!.run(id), runId!)
    evidence.run = { status: run?.status, failure: run?.failure?.code ?? null,
      frozen: { provider: run?.input.selection.connection.provider, baseURL: run?.input.selection.connection.baseURL,
        billing: run?.input.selection.connection.billing.kind, model: run?.input.selection.model,
        documentId: run?.input.documents[0]?.documentId, selection: run?.input.documents[0]?.selection },
      requests: run?.requests.map(item => ({ state: item.state, actualModel: item.actualModel ?? null,
        failureCode: item.failure?.code ?? null })) ?? [], tools: run?.tools.length ?? 0 }
    evidence.requestCount = run?.requests.length ?? 0
    expect(run?.input.selection.connection).toMatchObject({ provider: 'teamorouter', baseURL: endpoint,
      billing: { kind: billing } })
    expect(run?.input.selection.model).toBe(model)
    expect(run?.input.documents[0]?.documentId).toBe(document.documentId)
    expect(run?.requests.length).toBeGreaterThan(0)
    expect(run?.tools.filter(item => item.result?.kind === 'document-operation'
      && item.result.result.status === 'applied')).toHaveLength(0)
    await page.waitForTimeout(2_000)
    expect((await readProbe(page))?.abortedAt).not.toBeNull()
    const after = await readSelectionDocument(page, document.documentId)
    evidence.document = { beforeRevision: before.revision, afterRevision: after.revision,
      beforeUndoDepth: before.undoDepth, afterUndoDepth: after.undoDepth,
      unchanged: JSON.stringify(after.model) === JSON.stringify(before.model) }
    expect(after).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: before.model })
    expect(readFileSync(filename, 'utf8')).toBe(source)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 正文停止验收.md', exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, '正文停止验收.md')
    evidence.reopened = { revision: reopened.revision, undoDepth: reopened.undoDepth,
      sourceUnchanged: (reopened.model as { source?: string }).source === source }
    expect(reopened).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: before.model })
    evidence.result = 'passed'
    await page.screenshot({ path: join(directory, 'stopped-and-reopened.png') })
    await info.attach('TeamoRouter stopped and reopened', { path: join(directory, 'stopped-and-reopened.png'), contentType: 'image/png' })
  } catch (error) {
    evidence.result = 'failed'; evidence.failedStage = stage
    evidence.error = String(error).replaceAll(key, '[redacted]')
    throw error
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2).replaceAll(key, '[redacted]'))
    await info.attach('M12 TeamoRouter visible Stop evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeSelectionApp(app)
  }
})
