// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { applyCompositionContentEdit } from '../../src/core/tools/compositionContent'
import { publishLayerItem } from '../../src/renderer/export/course/buildPublishedCourse'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionContentEdit } from '../../src/shared/composition/edit'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'

type Model = Extract<DocumentModel, { kind: 'course-v9' }>
type Node = CompositionLayerItem['content']['root']
const text = (id: string, value: string): Node => ({ id, kind: 'text', text: value })
const element = (id: string, tagName: string, children: Node[], attributes: Record<string, string> = {}): Node =>
  ({ id, kind: 'element', tagName, attributes, children })
function fixture(): Model {
  const project = createBlankCourseProject({ canvas: { width: 1000, height: 800 }, includeDefaultController: false, controls: 'none' })
  const item: CompositionLayerItem = {
    layerItemId: 'layout', kind: 'composition', label: 'Layout editing', locked: false, order: 0, visible: true,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 0, y: 0, width: 1000, height: 800 },
    content: { assets: {}, root: element('html', 'html', [
      element('head', 'head', [element('css', 'style', [text('css-text',
        'html,body{margin:0;font:18px sans-serif}body{position:relative;height:800px}'
        + '.canvas{position:relative;width:700px;height:220px;margin:36px;padding:18px;border:6px solid #333;overflow:auto;box-sizing:content-box}'
        + '.row{display:flex;gap:12px;width:900px}.card{flex:0 0 180px;width:180px;height:84px;padding:11px;border:3px solid #287;margin:7px;box-sizing:content-box;background:#def}'
        + '.other{display:flex;position:relative;margin:36px;width:650px;gap:12px;height:145px;background:#efe}'
        + '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:500px;margin:36px;height:70px}'
        + '.forced{position:absolute!important;inset-inline-start:20px!important;top:20px;width:100px;height:50px}'
        + '@media(max-width:700px){.card{font-size:24px}}'
      )])]),
      element('body', 'body', [
        element('canvas', 'div', [element('row', 'div', [
          element('source', 'section', [text('source-text', 'Flow card')], { class: 'card' }),
          element('anchor', 'section', [{ id: 'counter', kind: 'runtime', runtime: {
            protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', content: { values: {} }, assets: {},
            source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
              const p=window.__layoutProbe||(window.__layoutProbe={creates:0,destroys:0});p.creates++;let n=0;
              const b=document.createElement('button');b.dataset.layoutCounter='true';b.textContent='count:0';b.onclick=()=>b.textContent='count:'+ ++n;ctx.dom.root.append(b);
              return {resize(){},destroy(){p.destroys++;b.remove()}}}})`,
          } }], { class: 'card' }),
        ], { class: 'row' })], { class: 'canvas' }),
        element('other', 'section', [], { class: 'other' }),
        element('free-zone', 'div', [], { style: 'position:absolute;left:780px;top:280px;width:180px;height:200px;background:#edf' }),
        element('grid', 'div', [element('grid-a', 'div', [text('grid-a-text', 'Column A')]), element('grid-b', 'div', [text('grid-b-text', 'Column B')])], { class: 'grid' }),
        element('percent', 'div', [text('percent-text', 'Percent')], { style: 'position:absolute;left:10%;top:75%;width:25%;height:70px;background:#fed;box-sizing:border-box' }),
        element('anchored', 'div', [text('anchored-text', 'Right and bottom')], { style: 'position:absolute;left:auto;top:auto;right:8%;bottom:10%;width:120px;height:50px;background:#ffe' }),
        element('complex', 'div', [text('complex-text', 'Expression')], { style: 'position:absolute;left:calc(55% - 20px);top:75%;width:160px;height:calc(60px + 10px);background:#fdf' }),
        element('forced', 'div', [text('forced-text', 'Rule position')], { class: 'forced' }),
      ]),
    ]) },
  }
  project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems.push(item)
  return { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
}
function composition(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw new Error('Expected course')
  const item = locateCourseLayer(model.project, 'layout')?.item
  if (item?.kind !== 'composition') throw new Error('Expected composition')
  return item
}
function view(model: DocumentModel) {
  if (model.kind !== 'course-v9') throw new Error('Expected course')
  const item = composition(model), published = publishLayerItem({ project: model.project, assetFiles: model.resources.assets, components: {} }, item)
  if (published.kind !== 'composition') throw new Error('Expected Published composition')
  return { content: published.content, source: item.content, projectId: model.project.id }
}
async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => !(window as any).__layoutHarness.pending)).toBe(true)
  await page.evaluate(async () => {
    await (window as any).LayoutEditing.waitForPublishedObservationReady(document.getElementById('host'))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}
async function geometry(page: Page, id: string) {
  return page.frameLocator('iframe[data-web-composition]').locator(`[data-composition-node="${id}"]`).evaluate(element => {
    const r = element.getBoundingClientRect(), css = element.ownerDocument.defaultView!.getComputedStyle(element)
    return { x: r.x, y: r.y, width: r.width, height: r.height, position: css.position, fontSize: css.fontSize }
  })
}
async function gesture(page: Page, id: string, dx: number, dy: number, resize = false) {
  await page.getByLabel('内容对象', { exact: true }).selectOption(id); await ready(page)
  const button = page.locator(`[data-composition-selection="${id}"]`).getByRole('button', { name: resize ? '缩放内容' : '拖动内容', exact: true })
  const box = await button.boundingBox(); if (!box) throw new Error('Missing gesture handle')
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx * .7, y + dy * .7, { steps: 5 }); await page.mouse.up(); await ready(page)
}

it('F04/F05 keeps real flow/free geometry, percentage units, explicit expressions, column sizing and atomic cross-container editing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-layout-edit-')), browser = await chromium.launch({ headless: true })
  try {
    const driver = new CourseV9Driver(), persistence: DocumentPersistence = {
      async append() {}, async save(input) {
        if (input.binding.kind !== 'file') throw new Error('Expected file')
        await fs.writeFile(input.binding.path, input.bytes); return { ...input.binding, version: `revision-${input.revision}` }
      },
    }
    const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
    const session = await registry.create(fixture(), 'layout.h5lesson'), edits: CompositionContentEdit[] = []
    const operation = (snapshot: DocumentSnapshot, mutation: Parameters<typeof session.execute>[0]['mutation']) => ({
      documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const, baseRevision: snapshot.revision, mutation,
    })
    const bundle = (await build({ stdin: { contents: `
      import React,{createElement,useState} from 'react'; export {createElement} from 'react'; export {createRoot} from 'react-dom/client'; export {flushSync} from 'react-dom';
      import {WebCompositionAuthoringContent} from './src/renderer/composition/WebCompositionAuthoringContent';
      import {CompositionContentEditor} from './src/renderer/composition/CompositionContentEditor';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
      export function Harness(p){const [viewport,setViewport]=useState(null);return <main style={{display:'flex',gap:12}}>
        <section style={{width:700,height:560}}><div style={{width:p.width,height:800,transform:'scale(.7)',transformOrigin:'0 0'}}>
          <WebCompositionAuthoringContent layerItemId="layout" content={p.content} width={p.width} height={800} assetUrls={{}} projectId={p.projectId}
            selectedNodeId={p.selected} onSelection={s=>p.onSelect(s.nodeId)} onEdit={p.onEdit} onLayoutMount={setViewport}/>
        </div></section><aside style={{width:320,height:800,overflow:'auto'}}>
          <CompositionContentEditor content={p.source} selectedNodeId={p.selected} onSelect={p.onSelect} onEdit={p.onEdit} viewport={viewport}/>
        </aside></main>}
    `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'LayoutEditing',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1200, height: 950 } })
    try {
      page.on('pageerror', error => console.error(error.message))
      await page.exposeFunction('commitLayout', async (edit: CompositionContentEdit) => {
        const before = session.read(), result = await session.execute(operation(before, { type: 'command', command: { type: 'composition.edit', layerItemId: 'layout', edit } }))
        expect(result).toMatchObject({ status: 'applied' }); expect(session.read().undoDepth).toBe(before.undoDepth + 1); edits.push(edit)
        return view(session.read().model)
      })
      await page.setContent('<style>body{margin:0}</style><div id="host"></div>'); await page.addScriptTag({ content: bundle })
      await page.evaluate(async initial => {
        const w = window as any, api = w.LayoutEditing, root = api.createRoot(document.getElementById('host'))
        const h: any = { root, pending: false, props: { ...initial, width: 1000, selected: 'source' } }
        h.render = () => api.flushSync(() => root.render(api.createElement(api.Harness, h.props)))
        h.props.onSelect = (selected: string) => { h.props.selected = selected; h.render() }
        h.props.onEdit = async (edit: any) => { h.pending = true; try { Object.assign(h.props, await w.commitLayout(edit)); h.render() } finally { h.pending = false } }
        w.__layoutHarness = h; h.render(); await api.waitForPublishedObservationReady(document.getElementById('host'))
        const iframe = document.querySelector('iframe[data-web-composition]') as HTMLIFrameElement
        h.iframe = iframe; h.button = iframe.contentDocument!.querySelector('[data-layout-counter]'); h.probe = (iframe.contentWindow as any).__layoutProbe
        h.button.onclick.call(h.button, new PointerEvent('click'))
        iframe.contentDocument!.querySelector('[data-composition-node="canvas"]')!.scrollLeft = 35
      }, view(session.read().model))
      await ready(page)
      const before = await geometry(page, 'source'), original = session.read()
      await page.getByLabel('定位', { exact: true }).selectOption('absolute'); await ready(page)
      const free = await geometry(page, 'source')
      for (const property of ['x', 'y', 'width', 'height'] as const) expect(free[property]).toBeCloseTo(before[property], 1)
      expect(free.position).toBe('absolute')
      expect((findCompositionNode(composition(session.read().model).content.root, 'canvas') as any).attributes.style).toBeUndefined()
      expect(await session.execute(operation(session.read(), { type: 'undo' }))).toMatchObject({ status: 'applied' })
      await page.evaluate(next => { Object.assign((window as any).__layoutHarness.props, next); (window as any).__layoutHarness.render() }, view(session.read().model)); await ready(page)
      expect(findCompositionNode(composition(session.read().model).content.root, 'source')).toEqual(findCompositionNode(composition(original.model).content.root, 'source'))
      await page.getByLabel('内容对象', { exact: true }).selectOption('forced'); await ready(page)
      await page.getByLabel('定位', { exact: true }).selectOption('relative'); await ready(page)
      expect((await geometry(page, 'forced')).position).toBe('relative')
      expect((findCompositionNode(composition(session.read().model).content.root, 'forced') as any).attributes.style).toContain('position: relative !important')

      const percentBefore = await geometry(page, 'percent')
      await gesture(page, 'percent', 50, 0)
      const percentNode = findCompositionNode(composition(session.read().model).content.root, 'percent') as Extract<Node, { kind: 'element' }>
      expect(percentNode.attributes.style).toContain('left: 15%')
      expect((await geometry(page, 'percent')).x).toBeCloseTo(percentBefore.x + 50, 1)
      const anchoredBefore = await geometry(page, 'anchored')
      await gesture(page, 'anchored', 30, -20)
      const anchored = findCompositionNode(composition(session.read().model).content.root, 'anchored') as Extract<Node, { kind: 'element' }>
      expect(anchored.attributes.style).toContain('right: 5%')
      expect(anchored.attributes.style).toContain('bottom: 12.5%')
      expect((await geometry(page, 'anchored')).x).toBeCloseTo(anchoredBefore.x + 30, 1)
      expect((await geometry(page, 'anchored')).y).toBeCloseTo(anchoredBefore.y - 20, 1)
      const complexBeforeVertical = await geometry(page, 'complex')
      await gesture(page, 'complex', 0, -20)
      expect((await geometry(page, 'complex')).y).toBeCloseTo(complexBeforeVertical.y - 20, 1)
      expect((findCompositionNode(composition(session.read().model).content.root, 'complex') as any).attributes.style).toContain('left:calc(')
      const complexBefore = session.read()
      await gesture(page, 'complex', 30, 0)
      expect(session.read().revision).toBe(complexBefore.revision)
      expect(await page.getByRole('status').filter({ hasText: '像素覆盖' }).count()).toBe(1)
      await page.getByLabel('手势使用像素覆盖', { exact: true }).check()
      await gesture(page, 'complex', 30, 0)
      expect(session.read().revision).toBe(complexBefore.revision + 1)
      expect((findCompositionNode(composition(session.read().model).content.root, 'complex') as any).attributes.style).not.toContain('left:calc(')
      await page.getByLabel('手势使用像素覆盖', { exact: true }).uncheck()
      const complexBeforeResize = await geometry(page, 'complex')
      await gesture(page, 'complex', 20, 0, true)
      expect((await geometry(page, 'complex')).width).toBeCloseTo(complexBeforeResize.width + 20, 1)
      expect((findCompositionNode(composition(session.read().model).content.root, 'complex') as any).attributes.style).toContain('height:calc(')

      const cardBefore = await geometry(page, 'source')
      await gesture(page, 'source', 60, 0, true)
      expect((await geometry(page, 'source')).width).toBeCloseTo(cardBefore.width + 60, 1)
      const gridBefore = await geometry(page, 'grid-a')
      await gesture(page, 'grid-a', 35, 0, true)
      expect((await geometry(page, 'grid-a')).width).toBeCloseTo(gridBefore.width + 35, 1)
      expect((findCompositionNode(composition(session.read().model).content.root, 'grid') as any).attributes.style).toMatch(/grid-template-columns: [\d.]+fr [\d.]+fr/)

      await page.getByLabel('内容对象', { exact: true }).selectOption('percent'); await ready(page)
      const moveHandle = page.locator('[data-composition-selection="percent"]').getByRole('button', { name: '拖动内容', exact: true })
      const moveBox = await moveHandle.boundingBox(), target = await page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="other"]').boundingBox()
      if (!moveBox || !target) throw new Error('Missing source or destination')
      const crossBefore = session.read()
      await page.mouse.move(moveBox.x + 4, moveBox.y + 4); await page.mouse.down(); await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 }); await page.mouse.up(); await ready(page)
      expect(session.read().revision).toBe(crossBefore.revision + 1)
      expect(edits[edits.length - 1]).toMatchObject({ type: 'batch', nodeId: 'percent', edits: [{ type: 'move', parentId: 'other' }, { type: 'style' }] })
      expect((findCompositionNode(composition(session.read().model).content.root, 'other') as any).children.map((node: Node) => node.id)).toContain('percent')
      expect((await geometry(page, 'percent')).position).toBe('relative')
      await page.getByLabel('内容对象', { exact: true }).selectOption('source'); await ready(page)
      const sourceGeometry = await geometry(page, 'source')
      const sourceHandle = await page.locator('[data-composition-selection="source"]').getByRole('button', { name: '拖动内容', exact: true }).boundingBox()
      const freeZone = await page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="free-zone"]').boundingBox()
      if (!sourceHandle || !freeZone) throw new Error('Missing automatic source or free destination')
      const freeCrossBefore = session.read(), endX = freeZone.x + freeZone.width / 2, endY = freeZone.y + freeZone.height / 2
      await page.mouse.move(sourceHandle.x + 4, sourceHandle.y + 4); await page.mouse.down(); await page.mouse.move(endX, endY, { steps: 5 }); await page.mouse.up(); await ready(page)
      expect(session.read().revision).toBe(freeCrossBefore.revision + 1)
      expect(edits[edits.length - 1]).toMatchObject({ type: 'batch', nodeId: 'source', edits: [{ type: 'move', parentId: 'free-zone' }, { type: 'style' }] })
      const freeCross = await geometry(page, 'source')
      expect(freeCross.position).toBe('absolute')
      expect(freeCross.x).toBeCloseTo(sourceGeometry.x + (endX - sourceHandle.x - 4) / .7, 1)
      expect(freeCross.y).toBeCloseTo(sourceGeometry.y + (endY - sourceHandle.y - 4) / .7, 1)
      await page.evaluate(() => { const h = (window as any).__layoutHarness; h.props.width = 650; h.render() }); await ready(page)
      expect((await geometry(page, 'source')).fontSize).toBe('24px')
      expect(await page.evaluate(() => { const h = (window as any).__layoutHarness; return { sameIframe: h.iframe === document.querySelector('iframe[data-web-composition]'), sameButton: h.button === h.iframe.contentDocument.querySelector('[data-layout-counter]'), count: h.button.textContent, creates: h.probe.creates, destroys: h.probe.destroys } })).toEqual({ sameIframe: true, sameButton: true, count: 'count:1', creates: 1, destroys: 0 })
      const savePath = path.join(directory, 'layout.h5lesson')
      await registry.save(session.documentId, { kind: 'file', path: savePath, version: null, bindingVersion: 0 })
      const reopened = driver.load(new Uint8Array(await fs.readFile(savePath)))
      expect(findCompositionNode(composition(reopened).content.root, 'percent')).toEqual(findCompositionNode(composition(session.read().model).content.root, 'percent'))
      expect(findCompositionNode(composition(reopened).content.root, 'grid')).toEqual(findCompositionNode(composition(session.read().model).content.root, 'grid'))
    } finally { await page.close() }
  } finally {
    await browser.close()
    const relative = path.relative(os.tmpdir(), directory)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected fixture path')
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 45_000)

it('F05 rejects an invalid batch atomically and preserves the original formal content', () => {
  const content = composition(fixture()).content
  const result = applyCompositionContentEdit(content, { type: 'batch', nodeId: 'source', edits: [
    { type: 'style', nodeId: 'source', patch: { width: '300px' } },
    { type: 'move', nodeId: 'source', parentId: 'missing-target', index: 0 },
  ] })
  expect(result).toMatchObject({ ok: false, changed: false, diagnostic: { code: 'node-not-found' } })
  expect(result.content).toBe(content)
  expect((findCompositionNode(content.root, 'source') as any).attributes.style).toBeUndefined()
})
