// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import type { PublishedCompositionLayerItem, PublishedFlowSurface } from '../../src/shared/publishedCourseTypes'
import type { FlowPublishedPlaybackDocument } from '../../src/player/surfaces/flow/flowModel'
import type { PublishedSpatialRuntimeInput } from '../../src/player/surfaces/spatial/spatialModel'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({
    stdin: { contents: `
      export {FlowSurfaceHost} from './src/player/surfaces/flow/FlowSurfaceHost';
      export {SpatialSurfaceHost} from './src/player/surfaces/spatial/SpatialSurfaceHost';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'CompositionSurfaces', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 20_000)
afterAll(async () => { await browser?.close() })

function composition(id: string): PublishedCompositionLayerItem {
  const source = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
    var probe = window.__compositionProbe = {creates:1,clicks:0,suspends:0,resumes:0,destroys:0};
    var button=document.createElement('button'); button.textContent='Observe';
    button.onclick=function(){button.textContent='Observed '+(++probe.clicks)};
    ctx.dom.root.appendChild(button);
    return {suspend(){probe.suspends++},resume(){probe.resumes++},destroy(){probe.destroys++;button.remove()}};
  }});`
  return {
    layerItemId: id, kind: 'composition', order: 0, visible: true, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 0, y: 0, width: 320, height: 180 },
    content: { assets: {}, doctype: 'html', root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [
        { id: 'style', kind: 'element', tagName: 'style', attributes: {}, children: [
          { id: 'css', kind: 'text', text: 'body{margin:0;font:18px sans-serif;background:#e0f2fe} main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px} [data-composition-node="runtime"]{height:100px} button{font:inherit}' },
        ] },
      ] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: {}, children: [
        { id: 'main', kind: 'element', tagName: 'main', attributes: {}, children: [
          { id: 'label', kind: 'element', tagName: 'p', attributes: {}, children: [{ id: 'text', kind: 'text', text: 'Shared composition' }] },
          { id: 'runtime', kind: 'runtime', runtime: {
            protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom', enabled: true,
            code: { encoding: 'base64-utf16le', data: Buffer.from(source, 'utf16le').toString('base64') },
            content: { values: {} }, assets: {},
          } },
        ] },
      ] },
    ] } },
  }
}

function flowSource(): FlowPublishedPlaybackDocument {
  const item = composition('flow-composition')
  item.paperSpace = 'paper'
  const surface: PublishedFlowSurface = {
    id: 'flow', type: 'flow', title: 'Continuous document', layout: { readingWidth: 700, wideContentWidth: 900 },
    blocks: [
      { id: 'start', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Original heading' }] } },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `paragraph-${i}`, type: 'paragraph' as const,
        content: { inlines: [{ type: 'text' as const, text: `Original paragraph ${i}` }] } })),
      { id: 'end', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Next section' }] } },
    ],
    surfaceLayerItems: [{ item, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: 'start', offsetY: 0, xRatio: 0 }, bodyPlane: 'overlay' }],
  }
  return {
    courseId: 'composition-flow', title: 'Flow fixture', assets: {}, surfaces: [surface], globalLayerItems: [],
    locations: [
      { id: 'flow-start', kind: 'flow-block', label: 'Start', surfaceId: 'flow', blockId: 'start' },
      { id: 'flow-end', kind: 'flow-block', label: 'End', surfaceId: 'flow', blockId: 'end' },
    ], startLocationId: 'flow-start',
  }
}

function spatialSource(): PublishedSpatialRuntimeInput {
  const world = composition('spatial-world')
  world.frame.x = -160; world.frame.y = -90
  const hud = composition('spatial-hud')
  hud.frame = { mode: 'absolute', x: 8, y: 8, width: 200, height: 120 }
  return {
    surface: { id: 'spatial', type: 'spatial-2d', title: 'World', surfaceLayerItems: [],
      world: { bounds: { mode: 'infinite' }, layerItems: [world], paths: [], relations: [] },
      camera: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'home', name: 'Home', x: 0, y: 0, zoom: 1 }] }, semanticZoom: [],
    },
    globalLayerItems: [{ item: hud, visibility: { mode: 'all', locationIds: [] } }],
    locations: [{ id: 'world-home', kind: 'spatial-camera', label: 'Home', surfaceId: 'spatial', cameraFrameId: 'home' }],
    startLocationId: 'world-home', playbackPathId: null,
  }
}

it('mounts the shared composition in a scrolling Flow document and preserves its runtime across anchor navigation', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } })
  try {
    await page.setContent('<div id="host" style="width:900px;height:500px"></div>')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async source => {
      const api = (window as any).CompositionSurfaces
      const host = new api.FlowSurfaceHost(source)
      const container = document.getElementById('host')!
      await host.mount(container); await host.activate()
      await api.waitForPublishedObservationReady(container)
      const iframe = container.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
      const inner = iframe.contentDocument!
      const probe = (iframe.contentWindow as any).__compositionProbe
      inner.querySelector('button')!.click()
      const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
      const overlay = container.querySelector<HTMLElement>('[data-flow-overlay-item="flow-composition"]')!
      const before = overlay.getBoundingClientRect().y
      article.scrollTop = 80
      article.dispatchEvent(new Event('scroll'))
      const after = overlay.getBoundingClientRect().y
      const scrolled = article.scrollTop
      const reserved = container.querySelector<HTMLElement>('[data-flow-runtime-spacer="start"]')!.offsetHeight
      const hasOriginal = article.textContent!.includes('Original paragraph 29')
      await host.setLocationId('flow-end')
      const sameAfterNavigation = iframe === container.querySelector('iframe[data-web-composition]')
      await host.suspend()
      const hidden = iframe.style.visibility
      await host.resume()
      const visible = iframe.style.visibility
      await host.destroy()
      return { before, after, scrolled, reserved, hasOriginal, sameAfterNavigation, hidden, visible, ...probe, removed: !iframe.isConnected }
    }, flowSource())
    expect(result.hasOriginal).toBe(true)
    expect(result.scrolled).toBeGreaterThan(0)
    expect(result.after).toBeLessThan(result.before)
    expect(result.reserved).toBeGreaterThanOrEqual(180)
    expect(result.sameAfterNavigation).toBe(true)
    expect(result).toMatchObject({ hidden: 'hidden', visible: 'visible', clicks: 1, creates: 1, destroys: 1, removed: true })
    expect(result.suspends).toBeGreaterThan(0)
    expect(result.resumes).toBeGreaterThan(0)
  } finally { await page.close() }
}, 20_000)

it('keeps Spatial composition in world/camera coordinates while the composition HUD stays on the viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  try {
    await page.setContent('<div id="host" style="width:800px;height:600px"></div>')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async source => {
      const api = (window as any).CompositionSurfaces
      const host = new api.SpatialSurfaceHost(source, { width: 800, height: 600 })
      const container = document.getElementById('host')!
      await host.mount(container); await host.activate()
      await api.waitForPublishedObservationReady(container)
      const world = container.querySelector<HTMLElement>('[data-layer-item-id="spatial-world"]')!
      const hud = container.querySelector<HTMLElement>('[data-layer-item-id="spatial-hud"]')!
      const iframe = world.querySelector<HTMLIFrameElement>('iframe')!
      const probe = (iframe.contentWindow as any).__compositionProbe
      iframe.contentDocument!.querySelector('button')!.click()
      const before = { world: world.getBoundingClientRect().x, hud: hud.getBoundingClientRect().x }
      await host.setRuntimeCamera({ x: 90, y: 20, zoom: 1.5, viewportWidth: 800, viewportHeight: 600 })
      const after = { world: world.getBoundingClientRect().x, hud: hud.getBoundingClientRect().x }
      const sameAfterCamera = iframe === world.querySelector('iframe')
      const owner = world.getAttribute('data-spatial-gesture-owner')
      const width = iframe.contentDocument!.documentElement.clientWidth
      await host.suspend(); await host.resume()
      await host.destroy()
      return { before, after, sameAfterCamera, owner, width, ...probe, removed: !iframe.isConnected }
    }, spatialSource())
    expect(result.before.world).not.toBe(result.after.world)
    expect(result.before.hud).toBe(result.after.hud)
    expect(result.sameAfterCamera).toBe(true)
    expect(result).toMatchObject({ owner: 'composition', width: 320, clicks: 1, creates: 1, destroys: 1, removed: true })
    expect(result.suspends).toBeGreaterThan(0)
    expect(result.resumes).toBeGreaterThan(0)
  } finally { await page.close() }
}, 20_000)
