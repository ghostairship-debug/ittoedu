import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { componentPackagesToArchiveFiles } from '../../src/renderer/components/componentPackageStore'
import { closeSelectionApp } from './helpers/g20SelectionHarness'
import { flowCourse, root, solidPng, openInWorkbench } from './helpers/g20M19Harness'

const name = 'm16-layers-completion.h5lesson'
const ids = { before: 'm16-completion-before', target: 'm16-completion-target', after: 'm16-completion-after' }
const image = solidPng(96, 64, [36, 91, 70])
type Layer = { id: string; kind: string; frame: { x: number; y: number; width: number; height: number }; anchor: { blockId: string; offsetY: number; xRatio: number } | null; paperSpace: string | null; bodyPlane: string | null; order: number }

function makeFixture(directory: string) {
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const opened = openCourseProjectArchive(flowCourse())
  const project = structuredClone(opened.project)
  const component = importComponentPackage(new Uint8Array(readFileSync(join(root, 'resources/built-in-components/packages/text-container.h5component'))))
  project.componentPackages[component.manifest.id] = component.metadata
  const flow = project.surfaces.find(surface => surface.type === 'flow')
  if (flow?.type !== 'flow') throw new Error('Flow fixture missing')
  flow.blocks.splice(1, 0,
    { id: ids.before, type: 'paragraph', content: { inlines: [{ type: 'text', text: '前一段。'.repeat(15) }] } },
    { id: ids.target, type: 'paragraph', content: { inlines: [{ type: 'text', text: '图层目标段落。'.repeat(8) }] } },
    { id: ids.after, type: 'paragraph', content: { inlines: [{ type: 'text', text: '后一段。'.repeat(12) }] } },
  )
  const baseline = flow.surfaceLayerItems.map(entry => ({ id: entry.item.layerItemId, anchor: entry.paragraphAnchor, paperSpace: entry.item.paperSpace, frame: structuredClone(entry.item.frame) }))
  writeFileSync(join(workspace, name), createCourseProjectArchive({ project, assetFiles: opened.assetFiles,
    componentFiles: { ...opened.componentFiles, ...componentPackagesToArchiveFiles({ [component.manifest.id]: component }) } }))
  writeFileSync(join(directory, 'image.png'), image)
  return { workspace, imagePath: join(directory, 'image.png'), baseline }
}

async function launch(directory: string, workspace: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 1000))
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
  if (!(await page.getByRole('tree', { name: '工作空间文件' }).count())) {
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  }
  await openInWorkbench(page, name)
  return { app, page }
}

async function model(page: Page) {
  return page.evaluate(async filename => {
    const document = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(filename))
    if (document?.model.kind !== 'course-v9') throw new Error('Course document unavailable')
    const flow = document.model.project.surfaces.find(surface => surface.type === 'flow')
    if (flow?.type !== 'flow') throw new Error('Flow surface unavailable')
    return { revision: document.model.project.revision, blocks: flow.blocks.map(block => ({ id: block.id, type: block.type })),
      layers: flow.surfaceLayerItems.map(entry => ({ id: entry.item.layerItemId, kind: entry.item.kind === 'native' ? entry.item.content.nativeType : entry.item.kind,
        frame: entry.item.frame.mode === 'absolute' ? { x: entry.item.frame.x, y: entry.item.frame.y, width: entry.item.frame.width, height: entry.item.frame.height } : { x: 0, y: 0, width: 0, height: 0 },
        anchor: entry.paragraphAnchor ?? null, paperSpace: entry.item.paperSpace ?? null, bodyPlane: entry.bodyPlane ?? null, order: entry.item.order }))
    }
  }, name)
}

async function layer(page: Page, id: string): Promise<Layer> {
  const found = (await model(page)).layers.find(entry => entry.id === id)
  if (!found) throw new Error(`Layer ${id} missing`)
  return found
}

async function geometry(page: Page, blockId: string, layerId: string) {
  return page.locator('.flow-workspace').filter({ visible: true }).first().evaluate((workspace, input) => {
    const paper = workspace.querySelector<HTMLElement>('[data-testid="flow-paper"]')
    const block = workspace.querySelector<HTMLElement>(`[data-flow-block-id="${input.blockId}"]`)
    const card = workspace.querySelector<HTMLElement>(`[data-testid="flow-layer-card-${input.layerId}"]`)
    if (!paper || !block || !card) throw new Error('Flow geometry missing')
    const p = paper.getBoundingClientRect(), b = block.getBoundingClientRect(), c = card.getBoundingClientRect()
    return { paperWidth: p.width, xRatio: (c.left - p.left) / p.width, blockTop: b.top, layerTop: c.top, offsetY: c.top - b.top }
  }, { blockId, layerId })
}

async function insertPaper(page: Page, kind: '文本框' | '图片' | '形状') {
  const before = new Set((await model(page)).layers.map(entry => entry.id))
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await page.getByRole('menu', { name: 'Flow 插入菜单' }).locator('section[aria-label="放到纸面上"]').getByRole('menuitem', { name: kind, exact: true }).click()
  const nativeType = kind === '文本框' ? 'text' : kind === '图片' ? 'image' : 'shape'
  await expect.poll(async () => (await model(page)).layers.filter(entry => !before.has(entry.id) && entry.kind === nativeType).length).toBe(1)
  const inserted = (await model(page)).layers.find(entry => !before.has(entry.id) && entry.kind === nativeType)!
  expect(inserted.paperSpace).toBe('paper')
  expect(inserted.anchor).not.toBeNull()
  return inserted
}

async function drag(page: Page, selector: string, dx: number, dy: number, onMove?: () => Promise<void>) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`Drag target ${selector} not visible`)
  const x = box.x + Math.min(25, box.width / 3), y = box.y + Math.min(25, box.height / 3)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 })
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  if (onMove) await onMove()
  await page.mouse.up()
}

test('M16-T01 paragraph creation and paper Native Text have independent transform and history', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/m16/t01-t02-completion'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const { workspace } = makeFixture(directory)
  const evidence: Record<string, unknown> = { case: 'M16-T01', run: directory, status: 'running' }
  let app: ElectronApplication | undefined
  try {
    let launched = await launch(directory, workspace); app = launched.app; let page = launched.page
    const body = page.locator('.flow-workspace').filter({ visible: true }).getByRole('textbox', { name: '正文编辑' }).first()
    const paragraph = body.locator(`[data-flow-block-id="${ids.target}"]`)
    const originalBlocks = (await model(page)).blocks.length
    await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('新段落仍是文档正文')
    await expect.poll(async () => (await model(page)).blocks.length).toBe(originalBlocks + 1)
    const afterBody = await model(page)
    expect(afterBody.blocks.some(block => block.id !== ids.target && block.type === 'paragraph')).toBe(true)
    const bodyCount = afterBody.blocks.length
    const text = await insertPaper(page, '文本框')
    expect((await model(page)).blocks).toHaveLength(bodyCount)
    const beforeMove = await layer(page, text.id)
    await drag(page, `[data-testid="flow-layer-selection-${text.id}"]`, 44, 26)
    await expect.poll(async () => (await layer(page, text.id)).frame.x).toBeGreaterThan(beforeMove.frame.x + 10)
    const moved = await layer(page, text.id)
    const handle = page.getByTestId(`flow-overlay-handle-${text.id}-se`)
    await drag(page, `[data-testid="flow-overlay-handle-${text.id}-se"]`, 45, 30)
    await expect.poll(async () => (await layer(page, text.id)).frame.width).toBeGreaterThan(moved.frame.width + 10)
    expect((await model(page)).blocks).toHaveLength(bodyCount)
    await expect(handle).toBeVisible()
    await page.screenshot({ path: join(directory, 't01-paper-text.png') })
    const resized = await layer(page, text.id)
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect.poll(() => {
      const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, name))))
      const flow = saved.project.surfaces.find(surface => surface.type === 'flow')
      return flow?.type === 'flow' && flow.surfaceLayerItems.some(entry => entry.item.layerItemId === text.id && entry.item.frame.mode === 'absolute' && entry.item.frame.width === resized.frame.width)
    }).toBe(true)
    await closeSelectionApp(app); app = undefined
    launched = await launch(directory, workspace); app = launched.app; page = launched.page
    expect((await layer(page, text.id)).frame).toEqual(resized.frame)
    expect((await model(page)).blocks).toHaveLength(bodyCount)
    evidence.transform = { beforeMove, moved, resized }
    evidence.status = 'assertions-complete-electron-review-pending'
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error }
  finally { writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); if (app) await closeSelectionApp(app) }
})

test('M16-T02 drag changes paragraph anchor; delete reanchors with undo/redo; fixed underlay and legacy layers survive resize and reopen', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const output = join(root, 'output/g20/m16/t01-t02-completion'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const { workspace, imagePath, baseline } = makeFixture(directory)
  const evidence: Record<string, unknown> = { case: 'M16-T02', run: directory, status: 'running' }
  let app: ElectronApplication | undefined
  try {
    let launched = await launch(directory, workspace); app = launched.app; let page = launched.page
    const text = await insertPaper(page, '文本框')
    const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
    const selection = flow.getByTestId(`flow-layer-selection-${text.id}`)
    await expect(selection).toBeVisible()
    const target = flow.locator(`[data-flow-block-id="${ids.target}"]`)
    await target.scrollIntoViewIfNeeded()
    const targetBox = await target.boundingBox(), selectedBox = await selection.boundingBox()
    if (!targetBox || !selectedBox) throw new Error('Target paragraph or selected layer not laid out')
    const destination = targetBox.y + Math.min(12, targetBox.height / 3)
    const delta = destination - selectedBox.y
    await drag(page, `[data-testid="flow-layer-selection-${text.id}"]`, 0, delta, async () => {
      await expect(flow.locator(`[data-flow-anchor-block-id="${ids.target}"]`)).toBeVisible()
    })
    await expect.poll(async () => (await layer(page, text.id)).anchor?.blockId).toBe(ids.target)
    await expect(flow.locator(`[data-flow-anchor-block-id="${ids.target}"]`)).toBeVisible()
    const dragged = await layer(page, text.id)
    const beforeResize = await geometry(page, ids.target, text.id)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1250, 1000))
    await expect.poll(async () => (await geometry(page, ids.target, text.id)).paperWidth).not.toBe(beforeResize.paperWidth)
    const resized = await geometry(page, ids.target, text.id)
    expect(Math.abs(resized.xRatio - dragged.anchor!.xRatio)).toBeLessThan(0.02)
    expect(Math.abs(resized.offsetY - dragged.anchor!.offsetY)).toBeLessThan(4)

    const shape = await insertPaper(page, '形状')
    expect(shape.anchor).not.toBeNull()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, imagePath)
    const watermark = await insertPaper(page, '图片')
    await expect(flow.getByTestId(`flow-layer-selection-${watermark.id}`)).toBeVisible()
    await flow.getByRole('button', { name: '固定在纸面', exact: true }).click()
    await expect.poll(async () => (await layer(page, watermark.id)).anchor).toBeNull()
    await flow.getByRole('button', { name: '正文下方', exact: true }).click()
    await expect.poll(async () => (await layer(page, watermark.id)).bodyPlane).toBe('underlay')
    const fixed = await layer(page, watermark.id)
    const fixedBox = await flow.getByTestId(`flow-layer-card-${watermark.id}`).boundingBox()
    const beforeBlock = flow.locator(`[data-flow-block-id="${ids.before}"]`)
    await beforeBlock.click(); await page.keyboard.press('Home'); await page.keyboard.insertText('新增上方文字。'.repeat(25))
    const afterEdit = await geometry(page, ids.target, text.id)
    expect(afterEdit.blockTop).toBeGreaterThan(resized.blockTop + 10)
    expect(Math.abs(afterEdit.offsetY - dragged.anchor!.offsetY)).toBeLessThan(4)
    const fixedAfter = await flow.getByTestId(`flow-layer-card-${watermark.id}`).boundingBox()
    if (!fixedBox || !fixedAfter) throw new Error('Fixed image box missing')
    expect(Math.abs(fixedAfter.y - fixedBox.y)).toBeLessThan(4)
    expect((await layer(page, watermark.id)).frame).toEqual(fixed.frame)
    expect(await flow.getByTestId('flow-authoring-surface-underlay').getByTestId(`flow-layer-card-${watermark.id}`).count()).toBe(1)

    const targetBlock = flow.locator(`[data-flow-block-id="${ids.target}"]`)
    await targetBlock.click()
    await page.locator(`.document-block-handle[data-block-id="${ids.target}"]`).getByRole('button', { name: '段落操作' }).click()
    await page.getByRole('menu', { name: '段落操作' }).getByRole('menuitem', { name: '删除段落' }).click()
    await expect.poll(async () => (await model(page)).blocks.some(block => block.id === ids.target)).toBe(false)
    await expect.poll(async () => (await layer(page, text.id)).anchor?.blockId).toBe(ids.before)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await layer(page, text.id)).anchor?.blockId).toBe(ids.target)
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await layer(page, text.id)).anchor?.blockId).toBe(ids.before)
    const finalBeforeSave = await model(page)
    const beforeComponent = new Set(finalBeforeSave.layers.map(entry => entry.id))
    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('menu', { name: 'Flow 插入菜单' }).locator('section[aria-label="放到纸面上"]').getByRole('menuitem', { name: '组件', exact: true }).click()
    await page.getByRole('dialog', { name: '选择要插入的组件' }).getByRole('button', { name: '文字视觉容器' }).click()
    await expect.poll(async () => (await model(page)).layers.filter(entry => !beforeComponent.has(entry.id) && entry.kind === 'component').length).toBe(1)
    const component = (await model(page)).layers.find(entry => !beforeComponent.has(entry.id) && entry.kind === 'component')!
    expect(component.paperSpace).toBe('paper')
    expect(component.anchor).not.toBeNull()
    for (const old of baseline) {
      const actual = finalBeforeSave.layers.find(entry => entry.id === old.id)
      expect(actual?.anchor).toBeNull()
      expect(actual?.paperSpace).toBe(old.paperSpace ?? null)
      expect(actual?.frame).toEqual(old.frame.mode === 'absolute' ? old.frame : actual?.frame)
    }
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect.poll(() => {
      const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, name))))
      const surface = saved.project.surfaces.find(entry => entry.type === 'flow')
      return surface?.type === 'flow' && surface.surfaceLayerItems.some(entry => entry.item.layerItemId === text.id && entry.paragraphAnchor?.blockId === ids.before)
    }).toBe(true)
    await closeSelectionApp(app); app = undefined
    launched = await launch(directory, workspace); app = launched.app; page = launched.page
    const reopened = await model(page)
    expect(reopened.layers.find(entry => entry.id === text.id)?.anchor?.blockId).toBe(ids.before)
    expect(reopened.layers.find(entry => entry.id === shape.id)?.anchor).toEqual(shape.anchor)
    expect(reopened.layers.find(entry => entry.id === component.id)?.anchor).toEqual(component.anchor)
    expect(reopened.layers.find(entry => entry.id === watermark.id)).toMatchObject({ anchor: null, bodyPlane: 'underlay', frame: fixed.frame })
    await page.screenshot({ path: join(directory, 't02-reopened.png') })
    evidence.layers = { dragged, fixed, reopened: reopened.layers }
    evidence.status = 'assertions-complete-electron-review-pending'
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error }
  finally { writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); if (app) await closeSelectionApp(app) }
})
