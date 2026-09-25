import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const sse = (content: string, finish: string | null = null) => `data: ${JSON.stringify({
  id: 's07-fixture', model: 'fixture-s07', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finish }],
})}\n\n`

test('S07-T03 running task catches up after panel collapse and renderer reconnect without replay or duplicate messages', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/s07-reconnect')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  let requestCount = 0
  let streamingResponse: ServerResponse | undefined
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'fixture-s07' }] }))
      return
    }
    for await (const _chunk of request) { /* Consume the full model request before replying. */ }
    requestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requestCount < 3) {
      response.end(`${sse(`历史答复${requestCount}`, 'stop')}data: [DONE]\n\n`)
    } else if (requestCount === 3) {
      streamingResponse = response
      response.write(sse('第一段'))
    } else {
      response.destroy(new Error('A reconnect must not start a fourth model request'))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const saved = await settings.saveConnection({ apiKey: 'local-fixture-only', connection: {
        provider: 'fixture-s07', protocol: 'openai-chat', baseURL: endpoint, accountId: 'reconnect', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: saved.connection.id, model: 'fixture-s07' }, vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, endpoint)
    const composer = page.getByLabel('给创作助手发消息')
    const send = async (message: string) => { await composer.fill(message); await page.getByRole('button', { name: '发送', exact: true }).click() }
    await expect(composer).toBeVisible()
    await send('历史问题一')
    await expect(page.getByText('历史答复1', { exact: true })).toBeVisible()
    await send('历史问题二')
    await expect(page.getByText('历史答复2', { exact: true })).toBeVisible()
    await expect.poll(() => requestCount).toBe(2)

    await send('运行中的问题')
    await expect.poll(() => requestCount).toBe(3)
    await expect(page.getByText('第一段', { exact: true })).toBeVisible()
    const before = await page.evaluate(async () => {
      const api = window.desktopAPI!.execution!
      const space = await api.workspace(null), conversation = space.conversations[0]!
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        runIds: conversation.runIndex.builtinRunIds, messageIds: conversation.messages.map(message => message.messageId),
        timeline: await api.timeline(conversation.conversationId) }
    })
    expect(before.runIds).toHaveLength(3)
    expect(before.messageIds).toHaveLength(5)
    const activeRunId = before.runIds[2]!

    const toggle = page.locator('.lesson-workspace-toolbar-actions').getByRole('button', { name: 'AI 助手', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    streamingResponse!.write(sse('第二段'))
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('第一段第二段', { exact: true })).toBeVisible()

    // Reload tears down the renderer subscription while Main keeps the task running.
    // Release the final chunk as navigation starts, before React can subscribe again.
    const navigated = new Promise<void>(resolve => page.once('framenavigated', () => resolve()))
    const reloading = page.reload()
    await navigated
    streamingResponse!.end(`${sse('第三段', 'stop')}data: [DONE]\n\n`)
    await reloading
    await expect(page.getByText('第一段第二段第三段', { exact: true })).toBeVisible()
    await expect.poll(async () => (await page.evaluate(async runId => window.desktopAPI!.execution!.run(runId), activeRunId))?.status).toBe('completed')
    await expect.poll(async () => page.evaluate(async ids => (await window.desktopAPI!.execution!.conversation(ids.workspaceId, ids.conversationId))?.messages.length,
      { workspaceId: before.workspaceId, conversationId: before.conversationId })).toBe(6)
    expect(requestCount).toBe(3)

    const after = await page.evaluate(async ids => {
      const api = window.desktopAPI!.execution!
      const conversation = (await api.conversation(ids.workspaceId, ids.conversationId))!
      const timeline = await api.timeline(ids.conversationId)
      const tail = await api.events(ids.conversationId, ids.cursor, 5000)
      return { runIds: conversation.runIndex.builtinRunIds, messages: conversation.messages.map(message => ({ id: message.messageId, role: message.role, text: message.text })),
        timeline, tail, visibleUserMessages: [...document.querySelectorAll('[aria-label="用户消息"]')].map(node => node.textContent),
        visibleItemKeys: [...document.querySelectorAll('[data-execution-item]')].map(node => node.getAttribute('data-execution-item')) }
    }, { workspaceId: before.workspaceId, conversationId: before.conversationId, cursor: before.timeline.cursor })
    expect(after.runIds).toEqual(before.runIds)
    expect(after.messages.map(message => message.id).slice(0, 5)).toEqual(before.messageIds)
    expect(after.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(after.messages.map(message => message.text)).toEqual(['历史问题一', '历史答复1', '历史问题二', '历史答复2', '运行中的问题', '第一段第二段第三段'])
    expect(after.visibleUserMessages).toHaveLength(3)
    expect(after.visibleItemKeys.length).toBe(new Set(after.visibleItemKeys).size)
    expect(after.timeline.items.length).toBe(new Set(after.timeline.items.map(item => `${item.runId}:${item.itemId}`)).size)
    expect(after.tail.events.length).toBeGreaterThan(0)
    expect(after.tail.events.every(event => event.sequence > before.timeline.cursor)).toBe(true)
    expect(after.timeline.cursor).toBe(after.tail.cursor)
  } finally {
    streamingResponse?.end()
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
