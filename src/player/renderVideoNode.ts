import * as Phaser from 'phaser'
import type { VideoInteractionAction } from '../shared/interactionTypes'
import type { VideoNode } from '../shared/contracts/native-v1/types'
import type {
  RuntimeEventDisposer,
  RuntimePresentationTransition,
} from '../shared/runtimeTypes'
import type {
  RenderedNodeHandle,
  RenderNodeContext,
  VideoNodeController,
} from './renderNode'

export interface VideoFitLayout {
  displayWidth: number
  displayHeight: number
  crop: {
    x: number
    y: number
    width: number
    height: number
  } | null
}

export interface VideoActionCommands {
  play(): boolean
  pause(): boolean
  restart(): boolean
  stop(): boolean
  toggle(): boolean
  seek(seconds: number): boolean
}

interface VideoEventDetail {
  nodeId: string
  sceneId: string
  seconds?: number
}

/** Centered object-fit math shared by the video frame and optional poster. */
export function calculateVideoFitLayout(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: VideoNode['fit'],
): VideoFitLayout {
  const sw = Math.max(1, sourceWidth)
  const sh = Math.max(1, sourceHeight)
  const tw = Math.max(1, targetWidth)
  const th = Math.max(1, targetHeight)
  if (fit === 'stretch') {
    return { displayWidth: tw, displayHeight: th, crop: null }
  }
  if (fit === 'contain') {
    const scale = Math.min(tw / sw, th / sh)
    return {
      displayWidth: sw * scale,
      displayHeight: sh * scale,
      crop: null,
    }
  }
  const sourceAspect = sw / sh
  const targetAspect = tw / th
  if (sourceAspect > targetAspect) {
    const width = sh * targetAspect
    return {
      displayWidth: tw,
      displayHeight: th,
      crop: { x: (sw - width) / 2, y: 0, width, height: sh },
    }
  }
  const height = sw / targetAspect
  return {
    displayWidth: tw,
    displayHeight: th,
    crop: { x: 0, y: (sh - height) / 2, width: sw, height },
  }
}

export function clampVideoSeekTime(
  seconds: number,
  startTime: number,
  endTime: number | null,
  duration = Number.POSITIVE_INFINITY,
): number {
  const start = Number.isFinite(startTime) ? Math.max(0, startTime) : 0
  const requested = Number.isFinite(seconds) ? seconds : start
  const authoredEnd = endTime !== null && Number.isFinite(endTime)
    ? Math.max(start, endTime)
    : Number.POSITIVE_INFINITY
  const mediaEnd = Number.isFinite(duration) && duration >= 0
    ? duration
    : Number.POSITIVE_INFINITY
  return Math.max(start, Math.min(requested, authoredEnd, mediaEnd))
}

export function executeVideoInteractionAction(
  action: VideoInteractionAction,
  nodeId: string,
  commands: VideoActionCommands,
  captureMode = false,
): boolean {
  if (action.nodeId !== nodeId) return false
  switch (action.type) {
    case 'video.play':
      return captureMode ? false : commands.play()
    case 'video.pause':
      return commands.pause()
    case 'video.restart':
      return captureMode ? false : commands.restart()
    case 'video.stop':
      return commands.stop()
    case 'video.toggle':
      return captureMode ? false : commands.toggle()
    case 'video.seek':
      return commands.seek(action.seconds)
  }
}

function applyNodeFrame(
  scene: Phaser.Scene,
  node: VideoNode,
  root: Phaser.GameObjects.Container,
  transition?: RuntimePresentationTransition,
): void {
  const x = node.x + node.width / 2
  const y = node.y + node.height / 2
  const duration = Math.max(0, Math.min(10_000, transition?.duration ?? 0))
  scene.tweens.killTweensOf(root)
  root.setSize(node.width, node.height)
  if (duration === 0) {
    root
      .setPosition(x, y)
      .setAngle(node.rotation)
      .setAlpha(node.opacity)
      .setVisible(node.visible)
    return
  }
  if (node.visible && !root.visible) root.setAlpha(0).setVisible(true)
  scene.tweens.add({
    targets: root,
    x,
    y,
    angle: node.rotation,
    alpha: node.visible ? node.opacity : 0,
    duration,
    ease: transition?.ease ?? 'Sine.easeInOut',
    onComplete: () => {
      if (root.active) root.setVisible(node.visible).setAlpha(node.opacity)
    },
  })
}

function safeCurrentTime(video: Phaser.GameObjects.Video): number {
  try {
    return video.getCurrentTime()
  } catch {
    return video.video?.currentTime ?? 0
  }
}

function safeDuration(video: Phaser.GameObjects.Video): number {
  try {
    return video.getDuration()
  } catch {
    return video.video?.duration ?? Number.POSITIVE_INFINITY
  }
}

export function renderVideoNode(
  scene: Phaser.Scene,
  initialNode: VideoNode,
  depth: number,
  context: RenderNodeContext,
): RenderedNodeHandle {
  let node = initialNode
  let destroyed = false
  let sourceAvailable = false
  let hasStarted = false
  let reportedPlaying = false
  let endedEmitted = false
  let primingFrame = false
  let hostVisible = context.scope === 'scene'
  let motionVisible = true
  let currentSceneId = context.sceneId ?? context.payload.project.scenes[0]?.id ?? ''
  let mediaElementCleanup: (() => void) | null = null
  let audioRegistration: ReturnType<NonNullable<RenderNodeContext['audio']>['registerVideo']> | null = null
  let backgroundAudioInterruption: ReturnType<
    NonNullable<RenderNodeContext['audio']>['beginBackgroundAudioInterruption']
  > | null = null
  let poster: Phaser.GameObjects.Image | null = null
  let posterAssetId: string | null = null
  const eventDisposers: RuntimeEventDisposer[] = []
  // Unified authoring shows the stable poster frame and never starts media.
  const captureMode = context.mode === 'capture' || context.authoring === true

  const root = scene.add
    .container(node.x + node.width / 2, node.y + node.height / 2)
    .setName(`node:${node.id}`)
    .setDepth(depth)
    .setAngle(node.rotation)
    .setAlpha(node.opacity)
    .setVisible(node.visible)
  root.setSize(node.width, node.height)
  context.parentRoot?.add(root)

  const background = scene.add
    .rectangle(0, 0, node.width, node.height, 0x05070b)
    .setOrigin(0.5)
  const video = scene.add.video(0, 0).setOrigin(0.5)
  const controls = scene.add.graphics()
  const interactionZone = scene.add
    .zone(0, 0, node.width, node.height)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
  const errorText = scene.add
    .text(0, 0, '', {
      color: '#fecaca',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: '18px',
      align: 'center',
      wordWrap: { width: Math.max(40, node.width - 32) },
    })
    .setOrigin(0.5)
    .setVisible(false)
  root.add([background, video, controls, interactionZone, errorText])

  const effectiveVisible = (): boolean => node.visible && hostVisible

  const emit = (eventName: string, seconds?: number): void => {
    if (captureMode || destroyed) return
    const detail: VideoEventDetail = {
      nodeId: node.id,
      sceneId: currentSceneId,
      ...(seconds === undefined ? {} : { seconds }),
    }
    context.events?.emit(eventName, detail)
  }

  const refreshPosterVisibility = (): void => {
    poster?.setVisible(captureMode || !hasStarted)
  }

  const redrawControls = (): void => {
    if (destroyed) return
    controls.clear()
    const playing = reportedPlaying || video.isPlaying()
    if (!node.showControls && (playing || !node.clickToToggle)) return
    if (node.showControls) {
      const barHeight = Math.min(34, Math.max(24, node.height * 0.1))
      const top = node.height / 2 - barHeight
      controls.fillStyle(0x020617, 0.82)
      controls.fillRect(-node.width / 2, top, node.width, barHeight)
      const progressLeft = -node.width / 2 + barHeight
      const progressWidth = Math.max(8, node.width - barHeight - 12)
      const start = Math.max(0, node.startTime)
      const duration = safeDuration(video)
      const end = node.endTime ?? (Number.isFinite(duration) ? duration : start)
      const range = Math.max(0.001, end - start)
      const progress = Phaser.Math.Clamp((safeCurrentTime(video) - start) / range, 0, 1)
      controls.fillStyle(0x64748b, 0.8)
      controls.fillRoundedRect(progressLeft, top + barHeight / 2 - 2, progressWidth, 4, 2)
      controls.fillStyle(0x60a5fa, 1)
      controls.fillRoundedRect(
        progressLeft,
        top + barHeight / 2 - 2,
        progressWidth * progress,
        4,
        2,
      )
      controls.fillStyle(0xffffff, 0.96)
      if (playing) {
        const x = -node.width / 2 + barHeight / 2
        const half = Math.max(4, barHeight * 0.18)
        controls.fillRect(x - half - 2, top + barHeight * 0.27, 4, barHeight * 0.46)
        controls.fillRect(x + half - 2, top + barHeight * 0.27, 4, barHeight * 0.46)
      } else {
        const x = -node.width / 2 + barHeight / 2
        controls.fillTriangle(
          x - 4,
          top + barHeight * 0.26,
          x - 4,
          top + barHeight * 0.74,
          x + 7,
          top + barHeight / 2,
        )
      }
    }
    if (!playing) {
      const radius = Math.max(18, Math.min(38, node.width / 9, node.height / 7))
      controls.fillStyle(0x020617, 0.72)
      controls.fillCircle(0, 0, radius)
      controls.fillStyle(0xffffff, 0.96)
      controls.fillTriangle(
        -radius * 0.22,
        -radius * 0.42,
        -radius * 0.22,
        radius * 0.42,
        radius * 0.48,
        0,
      )
    }
  }

  const syncInput = (): void => {
    interactionZone.setSize(node.width, node.height)
    if (interactionZone.input) {
      interactionZone.input.enabled =
        !captureMode &&
        effectiveVisible() &&
        motionVisible &&
        sourceAvailable &&
        (node.clickToToggle || node.showControls)
      const hitArea = interactionZone.input.hitArea
      if (hitArea instanceof Phaser.Geom.Rectangle) {
        hitArea.setSize(node.width, node.height)
      }
    }
  }

  const applyFit = (
    target: Phaser.GameObjects.Video | Phaser.GameObjects.Image,
    sourceWidth: number,
    sourceHeight: number,
  ): void => {
    const layout = calculateVideoFitLayout(
      sourceWidth,
      sourceHeight,
      node.width,
      node.height,
      node.fit,
    )
    try {
      if (layout.crop) {
        target.setCrop(
          layout.crop.x,
          layout.crop.y,
          layout.crop.width,
          layout.crop.height,
        )
      } else {
        target.setCrop()
      }
    } catch {
      // A video has no texture frame until its first decoded frame. The
      // VIDEO_CREATED listener reapplies the crop when that frame is ready.
    }
    target.setDisplaySize(layout.displayWidth, layout.displayHeight)
  }

  const applyVideoFit = (width?: number, height?: number): void => {
    const sourceWidth = width ?? video.video?.videoWidth ?? video.frame?.realWidth ?? node.width
    const sourceHeight = height ?? video.video?.videoHeight ?? video.frame?.realHeight ?? node.height
    applyFit(video, sourceWidth, sourceHeight)
  }

  const syncPoster = (): void => {
    const nextPosterId = node.poster.mode === 'image'
      ? node.poster.assetId ?? null
      : null
    if (nextPosterId !== posterAssetId) {
      poster?.destroy()
      poster = null
      posterAssetId = nextPosterId
      if (nextPosterId) {
        const textureKey = context.textureKey(nextPosterId)
        if (scene.textures.exists(textureKey)) {
          poster = scene.add.image(0, 0, textureKey).setOrigin(0.5)
          root.addAt(poster, 2)
        }
      }
    }
    if (poster) {
      const frame = poster.frame
      applyFit(poster, frame.realWidth, frame.realHeight)
      refreshPosterVisibility()
    }
  }

  const ensureAudioRegistration = (): void => {
    if (!context.audio || !video.video) return
    audioRegistration?.dispose()
    audioRegistration = context.audio.registerVideo(video.video, {
      nodeId: node.id,
      volume: node.volume,
      muted: node.muted,
    })
  }

  const releaseBackgroundAudioInterruption = (): void => {
    backgroundAudioInterruption?.release()
    backgroundAudioInterruption = null
  }

  const beginBackgroundAudioInterruption = (): void => {
    releaseBackgroundAudioInterruption()
    if (!context.audio || node.backgroundAudioMode === 'none') return
    backgroundAudioInterruption = context.audio.beginBackgroundAudioInterruption(
      node.backgroundAudioMode,
    )
  }

  const configureMedia = (): void => {
    video
      .setLoop(node.loop)
      .setMute(node.muted)
      .setVolume(Phaser.Math.Clamp(node.volume, 0, 1))
      .setPlaybackRate(Phaser.Math.Clamp(node.playbackRate, 0.25, 4))
    audioRegistration?.update({ volume: node.volume, muted: node.muted })
  }

  const seek = (seconds: number): boolean => {
    if (!sourceAvailable) return false
    const target = clampVideoSeekTime(
      seconds,
      node.startTime,
      node.endTime,
      safeDuration(video),
    )
    try {
      video.setCurrentTime(target)
      redrawControls()
      return true
    } catch {
      return false
    }
  }

  const beginPlayback = (restart: boolean): boolean => {
    if (captureMode || destroyed || !sourceAvailable || !effectiveVisible()) return false
    primingFrame = false
    if (restart) seek(node.startTime)
    configureMedia()
    if (node.endTime !== null && node.endTime > node.startTime) {
      video.play(node.loop, node.startTime, node.endTime)
    } else {
      video.play(node.loop)
    }
    redrawControls()
    return true
  }

  const pause = (): boolean => {
    if (!sourceAvailable) return false
    try {
      video.pause()
      releaseBackgroundAudioInterruption()
      redrawControls()
      return true
    } catch {
      return false
    }
  }

  const stop = (): boolean => {
    if (!sourceAvailable) return false
    try {
      video.stop(false)
      releaseBackgroundAudioInterruption()
      hasStarted = false
      reportedPlaying = false
      endedEmitted = false
      seek(node.startTime)
      refreshPosterVisibility()
      redrawControls()
      return true
    } catch {
      return false
    }
  }

  const commands: VideoActionCommands = {
    play: () => {
      if (captureMode || destroyed || !effectiveVisible()) return false
      if (video.isPaused() && hasStarted) {
        primingFrame = false
        video.resume()
        return true
      }
      return beginPlayback(false)
    },
    pause,
    restart: () => {
      if (!sourceAvailable) return false
      video.stop(false)
      releaseBackgroundAudioInterruption()
      return beginPlayback(true)
    },
    stop,
    toggle: () => video.isPlaying() ? pause() : commands.play(),
    seek,
  }

  const videoController: VideoNodeController = {
    execute(action): boolean {
      return executeVideoInteractionAction(
        action,
        node.id,
        commands,
        captureMode,
      )
    },
  }

  const bindMediaElement = (): void => {
    mediaElementCleanup?.()
    mediaElementCleanup = null
    const element = video.video
    if (!element) return
    const onPlaying = () => {
      if (primingFrame || captureMode || destroyed) return
      const firstForRun = !reportedPlaying
      hasStarted = true
      reportedPlaying = true
      endedEmitted = false
      if (firstForRun) beginBackgroundAudioInterruption()
      refreshPosterVisibility()
      redrawControls()
      if (firstForRun) emit('video:started')
    }
    const onPause = () => {
      if (primingFrame) {
        primingFrame = false
        redrawControls()
        return
      }
      if (!hasStarted || !reportedPlaying || captureMode || destroyed) return
      reportedPlaying = false
      releaseBackgroundAudioInterruption()
      redrawControls()
      emit('video:paused')
    }
    const onEnded = () => {
      if (endedEmitted || captureMode || destroyed) return
      endedEmitted = true
      reportedPlaying = false
      releaseBackgroundAudioInterruption()
      redrawControls()
      emit('video:ended')
    }
    const onTimeUpdate = () => {
      if (!hasStarted || captureMode || destroyed) return
      const seconds = safeCurrentTime(video)
      redrawControls()
      emit('video:time', seconds)
    }
    element.addEventListener('playing', onPlaying)
    element.addEventListener('pause', onPause)
    element.addEventListener('ended', onEnded)
    element.addEventListener('timeupdate', onTimeUpdate)
    mediaElementCleanup = () => {
      element.removeEventListener('playing', onPlaying)
      element.removeEventListener('pause', onPause)
      element.removeEventListener('ended', onEnded)
      element.removeEventListener('timeupdate', onTimeUpdate)
    }
  }

  const primePosterFrame = (): void => {
    if (!sourceAvailable || hasStarted) return
    const time = node.poster.mode === 'video-frame'
      ? node.poster.time
      : node.startTime
    seek(time)
    primingFrame = true
    try {
      video.getFirstFrame()
    } catch {
      primingFrame = false
    }
  }

  const loadSource = (): void => {
    releaseBackgroundAudioInterruption()
    sourceAvailable = false
    hasStarted = false
    reportedPlaying = false
    endedEmitted = false
    primingFrame = false
    mediaElementCleanup?.()
    mediaElementCleanup = null
    audioRegistration?.dispose()
    audioRegistration = null
    const asset = context.payload.assets[node.assetId]
    if (!asset) {
      errorText
        .setText(`视频素材缺失\n${node.name}`)
        .setVisible(true)
      syncInput()
      redrawControls()
      return
    }
    errorText.setVisible(false)
    try {
      video.loadURL(asset.dataUrl)
      sourceAvailable = Boolean(video.video)
      if (!sourceAvailable) {
        errorText
          .setText(`视频格式不受支持\n${node.name}`)
          .setVisible(true)
        syncInput()
        redrawControls()
        return
      }
      bindMediaElement()
      configureMedia()
      ensureAudioRegistration()
      applyVideoFit()
      if (!captureMode && node.autoplay && effectiveVisible()) {
        beginPlayback(true)
      } else {
        primePosterFrame()
      }
    } catch (error) {
      console.error(`视频“${node.name}”加载失败`, error)
      sourceAvailable = false
      errorText
        .setText(`视频加载失败\n${node.name}`)
        .setVisible(true)
    }
    syncInput()
    redrawControls()
  }

  const onVideoCreated = (
    _video: Phaser.GameObjects.Video,
    width: number,
    height: number,
  ): void => {
    applyVideoFit(width, height)
    ensureAudioRegistration()
  }
  const onVideoMetadata = (): void => {
    configureMedia()
    ensureAudioRegistration()
    if (!hasStarted && (captureMode || !node.autoplay || !effectiveVisible())) {
      primePosterFrame()
    }
  }
  const onVideoComplete = (): void => {
    if (endedEmitted || captureMode || destroyed) return
    endedEmitted = true
    reportedPlaying = false
    releaseBackgroundAudioInterruption()
    redrawControls()
    emit('video:ended')
  }
  const onVideoError = (): void => {
    if (destroyed) return
    errorText
      .setText(`视频无法播放\n${node.name}`)
      .setVisible(true)
  }
  video.on(Phaser.GameObjects.Events.VIDEO_CREATED, onVideoCreated)
  video.on(Phaser.GameObjects.Events.VIDEO_METADATA, onVideoMetadata)
  video.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, onVideoComplete)
  video.on(Phaser.GameObjects.Events.VIDEO_ERROR, onVideoError)

  const activate = (): void => {
    if (
      captureMode ||
      !effectiveVisible() ||
      (!node.clickToToggle && !node.showControls)
    ) {
      return
    }
    commands.toggle()
  }
  interactionZone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, activate)

  if (context.events) {
    eventDisposers.push(
      context.events.on<{ sceneId?: string }>('scene:enter', (detail) => {
        if (detail?.sceneId) currentSceneId = detail.sceneId
      }),
    )
  }

  syncPoster()
  loadSource()
  background.setSize(node.width, node.height)
  syncInput()
  redrawControls()

  return {
    id: initialNode.id,
    type: initialNode.type,
    root,
    videoController,
    setHostVisible(visible): void {
      if (destroyed || hostVisible === visible) return
      hostVisible = visible
      if (!effectiveVisible()) {
        pause()
      } else if (node.autoplay && !captureMode) {
        commands.play()
      }
      syncInput()
    },
    setMotionVisible(visible): void {
      if (destroyed) return
      motionVisible = visible
      root.setVisible(visible && effectiveVisible())
      syncInput()
    },
    update(nextNode, transition): void {
      if (
        destroyed ||
        nextNode.type !== 'video' ||
        nextNode.id !== initialNode.id
      ) {
        return
      }
      const previous = node
      const backgroundAudioModeChanged =
        previous.backgroundAudioMode !== nextNode.backgroundAudioMode
      const sourceChanged = previous.assetId !== nextNode.assetId
      const posterChanged =
        previous.poster.mode !== nextNode.poster.mode ||
        previous.poster.assetId !== nextNode.poster.assetId ||
        previous.poster.time !== nextNode.poster.time
      node = nextNode
      if (backgroundAudioModeChanged && reportedPlaying && !sourceChanged) {
        beginBackgroundAudioInterruption()
      }
      background.setSize(node.width, node.height)
      errorText.setWordWrapWidth(Math.max(40, node.width - 32), false)
      if (posterChanged) syncPoster()
      if (sourceChanged) {
        loadSource()
      } else {
        configureMedia()
        applyVideoFit()
        syncPoster()
      }
      if (!effectiveVisible()) {
        pause()
      } else if (!previous.visible && node.visible && node.autoplay && !captureMode) {
        commands.play()
      }
      syncInput()
      redrawControls()
      applyNodeFrame(scene, node, root, transition)
    },
    destroy(): void {
      if (destroyed) return
      releaseBackgroundAudioInterruption()
      destroyed = true
      interactionZone.off(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, activate)
      video.off(Phaser.GameObjects.Events.VIDEO_CREATED, onVideoCreated)
      video.off(Phaser.GameObjects.Events.VIDEO_METADATA, onVideoMetadata)
      video.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, onVideoComplete)
      video.off(Phaser.GameObjects.Events.VIDEO_ERROR, onVideoError)
      eventDisposers.splice(0).forEach((dispose) => dispose())
      mediaElementCleanup?.()
      mediaElementCleanup = null
      audioRegistration?.dispose()
      audioRegistration = null
      scene.tweens.killTweensOf(root)
      if (root.active) root.destroy(true)
    },
  }
}
