import { describe, expect, it } from 'vitest'
import { createChartNode } from '@/core/tools/nativeNodeFactories'
import { buildNativeChartSvg } from '@/shared/nativeChartSvg'
import { changeChartType } from '@/renderer/course/chartContentOperations'
import {
  buildNativeChartView,
  describeNativeChart,
} from '@/shared/nativeChartView'

describe('nativeChartView buildNativeChartView & describeNativeChart', () => {
  it('renders horizontal signed bars, ordered categories and vertical grid lines; switching type clears direction', () => {
    const chart = createChartNode({ chartType: 'bar', style: { barDirection: 'horizontal', valueMin: -20, valueMax: 40 } })
    chart.series[0]!.points.forEach((point, index) => { point.value = [-10, 30, 60][index]! })
    const view = buildNativeChartView(chart, { width: 600, height: 400 })
    const area = view.plotArea, bars = view.cartesianSeries![0]!.bars!
    const zeroX = area.x + area.width / 3
    expect(bars[0]!.x + bars[0]!.width).toBeCloseTo(zeroX)
    expect(bars[1]!.x).toBeCloseTo(zeroX)
    expect(bars[2]!.x + bars[2]!.width).toBeCloseTo(area.x + area.width)
    expect(bars[0]!.y).toBeLessThan(bars[1]!.y)
    expect(bars[1]!.y).toBeLessThan(bars[2]!.y)
    const svg = new DOMParser().parseFromString(buildNativeChartSvg(chart, 600, 400), 'image/svg+xml')
    for (const line of svg.querySelectorAll('line')) expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'))
    expect(describeNativeChart(chart)).toContain('横向条形图')
    expect(changeChartType(chart, 'line').style).not.toHaveProperty('barDirection')
    expect(changeChartType(chart, 'bar').style).toHaveProperty('barDirection', 'horizontal')
  })
  it('builds Cartesian bar chart view with correct bars and accessible description', () => {
    const chart = createChartNode({
      chartType: 'bar',
      title: '季度销售',
    })

    const view = buildNativeChartView(chart, { width: 800, height: 500 })
    expect(view.chartType).toBe('bar')
    expect(view.title).toBe('季度销售')
    expect(view.categories).toHaveLength(3)
    expect(view.cartesianSeries).toHaveLength(1)

    const s0 = view.cartesianSeries![0]!
    expect(s0.bars).toHaveLength(3)
    expect(s0.points).toHaveLength(3)
    expect(view.gridLines).toHaveLength(5)

    const desc = describeNativeChart(chart)
    expect(desc).toContain('季度销售')
    expect(desc).toContain('柱状图')
    expect(desc).toContain('系列 1')
  })

  it('builds Cartesian line and area chart views with SVG paths', () => {
    const lineChart = createChartNode({ chartType: 'line' })
    const lineView = buildNativeChartView(lineChart)
    expect(lineView.chartType).toBe('line')
    expect(lineView.cartesianSeries![0]!.linePathD).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)? L/)

    const areaChart = createChartNode({ chartType: 'area' })
    const areaView = buildNativeChartView(areaChart)
    expect(areaView.chartType).toBe('area')
    expect(areaView.cartesianSeries![0]!.areaPathD).toMatch(/Z$/)
  })

  it('builds Circular pie and donut chart views with accurate arc paths and hole sizes', () => {
    const pieChart = createChartNode({ chartType: 'pie', title: '市场份额' })
    const pieView = buildNativeChartView(pieChart)
    expect(pieView.chartType).toBe('pie')
    expect(pieView.innerRadius).toBe(0)
    expect(pieView.circularSlices).toHaveLength(3)
    expect(pieView.circularSlices![0]!.pathD).toContain('A')

    const donutChart = createChartNode({ chartType: 'donut', title: '占比环形' })
    const donutView = buildNativeChartView(donutChart)
    expect(donutView.chartType).toBe('donut')
    expect(donutView.innerRadius).toBeGreaterThan(0)
    expect(donutView.circularSlices![0]!.pathD).toContain('A')

    const desc = describeNativeChart(donutChart)
    expect(desc).toContain('占比环形')
    expect(desc).toContain('环形图')
  })
  it('uses the authored font size for readable labels and legends in a 640 by 268 market chart', () => {
    const chart = createChartNode({ chartType: 'bar', title: '营业额 / 元', style: {
      barDirection: 'horizontal', valueMin: 0, valueMax: 6000, fontSize: 20, textColor: '#233F35',
      showLegend: true, legendPosition: 'bottom', showDataLabels: true,
    } })
    const values = [0, 3024, 3120, 4320, 5760]
    chart.categories = ['手冲咖啡', '独立书摊', '植物工坊', '夜间小食', '手作陶器'].map((label, index) => ({ id: 'market-' + index, label }))
    chart.series = [{ id: 'revenue', name: '营业额', color: '#356C59', points: values.map((value, index) => ({
      id: 'value-' + index, categoryId: chart.categories[index]!.id, value,
    })) }]
    const view = buildNativeChartView(chart, { width: 640, height: 268 })
    const dom = new DOMParser().parseFromString(buildNativeChartSvg(chart, 640, 268), 'image/svg+xml')
    const labels = [...dom.querySelectorAll('[data-chart-data-label]')]
    const bars = view.cartesianSeries![0]!.bars!
    expect(labels.map(label => label.textContent)).toEqual(values.map(String))
    expect(labels.map(label => label.getAttribute('font-size'))).toEqual(values.map(() => '15'))
    expect(dom.querySelector('[data-chart-series-id]')?.getAttribute('font-size')).toBe('14')
    expect(view.plotArea.x).toBeGreaterThanOrEqual(4 * 15 + 16)
    expect(view.gridLines!.map(tick => tick.value)).toEqual([0, 1500, 3000, 4500, 6000])
    // Short/zero bars have readable ink labels on the paper; the longest bar has white text inside its dark fill.
    expect(labels[0]!.getAttribute('text-anchor')).toBe('start')
    expect(labels[0]!.getAttribute('fill')).toBe('#233F35')
    expect(Number(labels[1]!.getAttribute('x'))).toBeGreaterThan(bars[1]!.x + bars[1]!.width)
    expect(labels[1]!.getAttribute('fill')).toBe('#233F35')
    expect(labels[4]!.getAttribute('text-anchor')).toBe('end')
    expect(Number(labels[4]!.getAttribute('x'))).toBeLessThan(bars[4]!.x + bars[4]!.width)
    expect(labels[4]!.getAttribute('fill')).toBe('#ffffff')
    // At the real object's 0.8727 scale, body text is about 13px instead of the previous hard-coded 10.47px.
    expect(Number(labels[0]!.getAttribute('font-size')) * 0.8727272727272727).toBeGreaterThan(13)
    chart.style.fontSize = 24
    const larger = new DOMParser().parseFromString(buildNativeChartSvg(chart, 640, 268), 'image/svg+xml')
    expect(larger.querySelector('[data-chart-data-label]')?.getAttribute('font-size')).toBe('18')
  })

  it.each(['horizontal', 'vertical'] as const)('keeps zero and signed %s bar labels readable at range edges', direction => {
    const chart = createChartNode({ chartType: 'bar', style: { barDirection: direction,
      valueMin: -1000, valueMax: 1000, fontSize: 20, textColor: '#233F35', showDataLabels: true } })
    chart.series[0]!.color = '#356C59'
    chart.series[0]!.points.forEach((point, index) => { point.value = [-1000, 0, 1000][index]! })
    const view = buildNativeChartView(chart, { width: 640, height: 268 })
    const dom = new DOMParser().parseFromString(buildNativeChartSvg(chart, 640, 268), 'image/svg+xml')
    const labels = [...dom.querySelectorAll('[data-chart-data-label]')], bars = view.cartesianSeries![0]!.bars!
    expect(labels).toHaveLength(3)
    expect(labels[0]!.getAttribute('fill')).toBe('#ffffff')
    expect(labels[1]!.getAttribute('fill')).toBe('#233F35')
    expect(labels[2]!.getAttribute('fill')).toBe('#ffffff')
    if (direction === 'horizontal') {
      expect(Number(labels[0]!.getAttribute('x'))).toBeGreaterThan(bars[0]!.x)
      expect(Number(labels[2]!.getAttribute('x'))).toBeLessThan(bars[2]!.x + bars[2]!.width)
    } else {
      expect(Number(labels[0]!.getAttribute('y'))).toBeLessThan(bars[0]!.y + bars[0]!.height)
      expect(Number(labels[2]!.getAttribute('y'))).toBeGreaterThan(bars[2]!.y)
    }
  })

})
