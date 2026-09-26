import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { openInWorkbench, root, settledRect, type Rect } from './helpers/g20M19Harness'
import { canvasReady, centre, contextMenuAt, flowCourseWithFigure, FRAMES, lightCourse, onStage } from './helpers/g20M21Harness'

const COURSE = 'm21.h5lesson'
const FLOW = 'flow.h5lesson'
const PICKED = '#123456'

type Row = { rect: Rect; controls: string[]; tops: number[]; bottoms: number[] }

/** The workbench top bar: its box, the controls shown in it and where each starts. */
async function topBar(page: Page): Promise<Row> {
  const row = page.getByLabel('常用工具')
  const rect = (await row.boundingBox())!
  const shown = await row.locator('button:not([role="menuitem"]), summary').evaluateAll(elements => elements
    .filter(element => (element as HTMLElement).offsetParent !== null)
    .map(element => ({ label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '', top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom })))
  return { rect, controls: shown.map(entry => entry.label), tops: shown.map(entry => entry.top), bottoms: shown.map(entry => entry.bottom) }
}

/** One row: every control shares a horizontal band with every other. */
function oneRow(row: Row): boolean {
  return Math.max(...row.tops) < Math.min(...row.bottoms)
}

/** The sections a colour palette offers, in order, and whether its continuous picker is already showing. */
async function palette(group: Locator) {
  await expect(group).toBeVisible()
  return {
    sections: await group.getByRole('radiogroup').evaluateAll(groups => groups.map(entry => entry.getAttribute('aria-label') ?? '')),
    recent: await group.getByRole('radiogroup', { name: '最近使用' }).getByRole('radio').evaluateAll(radios => radios.map(radio => radio.getAttribute('aria-label') ?? '')).catch(() => [] as string[]),
    none: await group.getByRole('button', { name: '无高亮', exact: true }).count(),
    more: await group.getByRole('button', { name: '更多颜色…', exact: true }).count(),
    picker: await group.getByLabel('自定义颜色').count(),
  }
}

test('M21-T01 M21-T02 M21-T03 a steady top bar and canvas, one quick bar everywhere and one colour palette', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m21/quick-bar'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, COURSE), lightCourse())
  writeFileSync(join(workspace, FLOW), flowCourseWithFigure())
  const evidence: Record<string, unknown> = { run: directory }
  const errors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true })).toBeVisible()
    const frameOf = (itemId: string) => page.evaluate(async id => {
      const found = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith('m21.h5lesson'))
      if (!found || found.model.kind !== 'course-v9') return null
      for (const surface of found.model.project.surfaces) {
        if (surface.type !== 'slide') continue
        for (const scene of surface.scenes) {
          const item = scene.layerItems.find(entry => entry.layerItemId === id)
          if (item?.frame.mode === 'absolute') return { x: item.frame.x, y: item.frame.y, width: item.frame.width, height: item.frame.height }
        }
      }
      return null
    }, itemId)
    const textColour = (itemId: string) => page.evaluate(async id => {
      const found = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith('m21.h5lesson'))
      if (!found || found.model.kind !== 'course-v9') return null
      for (const surface of found.model.project.surfaces) if (surface.type === 'slide') for (const scene of surface.scenes) {
        const item = scene.layerItems.find(entry => entry.layerItemId === id)
        if (item?.kind === 'native' && item.content.nativeType === 'text') return item.content.data.style.color
      }
      return null
    }, itemId)
    const quickBar = page.locator('[data-selection-quick-bar]').filter({ visible: true })
    const zoom = () => page.getByRole('status', { name: '画布缩放比例' }).innerText()

    await openInWorkbench(page, COURSE)
    await canvasReady(page)

    // ---------------------------------------------------------------- M21-T01
    await test.step('M21-T01 the top bar stays one row and the canvas keeps its size while the selection changes and an object moves', async () => {
      // Explorer and AI assistant open: the content area is at its narrowest default.
      await expect(page.getByRole('region', { name: '资源管理器' })).toBeVisible()
      const baseline = { bar: await topBar(page), stage: await settledRect(page, '.canvas-stage-stack'), zoom: await zoom() }
      expect(oneRow(baseline.bar), JSON.stringify(baseline.bar)).toBe(true)
      const rounds: Record<string, unknown>[] = []
      const same = async (name: string) => {
        const now = { bar: await topBar(page), stage: await settledRect(page, '.canvas-stage-stack'), zoom: await zoom() }
        rounds.push({ name, ...now })
        expect(now.bar.controls, name).toEqual(baseline.bar.controls)
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(now.bar.rect[key] - baseline.bar.rect[key]), `${name} bar ${key}`).toBeLessThanOrEqual(0.5)
          expect(Math.abs(now.stage[key] - baseline.stage[key]), `${name} stage ${key}`).toBeLessThanOrEqual(0.5)
        }
        expect(now.zoom, name).toBe(baseline.zoom)
      }
      const stage = baseline.stage
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.title)))); await expect(quickBar).toHaveCount(1); await same('text')
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.photo)))); await expect(quickBar).toHaveCount(1); await same('image')
      await page.keyboard.down('Shift'); await page.mouse.click(...xy(onStage(stage, centre(FRAMES.note)))); await page.keyboard.up('Shift')
      await expect(page.locator('footer.status-bar')).toContainText('已选 2 个图层'); await same('multi')
      await page.mouse.click(...xy(onStage(stage, { x: 1100, y: 640 }))); await expect(quickBar).toHaveCount(0); await same('blank')
      await page.screenshot({ path: join(shots, 't01-blank.png') })
      // Drag the title: it follows the pointer exactly, and nothing else moves.
      const before = (await frameOf('title'))!
      const from = onStage(stage, centre(FRAMES.title)), delta = { x: 96, y: 48 }
      await page.mouse.move(from.x, from.y); await page.mouse.down()
      for (let step = 1; step <= 6; step++) await page.mouse.move(from.x + delta.x * step / 6, from.y + delta.y * step / 6)
      await page.mouse.up()
      const scale = stage.width / 1280
      await expect.poll(async () => (await frameOf('title'))!.x).not.toBe(before.x)
      const after = (await frameOf('title'))!
      expect(Math.abs(after.x - (before.x + delta.x / scale))).toBeLessThanOrEqual(2)
      expect(Math.abs(after.y - (before.y + delta.y / scale))).toBeLessThanOrEqual(2)
      await same('after drag')
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await frameOf('title'))!.x).toBe(before.x)
      // A change from outside the canvas, as an AI client's edit reaches the document: the course file changes on
      // disk and the main process takes it in (an `external` step). Then the same round again.
      const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, COURSE))))
      const slide = archive.project.surfaces[0]
      const note = slide?.type === 'slide' ? slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'note') : undefined
      if (note?.kind !== 'native' || note.content.nativeType !== 'text') throw new Error('note text')
      note.content.data.text = '要点（外部修改）'
      writeFileSync(join(workspace, COURSE), createCourseProjectArchive({ project: archive.project, assetFiles: archive.assetFiles, componentFiles: archive.componentFiles }))
      const external = await page.evaluate(async file => {
        const found = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith(file))!
        const observed = await window.desktopAPI.documents!.observeFile(found.documentId)
        const next = await window.desktopAPI.documents!.reconcileFile({ documentId: found.documentId, epoch: found.epoch, baseRevision: found.revision,
          bindingVersion: observed.bindingVersion, version: observed.version, choice: 'disk' })
        return { before: found.revision, after: next.revision, undoHeadActor: next.undoHead?.actor ?? null }
      }, COURSE)
      expect(external.after).toBeGreaterThan(external.before)
      await canvasReady(page)
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.title)))); await expect(quickBar).toHaveCount(1); await same('text after external change')
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.photo)))); await expect(quickBar).toHaveCount(1); await same('image after external change')
      await page.keyboard.down('Shift'); await page.mouse.click(...xy(onStage(stage, centre(FRAMES.note)))); await page.keyboard.up('Shift')
      await expect(page.locator('footer.status-bar')).toContainText('已选 2 个图层'); await same('multi after external change')
      await page.mouse.click(...xy(onStage(stage, { x: 1100, y: 640 }))); await expect(quickBar).toHaveCount(0); await same('blank after external change')
      evidence.t01 = { baseline, rounds, drag: { before, after, delta, scale }, external }
      // A narrower content area: still one row, and what does not fit moves into "⋯".
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 1000))
      await expect.poll(async () => (await topBar(page)).rect.width).toBeLessThan(baseline.bar.rect.width - 100)
      const narrow = await topBar(page)
      expect(oneRow(narrow), JSON.stringify(narrow)).toBe(true)
      expect(narrow.rect.height).toBeLessThanOrEqual(baseline.bar.rect.height + 0.5)
      await page.getByLabel('常用工具').getByRole('button', { name: '更多工具', exact: true }).click()
      const more = await page.getByRole('menuitem').filter({ visible: true }).evaluateAll(items => items.map(item => item.getAttribute('aria-label') ?? item.textContent?.trim() ?? ''))
      for (const control of baseline.bar.controls) if (!narrow.controls.includes(control)) expect(more, control).toContain(control)
      await page.screenshot({ path: join(shots, 't01-narrow.png') })
      await page.keyboard.press('Escape')
      evidence.t01narrow = { narrow, more }
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
      await expect.poll(async () => (await topBar(page)).rect.width).toBeGreaterThan(narrow.rect.width + 100)
      await canvasReady(page)
    })

    // ---------------------------------------------------------------- M21-T02
    await test.step('M21-T02 Slide: the bar sits beside the object, hides while dragging or resizing, offers no numeric fields, unlocks in place', async () => {
      const stage = await settledRect(page, '.canvas-stage-stack')
      const title = onStage(stage, centre(FRAMES.title))
      await page.mouse.click(title.x, title.y)
      await expect(quickBar).toHaveCount(1)
      const bar = (await quickBar.boundingBox())!
      const top = onStage(stage, { x: FRAMES.title.x, y: FRAMES.title.y }), bottom = onStage(stage, { x: FRAMES.title.x, y: FRAMES.title.y + FRAMES.title.height })
      expect(bar.y + bar.height <= top.y || bar.y >= bottom.y, JSON.stringify({ bar, top, bottom })).toBe(true)
      expect(await quickBar.getByRole('spinbutton').count()).toBe(0)
      await expect(page.getByRole('tab', { name: '属性', exact: true }).filter({ visible: true })).toHaveCount(0)
      const slideBar = await quickBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      expect(slideBar).toEqual(expect.arrayContaining(['编辑文字', '加粗', '文字颜色', '高亮', 'AI 修改', '更多操作']))
      await page.screenshot({ path: join(shots, 't02-slide.png') })
      // Dragging hides the bar; releasing brings it back beside the object.
      await page.mouse.move(title.x, title.y); await page.mouse.down()
      await page.mouse.move(title.x + 30, title.y + 20); await page.mouse.move(title.x + 60, title.y + 40)
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(1)
      await page.mouse.up()
      await expect(quickBar).toHaveCount(1)
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(0)
      await page.keyboard.press('Control+Z')
      // Resizing from the east handle hides it too.
      const east = onStage(stage, { x: FRAMES.title.x + FRAMES.title.width, y: FRAMES.title.y + FRAMES.title.height / 2 })
      await page.mouse.click(title.x, title.y)
      await page.mouse.move(east.x, east.y); await page.mouse.down()
      await page.mouse.move(east.x + 30, east.y); await page.mouse.move(east.x + 60, east.y)
      await expect(page.locator('[data-selection-quick-bar][data-suspended="true"]')).toHaveCount(1)
      await page.mouse.up()
      await expect(quickBar).toHaveCount(1)
      await page.keyboard.press('Control+Z')
      // Locking shows 已锁定 with 解锁 in place.
      await page.mouse.click(title.x, title.y)
      await quickBar.getByRole('button', { name: '更多操作', exact: true }).click()
      await page.getByRole('menu', { name: '更多操作' }).getByRole('menuitem', { name: '锁定', exact: true }).click()
      await expect(quickBar).toContainText('已锁定')
      await page.screenshot({ path: join(shots, 't02-locked.png') })
      await quickBar.getByRole('button', { name: '解锁', exact: true }).click()
      await expect(quickBar.getByRole('button', { name: '加粗', exact: true })).toBeVisible()
      evidence.t02slide = { bar, slideBar }
    })

    await test.step('M21-T02 Spatial world text and the editor show the same bar', async () => {
      await page.getByRole('navigation', { name: '场景与页面导航' }).getByRole('button', { name: /^无限画布 \d+：空间$/ }).click()
      await expect(page.locator('[data-observation-spatial-camera]').filter({ visible: true }).first()).toBeVisible()
      const viewport = (await page.locator('main.workspace').filter({ visible: true }).first().boundingBox())!
      const menu = await contextMenuAt(page, { x: viewport.x + viewport.width - 60, y: viewport.y + viewport.height - 60 }, '画布操作')
      await menu.getByRole('menuitem', { name: '全选', exact: true }).click()
      await expect(quickBar).toHaveCount(1)
      const spatialBar = await quickBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      expect(spatialBar).toEqual(expect.arrayContaining(['加粗', '文字颜色', '高亮', 'AI 修改', '更多操作']))
      await page.screenshot({ path: join(shots, 't02-spatial.png') })
      await page.getByRole('navigation', { name: '场景与页面导航' }).getByRole('button', { name: /^场景 1：/ }).click()
      await canvasReady(page)
      // The editor shows the same bar for the same object.
      await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
      await expect.poll(() => page.locator('.course-editor-frame').first().getAttribute('data-editor-mode')).toBe('deep')
      await canvasReady(page)
      const stage = await settledRect(page, '.canvas-stage-stack')
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.title))))
      await expect(quickBar).toHaveCount(1)
      const editorBar = await quickBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      expect(editorBar).toEqual((evidence.t02slide as { slideBar: string[] }).slideBar)
      await page.screenshot({ path: join(shots, 't02-editor.png') })
      await page.getByRole('button', { name: '返回工作台', exact: true }).click()
      await expect.poll(() => page.locator('.course-editor-frame').first().getAttribute('data-editor-mode')).toBe('light')
      evidence.t02spatial = { spatialBar, editorBar }
    })

    // ---------------------------------------------------------------- M21-T03 (object and text being edited)
    const palettes: Record<string, unknown> = {}
    await test.step('M21-T03 an object\'s text colour and highlight open the palette first; only 更多颜色 opens the picker', async () => {
      await canvasReady(page)
      const stage = await settledRect(page, '.canvas-stage-stack')
      await page.mouse.click(...xy(onStage(stage, centre(FRAMES.title))))
      await quickBar.getByRole('button', { name: '文字颜色', exact: true }).click()
      const colour = page.getByRole('group', { name: '文字颜色', exact: true })
      const first = await palette(colour)
      expect(first.sections.slice(0, 2)).toEqual(['常用色', '项目色'])
      expect(first).toMatchObject({ more: 1, picker: 0 })
      await colour.getByRole('button', { name: '更多颜色…', exact: true }).click()
      const picker = colour.getByLabel('自定义颜色')
      await expect(picker).toBeVisible()
      await picker.evaluate((input, value) => {
        const element = input as HTMLInputElement
        element.value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }, PICKED)
      await expect.poll(() => textColour('title')).toBe(PICKED)
      // Picking closes the palette; the object stays selected.
      await expect(page.getByRole('group', { name: '文字颜色', exact: true })).toHaveCount(0)
      await quickBar.getByRole('button', { name: '文字颜色', exact: true }).click()
      const again = await palette(page.getByRole('group', { name: '文字颜色', exact: true }))
      expect(again.recent).toContain(PICKED)
      await page.screenshot({ path: join(shots, 't03-object-colour.png') })
      await page.keyboard.press('Escape')
      await quickBar.getByRole('button', { name: '高亮', exact: true }).click()
      const highlight = await palette(page.getByRole('group', { name: '高亮', exact: true }))
      expect(highlight).toMatchObject({ none: 1, more: 1, picker: 0 })
      expect(highlight.sections[0]).toBe('高亮色')
      await page.keyboard.press('Escape')
      palettes.object = { first, again, highlight }
    })

    await test.step('M21-T03 text being edited offers the same palette with the colour just used', async () => {
      const stage = await settledRect(page, '.canvas-stage-stack')
      await page.mouse.dblclick(...xy(onStage(stage, centre(FRAMES.title))))
      await expect(page.getByTestId('text-edit-overlay')).toBeVisible()
      await page.getByRole('button', { name: '局部文字颜色', exact: true }).click()
      const editing = await palette(page.getByRole('group', { name: '局部文字颜色', exact: true }))
      expect(editing.sections.slice(0, 2)).toEqual(['常用色', '项目色'])
      expect(editing.recent).toContain(PICKED)
      expect(editing).toMatchObject({ more: 1, picker: 0 })
      await page.screenshot({ path: join(shots, 't03-editing-colour.png') })
      await page.getByRole('button', { name: '局部高亮', exact: true }).click()
      const editingHighlight = await palette(page.getByRole('group', { name: '局部高亮', exact: true }))
      expect(editingHighlight).toMatchObject({ none: 1, more: 1, picker: 0 })
      // The highlight palette keeps its own recent colours, not the text colour just used.
      expect(editingHighlight.recent).not.toContain(PICKED)
      await page.keyboard.press('Escape')
      await page.mouse.click(...xy(onStage(stage, { x: 1100, y: 640 })))
      palettes.editing = { editing, editingHighlight }
    })

    // ---------------------------------------------------------------- Flow: paper object, document image, selected text
    await test.step('M21-T02 M21-T03 Flow: a paper object, an image in the document and selected text use the same bar and palette', async () => {
      await openInWorkbench(page, FLOW)
      const flow = page.locator('.flow-workspace').filter({ visible: true }).first()
      await expect(flow).toBeVisible()
      const overlay = flow.locator('[data-testid^="flow-layer-card-"]').filter({ hasText: '讲义浮层' }).first()
      await overlay.click()
      await expect(quickBar).toHaveCount(1)
      const paperBar = await quickBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      expect(paperBar).toEqual(expect.arrayContaining(['加粗', '文字颜色', 'AI 修改', '更多操作']))
      await page.screenshot({ path: join(shots, 't02-flow-paper.png') })
      await page.keyboard.press('Escape')
      // A plain click on the picture selects it as a whole: the bar offers its own actions.
      let imageMenuItems: string[] = []
      const image = flow.locator('figure[data-document-id="flow-media"] img').first()
      await image.scrollIntoViewIfNeeded()
      await image.click()
      const documentBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(documentBar).toBeVisible()
      await expect(documentBar.getByRole('button', { name: '替换图片', exact: true })).toBeVisible()
      const imageBar = await documentBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      // Same order as a page object's bar: its own actions, AI, then "⋯".
      expect(imageBar.slice(-2)).toEqual(['AI 修改', '更多操作'])
      await page.screenshot({ path: join(shots, 't02-flow-image.png') })
      // M21-T05: its right-click menu holds the bar's actions and the "⋯" items under the same names.
      await documentBar.getByRole('button', { name: '更多操作', exact: true }).click()
      const more = await page.getByRole('menu', { name: '更多操作' }).getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label') ?? ''))
      await page.keyboard.press('Escape')
      const imageBox = (await image.boundingBox())!
      const imageMenu = await contextMenuAt(page, centre(imageBox), '对象操作')
      imageMenuItems = await imageMenu.getByRole('menuitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label') ?? ''))
      expect(imageMenuItems).toEqual(['替换图片…', '上移', '下移', ...more])
      await page.screenshot({ path: join(shots, 't05-flow-image-menu.png') })
      await page.keyboard.press('Escape')
      // Cells of a table selected together get the text tools.
      const cells = flow.locator('[data-document-id="flow-table"] td')
      await cells.first().scrollIntoViewIfNeeded()
      const from = centre((await cells.nth(0).boundingBox())!), to = centre((await cells.nth(1).boundingBox())!)
      await page.mouse.move(from.x, from.y); await page.mouse.down()
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2); await page.mouse.move(to.x, to.y); await page.mouse.up()
      await expect(documentBar.getByRole('button', { name: '当前选区加粗', exact: true })).toBeVisible()
      const tableBar = await documentBar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? ''))
      await page.screenshot({ path: join(shots, 't02-flow-table.png') })
      const paragraph = flow.getByText('春风又绿江南岸', { exact: false }).first()
      await paragraph.scrollIntoViewIfNeeded()
      await paragraph.dblclick()
      const textBar = page.getByRole('toolbar', { name: '选中内容快捷工具' })
      await expect(textBar.getByRole('button', { name: '当前选区加粗', exact: true })).toBeVisible()
      await textBar.getByRole('button', { name: '当前选区文字颜色', exact: true }).click()
      const body = await palette(page.getByRole('group', { name: '当前选区文字颜色', exact: true }))
      expect(body.sections[0]).toBe('常用色')
      expect(body.recent).toContain(PICKED)
      expect(body).toMatchObject({ more: 1, picker: 0 })
      await page.screenshot({ path: join(shots, 't03-body-colour.png') })
      await page.keyboard.press('Escape')
      await textBar.getByRole('button', { name: '当前选区高亮', exact: true }).click()
      const bodyHighlight = await palette(page.getByRole('group', { name: '当前选区高亮', exact: true }))
      expect(bodyHighlight).toMatchObject({ none: 1, more: 1, picker: 0 })
      await page.keyboard.press('Escape')
      palettes.body = { body, bodyHighlight }
      evidence.t02flow = { paperBar, imageBar, tableBar, imageMenuItems }
    })
    evidence.palettes = palettes
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

function xy(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y]
}
