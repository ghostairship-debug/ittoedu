// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import type { CompositionContentEdit } from '../../src/shared/composition/edit'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel } from '../../src/shared/workbench/document'

it('F05 keeps actual Flow canvas dragging active through selection and pending rerenders with one canonical commit', async () => {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const layer: CompositionLayerItem = {
    kind: 'composition', layerItemId: 'flow-canvas', label: 'Flow composition', locked: false, order: 0, visible: true,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 20, y: 20, width: 700, height: 480 },
    content: { assets: {}, root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: { style: 'margin:0;height:480px;position:relative;background:white' }, children: [
        { id: 'free', kind: 'element', tagName: 'div', attributes: { style: 'position:absolute;left:80px;top:120px;width:220px;height:100px;background:#ffe5a5' },
          children: [{ id: 'text', kind: 'text', text: 'Drag content' }] },
        { id: 'counter-slot', kind: 'element', tagName: 'div', attributes: { style: 'position:absolute;left:80px;top:300px;width:200px;height:50px' }, children: [
          { id: 'counter', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
            content: { values: {} }, assets: {}, source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
              const probe=window.__flowCanvasProbe||(window.__flowCanvasProbe={creates:0,destroys:0});probe.creates++;
              const button=document.createElement('button');button.dataset.flowCounter='true';let count=0;button.textContent='count:0';
              button.onclick=()=>button.textContent='count:'+ ++count;ctx.dom.root.append(button);
              return {resize(){},destroy(){probe.destroys++;button.remove()}};
            }})` } },
        ] },
      ] },
    ] } },
  }
  project.surfaces = [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 700, wideContentWidth: 900 },
    blocks: [{ id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Document text' }] } }],
    surfaceLayerItems: [{ item: layer, visibility: { mode: 'all', locationIds: [] } }] }]
  project.locations = [{ id: 'flow-location', kind: 'flow-block', surfaceId: 'flow', blockId: 'paragraph', label: 'Flow' }]
  project.startLocationId = 'flow-location'
  const driver = new CourseV9Driver(), model: DocumentModel = { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
  const registry = new DocumentRegistry({ drivers: [driver], persistence: { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw Error('Expected file binding')
    return input.binding
  } }, createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(model, 'flow.h5lesson')
  const edits: CompositionContentEdit[] = []
  let releaseCommit!: () => void
  const commitReleased = new Promise<void>(resolve => { releaseCommit = resolve })
  const browser = await chromium.launch({ headless: true })
  try {
    const bundle = (await build({
      stdin: { contents: `export {createElement} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';
        export {FlowOverlayAuthoringLayer} from './src/renderer/ui/flow/FlowOverlayAuthoringLayer';
        export {buildFlowEditorView} from './src/renderer/course/flowEditorView';
        export {publishLayerItem} from './src/renderer/export/course/buildPublishedCourse';
        export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';`, resolveDir: process.cwd(), loader: 'tsx' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'FlowCanvas',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"test"' },
    })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    page.setDefaultTimeout(5000)
    try {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.exposeFunction('commitFlowCanvas', async (edit: CompositionContentEdit) => {
        edits.push(structuredClone(edit))
        await commitReleased
        const before = session.read()
        const result = await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human',
          baseRevision: before.revision, mutation: { type: 'command', command: { type: 'composition.edit', layerItemId: 'flow-canvas', edit } } })
        expect(result.status).toBe('applied')
        if (session.read().model.kind !== 'course-v9') throw Error('Expected course model')
        return (session.read().model as Extract<DocumentModel, { kind: 'course-v9' }>).project
      })
      await page.setContent('<div id="host" style="position:relative;width:800px;height:560px"></div>')
      await page.addScriptTag({ content: bundle })
      await page.evaluate(async project => {
        const w = window as any, api = w.FlowCanvas, host = document.getElementById('host')!
        const h: any = w.__flowHarness = { root: api.createRoot(host), project, pending: false, outerCommands: [], selections: [] }
        h.render = () => {
          if (h.renderedProject !== h.project) {
            h.view = api.buildFlowEditorView({ project: h.project, locationId: 'flow-location' })
            h.publish = (item: any) => api.publishLayerItem({ project: h.project, assetFiles: {}, components: {} }, item).content
            h.renderedProject = h.project
          }
          api.flushSync(() => h.root.render(api.createElement(api.FlowOverlayAuthoringLayer, {
            view: h.view, locationId: 'flow-location', sessionToken: { surfaceType: 'flow', locationId: 'flow-location', revision: h.project.revision, generation: 1 },
            selection: { locationId: 'flow-location', surfaceId: 'flow', authoringScope: 'page', focus: 'overlay', selectedBlockId: null,
              selectedBlockIds: [], selectedOverlayIds: ['flow-canvas'], textRange: null, authoringAddress: 'flow-selection' },
            assetUrls: {}, componentPackages: {}, paperScrollTop: 0, paperWidth: 700, overlayViewportSize: { width: 800, height: 560 },
            commands: { run: (command: any) => { h.outerCommands.push(command); return { ok: true } } },
            publishCompositionContent: h.publish, onCompositionSelection: (value: any) => h.selections.push(value),
            onCompositionEdit: async (_id: string, edit: any) => {
              h.pending = true
              try { h.project = await w.commitFlowCanvas(edit); h.render(); await api.waitForPublishedObservationReady(host) }
              finally { h.pending = false }
            }, children: api.createElement('p', null, 'Document text'),
          })))
        }
        h.render(); await api.waitForPublishedObservationReady(host)
        h.iframe = host.querySelector('iframe[data-web-composition]')
        h.probe = h.iframe.contentWindow.__flowCanvasProbe; h.button = h.iframe.contentDocument.querySelector('[data-flow-counter]'); h.button.onclick()
      }, project)
      const iframe = page.locator('iframe[data-web-composition]'), frame = page.frameLocator('iframe[data-web-composition]')
      const free = frame.locator('[data-composition-node="free"]'), bounds = await free.boundingBox()
      if (!bounds) throw Error('Missing Flow content')
      const before = session.read()
      await page.mouse.move(bounds.x + 150, bounds.y + 50); await page.mouse.down()
      // A selection/pinned-toolbar render does not change authored content while the pointer is held.
      await page.evaluate(async () => {
        (window as any).__flowHarness.render()
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
      await page.mouse.move(bounds.x + 220, bounds.y + 85, { steps: 6 })
      expect(session.read()).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(() => (window as any).__flowHarness.pending)).toBe(true)
      expect(edits).toHaveLength(1)
      expect(await iframe.count()).toBe(1)
      expect(await page.evaluate(() => ({ creates: (window as any).__flowHarness.probe.creates,
        same: (window as any).__flowHarness.iframe === document.querySelector('iframe[data-web-composition]') }))).toEqual({ creates: 1, same: true })
      releaseCommit()
      await expect.poll(() => session.read().revision).toBe(before.revision + 1)
      await expect.poll(() => page.evaluate(() => (window as any).__flowHarness.pending)).toBe(false)
      await page.evaluate(async () => { await (window as any).FlowCanvas.waitForPublishedObservationReady(document.getElementById('host')) })
      expect(session.read().undoDepth).toBe(before.undoDepth + 1)
      expect(await free.evaluate(element => ({ left: (element as HTMLElement).style.left, top: (element as HTMLElement).style.top }))).toEqual({ left: '150px', top: '155px' })
      expect(locateCourseLayer((session.read().model as Extract<DocumentModel, { kind: 'course-v9' }>).project, 'flow-canvas')?.item.frame).toEqual(layer.frame)
      expect(await page.evaluate(() => {
        const h = (window as any).__flowHarness
        return { outerCommands: h.outerCommands.length, selected: h.selections.map((value: any) => value.nodeId), creates: h.probe.creates,
          destroys: h.probe.destroys, count: h.button.textContent, same: h.iframe === document.querySelector('iframe[data-web-composition]') }
      })).toMatchObject({ outerCommands: 0, selected: ['free'], creates: 1, destroys: 0, count: 'count:1', same: true })
      expect(errors).toEqual([])
      await page.evaluate(() => (window as any).FlowCanvas.flushSync(() => (window as any).__flowHarness.root.unmount()))
    } finally { releaseCommit(); await page.close() }
  } finally { await browser.close() }
}, 30_000)
