import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

// F08 路径 A：不建项目，从工作空间直接编辑、保存、重开并继续会话（真实应用，无模型调用）。
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
async function dockOf(page: Page): Promise<string> {
  return (await page.locator('.lesson-workspace-columns').getAttribute('data-dock')) ?? ''
}

test('F08 path A: workspace root markdown edit, save, layout adjust, relaunch continuity', async () => {
  test.setTimeout(240_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-f08-pathA-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const note = join(workspace, '备课笔记.md')
  writeFileSync(note, '# 备课笔记\n\n原始一行。\n')
  let app: ElectronApplication | undefined
  try {
    app = await launch(profile)
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开工作空间', exact: true }).first()).toBeVisible()
    await choose(app, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
    await expect(page.locator('.lesson-workspace-error')).toHaveCount(0)
    await page.screenshot({ path: join(evidence, 'A1-workspace-open.png') })

    // 根目录 MD：从资源管理器打开为可编辑文档标签
    await page.getByRole('button', { name: '刷新工作空间根目录' }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '备课笔记.md', exact: true }).click()
    const editor = page.locator('.lesson-file-tab:not([hidden]) .ProseMirror')
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('原始一行')
    await page.screenshot({ path: join(evidence, 'A2-root-md-open.png') })

    // 编辑并真实保存到磁盘（会话 800ms 静默自动保存）
    await editor.click()
    await expect(editor).toBeFocused()
    await page.keyboard.press('End')
    await editor.pressSequentially('教师补充的第二行。', { delay: 60 })
    await expect.poll(() => readFileSync(note, 'utf8'), { timeout: 15_000, intervals: [500] }).toContain('教师补充的第二行')
    await page.screenshot({ path: join(evidence, 'A3-root-md-saved.png') })

    // 调整布局：内容区停靠到底部并持久化到 localStorage（V3.1：停靠按钮收进顶栏「布局」弹出层）
    expect(await dockOf(page)).toBe('right')
    await page.locator('.lesson-layout-menu > summary').click()
    await page.getByRole('button', { name: '下', exact: true }).click()
    await page.locator('.lesson-popover-backdrop').click()
    expect(await dockOf(page)).toBe('bottom')
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('guoling-workbench-layout-v1') ?? '{}') as { contentDock?: string })
    expect(prefs.contentDock).toBe('bottom')
    await page.screenshot({ path: join(evidence, 'A4-dock-bottom.png') })

    // 不建课例：直接新建工作空间会话，稍后在重开后继续
    await page.getByRole('button', { name: '新建工作空间会话' }).first().click()
    await expect(page.locator('.lesson-workspace-directory')).toContainText('工作空间会话')
    // 会话必须真实创建（回归：owner 路径未归一化时创建静默失败、错误横幅出现）
    await expect(page.locator('.lesson-workspace-directory').getByRole('button', { name: /新对话|会话/ }).first()).toBeVisible()
    await expect(page.locator('.lesson-workspace-error')).toHaveCount(0)
    await page.screenshot({ path: join(evidence, 'A5-directory-conversation.png') })

    // 重开：同一 profile 重启应用，自动回到上次的工作空间（左上角切换器直达）
    await app.close(); app = undefined
    app = await launch(profile)
    const reopened = await app.firstWindow()
    await expect(reopened.locator('.lesson-workspace-toolbar')).toContainText('workspace')

    // 布局偏好跨重开保持
    expect(await dockOf(reopened)).toBe('bottom')
    // 工作空间会话仍在，可继续（分组标题常驻，空会话也过，故再断言行数与选中行）
    await expect(reopened.locator('.lesson-workspace-directory')).toContainText('工作空间会话')
    await expect(reopened.locator('.lesson-workspace-scope .lesson-session-row')).toHaveCount(1)
    await expect(reopened.locator('.lesson-workspace-scope .lesson-session-row').first()).toHaveAttribute('aria-pressed', 'true')
    // 根目录 MD 重开后内容正确（真实文件）
    await reopened.getByRole('button', { name: '刷新工作空间根目录' }).click()
    await reopened.locator('.lesson-directory-tree').getByRole('button', { name: '备课笔记.md', exact: true }).click()
    await expect(reopened.locator('.lesson-file-tab:not([hidden]) .ProseMirror')).toContainText('教师补充的第二行')
    await reopened.screenshot({ path: join(evidence, 'A6-relaunch-continuity.png') })
    expect(readFileSync(note, 'utf8')).toContain('教师补充的第二行')
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
