import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowPageRuntime } from '@/renderer/ui/flow/FlowPageRuntime'
import { projectFlowRuntimeForAuthoring } from '@/renderer/document/flowRuntimeSpaceProjection'
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
  expect(projected.content).toBe(layer.runtime.content)
  expect(projected.assets).toBe(layer.runtime.assets)
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
