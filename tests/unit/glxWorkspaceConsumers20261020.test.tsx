import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SpatialSurfaceViewState } from '../../src/renderer/store/slices/spatialAuthoringSlice'
import { componentSurface } from '../../src/shared/contracts/component-platform'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { freeSurfaceTargets, hitFreeObject } from '../../src/renderer/componentPlatform/surfaces/slide/targets'

const probe = vi.hoisted(() => ({ runtime: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
// This package changes the workspace boundary; document editing has its own owner tests.
vi.mock('../../src/renderer/ui/FlowWorkspace', () => ({ FlowWorkspace: () => <div data-testid="flow-body" /> }))
vi.mock('../../src/renderer/ui/FlowBlockContextToolbar', () => ({ FLOW_WORKSPACE_HEADER_HEIGHT: 48 }))
vi.mock('../../src/renderer/ui/workspaces/useSlideNativeTextEditor', () => ({ useSlideNativeTextEditor: () => ({ begin: () => false, editor: null }) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))

import { FlowLocationWorkspace } from '../../src/renderer/ui/workspaces/FlowLocationWorkspace'
import { SpatialLocationWorkspace, type SpatialLocationWorkspaceProps } from '../../src/renderer/ui/workspaces/SpatialLocationWorkspace'

const owners: ComponentNavigationOwner[] = []
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
})
afterEach(() => {
  cleanup()
  owners.splice(0).forEach(owner => owner.dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(kind: 'flow' | 'spatial'): CourseProjectV10 {
  const spatial = { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
  return {
    schemaVersion: 11, id: 'workspace-scope', revision: 7, title: '保全现有工作区',
    rootIds: ['root', 'other'], entry: { rootInstanceId: 'root' }, assets: {},
    definitions: { content: { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'test.content' } } },
    instances: {
      root: { id: 'root', definitionId: 'content', name: '作品根', data: {}, childIds: ['nested'],
        container: { kind, designSize: { width: 800, height: 400 }, ...(kind === 'spatial' ? { spatial } : {}) } },
      other: { id: 'other', definitionId: 'content', name: '另一个作品', data: {}, childIds: [], container: { kind: 'slide' } },
      nested: { id: 'nested', definitionId: 'content', name: '嵌套内容', data: {}, childIds: ['local'],
        frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 0, 0] },
        container: { kind, designSize: { width: 800, height: 400 }, ...(kind === 'spatial' ? { spatial } : {}) } },
      local: { id: 'local', definitionId: 'content', name: '本地内容', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 0, 0] } },
      underlay: { id: 'underlay', definitionId: 'content', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 100, 0] } },
      overlay: { id: 'overlay', definitionId: 'content', data: {}, frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 200, 0] } },
      hidden: { id: 'hidden', definitionId: 'content', name: '隐藏的全局内容', data: {}, visible: false,
        frame: { width: 80, height: 60, transform: [1, 0, 0, 1, 300, 0] } },
    },
    global: { underlay: ['underlay'], overlay: ['overlay', 'hidden'] },
  }
}

function flowHarness(project: CourseProjectV10) {
  project.definitions.document = { id: 'document', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
  const positions: Record<string, string | null> = { root: 'root-a', nested: 'nested-a' }
  for (const id of ['root', 'nested']) for (const suffix of ['a', 'b']) {
    const headingId = `${id}-${suffix}`
    project.instances[id].childIds!.push(headingId)
    project.instances[headingId] = { id: headingId, definitionId: 'document', data: { type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: headingId }] } } }
  }
  const selectRoot = vi.fn()
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'root', interactive: () => false, select: selectRoot })
  owners.push(navigation)
  for (const id of ['root', 'nested']) navigation.registerObservation(id, { readZoom: () => 1, setZoom() {}, reset() {},
    readReading: () => ({ activeInstanceId: positions[id], progress: 0 }),
    goToInstance: target => { positions[id] = target ?? `${id}-a`; return true } })
  const resetSurfacePrograms = vi.fn(async (_containerId: string) => {})
  const resetPlayback = vi.fn(async (_playing?: boolean, containerId?: string) => {
    const accepted = containerId
      ? await navigation.editorPort().forContainer!(containerId).execute({ type: 'scene.replay' })
      : await navigation.replayCurrentSurface()
    if (!accepted) throw new Error('未能返回初始状态')
    await resetSurfacePrograms(containerId ?? 'root')
  })
  probe.runtime = { documentId: 'doc', navigation, setPlaying: vi.fn(), resetPlayback, world: { resetSurfacePrograms } }
  const seed = async () => {
    await navigation.editorPort().execute({ type: 'scene.go', sceneId: 'root', targetInstanceId: 'root-b' }, undefined, undefined)
    await navigation.editorPort().forContainer!('nested').execute({ type: 'scene.go', sceneId: 'nested', targetInstanceId: 'nested-b' })
  }
  const props = { documentId: 'doc', project, canvasMode: 'edit' as const, editingScope: 'scene' as const,
    onCanvasModeChange() {}, onSelectImageAsset: async () => null }
  return { navigation, selectRoot, resetPlayback, resetSurfacePrograms, seed, props, positions }
}

it('replays and advances a nested Flow through the real chrome while preserving the work root', async () => {
  const project = fixture('flow'), h = flowHarness(project), before = structuredClone(project)
  await h.seed()
  const commit = vi.fn(async () => {})
  const ui = render(<FlowLocationWorkspace {...h.props} surfaceId="nested" beforeNavigate={commit} />)
  expect(ui.getByText('嵌套内容')).toBeInTheDocument()
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '回到初始画面' })))
  expect(h.positions.nested).toBe('nested-a')
  expect(h.positions.root).toBe('root-b')
  expect(h.resetSurfacePrograms).toHaveBeenCalledExactlyOnceWith('nested')
  expect(commit).toHaveBeenCalledTimes(1)
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '下一步' })))
  await waitFor(() => expect(h.positions.nested).toBe('nested-b'))
  expect(h.positions.root).toBe('root-b')
  expect(h.navigation.currentStateId('nested')).toBeNull()
  expect(h.selectRoot).not.toHaveBeenCalled()
  expect(project).toEqual(before)
})

it('keeps the existing root Flow replay path and leaves the nested reading position untouched', async () => {
  const project = fixture('flow'), h = flowHarness(project)
  await h.seed()
  const ui = render(<FlowLocationWorkspace {...h.props} surfaceId="root" />)
  await act(async () => fireEvent.click(ui.getByRole('button', { name: '回到初始画面' })))
  expect(h.resetPlayback).toHaveBeenCalledExactlyOnceWith(false, undefined)
  expect(h.resetSurfacePrograms).toHaveBeenCalledExactlyOnceWith('root')
  expect(h.positions.root).toBe('root-a')
  expect(h.positions.nested).toBe('nested-b')
})

function spatialProps(project: CourseProjectV10, surfaceId: string, scope: SpatialSurfaceViewState['scope'] = 'world'): SpatialLocationWorkspaceProps {
  const captured: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId, activeStateId: null, instanceIds: [], instanceId: null }
  return {
    documentId: 'doc', project, surface: componentSurface(project, surfaceId)!, selectionIds: [], canvasMode: 'edit',
    view: { camera: { x: 0, y: 0, zoom: 1 }, activeCameraFrameId: null, showCameraFrames: false, playbackPathId: null, playbackStepIndex: null, scope, graphSelection: null },
    renderInstance: id => <div key={id} data-testid={`render-${id}`} data-component-instance={id} hidden={project.instances[id]?.visible === false} />,
    captureTarget: () => captured, onEdits: async () => {}, onSelect() {}, onCamera() {}, onActivateFrame() {}, onGraphSelect() {}, onCanvasModeChange() {},
  }
}

it('retains both global planes and hidden-object recovery in the root Spatial workspace', () => {
  const project = fixture('spatial'), before = structuredClone(project)
  const ui = render(<SpatialLocationWorkspace {...spatialProps(project, 'root')} />)
  expect(ui.getByTestId('render-underlay')).toBeInTheDocument()
  expect(ui.getByTestId('render-overlay')).toBeInTheDocument()
  expect(ui.getByTestId('render-nested')).toBeInTheDocument()
  expect(ui.getByRole('button', { name: '隐藏 1' })).toBeInTheDocument()
  expect(project).toEqual(before)
})

it('renders only local Spatial content and excludes invisible global hit targets while deeply editing', () => {
  const project = fixture('spatial'), before = structuredClone(project)
  const ui = render(<SpatialLocationWorkspace {...spatialProps(project, 'nested')} />)
  expect(ui.getByTestId('render-local')).toBeInTheDocument()
  expect(ui.queryByTestId('render-underlay')).not.toBeInTheDocument()
  expect(ui.queryByTestId('render-overlay')).not.toBeInTheDocument()
  expect(ui.queryByRole('button', { name: /隐藏 \d/ })).not.toBeInTheDocument()
  expect(project).toEqual(before)
})

it('preserves the explicit Spatial global-editing entry from a nested scope', () => {
  const project = fixture('spatial'), before = structuredClone(project)
  const ui = render(<SpatialLocationWorkspace {...spatialProps(project, 'nested', 'global')} />)
  expect(ui.getByText('全局层 · 3 个元素')).toBeInTheDocument()
  expect(ui.getByTestId('render-underlay')).toBeInTheDocument()
  expect(ui.getByTestId('render-overlay')).toBeInTheDocument()
  expect(ui.getByRole('button', { name: '隐藏 1' })).toBeInTheDocument()
  expect(project).toEqual(before)
})

it.each(['flow', 'spatial'] as const)('keeps nested %s content inside its own geometry scope while retaining ordinary group selection', kind => {
  const project = fixture('spatial')
  project.instances.root.container!.kind = 'slide'
  project.instances.nested.container!.kind = kind
  project.instances.group = { id: 'group', definitionId: 'content', data: {}, childIds: ['group-child'],
    frame: { width: 160, height: 100, transform: [1, 0, 0, 1, 400, 0] } }
  project.instances['group-child'] = { id: 'group-child', definitionId: 'content', data: {},
    frame: { width: 40, height: 40, transform: [1, 0, 0, 1, 10, 10] } }
  project.instances.root.childIds!.push('group')
  const before = structuredClone(project)
  const targets = freeSurfaceTargets(project, 'root')
  expect(targets.map(target => target.instanceId)).toContain('nested')
  expect(targets.map(target => target.instanceId)).not.toContain('local')
  expect(hitFreeObject(targets, { x: 10, y: 10 }, true)?.instanceId).toBe('nested')
  expect(hitFreeObject(targets, { x: 420, y: 20 }, true)?.instanceId).toBe('group-child')
  expect(freeSurfaceTargets(project, 'nested').find(target => target.instanceId === 'local')?.parentToSurface).toEqual([1, 0, 0, 1, 0, 0])
  expect(project).toEqual(before)
})
