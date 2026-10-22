import { ComponentPlatformRuntime } from '../components/ComponentPlatformRuntime'
import type { DocumentModel } from '../../shared/workbench/document'
import { createComponentModelProjection } from './modelProjection'
import type { ComponentSpatialCameraPort } from '../surfaces/spatial/componentSpatialAdapter'
import type { TeacherControllerDisplayPort } from '../../shared/teacherControllerViewportGeometry'
import { componentContainers, resolveComponentPresentation, type CourseProjectV10, type TeacherControllerPort, type ComponentFlowReading } from '../../shared/contracts/component-platform'

export type ComponentPlayerModel = Extract<DocumentModel, { kind: 'course-v10' }>
export type ComponentPlayerRuntimeOptions = NonNullable<ConstructorParameters<typeof ComponentPlatformRuntime>[1]>

export interface ComponentPlayerObservation {
  readZoom(): number
  setZoom(zoom: number): void
  reset(): void
  goToInstance?(instanceId: string | null, signal?: AbortSignal): boolean | Promise<boolean>
  readReading?(targetIds: readonly string[]): Omit<ComponentFlowReading, 'containerId'> | null
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
  /** React already renders states plus transient drafts; keep that final value for World. */
  presentationPrepared?: boolean
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
  model.project.rootIds, model.project.entry?.rootInstanceId,
  Object.values(model.project.instances).map(instance => [instance.id, instance.container?.kind, instance.childIds])])

/** The stored topology already snapshots the old placement relation. On a real
 * structural mutation, park only roots below ancestors whose projection can
 * move, preserving unrelated pages' connected browsing contexts. */
function mutatedProjectionInstances(before: string, after: string): ReadonlySet<string> {
  type Topology = [{ underlay: string[]; overlay: string[] }, string[], string | undefined, Array<[string, string | null, string[] | null]>]
  const old = JSON.parse(before) as Topology, next = JSON.parse(after) as Topology
  const oldNodes = new Map(old[3].map(node => [node[0], node])), nextNodes = new Map(next[3].map(node => [node[0], node]))
  const dirty = new Set<string>()
  const same = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) =>
    (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((id, index) => id === b?.[index])
  for (const id of new Set([...oldNodes.keys(), ...nextNodes.keys()])) {
    const a = oldNodes.get(id), b = nextNodes.get(id)
    if (!a || !b || a[1] !== b[1] || !same(a[2], b[2])) dirty.add(id)
  }
  const changedList = (a: readonly string[], b: readonly string[]) => {
    const oldIds = new Set(a), nextIds = new Set(b)
    for (const id of a) if (!nextIds.has(id)) dirty.add(id)
    for (const id of b) if (!oldIds.has(id)) dirty.add(id)
    const retainedOld = a.filter(id => nextIds.has(id)), retainedNext = b.filter(id => oldIds.has(id))
    if (!same(retainedOld, retainedNext)) retainedOld.forEach(id => dirty.add(id))
  }
  changedList(old[0].underlay, next[0].underlay); changedList(old[0].overlay, next[0].overlay); changedList(old[1], next[1])
  if (old[2] !== next[2]) { if (old[2]) dirty.add(old[2]); if (next[2]) dirty.add(next[2]) }
  const visit = (id: string, nodes: typeof oldNodes, visited: Set<string>) => {
    if (visited.has(id)) return
    visited.add(id); dirty.add(id)
    nodes.get(id)?.[2]?.forEach(child => visit(child, nodes, visited))
  }
  const roots = [...dirty]
  for (const nodes of [oldNodes, nextNodes]) { const visited = new Set<string>(); for (const id of roots) visit(id, nodes, visited) }
  return dirty
}

/** One disposable parent-before-child projection for native and compiled players. */
export function resolveModelPlayerPresentation(source: CourseProjectV10, navigation?: TeacherControllerPort): CourseProjectV10 {
  let project = source
  const visited = new Set<string>()
  const present = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const instance = source.instances[id]
    if (instance?.container) {
      const port = navigation?.forContainer?.(id) ?? (navigation?.readLocation() === id ? navigation : undefined)
      const stateId = port?.currentStateId?.()
      if (stateId !== undefined) project = resolveComponentPresentation(project, id, stateId)
    }
    instance?.childIds?.forEach(present)
  }
  for (const id of [...source.rootIds, ...source.global.underlay, ...source.global.overlay]) present(id)
  componentContainers(source).forEach(container => present(container.id))
  return project
}

/** The one runtime lifetime/commit owner; React and DOM only supply their actual projection commit. */
export function createV10ModelPlayer(options: ComponentModelHostOptions) {
  const controller = new AbortController()
  let projecting = false
  let committedModel: ComponentPlayerModel | undefined
  const runtime = new ComponentPlatformRuntime(options.runScopeId, { ...options, projectionManaged: true,
    onProjectionCommit: () => {
      if (!projecting && committedModel) void enqueueCommittedProjection().catch(error => options.report?.(error instanceof Error ? error.message : String(error)))
    },
  })
  const projection = options.createProjection?.(runtime, controller.signal)
  const observationBindings = new Map<string, { observation: ComponentPlayerObservation; off(): void }>()
  let projectionQueue: Promise<void> = Promise.resolve()
  let runtimeReady: Promise<void> = Promise.resolve()
  let disposal: Promise<void> | undefined
  let topology: string | undefined
  let projectionKey: string | undefined
  let committedSyncQueued = false
  let retention: object | undefined
  const prepareProjection = (model: ComponentPlayerModel, key?: string): ComponentProjectionCommit => {
    projecting = true
    // Derive from this caller's latest author/draft projection, never the last
    // committed effective model: leaving a state must restore unoverridden data.
    const project = options.presentationPrepared ? model.project
      : resolveModelPlayerPresentation(model.project, options.studentNavigation ?? options.teacherController)
    const effectiveModel = project === model.project ? model : { ...model, project }
    const nextTopology = projectionTopology(effectiveModel)
    runtime.prepareResources(effectiveModel.project, effectiveModel.resources)
    const parked = topology !== nextTopology || projectionKey !== key
    if (parked && !controller.signal.aborted) runtime.beforeProjectionMutation(
      topology !== undefined && projectionKey === key ? mutatedProjectionInstances(topology, nextTopology) : undefined)
    return { model: effectiveModel, key, topology: nextTopology, parked }
  }
  const finishProjection = (receipt: ComponentProjectionCommit) => {
    if (receipt.parked) runtime.afterProjectionMutation()
    topology = receipt.topology; projectionKey = receipt.key
    projecting = false; committedModel = receipt.model
  }
  const enqueueCommittedProjection = (): Promise<void> => {
    if (controller.signal.aborted || committedSyncQueued) return runtimeReady
    committedSyncQueued = true
    // Coalesce commits from one DOM mutation, without waiting for an older source
    // preparation: RuntimeHost must receive new inputs to supersede that preparation.
    runtimeReady = Promise.resolve().then(async () => {
      committedSyncQueued = false
      // A later parent/NodeView commit uses the latest author projection, never a stale captured model.
      if (committedModel) await syncCommittedProjection(committedModel)
    })
    return runtimeReady
  }
  const syncCommittedProjection = async (model: ComponentPlayerModel) => {
    if (controller.signal.aborted) return
    await runtime.sync(model.project, model.resources)
    if (!controller.signal.aborted && committedModel === model && options.onObservation && projection) {
      const observationIds = new Set([...model.project.rootIds, ...componentContainers(model.project).map(container => container.id)])
      for (const [id, binding] of observationBindings) if (!observationIds.has(id) || projection.observation?.(id) !== binding.observation) {
        binding.off(); observationBindings.delete(id)
      }
      for (const id of observationIds) {
        const observation = projection.observation?.(id)
        if (observation && !observationBindings.has(id)) observationBindings.set(id,
          { observation, off: options.onObservation(id, observation) })
      }
    }
  }
  /** React calls only from didMount/didUpdate, after refs and real DOM mutation. */
  const commitProjection = (receipt: ComponentProjectionCommit): Promise<void> => {
    if (receipt.completion) return receipt.completion
    if (controller.signal.aborted) return Promise.resolve()
    finishProjection(receipt)
    return receipt.completion = enqueueCommittedProjection()
  }
  const update = (model: ComponentPlayerModel): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve()
    if (!projection) return Promise.reject(new Error('React 投影必须在实际 commit 后提交运行同步'))
    // DOM mutations stay ordered. Component preparation belongs to RuntimeHost and
    // must not block a later formal projection from reaching its cancellation owner.
    let completion = Promise.resolve()
    const projected = projectionQueue.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return
      const receipt = prepareProjection(model)
      try { await projection.sync(receipt.model) } finally { finishProjection(receipt) }
      completion = enqueueCommittedProjection()
    })
    projectionQueue = projected
    return projected.then(() => completion)
  }
  const dispose = (): Promise<void> => {
    if (disposal) return disposal
    controller.abort(); retention = undefined
    options.onDispose?.()
    for (const binding of observationBindings.values()) binding.off()
    observationBindings.clear()
    // Invalidate old host calls immediately, including an asynchronous mount in flight.
    const stopped = runtime.dispose()
    disposal = Promise.allSettled([projectionQueue, runtimeReady, stopped]).then(async () => { await projection?.dispose() })
    return disposal
  }
  return {
    runtime,
    camera: (id: string) => projection?.camera?.(id),
    viewport: (id: string) => projection?.viewport?.(id),
    observation: (id: string) => projection?.observation?.(id),
    get ready() { return projectionQueue.then(() => runtimeReady) },
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
