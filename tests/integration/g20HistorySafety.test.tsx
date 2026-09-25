// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { exportDiagnosticReport } from '../../src/main/diagnosticLog'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'

const native = vi.hoisted(() => ({ directory: '', showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ app: { isReady: () => true, getVersion: () => '2.0-history-fixture', getPath: () => native.directory }, dialog: native }))

const roots: string[] = []
afterEach(async () => {
  cleanup()
  native.showMessageBox.mockReset(); native.showOpenDialog.mockReset(); native.showSaveDialog.mockReset()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe history fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function historyAPI(conversations: ConversationStore, events: ExecutionEventStore) {
  const send = vi.fn(async () => { throw new Error('History display must not send or execute a task') })
  const stop = vi.fn(async () => { throw new Error('History display must not control a task') })
  const mutation = vi.fn(async (): Promise<never> => { throw new Error('History display must be read-only') })
  const api = {
    workspace: async () => ({ workspace: (await conversations.readWorkspace('space'))!, conversations: await conversations.listConversations('space') }),
    conversations: (workspaceId: string) => conversations.listConversations(workspaceId),
    createConversation: mutation,
    conversation: (workspaceId: string, conversationId: string) => conversations.readConversation({ workspaceId, conversationId }),
    draft: mutation, renameConversation: mutation, deleteConversation: mutation,
    submission: mutation, deleteSubmission: mutation, pauseQueue: mutation, resumeQueue: mutation,
    submissions: async () => [],
    timeline: (conversationId: string) => events.snapshot(conversationId),
    events: (conversationId: string, after = 0, limit = 200) => events.readPage({ conversationId, after, limit }),
    searchEvents: (input: Parameters<ExecutionDesktopAPI['searchEvents']>[0]) => events.search(input),
    blob: async (conversationId: string, ref: Parameters<ExecutionDesktopAPI['blob']>[1]) => new TextDecoder().decode(await events.readBlob(conversationId, ref)),
    subscribe: () => () => {},
    subscribeEdits: () => () => {},
    edits: mutation,
    run: async () => null,
    send,
    stop,
  } satisfies ExecutionDesktopAPI
  return { api, send, stop, mutation }
}

function assertHistoryIsTextOnly(host: HTMLElement) {
  expect(host.querySelector('script, img, iframe, object, embed, a[href^="javascript:"]')).toBeNull()
  expect((window as typeof window & { __historyExecuted?: boolean }).__historyExecuted).toBeUndefined()
}

it('M09-T05 opens, exports diagnostics and reopens persisted script-like output and old tool calls without executing them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-history-safety-'))
  roots.push(root); native.directory = root
  const conversationDirectory = path.join(root, 'conversations')
  const eventDirectory = path.join(root, 'events')
  const conversations = new ConversationStore({ directory: conversationDirectory })
  const workspace = await conversations.registerWorkspace({ workspaceId: 'space', rootPath: path.join(root, 'workspace'), managed: false, authorization: 'user-selected' })
  const created = await conversations.createConversation({ workspaceId: workspace.workspaceId, conversationId: 'history', title: '历史安全' })
  const script = '<script>window.__historyExecuted = true</script><img src=x onerror="window.__historyExecuted = true"><a href="javascript:window.__historyExecuted=true">历史链接</a>'
  const command = 'echo SHOULD_NOT_RUN'
  await conversations.updateConversation({ workspaceId: 'space', conversationId: 'history', expectedRevision: created.revision,
    patch: { messages: [
      { messageId: 'user', role: 'user', text: `历史提问 ${script}`, createdAt: 1, attachmentIds: [] },
      { messageId: 'old-tool', role: 'tool', text: command, createdAt: 2, attachmentIds: [], runId: 'old-run' },
      { messageId: 'model', role: 'assistant', text: script, createdAt: 3, attachmentIds: [], runId: 'old-run' },
    ] } })
  const events = new ExecutionEventStore({ directory: eventDirectory, inlineBytes: 100 })
  await events.append({ eventId: 'model-text', conversationId: 'history', taskId: 'old-task', runId: 'old-run', itemId: 'reply',
    time: 1, source: 'builtin', type: 'text', update: 'snapshot', data: { text: script, status: 'completed' } })
  await events.append({ eventId: 'old-tool-call', conversationId: 'history', taskId: 'old-task', runId: 'old-run', itemId: 'tool',
    time: 2, source: 'builtin', type: 'tool', update: 'snapshot', data: { status: 'completed', toolName: 'shell.execute',
      input: JSON.stringify({ command }), output: `曾经的工具输出：${script}\n${'历史数据。'.repeat(80)}` } })
  await events.append({ eventId: 'old-run-end', conversationId: 'history', taskId: 'old-task', runId: 'old-run', itemId: 'end',
    time: 3, source: 'builtin', type: 'run.end', update: 'snapshot', data: { status: 'completed' } })

  async function openPersistedHistory() {
    const reopenedConversations = new ConversationStore({ directory: conversationDirectory })
    const reopenedEvents = new ExecutionEventStore({ directory: eventDirectory, inlineBytes: 100 })
    const persisted = await reopenedConversations.readConversation({ workspaceId: 'space', conversationId: 'history' })
    expect(persisted?.messages.map(message => message.role)).toEqual(['user', 'tool', 'assistant'])
    expect((await reopenedEvents.readPage({ conversationId: 'history' })).events).toHaveLength(3)
    const adapter = historyAPI(reopenedConversations, reopenedEvents)
    const view = render(<ExecutionAssistant root={workspace.rootPath} api={adapter.api}
      captureDocuments={async () => []} prepareSend={async () => true} />)
    const reply = await screen.findByRole('article', { name: '回复' })
    fireEvent.click(within(reply).getByRole('button', { name: /读取完整内容/ }))
    await waitFor(() => expect(reply).toHaveTextContent(script))
    const user = screen.getByRole('article', { name: '用户消息' })
    expect(user).toHaveTextContent(script)
    const tool = screen.getByRole('article', { name: '工具执行' })
    const details = tool.querySelector('details')!
    act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
    expect(within(tool).getByText(command, { exact: false })).toBeInTheDocument()
    const output = tool.querySelector<HTMLElement>('[aria-label="工具输出"]')!
    fireEvent.click(within(output).getByRole('button', { name: /读取完整内容/ }))
    await waitFor(() => expect(output).toHaveTextContent('曾经的工具输出'))
    expect(output).toHaveTextContent(script)
    fireEvent.click(view.container.querySelector('.execution-assistant__more > summary')!)
    fireEvent.click(screen.getByRole('button', { name: '搜索历史' }))
    fireEvent.change(screen.getByRole('textbox', { name: '历史关键词' }), { target: { value: command } })
    fireEvent.click(screen.getByRole('button', { name: '搜索全部历史' }))
    await screen.findByText(/本页找到 1 条历史事件/)
    assertHistoryIsTextOnly(view.container.querySelector('.execution-assistant__history')!)
    expect(adapter.send).not.toHaveBeenCalled()
    expect(adapter.stop).not.toHaveBeenCalled()
    expect(adapter.mutation).not.toHaveBeenCalled()
    expect((await reopenedEvents.snapshot('history')).cursor).toBe(3)
    return view
  }

  const first = await openPersistedHistory()
  native.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
  native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(root, 'diagnostics.txt') })
  expect(await exportDiagnosticReport({} as never)).toEqual({ path: path.join(root, 'diagnostics.txt') })
  expect(native.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    message: expect.stringContaining('默认不包含文档正文、对话或图片'), checkboxChecked: false,
  }))
  expect(native.showOpenDialog).not.toHaveBeenCalled()
  const report = await fs.readFile(path.join(root, 'diagnostics.txt'), 'utf8')
  expect(report).toContain('未自动附加用户文档、对话、图片或登录凭据')
  expect(report).not.toContain(script)
  expect(report).not.toContain(command)
  first.unmount()
  const second = await openPersistedHistory()
  second.unmount()
})
