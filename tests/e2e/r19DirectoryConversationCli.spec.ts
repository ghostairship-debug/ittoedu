import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

// F02 冒烟：工作空间/项目会话是完整 CLI 套皮（目录作用域裸提示词，cwd=会话目录）。
// 真实一轮最短对话；显式门控，避免日常回归隐式触发真实 CLI。
const root = resolve(__dirname, '../..')

test('r19 directory conversation: workspace session is a full CLI turn', async () => {
  test.skip(process.env.R19_DIRECTORY_CLI_RUN !== '1', 'Explicit one-turn native CLI gate')
  test.setTimeout(300_000)
  const evidence = join(root, 'output/r19-directory-cli', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(evidence, { recursive: true })
  const directory = mkdtempSync(join(tmpdir(), 'r19-directory-cli-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(30_000)
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')

    // 真实路由（与命名 Luna 规格同路径）
    const capabilities = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
    const luna = capabilities.capabilities?.models.find(model => /luna/i.test(model.id))
    expect(luna, 'Actual native catalog must offer Luna').toBeTruthy()
    const fast = luna!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
    const configuration = { model: luna!.id, effort: luna!.effort.kind === 'supported' ? (luna!.effort.values.includes('medium') ? 'medium' : luna!.effort.default ?? luna!.effort.values[0]!) : null, ...(fast ? { serviceTier: fast.id } : {}) }
    const configured = await page.evaluate(configuration => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'codex', configuration }), configuration)
    expect(configured.enabled).toBe(true)

    // 新建工作空间会话并打开聊天面板
    const scope = page.locator('.lesson-workspace-scope')
    await scope.getByRole('button', { name: '新建工作空间会话' }).click()
    const row = scope.locator('.lesson-session-row').first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page.locator('.course-chat--embedded')).toBeVisible()
    await expect(page.locator('.chat-composer-controls')).toBeVisible()
    await page.screenshot({ path: join(evidence, 'directory-conversation-composer.png') })

    // 发送一轮最短真实对话（唯一标记便于判定助手确实回复）
    await page.getByRole('textbox', { name: '给创作助手的消息' }).fill('只回复两个字：核桃。不要调用任何工具。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => page.locator('.chat-scroll').innerText(), { timeout: 180_000, intervals: [2_000, 5_000] }).toContain('核桃')
    await page.screenshot({ path: join(evidence, 'directory-conversation-reply.png') })

    // 记录归属与作用域：目录作用域，cwd=工作空间根（owner 路径需先归一化，与控制器一致）
    const normalized = workspace.replace(/\\/g, '/').toLowerCase()
    const conversations = await page.evaluate(async workspace => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', owner: { kind: 'workspace', workspaceRoot: workspace } })).conversations!, normalized)
    expect(conversations.length).toBeGreaterThan(0)
    const conversationId = conversations[0]!.conversationId
    const agentWorkspace = { version: 1 as const, kind: 'directory' as const, normalizedDirectory: normalized, conversationId }
    const records = await page.evaluate(async workspace => (await window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace })).records!, agentWorkspace)
    expect(records.length).toBeGreaterThan(0)
    const record = records[0]!
    expect('kind' in record.workspace && record.workspace.kind === 'directory').toBe(true)
    expect(('kind' in record.workspace ? record.workspace.normalizedDirectory : '').replace(/\\/g, '/').toLowerCase()).toBe(workspace.replace(/\\/g, '/').toLowerCase())

    // 收尾：仍在运行则停止
    const stop = page.getByRole('button', { name: '停止', exact: true })
    if (await stop.isVisible().catch(() => false)) await stop.click()
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
