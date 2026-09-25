import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MATERIAL_TEXT, diagramPng, r19LessonMaterials } from '../fixtures/r19LessonMaterials'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')
async function choose(app: ElectronApplication, filename: string, save = false) {
  // Only the native picker is automated; file reads, extraction, IPC and writes remain real.
  await app.evaluate(({ dialog }, input) => {
    if (input.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: input.filename })
    else dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input.filename] })
  }, { filename, save })
}

test('r19 lesson: real PDF DOCX PPTX reading, document conflict and reopen, first save and Save As isolation', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const directory = mkdtempSync(join(tmpdir(), 'courseware-r19-lesson-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const originals = join(directory, 'originals'); mkdirSync(originals)
  const profile = join(directory, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开工作空间', exact: true }).first()).toBeVisible()
    const lesson = await page.evaluate(async directory => {
      const made = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '串联电路' })
      if (!made.lesson) throw new Error('Lesson fixture creation failed')
      return made.lesson
    }, workspace)
    const fixtureCourse = createBlankCourseProject({ title: '串联电路课件', includeDefaultController: false, controls: 'none' })
    writeFileSync(join(lesson.identity.normalizedDirectory, 'course.h5lesson'), createCourseProjectArchive({ project: fixtureCourse, assetFiles: {}, componentFiles: {} }))
    writeFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), JSON.stringify({ ...lesson.manifest, coursePath: 'course.h5lesson' }))
    await choose(app, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '串联电路', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
    expect(lesson.manifest.title).toBe('串联电路')
    const target = { lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }
    await page.getByRole('tab', { name: '材料', exact: true }).click()
    for (const fixture of r19LessonMaterials()) {
      const filename = join(originals, fixture.name); writeFileSync(filename, fixture.bytes)
      await choose(app, filename)
      await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
      const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: fixture.name, exact: true }) })
      await expect(article).toBeVisible()
      await article.getByRole('button', { name: new RegExp(`正文：${MATERIAL_TEXT}`) }).click()
      await expect(page.getByRole('article', { name: '材料片段内容' })).toContainText(MATERIAL_TEXT)
      await article.getByRole('button', { name: /图像/ }).first().click()
      const image = page.getByRole('img', { name: '材料原图或页面图像' })
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      const pixels = await image.evaluate(element => {
        const image = element as HTMLImageElement, canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        let bluePixels = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] > 240) bluePixels++
        return bluePixels
      })
      expect(pixels).toBeGreaterThan(500)
      rmSync(filename)
      const saved = await page.evaluate(async ({ target, title }) => {
        const api = window.desktopAPI!.lessonMaterials!, record = (await api.list(target)).find(item => item.title === title)!
        const read = await api.read(target, { id: record.id, extractionVersion: record.extractionVersion, fragmentIds: record.fragments.map(item => item.id) })
        return { record, read: { ...read, assets: read.assets.map(asset => ({ ...asset, bytes: Array.from(asset.bytes) })) } }
      }, { target, title: fixture.name })
      expect(saved.read.fragments.some(item => item.text?.includes(MATERIAL_TEXT))).toBe(true)
      expect(saved.read.extractionVersion).toBe(saved.record.extractionVersion)
      expect(readFileSync(join(target.rootPath, saved.record.sourcePath))).toEqual(Buffer.from(fixture.bytes))
      if (fixture.format !== 'pdf') expect(saved.read.assets[0].bytes).toEqual(Array.from(diagramPng()))
      await testInfo.attach(`${fixture.format}-read.json`, { body: JSON.stringify({ record: saved.record, readAt: saved.read.readAt }), contentType: 'application/json' })
    }
    const ref = { kind: 'lesson' as const, lessonId: target.lessonId, lessonDirectory: target.rootPath, relativePath: '01-teaching-plan.md' }
    const created = await page.evaluate(async ref => window.desktopAPI!.lessonFiles!.saveDocument({ ref, expectedVersion: null, source: '# 串联电路\n\n初稿。\n', operationId: 'e2e-create', attachments: [] }), ref)
    expect(created.status).toBe('saved')
    await page.evaluate(async ({ lesson, relativePath }) => window.desktopAPI!.lesson!({ operation: 'register-document', lesson, role: 'teaching-plan', relativePath }), { lesson: lesson.identity, relativePath: ref.relativePath })
    await page.getByRole('button', { name: '刷新工作空间根目录', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '串联电路', exact: true }).click()
    await page.getByRole('button', { name: ref.relativePath, exact: true }).click()
    const editor = page.getByRole('region', { name: `教学文档 ${ref.relativePath}` })
    await editor.getByRole('button', { name: '源文', exact: true }).click()
    const source = editor.getByRole('textbox', { name: '正文源文编辑' })
    await source.fill('# 串联电路\n\n教师修订。\n')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(target.rootPath, ref.relativePath), 'utf8')).toContain('教师修订')
    const opened = await page.evaluate(async ref => window.desktopAPI!.lessonFiles!.openDocument(ref), ref)
    writeFileSync(join(target.rootPath, ref.relativePath), '# 串联电路\n\n外部修订。\n')
    const conflict = await page.evaluate(async ({ ref, version }) => window.desktopAPI!.lessonFiles!.saveDocument({ ref, expectedVersion: version, source: '# 串联电路\n\n迟到修订。\n', operationId: 'e2e-conflict', attachments: [] }), { ref, version: opened.version })
    expect(conflict.status).toBe('conflict')
    expect(readFileSync(join(target.rootPath, ref.relativePath), 'utf8')).toContain('外部修订')
    const firstPath = join(target.rootPath, 'course.h5lesson')
    await page.reload()
    const reopened = await page.evaluate(async ({ directory, ref, target }) => ({
      lesson: await window.desktopAPI!.lesson!({ operation: 'open-lesson', directory }),
      file: await window.desktopAPI!.lessonFiles!.openDocument(ref), materials: await window.desktopAPI!.lessonMaterials!.list(target),
    }), { directory: target.rootPath, ref, target })
    expect(reopened.lesson.lesson!.identity).toEqual(lesson.identity)
    expect(reopened.file.source).toContain('外部修订')
    expect(reopened.materials).toHaveLength(3)
    // Reactivate the lesson through its real GUI after renderer reload（V3.1：经目录树点选 .h5lesson 激活；重载后自动回到上次工作空间）
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '串联电路', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
    await page.getByRole('tab', { name: /新建课件|course/ }).click()
    await choose(app, firstPath, true)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    const canonical = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), firstPath)
    expect(canonical.binding).toMatchObject({ kind: 'file', path: firstPath })
    expect(canonical.dirty).toBe(false)
    const conversations = () => page.evaluate(async workspace => (await window.desktopAPI!.execution!.workspace(workspace)).conversations.map(value => value.conversationId), workspace)
    const originalConversations = await conversations()
    const originalBytes = readFileSync(firstPath)
    expect(originalBytes.subarray(0, 2).toString()).toBe('PK')
    const secondPath = join(target.rootPath, 'course-copy.h5lesson')
    await choose(app, secondPath, true)
    await page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(async () => page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).binding, canonical.documentId)).toMatchObject({ kind: 'file', path: secondPath })
    const after = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), canonical.documentId)
    expect(after.documentId).toBe(canonical.documentId)
    expect(after.undoDepth).toBe(canonical.undoDepth)
    expect(await conversations()).toEqual(originalConversations)
    expect(readFileSync(firstPath)).toEqual(originalBytes)
    expect(readFileSync(secondPath).subarray(0, 2).toString()).toBe('PK')
  } catch (error) {
    const page = app?.windows()[0]
    if (page) {
      await testInfo.attach('last-ui.txt', { body: await page.locator('body').innerText().catch(() => ''), contentType: 'text/plain' })
      await testInfo.attach('last-ui.png', { body: await page.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' })
    }
    throw error
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {}); await app.close().catch(() => {}) }
    const scoped = relative(resolve(tmpdir()), resolve(directory))
    if (!isAbsolute(scoped) && !scoped.startsWith('..') && scoped.startsWith('courseware-r19-lesson-')) rmSync(directory, { recursive: true, force: true })
  }
})
