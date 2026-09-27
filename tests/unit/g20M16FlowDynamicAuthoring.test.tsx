import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowPageComponent } from '@/renderer/ui/flow/FlowPageComponent'
import { FlowDynamicAuthoringOverlay } from '@/renderer/ui/flow/FlowDynamicAuthoringOverlay'
import { mountPublishedComponent } from '@/player/surfaces/publishedComponentMount'

vi.mock('@/player/surfaces/publishedComponentMount', async importOriginal => {
  const original = await importOriginal<typeof import('@/player/surfaces/publishedComponentMount')>()
  const source = { manifest: { id: 'card', version: '1.0' } }
  return { ...original, findComponentPackageSource: () => source, mountPublishedComponent: vi.fn(() => ({
    destroy: vi.fn(), updateProps: vi.fn(), updateAuthoringNode: vi.fn(), resize: vi.fn(), setTextOverrides: vi.fn(),
  })) }
})

const roots: Array<{ root: Root; container: HTMLElement }> = []
afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount())
    container.remove()
  }
  vi.mocked(mountPublishedComponent).mockClear()
})

function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ root, container })
  return root
}

const base = {
  projectId: 'course-1', surfaceId: 'flow-1', ownerKey: 'document-a', nodeId: 'component-1',
  scope: 'scene' as const, x: 25, y: 40, width: 320, height: 180,
  componentPackages: { 'card@1.0': {} as never }, assetUrls: { image1: 'blob:one', image2: 'blob:two' },
}
const item = { component: { packageId: 'card', version: '1.0' }, props: { title: 'A' },
  textOverrides: [{ original: 'Original', region: 'p', text: 'Changed' }],
  assetOverrides: { hero: { assetId: 'image1' } },
}

it('mounts the published host with automatic authoring targets and both M15 override kinds', async () => {
  const root = mount()
  const updates = vi.fn()
  await act(async () => root.render(<FlowPageComponent {...base} item={item} onTargetsChanged={updates} />))
  expect(mountPublishedComponent).toHaveBeenCalledTimes(1)
  const options = vi.mocked(mountPublishedComponent).mock.calls[0]![1]
  expect(options).toMatchObject({ projectId: 'course-1', mode: 'edit', scope: 'scene', sceneId: 'flow-1',
    textOverrides: item.textOverrides, assetOverrides: item.assetOverrides,
    authoring: { node: { id: 'component-1', component: item.component, x: 25, y: 40 } } })
  options.authoring!.onTargetsChanged({ scope: 'scene', sceneId: 'flow-1', nodeId: 'component-1', revision: 3, targets: [] })
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }))
  await act(async () => root.unmount())
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({ revision: 4, targets: [] }))
  roots.pop()?.container.remove()
})

it('updates text and geometry in place, but remounts for image changes and retires the former owner', async () => {
  const root = mount()
  const former = vi.fn()
  const current = vi.fn()
  await act(async () => root.render(<FlowPageComponent {...base} item={item} onTargetsChanged={former} />))
  const firstHandle = vi.mocked(mountPublishedComponent).mock.results[0]!.value
  const firstOptions = vi.mocked(mountPublishedComponent).mock.calls[0]![1]
  await act(async () => root.render(<FlowPageComponent {...base} item={{ ...item, textOverrides: [{ ...item.textOverrides[0]!, text: 'Now' }] }} x={30} onTargetsChanged={former} />))
  expect(mountPublishedComponent).toHaveBeenCalledTimes(1)
  expect(firstHandle.setTextOverrides).toHaveBeenCalledWith([{ ...item.textOverrides[0], text: 'Now' }])
  expect(firstHandle.updateAuthoringNode).toHaveBeenCalledWith(expect.objectContaining({ x: 30 }))
  await act(async () => root.render(<FlowPageComponent {...base} ownerKey="document-b" item={{ ...item, assetOverrides: { hero: { assetId: 'image2' } } }} onTargetsChanged={current} />))
  expect(firstHandle.destroy).toHaveBeenCalledTimes(1)
  expect(former).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, targets: [] }))
  expect(mountPublishedComponent).toHaveBeenCalledTimes(2)
  expect(vi.mocked(mountPublishedComponent).mock.calls[1]![1].assetOverrides).toEqual({ hero: { assetId: 'image2' } })
  firstOptions.authoring!.onTargetsChanged({ scope: 'scene', sceneId: 'flow-1', nodeId: 'component-1', revision: 9, targets: [] })
  expect(current).not.toHaveBeenCalled()
})

it('renders host-discovered paper targets and routes activation to the Flow owner', async () => {
  const root = mount()
  const onTextActivate = vi.fn()
  const onImageActivate = vi.fn()
  const bounds = { x: 12, y: 24, width: 90, height: 30 }
  const text = { kind: 'component-text' as const, targetId: 'text-1', scope: 'scene' as const,
    sceneId: 'flow-1', nodeId: 'component-1', componentId: 'card', key: '', label: '标题',
    multiline: false, source: 'auto' as const, lightEdit: { original: 'A', region: 'p', text: 'A' }, bounds, rotation: 0 }
  const image = { kind: 'component-image' as const, targetId: 'image-1', scope: 'scene' as const,
    sceneId: 'flow-1', nodeId: 'component-1', componentId: 'card', assetKey: 'hero',
    label: '图片', source: 'auto' as const, bounds, rotation: 0 }
  await act(async () => root.render(<FlowDynamicAuthoringOverlay textTargets={[text]} imageTargets={[image]}
    onTextActivate={onTextActivate} onImageActivate={onImageActivate} />))
  const host = document.querySelector('[data-testid="flow-component-authoring-targets"]')!
  const buttons = host.querySelectorAll('button')
  expect(buttons).toHaveLength(2)
  await act(async () => { buttons[0]!.click(); buttons[1]!.click() })
  expect(onImageActivate).toHaveBeenCalledWith(image)
  expect(onTextActivate).toHaveBeenCalledWith(text)
  await act(async () => root.render(<FlowDynamicAuthoringOverlay textTargets={[]} imageTargets={[]}
    onTextActivate={onTextActivate} onImageActivate={onImageActivate} />))
  expect(document.querySelector('[data-testid="flow-component-authoring-targets"]')).toBeNull()
})
