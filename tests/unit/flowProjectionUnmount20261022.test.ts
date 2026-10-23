// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.each([false, true])('parks a live component realm before the actual Flow portal closes and reopens (StrictMode=%s)', async strictMode => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { mountCurrentCourseBrowserHarness } from './tests/helpers/currentFlowBrowserHarness'
    import { createV10StoreHost } from './tests/helpers/courseV10StoreHost'
    import { createCourseProjectContent } from './src/renderer/store/slices/courseLifecycleSlice'
    import { componentSurfaces } from './src/shared/contracts/component-platform/project'
    import { createChartData } from './src/components/chart/data'
    import { useEditorStore } from './src/renderer/store/editorStore'
    import './src/renderer/styles/variables.css'
    import './src/renderer/styles/globals.css'
    async function main() {
      const { project, resources } = createCourseProjectContent('flow'), surface = componentSurfaces(project)[0]
      project.global = { underlay: [], overlay: [] }
      project.definitions.chart = { id: 'chart', role: 'content', implementation: { kind: 'builtin', key: 'guoling.chart' } }
      project.instances.chart = { id: 'chart', definitionId: 'chart', data: JSON.parse(JSON.stringify(createChartData())),
        frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] } }
      project.instances[surface.id].childIds = ['chart']
      const transport = await createV10StoreHost(project, resources, false)
      const host = document.createElement('main'); host.style.cssText = 'width:960px;height:680px;display:flex;position:relative'; document.body.append(host)
      const mounted = await mountCurrentCourseBrowserHarness(host, transport.api, window.strictMode)
      const retained = [], move = Element.prototype.moveBefore
      Element.prototype.moveBefore = function(node, before) {
        const frame = node instanceof HTMLIFrameElement ? node : null
        const realm = frame?.contentWindow, marker = realm?.marker
        move.call(this, node, before)
        if (frame?.dataset.closeRealm) retained.push({ cycle: marker.cycle, connected: frame.isConnected,
          sameWindow: frame.contentWindow === realm, sameMarker: frame.contentWindow.marker === marker })
      }
      window.closeProbe = { retained, reports: mounted.errors,
        close: async () => { const bridge = useEditorStore.getState().courseBridge, id = bridge.read().activeDocumentId;
          await transport.api.save(id, 'closed-flow.glx'); return bridge.close(id) },
        reopen: () => useEditorStore.getState().courseBridge.open('closed-flow.glx'), dispose: () => mounted.dispose() }
    }
    main().catch(error => window.failure = String(error.stack || error))
  ` }, bundle: true, write: false, outfile: 'probe.js', format: 'iife', platform: 'browser',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost/flow-close', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
    await page.goto('http://localhost/flow-close')
    await page.evaluate(value => { (window as any).strictMode = value }, strictMode)
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.waitForFunction(() => (window as any).closeProbe || (window as any).failure)
    expect(await page.evaluate(() => (window as any).failure)).toBeUndefined()
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.locator('[data-component-runtime-root="chart"] svg').first().waitFor()
      await page.evaluate(async cycle => {
        const frame = document.createElement('iframe'); frame.dataset.closeRealm = 'true'
        const loaded = new Promise<void>(resolve => { frame.onload = () => resolve() })
        frame.srcdoc = '<input value="running input"><script>window.marker={cycle:' + cycle + '}<\/script>'
        document.querySelector('[data-component-runtime-root="chart"]')!.append(frame)
        await loaded
      }, cycle)
      expect(await page.evaluate(() => (window as any).closeProbe.close())).toBe(true)
      await page.waitForFunction(() => !document.querySelector('[data-component-runtime-root="chart"]'))
      expect(errors).toEqual([])
      expect(await page.locator('iframe').count()).toBe(0)
      if (!cycle) await page.evaluate(() => (window as any).closeProbe.reopen())
    }
    const observed = await page.evaluate(() => ({ retained: (window as any).closeProbe.retained, reports: (window as any).closeProbe.reports }))
    expect([...new Set(observed.retained.map((value: { cycle: number }) => value.cycle))]).toEqual([0, 1])
    for (const move of observed.retained) expect(move).toMatchObject({ connected: true, sameWindow: true, sameMarker: true })
    expect(observed.reports).toEqual([])
    await page.evaluate(() => (window as any).closeProbe.dispose())
  } finally { await browser.close() }
}, 20_000)
