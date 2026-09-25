import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument, selectionFixtures, selectionServer, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
const inlineCard = (page: Page) => page.getByLabel('当前编辑目标', { exact: true })
async function overlayWithinEditor(page: Page, overlay: Locator) {
  await expect.poll(async () => overlay.evaluate(element => {
    const editor = document.querySelector('.shared-document-editor')?.getBoundingClientRect()
    const overlayRect = element.getBoundingClientRect()
    const assistant = document.querySelector('.workspace-region--assistant')?.getBoundingClientRect()
    return Boolean(editor && overlayRect.width > 0 && overlayRect.height > 0
      && overlayRect.left >= Math.max(8, editor.left) - 1 && overlayRect.right <= Math.min(innerWidth - 8, editor.right) + 1
      && overlayRect.top >= Math.max(8, editor.top) - 1 && overlayRect.bottom <= Math.min(innerHeight - 8, editor.bottom) + 1
      && (!assistant || overlayRect.right <= assistant.left + 1))
  })).toBe(true)
}
function project(snapshot: DocumentSnapshot) { if (snapshot.model.kind !== 'course-v9') throw new Error('Expected course'); return snapshot.model.project }
async function showFocusedAssistant(page: Page) {
  const assistant = page.locator('.workspace-region--assistant')
  if (await assistant.isVisible()) return false
  const button = page.getByRole('complementary', { name: '编辑面板' }).getByRole('button', { name: 'AI 助手', exact: true })
  await button.click()
  await expect(assistant).toBeVisible()
  return true
}
async function focusSettingsAndBack(page: Page) {
  const opened = await showFocusedAssistant(page)
  await page.getByLabel('给创作助手发消息', { exact: true }).click()
  await page.getByRole('button', { name: '切换模型', exact: true }).click()
  await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
  await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
  if (opened) {
    await page.getByRole('complementary', { name: '编辑面板' }).getByRole('button', { name: 'AI 助手', exact: true }).click()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
  }
}
/** The assistant "+" menu references the current selection for the next main-chat message. */
async function referenceCurrentSelection(page: Page) {
  const assistant = page.getByRole('region', { name: '创作助手', exact: true })
  await assistant.getByRole('button', { name: '添加', exact: true }).click()
  await assistant.getByRole('menuitem', { name: '引用当前选区', exact: true }).click()
}
// Owner 2026-09-24: sending never shows a service notice.
async function expectNoServiceNotice(page: Page) {
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}
async function clickPaintedObject(page: Page, object: Locator) {
  // The shared Player paint is inert; actual authoring hit testing lives on the
  // canvas above it. Read its bounds, then use a real pointer on that canvas.
  await expect(object).toBeVisible()
  const bounds = await object.boundingBox()
  if (!bounds) throw new Error('Object has no visible bounds')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

async function clickSpatialText(page: Page, object: Locator) {
  // Spatial paint deliberately has pointer-events:none: the authoring stage
  // performs hit testing. A world frame can extend behind the properties pane,
  // so its un-clipped centre is not a usable pointer coordinate. Click visible
  // painted text, and prove the receiving element is the real authoring stage.
  await expect(object).toBeVisible()
  const point = await object.evaluate(root => {
    const stage = root.closest('[data-testid="spatial-world-stage"]')
    if (!stage) throw new Error('Spatial object has no authoring stage')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
        if (!node.textContent![index].trim()) continue
        const range = document.createRange()
        range.setStart(node, index); range.setEnd(node, index + 1)
        for (const rect of Array.from(range.getClientRects())) {
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
          const receiver = document.elementFromPoint(x, y)
          if (rect.width > 0 && rect.height > 0 && receiver && stage.contains(receiver)) return { x, y }
        }
      }
    }
    throw new Error('Spatial text has no visible point received by its authoring stage')
  })
  await page.mouse.click(point.x, point.y)
  return point
}

test('retained and expanded Markdown targets stay inside the editor when the assistant is open or the window narrows', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow()
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    await openSelectionFile(page, fixture.workspace, 'selection.md')
    await selectVisibleText(page, body(page), '先预测😀')
    await overlayWithinEditor(page, inlineCard(page))
    await inlineCard(page).getByRole('button', { name: '保留目标', exact: true }).click()
    const retained = page.locator('.shared-document-contextual-target')
    await overlayWithinEditor(page, retained)
    await page.setViewportSize({ width: 900, height: 650 })
    await overlayWithinEditor(page, retained)
    await page.getByRole('button', { name: '展开编辑卡', exact: true }).click()
    await overlayWithinEditor(page, inlineCard(page))
    await inlineCard(page).getByRole('button', { name: '关闭当前编辑目标', exact: true }).click()
    await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    await selectVisibleText(page, body(page), '先预测😀')
    await overlayWithinEditor(page, inlineCard(page))
    await inlineCard(page).getByRole('button', { name: '保留目标', exact: true }).click()
    await overlayWithinEditor(page, page.locator('.shared-document-contextual-target'))
    expect(server.requests).toHaveLength(0)
  } finally { await closeSelectionApp(app); await server.close() }
})

// M04-T01/T02/T03 for MD+Flow. Also checks one real undo/redo/save/reopen loop.
test('M04-T01/T02/T03 Markdown and Flow inline selection stays frozen through focus and another manual selection', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const md = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    // Valid Markdown opens in body mode; no internal editor/controller injection.
    await expect(body(page)).toBeVisible()
    await selectVisibleText(page, body(page), '先预测😀')
    const instruction = '只将选中的先预测改为先猜想😀'
    await inlineCard(page).getByLabel('AI 指令', { exact: true }).fill(instruction)
    await expect(body(page).locator('[data-context-pin]')).toContainText('先预测😀')
    await focusSettingsAndBack(page)
    await expect(inlineCard(page).getByLabel('AI 指令', { exact: true })).toHaveValue(instruction)
    await expect(body(page).locator('[data-context-pin]')).toContainText('先预测😀')
    // Exercise the real attachment button; only the native OS chooser result is
    // cancelled so the test does not import an unrelated file.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: '添加', exact: true }).click(); await page.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    const expandCard = page.getByRole('button', { name: '展开编辑卡', exact: true })
    if (await expandCard.isVisible()) await expandCard.click()
    await expect(inlineCard(page).getByLabel('AI 指令', { exact: true })).toHaveValue(instruction)
    await expect(body(page).locator('[data-context-pin]')).toContainText('先预测😀')
    // Use keyboard to collapse/reopen the local UI without clearing the draft or pin.
    await inlineCard(page).getByLabel('AI 指令', { exact: true }).press('Escape')
    await page.getByRole('button', { name: '展开编辑卡', exact: true }).click()
    await expect(inlineCard(page).getByLabel('AI 指令', { exact: true })).toHaveValue(instruction)
    const round = server.arm('markdown-selection', 'markdown-range', '先猜想😀')
    await inlineCard(page).getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(round); expect(round.readText).toBe('先预测😀')
    expect(round.references).toHaveLength(1)
    expect(round.references?.[0].documentId).toBe(md.documentId)
    const flowForB = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    const bEditor = body(page)
    await selectVisibleText(page, bEditor, '保持原样')
    await expect(bEditor.locator('[data-context-pin]')).toContainText('保持原样')
    const bBeforeACommit = await readSelectionDocument(page, flowForB.documentId)
    expect(bBeforeACommit.model).toEqual(flowForB.model)
    await page.screenshot({ path: join(fixture.directory, 'md-held-new-selection.png') })
    await finishRound(page, round)
    const expectedSource = markdownSource.replace('先预测😀', '先猜想😀')
    await expect.poll(async () => (await readSelectionDocument(page, md.documentId)).model).toMatchObject({ source: expectedSource })
    const changed = await readSelectionDocument(page, md.documentId)
    await expect(bEditor.locator('[data-context-pin]')).toContainText('保持原样')
    const bAfterACommit = await readSelectionDocument(page, flowForB.documentId)
    expect(bAfterACommit.model).toEqual(flowForB.model)
    await openSelectionFile(page, fixture.workspace, 'selection.md')
    expect(changed.undoDepth).toBe(md.undoDepth + 1)
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, md.documentId)).model).toMatchObject({ source: markdownSource })
    await region.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, md.documentId)).model).toMatchObject({ source: expectedSource })
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(fixture.workspace, 'selection.md'), 'utf8')).toBe(expectedSource)
    const activeTargetCard = page.getByLabel('当前编辑目标', { exact: true })
    if (await activeTargetCard.isVisible()) {
      await activeTargetCard.getByRole('button', { name: '保留目标', exact: true }).click()
    }
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 selection.md', exact: true }).click()
    await expect(region).toHaveCount(0)
    const reopened = await openSelectionFile(page, fixture.workspace, 'selection.md')
    expect(reopened.model).toMatchObject({ source: expectedSource })

    const flow = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    const flowBefore = project(flow).surfaces[0]
    if (flowBefore.type !== 'flow') throw new Error('Flow fixture')
    const flowEditor = body(page)
    await selectVisibleText(page, flowEditor, '先预测😀')
    await inlineCard(page).getByLabel('AI 指令', { exact: true }).fill('只把讲义选中文字改为先讨论😀')
    await focusSettingsAndBack(page)
    await expect(flowEditor.locator('[data-context-pin]')).toContainText('先预测😀')
    const flowRound = server.arm('flow-selection', 'flow-range', '先讨论😀')
    await inlineCard(page).getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(flowRound)
    expect(JSON.parse(flowRound.readText!)).toMatchObject({ content: { inlines: [{ type: 'text', text: '先预测😀' }] } })
    await page.getByLabel('给创作助手发消息', { exact: true }).click()
    await selectVisibleText(page, flowEditor, '保持原样')
    expect(project(await readSelectionDocument(page, flow.documentId)).surfaces[0]).toEqual(flowBefore)
    await finishRound(page, flowRound)
    const flowAfter = await readSelectionDocument(page, flow.documentId), surface = project(flowAfter).surfaces[0]
    if (surface.type !== 'flow') throw new Error('Flow fixture')
    expect(surface.blocks[0]).toEqual(flowBefore.blocks[0]); expect(surface.blocks[2]).toEqual(flowBefore.blocks[2])
    expect(surface.blocks[1]).toMatchObject({ id: 'flow-a', content: { inlines: [{ type: 'text', text: '甲段：先讨论😀，再观察。' }] } })
    expect(flowAfter.undoDepth).toBe(flow.undoDepth + 1)
    await expect(flowEditor).toContainText('甲段：先讨论😀，再观察。')
    await page.screenshot({ path: join(fixture.directory, 'flow-completed.png') })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'body-evidence.json'), JSON.stringify({ coverage: ['M04-T01 MD/Flow', 'M04-T02 input/model/attachment focus', 'M04-T03 A frozen while B document selection persists'], rounds: server.rounds, changed, bBeforeACommit, bAfterACommit, reopened, flowAfter, errors }, null, 2))
    await info.attach('Flow selection result', { path: join(fixture.directory, 'flow-completed.png'), contentType: 'image/png' })
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

// M04-T01/T02/T03 for Slides+Spatial, including exact named-state scope.
test('M04 Spatial painted-object pointer drag keeps the rendered hit target aligned', async ({}, info) => {
  test.setTimeout(90_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'spatial.h5lesson')
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    const worldA = page.locator('[data-layer-item-id="world-a"]:visible').first()
    await expect(worldA).toContainText('基础态正文')
    const start = await clickSpatialText(page, worldA)
    await expect(page.getByRole('toolbar', { name: '选中对象快捷工具' })).toBeVisible()
    const surfaceBefore = project(before).surfaces[0]
    if (surfaceBefore.type !== 'spatial-2d') throw new Error('Spatial fixture')
    const frameBefore = surfaceBefore.world.layerItems[0].frame
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 80, start.y + 45, { steps: 8 })
    await page.mouse.up()
    const moved = await readSelectionDocument(page, before.documentId)
    const surfaceAfter = project(moved).surfaces[0]
    if (surfaceAfter.type !== 'spatial-2d') throw new Error('Spatial fixture')
    expect(surfaceAfter.world.layerItems[0].frame.x).toBeGreaterThan(frameBefore.x + 40)
    expect(surfaceAfter.world.layerItems[0].frame.y).toBeGreaterThan(frameBefore.y + 20)
    expect(moved.undoDepth).toBe(before.undoDepth + 1)
    expect(errors).toEqual([])
    await page.screenshot({ path: join(fixture.directory, 'spatial-pointer-drag.png') })
    await info.attach('Spatial painted-object pointer drag', { path: join(fixture.directory, 'spatial-pointer-drag.png'), contentType: 'image/png' })
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M04-T01/T02/T03 named Slide and Spatial objects preserve their pinned target through focus and state/object changes', async ({}, info) => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const slide = await openSelectionFile(page, fixture.workspace, 'named-selection.h5lesson')
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    const states = page.getByRole('region', { name: '场景状态', exact: true })
    await states.getByRole('button', { name: /^命名态 A，命名状态/ }).click()
    const sceneText = page.locator('[data-slide-layer-item="scene-text"]:visible').first()
    await expect(sceneText).toContainText('命名态 A 正文'); await clickPaintedObject(page, sceneText)
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    await page.getByLabel('选中对象的修改要求', { exact: true }).fill('只把命名态 A 的所选对象改为 A 已修改')
    await expect(page.locator('[data-pinned-object]')).toHaveCount(1)
    await focusSettingsAndBack(page)
    await expect(page.locator('[data-pinned-object]')).toHaveCount(1)
    await expect(page.getByLabel('选中对象的修改要求', { exact: true })).toHaveValue('只把命名态 A 的所选对象改为 A 已修改')
    const slideRound = server.arm('slide-named-selection', 'course-object', 'A 已修改')
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(slideRound)
    expect(JSON.parse(slideRound.readText!)).toMatchObject({ stateId: 'named-a', item: { content: { data: { text: '命名态 A 正文' } }, frame: { x: 160 } } })
    await states.getByRole('button', { name: /^命名态 B，命名状态/ }).click()
    await expect(sceneText).toContainText('命名态 B 正文')
    await clickPaintedObject(page, page.locator('[data-slide-layer-item="scene-other"]:visible').first())
    await expect(page.locator('[data-pinned-object]')).toHaveCount(0)
    expect(project(await readSelectionDocument(page, slide.documentId))).toEqual(project(slide))
    await page.screenshot({ path: join(fixture.directory, 'named-A-held-viewing-B.png') })
    const assistantToggle = page.getByRole('complementary', { name: '编辑面板' }).getByRole('button', { name: 'AI 助手', exact: true })
    await assistantToggle.click()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await finishRound(page, slideRound)
    await assistantToggle.click()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    const slideAfter = await readSelectionDocument(page, slide.documentId), changedProject = project(slideAfter)
    const itemAt = (stateId: string | null) => buildSlideEditorView({ project: changedProject, locationId: fixture.named.locationId, stateId }).layers.find(layer => layer.selectionId === 'scene-text')!.item
    expect(itemAt('named-a')).toMatchObject({ content: { data: { text: 'A 已修改' } } })
    expect(itemAt('named-b')).toMatchObject({ content: { data: { text: '命名态 B 正文' } } })
    expect(itemAt(null)).toMatchObject({ content: { data: { text: '基础态正文' } } })
    const slideSurface = changedProject.surfaces[0], beforeSurface = project(slide).surfaces[0]
    if (slideSurface.type !== 'slide' || beforeSurface.type !== 'slide') throw new Error('Slide fixture')
    expect(slideSurface.scenes[0].layerItems).toEqual(beforeSurface.scenes[0].layerItems)
    expect(slideSurface.scenes[0].presentation?.states[1]).toEqual(beforeSurface.scenes[0].presentation?.states[1])
    expect(changedProject.globalLayerItems).toEqual(project(slide).globalLayerItems)
    expect(slideSurface.surfaceLayerItems).toEqual(beforeSurface.surfaceLayerItems)
    expect(slideAfter.undoDepth).toBe(slide.undoDepth + 1)
    await states.getByRole('button', { name: /^命名态 A，命名状态/ }).click(); await expect(sceneText).toContainText('A 已修改')

    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await expect(page.locator('.lesson-directory-tree')).toBeVisible()
    const spatial = await openSelectionFile(page, fixture.workspace, 'spatial.h5lesson')
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    const worldA = page.locator('[data-layer-item-id="world-a"]:visible').first()
    await expect(worldA).toContainText('基础态正文'); await clickSpatialText(page, worldA)
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    await page.getByLabel('选中对象的修改要求', { exact: true }).fill('只修改这个 world 对象为画布已修改')
    await expect(page.locator('[data-pinned-object]')).toHaveCount(1)
    await focusSettingsAndBack(page)
    await expect(page.locator('[data-pinned-object]')).toHaveCount(1)
    const spatialRound = server.arm('spatial-selection', 'course-object', '画布已修改')
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(spatialRound)
    const worldRead = JSON.parse(spatialRound.readText!)
    expect(worldRead.stateId).toBeUndefined(); expect(worldRead).toMatchObject({ owner: { source: 'world' }, item: { content: { data: { text: '基础态正文' } } } })
    await clickSpatialText(page, page.locator('[data-layer-item-id="world-b"]:visible').first())
    await expect(page.locator('[data-pinned-object]')).toHaveCount(0)
    expect(project(await readSelectionDocument(page, spatial.documentId))).toEqual(project(spatial))
    await assistantToggle.click()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await finishRound(page, spatialRound)
    await assistantToggle.click()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    const spatialAfter = await readSelectionDocument(page, spatial.documentId), world = project(spatialAfter).surfaces[0], beforeWorld = project(spatial).surfaces[0]
    if (world.type !== 'spatial-2d' || beforeWorld.type !== 'spatial-2d') throw new Error('Spatial fixture')
    expect(world.world.layerItems[0]).toMatchObject({ content: { data: { text: '画布已修改' } } })
    expect(world.world.layerItems[1]).toEqual(beforeWorld.world.layerItems[1])
    expect(spatialAfter.undoDepth).toBe(spatial.undoDepth + 1)
    await expect(worldA).toContainText('画布已修改')
    await page.screenshot({ path: join(fixture.directory, 'spatial-completed.png') })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'object-evidence.json'), JSON.stringify({ coverage: ['M04-T01 Slides/Spatial', 'M04-T02 persistent object pin', 'M04-T03 named-state/object freeze'], rounds: server.rounds, slideAfter, spatialAfter, errors }, null, 2))
    await info.attach('Spatial selection result', { path: join(fixture.directory, 'spatial-completed.png'), contentType: 'image/png' })
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M04-T04 same-page multi-selection edits both objects; deleted and empty targets cannot widen the task', async () => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'named-selection.h5lesson')
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    const states = page.getByRole('region', { name: '场景状态', exact: true })
    await states.getByRole('button', { name: /^命名态 A，命名状态/ }).click()
    const first = page.locator('[data-slide-layer-item="scene-text"]:visible').first()
    const second = page.locator('[data-slide-layer-item="scene-other"]:visible').first()
    await clickPaintedObject(page, first)
    await page.keyboard.down('Shift'); await clickPaintedObject(page, second); await page.keyboard.up('Shift')
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    await expect(page.getByText('所选 2 个对象（当前命名态） · 已固定', { exact: true })).toBeVisible()
    await expect(page.locator('[data-pinned-object]')).toHaveCount(2)
    await page.getByLabel('选中对象的修改要求', { exact: true }).fill('只修改同页选中的两个对象')
    const round = server.armMulti('slide-two-objects', 'course-object', ['多选甲已修改', '多选乙已修改'])
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expectNoServiceNotice(page)
    await expect(first).toContainText('多选甲已修改')
    await expect(second).toContainText('多选乙已修改')
    await expect.poll(() => round.multi?.results.length ?? 0).toBe(2)
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    expect(round.error).toBeUndefined()
    expect(round.references?.[0].selection).toHaveLength(2)
    expect(round.references?.[0].writable).toHaveLength(2)
    expect(round.multi?.results).toHaveLength(2)
    expect(round.multi?.readTexts.map(value => JSON.parse(value).item.content.data.text)).toEqual(['命名态 A 正文', '另一个对象'])
    const changed = await readSelectionDocument(page, before.documentId), changedProject = project(changed)
    const state = (stateId: string | null, id: string) => buildSlideEditorView({ project: changedProject, locationId: fixture.named.locationId, stateId }).layers.find(layer => layer.selectionId === id)?.item
    expect(state('named-a', 'scene-text')).toMatchObject({ content: { data: { text: '多选甲已修改' } } })
    expect(state('named-a', 'scene-other')).toMatchObject({ content: { data: { text: '多选乙已修改' } } })
    expect(state('named-b', 'scene-text')).toMatchObject({ content: { data: { text: '命名态 B 正文' } } })
    expect(state(null, 'scene-text')).toMatchObject({ content: { data: { text: '基础态正文' } } })
    expect(changed.undoDepth).toBe(before.undoDepth + 2)

    // Keep an inline target while a real authoring Delete removes those objects.
    await clickPaintedObject(page, first)
    await page.keyboard.down('Shift'); await clickPaintedObject(page, second); await page.keyboard.up('Shift')
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    const instruction = page.getByLabel('选中对象的修改要求', { exact: true })
    await instruction.fill('不能把失效的两个对象改成整页')
    const properties = page.getByRole('complementary', { name: '编辑面板' }).getByRole('tab', { name: '属性', exact: true })
    await properties.click()
    await expect(properties).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('button', { name: '删除所选', exact: true }).click()
    const afterDelete = await readSelectionDocument(page, before.documentId)
    const visibleAfterDelete = buildSlideEditorView({ project: project(afterDelete), locationId: fixture.named.locationId, stateId: 'named-a' }).layers
    expect(visibleAfterDelete.find(layer => layer.selectionId === 'scene-text')?.effectiveVisible).toBeFalsy()
    expect(visibleAfterDelete.find(layer => layer.selectionId === 'scene-other')?.effectiveVisible).toBeFalsy()
    expect(afterDelete.undoDepth).toBe(changed.undoDepth + 1)
    const sentBeforeRejection = server.requests.length
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '选中的内容已改变' })).toBeVisible()
    expect(await readSelectionDocument(page, before.documentId)).toMatchObject({ model: afterDelete.model, revision: afterDelete.revision, undoDepth: afterDelete.undoDepth })
    expect(server.requests).toHaveLength(sentBeforeRejection)

    await page.getByRole('button', { name: '取消引用', exact: true }).click()
    await expect(page.getByRole('button', { name: 'AI 修改选中内容', exact: true })).toHaveCount(0)
    await showFocusedAssistant(page)
    await referenceCurrentSelection(page)
    await expect(page.getByRole('alert').filter({ hasText: '当前没有有效选区' })).toBeVisible()
    expect(await readSelectionDocument(page, before.documentId)).toMatchObject({ model: afterDelete.model, revision: afterDelete.revision, undoDepth: afterDelete.undoDepth })
    expect(server.requests).toHaveLength(sentBeforeRejection)
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'multi-invalid-evidence.json'), JSON.stringify({ coverage: 'M04-T04', round, before, changed, afterDelete, requests: server.requests.length, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'multi-invalid-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'multi-invalid-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M04-T05 inline body and main chat send the same selected Markdown target through one task and History path', async () => {
  test.setTimeout(150_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true }), editor = body(page)
    const instruction = '只把选中的先预测改为先猜想😀', replacement = '先猜想😀'
    const expected = markdownSource.replace('先预测😀', replacement)
    await selectVisibleText(page, editor, '先预测😀')
    await referenceCurrentSelection(page)
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('选区 1 处')
    await page.getByLabel('给创作助手发消息', { exact: true }).fill(instruction)
    // Under the default level the main-chat reference may also write the whole document; the selection stays the target.
    const chatRound = server.arm('main-chat-selection', 'markdown-range', replacement, { documentWritable: true })
    await page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(chatRound); expect(chatRound.readText).toBe('先预测😀')
    await finishRound(page, chatRound)
    const chatResult = await readSelectionDocument(page, before.documentId)
    expect(chatResult.model).toMatchObject({ source: expected }); expect(chatResult.undoDepth).toBe(before.undoDepth + 1)
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: markdownSource })

    await selectVisibleText(page, editor, '先预测😀')
    await inlineCard(page).getByLabel('AI 指令', { exact: true }).fill(instruction)
    const inlineRound = server.arm('inline-body-selection', 'markdown-range', replacement)
    await inlineCard(page).getByRole('button', { name: '发送', exact: true }).click()
    await heldRound(inlineRound); expect(inlineRound.readText).toBe(chatRound.readText)
    await finishRound(page, inlineRound)
    const inlineResult = await readSelectionDocument(page, before.documentId)
    expect(inlineResult.model).toEqual(chatResult.model)
    expect(inlineResult.undoDepth).toBe(chatResult.undoDepth)
    expect(inlineRound.references?.[0].selection.map(item => item.kind)).toEqual(chatRound.references?.[0].selection.map(item => item.kind))
    // The inline card stays restricted to the selection; the main chat adds only the whole-document write of the default level.
    expect(chatRound.references?.[0].writable.map(item => item.kind)).toEqual(['document', ...inlineRound.references![0].writable.map(item => item.kind)])
    expect(inlineRound.references?.[0].documentId).toBe(chatRound.references?.[0].documentId)
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: markdownSource })
    await region.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, before.documentId)).model).toMatchObject({ source: expected })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'two-entries-evidence.json'), JSON.stringify({ coverage: 'M04-T05', rounds: server.rounds, before, chatResult, inlineResult, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'two-entries-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'two-entries-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2)); throw error
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M04-T06 selected Slide object can submit inline AI while the right assistant is hidden', async ({}, info) => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer(), app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const before = await openSelectionFile(page, fixture.workspace, 'named-selection.h5lesson')
    const grid = page.locator('.workspace-grid')
    await expect(grid).toHaveAttribute('data-editor-focus', 'false')
    const chatPreference = await grid.getAttribute('data-chat-closed')
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(grid).toHaveAttribute('data-editor-focus', 'true')
    const states = page.getByRole('region', { name: '场景状态', exact: true })
    await states.getByRole('button', { name: /^命名态 A，命名状态/ }).click()
    const assistantToggle = page.getByRole('complementary', { name: '编辑面板' }).getByRole('button', { name: 'AI 助手', exact: true })
    await assistantToggle.click()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await assistantToggle.click()
    await expect(grid).toHaveAttribute('data-pro-panel', '')
    await expect(grid).toHaveAttribute('data-chat-closed', chatPreference!)
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()

    const painted = page.locator('[data-slide-layer-item="scene-text"]:visible').first()
    await expect(painted).toContainText('命名态 A 正文')
    await clickPaintedObject(page, painted)
    await expect(page.getByRole('toolbar', { name: '选中对象快捷工具' })).toBeVisible()
    await page.getByRole('button', { name: 'AI 修改选中内容', exact: true }).click()
    await page.getByLabel('选中对象的修改要求', { exact: true }).fill('把所选对象改成右侧收起后仍可编辑')
    await page.screenshot({ path: join(fixture.directory, 'inline-ai-assistant-hidden-before.png') })

    const round = server.arm('inline-ai-without-right-assistant', 'course-object', '右侧收起后仍可编辑')
    await page.getByRole('button', { name: '交给创作助手', exact: true }).click()
    await expectNoServiceNotice(page)
    await heldRound(round)
    expect(JSON.parse(round.readText!)).toMatchObject({ stateId: 'named-a', item: { content: { data: { text: '命名态 A 正文' } } } })
    round.release()
    await expect.poll(() => round.returned).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = await readSelectionDocument(page, before.documentId)
    const changed = buildSlideEditorView({ project: project(after), locationId: fixture.named.locationId, stateId: 'named-a' })
      .layers.find(layer => layer.selectionId === 'scene-text')?.item
    expect(changed).toMatchObject({ content: { data: { text: '右侧收起后仍可编辑' } } })
    expect(after.undoDepth).toBe(before.undoDepth + 1)
    expect(server.requests).toHaveLength(3)
    await expect(grid).toHaveAttribute('data-pro-panel', '')
    await expect(grid).toHaveAttribute('data-chat-closed', chatPreference!)
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await page.screenshot({ path: join(fixture.directory, 'inline-ai-assistant-hidden-applied.png') })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'inline-ai-assistant-hidden.json'), JSON.stringify({ caseId: 'M04-T06', before: { revision: before.revision, undoDepth: before.undoDepth }, after: { revision: after.revision, undoDepth: after.undoDepth }, requests: server.requests.length, round, errors }, null, 2))
    await info.attach('M04-T06 inline AI with assistant hidden', { path: join(fixture.directory, 'inline-ai-assistant-hidden-applied.png'), contentType: 'image/png' })
  } catch (error) {
    await page.screenshot({ path: join(fixture.directory, 'inline-ai-assistant-hidden-failure.png') }).catch(() => {})
    writeFileSync(join(fixture.directory, 'inline-ai-assistant-hidden-failure.json'), JSON.stringify({ rounds: server.rounds, requests: server.requests, errors }, null, 2))
    throw error
  } finally { await closeSelectionApp(app); await server.close() }
})
