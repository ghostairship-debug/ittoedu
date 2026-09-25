import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'ui-response', model: 'fixture-text', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

test('G20 default assistant settings and real HTTP loop read unsaved Markdown, stream in place, commit once and stop late output', async ({}, info) => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/b03/execution-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, '教案.md'); writeFileSync(filename, '# 原始内容\n\n需要调整。\n')
  const requests: any[] = []
  let finishEdit!: () => void, finishLate!: () => void
  const editing = new Promise<void>(resolve => { finishEdit = resolve }), late = new Promise<void>(resolve => { finishLate = resolve })
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-text' }] })); return }
    let body = ''; for await (const chunk of request) body += chunk.toString()
    const data = JSON.parse(body); requests.push(data)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const sendTool = (name: string, args: unknown, callId: string) => {
      const wire = data.tools.find((tool: any) => tool.function.description === data.tools.find((candidate: any) => candidate.function.name === name)?.function.description)?.function.name
      response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: wire ?? name, arguments: JSON.stringify(args) } }] }, 'tool_calls'))
    }
    if (requests.length === 1) {
      const references = JSON.parse(data.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档')).content.split('：')[1])
      sendTool('listChildren', { target: references[0].target }, 'read-children')
    } else if (requests.length === 2) {
      const children = JSON.parse(data.messages.filter((message: any) => message.role === 'tool').at(-1).content).data
      const name = data.tools.find((tool: any) => tool.function.parameters.properties?.target && tool.function.parameters.properties?.content?.type === 'string')?.function.name
      if (!name) throw new Error('fixture could not identify the text.replace schema')
      const args = JSON.stringify({ target: children[0].target, content: '# 课堂引入\n\n先复习，再提出问题😀。\n' })
      response.write(event({ role: 'assistant', reasoning_content: '根据未保存内容调整引入。' }))
      response.write(event({ tool_calls: [{ index: 0, id: 'edit-body', type: 'function', function: { name, arguments: args.slice(0, -5) } }] }))
      await editing
      response.write(event({ tool_calls: [{ index: 0, function: { arguments: args.slice(-5) } }] }, 'tool_calls'))
    } else if (requests.length === 3) response.write(event({ role: 'assistant', content: '课堂引入已经应用。' }, 'stop'))
    else { response.write(event({ role: 'assistant', content: '正在处理' })); await late; response.write(event({ content: '迟到结果' }, 'stop')) }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByLabel('给创作助手发消息').fill('先讨论课堂引入')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '尚未配置可用' })).toBeVisible()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('先讨论课堂引入')
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('fixture')
    await page.getByLabel('账号标识', { exact: true }).fill('local-test')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill('fixture-key-not-a-real-account')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    await page.getByRole('button', { name: '读取模型目录', exact: true }).click()
    await expect(page.getByText('fixture-text', { exact: true })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(settings.connections[0].connection.id)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-text')
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByText('模型角色已保存', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '教案.md', exact: true }).dblclick()
    const document = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), filename)
    await page.evaluate(async snapshot => { await window.desktopAPI!.documents!.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: 'human-unsaved-before-input', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '# 未保存的复习内容\n\n先预测。\n' } } }) }, document)
    await page.getByLabel('给创作助手发消息').fill('完善课堂引入，保留先复习后提问的顺序')
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('教案.md')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(page.locator('[data-edit-preview]').first()).toBeVisible()
    expect((await page.evaluate(async id => window.desktopAPI!.documents!.read(id), document.documentId)).model).toMatchObject({ source: '# 未保存的复习内容\n\n先预测。\n' })
    // M01: collapsing a pane must release its actual grid track without unmounting the running assistant.
    await page.getByLabel('给创作助手发消息').fill('下一条尚未发送的草稿')
    const contentRegion = page.locator('.workspace-region--content')
    const widthBefore = (await contentRegion.boundingBox())!.width
    // The explorer and the session list share the left column; hiding both releases that track.
    const toolbar = page.locator('.lesson-workspace-toolbar-actions')
    await toolbar.getByRole('button', { name: '资源管理器', exact: true }).click()
    await toolbar.getByRole('button', { name: '会话列表', exact: true }).click()
    await expect.poll(async () => (await contentRegion.boundingBox())!.width).toBeGreaterThan(widthBefore + 150)
    await toolbar.getByRole('button', { name: '资源管理器', exact: true }).click()
    await toolbar.getByRole('button', { name: '会话列表', exact: true }).click()
    for (let i = 0; i < 2; i++) {
      await toolbar.getByRole('button', { name: '会话列表', exact: true }).click()
      await toolbar.getByRole('button', { name: '会话列表', exact: true }).click()
    }
    expect(requests).toHaveLength(2)
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('下一条尚未发送的草稿')
    await expect(page.locator('[data-edit-preview]').first()).toBeVisible()
    await page.screenshot({ path: join(directory, 'streaming-preview.png') })
    finishEdit()
    await expect(page.getByText('课堂引入已经应用。', { exact: true })).toBeVisible()
    const after = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), document.documentId)
    expect(after.model).toMatchObject({ source: '# 课堂引入\n\n先复习，再提出问题😀。\n' })
    expect(after.undoDepth).toBe(2)
    await page.getByLabel('给创作助手发消息').fill('继续想一个例子')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => requests.length).toBe(4)
    await page.getByRole('button', { name: '停止', exact: true }).click()
    finishLate()
    await expect(page.getByText('已停止', { exact: true }).last()).toBeVisible()
    await page.screenshot({ path: join(directory, 'completed-and-stopped.png') })
    expect(errors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ requests: requests.map(request => ({ model: request.model, messages: request.messages.length })), after, errors }, null, 2))
    await info.attach('assistant', { path: join(directory, 'completed-and-stopped.png'), contentType: 'image/png' })
  } catch (error) {
    const page = await app.firstWindow().catch(() => undefined)
    if (page) {
      await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
      const snapshots = await page.evaluate(async () => {
        const documents = await window.desktopAPI!.documents!.list()
        return Promise.all(documents.map(async document => ({ document, previews: await window.desktopAPI!.execution!.edits(document.documentId) })))
      }).catch(() => [])
      writeFileSync(join(directory, 'failure-diagnostic.json'), JSON.stringify({ requests, snapshots }, null, 2))
    }
    throw error
  } finally {
    finishEdit(); finishLate()
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
