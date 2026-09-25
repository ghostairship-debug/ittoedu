// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionSendResult, ExecutionSubmissionRecord } from '../../src/shared/workbench/executionDesktop'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture')
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

const completed = (sequence: number) => new Response(`data: ${JSON.stringify({ id: `response-${sequence}`, model: 'fixture-model', choices: [{ index: 0,
  delta: { role: 'assistant', content: `完成 ${sequence}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })

async function fixture(fetch: typeof globalThis.fetch) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-submission-')); directories.push(directory)
  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
    accountId: 'account', authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: path.join(directory, 'desktop'), documents, settings, fetch, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const opened = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as ConversationRecord
  return { directory, documents, service, conversation }
}

async function waitUntil(read: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt += 1) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('condition did not settle')
}

describe('durable execution submissions', () => {
  it('M07-T03 queries an attachment submission after lost ACK then retries its frozen receipt without creating another task', async () => {
    let calls = 0
    const payloads: unknown[] = []
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => { payloads.push(JSON.parse(String(init?.body))); return completed(++calls) })
    const { service, conversation } = await fixture(fetchMock as unknown as typeof globalThis.fetch)
    const attachment = await service.attachments.receiveBytes({ name: 'note.txt', bytes: Buffer.from('附件正文'), source: { kind: 'paste' } })
    const attachments = [{ attachmentId: attachment.id, representationId: 'original-text' }]
    const draft = await service.operate({ type: 'draft', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text: '只执行一次', documents: [], attachments }) as ConversationRecord
    const input = { type: 'send' as const, workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: '11111111-1111-4111-8111-111111111111', expectedRevision: draft.revision, text: '只执行一次', documents: [], attachments }
    const first = await service.operate(input) as ExecutionSendResult
    await service.engine.wait(first.run!.runId)
    // The transport can lose the ACK after Main accepted it. Receipt queries are read-only.
    const receipt = await service.operate({ type: 'submission', workspaceId: input.workspaceId, conversationId: input.conversationId, submissionId: input.submissionId }) as ExecutionSubmissionRecord
    expect(receipt).toMatchObject({ state: 'accepted', text: input.text, attachments, runId: first.run!.runId })
    expect(JSON.stringify(payloads)).toContain('附件正文')
    expect((await service.runs.read(receipt.runId!))?.input.inputContext?.attachments).toEqual(attachments)
    const originalBytes = await service.attachments.readRepresentation(attachment.id, 'original-text')
    expect(Buffer.from(originalBytes.bytes).toString()).toBe('附件正文')
    // Simulate the renderer losing the first return value and retrying the exact submission with its stale CAS revision.
    const retried = await service.operate(input) as ExecutionSendResult
    expect(retried.run!.runId).toBe(first.run!.runId)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(retried.submission).toMatchObject({ state: 'accepted', attachments, runId: first.run!.runId,
      model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' } })
    await expect(service.operate({ ...input, text: '另一条消息' })).rejects.toThrow('同一提交编号已用于不同消息')
    const current = await service.operate({ type: 'conversation', workspaceId: input.workspaceId, conversationId: input.conversationId }) as ConversationRecord
    expect(current.runIndex.builtinRunIds).toEqual([first.run!.runId])
    expect(current.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(current.messages.find(message => message.role === 'user')?.attachmentIds).toEqual([attachment.id])
  })

  it('M07-T04 keeps queue order, deletes one message and enforces the old Gateway write barrier before real Engine adjustment and continuation', async () => {
    let calls = 0
    const instructions: string[] = []
    let onAborted: (() => Promise<void>) | undefined
    const fetchMock = vi.fn((_: string | URL | Request, init?: RequestInit) => {
      calls += 1
      const body = JSON.parse(String(init?.body))
      instructions.push(JSON.stringify(body.messages.filter((message: { role: string }) => message.role === 'user').at(-1)?.content))
      if (calls > 1) return Promise.resolve(completed(calls))
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => { void (onAborted?.() ?? Promise.resolve()).then(() => reject(new DOMException('stopped', 'AbortError')), reject) }
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    const { directory, documents, service, conversation } = await fixture(fetchMock as unknown as typeof globalThis.fetch)
    const filename = path.join(directory, '停止屏障.md'); await fs.writeFile(filename, '保持原文')
    const document = await documents.open(filename)
    const refs = [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [{ kind: 'document' as const }] }]
    const send = (submissionId: string, expectedRevision: number, text: string, mode: 'queue' | 'adjust' = 'queue') => service.operate({
      type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId, expectedRevision, text, documents: refs, attachments: [], mode,
    }) as Promise<ExecutionSendResult>
    const first = await send('21111111-1111-4111-8111-111111111111', conversation.revision, '原目标')
    await waitUntil(async () => fetchMock.mock.calls.length === 1)
    const oldTarget = await documents.tools.issueTarget(first.run!.runId, document.documentId, { kind: 'markdown-range', from: 0, to: 4 })
    let lateResult: unknown
    onAborted = async () => { lateResult = await documents.tools.execute(first.run!.runId, 'late-after-adjust', { name: 'text.replace', input: { target: oldTarget, content: '迟到写入' } }) }
    const queuedA = await send('22222222-2222-4222-8222-222222222222', first.conversation.revision, '稍后继续 A')
    const queuedB = await send('23333333-3333-4333-8333-333333333333', queuedA.conversation.revision, '稍后继续 B')
    expect(queuedA.submission).toMatchObject({ state: 'queued', position: 1 })
    expect(queuedB.submission).toMatchObject({ state: 'queued', position: 2 })
    const removed = await service.operate({ type: 'delete-submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: queuedB.submission.submissionId }) as ExecutionSubmissionRecord
    expect(removed.state).toBe('cancelled')
    const adjusted = await send('24444444-4444-4444-8444-444444444444', queuedB.conversation.revision, '先停止，改按新范围继续', 'adjust')
    expect(adjusted.run).toMatchObject({ input: { instruction: '先停止，改按新范围继续' }, continuedFrom: first.run!.runId })
    await service.engine.wait(adjusted.run!.runId)
    await waitUntil(async () => (await service.operate({ type: 'submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: queuedA.submission.submissionId }) as ExecutionSubmissionRecord).state === 'accepted')
    await waitUntil(async () => fetchMock.mock.calls.length === 3)
    const stopped = await service.operate({ type: 'run', runId: first.run!.runId }) as ExecutionRunRecord
    expect(stopped.status).toBe('stopped')
    expect(lateResult).toMatchObject({ kind: 'error', code: 'run-stopped' })
    expect(documents.registry.get(document.documentId).read()).toMatchObject({ model: { source: '保持原文' }, revision: document.revision, undoDepth: 0 })
    expect(instructions).toHaveLength(3)
    expect(instructions[0]).toContain('原目标')
    expect(instructions[1]).toContain('先停止，改按新范围继续')
    expect(instructions[2]).toContain('稍后继续 A')
    expect(instructions.join('\n')).not.toContain('稍后继续 B')
    const next = await service.operate({ type: 'submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId, submissionId: queuedA.submission.submissionId }) as ExecutionSubmissionRecord
    await service.engine.wait(next.runId!)
    expect((await service.runs.read(next.runId!))?.continuedFrom).toBe(adjusted.run!.runId)
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  it('persists an external handoff pause and cancels only writable document work before close without a late run', async () => {
    let calls = 0
    const fetchMock = vi.fn((_: string | URL | Request, init?: RequestInit) => {
      calls += 1
      if (calls > 1) return Promise.resolve(completed(calls))
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('stopped', 'AbortError'))
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort', abort, { once: true })
      })
    })
    const { directory, documents, service, conversation } = await fixture(fetchMock as unknown as typeof globalThis.fetch)
    const filename = path.join(directory, 'target.md'); await fs.writeFile(filename, '正文')
    const document = await documents.open(filename)
    const writable = [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [{ kind: 'document' as const }] }]
    const readOnly = [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [] }]
    const send = (submissionId: string, expectedRevision: number, text: string, refs: typeof writable | typeof readOnly) => service.operate({
      type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId, expectedRevision, text, documents: refs, attachments: [], mode: 'queue',
    }) as Promise<ExecutionSendResult>
    const running = await send('31111111-1111-4111-8111-111111111111', conversation.revision, '可写任务', writable)
    await waitUntil(async () => fetchMock.mock.calls.length === 1)
    const queuedWrite = await send('32222222-2222-4222-8222-222222222222', running.conversation.revision, '排队可写', writable)
    const queuedRead = await send('33333333-3333-4333-8333-333333333333', queuedWrite.conversation.revision, '排队只读', readOnly)
    await service.withConversation(conversation.conversationId, () => service.pauseQueueForExternal(conversation.conversationId))
    expect(await service.writableTasksForDocument(document.documentId)).toEqual({ runIds: [running.run!.runId], submissionIds: [queuedWrite.submission.submissionId] })
    expect(await service.stopTasksForDocument(document.documentId)).toEqual({ runIds: [running.run!.runId], submissionIds: [queuedWrite.submission.submissionId] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const paused = await service.operate({ type: 'submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: queuedRead.submission.submissionId }) as ExecutionSubmissionRecord
    expect(paused).toMatchObject({ state: 'queued', queuePausedReason: 'external-handoff' })
    await service.withConversation(conversation.conversationId, () => service.resumeBuiltinQueue(conversation.conversationId))
    await waitUntil(async () => (await service.operate({ type: 'submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: queuedRead.submission.submissionId }) as ExecutionSubmissionRecord).state === 'accepted')
    await waitUntil(async () => fetchMock.mock.calls.length === 2)
    const accepted = await service.operate({ type: 'submission', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
      submissionId: queuedRead.submission.submissionId }) as ExecutionSubmissionRecord
    await service.engine.wait(accepted.runId!)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
