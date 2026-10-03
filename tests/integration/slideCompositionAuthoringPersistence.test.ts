// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel } from '../../src/shared/workbench/document'

it('applies Slide content and resize in place, retains a running interaction, and reopens the edited formal project', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-composition-authoring-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    const scene = slide.scenes[0]!
    scene.canvas = { width: 800, height: 900 }
    const item: CompositionLayerItem = {
      layerItemId: 'web-lesson', kind: 'composition', label: 'Web lesson', locked: false,
      order: 0, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
      frame: { mode: 'absolute', x: 0, y: 0, width: 800, height: 800 },
      content: { assets: {}, root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
        { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [
          { id: 'style', kind: 'element', tagName: 'style', attributes: {}, children: [
            { id: 'css', kind: 'text', text: 'html,body{margin:0;font:18px sans-serif}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.interaction{height:60px}@media(max-width:500px){.columns{grid-template-columns:1fr}}' },
          ] },
        ] },
        { id: 'body', kind: 'element', tagName: 'body', attributes: {}, children: [
          { id: 'columns', kind: 'element', tagName: 'main', attributes: { class: 'columns' }, children: [
            { id: 'left', kind: 'element', tagName: 'section', attributes: {}, children: [
              { id: 'paragraph', kind: 'element', tagName: 'p', attributes: {}, children: [{ id: 'text', kind: 'text', text: 'Predict first.' }] },
              { id: 'interaction', kind: 'element', tagName: 'div', attributes: { class: 'interaction' }, children: [
                { id: 'runtime', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom', enabled: true,
                  source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
                    const probe=window.__slideProbe={creates:1,destroys:0};let count=0;
                    const button=document.createElement('button');button.dataset.counter='true';button.textContent='count:0';
                    button.onclick=()=>button.textContent='count:'+ ++count;ctx.dom.root.append(button);
                    return {resize(w,h){button.dataset.width=String(w)},destroy(){probe.destroys++;button.remove()}};
                  }})`, content: { values: {} }, assets: {} } },
              ] },
            ] },
            { id: 'right', kind: 'element', tagName: 'section', attributes: {}, children: [{ id: 'right-text', kind: 'text', text: 'Observation' }] },
          ] },
        ] },
      ] } },
    }
    scene.layerItems.push(item)
    const shared = sceneNodeToCourseLayerItem(createTextNode({ id: 'shared-title', text: 'Shared heading', x: 100, y: 50, width: 300, height: 80 }))
    project.globalLayerItems.push({ item: shared, visibility: { mode: 'all', locationIds: [] } })
    const driver = new CourseV9Driver()
    const initial: DocumentModel = { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
    const locationId = project.locations[0]!.id
    const editedText = 'Explain the observed result with evidence and keep all of the original interaction. '.repeat(10)
    const contentEdited = await driver.apply(initial, { type: 'composition.edit', layerItemId: item.layerItemId,
      edit: { type: 'text', nodeId: 'text', text: editedText } })
    const frame = { x: 30, y: 20, width: 400, height: 850 }
    const resized = await driver.apply(contentEdited, { type: 'course.object.patch', locationId, itemId: item.layerItemId, patch: { frame } })
    if (resized.kind !== 'course-v9') throw new Error('Unexpected resized document')
    const resizedProject = structuredClone(resized.project)
    const resizedSlide = resizedProject.surfaces.find(surface => surface.type === 'slide')!
    resizedSlide.scenes[0]!.canvas = { width: 720, height: 900 }
    const edited = await driver.apply(resized, { type: 'course.replace', project: resizedProject })
    const savedPath = path.join(root, 'lesson.h5lesson')
    await fs.writeFile(savedPath, driver.serialize(edited))
    const reopened = driver.load(new Uint8Array(await fs.readFile(savedPath)))
    if (reopened.kind !== 'course-v9') throw new Error('Unexpected reopened document')
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const editedPayload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: {}, components: {} })
    const publishedSlide = editedPayload.surfaces.find(surface => surface.type === 'slide')!
    const publishedItem = publishedSlide.scenes[0]!.layerItems.find(candidate => candidate.layerItemId === item.layerItemId)!
    if (publishedItem.kind !== 'composition') throw new Error('Reopened content lost its formal composition')
    expect(publishedItem.frame).toMatchObject(frame)
    expect(publishedSlide.scenes[0]!.canvas).toEqual({ width: 720, height: 900 })
    const bundle = (await build({ stdin: { contents: `export {SlidePublishedAdapter} from './src/player/surfaces/slide/SlidePublishedAdapter';export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture'`, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SlideComposition', define: { 'process.env.NODE_ENV': '"test"' },
    })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
    try {
      await page.setContent('<div id="host" style="position:relative;width:800px;height:900px"></div>')
      await page.addScriptTag({ content: bundle })
      const result = await page.evaluate(async ({ payload, publishedItem, surfaceId, locationId }) => {
        const api = (window as any).SlideComposition, container = document.getElementById('host')!
        const diagnostics: string[] = []
        const host = new api.SlidePublishedAdapter(payload, surfaceId, { locationId, authoring: { scope: 'scene', stateId: null } })
        await host.mount({ surfaceId, container, signal: new AbortController().signal,
          services: { navigate() {}, getCourseState() {}, setCourseState() {}, resolveAsset() {}, reportDiagnostic(diagnostic: any) { diagnostics.push(diagnostic.message) } } })
        await host.activate()
        await api.waitForPublishedObservationReady(container)
        const iframe = container.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
        const dom = iframe.contentDocument!, button = dom.querySelector<HTMLButtonElement>('[data-counter]')!
        if (!button) throw new Error(`Runtime button missing: ${dom.body.innerHTML}; ${diagnostics.join('; ')}`)
        const probe = (iframe.contentWindow as any).__slideProbe
        // Authoring intentionally captures browser input. Exercise the live
        // program's existing handler to give its instance state to preserve.
        button.onclick!.call(button, new PointerEvent('click'))
        const context = host.getAuthoringContext(), generation = host.getAuthoringGeneration()
        const canvas = await host.applyAuthoringPatch(context, { kind: 'scene-canvas', target: { kind: 'scene-canvas', scope: 'scene' },
          canvas: { width: 720, height: 900 }, referenceCanvas: { width: 1280, height: 720 } }, { revision: 1, generation })
        const content = await host.applyAuthoringPatch(context, { kind: 'composition-content', target: { kind: 'composition-content', scope: 'scene', nodeId: publishedItem.layerItemId }, content: publishedItem.content }, { revision: 2, generation })
        const geometry = await host.applyAuthoringPatch(context, { kind: 'composition-frame', target: { kind: 'composition-frame', scope: 'scene', nodeId: publishedItem.layerItemId }, frame: publishedItem.frame,
          rotation: publishedItem.rotation, opacity: publishedItem.opacity, visible: publishedItem.visible }, { revision: 3, generation })
        const order = await host.applyAuthoringPatch(context, { kind: 'scene-order', target: { kind: 'scene-order', scope: 'scene' }, nodeIds: [publishedItem.layerItemId] }, { revision: 4, generation })
        await api.waitForPublishedObservationReady(container)
        const left = dom.querySelector('[data-composition-node="left"]')!.getBoundingClientRect()
        const right = dom.querySelector('[data-composition-node="right"]')!.getBoundingClientRect()
        const shared = container.querySelector<HTMLElement>('[data-global-layer-item="shared-title"]')!
        const sharedFrame = shared.getBoundingClientRect()
        const values = { canvasResult: canvas, content, geometry, order, sameIframe: iframe === container.querySelector('iframe[data-web-composition]'),
          sameButton: button === dom.querySelector('[data-counter]'), count: button.textContent, viewport: dom.documentElement.clientWidth,
          text: dom.body.textContent, oneColumn: right.top > left.top && right.left === left.left,
          canvas: container.firstElementChild!.getAttribute('data-canvas-width') + 'x' + container.firstElementChild!.getAttribute('data-canvas-height'),
          sharedWidth: sharedFrame.width, sharedTransform: shared.style.transform, creates: probe.creates, destroysBeforeClose: probe.destroys }
        await host.destroy()
        return { ...values, destroysAfterClose: probe.destroys }
      }, { payload, publishedItem, surfaceId: slide.id, locationId })
      expect(result.content).toMatchObject({ ok: true })
      expect(result.canvasResult).toMatchObject({ ok: true })
      expect(result.geometry).toMatchObject({ ok: true })
      expect(result.order).toMatchObject({ ok: true })
      expect(result).toMatchObject({ sameIframe: true, sameButton: true, count: 'count:1', viewport: 400,
        oneColumn: true, canvas: '720x900', creates: 1, destroysBeforeClose: 0, destroysAfterClose: 1 })
      expect(result.text).toContain(editedText)
      expect(result.sharedWidth).toBe(168.75)
      expect(result.sharedTransform).toContain('scale(0.5625)')
    } finally { await page.close() }
  } finally {
    await browser.close()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
