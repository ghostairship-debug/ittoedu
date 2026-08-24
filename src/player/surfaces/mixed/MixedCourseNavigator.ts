import type { CoursePlayer } from '../CoursePlayer'
import type { SurfaceKind, SurfaceOperationResult } from '../SurfaceHost'
import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'

export interface MixedLocationEntry {
  id: string
  surfaceId: string
  kind: SurfaceKind
  label: string
}

export interface MixedCourseDefinition {
  id: string
  title: string
  startLocationId: string
  locations: MixedLocationEntry[]
}

export interface MixedDeepLink {
  locationId: string
  surfaceId?: string
}

export interface MixedNavigationState {
  locationId: string
  surfaceId: string
  kind: SurfaceKind
  index: number
  total: number
  previousLocationId?: string
  previousSurfaceId?: string
}

export interface MixedNavigationIdentity {
  locationId: string
  surfaceId: string
  kind: SurfaceKind
  index: number
  total: number
}

export interface MixedNavigationTransition {
  current: MixedNavigationIdentity | null
  next: MixedNavigationIdentity
  forced: boolean
}

export interface MixedNavigationRequestOptions {
  recordHistory?: boolean
  force?: boolean
  /** Checked when queued work begins; later teardown may abort it without cancelling its own transition. */
  signal?: AbortSignal
  /** Internal request-local preparation after the dequeue guard and before host mutation. */
  prepareTransition?: () => void
}

export interface MixedCourseProgress {
  index: number
  total: number
  locationId: string
  surfaceId: string
  ratio: number
  atStart: boolean
  atEnd: boolean
}

export interface MixedCatalogEntry extends MixedLocationEntry {
  index: number
}

export interface MixedCoursePlayerPort {
  readonly activeSurfaceId: string | null
  activateSurface(surfaceId: string): Promise<SurfaceOperationResult>
  resetSurface(surfaceId: string, scope?: 'surface' | 'course'): Promise<SurfaceOperationResult>
  resetCourse(): Promise<readonly SurfaceOperationResult[]>
  /** Optional: release the previous Mixed surface session without destroying the host. */
  releaseSurfaceSession?(surfaceId: string): Promise<SurfaceOperationResult>
  setSurfaceLocation?(surfaceId: string, locationId: string): Promise<SurfaceOperationResult>
}

export interface MixedCourseNavigatorOptions {
  onBeforeNavigate?: (transition: MixedNavigationTransition) => void | Promise<void>
  onNavigate?: (state: MixedNavigationState) => void | Promise<void>
}

function assertStableId(id: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new Error(`${label} must be a stable non-empty id`)
  }
}

function assertNavigationNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Mixed course navigation was aborted before it began')
  error.name = 'AbortError'
  throw error
}

export function mixedCourseDefinitionFromPublished(
  payload: PublishedCourseV2Payload,
): MixedCourseDefinition {
  if (payload.locations.length === 0) {
    throw new Error('A mixed course needs at least one location')
  }
  const surfaces = new Map(payload.surfaces.map((surface) => [surface.id, surface]))
  return {
    id: payload.courseId,
    title: payload.title,
    startLocationId: payload.startLocationId,
    locations: payload.locations.map((location) => {
      const surface = surfaces.get(location.surfaceId)
      if (!surface) {
        throw new Error(`Published location ${location.id} is missing surface ${location.surfaceId}`)
      }
      return {
        id: location.id,
        surfaceId: location.surfaceId,
        kind: surface.type,
        label: location.label,
      }
    }),
  }
}

export function buildMixedDeepLink(link: MixedDeepLink): string {
  assertStableId(link.locationId, 'locationId')
  const params = new URLSearchParams({ location: link.locationId })
  if (link.surfaceId !== undefined) {
    assertStableId(link.surfaceId, 'surfaceId')
    params.set('surface', link.surfaceId)
  }
  return `#${params.toString()}`
}

export function parseMixedDeepLink(value: string): MixedDeepLink | null {
  const hashIndex = value.indexOf('#')
  const query = (hashIndex >= 0 ? value.slice(hashIndex + 1) : value).replace(/^\?/, '')
  const params = new URLSearchParams(query)
  const locationId = params.get('location')
  const surfaceId = params.get('surface') ?? undefined
  if (!locationId && !surfaceId) return null
  try {
    if (locationId) assertStableId(locationId, 'locationId')
    if (surfaceId !== undefined) assertStableId(surfaceId, 'surfaceId')
    if (!locationId) return { locationId: surfaceId!, surfaceId }
    return { locationId, ...(surfaceId ? { surfaceId } : {}) }
  } catch {
    return null
  }
}

/** Course-level navigation over ordered Published V2 locations. */
export class MixedCourseNavigator {
  readonly #course: MixedCourseDefinition
  readonly #player: MixedCoursePlayerPort
  readonly #onBeforeNavigate?: MixedCourseNavigatorOptions['onBeforeNavigate']
  readonly #onNavigate?: MixedCourseNavigatorOptions['onNavigate']
  readonly #locationMap: Map<string, MixedLocationEntry>
  #current: MixedLocationEntry | null = null
  #history: string[] = []
  #queue: Promise<unknown> = Promise.resolve()

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work, work)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }

  constructor(
    course: MixedCourseDefinition,
    player: MixedCoursePlayerPort | CoursePlayer,
    options: MixedCourseNavigatorOptions = {},
  ) {
    if (course.locations.length === 0) throw new Error('A mixed course needs at least one location')
    const locationMap = new Map<string, MixedLocationEntry>()
    for (const location of course.locations) {
      if (locationMap.has(location.id)) throw new Error(`Duplicate mixed location id: ${location.id}`)
      locationMap.set(location.id, { ...location })
    }
    this.#course = {
      ...course,
      locations: course.locations.map((location) => ({ ...location })),
    }
    this.#locationMap = locationMap
    this.#player = player
    this.#onBeforeNavigate = options.onBeforeNavigate
    this.#onNavigate = options.onNavigate
  }

  get current(): MixedNavigationState | null {
    if (!this.#current) return null
    return this.#state()
  }

  get canGoBack(): boolean {
    return this.#history.length > 0
  }

  get canGoNext(): boolean {
    if (!this.#current) return this.#course.locations.length > 0
    return this.#currentIndex() < this.#course.locations.length - 1
  }

  get canGoPrevious(): boolean {
    if (!this.#current) return false
    return this.#currentIndex() > 0
  }

  listCatalog(): MixedCatalogEntry[] {
    return this.#course.locations.map((location, index) => ({ ...location, index }))
  }

  getProgress(): MixedCourseProgress {
    if (!this.#current) throw new Error('Mixed course has not started')
    const index = this.#currentIndex()
    const total = this.#course.locations.length
    return {
      index,
      total,
      locationId: this.#current.id,
      surfaceId: this.#current.surfaceId,
      ratio: total === 0 ? 0 : (index + 1) / total,
      atStart: index <= 0,
      atEnd: index >= total - 1,
    }
  }

  async start(locationId?: string): Promise<MixedNavigationState> {
    const requested = locationId
      ?? (this.#locationMap.has(this.#course.startLocationId) ? this.#course.startLocationId : undefined)
      ?? this.#course.locations[0]!.id
    return this.goToLocation(requested, { recordHistory: false })
  }

  async navigateDeepLink(value: string): Promise<MixedNavigationState> {
    const link = parseMixedDeepLink(value)
    if (!link) throw new Error(`Invalid mixed-course deep link: ${value}`)
    if (this.#locationMap.has(link.locationId)) return this.goToLocation(link.locationId)
    if (link.surfaceId) {
      const first = this.#course.locations.find((location) => location.surfaceId === link.surfaceId)
      if (first) return this.goToLocation(first.id)
    }
    throw new Error(`Unknown mixed-course location: ${link.locationId}`)
  }

  async goToIndex(index: number): Promise<MixedNavigationState> {
    const location = this.#course.locations[index]
    if (!location) throw new Error(`Mixed course has no location at index ${index}`)
    return this.goToLocation(location.id)
  }

  async goToLocation(
    locationId: string,
    options: MixedNavigationRequestOptions = {},
  ): Promise<MixedNavigationState> {
    return this.#enqueue(async () => {
      assertNavigationNotAborted(options.signal)
      const location = this.#locationMap.get(locationId)
      if (!location) throw new Error(`Unknown mixed-course location: ${locationId}`)
      if (this.#current?.id === location.id && options.force !== true) return this.#state()
      return this.#transitionTo(location, options)
    })
  }

  /** Mixed try-run / teacher controller: next Published location. */
  async next(): Promise<MixedNavigationState | null> {
    const index = this.#currentIndex()
    const next = this.#course.locations[index + 1]
    if (!next) return null
    return this.goToLocation(next.id)
  }

  /** Mixed try-run / teacher controller: previous Published location. */
  async previous(): Promise<MixedNavigationState | null> {
    const index = this.#currentIndex()
    const previous = this.#course.locations[index - 1]
    if (!previous) return null
    return this.goToLocation(previous.id)
  }

  async back(): Promise<MixedNavigationState | null> {
    return this.#enqueue(async () => {
      const locationId = this.#history.at(-1)
      if (!locationId) return null
      const location = this.#locationMap.get(locationId)
      if (!location) throw new Error(`Unknown mixed-course location: ${locationId}`)
      const state = await this.#transitionTo(location, { recordHistory: false })
      this.#history.pop()
      return state
    })
  }

  async resetCurrentSurface(): Promise<MixedNavigationState> {
    return this.#enqueue(async () => {
      if (!this.#current) throw new Error('Mixed course has not started')
      const first = this.#course.locations.find((location) => location.surfaceId === this.#current?.surfaceId)
      if (!first) throw new Error('Current mixed-course surface no longer exists')
      await this.#notifyBeforeNavigate(first, true)
      const result = await this.#player.resetSurface(this.#current.surfaceId, 'surface')
      if (!result.ok) throw result.failure?.error ?? new Error('Surface reset failed')
      return this.#transitionTo(first, { recordHistory: false, force: true }, false)
    })
  }

  async resetCourse(options: Pick<MixedNavigationRequestOptions, 'signal'> = {}): Promise<MixedNavigationState> {
    return this.#enqueue(async () => {
      assertNavigationNotAborted(options.signal)
      const target = this.#startLocation()
      await this.#notifyBeforeNavigate(target, true)
      const results = await this.#player.resetCourse()
      const failed = results.find((result) => !result.ok)
      if (failed) throw failed.failure?.error ?? new Error('Course reset failed')
      this.#history = []
      this.#current = null
      return this.#transitionTo(target, { recordHistory: false, force: true }, false)
    })
  }

  async #transitionTo(
    location: MixedLocationEntry,
    options: MixedNavigationRequestOptions,
    notifyBeforeNavigate = true,
  ): Promise<MixedNavigationState> {
    const previous = this.#current
    if (previous?.id === location.id && options.force !== true) return this.#state()
    if (notifyBeforeNavigate) await this.#notifyBeforeNavigate(location, options.force === true)
    if (previous && previous.surfaceId !== location.surfaceId) {
      await this.#player.releaseSurfaceSession?.(previous.surfaceId)
    }
    const activation = await this.#player.activateSurface(location.surfaceId)
    if (!activation.ok) throw activation.failure?.error ?? new Error('Surface activation failed')
    options.prepareTransition?.()
    const located = await this.#player.setSurfaceLocation?.(location.surfaceId, location.id)
    if (located && !located.ok) throw located.failure?.error ?? new Error('Surface location failed')
    if (previous && options.recordHistory !== false) this.#history.push(previous.id)
    this.#current = { ...location }
    const state = this.#state(previous?.id, previous?.surfaceId)
    await this.#onNavigate?.(state)
    return state
  }

  async #notifyBeforeNavigate(location: MixedLocationEntry, forced: boolean): Promise<void> {
    await this.#onBeforeNavigate?.({
      current: this.#current ? this.#identity(this.#current) : null,
      next: this.#identity(location),
      forced,
    })
  }

  #startLocation(): MixedLocationEntry {
    return this.#locationMap.get(this.#course.startLocationId) ?? this.#course.locations[0]!
  }

  #identity(location: MixedLocationEntry): MixedNavigationIdentity {
    const index = this.#course.locations.findIndex((entry) => entry.id === location.id)
    if (index < 0) throw new Error('Mixed-course location no longer exists')
    return {
      locationId: location.id,
      surfaceId: location.surfaceId,
      kind: location.kind,
      index,
      total: this.#course.locations.length,
    }
  }

  #currentIndex(): number {
    if (!this.#current) throw new Error('Mixed course has not started')
    const index = this.#course.locations.findIndex((location) => location.id === this.#current?.id)
    if (index < 0) throw new Error('Current mixed-course location no longer exists')
    return index
  }

  #state(previousLocationId?: string, previousSurfaceId?: string): MixedNavigationState {
    if (!this.#current) throw new Error('Mixed course has not started')
    const index = this.#currentIndex()
    return {
      locationId: this.#current.id,
      surfaceId: this.#current.surfaceId,
      kind: this.#current.kind,
      index,
      total: this.#course.locations.length,
      ...(previousLocationId ? { previousLocationId } : {}),
      ...(previousSurfaceId ? { previousSurfaceId } : {}),
    }
  }
}
