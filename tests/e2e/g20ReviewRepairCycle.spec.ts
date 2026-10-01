import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, m23Editor, m23Shot, openM23Html, writeM23Evidence } from './helpers/g20M23Harness'

test('review repair: hidden HTML and unsent AI card drafts survive normal window close and restart', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = m23Fixture('review-repair-cycle')
  const facts: Record<string, unknown> = { status: 'running' }
  let current: Awaited<ReturnType<typeof launchM23>> | undefined
  let failure: unknown
  const changed = '退出后应恢复的标题'
  const unsent = '这是尚未发送的 AI 修改要求'
  try {
    current = await launchM23(fixture)
    let { app, page } = current
    await chooseM23Workspace(app, page, fixture.workspace)
    const region = await openM23Html(page, 'light-edit.html')
    const preview = region.frameLocator('iframe[title="HTML 预览"]')
    await region.getByRole('button', { name: '编辑预览', exact: true }).click()
    await preview.locator('#lesson-title').dblclick()
    const overlay = page.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
    await overlay.getByLabel('HTML 文字', { exact: true }).fill(changed)
    await expect(region.getByRole('status')).toHaveText('未保存')
    await openM23Html(page, 'sibling.html')
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^light-edit\.html/ }).click()
    await preview.locator('#lesson-title').dblclick()
    await expect(overlay.getByLabel('HTML 文字', { exact: true })).toHaveValue(changed)
    await region.getByRole('toolbar', { name: 'HTML 视图' }).getByRole('button', { name: '源码', exact: true }).click()
    await region.getByRole('toolbar', { name: 'HTML 视图' }).getByRole('button', { name: '预览', exact: true }).click()
    await preview.locator('#lesson-title').dblclick()
    await expect(overlay.getByLabel('HTML 文字', { exact: true })).toHaveValue(changed)
    await overlay.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const card = page.locator('.element-ai-card')
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill(unsent)
    expect(readFileSync(fixture.files.lightEdit, 'utf8')).toBe(fixture.sources.lightEdit)
    await m23Shot(fixture, page, info, 'unapplied-and-unsent-drafts')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    const closed = page.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await closed
    await closeM23(app)
    current = await launchM23(fixture)
    ;({ app, page } = current)
    await chooseM23Workspace(app, page, fixture.workspace)
    const expected = fixture.sources.lightEdit.replace('>可编辑 HTML 课例</h1>', `>${changed}</h1>`)
    const recovered = await page.evaluate(() => window.desktopAPI.documents!.recoverable())
    expect(recovered.some(snapshot => snapshot.model.kind === 'text' && snapshot.model.source === expected)).toBe(true)
    const conversations = await page.evaluate(root => window.desktopAPI.execution!.workspace(root), fixture.workspace)
    const retained = conversations.conversations.find(item => item.inputDraft === unsent)
    expect(retained?.title).toMatch(/^未发送的 AI 卡草稿/)
    expect(retained?.element).toBeUndefined()
    expect(retained?.runIndex).toEqual({ builtinRunIds: [], externalRunIds: [], externalPortIds: [] })
    await page.getByRole('button', { name: retained!.title, exact: true }).click()
    await expect(page.getByRole('textbox', { name: '给创作助手发消息', exact: true })).toHaveValue(unsent)
    expect(readFileSync(fixture.files.lightEdit, 'utf8')).toBe(fixture.sources.lightEdit)
    const recovery = page.getByRole('complementary', { name: '未保存文档的恢复稿', exact: true })
    await recovery.getByRole('button', { name: '恢复并打开', exact: true }).click()
    const restored = m23Editor(page, 'light-edit.html')
    await expect(restored.frameLocator('iframe[title="HTML 预览"]').locator('#lesson-title')).toHaveText(changed)
    await restored.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(fixture.files.lightEdit, 'utf8')).toBe(expected)
    await page.getByRole('button', { name: '关闭 light-edit.html', exact: true }).click()
    const reopened = await openM23Html(page, 'light-edit.html')
    await expect(reopened.frameLocator('iframe[title="HTML 预览"]').locator('#lesson-title')).toHaveText(changed)
    facts.status = 'passed'
    facts.hiddenDraftRetained = true
    facts.windowRestartRestored = true
    facts.cardDraft = { conversationId: retained!.conversationId, unsent: true, noRun: true }
    facts.savedAndReopened = true
    expect(current.capture.pageErrors).toEqual([])
    await m23Shot(fixture, page, info, 'restored-saved-and-reopened')
  } catch (error) { failure = error; facts.status = 'failed'; throw error }
  finally {
    if (current) {
      const evidence = await writeM23Evidence(fixture, current.page, current.app, current.capture, facts, failure)
      await info.attach('review repair evidence', { path: evidence, contentType: 'application/json' })
      await closeM23(current.app)
    }
  }
})
