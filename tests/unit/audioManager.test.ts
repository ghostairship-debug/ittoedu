import { describe, expect, it, vi } from 'vitest'
import { AudioManager } from '@/player/AudioManager'
import { CourseEventBus } from '@/player/CourseEventBus'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

class FakeAudioElement extends EventTarget {
  preload = ''
  loop = false
  muted = false
  volume = 1
  currentTime = 0
  src = ''
  playCalls = 0
  pauseCalls = 0
  loadCalls = 0
  nextPlayError: Error | null = null

  play(): Promise<void> {
    this.playCalls += 1
    if (this.nextPlayError) {
      const error = this.nextPlayError
      this.nextPlayError = null
      return Promise.reject(error)
    }
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }

  pause(): void {
    this.pauseCalls += 1
    this.dispatchEvent(new Event('pause'))
  }

  load(): void {
    this.loadCalls += 1
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
}

function testProject() {
  const project = createBlankCourseProject({
    id: 'audio-project',
    includeDefaultController: false,
    controls: 'none',
  })
  Object.assign(project, {
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 0.8,
        channelVolumes: {
          music: 0.5,
          narration: 1,
          sfx: 0.75,
          ui: 1,
          video: 0.6,
        },
        sounds: {
          music: {
            id: 'music',
            name: '背景音乐',
            assetId: 'asset-music',
            channel: 'music',
            defaultVolume: 0.5,
            defaultLoop: true,
          },
          narration: {
            id: 'narration',
            name: '旁白',
            assetId: 'asset-narration',
            channel: 'narration',
            defaultVolume: 1,
            defaultLoop: false,
          },
          click: {
            id: 'click',
            name: '点击音',
            assetId: 'asset-click',
            channel: 'sfx',
            defaultVolume: 1,
            defaultLoop: false,
          },
          hover: {
            id: 'hover',
            name: '界面音',
            assetId: 'asset-hover',
            channel: 'ui',
            defaultVolume: 1,
            defaultLoop: false,
          },
        },
        narrationDucking: {
          enabled: true,
          musicVolume: 0.25,
          fadeMs: 0,
        },
      },
    },
  })
  return project
}

function harness(options: {
  mode?: 'preview' | 'capture'
  maxConcurrent?: Partial<Record<'sfx' | 'ui', number>>
  unlockTarget?: EventTarget
  duckFadeMs?: number
} = {}) {
  const events = new CourseEventBus()
  const created: FakeAudioElement[] = []
  let nextPlayError: Error | null = null
  const project = testProject()
  if (options.duckFadeMs !== undefined) {
    project.media.audio.narrationDucking.fadeMs = options.duckFadeMs
  }
  const manager = new AudioManager(
    project,
    (assetId) => `data:audio/mock,${assetId}`,
    events,
    {
      ...options,
      createAudio: (source) => {
        const audio = new FakeAudioElement()
        audio.src = source
        audio.nextPlayError = nextPlayError
        nextPlayError = null
        created.push(audio)
        return audio as unknown as HTMLAudioElement
      },
    },
  )
  return {
    manager,
    events,
    created,
    rejectNextPlay(error: Error) {
      nextPlayError = error
    },
  }
}

describe('AudioManager', () => {
  it('解析 soundId，并组合声音、主音量和声道音量', () => {
    const { manager, created, events } = harness()
    const played = vi.fn()
    events.on('audio:play', played)

    expect(manager.play('music')).toBe(true)
    expect(manager.play('missing')).toBe(false)
    expect(created).toHaveLength(1)
    expect(created[0]!.src).toContain('asset-music')
    expect(created[0]!.loop).toBe(true)
    expect(created[0]!.volume).toBeCloseTo(0.5 * 0.8 * 0.5)
    expect(played).toHaveBeenCalledWith(expect.objectContaining({
      soundId: 'music',
      channel: 'music',
      lifetime: 'course',
    }))
  })

  it('对 music 和 narration 保持单实例，并按策略继续或重播', () => {
    const { manager, created } = harness()
    expect(manager.play('music')).toBe(true)
    const music = created[0]!

    expect(manager.play('music', { ifPlaying: 'ignore' })).toBe(true)
    expect(created).toHaveLength(1)
    expect(music.playCalls).toBe(1)

    music.currentTime = 12
    expect(manager.play('music', { ifPlaying: 'restart' })).toBe(true)
    expect(music.currentTime).toBe(0)
    expect(music.playCalls).toBe(2)

    expect(manager.play('narration')).toBe(true)
    const firstNarration = created[1]!
    expect(manager.play('narration', { ifPlaying: 'restart' })).toBe(true)
    expect(created).toHaveLength(2)
    expect(firstNarration.playCalls).toBe(2)
  })

  it('限制 sfx/ui 并发并停止最旧实例', () => {
    const { manager, created, events } = harness({
      maxConcurrent: { sfx: 2 },
    })
    const stopped = vi.fn()
    events.on('audio:stop', stopped)

    manager.play('click')
    manager.play('click')
    manager.play('click')

    expect(created).toHaveLength(3)
    expect(created[0]!.pauseCalls).toBe(1)
    expect(created[0]!.loadCalls).toBe(1)
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('支持总静音、主音量、声道音量和 narration ducking', () => {
    const { manager, created, events } = harness()
    const changes = vi.fn()
    events.on('audio:change', changes)
    manager.play('music')
    const music = created[0]!
    manager.play('narration')

    expect(music.volume).toBeCloseTo(0.5 * 0.8 * 0.5 * 0.25)
    manager.setMasterVolume(0.5)
    manager.setChannelVolume('music', 0.25)
    manager.setMuted(true)

    expect(music.volume).toBeCloseTo(0.5 * 0.5 * 0.25 * 0.25)
    expect(music.muted).toBe(true)
    expect(manager.toggleMuted()).toBe(false)
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({
      muted: false,
      masterVolume: 0.5,
      channelVolumes: expect.objectContaining({ music: 0.25 }),
    }))

    created[1]!.dispatchEvent(new Event('ended'))
    expect(music.volume).toBeCloseTo(0.5 * 0.5 * 0.25)
  })

  it('按 scene/course lifetime 清理，并发布 pause/stop/ended 事件', () => {
    const { manager, created, events } = harness()
    const paused = vi.fn()
    const stopped = vi.fn()
    const ended = vi.fn()
    events.on('audio:pause', paused)
    events.on('audio:stop', stopped)
    events.on('audio:ended', ended)

    events.emit('scene:enter', { sceneId: 'scene-1' })
    manager.play('music')
    manager.play('click')
    expect(manager.pause({ kind: 'sound', soundId: 'click' })).toBe(true)
    expect(paused).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'click' }))

    events.emit('scene:leave', { sceneId: 'scene-1' })
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'click' }))
    expect(created[0]!.pauseCalls).toBe(0)

    created[0]!.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'music' }))
  })

  it('自动播放被阻止时仅保留 music/narration，并可在手势后重试', async () => {
    const target = document.createElement('div')
    const { manager, created, events, rejectNextPlay } = harness({ unlockTarget: target })
    const blocked = vi.fn()
    events.on('audio:blocked', blocked)

    rejectNextPlay(new DOMException('gesture required', 'NotAllowedError'))
    manager.play('music')
    await Promise.resolve()
    expect(blocked).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'music' }))

    target.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    expect(created[0]!.playCalls).toBe(2)

    const transient = harness()
    const stopped = vi.fn()
    transient.events.on('audio:stop', stopped)
    transient.rejectNextPlay(new DOMException('gesture required', 'NotAllowedError'))
    transient.manager.play('click')
    await Promise.resolve()
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'click' }))
  })

  it('把注册视频纳入总静音和 video 声道音量', () => {
    const { manager } = harness()
    const video = { muted: false, volume: 1 } as HTMLVideoElement
    const registration = manager.registerVideo(video, {
      nodeId: 'video-1',
      volume: 0.5,
    })

    expect(video.volume).toBeCloseTo(0.5 * 0.8 * 0.6)
    manager.setMuted(true)
    expect(video.muted).toBe(true)
    registration.update({ muted: true, volume: 0.25 })
    manager.setMuted(false)
    expect(video.muted).toBe(true)
    expect(video.volume).toBeCloseTo(0.25 * 0.8 * 0.6)

    registration.dispose()
    manager.setChannelVolume('video', 0.1)
    expect(video.volume).toBeCloseTo(0.25 * 0.8 * 0.6)
  })

  it('视频 duck 使用临时乘数，释放后保留用户在期间修改的音乐声道音量', () => {
    const { manager, created } = harness()
    manager.play('music')
    const music = created[0]!
    const interruption = manager.beginBackgroundAudioInterruption('duck')

    expect(music.volume).toBeCloseTo(0.5 * 0.8 * 0.5 * 0.25)
    manager.setChannelVolume('music', 0.2)
    expect(music.volume).toBeCloseTo(0.5 * 0.8 * 0.2 * 0.25)

    interruption.release()
    interruption.release()
    expect(manager.channelVolume('music')).toBe(0.2)
    expect(music.volume).toBeCloseTo(0.5 * 0.8 * 0.2)
  })

  it('视频 pause 支持并发令牌，只恢复被它暂停且未被用户再次暂停的音乐', () => {
    const { manager, created } = harness()
    manager.play('music')
    const music = created[0]!
    const first = manager.beginBackgroundAudioInterruption('pause')
    const second = manager.beginBackgroundAudioInterruption('pause')

    expect(music.pauseCalls).toBe(1)
    first.release()
    expect(music.playCalls).toBe(1)
    second.release()
    expect(music.playCalls).toBe(2)

    const third = manager.beginBackgroundAudioInterruption('pause')
    expect(music.pauseCalls).toBe(2)
    manager.pause({ kind: 'channel', channel: 'music' })
    third.release()
    expect(music.playCalls).toBe(2)
  })

  it('视频 stop 永久停止当时的背景音乐，释放时不恢复', () => {
    const { manager, created, events } = harness()
    const stopped = vi.fn()
    events.on('audio:stop', stopped)
    manager.play('music')
    const music = created[0]!

    const interruption = manager.beginBackgroundAudioInterruption('stop')
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'music' }))
    expect(music.pauseCalls).toBe(1)
    interruption.release()
    expect(music.playCalls).toBe(1)
    expect(manager.resume({ kind: 'channel', channel: 'music' })).toBe(false)
  })

  it('兑现播放淡入和停止淡出，并由新播放动作取消旧渐变', () => {
    vi.useFakeTimers()
    try {
      const { manager, created, events } = harness()
      const stopped = vi.fn()
      events.on('audio:stop', stopped)
      expect(manager.execute({
        type: 'audio.play',
        soundId: 'music',
        fadeInMs: 100,
      })).toBe(true)
      const music = created[0]!
      const fullVolume = 0.5 * 0.8 * 0.5
      expect(music.volume).toBe(0)

      vi.advanceTimersByTime(50)
      expect(music.volume).toBeGreaterThan(0)
      expect(music.volume).toBeLessThan(fullVolume)
      const beforeFadeOut = music.volume
      manager.execute({
        type: 'audio.stop',
        target: { kind: 'sound', soundId: 'music' },
        fadeOutMs: 100,
      })
      vi.advanceTimersByTime(50)
      expect(music.volume).toBeLessThan(beforeFadeOut)
      expect(stopped).not.toHaveBeenCalled()

      manager.execute({
        type: 'audio.play',
        soundId: 'music',
        ifPlaying: 'continue',
        fadeInMs: 40,
      })
      expect(music.volume).toBe(0)
      vi.advanceTimersByTime(40)
      expect(music.volume).toBeCloseTo(fullVolume)
      expect(stopped).not.toHaveBeenCalled()

      manager.stop({ kind: 'sound', soundId: 'music' }, 80)
      vi.advanceTimersByTime(80)
      expect(stopped).toHaveBeenCalledOnce()
      expect(music.loadCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('兑现暂停淡出、恢复淡入与旁白 ducking 淡变', () => {
    vi.useFakeTimers()
    try {
      const { manager, created, events } = harness({ duckFadeMs: 100 })
      const paused = vi.fn()
      events.on('audio:pause', paused)
      manager.play('music')
      const music = created[0]!
      const fullVolume = 0.5 * 0.8 * 0.5

      manager.play('narration')
      expect(music.volume).toBeCloseTo(fullVolume)
      vi.advanceTimersByTime(50)
      expect(music.volume).toBeLessThan(fullVolume)
      expect(music.volume).toBeGreaterThan(fullVolume * 0.25)
      vi.advanceTimersByTime(50)
      expect(music.volume).toBeCloseTo(fullVolume * 0.25)

      manager.pause({ kind: 'sound', soundId: 'narration' })
      vi.advanceTimersByTime(100)
      expect(music.volume).toBeCloseTo(fullVolume)

      manager.pause({ kind: 'sound', soundId: 'music' }, 60)
      vi.advanceTimersByTime(59)
      expect(paused).not.toHaveBeenCalledWith(expect.objectContaining({ soundId: 'music' }))
      vi.advanceTimersByTime(1)
      expect(paused).toHaveBeenCalledWith(expect.objectContaining({ soundId: 'music' }))
      expect(music.volume).toBe(0)

      manager.resume({ kind: 'sound', soundId: 'music' }, 60)
      expect(music.volume).toBe(0)
      vi.advanceTimersByTime(60)
      expect(music.volume).toBeCloseTo(fullVolume)
    } finally {
      vi.useRealTimers()
    }
  })

  it('destroy 会取消仍在运行的声音和 duck 渐变定时器', () => {
    vi.useFakeTimers()
    try {
      const { manager } = harness({ duckFadeMs: 1_000 })
      manager.play('music', { fadeInMs: 1_000 })
      manager.beginBackgroundAudioInterruption('duck')
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      manager.destroy()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('可直接执行交互动作，并支持暂停、恢复和目标静音', () => {
    const { manager, created } = harness()
    expect(manager.execute({ type: 'audio.play', soundId: 'click' })).toBe(true)
    const click = created[0]!

    expect(manager.execute({
      type: 'audio.pause',
      target: { kind: 'channel', channel: 'sfx' },
    })).toBe(true)
    expect(click.pauseCalls).toBe(1)
    expect(manager.execute({
      type: 'audio.resume',
      target: { kind: 'sound', soundId: 'click' },
    })).toBe(true)
    expect(click.playCalls).toBe(2)

    expect(manager.execute({
      type: 'audio.toggle-mute',
      target: { kind: 'sound', soundId: 'click' },
    })).toBe(true)
    expect(click.muted).toBe(true)
    manager.execute({
      type: 'audio.toggle-mute',
      target: { kind: 'sound', soundId: 'click' },
    })
    expect(click.muted).toBe(false)
  })

  it('capture 模式不创建或播放声音，并强制注册视频静音', () => {
    const { manager, created } = harness({ mode: 'capture' })
    expect(manager.play('music')).toBe(false)
    expect(created).toHaveLength(0)

    const video = { muted: false, volume: 1 } as HTMLVideoElement
    manager.registerVideo(video, { nodeId: 'video-capture' })
    expect(video.muted).toBe(true)
  })

  it('destroy 幂等清理声音、视频和事件订阅', () => {
    const { manager, created, events } = harness()
    manager.play('music')
    expect(events.listenerCount()).toBeGreaterThan(0)

    manager.destroy()
    manager.destroy()
    expect(created[0]!.pauseCalls).toBe(1)
    expect(events.listenerCount()).toBe(0)
    expect(manager.play('music')).toBe(false)
  })
})
