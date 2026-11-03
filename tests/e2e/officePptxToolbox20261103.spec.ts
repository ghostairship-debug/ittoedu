import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

const inspect = (filename: string) => {
  const data = inspectOfficeContent(readFileSync(filename), 'pptx')
  if (data.format !== 'pptx') throw new Error('PPT expected')
  return data
}
test('PPT toolbox edits multiple objects, native clipboard, text and tables with shared undo and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32'); test.setTimeout(240000)
  const base = resolve('output/office-coedit-20261103/ppt-toolbox'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }, name = 'PPT高频工具.pptx', filename = join(workspace, name)
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.addText('工具验收', { x: 1, y: .5, w: 8, h: 1, fontSize: 28, objectName: 'source-a' })
  slide.addShape(ppt.ShapeType.rect, { x: 1, y: 2, w: 2, h: 1, fill: { color: '668ABD' }, objectName: 'source-b' })
  slide.addShape(ppt.ShapeType.ellipse, { x: 5, y: 3, w: 2, h: 1, fill: { color: 'E6A65A' }, objectName: 'source-c' })
  ppt.addSlide().addText('范围外保持', { x: 1, y: 1, w: 9, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }); if (!(bytes instanceof Uint8Array)) throw new Error('fixture expected')
  writeFileSync(filename, bytes)
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'open', boundary: 'Real Electron tools, native clipboard and OOXML shared history; no model or PowerPoint claim.' }, errors: string[] = []
  let { app, page } = await launchM20(fixture)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const editor = page.locator('.pptx-editor'), stage = editor.getByTestId('pptx-edit-surface')
    await expect(stage).toContainText('工具验收', { timeout: 45000 })
    const save = async () => { await editor.getByRole('button', { name: '保存', exact: true }).click() }
    facts.phase = 'shift-select-and-handles'
    const sourceShape = inspect(filename).slides[0].shapes.find(shape => shape.name === 'source-b')!
    const sourceId = sourceShape.shapeId, before = sourceShape.frame!
    const originalObjects = stage.locator('[data-edit-id]')
    await expect(originalObjects).toHaveCount(3)
    await originalObjects.nth(1).click()
    await originalObjects.nth(2).click({ modifiers: ['Shift'] })
    await expect(editor.locator('.pptx-editor__footer')).toContainText('已选 2 个对象')
    await originalObjects.nth(2).click({ modifiers: ['Shift'] })
    await expect(editor.locator('.pptx-editor__footer')).toContainText('已选 1 个对象')
    const frame = () => inspect(filename).slides[0].shapes.find(shape => shape.shapeId === sourceId)!.frame!
    const resize = await stage.locator('[data-edit-resize-handle="se"]').boundingBox(), canvasBox = await stage.boundingBox()
    if (!resize || !canvasBox) throw new Error('Native resize handle was not rendered')
    const resizeX = resize.x + resize.width / 2, resizeY = resize.y + resize.height / 2, dx = 52, dy = 28
    await page.mouse.move(resizeX, resizeY); await page.mouse.down()
    await page.mouse.move(resizeX + dx, resizeY + dy, { steps: 8 }); await page.mouse.up(); await save()
    await expect.poll(() => frame().width).toBeGreaterThan(before.width + 5)
    const resized = frame(), pointsPerPixel = 960 / canvasBox.width // The fixture's 13 1/3-inch slide is 960 pt wide.
    expect(Math.abs(resized.width - before.width - dx * pointsPerPixel)).toBeLessThan(2)
    expect(Math.abs(resized.height - before.height - dy * pointsPerPixel)).toBeLessThan(2)
    expect(resized.x).toBeCloseTo(before.x, 1); expect(resized.y).toBeCloseTo(before.y, 1)
    const rotation = await stage.locator('[data-edit-rotation-handle]').boundingBox()
    const selectionFrame = await stage.locator('[data-edit-selection-frame]').boundingBox()
    if (!rotation || !selectionFrame) throw new Error('Native rotation handle was not rendered')
    const center = { x: selectionFrame.x + selectionFrame.width / 2, y: selectionFrame.y + selectionFrame.height / 2 }
    const from = { x: rotation.x + rotation.width / 2, y: rotation.y + rotation.height / 2 }
    const radius = Math.hypot(from.x - center.x, from.y - center.y)
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(center.x + radius / Math.sqrt(2), center.y - radius / Math.sqrt(2), { steps: 10 })
    await page.mouse.up(); await save()
    await expect.poll(() => frame().rotation).toBeGreaterThan(40)
    const rotated = frame()
    expect(Math.abs(rotated.rotation - 45)).toBeLessThan(1)
    expect(rotated.width).toBeCloseTo(resized.width, 1); expect(rotated.height).toBeCloseTo(resized.height, 1)
    expect(rotated.x + rotated.width / 2).toBeCloseTo(resized.x + resized.width / 2, 1)
    expect(rotated.y + rotated.height / 2).toBeCloseTo(resized.y + resized.height / 2, 1)
    facts.canvasHandles = { shiftMultiSelection: 2, shapeId: sourceId, before, resized, rotated }
    await page.screenshot({ path: join(directory, '00-canvas-handles.png'), fullPage: true })
    facts.phase = 'group-and-clipboard'
    await editor.getByRole('button', { name: '全选本页对象（Ctrl+A）', exact: true }).click()
    await editor.getByRole('button', { name: '组合选中对象', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'group').length).toBe(1)
    await editor.getByRole('button', { name: '解组', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'group').length).toBe(0)
    await editor.getByRole('button', { name: '创建对象副本（Ctrl+D）', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.length).toBe(6)
    await stage.locator('[data-web-ppt-editor]').first().focus()
    await page.keyboard.press('Control+C'); await page.keyboard.press('Control+V'); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.length).toBe(9)
    await editor.getByRole('combobox', { name: '排列对象', exact: true }).selectOption('left'); await save()
    await editor.getByRole('button', { name: '对象选择窗格', exact: true }).click()
    await expect(editor.locator('.pptx-editor__object-list')).toContainText('source-a')
    facts.phase = 'text-and-table'
    await editor.getByRole('button', { name: '插入文本框', exact: true }).click()
    await editor.getByRole('combobox', { name: '字号', exact: true }).selectOption('40')
    await editor.getByRole('button', { name: '加粗', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.fontSize).toBe(40)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.bold).toBe(true)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.text === '双击编辑文字')?.runs[0]?.[0]?.style.color).toBe('202124')
    await editor.getByRole('button', { name: '插入表格', exact: true }).click()
    await editor.getByRole('button', { name: '表格添加行', exact: true }).click()
    await editor.getByRole('button', { name: '表格添加列', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(shape => shape.kind === 'table')?.cells?.length).toBe(4)
    expect(inspect(filename).slides[0].shapes.find(shape => shape.kind === 'table')?.cells?.[0]).toHaveLength(4)
    await stage.locator('[data-edit-id]').last().click({ button: 'right' })
    await page.getByRole('menu', { name: '对象快捷操作' }).getByRole('menuitem', { name: '创建副本', exact: true }).click(); await save()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(2)
    await page.screenshot({ path: join(directory, '01-toolbox.png'), fullPage: true })
    facts.phase = 'shared-history'
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(1)
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table').length).toBe(2)
    expect(inspect(filename).slides[1].shapes[0].text).toBe('范围外保持')
    facts.phase = 'cold-reopen'; await closeM20(app); ({ app, page } = await launchM20(fixture))
    page.on('pageerror', error => errors.push(error.message))
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    await expect(page.getByTestId('pptx-edit-surface')).toContainText('双击编辑文字', { timeout: 45000 })
    expect(inspect(filename).slides[0].shapes.filter(shape => shape.kind === 'table')).toHaveLength(2)
    for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) expect(frame()[key]).toBeCloseTo(rotated[key], 2)
    expect(errors).toEqual([]); facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) { facts.errors = errors; await m20Evidence(info, fixture, page, facts, error); throw error }
  finally { await closeM20(app) }
})
