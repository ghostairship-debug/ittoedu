import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const frame = (model: string, text: string) => `data: ${JSON.stringify({ id: 'm07-rail-fixture', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\n`

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {})
}

async function readConversations(page: Page, workspace: string) {
  return page.evaluate(async directory => {
    const execution = window.desktopAPI!.execution!
    const opened = await execution.workspace(directory)
    return execution.conversations(opened.workspace.workspaceId)
  }, workspace)
}

test('M07-T06 left session rail manages independent conversations across document close and assistant hide', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses the Windows Electron desktop.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/m07/session-rail-management'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const firstFile = join(workspace, '教学计划.md'), secondFile = join(workspace, '课堂脚本.md')
  const firstSource = '# 教学计划\n\n先预测。\n', secondSource = '# 课堂脚本\n\n再观察。\n'
  writeFileSync(firstFile, firstSource); writeFileSync(secondFile, secondSource)
  const requests: { model: string }[] = [], errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string }
    requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(frame(body.model, `本地会话响应 ${requests.length}`) + 'data: [DONE]\n\n')
  })().catch(error => { errors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1560, 900))
    await setupSelectionUI(app, page, endpoint, workspace)

    const sessions = page.getByRole('region', { name: '会话管理区', exact: true })
    const rail = sessions.getByRole('complementary', { name: '会话列表', exact: true })
    const composer = page.getByLabel('给创作助手发消息')
    const tabs = page.locator('.workspace-document-tabs')
    const activeRow = () => rail.locator('.execution-assistant__session-row:has(> button[aria-current="page"])')
    const renameActive = async (oldTitle: string, newTitle: string) => {
      await activeRow().getByRole('button', { name: `管理会话 ${oldTitle}`, exact: true }).click()
      await activeRow().getByRole('menuitem', { name: '重命名', exact: true }).click()
      await rail.getByRole('textbox', { name: `重命名 ${oldTitle}`, exact: true }).fill(newTitle)
      await rail.getByRole('button', { name: '保存', exact: true }).click()
      await expect(activeRow().getByRole('button', { name: newTitle, exact: true })).toBeVisible()
    }
    const expectNoServiceNotice = () => expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(rail).toBeVisible()
    await expect(page.locator('.workspace-region--resources').getByRole('complementary', { name: '会话列表' })).toBeVisible()
    await expect(page.locator('.workspace-region--assistant').getByRole('complementary', { name: '会话列表' })).toHaveCount(0)
    // Name the initially unhomed conversation before browsing files; it stays an
    // independent workspace conversation while explorer selection filters the rail.
    await renameActive('新会话', '备课 A')
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '教学计划.md', exact: true }).dblclick()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '课堂脚本.md', exact: true }).dblclick()
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(rail.getByRole('button', { name: '备课 A', exact: true })).toHaveCount(0)
    await expect(page.locator('.execution-assistant__title > strong')).toHaveText('备课 A')
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: '工作空间根目录', exact: true }).click()
    await expect(rail.getByRole('button', { name: '备课 A', exact: true })).toBeVisible()
    const a = (await readConversations(page, workspace)).find(value => value.title === '备课 A')!
    await composer.fill('A 的第一次讨论')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice()
    await expect(page.getByText('本地会话响应 1', { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    await composer.fill('A 隐藏助手时保留的草稿')

    await rail.getByRole('button', { name: '新建会话', exact: true }).click()
    await renameActive('新会话', '备课 B')
    const b = (await readConversations(page, workspace)).find(value => value.title === '备课 B')!
    expect(b.conversationId).not.toBe(a.conversationId)
    await composer.fill('B 独立草稿')
    const search = rail.getByRole('textbox', { name: '搜索会话', exact: true })
    await search.fill('备课 A')
    await expect(rail.getByRole('button', { name: '备课 A', exact: true })).toBeVisible()
    await expect(rail.getByRole('button', { name: '备课 B', exact: true })).toHaveCount(0)
    await rail.getByRole('button', { name: '备课 A', exact: true }).click()
    await expect(composer).toHaveValue('A 隐藏助手时保留的草稿')
    await search.fill('')
    const assistantToggle = page.locator('.lesson-workspace-toolbar-actions').getByRole('button', { name: 'AI 助手', exact: true })
    await assistantToggle.click()
    await expect(page.locator('.workspace-grid')).toHaveAttribute('data-chat-closed', 'true')
    await expect(rail).toBeVisible()
    await rail.getByRole('button', { name: '备课 B', exact: true }).click()
    await rail.getByRole('button', { name: '备课 A', exact: true }).click()
    await expect(rail.getByRole('button', { name: '备课 A', exact: true })).toHaveAttribute('aria-current', 'page')
    expect((await readConversations(page, workspace)).find(value => value.conversationId === a.conversationId)?.inputDraft).toBe('A 隐藏助手时保留的草稿')
    expect(requests).toHaveLength(1)
    await assistantToggle.click()
    await expect(composer).toHaveValue('A 隐藏助手时保留的草稿')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice()
    await expect(page.getByText('本地会话响应 2', { exact: true })).toBeVisible()
    const continued = (await readConversations(page, workspace)).find(value => value.conversationId === a.conversationId)!
    expect(continued.runIndex.builtinRunIds).toHaveLength(2)
    expect(continued.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['A 的第一次讨论', 'A 隐藏助手时保留的草稿'])
    expect(requests).toHaveLength(2)

    await tabs.getByRole('button', { name: '关闭 教学计划.md', exact: true }).click()
    await tabs.getByRole('button', { name: '关闭 课堂脚本.md', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    await rail.getByRole('button', { name: '备课 B', exact: true }).click()
    await expect(composer).toHaveValue('B 独立草稿')
    await rail.getByRole('button', { name: '备课 A', exact: true }).click()
    await expect(page.getByRole('article', { name: '用户消息' }).filter({ hasText: 'A 的第一次讨论' })).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    expect(requests).toHaveLength(2)
    const removeRow = rail.locator('.execution-assistant__session-row').filter({ hasText: '备课 B' })
    await removeRow.getByRole('button', { name: '管理会话 备课 B', exact: true }).click()
    await removeRow.getByRole('menuitem', { name: '删除会话', exact: true }).click()
    await expect(rail.getByRole('button', { name: '备课 B', exact: true })).toHaveCount(0)
    const finalConversations = await readConversations(page, workspace)
    expect(finalConversations.some(value => value.conversationId === b.conversationId)).toBe(false)
    expect(finalConversations.find(value => value.conversationId === a.conversationId)?.runIndex.builtinRunIds).toHaveLength(2)
    expect(readFileSync(firstFile, 'utf8')).toBe(firstSource)
    expect(readFileSync(secondFile, 'utf8')).toBe(secondSource)
    expect(existsSync(firstFile) && existsSync(secondFile)).toBe(true)
    expect(errors).toEqual([])
    const screenshot = join(directory, 'session-rail.png'), evidence = join(directory, 'evidence.json')
    await page.screenshot({ path: screenshot })
    writeFileSync(evidence, JSON.stringify({ workspace, conversationA: a.conversationId, conversationB: b.conversationId,
      continuedRuns: continued.runIndex.builtinRunIds, finalConversations: finalConversations.map(value => value.conversationId),
      requests: requests.length, filesPreserved: [firstFile, secondFile], errors, provider: 'local fixture' }, null, 2))
    await info.attach('M07 session rail', { path: screenshot, contentType: 'image/png' })
  } catch (error) {
    await app?.windows()[0]?.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    if (app) await closeApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
