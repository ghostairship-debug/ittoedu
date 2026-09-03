import type {
  SurfaceCapture,
  SurfaceCaptureRequest,
  SurfaceFailure,
  SurfaceHost,
  SurfaceOperationResult,
  SurfacePlayerServices,
  SurfaceResetScope,
  SurfaceStatus,
} from './SurfaceHost'
import { toSurfaceError } from './SurfaceHost'
import {
  PUBLISHED_COURSE_FORMAT,
  PUBLISHED_COURSE_VERSION,
  type PublishedCourseV2Payload,
} from '../../shared/publishedCourseTypes'

export const PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR =
  'Published Course V2 捕获入口只接受已解析的 V2 payload，不接受旧版播放器导出包、PlayerApp 或旧 Player payload。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLegacyPlayerPayload(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.getCurrentSceneIndex === 'function' && isRecord(value.game)) {
    return true
  }
  if (typeof value.waitForCaptureReady === 'function' && isRecord(value.game)) {
    return true
  }
  const project = value.project
  if (isRecord(project)) {
    if (project.schemaVersion === 8 || Array.isArray(project.scenes)) return true
  }
  if (value.format === 'h5lesson-published') return true
  if (Array.isArray(value.scenes) && value.schemaVersion === 8) return true
  return false
}

export function isParsedPublishedCourseV2(
  value: unknown,
): value is PublishedCourseV2Payload {
  if (!isRecord(value) || isLegacyPlayerPayload(value)) return false
  return value.format === PUBLISHED_COURSE_FORMAT
    && value.formatVersion === PUBLISHED_COURSE_VERSION
    && value.sourceSchemaVersion === 9
    && typeof value.courseId === 'string'
    && Array.isArray(value.surfaces)
    && Array.isArray(value.locations)
}

export function assertParsedPublishedCourseV2(
  value: unknown,
): asserts value is PublishedCourseV2Payload {
  if (isLegacyPlayerPayload(value) || !isParsedPublishedCourseV2(value)) {
    throw new Error(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
  }
}

interface SurfaceEntry {
  host: SurfaceHost
  status: SurfaceStatus
  container?: HTMLElement
  controller?: AbortController
  operation: Promise<void>
  lastFailure?: SurfaceFailure
}

export interface CoursePlayerOptions {
  services: SurfacePlayerServices
  onFailure?: (failure: SurfaceFailure) => void
}

export interface CoursePlayerSurfaceSnapshot {
  id: string
  kind: SurfaceHost['kind']
  status: SurfaceStatus
  active: boolean
  lastFailure?: SurfaceFailure
}

/**
 * Coordinates independent surface hosts without coupling their renderers.
 * Operations for one host are serialized; failures are recorded per host and
 * never prevent cleanup or operations on another host.
 */
export class CoursePlayer {
  readonly #entries = new Map<string, SurfaceEntry>()
  readonly #services: SurfacePlayerServices
  readonly #onFailure?: (failure: SurfaceFailure) => void
  #activeSurfaceId: string | null = null
  #destroyed = false
  #destroyPromise: Promise<readonly SurfaceOperationResult[]> | null = null

  constructor(hosts: readonly SurfaceHost[], options: CoursePlayerOptions) {
    this.#services = options.services
    this.#onFailure = options.onFailure
    for (const host of hosts) {
      if (this.#entries.has(host.id)) {
        throw new Error(`Duplicate course surface id: ${host.id}`)
      }
      this.#entries.set(host.id, {
        host,
        status: 'idle',
        operation: Promise.resolve(),
      })
    }
  }

  get activeSurfaceId(): string | null {
    return this.#activeSurfaceId
  }

  listSurfaces(): CoursePlayerSurfaceSnapshot[] {
    return [...this.#entries.values()].map((entry) => ({
      id: entry.host.id,
      kind: entry.host.kind,
      status: entry.status,
      active: entry.host.id === this.#activeSurfaceId,
      ...(entry.lastFailure ? { lastFailure: entry.lastFailure } : {}),
    }))
  }

  statusOf(surfaceId: string): SurfaceStatus {
    return this.#requireEntry(surfaceId).status
  }

  async mountSurface(
    surfaceId: string,
    container: HTMLElement,
  ): Promise<SurfaceOperationResult> {
    const entry = this.#requireUsableEntry(surfaceId)
    return this.#enqueue(entry, 'mount', async () => {
      if (entry.status !== 'idle' && entry.status !== 'failed') {
        if (entry.container !== container) {
          throw new Error(`Surface ${surfaceId} is already mounted elsewhere`)
        }
        return
      }
      entry.controller?.abort()
      entry.controller = new AbortController()
      entry.container = container
      entry.status = 'mounting'
      await entry.host.mount({
        surfaceId,
        container,
        services: this.#services,
        signal: entry.controller.signal,
      })
      entry.status = 'mounted'
      entry.lastFailure = undefined
    })
  }

  async activateSurface(surfaceId: string): Promise<SurfaceOperationResult> {
    this.#assertAlive()
    const target = this.#requireEntry(surfaceId)
    if (!['mounted', 'suspended', 'active'].includes(target.status)) {
      return this.#failureResult(target, 'activate', new Error(
        `Surface ${surfaceId} cannot activate from ${target.status}`,
      ))
    }

    const previousId = this.#activeSurfaceId
    if (previousId && previousId !== surfaceId) {
      // Leaving a Mixed surface must release that host's playback session
      // (events, scene media, camera gestures) without destroying the host.
      await this.releaseSurfaceSession(previousId)
    }
    const phase = target.status === 'suspended' ? 'resume' : 'activate'
    const result = await this.#enqueue(target, phase, async () => {
      if (target.status === 'active') return
      if (target.status === 'suspended') await target.host.resume()
      else await target.host.activate()
      target.status = 'active'
      target.lastFailure = undefined
      this.#activeSurfaceId = surfaceId
    })
    return result
  }

  /**
   * Ends the active playback session on a surface so Mixed navigation cannot
   * leak events, scene audio or camera input into the next host. The host
   * instance stays mounted so returning can resume without losing Runtime state.
   */
  async releaseSurfaceSession(surfaceId: string): Promise<SurfaceOperationResult> {
    const entry = this.#requireUsableEntry(surfaceId)
    if (entry.status === 'suspended') return { ok: true }
    if (entry.status === 'idle') return { ok: true }
    return this.suspendSurface(surfaceId)
  }

  async setSurfaceLocation(
    surfaceId: string,
    locationId: string,
  ): Promise<SurfaceOperationResult> {
    const entry = this.#requireUsableEntry(surfaceId)
    if (typeof entry.host.setLocationId !== 'function') return { ok: true }
    if (!['mounted', 'active', 'suspended'].includes(entry.status)) {
      return this.#failureResult(entry, 'execute', new Error(
        `Surface ${surfaceId} cannot set location from ${entry.status}`,
      ))
    }
    return this.#enqueue(entry, 'execute', async () => {
      await entry.host.setLocationId?.(locationId)
    })
  }

  async suspendSurface(surfaceId: string): Promise<SurfaceOperationResult> {
    const entry = this.#requireUsableEntry(surfaceId)
    return this.#enqueue(entry, 'suspend', async () => {
      if (entry.status === 'suspended') return
      if (entry.status !== 'active' && entry.status !== 'mounted') {
        throw new Error(`Surface ${surfaceId} cannot suspend from ${entry.status}`)
      }
      await entry.host.suspend()
      entry.status = 'suspended'
      if (this.#activeSurfaceId === surfaceId) this.#activeSurfaceId = null
    })
  }

  async resumeSurface(surfaceId: string): Promise<SurfaceOperationResult> {
    return this.activateSurface(surfaceId)
  }

  async resetSurface(
    surfaceId: string,
    scope: SurfaceResetScope = 'surface',
  ): Promise<SurfaceOperationResult> {
    const entry = this.#requireUsableEntry(surfaceId)
    // Lazily mounted surfaces are already at their authored initial state.
    if (entry.status === 'idle') return { ok: true }
    return this.#enqueue(entry, 'reset', async () => {
      if (entry.status === 'mounting') {
        throw new Error(`Surface ${surfaceId} is not mounted`)
      }
      const previous = entry.status
      await entry.host.reset(scope)
      entry.lastFailure = undefined
      entry.status = previous === 'failed' ? 'mounted' : previous
    })
  }

  async resetCourse(): Promise<readonly SurfaceOperationResult[]> {
    this.#assertAlive()
    return Promise.all(
      [...this.#entries.keys()].map((id) => this.resetSurface(id, 'course')),
    )
  }

  async captureSurface(
    surfaceId: string,
    request: SurfaceCaptureRequest,
  ): Promise<SurfaceOperationResult<SurfaceCapture>> {
    const entry = this.#requireUsableEntry(surfaceId)
    let captured: SurfaceCapture | undefined
    const result = await this.#enqueue(entry, 'capture', async () => {
      if (!['mounted', 'active', 'suspended'].includes(entry.status)) {
        throw new Error(`Surface ${surfaceId} cannot capture from ${entry.status}`)
      }
      captured = await entry.host.capture(request)
      if (!captured?.content) throw new Error('Surface capture returned no content')
    })
    return result.ok
      ? { ok: true, value: captured }
      : { ok: false, failure: result.failure }
  }

  /**
   * V2-only capture seam. Leftover player export envelopes and PlayerApp input
   * fail before any host capture work.
   */
  async capturePublishedCourseV2Surface(
    payload: unknown,
    surfaceId: string,
    request: SurfaceCaptureRequest,
  ): Promise<SurfaceOperationResult<SurfaceCapture>> {
    assertParsedPublishedCourseV2(payload)
    return this.captureSurface(surfaceId, request)
  }

  async destroySurface(surfaceId: string): Promise<SurfaceOperationResult> {
    const entry = this.#requireEntry(surfaceId)
    if (entry.status === 'destroyed') return { ok: true }
    return this.#enqueue(entry, 'destroy', async () => {
      entry.controller?.abort()
      try {
        await entry.host.destroy()
      } finally {
        entry.status = 'destroyed'
        entry.container = undefined
        entry.controller = undefined
        if (this.#activeSurfaceId === surfaceId) this.#activeSurfaceId = null
      }
    })
  }

  async destroy(): Promise<readonly SurfaceOperationResult[]> {
    if (this.#destroyPromise) return this.#destroyPromise
    this.#destroyed = true
    this.#destroyPromise = Promise.all(
      [...this.#entries.keys()].map((id) => this.destroySurface(id)),
    ).then((results) => {
      this.#activeSurfaceId = null
      return results
    })
    return this.#destroyPromise
  }

  #enqueue(
    entry: SurfaceEntry,
    phase: SurfaceFailure['phase'],
    action: () => void | Promise<void>,
  ): Promise<SurfaceOperationResult> {
    let resolveResult!: (result: SurfaceOperationResult) => void
    const result = new Promise<SurfaceOperationResult>((resolve) => {
      resolveResult = resolve
    })
    entry.operation = entry.operation
      .catch(() => undefined)
      .then(async () => {
        try {
          await action()
          resolveResult({ ok: true })
        } catch (cause) {
          resolveResult(this.#failureResult(entry, phase, toSurfaceError(cause)))
        }
      })
    return result
  }

  #failureResult(
    entry: SurfaceEntry,
    phase: SurfaceFailure['phase'],
    error: Error,
  ): SurfaceOperationResult {
    const failure: SurfaceFailure = {
      surfaceId: entry.host.id,
      kind: entry.host.kind,
      phase,
      error,
    }
    entry.lastFailure = failure
    if (phase !== 'capture' && phase !== 'destroy') entry.status = 'failed'
    if (this.#activeSurfaceId === entry.host.id && entry.status === 'failed') {
      this.#activeSurfaceId = null
    }
    this.#services.reportDiagnostic?.({
      surfaceId: failure.surfaceId,
      phase,
      severity: 'error',
      message: error.message,
      cause: error,
    })
    this.#onFailure?.(failure)
    return { ok: false, failure }
  }

  #requireEntry(surfaceId: string): SurfaceEntry {
    const entry = this.#entries.get(surfaceId)
    if (!entry) throw new Error(`Unknown course surface: ${surfaceId}`)
    return entry
  }

  #requireUsableEntry(surfaceId: string): SurfaceEntry {
    this.#assertAlive()
    const entry = this.#requireEntry(surfaceId)
    if (entry.status === 'destroyed') {
      throw new Error(`Course surface ${surfaceId} has been destroyed`)
    }
    return entry
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('Course player has been destroyed')
  }
}
