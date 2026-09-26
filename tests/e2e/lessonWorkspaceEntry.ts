import { expect, type Page } from '@playwright/test'

/**
 * Cold-start entry shared by specs that require the full course editor.
 *
 * The current 2.0 shell starts at an empty workbench. Create a course through its "没有打开的文件" action,
 * then enter the full editor through the course light toolbar. Keep the older landing-page path for legacy callers.
 * The workspace-to-conversation route is a different flow and is not handled here.
 */

export type StartupSurface = 'editor' | 'landing' | 'recovery' | 'workspace' | 'empty-workbench'

/** 冷启动面探测超时集中在这里。禁止各 spec 复制 timeout 参数（Windows 负载抖动，见 R19_SIGNOFF_PUSH_BRIEF §9 坑 5）。 */
const STARTUP_SURFACE_TIMEOUT_MS = 30_000

async function readStartupSurface(page: Page): Promise<StartupSurface | 'unknown'> {
  const editor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
  const landing = page.getByRole('button', { name: '打开工作空间', exact: true }).first()
  const recovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
  const emptyWorkbench = page.getByRole('region', { name: '没有打开的文件', exact: true })
  const restoredWorkspace = page.locator('.lesson-workspace-toolbar')
  if (await recovery.isVisible()) return 'recovery'
  if (await editor.isVisible()) return 'editor'
  if (await landing.isVisible()) return 'landing'
  if (await emptyWorkbench.getByRole('button', { name: '新建 H5 演示', exact: true }).isVisible()) return 'empty-workbench'
  if (!await restoredWorkspace.isVisible()) return 'unknown'
  // The shared workspace header can also be visible while the shell is still mounting.
  // Recheck the older landing control before treating it as an already-restored workspace.
  if (await landing.isVisible()) return 'landing'
  return 'workspace'
}

/**
 * Read-only startup probe. It recognizes the legacy landing, current empty workbench, editor, recovery prompt,
 * and restored workspace; it does not activate or replace a document.
 */
export async function observeStartupSurface(page: Page): Promise<StartupSurface> {
  const deadline = Date.now() + STARTUP_SURFACE_TIMEOUT_MS
  for (;;) {
    const surface = await readStartupSurface(page)
    if (surface !== 'unknown') return surface
    if (Date.now() >= deadline) break
    await page.waitForTimeout(250)
  }
  throw new Error(
    '冷启动面在 ' + STARTUP_SURFACE_TIMEOUT_MS + 'ms 内没有出现；已知的编辑器、着陆页、空工作台、恢复稿和工作空间面都没有渲染：'
    + '「打开工程（Ctrl+O）」/「打开工作空间」/「新建 H5 演示」/「发现未完成的本地恢复副本」/ .lesson-workspace-toolbar。'
    + '若本用例故意使用已恢复的工作空间 profile，请显式声明期望的启动面；不要放宽本探测。',
  )
}

/** Enter the editor from a cold start, creating a blank course only on the empty workbench. */
export async function enterIndependentEditor(page: Page): Promise<void> {
  const surface = await observeStartupSurface(page)
  if (surface === 'landing') await page.keyboard.press('Control+N')
  if (surface === 'empty-workbench') {
    await page.getByRole('region', { name: '没有打开的文件', exact: true })
      .getByRole('button', { name: '新建 H5 演示', exact: true }).click()
  }
  await expect(page.getByRole('main', { name: '画布' })).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
  if (surface === 'empty-workbench') {
    await page.locator('.course-light-tools').getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })).toBeVisible()
}
