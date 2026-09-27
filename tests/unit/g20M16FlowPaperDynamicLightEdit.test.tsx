import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowPaperDynamicLightEdit } from '@/renderer/ui/flow/FlowPaperDynamicLightEdit'
import type { ComponentLayerItem, RuntimeLayerItem } from '@/shared/courseProjectTypes'

const mocks = vi.hoisted(() => ({
  runtimeProps: null as any,
  componentProps: null as any,
  captureText: vi.fn(() => ({ kind: 'text', itemId: 'card-1' })),
  writeText: vi.fn(() => ({ ok: true, status: 'updated' })),
  captureAsset: vi.fn(() => ({ kind: 'asset', itemId: 'card-1' })),
  replaceAsset: vi.fn(() => ({ ok: true, status: 'updated' })),
  captureRuntimeText: vi.fn((_session: any) => ({ initialValue: 'Before', courseTarget: { itemId: 'runtime-1' } })),
  updateRuntimeText: vi.fn(() => ({ ok: true, status: 'updated' })),
  captureRuntimeAsset: vi.fn((_session: any) => ({ courseTarget: { itemId: 'runtime-1' } })),
  replaceRuntimeAsset: vi.fn(() => ({ ok: true, status: 'replaced' })),
  recapture: vi.fn(),
}))
vi.mock('@/renderer/ui/flow/FlowPageRuntime', () => ({ FlowPageRuntime: (props: any) => { mocks.runtimeProps = props; return <div data-testid="runtime-mount" /> } }))
vi.mock('@/renderer/ui/flow/FlowPageComponent', () => ({ FlowPageComponent: (props: any) => { mocks.componentProps = props; return <div data-testid="component-mount" /> } }))
vi.mock('@/renderer/ui/CanvasPlainTextEditor', () => ({ CanvasPlainTextEditor: (props: any) => <button data-testid="commit-text" onClick={() => props.onCommit('Edited')}>commit</button> }))
vi.mock('@/renderer/composition/runtime/flowDynamicLightEditCommands', () => ({ flowComponentLightEditCommands: {
  captureText: mocks.captureText, writeText: mocks.writeText, captureAsset: mocks.captureAsset, replaceAsset: mocks.replaceAsset,
} }))
vi.mock('@/renderer/composition/runtime/staticFallbackRecapture', () => ({ scheduleStaticFallbackRecapture: mocks.recapture }))
vi.mock('@/renderer/store/editorStore', () => ({ useEditorStore: { getState: () => ({
  captureRuntimeContentTextTarget: mocks.captureRuntimeText, updateRuntimeContentTextAtTarget: mocks.updateRuntimeText,
  captureRuntimeAssetReplacementTarget: mocks.captureRuntimeAsset, replaceRuntimeAssetAtTarget: mocks.replaceRuntimeAsset,
}) } }))

const entries: Array<{ root: Root; element: HTMLElement }> = []
afterEach(async () => {
  for (const { root, element } of entries.splice(0)) { await act(async () => root.unmount()); element.remove() }
  for (const value of Object.values(mocks)) if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
  mocks.runtimeProps = null
  mocks.componentProps = null
})
function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  entries.push({ root, element })
  return { root, element }
}
const base = {
  documentId: 'document-1', projectId: 'project-1', surfaceId: 'surface-1', locationId: 'location-1', generation: 1,
  frame: { x: 140, y: 220, width: 200, height: 100 }, assetUrls: {},
  onSelectImageAsset: vi.fn(async () => ({ meta: { id: 'asset-1', filename: 'picture.png', mimeType: 'image/png', kind: 'image' as const, path: 'picture.png', byteLength: 1 }, bytes: new Uint8Array([1]) })),
}
const component = {
  kind: 'component', layerItemId: 'card-1', component: { packageId: 'card', version: '1.0' }, props: {},
  frame: { mode: 'absolute', x: 140, y: 220, width: 200, height: 100 }, rotation: 30, visible: true, locked: false,
} as ComponentLayerItem
const runtime = {
  kind: 'runtime', layerItemId: 'runtime-1', label: 'Runtime', locked: false, visible: true,
  frame: { mode: 'absolute', x: 140, y: 220, width: 200, height: 100 }, order: 1,
  rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
  runtime: { source: 'source-1', enabled: true, protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom',
    content: { values: { title: 'Before' } }, assets: { hero: { assetId: 'asset-1' } } },
} as RuntimeLayerItem

it('uses card-local Component geometry, clips target bounds, and commits auto text and image edits', async () => {
  const { root, element } = mount()
  const onStatus = vi.fn()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={component} onStatus={onStatus} />))
  expect(mocks.componentProps).toMatchObject({ x: 0, y: 0, rotation: 0, width: 200, height: 100 })
  const target = { kind: 'component-text' as const, targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1',
    nodeId: 'card-1', componentId: 'card', source: 'auto' as const, key: '', label: 'Title', multiline: false,
    lightEdit: { original: 'Before', region: 'p', text: 'Before' }, bounds: { x: -10, y: 20, width: 30, height: 20 }, rotation: 0 }
  const picture = { kind: 'component-image' as const, targetId: 'image-1', scope: 'scene' as const, sceneId: 'surface-1',
    nodeId: 'card-1', componentId: 'card', source: 'auto' as const, assetKey: 'hero', label: 'Picture',
    bounds: { x: 185, y: 80, width: 40, height: 40 }, rotation: 0 }
  await act(async () => mocks.componentProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', nodeId: 'card-1', revision: 1, targets: [target, picture] }))
  const textButton = element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑组件文字"]')!
  const imageButton = element.querySelector<HTMLButtonElement>('[aria-label="Picture，替换组件图片"]')!
  expect(textButton.style.left).toBe('0px')
  expect(textButton.style.width).toBe('20px')
  expect(imageButton.style.width).toBe('15px')
  expect(textButton.style.pointerEvents).toBe('auto')
  await act(async () => textButton.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="commit-text"]')!.click())
  expect(mocks.captureText).toHaveBeenCalledWith('card-1', 'Before', 'p')
  expect(mocks.writeText).toHaveBeenCalledWith(expect.anything(), 'Edited')
  await act(async () => imageButton.click())
  expect(mocks.replaceAsset).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'asset-1' }), expect.any(Uint8Array))
  expect(onStatus).toHaveBeenCalledWith('已替换组件图片', 'success')
})

it('maps Runtime target identity to location, commits text and asset through the Store, and keeps local bounds', async () => {
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const text = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'registered' as const, layer: 'scene' as const, bounds: { x: 190, y: 5, width: 40, height: 20 } }
  const picture = { ...text, targetId: 'image-1', kind: 'asset' as const, key: 'hero', label: 'Picture', bounds: { x: 15, y: 70, width: 40, height: 40 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [text, picture] }))
  const textButton = element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!
  expect(textButton.style.width).toBe('10px')
  await act(async () => textButton.click())
  expect(mocks.captureRuntimeText.mock.calls[0]![0]).toMatchObject({ sceneId: 'location-1', nodeId: 'runtime-1' })
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="commit-text"]')!.click())
  expect(mocks.updateRuntimeText).toHaveBeenCalledWith(expect.anything(), 'Edited')
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Picture，替换图片"]')!.click())
  expect(mocks.captureRuntimeAsset.mock.calls[0]![0]).toMatchObject({ sceneId: 'location-1', nodeId: 'runtime-1' })
  expect(mocks.replaceRuntimeAsset).toHaveBeenCalledTimes(1)
})

it('rejects a late picker result after the document owner changes', async () => {
  const { root, element } = mount()
  let finish!: (value: Awaited<ReturnType<typeof base.onSelectImageAsset>>) => void
  const onSelectImageAsset = vi.fn(() => new Promise<Awaited<ReturnType<typeof base.onSelectImageAsset>>>(resolve => { finish = resolve }))
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={component} onSelectImageAsset={onSelectImageAsset} />))
  const picture = { kind: 'component-image' as const, targetId: 'image-1', scope: 'scene' as const, sceneId: 'surface-1',
    nodeId: 'card-1', componentId: 'card', source: 'auto' as const, assetKey: 'hero', label: 'Picture',
    bounds: { x: 10, y: 10, width: 40, height: 40 }, rotation: 0 }
  await act(async () => mocks.componentProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', nodeId: 'card-1', revision: 1, targets: [picture] }))
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Picture，替换组件图片"]')!.click())
  expect(onSelectImageAsset).toHaveBeenCalledTimes(1)
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} documentId="document-2" item={component} onSelectImageAsset={onSelectImageAsset} />))
  await act(async () => finish(await base.onSelectImageAsset()))
  expect(mocks.replaceAsset).not.toHaveBeenCalled()
  expect(mocks.componentProps.ownerKey).toContain('document-2')
})

it('ignores old Runtime source targets and hides edits when switched to read-only', async () => {
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const former = mocks.runtimeProps.onTargetsChanged
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base}
    item={{ ...runtime, runtime: { ...runtime.runtime, source: 'source-2' } }} readOnly />))
  const target = { targetId: 'late', scope: 'scene', sceneId: 'surface-1', kind: 'text', key: 'title',
    label: 'Late', source: 'auto', layer: 'scene', bounds: { x: 5, y: 5, width: 20, height: 20 },
    lightEdit: { original: 'Before', region: 'p', text: 'Before' } }
  await act(async () => former({ scope: 'scene', sceneId: 'surface-1', revision: 4, targets: [target] }))
  expect(element.querySelector('[data-testid="flow-runtime-light-edit-targets"]')).toBeNull()
  expect(mocks.captureRuntimeText).not.toHaveBeenCalled()
})
