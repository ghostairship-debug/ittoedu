// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('keeps a running document realm through Flow placement, history and editing, then cold-opens the saved author content', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { mountCurrentCourseBrowserHarness } from './tests/helpers/currentFlowBrowserHarness'
    import { useEditorStore } from './src/renderer/store/editorStore'
    import { createV10StoreHost } from './tests/helpers/courseV10StoreHost'
    import { createCourseProjectContent } from './src/renderer/store/slices/courseLifecycleSlice'
    import { componentSurfaces } from './src/shared/contracts/component-platform/project'
    import { HTML_PROGRAM_DEFINITION } from './src/components/web/data'
    import { TEXT_DEFINITION } from './src/components/text/adapters'
    import { createTextComponentData } from './src/components/text/data'
    import { flowPlacementEdits } from './src/core/course/courseFlowEdits'
    import './src/renderer/styles/variables.css'
    import './src/renderer/styles/globals.css'
    async function main() {
      const { project, resources } = createCourseProjectContent('flow'), surface = componentSurfaces(project)[0]
      project.global = { underlay: [], overlay: [] }
      project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
      project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
      project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('继续编辑正文。') }
      project.instances.program = { id: 'program', definitionId: HTML_PROGRAM_DEFINITION.id,
        frame: { width: 600, height: 180, transform: [1, 0, 0, 1, 0, 0] },
        data: { html: '<!doctype html><body style="margin:20px;background:#e0f1eb"><button id="counter">Count 0</button><script>window.keep={counter:0};document.querySelector("button").onclick=()=>document.querySelector("button").textContent="Count "+(++window.keep.counter)</script></body>' } }
      project.instances[surface.id].childIds = ['body', 'program']
      const transport = await createV10StoreHost(project, resources, false)
      const host = document.createElement('main'); host.style.cssText = 'width:960px;height:680px;display:flex;position:relative'; document.body.append(host)
      const mounted = await mountCurrentCourseBrowserHarness(host, transport.api, true)
      const bridge = () => useEditorStore.getState().courseBridge
      const id = () => bridge().read().activeDocumentId
      window.attachmentProbe = { reports: mounted.errors,
        async move(floating) { const target = bridge().captureTarget();
          await bridge().editCaptured(bridge().capture(flowPlacementEdits(target.project, 'program', floating
            ? { kind: 'overlay', surfaceId: surface.id, placement: { space: 'paper', plane: 'overlay' }, frame: { width: 600, height: 180, transform: [1, 0, 0, 1, 50, 220] } }
            : { kind: 'document', surfaceId: surface.id }), target)) },
        undo: () => bridge().undo(id()), redo: () => bridge().redo(id()),
        read: () => transport.api.read(id()),
        async saveClose() { await transport.api.save(id(), 'attachment.glx'); return bridge().close(id()) },
        reopen: () => bridge().open('attachment.glx'), dispose: () => mounted.dispose() }
    }
    main().catch(error => window.failure = String(error.stack || error))
  ` }, bundle: true, write: false, outfile: 'attachment.js', format: 'iife', platform: 'browser',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost/attachment', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
    await page.goto('http://localhost/attachment')
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.waitForFunction(() => (window as any).attachmentProbe || (window as any).failure)
    expect(await page.evaluate(() => (window as any).failure)).toBeUndefined()
    const iframe = page.locator('[data-component-runtime-root="program"] iframe')
    await iframe.waitFor()
    const handle = await iframe.elementHandle(), realm = await handle!.contentFrame()
    if (!realm) throw new Error('Missing program realm')
    await realm.waitForFunction(() => Boolean((window as any).keep))
    await realm.evaluate(() => { const current = (window as any); current.firstKeep = current.keep; current.keep.counter = 7; document.querySelector('button')!.textContent = 'Count 7' })
    const retained = async () => {
      expect(realm.isDetached()).toBe(false)
      expect(await realm.evaluate(() => (window as any).keep === (window as any).firstKeep && (window as any).keep.counter === 7)).toBe(true)
      expect(await realm.locator('button').textContent()).toBe('Count 7')
      expect(await page.locator('[data-component-runtime-root="program"]').count()).toBe(1)
    }
    await page.evaluate(() => (window as any).attachmentProbe.move(true))
    await expect.poll(() => page.locator('[data-flow-block-id="program"]').count()).toBe(0)
    await retained()
    await page.evaluate(() => (window as any).attachmentProbe.undo())
    await page.locator('[data-flow-block-id="program"]').waitFor(); await retained()
    await page.evaluate(() => (window as any).attachmentProbe.redo())
    await expect.poll(() => page.locator('[data-flow-block-id="program"]').count()).toBe(0); await retained()
    await page.evaluate(() => (window as any).attachmentProbe.move(false))
    await page.locator('[data-flow-block-id="program"]').waitFor(); await retained()
    await page.setViewportSize({ width: 900, height: 760 }); await retained()
    await page.locator('[data-flow-block-id="body"]').dblclick({ position: { x: 50, y: 15 } })
    await expect.poll(() => page.locator('.ProseMirror').evaluate(element =>
      element.contains(document.activeElement) && (element as HTMLElement).isContentEditable)).toBe(true)
    await page.keyboard.press('End'); await page.keyboard.insertText(' 迁移后续写。'); await page.keyboard.press('Escape')
    await expect.poll(async () => JSON.stringify(await page.evaluate(() => (window as any).attachmentProbe.read()))).toContain('迁移后续写')
    await retained()
    await mkdir('output/architecture-first-round-20261024', { recursive: true })
    await page.screenshot({ path: 'output/architecture-first-round-20261024/flow-retained.png' })
    expect(await page.evaluate(() => (window as any).attachmentProbe.saveClose())).toBe(true)
    await expect.poll(() => page.locator('[data-component-runtime-root="program"]').count()).toBe(0)
    await page.evaluate(() => (window as any).attachmentProbe.reopen())
    const reopened = page.locator('[data-component-runtime-root="program"] iframe').contentFrame()
    await expect.poll(() => reopened.locator('button').textContent()).toBe('Count 0')
    expect(JSON.stringify(await page.evaluate(() => (window as any).attachmentProbe.read()))).toContain('迁移后续写')
    expect(await page.evaluate(() => (window as any).attachmentProbe.reports)).toEqual([])
    expect(errors).toEqual([])
    await writeFile('output/architecture-first-round-20261024/flow-browser.json', JSON.stringify({ browser: browser.version(),
      bodyOverlayRoundTrip: true, undoRedo: true, realmStateRetained: true, viewportRetained: true, continuedEditing: true, savedReopen: true, errors }, null, 2))
    await page.evaluate(() => (window as any).attachmentProbe.dispose())
  } finally { await browser.close() }
}, 30_000)
