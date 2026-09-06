import { describe, expect, it } from 'vitest'
import { chartNativeContentObjectSchema } from '../../src/shared/contracts/native-v1/schema'
import { layerItemSchema } from '../../src/shared/contracts/course-project-v9/schema'
import { publishedLayerItemSchema } from '../../src/shared/contracts/published-course-v2/schema'

const chart = { chartType: 'bar', title: '人数', categories: [{ id: 'cat', label: '甲班' }],
  series: [{ id: 'series', name: '人数', color: '#2563eb', points: [{ id: 'point', categoryId: 'cat', value: -12 }] }],
  style: { backgroundColor: '#ffffff', backgroundOpacity: 1, fontFamily: 'Arial', fontSize: 16,
    textColor: '#000000', showLegend: true, legendPosition: 'bottom', showDataLabels: true,
    showCategoryAxis: true, showValueAxis: true, showGridLines: true } }

describe('Native Chart direction contract', () => {
  it('preserves old charts and the same optional direction in V9 and Published V2', () => {
    expect(chartNativeContentObjectSchema.parse(chart)).toEqual(chart)
    for (const barDirection of ['vertical', 'horizontal']) {
      const data = { ...chart, style: { ...chart.style, barDirection } }
      const published = { layerItemId: 'chart', frame: { mode: 'absolute', x: 0, y: 0, width: 400, height: 300 },
        order: 0, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
        kind: 'native', content: { nativeType: 'chart', data } }
      expect(publishedLayerItemSchema.parse(published)).toEqual(published)
      const author = { ...published, label: 'Chart', locked: false }
      expect(layerItemSchema.parse(author)).toEqual(author)
    }
  })
  it('rejects unknown directions and directions on other chart types', () => {
    for (const chartType of ['line', 'area', 'pie', 'donut']) {
      expect(chartNativeContentObjectSchema.safeParse({ ...chart, chartType,
        style: { ...chart.style, barDirection: 'horizontal' } }).success).toBe(false)
    }
    expect(chartNativeContentObjectSchema.safeParse({ ...chart,
      style: { ...chart.style, barDirection: 'diagonal' } }).success).toBe(false)
    expect(chartNativeContentObjectSchema.safeParse({ ...chart,
      style: { ...chart.style, sourceXml: '<barDir/>' } }).success).toBe(false)
  })
})
