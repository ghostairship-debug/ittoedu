// @vitest-environment node
import { build } from 'esbuild'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { nestedFlowSizingFixture } from '../helpers/nestedFlowSizingFixture'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

async function load(page: Page, source: string) {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: source }, bundle: true, write: false,
    outfile: 'probe.js', format: 'iife', platform: 'browser', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  await page.route('http://localhost/p4-sizing', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0}#root{width:960px;height:680px;display:flex;position:relative}</style><main id="root"></main>' }))
  await page.goto('http://localhost/p4-sizing')
  for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
}
async function geometry(page: Page, compiled = false) {
  return page.evaluate(compiled => {
    const child = document.querySelector<HTMLElement>(compiled ? '[data-compiled-node="child"]' : '[data-component-object="child"], [data-component-flow-id="child"]')!
    const after = document.querySelector<HTMLElement>(compiled ? '[data-compiled-node="after"]' : '[data-component-object="after"], [data-flow-block-id="after"]')!
    const scroll = child.querySelector<HTMLElement>('[data-flow-paper-scroll]')!, box = child.getBoundingClientRect()
    return { width: box.width, height: box.height, bottom: box.bottom, afterTop: after.getBoundingClientRect().top,
      overflow: getComputedStyle(scroll).overflowY, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight }
  }, compiled)
}

it('uses actual child Flow height in the editor and retains input, camera and local projection when changing its outer size', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await load(page, `
      import { mountCurrentCourseBrowserHarness } from './tests/helpers/currentFlowBrowserHarness'
      import { nestedFlowSizingFixture } from './tests/helpers/nestedFlowSizingFixture'
      import { createV10StoreHost } from './tests/helpers/courseV10StoreHost'
      import { useEditorStore } from './src/renderer/store/editorStore'
      import './src/renderer/styles/variables.css'
      import './src/renderer/styles/globals.css'
      async function main() {
        const transport = await createV10StoreHost(nestedFlowSizingFixture(), undefined, false)
        const mounted = await mountCurrentCourseBrowserHarness(document.getElementById('root'), transport.api)
        window.probe = { mounted, transport, store: () => useEditorStore.getState(),
          layout: async (widthMode,readingWidth) => { const state=useEditorStore.getState(), current=state.courseBridge.captureTarget().project.instances.root.container.flow.layout; await state.editComponents([{type:'container.patch',instanceId:'root',patch:{flow:{layout:{...current,widthMode,readingWidth}}}}]); await state.courseBridge.drain() },
          size: async height => { await useEditorStore.getState().editComponents([{ type:'style.set',instanceId:'child',path:['height'],value:height }]); await useEditorStore.getState().courseBridge.drain() } }
      }
      main().catch(error => window.failure = String(error.stack || error))`)
    await page.waitForFunction(() => (window as any).probe || (window as any).failure)
    expect(await page.evaluate(() => (window as any).failure)).toBeUndefined()
    await page.waitForFunction(() => document.querySelector('[data-component-container-preview="child"] input'), undefined, { timeout: 5_000 }).catch(async error => {
      await mkdir('output/p4-runtime-20261023', { recursive: true }); await writeFile('output/p4-runtime-20261023/editor-diagnostic.json', JSON.stringify(await page.evaluate(() => ({ html: document.body.innerHTML, reports: (window as any).probe.mounted.errors })), null, 2)); throw error
    })
    const wide = await geometry(page)
    expect(wide.height).toBeGreaterThan(400)
    expect(wide.afterTop).toBeGreaterThanOrEqual(wide.bottom)
    await page.evaluate(() => { document.getElementById('root')!.style.width = '520px' })
    await expect.poll(async () => (await geometry(page)).height).toBeGreaterThan(wide.height)
    const narrow = await geometry(page)
    expect(narrow.overflow).toBe('visible')
    expect(narrow.afterTop).toBeGreaterThanOrEqual(narrow.bottom)
    await page.evaluate(async () => {
      const probe = (window as any).probe, runtime = probe.mounted.runtime
      probe.preview = document.querySelector('[data-component-container-preview="child"]')
      probe.input = probe.preview.querySelector('input'); probe.input.value = '持续运行中的输入'
      runtime.setPlaying(true)
      probe.cameraAccepted = await runtime.navigation.forContainer('space').execute({ type:'camera.present',pose:{x:120,y:80,zoom:1.6} }); probe.cameraBefore = runtime.navigation.read('space').camera
      runtime.navigation.forContainer('child').setZoom(1.1)
      await probe.size(180)
    })
    await expect.poll(async () => (await geometry(page)).height).toBe(180)
    const fixed = await geometry(page)
    expect(fixed.overflow).toBe('auto'); expect(fixed.scrollHeight).toBeGreaterThan(fixed.clientHeight)
    await page.evaluate(() => (window as any).probe.size(null))
    await expect.poll(async () => (await geometry(page)).height).toBeGreaterThan(400)
    const retained = await page.evaluate(() => { const probe = (window as any).probe, runtime = probe.mounted.runtime; return {
      sameProjection: probe.preview === document.querySelector('[data-component-container-preview="child"]'), sameInput: probe.input === probe.preview.querySelector('input'),
      input: probe.input.value, cameraAccepted: probe.cameraAccepted, cameraBefore: probe.cameraBefore, camera: runtime.navigation.read('space').camera, zoom: runtime.navigation.read('child').zoom,
      entry: runtime.project.entry, reports: probe.mounted.errors } })
    expect(retained).toMatchObject({ sameProjection: true, sameInput: true, cameraAccepted: true, input: '持续运行中的输入', zoom: 1.1, entry: { rootInstanceId: 'root' }, reports: [] })
    expect(retained.cameraBefore.zoom).toBeGreaterThan(1)
    expect(retained.camera).toEqual(retained.cameraBefore)
    await page.evaluate(async () => { const probe=(window as any).probe; document.getElementById('root')!.style.width='1100px'; await probe.store().editComponents([{type:'instance.flowLayout.set',instanceId:'child',flowLayout:{width:'content-width'}}]); await probe.layout('reading',500) })
    await expect.poll(async () => (await geometry(page)).width).toBeLessThan(400)
    const reading500=await geometry(page)
    expect(reading500.width).toBeGreaterThan(300)
    await page.evaluate(() => (window as any).probe.layout('reading',700))
    await expect.poll(async () => (await geometry(page)).width).toBeGreaterThan(reading500.width)
    const reading700=await geometry(page)
    await page.evaluate(() => (window as any).probe.layout('fluid',700))
    await expect.poll(async () => (await geometry(page)).width).toBeGreaterThan(reading700.width)
    const fluid=await geometry(page)
    expect(await page.evaluate(() => {const probe=(window as any).probe;return probe.preview===document.querySelector('[data-component-container-preview="child"]') && probe.input===probe.preview.querySelector('input')})).toBe(true)
    expect(errors).toEqual([])
    await mkdir('output/p4-runtime-20261023', { recursive: true })
    await writeFile('output/p4-runtime-20261023/editor-geometry.json', JSON.stringify({ wide, narrow, fixed, retained, parentLayouts:{reading500,reading700,fluid} }, null, 2))
    await page.screenshot({ path: 'output/p4-runtime-20261023/editor-natural-height.png', fullPage: true })
    await page.evaluate(() => (window as any).probe.mounted.dispose())
  } finally { await browser.close() }
}, 30_000)

it.each(['published', 'compiled'] as const)('sizes a natural and explicit fixed child Flow in the real %s consumer', async mode => {
  const project = nestedFlowSizingFixture(), result = await buildPublishedCourseV4({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const dom = new JSDOM('<!doctype html>')
  const payload = mode === 'published' ? result.payload : await compileCoursePlayback(result.payload, { document: dom.window.document,
    renderBuiltin: async instance => instance.container ? '' : `<p>${(instance.data as any).content?.inlines?.map((inline: any) => inline.text ?? '').join('') ?? '内容区域'}</p>` })
  dom.window.close()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await load(page, `import {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer'; import {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'; window.mount={published:mountPublishedCourseV4,compiled:mountCompiledCourse}`)
    await page.evaluate(async ({serialized,mode}) => { (window as any).player = await (window as any).mount[mode](JSON.parse(serialized), document.getElementById('root'), {capture:true,keyboardNavigation:false}) }, { serialized: JSON.stringify(payload), mode })
    const natural = await geometry(page, mode === 'compiled')
    expect(natural.height).toBeGreaterThan(400); expect(natural.afterTop).toBeGreaterThanOrEqual(natural.bottom)
    expect(natural.overflow).toBe('visible')
    await page.evaluate(() => { document.getElementById('root')!.style.width = '520px' })
    await expect.poll(async () => (await geometry(page, mode === 'compiled')).height).toBeGreaterThan(natural.height)
    await mkdir('output/p4-runtime-20261023', { recursive: true })
    await page.screenshot({ path: `output/p4-runtime-20261023/${mode}-natural-height.png`, fullPage: true })
    await page.evaluate(() => (window as any).player.dispose())
    project.instances.child!.style = { height: 180 }
    const fixedResult = await buildPublishedCourseV4({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    const fixedDom = new JSDOM('<!doctype html>'), fixed = mode === 'published' ? fixedResult.payload : await compileCoursePlayback(fixedResult.payload, {document:fixedDom.window.document, renderBuiltin: async instance => instance.container ? '' : `<p>${(instance.data as any).content?.inlines?.map((inline: any) => inline.text ?? '').join('') ?? '内容区域'}</p>`})
    fixedDom.window.close()
    await page.evaluate(async ({serialized,mode}) => { (window as any).player = await (window as any).mount[mode](JSON.parse(serialized), document.getElementById('root'), {capture:true,keyboardNavigation:false}) }, {serialized:JSON.stringify(fixed),mode})
    const actual = await geometry(page, mode === 'compiled')
    expect(actual.height).toBe(180); expect(actual.overflow).toBe('auto'); expect(actual.scrollHeight).toBeGreaterThan(actual.clientHeight)
    await writeFile(`output/p4-runtime-20261023/${mode}-geometry.json`, JSON.stringify({ natural, fixed: actual }, null, 2))
    await page.evaluate(() => (window as any).player.dispose())
  } finally { await browser.close() }
}, 30_000)
