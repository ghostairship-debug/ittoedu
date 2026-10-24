import { expect, test, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import type { ComponentSurface } from '../../src/shared/contracts/component-platform/project'
import type { DocumentEvent, DocumentSnapshot } from '../../src/shared/workbench/document'
import { setRootContainers } from '../helpers/glxWorkFixture'

const root = resolve(__dirname, '../..')
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
const course = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course document')
  return snapshot.model
}
const frame = (x: number, y: number, width = 400, height = 90) => ({ width, height, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })

async function editorBundle(directory: string) {
  const result = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness"', resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'SelectionEditor', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  return `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(result.outputFiles.find(file => file.path.endsWith('.css'))!.text)};document.head.append(s)})();`
    + result.outputFiles.find(file => file.path.endsWith('.js'))!.text
}

/** Same Main API transport as w3FixedViewport: every mutation crosses the real Bridge. */
async function mountEditor(editor: Page, host: DocumentHostService, documentId: string, events: DocumentEvent[], bundle: string) {
  await editor.route('http://localhost/unified-editor', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
  await editor.goto('http://localhost/unified-editor')
  const api = host.internalAPI as any
  await editor.exposeFunction('selectionDocumentCall', async (name: string, args: unknown[]) => {
    const result = name === 'bootstrapCourse' ? await host.internalAPI.read(documentId)
      : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
      : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
      : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string)
      : await api[name](...args)
    return json({ result, events: events.splice(0) })
  })
  await editor.evaluate(bundle)
  await editor.evaluate(async () => {
    const listeners = new Set<(event: any) => void>()
    const hydrate = (snapshot: any) => {
      if (snapshot?.model?.resources) for (const family of ['assets', 'components']) {
        const values = snapshot.model.resources[family]
        for (const [id, value] of Object.entries(values)) values[id] = family === 'assets' ? Uint8Array.from(value as number[])
          : Object.fromEntries(Object.entries(value as object).map(([name, bytes]) => [name, Uint8Array.from(bytes as number[])]))
      }
      return snapshot
    }
    const receive = (events: any[]) => events.forEach(event => { if (event.snapshot) hydrate(event.snapshot); listeners.forEach(listener => listener(event)) })
    const methods = ['list', 'read', 'dispatch', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
    const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
      const packet = await (window as any).selectionDocumentCall(name, args); receive(packet.events)
      return Array.isArray(packet.result) ? packet.result.map(hydrate) : hydrate(packet.result)
    }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
    ;(window as any).selectionHarness = await (window as any).SelectionEditor.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api)
  })
}

const selectionState = (page: Page) => page.evaluate(() => {
  const state = (window as any).SelectionEditor.useEditorStore.getState()
  return { ids: state.courseView.selectedInstanceIds, interaction: state.courseView.interactionSelection,
    editing: Boolean(state.slideContentEdit), group: state.courseView.activeGroupId ?? null, error: state.error }
})
async function dragBody(page: Page, selector: string, dx = 48, dy = 26) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`Missing object body: ${selector}`)
  const x = box.x + Math.min(50, box.width / 2), y = box.y + Math.min(25, box.height / 2)
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up()
}
async function clickBody(page: Page, selector: string, twice = false, x = 40, y = 20) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`Missing object body: ${selector}`)
  // Slide's real hit plane intentionally covers the runtime DOM. Hit the displayed
  // pixels through the pointer owner instead of requiring the runtime node to receive events.
  if (twice) await page.mouse.dblclick(box.x + x, box.y + y)
  else await page.mouse.click(box.x + x, box.y + y)
}

async function saveAndColdOpen(host: DocumentHostService, id: string, directory: string) {
  const filename = join(directory, 'saved.glx'), output = join(directory, 'cold-snapshot.json')
  await host.saveToPath(id, filename)
  // A different Node process has no live Store/Bridge, recovery object, or in-memory model.
  const source = `import {DocumentHostService} from ${JSON.stringify(pathToFileURL(join(root, 'src/main/workbench/DocumentHostService.ts')).href)};import {writeFile} from 'node:fs/promises';const s=await new DocumentHostService(${JSON.stringify(join(directory, 'cold-process-recovery'))}).open(${JSON.stringify(filename)});await writeFile(${JSON.stringify(output)},JSON.stringify(s,(_k,v)=>v instanceof Uint8Array?[...v]:v));`
  await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { cwd: root, timeout: 30_000 })
  const reopened = JSON.parse(await fs.readFile(output, 'utf8')) as DocumentSnapshot
  expect(course(reopened).project).toEqual(course(await host.internalAPI.read(id)).project)
  return reopened
}

async function offlinePlayer(browser: Browser, project: ReturnType<typeof createBlankCourseProjectV10>, directory: string) {
  const published = await buildPublishedCourseV3({ project, assetBytes: {}, componentFiles: {} })
  const bundled = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: root }, bundle: true, platform: 'browser',
    format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const html = buildComponentSingleHtml(published.payload, bundled.outputFiles[0]!.text)
  await fs.writeFile(join(directory, 'offline.html'), html)
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, offline: true })
  await page.route('http://localhost/unified-player', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto('http://localhost/unified-player'); await page.evaluate(() => (window as any).coursePlayerReady)
  return page
}

for (const kind of ['slide', 'spatial'] as const) {
  test(`${kind}: object selection, body drag, edit completion and one-step history use one target`, async ({ browser }, info) => {
    test.setTimeout(90_000)
    const directory = info.outputPath(kind); await fs.mkdir(directory, { recursive: true })
    const project = createBlankCourseProjectV10(`Unified ${kind}`), surfaceId = project.rootIds[0]!
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('Select, move, then edit.')), frame: frame(150, 160) }
    project.instances.locked = { id: 'locked', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('Locked remains selected.')), frame: frame(650, 160), locked: true }
    const surface: ComponentSurface = { id: surfaceId, title: kind, kind, childIds: ['body', 'locked'], designSize: { width: 1280, height: 720 },
      ...(kind === 'spatial' ? { spatial: { home: { x: 640, y: 360, zoom: 1 }, frames: [] } } : {}) }
    setRootContainers(project, [surface])
    const host = new DocumentHostService(join(directory, 'recovery')), events: DocumentEvent[] = [], errors: string[] = []
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, `${kind}.glx`)
    const off = host.subscribeEvents(event => events.push(event)), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.on('pageerror', error => errors.push(error.message))
    const body = '[data-component-instance="body"]'
    try {
      await mountEditor(page, host, initial.documentId, events, await editorBundle(directory))
      await expect(page.locator(body)).toBeVisible()
      await clickBody(page, body)
      await expect.poll(() => selectionState(page)).toMatchObject({ ids: ['body'], editing: false })
      await expect(page.locator('[data-selection-quick-bar]')).toHaveCount(1)
      await expect(page.getByTestId('slide-layer-selection-overlay')).toHaveCount(1)
      const before = await host.internalAPI.read(initial.documentId), originalFrame = course(before).project.instances.body!.frame
      await dragBody(page, body)
      await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).revision).toBe(before.revision + 1)
      const moved = course(await host.internalAPI.read(initial.documentId)).project.instances.body!.frame
      expect(moved).not.toEqual(originalFrame)
      expect((await selectionState(page)).editing).toBe(false)
      await page.evaluate(async id => { await (window as any).SelectionEditor.useEditorStore.getState().courseBridge.undo(id) }, initial.documentId)
      expect(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.frame).toEqual(originalFrame)
      await page.evaluate(async id => { await (window as any).SelectionEditor.useEditorStore.getState().courseBridge.redo(id) }, initial.documentId)
      expect(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.frame).toEqual(moved)
      await clickBody(page, body, true, 45, 20)
      await expect.poll(() => selectionState(page)).toMatchObject({ ids: ['body'], editing: true })
      await expect(page.locator('[data-selection-quick-bar]')).toHaveCount(1)
      await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Edited.'); await page.keyboard.press('Escape')
      await expect.poll(() => selectionState(page)).toMatchObject({ ids: ['body'], editing: false })
      await expect.poll(async () => JSON.stringify(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.data)).toContain('Edited.')
      await dragBody(page, body, 26, 20)
      await expect.poll(async () => course(await host.internalAPI.read(initial.documentId)).project.instances.body!.frame).not.toEqual(moved)
      await page.screenshot({ path: join(directory, 'selected-after-edit.png') })
      await clickBody(page, '[data-component-instance="locked"]')
      await expect.poll(() => selectionState(page)).toMatchObject({ ids: ['locked'], editing: false })
      await expect(page.getByTestId('slide-layer-selection-overlay')).toHaveCount(1)
      await expect(page.getByTestId('slide-layer-selection-overlay').locator('[data-handle]')).toHaveCount(0)
      await page.screenshot({ path: join(directory, 'locked-solid-selection.png') })
      await saveAndColdOpen(host, initial.documentId, directory)
      expect(await page.evaluate(() => (window as any).selectionHarness.errors)).toEqual([])
      expect(errors).toEqual([])
      await fs.writeFile(join(directory, 'facts.json'), JSON.stringify({ kind, oneGestureOneRevision: true, undoRedo: true, oneToolbar: true,
        selectedAfterEscape: true, bodyDragAfterEditing: true, lockedSolidBorder: true, newProcessColdOpen: true, errors }, null, 2))
    } finally { off(); await page.evaluate(() => (window as any).selectionHarness?.dispose()); await page.close() }
  })
}

test('Slide selected native chrome hides its discovery badge and dashed target', async ({ browser }, info) => {
  const directory = info.outputPath('slide-chrome'); await fs.mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('Selected chrome'), surfaceId = project.rootIds[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('One selected frame.')), frame: frame(150, 160) }
  setRootContainers(project, [{ id: surfaceId, title: 'Slide', kind: 'slide', childIds: ['body'], designSize: { width: 1280, height: 720 } }])
  const host = new DocumentHostService(join(directory, 'recovery')), events: DocumentEvent[] = []
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'slide.glx')
  const off = host.subscribeEvents(event => events.push(event)), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await mountEditor(page, host, initial.documentId, events, await editorBundle(directory))
    await expect(page.locator('[data-component-instance="body"]')).toBeVisible()
    await clickBody(page, '[data-component-instance="body"]')
    await expect.poll(() => selectionState(page)).toMatchObject({ ids: ['body'], editing: false })
    await expect(page.getByTestId('slide-layer-selection-overlay')).toHaveCount(1)
    await expect(page.locator('[data-selection-quick-bar]')).toHaveCount(1)
    await expect(page.locator('.canvas-authoring-target')).toHaveCount(0)
    await page.screenshot({ path: join(directory, 'slide-one-selected-frame.png') })
    expect((await host.internalAPI.read(initial.documentId)).revision).toBe(initial.revision)
  } finally { off(); await page.evaluate(() => (window as any).selectionHarness?.dispose()); await page.close() }
})

test('Flow keeps one PM editor, body drag changes reading order, float moves and program business is reserved for Player', async ({ browser }, info) => {
  test.setTimeout(90_000)
  const directory = info.outputPath('flow'); await fs.mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('Unified Flow'), surfaceId = project.rootIds[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION; project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('First paragraph for selection and editing.')) }
  project.instances.next = { id: 'next', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('Second paragraph.')) }
  project.instances.floating = { id: 'floating', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('Floating text.')), frame: frame(580, 360, 220, 65), flowPlacement: { space: 'paper', plane: 'overlay' } }
  project.instances.program = { id: 'program', definitionId: HTML_PROGRAM_DEFINITION.id, frame: frame(0, 0, 860, 140), data: { html: '<!doctype html><body style="margin:0;padding:24px;background:#dff4ed;font:24px Arial"><button style="font:inherit" id="counter">Count 0</button><script>let n=0;document.querySelector("button").onclick=()=>document.querySelector("button").textContent="Count "+(++n)</script></body>' } }
  setRootContainers(project, [{ id: surfaceId, title: 'Flow', kind: 'flow', childIds: ['body', 'next', 'program', 'floating'], flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 } } }])
  const host = new DocumentHostService(join(directory, 'recovery')), events: DocumentEvent[] = [], errors: string[] = []
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.glx')
  const off = host.subscribeEvents(event => events.push(event)), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await mountEditor(page, host, initial.documentId, events, await editorBundle(directory))
    const paragraph = page.locator('[data-flow-block-id="body"]')
    await expect(paragraph).toBeVisible()
    await clickBody(page, '[data-flow-block-id="body"]', false, 50, 15)
    await expect(page.locator('.ProseMirror')).toHaveCount(1)
    await expect(page.locator('.ProseMirror')).toHaveAttribute('data-flow-input-active', 'false')
    await expect.poll(() => selectionState(page)).toMatchObject({ interaction: { kind: 'document', selection: { kind: 'object', blockId: 'body' } } })
    const first = await paragraph.boundingBox(), next = await page.locator('[data-flow-block-id="next"]').boundingBox()
    if (!first || !next) throw new Error('Missing Flow body geometry')
    const before = await host.internalAPI.read(initial.documentId)
    await page.mouse.move(first.x + 45, first.y + 15); await page.mouse.down()
    await page.mouse.move(next.x + 45, next.y + next.height - 2, { steps: 8 }); await page.mouse.up()
    await expect.poll(async () => course(await host.internalAPI.read(initial.documentId)).project.instances[surfaceId]!.childIds!.filter(id => id === 'body' || id === 'next')).toEqual(['next', 'body'])
    expect((await host.internalAPI.read(initial.documentId)).revision).toBe(before.revision + 1)
    expect(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.frame).toBeUndefined()
    await clickBody(page, '[data-flow-block-id="body"]', true, 50, 15)
    await expect(page.locator('.ProseMirror')).toHaveAttribute('data-flow-input-active', 'true')
    await expect(page.locator('[data-selection-quick-bar]')).toHaveCount(1)
    await page.keyboard.press('End'); await page.keyboard.insertText(' Edited Flow.'); await page.keyboard.press('Escape')
    await expect.poll(async () => JSON.stringify(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.data)).toContain('Edited Flow.')
    await expect(page.locator('.ProseMirror')).toHaveCount(1)
    await expect(page.locator('.ProseMirror')).toHaveAttribute('data-flow-input-active', 'false')
    await expect.poll(() => selectionState(page)).toMatchObject({ interaction: { kind: 'document', selection: { kind: 'object', blockId: 'body' } } })
    const floating = '[data-component-instance="floating"]'
    await expect(page.locator(floating)).toBeVisible()
    const floatingFrame = course(await host.internalAPI.read(initial.documentId)).project.instances.floating!.frame
    await dragBody(page, floating, -25, 35)
    await expect.poll(async () => course(await host.internalAPI.read(initial.documentId)).project.instances.floating!.frame).not.toEqual(floatingFrame)
    const program = page.locator('[data-flow-block-id="program"] iframe').contentFrame()
    await program.getByRole('button', { name: 'Count 0', exact: true }).click()
    await expect(program.getByRole('button', { name: 'Count 0', exact: true })).toBeVisible()
    await page.screenshot({ path: join(directory, 'flow-selected.png') })
    await saveAndColdOpen(host, initial.documentId, directory)
    const output = await offlinePlayer(browser, course(await host.internalAPI.read(initial.documentId)).project, directory)
    try {
      const runtime = output.locator('[data-component-object="program"] iframe').contentFrame()
      await runtime.getByRole('button', { name: 'Count 0', exact: true }).click()
      await expect(runtime.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible()
      await expect(output.locator('[data-component-object="body"]')).toContainText('Edited Flow.')
      await expect(output.locator('#course-diagnostic')).toBeHidden()
      await output.screenshot({ path: join(directory, 'offline-player.png') })
    } finally { await output.close() }
    expect(await page.evaluate(() => (window as any).selectionHarness.errors)).toEqual([])
    expect(errors).toEqual([])
    await fs.writeFile(join(directory, 'facts.json'), JSON.stringify({ onePMEditor: true, readingOrderDrag: true, bodyKeptFlowLayout: true,
      floatingBodyDrag: true, authorProgramInputSuppressed: true, playerOfflineBusinessWorks: true, oneToolbar: true, newProcessColdOpen: true, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure-before-dispose.png') })
    throw error
  } finally { off(); await page.evaluate(() => (window as any).selectionHarness?.dispose()); await page.close() }
})

test('HTML agent resolves real captured double clicks to the image and keeps selection, editing and drag intents separate', async ({ browser }, info) => {
  const directory = info.outputPath('html-agent'); await fs.mkdir(directory, { recursive: true })
  const bundle = await build({ stdin: { contents: 'export {mountHtmlPreviewAgent} from "./src/player/htmlPreview/htmlPreviewAgent"', resolveDir: root },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'HtmlAgent', write: false, logLevel: 'silent' })
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } }), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#176b58"/><circle cx="120" cy="70" r="40" fill="#ffd166"/></svg>')
  try {
    await page.setContent(`<body style="margin:40px;font:28px Arial"><p id="title" style="width:600px;margin:0 0 30px">Editable HTML title</p><img id="picture" alt="Editable picture" src="${svg}" width="240" height="140"><button id="business" style="display:block;margin-top:30px;font:24px Arial">Business 0</button><script>let n=0;document.querySelector('#business').onclick=()=>document.querySelector('#business').textContent='Business '+(++n)</script></body>`)
    await page.evaluate(bundle.outputFiles[0]!.text)
    await page.evaluate(() => {
      const state = window as any
      state.htmlMessages = []; state.htmlCaptured = []
      document.documentElement.addEventListener('gotpointercapture', event => state.htmlCaptured.push({ type: event.type, target: (event.target as Element).tagName }))
      const post = (message: object) => window.postMessage({ loadId: 'html-load', ...message }, '*')
      state.htmlPost = post
      state.htmlDispose = state.HtmlAgent.mountHtmlPreviewAgent(document)
      window.addEventListener('message', event => {
        if (!event.data?.event || event.data.leaseId !== 'html-lease') return
        const message = event.data; state.htmlMessages.push(message)
        if (message.event === 'edit-targets') post({ type: 'html-preview.confirm-targets', scanId: message.scanId, handles: message.targets.map((target: any) => target.handle) })
        if (message.event === 'targets' && message.targets.length && message.intent !== 'observe') {
          state.htmlSelected = message.targets[0]
          state.htmlEditing = message.intent === 'edit'
          post({ type: 'html-preview.selection', handle: state.htmlSelected.handle, editable: true, editing: state.htmlEditing })
        }
      })
      post({ type: 'html-preview.init', leaseId: 'html-lease' })
    })
    await expect.poll(() => page.evaluate(() => (window as any).htmlMessages.some((message: any) => message.event === 'ready'))).toBe(true)
    await page.evaluate(() => (window as any).htmlPost({ type: 'html-preview.edit-mode', enabled: true, requestId: 'author-mode' }))
    await expect.poll(() => page.evaluate(() => (window as any).htmlMessages.some((message: any) => message.event === 'edit-mode-ready' && message.enabled))).toBe(true)
    await page.locator('#title').click({ position: { x: 50, y: 15 } })
    await expect.poll(() => page.evaluate(() => ({ kind: (window as any).htmlSelected?.kind, edit: (window as any).htmlEditing }))).toEqual({ kind: 'text', edit: false })
    await page.locator('#title').dblclick({ position: { x: 50, y: 15 } })
    await expect.poll(() => page.evaluate(() => ({ kind: (window as any).htmlSelected?.kind, edit: (window as any).htmlEditing }))).toEqual({ kind: 'text', edit: true })
    const textHandle = await page.evaluate(() => (window as any).htmlSelected.handle)
    // This is the actual host finish signal. Pane's Escape/Session commit is covered by its focused integration test.
    await page.evaluate(handle => (window as any).htmlPost({ type: 'html-preview.selection', handle, editable: true, editing: false }), textHandle)
    await expect(page.locator('#title')).toHaveText('Editable HTML title')
    await page.screenshot({ path: join(directory, 'html-text-restored.png') })
    await page.locator('#picture').click({ position: { x: 80, y: 70 } })
    await expect.poll(() => page.evaluate(() => ({ kind: (window as any).htmlSelected?.kind, edit: (window as any).htmlEditing }))).toEqual({ kind: 'image', edit: false })
    await page.locator('#picture').dblclick({ position: { x: 80, y: 70 } })
    await expect.poll(() => page.evaluate(() => ({ kind: (window as any).htmlSelected?.kind, edit: (window as any).htmlEditing }))).toEqual({ kind: 'image', edit: true })
    expect(await page.evaluate(() => (window as any).htmlCaptured.some((capture: any) => capture.target === 'HTML'))).toBe(true)
    const imageHandle = await page.evaluate(() => (window as any).htmlSelected.handle)
    await page.evaluate(handle => { (window as any).htmlMessages = []; (window as any).htmlPost({ type: 'html-preview.selection', handle, editable: true, editing: false }) }, imageHandle)
    await dragBody(page, '#picture', 50, 30)
    await expect.poll(() => page.evaluate(() => {
      const phases = (window as any).htmlMessages.filter((message: any) => message.event === 'gesture').map((message: any) => message.phase)
      return { first: phases[0], last: phases.at(-1), moved: phases.includes('update') }
    })).toEqual({ first: 'start', last: 'end', moved: true })
    expect(await page.evaluate(handle => (window as any).htmlMessages.filter((message: any) => message.event === 'gesture').every((message: any) => message.handle === handle), imageHandle)).toBe(true)
    await page.screenshot({ path: join(directory, 'html-image-selection.png') })
    await page.locator('#business').click()
    await expect(page.locator('#business')).toHaveText('Business 0')
    expect(errors).toEqual([])
    await fs.writeFile(join(directory, 'facts.json'), JSON.stringify({ actualRootPointerCapture: true, textSingleSelectDoubleEdit: true,
      imageSingleSelectDoubleEdit: true, hostFinishRestoresText: true, exactImageDragLifecycle: true, authorBusinessSuppressed: true,
      paneEscapeAndSave: 'covered separately by focused Pane/Session tests', errors }, null, 2))
  } finally { await page.evaluate(() => (window as any).htmlDispose?.()); await page.close() }
})
