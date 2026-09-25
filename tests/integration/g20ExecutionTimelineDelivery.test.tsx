// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, render, screen, within, fireEvent } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe timeline fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function store() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-timeline-delivery-'))
  roots.push(directory)
  return new ExecutionEventStore({ directory })
}
function tool(runId: string, source: ExecutionEventInput['source'], index: number, text: string,
  update: ExecutionEventInput['update'] = 'append'): ExecutionEventInput {
  return { eventId: `${runId}-${index}`, conversationId: 'conversation', taskId: `${runId}-task`, runId,
    itemId: 'one-call', time: index + 1, source, type: 'tool', update,
    data: { status: index === 4 ? 'completed' : 'running', toolName: 'read.file', text } }
}
function expand(card: HTMLElement) {
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
}

it('S07-T01 delivers three same-status increments per built-in and external call through durable storage to one GUI card each', async () => {
  const events = await store()
  for (const source of ['builtin', 'external-mcp'] as const) {
    for (const [index, part] of ['第一段', '第二段', '第三段'].entries()) {
      await events.append(tool(`${source}-run`, source, index, part))
    }
  }
  const reopened = new ExecutionEventStore({ directory: roots[0]! })
  const projection = await reopened.snapshot('conversation')
  expect(projection.items).toHaveLength(2)
  const { rerender } = render(<ExecutionTimeline projection={projection} />)
  const cards = screen.getAllByRole('article', { name: '工具执行' })
  expect(cards).toHaveLength(2)
  for (const card of cards) {
    expand(card)
    expect(within(card).getByText('第一段第二段第三段')).toBeInTheDocument()
  }
  expect(within(cards[1]!).getByText('外部 MCP · 仅显示实际工具事实')).toBeInTheDocument()
  expect(projection.items.map(item => item.data.usage)).toEqual([undefined, undefined])

  await events.append(tool('builtin-run', 'builtin', 4, '最终快照', 'snapshot'))
  const completed = await reopened.snapshot('conversation')
  rerender(<ExecutionTimeline projection={completed} />)
  const updated = screen.getAllByRole('article', { name: '工具执行' })
  expect(updated).toHaveLength(2)
  expect(within(updated[0]!).getByText('最终快照')).toBeInTheDocument()
  expect(within(updated[0]!).queryByText('第一段第二段第三段')).toBeNull()
  expect(within(updated[1]!).getByText('第一段第二段第三段')).toBeInTheDocument()
})

it('S07-T04 shows only supplied parent-child facts, replaces a final snapshot, and does not invent tokens', async () => {
  const events = await store()
  await events.append({ eventId: 'parent', conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'parent',
    time: 1, source: 'builtin', type: 'build', update: 'snapshot', data: { label: '受控构建', status: 'running' } })
  await events.append({ eventId: 'child-a', conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'child', parentItemId: 'parent',
    time: 2, source: 'builtin', type: 'tool', update: 'append', data: { toolName: 'build.check', text: '检查中', status: 'running' } })
  await events.append({ eventId: 'child-b', conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'child', parentItemId: 'parent',
    time: 3, source: 'builtin', type: 'tool', update: 'snapshot', data: { text: '检查完成', status: 'completed' } })
  const projection = await events.snapshot('conversation')
  expect(projection.items).toHaveLength(2)
  expect(projection.items[1]!.content).toEqual([{ kind: 'text', text: '检查完成' }])
  const { rerender } = render(<ExecutionTimeline projection={projection} />)
  const child = screen.getByRole('article', { name: '工具执行' })
  expand(child)
  expect(within(child).getByText('上游提供的子项 · 受控构建')).toBeInTheDocument()
  expect(within(child).getByText('检查完成')).toBeInTheDocument()
  expect(within(child).queryByText('检查中')).toBeNull()
  expect(screen.queryByRole('article', { name: '本次用量' })).toBeNull()

  await events.append({ eventId: 'reported-usage', conversationId: 'conversation', taskId: 'task', runId: 'run', itemId: 'usage',
    parentItemId: 'parent', time: 4, source: 'builtin', type: 'usage', update: 'snapshot', data: { usage: { outputTokens: 7 } } })
  rerender(<ExecutionTimeline projection={await events.snapshot('conversation')} />)
  const usage = screen.getByRole('article', { name: '本次用量' })
  expand(usage)
  expect(within(usage).getByText('输出 7')).toBeInTheDocument()
  expect(within(usage).getByText('上游提供的子项 · 受控构建')).toBeInTheDocument()
  expect(within(usage).queryByText(/输入 0|合计 7/)).toBeNull()
})

it('S07-T02 renders interleaved reasoning, reply, edit and tool facts in separate visible places', async () => {
  const events = await store()
  for (const [index, type, itemId, value] of [
    [0, 'reasoning', 'thought', '检查目标'],
    [1, 'text', 'reply', '准备修改'],
    [2, 'edit', 'preview', '绑定目标的正文预览'],
    [3, 'tool', 'operation', '正式工具回执'],
    [4, 'text', 'reply', '修改已应用'],
  ] as const) await events.append({ eventId: `event-${index}`, conversationId: 'conversation', taskId: 'task', runId: 'run',
    itemId, time: index + 1, source: 'builtin', type, update: index === 4 ? 'snapshot' : 'append', data: { text: value } })
  const projection = await events.snapshot('conversation')
  const { container } = render(<ExecutionTimeline projection={projection} />)
  const thought = screen.getByRole('article', { name: '模型提供的思考' })
  const reply = screen.getByRole('article', { name: '回复' })
  const edit = screen.getByRole('article', { name: '编辑预览' })
  const toolCard = screen.getByRole('article', { name: '工具执行' })
  expand(thought); expand(edit); expand(toolCard)
  expect(within(thought).getByText('检查目标')).toBeInTheDocument()
  expect(within(reply).getByText('修改已应用')).toBeInTheDocument()
  expect(within(edit).getByText('绑定目标的正文预览')).toBeInTheDocument()
  expect(within(toolCard).getByText('正式工具回执')).toBeInTheDocument()
  expect(within(reply).queryByText('检查目标')).toBeNull()
  expect(within(reply).queryByText('绑定目标的正文预览')).toBeNull()
  expect(within(reply).queryByText('准备修改')).toBeNull()
  expect(container.querySelectorAll('[data-execution-item]')).toHaveLength(4)
})
