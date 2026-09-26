import { expect, test } from '@playwright/test'
import { LIGHT_SLIDE_FONTS } from '../../src/core/tools/lightSlideEditing'
import { canvasReady } from './helpers/g20M21Harness'
import { CANVAS, closeM22, COURSE, FIRST, firstScene, item, launchM22, menuCommand, project, savedProject, selectItem } from './helpers/g20M22Harness'

// M22-T01 requirement assertions. The command port exists; the current production quick-bar/menu wiring is pending
// integration by the owner. Keep these UI assertions strict instead of replacing them with direct port calls.
test('M22-T01 workbench edits opacity, font, two-line spacing, page background and page alignment in formal history', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance')
  test.setTimeout(180_000)
  const h = await launchM22('properties')
  try {
    const { page, frame, read } = h
    const before = await read()
    expect(project(before).surfaces[0]?.type).toBe('slide')
    expect(firstScene(before).layerItems).toHaveLength(2)
    await selectItem(page, 'm22-title')

    await menuCommand(page, '不透明度：50%')
    await expect.poll(async () => item(await read(), 'm22-title').opacity).toBe(0.5)
    await expect.poll(async () => page.locator('[data-slide-layer-item="m22-title"]:visible').first()
      .evaluate(element => Number(getComputedStyle(element).opacity))).toBeCloseTo(0.5)
    const afterOpacity = await read()
    expect(afterOpacity.undoDepth).toBe(before.undoDepth + 1)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-title').opacity).toBe(1)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-title').opacity).toBe(0.5)

    const font = LIGHT_SLIDE_FONTS[0]
    if (!font) throw new Error('No bundled font')
    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '字体', exact: true }).click()
    await page.getByRole('menu', { name: '字体' }).getByRole('menuitem', { name: new RegExp(`字体：${font.label}`) }).click()
    await expect.poll(async () => {
      const selected = item(await read(), 'm22-title')
      return selected.kind === 'native' && selected.content.nativeType === 'text' ? selected.content.data.style.fontFamily : null
    }).toBe(font.family)
    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '行距', exact: true }).click()
    await page.getByRole('menu', { name: '行距' }).getByRole('menuitem', { name: /行距：宽松（额外 8 像素）/ }).click()
    await expect.poll(async () => {
      const selected = item(await read(), 'm22-title')
      return selected.kind === 'native' && selected.content.nativeType === 'text' ? selected.content.data.style.lineSpacing : null
    }).toBe(8)
    // The fixture has two actual text lines: the line boxes must separate more than in the initial rendering.
    const lines = page.locator('[data-slide-layer-item="m22-title"] [data-text-line]:visible')
    await expect(lines).toHaveCount(2)
    const tops = await lines.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
    expect(tops[1]! - tops[0]!).toBeGreaterThan(20)

    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '页面背景', exact: true }).click()
    await page.getByRole('menu', { name: '页面背景' }).getByRole('menuitem', { name: /页面背景：#dbeafe/ }).click()
    await expect.poll(async () => firstScene(await read()).backgroundColor).toBe('#dbeafe')
    await selectItem(page, 'm22-title')
    await menuCommand(page, '对齐页面水平居中')
    await expect.poll(async () => item(await read(), 'm22-title').frame.x).toBe((CANVAS.width - FIRST.width) / 2)
    expect(await frame.getAttribute('data-editor-mode')).toBe('light')

    await frame.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await read()).dirty).toBe(false)
    const saved = await read()
    expect(savedProject(h.courseFile)).toEqual(project(saved))
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true }).dblclick()
    await canvasReady(page)
    const reopenedId = await frame.getAttribute('data-document-id')
    expect(reopenedId).not.toBe(h.documentId)
    if (!reopenedId) throw new Error('No reopened document')
    const reopened = await page.evaluate(id => window.desktopAPI!.documents!.read(id), reopenedId)
    expect(project(reopened)).toEqual(project(saved))
    expect(reopened.dirty).toBe(false)
  } finally { await closeM22(h.app) }
})
