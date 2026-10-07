import type { z } from 'zod'
import type { DocumentModel } from '../../shared/workbench/document'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, type JsonValue } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../drivers/courseV10Operations'
import type { objectUpdatePropertiesInputSchema } from './toolSchemas'
import { courseInstanceContext, type CourseInstanceTarget } from './ToolTargets'

type DataField = { path: string[]; value: JsonValue }
const record = (value: unknown): value is Record<string, JsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** These are actual professional property records, not an arbitrary recursive JSON merge. */
const professionalPropertyRecords: Readonly<Record<string, readonly string[]>> = {
  'guoling.text': ['appearance', 'sizing'],
  'guoling.formula': ['appearance', 'sizing'],
  'guoling.table': ['style'],
  'guoling.chart': ['style'],
  'guoling.shape': ['style'],
  'guoling.image': ['crop', 'feather', 'filters'],
  'guoling.video': ['poster'],
}

/**
 * Only supplied properties participate in a local edit. Arrays and content values
 * retain their existing replacement semantics; omitted fields never mean deletion.
 * Both file and object adapters can feed these fields to the canonical writer.
 */
export function componentDataPropertyFields(before: JsonValue, patch: JsonValue, builtinKey?: string): DataField[] {
  if (equalComponentValue(before, patch)) return []
  if (!record(before) || !record(patch)) return [{ path: [], value: patch }]
  const propertyRecords = professionalPropertyRecords[builtinKey ?? ''] ?? []
  return Object.entries(patch).flatMap(([name, value]): DataField[] => {
    const previous = before[name]
    if (propertyRecords.includes(name) && record(previous) && record(value)) {
      return Object.entries(value).flatMap(([field, next]) => equalComponentValue(previous[field], next)
        ? [] : [{ path: [name, field], value: next }])
    }
    return equalComponentValue(previous, value) ? [] : [{ path: [name], value }]
  })
}

/** Selected instance properties use the same public operations as the inspector. */
export function courseInstancePropertyEdits(model: DocumentModel, target: CourseInstanceTarget,
  properties: z.infer<typeof objectUpdatePropertiesInputSchema>): ComponentEdit[] {
  if (target.dataPath || target.from !== undefined || target.to !== undefined) throw new Error('属性修改需要整对象授权，所选文字仅可替换正文')
  const { project, instance } = courseInstanceContext(model, target)
  if (instance.locked && Object.keys(properties).some(key => key !== 'locked')) throw new Error('所选对象已锁定，请先解锁')
  const edits: ComponentEdit[] = []
  if (properties.frame || properties.rotation !== undefined) {
    if (!instance.frame) throw new Error('当前正文对象没有自由布局 frame')
    const frame = structuredClone(instance.frame), patch = properties.frame
    if (patch?.width !== undefined) frame.width = patch.width
    if (patch?.height !== undefined) frame.height = patch.height
    if (patch?.x !== undefined) frame.transform[4] = patch.x
    if (patch?.y !== undefined) frame.transform[5] = patch.y
    if (properties.rotation !== undefined) {
      const delta = properties.rotation * Math.PI / 180 - Math.atan2(frame.transform[1], frame.transform[0])
      const c = Math.cos(delta), s = Math.sin(delta), [a, b, x, d] = frame.transform
      frame.transform.splice(0, 4, c * a - s * b, s * a + c * b, c * x - s * d, s * x + c * d)
    }
    edits.push({ type: 'frame.set', instanceId: instance.id, frame })
  }
  if (properties.data !== undefined) {
    const builtinKey = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
    edits.push(...componentDataPropertyFields(instance.data, properties.data, builtinKey)
      .map(field => ({ type: 'data.set' as const, instanceId: instance.id, ...field })))
  }
  // CSS null remains an explicit cleared value under the existing style contract.
  const style = { ...properties.style, ...(properties.opacity !== undefined ? { opacity: properties.opacity } : {}) }
  for (const [name, value] of Object.entries(style)) if (!equalComponentValue(instance.style?.[name], value))
    edits.push({ type: 'style.set', instanceId: instance.id, path: [name], value })
  const patch = { ...(properties.visible !== undefined ? { visible: properties.visible } : {}),
    ...(properties.locked !== undefined ? { locked: properties.locked } : {}), ...(properties.label !== undefined ? { name: properties.label } : {}) }
  if (Object.keys(patch).length) edits.push({ type: 'instance.patch', instanceId: instance.id, patch })
  if (properties.implementation !== undefined) edits.push({ type: 'implementation.set', instanceId: instance.id, implementation: properties.implementation })
  return edits
}
