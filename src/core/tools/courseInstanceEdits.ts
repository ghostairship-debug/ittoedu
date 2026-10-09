import type { z } from 'zod'
import type { DocumentModel } from '../../shared/workbench/document'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, type JsonValue } from '../../shared/contracts/component-platform/project'
import { equalComponentValue } from '../drivers/courseV10Operations'
import type { objectConvertOptionsInputSchema, objectUpdatePropertiesInputSchema } from './toolSchemas'
import { courseInstanceContext, type CourseInstanceTarget } from './ToolTargets'
import { parseTableData, tableCellContent } from '../../components/table/data'
import { CHART_DEFINITION } from '../../components/chart'
import { createChartData } from '../../components/chart/data'
import { changeChartType, replaceChartTableData } from '../../components/chart/contentOperations'
import { chartDataEdit } from '../../components/chart/edit'
import { plainDocumentText } from '../../shared/document/content'
import { componentDataEdits } from '../course/componentDataEdits'
export { componentDataPropertyFields } from '../course/componentDataEdits'

/** Selected instance properties use the same public operations as the inspector. */
export function courseInstancePropertyEdits(model: DocumentModel, target: CourseInstanceTarget,
  properties: Omit<z.infer<typeof objectUpdatePropertiesInputSchema>, 'implementation'>): ComponentEdit[] {
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
  if (properties.data !== undefined) edits.push(...componentDataEdits(project, target, { kind: 'patch', data: properties.data }))
  // CSS null remains an explicit cleared value under the existing style contract.
  const style = { ...properties.style, ...(properties.opacity !== undefined ? { opacity: properties.opacity } : {}) }
  for (const [name, value] of Object.entries(style)) if (!equalComponentValue(instance.style?.[name], value))
    edits.push({ type: 'style.set', instanceId: instance.id, path: [name], value })
  const patch = { ...(properties.visible !== undefined ? { visible: properties.visible } : {}),
    ...(properties.playbackInitialVisibility !== undefined ? { playbackInitialVisibility: properties.playbackInitialVisibility } : {}),
    ...(properties.locked !== undefined ? { locked: properties.locked } : {}), ...(properties.label !== undefined ? { name: properties.label } : {}) }
  if (Object.keys(patch).length) edits.push({ type: 'instance.patch', instanceId: instance.id, patch })
  return edits
}

export type CourseInstanceConversionInput = z.infer<typeof objectConvertOptionsInputSchema>

/** Convert the selected table through professional chart algorithms and the same History writer. */
export function courseInstanceConversionEdits(model: DocumentModel, target: CourseInstanceTarget,
  input: CourseInstanceConversionInput): ComponentEdit[] {
  if (target.dataPath || target.from !== undefined || target.to !== undefined) throw new Error('类型转换需要整对象授权')
  const { project, instance } = courseInstanceContext(model, target)
  if (instance.locked) throw new Error('所选对象已锁定，请先解锁')
  if (componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) !== 'guoling.table') throw new Error('当前转换入口需要一个表格对象')
  if (target.stateId || project.surfaces.some(surface => surface.presentation?.states.some(state => state.overrides[instance.id]?.data !== undefined)))
    throw new Error('当前表格存在展示状态数据，不能仅转换基础对象；请先处理该状态的数据')
  if (instance.childIds?.length) throw new Error('当前表格包含子对象，不能在转换时丢弃其内容')

  const table = parseTableData(instance.data), categoryIndex = (input.categoryColumn ?? 1) - 1
  const valueIndexes = input.valueColumns?.map(column => column - 1) ?? table.columns.map((_, index) => index).filter(index => index !== categoryIndex)
  if (categoryIndex < 0 || categoryIndex >= table.columns.length || valueIndexes.some(index => index < 0 || index >= table.columns.length))
    throw new Error('转换指定的列超出当前表格范围')
  if (!valueIndexes.length || new Set(valueIndexes).size !== valueIndexes.length || valueIndexes.includes(categoryIndex))
    throw new Error('图表需要至少一个不重复且不同于类别列的数值列')
  const text = (row: typeof table.rows[number], columnIndex: number): string => {
    const cell = row.cells.find(value => value.columnId === table.columns[columnIndex]!.id)
    if (!cell) throw new Error('当前表格缺少指定列的单元格')
    return plainDocumentText(tableCellContent(cell)).trim()
  }
  const rows = table.rows.slice(table.headerRowCount)
  if (!rows.length) throw new Error('当前表格没有可转换的数据行')
  const columnTitle = (index: number): string => {
    const header = table.columns[index]!.header
    return (header ? plainDocumentText(header).trim() : table.rows.slice(0, table.headerRowCount).map(row => text(row, index)).filter(Boolean).join(' / ')) || `第 ${index + 1} 列`
  }
  const series = valueIndexes.map(index => ({ name: columnTitle(index), values: rows.map((row, rowIndex) => {
    const source = text(row, index), value = Number(source)
    if (!source || !Number.isFinite(value)) throw new Error(`第 ${table.headerRowCount + rowIndex + 1} 行、第 ${index + 1} 列不是可转换的数值`)
    return value
  }) }))
  if ((input.chartType === 'pie' || input.chartType === 'donut') && series.length !== 1)
    throw new Error('饼图和环形图需要一个数值列，请通过 valueColumns 指定要使用的列')

  const initial = createChartData()
  initial.title = input.title ?? (table.caption ? plainDocumentText(table.caption) : instance.name) ?? initial.title
  initial.style = { ...initial.style, backgroundColor: table.style.fillColor, backgroundOpacity: table.style.fillOpacity,
    fontFamily: table.style.fontFamily, fontSize: table.style.fontSize, textColor: table.style.textColor }
  const data = changeChartType(replaceChartTableData(initial, { categories: rows.map(row => ({ label: text(row, categoryIndex) })), series }), input.chartType ?? 'bar')
  const knownDefinition = Object.values(project.definitions).find(definition => equalComponentValue(definition, CHART_DEFINITION))
  const definition = knownDefinition ?? { ...CHART_DEFINITION, id: project.definitions[CHART_DEFINITION.id] ? crypto.randomUUID() : CHART_DEFINITION.id }
  return [
    ...(!knownDefinition ? [{ type: 'definition.set' as const, definition }] : []),
    { type: 'instance.definition.set', instanceId: instance.id, definitionId: definition.id },
    chartDataEdit(instance.id, data),
    ...(instance.implementationOverride ? [{ type: 'implementation.set' as const, instanceId: instance.id, implementation: null }] : []),
  ]
}
