import { buildNativeChartView } from '../../shared/nativeChartView'
import { buildNativeChartSvg } from '../../shared/nativeChartSvg'
import { chartDataSchema, type ChartData } from './data'

export function chartView(data: ChartData, width = 640, height = 400) {
  return buildNativeChartView(chartDataSchema.parse(data), { width, height })
}
export function chartSvg(data: ChartData, width = 640, height = 400, instanceId = ''): string {
  return buildNativeChartSvg(chartDataSchema.parse(data), width, height, instanceId)
}
export function renderChart(document: Document, data: ChartData, width = 640, height = 400, instanceId = ''): HTMLElement {
  const element = document.createElement('div')
  element.style.width = '100%'; element.style.height = '100%'
  element.innerHTML = chartSvg(data, width, height, instanceId)
  return element
}
