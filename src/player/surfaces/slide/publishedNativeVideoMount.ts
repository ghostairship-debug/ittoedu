import type {
  VideoInteractionAction,
} from '../../../shared/contracts/interaction-v1/types'
import type {
  ReadonlyNativeRenderInput,
} from '../../../shared/contracts/native-v1/types'
import type {
  AudioManager,
  BackgroundAudioInterruption,
  VideoAudioRegistration,
} from '../../AudioManager'

export type PublishedVideoInput = Extract<
  ReadonlyNativeRenderInput,
  { readonly type: 'video' }
>

export type PublishedVideoEventKind = 'started' | 'paused' | 'ended' | 'time'

export type PublishedVideoEventListener = (seconds?: number) => void

export interface PublishedNativeVideoHandle {
  readonly nodeId: string
  readonly element: HTMLVideoElement
  /** Formal autoplay flag; the Slide host decides when an autoplay may run. */
  readonly autoplay: boolean
  execute(action: VideoInteractionAction): boolean
  subscribe(kind: PublishedVideoEventKind, listener: PublishedVideoEventListener): () => void
  pause(): void
  destroy(): void
}

export interface PublishedNativeVideoMountOptions {
  /** Capture/authoring stays inert: no playback, no events. */
  capture?: boolean
  /** Whole-course audio owner; never created or copied by the Slide host. */
  audio?: Pick<AudioManager, 'registerVideo' | 'beginBackgroundAudioInterruption'>
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.25, Math.min(4, value))
}

function clampSeekTime(
  seconds: number,
  startTime: number,
  endTime: number | null,
  duration: number,
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

function isPlayingElement(video: HTMLVideoElement): boolean {
  try {
    return !video.paused && !video.ended
  } catch {
    return false
  }
}

/**
 * Single scene-local lifecycle handle for one Published V2 Native video.
 * The registry lives in the Slide host; this handle never queries the DOM
 * by id and never touches a second controller or event bus.
 */
export function mountPublishedNativeVideo(
  video: HTMLVideoElement,
  input: PublishedVideoInput,
  options: PublishedNativeVideoMountOptions = {},
): PublishedNativeVideoHandle | null {
  const capture = options.capture === true
  if (capture) return null
  const nodeId = input.id
  let destroyed = false
  let hasStarted = false
  let reportedPlaying = false
  let endedEmitted = false
  let backgroundInterruption: BackgroundAudioInterruption | null = null
  const listeners = new Map<PublishedVideoEventKind, Set<PublishedVideoEventListener>>()
  const audioRegistration: VideoAudioRegistration | null = options.audio?.registerVideo(video, {
    nodeId,
    volume: input.volume,
    muted: input.muted,
  }) ?? null

  const releaseBackgroundInterruption = (): void => {
    const interruption = backgroundInterruption
    backgroundInterruption = null
    interruption?.release()
  }

  const beginBackgroundInterruption = (): void => {
    if (backgroundInterruption || input.backgroundAudioMode === 'none') return
    backgroundInterruption = options.audio?.beginBackgroundAudioInterruption(
      input.backgroundAudioMode,
    ) ?? null
  }

  const notify = (kind: PublishedVideoEventKind, seconds?: number): void => {
    if (destroyed || capture) return
    const registrations = listeners.get(kind)
    if (!registrations || registrations.size === 0) return
    for (const listener of [...registrations]) {
      try {
        listener(seconds)
      } catch {
        // One stale observer must not break video playback.
      }
    }
  }

  const sourceAvailable = (): boolean => {
    if (destroyed) return false
    try {
      return video.isConnected !== false && (video.src !== '' || (video.currentSrc ?? '') !== '')
    } catch {
      return false
    }
  }

  const safeDuration = (): number => {
    try {
      const duration = video.duration
      return Number.isFinite(duration) && duration >= 0 ? duration : Number.POSITIVE_INFINITY
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  const seekTo = (seconds: number): boolean => {
    if (!sourceAvailable()) return false
    const target = clampSeekTime(seconds, input.startTime, input.endTime, safeDuration())
    try {
      video.currentTime = target
      return true
    } catch {
      return false
    }
  }

  const playElement = (): boolean => {
    try {
      const result = video.play() as unknown
      if (result !== undefined && result !== null
        && typeof (result as PromiseLike<unknown>).then === 'function') {
        void (result as Promise<unknown>).catch(() => undefined)
      }
      return true
    } catch {
      return false
    }
  }

  const pauseElement = (): boolean => {
    try {
      video.pause()
      return true
    } catch {
      return false
    }
  }

  const beginPlayback = (restart: boolean): boolean => {
    if (destroyed || capture || !sourceAvailable()) return false
    if (restart) seekTo(input.startTime)
    const ok = playElement()
    return ok
  }

  const handle: PublishedNativeVideoHandle = {
    nodeId,
    element: video,
    autoplay: input.autoplay,
    execute(action) {
      if (destroyed || capture) return false
      if (action.nodeId !== nodeId) return false
      switch (action.type) {
        case 'video.play': {
          if (!sourceAvailable()) return false
          if (!video.paused && !video.ended) return true
          try {
            if (video.paused && hasStarted && !video.ended) {
              return playElement()
            }
          } catch {
            return false
          }
          return beginPlayback(false)
        }
        case 'video.pause':
          if (!sourceAvailable()) return false
          releaseBackgroundInterruption()
          return pauseElement()
        case 'video.restart': {
          if (!sourceAvailable()) return false
          try {
            video.pause()
          } catch {
            return false
          }
          releaseBackgroundInterruption()
          return beginPlayback(true)
        }
        case 'video.stop': {
          if (!sourceAvailable()) return false
          try {
            video.pause()
          } catch {
            return false
          }
          releaseBackgroundInterruption()
          hasStarted = false
          reportedPlaying = false
          endedEmitted = false
          seekTo(input.startTime)
          return true
        }
        case 'video.toggle':
          if (!sourceAvailable()) return false
          return isPlayingElement(video)
            ? pauseElement()
            : handle.execute({ type: 'video.play', nodeId })
        case 'video.seek':
          return seekTo(action.seconds)
      }
    },
    subscribe(kind, listener) {
      let registrations = listeners.get(kind)
      if (!registrations) {
        registrations = new Set()
        listeners.set(kind, registrations)
      }
      registrations.add(listener)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        listeners.get(kind)?.delete(listener)
      }
    },
    pause() {
      if (destroyed || capture) return
      releaseBackgroundInterruption()
      pauseElement()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      releaseBackgroundInterruption()
      audioRegistration?.dispose()
      try {
        video.pause()
      } catch {
        // Teardown must not throw for an already detached element.
      }
      listeners.clear()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('error', onError)
      video.removeEventListener('click', onClickToggle)
    },
  }

  const startTimeOf = (): number => (
    Number.isFinite(input.startTime) ? Math.max(0, input.startTime) : 0
  )

  function onLoadedMetadata(): void {
    if (destroyed || capture) return
    if (!hasStarted) {
      try {
        video.currentTime = startTimeOf()
      } catch {
        // Metadata may be unavailable for synthetic sources; keep 0.
      }
    }
  }

  function onPlaying(): void {
    if (destroyed || capture) return
    if (reportedPlaying) return
    hasStarted = true
    reportedPlaying = true
    endedEmitted = false
    beginBackgroundInterruption()
    notify('started')
  }

  function onPause(): void {
    if (destroyed || capture) return
    releaseBackgroundInterruption()
    if (!hasStarted || !reportedPlaying) return
    reportedPlaying = false
    notify('paused')
  }

  function onEnded(): void {
    if (destroyed || capture) return
    releaseBackgroundInterruption()
    if (endedEmitted) return
    endedEmitted = true
    reportedPlaying = false
    notify('ended')
  }

  function onTimeUpdate(): void {
    if (destroyed || capture || !hasStarted) return
    let seconds = 0
    try {
      seconds = video.currentTime
    } catch {
      return
    }
    const endTime = input.endTime
    if (endTime !== null && Number.isFinite(endTime) && seconds >= endTime) {
      if (input.loop) {
        seekTo(input.startTime)
        playElement()
        return
      }
      if (!endedEmitted) {
        endedEmitted = true
        reportedPlaying = false
        releaseBackgroundInterruption()
        pauseElement()
        notify('ended')
      }
      return
    }
    notify('time', seconds)
  }

  function onClickToggle(): void {
    if (destroyed || capture || !input.clickToToggle) return
    handle.execute({ type: 'video.toggle', nodeId })
  }

  function onError(): void {
    if (destroyed || capture) return
    releaseBackgroundInterruption()
  }

  video.addEventListener('playing', onPlaying)
  video.addEventListener('pause', onPause)
  video.addEventListener('ended', onEnded)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('error', onError)
  if (input.clickToToggle) video.addEventListener('click', onClickToggle)
  if (video.readyState >= 1) onLoadedMetadata()

  return handle
}
