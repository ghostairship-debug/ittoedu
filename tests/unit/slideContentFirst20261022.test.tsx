import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { SlideLocationWorkspace, type SlideWorkspacePorts, type SlideWorkspaceSnapshot } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform'
import { authorFieldFromSpot, authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'
import { OBJECT_CONTEXT_MENU_EVENT, type ObjectContextMenuRequest } from '../../src/renderer/editing/commands/objectContextMenu'
import type { ComponentAuthorHitRequest } from '../../src/renderer/components/componentAuthorHit'

const native = vi.hoisted(() => ({ capture: vi.fn(), begin: vi.fn(), placeCaret: vi.fn(), resolveSelection: vi.fn() }))
const pointerCaptureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
const pointerReleaseDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')
vi.mock('../../src/renderer/ui/workspaces/useSlideNativeTextEditor', () => ({ useSlideNativeTextEditor: () => ({ ...native, editor: null }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
beforeEach(() => {
  native.capture.mockReset(); native.begin.mockReset(); native.placeCaret.mockReset(); native.resolveSelection.mockReset()
  native.capture.mockReturnValue(null); native.resolveSelection.mockReturnValue(null)
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 640, width: 960, height: 640, toJSON() {} })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value() {} })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (pointerCaptureDescriptor) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', pointerCaptureDescriptor)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture
  if (pointerReleaseDescriptor) Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', pointerReleaseDescriptor)
  else delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture
})
function fixture() {
  const project = createBlankCourseProjectV10('Content first')
  const root = testContainerInstance(project, 0); root.container.designSize = { width: 960, height: 640 }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('原文'))), frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 100, 60] } }
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: { label: 'abcd' }, frame: { width: 200, height: 120, transform: [1, 0, 0, 1, 400, 60] } }
  root.childIds = ['text', 'custom']
  let view: SlideWorkspaceSnapshot = { project, documentId: 'document', epoch: 'epoch', rootInstanceId: root.id, editingContainerId: root.id,
    surfaceId: root.id, selectedInstanceIds: [], activeStateId: null, canvasMode: 'edit', contentEdit: null, drawTool: null, activation: 0, assetUrls: {} }
  const report = vi.fn(), select = vi.fn(), beginSpotEdit = vi.fn(async () => null), selectAuthorSpot = vi.fn(), commitTextEdit = vi.fn(async () => {})
  const ports: SlideWorkspacePorts = { read: () => view, capture: vi.fn(() => { throw new Error('A content hit must not capture the entire project') }),
    async commit() {}, async edit() {}, select, selectAuthorSpot, selectSurface() {}, setCanvasMode() {}, setDrawTool() {}, report, paste() {}, selectAll() {},
    beginTextEdit: () => null, beginSpotEdit, updateDataDraft() {}, commitTextEdit, cancelTextEdit() {}, undo() {}, redo() {}, onElement() {}, onTargetElement() {},
    addTextNode() {}, addFormulaNode() {}, addRectangleNode() {}, addShapeNode() {}, addTableNode() {}, addChartNode() {}, addExternalComponentNode() {}, drawShapeNode() {} }
  const element = () => <SlideLocationWorkspace snapshot={view} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />
  return { project, root, ports, element, select, report, beginSpotEdit, selectAuthorSpot, commitTextEdit,
    get view() { return view }, set view(next: SlideWorkspaceSnapshot) { view = next } }
}

function hoverFrames() {
  let sequence = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id) })
  return { pending, flush: () => act(() => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(1)) }) }
}

function objectGestureFixture() {
  const f = fixture()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640)
  f.ports.capture = vi.fn(() => ({ documentId: 'document', epoch: 'epoch', surfaceId: f.root.id, activeStateId: null, project: f.project, editingProject: f.project } as never))
  const commit = vi.fn<SlideWorkspacePorts['commit']>(async () => {})
  f.ports.commit = commit
  return { f, commit, frames: hoverFrames() }
}

it('coalesces object preview to the latest point of each frame and commits the actual up point before another frame', async () => {
  const { f, commit, frames } = objectGestureFixture()
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' }), object = document.querySelector('[data-component-instance="custom"]')!
  fireEvent.pointerDown(workspace, { pointerId: 31, button: 0, clientX: 420, clientY: 75, altKey: true })
  fireEvent.pointerMove(workspace, { pointerId: 31, clientX: 430, clientY: 80, altKey: true })
  fireEvent.pointerMove(workspace, { pointerId: 31, clientX: 450, clientY: 85, altKey: true })
  expect(frames.pending.size).toBe(1)
  expect(object).toHaveStyle({ transform: 'matrix(1,0,0,1,400,60)' })
  expect(commit).not.toHaveBeenCalled()
  frames.flush()
  expect(object).toHaveStyle({ transform: 'matrix(1,0,0,1,430,70)' })
  fireEvent.pointerMove(workspace, { pointerId: 31, clientX: 460, clientY: 95, altKey: true })
  fireEvent.pointerUp(workspace, { pointerId: 31, button: 0, clientX: 480, clientY: 105, altKey: true })
  await waitFor(() => expect(commit).toHaveBeenCalledOnce())
  expect(commit.mock.calls[0][0]).toMatchObject([{ type: 'frame.set', instanceId: 'custom', frame: { transform: [1, 0, 0, 1, 460, 90] } }])
  expect(frames.pending.size).toBe(0)
  expect(f.project.instances.custom.frame!.transform).toEqual([1, 0, 0, 1, 400, 60])
})

it('keeps drag click suppression when move and up arrive before the preview frame', async () => {
  const { f, commit, frames } = objectGestureFixture()
  f.ports.authorSpots = () => [{ id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }]
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' })
  fireEvent.pointerDown(workspace, { pointerId: 32, button: 0, clientX: 550, clientY: 105, altKey: true })
  fireEvent.pointerMove(workspace, { pointerId: 32, clientX: 500, clientY: 90, altKey: true })
  fireEvent.pointerUp(workspace, { pointerId: 32, button: 0, clientX: 480, clientY: 80, altKey: true })
  fireEvent.click(document.querySelector('[data-author-spot]')!)
  await waitFor(() => expect(commit).toHaveBeenCalledOnce())
  expect(f.beginSpotEdit).not.toHaveBeenCalled(); expect(f.selectAuthorSpot).not.toHaveBeenCalled()
  expect(frames.pending.size).toBe(0)
})

it('cancels queued object preview on pointer cancel and context change without a late commit', () => {
  const { f, commit, frames } = objectGestureFixture()
  const rendered = render(f.element()), workspace = screen.getByRole('main', { name: '画布' })
  const object = document.querySelector('[data-component-instance="custom"]')!
  fireEvent.pointerDown(workspace, { pointerId: 33, button: 0, clientX: 420, clientY: 75, altKey: true })
  fireEvent.pointerMove(workspace, { pointerId: 33, clientX: 450, clientY: 85, altKey: true })
  fireEvent.pointerCancel(workspace, { pointerId: 33 })
  expect(frames.pending.size).toBe(0)
  frames.flush()
  expect(object).toHaveStyle({ transform: 'matrix(1,0,0,1,400,60)' })
  fireEvent.pointerDown(workspace, { pointerId: 34, button: 0, clientX: 420, clientY: 75, altKey: true })
  fireEvent.pointerMove(workspace, { pointerId: 34, clientX: 470, clientY: 95, altKey: true })
  f.view = { ...f.view, epoch: 'different-session' }
  rendered.rerender(f.element())
  expect(frames.pending.size).toBe(0)
  frames.flush()
  fireEvent.pointerUp(workspace, { pointerId: 34, button: 0, clientX: 480, clientY: 105, altKey: true })
  expect(commit).not.toHaveBeenCalled()
  expect(object).toHaveStyle({ transform: 'matrix(1,0,0,1,400,60)' })
})

it('coalesces HUD preview but restores its actual up position and keeps a pure click free of commits', async () => {
  const { f, commit, frames } = objectGestureFixture()
  f.root.childIds = ['text']; f.project.global.overlay = ['custom']
  f.project.instances.custom.viewportPinned = true
  f.project.instances.custom.frame = { width: 100, height: 80, transform: [1, 0, 0, 1, 200, 120] }
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' }), object = document.querySelector('[data-component-instance="custom"]')!
  expect(object).toHaveStyle({ transform: 'matrix(0.75,0,0,0.75,150,140)' })
  fireEvent.pointerDown(workspace, { pointerId: 35, button: 0, clientX: 180, clientY: 160 })
  fireEvent.pointerMove(workspace, { pointerId: 35, clientX: 210, clientY: 170 })
  fireEvent.pointerMove(workspace, { pointerId: 35, clientX: 230, clientY: 180 })
  expect(frames.pending.size).toBe(1)
  expect(object).toHaveStyle({ transform: 'matrix(0.75,0,0,0.75,150,140)' })
  frames.flush()
  expect(object).toHaveStyle({ transform: 'matrix(0.75,0,0,0.75,200,160)' })
  fireEvent.pointerMove(workspace, { pointerId: 35, clientX: 240, clientY: 190 })
  fireEvent.pointerUp(workspace, { pointerId: 35, button: 0, clientX: 260, clientY: 200 })
  await waitFor(() => expect(commit).toHaveBeenCalledOnce())
  const edit = commit.mock.calls[0][0][0]
  expect(edit.type).toBe('frame.set')
  if (edit.type !== 'frame.set') throw new Error('Expected frame')
  expect(edit.frame!.transform[4]).toBeCloseTo(200 + 80 / .75)
  expect(edit.frame!.transform[5]).toBeCloseTo(120 + 40 / .75)
  expect(frames.pending.size).toBe(0)
  expect(f.project.instances.custom.frame.transform).toEqual([1, 0, 0, 1, 200, 120])
  fireEvent.pointerDown(workspace, { pointerId: 36, button: 0, clientX: 180, clientY: 160 })
  fireEvent.pointerUp(workspace, { pointerId: 36, button: 0, clientX: 180, clientY: 160 })
  expect(commit).toHaveBeenCalledOnce()
})

it('uses the final pan delta after a frame and discards a cancelled pan before further move events', () => {
  const { f, commit, frames } = objectGestureFixture()
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' }), stage = document.querySelector<HTMLElement>('.canvas-stage-stack')!
  fireEvent.pointerDown(workspace, { pointerId: 37, button: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(workspace, { pointerId: 37, clientX: 110, clientY: 105 })
  fireEvent.pointerMove(workspace, { pointerId: 37, clientX: 120, clientY: 110 })
  expect(stage.style.left).toBe('0px'); expect(frames.pending.size).toBe(1)
  frames.flush()
  expect(stage.style.left).toBe('20px'); expect(stage.style.top).toBe('10px')
  fireEvent.pointerMove(workspace, { pointerId: 37, clientX: 125, clientY: 115 })
  fireEvent.pointerUp(workspace, { pointerId: 37, button: 1, clientX: 140, clientY: 130 })
  expect(stage.style.left).toBe('40px'); expect(stage.style.top).toBe('30px'); expect(frames.pending.size).toBe(0)
  fireEvent.pointerDown(workspace, { pointerId: 38, button: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(workspace, { pointerId: 38, clientX: 150, clientY: 150 })
  fireEvent.pointerCancel(workspace, { pointerId: 38 })
  expect(frames.pending.size).toBe(0)
  fireEvent.pointerMove(workspace, { pointerId: 38, clientX: 170, clientY: 170 })
  frames.flush()
  expect(stage.style.left).toBe('40px'); expect(stage.style.top).toBe('30px'); expect(stage.dataset.panning).toBeUndefined()
  expect(commit).not.toHaveBeenCalled()
})

it('updates the hidden-object count from live instance visibility even when project identity stays the same', () => {
  const f = fixture(), rendered = render(f.element())
  expect(screen.queryByRole('button', { name: '1 个隐藏对象' })).toBeNull()
  f.project.instances.custom.visible = false
  rendered.rerender(f.element())
  expect(screen.getByRole('button', { name: '1 个隐藏对象' })).toBeVisible()
  f.project.instances.custom.visible = true
  rendered.rerender(f.element())
  expect(screen.queryByRole('button', { name: '1 个隐藏对象' })).toBeNull()
})

it('coalesces hover per frame, keeps one precise realm hit and resolves only its latest queued point without rescanning slot roots', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  const frames = hoverFrames()
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' }), content = document.querySelector('[data-component-render="custom"]')!
  const scan = vi.spyOn(document.querySelector('.canvas-stage-stack')!, 'querySelectorAll')
  const requests: ComponentAuthorHitRequest[] = []
  content.addEventListener('component-author-hit-test', event => { event.preventDefault(); requests.push((event as CustomEvent<ComponentAuthorHitRequest>).detail) })
  fireEvent.pointerMove(workspace, { pointerId: 10, clientX: 420, clientY: 75 })
  fireEvent.pointerMove(workspace, { pointerId: 10, clientX: 421, clientY: 75 })
  expect(requests).toHaveLength(0); expect(frames.pending.size).toBe(1)
  frames.flush()
  expect(requests).toHaveLength(1); expect(requests[0].point).toEqual({ x: 21, y: 15 })
  fireEvent.pointerMove(workspace, { pointerId: 10, clientX: 422, clientY: 75 })
  fireEvent.pointerMove(workspace, { pointerId: 10, clientX: 423, clientY: 75 })
  frames.flush()
  expect(requests).toHaveLength(1)
  await act(async () => requests[0].resolve({ authorKey: 'field', painted: true }))
  expect(document.querySelector('.canvas-authoring-target--hovered')).toBeNull()
  expect(frames.pending.size).toBe(1)
  frames.flush()
  expect(requests).toHaveLength(2); expect(requests[1].point).toEqual({ x: 23, y: 15 })
  await act(async () => requests[1].resolve({ authorKey: 'field', painted: true }))
  expect(document.querySelector('.canvas-authoring-target--hovered')?.getAttribute('data-author-spot')).toContain('custom:field:')
  expect(scan).not.toHaveBeenCalled()
  expect(f.ports.capture).not.toHaveBeenCalled(); expect(f.select).not.toHaveBeenCalled()
})

it('does not let an older hover response overwrite a newer native content click', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  const frames = hoverFrames()
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' }), content = document.querySelector('[data-component-render="custom"]')!
  let resolve!: ComponentAuthorHitRequest['resolve']
  content.addEventListener('component-author-hit-test', event => { event.preventDefault(); resolve = (event as CustomEvent<ComponentAuthorHitRequest>).detail.resolve })
  fireEvent.pointerMove(workspace, { pointerId: 11, clientX: 420, clientY: 75 }); frames.flush()
  const enter = vi.fn(() => true); native.capture.mockReturnValue(enter)
  fireEvent.pointerDown(workspace, { pointerId: 12, button: 0, clientX: 150, clientY: 90 })
  expect(enter).toHaveBeenCalledOnce()
  await act(async () => resolve({ authorKey: 'field', painted: true }))
  expect(document.querySelector('.canvas-authoring-target--hovered')).toBeNull()
  expect(f.beginSpotEdit).not.toHaveBeenCalled(); expect(f.ports.capture).not.toHaveBeenCalled()
})

it('single-clicks native text through the professional capture without selecting its containing object', () => {
  const f = fixture(), enter = vi.fn(() => true)
  native.capture.mockReturnValue(enter)
  render(f.element())
  fireEvent.pointerDown(screen.getByRole('main', { name: '画布' }), { pointerId: 1, button: 0, clientX: 150, clientY: 90 })
  expect(native.capture).toHaveBeenCalledWith('text', { x: 150, y: 90 }, { x: 150, y: 90 })
  expect(enter).toHaveBeenCalledOnce(); expect(f.select).not.toHaveBeenCalled(); expect(f.ports.capture).not.toHaveBeenCalled()
})

it('captures a professional field before flush and resumes it after ACK without hitting the old point again', async () => {
  const f = fixture(), enter = vi.fn(() => true)
  native.capture.mockReturnValue(enter)
  f.view = { ...f.view, contentEdit: { composing: false, instanceId: 'custom', target: { documentId: 'document', epoch: 'epoch', surfaceId: f.root.id, activeStateId: null } } as never }
  let release!: () => void
  f.commitTextEdit.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const rendered = render(f.element())
  fireEvent.pointerDown(screen.getByRole('main', { name: '画布' }), { pointerId: 2, button: 0, clientX: 150, clientY: 90 })
  await waitFor(() => expect(f.commitTextEdit).toHaveBeenCalledOnce())
  expect(enter).not.toHaveBeenCalled()
  f.project.instances.text.frame!.transform[4] = 700
  f.project.instances.custom.frame!.transform[4] = 100
  f.view = { ...f.view, contentEdit: null }
  await act(async () => { rendered.rerender(f.element()); release() })
  await waitFor(() => expect(enter).toHaveBeenCalledOnce())
  expect(native.capture).toHaveBeenCalledOnce(); expect(f.select).not.toHaveBeenCalled()
})

it('consumes a realm field address and bounded UTF16 caret without replacing it with instance selection', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  render(f.element())
  const root = document.querySelector('[data-component-render="custom"]')!
  await act(async () => { root.dispatchEvent(new CustomEvent('component-author-pointer', { bubbles: true, cancelable: true,
    detail: { instanceId: 'custom', mountGeneration: 1, localPoint: { x: 20, y: 15 }, authorKey: 'field', caretOffset: 99 } })) })
  expect(f.selectAuthorSpot).toHaveBeenCalledWith(spot)
  expect(f.beginSpotEdit).toHaveBeenCalledWith(spot, undefined)
  expect(native.placeCaret).toHaveBeenCalledWith('custom', { x: 420, y: 75 }, 4)
  expect(f.select).not.toHaveBeenCalled()
})

it('keeps a later Nodes selection when a field handoff is waiting for the old input ACK', async () => {
  const f = fixture(), enter = vi.fn(() => true)
  native.capture.mockReturnValue(enter)
  f.view = { ...f.view, selectedInstanceIds: ['custom'], interactionSelection: { kind: 'objects', instanceIds: ['custom'] },
    contentEdit: { composing: false, instanceId: 'custom', target: { documentId: 'document', epoch: 'epoch', surfaceId: f.root.id, activeStateId: null } } as never }
  let release!: () => void
  f.commitTextEdit.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const rendered = render(f.element())
  fireEvent.pointerDown(screen.getByRole('main', { name: '画布' }), { pointerId: 3, button: 0, clientX: 150, clientY: 90 })
  await waitFor(() => expect(f.commitTextEdit).toHaveBeenCalledOnce())
  f.view = { ...f.view, selectedInstanceIds: ['text'], interactionSelection: { kind: 'objects', instanceIds: ['text'] }, contentEdit: null }
  await act(async () => { rendered.rerender(f.element()); release() })
  expect(enter).not.toHaveBeenCalled(); expect(f.select).not.toHaveBeenCalled(); expect(f.beginSpotEdit).not.toHaveBeenCalled()
})

it('sends the exact field menu identity and ignores its callback after a different selection', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  f.selectAuthorSpot.mockImplementation((value: ComponentAuthorSpot) => {
    f.view = { ...f.view, selectedInstanceIds: [value.instanceId], interactionSelection: { kind: 'author-field', instanceId: value.instanceId, field: authorFieldFromSpot(value) } }
  })
  render(f.element())
  const workspace = screen.getByRole('main', { name: '画布' })
  let request: ObjectContextMenuRequest | undefined
  workspace.addEventListener(OBJECT_CONTEXT_MENU_EVENT, event => { request = (event as CustomEvent<ObjectContextMenuRequest>).detail; event.preventDefault() })
  fireEvent.contextMenu(workspace, { clientX: 420, clientY: 75 })
  await waitFor(() => expect(request?.selectionIdentity).toBe(authorFieldIdentity(spot.instanceId, spot)))
  expect(request?.itemIds).toEqual(['custom'])
  f.view = { ...f.view, selectedInstanceIds: ['text'], interactionSelection: { kind: 'objects', instanceIds: ['text'] } }
  await act(async () => { request?.extra?.[0].run?.() })
  expect(f.beginSpotEdit).not.toHaveBeenCalled(); expect(f.ports.capture).not.toHaveBeenCalled()
})

it('keeps a Source painted non-field region draggable through its original object identity', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  f.ports.capture = vi.fn(() => ({ documentId: 'document', epoch: 'epoch', surfaceId: f.root.id, activeStateId: null, project: f.project, editingProject: f.project } as never))
  const commit = vi.fn<SlideWorkspacePorts['commit']>(async () => {})
  f.ports.commit = commit
  const rendered = render(f.element()), workspace = screen.getByRole('main', { name: '画布' })
  const content = document.querySelector('[data-component-render="custom"]')!
  let resolveHit!: ComponentAuthorHitRequest['resolve']
  content.addEventListener('component-author-hit-test', event => { event.preventDefault(); resolveHit = (event as CustomEvent<ComponentAuthorHitRequest>).detail.resolve })
  fireEvent.pointerDown(workspace, { pointerId: 4, button: 0, clientX: 420, clientY: 75 })
  fireEvent.pointerMove(workspace, { pointerId: 4, clientX: 460, clientY: 105 })
  fireEvent.pointerUp(workspace, { pointerId: 4, button: 0, clientX: 460, clientY: 105 })
  f.project.instances.custom.frame!.transform[4] = 700
  f.project.instances.text.frame!.transform[4] = 400
  await act(async () => { rendered.rerender(f.element()); resolveHit({ painted: true, authorKey: null }) })
  await waitFor(() => expect(commit).toHaveBeenCalledOnce())
  expect(f.select).toHaveBeenCalledWith(['custom'])
  expect(commit.mock.calls[0][0]).toMatchObject([{ type: 'frame.set', instanceId: 'custom' }])
  expect(f.beginSpotEdit).not.toHaveBeenCalled(); expect(f.selectAuthorSpot).not.toHaveBeenCalled()
})

it('opens a Source non-field context menu for the original object after asynchronous paint resolution', async () => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  f.select.mockImplementation((ids: readonly string[]) => { f.view = { ...f.view, selectedInstanceIds: ids, interactionSelection: { kind: 'objects', instanceIds: ids } } })
  const rendered = render(f.element()), workspace = screen.getByRole('main', { name: '画布' })
  const content = document.querySelector('[data-component-render="custom"]')!
  let resolveHit!: ComponentAuthorHitRequest['resolve'], request: ObjectContextMenuRequest | undefined
  content.addEventListener('component-author-hit-test', event => { event.preventDefault(); resolveHit = (event as CustomEvent<ComponentAuthorHitRequest>).detail.resolve })
  workspace.addEventListener(OBJECT_CONTEXT_MENU_EVENT, event => { request = (event as CustomEvent<ObjectContextMenuRequest>).detail; event.preventDefault() })
  fireEvent.contextMenu(workspace, { clientX: 420, clientY: 75 })
  f.project.instances.custom.frame!.transform[4] = 700
  f.project.instances.text.frame!.transform[4] = 400
  await act(async () => { rendered.rerender(f.element()); resolveHit({ painted: true, authorKey: null }) })
  await waitFor(() => expect(request?.itemIds).toEqual(['custom']))
  expect(request?.selectionIdentity).toBeUndefined()
  expect(f.selectAuthorSpot).not.toHaveBeenCalled(); expect(f.ports.capture).not.toHaveBeenCalled()
})

it.each(['pointer', 'double-click'])('does not flush a newer editor when an old %s paint result arrives after a Nodes selection', async route => {
  const f = fixture(), spot: ComponentAuthorSpot = { id: 'field', authorKey: 'field', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: 'abcd',
    dataPath: ['label'], localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  f.ports.authorSpots = () => [spot]
  const rendered = render(f.element()), workspace = screen.getByRole('main', { name: '画布' })
  const content = document.querySelector('[data-component-render="custom"]')!
  let resolveHit!: ComponentAuthorHitRequest['resolve']
  content.addEventListener('component-author-hit-test', event => { event.preventDefault(); resolveHit = (event as CustomEvent<ComponentAuthorHitRequest>).detail.resolve })
  if (route === 'pointer') content.dispatchEvent(new CustomEvent('component-author-pointer', { bubbles: true, cancelable: true,
    detail: { instanceId: 'custom', mountGeneration: 1, localPoint: { x: 20, y: 15 } } }))
  else fireEvent.doubleClick(workspace, { clientX: 420, clientY: 75 })
  f.view = { ...f.view, selectedInstanceIds: ['text'], interactionSelection: { kind: 'objects', instanceIds: ['text'] },
    contentEdit: { composing: false, instanceId: 'text', target: { documentId: 'document', epoch: 'epoch', surfaceId: f.root.id, activeStateId: null } } as never }
  await act(async () => { rendered.rerender(f.element()); resolveHit({ painted: true, authorKey: 'field' }) })
  expect(f.commitTextEdit).not.toHaveBeenCalled(); expect(f.beginSpotEdit).not.toHaveBeenCalled(); expect(f.selectAuthorSpot).not.toHaveBeenCalled()
})
