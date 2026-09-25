import { expect, test } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionFixtures, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

test('M14-T02 keyboard menus return focus and file shortcuts stay in their focus domain', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Electron keyboard carrier is required')
  test.setTimeout(180_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const file = join(fixture.workspace, 'selection.md')
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    await openSelectionFile(page, fixture.workspace, 'selection.md')
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    const composer = assistant.getByRole('textbox', { name: '给创作助手发消息', exact: true })
    const plus = assistant.getByRole('button', { name: '添加', exact: true })
    const permission = assistant.getByRole('button', { name: '权限：完全访问（工作空间）', exact: true })
    const model = assistant.getByRole('button', { name: '切换模型', exact: true })
    await composer.fill('ab')

    await plus.click()
    const addMenu = page.getByRole('menu', { name: '添加内容', exact: true })
    await expect(addMenu.getByRole('menuitem', { name: '添加附件（图片或文档）' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(addMenu).toHaveCount(0)
    await expect(plus).toBeFocused()

    await permission.click()
    const permissionMenu = page.getByRole('menu', { name: '权限模式', exact: true })
    await expect(permissionMenu.getByRole('menuitemradio').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(permissionMenu).toHaveCount(0)
    await expect(permission).toBeFocused()
    await permission.press('Enter')
    await permissionMenu.getByRole('menuitemradio', { name: /只读/ }).focus()
    await page.keyboard.press('Enter')
    await expect(permissionMenu).toHaveCount(0)
    const readOnlyPermission = assistant.getByRole('button', { name: '权限：只读', exact: true })
    await expect(readOnlyPermission).toBeFocused()
    await readOnlyPermission.press('Enter')
    await permissionMenu.getByRole('menuitemradio', { name: /完全访问（工作空间）/ }).focus()
    await page.keyboard.press('Enter')
    await expect(permission).toBeFocused()

    await model.click()
    const modelMenu = page.getByRole('group', { name: '对话模型选择', exact: true })
    await expect(modelMenu.getByRole('button').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(modelMenu).toHaveCount(0)
    await expect(model).toBeFocused()
    await model.press('Enter')
    await modelMenu.getByRole('button').first().press('Enter')
    await expect(modelMenu).toHaveCount(0)
    await expect(model).toBeFocused()

    const files = page.locator('.workspace-files-tree')
    const row = files.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'selection.md', exact: true })
    await row.click()
    await row.press('F2')
    const dialog = files.getByRole('dialog', { name: '文件操作' })
    const name = dialog.getByRole('textbox', { name: '文件名称' })
    await expect(name).toBeFocused()
    await name.press('Tab')
    await expect(dialog.getByRole('button', { name: '确认' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(name).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(row).toBeFocused()
    expect(existsSync(file)).toBe(true)

    await row.press('F2')
    await expect(name).toBeFocused()
    await name.fill('renamed.md')
    await name.evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
      const legacyEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      Object.defineProperty(legacyEnter, 'keyCode', { value: 229 })
      element.dispatchEvent(legacyEnter)
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await expect(dialog).toBeVisible()
    expect(existsSync(file)).toBe(true)
    expect(existsSync(join(fixture.workspace, 'renamed.md'))).toBe(false)
    await name.press('Enter')
    await expect(dialog).toHaveCount(0)
    const renamed = join(fixture.workspace, 'renamed.md')
    await expect.poll(() => existsSync(renamed)).toBe(true)
    expect(existsSync(file)).toBe(false)

    // Tree selection must not route Delete or Ctrl+A from the chat input to file operations.
    await composer.focus()
    await composer.press('Home')
    await composer.press('Delete')
    await expect(composer).toHaveValue('b')
    await composer.press('Control+A')
    await page.keyboard.insertText('中文草稿')
    await expect(composer).toHaveValue('中文草稿')
    await expect(dialog).toHaveCount(0)
    expect(existsSync(renamed)).toBe(true)
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 'm14-t02-keyboard-focus.json')
    writeFileSync(evidence, JSON.stringify({ caseId: 'M14-T02', carrier: 'Windows Electron',
      menus: ['add', 'permission', 'model'], focusReturnedOnEscape: true, focusReturnedAfterSelection: ['permission', 'model'],
      fileDialog: { initialFocus: 'name', tabWrap: true, focusReturnedOnEscape: true, composingEnterIgnored: true, keyCode229Ignored: true, plainEnterRenamed: true },
      focusDomains: { composerDelete: 'text only', composerSelectAll: 'text only', filePreserved: true },
      realWindowsIme: 'not exercised here; existing M07-T02 native IME evidence is separate', modelRequests: server.requests.length, errors }, null, 2))
    await info.attach('M14-T02 keyboard evidence', { path: evidence, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M14-T02 choosing a different verified local model returns focus to the model button', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Electron keyboard carrier is required')
  test.setTimeout(180_000)
  const fixture = selectionFixtures(), requests: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }, { id: 'fixture-alternative' }] })); return }
    let raw = ''; for await (const chunk of request) raw += chunk.toString()
    const body = JSON.parse(raw) as { model: string; messages: { content: string }[] }
    requests.push(body.model)
    const token = body.messages.find(message => message.content.includes('token：'))?.content.split('token：')[1]?.trim()
    if (!token) { response.writeHead(400); response.end('Only the local capability probe is expected'); return }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'local-capability', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'probe', type: 'function', function: { name: 'capability_probe', arguments: JSON.stringify({ token }) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(() => response.destroy()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const app = await launchSelectionApp(fixture.directory), page = await app.firstWindow()
  try {
    await setupSelectionUI(app, page, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, fixture.workspace)
    const initialModel = await page.evaluate(async () => (await window.desktopAPI.executionSettings!.read()).profile.roles.conversation!.model)
    const stagedRevision = await page.evaluate(async () => {
      const api = window.desktopAPI.executionSettings!, current = await api.read()
      const saved = await api.saveProfile({ expectedRevision: current.profile.revision, roles: {
        ...current.profile.roles, conversation: { ...current.profile.roles.conversation!, model: 'fixture-alternative' },
      } })
      return saved.revision
    })
    const probe = await page.evaluate(async revision => window.desktopAPI.executionSettings!.probeCapabilities({ role: 'conversation', expectedProfileRevision: revision, checks: ['tools'] }), stagedRevision)
    expect(probe.facts.tools?.status).toBe('supported')
    await page.evaluate(async model => {
      const api = window.desktopAPI.executionSettings!, current = await api.read()
      await api.saveProfile({ expectedRevision: current.profile.revision, roles: {
        ...current.profile.roles, conversation: { ...current.profile.roles.conversation!, model },
      } })
    }, initialModel)
    await page.reload()
    const model = page.getByRole('button', { name: '切换模型', exact: true })
    await expect(model).toContainText('fixture-selection')
    await model.click()
    const menu = page.getByRole('group', { name: '对话模型选择', exact: true })
    const choice = menu.getByRole('button', { name: /fixture-alternative/ })
    await expect(choice).toBeEnabled()
    await choice.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(model).toBeFocused()
    await expect(model).toContainText('fixture-alternative')
    expect(requests).toEqual(['fixture-alternative'])
    const evidence = join(fixture.directory, 'm14-t02-model-switch-focus.json')
    writeFileSync(evidence, JSON.stringify({ caseId: 'M14-T02', carrier: 'Windows Electron', verifiedLocalModelSwitch: true,
      selectedModel: 'fixture-alternative', focusReturnedTo: '切换模型', paidRequests: 0, localProbeRequests: requests }, null, 2))
    await info.attach('M14-T02 model switch evidence', { path: evidence, contentType: 'application/json' })
  } finally {
    await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
