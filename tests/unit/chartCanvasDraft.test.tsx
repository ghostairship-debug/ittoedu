import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createChartNode } from '@/renderer/project/nativeNodeFactories'
import { SlideChartProperties } from '@/renderer/ui/properties/SlideChartProperties'
import type { ChartCanvasTextPort } from '@/renderer/authoring/chartCanvasTextBridge'
import type { SlideChartCandidateData } from '@/renderer/course/v9ChartCommands'

afterEach(cleanup)

it('applies canvas labels and pending inspector values through one draft commit', () => {
  const node = createChartNode({ chartType: 'bar' })
  const commitTableData = vi.fn((_candidate: SlideChartCandidateData) => null)
  let port: ChartCanvasTextPort | undefined
  render(<SlideChartProperties node={node} bindingKey="chart-draft" commands={{
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
  render(<SlideChartProperties node={node} bindingKey="invalid-draft" commands={{
    patchTitle: vi.fn(), patchType: vi.fn(), patchStyle: vi.fn(), commitTableData,
    connectCanvasText: value => { port = value; return () => { port = undefined } },
  }} />)
  fireEvent.change(screen.getByLabelText('系列 1 在 类别 1 的值'), { target: { value: 'invalid' } })
  act(() => { expect(port!.commit('category', node.categories[0]!.id, '保留待修正')).toContain('草稿') })
  expect(commitTableData).not.toHaveBeenCalled()
  expect(screen.getByLabelText('分类 1 标签')).toHaveValue('保留待修正')
  expect(screen.getByLabelText('系列 1 在 保留待修正 的值')).toHaveValue('invalid')
})
