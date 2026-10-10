// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { ReadonlyTaskRunner } from '../../src/main/workbench/delegation/ReadonlyTaskRunner'
import { conversationHistoryIndex } from '../../src/main/workbench/execution/ConversationHistoryIndex'
import { ExecutionSubmissionStore, type StoredExecutionSubmission } from '../../src/main/workbench/execution/ExecutionSubmissionStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { executionFinalReply } from '../../src/main/workbench/execution/executionOutcome'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'test-only' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'supported' } } }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function response(request: ModelRequest, text: string, calls: Array<{ name: string; input: unknown }> = [], finish = calls.length ? 'tool_calls' : 'stop'):
  Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = calls.map((call, index) => ({ id: `${request.requestId}-${index}`, name: call.name, argumentsText: JSON.stringify(call.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'fixture',
    finishReason: finish, nativeResponse: {}, toolCalls, assistant: { role: 'assistant', content: text,
      ...(calls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
async function fixture(provider: ModelProvider) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-natural-'))
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }), bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const engine = new ExecutionEngine({ provider, registry, gateway, runs: new ExecutionRunStore(path.join(directory, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  cleanups.push(() => engine.shutdown())
  const session = await registry.create(driver.load(new TextEncoder().encode('before')), 'draft.md')
  const input: ExecutionStart = { conversationId: 'conversation', taskId: 'task', instruction: '修改这里', selection,
    documents: [{ documentId: session.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 6 }], selection: [{ kind: 'markdown-range', from: 0, to: 6 }] }],
    contentOutput: { kind: 'content', documentId: session.documentId, target: { kind: 'markdown-range', from: 0, to: 6 } },
    context: [{ role: 'assistant', content: '上一轮的回答，不能成为本次结果。' }] }
  return { directory, driver, registry, gateway, engine, session, input }
}
async function projectedReply(run: ExecutionRunRecord) {
  const record = { conversationId: run.input.conversationId, revision: 0, messages: [] as Array<{ role: string; text: string; runId: string }> }
  const update = vi.fn(async ({ patch }: { patch: { messages: typeof record.messages } }) => { record.messages = patch.messages; record.revision++ })
  const host = { conversations: { listWorkspaces: async () => [{ workspaceId: 'space' }], readConversation: async () => record,
    updateConversation: update } }
  const collect = (ExecutionDesktopService.prototype as unknown as { collectReply(run: ExecutionRunRecord): Promise<void> }).collectReply
  await collect.call(host as never, run)
  await collect.call(host as never, run)
  return { record, update }
}

it('naturally continues after a canonical write and projects only the real final reply without rewriting it', async () => {
  let requests = 0
  const finalText = '# 已修改\n\n保留原始 **Markdown**，以及比旧摘要限制更长的解释。\n' + '原文。'.repeat(400)
  const provider: ModelProvider = { async *stream(request) {
    requests++
    expect((request.tools ?? []).some(tool => tool.name === 'task.finish')).toBe(false)
    expect(request.messages.map(message => message.content).join('\n')).not.toContain('task.finish({})')
    if (requests === 1) { yield response(request, '现在修改正文，稍后给结果。', [{ name: 'text.replace', input: { content: 'after' } }]); return }
    expect(request.messages.some(message => message.role === 'tool' && String(message.content).includes('applied'))).toBe(true)
    yield response(request, finalText)
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'after' } })
  expect(requests).toBe(2)
  expect(executionFinalReply(final)).toBe(finalText)
  expect(final.requests.every(request => request.assistantMessageIndex! >= final.initialMessageCount)).toBe(true)
  const { record, update } = await projectedReply(final)
  expect(record.messages).toEqual([expect.objectContaining({ role: 'assistant', text: finalText, runId: final.runId })])
  expect(update).toHaveBeenCalledOnce()
})

it.each(['length', 'interrupted', 'stopped'] as const)('keeps %s process text out of the final reply and never copies history', async kind => {
  let requests = 0
  const startedText = deferred(), release = deferred()
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (kind === 'length') { yield response(request, '只有截断片段', [], 'length'); return }
    yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '正在处理的片段' }
    startedText.resolve()
    if (kind === 'stopped') await release.promise
    else yield { type: 'response.failed', requestId: request.requestId, sequence: 2,
      failure: { kind: 'transport', outcome: 'unknown', code: 'fixture-interrupted', message: '连接中断' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input)
  if (kind === 'stopped') { await startedText.promise; const stopping = h.engine.stop(started.runId); release.resolve(); await stopping }
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe(kind === 'length' ? 'partial' : kind === 'stopped' ? 'stopped' : 'failed')
  expect(executionFinalReply(final)).toBeNull()
  expect((await projectedReply(final)).update).not.toHaveBeenCalled()
  expect(h.session.read()).toMatchObject({ revision: 0, model: { source: 'before' } })
  expect(requests).toBe(1)
})

it('ends after an acknowledged known failure and keeps the model explanation without requiring finish approval', async () => {
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) yield response(request, '尝试修改。', [{ name: 'text.replace', input: { content: 'attempt' } }])
    else yield response(request, '目标已被锁定，本次没有修改。')
  } }
  const h = await fixture(provider)
  vi.spyOn(h.gateway, 'execute').mockResolvedValue({ kind: 'error', code: 'target-locked', message: '目标已被锁定' })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('partial')
  expect(turns).toBe(2)
  expect(executionFinalReply(final)).toBe('目标已被锁定，本次没有修改。')
  expect(h.session.read().revision).toBe(0)
})

it.each([false, true])('waits a requested read-only child in software, returning its result or stopping it explicitly (stop=%s)', async stop => {
  const releaseChild = deferred(), waiting = deferred(), childStarted = deferred()
  let childRequests = 0, parentRequests = 0, job = '', childAborted = false
  const childProvider: ModelProvider = { async *stream(request, options) {
    childRequests++; childStarted.resolve()
    await Promise.race([releaseChild.promise, new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => { childAborted = true; resolve() }, { once: true }))])
    if (!options?.signal?.aborted) yield response(request, '只读研究结果：来源已明确。')
  } }
  const parentProvider: ModelProvider = { async *stream(request) {
    parentRequests++
    if (parentRequests === 1) { yield response(request, '', [{ name: 'tools.load', input: { families: ['jobs'] } }]); return }
    if (parentRequests === 2) { yield response(request, '提交研究子任务。', [{ name: 'delegate.readonly', input: {
      goal: '给出有限研究结论', sources: [], budget: { maxOutputTokens: 128, maxDurationMs: 5000 } } }]); return }
    if (parentRequests === 3) {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      job = receipt.data.job
      yield response(request, '子任务尚在进行。'); return
    }
    if (parentRequests === 4) {
      expect(JSON.stringify(request.messages)).toContain('宿主已等待原作业')
      yield response(request, '读取原任务结果。', [{ name: 'delegate.read', input: { job, name: 'report.md' } }]); return
    }
    expect(JSON.stringify(request.messages)).toContain('只读研究结果')
    yield response(request, '只读研究结果：来源已明确。')
  } }
  const h = await fixture(parentProvider)
  const delegation = new DelegationJobService({ directory: path.join(h.directory, 'delegation'), copyRootBase: path.join(h.directory, 'copies'),
    readonlyRunner: new ReadonlyTaskRunner({ provider: childProvider, parentSelection: () => selection }) })
  const images = new ImageGenerationService({ directory: path.join(h.directory, 'images'), provider: { generate: async () => { throw new Error('No image request') } } })
  h.gateway.configureHostServices({ jobs: new HostJobService({ images, delegation }), delegation: {
    availability: () => ({ ready: true, reason: 'fixture readonly' }), startReadonly: input => delegation.startReadonly(input),
    startManaged: input => delegation.startManaged(input), readArtifact: (...args) => delegation.readArtifact(...args),
    cancel: (...args) => delegation.cancel(...args), cancelRun: runId => delegation.cancelRun(runId) } })
  h.engine.subscribe(event => { if (event.type === 'run.state' && event.data.label === '等待原作业完成') waiting.resolve() })
  const started = await h.engine.start({ ...h.input, contentOutput: undefined, documents: [], permission: 'read-only' })
  await childStarted.promise; await waiting.promise
  expect(parentRequests).toBe(3)
  expect((await h.engine.read(started.runId))?.status).toBe('running')
  if (stop) await h.engine.stop(started.runId)
  else releaseChild.resolve()
  const final = await h.engine.wait(started.runId)
  expect(childRequests).toBe(1)
  expect(parentRequests).toBe(stop ? 3 : 5)
  expect(final.status).toBe(stop ? 'stopped' : 'completed')
  expect(executionFinalReply(final)).toBe(stop ? null : '只读研究结果：来源已明确。')
  expect(await delegation.status(started.runId, job)).toMatchObject({ status: stop ? 'cancelled' : 'ready', stopped: stop })
  expect(childAborted).toBe(stop)
  expect(final.tools.some(tool => tool.origin === 'host' && tool.call.name === 'job.wait')).toBe(true)
  expect(h.session.read().revision).toBe(0)
})

it('reads historical captured target labels in memory without rewriting journals or replaying a model/tool', async () => {
  let requests = 0
  const h = await fixture({ async *stream(request) { requests++; yield response(request, '历史最终回答') } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const runFilename = path.join(h.directory, 'runs', `${digest(final.runId)}.json`)
  const rawRun = JSON.parse(await readFile(runFilename, 'utf8'))
  rawRun.input.contentOutput.kind = 'replace-text'
  const oldRunBytes = JSON.stringify(rawRun)
  await writeFile(runFilename, oldRunBytes)
  const runStore = new ExecutionRunStore(path.join(h.directory, 'runs'))
  expect((await runStore.read(final.runId))?.input.contentOutput).toMatchObject({ kind: 'content', target: final.input.contentOutput!.target })
  expect(await readFile(runFilename, 'utf8')).toBe(oldRunBytes)
  expect(await h.engine.recover(final.runId)).toEqual([]) // Terminal runs need no new recovery work.
  expect((await h.engine.read(final.runId))?.status).toBe('completed')
  expect(await readFile(runFilename, 'utf8')).toBe(oldRunBytes)
  expect(requests).toBe(1)
  expect(h.session.read().revision).toBe(0)

  const submission: StoredExecutionSubmission = { schemaVersion: 1, digest: 'old-user-payload', submissionId: h.input.taskId,
    workspaceId: 'space', conversationId: h.input.conversationId, state: 'accepted', mode: 'queue', text: h.input.instruction,
    documents: [], attachments: [], attachmentIds: [], model: { provider: 'fixture', model: 'fixture', accountId: 'fixture', billing: 'unknown' },
    contentOutput: h.input.contentOutput, start: h.input, createdAt: 1, updatedAt: 1, runId: final.runId }
  const rawSubmission = JSON.parse(JSON.stringify(submission))
  rawSubmission.contentOutput.kind = 'replace-text'; rawSubmission.start.contentOutput.kind = 'replace-text'
  const oldSubmissionBytes = JSON.stringify(rawSubmission), directory = path.join(h.directory, 'submissions')
  await mkdir(directory)
  const filename = path.join(directory, `${digest(submission.submissionId)}.json`)
  await writeFile(filename, oldSubmissionBytes)
  const submissions = new ExecutionSubmissionStore(directory)
  expect(await submissions.read(submission.submissionId)).toMatchObject({ contentOutput: { kind: 'content' }, start: { contentOutput: { kind: 'content' } } })
  expect((await submissions.list())[0].contentOutput?.kind).toBe('content')
  expect(await readFile(filename, 'utf8')).toBe(oldSubmissionBytes)
})

it('indexes a final message by request identity even when its text is identical to earlier tool progress', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '相同的文字', [{ name: 'text.replace', input: { content: 'after' } }])
    else yield response(request, '相同的文字')
  } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  const current = { conversationId: h.input.conversationId, messages: [{ messageId: 'reply', role: 'assistant', text: '相同的文字',
    attachmentIds: [], runId: final.runId, createdAt: 1 }] } as unknown as ConversationRecord
  const indexed = await conversationHistoryIndex(current, async () => final)
  expect(indexed.context[0].provenance.id).toBe(`run:${final.runId}:${final.requests.at(-1)!.assistantMessageIndex}`)
  expect(final.requests[0].assistantMessageIndex).not.toBe(final.requests[1].assistantMessageIndex)
})

it.each([false, true])('confirms the current unsaved human draft with an exact ACK before continuing the same captured scope (lateChange=%s)', async lateChange => {
  const asked = deferred()
  let questionCallId = '', turns = 0
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (turns === 1) {
      const data = request.messages.find(message => String(message.content).startsWith('当前默认语义目标 target='))!
      const target = JSON.parse(String(data.content).match(/target=("[^"]+")/)![1])
      yield response(request, '请核对当前稿。', [{ name: 'ask_user', input: { question: '当前稿可以继续吗？', responseKind: 'confirm',
        options: [{ label: '继续' }], currentDraft: [{ target, label: '本段' }] } }]); return
    }
    if (turns === 2) {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      expect(receipt.data).toMatchObject({ status: 'answered', selected: [{ index: 0, label: '继续' }],
        currentDraft: [{ content: lateChange ? 'late change' : 'human draft', target: { kind: 'markdown-range', from: 5 } }] })
      yield response(request, '保留人工稿继续。', [{ name: 'text.replace', input: { content: receipt.data.currentDraft[0].content + '!' } }]); return
    }
    yield response(request, '已沿用眼前的人工稿。')
  } }
  const h = await fixture(provider), initial = h.session.read()
  await h.session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: 'left OLD right' } } })
  h.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'waiting') { questionCallId = event.itemId; asked.resolve() } })
  const target = { kind: 'markdown-range' as const, from: 5, to: 8 }
  const started = await h.engine.start({ ...h.input, documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'content', documentId: initial.documentId, target } })
  await asked.promise
  const beforeHuman = h.session.read()
  await h.session.execute({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch, baseRevision: beforeHuman.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 5, to: 8, text: 'human draft' } } })
  const current = h.session.read(), answer = { runId: started.runId, callId: questionCallId, answer: { choices: [0] } }
  await expect(h.engine.answer(answer)).rejects.toThrow('等待编辑确认')
  await expect(h.engine.answer({ ...answer, currentDraft: [{ documentId: 'unrelated', epoch: current.epoch, revision: current.revision }] })).rejects.toThrow('等待编辑确认')
  await expect(h.engine.answer({ ...answer, currentDraft: [{ documentId: current.documentId, epoch: current.epoch, revision: beforeHuman.revision }] })).rejects.toThrow('确认后作品又有修改')
  expect(turns).toBe(1)
  if (lateChange) {
    const prepare = h.gateway.prepareQuestionDraft.bind(h.gateway)
    vi.spyOn(h.gateway, 'prepareQuestionDraft').mockImplementationOnce(async (...args) => {
      const result = await prepare(...args), snapshot = h.session.read()
      await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human',
        mutation: { type: 'command', command: { type: 'markdown.splice', from: 5, to: 16, text: 'late change' } } })
      return result
    })
    await expect(h.engine.answer({ ...answer, currentDraft: [{ documentId: current.documentId, epoch: current.epoch, revision: current.revision }] })).rejects.toThrow('确认后作品又有修改')
    expect(turns).toBe(1)
  }
  const confirmed = h.session.read()
  await h.engine.answer({ ...answer, currentDraft: [{ documentId: confirmed.documentId, epoch: confirmed.epoch, revision: confirmed.revision }] })
  const final = await h.engine.wait(started.runId)
  expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools })).toBe('completed')
  expect(h.session.read().model).toMatchObject({ source: `left ${lateChange ? 'late change' : 'human draft'}! right` })
  expect(h.session.read().undoDepth).toBe(confirmed.undoDepth + 1)
  expect(final.input.contentOutput?.target).toEqual(target) // Original task capture remains frozen.
})

it('current-draft confirmation preserves a read-only range and returns current content without granting sibling writes', async () => {
  const asked = deferred()
  let questionCallId = '', turns = 0, refreshed = ''
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (turns === 1) {
      const data = request.messages.find(message => String(message.content).startsWith('本次固定文档与权限'))!
      const refs = JSON.parse(String(data.content).slice(String(data.content).indexOf('：') + 1))
      yield response(request, '核对本段。', [{ name: 'ask_user', input: { question: '确认当前稿？', responseKind: 'confirm', options: [{ label: '确认' }],
        currentDraft: [{ target: refs[0].selection[0].target }] } }]); return
    }
    if (turns === 2) {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      expect(receipt.data.currentDraft[0].content).toBe('manual')
      refreshed = receipt.data.currentDraft[0].handle
      yield response(request, '', [{ name: 'text.replace', input: { target: refreshed, content: 'attempted write' } }]); return
    }
    const result = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
    expect(result).toMatchObject({ kind: 'error', code: 'not-authorized' })
    yield response(request, '确认已收到，本段保持只读。')
  } }
  const h = await fixture(provider), initial = h.session.read()
  await h.session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: 'left OLD right' } } })
  h.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'waiting') { questionCallId = event.itemId; asked.resolve() } })
  const started = await h.engine.start({ ...h.input, contentOutput: undefined,
    documents: [{ documentId: initial.documentId, writable: [], selection: [{ kind: 'markdown-range', from: 5, to: 8 }] }] })
  await asked.promise
  const before = h.session.read()
  await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 5, to: 8, text: 'manual' } } })
  const confirmed = h.session.read()
  await h.engine.answer({ runId: started.runId, callId: questionCallId, answer: { choices: [0] },
    currentDraft: [{ documentId: confirmed.documentId, epoch: confirmed.epoch, revision: confirmed.revision }] })
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('partial')
  expect(h.session.read()).toMatchObject({ revision: confirmed.revision, undoDepth: confirmed.undoDepth, model: { source: 'left manual right' } })
})

it('waits a requested candidate image through its existing owner and preserves ready bytes after natural completion', async () => {
  const releaseImage = deferred(), imageStarted = deferred(), waiting = deferred()
  let imageRequests = 0, parentRequests = 0, job = ''
  const image = await sharp({ create: { width: 16, height: 12, channels: 4, background: '#4090d0' } }).png().toBuffer()
  const provider: ModelProvider = { async *stream(request) {
    parentRequests++
    if (parentRequests === 1) { yield response(request, '生成一张独立候选图。', [{ name: 'image.generate', input: { prompt: '蓝色背景', output: { format: 'png' } } }]); return }
    if (parentRequests === 2) {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      job = receipt.data.job
      expect(receipt.data.status).toMatch(/preparing|running/)
      yield response(request, '候选图还在生成。'); return
    }
    if (parentRequests === 3) {
      expect(JSON.stringify(request.messages)).toContain('宿主已等待原作业')
      yield response(request, '', [{ name: 'image.status', input: { job } }]); return
    }
    const ready = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
    expect(ready.data).toMatchObject({ status: 'ready', stopped: false, resources: [{ width: 16, height: 12 }] })
    yield response(request, '候选图已生成，保留供你选择。')
  } }
  const h = await fixture(provider)
  const images = new ImageGenerationService({ directory: path.join(h.directory, 'images'), provider: { generate: async (input, _references, options) => {
    imageRequests++; imageStarted.resolve()
    await Promise.race([releaseImage.promise, new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))])
    return { status: 'completed', images: [{ bytes: image, mimeType: 'image/png', filename: 'candidate.png' }], provenance: imageProvenance(input) }
  } } })
  h.gateway.configureHostServices({ jobs: new HostJobService({ images }), images: {
    selection: () => ({ imageModel: 'fixture-image', connection: { ...selection.connection, provider: 'openai', protocol: 'chatgpt-responses',
      baseURL: 'https://chatgpt.com/backend-api/codex', auth: { kind: 'oauth', credentialRef: 'test-only' } } }),
    run: (input, options) => images.start(input, options), read: id => images.read(id), stop: id => images.stop(id),
    readResource: id => images.readResource(id), readReadyResourceFromJob: input => images.readReadyResourceFromJob(input),
  } })
  h.engine.subscribe(event => { if (event.type === 'run.state' && event.data.label === '等待原作业完成') waiting.resolve() })
  const started = await h.engine.start({ ...h.input, instruction: '生成一张候选图供我选择', workspaceRoot: h.directory, contentOutput: undefined, documents: [] })
  await imageStarted.promise; await waiting.promise
  expect(parentRequests).toBe(2)
  releaseImage.resolve()
  const final = await h.engine.wait(started.runId)
  expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools })).toBe('completed')
  expect(imageRequests).toBe(1)
  expect(parentRequests).toBe(4)
  const ready = await images.read(job)
  expect(ready).toMatchObject({ status: 'ready', stopped: false, resources: [{ width: 16, height: 12 }] })
  expect(Buffer.from((await images.readResource(ready.resources[0].resourceId)).bytes)).toEqual(image)
  expect(h.session.read().revision).toBe(0)
  expect(executionFinalReply(final)).toBe('候选图已生成，保留供你选择。')
})

it('current-draft ACK after a shorter human replacement keeps the writable scope inside the same logical range', async () => {
  const h = await fixture({ async *stream() { throw new Error('This authorization regression makes no model request') } })
  const initial = h.session.read()
  await h.session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: 'left original text right' } } })
  const runId = 'current-draft-scope', target = { kind: 'markdown-range' as const, from: 5, to: 18 }
  await h.gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [target] }] })
  try {
    const handle = await h.gateway.issueTarget(runId, initial.documentId, target), before = h.session.read()
    await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.splice', from: 5, to: 18, text: 'manual' } } })
    const current = h.session.read()
    expect(await h.gateway.prepareQuestionDraft(runId, handle, { epoch: current.epoch, revision: current.revision }))
      .toMatchObject({ content: 'manual', target: { kind: 'markdown-range', from: 5, to: 11 } })
    const neighbor = await h.gateway.issueTarget(runId, initial.documentId, { kind: 'markdown-range', from: 12, to: 17 })
    expect(await h.gateway.execute(runId, 'must-not-widen', { name: 'text.replace', input: { target: neighbor, content: 'wrong' } }))
      .toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(h.session.read()).toMatchObject({ revision: current.revision, undoDepth: current.undoDepth, model: { source: 'left manual right' } })
  } finally { await h.gateway.stop(runId) }
})

it.each(['document', 'range'] as const)('same-task completion never swallows a new %s target under the same instruction', async different => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '原目标已改。', [{ name: 'text.replace', input: { content: 'after' } }])
    else yield response(request, '本次目标已核对。')
  } })
  const started = await h.engine.start(h.input), original = await h.engine.wait(started.runId)
  expect(original.status).toBe('completed')
  expect(turns).toBe(2)
  const other = different === 'document' ? await h.registry.create(h.driver.load(new TextEncoder().encode('other')), 'other.md') : h.session
  const target = { kind: 'markdown-range' as const, from: different === 'range' ? 1 : 0, to: 5 }
  const next = await h.engine.start({ ...h.input, taskId: randomUUID(), documents: [{ documentId: other.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'content', documentId: other.documentId, target } }, { runId: started.runId, facts: '', sameTask: true })
  expect((await h.engine.wait(next.runId)).status).toBe('completed')
  expect(turns).toBe(3)
  expect(other.read().model).toMatchObject({ source: different === 'document' ? 'other' : 'after' })
})


it('historical host-only completion restores its receipt but does not swallow a different range in the same document', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '', [{ name: 'text.replace', input: { content: 'after' } }])
    else yield response(request, '本次目标已核对。')
  } })
  const started = await h.engine.start(h.input), historical = await h.engine.wait(started.runId)
  expect(historical.status).toBe('completed')
  expect(turns).toBe(2)
  historical.tools[0]!.origin = 'host'
  historical.requests = [] // Before native final-response indexing, the host-only receipt ended the run.
  await new ExecutionRunStore(path.join(h.directory, 'runs')).save(historical)
  expect(executionFinalReply(historical)).toBeNull()
  const resume = async (from: number) => {
    const target = { kind: 'markdown-range' as const, from, to: 5 }
    const next = await h.engine.start({ ...h.input, taskId: randomUUID(),
      documents: [{ documentId: h.session.documentId, writable: [target], selection: [target] }],
      contentOutput: { kind: 'content', documentId: h.session.documentId, target } },
      { runId: started.runId, facts: '', sameTask: true })
    return h.engine.wait(next.runId)
  }
  const restored = await resume(0)
  expect(restored.status).toBe('completed')
  expect(executionFinalReply(restored)).toBeNull()
  expect(turns).toBe(2)
  expect((await resume(1)).status).toBe('completed')
  expect(turns).toBe(3)
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'after' } })
})
