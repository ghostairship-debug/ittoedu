import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant, documentsForPermission } from '../../src/renderer/workbench/ExecutionAssistant'
import type { ConversationRecord, WorkspaceRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionDesktopAPI, ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import { emptyExecutionProjection } from '../../src/shared/workbench/executionEvents'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const workspace: WorkspaceRecord = { workspaceId: 'workspace', rootPath: 'C:/workspace', managed: false,
  authorization: 'user-selected', revision: 1, createdAt: 1, updatedAt: 1 }
const instance = { kind: 'course-instance' as const, surfaceId: 'surface-a', instanceId: 'text-a', stateId: null,
  dataPath: ['authoringRecords', 'author-a', 'overrides', 'text'], from: 2, to: 6 }
const reference: ExecutionDocumentReference = { documentId: 'doc', epoch: 'epoch', revision: 3,
  writable: [instance], selection: [instance] }
const settings: ExecutionSettingsView = { secureStorageAvailable: true, modelFavorites: [],
  connections: [{ connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'https://fixture.invalid/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private' },
    billing: { kind: 'token-plan' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
  hasCredential: true, revoked: false }],
  profile: { revision: 1, updatedAt: '2026-10-08T00:00:00.000Z', roles: {
    conversation: { connectionId: 'connection', model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } } }

function fixture(writeScope: ConversationRecord['frozenContextRefs'][number]['writeScope'] = reference.writable, connectionFault = false) {
  let conversation: ConversationRecord = { conversationId: 'conversation', workspaceId: workspace.workspaceId, title: '恢复局部任务',
    messages: [], attachmentIds: [], runIndex: { builtinRunIds: ['run'], externalRunIds: [], externalPortIds: [] },
    inputDraft: '继续修改所选正文', inputAttachments: [], revision: 1, createdAt: 1, updatedAt: 1,
    frozenContextRefs: [{ contextRefId: 'ref', documentId: reference.documentId, epoch: reference.epoch,
      revision: reference.revision, writeScope, selection: reference.selection }] }
  const run: ExecutionRunRecord = { schemaVersion: 1, runId: 'run', version: 1, input: { conversationId: conversation.conversationId,
    taskId: 'task', instruction: conversation.inputDraft, documents: [{ documentId: reference.documentId, writable: reference.writable,
      selection: reference.selection }], selection: { connection: settings.connections[0]!.connection, model: 'fixture-model' } },
    status: 'partial', createdAt: 1, updatedAt: 1, messages: [], initialMessageCount: 0, tools: [],
    requests: connectionFault ? [{ requestId: 'request', state: 'failed', failure: {
      outcome: 'unknown', kind: 'transport', code: 'response-incomplete', message: 'connection interrupted' } }] : [] }
  const submission = { submissionId: 'original-submission', workspaceId: workspace.workspaceId,
    conversationId: conversation.conversationId, state: 'accepted' as const, mode: 'queue' as const,
    text: conversation.inputDraft, documents: [reference], attachments: [], runId: run.runId,
    model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' }, createdAt: 1, updatedAt: 1 }
  const api = {
    workspace: vi.fn(async () => ({ workspace, conversations: [structuredClone(conversation)] })),
    conversations: vi.fn(async () => [structuredClone(conversation)]),
    conversation: vi.fn(async () => structuredClone(conversation)),
    draft: vi.fn(async (input: Parameters<ExecutionDesktopAPI['draft']>[0]) => {
      conversation = { ...conversation, revision: conversation.revision + 1, inputDraft: input.text,
        inputAttachments: input.attachments ?? [], frozenContextRefs: input.documents.map(document => ({
          contextRefId: document.documentId, documentId: document.documentId, epoch: document.epoch, revision: document.revision,
          writeScope: document.writable, ...(document.selection ? { selection: document.selection } : {}) })) }
      return structuredClone(conversation)
    }),
    send: vi.fn(async (input: Parameters<ExecutionDesktopAPI['send']>[0]) => ({ run,
      conversation: { ...conversation, revision: conversation.revision + 1, inputDraft: '', inputAttachments: [] },
      submission: { ...submission, submissionId: input.submissionId, text: input.text, documents: input.documents } })),
    submissions: vi.fn(async () => [submission]), run: vi.fn(async () => run),
    events: vi.fn(async () => ({ events: [], cursor: 0, hasMore: false })),
    timeline: vi.fn(async () => emptyExecutionProjection(conversation.conversationId)), edits: vi.fn(async () => []),
    subscribe: vi.fn(() => () => {}), subscribeEdits: vi.fn(() => () => {}),
  } as unknown as ExecutionDesktopAPI
  const settingsAPI = { read: vi.fn(async () => settings), knownModels: vi.fn(async () => []),
    discoverModels: vi.fn(async () => ({ connectionId: 'connection', connectionRevision: 1, models: [],
      capabilitiesVerified: false, source: 'live', checkedAt: '2026-10-08T00:00:00.000Z' })) } as unknown as ExecutionSettingsAPI
  const captureDocuments = vi.fn(async () => []), prepareSend = vi.fn(async () => true)
  render(createElement(ExecutionAssistant, { root: workspace.rootPath, api, settingsAPI, captureDocuments, prepareSend }))
  return { api, captureDocuments, prepareSend }
}

it('sends a normal continuation of a partial task with its frozen V10 selection and grant', async () => {
  const { api, captureDocuments, prepareSend } = fixture()
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('继续修改所选正文'))
  expect(screen.queryByRole('button', { name: '连接恢复后继续此任务' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0]![0]).toMatchObject({ documents: [reference] })
  expect(captureDocuments).not.toHaveBeenCalled()
  expect(prepareSend).toHaveBeenCalledWith(['doc'])
})

it('continues a connection failure with the original V10 selection instead of treating restored scope as a new draft', async () => {
  const { api } = fixture(reference.writable, true)
  fireEvent.click(await screen.findByRole('button', { name: '连接恢复后继续此任务' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0]![0]).toMatchObject({ documents: [reference], retryOfRunId: 'run' })
  expect(screen.queryByText(/输入框已有新的文字、附件或文档引用/)).toBeNull()
})

it('keeps a filtered unsupported recovery grant empty on send rather than granting the document', async () => {
  const { api } = fixture([{ kind: 'course-asset', assetId: 'image' }])
  await waitFor(() => expect(screen.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue('继续修改所选正文'))
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.send).mock.calls[0]![0].documents).toEqual([{ ...reference, writable: [] }])
})

it('preserves surface grants and empty grants at each permission level', () => {
  const surface: ExecutionDocumentReference = { ...reference, writable: [{ kind: 'course-surface', surfaceId: 'surface-a' }] }
  expect(documentsForPermission([surface], 'workspace')).toEqual([surface])
  expect(documentsForPermission([{ ...reference, writable: [] }], 'workspace')).toEqual([{ ...reference, writable: [] }])
  expect(documentsForPermission([reference], 'read-only')).toEqual([{ ...reference, writable: [] }])
})
