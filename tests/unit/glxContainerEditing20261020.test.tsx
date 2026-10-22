import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { componentSurface } from '../../src/shared/contracts/component-platform/project'
import { CourseV10DocumentView, InstanceView } from '../../src/renderer/documents/CourseV10DocumentView'
import { projectContainerPresentationStates } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { resolveWorkspaceRoute } from '../../src/renderer/ui/workspaces/WorkspaceRouteContext'
import { buildCourseTreeView, ScenePanel } from '../../src/renderer/ui/ScenePanel'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { Workspace } from '../../src/renderer/ui/Workspace'
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'
import { SlideLocationWorkspace, type SlideWorkspacePorts, type SlideWorkspaceSnapshot } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { TEXT_DEFINITION, createTextComponentData } from '../../src/components/text'
import { PlaybackViewSession } from '../../src/player/playbackViewSession'
import type { ContainerEditorViewState, CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import * as documentEditors from '../../src/renderer/document/editorSession'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'

const observationProbe = vi.hoisted(() => ({ runtime: null as CourseV10RuntimePorts | null }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => observationProbe.runtime }))
vi.mock('../../src/renderer/ui/workspaces/FlowWorkspaceConnector', () => ({ FlowWorkspaceConnector: () => <div data-testid="shared-flow-workspace" /> }))
vi.mock('../../src/renderer/ui/workspaces/SlideWorkspaceConnector', () => ({ SlideWorkspaceConnector: () => <div /> }))
vi.mock('../../src/renderer/ui/workspaces/SpatialWorkspaceConnector', () => ({ SpatialWorkspaceConnector: () => <div data-testid="shared-spatial-workspace" /> }))

afterEach(cleanup)

it('keeps the new Slide projection when the old Flow child refs unmount after a move', async () => {
  const project: CourseProjectV10 = { schemaVersion: 11, id: 'moved-native-group', revision: 0, title: 'Moved group',
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      slide: { id: 'slide', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
      text: { ...TEXT_DEFINITION, id: 'text' },
    },
    instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['slide', 'group'], container: { kind: 'flow' } },
      slide: { id: 'slide', definitionId: 'slide', data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 640, height: 360 } } },
      group: { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 0, 0] } },
      text: { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('A cup of coffee'))), frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 20, 20] } },
    }, rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] }, assets: {} }
  const world = new ComponentPlatformRuntime('moved-native-group', { mode: 'edit', projectionManaged: true })
  const old = render(<InstanceView instance={project.instances.group} project={project} surfaceId="flow" placement="flow" selectedInstanceId={null}
    onSelect={() => {}} onElement={world.bind} onTargetElement={world.bindTarget} />)
  const root = document.createElement('div'); document.body.append(root)
  const projection = createComponentModelProjection({ root, runtime: world, containerId: 'slide', signal: new AbortController().signal })
  try {
    await world.sync(project, { assets: {}, components: {} })
    const moved = structuredClone(project)
    moved.instances.flow.childIds = ['slide']; moved.instances.slide.childIds = ['group']; moved.revision++
    projection.sync({ kind: 'course-v10', project: moved, resources: { assets: {}, components: {} } })
    await world.sync(moved, { assets: {}, components: {} })
    const content = world.contentElement('text')!, target = world.targetElement('text')!
    expect(root.textContent).toContain('A cup of coffee')
    old.unmount() // Flow queues this after the replacement container has bound.
    expect(world.contentElement('text')).toBe(content)
    expect(world.targetElement('text')).toBe(target)
    expect(root.contains(content)).toBe(true)
    expect(root.textContent).toContain('A cup of coffee')
  } finally { old.unmount(); await projection.dispose(); await world.dispose(); root.remove() }
})

it('keeps the NodeView slot connected through Flow object refresh and isolates deferred container cleanup', async () => {
  const project = mixedProject()
  project.instances.reading.container!.flow = { layout: { widthMode: 'fluid', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } }
  for (const id of ['region-a', 'region-b']) project.instances[id].frame = { width: 700, height: 320, transform: [1, 0, 0, 1, 0, 0] }
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.assembly = { id: 'assembly', definitionId: 'group', data: {}, frame: { width: 700, height: 200, transform: [1, 0, 0, 1, 0, 0] }, childIds: ['leaf'] }
  project.instances.leaf = { id: 'leaf', definitionId: 'content', data: {}, frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 10, 10] } }
  project.instances.reading.childIds!.push('assembly')
  const h = await createV10StoreHost(project), previous = useEditorStore.getState()
  const elements = new Map<string, HTMLElement>(), targets = new Map<string, HTMLElement>()
  const bind = (map: Map<string, HTMLElement>) => (id: string, element: HTMLElement | null) => { if (element) map.set(id, element); else map.delete(id) }
  let clicks = 0
  const runtime = { resources: h.model().resources, selectedInstanceIds: [], selectInstances() {}, onElement: bind(elements), onTargetElement: bind(targets),
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {}, contentElement: (id: string) => elements.get(id), targetElement: (id: string) => targets.get(id) },
    renderInstance: (id: string) => <button key={id} onClick={() => clicks++}>group action</button>,
    renderContainer: (id: string) => <button data-local-container-projection={id} onClick={() => clicks++}>container action</button>,
    navigation: { changed() {} }, registerObservation: () => () => {} }
  observationProbe.runtime = runtime as unknown as CourseV10RuntimePorts
  useEditorStore.setState({ courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read() })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const factory = vi.spyOn(documentEditors, 'createLayoutEditor')
  let ui: ReturnType<typeof render> | undefined
  try {
    ui = render(<FlowWorkspace documentId={h.first.documentId} project={project} surfaceId="reading" onSelectImageAsset={async () => null} />)
    await waitFor(() => expect(ui!.container.querySelectorAll('button[data-local-container-projection]')).toHaveLength(2))
    const editor = factory.mock.results.at(-1)!.value
    const shell = ui.container.querySelector<HTMLElement>('[data-flow-block-id="region-a"]')!
    const initialContent = shell.querySelector('[data-local-container-projection]')!.parentElement!
    const nodeViewSlot = initialContent.parentElement!
    const repaint = async (next: CourseProjectV10) => {
      await act(async () => { ui!.rerender(<FlowWorkspace documentId={h.first.documentId} project={next} surfaceId="reading" onSelectImageAsset={async () => null} />) })
      expect(shell.isConnected).toBe(true)
      expect(shell.firstElementChild!.firstElementChild).toBe(nodeViewSlot)
      expect(nodeViewSlot.isConnected).toBe(true)
      expect(ui!.container.querySelectorAll('[data-local-container-projection="region-a"]')).toHaveLength(1)
      expect(elements.get('assembly')?.isConnected).toBe(true)
      expect(targets.get('assembly')?.isConnected).toBe(true)
      // The group's children keep their own input/selection branch; they must
      // not enter the NodeView host's mousedown/contextmenu selection listener.
      const groupSlot = elements.get('assembly')!
      expect(groupSlot.contains(ui!.getByText('group action'))).toBe(false)
      fireEvent.click(shell.querySelector('button')!)
      fireEvent.click(ui!.getByText('group action'))
    }
    const next = structuredClone(project)
    next.instances['region-a'].frame!.height = 410
    next.instances.leaf.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default { mount() { /* changed */ } }' }
    await repaint(next)
    expect(initialContent.isConnected).toBe(false)
    await repaint(project) // Undo projection
    await repaint(next) // Redo projection
    expect(clicks).toBe(6)
    expect(editor.view.isDestroyed).toBe(false)
    expect(ui.queryByRole('alert')).toBeNull()
  } finally {
    ui?.unmount(); await act(async () => {})
    factory.mockRestore(); useEditorStore.setState(previous, true); h.bridge.dispose(); vi.unstubAllGlobals()
  }
})

function mixedProject(): CourseProjectV10 {
  const states = (id: string) => ({ states: [
    { id: 'overview', title: '概览', overrides: {} },
    { id: 'detail', title: '细节', overrides: { [id]: { data: { text: id + ' detail' } } } },
  ] })
  return {
    schemaVersion: 11, id: 'mixed-editing', revision: 0, title: '局部编辑', rootIds: ['reading'], entry: { rootInstanceId: 'reading' },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      spatial: { id: 'spatial', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } },
      slide: { id: 'slide', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      content: { id: 'content', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } },
    },
    instances: {
      reading: { id: 'reading', name: '阅读', definitionId: 'flow', data: {}, childIds: ['region-a', 'region-b'], container: { kind: 'flow' } },
      'region-a': { id: 'region-a', name: '区域 A', definitionId: 'slide', data: {}, childIds: ['a'], container: { kind: 'slide', presentation: states('a') } },
      'region-b': { id: 'region-b', name: '区域 B', definitionId: 'slide', data: {}, childIds: ['b'], container: { kind: 'slide', presentation: states('b') } },
      a: { id: 'a', definitionId: 'content', data: { text: 'A base' } },
      b: { id: 'b', definitionId: 'content', data: { text: 'B base' } },
    },
    global: { underlay: [], overlay: [] }, assets: {},
  }
}

it('keeps the work root while entering and returning from local editing, with real Undo and save/reopen', async () => {
  const h = await createV10StoreHost(mixedProject())
  try {
    const id = h.first.documentId
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'reading', editingContainerId: null })
    h.bridge.enterContainer(id, 'region-a')
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'region-a', editingContainerId: 'region-a', editingPath: ['reading', 'region-a'] })
    h.bridge.selectInstances(id, ['a'])
    const target = h.bridge.captureTarget(id)
    expect(target).toMatchObject({ rootInstanceId: 'reading', editingContainerId: 'region-a', surfaceId: 'region-a', instanceId: 'a' })
    await h.bridge.edit([{ type: 'data.set', instanceId: 'a', path: ['text'], value: 'A edited' }])
    expect(h.model().project.instances.a.data).toEqual({ text: 'A edited' })
    expect(h.model().project.instances.b.data).toEqual({ text: 'B base' })
    await h.bridge.undo(id)
    expect(h.model().project.instances.a.data).toEqual({ text: 'A base' })
    await h.bridge.redo(id)
    h.bridge.leaveContainer(id)
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'reading', editingContainerId: null, selectedInstanceId: 'region-a' })
    expect(await h.bridge.save(false, undefined, id)).toBe(true)
    await h.bridge.close(id)
    await h.bridge.open('saved.glx')
    const reopened = h.bridge.read().activeDocumentId!
    h.bridge.enterContainer(reopened, 'region-a')
    expect(h.bridge.captureTarget(reopened).project.instances.a.data).toEqual({ text: 'A edited' })
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'region-a' })
    expect(h.bridge.read().project).not.toHaveProperty('surfaces')
  } finally { h.bridge.dispose() }
})

it('projects independent same-named local states and keeps local inspection stable when a sibling changes', async () => {
  const project = mixedProject(), h = await createV10StoreHost(project)
  try {
    const id = h.first.documentId
    h.bridge.enterContainer(id, 'region-a')
    h.bridge.selectPresentationState(id, 'detail', 'region-b')
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'region-a', activeStateId: null })
    expect(h.bridge.read().editingProject?.instances.a.data).toEqual({ text: 'A base' })
    expect(h.bridge.read().editingProject?.instances.b.data).toEqual({ text: 'b detail' })
    h.bridge.selectPresentationState(id, 'detail', 'region-a')
    expect(h.bridge.read().activeStateId).toBe('detail')
    expect(h.bridge.read().editingProject?.instances.a.data).toEqual({ text: 'a detail' })
    expect(h.first.read().undoDepth).toBe(0)
    await h.bridge.edit([{ type: 'data.set', instanceId: 'a', path: ['text'], value: 'A local edit' }])
    expect(h.model().project.instances.a.data).toEqual({ text: 'A base' })
    expect(componentSurface(h.model().project, 'region-a')?.presentation?.states[1].overrides.a.data).toEqual({ text: 'A local edit' })
    expect(h.bridge.read().editingProject?.instances.b.data).toEqual({ text: 'b detail' })
    await h.bridge.undo(id)
    expect(h.bridge.read().editingProject?.instances.a.data).toEqual({ text: 'a detail' })
    expect(componentSurface(h.model().project, 'region-a')?.presentation?.states[1].id).toBe('detail')
    expect(projectContainerPresentationStates(project, { 'region-a': 'overview', 'region-b': 'detail' }).instances.a.data).toEqual({ text: 'A base' })
  } finally { h.bridge.dispose() }
})

it('uses a pure program root in the neutral workspace and existing source selection instead of manufacturing a Slide', async () => {
  const project = mixedProject()
  project.rootIds = ['program', 'reading']; project.entry = { rootInstanceId: 'program' }
  project.instances.program = { id: 'program', name: '应用', definitionId: 'content', data: { text: 'app' } }
  const h = await createV10StoreHost(project)
  try {
    const view = h.bridge.read()
    expect(view).toMatchObject({ rootInstanceId: 'program', surfaceId: null, editingContainerId: null })
    expect(resolveWorkspaceRoute({ project, surfaceId: view.surfaceId, rootInstanceId: view.rootInstanceId })).toEqual({ kind: 'program', rootInstanceId: 'program' })
    h.bridge.selectInstances(h.first.documentId, ['program'])
    expect(h.bridge.captureTarget()).toMatchObject({ rootInstanceId: 'program', surfaceId: null, instanceId: 'program' })
    expect(buildCourseTreeView(project).pages.map(page => [page.id, page.kind])).toEqual([['program', 'program-root'], ['reading', 'flow-page']])
    const mounted = render(<CourseV10DocumentView project={project} surfaceId={null} selectedInstanceId="program" onSelect={() => {}} />)
    expect(mounted.container.querySelector('[data-component-placement="program"]')).toHaveStyle({ width: '100%', height: '100%' })
    expect(mounted.container.querySelector('[aria-label="阅读"]')).toBeNull()
    expect(project.rootIds).toEqual(['program', 'reading'])
  } finally { h.bridge.dispose() }
})

it('delegates a nested container once and does not recursively create its native descendants a second time', () => {
  const project = mixedProject(), preview = vi.fn(() => <div data-testid="local-projection" />), bound = vi.fn()
  const mounted = render(<InstanceView instance={project.instances['region-a']} project={project} surfaceId="reading" selectedInstanceId={null}
    onSelect={() => {}} onElement={bound} renderContainer={preview} />)
  expect(preview).toHaveBeenCalledOnce()
  expect(mounted.getByTestId('local-projection')).toBeInTheDocument()
  expect(mounted.container.querySelector('[data-component-instance="a"]')).toBeNull()
  expect(bound.mock.calls.some(([id]) => id === 'a')).toBe(false)
})


it('restores the original Flow reading and observation position after local inspection replaces its workspace', async () => {
  const project = mixedProject()
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.reading.container!.flow = { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } }
  project.instances.reading.childIds = ['body', 'local-reading']
  project.instances['local-reading'] = { id: 'local-reading', definitionId: 'flow', data: {}, childIds: ['local-body'], container: structuredClone(project.instances.reading.container!) }
  project.instances['local-body'] = { id: 'local-body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('局部正文'))) }
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('正文'))) }
  delete project.instances['region-a']; delete project.instances['region-b']; delete project.instances.a; delete project.instances.b
  const h = await createV10StoreHost(project), before = useEditorStore.getState(), viewState: ContainerEditorViewState = {}
  const resizeObserver = globalThis.ResizeObserver
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280)
  const heights = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720)
  const registrations = vi.spyOn(PlaybackViewSession.prototype, 'register')
  const observedSession = () => registrations.mock.contexts.at(-1) as PlaybackViewSession
  let observation: { readZoom(): number; setZoom(zoom: number): void } | undefined
  const localView: ContainerEditorViewState = {}
  const runtime = { resources: h.model().resources, selectedInstanceIds: [], selectInstances() {}, onElement() {}, onTargetElement() {},
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {} }, renderInstance: () => null, renderContainer: () => null, navigation: { changed() {} },
    containerViewState: (id: string) => id === 'reading' ? viewState : localView, registerObservation: (_id: string, binding: typeof observation) => { observation = binding; return () => {} } }
  observationProbe.runtime = runtime as unknown as CourseV10RuntimePorts
  useEditorStore.setState({ courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read() })
  const mount = () => render(<FlowWorkspace documentId={h.first.documentId} project={project} surfaceId="reading" onSelectImageAsset={async () => null} />)
  try {
    const first = mount(), scroll = first.getByTestId('flow-workspace-scroll')
    scroll.scrollTop = 426; scroll.scrollLeft = 17
    act(() => { observation!.setZoom(1.8); observedSession().panTo({ x: -38, y: -24 }) })
    first.rerender(<FlowWorkspace documentId={h.first.documentId} project={project} surfaceId="local-reading" onSelectImageAsset={async () => null} />)
    expect(observation!.readZoom()).toBe(1)
    first.rerender(<FlowWorkspace documentId={h.first.documentId} project={project} surfaceId="reading" onSelectImageAsset={async () => null} />)
    expect(first.getByTestId('flow-workspace-scroll').scrollTop).toBe(426)
    expect(observation!.readZoom()).toBe(1.8)
    first.unmount()
    expect(viewState).toMatchObject({ scrollTop: 426, scrollLeft: 17, zoom: 1.8, pan: { x: -38, y: -24 } })
    const returned = mount()
    expect(returned.getByTestId('flow-workspace-scroll').scrollTop).toBe(426)
    expect(returned.getByTestId('flow-workspace-scroll').scrollLeft).toBe(17)
    expect(observation!.readZoom()).toBe(1.8)
    expect(observedSession().state.pan).toEqual({ x: -38, y: -24 })
    expect(h.first.read().undoDepth).toBe(0)
    returned.unmount()
  } finally {
    cleanup(); useEditorStore.setState(before, true); h.bridge.dispose()
    widths.mockRestore(); heights.mockRestore(); registrations.mockRestore()
    if (resizeObserver) globalThis.ResizeObserver = resizeObserver; else Reflect.deleteProperty(globalThis, 'ResizeObserver')
  }
})


it('reuses Slide container projections and restores local inspection views while keeping state/mode reset behavior', () => {
  const project = mixedProject()
  project.instances.reading.container = { kind: 'slide', designSize: { width: 1280, height: 720 } }
  project.instances.reading.childIds = ['region-a']
  project.instances['region-a'].container = { kind: 'slide', designSize: { width: 1280, height: 720 } }
  project.instances.global = { id: 'global', definitionId: 'content', data: {} }; project.global.overlay = ['global']
  const resizeObserver = globalThis.ResizeObserver
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280)
  const heights = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720)
  const views = new Map<string, ContainerEditorViewState>(), bind = vi.fn(), delegated = vi.fn(() => <div data-testid="slide-container-preview" />)
  let observation: { readZoom(): number; setZoom(value: number): void } | undefined
  let snapshot: SlideWorkspaceSnapshot = { project, documentId: 'slide-scope', surfaceId: 'reading', selectedInstanceIds: [],
    canvasMode: 'edit', contentEdit: null, drawTool: null, activation: 0, activeStateId: null, assetUrls: {}, editingScope: 'scene' }
  const ports = { read: () => snapshot, report() {}, onElement: bind, onTargetElement() {},
    registerObservation: (_id: string, binding: typeof observation) => { observation = binding; return () => {} },
    containerViewState: (id: string) => { if (!views.has(id)) views.set(id, {}); return views.get(id)! },
    renderContainer: delegated, beginTextEdit: () => null, updateDataDraft() {}, commitTextEdit: async () => {}, cancelTextEdit() {}, undo() {}, redo() {},
  } as unknown as SlideWorkspacePorts
  const mount = () => render(<SlideLocationWorkspace snapshot={snapshot} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
  try {
    const root = mount()
    expect(delegated).toHaveBeenCalledWith('region-a', expect.anything())
    expect(root.getByTestId('slide-container-preview')).toBeInTheDocument()
    expect(bind.mock.calls.some(([id]) => id === 'a')).toBe(false)
    act(() => observation!.setZoom(1.8))
    root.unmount()
    expect(views.get('reading')?.zoom).toBe(1.8)
    snapshot = { ...snapshot, surfaceId: 'region-a' }
    bind.mockClear()
    const nested = mount()
    expect(bind.mock.calls.some(([id, element]) => id === 'a' && element)).toBe(true)
    expect(bind.mock.calls.some(([id, element]) => id === 'global' && element)).toBe(false)
    expect(observation!.readZoom()).toBe(1)
    nested.unmount()
    snapshot = { ...snapshot, surfaceId: 'reading' }
    const returned = mount()
    expect(observation!.readZoom()).toBe(1.8)
    snapshot = { ...snapshot, canvasMode: 'run' }
    returned.rerender(<SlideLocationWorkspace snapshot={snapshot} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
    expect(observation!.readZoom()).toBe(1)
    returned.unmount()
  } finally {
    cleanup(); widths.mockRestore(); heights.mockRestore()
    if (resizeObserver) globalThis.ResizeObserver = resizeObserver; else Reflect.deleteProperty(globalThis, 'ResizeObserver')
  }
})


it('recomputes the transient parent path after a formal move without changing the chosen work root', async () => {
  const h = await createV10StoreHost(mixedProject())
  try {
    const id = h.first.documentId
    h.bridge.enterContainer(id, 'region-a')
    await h.bridge.edit([{ type: 'instance.move', instanceId: 'region-a', container: { kind: 'instance', instanceId: 'region-b' }, index: 1 }])
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'region-a', editingPath: ['reading', 'region-b', 'region-a'] })
    h.bridge.leaveContainer(id)
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'region-b', editingContainerId: 'region-b', selectedInstanceId: 'region-a' })
    await h.bridge.undo(id)
    expect(h.model().project.instances.reading.childIds).toEqual(['region-a', 'region-b'])
  } finally { h.bridge.dispose() }
})


it('allows removing the last native page when a program root remains', async () => {
  const project = mixedProject()
  project.rootIds.push('program')
  project.instances.program = { id: 'program', name: '应用', definitionId: 'content', data: {} }
  const h = await createV10StoreHost(project), before = useEditorStore.getState()
  useEditorStore.setState({ courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read() })
  try {
    const ui = render(<ScenePanel />)
    expect(ui.getByRole('button', { name: '删除页面“阅读”' })).toBeEnabled()
    expect(ui.getByRole('button', { name: '删除程序“应用”' })).toBeEnabled()
    ui.unmount()
  } finally { cleanup(); useEditorStore.setState(before, true); h.bridge.dispose() }
})


it('inspects visible shared containers under their actual plane and returns to the shared editor', async () => {
  const project = mixedProject()
  project.global.overlay = ['shared-group']
  project.instances['shared-group'] = { id: 'shared-group', definitionId: 'content', data: {}, childIds: ['shared-a'] }
  project.instances['shared-a'] = { id: 'shared-a', name: '共享区域', definitionId: 'slide', data: {}, childIds: ['shared-text'],
    container: { kind: 'slide', presentation: { states: [{ id: 'detail', title: '细节', overrides: { 'shared-text': { data: { text: 'Shared detail' } } } }] } } }
  project.instances['shared-text'] = { id: 'shared-text', definitionId: 'content', data: { text: 'Shared base' } }
  const h = await createV10StoreHost(project), before = useEditorStore.getState(), id = h.first.documentId
  const stop = h.bridge.subscribe(() => useEditorStore.setState({ courseView: h.bridge.read() }))
  useEditorStore.setState({ courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read(), editingScope: 'global', commitTextEdit: async () => {}, setEditingScope: editingScope => useEditorStore.setState({ editingScope }) })
  try {
    h.bridge.selectInstances(id, ['shared-a'])
    const ui = render(<Workspace onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />)
    fireEvent.click(ui.getByTestId('container-edit-enter'))
    await waitFor(() => expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'shared-a', editingPlane: 'overlay', editingPath: ['shared-a'] }))
    expect(useEditorStore.getState().editingScope).toBe('scene')
    expect(ui.getByLabelText('容器编辑位置')).toHaveTextContent('共享浮层 / 共享区域')
    act(() => h.bridge.selectPresentationState(id, 'detail', 'shared-a'))
    await act(async () => { await h.bridge.edit([{ type: 'data.set', instanceId: 'shared-text', path: ['text'], value: 'Shared edited' }]) })
    expect(h.model().project.instances['shared-text'].data).toEqual({ text: 'Shared base' })
    expect(componentSurface(h.model().project, 'shared-a')?.presentation?.states[0].overrides['shared-text'].data).toEqual({ text: 'Shared edited' })
    fireEvent.click(ui.getByTestId('container-edit-return'))
    await waitFor(() => expect(useEditorStore.getState().editingScope).toBe('global'))
    expect(h.bridge.read()).toMatchObject({ rootInstanceId: 'reading', surfaceId: 'reading', editingContainerId: null, selectedInstanceId: 'shared-a' })
    expect(h.model().project.instances.reading.childIds).toEqual(['region-a', 'region-b'])
    expect(h.model().project.global.overlay).toEqual(['shared-group'])
    await act(async () => { await h.bridge.edit([{ type: 'instance.patch', instanceId: 'shared-group', patch: { visible: false } }]) })
    expect(ui.queryByTestId('container-edit-enter')).toBeNull()
    ui.unmount()
  } finally { cleanup(); stop(); useEditorStore.setState(before, true); h.bridge.dispose() }
})


it('leaves native run gestures with the live runtime while preserving editor selection and History', async () => {
  const project = mixedProject(), h = await createV10StoreHost(project)
  let playing = false
  const isPlaying = () => playing, runtimePointer = vi.fn(), runtimeClick = vi.fn(), runtimeDoubleClick = vi.fn()
  try {
    const documentId = h.first.documentId
    h.bridge.selectInstances(documentId, ['region-a'])
    const before = h.first.read(), onSelect = vi.fn((id: string | null) => h.bridge.selectInstances(documentId, id ? [id] : []))
    const mounted = render(<div onPointerDown={runtimePointer} onClick={runtimeClick} onDoubleClick={runtimeDoubleClick}>
      <InstanceView instance={project.instances.a} project={project} surfaceId="reading" selectedInstanceId="region-a"
        isPlaying={isPlaying} onSelect={onSelect} />
    </div>)
    const target = mounted.container.querySelector<HTMLElement>('[data-component-instance="a"]')!
    playing = true
    fireEvent.pointerDown(target)
    fireEvent.click(target)
    fireEvent.doubleClick(target)
    expect(onSelect).not.toHaveBeenCalled()
    expect(runtimePointer).toHaveBeenCalledOnce(); expect(runtimeClick).toHaveBeenCalledOnce(); expect(runtimeDoubleClick).toHaveBeenCalledOnce()
    expect(h.bridge.read().selectedInstanceId).toBe('region-a')
    expect(h.first.read().undoDepth).toBe(before.undoDepth)
    playing = false
    fireEvent.pointerDown(target)
    expect(onSelect).toHaveBeenLastCalledWith('a')
    expect(h.bridge.read().selectedInstanceId).toBe('a')
    expect(runtimePointer).toHaveBeenCalledOnce()
    expect(h.first.read().undoDepth).toBe(before.undoDepth)
  } finally { h.bridge.dispose() }
})


it('delegates Flow body containers to their common local projection without flattening children or rebinding its runtime', async () => {
  const project = mixedProject()
  project.instances.reading.container!.flow = { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } }
  for (const id of ['region-a', 'region-b']) project.instances[id].frame = { width: 700, height: 320, transform: [1, 0, 0, 1, 0, 0] }
  project.instances['region-a'].flowLayout = { width: 'content-width', caption: { inlines: [{ type: 'text', text: '容器图注' }] } }
  project.instances.a.frame = { width: 300, height: 80, transform: [1, 0, 0, 1, 2000, 20] }
  delete project.instances['region-b'].frame
  project.instances['region-b'].container!.designSize = { width: 700, height: 250 }
  project.instances['region-b'].childIds = []; delete project.instances.b
  const h = await createV10StoreHost(project), previous = useEditorStore.getState()
  const renderContainer = vi.fn((id: string, current?: CourseProjectV10) => <div data-local-container-projection={id} data-projected-text={JSON.stringify(current?.instances.a?.data)} />), renderInstance = vi.fn(() => null), onElement = vi.fn(), onTargetElement = vi.fn()
  const runtime = { resources: h.model().resources, selectedInstanceIds: [], selectInstances() {}, onElement, onTargetElement,
    world: { beforeProjectionMutation() {}, afterProjectionMutation() {} }, renderInstance, renderContainer, navigation: { changed() {} }, registerObservation: () => () => {} }
  observationProbe.runtime = runtime as unknown as CourseV10RuntimePorts
  useEditorStore.setState({ courseBridge: h.bridge, courseKernel: h.kernel, courseView: h.bridge.read() })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  let ui: ReturnType<typeof render> | undefined
  try {
    ui = render(<FlowWorkspace documentId={h.first.documentId} project={project} surfaceId="reading" onSelectImageAsset={async () => null} />)
    await waitFor(() => expect(ui!.container.querySelectorAll('[data-local-container-projection]')).toHaveLength(2))
    expect(renderContainer.mock.calls.map(([id]) => id).sort()).toEqual(['region-a', 'region-b'])
    expect(renderInstance).not.toHaveBeenCalled()
    expect(onElement).not.toHaveBeenCalled()
    expect(onTargetElement).not.toHaveBeenCalled()
    const preview = ui.container.querySelector<HTMLElement>('[data-local-container-projection="region-a"]')!, host = preview.parentElement!.parentElement!
    expect(host.style.width).toBe('100%'); expect(host.style.height).toBe('100%'); expect(host.style.transform).toBe('none')
    expect(host.parentElement!.style.height).toBe('320px')
    expect(host.closest<HTMLElement>('[data-flow-block-id="region-a"]')!.style.height).toBe('auto')
    expect(host.closest('figure')!.querySelector('figcaption')!.textContent).toBe('容器图注')
    expect(ui.container.querySelector<HTMLElement>('[data-local-container-projection="region-b"]')!.parentElement!.parentElement!.parentElement!.style.height).toBe('250px')
    const next = structuredClone(project); next.instances.a.data = { text: 'updated state' }
    ui.rerender(<FlowWorkspace documentId={h.first.documentId} project={next} surfaceId="reading" onSelectImageAsset={async () => null} />)
    await waitFor(() => expect(preview.dataset.projectedText).toContain('updated state'))
    expect(ui.container.querySelector('[data-local-container-projection="region-a"]')).toBe(preview)
    ui.unmount(); ui = undefined
    await act(async () => {})
    expect(onElement).not.toHaveBeenCalled(); expect(onTargetElement).not.toHaveBeenCalled()
  } finally { ui?.unmount(); useEditorStore.setState(previous, true); h.bridge.dispose(); vi.unstubAllGlobals() }
})
