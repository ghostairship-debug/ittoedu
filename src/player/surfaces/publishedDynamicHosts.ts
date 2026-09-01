import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import type { TeacherControllerAction } from '../../shared/projectTypes'
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
      replayScene: options.replayScene,
      executeTeacherControllerAction: async (action) => {
        if (options.executeTeacherControllerAction) {
          const outcome = await options.executeTeacherControllerAction(action)
          if (outcome !== undefined) return true
        }
        if (action.type !== 'course.restart' || !options.restartCourse) return false
        return options.restartCourse()
      },
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
      ...(options.authoring ? { authoring: options.authoring } : {}),
      staticCapture: options.staticCapture,
      includeGlobalLayerItemsForStaticCapture:
        options.includeGlobalLayerItemsForStaticCapture,
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
      restartCourse: options.restartCourse,
      replayScene: options.replayScene,
      executeTeacherControllerAction: options.executeTeacherControllerAction,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
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
      restartCourse: options.restartCourse,
      replayScene: options.replayScene,
      executeTeacherControllerAction: options.executeTeacherControllerAction,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
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

class FrozenPublishedCourseStateStore extends CourseStateStore {
  constructor(declarations: PublishedCourseV2Payload['courseState']) {
    super()
    for (const declaration of declarations) {
      super.set(declaration.key, structuredClone(declaration.defaultValue))
    }
  }

  override set(_key: string, _value: unknown): void {}

  override delete(_key: string): void {}

  override clear(): void {}
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
  #slots: HTMLElement[] = []
  #destroyPromise: Promise<void> | null = null
  #publicReplayAbortController: AbortController | null = null
  #publicReplaySettlement: Promise<boolean> | null = null
  #navigationFeedback: HTMLElement | null = null

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner | null = null,
    authoringCoordinator: PublishedAuthoringSessionCoordinator | null = null,
  ) {
    this.player = player
    this.navigator = navigator
    this.#hosts = hosts
    this.#globalRuntimeOwner = globalRuntimeOwner
    this.#authoringCoordinator = authoringCoordinator
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

  goToIndex(index: number): Promise<MixedNavigationState> {
    return this.navigator.goToIndex(index)
  }

  /** Synchronous acceptance guard for the public Slide replay entry. */
  canReplayScene(): boolean {
    return this.#publicReplayAbortController === null
      && !this.navigator.hasPendingNavigation
      && this.canForceReplayCurrentLocation()
      && this.navigator.current?.kind === 'slide'
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
    for (const host of this.#hosts) {
      const slot = container.ownerDocument.createElement('div')
      slot.dataset.courseSurfaceSlot = host.id
      slot.style.position = 'absolute'
      slot.style.inset = '0'
      slot.style.width = '100%'
      slot.style.height = '100%'
      slot.style.overflow = 'hidden'
      slot.style.visibility = 'hidden'
      slot.style.pointerEvents = 'none'
      slot.style.zIndex = '0'
      slot.setAttribute('aria-hidden', 'true')
      container.appendChild(slot)
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
    for (const slot of this.#slots) {
      const active = slot.dataset.courseSurfaceSlot === surfaceId
      slot.style.visibility = active ? 'visible' : 'hidden'
      slot.style.pointerEvents = active && !this.#authoringCoordinator ? 'auto' : 'none'
      slot.style.zIndex = active ? '1' : '0'
      slot.inert = this.#authoringCoordinator !== null
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
    this.#navigationFeedback?.remove()
    this.#navigationFeedback = null
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
  readonly #staticCapture: boolean
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  readonly #interactionSessionPort: PublishedInteractionSessionPort
  #globalInteractionController: PublishedInteractionController | null = null
  #localInteractionController: PublishedInteractionController | null = null
  #terminalNavigationClaimed = false
  #terminalNavigationInvalidated = false
  #interactionDestroyStarted = false
  #navigationGuardBypassTargetId: string | null = null

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    payload: PublishedCourseV2Payload,
    services: SurfacePlayerServices,
    globalInteractionVisibilityState: PublishedInteractionVisibilityState,
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner,
    courseState: CourseStateStore,
    staticCapture: boolean,
  ) {
    super(player, navigator, hosts, globalRuntimeOwner)
    this.#hostsById = new Map(hosts.map((host) => [host.id, host]))
    this.#payload = payload
    this.#services = services
    this.#courseState = courseState
    this.#staticCapture = staticCapture
    this.#globalInteractionVisibilityState = globalInteractionVisibilityState
    this.#interactionSessionPort = {
      courseState: this.#courseState,
      currentSceneId: () => this.#currentSlideSceneId(),
      goToScene: (sceneId, targetStateId, signal) => (
        this.#goToScene(sceneId, targetStateId, signal)
      ),
      nextScene: (signal) => this.#nextScene(signal),
      previousScene: (signal) => this.#previousScene(signal),
      replayScene: (signal) => this.#replayScene(signal),
      restartCourse: (signal) => this.#restartCourse(signal),
    }
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

  requestHostNextScene(): boolean {
    if (!this.#canAcceptHostAction()) return false
    const current = this.navigator.current
    const target = current ? this.navigator.listCatalog()[current.index + 1] : undefined
    if (!target || !this.#acceptNavigationTarget(target.id, target.surfaceId)) return false
    this.#launchHostAction('nextScene', this.#nextScene(new AbortController().signal))
    return true
  }

  requestHostPreviousScene(): boolean {
    if (!this.#canAcceptHostAction()) return false
    const current = this.navigator.current
    const target = current ? this.navigator.listCatalog()[current.index - 1] : undefined
    if (!target || !this.#acceptNavigationTarget(target.id, target.surfaceId)) return false
    this.#launchHostAction('previousScene', this.#previousScene(new AbortController().signal))
    return true
  }

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
    if (action.type === 'course.restart') {
      return this.#restartCourse(new AbortController().signal)
    }
    if (action.type === 'scene.replay') {
      return this.#replayScene(new AbortController().signal)
    }
    if (
      action.type !== 'scene.go'
      && action.type !== 'scene.next'
      && action.type !== 'scene.previous'
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
    if (transition) {
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
    this.#mountInteractionControllers()
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
    await super.destroy()
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
    if (shouldRemount && !this.#interactionDestroyStarted) {
      this.#mountInteractionControllers()
    }
  }

  async #goToScene(
    sceneId: string,
    targetStateId: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false
    const location = this.#slideLocationForScene(sceneId)
    if (!location) return false
    const current = this.navigator.current
    if (targetStateId === undefined && current?.locationId === location.id) return false
    const targetHost = interactionCapableHost(this.#hostsById.get(location.surfaceId))
    if (
      !targetHost?.validatePublishedPresentationState
      || !targetHost.validatePublishedPresentationState(location.id, targetStateId)
    ) return false
    if (!this.#claimTerminalNavigation(signal)) return false
    try {
      await this.navigator.goToLocation(location.id, {
        force: targetStateId !== undefined,
        recordHistory: current?.locationId !== location.id,
        signal,
        prepareTransition: () => {
          if (
            !targetHost.preparePublishedPresentationState
            || !targetHost.preparePublishedPresentationState(location.id, targetStateId)
          ) throw new Error(`Unable to prepare Published scene state for ${location.id}`)
        },
      })
      return true
    } catch (error) {
      targetHost.cancelPreparedPublishedPresentationState?.(location.id)
      this.#releaseTerminalNavigationClaim()
      throw error
    }
  }

  async #nextScene(signal: AbortSignal): Promise<boolean> {
    const current = this.navigator.current
    if (!current || current.index >= current.total - 1) return false
    const target = this.navigator.listCatalog()[current.index + 1]
    if (!target) return false
    if (!this.#claimTerminalNavigation(signal)) return false
    try {
      await this.navigator.goToLocation(target.id, { signal })
      return true
    } catch (error) {
      this.#releaseTerminalNavigationClaim()
      throw error
    }
  }

  async #previousScene(signal: AbortSignal): Promise<boolean> {
    const current = this.navigator.current
    if (!current || current.index <= 0) return false
    const target = this.navigator.listCatalog()[current.index - 1]
    if (!target) return false
    if (!this.#claimTerminalNavigation(signal)) return false
    try {
      await this.navigator.goToLocation(target.id, { signal })
      return true
    } catch (error) {
      this.#releaseTerminalNavigationClaim()
      throw error
    }
  }

  async #navigateFromTeacherController(
    target: CourseLocation,
    targetStateId: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false
    const current = this.navigator.current
    if (!current || (current.locationId === target.id && targetStateId === undefined)) return false
    const targetHost = target.kind === 'slide-scene'
      ? interactionCapableHost(this.#hostsById.get(target.surfaceId))
      : null
    if (
      targetStateId !== undefined
      && (
        target.kind !== 'slide-scene'
        || !targetHost?.validatePublishedPresentationState
        || !targetHost.validatePublishedPresentationState(target.id, targetStateId)
      )
    ) return false
    if (!this.#claimTerminalNavigation(signal)) return false
    this.#navigationGuardBypassTargetId = target.id
    try {
      await this.navigator.goToLocation(target.id, {
        force: targetStateId !== undefined,
        recordHistory: current.locationId !== target.id,
        signal,
        ...(targetStateId !== undefined
          ? {
              prepareTransition: () => {
                if (
                  !targetHost?.preparePublishedPresentationState
                  || !targetHost.preparePublishedPresentationState(target.id, targetStateId)
                ) throw new Error(`Unable to prepare Published scene state for ${target.id}`)
              },
            }
          : {}),
      })
      return true
    } catch (error) {
      if (targetStateId !== undefined) {
        targetHost?.cancelPreparedPublishedPresentationState?.(target.id)
      }
      this.#releaseTerminalNavigationClaim()
      throw error
    } finally {
      this.#navigationGuardBypassTargetId = null
    }
  }

  async #replayScene(signal: AbortSignal): Promise<boolean> {
    if (
      this.#interactionDestroyStarted
      || this.#terminalNavigationClaimed
      || !this.canForceReplayCurrentLocation()
    ) return false
    return this.#forceReplayCurrentLocation(signal)
  }

  async #forceReplayCurrentLocation(signal: AbortSignal): Promise<boolean> {
    if (!this.#claimTerminalNavigation(signal)) return false
    try {
      return await this.forceReplayCurrentLocation(signal)
    } catch (error) {
      this.#releaseTerminalNavigationClaim()
      throw error
    }
  }

  async #restartCourse(signal: AbortSignal): Promise<boolean> {
    if (!this.navigator.current || !this.#claimTerminalNavigation(signal)) return false
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
  const frozenCourseState = new FrozenPublishedCourseStateStore(playback.courseState)
  const resolveAsset = options.resolveAsset
    ?? options.services?.resolveAsset
    ?? ((assetId: string) => playback.assets[assetId]?.url)
  const services: SurfacePlayerServices = {
    ...defaultCourseStateServices(playback, frozenCourseState),
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
    applyAuthoringPatch: async (context, patch) => {
      if (patch.kind !== 'runtime-content' || patch.target.scope !== 'global') {
        return host.applyAuthoringPatch(context, patch)
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
  const courseState: CourseStateStore = options.staticCapture
    ? new FrozenPublishedCourseStateStore(playback.courseState)
    : new CourseStateStore()
  if (!options.staticCapture) resetPublishedCourseState(courseState, playback.courseState)
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
    nextScene: () => session?.requestHostNextScene() ?? false,
    previousScene: () => session?.requestHostPreviousScene() ?? false,
    replayScene: () => session?.requestHostReplayScene() ?? false,
    restartCourse: () => session?.requestHostRestartCourse() ?? false,
  })
  const runtimeActions: Readonly<RuntimeHostActions> = componentActions
  const hosts = playback.surfaces.map((surface) => createPublishedSurfaceHostInternal(
    playback,
    surface.id,
    {
      viewport: options.viewport,
      resolveAsset: options.resolveAsset ?? options.services?.resolveAsset,
      playbackPathId: options.playbackPathId,
      globalInteractionVisibilityState,
      teacherControllerSession,
      restartCourse,
      replayScene,
      executeTeacherControllerAction,
      deferTeacherControllerCourseReset: true,
      courseState,
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
    resolveAsset: options.resolveAsset
      ?? options.services?.resolveAsset
      ?? ((assetId) => playback.assets[assetId]?.url),
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
    options.staticCapture === true,
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
  if (action.type === 'scene.next') {
    return index >= 0 && index < locations.length - 1 ? locations[index + 1]! : null
  }
  if (action.type === 'scene.previous') {
    return index > 0 ? locations[index - 1]! : null
  }
  if (action.type === 'course.restart') {
    return locations.find((location) => location.id === startLocationId) ?? locations[0] ?? null
  }
  if (action.type === 'scene.replay') {
    return locations[index] ?? locations.find((location) => location.id === currentLocationId) ?? null
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
      restartCourse?: () => Promise<boolean>
      replayScene?: () => Promise<boolean>
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => Promise<boolean | undefined>
      deferTeacherControllerCourseReset?: boolean
      courseState?: CourseStateStore
      runtimeActions?: Readonly<RuntimeHostActions>
      componentActions?: Readonly<ComponentHostActions>
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
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
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

  async #executeControllerAction(action: TeacherControllerAction): Promise<boolean> {
    if (this.#executeTeacherControllerAction) {
      const outcome = await this.#executeTeacherControllerAction(action)
      if (outcome !== undefined) return true
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
    if (!target) return false
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
      restartCourse?: () => Promise<boolean>
      replayScene?: () => Promise<boolean>
      executeTeacherControllerAction?: (
        action: TeacherControllerAction,
      ) => Promise<boolean | undefined>
      deferTeacherControllerCourseReset?: boolean
      courseState?: CourseStateStore
      runtimeActions?: Readonly<RuntimeHostActions>
      componentActions?: Readonly<ComponentHostActions>
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
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
      componentActions: options.componentActions,
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

  async #executeControllerAction(action: TeacherControllerAction): Promise<boolean> {
    if (this.#executeTeacherControllerAction) {
      const outcome = await this.#executeTeacherControllerAction(action)
      if (outcome !== undefined) return true
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
    if (!target) return false
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
