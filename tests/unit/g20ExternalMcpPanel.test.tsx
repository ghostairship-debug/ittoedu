import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExternalMcpPanel } from '../../src/renderer/workbench/ExternalMcpPanel'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExternalGrantResult, ExternalGrantView, ExternalMcpAPI } from '../../src/shared/workbench/external'

afterEach(cleanup)
function fixture() {
  const conversation: ConversationRecord = { conversationId: 'conversation', workspaceId: 'space', title: '任务', messages: [], attachmentIds: [],
    runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft: '改正文', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 0, updatedAt: 0 }
  const documents = [{ documentId: 'document', epoch: 'epoch', revision: 3, writable: [{ kind: 'markdown-range' as const, from: 1, to: 4 }] }]
  const result: ExternalGrantResult = { conversation: { ...conversation, revision: 2 },
    connection: { connectionId: 'connection', runId: 'external-run', endpoint: 'http://127.0.0.1:9999/mcp', bearer: 'ephemeral-secret', expiresAt: Date.now() + 60_000 },
    handoff: { originalGoal: '改正文', originalTargets: [], committedFacts: [], unresolvedTools: [], uncertainRequests: [], remainingWork: '继续', attachments: [], observe: 'guoling://task/context' },
    config: { transport: 'streamable-http', endpoint: 'http://127.0.0.1:9999/mcp', authorization: 'Bearer ephemeral-secret', codex: 'codex config', claude: 'claude config', opencode: 'opencode config' } }
  let grants: ExternalGrantView[] = []
  const api: ExternalMcpAPI = {
    list: vi.fn(async () => structuredClone(grants)),
    grant: vi.fn(async () => { grants = [{ workspaceId: 'space', conversationId: 'conversation', connectionId: 'connection', runId: 'external-run', expiresAt: result.connection.expiresAt, status: 'active', documents }]; return structuredClone(result) }),
    revoke: vi.fn(async () => { grants = grants.map(grant => ({ ...grant, status: 'revoked' })) }),
    handoff: vi.fn(async () => result.handoff),
  }
  const props = { open: true, onClose: vi.fn(), api, workspaceId: 'space', conversation, documents, instruction: '改正文', onConversationChange: vi.fn() }
  return { props, api, result }
}

it('shows the actual frozen scope and fresh client credentials, then removes them after explicit revoke', async () => {
  const { props, api } = fixture()
  render(<ExternalMcpPanel {...props} />)
  expect(screen.getByLabelText('本次授权范围')).toHaveTextContent('正文第 2–4 字符可修改')
  fireEvent.change(screen.getByLabelText('剩余任务或补充要求'), { target: { value: '只改指定部分' } })
  fireEvent.click(screen.getByRole('button', { name: '结算当前任务并创建授权' }))
  await waitFor(() => expect(screen.getByLabelText('本次授权环境变量')).toHaveValue("$env:GUOLING_MCP_TOKEN='ephemeral-secret'"))
  expect(api.grant).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'space', conversationId: 'conversation', documents: props.documents, remainingWork: '只改指定部分' }))
  expect(props.onConversationChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
  fireEvent.change(screen.getByLabelText('客户端'), { target: { value: 'opencode' } })
  expect(screen.getByLabelText('客户端配置')).toHaveValue('opencode config')
  fireEvent.click(screen.getByRole('button', { name: '撤销连接 1' }))
  await waitFor(() => expect(screen.queryByLabelText('本次授权环境变量')).not.toBeInTheDocument())
  expect(screen.getByLabelText('已有外部授权')).toHaveTextContent('已撤销')
  expect(screen.getByText(/外部聊天、用量和任务是否完成未知/)).toBeVisible()
})

it('revokes a late grant when the user switches conversation instead of exposing it in the new conversation', async () => {
  const { props, api, result } = fixture()
  let resolve!: (value: ExternalGrantResult) => void
  vi.mocked(api.grant).mockReturnValueOnce(new Promise(done => { resolve = done }))
  const view = render(<ExternalMcpPanel {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '结算当前任务并创建授权' }))
  view.rerender(<ExternalMcpPanel {...props} conversation={{ ...props.conversation, conversationId: 'other' }} />)
  resolve(result)
  await waitFor(() => expect(api.revoke).toHaveBeenCalledWith({ workspaceId: 'space', conversationId: 'conversation', connectionId: 'connection' }))
  expect(props.onConversationChange).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('本次授权环境变量')).not.toBeInTheDocument()
})
