import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { initialSpatialSurfaceView } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import { SpatialLocationWorkspace, type SpatialLocationWorkspaceProps } from '../../src/renderer/ui/workspaces/SpatialLocationWorkspace'
import { EDITOR_PAGE_INSETS, fitPage } from '../../src/shared/pageFrame'
import { invertMatrix, transformPoint, type AffineMatrix } from '../../src/core/components/geometry'

// N0 owns the real ProseMirror ACK checks; this test exercises the Spatial consumer gesture.
vi.mock('../../src/renderer/ui/workspaces/useSlideNativeTextEditor', () => ({ useSlideNativeTextEditor: () => ({ begin: () => false, editor: null }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
// This test.card fixture has no World. Exact author-field routing has its own
// consumer tests; an unclaimed pointer must still reach the real gesture owner.
vi.mock('../../src/renderer/ui/workspaces/useComponentAuthorInteraction', () => ({ useComponentAuthorInteraction: () => ({
  editor: null, selectedSpot: undefined, authorBounds: undefined,
  pointerFromElement: () => false, contextMenuFromElement: () => false,
  selectNativeField() {}, fieldIsCurrent: () => false, beginNative: async () => false, openContextMenu() {},
}) }))
let restoreBox: () => void
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  })
  const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  restoreBox = () => { box.mockRestore(); width.mockRestore(); height.mockRestore() }
})
afterAll(() => { restoreBox(); vi.unstubAllGlobals() })
afterEach(cleanup)

function fixture() {
  const project: CourseProjectV10 = createTestProjectFromLegacy({ schemaVersion: 10, id: 'w0-pointer', revision: 0, title: '空间', assets: {},
    definitions: { card: { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.card' } } },
    instances: { text: { id: 'text', definitionId: 'card', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 0, 0] } },
      neighbor: { id: 'neighbor', definitionId: 'card', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 200, 0] } } },
    global: { underlay: [], overlay: [] }, surfaces: [{ id: 'world', title: '世界', kind: 'spatial', childIds: ['text', 'neighbor'],
      designSize: { width: 800, height: 400 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }] })
  const captured: CapturedCourseTarget = { documentId: 'a', epoch: 'epoch-a', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'world', activeStateId: null, instanceIds: ['text'], instanceId: 'text' }
  let draft: SlideContentEdit | null = { instanceId: 'text', definitionId: 'card', target: captured, data: { value: 'draft' }, originalData: {}, composing: false, source: 'canvas' }
  let resolve!: () => void, reject!: (failure: Error) => void
  const ack = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const commit = vi.fn(() => ack), select = vi.fn(), edits = vi.fn(async (_edits: ComponentEdit[], _captured?: CapturedCourseTarget) => {})
  const props: SpatialLocationWorkspaceProps = { documentId: 'a', project, surface: componentSurfaces(project)[0],
    view: initialSpatialSurfaceView(), selectionIds: ['text'], canvasMode: 'edit',
    renderInstance: id => <div key={id} data-component-instance={id} />, captureTarget: () => captured,
    onEdits: edits, onSelect: select, onCamera() {}, onActivateFrame() {}, onGraphSelect() {}, onCanvasModeChange() {},
    contentEdit: draft, contentEditor: { read: () => draft, begin: () => draft, update() {}, commit, cancel() {}, undo() {}, redo() {}, report() {} } }
  const ui = render(<SpatialLocationWorkspace {...props} />), stage = screen.getByTestId('spatial-world-stage')
  const captures = new Set<number>()
  Object.assign(stage, { setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) })
  const gesture = () => {
    fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 620, clientY: 220 })
    fireEvent.pointerMove(stage, { pointerId: 7, button: 0, clientX: 640, clientY: 220 })
    fireEvent.pointerUp(stage, { pointerId: 7, button: 0, clientX: 640, clientY: 220 })
    // Browsers release capture after pointerup even when the owner ACK remains pending.
    fireEvent.lostPointerCapture(stage, { pointerId: 7 })
  }
  return { props, ui, stage, gesture, commit, select, edits, captured,
    accept() { draft = null; resolve() }, reject() { reject(new Error('文字提交被拒绝')) } }
}

it('continues the first neighboring drag after the original text ACK, including pointerup before ACK', async () => {
  const h = fixture(); h.gesture()
  expect(h.commit).toHaveBeenCalledTimes(1)
  expect(h.select).not.toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled()
  await act(async () => h.accept())
  expect(h.select).toHaveBeenLastCalledWith(['neighbor'])
  expect(h.edits).toHaveBeenCalledTimes(1)
  const edit = h.edits.mock.calls[0][0][0]
  expect(edit).toMatchObject({ type: 'frame.set', instanceId: 'neighbor' })
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.frame.transform[4]).toBeCloseTo(200 + 20 / .84)
  expect(edit.frame.transform[5]).toBe(0)
  expect(h.edits.mock.calls[0][1]).toBe(h.captured)
})

it('keeps the original text owner when its ACK is rejected and does not move the neighbor', async () => {
  const h = fixture(); h.gesture()
  await act(async () => h.reject())
  expect(screen.getByRole('alert')).toHaveTextContent('文字提交被拒绝')
  expect(h.props.contentEditor!.read!()!.data).toEqual({ value: 'draft' })
  expect(h.select).not.toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled()
})

it('does not replay a pending old-document drag into the newly active document', async () => {
  const h = fixture(); h.gesture()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} documentId="b" captureTarget={() => ({ ...h.captured, documentId: 'b', epoch: 'epoch-b' })} />)
  await act(async () => h.accept())
  expect(h.select).not.toHaveBeenCalled(); expect(h.edits).not.toHaveBeenCalled()
})

it('keeps the world editor open outside a user camera frame and edits there without changing the camera', async () => {
  const h = fixture(), surface = { ...h.props.surface, spatial: { ...h.props.surface.spatial!, frames: [{ id: 'detail', title: '细节', pose: { x: 0, y: 0, zoom: 4 } }] } }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} contentEdit={null}
    contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
  expect(h.stage.style.inset).toBe('0px')
  expect(h.stage.style.width).toBe(''); expect(h.stage.style.height).toBe('')
  const outline = h.stage.querySelector('[data-spatial-camera-frame="detail"] polygon')!
  expect(outline.getAttribute('points')).toBe('316,168 484,168 484,252 316,252')
  // The neighbor is at x=620, beyond the right edge of the camera's dashed box.
  fireEvent.pointerDown(h.stage, { pointerId: 8, button: 0, clientX: 620, clientY: 220 })
  fireEvent.pointerMove(h.stage, { pointerId: 8, button: 0, clientX: 650, clientY: 230 })
  await act(async () => fireEvent.pointerUp(h.stage, { pointerId: 8, button: 0, clientX: 650, clientY: 230 }))
  expect(h.select).toHaveBeenLastCalledWith(['neighbor'])
  const edit = h.edits.mock.calls[0][0][0]
  expect(edit).toMatchObject({ type: 'frame.set', instanceId: 'neighbor' })
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
  expect(edit.frame.transform[4]).toBeCloseTo(200 + 30 / .84)
  expect(edit.frame.transform[5]).toBeCloseTo(10 / .84)
  expect(surface.spatial.frames[0].pose).toEqual({ x: 0, y: 0, zoom: 4 })
  const onCamera = vi.fn()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} canvasMode="run" contentEdit={null} onCamera={onCamera}
    contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
  expect(Number.parseFloat(h.stage.style.width) / Number.parseFloat(h.stage.style.height)).toBe(2)
  expect(h.stage.style.inset).toBe('auto')
  fireEvent.wheel(h.stage, { ctrlKey: true, deltaY: 10, clientX: 400, clientY: 200 })
  expect(onCamera.mock.calls[0][0]).toMatchObject({ x: 0, y: 0 })
  expect(onCamera.mock.calls[0][0].zoom).toBeCloseTo(.9)
  expect(surface.spatial.frames[0].pose).toEqual({ x: 0, y: 0, zoom: 4 })
})

it('shows a whole default camera frame in a smaller open workspace, leaving visible room outside it', () => {
  const h = fixture(), surface = { ...h.props.surface, designSize: { width: 1280, height: 720 },
    spatial: { ...h.props.surface.spatial!, frames: [{ id: 'full', title: '镜头 1', pose: { x: 0, y: 0, zoom: 1 } }] } }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} contentEdit={null} view={{ ...h.props.view, activeCameraFrameId: 'full' }} />)
  const outline = h.stage.querySelector('[data-spatial-camera-frame="full"] polygon')!
  const corners = outline.getAttribute('points')!.split(' ').map(pair => pair.split(',').map(Number))
  const xs = corners.map(point => point[0]), ys = corners.map(point => point[1])
  expect(Math.min(...xs)).toBeGreaterThan(0); expect(Math.max(...xs)).toBeLessThan(800)
  expect(Math.min(...ys)).toBeGreaterThan(0); expect(Math.max(...ys)).toBeLessThan(400)
  expect((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))).toBeCloseTo(16 / 9)
  expect(h.stage.style.inset).toBe('0px')
  expect(surface.spatial.frames[0].pose).toEqual({ x: 0, y: 0, zoom: 1 })
})

it('keeps a Slides-sized live camera preview through free pan and zoom without creating a saved frame', () => {
  const h = fixture(), surface = { ...h.props.surface, designSize: { width: 1280, height: 720 } }
  const source = structuredClone(surface), onCamera = vi.fn()
  const view = { ...h.props.view, camera: { x: 120, y: -80, zoom: 2, rotation: 25 }, showCameraFrames: false }
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} contentEdit={null} view={view} onCamera={onCamera} />)
  const readCorners = () => h.stage.querySelector('[data-spatial-camera-preview] polygon')!.getAttribute('points')!
    .split(' ').map(pair => pair.split(',').map(Number))
  const fitted = fitPage({ width: 800, height: 400 }, surface.designSize, EDITOR_PAGE_INSETS, 'contain')
  const expected = [[fitted.left, fitted.top], [fitted.left + 1280 * fitted.scale, fitted.top],
    [fitted.left + 1280 * fitted.scale, fitted.top + 720 * fitted.scale], [fitted.left, fitted.top + 720 * fitted.scale]]
  const assertPreview = () => readCorners().forEach((point, index) => point.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(expected[index][axis])))
  const anchorInWorld = () => {
    const value = (h.stage.querySelector('[data-spatial-world]') as HTMLElement).style.transform
    const matrix = value.slice(7, -1).split(',').map(Number) as unknown as AffineMatrix
    return transformPoint(invertMatrix(matrix), { x: 600, y: 150 })
  }
  assertPreview()
  expect(h.stage.querySelector('[data-spatial-camera-frame]')).toBeNull()
  // Zoom at an off-centre point must retain its world coordinate with the same fitted camera origin.
  const beforeAnchor = anchorInWorld()
  fireEvent.wheel(h.stage, { ctrlKey: true, deltaY: -10, clientX: 600, clientY: 150 })
  const camera = onCamera.mock.calls[0][0]
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} contentEdit={null} view={{ ...view, camera }} onCamera={onCamera} />)
  assertPreview()
  expect(anchorInWorld().x).toBeCloseTo(beforeAnchor.x); expect(anchorInWorld().y).toBeCloseTo(beforeAnchor.y)
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} contentEdit={null}
    view={{ ...view, camera: { x: -400, y: 250, zoom: .7, rotation: -35 } }} />)
  assertPreview()
  expect(surface).toEqual(source); expect(h.edits).not.toHaveBeenCalled()
  h.ui.rerender(<SpatialLocationWorkspace {...h.props} surface={surface} canvasMode="run" contentEdit={null} view={view} />)
  expect(h.stage.querySelector('[data-spatial-camera-preview]')).toBeNull()
})

it('paints only the latest queued move in a frame and commits the actual pointerup point', async () => {
  const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame
  let sequence = 0
  const frames = new Map<number, FrameRequestCallback>()
  const schedule = vi.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('requestAnimationFrame', schedule)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const h = fixture()
  try {
    h.ui.rerender(<SpatialLocationWorkspace {...h.props} contentEdit={null} contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
    const node = h.stage.querySelector<HTMLElement>('[data-component-instance="neighbor"]')!
    const before = node.style.transform
    fireEvent.pointerDown(h.stage, { pointerId: 10, button: 0, clientX: 620, clientY: 220 })
    const scheduled = schedule.mock.calls.length
    fireEvent.pointerMove(h.stage, { pointerId: 10, clientX: 635, clientY: 220 })
    fireEvent.pointerMove(h.stage, { pointerId: 10, clientX: 650, clientY: 220 })
    expect(schedule.mock.calls.length - scheduled).toBe(1)
    expect(node.style.transform).toBe(before); expect(h.edits).not.toHaveBeenCalled()
    act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(1)) })
    expect(Number(node.style.transform.slice(7, -1).split(',')[4])).toBeCloseTo(200 + 30 / .84)
    await act(async () => fireEvent.pointerUp(h.stage, { pointerId: 10, clientX: 665, clientY: 220 }))
    expect(h.edits).toHaveBeenCalledTimes(1)
    const edit = h.edits.mock.calls[0][0][0]
    if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a canonical frame edit')
    expect(edit.frame.transform[4]).toBeCloseTo(200 + 45 / .84)
    expect(frames.size).toBe(0)
  } finally { h.ui.unmount(); vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel) }
})

it('discards a queued move when its document scope changes', () => {
  const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>(), cancelled = vi.fn((id: number) => { frames.delete(id) })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(1, callback); return 1 })
  vi.stubGlobal('cancelAnimationFrame', cancelled)
  const h = fixture()
  try {
    h.ui.rerender(<SpatialLocationWorkspace {...h.props} contentEdit={null} contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
    fireEvent.pointerDown(h.stage, { pointerId: 11, button: 0, clientX: 620, clientY: 220 })
    fireEvent.pointerMove(h.stage, { pointerId: 11, clientX: 650, clientY: 220 })
    expect(frames.size).toBe(1)
    h.ui.rerender(<SpatialLocationWorkspace {...h.props} documentId="b" contentEdit={null}
      contentEditor={{ ...h.props.contentEditor!, read: () => null }} captureTarget={() => ({ ...h.captured, documentId: 'b', epoch: 'epoch-b' })} />)
    expect(cancelled).toHaveBeenCalled(); expect(frames.size).toBe(0)
    fireEvent.pointerUp(h.stage, { pointerId: 11, clientX: 650, clientY: 220 })
    expect(h.edits).not.toHaveBeenCalled()
  } finally { h.ui.unmount(); vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel) }
})

it('keeps total pan displacement when a painted frame has not returned new parent camera props before pointerup', () => {
  const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(1, callback); return 1 })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const h = fixture(), onCamera = vi.fn()
  try {
    h.ui.rerender(<SpatialLocationWorkspace {...h.props} contentEdit={null} onCamera={onCamera}
      contentEditor={{ ...h.props.contentEditor!, read: () => null }} />)
    fireEvent.pointerDown(h.stage, { pointerId: 12, button: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(h.stage, { pointerId: 12, clientX: 110, clientY: 100 })
    act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(1)) })
    expect(onCamera.mock.calls.at(-1)?.[0].x).toBeCloseTo(-10 / .84)
    // The parent may commit this transient camera after the next input task.
    fireEvent.pointerUp(h.stage, { pointerId: 12, clientX: 120, clientY: 100 })
    expect(onCamera.mock.calls.at(-1)?.[0].x).toBeCloseTo(-20 / .84)
    expect(h.edits).not.toHaveBeenCalled()
  } finally { h.ui.unmount(); vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel) }
})
