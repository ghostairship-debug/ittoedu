// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import { MODEL_REQUEST_BUDGET_EXHAUSTED } from '../../src/shared/workbench/execution'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'
import { selectionReference } from '../../src/renderer/workbench/SelectionContextController'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temp')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

type Fault = 'auth' | 'quota' | 'disconnect' | 'budget'
async function waitForDraft(service: ExecutionDesktopService, identity: { workspaceId: string; conversationId: string }, text: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    if (current.inputDraft === text) return current
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return service.operate({ type: 'conversation', ...identity }) as Promise<ConversationRecord>
}
async function fixture(fault: Fault, holdFirstFailure = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m12-recovery-')); roots.push(root)
  let broken = true, requests = 0
  let releaseFailure: () => void = () => undefined
  const failureGate = new Promise<void>(resolve => { releaseFailure = resolve })
  const server = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests++
    if (broken && requests === 1 && holdFirstFailure) await failureGate
    if (broken && fault === 'disconnect') { response.destroy(); return }
    if (broken && fault === 'budget') {
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as { tools?: Array<{ function: { name: string; description: string } }> }
      const listed = payload.tools?.find(tool => tool.function.name === modelToolWireName('file.list'))
      if (!listed) throw new Error('Fixture file.list unavailable')
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: `budget-${requests}`, model: 'fixture-model', choices: [{ index: 0,
        delta: { role: 'assistant', tool_calls: [{ index: 0, id: `load-${requests}`, type: 'function',
          function: { name: modelToolWireName('file.list'), arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    if (broken) { response.writeHead(fault === 'auth' ? 401 : 402); response.end(); return }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'recovered-response', model: 'fixture-model', choices: [{ index: 0,
      delta: { role: 'assistant', content: '连接已恢复' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => response.destroy(error)) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const localFetch: typeof fetch = (input, init) => {
    if (new URL(String(input)).origin !== origin) throw new Error('Non-fixture network forbidden')
    return fetch(input, init)
  }
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: `${origin}/v1`, accountId: 'fixture-account',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'),
    documents: new DocumentHostService(path.join(root, 'documents')), settings, fetch: localFetch,
    authorizeWorkspaceRoot: async directory => ({ resolvedPath: directory }) })
  const opened = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as ConversationRecord
  const attachment = await service.attachments.receiveBytes({ name: 'source.txt', bytes: Buffer.from('教师参考材料'), source: { kind: 'paste' } })
  const attachments = [{ attachmentId: attachment.id, representationId: 'original-text' }]
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const text = '根据附件继续同一任务'
  const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision,
    text, documents: [], attachments }) as ConversationRecord
  const send = { type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision,
    text, documents: [], attachments }
  return { service, identity, draft, send, text, attachments, attachment,
    get requests() { return requests }, releaseFailure, recover() { broken = false } }
}

async function partialDocumentFixture(options: { source?: string; replacement?: string; selection?: boolean;
  derivedTarget?: { from: number; to: number } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m12-partial-')); roots.push(root)
  const filename = path.join(root, 'lesson.md'); await fs.writeFile(filename, options.source ?? '原正文 后文')
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const document = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' },
    vision: null, imageGenerate: null, imageEdit: null } })
  let requests = 0
  const localFetch: typeof fetch = async (_url, init) => {
    requests++
    if (requests === 2) return new Response('', { status: 401 })
    const chunk = requests === 1 ? await (async () => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }>;
        tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }> }
      const fixed = body.messages.find(message => message.role === 'system' && message.content.startsWith('本次固定文档与权限'))!
      const reference = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1)) as Array<{ writable: Array<{ target: string }> }>
      const name = body.tools.find(tool => tool.function.parameters.properties.content)?.function.name
      if (!name) throw new Error('Fixture text tool unavailable')
      const run = options.derivedTarget ? (await service.runs.list()).at(-1) : undefined
      const target = options.derivedTarget && run
        ? await documents.tools.issueTarget(run.runId, document.documentId, { kind: 'markdown-range', ...options.derivedTarget })
        : reference[0]!.writable[0]!.target
      return { id: 'first-response', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0,
        delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'first-call', type: 'function',
          function: { name, arguments: JSON.stringify({ target, content: options.replacement ?? '已修改' }) } }] },
        finish_reason: 'tool_calls' }] }
    })() : { id: 'continued-response', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0,
      delta: { role: 'assistant', content: '剩余工作已核对' }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents, settings, fetch: localFetch,
    authorizeWorkspaceRoot: async directory => ({ resolvedPath: directory }) })
  const opened = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const range = { kind: 'markdown-range' as const, from: 0, to: 3 }
  const references = [options.selection
    ? selectionReference({ documentId: document.documentId, epoch: document.epoch, revision: document.revision,
      targets: [range], label: '开头选区' }, true)
    : { documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [range] }]
  const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision,
    text: '只修改开头，随后检查', documents: references, attachments: [] }) as ConversationRecord
  const send = { type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision,
    text: draft.inputDraft, documents: references, attachments: [], permission: 'full' as const }
  const first = await service.operate(send) as ExecutionSendResult
  const failed = await service.engine.wait(first.run!.runId)
  expect(failed.status).toBe('partial')
  expect(failed.tools[0].result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', beforeRevision: 0, revision: 1 } })
  expect((await documents.internalAPI.read(document.documentId)).model).toMatchObject({ source: options.derivedTarget ? 'XYZBC tail' : '已修改 后文' })
  const restored = await waitForDraft(service, identity, draft.inputDraft)
  return { service, documents, document, identity, send, failed, restored, get requests() { return requests } }
}

it.each([
  { fault: 'auth' as const, kind: 'auth', code: 'http-401', outcome: 'rejected' },
  { fault: 'quota' as const, kind: 'quota', code: 'http-402', outcome: 'rejected' },
  { fault: 'disconnect' as const, kind: 'transport', code: 'transport', outcome: 'unknown' },
])('M12-T02 $fault: reports the cause and retains the failed task input for connection recovery', async ({ fault, kind, code, outcome }) => {
  const f = await fixture(fault)
  const sent = await f.service.operate(f.send) as ExecutionSendResult
  const failed = await f.service.engine.wait(sent.run!.runId)
  expect(failed.status).toBe('failed')
  expect(failed.requests).toHaveLength(1)
  expect(failed.requests[0].failure).toMatchObject({ kind, code, outcome })
  expect(f.requests).toBe(1)

  const persisted = await f.service.operate({ type: 'run', runId: failed.runId }) as ExecutionRunRecord
  expect(persisted.requests[0].failure).toMatchObject({ kind, code })
  const current = await waitForDraft(f.service, f.identity, f.text)
  expect(current.inputDraft).toBe(f.text)
  expect(current.inputAttachments).toEqual(f.attachments)
  expect(Buffer.from((await f.service.attachments.readRepresentation(f.attachment.id, 'original-text')).bytes).toString()).toBe('教师参考材料')

  f.recover()
  const receipt = await f.service.operate(f.send) as ExecutionSendResult
  expect(receipt.run?.runId).toBe(failed.runId)
  expect(receipt.submission.state).toBe('accepted')
  expect(f.requests).toBe(1)
  expect((await f.service.runs.list()).filter(run => run.input.taskId === f.send.submissionId)).toHaveLength(1)

  const continuation = { ...f.send, submissionId: randomUUID(), expectedRevision: current.revision, retryOfRunId: failed.runId }
  const resumed = await f.service.operate(continuation) as ExecutionSendResult
  const second = await f.service.engine.wait(resumed.run!.runId)
  expect(second.status).toBe('completed')
  expect(second.continuedFrom).toBe(failed.runId)
  expect(f.requests).toBe(2)
  const after = await f.service.operate({ type: 'conversation', ...f.identity }) as ConversationRecord
  expect(after.runIndex.builtinRunIds).toEqual([failed.runId, second.runId])
  expect(after.messages.filter(message => message.role === 'user')).toHaveLength(1)
  // The first continuation ACK may be lost. Its old conversation revision is
  // intentional: durable submission identity must win before the CAS check.
  const recoveredAck = await f.service.operate(continuation) as ExecutionSendResult
  expect(recoveredAck.run!.runId).toBe(second.runId)
  expect(recoveredAck.submission.retryOfRunId).toBe(failed.runId)
  expect(f.requests).toBe(2)
  const duplicateClick = await f.service.operate({ ...continuation, submissionId: randomUUID() }) as ExecutionSendResult
  expect(duplicateClick.run!.runId).toBe(second.runId)
  expect(f.requests).toBe(2)
})

it('holds queued work at the local request cap and creates only one explicit continuation', async () => {
  const f = await fixture('budget', true)
  const start = f.service.engine.start.bind(f.service.engine)
  vi.spyOn(f.service.engine, 'start').mockImplementation((input, continuation, onPrepared) =>
    start({ ...input, budget: { maxRequests: 2 } }, continuation, onPrepared))
  const first = await f.service.operate(f.send) as ExecutionSendResult
  for (let attempt = 0; f.requests === 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  expect(f.requests).toBe(1)
  const queued = await f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: first.conversation.revision,
    text: '排队中的另一项工作', attachments: [] }) as ExecutionSendResult
  expect(queued.submission.state).toBe('queued')
  f.releaseFailure()
  const exhausted = await f.service.engine.wait(first.run!.runId)
  expect(exhausted).toMatchObject({ status: 'failed', failure: { code: MODEL_REQUEST_BUDGET_EXHAUSTED } })
  expect(exhausted.requests).toHaveLength(2)
  const restored = await waitForDraft(f.service, f.identity, f.text)
  expect(f.requests).toBe(2)
  expect((await f.service.operate({ type: 'submission', ...f.identity, submissionId: queued.submission.submissionId }) as
    { state: string }).state).toBe('queued')
  f.recover()
  const continuation = { ...f.send, submissionId: randomUUID(), expectedRevision: restored.revision, retryOfRunId: exhausted.runId }
  const resumed = await f.service.operate(continuation) as ExecutionSendResult
  expect((await f.service.engine.wait(resumed.run!.runId)).status).toBe('completed')
  const duplicate = await f.service.operate({ ...continuation, submissionId: randomUUID() }) as ExecutionSendResult
  expect(duplicate.run?.runId).toBe(resumed.run?.runId)
  expect(resumed.run?.continuedFrom).toBe(exhausted.runId)
})

it('M12-T02 leaves already queued work dormant until the failed connection is explicitly continued', async () => {
  const f = await fixture('auth', true)
  const first = await f.service.operate(f.send) as ExecutionSendResult
  for (let attempt = 0; f.requests === 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  expect(f.requests).toBe(1)
  const queued = await f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: first.conversation.revision,
    text: '稍后执行另一项工作', attachments: [] }) as ExecutionSendResult
  expect(queued.submission.state).toBe('queued')
  f.releaseFailure()
  expect((await f.service.engine.wait(first.run!.runId)).status).toBe('failed')
  const restored = await waitForDraft(f.service, f.identity, f.text)
  expect(restored.inputAttachments).toEqual(f.attachments)
  expect(f.requests).toBe(1)
  expect((await f.service.operate({ type: 'submission', ...f.identity, submissionId: queued.submission.submissionId }) as
    { state: string }).state).toBe('queued')

  f.recover()
  const retried = await f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: restored.revision,
    retryOfRunId: first.run!.runId }) as ExecutionSendResult
  expect((await f.service.engine.wait(retried.run!.runId)).status).toBe('completed')
  for (let attempt = 0; f.requests < 3 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  expect(f.requests).toBe(3)
})

it('M12-T02 continues a partial local range from its confirmed applied revision without replaying the old edit', async () => {
  const f = await partialDocumentFixture()
  const retry = { ...f.send, submissionId: randomUUID(), expectedRevision: f.restored.revision, retryOfRunId: f.failed.runId }
  const resumed = await f.service.operate(retry) as ExecutionSendResult
  const final = await f.service.engine.wait(resumed.run!.runId)
  expect(final.status).toBe('completed')
  expect(final.continuedFrom).toBe(f.failed.runId)
  expect(final.input.documents[0]).toMatchObject({ documentId: f.document.documentId })
  expect((await f.documents.internalAPI.read(f.document.documentId))).toMatchObject({ revision: 1, undoDepth: 1,
    model: { source: '已修改 后文' } })
  expect(f.requests).toBe(3)
  const receipt = await f.service.operate(retry) as ExecutionSendResult
  expect(receipt.run!.runId).toBe(final.runId)
  expect(f.requests).toBe(3)
})

it('M12-T02 continues a real selectionReference whose selection and writable contain the same Markdown range', async () => {
  const f = await partialDocumentFixture({ selection: true })
  const resumed = await f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: f.restored.revision,
    retryOfRunId: f.failed.runId }) as ExecutionSendResult
  expect((await f.service.engine.wait(resumed.run!.runId)).status).toBe('completed')
  expect((await f.documents.internalAPI.read(f.document.documentId))).toMatchObject({ revision: 1,
    model: { source: '已修改 后文' } })
  expect(f.requests).toBe(3)
})

it('M12-T02 rejects a derived child range whose growth shifts the frozen parent coordinates', async () => {
  const f = await partialDocumentFixture({ source: 'ABC tail', replacement: 'XYZ', derivedTarget: { from: 0, to: 1 } })
  await expect(f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: f.restored.revision,
    retryOfRunId: f.failed.runId })).rejects.toThrow()
  expect((await f.documents.internalAPI.read(f.document.documentId))).toMatchObject({ revision: 1,
    model: { source: 'XYZBC tail' } })
  expect(f.requests).toBe(2)
})

it('M12-T02 rejects partial continuation after a later human edit instead of rebasing its old local range', async () => {
  const f = await partialDocumentFixture()
  const before = await f.documents.internalAPI.read(f.document.documentId)
  await f.documents.registry.get(f.document.documentId).execute({ documentId: f.document.documentId, epoch: before.epoch,
    baseRevision: before.revision, operationId: 'teacher-later-edit', actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '教师后改 后文' } } })
  await expect(f.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: f.restored.revision,
    retryOfRunId: f.failed.runId })).rejects.toThrow()
  expect((await f.documents.internalAPI.read(f.document.documentId))).toMatchObject({ revision: 2,
    model: { source: '教师后改 后文' } })
  expect(f.requests).toBe(2)
})
