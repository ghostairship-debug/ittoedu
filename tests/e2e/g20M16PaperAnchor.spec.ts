import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { flowCourse, openInWorkbench, root, solidPng, type Rect } from './helpers/g20M19Harness'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeSelectionApp } from './helpers/g20SelectionHarness'

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
  writeFileSync(join(workspace, filename), createCourseProjectArchive({ project, assetFiles: opened.assetFiles, componentFiles: opened.componentFiles }))
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

type AnchorGeometry = { paragraphTop: number; layerTop: number; relative: number; paperTop: number; paperWidth: number; scrollTop: number }

async function anchorGeometry(page: Page, blockId: string, layerId: string): Promise<AnchorGeometry> {
  return page.locator('.flow-workspace').filter({ visible: true }).first().evaluate((workspace, ids) => {
    const paragraph = workspace.querySelector<HTMLElement>(`[data-flow-block-id="${ids.blockId}"]`)
    const layer = workspace.querySelector<HTMLElement>(`[data-testid="flow-layer-card-${ids.layerId}"]`)
    const paper = workspace.querySelector<HTMLElement>('[data-testid="flow-paper"]')
    const scroll = workspace.querySelector<HTMLElement>('[data-testid="flow-workspace-scroll"]')
    if (!paragraph || !layer || !paper || !scroll) throw new Error('Anchor geometry is not laid out')
    const paragraphTop = paragraph.getBoundingClientRect().top
    const layerTop = layer.getBoundingClientRect().top
    const paperRect = paper.getBoundingClientRect()
    return { paragraphTop, layerTop, relative: layerTop - paragraphTop, paperTop: paperRect.top,
      paperWidth: paperRect.width, scrollTop: scroll.scrollTop }
  }, { blockId, layerId })
}

async function expectAnchored(page: Page, blockId: string, layerId: string, offsetY: number,
  evidence: Record<string, unknown>, stage: string): Promise<AnchorGeometry> {
  let turn = 0
  let latest: AnchorGeometry | undefined
  await expect.poll(async () => {
    // The isolated background Electron window may need input before its pending animation frame paints.
    await page.mouse.move(1450 + (turn++ % 2), 700)
    latest = await anchorGeometry(page, blockId, layerId)
    ;(evidence.geometry as Record<string, unknown>)[stage] = latest
    return Math.abs(latest.relative - offsetY)
  }, { intervals: [200, 200, 300, 500, 800] }).toBeLessThan(4)
  return latest!
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

async function expectPaperMenu(menu: Locator) {
  await expect(menu).toBeVisible()
  const documentItems = menu.locator('[data-flow-insert-destination="document"]')
  const paperItems = menu.locator('[data-flow-insert-destination="paper"]')
  await expect(documentItems).toHaveCount(11)
  await expect(paperItems).toHaveCount(4)
  await expect(menu.locator('section[aria-label="放到纸面上"]').getByRole('menuitem', { name: '文本框', exact: true })).toBeVisible()
  await expect(menu.locator('section[aria-label="放到纸面上"]').getByRole('menuitem', { name: '图片', exact: true })).toBeVisible()
  return { documentItems: 11, paperItems: 4, paperLabels: await menu.locator('section[aria-label="放到纸面上"] [role="menuitem"]').allTextContents() }
}

async function clickParagraphStart(page: Page, paragraph: Locator) {
  const box = await paragraph.boundingBox()
  if (!box) throw new Error('Preceding paragraph is not laid out')
  await paragraph.click({ position: { x: 2, y: Math.min(8, box.height / 2) } })
  await page.keyboard.press('Home')
}

test('M16-T02 Flow paper text and image layers follow paragraphs through edit, save, reopen and Player preview', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const output = join(root, 'output/g20/m16/paper-anchor')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const shots = join(directory, 'shots')
  mkdirSync(shots)
  const { workspace, imagePath } = fixture(directory)
  const evidence: Record<string, unknown> = { run: directory, shots, modelCalls: 0, status: 'running', entryPoints: {}, geometry: {}, screenshots: [], screenshotsRequireManualReview: true }
  const errors: string[] = []
  let app: ElectronApplication | undefined = await launch(directory, workspace)
  let page: Page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await openInWorkbench(page, filename)
    const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
    const body = flow.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true }).first()
    await expect(body.locator('[data-flow-block-id="m16-anchor-target"]')).toBeVisible()
    const existingIds = new Set((await layerSnapshot(page)).map(layer => layer.id))

    // Lightweight editor insertion menu: use the 11+4 Flow contract, not legacy 添加文字/添加图片 actions.
    await page.getByRole('button', { name: '插入', exact: true }).click()
    const lightMenu = page.getByRole('menu', { name: 'Flow 插入菜单' })
    evidence.entryPoints = { light: await expectPaperMenu(lightMenu) }
    const paper = lightMenu.locator('section[aria-label="放到纸面上"]')
    await paper.getByRole('menuitem', { name: '文本框', exact: true }).click()
    await expect.poll(async () => (await layerSnapshot(page)).filter(layer => layer.kind === 'text' && !existingIds.has(layer.id)).length).toBe(1)
    const textLayer = (await layerSnapshot(page)).find(layer => layer.kind === 'text' && !existingIds.has(layer.id))!
    expect(textLayer.anchor).toBeTruthy()
    await expect(flow.locator(`[data-testid="flow-layer-card-${textLayer.id}"]`)).toBeVisible()
    await expect(flow.locator(`[data-testid="flow-layer-selection-${textLayer.id}"]`)).toBeVisible()
    await expect(flow.locator(`[data-flow-anchor-block-id="${textLayer.anchor!.blockId}"]`)).toBeVisible()
    await page.screenshot({ path: join(shots, 'authored-anchor-visible.png') })
    ;(evidence.screenshots as string[]).push('shots/authored-anchor-visible.png')

    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, imagePath)
    await page.getByRole('button', { name: '插入', exact: true }).click()
    const imageMenu = page.getByRole('menu', { name: 'Flow 插入菜单' }).locator('section[aria-label="放到纸面上"]')
    await imageMenu.getByRole('menuitem', { name: '图片', exact: true }).click()
    await expect.poll(async () => (await layerSnapshot(page)).filter(layer => layer.kind === 'image' && !existingIds.has(layer.id)).length).toBe(1)
    const imageLayer = (await layerSnapshot(page)).find(layer => layer.kind === 'image' && !existingIds.has(layer.id))!
    expect(imageLayer.anchor).toBeTruthy()
    await expect(flow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] canvas`)).toBeVisible()
    await expect(flow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] img`)).toHaveJSProperty('naturalWidth', 96)

    // Also prove that the same 11+4 paper insertion menu is reachable from the full editor's Elements rail.
    await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await page.getByRole('tab', { name: '元素', exact: true }).click()
    const fullMenu = page.getByTestId('elements-tab').getByRole('menu', { name: 'Flow 插入菜单' })
    evidence.entryPoints = { ...(evidence.entryPoints as object), full: await expectPaperMenu(fullMenu) }
    await page.screenshot({ path: join(shots, 'full-editor-paper-menu.png') })
    ;(evidence.screenshots as string[]).push('shots/full-editor-paper-menu.png')
    await openInWorkbench(page, filename)

    const anchoredId = textLayer.anchor!.blockId
    const before = await expectAnchored(page, anchoredId, textLayer.id, textLayer.anchor!.offsetY, evidence, 'text-before')
    await expectAnchored(page, imageLayer.anchor!.blockId, imageLayer.id, imageLayer.anchor!.offsetY, evidence, 'image-before')
    const ids = await paragraphIds(page)
    const anchorIndex = ids.indexOf(anchoredId)
    expect(anchorIndex).toBeGreaterThan(0)
    const preceding = body.locator(`[data-flow-block-id="${ids[anchorIndex - 1]}"]`)
    await clickParagraphStart(page, preceding)
    await page.keyboard.insertText('新增导语使锚点段落下移。'.repeat(18))
    const afterText = await expectAnchored(page, anchoredId, textLayer.id, textLayer.anchor!.offsetY, evidence, 'text-after-input')
    await expectAnchored(page, imageLayer.anchor!.blockId, imageLayer.id, imageLayer.anchor!.offsetY, evidence, 'image-after-input')
    expect(afterText.paragraphTop).toBeGreaterThan(before.paragraphTop + 20)
    expect(Math.abs((afterText.layerTop - before.layerTop) - (afterText.paragraphTop - before.paragraphTop))).toBeLessThan(4)
    const countBeforeInsert = (await paragraphIds(page)).length
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await paragraphIds(page)).length).toBe(countBeforeInsert + 1)
    const afterInsert = await expectAnchored(page, anchoredId, textLayer.id, textLayer.anchor!.offsetY, evidence, 'text-after-enter')
    await expectAnchored(page, imageLayer.anchor!.blockId, imageLayer.id, imageLayer.anchor!.offsetY, evidence, 'image-after-enter')
    expect(afterInsert.paragraphTop).toBeGreaterThan(afterText.paragraphTop)
    expect(Math.abs((afterInsert.layerTop - afterText.layerTop) - (afterInsert.paragraphTop - afterText.paragraphTop))).toBeLessThan(4)
    await page.keyboard.press('Backspace')
    await expect.poll(async () => (await paragraphIds(page)).length).toBe(countBeforeInsert)
    const afterDelete = await expectAnchored(page, anchoredId, textLayer.id, textLayer.anchor!.offsetY, evidence, 'text-after-backspace')
    await expectAnchored(page, imageLayer.anchor!.blockId, imageLayer.id, imageLayer.anchor!.offsetY, evidence, 'image-after-backspace')
    expect(afterDelete.paragraphTop).toBeLessThan(afterInsert.paragraphTop)
    expect(Math.abs((afterDelete.layerTop - afterInsert.layerTop) - (afterDelete.paragraphTop - afterInsert.paragraphTop))).toBeLessThan(4)
    expect((await layerSnapshot(page)).find(item => item.id === textLayer.id)?.anchor?.blockId).toBe(anchoredId)

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
    await closeSelectionApp(app); app = undefined
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
    await expect(reopenedFlow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] canvas`)).toBeVisible()
    await expect(reopenedFlow.locator(`[data-testid="flow-layer-card-${imageLayer.id}"] img`)).toHaveJSProperty('naturalWidth', 96)

    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect(page.locator('.course-preview-host [data-playback-view]')).toBeVisible()
    await expect(page.getByTestId('flow-runtime-article')).toContainText('新增导语使锚点段落下移。')
    await expect(page.locator(`[data-flow-overlay-item="${imageLayer.id}"] canvas`)).toBeVisible()
    await expect(page.locator(`[data-flow-overlay-item="${imageLayer.id}"] img`)).toHaveJSProperty('naturalWidth', 96)
    await page.screenshot({ path: join(shots, 'player-paper-anchor-visible.png') })
    ;(evidence.screenshots as string[]).push('shots/player-paper-anchor-visible.png')
    expect(errors).toEqual([])
    await page.getByRole('button', { name: '关闭预览', exact: true }).click()
    evidence.status = 'e2e-assertions-completed-screenshot-review-pending'
  } catch (error) {
    evidence.status = 'failed'
    evidence.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(shots, 'final-state.png') }).catch(() => undefined)
      ;(evidence.screenshots as string[]).push('shots/final-state.png')
    }
    evidence.pageErrors = errors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8')
    if (app && app.process().exitCode === null) await closeSelectionApp(app).catch(() => undefined)
  }
})
