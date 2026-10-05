import { nanoid } from 'nanoid'
import type { ComponentInstance, ComponentSurface } from '../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { designProductionStep, type ProductivityContext, type ProductivityApplyResult } from './index'

type RecordValue = Record<string, unknown>
const scalarReferences = new Set(['instanceId', 'targetInstanceId', 'sourceInstanceId', 'surfaceId', 'targetSurfaceId', 'stateId', 'targetStateId', 'initialStateId', 'thumbnailStateId', 'blockId'])
const arrayReferences = new Set(['instanceIds', 'frameIds', 'order'])
/** Rewrite declared component references; arbitrary source and extension props stay opaque. */
function remap(value: unknown, ids: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(child => remap(child, ids)); return }
  const record = value as RecordValue
  for (const [key, child] of Object.entries(record)) {
    if (scalarReferences.has(key) && typeof child === 'string') record[key] = ids.get(child) ?? child
    else if (arrayReferences.has(key) && Array.isArray(child)) record[key] = child.map(id => typeof id === 'string' ? ids.get(id) ?? id : id)
    else if (key === 'overrides' && child && typeof child === 'object') {
      record[key] = Object.fromEntries(Object.entries(child).map(([id, override]) => [ids.get(id) ?? id, override]))
      remap(record[key], ids)
    } else if (!['source', 'props', 'metadata', 'implementationOverride', 'implementation'].includes(key)) remap(child, ids)
  }
}

export function prepareReferenceClone(context: ProductivityContext, sourceSurfaceId: string) {
  const project = context.document, source = project.surfaces.find(surface => surface.id === sourceSurfaceId && surface.kind === 'slide')
  if (!source) throw new Error('参考页不存在，请重新选择')
  const ids = new Map<string, string>([[source.id, `surface_${nanoid(12)}`]])
  const original: ComponentInstance[] = []
  const collect = (id: string) => {
    const instance = project.instances[id]
    if (!instance) throw new Error(`参考页对象已不存在：${id}`)
    ids.set(id, `instance_${nanoid(12)}`); original.push(instance)
    instance.childIds?.forEach(collect)
  }
  source.childIds.forEach(collect)
  for (const state of source.presentation?.states ?? []) ids.set(state.id, `state_${nanoid(12)}`)
  for (const frame of source.spatial?.frames ?? []) ids.set(frame.id, `frame_${nanoid(12)}`)
  const surface: ComponentSurface = structuredClone(source)
  surface.id = ids.get(source.id)!; surface.title = `${source.title} 副本`; surface.childIds = []
  remap(surface, ids)
  for (const state of surface.presentation?.states ?? []) state.id = ids.get(state.id) ?? state.id
  for (const frame of surface.spatial?.frames ?? []) frame.id = ids.get(frame.id) ?? frame.id
  const instances = original.map(instance => {
    const copy = structuredClone(instance)
    const next: ComponentInstance = { ...copy, id: ids.get(instance.id)!, ...(copy.childIds ? { childIds: copy.childIds.map(id => ids.get(id)!) } : {}) }
    remap(next, ids)
    return next
  })
  const edits: ComponentEdit[] = [
    { type: 'surface.insert', surface, index: project.surfaces.findIndex(value => value.id === source.id) + 1 },
    ...(instances.length ? [{ type: 'instance.insert' as const, container: { kind: 'surface' as const, surfaceId: surface.id }, index: 0, instances, rootIds: source.childIds.map(id => ids.get(id)!) }] : []),
  ]
  return { source, surface, instances, ids, edits }
}

/** Clone author-owned instances and states; project assets/definitions remain shared resources. */
export function cloneReferencePage(context: ProductivityContext, sourceSurfaceId: string, _assetFiles: Readonly<Record<string, Uint8Array>> = {}): ProductivityApplyResult {
  try {
    const clone = prepareReferenceClone(context, sourceSurfaceId)
    return { ok: true, step: { ...designProductionStep(context, clone.edits), createdSurfaceId: clone.surface.id } }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '参考页克隆失败' } }
}
