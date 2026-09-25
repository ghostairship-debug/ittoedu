import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

// S10-T01: files and conversations change independently in the real window. The
// model shown is the space's next-task configuration and must not fork per file.
async function replyServer() {
  const requests: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(Buffer.concat(chunks).toString())
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: `s10-${requests.length}`, model: 'fixture-selection', choices: [{ index: 0,
      delta: { role: 'assistant', content: `本地回复 ${requests.length}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(() => response.destroy()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, requests,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
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

test('S10-T01 files and conversations change independently while drafts and the model follow conversation rules', async ({}, info) => {
  test.setTimeout(240_000)
  const fixture = selectionFixtures(), server = await replyServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const names = ['selection.md', 'flow.h5lesson', 'spatial.h5lesson']
  const diskBefore = Object.fromEntries(names.map(name => [name, readFileSync(join(fixture.workspace, name)).toString('base64')]))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    for (const name of names) await openSelectionFile(page, fixture.workspace, name)
    const tabs = page.locator('.workspace-document-tabs').getByRole('tab')
    const tab = (name: string) => page.locator('.workspace-document-tabs').getByRole('tab', { name: new RegExp(`^${name.replace('.', '\\.')}`) })
    const composer = page.getByLabel('给创作助手发消息', { exact: true })
    // The summary span (provider · model · billing), without the “切换模型” button text.
    const model = page.getByLabel('当前模型', { exact: true }).locator('span').nth(1)
    const sessions = page.getByRole('region', { name: '会话管理区', exact: true })
    const session = (title: string) => sessions.getByRole('button', { name: title, exact: true })
    const userMessage = (text: string) => page.getByRole('article', { name: '用户消息' }).filter({ hasText: text })
    const expectState = async (state: { conversation: string; tab: string; tabs: number; draft: string }) => {
      await expect(session(state.conversation)).toHaveAttribute('aria-current', 'page')
      await expect(tab(state.tab)).toHaveAttribute('aria-selected', 'true')
      await expect(tabs).toHaveCount(state.tabs)
      await expect(composer).toHaveValue(state.draft)
      await expect(model).toHaveText(modelText)
    }
    await expect(tabs).toHaveCount(3)
    await expect(tab('spatial.h5lesson')).toHaveAttribute('aria-selected', 'true')
    const modelText = (await model.innerText()).trim()
    expect(modelText).toContain('fixture-selection')

    await renameActiveConversation(page, '会话甲')
    await composer.fill('甲的问题')
    await page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(page.getByText('本地回复 1', { exact: true })).toBeVisible()
    await expect(composer).toBeEnabled()
    await composer.fill('甲的草稿')
    const trail: Record<string, unknown>[] = []
    const record = async (step: string) => trail.push({ step, tab: await page.locator('.workspace-document-tabs [role="tab"][aria-selected="true"]').innerText(),
      tabs: await tabs.count(), conversation: (await page.locator('.execution-assistant__session-row > button[aria-current="page"]').innerText()).trim(),
      draft: await composer.inputValue(), model: (await model.innerText()).trim() })

    // File switch: the conversation, its draft and the model stay put.
    await tab('selection.md').click()
    await expectState({ conversation: '会话甲', tab: 'selection.md', tabs: 3, draft: '甲的草稿' })
    await expect(userMessage('甲的问题')).toHaveCount(1)
    await record('switch-file-in-A')

    // New conversation: open files and the active tab are untouched.
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect(composer).toHaveValue('')
    await renameActiveConversation(page, '会话乙')
    await expectState({ conversation: '会话乙', tab: 'selection.md', tabs: 3, draft: '' })
    await expect(userMessage('甲的问题')).toHaveCount(0)
    await composer.fill('乙的草稿')
    await tab('flow.h5lesson').click()
    await expectState({ conversation: '会话乙', tab: 'flow.h5lesson', tabs: 3, draft: '乙的草稿' })
    await record('switch-file-in-B')

    // Conversation switch with files open: the tab strip does not follow the conversation.
    await session('会话甲').click()
    await expectState({ conversation: '会话甲', tab: 'flow.h5lesson', tabs: 3, draft: '甲的草稿' })
    await expect(userMessage('甲的问题')).toHaveCount(1)
    await record('switch-conversation-to-A')

    // Closing a file changes the tabs only.
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 spatial.h5lesson', exact: true }).click()
    await expectState({ conversation: '会话甲', tab: 'flow.h5lesson', tabs: 2, draft: '甲的草稿' })
    await session('会话乙').click()
    await expectState({ conversation: '会话乙', tab: 'flow.h5lesson', tabs: 2, draft: '乙的草稿' })
    await expect(userMessage('甲的问题')).toHaveCount(0)
    await tab('selection.md').click()
    await session('会话甲').click()
    await expectState({ conversation: '会话甲', tab: 'selection.md', tabs: 2, draft: '甲的草稿' })
    await record('close-file-and-alternate')

    const persisted = await page.evaluate(async root => {
      const opened = await window.desktopAPI.execution!.workspace(root)
      return (await window.desktopAPI.execution!.conversations(opened.workspace.workspaceId))
        .map(value => ({ title: value.title, draft: value.inputDraft, userMessages: value.messages.filter(message => message.role === 'user').map(message => message.text) }))
    }, fixture.workspace)
    expect(persisted.find(value => value.title === '会话甲')).toMatchObject({ draft: '甲的草稿', userMessages: ['甲的问题'] })
    expect(persisted.find(value => value.title === '会话乙')).toMatchObject({ draft: '乙的草稿', userMessages: [] })
    const documents = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).map(value => ({ path: value.binding.kind === 'file' ? value.binding.path : null, dirty: value.dirty })))
    // Only file-bound sessions follow the tab strip; a clean untitled session that exists
    // before any file is opened is recorded but is not part of this orthogonality check.
    const fileDocuments = documents.filter(value => value.path !== null)
    expect(fileDocuments.map(value => value.path!.split(/[\\/]/).at(-1)).sort()).toStrictEqual(['flow.h5lesson', 'selection.md'])
    expect(documents.every(value => !value.dirty)).toBe(true)
    for (const name of names) expect(readFileSync(join(fixture.workspace, name)).toString('base64')).toBe(diskBefore[name])
    expect(server.requests).toHaveLength(1)
    expect(errors).toEqual([])
    const path = join(fixture.directory, 's10-t01-evidence.json')
    writeFileSync(path, JSON.stringify({ caseId: 'S10-T01', model: modelText, trail, persisted, documents,
      untitledCleanSessions: documents.filter(value => value.path === null && !value.dirty).length, requests: server.requests.length, errors }, null, 2))
    await info.attach('S10-T01 orthogonality evidence', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})
