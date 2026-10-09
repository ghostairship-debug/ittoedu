import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionApprovalCard } from '../../src/renderer/workbench/ExecutionApprovalCard'

afterEach(cleanup)
it('shows the real command and stdin, approves only that call, and retains the ordinary document approval controls', async () => {
  const decide = vi.fn<NonNullable<React.ComponentProps<typeof ExecutionApprovalCard>['onDecide']>>(async () => {})
  const command = { executable: 'C:\\Program Files\\nodejs\\node.exe', args: ['script.js', 'input.txt'], cwd: 'C:\\candidate\\copy',
    stdin: '原样输入正文', sources: [{ source: 'input.txt', version: 'document:original:epoch:7', byteLength: 12 }], outputs: ['result.json'] }
  const view = render(<ExecutionApprovalCard pending={{ runId: 'parent', callId: 'command', approval: { kind: 'local-command', reason: 'ask', summary: '运行本地工具',
    documents: [command.cwd], preview: JSON.stringify(command) } }} onDecide={decide} />)
  expect(screen.getByRole('region', { name: '工具执行请求' })).toHaveTextContent('AI 想运行本地工具')
  expect(JSON.parse(screen.getByLabelText('执行内容').textContent!)).toEqual(command)
  expect(screen.queryByRole('button', { name: '本任务都允许' })).toBeNull()
  expect(screen.queryByText('AI 想修改文档')).toBeNull()
  expect(screen.getByRole('region', { name: '工具执行请求' })).not.toHaveTextContent('可在文档中撤销')
  fireEvent.click(screen.getByRole('button', { name: '允许' }))
  await waitFor(() => expect(decide).toHaveBeenCalledExactlyOnceWith('allow'))
  view.unmount()
  render(<ExecutionApprovalCard pending={{ runId: 'parent', callId: 'edit', approval: { reason: 'ask', summary: '修改正文', documents: ['当前课件'], preview: '改为新内容' } }} onDecide={decide} />)
  expect(screen.getByRole('region', { name: '修改请求' })).toHaveTextContent('AI 想修改文档')
  expect(screen.getByRole('button', { name: '本任务都允许' })).toBeEnabled()
  expect(screen.getByRole('region', { name: '修改请求' })).toHaveTextContent('可在文档中撤销')
})
