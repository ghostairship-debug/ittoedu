import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowInsertMenu } from '@/renderer/ui/flow/FlowInsertMenu'
import { flowInsertCommand } from '@/renderer/ui/flow/flowInsertCommands'

describe('Flow insertion destinations', () => {
  afterEach(cleanup)

  it('offers the exact document and paper carriers and dispatches their destination', () => {
    const onInsert = vi.fn()
    render(<FlowInsertMenu onInsert={onInsert} />)
    const body = screen.getByRole('region', { name: '插入到正文' })
    const paper = screen.getByRole('region', { name: '放到纸面上' })
    expect(within(body).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '标题', '列表', '表格', '公式', '分隔线', '提示框', '折叠节', '图片', '视频', '音频', '组件',
    ])
    expect(within(paper).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['文本框', '图片', '形状', '组件'])
    fireEvent.click(within(paper).getByRole('menuitem', { name: '文本框' }))
    fireEvent.click(within(body).getByRole('menuitem', { name: '图片' }))
    expect(onInsert.mock.calls.map(([command]) => [command.destination, command.kind])).toEqual([
      ['paper', 'text-box'], ['document', 'image'],
    ])
    expect(flowInsertCommand('paper', 'video')).toBeNull()
    expect(flowInsertCommand('paper', 'image')?.destination).toBe('paper')
    expect(screen.queryByText('Runtime')).toBeNull()
  })

  it('does not dispatch when disabled', () => {
    const onInsert = vi.fn()
    render(<FlowInsertMenu onInsert={onInsert} disabled />)
    fireEvent.click(screen.getByRole('menuitem', { name: '文本框' }))
    expect(onInsert).not.toHaveBeenCalled()
  })
})
