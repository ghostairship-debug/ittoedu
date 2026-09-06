import { buildNativeChartView, type NativeChartViewContent } from './nativeChartView'

function escape(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function element(tag: string, attrs: Record<string, unknown>, content = ''): string {
  return `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}>${content}</${tag}>`
}
/** One SVG painter for editor, Player, print and static Word pictures. */
export function buildNativeChartSvg(chart: NativeChartViewContent, width: number, height: number, id = ''): string {
  const view = buildNativeChartView(chart, { width, height })
  const area = view.plotArea
  const text = (value: unknown, attrs: Record<string, unknown>) => element('text', {
    'font-family': chart.style.fontFamily, 'font-size': 12, fill: chart.style.textColor, ...attrs,
  }, escape(value))
  let content = element('desc', {}, escape(view.accessibleDescription))
  if (chart.style.backgroundColor && chart.style.backgroundOpacity > 0) content += element('rect', { width, height, fill: chart.style.backgroundColor, 'fill-opacity': chart.style.backgroundOpacity })
  if (view.title) content += text(view.title, { x: width / 2, y: 24, 'text-anchor': 'middle', 'font-size': chart.style.fontSize, 'font-weight': 'bold', 'data-chart-text': 'title' })
  if (view.cartesianSeries && (chart.chartType === 'bar' || chart.chartType === 'line' || chart.chartType === 'area')) {
    if (chart.style.showGridLines) for (const line of view.gridLines ?? []) content += element('line', { x1: view.horizontal ? line.x : area.x, y1: view.horizontal ? area.y : line.y, x2: view.horizontal ? line.x : area.x + area.width, y2: view.horizontal ? area.y + area.height : line.y, stroke: '#e5e7eb', 'stroke-width': 1 })
    if (chart.style.showValueAxis) for (const tick of view.gridLines ?? []) content += text(tick.value, { x: view.horizontal ? tick.x : area.x - 8, y: view.horizontal ? area.y + area.height + 18 : tick.y + 4, 'text-anchor': view.horizontal ? 'middle' : 'end', 'data-chart-value-tick': 'true' })
    let plot = ''
    for (const series of view.cartesianSeries) {
      for (const bar of series.bars ?? []) plot += element('rect', { x: bar.x, y: bar.y, width: bar.width, height: bar.height, fill: bar.color })
      if (series.areaPathD) plot += element('path', { d: series.areaPathD, fill: series.color, 'fill-opacity': 0.25 })
      if (series.linePathD) plot += element('path', { d: series.linePathD, stroke: series.color, 'stroke-width': 2.5, fill: 'none' })
      for (const point of series.points) {
        if (chart.style.showDataLabels && (view.horizontal ? point.x >= area.x && point.x <= area.x + area.width : point.y >= area.y && point.y <= area.y + area.height)) {
          const bar = series.bars?.find(item => item.categoryId === point.categoryId)
          plot += text(point.value, { x: view.horizontal ? Math.max(area.x + 20, Math.min(area.x + area.width - 20, point.x)) : bar ? bar.x + bar.width / 2 : point.x, y: view.horizontal && bar ? bar.y + bar.height / 2 + 4 : Math.max(area.y + 12, point.y - 7), 'text-anchor': view.horizontal ? (point.value < 0 ? 'start' : 'end') : 'middle', 'data-chart-data-label': 'true' })
        }
        if (chart.chartType !== 'bar') plot += element('circle', { cx: point.x, cy: point.y, r: 4, fill: series.color, stroke: '#ffffff', 'stroke-width': 1.5 })
      }
    }
    content += element('svg', { x: area.x, y: area.y, width: area.width, height: area.height, viewBox: `${area.x} ${area.y} ${area.width} ${area.height}`, style: 'overflow:hidden' }, plot)
    if (chart.style.showCategoryAxis) for (const category of view.categories ?? []) content += text(category.label, { x: view.horizontal ? area.x - 8 : category.x + category.width / 2, y: view.horizontal ? category.y + category.height / 2 + 4 : area.y + area.height + 18, 'text-anchor': view.horizontal ? 'end' : 'middle', 'data-chart-category-id': category.id })
  }
  for (const slice of view.circularSlices ?? []) {
    if (!slice.pathD) continue
    content += element('path', { d: slice.pathD, 'fill-rule': 'evenodd', fill: slice.color, stroke: '#ffffff', 'stroke-width': 1.5 })
    if (chart.style.showDataLabels && slice.value > 0) content += text(`${slice.value} (${slice.percentage}%)`, { x: slice.labelX, y: slice.labelY, 'text-anchor': 'middle', 'data-chart-data-label': 'true' })
  }
  if (view.legend?.items.length) {
    const position = view.legend.position
    const vertical = position === 'left' || position === 'right'
    let x = vertical ? (position === 'left' ? 8 : width - 84) : area.x
    let y = vertical ? area.y + 12 : position === 'top' ? (chart.title ? 42 : 18) : height - 14
    let legend = ''
    for (const item of view.legend.items) {
      legend += element('rect', { x, y: y - 9, width: 10, height: 10, rx: 2, fill: item.color })
      legend += text(vertical && item.label.length > 6 ? `${item.label.slice(0, 5)}…` : item.label, { x: x + 14, y, 'font-size': 11, [chart.chartType === 'pie' || chart.chartType === 'donut' ? 'data-chart-category-id' : 'data-chart-series-id']: item.id })
      if (vertical) y += 20
      else x += item.label.length * 12 + 30
    }
    content += element('g', { 'data-chart-legend': position }, legend)
  }
  return element('svg', { xmlns: 'http://www.w3.org/2000/svg', width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), viewBox: `0 0 ${width} ${height}`, style: 'display:block;width:100%;height:100%', 'data-native-chart-id': id }, content)
}
