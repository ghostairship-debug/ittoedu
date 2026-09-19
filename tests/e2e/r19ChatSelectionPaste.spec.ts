import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { installChatFailureFixture } from './chatFailureFixture'
import { archiveHasMarker, destroyEditor, dismissOverlays, firstSave, launchEditor, openWorkspaceAndSession, runDirectory, typeAndSubmit } from './r19ChatSpecSupport'

/** Mirrors the code reply built by chatFailureFixture.ts (mode === 'code'). */
const CODE_REPLY = [
  '## 平均分讲解要点',
  '- 先讲平均分的含义。',
  '- 再讲分子分母。',
  '',
  '```',
  'const average = sum / count',
  '```',
  '',
  '最后核对结果。',
].join('\n')
const CODE_LINE = 'const average = sum / count'

/**
 * V05 选择：聊天区的真实拖选本身。哨兵先写进系统剪贴板，并断言拖选得到的是渲染文本
 * （不含 '## ' 源文记号）且 range 两端都落在该条消息内；代码块用全等断言。
 * 复制回读走产品自己的「复制原文」按钮 —— 不是 Ctrl+C：App 级 useEditorKeyboardRouter
 * 会吞掉聊天区的 Ctrl+C（.chat-message 是 div，不命中文本输入豁免），原生复制不会发生。
 * navigator.clipboard 从不 mock，读回一律经主进程 clipboard 模块。
 */
test('r19 V05 选择: 聊天区真实拖选与代码块复制回读', async () => {
  test.setTimeout(5 * 60_000)
  const directory = runDirectory('r19-v05-selection-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'selection.h5lesson')
  let app: ElectronApplication | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    app = await launchEditor(profile)
    const shell = app
    fixture = await installChatFailureFixture(app, directory)
    const page = await openWorkspaceAndSession(app, workspace)
    await firstSave(app, page, firstPath)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    fixture.mode('code')
    const settings = chat.locator('details.chat-task-settings')
    if (!(await settings.evaluate(element => (element as HTMLDetailsElement).open))) await settings.locator(':scope > summary').click()
    await chat.getByLabel('意图', { exact: true }).selectOption('discuss')
    await typeAndSubmit(chat, '把平均分讲解整理成要点，并给一段代码示例。')
    // 回合结束三信号：标题可见、会话选择可编辑、转录恰好两条消息。
    await expect(chat.getByRole('heading', { name: '平均分讲解要点' })).toBeVisible({ timeout: 60_000 })
    await expect(chat.getByLabel('会话')).toBeEnabled({ timeout: 30_000 })
    await expect(chat.locator('.chat-transcript [data-message-id]')).toHaveCount(2)

    const reply = chat.locator('.chat-reply').filter({ hasText: '先讲平均分的含义。' })
    await expect(reply).toHaveCount(1)
    const message = reply.locator('.chat-message')

    // ① 先写哨兵：旧的剪贴板内容不能冒充复制结果。
    const sentinel = `SENTINEL-SELECTION-${Date.now()}`
    await shell.evaluate(({ clipboard }, text) => clipboard.writeText(text), sentinel)
    expect(await shell.evaluate(({ clipboard }) => clipboard.readText())).toBe(sentinel)

    // ② 正文拖选：渲染文本而非源文，range 两端都在该条消息内。
    await reply.scrollIntoViewIfNeeded()
    const headingBox = (await message.getByRole('heading', { name: '平均分讲解要点' }).boundingBox())!
    const itemBox = (await message.locator('li').first().boundingBox())!
    await page.mouse.move(headingBox.x + 1, headingBox.y + headingBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(itemBox.x + itemBox.width - 2, itemBox.y + itemBox.height / 2, { steps: 12 })
    await page.mouse.up()
    const bodySelection = await message.evaluate(element => {
      const selection = element.ownerDocument.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const inside = (node: Node | null) => Boolean(node && (node === element || element.contains(node)))
      return { text: selection?.toString() ?? '', collapsed: range?.collapsed ?? true, inside: inside(range?.startContainer ?? null) && inside(range?.endContainer ?? null) }
    })
    expect(bodySelection.collapsed).toBe(false)
    expect(bodySelection.inside).toBe(true)
    expect(bodySelection.text).toContain('先讲平均分的含义')
    expect(bodySelection.text.includes('## '), '选区必须是渲染文本而不是源文记号').toBe(false)

    // ③ 代码块拖选：整段代码原文，全等。
    await expect(reply.locator('pre code')).toHaveText(CODE_LINE)
    const preBox = (await reply.locator('pre').first().boundingBox())!
    await page.mouse.move(preBox.x + 1, preBox.y + preBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(preBox.x + preBox.width - 2, preBox.y + preBox.height / 2, { steps: 12 })
    await page.mouse.up()
    const codeSelection = await page.evaluate(() => document.getSelection()?.toString() ?? '')
    expect(codeSelection).toBe(CODE_LINE)

    // ④ 产品按钮路径 → 真实系统剪贴板读回（此前已被 r19ChatCopyPaste 实证可用）。
    await message.getByRole('button', { name: '复制原文' }).click()
    await expect(message.getByRole('status')).toHaveText('已复制')
    await expect.poll(() => shell.evaluate(({ clipboard }) => clipboard.readText())).not.toBe(sentinel)
    const readback = await shell.evaluate(({ clipboard }) => clipboard.readText())
    expect(readback.replace(/\r\n/g, '\n'), '剪贴板回读必须等于该条消息正文（含围栏与代码行）').toBe(CODE_REPLY)

    // ⑤ 讨论回合不得写课件。
    expect(archiveHasMarker(firstPath, CODE_LINE), '讨论模式不得写入课件').toBe(false)
    console.log('V05 selection', JSON.stringify({ bodySelection: bodySelection.text, codeSelection, readback: readback.length, readbackMatchesReply: readback.replace(/\r\n/g, '\n') === CODE_REPLY, archiveWroteCode: archiveHasMarker(firstPath, CODE_LINE) }))
  } finally {
    if (fixture) await fixture.restore()
    await destroyEditor(app, directory)
  }
})

/**
 * V05 粘贴：真实 Ctrl+V。先填占位内容、全选、从主进程写哨兵，再按 Ctrl+V，
 * 断言输入框等于哨兵且旧内容消失 —— 快捷键路径真的替换了内容，而不是被忽略。
 */
test('r19 V05 粘贴: 真实 Ctrl+V 把系统剪贴板内容替换进输入框', async () => {
  test.setTimeout(5 * 60_000)
  const directory = runDirectory('r19-v05-paste-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'paste.h5lesson')
  let app: ElectronApplication | undefined
  let fixture: Awaited<ReturnType<typeof installChatFailureFixture>> | undefined
  try {
    app = await launchEditor(profile)
    const shell = app
    fixture = await installChatFailureFixture(app, directory)
    const page = await openWorkspaceAndSession(app, workspace)
    await firstSave(app, page, firstPath)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    const composer = chat.getByRole('textbox', { name: '发送给创作助手' })
    await composer.click()
    await expect(composer).toBeFocused()
    await composer.fill(`占位内容-${Date.now()}`)
    await composer.press('Control+a')

    const sentinel = `SENTINEL-PASTE-${Date.now()}`
    await shell.evaluate(({ clipboard }, text) => clipboard.writeText(text), sentinel)
    expect(await shell.evaluate(({ clipboard }) => clipboard.readText())).toBe(sentinel)

    await composer.press('Control+v')
    await expect(composer).toHaveValue(sentinel)
    const pasted = await composer.inputValue()
    expect(pasted, '旧内容必须被真实粘贴替换').not.toContain('占位内容')
    console.log('V05 paste', JSON.stringify({ pasted }))
  } finally {
    if (fixture) await fixture.restore()
    await destroyEditor(app, directory)
  }
})
