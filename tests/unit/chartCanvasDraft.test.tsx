import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createChartNode, createChartLayerItem } from '@/core/tools/nativeNodeFactories'
import { ChartProperties } from '@/renderer/ui/properties/ChartProperties'
import type { ChartCanvasTextPort } from '@/renderer/authoring/chartCanvasTextBridge'
import type { SlideChartCandidateData } from '@/renderer/course/v9ChartCommands'
import { replaceChartTableData } from '@/renderer/course/chartContentOperations'

afterEach(cleanup)

it('captures inspector numbers without writing and rebases after a Surface-owned save', () => {
  const node = createChartNode({ chartType: 'bar' })
  const commitTableData = vi.fn(() => null)
  let port: ChartCanvasTextPort | undefined
  const commands = { patchTitle: vi.fn(), patchType: vi.fn(), patchStyle: vi.fn(), commitTableData,
    connectCanvasText: (value: ChartCanvasTextPort) => { port = value; return () => { port = undefined } },
  }
  const view = render(<ChartProperties node={node} bindingKey="saved-canvas" commands={commands} />)
  fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: '42' } })
  const prepared = port!.prepare!('category', node.categories[0]!.id, '新分类')
  expect(prepared.error).toBeNull()
  expect(prepared.candidate?.series[0]!.values[0]).toBe(42)
  expect(commitTableData).not.toHaveBeenCalled()
  const content = createChartLayerItem(node).content.data as import('@/shared/contracts/native-v1').NativeChartContent
  view.rerender(<ChartProperties node={{ ...node, ...replaceChartTableData(content, prepared.candidate!) }} bindingKey="saved-canvas" commands={commands} />)
  expect(screen.getByLabelText('分类 1 标签')).toHaveValue('新分类')
  expect(screen.getByLabelText('系列 1 在 新分类 的值')).toHaveValue('42')
  expect(screen.getByRole('button', { name: '应用数据' })).toBeDisabled()
})

it('applies canvas labels and pending inspector values through one draft commit', () => {
  const node = createChartNode({ chartType: 'bar' })
  const commitTableData = vi.fn((_candidate: SlideChartCandidateData) => null)
  let port: ChartCanvasTextPort | undefined
  render(<ChartProperties node={node} bindingKey="chart-draft" commands={{
    patchTitle: vi.fn(), patchType: vi.fn(), patchStyle: vi.fn(), commitTableData,
    connectCanvasText: value => { port = value; return () => { port = undefined } },
  }} />)
  fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: '42' } })
  act(() => { expect(port!.commit('category', node.categories[0]!.id, '画布分类')).toBeNull() })
  expect(commitTableData).toHaveBeenCalledTimes(1)
  expect(commitTableData.mock.calls[0]![0]).toMatchObject({
    categories: [{ id: node.categories[0]!.id, label: '画布分类' }, ...node.categories.slice(1)],
    series: [{ id: node.series[0]!.id, values: [42, 25, 15] }],
  })
  expect(screen.getByRole('button', { name: '应用数据' })).toBeDisabled()
})

it('keeps an invalid draft available for correction without writing partial canvas edits', () => {
  const node = createChartNode({ chartType: 'bar' })
  const commitTableData = vi.fn((_candidate: SlideChartCandidateData) => null)
  let port: ChartCanvasTextPort | undefined
  render(<ChartProperties node={node} bindingKey="invalid-draft" commands={{
    patchTitle: vi.fn(), patchType: vi.fn(), patchStyle: vi.fn(), commitTableData,
    connectCanvasText: value => { port = value; return () => { port = undefined } },
  }} />)
  fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: 'invalid' } })
  act(() => { expect(port!.commit('category', node.categories[0]!.id, '保留待修正')).toContain('草稿') })
  expect(commitTableData).not.toHaveBeenCalled()
  expect(screen.getByLabelText('分类 1 标签')).toHaveValue('保留待修正')
  expect(screen.getByLabelText('系列 1 在 保留待修正 的值')).toHaveValue('invalid')
})

it('retains later inspector input and dirty drafts from another owner instead of treating matching data as a save ACK', () => {
  for (const change of ['input', 'binding', 'node'] as const) {
    const node = createChartNode({ chartType: 'bar' })
    const commitTableData = vi.fn(() => null)
    let port: ChartCanvasTextPort | undefined
    const commands = { patchTitle: vi.fn(), patchType: vi.fn(), patchStyle: vi.fn(), commitTableData,
      connectCanvasText: (value: ChartCanvasTextPort) => { port = value; return () => { port = undefined } },
    }
    const view = render(<ChartProperties node={node} bindingKey="captured-owner" commands={commands} />)
    fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: '42' } })
    const prepared = port!.prepare!('category', node.categories[0]!.id, '已保存分类')
    expect(prepared.error).toBeNull()
    if (change === 'input') fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: '43' } })
    const content = createChartLayerItem(node).content.data as import('@/shared/contracts/native-v1').NativeChartContent
    view.rerender(<ChartProperties node={{ ...node, ...replaceChartTableData(content, prepared.candidate!), ...(change === 'node' ? { id: 'another-chart' } : {}) }}
      bindingKey={change === 'binding' ? 'another-owner' : 'captured-owner'} commands={commands} />)
    expect(screen.getByLabelText('分类 1 标签')).toHaveValue('类别 1')
    expect(screen.getByLabelText('系列 1 在 类别 1 的值')).toHaveValue(change === 'input' ? '43' : '42')
    expect(screen.getByRole('button', { name: '应用数据' })).toBeEnabled()
    expect(commitTableData).not.toHaveBeenCalled()
    view.unmount()
  }
})
