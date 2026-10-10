import { cleanup, fireEvent, render, screen, waitFor, } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExternalMcpPanel } from '../../src/renderer/workbench/ExternalMcpPanel'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, type ExternalMcpAPI, type ExternalMcpStatus } from '../../src/shared/workbench/external'

afterEach(cleanup)
function fixture(initial: Partial<ExternalMcpStatus> = {}) {
  let status: ExternalMcpStatus = { state: 'running', settings: { ...DEFAULT_EXTERNAL_MCP_SETTINGS }, endpoint: 'http://127.0.0.1:45123/mcp',
    sessions: [{ sessionId: 'session-1', clientName: 'Claude Code', workspaceId: 'space', workspaceName: '语文', permission: 'workspace',
      connectedAt: Date.UTC(2026, 9, 4, 1), lastCallAt: Date.UTC(2026, 9, 4, 2), pendingCalls: 2, stopped: false }], ...initial }
  const api: ExternalMcpAPI = {
    status: vi.fn(async () => structuredClone(status)),
    configure: vi.fn(async patch => { status = { ...status, settings: { ...status.settings, ...patch } }; return structuredClone(status) }),
    configureSession: vi.fn(async (sessionId, permission) => { status = { ...status, sessions: status.sessions.map(item => item.sessionId === sessionId ? { ...item, permission } : item) }; return structuredClone(status) }),
    stopSession: vi.fn(async sessionId => { status = { ...status, sessions: status.sessions.map(item => item.sessionId === sessionId ? { ...item, stopped: true } : item) }; return structuredClone(status) }),
  }
  return { api }
}

it('shows the resident endpoint, sessions and client configs; changes the selected live connection directly and supplies tokenless client configurations', async () => {
  const { api } = fixture()
  render(<ExternalMcpPanel open onClose={vi.fn()} api={api} />)
  expect(await screen.findByText('运行中')).toBeVisible()
  expect(screen.getByLabelText('连接地址')).toHaveValue('http://127.0.0.1:45123/mcp')
  expect(screen.queryByLabelText('令牌')).not.toBeInTheDocument()
  expect(screen.getByLabelText('外部会话')).toHaveTextContent('Claude Code · 语文 · 完全访问（工作空间）')
  expect(screen.getByLabelText('外部会话')).toHaveTextContent('正在处理 2 个调用')
  expect(screen.getByLabelText('新连接默认权限')).toHaveValue('workspace')
  expect(screen.getByLabelText('客户端配置')).toHaveValue('claude mcp add --transport http --scope user guoling http://127.0.0.1:45123/mcp')
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'codex' } })
  expect(screen.getByLabelText('客户端配置')).toHaveValue('[mcp_servers.guoling]\nurl = "http://127.0.0.1:45123/mcp"\n')
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'gemini' } })
  expect((screen.getByLabelText('客户端配置') as HTMLTextAreaElement).value).toContain('"httpUrl": "http://127.0.0.1:45123/mcp"')
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'opencode' } })
  expect((screen.getByLabelText('客户端配置') as HTMLTextAreaElement).value).not.toContain('Authorization')
  fireEvent.change(screen.getByLabelText('Claude Code 连接权限'), { target: { value: 'full' } })
  await waitFor(() => expect(api.configureSession).toHaveBeenCalledWith('session-1', 'full'))
  expect(await screen.findByText(/后续调用已使用完全访问/)).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: '停止' }))
  await waitFor(() => expect(api.stopSession).toHaveBeenCalledWith('session-1'))
  expect(await screen.findByText(/已停止 Claude Code 的会话/)).toBeVisible()

})

it('explains an occupied port and applies settings changes through Main', async () => {
  const { api } = fixture({ state: 'port-in-use', message: '端口 45123 已被其他程序占用，外部连接服务未启动。请在设置中改用其他端口（1024–65535）。', sessions: [] })
  render(<ExternalMcpPanel open onClose={vi.fn()} api={api} />)
  expect(await screen.findByText('端口被占用')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('端口 45123 已被其他程序占用')
  fireEvent.change(screen.getByLabelText('端口'), { target: { value: '80' } })
  fireEvent.click(screen.getByRole('button', { name: '应用端口' }))
  expect(await screen.findByText('端口需为 1024–65535 之间的整数')).toBeVisible()
  expect(api.configure).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('端口'), { target: { value: '46001' } })
  fireEvent.click(screen.getByRole('button', { name: '应用端口' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ port: 46001 }))
  fireEvent.change(screen.getByLabelText('新连接默认权限'), { target: { value: 'ask' } })
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ permission: 'ask' }))
  expect(await screen.findByText(/当前连接可在下方直接调整/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('点击窗口关闭按钮时'), { target: { value: 'tray' } })
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ closeAction: 'tray' }))
  fireEvent.click(screen.getByLabelText('启用外部连接服务'))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ enabled: true }))
})
