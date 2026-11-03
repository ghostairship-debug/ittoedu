import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'

const inspect = (filename: string) => {
  const data = inspectOfficeContent(readFileSync(filename), 'pptx')
  if (data.format !== 'pptx') throw new Error('PPT expected')
  return data
}

test('professional PPT canvas edits text and geometry, manages pages, saves shared history and reopens', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(240000)
  const base = resolve('output/office-coedit-20261103/ppt-ui'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '画布共同编辑.pptx', filename = join(workspace, name), ppt = new PptxGenJS()
  ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  slide.background = { color: 'F5F7FB' }
  slide.addText('原始标题', { x: 1, y: .7, w: 9, h: .8, fontSize: 32, color: '20365B', objectName: 'editable-title' })
  slide.addShape(ppt.ShapeType.rect, { x: 1, y: 2.5, w: 3, h: 1.5, fill: { color: '71A4D7' }, line: { color: '315A83' }, objectName: 'move-me' })
  slide.addText('旁边内容必须保留', { x: 5, y: 3, w: 6, h: .7, fontSize: 24, objectName: 'keep' })
  ppt.addSlide().addText('第二页保持', { x: 1, y: 1, w: 9, h: 1, fontSize: 30 })
  const bytes = await ppt.write({ outputType: 'uint8array' })
  if (!(bytes instanceof Uint8Array)) throw new Error('bad fixture')
  const parts = unzipSync(bytes); parts['customXml/opaque.bin'] = Uint8Array.of(0, 47, 255, 91)
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'))
  writeFileSync(filename, zipSync(parts))
  const original = inspect(filename), shape = original.slides[0].shapes.find(s => s.name === 'move-me')!
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'open', boundary: 'Real Electron UI and original OOXML roundtrip; model and PowerPoint validation recorded separately.' }
  const errors: string[] = []
  let { app, page } = await launchM20(fixture)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const editor = page.locator('.pptx-editor'), stage = editor.getByTestId('pptx-edit-surface')
    await expect(stage).toContainText('原始标题', { timeout: 45000 })
    facts.openedAt = new Date().toISOString()
    await stage.getByText('原始标题', { exact: true }).first().dblclick()
    const textEditor = stage.locator('[contenteditable="true"]').filter({ visible: true }).first()
    await expect(textEditor).toBeVisible()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('人工直接编辑后的标题')
    await page.keyboard.press('Escape')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(s => s.name === 'editable-title')?.text).toBe('人工直接编辑后的标题')
    facts.phase = 'move'
    const rendered = stage.locator('[data-edit-id]').filter({ has: stage.locator('path') })
    const rect = await stage.locator('[data-edit-id]').evaluateAll(nodes => {
      const target = nodes.find(node => {
        const r = node.getBoundingClientRect()
        return r.width > 70 && r.width < 280 && r.height > 40 && r.height < 170 && !node.textContent?.trim()
      })
      if (!target) return null
      const r = target.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (!rect) throw new Error('Movable rectangle was not rendered')
    void rendered
    await page.mouse.move(rect.x + 15, rect.y + 15); await page.mouse.down()
    await page.mouse.move(rect.x + 60, rect.y + 35, { steps: 6 }); await page.mouse.up()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[0].shapes.find(s => s.name === 'move-me')?.frame?.x ?? 0).toBeGreaterThan(shape.frame!.x)
    await page.screenshot({ path: join(directory, '01-canvas-edited.png'), fullPage: true })
    facts.phase = 'pages'
    await editor.getByRole('button', { name: '复制幻灯片', exact: true }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => inspect(filename).slides.length).toBe(3)
    await editor.getByRole('button', { name: '下移幻灯片', exact: true }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => inspect(filename).slides[1].shapes.some(s => s.text === '第二页保持')).toBe(true)
    await editor.getByRole('button', { name: '删除幻灯片', exact: true }).click()
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => inspect(filename).slides.length).toBe(2)
    await editor.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(() => inspect(filename).slides.length).toBe(3)
    await editor.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(() => inspect(filename).slides.length).toBe(2)
    expect(unzipSync(readFileSync(filename))['customXml/opaque.bin']).toEqual(parts['customXml/opaque.bin'])
    expect(inspect(filename).slides[0].shapes.find(s => s.name === 'keep')?.text).toBe('旁边内容必须保留')
    facts.phase = 'cold-reopen'; const previousPid = app.process().pid
    await closeM20(app); ({ app, page } = await launchM20(fixture))
    page.on('pageerror', error => errors.push(error.message))
    expect(app.process().pid).not.toBe(previousPid)
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    await expect(page.getByTestId('pptx-edit-surface')).toContainText('人工直接编辑后的标题', { timeout: 45000 })
    await expect(page.locator('.pptx-editor').getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
    facts.status = 'passed'; facts.phase = 'complete'; facts.errors = errors
    await m20Evidence(info, fixture, page, facts)
  } catch (error) {
    facts.errors = errors; facts.alerts = await page.getByRole('alert').allTextContents().catch(() => [])
    await m20Evidence(info, fixture, page, facts, error); throw error
  } finally { await closeM20(app) }
})
