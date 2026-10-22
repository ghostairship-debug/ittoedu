// @vitest-environment jsdom
import { withTestTeacherController } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { appendRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'
import { afterEach, expect, it, vi } from 'vitest'
import { AudioManager } from '../../src/player/AudioManager'
import { CourseEventBus } from '../../src/player/CourseEventBus'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentWorldMedia } from '../../src/player/components/runtime/ComponentWorldMedia'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import { createAudioRuntimeImplementation, createVideoRuntimeImplementation } from '../../src/components/media/runtime'
import { createAudioData, createVideoData } from '../../src/components/media/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { ComponentRuntimeContext, JsonValue } from '../../src/shared/contracts/component-platform'

class Playback extends EventTarget {
  paused = true; currentTime = 0; loop = false; volume = 1; muted = false; preload = ''; plays = 0; error: Error | null = null
  constructor(readonly source = '') { super() }
  play(): Promise<void> { this.plays++; if (this.error) { const error = this.error; this.error = null; return Promise.reject(error) }; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve() }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatchEvent(new Event('pause')) }
  load() {} removeAttribute() {}
}
function settings(channel: 'music' | 'narration' = 'music') {
  return { media: { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
    narrationDucking: { enabled: false, musicVolume: .3, fadeMs: 0 }, sounds: { sound: { id: 'sound', name: 'sound', assetId: 'old', channel, defaultVolume: 1, defaultLoop: false } } } } }
}
function manager(channel: 'music' | 'narration' = 'music', options: ConstructorParameters<typeof AudioManager>[3] = {}) {
  const project = settings(channel), events = new CourseEventBus(), audio: Playback[] = []
  const instance = new AudioManager(project, id => id, events, { ...options, createAudio: source => { const element = new Playback(source); audio.push(element); return element as unknown as HTMLAudioElement } })
  return { project, events, audio, manager: instance }
}
function scope(id = 'media') {
  const abort = new AbortController(), cleanups: (() => void)[] = [], listeners = new Map<string, Set<(value: JsonValue) => void>>()
  const current: ComponentRuntimeContext['scope'] = { runScopeId: 'audit', instanceId: id, generation: 1, signal: abort.signal, isActive: () => !abort.signal.aborted,
    cleanup: fn => { cleanups.push(fn) }, target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} },
    events: { emit(name, value) { for (const fn of listeners.get(name) ?? []) fn(value) }, subscribe(name, fn) { const callbacks = listeners.get(name) ?? new Set(); callbacks.add(fn); listeners.set(name, callbacks); return () => { callbacks.delete(fn) } } } }
  return { scope: current, dispose() { abort.abort(); cleanups.forEach(fn => fn()) } }
}
function domMedia() {
  const active = new WeakSet<HTMLMediaElement>()
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return !active.has(this) })
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(100)
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { active.add(this); this.dispatchEvent(new Event('play')); return Promise.resolve() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { const changed = active.delete(this); if (changed) this.dispatchEvent(new Event('pause')) })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  return play
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('CA205 updates external channel lifetime; CA236 uses owning surface at registration before scene notification', () => {
  const h = manager('music', { sceneIdForNode: id => id === 'B-media' ? 'B' : 'A' }), audio = new Playback()
  h.events.emit('scene:enter', { sceneId: 'A' })
  const registration = h.manager.registerPlaybackAudio(audio, { nodeId: 'B-media', channel: 'narration' })
  h.events.emit('scene:leave', { sceneId: 'A' }); h.events.emit('scene:enter', { sceneId: 'B' })
  expect(h.manager.play('B-media')).toBe(true); expect(audio.paused).toBe(false)
  registration.update({ channel: 'music' }); h.events.emit('scene:leave', { sceneId: 'B' }); expect(audio.paused).toBe(false)
  registration.update({ channel: 'narration' }); h.events.emit('scene:enter', { sceneId: 'B' }); h.events.emit('scene:leave', { sceneId: 'B' }); expect(audio.paused).toBe(true)
  registration.dispose(); h.manager.destroy()
})

it('CA206 pause resume does not revive retired scene audio; CA221 leaving pauses video and does not rewind it', () => {
  const h = manager(), narration = new Playback(), video = new Playback()
  h.events.emit('scene:enter', { sceneId: 'A' })
  h.manager.registerPlaybackAudio(narration, { nodeId: 'A-audio', channel: 'narration' }); h.manager.registerPlaybackVideo(video, { nodeId: 'A-video' })
  h.manager.play('sound'); h.manager.play('A-audio'); void video.play(); video.currentTime = 10
  const resume = h.manager.pauseActive(); h.events.emit('scene:leave', { sceneId: 'A' }); h.events.emit('scene:enter', { sceneId: 'B' }); resume()
  expect(narration.paused).toBe(true); expect(narration.plays).toBe(1); expect(video.paused).toBe(true); expect(video.currentTime).toBe(10)
  expect(h.audio[0].paused).toBe(false); h.manager.destroy()
})

it('CA255 releasing video interruption while all-course paused does not resume background music', () => {
  const h = manager(), video = new Playback(); h.manager.play('sound')
  const interruption = h.manager.beginBackgroundAudioInterruption('pause'); h.manager.registerPlaybackVideo(video, { nodeId: 'video' })
  video.addEventListener('pause', interruption.release); void video.play(); expect(h.audio[0].paused).toBe(true)
  const resume = h.manager.pauseActive(); expect(video.paused).toBe(true); expect(h.audio[0].paused).toBe(true); expect(h.audio[0].plays).toBe(1)
  resume(); expect(h.audio[0].paused).toBe(false); h.manager.destroy()
})

it('CA257 obsolete play rejection cannot rearm unlock after an explicit pause', async () => {
  let reject!: (reason: unknown) => void
  const h = manager(), element = new Playback(); vi.spyOn(element, 'play').mockImplementation(() => { element.plays++; return new Promise((_resolve, fail) => { reject = fail }) })
  h.manager.registerPlaybackAudio(element, { nodeId: 'audio', channel: 'music' }); h.manager.play('audio'); h.manager.pause({ kind: 'sound', soundId: 'audio' })
  reject(new Error('AbortError')); await Promise.resolve(); await h.manager.unlock(); expect(element.plays).toBe(1); h.manager.destroy()
})

it('CA273 live sound identity consumes new asset, defaults, channel and deletion without duplicate old voices', () => {
  const h = manager(); h.manager.play('sound'); const old = h.audio[0]
  const next = settings(); next.media.audio.sounds.sound.assetId = 'new'; h.manager.updateProject(next); h.manager.play('sound')
  expect(old.paused).toBe(true); expect(h.audio[1].source).toBe('new')
  const changed = settings('narration'); Object.assign(changed.media.audio.sounds.sound, { assetId: 'new', defaultVolume: .4, defaultLoop: true })
  h.manager.updateProject(changed); h.manager.play('sound'); expect(h.audio).toHaveLength(2); expect(h.audio[1].volume).toBe(.4); expect(h.audio[1].loop).toBe(true)
  h.manager.play('sound', { volume: .7, loop: false }); expect(h.audio[1].volume).toBe(.7); expect(h.audio[1].loop).toBe(false)
  h.manager.updateProject({ media: { audio: { ...changed.media.audio, sounds: {} } } }); expect(h.audio[1].paused).toBe(true); expect(h.manager.play('sound')).toBe(false); h.manager.destroy()
})

it('CA112 V10 injects the current document unlock target into its existing AudioManager', async () => {
  const audio: Playback[] = []; vi.stubGlobal('Audio', class extends Playback { constructor(source: string) { super(source); this.error = new Error('gesture required'); audio.push(this) } })
  const project = withTestTeacherController(createBlankCourseProjectV10()); project.media = settings().media
  const runtime = new ComponentPlatformRuntime('unlock', { resolveAssetUrl: id => id }), root = document.createElement('div'); document.body.append(root)
  const id = project.global.overlay[0]; runtime.bind(id, root); runtime.bindTarget(id, root); await runtime.sync(project, { assets: {}, components: {} })
  expect(runtime.audio()?.play('sound')).toBe(true); await Promise.resolve(); expect(audio[0].plays).toBe(1)
  document.dispatchEvent(new Event('pointerdown')); await Promise.resolve(); expect(audio[0].plays).toBe(2); await runtime.dispose()
})

it('CA111 queued realm seek honors rule cancellation; CA132 queued play respects the current playback epoch', async () => {
  const h = manager(), s = scope('video'), commands: string[] = []; let playing = true, epoch = 0
  const world = new ComponentWorldMedia(() => h.manager, () => {}, () => playing, () => epoch)
  world.port(s.scope).register({ kind: 'video', channel: 'video', volume: 1, muted: false, initial: { paused: true, currentTime: 0, loop: false } }, command => { commands.push(command.type); return true })
  await Promise.resolve(); commands.length = 0
  const abort = new AbortController(), seek = world.executeVideo({ type: 'video.seek', nodeId: 'video', seconds: 10 }, abort.signal); abort.abort()
  expect(await seek).toBe(false); expect(commands).not.toContain('seek')
  const play = world.executeVideo({ type: 'video.play', nodeId: 'video' }, new AbortController().signal); playing = false; epoch++; playing = true
  expect(await play).toBe(false); expect(commands).not.toContain('play'); s.dispose(); h.manager.destroy()
})

it('CA132 late metadata never auto-plays while paused/edit/capture; CA136 first play preserves an explicit seek', async () => {
  const plays = domMedia(), s = scope(), root = document.createElement('div'); document.body.append(root); let active = false
  const data = { ...createVideoData('video'), autoplay: true }, implementation = createVideoRuntimeImplementation({ resolveAssetUrl: () => 'video', isPlaying: () => active })
  const mounted = await implementation.mount({ instance: { id: 'media', definitionId: 'video', data }, root, scope: s.scope }); const video = root.querySelector('video')!
  video.dispatchEvent(new Event('loadedmetadata')); expect(plays).not.toHaveBeenCalled(); expect(video.autoplay).toBe(false)
  active = true; video.currentTime = 10; await video.play(); expect(video.currentTime).toBe(10)
  mounted.dispose(); s.dispose()
})

it('CA138 sends the authored endpoint before clip rewind; CA260 uses the audio action loop option in both directions', async () => {
  domMedia(); const h = manager(), s = scope('clip'), root = document.createElement('div'); document.body.append(root)
  const times: number[] = []; s.scope.events.subscribe('audio.time', value => { if (value && typeof value === 'object' && !Array.isArray(value)) times.push(Number(value.seconds)) })
  const data = { ...createAudioData('clip'), startTime: 2, endTime: 8, loop: true }
  const mounted = await createAudioRuntimeImplementation({ resolveAssetUrl: () => 'clip', audioManager: h.manager, isPlaying: () => true }).mount({ instance: { id: 'clip', definitionId: 'audio', data }, root, scope: s.scope })
  const audio = root.querySelector('audio')!; expect(h.manager.play('clip', { loop: false })).toBe(true); audio.currentTime = 8.1; audio.dispatchEvent(new Event('timeupdate'))
  expect(audio.paused).toBe(true); expect(audio.currentTime).toBe(8); expect(times).toContain(8)
  await mounted.update({ id: 'clip', definitionId: 'audio', data: { ...data, loop: false } }); expect(h.manager.play('clip', { loop: true })).toBe(true)
  times.length = 0; audio.currentTime = 7.8; audio.dispatchEvent(new Event('timeupdate')); audio.currentTime = 8.1; audio.dispatchEvent(new Event('timeupdate'))
  expect(audio.currentTime).toBe(2); expect(audio.paused).toBe(false); expect(times).toEqual([7.8, 8, 2]); expect(audio.loop).toBe(false)
  mounted.dispose(); s.dispose(); h.manager.destroy()
})

it('CA085 cold audio waits only for its original asset action and cancelled departure never replays it', async () => {
  const created: Playback[] = []; vi.stubGlobal('Audio', class extends Playback { constructor(source: string) { super(source); created.push(this) } })
  let download!: () => void; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { download = () => resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) })))
  const project = createBlankCourseProjectV10(); project.media = settings('narration').media; project.assets.old = { id: 'old', path: 'assets/old', mimeType: 'audio/wav' }
  project.global = { underlay: [], overlay: [] };
  const surfaceId = componentSurfaces(project)[0].id; appendRootContainers(project, { id: 'B', title: 'B', kind: 'slide', childIds: [] })
  project.definitions.entry = { id: 'entry', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  project.instances.entry = { id: 'entry', definitionId: 'entry', attachments: [{ instanceId: 'entry', target: { kind: 'surface', surfaceId } }], data: { rules: [{ id: 'play', name: 'play', enabled: true, trigger: { type: 'scene.enter' }, conditions: [], actions: [{ id: 'sound', start: 'after-previous', delayMs: 0, action: { type: 'audio.play', soundId: 'sound' } }] }] } }
  testContainerInstance(project, 0).childIds.push('entry'); const { revision: _revision, ...payload } = project
  const root = document.createElement('div'); document.body.append(root)
  const messages: string[] = [], player = await mountPublishedCourseV3({ ...payload, schemaVersion: 4, assets: { old: { id: 'old', mimeType: 'audio/wav', url: 'https://assets.example/audio.wav' } } }, root, { keyboardNavigation: false, report: message => messages.push(message) })
  try { expect(messages).toEqual([]); expect(created).toHaveLength(0); expect(download).toBeTypeOf('function'); download(); await vi.waitFor(() => expect(created).toHaveLength(1)); expect(created[0].plays).toBe(1) }
  finally { await player.dispose() }
  created.length = 0
  const departed = await mountPublishedCourseV3({ ...payload, schemaVersion: 4, assets: { old: { id: 'old', mimeType: 'audio/wav', url: 'https://assets.example/audio.wav' } } }, root, { keyboardNavigation: false })
  try { await departed.go('B'); download(); await departed.waitForCaptureReady(); expect(created).toHaveLength(0) }
  finally { await departed.dispose() }
})

it('CA085 native audio uses its existing instance voice after the original cold asset becomes ready', async () => {
  const plays = domMedia(); let download!: () => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { download = () => resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) })))
  const project = createBlankCourseProjectV10(); project.global = { underlay: [], overlay: [] };
  const surfaceId = componentSurfaces(project)[0].id
  project.assets.asset = { id: 'asset', path: 'assets/asset', mimeType: 'audio/wav' }
  project.definitions.audio = { id: 'audio', role: 'content', implementation: { kind: 'builtin', key: 'guoling.audio' } }
  project.instances.audio = { id: 'audio', definitionId: 'audio', data: createAudioData('asset'), frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] } }
  project.definitions.entry = { id: 'entry', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  project.instances.entry = { id: 'entry', definitionId: 'entry', attachments: [{ instanceId: 'entry', target: { kind: 'surface', surfaceId } }], data: { rules: [{ id: 'play', name: 'play', enabled: true, trigger: { type: 'scene.enter' }, conditions: [], actions: [{ id: 'audio', start: 'after-previous', delayMs: 0, action: { type: 'audio.play', soundId: 'audio' } }] }] } }
  testContainerInstance(project, 0).childIds.push('audio', 'entry'); const { revision: _revision, ...payload } = project
  const root = document.createElement('div'); document.body.append(root)
  const player = await mountPublishedCourseV3({ ...payload, schemaVersion: 4, assets: { asset: { id: 'asset', mimeType: 'audio/wav', url: 'https://assets.example/audio.wav' } } }, root, { keyboardNavigation: false })
  try {
    expect(plays).not.toHaveBeenCalled(); const element = player.runtime.contentElement('audio')!.querySelector('audio')!
    download(); await vi.waitFor(() => expect(plays).toHaveBeenCalledOnce())
    expect(element.paused).toBe(false); expect(player.runtime.contentElement('audio')!.querySelector('audio')).toBe(element); expect(project.media).toBeUndefined()
  } finally { await player.dispose() }
})
