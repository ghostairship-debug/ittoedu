import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

// 临时验证：V3.1 左栏「项目与会话」分层（资源管理器 → 项目分组会话 → 底部工作空间会话）。
const root = resolve(__dirname, '../..')
const evidence = join(root, 'docs/development-plan/reviews/2026-09-17-frontend-special-evidence')
mkdirSync(evidence, { recursive: true })

async function launch(profile: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
}
async function choose(app: ElectronApplication, filename: string) {
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, filename)
}

test('V31 nav hierarchy: project groups with own conversations + workspace sessions at bottom', async () => {
  test.setTimeout(240_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-v31-nav-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await launch(profile)
    const page = await app.firstWindow()
    await choose(app, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-error')).toHaveCount(0)

    // 段顺序：资源管理器 → 项目与会话（含底部工作空间会话）；旧的课例段与独立「项目」「工作空间会话」窗格不再存在
    await expect(page.locator('.lesson-workspace-navigation > .lesson-workspace-files')).toBeVisible()
    await expect(page.locator('.lesson-workspace-navigation > .lesson-workspace-sessions')).toBeVisible()
    await expect(page.locator('.lesson-workspace-navigation > .lesson-workspace-lessons')).toHaveCount(0)
    await expect(page.locator('.lesson-workspace-navigation > .lesson-workspace-projects')).toHaveCount(0)
    await expect(page.locator('.lesson-workspace-navigation > .lesson-workspace-directory')).toHaveCount(0)
    const filesBox = await page.locator('.lesson-workspace-files').boundingBox()
    const sessionsBox = await page.locator('.lesson-workspace-sessions').boundingBox()
    expect(filesBox!.y).toBeLessThan(sessionsBox!.y)

    // 新建项目：弹系统对话框选文件夹（可对话框内新建），确认条默认名 = 文件夹名
    const projectFolder = join(workspace, '九年级物理'); mkdirSync(projectFolder)
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, projectFolder)
    await page.getByRole('button', { name: '新建项目' }).first().click()
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveValue('九年级物理')
    await page.screenshot({ path: join(evidence, 'V31-project-pick-confirm.png') })
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    const group = page.locator('.lesson-project-group', { hasText: '九年级物理' })
    await expect(group).toBeVisible()
    await expect(group).toContainText('还没有项目会话')

    // 点项目行 = 设定作用域；工具条「新对话」归入该项目
    await group.getByRole('button', { name: '九年级物理', exact: true }).click()
    await expect(group.locator('.lesson-project-scope')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '新对话', exact: true })).toHaveAttribute('title', /九年级物理/)
    await page.getByRole('button', { name: '新对话', exact: true }).click()
    await expect(group.locator('.lesson-session-rows')).toBeVisible()
    await expect(group.locator('.lesson-session-rows')).not.toContainText('还没有项目会话')
    const projectConversationCount = await group.locator('.lesson-session-row').count()
    expect(projectConversationCount).toBeGreaterThan(0)

    // 工作空间会话在底部，且不含刚建的项目会话
    const scope = page.locator('.lesson-workspace-scope')
    await expect(scope).toBeVisible()
    await expect(scope).toContainText('工作空间会话')
    await scope.getByRole('button', { name: '新建工作空间会话' }).click()
    await expect(scope.locator('.lesson-session-row').first()).toBeVisible({ timeout: 15_000 })
    const workspaceCount = await scope.locator('.lesson-session-row').count()
    const projectCount = await group.locator('.lesson-session-row').count()
    expect(workspaceCount).toBeGreaterThan(0)
    expect(projectCount).toBeGreaterThan(0)
    // 项目会话与工作空间会话是不同记录（默认标题都叫"新对话"，不能按标题比对）
    expect(await scope.locator('.lesson-session-row').first().elementHandle()).not.toBe(await group.locator('.lesson-session-row').first().elementHandle())

    // 点工作空间行 = 作用域切回整个工作空间
    await scope.getByRole('button', { name: '工作空间会话', exact: true }).click()
    await expect(scope.locator('.lesson-workspace-scope-label')).toHaveAttribute('aria-pressed', 'true')
    await expect(group.locator('.lesson-project-scope')).toHaveAttribute('aria-pressed', 'false')
    await page.screenshot({ path: join(evidence, 'V31-nav-hierarchy.png') })

    // 重开：自动回到上次的工作空间，项目分组与各自会话真实恢复
    await app.close(); app = undefined
    app = await launch(profile)
    const reopened = await app.firstWindow()
    await expect(reopened.locator('.lesson-workspace-toolbar')).toContainText('workspace')
    await expect(reopened.locator('.lesson-workspace-error')).toHaveCount(0)
    const reopenedGroup = reopened.locator('.lesson-project-group', { hasText: '九年级物理' })
    await expect(reopenedGroup.locator('.lesson-session-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(reopened.locator('.lesson-workspace-scope').locator('.lesson-session-row').first()).toBeVisible()
    await reopened.screenshot({ path: join(evidence, 'V31-nav-relaunch.png') })
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
