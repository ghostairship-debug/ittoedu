import * as Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import type { RenderNodeContext } from '@/player/renderNode'
import {
  calculateVideoFitLayout,
  clampVideoSeekTime,
  executeVideoInteractionAction,
  renderVideoNode,
  type VideoActionCommands,
} from '@/player/renderVideoNode'
import { CourseEventBus } from '@/player/CourseEventBus'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createVideoNode } from '@/renderer/project/nativeNodeFactories'

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) =>
      globalThis.Math.max(min, globalThis.Math.min(max, value)),
  },
  Geom: {
    Rectangle: class Rectangle {
      setSize(): this { return this }
    },
  },
  GameObjects: {
    Events: {
      VIDEO_CREATED: 'videocreated',
      VIDEO_METADATA: 'videometadata',
      VIDEO_COMPLETE: 'videocomplete',
      VIDEO_ERROR: 'videoerror',
    },
  },
  Input: {
    Events: {
      GAMEOBJECT_POINTER_UP: 'pointerup',
    },
  },
}))

type Listener = (...args: unknown[]) => void

class FakeObject {
  active = true
  visible = true
  alpha = 1
  x = 0
  y = 0
  width = 0
  height = 0
  displayWidth = 0
  displayHeight = 0
  input: { enabled: boolean; hitArea: unknown } | null = null

  setName(): this { return this }
  setDepth(): this { return this }
  setAngle(): this { return this }
  setAlpha(value: number): this { this.alpha = value; return this }
  setVisible(value: boolean): this { this.visible = value; return this }
  setOrigin(): this { return this }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this }
  setSize(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }
  setDisplaySize(width: number, height: number): this {
    this.displayWidth = width
    this.displayHeight = height
    return this
  }
  setCrop(): this { return this }
  setInteractive(): this {
    this.input = { enabled: true, hitArea: {} }
    return this
  }
  destroy(): void { this.active = false }
}

class FakeEmitterObject extends FakeObject {
  private readonly listeners = new Map<string, Set<Listener>>()

  on(eventName: string, listener: Listener): this {
    const listeners = this.listeners.get(eventName) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(eventName, listeners)
    return this
  }
  off(eventName: string, listener: Listener): this {
    this.listeners.get(eventName)?.delete(listener)
    return this
  }
  emit(eventName: string, ...args: unknown[]): void {
    this.listeners.get(eventName)?.forEach((listener) => listener(...args))
  }
}

class FakeContainer extends FakeObject {
  readonly list: unknown[] = []

  add(children: unknown | unknown[]): this {
    this.list.push(...(Array.isArray(children) ? children : [children]))
    return this
  }
  addAt(child: unknown, index: number): this {
    this.list.splice(index, 0, child)
    return this
  }
  override destroy(): void {
    super.destroy()
    this.list.forEach((child) => {
      if (typeof child === 'object' && child && 'destroy' in child) {
        ;(child as { destroy(): void }).destroy()
      }
    })
  }
}

class FakeGraphics extends FakeObject {
  clear(): this { return this }
  fillStyle(): this { return this }
  fillRect(): this { return this }
  fillRoundedRect(): this { return this }
  fillCircle(): this { return this }
  fillTriangle(): this { return this }
}

class FakeText extends FakeObject {
  text = ''
  setText(value: string): this { this.text = value; return this }
  setWordWrapWidth(): this { return this }
}

class FakeMediaElement extends EventTarget {
  currentTime = 0
  duration = 20
  videoWidth = 1920
  videoHeight = 1080
}

class FakeVideo extends FakeEmitterObject {
  readonly element = new FakeMediaElement()
  video = this.element as unknown as HTMLVideoElement
  frame = { realWidth: 1920, realHeight: 1080 }
  playing = false
  paused = true
  loop = false
  muted = false
  volume = 1
  playbackRate = 1
  loadURL = vi.fn((_url: string) => this)
  getFirstFrame = vi.fn(() => this)
  setLoop = vi.fn((value: boolean) => { this.loop = value; return this })
  setMute = vi.fn((value: boolean) => { this.muted = value; return this })
  setVolume = vi.fn((value: number) => { this.volume = value; return this })
  setPlaybackRate = vi.fn((value: number) => { this.playbackRate = value; return this })
  play = vi.fn((_loop?: boolean, _start?: number, _end?: number) => {
    this.playing = true
    this.paused = false
    this.element.dispatchEvent(new Event('playing'))
    return this
  })
  pause = vi.fn(() => {
    this.playing = false
    this.paused = true
    this.element.dispatchEvent(new Event('pause'))
    return this
  })
  resume = vi.fn(() => {
    this.playing = true
    this.paused = false
    this.element.dispatchEvent(new Event('playing'))
    return this
  })
  stop = vi.fn(() => {
    this.playing = false
    this.paused = true
    this.element.dispatchEvent(new Event('pause'))
    return this
  })
  setCurrentTime = vi.fn((value: number) => {
    this.element.currentTime = value
    return this
  })
  getCurrentTime(): number { return this.element.currentTime }
  getDuration(): number { return this.element.duration }
  isPlaying(): boolean { return this.playing }
  isPaused(): boolean { return this.paused }
}

function sceneHarness() {
  const video = new FakeVideo()
  const roots: FakeContainer[] = []
  const scene = {
    add: {
      container: (x: number, y: number) => {
        const root = new FakeContainer().setPosition(x, y)
        roots.push(root)
        return root
      },
      rectangle: () => new FakeObject(),
      video: () => video,
      graphics: () => new FakeGraphics(),
      zone: () => new FakeEmitterObject(),
      text: () => new FakeText(),
      image: () => new FakeObject(),
    },
    textures: {
      exists: () => false,
    },
    tweens: {
      killTweensOf: vi.fn(),
      add: vi.fn(),
    },
  } as unknown as Phaser.Scene
  return { scene, video, roots }
}

function contextHarness(events: CourseEventBus) {
  const project = createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => 'fixed',
  })
  const registration = { update: vi.fn(), dispose: vi.fn() }
  const registerVideo = vi.fn(() => registration)
  const interruptionReleases: ReturnType<typeof vi.fn>[] = []
  const beginBackgroundAudioInterruption = vi.fn(() => {
    const release = vi.fn()
    interruptionReleases.push(release)
    return { release }
  })
  const sceneId = project.startLocationId
  const context = {
    payload: {
      project,
      assets: {
        asset_video: {
          mimeType: 'video/mp4',
          dataUrl: 'data:video/mp4;base64,AAAA',
        },
      },
      components: {},
    },
    registry: {},
    actions: {},
    scope: 'scene',
    events,
    audio: { registerVideo, beginBackgroundAudioInterruption },
    mode: 'preview',
    sceneId,
    textureKey: (assetId: string) => `asset:${assetId}`,
  } as unknown as RenderNodeContext
  return {
    context,
    registration,
    registerVideo,
    beginBackgroundAudioInterruption,
    interruptionReleases,
    sceneId,
  }
}

describe('video layout and action routing', () => {
  it('计算 contain 与 cover 布局', () => {
    expect(calculateVideoFitLayout(1920, 1080, 100, 100, 'contain')).toMatchObject({
      displayWidth: 100,
      displayHeight: 56.25,
      crop: null,
    })
    expect(calculateVideoFitLayout(1920, 1080, 100, 100, 'cover')).toMatchObject({
      displayWidth: 100,
      displayHeight: 100,
      crop: { x: 420, y: 0, width: 1080, height: 1080 },
    })
  })

  it('把 seek 限定在作者设置的播放区间', () => {
    expect(clampVideoSeekTime(-1, 2, 8, 20)).toBe(2)
    expect(clampVideoSeekTime(12, 2, 8, 20)).toBe(8)
    expect(clampVideoSeekTime(7, 2, null, 6)).toBe(6)
  })

  it('只向匹配节点路由动作，capture 禁止启动播放', () => {
    const commands = Object.fromEntries(
      ['play', 'pause', 'restart', 'stop', 'toggle', 'seek'].map((name) => [
        name,
        vi.fn(() => true),
      ]),
    ) as unknown as VideoActionCommands
    expect(executeVideoInteractionAction(
      { type: 'video.play', nodeId: 'other' },
      'video-1',
      commands,
    )).toBe(false)
    expect(executeVideoInteractionAction(
      { type: 'video.seek', nodeId: 'video-1', seconds: 4 },
      'video-1',
      commands,
    )).toBe(true)
    expect(commands.seek).toHaveBeenCalledWith(4)
    expect(executeVideoInteractionAction(
      { type: 'video.play', nodeId: 'video-1' },
      'video-1',
      commands,
      true,
    )).toBe(false)
    expect(commands.play).not.toHaveBeenCalled()
  })
})

describe('renderVideoNode', () => {
  it('加载 data URL、注册音频、执行动作并发布视频事件', () => {
    const events = new CourseEventBus()
    const started = vi.fn()
    const paused = vi.fn()
    const ended = vi.fn()
    const timed = vi.fn()
    events.on('video:started', started)
    events.on('video:paused', paused)
    events.on('video:ended', ended)
    events.on('video:time', timed)
    const { scene, video, roots } = sceneHarness()
    const { context, registration, registerVideo, sceneId } = contextHarness(events)
    const node = createVideoNode({
      id: 'video-1',
      assetId: 'asset_video',
      autoplay: false,
      loop: true,
      muted: false,
      volume: 0.65,
      playbackRate: 1.25,
      startTime: 2,
      endTime: 8,
      clickToToggle: true,
    })

    const handle = renderVideoNode(scene, node, 3, context)
    expect(video.loadURL).toHaveBeenCalledWith('data:video/mp4;base64,AAAA')
    expect(video.getFirstFrame).toHaveBeenCalledOnce()
    expect(video.setLoop).toHaveBeenCalledWith(true)
    expect(video.setVolume).toHaveBeenCalledWith(0.65)
    expect(video.setPlaybackRate).toHaveBeenCalledWith(1.25)
    expect(registerVideo).toHaveBeenCalledWith(video.video, {
      nodeId: node.id,
      volume: 0.65,
      muted: false,
    })

    expect(handle.videoController?.execute({
      type: 'video.play',
      nodeId: node.id,
    })).toBe(true)
    expect(video.play).toHaveBeenLastCalledWith(true, 2, 8)
    expect(started).toHaveBeenCalledWith({ nodeId: node.id, sceneId })

    video.element.currentTime = 4.5
    video.element.dispatchEvent(new Event('timeupdate'))
    expect(timed).toHaveBeenCalledWith({
      nodeId: node.id,
      sceneId,
      seconds: 4.5,
    })
    handle.videoController?.execute({ type: 'video.pause', nodeId: node.id })
    expect(paused).toHaveBeenCalledWith({ nodeId: node.id, sceneId })
    video.emit(Phaser.GameObjects.Events.VIDEO_COMPLETE, video)
    expect(ended).toHaveBeenCalledWith({ nodeId: node.id, sceneId })

    handle.update({ ...node, visible: false })
    expect(video.pause).toHaveBeenCalled()
    handle.destroy()
    expect(registration.dispose).toHaveBeenCalled()
    expect(roots[0]!.active).toBe(false)
  })

  it('capture 模式只请求封面帧且拒绝播放动作', () => {
    const events = new CourseEventBus()
    const { scene, video } = sceneHarness()
    const { context } = contextHarness(events)
    context.mode = 'capture'
    const node = createVideoNode({
      id: 'video-capture',
      assetId: 'asset_video',
      autoplay: true,
    })

    const handle = renderVideoNode(scene, node, 0, context)
    expect(video.getFirstFrame).toHaveBeenCalledOnce()
    expect(video.play).not.toHaveBeenCalled()
    expect(handle.videoController?.execute({
      type: 'video.play',
      nodeId: node.id,
    })).toBe(false)
    expect(video.play).not.toHaveBeenCalled()
  })

  it('按视频播放生命周期获取并释放背景音乐处理句柄', () => {
    const events = new CourseEventBus()
    const { scene, video } = sceneHarness()
    const {
      context,
      beginBackgroundAudioInterruption,
      interruptionReleases,
    } = contextHarness(events)
    const node = createVideoNode({
      id: 'video-background-audio',
      assetId: 'asset_video',
      backgroundAudioMode: 'duck',
    })
    const handle = renderVideoNode(scene, node, 0, context)

    handle.videoController?.execute({ type: 'video.play', nodeId: node.id })
    expect(beginBackgroundAudioInterruption).toHaveBeenCalledWith('duck')
    expect(interruptionReleases).toHaveLength(1)

    handle.videoController?.execute({ type: 'video.pause', nodeId: node.id })
    expect(interruptionReleases[0]).toHaveBeenCalledTimes(1)
    handle.videoController?.execute({ type: 'video.play', nodeId: node.id })
    expect(interruptionReleases).toHaveLength(2)
    video.element.dispatchEvent(new Event('ended'))
    expect(interruptionReleases[1]).toHaveBeenCalledTimes(1)

    handle.videoController?.execute({ type: 'video.play', nodeId: node.id })
    expect(interruptionReleases).toHaveLength(3)
    handle.destroy()
    expect(interruptionReleases[2]).toHaveBeenCalledTimes(1)
  })
})
