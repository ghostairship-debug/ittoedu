import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeM23 } from './helpers/g20M23Harness'

const root = resolve(__dirname, '../..')
const HUMAN_TEXT = '本周已完成接口联调，人工补充：先邀请三位同事试用。'
const AI_TEXT = `${HUMAN_TEXT}试用反馈统一记录在周五复盘中。`
const HUMAN_FOLLOWUP = '负责人：林一；人工复核时间：周四下午。'
const originalFollowup = '负责人：林一。'
const defaultTargetPrefix = '当前默认语义目标 target='
const defaultTargetSeparator = ' 的内容与属性（数据）：\n'

const source = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>项目推进简报</title>
<style>body{margin:0;padding:36px;background:#eef2f6;color:#182b43;font:20px/1.7 sans-serif}main{box-sizing:border-box;max-width:860px;margin:auto;background:white;padding:34px 42px;border-radius:14px}h1{font-size:32px;margin:0 0 22px}p{margin:18px 0}.meta{color:#52657c;font-size:16px}img{width:100%;height:52px;object-fit:contain}button{font:inherit;padding:7px 14px}footer{margin-top:26px;border-top:1px solid #cad4df;padding-top:15px;color:#61748a}</style>
</head><body><main><div class="meta">TEAM UPDATE · 2026-10-26</div><h1 id="title">项目推进简报</h1>
<p id="handoff">本周已完成接口联调，下一步安排试用。</p>
<p id="untouched">预算上限 12,000 元；发布日期 11 月 3 日。</p>
<img id="chart" alt="三阶段工作计划" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='52' viewBox='0 0 720 52'%3E%3Crect width='210' height='48' rx='8' fill='%232c7a70'/%3E%3Crect x='250' width='210' height='48' rx='8' fill='%235480ad'/%3E%3Crect x='500' width='210' height='48' rx='8' fill='%23c9d5e2'/%3E%3C/svg%3E">
<p id="followup">${originalFollowup}</p><p><a id="reference" href="#footer">查看说明</a></p>
<button id="verify" onclick="document.getElementById('verification').textContent='已核对三项';">核对事项</button><output id="verification">尚未核对</output>
<footer id="footer">仅用于团队内部沟通。保留这段原始说明及其样式。</footer></main></body></html>`

type CapturedRequest = { toolNames: string[]; target: string | null; targetContext: string | null; seenHumanText: boolean }

/** A deterministic provider supplies calls; the application's real Engine, Gateway and document writers execute them. */
async function localProvider() {
  const requests: CapturedRequest[] = [], calls: Array<{ name: string; args: unknown }> = [], errors: string[] = []
  let currentReadVerified = false
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'fixture-office-coedit' }] })); return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected provider route ${request.method} ${request.url}`)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>
      tools?: Array<{ function: { name: string } }>
    }
    // Current AI cards send contentOutput, whose handle is in this real Engine
    // system message; the ordinary-chat frozen-reference array is a different path.
    const context = [...body.messages].reverse().find(message => message.role === 'system'
      && typeof message.content === 'string' && message.content.startsWith(defaultTargetPrefix))?.content
    const boundary = typeof context === 'string' ? context.indexOf(defaultTargetSeparator, defaultTargetPrefix.length) : -1
    const parsed: unknown = typeof context === 'string' && boundary >= 0 ? JSON.parse(context.slice(defaultTargetPrefix.length, boundary)) : null
    const target = typeof parsed === 'string' && parsed ? parsed : null
    const names = body.tools?.map(tool => tool.function.name) ?? []
    requests.push({ toolNames: names, target, targetContext: typeof context === 'string' ? context : null,
      seenHumanText: JSON.stringify(body.messages).includes(HUMAN_TEXT) })
    if (!target) throw new Error('The actual AI card did not freeze its current HTML field')
    if (typeof context !== 'string' || !context.slice(boundary + defaultTargetSeparator.length).includes(HUMAN_TEXT))
      throw new Error('The default semantic target did not carry the current unsaved human text')
    const results = new Map(body.messages.filter(message => message.role === 'tool').map(message => [message.tool_call_id, message.content]))
    const send = (name: string, args: unknown, id: string) => {
      if (!names.includes(modelToolWireName(name))) throw new Error(`Production tools do not expose ${name}`)
      calls.push({ name, args })
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.end(`data: ${JSON.stringify({ id: 'office-coedit', model: 'fixture-office-coedit', choices: [{ index: 0, delta: {
        role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: modelToolWireName(name), arguments: JSON.stringify(args) } }],
      }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    }
    if (!names.includes(modelToolWireName('text.replace')) && !results.has('office-load')) {
      send('tools.load', { families: ['content'] }, 'office-load'); return
    }
    if (!results.has('office-read')) { send('read', { target, limit: 100 }, 'office-read'); return }
    const readContent = results.get('office-read')
    const read = (typeof readContent === 'string' ? JSON.parse(readContent) : readContent) as {
      kind?: string; data?: { text?: string; target?: string; truncated?: boolean }
    }
    if (read?.kind !== 'read' || read.data?.text !== HUMAN_TEXT || read.data.truncated)
      throw new Error(`AI read did not receive exactly the current unsaved human field: ${JSON.stringify(read)}`)
    currentReadVerified = true
    if (!results.has('office-replace')) { send('text.replace', { target: read.data.target ?? target, content: AI_TEXT }, 'office-replace'); return }
    const result = results.get('office-replace')
    if (typeof result !== 'string' || !result.includes('document-operation')) throw new Error(`Expected a real document-operation receipt, got ${JSON.stringify(result)}`)
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.end(`data: ${JSON.stringify({ id: 'office-coedit', model: 'fixture-office-coedit', choices: [{ index: 0,
      delta: { role: 'assistant', content: '已在当前人工稿上完成局部修改。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error) } }))
  }) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Provider did not bind')
  return { endpoint: `http://127.0.0.1:${address.port}/v1`, requests, calls, errors,
    currentReadVerified: () => currentReadVerified,
    close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) } }
}

async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: [process.env.GUOLING_P1_APP_PATH || '.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
  return { app, page }
}

async function configureLocalProvider(page: Page, endpoint: string) {
  await page.getByRole('button', { name: '模型与连接设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '模型与连接', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByText('连接详情', { exact: true }).click()
  await dialog.getByLabel('供应商标识', { exact: true }).fill('fixture-office-coedit')
  await dialog.getByLabel('账号标识', { exact: true }).fill('local-only-no-paid-model')
  await dialog.getByLabel('API 地址', { exact: true }).fill(endpoint)
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-only-no-real-account')
  await dialog.getByLabel('计费来源', { exact: true }).selectOption('unknown')
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('连接设置已保存')
  const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
  const connection = settings.connections.find(entry => entry.connection.provider === 'fixture-office-coedit')
  if (!connection?.hasCredential) throw new Error('The local-only provider configuration was not saved')
  await dialog.getByLabel('主力模型连接', { exact: true }).selectOption(connection.connection.id)
  const model = dialog.getByLabel('主力模型', { exact: true })
  await expect.poll(() => model.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toContain('fixture-office-coedit')
  await model.selectOption('fixture-office-coedit')
  await dialog.getByRole('button', { name: '保存模型角色', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('模型角色已保存')
  await dialog.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
}

async function snapshot(page: Page, filename: string) {
  const documents = await page.evaluate(() => window.desktopAPI.documents!.list())
  const listed = documents.find(entry => entry.binding.kind === 'file' && entry.binding.path.toLowerCase() === filename.toLowerCase())
  if (!listed) throw new Error('The office HTML has no actual DocumentSession')
  return page.evaluate(id => window.desktopAPI.documents!.read(id), listed.documentId)
}

async function openOffice(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
  await page.getByRole('region', { name: '资源管理器', exact: true }).getByRole('button', { name: '打开文件夹', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'office-brief.html', exact: true }).dblclick()
  const iframe = page.locator('iframe[title="HTML 预览"]')
  await expect(iframe).toHaveCount(1)
  // LessonDocumentEditor is a labelled <section>, so its region role is implicit.
  const region = page.locator('section.lesson-document-editor--html').filter({ has: iframe })
  await expect(region).toBeVisible()
  const preview = page.frameLocator('iframe[title="HTML 预览"]')
  await expect(preview.locator('#title')).toHaveText('项目推进简报')
  // Submit the hidden Windows OOPIF hit-test surface before trusted mouse input.
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })
  })
  return { region, preview }
}

async function humanText(page: Page, target: import('@playwright/test').Locator, text: string) {
  await target.dblclick()
  const input = page.getByRole('textbox', { name: '编辑此处文字', exact: true })
  await expect(input).toBeVisible(); await input.fill(text); await input.press('Escape')
  await expect(input).toHaveCount(0); await expect(target).toHaveText(text)
}

test('P1 ordinary HTML keeps a human–Agent–human edit chain, history, cold reopen and standalone delivery', async ({}, info) => {
  test.setTimeout(180_000)
  if (process.platform !== 'win32') throw new Error('P1 must run on the actual Windows Electron host; a skipped run is not evidence')
  const base = join(root, 'output/product-execution-20261026/p1-coediting'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, 'office-brief.html'); writeFileSync(filename, source, 'utf8')
  const provider = await localProvider(), started = performance.now(), steps: Array<{ stage: string; elapsedMs: number }> = []
  const facts: Record<string, unknown> = { status: 'running', carrier: 'complete Electron + current HTML Pane + real Engine/Gateway; deterministic local provider',
    paidModel: false, directory, filename, steps, providerRequests: provider.requests, providerCalls: provider.calls, providerErrors: provider.errors }
  const pageErrors: string[] = []
  let stage = 'launch', app: ElectronApplication | undefined, page: Page | undefined
  const mark = (name: string) => { stage = name; steps.push({ stage, elapsedMs: Math.round(performance.now() - started) }) }
  try {
    ;({ app, page } = await launch(join(directory, 'profile-author')))
    page.on('pageerror', error => pageErrors.push(error.message))
    await configureLocalProvider(page, provider.endpoint)
    const { region, preview } = await openOffice(app, page, workspace)
    const initial = await snapshot(page, filename); facts.initial = { documentId: initial.documentId, revision: initial.revision, undoDepth: initial.undoDepth }
    const image = await preview.locator('#chart').getAttribute('src')
    const footer = await preview.locator('#footer').evaluate(element => ({ text: element.textContent, color: getComputedStyle(element).color }))
    mark('human-text-and-format')
    await region.getByRole('toolbar', { name: 'HTML 分页', exact: true }).getByRole('button', { name: '编辑', exact: true }).click()
    await humanText(page, preview.locator('#handoff'), HUMAN_TEXT)
    await expect.poll(async () => (await snapshot(page!, filename)).undoDepth).toBe(1)
    await preview.locator('#handoff').click(); await page.getByLabel('HTML 对象选框').waitFor()
    await page.keyboard.press('Control+B')
    await expect.poll(() => preview.locator('#handoff').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    await expect.poll(async () => (await snapshot(page!, filename)).undoDepth).toBe(2)
    expect(readFileSync(filename, 'utf8')).toBe(source)
    mark('agent-current-field')
    await page.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const card = page.getByRole('dialog', { name: /^AI 修改：/ }).last(); await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('先读取当前已有人工作出的修改，再追加“试用反馈统一记录在周五复盘中。”。保留人工内容、加粗及其他段落。')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(card.locator('.element-ai-card__state').last()).toHaveText('已完成', { timeout: 45_000 })
    await expect(preview.locator('#handoff')).toHaveText(AI_TEXT)
    expect(provider.currentReadVerified()).toBe(true)
    expect(provider.calls.filter(call => call.name === 'text.replace')).toHaveLength(1)
    await expect.poll(async () => (await snapshot(page!, filename)).undoDepth).toBe(3)
    await card.getByRole('button', { name: '关闭 AI 卡', exact: true }).click()
    mark('human-continues')
    await humanText(page, preview.locator('#followup'), HUMAN_FOLLOWUP)
    await expect.poll(async () => (await snapshot(page!, filename)).undoDepth).toBe(4)
    await expect(preview.locator('#untouched')).toHaveText('预算上限 12,000 元；发布日期 11 月 3 日。')
    expect(await preview.locator('#chart').getAttribute('src')).toBe(image)
    expect(await preview.locator('#footer').evaluate(element => ({ text: element.textContent, color: getComputedStyle(element).color }))).toEqual(footer)
    await expect(preview.locator('#reference')).toHaveAttribute('href', '#footer')
    mark('history-crosses-human-and-agent')
    await preview.locator('#followup').click(); await page.getByLabel('HTML 对象选框').waitFor()
    await page.keyboard.press('Control+Z'); await expect(preview.locator('#followup')).toHaveText(originalFollowup)
    await expect(preview.locator('#handoff')).toHaveText(AI_TEXT)
    await page.keyboard.press('Control+Z'); await expect(preview.locator('#handoff')).toHaveText(HUMAN_TEXT)
    await expect.poll(() => preview.locator('#handoff').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    await page.keyboard.press('Control+Y'); await expect(preview.locator('#handoff')).toHaveText(AI_TEXT)
    await page.keyboard.press('Control+Shift+Z'); await expect(preview.locator('#followup')).toHaveText(HUMAN_FOLLOWUP)
    await expect.poll(async () => (await snapshot(page!, filename)).undoDepth).toBe(4)
    await page.screenshot({ path: join(directory, 'coediting-before-save.png'), fullPage: true })
    expect(readFileSync(filename, 'utf8')).toBe(source)
    mark('explicit-save')
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await snapshot(page!, filename)).dirty).toBe(false)
    const saved = await snapshot(page, filename)
    if (saved.model.kind !== 'text') throw new Error('HTML changed document kind')
    const savedSource = saved.model.source
    expect(readFileSync(filename, 'utf8')).toBe(savedSource)
    expect(savedSource).not.toMatch(/courseware-preview:\/\/|html-preview-agent/)
    facts.saved = { documentId: saved.documentId, revision: saved.revision, undoDepth: saved.undoDepth,
      bytes: Buffer.byteLength(savedSource), sha256: createHash('sha256').update(savedSource).digest('hex') }
    await closeM23(app); app = undefined; page = undefined
    mark('independent-process-cold-open')
    ;({ app, page } = await launch(join(directory, 'profile-cold')))
    page.on('pageerror', error => pageErrors.push(error.message))
    const coldUI = await openOffice(app, page, workspace), cold = await snapshot(page, filename)
    expect(cold.documentId).not.toBe(saved.documentId); expect(cold.dirty).toBe(false)
    expect(cold.model.kind === 'text' ? cold.model.source : null).toBe(savedSource)
    await expect(coldUI.preview.locator('#handoff')).toHaveText(AI_TEXT)
    await expect(coldUI.preview.locator('#followup')).toHaveText(HUMAN_FOLLOWUP)
    await expect.poll(() => coldUI.preview.locator('#handoff').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
    expect(await coldUI.preview.locator('#chart').getAttribute('src')).toBe(image)
    await expect(coldUI.preview.locator('#untouched')).toHaveText('预算上限 12,000 元；发布日期 11 月 3 日。')
    await page.screenshot({ path: join(directory, 'independent-cold-open.png'), fullPage: true })
    facts.cold = { documentId: cold.documentId, revision: cold.revision, undoDepth: cold.undoDepth, dirty: cold.dirty,
      sourceExact: true, separateProfile: true, separateProcess: true }
    await closeM23(app); app = undefined; page = undefined
    mark('standalone-saved-html-delivery')
    const browser = await chromium.launch({ headless: true })
    try {
      const standalone = await browser.newPage({ viewport: { width: 1100, height: 850 } })
      const standaloneErrors: string[] = []; standalone.on('pageerror', error => standaloneErrors.push(error.message))
      await standalone.route(/^https?:\/\//, route => route.abort('blockedbyclient'))
      await standalone.goto(pathToFileURL(filename).href)
      await expect(standalone.locator('#handoff')).toHaveText(AI_TEXT)
      await expect(standalone.locator('#followup')).toHaveText(HUMAN_FOLLOWUP)
      await expect.poll(() => standalone.locator('#handoff').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
      await expect.poll(() => standalone.locator('#chart').evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true)
      await expect(standalone.locator('#untouched')).toHaveText('预算上限 12,000 元；发布日期 11 月 3 日。')
      await standalone.getByRole('button', { name: '核对事项', exact: true }).click()
      await expect(standalone.locator('#verification')).toHaveText('已核对三项')
      await standalone.screenshot({ path: join(directory, 'standalone-html.png'), fullPage: true })
      expect(standaloneErrors).toEqual([])
      facts.delivery = { carrier: 'saved source HTML opened directly in an independent Chromium process', networkBlocked: true,
        contentAndFormat: true, imageLoaded: true, originalInteraction: true, pageErrors: standaloneErrors }
    } finally { await browser.close() }
    expect(provider.errors).toEqual([]); expect(pageErrors).toEqual([])
    mark('completed'); facts.status = 'passed'
  } catch (error) {
    facts.status = 'failed'; facts.failedStage = stage; facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    if (page) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
      facts.body = await page.locator('body').innerText().catch(() => 'unavailable')
      facts.current = await snapshot(page, filename).then(current => ({ documentId: current.documentId, revision: current.revision,
        undoDepth: current.undoDepth, dirty: current.dirty })).catch(() => null)
    }
    throw error
  } finally {
    if (app) await closeM23(app)
    await provider.close()
    facts.pageErrors = pageErrors; facts.elapsedMs = Math.round(performance.now() - started)
    const evidence = join(directory, 'evidence.json'); writeFileSync(evidence, JSON.stringify(facts, null, 2), 'utf8')
    await info.attach('P1 continuous office coediting evidence', { path: evidence, contentType: 'application/json' })
  }
})
