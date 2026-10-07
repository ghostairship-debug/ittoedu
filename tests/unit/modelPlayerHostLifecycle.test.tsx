import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createV10ModelPlayer, mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createTeacherControllerHudGeometry, isGlobalTeacherController, projectTeacherControllerInstances, teacherControllerReferenceSize } from '../../src/shared/teacherControllerViewportGeometry'
import { componentFragmentStateKey } from '../../src/player/componentPlatform/fragments'
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'

const flowProbe = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: (select: (state: typeof flowProbe.state) => unknown) => select(flowProbe.state) }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const project = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'commit', revision: 0, title: '提交后运行',
  definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
  instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('初始文字'))) } },
  surfaces: [{ id: 'page', kind: 'slide', title: '本页', childIds: ['text'], designSize: { width: 800, height: 600 } }],
  global: { underlay: [], overlay: [] }, assets: {} })
const resources = { assets: {}, components: {} }

it('waits for the DOM projection commit before mounting and binding observation, and retires a commit in flight', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const order: string[] = []
  const prepare = ComponentPlatformRuntime.prototype.prepareResources
  vi.spyOn(ComponentPlatformRuntime.prototype, 'prepareResources').mockImplementation(function (this: ComponentPlatformRuntime, model, bytes) {
    order.push('resources'); return prepare.call(this, model, bytes)
  })
  let commit!: () => void
  const release = vi.fn(), disposeProjection = vi.fn(), observed = { readZoom: () => 1, setZoom() {}, reset() {} }
  const model = { kind: 'course-v10' as const, project: project(), resources }
  const player = mountV10Model({ root, model, runScopeId: 'dom-commit',
    onObservation: () => { expect(root.textContent).toContain('初始文字'); order.push('observation'); return release },
    createProjection: ({ runtime, signal }) => ({
      sync: () => new Promise<void>(resolve => {
        order.push('projection-request')
        commit = () => { if (!signal.aborted) { runtime.bind('text', root); order.push('projection-commit') }; resolve() }
        signal.addEventListener('abort', () => resolve(), { once: true })
      }),
      observation: () => observed, revealSurface: () => true, dispose: disposeProjection,
    }),
  })
  await waitFor(() => expect(order).toContain('projection-request'))
  expect(order).toEqual(['resources', 'projection-request']); expect(root.textContent).toBe('')
  let ready = false; void player.ready.then(() => { ready = true })
  await Promise.resolve(); expect(ready).toBe(false)
  commit(); await player.ready
  expect(order.indexOf('projection-commit')).toBeLessThan(order.indexOf('observation'))
  expect(root.textContent).toContain('初始文字')
  const updating = player.update(model)
  await Promise.resolve(); await Promise.resolve()
  await player.dispose(); await updating
  expect(release).toHaveBeenCalledTimes(1); expect(disposeProjection).toHaveBeenCalledTimes(1)
  expect(root.textContent).toBe(''); root.remove()
})

it('retains the actual React runtime through StrictMode, ancestor replacement and pause/resume, then applies the committed model', async () => {
  let ports!: CourseV10RuntimePorts
  const diagnostics = vi.fn(), source = project(), initial = { kind: 'course-v10' as const, project: source, resources }
  const draw = (model: typeof initial, key: string) => <StrictMode><CourseV10RuntimeView documentId="react-document" model={model}
    surfaceId="page" selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={() => {}} report={diagnostics}
    projectionKey={key} renderWorkspace={runtime => { ports = runtime; return <section key={key}>{runtime.renderInstance('text')}</section> }} /> </StrictMode>
  const ui = render(draw(initial, 'light'))
  await waitFor(() => expect(ui.container.textContent).toContain('初始文字'))
  const world = ports.world, renderRoot = world.contentElement('text')!.firstElementChild
  world.setState('kept', 7)
  act(() => { ports.setPlaying(true); ports.setPlaying(false); ports.setPlaying(true) })
  ui.rerender(draw(initial, 'deep'))
  await waitFor(() => expect(world.contentElement('text')!.firstElementChild).toBe(renderRoot))
  expect(ports.world).toBe(world); expect(world.getState('kept')).toBe(7); expect(world.isPlaying()).toBe(true)
  const changed = structuredClone(source)
  changed.revision++; changed.instances.text.data = JSON.parse(JSON.stringify(createTextComponentData('正式新文字')))
  ui.rerender(draw({ ...initial, project: changed }, 'deep'))
  await waitFor(() => expect(ui.container.textContent).toContain('正式新文字'))
  expect(ports.world).toBe(world); expect(world.getState('kept')).toBe(7); expect(diagnostics).not.toHaveBeenCalled()
  ui.unmount()
  await act(async () => { await Promise.resolve(); await world.dispose() })
  expect(world.contentElement('text')).toBeUndefined()
})

it('moves the default collapsed controller by the requested screen distance in the same HUD geometry used to paint it', () => {
  const course = createBlankCourseProjectV10('控制台拖动'), before = structuredClone(course)
  const id = [...course.global.underlay, ...course.global.overlay].find(id => isGlobalTeacherController(course, id))!
  const navigation = new ComponentNavigationOwner({ project: () => course, surfaceId: () => course.surfaces[0].id,
    select() {}, viewportBounds: () => ({ left: 0, top: 0, right: 640, bottom: 360 }) })
  const geometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(course), viewportRect: { x: 0, y: 0, width: 640, height: 360 } })
  const draw = () => projectTeacherControllerInstances(course, geometry, undefined, navigation).instances[id].frame!.transform.slice(4)
  const start = draw()
  navigation.moveBy(-10, -10)
  expect(draw()).toEqual([start[0] - 10, start[1] - 10])
  expect(course).toEqual(before)
  navigation.dispose()
})

it('synchronizes a late NodeView binding and a nested React root through the latest committed model', async () => {
  const host = createV10ModelPlayer({ runScopeId: 'late-flow-nodeview' })
  const model = { kind: 'course-v10' as const, project: project(), resources }
  await host.commitProjection(host.prepareProjection(model))
  const latest = structuredClone(model)
  latest.project.revision++; latest.project.instances.text.data = JSON.parse(JSON.stringify(createTextComponentData('晚挂载的正式内容')))
  await host.commitProjection(host.prepareProjection(latest))
  const shell = document.createElement('div'); document.body.append(shell)
  // A PM NodeView attaches its shell after its enclosing editor's passive mount.
  host.runtime.bind('text', shell); host.runtime.afterProjectionMutation()
  await host.ready
  expect(shell.textContent).toContain('晚挂载的正式内容')
  const retained = shell.firstElementChild
  host.runtime.beforeProjectionMutation(); host.runtime.bind('text', null); shell.remove()
  const nested = document.createElement('div'); document.body.append(nested)
  const root = createRoot(nested)
  // A children root has its own real React commit, without another parent-host render.
  await act(async () => root.render(<div ref={element => host.runtime.bind('text', element)} />))
  await host.ready
  expect(nested.textContent).toContain('晚挂载的正式内容'); expect(nested.firstElementChild!.firstElementChild).toBe(retained)
  await act(async () => root.unmount())
  await host.dispose(); nested.remove()
})

it('uses the common navigation keys in the current author run and releases them when paused', async () => {
  const course = project(); course.surfaces.push({ ...course.surfaces[0], id: 'second', title: '下一页', childIds: [] })
  const model = { kind: 'course-v10' as const, project: course, resources }
  let ports!: CourseV10RuntimePorts
  const report = vi.fn()
  function Editor() {
    const [surface, select] = useState('page')
    return <CourseV10RuntimeView documentId="keyboard-doc" model={model} surfaceId={surface} selectedInstanceId={null} player={false}
      onSelect={() => {}} onSurfaceSelect={select} report={report} renderWorkspace={runtime => { ports = runtime; return <div>{runtime.surfaceId}</div> }} />
  }
  const ui = render(<Editor />)
  act(() => ports.setPlaying(true))
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  await waitFor(() => expect(ui.container.textContent).toBe('second'))
  act(() => ports.setPlaying(false))
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  await act(async () => { await Promise.resolve() })
  expect(ui.container.textContent).toBe('second'); expect(report).not.toHaveBeenCalled()
})

it('resets the current page fragment progress without changing another page', async () => {
  const course = project()
  course.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  course.instances = Object.fromEntries(['current', 'other'].map(id => [id, { id, definitionId: 'web', data: { html: '<p class="fragment">一</p><p class="fragment">二</p>' } }]))
  course.surfaces = ['current', 'other'].map(id => ({ id, kind: 'slide', title: id, childIds: [id], designSize: { width: 800, height: 600 } }))
  const state = new Map([[componentFragmentStateKey('current'), 0], [componentFragmentStateKey('other'), 1]])
  const navigation = new ComponentNavigationOwner({ project: () => course, surfaceId: () => 'current', select() {},
    courseState: { get: <T,>(key: string) => state.get(key) as T | undefined, set: (key, value) => { state.set(key, value) } } })
  expect(await navigation.replayCurrentSurface()).toBe(true)
  expect(state.get(componentFragmentStateKey('current'))).toBe(2)
  expect(state.get(componentFragmentStateKey('other'))).toBe(1)
  course.surfaces[0] = { ...course.surfaces[0], kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 },
    frames: [{ id: 'follow', title: '当前正文', targetInstanceId: 'current', pose: { x: 0, y: 0, zoom: 1 } }] } }
  expect(await navigation.replayCurrentSurface()).toBe(true)
  expect(state.get(componentFragmentStateKey('current'))).toBe(0); expect(state.get(componentFragmentStateKey('other'))).toBe(1)
  const camera = createComponentSpatialCameraPort({ x: 50, y: 60, zoom: 2 })
  let frameId: string | null = 'follow', stepIndex: number | null = 1
  const off = navigation.registerCamera('current', camera, { frameId: () => frameId, selectFrame: value => { frameId = value },
    stepIndex: () => stepIndex, selectStep: value => { stepIndex = value } })
  course.surfaces[0].presentation = { initialStateId: 'initial', states: [{ id: 'initial', title: '初始', overrides: {} }] }
  expect(await navigation.replayCurrentSurface()).toBe(true)
  expect(camera.read()).toEqual({ x: 0, y: 0, zoom: 1 })
  expect(frameId).toBeNull(); expect(stepIndex).toBeNull()
  expect(state.get(componentFragmentStateKey('current'))).toBe(0); expect(state.get(componentFragmentStateKey('other'))).toBe(1)
  off(); camera.dispose()
  navigation.dispose()
})

it('mounts a real Flow NodeView child and retains its runtime DOM across source and layout projections', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const properties = ['getClientRects', 'getBoundingClientRect'] as const
  const descriptors = properties.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  const course = project()
  course.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  course.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], frame: { width: 300, height: 120, transform: [1, 0, 0, 1, 0, 0] } }
  course.instances.text.frame = { width: 220, height: 50, transform: [1, 0, 0, 1, 0, 0] }
  course.surfaces = [{ id: 'flow', kind: 'flow', title: '章节正文', childIds: ['group'] }]
  const target = { documentId: 'real-flow', epoch: 'flow-epoch', project: course, editingProject: course, resources,
    surfaceId: 'flow', activeStateId: null, instanceIds: [], instanceId: null }
  const bridge = { captureTarget: () => target, read: () => ({ activation: 1 }), capture: vi.fn(), editCaptured: vi.fn(), undo: vi.fn(), redo: vi.fn() }
  flowProbe.state = { courseBridge: bridge, courseKernel: bridge, flowDocumentDrafts: {}, setFlowDocumentDraft: vi.fn(),
    setFlowContextSelection: vi.fn(), flowEditingInstance: null, slideContentEdit: null }
  let ports!: CourseV10RuntimePorts
  const report = vi.fn()
  const ui = render(<CourseV10RuntimeView documentId="real-flow" model={{ kind: 'course-v10', project: course, resources }}
    surfaceId="flow" selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={() => {}} report={report}
    renderWorkspace={runtime => { ports = runtime; return <FlowWorkspace documentId="real-flow" project={course} surfaceId="flow" onSelectImageAsset={async () => null} /> }} />)
  try {
    await waitFor(() => expect(ports.world.contentElement('text')?.textContent).toContain('初始文字'))
    const root = ports.world.contentElement('text')!.firstElementChild
    expect(root?.isConnected).toBe(true)
    ports.world.setState('flow-progress', 3)
    fireEvent.click(ui.getByRole('button', { name: /^源码$/ }))
    await waitFor(() => expect(ui.getByLabelText('正文源文编辑')).toBeTruthy())
    fireEvent.click(ui.getByRole('button', { name: /^正文$/ }))
    await waitFor(() => expect(ports.world.contentElement('text')?.firstElementChild).toBe(root))
    await waitFor(() => expect(root?.isConnected).toBe(true))
    expect(ports.world.getState('flow-progress')).toBe(3)
    expect(report).not.toHaveBeenCalled(); expect(bridge.editCaptured).not.toHaveBeenCalled()
  } finally {
    ui.unmount()
    await act(async () => { await Promise.resolve(); await ports.world.dispose() })
    properties.forEach((key, index) => descriptors[index] ? Object.defineProperty(Range.prototype, key, descriptors[index]!) : Reflect.deleteProperty(Range.prototype, key))
  }
})

it('forwards a live author gesture preview through the actual runtime host and retires it with its mount', async () => {
  const previewGeometry = vi.fn(), course = project(), root = document.createElement('div'); document.body.append(root)
  course.definitions[TEXT_DEFINITION.id] = { ...TEXT_DEFINITION, implementation: { kind: 'builtin', key: 'author-preview' } }
  const player = mountV10Model({ root, model: { kind: 'course-v10', project: course, resources }, runScopeId: 'preview-host',
    builtins: new Map([['author-preview', { mount(context) {
      context.authoring!.register({ kind: 'text', initialValue: '局部内容', dataPath: ['text'],
        localBounds: { width: 80, height: 30, transform: [1, 0, 0, 1, 0, 0] } }, { previewGeometry })
      return { update() {}, dispose() {} }
    } }]]) })
  await player.ready
  const spot = player.runtime.authorSpots().find(value => value.dataPath?.[0] === 'text')!
  expect(player.runtime.previewAuthorSpot(spot.id, { translateX: 18 })).toBe(true)
  expect(previewGeometry).toHaveBeenLastCalledWith({ translateX: 18 })
  expect(player.runtime.previewAuthorSpot(spot.id, null)).toBe(true)
  expect(previewGeometry).toHaveBeenLastCalledWith(null)
  await player.dispose()
  expect(player.runtime.previewAuthorSpot(spot.id, { translateX: 40 })).toBe(false)
  expect(previewGeometry).toHaveBeenCalledTimes(2); root.remove()
})

it('awaits the new React surface camera before accepting a teacher jump to its authored frame', async () => {
  // External component callbacks run outside React's event flush and without act().
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
  const course = project(), pose = { x: 70, y: 80, zoom: 2 }
  course.surfaces.push({ id: 'spatial', kind: 'spatial', title: '空间', childIds: [], designSize: { width: 800, height: 600 },
    spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'detail', title: '目标镜头', pose }] } })
  const camera = createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 })
  let ports!: CourseV10RuntimePorts, ready!: () => void, registered = false
  const initialCommit = new Promise<void>(resolve => { ready = resolve })
  function Projection({ runtime }: { runtime: CourseV10RuntimePorts }) {
    useEffect(() => {
      if (runtime.surfaceId !== 'spatial') return
      registered = true
      const off = runtime.registerCamera('spatial', camera)
      return () => { registered = false; off() }
    }, [runtime.surfaceId])
    return <div>{runtime.surfaceId}</div>
  }
  function Editor() {
    const [surface, select] = useState('page')
    useEffect(() => ready(), [])
    return <CourseV10RuntimeView documentId="camera-commit" model={{ kind: 'course-v10', project: course, resources }}
      surfaceId={surface} selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={select} report={() => {}}
      renderWorkspace={runtime => { ports = runtime; return <Projection runtime={runtime} /> }} />
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); root.render(<Editor />)
  try {
    await initialCommit
    ports.setPlaying(true)
    expect(await Promise.resolve().then(() => ports.navigation.teacherPort().execute({ type: 'scene.go', sceneId: 'spatial', targetStateId: 'detail' }))).toBe(true)
    expect(registered).toBe(true); expect(camera.read()).toEqual(pose); expect(container.textContent).toBe('spatial')
    const aborted = new AbortController()
    const pending = ports.navigation.execute({ type: 'scene.go', sceneId: 'page' }, aborted.signal)
    aborted.abort()
    expect(await pending).toBe(false)
  } finally { root.unmount(); await ports.world.dispose(); camera.dispose(); container.remove() }
})
