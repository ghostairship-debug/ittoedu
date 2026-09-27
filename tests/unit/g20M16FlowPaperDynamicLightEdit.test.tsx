import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FlowPaperDynamicLightEdit } from '@/renderer/ui/flow/FlowPaperDynamicLightEdit'
import { prepareFlowDynamicDrafts } from '@/renderer/composition/runtime/flowDynamicDraftPreparation'
import { readAuthoringObservationDraftState } from '@/renderer/authoring/generation/authoringObservation'
import type { ComponentLayerItem, RuntimeLayerItem } from '@/shared/courseProjectTypes'

const mocks = vi.hoisted(() => ({
  runtimeProps: null as any,
  componentProps: null as any,
  realEditor: false,
  captureText: vi.fn(() => ({ kind: 'text', itemId: 'card-1', projectId: 'project-1', revision: 1, generation: 1,
    original: 'Before', region: 'p' })),
  captureAsset: vi.fn(() => ({ kind: 'asset', itemId: 'card-1', projectId: 'project-1', revision: 1, generation: 1, key: 'hero' })),
  captureRuntimeText: vi.fn((_session: any) => ({ initialValue: 'Before', courseTarget: { itemId: 'runtime-1' } })),
  captureRuntimeAsset: vi.fn((_session: any) => ({ courseTarget: { itemId: 'runtime-1' } })),
  submitIntent: vi.fn(() => ({ taskId: 'task-1', settled: Promise.resolve({ status: 'applied', receipt: { status: 'applied' } }) })),
  dynamicFallbackState: vi.fn(() => []),
  retryDynamicFallback: vi.fn(async () => ({ status: 'applied', receipt: { status: 'applied' } })),
  discardDynamicFallback: vi.fn(),
}))
vi.mock('@/renderer/ui/flow/FlowPageRuntime', () => ({ FlowPageRuntime: (props: any) => { mocks.runtimeProps = props; return <div data-testid="runtime-mount" /> } }))
vi.mock('@/renderer/ui/flow/FlowPageComponent', () => ({ FlowPageComponent: (props: any) => { mocks.componentProps = props; return <div data-testid="component-mount" /> } }))
vi.mock('@/renderer/ui/CanvasPlainTextEditor', async () => {
  const actual = await vi.importActual<typeof import('@/renderer/ui/CanvasPlainTextEditor')>('@/renderer/ui/CanvasPlainTextEditor')
  return { CanvasPlainTextEditor: (props: any) => mocks.realEditor ? <actual.CanvasPlainTextEditor {...props} /> : <div>
  <input className="canvas-plain-text-editor__control" value={props.value} readOnly />
  <button data-testid="draft-text" onClick={() => props.onDraftChange?.('Unsaved draft', false)}>{props.value}</button>
  <button data-testid="compose-text" onClick={() => props.onDraftChange?.('Unsaved draft', true)}>compose</button>
  <button data-testid="commit-text" onClick={() => { props.onDraftChange?.('Edited', false); props.onCommit('Edited') }}>commit</button>
</div> }
})
vi.mock('@/renderer/composition/runtime/flowDynamicLightEditCommands', () => ({ flowComponentLightEditCommands: {
  captureText: mocks.captureText, captureAsset: mocks.captureAsset,
} }))
vi.mock('@/renderer/store/editorStore', () => ({
  selectActiveCourseProjectDocument: () => ({ id: 'project-1', revision: 1 }),
  useEditorStore: { getState: () => ({
    courseAuthoringSession: { token: { generation: 1 } },
    captureRuntimeContentTextTarget: mocks.captureRuntimeText,
    captureRuntimeAssetReplacementTarget: mocks.captureRuntimeAsset,
    submitDynamicFallbackIntent: mocks.submitIntent,
    dynamicFallbackState: mocks.dynamicFallbackState,
    retryDynamicFallback: mocks.retryDynamicFallback,
    discardDynamicFallback: mocks.discardDynamicFallback,
  }) },
}))

const entries: Array<{ root: Root; element: HTMLElement }> = []
afterEach(async () => {
  for (const { root, element } of entries.splice(0)) { await act(async () => root.unmount()); element.remove() }
  for (const value of Object.values(mocks)) if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
  mocks.runtimeProps = null
  mocks.componentProps = null
  mocks.realEditor = false
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
  toolbarContainer: document.body, showRuntimeEditToggle: true,
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
  expect(mocks.submitIntent).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'component.text', documentId: 'document-1', locationId: 'location-1', itemId: 'card-1',
    original: 'Before', region: 'p', text: 'Edited', expectedText: 'Before',
  }))
  await act(async () => imageButton.click())
  expect(mocks.submitIntent).toHaveBeenCalledTimes(2)
  expect(mocks.submitIntent).toHaveBeenLastCalledWith(expect.objectContaining({
    kind: 'component.asset', documentId: 'document-1', locationId: 'location-1', itemId: 'card-1',
    assetKey: 'hero', asset: expect.objectContaining({ id: 'asset-1' }), bytes: expect.any(Uint8Array),
  }))
  expect(onStatus).toHaveBeenCalledWith('修改已确认', 'success')
})

it('maps Runtime target identity to location, commits text and asset through the Store, and keeps local bounds', async () => {
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const text = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'registered' as const, layer: 'scene' as const, bounds: { x: 190, y: 5, width: 40, height: 20 } }
  const picture = { ...text, targetId: 'image-1', kind: 'asset' as const, key: 'hero', label: 'Picture', bounds: { x: 15, y: 70, width: 40, height: 40 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [text, picture] }))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  const textButton = element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!
  expect(textButton.style.width).toBe('10px')
  await act(async () => textButton.click())
  expect(mocks.captureRuntimeText.mock.calls[0]![0]).toMatchObject({ sceneId: 'location-1', nodeId: 'runtime-1' })
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="commit-text"]')!.click())
  expect(mocks.submitIntent).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'runtime.text', documentId: 'document-1', locationId: 'location-1', itemId: 'runtime-1',
    value: 'Edited', target: expect.objectContaining({ courseTarget: { itemId: 'runtime-1' } }),
  }))
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Picture，替换图片"]')!.click())
  expect(mocks.captureRuntimeAsset.mock.calls[0]![0]).toMatchObject({ sceneId: 'location-1', nodeId: 'runtime-1' })
  expect(mocks.submitIntent).toHaveBeenCalledTimes(2)
  expect(mocks.submitIntent).toHaveBeenLastCalledWith(expect.objectContaining({
    kind: 'runtime.asset', documentId: 'document-1', locationId: 'location-1', itemId: 'runtime-1',
    target: expect.objectContaining({ courseTarget: { itemId: 'runtime-1' } }), asset: expect.objectContaining({ id: 'asset-1' }),
  }))
})

it('keeps a failed text draft and offers retry before reporting a confirmed edit', async () => {
  const { root, element } = mount()
  const onStatus = vi.fn()
  let settle!: (result: unknown) => void
  mocks.submitIntent.mockImplementationOnce(() => ({ taskId: 'task-failed', settled: new Promise(resolve => { settle = resolve }) }) as any)
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} onStatus={onStatus} />))
  const target = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'registered' as const, layer: 'scene' as const, bounds: { x: 10, y: 5, width: 40, height: 20 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [target] }))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="commit-text"]')!.click())
  expect(mocks.submitIntent).toHaveBeenCalledTimes(1)
  expect(onStatus).not.toHaveBeenCalledWith('修改已确认', 'success')
  await act(async () => settle({ status: 'failed', taskId: 'task-failed', reason: '截图失败' }))
  expect(element.querySelector('[data-testid="flow-dynamic-edit-recovery"]')?.textContent).toContain('截图失败')
  expect(element.querySelector('[data-testid="commit-text"]')).not.toBeNull()
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="flow-dynamic-edit-recovery"] button')!.click())
  expect(mocks.retryDynamicFallback).toHaveBeenCalledWith('task-failed')
  expect(element.querySelector('[data-testid="flow-dynamic-edit-recovery"]')).toBeNull()
  expect(onStatus).toHaveBeenCalledWith('修改已确认', 'success')
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
  expect(mocks.submitIntent).not.toHaveBeenCalled()
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

it('runs Runtime by default, confirms an active draft before leaving edit mode, and keeps the host mounted', async () => {
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const host = element.querySelector('[data-testid="runtime-mount"]')!
  const target = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'auto' as const, layer: 'scene' as const, bounds: { x: 10, y: 5, width: 40, height: 20 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [target] }))
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!
  expect(toggle.textContent).toBe('编辑图文')
  expect(toggle.getAttribute('aria-label')).toBe('Runtime：编辑图文')
  expect(toggle.classList.contains('secondary-button')).toBe(true)
  expect(toggle.parentElement).toBe(document.body)
  expect(element.contains(toggle)).toBe(false)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(element.querySelector('[data-testid="flow-runtime-light-edit-targets"]')).toBeNull()
  await act(async () => toggle.click())
  expect(toggle.textContent).toBe('完成编辑继续运行')
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="draft-text"]')!.click())
  await act(async () => toggle.click())
  expect(mocks.submitIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'runtime.text', value: 'Unsaved draft' }))
  await vi.waitFor(() => expect(element.querySelector('[data-testid="flow-runtime-light-edit-targets"]')).toBeNull())
  expect(element.querySelector('[data-testid="runtime-mount"]')).toBe(host)
})

it('keeps edit mode and the draft visible while confirmation is pending or failed', async () => {
  const { root, element } = mount()
  let settle!: (result: unknown) => void
  mocks.submitIntent.mockImplementationOnce(() => ({ taskId: 'task-failed', settled: new Promise(resolve => { settle = resolve }) }) as any)
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const target = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'auto' as const, layer: 'scene' as const, bounds: { x: 10, y: 5, width: 40, height: 20 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [target] }))
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!
  await act(async () => toggle.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="draft-text"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="compose-text"]')!.click())
  await expect(prepareFlowDynamicDrafts('document-1')).rejects.toThrow('输入法组合中')
  expect(mocks.submitIntent).not.toHaveBeenCalled()
  await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="draft-text"]')!.click())
  const control = element.querySelector<HTMLInputElement>('.canvas-plain-text-editor__control')!
  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({ width: 120, height: 24 } as DOMRect)
  expect(readAuthoringObservationDraftState()).toContain('Unsaved draft')
  let pending!: Promise<void>
  await act(async () => { pending = prepareFlowDynamicDrafts('document-1'); await Promise.resolve() })
  const rejected = expect(pending).rejects.toThrow('修改未确认')
  await act(async () => { toggle.click(); await Promise.resolve() })
  expect(mocks.submitIntent).toHaveBeenCalledTimes(1)
  expect(toggle.disabled).toBe(true)
  expect(element.querySelector('[data-testid="draft-text"]')?.textContent).toBe('Unsaved draft')
  await act(async () => { settle({ status: 'failed', taskId: 'task-failed', reason: '提交失败' }); await rejected })
  expect(toggle.textContent).toBe('完成编辑继续运行')
  expect(element.querySelector('[data-testid="draft-text"]')?.textContent).toBe('Unsaved draft')
  expect(element.querySelector('[data-testid="flow-dynamic-edit-recovery"]')).not.toBeNull()
  await act(async () => toggle.click())
  expect(mocks.submitIntent).toHaveBeenCalledTimes(1)
  expect(element.querySelector('[data-testid="flow-runtime-light-edit-targets"]')).not.toBeNull()
})

it('keeps locked and read-only cards in run mode and resets edit mode for a new owner', async () => {
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  expect(document.querySelector('[data-testid="flow-runtime-edit-mode-toggle"]')?.textContent).toBe('完成编辑继续运行')
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} documentId="document-2" item={runtime} />))
  expect(document.querySelector('[data-testid="flow-runtime-edit-mode-toggle"]')?.textContent).toBe('编辑图文')
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={{ ...runtime, locked: true }} />))
  expect(document.querySelector('[data-testid="flow-runtime-edit-mode-toggle"]')).toBeNull()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} readOnly />))
  expect(document.querySelector('[data-testid="flow-runtime-edit-mode-toggle"]')).toBeNull()
})

it('locks the real text control while a saved draft awaits ACK and clears parent mode on unmount', async () => {
  mocks.realEditor = true
  const { root, element } = mount()
  const onModeChange = vi.fn()
  let settle!: (result: unknown) => void
  mocks.submitIntent.mockImplementationOnce(() => ({ taskId: 'task-pending', settled: new Promise(resolve => { settle = resolve }) }) as any)
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} onRuntimeEditModeChange={onModeChange} />))
  const target = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'auto' as const, layer: 'scene' as const, bounds: { x: 10, y: 5, width: 40, height: 20 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [target] }))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!.click())
  const input = element.querySelector<HTMLInputElement>('.canvas-plain-text-editor__control')!
  await act(async () => fireEvent.change(input, { target: { value: 'A' } }))
  expect(input.value).toBe('A')
  let pending!: Promise<void>
  await act(async () => { pending = prepareFlowDynamicDrafts('document-1'); await Promise.resolve() })
  expect(input.readOnly).toBe(true)
  await act(async () => fireEvent.change(input, { target: { value: 'B' } }))
  expect(input.value).toBe('A')
  expect(mocks.submitIntent).toHaveBeenCalledTimes(1)
  expect(mocks.submitIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'runtime.text', value: 'A' }))
  await act(async () => { settle({ status: 'applied', receipt: { status: 'applied' } }); await pending })
  expect(element.querySelector('[data-testid="canvas-plain-text-editor"]')).toBeNull()
  await act(async () => root.unmount())
  entries.pop()?.element.remove()
  expect(onModeChange).toHaveBeenCalledWith('runtime-1', false)
})

it('retains an unconfirmed draft visibly when the card becomes read-only', async () => {
  mocks.realEditor = true
  const { root, element } = mount()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  const target = { targetId: 'text-1', scope: 'scene' as const, sceneId: 'surface-1', kind: 'text' as const, key: 'title',
    label: 'Title', source: 'auto' as const, layer: 'scene' as const, bounds: { x: 10, y: 5, width: 40, height: 20 } }
  await act(async () => mocks.runtimeProps.onTargetsChanged({ scope: 'scene', sceneId: 'surface-1', revision: 1, targets: [target] }))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Title，编辑文字"]')!.click())
  const input = element.querySelector<HTMLInputElement>('.canvas-plain-text-editor__control')!
  await act(async () => fireEvent.change(input, { target: { value: 'A' } }))
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} readOnly />))
  expect(input.isConnected).toBe(true)
  expect(input.value).toBe('A')
  expect(input.readOnly).toBe(true)
  expect(element.querySelector('[aria-label="Title，编辑文字"]')).toBeNull()
  expect(document.querySelector('[data-testid="flow-runtime-edit-mode-toggle"]')).toBeNull()
  await expect(prepareFlowDynamicDrafts('document-1')).rejects.toThrow('锁定或只读')
  expect(mocks.submitIntent).not.toHaveBeenCalled()
  await act(async () => root.render(<FlowPaperDynamicLightEdit {...base} item={runtime} />))
  expect(input.value).toBe('A')
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-edit-mode-toggle"]')!.click())
  expect(mocks.submitIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'runtime.text', value: 'A' }))
})
