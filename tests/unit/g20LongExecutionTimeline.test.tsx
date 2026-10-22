import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionProjection } from '../../src/shared/workbench/executionEvents'
afterEach(cleanup)
it('pages saved-file actions outside collapsed group details without hiding later files', () => {
  const projection: ExecutionProjection = { conversationId: 'saved', cursor: 250, items: Array.from({ length: 250 }, (_, i) => ({
    taskId: 'task', runId: 'run', itemId: `saved-${i}`, source: 'builtin', type: 'tool', time: i, sequence: i + 1,
    data: { toolName: 'file.save', saveStatus: 'saved', status: 'completed', documentName: `result-${i}.txt` }, content: [],
  })) }
  const open = vi.fn()
  render(<ExecutionTimeline projection={projection} onOpenSavedFile={open} />)
  expect(screen.getAllByRole('button', { name: /^打开文件：/ })).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: /读取后续已保存文件/ }))
  expect(screen.getAllByRole('button', { name: /^打开文件：/ })).toHaveLength(200)
  fireEvent.click(screen.getByRole('button', { name: /读取后续已保存文件/ }))
  expect(screen.getAllByRole('button', { name: /^打开文件：/ })).toHaveLength(250)
  fireEvent.click(screen.getByRole('button', { name: '打开文件：result-249.txt' }))
  expect(open).toHaveBeenCalledWith('run', 'saved-249')
})

it('bounds 10000-item DOM, remembers reading/expansion across conversation switches, and retrieves historical search results', async () => {
  const projection: ExecutionProjection = { conversationId: 'a', cursor: 10000, items: Array.from({ length: 10000 }, (_, i) => ({ taskId: 't', runId: 'r', itemId: `i${i}`, source: 'builtin', type: 'tool', time: i, sequence: i + 1, data: { label: `工具${i}`, status: 'completed' }, content: [{ kind: 'text', text: `中文内容${i}` }] })) }
  const search = vi.fn(async () => ({ hits: [{ event: { eventId: 'historical', conversationId: 'a', taskId: 't', runId: 'r', itemId: 'i2', source: 'builtin' as const, type: 'text' as const, time: 1, sequence: 3, update: 'snapshot' as const, data: { text: '曾经的原始正文' } }, excerpt: '曾经的原始正文' }], cursor: 2000, hasMore: true }))
  const { container, rerender } = render(<ExecutionTimeline projection={projection} searchEvents={search} />)
  expect(screen.getAllByRole('article', { name: '工具组' })).toHaveLength(1)
  expect(container.querySelectorAll('.execution-timeline__card--tool')).toHaveLength(0)
  const group = screen.getByText('10000 次工具调用').closest('details')!
  act(() => { group.open = true; fireEvent(group, new Event('toggle')) })
  expect(container.querySelectorAll('.execution-timeline__card--tool')).toHaveLength(100)
  const details = screen.getByText('工具0').closest('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  rerender(<ExecutionTimeline projection={{ conversationId: 'b', cursor: 0, items: [] }} searchEvents={search} />)
  rerender(<ExecutionTimeline projection={projection} searchEvents={search} />)
  expect(screen.getByText('工具0').closest('details')!.open).toBe(true)
  expect(container.querySelectorAll('.execution-timeline__card--tool')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
  fireEvent.change(screen.getByLabelText('历史关键词'), { target: { value: '原始' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索全部历史' }))
  expect(await screen.findByText(/历史事件 3/)).toHaveTextContent('曾经的原始正文')
  fireEvent.click(screen.getByRole('button', { name: '继续搜索更后记录' }))
  await act(async () => {})
  expect(search).toHaveBeenLastCalledWith({ query: '原始', after: 2000, limit: 20 })
})
