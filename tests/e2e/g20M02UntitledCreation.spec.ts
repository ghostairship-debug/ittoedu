import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { finishRound, heldRound, selectionServer, selectVisibleText } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const markdownName = '无目录文档.md'
const initialText = '先观察再解释'
const revisedText = '先预测再观察'
const courseText = '无目录课件已由 AI 修改'

function courseItems(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a V9 course')
  const surface = snapshot.model.project.surfaces.find(item => item.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Expected a Slide surface')
  return surface.scenes[0]!.layerItems
}

async function configureLocalModel(page: Page, endpoint: string) {
  await page.getByRole('button', { name: '切换模型', exact: true }).click()
  await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
  await page.getByLabel('供应商标识', { exact: true }).fill('fixture-untitled')
  await page.getByLabel('账号标识', { exact: true }).fill('local-untitled')
  await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
  await page.getByLabel('API Key', { exact: true }).fill('fixture-only-no-real-account')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
  const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
  await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
  await page.getByLabel('对话与规划连接', { exact: true }).selectOption(settings.connections[0].connection.id)
  await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-selection')
  await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
  await expect(page.getByText('模型角色已保存', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
}

async function readDocument(page: Page, id: string) {
  return page.evaluate(documentId => window.desktopAPI.documents!.read(documentId), id)
}

test('M02-T02 creates and edits untitled Markdown and V9 without choosing a folder, then saves and reopens both', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M02-T02 checks Windows native save suggestions and the Electron workbench.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/m02/untitled-creation')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const saved = join(directory, 'saved'), profile = join(directory, 'profile')
  const selectedSubdirectory = join(saved, 'sub'), otherWorkspace = join(directory, 'other-workspace')
  mkdirSync(saved); mkdirSync(selectedSubdirectory); mkdirSync(otherWorkspace)
  const markdownPath = join(saved, markdownName), coursePath = join(saved, '未命名课件.h5lesson')
  const server = await selectionServer()
  let app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const evidence: Record<string, unknown> = { markdownPath, coursePath, steps: [] }
  const pageErrors: string[] = []
  try {
    let page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
    await expect(page.getByRole('region', { name: '没有打开的文件' })).toBeVisible()
    const managedRoot = await page.evaluate(async () => (await window.desktopAPI.execution!.workspace(null)).workspace.rootPath)
    evidence.managedRoot = managedRoot
    await configureLocalModel(page, server.endpoint)

    // No workspace picker or filesystem create is used before either document is edited.
    await page.getByRole('button', { name: '新建 Markdown', exact: true }).click()
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.type(initialText)
    await expect.poll(() => page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .some(item => item.binding.kind === 'untitled' && item.model.kind === 'markdown' && item.model.source.includes('先观察再解释')))).toBe(true)
    const markdown = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .find(item => item.binding.kind === 'untitled' && item.model.kind === 'markdown' && item.model.source.includes('先观察再解释')))
    if (!markdown) throw new Error('UI did not create an editable untitled Markdown session')
    expect(markdown.binding).toMatchObject({ kind: 'untitled', suggestedName: '未命名文档.md' })
    if (markdown.model.kind !== 'markdown') throw new Error('Expected Markdown')
    const expectedMarkdownSource = markdown.model.source.replace(initialText, revisedText)
    await selectVisibleText(page, editor, initialText)
    const markdownRound = server.arm('m02-untitled-markdown', 'markdown-range', revisedText)
    const editCard = page.getByLabel('当前编辑目标', { exact: true })
    await editCard.getByLabel('AI 指令', { exact: true }).fill('把当前选中文字改成先预测再观察')
    await editCard.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(markdownRound)
    expect(markdownRound.references?.[0].documentId).toBe(markdown.documentId)
    expect(markdownRound.readText).toBe(initialText)
    await finishRound(page, markdownRound)
    await expect.poll(async () => (await readDocument(page, markdown.documentId)).model).toMatchObject({ source: expectedMarkdownSource })
    const editedMarkdown = await readDocument(page, markdown.documentId)
    expect(editedMarkdown).toMatchObject({ binding: { kind: 'untitled' }, dirty: true })
    ;(evidence.steps as unknown[]).push({ phase: 'markdown-edited-before-save', documentId: markdown.documentId,
      revision: editedMarkdown.revision, undoDepth: editedMarkdown.undoDepth, binding: editedMarkdown.binding })

    const beforeCourseIds = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .filter(item => item.model.kind === 'course-v9').map(item => item.documentId))
    await page.getByLabel('新建标签页').click()
    await page.locator('.lesson-new-tab-popover').getByRole('button', { name: '新建课件', exact: true }).click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    const course = await page.evaluate(async prior => (await window.desktopAPI.documents!.list())
      .find(item => item.binding.kind === 'untitled' && item.model.kind === 'course-v9' && !prior.includes(item.documentId)), beforeCourseIds)
    if (!course) throw new Error('UI did not create an untitled V9 course session')
    expect(course.binding).toMatchObject({ kind: 'untitled' })
    expect(courseItems(course)).toHaveLength(0)
    const deep = page.getByRole('button', { name: '深度编辑', exact: true })
    if (await deep.isVisible()) await deep.click()
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    await page.getByTestId('add-text').click()
    await expect.poll(async () => courseItems(await readDocument(page, course.documentId)).length).toBe(1)
    const manuallyEditedCourse = await readDocument(page, course.documentId)
    const item = courseItems(manuallyEditedCourse)[0]!
    const painted = page.locator(`[data-slide-layer-item="${item.layerItemId}"]:visible`).first()
    await expect(painted).toBeVisible()
    const bounds = await painted.boundingBox()
    if (!bounds) throw new Error('Inserted text has no painted hit target')
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await expect(page.getByRole('toolbar', { name: '选中对象快捷工具' })).toBeVisible()
    const courseRound = server.arm('m02-untitled-course', 'course-object', courseText)
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    await page.getByLabel('选中对象的修改要求', { exact: true }).fill('把选中文字改成无目录课件已由 AI 修改')
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expect.poll(() => courseRound.references ? 'request' : 'waiting').toBe('request')
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await heldRound(courseRound)
    expect(courseRound.references?.[0].documentId).toBe(course.documentId)
    expect(JSON.parse(courseRound.readText!)).toMatchObject({ item: { layerItemId: item.layerItemId } })
    // The professional editor may keep its assistant rail closed. Observe the
    // formal tool receipt instead of requiring hidden timeline text to render.
    courseRound.release()
    await expect.poll(() => courseRound.returned).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(courseRound.error).toBeUndefined()
    await expect.poll(async () => courseItems(await readDocument(page, course.documentId))[0]).toMatchObject({ content: { data: { text: courseText } } })
    await expect(painted).toContainText(courseText)
    const editedCourse = await readDocument(page, course.documentId)
    expect(editedCourse).toMatchObject({ binding: { kind: 'untitled' }, dirty: true })
    expect((await readDocument(page, markdown.documentId)).model).toMatchObject({ source: expectedMarkdownSource })
    ;(evidence.steps as unknown[]).push({ phase: 'both-edited-before-save', courseId: course.documentId,
      courseRevision: editedCourse.revision, courseUndoDepth: editedCourse.undoDepth, markdownId: markdown.documentId })
    expect(existsSync(coursePath)).toBe(false)
    expect(existsSync(markdownPath)).toBe(false)

    await app.evaluate(({ dialog }, paths) => {
      const state = globalThis as typeof globalThis & { m02SaveDialogs?: { title?: string; defaultPath?: string; extension?: string }[] }
      state.m02SaveDialogs = []
      dialog.showSaveDialog = (async (...args: any[]) => {
        const options = args.at(-1) as { title?: string; defaultPath?: string; filters?: { extensions: string[] }[] }
        const extension = options.filters?.[0]?.extensions?.[0]
        state.m02SaveDialogs!.push({ title: options.title, defaultPath: options.defaultPath, extension })
        return { canceled: false, filePath: extension === 'md' ? paths.markdownPath : paths.coursePath }
      }) as typeof dialog.showSaveDialog
    }, { markdownPath, coursePath })
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => existsSync(coursePath)).toBe(true)
    await expect.poll(async () => (await readDocument(page, course.documentId)).binding).toMatchObject({ kind: 'file', path: coursePath })
    const afterCourseSaveDialogs = await app.evaluate(() => (globalThis as any).m02SaveDialogs as { title?: string; defaultPath?: string; extension?: string }[])
    const markdownAfterCourseSave = await readDocument(page, markdown.documentId)
    evidence.courseSaveIsolation = { dialogs: afterCourseSaveDialogs, markdownBinding: markdownAfterCourseSave.binding,
      markdownDirty: markdownAfterCourseSave.dirty, markdownFileExists: existsSync(markdownPath) }
    expect(afterCourseSaveDialogs.map(dialog => dialog.extension)).toEqual(['h5lesson'])
    expect(markdownAfterCourseSave).toMatchObject({ binding: { kind: 'untitled' }, dirty: true })
    expect(existsSync(markdownPath)).toBe(false)
    const elementsTab = page.getByRole('tab', { name: '元素', exact: true })
    if (await elementsTab.getAttribute('aria-expanded') !== 'true') await elementsTab.click()
    await page.getByTestId('add-text').click()
    await expect.poll(async () => courseItems(await readDocument(page, course.documentId)).length).toBe(2)
    expect((await readDocument(page, course.documentId)).dirty).toBe(true)
    const diskBeforeMarkdownSave = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    const diskSurfaceBefore = diskBeforeMarkdownSave.project.surfaces[0]
    if (diskSurfaceBefore?.type !== 'slide') throw new Error('Saved course is not Slide')
    expect(diskSurfaceBefore.scenes[0]!.layerItems).toHaveLength(1)
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /未命名文档\.md/ }).click()
    await page.keyboard.press('Control+s')
    await expect.poll(() => existsSync(markdownPath)).toBe(true)
    await expect.poll(async () => (await readDocument(page, markdown.documentId)).binding).toMatchObject({ kind: 'file', path: markdownPath })
    const saveDialogs = await app.evaluate(() => (globalThis as any).m02SaveDialogs as { title?: string; defaultPath?: string; extension?: string }[])
    evidence.saveDialogs = saveDialogs
    const courseAfterMarkdownShortcut = await readDocument(page, course.documentId)
    const diskAfterMarkdownShortcut = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    const diskSurfaceAfterShortcut = diskAfterMarkdownShortcut.project.surfaces[0]
    if (diskSurfaceAfterShortcut?.type !== 'slide') throw new Error('Saved course is not Slide')
    evidence.markdownShortcutIsolation = { courseDirty: courseAfterMarkdownShortcut.dirty,
      inMemoryCourseItems: courseItems(courseAfterMarkdownShortcut).length,
      diskCourseItems: diskSurfaceAfterShortcut.scenes[0]!.layerItems.length,
      dialogs: saveDialogs }
    expect(courseAfterMarkdownShortcut.dirty).toBe(true)
    expect(courseItems(courseAfterMarkdownShortcut)).toHaveLength(2)
    expect(diskSurfaceAfterShortcut.scenes[0]!.layerItems).toHaveLength(1)
    expect(saveDialogs.map(dialog => dialog.extension)).toEqual(['h5lesson', 'md'])
    expect(saveDialogs.map(dialog => basename(dialog.defaultPath ?? ''))).toEqual(['未命名课件.h5lesson', '未命名文档.md'])
    expect(saveDialogs.every(dialog => dirname(dialog.defaultPath ?? '').toLowerCase() === managedRoot.toLowerCase())).toBe(true)
    expect(readFileSync(markdownPath, 'utf8')).toBe(expectedMarkdownSource)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /未命名课件\.h5lesson/ }).click()
    const reopenDeep = page.getByRole('button', { name: '深度编辑', exact: true })
    if (await reopenDeep.isVisible()) await reopenDeep.click()
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(async () => (await readDocument(page, course.documentId)).dirty).toBe(false)
    expect((await app.evaluate(() => (globalThis as any).m02SaveDialogs as unknown[])).length).toBe(2)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(archive.project.surfaces[0]?.type).toBe('slide')
    expect(archive.project.surfaces[0]?.type === 'slide' && archive.project.surfaces[0].scenes[0]!.layerItems[0]).toMatchObject({ content: { data: { text: courseText } } })
    expect(archive.project.surfaces[0]?.type === 'slide' && archive.project.surfaces[0].scenes[0]!.layerItems).toHaveLength(2)
    await page.screenshot({ path: join(directory, 'both-saved.png') })

    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) })
    await app.close()
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'reopen-profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, saved)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.workspace-files-tree').getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: markdownName, exact: true }).dblclick()
    await expect(page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })).toContainText(revisedText)
    await tree.getByRole('button', { name: basename(coursePath), exact: true }).dblclick()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    const reopened = await page.evaluate(async () => window.desktopAPI.documents!.list())
    const reopenedMarkdown = reopened.find(snapshot => snapshot.binding.kind === 'file' && snapshot.binding.path === markdownPath)
    const reopenedCourse = reopened.find(snapshot => snapshot.binding.kind === 'file' && snapshot.binding.path === coursePath)
    expect(reopenedMarkdown).toMatchObject({ model: { kind: 'markdown', source: expectedMarkdownSource }, dirty: false })
    expect(reopenedCourse).toBeDefined()
    expect(courseItems(reopenedCourse!)[0]).toMatchObject({ content: { data: { text: courseText } } })
    expect(reopenedCourse!.dirty).toBe(false)
    expect(pageErrors).toEqual([])
    expect(server.requests).toHaveLength(6)
    evidence.reopened = { markdownId: reopenedMarkdown?.documentId, courseId: reopenedCourse?.documentId,
      markdownSource: reopenedMarkdown?.model.kind === 'markdown' ? reopenedMarkdown.model.source : null,
      courseItem: courseItems(reopenedCourse!)[0] }
    await page.screenshot({ path: join(directory, 'both-reopened.png') })
    await info.attach('M02-T02 saved and reopened', { path: join(directory, 'both-reopened.png'), contentType: 'image/png' })

    // A shifted save must not write the old binding before opening Save As.
    const originalMarkdownBytes = readFileSync(markdownPath)
    const saveAsPath = join(saved, '无目录文档-另存.md')
    await app.evaluate(({ dialog }, nextPath) => {
      const state = globalThis as typeof globalThis & { m02SaveAsDialogs?: { defaultPath?: string; extension?: string }[] }
      state.m02SaveAsDialogs = []
      dialog.showSaveDialog = (async (...args: any[]) => {
        const options = args.at(-1) as { defaultPath?: string; filters?: { extensions: string[] }[] }
        state.m02SaveAsDialogs!.push({ defaultPath: options.defaultPath, extension: options.filters?.[0]?.extensions?.[0] })
        return { canceled: false, filePath: nextPath }
      }) as typeof dialog.showSaveDialog
    }, saveAsPath)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /无目录文档\.md/ }).click()
    const reopenedEditor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await reopenedEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('，另存副本')
    await page.keyboard.press('Control+Shift+s')
    await expect.poll(() => existsSync(saveAsPath)).toBe(true)
    await expect.poll(async () => (await readDocument(page, reopenedMarkdown!.documentId)).binding).toMatchObject({ kind: 'file', path: saveAsPath })
    const saveAsSnapshot = await readDocument(page, reopenedMarkdown!.documentId)
    const saveAsDialogs = await app.evaluate(() => (globalThis as any).m02SaveAsDialogs as { defaultPath?: string; extension?: string }[])
    expect(saveAsDialogs).toHaveLength(1)
    expect(saveAsDialogs[0]?.extension).toBe('md')
    expect(readFileSync(markdownPath)).toEqual(originalMarkdownBytes)
    expect(saveAsSnapshot.documentId).toBe(reopenedMarkdown!.documentId)
    expect(saveAsSnapshot.binding).toMatchObject({ kind: 'file', path: saveAsPath })
    expect(saveAsSnapshot.model.kind).toBe('markdown')
    if (saveAsSnapshot.model.kind !== 'markdown') throw new Error('Save As changed Markdown model kind')
    expect(saveAsSnapshot.model.source).toContain('另存副本')
    expect(readFileSync(saveAsPath, 'utf8')).toBe(saveAsSnapshot.model.source)
    expect(saveAsSnapshot.undoDepth).toBeGreaterThan(reopenedMarkdown!.undoDepth)
    evidence.saveAsShortcut = { dialogs: saveAsDialogs, originalUnchanged: true,
      oldPath: markdownPath, newPath: saveAsPath, documentIdUnchanged: true,
      undoDepthBefore: reopenedMarkdown!.undoDepth, undoDepthAfter: saveAsSnapshot.undoDepth,
      binding: saveAsSnapshot.binding }

    // Select a child folder in A, then authorize B in Main without switching
    // the visible workspace. The Save As hint must still follow A/sub.
    const treeInA = page.locator('.workspace-files-tree').getByRole('tree', { name: '工作空间文件' })
    await treeInA.getByRole('button', { name: 'sub', exact: true }).click()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, otherWorkspace)
    const authorizedB = await page.evaluate(async () => window.desktopAPI.lesson!({ operation: 'choose-workspace' }))
    expect(authorizedB.directory).toBe(otherWorkspace)
    await expect(page.locator('.lesson-workspace-root')).toHaveText(saved)

    const priorMarkdownIds = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
      .filter(item => item.model.kind === 'markdown').map(item => item.documentId))
    await page.getByLabel('新建标签页').click()
    await page.locator('.lesson-new-tab-popover').getByRole('button', { name: '创建文档', exact: true }).click()
    await expect.poll(() => page.evaluate(async prior => (await window.desktopAPI.documents!.list())
      .some(item => item.model.kind === 'markdown' && item.binding.kind === 'untitled' && !prior.includes(item.documentId)), priorMarkdownIds),
      { timeout: 15_000 }).toBe(true)
    const workspaceUntitled = await page.evaluate(async prior => (await window.desktopAPI.documents!.list())
      .find(item => item.model.kind === 'markdown' && item.binding.kind === 'untitled' && !prior.includes(item.documentId)), priorMarkdownIds)
    if (!workspaceUntitled) throw new Error('Selected-workspace create did not open an untitled Markdown session')
    const workspaceSavePath = join(selectedSubdirectory, '所选目录首存.md')
    await app.evaluate(({ dialog }, nextPath) => {
      const state = globalThis as typeof globalThis & { m02WorkspaceSaveDialogs?: { defaultPath?: string; extension?: string }[] }
      state.m02WorkspaceSaveDialogs = []
      dialog.showSaveDialog = (async (...args: any[]) => {
        const options = args.at(-1) as { defaultPath?: string; filters?: { extensions: string[] }[] }
        state.m02WorkspaceSaveDialogs!.push({ defaultPath: options.defaultPath, extension: options.filters?.[0]?.extensions?.[0] })
        return { canceled: false, filePath: nextPath }
      }) as typeof dialog.showSaveDialog
    }, workspaceSavePath)
    const workspaceEditor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await workspaceEditor.click()
    await page.keyboard.type('所选空间的新文档')
    await page.keyboard.press('Control+s')
    await expect.poll(() => existsSync(workspaceSavePath)).toBe(true)
    const workspaceSaveDialogs = await app.evaluate(() => (globalThis as any).m02WorkspaceSaveDialogs as { defaultPath?: string; extension?: string }[])
    expect(workspaceSaveDialogs).toHaveLength(1)
    expect(workspaceSaveDialogs[0]?.extension).toBe('md')
    expect(dirname(workspaceSaveDialogs[0]?.defaultPath ?? '').toLowerCase()).toBe(selectedSubdirectory.toLowerCase())
    const workspaceSaved = await readDocument(page, workspaceUntitled.documentId)
    expect(workspaceSaved.binding).toMatchObject({ kind: 'file', path: workspaceSavePath })
    expect(workspaceSaved.documentId).toBe(workspaceUntitled.documentId)
    expect(readFileSync(workspaceSavePath, 'utf8')).toContain('所选空间的新文档')
    evidence.selectedWorkspaceFirstSave = { selectedDirectory: selectedSubdirectory, otherAuthorizedWorkspace: authorizedB.directory,
      visibleWorkspace: saved, dialogs: workspaceSaveDialogs, documentId: workspaceSaved.documentId,
      binding: workspaceSaved.binding, source: workspaceSaved.model.kind === 'markdown' ? workspaceSaved.model.source : null }
    evidence.pageErrors = pageErrors
    await page.screenshot({ path: join(directory, 'selected-workspace-first-save.png') })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    evidence.pageErrors = pageErrors
    evidence.requests = server.requests.length
    await app.windows()[0]?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    await server.close()
  }
})
