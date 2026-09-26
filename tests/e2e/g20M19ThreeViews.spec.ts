import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { EDITOR_PAGE_INSETS, WINDOW_PAGE_INSETS } from '../../src/shared/pageFrame'
import {
  expectFit, expectSameRect, flowCourse, FLOW_CONTROLLER_ID, isOffPageColour, openInWorkbench, pixelAt, rectOf, root,
  settledRect, slideCourse, solidPng, type Rect,
} from './helpers/g20M19Harness'

const EDITOR_INSETS = EDITOR_PAGE_INSETS
const WINDOW_INSETS = WINDOW_PAGE_INSETS

test('M19-T04 M19-T05 M19-T06 editing, try-run, whole-course preview and export share one page frame', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(420_000)
  const base = join(root, 'output/g20/m19/three-views'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  const courses = {
    landscape: { file: 'landscape.h5lesson', canvas: { width: 1280, height: 720 }, offPage: { x: 1180, y: 300, width: 300, height: 120 } },
    portrait: { file: 'portrait.h5lesson', canvas: { width: 720, height: 1280 }, offPage: { x: 620, y: 300, width: 300, height: 120 } },
    long: { file: 'long.h5lesson', canvas: { width: 720, height: 2560 }, offPage: { x: 620, y: 300, width: 300, height: 120 } },
  } as const
  for (const [key, course] of Object.entries(courses)) writeFileSync(join(workspace, course.file), slideCourse(`M19 ${key}`, course.canvas, course.offPage))
  writeFileSync(join(workspace, 'flow-controller.h5lesson'), flowCourse())
  const image = join(directory, 'sample.png'); writeFileSync(image, solidPng(400, 300, [37, 99, 235]))
  const evidence: Record<string, unknown> = { run: directory, courses }
  const errors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? paths.workspace : paths.image] }
      }
    }, { workspace, image })
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'landscape.h5lesson', exact: true })).toBeVisible()

    for (const [key, course] of Object.entries(courses)) {
      await test.step(`${key}: edit and try-run use the same page`, async () => {
        await openInWorkbench(page, course.file)
        // 母版 stays the default edit state.
        await expect(page.getByRole('button', { name: '母版', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
        const viewport = await rectOf(page, 'main.workspace--edit')
        const edit = await rectOf(page, '.canvas-stage-stack')
        expectFit(edit, viewport, course.canvas, EDITOR_INSETS)
        await page.screenshot({ path: join(shots, `${key}-edit.png`) })
        const scale = edit.width / course.canvas.width
        // The block's part beyond the page edge is cut off; its part on the page is drawn.
        const row = edit.y + (course.offPage.y + course.offPage.height / 2) * scale
        expect(isOffPageColour(await pixelAt(page, page, edit.x + edit.width - 6, row))).toBe(true)
        expect(isOffPageColour(await pixelAt(page, page, edit.x + edit.width + 8, row))).toBe(false)
        const editController = await settledRect(page, '[data-controller-authoring-id]')

        await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
        const run = await rectOf(page, '.course-try-run-host [data-slide-scene-stage]')
        await page.screenshot({ path: join(shots, `${key}-try-run.png`) })
        expectSameRect(run, edit)
        expect(isOffPageColour(await pixelAt(page, page, run.x + run.width - 6, row))).toBe(true)
        expect(isOffPageColour(await pixelAt(page, page, run.x + run.width + 8, row))).toBe(false)
        // The teacher controller follows the same rule in both views (kept on the visible page).
        const runController = await settledRect(page, '.course-try-run-host .published-component-mount')
        evidence[key] = { viewport, edit, run, editController, runController }
        // A tall page's scroll bar sits in the margin, so the controller is in the same place in both views.
        expectSameRect(runController, editController, 2)
        await page.getByRole('button', { name: '编辑状态', exact: true }).click()
        await expect(page.getByRole('button', { name: '编辑状态', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('.course-try-run-host').filter({ visible: true })).toHaveCount(0)
      })
    }

    await test.step('long page: scrolls to its end in edit and in try-run, the page end is cut', async () => {
      await openInWorkbench(page, courses.long.file)
      const viewport = await rectOf(page, 'main.workspace--edit')
      await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
      for (let index = 0; index < 20; index++) await page.mouse.wheel(0, 600)
      const edit = await rectOf(page, '.canvas-stage-stack')
      expect(edit.y + edit.height).toBeLessThanOrEqual(viewport.y + viewport.height)
      expect(edit.y + edit.height).toBeGreaterThan(viewport.y + viewport.height - EDITOR_INSETS.bottom - 2)
      await page.screenshot({ path: join(shots, 'long-edit-end.png') })
      await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
      await rectOf(page, '.course-try-run-host [data-slide-scene-stage]')
      await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
      for (let index = 0; index < 20; index++) await page.mouse.wheel(0, 600)
      const run = await rectOf(page, '.course-try-run-host [data-slide-scene-stage]')
      expect(run.y + run.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
      expect(run.y + run.height).toBeGreaterThan(viewport.y + viewport.height - EDITOR_INSETS.bottom - 2)
      await page.screenshot({ path: join(shots, 'long-try-run-end.png') })
      evidence.longEnd = { edit, run, viewport }
      await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    })

    await test.step('thumbnails show the whole page at its own ratio', async () => {
      await openInWorkbench(page, courses.portrait.file)
      const thumbnail = page.locator('.scene-thumbnail').filter({ visible: true }).first()
      await expect(thumbnail).toBeVisible()
      const fit = await thumbnail.evaluate(element => getComputedStyle(element).objectFit)
      expect(fit).toBe('contain')
    })

    await test.step('M19-T05: an inserted image lands at the page centre; the default controller sits at the page bottom', async () => {
      await openInWorkbench(page, courses.portrait.file)
      const before = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith('portrait.h5lesson'))!)
      await page.getByRole('button', { name: '插入', exact: true }).click()
      await page.getByRole('button', { name: '添加图片', exact: true }).click()
      await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).revision).toBeGreaterThan(before.revision)
      const model = await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId) as { model: { project: { surfaces: { scenes?: { layerItems: { layerItemId: string; frame: Rect; content?: { nativeType?: string } }[] }[] }[]; globalLayerItems: { item: { kind: string; frame: Rect } }[] } } }
      const items = model.model.project.surfaces[0]!.scenes![0]!.layerItems
      const inserted = items.find(item => item.content?.nativeType === 'image')!
      expect(inserted).toBeTruthy()
      // Centred on the page, plus the standing 20px stagger for the items already there (two here: one step right).
      const slot = (items.length - 1) % 24, stagger = { x: (slot % 6) * 20, y: Math.floor(slot / 6) * 20 }
      expect(Math.abs(inserted.frame.x + inserted.frame.width / 2 - (360 + stagger.x))).toBeLessThanOrEqual(1)
      expect(Math.abs(inserted.frame.y + inserted.frame.height / 2 - (640 + stagger.y))).toBeLessThanOrEqual(1)
      // Fitted to the page: a 400×300 image takes at most half the page width.
      expect(inserted.frame.width).toBeLessThanOrEqual(360)
      const controller = model.model.project.globalLayerItems.find(entry => entry.item.kind === 'component')!.item.frame
      expect(controller.x * 2 + controller.width).toBe(720)
      expect(controller.y + controller.height).toBe(1280 - 18)
      evidence.inserted = { image: inserted.frame, controller }
      await page.getByRole('button', { name: '撤销', exact: true }).click()
    })

    await test.step('M19-T05: leaving try-run returns to the state it started from', async () => {
      await openInWorkbench(page, courses.landscape.file)
      await page.getByRole('button', { name: '初始', exact: true }).first().click()
      await expect(page.getByRole('button', { name: '初始', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
      await rectOf(page, '.course-try-run-host [data-slide-scene-stage]')
      await page.getByRole('button', { name: '编辑状态', exact: true }).click()
      await expect(page.getByRole('button', { name: '初始', exact: true }).first()).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: '母版', exact: true }).first().click()
    })

    for (const [key, course] of Object.entries(courses)) {
      await test.step(`${key}: whole-course preview uses the same frame with window margins`, async () => {
        await openInWorkbench(page, course.file)
        await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
        await page.getByRole('button', { name: '整课预览', exact: true }).click()
        const frame = await rectOf(page, '.course-preview-host [data-playback-view]')
        const preview = await rectOf(page, '.course-preview-host [data-slide-scene-stage]')
        expectFit(preview, frame, course.canvas, WINDOW_INSETS)
        const scale = preview.width / course.canvas.width
        const row = preview.y + (course.offPage.y + course.offPage.height / 2) * scale
        expect(isOffPageColour(await pixelAt(page, page, preview.x + preview.width - 6, row))).toBe(true)
        expect(isOffPageColour(await pixelAt(page, page, preview.x + preview.width + 8, row))).toBe(false)
        await page.screenshot({ path: join(shots, `${key}-preview.png`) })

        await page.getByRole('button', { name: '关闭预览', exact: true }).click()
        const exported = join(directory, `${key}-export.html`)
        await app!.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exported)
        await page.getByTestId('export-menu-trigger').click()
        await page.getByTestId('export-single-html').click()
        // The export preflight names the off-page part it will cut, then lets the teacher go on.
        const preflight = page.getByRole('alertdialog').filter({ hasText: '单 HTML 导出预检' })
        await expect(preflight).toContainText('超出画布，导出时会被裁切')
        await page.screenshot({ path: join(shots, `${key}-export-preflight.png`) })
        // A preflight or size notice may ask to go on before the file is written.
        await expect.poll(async () => {
          const proceed = page.getByRole('alertdialog').getByRole('button', { name: /^(继续导出|仍然导出)$/ }).first()
          if (!existsSync(exported) && await proceed.isVisible().catch(() => false)) await proceed.click().catch(() => {})
          return existsSync(exported)
        }, { timeout: 60_000 }).toBe(true)
        await expect.poll(() => readFileSync(exported).byteLength).toBeGreaterThan(10_000)
        const windowId = await app!.evaluate(async ({ BrowserWindow }, filePath) => {
          // Off screen like the app's own background windows; its own session, since the app session only serves the app.
          const view = new BrowserWindow({ x: -16_384, y: -16_384, width: 1600, height: 1000, useContentSize: true, opacity: 0, skipTaskbar: true,
            webPreferences: { sandbox: true, partition: `m19-export-${Date.now()}`, backgroundThrottling: false } })
          await view.loadFile(filePath)
          return view.id
        }, exported)
        await expect.poll(() => app!.windows().some(item => item.url().includes(`${key}-export.html`))).toBe(true)
        const exportPage = app!.windows().find(item => item.url().includes(`${key}-export.html`))!
        const exportFrame = await rectOf(exportPage, '#course-root [data-playback-view]')
        const exportPageRect = await rectOf(exportPage, '#course-root [data-slide-scene-stage]')
        expectFit(exportPageRect, exportFrame, course.canvas, WINDOW_INSETS)
        const exportScale = exportPageRect.width / course.canvas.width
        const exportRow = exportPageRect.y + (course.offPage.y + course.offPage.height / 2) * exportScale
        expect(isOffPageColour(await pixelAt(page, exportPage, exportPageRect.x + exportPageRect.width - 6, exportRow))).toBe(true)
        expect(isOffPageColour(await pixelAt(page, exportPage, exportPageRect.x + exportPageRect.width + 8, exportRow))).toBe(false)
        await exportPage.screenshot({ path: join(shots, `${key}-export.png`) })
        evidence[`${key}-preview-export`] = { frame, preview, exportFrame, exportPageRect }
        await app!.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), windowId)
        await page.getByRole('button', { name: '返回工作台', exact: true }).click()
      })
    }

    await test.step('M19-T06: Flow draws the same in edit and try-run; the controller is picked on the page', async () => {
      await openInWorkbench(page, 'flow-controller.h5lesson')
      const nudge = { x: 700, y: 520 }
      const editController = await settledRect(page, `.flow-authoring-layer-overlay [data-controller-authoring-id="${FLOW_CONTROLLER_ID}"]`, nudge)
      const editFormula = await rectOf(page, '.flow-workspace [data-flow-body-block="formula"]')
      const editDivider = await rectOf(page, '.flow-workspace hr[data-flow-body-block]')
      await page.screenshot({ path: join(shots, 'flow-edit.png') })
      await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
      const runController = await settledRect(page, `.flow-try-run-host [data-flow-overlay-item="${FLOW_CONTROLLER_ID}"]`, nudge)
      const runFormula = await rectOf(page, '.flow-try-run-host [data-flow-formula-id]')
      const runDivider = await rectOf(page, '.flow-try-run-host hr[data-flow-body-block]')
      await page.screenshot({ path: join(shots, 'flow-try-run.png') })
      evidence.flow = { editFormula, runFormula, editDivider, runDivider, editController, runController }
      expect(Math.abs(runFormula.height - editFormula.height)).toBeLessThanOrEqual(2)
      expect(Math.abs(runDivider.height - editDivider.height)).toBeLessThanOrEqual(1)
      // The controller sits in the same place on the Flow page in both views.
      expectSameRect(runController, editController, 2)
      await page.getByRole('button', { name: '编辑状态', exact: true }).click()

      // The controller as it is shown (collapsed here: its round button), picked and dragged in place.
      const footprint = '.flow-authoring-layer-overlay [data-controller-authoring-id]'
      const box = await settledRect(page, footprint, nudge)
      const before = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith('flow-controller.h5lesson'))!)
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.click(centre.x, centre.y)
      for (const name of [/^(展开|收起)/, /^隐藏$/, /^锁定$/, /^AI 修改$/]) await expect(page.getByRole('button', { name }).first()).toBeVisible()
      expect((await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).revision).toBe(before.revision)
      // The quick bar really changes the controller on a Flow page.
      await page.getByRole('button', { name: /^(展开|收起)/ }).first().click()
      await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).revision).toBe(before.revision + 1)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).undoDepth).toBe(0)
      const shown = await settledRect(page, footprint, nudge)
      const grip = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 }
      const revision = (await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).revision
      await page.mouse.move(grip.x, grip.y); await page.mouse.down()
      await page.mouse.move(grip.x, grip.y - 160, { steps: 8 }); await page.mouse.up()
      await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), before.documentId)).revision).toBeGreaterThan(revision)
      const moved = await settledRect(page, footprint, nudge)
      evidence.flowController = { before: shown, after: moved }
      expect(Math.abs(shown.y - 160 - moved.y)).toBeLessThanOrEqual(2)
      expect(Math.abs(shown.x - moved.x)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: join(shots, 'flow-controller-picked.png') })
    })

    expect(errors).toEqual([])
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ ...evidence, errors }, null, 2))
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
  }
})
