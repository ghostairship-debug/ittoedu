import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'lifecycle-response', model: 'fixture-lifecycle', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

function end(response: ServerResponse) {
  response.write(event({ role: 'assistant', content: '任务在视图重建后完成。' }, 'stop'))
  response.end('data: [DONE]\n\n')
}

test('S02-T04 renderer rebuild keeps dirty History and an active main task, then resubscribes the real document view', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/b01/kernel-lifecycle'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, '重建验证.md'); writeFileSync(filename, '# 磁盘初稿\n')
  let requestCount = 0, releaseResponse!: () => void
  const requestStarted = new Promise<void>(resolve => { releaseResponse = resolve })
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const payload = JSON.parse(body) as { model: string }
    expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions'); expect(payload.model).toBe('fixture-lifecycle')
    requestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    await requestStarted
    end(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const saved = await settings.saveConnection({ apiKey: 'fixture-lifecycle-key-not-a-real-account', connection: {
        provider: 'fixture-lifecycle', protocol: 'openai-chat', baseURL: endpoint, accountId: 'lifecycle-test', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: saved.connection.id, model: 'fixture-lifecycle' }, vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, endpoint)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: '重建验证.md', exact: true }).dblclick()
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    const initial = await page.evaluate(async filename => {
      const documents = window.desktopAPI!.documents!
      const snapshot = await documents.open(filename)
      const receipt = await documents.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: 'human-dirty-before-rebuild', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '# 未保存的主进程正文\n' } } })
      if (receipt.status !== 'applied') throw new Error(JSON.stringify(receipt))
      return documents.read(snapshot.documentId)
    }, filename)
    expect(initial).toMatchObject({ dirty: true, revision: 1, undoDepth: 1, model: { source: '# 未保存的主进程正文\n' } })
    await page.getByLabel('给创作助手发消息').fill('保持任务运行，等待视图重建。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => requestCount).toBe(1)
    const active = await page.evaluate(async workspace => {
      const execution = window.desktopAPI!.execution!
      const space = await execution.workspace(workspace)
      const conversation = space.conversations.find(value => value.runIndex.builtinRunIds.length > 0)
      if (!conversation) throw new Error('missing active conversation')
      const runId = conversation.runIndex.builtinRunIds.at(-1)!
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, runId, run: await execution.run(runId) }
    }, workspace)
    expect(active.run).toMatchObject({ runId: active.runId, status: expect.stringMatching(/queued|running/) })

    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    const retained = await page.evaluate(async input => ({
      document: await window.desktopAPI!.documents!.read(input.documentId),
      run: await window.desktopAPI!.execution!.run(input.runId),
      conversation: await window.desktopAPI!.execution!.conversation(input.workspaceId, input.conversationId),
    }), { documentId: initial.documentId, runId: active.runId, workspaceId: active.workspaceId, conversationId: active.conversationId })
    expect(retained.document).toMatchObject({ documentId: initial.documentId, dirty: true, revision: 1, undoDepth: 1, model: { source: '# 未保存的主进程正文\n' } })
    expect(retained.run).toMatchObject({ runId: active.runId, status: expect.stringMatching(/queued|running/) })
    expect(retained.conversation).toMatchObject({ conversationId: active.conversationId, runIndex: { builtinRunIds: [active.runId] } })

    await tree.getByRole('button', { name: '重建验证.md', exact: true }).dblclick()
    const editor = page.getByRole('region', { name: '教学文档 重建验证.md', exact: true })
    await expect(editor).toBeVisible()
    const sourceButton = editor.getByRole('button', { name: '源文', exact: true })
    if (await sourceButton.isVisible()) await sourceButton.click()
    await expect(editor.getByLabel('正文源文编辑')).toContainText('未保存的主进程正文')

    releaseResponse()
    await expect.poll(async () => page.evaluate(async runId => (await window.desktopAPI!.execution!.run(runId))?.status, active.runId)).toBe('completed')
    expect(requestCount).toBe(1)
  } finally {
    releaseResponse?.()
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
