import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTableData, type TableData } from '../../src/components/table/data'
import { TableComponentEditor } from '../../src/components/table/editor'
import type { TextComponentData } from '../../src/components/text/data'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform'
import { ChartEditor } from '../../src/components/chart/editor'
import { createChartData } from '../../src/components/chart/data'

const editor = vi.hoisted(() => ({ onChange: undefined as undefined | ((data: TextComponentData) => unknown) }))
vi.mock('../../src/components/text/editor', () => ({ TextComponentEditor: (props: { onChange(data: TextComponentData): unknown }) => {
  editor.onChange = props.onChange
  return null
} }))

afterEach(cleanup)

describe('D0 professional editor ACK', () => {
  it('returns the formal ACK and forwards rejection so the text owner can retain its draft', async () => {
    const data = createTableData({ rows: 1, columns: 1 })
    const cell = data.rows[0].cells[0]
    data.rows[0].cells[0] = { id: cell.id, columnId: cell.columnId, content: { inlines: [{ type: 'text', text: '原文' }] } }
    const before = structuredClone(data)
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    const onEdit = vi.fn((_edit: ComponentEdit) => pending)
    const view = render(<TableComponentEditor instanceId="table" data={data as TableData} onEdit={onEdit} onUndo={() => {}} onRedo={() => {}} />)
    const ack = editor.onChange!({ content: { inlines: [{ type: 'text', text: '草稿' }] } } as TextComponentData)
    expect(ack).toBeInstanceOf(Promise)
    expect(onEdit.mock.calls[0][0]).toMatchObject({ type: 'data.set', instanceId: 'table' })
    await act(async () => {
      const rejected = expect(ack).rejects.toThrow('正式提交失败')
      reject(new Error('正式提交失败'))
      await rejected
    })
    expect(view.getByRole('alert').textContent).toBe('正式提交失败')
    expect(data).toEqual(before)
  })
  it('reports chart commit rejection without mutating formal chart data', async () => {
    const data = createChartData()
    const before = structuredClone(data)
    const onEdit = vi.fn((_edit: ComponentEdit) => Promise.reject(new Error('图表提交失败')))
    const view = render(<ChartEditor instanceId="chart" data={data} onEdit={onEdit} />)
    await act(async () => { fireEvent.change(view.getByLabelText('标题'), { target: { value: '新题目' } }) })
    expect(view.getByRole('alert').textContent).toBe('图表提交失败')
    expect(onEdit.mock.calls[0][0]).toMatchObject({ type: 'data.set', instanceId: 'chart' })
    expect(data).toEqual(before)
  })
})
