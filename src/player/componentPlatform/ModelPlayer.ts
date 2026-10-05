import { ComponentPlatformRuntime } from '../components/ComponentPlatformRuntime'
import type { DocumentModel } from '../../shared/workbench/document'
import { createComponentModelProjection } from './modelProjection'
import type { ComponentSpatialCameraPort } from '../surfaces/spatial/componentSpatialAdapter'

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
  onCamera?(surfaceId: string, camera: ComponentSpatialCameraPort): () => void
  /** Allows the app's surface owner to supply a projection without another runtime. */
  createProjection?(context: {
    root: HTMLElement
    runtime: ComponentPlatformRuntime
    signal: AbortSignal
    onCamera?(surfaceId: string, camera: ComponentSpatialCameraPort): () => void
  }): ComponentPlayerProjection
}

/** C0 model adapter. PublishedV3 decoding/binding belongs to the P0 producer consumer. */
export function mountV10Model(options: ComponentPlayerMountOptions) {
  const controller = new AbortController()
  const runtime = new ComponentPlatformRuntime(options.runScopeId, options)
  const projection = (options.createProjection ?? createComponentModelProjection)({
    root: options.root, runtime, signal: controller.signal, onCamera: options.onCamera,
  })
  let queue: Promise<void> = Promise.resolve()
  let disposal: Promise<void> | undefined
  let topology: string | undefined
  const update = (model: ComponentPlayerModel): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve()
    // A failed component leaves a recoverable model; a later corrected update can run.
    const next = queue.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return
      const nextTopology = JSON.stringify([model.project.global, model.project.surfaces.map(surface => [surface.id, surface.kind, surface.childIds]),
        Object.values(model.project.instances).map(instance => [instance.id, instance.childIds])])
      const changingTopology = topology !== nextTopology
      runtime.prepareResources(model.project, model.resources)
      if (changingTopology) runtime.beforeProjectionMutation()
      try { await projection.sync(model); topology = nextTopology } finally { if (changingTopology) runtime.afterProjectionMutation() }
      if (controller.signal.aborted) return
      await runtime.sync(model.project, model.resources)
    })
    queue = next
    return next
  }
  return {
    runtime,
    camera: (id: string) => projection.camera?.(id),
    viewport: (id: string) => projection.viewport?.(id),
    observation: (id: string) => projection.observation?.(id),
    ready: update(options.model),
    update,
    /** Display only; the L07 navigation owner chooses the surface/step sequence. */
    revealSurface: (id: string) => !controller.signal.aborted && projection.revealSurface(id),
    stateSnapshot: () => runtime.stateSnapshot(),
    dispose(): Promise<void> {
      if (disposal) return disposal
      controller.abort()
      // Invalidate old host calls immediately, including an asynchronous mount in flight.
      const stopped = runtime.dispose()
      disposal = Promise.allSettled([queue, stopped]).then(async () => {
        await projection.dispose()
      })
      return disposal
    },
  }
}

export type ComponentModelPlayer = ReturnType<typeof mountV10Model>
