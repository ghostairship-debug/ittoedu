import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown>,
  rects: [{ blockId: 'paragraph', depth: 0, x: 36, y: 100, width: 728, height: 40 }] }))
vi.mock('../../src/renderer/components/componentAuthorHit', () => ({ visibleComponentAuthorHit: async () => ({ instanceId: 'floating' }) }))
vi.mock('../../src/renderer/store/editorStore', () => ({ selectActiveSlideContentEdit: () => null, useEditorStore: Object.assign((select: (state: typeof probe.state) => unknown) => select(probe.state), { getState: () => probe.state }) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/ui/workspaces/useComponentAuthorInteraction', () => ({ useComponentAuthorInteraction: () => ({ editor: null, pointerFromElement: () => false }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
vi.mock('../../src/renderer/ui/flow/flowParagraphLayout', async importOriginal => ({
  ...await importOriginal<object>(), measureFlowParagraphLayout: () => probe.rects,
  observeFlowParagraphLayout: (_paper: HTMLElement, publish: (rects: typeof probe.rects, change: { retired: HTMLElement[]; paint: HTMLElement[]; moved: HTMLElement[] }) => void) => {
    publish(probe.rects, { retired: [], paint: [], moved: [] })
    return Object.assign(() => {}, { invalidate() {} })
  },
}))
vi.mock('../../src/renderer/document', async () => {
  const React = await import('react')
  return { SharedDocumentEditor: React.forwardRef((props: { onLayoutMount(element: HTMLElement | null): void }, ref) => {
    React.useImperativeHandle(ref, () => ({ flush: () => ({ ready: true, diagnostics: [] }), drain: async () => ({ ready: true, diagnostics: [] }), paintProjection: (paint: () => void) => paint() }))
    return <div ref={props.onLayoutMount} className="ProseMirror"><p data-flow-block-id="paragraph">正文</p></div>
  }) }
})
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture)
  else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
})

function project(width = 100, height = 80): CourseProjectV10 {
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'overlay-final-pointer', revision: 0, title: 'Flow 浮层',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [SHAPE_DEFINITION.id]: SHAPE_DEFINITION },
    instances: {
      paragraph: { id: 'paragraph', definitionId: TEXT_DEFINITION.id, data: createTextData('正文') },
      floating: { id: 'floating', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(),
        frame: { width, height, transform: [1, 0, 0, 1, 15, 30] },
        flowPlacement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: 'paragraph', offsetY: 20, xRatio: 0.25 } } },
    }, surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['paragraph', 'floating'], flow: { layout: { widthMode: 'reading', readingWidth: 800, wideContentWidth: 1100, toc: 'hidden' } } }],
    global: { underlay: [], overlay: [] }, assets: {} })
}

async function mount(initial = project()) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  const h = await createV10StoreHost(initial)
  const navigation = new ComponentNavigationOwner({ project: () => h.model().project, surfaceId: () => 'flow', interactive: () => false, select: () => true })
  probe.state = { courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read(), editingScope: 'scene',
    flowDocumentDrafts: {}, setFlowDocumentDraft() {}, setFlowContextSelection() {}, slideContentEdit: null, commitSlideContentEdit: async () => {} }
  probe.runtime = { documentId: h.first.documentId, resources: { assets: {}, components: {} }, selectedInstanceIds: ['floating'], selectInstances() {},
    navigation, registerObservation: () => () => {}, renderInstance: () => null, onTargetElement() {}, onElement() {},
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {}, beforeProjectionRemoval() {} } }
  function Harness() {
    useSyncExternalStore(h.bridge.subscribe.bind(h.bridge), () => h.bridge.read())
    return <FlowWorkspace documentId={h.first.documentId} project={h.model().project} surfaceId="flow" onSelectImageAsset={async () => null} />
  }
  const ui = render(<Harness />)
  await waitFor(() => expect(ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="floating"]')?.style.transform).toBe('matrix(1,0,0,1,200,120)'))
  return { h, ui, dispose: () => { ui.unmount(); navigation.dispose(); h.bridge.dispose() } }
}

it('uses the final Flow resize coordinate once and keeps the stored paragraph frame and anchor through Undo', async () => {
  const initial = project(), { h, ui, dispose } = await mount(initial)
  try {
    const resize = ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="floating"] [data-handle="se"]')!
    fireEvent.pointerDown(resize, { clientX: 50, clientY: 60, button: 0 })
    fireEvent.pointerMove(resize, { clientX: 60, clientY: 65 })
    await act(async () => fireEvent.pointerUp(resize, { clientX: 90, clientY: 80 }))
    await waitFor(() => expect(h.first.read().undoDepth).toBe(1))
    expect(h.model().project.instances.floating).toMatchObject({ frame: { width: 140, height: 100, transform: [1, 0, 0, 1, 15, 30] }, flowPlacement: initial.instances.floating.flowPlacement })
    expect(h.operations).toHaveLength(1)
    await act(async () => { await h.kernel.navigateHistory('undo') })
    expect(h.model().project.instances.floating).toEqual(initial.instances.floating)
  } finally { dispose() }
})

it('moves a Flow paragraph overlay from down to up without a move event and restores it in one Undo', async () => {
  const initial = project(), { h, ui, dispose } = await mount(initial)
  try {
    const move = ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="floating"]')!
    fireEvent.pointerDown(move, { clientX: 50, clientY: 60, button: 0 })
    await act(async () => fireEvent.pointerUp(move, { clientX: 70, clientY: 90 }))
    await waitFor(() => expect(h.first.read().undoDepth).toBe(1))
    expect(h.model().project.instances.floating).toMatchObject({ frame: { width: 100, height: 80, transform: [1, 0, 0, 1, 220, 150] },
      flowPlacement: { paragraphAnchor: { blockId: 'paragraph', offsetY: 50, xRatio: 0.275 } } })
    expect(h.operations).toHaveLength(1)
    await act(async () => { await h.kernel.navigateHistory('undo') })
    expect(h.model().project.instances.floating).toEqual(initial.instances.floating)
  } finally { dispose() }
})

it('leaves a small existing Flow overlay clean after zero movement or a cancelled preview', async () => {
  const initial = project(8, 6), { h, ui, dispose } = await mount(initial)
  try {
    for (const selector of ['[data-flow-overlay-id="floating"]', '[data-flow-overlay-id="floating"] [data-handle="se"]']) {
      const handle = ui.container.querySelector<HTMLElement>(selector)!
      fireEvent.pointerDown(handle, { clientX: 50, clientY: 60, button: 0 })
      await act(async () => fireEvent.pointerUp(handle, { clientX: 50, clientY: 60 }))
      fireEvent.pointerDown(handle, { clientX: 50, clientY: 60, button: 0 })
      fireEvent.pointerMove(handle, { clientX: 90, clientY: 80 })
      fireEvent.pointerCancel(handle)
    }
    expect(h.operations).toHaveLength(0)
    expect(h.first.read().undoDepth).toBe(0)
    expect(h.model().project).toEqual(initial)
  } finally { dispose() }
})
