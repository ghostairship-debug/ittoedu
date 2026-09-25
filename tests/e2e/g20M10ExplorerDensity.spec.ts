import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

function wave(): Uint8Array {
  const bytes = new Uint8Array(44 + 160), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 160, true)
  return bytes
}

test('M10-T06 Explorer keeps a small top bar while right-click actions and Enter work on a media-rich tree', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Explorer behavior requires the Windows Electron carrier.')
  test.setTimeout(120_000)
  const base = join(root, 'output/g20/m10/explorer-density'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  const lessons = join(workspace, 'lessons'), classroom = join(lessons, 'classroom')
  mkdirSync(classroom, { recursive: true })
  writeFileSync(join(workspace, 'lesson.md'), '# Ready\n')
  writeFileSync(join(workspace, 'copy-me.txt'), 'copy body')
  writeFileSync(join(workspace, 'move-me.txt'), 'move body')
  writeFileSync(join(classroom, 'outline.md'), '# Nested\n')
  writeFileSync(join(workspace, 'picture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64'))
  copyFileSync(join(root, 'tests/fixtures/r18CommonTasks/materials/motion.webm'), join(workspace, 'movie.webm'))
  writeFileSync(join(workspace, 'voice.wav'), wave())

  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow, dialog }, selected) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1500, 900)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()

    const explorer = page.getByRole('region', { name: '资源管理器' })
    await expect(explorer.getByText('资源管理器', { exact: true })).toBeVisible()
    const files = explorer.locator('.workspace-files-tree')
    const toolbar = files.getByRole('toolbar', { name: '文件管理' })
    await expect(toolbar.locator(':scope > details')).toHaveCount(1)
    await expect(toolbar.locator(':scope > button')).toHaveCount(1)
    await expect(toolbar.locator(':scope > details > summary')).toHaveText('新建')
    await expect(toolbar.locator(':scope > button')).toHaveText('刷新')
    const tree = files.getByRole('tree', { name: '工作空间文件' })
    for (const name of ['lesson.md', 'copy-me.txt', 'move-me.txt', 'picture.png', 'movie.webm', 'voice.wav', 'lessons'])
      await expect(tree.getByRole('button', { name, exact: true })).toBeVisible()
    await tree.getByRole('button', { name: '展开 lessons' }).click()
    await expect(tree.getByRole('button', { name: 'classroom', exact: true })).toBeVisible()
    await tree.getByRole('button', { name: '展开 classroom' }).click()
    await expect(tree.getByRole('button', { name: 'outline.md', exact: true })).toBeVisible()

    // Refresh is one of the only permanent controls and must retain the expanded tree.
    writeFileSync(join(workspace, 'external.txt'), 'external body')
    await toolbar.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'external.txt', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'outline.md', exact: true })).toBeVisible()

    // Current Explorer layout must route a real HTML drag onto a directory as a file move.
    await tree.getByRole('button', { name: 'external.txt', exact: true })
      .dragTo(tree.getByRole('button', { name: 'classroom', exact: true }))
    await expect.poll(() => existsSync(join(classroom, 'external.txt'))).toBe(true)
    expect(existsSync(join(workspace, 'external.txt'))).toBe(false)
    await expect(tree.getByRole('button', { name: 'external.txt', exact: true })).toBeVisible()

    const context = async (name: string) => {
      await tree.getByRole('button', { name, exact: true }).click({ button: 'right' })
      const menu = files.getByRole('menu', { name: '文件菜单' })
      await expect(menu).toBeVisible()
      return menu
    }
    const menu = await context('classroom')
    for (const name of ['新建文本文件', '重命名', '复制', '剪切', '粘贴', '移到回收站'])
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible()
    const menuScreenshot = join(directory, '01-explorer-context.png')
    await page.screenshot({ path: menuScreenshot })
    await info.attach('explorer-context', { path: menuScreenshot, contentType: 'image/png' })
    await menu.getByRole('button', { name: '新建文本文件', exact: true }).click()
    await files.getByLabel('文件名称').fill('new.txt')
    await files.getByRole('dialog', { name: '文件操作' }).getByRole('button', { name: '确认' }).click()
    await expect.poll(() => existsSync(join(classroom, 'new.txt'))).toBe(true)
    await expect(tree.getByRole('button', { name: 'new.txt', exact: true })).toBeVisible()

    await (await context('copy-me.txt')).getByRole('button', { name: '复制', exact: true }).click()
    await (await context('classroom')).getByRole('button', { name: '粘贴', exact: true }).click()
    await expect.poll(() => existsSync(join(classroom, 'copy-me.txt'))).toBe(true)
    expect(readFileSync(join(classroom, 'copy-me.txt'), 'utf8')).toBe('copy body')
    expect(readFileSync(join(workspace, 'copy-me.txt'), 'utf8')).toBe('copy body')

    await (await context('move-me.txt')).getByRole('button', { name: '剪切', exact: true }).click()
    await (await context('classroom')).getByRole('button', { name: '粘贴', exact: true }).click()
    await expect.poll(() => existsSync(join(classroom, 'move-me.txt'))).toBe(true)
    expect(existsSync(join(workspace, 'move-me.txt'))).toBe(false)
    expect(readFileSync(join(classroom, 'move-me.txt'), 'utf8')).toBe('move body')

    await (await context('new.txt')).getByRole('button', { name: '重命名', exact: true }).click()
    await files.getByLabel('文件名称').fill('renamed.txt')
    await files.getByRole('dialog', { name: '文件操作' }).getByRole('button', { name: '确认' }).click()
    await expect.poll(() => existsSync(join(classroom, 'renamed.txt'))).toBe(true)
    expect(existsSync(join(classroom, 'new.txt'))).toBe(false)
    await (await context('renamed.txt')).getByRole('button', { name: '移到回收站', exact: true }).click()
    await expect.poll(() => existsSync(join(classroom, 'renamed.txt'))).toBe(false)
    await expect(tree.getByRole('button', { name: 'renamed.txt', exact: true })).toHaveCount(0)

    const markdown = tree.getByRole('button', { name: 'lesson.md', exact: true })
    await markdown.click()
    await markdown.press('Enter')
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /lesson\.md/ })).toBeVisible()
    const opened = await page.evaluate(async filename => (await window.desktopAPI!.documents!.list())
      .find(document => document.binding.kind === 'file' && document.binding.path === filename), join(workspace, 'lesson.md'))
    expect(opened).toMatchObject({ model: { kind: 'markdown', source: '# Ready\n' } })

    // A directory cannot be dropped into its own descendant; a valid drop to
    // the workspace root then moves the entire directory and its children.
    await tree.getByRole('button', { name: 'lessons', exact: true })
      .dragTo(tree.getByRole('button', { name: 'classroom', exact: true }))
    await expect(files.getByText('不能把目录移动或复制到自身后代')).toBeVisible()
    expect(existsSync(join(lessons, 'classroom', 'outline.md'))).toBe(true)
    expect(existsSync(join(workspace, 'classroom'))).toBe(false)
    const rejectedScreenshot = join(directory, '02-tree-drop-rejected.png')
    await page.screenshot({ path: rejectedScreenshot })
    await info.attach('tree-drop-rejected', { path: rejectedScreenshot, contentType: 'image/png' })
    await tree.getByRole('button', { name: 'classroom', exact: true })
      .dragTo(tree.getByRole('button', { name: '工作空间根目录' }))
    await expect.poll(() => existsSync(join(workspace, 'classroom', 'outline.md'))).toBe(true)
    expect(existsSync(join(lessons, 'classroom'))).toBe(false)
    expect(readFileSync(join(workspace, 'classroom', 'external.txt'), 'utf8')).toBe('external body')
    await expect(tree.getByRole('button', { name: 'classroom', exact: true })).toHaveCount(1)
    expect(errors).toEqual([])
    const screenshot = join(directory, '03-explorer-actions-and-drag.png')
    await page.screenshot({ path: screenshot })
    await info.attach('explorer-actions', { path: screenshot, contentType: 'image/png' })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ toolbar: ['新建', '刷新'],
      contextActions: ['新建文本文件', '复制', '粘贴', '剪切', '重命名', '移到回收站'],
      keyboardOpen: 'lesson.md', nestedDirectory: 'lessons/classroom',
      treeDrag: { fileIntoDirectory: true, descendantDirectoryRejected: true, directoryToRoot: true },
      mediaPresent: ['picture.png', 'movie.webm', 'voice.wav'], pageErrors: errors }, null, 2) + '\n')
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
