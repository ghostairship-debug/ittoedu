import { describe, expect, it, vi } from 'vitest'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { presentNavigationTransition } from '../../src/player/behaviors/navigation/navigationTransition'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'

function work(): CourseProjectV10 {
  const slide = () => ({ kind: 'slide' as const,
    presentation: { initialStateId: 'overview', states: [{ id: 'overview', title: 'Overview', overrides: {} }, { id: 'detail', title: 'Detail', overrides: {} }] } })
  return { schemaVersion: 11, id: 'work', revision: 0, title: 'Scoped work', rootIds: ['flow', 'next', 'program'], entry: { rootInstanceId: 'flow' },
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      spatial: { id: 'spatial', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } },
      slide: { id: 'slide', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      source: { id: 'source', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['A', 'B', 'root-button'] },
      A: { id: 'A', definitionId: 'slide', data: {}, container: slide(), childIds: ['program-A'] },
      B: { id: 'B', definitionId: 'slide', data: {}, container: slide(), childIds: [] },
      'program-A': { id: 'program-A', definitionId: 'source', data: {} },
      'root-button': { id: 'root-button', definitionId: 'source', data: {} },
      next: { id: 'next', definitionId: 'slide', data: {}, container: { kind: 'slide' }, childIds: [] },
      program: { id: 'program', definitionId: 'source', data: {} } }, global: { underlay: [], overlay: [] }, assets: {} }
}

function spatialWork() {
  const project = work()
  for (const id of ['A', 'B']) project.instances[id] = { ...project.instances[id], definitionId: 'spatial',
    container: { kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [] } } }
  return project
}

function owner(project: CourseProjectV10, initial = 'flow') {
  let root = initial
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => root,
    select: (id, _signal, onCommit) => { root = id; onCommit?.(); return true } })
  return { navigation, root: () => root }
}

function controlledCamera() {
  let pose = { x: 0, y: 0, zoom: 1 }
  const requests: { signal?: AbortSignal; finish(): void; aborted: boolean }[] = []
  const camera = { read: () => ({ ...pose }), set: (next: typeof pose) => { pose = next }, subscribe: () => () => {}, dispose() {},
    present: (next: typeof pose, options?: { signal?: AbortSignal }) => new Promise<boolean>(resolve => {
      const request = { signal: options?.signal, aborted: false, finish: () => { if (!request.aborted) { pose = next; resolve(true) } } }
      requests.push(request)
      options?.signal?.addEventListener('abort', () => { request.aborted = true; resolve(false) }, { once: true })
    }) } as unknown as ComponentSpatialCameraPort
  return { camera, requests }
}

describe('container navigation through the existing owner', () => {
  it('steps Flow headings and sections using the mounted reading position without storing presentation state', async () => {
    const project = work()
    project.definitions.document = { id: 'document', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
    const content = (text: string) => ({ inlines: [{ type: 'text', text }] })
    project.instances.flow.childIds!.unshift('title', 'section')
    project.instances.title = { id: 'title', definitionId: 'document', data: { type: 'heading', level: 1, content: content('引言') } }
    project.instances.section = { id: 'section', definitionId: 'document', data: { type: 'section', title: content('正文') }, childIds: ['sub'] }
    project.instances.sub = { id: 'sub', definitionId: 'document', data: { type: 'heading', level: 2, content: content('小结') } }
    const before = structuredClone(project), { navigation, root } = owner(project)
    let active: string | null = 'title'
    const goToInstance = vi.fn((id: string | null) => { active = id ?? 'title'; return true })
    navigation.registerObservation('flow', { readZoom: () => 1, setZoom() {}, reset() {}, goToInstance,
      readReading: ids => ({ activeInstanceId: ids.includes(active!) ? active : null, progress: 0 }) })
    const directory = navigation.read().scenes[0].targets!
    expect(directory.map(target => [target.kind, target.id])).toEqual([['heading', 'title'], ['heading', 'section'], ['heading', 'sub']])
    expect(navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 3, stepName: '引言' })
    expect(await navigation.execute({ type: 'step.next' })).toBe(true)
    expect(goToInstance).toHaveBeenLastCalledWith('section', expect.any(AbortSignal))
    expect(navigation.read().progress).toMatchObject({ stepIndex: 1, stepCount: 3, stepName: '正文' })
    // Manual scrolling changes the same reading position used by buttons.
    active = 'sub'
    expect(await navigation.execute({ type: 'step.previous' })).toBe(true)
    expect(active).toBe('section')
    expect(await navigation.execute(directory[0].action)).toBe(true)
    expect(active).toBe('title')
    active = 'sub'
    expect(await navigation.execute({ type: 'step.next' })).toBe(true)
    expect(root()).toBe('next')
    expect(navigation.currentStateId('flow')).toBeNull()
    expect(project).toEqual(before)
    navigation.dispose()
  })

  it('keeps Spatial camera targets separate from Slide state targets, including identical local names', async () => {
    const project = spatialWork()
    project.instances.A.container!.spatial!.frames = [{ id: 'detail', title: '细节镜头', pose: { x: 20, y: 10, zoom: 2 } }]
    const { navigation } = owner(project)
    let pose = { x: 0, y: 0, zoom: 1 }
    navigation.registerCamera('A', { read: () => pose, set: next => { pose = next }, subscribe: () => () => {}, dispose() {},
      present: async next => { pose = next; return true } })
    const local = navigation.forContainer('A'), targets = local.read().scenes[0].targets!
    expect(targets.map(target => target.kind)).toEqual(['camera'])
    expect(await local.execute(targets[0].action)).toBe(true)
    expect(pose).toMatchObject({ x: 20, y: 10, zoom: 2 })
    expect(local.currentStateId?.()).toBeNull()
    expect(navigation.forContainer('B').currentStateId?.()).toBeNull()
    navigation.dispose()
  })

  it('binds program and native controls to the same local state without changing the sibling or author', async () => {
    const project = work(), before = structuredClone(project), { navigation, root } = owner(project)
    const program = navigation.forInstance('program-A'), native = navigation.forContainer('A')
    expect(program.readLocation()).toBe('A')
    expect(navigation.isContainerActive('A')).toBe(true)
    expect(navigation.isContainerActive('B')).toBe(true)
    expect(await program.execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'detail' })).toBe(true)
    expect(native.currentStateId?.()).toBe('detail')
    expect(navigation.currentStateId('B')).toBe('overview')
    expect(await native.execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'overview' })).toBe(true)
    expect(program.currentStateId?.()).toBe('overview')
    expect(root()).toBe('flow')
    expect(await native.execute({ type: 'scene.go', containerId: 'A', sceneId: 'B', targetStateId: 'detail' })).toBe(false)
    expect(project).toEqual(before)
    navigation.dispose()
  })

  it('retains root control directory navigation and gives a pure program no implicit presentation scope', async () => {
    const project = work(), { navigation, root } = owner(project)
    expect(navigation.forInstance('root-button').read().scenes.map(scene => scene.id)).toEqual(['flow', 'next', 'program'])
    expect(await navigation.forInstance('root-button').execute({ type: 'scene.next' })).toBe(true)
    expect(root()).toBe('next')
    const program = navigation.forInstance('program')
    expect(program.readLocation()).toBeNull()
    expect(program.read().scenes).toEqual([])
    expect(await program.execute({ type: 'step.next' })).toBe(false)
    expect(await program.execute({ type: 'scene.go', containerId: 'A', sceneId: 'A', targetStateId: 'detail' })).toBe(true)
    expect(root()).toBe('flow')
    expect(navigation.currentStateId('A')).toBe('detail')
    navigation.dispose()
  })

  it('retains student guard availability and the existing teacher forced jump', async () => {
    const project = work()
    project.logic = { courseState: [], navigationGuards: [{ id: 'blocked', effect: 'block', toSurfaceIds: ['next'], match: 'all', conditions: [], message: 'Locked' }] }
    const { navigation, root } = owner(project), student = navigation.forInstance('root-button')
    expect(student.canExecute({ type: 'scene.go', sceneId: 'next' })).toBe(false)
    expect(await student.execute({ type: 'scene.go', sceneId: 'next' })).toBe(false)
    expect(root()).toBe('flow')
    expect(navigation.teacherPort().canExecute({ type: 'scene.go', sceneId: 'next' })).toBe(true)
    expect(await navigation.teacherPort().execute({ type: 'scene.go', sceneId: 'next' })).toBe(true)
    expect(root()).toBe('next')
    navigation.dispose()
  })

  it('keeps nested containers active under a program root without inventing a presentation scope for the program', async () => {
    const project = work()
    project.instances.flow.childIds = ['B', 'root-button']
    project.instances.program.childIds = ['A']
    const { navigation, root } = owner(project, 'program')
    expect(navigation.read().locationId).toBe('program')
    expect(navigation.forInstance('program').readLocation()).toBeNull()
    expect(navigation.isContainerActive('A')).toBe(true)
    expect(navigation.isContainerActive('B')).toBe(false)
    expect(await navigation.forInstance('program-A').execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'detail' })).toBe(true)
    expect(navigation.forContainer('A').currentStateId?.()).toBe('detail')
    expect(root()).toBe('program')
    navigation.dispose()
  })

  it('navigates the rootIds directory into and back from a Source root while retaining its lack of implicit presentation', async () => {
    const project = work(), { navigation, root } = owner(project, 'next'), replays: string[] = []
    navigation.subscribeSceneReplay(id => replays.push(id))
    expect(await navigation.execute({ type: 'scene.next' })).toBe(true)
    expect(root()).toBe('program')
    expect(navigation.read().locationId).toBe('program')
    expect(navigation.read().scenes.at(-1)?.targets).toEqual([])
    expect(navigation.currentStateId()).toBeNull()
    expect(await navigation.forInstance('program').execute({ type: 'step.previous' })).toBe(false)
    expect(await navigation.execute({ type: 'scene.previous' })).toBe(true)
    expect(root()).toBe('next')
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'program' })).toBe(true)
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'program', targetStateId: 'detail' })).toBe(false)
    expect(await navigation.execute({ type: 'scene.replay' })).toBe(true)
    expect(replays).toEqual(['program'])
    navigation.dispose()

    const single = work(); single.rootIds = ['program']; single.entry = { rootInstanceId: 'program' }
    const pure = owner(single, 'program').navigation
    expect(pure.canExecute({ type: 'step.next' })).toBe(false)
    expect(pure.canExecute({ type: 'scene.next' })).toBe(false)
    pure.dispose()
  })

  it('replays an empty spatial tour at home without introducing presentation state', async () => {
    const { navigation } = owner(spatialWork())
    let pose = { x: 0, y: 0, zoom: 1 }
    navigation.registerCamera('A', { read: () => pose, set: next => { pose = next }, subscribe: () => () => {}, dispose() {},
      present: async next => { pose = next; return true } })
    const local = navigation.forContainer('A')
    expect(await local.execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'detail' })).toBe(false)
    expect(await local.execute({ type: 'camera.present', pose: { x: 40, y: 20, zoom: 2 } })).toBe(true)
    expect(await local.execute({ type: 'scene.replay' })).toBe(true)
    expect(pose).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(local.currentStateId?.()).toBeNull()
    navigation.dispose()
  })

  it('cancels an older camera request only in its owning container', async () => {
    const { navigation } = owner(spatialWork()), A = controlledCamera(), B = controlledCamera()
    navigation.registerCamera('A', A.camera); navigation.registerCamera('B', B.camera)
    const firstA = navigation.forContainer('A').execute({ type: 'camera.present', pose: { x: 1, y: 0, zoom: 1 } })
    const requestB = navigation.forContainer('B').execute({ type: 'camera.present', pose: { x: 2, y: 0, zoom: 1 } })
    const nextA = navigation.forContainer('A').execute({ type: 'camera.present', pose: { x: 3, y: 0, zoom: 1 } })
    expect(A.requests[0].aborted).toBe(true)
    expect(B.requests[0].aborted).toBe(false)
    B.requests[0].finish(); A.requests[1].finish()
    expect(await firstA).toBe(false)
    expect(await requestB).toBe(true)
    expect(await nextA).toBe(true)
    expect(A.camera.read().x).toBe(3); expect(B.camera.read().x).toBe(2)
    navigation.dispose()
  })

  it('shares the editor container selection and permits paused editor navigation without enabling authored controls', async () => {
    const project = work(), selections: Record<string, string | null> = { A: 'detail', B: null }
    const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', interactive: () => false,
      containerStateId: id => Object.hasOwn(selections, id) ? selections[id] : undefined,
      select() { return true }, selectState(stateId, id, _signal, committed) { selections[id] = stateId; committed?.(); return true } })
    expect(navigation.currentStateId('A')).toBe('detail')
    expect(navigation.currentStateId('B')).toBeNull()
    expect(await navigation.forContainer('A').execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'overview' })).toBe(false)
    expect(await navigation.editorPort().forContainer!('A').execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'overview' })).toBe(true)
    expect(navigation.readVisibility('A')).toEqual({ zoom: 1, stateId: 'overview' })
    expect(selections.B).toBeNull()
    navigation.dispose()
  })

  it('commits local state before the existing projection callback reads it', async () => {
    const project = work(), statesDuringRender: (string | null)[] = []
    let commits = 0
    const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', select() { return true },
      async selectState(_stateId, id, _signal, committed) {
        expect(navigation.currentStateId(id)).toBe('overview')
        committed?.()
        statesDuringRender.push(navigation.currentStateId(id))
        committed?.()
        await Promise.resolve()
        return true
      } })
    expect(await navigation.forContainer('A').execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'detail' }, undefined, () => commits++)).toBe(true)
    expect(statesDuringRender).toEqual(['detail'])
    expect(navigation.currentStateId('B')).toBe('overview')
    expect(commits).toBe(1)
    navigation.dispose()
  })

  it('retires pending local actions when their ancestor root is left', async () => {
    const { navigation, root } = owner(spatialWork()), A = controlledCamera()
    navigation.registerCamera('A', A.camera)
    const pending = navigation.forContainer('A').execute({ type: 'camera.present', pose: { x: 9, y: 0, zoom: 1 } })
    expect(await navigation.execute({ type: 'scene.go', sceneId: 'next' })).toBe(true)
    expect(root()).toBe('next')
    expect(await pending).toBe(false)
    expect(A.camera.read().x).toBe(0)
    navigation.dispose()
  })

  it('keeps explicit target facts through the real World-to-navigation action path', async () => {
    const project = work(), { navigation, root } = owner(project), contexts = new Map<string, ComponentRuntimeContext>()
    project.instances.space = { id: 'space', definitionId: 'spatial', data: {}, childIds: [], container: { kind: 'spatial',
      spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'detail', title: 'Detail camera', pose: { x: 20, y: 0, zoom: 2 } }] } } }
    project.instances.flow.childIds!.push('space')
    let cameraPose = { x: 0, y: 0, zoom: 1 }
    navigation.registerCamera('space', { read: () => cameraPose, set: next => { cameraPose = next }, subscribe: () => () => {}, dispose() {},
      present: async next => { cameraPose = next; return true } })
    const elements = new Map(Object.keys(project.instances).map(id => [id, document.createElement('div')]))
    for (const [id, instance] of Object.entries(project.instances)) for (const child of instance.childIds ?? []) elements.get(id)!.append(elements.get(child)!)
    for (const id of project.rootIds) document.body.append(elements.get(id)!)
    const world = new ComponentRuntimeWorld('scoped-action-path', { studentNavigation: navigation, teacherController: navigation.teacherPort(),
      resolveSource: async () => ({ implementation: { mount(context) {
        contexts.set(context.instance.id, context)
        return { update() {}, dispose() {} }
      } } }) })
    for (const [id, element] of elements) { world.bind(id, element); world.bindTarget(id, element) }
    try {
      await world.sync(project, { assets: {}, components: {} })
      const interactions = contexts.get('program-A')!.interactions!
      const actionContext = { signal: new AbortController().signal, ruleId: 'local', stepId: 'change', restartFromBeginning: false }
      expect(await interactions.executeAction({ type: 'presentation.set', containerId: 'A', stateId: 'detail' }, actionContext)).toBe(true)
      expect(navigation.currentStateId('A')).toBe('detail')
      expect(await interactions.executeAction({ type: 'presentation.set', containerId: 'space', stateId: 'detail' }, actionContext)).toBe(false)
      expect(cameraPose.zoom).toBe(1)
      expect(await interactions.executeAction({ type: 'scene.go', sceneId: 'space', targetStateId: 'detail' }, actionContext)).toBe(true)
      expect(cameraPose.zoom).toBe(2)
      expect(await interactions.executeAction({ type: 'location.go', containerId: 'A', locationId: 'next' }, actionContext)).toBe(false)
      expect(root()).toBe('flow'); expect(navigation.currentStateId('B')).toBe('overview')
      expect(await interactions.executeAction({ type: 'location.go', locationId: 'program' }, actionContext)).toBe(true)
      expect(root()).toBe('program')
      expect(await navigation.forContainer('A').execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'overview' })).toBe(true)
      expect(root()).toBe('flow')
      expect(interactions.currentStateId()).toBe('overview')
    } finally {
      await world.dispose(); navigation.dispose()
      for (const id of project.rootIds) elements.get(id)?.remove()
    }
  })
})

it('keeps local transition cancellation off the document and sibling container', async () => {
  const A = document.createElement('div'), B = document.createElement('div')
  const nativeTransition = vi.fn()
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: nativeTransition })
  const animate = (root: HTMLElement) => {
    const tracks: { complete(): void; cancelled: boolean }[] = []
    Object.defineProperty(root, 'animate', { configurable: true, value: () => {
      let complete!: () => void, reject!: () => void
      const finished = new Promise<void>((resolve, failure) => { complete = resolve; reject = () => failure(new Error('cancelled')) })
      const track = { complete, cancelled: false }; tracks.push(track)
      return { finished, cancel() { track.cancelled = true; reject() } } as unknown as Animation
    } })
    return tracks
  }
  const a = animate(A), b = animate(B), stopA = new AbortController(), stopB = new AbortController(), commits: string[] = []
  const first = presentNavigationTransition(A, { effect: 'fade', durationMs: 100 }, async () => { commits.push('A'); return true }, stopA.signal, { scope: 'container' })
  const second = presentNavigationTransition(B, { effect: 'fade', durationMs: 100 }, async () => { commits.push('B'); return true }, stopB.signal, { scope: 'container' })
  stopA.abort()
  expect(a[0].cancelled).toBe(true); expect(b[0].cancelled).toBe(false)
  b[0].complete()
  await vi.waitFor(() => expect(b).toHaveLength(2))
  b[1].complete()
  expect(await first).toBe(false); expect(await second).toBe(true)
  expect(commits).toEqual(['B']); expect(nativeTransition).not.toHaveBeenCalled()
  Reflect.deleteProperty(document, 'startViewTransition')
})
