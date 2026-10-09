import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createChartNode, createChartLayerItem } from '@/core/tools/nativeNodeFactories'
import { SlideNativeTypeFields } from '@/renderer/ui/properties/SlideNativePropertiesPanel'
import { createChartPropertiesCommands } from '@/renderer/ui/properties/chartPropertiesCommands'
import { EditableChartView } from '@/renderer/ui/EditableChartView'
import type { NativeChartContent } from '@/shared/contracts/native-v1'

const chartContent = (chartType: NativeChartContent['chartType']) => createChartLayerItem(createChartNode({ chartType })).content.data as NativeChartContent

afterEach(cleanup)

describe('chart canvas and property editing', () => {
  it('edits a canvas category in one commit and cancels without writing', () => {
    const chart = chartContent('bar')
    const commit = vi.fn((_chart: NativeChartContent) => null)
    const { container } = render(<EditableChartView id="direct-chart" chart={chart} width={656} height={360} onCommit={commit} />)
    fireEvent.doubleClick(container.querySelector('[data-chart-category-id]')!)
    fireEvent.change(screen.getByLabelText('图表文字'), { target: { value: '画布分类' } })
    fireEvent.keyDown(screen.getByLabelText('图表文字'), { key: 'Enter' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0]).toMatchObject({ categories: [expect.objectContaining({ label: '画布分类' }), ...chart.categories.slice(1)] })
    fireEvent.doubleClick(container.querySelector('[data-chart-category-id]')!)
    fireEvent.change(screen.getByLabelText('图表文字'), { target: { value: '取消内容' } })
    fireEvent.keyDown(screen.getByLabelText('图表文字'), { key: 'Escape' })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('retains the SVG label across selection rerenders so a second click can edit it', () => {
    const chart = chartContent('bar')
    const { container, rerender } = render(<EditableChartView id="stable-chart" chart={chart} width={656} height={360} onCommit={vi.fn()} />)
    const label = container.querySelector('[data-chart-category-id]')!
    fireEvent.click(label)
    rerender(<EditableChartView id="stable-chart" chart={structuredClone(chart)} width={656} height={360} onCommit={vi.fn()} />)
    expect(container.querySelector('[data-chart-category-id]')).toBe(label)
    fireEvent.doubleClick(label)
    expect(screen.getByLabelText('图表文字')).toHaveValue(chart.categories[0]!.label)
  })
  it('shows Spatial chart properties and commits clean chart values', () => {
    const node = createChartNode({ chartType: 'bar' })
    const chart = createChartLayerItem(node).content.data as NativeChartContent
    const commit = vi.fn((_chart: NativeChartContent) => null)
    render(<SlideNativeTypeFields node={node} update={vi.fn()} contentEditingEnabled spatialMode videoDiagnostics={[]} onReplaceImage={vi.fn()}
      textCommands={{ beginEdit: vi.fn(), commitEdit: vi.fn(), cancelEdit: vi.fn(), updateDraft: vi.fn(), toggleStyle: vi.fn() }} draftBindingKey="world-chart-properties" tableCommands={null}
      chartCommands={createChartPropertiesCommands(chart, commit, vi.fn())} />)
    expect(screen.getByTestId('chart-properties')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('图表标题'), { target: { value: '空间图表' } })
    fireEvent.blur(screen.getByLabelText('图表标题'))
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0]).toMatchObject({ title: '空间图表' })
    expect(commit.mock.calls[0]![0]).not.toHaveProperty('id')
  })

  it('uses SVG local coordinates under zoom and defers IME blur until composition ends', () => {
    const chart = chartContent('bar')
    const commit = vi.fn((_chart: NativeChartContent) => null)
    const { container } = render(<EditableChartView id="ime-chart" chart={chart} width={656} height={360} onCommit={commit} />)
    const label = container.querySelector('[data-chart-category-id]')!
    Object.defineProperty(label, 'getBBox', { value: () => ({ x: 120, y: 250, width: 40, height: 16 }) })
    Object.defineProperty(screen.getByTestId('editable-chart-view'), 'clientWidth', { value: 656 })
    fireEvent.doubleClick(label)
    const input = screen.getByLabelText('图表文字')
    expect(input.style.left).toBe('120px')
    expect(input.style.top).toBe('250px')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'pin' } })
    fireEvent.blur(input)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '拼音' } })
    fireEvent.compositionEnd(input)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]![0].categories[0]!.label).toBe('拼音')
  })

})
