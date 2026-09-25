// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore, type ExecutionTimingMark } from '../../src/main/workbench/execution/ExecutionEventStore'
import { installDocumentSaveEvents } from '../../src/main/workbench/execution/DocumentSaveEvents'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { DocumentPersistence } from '../../src/shared/workbench/document'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-key' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
function completed(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = [], content = '完成'): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 10, type: 'response.completed', responseId: 'response', actualModel: 'fixture-model',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
      function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function mark(marks: ExecutionTimingMark[], stage: ExecutionTimingMark['stage'], requestId?: string): ExecutionTimingMark {
  const found = marks.find(value => value.stage === stage && (requestId === undefined || value.requestId === requestId))
  if (!found) throw new Error(`Missing ${stage}`)
  return found
}

it('records Main preparation before request serialization and distinguishes provider event, content, tool ACK and run end', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-engine-')); directories.push(directory)
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const runs = new ExecutionRunStore(path.join(directory, 'runs')), events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const session = await registry.create(driver.load(new TextEncoder().encode('原文')), '草稿.md')
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns > 1) { yield completed(request); return }
    const references = JSON.parse(String(request.messages[1].content).split('：')[1]) as { writable: { target: string }[] }[]
    const args = JSON.stringify({ target: references[0]!.writable[0]!.target, content: '新文' })
    yield { type: 'reasoning.delta', requestId: request.requestId, sequence: 1, text: '思考' }
    yield { type: 'text.delta', requestId: request.requestId, sequence: 2, text: '开始' }
    yield completed(request, [{ id: 'replace', name: 'text.replace', argumentsText: args }], '')
  } }
  const entered = deferred(), release = deferred(), describe = gateway.describeRun.bind(gateway)
  let runId = ''
  vi.spyOn(gateway, 'describeRun').mockImplementation(async id => { runId = id; entered.resolve(); await release.promise; return describe(id) })
  const engine = new ExecutionEngine({ registry, gateway, runs, events, provider })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'submission', instruction: '替换原文', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 2 }] }] }
  const starting = engine.start(input)
  await entered.promise
  const duringPreparation = await events.readTiming(input.conversationId, input.taskId)
  expect(duringPreparation.map(value => value.stage)).toEqual(['engine.prepare.started'])
  release.resolve()
  const started = await starting
  const final = await engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(session.read().model).toMatchObject({ source: '新文' })
  const marks = await events.readTiming(input.conversationId, input.taskId)
  const firstRequest = final.requests[0]!.requestId
  const stages = ['engine.prepare.started', 'engine.prepare.finished', 'request.prepared', 'request.dispatched',
    'provider.first-event', 'provider.first-content', 'tool.started', 'document.applied', 'tool.finished', 'run.ended'] as const
  const ordered = stages.map(stage => mark(marks, stage, ['request.prepared', 'request.dispatched', 'provider.first-event', 'provider.first-content'].includes(stage) ? firstRequest : undefined))
  expect(ordered.map(value => value.monotonicMs)).toEqual([...ordered.map(value => value.monotonicMs)].sort((a, b) => a - b))
  expect(mark(marks, 'provider.first-event', firstRequest).detail).toMatchObject({ eventType: 'reasoning.delta' })
  expect(mark(marks, 'provider.first-content', firstRequest).detail).toMatchObject({ contentKind: 'text' })
  expect(mark(marks, 'provider.first-content', final.requests[1]!.requestId).detail).toMatchObject({ contentKind: 'assistant.final' })
  expect(marks.filter(value => value.stage === 'request.finished').map(value => [value.requestId, value.detail?.outcome]))
    .toEqual(final.requests.map(request => [request.requestId, 'completed']))
  for (const request of final.requests) {
    expect(mark(marks, 'request.dispatched', request.requestId).monotonicMs)
      .toBeLessThanOrEqual(mark(marks, 'request.finished', request.requestId).monotonicMs)
  }
  expect(mark(marks, 'document.applied').detail).toMatchObject({ documentId: session.documentId, outcome: 'applied' })
  expect(mark(marks, 'request.prepared', firstRequest).detail?.serializedBytes).toBeGreaterThan(0)
  expect(new Set(marks.map(value => `${value.process}:${value.clock}:${value.clockInstanceId}`)).size).toBe(1)
  expect(marks.some(value => value.stage === 'save.fact-observed')).toBe(false)
  const reopened = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  expect(await reopened.readTiming(input.conversationId, input.taskId)).toEqual(marks)
  expect(runId).toBe(started.runId)
  vi.spyOn(events, 'recordTiming').mockRejectedValueOnce(new Error('timing sidecar unavailable'))
  const unaffected = await engine.start({ ...input, taskId: 'diagnostic-failure' })
  expect((await engine.wait(unaffected.runId)).status).toBe('completed')

  vi.spyOn(gateway, 'beginRun').mockRejectedValueOnce(new Error('real preparation rejected'))
  await expect(engine.start({ ...input, taskId: 'preparation-failure' })).rejects.toThrow('real preparation rejected')
  expect((await events.readTiming(input.conversationId, 'preparation-failure')).map(value => [value.stage, value.detail?.outcome]))
    .toEqual([['engine.prepare.started', undefined], ['engine.prepare.finished', 'failed']])

  const providerEntered = deferred(), providerRelease = deferred()
  const stalled: ModelProvider = { async *stream(request) {
    providerEntered.resolve(); await providerRelease.promise
    yield completed(request)
  } }
  const cancellable = new ExecutionEngine({ registry, gateway, runs, events, provider: stalled })
  const cancelled = await cancellable.start({ ...input, taskId: 'cancelled-during-provider' })
  await providerEntered.promise
  const stopping = cancellable.stop(cancelled.runId)
  providerRelease.resolve()
  expect((await stopping)?.status).toBe('stopped')
  const cancellationMarks = await events.readTiming(input.conversationId, 'cancelled-during-provider')
  expect(mark(cancellationMarks, 'request.dispatched').monotonicMs)
    .toBeLessThanOrEqual(mark(cancellationMarks, 'run.ended').monotonicMs)
  expect(mark(cancellationMarks, 'run.ended').detail?.outcome).toBe('stopped')
  expect(mark(cancellationMarks, 'request.finished').detail?.outcome).toBe('unknown')
  expect(cancellationMarks.some(value => value.stage === 'provider.first-content')).toBe(false)

  const fetchAttempt = vi.fn(async () => { throw new Error('fetch must not run without credentials') })
  const localFailure = new OpenAIChatProvider({ credentialResolver: async () => { throw new Error('credential unavailable') },
    fetch: fetchAttempt as typeof fetch })
  const rejected = new ExecutionEngine({ registry, gateway, runs, events, provider: localFailure })
  const unsent = await rejected.start({ ...input, taskId: 'credential-not-sent' })
  expect((await rejected.wait(unsent.runId)).status).toBe('failed')
  expect(fetchAttempt).not.toHaveBeenCalled()
  const unsentMarks = await events.readTiming(input.conversationId, 'credential-not-sent')
  expect(mark(unsentMarks, 'request.dispatched').process).toBe('main')
  expect(mark(unsentMarks, 'request.finished').detail?.outcome).toBe('not-sent')
  expect(unsentMarks.some(value => value.stage === 'provider.first-event' || value.stage === 'provider.first-content')).toBe(false)
  expect(mark(unsentMarks, 'run.ended').detail?.outcome).toBe('failed')
})

it('keeps the adapter not-sent terminal when stop happens during credential resolution', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-not-sent-')); directories.push(directory)
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(driver.load(new TextEncoder().encode('untouched')), 'untouched.md')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const resolving = deferred(), release = deferred(), fetchAttempt = vi.fn(async () => { throw new Error('fetch must not run') })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => { resolving.resolve(); await release.promise; throw new Error('credential unavailable') },
    fetch: fetchAttempt as typeof fetch })
  const engine = new ExecutionEngine({ registry, gateway, events, runs: new ExecutionRunStore(path.join(directory, 'runs')), provider })
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'stopped-before-fetch', instruction: 'read', selection,
    documents: [{ documentId: session.documentId, writable: [] }] }
  const started = await engine.start(input)
  await resolving.promise
  const stopping = engine.stop(started.runId)
  release.resolve()
  const result = await stopping
  expect(result?.status).toBe('stopped')
  expect(result?.requests[0]?.failure?.outcome).toBe('not-sent')
  expect(fetchAttempt).not.toHaveBeenCalled()
  expect(session.read().model).toMatchObject({ source: 'untouched' })
  const marks = await events.readTiming(input.conversationId, input.taskId)
  expect(mark(marks, 'request.finished').detail?.outcome).toBe('not-sent')
  expect(marks.some(value => value.stage === 'provider.first-event' || value.stage === 'document.applied')).toBe(false)
})

it('records IPC receipt, submission preparation and only observation of an appended save fact', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-service-')); directories.push(directory)
  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
    accountId: 'account', authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  const fetch = vi.fn(async () => new Response(`data: ${JSON.stringify({ id: 'response', model: 'fixture-model', choices: [{ index: 0,
    delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
  const service = new ExecutionDesktopService({ directory: path.join(directory, 'desktop'), documents, settings,
    fetch: fetch as typeof globalThis.fetch, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const opened = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as { workspaceId: string; conversationId: string; revision: number }
  const imageBytes = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#2563eb' } }).png().toBuffer()
  const image = await service.attachments.receiveBytes({ name: 'timed-real-image.png', bytes: imageBytes, source: { kind: 'paste' } })
  const submissionId = '11111111-1111-4111-8111-111111111111'
  const result = await service.operate({ type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
    submissionId, expectedRevision: conversation.revision, text: '问好', documents: [],
    attachments: [{ attachmentId: image.id, representationId: 'original-image' }] }) as ExecutionSendResult
  await service.engine.wait(result.run!.runId)
  const beforeSave = await service.events.readTiming(conversation.conversationId, submissionId)
  expect(beforeSave.map(value => value.stage).slice(0, 6)).toEqual(['submit.received', 'submission.prepare.started',
    'submission.attachments.started', 'submission.attachments.finished', 'submission.prepare.finished', 'engine.prepare.started'])
  expect(mark(beforeSave, 'submit.received').monotonicMs).toBeLessThanOrEqual(mark(beforeSave, 'submission.prepare.started').monotonicMs)
  expect(mark(beforeSave, 'submission.attachments.finished').detail).toMatchObject({ outcome: 'completed', imageCount: 1,
    representationBytes: imageBytes.byteLength })
  expect(mark(beforeSave, 'payload.compile.finished').detail).toMatchObject({ outcome: 'completed', imageCount: 1,
    imageBytes: imageBytes.byteLength, representationBytes: imageBytes.byteLength })
  expect(mark(beforeSave, 'payload.compile.started').monotonicMs).toBeLessThanOrEqual(mark(beforeSave, 'payload.compile.finished').monotonicMs)
  expect(mark(beforeSave, 'payload.compile.finished').monotonicMs).toBeLessThanOrEqual(mark(beforeSave, 'request.prepared').monotonicMs)
  expect(beforeSave.some(value => value.stage === 'save.fact-observed')).toBe(false)
  const sourceTime = Date.now() - 1000
  await service.appendExternalEvent({ eventId: 'save-fact', conversationId: conversation.conversationId, taskId: submissionId,
    runId: result.run!.runId, itemId: 'save', time: sourceTime, source: 'builtin', type: 'document.save', update: 'snapshot',
    data: { documentId: 'document', saveStatus: 'saved', status: 'completed', label: '已保存' } })
  const afterSave = await service.events.readTiming(conversation.conversationId, submissionId)
  expect(mark(afterSave, 'save.fact-observed')).toMatchObject({ sourceWallTimeMs: sourceTime,
    detail: { documentId: 'document', saveStatus: 'saved' } })
  expect(mark(afterSave, 'save.fact-observed').wallTimeMs).toBeGreaterThan(sourceTime)
  await service.appendExternalEvent({ eventId: 'failed-save-fact', conversationId: conversation.conversationId, taskId: submissionId,
    runId: result.run!.runId, itemId: 'failed-save', time: Date.now(), source: 'builtin', type: 'document.save', update: 'snapshot',
    data: { documentId: 'document', saveStatus: 'failed', status: 'failed', label: '保存失败' } })
  expect((await service.events.readTiming(conversation.conversationId, submissionId))
    .filter(value => value.stage === 'save.fact-observed').map(value => value.detail?.saveStatus)).toEqual(['saved', 'failed'])
})

it('stamps a real DocumentSession disk ACK before the later timeline projection, and stamps a failed save separately', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-disk-')); directories.push(directory)
  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  const conversations = new ConversationStore({ directory: path.join(directory, 'conversations') })
  await conversations.registerWorkspace({ workspaceId: 'workspace', rootPath: directory, managed: true, authorization: 'managed' })
  const conversation = await conversations.createConversation({ workspaceId: 'workspace' })
  const document = await documents.internalAPI.create({ kind: 'markdown', source: 'old', resources: { assets: {}, components: {} } }, 'timed.md')
  const runId = randomUUID(), taskId = randomUUID()
  await documents.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
  const target = await documents.tools.issueTarget(runId, document.documentId, { kind: 'markdown-range', from: 0, to: 3 })
  const edit = await documents.tools.execute(runId, randomUUID(), { name: 'text.replace', input: { target, content: 'saved bytes' } })
  if (edit.kind !== 'document-operation' || edit.result.status !== 'applied') throw new Error('Expected real document edit')
  await events.append({ eventId: randomUUID(), conversationId: conversation.conversationId, taskId, runId, itemId: 'commit',
    time: Date.now(), source: 'builtin', type: 'document.commit', update: 'snapshot',
    data: { documentId: document.documentId, revision: edit.result.revision, operationId: edit.result.operationId,
      applicationStatus: 'applied', status: 'applied' } })
  const projection = installDocumentSaveEvents({ documents, execution: { events, conversations,
    appendExternalEvent: input => events.append(input) } })
  try {
    const filename = path.join(directory, 'timed.md')
    expect((await events.readTiming(conversation.conversationId, taskId)).some(value => value.stage === 'save.finished')).toBe(false)
    const persistence = (documents.registry.get(document.documentId) as unknown as { persistence: DocumentPersistence }).persistence
    const persistFile = persistence.save.bind(persistence), diskEntered = deferred(), allowDisk = deferred()
    vi.spyOn(persistence, 'save').mockImplementation(async input => {
      diskEntered.resolve(); await allowDisk.promise
      return persistFile(input)
    })
    const saving = documents.saveToPath(document.documentId, filename)
    try {
      await diskEntered.promise
      await projection.flush()
      const started = (await events.readTiming(conversation.conversationId, taskId)).filter(value => value.stage === 'save.started')
      expect(started).toHaveLength(1)
      expect(started[0]).toMatchObject({ process: 'main', clock: 'performance.now',
        detail: { documentId: document.documentId, saveStatus: 'saving', outcome: 'started' } })
      expect((await events.readTiming(conversation.conversationId, taskId)).some(value => value.stage === 'save.finished')).toBe(false)
      await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { allowDisk.resolve() }
    await saving
    const saveReturnedAt = performance.now()
    await projection.flush()
    expect(await fs.readFile(filename, 'utf8')).toBe('saved bytes')
    const saved = (await events.readTiming(conversation.conversationId, taskId)).filter(value => value.stage === 'save.finished')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ process: 'main', clock: 'performance.now',
      detail: { documentId: document.documentId, saveStatus: 'saved', outcome: 'completed' } })
    expect(saved[0]!.monotonicMs).toBeLessThanOrEqual(saveReturnedAt)
    expect(mark(await events.readTiming(conversation.conversationId, taskId), 'save.started').monotonicMs)
      .toBeLessThanOrEqual(saved[0]!.monotonicMs)
    expect((await events.snapshot(conversation.conversationId)).items.some(item => item.type === 'document.save')).toBe(true)

    await fs.writeFile(filename, 'external conflict')
    await expect(documents.saveToPath(document.documentId)).rejects.toThrow()
    await projection.flush()
    expect(await fs.readFile(filename, 'utf8')).toBe('external conflict')
    expect((await events.readTiming(conversation.conversationId, taskId)).filter(value => value.stage === 'save.finished')
      .map(value => value.detail?.saveStatus)).toEqual(['saved', 'failed'])
    expect((await events.readTiming(conversation.conversationId, taskId)).filter(value => value.stage === 'save.started')).toHaveLength(2)
  } finally { projection.dispose() }
})
