import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { destroyEditor, launchEditor, runDirectory } from './r19ChatSpecSupport'

/**
 * V01 未生成课件即可重开：判别性证据。重开后必须回到「记住的那一条」旧工作空间会话，
 * 而不是最近更新的那一条；旧断言只匹配常驻分组标题（空会话也过），这里用主进程真值
 * + DOM 行序 + aria-pressed 三向对齐。零模型：只创建会话，不触发任何 agent。
 */
test('r19 V01 未生成课件即可重开: 记住并恢复指定的旧工作空间会话', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v01-reopen-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const normalized = workspace.replace(/\\/g, '/').toLowerCase()
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    let page = await app.firstWindow()
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))

    const scope = page.locator('.lesson-workspace-scope')
    const rows = scope.locator('.lesson-session-row')
    await scope.getByRole('button', { name: '新建工作空间会话' }).click()
    await expect(rows).toHaveCount(1)
    await page.waitForTimeout(1100)
    await scope.getByRole('button', { name: '新建工作空间会话' }).click()
    await expect(rows).toHaveCount(2)

    const records = await page.evaluate(async workspace => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', owner: { kind: 'workspace', workspaceRoot: workspace } })).conversations!, normalized)
    expect(records).toHaveLength(2)
    expect(new Set(records.map(record => record.createdAt)).size, '两次会话必须有不同 createdAt，否则无法判别').toBe(2)
    // 仓储按 createdAt 升序返回，DOM 行序与之一致：nth(0) 就是先建的 C1。
    expect(records[0]!.createdAt).toBeLessThan(records[1]!.createdAt)
    await rows.nth(0).click()
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true')

    await app.close(); app = undefined
    app = await launchEditor(profile)
    page = await app.firstWindow()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    await expect(page.locator('.lesson-workspace-error')).toHaveCount(0)

    const reopened = page.locator('.lesson-workspace-scope')
    const reopenedRows = reopened.locator('.lesson-session-row')
    await expect(reopenedRows).toHaveCount(2)
    await expect(reopenedRows.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(reopenedRows.nth(1)).not.toHaveAttribute('aria-pressed', 'true')
    const lessons = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons!, normalized)
    expect(lessons, '未生成课件：工作空间里不应出现课例').toHaveLength(0)
    await expect(page.getByRole('tab', { name: '材料' })).toHaveCount(0)
    const pressed = await reopenedRows.evaluateAll(rows => rows.map(row => row.getAttribute('aria-pressed')))
    console.log('V01 reopen', JSON.stringify({ createdAt: records.map(record => record.createdAt), pressedRows: pressed }))
  } finally {
    await destroyEditor(app, directory)
  }
})
