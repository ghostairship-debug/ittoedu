import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import { componentRuleEdits, interactionBehavior, componentInteractionDataSchema } from '../../shared/componentInteractionData'
import { equalComponentValue } from '../drivers/courseV10Operations'
import { componentInputDataPropertyEdits } from '../../components/input/authoring'
import { chartDataSchema, chartTableDataSchema } from '../../components/chart/data'
import { changeChartType, replaceChartTableData } from '../../components/chart/contentOperations'
import { editChartData, type ChartEdit } from '../../components/chart/edit'
import { editTableData, type TableEdit } from '../../components/table/edit'
import { parseTableData } from '../../components/table/data'
import { shapeDataSchema } from '../../components/shape/data'
import { switchShapeType } from '../../components/shape/authoring'

export interface ComponentDataTarget { surfaceId: string | null; instanceId: string; stateId?: string | null }
export interface ComponentDataField { path: string[]; value: JsonValue }
export type ComponentDataChange = { kind: 'patch' | 'replace'; data: JsonValue }
  | { kind: 'fields'; fields: readonly ComponentDataField[] }
const record = (value: unknown): value is Record<string, JsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/** These are professional property records, not an arbitrary recursive JSON merge. */
const professionalPropertyRecords: Readonly<Record<string, readonly string[]>> = {
  'guoling.text': ['appearance', 'sizing'], 'guoling.formula': ['appearance', 'sizing'],
  'guoling.table': ['style'], 'guoling.chart': ['style'], 'guoling.shape': ['style'],
  'guoling.image': ['crop', 'feather', 'filters'], 'guoling.video': ['poster'],
}

/** Declared write scope is independent of whether the supplied value already equals it. */
export function componentDataPropertyPaths(before: JsonValue, patch: JsonValue, builtinKey?: string): string[][] {
  if (record(patch) && !Object.keys(patch).length) return []
  if (!record(before) || !record(patch)) return [[]]
  const propertyRecords = professionalPropertyRecords[builtinKey ?? ''] ?? []
  return Object.entries(patch).flatMap(([name, value]): string[][] => {
    const previous = before[name]
    if (propertyRecords.includes(name) && record(value)) {
      if (!Object.keys(value).length) return []
      if (record(previous)) return Object.keys(value).map(field => [name, field])
    }
    return [[name]]
  })
}
const propertyValue = (value: JsonValue, path: readonly string[]): JsonValue | undefined => {
  let current: JsonValue | undefined = value
  for (const key of path) current = record(current) ? current[key] : undefined
  return current
}
/** Omitted properties are retained; arrays and content values keep replacement semantics. */
export function componentDataPropertyFields(before: JsonValue, patch: JsonValue, builtinKey?: string): ComponentDataField[] {
  return componentDataPropertyPaths(before, patch, builtinKey).flatMap(path => {
    const value = propertyValue(patch, path)!
    return equalComponentValue(propertyValue(before, path), value) ? [] : [{ path, value }]
  })
}

/** Materialize the requested fields only; the canonical writer still owns validation/CAS. */
function changedData(before: JsonValue, fields: readonly ComponentDataField[]): JsonValue {
  let result = structuredClone(before)
  for (const { path, value } of fields) {
    if (!path.length) { result = structuredClone(value); continue }
    let parent: unknown = result
    for (const key of path.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('字段父级已不存在')
      parent = (parent as Record<string, unknown>)[key]
    }
    if (!parent || typeof parent !== 'object') throw new Error('字段目标不是对象')
    const key = path.at(-1)!
    if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || !Object.hasOwn(parent, key))) throw new Error('数组元素已不存在')
    Object.defineProperty(parent, key, { value: structuredClone(value), writable: true, enumerable: true, configurable: true })
  }
  return result
}

/**
 * Shared semantic planning for properties, component JSON and data files. Returns
 * ordinary edits; callers retain their capture, state projection and History owner.
 */
export function componentDataEdits(project: CourseProjectV10, target: ComponentDataTarget, change: ComponentDataChange): ComponentEdit[] {
  const effective = resolveComponentPresentation(project, target.surfaceId, target.stateId ?? null)
  const instance = effective.instances[target.instanceId]
  if (!instance) throw new Error('专业数据编辑目标已不存在')
  const builtinKey = componentDefinitionBuiltinKey(effective.definitions[instance.definitionId])
  let fields = change.kind === 'fields' ? [...change.fields] : change.kind === 'patch'
    ? componentDataPropertyFields(instance.data, change.data, builtinKey) : [{ path: [], value: change.data }]
  let next = changedData(instance.data, fields)
  if (equalComponentValue(instance.data, next)) return []

  if (builtinKey === 'guoling.input') {
    const managed = componentInputDataPropertyEdits(effective, target.surfaceId, instance.id, next)
    if (managed) return managed
  }
  if (builtinKey === 'guoling.chart' && record(next)) {
    const candidate = chartTableDataSchema.safeParse({ categories: next.categories, series: next.series })
    if (candidate.success) {
      const before = chartDataSchema.parse(instance.data)
      const nextChartType = next.chartType === undefined ? before.chartType : next.chartType
      const requested = chartDataSchema.options.map(option => option.shape.chartType.safeParse(nextChartType)).find(result => result.success)
      if (!requested?.success) throw new Error('图表类型无效')
      // Match identities against the complete old chart; validate and convert the final values.
      const prepared = replaceChartTableData(before, candidate.data, undefined, requested.data)
      next = json(chartDataSchema.parse(changedData(json(prepared), componentDataPropertyFields(instance.data, next, builtinKey)
        .filter(field => field.path[0] !== 'categories' && field.path[0] !== 'series'))))
      fields = [{ path: [], value: next }]
    }
  }
  if (builtinKey === 'guoling.chart' && record(next) && record(instance.data) && next.chartType !== instance.data.chartType
    && !chartDataSchema.safeParse(next).success) {
    const before = chartDataSchema.parse(instance.data)
    const selectedSeries = Array.isArray(next.series) && next.series.length === 1 && record(next.series[0])
      ? next.series[0].id : undefined
    const nextChartType = next.chartType
    const requested = chartDataSchema.options.map(option => option.shape.chartType.safeParse(nextChartType)).find(result => result.success)
    if (!requested?.success) throw new Error('图表类型无效')
    const converted = changeChartType(before, requested.data, typeof selectedSeries === 'string' ? selectedSeries : undefined)
    // The unchanged old style in a full JSON draft must not undo type conversion.
    next = json(chartDataSchema.parse(changedData(json(converted), componentDataPropertyFields(instance.data, next, builtinKey))))
    fields = [{ path: [], value: next }]
  }
  if (builtinKey === 'guoling.shape' && record(next) && record(instance.data) && next.shapeType !== instance.data.shapeType) {
    const requested = shapeDataSchema.shape.shapeType.parse(next.shapeType)
    const converted = switchShapeType({ ...instance, data: shapeDataSchema.parse(instance.data) }, requested)
    if (converted.type === 'data.set') {
      next = changedData(converted.value, componentDataPropertyFields(instance.data, next, builtinKey))
      fields = [{ path: [], value: next }]
    }
  }
  if (builtinKey === 'guoling.interactions') {
    const owner = instance.attachments?.find(attachment => attachment.instanceId === instance.id)?.target
    if (owner && interactionBehavior(effective, owner)?.id === instance.id)
      return componentRuleEdits(effective, owner, componentInteractionDataSchema.parse(next).rules)
  }
  return fields.map(field => ({ type: 'data.set', instanceId: instance.id, ...field }))
}

export function componentTableDataEdits(project: CourseProjectV10, target: ComponentDataTarget, edit: TableEdit): ComponentEdit[] {
  const effective = resolveComponentPresentation(project, target.surfaceId, target.stateId ?? null)
  return componentDataEdits(project, target, { kind: 'replace', data: json(editTableData(parseTableData(effective.instances[target.instanceId]?.data), edit)) })
}

export function componentChartDataEdits(project: CourseProjectV10, target: ComponentDataTarget,
  edit: ChartEdit | { type: 'chart-type'; chartType: ReturnType<typeof chartDataSchema.parse>['chartType']; retainedSeriesId?: string }): ComponentEdit[] {
  const effective = resolveComponentPresentation(project, target.surfaceId, target.stateId ?? null)
  const data = chartDataSchema.parse(effective.instances[target.instanceId]?.data)
  return componentDataEdits(project, target, { kind: 'replace', data: json(edit.type === 'chart-type'
    ? changeChartType(data, edit.chartType, edit.retainedSeriesId) : editChartData(data, edit)) })
}
