import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent, type ExecutionItem, type ExecutionProjection } from '../../src/shared/workbench/executionEvents'
import type { ImageResultsDesktopAPI } from '../../src/shared/workbench/imageResultsDesktop'

afterEach(cleanup)
const item = (index: number, type: ExecutionItem['type'] = 'text', data: ExecutionItem['data'] = {}): ExecutionItem => ({ taskId: 'task', runId: 'run', itemId: `item-${index}`, source: 'builtin', type, time: index, sequence: index + 1, data, content: [] })
function expand(card: HTMLElement) { const details = card.querySelector('details')!; act(() => { details.open = true; fireEvent(details, new Event('toggle')) }); return details }

it('does not query image results until the new conversation has a valid identity', () => {
  const list = vi.fn().mockResolvedValue([])
  const imageResults = { list } as unknown as ImageResultsDesktopAPI
  const { rerender } = render(<ExecutionTimeline projection={emptyExecutionProjection('')} imageResults={imageResults} workspaceId="workspace" />)
  expect(list).not.toHaveBeenCalled()
  rerender(<ExecutionTimeline projection={emptyExecutionProjection('conversation')} imageResults={imageResults} workspaceId="workspace" />)
  expect(list).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace', conversationId: 'conversation' })
})

it('reads user turns and execution output in time order without duplicating the user history heading', () => {
  const projection: ExecutionProjection = { conversationId: 'conversation', cursor: 2, items: [
    { ...item(0, 'text', { label: '第一条回复' }), time: 15 },
    { ...item(1, 'text', { label: '第二条回复' }), time: 35 },
  ] }
  const messages = [
    { messageId: 'one', role: 'user' as const, text: '第一条提问', createdAt: 10, attachmentIds: [] },
    { messageId: 'two', role: 'user' as const, text: '第二条提问', createdAt: 30, attachmentIds: [] },
  ]
  render(<ExecutionTimeline projection={projection} userMessages={messages} />)
  const cards = [...screen.getByRole('region', { name: '任务过程' }).querySelectorAll(':scope > article')]
  expect(cards.map(card => card.textContent)).toEqual([
    expect.stringContaining('第一条提问'), expect.stringContaining('第一条回复'),
    expect.stringContaining('第二条提问'), expect.stringContaining('第二条回复'),
  ])
  expect(screen.queryByText('当前没有正在运行的任务')).toBeNull()
})

it('pages 5000 records and preserves scrolled position, focused input, and expanded cards through interleaved run events', () => {
  const items = Array.from({ length: 5000 }, (_, index) => item(index))
  items[0] = item(0, 'run.state', { status: 'running' })
  items[4999] = item(4999, 'tool', { toolName: 'inspect', input: '{"target":"object"}', status: 'running' })
  let projection: ExecutionProjection = { conversationId: 'conversation', cursor: 5000, items }
  const view = (value: ExecutionProjection) => <><input aria-label="输入要求" /><div className="execution-assistant__history" data-testid="scroll"><ExecutionTimeline projection={value} /></div></>
  const { container, rerender } = render(view(projection))
  expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(100)
  const region = screen.getByRole('region', { name: '任务过程' })
  expect(region).toHaveAttribute('aria-busy', 'true')
  const tool = screen.getByRole('article', { name: '工具执行' }), details = expand(tool)
  const host = screen.getByTestId('scroll')
  Object.defineProperties(host, { scrollHeight: { configurable: true, value: 10000 }, clientHeight: { configurable: true, value: 300 } })
  host.scrollTop = 1200; fireEvent.scroll(host)
  const input = screen.getByLabelText('输入要求'); input.focus()
  projection = { ...projection, cursor: 5002, items: [...items.slice(0, -1), { ...items[4999], data: { ...items[4999].data, status: 'completed', output: '{"result":"tool-finished"}' } }, item(5000, 'usage', { usage: { outputTokens: 10 } }), item(5001, 'text', { status: 'completed' })] }
  rerender(view(projection))
  expect(host.scrollTop).toBe(1200)
  expect(document.activeElement).toBe(input)
  expect(screen.getByRole('article', { name: '工具执行' })).toBe(tool)
  expect(details.open).toBe(true)
  expect(within(tool).getByText(/tool-finished/)).toBeInTheDocument()
  expect(region).toHaveAttribute('aria-busy', 'true')
  expect(region).not.toHaveAttribute('aria-live')
  projection = { ...projection, cursor: 5003, items: [...projection.items, item(5002, 'run.end', { status: 'completed' })] }
  rerender(view(projection))
  expect(region).toHaveAttribute('aria-busy', 'false')
  expect(document.activeElement).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: /读取更早记录/ }))
  expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: /回到最新/ }))
  expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(100)
  expect(host.scrollTop).toBe(10000)
})

it('keeps actual tool arguments, output, differences and errors safe while distinguishing application from saving', () => {
  const events: ExecutionEvent[] = [
    { eventId: 'start', conversationId: 'c', taskId: 'task', runId: 'run', itemId: 'tool', time: 1, sequence: 1, source: 'builtin', type: 'tool', update: 'snapshot', data: { toolName: 'text.replace', status: 'running', input: JSON.stringify({ apiKey: 'private-key', path: 'C:/Users/person/private.md', content: '<script>window.hacked=true</script>' }) } },
    { eventId: 'finish', conversationId: 'c', taskId: 'task', runId: 'run', itemId: 'tool', time: 2, sequence: 2, source: 'builtin', type: 'tool', update: 'snapshot', data: { status: 'completed', output: '{"receipt":"returned"}', applicationStatus: 'failed', error: 'cannot apply', diff: '- before\n+ requested', documentId: 'document', revision: 3 } },
  ]
  let projection = foldExecutionEvents(emptyExecutionProjection('c'), events)
  const locate = vi.fn()
  const { container, rerender } = render(<ExecutionTimeline projection={projection} onLocateDocument={locate} />)
  const card = screen.getByRole('article', { name: '工具执行' }); expand(card)
  expect(within(card).getByText('已运行')).toBeInTheDocument()
  expect(within(card).getByText('应用失败')).toBeInTheDocument()
  expect(within(card).getByText('保存未确认')).toBeInTheDocument()
  expect(within(card).getByRole('region', { name: '参数' })).toHaveTextContent('[已隐藏]')
  expect(within(card).getByRole('region', { name: '参数' })).not.toHaveTextContent('private-key')
  expect(within(card).getByRole('region', { name: '参数' })).not.toHaveTextContent('C:/Users/person')
  expect(container.querySelector('script')).toBeNull()
  expect(within(card).getByRole('region', { name: '实际差异' })).toHaveTextContent('+ requested')
  expect(within(card).getByRole('region', { name: '错误详情' })).toHaveTextContent('cannot apply')
  fireEvent.click(within(card).getByRole('button', { name: '定位文档' })); expect(locate).toHaveBeenCalledWith('document')
  projection = foldExecutionEvents(projection, [{ ...events[1], eventId: 'applied', sequence: 3, data: { applicationStatus: 'applied', documentId: 'document', revision: 4 } },
    { ...events[1], eventId: 'save-failed', sequence: 4, itemId: 'save', type: 'document.save', data: { documentId: 'document', revision: 4, saveStatus: 'failed' } }])
  rerender(<ExecutionTimeline projection={projection} onLocateDocument={locate} />)
  expect(within(card).getByText('已应用')).toBeInTheDocument()
  expect(within(card).getByText('保存失败')).toBeInTheDocument()
  expect(within(card).getByRole('region', { name: '参数' })).toHaveTextContent('private.md')
})

it('loads large outputs on demand in readable pages and treats external tool completion independently', async () => {
  const ref = { id: 'a'.repeat(64), bytes: 25000, mime: 'text/plain;charset=utf-8' as const }
  const external = { ...item(0, 'tool', { status: 'running', outputRef: ref }), source: 'external-mcp' as const }
  const projection: ExecutionProjection = { conversationId: 'external', cursor: 1, items: [external] }
  const readBlob = vi.fn(async () => 'x'.repeat(25000))
  const { rerender } = render(<ExecutionTimeline projection={projection} readBlob={readBlob} />)
  const card = screen.getByRole('article', { name: '工具执行' }); expand(card)
  expect(readBlob).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /读取完整内容/ }))
  await screen.findByRole('button', { name: /继续读取内容/ })
  expect(within(card).getByRole('region', { name: '工具输出' }).querySelector('pre')?.textContent).toHaveLength(12000)
  fireEvent.click(screen.getByRole('button', { name: /继续读取内容/ }))
  expect(within(card).getByRole('region', { name: '工具输出' }).querySelector('pre')?.textContent).toHaveLength(24000)
  rerender(<ExecutionTimeline projection={{ ...projection, cursor: 2, items: [{ ...external, data: { ...external.data, status: 'completed' } }, { ...item(1, 'document.save', { saveStatus: 'saved' }), runId: 'manual-save' }] }} readBlob={readBlob} />)
  expect(screen.getByRole('region', { name: '任务过程' })).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByText(/仅显示实际工具事实/)).toBeInTheDocument()
  expect(readBlob).toHaveBeenCalledTimes(1)
})
