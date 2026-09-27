import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { flowCourse, openInWorkbench, root as repoRoot, solidPng, type Rect } from './helpers/g20M19Harness'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const filename = 'm16-paper-anchor.h5lesson'
const png = solidPng(96, 64, [27, 125, 110])

type Anchor = { blockId: string; offsetY: number; xRatio: number }
type Snapshot = { id: string; anchor: Anchor | null; frame: Rect; kind: string; label: string }

function fixture(directory: string) {
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const opened = openCourseProjectArchive(flowCourse())
  const project = structuredClone(opened.project)
  const flow = project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Flow fixture missing')
  flow.blocks.push(
    { id: 'm16-anchor-before', type: 'paragraph', content: { inlines: [{ type: 'text', text: '挂靠前段：' + '用于观察位置变化的正文。'.repeat(16) }] } },
    { id: 'm16-anchor-target', type: 'paragraph', content: { inlines: [{ type: 'text', text: '锚点目标段落：对象应随此段落一起移动。' }] } },
    { id: 'm16-anchor-after', type: 'paragraph', content: { inlines: [{ type: 'text', text: '挂靠后段：保留顺序和独立正文语义。' }] } },
  )
  const bytes = createCourseProjectArchive({ project, assetFiles: opened.assetFiles, componentFiles: opened.componentFiles })
  writeFileSync(join(workspace, filename), bytes)
  writeFileSync(join(directory, 'anchor.png'), png)
  return { workspace, imagePath: join(directory, 'anchor.png') }
}

async function layerSnapshot(page: Page): Promise<Snapshot[]> {
  return page.evaluate(async file => {
    const doc = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
    if (!doc || doc.model.kind !== 'course-v9') throw new Error('Flow project is not open')
    const flow = doc.model.project.surfaces.find(surface => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('Flow surface missing')
    return flow.surfaceLayerItems.map(entry => ({ id: entry.item.layerItemId, anchor: entry.paragraphAnchor ?? null,
      frame: entry.item.frame.mode === 'absolute' ? { x: entry.item.frame.x, y: entry.item.frame.y, width: entry.item.frame.width, height: entry.item.frame.height } : { x: 0, y: 0, width: 0, height: 0 },
      kind: entry.item.kind === 'native' ? entry.item.content.nativeType : entry.item.kind, label: entry.item.label }))
  }, filename)
}

async function paragraphTop(page: Page, blockId: string) {
  return page.locator(`.flow-workspace [data-flow-block-id="${blockId}"]`).evaluate(element => element.getBoundingClientRect().top)
}

async function paragraphIds(page: Page) {
  return page.evaluate(async file => {
    const doc = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
    if (!doc || doc.model.kind !== 'course-v9') throw new Error('Flow project is not open')
    const flow = doc.model.project.surfaces.find(surface => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('Flow surface missing')
    return flow.blocks.map(block => block.id)
  }, filename)
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
  await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: filename, exact: true })).toBeVisible()
  return app
}

test('M16-T02 Flow paper text and image layers follow their paragraph through edit, save, reopen and Player preview', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const output = join(repoRoot, 'output/g20/m16/paper-anchor')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const { workspace, imagePath } = fixture(directory)
  let app = await launch(directory, workspace)
  const errors: string[] = []
  let page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await openInWorkbench(page, filename)
    const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
    const body = flow.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true }).first()
    await expect(body.locator('[data-flow-block-id="m16-anchor-target"]')).toBeVisible()
    const existingLayers = await layerSnapshot(page)
    const existingIds = new Set(existingLayers.map(layer => layer.id))

    const insert = page.getByRole('button', { name: '插入', exact: true })
    await insert.click()
    const menu = page.getByLabel('插入内容')
    await menu.getByRole('button', { name: '添加文字', exact: true }).click()
    await expect.poll(async () => (await layerSnapshot(page)).filter(layer => layer.kind === 'text' && !existingIds.has(layer.id)).length).toBe(1)
    const textLayer = (await layerSnapshot(page)).find(layer => layer.kind === 'text' && !existingIds.has(layer.id))!
    expect(textLayer.anchor).toBeTruthy()
    expect(textLayer.anchor!.blockId).toBeTruthy()
    await expect(flow.locator(`[data-testid="flow-layer-card-${textLayer.id}"]`)).toBeVisible()

    await insert.click()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, imagePath)
    await page.getByLabel('插入内容').getByRole('button', { name: '添加图片', exact: true }).click()
    await expect.poll(async () => (await layerSnapshot(page)).filter(layer => layer.kind === 'image' && !existingIds.has(layer.id)).length).toBe(1)
    const imageLayer = (await layerSnapshot(page)).find(layer => layer.kind === 'image' && !existingIds.has(layer.id))!
    expect(imageLayer.anchor).toBeTruthy()
    await expect(flow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] img`)).toBeVisible()

    // A real paragraph edit above the anchored block must move the projected layer with it.
    const anchoredId = textLayer.anchor!.blockId
    const beforeTop = await paragraphTop(page, anchoredId)
    const layer = flow.locator(`[data-testid="flow-layer-card-${textLayer.id}"]`)
    const beforeLayerTop = (await layer.boundingBox())!.y
    const ids = await paragraphIds(page)
    const anchorIndex = ids.indexOf(anchoredId)
    expect(anchorIndex).toBeGreaterThan(0)
    const precedingId = ids[anchorIndex - 1]!
    const preceding = body.locator(`[data-flow-block-id="${precedingId}"]`)
    await preceding.click()
    await preceding.evaluate(element => {
      const range = document.createRange(), selection = element.ownerDocument.getSelection()
      range.selectNodeContents(element); range.collapse(true)
      selection?.removeAllRanges(); selection?.addRange(range)
    })
    await page.keyboard.insertText('新增导语使锚点段落下移。'.repeat(18))
    await expect.poll(() => paragraphTop(page, anchoredId)).toBeGreaterThan(beforeTop + 20)
    const afterTextParagraphTop = await paragraphTop(page, anchoredId)
    const afterTextLayerTop = (await layer.boundingBox())!.y
    expect(Math.abs((afterTextLayerTop - beforeLayerTop) - (afterTextParagraphTop - beforeTop))).toBeLessThan(4)
    const countBeforeInsert = (await paragraphIds(page)).length
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await paragraphIds(page)).length).toBe(countBeforeInsert + 1)
    const afterInsertParagraphTop = await paragraphTop(page, anchoredId)
    const afterInsertLayerTop = (await layer.boundingBox())!.y
    expect(afterInsertParagraphTop).toBeGreaterThan(afterTextParagraphTop)
    expect(Math.abs((afterInsertLayerTop - afterTextLayerTop) - (afterInsertParagraphTop - afterTextParagraphTop))).toBeLessThan(4)
    await page.keyboard.press('Backspace')
    await expect.poll(async () => (await paragraphIds(page)).length).toBe(countBeforeInsert)
    const afterDeleteParagraphTop = await paragraphTop(page, anchoredId)
    const afterDeleteLayerTop = (await layer.boundingBox())!.y
    expect(afterDeleteParagraphTop).toBeLessThan(afterInsertParagraphTop)
    expect(Math.abs((afterDeleteLayerTop - afterInsertLayerTop) - (afterDeleteParagraphTop - afterInsertParagraphTop))).toBeLessThan(4)
    const afterEdit = await layerSnapshot(page)
    expect(afterEdit.find(item => item.id === textLayer.id)?.anchor?.blockId).toBe(anchoredId)

    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect.poll(() => {
      try {
        const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, filename))))
        const flow = saved.project.surfaces.find(surface => surface.type === 'flow')
        if (flow?.type !== 'flow') return false
        return flow.surfaceLayerItems.some(entry => entry.item.layerItemId === textLayer.id && entry.paragraphAnchor?.blockId === anchoredId)
          && flow.surfaceLayerItems.some(entry => entry.item.layerItemId === imageLayer.id && entry.paragraphAnchor?.blockId === imageLayer.anchor!.blockId)
      } catch { return false }
    }).toBe(true)
    await app.close()
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, filename))))
    const savedFlow = saved.project.surfaces.find(surface => surface.type === 'flow')
    expect(savedFlow?.type).toBe('flow')
    if (savedFlow?.type !== 'flow') throw new Error('Saved Flow surface missing')
    expect(savedFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === textLayer.id)?.paragraphAnchor).toEqual(textLayer.anchor)
    expect(savedFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === imageLayer.id)?.paragraphAnchor).toEqual(imageLayer.anchor)

    app = await launch(directory, workspace)
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await openInWorkbench(page, filename)
    const reopenedLayers = await layerSnapshot(page)
    expect(reopenedLayers.find(item => item.id === textLayer.id)?.anchor).toEqual(textLayer.anchor)
    expect(reopenedLayers.find(item => item.id === imageLayer.id)?.anchor).toEqual(imageLayer.anchor)
    const reopenedFlow = page.locator('.flow-workspace').filter({ visible: true }).first()
    await expect(reopenedFlow.locator(`[data-testid="flow-layer-card-${textLayer.id}"]`)).toBeVisible()
    await expect(reopenedFlow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] img`)).toBeVisible()

    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect(page.locator('.course-preview-host [data-playback-view]')).toBeVisible()
    const player = page
    await expect(player.getByText('新增导语使锚点段落下移。', { exact: false })).toBeVisible()
    await expect(player.locator(`[data-flow-overlay-item="${imageLayer.id}"] img`)).toBeVisible()
    expect(errors).toEqual([])
    await page.getByRole('button', { name: '关闭预览', exact: true }).click()
    await app.close()
  } finally {
    if (app.process().exitCode === null) await app.close().catch(() => undefined)
  }
})
