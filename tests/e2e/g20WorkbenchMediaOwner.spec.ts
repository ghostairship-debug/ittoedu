import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage, addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const root = resolve(__dirname, '../..')

function mixedCourse() {
  let project = createBlankCourseProject({ title: '工作台媒体验收', includeDefaultController: false, controls: 'none' })
  const flow = addCourseFlowPage(project, { title: 'Flow 正文' })
  if (!flow.ok) throw new Error(flow.reason)
  project = flow.project
  const spatial = addCourseSpatialPage(project, { title: 'Spatial 世界' })
  if (!spatial.ok) throw new Error(spatial.reason)
  project = spatial.project
  const surfaces = {
    slide: project.surfaces.find(surface => surface.type === 'slide')?.id,
    flow: project.surfaces.find(surface => surface.type === 'flow')?.id,
    spatial: project.surfaces.find(surface => surface.type === 'spatial-2d')?.id,
  }
  if (!surfaces.slide || !surfaces.flow || !surfaces.spatial) throw new Error('Mixed fixture lost a surface')
  return { bytes: createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }), surfaces }
}

function wave(frequency = 440) {
  const samples = 8000
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * frequency * index / 8000) * 5000), true)
  return bytes
}

type SurfaceName = 'slide' | 'flow' | 'spatial'
type Fixture = Awaited<ReturnType<typeof openFixture>>

async function openFixture() {
  const course = mixedCourse()
  const output = join(root, 'output/g20/workbench-media-owner')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '工作台媒体验收.h5lesson')
  const image = join(workspace, '课堂图片.png')
  const video = join(workspace, '课堂视频.webm')
  const audio = join(workspace, '课堂声音.wav')
  const audioDrop = join(workspace, '课堂拖入声音.wav')
  writeFileSync(filename, course.bytes)
  writeFileSync(image, await sharp({ create: { width: 80, height: 60, channels: 4, background: '#e48237' } }).png().toBuffer())
  copyFileSync(join(root, 'tests/fixtures/r18CommonTasks/materials/motion.webm'), video)
  writeFileSync(audio, wave())
  writeFileSync(audioDrop, wave(660))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1540, 900)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  const tree = page.getByRole('tree', { name: '工作空间文件' })
  await tree.getByRole('button', { name: '工作台媒体验收.h5lesson', exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toHaveAttribute('data-editor-mode', 'light')
  const documentId = await frame.getAttribute('data-document-id')
  if (!documentId) throw new Error('Course editor did not bind a DocumentSession')
  return { app, page, directory, workspace, filename, image, video, audio, audioDrop, tree, frame, documentId, surfaces: course.surfaces }
}

async function closeFixture(fixture: Fixture | null) {
  if (!fixture) return
  await fixture.app.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
    app.exit(0)
  }).catch(() => undefined)
  await fixture.app.close().catch(() => undefined)
}

async function read(fixture: Fixture): Promise<DocumentSnapshot> {
  return fixture.page.evaluate(async id => window.desktopAPI!.documents!.read(id), fixture.documentId)
}

function project(snapshot: DocumentSnapshot): CourseProjectDocument {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a Course Project V9 DocumentSession')
  return snapshot.model.project
}

function slideItems(snapshot: DocumentSnapshot) {
  const surface = project(snapshot).surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Slide surface missing')
  return surface.scenes[0]!.layerItems
}

function flowBlocks(snapshot: DocumentSnapshot) {
  const surface = project(snapshot).surfaces.find(value => value.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Flow surface missing')
  return surface.blocks
}

function spatialItems(snapshot: DocumentSnapshot) {
  const surface = project(snapshot).surfaces.find(value => value.type === 'spatial-2d')
  if (!surface || surface.type !== 'spatial-2d') throw new Error('Spatial surface missing')
  return surface.world.layerItems
}

function nativeCount(snapshot: DocumentSnapshot, surface: 'slide' | 'spatial', nativeType: string) {
  const items = surface === 'slide' ? slideItems(snapshot) : spatialItems(snapshot)
  return items.filter(item => item.kind === 'native' && item.content.nativeType === nativeType).length
}

function mediaCount(snapshot: DocumentSnapshot, mediaKind: 'image' | 'video' | 'audio') {
  return flowBlocks(snapshot).filter(block => block.type === 'media' && block.mediaKind === mediaKind).length
}

function assetCount(snapshot: DocumentSnapshot, kind: 'image' | 'video' | 'audio') {
  return Object.values(project(snapshot).assets).filter(asset => asset.kind === kind).length
}

function soundCount(snapshot: DocumentSnapshot) {
  return Object.keys(project(snapshot).media.audio.sounds).length
}

async function surface(fixture: Fixture, name: SurfaceName) {
  if (name !== 'slide') {
    const card = fixture.frame.getByTestId(`bottom-page-${fixture.surfaces[name]}`)
    await card.locator('.bottom-scene-card__main').click()
  }
  await expect(fixture.page.getByTestId(name === 'slide' ? 'canvas-stage' : name === 'flow' ? 'flow-paper' : 'spatial-world-stage').first()).toBeVisible()
}

async function insert(fixture: Fixture, name: string, selectedPath?: string) {
  if (selectedPath) await fixture.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, selectedPath)
  const toolbar = fixture.frame.locator('.course-light-tools')
  await toolbar.getByRole('button', { name: '插入', exact: true }).click()
  const button = toolbar.getByRole('button', { name, exact: true })
  await expect(button).toBeEnabled()
  await button.click()
}

async function dragFromTree(fixture: Fixture, source: string, surfaceName: SurfaceName) {
  const file = fixture.tree.getByRole('button', { name: source, exact: true })
  await file.click()
  const target = fixture.page.getByTestId(surfaceName === 'slide' ? 'canvas-stage' : surfaceName === 'flow' ? 'flow-paper' : 'spatial-world-stage').first()
  await file.dragTo(target, { targetPosition: { x: 120, y: 120 } })
}

async function clickPaintedSlideObject(page: Page, object: Locator) {
  // The Player paint identifies the item, while the authoring canvas above it
  // receives the real pointer and performs selection hit testing.
  await expect(object).toBeVisible()
  await expect(page.locator('.canvas-viewport')).toHaveAttribute('data-observation-ready', 'true')
  const bounds = await object.boundingBox()
  if (!bounds) throw new Error('Slide object has no visible painted bounds')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

async function waitForWrite(fixture: Fixture, revision: number) {
  await expect.poll(async () => (await read(fixture)).revision).toBeGreaterThan(revision)
  const next = await read(fixture)
  expect(next.dirty).toBe(true)
  return next
}

async function saveAndReopen(fixture: Fixture) {
  await fixture.frame.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await read(fixture)).dirty).toBe(false)
  const saved = await read(fixture)
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(fixture.filename)))
  expect(archive.project).toEqual(project(saved))
  const originalFiles = new Map([
    ['课堂图片.png', fixture.image], ['课堂视频.webm', fixture.video],
    ['课堂声音.wav', fixture.audio], ['课堂拖入声音.wav', fixture.audioDrop],
  ])
  for (const [assetId, asset] of Object.entries(project(saved).assets)) {
    expect(archive.assetFiles[assetId]?.byteLength).toBe(asset.byteLength)
    const original = originalFiles.get(asset.filename)
    if (original) expect(Buffer.from(archive.assetFiles[assetId]!)).toEqual(readFileSync(original))
  }
  const tabs = fixture.page.locator('.workspace-document-tabs')
  const tab = tabs.getByRole('tab', { name: /^工作台媒体验收\.h5lesson/ })
  await tabs.getByRole('button', { name: '关闭 工作台媒体验收.h5lesson', exact: true }).click()
  await expect(tab).toHaveCount(0)
  await fixture.tree.getByRole('button', { name: '工作台媒体验收.h5lesson', exact: true }).dblclick()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const reopenedId = await fixture.frame.getAttribute('data-document-id')
  if (!reopenedId || reopenedId === fixture.documentId) throw new Error('UI reopen did not create a new DocumentSession')
  fixture.documentId = reopenedId
  const reopened = await read(fixture)
  expect(reopened.dirty).toBe(false)
  expect(reopened.model).toEqual(saved.model)
  return { saved, reopened, archive }
}

test('M03-T07 Slide: four insert actions, inline property, tree media, History and reopen', async () => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  let fixture: Fixture | null = null
  try {
    fixture = await openFixture()
    await surface(fixture, 'slide')
    const initial = await read(fixture)
    await insert(fixture, '添加文字')
    const text = await waitForWrite(fixture, initial.revision)
    expect(nativeCount(text, 'slide', 'text')).toBe(nativeCount(initial, 'slide', 'text') + 1)
    await expect.poll(async () => fixture!.page.locator('.canvas-viewport').evaluate(viewport => {
      const stage = viewport.querySelector('.canvas-stage-stack')?.getBoundingClientRect()
      const available = viewport.getBoundingClientRect()
      return Boolean(stage && stage.width <= available.width + 1 && stage.height <= available.height + 1)
    })).toBe(true)
    // The new text is selected by the insert action; its compact property editor writes through the same owner.
    await fixture.page.keyboard.press('Escape')
    const textItem = slideItems(text).find(item => item.kind === 'native' && item.content.nativeType === 'text')
    if (!textItem) throw new Error('Inserted Slide text not found')
    await clickPaintedSlideObject(fixture.page, fixture.page.locator(`[data-slide-layer-item="${textItem.layerItemId}"]:visible`).first())
    const x = fixture.frame.locator('.course-light-tools__selection').getByLabel('X', { exact: true })
    await expect(x).toBeVisible()
    const nextX = Math.round(textItem.frame.x) + 24
    await x.fill(String(nextX)); await x.press('Tab')
    await expect.poll(async () => {
      const item = slideItems(await read(fixture!)).find(value => value.layerItemId === textItem.layerItemId)
      return item?.frame.x
    }).toBe(nextX)
    let previous = await read(fixture)
    await insert(fixture, '添加图片', fixture.image)
    let current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'slide', 'image')).toBe(nativeCount(previous, 'slide', 'image') + 1)
    const imageItem = slideItems(current).find(item => item.kind === 'native' && item.content.nativeType === 'image')
    if (!imageItem || imageItem.kind !== 'native' || imageItem.content.nativeType !== 'image') throw new Error('Inserted Slide image not found')
    await clickPaintedSlideObject(fixture.page, fixture.page.locator(`[data-slide-layer-item="${imageItem.layerItemId}"]:visible`).first())
    const selectionToolbar = fixture.page.getByRole('toolbar', { name: '选中对象快捷工具' })
    await selectionToolbar.getByRole('button', { name: '属性', exact: true }).click()
    const crop = fixture.page.locator('details[aria-label="图片裁剪"]')
    await crop.locator('summary').click()
    await crop.getByRole('slider', { name: '左裁剪' }).press('ArrowRight')
    await expect.poll(async () => {
      const item = slideItems(await read(fixture!)).find(value => value.layerItemId === imageItem.layerItemId)
      return item?.kind === 'native' && item.content.nativeType === 'image' ? item.content.data.crop.left : null
    }).toBe(0.01)
    const croppedLeft = 0.01
    previous = await read(fixture)
    await insert(fixture, '添加视频', fixture.video)
    current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'slide', 'video')).toBe(nativeCount(previous, 'slide', 'video') + 1)
    previous = current
    await insert(fixture, '导入音频到声音库', fixture.audio)
    current = await waitForWrite(fixture, previous.revision)
    expect(soundCount(current)).toBe(soundCount(previous) + 1)
    expect(nativeCount(current, 'slide', 'audio')).toBe(0)
    previous = current
    await dragFromTree(fixture, '课堂图片.png', 'slide')
    current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'slide', 'image')).toBe(nativeCount(previous, 'slide', 'image') + 1)
    expect(assetCount(current, 'image')).toBe(assetCount(previous, 'image')) // same file is deduplicated
    previous = current
    await dragFromTree(fixture, '课堂拖入声音.wav', 'slide')
    current = await waitForWrite(fixture, previous.revision)
    expect(soundCount(current)).toBe(soundCount(previous) + 1)
    expect(nativeCount(current, 'slide', 'audio')).toBe(0)
    expect(current.undoDepth).toBeGreaterThan(initial.undoDepth)
    const toolbar = fixture.frame.locator('.course-light-tools')
    await toolbar.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await read(fixture!)).undoDepth).toBe(current.undoDepth - 1)
    await toolbar.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await read(fixture!)).undoDepth).toBe(current.undoDepth)
    const { saved, reopened } = await saveAndReopen(fixture)
    expect(nativeCount(reopened, 'slide', 'image')).toBe(nativeCount(saved, 'slide', 'image'))
    expect(soundCount(reopened)).toBe(soundCount(saved))
    const reopenedImage = slideItems(reopened).find(item => item.layerItemId === imageItem.layerItemId)
    expect(reopenedImage?.kind === 'native' && reopenedImage.content.nativeType === 'image' ? reopenedImage.content.data.crop.left : null).toBe(croppedLeft)
  } finally { await closeFixture(fixture) }
})

test('M03-T07 Flow: text and all media become body blocks, including tree audio', async () => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  let fixture: Fixture | null = null
  try {
    fixture = await openFixture()
    await surface(fixture, 'flow')
    const initial = await read(fixture)
    await insert(fixture, '添加文字')
    let current = await waitForWrite(fixture, initial.revision)
    expect(flowBlocks(current).filter(block => block.type === 'paragraph').length)
      .toBe(flowBlocks(initial).filter(block => block.type === 'paragraph').length + 1)
    let previous = current
    await insert(fixture, '添加图片', fixture.image)
    current = await waitForWrite(fixture, previous.revision)
    expect(mediaCount(current, 'image')).toBe(mediaCount(previous, 'image') + 1)
    previous = current
    await insert(fixture, '添加视频', fixture.video)
    current = await waitForWrite(fixture, previous.revision)
    expect(mediaCount(current, 'video')).toBe(mediaCount(previous, 'video') + 1)
    previous = current
    await insert(fixture, '插入音频到正文', fixture.audio)
    current = await waitForWrite(fixture, previous.revision)
    expect(mediaCount(current, 'audio')).toBe(mediaCount(previous, 'audio') + 1)
    expect(soundCount(current)).toBe(soundCount(previous))
    previous = current
    await dragFromTree(fixture, '课堂图片.png', 'flow')
    current = await waitForWrite(fixture, previous.revision)
    expect(mediaCount(current, 'image')).toBe(mediaCount(previous, 'image') + 1)
    previous = current
    await dragFromTree(fixture, '课堂拖入声音.wav', 'flow')
    current = await waitForWrite(fixture, previous.revision)
    expect(mediaCount(current, 'audio')).toBe(mediaCount(previous, 'audio') + 1)
    expect(soundCount(current)).toBe(soundCount(previous))
    expect(current.undoDepth).toBeGreaterThan(initial.undoDepth)
    const { saved, reopened } = await saveAndReopen(fixture)
    expect(flowBlocks(reopened)).toEqual(flowBlocks(saved))
    expect(mediaCount(reopened, 'audio')).toBe(mediaCount(saved, 'audio'))
  } finally { await closeFixture(fixture) }
})

test('M03-T07 M10-T06 Spatial world: four insert actions and tree media; multi-file drop rejects without a write', async () => {
  test.skip(process.platform !== 'win32', 'Owner acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  let fixture: Fixture | null = null
  try {
    fixture = await openFixture()
    await surface(fixture, 'spatial')
    const initial = await read(fixture)
    await insert(fixture, '添加文字')
    let current = await waitForWrite(fixture, initial.revision)
    expect(nativeCount(current, 'spatial', 'text')).toBe(nativeCount(initial, 'spatial', 'text') + 1)
    let previous = current
    await insert(fixture, '添加图片', fixture.image)
    current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'spatial', 'image')).toBe(nativeCount(previous, 'spatial', 'image') + 1)
    previous = current
    await insert(fixture, '添加视频', fixture.video)
    current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'spatial', 'video')).toBe(nativeCount(previous, 'spatial', 'video') + 1)
    previous = current
    await insert(fixture, '导入音频到声音库', fixture.audio)
    current = await waitForWrite(fixture, previous.revision)
    expect(soundCount(current)).toBe(soundCount(previous) + 1)
    expect(nativeCount(current, 'spatial', 'audio')).toBe(0)
    previous = current
    await dragFromTree(fixture, '课堂视频.webm', 'spatial')
    current = await waitForWrite(fixture, previous.revision)
    expect(nativeCount(current, 'spatial', 'video')).toBe(nativeCount(previous, 'spatial', 'video') + 1)
    expect(assetCount(current, 'video')).toBe(assetCount(previous, 'video'))
    previous = current
    await dragFromTree(fixture, '课堂拖入声音.wav', 'spatial')
    current = await waitForWrite(fixture, previous.revision)
    expect(soundCount(current)).toBe(soundCount(previous) + 1)
    expect(nativeCount(current, 'spatial', 'audio')).toBe(0)
    const image = fixture.tree.getByRole('button', { name: '课堂图片.png', exact: true })
    const video = fixture.tree.getByRole('button', { name: '课堂视频.webm', exact: true })
    await image.click(); await video.click({ modifiers: ['Control'] })
    await image.dragTo(fixture.page.getByTestId('spatial-world-stage').first(), { targetPosition: { x: 120, y: 120 } })
    await expect(fixture.page.getByText('请一次拖入一个媒体文件；多文件尚不能作为同一笔插入。')).toBeVisible()
    const rejected = await read(fixture)
    expect(rejected.revision).toBe(current.revision)
    expect(rejected.undoDepth).toBe(current.undoDepth)
    expect(project(rejected).assets).toEqual(project(current).assets)
    const { saved, reopened } = await saveAndReopen(fixture)
    expect(spatialItems(reopened)).toEqual(spatialItems(saved))
    expect(soundCount(reopened)).toBe(soundCount(saved))
  } finally { await closeFixture(fixture) }
})
