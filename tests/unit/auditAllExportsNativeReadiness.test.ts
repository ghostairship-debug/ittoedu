// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTextComponentData } from '../../src/components/text/data'
import { createVideoData } from '../../src/components/media/data'
import type { ComponentRuntimeScope, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { textRuntimeImplementation } from '../../src/components/text/runtime'
import type { createComponentSpatialAdapter, createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import type { createVideoRuntimeImplementation } from '../../src/components/media/runtime'
import type { waitForPublishedObservationReady } from '../../src/player/surfaces/publishedCapture'
import type { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import type { applyComponentPaintStyle } from '../../src/player/components/componentPlacementStyle'

type ProbeApi = { textRuntimeImplementation: typeof textRuntimeImplementation; createComponentSpatialAdapter: typeof createComponentSpatialAdapter;
  createComponentSpatialCameraPort: typeof createComponentSpatialCameraPort; createVideoRuntimeImplementation: typeof createVideoRuntimeImplementation;
  waitForPublishedObservationReady: typeof waitForPublishedObservationReady; resolveComponentOuterPresentation: typeof resolveComponentOuterPresentation;
  applyComponentPaintStyle: typeof applyComponentPaintStyle }
let browser: Browser, bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `export {textRuntimeImplementation} from './src/components/text/runtime';
    export {createComponentSpatialAdapter,createComponentSpatialCameraPort} from './src/player/surfaces/spatial/componentSpatialAdapter';
    export {createVideoRuntimeImplementation} from './src/components/media/runtime';
    export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    export {resolveComponentOuterPresentation} from './src/shared/componentPresentation';
    export {applyComponentPaintStyle} from './src/player/components/componentPlacementStyle';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'auditNative', platform: 'browser' })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

it('GUI free-frame stage honours wrapper padding without shifting child world coordinates or author data', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await page.setContent('<body style="margin:0"><div id="world" style="position:absolute;transform-origin:0 0;transform:scale(2.782608695652174)"></div></body>')
    await page.addScriptTag({ content: bundle })
    const data = createTextComponentData('站点一：观察\n电压 6 V，电阻 20 Ω。'); data.appearance.fontSize = 33
    const result = await page.evaluate(async data => {
      const api = (window as unknown as { auditNative: ProbeApi }).auditNative, world = document.getElementById('world')!, zoom = 1280 / 460
      const project: CourseProjectV10 = { schemaVersion: 10, id: 'gui-padding', revision: 0, title: 'GUI', assets: {}, global: { underlay: [], overlay: [] },
        definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
        instances: { station: { id: 'station', definitionId: 'text', data: JSON.parse(JSON.stringify(data)), frame: { width: 460, height: 210, transform: [1, 0, 0, 1, 0, 0] },
          style: { background: '#ecfdf5', border: '2px solid #10b981', padding: '18px' }, childIds: ['child'] },
          child: { id: 'child', definitionId: 'text', data: {}, frame: { width: 5, height: 5, transform: [1, 0, 0, 1, 12, 8] } } },
        surfaces: [{ id: 'space', kind: 'spatial', title: 'GUI', childIds: ['station'] }] }
      const before = JSON.stringify(project), instance = project.instances.station!, presentation = api.resolveComponentOuterPresentation(project, instance, { placement: 'free', purpose: 'playback', inlineSize: 460 })
      const outer = document.createElement('div'), stage = document.createElement('div'), root = document.createElement('div'), children = document.createElement('div'), child = document.createElement('div')
      api.applyComponentPaintStyle(outer, instance, project.definitions.text)
      Object.assign(outer.style, presentation.outerStyle); Object.assign(stage.style, presentation.stageStyle)
      Object.assign(root.style, presentation.contentStyle); Object.assign(children.style, presentation.childrenStyle)
      const childPresentation = api.resolveComponentOuterPresentation(project, project.instances.child!, { placement: 'free', purpose: 'playback', inlineSize: 5 })
      Object.assign(child.style, childPresentation.outerStyle)
      children.append(child); stage.append(root, children); outer.append(stage); world.append(outer)
      const scope: ComponentRuntimeScope = { instanceId: 'station', generation: 1, runScopeId: 'probe', signal: new AbortController().signal, isActive: () => true,
        cleanup() {}, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit() {}, subscribe: () => () => {} } }
      const mounted = await api.textRuntimeImplementation.mount({ instance, root, scope,
        layout: { read: () => presentation.layoutInput, subscribe: () => () => {}, reportSize() {} } })
      await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const box = outer.getBoundingClientRect(), content = root.getBoundingClientRect(), childBox = child.getBoundingClientRect(), text = root.querySelector<HTMLElement>('[data-text-component]')!
      const result = { inset: { x: (content.left - box.left) / zoom, y: (content.top - box.top) / zoom }, width: root.clientWidth, height: root.clientHeight,
        textWidth: text.style.width, child: { x: (childBox.left - box.left) / zoom, y: (childBox.top - box.top) / zoom }, unchanged: before === JSON.stringify(project) }
      await mounted.dispose(); return result
    }, data)
    expect(result.inset.x).toBeCloseTo(20, 3); expect(result.inset.y).toBeCloseTo(20, 3)
    expect(result.width).toBe(420); expect(result.height).toBe(170); expect(result.textWidth).toBe('420px')
    expect(result.child.x).toBeCloseTo(14, 3); expect(result.child.y).toBeCloseTo(10, 3); expect(result.unchanged).toBe(true)
  } finally { await page.close() }
})

it('Spatial runtime measures the actual padded content box while preserving formal frame, camera and child coordinates', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await page.setContent('<body style="margin:0"><div id="root" style="position:relative;width:1280px;height:720px;overflow:hidden"></div></body>')
    await page.addScriptTag({ content: bundle })
    const data = createTextComponentData('站点二：计算\n电流 I = 6 / 20 = 0.3 A。')
    Object.assign(data.appearance, { fontSize: 33, fontFamily: 'sans-serif', padding: 0 })
    const result = await page.evaluate(async data => {
      const api = (window as unknown as { auditNative: ProbeApi }).auditNative
      const abort = new AbortController(), events: unknown[] = []
      const scope: ComponentRuntimeScope = { instanceId: 'station', generation: 1, runScopeId: 'probe', signal: abort.signal, isActive: () => !abort.signal.aborted,
        cleanup() {}, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit(_name, value) { events.push(value) }, subscribe: () => () => {} } }
      const project: CourseProjectV10 = { schemaVersion: 10, id: 'probe', revision: 0, title: 'Spatial', assets: {}, global: { underlay: [], overlay: [] },
        definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
        instances: { station: { id: 'station', definitionId: 'text', data: JSON.parse(JSON.stringify(data)), frame: { width: 460, height: 210, transform: [1, 0, 0, 1, 70, 185] },
          style: { background: '#ecfdf5', border: '2px solid #10b981', padding: '18px', borderRadius: '16px' }, childIds: ['child'] },
          child: { id: 'child', definitionId: 'text', data: {}, frame: { width: 5, height: 5, transform: [1, 0, 0, 1, 12, 8] } } },
        surfaces: [{ id: 'space', kind: 'spatial', title: 'Spatial', childIds: ['station'] }] }
      const before = JSON.stringify(project), camera = api.createComponentSpatialCameraPort({ x: 300, y: 290, zoom: 1280 / 460 })
      const roots = new Map<string, HTMLElement>(), adapter = api.createComponentSpatialAdapter({ container: document.getElementById('root')!, camera,
        onElement: (id, root) => { if (root) roots.set(id, root) } })
      adapter.sync(project, 'space')
      const instance = project.instances.station!, root = roots.get('station')!
      const mounted = await api.textRuntimeImplementation.mount({ instance, root, scope,
        layout: { read: () => ({ mode: 'free-frame', inlineSize: 460, blockSize: 210 }), subscribe: () => () => {}, reportSize() {} } })
      await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const outer = root.parentElement!, text = root.querySelector<HTMLElement>('[data-text-component]')!, content = text.querySelector('[data-text-component-content]')!
      const range = document.createRange(); range.selectNodeContents(content)
      const rect = (value: DOMRect) => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height })
      const result = { outer: rect(outer.getBoundingClientRect()), content: rect(root.getBoundingClientRect()), text: rect(text.getBoundingClientRect()), glyphs: rect(range.getBoundingClientRect()),
        localWidth: root.clientWidth, localHeight: root.clientHeight, childOffset: (roots.get('child')!.parentElement!.getBoundingClientRect().left - outer.getBoundingClientRect().left) / camera.read().zoom,
        camera: camera.read(), events, unchanged: before === JSON.stringify(project) }
      await mounted.dispose(); adapter.dispose(); camera.dispose()
      return result
    }, data)
    expect(result.localWidth).toBe(420); expect(result.localHeight).toBe(170)
    expect(result.glyphs.left).toBeGreaterThan(result.outer.left)
    expect(result.glyphs.right).toBeLessThan(result.outer.right)
    expect(result.text.right).toBeLessThan(result.outer.right)
    expect(result.childOffset).toBeCloseTo(14, 3)
    expect(result.camera).toEqual({ x: 300, y: 290, zoom: 1280 / 460 }); expect(result.unchanged).toBe(true)
    expect(result.events).toContainEqual(expect.objectContaining({ width: 460, height: 210 }))
  } finally { await page.close() }
})

it('visible video capture waits for actual decoding and authored poster seek; hidden failed peers do not block', async () => {
  const page = await browser.newPage()
  let deliver!: () => void
  const gate = new Promise<void>(resolve => { deliver = resolve })
  await page.route('https://media.test/video.webm', async route => {
    await gate
    const bytes = readFileSync('tests/fixtures/r18CommonTasks/materials/motion.webm'), range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '')
    const start = Number(range?.[1] ?? 0), end = range?.[2] ? Number(range[2]) : bytes.length - 1, body = bytes.subarray(start, end + 1)
    await route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', body,
      headers: { 'accept-ranges': 'bytes', 'content-length': String(body.length), ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) } })
  })
  await page.route('https://media.test/missing.webm', route => route.fulfill({ status: 404, body: '' }))
  try {
    await page.setContent('<body><div id="video" style="width:400px;height:240px"></div><div id="hidden" hidden></div></body>')
    await page.addScriptTag({ content: bundle })
    const data = createVideoData('video'); data.poster.time = 1
    await page.evaluate(async data => {
      const api = (window as unknown as { auditNative: ProbeApi }).auditNative
      const scope = (id: string): ComponentRuntimeScope => ({ instanceId: id, generation: 1, runScopeId: 'probe', signal: new AbortController().signal, isActive: () => true,
        cleanup() {}, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit() {}, subscribe: () => () => {} } })
      const implementation = api.createVideoRuntimeImplementation({ resolveAssetUrl: id => `https://media.test/${id}.webm`, isPlaying: () => false })
      await implementation.mount({ instance: { id: 'video', definitionId: 'video', data }, scope: scope('video'), root: document.getElementById('video')! })
      await implementation.mount({ instance: { id: 'missing', definitionId: 'video', data: { ...data, assetId: 'missing' } }, scope: scope('missing'), root: document.getElementById('hidden')! })
      document.body.dataset.ready = 'waiting'
      void api.waitForPublishedObservationReady(document.body).then(() => { document.body.dataset.ready = 'decoded' }, error => { document.body.dataset.ready = String(error) })
    }, data)
    expect(await page.evaluate(() => ({ status: document.body.dataset.ready, state: document.querySelector('video')!.readyState }))).toEqual({ status: 'waiting', state: 0 })
    deliver()
    await page.waitForFunction(() => document.body.dataset.ready !== 'waiting')
    const result = await page.evaluate(() => { const video = document.querySelector('video')!; return { status: document.body.dataset.ready, state: video.readyState,
      seeking: video.seeking, time: video.currentTime, paused: video.paused, width: video.videoWidth, preload: video.preload } })
    expect(result.status).toBe('decoded'); expect(result.state).toBeGreaterThanOrEqual(2); expect(result.seeking).toBe(false)
    expect(result.time).toBeCloseTo(1, 2); expect(result.paused).toBe(true); expect(result.width).toBeGreaterThan(0); expect(result.preload).toBe('metadata')
    mkdirSync(resolve('output/audit-real-machine-20261011/native-readiness'), { recursive: true })
    await page.screenshot({ path: resolve('output/audit-real-machine-20261011/native-readiness/decoded-video.png') })
  } finally { deliver(); await page.close() }
})

it('video stop cancels pending readiness and removes temporary listeners; decoding failures remain located failures', async () => {
  const page = await browser.newPage()
  await page.route('https://media.test/pending.webm', route => route.abort())
  try {
    await page.setContent('<body><div id="video"></div></body>'); await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async data => {
      const api = (window as unknown as { auditNative: ProbeApi }).auditNative, abort = new AbortController()
      const scope: ComponentRuntimeScope = { instanceId: 'video', generation: 1, runScopeId: 'probe', signal: abort.signal, isActive: () => !abort.signal.aborted,
        cleanup() {}, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit() {}, subscribe: () => () => {} } }
      const root = document.getElementById('video')!, implementation = api.createVideoRuntimeImplementation({ resolveAssetUrl: () => 'https://media.test/pending.webm', isPlaying: () => false })
      const mounted = await implementation.mount({ instance: { id: 'video', definitionId: 'video', data }, scope, root }), video = root.querySelector('video')!
      const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>(), add = video.addEventListener.bind(video), remove = video.removeEventListener.bind(video)
      video.addEventListener = (name: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => { if (!listener) return; const set = listeners.get(name) ?? new Set<EventListenerOrEventListenerObject>(); set.add(listener); listeners.set(name, set); add(name, listener, options) }
      video.removeEventListener = (name: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => { if (!listener) return; listeners.get(name)?.delete(listener); remove(name, listener, options) }
      const wait = api.waitForPublishedObservationReady(root).then(() => 'incorrect success', error => String(error))
      abort.abort(); await mounted.dispose()
      return { message: await wait, listeners: [...listeners.values()].reduce((count, set) => count + set.size, 0), empty: root.childElementCount }
    }, createVideoData('pending'))
    expect(result.message).toContain('取消'); expect(result.listeners).toBe(0); expect(result.empty).toBe(0)
    await page.setContent('<body><div id="video"></div></body>'); await page.addScriptTag({ content: bundle })
    await page.route('https://media.test/bad.webm', route => route.fulfill({ contentType: 'video/webm', body: 'not a video' }))
    const failed = await page.evaluate(async data => {
      const api = (window as unknown as { auditNative: ProbeApi }).auditNative, scope: ComponentRuntimeScope = { instanceId: 'video', generation: 1, runScopeId: 'probe', signal: new AbortController().signal, isActive: () => true,
        cleanup() {}, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit() {}, subscribe: () => () => {} } }
      const root = document.getElementById('video')!, mounted = await api.createVideoRuntimeImplementation({ resolveAssetUrl: () => 'https://media.test/bad.webm', isPlaying: () => false })
        .mount({ instance: { id: 'video', definitionId: 'video', data }, scope, root })
      try { await api.waitForPublishedObservationReady(root); return 'incorrect success' } catch (error) { return String(error) } finally { await mounted.dispose() }
    }, createVideoData('bad'))
    expect(failed).toContain('bad'); expect(failed).toContain('无法加载或解码')
  } finally { await page.close() }
})
