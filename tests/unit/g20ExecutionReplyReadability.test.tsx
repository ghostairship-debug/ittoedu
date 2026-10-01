import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import type { ExecutionItem, ExecutionProjection } from '../../src/shared/workbench/executionEvents'

afterEach(cleanup)
const item = (itemId: string, type: ExecutionItem['type'], text: string): ExecutionItem => ({
  taskId: 'task', runId: 'run', itemId, source: 'builtin', type, time: 1, sequence: 1,
  data: { status: 'completed' }, content: [{ kind: 'text', text }],
})
function expand(card: HTMLElement) {
  const details = card.querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
}

it('structures only replies, keeps streamed fragments and code readable, and preserves raw diagnostics and addresses without executing HTML', async () => {
  const source = '## 设计稿\n\n已完成 **三份设计**，成本 $20。\n\n- 首页\n- 工作台\n\n[设计源文](https://example.test/design.html)\n\n![示意图](https://example.test/diagram.png)\n\n<script>window.replyExecuted=true</script>\n\n| 页面 | 状态 |\n| --- | --- |\n| 首页 | 完成 |\n\n当前 **第一'
  const reply = item('reply', 'text', source)
  const reasoning = item('reasoning', 'reasoning', '## 原始思考\n**保持原文**')
  const tool = { ...item('tool', 'tool', '## 工具说明'), data: { toolName: 'document.read', status: 'returned', input: '{"hint":"**原参数**","path":"C:/Users/person/private.md"}', output: '## 原输出\n<script>原文</script>' } }
  const savedFile = { ...item('saved-file', 'tool', ''), data: { toolName: 'file.write', status: 'returned', saveStatus: 'saved' as const } }
  const ref = { id: 'a'.repeat(64), bytes: 13000, mime: 'text/plain;charset=utf-8' as const }
  const blob = { ...item('blob', 'text', ''), content: [{ kind: 'blob' as const, ref }] }
  let projection: ExecutionProjection = { conversationId: 'conversation', cursor: 5, items: [reply, reasoning, tool, savedFile, blob] }
  const readBlob = vi.fn(async () => `## 完整回复\n\n${'字'.repeat(12000)}\n\n**结束**`)
  const { container, rerender } = render(<ExecutionTimeline projection={projection} readBlob={readBlob} />)
  const replyCard = container.querySelector<HTMLElement>('[data-execution-item="run:reply"]')!
  expect(within(replyCard).getByRole('heading', { name: '设计稿', level: 2 })).toBeInTheDocument()
  expect(within(replyCard).getByText('三份设计').tagName).toBe('STRONG')
  expect(within(replyCard).getByRole('list')).toHaveTextContent('首页工作台')
  expect(within(replyCard).getByRole('table')).toHaveTextContent('页面状态首页完成')
  expect(replyCard).toHaveTextContent('成本 $20')
  expect(replyCard).toHaveTextContent('https://example.test/design.html')
  expect(replyCard).toHaveTextContent('https://example.test/diagram.png')
  expect(replyCard).toHaveTextContent('<script>window.replyExecuted=true</script>')
  expect(replyCard).toHaveTextContent('当前 **第一')
  expect(within(replyCard).getByRole('link', { name: '设计源文' })).toHaveAttribute('href', 'https://example.test/design.html')
  expect(replyCard.querySelectorAll('img,script')).toHaveLength(0)
  const thoughtCard = screen.getByRole('article', { name: '模型提供的思考' }); expand(thoughtCard)
  expect(thoughtCard.querySelector('pre')).toHaveTextContent('## 原始思考 **保持原文**')
  const toolCard = container.querySelector<HTMLElement>('[data-execution-item="run:tool"]')!; expand(toolCard)
  expect(within(toolCard).getByRole('region', { name: '参数' }).querySelector('pre')).toHaveTextContent('**原参数**')
  expect(within(toolCard).getByRole('region', { name: '参数' })).toHaveTextContent('[本地路径]/private.md')
  expect(within(toolCard).getByRole('region', { name: '参数' })).not.toHaveTextContent('C:/Users/person')
  expect(within(toolCard).getByRole('region', { name: '工具输出' }).querySelector('pre')).toHaveTextContent('## 原输出 <script>原文</script>')
  expect(toolCard).not.toHaveTextContent('保存未确认')
  expect(toolCard).not.toHaveTextContent('未确认应用')
  const fileCard = container.querySelector<HTMLElement>('[data-execution-item="run:saved-file"]')!; expand(fileCard)
  expect(fileCard).toHaveTextContent('已保存')
  expect(fileCard).not.toHaveTextContent('未确认应用')
  projection = { ...projection, cursor: 6, items: [{ ...reply, content: [{ kind: 'text', text: source }, { kind: 'text', text: '版**。\n\n```html\n<div>示例</div>' }] }, reasoning, tool, savedFile, blob] }
  rerender(<ExecutionTimeline projection={projection} readBlob={readBlob} />)
  expect(within(replyCard).getByText('第一版').tagName).toBe('STRONG')
  expect(replyCard.querySelector('pre>code')).toHaveTextContent('<div>示例</div>')
  projection = { ...projection, cursor: 7, items: [{ ...projection.items[0]!, content: [...projection.items[0]!.content, { kind: 'text', text: '\n```' }] }, reasoning, tool, savedFile, blob] }
  rerender(<ExecutionTimeline projection={projection} readBlob={readBlob} />)
  expect(replyCard.querySelector('pre>code')).toHaveTextContent('<div>示例</div>')
  expect(container.querySelector('script')).toBeNull()
  expect((window as unknown as { replyExecuted?: boolean }).replyExecuted).toBeUndefined()
  expect(readBlob).not.toHaveBeenCalled()
  const blobCard = container.querySelector<HTMLElement>('[data-execution-item="run:blob"]')!
  fireEvent.click(within(blobCard).getByRole('button', { name: /读取完整内容/ }))
  await within(blobCard).findByRole('heading', { name: '完整回复', level: 2 })
  expect(within(blobCard).queryByText('结束')).toBeNull()
  fireEvent.click(within(blobCard).getByRole('button', { name: /继续读取内容/ }))
  expect(within(blobCard).getByText('结束').tagName).toBe('STRONG')
  expect(readBlob).toHaveBeenCalledExactlyOnceWith(ref)
})
