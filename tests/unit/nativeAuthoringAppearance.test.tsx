import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ColorInput } from '@/renderer/ui/ColorInput'
import { createChartNode, createTableNode } from '@/renderer/project/nativeNodeFactories'
import { paintPublishedNativeChart, paintPublishedNativeTable } from '@/player/surfaces/slide/publishedNativeRendering'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { paintPublishedNativeText } from '@/player/surfaces/publishedNativeText'
import { buildNativeChartView } from '@/shared/nativeChartView'

afterEach(cleanup)
it('does not paint zero-value sectors across a full circle', () => {
  const chart = createChartNode({ chartType: 'pie' })
  chart.series[0]!.points.forEach((point, index) => { point.value = index === 0 ? 100 : 0 })
  const wrap = document.createElement('div')
  paintPublishedNativeChart(wrap, chart)
  expect(wrap.querySelectorAll('path')).toHaveLength(1)
})
describe('Native authoring appearance', () => {
  it('Escape cancels a focused valid HEX draft without committing', () => {
    const commit = vi.fn()
    render(<ColorInput id="probe" label="probe" value="#ffffff" onChange={commit} />)
    const field = screen.getByLabelText('probe')
    field.focus()
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(commit.mock.calls).toEqual([])
  })
  it('table renders 50% fill opacity', () => {
    const table = createTableNode({ style: { fillColor: '#ff0000', fillOpacity: 0.5 } })
    const wrap = document.createElement('div')
    paintPublishedNativeTable(wrap, table)
    const cell = wrap.querySelector('td')!
    expect(cell.style.backgroundColor).toBe('rgba(255, 0, 0, 0.5)')
  })
  it('table renders transparent borders', () => {
    const table = createTableNode({ style: { borderColor: '#ff0000', borderOpacity: 0 } })
    const wrap = document.createElement('div')
    paintPublishedNativeTable(wrap, table)
    expect(wrap.querySelector('td')!.style.borderColor).toMatch(/rgba\(255, 0, 0, 0\)|transparent/)
  })
  it('chart can hide grid and category labels', () => {
    const chart = createChartNode({ chartType: 'bar', style: { showGridLines: false, showCategoryAxis: false } })
    const wrap = document.createElement('div')
    paintPublishedNativeChart(wrap, chart)
    expect(wrap.querySelectorAll('line').length).toBe(0)
    expect([...wrap.querySelectorAll('text')].filter(t => chart.categories.some(c => c.label === t.textContent))).toHaveLength(0)
  })
  it('chart displays its value axis when enabled', () => {
    const chart = createChartNode({ chartType: 'bar', style: { showValueAxis: true } })
    const view = buildNativeChartView(chart)
    const wrap = document.createElement('div')
    paintPublishedNativeChart(wrap, chart)
    const text = [...wrap.querySelectorAll('text')].map(el => el.textContent)
    expect(text).toContain(String(view.gridLines![0]!.value))
  })
  it('bar chart has no undeclared line overlay', () => {
    const chart = createChartNode({ chartType: 'bar' })
    const wrap = document.createElement('div')
    paintPublishedNativeChart(wrap, chart)
    expect(wrap.querySelectorAll('path[fill="none"]').length).toBe(0)
  })
  it('bar geometry remains inside positive plot limits', () => {
    const chart = createChartNode({ chartType: 'bar', style: { valueMin: 10, valueMax: 20 } })
    chart.series[0]!.points.forEach((p, index) => { p.value = [12, 15, 18][index]! })
    const view = buildNativeChartView(chart)
    const bottom = view.plotArea.y + view.plotArea.height
    expect(view.cartesianSeries![0]!.bars!.every(bar => bar.y + bar.height <= bottom)).toBe(true)
  })
})

it('paints a text background and rounded corners without fading its content', () => {
  const node = createTextNode({ style: { backgroundColor: '#ff0000', backgroundOpacity: 0.5, cornerRadius: 12 } })
  const wrap = document.createElement('div')
  paintPublishedNativeText(wrap, node)
  expect(wrap.style.backgroundColor).toBe('rgba(255, 0, 0, 0.5)')
  expect(wrap.style.borderRadius).toBe('12px')
  expect(wrap.style.opacity).toBe('')
})
