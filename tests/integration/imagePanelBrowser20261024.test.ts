// @vitest-environment node
import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import { setRootContainers } from '../helpers/glxWorkFixture'

// Emulate structured-clone binary values across the test's HTTP/Playwright transport.
const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? { __imageTestBytes: [...item] } : item))
const revive = (value: unknown): any => {
  if (!value || typeof value !== 'object') return value
  if ('__imageTestBytes' in value) return Uint8Array.from((value as any).__imageTestBytes)
  return Array.isArray(value) ? value.map(revive) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
}

it('edits a native image through its real double-click panel, keeps replacement layout and saves a cold-reopenable result', async () => {
  const directory = resolve('output/test-runs/image-panel-browser')
  await mkdir(directory, { recursive: true })
  const original = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#2797c5"/><circle cx="70" cy="70" r="45" fill="#fff"/><rect x="220" y="100" width="70" height="80" fill="#ef715e"/></svg>')).png().toBuffer()
  const replacementBytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><rect width="500" height="100" fill="#e8a330"/><rect width="100" height="100" fill="#2797c5"/><circle cx="430" cy="50" r="30" fill="white"/></svg>')).png().toBuffer()
  const project = createBlankCourseProjectV10('Image panel browser'), surfaceId = project.rootIds[0]!
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.assets.original = { id: 'original', path: 'assets/original.png', mimeType: 'image/png', filename: 'original.png', kind: 'image', width: 320, height: 200, byteLength: original.length }
  project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, name: '原生图片', data: JSON.parse(JSON.stringify(createImageData('original', '原生图片'))),
    frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 240, 180] } }
  setRootContainers(project, [{ id: surfaceId, title: 'Slide', kind: 'slide', childIds: ['picture'], designSize: { width: 1280, height: 720 } }])
  const host = new DocumentHostService(join(directory, `recovery-${Date.now()}`))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { original: Uint8Array.from(original) }, components: {} } }, 'image.glx')
  const replacement = { meta: { id: 'replacement', path: 'assets/replacement.png', mimeType: 'image/png', filename: 'replacement.png', kind: 'image', width: 500, height: 100, byteLength: replacementBytes.length }, bytes: Uint8Array.from(replacementBytes) }
  const events: DocumentEvent[] = [], off = host.subscribeEvents(event => events.push(event)), errors: string[] = []
  const bundle = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/imagePanelBrowserHarness"', resolveDir: process.cwd() },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'ImagePanelBrowser', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true, args: process.env.IMAGE_PANEL_BROWSER_REVIEW ? ['--remote-debugging-port=9471'] : [] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message))
  const readPicture = async () => {
    const snapshot = await host.internalAPI.read(initial.documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course')
    const instance = snapshot.model.project.instances.picture!
    return { ...instance, data: imageDataSchema.parse(instance.data) }
  }
  try {
    await page.route('http://localhost/image-panel-browser', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>图片简易编辑验证</title><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
    await page.goto('http://localhost/image-panel-browser')
    await page.exposeFunction('imageDocumentCall', async (name: string, rawArgs: unknown) => {
      const args = revive(rawArgs)
      const result = name === 'bootstrapCourse' ? await host.internalAPI.read(initial.documentId)
        : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0])
        : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0], args[1])
        : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0])
        : await (host.internalAPI as any)[name](...args)
      return wire({ result, events: events.splice(0) })
    })
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.evaluate(async rawReplacement => {
      const encode = (value: any) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? { __imageTestBytes: [...item] } : item))
      const decode = (value: any): any => !value || typeof value !== 'object' ? value : value.__imageTestBytes ? Uint8Array.from(value.__imageTestBytes)
        : Array.isArray(value) ? value.map(decode) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
      const listeners = new Set<(event: any) => void>()
      const methods = ['list', 'read', 'dispatch', 'lookup', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
      const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
        const packet = decode(await (window as any).imageDocumentCall(name, encode(args)))
        packet.events.forEach((event: any) => listeners.forEach(listener => listener(event)))
        return packet.result
      }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
      ;(window as any).imageHarness = await (window as any).ImagePanelBrowser.mountImagePanelBrowserHarness(document.getElementById('editor'), api, decode(rawReplacement))
    }, wire(replacement))
    const image = page.locator('[data-component-instance="picture"] img').first()
    await image.waitFor()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(320)
    const doubleClickImage = async () => {
      const rect = await image.boundingBox()
      if (!rect) throw new Error('Missing native image bounds')
      await page.mouse.dblclick(rect.x + rect.width / 2, rect.y + rect.height / 2)
    }
    await doubleClickImage()
    const panel = page.getByRole('dialog', { name: '图片简易编辑', exact: true })
    await panel.waitFor()
    expect(await page.evaluate(() => (window as any).imageHarness.pickerCalls)).toBe(0)
    expect(await page.locator('[data-selection-quick-bar]:visible').count()).toBe(0)
    expect(await page.getByRole('button', { name: '完成裁剪', exact: true }).count()).toBe(0)
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(0)

    await panel.getByRole('button', { name: '向右旋转90°', exact: true }).click()
    await expect.poll(async () => (await readPicture()).frame!.transform[1]).toBeCloseTo(1)
    const rotated = (await readPicture()).frame
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(1)
    await page.evaluate(async () => (window as any).ImagePanelBrowser.useEditorStore.getState().undo())
    expect((await readPicture()).frame).toEqual(project.instances.picture.frame)
    await page.evaluate(async () => (window as any).ImagePanelBrowser.useEditorStore.getState().redo())
    expect((await readPicture()).frame).toEqual(rotated)
    await panel.getByRole('button', { name: '水平翻转', exact: true }).click()
    await expect.poll(async () => (await readPicture()).data.flipX).toBe(true)
    await expect.poll(() => image.evaluate(element => element.style.transform)).toMatch(/scale\(-1,\s*1\)/)
    await panel.getByRole('combobox', { name: '图片显示方式', exact: true }).selectOption('cover')
    await expect.poll(async () => (await readPicture()).data.fit).toBe('cover')
    await panel.getByText('调整', { exact: true }).click()
    await panel.getByRole('spinbutton', { name: '亮度（%）', exact: true }).fill('125')
    await panel.getByRole('spinbutton', { name: '亮度（%）', exact: true }).press('Enter')
    await expect.poll(async () => (await readPicture()).data.filters.brightness).toBe(1.25)
    await expect.poll(() => image.evaluate(element => element.parentElement!.style.filter)).toContain('brightness(1.25)')
    const beforeReplace = structuredClone(await readPicture())
    await panel.getByRole('button', { name: '替换图片', exact: true }).click()
    await expect.poll(async () => (await readPicture()).data.assetId).toBe('replacement')
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(500)
    const replaced = await readPicture()
    expect(replaced.frame).toEqual(beforeReplace.frame)
    expect(replaced.flowLayout).toEqual(beforeReplace.flowLayout)
    expect(replaced.data).toMatchObject({ fit: 'cover', flipX: true, filters: { brightness: 1.25 }, originalAssetId: 'replacement' })
    expect(await page.evaluate(() => (window as any).imageHarness.pickerCalls)).toBe(1)
    await panel.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(() => panel.count()).toBe(0)
    const selected = () => page.evaluate(() => (window as any).ImagePanelBrowser.useEditorStore.getState().courseView.selectedInstanceIds)
    expect(await selected()).toEqual(['picture'])
    const beforeDrag = structuredClone(await readPicture()), box = await image.boundingBox()
    if (!box) throw new Error('Missing native image bounds')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 30, { steps: 4 }); await page.mouse.up()
    await expect.poll(async () => (await readPicture()).frame!.transform).not.toEqual(beforeDrag.frame!.transform)
    expect(await selected()).toEqual(['picture'])
    await doubleClickImage(); await panel.waitFor(); await page.keyboard.press('Escape')
    await expect.poll(() => panel.count()).toBe(0)
    expect(await selected()).toEqual(['picture'])

    const savedPicture = structuredClone(await readPicture()), filename = join(directory, `image-panel-saved-${randomUUID()}.glx`)
    await host.internalAPI.save(initial.documentId, filename)
    const coldHost = new DocumentHostService(join(directory, `cold-recovery-${Date.now()}`))
    const cold = await coldHost.internalAPI.open(filename)
    if (cold.model.kind !== 'course-v10') throw new Error('Expected cold-opened course')
    expect(cold.model.project.instances.picture).toEqual(savedPicture)
    expect(cold.model.resources.assets.replacement!.byteLength).toBe(replacementBytes.length)
    expect(cold.dirty).toBe(false)
    await doubleClickImage(); await panel.waitFor()
    await page.screenshot({ path: join(directory, 'image-panel.png') })
    expect(await page.evaluate(() => (window as any).imageHarness.errors)).toEqual([])
    expect(errors).toEqual([])
    await writeFile(join(directory, 'facts.json'), JSON.stringify({ browser: browser.version(), actualMainStoreBridge: true,
      doubleClickOpensPanelWithoutPickerOrCrop: true, rotationUndoRedo: true, flip: true, fit: true, brightness: true,
      replacementPreservesFrameAndLayout: true, doneAndEscKeepSelection: true, dragAfterDone: true,
      savedFile: filename, coldOpenViaNewDocumentHostService: true, errors }, null, 2))
    if (process.env.IMAGE_PANEL_BROWSER_REVIEW) {
      await page.evaluate(() => { (window as any).imageGUIReviewReady = true })
      await page.waitForFunction(() => (window as any).imageGUIReviewDone === true, undefined, { timeout: 120_000 })
    }
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: String(error), errors, body: await page.locator('body').innerText(), interaction: await page.evaluate(() => (window as any).ImagePanelBrowser?.useEditorStore.getState().courseView.interactionSelection) }, null, 2))
    throw error
  } finally {
    await page.evaluate(() => (window as any).imageHarness?.dispose()).catch(() => {})
    await page.close(); await browser.close(); off()
  }
}, 180_000)


it('crops a Spatial native image from its simple panel through one canonical history step and keeps selection after Undo', async () => {
  const directory = resolve('output/test-runs/image-panel-browser/spatial-crop')
  await mkdir(directory, { recursive: true })
  const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#2797c5"/><circle cx="70" cy="70" r="45" fill="#fff"/><rect x="220" y="100" width="70" height="80" fill="#ef715e"/></svg>')).png().toBuffer()
  const project = createBlankCourseProjectV10('Spatial image crop'), surfaceId = project.rootIds[0]!
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.assets.original = { id: 'original', path: 'assets/original.png', mimeType: 'image/png', filename: 'original.png', kind: 'image', width: 320, height: 200, byteLength: bytes.length }
  project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, name: '空间图片', data: JSON.parse(JSON.stringify(createImageData('original', '空间图片'))),
    frame: { width: 320, height: 200, transform: [1, 0, 0, 1, -160, -100] } }
  setRootContainers(project, [{ id: surfaceId, title: 'Spatial', kind: 'spatial', childIds: ['picture'], designSize: { width: 1280, height: 720 },
    spatial: { home: { x: 0, y: 0, zoom: 1.5 }, frames: [] } }])
  const host = new DocumentHostService(join(directory, `recovery-${Date.now()}`))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: { original: Uint8Array.from(bytes) }, components: {} } }, 'spatial.glx')
  const events: DocumentEvent[] = [], off = host.subscribeEvents(event => events.push(event)), errors: string[] = []
  const bundle = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/imagePanelBrowserHarness"', resolveDir: process.cwd() },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'ImagePanelBrowser', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message))
  const readPicture = async () => {
    const snapshot = await host.internalAPI.read(initial.documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course')
    const instance = snapshot.model.project.instances.picture!
    return { ...instance, data: imageDataSchema.parse(instance.data) }
  }
  try {
    await page.route('http://localhost/spatial-image-crop', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Spatial 图片裁剪验证</title><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
    await page.goto('http://localhost/spatial-image-crop')
    await page.exposeFunction('imageDocumentCall', async (name: string, rawArgs: unknown) => {
      const args = revive(rawArgs)
      const result = name === 'bootstrapCourse' ? await host.internalAPI.read(initial.documentId)
        : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0])
        : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0], args[1])
        : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0])
        : await (host.internalAPI as any)[name](...args)
      return wire({ result, events: events.splice(0) })
    })
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.evaluate(async rawReplacement => {
      const encode = (value: any) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? { __imageTestBytes: [...item] } : item))
      const decode = (value: any): any => !value || typeof value !== 'object' ? value : value.__imageTestBytes ? Uint8Array.from(value.__imageTestBytes)
        : Array.isArray(value) ? value.map(decode) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
      const listeners = new Set<(event: any) => void>()
      const methods = ['list', 'read', 'dispatch', 'lookup', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
      const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
        const packet = decode(await (window as any).imageDocumentCall(name, encode(args)))
        packet.events.forEach((event: any) => listeners.forEach(listener => listener(event)))
        return packet.result
      }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
      ;(window as any).imageHarness = await (window as any).ImagePanelBrowser.mountImagePanelBrowserHarness(document.getElementById('editor'), api, decode(rawReplacement))
    }, wire({ meta: project.assets.original, bytes: Uint8Array.from(bytes) }))
    const image = page.locator('[data-spatial-world] [data-component-instance="picture"] img').first()
    await image.waitFor()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(320)
    const originalBox = await image.boundingBox()
    if (!originalBox) throw new Error('Missing Spatial native image bounds')
    await page.mouse.dblclick(originalBox.x + originalBox.width / 2, originalBox.y + originalBox.height / 2)
    const panel = page.getByRole('dialog', { name: '图片简易编辑', exact: true })
    await panel.waitFor()
    const cropButton = panel.getByRole('button', { name: '裁剪', exact: true })
    expect(await cropButton.isEnabled()).toBe(true)
    await cropButton.click()
    const crop = page.getByRole('dialog', { name: '裁剪图片', exact: true })
    await crop.waitFor()
    const right = crop.getByRole('slider', { name: '裁剪右边', exact: true }), edge = await right.boundingBox()
    if (!edge) throw new Error('Missing crop right handle')
    // Keep 7/8 of an uncropped 320px image at actual Spatial camera zoom 1.5.
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down()
    await page.mouse.move(edge.x + edge.width / 2 - originalBox.width / 8, edge.y + edge.height / 2, { steps: 4 }); await page.mouse.up()
    await crop.getByRole('button', { name: '完成', exact: true }).click()
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(1)
    const cropped = await readPicture()
    expect(cropped.frame!.width).toBeCloseTo(280, 6)
    expect(cropped.frame!.height).toBeCloseTo(200, 6)
    expect(cropped.frame!.transform).toEqual([1, 0, 0, 1, -160, -100])
    expect(cropped.data.crop.left).toBe(0); expect(cropped.data.crop.top).toBe(0); expect(cropped.data.crop.bottom).toBe(0)
    expect(cropped.data.crop.right).toBeCloseTo(.125, 6)
    expect(cropped.data).toMatchObject({ assetId: 'original', originalAssetId: 'original', fit: 'stretch', cropX: .5, cropY: .5 })
    await expect.poll(() => crop.count()).toBe(0)
    await panel.getByRole('button', { name: '完成', exact: true }).click()
    const selected = () => page.evaluate(() => (window as any).ImagePanelBrowser.useEditorStore.getState().courseView.selectedInstanceIds)
    expect(await selected()).toEqual(['picture'])
    await page.screenshot({ path: join(directory, 'spatial-cropped.png') })
    await page.evaluate(async () => (window as any).ImagePanelBrowser.useEditorStore.getState().undo())
    expect(await readPicture()).toEqual(project.instances.picture)
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(0)
    expect(await selected()).toEqual(['picture'])
    expect(await page.evaluate(() => (window as any).imageHarness.pickerCalls)).toBe(0)
    expect(await page.evaluate(() => (window as any).imageHarness.errors)).toEqual([])
    expect(errors).toEqual([])
    await writeFile(join(directory, 'facts.json'), JSON.stringify({ cameraZoom: 1.5, originalBox, cropFrame: cropped.frame, crop: cropped.data.crop,
      actualMainStoreBridge: true, panelToExistingCropOverlay: true, oneHistoryStep: true, undoRestoresWholeInstance: true, keepSelection: true, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: String(error), errors, body: await page.locator('body').innerText(), interaction: await page.evaluate(() => (window as any).ImagePanelBrowser?.useEditorStore.getState().courseView.interactionSelection) }, null, 2))
    throw error
  } finally {
    await page.evaluate(() => (window as any).imageHarness?.dispose()).catch(() => {})
    await page.close(); await browser.close(); off()
  }
}, 60_000)
