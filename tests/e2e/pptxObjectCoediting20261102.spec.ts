import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row } from './helpers/g20M20Harness'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function inspect(filename: string) {
  const value = inspectOfficeContent(readFileSync(filename), 'pptx')
  if (value.format !== 'pptx') throw new Error('Expected PPTX')
  return value
}

test('PPT original object UI edits geometry, styles, image and table through saved shared history and a cold App', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The formal product entry point uses Windows Electron.')
  test.setTimeout(240_000)
  const base = resolve('output/goal-correction-20261102/pptx-object-ui')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '原件对象共同编辑.pptx', filename = join(workspace, name)
  const presentation = new PptxGenJS()
  const sharp = (await import('sharp')).default
  const sourceImage = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 97, g: 157, b: 130, alpha: 1 } } }).png().toBuffer()
  presentation.layout = 'LAYOUT_WIDE'
  const slide = presentation.addSlide()
  slide.background = { color: 'F3F6FB' }
  slide.addText('可共同编辑的原演示文稿', { x: .7, y: .5, w: 11.5, h: .8, fontSize: 30, color: '183153', bold: true, objectName: 'editable-title' })
  slide.addShape(presentation.ShapeType.rect, { x: .8, y: 2, w: 3, h: 1.3, fill: { color: '73A3D8' }, line: { color: '245B91' }, objectName: 'editable-shape' })
  slide.addText('人改后的内容必须保留', { x: .9, y: 2.4, w: 2.8, h: .4, fontSize: 15, color: 'FFFFFF', objectName: 'keep-text' })
  slide.addImage({ data: `image/png;base64,${sourceImage.toString('base64')}`, x: 5, y: 2, w: 2.4, h: 1.4, objectName: 'editable-image' })
  slide.addTable([[{ text: '项目' }, { text: '数据' }], [{ text: '保留' }, { text: '42' }]], { x: .8, y: 4.3, w: 7.5, h: 1.3, fontSize: 18, border: { type: 'solid', color: '9AAEC3', pt: 1 }, fill: { color: 'FFFFFF' } })
  presentation.addSlide().addText('未编辑的第二页', { x: 1, y: 1, w: 9, h: 1, fontSize: 30 })
  const generated = await presentation.write({ outputType: 'uint8array' })
  if (!(generated instanceof Uint8Array)) throw new Error('PPT generator did not return bytes')
  const parts = unzipSync(generated); parts['custom/opaque.bin'] = new Uint8Array([0, 17, 255, 2])
  // PptxGenJS 4.0.1 numbers its first table independently, duplicating title id=2.
  // This acceptance fixture needs valid unique OOXML identities; the product must
  // continue refusing ambiguous imported targets instead of selecting one silently.
  const firstSlide = strFromU8(parts['ppt/slides/slide1.xml'])
  expect(firstSlide).toContain('<p:cNvPr id="2" name="Table 0"/>')
  parts['ppt/slides/slide1.xml'] = strToU8(firstSlide.replace('<p:cNvPr id="2" name="Table 0"/>', '<p:cNvPr id="6" name="Table 0"/>'))
  const original = zipSync(parts); writeFileSync(filename, original)
  const initial = inspect(filename), title = initial.slides[0].shapes.find(object => object.name === 'editable-title')!
  const rectangle = initial.slides[0].shapes.find(object => object.name === 'editable-shape')!
  const table = initial.slides[0].shapes.find(object => object.kind === 'table')!
  expect(new Set(initial.slides[0].shapes.map(object => object.shapeId)).size).toBe(initial.slides[0].shapes.length)
  const evidence: Record<string, unknown> = { case: 'PPT formal original object editing', directory, originalHash: hash(original), phase: 'launch',
    boundary: 'Real human UI and file-owner integration; this case does not claim an actual model run or PowerPoint compatibility.' }
  const errors: string[] = []
  let { app, page } = await launchM20(fixture)
  page.on('pageerror', error => errors.push(error.message))
  try {
    const firstPid = app.process().pid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const preview = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('第 1 / 2 页')
    const picker = preview.getByLabel('选择幻灯片对象'), panel = preview.getByRole('complementary', { name: '演示文稿对象编辑' })
    const readyForNextEdit = async () => {
      await expect(preview).toContainText('已自动保存')
      await expect(picker).toBeEnabled()
      await expect(preview).toContainText('第 1 / 2 页')
    }
    await picker.selectOption(title.shapeId)
    await panel.getByLabel('对象文字').fill('人工修改保留 · 原件共编')
    await panel.getByLabel('字号', { exact: true }).fill('26')
    await panel.getByRole('button', { name: '应用修改', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === title.shapeId)?.text).toBe('人工修改保留 · 原件共编')
    await readyForNextEdit()
    expect(inspect(filename).slides[0].shapes.find(object => object.shapeId === title.shapeId)?.runs[0][0].style).toMatchObject({ fontSize: 26, bold: true, color: '183153' })
    evidence.phase = 'shape-drag-resize-and-style'
    await picker.selectOption(rectangle.shapeId)
    const element = preview.locator(`.pptx-file-preview__surface [data-el="${rectangle.shapeId}"]`).first()
    const bounds = await element.boundingBox()
    if (!bounds) throw new Error('The selected original shape is not visible')
    const oldX = inspect(filename).slides[0].shapes.find(object => object.shapeId === rectangle.shapeId)!.frame!.x
    // Drag the visible shape edge, away from the separate text object laid over it.
    await page.mouse.move(bounds.x + 12, bounds.y + 10)
    await page.mouse.down(); await page.mouse.move(bounds.x + 47, bounds.y + 22, { steps: 6 }); await page.mouse.up()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === rectangle.shapeId)!.frame!.x).toBeGreaterThan(oldX + 1)
    await readyForNextEdit()
    const oldWidth = inspect(filename).slides[0].shapes.find(object => object.shapeId === rectangle.shapeId)!.frame!.width
    await expect(preview.getByRole('button', { name: '拖动调整对象尺寸' })).toBeEnabled()
    await preview.getByRole('button', { name: '拖动调整对象尺寸' }).hover()
    const handle = await preview.getByRole('button', { name: '拖动调整对象尺寸' }).boundingBox()
    if (!handle) throw new Error('The original object resize handle is unavailable')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 20, handle.y + handle.height / 2 + 10, { steps: 6 }); await page.mouse.up()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === rectangle.shapeId)!.frame!.width).toBeGreaterThan(oldWidth + 1)
    await readyForNextEdit()
    await panel.getByLabel('填充', { exact: true }).fill('#e67b51')
    await panel.getByRole('button', { name: '应用修改', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === rectangle.shapeId)?.fill).toBe('E67B51')
    await readyForNextEdit()
    await panel.getByRole('button', { name: '置于底层', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes[0].shapeId).toBe(rectangle.shapeId)
    await readyForNextEdit()
    await page.screenshot({ path: join(directory, '01-original-shape-and-title.png'), fullPage: true })

    evidence.phase = 'replace-and-crop-original-image'
    const picture = initial.slides[0].shapes.find(object => object.name === 'editable-image')!
    await picker.selectOption(picture.shapeId)
    const replacement = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 36, g: 115, b: 194, alpha: 1 } } }).png().toBuffer()
    await panel.locator('input[type="file"]').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: replacement })
    await expect.poll(() => Object.keys(unzipSync(readFileSync(filename))).filter(name => name.startsWith('ppt/media/guoling-')).length).toBe(1)
    await readyForNextEdit()
    await panel.getByLabel('左侧', { exact: true }).fill('10')
    await panel.getByRole('button', { name: '应用修改', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === picture.shapeId)?.crop?.left).toBe(10)
    await readyForNextEdit()

    evidence.phase = 'table-and-undo-redo'
    await picker.selectOption(table.shapeId)
    await panel.getByLabel('第 1 行第 2 列').fill('共同编辑后的值')
    await panel.getByRole('button', { name: '应用修改', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1]).toBe('共同编辑后的值')
    await preview.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1]).toBe(initial.slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1])
    await preview.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1]).toBe('共同编辑后的值')
    expect(inspect(filename).slides[0].shapes.find(object => object.shapeId === title.shapeId)?.text).toBe('人工修改保留 · 原件共编')
    const accepted = readFileSync(filename), savedParts = unzipSync(accepted)
    expect(savedParts['custom/opaque.bin']).toEqual(parts['custom/opaque.bin'])
    expect(savedParts[initial.slides[1].part]).toEqual(parts[initial.slides[1].part])
    evidence.savedHash = hash(accepted); evidence.historyText = await preview.locator('details').innerText()
    await page.screenshot({ path: join(directory, '02-table-shared-history.png'), fullPage: true })

    evidence.phase = 'new-process-cold-reopen'
    await closeM20(app)
    ;({ app, page } = await launchM20(fixture))
    page.on('pageerror', error => errors.push(error.message))
    expect(app.process().pid).not.toBe(firstPid)
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const cold = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(cold).toContainText('第 1 / 2 页')
    await expect(cold.locator('.pptx-file-preview__surface')).toContainText('人工修改保留 · 原件共编')
    await expect(cold.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    expect(hash(readFileSync(filename))).toBe(hash(accepted))
    await cold.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1]).toBe(initial.slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1])
    await cold.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(object => object.shapeId === table.shapeId)?.cells?.[0][1]).toBe('共同编辑后的值')
    await page.screenshot({ path: join(directory, '03-cold-restored-history.png'), fullPage: true })
    expect(errors).toEqual([])
    evidence.errors = errors; evidence.status = 'real-object-ui-save-history-and-cold-reopen-passed'; evidence.phase = 'complete'
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { evidence.errors = errors; evidence.alerts = await page.getByRole('alert').allTextContents().catch(() => []); await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})
