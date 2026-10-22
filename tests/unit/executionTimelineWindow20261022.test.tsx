import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { marked } from 'marked'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { applyExecutionProjectionOwned, prepareExecutionEvents, type ExecutionEvent, type ExecutionItem, type ExecutionProjection } from '../../src/shared/workbench/executionEvents'
import { ExecutionTimelineReadModel } from '../../src/shared/workbench/executionTimelineReadModel'
import type { ExecutionTimelineBodyPage, ExecutionTimelineWindowControl } from '../../src/shared/workbench/executionTimelineWindow'
import { executionDesktopRequestSchema } from '../../src/shared/workbench/executionDesktop'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const item = (index: number, text = `## 正文${index}`): ExecutionItem => ({ taskId: 'task', runId: 'run', itemId: `item-${index}`, source: 'builtin', type: 'text',
  sequence: index + 1, time: index, data: { status: 'completed' }, content: [{ kind: 'text', text }] })
function control(reader: ExecutionTimelineReadModel): ExecutionTimelineWindowControl {
  return { page: structuredClone(reader.entryPage()), readPage: vi.fn(async input => structuredClone(reader.entryPage(input))),
    readGroup: vi.fn(async input => structuredClone(reader.groupPage(input))), readBody: vi.fn(async input => reader.readBody(input)) }
}

it('keeps untouched cards stable after real IPC cloning while the one changed reply updates', () => {
  const projection: ExecutionProjection = { conversationId: 'window', cursor: 100, items: Array.from({ length: 100 }, (_, index) => item(index)) }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader), lexer = vi.spyOn(marked, 'lexer')
  const { container, rerender } = render(<ExecutionTimeline window={window} />)
  const first = container.querySelector('[data-execution-item="run:item-0"]'), calls = lexer.mock.calls.length
  const input: ExecutionEvent = { eventId: 'delta', conversationId: 'window', taskId: 'task', runId: 'run', itemId: 'item-99', source: 'builtin', type: 'text',
    sequence: 101, time: 101, update: 'append', data: { text: '\n\n当前增量' } }
  const plan = prepareExecutionEvents(projection, [input]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage())
  rerender(<ExecutionTimeline window={window} />)
  expect(lexer.mock.calls.length - calls).toBe(1)
  expect(container.querySelector('[data-execution-item="run:item-0"]')).toBe(first)
  expect(screen.getByText('当前增量')).toBeInTheDocument()
})

it('uses the canonical controlled page and exposes earlier history without publishing its own duplicate page', async () => {
  const projection: ExecutionProjection = { conversationId: 'pages', cursor: 500, items: Array.from({ length: 500 }, (_, index) => item(index)) }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader)
  const { rerender } = render(<ExecutionTimeline window={window} />)
  expect(screen.getByRole('heading', { name: '正文499' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /读取更早记录/ }))
  await waitFor(() => expect(window.readPage).toHaveBeenCalledWith({ start: 300, limit: 100 }))
  expect(screen.getByRole('heading', { name: '正文499' })).toBeInTheDocument()
  window.page = structuredClone(reader.entryPage({ start: 300, limit: 100 }))
  rerender(<ExecutionTimeline window={window} />)
  expect(screen.getByRole('heading', { name: '正文399' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '正文499' })).toBeNull()
})

it('reads current body pages and ignores a late old response after a newer snapshot', async () => {
  const projection: ExecutionProjection = { conversationId: 'body', cursor: 1, items: [item(0, '旧内容' + '字'.repeat(24000))] }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader)
  let resolveOld!: (value: ExecutionTimelineBodyPage) => void
  const old = reader.readBody({ runId: 'run', itemId: 'item-0', part: 0, maxChars: 24000 })
  window.readBody = vi.fn().mockImplementationOnce(() => new Promise<ExecutionTimelineBodyPage>(resolve => { resolveOld = resolve }))
    .mockImplementation(async input => reader.readBody(input))
  const { rerender } = render(<ExecutionTimeline window={window} />)
  fireEvent.click(screen.getByRole('button', { name: /继续读取内容/ }))
  await waitFor(() => expect(window.readBody).toHaveBeenCalledTimes(1))
  const input: ExecutionEvent = { eventId: 'final', conversationId: 'body', taskId: 'task', runId: 'run', itemId: 'item-0', source: 'builtin', type: 'text',
    sequence: 2, time: 2, update: 'snapshot', data: { text: '新的最终回复', status: 'completed' } }
  const plan = prepareExecutionEvents(projection, [input]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage()); rerender(<ExecutionTimeline window={window} />)
  await act(async () => resolveOld(old))
  expect(screen.getByText('新的最终回复')).toBeInTheDocument()
  expect(screen.queryByText(/^旧内容/)).toBeNull()
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    fireEvent.click(screen.getByRole('button', { name: '复制内容' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('新的最终回复'))
    expect(window.readBody).toHaveBeenLastCalledWith({ runId: 'run', itemId: 'item-0', part: 0, complete: true })
  } finally { if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard') }
})

it('uses real schema-sized group/file pages and preserves earlier and later access', async () => {
  const items = Array.from({ length: 250 }, (_, index): ExecutionItem => ({ ...item(index), type: 'tool', content: [],
    data: { toolName: 'file.write', saveStatus: 'saved', status: 'completed', documentName: `文件${index}` } }))
  const reader = new ExecutionTimelineReadModel({ conversationId: 'files', cursor: 250, items }), window = control(reader)
  window.readGroup = vi.fn(async input => {
    executionDesktopRequestSchema.parse({ type: 'timeline-group', workspaceId: 'workspace', conversationId: 'files', consumerId: 'view', userHistoryRevision: 1, ...input })
    return structuredClone(reader.groupPage(input))
  })
  render(<ExecutionTimeline window={window} onOpenSavedFile={vi.fn()} />)
  expect(screen.getAllByRole('button', { name: /^打开文件：/ })).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: /读取后续已保存文件/ }))
  await screen.findByRole('button', { name: '打开文件：文件100' })
  expect(screen.queryByRole('button', { name: '打开文件：文件0' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /读取后续已保存文件/ }))
  await screen.findByRole('button', { name: '打开文件：文件249' })
  fireEvent.click(screen.getByRole('button', { name: '读取更早已保存文件' }))
  await screen.findByRole('button', { name: '打开文件：文件100' })
  const group = screen.getByRole('article', { name: '工具组' }), details = group.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  fireEvent.click(within(group).getByRole('button', { name: /读取组内后续记录/ }))
  await waitFor(() => expect(within(group).getByRole('button', { name: '读取组内更早记录' })).toBeInTheDocument())
  fireEvent.click(within(group).getByRole('button', { name: '读取组内更早记录' }))
  await waitFor(() => expect(within(group).queryByRole('button', { name: '读取组内更早记录' })).toBeNull())
  for (const [request] of vi.mocked(window.readGroup).mock.calls) expect(request).toMatchObject({ itemLimit: 100, fileLimit: 100 })
})

it('skips anchor geometry for an off-page body delta but still compensates an actual visible update', () => {
  const projection: ExecutionProjection = { conversationId: 'geometry', cursor: 500, items: Array.from({ length: 500 }, (_, index) => item(index)) }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader)
  window.page = structuredClone(reader.entryPage({ start: 100, limit: 100 }))
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-execution-item') ? 10 : 0
    return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 20, width: 100, height: 20, toJSON() { return {} } }
  })
  const view = (control: ExecutionTimelineWindowControl) => <div className="execution-assistant__history" data-testid="host"><ExecutionTimeline window={control} /></div>
  const { rerender } = render(view(window)), host = screen.getByTestId('host')
  Object.defineProperties(host, { scrollHeight: { configurable: true, value: 10000 }, clientHeight: { configurable: true, value: 300 } })
  host.scrollTop = 100; fireEvent.scroll(host); rect.mockClear()
  const input = (index: number): ExecutionEvent => ({ eventId: `delta-${projection.cursor}`, conversationId: 'geometry', taskId: 'task', runId: 'run', itemId: `item-${index}`,
    type: 'text', source: 'builtin', time: projection.cursor + 1, sequence: projection.cursor + 1, update: 'append', data: { text: '新增' } })
  let plan = prepareExecutionEvents(projection, [input(499)]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage({ start: 100, limit: 100 })); rerender(view(window))
  expect(rect.mock.calls.length).toBe(0)
  plan = prepareExecutionEvents(projection, [input(100)]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage({ start: 100, limit: 100 })); rerender(view(window))
  expect(rect.mock.calls.length).toBeGreaterThan(0)
})


it('keeps public full-snapshot updates visible when their body changes without an event sequence change', async () => {
  const projection: ExecutionProjection = { conversationId: 'public-snapshot', cursor: 1, items: [item(0, '旧快照' + '字'.repeat(24000))] }
  const { rerender } = render(<ExecutionTimeline projection={projection} />)
  fireEvent.click(screen.getByRole('button', { name: /继续读取内容/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /剩余 3/ })).toBeInTheDocument())
  const next: ExecutionProjection = { ...projection, items: [item(0, '相同序号的新正文')] }
  rerender(<ExecutionTimeline projection={next} />)
  expect(await screen.findByText('相同序号的新正文')).toBeInTheDocument()
  expect(screen.queryByText(/^旧快照/)).toBeNull()
})

it('compensates anchor geometry for rendered group summaries, footer text and a changed page', async () => {
  const tools = Array.from({ length: 250 }, (_, index): ExecutionItem => ({ ...item(index), type: 'tool', content: [], data: { toolName: 'inspect', status: 'completed' } }))
  const projection: ExecutionProjection = { conversationId: 'layout-facts', cursor: 251, items: [item(0), ...tools.map((value, index) => ({ ...value, itemId: `tool-${index}`, time: index + 1 }))] }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader)
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-execution-item') ? 10 : 0
    return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 20, width: 100, height: 20, toJSON() { return {} } }
  })
  const view = () => <div className="execution-assistant__history" data-testid="facts-host"><ExecutionTimeline window={window} /></div>
  const { rerender } = render(view()), host = screen.getByTestId('facts-host')
  Object.defineProperties(host, { scrollHeight: { configurable: true, value: 10000 }, clientHeight: { configurable: true, value: 300 } })
  host.scrollTop = 100; fireEvent.scroll(host); rect.mockClear()
  const change: ExecutionEvent = { eventId: 'summary', conversationId: 'layout-facts', taskId: 'task', runId: 'run', itemId: 'tool-249', source: 'builtin', type: 'tool',
    sequence: 252, time: 252, update: 'append', data: { status: 'running', label: '核对当前组' } }
  let plan = prepareExecutionEvents(projection, [change]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage()); rerender(view()); expect(rect.mock.calls.length).toBeGreaterThan(0)
  rect.mockClear()
  plan = prepareExecutionEvents(projection, [{ ...change, eventId: 'phase', itemId: 'run-state', type: 'run.state', sequence: 253, time: 253,
    data: { status: 'running', phase: 'context' } }]); applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage()); rerender(view()); expect(rect.mock.calls.length).toBeGreaterThan(0)
  rect.mockClear()
  window.page = structuredClone(reader.entryPage({ start: 0, limit: 1 })); rerender(view()); expect(rect.mock.calls.length).toBeGreaterThan(0)
})


function groupedProjection(label = '旧'): ExecutionProjection {
  return { conversationId: 'same-cursor-group', cursor: 250, items: Array.from({ length: 250 }, (_, index): ExecutionItem => ({ ...item(index), type: 'tool',
    data: { status: 'completed', toolName: 'inspect' }, content: [{ kind: 'text', text: `${label}正文${index}` }] })) }
}
function expand(details: HTMLDetailsElement) { act(() => { details.open = true; fireEvent(details, new Event('toggle')) }) }
async function showGroupItem100(container: HTMLElement) {
  expand(container.querySelector('.execution-timeline__tool-group > details')!)
  fireEvent.click(screen.getByRole('button', { name: /读取组内后续记录/ }))
  await waitFor(() => expect(container.querySelector('.execution-timeline__card[data-execution-item="run:item-100"]')).not.toBeNull())
  expand(container.querySelector('.execution-timeline__card[data-execution-item="run:item-100"] > details')!)
}

it('preserves the selected group range and expansion when an unknown full snapshot replaces the same cursor', async () => {
  const projection = groupedProjection(), { container, rerender } = render(<ExecutionTimeline projection={projection} />)
  await showGroupItem100(container); expect(screen.getByText('旧正文100')).toBeInTheDocument()
  rerender(<ExecutionTimeline projection={groupedProjection('新')} />)
  expect(await screen.findByText('新正文100')).toBeInTheDocument(); expect(screen.queryByText('旧正文100')).toBeNull()
  expect(container.querySelector('.execution-timeline__card[data-execution-item="run:item-0"]')).toBeNull()
})

it('does not publish a late group response from a prior same-cursor full snapshot', async () => {
  const projection = groupedProjection(), reader = new ExecutionTimelineReadModel(projection)
  const first = reader.entryPage().entries[0]!; if (first.kind !== 'tools') throw new Error('fixture group')
  const old = reader.groupPage({ key: first.key, itemStart: 100, itemLimit: 100 })
  const { container, rerender } = render(<ExecutionTimeline projection={projection} />)
  let resolveOld!: (value: typeof old) => void
  const pending = new Promise<typeof old>(resolve => { resolveOld = resolve })
  vi.spyOn(ExecutionTimelineReadModel.prototype, 'groupPage').mockImplementationOnce(() => pending as unknown as typeof old)
  await showGroupItem100(container)
  rerender(<ExecutionTimeline projection={groupedProjection('当前')} />)
  expect(await screen.findByText('当前正文100')).toBeInTheDocument()
  await act(async () => resolveOld(old))
  expect(screen.getByText('当前正文100')).toBeInTheDocument(); expect(screen.queryByText('旧正文100')).toBeNull()
})

it('invalidates local group pages when authoritative messages regroup an unchanged projection', async () => {
  const projection = groupedProjection(), { container, rerender } = render(<ExecutionTimeline projection={projection} />)
  await showGroupItem100(container)
  const messages = [{ messageId: 'user', role: 'user' as const, text: '中间用户消息', createdAt: 150.5, attachmentIds: [] }]
  rerender(<ExecutionTimeline projection={projection} userMessages={messages} />)
  expect(screen.getByText('151 次工具调用')).toBeInTheDocument()
  expect(screen.queryByText('250 次工具调用')).toBeNull(); expect(screen.getByText('中间用户消息')).toBeInTheDocument()
})

it('binds controlled group pages to both actual message revision and clamped message offset at the same durable cursor', async () => {
  const projection = groupedProjection(), reader = new ExecutionTimelineReadModel(projection), window = control(reader)
  window.page.userHistoryRevision = 10; window.page.userHistoryOffset = 0
  const { container, rerender } = render(<ExecutionTimeline window={window} />)
  await showGroupItem100(container)
  const key = 'run:item-0:group'
  reader.setMessages([{ messageId: 'user-one', role: 'user', text: '用户窗口一', createdAt: 150.5, attachmentIds: [] }])
  window.page = { ...structuredClone(reader.entryPage({ groups: { [key]: { itemStart: 100, itemLimit: 100 } } })), userHistoryRevision: 10, userHistoryOffset: 1 }
  rerender(<ExecutionTimeline window={window} />)
  expect(screen.getByText('151 次工具调用')).toBeInTheDocument(); expect(screen.queryByText('250 次工具调用')).toBeNull()
  fireEvent.click(within(screen.getAllByRole('article', { name: '工具组' })[0]!).getByRole('button', { name: '读取组内更早记录' }))
  await waitFor(() => expect(within(screen.getAllByRole('article', { name: '工具组' })[0]!).queryByRole('button', { name: '读取组内更早记录' })).toBeNull())
  fireEvent.click(within(screen.getAllByRole('article', { name: '工具组' })[0]!).getByRole('button', { name: /读取组内后续记录/ }))
  await waitFor(() => expect(within(screen.getAllByRole('article', { name: '工具组' })[0]!).getByRole('button', { name: '读取组内更早记录' })).toBeInTheDocument())
  reader.setMessages([{ messageId: 'user-two', role: 'user', text: '用户窗口二', createdAt: 200.5, attachmentIds: [] }])
  window.page = { ...structuredClone(reader.entryPage({ groups: { [key]: { itemStart: 100, itemLimit: 100 } } })), userHistoryRevision: 11, userHistoryOffset: 1 }
  rerender(<ExecutionTimeline window={window} />)
  expect(screen.getByText('201 次工具调用')).toBeInTheDocument(); expect(screen.queryByText('151 次工具调用')).toBeNull()
})


it('does not restart first-visible frames on offpage deltas or inline callbacks and retries on an actual scroll without a new delta', () => {
  let nextFrame = 0, intersects = false
  const pending = new Map<number, FrameRequestCallback>()
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { pending.set(++nextFrame, callback); return nextFrame })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(handle => { pending.delete(handle) })
  const frame = () => { const callbacks = [...pending.values()]; pending.clear(); act(() => callbacks.forEach(callback => callback(performance.now()))) }
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('execution-timeline__content') && !intersects ? 500 : this.hasAttribute('data-execution-item') ? 10 : 0
    return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 30, width: 100, height: 30, toJSON() { return {} } }
  })
  const projection: ExecutionProjection = { conversationId: 'first-visible-scroll', cursor: 500, items: Array.from({ length: 500 }, (_, index) => item(index)) }
  const reader = new ExecutionTimelineReadModel(projection), window = control(reader), visible = vi.fn()
  window.page = structuredClone(reader.entryPage({ start: 100, limit: 100 }))
  const view = () => <div className="execution-assistant__history" data-testid="visible-host"><ExecutionTimeline window={window} onFirstVisible={(...args) => visible(...args)} /></div>
  const { rerender } = render(view()), host = screen.getByTestId('visible-host')
  Object.defineProperties(host, { scrollHeight: { configurable: true, value: 10000 }, clientHeight: { configurable: true, value: 300 } })
  host.scrollTop = 100; fireEvent.scroll(host); frame(); frame()
  expect(visible).not.toHaveBeenCalled(); expect(pending.size).toBe(0)
  raf.mockClear(); rect.mockClear()
  const plan = prepareExecutionEvents(projection, [{ eventId: 'offpage', conversationId: projection.conversationId, taskId: 'task', runId: 'run', itemId: 'item-499', type: 'text',
    source: 'builtin', time: 501, sequence: 501, update: 'append', data: { text: '不可见增量' } }])
  applyExecutionProjectionOwned(projection, plan); reader.apply(plan)
  window.page = structuredClone(reader.entryPage({ start: 100, limit: 100 })); rerender(view())
  expect(raf).not.toHaveBeenCalled(); expect(rect).not.toHaveBeenCalled()
  intersects = true; host.scrollTop = 200; fireEvent.scroll(host); fireEvent.scroll(host)
  expect(raf).toHaveBeenCalledTimes(1); frame(); frame()
  expect(visible).toHaveBeenCalledTimes(1); expect(visible).toHaveBeenCalledWith('task', 'item-100', expect.any(Object))
  raf.mockClear(); fireEvent.scroll(host); expect(raf).not.toHaveBeenCalled()
})
