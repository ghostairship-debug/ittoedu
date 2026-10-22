import { withTestTeacherController } from '../helpers/glxWorkFixture'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createCrossSurfaceCommands } from '../../src/renderer/composition/crossSurfaceCommands'
import { createTeacherControllerHudGeometry, projectTeacherControllerInstances } from '../../src/shared/teacherControllerViewportGeometry'
const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: (select: (state: typeof probe.state) => unknown) => select(probe.state) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('CA356 actual Flow workspace author command aligns global content with teacher HUD through both inverses', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-playback-content') ? new DOMRect(50, 70, 1280, 720) : new DOMRect(20, 30, 640, 360)
  })
  let project = withTestTeacherController(createBlankCourseProjectV10('Flow mixed alignment'))
  const teacher = project.global.overlay[0]
  setRootContainers(project, [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }])
  project.instances[teacher].frame = { width: 200, height: 64, transform: [1, 0, 0, 1, 400, 500] }
  project.instances[teacher].data = { ...project.instances[teacher].data as object, defaultCollapsed: false } as any
  project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  project.instances.logo = { id: 'logo', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData() as any, frame: { width: 60, height: 40, transform: [1, 0, 0, 1, 60, 40] } }
  project.global.overlay.push('logo')
  const resources = { assets: {}, components: {} }, ids = [teacher, 'logo']
  const target = () => ({ documentId: 'flow-geometry', epoch: 'epoch', project, editingProject: project, resources, surfaceId: 'flow', activeStateId: null, instanceIds: ids, instanceId: teacher })
  const editCaptured = vi.fn(async operation => { project = applyComponentOperation(project, operation) })
  const bridge = { captureTarget: target, capture: (edits: any, captured: ReturnType<typeof target>) => captureComponentOperation(captured.project, edits), editCaptured, read: () => ({ activation: 1 }),
    readView: () => ({ surfaceId: 'flow' }), readEditingDocument: () => project, setFeedback() {} }
  const navigation = { read: () => ({ locationId: 'flow', collapsed: false }), subscribe: () => () => {}, changed() {}, setCollapsed() {}, placement: () => ({ x: 0, y: 0 }) }
  probe.state = { courseBridge: bridge, courseKernel: bridge, flowDocumentDrafts: {}, setFlowDocumentDraft() {}, setFlowContextSelection() {}, flowEditingInstance: null, slideContentEdit: null }
  probe.runtime = { resources, selectedInstanceIds: ids, selectInstances() {}, onElement() {}, onTargetElement() {}, world: { beforeProjectionMutation() {}, afterProjectionMutation() {} }, renderInstance: () => null, registerObservation: () => () => {}, navigation }
  const ui = render(<FlowWorkspace documentId="flow-geometry" project={project} surfaceId="flow" toolbarContainer={document.createElement('div')} onSelectImageAsset={async () => null as any} />)
  ui.container.querySelector<HTMLElement>('[data-playback-content]')!.style.transform = 'matrix(2,0,0,2,30,40)'
  const commands = createCrossSurfaceCommands({ kernel: bridge, slide: {}, flow: {}, spatial: {}, shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null, editingScope: 'global' }), patch() {} }, structure: {}, lifecycle: {} } as any)
  await act(async () => { commands.alignSelectedNodes('left'); await Promise.resolve() })
  expect(editCaptured).toHaveBeenCalledOnce()
  const hud = createTeacherControllerHudGeometry({ referenceSize: { width: 1280, height: 720 }, viewportRect: { x: 0, y: 0, width: 640, height: 360 } })
  const shown = projectTeacherControllerInstances(project, hud, navigation as any)
  expect(shown.instances[teacher].frame!.transform[4]).toBeCloseTo(project.instances.logo.frame!.transform[4] * 2 + 30)
  expect(project.instances[teacher].frame!.transform[4]).toBeCloseTo(300)
})
