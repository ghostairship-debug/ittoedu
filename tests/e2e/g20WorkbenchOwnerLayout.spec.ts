import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
    app.exit(0)
  }).catch(() => {})
  await app.close().catch(() => {})
}

async function openFromExplorer(page: Page, name: string) {
  await page.getByRole('region', { name: '资源管理器' }).getByRole('tree', { name: '工作空间文件' })
    .getByRole('button', { name, exact: true }).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
}

/** M01-T06 and M07-T06: real desktop controls; IPC below observes only persisted outcomes. */
test('M01-T06 M07-T06 Owner desktop layout, independent file and conversation management', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses the Windows Electron desktop.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/owner-layout')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, '教学计划.md'), '# 教学计划\n\n第一份文档。\n')
  writeFileSync(join(workspace, '课堂脚本.md'), '# 课堂脚本\n\n第二份文档。\n')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), join(workspace, '互动课件.h5lesson'))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setContentSize(1560, 900)
    })
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()

    const grid = page.locator('.workspace-grid')
    const resources = page.locator('.workspace-region--resources')
    const content = page.locator('.workspace-region--content')
    const assistant = page.locator('.workspace-region--assistant')
    const explorer = page.getByRole('region', { name: '资源管理器' })
    const sessions = page.getByRole('region', { name: '会话管理区' })
    const sessionList = sessions.getByRole('complementary', { name: '会话列表' })
    const toolbar = page.locator('.lesson-workspace-toolbar-actions')
    const resourceToggle = toolbar.getByRole('button', { name: '资源管理器', exact: true })
    const sessionToggle = toolbar.getByRole('button', { name: '会话列表', exact: true })
    const assistantToggle = toolbar.getByRole('button', { name: 'AI 助手', exact: true })
    const switcher = page.getByLabel('切换工作空间', { exact: true })
    const composer = page.getByLabel('给创作助手发消息')

    await expect(grid).toHaveAttribute('data-nav-collapsed', 'false')
    await expect(grid).toHaveAttribute('data-content-closed', 'false')
    await expect(grid).toHaveAttribute('data-chat-closed', 'false')
    await expect(explorer).toBeVisible()
    await expect(sessionList).toBeVisible()
    await expect(composer).toBeVisible()
    const composerModel = page.locator('.execution-assistant__composer-model')
    await expect(composerModel).toBeVisible()
    await expect(composerModel.getByRole('button', { name: '切换模型', exact: true })).toBeVisible()
    await composerModel.getByRole('button', { name: '切换模型', exact: true }).click()
    await expect(page.getByRole('group', { name: '对话模型选择' })).toBeVisible()
    await composerModel.getByRole('button', { name: '切换模型', exact: true }).click()
    await expect(resourceToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(sessionToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(assistantToggle).toHaveAttribute('aria-pressed', 'true')
    const positions = {
      switcher: (await switcher.boundingBox())!, resources: (await resources.boundingBox())!,
      explorer: (await explorer.boundingBox())!, sessions: (await sessions.boundingBox())!,
      content: (await content.boundingBox())!, assistant: (await assistant.boundingBox())!,
    }
    expect(positions.explorer.y + positions.explorer.height).toBeLessThanOrEqual(positions.sessions.y + 7)
    expect(positions.resources.x + positions.resources.width).toBeLessThan(positions.content.x)
    expect(positions.content.x + positions.content.width).toBeLessThan(positions.assistant.x)
    expect(positions.switcher.x).toBeLessThan(positions.resources.x + positions.resources.width)
    expect(positions.switcher.y).toBeLessThan(positions.resources.y)
    // The two splitters occupy the only gaps. A separate fourth scene-tree column fails this assertion.
    expect(positions.content.x - positions.resources.x - positions.resources.width).toBeLessThanOrEqual(7)
    expect(positions.assistant.x - positions.content.x - positions.content.width).toBeLessThanOrEqual(7)
    await expect(grid.locator(':scope > .workspace-region')).toHaveCount(3)

    await openFromExplorer(page, '教学计划.md')
    await expect(page.getByRole('region', { name: '教学文档 教学计划.md' })).toBeVisible()
    await expect(page.getByRole('region', { name: '课例工作台' }).locator(':scope > .workbench-layout-bar')).toHaveCount(0)
    await openFromExplorer(page, '课堂脚本.md')
    await expect(page.getByRole('region', { name: '教学文档 课堂脚本.md' })).toBeVisible()
    await openFromExplorer(page, '互动课件.h5lesson')
    await expect(page.getByTestId('canvas-stage').first()).toBeVisible()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(3)
    const workbench = page.getByRole('region', { name: '课例工作台' })
    const courseTabs = workbench.locator(':scope > .workspace-document-tabs')
    const courseTools = workbench.locator('.lesson-course-tab .course-light-tools')
    await expect(workbench.locator(':scope > .workbench-layout-bar')).toHaveCount(0)
    await expect(courseTabs).toBeVisible()
    await expect(courseTools).toBeVisible()
    await expect(courseTools.locator('.course-light-tools__row').getByRole('button', { name: '深度编辑', exact: true })).toBeVisible()
    await expect(workbench.getByRole('button', { name: /^外部打开/ })).toHaveCount(0)
    const tabsBox = (await courseTabs.boundingBox())!
    const toolsBox = (await courseTools.boundingBox())!
    expect(Math.abs(toolsBox.y - tabsBox.y - tabsBox.height)).toBeLessThanOrEqual(3)
    await expect(explorer).toBeVisible()
    await expect(sessionList).toBeVisible()
    await expect(composer).toBeVisible()
    await expect(grid.locator(':scope > .workspace-region')).toHaveCount(3)

    // Manage historical conversations through the left list and verify the right composer follows its selection.
    await expect(sessionList.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    const activeRow = () => sessionList.locator('.execution-assistant__session-row:has(> button[aria-current="page"])')
    await activeRow().getByRole('button', { name: '管理会话 新会话', exact: true }).click()
    await activeRow().getByRole('menuitem', { name: '重命名', exact: true }).click()
    await sessionList.getByRole('textbox', { name: '重命名 新会话' }).fill('备课讨论')
    await sessionList.getByRole('button', { name: '保存', exact: true }).click()
    await expect(activeRow().getByRole('button', { name: '备课讨论', exact: true })).toBeVisible()
    await composer.fill('第一条会话的未发送草稿')
    await sessionList.getByRole('textbox', { name: '搜索会话' }).click() // blur persists the draft
    const first = await page.evaluate(async workspace => {
      const state = await window.desktopAPI!.execution!.workspace(workspace)
      return state.conversations.find(value => value.title === '备课讨论')!
    }, workspace)
    await expect.poll(async () => page.evaluate(async ({ workspace, id }) => {
      const state = await window.desktopAPI!.execution!.workspace(workspace)
      return state.conversations.find(value => value.conversationId === id)?.inputDraft
    }, { workspace, id: first.conversationId })).toBe('第一条会话的未发送草稿')

    await sessionList.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect(sessionList.locator('.execution-assistant__session-row')).toHaveCount(2)
    await expect(composer).toHaveValue('')
    await activeRow().getByRole('button', { name: '管理会话 新会话', exact: true }).click()
    await activeRow().getByRole('menuitem', { name: '重命名', exact: true }).click()
    await sessionList.getByRole('textbox', { name: '重命名 新会话' }).fill('课件说明')
    await sessionList.getByRole('button', { name: '保存', exact: true }).click()
    await expect(activeRow().getByRole('button', { name: '课件说明', exact: true })).toBeVisible()
    await composer.fill('第二条会话的未发送草稿')
    await sessionList.getByRole('textbox', { name: '搜索会话' }).click()
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: '教学计划.md', exact: true }).click()
    await expect(page.getByRole('region', { name: '教学文档 教学计划.md' })).toBeVisible()
    await expect(page.locator('.execution-assistant__title > strong')).toHaveText('课件说明')
    await expect(composer).toHaveValue('第二条会话的未发送草稿')
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: '互动课件.h5lesson', exact: true }).click()
    await expect(page.getByTestId('canvas-stage').first()).toBeVisible()
    await expect(workbench.locator(':scope > .workbench-layout-bar')).toHaveCount(0)
    await expect(courseTools.locator('.course-light-tools__row').getByRole('button', { name: '深度编辑', exact: true })).toBeVisible()
    await expect(page.locator('.execution-assistant__title > strong')).toHaveText('课件说明')
    const threeColumns = join(directory, 'three-columns-with-course.png')
    await page.screenshot({ path: threeColumns })
    await info.attach('three-columns-with-course', { path: threeColumns, contentType: 'image/png' })
    await sessionList.getByRole('textbox', { name: '搜索会话' }).fill('备课')
    await expect(sessionList.locator('.execution-assistant__session-row')).toHaveCount(1)
    await sessionList.getByRole('button', { name: '备课讨论', exact: true }).click()
    await expect(composer).toHaveValue('第一条会话的未发送草稿')
    await expect(page.locator('.execution-assistant__title > strong')).toHaveText('备课讨论')
    await sessionList.getByRole('textbox', { name: '搜索会话' }).fill('')
    await sessionList.getByRole('button', { name: '课件说明', exact: true }).click()
    await expect(composer).toHaveValue('第二条会话的未发送草稿')

    const beforeHideWidth = (await content.boundingBox())!.width
    await resourceToggle.click()
    await expect(explorer).toBeHidden()
    await expect(sessionList).toBeVisible()
    await expect(composer).toHaveValue('第二条会话的未发送草稿')
    await resourceToggle.click()
    await expect(explorer).toBeVisible()
    await sessionToggle.click()
    await expect(sessionList).toBeHidden()
    await expect(explorer).toBeVisible()
    await sessionToggle.click()
    await expect(sessionList).toBeVisible()
    await resourceToggle.click()
    await sessionToggle.click()
    await expect(grid).toHaveAttribute('data-nav-collapsed', 'true')
    await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(beforeHideWidth + 150)
    await resourceToggle.click()
    await sessionToggle.click()
    await expect(explorer).toBeVisible()
    await expect(sessionList).toBeVisible()
    await assistantToggle.click()
    await expect(grid).toHaveAttribute('data-chat-closed', 'true')
    await expect(composer).toBeHidden()
    await expect(sessionList).toBeVisible()
    await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(beforeHideWidth + 200)
    await sessionList.getByRole('button', { name: '备课讨论', exact: true }).click()
    await expect(activeRow().getByRole('button', { name: '备课讨论', exact: true })).toBeVisible()
    await assistantToggle.click()
    await expect(composer).toBeVisible()
    await expect(composer).toHaveValue('第一条会话的未发送草稿')
    await composer.fill('第一条会话的未发送草稿，隐藏助手后继续。')
    await sessionList.getByRole('textbox', { name: '搜索会话' }).click()

    const tabs = page.locator('.workspace-document-tabs')
    await tabs.getByRole('button', { name: '关闭 互动课件.h5lesson', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: '互动课件.h5lesson', exact: true })).toHaveCount(0)
    await tabs.getByRole('button', { name: '关闭 课堂脚本.md', exact: true }).click()
    await tabs.getByRole('button', { name: '关闭 教学计划.md', exact: true }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(0)
    await expect(sessionList.getByRole('button', { name: '备课讨论', exact: true })).toBeVisible()
    await expect(composer).toHaveValue('第一条会话的未发送草稿，隐藏助手后继续。')
    for (const name of ['教学计划.md', '课堂脚本.md', '互动课件.h5lesson']) expect(existsSync(join(workspace, name))).toBe(true)

    // Deleting a conversation from its own left-side menu must keep files and the other conversation.
    const removed = await page.evaluate(async workspace => (await window.desktopAPI!.execution!.workspace(workspace)).conversations.find(value => value.title === '课件说明')!, workspace)
    const removeRow = sessionList.locator('.execution-assistant__session-row').filter({ hasText: '课件说明' })
    await removeRow.getByRole('button', { name: '管理会话 课件说明', exact: true }).click()
    await removeRow.getByRole('menuitem', { name: '删除会话', exact: true }).click()
    await expect(sessionList.getByRole('button', { name: '课件说明', exact: true })).toHaveCount(0)
    await expect(sessionList.getByRole('button', { name: '备课讨论', exact: true })).toBeVisible()
    await expect(composer).toHaveValue('第一条会话的未发送草稿，隐藏助手后继续。')
    await expect.poll(async () => page.evaluate(async ({ workspace, id }) => {
      const state = await window.desktopAPI!.execution!.workspace(workspace)
      return state.conversations.some(value => value.conversationId === id)
    }, { workspace, id: removed.conversationId })).toBe(false)
    await expect.poll(async () => page.evaluate(async ({ workspace, id }) => {
      const state = await window.desktopAPI!.execution!.workspace(workspace)
      return state.conversations.find(value => value.conversationId === id)?.inputDraft
    }, { workspace, id: first.conversationId })).toBe('第一条会话的未发送草稿，隐藏助手后继续。')
    expect(await page.evaluate(async ({ workspace, id }) => {
      const execution = window.desktopAPI!.execution!
      const state = await execution.workspace(workspace)
      return { draft: state.conversations.find(value => value.conversationId === id)?.inputDraft,
        count: state.conversations.length, submissions: await execution.submissions({ workspaceId: state.workspace.workspaceId, conversationId: id }) }
    }, { workspace, id: first.conversationId })).toEqual({ draft: '第一条会话的未发送草稿，隐藏助手后继续。', count: 1, submissions: [] })
    for (const name of ['教学计划.md', '课堂脚本.md', '互动课件.h5lesson']) expect(existsSync(join(workspace, name))).toBe(true)
    expect(errors).toEqual([])
    const screenshot = join(directory, 'owner-layout.png')
    await page.screenshot({ path: screenshot })
    await info.attach('owner-layout', { path: screenshot, contentType: 'image/png' })
  } catch (error) {
    await app.windows()[0]?.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    await close(app)
  }
})
