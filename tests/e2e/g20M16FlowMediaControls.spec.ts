import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { closeSelectionApp } from './helpers/g20SelectionHarness'
import { flowCourseWithFigure } from './helpers/g20M21Harness'
import { openInWorkbench, root, solidPng } from './helpers/g20M19Harness'

const filename = 'm16-media-controls.h5lesson'
const replacement = solidPng(640, 320, [225, 72, 84])

function fixture() {
  const base = join(root, 'output/g20/m16/media-controls')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, filename), flowCourseWithFigure())
  const imagePath = join(directory, 'replacement.png')
  writeFileSync(imagePath, replacement)
  return { directory, workspace, shots, imagePath }
}

async function launch(directory: string, workspace: string): Promise<ElectronApplication> {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 1000))
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
  if (!(await page.getByRole('tree', { name: '工作空间文件' }).count())) {
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  }
  await openInWorkbench(page, filename)
  return app
}

async function snapshot(page: Page): Promise<DocumentSnapshot> {
  const entry = (await page.evaluate(() => window.desktopAPI.documents!.list())).find(item => item.binding.kind === 'file' && item.binding.path.endsWith(filename))
  if (!entry) throw new Error('Media course is not open')
  return page.evaluate(id => window.desktopAPI.documents!.read(id), entry.documentId)
}

function flow(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected Course V9')
  const surface = snapshot.model.project.surfaces.find(item => item.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Flow surface missing')
  return surface
}

async function imageBlock(page: Page) {
  const block = flow(await snapshot(page)).blocks.find(item => item.type === 'media' && item.mediaKind === 'image')
  if (!block || block.type !== 'media') throw new Error('Document image missing')
  return block
}

async function selectImage(page: Page) {
  const image = page.locator('.flow-workspace').filter({ visible: true }).first().locator('figure[data-document-id="flow-media"] img').first()
  await image.scrollIntoViewIfNeeded()
  await image.click()
  await expect(page.getByRole('toolbar', { name: '选中内容快捷工具' })).toBeVisible()
  return image
}

async function contextImage(page: Page) {
  const image = await selectImage(page)
  await image.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '对象操作' })
  await expect(menu).toBeVisible()
  return menu
}

test('M16-T06 Flow image layout, caption, crop and replacement persist in light and full editor', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const data = fixture(), app = await launch(data.directory, data.workspace), page = await app.firstWindow()
  const evidence: Record<string, unknown> = { test: 'layout-caption-crop-replace', screenshots: [] }
  try {
    const initial = await imageBlock(page), initialId = initial.id, initialAssetId = initial.assetId
    const figure = page.locator('.flow-workspace').filter({ visible: true }).first().locator('figure[data-document-id="flow-media"]').first()
    const choices = [
      ['正文宽', 'content-width', 'none'], ['宽幅', 'wide', 'none'], ['通栏', 'full-width', 'none'],
      ['左环绕', 'full-width', 'left'], ['右环绕', 'full-width', 'right'],
    ] as const
    const widths: Partial<Record<(typeof choices)[number][0], number>> = {}
    for (const [label, layout, wrap] of choices) {
      const menu = await contextImage(page)
      await menu.getByRole('menuitem', { name: label, exact: true }).click()
      await expect.poll(async () => ({ layout: (await imageBlock(page)).layout, wrap: (await imageBlock(page)).wrap })).toEqual({ layout, wrap })
      await expect(figure).toHaveAttribute('data-flow-media-layout', layout)
      expect(await figure.evaluate(node => getComputedStyle(node).cssFloat)).toBe(wrap === 'none' ? 'none' : wrap)
      const box = await figure.boundingBox()
      expect(box?.width).toBeGreaterThan(0)
      widths[label] = box!.width
      const current = await snapshot(page)
      await page.evaluate(async id => { await window.desktopAPI.documents!.save(id) }, current.documentId)
      const archiveAtChoice = openCourseProjectArchive(new Uint8Array(readFileSync(join(data.workspace, filename))))
      const savedFlow = archiveAtChoice.project.surfaces.find(item => item.type === 'flow')
      const savedImage = savedFlow?.type === 'flow' ? savedFlow.blocks.find(item => item.id === initialId) : undefined
      expect(savedImage).toEqual(expect.objectContaining({ type: 'media', layout, wrap, assetId: initialAssetId }))
    }
    expect(widths['宽幅']!).toBeGreaterThan(widths['正文宽']!)
    expect(widths['通栏']!).toBeGreaterThan(widths['宽幅']!)
    evidence.widths = widths
    await page.screenshot({ path: join(data.shots, 'right-wrap.png') })
    ;(evidence.screenshots as string[]).push('right-wrap.png')
    const captionMenu = await contextImage(page)
    await captionMenu.getByRole('menuitem', { name: '说明文字', exact: true }).click()
    const caption = figure.locator('[data-document-slot="caption"]')
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.insertText('课堂图片说明')
    await expect.poll(async () => JSON.stringify((await imageBlock(page)).caption)).toContain('课堂图片说明')
    await page.screenshot({ path: join(data.shots, 'caption.png') })
    ;(evidence.screenshots as string[]).push('caption.png')
    await selectImage(page)
    await page.getByRole('toolbar', { name: '选中内容快捷工具' }).getByRole('button', { name: '裁剪图片' }).click()
    const crop = page.getByRole('dialog', { name: '裁剪正文图片' })
    await expect(crop).toBeVisible()
    const leftCrop = crop.getByLabel('左裁剪')
    await leftCrop.focus()
    for (let step = 0; step < 20; step += 1) await leftCrop.press('ArrowRight')
    await expect(leftCrop).toHaveValue('0.2')
    await crop.getByRole('button', { name: '确认裁剪' }).click()
    await expect.poll(async () => (await imageBlock(page)).crop?.left).toBe(0.2)
    await expect(figure.locator('[data-flow-media-kind="image"]')).toBeVisible()
    await page.screenshot({ path: join(data.shots, 'cropped.png') })
    ;(evidence.screenshots as string[]).push('cropped.png')
    await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(page.locator('.course-editor-frame').first()).toHaveAttribute('data-editor-mode', 'deep')
    await app.evaluate(({ dialog }, imagePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] }) }, data.imagePath)
    const bar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
    await selectImage(page)
    const bodyChooser = page.waitForEvent('filechooser')
    await bar.getByRole('button', { name: '替换图片', exact: true }).click()
    await (await bodyChooser).setFiles(data.imagePath)
    await expect.poll(async () => (await imageBlock(page)).assetId).not.toBe(initialAssetId)
    const changed = await imageBlock(page)
    expect(changed.id).toBe(initialId)
    expect(changed.layout).toBe('full-width')
    expect(changed.wrap).toBe('right')
    expect(changed.crop?.left).toBe(0.2)
    expect(JSON.stringify(changed.caption)).toContain('课堂图片说明')
    await expect(figure.locator('img')).toHaveJSProperty('naturalWidth', 640)
    await page.screenshot({ path: join(data.shots, 'replaced-full-editor.png') })
    ;(evidence.screenshots as string[]).push('replaced-full-editor.png')
    const open = await snapshot(page)
    await page.evaluate(async id => { await window.desktopAPI.documents!.save(id) }, open.documentId)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(data.workspace, filename))))
    const saved = archive.project.surfaces.find(item => item.type === 'flow')
    expect(saved?.type).toBe('flow')
    if (!saved || saved.type !== 'flow') throw new Error('Saved Flow missing')
    const savedImage = saved.blocks.find(item => item.id === initialId)
    expect(savedImage).toEqual(expect.objectContaining({ type: 'media', assetId: changed.assetId, layout: 'full-width', wrap: 'right' }))
    expect(JSON.stringify(savedImage)).toContain('课堂图片说明')
    expect(Object.keys(archive.assetFiles)).toContain(changed.assetId)
    evidence.final = { id: changed.id, assetId: changed.assetId, layout: changed.layout, wrap: changed.wrap, crop: changed.crop }
  } finally {
    writeFileSync(join(data.directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await closeSelectionApp(app)
  }
})

test('M16-T06 document image converts to anchored paper image and back without losing the asset or caption', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(240_000)
  const data = fixture(), app = await launch(data.directory, data.workspace), page = await app.firstWindow()
  const evidence: Record<string, unknown> = { test: 'body-paper-body', screenshots: [] }
  try {
    const before = await imageBlock(page)
    const menu = await contextImage(page)
    await menu.getByRole('menuitem', { name: '说明文字', exact: true }).click()
    const caption = page.locator('.flow-workspace').filter({ visible: true }).first().locator('figure[data-document-id="flow-media"] [data-document-slot="caption"]').first()
    await caption.click()
    await page.keyboard.insertText('转换保留说明')
    await expect.poll(async () => JSON.stringify((await imageBlock(page)).caption)).toContain('转换保留说明')
    await selectImage(page)
    await page.getByRole('toolbar', { name: '选中内容快捷工具' }).getByRole('button', { name: '裁剪图片' }).click()
    const crop = page.getByRole('dialog', { name: '裁剪正文图片' })
    const left = crop.getByLabel('左裁剪')
    await left.focus()
    for (let step = 0; step < 10; step += 1) await left.press('ArrowRight')
    await crop.getByRole('button', { name: '确认裁剪' }).click()
    await expect.poll(async () => (await imageBlock(page)).crop?.left).toBe(0.1)
    const convert = await contextImage(page)
    await convert.getByRole('menuitem', { name: '改为浮动', exact: true }).click()
    await expect.poll(async () => flow(await snapshot(page)).blocks.some(item => item.id === before.id)).toBe(false)
    const floating = flow(await snapshot(page)).surfaceLayerItems.find(entry => entry.item.kind === 'native' && entry.item.content.nativeType === 'image'
      && entry.item.content.data.assetId === before.assetId)
    expect(floating?.paragraphAnchor?.blockId).toBeTruthy()
    expect(floating?.item.paperSpace).toBe('paper')
    expect(floating?.item.frame.mode).toBe('absolute')
    expect(floating?.item.kind === 'native' && floating.item.content.nativeType === 'image' ? floating.item.content.data.crop.left : null).toBe(0.1)
    const layerId = floating!.item.layerItemId
    const card = page.getByTestId(`flow-layer-card-${layerId}`)
    await expect(card).toBeVisible()
    await page.screenshot({ path: join(data.shots, 'floating.png') })
    ;(evidence.screenshots as string[]).push('floating.png')
    await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    const editorInsert = page.getByTestId('elements-tab').getByRole('menu', { name: 'Flow 插入菜单' })
    await expect(editorInsert.locator('[data-flow-insert-destination="document"]')).toHaveCount(11)
    await expect(editorInsert.locator('[data-flow-insert-destination="paper"]')).toHaveCount(4)
    await expect(editorInsert.getByRole('menuitem', { name: /屏幕|浮层/ })).toHaveCount(0)
    await card.click()
    const properties = page.getByRole('button', { name: '属性与素材', exact: true })
    if (await properties.getAttribute('aria-expanded') !== 'true') await properties.click()
    await page.getByRole('tab', { name: '属性', exact: true }).click()
    const overlayBeforeReplace = flow(await snapshot(page)).surfaceLayerItems.find(entry => entry.item.layerItemId === layerId)!
    const overlayChooser = page.waitForEvent('filechooser')
    await page.getByTestId('properties-tab').getByRole('button', { name: '替换图片', exact: true }).click()
    await (await overlayChooser).setFiles(data.imagePath)
    await expect.poll(async () => {
      const current = flow(await snapshot(page)).surfaceLayerItems.find(entry => entry.item.layerItemId === layerId)
      return current?.item.kind === 'native' && current.item.content.nativeType === 'image' ? current.item.content.data.assetId : null
    }).not.toBe(before.assetId)
    const overlayAfterReplace = flow(await snapshot(page)).surfaceLayerItems.find(entry => entry.item.layerItemId === layerId)!
    expect(overlayAfterReplace.paragraphAnchor).toEqual(overlayBeforeReplace.paragraphAnchor)
    expect(overlayAfterReplace.item.frame).toEqual(overlayBeforeReplace.item.frame)
    const replacementId = overlayAfterReplace.item.kind === 'native' && overlayAfterReplace.item.content.nativeType === 'image'
      ? overlayAfterReplace.item.content.data.assetId : null
    expect(replacementId).toBeTruthy()
    await expect(card.locator('canvas')).toBeVisible()
    await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 640)
    await page.screenshot({ path: join(data.shots, 'floating-replaced.png') })
    ;(evidence.screenshots as string[]).push('floating-replaced.png')
    await page.getByTestId('flow-overlay-to-document').click()
    await expect.poll(async () => flow(await snapshot(page)).surfaceLayerItems.some(entry => entry.item.layerItemId === layerId)).toBe(false)
    const returned = flow(await snapshot(page)).blocks.find(item => item.type === 'media' && item.mediaKind === 'image' && item.assetId === replacementId)
    expect(returned).toBeTruthy()
    expect(returned?.type === 'media' ? returned.crop?.left : null).toBe(0.1)
    await expect(page.locator('.flow-workspace').filter({ visible: true }).first().locator('figure[data-flow-media-layout] img').first()).toBeVisible()
    expect(JSON.stringify(flow(await snapshot(page)).blocks)).toContain('转换保留说明')
    await page.screenshot({ path: join(data.shots, 'returned.png') })
    ;(evidence.screenshots as string[]).push('returned.png')
    const open = await snapshot(page)
    await page.evaluate(async id => { await window.desktopAPI.documents!.save(id) }, open.documentId)
    await page.evaluate(async id => { await window.desktopAPI.documents!.close(id) }, open.documentId)
    const reopened = await page.evaluate(path => window.desktopAPI.documents!.open(path), join(data.workspace, filename))
    expect(reopened.model.kind).toBe('course-v9')
    expect(flow(reopened).blocks.some(item => item.type === 'media' && item.assetId === replacementId)).toBe(true)
    expect(JSON.stringify(flow(reopened).blocks)).toContain('转换保留说明')
    evidence.final = { originalAssetId: before.assetId, replacementId, floatingLayerId: layerId, anchor: floating!.paragraphAnchor,
      returnedBlockId: returned!.id }
  } finally {
    writeFileSync(join(data.directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await closeSelectionApp(app)
  }
})
