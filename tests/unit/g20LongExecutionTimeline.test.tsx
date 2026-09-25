import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionProjection } from '../../src/shared/workbench/executionEvents'
afterEach(cleanup)
it('bounds 10000-item DOM, remembers reading/expansion across conversation switches, and retrieves historical search results', async () => {
  const projection: ExecutionProjection = { conversationId: 'a', cursor: 10000, items: Array.from({ length: 10000 }, (_, i) => ({ taskId: 't', runId: 'r', itemId: `i${i}`, source: 'builtin', type: 'tool', time: i, sequence: i + 1, data: { label: `工具${i}`, status: 'completed' }, content: [{ kind: 'text', text: `中文内容${i}` }] })) }
  const search = vi.fn(async () => ({ hits: [{ event: { eventId: 'historical', conversationId: 'a', taskId: 't', runId: 'r', itemId: 'i2', source: 'builtin' as const, type: 'text' as const, time: 1, sequence: 3, update: 'snapshot' as const, data: { text: '曾经的原始正文' } }, excerpt: '曾经的原始正文' }], cursor: 2000, hasMore: true }))
  const { container, rerender } = render(<ExecutionTimeline projection={projection} searchEvents={search} />)
  for (let i = 0; i < 4; i++) { fireEvent.click(screen.getByRole('button', { name: /读取更早记录/ })); expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(100) }
  const details = screen.getByText('工具9500').closest('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  rerender(<ExecutionTimeline projection={{ conversationId: 'b', cursor: 0, items: [] }} searchEvents={search} />)
  rerender(<ExecutionTimeline projection={projection} searchEvents={search} />)
  expect(screen.getByText('工具9500').closest('details')!.open).toBe(true)
  expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
  fireEvent.change(screen.getByLabelText('历史关键词'), { target: { value: '原始' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索全部历史' }))
  expect(await screen.findByText(/历史事件 3/)).toHaveTextContent('曾经的原始正文')
  fireEvent.click(screen.getByRole('button', { name: '继续搜索更后记录' }))
  await act(async () => {})
  expect(search).toHaveBeenLastCalledWith({ query: '原始', after: 2000, limit: 20 })
})
