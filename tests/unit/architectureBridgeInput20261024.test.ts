// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('keeps real Flow input on B while A commits late, then undoes, saves and opens B in a new session', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { mountCurrentCourseBrowserHarness } from './tests/helpers/currentFlowBrowserHarness'
    import { useEditorStore } from './src/renderer/store/editorStore'
    import { createV10StoreHost } from './tests/helpers/courseV10StoreHost'
    import { createCourseProjectContent } from './src/renderer/store/slices/courseLifecycleSlice'
    import { TEXT_DEFINITION } from './src/components/text/adapters'
    import { createTextComponentData } from './src/components/text/data'
    import './src/renderer/styles/variables.css'
    import './src/renderer/styles/globals.css'
    function model(label) {
      const { project, resources } = createCourseProjectContent('flow')
      project.global = { underlay: [], overlay: [] }
      project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
      project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData(label) }
      project.instances[project.rootIds[0]].childIds = ['body']
      return { kind: 'course-v10', project, resources }
    }
    async function main() {
      const a = model('Document A'), h = await createV10StoreHost(a.project, a.resources, false)
      const b = await h.api.create(model('Document B'), 'B.glx')
      const host = document.createElement('main'); host.style.cssText = 'width:960px;height:680px;display:flex;position:relative'; document.body.append(host)
      const mounted = await mountCurrentCourseBrowserHarness(host, h.api, true)
      const bridge = () => useEditorStore.getState().courseBridge
      let release, held = false
      h.controls.before = async operation => {
        if (operation.documentId === h.first.documentId && !held) { held = true; await new Promise(resolve => release = resolve) }
      }
      window.bridgeProbe = { errors: mounted.errors, held: () => held,
        read: () => bridge().read(), a: () => h.api.read(h.first.documentId),
        switchB: () => bridge().activate(b.documentId), release: () => release(),
        undo: () => bridge().undo(b.documentId), redo: () => bridge().redo(b.documentId),
        async saveClose() { await bridge().drain([b.documentId]); await h.api.save(b.documentId, 'B.glx'); return bridge().close(b.documentId) },
        reopen: () => bridge().open('B.glx'), dispose: () => mounted.dispose() }
    }
    main().catch(error => window.failure = String(error.stack || error))
  ` }, bundle: true, write: false, outfile: 'bridge-input.js', format: 'iife', platform: 'browser',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost/bridge-input', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
    await page.goto('http://localhost/bridge-input')
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.waitForFunction(() => (window as any).bridgeProbe || (window as any).failure)
    expect(await page.evaluate(() => (window as any).failure)).toBeUndefined()
    const type = async (suffix: string) => {
      await page.locator('[data-flow-block-id="body"]').dblclick({ position: { x: 50, y: 15 } })
      await expect.poll(() => page.locator('.ProseMirror').evaluate(element =>
        element.contains(document.activeElement) && (element as HTMLElement).isContentEditable)).toBe(true)
      await page.keyboard.press('End'); await page.keyboard.insertText(suffix)
    }
    await type(' A pending')
    await page.waitForFunction(() => (window as any).bridgeProbe.held())
    await page.evaluate(() => (window as any).bridgeProbe.switchB())
    await expect.poll(() => page.locator('[data-flow-block-id="body"]').textContent()).toContain('Document B')
    await type(' B continued')
    await expect.poll(async () => JSON.stringify(await page.evaluate(() => (window as any).bridgeProbe.read().project))).toContain('B continued')
    const activeB = await page.evaluate(() => (window as any).bridgeProbe.read().activeDocumentId)
    await page.evaluate(() => (window as any).bridgeProbe.release())
    await expect.poll(async () => JSON.stringify(await page.evaluate(() => (window as any).bridgeProbe.a()))).toContain('A pending')
    expect(await page.evaluate(() => (window as any).bridgeProbe.read().activeDocumentId)).toBe(activeB)
    await page.keyboard.press('End'); await page.keyboard.insertText(' after ACK'); await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('[data-flow-block-id="body"]').textContent()).toContain('B continued after ACK')
    await page.evaluate(() => (window as any).bridgeProbe.undo())
    await expect.poll(() => page.locator('[data-flow-block-id="body"]').textContent()).not.toContain('B continued after ACK')
    await page.evaluate(() => (window as any).bridgeProbe.redo())
    await expect.poll(() => page.locator('[data-flow-block-id="body"]').textContent()).toContain('B continued after ACK')
    await mkdir('output/architecture-second-round-20261024', { recursive: true })
    await page.screenshot({ path: 'output/architecture-second-round-20261024/bridge-input.png' })
    expect(await page.evaluate(() => (window as any).bridgeProbe.saveClose())).toBe(true)
    await page.evaluate(() => (window as any).bridgeProbe.reopen())
    expect(await page.evaluate(() => (window as any).bridgeProbe.read().activeDocumentId)).not.toBe(activeB)
    await expect.poll(() => page.locator('[data-flow-block-id="body"]').textContent()).toContain('B continued after ACK')
    expect(await page.evaluate(() => (window as any).bridgeProbe.errors)).toEqual([])
    expect(errors).toEqual([])
    await writeFile('output/architecture-second-round-20261024/bridge-browser.json', JSON.stringify({ browser: browser.version(),
      actualFlowInput: true, lateAckStayedOnB: true, continuedEditing: true, undoRedo: true, savedNewSession: true, errors }, null, 2))
    await page.evaluate(() => (window as any).bridgeProbe.dispose())
  } finally { await browser.close() }
}, 30_000)
