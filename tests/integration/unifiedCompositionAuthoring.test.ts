// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({
    stdin: { contents: `
      export {createElement} from 'react';
      export {createRoot} from 'react-dom/client';
      export {flushSync} from 'react-dom';
      export {WebCompositionAuthoringContent} from './src/renderer/composition/WebCompositionAuthoringContent';
      export {SpatialLocationWorkspace} from './src/renderer/ui/workspaces/SpatialLocationWorkspace';
      export {FlowOverlayAuthoringLayer} from './src/renderer/ui/flow/FlowOverlayAuthoringLayer';
      export {buildSpatialEditorView,spatialEditorStableTargets,captureSpatialEditorAuthoringTarget} from './src/renderer/course/spatialEditorView';
      export {buildFlowEditorView} from './src/renderer/course/flowEditorView';
      export {buildCourseAuthoringSessionForProject} from './src/renderer/authoring/courseAuthoringSession';
      export {publishLayerItem} from './src/renderer/export/course/buildPublishedCourse';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', globalName: 'Authoring', platform: 'browser',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })

function item(id: string): CompositionLayerItem {
  return {
    layerItemId: id, kind: 'composition', label: id, locked: false, order: 0, visible: true,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 10, y: 10, width: 320, height: 180 },
    content: { assets: {}, root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: { style: 'margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px' }, children: [
        { id: 'label', kind: 'element', tagName: 'p', attributes: {}, children: [{ id: 'text', kind: 'text', text: 'Visible composition' }] },
        { id: 'runtime', kind: 'runtime', runtime: {
          protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom', enabled: true,
          source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
            var probe=window.__authorProbe={creates:1,destroys:0};
            var label=document.createElement('span');label.textContent='Live Runtime';ctx.dom.root.appendChild(label);
            return {destroy(){probe.destroys++}};
          }});`, content: { values: {} }, assets: {},
        } },
      ] },
    ] } },
  }
}

function project(): CourseProjectDocument {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = item('flow-content'); flow.paperSpace = 'paper'
  project.surfaces = [
    { id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 700, wideContentWidth: 900 },
      blocks: [{ id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Continuous body' }] } }],
      surfaceLayerItems: [{ item: flow, visibility: { mode: 'all', locationIds: [] } }] },
    { id: 'spatial', type: 'spatial-2d', title: 'World', surfaceLayerItems: [],
      world: { bounds: { mode: 'infinite' }, layerItems: [item('world-content')], paths: [], relations: [] },
      camera: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'home', name: 'Home', x: 0, y: 0, zoom: 1 }] }, semanticZoom: [] },
  ]
  project.locations = [
    { id: 'flow-start', kind: 'flow-block', label: 'Flow', surfaceId: 'flow', blockId: 'p' },
    { id: 'spatial-home', kind: 'spatial-camera', label: 'World', surfaceId: 'spatial', cameraFrameId: 'home' },
  ]
  project.startLocationId = 'flow-start'
  return project
}

it('keeps authoring DOM and runtime instances when content and frame change, and reports real node selection', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="host"></div>')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async ({ project, item }) => {
      const api = (window as any).Authoring
      const host = document.getElementById('host')!
      const root = api.createRoot(host)
      const published = api.publishLayerItem({ project, assetFiles: {}, components: {} }, item)
      const selections: any[] = []
      const props = { layerItemId: item.layerItemId, content: published.content, width: 320, height: 180, assetUrls: {}, onSelection: (selection: any) => selections.push(selection) }
      const render = () => api.flushSync(() => root.render(api.createElement(api.WebCompositionAuthoringContent, props)))
      render(); await api.waitForPublishedObservationReady(host)
      const iframe = host.querySelector<HTMLIFrameElement>('iframe')!
      const probe = (iframe.contentWindow as any).__authorProbe
      const label = iframe.contentDocument!.querySelector('[data-composition-node="label"]')!
      label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
      props.width = 480; props.height = 220
      props.content = structuredClone(props.content)
      props.content.root.children[1].children[0].children[0].text = 'Edited composition'
      render(); await api.waitForPublishedObservationReady(host)
      const same = iframe === host.querySelector('iframe')
      const text = iframe.contentDocument!.body.textContent
      const width = iframe.contentDocument!.documentElement.clientWidth
      api.flushSync(() => root.unmount())
      return { same, text, width, selections, ...probe }
    }, { project: project(), item: item('standalone') })
    expect(result.same).toBe(true)
    expect(result.width).toBe(480)
    expect(result.text).toContain('Edited composition')
    expect(result.text).toContain('Live Runtime')
    expect(result.selections[0]).toMatchObject({ layerItemId: 'standalone', nodeId: 'label' })
    expect(result.selections[0].bounds.width).toBeGreaterThan(0)
    expect(result).toMatchObject({ creates: 1, destroys: 1 })
  } finally { await page.close() }
}, 20_000)

it('renders composition through actual Flow and Spatial authoring consumers and preserves their iframe on geometry updates', async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  try {
    await page.setContent('<style>.spatial-location-workspace,.spatial-viewport{width:800px;height:500px}.spatial-world-item{position:absolute;pointer-events:none}</style><div id="flow"></div><div id="spatial"></div>')
    await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async project => {
      const api = (window as any).Authoring
      const flowHost = document.getElementById('flow')!, spatialHost = document.getElementById('spatial')!
      const flowRoot = api.createRoot(flowHost), spatialRoot = api.createRoot(spatialHost)
      const sources = { project, assetFiles: {}, components: {} }
      const calls: string[] = []
      const render = () => {
        const view = api.buildSpatialEditorView({ project, locationId: 'spatial-home', sessionCamera: { x: 0, y: 0, zoom: 1 } })
        const session = api.buildCourseAuthoringSessionForProject(project, 'spatial-home')
        const worldTarget = api.captureSpatialEditorAuthoringTarget({ view, sessionToken: session.token, target: { kind: 'world', field: 'world' } })
        const layerTargets = new Map(view.layers.map((layer: any) => [layer.selectionId, api.captureSpatialEditorAuthoringTarget({ view, sessionToken: session.token, target: { kind: 'layer', layerItemId: layer.selectionId, field: 'frame' } })]))
        const flowView = api.buildFlowEditorView({ project, locationId: 'flow-start' })
        api.flushSync(() => {
          flowRoot.render(api.createElement(api.FlowOverlayAuthoringLayer, {
            view: flowView, locationId: 'flow-start', sessionToken: { surfaceType: 'flow', locationId: 'flow-start', revision: project.revision, generation: 1 },
            selection: null, assetUrls: {}, paperScrollTop: 0, paperWidth: 700, overlayViewportSize: { width: 800, height: 500 },
            commands: { run: () => ({ ok: true }) }, children: api.createElement('p', null, 'Continuous body'),
            publishCompositionContent: (item: any) => api.publishLayerItem(sources, item).content,
            onEditComposition: (id: string) => calls.push(id),
          }))
          spatialRoot.render(api.createElement(api.SpatialLocationWorkspace, {
            view, showCameraFrames: false, targets: api.spatialEditorStableTargets(view), selectionIds: [], graphSelection: null,
            canvasMode: 'edit', scope: 'world', contentEdit: null, assetFiles: sources.assetFiles, assetMimeTypes: {}, componentPackages: sources.components,
            project, runtimeContentAuthoring: { captureRuntimeContentTextTarget: () => null, updateRuntimeContentTextAtTarget: () => ({ ok: false }) },
            worldTarget, layerTargets, commands: { run: () => ({ ok: false }) }, onCanvasModeChange: () => {}, onMountTryRun: async () => { throw Error('not used') },
            onEditComposition: (id: string) => calls.push(id),
          }))
        })
      }
      render(); await api.waitForPublishedObservationReady(document.body)
      const flow = flowHost.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
      const spatial = spatialHost.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
      if (!flow || !spatial) throw new Error(`Missing authoring iframe: flow=${Boolean(flow)} spatial=${Boolean(spatial)}; ${flowHost.textContent}; ${spatialHost.textContent}`)
      const visible = [flow, spatial].map(frame => frame.contentDocument!.body.textContent)
      flowHost.querySelector('[data-layer-item-id="flow-content"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      const flowSurface = project.surfaces[0] as any, spatialSurface = project.surfaces[1] as any
      flowSurface.surfaceLayerItems[0].item.frame.width = 460
      spatialSurface.world.layerItems[0].frame.width = 420
      spatialSurface.world.layerItems[0].frame.x = 70
      render(); await api.waitForPublishedObservationReady(document.body)
      const same = [flow === flowHost.querySelector('iframe[data-web-composition]'), spatial === spatialHost.querySelector('iframe[data-web-composition]')]
      const widths = [flow, spatial].map(frame => frame.contentDocument!.documentElement.clientWidth)
      const left = spatialHost.querySelector<HTMLElement>('[data-layer-id="world-content"]')!.style.left
      const pointerEvents = getComputedStyle(spatial.parentElement!.parentElement!).pointerEvents
      api.flushSync(() => { flowRoot.unmount(); spatialRoot.unmount() })
      return { visible, same, widths, left, calls, pointerEvents }
    }, project())
    expect(result.visible).toEqual([expect.stringContaining('Visible composition'), expect.stringContaining('Visible composition')])
    expect(result.same).toEqual([true, true])
    expect(result.widths).toEqual([460, 420])
    expect(result.left).toBe('70px')
    expect(result.calls).toContain('flow-content')
    expect(result.pointerEvents).toBe('none')
  } finally { await page.close() }
}, 20_000)
