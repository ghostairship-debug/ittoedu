import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { installChatFailureFixture } from './chatFailureFixture'
import { archiveHasMarker, destroyEditor, dismissOverlays, firstSave, launchEditor, openWorkspaceAndSession, runDirectory, typeAndSubmit } from './r19ChatSpecSupport'

/** Mirrors the discussion reply built by chatFailureFixture.ts (mode === 'discussion'). */
const DISCUSSION_REPLY = [
  '## 只讨论，不修改课件',
  '- 平均分是分数的前提。',
  '<script>window.__unsafeChatExecuted=true</script>',
  '![remote](https://invalid.example/probe.png)',
  '[jump](javascript:alert(1))',
].join('\n')

/**
 * V05: the copy action itself. A sentinel is written to the system clipboard first so a
 * surviving old value cannot pass; the click must replace it with the exact message body,
 * read back through the Electron main-process clipboard module. navigator.clipboard is never
 * mocked. The status span is scoped to .chat-message because the panel has a second
 * role="status" (the task notice line).
 */
test('r19 V05 复制原文: 点击后系统剪贴板等于该条消息正文', async () => {
  test.setTimeout(5 * 60_000)
  const directory = runDirectory('r19-v05-copy-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'copy-paste.h5lesson')
  let app: ElectronApplication | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    app = await launchEditor(profile)
    const editor = app
    fixture = await installChatFailureFixture(app, directory)
    const page = await openWorkspaceAndSession(app, workspace)
    await firstSave(app, page, firstPath)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    fixture.mode('discussion')
    const settings = chat.locator('details.chat-task-settings')
    if (!(await settings.evaluate(element => (element as HTMLDetailsElement).open))) await settings.locator(':scope > summary').click()
    await chat.getByLabel('意图', { exact: true }).selectOption('discuss')
    await typeAndSubmit(chat, '讨论如何解释平均分，先不修改课件。')
    await expect(chat.getByRole('heading', { name: '只讨论，不修改课件' })).toBeVisible({ timeout: 60_000 })
    await expect(chat.getByLabel('会话')).toBeEnabled({ timeout: 30_000 })
    await expect(chat.locator('.chat-transcript [data-message-id]')).toHaveCount(2)
    expect(archiveHasMarker(firstPath, '平均分是分数的前提。'), '讨论模式不得写入课件').toBe(false)

    const reply = chat.locator('.chat-reply').filter({ hasText: '平均分是分数的前提。' })
    await expect(reply).toHaveCount(1)
    const message = reply.locator('.chat-message')
    const sentinel = `SENTINEL-NOT-COPIED-${Date.now()}`
    await editor.evaluate(({ clipboard }, text) => clipboard.writeText(text), sentinel)
    expect(await editor.evaluate(({ clipboard }) => clipboard.readText())).toBe(sentinel)
    await message.getByRole('button', { name: '复制原文' }).click()
    await expect(message.getByRole('status')).toHaveText('已复制')
    await expect.poll(() => editor.evaluate(({ clipboard }) => clipboard.readText())).not.toBe(sentinel)
    const readback = await editor.evaluate(({ clipboard }) => clipboard.readText())
    expect(readback.replace(/\r\n/g, '\n'), '剪贴板内容必须等于该条消息正文（原文 markdown/HTML 字样保留）').toBe(DISCUSSION_REPLY)
    console.log('V05 copy readback equals message body', JSON.stringify({ length: readback.length }))
  } finally {
    if (fixture) await fixture.restore()
    await destroyEditor(app, directory)
  }
})
