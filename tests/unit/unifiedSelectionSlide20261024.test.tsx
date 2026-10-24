import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import type { ComponentAuthorPointerEventDetail, ComponentAuthorSpot, ComponentFrame, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { SlideLocationWorkspace, type SlideWorkspacePorts } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

// Keep the real workspace, native input, quick bar and canonical writer. The fixture
// provides the application store's subscription and unrelated properties-panel slot.
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: Object.assign(
  (select: (state: typeof store.state) => unknown) => select(store.state), { getState: () => store.state },
) }))
vi.mock('../../src/renderer/ui/properties/PropertiesContextAdapter', () => ({ usePropertiesContext: () => ({ kind: 'empty-surface' }) }))

const restored = [
  [HTMLElement.prototype, 'setPointerCapture'], [HTMLElement.prototype, 'releasePointerCapture'],
  [Document.prototype, 'adoptedStyleSheets'], [Document.prototype, 'elementsFromPoint'],
  [CSSStyleSheet.prototype, 'replaceSync'], [Range.prototype, 'getClientRects'], [Range.prototype, 'getBoundingClientRect'],
] as const
const descriptors = restored.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key))
const disposals: (() => void)[] = []
let painted: (x: number, y: number) => Element[] = () => []

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value() {} })
  Object.defineProperty(Document.prototype, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
  Object.defineProperty(Document.prototype, 'elementsFromPoint', { configurable: true, value: (x: number, y: number) => painted(x, y) })
  Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', { configurable: true, value() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.closest('.selection-quick-bar')) return new DOMRect(0, 0, 240, 34)
    const owner = this.closest<HTMLElement>('[data-component-instance]')
    if (owner) {
      let x = 0, y = 0
      for (let at: HTMLElement | null = owner; at; at = at.parentElement?.closest<HTMLElement>('[data-component-instance]') ?? null) {
        const matrix = /^matrix\(([^)]+)\)$/.exec(at.style.transform)?.[1].split(',').map(Number)
        if (matrix) { x += matrix[4]; y += matrix[5] }
      }
      return new DOMRect(x, y, parseFloat(owner.style.width) || 200, parseFloat(owner.style.height) || 120)
    }
    return new DOMRect(0, 0, 960, 640)
  })
})
afterEach(() => {
  cleanup(); disposals.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals()
  restored.forEach(([target, key], index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key) })
  painted = () => []; store.state = {}
})

const frame = (x: number, y: number, width = 200, height = 80): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })
function project(grouped = false): CourseProjectV10 {
  return createTestProjectFromLegacy({ schemaVersion: 10, id: 'unified-slide', revision: 0, title: '统一选择',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION,
      source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } },
      group: { id: 'group', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: {
      text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('人工文字'))), frame: frame(grouped ? 20 : 100, grouped ? 20 : 60) },
      source: { id: 'source', definitionId: 'source', data: { label: '内部文字' }, frame: frame(430, 90, 300, 180) },
      ...(grouped ? { group: { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], frame: frame(100, 60, 300, 180) } } : {}),
    }, surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: [grouped ? 'group' : 'text', 'source'], designSize: { width: 960, height: 640 } }],
    global: { underlay: [], overlay: [] }, assets: {} })
}

async function mount(initial = project(), spots: ComponentAuthorSpot[] = []) {
  const h = await createV10StoreHost(initial)
  let owned = createInitialSlideOwnedState()
  const listeners = new Set<() => void>()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch }; listeners.forEach(listener => listener()) } })
  const commit = vi.fn<SlideWorkspacePorts['commit']>((edits, target, group) => h.kernel.editCaptured(h.kernel.capture(edits, target), group))
  const begin = vi.fn(slice.beginSlideDataEdit), beginSpot = vi.fn(slice.beginSlideSpotEdit), report = vi.fn()
  const ports: SlideWorkspacePorts = {
    read() { const v = h.bridge.read(); return { project: v.editingProject, documentId: v.activeDocumentId, epoch: v.snapshot?.epoch,
      rootInstanceId: v.rootInstanceId, editingContainerId: v.editingContainerId, activeGroupId: v.activeGroupId, surfaceId: v.surfaceId,
      selectedInstanceIds: v.selectedInstanceIds, interactionSelection: v.interactionSelection, activation: v.activation,
      activeStateId: v.activeStateId, assetUrls: {}, canvasMode: 'edit', contentEdit: owned.slideContentEdit, drawTool: null } },
    capture: documentId => h.kernel.captureTarget(documentId), commit,
    edit: (edits, group) => h.kernel.edit(edits, group), select: ids => h.kernel.selectInstances(ids),
    selectAuthorSpot: value => h.bridge.selectAuthorSpot(h.first.documentId, value),
    enterGroup: id => h.bridge.enterGroup(h.first.documentId, id), leaveGroup: () => h.bridge.leaveGroup(h.first.documentId),
    enterContainer: id => h.bridge.enterContainer(h.first.documentId, id), authorSpots: () => spots,
    beginTextEdit: begin, beginSpotEdit: beginSpot, updateDataDraft: slice.updateSlideDataDraft, updateSpotDraft: slice.updateSlideSpotDraft,
    commitTextEdit: slice.commitSlideContentEdit, commitTextInput: slice.commitSlideContentInput, cancelTextEdit: slice.cancelTextEdit,
    setTextComposing: slice.setSlideTextEditComposing,
    undo: () => { void h.kernel.navigateHistory('undo') }, redo: () => { void h.kernel.navigateHistory('redo') },
    onElement(_id, element) { if (element) element.style.backgroundColor = 'white' }, onTargetElement() {},
    selectSurface() {}, setCanvasMode() {}, setDrawTool() {}, report, paste() {}, selectAll() {},
    addTextNode() {}, addFormulaNode() {}, addRectangleNode() {}, addShapeNode() {}, addTableNode() {}, addChartNode() {}, addExternalComponentNode() {}, drawShapeNode() {},
  }
  function Harness() {
    const view = useSyncExternalStore(h.bridge.subscribe.bind(h.bridge), () => h.bridge.read())
    useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => owned)
    store.state = { courseView: view, courseBridge: h.bridge, courseKernel: h.kernel, selectNodes: ports.select, setActiveTab() {} }
    return <SlideLocationWorkspace snapshot={ports.read()} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />
  }
  const ui = render(<Harness />), workspace = screen.getByRole('main', { name: '画布' })
  // jsdom has no paint engine. The fixture supplies a viewport hit list; production
  // visibleComponentAuthorHit still arbitrates the real rendered slots/realm reply.
  painted = (x, y) => [...ui.container.querySelectorAll<HTMLElement>('[data-component-render]')].reverse().filter(element => {
    const rect = element.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  })
  const dispose = () => { ui.unmount(); h.bridge.dispose() }; disposals.push(dispose)
  return { h, ui, workspace, ports, commit, begin, beginSpot, report, owned: () => owned }
}

async function pointer(f: Awaited<ReturnType<typeof mount>>, id: number, start: [number, number], end = start) {
  await act(async () => { fireEvent.pointerDown(f.workspace, { pointerId: id, button: 0, clientX: start[0], clientY: start[1] }) })
  await act(async () => { fireEvent.pointerUp(f.workspace, { pointerId: id, button: 0, clientX: end[0], clientY: end[1] }) })
}
function realm(f: Awaited<ReturnType<typeof mount>>, type: 'component-author-pointer' | 'component-author-double-click', detail: Partial<ComponentAuthorPointerEventDetail>) {
  const slot = f.ui.container.querySelector('[data-component-render="source"]')!
  return slot.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: { instanceId: 'source', mountGeneration: 1, localPoint: { x: 30, y: 20 }, ...detail } }))
}
function spot(geometry: boolean): ComponentAuthorSpot {
  const bounds = frame(20, 15, 110, 30)
  return { id: 'label', authorKey: 'label', instanceId: 'source', mountGeneration: 1, kind: 'text', initialValue: '内部文字', dataPath: ['label'], localBounds: bounds,
    ...(geometry ? { geometry: { frame: bounds, parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } } : {}) }
}

it('hands a realm whole-object double-click to its explicit editor without starting a pointer gesture', async () => {
  const f = await mount(), edit = vi.fn((event: Event) => event.preventDefault())
  f.workspace.addEventListener('course-object-edit', edit)
  await act(async () => { realm(f, 'component-author-double-click', {}) })
  await waitFor(() => expect(edit).toHaveBeenCalledOnce())
  expect((edit.mock.calls[0][0] as CustomEvent).detail.itemId).toBe('source')
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['source'])
  expect(f.commit).not.toHaveBeenCalled()
})

it('selects native text on one click, ignores sub-slop motion and commits one whole-object drag through History', async () => {
  const f = await mount()
  await pointer(f, 1, [150, 90])
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['text'])
  expect(f.begin).not.toHaveBeenCalled(); expect(f.owned().slideContentEdit).toBeNull()
  await pointer(f, 2, [150, 90], [152, 90])
  expect(f.commit).not.toHaveBeenCalled(); expect(f.h.first.read().undoDepth).toBe(0)
  await pointer(f, 3, [150, 90], [175, 110])
  await waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
  expect(f.h.model().project.instances.text.frame).toEqual(frame(125, 80))
  expect(f.h.operations).toHaveLength(1); expect(f.h.first.read().undoDepth).toBe(1)
  await act(async () => { await f.h.kernel.navigateHistory('undo') })
  expect(f.h.model().project.instances.text.frame).toEqual(frame(100, 60))
  expect(f.report).not.toHaveBeenCalled()
})

it('double-clicks into one native input bar, finishes to the same selected object and can drag its body again', async () => {
  const f = await mount()
  await pointer(f, 1, [150, 90])
  await act(async () => { fireEvent.doubleClick(f.workspace, { clientX: 150, clientY: 90 }) })
  const input = await screen.findByRole('textbox', { name: '正文编辑' })
  expect(f.begin).toHaveBeenCalledOnce()
  expect(document.querySelectorAll('.selection-quick-bar')).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '完成编辑' })).toHaveLength(1)
  await act(async () => {
    fireEvent.pointerDown(input, { pointerId: 4, button: 0, clientX: 150, clientY: 90 })
    fireEvent.pointerMove(input, { pointerId: 4, clientX: 180, clientY: 110 })
    fireEvent.pointerUp(input, { pointerId: 4, button: 0, clientX: 180, clientY: 110 })
  })
  expect(f.commit).not.toHaveBeenCalled()
  expect(f.h.model().project.instances.text.frame).toEqual(frame(100, 60))
  fireEvent.click(screen.getByRole('button', { name: '完成编辑' }))
  await waitFor(() => expect(f.owned().slideContentEdit).toBeNull())
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['text'])
  await pointer(f, 2, [150, 90], [175, 110])
  await waitFor(() => expect(f.h.model().project.instances.text.frame).toEqual(frame(125, 80)))
  expect(f.commit).toHaveBeenCalledOnce(); expect(f.report).not.toHaveBeenCalled()
})

it('retains the double-click edit intention for a second field while the first input waits for its shared slow ACK', async () => {
  const field = spot(false), f = await mount(project(), [field])
  const finish = f.ports.commitTextEdit
  let acknowledge!: () => void, pending: Promise<void> | undefined
  const ack = new Promise<void>(resolve => { acknowledge = resolve })
  const waitForAck = vi.fn(() => pending ??= ack.then(finish))
  f.ports.commitTextEdit = waitForAck
  await pointer(f, 1, [150, 90])
  await act(async () => { fireEvent.doubleClick(f.workspace, { clientX: 150, clientY: 90 }) })
  await screen.findByRole('textbox', { name: '正文编辑' })
  act(() => { f.ports.updateDataDraft(createTextData('A 的待确认修改')) })
  const original = f.h.model().project.instances.text.data
  const paint = vi.spyOn(document, 'elementsFromPoint')
  await pointer(f, 2, [470, 120])
  const waitsBeforeDoubleClick = waitForAck.mock.calls.length
  await act(async () => { fireEvent.doubleClick(f.workspace, { clientX: 470, clientY: 120 }) })
  expect(waitForAck.mock.calls.length).toBeGreaterThan(waitsBeforeDoubleClick)
  expect(f.owned().slideContentEdit?.instanceId).toBe('text')
  expect(f.beginSpot).not.toHaveBeenCalled()
  expect(f.h.model().project.instances.text.data).toEqual(original)
  const hitsBeforeAck = paint.mock.calls.length
  // Nothing is under the old screen coordinate once A finishes. The captured
  // second field, rather than another screen hit, must receive the edit intent.
  painted = () => []
  await act(async () => { acknowledge(); await pending })
  await waitFor(() => expect(f.owned().slideContentEdit?.authorSpot?.authorKey).toBe('label'))
  expect(f.owned().slideContentEdit?.instanceId).toBe('source')
  expect(f.beginSpot).toHaveBeenCalledOnce()
  expect(paint).toHaveBeenCalledTimes(hitsBeforeAck)
  expect(f.h.model().project.instances.text.data).toEqual(JSON.parse(JSON.stringify(createTextData('A 的待确认修改'))))
  expect(f.h.first.read().undoDepth).toBe(1)
  expect(document.querySelectorAll('.selection-quick-bar')).toHaveLength(1)
  expect(f.report).not.toHaveBeenCalled()
})

it.each([false, true])('anchors one real quick bar to a precise field and exposes only its actual transform capability (geometry: %s)', async geometry => {
  const field = spot(geometry), f = await mount(project(), [field])
  await act(async () => { realm(f, 'component-author-pointer', { authorKey: 'label' }) })
  expect(f.h.bridge.read().interactionSelection).toMatchObject({ kind: 'author-field', instanceId: 'source' })
  expect(f.beginSpot).not.toHaveBeenCalled()
  const toolbar = await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  expect(screen.getAllByRole('toolbar')).toHaveLength(1)
  expect(within(toolbar).getByRole('button', { name: /编辑此处文字|编辑文字/ })).toBeEnabled()
  const bar = toolbar.closest<HTMLElement>('.selection-quick-bar')!
  expect(parseFloat(bar.style.left)).toBeGreaterThanOrEqual(430)
  const chrome = f.ui.container.querySelector('[data-internal-selection]')!
  expect(chrome.querySelector('polygon[stroke="#2563eb"]')).not.toHaveAttribute('stroke-dasharray')
  expect(chrome.querySelector('[data-handle="se"]') !== null).toBe(geometry)
  if (!geometry) {
    await act(async () => { realm(f, 'component-author-pointer', { authorKey: 'label', phase: 'start', pointerId: 6 }) })
    await act(async () => { realm(f, 'component-author-pointer', { authorKey: 'label', phase: 'end', pointerId: 6, localPoint: { x: 70, y: 50 } }) })
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.h.model().project.instances.source.frame).toEqual(frame(430, 90, 300, 180))
    expect(chrome.querySelector('[data-handle]')).toBeNull()
  }
})

it('keeps locked objects selectable with a solid frame and no move, resize or rotation handles', async () => {
  const initial = project(); initial.instances.text.locked = true
  const f = await mount(initial)
  await pointer(f, 1, [150, 90], [175, 110])
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['text'])
  const chrome = f.ui.container.querySelector('[data-testid="slide-layer-selection-overlay"]')!
  expect(chrome.querySelector('polygon[stroke="#2563eb"]')).not.toHaveAttribute('stroke-dasharray')
  expect(chrome.querySelector('[data-handle]')).toBeNull()
  await act(async () => { fireEvent.doubleClick(f.workspace, { clientX: 150, clientY: 90 }) })
  expect(f.begin).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled(); expect(f.h.operations).toHaveLength(0)
})

it('keeps realm selection out of input, cancels a body gesture, and ignores its late end after another selection', async () => {
  const f = await mount(project(), [spot(false)])
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'start', pointerId: 8 }) })
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['source'])
  expect(f.beginSpot).not.toHaveBeenCalled()
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'update', pointerId: 8, localPoint: { x: 60, y: 40 } }) })
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'cancel', pointerId: 8 }) })
  await pointer(f, 9, [150, 90])
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'end', pointerId: 8, localPoint: { x: 100, y: 60 } }) })
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['text'])
  expect(f.commit).not.toHaveBeenCalled(); expect(f.h.operations).toHaveLength(0)
  await act(async () => { realm(f, 'component-author-pointer', { authorKey: 'label' }) })
  expect(f.beginSpot).not.toHaveBeenCalled()
  await act(async () => { realm(f, 'component-author-double-click', { authorKey: 'label' }) })
  await waitFor(() => expect(f.beginSpot).toHaveBeenCalledOnce())
  expect(screen.getAllByRole('toolbar')).toHaveLength(1)
})

it('drags a source realm background once without entering its internal field editor', async () => {
  const f = await mount(project(), [spot(false)])
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'start', pointerId: 10 }) })
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'end', pointerId: 10, localPoint: { x: 70, y: 50 } }) })
  await waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
  expect(f.h.model().project.instances.source.frame).toEqual(frame(470, 120, 300, 180))
  expect(f.h.first.read().undoDepth).toBe(1)
  expect(f.beginSpot).not.toHaveBeenCalled(); expect(f.owned().slideContentEdit).toBeNull()
})

it('maps later realm pointer samples through the live preview matrix instead of its old authored frame', async () => {
  const f = await mount()
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'start', pointerId: 12, localPoint: { x: 30, y: 20 } }) })
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'update', pointerId: 12, localPoint: { x: 50, y: 20 } }) })
  const object = f.ui.container.querySelector<HTMLElement>('[data-component-instance="source"]')!
  expect(object.style.transform).toBe('matrix(1,0,0,1,450,90)')
  // The moving iframe has shifted 20 client pixels. The same local point now
  // represents another 20 pixels in the user's viewport, not a stationary pointer.
  await act(async () => { realm(f, 'component-author-pointer', { phase: 'end', pointerId: 12, localPoint: { x: 50, y: 20 } }) })
  await waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
  expect(f.h.model().project.instances.source.frame).toEqual(frame(470, 90, 300, 180))
  expect(f.h.first.read().undoDepth).toBe(1)
})

it('opens a precise realm field context menu without leaving a transform gesture for subsequent pointer events', async () => {
  const f = await mount(project(), [spot(true)]), preview = vi.fn<NonNullable<SlideWorkspacePorts['previewAuthorSpot']>>(() => true)
  f.ports.previewAuthorSpot = preview
  await act(async () => { realm(f, 'component-author-pointer', { authorKey: 'label', button: 2, pointerId: 14 }) })
  const chrome = f.ui.container.querySelector('[data-internal-selection]')!
  const before = chrome.querySelector('polygon')!.getAttribute('points')
  await act(async () => {
    realm(f, 'component-author-pointer', { authorKey: 'label', phase: 'update', pointerId: 14, localPoint: { x: 70, y: 50 } })
    fireEvent.pointerMove(f.workspace, { pointerId: 14, clientX: 510, clientY: 150 })
    fireEvent.pointerUp(f.workspace, { pointerId: 14, button: 2, clientX: 510, clientY: 150 })
  })
  expect(chrome.querySelector('polygon')!.getAttribute('points')).toBe(before)
  expect(preview.mock.calls.some(([, geometry]) => geometry != null)).toBe(false)
  expect(f.commit).not.toHaveBeenCalled(); expect(f.h.operations).toHaveLength(0)
  expect(f.h.model().project.instances.source.frame).toEqual(frame(430, 90, 300, 180))
})

it('selects the group over its text, enters one hierarchy on double click and returns through the view owner without changing the document', async () => {
  const initial = project(true), f = await mount(initial)
  await pointer(f, 1, [150, 100])
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['group'])
  expect(f.begin).not.toHaveBeenCalled()
  await act(async () => { fireEvent.doubleClick(f.workspace, { clientX: 150, clientY: 100 }) })
  expect(f.h.bridge.read().activeGroupId).toBe('group')
  await pointer(f, 2, [150, 100])
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['text'])
  // Workspace's keyboard router owns Escape; the standalone surface exposes the
  // same leaveGroup port that the router and visible return action invoke.
  await act(async () => { f.ports.leaveGroup?.() })
  expect(f.h.bridge.read().activeGroupId).toBeNull()
  expect(f.h.bridge.read().selectedInstanceIds).toEqual(['group'])
  expect(f.h.model().project).toEqual(initial); expect(f.h.first.read().undoDepth).toBe(0)
})
