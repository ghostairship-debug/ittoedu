import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { installHostToolTestTransport } from './helpers/g20HostTools'

const root = resolve(__dirname, '../..')
const fixtureCourse = join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson')

test('S09-T01 tree rename keeps dirty Markdown and V9 AI sessions, History and saves bound to the new paths', async () => {
  test.skip(process.platform !== 'win32', 'This case requires the Windows Electron file tree.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/s09'), evidenceDirectory = join(base, 'tree-rename-open-documents')
  mkdirSync(base, { recursive: true })
  const evidenceFile = join(evidenceDirectory, 'evidence.json')
  rmSync(evidenceFile, { force: true })
  const directory = mkdtempSync(join(base, 'tree-rename-run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const oldMarkdown = join(workspace, 'draft.md'), newMarkdown = join(workspace, 'renamed.md')
  const oldCourse = join(workspace, 'course.h5lesson'), newCourse = join(workspace, 'renamed-course.h5lesson')
  writeFileSync(oldMarkdown, '# Start\n\nHUMAN segment\n')
  writeFileSync(oldCourse, readFileSync(fixtureCourse))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await installHostToolTestTransport(app, page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const files = page.locator('.workspace-files-tree'), tree = files.getByRole('tree', { name: '工作空间文件' })
    const rename = async (oldName: string, newName: string) => {
      const row = tree.getByRole('button', { name: oldName, exact: true })
      await row.click(); await row.press('F2')
      const input = files.getByLabel('文件名称')
      await input.fill(newName); await input.press('Enter')
      await expect(tree.getByRole('button', { name: newName, exact: true })).toBeVisible()
    }

    await tree.getByRole('button', { name: 'draft.md', exact: true }).dblclick()
    const markdown = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), oldMarkdown)
    await page.evaluate(async id => {
      const api = window.desktopAPI!.documents!, current = await api.read(id)
      await api.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision,
        operationId: 's09-md-dirty-before-rename', actor: 'human',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: '# Start\n\nHUMAN dirty segment\n' } } })
    }, markdown.documentId)
    const mdBefore = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), markdown.documentId)
    const from = '# Start\n\nHUMAN dirty segment\n'.indexOf('HUMAN')
    const mdHandle = await page.evaluate(async ({ id, from }) => window.g20HostTool({ kind: 'begin', runId: 's09-md-ai',
      documentId: id, target: { kind: 'markdown-range', from, to: from + 5 } }), { id: markdown.documentId, from })
    expect(typeof mdHandle).toBe('string')
    await rename('draft.md', 'renamed.md')
    const mdRenamed = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), markdown.documentId)
    expect(mdRenamed).toMatchObject({ documentId: markdown.documentId, epoch: mdBefore.epoch,
      revision: mdBefore.revision, undoDepth: mdBefore.undoDepth, dirty: true,
      binding: { kind: 'file', path: newMarkdown } })
    const mdAi = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 's09-md-ai',
      call: { name: 'text.replace', input: { target: handle, content: 'AI' } } }), mdHandle as string)
    expect(mdAi).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await page.evaluate(async id => window.desktopAPI!.documents!.save(id), markdown.documentId)
    expect(readFileSync(newMarkdown, 'utf8')).toContain('AI dirty segment')
    expect(existsSync(oldMarkdown)).toBe(false)

    await tree.getByRole('button', { name: 'course.h5lesson', exact: true }).dblclick()
    const course = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), oldCourse)
    await page.evaluate(async id => {
      const api = window.desktopAPI!.documents!, current = await api.read(id)
      if (current.model.kind !== 'course-v9') throw new Error('Expected V9 course')
      await api.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision,
        operationId: 's09-course-dirty-before-rename', actor: 'human',
        mutation: { type: 'command', command: { type: 'course.replace',
          project: { ...current.model.project, title: '重命名前的人工修改' } } } })
    }, course.documentId)
    const courseBefore = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), course.documentId)
    const courseHandle = await page.evaluate(async id => window.g20HostTool({ kind: 'begin', runId: 's09-course-ai',
      documentId: id, target: { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-title' } }), course.documentId)
    expect(typeof courseHandle).toBe('string')
    await rename('course.h5lesson', 'renamed-course.h5lesson')
    const courseRenamed = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), course.documentId)
    expect(courseRenamed).toMatchObject({ documentId: course.documentId, epoch: courseBefore.epoch,
      revision: courseBefore.revision, undoDepth: courseBefore.undoDepth, dirty: true,
      binding: { kind: 'file', path: newCourse } })
    const courseAi = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 's09-course-ai',
      call: { name: 'text.replace', input: { target: handle, content: '重命名后的 AI 标题' } } }), courseHandle as string)
    expect(courseAi).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await page.evaluate(async id => window.desktopAPI!.documents!.save(id), course.documentId)
    expect(existsSync(oldCourse)).toBe(false)
    const driver = createCourseV9Driver()
    const reopened = await driver.load(new Uint8Array(readFileSync(newCourse)))
    if (reopened.kind !== 'course-v9') throw new Error('Expected reopened V9 course')
    expect(reopened.project.title).toBe('重命名前的人工修改')
    const slide = reopened.project.surfaces.find(surface => surface.type === 'slide')
    const title = slide?.scenes[0]?.layerItems.find(item => item.layerItemId === 'slide-title')
    expect(title?.kind === 'native' && title.content.nativeType === 'text' && title.content.data.text).toBe('重命名后的 AI 标题')
    const mdAfter = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), markdown.documentId)
    const courseAfter = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), course.documentId)
    expect(mdAfter.undoDepth).toBeGreaterThan(mdBefore.undoDepth)
    expect(courseAfter.undoDepth).toBeGreaterThan(courseBefore.undoDepth)
    expect(mdAfter.epoch).toBe(mdBefore.epoch)
    expect(courseAfter.epoch).toBe(courseBefore.epoch)

    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(evidenceFile, JSON.stringify({ caseId: 'S09-T01-TREE-RENAME-OPEN-DOCUMENTS', result: 'passed',
      capturedAt: new Date().toISOString(), testLayer: 'Playwright Electron real file tree and host AI tool transport',
      build: { mainWorkspaceFilesSha256: createHash('sha256').update(readFileSync(join(root, 'dist-electron/main/workbench/WorkspaceFiles.js'))).digest('hex') },
      observed: { dirtyMarkdownAndV9RenamedInTree: true, documentIdsAndEpochsRetained: true,
        revisionsAndUndoDepthUnchangedByRename: true, preRenameAiHandlesAppliedAfterRename: true,
        savesOnlyAtNewPaths: true, oldPathsAbsent: true, V9ArchiveReopenedWithAiEdit: true },
    }, null, 2), 'utf8')
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    if (!resolve(directory).startsWith(resolve(base) + sep)) throw new Error('Unsafe S09 tree-rename fixture cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})
