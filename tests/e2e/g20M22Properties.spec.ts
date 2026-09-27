import { expect, test } from '@playwright/test'
import { LIGHT_SLIDE_FONTS } from '../../src/core/tools/lightSlideEditing'
import { canvasReady } from './helpers/g20M21Harness'
import { CANVAS, closeM22, COURSE, FIRST, firstScene, item, launchM22, menuCommand, project, retainM22Evidence, savedProject, selectItem } from './helpers/g20M22Harness'

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
    expect(firstScene(before).layerItems).toHaveLength(3)
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

    await selectItem(page, 'm22-picture')
    await menuCommand(page, '不透明度：50%')
    await expect.poll(async () => item(await read(), 'm22-picture').opacity).toBe(0.5)
    await expect.poll(async () => page.locator('[data-slide-layer-item="m22-picture"]:visible').first()
      .evaluate(element => Number(getComputedStyle(element).opacity))).toBeCloseTo(0.5)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-picture').opacity).toBe(1)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-picture').opacity).toBe(0.5)

    const font = LIGHT_SLIDE_FONTS[0]
    if (!font) throw new Error('No bundled font')
    const originalFont = item(await read(), 'm22-title')
    if (originalFont.kind !== 'native' || originalFont.content.nativeType !== 'text') throw new Error('Expected Native text')
    const beforeFont = originalFont.content.data.style.fontFamily
    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '字体', exact: true }).click()
    await page.getByRole('menu', { name: '字体' }).getByRole('menuitem', { name: new RegExp(`字体：${font.label}`) }).click()
    await expect.poll(async () => {
      const selected = item(await read(), 'm22-title')
      return selected.kind === 'native' && selected.content.nativeType === 'text' ? selected.content.data.style.fontFamily : null
    }).toBe(font.family)
    const fontFamily = new RegExp(font.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    await expect(page.locator('[data-slide-layer-item="m22-title"] [data-text-line]:visible').first()).toHaveCSS('font-family', fontFamily)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => { const value = item(await read(), 'm22-title'); return value.kind === 'native' && value.content.nativeType === 'text' ? value.content.data.style.fontFamily : null }).toBe(beforeFont)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => { const value = item(await read(), 'm22-title'); return value.kind === 'native' && value.content.nativeType === 'text' ? value.content.data.style.fontFamily : null }).toBe(font.family)
    await expect(page.locator('[data-slide-layer-item="m22-title"] [data-text-line]:visible').first()).toHaveCSS('font-family', fontFamily)
    const originalSpacingItem = item(await read(), 'm22-title')
    if (originalSpacingItem.kind !== 'native' || originalSpacingItem.content.nativeType !== 'text') throw new Error('Expected Native text')
    const beforeSpacing = originalSpacingItem.content.data.style.lineSpacing
    const lines = page.locator('[data-slide-layer-item="m22-title"] [data-text-line]:visible')
    await expect(lines).toHaveCount(2)
    const lineGap = () => lines.evaluateAll(elements => elements[1]!.getBoundingClientRect().top - elements[0]!.getBoundingClientRect().top)
    const beforeGap = await lineGap()
    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '行距', exact: true }).click()
    await page.getByRole('menu', { name: '行距' }).getByRole('menuitem', { name: /行距：宽松（额外 8 像素）/ }).click()
    await expect.poll(async () => {
      const selected = item(await read(), 'm22-title')
      return selected.kind === 'native' && selected.content.nativeType === 'text' ? selected.content.data.style.lineSpacing : null
    }).toBe(8)
    // The fixture has two actual text lines: the line boxes must separate more than in the initial rendering.
    await expect.poll(lineGap).toBeGreaterThan(beforeGap)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => { const value = item(await read(), 'm22-title'); return value.kind === 'native' && value.content.nativeType === 'text' ? value.content.data.style.lineSpacing : null }).toBe(beforeSpacing)
    await expect.poll(lineGap).toBeCloseTo(beforeGap, 1)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => { const value = item(await read(), 'm22-title'); return value.kind === 'native' && value.content.nativeType === 'text' ? value.content.data.style.lineSpacing : null }).toBe(8)
    await expect.poll(lineGap).toBeGreaterThan(beforeGap)

    const beforeBackground = firstScene(await read()).backgroundColor
    await selectItem(page, 'm22-title')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '页面背景', exact: true }).click()
    await page.getByRole('menu', { name: '页面背景' }).getByRole('menuitem', { name: /页面背景：#dbeafe/ }).click()
    await expect.poll(async () => firstScene(await read()).backgroundColor).toBe('#dbeafe')
    await expect.poll(async () => page.locator('.canvas-stage-stack').evaluate(element => {
      const target = [...element.querySelectorAll('*')].find(node => getComputedStyle(node).backgroundColor === 'rgb(219, 234, 254)')
      return Boolean(target)
    })).toBe(true)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => firstScene(await read()).backgroundColor).toBe(beforeBackground)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => firstScene(await read()).backgroundColor).toBe('#dbeafe')
    const beforeAlignBox = await page.locator('[data-slide-layer-item="m22-title"]:visible').first().boundingBox()
    if (!beforeAlignBox) throw new Error('No painted text before alignment')
    await selectItem(page, 'm22-title')
    await menuCommand(page, '对齐页面水平居中')
    await expect.poll(async () => item(await read(), 'm22-title').frame.x).toBe((CANVAS.width - FIRST.width) / 2)
    await expect.poll(async () => (await page.locator('[data-slide-layer-item="m22-title"]:visible').first().boundingBox())?.x ?? Number.NEGATIVE_INFINITY)
      .toBeGreaterThan(beforeAlignBox.x)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-title').frame.x).toBe(FIRST.x)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => item(await read(), 'm22-title').frame.x).toBe((CANVAS.width - FIRST.width) / 2)
    expect(await frame.getAttribute('data-editor-mode')).toBe('light')

    const currentProject = project(await read())
    const blankSurface = currentProject.surfaces[0]
    if (blankSurface?.type !== 'slide') throw new Error('No Slide surface for blank page')
    const blankScene = blankSurface.scenes[2]
    if (!blankScene || blankScene.name !== '空白页') throw new Error('No blank Slide scene')
    const blankLocation = currentProject.locations.find(location => location.kind === 'slide-scene'
      && location.surfaceId === blankSurface.id && location.sceneId === blankScene.id && location.stateId === undefined)
    if (!blankLocation) throw new Error('No blank Slide location')
    await frame.getByTestId(`bottom-scene-${blankLocation.id}`).locator('.bottom-scene-card__main').click()
    await expect(page.locator('[data-slide-layer-item]:visible')).toHaveCount(0)
    const pageActions = page.getByRole('button', { name: '页面操作', exact: true })
    await expect(pageActions).toBeVisible()
    await pageActions.click()
    await page.getByRole('menuitem', { name: '页面背景：#dcfce7', exact: true }).click()
    await expect.poll(async () => {
      const slide = project(await read()).surfaces[0]
      return slide.type === 'slide' ? slide.scenes[2]?.backgroundColor : null
    }).toBe('#dcfce7')
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => { const slide = project(await read()).surfaces[0]; return slide.type === 'slide' ? slide.scenes[2]?.backgroundColor : null }).not.toBe('#dcfce7')
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => { const slide = project(await read()).surfaces[0]; return slide.type === 'slide' ? slide.scenes[2]?.backgroundColor : null }).toBe('#dcfce7')
    await pageActions.click()
    await expect(page.getByRole('menuitem', { name: '放置音频', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await frame.getByTestId(`bottom-scene-${h.fixture.firstLocationId}`).locator('.bottom-scene-card__main').click()
    await canvasReady(page)

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
  } finally { try { await retainM22Evidence(h, 'properties') } finally { await closeM22(h.app) } }
})
