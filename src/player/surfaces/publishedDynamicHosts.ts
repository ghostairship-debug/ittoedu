import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import type { TeacherControllerAction } from '../../shared/projectTypes'
import type { CourseLocation } from '../../shared/courseProjectTypes'
import type { PublishedCourseSurface, PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'
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
import { SlidePublishedAdapter } from './slide/SlidePublishedAdapter'
import { SpatialSurfaceHost } from './spatial/SpatialSurfaceHost'
import { PublishedGlobalCanvasRuntimeOwner } from './runtime/publishedGlobalCanvasRuntimeOwner'
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
  /** Mixed reset commits the shared controller authority only after all hosts reset. */
  deferTeacherControllerCourseReset?: boolean
}

type CreatePublishedSurfaceHostOptions = CreatePublishedDynamicHostsOptions
  & PublishedInteractionHostFactoryOptions

export interface PublishedCourseSessionOptions extends CreatePublishedDynamicHostsOptions {
  /** Ephemeral session start; never mutates the caller's Published payload. */
  initialLocationId?: string
  services?: Partial<SurfacePlayerServices>
  onFailure?: CoursePlayerOptions['onFailure']
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
        if (action.type !== 'course.restart' || !options.restartCourse) return false
        return options.restartCourse()
      },
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
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
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
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
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
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
): SurfacePlayerServices {
  const state = new Map<string, unknown>()
  return {
    navigate: () => undefined,
    getCourseState: (key) => state.get(key),
    setCourseState: (key, value) => {
      state.set(key, value)
    },
    resolveAsset: (assetId) => payload.assets[assetId]?.url,
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
  #slots: HTMLElement[] = []
  #destroyPromise: Promise<void> | null = null
  #publicReplayAbortController: AbortController | null = null
  #publicReplaySettlement: Promise<boolean> | null = null

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner | null = null,
  ) {
    this.player = player
    this.navigator = navigator
    this.#hosts = hosts
    this.#globalRuntimeOwner = globalRuntimeOwner
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
    this.#globalRuntimeOwner?.restart()
    try {
      await this.navigator.resetCourse()
      return true
    } catch (error) {
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
    this.#globalRuntimeOwner?.mount(container.ownerDocument)
    await this.navigator.start()
    this.syncActiveSlot(this.navigator.current?.surfaceId ?? this.#hosts[0]?.id ?? '')
  }

  syncActiveSlot(surfaceId: string): void {
    for (const slot of this.#slots) {
      const active = slot.dataset.courseSurfaceSlot === surfaceId
      slot.style.visibility = active ? 'visible' : 'hidden'
      slot.style.pointerEvents = active ? 'auto' : 'none'
      slot.style.zIndex = active ? '1' : '0'
      if (active) slot.removeAttribute('aria-hidden')
      else slot.setAttribute('aria-hidden', 'true')
    }
  }

  protected movePublishedGlobalRuntimes(surfaceId: string): void {
    this.#globalRuntimeOwner?.moveTo(surfaceId)
  }

  protected restartPublishedGlobalRuntimes(): void {
    this.#globalRuntimeOwner?.restart()
  }

  async destroy(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise
    const replaySettlement = this.#publicReplaySettlement
    this.#publicReplayAbortController?.abort()
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
    for (const slot of this.#slots) slot.remove()
    this.#slots = []
  }
}

/** Internal coordinator; the exported session keeps its original product API. */
class PublishedInteractionCourseSession extends PublishedCourseSession {
  readonly #hostsById: ReadonlyMap<string, SurfaceHost>
  readonly #payload: PublishedCourseV2Payload
  readonly #services: SurfacePlayerServices
  readonly #globalInteractionVisibilityState: PublishedInteractionVisibilityState
  readonly #interactionSessionPort: PublishedInteractionSessionPort
  #globalInteractionController: PublishedInteractionController | null = null
  #localInteractionController: PublishedInteractionController | null = null
  #terminalNavigationClaimed = false
  #terminalNavigationInvalidated = false
  #interactionDestroyStarted = false

  constructor(
    player: CoursePlayer,
    navigator: MixedCourseNavigator,
    hosts: readonly SurfaceHost[],
    payload: PublishedCourseV2Payload,
    services: SurfacePlayerServices,
    globalInteractionVisibilityState: PublishedInteractionVisibilityState,
    globalRuntimeOwner: PublishedGlobalCanvasRuntimeOwner,
  ) {
    super(player, navigator, hosts, globalRuntimeOwner)
    this.#hostsById = new Map(hosts.map((host) => [host.id, host]))
    this.#payload = payload
    this.#services = services
    this.#globalInteractionVisibilityState = globalInteractionVisibilityState
    this.#interactionSessionPort = {
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
    if (this.#interactionDestroyStarted) return
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
    this.restartPublishedGlobalRuntimes()
    try {
      await this.navigator.resetCourse({ signal })
      this.#globalInteractionVisibilityState.reset()
      return true
    } catch (error) {
      const currentSurfaceId = this.navigator.current?.surfaceId
      if (currentSurfaceId) this.movePublishedGlobalRuntimes(currentSurfaceId)
      this.#releaseTerminalNavigationClaim()
      throw error
    }
  }
}

export function createPublishedCourseSession(
  payload: PublishedCourseV2Payload,
  options: PublishedCourseSessionOptions = {},
): PublishedCourseSession {
  const playback = structuredClone(payload)
  if (options.initialLocationId !== undefined) {
    const initialLocation = playback.locations.find((location) => (
      location.id === options.initialLocationId
    ))
    if (!initialLocation) {
      throw new Error(`Unknown Published session start location: ${options.initialLocationId}`)
    }
    playback.startLocationId = initialLocation.id
  }
  const globalInteractionVisibilityState = new PublishedInteractionVisibilityState()
  const teacherControllerSession = new TeacherControllerRuntimeSessionStore()
  let session: PublishedInteractionCourseSession | null = null
  const restartCourse = (): Promise<boolean> => (
    session?.restartCourse() ?? Promise.resolve(false)
  )
  const replayScene = (): Promise<boolean> => (
    session?.replayScene() ?? Promise.resolve(false)
  )
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
      deferTeacherControllerCourseReset: true,
      onInteractionInvalidated: (surfaceId) => {
        session?.handleInteractionHostInvalidated(surfaceId)
      },
      onInteractionReady: (surfaceId) => {
        session?.handleInteractionHostReady(surfaceId)
      },
    },
  ))
  const services: SurfacePlayerServices = {
    ...defaultCourseStateServices(playback),
    ...options.services,
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
        session?.handleBeforeNavigation(transition)
      },
      onNavigate: (state) => {
        session?.handleNavigation(state)
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
  })
  session = new PublishedInteractionCourseSession(
    player,
    mixedNavigator,
    hosts,
    playback,
    services,
    globalInteractionVisibilityState,
    globalRuntimeOwner,
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
      deferTeacherControllerCourseReset?: boolean
    },
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = options.locationId
    this.#restartCourse = options.restartCourse
    this.#host = new FlowSurfaceHost(payload, {
      surfaceId,
      locationId: options.locationId,
      resolveAsset: options.resolveAsset,
      globalInteractionVisibilityState: options.globalInteractionVisibilityState,
      onInteractionInvalidated: options.onInteractionInvalidated,
      onInteractionReady: options.onInteractionReady,
      teacherControllerSession: options.teacherControllerSession,
      deferTeacherControllerCourseReset: options.deferTeacherControllerCourseReset,
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
    if (action.type === 'course.restart' && this.#restartCourse) {
      return this.#restartCourse()
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
      deferTeacherControllerCourseReset?: boolean
    },
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = options.startLocationId
    this.#restartCourse = options.restartCourse
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
      courseProgressSource: {
        getLocations: () => this.#payload.locations.map((location) => ({
          id: location.id,
          name: location.label,
        })),
        getCurrentLocationId: () => this.#host.locationId,
        getStateLabel: () => null,
      },
      executeTeacherControllerAction: (action) => this.#executeControllerAction(action),
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
    if (action.type === 'course.restart' && this.#restartCourse) {
      return this.#restartCourse()
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
