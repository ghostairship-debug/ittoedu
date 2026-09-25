import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')

test('M02 keeps the selected directory for tab and window close saves after another workspace is authorized', async () => {
  test.skip(process.platform !== 'win32', 'The native close and save dialogs are verified in Windows Electron.')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m02/close-save-directory')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspaceA = join(directory, 'A'), selected = join(workspaceA, 'sub'), workspaceB = join(directory, 'B')
  mkdirSync(selected, { recursive: true }); mkdirSync(workspaceB)
  const tabPath = join(selected, '关闭标签首存.md')
  const coursePath = join(selected, '关闭课件首存.h5lesson')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const evidence: Record<string, unknown> = { workspaceA, workspaceB, selected, tabPath, coursePath }
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    await app.evaluate(({ BrowserWindow, dialog }, folder) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, workspaceA)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.workspace-files-tree').getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: 'sub', exact: true }).click()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspaceB)
    const authorizedB = await page.evaluate(() => window.desktopAPI.lesson!({ operation: 'choose-workspace' }))
    expect(authorizedB.directory).toBe(workspaceB)
    await expect(page.locator('.lesson-workspace-root')).toHaveText(workspaceA)

    await app.evaluate(({ dialog }, paths) => {
      const state = globalThis as typeof globalThis & { m02CloseSaveDialogs?: { defaultPath?: string; extension?: string }[] }
      state.m02CloseSaveDialogs = []
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
      dialog.showSaveDialog = (async (...args: any[]) => {
        const options = args.at(-1) as { defaultPath?: string; filters?: { extensions: string[] }[] }
        state.m02CloseSaveDialogs!.push({ defaultPath: options.defaultPath, extension: options.filters?.[0]?.extensions?.[0] })
        return state.m02CloseSaveDialogs!.length === 1
          ? { canceled: false, filePath: paths.tabPath }
          : state.m02CloseSaveDialogs!.length === 2
            ? { canceled: false, filePath: paths.coursePath }
            : { canceled: true }
      }) as typeof dialog.showSaveDialog
    }, { tabPath, coursePath })

    await page.getByRole('button', { name: '新建 Markdown', exact: true }).click()
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await editor.click()
    await page.keyboard.type('关闭标签后保存到子目录')
    await page.getByRole('button', { name: '关闭 未命名文档.md', exact: true }).click()
    await expect.poll(() => existsSync(tabPath)).toBe(true)
    expect(readFileSync(tabPath, 'utf8')).toContain('关闭标签后保存到子目录')
    const firstDialogs = await app.evaluate(() => (globalThis as any).m02CloseSaveDialogs as { defaultPath?: string; extension?: string }[])
    expect(firstDialogs).toHaveLength(1)
    expect(firstDialogs[0]?.extension).toBe('md')
    expect(dirname(firstDialogs[0]?.defaultPath ?? '').toLowerCase()).toBe(selected.toLowerCase())
    await expect(page.getByRole('region', { name: '没有打开的文件' })).toBeVisible()

    await page.getByRole('button', { name: '新建课件', exact: true }).click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    const deep = page.getByRole('button', { name: '深度编辑', exact: true })
    if (await deep.isVisible()) await deep.click()
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    await page.getByTestId('add-text').click()
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.getByRole('button', { name: '关闭 未命名课件.h5lesson', exact: true }).click()
    await expect.poll(() => existsSync(coursePath)).toBe(true)
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(coursePath))).project.surfaces[0]?.type).toBe('slide')
    const courseDialogs = await app.evaluate(() => (globalThis as any).m02CloseSaveDialogs as { defaultPath?: string; extension?: string }[])
    expect(courseDialogs).toHaveLength(2)
    expect(courseDialogs[1]?.extension).toBe('h5lesson')
    expect(dirname(courseDialogs[1]?.defaultPath ?? '').toLowerCase()).toBe(selected.toLowerCase())
    await expect(page.getByRole('region', { name: '没有打开的文件' })).toBeVisible()

    await page.getByRole('button', { name: '新建 Markdown', exact: true }).click()
    const closingEditor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await closingEditor.click()
    await page.keyboard.type('窗口关闭前仍保留这份草稿')
    const untitled = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .find(snapshot => snapshot.binding.kind === 'untitled' && snapshot.model.kind === 'markdown'))
    if (!untitled) throw new Error('Window-close draft is not an untitled Markdown session')
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 0) })
    await expect.poll(async () => (await app.evaluate(() => (globalThis as any).m02CloseSaveDialogs as unknown[])).length).toBe(3)
    const dialogs = await app.evaluate(() => (globalThis as any).m02CloseSaveDialogs as { defaultPath?: string; extension?: string }[])
    expect(dialogs[2]?.extension).toBe('md')
    expect(dirname(dialogs[2]?.defaultPath ?? '').toLowerCase()).toBe(selected.toLowerCase())
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), untitled.documentId)).dirty).toBe(true)
    evidence.dialogs = dialogs
    evidence.windowCloseCancelledDraftRetained = untitled.documentId
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
