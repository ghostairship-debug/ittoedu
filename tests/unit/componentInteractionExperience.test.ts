// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentWorldInteractions } from '../../src/player/components/runtime/ComponentWorldInteractions'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { componentClickInteractionEdits, componentRevealSequenceEdits, componentRuleEdits, interactionBehavior, interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { buildInteractionTemplateRule, SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID } from '../../src/renderer/interactions/interactionTemplates'
import { createVideoData } from '../../src/components/media/data'
import type { ComponentRuntimeContext, JsonValue, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { InteractionRule, InteractionTrigger } from '../../src/shared/interactionTypes'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
function fixture() {
  const project = createBlankCourseProjectV10('互动普通旅程'), surface = project.surfaces[0]
  project.media = { audio: { defaultMuted: false, masterVolume: 1,
    channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, narrationDucking: { enabled: false, musicVolume: .3, fadeMs: 0 },
    sounds: { ding: { id: 'ding', name: '提示', assetId: 'sound', channel: 'sfx', defaultVolume: 1, defaultLoop: false },
      ding2: { id: 'ding2', name: '提示2', assetId: 'sound', channel: 'sfx', defaultVolume: 1, defaultLoop: false } } } }
  project.definitions.content = { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.item = { id: 'item', definitionId: 'content', data: {} }; surface.childIds.push('item')
  return { project, surface, target: { kind: 'surface' as const, surfaceId: surface.id } }
}
function apply(project: CourseProjectV10, edits: Parameters<typeof captureComponentOperation>[1]) {
  const result = new CourseV10Driver().apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, edits))
  if (result.kind !== 'course-v10') throw new Error('Expected V10')
  return result.project
}
function rule(id: string, trigger: InteractionTrigger, delayMs = 0): InteractionRule {
  return { id, name: id, enabled: true, trigger, conditions: [],
    actions: [{ id: `${id}-action`, start: 'after-previous', delayMs, action: { type: 'course-state.set', key: id, value: true } }] }
}
function interactionHarness(rules: InteractionRule[] = []) {
  const base = fixture(), project = apply(base.project, componentRuleEdits(base.project, base.target, rules))
  const instance = interactionBehavior(project, base.target)!, events = new Map<string, Set<(value: JsonValue) => void>>()
  const cleanups: (() => void)[] = [], state = new Map<string, JsonValue>(), changed = new Set<() => void>()
  let playing = true, active = true, surfaceId = base.surface.id
  const signal = new AbortController(), execute = vi.fn(async () => false)
  const scope: ComponentRuntimeContext['scope'] = { runScopeId: 'experience', instanceId: instance.id, generation: 1,
    signal: signal.signal, isActive: () => active, cleanup: dispose => { cleanups.push(dispose) }, target: () => null,
    events: { emit: (name, value) => { for (const listener of events.get(name) ?? []) listener(value) }, subscribe: (name, listener) => {
      const listeners = events.get(name) ?? new Set(); events.set(name, listeners); listeners.add(listener)
      const off = () => { listeners.delete(listener) }; cleanups.push(off); return off
    } }, state: { get: key => state.get(key), set: (key, value) => { state.set(key, value) }, subscribe: () => () => {} } }
  const interactions = new ComponentWorldInteractions({ project: () => project, element: () => undefined, document: () => document,
    audio: () => undefined, active: () => playing, playback: () => true, report() {}, navigation: {
      read: () => ({ locationId: surfaceId, scenes: [], progress: null, zoom: 1, muted: false, fullscreen: false }),
      subscribe: listener => { changed.add(listener); return () => { changed.delete(listener) } }, canExecute: () => true, execute,
      setCollapsed() {}, moveBy() {}, setZoom() {}, resetView() {},
    } })
  const context = { instance, scope }, ports = interactions.ports(context)
  return { context, interactions, ports, state, execute, surfaceId: base.surface.id,
    setPlaying(value: boolean) { playing = value; if (value) scope.events.emit('__runtime.playing', true) },
    navigate(id: string) { surfaceId = id; for (const notify of changed) notify() },
    dispose() { active = false; signal.abort(); for (const cleanup of cleanups) cleanup(); interactions.dispose() } }
}

it('initializes each enter subscription once on resume, while paused mounts and paused location changes still initialize', async () => {
  const h = interactionHarness(), enter = vi.fn(), off = h.ports.subscribeTrigger({ type: 'scene.enter' }, enter)
  try {
    await Promise.resolve(); expect(enter).toHaveBeenCalledTimes(1)
    h.setPlaying(false); h.setPlaying(true); expect(enter).toHaveBeenCalledTimes(1)
    h.setPlaying(false)
    const later = vi.fn(), stopLater = h.ports.subscribeTrigger({ type: 'scene.enter' }, later)
    await Promise.resolve(); expect(later).not.toHaveBeenCalled()
    h.setPlaying(true); expect(enter).toHaveBeenCalledTimes(1); expect(later).toHaveBeenCalledTimes(1)
    h.setPlaying(false); h.navigate('other'); h.setPlaying(true)
    expect(enter).toHaveBeenCalledTimes(2); expect(later).toHaveBeenCalledTimes(2)
    h.navigate(h.surfaceId)
    h.setPlaying(false); h.context.scope.events.emit('__runtime.scene.replay', h.surfaceId)
    expect(enter).toHaveBeenCalledTimes(4)
    h.setPlaying(true); expect(enter).toHaveBeenCalledTimes(4)
    stopLater()
  } finally { off(); h.dispose() }
})

it('returns actual presenter rule outcomes for conditions, rejected navigation, successful terminal actions, cancellation and scope cleanup', async () => {
  const next = { type: 'presenter.command' as const, command: 'next' as const }, initial = rule('presenter', next)
  const h = interactionHarness([{ ...initial, conditions: [{ type: 'scene.in', sceneIds: ['other'] }] }])
  const mounted = await createComponentInteractionRuntime(() => h.ports).mount(h.context)
  const update = async (changed: InteractionRule) => mounted.update({ ...h.context.instance, data: { rules: [changed] } as unknown as JsonValue })
  try {
    expect(await h.interactions.dispatchPresenterCommand('next')).toBe(false)
    const navigationRule = { ...initial, actions: [{ ...initial.actions[0], action: { type: 'location.go' as const, locationId: h.surfaceId } }] }
    await update(navigationRule)
    expect(await h.interactions.dispatchPresenterCommand('next')).toBe(false)
    let complete!: (value: boolean) => void
    h.execute.mockImplementationOnce(() => new Promise<boolean>(resolve => { complete = resolve }))
    const accepted = h.interactions.dispatchPresenterCommand('next')
    expect(h.execute).toHaveBeenCalledTimes(2)
    complete(true); expect(await accepted).toBe(true)
    expect(h.state.has('presenter')).toBe(false)
    await update(rule('delayed-presenter', next, 30))
    const cancelled = h.interactions.dispatchPresenterCommand('next')
    h.context.scope.events.emit('__runtime.scene.reset', h.surfaceId)
    expect(await cancelled).toBe(false); expect(h.state.has('delayed-presenter')).toBe(false)
    await update(initial)
    expect(await h.interactions.dispatchPresenterCommand('next')).toBe(true)
    expect(h.state.get('presenter')).toBe(true)
    await mounted.dispose()
    expect(await h.interactions.dispatchPresenterCommand('next')).toBe(false)
    const source = vi.fn(), stopSource = h.ports.subscribeTrigger(next, source)
    expect(await h.interactions.dispatchPresenterCommand('next')).toBe(true); expect(source).toHaveBeenCalledOnce()
    stopSource(); expect(await h.interactions.dispatchPresenterCommand('next')).toBe(false)
  } finally { await mounted.dispose(); h.dispose() }
})

it('consumes actual AudioManager ended and video DOM timeupdate once per threshold, rearming after rewind and retiring subscriptions', async () => {
  const base = fixture()
  base.project.definitions.video = { id: 'video', role: 'content', implementation: { kind: 'builtin', key: 'guoling.video' } }
  base.project.instances.video = { id: 'video', definitionId: 'video', data: createVideoData('movie') as unknown as CourseProjectV10['instances'][string]['data'] }
  base.surface.childIds.push('video')
  const project = apply(base.project, componentRuleEdits(base.project, base.target, [
    rule('ended', { type: 'audio.ended', soundId: 'ding' }), rule('threshold', { type: 'video.time', nodeId: 'video', seconds: 10 }),
    rule('delayed', { type: 'node.click', nodeId: 'item' }, 30),
  ]))
  let audio: HTMLAudioElement | undefined
  vi.stubGlobal('Audio', function () { audio = document.createElement('audio'); return audio })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => base.surface.id, select() {} })
  const world = new ComponentPlatformRuntime('interaction-experience', { teacherController: navigation, resolveAssetUrl: id => `data:application/octet-stream,${id}` })
  const writes = vi.spyOn(world, 'setState'), videoRoot = document.createElement('div'), itemRoot = document.createElement('div')
  document.body.append(videoRoot, itemRoot); world.bind('video', videoRoot); world.bind('item', itemRoot)
  world.bindTarget('video', videoRoot); world.bindTarget('item', itemRoot)
  try {
    await world.sync(project, { assets: {}, components: {} })
    expect(world.audio()!.play('ding')).toBe(true)
    audio!.dispatchEvent(new Event('ended'))
    await Promise.resolve()
    expect(world.getState('ended')).toBe(true)
    const video = videoRoot.querySelector('video')!
    const tick = (seconds: number) => { video.currentTime = seconds; video.dispatchEvent(new Event('timeupdate')) }
    for (const seconds of [9.8, 10.2, 10.8, 12]) tick(seconds)
    expect(writes.mock.calls.filter(([name]) => name === 'threshold')).toHaveLength(1)
    tick(3); tick(10.1)
    expect(writes.mock.calls.filter(([name]) => name === 'threshold')).toHaveLength(2)
    itemRoot.click()
    expect(await navigation.execute({ type: 'scene.replay' })).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 45))
    expect(world.getState('delayed')).toBeUndefined()
    tick(10.5)
    expect(writes.mock.calls.filter(([name]) => name === 'threshold')).toHaveLength(3)
    await world.dispose(); tick(3); tick(11)
    expect(writes.mock.calls.filter(([name]) => name === 'threshold')).toHaveLength(3)
  } finally { await world.dispose(); navigation.dispose() }
})

it('keeps click action types and order, respects ancestor locks, and assembles reveal initial visibility with its ordinary rule', () => {
  const base = fixture(), target = { documentId: 'd', epoch: 'e', project: base.project, editingProject: base.project,
    resources: { assets: {}, components: {} }, surfaceId: base.surface.id, activeStateId: null, instanceId: 'item', instanceIds: ['item'] }
  let project = apply(base.project, componentClickInteractionEdits(target, 'audio-play', 'ding'))
  project = apply(project, componentClickInteractionEdits({ ...target, project, editingProject: project }, 'location-go', base.surface.id))
  const before = interactionRules(interactionBehavior(project, base.target))[0]
  project = apply(project, componentClickInteractionEdits({ ...target, project, editingProject: project }, 'audio-play', 'ding2'))
  const after = interactionRules(interactionBehavior(project, base.target))[0]
  expect(after.actions.map(step => step.id)).toEqual(before.actions.map(step => step.id))
  expect(after.actions.map(step => step.action)).toEqual([{ type: 'audio.play', soundId: 'ding2' }, { type: 'location.go', locationId: base.surface.id }])
  project.instances.group = { id: 'group', definitionId: 'content', data: {}, locked: true, childIds: ['item'] }
  project.surfaces[0].childIds = project.surfaces[0].childIds.filter(id => id !== 'item'); project.surfaces[0].childIds.push('group')
  expect(() => componentClickInteractionEdits({ ...target, project, editingProject: project }, 'audio-play', 'ding')).toThrow('锁定')
  const changed = structuredClone(interactionRules(interactionBehavior(project, base.target))); changed[0].name = '改名'
  expect(() => componentRuleEdits(project, base.target, changed)).toThrow('锁定')
  project.instances.group.locked = false
  const reveal = buildInteractionTemplateRule({ templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID, ruleId: 'reveal', actionIds: ['reveal-a'], targetLayerItemIds: ['item'] })
  project = apply(project, componentRevealSequenceEdits(project, base.target, reveal))
  expect(project.instances.item.playbackInitialVisibility).toBe('hidden')
  expect(interactionRules(interactionBehavior(project, base.target)).at(-1)).toEqual(reveal)
})

it('renders the configured teacher buttons without restoring deleted step controls', async () => {
  const { project } = fixture(), id = project.global.overlay[0], data = project.instances[id].data as Record<string, unknown>
  data.defaultCollapsed = false; data.buttons = []
  const root = document.createElement('div'); document.body.append(root)
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => project.surfaces[0].id, select() {} })
  const world = new ComponentPlatformRuntime('configured-controller', { teacherController: navigation })
  world.bind(id, root)
  try {
    await world.sync(project, { assets: {}, components: {} })
    expect(root.querySelector('[data-control="上一步"]')).toBeNull()
    expect(root.querySelector('[data-control="下一步"]')).toBeNull()
    expect(root.querySelector('[data-control="collapse"]')).not.toBeNull()
  } finally { await world.dispose(); navigation.dispose() }
})

it('keeps later reveal targets hidden in the actual World until their sequential enter action starts', async () => {
  const base = fixture()
  base.project.instances.second = { id: 'second', definitionId: 'content', data: {} }; base.surface.childIds.push('second')
  const reveal = buildInteractionTemplateRule({ templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
    ruleId: 'real-reveal', actionIds: ['first-enter', 'second-enter'], targetLayerItemIds: ['item', 'second'] })
  const project = apply(base.project, componentRevealSequenceEdits(base.project, base.target, reveal))
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => base.surface.id, select() {} })
  const world = new ComponentPlatformRuntime('reveal-initial-world', { teacherController: navigation })
  const first = document.createElement('div'), second = document.createElement('div'); document.body.append(first, second)
  // JSDOM has no animation backend; keep the first native animation in flight.
  first.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel() {}, pause() {} } as unknown as Animation))
  world.bind('item', first); world.bind('second', second)
  world.bindTarget('item', first); world.bindTarget('second', second)
  try {
    await world.sync(project, { assets: {}, components: {} })
    expect(second.hidden).toBe(true)
    expect(project.instances.second.playbackInitialVisibility).toBe('hidden')
    expect(first.hidden).toBe(false)
  } finally { await world.dispose(); navigation.dispose() }
})
