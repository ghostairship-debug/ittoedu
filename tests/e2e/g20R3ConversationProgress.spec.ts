import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { launchSelectionApp, setupSelectionUI, closeSelectionApp } from './helpers/g20SelectionHarness'
function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve }); return { wait, release } }
const sse = (delta: unknown, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'r3-response', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'

test('R3 main conversation streams readable prose before completion and keeps real tool work in collapsed details', async ({}, info) => {
  test.setTimeout(120000)
  const output = resolve('output/g20/r3/conversation-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, 'material.txt'); writeFileSync(filename, 'The total is 73. Original material.')
  const first = gate(), second = gate(), errors: string[] = [], requests: unknown[] = []
  const server = createServer((req, res) => { void (async () => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    let raw = ''; for await (const part of req) raw += part.toString()
    const body = JSON.parse(raw); requests.push(body)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (requests.length === 1) {
      res.write(sse({ role: 'assistant', content: '正在读取资料，保留原文件。' })); await first.wait
      expect(body.tools.some((tool: any) => tool.function.name === modelToolWireName('file.read'))).toBe(true)
      res.write(sse({ tool_calls: [{ index: 0, id: 'read-material', type: 'function', function: { name: modelToolWireName('file.read'), arguments: JSON.stringify({ path: filename }) } }] }, 'tool_calls'))
    } else if (requests.length === 2) {
      const receipt = body.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'read-material')
      expect(receipt.content).toContain('The total is 73.')
      res.write(sse({ role: 'assistant', content: '已读到合计 73，正在整理说明。' })); await second.wait
      res.write(sse({ content: '\n整理完成：原资料记录的合计为 73。' }, 'stop'))
    } else throw new Error('Unexpected request count: ' + requests.length)
    res.end('data: [DONE]\n\n')
  })().catch(cause => { errors.push(String(cause)); res.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const app = await launchSelectionApp(directory)
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, 'http://127.0.0.1:' + (server.address() as {port:number}).port + '/v1', workspace)
    await expect(page.getByRole('treeitem', { name: 'material.txt', exact: true })).toBeVisible()
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    await assistant.getByRole('textbox', { name: '给创作助手发消息' }).fill('读取 material.txt，说明记录的合计，不修改文件。')
    await expect(assistant.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('读取 material.txt，说明记录的合计，不修改文件。')
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
    await expect(assistant.getByText('正在读取资料，保留原文件。', { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    await expect(assistant.locator('.execution-timeline__activity')).toBeVisible()
    first.release()
    await expect(assistant.getByText('已读到合计 73，正在整理说明。', { exact: true })).toBeVisible()
    await expect(assistant.locator('.execution-timeline__work').first()).toBeVisible()
    expect(await assistant.locator('.execution-timeline__work[open]').count()).toBe(0)
    expect(await assistant.getByText(/已收到工具参数片段/).count()).toBe(0)
    const image = join(directory, 'working-prose-tools-collapsed.png'); await page.screenshot({ path: image }); await info.attach('R3 real running conversation', { path: image, contentType: 'image/png' })
    second.release()
    await expect(assistant.getByText(/整理完成：原资料记录的合计为 73/)).toBeVisible()
    await expect(assistant.locator('.execution-timeline__activity')).toHaveCount(0)
    await assistant.locator('.execution-timeline__work').first().locator('summary').first().click()
    await expect(assistant.locator('.execution-timeline__work[open]')).toHaveCount(1)
    expect(requests).toHaveLength(2); expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'completed-and-details.png') })
  } catch (cause) { const page = await app.firstWindow(); await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined); writeFileSync(join(directory, 'failure-ui.txt'), await page.locator('body').ariaSnapshot().catch(() => 'unavailable')); throw cause } finally { first.release(); second.release(); await closeSelectionApp(app); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
