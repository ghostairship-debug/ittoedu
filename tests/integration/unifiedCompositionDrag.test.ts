// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { publishLayerItem } from '../../src/renderer/export/course/buildPublishedCourse'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionContentEdit } from '../../src/shared/composition/edit'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
type ContentNode = CompositionLayerItem['content']['root']
const element = (id: string, tagName: string, children: ContentNode[], attributes: Record<string, string> = {}): ContentNode =>
  ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): ContentNode => ({ id, kind: 'text', text: value })

function fixture(): CourseModel {
  const project = createBlankCourseProject({ canvas: { width: 1280, height: 800 }, includeDefaultController: false, controls: 'none' })
  const item: CompositionLayerItem = {
    layerItemId: 'drag-composition', kind: 'composition', label: 'Drag the actual content', locked: false,
    order: 0, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 800 },
    content: { doctype: '<!DOCTYPE html>', assets: {}, root: element('html', 'html', [
      element('head', 'head', [element('style', 'style', [text('css',
        'html,body{margin:0;font:18px sans-serif}body{position:relative;height:800px;background:white}'
        + '.cards{display:flex;gap:20px;padding:40px}.card{flex:0 0 220px;height:120px;box-sizing:border-box;padding:16px;background:#e9f2ff}'
        + '.runtime-slot{height:40px}h2{margin:0 0 12px;font-size:22px}',
      )])]),
      element('body', 'body', [
        element('cards', 'main', [
          element('auto-a', 'section', [
            element('a-title', 'h2', [text('a-text', 'Card A')]),
            element('runtime-slot', 'div', [{ id: 'counter', kind: 'runtime', runtime: {
              protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', content: { values: {} }, assets: {},
              source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
                const probe=window.__compositionDragProbe||(window.__compositionDragProbe={creates:0,destroys:0});probe.creates++;
                let count=0;const button=document.createElement('button');button.dataset.dragCounter='true';button.textContent='count:0';
                button.onclick=()=>button.textContent='count:'+ ++count;ctx.dom.root.append(button);
                return {resize(){},destroy(){probe.destroys++;button.remove()}};
              }})`,
            } }], { class: 'runtime-slot' }),
          ], { class: 'card' }),
          element('auto-b', 'section', [text('b-text', 'Card B')], { class: 'card' }),
          element('auto-c', 'section', [text('c-text', 'Card C')], { class: 'card' }),
        ], { class: 'cards' }),
        element('free', 'div', [text('free-text', 'Free content')], {
          style: 'position:absolute;left:80px;top:300px;width:240px;height:100px;box-sizing:border-box;background:#fff1cc;',
        }),
        element('transformed', 'div', [text('transformed-text', 'Source CSS transform')], {
          style: 'position:absolute;left:620px;top:420px;width:160px;height:90px;transform:rotate(6deg);background:#f1e7ff;',
        }),
      ]),
    ]) },
  }
  project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems.push(item)
  return { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
}

function composition(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw new Error('Expected formal course document')
  const item = locateCourseLayer(model.project, 'drag-composition')?.item
  if (item?.kind !== 'composition') throw new Error('Expected formal composition')
  return item
}

function view(model: DocumentModel) {
  if (model.kind !== 'course-v9') throw new Error('Expected formal course document')
  const item = composition(model)
  const published = publishLayerItem({ project: model.project, assetFiles: model.resources.assets, components: {} }, item)
  if (published.kind !== 'composition') throw new Error('Expected Published composition')
  return { item, content: published.content, projectId: model.project.id }
}

function sourceStyle(model: DocumentModel, nodeId: string): string {
  const node = findCompositionNode(composition(model).content.root, nodeId)
  if (node?.kind !== 'element') throw new Error(`Missing source element ${nodeId}`)
  return node.attributes.style ?? ''
}

function cardOrder(model: DocumentModel): string[] {
  const node = findCompositionNode(composition(model).content.root, 'cards')
  if (node?.kind !== 'element') throw new Error('Missing source cards')
  return node.children.map(child => child.id)
}

async function center(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('Gesture handle has no actual browser bounds')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => !(window as any).__dragHarness.pending)).toBe(true)
  await page.evaluate(async () => {
    await (window as any).CompositionDrag.waitForPublishedObservationReady(document.getElementById('host'))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function freeGeometry(page: Page) {
  return page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="free"]').evaluate(element => {
    const rect = element.getBoundingClientRect(), style = (element as HTMLElement).style
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      left: Number.parseFloat(style.left), top: Number.parseFloat(style.top),
      cssWidth: Number.parseFloat(style.width), cssHeight: Number.parseFloat(style.height) }
  })
}

it('U05 commits real composition drags once, converts a scaled viewport, retains Runtime, and reopens source CSS', async () => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-drag-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const driver = new CourseV9Driver()
    const persistence: DocumentPersistence = {
      async append() {},
      async save(input) {
        if (input.binding.kind !== 'file') throw new Error('Expected file save binding')
        await fs.writeFile(input.binding.path, input.bytes)
        return { ...input.binding, version: `revision-${input.revision}` }
      },
    }
    const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
    const initial = fixture(), session = await registry.create(initial, 'drag.h5lesson')
    const edits: CompositionContentEdit[] = []
    const operation = (snapshot: DocumentSnapshot, mutation: Parameters<typeof session.execute>[0]['mutation']) => ({
      documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const,
      baseRevision: snapshot.revision, mutation,
    })
    const bundle = (await build({
      stdin: { contents: `export {createElement} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';export {CompositionEditorDialog} from './src/renderer/composition/CompositionEditorDialog';export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture'`, resolveDir: process.cwd(), loader: 'tsx' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CompositionDrag',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"test"' },
    })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    try {
      await page.exposeFunction('commitCompositionDrag', async (edit: CompositionContentEdit) => {
        edits.push(structuredClone(edit))
        const result = await session.execute(operation(session.read(), { type: 'command', command: {
          type: 'composition.edit', layerItemId: 'drag-composition', edit,
        } }))
        expect(result).toMatchObject({ status: 'applied' })
        return view(session.read().model)
      })
      await page.setContent('<style>body{margin:0}</style><div id="host"></div>')
      await page.addScriptTag({ content: bundle })
      await page.evaluate(async initialView => {
        const w = window as any, api = w.CompositionDrag
        const host = document.getElementById('host')!, root = api.createRoot(host)
        const harness: any = { root, pending: false, errors: [], props: { ...initialView, assetUrls: {}, onClose() {} } }
        harness.render = () => api.flushSync(() => harness.root.render(api.createElement(api.CompositionEditorDialog, harness.props)))
        harness.apply = (next: any) => { Object.assign(harness.props, next); harness.render() }
        harness.props.onEdit = async (edit: any) => {
          harness.pending = true
          try {
            harness.apply(await w.commitCompositionDrag(edit))
            await api.waitForPublishedObservationReady(host)
          } catch (error) { harness.errors.push(String(error)); throw error }
          finally { harness.pending = false }
        }
        w.__dragHarness = harness
        harness.render()
        await api.waitForPublishedObservationReady(host)
        harness.iframe = host.querySelector('iframe[data-web-composition]')
        harness.button = harness.iframe.contentDocument.querySelector('[data-drag-counter]')
        if (!harness.button) throw new Error('Missing real Runtime button')
        harness.probe = harness.iframe.contentWindow.__compositionDragProbe
        // Authoring captures clicks. Seed state through the existing handler;
        // the gestures below use actual browser mouse input.
        harness.button.onclick.call(harness.button, new PointerEvent('click'))
      }, view(initial))
      await ready(page)
      const iframe = page.locator('iframe[data-web-composition]')
      const physicalFrame = await iframe.boundingBox()
      if (!physicalFrame) throw new Error('Missing actual scaled composition iframe')
      const scale = physicalFrame.width / composition(initial).frame.width
      expect(scale).toBeGreaterThan(0)
      expect(scale).toBeLessThan(1)
      expect(await iframe.evaluate(frame => (frame as HTMLIFrameElement).contentDocument!.documentElement.clientWidth)).toBe(1280)

      const selection = (nodeId: string) => page.locator(`[data-composition-selection="${nodeId}"]`)
      const select = async (nodeId: string) => {
        await page.getByLabel('内容对象', { exact: true }).selectOption(nodeId)
        await selection(nodeId).waitFor({ state: 'visible' })
        await ready(page)
      }
      const unchangedDuringMove = async (before: DocumentSnapshot, count: number) => {
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
        expect(edits).toHaveLength(count)
        expect(session.read()).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth })
      }
      const releasedOnce = async (before: DocumentSnapshot, count: number) => {
        await expect.poll(() => session.read().revision).toBe(before.revision + 1)
        await ready(page)
        expect(edits).toHaveLength(count + 1)
        expect(session.read().undoDepth).toBe(before.undoDepth + 1)
        expect(await page.evaluate(() => (window as any).__dragHarness.errors)).toEqual([])
      }

      await select('auto-a')
      expect(await selection('auto-a').getByRole('button', { name: '缩放内容', exact: true }).count()).toBe(0)
      const first = session.read(), start = await center(selection('auto-a').getByRole('button', { name: '拖动内容', exact: true }))
      const destination = await page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="auto-c"]').boundingBox()
      if (!destination) throw new Error('Missing actual automatic-layout sibling')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(destination.x + destination.width * .85, destination.y + destination.height / 2, { steps: 6 })
      await unchangedDuringMove(first, 0)
      await page.mouse.up()
      await releasedOnce(first, 0)
      expect(edits[0]).toMatchObject({ type: 'move', nodeId: 'auto-a', parentId: 'cards', index: 2 })
      expect(cardOrder(session.read().model)).toEqual(['auto-b', 'auto-c', 'auto-a'])
      expect(await page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="cards"]').evaluate(container =>
        [...container.children].map(child => child.getAttribute('data-composition-node')))).toEqual(['auto-b', 'auto-c', 'auto-a'])
      const movedCard = findCompositionNode(composition(session.read().model).content.root, 'auto-a')!
      expect(movedCard).toEqual(findCompositionNode(composition(initial).content.root, 'auto-a'))

      await select('free')
      const beforeMove = session.read(), beforeGeometry = await freeGeometry(page)
      const moveStart = await center(selection('free').getByRole('button', { name: '拖动内容', exact: true }))
      await page.mouse.move(moveStart.x, moveStart.y)
      await page.mouse.down()
      await page.mouse.move(moveStart.x + 96 * scale, moveStart.y + 48 * scale, { steps: 6 })
      await unchangedDuringMove(beforeMove, 1)
      await page.mouse.up()
      await releasedOnce(beforeMove, 1)
      expect(edits[1]).toMatchObject({ type: 'style', nodeId: 'free' })
      const afterMove = await freeGeometry(page)
      expect(afterMove.left).toBeCloseTo(beforeGeometry.left + 96, 0)
      expect(afterMove.top).toBeCloseTo(beforeGeometry.top + 48, 0)
      expect(afterMove.x).toBeCloseTo(beforeGeometry.x + 96, 0)
      expect(afterMove.y).toBeCloseTo(beforeGeometry.y + 48, 0)
      expect(afterMove.width).toBe(beforeGeometry.width)
      expect(afterMove.height).toBe(beforeGeometry.height)

      const beforeResize = session.read(), resizeStart = await center(selection('free').getByRole('button', { name: '缩放内容', exact: true }))
      await page.mouse.move(resizeStart.x, resizeStart.y)
      await page.mouse.down()
      await page.mouse.move(resizeStart.x + 120 * scale, resizeStart.y + 64 * scale, { steps: 6 })
      await unchangedDuringMove(beforeResize, 2)
      await page.mouse.up()
      await releasedOnce(beforeResize, 2)
      expect(edits[2]).toMatchObject({ type: 'style', nodeId: 'free' })
      const afterResize = await freeGeometry(page)
      expect(afterResize.cssWidth).toBeCloseTo(afterMove.cssWidth + 120, 0)
      expect(afterResize.cssHeight).toBeCloseTo(afterMove.cssHeight + 64, 0)
      expect(afterResize.width).toBeCloseTo(afterMove.width + 120, 0)
      expect(afterResize.height).toBeCloseTo(afterMove.height + 64, 0)
      expect(afterResize.left).toBe(afterMove.left)
      expect(afterResize.top).toBe(afterMove.top)
      expect(await session.execute(operation(session.read(), { type: 'undo' }))).toMatchObject({ status: 'applied' })
      expect(sourceStyle(session.read().model, 'free')).toBe(sourceStyle(beforeResize.model, 'free'))
      expect(session.read().undoDepth).toBe(2)
      await page.evaluate(next => (window as any).__dragHarness.apply(next), view(session.read().model))
      await ready(page)
      expect(await freeGeometry(page)).toEqual(afterMove)
      expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
      await page.evaluate(next => (window as any).__dragHarness.apply(next), view(session.read().model))
      await ready(page)
      expect(await freeGeometry(page)).toEqual(afterResize)

      // Chromium creates the trusted pointercancel from a cancelled touch input.
      // The gesture preview must never become a formal edit before release.
      const beforeCancel = session.read(), cancelStart = await center(selection('free').getByRole('button', { name: '拖动内容', exact: true }))
      await page.evaluate(() => document.addEventListener('pointercancel', event => {
        (window as any).__dragCancelTrusted = event.isTrusted
      }, { once: true, capture: true }))
      const cdp = await page.context().newCDPSession(page)
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancelStart.x, y: cancelStart.y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cancelStart.x + 40, y: cancelStart.y + 20 }] })
        await unchangedDuringMove(beforeCancel, 3)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      } finally { await cdp.detach() }
      await unchangedDuringMove(beforeCancel, 3)
      expect(await page.evaluate(() => (window as any).__dragCancelTrusted)).toBe(true)
      expect(await freeGeometry(page)).toEqual(afterResize)
      expect(sourceStyle(session.read().model, 'free')).toBe(sourceStyle(beforeCancel.model, 'free'))

      await select('transformed')
      const transformStatus = page.getByRole('status').filter({ hasText: 'CSS 变换' })
      await transformStatus.waitFor({ state: 'visible' })
      const disabledDrag = selection('transformed').getByRole('button', { name: '拖动内容', exact: true })
      expect(await disabledDrag.isDisabled()).toBe(true)
      expect(await selection('transformed').getByRole('button', { name: '缩放内容', exact: true }).isDisabled()).toBe(true)
      const transformBefore = session.read(), disabledStart = await center(disabledDrag)
      await page.mouse.move(disabledStart.x, disabledStart.y)
      await page.mouse.down()
      await page.mouse.move(disabledStart.x + 30, disabledStart.y + 15, { steps: 3 })
      await page.mouse.up()
      await unchangedDuringMove(transformBefore, 3)
      expect(sourceStyle(session.read().model, 'transformed')).toBe(sourceStyle(initial, 'transformed'))

      const retained = await page.evaluate(() => {
        const h = (window as any).__dragHarness, iframe = document.querySelector('iframe[data-web-composition]') as HTMLIFrameElement
        return { sameIframe: h.iframe === iframe, sameButton: h.button === iframe.contentDocument!.querySelector('[data-drag-counter]'),
          count: h.button.textContent, creates: h.probe.creates, destroys: h.probe.destroys }
      })
      expect(retained).toEqual({ sameIframe: true, sameButton: true, count: 'count:1', creates: 1, destroys: 0 })
      expect(composition(session.read().model).frame).toEqual(composition(initial).frame)
      const savedPath = path.join(rootDirectory, 'drag.h5lesson')
      await registry.save(session.documentId, { kind: 'file', path: savedPath, version: null, bindingVersion: 0 })
      expect(session.read().dirty).toBe(false)
      const reopened = driver.load(new Uint8Array(await fs.readFile(savedPath)))
      expect(cardOrder(reopened)).toEqual(['auto-b', 'auto-c', 'auto-a'])
      expect(sourceStyle(reopened, 'free')).toBe(sourceStyle(session.read().model, 'free'))
      expect(sourceStyle(reopened, 'transformed')).toBe(sourceStyle(initial, 'transformed'))
      expect(findCompositionNode(composition(reopened).content.root, 'counter')).toEqual(findCompositionNode(composition(initial).content.root, 'counter'))
      const closed = await page.evaluate(() => {
        const w = window as any, h = w.__dragHarness
        w.CompositionDrag.flushSync(() => h.root.unmount())
        return { destroys: h.probe.destroys, removed: !document.querySelector('iframe[data-web-composition]') }
      })
      expect(closed).toEqual({ destroys: 1, removed: true })
      await page.evaluate(async next => {
        const w = window as any, h = w.__dragHarness
        h.root = w.CompositionDrag.createRoot(document.getElementById('host'))
        h.apply(next)
        await w.CompositionDrag.waitForPublishedObservationReady(document.getElementById('host'))
      }, view(reopened))
      await ready(page)
      expect(await freeGeometry(page)).toEqual(afterResize)
      expect(await page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="cards"]').evaluate(container =>
        [...container.children].map(child => child.getAttribute('data-composition-node')))).toEqual(['auto-b', 'auto-c', 'auto-a'])
      const reopenedRuntime = await page.frameLocator('iframe[data-web-composition]').locator('[data-drag-counter]').evaluate(button => {
        const node = button as HTMLButtonElement, before = node.textContent
        node.onclick!.call(node, new PointerEvent('click'))
        return { before, after: node.textContent }
      })
      expect(reopenedRuntime).toEqual({ before: 'count:0', after: 'count:1' })
      await page.evaluate(() => {
        const w = window as any
        w.CompositionDrag.flushSync(() => w.__dragHarness.root.unmount())
      })
    } finally { await page.close() }
  } finally {
    await browser.close()
    const relative = path.relative(os.tmpdir(), rootDirectory)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected fixture directory')
    await fs.rm(rootDirectory, { recursive: true, force: true })
  }
}, 45_000)
