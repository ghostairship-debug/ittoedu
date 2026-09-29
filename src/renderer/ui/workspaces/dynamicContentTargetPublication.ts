import type { DynamicContentObservedTarget } from '../../../core/tools/DynamicContentEditPlanner'
import type { ComponentAuthoringImageTarget, ComponentAuthoringTextTarget } from '../../../shared/componentTypes'
import type { RuntimeAuthoringTarget } from '../../../shared/runtimeTypes'

export interface DynamicContentPublication {
  documentId: string
  epoch: string
  revision: number
  locationId: string
  viewGeneration: string
  publicationSeq: number
  source: 'authoring' | 'live'
  targets: DynamicContentObservedTarget[]
}

interface LayerFact {
  readonly source: string
  readonly effectiveVisible: boolean
  readonly item: { readonly kind: string; readonly layerItemId: string }
}

/** Only already-sanitized, host-observed automatic hits on a visible canonical layer cross to Main. */
export function collectDynamicContentTargets(input: {
  revision: number
  locationId: string
  sceneId: string
  layers: readonly LayerFact[]
  runtime: readonly Readonly<RuntimeAuthoringTarget>[]
  componentText: readonly Readonly<ComponentAuthoringTextTarget>[]
  componentImage: readonly Readonly<ComponentAuthoringImageTarget>[]
}): DynamicContentObservedTarget[] {
  const layers = new Map(input.layers.filter(layer => layer.effectiveVisible)
    .map(layer => [layer.item.layerItemId, layer] as const))
  const belongs = (kind: 'runtime' | 'component', nodeId: string | undefined, scope: string, sceneId: string | undefined) => {
    if (!nodeId || !['scene', 'global'].includes(scope) || scope === 'scene' && sceneId !== input.sceneId) return false
    const layer = layers.get(nodeId)
    return layer?.item.kind === kind && layer.source === scope
  }
  const results = new Map<string, DynamicContentObservedTarget>()
  const add = (hit: DynamicContentObservedTarget) => {
    const key = hit.kind === 'component.image'
      ? JSON.stringify([hit.kind, hit.itemId, hit.assetKey])
      : JSON.stringify([hit.kind, hit.itemId, hit.original, hit.region ?? ''])
    results.set(key, hit)
  }
  for (const target of input.runtime) {
    if (target.kind !== 'text' || target.source !== 'auto' || !target.lightEdit
      || !belongs('runtime', target.nodeId, target.scope, target.sceneId)) continue
    add({ kind: 'runtime.text', source: 'auto', revision: input.revision, locationId: input.locationId,
      itemId: target.nodeId!, original: target.lightEdit.original, region: target.lightEdit.region,
      text: target.lightEdit.text })
  }
  for (const target of input.componentText) {
    if (target.source !== 'auto' || !target.lightEdit
      || !belongs('component', target.nodeId, target.scope, target.sceneId)) continue
    add({ kind: 'component.text', source: 'auto', revision: input.revision, locationId: input.locationId,
      itemId: target.nodeId, original: target.lightEdit.original, region: target.lightEdit.region,
      text: target.lightEdit.text })
  }
  for (const target of input.componentImage) {
    if (target.source !== 'auto' || !belongs('component', target.nodeId, target.scope, target.sceneId)) continue
    add({ kind: 'component.image', source: 'auto', revision: input.revision, locationId: input.locationId,
      itemId: target.nodeId, assetKey: target.assetKey })
  }
  return [...results.values()]
}

type PublicationBody = Omit<DynamicContentPublication, 'publicationSeq'>
let nextPublicationSequence = 0

function identityOf(value: PublicationBody): string {
  return JSON.stringify([value.documentId, value.epoch, value.revision, value.locationId,
    value.viewGeneration, value.source])
}

/** A renderer-global sequence lets Main reject a prior view's late replacement after clear. */
export class DynamicContentTargetPublisher {
  private active: PublicationBody | null = null
  private signature = ''
  private readonly pending = new Set<Promise<void>>()
  private disposed = false

  constructor(private readonly send: (value: DynamicContentPublication) => Promise<unknown>) {}

  private enqueue(body: PublicationBody): void {
    const value: DynamicContentPublication = { ...body, publicationSeq: ++nextPublicationSequence }
    // Do not hold a clear behind a stalled previous IPC. Main applies maxSeq/tombstones.
    const task = Promise.resolve().then(async () => { await this.send(value) }).catch(() => undefined)
    this.pending.add(task)
    void task.finally(() => { this.pending.delete(task) })
  }

  replace(value: PublicationBody): void {
    if (this.disposed) return
    if (value.targets.length === 0) { this.clear(); return }
    const key = identityOf(value)
    const signature = JSON.stringify(value.targets)
    if (this.active && identityOf(this.active) !== key) this.clear()
    if (this.active && this.signature === signature) return
    this.active = value
    this.signature = signature
    this.enqueue(value)
  }

  clear(): void {
    if (!this.active) return
    const previous = this.active
    this.active = null
    this.signature = ''
    this.enqueue({ ...previous, targets: [] })
  }

  dispose(): void { this.clear(); this.disposed = true }

  /** Test and teardown synchronization only. */
  async settled(): Promise<void> { await Promise.all([...this.pending]) }
}
