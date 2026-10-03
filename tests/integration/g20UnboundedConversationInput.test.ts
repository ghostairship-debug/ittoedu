// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionSubmissionStore, type StoredExecutionSubmission } from '../../src/main/workbench/execution/ExecutionSubmissionStore'
import { executionDesktopRequestSchema } from '../../src/shared/workbench/executionDesktop'
import { validConversationElement, validHomePath } from '../../src/shared/workbench/conversations'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
const selection: ModelSelection = { model: 'local-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' },
} }
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-unbounded-input-')); roots.push(directory)
  const store = new ConversationStore({ directory: path.join(directory, 'conversations') })
  const workspace = await store.registerWorkspace({ workspaceId: 'fixture-space', rootPath: directory, managed: false, authorization: 'user-selected' })
  return { directory, store, workspace }
}

it('accepts large conversation input and preserves it through conversation and queue reopening', async () => {
  const { directory, store, workspace } = await fixture()
  const text = 'x'.repeat(1024 * 1024 + 1), title = 't'.repeat(1025), label = 'l'.repeat(201)
  const homePath = Array.from({ length: 120 }, (_, index) => `folder-${index}`).join('/')
  const identity = { workspaceId: workspace.workspaceId, conversationId: 'large-input-conversation' }
  const scope = { kind: 'markdown-range' as const, from: 0, to: 1 }
  const documents = Array.from({ length: 101 }, (_, index) => ({ documentId: `document-${index}`, epoch: 'epoch', revision: 0,
    writable: Array.from({ length: 101 }, () => scope), selection: Array.from({ length: 101 }, () => scope) }))
  const attachments = Array.from({ length: 1001 }, () => ({ attachmentId: randomUUID(), representationId: 'original-text' }))
  const conversation = await store.createConversation({ ...identity, title, inputDraft: text,
    home: { kind: 'folder', path: homePath }, element: { kind: 'element', documentId: 'document-0', label } })
  expect(executionDesktopRequestSchema.parse({ type: 'create-conversation', workspaceId: identity.workspaceId, title,
    element: conversation.element })).toMatchObject({ title, element: { label } })
  const draft = executionDesktopRequestSchema.parse({ type: 'draft', ...identity, expectedRevision: conversation.revision,
    text, documents, attachments })
  if (draft.type !== 'draft') throw new Error('Wrong request type')
  const saved = await store.updateConversation({ ...identity, expectedRevision: draft.expectedRevision, patch: {
    inputDraft: draft.text, inputAttachments: draft.attachments,
    frozenContextRefs: draft.documents.map(document => ({ contextRefId: document.documentId, ...document, writeScope: document.writable })),
    messages: [{ messageId: randomUUID(), role: 'user', text, createdAt: 1, attachmentIds: attachments.map(ref => ref.attachmentId) }],
  } })
  const reopened = await new ConversationStore({ directory: path.join(directory, 'conversations') }).readConversation(identity)
  expect(reopened).toEqual(saved)
  expect(reopened?.inputDraft.length).toBeGreaterThan(1024 * 1024)
  expect(reopened?.inputAttachments).toHaveLength(1001)
  expect(reopened?.frozenContextRefs).toHaveLength(101)
  expect(reopened?.messages[0]?.text).toBe(text)
  expect(validConversationElement(reopened?.element)).toBe(true)
  expect(validHomePath(homePath)).toBe(true)
  expect(executionDesktopRequestSchema.parse({ type: 'fork-checkpoint', ...identity, runId: 'previous-run', instruction: text }))
    .toMatchObject({ instruction: text })
  const submissionId = randomUUID()
  const send = executionDesktopRequestSchema.parse({ type: 'send', ...identity, submissionId, expectedRevision: saved.revision,
    text, documents, attachments })
  if (send.type !== 'send') throw new Error('Wrong request type')
  const queued: StoredExecutionSubmission = { schemaVersion: 1, ...identity, submissionId, state: 'queued', mode: 'queue', text,
    documents: send.documents, attachments: send.attachments, attachmentIds: attachments.map(ref => ref.attachmentId),
    model: { provider: 'fixture', model: 'local-fixture', accountId: 'fixture', billing: 'unknown' }, createdAt: 1, updatedAt: 1,
    digest: createHash('sha256').update(JSON.stringify(send)).digest('hex'),
    start: { conversationId: identity.conversationId, taskId: submissionId, instruction: text, selection,
      documents: documents.map(({ documentId, writable, selection }) => ({ documentId, writable, selection })) },
  }
  const queueDirectory = path.join(directory, 'queue')
  await new ExecutionSubmissionStore(queueDirectory).create(queued)
  expect(await new ExecutionSubmissionStore(queueDirectory).read(submissionId)).toEqual(queued)
})

it('still rejects malformed inputs, invalid relative paths and stale conversation revisions', async () => {
  const { store, workspace } = await fixture()
  const conversation = await store.createConversation({ workspaceId: workspace.workspaceId, inputDraft: 'original' })
  const identity = { workspaceId: workspace.workspaceId, conversationId: conversation.conversationId }
  expect(executionDesktopRequestSchema.safeParse({ type: 'draft', ...identity, expectedRevision: 1, text: 123, documents: [], attachments: [] }).success).toBe(false)
  expect(executionDesktopRequestSchema.safeParse({ type: 'send', ...identity, expectedRevision: 1, submissionId: 'invalid', text: 'hello', documents: [], attachments: [] }).success).toBe(false)
  expect(validHomePath('../outside')).toBe(false)
  expect(validHomePath('C:/outside')).toBe(false)
  expect(validHomePath('x'.repeat(32768))).toBe(false)
  const saved = await store.updateConversation({ ...identity, expectedRevision: 1, patch: { inputDraft: 'saved' } })
  await expect(store.updateConversation({ ...identity, expectedRevision: 1, patch: { inputDraft: 'stale' } })).rejects.toMatchObject({ code: 'revision-conflict' })
  await expect(store.updateConversation({ ...identity, expectedRevision: saved.revision, patch: { inputDraft: 123 as never } })).rejects.toBeInstanceOf(TypeError)
  expect(await store.readConversation(identity)).toEqual(saved)
})
