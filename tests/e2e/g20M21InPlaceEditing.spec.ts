import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { openInWorkbench, pixelAt, root, sameColour, settledRect, type Rect } from './helpers/g20M19Harness'
import { CANVAS, canvasReady, centre, CLIP, closeMenu, contextMenuAt, FRAMES, HINT, inPlaceCourse, menuItems, onStage, SPLIT } from './helpers/g20M21Harness'

const COURSE = 'm21-t07.h5lesson'
const BLANK = { x: 1100, y: 640 }
const MATERIALS = join(root, 'tests/fixtures/r18CommonTasks/materials')

type Item = { id: string; label: string; visible: boolean; frame: Rect; nativeType: string | null; data: Record<string, unknown> | null }

/** The course as the main process holds it: the slide scene's objects and the infinite canvas's world objects. */
async function course(page: Page): Promise<{ revision: number; dirty: boolean; items: Item[]; world: Item[] }> {
  return page.evaluate(async file => {
    const found = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
    if (!found || found.model.kind !== 'course-v9') throw new Error(`no course ${file}`)
    const slide = found.model.project.surfaces.find(surface => surface.type === 'slide')
    const spatial = found.model.project.surfaces.find(surface => surface.type === 'spatial-2d')
    if (slide?.type !== 'slide' || spatial?.type !== 'spatial-2d') throw new Error('slide and spatial surfaces')
    const view = (entry: (typeof slide.scenes)[number]['layerItems'][number]) => ({
      id: entry.layerItemId, label: entry.label, visible: entry.visible,
      frame: { x: entry.frame.x, y: entry.frame.y, width: entry.frame.width, height: entry.frame.height },
      nativeType: entry.kind === 'native' ? entry.content.nativeType : null,
      data: entry.kind === 'native' ? entry.content.data as unknown as Record<string, unknown> : null,
    })
    return { revision: found.revision, dirty: found.dirty, items: slide.scenes[0]!.layerItems.map(view), world: spatial.world.layerItems.map(view) }
  }, COURSE)
}

const near = (actual: number, expected: number, tolerance = 0.5) => Math.abs(actual - expected) <= tolerance

test('M21-T07 crop and fit, video replacement, hidden objects, shapes and formulas, all in the workbench', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m21/in-place-editing'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, COURSE), inPlaceCourse(new Uint8Array(readFileSync(join(MATERIALS, 'motion.webm')))))
  const replacement = join(directory, '新视频.webm'), replacementBytes = readFileSync(join(MATERIALS, 'motion-blue.webm'))
  writeFileSync(replacement, replacementBytes)
  const evidence: Record<string, unknown> = { run: directory }
  const errors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    // The folder picker answers with the workspace; a file picker with the file the step named.
    await app.evaluate(({ dialog }, folder) => {
      const state = globalThis as unknown as { m21Pick?: string }
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : state.m21Pick ?? ''] }
      }
    }, workspace)
    const pick = (file: string) => app!.evaluate((_electron, path) => { (globalThis as unknown as { m21Pick?: string }).m21Pick = path }, file)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true })).toBeVisible()

    const mode = () => page.locator('.course-editor-frame').first().getAttribute('data-editor-mode')
    const stage = () => settledRect(page, '.canvas-stage-stack')
    const item = async (id: string) => {
      const found = (await course(page)).items.find(entry => entry.id === id)
      if (!found) throw new Error(`no item ${id}`)
      return found
    }
    const quickBar = page.locator('[data-selection-quick-bar]').filter({ visible: true })
    const barLabels = () => quickBar.locator('[role="toolbar"] > button, [role="toolbar"] > * > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
    const click = (point: { x: number; y: number }) => page.mouse.click(point.x, point.y)
    // A background test window paints on input: nudge the pointer (away from the page) before reading a pixel.
    let nudge = 0
    const colourAt = async (point: { x: number; y: number }) => {
      await page.mouse.move(8 + (nudge++ % 2), 8)
      return pixelAt(page, page, point.x, point.y)
    }
    const redo = page.getByLabel('常用工具').getByRole('button', { name: '重做', exact: true })

    await openInWorkbench(page, COURSE)
    await canvasReady(page)
    expect(await mode()).toBe('light')

    // ---------------------------------------------------------------- fit and crop
    await test.step('M21-T07 an image switches how it fills its frame on the quick bar, as seen and undoable', async () => {
      const box = await stage()
      const photo = FRAMES.photo
      await click(onStage(box, centre(photo)))
      await expect(quickBar.getByRole('button', { name: '裁剪', exact: true })).toBeVisible()
      const labels = await barLabels()
      expect(labels.slice(0, 3)).toEqual(['替换图片', '裁剪', '显示方式'])
      evidence.imageBar = labels
      // 适应 shows the square photo whole, with bands at the sides of the 16:9 frame; 填充 fills the frame.
      const band = onStage(box, { x: photo.x + 30, y: photo.y + 90 })
      await expect.poll(async () => sameColour(await colourAt(onStage(box, { x: photo.x + 120, y: photo.y + 90 })), SPLIT.left, 40)).toBe(true)
      expect(sameColour(await colourAt(band), SPLIT.left, 40)).toBe(false)
      const start = await course(page)
      await quickBar.getByRole('button', { name: '显示方式', exact: true }).click()
      const fit = page.getByRole('menu', { name: '显示方式' })
      await expect(fit.getByRole('menuitemradio', { name: '适应（完整显示）', exact: true })).toHaveAttribute('aria-checked', 'true')
      await fit.getByRole('menuitemradio', { name: '填充（允许裁剪）', exact: true }).click()
      await expect.poll(async () => (await item('photo')).data?.fit).toBe('cover')
      expect((await course(page)).revision).toBe(start.revision + 1)
      await expect.poll(async () => sameColour(await colourAt(band), SPLIT.left, 40)).toBe(true)
      await page.screenshot({ path: join(shots, 't07-fit-cover.png') })
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await item('photo')).data?.fit).toBe('contain')
      await expect.poll(async () => sameColour(await colourAt(band), SPLIT.left, 40)).toBe(false)
      await redo.click()
      await expect.poll(async () => (await item('photo')).data?.fit).toBe('cover')
      await expect(quickBar.getByRole('button', { name: '显示方式', exact: true })).toContainText('填充')
      expect(await mode()).toBe('light')
    })

    await test.step('M21-T07 dragging the crop handles crops in place: what the box shows is what stays, in one undo step', async () => {
      const box = await stage(), scale = box.width / CANVAS.width
      await quickBar.getByRole('button', { name: '裁剪', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '裁剪图片' })
      await expect(dialog).toBeVisible()
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(1)
      // In 填充 the square is cut at the top and bottom; the crop shows those parts faintly, 70 units each side.
      const whole = (await dialog.locator('.image-crop__whole').boundingBox())!
      expect(near(whole.height, 320 * scale, 1)).toBe(true)
      expect(near(whole.y, box.y + (FRAMES.photo.y - 70) * scale, 1)).toBe(true)
      await page.screenshot({ path: join(shots, 't07-crop-open.png') })
      const drag = async (name: string, dx: number, dy: number) => {
        const handle = (await dialog.getByRole('slider', { name, exact: true }).boundingBox())!
        const from = centre(handle)
        await page.mouse.move(from.x, from.y); await page.mouse.down()
        await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 })
        await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 })
        await page.mouse.up()
      }
      // Keep the blue half, and bring back 40 units of what 填充 had cut off at the top.
      await drag('裁剪右边', -160 * scale, 0)
      await drag('裁剪上边', 0, -40 * scale)
      const kept = (await dialog.getByTestId('image-crop-box').boundingBox())!
      expect(near(kept.width, 160 * scale, 1) && near(kept.height, 220 * scale, 1)).toBe(true)
      await page.screenshot({ path: join(shots, 't07-crop-dragged.png') })
      const before = await course(page)
      await dialog.getByRole('button', { name: '完成', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => near((await item('photo')).frame.width, 160)).toBe(true)
      const cropped = await item('photo')
      const crop = cropped.data?.crop as { left: number; top: number; right: number; bottom: number }
      expect(near(cropped.frame.x, 760) && near(cropped.frame.y, 20) && near(cropped.frame.height, 220)).toBe(true)
      expect(near(crop.left, 0, 0.002) && near(crop.top, 30 / 320, 0.002) && near(crop.right, 0.5, 0.002) && near(crop.bottom, 70 / 320, 0.002)).toBe(true)
      expect((await course(page)).revision).toBe(before.revision + 1)
      // What the box showed is where the image now is: the same rectangle, blue throughout, the orange half gone.
      const shown = onStage(box, cropped.frame)
      expect(near(shown.x, kept.x, 1) && near(shown.y, kept.y, 1)).toBe(true)
      await expect.poll(async () => sameColour(await colourAt(onStage(box, { x: 840, y: 30 })), SPLIT.left, 40)).toBe(true)
      expect(sameColour(await colourAt(onStage(box, { x: 840, y: 200 })), SPLIT.left, 40)).toBe(true)
      expect(sameColour(await colourAt(onStage(box, { x: 1000, y: 130 })), SPLIT.right, 60)).toBe(false)
      await page.screenshot({ path: join(shots, 't07-cropped.png') })
      evidence.crop = { whole, kept, frame: cropped.frame, crop, revision: [before.revision, before.revision + 1] }
      // One undo restores both the frame and the crop; redo brings the crop back.
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await item('photo')).frame).toEqual(FRAMES.photo)
      expect((await item('photo')).data).toMatchObject({ fit: 'cover', crop: { left: 0, top: 0, right: 0, bottom: 0 } })
      await expect.poll(async () => sameColour(await colourAt(onStage(box, { x: 1000, y: 130 })), SPLIT.right, 60)).toBe(true)
      await redo.click()
      await expect.poll(async () => near((await item('photo')).frame.width, 160)).toBe(true)
      // 取消 leaves the image as it is.
      await quickBar.getByRole('button', { name: '裁剪', exact: true }).click()
      await drag('裁剪左边', 40 * scale, 0)
      const unchanged = await course(page)
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect((await course(page)).revision).toBe(unchanged.revision)
      expect(await mode()).toBe('light')
    })

    // ---------------------------------------------------------------- video
    await test.step('M21-T07 replacing the video keeps its place, size and settings', async () => {
      const box = await stage()
      const before = await item('clip')
      await click(onStage(box, centre(CLIP)))
      await expect(quickBar.getByRole('button', { name: '替换视频', exact: true })).toBeVisible()
      evidence.videoBar = await barLabels()
      const menu = await contextMenuAt(page, onStage(box, centre(CLIP)), '对象操作')
      expect((await menuItems(menu))[0]).toEqual({ label: '替换视频…', reason: null })
      await closeMenu(page)
      await pick(replacement)
      await quickBar.getByRole('button', { name: '替换视频', exact: true }).click()
      await expect.poll(async () => (await item('clip')).data?.assetId).not.toBe('clip')
      const after = await item('clip')
      expect(after.frame).toEqual(before.frame)
      expect({ ...after.data, assetId: null }).toEqual({ ...before.data, assetId: null })
      await expect(quickBar.getByRole('button', { name: '替换视频', exact: true })).toBeVisible()
      await page.screenshot({ path: join(shots, 't07-video-replaced.png') })
      evidence.video = { before: before.data?.assetId, after: after.data?.assetId, frame: after.frame }
      expect(await mode()).toBe('light')
    })

    // ---------------------------------------------------------------- hidden objects
    await test.step('M21-T07 hidden objects are found and shown again in the workbench', async () => {
      const box = await stage()
      const count = (n: number) => page.getByRole('button', { name: `${n} 个隐藏对象`, exact: true })
      await click(onStage(box, BLANK))
      await expect(count(1)).toBeVisible()
      const canvas = await contextMenuAt(page, onStage(box, BLANK), '画布操作')
      expect((await menuItems(canvas)).find(entry => entry.label === '找回隐藏的对象')).toEqual({ label: '找回隐藏的对象', reason: null })
      await canvas.getByRole('menuitem', { name: '找回隐藏的对象', exact: true }).click()
      const hidden = page.getByRole('menu', { name: '隐藏的对象' })
      expect((await menuItems(hidden)).map(entry => entry.label)).toEqual([`显示“${HINT}”`])
      await page.screenshot({ path: join(shots, 't07-hidden-menu.png') })
      await hidden.getByRole('menuitem', { name: `显示“${HINT}”`, exact: true }).click()
      await expect.poll(async () => (await item('hint')).visible).toBe(true)
      await expect(count(1)).toHaveCount(0)
      // What came back is selected, with its quick bar.
      await expect(quickBar.getByRole('button', { name: '编辑文字', exact: true })).toBeVisible()
      const none = (await menuItems(await contextMenuAt(page, onStage(box, BLANK), '画布操作'))).find(entry => entry.label === '找回隐藏的对象')
      expect(none?.reason).toBe('本页没有隐藏的对象')
      await closeMenu(page)
      // Hide two from their quick bars; the label counts them and shows both again at once.
      const hide = async (frame: Rect) => {
        await click(onStage(box, centre(frame)))
        await quickBar.getByRole('button', { name: '更多操作', exact: true }).click()
        await page.getByRole('menu', { name: '更多操作' }).getByRole('menuitem', { name: '隐藏', exact: true }).click()
      }
      await hide(FRAMES.title)
      await expect.poll(async () => (await item('title')).visible).toBe(false)
      await hide(FRAMES.note)
      await expect.poll(async () => (await item('hint')).visible).toBe(false)
      await click(onStage(box, BLANK))
      await expect(count(2)).toBeVisible()
      await page.screenshot({ path: join(shots, 't07-hidden-count.png') })
      await count(2).click()
      await expect(page.getByRole('menu', { name: '隐藏的对象' })).toBeVisible()
      const both = await menuItems(page.getByRole('menu', { name: '隐藏的对象' }))
      expect(both.map(entry => entry.label).slice(0, 2).sort()).toEqual(['显示“课题”', `显示“${HINT}”`].sort())
      expect(both[2]?.label).toBe('全部显示')
      await page.getByRole('menu', { name: '隐藏的对象' }).getByRole('menuitem', { name: '全部显示', exact: true }).click()
      await expect.poll(async () => [(await item('title')).visible, (await item('hint')).visible]).toEqual([true, true])
      await expect(count(2)).toHaveCount(0)
      // The hint stays hidden for the save-and-reopen check.
      await hide(FRAMES.note)
      await click(onStage(box, BLANK))
      await expect(count(1)).toBeVisible()
      evidence.hidden = { menu: both }
      expect(await mode()).toBe('light')
    })

    // ---------------------------------------------------------------- shapes and formulas
    await test.step('M21-T07 shapes and formulas are inserted from the workbench and changed there', async () => {
      const insert = page.getByLabel('常用工具').getByRole('button', { name: '插入', exact: true })
      const menu = page.locator('#course-light-insert-menu')
      await insert.click()
      const shapes = await menu.getByRole('group', { name: '形状' }).getByRole('button').evaluateAll(buttons => buttons.map(button => button.textContent ?? ''))
      expect(shapes).toEqual(['矩形', '圆角矩形', '椭圆', '三角形', '直线', '箭头'])
      await page.screenshot({ path: join(shots, 't07-insert-menu.png') })
      const count = (await course(page)).items.length
      await menu.getByRole('button', { name: '插入椭圆', exact: true }).click()
      await expect.poll(async () => (await course(page)).items.length).toBe(count + 1)
      const ellipse = (await course(page)).items.find(entry => entry.nativeType === 'shape' && entry.data?.shapeType === 'ellipse')!
      expect(ellipse).toBeTruthy()
      // The new shape is selected, with its quick bar: pick a fill from the palette.
      await quickBar.getByRole('button', { name: '填充颜色', exact: true }).click()
      const swatch = page.getByRole('group', { name: '填充颜色', exact: true }).getByRole('radiogroup', { name: '常用色' }).getByRole('radio').nth(3)
      const colour = (await swatch.getAttribute('title'))!.split(' ').at(-1)!.toLowerCase()
      await swatch.click()
      await expect.poll(async () => JSON.stringify((await item(ellipse.id)).data).toLowerCase()).toContain(colour)
      await page.screenshot({ path: join(shots, 't07-shape-filled.png') })

      await insert.click()
      await menu.getByRole('button', { name: '插入公式', exact: true }).click()
      await expect.poll(async () => (await course(page)).items.filter(entry => entry.nativeType === 'formula').length).toBe(1)
      const formula = (await course(page)).items.find(entry => entry.nativeType === 'formula')!
      await expect(quickBar.getByRole('button', { name: '编辑公式', exact: true })).toBeVisible()
      evidence.formulaBar = await barLabels()
      await quickBar.getByRole('button', { name: '编辑公式', exact: true }).click()
      const editor = page.getByTestId('formula-edit-dialog')
      await expect(editor).toBeVisible()
      // The quick bar steps aside while the formula editor is open.
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(1)
      await editor.getByLabel('公式内容（线性输入）').fill('x^2+1')
      await page.screenshot({ path: join(shots, 't07-formula-editor.png') })
      await editor.getByRole('button', { name: '应用公式', exact: true }).click()
      await expect(editor).toHaveCount(0)
      await expect.poll(async () => JSON.stringify((await item(formula.id)).data?.ast)).not.toBe(JSON.stringify(formula.data?.ast))
      const edited = await item(formula.id)
      // The right-click menu opens the same editor.
      const box = await stage()
      const formulaMenu = await contextMenuAt(page, onStage(box, centre(edited.frame)), '对象操作')
      expect((await menuItems(formulaMenu))[0]).toEqual({ label: '编辑公式', reason: null })
      await formulaMenu.getByRole('menuitem', { name: '编辑公式', exact: true }).click()
      await expect(editor).toBeVisible()
      await editor.getByRole('button', { name: '关闭公式编辑', exact: true }).click()
      await expect(editor).toHaveCount(0)
      evidence.inserted = { shapes, ellipse: ellipse.id, colour, formula: { id: formula.id, before: formula.data?.accessibleText, after: edited.data?.accessibleText } }
      expect(await mode()).toBe('light')
    })

    await test.step('M21-T07 on the infinite canvas a formula is inserted and edited from the workbench the same way', async () => {
      const pages = page.getByRole('navigation', { name: '场景与页面导航' })
      await pages.getByRole('button', { name: /^无限画布 \d+：空间$/ }).click()
      await expect(page.locator('[data-observation-spatial-camera]').filter({ visible: true }).first()).toBeVisible()
      await page.getByLabel('常用工具').getByRole('button', { name: '插入', exact: true }).click()
      await page.locator('#course-light-insert-menu').getByRole('button', { name: '插入公式', exact: true }).click()
      await expect.poll(async () => (await course(page)).world.filter(entry => entry.nativeType === 'formula').length).toBe(1)
      const formula = (await course(page)).world.find(entry => entry.nativeType === 'formula')!
      await expect(quickBar.getByRole('button', { name: '编辑公式', exact: true })).toBeVisible()
      const worldBar = await barLabels()
      await quickBar.getByRole('button', { name: '编辑公式', exact: true }).click()
      const editor = page.getByTestId('formula-edit-dialog')
      await expect(editor).toBeVisible()
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(1)
      await editor.getByLabel('公式内容（线性输入）').fill('a/b')
      await page.screenshot({ path: join(shots, 't07-spatial-formula-editor.png') })
      await editor.getByRole('button', { name: '应用公式', exact: true }).click()
      await expect(editor).toHaveCount(0)
      await expect.poll(async () => JSON.stringify((await course(page)).world.find(entry => entry.id === formula.id)?.data?.ast)).not.toBe(JSON.stringify(formula.data?.ast))
      // A hidden world object is found and shown again the same way as on a slide.
      await quickBar.getByRole('button', { name: '更多操作', exact: true }).click()
      await page.getByRole('menu', { name: '更多操作' }).getByRole('menuitem', { name: '隐藏', exact: true }).click()
      await expect.poll(async () => (await course(page)).world.find(entry => entry.id === formula.id)?.visible).toBe(false)
      // Hidden means not drawn, as on a slide.
      const drawn = page.locator(`.spatial-world-item[data-layer-item-id="${formula.id}"]`)
      await expect(drawn).toHaveCount(0)
      const world = await settledRect(page, '[data-testid="spatial-stage-stack"]')
      const blank = { x: world.x + 60, y: world.y + 60 }
      await click(blank)
      const hiddenCount = page.getByRole('button', { name: '1 个隐藏对象', exact: true })
      await expect(hiddenCount).toBeVisible()
      const worldMenu = (await menuItems(await contextMenuAt(page, blank, '画布操作'))).find(entry => entry.label === '找回隐藏的对象')
      expect(worldMenu).toEqual({ label: '找回隐藏的对象', reason: null })
      await closeMenu(page)
      await hiddenCount.click()
      const worldHidden = page.getByRole('menu', { name: '隐藏的对象' })
      await expect(worldHidden).toBeVisible()
      const worldHiddenItems = (await menuItems(worldHidden)).map(entry => entry.label)
      expect(worldHiddenItems).toEqual(['显示“公式”'])
      await page.screenshot({ path: join(shots, 't07-spatial-hidden.png') })
      await worldHidden.getByRole('menuitem', { name: '显示“公式”', exact: true }).click()
      await expect.poll(async () => (await course(page)).world.find(entry => entry.id === formula.id)?.visible).toBe(true)
      await expect(hiddenCount).toHaveCount(0)
      await expect(drawn).toHaveCount(1)
      await expect(quickBar.getByRole('button', { name: '编辑公式', exact: true })).toBeVisible()
      evidence.spatialFormula = { bar: worldBar, id: formula.id, hidden: worldHiddenItems }
      expect(await mode()).toBe('light')
      // Back to the slide scene for saving.
      await page.getByRole('navigation', { name: '场景与页面导航' }).locator('li[data-kind="slide"]').first().click({ position: { x: 30, y: 20 } })
      await canvasReady(page)
    })

    // ---------------------------------------------------------------- save and reopen
    await test.step('M21-T07 save and reopen: the file and the workbench show what was saved', async () => {
      await click(onStage(await stage(), BLANK))
      const saved = await course(page)
      await page.keyboard.press('Control+S')
      await expect.poll(async () => (await course(page)).dirty).toBe(false)
      const disk = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, COURSE))))
      const slide = disk.project.surfaces.find(surface => surface.type === 'slide')
      if (slide?.type !== 'slide') throw new Error('slide surface')
      const onDisk = slide.scenes[0]!.layerItems
      for (const entry of saved.items) {
        const stored = onDisk.find(candidate => candidate.layerItemId === entry.id)!
        expect({ visible: stored.visible, frame: { x: stored.frame.x, y: stored.frame.y, width: stored.frame.width, height: stored.frame.height },
          data: stored.kind === 'native' ? stored.content.data : null }).toEqual({ visible: entry.visible, frame: entry.frame, data: entry.data })
      }
      const clip = saved.items.find(entry => entry.id === 'clip')!
      expect(Buffer.from(disk.assetFiles[String(clip.data?.assetId)]!).equals(replacementBytes)).toBe(true)
      await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
      await openInWorkbench(page, COURSE)
      const reopened = await course(page)
      expect(reopened.items).toEqual(saved.items)
      expect(reopened.world).toEqual(saved.world)
      const slideCard = page.getByRole('navigation', { name: '场景与页面导航' }).locator('li[data-kind="slide"]').first()
      if (await slideCard.getAttribute('data-current-card') !== 'true') await slideCard.click({ position: { x: 30, y: 20 } })
      await canvasReady(page)
      await expect(page.getByRole('button', { name: '1 个隐藏对象', exact: true })).toBeVisible()
      const box = await stage()
      await expect.poll(async () => sameColour(await colourAt(onStage(box, { x: 840, y: 30 })), SPLIT.left, 40)).toBe(true)
      expect(sameColour(await colourAt(onStage(box, { x: 1000, y: 130 })), SPLIT.right, 60)).toBe(false)
      await page.screenshot({ path: join(shots, 't07-reopened.png') })
      expect(await mode()).toBe('light')
      evidence.saved = saved.items.map(entry => ({ id: entry.id, visible: entry.visible, frame: entry.frame }))
    })
    evidence.errors = errors
    expect(errors).toEqual([])
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await app?.evaluate(({ app: electronApp, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      electronApp.exit(0)
    }).catch(() => {})
  }
})
