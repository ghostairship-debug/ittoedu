// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { createChartLayerItem, createChartNode, DEFAULT_INPUT_STYLE } from '../../src/core/tools/nativeNodeFactories'
import type { PublishedCompositionLayerItem } from '../../src/shared/publishedCourseTypes'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `export {mountWebComposition} from './src/player/composition/mountWebComposition';export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';export {capturePublishedSurfacePng} from './src/player/surfaces/publishedCapture'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CompositionTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30000)
afterAll(async () => { await browser?.close() })

type Content = PublishedCompositionLayerItem['content']
type CNode = Content['root']
const element = (id: string, tagName: string, children: CNode[], attributes: Record<string, string> = {}): CNode => ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): CNode => ({ id, kind: 'text', text: value })
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){let count=0;const button=document.createElement('button');button.textContent='count:0';button.dataset.counter='true';button.onclick=()=>{button.textContent='count:'+ ++count};ctx.dom.root.append(button);return {resize(w,h){button.dataset.width=String(w)},destroy(){button.remove()}}}})`
const encode = (source: string) => ({ encoding: 'base64-utf16le' as const, data: Buffer.from(source, 'utf16le').toString('base64') })
function fixture(): Content {
  return { assets: {}, doctype: '<!DOCTYPE html>', root: element('document', '#document', [
    element('html', 'html', [element('head', 'head', [element('style', 'style', [text('css', `html,body{margin:0;font:18px sans-serif}body{background:white}main{padding:20px;box-sizing:border-box}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.chart{height:240px}.interaction{height:60px}h1{color:rgb(220,0,0);font-size:32px;margin:0 0 20px}p{margin:0 0 12px}.vw{width:10vw;height:4px;background:#111}@media(max-width:500px){.columns{grid-template-columns:1fr}}`)])]),
      element('body', 'body', [element('main', 'main', [element('title', 'h1', [text('title-text', 'Composition capture')]), element('vw', 'div', [], { class: 'vw' }),
        element('columns', 'div', [element('left', 'section', [{ id: 'doc', kind: 'document', content: { blocks: [{ id: 'para', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Predict the motion before running the simulation.' }] } }] } },
          element('interaction', 'div', [{ id: 'runtime', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: encode(runtimeSource), content: { values: {} }, assets: {} } }], { class: 'interaction' })]),
          element('chart-wrap', 'section', [{ id: 'chart', kind: 'native', content: createChartLayerItem(createChartNode({ title: 'Measured values' })).content }], { class: 'chart' }),
        ], { class: 'columns' }),
      ])]),
    ]),
  ]) }
}

function findNode(node: CNode, id: string): CNode | undefined {
  return node.id === id ? node : node.kind === 'element' ? node.children.map(child => findNode(child, id)).find(Boolean) : undefined
}

async function open(mode: 'playback' | 'authoring' = 'playback', content = fixture(), components: Record<string, unknown> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  await page.setContent('<div id="host" style="width:800px;height:800px"></div>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(async ({ content, mode, components }) => {
    const api = (window as any).CompositionTest
    const session = api.createPublishedSurfaceRuntimeSession()
    const handle = api.mountWebComposition(document.getElementById('host'), { instanceId: 'lesson', content, components, width: 800, height: 800, mode, session, resolveAsset: () => undefined, onSelection: (value: unknown) => { (window as any).selection = value } })
    Object.assign(window, { handle, content, session })
    await handle.ready
  }, { content, mode, components })
  return page
}

it('uses the target viewport for media rules, lays out Native with the same document, and returns content selection', async () => {
  const page = await open('authoring')
  try {
    const first = await page.evaluate(() => { const h = (window as any).handle; return { left: h.measure('left'), chart: h.measure('chart-wrap'), vw: h.measure('vw') } })
    expect(first.chart.x).toBeGreaterThan(first.left.x + first.left.width)
    expect(first.vw.width).toBe(80)
    const frame = page.frameLocator('iframe[data-web-composition]')
    await frame.locator('h1').click()
    expect(await page.evaluate(() => (window as any).selection)).toMatchObject({ layerItemId: 'lesson', nodeId: 'title' })
    await page.evaluate(async () => { const w = window as any; w.handle.resize(400, 900); await w.handle.waitForReady() })
    const second = await page.evaluate(() => { const h = (window as any).handle; return { left: h.measure('left'), chart: h.measure('chart-wrap'), vw: h.measure('vw'), svg: h.element.contentDocument.querySelector('svg')?.getAttribute('width') } })
    expect(second.chart.y).toBeGreaterThan(second.left.y)
    expect(second.chart.x).toBe(second.left.x)
    expect(second.vw.width).toBe(40)
    expect(Number(second.svg)).toBe(360)
  } finally { await page.close() }
})

it('resizes an actual Phaser canvas and preserves the Runtime interaction and scene object', async () => {
  const content = fixture()
  const runtime = findNode(content.root, 'runtime')!
  if (runtime.kind !== 'runtime') throw new Error('fixture runtime missing')
  runtime.runtime = { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'hybrid', code: encode(`CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
    const object=ctx.phaser.scene.add.rectangle(10,10,16,16,0xff0000);let count=0;
    const button=document.createElement('button');button.dataset.phaserCounter='true';button.textContent='count:0';
    button.onclick=()=>{button.textContent='count:'+ ++count};ctx.dom.root.append(button);
    window.__compositionPhaserObject=object;
    return {resize(w,h){button.dataset.viewport=ctx.phaser.scene.scale.gameSize.width+'x'+ctx.phaser.scene.scale.gameSize.height},destroy(){button.remove();object.destroy()}}
  }})`), content: { values: {} }, assets: {} }
  const page = await open('playback', content)
  try {
    const result = await page.evaluate(async () => {
      const h = (window as any).handle; const dom = h.element.contentDocument
      const canvas = dom.querySelector('canvas'); const object = dom.defaultView.__compositionPhaserObject
      const query = (root: any, selector: string): any => root.querySelector(selector) ?? [...root.querySelectorAll('*')].map(node => node.shadowRoot && query(node.shadowRoot, selector)).find(Boolean)
      const button = query(dom, '[data-phaser-counter]'); button.click()
      h.resize(400, 900); await h.waitForReady()
      return { sameCanvas: canvas === dom.querySelector('canvas'), sameObject: !!object && object === dom.defaultView.__compositionPhaserObject,
        count: button.textContent, width: canvas.width, height: canvas.height, viewport: button.dataset.viewport }
    })
    expect(result).toEqual({ sameCanvas: true, sameObject: true, count: 'count:1', width: 360, height: 60, viewport: '360x60' })
  } finally { await page.close() }
})

it('runs a document component, retains its state during reflow, and localizes unavailable leaf bindings', async () => {
  const content = fixture()
  const doc = findNode(content.root, 'doc')!
  const left = findNode(content.root, 'left')!
  if (doc.kind !== 'document' || left.kind !== 'element') throw new Error('fixture document missing')
  doc.content.blocks.push(
    { id: 'counter', type: 'component', component: { packageId: 'composition-counter', version: '1.0.0' }, props: {}, staticFallbackAssetId: 'none' },
    { id: 'missing', type: 'component', component: { packageId: 'missing-package', version: '1.0.0' }, props: {}, staticFallbackAssetId: 'none' },
  )
  left.children.push(element('input-wrap', 'div', [{ id: 'answer', kind: 'native', content: { nativeType: 'input', data: { answerType: 'text', stateKey: 'answer', validityKey: 'valid', ruleFamilyRuleIds: [], style: DEFAULT_INPUT_STYLE } } }], { style: 'height:100px' }))
  const components = { 'composition-counter': {
    manifest: { schemaVersion: 4, runtimeApiVersion: 4, id: 'composition-counter', name: 'counter', version: '1.0.0', entry: 'runtime.js', defaultSize: { width: 200, height: 60 }, minSize: { width: 50, height: 40 }, preserveAspectRatio: false, supportedScopes: ['scene', 'global'], renderMode: 'dom', defaultProps: {}, assets: {} },
    runtimeSource: `CoursewareComponent.define({id:'composition-counter',runtimeApiVersion:4,create(ctx){let count=0;const button=document.createElement('button');button.dataset.componentCounter='true';button.textContent='component:0';button.onclick=()=>{button.textContent='component:'+ ++count};ctx.dom.root.append(button);return {resize(w,h){button.dataset.width=String(w)},destroy(){button.remove()}}}})`,
    files: {}, metadata: { packageId: 'composition-counter', version: '1.0.0', contentSha256: 'dummy', embeddedAt: '2026-10-03', sourceTrust: 'built-in' },
  } }
  const page = await open('playback', content, components)
  try {
    const result = await page.evaluate(async () => {
      const w = window as any, h = w.handle, dom = h.element.contentDocument
      const query = (root: any, selector: string): any => root.querySelector(selector) ?? [...root.querySelectorAll('*')].map(node => node.shadowRoot && query(node.shadowRoot, selector)).find(Boolean)
      const button = query(dom, '[data-component-counter]'); button.click()
      const input = dom.querySelector('input'); input.value = 'preserved answer'
      const next = structuredClone(w.content)
      const find = (node: any): any => node.id === 'doc' ? node : node.children?.map(find).find(Boolean)
      find(next.root).content.blocks[0].content.inlines[0].text += ' Longer updated document text. '.repeat(4)
      await h.update(next); h.resize(400, 900); await h.waitForReady()
      return { same: button === query(dom, '[data-component-counter]'), count: button.textContent,
        value: dom.querySelector('input').value, disabled: dom.querySelector('form button').disabled,
        title: dom.querySelector('h1').textContent, localErrors: dom.querySelectorAll('[data-composition-leaf-error]').length }
    })
    expect(result.same).toBe(true); expect(result.count).toBe('component:1')
    expect(result.value).toBe('preserved answer'); expect(result.disabled).toBe(true)
    expect(result.title).toBe('Composition capture'); expect(result.localErrors).toBeGreaterThanOrEqual(2)
  } finally { await page.close() }
})

it('reflows a longer document and preserves the same Runtime instance through content updates and resize', async () => {
  const page = await open()
  try {
    await page.frameLocator('iframe[data-web-composition]').locator('[data-counter]').click()
    const result = await page.evaluate(async () => {
      const w = window as any; const h = w.handle
      const original = h.element.contentDocument.querySelector('[data-counter]')
      const before = h.measure('interaction').y
      const next = structuredClone(w.content)
      const find = (node: any, id: string): any => node.id === id ? node : node.children?.map((n: any) => find(n, id)).find(Boolean)
      find(next.root, 'doc').content.blocks[0].content.inlines[0].text = 'A longer observation prompt that must reflow without any manual coordinates. '.repeat(14)
      await h.update(next)
      const after = h.measure('interaction').y
      h.resize(400, 1000); await h.waitForReady()
      const current = h.element.contentDocument.querySelector('[data-counter]')
      const same = original === current
      const count = current.textContent
      h.destroy(); w.session.destroy()
      return { before, after, same, count, removed: !document.querySelector('iframe') }
    })
    expect(result.after).toBeGreaterThan(result.before)
    expect(result.same).toBe(true)
    expect(result.count).toBe('count:1')
    expect(result.removed).toBe(true)
  } finally { await page.close() }
})

it('captures real iframe text and Native chart pixels at logical size under outer observation scaling', async () => {
  const page = await open()
  try {
    const pixels = await page.evaluate(async () => {
      const w = window as any; const host = document.getElementById('host')!
      host.style.transform = 'scale(.75)'; host.style.transformOrigin = '0 0'
      await w.handle.waitForReady()
      const png = await w.CompositionTest.capturePublishedSurfacePng({ root: host, width: 800, height: 800,
        layers: [{ element: host, x: 0, y: 0, width: 800, height: 800, rotation: 0, opacity: 1 }] })
      const image = new Image(); image.src = png; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, image.width, image.height).data
      let red = 0, blue = 0, blueX = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! > 160 && data[i + 1]! < 80 && data[i + 2]! < 80) red++
        if (data[i]! < 80 && data[i + 1]! > 60 && data[i + 1]! < 170 && data[i + 2]! > 180) { blue++; blueX += (i / 4) % image.width }
      }
      return { width: image.width, height: image.height, red, blue, blueX: blueX / blue }
    })
    expect(pixels.width).toBe(800); expect(pixels.height).toBe(800)
    expect(pixels.red).toBeGreaterThan(150)
    expect(pixels.blue).toBeGreaterThan(1000)
    expect(pixels.blueX).toBeGreaterThan(420)
  } finally { await page.close() }
})
