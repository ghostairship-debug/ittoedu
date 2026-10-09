import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTeacherControllerData, createTeacherControllerRuntimeImplementation, TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller'
import type { ComponentEdit, ComponentRuntimeScope, CourseProjectV10, MountedComponent } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'

const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => {
  const store = Object.assign((select: (state: typeof probe.state) => unknown) => select(probe.state), { getState: () => probe.state })
  return { useEditorStore: store }
})
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: ({ itemIds }: { itemIds: string[] }) => <span data-testid="shared-controller-quickbar">{itemIds.join(',')}</span> }))
vi.mock('../../src/renderer/document', async () => {
  const React = await import('react')
  return { SharedDocumentEditor: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({ flush: () => ({ ready: true, diagnostics: [] }), drain: async () => ({ ready: true, diagnostics: [] }), paintProjection: (paint: () => void) => paint() }))
    return <div />
  }) }
})
import { FlowLocationWorkspace } from '../../src/renderer/ui/workspaces/FlowLocationWorkspace'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('selects, drags and resizes Flow through the shared affine handles while enabling navigation only in run mode', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'flow-controller', revision: 0, title: 'Mixed',
    definitions: { [TEACHER_CONTROLLER_DEFINITION.id]: TEACHER_CONTROLLER_DEFINITION },
    instances: { teacher: { id: 'teacher', definitionId: TEACHER_CONTROLLER_DEFINITION.id, data: JSON.parse(JSON.stringify({ ...createTeacherControllerData(), defaultCollapsed: false, hudReferenceSize: { width: 800, height: 400 } })),
      frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] } } }, global: { underlay: [], overlay: ['teacher'] }, assets: {},
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [] }, { id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }, { id: 'spatial', kind: 'spatial', title: 'Spatial', childIds: [] }] }
  const before = structuredClone(project), selected = vi.fn(), nextSurface = vi.fn(), write = vi.fn(async (_operation: { edits: ComponentEdit[]; target: CapturedCourseTarget }) => {})
  const target = { documentId: 'doc', epoch: 'activation', project, editingProject: project, resources: { assets: {}, components: {} }, surfaceId: 'flow', activeStateId: null }
  const bridge = { captureTarget: () => target, capture: (edits: unknown) => ({ edits, target }), editCaptured: write }
  let playing = false, mounted: MountedComponent | undefined
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', interactive: () => playing, select: nextSurface })
  const abort = new AbortController()
  const scope: ComponentRuntimeScope = { runScopeId: 'flow-ui', instanceId: 'teacher', generation: 1, signal: abort.signal,
    isActive: () => !abort.signal.aborted, cleanup() {}, target: () => null, events: { emit() {}, subscribe: () => () => {} },
    state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
  probe.state = { courseBridge: bridge, courseKernel: bridge, flowDocumentDrafts: {}, setFlowDocumentDraft() {}, setFlowContextSelection() {}, slideContentEdit: null }
  probe.runtime = { documentId: 'doc', resources: target.resources, selectedInstanceIds: ['teacher'], selectInstances: selected,
    navigation, registerObservation: () => () => {}, renderInstance: () => null, onTargetElement() {},
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {} },
    setPlaying: vi.fn((value: boolean) => { playing = value; navigation.changed() }),
    onElement: (_id: string, element: HTMLElement | null) => {
      if (element) void Promise.resolve(createTeacherControllerRuntimeImplementation(navigation).mount({ root: element, instance: project.instances.teacher, scope })).then(value => { mounted = value })
      else void mounted?.dispose()
    } }
  const props = { documentId: 'doc', project, surfaceId: 'flow', canvasMode: 'edit' as const, editingScope: 'scene' as const, onCanvasModeChange() {}, onSelectImageAsset: async () => null }
  const ui = render(<FlowLocationWorkspace {...props} />)
  await waitFor(() => expect(ui.container.querySelector('[data-control="next-scene"]')).not.toBeNull())
  const controller = ui.container.querySelector<HTMLElement>('[data-controller-authoring-id="teacher"]')!
  controller.setPointerCapture = () => {}
  expect(ui.getByTestId('shared-controller-quickbar')).toHaveTextContent('teacher')
  expect(ui.queryByTestId('teacher-controller-authoring-chrome')).toBeNull()
  expect(controller.style.transform).toBe('matrix(1,0,0,1,0,336)')
  fireEvent.pointerDown(controller, { button: 0, clientX: 10, clientY: 350, pointerId: 1 })
  fireEvent.pointerMove(controller, { clientX: 10, clientY: 300, pointerId: 1 })
  await act(async () => fireEvent.pointerUp(controller, { clientX: 10, clientY: 300, pointerId: 1 }))
  expect(selected).toHaveBeenCalledWith(['teacher'], 'flow')
  expect(write.mock.calls[0][0]).toMatchObject({ edits: [{ type: 'frame.set', instanceId: 'teacher', frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 286] } }] })
  expect(ui.container.querySelector('[data-teacher-controller-authoring-collapse]')).toBeNull()
  const handles = ui.container.querySelector<HTMLElement>('[data-flow-controller-selection]')!
  handles.setPointerCapture = () => {}
  const east = handles.querySelector<HTMLElement>('[data-handle="e"]')!
  fireEvent.pointerDown(east, { button: 0, clientX: 800, clientY: 350, pointerId: 2 })
  fireEvent.pointerMove(handles, { clientX: 720, clientY: 350, pointerId: 2 })
  await act(async () => fireEvent.pointerUp(handles, { clientX: 720, clientY: 350, pointerId: 2 }))
  const resizeEdit = write.mock.calls[1][0].edits[0]
  expect(resizeEdit.type).toBe('frame.set')
  if (resizeEdit.type !== 'frame.set') throw new Error('Expected shared frame edit')
  const resized = resizeEdit.frame
  if (!resized) throw new Error('Expected resized frame')
  expect(resized.width).toBe(880); expect(resized.height).toBe(64)
  expect(resized.transform[0] * resized.width).toBeCloseTo(720)
  expect(resized.transform[4]).toBe(0); expect(resized.transform[5]).toBe(638)
  expect(write.mock.calls[1][0].target).toBe(target)
  act(() => navigation.setCollapsed(true))
  expect(navigation.read().collapsed).toBe(false)
  expect(ui.container.querySelector('nav.guoling-controller')).not.toHaveClass('collapsed')
  act(() => navigation.setCollapsed(false))
  const next = ui.container.querySelector<HTMLButtonElement>('[data-control="next-scene"]')!
  expect(next).toBeDisabled(); fireEvent.click(next); expect(nextSurface).not.toHaveBeenCalled()
  ui.rerender(<FlowLocationWorkspace {...props} canvasMode="run" />)
  await waitFor(() => expect(ui.container.querySelector<HTMLButtonElement>('[data-control="next-scene"]')).not.toBeDisabled())
  await act(async () => fireEvent.click(ui.container.querySelector<HTMLButtonElement>('[data-control="next-scene"]')!))
  expect(nextSurface).toHaveBeenCalledWith('spatial', expect.any(AbortSignal))
  expect(project).toEqual(before)
  ui.unmount(); abort.abort(); navigation.dispose()
  expect(probe.runtime.setPlaying).toHaveBeenLastCalledWith(false)
})
