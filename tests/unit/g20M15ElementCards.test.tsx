import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectionQuickBar } from '../../src/renderer/editing/quickbar/SelectionQuickBar'
import { ElementAiButton } from '../../src/renderer/workbench/elementCards/ElementAiCard'
import { ElementCardIndicator } from '../../src/renderer/workbench/elementCards/ElementCardIndicator'
import { ElementCardController, elementCardKey, elementCards, type ElementCardView } from '../../src/renderer/workbench/elementCards/elementCardController'
import type { SelectionCapture } from '../../src/renderer/workbench/SelectionContextController'
import type { ConversationElementScope, ConversationRecord } from '../../src/shared/workbench/conversations'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ElementChangeView, ElementRevertResult, ExecutionDesktopAPI, ExecutionSelectionTarget, ExecutionSendInput, ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import { USER_QUESTION_TOOL } from '../../src/shared/workbench/userQuestion'

// M15: every object has its own AI card. A card's AI may change only its object; requests to one object queue.
afterEach(() => { cleanup() })

const target = (itemId: string): ExecutionSelectionTarget => ({ kind: 'course-object', locationId: 'location', itemId })
const capture = (itemId: string): SelectionCapture => ({ documentId: 'doc', epoch: 'epoch', revision: 3, targets: [target(itemId)], label: '所选 1 个对象' })

function executionFixture() {
  const conversations = new Map<string, ConversationRecord>()
  const submissions: ExecutionSubmissionRecord[] = []
  const runs = new Map<string, ExecutionRunRecord>()
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const timeline: ExecutionEvent[] = []
  const control = { next: 'accepted' as 'accepted' | 'queued' }
  const changes = new Map<string, ElementChangeView>()
  const reverts: ElementRevertResult[] = []
  let count = 0
  const run = (conversationId: string, runId: string): ExecutionRunRecord => ({
    schemaVersion: 1, runId, version: 1, input: { conversationId, taskId: 'task', instruction: 'instruction',
      selection: { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
        auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'model' }, documents: [] },
    budget: { maxRequests: 1, maxToolCalls: 1, maxContextBytes: 100 }, status: 'running', createdAt: 1, updatedAt: 1,
    messages: [], initialMessageCount: 0, requests: [], tools: [],
  })
  const api = {
    createConversation: vi.fn(async (workspaceId: string, title = '新会话', _home?: unknown, element?: ConversationElementScope) => {
      const created: ConversationRecord = { conversationId: `c${++count}`, workspaceId, title, messages: [], attachmentIds: [],
        runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [],
        revision: 1, createdAt: 1, updatedAt: 1, ...(element ? { element } : {}) }
      conversations.set(created.conversationId, created)
      return structuredClone(created)
    }),
    conversation: vi.fn(async (_workspaceId: string, id: string) => structuredClone(conversations.get(id) ?? null)),
    send: vi.fn(async (input: ExecutionSendInput) => {
      const current = conversations.get(input.conversationId)!
      const saved = { ...current, revision: current.revision + 1 }
      conversations.set(saved.conversationId, saved)
      const runId = control.next === 'accepted' ? `run-${submissions.length + 1}` : undefined
      const submission: ExecutionSubmissionRecord = { submissionId: input.submissionId, workspaceId: input.workspaceId, conversationId: input.conversationId,
        state: control.next, mode: input.mode ?? 'queue', text: input.text, documents: input.documents, attachments: [],
        model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' }, createdAt: 2, updatedAt: 2, ...(runId ? { runId } : {}) }
      submissions.push(submission)
      if (runId) runs.set(runId, run(input.conversationId, runId))
      return { submission: structuredClone(submission), conversation: structuredClone(saved), ...(runId ? { run: structuredClone(runs.get(runId)!) } : {}) }
    }),
    submissions: vi.fn(async () => structuredClone(submissions)),
    run: vi.fn(async (runId: string) => structuredClone(runs.get(runId) ?? null)),
    stop: vi.fn(async () => null),
    events: vi.fn(async (_conversationId: string, after = 0) => {
      const events = timeline.filter(event => event.sequence > after)
      return { events, cursor: events.at(-1)?.sequence ?? after, hasMore: false }
    }),
    answer: vi.fn(async () => ({ runId: 'run-1' })),
    deleteConversation: vi.fn(async (input: { conversationId: string }) => { conversations.delete(input.conversationId) }),
    elementChange: vi.fn(async (submissionId: string): Promise<ElementChangeView> => changes.get(submissionId) ?? { submissionId, state: 'pending', fields: [] }),
    revertElement: vi.fn(async (_input: { submissionId: string; direction: 'undo' | 'redo'; force?: boolean }): Promise<ElementRevertResult> => reverts.shift()!),
    subscribe: vi.fn((listener: (event: ExecutionEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
  }
  /** The run of the first request asks the teacher a question. */
  const ask = (conversationId: string) => {
    const base = { conversationId, taskId: 'task', runId: 'run-1', time: 1, source: 'builtin' as const }
    const question = { text: '改成哪种红？', multiple: false, options: [{ label: '正红' }, { label: '暗红' }] }
    timeline.push(
      { ...base, eventId: 'e1', itemId: 'run-state', sequence: 1, type: 'run.state', update: 'snapshot', data: { status: 'waiting', label: '等待你的选择' } },
      { ...base, eventId: 'e2', itemId: 'request:0', sequence: 2, type: 'tool', update: 'snapshot', data: { toolName: USER_QUESTION_TOOL, label: '向你提问', status: 'waiting', question, text: question.text } },
    )
    for (const listener of listeners) listener(timeline.at(-1)!)
  }
  /** The run of a request ends; Main has recorded what it changed on the object. */
  const finish = (conversationId: string, runId: string, change: Omit<ElementChangeView, 'submissionId'>) => {
    const submission = submissions.find(value => value.runId === runId)!
    runs.set(runId, { ...runs.get(runId)!, status: 'completed' })
    changes.set(submission.submissionId, { submissionId: submission.submissionId, ...change })
    const base = { conversationId, taskId: 'task', runId, time: 1, source: 'builtin' as const }
    timeline.push({ ...base, eventId: `end-${runId}`, itemId: 'run-end', sequence: timeline.length + 1, type: 'run.end', update: 'snapshot', data: { status: 'completed' } })
    for (const listener of listeners) listener(timeline.at(-1)!)
    return submission.submissionId
  }
  return { api, control, ask, finish, reverts, submissions, execution: api as unknown as ExecutionDesktopAPI }
}

const settings = (): ExecutionSettingsAPI => ({
  read: vi.fn(async (): Promise<ExecutionSettingsView> => ({ secureStorageAvailable: true,
    connections: [{ connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false }],
    profile: { revision: 1, updatedAt: '2026-09-26T00:00:00.000Z', roles: { conversation: { connectionId: 'connection', model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } } })),
  probeCapabilities: vi.fn(async () => { throw new Error('unused') }), saveConnection: vi.fn(async () => { throw new Error('unused') }),
  saveProfile: vi.fn(async () => { throw new Error('unused') }), revokeConnection: vi.fn(async () => {}),
  discoverModels: vi.fn(async () => { throw new Error('unused') }), startOAuthLogin: vi.fn(async () => { throw new Error('unused') }),
  oauthLoginStatus: vi.fn(async () => { throw new Error('unused') }), cancelOAuthLogin: vi.fn(async () => {}),
})

function documentsFixture() {
  const listeners = new Set<(event: { type: 'closed'; documentId: string }) => void>()
  const documents = { subscribe: vi.fn((listener: (event: { type: 'closed'; documentId: string }) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }) }
  return { documents: documents as unknown as Pick<DocumentHostAPI, 'subscribe'>, close: (documentId: string) => { for (const listener of listeners) listener({ type: 'closed', documentId }) } }
}

it('M15 a card sends only its object as writable, queues behind a busy request, asks inside the card and ends with its document', async () => {
  const f = executionFixture(), d = documentsFixture()
  const cards = new ElementCardController({ execution: () => f.execution, settings: () => settings(), documents: () => d.documents })
  cards.setWorkspace('workspace')
  const key = cards.ensure({ documentId: 'doc', target: target('a'), label: '标题' })
  expect(key).toBe(elementCardKey('doc', target('a')))
  expect(cards.view(key)).toMatchObject({ label: '标题', entries: [], busy: false })

  await cards.send(key, ' 改成红色 ', capture('a'))
  expect(f.api.createConversation).toHaveBeenCalledWith('workspace', '标题', undefined, { kind: 'element', documentId: 'doc', label: '标题' })
  expect(f.api.send.mock.calls[0]![0]).toMatchObject({ workspaceId: 'workspace', conversationId: 'c1', text: '改成红色', mode: 'queue', permission: 'workspace',
    documents: [{ documentId: 'doc', epoch: 'epoch', revision: 3, selection: [target('a')], writable: [target('a')] }] })
  expect(cards.view(key)!.entries).toMatchObject([{ text: '改成红色', state: 'running', runId: 'run-1' }])

  // A second request to the same object waits in the same conversation.
  f.control.next = 'queued'
  await cards.send(key, '再大一点', capture('a'))
  expect(f.api.createConversation).toHaveBeenCalledTimes(1)
  expect(f.api.send.mock.calls[1]![0]).toMatchObject({ conversationId: 'c1', mode: 'queue' })
  expect(cards.view(key)!.entries.map(entry => entry.state)).toEqual(['running', 'queued'])
  expect(cards.active().map(card => card.key)).toEqual([key])

  // The run's question reaches the card; the answer goes back to that run.
  f.ask('c1')
  await waitFor(() => expect(cards.view(key)!.question).toMatchObject({ runId: 'run-1', callId: 'request:0' }))
  await cards.answer(key, 'run-1', 'request:0', { choices: [0] })
  expect(f.api.answer).toHaveBeenCalledWith({ runId: 'run-1', callId: 'request:0', answer: { choices: [0] } })

  // Another object is not this card's; in read-only mode nothing is writable.
  await expect(cards.send(key, '改它', capture('b'))).rejects.toThrow('选中的对象已改变')
  cards.setPermission('read-only')
  await cards.send(key, '这是什么颜色？', capture('a'))
  expect(f.api.send.mock.calls.at(-1)![0]).toMatchObject({ permission: 'read-only', documents: [{ selection: [target('a')], writable: [] }] })

  // Closing the document ends its cards.
  d.close('doc')
  expect(cards.view(key)).toBeNull()
  expect(cards.active()).toEqual([])
})

it('M15 the quick bar opens the card, the top bar shows cards at work and jumps back to them, and a deleted object hides its card', async () => {
  const f = executionFixture(), d = documentsFixture()
  window.desktopAPI = { execution: f.execution, executionSettings: settings(), documents: d.documents } as unknown as typeof window.desktopAPI
  elementCards.setWorkspace('workspace')
  const existing = new Set(['a'])
  const jump = vi.fn((card: ElementCardView) => elementCards.requestOpen(card.key))
  const view = () => <>
    <ElementCardIndicator documentId="doc" navigation={{ exists: card => card.target.kind === 'course-object' && existing.has(card.target.itemId), jump }} />
    <SelectionQuickBar label="选中对象快捷工具" anchor={{ left: 100, top: 200, width: 120, height: 40 }} bounds={{ left: 0, top: 0, right: 1000, bottom: 800 }} selectionKey="doc:a">
      <ElementAiButton documentId="doc" target={target('a')} label="标题" capture={async () => capture('a')} />
    </SelectionQuickBar>
  </>
  try {
    const { rerender } = render(view())
    expect(screen.queryByRole('button', { name: /AI 进行中|AI 需回答/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    const card = screen.getByRole('dialog', { name: 'AI 修改：标题' })
    expect(card).toHaveTextContent('这里的 AI 只改这一个对象')
    const input = within(card).getByRole('textbox', { name: 'AI 修改要求' })
    fireEvent.change(input, { target: { value: '改成红色' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(within(card).getByRole('list', { name: '修改记录' })).toHaveTextContent('改成红色进行中…'))
    expect(f.api.send.mock.calls[0]![0].documents[0]!.writable).toEqual([target('a')])
    expect(screen.getByRole('button', { name: 'AI 修改' })).toHaveTextContent('AI 进行中')
    expect(screen.getByRole('button', { name: 'AI 进行中 1' })).toBeInTheDocument()

    // The run asks; the top bar says so and the card answers it.
    act(() => f.ask('c1'))
    await screen.findByRole('button', { name: 'AI 需回答 1' })
    const question = await within(card).findByRole('region', { name: 'AI 的提问' })
    fireEvent.click(within(question).getByRole('button', { name: '暗红' }))
    await waitFor(() => expect(f.api.answer).toHaveBeenCalledWith({ runId: 'run-1', callId: 'request:0', answer: { choices: [1] } }))

    // Closed, the card comes back from the top bar with its record.
    fireEvent.click(within(card).getByRole('button', { name: '收起 AI 卡' }))
    expect(screen.queryByRole('dialog', { name: 'AI 修改：标题' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'AI 需回答 1' }))
    fireEvent.click(within(screen.getByRole('menu', { name: '元素 AI 卡' })).getByRole('menuitem', { name: '标题：需回答' }))
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ key: elementCardKey('doc', target('a')) }))
    expect(await screen.findByRole('dialog', { name: 'AI 修改：标题' })).toHaveTextContent('改成红色')

    // A deleted object's card is hidden from the top bar; undoing the deletion brings it back.
    existing.delete('a'); rerender(view())
    expect(screen.queryByRole('button', { name: /AI 需回答/ })).toBeNull()
    existing.add('a'); rerender(view())
    expect(screen.getByRole('button', { name: 'AI 需回答 1' })).toBeInTheDocument()
  } finally {
    act(() => d.close('doc'))
    window.desktopAPI = undefined as unknown as typeof window.desktopAPI
  }
})

it('M15 the card undoes and redoes its latest request, and asks before overwriting fields changed again since', async () => {
  const f = executionFixture(), d = documentsFixture()
  window.desktopAPI = { execution: f.execution, executionSettings: settings(), documents: d.documents } as unknown as typeof window.desktopAPI
  elementCards.setWorkspace('workspace')
  try {
    render(<SelectionQuickBar label="选中对象快捷工具" anchor={{ left: 100, top: 200, width: 120, height: 40 }} bounds={{ left: 0, top: 0, right: 1000, bottom: 800 }} selectionKey="doc:a">
      <ElementAiButton documentId="doc" target={target('a')} label="标题" capture={async () => capture('a')} />
    </SelectionQuickBar>)
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    const card = screen.getByRole('dialog', { name: 'AI 修改：标题' })
    const undo = within(card).getByRole('button', { name: '撤销这张卡的 AI 修改' }), redo = within(card).getByRole('button', { name: '重做这张卡的 AI 修改' })
    expect(undo).toBeDisabled(); expect(redo).toBeDisabled()
    fireEvent.change(within(card).getByRole('textbox', { name: 'AI 修改要求' }), { target: { value: '改成红色' } })
    fireEvent.click(within(card).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(f.api.send).toHaveBeenCalledTimes(1))

    let submissionId = ''
    act(() => { submissionId = f.finish('c1', 'run-1', { state: 'applied', fields: ['文字颜色'] }) })
    await waitFor(() => expect(undo).toBeEnabled())
    expect(undo).toHaveAttribute('title', '撤销 AI 对文字颜色的修改')
    expect(within(card).getByRole('list', { name: '修改记录' })).toHaveTextContent('改成红色已完成')

    // The colour was changed again by hand: the card asks first and overwrites only when confirmed.
    f.reverts.push({ status: 'conflict', fields: ['文字颜色'] }, { status: 'applied', change: { submissionId, state: 'undone', fields: ['文字颜色'] } })
    fireEvent.click(undo)
    const confirm = await within(card).findByRole('alertdialog', { name: '确认撤销' })
    expect(confirm).toHaveTextContent('文字颜色在 AI 修改后又改过')
    fireEvent.click(within(confirm).getByRole('button', { name: '仍要撤销' }))
    await waitFor(() => expect(redo).toBeEnabled())
    expect(f.api.revertElement.mock.calls.map(call => call[0])).toEqual([{ submissionId, direction: 'undo' }, { submissionId, direction: 'undo', force: true }])
    expect(undo).toBeDisabled()
    expect(within(card).queryByRole('alertdialog')).toBeNull()

    f.reverts.push({ status: 'applied', change: { submissionId, state: 'applied', fields: ['文字颜色'] } })
    fireEvent.click(redo)
    await waitFor(() => expect(undo).toBeEnabled())
    expect(redo).toBeDisabled()
    expect(f.api.revertElement).toHaveBeenLastCalledWith({ submissionId, direction: 'redo' })
  } finally {
    act(() => d.close('doc'))
    window.desktopAPI = undefined as unknown as typeof window.desktopAPI
  }
})

it('M15 a text card sends to where its text is now, waits for the previous request, and ends when closed', async () => {
  const f = executionFixture(), d = documentsFixture()
  let source = '# 标题\n\n**加粗**文字\n', revision = 1
  const snapshot = async () => ({ documentId: 'doc', epoch: 'epoch', revision, model: { kind: 'markdown', source, resources: { attachments: [] } } }) as unknown as DocumentSnapshot
  const cards = new ElementCardController({ execution: () => f.execution, settings: () => settings(), documents: () => d.documents, snapshot })
  cards.setWorkspace('workspace')
  const first = { kind: 'markdown-range' as const, from: 8, to: 10 }
  const key = cards.openText({ documentId: 'doc', target: first, label: '“加粗”', anchor: { left: 10, top: 20 }, content: '加粗' })
  expect(cards.texts()).toMatchObject([{ key, kind: 'text', anchor: { left: 10, top: 20 }, textLost: null }])
  expect(cards.active()).toEqual([])

  await cards.send(key, '换个说法', undefined)
  expect(f.api.createConversation).toHaveBeenCalledWith('workspace', '“加粗”', undefined, { kind: 'element', documentId: 'doc', label: '“加粗”' })
  expect(f.api.send.mock.calls[0]![0].documents).toEqual([{ documentId: 'doc', epoch: 'epoch', revision: 1, selection: [first], writable: [first] }])
  // A follow-up waits until the AI has changed the text.
  await expect(cards.send(key, '再短一点', undefined)).rejects.toThrow('请等 AI 改完这一次再继续追问')

  // The request ends; Main says where the text is now, and the next request goes there.
  source = '# 标题\n\n**更粗的**文字\n'; revision = 2
  const moved = { kind: 'markdown-range' as const, from: 8, to: 11 }
  f.finish('c1', 'run-1', { state: 'applied', fields: ['文字'], target: moved, content: '更粗的' })
  await waitFor(() => expect(cards.view(key)).toMatchObject({ busy: false, target: moved }))
  await cards.send(key, '再短一点', undefined)
  expect(f.api.send.mock.calls[1]![0].documents).toEqual([{ documentId: 'doc', epoch: 'epoch', revision: 2, selection: [moved], writable: [moved] }])
  f.finish('c1', 'run-2', { state: 'applied', fields: ['文字'], target: moved, content: '更粗的' })
  await waitFor(() => expect(cards.view(key)!.busy).toBe(false))

  // Someone rewrote that text: the card does not guess.
  source = '# 标题\n\n**别的**文字\n'; revision = 3
  await expect(cards.send(key, '还原', undefined)).rejects.toThrow('这段文字已被改动')
  // Closing ends the card and its conversation; the document keeps the changes.
  await cards.closeText(key)
  expect(cards.texts()).toEqual([])
  expect(f.api.deleteConversation).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', conversationId: 'c1' }))
})
