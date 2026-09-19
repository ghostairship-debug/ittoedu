import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { destroyEditor, launchEditor, revealWorkbench, runDirectory } from './r19ChatSpecSupport'

const NOTE = '备课笔记.md'
const SOURCE = '正文源文编辑'

async function chooseDirectory(app: ElectronApplication, directory: string) {
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, directory)
}
async function openWorkspace(app: ElectronApplication, page: Page, workspace: string) {
  await chooseDirectory(app, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await expect(page.locator('.lesson-workspace-toolbar')).toContainText(basename(workspace))
}
async function openNote(page: Page) {
  await page.getByRole('button', { name: '刷新工作空间根目录' }).click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name: NOTE, exact: true }).click()
  const editor = page.getByRole('region', { name: `教学文档 ${NOTE}` })
  await expect(editor).toBeVisible()
  return editor
}

/**
 * V02 冲突：把守卫与冲突分支第一次纳入可执行证据。
 * 源文原子编辑后同 tick 由测试进程外部写盘（远早于 800ms 静默保存），同一范围双边改动
 * 必然由保存时的版本校验判成单条冲突。切根被拒后当前稿必须仍在；解决冲突后必须真落盘。
 */
test('r19 V02 冲突: 保存被冲突阻断，切根被拒，当前稿不丢且可恢复', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v02-conflict-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const other = join(directory, 'other'); mkdirSync(other)
  const profile = join(directory, 'profile')
  const note = join(workspace, NOTE)
  writeFileSync(note, '# 备课笔记\n\n原始一行。\n')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    const page = await app.firstWindow()
    await openWorkspace(app, page, workspace)
    await revealWorkbench(page)
    const editor = await openNote(page)

    await editor.getByRole('button', { name: '源文', exact: true }).click()
    const source = editor.getByRole('textbox', { name: SOURCE })
    await source.fill('# 备课笔记\n\n教师修订稿。\n')
    writeFileSync(note, '# 备课笔记\n\n外部修订稿。\n')

    const conflict = editor.locator('aside[role="alert"]')
    await expect(conflict).toContainText('磁盘稿与当前稿在同一处有修改')
    await expect(editor.getByRole('status').first()).toHaveText('存在文件冲突')
    // 源文是 CodeMirror 的 contenteditable，只能按既有先例（r18AiObservation / r19DocumentCoauthoring）读文本。
    await expect(source).toContainText('教师修订稿。')
    await expect(page.locator('.lesson-workbench-tab [aria-label="未保存"]')).toHaveCount(1)

    // 切根被守卫拒绝：错误回执是 controller 的逐字文案，工作空间与当前稿都不动。
    await chooseDirectory(app, other)
    await page.locator('.lesson-workspace-switcher > summary').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…' }).click()
    await expect(page.locator('.lesson-workspace-error')).toContainText('请先在文档标签处理未保存稿或文件冲突，再切换课例。')
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    await expect(source).toContainText('教师修订稿。')

    // 恢复：此处保留当前稿 → 真落盘、冲突面板消失、状态回已保存。
    await conflict.getByRole('button', { name: '此处保留当前稿' }).click()
    await expect.poll(() => readFileSync(note, 'utf8'), { timeout: 15_000 }).toContain('教师修订稿')
    expect(readFileSync(note, 'utf8')).not.toContain('外部修订稿')
    await expect(editor.getByRole('status').first()).toHaveText('已保存')
    await expect(editor.locator('aside[role="alert"]')).toHaveCount(0)
    console.log('V02 conflict', JSON.stringify({ conflictBlockedSave: true, disk: readFileSync(note, 'utf8') }))
  } finally {
    await destroyEditor(app, directory)
  }
})

/** V02 切根：openWorkspace 先 stopAndFlush 真写盘再 disposeDocuments，切走切回都不丢稿。 */
test('r19 V02 切根: 换工作空间前先落盘，切回重开仍见', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v02-reroot-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const other = join(directory, 'other'); mkdirSync(other)
  const profile = join(directory, 'profile')
  const note = join(workspace, NOTE)
  writeFileSync(note, '# 备课笔记\n\n原始一行。\n')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    const page = await app.firstWindow()
    await openWorkspace(app, page, workspace)
    await revealWorkbench(page)
    const editor = await openNote(page)

    await editor.getByRole('button', { name: '源文', exact: true }).click()
    await editor.getByRole('textbox', { name: SOURCE }).fill('# 备课笔记\n\n原始一行。\n教师补充的第二行。\n')

    await chooseDirectory(app, other)
    await page.locator('.lesson-workspace-switcher > summary').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…' }).click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(other))
    await expect.poll(() => readFileSync(note, 'utf8'), { timeout: 15_000 }).toContain('教师补充的第二行')

    await chooseDirectory(app, workspace)
    await page.locator('.lesson-workspace-switcher > summary').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…' }).click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    const reopened = await openNote(page)
    await reopened.getByRole('button', { name: '源文', exact: true }).click()
    await expect(reopened.getByRole('textbox', { name: SOURCE })).toContainText('教师补充的第二行。')
    expect(readFileSync(note, 'utf8')).toContain('教师补充的第二行')
    console.log('V02 reroot', JSON.stringify({ disk: readFileSync(note, 'utf8') }))
  } finally {
    await destroyEditor(app, directory)
  }
})
