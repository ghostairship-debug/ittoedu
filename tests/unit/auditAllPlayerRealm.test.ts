// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { prepareCourseTeacherControllerEdits } from '../../src/core/course/courseElementInsertion'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentWorldInteractions } from '../../src/player/components/runtime/ComponentWorldInteractions'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { createImageRuntimeImplementation } from '../../src/components/image/runtime'
import { createImageData } from '../../src/components/image/data'
import { createVideoRuntimeImplementation } from '../../src/components/media/runtime'
import { createVideoData } from '../../src/components/media/data'
import { popoverRuntimeImplementation } from '../../src/components/popover'
import { componentInteractionView, readComponentInteractionSounds } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { courseSoundReference } from '../../src/core/course/courseAuthoringReferences'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation, JsonValue, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { PreparedComponentRuntime } from '../../src/player/components/runtime/ComponentRuntimeHost'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })
function root() { const node = document.createElement('div'); document.body.append(node); return node }
function project() {
  const value = createBlankCourseProjectV10(); value.global = { underlay: [], overlay: [] }; value.instances = {}; value.definitions = {}
  value.surfaces = [{ id: 'A', kind: 'slide', title: 'A', childIds: [] }, { id: 'B', kind: 'slide', title: 'B', childIds: [] }]; return value
}
function scope(id = 'component') {
  const events = new Map<string, Set<(value: JsonValue) => void>>(), abort = new AbortController(), cleanups: (() => void)[] = []
  const current: ComponentRuntimeContext['scope'] = { instanceId: id, runScopeId: 'audit', generation: 1, signal: abort.signal, isActive: () => !abort.signal.aborted,
    cleanup: fn => { cleanups.push(fn) }, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} },
    events: { emit(name, value) { for (const fn of events.get(name) ?? []) fn(value) }, subscribe(name, fn) { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(fn); return () => { set.delete(fn) } } } }
  return { scope: current, dispose() { abort.abort(); cleanups.forEach(fn => fn()) } }
}
const source = { kind: 'source' as const, language: 'javascript' as const, source: 'export default {}' }

it('CA043 injects student navigation into ordinary source and forced navigation only into the canonical global teacher', async () => {
  const blank = createBlankCourseProjectV10()
  const value = applyComponentOperation(blank, captureComponentOperation(blank, prepareCourseTeacherControllerEdits(blank, blank.surfaces[0].id, 'slide-authoring').edits))
  value.surfaces[0].id = 'A'; value.surfaces.push({ id: 'B', kind: 'slide', title: 'B', childIds: [] })
  value.logic = { courseState: [], navigationGuards: [{ id: 'guard', toSurfaceIds: ['B'], effect: 'block', match: 'all', conditions: [{ type: 'compare', key: 'blocked', operator: 'eq', value: true }], message: 'blocked' }] }
  const teacherId = value.global.overlay[0]; value.instances[teacherId].implementationOverride = source
  value.definitions.source = { id: 'source', role: 'content', implementation: source }; value.instances.ordinary = { id: 'ordinary', definitionId: 'source', data: {} }; value.surfaces[0].childIds.push('ordinary')
  let surface = 'A'; const navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => surface, select: id => { surface = id }, courseState: { get: () => true as never } })
  const contexts = new Map<string, ComponentRuntimeContext>(), prepared: PreparedComponentRuntime = { implementation: { mount(context) { contexts.set(context.instance.id, context); return { update() {}, dispose() {} } } } }
  const runtime = new ComponentPlatformRuntime('ports', { teacherController: navigation.teacherPort(), studentNavigation: navigation, resolveSource: async () => prepared })
  for (const id of [teacherId, 'ordinary']) { const element = root(); runtime.bind(id, element); runtime.bindTarget(id, element) }
  try { await runtime.sync(value, { assets: {}, components: {} }); expect(await contexts.get('ordinary')!.teacherController!.execute({ type: 'scene.go', sceneId: 'B' })).toBe(false); expect(await contexts.get(teacherId)!.teacherController!.execute({ type: 'scene.go', sceneId: 'B' })).toBe(true) }
  finally { await runtime.dispose(); navigation.dispose() }
})

it('CA233 an editor source override of feedback retains its document subscriptions on an inactive surface', async () => {
  const value = project(); value.definitions.feedback = { id: 'feedback', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.feedback' } }
  value.instances.overridden = { id: 'overridden', definitionId: 'feedback', data: {}, implementationOverride: source }; value.surfaces[1].childIds.push('overridden')
  const mount = vi.fn(() => ({ update() {}, dispose() {} })), navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'A', select() {} })
  const runtime = new ComponentPlatformRuntime('override', { mode: 'edit', teacherController: navigation.teacherPort(), studentNavigation: navigation, resolveSource: async () => ({ implementation: { mount } }) })
  try { await runtime.sync(value, { assets: {}, components: {} }); expect(mount).toHaveBeenCalledOnce() }
  finally { await runtime.dispose(); navigation.dispose() }
})

it('CA045 publishes current target facts for B updates/deletion without updating or remounting unchanged source A', async () => {
  let value = project(); value.definitions.source = { id: 'source', role: 'content', implementation: source }; value.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  value.instances['A-source'] = { id: 'A-source', definitionId: 'source', data: {} }; value.instances.B = { id: 'B', definitionId: 'group', data: { text: 'before' } }; value.surfaces[0].childIds.push('A-source', 'B')
  const updates = vi.fn(), mounted = vi.fn(), received: JsonValue[] = []
  const implementation: ComponentRuntimeImplementation = { mount(context) { mounted(); context.scope.events.subscribe('__runtime.targets', value => received.push(value)); return { update: updates, dispose() {} } } }
  const runtime = new ComponentPlatformRuntime('facts', { resolveSource: async () => ({ implementation, artifactIdentity: 'same' }) }); const element = root(); runtime.bind('A-source', element)
  try {
    await runtime.sync(value, { assets: {}, components: {} }); value = { ...value, instances: { ...value.instances, B: { ...value.instances.B, data: { text: 'after' } } } }; await runtime.sync(value, { assets: {}, components: {} })
    expect(received.at(-1)).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: 'B', value: { text: 'after' } })])); expect(mounted).toHaveBeenCalledOnce(); expect(updates).not.toHaveBeenCalled()
    value = { ...value, instances: { 'A-source': value.instances['A-source'] }, surfaces: [{ ...value.surfaces[0], childIds: ['A-source'] }, value.surfaces[1]] }; await runtime.sync(value, { assets: {}, components: {} })
    expect((received.at(-1) as Array<{ instanceId: string; reference: { kind: string } }>).some(value => value.reference.kind === 'instance' && value.instanceId === 'B')).toBe(false); expect(mounted).toHaveBeenCalledOnce()
  } finally { await runtime.dispose() }
})

it('CA152 retires only a changed resource origin environment and preserves generation on same-origin URL edits', async () => {
  let value = project(); value.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  value.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p>web</p>', css: 'body{background:red}', resourceSources: [{ url: 'https://old.example/a.png', usage: 'image' }] } }; value.surfaces[0].childIds.push('web')
  const mounts = vi.fn(), dispose = vi.fn(), update = vi.fn(), runtime = new ComponentPlatformRuntime('origin', { resolveBuiltin: async () => ({ artifactIdentity: 'same', implementation: { mount() { mounts(); return { update, dispose } } } }) })
  runtime.bind('web', root())
  const change = (url: string) => { value = { ...value, instances: { ...value.instances, web: { ...value.instances.web, data: { html: '<p>web</p>', css: 'body{background:red}', resourceSources: [{ url, usage: 'image' }] } } } } }
  try {
    await runtime.sync(value, { assets: {}, components: {} }); change('https://old.example/b.png'); await runtime.sync(value, { assets: {}, components: {} }); expect(mounts).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1)
    change('https://new.example/b.png'); await runtime.sync(value, { assets: {}, components: {} }); expect(mounts).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledTimes(1)
  } finally { await runtime.dispose() }
})

it('CA140 professional image/media implementations consume resource notifications without needing a host data update', async () => {
  const h = scope('image'); let url = 'old'; const imageRoot = root(), image = await createImageRuntimeImplementation(() => ({ url })).mount({ instance: { id: 'image', definitionId: 'image', data: createImageData('asset') }, root: imageRoot, scope: h.scope })
  try { expect(imageRoot.querySelector('img')!.getAttribute('src')).toBe('old'); url = 'new'; h.scope.events.emit('__runtime.resources', {}); expect(imageRoot.querySelector('img')!.getAttribute('src')).toBe('new') }
  finally { image.dispose(); h.dispose() }
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const v = scope('video'), videoRoot = root(), video = await createVideoRuntimeImplementation({ resolveAssetUrl: () => url }).mount({ instance: { id: 'video', definitionId: 'video', data: createVideoData('asset') }, root: videoRoot, scope: v.scope })
  try { expect(videoRoot.querySelector('video')!.getAttribute('src')).toBe('new'); url = 'latest'; v.scope.events.emit('__runtime.resources', {}); expect(videoRoot.querySelector('video')!.getAttribute('src')).toBe('latest') }
  finally { video.dispose(); v.dispose() }
})

it('CA204 nested runtime events use canonical global/current-surface ownership; CA275 stopped native control clicks fire once', async () => {
  const value = project(), h = scope('popover'); value.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  for (const id of ['global', 'nested', 'A-node', 'B-node', 'popover']) value.instances[id] = { id, definitionId: 'group', data: {} }
  value.instances.global.childIds = ['nested']; value.global.overlay.push('global'); value.surfaces[0].childIds.push('A-node', 'popover'); value.surfaces[1].childIds.push('B-node')
  let surface = 'A'; const nodes = new Map([['popover', root()]]), navigation = new ComponentNavigationOwner({ project: () => value, surfaceId: () => surface, select() {} }), world = new ComponentWorldInteractions({ project: () => value, element: id => nodes.get(id), document: () => document, audio: () => undefined, navigation, active: () => true, playback: () => true, report() {} })
  const ports = world.ports({ instance: value.instances.popover, scope: h.scope }), global = vi.fn(), scene = vi.fn(), click = vi.fn()
  const stops = [ports.subscribeTrigger({ type: 'runtime.event', scope: 'global', eventName: 'done' }, global), ports.subscribeTrigger({ type: 'runtime.event', scope: 'scene', eventName: 'done' }, scene), ports.subscribeTrigger({ type: 'node.click', nodeId: 'popover' }, click)]
  for (const id of ['nested', 'A-node', 'B-node']) h.scope.events.emit('__component.event', { instanceId: id, name: 'done', value: true })
  expect(global).toHaveBeenCalledOnce(); expect(scene).toHaveBeenCalledOnce(); expect(scene).toHaveBeenCalledWith(true)
  const popover = await popoverRuntimeImplementation.mount({ instance: { id: 'popover', definitionId: 'popover', data: { label: 'open', content: 'content' } }, root: nodes.get('popover'), scope: h.scope })
  try { nodes.get('popover')!.querySelector<HTMLButtonElement>('button')!.click(); expect(click).toHaveBeenCalledOnce(); surface = 'B'; for (const id of ['A-node', 'B-node']) h.scope.events.emit('__component.event', { instanceId: id, name: 'done', value: true }); expect(scene).toHaveBeenCalledTimes(2) }
  finally { popover.dispose(); stops.forEach(stop => stop()); world.dispose(); navigation.dispose(); h.dispose() }
})

it('CA199 one stable activation is emitted after a node becomes visible; CA287 native audio identity is available to the current UI and reference resolver', async () => {
  const value = project(), activated: string[] = [], element = root()
  value.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }; value.instances.node = { id: 'node', definitionId: 'group', data: {}, playbackInitialVisibility: 'hidden' }; value.surfaces[0].childIds.push('node')
  const nav = new ComponentNavigationOwner({ project: () => value, surfaceId: () => 'A', select() {} }), world = new ComponentWorldInteractions({ project: () => value, element: id => id === 'node' ? element : undefined, document: () => document, audio: () => undefined, navigation: nav, active: () => true, playback: () => true, report() {}, activated: id => activated.push(id) })
  try { world.applyAllVisibility(); expect(activated).toEqual([]); const visibility = world.presentationPort('node').visibility(true); expect(activated).toEqual(['node']); world.applyAllVisibility(); expect(activated).toEqual(['node']); await visibility.setVisible(false); await visibility.setVisible(true); expect(activated).toEqual(['node', 'node']); visibility.dispose() }
  finally { world.dispose(); nav.dispose() }
  value.definitions.audio = { id: 'audio', role: 'content', implementation: { kind: 'builtin', key: 'guoling.audio' } }; value.instances.audio = { id: 'audio', definitionId: 'audio', name: 'Native audio', data: { assetId: 'asset', channel: 'narration', volume: .8, loop: false } }; value.surfaces[0].childIds.push('audio')
  expect(componentInteractionView(value, 'A').sounds.audio.name).toBe('Native audio'); expect(componentInteractionView(value, 'B').sounds.audio).toBeUndefined()
  expect(readComponentInteractionSounds({ project: value, surfaceId: 'A' } as never)).toContainEqual({ id: 'audio', name: 'Native audio' })
  expect(courseSoundReference(value, 'token', new Map([['token', { kind: 'sound', soundId: 'audio' }]]))).toBe('audio'); expect(value.media).toBeUndefined()
})

it('CA022 actual Published navigation reuses immutable bytes; replacing bytes or MIME refreshes the live image URL', async () => {
  const value = project(), bytes = new Uint8Array(1024 * 1024)
  value.assets.asset = { id: 'asset', path: 'assets/asset', mimeType: 'image/png' }
  value.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  value.instances.image = { id: 'image', definitionId: 'image', data: createImageData('asset'), frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } }; value.surfaces[0].childIds.push('image')
  const copy = vi.spyOn(Uint8Array, 'from'), revoke = vi.spyOn(URL, 'revokeObjectURL'), { revision: _revision, ...payload } = value
  const player = await mountPublishedCourseV3({ ...payload, schemaVersion: 3, assets: { asset: { id: 'asset', url: 'asset.png', mimeType: 'image/png' } } }, root(), { preparedAssetBytes: { asset: bytes }, keyboardNavigation: false })
  try {
    const original = player.runtime.contentElement('image')!.querySelector('img')!.getAttribute('src')
    for (let index = 0; index < 3; index++) { await player.go('B'); await player.go('A') }
    expect(copy.mock.calls.filter(args => args[0] === bytes)).toHaveLength(1)
    expect(player.runtime.assetUrl('asset')).toBe(original); expect(revoke).not.toHaveBeenCalled()
    const replacement = new Uint8Array([1, 2, 3])
    await player.runtime.sync(value, { assets: { asset: replacement }, components: {} })
    const changed = player.runtime.assetUrl('asset'); expect(changed).not.toBe(original)
    expect(player.runtime.contentElement('image')!.querySelector('img')!.getAttribute('src')).toBe(changed)
    expect(copy.mock.calls.filter(args => args[0] === replacement)).toHaveLength(1); expect(revoke).toHaveBeenCalledWith(original)
    await player.runtime.sync({ ...value, assets: { asset: { ...value.assets.asset, mimeType: 'image/jpeg' } } }, { assets: { asset: replacement }, components: {} })
    expect(player.runtime.assetUrl('asset')).not.toBe(changed); expect(copy.mock.calls.filter(args => args[0] === replacement)).toHaveLength(2)
  } finally { await player.dispose() }
})
