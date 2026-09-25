import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeSelectionApp, launchSelectionApp, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

async function localReply() {
  const requests: unknown[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] }))
      return
    }
    expect(request.url).toBe('/v1/chat/completions')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'conversation-home', model: 'fixture-selection', choices: [{ index: 0,
      delta: { role: 'assistant', content: '本地归属回复' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(() => response.destroy()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, requests,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

async function renameActive(page: Page, title: string) {
  const active = page.locator('.execution-assistant__session-row > button[aria-current="page"]')
  const previous = await active.getAttribute('aria-label')
  expect(previous).toBeTruthy()
  await page.getByRole('button', { name: `管理会话 ${previous}`, exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const input = page.getByRole('textbox', { name: `重命名 ${previous}`, exact: true })
  await input.fill(title)
  await input.locator('..').getByRole('button', { name: '保存', exact: true }).click()
  await expect(active).toHaveAttribute('aria-label', title)
}

test('S10 conversation homes filter the left list, preserve the right draft, and follow file rename/deletion', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The file tree and recycle-bin action use the Windows desktop carrier.')
  test.setTimeout(180_000)
  const fixture = selectionFixtures(), server = await localReply()
  const folder = join(fixture.workspace, 'Unit')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.md'), '# A home\n')
  writeFileSync(join(folder, 'b.md'), '# B home\n')
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const files = page.locator('.workspace-files-tree')
    const tree = files.getByRole('tree', { name: '工作空间文件' })
    const sessions = page.getByRole('region', { name: '会话管理区', exact: true })
    const row = (title: string) => sessions.locator('.execution-assistant__session-row').filter({ has: page.getByRole('button', { name: title, exact: true }) })
    const composer = page.getByRole('textbox', { name: '给创作助手发消息', exact: true })
    const current = page.locator('.execution-assistant__title > strong')

    await expect(tree.getByRole('button', { name: 'Unit', exact: true })).toBeVisible()
    await renameActive(page, '根会话')
    await tree.getByRole('button', { name: '展开 Unit', exact: true }).click()
    await tree.getByRole('button', { name: 'a.md', exact: true }).click()
    await expect(sessions.getByRole('button', { name: '根会话', exact: true })).toHaveCount(0)
    await expect(current).toHaveText('根会话')
    await sessions.getByRole('button', { name: '新建会话', exact: true }).click()
    await renameActive(page, '文件 A')
    await expect(row('文件 A')).toContainText('文件 · Unit/a.md')

    // The home is a default reference even though this file was never opened in a tab.
    await composer.fill('只讨论 A 文件')
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('默认引用 Unit/a.md')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('本地归属回复', { exact: true })).toBeVisible()
    const aRun = await page.evaluate(async root => {
      const api = window.desktopAPI.execution!
      const opened = await api.workspace(root)
      const a = (await api.conversations(opened.workspace.workspaceId)).find(value => value.title === '文件 A')!
      return { home: a.home, run: await api.run(a.runIndex.builtinRunIds.at(-1)!), files: await window.desktopAPI.documents!.list() }
    }, fixture.workspace)
    expect(aRun.home).toMatchObject({ kind: 'file', path: 'Unit/a.md' })
    expect(aRun.run?.input.documents).toHaveLength(1)
    const referencedId = aRun.run!.input.documents[0]!.documentId
    expect(aRun.files.find(value => value.documentId === referencedId)?.binding).toMatchObject({ kind: 'file', path: join(folder, 'a.md') })
    expect(server.requests).toHaveLength(1)

    await tree.getByRole('button', { name: 'b.md', exact: true }).click()
    await expect(sessions.getByRole('button', { name: '文件 A', exact: true })).toHaveCount(0)
    await expect(current).toHaveText('文件 A')
    await sessions.getByRole('button', { name: '新建会话', exact: true }).click()
    await renameActive(page, '文件 B')
    await composer.fill('B 的未发送草稿')
    await tree.getByRole('button', { name: 'a.md', exact: true }).click()
    await expect(row('文件 A')).toBeVisible()
    await expect(sessions.getByRole('button', { name: '文件 B', exact: true })).toHaveCount(0)
    await expect(current).toHaveText('文件 B')
    await expect(composer).toHaveValue('B 的未发送草稿')
    await tree.getByRole('button', { name: 'Unit', exact: true }).click()
    await expect(row('文件 A')).toBeVisible()
    await expect(row('文件 B')).toBeVisible()
    await expect(current).toHaveText('文件 B')
    await expect(composer).toHaveValue('B 的未发送草稿')
    await tree.getByRole('button', { name: '工作空间根目录', exact: true }).click()
    await expect(row('根会话')).toBeVisible()

    // In-app file operations keep the conversation but update its visible home.
    const aFile = tree.getByRole('button', { name: 'a.md', exact: true })
    await aFile.click(); await aFile.press('F2')
    await files.getByLabel('文件名称').fill('renamed.md')
    await files.getByRole('button', { name: '确认', exact: true }).click()
    await tree.getByRole('button', { name: 'Unit', exact: true }).click()
    await expect(row('文件 A')).toContainText('Unit/renamed.md')
    await expect(current).toHaveText('文件 B')
    await expect(composer).toHaveValue('B 的未发送草稿')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    const renamed = tree.getByRole('button', { name: 'renamed.md', exact: true })
    await renamed.click(); await renamed.press('Delete')
    await expect(row('文件 A')).toContainText('已删除')
    await expect(row('文件 A')).toContainText('Unit/renamed.md')
    await expect(current).toHaveText('文件 B')
    await expect(composer).toHaveValue('B 的未发送草稿')
    expect(errors).toEqual([])
    const screenshot = join(fixture.directory, 'conversation-homes.png')
    await page.screenshot({ path: screenshot })
    await info.attach('conversation homes', { path: screenshot, contentType: 'image/png' })
  } finally { await closeSelectionApp(app); await server.close() }
})
