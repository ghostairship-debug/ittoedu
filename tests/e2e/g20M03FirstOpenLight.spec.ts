import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'

const root = resolve(__dirname, '../..')

test('M03-T01 first course open gives a light content view and a direct ordinary edit', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The first-open review uses Windows Electron.')
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/m03/first-open-light')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, '首次打开.h5lesson')
  const course = createBlankCourseProject({ title: '首次打开', includeDefaultController: false, controls: 'none' })
  const slide = course.surfaces.find(surface => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('Expected Slide surface')
  slide.scenes[0]!.layerItems = [sceneNodeToCourseLayerItem(createTextNode({
    id: 'first-open-text', text: '点击后修改这段文字', x: 140, y: 140, width: 600, height: 100,
    style: { overflow: 'fixed', fontSize: 40 },
  }))]
  writeFileSync(file, createCourseProjectArchive({ project: course, assetFiles: {}, componentFiles: {} }))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(12_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow, dialog }, selected) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 860)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: '首次打开.h5lesson' }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    await expect(frame.getByTestId('canvas-stage').first()).toBeVisible()
    await expect(page.locator('.canvas-viewport')).toHaveAttribute('data-observation-ready', 'true')
    await expect(page.getByText('正在挂载 Published V2 编辑宿主…')).toHaveCount(0)
    await expect(frame.locator('.course-light-tools').getByRole('button', { name: '插入', exact: true })).toBeVisible()
    await expect(frame.locator('.course-light-tools').getByRole('button', { name: '深度编辑', exact: true })).toBeVisible()
    await expect(frame.locator('.course-advanced-chrome:visible')).toHaveCount(0)
    await expect(page.getByRole('region', { name: '资源管理器' })).toBeVisible()
    await expect(page.getByRole('region', { name: '会话管理区' })).toBeVisible()
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    const initialScreenshot = join(directory, 'first-open.png')
    await page.screenshot({ path: initialScreenshot })
    await info.attach('M03 first open', { path: initialScreenshot, contentType: 'image/png' })

    const item = page.locator('[data-slide-layer-item="first-open-text"]:visible').first()
    await expect(item).toBeVisible()
    const box = await item.boundingBox()
    if (!box) throw new Error('Text is not painted')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const quickTools = frame.locator('.course-light-tools__selection')
    await expect(quickTools.getByRole('button', { name: '编辑文字', exact: true })).toBeVisible()
    await quickTools.getByRole('button', { name: '编辑文字', exact: true }).click()
    const editor = page.getByTestId('text-edit-overlay')
    await expect(editor).toBeVisible()
    await editor.fill('普通手改已完成')
    await editor.press('Control+Enter')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Missing DocumentSession')
    await expect.poll(async () => page.evaluate(async id => {
      const snapshot = await window.desktopAPI!.documents!.read(id)
      if (snapshot.model.kind !== 'course-v9') return null
      const surface = snapshot.model.project.surfaces.find(value => value.type === 'slide')
      if (!surface || surface.type !== 'slide') return null
      const text = surface.scenes[0]?.layerItems.find(value => value.layerItemId === 'first-open-text')
      return text?.kind === 'native' && text.content.nativeType === 'text' ? text.content.data.text : null
    }, documentId)).toBe('普通手改已完成')
    await frame.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)).dirty).toBe(false)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(file)))
    const savedSlide = archive.project.surfaces.find(surface => surface.type === 'slide')
    const savedText = savedSlide?.type === 'slide' ? savedSlide.scenes[0]?.layerItems.find(value => value.layerItemId === 'first-open-text') : null
    expect(savedText?.kind === 'native' && savedText.content.nativeType === 'text' ? savedText.content.data.text : null).toBe('普通手改已完成')
    expect(errors).toEqual([])
  } catch (error) {
    await app.firstWindow().then(page => page.screenshot({ path: join(directory, 'failure.png') })).catch(() => {})
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
