import type { ComponentEdit, JsonValue } from '../../shared/contracts/component-platform'
import { chartDataSchema, type ChartData } from './data'

export type ChartEdit =
  | { type: 'title'; value: string }
  | { type: 'category'; categoryId: string; label: string }
  | { type: 'series'; seriesId: string; name?: string; color?: string }
  | { type: 'point'; seriesId: string; categoryId: string; value: number }
  | { type: 'style'; patch: Record<string, unknown> }
  | { type: 'data'; categories: ChartData['categories']; series: ChartData['series'] }

/** Returns a detached candidate; DocumentSession owns submission and undo. */
export function editChartData(data: ChartData, edit: ChartEdit): ChartData {
  const next = structuredClone(data)
  const requireTarget = <T>(value: T | undefined): T => { if (value === undefined) throw new Error('图表编辑目标已不存在'); return value }
  if (edit.type === 'title') next.title = edit.value
  else if (edit.type === 'category') requireTarget(next.categories.find(c => c.id === edit.categoryId)).label = edit.label
  else if (edit.type === 'series') {
    const target = requireTarget(next.series.find(s => s.id === edit.seriesId))
    if (edit.name !== undefined) target.name = edit.name
    if (edit.color !== undefined) target.color = edit.color
  } else if (edit.type === 'point') requireTarget(requireTarget(next.series.find(s => s.id === edit.seriesId)).points.find(p => p.categoryId === edit.categoryId)).value = edit.value
  else if (edit.type === 'style') return chartDataSchema.parse({ ...next, style: { ...next.style, ...edit.patch } })
  else return chartDataSchema.parse({ ...next, categories: edit.categories, series: edit.series })
  return chartDataSchema.parse(next)
}
export function chartDataEdit(instanceId: string, data: ChartData): Extract<ComponentEdit, { type: 'data.set' }> {
  return { type: 'data.set', instanceId, path: [], value: JSON.parse(JSON.stringify(chartDataSchema.parse(data))) as JsonValue }
}
export function chartEdit(instanceId: string, data: ChartData, edit: ChartEdit): Extract<ComponentEdit, { type: 'data.set' }> {
  return chartDataEdit(instanceId, editChartData(data, edit))
}
