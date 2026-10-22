import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import { componentFragmentStateKey } from '../../src/player/componentPlatform/fragments'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation, CourseProjectV10 } from '../../src/shared/contracts/component-platform'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

/** Only mount completion and browser visibility are controlled. Host, World,
 * generation retirement, navigation/camera and shared state are production owners. */
async function fixture(active = 'B', single = false) {
  let project = createBlankCourseProjectV10('runtime document navigation')
  const source = (id: string) => ({ kind: 'source' as const, language: 'javascript' as const, source: `export default {mount(){}} /* ${id} */` })
  for (const [index, id] of ['first', 'last', 'hidden'].entries()) {
    project.definitions[id] = { id, role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances[id] = { id, definitionId: id, implementationOverride: source(id), data: { html: '<p class="fragment">one</p><p class="fragment">two</p>' },
      frame: { width: 100, height: 100, transform: [1, 0, 0, 1, index * 2000, 0] } }
  }
  setRootContainers(project, [
    { id: 'A', title: 'Before', kind: 'slide', childIds: [] },
    { id: 'B', title: 'Space', kind: 'spatial', childIds: single ? ['first'] : ['first', 'last'], designSize: { width: 800, height: 600 },
      spatial: { home: { x: -4000, y: 0, zoom: 1 }, frames: (single ? ['first'] : ['first', 'last']).map(id => ({ id: `frame-${id}`, title: id, targetInstanceId: id, pose: { x: 0, y: 0, zoom: 1 } })) } },
    { id: 'C', title: 'After', kind: 'slide', childIds: [] },
    { id: 'hidden-surface', title: 'Never visited', kind: 'slide', childIds: ['hidden'] },
  ])
  if (single) { setRootContainers(project, [componentSurfaces(project)[1]]); delete project.instances.last; delete project.instances.hidden }
  // A camera arrives before the next observer delivery in a real browser.
  const visibility = new Map<Element, (visible: boolean) => void>()
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: (entries: unknown[]) => void) {} observe(target: Element) { const notify = (visible: boolean) => this.callback([{ target, isIntersecting: visible }]); visibility.set(target, notify); notify(false) } unobserve(target: Element) { visibility.delete(target) } disconnect() {} })
  const roots = new Map<string, HTMLElement>(), camera = createComponentSpatialCameraPort(componentSurfaces(project).find(surface => surface.id === 'B')!.spatial!.home)
  let frame: string | null = null, index: number | null = null, world!: ComponentRuntimeWorld
  const rootsVisible = () => { for (const [id, root] of roots) root.hidden = !componentSurfaces(project).find(surface => surface.id === active)?.childIds.includes(id) }
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => active,
    courseState: { get: key => world?.getState(key) as never, set: (key, value) => world?.setState(key, value) },
    select: async id => { active = id; rootsVisible(); await world.sync(project, { assets: {}, components: {} }) } })
  navigation.registerCamera('B', camera, { frameId: () => frame, selectFrame: value => { frame = value }, stepIndex: () => index, selectStep: value => { index = value } })
  const mounts: string[] = [], completed: string[] = [], disposed: string[] = [], contexts = new Map<string, ComponentRuntimeContext>(), gates = new Map<string, ReturnType<typeof deferred>>()
  const modules = new Map<string, ComponentRuntimeImplementation>()
  const define = (id: string, document: 'web' | undefined = 'web') => {
    const implementation = source(id), gate = deferred(); gates.set(id, gate)
    modules.set(implementation.source, { document, async mount(context) {
      mounts.push(id); contexts.set(id, context)
      await gate.promise
      if (context.scope.isActive() && context.root) context.root.innerHTML = (context.instance.data as { html: string }).html
      completed.push(id)
      return { update() {}, dispose() { disposed.push(id) } }
    } })
    return implementation
  }
  for (const id of Object.keys(project.instances).filter(id => !project.instances[id].container)) define(id)
  const errors: string[] = []
  world = new ComponentRuntimeWorld('document-navigation', { teacherController: navigation.teacherPort(), studentNavigation: navigation, report: message => errors.push(message),
    resolveSource: async implementation => {
      const loaded = modules.get(implementation.source!)
      if (!loaded) throw new Error('Unknown fixture module')
      return { implementation: loaded }
    } })
  for (const [id, instance] of Object.entries(project.instances)) {
    if (instance.container) continue
    const root = document.createElement('div'); roots.set(id, root); document.body.append(root)
    root.getBoundingClientRect = () => new DOMRect(instance.frame!.transform[4] - camera.read().x + 400, 100, 100, 100)
    world.bind(id, root); world.bindTarget(id, root)
  }
  rootsVisible(); await world.sync(project, { assets: {}, components: {} })
  return { navigation, world, camera, mounts, completed, disposed, contexts, gates, errors, active: () => active, frame: () => frame,
    intersect(id: string, visible: boolean) { const root = roots.get(id); if (root) visibility.get(root)?.(visible) },
    project: () => project,
    async replace(id: string, nextId: string, document?: 'web') {
      const implementation = define(nextId, document)
      // Undefined is an intentional ordinary Source declaration in this change.
      if (document === undefined) delete modules.get(implementation.source)!.document
      project = { ...project, revision: project.revision + 1, instances: { ...project.instances, [id]: { ...project.instances[id], implementationOverride: implementation } } }
      return world.sync(project, { assets: {}, components: {} })
    },
    setProject(value: CourseProjectV10) { project = value; navigation.changed() },
    async dispose() { navigation.dispose(); for (const gate of gates.values()) gate.resolve(); await world.dispose(); camera.dispose(); for (const root of roots.values()) root.remove() },
  }
}

it('waits for only the reached real Host generation, advances late Web fragments and preserves pan; hidden Sources stay unmounted', async () => {
  const h = await fixture()
  try {
    expect(h.mounts).toEqual([])
    const initial = h.navigation.initializeSpatialPlayback()
    await vi.waitFor(() => expect(h.mounts).toEqual(['first']))
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 2 })
    h.gates.get('first')!.resolve(); expect(await initial).toBe(true)
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 4 })
    expect(h.world.getState(componentFragmentStateKey('first'))).toBe(0)
    h.camera.set({ x: 88, y: 99, zoom: 1.5 })
    await h.navigation.execute({ type: 'step.next' }); await h.navigation.execute({ type: 'step.next' })
    expect(h.camera.read()).toEqual({ x: 88, y: 99, zoom: 1.5 })
    expect(h.world.getState(componentFragmentStateKey('first'))).toBe(2)
    const arrive = h.navigation.execute({ type: 'step.next' })
    await vi.waitFor(() => expect(h.mounts).toEqual(['first', 'last']))
    h.gates.get('last')!.resolve(); expect(await arrive).toBe(true)
    expect(h.frame()).toBe('frame-last')
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 3, stepCount: 6 })
    expect(h.world.getState(componentFragmentStateKey('last'))).toBe(0)
    await h.navigation.execute({ type: 'step.next' }); await h.navigation.execute({ type: 'step.next' })
    expect(h.world.getState(componentFragmentStateKey('last'))).toBe(2)
    expect(await h.navigation.execute({ type: 'step.next' })).toBe(true); expect(h.active()).toBe('C')
    expect(h.mounts).toEqual(['first', 'last']); expect(h.errors).toEqual([])
  } finally { await h.dispose() }
})

it('enters a previously unprepared previous surface at the final fragment, using the destination stop rather than its old numeric index', async () => {
  const h = await fixture('C')
  try {
    const previous = h.navigation.execute({ type: 'step.previous' })
    await vi.waitFor(() => expect(h.mounts).toEqual(['last']))
    h.gates.get('last')!.resolve(); expect(await previous).toBe(true)
    expect(h.active()).toBe('B'); expect(h.frame()).toBe('frame-last')
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 3, stepCount: 4 })
    expect(h.world.getState(componentFragmentStateKey('last'))).toBe(2)
    expect(h.world.getState(componentFragmentStateKey('first'))).toBeUndefined()
    expect(h.mounts).toEqual(['last'])
  } finally { await h.dispose() }
})

it('allows Next while the last current Source is pending, cancels old waits, and loses Web capability for an actual ordinary replacement', async () => {
  const h = await fixture('B', true)
  try {
    const initial = h.navigation.initializeSpatialPlayback()
    await vi.waitFor(() => expect(h.mounts).toEqual(['first']))
    expect(h.navigation.canExecute({ type: 'step.next' })).toBe(true)
    const next = h.navigation.execute({ type: 'step.next' })
    h.gates.get('first')!.resolve()
    expect(await initial).toBe(false); expect(await next).toBe(true)
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 1, stepCount: 3 })
    expect(h.contexts.get('first')!.scope.isActive()).toBe(true)
    h.intersect('first', true)
    const replacement = h.replace('first', 'ordinary')
    const prepare = h.navigation.execute({ type: 'scene.go', sceneId: 'B', targetStateId: 'frame-first' })
    await vi.waitFor(() => expect(h.mounts).toContain('ordinary'))
    h.gates.get('ordinary')!.resolve(); await replacement; expect(await prepare).toBe(true)
    expect(h.navigation.read().progress).toMatchObject({ stepIndex: 0, stepCount: 1 })
    expect(h.frame()).toBe('frame-first'); expect(h.navigation.canExecute({ type: 'step.next' })).toBe(false)
    expect(h.disposed).toContain('first')
  } finally { await h.dispose() }
})

it('a cancelled readiness wait cannot overwrite replacement navigation or stop the retained program', async () => {
  const h = await fixture('C')
  try {
    const old = h.navigation.execute({ type: 'step.previous' })
    await vi.waitFor(() => expect(h.mounts).toEqual(['last']))
    expect(await h.navigation.execute({ type: 'scene.go', sceneId: 'A' })).toBe(true)
    expect(await old).toBe(false)
    expect(h.contexts.get('last')!.scope.isActive()).toBe(true)
    h.gates.get('last')!.resolve()
    await vi.waitFor(() => expect(h.completed).toContain('last'))
    expect(h.active()).toBe('A'); expect(h.mounts).toEqual(['last']); expect(h.disposed).toEqual([])
  } finally { await h.dispose() }
})

it('keeps repeated authored frame occurrences distinct when the first visit expands into fragments', async () => {
  const h = await fixture('B', true)
  try {
    const project = h.project(), surface = componentSurfaces(project)[0]
    const next = structuredClone(project)
    setRootContainers(next, [{ ...surface, spatial: { ...surface.spatial!, defaultPathId: 'repeat', paths: [{ id: 'repeat', title: 'Return', frameIds: ['frame-first', 'frame-first'] }] } }])
    h.setProject(next)
    const initial = h.navigation.initializeSpatialPlayback(); await vi.waitFor(() => expect(h.mounts).toEqual(['first']))
    h.gates.get('first')!.resolve(); await initial
    expect(h.navigation.read().progress!.stepCount).toBe(4)
    for (let index = 1; index <= 3; index++) { expect(await h.navigation.execute({ type: 'step.next' })).toBe(true); expect(h.navigation.read().progress!.stepIndex).toBe(index) }
    expect(h.navigation.canExecute({ type: 'step.next' })).toBe(false)
    expect(await h.navigation.execute({ type: 'step.previous' })).toBe(true)
    expect(h.navigation.read().progress!.stepIndex).toBe(2)
  } finally { await h.dispose() }
})
