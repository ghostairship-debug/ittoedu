import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { APP_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')

test('G20 window title stays fixed across dirty edits and editor focus', async () => {
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/task0/window-title')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'))))
  const project = structuredClone(archive.project)
  project.title = '私有工程属性不进入窗口标题'
  const file = join(workspace, 'private-title.h5lesson')
  writeFileSync(file, createCourseProjectArchive({ ...archive, project }))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle(APP_NAME)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByRole('region', { name: '没有打开的文件' }).getByRole('button', { name: '打开文件夹', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'private-title.h5lesson', exact: true }).dblclick()
    const tab = page.locator('.workspace-document-tabs').getByRole('tab', { name: /^private-title\.h5lesson/ })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.canvas-stage-stack, .flow-workspace').filter({ visible: true }).first()).toBeVisible()

    const edited = await page.evaluate(async filename => {
      const api = window.desktopAPI!.documents!
      const snapshot = await api.open(filename)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Expected V9 course')
      const slide = snapshot.model.project.surfaces.find(surface => surface.type === 'slide')
      if (!slide || slide.type !== 'slide') throw new Error('Expected slide surface')
      const scene = slide.scenes[0]!
      const item = scene.layerItems.find(candidate => candidate.kind === 'native' && candidate.content.nativeType === 'text')
      if (!item || item.kind !== 'native') throw new Error('Expected native text')
      const receipt = await api.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        actor: 'human', operationId: 'task0-window-title-dirty', mutation: { type: 'command', command: {
          type: 'course.object.patch', locationId: scene.id, itemId: item.layerItemId,
          patch: { nativeData: { text: '工程修改已提交，但标题保持固定' } },
        } } })
      return { documentId: snapshot.documentId, receipt }
    }, file)
    expect(edited.receipt).toMatchObject({ status: 'applied' })
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI!.documents!.read(id), edited.documentId)).dirty).toBe(true)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /^private-title\.h5lesson/ }).getByLabel('未保存')).toBeVisible()
    await expect(page).toHaveTitle(APP_NAME)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(APP_NAME)

    await page.locator('.course-light-tools').getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(page).toHaveTitle(APP_NAME)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(APP_NAME)
    await page.screenshot({ path: join(directory, 'dirty-editor-title.png') })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ file, projectTitle: project.title, appName: APP_NAME,
      receipt: edited.receipt, dirty: (await page.evaluate(id => window.desktopAPI!.documents!.read(id), edited.documentId)).dirty,
      browserTitle: await page.title(), nativeTitle: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()) }, null, 2))
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI!.documents!.read(id), edited.documentId)).dirty).toBe(false)
    await expect(page).toHaveTitle(APP_NAME)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(APP_NAME)
  } finally {
    await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.destroy())
      setTimeout(() => electronApp.exit(0), 0)
    }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
