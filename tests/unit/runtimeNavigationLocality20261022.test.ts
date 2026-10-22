import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import type { ComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { componentSurfaceGeometryTargets } from '../../src/player/componentPlatform/spatialTargets'
import { spatialTourSteps } from '../../src/player/surfaces/spatial/componentPlatform/graph'
import { setRootContainers } from '../helpers/glxWorkFixture'

vi.mock('../../src/player/componentPlatform/spatialTargets', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/player/componentPlatform/spatialTargets')>()
  return { ...actual, componentSurfaceGeometryTargets: vi.fn(actual.componentSurfaceGeometryTargets) }
})
vi.mock('../../src/player/surfaces/spatial/componentPlatform/graph', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/player/surfaces/spatial/componentPlatform/graph')>()
  return { ...actual, spatialTourSteps: vi.fn(actual.spatialTourSteps) }
})

afterEach(() => vi.clearAllMocks())

it('shares authored Spatial facts across Source-shaped observers while path, viewport, project and fragments stay current', async () => {
  let project = createBlankCourseProjectV10('navigation locality')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  for (const [index, id] of ['one', 'two'].entries()) project.instances[id] = { id, definitionId: 'web', data: {},
    frame: { width: 100, height: 50, transform: [1, 0, 0, 1, index * 500, 0] } }
  setRootContainers(project, [{ id: 'space', kind: 'spatial', title: 'Space', childIds: ['one', 'two'],
    designSize: { width: 400, height: 200 }, spatial: { home: { x: 0, y: 0, zoom: 1 },
      frames: [{ id: 'fit', title: 'Fit one', targetInstanceId: 'one', pose: { x: 0, y: 0, zoom: 1 } }],
      paths: [{ id: 'other', title: 'Other', frameIds: [], instanceIds: ['two'] }] } }])
  let pose = { x: 0, y: 0, zoom: 1 }, notify: (() => void) | undefined
  const camera: ComponentSpatialCameraPort = { read: () => ({ ...pose }),
    set(next) { pose = { ...next }; notify?.() },
    subscribe(listener) { const callback = () => listener(pose); notify = callback; return () => { if (notify === callback) notify = undefined } },
    async present(next) { camera.set(next); return true }, dispose() {} }
  let pathId: string | null = null, frameId: string | null = null, stepIndex: number | null = null
  const viewport = { width: 400, height: 200 }
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'space', select() {} })
  navigation.registerCamera('space', camera, { frameId: () => frameId, selectFrame: id => { frameId = id },
    pathId: () => pathId, stepIndex: () => stepIndex, selectStep: index => { stepIndex = index }, viewport: () => viewport })
  let html = '<p>ready</p>'
  navigation.connectRuntime({ read: () => ({ status: 'ready', document: 'web', html }), prepare: async () => true })
  const teacher = navigation.teacherPort()
  const types = ['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.replay', 'course.restart',
    'scene.open-picker', 'audio.toggle-mute', 'player.fullscreen.toggle'] as const
  for (let index = 0; index < 3; index++) navigation.subscribe(() => {
    const snapshot = teacher.read()
    for (const type of types) teacher.canExecute({ type })
    snapshot.scenes.some(scene => teacher.canExecute({ type: 'scene.go', sceneId: scene.id }))
  })
  try {
    expect(navigation.read().progress).toMatchObject({ stepName: '', stepCount: 1 })
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'space', targetStateId: 'fit' })).toBe(true)
    expect(navigation.read().progress).toMatchObject({ stepName: 'Fit one', stepCount: 1 })
    expect(camera.read().zoom).toBe(4)
    camera.set({ x: 81, y: 92, zoom: 1.5 })
    expect(navigation.read().camera).toMatchObject({ x: 81, y: 92, zoom: 1.5 })
    expect(componentSurfaceGeometryTargets).toHaveBeenCalledTimes(1)
    expect(spatialTourSteps).toHaveBeenCalledTimes(1)

    pathId = 'other'
    expect(navigation.read().scenes[0].targets?.some(target => target.id === 'instance:two')).toBe(true)
    expect(spatialTourSteps).toHaveBeenCalledTimes(2)
    expect(componentSurfaceGeometryTargets).toHaveBeenCalledTimes(1)

    pathId = null; viewport.width = 800; viewport.height = 400
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'space', targetStateId: 'fit' })).toBe(true)
    expect(camera.read().zoom).toBe(8)
    expect(componentSurfaceGeometryTargets).toHaveBeenCalledTimes(1)
    expect(spatialTourSteps).toHaveBeenCalledTimes(3)

    project = { ...project, revision: project.revision + 1, instances: { ...project.instances,
      one: { ...project.instances.one, frame: { ...project.instances.one.frame!, width: 200 } } } }
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'space', targetStateId: 'fit' })).toBe(true)
    expect(camera.read()).toMatchObject({ x: 100, zoom: 4 })
    expect(componentSurfaceGeometryTargets).toHaveBeenCalledTimes(2)
    expect(spatialTourSteps).toHaveBeenCalledTimes(4)

    html = '<p class="fragment">one</p><p class="fragment">two</p>'
    navigation.runtimeCapabilitiesChanged('one')
    expect(navigation.read().progress?.stepCount).toBe(3)
    expect(componentSurfaceGeometryTargets).toHaveBeenCalledTimes(2)
    expect(spatialTourSteps).toHaveBeenCalledTimes(5)
  } finally { navigation.dispose() }
})

it('reads Flow position once per snapshot and keeps manual scroll, zoom and interaction capability live', () => {
  const project = createBlankCourseProjectV10('live Flow facts')
  project.definitions.document = { id: 'document', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
  for (const id of ['first', 'last']) project.instances[id] = { id, definitionId: 'document', data: {
    type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: id }] } } }
  setRootContainers(project, [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['first', 'last'] }])
  let active = 'first', zoom = 1, interactive = true
  const readReading = vi.fn(() => ({ activeInstanceId: active, progress: active === 'first' ? 0 : 1 }))
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', interactive: () => interactive, select() {} })
  navigation.registerObservation('flow', { readZoom: () => zoom, setZoom() {}, reset() {}, readReading })
  try {
    expect(navigation.read()).toMatchObject({ progress: { stepIndex: 0 }, reading: { activeInstanceId: 'first' }, zoom: 1 })
    expect(readReading).toHaveBeenCalledTimes(1)
    active = 'last'; zoom = 2
    expect(navigation.read()).toMatchObject({ progress: { stepIndex: 1 }, reading: { activeInstanceId: 'last', progress: 1 }, zoom: 2 })
    expect(readReading).toHaveBeenCalledTimes(2)
    expect(navigation.canExecute({ type: 'step.next' })).toBe(false)
    expect(navigation.canExecute({ type: 'step.previous' })).toBe(true)
    const reads = readReading.mock.calls.length
    expect(navigation.canExecute({ type: 'scene.open-picker' })).toBe(true)
    expect(navigation.canExecute({ type: 'player.fullscreen.toggle' })).toBe(true)
    expect(navigation.canExecute({ type: 'audio.toggle-mute' })).toBe(false)
    expect(readReading).toHaveBeenCalledTimes(reads)
    interactive = false
    expect(navigation.canExecute({ type: 'scene.open-picker' })).toBe(false)
  } finally { navigation.dispose() }
})
