import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElementCardController } from '../../src/renderer/workbench/elementCards/elementCardController'
import type { SelectionCapture } from '../../src/renderer/workbench/SelectionContextController'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ElementChangeView, ExecutionDesktopAPI, ExecutionSendInput, ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

// Flush the controller's awaited API boundaries without advancing its retry timer.
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve() }

async function cardFixture() {
  const target = { kind: 'course-instance' as const, surfaceId: 'surface', instanceId: 'title' }
  const captured: SelectionCapture = { documentId: 'doc', epoch: 'epoch', revision: 1, targets: [target], label: '标题' }
  const conversation: ConversationRecord = { conversationId: 'conversation', workspaceId: 'workspace', title: '标题',
    messages: [], attachmentIds: [], runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] },
    inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 1, createdAt: 1, updatedAt: 1 }
  let submission: ExecutionSubmissionRecord
  let status: ExecutionRunRecord['status'] = 'running'
  const listeners = new Set<(event: ExecutionEvent) => void>()
  const run = () => ({ runId: 'run', status } as ExecutionRunRecord)
  const elementChange = vi.fn(async (submissionId: string): Promise<ElementChangeView> => ({ submissionId, state: 'pending', fields: [] }))
  const api = {
    createConversation: vi.fn(async () => structuredClone(conversation)),
    conversation: vi.fn(async () => structuredClone(conversation)),
    send: vi.fn(async (input: ExecutionSendInput) => {
      submission = { submissionId: input.submissionId, workspaceId: input.workspaceId, conversationId: input.conversationId,
        runId: 'run', state: 'accepted', mode: 'queue', text: input.text, documents: input.documents, attachments: [],
        model: { provider: 'fixture', model: 'fixture', accountId: 'account', billing: 'token-plan' }, createdAt: 1, updatedAt: 1 }
      return { submission: structuredClone(submission), conversation: structuredClone(conversation), run: run() }
    }),
    submissions: vi.fn(async () => [structuredClone(submission)]),
    run: vi.fn(async () => run()),
    events: vi.fn(async () => ({ events: [], cursor: 0, hasMore: false })),
    elementChange,
    subscribe: (listener: (event: ExecutionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const settings = { read: async () => ({
    connections: [{ connection: { id: 'connection', revision: 1, provider: 'fixture', billing: { kind: 'token-plan' } }, hasCredential: true }],
    profile: { revision: 1, roles: { conversation: { connectionId: 'connection', model: 'fixture' } } },
  }) } as unknown as ExecutionSettingsAPI
  const cards = new ElementCardController({ execution: () => api as unknown as ExecutionDesktopAPI, settings: () => settings })
  cards.setWorkspace('workspace')
  const key = cards.ensure({ documentId: 'doc', target, label: '标题' })
  await cards.send(key, '修改标题', captured)
  function finish() {
    status = 'completed'
    const event: ExecutionEvent = { eventId: 'end', itemId: 'end', sequence: 1, type: 'run.end', update: 'snapshot',
      conversationId: conversation.conversationId, taskId: 'task', runId: 'run', source: 'builtin', time: 1, data: { status } }
    listeners.forEach(listener => listener(event))
  }
  return { cards, key, api, finish }
}

it('retains a completed task after its delayed change read fails and retries without sending it again', async () => {
  const { cards, key, api, finish } = await cardFixture()
  // Main initially records pending, then the follow-up read fails.
  api.elementChange.mockImplementationOnce(async submissionId => ({ submissionId, state: 'pending', fields: [] }))
    .mockRejectedValueOnce(new Error('delayed change read unavailable'))
  finish()
  await settle()
  expect(cards.view(key)).toMatchObject({ busy: false, refreshError: '', entries: [{ state: 'completed', change: { state: 'pending' } }] })
  await vi.advanceTimersByTimeAsync(150)
  expect(cards.view(key)).toMatchObject({ busy: false, refreshError: expect.stringContaining('修改结果暂不可读取'), undo: null })
  cards.dismiss(key)
  expect(cards.view(key)?.dismissed).toBe(true)
  cards.reveal(key)
  api.elementChange.mockImplementation(async submissionId => ({ submissionId, state: 'applied', fields: ['文字'] }))
  cards.retryRefresh(key)
  await settle()
  expect(cards.view(key)).toMatchObject({ busy: false, dismissed: false, refreshError: '', undo: { fields: ['文字'] } })
  expect(api.send).toHaveBeenCalledTimes(1)
  cards.forgetDocument('doc')
})

it('does not let an older delayed query failure replace a newer successful refresh', async () => {
  const { cards, key, api, finish } = await cardFixture()
  let reject!: (reason: Error) => void
  api.elementChange.mockImplementationOnce(async submissionId => ({ submissionId, state: 'pending', fields: [] }))
    .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  finish()
  await settle()
  await vi.advanceTimersByTimeAsync(150)
  api.elementChange.mockImplementation(async submissionId => ({ submissionId, state: 'applied', fields: ['文字'] }))
  cards.retryRefresh(key)
  await settle()
  expect(cards.view(key)).toMatchObject({ refreshError: '', undo: { fields: ['文字'] } })
  reject(new Error('older query failed'))
  await settle()
  expect(cards.view(key)).toMatchObject({ refreshError: '', undo: { fields: ['文字'] } })
  cards.forgetDocument('doc')
})

it('does not query an ended card again after its document closes', async () => {
  const { cards, key, api, finish } = await cardFixture()
  finish()
  await settle()
  expect(api.elementChange).toHaveBeenCalledTimes(1)
  cards.forgetDocument('doc')
  await vi.advanceTimersByTimeAsync(150)
  expect(cards.view(key)).toBeNull()
  expect(api.elementChange).toHaveBeenCalledTimes(1)
})
