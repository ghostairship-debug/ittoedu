import type { ComponentImplementation } from '../../shared/contracts/component-platform'
import { chartDataSchema, type ChartData } from './data'
import { chartSvg } from './render'

/** Semantic series feed Office charts; SVG is for formats without editable charts. */
export function chartProfessionalOutput(data: ChartData, implementation?: ComponentImplementation) {
  const chart = chartDataSchema.parse(data)
  return {
    chartType: chart.chartType, title: chart.title,
    labels: chart.categories.map(c => c.label),
    series: chart.series.map(s => ({ id: s.id, name: s.name, color: s.color, values: s.points.map(p => p.value) })),
    style: structuredClone(chart.style),
    diagnostics: implementation && (implementation.kind !== 'builtin' || implementation.key !== 'guoling.chart')
      ? ['专业图表输出保留真实数据；自定义源码的视觉和行为需由其输出实现另行承载。'] : [],
  }
}
export const chartOutputAdapter = { semantic: chartProfessionalOutput, svg: chartSvg }
