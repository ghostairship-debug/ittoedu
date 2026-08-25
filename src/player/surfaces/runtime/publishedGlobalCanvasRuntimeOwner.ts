import type {
  PublishedCourseV2Payload,
  PublishedRuntimeLayerItem,
} from '../../../shared/publishedCourseTypes'
import type { SurfacePlayerServices } from '../SurfaceHost'
import {
  mountPublishedCanvasRuntime,
  type PublishedCanvasRuntimeMountHandle,
} from './publishedCanvasRuntimeMount'
import {
  createPublishedSurfaceRuntimeSession,
  type PublishedSurfaceRuntimeSession,
} from './publishedSurfaceRuntimeMount'

type RuntimeFailurePhase = 'register' | 'create' | 'lifecycle' | 'destroy'

export interface PublishedGlobalRuntimeMountTargetPort {
  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null
}

interface GlobalRuntimeRecord {
  readonly item: PublishedRuntimeLayerItem
  readonly inner: HTMLElement
  readonly handle: PublishedCanvasRuntimeMountHandle
  target: HTMLElement | null
  active: boolean
  failed: boolean
  failureReported: boolean
}

function globalRuntimeTargetPort(
  value: unknown,
): PublishedGlobalRuntimeMountTargetPort | null {
  if (!value || typeof value !== 'object' || !('getPublishedGlobalRuntimeMountTarget' in value)) {
    return null
  }
  const candidate = value as Partial<PublishedGlobalRuntimeMountTargetPort>
  return typeof candidate.getPublishedGlobalRuntimeMountTarget === 'function'
    ? candidate as PublishedGlobalRuntimeMountTargetPort
    : null
}

function isExecutableGlobalCanvasRuntime(
  item: PublishedRuntimeLayerItem,
): boolean {
  return item.runtime.enabled
    && item.runtime.protocol === 'canvas-runtime'
    && item.runtime.runtimeApiVersion === 2
}

function firstVisibleRuntimeText(values: Readonly<Record<string, string>>): string | undefined {
  for (const key of ['title', 'label', 'text', 'heading', 'name']) {
    const value = values[key]?.trim()
    if (value) return value
  }
  return Object.values(values).map((value) => value.trim()).find(Boolean)
}

function setTargetRuntimeState(
  target: HTMLElement,
  state: 'playback' | 'fallback',
): void {
  target.dataset.globalRuntimeState = state
  if (target.dataset.slideRuntimeKind !== undefined) target.dataset.slideRuntimeState = state
  if (target.dataset.flowRuntimeKind !== undefined) target.dataset.flowRuntimeState = state
  if (target.dataset.layerSource === 'global') target.dataset.spatialRuntimeState = state
}

/**
 * Session owner for Published V2 global canvas-runtime API 2 instances.
 *
 * Every Surface keeps rendering its authored global wrapper. This owner creates
 * one stable inner container per global Runtime and moves that container into
 * the active wrapper, preserving the wrapper's authored coordinate/order plane.
 */
export class PublishedGlobalCanvasRuntimeOwner {
  readonly #payload: PublishedCourseV2Payload
  readonly #hostsById: ReadonlyMap<string, unknown>
  readonly #services: SurfacePlayerServices
  readonly #resolveAsset: (assetId: string) => string | undefined
  #runtimeSession: PublishedSurfaceRuntimeSession = createPublishedSurfaceRuntimeSession()
  #document: Document | null = null
  #records = new Map<string, GlobalRuntimeRecord>()
  #currentSurfaceId: string | null = null
  #destroyed = false

  constructor(options: {
    payload: PublishedCourseV2Payload
    hosts: readonly ({ id: string } & Partial<PublishedGlobalRuntimeMountTargetPort>)[]
    services: SurfacePlayerServices
    resolveAsset: (assetId: string) => string | undefined
  }) {
    this.#payload = options.payload
    this.#hostsById = new Map(options.hosts.map((host) => [host.id, host]))
    this.#services = options.services
    this.#resolveAsset = options.resolveAsset
  }

  mount(document: Document): void {
    if (this.#destroyed) return
    if (this.#document && this.#document !== document) {
      throw new Error('Published global Runtime owner cannot move between Documents')
    }
    this.#document = document
    if (this.#records.size === 0) this.#createRecords()
  }

  moveTo(surfaceId: string): void {
    if (this.#destroyed) return
    this.#currentSurfaceId = surfaceId
    const port = globalRuntimeTargetPort(this.#hostsById.get(surfaceId))
    for (const record of this.#records.values()) {
      const target = port?.getPublishedGlobalRuntimeMountTarget(record.item.layerItemId) ?? null
      if (record.target === target && target?.contains(record.inner)) {
        setTargetRuntimeState(target, record.failed ? 'fallback' : 'playback')
        target.style.pointerEvents = !record.failed && record.item.hitPolicy === 'auto'
          ? 'auto'
          : 'none'
        continue
      }

      if (record.active) {
        record.handle.setVisible(false)
        record.handle.suspend()
      }
      record.inner.remove()
      record.target = target
      record.active = false
      if (!target) continue

      setTargetRuntimeState(target, record.failed ? 'fallback' : 'playback')
      target.style.pointerEvents = !record.failed && record.item.hitPolicy === 'auto'
        ? 'auto'
        : 'none'
      target.replaceChildren(record.inner)
      if (!record.failed) {
        record.handle.setVisible(true)
        record.handle.resume()
        record.active = true
      }
    }
  }

  restart(): void {
    if (this.#destroyed) return
    const currentSurfaceId = this.#currentSurfaceId
    this.#destroyRecords()
    this.#runtimeSession.destroy()
    this.#runtimeSession = createPublishedSurfaceRuntimeSession()
    this.#createRecords()
    if (currentSurfaceId) this.moveTo(currentSurfaceId)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#destroyRecords()
    this.#runtimeSession.destroy()
    this.#document = null
    this.#currentSurfaceId = null
  }

  #createRecords(): void {
    const document = this.#document
    if (!document || this.#destroyed) return
    for (const entry of this.#payload.globalLayerItems) {
      if (entry.item.kind !== 'runtime' || !isExecutableGlobalCanvasRuntime(entry.item)) continue
      const item = entry.item
      const inner = document.createElement('div')
      inner.dataset.publishedGlobalRuntimeInner = item.layerItemId
      Object.assign(inner.style, {
        boxSizing: 'border-box',
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: 'inherit',
      })
      let record!: GlobalRuntimeRecord
      const pendingFailure: {
        value: { phase: RuntimeFailurePhase; error: Error } | null
      } = { value: null }
      const handle = mountPublishedCanvasRuntime(inner, {
        instanceId: item.layerItemId,
        scope: 'global',
        runtime: item.runtime,
        width: item.frame.width,
        height: item.frame.height,
        visible: false,
        resolveAsset: this.#resolveAsset,
        session: this.#runtimeSession,
        fallbackText: firstVisibleRuntimeText(item.runtime.content.values)
          ?? item.runtime.protocol,
        reportError: (phase, error) => {
          if (record) this.#handleFailure(record, phase, error)
          else pendingFailure.value = { phase, error }
        },
      })
      record = {
        item,
        inner,
        handle,
        target: null,
        active: false,
        failed: !handle.ok,
        failureReported: false,
      }
      this.#records.set(item.layerItemId, record)
      if (pendingFailure.value) {
        this.#handleFailure(record, pendingFailure.value.phase, pendingFailure.value.error)
      }
    }
  }

  #handleFailure(
    record: GlobalRuntimeRecord | undefined,
    phase: RuntimeFailurePhase,
    error: Error,
  ): void {
    if (!record) return
    if (phase !== 'destroy') {
      record.failed = true
      record.active = false
      if (record.target) {
        setTargetRuntimeState(record.target, 'fallback')
        record.target.style.pointerEvents = 'none'
      }
    }
    if (record.failureReported) return
    record.failureReported = true
    this.#services.reportDiagnostic?.({
      surfaceId: this.#currentSurfaceId
        ?? this.#payload.locations.find((location) => (
          location.id === this.#payload.startLocationId
        ))?.surfaceId
        ?? 'global',
      phase: 'mount',
      severity: 'error',
      message: `Global Runtime“${record.item.layerItemId}”${phase}失败：${error.message}`,
      cause: error,
    })
  }

  #destroyRecords(): void {
    const records = [...this.#records.values()]
    this.#records.clear()
    for (const record of records) {
      record.active = false
      record.target = null
      record.handle.destroy()
      record.inner.replaceChildren()
      record.inner.remove()
    }
  }
}
