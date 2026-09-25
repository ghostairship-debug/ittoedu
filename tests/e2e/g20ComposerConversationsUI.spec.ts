import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const frame = (model: string, text: string, finish: string | null = 'stop') => `data: ${JSON.stringify({ id: 'composer-fixture', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: finish }] })}\n\n`
async function renameActiveConversation(page: Page, title: string) {
  const activeButton = page.locator('.execution-assistant__session-row > button[aria-current="page"]')
  const previousTitle = (await activeButton.innerText()).trim()
  await page.getByRole('button', { name: `管理会话 ${previousTitle}`, exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const input = page.getByRole('textbox', { name: `重命名 ${previousTitle}`, exact: true })
  await input.fill(title)
  await input.locator('..').getByRole('button', { name: '保存', exact: true }).click()
  await expect(activeButton).toHaveText(title)
}
async function harness(name: string, holdFirst = false) {
  const output = join(root, 'output/g20/m07/composer-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, `${name}-`)), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  writeFileSync(join(workspace, '教案.md'), '# 保持原文\n\n先预测，再观察。')
  writeFileSync(join(workspace, '参考资料.md'), 'M07 附件唯一正文：水沸腾后温度保持不变。')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), join(workspace, '演示.h5lesson'))
  const requests: any[] = [], errors: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }, { id: 'fixture-selection-2' }] })); return }
    expect(request.url).toBe('/v1/chat/completions')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body)
    const index = requests.length
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (holdFirst && index === 1) { response.write(frame(body.model, '正在处理原目标', null)); await firstGate; if (response.destroyed) return }
    response.end(frame(body.model, index === 1 && holdFirst ? '停止之后的迟到内容' : `本地请求 ${index} 已完成`) + 'data: [DONE]\n\n')
  })().catch(error => { errors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await setupSelectionUI(app, page, endpoint, workspace)
    await expect(page.getByLabel('给创作助手发消息')).toBeEnabled()
    return { app, page, directory, workspace, requests, errors, releaseFirst, async close() {
      releaseFirst()
      await app!.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
      await app!.close().catch(() => {})
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    } }
  } catch (error) {
    releaseFirst(); await app?.close().catch(() => {})
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); throw error
  }
}
async function conversations(page: Page, workspace: string) {
  return page.evaluate(async workspace => { const opened = await window.desktopAPI.execution!.workspace(workspace); return window.desktopAPI.execution!.conversations(opened.workspace.workspaceId) }, workspace)
}
// Owner 2026-09-24: sending never shows a service notice.
async function expectNoServiceNotice(page: Page) {
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}
async function failure(h: Awaited<ReturnType<typeof harness>>) {
  await h.page.screenshot({ path: join(h.directory, 'failure.png') }).catch(() => {})
  writeFileSync(join(h.directory, 'failure.json'), JSON.stringify({ requests: h.requests, errors: h.errors, conversations: await conversations(h.page, h.workspace).catch(() => []) }, null, 2))
}

test('M07-T03/T04 complete Composer keeps attachments, queues two messages, deletes one and explicitly stops before adjustment', async ({}, info) => {
  test.setTimeout(120_000)
  const h = await harness('queue', true), { page, app } = h
  try {
    const composer = page.getByLabel('给创作助手发消息')
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, join(h.workspace, '参考资料.md'))
    await page.getByRole('button', { name: '添加', exact: true }).click(); await page.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    await expect(page.getByRole('button', { name: '预览发送内容', exact: true })).toBeEnabled()
    await composer.fill('M07 原任务，包含明确选择的附件')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice(page)
    await expect.poll(() => h.requests.length).toBe(1)
    expect(JSON.stringify(h.requests[0])).toContain('M07 附件唯一正文')
    await expect(composer).toBeEnabled()
    await composer.fill('排队 A，等调整后继续'); await composer.press('Enter')
    const queuedA = page.getByRole('article', { name: '待处理消息' }).filter({ hasText: '排队 A，等调整后继续' })
    await expect(queuedA).toContainText('第 1 条')
    await composer.fill('排队 B，应删除'); await page.getByRole('button', { name: '加入队列', exact: true }).click()
    const queuedB = page.getByRole('article', { name: '待处理消息' }).filter({ hasText: '排队 B，应删除' })
    await expect(queuedB).toContainText('第 2 条')
    await queuedB.getByRole('button', { name: '删除排队消息', exact: true }).click()
    await expect(queuedB).toBeHidden(); expect(h.requests).toHaveLength(1)
    // A message typed while a task runs is queued; "立即执行" on that queued card stops the task and continues with it.
    await composer.fill('立即调整 C，先停止原任务'); await composer.press('Enter')
    const queuedC = page.getByRole('article', { name: '待处理消息' }).filter({ hasText: '立即调整 C，先停止原任务' })
    await queuedC.getByRole('button', { name: '立即执行（先停止当前任务）', exact: true }).click()
    await expect.poll(() => h.requests.length).toBe(3)
    h.releaseFirst()
    // Return to the newest timeline entries only when reading is paused on older entries.
    const latest = page.getByRole('button', { name: /回到最新/ })
    if (await latest.isVisible()) await latest.click()
    await expect(page.getByText('本地请求 3 已完成', { exact: true })).toBeVisible()
    const list = await conversations(page, h.workspace), current = list.find(value => value.messages.some(message => message.text.includes('M07 原任务')))!
    const runs = await page.evaluate(async ids => Promise.all(ids.map(id => window.desktopAPI.execution!.run(id))), current.runIndex.builtinRunIds)
    expect(runs.map(run => run?.input.instruction)).toEqual(['M07 原任务，包含明确选择的附件', '立即调整 C，先停止原任务', '排队 A，等调整后继续'])
    expect(runs[0]?.status).toBe('stopped'); expect(runs[1]?.continuedFrom).toBe(runs[0]?.runId); expect(runs[2]?.continuedFrom).toBe(runs[1]?.runId)
    expect(runs[0]?.input.inputContext?.attachments).toHaveLength(1)
    expect(h.requests).toHaveLength(3); expect(h.errors).toEqual([])
    await expect(page.getByText('停止之后的迟到内容', { exact: true })).toBeHidden()
    await page.screenshot({ path: join(h.directory, 'queue-adjust.png') })
    writeFileSync(join(h.directory, 'evidence.json'), JSON.stringify({ runs, requests: h.requests, errors: h.errors, nativeIME: 'not tested' }, null, 2))
    await info.attach('composer queue', { path: join(h.directory, 'queue-adjust.png'), contentType: 'image/png' })
  } catch (error) { await failure(h); throw error } finally { await h.close() }
})

test('M07-T01/T05/T06 left sessions preserve drafts across files, model changes and hidden assistant, then explicitly clear closed references', async ({}, info) => {
  test.setTimeout(180_000)
  const h = await harness('conversations'), { page } = h
  try {
    const tree = page.locator('.lesson-directory-tree'), composer = page.getByLabel('给创作助手发消息')
    await tree.getByRole('button', { name: '教案.md', exact: true }).dblclick()
    await expect(page.getByRole('tab', { name: /^教案.md/ })).toHaveAttribute('aria-selected', 'true')
    const originalComposer = await composer.elementHandle()
    await renameActiveConversation(page, '备课 A')
    await composer.fill('先讨论 Markdown 教案')
    await page.getByRole('button', { name: '发送', exact: true }).click(); await expectNoServiceNotice(page)
    await expect(page.getByText('本地请求 1 已完成', { exact: true })).toBeVisible()
    await expect(composer).toBeEnabled(); await composer.fill('切文件与模型时保留的同一草稿')
    await tree.getByRole('button', { name: '演示.h5lesson', exact: true }).dblclick()
    await expect(page.getByRole('tab', { name: /^演示.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
    await expect(composer).toHaveValue('切文件与模型时保留的同一草稿')
    expect(await composer.evaluate((element, original) => element === original, originalComposer)).toBe(true)
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('教案.md')
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-selection-2')
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByText('模型角色已保存', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await expect(composer).toHaveValue('切文件与模型时保留的同一草稿')
    await composer.press('Enter')
    // A new model is simply what the next send pins; there is no notice to acknowledge.
    await expectNoServiceNotice(page)
    await expect(page.getByText('本地请求 2 已完成', { exact: true })).toBeVisible()
    expect(h.requests.map(request => request.model)).toEqual(['fixture-selection', 'fixture-selection-2'])
    await composer.fill('A 尚未发送的独立草稿')
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect(composer).toHaveValue('')
    await renameActiveConversation(page, '备课 B')
    await composer.fill('B 尚未发送的独立草稿')
    await page.getByRole('button', { name: '关闭 教案.md', exact: true }).click()
    await page.getByRole('button', { name: '关闭 演示.h5lesson', exact: true }).click()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(0)
    await page.getByRole('button', { name: '备课 A', exact: true }).click()
    await expect(composer).toHaveValue('A 尚未发送的独立草稿')
    await expect(page.getByRole('article', { name: '用户消息' }).filter({ hasText: '先讨论 Markdown 教案' })).toBeVisible()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(0)
    await page.getByRole('button', { name: '备课 B', exact: true }).click()
    await expect(composer).toHaveValue('B 尚未发送的独立草稿')
    await page.getByRole('button', { name: '备课 A', exact: true }).click()
    await expect(composer).toHaveValue('A 尚未发送的独立草稿')
    expect(h.requests).toHaveLength(2); expect(h.errors).toEqual([])
    const list = await conversations(page, h.workspace)
    expect(list.find(value => value.title === '备课 A')?.inputDraft).toBe('A 尚未发送的独立草稿')
    expect(list.find(value => value.title === '备课 B')?.inputDraft).toBe('B 尚未发送的独立草稿')
    const a = list.find(value => value.title === '备课 A')!, b = list.find(value => value.title === '备课 B')!
    const sessions = page.getByRole('region', { name: '会话管理区', exact: true })
    await expect(sessions).toBeVisible()
    await expect(sessions.getByRole('button', { name: '备课 A', exact: true })).toHaveAttribute('aria-current', 'page')
    const search = sessions.getByRole('textbox', { name: '搜索会话', exact: true })
    await search.fill('备课 B')
    await expect(sessions.getByRole('button', { name: '备课 A', exact: true })).toHaveCount(0)
    await expect(sessions.getByRole('button', { name: '备课 B', exact: true })).toBeVisible()
    await search.fill('')
    await expect(sessions.getByRole('button', { name: '备课 A', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
    await expect(page.locator('.workspace-grid')).toHaveAttribute('data-chat-closed', 'true')
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await expect(sessions).toBeVisible()
    await sessions.getByRole('button', { name: '备课 B', exact: true }).click()
    await expect(sessions.getByRole('button', { name: '备课 B', exact: true })).toHaveAttribute('aria-current', 'page')
    expect((await conversations(page, h.workspace)).find(value => value.conversationId === b.conversationId)?.inputDraft).toBe('B 尚未发送的独立草稿')
    expect(h.requests).toHaveLength(2)
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
    await expect(page.locator('.workspace-grid')).toHaveAttribute('data-chat-closed', 'false')
    await expect(composer).toHaveValue('B 尚未发送的独立草稿')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice(page)
    await expect(page.getByRole('alert').filter({ hasText: '目标文档已关闭或重新打开' })).toBeVisible()
    expect(h.requests).toHaveLength(2)
    await expect(composer).toHaveValue('B 尚未发送的独立草稿')
    const rejected = page.getByRole('article', { name: '待处理消息' }).filter({ hasText: 'B 尚未发送的独立草稿' })
    await expect(rejected).toContainText('本次未发送')
    await expect(rejected.getByRole('button', { name: '用同一提交确认', exact: true })).toHaveCount(0)
    await page.getByLabel('本条消息的引用', { exact: true }).getByRole('button', { name: /^移除引用 / }).click()
    await expect(rejected).toHaveCount(0)
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('本条消息不引用文档')
    await expect(composer).toHaveValue('B 尚未发送的独立草稿')
    expect((await conversations(page, h.workspace)).find(value => value.conversationId === b.conversationId)?.frozenContextRefs).toHaveLength(0)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('本地请求 3 已完成', { exact: true })).toBeVisible()
    expect(h.requests).toHaveLength(3)
    const continued = (await conversations(page, h.workspace)).find(value => value.conversationId === b.conversationId)!
    expect(continued.runIndex.builtinRunIds).toHaveLength(1)
    expect(continued.messages.some(message => message.role === 'user' && message.text === 'B 尚未发送的独立草稿')).toBe(true)
    await sessions.getByRole('button', { name: '管理会话 备课 B', exact: true }).click()
    await sessions.getByRole('menuitem', { name: '删除会话', exact: true }).click()
    await expect(sessions.getByRole('button', { name: '备课 B', exact: true })).toHaveCount(0)
    const afterDelete = await conversations(page, h.workspace)
    expect(afterDelete.some(value => value.conversationId === b.conversationId)).toBe(false)
    expect(afterDelete.find(value => value.conversationId === a.conversationId)?.messages.some(message => message.text === '先讨论 Markdown 教案')).toBe(true)
    expect(readFileSync(join(h.workspace, '教案.md'), 'utf8')).toBe('# 保持原文\n\n先预测，再观察。')
    expect(existsSync(join(h.workspace, '演示.h5lesson'))).toBe(true)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(0)
    expect(h.requests).toHaveLength(3); expect(h.errors).toEqual([])
    await page.screenshot({ path: join(h.directory, 'independent-conversations.png') })
    writeFileSync(join(h.directory, 'evidence.json'), JSON.stringify({ beforeManagement: list, continued,
      afterDelete, models: h.requests.map(request => request.model), requests: h.requests.length, errors: h.errors, nativeIME: 'not tested' }, null, 2))
    await info.attach('independent conversations', { path: join(h.directory, 'independent-conversations.png'), contentType: 'image/png' })
  } catch (error) { await failure(h); throw error } finally { await h.close() }
})
