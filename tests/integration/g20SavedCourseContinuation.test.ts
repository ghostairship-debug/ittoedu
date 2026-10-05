// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { installDocumentSaveEvents } from '../../src/main/workbench/execution/DocumentSaveEvents'
import { DisplayEventBuffer } from '../../src/main/workbench/execution/DisplayEventBuffer'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDocumentReference, ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup() })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

async function fixture(mode: 'surface' | 'range' = 'surface', saveProjection = true,
  heldContinuation?: { next: ReturnType<typeof deferred>; finish: ReturnType<typeof deferred> }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-saved-course-'))
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const project = createBlankCourseProjectV10('Original work', randomUUID)
  const surfaceId = project.surfaces[0]!.id, instanceId = randomUUID()
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  project.instances[instanceId] = { id: instanceId, definitionId: TEXT_DEFINITION.id, data: { content: { inlines: [{ type: 'text', text: 'ABCDEF' }] } } }
  project.surfaces[0]!.childIds.push(instanceId)
  const document = await documents.internalAPI.create({ kind: 'course-v10', project,
    resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
  } })
  const connection = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' },
    vision: null, imageGenerate: null, imageEdit: null } })
  let calls = 0
  const localFetch: typeof fetch = async () => {
    calls++
    if (calls === 1) return new Response('', { status: 401 })
    const chunk = { id: `response-${calls}`, model: 'fixture-model', choices: [{ index: 0,
      delta: { role: 'assistant', content: 'continued' }, finish_reason: 'stop' }] }
    if (heldContinuation && calls === 2) {
      const encode = (text: string, finish: string | null = null) => new TextEncoder().encode(`data: ${JSON.stringify({
        ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: finish }],
      })}\n\n`)
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encode('first display'))
        void heldContinuation.next.promise.then(() => controller.enqueue(encode('second display')))
        void heldContinuation.finish.promise.then(() => {
          controller.enqueue(encode('', 'stop'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close()
        })
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const createService = (host: DocumentHostService) => new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents: host, settings,
    fetch: localFetch, authorizeWorkspaceRoot: async directory => ({ resolvedPath: await fs.realpath(directory) }) })
  const service = createService(documents)
  const diagnostics: unknown[] = []
  const projection = saveProjection ? installDocumentSaveEvents({ documents, execution: service, onError: error => diagnostics.push(error) }) : undefined
  cleanups.push(async () => {
    await projection?.flush(); projection?.dispose()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'g20-saved-course-')) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  })
  const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
  const target = mode === 'range' ? { kind: 'course-instance' as const, surfaceId, instanceId, dataPath: ['content'], from: 2, to: 4 }
    : { kind: 'course-surface' as const, surfaceId }
  const reference: ExecutionDocumentReference = { documentId: document.documentId, epoch: document.epoch,
    revision: document.revision, writable: [target], selection: [target] }
  const send = { type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
    submissionId: randomUUID(), expectedRevision: conversation.revision, text: 'Continue the selected content', documents: [reference],
    ...(target.kind === 'course-instance' ? { contentOutput: { kind: 'replace-text' as const, documentId: document.documentId, target } } : {}),
    attachments: [], permission: 'workspace' as const }
  const sent = await service.operate(send) as ExecutionSendResult
  const failed = await service.engine.wait(sent.run!.runId)
  expect(failed.status).toBe('failed')
  expect(failed.tools).toEqual([])
  const filename = path.join(root, 'lesson.h5lesson')
  const edit = async (documentId: string, edits: ComponentEdit[]) => {
    const current = await documents.internalAPI.read(documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected course-v10 fixture')
    const result = await documents.internalAPI.dispatch({ documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
    expect(result.status).toBe('applied')
  }
  const retry = async (submissionId = randomUUID(), retryOfRunId = failed.runId) => {
    const current = await service.operate({ type: 'conversation', workspaceId: send.workspaceId, conversationId: send.conversationId }) as ConversationRecord
    return service.operate({ ...send, submissionId, expectedRevision: current.revision, retryOfRunId }) as Promise<ExecutionSendResult>
  }
  const restart = () => {
    const documents = new DocumentHostService(path.join(root, 'documents'))
    return { documents, service: createService(documents) }
  }
  return { root, documents, document, project, service, projection, diagnostics, failed, send, reference, restart,
    filename, edit, retry, calls: () => calls, surfaceId, instanceId }
}

it('retries a normally saved and reopened V10 work with the original scope and fresh session, waiting for the emitted save binding', async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  const persist = f.service.engine.recordDocumentBinding.bind(f.service.engine)
  vi.spyOn(f.service.engine, 'recordDocumentBinding').mockImplementation(async (...args) => {
    entered.resolve(); await release.promise; return persist(...args)
  })
  await f.edit(f.document.documentId, [{ type: 'project.title.set', title: 'Saved human edit' }])
  await f.documents.saveToPath(f.document.documentId, f.filename)
  await entered.promise
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  const reopened = await f.documents.open(f.filename)
  expect(reopened.documentId).not.toBe(f.document.documentId)
  expect(reopened.epoch).not.toBe(f.document.epoch)
  await f.edit(reopened.documentId, [{ type: 'surface.title.set', surfaceId: f.surfaceId, title: 'Later unsaved human edit' }])
  const waiting = deferred(), settle = f.documents.settleSaveObservations.bind(f.documents)
  vi.spyOn(f.documents, 'settleSaveObservations').mockImplementation(() => { waiting.resolve(); return settle() })
  const submissionId = randomUUID(), continuing = f.retry(submissionId)
  try { await waiting.promise; expect(f.calls()).toBe(1) } finally { release.resolve() }
  const sent = await continuing, completed = await f.service.engine.wait(sent.run!.runId)
  expect(completed.status).toBe('completed')
  expect(f.calls()).toBe(2)
  expect(completed.input.documents).toEqual([{ documentId: reopened.documentId,
    writable: f.reference.writable, selection: f.reference.selection }])
  expect((await f.service.submissions.read(submissionId))?.documents).toEqual(f.send.documents)
  expect((await f.service.engine.read(f.failed.runId))?.documentBindings?.[f.document.documentId])
    .toMatchObject({ path: f.filename, kind: 'course-v10', projectId: f.project.id, epoch: f.document.epoch, savedRevision: 1 })
  expect(await f.documents.internalAPI.read(reopened.documentId)).toMatchObject({ dirty: true,
    model: { project: { title: 'Saved human edit', surfaces: [{ title: 'Later unsaved human edit' }] } } })
  expect((await f.service.events.snapshot(f.send.conversationId)).items.filter(item => item.type === 'document.save')).toEqual([])
})

it('continues the original saved scope after a formal file rename and cold reopen without replay', async () => {
  const f = await fixture()
  await f.documents.saveToPath(f.document.documentId, f.filename)
  await f.documents.settleSaveObservations()
  const root = await f.documents.files.registerRoot(f.root)
  const children = await f.documents.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = children.entries.find(entry => entry.status === 'accessible' && entry.name === 'lesson.h5lesson')!
  if (source.status !== 'accessible') throw new Error('Expected saved fixture entry')
  const renamedPath = path.join(f.root, 'renamed.h5lesson')
  expect(await f.documents.files.rename({ operationId: randomUUID(), workspaceId: root.workspaceId,
    sourceEntryId: source.entryId, name: 'renamed.h5lesson' })).toMatchObject({ status: 'success' })
  expect(await f.documents.internalAPI.read(f.document.documentId)).toMatchObject({
    dirty: false, binding: { path: renamedPath }, model: { project: { id: f.project.id } },
  })
  await f.service.engine.settleDocumentBindings()
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  const cold = f.restart(), reopened = await cold.documents.open(renamedPath)
  const current = await cold.service.operate({ type: 'conversation', workspaceId: f.send.workspaceId,
    conversationId: f.send.conversationId }) as ConversationRecord
  const retried = await cold.service.operate({ ...f.send, submissionId: randomUUID(), expectedRevision: current.revision,
    retryOfRunId: f.failed.runId }) as ExecutionSendResult
  const completed = await cold.service.engine.wait(retried.run!.runId)
  expect(completed.status, JSON.stringify(completed.failure)).toBe('completed')
  expect(completed.input.documents).toEqual([{ documentId: reopened.documentId,
    writable: f.reference.writable, selection: f.reference.selection }])
  expect((await cold.service.runs.read(f.failed.runId))?.documentBindings?.[f.document.documentId])
    .toMatchObject({ path: renamedPath, projectId: f.project.id })
  expect((await cold.service.submissions.read(retried.submission.submissionId))?.documents).toEqual(f.send.documents)
  expect(completed.tools).toEqual([])
  expect(f.calls()).toBe(2)
  expect(await cold.documents.internalAPI.read(reopened.documentId)).toMatchObject({
    dirty: false, undoDepth: 0, model: { project: { id: f.project.id } },
  })
})

it('keeps saved binding durable when display flush fails and continues the reopened original scope without replay', async () => {
  const held = { next: deferred(), finish: deferred() }, f = await fixture('surface', true, held)
  const firstDisplayed = deferred(), displayRejected = deferred()
  const append = f.service.events.batchAppend.bind(f.service.events)
  let rejectDisplay = false, rejectedDisplay = false, displayFailures = 0, failedFlushes = 0
  vi.spyOn(f.service.events, 'batchAppend').mockImplementation(async inputs => {
    const display = inputs.some(input => input.type === 'text' && input.data.status === 'running')
    if (display && rejectDisplay && !rejectedDisplay) {
      rejectedDisplay = true; displayFailures++; displayRejected.resolve()
      throw new Error('display persistence failed')
    }
    const events = await append(inputs)
    if (display) firstDisplayed.resolve()
    return events
  })
  const flush = DisplayEventBuffer.prototype.flush
  vi.spyOn(DisplayEventBuffer.prototype, 'flush').mockImplementation(async function () {
    try { await flush.call(this) }
    catch (error) { failedFlushes++; throw error }
  })
  await f.edit(f.document.documentId, [{ type: 'project.title.set', title: 'Saved despite display failure' }])
  const streamed = await f.retry()
  try {
    await firstDisplayed.promise
    rejectDisplay = true; held.next.resolve()
    await displayRejected.promise
    // The real buffer records the rejected display batch; the provider stream remains held.
    await f.documents.saveToPath(f.document.documentId, f.filename)
    await f.documents.settleSaveObservations()
    const stored = await f.service.runs.read(streamed.run!.runId)
    const expected = { path: f.filename, kind: 'course-v10', projectId: f.project.id,
      epoch: f.document.epoch, savedRevision: 1 }
    expect(stored?.documentBindings?.[f.document.documentId]).toMatchObject(expected)
    expect((await f.service.runs.read(f.failed.runId))?.documentBindings?.[f.document.documentId]).toMatchObject(expected)
    expect((await f.documents.internalAPI.read(f.document.documentId)).dirty).toBe(false)
  } finally { held.next.resolve(); held.finish.resolve() }
  await f.service.engine.wait(streamed.run!.runId)
  expect(displayFailures).toBe(1); expect(failedFlushes).toBeGreaterThan(0)
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  const reopened = await f.documents.open(f.filename)
  expect(reopened.documentId).not.toBe(f.document.documentId)
  expect(reopened.epoch).not.toBe(f.document.epoch)
  const retried = await f.retry(randomUUID(), streamed.run!.runId)
  expect(retried.run!.runId).not.toBe(streamed.run!.runId)
  const completed = await f.service.engine.wait(retried.run!.runId)
  expect(completed.status, JSON.stringify({ failure: completed.failure, providerCalls: f.calls(),
    displayFailures, failedFlushes })).toBe('completed')
  expect(completed.input.documents).toEqual([{ documentId: reopened.documentId,
    writable: f.reference.writable, selection: f.reference.selection }])
  expect(completed.tools).toEqual([])
  expect(f.calls()).toBe(3)
  expect((await f.service.submissions.read(retried.submission.submissionId))?.documents).toEqual(f.send.documents)
  const snapshot = await f.documents.internalAPI.read(reopened.documentId)
  expect(snapshot).toMatchObject({ undoDepth: 0, model: { project: { id: f.project.id, title: 'Saved despite display failure' } } })
})

it.each(['missing-binding', 'different-project'] as const)('refuses %s without inferring authority from a path or calling the provider again', async reason => {
  const f = await fixture('surface')
  await f.documents.saveToPath(f.document.documentId, f.filename)
  await f.documents.settleSaveObservations()
  if (reason === 'missing-binding') {
    // Save identity is independent of timeline display. Model an old/incomplete run
    // record that really lacks its host association, rather than removing a UI observer.
    const record = (await f.service.runs.read(f.failed.runId))!
    delete record.documentBindings
    await f.service.runs.save(record)
  }
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  if (reason === 'different-project') {
    const other = await f.documents.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Different work', randomUUID),
      resources: { assets: {}, components: {} } }, 'other.h5lesson')
    await f.documents.saveToPath(other.documentId, f.filename, true)
  }
  await f.documents.open(f.filename)
  await expect(f.retry()).rejects.toMatchObject({ code: 'execution-operation-refused' })
  expect(f.calls()).toBe(1)
})

it('maps a saved text range through new-session history and rebinds only the internal contentOutput', async () => {
  const f = await fixture('range')
  await f.documents.saveToPath(f.document.documentId, f.filename)
  await f.documents.settleSaveObservations()
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  const reopened = await f.documents.open(f.filename)
  await f.edit(reopened.documentId, [{ type: 'data.set', instanceId: f.instanceId, path: ['content'], value: { inlines: [{ type: 'text', text: 'XXABCDEF' }] } }])
  const sent = await f.retry(), completed = await f.service.engine.wait(sent.run!.runId)
  expect(completed.status).toBe('completed')
  expect(completed.input.contentOutput).toMatchObject({ documentId: reopened.documentId, target: { from: 4, to: 6 } })
  const stored = await f.service.submissions.read(sent.submission.submissionId)
  expect(stored?.contentOutput).toEqual(f.send.contentOutput)
  expect(stored?.documents).toEqual(f.send.documents)
  expect(await f.documents.internalAPI.read(reopened.documentId)).toMatchObject({ model: { project: {
    instances: { [f.instanceId]: { data: { content: { inlines: [{ type: 'text', text: 'XXABcontinuedEF' }] } } } },
  } } })
})

it('refuses a text range when the saved checkpoint no longer proves its original position', async () => {
  const f = await fixture('range')
  await f.edit(f.document.documentId, [{ type: 'data.set', instanceId: f.instanceId, path: ['content'], value: { inlines: [{ type: 'text', text: 'XXABCDEF' }] } }])
  await f.documents.saveToPath(f.document.documentId, f.filename)
  await f.documents.settleSaveObservations()
  await f.documents.operate({ type: 'close', documentId: f.document.documentId })
  await expect(f.retry()).rejects.toMatchObject({ code: 'execution-operation-refused' })
  expect(f.calls()).toBe(1)
})
