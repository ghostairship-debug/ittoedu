import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit, ComponentFrame } from '../../src/shared/contracts/component-platform'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import type { FreeObjectTarget } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import type { ComponentAuthorObjectPointer } from '../../src/renderer/ui/workspaces/useComponentAuthorInteraction'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { initialSpatialSurfaceView } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import { SpatialLocationWorkspace, type SpatialLocationWorkspaceProps } from '../../src/renderer/ui/workspaces/SpatialLocationWorkspace'

const owner = vi.hoisted(() => ({
  hit: vi.fn(), capture: vi.fn(), begin: vi.fn(), native: vi.fn(), fieldPointer: vi.fn(), fieldEdit: vi.fn(), fieldTransform: vi.fn(),
  selectedSpot: undefined as ComponentAuthorSpot | undefined, authorTarget: null as FreeObjectTarget | null,
  objectPointer: undefined as ((detail: ComponentAuthorObjectPointer, point: { x: number; y: number }) => void) | undefined,
  resolveTarget: undefined as ((id: string) => string | null) | undefined,
  objectDoubleClick: undefined as ((id: string, point: { x: number; y: number }) => void) | undefined,
}))
vi.mock('../../src/renderer/components/componentAuthorHit', () => ({ visibleComponentAuthorHit: (...args: unknown[]) => owner.hit(...args) }))
vi.mock('../../src/renderer/ui/workspaces/useSlideNativeTextEditor', () => ({ useSlideNativeTextEditor: () => ({ begin: owner.begin, capture: owner.capture, editor: null }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
vi.mock('../../src/renderer/ui/workspaces/useComponentAuthorInteraction', () => ({ useComponentAuthorInteraction: (options: {
  onObjectPointer: typeof owner.objectPointer; resolveObjectTarget: typeof owner.resolveTarget; onObjectDoubleClick: typeof owner.objectDoubleClick
}) => {
  owner.objectPointer = options.onObjectPointer
  owner.resolveTarget = options.resolveObjectTarget; owner.objectDoubleClick = options.onObjectDoubleClick
  return {
  editor: null, selectedSpot: owner.selectedSpot, authorTarget: owner.authorTarget, authorBounds: () => ({ left: 10, top: 10, width: 30, height: 20 }), beginTransform: owner.fieldTransform,
  pointerFromElement: owner.fieldPointer, doubleClickFromElement: owner.fieldEdit, contextMenuFromElement: () => false,
  selectNativeField() {}, fieldIsCurrent: () => false, beginNative: owner.native, openContextMenu() {},
} } }))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
})
beforeEach(() => {
  vi.clearAllMocks()
  owner.hit.mockResolvedValue({ instanceId: 'text', authorKey: null })
  owner.begin.mockReturnValue(false)
  owner.capture.mockReturnValue(() => true)
  owner.native.mockImplementation(async (_id, captured) => captured())
  owner.fieldPointer.mockReturnValue(false); owner.fieldEdit.mockReturnValue(false)
  owner.selectedSpot = undefined; owner.authorTarget = null
})
afterEach(cleanup)
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(options: { locked?: boolean; draft?: boolean; grouped?: boolean; framelessGroup?: boolean; hud?: boolean } = {}) {
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'spatial-unified-selection', revision: 0, title: '空间', assets: {},
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: { text: { id: 'text', definitionId: 'text', data: { text: '文字' }, locked: options.locked, ...(options.hud ? { viewportPinned: true } : {}),
      frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 0, 0] } },
      ...(options.grouped ? { group: { id: 'group', definitionId: 'group', data: {}, childIds: ['text'],
        ...(options.framelessGroup ? {} : { frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } }) } } : {}) },
    global: { underlay: [], overlay: options.hud ? ['text'] : [] }, surfaces: [{ id: 'world', title: '世界', kind: 'spatial', childIds: options.hud ? [] : [options.grouped ? 'group' : 'text'],
      designSize: { width: 800, height: 400 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }] })
  const captured: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'world', activeStateId: null, instanceIds: ['text'], instanceId: 'text' }
  let draft: SlideContentEdit | null = options.draft ? { instanceId: 'text', definitionId: 'text', target: captured, source: 'canvas', data: { text: 'draft' }, originalData: {}, composing: false } : null
  let accept!: () => void, reject!: () => void
  const ack = new Promise<void>((resolve, no) => { accept = () => { draft = null; resolve() }; reject = () => no(new Error('输入提交被拒绝')) })
  const edits = vi.fn(async (_edits: ComponentEdit[], _captured?: CapturedCourseTarget) => {}), select = vi.fn(), commit = vi.fn(() => ack), editContent = vi.fn(), business = vi.fn(), enterGroup = vi.fn()
  const props: SpatialLocationWorkspaceProps = { documentId: 'doc', project, surface: componentSurfaces(project)[0],
    view: initialSpatialSurfaceView(), selectionIds: [options.grouped ? 'group' : 'text'], canvasMode: 'edit', renderInstance: id => <div data-component-instance={id} key={id}>
      <span data-testid="body">文字</span><input data-testid="runtime-input" /><button data-testid="runtime-button" onClick={business}>按钮</button><a data-testid="runtime-link" href="#jump" onClick={business}>链接</a>
      <div data-component-professional-editor=""><textarea data-testid="author-input" /></div>
    </div>, captureTarget: () => captured, onEdits: edits, onSelect: select, onCamera() {}, onActivateFrame() {}, onGraphSelect() {}, onCanvasModeChange() {}, onEditContent: editContent,
    onEnterGroup: enterGroup, contentEdit: draft, contentEditor: { read: () => draft, begin: () => draft, update() {}, commit, cancel() {}, undo() {}, redo() {}, report() {} } }
  const ui = render(<SpatialLocationWorkspace {...props} />), stage = screen.getByTestId('spatial-world-stage')
  const captures = new Set<number>(), capture = vi.fn((id: number) => captures.add(id))
  Object.assign(stage, { setPointerCapture: capture, hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) })
  return { ui, stage, props, select, edits, commit, editContent, business, capture, accept, reject, enterGroup,
    async down(target: Element = screen.getByTestId('body'), id = 7) { await act(async () => fireEvent.pointerDown(target, { pointerId: id, button: 0, clientX: 420, clientY: 220 })) },
    async up(x = 420, y = 220, id = 7) { await act(async () => fireEvent.pointerUp(stage, { pointerId: id, clientX: x, clientY: y })) } }
}

it('selects native text on a single click and starts its existing input owner only on double click', async () => {
  const h = fixture()
  await h.down(); await h.up()
  expect(h.select).toHaveBeenLastCalledWith(['text']); expect(owner.capture).not.toHaveBeenCalled(); expect(owner.native).not.toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled()
  await act(async () => fireEvent.doubleClick(screen.getByTestId('body'), { button: 0, clientX: 420, clientY: 220 }))
  expect(owner.capture).toHaveBeenCalledTimes(1); expect(owner.native).toHaveBeenCalledTimes(1); expect(h.editContent).not.toHaveBeenCalled()
})

it.each(['runtime-input', 'runtime-button', 'runtime-link'])('selects and drags %s in authoring without executing its business click', async name => {
  const h = fixture(), target = screen.getByTestId(name)
  await h.down(target); await h.up(450)
  expect(h.select).toHaveBeenLastCalledWith(['text']); expect(h.edits).toHaveBeenCalledTimes(1)
  expect(h.edits.mock.calls[0][0][0]).toMatchObject({ type: 'frame.set', instanceId: 'text' })
  const edit = h.edits.mock.calls[0][0][0]
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.frame.transform[4]).toBeCloseTo(30 / .84)
  fireEvent.click(target)
  expect(h.business).not.toHaveBeenCalled(); expect(owner.native).not.toHaveBeenCalled()
})

it('keeps pointer gestures in the current author input and leaves run-mode controls operational', async () => {
  const h = fixture()
  await h.down(screen.getByTestId('author-input')); await h.up(460)
  expect(h.select).not.toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} canvasMode="run" />)
  fireEvent.click(screen.getByTestId('runtime-button'))
  expect(h.business).toHaveBeenCalledTimes(1)
})

it('uses screen-pixel slop, flushes the pointerup point and does not submit a return to the initial geometry', async () => {
  const h = fixture()
  await h.down(); await h.up(422)
  expect(h.edits).not.toHaveBeenCalled()
  await h.down(undefined, 8)
  fireEvent.pointerMove(h.stage, { pointerId: 8, clientX: 430, clientY: 220 })
  await h.up(420, 220, 8)
  expect(h.edits).not.toHaveBeenCalled()
  await h.down(undefined, 9); await h.up(445, 230, 9)
  expect(h.edits).toHaveBeenCalledTimes(1)
  const edit = h.edits.mock.calls[0][0][0]
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.frame.transform[4]).toBeCloseTo(25 / .84)
  expect(edit.frame.transform[5]).toBeCloseTo(10 / .84)
})

it('finishes a delayed hit at its final point without reacquiring capture after pointerup', async () => {
  const h = fixture()
  let resolve!: (value: { instanceId: string; authorKey: null }) => void
  owner.hit.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  fireEvent.pointerDown(screen.getByTestId('body'), { pointerId: 10, button: 0, clientX: 420, clientY: 220 })
  fireEvent.pointerUp(h.stage, { pointerId: 10, clientX: 450, clientY: 220 })
  fireEvent.lostPointerCapture(h.stage, { pointerId: 10 })
  await act(async () => resolve({ instanceId: 'text', authorKey: null }))
  expect(h.capture).toHaveBeenCalledTimes(1); expect(h.select).toHaveBeenLastCalledWith(['text']); expect(h.edits).toHaveBeenCalledTimes(1)
  const edit = h.edits.mock.calls[0][0][0]
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.frame.transform[4]).toBeCloseTo(30 / .84)
})

it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels a body drag on %s without a geometry commit', async kind => {
  const h = fixture()
  await h.down()
  fireEvent.pointerMove(h.stage, { pointerId: 7, clientX: 450, clientY: 220 })
  if (kind === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
  else fireEvent(h.stage, new PointerEvent(kind, { pointerId: 7, bubbles: true }))
  await h.up(450)
  expect(h.edits).not.toHaveBeenCalled(); expect(h.stage.querySelector('[data-spatial-snap-guide]')).toBeNull()
})

it('keeps a locked selection outline without handles and assigns the right cursor to each resize direction', () => {
  const h = fixture({ locked: true })
  expect(h.stage.querySelector('[data-spatial-selection]')).not.toBeNull(); expect(h.stage.querySelector('[data-handle]')).toBeNull()
  const project = { ...h.props.project, instances: { ...h.props.project.instances, text: { ...h.props.project.instances.text, locked: false } } }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} project={project} />)
  for (const [direction, cursor] of Object.entries({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' })) {
    expect((h.stage.querySelector(`[data-handle="${direction}"]`) as HTMLElement).style.cursor).toBe(cursor)
  }
})

it.each(['world', 'hud'])('keeps the %s solid object frame while content editing closes every transform entry', plane => {
  const h = fixture({ draft: true, hud: plane === 'hud' })
  const chrome = h.stage.querySelector(plane === 'hud' ? '[data-controller-selection]' : '[data-spatial-object-selection]')!
  expect(chrome.querySelector('polygon[stroke="#2563eb"]')).not.toBeNull()
  expect(chrome.querySelector('[data-handle]')).toBeNull()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} contentEdit={null} contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
  expect(chrome.querySelector('[data-handle="move"]')).not.toBeNull()
  expect(chrome.querySelector('[data-handle="nw"]')).not.toBeNull()
  expect(chrome.querySelector('[data-handle="rotate"]')).not.toBeNull()
})

it('keeps an exact geometry field frame without parent chrome or handles while editing and under an ancestor lock', () => {
  const frame: ComponentFrame = { width: 30, height: 20, transform: [1, 0, 0, 1, 10, 10] }
  owner.selectedSpot = { id: 'field', instanceId: 'text', mountGeneration: 1, kind: 'text', authorKey: 'field', initialValue: '内容', localBounds: frame }
  owner.authorTarget = { instanceId: 'text', frame, parent: { kind: 'surface', surfaceId: 'world' }, parentToSurface: [1, 0, 0, 1, 0, 0], ancestors: [], preserveAspectRatio: false }
  const h = fixture({ grouped: true, draft: true })
  const fieldChrome = h.stage.querySelector('[data-author-selection]')!
  expect(fieldChrome.querySelector('polygon[stroke="#2563eb"]')).not.toBeNull()
  expect(fieldChrome.querySelector('[data-handle]')).toBeNull()
  expect(h.stage.querySelector('[data-spatial-object-selection]')).toBeNull()
  const project = { ...h.props.project, instances: { ...h.props.project.instances, group: { ...h.props.project.instances.group, locked: true } } }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} project={project} contentEdit={null} contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
  expect(fieldChrome.querySelector('polygon[stroke="#2563eb"]')).not.toBeNull()
  expect(fieldChrome.querySelector('[data-handle]')).toBeNull()
  expect(h.stage.querySelector('[data-spatial-object-selection]')).toBeNull()
})

it('shows only the exact field frame and routes field handles to its existing transform owner', async () => {
  owner.selectedSpot = { id: 'field', instanceId: 'text', mountGeneration: 1, kind: 'text', authorKey: 'field', initialValue: '内容',
    localBounds: { width: 30, height: 20, transform: [1, 0, 0, 1, 10, 10] } }
  owner.hit.mockResolvedValue({ instanceId: 'text', authorKey: 'field' }); owner.fieldPointer.mockReturnValue(true)
  const h = fixture()
  expect(h.stage.querySelector('[data-spatial-object-selection]')).toBeNull()
  expect(h.stage.querySelector('[data-author-selection]')).not.toBeNull()
  expect(h.stage.querySelector('[data-handle]')).toBeNull()
  await h.down(); await h.up(450)
  expect(owner.fieldPointer).toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled()
  owner.authorTarget = { instanceId: 'text', frame: owner.selectedSpot.localBounds, parent: { kind: 'surface', surfaceId: 'world' },
    parentToSurface: [1, 0, 0, 1, 0, 0], ancestors: [], preserveAspectRatio: false }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} />)
  const handle = h.stage.querySelector('[data-author-selection] [data-handle="move"]')!
  fireEvent.pointerDown(handle, { pointerId: 11, button: 0, clientX: 10, clientY: 15 })
  expect(owner.fieldTransform).toHaveBeenCalledWith(expect.objectContaining({ pointerId: 11 }), 'drag', undefined)
  expect(h.edits).not.toHaveBeenCalled()
})

it('selects and moves the current group before double click enters its children', async () => {
  const h = fixture({ grouped: true })
  await h.down(); await h.up(450)
  expect(h.select).toHaveBeenLastCalledWith(['group'])
  expect(h.edits.mock.calls[0][0][0]).toMatchObject({ type: 'frame.set', instanceId: 'group' })
  expect(owner.capture).not.toHaveBeenCalled()
  await act(async () => fireEvent.contextMenu(screen.getByTestId('body'), { clientX: 420, clientY: 220 }))
  expect(h.select).toHaveBeenLastCalledWith(['group']); expect(owner.capture).not.toHaveBeenCalled()
  await act(async () => fireEvent.doubleClick(screen.getByTestId('body'), { button: 0, clientX: 420, clientY: 220 }))
  expect(h.enterGroup).toHaveBeenCalledWith('group'); expect(owner.capture).not.toHaveBeenCalled()
  h.edits.mockClear()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} activeGroupId="group" selectionIds={[]} />)
  await h.down(undefined, 8); await h.up(450, 220, 8)
  expect(h.select).toHaveBeenLastCalledWith(['text'])
  expect(h.edits.mock.calls[0][0][0]).toMatchObject({ type: 'frame.set', instanceId: 'text' })
  owner.hit.mockResolvedValueOnce(null)
  await h.down(h.stage, 9); await h.up(420, 220, 9)
  expect(h.select).toHaveBeenLastCalledWith([])
  expect(h.enterGroup).toHaveBeenCalledTimes(1)
})

it('routes a realm object gesture into the same frozen instance and final-point owner without another hit test', async () => {
  const h = fixture()
  act(() => owner.objectPointer!({ instanceId: 'text', localPoint: { x: 0, y: 0 }, phase: 'start', pointerId: 15, button: 0, released: true }, { x: 420, y: 220 }))
  await act(async () => owner.objectPointer!({ instanceId: 'text', localPoint: { x: 30, y: 0 }, phase: 'end', pointerId: 15, button: 0, released: true }, { x: 450, y: 220 }))
  expect(owner.hit).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled()
  expect(h.edits).toHaveBeenCalledTimes(1)
  const edit = h.edits.mock.calls[0][0][0]
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.instanceId).toBe('text'); expect(edit.frame.transform[4]).toBeCloseTo(30 / .84)
  await act(async () => owner.objectPointer!({ instanceId: 'text', localPoint: { x: 30, y: 0 }, phase: 'end', pointerId: 15, button: 0, released: true }, { x: 470, y: 220 }))
  expect(h.edits).toHaveBeenCalledTimes(1)
})

it('keeps realm backgrounds and fields at the current group level and shares the double-click owner', async () => {
  const h = fixture({ grouped: true })
  expect(owner.resolveTarget!('text')).toBe('group')
  act(() => owner.objectPointer!({ instanceId: 'text', localPoint: { x: 0, y: 0 }, phase: 'start', pointerId: 20, button: 0, released: true }, { x: 420, y: 220 }))
  await act(async () => owner.objectPointer!({ instanceId: 'text', localPoint: { x: 30, y: 0 }, phase: 'end', pointerId: 20, button: 0, released: true }, { x: 450, y: 220 }))
  expect(h.select).toHaveBeenLastCalledWith(['group'])
  expect(h.edits.mock.calls[0][0][0]).toMatchObject({ type: 'frame.set', instanceId: 'group' })
  await act(async () => owner.objectDoubleClick!('text', { x: 420, y: 220 }))
  expect(h.enterGroup).toHaveBeenCalledWith('group'); expect(owner.capture).not.toHaveBeenCalled()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} activeGroupId="group" selectionIds={[]} />)
  expect(owner.resolveTarget!('text')).toBe('text')
  await act(async () => owner.objectDoubleClick!('text', { x: 420, y: 220 }))
  expect(owner.native).toHaveBeenCalledTimes(1)
})

it('selects a group without a free frame, shows its real DOM boundary and enters it without moving its child', async () => {
  const h = fixture({ grouped: true, framelessGroup: true })
  expect(owner.resolveTarget!('text')).toBe('group')
  expect(h.stage.querySelector('[data-spatial-frameless-selection="group"]')).not.toBeNull()
  await h.down(); await h.up(450)
  expect(h.select).toHaveBeenLastCalledWith(['group']); expect(h.edits).not.toHaveBeenCalled()
  await act(async () => owner.objectDoubleClick!('text', { x: 420, y: 220 }))
  expect(h.enterGroup).toHaveBeenCalledWith('group'); expect(owner.native).not.toHaveBeenCalled()
})

it('does not reacquire capture when an input ACK arrives after pointerup, and Escape cancels that deferred action', async () => {
  const h = fixture({ draft: true })
  await h.down(); await h.up(450)
  fireEvent.lostPointerCapture(h.stage, { pointerId: 7 })
  expect(h.commit).toHaveBeenCalledTimes(1)
  const capturesBeforeACK = h.capture.mock.calls.length
  await act(async () => h.accept())
  expect(h.capture).toHaveBeenCalledTimes(capturesBeforeACK); expect(h.edits).toHaveBeenCalledTimes(1)
  cleanup()
  const cancelled = fixture({ draft: true })
  await cancelled.down(); await cancelled.up(450)
  fireEvent.keyDown(window, { key: 'Escape' })
  await act(async () => cancelled.accept())
  expect(cancelled.edits).not.toHaveBeenCalled(); expect(cancelled.select).not.toHaveBeenCalled()
})

it('keeps the original input when ACK is rejected and does not replay a deferred drag after the document changes', async () => {
  const rejected = fixture({ draft: true })
  await rejected.down(); await rejected.up(450)
  await act(async () => rejected.reject())
  expect(screen.getByRole('alert')).toHaveTextContent('输入提交被拒绝')
  expect(rejected.props.contentEditor!.read!()!.data).toEqual({ text: 'draft' })
  expect(rejected.edits).not.toHaveBeenCalled(); expect(rejected.select).not.toHaveBeenCalled()
  cleanup()
  const changed = fixture({ draft: true })
  await changed.down(); await changed.up(450)
  changed.ui.rerender(<SpatialLocationWorkspace {...changed.props} documentId="other" />)
  await act(async () => changed.accept())
  expect(changed.edits).not.toHaveBeenCalled(); expect(changed.select).not.toHaveBeenCalled()
})
