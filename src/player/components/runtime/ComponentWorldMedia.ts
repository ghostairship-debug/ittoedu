import type { ComponentMediaCommand, ComponentMediaPort, ComponentMediaState, ComponentRuntimeScope } from '../../../shared/contracts/component-platform'
import type { InteractionAction } from '../../../shared/interactionTypes'
import type { AudioManager, ManagedMediaPlayback } from '../../AudioManager'

/** Trusted adapter only. It holds no source DOM and creates no second audio voice. */
class RealmMediaPlayback extends EventTarget implements ManagedMediaPlayback {
  private state: ComponentMediaState
  private volumeValue = 1
  private mutedValue = false
  constructor(initial: ComponentMediaState, private readonly command: (value: ComponentMediaCommand) => Promise<boolean>) {
    super(); this.state = { ...initial }
  }
  get paused() { return this.state.paused }
  get currentTime() { return this.state.currentTime }
  set currentTime(seconds: number) { this.state.currentTime = seconds; void this.command({ type: 'seek', seconds }) }
  get loop() { return this.state.loop }
  set loop(value: boolean) { this.state.loop = value; void this.command({ type: 'loop', value }) }
  get volume() { return this.volumeValue }
  set volume(value: number) { this.volumeValue = value; this.mix() }
  get muted() { return this.mutedValue }
  set muted(value: boolean) { this.mutedValue = value; this.mix() }
  private mix() { void this.command({ type: 'mix', volume: this.volumeValue, muted: this.mutedValue }) }
  async play(): Promise<void> { if (!await this.command({ type: 'play' })) throw new Error('媒体播放未完成或作用域已取消') }
  pause(): void { void this.command({ type: 'pause' }) }
  report(state: ComponentMediaState, event?: 'play' | 'pause' | 'ended') {
    this.state = { ...state }
    if (event) this.dispatchEvent(new Event(event))
  }
}

/** Source controls participate in the document's existing AudioManager. */
export class ComponentWorldMedia {
  private readonly videos = new Map<string, Set<{ playback: RealmMediaPlayback; command(value: ComponentMediaCommand): Promise<boolean> }>>()
  constructor(private readonly manager: () => AudioManager | undefined, private readonly report: (message: string) => void) {}

  port(scope: ComponentRuntimeScope): ComponentMediaPort {
    return {
      register: (options, onCommand) => {
        if (!scope.isActive()) return { update() {}, report() {}, dispose() {} }
        const manager = this.manager()
        if (!manager) throw new Error('当前文档媒体管理器尚未准备')
        if (options.kind === 'audio' && options.channel === 'video') throw new Error('音频组件需要声音通道')
        let active = true
        const pending = new Set<(value: boolean) => void>()
        const command = (value: ComponentMediaCommand) => new Promise<boolean>(resolve => {
          if (!active || !scope.isActive()) { resolve(false); return }
          pending.add(resolve)
          void Promise.resolve().then(() => active && scope.isActive() ? onCommand(value) : false).then(result => {
            pending.delete(resolve); resolve(active && scope.isActive() && result === true)
          }, error => { pending.delete(resolve); resolve(false); if (active && scope.isActive()) this.report(`${scope.instanceId} 媒体：${String(error)}`) })
        })
        const playback = new RealmMediaPlayback(options.initial, command)
        const registration = options.kind === 'video'
          ? manager.registerPlaybackVideo(playback, { nodeId: scope.instanceId, volume: options.volume, muted: options.muted })
          : manager.registerPlaybackAudio(playback, { nodeId: scope.instanceId, soundId: scope.instanceId,
            channel: options.channel as 'music' | 'narration' | 'sfx' | 'ui', volume: options.volume, muted: options.muted })
        const entry = { playback, command }
        if (options.kind === 'video') {
          const videos = this.videos.get(scope.instanceId) ?? new Set(); videos.add(entry); this.videos.set(scope.instanceId, videos)
        }
        const dispose = () => {
          if (!active) return; active = false; registration.dispose()
          for (const resolve of pending) resolve(false); pending.clear()
          const videos = this.videos.get(scope.instanceId); videos?.delete(entry)
          if (!videos?.size) this.videos.delete(scope.instanceId)
        }
        scope.cleanup(dispose)
        return {
          update: patch => {
            if (!active || !scope.isActive()) return
            if (options.kind === 'audio' && patch.channel === 'video') { this.report('音频组件不能使用视频通道'); return }
            registration.update(patch as Parameters<typeof registration.update>[0])
          },
          report: (state, event) => { if (active && scope.isActive()) playback.report(state, event) },
          dispose,
        }
      },
      interruptBackground: mode => {
        const interruption = scope.isActive() ? this.manager()?.beginBackgroundAudioInterruption(mode) : undefined
        let active = true
        const release = () => { if (!active) return; active = false; interruption?.release() }
        scope.cleanup(release); return { release }
      },
    }
  }

  async executeVideo(action: Extract<InteractionAction, { type: `video.${string}` }>, signal: AbortSignal): Promise<boolean | undefined> {
    const entry = this.videos.get(action.nodeId)?.values().next().value
    if (!entry) return undefined
    if (signal.aborted) return false
    if (action.type === 'video.seek') return entry.command({ type: 'seek', seconds: action.seconds })
    if (action.type === 'video.pause') return entry.command({ type: 'pause' })
    if (action.type === 'video.stop') return await entry.command({ type: 'pause' }) && !signal.aborted && await entry.command({ type: 'seek', seconds: 0 })
    if (action.type === 'video.toggle' && !entry.playback.paused) return entry.command({ type: 'pause' })
    if (action.type === 'video.restart' && !await entry.command({ type: 'seek', seconds: 0 })) return false
    if (signal.aborted) return false
    const result = await entry.command({ type: 'play' })
    if (signal.aborted) { await entry.command({ type: 'pause' }); return false }
    return result
  }
}
