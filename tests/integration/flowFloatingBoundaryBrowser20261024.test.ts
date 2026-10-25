// @vitest-environment node
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { POPOVER_DEFINITION, createPopoverData } from '../../src/components/popover'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData, createTeacherControllerFrame } from '../../src/components/teacher-controller/data'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import { setRootContainers } from '../helpers/glxWorkFixture'

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))

async function selected(page: Page) {
  return page.evaluate(() => (window as any).FlowBoundary.useEditorStore.getState().courseView.selectedInstanceIds)
}

for (const mode of ['boundary', 'crop'] as const) {
it(mode === 'boundary' ? 'reserves Flow floating DOM controls for run mode and exposes one locator with low-frequency actions in More'
  : 'crops a Flow floating image through its panel while preserving its frame and paragraph anchor through Undo and Escape', async () => {
  const directory = resolve(`output/test-runs/flow-floating-boundary-20261024${mode === 'crop' ? '-crop' : ''}`)
  await mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('Flow floating boundary'), surfaceId = project.rootIds[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions[POPOVER_DEFINITION.id] = POPOVER_DEFINITION
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.definitions[TEACHER_CONTROLLER_DEFINITION.id] = TEACHER_CONTROLLER_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('Flow reading paragraph.')) }
  project.instances.floating = { id: 'floating', definitionId: POPOVER_DEFINITION.id, data: json({ ...createPopoverData(), label: '显示浮层提示' }),
    frame: { width: 220, height: 90, transform: [1, 0, 0, 1, 100, 300] }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  const picture = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="#69a893"/></svg>')
  project.assets.picture = { id: 'picture', path: 'assets/picture.svg', mimeType: 'image/svg+xml', kind: 'image', width: 180, height: 90, byteLength: picture.length }
  project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, data: json(createImageData('picture')),
    frame: { width: 180, height: 90, transform: [1, 0, 0, 1, 0, 0] } }
  if (mode === 'crop') project.instances.floating = { id: 'floating', definitionId: IMAGE_DEFINITION.id,
    data: json({ ...createImageData('picture'), fit: 'cover' }), frame: { width: 220, height: 110, transform: [1, 0, 0, 1, 100, 500] },
    flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'body', xRatio: .1, offsetY: 420 } } }
  project.instances.teacher = { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id,
    data: json(createTeacherControllerData()), frame: createTeacherControllerFrame() }
  project.global = { underlay: [], overlay: ['teacher'] }
  // This authored fixture explicitly contains a teacher controller; blank projects otherwise hide canvas controls at run time.
  project.playback = { ...project.playback, keyboardNavigation: project.playback?.keyboardNavigation ?? true, controls: 'canvas',
    presenter: project.playback?.presenter ?? { enabled: false, strategy: 'scene-navigation', additionalBindings: [] } }
  setRootContainers(project, [{ id: surfaceId, title: 'Flow', kind: 'flow', childIds: ['body', 'picture', 'floating'],
    designSize: { width: 1280, height: 720 }, flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } }])
  const host = new DocumentHostService(join(directory, `recovery-${Date.now()}`))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { picture }, components: {} } }, 'flow.glx')
  const events: DocumentEvent[] = [], off = host.subscribeEvents(event => events.push(event)), errors: string[] = []
  // Diagnostic source root is optional: it permits the identical mounted fixture to demonstrate the unfixed HEAD.
  const sourceRoot = resolve(process.env.FLOW_BOUNDARY_SOURCE_ROOT ?? process.cwd())
  const bundle = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness"', resolveDir: sourceRoot },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'FlowBoundary', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://localhost/flow-floating-boundary', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
    await page.goto('http://localhost/flow-floating-boundary')
    await page.exposeFunction('flowDocumentCall', async (name: string, args: unknown[]) => {
      const result = name === 'bootstrapCourse' ? await host.internalAPI.read(initial.documentId)
        : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
        : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
        : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string)
        : await (host.internalAPI as any)[name](...args)
      return json({ result, events: events.splice(0) })
    })
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.evaluate(async () => {
      const listeners = new Set<(event: any) => void>()
      const hydrate = (snapshot: any) => {
        if (snapshot?.model?.resources) for (const [id, bytes] of Object.entries(snapshot.model.resources.assets))
          snapshot.model.resources.assets[id] = Uint8Array.from(bytes as number[])
        return snapshot
      }
      const methods = ['list', 'read', 'dispatch', 'lookup', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
      const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
        const packet = await (window as any).flowDocumentCall(name, args)
        packet.events.forEach((event: any) => { if (event.snapshot) hydrate(event.snapshot); listeners.forEach(listener => listener(event)) })
        return Array.isArray(packet.result) ? packet.result.map(hydrate) : hydrate(packet.result)
      }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
      ;(window as any).flowHarness = await (window as any).FlowBoundary.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api)
    })
    if (mode === 'crop') {
      const original = project.instances.floating
      const image = page.locator('[data-flow-overlay-id="floating"] img')
      await image.dblclick()
      const panel = page.getByRole('dialog', { name: '图片简易编辑', exact: true })
      await panel.waitFor()
      await panel.getByRole('button', { name: '裁剪', exact: true }).click()
      const crop = page.getByRole('dialog', { name: '裁剪正文图片', exact: true })
      await crop.waitFor()
      expect(await page.locator('[data-selection-quick-bar]:visible').count()).toBeLessThanOrEqual(1)
      const left = crop.getByRole('slider', { name: '左裁剪', exact: true })
      await left.press('Home')
      for (let index = 0; index < 20; index++) await left.press('ArrowRight')
      await crop.getByRole('button', { name: '确认裁剪', exact: true }).click()
      await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(1)
      const cropped = await host.internalAPI.read(initial.documentId)
      expect(cropped.model).toMatchObject({ project: { instances: { floating: { frame: original.frame, flowPlacement: original.flowPlacement,
        data: { crop: { left: .2, top: 0, right: 0, bottom: 0 } } } } } })
      await page.evaluate(async id => (window as any).FlowBoundary.useEditorStore.getState().courseBridge.undo(id), initial.documentId)
      const undone = await host.internalAPI.read(initial.documentId)
      expect(undone.model).toMatchObject({ project: { instances: { floating: original } } })
      await image.dblclick(); await panel.waitFor()
      await panel.getByRole('button', { name: '裁剪', exact: true }).click(); await crop.waitFor()
      await page.keyboard.press('Escape')
      await expect.poll(() => crop.count()).toBe(0)
      const cancelled = await host.internalAPI.read(initial.documentId)
      expect(cancelled.revision).toBe(undone.revision)
      expect(cancelled.model).toEqual(undone.model)
      await expect.poll(() => selected(page)).toEqual(['floating'])
      expect(errors).toEqual([])
      expect(await page.evaluate(() => (window as any).flowHarness.errors)).toEqual([])
      await writeFile(join(directory, 'facts.json'), JSON.stringify({ browser: browser.version(), nativeFloatingImageCrop: true,
        originalFrameAndAnchorPreserved: true, oneHistory: true, undoRestoresOriginal: true, immediateEscapeCancelsWithoutWrite: true,
        selectedAfterEscape: ['floating'], errors }, null, 2))
      return
    }
    const floating = page.locator('[data-flow-overlay-id="floating"]')
    const button = floating.getByRole('button', { name: '显示浮层提示', exact: true })
    await button.waitFor()
    await button.evaluate(element => { (window as any).businessClicks = 0; element.addEventListener('click', () => (window as any).businessClicks++) })
    await button.click()
    await expect.poll(() => selected(page)).toEqual(['floating'])
    expect(await button.getAttribute('aria-expanded')).toBe('false')
    expect(await page.evaluate(() => (window as any).businessClicks)).toBe(0)

    const originalFrame = project.instances.floating.frame!
    const box = await button.boundingBox()
    if (!box) throw new Error('Missing Flow overlay bounds')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 }); await page.mouse.up()
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).revision).toBe(initial.revision + 1)
    expect(await page.evaluate(() => (window as any).businessClicks)).toBe(0)
    await page.evaluate(async id => (window as any).FlowBoundary.useEditorStore.getState().courseBridge.undo(id), initial.documentId)
    expect((await host.internalAPI.read(initial.documentId)).model).toMatchObject({ project: { instances: { floating: { frame: originalFrame } } } })

    await page.getByRole('button', { name: '试运行', exact: true }).click()
    await expect.poll(() => page.locator('.workspace--run').count()).toBe(1)
    await button.click()
    const businessObservation = { businessExpanded: await button.getAttribute('aria-expanded'),
      businessClicks: await page.evaluate(() => (window as any).businessClicks) }
    // The default builtin teacher is a host DOM control, rather than an iframe surrogate.
    await page.getByRole('button', { name: '展开教师控制器', exact: true }).click()
    const runObservation = { ...businessObservation,
      teacherExpanded: await page.getByRole('button', { name: '收起教师控制器', exact: true }).count() === 1 }
    await writeFile(join(directory, sourceRoot === resolve(process.cwd()) ? 'fixed-run-clicks.json' : 'unfixed-run-clicks.json'), JSON.stringify(runObservation, null, 2))
    expect(runObservation).toEqual({ businessExpanded: 'true', businessClicks: 1, teacherExpanded: true })
    await page.getByRole('button', { name: '收起教师控制器', exact: true }).waitFor()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await button.click()
    await expect.poll(() => selected(page)).toEqual(['floating'])
    expect(await page.evaluate(() => (window as any).businessClicks)).toBe(1)
    const locator = page.getByRole('combobox', { name: '浮层定位模式', exact: true })
    await locator.waitFor()
    expect(await locator.inputValue()).toBe('fixed')
    expect(await page.locator('[data-selection-quick-bar]').count()).toBe(1)
    await locator.selectOption('paragraph')
    await expect.poll(() => locator.inputValue()).toBe('paragraph')
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '移到正文下方', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: '转为正文', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: '删除', exact: true }).waitFor()
    await page.screenshot({ path: join(directory, 'flow-locator-and-more.png') })
    await page.keyboard.press('Escape')
    await page.evaluate(() => { (window as any).imageEdits = []; window.addEventListener('course-image-edit', event => (window as any).imageEdits.push((event as CustomEvent).detail)) })
    await page.locator('[data-flow-block-id="picture"] img').dblclick()
    await page.getByRole('dialog', { name: '图片简易编辑', exact: true }).waitFor()
    expect(await page.locator('[data-selection-quick-bar]:visible').count()).toBe(0)
    await page.keyboard.press('Escape')
    await expect.poll(() => selected(page)).toEqual(['picture'])
    expect(await page.evaluate(() => (window as any).flowHarness.errors)).toEqual([])
    expect(errors).toEqual([])
    await writeFile(join(directory, 'facts.json'), JSON.stringify({ sourceRoot, browser: browser.version(), actualMainStoreBridge: true,
      editBusinessClicks: 0, runBusinessClicks: 1, editAfterRunSelectable: true, dragDoesNotClick: true, undo: true,
      defaultTeacherExpands: true, directLocator: true, oneQuickbar: true, moreContainsLayerBodyDelete: true,
      bodyImagePanelFromDoubleClick: true, pictureSelectedAfterEscape: true, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    await writeFile(join(directory, 'failure.json'), JSON.stringify({ sourceRoot, error: String(error), errors,
      body: await page.locator('body').innerText(), state: await page.evaluate(() => { const state = (window as any).FlowBoundary.useEditorStore.getState(); return {
        ids: state.courseView.selectedInstanceIds, interaction: state.courseView.interactionSelection, imageEdits: (window as any).imageEdits } }),
      pictures: await page.locator('[data-flow-block-id="picture"]').evaluateAll(elements => elements.map(element => element.outerHTML)),
      teachers: await page.locator('[data-flow-overlay-id="teacher"]').evaluateAll(elements => elements.map(element => element.outerHTML)) }, null, 2))
    throw error
  } finally {
    await page.evaluate(() => (window as any).flowHarness?.dispose()).catch(() => {})
    await page.close(); await browser.close(); off()
  }
}, 60_000)
}
