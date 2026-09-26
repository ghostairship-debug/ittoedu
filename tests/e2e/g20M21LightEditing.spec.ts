import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { pptxImportFixture } from '../fixtures/pptxImport'
import { openInWorkbench, RUNTIME_FRAME, RUNTIME_TEXT_AT, root, settledRect, solidPng } from './helpers/g20M19Harness'
import { canvasReady, centre, closeMenu, contextMenuAt, FRAMES, lightCourse, menuItems, onStage } from './helpers/g20M21Harness'

const COURSE = 'm21.h5lesson'
const OTHER = 'other.h5lesson'
const OBJECT_ITEMS = ['复制', '粘贴', '创建副本', '删除', '上移一层', '下移一层', '置于顶层', '置于底层', '锁定', '隐藏']
const CANVAS_ITEMS = ['粘贴', '全选', '在此插入文字', '在此插入图片…', '在此插入视频…', '在此插入矩形', '在此插入公式', '找回隐藏的对象', '当前位置试运行']
const SCENE_ITEMS = ['新建场景', '创建副本', '重命名', '前移', '后移', '删除场景']
const STATE_ITEMS = ['新建状态', '创建副本', '重命名', '删除状态']
const PRIMARY = new Set(['编辑文字', '替换图片…', '编辑此处文字', '替换此处图片…'])

test('M21-T04 M21-T05 M21-T06 one command set in the workbench and the editor; pages, top-bar preview/export and three PPT entries', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m21/light-editing'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(join(workspace, 'decks'), { recursive: true }); mkdirSync(shots)
  writeFileSync(join(workspace, COURSE), lightCourse())
  writeFileSync(join(workspace, OTHER), lightCourse('M21 另一份'))
  writeFileSync(join(workspace, 'decks', '第一课.pptx'), pptxImportFixture())
  const chosen = { explorer: join(directory, '期末复习.pptx'), workArea: join(directory, '单元测验.pptx') }
  writeFileSync(chosen.explorer, pptxImportFixture()); writeFileSync(chosen.workArea, pptxImportFixture())
  const image = join(directory, 'replacement.png'); writeFileSync(image, solidPng(320, 180, [22, 163, 74]))
  const evidence: Record<string, unknown> = { run: directory }
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
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await expect(tree.getByRole('button', { name: COURSE, exact: true })).toBeVisible()

    const documentOf = (name: string) => page.evaluate(async file => {
      const found = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith(file))
      if (!found || found.model.kind !== 'course-v9') throw new Error(`no course ${file}`)
      const slide = found.model.project.surfaces.find(surface => surface.type === 'slide')
      return { documentId: found.documentId, revision: found.revision, dirty: found.dirty,
        scenes: slide?.type === 'slide' ? slide.scenes.map(scene => ({ id: scene.id, items: scene.layerItems.map(item => item.layerItemId) })) : [],
        locations: found.model.project.locations.map(location => ({ id: location.id, kind: location.kind, label: location.label })) }
    }, name)
    const mode = () => page.locator('.course-editor-frame').first().getAttribute('data-editor-mode')
    const stage = () => settledRect(page, '.canvas-stage-stack')
    const sceneCards = page.getByRole('navigation', { name: '场景与页面导航' }).locator('li[data-kind="slide"]')

    await openInWorkbench(page, COURSE)
    await canvasReady(page)
    const opened = await documentOf(COURSE)
    evidence.opened = opened

    // ---------------------------------------------------------------- M21-T05 in the workbench
    const workbenchMenus: Record<string, unknown> = {}
    await test.step('M21-T05 workbench: an object\'s right-click menu is the quick bar "⋯" plus its main action; unavailable items say why', async () => {
      expect(await mode()).toBe('light')
      const box = await stage()
      const menu = await contextMenuAt(page, onStage(box, centre(FRAMES.title)), '对象操作')
      const items = await menuItems(menu)
      expect(items.map(item => item.label)).toEqual(['编辑文字', ...OBJECT_ITEMS])
      // The title is the lowest object: moving it down says why instead of disappearing.
      expect(items.find(item => item.label === '下移一层')?.reason).toBe('已在最下层')
      expect(items.find(item => item.label === '置于底层')?.reason).toBe('已在最下层')
      await page.screenshot({ path: join(shots, 'workbench-object-menu.png') })
      workbenchMenus.object = items
      await closeMenu(page)
      // The quick bar's "⋯" shows the same commands, minus the main action the bar shows as a button.
      await page.getByRole('button', { name: '更多操作', exact: true }).click()
      const more = await menuItems(page.getByRole('menu', { name: '更多操作' }))
      expect(more).toEqual(items.filter(item => !PRIMARY.has(item.label)))
      await page.keyboard.press('Escape')
      // A common command runs from the menu: 创建副本 adds one object, undo takes it back.
      const before = (await documentOf(COURSE)).scenes[0]!.items.length
      const again = await contextMenuAt(page, onStage(box, centre(FRAMES.title)), '对象操作')
      await again.getByRole('menuitem', { name: '创建副本', exact: true }).click()
      await expect.poll(async () => (await documentOf(COURSE)).scenes[0]!.items.length).toBe(before + 1)
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await documentOf(COURSE)).scenes[0]!.items.length).toBe(before)
    })

    await test.step('M21-T05 workbench: Runtime text, empty canvas, page card, state button and file tab menus', async () => {
      const box = await stage()
      const runtimeText = { x: RUNTIME_FRAME.x + RUNTIME_TEXT_AT.x + 40, y: RUNTIME_FRAME.y + RUNTIME_TEXT_AT.y + 20 }
      const runtime = await menuItems(await contextMenuAt(page, onStage(box, runtimeText), '对象操作'))
      expect(runtime[0]!.label).toBe('编辑此处文字')
      expect(runtime.map(item => item.label)).toEqual(expect.arrayContaining(OBJECT_ITEMS))
      workbenchMenus.runtime = runtime
      await page.screenshot({ path: join(shots, 'workbench-runtime-menu.png') })
      await closeMenu(page)
      // The teacher controller (a component) keeps its own short list: how playback starts it, hide and lock.
      const controller = await settledRect(page, '[data-controller-authoring-id]')
      const controllerItems = await menuItems(await contextMenuAt(page, centre(controller), '对象操作'))
      expect(controllerItems.map(item => item.label)).toEqual([expect.stringMatching(/^(展开|收起)（播放时默认/), '隐藏', '锁定'])
      workbenchMenus.controller = controllerItems
      await page.screenshot({ path: join(shots, 'workbench-controller-menu.png') })
      await closeMenu(page)

      const blank = onStage(box, { x: 1100, y: 640 })
      const canvas = await contextMenuAt(page, blank, '画布操作')
      const canvasItems = await menuItems(canvas)
      expect(canvasItems.map(item => item.label)).toEqual(CANVAS_ITEMS)
      workbenchMenus.canvas = canvasItems
      await page.screenshot({ path: join(shots, 'workbench-canvas-menu.png') })
      const before = (await documentOf(COURSE)).scenes[0]!.items.length
      await canvas.getByRole('menuitem', { name: '在此插入矩形', exact: true }).click()
      await expect.poll(async () => (await documentOf(COURSE)).scenes[0]!.items.length).toBe(before + 1)
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await documentOf(COURSE)).scenes[0]!.items.length).toBe(before)

      const card = await sceneCards.first().boundingBox()
      const scene = await menuItems(await contextMenuAt(page, { x: card!.x + 30, y: card!.y + 20 }, '场景操作'))
      expect(scene.map(item => item.label)).toEqual(SCENE_ITEMS)
      expect(scene.find(item => item.label === '前移')?.reason).toBeTruthy()
      workbenchMenus.scene = scene
      await closeMenu(page)

      const master = sceneCards.first().getByRole('button', { name: '母版', exact: true })
      const masterBox = await master.boundingBox()
      const state = await menuItems(await contextMenuAt(page, centre(masterBox!), '状态操作'))
      expect(state.map(item => item.label)).toEqual(STATE_ITEMS)
      for (const label of ['创建副本', '重命名', '删除状态']) expect(state.find(item => item.label === label)?.reason).toBe('母版不能复制、改名或删除')
      workbenchMenus.state = state
      await page.screenshot({ path: join(shots, 'workbench-state-menu.png') })
      await closeMenu(page)

      const tab = page.getByRole('tablist', { name: '打开的文件' }).getByRole('tab', { name: new RegExp(`^${COURSE.replace('.', '\\.')}`) })
      const tabBox = await tab.boundingBox()
      const tabMenu = await menuItems(await contextMenuAt(page, centre(tabBox!), /标签菜单$/))
      expect(tabMenu.map(item => item.label)).toEqual(['关闭', '关闭其他', '关闭右侧', '全部关闭', '复制路径', '在资源管理器中显示', '用系统应用打开'])
      workbenchMenus.tab = tabMenu
      await page.screenshot({ path: join(shots, 'workbench-tab-menu.png') })
      await closeMenu(page)
      evidence.workbenchMenus = workbenchMenus
    })

    // ---------------------------------------------------------------- M21-T04: only the top-right button enters the editor
    await test.step('M21-T04 replacing an image and every menu stay in the workbench; 在编辑器中打开 keeps the document and selection', async () => {
      const box = await stage()
      const photo = onStage(box, centre(FRAMES.photo))
      const photoMenu = await contextMenuAt(page, photo, '对象操作')
      const labels = (await menuItems(photoMenu)).map(item => item.label)
      expect(labels[0]).toBe('替换图片…')
      for (const entry of ['属性', '详细属性', '打开图层', '在编辑器中打开']) expect(labels).not.toContain(entry)
      const assetsBefore = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file')!.model)
      await photoMenu.getByRole('menuitem', { name: '替换图片…', exact: true }).click()
      await expect.poll(async () => {
        const model = await page.evaluate(async () => {
          const found = (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.endsWith('m21.h5lesson'))!
          return found.model.kind === 'course-v9' ? Object.keys(found.model.project.assets) : []
        })
        return model.length
      }).toBeGreaterThan(assetsBefore.kind === 'course-v9' ? Object.keys(assetsBefore.project.assets).length : 0)
      expect(await mode()).toBe('light')
      await page.screenshot({ path: join(shots, 'workbench-image-replaced.png') })
      // The replaced image stays selected; the editor opens on the same document with it, and returning keeps both.
      const before = await documentOf(COURSE)
      const quickBar = page.locator('[data-selection-quick-bar]').filter({ visible: true })
      await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
      await expect.poll(mode).toBe('deep')
      await canvasReady(page)
      expect((await documentOf(COURSE)).documentId).toBe(before.documentId)
      await expect(quickBar).toHaveCount(1)
      await page.screenshot({ path: join(shots, 'editor-entered.png') })
      await page.getByRole('button', { name: '返回工作台', exact: true }).click()
      await expect.poll(mode).toBe('light')
      await canvasReady(page)
      expect((await documentOf(COURSE)).documentId).toBe(before.documentId)
      await expect(quickBar).toHaveCount(1)
      await page.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
      await expect.poll(mode).toBe('deep')
      await canvasReady(page)
      evidence.editorEntry = { documentId: before.documentId }
    })

    // ---------------------------------------------------------------- M21-T05 in the editor: the same lists
    await test.step('M21-T05 editor: the same object, canvas, scene and state menus as the workbench', async () => {
      const box = await stage()
      const object = await menuItems(await contextMenuAt(page, onStage(box, centre(FRAMES.title)), '对象操作'))
      expect(object).toEqual(workbenchMenus.object)
      await closeMenu(page)
      const canvas = await menuItems(await contextMenuAt(page, onStage(box, { x: 1100, y: 640 }), '画布操作'))
      expect(canvas).toEqual(workbenchMenus.canvas)
      await closeMenu(page)
      const controller = await menuItems(await contextMenuAt(page, centre(await settledRect(page, '[data-controller-authoring-id]')), '对象操作'))
      expect(controller).toEqual(workbenchMenus.controller)
      await closeMenu(page)
      // The editor's scene list offers the page bar's scene commands.
      const row = page.locator('.course-page-tree__label').filter({ hasText: '导入' }).first()
      await row.scrollIntoViewIfNeeded()
      const rowBox = await row.boundingBox()
      const scene = await menuItems(await contextMenuAt(page, centre(rowBox!), '场景操作'))
      expect(scene.map(item => item.label)).toEqual(SCENE_ITEMS)
      await closeMenu(page)
      const master = page.locator('.scene-state-strip').getByRole('button', { name: '母版，所有命名状态的继承源', exact: true }).first()
      await master.scrollIntoViewIfNeeded()
      const masterBox = await master.boundingBox()
      const state = await menuItems(await contextMenuAt(page, centre(masterBox!), '状态操作'))
      expect(state).toEqual(workbenchMenus.state)
      await page.screenshot({ path: join(shots, 'editor-state-menu.png') })
      await closeMenu(page)
      evidence.editorMenus = { object, canvas, controller, scene, state }
      // M21-T04: a file created or opened from inside the editor stays in the editor.
      await page.getByRole('button', { name: '新建 H5 演示（Ctrl+N）', exact: true }).click()
      await expect.poll(async () => (await page.evaluate(async () => (await window.desktopAPI.documents!.list()).filter(item => item.binding.kind === 'untitled').length))).toBeGreaterThan(1)
      expect(await mode()).toBe('deep')
      await app!.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, join(workspace, OTHER))
      await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
      await expect.poll(() => page.evaluate(async file => (await window.desktopAPI.documents!.list())
        .some(item => item.binding.kind === 'file' && item.binding.path.endsWith(file)), OTHER), { timeout: 30_000 }).toBe(true)
      await expect.poll(mode).toBe('deep')
      await page.screenshot({ path: join(shots, 'editor-opened-other.png') })
      await page.getByRole('button', { name: '返回工作台', exact: true }).click()
      await expect.poll(mode).toBe('light')
      await openInWorkbench(page, COURSE)
      await canvasReady(page)
    })

    // ---------------------------------------------------------------- M21-T06 page management
    await test.step('M21-T06 the always-shown "+", copy, rename, drag and delete pages; undo; save and reopen', async () => {
      const add = page.getByRole('button', { name: '新建场景或页面', exact: true })
      await expect(add).toBeVisible()
      const start = await sceneCards.count()
      await add.click()
      const newMenu = page.getByRole('menu', { name: '新建场景或页面' })
      expect((await menuItems(newMenu)).map(item => item.label)).toEqual(['新建场景', '新建演示页', '新建流式讲义', '新建无限画布'])
      await newMenu.getByRole('menuitem', { name: '新建场景', exact: true }).click()
      await expect(sceneCards).toHaveCount(start + 1)
      // Copy the first scene, then rename the copy in place.
      let card = await sceneCards.first().boundingBox()
      await (await contextMenuAt(page, { x: card!.x + 30, y: card!.y + 20 }, '场景操作')).getByRole('menuitem', { name: '创建副本', exact: true }).click()
      await expect(sceneCards).toHaveCount(start + 2)
      card = await sceneCards.nth(1).boundingBox()
      await (await contextMenuAt(page, { x: card!.x + 30, y: card!.y + 20 }, '场景操作')).getByRole('menuitem', { name: '重命名', exact: true }).click()
      const rename = page.getByLabel('场景名称', { exact: true })
      await rename.fill('复习')
      await rename.press('Enter')
      await expect(sceneCards.nth(1)).toContainText('复习')
      // Drag 复习 in front of the first scene.
      await sceneCards.nth(1).dragTo(sceneCards.first())
      await expect(sceneCards.first()).toContainText('复习')
      await page.screenshot({ path: join(shots, 'pages-reordered.png') })
      // More pages than fit: the cards scroll, the "+" stays in view and takes a click at its centre.
      const nav = await page.getByRole('navigation', { name: '场景与页面导航' }).boundingBox()
      const plus = await add.boundingBox()
      const overflow = await page.locator('.bottom-scene-nav__track').evaluate(track => track.scrollWidth - track.clientWidth)
      expect(overflow).toBeGreaterThan(0)
      expect(plus!.x + plus!.width).toBeLessThanOrEqual(nav!.x + nav!.width)
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
        centre(plus!))).toBe('新建场景或页面')
      evidence.plusInView = { nav, plus, overflow }
      // Delete the last scene after confirming; undo brings it back.
      const last = await sceneCards.last().boundingBox()
      await (await contextMenuAt(page, { x: last!.x + 30, y: last!.y + 20 }, '场景操作')).getByRole('menuitem', { name: '删除场景', exact: true }).click()
      await page.getByRole('dialog').or(page.getByRole('alertdialog')).getByRole('button', { name: '删除场景', exact: true }).click()
      await expect(sceneCards).toHaveCount(start + 1)
      const box = await stage()
      await page.mouse.click(...Object.values(onStage(box, { x: 1100, y: 640 })) as [number, number])
      await page.keyboard.press('Control+Z')
      await expect(sceneCards).toHaveCount(start + 2)
      const shown = await sceneCards.evaluateAll(items => items.map(item => item.querySelector('strong')?.textContent ?? ''))
      await page.keyboard.press('Control+S')
      await expect.poll(async () => (await documentOf(COURSE)).dirty).toBe(false)
      const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, COURSE))))
      const slide = saved.project.surfaces.find(surface => surface.type === 'slide')
      if (slide?.type !== 'slide') throw new Error('slide surface')
      expect(slide.scenes).toHaveLength(start + 2)
      // Close and reopen: the page bar shows the saved order and names.
      await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
      await openInWorkbench(page, COURSE)
      await canvasReady(page)
      await expect.poll(() => sceneCards.evaluateAll(items => items.map(item => item.querySelector('strong')?.textContent ?? ''))).toEqual(shown)
      evidence.pages = { start, shown, savedScenes: slide.scenes.map(scene => scene.id) }
    })

    // ---------------------------------------------------------------- M21-T06 top bar
    await test.step('M21-T06 整课预览 and 导出 in the top bar, 当前位置试运行 by the canvas, no 工程检查', async () => {
      const row = page.getByLabel('常用工具')
      const order = await row.locator('button:not([role="menuitem"]), summary').evaluateAll(elements => elements.filter(element => (element as HTMLElement).offsetParent !== null)
        .map(element => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''))
      expect(order.indexOf('导出')).toBe(order.indexOf('整课预览') + 1)
      expect(order.indexOf('在编辑器中打开')).toBeGreaterThan(order.indexOf('导出'))
      await expect(page.getByRole('button', { name: '当前位置试运行', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /工程检查/ }).filter({ visible: true })).toHaveCount(0)
      evidence.topBar = order
      await row.getByRole('button', { name: '整课预览', exact: true }).click()
      await expect(page.locator('.course-preview-host [data-playback-view]')).toBeVisible()
      await page.screenshot({ path: join(shots, 'top-bar-preview.png') })
      await page.getByRole('button', { name: '关闭预览', exact: true }).click()
      expect(await mode()).toBe('light')
      const exported = join(directory, 'm21-export.html')
      await app!.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, exported)
      await page.getByTestId('light-export-menu-trigger').click()
      await page.getByTestId('light-export-single-html').click()
      await expect.poll(async () => {
        const proceed = page.getByRole('alertdialog').getByRole('button', { name: /^(继续导出|仍然导出)$/ }).first()
        if (!existsSync(exported) && await proceed.isVisible().catch(() => false)) await proceed.click().catch(() => {})
        return existsSync(exported)
      }, { timeout: 60_000 }).toBe(true)
      await expect.poll(() => readFileSync(exported).byteLength).toBeGreaterThan(10_000)
      expect(await mode()).toBe('light')
      evidence.exported = { path: exported, bytes: readFileSync(exported).byteLength }
    })

    // ---------------------------------------------------------------- M21-T06 three PPT entries
    const pptCourse = (file: string) => {
      const course = openCourseProjectArchive(new Uint8Array(readFileSync(file)))
      return { surfaces: course.project.surfaces.map(surface => surface.type), title: course.project.title }
    }
    await test.step('M21-T06 explorer right-click on a .pptx: 导入为 H5 演示 beside it', async () => {
      await tree.getByRole('button', { name: '展开 decks', exact: true }).click()
      const deck = tree.getByRole('button', { name: '第一课.pptx', exact: true })
      const deckBox = await deck.boundingBox()
      const menu = await contextMenuAt(page, centre(deckBox!), '文件菜单')
      await expect(menu.getByRole('menuitem').first()).toHaveAttribute('aria-label', '导入为 H5 演示')
      await page.screenshot({ path: join(shots, 'ppt-explorer-context.png') })
      await menu.getByRole('menuitem', { name: '导入为 H5 演示', exact: true }).click()
      const created = join(workspace, 'decks', '第一课.h5lesson')
      await expect.poll(() => existsSync(created)).toBe(true)
      await expect(page.getByRole('tab', { name: /^第一课\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
      await expect(sceneCards).toHaveCount(1)
      expect(pptCourse(created)).toEqual({ surfaces: ['slide'], title: '第一课' })
      await page.screenshot({ path: join(shots, 'ppt-explorer-context-created.png') })
    })
    await test.step('M21-T06 explorer 新建 ▸ 从 PPT 新建 H5 演示 in the chosen folder', async () => {
      await tree.getByRole('button', { name: '工作空间根目录', exact: true }).click()
      await page.getByRole('toolbar', { name: '文件管理' }).getByLabel('新建文件或文件夹').click()
      const chooser = page.waitForEvent('filechooser')
      await page.locator('.workspace-files-create-options').getByRole('menuitem', { name: '从 PPT 新建 H5 演示', exact: true }).click()
      await (await chooser).setFiles(chosen.explorer)
      const created = join(workspace, '期末复习.h5lesson')
      await expect.poll(() => existsSync(created)).toBe(true)
      await expect(page.getByRole('tab', { name: /^期末复习\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
      expect(pptCourse(created)).toEqual({ surfaces: ['slide'], title: '期末复习' })
    })
    await test.step('M21-T06 work area 新建 ▸ 从 PPT 新建 H5 演示 opens an untitled H5 presentation', async () => {
      await page.getByLabel('新建标签页', { exact: true }).click()
      const chooser = page.waitForEvent('filechooser')
      await page.locator('.lesson-new-tab-popover').getByRole('button', { name: '从 PPT 新建 H5 演示', exact: true }).click()
      await (await chooser).setFiles(chosen.workArea)
      await expect(page.getByRole('tab', { name: /^单元测验\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
      await expect(sceneCards).toHaveCount(1)
      const untitled = await page.evaluate(async () => (await window.desktopAPI.documents!.list())
        .filter(item => item.binding.kind === 'untitled' && item.model.kind === 'course-v9')
        .map(item => ({ name: item.binding.kind === 'untitled' ? item.binding.suggestedName : '', dirty: item.dirty,
          surfaces: item.model.kind === 'course-v9' ? item.model.project.surfaces.map(surface => surface.type) : [] })))
      // (The other untitled documents are the startup one and the one made in the editor.)
      expect(untitled.filter(item => item.name === '单元测验.h5lesson')).toEqual([{ name: '单元测验.h5lesson', dirty: true, surfaces: ['slide'] }])
      expect(await mode()).toBe('light')
      await page.screenshot({ path: join(shots, 'ppt-work-area-created.png') })
      evidence.ppt = { untitled }
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
