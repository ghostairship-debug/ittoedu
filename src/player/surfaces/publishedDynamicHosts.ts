import type { TeacherControllerAction } from '../../shared/teacherControllerConfig'
import { PlaybackViewSession } from '../playbackViewSession'
import {
  adjacentPlaybackTarget,
  buildCoursePlaybackSequence,
  playbackNavigationProgress,
  playbackSceneKey,
  type CoursePlaybackScene,
  type CoursePlaybackStep,
  type PlaybackDirection,
  type PlaybackNavigationLevel,
  type PlaybackNavigationProgress,
  type PlaybackNavigationViewPort,
} from '../navigation/coursePlaybackSequence'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'

import type { CourseLocation } from '../../shared/courseProjectTypes'
import type { PublishedCourseSurface, PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'
import type {
  ComponentHostActions,
  ComponentPackageData,
} from '../../shared/componentTypes'
import type { RuntimeHostActions } from '../../shared/runtimeTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  type PlayerAuthoringAckMessage,
  type PlayerAuthoringErrorMessage,
  type PlayerAuthoringHostMessage,
  type PlayerHostMode,
} from '../../shared/playerAuthoringProtocol'
import { CourseStateStore } from '../CourseStateStore'
import { AudioManager, type AudioPlaybackEvent } from '../AudioManager'
import { CourseEventBus } from '../CourseEventBus'
import { ScenePickerOverlay } from '../ScenePickerOverlay'
import { createPlayerComponentHostActions } from '../componentHostActions'
import { TeacherControllerRuntimeSessionStore } from '../teacherControllerRuntimeSession'
import { PublishedInteractionController } from '../interactions/PublishedInteractionController'
import {
  PublishedInteractionVisibilityState,
} from '../interactions/PublishedDomInteractionSurfacePort'
import type {
  PublishedInteractionSessionPort,
  PublishedInteractionSurfacePort,
} from '../interactions/PublishedInteractionSurfacePort'
import { CoursePlayer, type CoursePlayerOptions } from './CoursePlayer'
import { FlowSurfaceHost } from './flow/FlowSurfaceHost'
import {
  MixedCourseNavigator,
  buildMixedDeepLink,
  mixedCourseDefinitionFromPublished,
  type MixedCatalogEntry,
  type MixedCourseProgress,
  type MixedNavigationTransition,
  type MixedNavigationState,
} from './mixed/MixedCourseNavigator'
import {
  SlidePublishedAdapter,
  type SlidePublishedAuthoringOptions,
} from './slide/SlidePublishedAdapter'
import { SpatialSurfaceHost } from './spatial/SpatialSurfaceHost'
import { PublishedGlobalCanvasRuntimeOwner } from './runtime/publishedGlobalCanvasRuntimeOwner'
import {
  PublishedAuthoringSessionCoordinator,
  type PublishedAuthoringPatchSurface,
} from './publishedAuthoringSession'
import {
  findPublishedNavigationBlock,
  resetPublishedCourseState,
} from './publishedCourseState'
import type {
  SurfaceCapture,
  SurfaceCaptureRequest,
  SurfaceHost,
  SurfaceKind,
  SurfaceMountContext,
  SurfacePlayerServices,
  SurfaceResetScope,
} from './SurfaceHost'

export type PublishedDynamicHostKind = 'slide' | 'flow' | 'spatial'

export interface CreatePublishedDynamicHostsOptions {
  /** Ignored for camera/HUD; published stages are always the 1280×720 design canvas. */
  viewport?: { width: number; height: number }
  resolveAsset?: (assetId: string) => string | undefined
  playbackPathId?: string | null
  /** Internal deterministic export host; keeps authored interactions inert. */
  staticCapture?: boolean
  /** Pure Slide compatibility policy. Mixed/static callers leave this false. */
  includeGlobalLayerItemsForStaticCapture?: boolean
}

interface PublishedInteractionHostFactoryOptions {
  /** Internal Published Interaction session state shared by every host. */
  globalInteractionVisibilityState?: PublishedInteractionVisibilityState
  /** Internal generation hook; current controllers must stop before host teardown/rerender. */
  onInteractionInvalidated?: (surfaceId: string) => void
  /** Internal direct-resume hook for callers that operate the exposed CoursePlayer. */
  onInteractionReady?: (surfaceId: string) => void
  /** Internal course/session authority shared by every Mixed surface host. */
  teacherControllerSession?: TeacherControllerRuntimeSessionStore
  playbackView?: PlaybackViewSession
  navigation?: PlaybackNavigationViewPort
  /** Internal route for a controller course.restart action. */
  restartCourse?: () => Promise<boolean>
  /** Internal route for a Slide controller scene.replay action. */
  replayScene?: () => Promise<boolean>
  /** Session-owned controller route. `undefined` leaves local chrome actions to the host. */
  executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => Promise<boolean | undefined>
  /** Mixed reset commits the shared controller authority only after all hosts reset. */
  deferTeacherControllerCourseReset?: boolean
  /** One mutable Published playback store shared by every executable carrier. */
  courseState?: CourseStateStore
  runtimeActions?: Readonly<RuntimeHostActions>
  componentActions?: Readonly<ComponentHostActions>
  /** Whole-course Published audio truth; surfaces must not create a copy. */
  audio?: AudioManager
  /** Event source paired with the session audio owner. */
  audioEvents?: CourseEventBus
}

type CreatePublishedSurfaceHostOptions = CreatePublishedDynamicHostsOptions
  & PublishedInteractionHostFactoryOptions
  & {
    authoring?: SlidePublishedAuthoringOptions
  }

export interface PublishedCourseSessionOptions extends CreatePublishedDynamicHostsOptions {
  /** Ephemeral session start; never mutates the caller's Published payload. */
  initialLocationId?: string
  /** One-shot playback state for initialLocationId; never enters Published V2. */
  initialPresentationStateId?: string
  services?: Partial<SurfacePlayerServices>
  onFailure?: CoursePlayerOptions['onFailure']
  /** Internal direct same-document authoring host. Published V2 stays immutable. */
  authoring?: {
    sessionId: string
    scope: 'scene' | 'surface' | 'global'
    stateId: string | null
    /** Transient full manifests used only by the same-document authoring host. */
    componentPackages?: Readonly<Record<string, ComponentPackageData>>
    onMessage?: (message: PlayerAuthoringHostMessage) => void
  }
}

/**
 * Thin factory: `slide | flow | spatial` → existing product host or the
 * minimal Slide V2 adapter. Do not copy the donor 899-line runtime/component
 * compositor, and do not import SurfaceRuntimeAuthoring.
 */
export function publishedDynamicHostKind(
  type: PublishedCourseSurface['type'],
): PublishedDynamicHostKind {
  if (type === 'spatial-2d') return 'spatial'
  return type
}

export function firstPublishedLocationId(
  payload: PublishedCourseV2Payload,
  surfaceId: string,
): string {
  const match = payload.locations.find((location) => location.surfaceId === surfaceId)
  if (match) return match.id
  throw new Error(`Published surface ${surfaceId} has no location`)
}

export function createPublishedSurfaceHost(
  payload: PublishedCourseV2Payload,
  surfaceId: string,
  options: CreatePublishedDynamicHostsOptions = {},
): SurfaceHost {
  return createPublishedSurfaceHostInternal(payload, surfaceId, options)
}

function createPublishedSurfaceHostInternal(
  payload: PublishedCourseV2Payload,
  surfaceId: string,
  options: CreatePublishedSurfaceHostOptions,
): SurfaceHost {
  const surface = payload.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) throw new Error(`Unknown published surface: ${surfaceId}`)
  const sessionStart = payload.locations.find((location) => (
    location.id === payload.startLocationId && location.surfaceId === surfaceId
  ))
  const startLocationId = sessionStart?.id ?? firstPublishedLocationId(payload, surfaceId)
  const resolveAsset = options.resolveAsset
    ?? ((assetId: string) => payload.assets[assetId]?.url)
  const kind = publishedDynamicHostKind(surface.type)
  if (kind === 'slide') {
    return new SlidePublishedAdapter(payload, surface.id, {
      locationId: startLocationId,
      resolveAsset,
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: () => options.onInteractionInvalidated?.(surface.id),
      onInteractionReady: () => options.onInteractionReady?.(surface.id),
      teacherControllerSession: options.teacherControllerSession,
      navigation: options.navigation,
      playbackView: options.playbackView,
      replayScene: options.replayScene,
      executeTeacherControllerAction: async (action) => {
        if (options.executeTeacherControllerAction) {
          const outcome = await options.executeTeacherControllerAction(action)
          if (outcome !== undefined) return outcome
        }
        if (action.type !== 'course.restart' || !options.restartCourse) return undefined
        return options.restartCourse()
      },
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      audio: options.audio,
      staticCapture: options.staticCapture,
      includeGlobalLayerItemsForStaticCapture:
        options.includeGlobalLayerItemsForStaticCapture,
      ...(options.authoring ? { authoring: options.authoring } : {}),
    })
  }
  if (kind === 'flow') {
    return new FlowPublishedAdapter(payload, surface.id, {
      locationId: startLocationId,
      resolveAsset,
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: () => options.onInteractionInvalidated?.(surface.id),
      onInteractionReady: () => options.onInteractionReady?.(surface.id),
      teacherControllerSession: options.teacherControllerSession,
      navigation: options.navigation,
      playbackView: options.playbackView,
      restartCourse: options.restartCourse,
      replayScene: options.replayScene,
      executeTeacherControllerAction: options.executeTeacherControllerAction,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      audio: options.audio,
    })
  }
  return new SpatialPublishedAdapter(
    payload,
    surface.id,
    {
      startLocationId,
      viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      resolveAsset,
      playbackPathId: options.playbackPathId,
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: () => options.onInteractionInvalidated?.(surface.id),
      onInteractionReady: () => options.onInteractionReady?.(surface.id),
      teacherControllerSession: options.teacherControllerSession,
      navigation: options.navigation,
      playbackView: options.playbackView,
      restartCourse: options.restartCourse,
      replayScene: options.replayScene,
      executeTeacherControllerAction: options.executeTeacherControllerAction,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      initialMuted: options.audio?.muted(),
      audioChangeSource: options.audioEvents,
      staticCapture: options.staticCapture,
      includeGlobalLayerItemsForStaticCapture:
        options.includeGlobalLayerItemsForStaticCapture,
    },
  )
}

export function createPublishedSurfaceHosts(
  payload: PublishedCourseV2Payload,
  options: CreatePublishedDynamicHostsOptions = {},
): SurfaceHost[] {
  const teacherControllerSession = new TeacherControllerRuntimeSessionStore()
  return payload.surfaces.map((surface) => (
    createPublishedSurfaceHostInternal(payload, surface.id, {
      ...options,
      teacherControllerSession,
    })
  ))
}

function defaultCourseStateServices(
  payload: PublishedCourseV2Payload,
  courseState: CourseStateStore,
): SurfacePlayerServices {
  return {
    navigate: () => undefined,
    getCourseState: (key) => courseState.get(key),
    setCourseState: (key, value) => courseState.set(key, value),
    resolveAsset: (assetId) => payload.assets[assetId]?.url,
  }
}

export class FrozenPublishedCourseStateStore extends CourseStateStore {
  constructor(declarations: PublishedCourseV2Payload['courseState']) {
    super()
    for (const declaration of declarations) {
      super.set(declaration.key, structuredClone(declaration.defaultValue))
    }
  }

  override set(_key: string, _value: unknown): void {}

  override setMany(_entries: readonly { key: string; value: unknown }[]): void {
    throw new Error('静态或作者课程状态不可写入')
  }

  override delete(_key: string): void {}

  override clear(): void {}
}

/**
 * Read-only Published state/services shared by same-document authoring hosts.
 * Runtime authoring can inspect declared course state and resolve assets, but
 * cannot navigate or mutate the playback session while the editor is inert.
 */
export function createPublishedAuthoringReadonlyState(
  payload: PublishedCourseV2Payload,
  resolveAsset: (assetId: string) => string | undefined = (
    (assetId) => payload.assets[assetId]?.url
  ),
): {
  readonly courseState: CourseStateStore
  readonly services: SurfacePlayerServices
} {
  const courseState = new FrozenPublishedCourseStateStore(payload.courseState)
  return Object.freeze({
    courseState,
    services: Object.freeze({
      navigate: () => undefined,
      getCourseState: (key: string) => courseState.get(key),
      setCourseState: () => undefined,
      resolveAsset,
    }),
  })
}

function unsupportedPublishedAuthoringMessage(
  value: unknown,
): PlayerAuthoringErrorMessage {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    type: PLAYER_AUTHORING_MESSAGE_TYPES.error,
    protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
    ...(typeof candidate.sessionId === 'string' ? { sessionId: candidate.sessionId } : {}),
    ...(typeof candidate.requestId === 'string' ? { requestId: candidate.requestId } : {}),
    ...(typeof candidate.revision === 'number' ? { revision: candidate.revision } : {}),
    code: 'unsupported-host-mode',
    message: '当前 Published 会话不是统一画布编辑宿主。',
  }
}

interface PublishedInteractionCapableHost extends SurfaceHost {
  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null
  /** One-shot, session-only state request used by scene.go(targetStateId). */
  preparePublishedPresentationState?(
    locationId: string,
    stateId: string | undefined,
  ): boolean
  validatePublishedPresentationState?(
    locationId: string,
    stateId: string | undefined,
  ): boolean
  cancelPreparedPublishedPresentationState?(locationId: string): void
}

interface PublishedLocationPreparedHost extends SurfaceHost {
  preparePublishedLocation(locationId: string, forced: boolean): void
}

function locationPreparedHost(host: SurfaceHost | undefined): PublishedLocationPreparedHost | null {
  if (!host || !('preparePublishedLocation' in host)) return null
  const candidate = host as Partial<PublishedLocationPreparedHost>
  return typeof candidate.preparePublishedLocation === 'function'
    ? host as PublishedLocationPreparedHost
    : null
}

function interactionCapableHost(
  host: SurfaceHost | undefined,
): PublishedInteractionCapableHost | null {
  if (!host || !('getPublishedInteractionSurfacePort' in host)) return null
  const candidate = host as Partial<PublishedInteractionCapableHost>
  return typeof candidate.getPublishedInteractionSurfacePort === 'function'
    ? host as PublishedInteractionCapableHost
    : null
}

function preparePublishedInitialPresentationState(
  playback: PublishedCourseV2Payload,
  hosts: readonly SurfaceHost[],
  stateId: string,
): void {
  const location = playback.locations.find((candidate) => (
    candidate.id === playback.startLocationId
  ))
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('试运行初始命名状态只能用于明确的 Slide 场景位置。')
  }
  const targetHost = interactionCapableHost(
    hosts.find((host) => host.id === location.surfaceId),
  )
  if (
    !targetHost?.validatePublishedPresentationState
    || !targetHost.validatePublishedPresentationState(location.id, stateId)
  ) {
    throw new Error(`试运行初始命名状态“${stateId}”不属于位置“${location.id}”。`)
  }
  if (
    !targetHost.preparePublishedPresentationState
    || !targetHost.preparePublishedPresentationState(location.id, stateId)
  ) {
    throw new Error(`无法为位置“${location.id}”准备试运行初始命名状态。`)
  }
}

const UNAVAILABLE_INTERACTION_SURFACE_PORT: PublishedInteractionSurfacePort = {
  bindNodeClick: () => null,
  executeNodeMotion: () => false,
}

interface CancellablePublishedInteractionSurfacePort extends PublishedInteractionSurfacePort {
  cancelActiveMotions(): void
}

function cancelActiveMotions(port: PublishedInteractionSurfacePort | null): void {
  if (!port || !('cancelActiveMotions' in port)) return
  const candidate = port as Partial<CancellablePublishedInteractionSurfacePort>
  if (typeof candidate.cancelActiveMotions !== 'function') return
  try {
    candidate.cancelActiveMotions()
  } catch {
    // A stale renderer port must not block the owning navigation teardown.
  }
}

/** Mixed try-run / whole-course preview session. Does not write CourseProjectDocument. */
export class PublishedCourseSession {
  readonly player: CoursePlayer
  readonly navigator: MixedCourseNavigator
  readonly #hosts: readonly SurfaceHost[]
  readonly #globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner | null
  readonly #authoringCoordinator: PublishedAuthoringSessionCoordinator | null
  readonly playbackView: PlaybackViewSession | null
  #slots: HTMLElement[] = []
  #destroyPromise: Promise<void> | null = null
  #publicReplayAbortController: AbortController | null = null
  #publicReplaySettlement: Promise<boolean> | null = null
  #navigationFeedback: HTMLElement | null = null
  readonly #playbackScenes: readonly CoursePlaybackScene[]
  readonly #navigationListeners = new Set<() => void>()
  #observationNavigationVersion = 0

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner | null = null,
    authoringCoordinator: PublishedAuthoringSessionCoordinator | null = null,
    playbackView: PlaybackViewSession | null = null,
    playback?: PublishedCourseV2Payload,
  ) {
    this.playbackView = playbackView
    this.player = player
    this.navigator = navigator
    this.#hosts = hosts
    this.#globalRuntimeOwner = globalRuntimeOwner
    this.#authoringCoordinator = authoringCoordinator
    this.#playbackScenes = playback ? buildCoursePlaybackSequence(playback) : []
  }

  listPlaybackScenes(): readonly CoursePlaybackScene[] { return this.#playbackScenes }

  readObservationState(): { ready: boolean; surfaceId: string; locationId: string; stateId: string | null; stateVersion: number; publicState: Record<string, unknown> } {
    const current = this.navigator.current
    const host = this.#hosts.find(entry => entry.id === current?.surfaceId) as
      (SurfaceHost & { getPublishedPresentationStateId?(): string | null }) | undefined
    return {
      ready: !this.#destroyPromise && !this.navigator.hasPendingNavigation && !!current
        && this.player.statusOf(current.surfaceId) === 'active',
      surfaceId: current?.surfaceId ?? '', locationId: current?.locationId ?? '',
      stateId: host?.getPublishedPresentationStateId?.() ?? null,
      stateVersion: this.#observationNavigationVersion,
      publicState: { navigation: this.getPlaybackProgress(), courseState: null },
    }
  }

  getPlaybackProgress(): PlaybackNavigationProgress | null {
    const current = this.navigator.current
    const host = this.#hosts.find(entry => entry.id === current?.surfaceId) as
      (SurfaceHost & { getPublishedPresentationStateId?(): string | null }) | undefined
    return playbackNavigationProgress(this.#playbackScenes, current?.locationId ?? null, host?.getPublishedPresentationStateId?.())
  }

  subscribeNavigation(listener: () => void): () => void {
    this.#navigationListeners.add(listener)
    return () => this.#navigationListeners.delete(listener)
  }

  protected notifyNavigationChanged(): void {
    this.#observationNavigationVersion += 1
    for (const listener of this.#navigationListeners) listener()
  }

  protected playbackTarget(level: PlaybackNavigationLevel, direction: PlaybackDirection): CoursePlaybackStep | null {
    return adjacentPlaybackTarget(this.#playbackScenes, this.getPlaybackProgress(), level, direction)
  }

  protected canAcceptPlaybackNavigation(): boolean {
    return !this.#destroyPromise && !this.navigator.hasPendingNavigation && this.navigator.current !== null
  }

  canExecuteNavigationAction(action: TeacherControllerAction): boolean {
    if (!this.canAcceptPlaybackNavigation()) return false
    if (action.type === 'step.next') return this.playbackTarget('step', 'next') !== null
    if (action.type === 'step.previous') return this.playbackTarget('step', 'previous') !== null
    if (action.type === 'scene.next') return this.playbackTarget('scene', 'next') !== null
    if (action.type === 'scene.previous') return this.playbackTarget('scene', 'previous') !== null
    return true
  }

  protected acceptsPlaybackTarget(_target: CoursePlaybackStep): boolean { return true }

  requestPlaybackNavigation(level: PlaybackNavigationLevel, direction: PlaybackDirection): boolean {
    const target = this.playbackTarget(level, direction)
    if (!this.canAcceptPlaybackNavigation() || !target || !this.acceptsPlaybackTarget(target)) return false
    void this.movePlayback(level, direction).catch(error => {
      this.showNavigationFeedback(error instanceof Error ? error.message : '播放导航失败', this.navigator.current?.surfaceId ?? 'published-course')
    })
    return true
  }

  nextStep(): Promise<boolean> { return this.movePlayback('step', 'next') }
  previousStep(): Promise<boolean> { return this.movePlayback('step', 'previous') }
  nextScene(): Promise<boolean> { return this.movePlayback('scene', 'next') }
  previousScene(): Promise<boolean> { return this.movePlayback('scene', 'previous') }

  /** Overridden by the interactive session to retain guard and terminal arbitration. */
  protected async movePlayback(level: PlaybackNavigationLevel, direction: PlaybackDirection): Promise<boolean> {
    const target = this.playbackTarget(level, direction)
    if (!target || !this.canAcceptPlaybackNavigation()) return false
    await this.navigator.goToLocation(target.locationId)
    this.notifyNavigationChanged()
    return true
  }

  /** Authored-command has no fallback navigation. */
  dispatchPresenterCommand(_command: PlaybackDirection): boolean { return false }

  reportPresenterFeedback(message: string): void {
    this.showNavigationFeedback(message, this.navigator.current?.surfaceId ?? 'published-course')
  }

  getHostMode(): PlayerHostMode {
    return this.#authoringCoordinator ? 'authoring' : 'playback'
  }

  applyAuthoringCommand(
    value: unknown,
  ): Promise<PlayerAuthoringAckMessage | PlayerAuthoringErrorMessage> {
    return this.#authoringCoordinator?.apply(value)
      ?? Promise.resolve(unsupportedPublishedAuthoringMessage(value))
  }

  listCatalog(): MixedCatalogEntry[] {
    return this.navigator.listCatalog()
  }

  getProgress(): MixedCourseProgress {
    return this.navigator.getProgress()
  }

  next(): Promise<MixedNavigationState | null> {
    return this.navigator.next()
  }

  previous(): Promise<MixedNavigationState | null> {
    return this.navigator.previous()
  }

  goToLocation(locationId: string): Promise<MixedNavigationState> {
    return this.navigator.goToLocation(locationId)
  }

  /** Internal observation uses the same navigation owner and real session. */
  async goToObservationTarget(locationId: string, _stateId?: string): Promise<void> {
    await this.navigator.goToLocation(locationId)
  }

  goToIndex(index: number): Promise<MixedNavigationState> {
    return this.navigator.goToIndex(index)
  }

  /** Synchronous acceptance guard for replaying the current scene occurrence. */
  canReplayScene(): boolean {
    return this.#publicReplayAbortController === null
      && !this.navigator.hasPendingNavigation
      && this.canForceReplayCurrentLocation()
  }

  /** Force-remount only the current location without adding a history entry. */
  replayScene(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<boolean> {
    if (!this.canReplayScene() || signal.aborted) return Promise.resolve(false)
    const abortController = new AbortController()
    const abortFromCaller = () => abortController.abort()
    signal.addEventListener('abort', abortFromCaller, { once: true })
    this.#publicReplayAbortController = abortController

    let replay: Promise<boolean>
    try {
      replay = this.performPublicReplay(abortController.signal)
    } catch (error) {
      replay = Promise.reject(error)
    }

    let settlement: Promise<boolean>
    settlement = replay.catch((error: unknown) => {
      if (abortController.signal.aborted) return false
      throw error
    }).finally(() => {
      signal.removeEventListener('abort', abortFromCaller)
      if (this.#publicReplayAbortController === abortController) {
        this.#publicReplayAbortController = null
      }
      if (this.#publicReplaySettlement === settlement) {
        this.#publicReplaySettlement = null
      }
    })
    this.#publicReplaySettlement = settlement
    return settlement
  }

  protected performPublicReplay(signal: AbortSignal): Promise<boolean> {
    return this.forceReplayCurrentLocation(signal)
  }

  /** Internal all-surface primitive retained for authored Interaction replay. */
  protected canForceReplayCurrentLocation(): boolean {
    return !this.#destroyPromise && this.navigator.current !== null
  }

  protected async forceReplayCurrentLocation(signal: AbortSignal): Promise<boolean> {
    const current = this.navigator.current
    if (!this.canForceReplayCurrentLocation() || !current || signal.aborted) return false
    await this.navigator.goToLocation(current.locationId, {
      force: true,
      recordHistory: false,
      signal,
    })
    return true
  }

  /** Narrow course-runtime restart entry used by delivery controller chrome. */
  async restartCourse(): Promise<boolean> {
    this.#globalRuntimeOwner?.prepareRestart()
    try {
      await this.navigator.resetCourse()
      this.#globalRuntimeOwner?.finishRestart(true)
      return true
    } catch (error) {
      this.#globalRuntimeOwner?.finishRestart(false)
      const currentSurfaceId = this.navigator.current?.surfaceId
      if (currentSurfaceId) this.#globalRuntimeOwner?.moveTo(currentSurfaceId)
      throw error
    }
  }

  async mount(container: HTMLElement): Promise<void> {
    const viewport = this.playbackView?.mount(container) ?? container
    for (const host of this.#hosts) {
      const slot = container.ownerDocument.createElement('div')
      slot.dataset.courseSurfaceSlot = host.id
      slot.style.position = 'absolute'
      slot.style.inset = '0'
      slot.style.width = '100%'
      slot.style.height = '100%'
      slot.style.overflow = this.playbackView ? 'clip' : 'hidden'
      slot.style.visibility = 'hidden'
      slot.style.opacity = '0'
      slot.inert = true
      slot.style.pointerEvents = 'none'
      slot.style.zIndex = '0'
      slot.setAttribute('aria-hidden', 'true')
      viewport.appendChild(slot)
      this.#slots.push(slot)
      const mounted = await this.player.mountSurface(host.id, slot)
      if (!mounted.ok) throw mounted.failure?.error ?? new Error(`Failed to mount ${host.id}`)
    }
    if (!this.#authoringCoordinator) {
      const feedback = container.ownerDocument.createElement('div')
      feedback.dataset.publishedNavigationFeedback = 'true'
      feedback.setAttribute('role', 'alert')
      feedback.setAttribute('aria-live', 'assertive')
      feedback.hidden = true
      Object.assign(feedback.style, {
        position: 'absolute',
        left: '50%',
        bottom: '28px',
        transform: 'translateX(-50%)',
        zIndex: '30',
        maxWidth: 'min(720px, calc(100% - 48px))',
        boxSizing: 'border-box',
        padding: '10px 16px',
        borderRadius: '10px',
        background: 'rgba(15, 23, 42, 0.94)',
        color: '#f8fafc',
        font: '600 16px/1.5 "Microsoft YaHei", sans-serif',
        textAlign: 'center',
        pointerEvents: 'none',
      })
      container.appendChild(feedback)
      this.#navigationFeedback = feedback
    }
    this.#globalRuntimeOwner?.mount(container.ownerDocument)
    await this.navigator.start()
    const activeSurfaceId = this.navigator.current?.surfaceId ?? this.#hosts[0]?.id ?? ''
    this.syncActiveSlot(activeSurfaceId)
    if (activeSurfaceId) this.#globalRuntimeOwner?.moveTo(activeSurfaceId)
    this.#authoringCoordinator?.markReady()
  }

  syncActiveSlot(surfaceId: string): void {
    this.playbackView?.activate(surfaceId)
    for (const slot of this.#slots) {
      const active = slot.dataset.courseSurfaceSlot === surfaceId
      slot.style.visibility = active ? 'visible' : 'hidden'
      // A spatial child can explicitly restore visibility after camera culling.
      // Opacity hides the complete inactive subtree without breaking measurement.
      slot.style.opacity = active ? '1' : '0'
      slot.style.pointerEvents = active && !this.#authoringCoordinator ? 'auto' : 'none'
      slot.style.zIndex = active ? '1' : '0'
      slot.inert = !active || this.#authoringCoordinator !== null
      if (active && !this.#authoringCoordinator) slot.removeAttribute('aria-hidden')
      else slot.setAttribute('aria-hidden', 'true')
    }
  }

  protected movePublishedGlobalRuntimes(surfaceId: string): void {
    this.#globalRuntimeOwner?.moveTo(surfaceId)
  }

  protected preparePublishedGlobalRuntimeRestart(): void {
    this.#globalRuntimeOwner?.prepareRestart()
  }

  protected finishPublishedGlobalRuntimeRestart(committed: boolean): void {
    this.#globalRuntimeOwner?.finishRestart(committed)
  }

  protected showNavigationFeedback(message: string, surfaceId: string): void {
    const feedback = this.#navigationFeedback
    if (feedback) {
      feedback.textContent = message
      feedback.hidden = false
    }
    const target = feedback?.parentElement
    const CustomEventConstructor = target?.ownerDocument.defaultView?.CustomEvent
    if (target && CustomEventConstructor) {
      target.dispatchEvent(new CustomEventConstructor('courseware:navigation-blocked', {
        detail: Object.freeze({ message, surfaceId }),
      }))
    }
  }

  protected clearNavigationFeedback(): void {
    if (!this.#navigationFeedback) return
    this.#navigationFeedback.hidden = true
    this.#navigationFeedback.textContent = ''
  }

  async destroy(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise
    const replaySettlement = this.#publicReplaySettlement
    this.#publicReplayAbortController?.abort()
    this.#authoringCoordinator?.destroy()
    this.#destroyPromise = this.#runDestroy(replaySettlement)
    return this.#destroyPromise
  }

  async #runDestroy(replaySettlement: Promise<boolean> | null): Promise<void> {
    if (replaySettlement) {
      try {
        await replaySettlement
      } catch {
        // A failed accepted replay must settle before, but cannot block, teardown.
      }
    }
    this.#globalRuntimeOwner?.destroy()
    await this.player.destroy()
    this.playbackView?.destroy()
    this.#navigationFeedback?.remove()
    this.#navigationFeedback = null
    this.#navigationListeners.clear()
    for (const slot of this.#slots) slot.remove()
    this.#slots = []
  }
}

/** Internal coordinator; the exported session keeps its original product API. */
class PublishedInteractionCourseSession extends PublishedCourseSession {
  readonly #hostsById: ReadonlyMap<string, SurfaceHost>
  readonly #payload: PublishedCourseV2Payload
  readonly #services: SurfacePlayerServices
  readonly #courseState: CourseStateStore
  readonly #audio: AudioManager
  readonly #audioEvents: CourseEventBus
  readonly #staticCapture: boolean
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  readonly #interactionSessionPort: PublishedInteractionSessionPort
  #globalInteractionController: PublishedInteractionController | null = null
  #localInteractionController: PublishedInteractionController | null = null
  #scenePicker: ScenePickerOverlay | null = null
  #terminalNavigationClaimed = false
  #terminalNavigationInvalidated = false
  #interactionDestroyStarted = false
  #audioDestroyStarted = false
  #navigationGuardBypassTargetId: string | null = null

  override readObservationState(): ReturnType<PublishedCourseSession['readObservationState']> {
    const state = super.readObservationState()
    return { ...state, stateVersion: state.stateVersion + this.#courseState.version,
      publicState: { ...state.publicState, courseState: this.#courseState.snapshot() } }
  }

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    payload: PublishedCourseV2Payload,
    services: SurfacePlayerServices,
    globalInteractionVisibilityState: PublishedInteractionVisibilityState,
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner,
    courseState: CourseStateStore,
    audio: AudioManager,
    audioEvents: CourseEventBus,
    staticCapture: boolean,
    playbackView: PlaybackViewSession | null,
  ) {
    super(player, navigator, hosts, globalRuntimeOwner, null, playbackView, payload)
    this.#hostsById = new Map(hosts.map((host) => [host.id, host]))
    this.#payload = payload
    this.#services = services
    this.#courseState = courseState
    this.#audio = audio
    this.#audioEvents = audioEvents
    this.#staticCapture = staticCapture
    this.#globalInteractionVisibilityState = globalInteractionVisibilityState
    this.#interactionSessionPort = {
      courseState: this.#courseState,
      setCourseStateBatch: entries => {
        if (this.#staticCapture || this.#interactionDestroyStarted) throw new Error('课程会话不可写入')
        this.#courseState.setMany(entries)
      },
      currentSceneId: () => this.#currentSlideSceneId(),
      executeAudioAction: (action, signal) => (
        !signal.aborted
        && !this.#interactionDestroyStarted
        && this.#audio.execute(action)
      ),
      bindAudioEnded: (soundId, listener) => this.#audioEvents.on<AudioPlaybackEvent>(
        'audio:ended',
        (event) => {
          if (!this.#interactionDestroyStarted && event?.soundId === soundId) listener()
        },
      ),
      goToScene: (sceneId, targetStateId, signal) => (
        this.#goToScene(sceneId, targetStateId, signal)
      ),
      nextScene: (signal) => this.#nextScene(signal),
      nextStep: signal => this.#navigateAdjacent('step', 'next', signal),
      previousStep: signal => this.#navigateAdjacent('step', 'previous', signal),
      previousScene: (signal) => this.#previousScene(signal),
      replayScene: (signal) => this.#replayScene(signal),
      restartCourse: (signal) => this.#restartCourse(signal),
    }
  }

  override async mount(container: HTMLElement): Promise<void> {
    await super.mount(container)
    if (this.#staticCapture || this.#interactionDestroyStarted || this.#scenePicker) return
    this.#scenePicker = new ScenePickerOverlay({
      stage: container,
      scenes: this.listPlaybackScenes().map(scene => ({ id: scene.id, name: scene.name, steps: scene.steps })),
      onSelect: (id) => {
        const scenes = this.listPlaybackScenes()
        const step = scenes.find(scene => scene.id === id)?.steps[0]
          ?? scenes.flatMap(scene => scene.steps).find(candidate => candidate.id === id)
        if (!step || !this.#canAcceptHostAction()) return
        this.#launchHostAction(
          'scenePicker',
          this.#navigatePlaybackTarget(step, new AbortController().signal, { bypassGuards: true }),
        )
      },
    })
  }

  assertNavigationAllowed(transition: MixedNavigationTransition): void {
    if (
      this.#staticCapture
      || !transition.current
      || transition.current.locationId === transition.next.locationId
    ) return
    if (this.#navigationGuardBypassTargetId === transition.next.locationId) {
      this.#navigationGuardBypassTargetId = null
      return
    }
    const guard = this.#navigationBlockFor(transition.next.locationId)
    if (!guard) return
    this.#reportNavigationBlock(guard.message, transition.next.surfaceId)
    throw new Error(guard.message)
  }

  requestHostGoToScene(sceneId: string, targetStateId?: string): boolean {
    if (!this.#canAcceptHostAction()) return false
    const location = this.#slideLocationForScene(sceneId)
    if (!location) return false
    const current = this.navigator.current
    if (targetStateId === undefined && current?.locationId === location.id) return false
    const targetHost = interactionCapableHost(this.#hostsById.get(location.surfaceId))
    if (
      !targetHost?.validatePublishedPresentationState
      || !targetHost.validatePublishedPresentationState(location.id, targetStateId)
    ) return false
    if (!this.#acceptNavigationTarget(location.id, location.surfaceId)) return false
    this.#launchHostAction(
      'goToScene',
      this.#goToScene(sceneId, targetStateId, new AbortController().signal),
    )
    return true
  }

  requestHostNextScene(): boolean { return this.requestPlaybackNavigation('scene', 'next') }

  requestHostPreviousScene(): boolean { return this.requestPlaybackNavigation('scene', 'previous') }

  requestHostReplayScene(): boolean {
    if (!this.#canAcceptHostAction() || !this.canForceReplayCurrentLocation()) return false
    this.#launchHostAction('replayScene', this.#replayScene(new AbortController().signal))
    return true
  }

  replayCurrentLocationFromController(): Promise<boolean> {
    if (!this.#canAcceptHostAction() || !this.canForceReplayCurrentLocation()) {
      return Promise.resolve(false)
    }
    return this.#replayScene(new AbortController().signal)
  }

  async executeTeacherControllerAction(
    action: TeacherControllerAction,
  ): Promise<boolean | undefined> {
    if (action.type === 'player.fullscreen.toggle' && this.playbackView) {
      if (this.#staticCapture || this.#interactionDestroyStarted) return false
      return this.playbackView.toggleFullscreen()
    }
    if (action.type === 'step.next' || action.type === 'step.previous') {
      return this.movePlayback('step', action.type === 'step.next' ? 'next' : 'previous')
    }
    if (action.type === 'scene.next' || action.type === 'scene.previous') {
      const target = this.playbackTarget('scene', action.type === 'scene.next' ? 'next' : 'previous')
      return target ? this.#navigatePlaybackTarget(target, new AbortController().signal, { bypassGuards: true }) : false
    }
    if (action.type === 'audio.toggle-mute') {
      if (this.#staticCapture || this.#interactionDestroyStarted) return false
      this.#audio.toggleMuted()
      return true
    }
    if (action.type === 'scene.open-picker') {
      if (!this.#canAcceptHostAction() || !this.#scenePicker) return false
      const progress = this.getPlaybackProgress()
      this.#scenePicker.open(progress?.sceneId ?? null, {
        currentStepId: progress?.stepId,
        bypassNavigationGuards: true,
      })
      return true
    }
    if (action.type === 'course.restart') {
      return this.#restartCourse(new AbortController().signal)
    }
    if (action.type === 'scene.replay') {
      return this.#replayScene(new AbortController().signal)
    }
    if (
      action.type !== 'scene.go'
    ) return undefined
    if (!this.#canAcceptHostAction()) return false
    const current = this.navigator.current
    if (!current) return false
    const target = publishedControllerNavigationTarget(action, {
      locations: this.#payload.locations,
      currentLocationId: current.locationId,
      startLocationId: this.#payload.startLocationId,
    })
    if (!target) return false
    return this.#navigateFromTeacherController(
      target,
      action.type === 'scene.go' ? action.targetStateId : undefined,
      new AbortController().signal,
    )
  }

  requestHostRestartCourse(): boolean {
    if (!this.#canAcceptHostAction() || !this.navigator.current) return false
    this.#launchHostAction('restartCourse', this.#restartCourse(new AbortController().signal))
    return true
  }

  /** Navigator callback: every real/forced navigation invalidates the old generation. */
  handleBeforeNavigation(transition?: MixedNavigationTransition): void {
    this.#scenePicker?.close(false)
    if (transition) {
      this.#audioEvents.emit('scene:leave', { sceneId: transition.current?.locationId })
      locationPreparedHost(this.#hostsById.get(transition.next.surfaceId))
        ?.preparePublishedLocation(transition.next.locationId, transition.forced)
    }
    if (this.#terminalNavigationClaimed) this.#terminalNavigationInvalidated = true
    this.#destroyInteractionControllers()
  }

  /** Host callbacks are relevant only when that host owns the navigator generation. */
  handleInteractionHostInvalidated(surfaceId: string): void {
    if (this.navigator.current?.surfaceId !== surfaceId) return
    this.#destroyInteractionControllers()
  }

  /** Direct CoursePlayer resume support for the intentionally exposed player port. */
  handleInteractionHostReady(surfaceId: string): void {
    const current = this.navigator.current
    const host = this.#hostsById.get(surfaceId)
    if (
      this.#interactionDestroyStarted
      || current?.surfaceId !== surfaceId
      || (host?.getLocationId?.() ?? current.locationId) !== current.locationId
    ) return
    this.movePublishedGlobalRuntimes(surfaceId)
    this.#mountInteractionControllers(surfaceId)
  }

  handleNavigation(state: MixedNavigationState): void {
    if (this.#interactionDestroyStarted) return
    this.#terminalNavigationClaimed = false
    this.#terminalNavigationInvalidated = false
    this.clearNavigationFeedback()
    this.syncActiveSlot(state.surfaceId)
    this.movePublishedGlobalRuntimes(state.surfaceId)
    this.#audioEvents.emit('scene:enter', { sceneId: state.locationId })
    this.#mountInteractionControllers()
  }

  handleNavigationSettled(state: MixedNavigationState): void {
    if (this.#interactionDestroyStarted || this.navigator.current?.locationId !== state.locationId) return
    this.notifyNavigationChanged()
    this.#globalInteractionController?.enterScene()
    this.#localInteractionController?.enterScene()
  }

  override dispatchPresenterCommand(command: PlaybackDirection): boolean {
    if (!this.#canAcceptHostAction()) return false
    const global = this.#globalInteractionController?.dispatchPresenterCommand(command) ?? false
    // Evaluate both scopes. The existing terminal claim admits only one navigation.
    const local = this.#localInteractionController?.dispatchPresenterCommand(command) ?? false
    return global || local
  }

  override restartCourse(): Promise<boolean> {
    return this.#restartCourse(new AbortController().signal)
  }

  override canReplayScene(): boolean {
    return !this.#interactionDestroyStarted
      && !this.#terminalNavigationClaimed
      && super.canReplayScene()
  }

  protected override performPublicReplay(signal: AbortSignal): Promise<boolean> {
    return this.#forceReplayCurrentLocation(signal)
  }

  override async destroy(): Promise<void> {
    if (!this.#interactionDestroyStarted) {
      this.#interactionDestroyStarted = true
      this.#destroyInteractionControllers()
      this.#globalInteractionVisibilityState.reset()
    }
    this.#scenePicker?.destroy()
    this.#scenePicker = null
    try {
      await super.destroy()
    } finally {
      if (!this.#audioDestroyStarted) {
        this.#audioDestroyStarted = true
        this.#audio.destroy()
        this.#audioEvents.dispose()
      }
    }
  }

  #destroyInteractionControllers(): void {
    this.#localInteractionController?.destroy()
    this.#localInteractionController = null
    this.#globalInteractionController?.destroy()
    this.#globalInteractionController = null
    const surfaceId = this.navigator.current?.surfaceId ?? this.player.activeSurfaceId
    const host = surfaceId ? interactionCapableHost(this.#hostsById.get(surfaceId)) : null
    cancelActiveMotions(host?.getPublishedInteractionSurfacePort() ?? null)
  }

  #mountInteractionControllers(activatingSurfaceId?: string): void {
    this.#destroyInteractionControllers()
    if (this.#interactionDestroyStarted || this.#staticCapture) return
    const current = this.navigator.current
    if (
      !current
      || (
        this.player.activeSurfaceId !== current.surfaceId
        && activatingSurfaceId !== current.surfaceId
      )
    ) return
    const rawHost = this.#hostsById.get(current.surfaceId)
    if (
      rawHost?.getLocationId
      && rawHost.getLocationId() !== current.locationId
    ) return
    const host = interactionCapableHost(rawHost)
    const surfacePort = host?.getPublishedInteractionSurfacePort()
      ?? UNAVAILABLE_INTERACTION_SURFACE_PORT
    const reportDiagnostic = this.#services.reportDiagnostic

    if (this.#payload.globalInteractions.length > 0) {
      this.#globalInteractionController = new PublishedInteractionController({
        surfaceId: current.surfaceId,
        rules: this.#payload.globalInteractions,
        surface: surfacePort,
        session: this.#interactionSessionPort,
        ...(reportDiagnostic ? { reportDiagnostic } : {}),
      })
    }

    const location = this.#locationById(current.locationId)
    if (location?.kind !== 'slide-scene') return
    const surface = this.#payload.surfaces.find((candidate) => (
      candidate.id === location.surfaceId && candidate.type === 'slide'
    ))
    const scene = surface?.type === 'slide'
      ? surface.scenes.find((candidate) => candidate.id === location.sceneId)
      : undefined
    if (!scene || scene.interactions.length === 0) return
    this.#localInteractionController = new PublishedInteractionController({
      surfaceId: current.surfaceId,
      rules: scene.interactions,
      surface: surfacePort,
      session: this.#interactionSessionPort,
      ...(reportDiagnostic ? { reportDiagnostic } : {}),
    })
  }

  #locationById(locationId: string): CourseLocation | undefined {
    return this.#payload.locations.find((location) => location.id === locationId)
  }

  #currentSlideSceneId(): string | null {
    const current = this.navigator.current
    if (!current) return null
    const location = this.#locationById(current.locationId)
    return location?.kind === 'slide-scene' ? location.sceneId : null
  }

  #canAcceptHostAction(): boolean {
    return !this.#staticCapture
      && !this.#interactionDestroyStarted
      && !this.#terminalNavigationClaimed
      && !this.navigator.hasPendingNavigation
      && this.navigator.current !== null
  }

  #navigationBlockFor(toLocationId: string) {
    const fromLocationId = this.navigator.current?.locationId ?? null
    if (fromLocationId === null || fromLocationId === toLocationId) return null
    return findPublishedNavigationBlock(
      this.#payload.navigationGuards,
      this.#courseState,
      { fromLocationId, toLocationId },
    )
  }

  #acceptNavigationTarget(toLocationId: string, surfaceId: string): boolean {
    const guard = this.#navigationBlockFor(toLocationId)
    if (!guard) return true
    this.#reportNavigationBlock(guard.message, surfaceId)
    return false
  }

  #reportNavigationBlock(message: string, surfaceId: string): void {
    this.showNavigationFeedback(message, surfaceId)
    this.#services.reportDiagnostic?.({
      surfaceId,
      phase: 'execute',
      severity: 'warning',
      message,
    })
  }

  #launchHostAction(label: string, action: Promise<boolean>): void {
    void action.catch((error: unknown) => {
      this.#services.reportDiagnostic?.({
        surfaceId: this.navigator.current?.surfaceId ?? 'published-course',
        phase: 'execute',
        severity: 'error',
        message: `Published 宿主动作“${label}”失败。`,
        cause: error,
      })
    })
  }

  #slideLocationForScene(sceneId: string): Extract<CourseLocation, { kind: 'slide-scene' }> | null {
    const current = this.navigator.current
      ? this.#locationById(this.navigator.current.locationId)
      : undefined
    if (current?.kind === 'slide-scene' && current.sceneId === sceneId) return current
    return this.#payload.locations.find((location): location is Extract<
      CourseLocation,
      { kind: 'slide-scene' }
    > => location.kind === 'slide-scene' && location.sceneId === sceneId) ?? null
  }

  #claimTerminalNavigation(signal: AbortSignal): boolean {
    if (
      this.#interactionDestroyStarted
      || this.#terminalNavigationClaimed
      || this.navigator.hasPendingNavigation
      || signal.aborted
    ) return false
    // Claim synchronously so another local/global listener from the same click
    // cannot prepare state or enqueue stale navigation before onBeforeNavigate.
    this.#terminalNavigationClaimed = true
    this.#terminalNavigationInvalidated = false
    return true
  }

  #releaseTerminalNavigationClaim(): void {
    const shouldRemount = this.#terminalNavigationInvalidated
    this.#terminalNavigationClaimed = false
    this.#terminalNavigationInvalidated = false
    this.notifyNavigationChanged()
    if (shouldRemount && !this.#interactionDestroyStarted) {
      this.#mountInteractionControllers()
    }
  }

  override async goToObservationTarget(locationId: string, stateId?: string): Promise<void> {
    const ok = await this.#navigatePlaybackTarget({ id: locationId, locationId, name: locationId, stateId }, new AbortController().signal,
      { force: true, recordHistory: false, bypassGuards: true, prepareInitialState: true })
    if (!ok) throw new Error(`Unable to observe Published target ${locationId}/${stateId ?? ''}`)
  }

  async #goToScene(
    sceneId: string,
    targetStateId: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    const location = this.#slideLocationForScene(sceneId)
    if (!location) return false
    return this.#navigatePlaybackTarget({ id: location.id, name: location.label, locationId: location.id, stateId: targetStateId }, signal, { prepareInitialState: true })
  }

  async #nextScene(signal: AbortSignal): Promise<boolean> {
    return this.#navigateAdjacent('scene', 'next', signal)
  }

  async #previousScene(signal: AbortSignal): Promise<boolean> {
    return this.#navigateAdjacent('scene', 'previous', signal)
  }

  protected override canAcceptPlaybackNavigation(): boolean { return this.#canAcceptHostAction() }

  protected override acceptsPlaybackTarget(target: CoursePlaybackStep): boolean {
    const location = this.#locationById(target.locationId)
    return !!location && this.#acceptNavigationTarget(location.id, location.surfaceId)
  }

  protected override movePlayback(level: PlaybackNavigationLevel, direction: PlaybackDirection): Promise<boolean> {
    return this.#navigateAdjacent(level, direction, new AbortController().signal)
  }

  #navigateAdjacent(level: PlaybackNavigationLevel, direction: PlaybackDirection, signal: AbortSignal): Promise<boolean> {
    const target = this.playbackTarget(level, direction)
    if (!target) return Promise.resolve(false)
    return this.#navigatePlaybackTarget(target, signal)
  }

  #navigateFromTeacherController(target: CourseLocation, targetStateId: string | undefined, signal: AbortSignal): Promise<boolean> {
    return this.#navigatePlaybackTarget({ id: target.id, locationId: target.id, name: target.label, stateId: targetStateId }, signal, { bypassGuards: true })
  }

  /** One commit path for exact location, scene, step and explicit replay requests. */
  async #navigatePlaybackTarget(
    step: CoursePlaybackStep,
    signal: AbortSignal,
    options: { bypassGuards?: boolean; force?: boolean; recordHistory?: boolean; prepareInitialState?: boolean } = {},
  ): Promise<boolean> {
    const target = this.#locationById(step.locationId)
    const current = this.navigator.current
    if (!target || !current || signal.aborted) return false
    const force = options.force === true || step.stateId !== undefined
    if (current.locationId === target.id && !force) return false
    const targetHost = target.kind === 'slide-scene' ? interactionCapableHost(this.#hostsById.get(target.surfaceId)) : null
    const prepareState = step.stateId !== undefined || (options.prepareInitialState === true && target.kind === 'slide-scene')
    if (prepareState && (!targetHost?.validatePublishedPresentationState || !targetHost.validatePublishedPresentationState(target.id, step.stateId))) return false
    if (!this.#claimTerminalNavigation(signal)) return false
    if (options.bypassGuards) this.#navigationGuardBypassTargetId = target.id
    try {
      await this.navigator.goToLocation(target.id, {
        force,
        recordHistory: options.recordHistory ?? current.locationId !== target.id,
        signal,
        ...(prepareState ? { prepareTransition: () => {
          if (!targetHost?.preparePublishedPresentationState || !targetHost.preparePublishedPresentationState(target.id, step.stateId)) {
            throw new Error(`Unable to prepare Published scene state for ${target.id}`)
          }
        } } : {}),
      })
      return true
    } catch (error) {
      targetHost?.cancelPreparedPublishedPresentationState?.(target.id)
      this.#releaseTerminalNavigationClaim()
      throw error
    } finally {
      this.#navigationGuardBypassTargetId = null
    }
  }

  async #replayScene(signal: AbortSignal): Promise<boolean> {
    if (this.#interactionDestroyStarted || this.#terminalNavigationClaimed || !this.canForceReplayCurrentLocation()) return false
    return this.#forceReplayCurrentLocation(signal)
  }

  #forceReplayCurrentLocation(signal: AbortSignal): Promise<boolean> {
    const progress = this.getPlaybackProgress()
    const first = progress ? this.listPlaybackScenes()[progress.sceneIndex]?.steps[0] : undefined
    if (!first) return Promise.resolve(false)
    return this.#navigatePlaybackTarget(first, signal, { force: true, bypassGuards: true, recordHistory: false })
  }

  async #restartCourse(signal: AbortSignal): Promise<boolean> {
    if (!this.navigator.current || !this.#claimTerminalNavigation(signal)) return false
    this.#audioEvents.emit('course:restart')
    this.#navigationGuardBypassTargetId = this.#payload.startLocationId
    this.preparePublishedGlobalRuntimeRestart()
    try {
      await this.navigator.resetCourse({ signal })
      this.finishPublishedGlobalRuntimeRestart(true)
      this.#globalInteractionVisibilityState.reset()
      return true
    } catch (error) {
      this.finishPublishedGlobalRuntimeRestart(false)
      const currentSurfaceId = this.navigator.current?.surfaceId
      if (currentSurfaceId) this.movePublishedGlobalRuntimes(currentSurfaceId)
      this.#releaseTerminalNavigationClaim()
      throw error
    } finally {
      this.#navigationGuardBypassTargetId = null
    }
  }
}

function createPublishedAuthoringCourseSession(
  playback: PublishedCourseV2Payload,
  options: PublishedCourseSessionOptions & {
    authoring: NonNullable<PublishedCourseSessionOptions['authoring']>
  },
): PublishedCourseSession {
  const location = playback.locations.find((candidate) => (
    candidate.id === playback.startLocationId
  ))
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('Published 统一编辑宿主只能挂载明确的 Slide 场景位置。')
  }
  const surface = playback.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') {
    throw new Error(`Published 位置 ${location.id} 不属于 Slide surface。`)
  }

  // The authoring host is a single-location view. Keeping unrelated Mixed
  // hosts alive would reintroduce hidden dual rendering and authoring targets.
  playback.locations = [location]
  playback.surfaces = [surface]
  const resolveAsset = options.resolveAsset
    ?? options.services?.resolveAsset
    ?? ((assetId: string) => playback.assets[assetId]?.url)
  const readonlyState = createPublishedAuthoringReadonlyState(playback, resolveAsset)
  const frozenCourseState = readonlyState.courseState
  const services: SurfacePlayerServices = {
    ...readonlyState.services,
    ...options.services,
    navigate: () => undefined,
    getCourseState: (key) => frozenCourseState.get(key),
    setCourseState: () => undefined,
    resolveAsset,
  }
  const teacherControllerSession = new TeacherControllerRuntimeSessionStore()
  let coordinator: PublishedAuthoringSessionCoordinator | null = null
  const host = createPublishedSurfaceHostInternal(playback, surface.id, {
    viewport: options.viewport,
    resolveAsset,
    playbackPathId: options.playbackPathId,
    teacherControllerSession,
    courseState: frozenCourseState,
    authoring: {
      stateId: options.authoring.stateId,
      scope: options.authoring.scope,
      ...(options.authoring.componentPackages
        ? { componentPackages: options.authoring.componentPackages }
        : {}),
      courseState: frozenCourseState,
      onRuntimeTargetsChanged: (update) => coordinator?.publishRuntimeTargets(update),
      onComponentTargetsChanged: (update) => coordinator?.publishComponentTargets(update),
    },
  }) as SlidePublishedAdapter
  const player = new CoursePlayer([host], {
    services,
    onFailure: options.onFailure,
  })
  const mixedNavigator = new MixedCourseNavigator(
    mixedCourseDefinitionFromPublished(playback),
    player,
  )
  const globalRuntimeOwner = new PublishedGlobalCanvasRuntimeOwner({
    payload: playback,
    hosts: [host],
    services,
    resolveAsset,
    authoring: {
      courseState: frozenCourseState,
      onTargetsChanged: (update) => coordinator?.publishRuntimeTargets(update),
    },
    courseState: frozenCourseState,
  })
  const authoringSurface: PublishedAuthoringPatchSurface = {
    getAuthoringContext: () => host.getAuthoringContext(),
    getAuthoringGeneration: () => host.getAuthoringGeneration(),
    applyAuthoringPatch: async (context, patch, identity) => {
      if (patch.kind !== 'runtime-content' || patch.target.scope !== 'global') {
        return host.applyAuthoringPatch(context, patch, identity)
      }
      if (await globalRuntimeOwner.applyAuthoringContentValue(
        patch.target.nodeId,
        patch.target.key,
        patch.value,
      )) {
        return { ok: true, target: patch.target }
      }
      return {
        ok: false,
        code: 'update-failed',
        message: '全局 Runtime 作者目标已失效，无法原位更新。',
      }
    },
  }
  coordinator = new PublishedAuthoringSessionCoordinator({
    sessionId: options.authoring.sessionId,
    surface: authoringSurface,
    ...(options.authoring.onMessage
      ? { onMessage: options.authoring.onMessage }
      : {}),
  })
  return new PublishedCourseSession(
    player,
    mixedNavigator,
    [host],
    globalRuntimeOwner,
    coordinator,
  )
}

export function createPublishedCourseSession(
  payload: PublishedCourseV2Payload,
  options: PublishedCourseSessionOptions = {},
): PublishedCourseSession {
  if (options.initialPresentationStateId !== undefined) {
    if (options.authoring) {
      throw new Error('Published 作者宿主不能接收试运行初始命名状态。')
    }
    if (options.staticCapture) {
      throw new Error('Published 静态捕获不能接收试运行初始命名状态。')
    }
    if (options.initialLocationId === undefined) {
      throw new Error('试运行初始命名状态必须同时指定初始位置。')
    }
  }
  const playback = structuredClone(payload)
  if (options.authoring && options.staticCapture) {
    throw new Error('Published 作者宿主不能同时作为静态捕获宿主。')
  }
  if (options.initialLocationId !== undefined) {
    const initialLocation = playback.locations.find((location) => (
      location.id === options.initialLocationId
    ))
    if (!initialLocation) {
      throw new Error(`Unknown Published session start location: ${options.initialLocationId}`)
    }
    playback.startLocationId = initialLocation.id
  }
  if (options.authoring) {
    return createPublishedAuthoringCourseSession(playback, {
      ...options,
      authoring: options.authoring,
    })
  }
  const globalInteractionVisibilityState = new PublishedInteractionVisibilityState()
  const teacherControllerSession = new TeacherControllerRuntimeSessionStore()
  const playbackView = options.staticCapture ? null : new PlaybackViewSession()
  const courseState: CourseStateStore = options.staticCapture
    ? new FrozenPublishedCourseStateStore(playback.courseState)
    : new CourseStateStore()
  if (!options.staticCapture) resetPublishedCourseState(courseState, playback.courseState)
  const resolvePublishedAsset = options.resolveAsset
    ?? options.services?.resolveAsset
    ?? ((assetId: string) => playback.assets[assetId]?.url)
  const audioEvents = new CourseEventBus()
  const audio = new AudioManager(
    playback,
    resolvePublishedAsset,
    audioEvents,
    options.staticCapture ? { mode: 'capture' } : {},
  )
  let session: PublishedInteractionCourseSession | null = null
  const restartCourse = (): Promise<boolean> => (
    session?.restartCourse() ?? Promise.resolve(false)
  )
  const replayScene = (): Promise<boolean> => (
    session?.replayCurrentLocationFromController() ?? Promise.resolve(false)
  )
  const executeTeacherControllerAction = (
    action: TeacherControllerAction,
  ): Promise<boolean | undefined> => (
    session?.executeTeacherControllerAction(action) ?? Promise.resolve(undefined)
  )
  const componentActions = createPlayerComponentHostActions({
    goToSceneById: (sceneId, targetStateId) => (
      session?.requestHostGoToScene(sceneId, targetStateId) ?? false
    ),
    nextStep: () => session?.requestPlaybackNavigation('step', 'next') ?? false,
    previousStep: () => session?.requestPlaybackNavigation('step', 'previous') ?? false,
    nextScene: () => session?.requestHostNextScene() ?? false,
    previousScene: () => session?.requestHostPreviousScene() ?? false,
    replayScene: () => session?.requestHostReplayScene() ?? false,
    restartCourse: () => session?.requestHostRestartCourse() ?? false,
  })
  const runtimeActions: Readonly<RuntimeHostActions> = componentActions
  const navigation: PlaybackNavigationViewPort = {
    getProgress: () => session?.getPlaybackProgress() ?? null,
    canExecute: action => session?.canExecuteNavigationAction(action) ?? false,
    subscribe: listener => session?.subscribeNavigation(listener) ?? (() => undefined),
  }
  const hosts = playback.surfaces.map((surface) => createPublishedSurfaceHostInternal(
    playback,
    surface.id,
    {
      viewport: options.viewport,
      resolveAsset: options.resolveAsset ?? options.services?.resolveAsset,
      playbackPathId: options.playbackPathId,
      globalInteractionVisibilityState,
      teacherControllerSession,
      navigation: options.staticCapture ? undefined : navigation,
      playbackView: playbackView ?? undefined,
      restartCourse,
      replayScene,
      executeTeacherControllerAction,
      deferTeacherControllerCourseReset: true,
      courseState,
      audio,
      audioEvents,
      ...(!options.staticCapture ? { runtimeActions, componentActions } : {}),
      staticCapture: options.staticCapture,
      includeGlobalLayerItemsForStaticCapture:
        options.includeGlobalLayerItemsForStaticCapture,
      onInteractionInvalidated: (surfaceId) => {
        session?.handleInteractionHostInvalidated(surfaceId)
      },
      onInteractionReady: (surfaceId) => {
        session?.handleInteractionHostReady(surfaceId)
      },
    },
  ))
  if (options.initialPresentationStateId !== undefined) {
    preparePublishedInitialPresentationState(
      playback,
      hosts,
      options.initialPresentationStateId,
    )
  }
  const services: SurfacePlayerServices = {
    ...defaultCourseStateServices(playback, courseState),
    ...options.services,
    getCourseState: (key) => courseState.get(key),
    setCourseState: (key, value) => courseState.set(key, value),
    resolveAsset: resolvePublishedAsset,
  }
  const player = new CoursePlayer(hosts, {
    services,
    onFailure: options.onFailure,
  })
  const mixedNavigator = new MixedCourseNavigator(
    mixedCourseDefinitionFromPublished(playback),
    player,
    {
      onBeforeNavigate: (transition) => {
        session?.assertNavigationAllowed(transition)
        session?.handleBeforeNavigation(transition)
      },
      onNavigate: (state) => {
        session?.handleNavigation(state)
      },
      onNavigationSettled: (state) => {
        session?.handleNavigationSettled(state)
      },
      onBeforeResetCourse: () => {
        resetPublishedCourseState(courseState, playback.courseState)
      },
      onResetCourse: () => {
        teacherControllerSession.resetCourse()
      },
    },
  )
  if (!options.services?.navigate) {
    services.navigate = async (deepLink) => {
      await mixedNavigator.navigateDeepLink(deepLink)
    }
  }
  const globalRuntimeOwner = new PublishedGlobalCanvasRuntimeOwner({
    payload: playback,
    hosts,
    services,
    resolveAsset: services.resolveAsset,
    staticCapture: options.staticCapture,
    courseState,
    ...(!options.staticCapture ? { runtimeActions } : {}),
  })
  session = new PublishedInteractionCourseSession(
    player,
    mixedNavigator,
    hosts,
    playback,
    services,
    globalInteractionVisibilityState,
    globalRuntimeOwner,
    courseState,
    audio,
    audioEvents,
    options.staticCapture === true,
    playbackView,
  )
  return session
}

/**
 * Maps teacher-controller navigation actions onto Published V2 location order.
 * Mute/fullscreen and unknown actions return null so the surface host can handle them.
 */
export function publishedControllerNavigationTarget(
  action: TeacherControllerAction,
  input: {
    locations: readonly CourseLocation[]
    currentLocationId: string
    startLocationId: string
  },
): CourseLocation | null {
  const { locations, currentLocationId, startLocationId } = input
  const index = locations.findIndex((location) => location.id === currentLocationId)
  const key = index >= 0 ? playbackSceneKey(locations[index]!) : null
  let first = index
  let last = index
  while (first > 0 && playbackSceneKey(locations[first - 1]!) === key) first--
  while (last >= 0 && last + 1 < locations.length && playbackSceneKey(locations[last + 1]!) === key) last++
  if (action.type === 'step.next') return index >= 0 ? locations[index + 1] ?? null : null
  if (action.type === 'step.previous') return index > 0 ? locations[index - 1]! : null
  if (action.type === 'scene.next') {
    return last >= 0 ? locations[last + 1] ?? null : null
  }
  if (action.type === 'scene.previous') {
    if (first <= 0) return null
    let previous = first - 1
    const previousKey = playbackSceneKey(locations[previous]!)
    while (previous > 0 && playbackSceneKey(locations[previous - 1]!) === previousKey) previous--
    return locations[previous]!
  }
  if (action.type === 'course.restart') {
    return locations.find((location) => location.id === startLocationId) ?? locations[0] ?? null
  }
  if (action.type === 'scene.replay') {
    return locations[first] ?? null
  }
  if (action.type === 'scene.go') {
    return locations.find((location) => (
      location.id === action.sceneId
      || (location.kind === 'slide-scene' && location.sceneId === action.sceneId)
      || (location.kind === 'flow-block' && location.blockId === action.sceneId)
      || (location.kind === 'spatial-camera' && location.cameraFrameId === action.sceneId)
    )) ?? null
  }
  return null
}

class FlowPublishedAdapter implements SurfaceHost {
  readonly kind = 'flow' as const
  readonly id: string
  readonly #host: FlowSurfaceHost
  readonly #payload: PublishedCourseV2Payload
  readonly #startLocationId: string
  readonly #restartCourse?: () => Promise<boolean>
  readonly #replayScene?: () => Promise<boolean>
  readonly #executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => Promise<boolean | undefined>
  #services: SurfacePlayerServices | null = null

  constructor(
    payload: PublishedCourseV2Payload,
    surfaceId: string,
    options: {
      locationId: string
      resolveAsset: (assetId: string) => string | undefined
      globalInteractionVisibilityState?: PublishedInteractionVisibilityState
      onInteractionInvalidated?: () => void
      onInteractionReady?: () => void
      teacherControllerSession?: TeacherControllerRuntimeSessionStore
  playbackView?: PlaybackViewSession
  navigation?: PlaybackNavigationViewPort
      restartCourse?: () => Promise<boolean>
      replayScene?: () => Promise<boolean>
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => Promise<boolean | undefined>
      deferTeacherControllerCourseReset?: boolean
      courseState?: CourseStateStore
      runtimeActions?: Readonly<RuntimeHostActions>
      componentActions?: Readonly<ComponentHostActions>
      audio?: AudioManager
    },
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = options.locationId
    this.#restartCourse = options.restartCourse
    this.#replayScene = options.replayScene
    this.#executeTeacherControllerAction = options.executeTeacherControllerAction
    this.#host = new FlowSurfaceHost(payload, {
      surfaceId,
      locationId: options.locationId,
      resolveAsset: options.resolveAsset,
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: options.onInteractionInvalidated,
      onInteractionReady: options.onInteractionReady,
      teacherControllerSession: options.teacherControllerSession,
      navigation: options.navigation,
      playbackView: options.playbackView,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      audio: options.audio,
      courseProgressSource: {
        getLocations: () => this.#payload.locations.map((location) => ({
          id: location.id,
          name: location.label,
        })),
        getCurrentLocationId: () => this.#host.locationId,
        getStateLabel: () => null,
      },
      executeTeacherControllerAction: (action) => this.#executeControllerAction(action),
      reportRuntimeError: (itemId, phase, error) => {
        this.#services?.reportDiagnostic?.({
          surfaceId: this.id,
          phase: 'mount',
          severity: 'error',
          message: `Runtime“${itemId}”${phase}失败：${error.message}`,
          cause: error,
        })
      },
      reportActionError: (action, error) => {
        this.#services?.reportDiagnostic?.({
          surfaceId: this.id,
          phase: 'execute',
          severity: 'error',
          message: `教师控制器动作“${action.type}”执行失败：${error.message}`,
          cause: error,
        })
      },
    })
  }

  async mount(context: SurfaceMountContext): Promise<void> {
    this.#services = context.services
    await this.#host.mount(context.container)
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#host.getPublishedInteractionSurfacePort()
  }

  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null {
    return this.#host.getPublishedGlobalRuntimeMountTarget(itemId)
  }

  preparePublishedLocation(locationId: string, forced: boolean): void {
    this.#host.preparePublishedLocation(locationId, forced)
  }

  async activate(): Promise<void> {
    await this.#host.activate()
  }

  async suspend(): Promise<void> {
    await this.#host.suspend()
  }

  async resume(): Promise<void> {
    await this.#host.resume()
  }

  async reset(scope: SurfaceResetScope): Promise<void> {
    await this.#host.reset(scope, this.#startLocationId)
  }

  async capture(_request: SurfaceCaptureRequest): Promise<SurfaceCapture> {
    return {
      format: 'json',
      content: JSON.stringify({
        surfaceId: this.id,
        locationId: this.#host.locationId,
      }),
    }
  }

  async setLocationId(locationId: string): Promise<void> {
    await this.#host.setLocationId(locationId)
  }

  getLocationId(): string {
    return this.#host.locationId
  }

  async destroy(): Promise<void> {
    await this.#host.destroy()
    this.#services = null
  }

  async #executeControllerAction(action: TeacherControllerAction): Promise<boolean | undefined> {
    if (this.#executeTeacherControllerAction) {
      const outcome = await this.#executeTeacherControllerAction(action)
      if (outcome !== undefined) return outcome
    }
    if (action.type === 'course.restart' && this.#restartCourse) {
      return this.#restartCourse()
    }
    if (action.type === 'scene.replay' && this.#replayScene) {
      return this.#replayScene()
    }
    const target = publishedControllerNavigationTarget(action, {
      locations: this.#payload.locations,
      currentLocationId: this.#host.locationId,
      startLocationId: this.#payload.startLocationId,
    })
    if (!target) return undefined
    if (action.type === 'course.restart') {
      this.#host.resetTeacherControllerSession('course')
      if (target.surfaceId === this.id) {
        await this.#host.setLocationId(target.id)
        return true
      }
    }
    await this.#services?.navigate(buildMixedDeepLink({
      locationId: target.id,
      surfaceId: target.surfaceId,
    }))
    return true
  }
}

class SpatialPublishedAdapter implements SurfaceHost {
  readonly kind = 'spatial-2d' as const
  readonly id: string
  readonly #host: SpatialSurfaceHost
  readonly #payload: PublishedCourseV2Payload
  readonly #startLocationId: string
  readonly #restartCourse?: () => Promise<boolean>
  readonly #replayScene?: () => Promise<boolean>
  readonly #executeTeacherControllerAction?: (
    action: TeacherControllerAction,
  ) => Promise<boolean | undefined>
  #services: SurfacePlayerServices | null = null

  constructor(
    payload: PublishedCourseV2Payload,
    surfaceId: string,
    options: {
      startLocationId: string
      viewport: { width: number; height: number }
      resolveAsset: (assetId: string) => string | undefined
      playbackPathId?: string | null
      globalInteractionVisibilityState?: PublishedInteractionVisibilityState
      onInteractionInvalidated?: () => void
      onInteractionReady?: () => void
      teacherControllerSession?: TeacherControllerRuntimeSessionStore
  playbackView?: PlaybackViewSession
  navigation?: PlaybackNavigationViewPort
      restartCourse?: () => Promise<boolean>
      replayScene?: () => Promise<boolean>
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => Promise<boolean | undefined>
      deferTeacherControllerCourseReset?: boolean
      courseState?: CourseStateStore
      runtimeActions?: Readonly<RuntimeHostActions>
      componentActions?: Readonly<ComponentHostActions>
      initialMuted?: boolean
      audioChangeSource?: CourseEventBus
      staticCapture?: boolean
      includeGlobalLayerItemsForStaticCapture?: boolean
    },
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = options.startLocationId
    this.#restartCourse = options.restartCourse
    this.#replayScene = options.replayScene
    this.#executeTeacherControllerAction = options.executeTeacherControllerAction
    this.#host = SpatialSurfaceHost.fromPublishedCourse(payload, options.viewport, {
      surfaceId,
      locationId: options.startLocationId,
      resolveAsset: options.resolveAsset,
      playbackPathId: options.playbackPathId ?? null,
      playbackControls: payload.playback.controls === 'none' ? 'none' : 'canvas',
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: options.onInteractionInvalidated,
      onInteractionReady: options.onInteractionReady,
      teacherControllerSession: options.teacherControllerSession,
      navigation: options.navigation,
      playbackView: options.playbackView,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      initialMuted: options.initialMuted,
      audioChangeSource: options.audioChangeSource,
      staticCapture: options.staticCapture,
      includeGlobalLayerItemsForStaticCapture:
        options.includeGlobalLayerItemsForStaticCapture,
      courseProgressSource: {
        getLocations: () => this.#payload.locations.map((location) => ({
          id: location.id,
          name: location.label,
        })),
        getCurrentLocationId: () => this.#host.locationId,
        getStateLabel: () => null,
      },
      executeTeacherControllerAction: (action) => this.#executeControllerAction(action),
      reportActionError: (action, error) => {
        this.#services?.reportDiagnostic?.({
          surfaceId: this.id,
          phase: 'execute',
          severity: 'error',
          message: `教师控制器动作“${action.type}”执行失败：${error.message}`,
          cause: error,
        })
      },
    })
  }

  async mount(context: SurfaceMountContext): Promise<void> {
    this.#services = context.services
    await this.#host.mount(context.container)
    const root = this.#host.rootElement
    if (root) root.hidden = true
  }

  getPublishedInteractionSurfacePort(): PublishedInteractionSurfacePort | null {
    return this.#host.getPublishedInteractionSurfacePort()
  }

  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null {
    return this.#host.getPublishedGlobalRuntimeMountTarget(itemId)
  }

  preparePublishedLocation(locationId: string, forced: boolean): void {
    this.#host.preparePublishedLocation(locationId, forced)
  }

  async activate(): Promise<void> {
    await this.#host.activate()
  }

  async suspend(): Promise<void> {
    await this.#host.suspend()
  }

  async resume(): Promise<void> {
    await this.#host.resume()
  }

  async reset(scope: SurfaceResetScope): Promise<void> {
    this.#host.resetTeacherControllerSession(scope)
    this.#host.preparePublishedLocation(this.#startLocationId, true)
    await this.#host.setLocationId(this.#startLocationId)
  }

  async capture(request: SurfaceCaptureRequest): Promise<SurfaceCapture> {
    return this.#host.capture(request)
  }

  async setLocationId(locationId: string): Promise<void> {
    await this.#host.setLocationId(locationId)
  }

  getLocationId(): string {
    return this.#host.locationId
  }

  async destroy(): Promise<void> {
    await this.#host.destroy()
    this.#services = null
  }

  async #executeControllerAction(action: TeacherControllerAction): Promise<boolean | undefined> {
    if (this.#executeTeacherControllerAction) {
      const outcome = await this.#executeTeacherControllerAction(action)
      if (outcome !== undefined) return outcome
    }
    if (action.type === 'course.restart' && this.#restartCourse) {
      return this.#restartCourse()
    }
    if (action.type === 'scene.replay' && this.#replayScene) {
      return this.#replayScene()
    }
    const target = publishedControllerNavigationTarget(action, {
      locations: this.#payload.locations,
      currentLocationId: this.#host.locationId,
      startLocationId: this.#payload.startLocationId,
    })
    if (!target) return undefined
    if (action.type === 'course.restart') {
      this.#host.resetTeacherControllerSession('course')
      if (target.surfaceId === this.id) {
        await this.#host.setLocationId(target.id)
        return true
      }
    }
    await this.#services?.navigate(buildMixedDeepLink({
      locationId: target.id,
      surfaceId: target.surfaceId,
    }))
    return true
  }
}

export type { SurfaceKind }
