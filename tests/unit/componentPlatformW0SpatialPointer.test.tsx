import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { initialSpatialSurfaceView } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import { SpatialLocationWorkspace, type SpatialLocationWorkspaceProps } from '../../src/renderer/ui/workspaces/SpatialLocationWorkspace'

// N0 owns the real ProseMirror ACK checks; this test exercises the Spatial consumer gesture.
vi.mock('../../src/renderer/ui/workspaces/useSlideNativeTextEditor', () => ({ useSlideNativeTextEditor: () => ({ begin: () => false, editor: null }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
let restoreBox: () => void
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  })
  const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  restoreBox = () => box.mockRestore()
})
afterAll(() => { restoreBox(); vi.unstubAllGlobals() })
afterEach(cleanup)

function fixture() {
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'w0-pointer', revision: 0, title: '空间', assets: {},
    definitions: { card: { id: 'card', role: 'content', implementation: { kind: 'builtin', key: 'test.card' } } },
    instances: { text: { id: 'text', definitionId: 'card', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 0, 0] } },
      neighbor: { id: 'neighbor', definitionId: 'card', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 200, 0] } } },
    global: { underlay: [], overlay: [] }, surfaces: [{ id: 'world', title: '世界', kind: 'spatial', childIds: ['text', 'neighbor'],
      designSize: { width: 800, height: 400 }, spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } }] }
  const captured: CapturedCourseTarget = { documentId: 'a', epoch: 'epoch-a', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'world', activeStateId: null, instanceIds: ['text'], instanceId: 'text' }
  let draft: SlideContentEdit | null = { instanceId: 'text', definitionId: 'card', target: captured, data: { value: 'draft' }, originalData: {}, composing: false, source: 'canvas' }
  let resolve!: () => void, reject!: (failure: Error) => void
  const ack = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const commit = vi.fn(() => ack), select = vi.fn(), edits = vi.fn(async (_edits: ComponentEdit[], _captured?: CapturedCourseTarget) => {})
  const props: SpatialLocationWorkspaceProps = { documentId: 'a', project, surface: project.surfaces[0],
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
  expect(h.edits.mock.calls[0][0]).toEqual([expect.objectContaining({ type: 'frame.set', instanceId: 'neighbor', frame: expect.objectContaining({ transform: [1, 0, 0, 1, 220, 0] }) })])
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
