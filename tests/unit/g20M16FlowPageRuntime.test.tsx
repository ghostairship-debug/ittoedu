import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowPageRuntime } from '@/renderer/ui/flow/FlowPageRuntime'
import { projectFlowRuntimeForAuthoring } from '@/renderer/document/flowRuntimeSpaceProjection'
import { createPublishedSurfaceRuntimeSession, mountPublishedSurfaceRuntime } from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const makeSource = (text: string) => `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
  const p = document.createElement('p'); p.textContent = ctx.content.get('title') + '${text}';
  ctx.dom.root.appendChild(p);
  const img = document.createElement('img'); img.src = ctx.assets.url('hero'); ctx.dom.root.appendChild(img);
  return {destroy(){ctx.dom.root.replaceChildren()}, resize(w,h){ctx.dom.root.dataset.size = w + 'x' + h}};
}})`

function item(source: string): RuntimeLayerItem {
  return {
    layerItemId: 'runtime-1', label: 'Page', kind: 'runtime',
    frame: { mode: 'absolute', x: 0, y: 0, width: 640, height: 400 }, order: 1,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true,
      renderMode: 'dom', source, content: { values: { title: 'Lesson ' } },
      assets: { hero: { assetId: 'image-1' } } },
  }
}

const mounted: Array<{ root: Root; frame: HTMLIFrameElement }> = []
afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount())
    entry.frame.remove()
  }
})

it('projects source for the Published API 3 mount while sharing V9 content and asset bindings', () => {
  const layer = item(makeSource('one'))
  const projected = projectFlowRuntimeForAuthoring(layer)
  expect(projected.code.encoding).toBe('base64-utf16le')
  expect(projected.content).not.toBe(layer.runtime.content)
  expect(projected.assets).not.toBe(layer.runtime.assets)
  projected.content.values.title = 'Runtime-only '
  projected.assets.hero!.assetId = 'different-image'
  expect(layer.runtime.content.values.title).toBe('Lesson ')
  expect(layer.runtime.assets.hero!.assetId).toBe('image-1')
})

it('keeps the V9 document unchanged when the Runtime host edits its execution snapshot', () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const layer = item(makeSource('one'))
  const projected = projectFlowRuntimeForAuthoring(layer)
  const session = createPublishedSurfaceRuntimeSession()
  const handle = mountPublishedSurfaceRuntime(container, {
    instanceId: layer.layerItemId, runtime: projected, width: 640, height: 400,
    visible: true, mode: 'authoring', session, resolveAsset: () => 'data:image/png;base64,SEVSTw==',
  })
  expect(handle.ok).toBe(true)
  handle.applyAuthoringContentValue('title', 'Runtime-only ')
  expect(projected.content.values.title).toBe('Runtime-only ')
  expect(layer.runtime.content.values.title).toBe('Lesson ')
  handle.destroy()
  session.destroy()
  frame.remove()
})

it('runs the real authoring Runtime, updates size in place, and retires stale source and targets', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect
  const view = frame.contentWindow as Window & typeof globalThis
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 600, 500) })
  Object.defineProperty(view.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 20, 120, 25) })
  const root = createRoot(container)
  mounted.push({ root, frame })
  const updates: RuntimeAuthoringTargetUpdate[] = []
  const onTargetsChanged = (update: Readonly<RuntimeAuthoringTargetUpdate>) => updates.push(update)
  const onHeightChange = vi.fn()
  const first = item(makeSource('one'))
  const props = { surfaceId: 'flow-1', assetUrls: { 'image-1': 'data:image/png;base64,SEVSTw==' }, onTargetsChanged, onHeightChange }
  await act(async () => root.render(<FlowPageRuntime {...props} item={first} width={640} height={400} />))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const paragraph = container.querySelector('p')
  expect(paragraph?.textContent).toBe('Lesson one')
  expect(container.querySelector('img')?.getAttribute('src')).toBe(props.assetUrls['image-1'])
  expect(updates.flatMap(update => update.targets)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', source: 'auto' }),
    expect.objectContaining({ kind: 'asset', source: 'auto', key: 'hero' }),
  ]))
  await act(async () => root.render(<FlowPageRuntime {...props} item={first} width={600} height={500} />))
  expect(container.querySelector('p')).toBe(paragraph)
  expect(container.querySelector('[data-surface-runtime-root]')?.getAttribute('data-size')).toBe('600x500')
  const edited = item(makeSource('one'))
  edited.runtime.content.overrides = [{ original: 'Lesson one', region: 'p', text: 'Edited lesson' }]
  await act(async () => root.render(<FlowPageRuntime {...props} item={edited} width={600} height={500} />))
  expect(container.querySelector('p')).toBe(paragraph)
  expect(paragraph?.textContent).toBe('Edited lesson')
  expect(first.runtime.content.overrides).toBeUndefined()
  const changedValue = item(makeSource('one'))
  changedValue.runtime.content.values.title = 'New title '
  await act(async () => root.render(<FlowPageRuntime {...props} item={changedValue} width={600} height={500} />))
  expect(container.querySelector('p')).not.toBe(paragraph)
  expect(container.querySelector('p')?.textContent).toBe('New title one')
  const second = item(makeSource('two'))
  await act(async () => root.render(<FlowPageRuntime {...props} item={second} width={600} height={500} />))
  expect(container.querySelector('p')?.textContent).toBe('Lesson two')
  expect(updates).toContainEqual(expect.objectContaining({ sceneId: 'flow-1', targets: [] }))
  await act(async () => root.unmount())
  mounted.pop()
  frame.remove()
  expect(container.querySelector('[data-surface-runtime-root]')).toBeNull()
})

it('remounts when a managed asset URL becomes ready or rotates, without remounting for unrelated assets', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, frame })
  const layer = item(makeSource('asset'))
  const urlA = 'data:image/png;base64,SEVSTw=='
  const urlB = 'data:image/png;base64,U0VDT05E'
  const base = { item: layer, surfaceId: 'flow-1', width: 640, height: 400, onHeightChange: vi.fn() }
  const onError = vi.fn()
  await act(async () => root.render(<FlowPageRuntime {...base} assetUrls={{}} onError={onError} />))
  expect(container.querySelector('p')).toBeNull()
  expect(onError).toHaveBeenCalledWith('create', expect.any(Error))

  await act(async () => root.render(<FlowPageRuntime {...base} assetUrls={{ 'image-1': urlA }} onError={onError} />))
  const firstParagraph = container.querySelector('p')
  expect(firstParagraph?.textContent).toBe('Lesson asset')
  expect(container.querySelector('img')?.getAttribute('src')).toBe(urlA)

  await act(async () => root.render(<FlowPageRuntime {...base} assetUrls={{ 'image-1': urlA, unrelated: urlB }} onError={onError} />))
  expect(container.querySelector('p')).toBe(firstParagraph)

  await act(async () => root.render(<FlowPageRuntime {...base} assetUrls={{ 'image-1': urlB }} onError={onError} />))
  expect(container.querySelector('p')).not.toBe(firstParagraph)
  expect(container.querySelector('img')?.getAttribute('src')).toBe(urlB)
})

it('tracks an unbound projectUrl read without a spurious remount on the next render', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, frame })
  const layer = item(`CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
    const img=document.createElement('img'); img.src=ctx.assets.projectUrl('unbound-id');
    ctx.dom.root.appendChild(img); return {destroy(){ctx.dom.root.replaceChildren()}};
  }})`)
  layer.runtime.assets = {}
  const urlA = 'data:image/png;base64,SEVSTw=='
  const urlB = 'data:image/png;base64,U0VDT05E'
  const base = { item: layer, surfaceId: 'flow-1', onHeightChange: vi.fn(), width: 640 }
  await act(async () => root.render(<FlowPageRuntime {...base} height={400} assetUrls={{ 'unbound-id': urlA }} />))
  const image = container.querySelector('img')
  expect(image?.getAttribute('src')).toBe(urlA)
  await act(async () => root.render(<FlowPageRuntime {...base} height={450} assetUrls={{ 'unbound-id': urlA }} />))
  expect(container.querySelector('img')).toBe(image)
  await act(async () => root.render(<FlowPageRuntime {...base} height={450} assetUrls={{ 'unbound-id': urlB }} />))
  expect(container.querySelector('img')).not.toBe(image)
  expect(container.querySelector('img')?.getAttribute('src')).toBe(urlB)
})

it('clears targets through the old mount owner when the document owner changes', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const container = frame.contentDocument!.createElement('div')
  frame.contentDocument!.body.append(container)
  const view = frame.contentWindow as Window & typeof globalThis
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect
  Object.defineProperty(view.HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0, 640, 400) })
  Object.defineProperty(view.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 20, 120, 25) })
  const root = createRoot(container)
  mounted.push({ root, frame })
  const oldUpdates: RuntimeAuthoringTargetUpdate[] = []
  const newUpdates: RuntimeAuthoringTargetUpdate[] = []
  const base = { item: item(makeSource('owner')), surfaceId: 'flow-1', width: 640, height: 400,
    assetUrls: { 'image-1': 'data:image/png;base64,SEVSTw==' }, onHeightChange: vi.fn() }
  await act(async () => root.render(<FlowPageRuntime {...base} ownerKey="owner-a"
    onTargetsChanged={update => oldUpdates.push(update)} />))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(oldUpdates.flatMap(update => update.targets).length).toBeGreaterThan(0)
  await act(async () => root.render(<FlowPageRuntime {...base} ownerKey="owner-b"
    onTargetsChanged={update => newUpdates.push(update)} />))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(oldUpdates.at(-1)?.targets).toEqual([])
  expect(newUpdates.flatMap(update => update.targets).length).toBeGreaterThan(0)
  expect(newUpdates.every(update => update.targets.length > 0)).toBe(true)
})
