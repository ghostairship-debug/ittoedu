import type { ComponentAuthorRecord, ComponentAuthorField } from '../../shared/contracts/component-platform/runtime'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform/project'
import { webAuthoringRecordSchema, webAuthoringRecordsSchema } from './data'
import { equalComponentValue } from '../../shared/componentValue'
import { anchorOwnedDocumentAuthoring } from './ownedDocumentIdentity'

export function assertAuthorRecordBinding(previous: ComponentAuthorRecord | undefined, spot: ComponentAuthorField): void {
  if (previous && (previous.kind !== spot.kind || !equalComponentValue(previous.scope ?? {}, spot.scope ?? {})
    || !equalComponentValue(previous.binding, spot.binding)))
    throw new Error('此处对象绑定已变化，修改内容已保留，请重新选择')
}

/** Compile an observed local object into the canonical component author writer. */
export function prepareWebAuthoringRecordEdits(project: CourseProjectV10,
  spot: ComponentAuthorField & { instanceId: string }, patch: ComponentAuthorRecord['overrides']): ComponentEdit[] {
  const instance = project.instances[spot.instanceId]
  if (!instance) throw new Error('原可编辑对象已不存在')
  if (!spot.authorKey || !spot.binding || spot.bindingStatus === 'unresolved' || spot.bindingStatus === 'source-required')
    throw new Error('此处对象尚未唯一绑定，修改内容已保留')
  const authorKey = spot.authorKey
  const documentPath = spot.scope?.['document:path']
  let identityEdits: ComponentEdit[] = []
  if (documentPath) {
    const data = instance.data
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string')
      throw new Error('原子文档源码已不存在，作者修改已保留')
    const anchored = anchorOwnedDocumentAuthoring(data.html, documentPath)
    spot = { ...spot, scope: { ...spot.scope, 'document:path': anchored.documentPath } }
    if (anchored.html !== data.html) identityEdits = [{ type: 'data.set', instanceId: instance.id, path: ['html'], value: anchored.html }]
  }
  const records = webAuthoringRecordsSchema.parse(instance.authoring?.records ?? {})
  const previous = records[authorKey]
  // Re-preparation reads the current project; CAS alone cannot prove that a reused local key is still this object.
  assertAuthorRecordBinding(previous, spot)
  const property = spot.kind === 'text' ? 'text' : 'src'
  // Only a submitted content field conflicts. Geometry and other local records can evolve independently.
  if (Object.hasOwn(patch, property) && previous
    && (previous.overrides[property] ?? previous.binding.baseline) !== spot.initialValue)
    throw new Error('此处内容已变化，修改内容已保留，请重新比较')
  const record = webAuthoringRecordSchema.parse(previous ? { ...previous, overrides: { ...previous.overrides, ...patch,
    ...(patch.geometry ? { geometry: { ...previous.overrides.geometry, ...patch.geometry } } : {}),
    ...(patch.style ? { style: { ...previous.overrides.style, ...patch.style } } : {}),
  } } : { kind: spot.kind, ...(spot.scope ? { scope: spot.scope } : {}), binding: spot.binding, overrides: patch })
  const set = (path: string[], value: unknown): ComponentEdit => ({ type: 'authoring.set', instanceId: instance.id, path, value: value as JsonValue })
  if (!instance.authoring?.records) return [...identityEdits, set(['records'], { [authorKey]: record })]
  if (!previous) return [...identityEdits, set(['records', authorKey], record)]
  return [...identityEdits, ...Object.keys(patch).flatMap(key => {
    const name = key as keyof ComponentAuthorRecord['overrides'], value = record.overrides[name]
    if (value === undefined) return []
    const path = ['records', authorKey, 'overrides', key]
    if ((name === 'style' || name === 'geometry') && previous.overrides[name]) {
      return Object.entries(patch[name]!).map(([field, value]) => set([...path, field], value))
    }
    return [set(path, value)]
  })]
}
