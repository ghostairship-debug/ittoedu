import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Fixture, m20OpenFile, m20Row, m20Snapshot, m20Tree } from './helpers/g20M20Harness'

test('M20-T01 both Explorer creation entrances preserve order, stem selection, extension and active file', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Explorer acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const fixture = m20Fixture(), evidence: Record<string, unknown> = { case: 'M20-T01', created: [] }
  writeFileSync(join(fixture.workspace, 'seed.txt'), '')
  const { app, page } = await launchM20(fixture)
  try {
    await chooseM20Workspace(app, page, fixture.workspace)
    const files = page.locator('.workspace-files-tree')
    const expected = ['新建 Markdown 文档', '新建 H5 演示', '从 PPT 新建 H5 演示', '新建文本文档', '新建文件夹']
    await files.getByLabel('新建文件或文件夹').click()
    const toolbar = page.getByRole('menu', { name: '新建', exact: true })
    await expect(toolbar.getByRole('menuitem')).toHaveText(expected)
    await files.getByLabel('新建文件或文件夹').click()
    await m20Row(page, 'seed.txt').click({ button: 'right' })
    const context = page.getByRole('menu', { name: '文件菜单' })
    await expect(context.getByRole('menuitem').first()).toHaveText(expected[0]!)
    expect((await context.getByRole('menuitem').allTextContents()).slice(0, expected.length)).toEqual(expected)
    await page.keyboard.press('Escape')

    const cases = [
      { entry: '新建 Markdown 文档', stem: '课前笔记', name: '课前笔记.md', kind: 'markdown' as const },
      { entry: '新建 H5 演示', stem: '课堂演示', name: '课堂演示.h5lesson', kind: 'course' as const },
      { entry: '新建文本文档', stem: '阅读材料', name: '阅读材料.txt', kind: 'text' as const },
      { entry: '新建文件夹', stem: '资料夹', name: '资料夹' },
      { entry: '新建 Markdown 文档', stem: '右键笔记', name: '右键笔记.md', kind: 'markdown' as const },
      { entry: '新建 H5 演示', stem: '右键演示', name: '右键演示.h5lesson', kind: 'course' as const },
      { entry: '新建文本文档', stem: '右键材料', name: '右键材料.txt', kind: 'text' as const },
      { entry: '新建文件夹', stem: '右键资料', name: '右键资料' },
      { entry: '新建文本文档', stem: '记录.log', name: '记录.log' },
    ]
    for (const [index, item] of cases.entries()) {
      const fromMenu = index < 4
      if (fromMenu) {
        await files.getByLabel('新建文件或文件夹').click()
        await toolbar.getByRole('menuitem', { name: item.entry, exact: true }).click()
      } else {
        await m20Row(page, 'seed.txt').click({ button: 'right' })
        await page.getByRole('menu', { name: '文件菜单' }).getByRole('menuitem', { name: item.entry, exact: true }).click()
      }
      const input = files.getByRole('textbox', { name: '文件名称', exact: true })
      const selection = await input.evaluate(node => { const value = node as HTMLInputElement; return { value: value.value, start: value.selectionStart, end: value.selectionEnd } })
      const expectedEnd = selection.value.lastIndexOf('.') > 0 ? selection.value.lastIndexOf('.') : selection.value.length
      expect(selection.start).toBe(0); expect(selection.end).toBe(expectedEnd)
      expect(selection.value).toBe(item.entry === '新建文件夹' ? '新建文件夹' : item.entry + (item.kind === 'markdown' ? '.md' : item.kind === 'course' ? '.h5lesson' : '.txt'))
      await input.fill(item.stem)
      await files.getByRole('dialog', { name: '文件操作' }).getByRole('button', { name: '确认' }).click()
      const path = join(fixture.workspace, item.name)
      await expect.poll(() => existsSync(path)).toBe(true)
      await expect(m20Row(page, item.name)).toBeVisible()
      if (item.kind) await m20OpenFile(page, item.name, item.kind)
      ;(evidence.created as unknown[]).push({ entrance: fromMenu ? 'toolbar' : 'context', name: item.name, defaultName: selection.value, selection })
    }
    expect(readFileSync(join(fixture.workspace, '记录.log')).byteLength).toBe(0)
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})

test('M20-T03 H5 and Markdown Save As buttons, shortcut and binding use the real save pipeline', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Save As dialog acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const fixture = m20Fixture(), evidence: Record<string, unknown> = { case: 'M20-T03' }
  const driver = createCourseV9Driver()
  const source = join(fixture.workspace, '原演示.h5lesson'), first = join(fixture.workspace, '另存演示.h5lesson'), second = join(fixture.workspace, '快捷键演示.h5lesson')
  writeFileSync(source, await driver.serialize({ kind: 'course-v9', project: createBlankCourseProject({ title: '原演示' }), resources: { assets: {}, components: {} } }))
  writeFileSync(join(fixture.workspace, '讲义.md'), '# 讲义\n')
  const original = readFileSync(source)
  const { app, page } = await launchM20(fixture)
  try {
    await chooseM20Workspace(app, page, fixture.workspace)
    await m20OpenFile(page, '讲义.md', 'markdown')
    const markdown = page.getByRole('region', { name: '教学文档 讲义.md', exact: true })
    await expect(markdown.locator(':scope > header > button')).toHaveText(['保存', '另存为'])
    await m20OpenFile(page, '原演示.h5lesson', 'course')
    const course = page.getByLabel('常用工具', { exact: true })
    await expect(course.locator('.course-light-tools__row > button').first()).toHaveText('保存')
    await expect(course.locator('.course-light-tools__row > button').nth(1)).toHaveText('另存为')
    await expect(page.getByRole('button', { name: '在编辑器中打开', exact: true })).toHaveCount(1)
    const before = await m20Snapshot(page, source)
    expect(before?.model.kind).toBe('course-v9')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, first)
    await course.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => existsSync(first)).toBe(true)
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before!.documentId)).binding).toMatchObject({ kind: 'file', path: first })
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /另存演示\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.workspace-document-tabs button[role="tab"][title]').filter({ hasText: '另存演示.h5lesson' })).toHaveAttribute('title', first)
    expect(readFileSync(source)).toEqual(original)
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, second)
    await page.keyboard.press('Control+Shift+S')
    await expect.poll(() => existsSync(second)).toBe(true)
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before!.documentId)).binding).toMatchObject({ kind: 'file', path: second })
    expect(readFileSync(source)).toEqual(original)
    expect(readFileSync(first)).toEqual(original)
    await m20OpenFile(page, '另存演示.h5lesson', 'course')
    const reopened = await m20Snapshot(page, first)
    expect(reopened?.documentId).not.toBe(before?.documentId)
    expect(reopened?.model.kind).toBe('course-v9')
    evidence.paths = { source, first, second }; evidence.identity = { source: before?.documentId, reopened: reopened?.documentId }
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})

test('M20-T02 UI edits literal text without Markdown rendering and preserves BOM plus CRLF on save', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Plain text editor acceptance uses Windows Electron.')
  test.setTimeout(120_000)
  const fixture = m20Fixture(), evidence: Record<string, unknown> = { case: 'M20-T02 UI' }
  const path = join(fixture.workspace, '原样.txt')
  const source = '\uFEFFone\r\n# 标题\r\n- 列表 `code` 😀\r\n', expected = source.replace('one', 'ONE')
  writeFileSync(path, source, 'utf8')
  const { app, page } = await launchM20(fixture)
  try {
    await chooseM20Workspace(app, page, fixture.workspace)
    await m20OpenFile(page, '原样.txt', 'text')
    const editor = page.getByLabel('纯文本编辑', { exact: true })
    await expect(editor).toContainText('# 标题')
    await expect(editor).toContainText('- 列表 `code` 😀')
    await expect(page.getByRole('heading', { name: '标题', exact: true })).toHaveCount(0)
    await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+End')
    await page.keyboard.insertText('ONE')
    const document = await m20Snapshot(page, path)
    expect(document?.model.kind).toBe('text')
    const region = page.getByRole('region', { name: '教学文档 原样.txt', exact: true })
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(path).equals(Buffer.from(expected, 'utf8'))).toBe(true)
    await editor.click()
    await page.keyboard.press('Control+Z')
    await expect(editor).toContainText('one')
    await page.keyboard.press('Control+Y')
    await expect(editor).toContainText('ONE')
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(path).equals(Buffer.from(expected, 'utf8'))).toBe(true)
    evidence.sourceBytes = Buffer.byteLength(source); evidence.savedBytes = readFileSync(path).byteLength
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})

test('M20-T04 conversation homes show type, full location, missing state and Explorer reveal without rebinding', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Conversation location acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const fixture = m20Fixture(), evidence: Record<string, unknown> = { case: 'M20-T04' }
  mkdirSync(join(fixture.workspace, 'Unit'))
  writeFileSync(join(fixture.workspace, 'Unit', 'a.md'), '# A\n')
  writeFileSync(join(fixture.workspace, 'Unit', 'b.md'), '# B\n')
  writeFileSync(join(fixture.workspace, 'Unit', 'c.md'), '# C\n')
  const targetWorkspace = join(fixture.directory, 'other-workspace'); mkdirSync(targetWorkspace)
  const { app, page } = await launchM20(fixture)
  try {
    await chooseM20Workspace(app, page, fixture.workspace)
    const prepared = await page.evaluate(async root => {
      const api = window.desktopAPI.execution!, space = await api.workspace(root), id = space.workspace.workspaceId
      const home = (kind: 'file' | 'folder', path: string) => ({ kind, path })
      const folder = await api.createConversation(id, '文件夹会话', home('folder', 'Unit'))
      const file = await api.createConversation(id, '文件会话', home('file', 'Unit/a.md'))
      const rootConversation = await api.createConversation(id, '工作空间会话')
      const deleted = await api.createConversation(id, '删除文件会话', home('file', 'Unit/b.md'))
      const empty = await api.createConversation(id, '未发送空会话', home('file', 'Unit/a.md'))
      const moved = await api.createConversation(id, '跨空间会话', home('file', 'Unit/c.md'))
      return { id, folder: folder.conversationId, file: file.conversationId, root: rootConversation.conversationId,
        deleted: deleted.conversationId, empty: empty.conversationId, moved: moved.conversationId }
    }, fixture.workspace)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await m20Tree(page).getByRole('button', { name: '展开 Unit', exact: true }).click()
    await m20Row(page, 'b.md').click(); await m20Row(page, 'b.md').press('Delete')
    await expect.poll(() => existsSync(join(fixture.workspace, 'Unit', 'b.md'))).toBe(false)
    await page.reload()
    await expect(page.getByRole('region', { name: '会话管理区', exact: true })).toBeVisible()
    const sessions = page.getByRole('region', { name: '会话管理区', exact: true })
    const current = page.locator('.execution-assistant__title > strong')
    const location = page.locator('.execution-assistant__location')
    const select = async (title: string) => {
      if (title === '工作空间会话') await m20Tree(page).getByRole('button', { name: '工作空间根目录' }).click()
      else await m20Row(page, 'Unit').click()
      await sessions.getByRole('button', { name: title, exact: true }).click()
      await expect(current).toHaveText(title)
    }
    await select('工作空间会话')
    await expect(location).toContainText('workspace')
    await expect(location.locator('svg.lucide-folder')).toHaveCount(1)
    await select('文件夹会话')
    await expect(location).toContainText('workspace › Unit')
    await expect(location.locator('svg.lucide-folder')).toHaveCount(1)
    await expect(location).toHaveAttribute('title', /所属位置只决定默认引用和新建文件的位置，不限制可修改的范围/)
    await location.click()
    await expect(m20Row(page, 'Unit')).toHaveAttribute('aria-pressed', 'true')
    await select('文件会话')
    await expect(location).toContainText('workspace › Unit › a.md')
    await expect(location.locator('svg.lucide-file')).toHaveCount(1)
    await expect(location).toHaveAttribute('title', new RegExp('Unit[/\\]a\\.md'))
    await location.click()
    await expect(m20Row(page, 'a.md')).toHaveAttribute('aria-pressed', 'true')
    await m20Row(page, 'Unit').click()
    await expect(current).toHaveText('文件会话')
    const unchanged = await page.evaluate(async value => window.desktopAPI.execution!.conversation(value.id, value.file), prepared)
    expect(unchanged?.home).toMatchObject({ kind: 'file', path: 'Unit/a.md' })
    await select('删除文件会话')
    await expect(location).toContainText('已删除')
    await expect(page.getByRole('status').filter({ hasText: '所属文件已删除' })).toBeVisible()
    await select('未发送空会话')
    await expect(location).toContainText('发送首条消息后固定')
    await select('跨空间会话')
    const transfer = await page.evaluate(async input => {
      const files = window.desktopAPI.workspaceFiles!, execution = window.desktopAPI.execution!
      await execution.workspace(input.target)
      const source = await files({ type: 'root', directory: input.source }), target = await files({ type: 'root', directory: input.target })
      const directory = (await files({ type: 'list', workspaceId: source.workspaceId, directoryEntryId: source.rootEntryId })).entries
        .find(entry => entry.status === 'accessible' && entry.name === 'Unit')
      if (!directory || directory.status !== 'accessible') throw new Error('source folder missing')
      const file = (await files({ type: 'list', workspaceId: source.workspaceId, directoryEntryId: directory.entryId })).entries
        .find(entry => entry.status === 'accessible' && entry.name === 'c.md')
      if (!file || file.status !== 'accessible') throw new Error('source file missing')
      const result = await files({ type: 'move', operationId: crypto.randomUUID(), workspaceId: source.workspaceId,
        targetWorkspaceId: target.workspaceId, sourceEntryIds: [file.entryId], targetDirectoryId: target.rootEntryId })
      return { result, targetId: target.workspaceId }
    }, { source: fixture.workspace, target: targetWorkspace })
    expect(transfer.result.status).toBe('success')
    await expect.poll(async () => (await page.evaluate(async value => window.desktopAPI.execution!.conversation(value.id, value.moved), prepared))?.home?.workspaceId).toBe(transfer.targetId)
    await expect(location).toContainText('其他工作空间 · c.md')
    await expect(location).not.toContainText('workspace ›')
    await expect(location).toHaveAttribute('title', /^c\.md\n所属位置只决定默认引用和新建文件的位置，不限制可修改的范围$/)
    expect(existsSync(join(targetWorkspace, 'c.md'))).toBe(true)
    evidence.conversationIds = prepared
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})
