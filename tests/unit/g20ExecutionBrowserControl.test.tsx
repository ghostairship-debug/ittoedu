import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'

afterEach(() => { cleanup(); localStorage.clear() })

it('shows takeover only for an observed task page and resumes the same browser after human control', async () => {
  const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false,
    authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
  const conversation: ConversationRecord = { conversationId: 'conversation', workspaceId: workspace.workspaceId,
    title: '网页任务', messages: [], attachmentIds: [], inputDraft: '', inputAttachments: [], frozenContextRefs: [],
    runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] }, revision: 1, createdAt: 1, updatedAt: 1 }
  const run: ExecutionRunRecord = { schemaVersion: 1, runId: 'run', version: 1,
    input: { conversationId: conversation.conversationId, taskId: 'task', instruction: '读取网页', documents: [],
      selection: { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'https://fixture.invalid/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private' },
        billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'model' } }, status: 'running', createdAt: 1, updatedAt: 1,
    messages: [], initialMessageCount: 0, requests: [], tools: [] }
  const listeners = new Set<(event: ExecutionEvent) => void>()
  let browser: Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['browserControl']>>> = { state: 'agent' }
  const browserControl = vi.fn<NonNullable<ExecutionDesktopAPI['browserControl']>>(async input => {
    if (input.action === 'takeover') browser = { ...browser, state: 'human' }
    if (input.action === 'resume') browser = { ...browser, state: 'agent', snapshotId: 'fresh-observation' }
    return browser
  })
  const api = {
    workspace: vi.fn(async () => ({ workspace, conversations: [conversation] })),
    conversations: vi.fn(async () => [conversation]), conversation: vi.fn(async () => conversation),
    run: vi.fn(async () => run), submissions: vi.fn(async () => []),
    timeline: vi.fn(async () => emptyExecutionProjection(conversation.conversationId)),
    events: vi.fn(async (_id: string, after = 0) => ({ events: [], cursor: after, hasMore: false })),
    edits: vi.fn(async () => []), browserControl,
    subscribe: vi.fn((listener: (event: ExecutionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    subscribeEdits: vi.fn(() => () => {}),
  } as unknown as ExecutionDesktopAPI
  render(<ExecutionAssistant root="C:/workspace" api={api} captureDocuments={async () => []} prepareSend={async () => true} />)
  await waitFor(() => expect(browserControl).toHaveBeenCalledWith(expect.objectContaining({ action: 'status', runId: 'run' })))
  expect(screen.queryByRole('button', { name: '接管当前网页' })).toBeNull()
  expect(screen.queryByRole('button', { name: '接管浏览器登录' })).toBeNull()
  expect(browserControl.mock.calls.every(([input]) => input.action === 'status')).toBe(true)

  const observe = (sequence: number) => act(() => {
    const event: ExecutionEvent = { eventId: `event-${sequence}`, sequence, conversationId: conversation.conversationId,
      taskId: 'task', runId: 'run', itemId: 'browser-tool', time: sequence, source: 'builtin', type: 'tool', update: 'append',
      data: { toolName: 'mcp.invoke', status: 'returned' } }
    for (const listener of listeners) listener(event)
  })
  browser = { state: 'agent', pageUrl: 'https://example.org/task' }
  observe(1)
  const takeover = await screen.findByRole('button', { name: '接管当前网页' })
  expect(takeover).toHaveAttribute('title', 'https://example.org/task')
  fireEvent.click(takeover)
  const resume = await screen.findByRole('button', { name: '完成操作，继续任务' })
  expect(browserControl).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', action: 'takeover' })
  fireEvent.click(resume)
  await screen.findByRole('button', { name: '接管当前网页' })
  expect(browserControl).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', action: 'resume' })

  browser = { state: 'agent' }
  observe(2)
  await waitFor(() => expect(screen.queryByRole('button', { name: '接管当前网页' })).toBeNull())
})
