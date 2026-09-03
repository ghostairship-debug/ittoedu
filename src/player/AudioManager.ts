import type {
  AudioChannel,
  ProjectAudioSettings,
  ProjectMediaSettings,
  SoundDefinition,
} from '../shared/contracts/media-v1/types'
import type { VideoNode } from '../shared/contracts/native-v1/types'
import type {
  AudioActionTarget,
  AudioInteractionAction,
} from '../shared/contracts/interaction-v1/types'
import type {
  CourseEventBus,
  RuntimeEventDisposer,
  RuntimeExecutionMode,
} from '../shared/runtimeTypes'

export const AUDIO_CHANNELS = [
  'music',
  'narration',
  'sfx',
  'ui',
  'video',
] as const

export type SoundChannel = Exclude<AudioChannel, 'video'>
export type AudioLifetime = 'scene' | 'course'
export type AudioIfPlaying = 'restart' | 'continue' | 'ignore'
export type AudioManagerProjectSettings = ProjectAudioSettings
export type AudioTarget = AudioActionTarget
export type { AudioChannel, SoundDefinition }

/**
 * Published V2 and Course Project V9 both carry the formal media-v1 slice.
 * The manager deliberately reads no authoring document shape beyond it.
 */
export type AudioManagerProjectSource = {
  readonly media?: ProjectMediaSettings
}

export interface AudioChangeEvent {
  muted: boolean
  masterVolume: number
  channelVolumes: Readonly<Record<AudioChannel, number>>
}

export interface AudioPlaybackEvent {
  playbackId: string
  soundId: string
  channel: SoundChannel
  lifetime: AudioLifetime
  sceneId?: string
}

export interface AudioBlockedEvent extends AudioPlaybackEvent {
  reason: string
}

export interface AudioPlayOptions {
  volume?: number
  loop?: boolean
  fadeInMs?: number
  lifetime?: AudioLifetime
  sceneId?: string
  ifPlaying?: AudioIfPlaying
}

export interface RegisteredVideoOptions {
  nodeId: string
  volume?: number
  muted?: boolean
}

export interface VideoAudioRegistration {
  update(options: Partial<Omit<RegisteredVideoOptions, 'nodeId'>>): void
  dispose(): void
}

export interface BackgroundAudioInterruption {
  release(): void
}

export interface CourseAudioApi {
  muted(): boolean
  setMuted(value: boolean): void
  toggleMuted(): boolean
  masterVolume(): number
  setMasterVolume(value: number): void
  channelVolume(channel: AudioChannel): number
  setChannelVolume(channel: AudioChannel, value: number): void
  play(soundId: string, options?: AudioPlayOptions): boolean
  pause(target: AudioTarget, fadeOutMs?: number): boolean
  resume(target: AudioTarget, fadeInMs?: number): boolean
  stop(target: AudioTarget, fadeOutMs?: number): boolean
  toggleMute(target: AudioTarget): boolean
  execute(action: AudioInteractionAction): boolean
  beginBackgroundAudioInterruption(
    mode: VideoNode['backgroundAudioMode'],
  ): BackgroundAudioInterruption
}

export interface AudioManagerOptions {
  mode?: RuntimeExecutionMode
  createAudio?: (source: string) => HTMLAudioElement
  unlockTarget?: EventTarget
  maxConcurrent?: Partial<Record<'sfx' | 'ui', number>>
}

interface ManagedVoice {
  playbackId: string
  definition: SoundDefinition
  element: HTMLAudioElement
  lifetime: AudioLifetime
  sceneId?: string
  volume: number
  pendingUnlock: boolean
  pendingFadeInMs: number
  fadeGain: number
  fadeTimer: ReturnType<typeof setTimeout> | null
  playing: boolean
  stopping: boolean
  disposeListeners(): void
}

interface RegisteredVideo {
  nodeId: string
  element: HTMLVideoElement
  volume: number
  muted: boolean
}

const DEFAULT_CHANNEL_VOLUMES: Record<AudioChannel, number> = {
  music: 1,
  narration: 1,
  sfx: 1,
  ui: 1,
  video: 1,
}

function clampUnit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback
}

function fadeDuration(value: unknown, maximum = 60_000): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, value))
    : 0
}

function isSoundChannel(value: unknown): value is SoundChannel {
  return value === 'music' || value === 'narration' || value === 'sfx' || value === 'ui'
}

function normalizedSettings(project: AudioManagerProjectSource): AudioManagerProjectSettings {
  const raw = project.media?.audio
  const rawChannels = raw?.channelVolumes
  const channelVolumes = Object.fromEntries(
    AUDIO_CHANNELS.map((channel) => [
      channel,
      clampUnit(rawChannels?.[channel], DEFAULT_CHANNEL_VOLUMES[channel]),
    ]),
  ) as Record<AudioChannel, number>
  const sounds: Record<string, SoundDefinition> = Object.create(null) as Record<
    string,
    SoundDefinition
  >
  for (const [recordId, candidate] of Object.entries(raw?.sounds ?? {})) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.id !== 'string' ||
      candidate.id !== recordId ||
      typeof candidate.name !== 'string' ||
      typeof candidate.assetId !== 'string' ||
      !isSoundChannel(candidate.channel)
    ) {
      continue
    }
    sounds[recordId] = {
      id: candidate.id,
      name: candidate.name,
      assetId: candidate.assetId,
      channel: candidate.channel,
      defaultVolume: clampUnit(candidate.defaultVolume, 1),
      defaultLoop: candidate.defaultLoop === true,
    }
  }
  return {
    defaultMuted: raw?.defaultMuted === true,
    masterVolume: clampUnit(raw?.masterVolume, 1),
    channelVolumes,
    sounds,
    narrationDucking: {
      enabled: raw?.narrationDucking?.enabled === true,
      musicVolume: clampUnit(raw?.narrationDucking?.musicVolume, 0.35),
      fadeMs: Math.max(0, raw?.narrationDucking?.fadeMs ?? 0),
    },
  }
}

function defaultAudioFactory(source: string): HTMLAudioElement {
  return new Audio(source)
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return String(error || '浏览器阻止了声音播放')
}

function safelySetCurrentTime(element: HTMLMediaElement, value: number): void {
  try {
    element.currentTime = value
  } catch {
    // Some engines reject seeking before metadata is available. Playback can
    // still proceed and a later replay will seek successfully.
  }
}

export class AudioManager implements CourseAudioApi {
  private readonly settings: AudioManagerProjectSettings
  private readonly createAudio: (source: string) => HTMLAudioElement
  private readonly captureMode: boolean
  private readonly maxConcurrent: Record<'sfx' | 'ui', number>
  private readonly voices: ManagedVoice[] = []
  private readonly videos = new Set<RegisteredVideo>()
  private readonly eventDisposers: RuntimeEventDisposer[] = []
  private readonly mutedSounds = new Set<string>()
  private readonly mutedChannels = new Set<SoundChannel>()
  private readonly backgroundDuckTokens = new Set<symbol>()
  private readonly backgroundPauseTokens = new Set<symbol>()
  private readonly backgroundPausedVoices = new Set<ManagedVoice>()
  private readonly unlockTarget?: EventTarget
  private mutedValue: boolean
  private masterVolumeValue: number
  private currentSceneId: string | undefined
  private musicDuckGainValue = 1
  private musicDuckTargetValue = 1
  private musicDuckTimer: ReturnType<typeof setTimeout> | null = null
  private playbackSequence = 0
  private destroyed = false
  private unlockListenersInstalled = false

  constructor(
    project: AudioManagerProjectSource,
    private readonly resolveAssetUrl: (assetId: string) => string | undefined,
    private readonly events: CourseEventBus,
    options: AudioManagerOptions = {},
  ) {
    this.settings = normalizedSettings(project)
    this.mutedValue = this.settings.defaultMuted
    this.masterVolumeValue = this.settings.masterVolume
    this.captureMode = options.mode === 'capture'
    this.createAudio = options.createAudio ?? defaultAudioFactory
    this.unlockTarget = options.unlockTarget
    this.maxConcurrent = {
      sfx: positiveInteger(options.maxConcurrent?.sfx, 8),
      ui: positiveInteger(options.maxConcurrent?.ui, 4),
    }

    this.eventDisposers.push(
      events.on<{ sceneId?: string }>('scene:enter', (detail) => {
        this.currentSceneId = detail?.sceneId
      }),
      events.on<{ sceneId?: string }>('scene:leave', (detail) => {
        this.stopScene(detail?.sceneId)
        if (!detail?.sceneId || detail.sceneId === this.currentSceneId) {
          this.currentSceneId = undefined
        }
      }),
      events.on('course:restart', () => {
        this.stop({ kind: 'all' })
      }),
      events.on('course:destroy', () => this.destroy()),
    )
    this.installUnlockListeners()
  }

  muted(): boolean {
    return this.mutedValue
  }

  setMuted(value: boolean): void {
    if (this.destroyed || this.mutedValue === value) return
    this.mutedValue = value
    this.applyAllVolumes()
    this.emitChange()
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedValue)
    return this.mutedValue
  }

  masterVolume(): number {
    return this.masterVolumeValue
  }

  setMasterVolume(value: number): void {
    const normalized = clampUnit(value, this.masterVolumeValue)
    if (this.destroyed || normalized === this.masterVolumeValue) return
    this.masterVolumeValue = normalized
    this.applyAllVolumes()
    this.emitChange()
  }

  channelVolume(channel: AudioChannel): number {
    return this.settings.channelVolumes[channel]
  }

  setChannelVolume(channel: AudioChannel, value: number): void {
    const previous = this.settings.channelVolumes[channel]
    const normalized = clampUnit(value, previous)
    if (this.destroyed || normalized === previous) return
    this.settings.channelVolumes[channel] = normalized
    this.applyAllVolumes()
    this.emitChange()
  }

  play(soundId: string, options: AudioPlayOptions = {}): boolean {
    if (this.destroyed || this.captureMode) return false
    const definition = this.settings.sounds[soundId]
    if (!definition) return false

    const existing = this.voices.filter(
      (voice) => voice.definition.channel === definition.channel,
    )
    if (definition.channel === 'music' || definition.channel === 'narration') {
      const sameSound = existing.find((voice) => voice.definition.id === soundId)
      const policy = options.ifPlaying ?? 'restart'
      if (sameSound) {
        this.updateVoiceOptions(sameSound, options)
        if (policy === 'ignore') return true
        if (policy === 'restart') safelySetCurrentTime(sameSound.element, 0)
        return this.attemptPlay(sameSound, options.fadeInMs)
      }
      existing.forEach((voice) => this.stopVoice(voice))
    } else {
      const limit = this.maxConcurrent[definition.channel]
      const channelVoices = existing.filter((voice) => !voice.stopping)
      while (channelVoices.length >= limit) {
        const oldest = channelVoices.shift()
        if (oldest) this.stopVoice(oldest)
      }
    }

    let source: string | undefined
    try {
      source = this.resolveAssetUrl(definition.assetId)
    } catch (error) {
      console.error(`声音“${definition.name}”的素材解析失败`, error)
      return false
    }
    if (!source) return false

    let element: HTMLAudioElement
    try {
      element = this.createAudio(source)
    } catch (error) {
      console.error(`声音“${definition.name}”创建失败`, error)
      return false
    }
    element.preload = 'auto'
    element.loop = options.loop ?? definition.defaultLoop

    const voice: ManagedVoice = {
      playbackId: `audio-${++this.playbackSequence}`,
      definition,
      element,
      lifetime: options.lifetime ?? (definition.channel === 'music' ? 'course' : 'scene'),
      sceneId: options.sceneId ?? this.currentSceneId,
      volume: clampUnit(options.volume, definition.defaultVolume),
      pendingUnlock: false,
      pendingFadeInMs: fadeDuration(options.fadeInMs),
      fadeGain: options.fadeInMs && options.fadeInMs > 0 ? 0 : 1,
      fadeTimer: null,
      playing: false,
      stopping: false,
      disposeListeners() {},
    }
    voice.disposeListeners = this.bindVoiceEvents(voice)
    this.voices.push(voice)
    this.applyVoiceVolume(voice)
    return this.attemptPlay(voice, options.fadeInMs)
  }

  pause(target: AudioTarget, fadeOutMs = 0): boolean {
    if (this.destroyed || this.captureMode) return false
    const matched = this.matchingVoices(target)
    for (const voice of matched) {
      if (voice.definition.channel === 'music') {
        // An explicit author/user pause supersedes a temporary video pause and
        // must not be undone when that video later releases its interruption.
        this.backgroundPausedVoices.delete(voice)
      }
      this.pauseVoice(voice, fadeOutMs)
    }
    return matched.length > 0
  }

  resume(target: AudioTarget, fadeInMs = 0): boolean {
    if (this.destroyed || this.captureMode) return false
    const matched = this.matchingVoices(target)
    matched.forEach((voice) => this.attemptPlay(voice, fadeInMs))
    return matched.length > 0
  }

  stop(target: AudioTarget, fadeOutMs = 0): boolean {
    if (this.destroyed && target.kind !== 'all') return false
    const matched = this.matchingVoices(target)
    matched.forEach((voice) => this.stopVoice(voice, fadeOutMs))
    return matched.length > 0
  }

  toggleMute(target: AudioTarget): boolean {
    if (this.destroyed) return false
    if (target.kind === 'all') {
      this.toggleMuted()
      return true
    }
    if (target.kind === 'sound') {
      this.toggleSetValue(this.mutedSounds, target.soundId)
    } else {
      this.toggleSetValue(this.mutedChannels, target.channel)
    }
    this.applyAllVolumes()
    this.emitChange()
    return true
  }

  execute(action: AudioInteractionAction): boolean {
    switch (action.type) {
      case 'audio.play':
        return this.play(action.soundId, action)
      case 'audio.pause':
        return this.pause(action.target, action.fadeOutMs)
      case 'audio.resume':
        return this.resume(action.target, action.fadeInMs)
      case 'audio.stop':
        return this.stop(action.target, action.fadeOutMs)
      case 'audio.toggle-mute':
        return this.toggleMute(action.target)
    }
  }

  stopScene(sceneId = this.currentSceneId): boolean {
    const matched = this.voices.filter(
      (voice) =>
        voice.lifetime === 'scene' &&
        (sceneId === undefined || voice.sceneId === undefined || voice.sceneId === sceneId),
    )
    matched.forEach((voice) => this.stopVoice(voice))
    return matched.length > 0
  }

  registerVideo(
    element: HTMLVideoElement,
    options: RegisteredVideoOptions,
  ): VideoAudioRegistration {
    const registration: RegisteredVideo = {
      nodeId: options.nodeId,
      element,
      volume: clampUnit(options.volume, 1),
      muted: options.muted === true,
    }
    this.videos.add(registration)
    this.applyVideoVolume(registration)
    let active = true
    return {
      update: (patch) => {
        if (!active || this.destroyed) return
        if (patch.volume !== undefined) {
          registration.volume = clampUnit(patch.volume, registration.volume)
        }
        if (patch.muted !== undefined) registration.muted = patch.muted
        this.applyVideoVolume(registration)
      },
      dispose: () => {
        if (!active) return
        active = false
        this.videos.delete(registration)
      },
    }
  }

  unregisterVideo(element: HTMLVideoElement): void {
    for (const registration of [...this.videos]) {
      if (registration.element === element) this.videos.delete(registration)
    }
  }

  beginBackgroundAudioInterruption(
    mode: VideoNode['backgroundAudioMode'],
  ): BackgroundAudioInterruption {
    if (this.destroyed || this.captureMode || mode === 'none') {
      return { release() {} }
    }

    if (mode === 'stop') {
      this.stop({ kind: 'channel', channel: 'music' })
      return { release() {} }
    }

    const token = Symbol(`video-background-${mode}`)
    let active = true
    if (mode === 'duck') {
      this.backgroundDuckTokens.add(token)
      this.updateMusicDuckGain()
    } else {
      const firstPause = this.backgroundPauseTokens.size === 0
      this.backgroundPauseTokens.add(token)
      if (firstPause) this.pauseMusicForBackgroundInterruption()
    }

    return {
      release: () => {
        if (!active) return
        active = false
        if (mode === 'duck') {
          if (this.backgroundDuckTokens.delete(token)) this.updateMusicDuckGain()
          return
        }
        if (!this.backgroundPauseTokens.delete(token)) return
        if (this.backgroundPauseTokens.size === 0) {
          this.resumeBackgroundPausedMusic()
        }
      },
    }
  }

  async unlock(): Promise<void> {
    if (this.destroyed || this.captureMode) return
    const pending = this.voices.filter((voice) => voice.pendingUnlock)
    if (pending.length === 0) {
      this.removeUnlockListeners()
      return
    }
    await Promise.all(pending.map(async (voice) => {
      voice.pendingUnlock = false
      this.attemptPlay(voice, voice.pendingFadeInMs)
    }))
    if (!this.voices.some((voice) => voice.pendingUnlock)) {
      this.removeUnlockListeners()
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.cancelMusicDuckFade()
    this.stop({ kind: 'all' })
    this.destroyed = true
    this.cancelMusicDuckFade()
    this.backgroundDuckTokens.clear()
    this.backgroundPauseTokens.clear()
    this.backgroundPausedVoices.clear()
    this.videos.clear()
    this.removeUnlockListeners()
    this.eventDisposers.splice(0).forEach((dispose) => dispose())
  }

  private updateVoiceOptions(voice: ManagedVoice, options: AudioPlayOptions): void {
    voice.element.loop = options.loop ?? voice.definition.defaultLoop
    voice.lifetime = options.lifetime ?? voice.lifetime
    voice.sceneId = options.sceneId ?? voice.sceneId ?? this.currentSceneId
    voice.volume = clampUnit(options.volume, voice.definition.defaultVolume)
    this.applyVoiceVolume(voice)
  }

  private attemptPlay(voice: ManagedVoice, requestedFadeInMs = 0): boolean {
    if (voice.stopping || !this.voices.includes(voice)) return false
    const duration = fadeDuration(requestedFadeInMs)
    this.cancelVoiceFade(voice)
    voice.pendingFadeInMs = duration
    voice.fadeGain = duration > 0 ? 0 : 1
    this.applyVoiceVolume(voice)
    if (
      voice.definition.channel === 'music' &&
      this.backgroundPauseTokens.size > 0
    ) {
      voice.pendingUnlock = false
      this.backgroundPausedVoices.add(voice)
      return true
    }
    let result: Promise<void> | undefined
    try {
      result = voice.element.play()
    } catch (error) {
      this.handlePlayRejection(voice, error)
      return false
    }
    if (result && typeof result.catch === 'function') {
      void result.catch((error: unknown) => this.handlePlayRejection(voice, error))
    }
    if (voice.playing && voice.pendingFadeInMs > 0) {
      this.consumePendingFadeIn(voice)
    }
    return true
  }

  private handlePlayRejection(voice: ManagedVoice, error: unknown): void {
    if (voice.stopping || !this.voices.includes(voice)) return
    this.cancelVoiceFade(voice)
    this.events.emit<AudioBlockedEvent>('audio:blocked', {
      ...this.playbackEvent(voice),
      reason: errorReason(error),
    })
    if (voice.definition.channel === 'music' || voice.definition.channel === 'narration') {
      voice.pendingUnlock = true
      this.installUnlockListeners()
    } else {
      this.stopVoice(voice)
    }
  }

  private bindVoiceEvents(voice: ManagedVoice): () => void {
    const onPlay = () => {
      if (voice.stopping) return
      voice.playing = true
      voice.pendingUnlock = false
      this.consumePendingFadeIn(voice)
      this.updateMusicDuckGain()
      this.events.emit<AudioPlaybackEvent>('audio:play', this.playbackEvent(voice))
    }
    const onPause = () => {
      if (voice.stopping || !voice.playing) return
      voice.playing = false
      this.updateMusicDuckGain()
      this.events.emit<AudioPlaybackEvent>('audio:pause', this.playbackEvent(voice))
    }
    const onEnded = () => {
      if (voice.stopping) return
      voice.playing = false
      this.removeVoice(voice)
      this.updateMusicDuckGain()
      this.events.emit<AudioPlaybackEvent>('audio:ended', this.playbackEvent(voice))
    }
    elementOn(voice.element, 'play', onPlay)
    elementOn(voice.element, 'pause', onPause)
    elementOn(voice.element, 'ended', onEnded)
    return () => {
      voice.element.removeEventListener('play', onPlay)
      voice.element.removeEventListener('pause', onPause)
      voice.element.removeEventListener('ended', onEnded)
    }
  }

  private pauseVoice(voice: ManagedVoice, requestedFadeOutMs = 0): void {
    voice.pendingUnlock = false
    voice.pendingFadeInMs = 0
    const duration = fadeDuration(requestedFadeOutMs)
    if (duration > 0 && voice.playing) {
      this.startVoiceFade(voice, 0, duration, () => this.finishPauseVoice(voice))
      return
    }
    this.cancelVoiceFade(voice)
    this.finishPauseVoice(voice)
  }

  private finishPauseVoice(voice: ManagedVoice): void {
    if (!this.voices.includes(voice)) return
    try {
      voice.element.pause()
    } catch (error) {
      console.error(`声音“${voice.definition.name}”暂停失败`, error)
    }
  }

  private stopVoice(voice: ManagedVoice, requestedFadeOutMs = 0): void {
    if (voice.stopping || !this.voices.includes(voice)) return
    voice.pendingUnlock = false
    voice.pendingFadeInMs = 0
    const duration = fadeDuration(requestedFadeOutMs)
    if (duration > 0 && voice.playing) {
      this.startVoiceFade(voice, 0, duration, () => this.finishStopVoice(voice))
      return
    }
    this.cancelVoiceFade(voice)
    this.finishStopVoice(voice)
  }

  private finishStopVoice(voice: ManagedVoice): void {
    if (voice.stopping || !this.voices.includes(voice)) return
    voice.stopping = true
    voice.pendingUnlock = false
    try {
      voice.element.pause()
    } catch {
      // Continue cleanup even if a browser media backend has already detached.
    }
    safelySetCurrentTime(voice.element, 0)
    this.removeVoice(voice)
    this.events.emit<AudioPlaybackEvent>('audio:stop', this.playbackEvent(voice))
    this.releaseElement(voice.element)
    this.updateMusicDuckGain()
  }

  private removeVoice(voice: ManagedVoice): void {
    const index = this.voices.indexOf(voice)
    if (index >= 0) this.voices.splice(index, 1)
    this.backgroundPausedVoices.delete(voice)
    this.cancelVoiceFade(voice)
    voice.disposeListeners()
  }

  private releaseElement(element: HTMLAudioElement): void {
    try {
      element.removeAttribute('src')
      element.load()
    } catch {
      // Releasing the source is best-effort; object/data URLs are owned by the
      // export payload or caller and are not revoked here.
    }
  }

  private matchingVoices(target: AudioTarget): ManagedVoice[] {
    if (target.kind === 'all') return [...this.voices]
    if (target.kind === 'sound') {
      return this.voices.filter((voice) => voice.definition.id === target.soundId)
    }
    return this.voices.filter((voice) => voice.definition.channel === target.channel)
  }

  private toggleSetValue<T>(values: Set<T>, value: T): void {
    if (values.has(value)) values.delete(value)
    else values.add(value)
  }

  private consumePendingFadeIn(voice: ManagedVoice): void {
    const duration = voice.pendingFadeInMs
    voice.pendingFadeInMs = 0
    if (duration > 0) {
      this.startVoiceFade(voice, 1, duration)
      return
    }
    this.cancelVoiceFade(voice)
    voice.fadeGain = 1
    this.applyVoiceVolume(voice)
  }

  private startVoiceFade(
    voice: ManagedVoice,
    target: number,
    requestedDuration: number,
    onComplete?: () => void,
  ): void {
    this.cancelVoiceFade(voice)
    const duration = fadeDuration(requestedDuration)
    const from = voice.fadeGain
    if (duration === 0 || Math.abs(target - from) < 0.0001) {
      voice.fadeGain = target
      this.applyVoiceVolume(voice)
      onComplete?.()
      return
    }
    const startedAt = Date.now()
    const step = () => {
      voice.fadeTimer = null
      if (this.destroyed || voice.stopping || !this.voices.includes(voice)) return
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      voice.fadeGain = from + (target - from) * progress
      this.applyVoiceVolume(voice)
      if (progress >= 1) {
        onComplete?.()
        return
      }
      const remaining = duration - (Date.now() - startedAt)
      voice.fadeTimer = setTimeout(step, Math.min(16, Math.max(1, remaining)))
    }
    voice.fadeTimer = setTimeout(step, Math.min(16, duration))
  }

  private cancelVoiceFade(voice: ManagedVoice): void {
    if (voice.fadeTimer === null) return
    clearTimeout(voice.fadeTimer)
    voice.fadeTimer = null
  }

  private updateMusicDuckGain(): void {
    const narrationPlaying = this.voices.some(
      (voice) => voice.definition.channel === 'narration' && voice.playing,
    )
    const shouldDuck =
      (this.settings.narrationDucking.enabled && narrationPlaying) ||
      this.backgroundDuckTokens.size > 0
    const target = shouldDuck
      ? this.settings.narrationDucking.musicVolume
      : 1
    if (this.musicDuckTimer !== null && target === this.musicDuckTargetValue) return
    this.cancelMusicDuckFade()
    this.musicDuckTargetValue = target
    const duration = fadeDuration(this.settings.narrationDucking.fadeMs, 10_000)
    const from = this.musicDuckGainValue
    if (duration === 0 || Math.abs(target - from) < 0.0001) {
      this.musicDuckGainValue = target
      this.applyAllVolumes()
      return
    }
    const startedAt = Date.now()
    const step = () => {
      this.musicDuckTimer = null
      if (this.destroyed) return
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      this.musicDuckGainValue = from + (target - from) * progress
      this.applyAllVolumes()
      if (progress >= 1) return
      const remaining = duration - (Date.now() - startedAt)
      this.musicDuckTimer = setTimeout(
        step,
        Math.min(16, Math.max(1, remaining)),
      )
    }
    this.musicDuckTimer = setTimeout(step, Math.min(16, duration))
  }

  private cancelMusicDuckFade(): void {
    if (this.musicDuckTimer === null) return
    clearTimeout(this.musicDuckTimer)
    this.musicDuckTimer = null
  }

  private applyAllVolumes(): void {
    this.voices.forEach((voice) => this.applyVoiceVolume(voice))
    this.videos.forEach((video) => this.applyVideoVolume(video))
  }

  private applyVoiceVolume(voice: ManagedVoice): void {
    const duckMultiplier = voice.definition.channel === 'music'
      ? this.musicDuckGainValue
      : 1
    voice.element.muted =
      this.mutedValue ||
      this.mutedSounds.has(voice.definition.id) ||
      this.mutedChannels.has(voice.definition.channel)
    voice.element.volume = clampUnit(
      voice.volume *
        this.masterVolumeValue *
        this.settings.channelVolumes[voice.definition.channel] *
        duckMultiplier *
        voice.fadeGain,
      1,
    )
  }

  private applyVideoVolume(video: RegisteredVideo): void {
    video.element.muted = this.mutedValue || video.muted || this.captureMode
    video.element.volume = clampUnit(
      video.volume * this.masterVolumeValue * this.settings.channelVolumes.video,
      1,
    )
  }

  private pauseMusicForBackgroundInterruption(): void {
    for (const voice of this.voices) {
      if (
        voice.definition.channel !== 'music' ||
        (!voice.playing && !voice.pendingUnlock)
      ) {
        continue
      }
      this.backgroundPausedVoices.add(voice)
      voice.pendingUnlock = false
      try {
        voice.element.pause()
      } catch (error) {
        console.error(`声音“${voice.definition.name}”暂停失败`, error)
      }
    }
  }

  private resumeBackgroundPausedMusic(): void {
    const voices = [...this.backgroundPausedVoices]
    this.backgroundPausedVoices.clear()
    voices.forEach((voice) => {
      if (!voice.stopping && this.voices.includes(voice)) {
        this.attemptPlay(voice, voice.pendingFadeInMs)
      }
    })
  }

  private emitChange(): void {
    this.events.emit<AudioChangeEvent>('audio:change', {
      muted: this.mutedValue,
      masterVolume: this.masterVolumeValue,
      channelVolumes: Object.freeze({ ...this.settings.channelVolumes }),
    })
  }

  private playbackEvent(voice: ManagedVoice): AudioPlaybackEvent {
    return {
      playbackId: voice.playbackId,
      soundId: voice.definition.id,
      channel: voice.definition.channel,
      lifetime: voice.lifetime,
      ...(voice.sceneId ? { sceneId: voice.sceneId } : {}),
    }
  }

  private installUnlockListeners(): void {
    if (!this.unlockTarget || this.unlockListenersInstalled || this.captureMode) return
    this.unlockListenersInstalled = true
    this.unlockTarget.addEventListener('pointerdown', this.handleUnlock)
    this.unlockTarget.addEventListener('touchstart', this.handleUnlock)
    this.unlockTarget.addEventListener('keydown', this.handleUnlock)
  }

  private removeUnlockListeners(): void {
    if (!this.unlockTarget || !this.unlockListenersInstalled) return
    this.unlockListenersInstalled = false
    this.unlockTarget.removeEventListener('pointerdown', this.handleUnlock)
    this.unlockTarget.removeEventListener('touchstart', this.handleUnlock)
    this.unlockTarget.removeEventListener('keydown', this.handleUnlock)
  }

  private readonly handleUnlock = (): void => {
    void this.unlock()
  }
}

function elementOn(
  element: HTMLMediaElement,
  eventName: string,
  listener: EventListener,
): void {
  element.addEventListener(eventName, listener)
}
