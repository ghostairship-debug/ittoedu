import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ElementAiButton } from '../../../src/renderer/workbench/elementCards/ElementAiCard'
import { ElementTextCardLayer } from '../../../src/renderer/workbench/elementCards/ElementTextCards'
import { elementCards } from '../../../src/renderer/workbench/elementCards/elementCardController'
import { SelectionQuickBar } from '../../../src/renderer/editing/quickbar/SelectionQuickBar'
import { createPublishedSurfaceRuntimeSession, mountPublishedSurfaceRuntime } from '../../../src/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { mapRuntimeAuthoringTargetsToLayer } from '../../../src/player/surfaces/slide/publishedSlideAuthoringPatch'
import { createHtmlDocumentRuntimeSource } from '../../../src/shared/runtime/htmlDocumentSource'
import type { PublishedRuntimeLayerItem } from '../../../src/shared/publishedCourseTypes'
import type { RuntimeAuthoringTarget } from '../../../src/shared/runtimeTypes'

let react: Root | null = null, dispose: (() => void) | null = null
function clear() {
  dispose?.(); dispose = null; react?.unmount(); react = null
  elementCards.forgetDocument('fixture'); document.body.replaceChildren()
  document.body.style.cssText = 'margin:0;background:#edf1f5;font:14px Arial'
}
const pause = () => new Promise(resolve => setTimeout(resolve, 30))
const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height })
const encode = (source: string) => {
  const bytes = new Uint8Array(source.length * 2)
  for (let i = 0; i < source.length; i++) { bytes[i * 2] = source.charCodeAt(i) & 255; bytes[i * 2 + 1] = source.charCodeAt(i) >>> 8 }
  return { encoding: 'base64-utf16le' as const, data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) }
}

async function runtime(input: { live: boolean; scale: number; partial: boolean }) {
  clear()
  const canvas = { width: 1024, height: 768 }
  const frame = input.partial ? { mode: 'absolute' as const, x: 90, y: 110, width: 640, height: 360 }
    : { mode: 'absolute' as const, x: 0, y: 0, ...canvas }
  const stage = document.createElement('div')
  stage.style.cssText = `position:absolute;left:40px;top:30px;width:1024px;height:768px;background:white;transform-origin:0 0;transform:scale(${input.scale})`
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;pointer-events:none`
  stage.append(host); document.body.append(stage)
  const key = 'a'.repeat(64)
  const asset = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="#245b46"/></svg>'], { type: 'image/svg+xml' }))
  const html = `<!doctype html><html><body style="margin:0"><span id="text" style="position:absolute;left:240px;top:145px;font:22px Arial">Target text</span><img id="image" src="cw-resource:${key}" style="position:absolute;left:430px;top:250px;width:80px;height:50px"></body></html>`
  const item = { layerItemId: 'html', kind: 'runtime', frame, rotation: 0,
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      code: encode(createHtmlDocumentRuntimeSource({ html, resourceKeys: [key] })),
      content: { values: {} }, assets: { [key]: { assetId: 'hero' } } } } as PublishedRuntimeLayerItem
  let targets: readonly Readonly<RuntimeAuthoringTarget>[] = []
  const publish: NonNullable<Parameters<typeof mountPublishedSurfaceRuntime>[1]['authoring']> = {
    scope: 'scene', sceneId: 'scene', onTargetsChanged: update => { targets = mapRuntimeAuthoringTargetsToLayer(update, item, canvas).targets },
  }
  const session = createPublishedSurfaceRuntimeSession()
  const handle = mountPublishedSurfaceRuntime(host, { instanceId: 'fixture', runtime: item.runtime, ...frame, canvas,
    visible: true, session, resolveAsset: () => asset, mode: input.live ? 'playback' : 'authoring',
    ...(input.live ? {} : { authoring: publish }) })
  dispose = () => { handle.destroy(); session.destroy(); URL.revokeObjectURL(asset) }
  await handle.waitForObservationReady?.()
  if (input.live) { handle.suspend(); handle.startLiveEdit?.({ sceneId: 'scene', onTargetsChanged: publish.onTargetsChanged }) }
  for (let i = 0; targets.length < 2 && i < 70; i++) await pause()
  if (targets.length < 2) throw new Error('No observed Runtime targets')
  const iframe = host.querySelector('iframe')!, inner = iframe.contentDocument!
  const results = []
  for (const kind of ['text', 'asset']) {
    const target = targets.find(value => value.kind === kind)!
    const hit = document.createElement('button'); hit.dataset.hit = kind
    hit.style.cssText = `position:absolute;padding:0;border:1px solid #2684ff;background:transparent;left:${target.bounds.x}px;top:${target.bounds.y}px;width:${target.bounds.width}px;height:${target.bounds.height}px`
    hit.onclick = () => { document.body.dataset.hit = kind }
    stage.append(hit)
    let local: DOMRect
    if (kind === 'text') { const range = inner.createRange(); range.selectNodeContents(inner.getElementById('text')!); local = range.getBoundingClientRect() }
    else local = inner.getElementById('image')!.getBoundingClientRect()
    const f = iframe.getBoundingClientRect(), sx = f.width / iframe.clientWidth, sy = f.height / iframe.clientHeight
    results.push({ kind, actual: { x: f.x + local.x * sx, y: f.y + local.y * sy, width: local.width * sx, height: local.height * sy }, hit: box(hit.getBoundingClientRect()) })
  }
  return results
}

function card(kind: 'element' | 'text') {
  clear()
  const target = { kind: 'course-object' as const, locationId: 'scene', itemId: 'title' }
  const key = kind === 'element' ? elementCards.ensure({ documentId: 'fixture', target, label: 'Card fixture' })
    : elementCards.openText({ documentId: 'fixture', target, label: 'Card fixture', content: 'text', anchor: { left: 30, top: 120 } })
  // Only the view state is seeded. The production component and all layout rules render unchanged.
  const record = (elementCards as unknown as { cards: Map<string, { entries: unknown[]; error: string }> }).cards.get(key)!
  record.entries = Array.from({ length: 12 }, (_, index) => ({ submissionId: `s-${index}`, text: `Request ${index}`, state: 'completed',
    reply: 'Long response and preserved history. '.repeat(20) }))
  record.error = 'A diagnostic that must not move the composer. '.repeat(6)
  const mount = document.createElement('div'); document.body.append(mount); react = createRoot(mount)
  flushSync(() => react!.render(kind === 'text' ? h(ElementTextCardLayer) : h(SelectionQuickBar, {
    anchor: { left: 40, top: window.innerHeight * .55, width: 100, height: 20 },
    bounds: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, label: 'Fixture',
    children: h(ElementAiButton, { documentId: 'fixture', target, label: 'Card fixture', capture: async () => { throw new Error('Layout fixture never sends') } }),
  })))
}
Reflect.set(window, 'repairFixture', { runtime, card })
