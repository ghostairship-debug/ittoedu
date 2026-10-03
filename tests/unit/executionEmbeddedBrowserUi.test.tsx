import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { emptyExecutionProjection } from '../../src/shared/workbench/executionEvents'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('opens the task viewport, waits for its actual ready result before takeover, and hides it when collapsed', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const rect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.taskBrowserViewport ? { x: 20, y: 180, left: 20, top: 180, right: 520, bottom: 440,
      width: 500, height: 260, toJSON() { return {} } } : rect.call(this)
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
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
  let browser: Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['browserControl']>>> = { state: 'agent', pageUrl: 'https://example.org/login' }
  const browserControl = vi.fn<NonNullable<ExecutionDesktopAPI['browserControl']>>(async input => {
    if (input.action === 'takeover') browser = { ...browser, state: 'human' }
    if (input.action === 'resume') browser = { ...browser, state: 'agent', snapshotId: 'resumed-page' }
    return browser
  })
  let ready!: () => void
  const waitForEmbeddedPage = new Promise<void>(resolve => { ready = resolve })
  const browserViewport = vi.fn<NonNullable<ExecutionDesktopAPI['browserViewport']>>(async input => {
    if (input.visible) await waitForEmbeddedPage
    return { embedded: true, visible: input.visible, pageUrl: browser.pageUrl }
  })
  const api = {
    workspace: vi.fn(async () => ({ workspace, conversations: [conversation] })), conversations: vi.fn(async () => [conversation]),
    conversation: vi.fn(async () => conversation), run: vi.fn(async () => run), submissions: vi.fn(async () => []),
    timeline: vi.fn(async () => emptyExecutionProjection(conversation.conversationId)),
    events: vi.fn(async (_id: string, after = 0) => ({ events: [], cursor: after, hasMore: false })),
    edits: vi.fn(async () => []), browserControl, browserViewport, subscribe: vi.fn(() => () => {}), subscribeEdits: vi.fn(() => () => {}),
  } as unknown as ExecutionDesktopAPI
  render(<ExecutionAssistant root="C:/workspace" api={api} captureDocuments={async () => []} prepareSend={async () => true} />)
  const takeover = await screen.findByRole('button', { name: '接管当前网页' })
  expect(takeover).toBeDisabled()
  expect(browserViewport).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: '查看任务网页' }))
  await waitFor(() => expect(browserViewport).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', runId: 'run',
    visible: true, bounds: { x: 20, y: 180, width: 500, height: 260 } }))
  expect(takeover).toBeDisabled()
  expect(browserControl.mock.calls.every(([input]) => input.action === 'status')).toBe(true)
  await act(async () => { ready(); await waitForEmbeddedPage })
  await waitFor(() => expect(takeover).toBeEnabled())
  fireEvent.click(takeover)
  const resume = await screen.findByRole('button', { name: '完成操作，继续任务' })
  expect(browserControl).toHaveBeenCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', action: 'takeover' })
  expect(screen.getByRole('button', { name: '收起任务网页' })).toBeDisabled()
  fireEvent.click(resume)
  await waitFor(() => expect(screen.getByRole('button', { name: '收起任务网页' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '收起任务网页' }))
  await waitFor(() => expect(browserViewport).toHaveBeenLastCalledWith({ workspaceId: 'workspace', conversationId: 'conversation', runId: 'run', visible: false }))
  await waitFor(() => expect(screen.getByRole('button', { name: '接管当前网页' })).toBeDisabled())
  expect(screen.queryByLabelText('任务浏览器')).toBeNull()
})
