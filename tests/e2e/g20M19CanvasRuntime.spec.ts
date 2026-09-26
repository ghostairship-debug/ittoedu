import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { EDITOR_PAGE_INSETS, WINDOW_PAGE_INSETS } from '../../src/shared/pageFrame'
import {
  expectFit, expectSameRect, openInWorkbench, pixelAt, rectOf, root, RUNTIME_FRAME, RUNTIME_TEXT, RUNTIME_TEXT_AT,
  runtimeCourse, settledRect, TITLE_COLOUR, type Rect,
} from './helpers/g20M19Harness'

type Canvas = { width: number; height: number }
const HANDLE = [91, 156, 255] as const
const near = (rgb: readonly number[], colour: readonly number[], tolerance = 28) => rgb.every((value, index) => Math.abs(value - colour[index]!) <= tolerance)

/** The Runtime's own text as laid out on screen: the text run inside its open shadow root, under `scope`. */
async function runtimeText(page: Page, scope: string) {
  let found: (Rect & { text: string }) | null = null
  await expect.poll(async () => {
    found = await page.evaluate(scope => {
      for (const host of document.querySelectorAll<HTMLElement>(`${scope} .lesson-runtime-mount`)) {
        const element = host.shadowRoot?.querySelector<HTMLElement>('[data-m19-runtime-text]')
        if (!element?.firstChild || element.getBoundingClientRect().width === 0) continue
        const range = document.createRange(); range.selectNodeContents(element)
        const box = range.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height, text: element.textContent ?? '' }
      }
      return null
    }, scope)
    return found !== null
  }, { timeout: 30_000 }).toBe(true)
  return found!
}

/** Share of dark (ink) pixels inside `rect` on `source`, decoded by the editor page. */
async function inkShare(decoder: Page, source: Page, rect: Rect): Promise<number> {
  const png = await source.screenshot({ clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) } })
  return decoder.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! < 360) dark++
    return dark / (pixels.length / 4)
  }, png.toString('base64'))
}

/** A canvas rectangle drawn on the page `stage` (screen), for a page of `canvas` size. */
const onScreen = (stage: Rect, canvas: Canvas, frame: Rect): Rect => {
  const s = stage.width / canvas.width
  return { x: stage.x + frame.x * s, y: stage.y + frame.y * s, width: frame.width * s, height: frame.height * s }
}

test('M19-T02 M19-T03 hit testing, selection and Runtime targets use the course canvas; a custom canvas survives save, reopen, try-run and export', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m19/canvas-runtime'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  // Everything the steps touch lies in the part of the page shown first (a portrait page opens at its top).
  const courses = {
    landscape: { file: 'runtime-landscape.h5lesson', canvas: { width: 1280, height: 720 }, title: { x: 80, y: 100, width: 360, height: 72 } },
    portrait: { file: 'runtime-portrait.h5lesson', canvas: { width: 720, height: 1280 }, title: { x: 80, y: 100, width: 360, height: 72 } },
  } as const
  writeFileSync(join(workspace, courses.landscape.file), runtimeCourse('M19 runtime landscape', courses.landscape.canvas, courses.landscape.title))
  writeFileSync(join(workspace, courses.portrait.file), runtimeCourse('M19 runtime portrait', courses.portrait.canvas, courses.portrait.title, true))
  const evidence: Record<string, unknown> = { run: directory, courses }
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
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: courses.portrait.file, exact: true })).toBeVisible()

    const documentOf = (file: string) => page.evaluate(async file => {
      const entry = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith(file))!
      const snapshot = await window.desktopAPI.documents!.read(entry.documentId)
      const project = (snapshot.model as unknown as { project: { surfaces: { type: string; scenes?: { layerItems: { layerItemId: string; frame: { x: number; y: number; width: number; height: number }; runtime?: unknown }[] }[] }[] } }).project
      const items = project.surfaces.find(surface => surface.type === 'slide')!.scenes![0]!.layerItems
      return { documentId: entry.documentId, revision: entry.revision, dirty: entry.dirty,
        title: items.find(item => item.layerItemId === 'title')!.frame, runtime: JSON.stringify(items.find(item => item.layerItemId === 'm19-runtime')!.runtime) }
    }, file)

    for (const [key, course] of Object.entries(courses)) {
      const edited = `${key === 'portrait' ? '竖屏' : '横屏'}改字`
      await test.step(`${key}: Runtime targets, hit testing, selection, drag, resize and the quick bar use the ${course.canvas.width}×${course.canvas.height} canvas`, async () => {
        await openInWorkbench(page, course.file)
        const viewport = await rectOf(page, 'main.workspace--edit')
        const stage = await settledRect(page, '.canvas-stage-stack')
        expectFit(stage, viewport, course.canvas, EDITOR_PAGE_INSETS)
        const s = stage.width / course.canvas.width

        // The Runtime lays out its text in its own frame on the course canvas, scaled with the page ...
        const text = await runtimeText(page, 'main.workspace--edit')
        const expected = onScreen(stage, course.canvas, { x: RUNTIME_FRAME.x + RUNTIME_TEXT_AT.x, y: RUNTIME_FRAME.y + RUNTIME_TEXT_AT.y, width: 1, height: 1 })
        expect(Math.abs(text.x - expected.x), `text x ${text.x} vs ${expected.x}`).toBeLessThanOrEqual(2)
        expect(Math.abs(text.y - expected.y), `text y ${text.y} vs ${expected.y}`).toBeLessThanOrEqual(3)
        // ... and the host-recognised target sits exactly on it.
        const target = page.getByTestId('runtime-authoring-targets').getByRole('button', { name: new RegExp(`^${RUNTIME_TEXT}`) })
        await expect(target).toBeVisible({ timeout: 30_000 })
        const targetRect = (await target.boundingBox())!
        expectSameRect(targetRect, text, 2)
        // The target is see-through in the workbench as in the editor: the Runtime's own text stays visible.
        expect(await target.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
        expect(await inkShare(page, page, text)).toBeGreaterThan(0.05)
        await page.screenshot({ path: join(shots, `${key}-edit.png`) })

        // A double-click on that text (hit-tested on the canvas) edits it in place, in a box over the same text.
        const before = await documentOf(course.file)
        await page.mouse.dblclick(targetRect.x + targetRect.width / 2, targetRect.y + targetRect.height / 2)
        const editor = page.getByTestId('canvas-plain-text-editor')
        await expect(editor).toBeVisible()
        const editorRect = (await editor.boundingBox())!
        expect(Math.abs(editorRect.x - targetRect.x)).toBeLessThanOrEqual(12)
        expect(Math.abs(editorRect.y - targetRect.y)).toBeLessThanOrEqual(12)
        const field = editor.locator('textarea, input').first()
        await field.fill(edited)
        await field.press('Enter')
        await expect(editor).toHaveCount(0)
        await expect.poll(async () => (await runtimeText(page, 'main.workspace--edit')).text).toBe(edited)
        await expect.poll(async () => (await documentOf(course.file)).runtime).toContain(edited)
        expect((await documentOf(course.file)).revision).toBeGreaterThan(before.revision)
        await expect(page.getByTestId('runtime-authoring-targets').getByRole('button', { name: new RegExp(`^${edited}`) })).toBeVisible()

        // A click on the Native text selects it: the selection handles are drawn at its corners on this canvas.
        const title = onScreen(stage, course.canvas, course.title)
        await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
        await expect.poll(async () => near(await pixelAt(page, page, title.x + title.width, title.y + title.height), HANDLE)).toBe(true)
        expect(near(await pixelAt(page, page, title.x, title.y), HANDLE)).toBe(true)
        // The quick bar opens over the selection, at its left edge.
        const bar = page.locator('.selection-quick-bar').filter({ visible: true })
        await expect(bar).toHaveAttribute('data-placement', 'above')
        const barRect = (await bar.boundingBox())!
        expect(Math.abs(barRect.x - title.x), `bar x ${barRect.x} vs ${title.x}`).toBeLessThanOrEqual(2)
        expect(barRect.y + barRect.height).toBeLessThanOrEqual(title.y)
        expect(barRect.y + barRect.height).toBeGreaterThan(title.y - 60)
        await page.screenshot({ path: join(shots, `${key}-selected.png`) })

        // A drag moves it by the same distance in canvas units ...
        const selected = await documentOf(course.file)
        const grip = { x: title.x + title.width / 2, y: title.y + title.height / 2 }
        await page.mouse.move(grip.x, grip.y); await page.mouse.down()
        await page.mouse.move(grip.x + 130 * s, grip.y + 50 * s, { steps: 12 }); await page.mouse.up()
        await expect.poll(async () => (await documentOf(course.file)).revision).toBeGreaterThan(selected.revision)
        const moved = (await documentOf(course.file)).title
        expect(Math.abs(moved.x - (course.title.x + 130)), `moved x ${moved.x}`).toBeLessThanOrEqual(1.5)
        expect(Math.abs(moved.y - (course.title.y + 50)), `moved y ${moved.y}`).toBeLessThanOrEqual(1.5)
        // ... and pulling its right-hand handle widens it by the same amount.
        const shown = onScreen(stage, course.canvas, moved)
        await expect.poll(async () => near(await pixelAt(page, page, shown.x + shown.width, shown.y + shown.height / 2), HANDLE)).toBe(true)
        const beforeResize = await documentOf(course.file)
        await page.mouse.move(shown.x + shown.width, shown.y + shown.height / 2); await page.mouse.down()
        await page.mouse.move(shown.x + shown.width + 100 * s, shown.y + shown.height / 2, { steps: 12 }); await page.mouse.up()
        await expect.poll(async () => (await documentOf(course.file)).revision).toBeGreaterThan(beforeResize.revision)
        const resized = (await documentOf(course.file)).title
        expect(Math.abs(resized.width - (moved.width + 100)), `resized width ${resized.width}`).toBeLessThanOrEqual(1.5)
        expect(Math.abs(resized.x - moved.x)).toBeLessThanOrEqual(1.5)
        const block = onScreen(stage, course.canvas, resized)
        expect(near(await pixelAt(page, page, block.x + 10 * s, block.y + block.height / 2), TITLE_COLOUR)).toBe(true)
        await page.screenshot({ path: join(shots, `${key}-moved-resized.png`) })

        // A different window size refits the page; the handles and the Runtime target follow it.
        await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1300, 900))
        const smallViewport = await settledRect(page, 'main.workspace--edit', { x: 20, y: 500 })
        const smallStage = await settledRect(page, '.canvas-stage-stack', { x: 20, y: 500 })
        expect(smallStage.width).toBeLessThan(stage.width - 20)
        expectFit(smallStage, smallViewport, course.canvas, EDITOR_PAGE_INSETS)
        const smallBlock = onScreen(smallStage, course.canvas, resized)
        await expect.poll(async () => near(await pixelAt(page, page, smallBlock.x + smallBlock.width, smallBlock.y + smallBlock.height / 2), HANDLE)).toBe(true)
        const smallText = await runtimeText(page, 'main.workspace--edit')
        await expect.poll(async () => {
          const box = await page.getByTestId('runtime-authoring-targets').getByRole('button', { name: new RegExp(`^${edited}`) }).boundingBox()
          return box !== null && (['x', 'y', 'width'] as const).every(axis => Math.abs(box[axis] - smallText[axis]) <= 2)
        }).toBe(true)
        await page.screenshot({ path: join(shots, `${key}-small-window.png`) })
        await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
        await settledRect(page, '.canvas-stage-stack', { x: 20, y: 500 })
        evidence[key] = { viewport, stage, text, targetRect, editorRect, barRect, moved, resized, smallStage, smallText }
        // The landscape course is done with and saved here; the portrait one is saved and reopened below.
        if (key === 'landscape') {
          await page.keyboard.press('Control+s')
          await expect.poll(async () => (await documentOf(course.file)).dirty).toBe(false)
        }
      })
    }

    const portrait = courses.portrait
    let reopenedStage: Rect | undefined, reopenedText: (Rect & { text: string }) | undefined
    await test.step('M19-T03: the portrait course keeps its canvas and composition through save and reopen', async () => {
      await openInWorkbench(page, portrait.file)
      const edited = await documentOf(portrait.file)
      await page.keyboard.press('Control+s')
      await expect.poll(async () => (await documentOf(portrait.file)).dirty).toBe(false)
      const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, portrait.file))))
      const slide = saved.project.surfaces.find(surface => surface.type === 'slide')!
      expect(slide.type === 'slide' && slide.canvas).toEqual(portrait.canvas)
      const items = slide.type === 'slide' ? slide.scenes[0]!.layerItems : []
      expect(items.find(item => item.layerItemId === 'title')!.frame).toMatchObject(edited.title)
      expect(JSON.stringify(items.find(item => item.layerItemId === 'm19-runtime'))).toContain('竖屏改字')
      // Flow and Spatial pages are saved as they were: no canvas of their own.
      expect(saved.project.surfaces.map(surface => surface.type)).toEqual(['slide', 'flow', 'spatial-2d'])
      expect(saved.project.surfaces.filter(surface => surface.type !== 'slide').every(surface => !('canvas' in surface))).toBe(true)

      await page.getByRole('button', { name: `关闭 ${portrait.file}`, exact: true }).click()
      await expect(page.getByRole('tab', { name: new RegExp(`^${portrait.file.replace('.', '\\.')}`) })).toHaveCount(0)
      await openInWorkbench(page, portrait.file)
      const reopened = await documentOf(portrait.file)
      evidence.reopen = { before: edited.documentId, after: reopened.documentId }
      expect(reopened.title).toEqual(edited.title)
      const viewport = await rectOf(page, 'main.workspace--edit')
      reopenedStage = await settledRect(page, '.canvas-stage-stack')
      expectFit(reopenedStage, viewport, portrait.canvas, EDITOR_PAGE_INSETS)
      reopenedText = await runtimeText(page, 'main.workspace--edit')
      expect(reopenedText.text).toBe('竖屏改字')
      expect(await inkShare(page, page, reopenedText)).toBeGreaterThan(0.05)
      const block = onScreen(reopenedStage, portrait.canvas, reopened.title)
      expect(near(await pixelAt(page, page, block.x + 10 * reopenedStage.width / portrait.canvas.width, block.y + block.height / 2), TITLE_COLOUR)).toBe(true)
      await page.screenshot({ path: join(shots, 'portrait-reopened.png') })
    })

    await test.step('M19-T03: try-run shows the same composition', async () => {
      await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
      const run = await settledRect(page, '.course-try-run-host [data-slide-scene-stage]')
      expectSameRect(run, reopenedStage!)
      const text = await runtimeText(page, '.course-try-run-host')
      expect(text.text).toBe('竖屏改字')
      expectSameRect(text, reopenedText!, 2)
      expect(await inkShare(page, page, text)).toBeGreaterThan(0.05)
      await page.screenshot({ path: join(shots, 'portrait-try-run.png') })
      evidence.tryRun = { run, text }
      await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    })

    await test.step('M19-T03: the exported HTML keeps the canvas and composition; Flow stays a document and Spatial an open world', async () => {
      const current = await documentOf(portrait.file)
      await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
      const exported = join(directory, 'portrait-export.html')
      await app!.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exported)
      await page.getByTestId('export-menu-trigger').click()
      await page.getByTestId('export-single-html').click()
      await expect.poll(async () => {
        const proceed = page.getByRole('alertdialog').getByRole('button', { name: /^(继续导出|仍然导出)$/ }).first()
        if (!existsSync(exported) && await proceed.isVisible().catch(() => false)) await proceed.click().catch(() => {})
        return existsSync(exported)
      }, { timeout: 60_000 }).toBe(true)
      await expect.poll(() => readFileSync(exported).byteLength).toBeGreaterThan(10_000)
      const windowId = await app!.evaluate(async ({ BrowserWindow }, filePath) => {
        const view = new BrowserWindow({ x: -16_384, y: -16_384, width: 1600, height: 1000, useContentSize: true, opacity: 0, skipTaskbar: true,
          webPreferences: { sandbox: true, partition: `m19-runtime-export-${Date.now()}`, backgroundThrottling: false } })
        await view.loadFile(filePath)
        return view.id
      }, exported)
      await expect.poll(() => app!.windows().some(item => item.url().includes('portrait-export.html'))).toBe(true)
      const exportPage = app!.windows().find(item => item.url().includes('portrait-export.html'))!
      try {
        const frame = await rectOf(exportPage, '#course-root [data-playback-view]')
        const stage = await settledRect(exportPage, '#course-root [data-slide-scene-stage]')
        expectFit(stage, frame, portrait.canvas, WINDOW_PAGE_INSETS)
        const text = await runtimeText(exportPage, '#course-root')
        expect(text.text).toBe('竖屏改字')
        expect(await inkShare(page, exportPage, text)).toBeGreaterThan(0.05)
        const expected = onScreen(stage, portrait.canvas, { x: RUNTIME_FRAME.x + RUNTIME_TEXT_AT.x, y: RUNTIME_FRAME.y + RUNTIME_TEXT_AT.y, width: 1, height: 1 })
        expect(Math.abs(text.x - expected.x)).toBeLessThanOrEqual(2)
        expect(Math.abs(text.y - expected.y)).toBeLessThanOrEqual(3)
        const block = onScreen(stage, portrait.canvas, current.title)
        expect(near(await pixelAt(page, exportPage, block.x + 10 * stage.width / portrait.canvas.width, block.y + block.height / 2), TITLE_COLOUR)).toBe(true)
        await exportPage.screenshot({ path: join(shots, 'portrait-export.png') })

        const published = await exportPage.evaluate(() => {
          const payload = (window as unknown as { __H5_COURSE_PAYLOAD__: { surfaces: { type: string; canvas?: unknown; world?: { bounds?: unknown } }[] } }).__H5_COURSE_PAYLOAD__
          return payload.surfaces.map(surface => ({ type: surface.type, canvas: surface.canvas ?? null, bounds: surface.world?.bounds ?? null }))
        })
        expect(published).toEqual([
          { type: 'slide', canvas: portrait.canvas, bounds: null },
          { type: 'flow', canvas: null, bounds: null },
          { type: 'spatial-2d', canvas: null, bounds: { mode: 'infinite' } },
        ])
        // Next page: Flow fills the view as a continuous document, not a 720×1280 page.
        await exportPage.keyboard.press('PageDown')
        const flow = await settledRect(exportPage, '#course-root .flow-surface-host')
        expectSameRect(flow, frame, 2)
        await exportPage.screenshot({ path: join(shots, 'portrait-export-flow.png') })
        // Next page: the Spatial camera takes the course ratio and is shown whole.
        await exportPage.keyboard.press('PageDown')
        const spatial = await settledRect(exportPage, '#course-root section[data-spatial-viewport-width]')
        expect(Math.abs(spatial.width / spatial.height - portrait.canvas.width / portrait.canvas.height)).toBeLessThan(0.01)
        expect(spatial.height).toBeLessThanOrEqual(frame.height)
        await exportPage.screenshot({ path: join(shots, 'portrait-export-spatial.png') })
        evidence.export = { frame, stage, text, published, flow, spatial }
      } finally {
        await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), windowId)
      }
      await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    })
    evidence.errors = errors
    expect(errors).toEqual([])
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    // Like the other M19 specs: no close prompt may hold the run.
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
  }
})
