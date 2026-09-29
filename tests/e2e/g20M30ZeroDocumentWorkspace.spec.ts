import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const html = '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body><main><h1>月度数据</h1><p id="report-summary">合计 42</p><a id="toggle" href="#done">切换</a><span id="done">结果</span></main></body></html>\n'
const chart = 'import csv\nfrom pathlib import Path\nrows = list(csv.DictReader(Path("sales.csv").open()))\nprint(sum(int(row["amount"]) for row in rows))\n'

test('M30 T1 fixture: zero-document delivery, HTML editing, review, fork and live action in Electron', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The real Windows Electron workspace is required.')
  test.setTimeout(240_000)
  const base = join(root, 'output/g20/b24')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'electron-zero-document-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'sales.csv'), 'month,amount\nJan,20\nFeb,22\n')
  const facts: Record<string, unknown> = { case: 'M30-T04 fixture UI subset', status: 'running', workspace,
    limits: ['local HTTP model fixture, no paid model', 'Python source delivered but not executed', 'per-file restore not exercised'] }
  const requests: Array<{ tools: string[]; receipts: string[] }> = []
  let step = 0
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected ${request.method} ${request.url}`)
    let raw = ''
    for await (const chunk of request) raw += chunk
    const data = JSON.parse(raw) as { messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
      tools: Array<{ function: { name: string } }> }
    const names = data.tools.map(tool => tool.function.name)
    const receipts = data.messages.filter(message => message.role === 'tool' && message.tool_call_id)
    requests.push({ tools: names, receipts: receipts.map(message => message.tool_call_id!) })
    const wire = (name: string) => {
      const value = modelToolWireName(name)
      if (!names.includes(value)) throw new Error(`Missing product tool ${name}`)
      return value
    }
    const call = (index: number, id: string, name: string, input: unknown) => ({ index, id, type: 'function',
      function: { name: wire(name), arguments: JSON.stringify(input) } })
    const event = (id: string, delta: Record<string, unknown>, finish: 'tool_calls' | 'stop') =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-selection', choices: [
        { index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-selection', choices: [
        { index: 0, delta: {}, finish_reason: finish }] })}\n\n` + 'data: [DONE]\n\n'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    step++
    if (step === 1) {
      const frozen = data.messages.find(message => message.role === 'system' && message.content?.startsWith('本次固定文档与权限'))
      if (!frozen || !frozen.content?.endsWith('[]')) throw new Error('The task gained a document without user choice')
      response.end(event('t1-read', { tool_calls: [call(0, 't1-read', 'file.read', { path: 'sales.csv' })] }, 'tool_calls'))
    } else if (step === 2) {
      const read = receipts.find(message => message.tool_call_id === 't1-read')
      if (!read || JSON.parse(read.content ?? '{}').data?.text !== 'month,amount\nJan,20\nFeb,22\n') throw new Error('Input CSV not read')
      response.end(event('t1-write', { tool_calls: [
        call(0, 't1-python', 'file.write', { mode: 'create', path: 'chart.py', content: chart }),
        call(1, 't1-json', 'file.write', { mode: 'create', path: 'summary.json', content: '{"total":42,"count":2}\n' }),
        call(2, 't1-html', 'file.write', { mode: 'create', path: 'report.html', content: html }),
        call(3, 't1-css', 'file.write', { mode: 'create', path: 'report.css', content: 'body{font:16px sans-serif}\n' }),
      ] }, 'tool_calls'))
    } else if (step === 3) {
      for (const id of ['t1-python', 't1-json', 't1-html', 't1-css']) {
        const receipt = receipts.find(message => message.tool_call_id === id)
        if (!receipt || JSON.parse(receipt.content ?? '{}').data?.saved !== true) throw new Error(`Missing saved receipt ${id}`)
      }
      response.end(event('t1-final', { content: '已生成四份文件，可打开 report.html 查看。' }, 'stop'))
    } else if (step === 4) {
      if (!names.includes(modelToolWireName('html.observe'))) throw new Error('HTML document reference did not expose html.observe')
      response.end(event('t2-observe', { tool_calls: [call(0, 't2-observe', 'html.observe', {})] }, 'tool_calls'))
    } else if (step === 5) {
      const receipt = receipts.find(message => message.tool_call_id === 't2-observe')
      const observation = JSON.parse(receipt?.content ?? '{}').data as { source?: string; elements?: Array<{ handle: string; label: string }> }
      const target = observation?.elements?.find(element => element.label === '切换')
      if (observation.source !== 'live-html-preview' || !target?.handle) throw new Error('No live HTML anchor handle')
      response.end(event('t2-click', { tool_calls: [call(0, 't2-click', 'html.click', { handle: target.handle })] }, 'tool_calls'))
    } else if (step === 6) {
      const receipt = receipts.find(message => message.tool_call_id === 't2-click')
      const observation = JSON.parse(receipt?.content ?? '{}').data as { source?: string; currentUrl?: string; generation?: number }
      if (observation.source !== 'live-html-preview' || !observation.currentUrl?.endsWith('#done')
        || observation.generation !== 2) throw new Error('HTML click did not produce a second live observation')
      response.end(event('t2-errors', { tool_calls: [call(0, 't2-errors', 'html.errors', {})] }, 'tool_calls'))
    } else if (step === 7) {
      const receipt = receipts.find(message => message.tool_call_id === 't2-errors')
      const result = JSON.parse(receipt?.content ?? '{}').data as { errors?: unknown[] }
      if (!Array.isArray(result.errors)) throw new Error('HTML errors receipt missing')
      response.end(event('t2-final', { content: '已观察并点击当前 HTML 页面。' }, 'stop'))
    } else throw new Error('Unexpected model retry or extra request')
  })().catch(error => {
    facts.serverError = String(error)
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error) } }))
  }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const app = await launchSelectionApp(directory)
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, `http://127.0.0.1:${address.port}/v1`, workspace)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(0)
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect(page.locator('.execution-assistant__session-row > button[aria-current="page"]')).toBeVisible()
    const composer = page.getByLabel('给创作助手发消息', { exact: true })
    await composer.fill('读取 sales.csv，交付 Python、JSON、HTML、CSS 文件并提供可预览的报告。')
    await page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('已生成四份文件，可打开 report.html 查看。', { exact: true })).toBeVisible()
    expect(step).toBe(3)
    expect(requests).toHaveLength(3)
    expect(readFileSync(join(workspace, 'sales.csv'), 'utf8')).toBe('month,amount\nJan,20\nFeb,22\n')
    expect(readFileSync(join(workspace, 'chart.py'), 'utf8')).toBe(chart)
    expect(JSON.parse(readFileSync(join(workspace, 'summary.json'), 'utf8'))).toEqual({ total: 42, count: 2 })
    expect(readFileSync(join(workspace, 'report.css'), 'utf8')).toContain('sans-serif')
    expect(readFileSync(join(workspace, 'report.html'), 'utf8')).toBe(html)
    expect(existsSync(join(workspace, 'lesson.h5lesson'))).toBe(false)

    // A file created by the built-in Agent must be visible in the ordinary workspace tree.
    const row = page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'report.html', exact: true })
    await expect(row).toBeVisible()
    await row.dblclick()
    const region = page.getByRole('region', { name: '教学文档 report.html', exact: true })
    await expect(region).toBeVisible()
    const preview = region.frameLocator('iframe[title="HTML 预览"]')
    await expect(preview.getByRole('heading', { name: '月度数据' })).toBeVisible()
    facts.previewFrame = await preview.locator('body').evaluate(body => ({
      ready: document.readyState, scripts: Array.from(document.scripts).map(script => script.src),
      html: body.innerHTML.slice(0, 300),
    }))
    await region.getByRole('toolbar', { name: 'HTML 分页' }).getByRole('button', { name: '编辑预览' }).click()
    await expect(region.getByRole('toolbar', { name: 'HTML 分页' }).getByRole('button', { name: '完成编辑' }))
      .toHaveAttribute('aria-pressed', 'true')
    await preview.locator('#report-summary').dblclick()
    const dialog = page.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'HTML 文字' }).fill('两个月合计 42')
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(preview.locator('#report-summary')).toHaveText('两个月合计 42')
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(workspace, 'report.html'), 'utf8')).toContain('<p id="report-summary">两个月合计 42</p>')
    await page.getByRole('button', { name: '关闭 report.html', exact: true }).click()
    await expect(region).toHaveCount(0)
    await row.dblclick()
    const reopened = page.getByRole('region', { name: '教学文档 report.html', exact: true })
    await expect(reopened.frameLocator('iframe[title="HTML 预览"]').locator('#report-summary')).toHaveText('两个月合计 42')
    const native = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })).toPNG().toString('base64'))
    const shot = join(directory, 'workspace-result.png')
    writeFileSync(shot, Buffer.from(native, 'base64'))
    await info.attach('M30 no-document HTML native window', { path: shot, contentType: 'image/png' })
    await page.getByLabel('会话更多操作').click()
    await page.getByRole('button', { name: '审阅本次变更', exact: true }).click()
    const review = page.getByRole('region', { name: '会话变更审阅', exact: true })
    await expect(review).toBeVisible()
    await expect(review.locator('[data-review-entry]')).toHaveCount(4)
    await review.getByRole('button', { name: '查看检查点', exact: true }).click()
    await expect(review.getByText('当前检查点：任务已完成', { exact: false })).toBeVisible()
    const requestsBeforeFork = requests.length
    const filesBeforeFork = readdirSync(workspace).sort().map(name => [name, readFileSync(join(workspace, name), 'utf8')])
    await review.getByRole('button', { name: '从此新建会话', exact: true }).click()
    await expect(page.getByRole('region', { name: '新会话继续提示', exact: true })).toContainText('不会自动重做')
    await expect(page.getByLabel('给创作助手发消息', { exact: true })).not.toHaveValue('')
    await page.waitForTimeout(750)
    expect(requests).toHaveLength(requestsBeforeFork)
    expect(readdirSync(workspace).sort().map(name => [name, readFileSync(join(workspace, name), 'utf8')])).toEqual(filesBeforeFork)
    facts.fork = { originalRequests: requestsBeforeFork, afterRequests: requests.length,
      reviewEntries: 4, draft: await page.getByLabel('给创作助手发消息', { exact: true }).inputValue() }
    const actionComposer = page.getByLabel('给创作助手发消息', { exact: true })
    await actionComposer.fill('观察当前 report.html，点击“切换”，然后读取页面错误。')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('menu', { name: '添加内容' }).getByRole('menuitem', { name: '引用当前文档' }).click()
    await expect(page.locator('.execution-assistant__chip')).toContainText('report.html')
    await page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('已观察并点击当前 HTML 页面。', { exact: true })).toBeVisible()
    expect(step).toBe(7)
    await expect(reopened.frameLocator('iframe[title="HTML 预览"]').locator('#toggle')).toHaveAttribute('href', '#done')
    facts.liveHtmlAction = { requestCount: requests.length, resultUrl: await reopened.frameLocator('iframe[title="HTML 预览"]')
      .locator('body').evaluate(() => location.href), errorsReceipt: 't2-errors' }
    facts.status = 'passed'
    facts.savedHtml = readFileSync(join(workspace, 'report.html'), 'utf8')
    facts.screenshot = shot
    expect(errors).toEqual([])
  } catch (error) {
    facts.status = 'failed'
    facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    facts.requests = requests
    facts.pageErrors = errors
    const evidence = join(directory, 'evidence.json')
    writeFileSync(evidence, JSON.stringify(facts, null, 2) + '\n')
    await info.attach('M30 no-document UI evidence', { path: evidence, contentType: 'application/json' })
    await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
