import { describe, expect, it } from 'vitest'
import { createChartNode } from '@/renderer/project/nativeNodeFactories'
import {
  buildNativeChartView,
  describeNativeChart,
} from '@/shared/nativeChartView'

describe('nativeChartView buildNativeChartView & describeNativeChart', () => {
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
})
