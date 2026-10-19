// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { ComponentWorldInteractions } from '../../src/player/components/runtime/ComponentWorldInteractions'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import { createComponentSpatialCameraPort } from '../../src/player/surfaces/spatial/componentSpatialAdapter'
import recipeSource from '../../src/core/course/courseRecipeRuntimeSource'
import type { ComponentRuntimeContext, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'
import type { InteractionRule, InteractionTrigger } from '../../src/shared/interactionTypes'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren() })
function fixture() {
  const project = createBlankCourseProjectV10('audit player')
  project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = {}
  project.surfaces = [{ id: 'A', kind: 'slide', title: 'A', childIds: [], designSize: { width: 640, height: 360 } },
    { id: 'B', kind: 'slide', title: 'B', childIds: [], designSize: { width: 640, height: 360 } }]
  return project
}
function context(project: CourseProjectV10, id = 'behavior') {
  project.definitions[id] = { id, role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  project.instances[id] = { id, definitionId: id, data: { rules: [] } }
  project.global.underlay.push(id)
  const controller = new AbortController(), cleanups: (() => void)[] = [], state = new Map<string, JsonValue>(), events = new Map<string, Set<(value: JsonValue) => void>>()
  const scope: ComponentRuntimeContext['scope'] = { runScopeId: 'audit', instanceId: id, generation: 1, signal: controller.signal, isActive: () => !controller.signal.aborted,
    cleanup: fn => { cleanups.push(fn) }, target: () => null,
    events: { emit(name, value) { for (const fn of events.get(name) ?? []) fn(value) }, subscribe(name, fn) { const listeners = events.get(name) ?? new Set(); events.set(name, listeners); listeners.add(fn); const off = () => { listeners.delete(fn) }; cleanups.push(off); return off } },
    state: { get: key => state.get(key), set: (key, value) => { state.set(key, value) }, subscribe: () => () => {} } }
  return { instance: project.instances[id], scope, state, dispose() { controller.abort(); cleanups.forEach(fn => fn()) } }
}
function rule(id: string, trigger: InteractionTrigger, key: string, value: string | number | boolean | null, delayMs = 0): InteractionRule {
  return { id, name: id, enabled: true, trigger, conditions: [], actions: [{ id: `${id}-action`, start: 'after-previous', delayMs, action: { type: 'course-state.set', key, value } }] }
}
function published(project: CourseProjectV10) { const { revision: _revision, ...payload } = project; return { ...payload, schemaVersion: 3 } }
function root() { const node = document.createElement('div'); document.body.append(node); return node }

it('CA077 snapshots all input branch conditions before the correct action clears the answer', async () => {
  const project = fixture(), h = context(project), trigger = { type: 'input.submit' as const, nodeId: 'answer' }, seen: string[] = []
  h.state.set('answer', 'correct')
  const correct = { ...rule('correct', trigger, 'answer', ''), conditions: [{ type: 'course-state.compare' as const, key: 'answer', operator: 'eq' as const, value: 'correct' }] }
  const incorrect = { ...rule('incorrect', trigger, 'feedback', 'error'), conditions: [{ type: 'course-state.compare' as const, key: 'answer', operator: 'neq' as const, value: 'correct' }] }
  h.instance.data = { rules: [correct, incorrect] } as unknown as JsonValue
  let dispatch!: () => unknown
  const mounted = await createComponentInteractionRuntime(() => ({ currentSurfaceId: () => 'A', currentStateId: () => null, courseState: h.scope.state,
    subscribeTrigger: (_trigger, fn) => { dispatch = fn; return () => {} }, report() {}, executeAction(action, info) { seen.push(info.ruleId); if (action.type === 'course-state.set') h.scope.state.set(action.key, action.value); return true } })).mount(h)
  await dispatch(); expect(seen).toEqual(['correct']); expect(h.state.get('answer')).toBe('')
  mounted.dispose(); h.dispose()
})

it('CA200 retires delayed work when presentation scope leaves, while ordinary state changes do not cancel it', async () => {
  vi.useFakeTimers()
  const project = fixture(), h = context(project), trigger = { type: 'presenter.command' as const, command: 'next' as const }
  const delayed = { ...rule('delayed', trigger, 'done', true, 20), conditions: [{ type: 'presentation.in' as const, stateIds: ['first'] }] }
  h.instance.data = { rules: [delayed] } as unknown as JsonValue
  let stateId = 'first', dispatch!: () => Promise<boolean | void> | boolean | void
  const mounted = await createComponentInteractionRuntime(() => ({ currentSurfaceId: () => 'A', currentStateId: () => stateId, courseState: h.scope.state,
    subscribeTrigger: (_trigger, fn) => { dispatch = fn as typeof dispatch; return () => {} }, report() {}, executeAction(action) { if (action.type === 'course-state.set') h.scope.state.set(action.key, action.value); return true } })).mount(h)
  const old = dispatch(); stateId = 'second'; h.scope.events.emit('__runtime.presentation', 'A'); stateId = 'first'
  await vi.advanceTimersByTimeAsync(30); expect(await old).toBe(false); expect(h.state.has('done')).toBe(false)
  const current = dispatch(); h.state.set('unrelated', false); await vi.advanceTimersByTimeAsync(30); expect(await current).toBe(true); expect(h.state.get('done')).toBe(true)
  mounted.dispose(); h.dispose()
})

it('CA200 a rule owns its intentional terminal departure and reports the actual Published navigation result', async () => {
  const project = fixture(), h = context(project)
  h.instance.data = { rules: [{ id: 'next', name: 'next', enabled: true, trigger: { type: 'presenter.command', command: 'next' }, conditions: [{ type: 'scene.in', sceneIds: ['A'] }], actions: [{ id: 'navigate', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: 'B' } }] }] }
  const messages: string[] = [], player = await mountPublishedCourseV3(published(project), root(), { keyboardNavigation: false, report: message => messages.push(message) })
  try { expect({ result: await player.runtime.dispatchPresenterCommand('next'), surface: player.navigation.read().locationId, messages }).toEqual({ result: true, surface: 'B', messages: [] }) }
  finally { await player.dispose(); h.dispose() }
})

it('CA200 an intentional presentation transition survives repeat notifications, while a subsequent external departure cancels it', async () => {
  const project = fixture(), h = context(project); let stateId = 'first', dispatch!: () => Promise<boolean>, finish!: () => void
  h.instance.data = { rules: [{ id: 'fade', name: 'fade', enabled: true, trigger: { type: 'presenter.command', command: 'next' }, conditions: [{ type: 'presentation.in', stateIds: ['first'] }], actions: [{ id: 'transition', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'second', transition: { duration: 10 } } }] }] }
  const mounted = await createComponentInteractionRuntime(() => ({ currentSurfaceId: () => 'A', currentStateId: () => stateId, courseState: h.scope.state,
    subscribeTrigger: (_trigger, fn) => { dispatch = fn as typeof dispatch; return () => {} }, report() {}, executeAction(_action, info) {
      stateId = 'second'; h.scope.events.emit('__runtime.presentation', 'A')
      return new Promise<boolean>(resolve => { finish = () => resolve(!info.signal.aborted) })
    } })).mount(h)
  try {
    const own = dispatch(); h.scope.events.emit('__runtime.presentation', 'A'); finish(); expect(await own).toBe(true)
    stateId = 'first'; const obsolete = dispatch(); stateId = 'third'; h.scope.events.emit('__runtime.presentation', 'A'); finish(); expect(await obsolete).toBe(false)
  } finally { mounted.dispose(); h.dispose() }
})

it('CA079 keys presentation entry by surface and state; CA137 dispatches crossed video thresholds in chronological order', async () => {
  const project = fixture(), h = context(project)
  project.instances.video = { id: 'video', definitionId: 'video', data: {} }; project.definitions.video = { id: 'video', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }; project.global.overlay.push('video')
  let surfaceId = 'A'; const nav = new ComponentNavigationOwner({ project: () => project, surfaceId: () => surfaceId, stateId: () => 'shared', select: id => { surfaceId = id } })
  const world = new ComponentWorldInteractions({ project: () => project, element: () => undefined, document: () => document, audio: () => undefined, active: () => true, playback: () => true, report() {}, navigation: nav })
  const ports = world.ports(h), entries: string[] = [], thresholds: number[] = []
  const off = ports.subscribeTrigger({ type: 'presentation.enter', stateId: 'shared' }, () => { entries.push(surfaceId) })
  await Promise.resolve(); surfaceId = 'B'; nav.changed(); expect(entries).toEqual(['A', 'B'])
  const late = ports.subscribeTrigger({ type: 'video.time', nodeId: 'video', seconds: 8 }, () => { thresholds.push(8) })
  const early = ports.subscribeTrigger({ type: 'video.time', nodeId: 'video', seconds: 3 }, () => { thresholds.push(3) })
  h.scope.events.emit('video.time', { instanceId: 'video', seconds: 10 }); expect(thresholds).toEqual([3, 8])
  h.scope.events.emit('video.time', { instanceId: 'video', seconds: 0 }); h.scope.events.emit('video.time', { instanceId: 'video', seconds: 10 }); expect(thresholds).toEqual([3, 8, 3, 8])
  off(); late(); early(); world.dispose(); nav.dispose(); h.dispose()
})

it('CA025 traverses current surface descendants and counts the effective loaded Web runtime; CA186 camera capture changes no fragment state', () => {
  let project = fixture()
  project.surfaces[0] = { ...project.surfaces[0], kind: 'spatial', childIds: ['group'], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'frame', title: 'one', targetInstanceId: 'web', pose: { x: 0, y: 0, zoom: 1 } }] } }
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['web'] }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p class="fragment">one</p><p class="fragment">two</p>' }, implementationOverride: { kind: 'builtin', key: 'guoling.web' }, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  const state = new Map<string, number>(), nav = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'A', select() {}, courseState: { get: key => state.get(key) as never, set: (key, value) => { state.set(key, value) } } })
  let loadedWeb = true
  const runtime = { read: (id: string) => id === 'web' && loadedWeb ? { status: 'ready' as const, generation: 1, document: 'web' as const, html: (project.instances.web.data as { html: string }).html } : { status: 'ready' as const }, prepare: async () => true }
  nav.connectRuntime(runtime)
  expect(nav.read().progress?.stepCount).toBe(3)
  loadedWeb = false
  project = { ...project, instances: { ...project.instances, web: { ...project.instances.web, implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } } } }
  expect(nav.read().progress?.stepCount).toBe(1)
  project = { ...project, instances: { ...project.instances, web: { ...project.instances.web, implementationOverride: { kind: 'builtin', key: 'guoling.web' } } } }
  loadedWeb = true; state.clear()
  const capture = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'A', select() {}, capture: true, courseState: { get: key => state.get(key) as never, set: (key, value) => { state.set(key, value) } } })
  capture.connectRuntime(runtime)
  const camera = createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 }); capture.registerCamera('A', camera); camera.set({ x: 4, y: 5, zoom: 2 }); expect(state.size).toBe(0)
  camera.dispose(); nav.dispose(); capture.dispose()
})

it('CA289 allows same-surface state changes while preserving cross-surface guards; CA111 forwards rule abort to the navigation owner', async () => {
  const project = fixture(), h = context(project)
  project.surfaces[0].presentation = { initialStateId: 'first', states: [{ id: 'first', title: 'first', overrides: {} }, { id: 'second', title: 'second', overrides: {} }] }
  project.logic = { courseState: [], navigationGuards: [{ id: 'guard', toSurfaceIds: ['A', 'B'], effect: 'block', match: 'all', conditions: [{ type: 'compare', key: 'blocked', operator: 'eq', value: true }], message: 'blocked' }] }
  let stateId: string | null = 'first', received!: AbortSignal
  const nav = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'A', stateId: () => stateId, select() {}, courseState: { get: () => true as never }, selectState(id, _surface, signal) { received = signal!; if (id === 'second') { stateId = id; return true }; return new Promise(resolve => { signal?.addEventListener('abort', () => resolve(false), { once: true }) }) } })
  expect(await nav.execute({ type: 'scene.go', sceneId: 'A', targetStateId: 'second' })).toBe(true)
  expect(await nav.execute({ type: 'scene.go', sceneId: 'B' })).toBe(false)
  const world = new ComponentWorldInteractions({ project: () => project, element: () => undefined, audio: () => undefined, document: () => document, active: () => true, playback: () => true, report() {}, navigation: nav })
  const abort = new AbortController(), pending = world.ports(h).executeAction({ type: 'presentation.set', stateId: 'first' }, { signal: abort.signal, ruleId: 'rule', stepId: 'step', restartFromBeginning: false })
  await Promise.resolve(); abort.abort(); expect(received.aborted).toBe(true); expect(await pending).toBe(false); expect(stateId).toBe('second')
  world.dispose(); nav.dispose(); h.dispose()
})

it('CA088 reveal starts the target presentation and CA087 restarts at the first surface before rebuilding entry subscriptions', async () => {
  const project = fixture()
  project.surfaces[0].presentation = { initialStateId: 'a-on', states: [{ id: 'a-on', title: 'a', overrides: {} }] }
  project.surfaces[1].presentation = { initialStateId: 'b-on', states: [{ id: 'b-on', title: 'b', overrides: {} }] }
  project.logic = { courseState: [{ key: 'visitedB', valueType: 'boolean', defaultValue: false }], navigationGuards: [] }
  const h = context(project, 'B-entry'); project.global.underlay = []; project.surfaces[1].childIds.push('B-entry')
  h.instance.attachments = [{ instanceId: 'B-entry', target: { kind: 'surface', surfaceId: 'B' } }]
  h.instance.data = { rules: [rule('enterB', { type: 'scene.enter' }, 'visitedB', true)] } as unknown as JsonValue
  const player = await mountPublishedCourseV3(published(project), root(), { keyboardNavigation: false })
  try {
    expect(player.revealSurface('B')).toBe(true); await player.ready
    expect(player.navigation.currentStateId()).toBe('b-on'); expect(player.runtime.getState('visitedB')).toBe(true)
    expect(await player.navigation.execute({ type: 'course.restart' })).toBe(true); await player.ready
    expect(player.navigation.read().locationId).toBe('A'); expect(player.runtime.getState('visitedB')).toBe(false)
  } finally { await player.dispose(); h.dispose() }
})

it('CA130 a healthy target capture ignores a failed or pending sibling asset, while full surface capture still waits and reports it', async () => {
  const project = fixture(); project.surfaces.pop(); project.assets.other = { id: 'other', path: 'assets/other', mimeType: 'image/png' }
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } }
  project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  project.instances.text = { id: 'text', definitionId: 'text', data: { type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Healthy' }] } } }
  project.instances.image = { id: 'image', definitionId: 'image', data: { originalAssetId: 'other', assetId: 'other', alt: '', fit: 'contain' } }
  project.surfaces[0].childIds = ['text', 'image']
  const payload = { ...published(project), assets: { other: { id: 'other', mimeType: 'image/png', url: 'https://assets.example/other.png' } } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
  const host = root(), player = await mountPublishedCourseV3(payload, host, { capture: true, keyboardNavigation: false })
  try { await player.ready; await player.waitForCaptureReady(player.runtime.contentElement('text')!); await expect(player.waitForCaptureReady()).rejects.toThrow('other') }
  finally { await player.dispose() }
})

it('CA181 reveal recipes keep progress by instance, reset it consistently, and only the owning surface consumes entry', async () => {
  const project = fixture(), a = context(project, 'recipeA'), b = context(project, 'recipeB')
  project.global.underlay = []; project.surfaces[0].childIds.push('recipeA'); project.surfaces[1].childIds.push('recipeB')
  project.definitions.recipeA.role = project.definitions.recipeB.role = 'content'
  a.instance.data = { mode: 'reveal', initialStep: 0, steps: ['one', 'two'], items: [] }; b.instance.data = { mode: 'reveal', initialStep: 2, steps: ['one', 'two'], items: [] }
  let surfaceId = 'A'; const nav = new ComponentNavigationOwner({ project: () => project, surfaceId: () => surfaceId, select() {} })
  const world = new ComponentWorldInteractions({ project: () => project, element: () => undefined, audio: () => undefined, document: () => document, active: () => true, playback: () => true, report() {}, navigation: nav })
  const source = new Function(recipeSource.replace('export default', 'return'))() as { mount(context: unknown): { dispose(): void } }
  const shared = new Map<string, JsonValue>()
  a.scope.state = b.scope.state = { get: key => shared.get(key), set: (key, value) => { shared.set(key, value) }, subscribe: () => () => {} }
  const aRoot = root(), bRoot = root(), mountedA = source.mount({ ...a, root: aRoot, interactions: world.ports(a) }), mountedB = source.mount({ ...b, root: bRoot, interactions: world.ports(b) })
  try {
    await Promise.resolve(); aRoot.querySelector<HTMLButtonElement>('button')!.click()
    expect(shared.get('component:recipeA:progress')).toBe(1); expect(shared.get('component:recipeB:progress')).toBe(2); expect(shared.has('progress')).toBe(false)
    surfaceId = 'A'; nav.changed(); expect(shared.get('component:recipeA:progress')).toBe(1)
    aRoot.querySelectorAll<HTMLButtonElement>('button')[1].click(); expect(shared.get('component:recipeA:progress')).toBe(0)
    surfaceId = 'B'; nav.changed(); expect(shared.get('component:recipeA:progress')).toBe(0); expect(shared.get('component:recipeB:progress')).toBe(2)
  } finally { mountedA.dispose(); mountedB.dispose(); a.dispose(); b.dispose(); world.dispose(); nav.dispose() }
})

it('CA074 Published consumes a selected formal path and CA076 navigation rebases the existing stable frame after structural edits', async () => {
  let project = fixture()
  const frame = (id: string, x: number) => ({ id, title: id, pose: { x, y: 0, zoom: 1 } })
  project.surfaces[0] = { ...project.surfaces[0], kind: 'spatial', spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [frame('one', 1), frame('two', 2), frame('three', 3)], defaultPathId: 'reverse', paths: [{ id: 'reverse', title: 'reverse', frameIds: ['two', 'one'] }] } }
  const player = await mountPublishedCourseV3(published(project), root(), { keyboardNavigation: false })
  try { expect(player.camera('A')!.read().x).toBe(2); expect(await player.next()).toBe(true); expect(player.camera('A')!.read().x).toBe(1); expect(player.selectSpatialPath(null)).toBe(true); expect(await player.next()).toBe(true); expect(player.camera('A')!.read().x).toBe(1) }
  finally { await player.dispose() }
  project = { ...project, surfaces: [{ ...project.surfaces[0], spatial: { ...project.surfaces[0].spatial!, paths: [] } }, project.surfaces[1]] }
  let frameId: string | null = null, index: number | null = null
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'A', select() {} }), camera = createComponentSpatialCameraPort({ x: 0, y: 0, zoom: 1 })
  owner.registerCamera('A', camera, { frameId: () => frameId, selectFrame: value => { frameId = value }, stepIndex: () => index, selectStep: value => { index = value } })
  try {
    await owner.execute({ type: 'step.next' }); await owner.execute({ type: 'step.next' }); expect(frameId).toBe('two'); expect(index).toBe(1)
    project = { ...project, surfaces: [{ ...project.surfaces[0], spatial: { ...project.surfaces[0].spatial!, frames: [frame('two', 2), frame('three', 3)] } }, project.surfaces[1]] }
    owner.changed(); expect(index).toBe(0); expect(await owner.execute({ type: 'step.next' })).toBe(true); expect(frameId).toBe('three')
  } finally { owner.dispose(); camera.dispose() }
})
