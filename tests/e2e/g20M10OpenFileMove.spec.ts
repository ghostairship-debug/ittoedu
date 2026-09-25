import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { installHostToolTestTransport } from './helpers/g20HostTools'

const root = resolve(__dirname, '../..')
const fixtureCourse = join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson')

test('M10-T02 tree move keeps dirty Markdown and V9 tabs writable at their new paths', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M10 desktop file moves are accepted on Windows.')
  test.setTimeout(150_000)
  const base = join(root, 'output/g20/m10/bindings'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), target = join(workspace, 'target')
  mkdirSync(target, { recursive: true }); mkdirSync(join(workspace, 'assets'))
  writeFileSync(join(workspace, 'assets', 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
  const originalMd = join(workspace, 'draft.md'), movedMd = join(target, 'draft.md')
  const originalCourse = join(workspace, 'course.h5lesson'), movedCourse = join(target, 'course.h5lesson')
  writeFileSync(originalMd, '# Start\n\nORIGINAL segment\n![image](assets/image.png)\n')
  writeFileSync(originalCourse, readFileSync(fixtureCourse))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await installHostToolTestTransport(app, page)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const files = page.locator('.workspace-files-tree'), tree = files.getByRole('tree', { name: '工作空间文件' })

    await tree.getByRole('button', { name: 'draft.md', exact: true }).dblclick()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /draft\.md/ })).toBeVisible()
    const md = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), originalMd)
    const humanSource = '# Start\n\nHUMAN segment\n![image](assets/image.png)\n'
    const editor = page.getByRole('region', { name: '教学文档 draft.md', exact: true })
    if (await editor.getByRole('button', { name: '源文', exact: true }).isVisible()) {
      await editor.getByRole('button', { name: '源文', exact: true }).click()
    }
    const source = editor.getByLabel('正文源文编辑')
    await source.click(); await page.keyboard.press('Control+A'); await page.keyboard.type(humanSource); await source.press('Tab')
    await expect.poll(() => page.evaluate(async id => {
      const current = await window.desktopAPI!.documents!.read(id)
      return current.model.kind === 'markdown' ? current.model.source : null
    }, md.documentId)).toBe(humanSource)
    const from = humanSource.indexOf('HUMAN')
    const mdHandle = await page.evaluate(async ({ id, from }) => window.g20HostTool({ kind: 'begin', runId: 'm10-md-ai',
      documentId: id, target: { kind: 'markdown-range', from, to: from + 5 } }), { id: md.documentId, from })
    expect(typeof mdHandle).toBe('string')
    await expect.poll(() => page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).dirty, md.documentId)).toBe(true)
    await tree.getByRole('button', { name: 'draft.md', exact: true }).click()
    await files.getByRole('button', { name: '移动到…' }).click()
    await files.getByLabel('目标文件夹').selectOption({ label: 'target' })
    await files.getByRole('button', { name: '确认' }).click()
    await files.getByRole('button', { name: '连同资源继续' }).click()
    await expect(files.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async id => {
      const current = await window.desktopAPI!.documents!.read(id)
      return current.binding.kind === 'file' ? current.binding.path : null
    }, md.documentId)).toBe(movedMd)
    expect(existsSync(originalMd)).toBe(false)
    expect(existsSync(join(target, 'assets', 'image.png'))).toBe(true)
    await source.click(); await source.press('Control+End'); await page.keyboard.type('After move manual\n'); await source.press('Tab')
    await expect.poll(() => page.evaluate(async id => {
      const current = await window.desktopAPI!.documents!.read(id)
      return current.model.kind === 'markdown' ? current.model.source.includes('After move manual') : false
    }, md.documentId)).toBe(true)
    const mdResult = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 'm10-md-ai',
      call: { name: 'text.replace', input: { target: handle, content: 'AI' } } }), mdHandle as string)
    expect(mdResult).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await page.evaluate(async id => window.desktopAPI!.documents!.save(id), md.documentId)
    expect(readFileSync(movedMd, 'utf8')).toContain('AI segment')
    expect(readFileSync(movedMd, 'utf8')).toContain('After move manual')
    expect(existsSync(originalMd)).toBe(false)

    await tree.getByRole('button', { name: 'course.h5lesson', exact: true }).dblclick()
    const course = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), originalCourse)
    await page.evaluate(async id => {
      const api = window.desktopAPI!.documents!, current = await api.read(id)
      if (current.model.kind !== 'course-v9') throw new Error('Expected V9')
      await api.dispatch({ documentId: id, epoch: current.epoch, baseRevision: current.revision, actor: 'human',
        operationId: 'm10-course-human-before-move', mutation: { type: 'command', command: { type: 'course.replace',
          project: { ...current.model.project, title: '人工修改的课件名' } } } })
    }, course.documentId)
    const courseHandle = await page.evaluate(async id => window.g20HostTool({ kind: 'begin', runId: 'm10-course-ai',
      documentId: id, target: { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-title' } }), course.documentId)
    expect(typeof courseHandle).toBe('string')
    await expect.poll(() => page.evaluate(async id => (await window.desktopAPI!.documents!.read(id)).dirty, course.documentId)).toBe(true)
    const courseRow = tree.getByRole('button', { name: 'course.h5lesson', exact: true })
    await courseRow.click(); await courseRow.press('Control+X')
    const targetRow = tree.getByRole('button', { name: 'target', exact: true })
    await targetRow.click(); await targetRow.press('Control+V')
    await expect.poll(() => page.evaluate(async id => {
      const current = await window.desktopAPI!.documents!.read(id)
      return current.binding.kind === 'file' ? current.binding.path : null
    }, course.documentId)).toBe(movedCourse)
    const courseResult = await page.evaluate(async handle => window.g20HostTool({ kind: 'call', runId: 'm10-course-ai',
      call: { name: 'text.replace', input: { target: handle, content: 'AI 更新的页面标题' } } }), courseHandle as string)
    expect(courseResult).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await page.evaluate(async id => window.desktopAPI!.documents!.save(id), course.documentId)
    expect(existsSync(originalCourse)).toBe(false)
    const driver = createCourseV9Driver()
    const original = await driver.load(new Uint8Array(readFileSync(fixtureCourse)))
    const reopened = await driver.load(new Uint8Array(readFileSync(movedCourse)))
    if (original.kind !== 'course-v9' || reopened.kind !== 'course-v9') throw new Error('V9 archive changed kind')
    expect(reopened.resources).toEqual(original.resources)
    expect(reopened.project.title).toBe('人工修改的课件名')
    const slide = reopened.project.surfaces.find(surface => surface.type === 'slide')
    const title = slide?.scenes[0]?.layerItems.find(item => item.layerItemId === 'slide-title')
    expect(title?.kind === 'native' && title.content.nativeType === 'text' && title.content.data.text).toBe('AI 更新的页面标题')
    expect(errors).toEqual([])
    const screenshot = join(directory, 'moved-open-documents.png')
    await page.screenshot({ path: screenshot })
    await info.attach('moved-open-documents', { path: screenshot, contentType: 'image/png' })
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
