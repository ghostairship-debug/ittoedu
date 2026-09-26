import { expect, it } from 'vitest'
import { createPublishedSurfaceRuntimeSession, mountPublishedSurfaceRuntime } from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import type { PublishedRuntimeLayerItem } from '@/shared/publishedCourseTypes'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

// M15: a Surface Runtime (API 3) registers nothing; the host finds its text and pictures and applies its text rules.
function encodeSource(source: string): PublishedRuntimeLayerItem['runtime']['code'] {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); bytes[index * 2] = code & 0xff; bytes[index * 2 + 1] = code >>> 8 }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}
const SOURCE = `
  CoursewareRuntime.define({
    runtimeApiVersion: 3,
    create(ctx) {
      ctx.dom.root.innerHTML = '<main><h2>听力练习</h2><p>说明文字</p><img alt=""></main>';
      ctx.dom.root.querySelector('img').setAttribute('src', ctx.assets.url('hero'));
      return { destroy: function () { ctx.dom.root.innerHTML = ''; } };
    }
  });
`
const runtime = (overrides?: PublishedRuntimeLayerItem['runtime']['content']['overrides']): PublishedRuntimeLayerItem['runtime'] => ({
  protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: encodeSource(SOURCE),
  content: { values: {}, ...(overrides ? { overrides } : {}) }, assets: { hero: { assetId: 'asset-hero' } },
})
const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
const HERO = 'data:image/png;base64,SEVSTw=='

function realm() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const view = frame.contentWindow as (Window & typeof globalThis) | null
  if (!view || !frame.contentDocument) throw new Error('JSDOM iframe realm unavailable')
  // jsdom has no layout: every element measures the whole Runtime, every text one fixed box.
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 640, 360) })
  Object.defineProperty(view.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const container = frame.contentDocument.createElement('div')
  frame.contentDocument.body.append(container)
  return { frame, container }
}

it('M15 a Surface Runtime shows its text rules in playback and publishes its own text and pictures while authoring', async () => {
  const rules = [{ original: '听力练习', region: 'main>h2', text: '听力训练' }]
  const playback = realm()
  const session = createPublishedSurfaceRuntimeSession()
  const played = mountPublishedSurfaceRuntime(playback.container, { instanceId: 'play', runtime: runtime(rules), width: 640, height: 360, visible: true,
    resolveAsset: assetId => assetId === 'asset-hero' ? HERO : undefined, session })
  await played.waitForReady()
  expect(playback.container.querySelector('h2')!.textContent).toBe('听力训练')
  played.destroy()

  const authoring = realm()
  const updates: RuntimeAuthoringTargetUpdate[] = []
  const handle = mountPublishedSurfaceRuntime(authoring.container, { instanceId: 'edit', runtime: runtime(rules), width: 640, height: 360, visible: true, mode: 'authoring',
    resolveAsset: assetId => assetId === 'asset-hero' ? HERO : undefined, session, authoring: { scope: 'scene', sceneId: 'scene-1', onTargetsChanged: update => updates.push(update) } })
  await handle.waitForReady()
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(updates.at(-1)!.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', source: 'auto', key: '', label: '听力训练', lightEdit: { original: '听力练习', region: 'main>h2', text: '听力训练' } }),
    expect.objectContaining({ kind: 'text', source: 'auto', lightEdit: expect.objectContaining({ original: '说明文字' }) }),
    expect.objectContaining({ kind: 'asset', source: 'auto', key: 'hero' }),
  ]))
  // Undoing the rule applies in place: the Runtime is not recreated.
  const heading = authoring.container.querySelector('h2')!
  expect(handle.applyAuthoringTextOverrides([])).toBe(true)
  expect(authoring.container.querySelector('h2')).toBe(heading)
  expect(heading.textContent).toBe('听力练习')
  handle.destroy()
  session.destroy()
  playback.frame.remove(); authoring.frame.remove()
})
