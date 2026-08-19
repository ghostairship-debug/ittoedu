import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import type { TeacherControllerAction } from '../../shared/projectTypes'
import type { CourseLocation } from '../../shared/courseProjectTypes'
import type { PublishedCourseSurface, PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'
import { CoursePlayer, type CoursePlayerOptions } from './CoursePlayer'
import { FlowSurfaceHost } from './flow/FlowSurfaceHost'
import {
  MixedCourseNavigator,
  buildMixedDeepLink,
  mixedCourseDefinitionFromPublished,
  type MixedCatalogEntry,
  type MixedCourseProgress,
  type MixedNavigationState,
} from './mixed/MixedCourseNavigator'
import { SlidePublishedAdapter } from './slide/SlidePublishedAdapter'
import { SpatialSurfaceHost } from './spatial/SpatialSurfaceHost'
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

export interface PublishedCourseSessionOptions extends CreatePublishedDynamicHostsOptions {
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
  const surface = payload.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) throw new Error(`Unknown published surface: ${surfaceId}`)
  const startLocationId = firstPublishedLocationId(payload, surfaceId)
  const resolveAsset = options.resolveAsset
    ?? ((assetId: string) => payload.assets[assetId]?.url)
  const kind = publishedDynamicHostKind(surface.type)
  if (kind === 'slide') {
    return new SlidePublishedAdapter(payload, surface.id, {
      locationId: startLocationId,
      resolveAsset,
    })
  }
  if (kind === 'flow') {
    return new FlowPublishedAdapter(payload, surface.id, startLocationId, resolveAsset)
  }
  return new SpatialPublishedAdapter(
    payload,
    surface.id,
    startLocationId,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    resolveAsset,
    options.playbackPathId,
  )
}

export function createPublishedSurfaceHosts(
  payload: PublishedCourseV2Payload,
  options: CreatePublishedDynamicHostsOptions = {},
): SurfaceHost[] {
  return payload.surfaces.map((surface) => (
    createPublishedSurfaceHost(payload, surface.id, options)
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

/** Mixed try-run / whole-course preview session. Does not write CourseProjectDocument. */
export class PublishedCourseSession {
  readonly player: CoursePlayer
  readonly navigator: MixedCourseNavigator
  readonly #hosts: readonly SurfaceHost[]
  #slots: HTMLElement[] = []
  #destroyPromise: Promise<void> | null = null

  constructor(player: CoursePlayer, navigator: MixedCourseNavigator, hosts: readonly SurfaceHost[]) {
    this.player = player
    this.navigator = navigator
    this.#hosts = hosts
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

  async destroy(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise
    this.#destroyPromise = this.#runDestroy()
    return this.#destroyPromise
  }

  async #runDestroy(): Promise<void> {
    await this.player.destroy()
    for (const slot of this.#slots) slot.remove()
    this.#slots = []
  }
}

export function createPublishedCourseSession(
  payload: PublishedCourseV2Payload,
  options: PublishedCourseSessionOptions = {},
): PublishedCourseSession {
  const playback = structuredClone(payload)
  const hosts = createPublishedSurfaceHosts(playback, {
    viewport: options.viewport,
    resolveAsset: options.resolveAsset ?? options.services?.resolveAsset,
    playbackPathId: options.playbackPathId,
  })
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
  let session: PublishedCourseSession | null = null
  const navigator = new MixedCourseNavigator(
    mixedCourseDefinitionFromPublished(playback),
    player,
    {
      onNavigate: (state) => {
        session?.syncActiveSlot(state.surfaceId)
      },
    },
  )
  if (!options.services?.navigate) {
    services.navigate = async (deepLink) => {
      await navigator.navigateDeepLink(deepLink)
    }
  }
  session = new PublishedCourseSession(player, navigator, hosts)
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
  #services: SurfacePlayerServices | null = null

  constructor(
    payload: PublishedCourseV2Payload,
    surfaceId: string,
    startLocationId: string,
    resolveAsset: (assetId: string) => string | undefined,
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = startLocationId
    this.#host = new FlowSurfaceHost(payload, {
      surfaceId,
      locationId: startLocationId,
      resolveAsset,
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

  async reset(_scope: SurfaceResetScope): Promise<void> {
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
    const target = publishedControllerNavigationTarget(action, {
      locations: this.#payload.locations,
      currentLocationId: this.#host.locationId,
      startLocationId: this.#payload.startLocationId,
    })
    if (!target) return false
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
  #services: SurfacePlayerServices | null = null

  constructor(
    payload: PublishedCourseV2Payload,
    surfaceId: string,
    startLocationId: string,
    viewport: { width: number; height: number },
    resolveAsset: (assetId: string) => string | undefined,
    playbackPathId?: string | null,
  ) {
    this.id = surfaceId
    this.#payload = payload
    this.#startLocationId = startLocationId
    this.#host = SpatialSurfaceHost.fromPublishedCourse(payload, viewport, {
      surfaceId,
      locationId: startLocationId,
      resolveAsset,
      playbackPathId: playbackPathId ?? null,
      playbackControls: payload.playback.controls === 'none' ? 'none' : 'canvas',
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

  async activate(): Promise<void> {
    await this.#host.activate()
  }

  async suspend(): Promise<void> {
    await this.#host.suspend()
  }

  async resume(): Promise<void> {
    await this.#host.resume()
  }

  async reset(_scope: SurfaceResetScope): Promise<void> {
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
    const target = publishedControllerNavigationTarget(action, {
      locations: this.#payload.locations,
      currentLocationId: this.#host.locationId,
      startLocationId: this.#payload.startLocationId,
    })
    if (!target) return false
    await this.#services?.navigate(buildMixedDeepLink({
      locationId: target.id,
      surfaceId: target.surfaceId,
    }))
    return true
  }
}

export type { SurfaceKind }
