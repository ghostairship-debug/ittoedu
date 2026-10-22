import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { componentSurface } from '../../src/shared/contracts/component-platform'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { SlideLocationWorkspace, type SlideWorkspacePorts, type SlideWorkspaceSnapshot } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'
import { SpatialLocationWorkspace, type SpatialLocationWorkspaceProps } from '../../src/renderer/ui/workspaces/SpatialLocationWorkspace'
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

const probe = vi.hoisted(() => ({ state: {} as any, runtime: {} as any }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: Object.assign((select: (state: any) => unknown) => select(probe.state), { getState: () => probe.state }) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))

let navigation: ComponentNavigationOwner | undefined
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
})
afterEach(() => { cleanup(); navigation?.dispose(); navigation = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(kind: 'slide' | 'flow' | 'spatial') {
  const text = (id: string, x: number) => ({ id, definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextData(id))), frame: { width: 120, height: 40, transform: [1, 0, 0, 1, x, 40] as [number, number, number, number, number, number] } })
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'global-scope', revision: 0, title: '全局范围',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, instances: {
      local: text('local', 10), underlay: text('underlay', 200), overlay: text('overlay', 400),
      ...(kind === 'flow' ? { floating: { ...text('floating', 550), flowPlacement: { space: 'viewport' as const, plane: 'overlay' as const } } } : {}),
    }, global: { underlay: ['underlay'], overlay: ['overlay'] }, assets: {},
    surfaces: [{ id: 'page', kind, title: '当前页', childIds: ['local', ...(kind === 'flow' ? ['floating'] : [])], designSize: { width: 800, height: 400 } }],
  })
  const before = structuredClone(project)
  return { project, before }
}

it('shows only globals in the Slide global editor, retains mounted local content, and restores the full scene for normal editing and try-run', () => {
  const { project, before } = fixture('slide'), onElement = vi.fn()
  let snapshot: SlideWorkspaceSnapshot = { project, documentId: 'doc', surfaceId: 'page', activation: 0,
    selectedInstanceIds: [], activeStateId: null, assetUrls: {}, canvasMode: 'edit', editingScope: 'scene', contentEdit: null, drawTool: null }
  const ports = { read: () => snapshot, onElement, onTargetElement() {}, commitTextEdit: async () => {}, select() {}, report() {},
    setCanvasMode() {}, setDrawTool() {} } as unknown as SlideWorkspacePorts
  const view = () => <SlideLocationWorkspace snapshot={snapshot} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />
  const ui = render(view()), local = ui.container.querySelector('[data-component-instance="local"]')!
  expect(local).toBeVisible()
  snapshot = { ...snapshot, editingScope: 'global' }; ui.rerender(view())
  expect(local).not.toBeVisible()
  expect(ui.container.querySelector('[data-component-instance="underlay"]')).toBeVisible()
  expect(ui.container.querySelector('[data-component-instance="overlay"]')).toBeVisible()
  snapshot = { ...snapshot, canvasMode: 'run' }; ui.rerender(view())
  expect(local).toBeVisible()
  snapshot = { ...snapshot, canvasMode: 'edit', editingScope: 'scene' }; ui.rerender(view())
  expect(ui.container.querySelector('[data-component-instance="local"]')).toBe(local)
  expect(onElement.mock.calls.filter(([id, element]) => id === 'local' && element === null)).toHaveLength(0)
  expect(project).toEqual(before)
})

it('hides Spatial world objects and camera guides in global editing and restores them on exit', () => {
  const { project, before } = fixture('spatial')
  const props: SpatialLocationWorkspaceProps = { documentId: 'doc', project, surface: componentSurface(project, 'page')!, selectionIds: [], canvasMode: 'edit',
    view: { camera: { x: 0, y: 0, zoom: 1 }, activeCameraFrameId: null, showCameraFrames: true, playbackPathId: null, playbackStepIndex: null, scope: 'world', graphSelection: null },
    renderInstance: id => <div key={id} data-testid={id} />, captureTarget: () => ({} as never), onEdits: async () => {}, onSelect() {}, onCamera() {}, onActivateFrame() {}, onGraphSelect() {}, onCanvasModeChange() {} }
  const ui = render(<SpatialLocationWorkspace {...props} />), local = ui.getByTestId('local')
  expect(local).toBeVisible()
  ui.rerender(<SpatialLocationWorkspace {...props} view={{ ...props.view, scope: 'global' }} />)
  expect(local).not.toBeVisible()
  expect(ui.getByTestId('underlay')).toBeVisible(); expect(ui.getByTestId('overlay')).toBeVisible()
  expect(ui.container.querySelector('[data-spatial-graph-layer]')).not.toBeVisible()
  expect(ui.container.querySelector('[data-spatial-camera-preview]')).toBeNull()
  ui.rerender(<SpatialLocationWorkspace {...props} canvasMode="run" view={{ ...props.view, scope: 'global' }} />)
  expect(local).toBeVisible()
  ui.rerender(<SpatialLocationWorkspace {...props} />)
  expect(ui.getByTestId('local')).toBe(local)
  expect(project).toEqual(before)
})

it('keeps the real Flow body mounted but inactive in global editing, hides local floats and formatting, and restores them for editing and try-run', async () => {
  const { project, before } = fixture('flow'), noop = () => {}, resources = { assets: {}, components: {} }
  navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'page', interactive: () => false, select: () => true })
  const bridge = { captureTarget: () => ({ documentId: 'doc', project, editingProject: project, resources, surfaceId: 'page' }) }
  probe.state = { courseBridge: bridge, courseKernel: bridge, editingScope: 'scene', flowDocumentDrafts: {}, setFlowDocumentDraft: noop,
    setFlowContextSelection: noop, slideContentEdit: null, beginSlideDataEdit: noop, beginSlideSpotEdit: noop, updateSlideSpotDraft: noop, updateSlideDataDraft: noop, commitSlideContentEdit: async () => {}, cancelTextEdit: noop }
  probe.runtime = { resources, navigation, selectedInstanceIds: [], selectInstances: vi.fn(), registerObservation: () => noop,
    onElement: noop, onTargetElement: noop, renderInstance: (id: string) => <span>{id}</span>,
    world: { beforeProjectionMutation: noop, afterProjectionMutation: noop, authorSpots: () => [] } }
  const props = { documentId: 'doc', project, surfaceId: 'page', onSelectImageAsset: async () => null }
  const ui = render(<FlowWorkspace {...props} />)
  await waitFor(() => expect(ui.container.querySelector('.ProseMirror')).not.toBeNull())
  const body = ui.container.querySelector('.ProseMirror')!
  expect(body).toBeVisible(); expect(body).toHaveAttribute('contenteditable', 'true')
  expect(ui.container.querySelector('[data-flow-overlay-id="floating"]')).toBeVisible()
  act(() => { probe.state.editingScope = 'global'; ui.rerender(<FlowWorkspace {...props} />) })
  expect(body).not.toBeVisible(); expect(body).toHaveAttribute('contenteditable', 'false')
  expect(ui.container.querySelector('[data-flow-overlay-id="floating"]')).toBeNull()
  expect(ui.container.querySelector('.shared-document-toolbar')).toBeNull()
  expect(ui.container.querySelector('[data-flow-overlay-id="underlay"]')).toBeVisible()
  expect(ui.container.querySelector('[data-flow-overlay-id="overlay"]')).toBeVisible()
  ui.rerender(<FlowWorkspace {...props} readOnly />)
  expect(body).toBeVisible(); expect(body).toHaveAttribute('contenteditable', 'false')
  act(() => { probe.state.editingScope = 'scene'; ui.rerender(<FlowWorkspace {...props} />) })
  expect(ui.container.querySelector('.ProseMirror')).toBe(body)
  expect(body).toHaveAttribute('contenteditable', 'true')
  expect(project).toEqual(before)
})
