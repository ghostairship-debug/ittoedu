import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const root = resolve(__dirname, '../..')
const filename = '工作台属性验收.h5lesson'

function course(): { bytes: Uint8Array; flowSurfaceId: string } {
  const project = createBlankCourseProject({ title: '工作台属性验收', includeDefaultController: false, controls: 'none' })
  const slide = project.surfaces.find(surface => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('Expected Slide')
  const text = (id: string, value: string, y: number, order: number) => {
    const item = sceneNodeToCourseLayerItem(createTextNode({ id, text: value, x: 120, y, width: 400, height: 90, style: { overflow: 'fixed', fontSize: 32 } }))
    item.order = order; item.label = value
    return item
  }
  slide.scenes[0]!.layerItems = [text('original-a', '原有文字 A', 120, 1), text('original-b', '原有文字 B', 300, 2)]
  const added = addCourseFlowPage(project, { title: 'Flow 原有正文' })
  if (!added.ok) throw new Error(added.reason)
  const flow = added.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Expected Flow')
  const paragraph = flow.blocks.find(block => block.type === 'paragraph')
  if (!paragraph || paragraph.type !== 'paragraph') throw new Error('Expected Flow paragraph')
  paragraph.content.inlines = [{ type: 'text', text: '原有段落文字' }]
  return { bytes: createCourseProjectArchive({ project: added.project, assetFiles: {}, componentFiles: {} }), flowSurfaceId: flow.id }
}

function project(snapshot: DocumentSnapshot): CourseProjectDocument {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected V9 DocumentSession')
  return snapshot.model.project
}
function slideItems(snapshot: DocumentSnapshot) {
  const surface = project(snapshot).surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Slide missing')
  return surface.scenes[0]!.layerItems
}
function flowBlocks(snapshot: DocumentSnapshot) {
  const surface = project(snapshot).surfaces.find(value => value.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Flow missing')
  return surface.blocks
}
async function clickPainted(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('Selected item has no painted bounds')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
function wave(frequency: number) {
  const samples = 8000, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * frequency * index / 8000) * 5000), true)
  return bytes
}

test('M03-T07 existing and manual objects use compact properties; Flow paragraph, playback and layer order persist', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/workbench-property-owner'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const courseFile = join(workspace, filename), imageFile = join(workspace, '插入图片.png')
  const replacementFile = join(workspace, '替换图片.png'), videoFile = join(workspace, '公开视频.webm')
  const audioFile = join(workspace, '原始声音.wav'), replacementAudio = join(workspace, '替换声音.wav')
  const seeded = course()
  writeFileSync(courseFile, seeded.bytes)
  writeFileSync(imageFile, await sharp({ create: { width: 80, height: 60, channels: 4, background: '#2b73b9' } }).png().toBuffer())
  writeFileSync(replacementFile, await sharp({ create: { width: 90, height: 70, channels: 4, background: '#ee8b31' } }).png().toBuffer())
  copyFileSync(join(root, 'tests/fixtures/r18CommonTasks/materials/motion.webm'), videoFile)
  writeFileSync(audioFile, wave(440)); writeFileSync(replacementAudio, wave(660))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1540, 900)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: filename, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    let documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('No course DocumentSession')
    const read = () => page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId!)
    const lightTools = frame.locator('.course-light-tools')
    const insert = async (name: string, selectedPath: string) => {
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, selectedPath)
      await lightTools.getByRole('button', { name: '插入', exact: true }).click()
      await lightTools.getByRole('button', { name, exact: true }).click()
    }
    const before = await read()
    await expect(page.locator('.canvas-viewport')).toHaveAttribute('data-observation-ready', 'true')
    await clickPainted(page, page.locator('[data-slide-layer-item="original-a"]:visible').first())
    const compact = lightTools.locator('.course-light-tools__selection')
    await expect(compact.getByRole('button', { name: '加粗', exact: true })).toBeVisible()
    await compact.getByRole('button', { name: '加粗', exact: true }).click()
    await expect.poll(async () => {
      const item = slideItems(await read()).find(value => value.layerItemId === 'original-a')
      return item?.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.style.bold : null
    }).toBe(true)
    const originalWidth = compact.getByLabel('宽', { exact: true })
    await originalWidth.fill('430'); await originalWidth.press('Tab')
    await expect.poll(async () => slideItems(await read()).find(value => value.layerItemId === 'original-a')?.frame.width).toBe(430)
    await compact.getByRole('button', { name: '编辑文字', exact: true }).click()
    const textEditor = page.getByTestId('text-edit-overlay')
    await expect(textEditor).toBeVisible()
    await textEditor.fill('原有文字 A 已直接编辑')
    await textEditor.press('Control+Enter')
    await expect.poll(async () => {
      const item = slideItems(await read()).find(value => value.layerItemId === 'original-a')
      return item?.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.text : null
    }).toBe('原有文字 A 已直接编辑')
    await clickPainted(page, page.locator('[data-slide-layer-item="original-a"]:visible').first())
    await page.keyboard.down('Control')
    try { await clickPainted(page, page.locator('[data-slide-layer-item="original-b"]:visible').first()) }
    finally { await page.keyboard.up('Control') }
    await expect(page.getByRole('toolbar', { name: '选中对象快捷工具' })).toContainText('已选 2 项')
    const beforeDelete = await read()
    await page.keyboard.press('Delete')
    await expect.poll(async () => slideItems(await read()).filter(item => item.layerItemId === 'original-a' || item.layerItemId === 'original-b').length).toBe(0)
    expect((await read()).undoDepth).toBe(beforeDelete.undoDepth + 1)
    await lightTools.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => slideItems(await read()).filter(item => item.layerItemId === 'original-a' || item.layerItemId === 'original-b').length).toBe(2)

    const beforeImage = await read()
    await insert('添加图片', imageFile)
    await expect.poll(async () => slideItems(await read()).filter(item => item.kind === 'native' && item.content.nativeType === 'image').length).toBe(1)
    const manualImage = slideItems(await read()).find(item => item.kind === 'native' && item.content.nativeType === 'image')
    if (!manualImage || manualImage.kind !== 'native' || manualImage.content.nativeType !== 'image') throw new Error('Manual image missing')
    expect((await read()).revision).toBeGreaterThan(beforeImage.revision)
    await clickPainted(page, page.locator(`[data-slide-layer-item="${manualImage.layerItemId}"]:visible`).first())
    await expect(compact.getByRole('button', { name: '替换图片', exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, replacementFile)
    await compact.getByRole('button', { name: '替换图片', exact: true }).click()
    await expect.poll(async () => {
      const item = slideItems(await read()).find(value => value.layerItemId === manualImage.layerItemId)
      return item?.kind === 'native' && item.content.nativeType === 'image' ? item.content.data.assetId : null
    }).not.toBe(manualImage.content.data.assetId)

    await insert('添加视频', videoFile)
    await expect.poll(async () => slideItems(await read()).filter(item => item.kind === 'native' && item.content.nativeType === 'video').length).toBe(1)
    const video = slideItems(await read()).find(item => item.kind === 'native' && item.content.nativeType === 'video')
    if (!video) throw new Error('Manual video missing')
    await clickPainted(page, page.locator(`[data-slide-layer-item="${video.layerItemId}"]:visible`).first())
    const quickTools = page.getByRole('toolbar', { name: '选中对象快捷工具' })
    await quickTools.getByRole('button', { name: '属性', exact: true }).click()
    const properties = page.getByRole('complementary', { name: '选中对象属性' })
    await expect(properties.getByRole('button', { name: '自动播放', exact: true })).toBeVisible()
    await properties.getByRole('button', { name: '自动播放', exact: true }).click()
    await properties.getByRole('button', { name: '循环播放', exact: true }).click()
    await expect.poll(async () => {
      const item = slideItems(await read()).find(value => value.layerItemId === video.layerItemId)
      return item?.kind === 'native' && item.content.nativeType === 'video' ? [item.content.data.autoplay, item.content.data.loop] : null
    }).toEqual([true, true])

    await lightTools.getByRole('button', { name: '深度编辑', exact: true }).click()
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    const order = async () => slideItems(await read()).map(item => ({ id: item.layerItemId, order: item.order }))
    const orderBefore = await order()
    const handle = page.getByTestId('node-item-original-a').getByRole('button', { name: /调整.*层级/ })
    await handle.focus(); await handle.press('Space'); await page.waitForTimeout(100)
    await handle.press('ArrowUp'); await page.waitForTimeout(100)
    await handle.press('Space')
    await expect.poll(order).not.toEqual(orderBefore)
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await frame.getByTestId(`bottom-page-${seeded.flowSurfaceId}`).locator('.bottom-scene-card__main').click()
    await expect(page.getByTestId('flow-paper').first()).toBeVisible()
    const flowBefore = await read(), originalParagraph = flowBlocks(flowBefore).find(block => block.type === 'paragraph' && block.content.inlines.some(run => run.type === 'text' && run.text.includes('原有段落文字')))
    if (!originalParagraph) throw new Error('Original Flow paragraph missing')
    await page.getByTestId(`flow-block-${originalParagraph.id}`).click()
    await expect(compact.getByRole('button', { name: '二级标题', exact: true })).toBeVisible()
    await compact.getByRole('button', { name: '二级标题', exact: true }).click()
    await expect.poll(async () => flowBlocks(await read()).find(block => block.id === originalParagraph.id)?.type).toBe('heading')
    await compact.getByRole('button', { name: '正文', exact: true }).click()
    await expect.poll(async () => flowBlocks(await read()).find(block => block.id === originalParagraph.id)?.type).toBe('paragraph')

    await lightTools.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => flowBlocks(await read()).find(block => block.id === originalParagraph.id)?.type).toBe('heading')
    await lightTools.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => flowBlocks(await read()).find(block => block.id === originalParagraph.id)?.type).toBe('paragraph')
    await insert('插入音频到正文', audioFile)
    await expect.poll(async () => flowBlocks(await read()).filter(block => block.type === 'media' && block.mediaKind === 'audio').length).toBe(1)
    const audioBlock = flowBlocks(await read()).find(block => block.type === 'media' && block.mediaKind === 'audio')
    if (!audioBlock || audioBlock.type !== 'media') throw new Error('Flow audio block missing')
    await page.getByTestId(`flow-block-${audioBlock.id}`).click()
    const replacementInput = compact.locator('label.course-light-tools__file', { hasText: '替换媒体' }).locator('input[type="file"]')
    await expect(replacementInput).toHaveCount(1)
    await replacementInput.setInputFiles(replacementAudio)
    await expect.poll(async () => {
      const block = flowBlocks(await read()).find(value => value.id === audioBlock.id)
      return block?.type === 'media' ? block.assetId : null
    }).not.toBe(audioBlock.assetId)
    await lightTools.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await read()).dirty).toBe(false)
    const saved = await read(), archive = openCourseProjectArchive(new Uint8Array(readFileSync(courseFile)))
    expect(archive.project).toEqual(project(saved))
    const replaced = slideItems(saved).find(item => item.layerItemId === manualImage.layerItemId)
    if (!replaced || replaced.kind !== 'native' || replaced.content.nativeType !== 'image') throw new Error('Replaced image missing')
    expect(Buffer.from(archive.assetFiles[replaced.content.data.assetId]!)).toEqual(readFileSync(replacementFile))
    const replacedAudio = flowBlocks(saved).find(block => block.id === audioBlock.id)
    if (!replacedAudio || replacedAudio.type !== 'media') throw new Error('Replaced Flow audio missing')
    expect(Buffer.from(archive.assetFiles[replacedAudio.assetId]!)).toEqual(readFileSync(replacementAudio))
    await page.locator('.workspace-document-tabs').getByRole('button', { name: `关闭 ${filename}`, exact: true }).click()
    await tree.getByRole('button', { name: filename, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('UI reopen did not create a new DocumentSession')
    documentId = reopenedId
    const reopened = await read()
    expect(reopened.model).toEqual(saved.model)
    expect(reopened.dirty).toBe(false)
    expect(before.undoDepth).toBe(0)
    expect(errors).toEqual([])
    const screenshot = join(directory, 'properties-after-reopen.png')
    await page.screenshot({ path: screenshot })
    await info.attach('M03 properties after UI reopen', { path: screenshot, contentType: 'image/png' })
  } catch (error) {
    await app.firstWindow().then(page => page.screenshot({ path: join(directory, 'failure.png') })).catch(() => {})
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
