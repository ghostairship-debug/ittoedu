// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Locator } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionContentEdit } from '../../src/shared/composition/edit'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'

function fixture(): Extract<DocumentModel, { kind: 'course-v9' }> {
  const project = createBlankCourseProject({ canvas: { width: 1000, height: 620 }, includeDefaultController: false, controls: 'none' })
  const item: CompositionLayerItem = {
    layerItemId: 'canvas-content', kind: 'composition', label: 'Canvas content', locked: false,
    order: 0, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 0, y: 0, width: 1000, height: 620 },
    content: { assets: {}, root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: { style: 'margin:0;position:relative;height:620px;background:white;font:18px sans-serif' }, children: [
        { id: 'free', kind: 'element', tagName: 'div', attributes: { style: 'position:absolute;left:100px;top:240px;width:240px;height:100px;background:#fff1cc;box-sizing:border-box' },
          children: [{ id: 'free-text', kind: 'text', text: 'Editable content' }] },
        { id: 'cards', kind: 'element', tagName: 'main', attributes: { style: 'display:flex;gap:16px;padding:30px' }, children: ['a', 'b', 'c'].map(id => ({
          id: `card-${id}`, kind: 'element', tagName: 'section', attributes: { style: 'flex:0 0 180px;height:100px;background:#e9f2ff' },
          children: [{ id: `text-${id}`, kind: 'text', text: `Card ${id}` }],
        })) },
        { id: 'counter-slot', kind: 'element', tagName: 'div', attributes: { style: 'position:absolute;left:100px;top:420px;width:200px;height:60px' }, children: [
          { id: 'counter', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom', enabled: true,
            content: { values: {} }, assets: {}, source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
              const probe=window.__canvasProbe||(window.__canvasProbe={creates:0,destroys:0});probe.creates++;
              let count=0;const button=document.createElement('button');button.dataset.canvasCounter='true';button.textContent='count:0';
              button.onclick=()=>button.textContent='count:'+ ++count;ctx.dom.root.append(button);
              return {resize(){},destroy(){probe.destroys++;button.remove()}};
            }})` } },
        ] },
      ] },
    ] } },
  }
  project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems.push(item)
  return { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
}

function item(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw Error('Expected course model')
  const item = locateCourseLayer(model.project, 'canvas-content')?.item
  if (item?.kind !== 'composition') throw Error('Expected composition')
  return item
}

async function center(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw Error('Missing visible canvas control')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

it('F05 edits actual Slide canvas content through one Published iframe and canonical history without a dialog or Runtime reset', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-canvas-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const driver = new CourseV9Driver()
    const persistence: DocumentPersistence = {
      async append() {},
      async save(input) {
        if (input.binding.kind !== 'file') throw Error('Expected save path')
        await fs.writeFile(input.binding.path, input.bytes)
        return { ...input.binding, version: `revision-${input.revision}` }
      },
    }
    const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
    const initial = fixture(), session = await registry.create(initial, 'canvas.h5lesson')
    const edits: CompositionContentEdit[] = []
    const operation = (snapshot: DocumentSnapshot, mutation: Parameters<typeof session.execute>[0]['mutation']) => ({
      documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const, baseRevision: snapshot.revision, mutation,
    })
    const bundle = (await build({
      stdin: { contents: `
        export {createElement} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';
        export {SlideLocationWorkspace} from './src/renderer/ui/workspaces/SlideLocationWorkspace';
        export {createSlideAuthoringBackend,openSlideAuthoringSession} from './src/renderer/course/slideAuthoringBackend';
        export {buildSlideEditorView} from './src/core/tools/slideLayerView';
        export {projectV9EditingNodesWithDraft} from './src/renderer/store/slideEditorProjection';
        export {mountPublishedCourseAuthoring} from './src/renderer/ui/coursePlayerTryRun';
        export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
      `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', globalName: 'Canvas', platform: 'browser',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"test"' },
    })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    page.setDefaultTimeout(5000)
    try {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://localhost/composition-canvas', route => route.fulfill({ contentType: 'text/html', body: '<main id="host" style="width:920px;height:700px;display:grid;position:relative"></main>' }))
      await page.goto('http://localhost/composition-canvas')
      await page.exposeFunction('commitCanvasEdit', async (edit: CompositionContentEdit) => {
        const result = await session.execute(operation(session.read(), { type: 'command', command: { type: 'composition.edit', layerItemId: 'canvas-content', edit } }))
        expect(result.status).toBe('applied'); edits.push(structuredClone(edit))
        if (session.read().model.kind !== 'course-v9') throw Error('Expected course model')
        return (session.read().model as Extract<DocumentModel, { kind: 'course-v9' }>).project
      })
      await page.addStyleTag({ content: (await fs.readFile('src/renderer/styles/globals.css', 'utf8'))
        .replace("@import './variables.css';", await fs.readFile('src/renderer/styles/variables.css', 'utf8')) })
      await page.addScriptTag({ content: bundle })
      await page.evaluate(async project => {
        const w = window as any, api = w.Canvas, host = document.getElementById('host')!
        const h: any = w.__canvasHarness = { root: api.createRoot(host), project, pending: false, errors: [], outerCommands: 0, selections: [] }
        const no = () => {}
        h.render = () => {
          if (h.renderedProject !== h.project) {
            h.backend = api.createSlideAuthoringBackend(api.openSlideAuthoringSession(h.project, { sessionId: 'canvas-authoring' }))
            h.backend.selectLayers(['canvas-content'])
            h.view = api.buildSlideEditorView({ project: h.project, locationId: h.backend.getSnapshot().locationId })
            h.renderedProject = h.project
          }
          const backend = h.backend
          const state = backend.getSnapshot(), editingNodes = api.projectV9EditingNodesWithDraft(backend, null)
          const snapshot = { view: h.view, locationId: state.locationId,
            backend, backendKind: 'slide-authoring', componentPackages: {}, sidecarFileIds: [], editingScope: 'scene', presentationStateId: null,
            canvasMode: 'edit', editingNodes, selectedNodeIds: ['canvas-content'], selectedNode: editingNodes.find((node: any) => node.id === 'canvas-content'),
            editingTextNodeId: null, contentEdit: null, sceneId: state.sceneId, projectId: h.project.id, projectRevision: h.project.revision,
            sessionGeneration: state.generation, previewRebuildKey: 'same-live-canvas', tryRunMountKey: null, drawTool: null }
          const ports = {
            canvas: { setCanvasMode: no, setDrawTool: no, setStatus: no }, selection: { selectNodes: no, selectNode: no },
            content: { beginTextEdit: no, commitTextEdit: no, cancelTextEdit: no, updateTextEditDraft: no, setTextEditComposing: no,
              updateNode: no, updateNodes: no, addTextNode: no, addFormulaNode: no, addRectangleNode: no, addShapeNode: no,
              drawShapeNode: no, addTableNode: no, addChartNode: no, addExternalComponentNode: no },
            runtime: { captureRuntimeContentTextTarget: () => null, captureRuntimeAssetReplacementTarget: () => null,
              submitDynamicFallbackIntent: () => null, dynamicFallbackState: [], retryDynamicFallback: no, discardDynamicFallback: no },
            authoring: { run: (run: any) => { h.outerCommands++; return run(backend) }, runFieldTextIntent: no, applySlideCommand: no },
            preview: { mount: (input: any) => api.mountPublishedCourseAuthoring({ ...input, project: h.project, assetFiles: {}, components: {}, locationId: state.locationId, stateId: null }) },
            tryRun: { mount: async () => { throw Error('Not used') } },
          }
          api.flushSync(() => h.root.render(api.createElement(api.SlideLocationWorkspace, { snapshot, ports, onAddImage: no, onAddVideo: no,
            onSelectImageAsset: async () => null, selectedCompositionNode: h.selected ?? null,
            onCompositionSelection: (value: any) => { h.selected = value; h.selections.push(value); h.render() },
            onCompositionEdit: async (_id: string, edit: any) => {
              h.pending = true
              try { h.project = await w.commitCanvasEdit(edit); h.render(); await api.waitForPublishedObservationReady(host) }
              catch (error) { h.errors.push(String(error)); throw error }
              finally { h.pending = false }
            },
          })))
        }
        h.render()
      }, initial.project)
      const ready = async () => {
        await expect.poll(() => page.evaluate(() => !(window as any).__canvasHarness.pending)).toBe(true)
        await expect.poll(() => page.locator('[data-observation-source="authoring"]').getAttribute('data-observation-ready')).toBe('true')
        await page.evaluate(async () => {
          await (window as any).Canvas.waitForPublishedObservationReady(document.getElementById('host'))
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        })
      }
      await ready()
      const iframe = page.locator('iframe[data-web-composition]'), frame = page.frameLocator('iframe[data-web-composition]')
      await expect.poll(() => page.locator('[data-composition-authoring="canvas-content"]').count()).toBe(1)
      await page.evaluate(() => {
        const h = (window as any).__canvasHarness
        h.iframe = document.querySelector('iframe[data-web-composition]')
        h.probe = h.iframe.contentWindow.__canvasProbe
        h.button = h.iframe.contentDocument.querySelector('[data-canvas-counter]'); h.button.onclick()
        h.stack = document.querySelector('.canvas-stage-stack')!.getAttribute('style')
      })
      expect(await iframe.count()).toBe(1)
      expect(await page.getByRole('dialog').count()).toBe(0)
      const box = await iframe.boundingBox(); if (!box) throw Error('Missing canvas iframe')
      const scale = box.width / 1000
      expect(scale).toBeGreaterThan(0); expect(scale).toBeLessThan(1)

      await frame.locator('[data-composition-node="free"]').click({ position: { x: 180, y: 40 } })
      const selected = page.locator('[data-composition-selection="free"]')
      await selected.waitFor({ state: 'visible' })
      const before = session.read(), start = await center(selected.getByRole('button', { name: '拖动内容', exact: true }))
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      await page.mouse.move(start.x + 80 * scale, start.y + 40 * scale, { steps: 5 })
      expect(session.read().revision).toBe(before.revision)
      await page.mouse.up(); await ready()
      expect(session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1 })
      const geometry = () => frame.locator('[data-composition-node="free"]').evaluate(element => {
        const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
      expect(await geometry()).toMatchObject({ x: 180, y: 280, width: 240, height: 100 })

      const resizeBefore = session.read(), resizeStart = await center(selected.getByRole('button', { name: '缩放内容', exact: true }))
      await page.mouse.move(resizeStart.x, resizeStart.y); await page.mouse.down()
      await page.mouse.move(resizeStart.x + 60 * scale, resizeStart.y + 30 * scale, { steps: 5 }); await page.mouse.up(); await ready()
      expect(session.read()).toMatchObject({ revision: resizeBefore.revision + 1, undoDepth: resizeBefore.undoDepth + 1 })
      expect(await geometry()).toMatchObject({ x: 180, y: 280, width: 300, height: 130 })

      const cancelBefore = session.read(), cancelStart = await center(selected.getByRole('button', { name: '拖动内容', exact: true }))
      await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down(); await page.mouse.move(cancelStart.x + 50, cancelStart.y + 20)
      await page.keyboard.press('Escape'); await page.mouse.up(); await ready()
      expect(session.read()).toMatchObject({ revision: cancelBefore.revision, undoDepth: cancelBefore.undoDepth })
      expect(edits).toHaveLength(2)
      expect(item(session.read().model).frame).toEqual(item(initial).frame)
      const observed = await page.evaluate(() => {
        const h = (window as any).__canvasHarness
        return { iframeCount: document.querySelectorAll('iframe[data-web-composition]').length, same: h.iframe === document.querySelector('iframe[data-web-composition]'),
          creates: h.probe.creates, destroys: h.probe.destroys, count: h.button.textContent, outerCommands: h.outerCommands,
          sameCamera: h.stack === document.querySelector('.canvas-stage-stack')!.getAttribute('style'), errors: h.errors,
          selected: h.selections.map((value: any) => value.nodeId) }
      })
      expect(observed).toMatchObject({ iframeCount: 1, same: true, creates: 1, destroys: 0, count: 'count:1', outerCommands: 0, sameCamera: true, errors: [] })
      expect(observed.selected).toContain('free'); expect(errors).toEqual([])

      const saved = path.join(directory, 'canvas.h5lesson')
      await registry.save(session.documentId, { kind: 'file', path: saved, version: null, bindingVersion: 0 })
      const reopened = driver.load(new Uint8Array(await fs.readFile(saved)))
      expect(item(reopened).content).toEqual(item(session.read().model).content)
      expect(findCompositionNode(item(reopened).content.root, 'free')).toMatchObject({ kind: 'element' })
      const undoBefore = session.read()
      expect((await session.execute(operation(undoBefore, { type: 'undo' }))).status).toBe('applied')
      await page.evaluate(project => { const h = (window as any).__canvasHarness; h.project = project; h.render() }, (session.read().model as Extract<DocumentModel, { kind: 'course-v9' }>).project)
      await ready()
      expect(await geometry()).toMatchObject({ x: 180, y: 280, width: 240, height: 100 })
      await page.evaluate(() => (window as any).Canvas.flushSync(() => (window as any).__canvasHarness.root.unmount()))
    } finally { await page.close() }
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }) }
}, 45_000)
