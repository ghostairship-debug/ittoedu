import type {
  PublishedCourseV2Payload,
  PublishedRuntimeLayerItem,
} from '../../../shared/publishedCourseTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeAuthoringBounds,
  RuntimeAuthoringTarget,
  RuntimeAuthoringTargetUpdate,
  RuntimeHostActions,
} from '../../../shared/runtimeTypes'
import type { CourseStateStore } from '../../CourseStateStore'
import type { SurfacePlayerServices } from '../SurfaceHost'
import {
  PublishedCarrierSideEffectGate,
  type PublishedCarrierSideEffects,
} from '../publishedCourseState'
import {
  mountPublishedCanvasRuntime,
  type PublishedCanvasRuntimeMountHandle,
} from './publishedCanvasRuntimeMount'
import {
  createPublishedSurfaceRuntimeSession,
  type PublishedSurfaceRuntimeSession,
} from './publishedSurfaceRuntimeMount'
import { setPublishedGlobalCanvasRuntimeState } from './publishedGlobalCanvasRuntimePointer'

type RuntimeFailurePhase = 'register' | 'create' | 'lifecycle' | 'destroy'

export interface PublishedGlobalRuntimeMountTargetPort {
  getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null
}

export interface PublishedGlobalCanvasRuntimeAuthoringOptions {
  readonly courseState: CourseStateStoreContract
  readonly onTargetsChanged: (
    update: Readonly<RuntimeAuthoringTargetUpdate>,
  ) => void
}

interface GlobalRuntimeRecord {
  readonly item: PublishedRuntimeLayerItem
  readonly inner: HTMLElement
  readonly handle: PublishedCanvasRuntimeMountHandle
  readonly sideEffects: PublishedCarrierSideEffects
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
  item: PublishedRuntimeLayerItem,
): void {
  setPublishedGlobalCanvasRuntimeState(target, state, item)
  if (target.dataset.slideRuntimeKind !== undefined) target.dataset.slideRuntimeState = state
  if (target.dataset.flowRuntimeKind !== undefined) target.dataset.flowRuntimeState = state
  if (target.dataset.layerSource === 'global') target.dataset.spatialRuntimeState = state
}

function mapGlobalRuntimeBoundsToLayer(
  bounds: Readonly<RuntimeAuthoringBounds>,
  item: PublishedRuntimeLayerItem,
): RuntimeAuthoringBounds {
  const scaled = {
    x: item.frame.x + bounds.x / CANVAS_WIDTH * item.frame.width,
    y: item.frame.y + bounds.y / CANVAS_HEIGHT * item.frame.height,
    width: bounds.width / CANVAS_WIDTH * item.frame.width,
    height: bounds.height / CANVAS_HEIGHT * item.frame.height,
  }
  if (item.rotation === 0) return scaled

  const angle = item.rotation * Math.PI / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const centerX = item.frame.x + item.frame.width / 2
  const centerY = item.frame.y + item.frame.height / 2
  const corners = [
    { x: scaled.x, y: scaled.y },
    { x: scaled.x + scaled.width, y: scaled.y },
    { x: scaled.x + scaled.width, y: scaled.y + scaled.height },
    { x: scaled.x, y: scaled.y + scaled.height },
  ].map(({ x, y }) => ({
    x: centerX + (x - centerX) * cosine - (y - centerY) * sine,
    y: centerY + (x - centerX) * sine + (y - centerY) * cosine,
  }))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function mapGlobalRuntimeTargetsToLayer(
  update: Readonly<RuntimeAuthoringTargetUpdate>,
  item: PublishedRuntimeLayerItem,
): RuntimeAuthoringTargetUpdate {
  return Object.freeze({
    ...update,
    targets: Object.freeze(update.targets.map((target): Readonly<RuntimeAuthoringTarget> => (
      Object.freeze({
        ...target,
        nodeId: item.layerItemId,
        bounds: Object.freeze(mapGlobalRuntimeBoundsToLayer(target.bounds, item)),
      })
    ))),
  })
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
  readonly #authoring?: PublishedGlobalCanvasRuntimeAuthoringOptions
  readonly #staticCapture: boolean
  readonly #courseState?: CourseStateStore
  readonly #runtimeActions?: Readonly<RuntimeHostActions>
  readonly #sideEffectGate: PublishedCarrierSideEffectGate
  #runtimeSession: PublishedSurfaceRuntimeSession
  #document: Document | null = null
  #records = new Map<string, GlobalRuntimeRecord>()
  #authoringTargetsByItemId = new Map<string, RuntimeAuthoringTargetUpdate>()
  #currentSurfaceId: string | null = null
  #authoringRevision = 0
  #moveRevision = 0
  #restartPrepared = false
  #destroyed = false

  constructor(options: {
    payload: PublishedCourseV2Payload
    hosts: readonly ({ id: string } & Partial<PublishedGlobalRuntimeMountTargetPort>)[]
    services: SurfacePlayerServices
    resolveAsset: (assetId: string) => string | undefined
    authoring?: PublishedGlobalCanvasRuntimeAuthoringOptions
    staticCapture?: boolean
    courseState?: CourseStateStore
    runtimeActions?: Readonly<RuntimeHostActions>
  }) {
    this.#payload = options.payload
    this.#hostsById = new Map(options.hosts.map((host) => [host.id, host]))
    this.#services = options.services
    this.#resolveAsset = options.resolveAsset
    this.#authoring = options.authoring
    this.#staticCapture = options.staticCapture === true
    this.#courseState = options.courseState
    this.#runtimeActions = options.runtimeActions
    this.#sideEffectGate = new PublishedCarrierSideEffectGate({
      courseState: options.courseState,
      runtimeActions: options.runtimeActions,
    })
    this.#runtimeSession = createPublishedSurfaceRuntimeSession(options.courseState)
  }

  mount(document: Document): void {
    if (this.#destroyed) return
    if (this.#document && this.#document !== document) {
      throw new Error('Published global Runtime owner cannot move between Documents')
    }
    this.#document = document
    if (!this.#restartPrepared) this.#sideEffectGate.activate()
    if (this.#records.size === 0) this.#createRecords()
  }

  moveTo(surfaceId: string): void {
    if (this.#destroyed) return
    this.#currentSurfaceId = surfaceId
    const moveRevision = ++this.#moveRevision
    if (this.#restartPrepared) return
    const port = globalRuntimeTargetPort(this.#hostsById.get(surfaceId))
    for (const record of this.#records.values()) {
      if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
      const target = port?.getPublishedGlobalRuntimeMountTarget(record.item.layerItemId) ?? null
      if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
      if (record.target === target && target?.contains(record.inner)) {
        setTargetRuntimeState(target, record.failed ? 'fallback' : 'playback', record.item)
        continue
      }

      if (record.active) {
        record.active = false
        this.#invokeLifecycle(record, 'setVisible', () => record.handle.setVisible(false))
        if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
        this.#invokeLifecycle(record, 'suspend', () => record.handle.suspend())
        if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
      }
      record.inner.remove()
      record.target = target
      record.active = false
      if (!target) continue

      setTargetRuntimeState(target, record.failed ? 'fallback' : 'playback', record.item)
      target.replaceChildren(record.inner)
      if (!record.failed) {
        record.active = true
        this.#invokeLifecycle(record, 'setVisible', () => record.handle.setVisible(true))
        if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
        if (!record.failed) {
          this.#invokeLifecycle(record, 'resume', () => record.handle.resume())
          if (!this.#canContinueMove(record, surfaceId, moveRevision)) return
        }
        record.active = !record.failed
      }
    }
  }

  restart(): void {
    if (this.#destroyed) return
    this.prepareRestart()
    this.finishRestart(true)
  }

  /** Makes every old carrier reference inert before an asynchronous reset. */
  prepareRestart(): void {
    if (this.#destroyed || this.#restartPrepared) return
    this.#moveRevision += 1
    this.#restartPrepared = true
    this.#sideEffectGate.suspend()
    for (const record of this.#records.values()) {
      if (!record.active) continue
      record.active = false
      this.#invokeLifecycle(record, 'setVisible', () => record.handle.setVisible(false))
      this.#invokeLifecycle(record, 'suspend', () => record.handle.suspend())
    }
  }

  /**
   * Both successful and failed course resets get a fresh generation. This
   * prevents a failed reset from re-enabling stale timers or captured APIs.
   */
  finishRestart(_committed: boolean): void {
    if (this.#destroyed) return
    if (!this.#restartPrepared) this.prepareRestart()
    const currentSurfaceId = this.#currentSurfaceId
    this.#destroyRecords()
    this.#runtimeSession.destroy()
    this.#runtimeSession = createPublishedSurfaceRuntimeSession(this.#courseState)
    this.#createRecords()
    this.#restartPrepared = false
    this.#sideEffectGate.activate()
    if (currentSurfaceId) this.moveTo(currentSurfaceId)
  }

  async applyAuthoringContentValue(itemId: string, key: string, value: string): Promise<boolean> {
    if (!this.#authoring || this.#destroyed) return false
    const record = this.#records.get(itemId)
    if (
      !record
      || record.failed
      || !Object.prototype.hasOwnProperty.call(record.item.runtime.content.values, key)
    ) return false
    record.item.runtime.content.values[key] = value
    // Canvas Runtime ctx.content is immutable for one create() generation.
    // Recreate only this carrier so unrelated global Runtime state/lifecycle is
    // preserved. ACK waits for the async Canvas boot and target publication.
    this.#records.delete(itemId)
    this.#destroyRecord(record)
    const replacement = this.#createRecord(record.item)
    if (!replacement) return false
    if (this.#currentSurfaceId) this.moveTo(this.#currentSurfaceId)
    try {
      await replacement.handle.waitForReady()
    } catch {
      return false
    }
    return !this.#destroyed
      && this.#records.get(itemId) === replacement
      && replacement.failed === false
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#moveRevision += 1
    this.#restartPrepared = false
    this.#sideEffectGate.destroy()
    this.#destroyRecords()
    this.#runtimeSession.destroy()
    this.#clearAuthoringTargets()
    this.#document = null
    this.#currentSurfaceId = null
  }

  #createRecords(): void {
    if (!this.#document || this.#destroyed) return
    for (const entry of this.#payload.globalLayerItems) {
      if (entry.item.kind !== 'runtime' || !isExecutableGlobalCanvasRuntime(entry.item)) continue
      this.#createRecord(entry.item)
    }
  }

  #createRecord(item: PublishedRuntimeLayerItem): GlobalRuntimeRecord | null {
    const document = this.#document
    if (!document || this.#destroyed || this.#records.has(item.layerItemId)) return null
    const authoringSink = this.#authoring
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
    let record: GlobalRuntimeRecord | null = null
    let pendingAuthoringUpdate: Readonly<RuntimeAuthoringTargetUpdate> | null = null
    const pendingFailure: {
      value: { phase: RuntimeFailurePhase; error: Error } | null
    } = { value: null }
    const sideEffects = this.#sideEffectGate.createScope(() => (
      record !== null
      && record.active
      && this.#records.get(item.layerItemId) === record
    ))
    const handle = mountPublishedCanvasRuntime(inner, {
      instanceId: item.layerItemId,
      scope: 'global',
      runtime: item.runtime,
      width: item.frame.width,
      height: item.frame.height,
      visible: false,
      ...(this.#authoring
        ? {
            mode: 'authoring' as const,
            courseState: this.#authoring.courseState,
            ...(authoringSink
              ? {
                  authoring: {
                    scope: 'global' as const,
                    onTargetsChanged: (update: Readonly<RuntimeAuthoringTargetUpdate>) => {
                      if (!record) {
                        pendingAuthoringUpdate = update
                        return
                      }
                      if (
                        this.#records.get(item.layerItemId) !== record
                        || record.failed
                      ) return
                      this.#publishAuthoringTargets(item, update)
                    },
                  },
                }
              : {}),
          }
        : this.#staticCapture
          ? {
              mode: 'capture' as const,
              ...(sideEffects.courseState ? { courseState: sideEffects.courseState } : {}),
            }
          : {
              ...(sideEffects.courseState ? { courseState: sideEffects.courseState } : {}),
              ...(sideEffects.runtimeActions ? { actions: sideEffects.runtimeActions } : {}),
            }),
      resolveAsset: this.#resolveAsset,
      session: this.#runtimeSession,
      fallbackText: firstVisibleRuntimeText(item.runtime.content.values)
        ?? item.runtime.protocol,
      reportError: (phase, error) => {
        if (!record) {
          pendingFailure.value = { phase, error }
          return
        }
        if (this.#records.get(item.layerItemId) === record) {
          this.#handleFailure(record, phase, error)
        }
      },
    })
    record = {
      item,
      inner,
      handle,
      sideEffects,
      target: null,
      active: false,
      failed: !handle.ok,
      failureReported: false,
    }
    this.#records.set(item.layerItemId, record)
    if (pendingAuthoringUpdate && !record.failed) {
      this.#publishAuthoringTargets(item, pendingAuthoringUpdate)
    }
    if (pendingFailure.value) {
      this.#handleFailure(record, pendingFailure.value.phase, pendingFailure.value.error)
    }
    return record
  }

  #publishAuthoringTargets(
    item: PublishedRuntimeLayerItem,
    update: Readonly<RuntimeAuthoringTargetUpdate>,
  ): void {
    const sink = this.#authoring
    if (!sink || this.#destroyed) return
    const mapped = mapGlobalRuntimeTargetsToLayer(update, item)
    if (mapped.targets.length === 0) {
      this.#authoringTargetsByItemId.delete(item.layerItemId)
    } else {
      this.#authoringTargetsByItemId.set(item.layerItemId, mapped)
    }
    this.#emitAuthoringTargets()
  }

  #emitAuthoringTargets(): void {
    const sink = this.#authoring
    if (!sink) return
    sink.onTargetsChanged(Object.freeze({
      revision: ++this.#authoringRevision,
      scope: 'global',
      targets: Object.freeze(
        [...this.#authoringTargetsByItemId.entries()]
          .sort(([leftId], [rightId]) => {
            const left = this.#records.get(leftId)?.item
            const right = this.#records.get(rightId)?.item
            return (left?.order ?? 0) - (right?.order ?? 0)
              || leftId.localeCompare(rightId, 'en')
          })
          .flatMap(([, entry]) => entry.targets),
      ),
    }))
  }

  #removeAuthoringTargets(itemId: string): void {
    if (!this.#authoringTargetsByItemId.delete(itemId)) return
    this.#emitAuthoringTargets()
  }

  #clearAuthoringTargets(): void {
    if (this.#authoringTargetsByItemId.size === 0) return
    this.#authoringTargetsByItemId.clear()
    this.#authoring?.onTargetsChanged(Object.freeze({
      revision: ++this.#authoringRevision,
      scope: 'global',
      targets: Object.freeze([]),
    }))
  }

  #handleFailure(
    record: GlobalRuntimeRecord | undefined,
    phase: RuntimeFailurePhase,
    error: Error,
  ): void {
    if (!record || this.#records.get(record.item.layerItemId) !== record) return
    if (phase !== 'destroy') {
      record.failed = true
      record.active = false
      this.#removeAuthoringTargets(record.item.layerItemId)
      if (record.target) {
        setTargetRuntimeState(record.target, 'fallback', record.item)
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

  #invokeLifecycle(
    record: GlobalRuntimeRecord,
    operation: 'setVisible' | 'suspend' | 'resume',
    invoke: () => void,
  ): void {
    try {
      invoke()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.#handleFailure(record, 'lifecycle', new Error(
        `Global Runtime ${operation} 失败：${error.message}`,
        { cause: error },
      ))
    }
  }

  #canContinueMove(
    record: GlobalRuntimeRecord,
    surfaceId: string,
    moveRevision: number,
  ): boolean {
    return !this.#destroyed
      && !this.#restartPrepared
      && this.#moveRevision === moveRevision
      && this.#currentSurfaceId === surfaceId
      && this.#records.get(record.item.layerItemId) === record
  }

  #destroyRecords(): void {
    const records = [...this.#records.values()]
    this.#records.clear()
    for (const record of records) this.#destroyRecord(record)
  }

  #destroyRecord(record: GlobalRuntimeRecord): void {
    record.active = false
    record.sideEffects.retire()
    if (!this.#destroyed) this.#removeAuthoringTargets(record.item.layerItemId)
    record.target = null
    record.handle.destroy()
    record.inner.replaceChildren()
    record.inner.remove()
  }
}
