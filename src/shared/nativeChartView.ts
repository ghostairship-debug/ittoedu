import type {
  NativeChartCategory,
  NativeChartContent,
  NativeChartPoint,
  NativeChartSeries,
} from './contracts/native-v1/types'

export interface NativeChartPlotArea {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface NativeChartBarItem {
  readonly categoryId: string
  readonly seriesId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly value: number
  readonly color: string
}

export interface NativeChartPointCoordinate {
  readonly id: string
  readonly categoryId: string
  readonly seriesId: string
  readonly x: number
  readonly y: number
  readonly value: number
}

export interface NativeChartCartesianSeriesView {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly bars?: readonly NativeChartBarItem[]
  readonly points: readonly NativeChartPointCoordinate[]
  readonly linePathD?: string
  readonly areaPathD?: string
}

export interface NativeChartCircularSliceView {
  readonly categoryId: string
  readonly label: string
  readonly value: number
  readonly percentage: number
  readonly startAngle: number
  readonly endAngle: number
  readonly color: string
  readonly pathD: string
  readonly labelX: number
  readonly labelY: number
}

export interface NativeChartGridLineView {
  readonly y: number
  readonly value: number
}

export interface NativeChartLegendItem {
  readonly id: string
  readonly label: string
  readonly color: string
}

export interface NativeChartLegendView {
  readonly position: 'top' | 'right' | 'bottom' | 'left'
  readonly items: readonly NativeChartLegendItem[]
}

export interface NativeChartView {
  readonly chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  readonly width: number
  readonly height: number
  readonly title: string
  readonly plotArea: NativeChartPlotArea
  readonly legend?: NativeChartLegendView
  readonly accessibleDescription: string

  // Cartesian specific
  readonly categories?: readonly { readonly id: string; readonly label: string; readonly x: number; readonly width: number }[]
  readonly cartesianSeries?: readonly NativeChartCartesianSeriesView[]
  readonly gridLines?: readonly NativeChartGridLineView[]
  readonly valueMin?: number
  readonly valueMax?: number

  // Circular specific
  readonly circularSlices?: readonly NativeChartCircularSliceView[]
  readonly center?: { readonly x: number; readonly y: number }
  readonly outerRadius?: number
  readonly innerRadius?: number
}

export interface BuildNativeChartViewOptions {
  readonly width?: number
  readonly height?: number
}

type DeepReadonlyChart<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyChart<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyChart<T[Key]> }
    : T

/** Accepts both authoring (mutable) and Published (frozen) chart content. */
export type NativeChartViewContent = DeepReadonlyChart<NativeChartContent>

const DEFAULT_SERIES_COLORS = [
  '#2563eb', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
]

/**
 * Generates an accessible, human-readable summary of the chart.
 */
export function describeNativeChart(chart: NativeChartViewContent): string {
  const typeNames: Record<NativeChartContent['chartType'], string> = {
    bar: '柱状图',
    line: '折线图',
    area: '面积图',
    pie: '饼图',
    donut: '环形图',
  }

  const titlePrefix = chart.title ? `“${chart.title}”（${typeNames[chart.chartType]}）` : `${typeNames[chart.chartType]}`
  const catNames = chart.categories.map((c) => c.label).join('、')

  if (chart.chartType === 'pie' || chart.chartType === 'donut') {
    const singleSeries = chart.series[0]
    if (!singleSeries) return `${titlePrefix}，暂无数据。`
    const pointsSummary = chart.categories
      .map((cat, idx) => {
        const pt = singleSeries.points.find((p) => p.categoryId === cat.id) ?? singleSeries.points[idx]
        return `${cat.label}：${pt?.value ?? 0}`
      })
      .join('；')
    return `${titlePrefix}，包含分类：${catNames}。数据项：${pointsSummary}。`
  }

  const seriesSummary = chart.series
    .map((s) => {
      const vals = chart.categories
        .map((cat, idx) => {
          const pt = s.points.find((p) => p.categoryId === cat.id) ?? s.points[idx]
          return `${cat.label} ${pt?.value ?? 0}`
        })
        .join('，')
      return `系列“${s.name}”（${vals}）`
    })
    .join('；')

  return `${titlePrefix}，包含分类：${catNames}，共 ${chart.series.length} 个系列。${seriesSummary}。`
}

/**
 * Builds a deterministic, pure layout view model for any Native Chart.
 */
export function buildNativeChartView(
  chart: NativeChartViewContent,
  options: BuildNativeChartViewOptions = {},
): NativeChartView {
  const width = options.width !== undefined && options.width > 0 ? options.width : 600
  const height = options.height !== undefined && options.height > 0 ? options.height : 400

  const accessibleDescription = describeNativeChart(chart)

  // Layout margins
  const titleHeight = chart.title ? 32 : 12
  const legendSpace = chart.style.showLegend ? 28 : 0
  const legendPos = chart.style.legendPosition ?? 'top'

  let plotX = 50
  let plotY = titleHeight
  let plotW = width - 70
  let plotH = height - titleHeight - 40

  if (chart.style.showLegend) {
    if (legendPos === 'top') {
      plotY += legendSpace
      plotH -= legendSpace
    } else if (legendPos === 'bottom') {
      plotH -= legendSpace
    } else if (legendPos === 'left') {
      plotX += 80
      plotW -= 80
    } else if (legendPos === 'right') {
      plotW -= 80
    }
  }

  plotW = Math.max(10, plotW)
  plotH = Math.max(10, plotH)
  const plotArea: NativeChartPlotArea = { x: plotX, y: plotY, width: plotW, height: plotH }

  // Legend view
  let legend: NativeChartLegendView | undefined
  if (chart.style.showLegend) {
    if (chart.chartType === 'pie' || chart.chartType === 'donut') {
      legend = {
        position: legendPos,
        items: chart.categories.map((cat, idx) => ({
          id: cat.id,
          label: cat.label,
          color: DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length]!,
        })),
      }
    } else {
      legend = {
        position: legendPos,
        items: chart.series.map((s, idx) => ({
          id: s.id,
          label: s.name,
          color: s.color || DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length]!,
        })),
      }
    }
  }

  // Circular Chart (pie / donut)
  if (chart.chartType === 'pie' || chart.chartType === 'donut') {
    const centerX = plotX + plotW / 2
    const centerY = plotY + plotH / 2
    const outerRadius = Math.max(10, Math.min(plotW, plotH) / 2 - 10)
    const holeSizePercent = chart.chartType === 'donut' ? (chart.style.holeSize ?? 50) : 0
    const innerRadius = (outerRadius * holeSizePercent) / 100

    const singleSeries = chart.series[0]
    const values = chart.categories.map((cat, idx) => {
      const pt = singleSeries?.points.find((p) => p.categoryId === cat.id) ?? singleSeries?.points[idx]
      return Math.max(0, pt?.value ?? 0)
    })
    const total = values.reduce((sum, v) => sum + v, 0)

    let currentAngle = -Math.PI / 2 // Start at top 12 o'clock
    const circularSlices: NativeChartCircularSliceView[] = chart.categories.map((cat, idx) => {
      const val = values[idx]!
      const fraction = total > 0 ? val / total : 1 / chart.categories.length
      const sliceAngle = fraction * 2 * Math.PI
      const startAngle = currentAngle
      const endAngle = currentAngle + sliceAngle
      currentAngle = endAngle

      const color = DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length]!

      // Construct SVG arc path
      const x1 = centerX + outerRadius * Math.cos(startAngle)
      const y1 = centerY + outerRadius * Math.sin(startAngle)
      const x2 = centerX + outerRadius * Math.cos(endAngle)
      const y2 = centerY + outerRadius * Math.sin(endAngle)
      const largeArc = sliceAngle > Math.PI ? 1 : 0

      let pathD: string
      if (innerRadius > 0) {
        const ix1 = centerX + innerRadius * Math.cos(endAngle)
        const iy1 = centerY + innerRadius * Math.sin(endAngle)
        const ix2 = centerX + innerRadius * Math.cos(startAngle)
        const iy2 = centerY + innerRadius * Math.sin(startAngle)
        pathD = `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`
      } else {
        pathD = `M ${centerX} ${centerY} L ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} Z`
      }

      // Label coordinate (mid-angle)
      const midAngle = startAngle + sliceAngle / 2
      const labelRadius = innerRadius > 0 ? (innerRadius + outerRadius) / 2 : outerRadius * 0.65
      const labelX = centerX + labelRadius * Math.cos(midAngle)
      const labelY = centerY + labelRadius * Math.sin(midAngle)

      return {
        categoryId: cat.id,
        label: cat.label,
        value: val,
        percentage: Math.round(fraction * 1000) / 10,
        startAngle,
        endAngle,
        color,
        pathD,
        labelX,
        labelY,
      }
    })

    return {
      chartType: chart.chartType,
      width,
      height,
      title: chart.title,
      plotArea,
      legend,
      accessibleDescription,
      center: { x: centerX, y: centerY },
      outerRadius,
      innerRadius,
      circularSlices,
    }
  }

  // Cartesian Chart (bar, line, area)
  // Determine value range
  let allValues: number[] = []
  for (const s of chart.series) {
    for (const p of s.points) {
      if (Number.isFinite(p.value)) allValues.push(p.value)
    }
  }
  if (allValues.length === 0) allValues = [0, 10]

  let minVal = chart.style.valueMin !== undefined ? chart.style.valueMin : Math.min(0, ...allValues)
  let maxVal = chart.style.valueMax !== undefined ? chart.style.valueMax : Math.max(1, ...allValues)
  if (minVal >= maxVal) maxVal = minVal + 1

  const valRange = maxVal - minVal

  // Grid lines (4 intervals, 5 lines)
  const gridLines: NativeChartGridLineView[] = []
  const steps = 4
  for (let i = 0; i <= steps; i++) {
    const val = minVal + (valRange * i) / steps
    const y = plotY + plotH - (plotH * (val - minVal)) / valRange
    gridLines.push({ y, value: Math.round(val * 100) / 100 })
  }

  // Category slots
  const catCount = Math.max(1, chart.categories.length)
  const catWidth = plotW / catCount
  const categorySlots = chart.categories.map((cat, idx) => ({
    id: cat.id,
    label: cat.label,
    x: plotX + idx * catWidth,
    width: catWidth,
  }))

  const seriesCount = Math.max(1, chart.series.length)
  const barPadding = catWidth * 0.15
  const availableBarWidth = catWidth - barPadding * 2
  const singleBarWidth = chart.chartType === 'bar' ? availableBarWidth / seriesCount : 0

  const cartesianSeries: NativeChartCartesianSeriesView[] = chart.series.map((s, seriesIdx) => {
    const sColor = s.color || DEFAULT_SERIES_COLORS[seriesIdx % DEFAULT_SERIES_COLORS.length]!
    const points: NativeChartPointCoordinate[] = []
    const bars: NativeChartBarItem[] = []

    for (let cIdx = 0; cIdx < chart.categories.length; cIdx++) {
      const cat = chart.categories[cIdx]!
      const pt = s.points.find((p) => p.categoryId === cat.id) ?? s.points[cIdx]
      const val = pt ? pt.value : 0
      const normY = plotY + plotH - (plotH * (val - minVal)) / valRange

      // Center of category column
      const centerX = plotX + cIdx * catWidth + catWidth / 2
      points.push({
        id: pt?.id ?? `pt_${s.id}_${cat.id}`,
        categoryId: cat.id,
        seriesId: s.id,
        x: centerX,
        y: normY,
        value: val,
      })

      if (chart.chartType === 'bar') {
        const barX = plotX + cIdx * catWidth + barPadding + seriesIdx * singleBarWidth
        const zeroY = plotY + plotH - (plotH * (0 - minVal)) / valRange
        const topY = Math.min(zeroY, normY)
        const barHeight = Math.max(2, Math.abs(normY - zeroY))
        bars.push({
          categoryId: cat.id,
          seriesId: s.id,
          x: barX,
          y: topY,
          width: Math.max(2, singleBarWidth - 2),
          height: barHeight,
          value: val,
          color: sColor,
        })
      }
    }

    let linePathD: string | undefined
    let areaPathD: string | undefined

    if (points.length > 0) {
      linePathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

      if (chart.chartType === 'area') {
        const baselineY = plotY + plotH
        const first = points[0]!
        const last = points[points.length - 1]!
        areaPathD = `${linePathD} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`
      }
    }

    return {
      id: s.id,
      name: s.name,
      color: sColor,
      bars: chart.chartType === 'bar' ? bars : undefined,
      points,
      linePathD,
      areaPathD,
    }
  })

  return {
    chartType: chart.chartType,
    width,
    height,
    title: chart.title,
    plotArea,
    legend,
    accessibleDescription,
    categories: categorySlots,
    cartesianSeries,
    gridLines,
    valueMin: minVal,
    valueMax: maxVal,
  }
}
