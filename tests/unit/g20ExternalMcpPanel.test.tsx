import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExternalMcpPanel } from '../../src/renderer/workbench/ExternalMcpPanel'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, type ExternalMcpAPI, type ExternalMcpStatus } from '../../src/shared/workbench/external'

afterEach(cleanup)
function fixture(initial: Partial<ExternalMcpStatus> = {}) {
  let status: ExternalMcpStatus = { state: 'running', settings: { ...DEFAULT_EXTERNAL_MCP_SETTINGS }, endpoint: 'http://127.0.0.1:45123/mcp',
    sessions: [{ sessionId: 'session-1', clientName: 'Claude Code', workspaceId: 'space', workspaceName: '语文', permission: 'workspace',
      connectedAt: Date.UTC(2026, 9, 4, 1), lastCallAt: Date.UTC(2026, 9, 4, 2), pendingCalls: 2, stopped: false }], ...initial }
  let token = 'resident-token-1'
  const api: ExternalMcpAPI = {
    status: vi.fn(async () => structuredClone(status)),
    configure: vi.fn(async patch => { status = { ...status, settings: { ...status.settings, ...patch } }; return structuredClone(status) }),
    revealToken: vi.fn(async () => token),
    regenerateToken: vi.fn(async () => { token = 'resident-token-2'; status = { ...status, sessions: [] }; return { token, status: structuredClone(status) } }),
    stopSession: vi.fn(async sessionId => { status = { ...status, sessions: status.sessions.map(item => item.sessionId === sessionId ? { ...item, stopped: true } : item) }; return structuredClone(status) }),
  }
  return { api }
}

it('shows the resident endpoint, sessions and client configs; reveals, regenerates and stops on explicit actions', async () => {
  const { api } = fixture()
  render(<ExternalMcpPanel open onClose={vi.fn()} api={api} />)
  expect(await screen.findByText('运行中')).toBeVisible()
  expect(screen.getByLabelText('连接地址')).toHaveValue('http://127.0.0.1:45123/mcp')
  expect(screen.getByLabelText('令牌')).not.toHaveValue('resident-token-1')
  expect(screen.getByLabelText('外部会话')).toHaveTextContent('Claude Code · 语文 · 完全访问（工作空间）')
  expect(screen.getByLabelText('外部会话')).toHaveTextContent('正在处理 2 个调用')
  expect(screen.getByLabelText('外部会话权限')).toHaveValue('workspace')
  expect(screen.getByLabelText('客户端配置')).toHaveValue('claude mcp add --transport http --scope user guoling http://127.0.0.1:45123/mcp --header "Authorization: Bearer $env:GUOLING_MCP_TOKEN"')
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'codex' } })
  expect(screen.getByLabelText('客户端配置')).toHaveValue('[mcp_servers.guoling]\nurl = "http://127.0.0.1:45123/mcp"\nbearer_token_env_var = "GUOLING_MCP_TOKEN"\n')
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'gemini' } })
  expect((screen.getByLabelText('客户端配置') as HTMLTextAreaElement).value).toContain('"httpUrl": "http://127.0.0.1:45123/mcp"')
  expect((screen.getByLabelText('设置环境变量') as HTMLTextAreaElement).value).toContain('<先在上方显示令牌>')
  fireEvent.click(screen.getByRole('button', { name: '显示' }))
  await waitFor(() => expect(screen.getByLabelText('令牌')).toHaveValue('resident-token-1'))
  expect((screen.getByLabelText('设置环境变量') as HTMLTextAreaElement).value).toContain("'GUOLING_MCP_TOKEN', 'resident-token-1', 'User'")
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'opencode' } })
  expect((screen.getByLabelText('客户端配置') as HTMLTextAreaElement).value).toContain('"Authorization": "Bearer resident-token-1"')

  fireEvent.click(screen.getByRole('button', { name: '停止' }))
  await waitFor(() => expect(api.stopSession).toHaveBeenCalledWith('session-1'))
  expect(await screen.findByText(/已停止 Claude Code 的会话/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
  expect(api.regenerateToken).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '重新生成' }))
  await waitFor(() => expect(api.regenerateToken).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByLabelText('令牌')).toHaveValue('resident-token-2'))
  expect(screen.getByText(/旧令牌立即失效，所有外部会话已断开/)).toBeVisible()
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
  fireEvent.change(screen.getByLabelText('外部会话权限'), { target: { value: 'ask' } })
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ permission: 'ask' }))
  expect(await screen.findByText(/已连接的会话保持连接时的档位/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('点击窗口关闭按钮时'), { target: { value: 'tray' } })
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ closeAction: 'tray' }))
  fireEvent.click(screen.getByLabelText('启用外部连接服务'))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith({ enabled: false }))
})
