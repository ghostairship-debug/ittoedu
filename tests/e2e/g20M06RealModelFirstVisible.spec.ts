import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ExecutionTimingMark } from '../../src/main/workbench/execution/ExecutionEventStore'
import { closeSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText } from './helpers/g20SelectionHarness'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const endpoint = 'https://api.teamorouter.com/v1'
const requestedModel = process.env.G20_M06_MODEL || 'deepseek-flash'
const terminal = new Set(['completed', 'partial', 'failed', 'stopped', 'interrupted'])
const source = '# 电路观察\n\n甲段：先预测😀，再观察。\n\n乙段：保持原样。\n'

// The key is read only when the explicitly gated test runs. It is never passed
// to the Electron child environment, test trace, evidence JSON, or attachment.
function userKey(): string {
  const value = process.env.TEAMOROUTER_API_KEY || execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('TEAMOROUTER_API_KEY','User')"], { encoding: 'utf8' }).trim()
  if (!value) throw new Error('TEAMOROUTER_API_KEY is not configured in the process or Windows User environment')
  return value
}

function timingTraces(profile: string): { taskId: string; marks: ExecutionTimingMark[] }[] {
  const events = join(profile, 'workbench-v2', 'events')
  if (!existsSync(events)) return []
  return readdirSync(events, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const directory = join(events, entry.name, 'timing')
    if (!existsSync(directory)) return []
    return readdirSync(directory).filter(name => name.endsWith('.json')).map(name =>
      JSON.parse(readFileSync(join(directory, name), 'utf8')) as { taskId: string; marks: ExecutionTimingMark[] })
  })
}

function mainGap(marks: ExecutionTimingMark[], from: ExecutionTimingMark['stage'], to: ExecutionTimingMark['stage'], requestId?: string) {
  const a = marks.find(mark => mark.stage === from && (!requestId || mark.requestId === requestId))
  const b = marks.find(mark => mark.stage === to && (!requestId || mark.requestId === requestId))
  return a && b && a.process === 'main' && b.process === 'main' && a.clockInstanceId === b.clockInstanceId
    ? Math.round((b.monotonicMs - a.monotonicMs) * 10) / 10 : null
}

type ProbeStamp = { clockInstanceId: string; timeOriginMs: number; monotonicMs: number; wallTimeMs: number }
type Probe = { firstContentReceipt: (ProbeStamp & { sequence: number; length: number }) | null;
  firstVisible: ProbeStamp | null; editFinished: ProbeStamp | null; changedLengths: number[] }

function decodedToVisibleUpperBound(marks: ExecutionTimingMark[], probe: Probe | null, requestId?: string): number | null {
  const sent = marks.find(mark => mark.stage === 'renderer.send.invoked')
  const received = marks.find(mark => mark.stage === 'submit.received')
  const decoded = marks.find(mark => mark.stage === 'edit.content-decoded' && mark.requestId === requestId)
  const visible = probe?.firstVisible
  if (!requestId || !sent || !received || !decoded || !visible
    || sent.process !== 'renderer' || received.process !== 'main' || decoded.process !== 'main'
    || sent.clockInstanceId !== visible.clockInstanceId || sent.timeOriginMs !== visible.timeOriginMs
    || received.clockInstanceId !== decoded.clockInstanceId) return null
  const rendererElapsed = visible.monotonicMs - sent.monotonicMs
  const mainElapsed = decoded.monotonicMs - received.monotonicMs
  const upperBound = rendererElapsed - mainElapsed
  return Number.isFinite(upperBound) && rendererElapsed >= 0 && mainElapsed >= 0 && upperBound >= 0
    ? Math.round(upperBound * 10) / 10 : null
}

async function installProbe(page: Page, documentId: string) {
  await page.evaluate(id => {
    const scope = window as typeof window & { __g20M06Probe?: {
      data: Probe; dispose(): void
    } }
    scope.__g20M06Probe?.dispose()
    const stamp = (): ProbeStamp => ({ clockInstanceId: String(performance.timeOrigin),
      timeOriginMs: performance.timeOrigin, monotonicMs: performance.now(), wallTimeMs: Date.now() })
    const data: Probe = { firstContentReceipt: null, firstVisible: null, editFinished: null, changedLengths: [] }
    let scheduled = false
    const visible = () => {
      scheduled = false
      if (data.firstVisible || !data.firstContentReceipt) return
      const preview = document.querySelector<HTMLElement>('[data-edit-preview]')
      if (!preview || !preview.textContent?.trim() || preview.textContent.includes('正在准备正文')) return
      const rect = preview.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth) data.firstVisible = stamp()
    }
    const observer = new MutationObserver(() => {
      if (!scheduled && !data.firstVisible) {
        scheduled = true
        requestAnimationFrame(() => requestAnimationFrame(visible))
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    const unsubscribe = window.desktopAPI.execution!.subscribeEdits(event => {
      if (event.snapshot.documentId !== id) return
      if (event.type === 'edit.changed' && event.snapshot.sequence >= 0 && event.snapshot.value.length > 0) {
        data.changedLengths.push(event.snapshot.value.length)
        data.firstContentReceipt ??= { ...stamp(), sequence: event.snapshot.sequence, length: event.snapshot.value.length }
      }
      if (event.type === 'edit.finished') data.editFinished ??= stamp()
    })
    scope.__g20M06Probe = { data, dispose() { unsubscribe(); observer.disconnect() } }
  }, documentId)
}
const readProbe = (page: Page) => page.evaluate(() => (window as typeof window & { __g20M06Probe?: { data: Probe } }).__g20M06Probe?.data ?? null)

// Owner 2026-09-24: sends never show a service notice; callers prove the send by its submission.
async function sendInline(page: Page, instruction: string) {
  const card = page.getByLabel('当前编辑目标', { exact: true })
  await expect(card).toBeVisible()
  await card.getByLabel('AI 指令', { exact: true }).fill(instruction)
  await card.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}
const expectNoDisclosure = (page: Page) => expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)

test.use({ trace: 'off' })
test('M06-T01/S05-T06 actual TeamoRouter body fragments reach the selected Markdown and remain one canonical edit', async ({}, info) => {
  test.skip(process.env.G20_M06_REAL_API !== '1', 'Real model and Electron run is opt-in for the shared serial slot')
  test.setTimeout(900_000)
  const key = userKey()
  const output = join(root, 'output/g20/m06/real-first-visible')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const profile = join(directory, 'profile'), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '真实流式正文.md')
  writeFileSync(filename, source)
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY'].includes(name.toUpperCase())))
  let app: ElectronApplication | undefined
  const evidence: Record<string, unknown> = { provider: 'teamorouter', endpoint, requestedModel,
    accountBillingType: 'unknown', actualCharge: 'unknown', catalog: null, rounds: [],
    measurement: ['Renderer IPC edit.changed receipt to two requestAnimationFrame DOM visibility uses one renderer monotonic clock.',
      'Main decoded body to Renderer double-RAF visibility has a conservative upper bound: Renderer visibility minus send invocation, less Main decoded-body minus submit receipt. Both differences use their own monotonic clock and matching clock identity.',
      'Main provider.first-content and renderer visibility are separate clocks; timeOrigin alignment is an estimate.',
      'A first tool-arguments mark can include target JSON before any usable content. It is not itself proof of visible body streaming.',
      'save.finished measures the explicit file save after a canonical commit; model completion alone is not a disk save.'] }
  let stage = 'launch'
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
      env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    stage = 'connection'
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('teamorouter')
    await page.getByLabel('账号标识', { exact: true }).fill('owner-m06-real-test')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill(key)
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
    const connection = settings.connections.find(entry => entry.connection.provider === 'teamorouter'
      && entry.connection.accountId === 'owner-m06-real-test')
    expect(connection, 'The configured product connection must exist before catalog discovery').toBeTruthy()
    stage = 'catalog'
    const catalog = await page.evaluate(async input => {
      const result = await window.desktopAPI.executionSettings!.discoverModels(input.id, input.revision)
      return { ids: result.models.map(model => model.id), capabilitiesVerified: result.capabilitiesVerified }
    }, { id: connection!.connection.id, revision: connection!.connection.revision })
    evidence.catalog = { checkedAt: new Date().toISOString(), source: 'product-discover-models',
      selectedModelPresent: catalog.ids.includes(requestedModel), modelCount: catalog.ids.length,
      capabilitiesVerified: catalog.capabilitiesVerified }
    expect(catalog.ids, 'Requested model must be present in the live supplier catalog before paid traffic').toContain(requestedModel)
    stage = 'profile'
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(connection!.connection.id)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption(requestedModel)
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await expect(page.getByText('未配置对话模型', { exact: true })).toHaveCount(0)
    stage = 'workspace'
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const document = await openSelectionFile(page, workspace, '真实流式正文.md')
    const region = page.getByRole('region', { name: '教学文档 真实流式正文.md', exact: true })
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    const scope = await page.evaluate(async selected => {
      const space = await window.desktopAPI.execution!.workspace(selected)
      const conversation = space.conversations[0] ?? await window.desktopAPI.execution!.createConversation(space.workspace.workspaceId)
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
    }, workspace)
    let previousSubmissions = 0
    const rounds: { name: string; selected: string; replacement: string }[] = [
      { name: 'cold', selected: '先预测😀', replacement: '先观察😀，记录电流变化。\n再解释：“并联\\支路”的电压关系。' },
      { name: 'warm', selected: '先观察😀', replacement: '先比较😀，列出两条证据。\n再解释：“串联\\回路”中的电流。' },
    ]
    for (const round of rounds) {
      stage = `${round.name}.send`
      await selectVisibleText(page, editor, round.selected)
      const before = await readSelectionDocument(page, document.documentId)
      await installProbe(page, document.documentId)
      // The compact inline AI field is single-line. Encode the requested value
      // so a literal line break and backslash survive that input boundary.
      await sendInline(page, `只修改已选中的正文，调用 text.replace。content 必须等于此 JSON 字符串解码后的值：${JSON.stringify(round.replacement)}。其中 \\n 表示真实换行 U+000A；保留其余正文。收到 applied 回执后结束，不要再读取已修改的旧选区。`)
      const submission = await expect.poll(async () => {
        const all = await page.evaluate(input => window.desktopAPI.execution!.submissions(input), scope)
        return all.length > previousSubmissions ? all.at(-1) : null
      }, { timeout: 45_000 }).toBeTruthy()
      void submission
      const all = await page.evaluate(input => window.desktopAPI.execution!.submissions(input), scope)
      previousSubmissions = all.length
      await expectNoDisclosure(page)
      const latest = all.at(-1)!
      const runId = await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.execution!.submission(input),
        { ...scope, submissionId: latest.submissionId }))?.runId ?? null, { timeout: 45_000 }).not.toBeNull()
      void runId
      const id = (await page.evaluate(input => window.desktopAPI.execution!.submission(input), { ...scope, submissionId: latest.submissionId }))!.runId!
      await expect.poll(async () => {
        const status = (await page.evaluate(run => window.desktopAPI.execution!.run(run), id))?.status
        return status && terminal.has(status) ? status : null
      }, { timeout: 300_000, intervals: [500, 1000, 2000] }).not.toBeNull()
      const result = await page.evaluate(run => window.desktopAPI.execution!.run(run), id)
      const after = await readSelectionDocument(page, document.documentId)
      const probe = await readProbe(page)
      const observation = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
      const eventPage = await page.evaluate(input => window.desktopAPI.execution!.events(input, 0, 500), scope.conversationId)
      const roundEvents = eventPage.events.filter(event => event.runId === id)
      const firstTextReplace = result?.tools.find(tool => tool.call.name === 'text.replace')
      const appliedEdit = result?.tools.find(tool => tool.call.name === 'text.replace'
        && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')
      const editRequestId = appliedEdit?.requestId
      const streamed = observation.bodyStreamingObservations?.find(item => item.latest.requestId === editRequestId)
      const timingReady = editRequestId ? await expect.poll(() => {
        const marks = timingTraces(profile).find(item => item.taskId === latest.submissionId)?.marks ?? []
        return ['renderer.send.invoked', 'submit.received'].every(stage => marks.some(mark => mark.stage === stage))
          && marks.some(mark => mark.stage === 'edit.content-decoded' && mark.requestId === editRequestId)
      }, { timeout: 10_000 }).toBe(true).then(() => true, () => false) : false
      const marks = timingTraces(profile).find(item => item.taskId === latest.submissionId)?.marks ?? []
      const firstProvider = marks.find(mark => mark.stage === 'provider.first-content' && mark.requestId === editRequestId)
      const firstToolFragment = roundEvents.find(event => event.type === 'tool'
        && event.data.text?.startsWith('已收到工具参数片段 '))
      const previewBeforeFinish = Boolean(probe?.firstVisible && probe?.editFinished
        && probe.firstVisible.monotonicMs < probe.editFinished.monotonicMs)
      const receiptToVisibleMs = probe?.firstContentReceipt && probe.firstVisible
        ? Math.round((probe.firstVisible.monotonicMs - probe.firstContentReceipt.monotonicMs) * 10) / 10 : null
      const decodedToVisibleUpperBoundMs = decodedToVisibleUpperBound(marks, probe, editRequestId)
      const report = { name: round.name, runId: id, submissionId: latest.submissionId,
        runStatus: result?.status ?? null, runFailure: result?.failure ?? null,
        requests: result?.requests.map(request => ({ requestId: request.requestId, state: request.state,
          requestedModel, actualModel: request.actualModel ?? null, failure: request.failure ?? null })) ?? [],
        tools: result?.tools.map(tool => ({ name: tool.call.name, resultKind: tool.result?.kind ?? null,
          status: tool.result?.kind === 'document-operation' ? tool.result.result.status : null,
          errorCode: tool.result?.kind === 'error' ? tool.result.code : null })) ?? [],
        firstTextReplaceApplied: Boolean(firstTextReplace && firstTextReplace === appliedEdit),
        providerFirstContent: firstProvider ? { requestId: firstProvider.requestId, contentKind: firstProvider.detail?.contentKind } : null,
        firstToolArgumentHostEvent: firstToolFragment ? { wallTimeMs: firstToolFragment.time,
          note: 'Durable host event after fragment receipt; not the raw Provider byte arrival instant.' } : null,
        bodyStreamingObservation: streamed?.latest.result ?? null, probe, previewBeforeFinish, receiptToVisibleMs,
        decodedToVisibleUpperBoundMs, timingReady,
        beforeRevision: before.revision, afterRevision: after.revision, beforeUndoDepth: before.undoDepth,
        afterUndoDepth: after.undoDepth, timings: { clickToPreparedEstimateMs: (() => {
          const click = marks.find(mark => mark.stage === 'renderer.submit.clicked')
          const prepared = marks.find(mark => mark.stage === 'request.prepared')
          return click && prepared ? Math.round((prepared.timeOriginMs! + prepared.monotonicMs
            - click.timeOriginMs! - click.monotonicMs) * 10) / 10 : null
        })(), preparedToDispatchMs: mainGap(marks, 'request.prepared', 'request.dispatched'),
          dispatchToFirstProviderContentMs: editRequestId ? mainGap(marks, 'request.dispatched', 'provider.first-content', editRequestId) : null,
          providerCompleteToCommitMs: editRequestId ? mainGap(marks, 'request.finished', 'document.applied', editRequestId) : null },
        usage: roundEvents.filter(event => event.type === 'usage').map(event => event.data.usage),
      }
      // A model may call read/inspect with a handle it invented; the Gateway rejects it with
      // zero writes and the product then marks the run partial. That first-pass error is kept
      // in the evidence, but it does not affect body streaming, commit, Undo or cancellation.
      const failedTools = result?.tools.filter(tool => tool.result?.kind === 'error') ?? []
      const readOnlyRejections = failedTools.length > 0 && failedTools.every(tool => ['read', 'inspect'].includes(tool.call.name))
      Object.assign(report, { firstPassToolErrors: failedTools.map(tool => ({ name: tool.call.name,
        code: tool.result?.kind === 'error' ? tool.result.code : null })), selfCorrectedReadOnlyRejections: readOnlyRejections })
      ;(evidence.rounds as unknown[]).push(report)
      expect(result?.status === 'completed' || result?.status === 'partial' && readOnlyRejections,
        'The real model run must finish, allowing only rejected read-only calls the model corrected').toBe(true)
      expect(result?.requests.length, 'A completed run must include an actual provider request').toBeGreaterThan(0)
      expect(result?.requests.every(request => request.state === 'completed' && !request.failure),
        'Unknown or failed provider requests cannot be carried into the warm or cancel probe').toBe(true)
      expect(result?.tools.filter(tool => tool.call.name === 'text.replace' && tool.result?.kind === 'document-operation'
        && tool.result.result.status === 'applied')).toHaveLength(1)
      expect(streamed?.latest.result, 'Only a real incomplete text.replace content argument counts as body streaming').toBe('progressive')
      expect(previewBeforeFinish, 'The selected document must show new text before tool completion').toBe(true)
      expect(receiptToVisibleMs, 'Renderer IPC content receipt to visible body must be measured').not.toBeNull()
      expect(receiptToVisibleMs!).toBeLessThanOrEqual(200)
      expect(decodedToVisibleUpperBoundMs,
        'Main decoded body to visible body needs matching clock identities and a nonnegative conservative bound').not.toBeNull()
      expect(decodedToVisibleUpperBoundMs!).toBeLessThanOrEqual(200)
      expect(after.revision).toBe(before.revision + 1)
      expect(after.undoDepth).toBe(before.undoDepth + 1)
      expect(after.model).toMatchObject({ source: (before.model as { source: string }).source.replace(round.selected, round.replacement) })
      if (round.name === 'cold') {
        await region.getByRole('button', { name: '撤销', exact: true }).click()
        await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toEqual(before.model)
        await region.getByRole('button', { name: '重做', exact: true }).click()
        await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toEqual(after.model)
        ;(report as typeof report & { oneUndoRedoRoundTrip?: boolean }).oneUndoRedoRoundTrip = true
      }
      stage = `${round.name}.save`
      await region.getByRole('button', { name: '保存', exact: true }).click()
      await expect.poll(() => readFileSync(filename, 'utf8')).toBe((after.model as { source: string }).source)
      await expect.poll(() => timingTraces(profile).find(item => item.taskId === latest.submissionId)?.marks.some(mark =>
        mark.stage === 'save.finished' && mark.detail?.saveStatus === 'saved')).toBe(true)
      const saved = timingTraces(profile).find(item => item.taskId === latest.submissionId)!.marks
      ;(report.timings as Record<string, number | null>).commitToSaveMs = mainGap(saved, 'document.applied', 'save.finished')
      expect(errors).toEqual([])
    }
    stage = 'cancel.send'
    await selectVisibleText(page, editor, '先比较😀')
    const beforeCancel = await readSelectionDocument(page, document.documentId)
    await installProbe(page, document.documentId)
    const longText = '停止检验😀：' + '先记录，再比较，再用观察解释结论。'.repeat(30)
    await sendInline(page, `只用 text.replace 改写已选中正文；替换为下面的长文本，不要改其他内容：${longText}`)
    await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.execution!.submissions(input), scope)).length,
      { timeout: 45_000 }).toBeGreaterThan(previousSubmissions)
    const cancelSubmission = (await page.evaluate(input => window.desktopAPI.execution!.submissions(input), scope)).at(-1)!
    await expectNoDisclosure(page)
    await expect.poll(async () => (await page.evaluate(input => window.desktopAPI.execution!.submission(input),
      { ...scope, submissionId: cancelSubmission.submissionId }))?.runId ?? null, { timeout: 45_000 }).not.toBeNull()
    const cancelRunId = (await page.evaluate(input => window.desktopAPI.execution!.submission(input),
      { ...scope, submissionId: cancelSubmission.submissionId }))!.runId!
    await expect.poll(async () => (await readProbe(page))?.firstContentReceipt !== null, { timeout: 180_000 }).toBe(true)
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => {
      const status = (await page.evaluate(run => window.desktopAPI.execution!.run(run), cancelRunId))?.status
      return status && terminal.has(status) ? status : null
    }, { timeout: 60_000 }).not.toBeNull()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toEqual(beforeCancel.model)
    const cancelled = await readSelectionDocument(page, document.documentId)
    const cancelledRun = await page.evaluate(run => window.desktopAPI.execution!.run(run), cancelRunId)
    evidence.cancel = { runId: cancelRunId, submissionId: cancelSubmission.submissionId,
      runStatus: cancelledRun?.status ?? null, requests: cancelledRun?.requests.map(request => ({
        state: request.state, actualModel: request.actualModel ?? null, failure: request.failure ?? null })) ?? [],
      beforeRevision: beforeCancel.revision, afterRevision: cancelled.revision,
      beforeUndoDepth: beforeCancel.undoDepth, afterUndoDepth: cancelled.undoDepth, probe: await readProbe(page) }
    expect(cancelledRun?.status).toBe('stopped')
    expect(cancelled.revision).toBe(beforeCancel.revision)
    expect(cancelled.undoDepth).toBe(beforeCancel.undoDepth)
    stage = 'reopen'
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 真实流式正文.md', exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, '真实流式正文.md')
    expect(reopened.model).toMatchObject({ source: readFileSync(filename, 'utf8') })
    expect(errors).toEqual([])
    evidence.result = 'passed'
    await page.screenshot({ path: join(directory, 'saved-reopened.png') })
    await info.attach('M06 real model saved and reopened', { path: join(directory, 'saved-reopened.png'), contentType: 'image/png' })
  } catch (error) {
    evidence.result = 'failed'; evidence.failedStage = stage
    evidence.failure = error instanceof Error ? { name: error.name, message: error.message.replaceAll(key, '[redacted]') } : String(error).replaceAll(key, '[redacted]')
    throw error
  } finally {
    evidence.traceSummary = timingTraces(profile).map(trace => ({ taskId: trace.taskId,
      stages: trace.marks.map(mark => ({ stage: mark.stage, requestId: mark.requestId ?? null,
        contentKind: mark.detail?.contentKind ?? null, outcome: mark.detail?.outcome ?? null })) }))
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2).replaceAll(key, '[redacted]'))
    await info.attach('M06 real model timing and outcome', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeSelectionApp(app)
  }
})
