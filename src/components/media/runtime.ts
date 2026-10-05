import type { ComponentInstance, ComponentMediaRegistration, ComponentRuntimeImplementation } from '../../shared/contracts/component-platform'
import type { AudioManager, BackgroundAudioInterruption, VideoAudioRegistration } from '../../player/AudioManager'
import { audioDataSchema, videoDataSchema, type AudioData, type VideoData, type MediaData, type MediaKind } from './data'
import { applyMediaPresentation, renderMedia, type ResolveMediaAssetUrl } from './render'

export interface MediaDiagnostic { code: string; assetId: string; message: string }
export interface MediaRuntimeOptions {
  resolveAssetUrl: ResolveMediaAssetUrl
  audioManager?: Pick<AudioManager, 'muted' | 'masterVolume' | 'channelVolume' | 'registerAudio' | 'registerVideo' | 'beginBackgroundAudioInterruption'>
  subscribeAudioChange?: (listener: () => void) => () => void
  report?: (diagnostic: MediaDiagnostic) => void
}

function createMediaRuntimeImplementation(kind: MediaKind, options: MediaRuntimeOptions): ComponentRuntimeImplementation<MediaData> {
  const parse = (data: unknown): MediaData => kind === 'audio' ? audioDataSchema.parse(data) : videoDataSchema.parse(data)
  return {
    mount({ instance, root, scope, media: mediaPort }) {
      if (!root) throw new Error('媒体组件需要 DOM 容器')
      const media = renderMedia(root.ownerDocument, kind)
      media.dataset.mediaInstanceId = instance.id
      media.dataset.mediaKind = kind
      root.append(media)
      let current: ComponentInstance<MediaData> = { ...instance, data: parse(instance.data) }
      let disposed = false, source: string | undefined, sourceVersion = 0
      let videoRegistration: VideoAudioRegistration | undefined
      let audioRegistration: ReturnType<AudioManager['registerAudio']> | undefined
      // Local professional defaults register their DOM directly. Source realms
      // register the same playback through the document's public media port.
      const sourcePort = options.audioManager ? undefined : mediaPort
      let sourceRegistration: ComponentMediaRegistration | undefined
      let interruption: BackgroundAudioInterruption | undefined
      let clipEnded = false
      let hasStarted = false
      const live = () => !disposed && scope.isActive() && !scope.signal.aborted
      const report = (code: string, message: string, assetId = current.data.assetId) => {
        if (!live()) return
        media.dataset.mediaDiagnostic = code
        options.report?.({ code, assetId, message })
      }
      const releaseInterruption = () => { interruption?.release(); interruption = undefined }
      const interruptBackground = (mode: 'none' | 'duck' | 'pause' | 'stop') =>
        options.audioManager?.beginBackgroundAudioInterruption(mode) ?? sourcePort?.interruptBackground(mode)
      const reportState = (event?: 'play' | 'pause' | 'ended') => sourceRegistration?.report({
        paused: media.paused, currentTime: media.currentTime, loop: media.loop,
      }, event)
      const syncVolume = () => {
        if (!live()) return
        const data = current.data
        if (audioRegistration && 'channel' in data) { audioRegistration.update({ channel: data.channel, volume: data.volume, muted: data.muted }); return }
        if (videoRegistration) { videoRegistration.update({ volume: data.volume, muted: data.muted }); return }
        if (sourceRegistration) {
          sourceRegistration.update({ channel: 'channel' in data ? data.channel : 'video', volume: data.volume, muted: data.muted })
          return
        }
        media.volume = data.volume * (options.audioManager?.masterVolume() ?? 1)
          * (options.audioManager?.channelVolume('channel' in data ? data.channel : 'video') ?? 1)
        media.muted = data.muted || (options.audioManager?.muted() ?? false)
      }
      const seek = (seconds: number) => {
        const duration = Number.isFinite(media.duration) ? media.duration : Infinity
        try { media.currentTime = Math.min(Math.max(0, seconds), duration); return true }
        catch (error) { report('media-seek-unavailable', `媒体定位尚不可用：${error instanceof Error ? error.message : String(error)}`); return false }
      }
      const play = async (): Promise<boolean> => {
        if (!live() || !source) return false
        const version = sourceVersion
        try {
          await media.play()
          return live() && version === sourceVersion && !media.paused
        } catch (error) {
          if (live() && version === sourceVersion) report('media-playback-blocked', `浏览器未能播放媒体：${error instanceof Error ? error.message : String(error)}`)
          return false
        }
      }
      const notify = (event: string) => {
        if (live()) {
          reportState(event === 'started' ? 'play' : event === 'paused' ? 'pause' : event === 'ended' ? 'ended' : undefined)
          scope.events.emit(`${kind}.${event}`, { instanceId: current.id, seconds: media.currentTime })
        }
      }
      const listeners: [string, EventListener][] = []
      const listen = (name: string, listener: EventListener) => { media.addEventListener(name, listener); listeners.push([name, listener]) }
      listen('loadedmetadata', () => {
        if (!live()) return
        const data = current.data
        seek('poster' in data && data.poster.mode === 'video-frame' && !data.autoplay ? data.poster.time : data.startTime)
        reportState()
        if (data.autoplay) play()
      })
      listen('play', () => {
        if (!live()) return
        const data = current.data
        clipEnded = false
        if (!hasStarted || media.currentTime < data.startTime || (data.endTime !== null && media.currentTime >= data.endTime)) seek(data.startTime)
        hasStarted = true
        if ('backgroundAudioMode' in data && !interruption) interruption = interruptBackground(data.backgroundAudioMode)
        notify('started')
      })
      listen('pause', () => { releaseInterruption(); notify('paused') })
      listen('ended', () => { releaseInterruption(); notify('ended'); if (live() && current.data.loop) { seek(current.data.startTime); play() } })
      listen('timeupdate', () => {
        if (!live()) return
        const data = current.data
        if (!media.paused && media.currentTime < data.startTime) seek(data.startTime)
        if (data.endTime !== null && media.currentTime >= data.endTime && !clipEnded) {
          if (data.loop && data.endTime > data.startTime) { seek(data.startTime); if (media.paused) play() }
          else { clipEnded = true; media.pause(); if (media.currentTime !== data.endTime) seek(data.endTime); releaseInterruption(); notify('ended') }
        }
        if (data.endTime === null || media.currentTime < data.endTime) clipEnded = false
        notify('time')
      })
      listen('click', () => { if (live() && current.data.clickToToggle && !current.data.showControls) { if (media.paused) play(); else media.pause() } })
      listen('error', () => { releaseInterruption(); report('media-resource-unavailable', `媒体资源 ${current.data.assetId} 无法加载或解码，原始引用已保留。`) })
      const unsubscribeAudio = options.subscribeAudioChange?.(syncVolume)
      const update = (next: ComponentInstance<MediaData>) => {
        if (!live()) return
        if (next.id !== instance.id) throw new Error('媒体更新目标与挂载实例不一致')
        const previous = current.data
        current = { ...next, data: parse(next.data) }
        const data = current.data
        if (previous.startTime !== data.startTime || previous.endTime !== data.endTime) clipEnded = false
        delete media.dataset.mediaDiagnostic
        applyMediaPresentation(media, data, options.resolveAssetUrl)
        try { media.playbackRate = data.playbackRate }
        catch (error) { report('media-playback-rate-unavailable', `浏览器不支持当前播放速度：${error instanceof Error ? error.message : String(error)}`) }
        if (kind === 'video' && options.audioManager && !videoRegistration) videoRegistration = options.audioManager.registerVideo(media as HTMLVideoElement, { nodeId: instance.id, volume: data.volume, muted: data.muted })
        if (kind === 'audio' && options.audioManager && !audioRegistration && 'channel' in data) audioRegistration = options.audioManager.registerAudio(media as HTMLAudioElement, { nodeId: instance.id, soundId: instance.id, channel: data.channel, volume: data.volume, muted: data.muted })
        if (sourcePort && !sourceRegistration) sourceRegistration = sourcePort.register({
          kind, channel: 'channel' in data ? data.channel : 'video', volume: data.volume, muted: data.muted,
          initial: { paused: media.paused, currentTime: media.currentTime, loop: media.loop },
        }, async command => {
          if (!live()) return false
          try {
            if (command.type === 'play') return await play()
            if (command.type === 'pause') media.pause()
            else if (command.type === 'seek') {
              if (!seek(command.seconds)) return false
            } else if (command.type === 'loop') media.loop = command.value
            else {
              // These are effective values from the sole AudioManager, including
              // mute, channel mix, duck and fades. Do not multiply them again.
              media.volume = command.volume; media.muted = command.muted
            }
            reportState()
            return live()
          } catch (error) {
            report('media-command-unavailable', `媒体动作未完成：${error instanceof Error ? error.message : String(error)}`)
            return false
          }
        })
        syncVolume()
        if ('backgroundAudioMode' in data && 'backgroundAudioMode' in previous && data.backgroundAudioMode !== previous.backgroundAudioMode) {
          releaseInterruption()
          if (!media.paused) interruption = interruptBackground(data.backgroundAudioMode)
        }
        const url = options.resolveAssetUrl(data.assetId)
        if (url !== source) {
          sourceVersion++; clipEnded = false; hasStarted = false; media.pause(); releaseInterruption(); source = url
          if (url) media.src = url
          else media.removeAttribute('src')
        }
        if (!url) report('media-resource-missing', `媒体资源 ${data.assetId} 缺失，原始引用已保留。`)
        if ('poster' in data && data.poster.mode === 'image' && data.poster.assetId && !options.resolveAssetUrl(data.poster.assetId)) report('media-poster-missing', `视频封面 ${data.poster.assetId} 缺失，视频内容仍可使用。`, data.poster.assetId)
        reportState()
      }
      const dispose = () => {
        if (disposed) return
        disposed = true; sourceVersion++
        for (const [name, listener] of listeners) media.removeEventListener(name, listener)
        unsubscribeAudio?.(); releaseInterruption(); videoRegistration?.dispose(); audioRegistration?.dispose(); sourceRegistration?.dispose()
        media.pause(); media.removeAttribute('src'); media.load(); media.remove()
      }
      scope.cleanup(dispose)
      update(instance)
      return { update, dispose }
    },
  }
}

export function createAudioRuntimeImplementation(options: MediaRuntimeOptions): ComponentRuntimeImplementation<AudioData> {
  return createMediaRuntimeImplementation('audio', options) as ComponentRuntimeImplementation<AudioData>
}
export function createVideoRuntimeImplementation(options: MediaRuntimeOptions): ComponentRuntimeImplementation<VideoData> {
  return createMediaRuntimeImplementation('video', options) as ComponentRuntimeImplementation<VideoData>
}
