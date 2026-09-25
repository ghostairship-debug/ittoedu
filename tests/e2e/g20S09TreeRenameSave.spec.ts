import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { installHostToolTestTransport } from './helpers/g20HostTools'

const root = resolve(__dirname, '../..')
const fixtureCourse = join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson')
const humanMarkdown = '# Start\n\nHUMAN dirty segment\n'
const aiMarkdown = '# Start\n\nAI dirty segment\n'

test('S09-T01 tree rename retains two dirty sessions, conversation context and History through AI edits and save', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The workspace file tree acceptance carrier is Windows Electron.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/s09/tree-rename-save')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const oldMarkdown = join(workspace, 'draft.md'), newMarkdown = join(workspace, 'renamed.md')
  const oldCourse = join(workspace, 'course.h5lesson'), newCourse = join(workspace, 'renamed-course.h5lesson')
  writeFileSync(oldMarkdown, '# Start\n\nOriginal segment\n')
  writeFileSync(oldCourse, readFileSync(fixtureCourse))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow(), pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await installHostToolTestTransport(app, page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const files = page.locator('.workspace-files-tree'), tree = files.getByRole('tree', { name: '工作空间文件' })
    const rename = async (oldName: string, newName: string) => {
      const row = tree.getByRole('button', { name: oldName, exact: true })
      await row.click(); await row.press('F2')
      const input = files.getByLabel('文件名称')
      await input.fill(newName); await input.press('Enter')
      await expect(tree.getByRole('button', { name: newName, exact: true })).toBeVisible()
      await expect(tree.getByRole('button', { name: oldName, exact: true })).toHaveCount(0)
    }

    await tree.getByRole('button', { name: 'draft.md', exact: true }).dblclick()
    await tree.getByRole('button', { name: 'course.h5lesson', exact: true }).dblclick()
    const opened = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const markdown = await documents.open(input.markdown), course = await documents.open(input.course)
      if (course.model.kind !== 'course-v9') throw new Error('Expected V9 course')
      const mdEdit = await documents.dispatch({ documentId: markdown.documentId, epoch: markdown.epoch,
        baseRevision: markdown.revision, actor: 'human', operationId: 's09-t01-human-md',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: input.humanMarkdown } } })
      const courseEdit = await documents.dispatch({ documentId: course.documentId, epoch: course.epoch,
        baseRevision: course.revision, actor: 'human', operationId: 's09-t01-human-course',
        mutation: { type: 'command', command: { type: 'course.replace',
          project: { ...course.model.project, title: '重命名前的人工标题' } } } })
      if (mdEdit.status !== 'applied' || courseEdit.status !== 'applied') throw new Error('Dirty preparation was not committed')
      const [md, cw] = await Promise.all([documents.read(markdown.documentId), documents.read(course.documentId)])
      const execution = window.desktopAPI!.execution!, space = await execution.workspace(input.workspace)
      const created = await execution.createConversation(space.workspace.workspaceId, 'S09 改名续作')
      const conversation = await execution.draft({ workspaceId: space.workspace.workspaceId,
        conversationId: created.conversationId, expectedRevision: created.revision,
        text: '改名后继续编辑当前两份未保存文档',
        documents: [md, cw].map(snapshot => ({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          revision: snapshot.revision, writable: [{ kind: 'document' as const }] })), attachments: [] })
      return { markdown: md, course: cw, workspaceId: space.workspace.workspaceId, conversation }
    }, { markdown: oldMarkdown, course: oldCourse, humanMarkdown, workspace })
    expect(opened.markdown.dirty).toBe(true)
    expect(opened.course.dirty).toBe(true)
    expect(opened.markdown.undoDepth).toBeGreaterThan(0)
    expect(opened.course.undoDepth).toBeGreaterThan(0)
    expect(opened.conversation.inputDraft).toBe('改名后继续编辑当前两份未保存文档')
    expect(opened.conversation.frozenContextRefs.map(ref => ref.documentId).sort()).toEqual(
      [opened.markdown.documentId, opened.course.documentId].sort())

    const mdHandle = await page.evaluate(async input => window.g20HostTool({ kind: 'begin', runId: 's09-t01-md-ai',
      documentId: input.documentId, target: { kind: 'markdown-range', from: input.from, to: input.from + 5 } }),
    { documentId: opened.markdown.documentId, from: humanMarkdown.indexOf('HUMAN') })
    const courseHandle = await page.evaluate(async id => window.g20HostTool({ kind: 'begin', runId: 's09-t01-course-ai',
      documentId: id, target: { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-title' } }), opened.course.documentId)
    expect(typeof mdHandle).toBe('string')
    expect(typeof courseHandle).toBe('string')

    await rename('draft.md', 'renamed.md')
    await rename('course.h5lesson', 'renamed-course.h5lesson')
    const renamed = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const [markdown, course, conversation] = await Promise.all([
        documents.read(input.markdownId), documents.read(input.courseId),
        execution.conversation(input.workspaceId, input.conversationId),
      ])
      return { markdown, course, conversation }
    }, { markdownId: opened.markdown.documentId, courseId: opened.course.documentId,
      workspaceId: opened.workspaceId, conversationId: opened.conversation.conversationId })
    expect(renamed.markdown).toMatchObject({ documentId: opened.markdown.documentId, epoch: opened.markdown.epoch,
      revision: opened.markdown.revision, undoDepth: opened.markdown.undoDepth, dirty: true,
      binding: { kind: 'file', path: newMarkdown } })
    expect(renamed.course).toMatchObject({ documentId: opened.course.documentId, epoch: opened.course.epoch,
      revision: opened.course.revision, undoDepth: opened.course.undoDepth, dirty: true,
      binding: { kind: 'file', path: newCourse } })
    expect(renamed.conversation).toEqual(opened.conversation)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /renamed\.md/ })).toBeVisible()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /renamed-course\.h5lesson/ })).toBeVisible()

    const mdAi = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 's09-t01-md-ai',
      call: { name: 'text.replace', input: { target: handle, content: 'AI' } } }), mdHandle as string)
    const courseAi = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 's09-t01-course-ai',
      call: { name: 'text.replace', input: { target: handle, content: '重命名后的 AI 标题' } } }), courseHandle as string)
    expect(mdAi).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(courseAi).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const afterAi = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      return { markdown: await documents.read(input.markdownId), course: await documents.read(input.courseId) }
    }, { markdownId: opened.markdown.documentId, courseId: opened.course.documentId })
    expect(afterAi.markdown.undoDepth).toBe(opened.markdown.undoDepth + 1)
    expect(afterAi.course.undoDepth).toBe(opened.course.undoDepth + 1)
    expect(afterAi.markdown.model.kind === 'markdown' && afterAi.markdown.model.source).toBe(aiMarkdown)

    // Walk across the rename boundary: the AI step undoes to the earlier human edit, then redoes.
    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const walk = async (documentId: string, name: string) => {
        const before = await documents.read(documentId)
        const undo = await documents.dispatch({ documentId, epoch: before.epoch, baseRevision: before.revision,
          actor: 'human', operationId: `s09-t01-undo-${name}`, mutation: { type: 'undo' } })
        const undone = await documents.read(documentId)
        const redo = await documents.dispatch({ documentId, epoch: undone.epoch, baseRevision: undone.revision,
          actor: 'human', operationId: `s09-t01-redo-${name}`, mutation: { type: 'redo' } })
        return { undo, undone, redo, redone: await documents.read(documentId) }
      }
      return { markdown: await walk(input.markdownId, 'md'), course: await walk(input.courseId, 'course') }
    }, { markdownId: opened.markdown.documentId, courseId: opened.course.documentId })
    expect(history.markdown.undo).toMatchObject({ status: 'applied' })
    expect(history.course.undo).toMatchObject({ status: 'applied' })
    expect(history.markdown.redo).toMatchObject({ status: 'applied' })
    expect(history.course.redo).toMatchObject({ status: 'applied' })
    expect(history.markdown.undone.model.kind === 'markdown' && history.markdown.undone.model.source).toBe(humanMarkdown)
    expect(history.markdown.redone.model.kind === 'markdown' && history.markdown.redone.model.source).toBe(aiMarkdown)
    const courseTitle = (snapshot: typeof history.course.undone) => snapshot.model.kind === 'course-v9'
      ? snapshot.model.project.surfaces.find(surface => surface.type === 'slide')?.scenes[0]?.layerItems
        .find(item => item.layerItemId === 'slide-title') : undefined
    const undoneTitle = courseTitle(history.course.undone), redoneTitle = courseTitle(history.course.redone)
    expect(redoneTitle?.kind === 'native' && redoneTitle.content.nativeType === 'text' && redoneTitle.content.data.text).toBe('重命名后的 AI 标题')
    expect(undoneTitle?.kind === 'native' && undoneTitle.content.nativeType === 'text' && undoneTitle.content.data.text).not.toBe('重命名后的 AI 标题')

    await page.evaluate(async ids => {
      const documents = window.desktopAPI!.documents!
      await documents.save(ids.markdownId)
      await documents.save(ids.courseId)
    }, { markdownId: opened.markdown.documentId, courseId: opened.course.documentId })
    expect(readFileSync(newMarkdown, 'utf8')).toBe(aiMarkdown)
    expect(existsSync(oldMarkdown)).toBe(false)
    expect(existsSync(oldCourse)).toBe(false)
    const driver = createCourseV9Driver()
    const reloadedCourse = await driver.load(new Uint8Array(readFileSync(newCourse)))
    if (reloadedCourse.kind !== 'course-v9') throw new Error('Saved course was not V9')
    expect(reloadedCourse.project.title).toBe('重命名前的人工标题')
    const slide = reloadedCourse.project.surfaces.find(surface => surface.type === 'slide')
    const title = slide?.scenes[0]?.layerItems.find(item => item.layerItemId === 'slide-title')
    expect(title?.kind === 'native' && title.content.nativeType === 'text' && title.content.data.text).toBe('重命名后的 AI 标题')

    await page.reload()
    const retained = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      return { markdown: await documents.read(input.markdownId), course: await documents.read(input.courseId),
        conversation: await execution.conversation(input.workspaceId, input.conversationId),
        conversations: await execution.conversations(input.workspaceId) }
    }, { markdownId: opened.markdown.documentId, courseId: opened.course.documentId,
      workspaceId: opened.workspaceId, conversationId: opened.conversation.conversationId })
    expect(retained.markdown).toMatchObject({ documentId: opened.markdown.documentId, dirty: false,
      binding: { kind: 'file', path: newMarkdown } })
    expect(retained.course).toMatchObject({ documentId: opened.course.documentId, dirty: false,
      binding: { kind: 'file', path: newCourse } })
    expect(retained.conversation).toEqual(opened.conversation)
    expect(retained.conversations.filter(item => item.conversationId === opened.conversation.conversationId)).toHaveLength(1)
    expect(pageErrors).toEqual([])

    const screenshot = join(directory, 'renamed-and-saved.png')
    await page.screenshot({ path: screenshot })
    await info.attach('S09-T01 renamed and saved', { path: screenshot, contentType: 'image/png' })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ caseId: 'S09-T01', status: 'passed',
      carrier: 'Windows Electron file tree and direct host tool transport; no model call',
      oldPaths: [oldMarkdown, oldCourse], newPaths: [newMarkdown, newCourse],
      documentIds: [opened.markdown.documentId, opened.course.documentId],
      conversationId: opened.conversation.conversationId,
      observed: { dirtySessionsRetainedOnRename: true, frozenConversationContextRetained: true,
        preRenameToolHandlesApplied: true, undoRedoAcrossRename: true, savesBoundToNewPaths: true,
        oldPathsAbsent: true, conversationRetainedAfterReload: true } }, null, 2), 'utf8')
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0)
      }).catch(() => {})
      await app.close().catch(() => {})
    }
  }
})
