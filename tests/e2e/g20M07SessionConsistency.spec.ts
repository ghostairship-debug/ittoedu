import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const frame = (model: string, text: string) =>
  `data: ${JSON.stringify({ id: 'm07-consistency-fixture', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\n`

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {})
}

async function conversations(page: Page, workspace: string) {
  return page.evaluate(async directory => {
    const api = window.desktopAPI.execution!
    const opened = await api.workspace(directory)
    return api.conversations(opened.workspace.workspaceId)
  }, workspace)
}

// Owner 2026-09-24: sending never shows a service notice.
async function expectNoServiceNotice(page: Page) {
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}

test('M07-T01/T05 one composer and conversation survive Markdown/course, model, file and history switches', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses the Windows Electron desktop.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/m07/session-consistency'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const markdown = join(workspace, '教案.md'), course = join(workspace, '演示.h5lesson')
  const originalMarkdown = '# 同一会话\n\n先预测，再观察。\n'
  writeFileSync(markdown, originalMarkdown)
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), course)
  const requests: { model: string; documentIds: string[] }[] = [], errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }, { id: 'fixture-selection-2' }] }))
      return
    }
    expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string; messages: { content?: unknown }[] }
    const prefix = '本次固定文档与权限（切换界面不改变它们）：'
    const frozen = body.messages.find(message => typeof message.content === 'string' && message.content.startsWith(prefix))
    const refs = frozen ? JSON.parse((frozen.content as string).slice(prefix.length)) as { documentId: string }[] : []
    requests.push({ model: body.model, documentIds: refs.map(ref => ref.documentId) })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(frame(body.model, `会话回复 ${requests.length}`) + 'data: [DONE]\n\n')
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

    const rail = page.getByRole('complementary', { name: '会话列表', exact: true })
    const tabs = page.locator('.workspace-document-tabs')
    const composer = page.getByLabel('给创作助手发消息')
    await expect(composer).toHaveCount(1)
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: '教案.md', exact: true }).dblclick()
    await expect(tabs.getByRole('tab', { name: /^教案.md/ })).toHaveAttribute('aria-selected', 'true')
    const documentId = (path: string) => page.evaluate(async filename => (await window.desktopAPI.documents!.list())
      .find(item => item.binding.kind === 'file' && item.binding.path.toLowerCase() === filename.toLowerCase())?.documentId ?? null, path)
    await expect.poll(() => documentId(markdown)).not.toBeNull()
    const markdownId = await documentId(markdown)
    await composer.fill('在 Markdown 中讨论')
    await page.getByRole('button', { name: '发送', exact: true }).click(); await expectNoServiceNotice(page)
    await expect(page.getByText('会话回复 1', { exact: true })).toBeVisible()

    await tree.getByRole('button', { name: '演示.h5lesson', exact: true }).dblclick()
    await expect(tabs.getByRole('tab', { name: /^演示.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => documentId(course)).not.toBeNull()
    const courseId = await documentId(course)
    await composer.fill('在课件中续谈，切模型后发送')
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-selection-2')
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByText('模型角色已保存', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await expect(composer).toHaveCount(1)
    await expect(composer).toHaveValue('在课件中续谈，切模型后发送')
    await composer.press('Enter'); await expectNoServiceNotice(page)
    await expect(page.getByText('会话回复 2', { exact: true })).toBeVisible()
    expect(requests).toEqual([
      { model: 'fixture-selection', documentIds: [markdownId] },
      { model: 'fixture-selection-2', documentIds: [courseId] },
    ])

    const original = (await conversations(page, workspace)).find(value => value.messages.some(message => message.text === '在 Markdown 中讨论'))!
    expect(original.runIndex.builtinRunIds).toHaveLength(2)
    await composer.fill('原会话未发草稿')
    const titleBeforeRename = (await rail.locator('.execution-assistant__session-row > button[aria-current="page"]').innerText()).trim()
    await rail.getByRole('button', { name: `管理会话 ${titleBeforeRename}`, exact: true }).click()
    await rail.getByRole('menuitem', { name: '重命名', exact: true }).click()
    await rail.getByRole('textbox', { name: `重命名 ${titleBeforeRename}`, exact: true }).fill('备课历史')
    await rail.getByRole('button', { name: '保存', exact: true }).click()
    await expect(rail.getByRole('button', { name: '备课历史', exact: true })).toBeVisible()
    await rail.getByRole('button', { name: '新建会话', exact: true }).click()
    await composer.fill('新会话独立草稿')
    await tabs.getByRole('button', { name: '关闭 教案.md', exact: true }).click()
    await tabs.getByRole('button', { name: '关闭 演示.h5lesson', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    await rail.getByRole('button', { name: '备课历史', exact: true }).click()
    await expect(composer).toHaveValue('原会话未发草稿')
    await expect(page.getByRole('article', { name: '用户消息' }).filter({ hasText: '在 Markdown 中讨论' })).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    const restored = (await conversations(page, workspace)).find(value => value.conversationId === original.conversationId)!
    expect(restored.inputDraft).toBe('原会话未发草稿')
    expect(restored.runIndex.builtinRunIds).toEqual(original.runIndex.builtinRunIds)
    await rail.getByRole('button', { name: '新会话', exact: true }).click()
    await expect(composer).toHaveValue('新会话独立草稿')
    expect(requests).toHaveLength(2)
    expect(readFileSync(markdown, 'utf8')).toBe(originalMarkdown)
    expect(existsSync(course)).toBe(true)
    expect(errors).toEqual([])
    const screenshot = join(directory, 'session-consistency.png')
    await page.screenshot({ path: screenshot })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ models: requests.map(value => value.model),
      documentIds: requests.map(value => value.documentIds), originalConversationId: original.conversationId,
      originalRuns: restored.runIndex.builtinRunIds, requestCount: requests.length, filesPreserved: true, errors,
      provider: 'local HTTP fixture' }, null, 2))
    await info.attach('M07 session consistency', { path: screenshot, contentType: 'image/png' })
  } catch (error) {
    await app?.windows()[0]?.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    if (app) await closeApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
