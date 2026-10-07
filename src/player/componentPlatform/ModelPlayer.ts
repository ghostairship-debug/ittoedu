import { ComponentPlatformRuntime } from '../components/ComponentPlatformRuntime'
import type { DocumentModel } from '../../shared/workbench/document'
import { createComponentModelProjection } from './modelProjection'
import type { ComponentSpatialCameraPort } from '../surfaces/spatial/componentSpatialAdapter'
import type { TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'

export type ComponentPlayerModel = Extract<DocumentModel, { kind: 'course-v10' }>
export type ComponentPlayerRuntimeOptions = NonNullable<ConstructorParameters<typeof ComponentPlatformRuntime>[1]>

export interface ComponentPlayerObservation {
  readZoom(): number
  setZoom(zoom: number): void
  reset(): void
  subscribe?(listener: () => void): () => void
}

/** A projection owns view geometry only. L05 owns implementations, state and leases. */
export interface ComponentPlayerProjection {
  sync(model: ComponentPlayerModel): void | Promise<void>
  revealSurface(surfaceId: string): boolean
  dispose(): void | Promise<void>
  camera?(surfaceId: string): ComponentSpatialCameraPort | undefined
  viewport?(surfaceId: string): { width: number; height: number } | undefined
  observation?(surfaceId: string): ComponentPlayerObservation | undefined
}

export interface ComponentPlayerMountOptions extends ComponentPlayerRuntimeOptions {
  root: HTMLElement
  model: ComponentPlayerModel
  runScopeId: string
  /** The requested view is selected before any content implementation mounts. */
  initialSurfaceId?: string
  onCamera?(surfaceId: string, camera: ComponentSpatialCameraPort): () => void
  onObservation?(surfaceId: string, observation: ComponentPlayerObservation): () => void
  /** Allows the app's surface owner to supply a projection without another runtime. */
  createProjection?(context: {
    root: HTMLElement
    runtime: ComponentPlatformRuntime
    signal: AbortSignal
    initialSurfaceId?: string
    teacherController?: TeacherControllerDisplayPort
    onCamera?(surfaceId: string, camera: ComponentSpatialCameraPort): () => void
  }): ComponentPlayerProjection
}

interface ComponentModelHostOptions extends ComponentPlayerRuntimeOptions {
  runScopeId: string
  onObservation?: ComponentPlayerMountOptions['onObservation']
  createProjection?(runtime: ComponentPlatformRuntime, signal: AbortSignal): ComponentPlayerProjection
  onDispose?(): void
}

/** Receipt prepared before a projection's DOM mutation and completed by its actual commit. */
export interface ComponentProjectionCommit {
  readonly model: ComponentPlayerModel
  readonly key?: string
  readonly topology: string
  readonly parked: boolean
  completion?: Promise<void>
}

const projectionTopology = (model: ComponentPlayerModel) => JSON.stringify([model.project.global,
  model.project.surfaces.map(surface => [surface.id, surface.kind, surface.childIds]),
  Object.values(model.project.instances).map(instance => [instance.id, instance.childIds])])

/** The one runtime lifetime/commit owner; React and DOM only supply their actual projection commit. */
export function createV10ModelPlayer(options: ComponentModelHostOptions) {
  const controller = new AbortController()
  const runtime = new ComponentPlatformRuntime(options.runScopeId, { ...options, projectionManaged: true })
  const projection = options.createProjection?.(runtime, controller.signal)
  const observationBindings = new Map<string, { observation: ComponentPlayerObservation; off(): void }>()
  let queue: Promise<void> = Promise.resolve()
  let disposal: Promise<void> | undefined
  let topology: string | undefined
  let projectionKey: string | undefined
  let committed = 0
  let retention: object | undefined
  const prepareProjection = (model: ComponentPlayerModel, key?: string): ComponentProjectionCommit => {
    const nextTopology = projectionTopology(model)
    runtime.prepareResources(model.project, model.resources)
    const parked = topology !== nextTopology || projectionKey !== key
    if (parked && !controller.signal.aborted) runtime.beforeProjectionMutation()
    return { model, key, topology: nextTopology, parked }
  }
  const finishProjection = (receipt: ComponentProjectionCommit) => {
    if (receipt.parked) runtime.afterProjectionMutation()
    topology = receipt.topology; projectionKey = receipt.key
  }
  const syncCommittedProjection = async (model: ComponentPlayerModel) => {
    if (controller.signal.aborted) return
    await runtime.sync(model.project, model.resources)
    if (!controller.signal.aborted && options.onObservation && projection) {
      for (const [id, binding] of observationBindings) if (projection.observation?.(id) !== binding.observation) {
        binding.off(); observationBindings.delete(id)
      }
      for (const surface of model.project.surfaces) {
        const observation = projection.observation?.(surface.id)
        if (observation && !observationBindings.has(surface.id)) observationBindings.set(surface.id,
          { observation, off: options.onObservation(surface.id, observation) })
      }
    }
  }
  /** React calls only from didMount/didUpdate, after refs and real DOM mutation. */
  const commitProjection = (receipt: ComponentProjectionCommit): Promise<void> => {
    if (receipt.completion) return receipt.completion
    if (controller.signal.aborted) return Promise.resolve()
    finishProjection(receipt)
    const version = ++committed
    // A newer actual React commit supersedes queued work for an older DOM tree.
    queue = queue.catch(() => {}).then(() => version === committed ? syncCommittedProjection(receipt.model) : undefined)
    return receipt.completion = queue
  }
  const update = (model: ComponentPlayerModel): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve()
    if (!projection) return Promise.reject(new Error('React 投影必须在实际 commit 后提交运行同步'))
    // A failed component leaves a recoverable model; a later corrected update can run.
    const next = queue.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return
      const receipt = prepareProjection(model)
      try { await projection.sync(model) } finally { finishProjection(receipt) }
      await syncCommittedProjection(model)
    })
    queue = next
    return next
  }
  const dispose = (): Promise<void> => {
    if (disposal) return disposal
    controller.abort(); retention = undefined
    options.onDispose?.()
    for (const binding of observationBindings.values()) binding.off()
    observationBindings.clear()
    // Invalidate old host calls immediately, including an asynchronous mount in flight.
    const stopped = runtime.dispose()
    disposal = Promise.allSettled([queue, stopped]).then(async () => { await projection?.dispose() })
    return disposal
  }
  return {
    runtime,
    camera: (id: string) => projection?.camera?.(id),
    viewport: (id: string) => projection?.viewport?.(id),
    observation: (id: string) => projection?.observation?.(id),
    get ready() { return queue },
    update, prepareProjection, commitProjection,
    /** React StrictMode's replacement setup retains the same run before retirement. */
    retain(): () => void {
      const lifetime = {}; retention = lifetime
      return () => { queueMicrotask(() => { if (retention === lifetime) void dispose() }) }
    },
    /** Display only; the L07 navigation owner chooses the surface/step sequence. */
    revealSurface: (id: string) => !controller.signal.aborted && Boolean(projection?.revealSurface(id)),
    stateSnapshot: () => runtime.stateSnapshot(),
    dispose,
  }
}

/** Published and other DOM consumers await their projection's real sync/commit. */
export function mountV10Model(options: ComponentPlayerMountOptions) {
  const player = createV10ModelPlayer({ ...options,
    createProjection: (runtime, signal) => (options.createProjection ?? createComponentModelProjection)({
      root: options.root, runtime, signal, initialSurfaceId: options.initialSurfaceId,
      onCamera: options.onCamera, teacherController: options.teacherController,
    }),
  })
  void player.update(options.model)
  return player
}

export type ComponentModelPlayer = ReturnType<typeof mountV10Model>
