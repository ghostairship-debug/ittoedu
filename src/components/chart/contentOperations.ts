import { nanoid } from 'nanoid'
import { chartDataSchema } from './data'
import type { ChartData } from './data'

type ChartCategory = ChartData['categories'][number]
type ChartSeries = ChartData['series'][number]
type ChartPoint = ChartSeries['points'][number]
type ChartCommonStyle = Pick<ChartData['style'], 'backgroundColor' | 'backgroundOpacity' | 'fontFamily' | 'fontSize' | 'textColor' | 'showLegend' | 'legendPosition' | 'showDataLabels'>

export type ChartType = ChartData['chartType']
export class ChartContentError extends Error {
  constructor(readonly reason: string, message: string) { super(message) }
}
export interface ChartCandidateData {
  readonly categories: readonly { readonly id?: string; readonly label: string }[]
  readonly series: readonly {
    readonly id?: string
    readonly name: string
    readonly color?: string
    readonly values: readonly number[]
  }[]
}

/** Observed ids win. Ordinary value edits reuse matching labels/names, then in-place renames. */
function retainedIds<T extends { readonly id?: string }, U extends { id: string }>(
  inputs: readonly T[], previous: readonly U[], label: (input: T) => string, oldLabel: (value: U) => string,
): (string | undefined)[] {
  const used = new Set(inputs.flatMap(input => input.id ? [input.id] : []))
  const ids = inputs.map(input => {
    if (input.id) return input.id
    const matched = previous.find(value => !used.has(value.id) && oldLabel(value) === label(input))
    if (matched) used.add(matched.id)
    return matched?.id
  })
  if (inputs.length === previous.length) for (const [index, input] of inputs.entries()) {
    const fallback = previous[index]
    if (!input.id && !ids[index] && !used.has(fallback.id)) { ids[index] = fallback.id; used.add(fallback.id) }
  }
  return ids
}

export function changeChartType(chart: ChartData, targetType: ChartType, retainedSeriesId?: string): ChartData {
  return convertedChartType(chart, targetType, retainedSeriesId)
}

/** A prepared table may have the new series count before its chart type/style is converted. */
function convertedChartType(chart: { chartType: ChartType; title: string; categories: ChartCategory[]; series: ChartSeries[]; style: ChartData['style'] },
  targetType: ChartType, retainedSeriesId?: string): ChartData {
  if (chart.chartType === targetType) return chartDataSchema.parse(structuredClone(chart))

  const isTargetSingleSeries = targetType === 'pie' || targetType === 'donut'

  let nextSeries: ChartSeries[]
  if (isTargetSingleSeries) {
    if (chart.series.length > 1) {
      if (!retainedSeriesId) {
        throw new ChartContentError(
          'retained-series-required',
          '多系列图表切入单系列图表（饼图/环形图）时必须指定要保留的系列 ID',
        )
      }
      const matched = chart.series.find((s) => s.id === retainedSeriesId)
      if (!matched) {
        throw new ChartContentError(
          'invalid-target',
          `指定的保留系列不存在：${retainedSeriesId}`,
        )
      }
      nextSeries = [structuredClone(matched)]
    } else {
      nextSeries = [structuredClone(chart.series[0]!)]
    }
  } else {
    nextSeries = structuredClone(chart.series)
  }

  // Build style
  const commonStyle: ChartCommonStyle = {
    backgroundColor: chart.style.backgroundColor,
    backgroundOpacity: chart.style.backgroundOpacity,
    fontFamily: chart.style.fontFamily,
    fontSize: chart.style.fontSize,
    textColor: chart.style.textColor,
    showLegend: chart.style.showLegend,
    legendPosition: chart.style.legendPosition,
    showDataLabels: chart.style.showDataLabels,
  }

  let candidateChart: ChartData
  if (targetType === 'pie') {
    candidateChart = {
      chartType: 'pie',
      title: chart.title,
      categories: structuredClone(chart.categories),
      series: [nextSeries[0]!] as [ChartSeries],
      style: commonStyle,
    }
  } else if (targetType === 'donut') {
    const existingHoleSize =
      'holeSize' in chart.style ? (chart.style as { holeSize: number }).holeSize : 50
    candidateChart = {
      chartType: 'donut',
      title: chart.title,
      categories: structuredClone(chart.categories),
      series: [nextSeries[0]!] as [ChartSeries],
      style: {
        ...commonStyle,
        holeSize: existingHoleSize,
      },
    }
  } else {
    const cartesianBase =
      'showCategoryAxis' in chart.style
        ? {
            showCategoryAxis: chart.style.showCategoryAxis,
            showValueAxis: chart.style.showValueAxis,
            showGridLines: chart.style.showGridLines,
            valueMin: chart.style.valueMin,
            valueMax: chart.style.valueMax,
          }
        : {
            showCategoryAxis: true,
            showValueAxis: true,
            showGridLines: true,
          }
    candidateChart = {
      chartType: targetType,
      title: chart.title,
      categories: structuredClone(chart.categories),
      series: nextSeries,
      style: {
        ...commonStyle,
        ...cartesianBase,
      },
    }
  }

return chartDataSchema.parse(candidateChart)
}
export function replaceChartTableData(chart: ChartData, candidateData: ChartCandidateData, idFactory: () => string = nanoid,
  targetType: ChartType = chart.chartType): ChartData {
  if (!candidateData.categories || candidateData.categories.length === 0) {
    throw new ChartContentError('invalid-data', '数据表格至少需要包含一个分类')
  }
  if (!candidateData.series || candidateData.series.length === 0) {
    throw new ChartContentError('invalid-data', '数据表格至少需要包含一个系列')
  }
  if (targetType === 'pie' || targetType === 'donut') {
    if (candidateData.series.length !== 1) {
      throw new ChartContentError('invalid-data', '饼图和环形图只支持单个系列')
    }
  }

  // Check all values
  for (const s of candidateData.series) {
    if (s.values.length !== candidateData.categories.length) {
      throw new ChartContentError('invalid-data', `系列 '${s.name}' 数据点数量必须与分类数一致`)
    }
    for (const val of s.values) {
      if (!Number.isFinite(val)) {
        throw new ChartContentError('invalid-data', '数据表格中存在非数字或无效数值')
      }
      if ((targetType === 'pie' || targetType === 'donut') && val < 0) {
        throw new ChartContentError('invalid-data', '饼图和环形图数值必须非负')
      }
    }
  }

  // Build categories matching old IDs if available
  const oldCatMap = new Map(chart.categories.map((c) => [c.id, c]))
  const categoryIds = retainedIds(candidateData.categories, chart.categories, input => input.label, value => value.label)
  const nextCategories: ChartCategory[] = candidateData.categories.map((catInput, index) => {
    const existing = categoryIds[index] ? oldCatMap.get(categoryIds[index]!) : undefined
    return {
      id: existing ? existing.id : `cat_${idFactory()}`,
      label: catInput.label,
    }
  })

  // Build series matching old IDs if available
  const oldSerMap = new Map(chart.series.map((s) => [s.id, s]))
  const seriesIds = retainedIds(candidateData.series, chart.series, input => input.name, value => value.name)
  const nextSeries: ChartSeries[] = candidateData.series.map((serInput, index) => {
    const existingSer = seriesIds[index] ? oldSerMap.get(seriesIds[index]!) : undefined
    const serId = existingSer ? existingSer.id : `ser_${idFactory()}`
    const color = serInput.color ?? existingSer?.color ?? '#2563eb'

    const points: ChartPoint[] = nextCategories.map((cat, catIdx) => {
      const val = serInput.values[catIdx]!
      const existingPt = existingSer?.points.find((p) => p.categoryId === cat.id)
      return {
        id: existingPt ? existingPt.id : `pt_${idFactory()}`,
        categoryId: cat.id,
        value: val,
      }
    })

    return {
      id: serId,
      name: serInput.name,
      color,
      points,
    }
  })

  return convertedChartType({ ...chart, categories: nextCategories, series: nextSeries }, targetType)
}
export function patchChartStyle(chart: ChartData, patch: Record<string, unknown>): ChartData {
  return chartDataSchema.parse({ ...chart, style: { ...chart.style, ...patch } })
}
