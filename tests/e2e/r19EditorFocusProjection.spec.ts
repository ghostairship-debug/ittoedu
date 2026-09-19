import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { destroyEditor, launchEditor, revealWorkbench, runDirectory } from './r19ChatSpecSupport'

/**
 * V10 编辑器焦点：门控用例（r19LessonDelivery）之外的 CSS 投影证据。
 * 「在编辑器中打开」只做 CSS 投影：导航隐藏、工作台吃满宽度、同一个聊天实例被绝对定位到右侧，
 * 不卸载对话。窗口内容区固定 1200x900，几何断言只在同窗口内前后比较，不做绝对像素断言。
 */
test('r19 V10 编辑器焦点投影: 几何、导航投影与同一聊天实例', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v10-focus-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const note = join(workspace, '备课笔记.md')
  writeFileSync(note, '# 备课笔记\n\n原始一行。\n')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText(basename(workspace))
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.unmaximize(); window.setContentSize(1200, 900)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1320)
    await revealWorkbench(page)
    await page.getByRole('button', { name: '刷新工作空间根目录' }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '备课笔记.md', exact: true }).click()
    const editor = page.getByRole('region', { name: '教学文档 备课笔记.md' })
    await expect(editor).toBeVisible()

    // 进焦点前取样：属性缺席、导航 flex、工作台默认 46% 宽，并记住聊天实例。
    const shell = page.locator('.lesson-workspace-shell')
    const navigation = page.locator('.lesson-workspace-navigation')
    const workbench = page.locator('.lesson-workspace-workbench')
    await expect(shell).not.toHaveAttribute('data-editor-focus', 'true')
    const navDisplayBefore = await navigation.evaluate(element => getComputedStyle(element).display)
    expect(navDisplayBefore).toBe('flex')
    const widthBefore = (await workbench.boundingBox())!.width
    await page.evaluate(() => { Reflect.set(window, '__chatProbe', document.querySelector('.lesson-workspace-chat')); return true })

    await page.getByRole('button', { name: '在编辑器中打开' }).click()
    await expect(shell).toHaveAttribute('data-editor-focus', 'true')
    await expect.poll(() => navigation.evaluate(element => getComputedStyle(element).display)).toBe('none')
    const navDisplayInside = await navigation.evaluate(element => getComputedStyle(element).display)
    const widthInside = (await workbench.boundingBox())!.width
    expect(widthInside).toBeGreaterThan(widthBefore + 100)
    const projected = await page.evaluate(() => {
      const stored = Reflect.get(window, '__chatProbe')
      const current = document.querySelector('.lesson-workspace-chat')
      return { stored: Boolean(stored), same: Boolean(stored) && stored === current, position: current ? getComputedStyle(current).position : null }
    })
    // 先断言探针非空，避免 null === null 的局部假绿。
    expect(projected.stored).toBe(true)
    expect(projected.same).toBe(true)
    expect(projected.position).toBe('absolute')

    // 焦点内的第二编辑位置真的可用：源文追加一行，切回后必须真落盘。
    await editor.getByRole('button', { name: '源文', exact: true }).click()
    const source = editor.getByRole('textbox', { name: '正文源文编辑' })
    await source.fill('# 备课笔记\n\n原始一行。\n\n编辑器内补记。\n')

    await page.getByRole('button', { name: '返回工作台' }).click()
    await expect(shell).not.toHaveAttribute('data-editor-focus', 'true')
    await expect.poll(() => navigation.evaluate(element => getComputedStyle(element).display)).toBe('flex')
    const navDisplayAfter = await navigation.evaluate(element => getComputedStyle(element).display)
    const widthAfter = (await workbench.boundingBox())!.width
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => {
      const stored = Reflect.get(window, '__chatProbe')
      return Boolean(stored) && stored === document.querySelector('.lesson-workspace-chat')
    })).toBe(true)
    await expect.poll(() => readFileSync(note, 'utf8'), { timeout: 15_000 }).toContain('编辑器内补记')
    console.log('V10 editor focus', JSON.stringify({ widthBefore, widthInside, widthAfter, navDisplayBefore, navDisplayInside, navDisplayAfter, chatPosition: projected.position, sameChatInstance: projected.same }))
  } finally {
    await destroyEditor(app, directory)
  }
})
