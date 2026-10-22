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
import { ProgrammaticToolRunner } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { observationModelMessage } from '../../src/main/workbench/execution/observationModelInput'
import type { ObservationResult } from '../../src/shared/workbench/toolPorts'
import type { AgentFileService } from '../../src/core/tools/AgentFileTools'
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

it.each(['blocked', 'recovered', 'cancelled', 'correctable', 'self-claim'] as const)('settles the current remaining goal from real reconcile receipts: %s', async scenario => {
  let turns = 0, executions = 0
  const cancelArrived = deferred(), cancelReleased = deferred()
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (turns === 1) yield response(request, '同步当前预览前先保留已完成修改', [
      { name: 'text.replace', input: { content: 'after' } },
      ...(scenario === 'self-claim' ? [] : [{ name: 'file.reconcile', input: { path: 'lesson.html', choice: 'disk' } }]),
      { name: 'task.note', input: { remaining: ['完成当前预览验证'] } },
    ])
    else if ((scenario === 'recovered' || scenario === 'correctable') && turns === 2) yield response(request, '沿原操作恢复', [
      { name: 'file.reconcile', input: { path: 'lesson.html', choice: 'disk' } },
      { name: 'task.note', input: { remaining: [] } },
    ])
    else if (scenario === 'cancelled' && turns === 2) {
      cancelArrived.resolve(); await cancelReleased.promise; yield response(request, '收到调整前的结果')
    } else if (scenario === 'cancelled' && turns === 3) {
      expect(JSON.stringify(request.messages)).toContain('取消旧HTML同步，只保存report.md')
      yield response(request, '按用户调整保存报告', [{ name: 'file.write', input: { mode: 'create', path: 'report.md', content: '当前报告' } },
        { name: 'task.note', input: { remaining: [] } }])
    } else {
      expect(JSON.stringify(request.messages)).toContain('宿主当前工作记录')
      expect(JSON.stringify(request.messages)).not.toContain('最近工作笔记仍有剩余事项')
      yield response(request, scenario === 'self-claim' ? '我认为软件阻断，无法继续' : '本轮实际结果已说明')
    }
  } }
  const h = await fixture(provider)
  const engine = new ExecutionEngine({ provider, registry: h.registry, gateway: h.gateway,
    runs: new ExecutionRunStore(path.join(h.directory, 'runtime-runs')),
    events: new ExecutionEventStore({ directory: path.join(h.directory, 'runtime-events') }),
    files: { preflightMutation: async (_context: unknown, _name: string, raw: { path: string }) => ({ paths: [path.join(h.directory, raw.path)], outside: false }),
      execute: async (_context: unknown, name: string) => {
        executions++
        if (name === 'file.write') {
          await writeFile(path.join(h.directory, 'report.md'), '当前报告')
          return { data: { status: 'written', path: path.join(h.directory, 'report.md'), saved: true, dirty: false,
            operationId: 'saved-report', beforeVersion: 'none', afterVersion: 'report-version' } }
        }
        if (executions === 1) { if (scenario === 'correctable') throw new Error('请先比较当前文件与磁盘版本'); throw new RangeError('Maximum call stack size exceeded') }
        return { data: { status: 'reconciled', choice: 'disk' } }
      },
    } as unknown as AgentFileService })
  cleanups.push(() => engine.shutdown())
  const started = await engine.start({ ...h.input, permission: 'workspace', workspaceRoot: h.directory })
  if (scenario === 'cancelled') {
    await cancelArrived.promise
    await engine.steer(started.runId, 'cancel-old-html', '取消旧HTML同步，只保存report.md')
    cancelReleased.resolve()
  }
  const ended = await engine.wait(started.runId)
  // A known intermediate runtime error and an advisory old note do not let
  // the host invent a blocked decision after the model's informed reply.
  expect(ended.status).toBe('completed')
  expect(ended.failure).toBeUndefined()
  if (scenario !== 'self-claim') expect(ended.tools.find(tool => tool.call.name === 'file.reconcile')?.result).toMatchObject({ kind: 'error',
    code: scenario === 'correctable' ? 'file-tool-failed' : 'file-tool-runtime-failed' })
  expect(ended.remainingGoal).toBeUndefined()
  expect(turns).toBe(scenario === 'blocked' || scenario === 'self-claim' ? 2 : scenario === 'cancelled' ? 4 : 3)
  expect(executions).toBe(scenario === 'blocked' ? 1 : scenario === 'self-claim' ? 0 : 2)
  if (scenario === 'cancelled') expect(await readFile(path.join(h.directory, 'report.md'), 'utf8')).toBe('当前报告')
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'after' } })
})

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

it('delivers an editable first version without continuing optional export, exhaustive checks or polish', async () => {
  let requests = 0
  const followUps = ['可选导出 HTML', '额外逐页检查所有路径并复位', '继续调整装饰细节']
  const provider: ModelProvider = { async *stream(request) {
    if (++requests === 1) {
      const guidance = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
      expect(guidance).toContain('创作默认迅速交付可继续编辑的可用首版')
      expect(guidance).toContain('用户明确要求终稿、导出或完整验用时，完成其要求再交付')
      yield response(request, '形成可继续编辑的首版', [
        { name: 'text.replace', input: { content: 'after' } },
        { name: 'task.note', input: { remaining: [], followUps } },
      ])
    } else {
      expect(JSON.stringify(request.messages)).not.toContain('最近工作笔记仍有剩余事项')
      yield response(request, '可用首版已完成，可以继续编辑。')
    }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.failure).toBeUndefined()
  expect(final.workingNote).toMatchObject({ remaining: [], followUps })
  expect(final.remainingGoal).toBeUndefined()
  expect(final.tools.map(tool => tool.call.name)).toEqual(['text.replace', 'task.note'])
  expect(requests).toBe(2)
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'after' } })
  expect((await new ExecutionRunStore(path.join(h.directory, 'runs')).read(started.runId))?.workingNote)
    .toMatchObject({ remaining: [], followUps })
})

it('continues required core work even when optional follow-ups are also recorded', async () => {
  let requests = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++requests === 1) yield response(request, '先写首版', [
      { name: 'text.replace', input: { content: 'after' } },
      { name: 'task.note', input: { remaining: ['修复核心内容错误'], followUps: ['可选导出 HTML'] } },
    ])
    else if (requests === 2) {
      expect(JSON.stringify(request.messages)).toContain('宿主当前工作记录')
      expect(JSON.stringify(request.messages)).toContain('修复核心内容错误')
      yield response(request, '修复当前必要错误', [
        { name: 'text.replace', input: { content: 'fixed' } },
        { name: 'task.note', input: { remaining: [] } },
      ])
    } else yield response(request, '核心内容已修复，可用首版已完成。')
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.workingNote).toMatchObject({ remaining: [], followUps: ['可选导出 HTML'] })
  expect(requests).toBe(3)
  expect(h.session.read()).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'fixed' } })
})

it.each(['length', 'interrupted', 'stopped'] as const)('keeps %s process text out of the final reply and never copies history', async kind => {
  let requests = 0
  const startedText = deferred(), release = deferred()
  const provider: ModelProvider = { async *stream(request) {
    requests++
    if (kind === 'length') {
      if (requests === 1) yield { ...response(request, '只有截断片段', [], 'length'), finishDetails: { reason: 'max_output_tokens', limit: 'output' } }
      else {
        expect(JSON.stringify(request.messages)).toContain('generationContinuation')
        expect(JSON.stringify(request.messages)).toContain('max_output_tokens')
        yield response(request, '续接后确认的完整回复')
      }
      return
    }
    yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '正在处理的片段' }
    startedText.resolve()
    if (kind === 'stopped') await release.promise
    else yield { type: 'response.failed', requestId: request.requestId, sequence: 2,
      failure: { kind: 'transport', outcome: 'unknown', code: 'fixture-interrupted', message: '连接中断' } }
  } }
  const h = await fixture(provider), started = await h.engine.start(h.input)
  if (kind === 'stopped') { await startedText.promise; const stopping = h.engine.stop(started.runId); release.resolve(); await stopping }
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe(kind === 'length' ? 'completed' : kind === 'stopped' ? 'stopped' : 'failed')
  expect(executionFinalReply(final)).toBe(kind === 'length' ? '续接后确认的完整回复' : null)
  if (kind === 'length') {
    expect(final.requests[0].finishDetails).toEqual({ reason: 'max_output_tokens', limit: 'output' })
    expect((await projectedReply(final)).record.messages).toEqual([expect.objectContaining({ text: '续接后确认的完整回复' })])
  } else expect((await projectedReply(final)).update).not.toHaveBeenCalled()
  expect(h.session.read()).toMatchObject({ revision: 0, model: { source: 'before' } })
  expect(requests).toBe(kind === 'length' ? 2 : 1)
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
      goal: '给出有限研究结论', sources: [] } }]); return }
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
  const rawRun = JSON.parse(JSON.stringify(await new ExecutionRunStore(path.join(h.directory, 'runs')).read(final.runId)))
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


it('lets a known rejected edit recover through another canonical path without inheriting a failed goal', async () => {
  let turns = 0, target = ''
  const h = await fixture({ async *stream(request) {
    turns++
    if (turns === 1) {
      target = JSON.parse(String(request.messages.find(message => String(message.content).startsWith('当前默认语义目标 target='))!.content).match(/target=("[^"]+")/)![1])
      expect(request.tools?.map(tool => tool.name)).toEqual([...(request.tools ?? [])].map(tool => tool.name).sort((a, b) => a.localeCompare(b)))
      expect(request.tools?.some(tool => tool.name === 'project.read' || tool.name === 'delegate.agent')).toBe(false)
      yield response(request, '尝试直接编辑', [{ name: 'text.replace', input: { content: 'rejected' } }])
    } else if (turns === 2) {
      expect(JSON.stringify(request.messages)).toContain('请换用当前正式目标')
      yield response(request, '改用同一事务的批量入口', [{ name: 'batch', input: { operations: [
        { name: 'text.replace', input: { target, content: 'recovered' } },
      ] } }])
    } else yield response(request, '已完成正文修改。')
  } })
  const execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementationOnce(async () => ({ kind: 'error', code: 'invalid-target', message: '请换用当前正式目标' }))
    .mockImplementation(execute)
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.failure).toBeUndefined()
  expect(turns).toBe(3)
  expect(final.tools[0].result).toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'recovered' } })
})

it('continues a truncated mixed tool response from committed facts and leaves incomplete arguments unexecuted', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) {
      const result = response(request, '截断前完成第一段', [{ name: 'text.replace', input: { content: 'first' } }], 'length')
      const incomplete = { id: 'unfinished-call', name: 'text.replace', argumentsText: '{"content":"unfinished' }
      yield { ...result, finishDetails: { reason: 'max_tokens', limit: 'output' }, toolCalls: [...result.toolCalls, incomplete],
        assistant: { ...result.assistant, tool_calls: [...result.assistant.tool_calls!, { id: incomplete.id, type: 'function', function: { name: incomplete.name, arguments: incomplete.argumentsText } }] } }
    } else if (turns === 2) {
      expect(JSON.stringify(request.messages)).toContain('generationContinuation')
      expect(JSON.stringify(request.messages)).toContain('invalid-tool-arguments')
      yield response(request, '根据已生效第一段继续完成', [{ name: 'text.replace', input: { content: 'complete' } }])
    } else yield response(request, '已完成。')
  } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(turns).toBe(3)
  expect(final.requests[0]).toMatchObject({ finishReason: 'length', finishDetails: { reason: 'max_tokens', limit: 'output' } })
  expect(final.tools.filter(tool => tool.result?.kind === 'document-operation')).toHaveLength(2)
  expect(final.tools.find(tool => tool.providerCallId === 'unfinished-call')?.result).toMatchObject({ kind: 'error', code: 'invalid-tool-arguments' })
  expect(h.session.read()).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'complete' } })
})

it('keeps an unknown effect scoped to its document while an independent authorized document can still change', async () => {
  let turns = 0, runId = '', otherDocument = ''
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '第一处结果待查', [{ name: 'text.replace', input: { content: 'unknown-write' } }])
    else if (turns === 2) {
      expect(JSON.stringify(request.messages)).toContain('tool-outcome-unknown')
      const other = await h.gateway.issueTarget(runId, otherDocument, { kind: 'markdown-range', from: 0, to: 6 })
      yield response(request, '不重放第一处副作用，继续独立任务', [
        { name: 'text.replace', input: { content: 'blocked-replay' } },
        { name: 'batch', input: { operations: [{ name: 'text.replace', input: { target: other, content: 'safe' } }] } },
      ])
    } else yield response(request, '独立修改已完成；第一处原操作结果仍未知，需按原操作查证。')
  } })
  const other = await h.registry.create(h.driver.load(new TextEncoder().encode('before')), 'other.md')
  otherDocument = other.documentId
  const execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementationOnce(async () => ({ kind: 'error', code: 'tool-outcome-unknown', message: '仅第一处效应未知' }))
    .mockImplementation(execute)
  const started = await h.engine.start({ ...h.input, documents: [...h.input.documents,
    { documentId: other.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 6 }] }] })
  runId = started.runId
  const final = await h.engine.wait(runId)
  expect(final.status).toBe('partial')
  expect(final.failure).toBeUndefined()
  expect(turns).toBe(3)
  expect(final.tools[1].result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(final.tools[2].result, JSON.stringify(final.tools.map(tool => ({ call: tool.call, targets: tool.effectTargets, result: tool.result })))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.session.read()).toMatchObject({ revision: 0, model: { source: 'before' } })
  expect(other.read()).toMatchObject({ revision: 1, model: { source: 'safe' } })
})

it('routes programmatic children through the same Engine writer and retains only their requested aggregate in model history', async () => {
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) {
      expect(request.tools?.some(tool => tool.name === 'programmatic.execute')).toBe(false)
      yield response(request, '需要代码组织当前两步', [{ name: 'tools.load', input: { families: ['jobs'] } }])
    } else if (turns === 2) {
      expect(request.tools?.some(tool => tool.name === 'programmatic.execute')).toBe(true)
      yield response(request, '执行工具代码', [{ name: 'programmatic.execute', input: { code: 'fixture runtime runs a canonical edit' } }])
    } else {
      const messages = request.messages.filter(message => message.role === 'tool')
      const receipt = JSON.parse(String(messages.at(-1)!.content))
      expect(receipt).toMatchObject({ kind: 'read', data: { status: 'completed', value: { changed: true }, children: [{ name: 'text.replace', status: 'completed' }] } })
      expect(messages.some(message => String(message.tool_call_id).includes(':ptc:'))).toBe(false)
      yield response(request, '已按当前目标完成修改。')
    }
  } }
  const h = await fixture(provider)
  const engine = new ExecutionEngine({ provider, registry: h.registry, gateway: h.gateway,
    runs: new ExecutionRunStore(path.join(h.directory, 'ptc-runs')), events: new ExecutionEventStore({ directory: path.join(h.directory, 'ptc-events') }),
    programmatic: new ProgrammaticToolRunner({ execute: async input => {
      await input.call('text.replace', { content: 'ptc-after' })
      return { status: 'completed', value: { changed: true } }
    } }) })
  cleanups.push(() => engine.shutdown())
  const started = await engine.start(h.input), final = await engine.wait(started.runId)
  expect(final.failure).toBeUndefined()
  expect(final.status).toBe('completed')
  expect(final.tools.find(tool => tool.call.name === 'text.replace')).toMatchObject({ origin: 'host', state: 'returned', result: { kind: 'document-operation', result: { status: 'applied' } } })
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'ptc-after' } })
  const stored = await new ExecutionRunStore(path.join(h.directory, 'ptc-runs')).read(started.runId)
  expect(stored?.tools.find(tool => tool.call.name === 'text.replace')?.callId).toContain(':ptc:1')
})


it.each([false, true])('reads a partial task programmatic child from its exact durable lineage without replaying the script or writer (insideScript=%s)', async insideScript => {
  let phase = 0, turns = 0, originalRun = '', childId = '', writes = 0
  const provider: ModelProvider = { async *stream(request) {
    turns++
    if (phase === 0 && turns === 1) yield response(request, '执行并保留每个真实子回执', [{ name: 'programmatic.execute', input: { code: 'partial fixture' } }])
    else if (phase === 0) yield response(request, '已保留第一段；第二段原副作用未知，需要查证。')
    else if (turns === 1) yield response(request, '只读取原已完成子调用', insideScript
      ? [{ name: 'programmatic.execute', input: { code: 'read original child fixture' } }]
      : [{ name: 'programmatic.read', input: { runId: originalRun, callId: childId } }])
    else {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      expect(insideScript ? receipt.data.value : receipt).toMatchObject({ kind: 'read', data: { runId: originalRun, callId: childId,
        value: { kind: 'document-operation', result: { status: 'applied' } } } })
      yield response(request, '原已完成子调用已读回；未知原操作没有重放。')
    }
  } }
  const h = await fixture(provider), execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementation(async (run, callId, call) => {
    if (call.name === 'text.replace' && ++writes === 2) return { kind: 'error', code: 'tool-outcome-unknown', message: '第二段原副作用尚未确认' }
    return execute(run, callId, call)
  })
  const engine = new ExecutionEngine({ provider, registry: h.registry, gateway: h.gateway,
    runs: new ExecutionRunStore(path.join(h.directory, 'lineage-runs')), events: new ExecutionEventStore({ directory: path.join(h.directory, 'lineage-events') }),
    programmatic: new ProgrammaticToolRunner({ execute: async input => {
      if (phase === 1) return { status: 'completed', value: await input.call('programmatic.read', { runId: originalRun, callId: childId }) }
      await input.call('text.replace', { content: 'first-part' })
      await input.call('text.replace', { content: 'unknown-part' })
      return { status: 'completed', value: null }
    } }) })
  cleanups.push(() => engine.shutdown())
  const first = await engine.start(h.input), partial = await engine.wait(first.runId)
  expect(partial.status).toBe('partial')
  expect(writes).toBe(2)
  originalRun = partial.runId; childId = partial.tools.find(tool => tool.origin === 'host')!.callId
  phase = 1; turns = 0
  const resumed = await engine.resume(partial.runId, { ...partial.input, taskId: 'readback' }), ended = await engine.wait(resumed.runId)
  expect(ended.taskContinuedFrom).toBe(partial.runId)
  expect(ended.tools.map(tool => tool.call.name)).toEqual(insideScript ? ['programmatic.execute', 'programmatic.read'] : ['programmatic.read'])
  expect(ended.messages.some(message => message.role === 'tool' && String(message.tool_call_id).includes(':ptc:'))).toBe(false)
  expect(ended.failure).toBeUndefined()
  expect(writes).toBe(2)
  expect(h.session.read()).toMatchObject({ revision: 1, model: { source: 'first-part' } })
})


it.each([false, true])('keeps programmatic questions and superseded children out of the native model tool chain (steer=%s)', async steer => {
  const waiting = deferred()
  let turns = 0, questionId = ''
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) yield response(request, '工具代码需要当前任务内选择', [{ name: 'programmatic.execute', input: { code: 'ask then edit fixture' } }])
    else {
      expect(request.messages.some(message => message.role === 'tool' && String(message.tool_call_id).includes(':ptc:'))).toBe(false)
      yield response(request, steer ? '已按新要求只报告当前结果。' : '已按回答完成当前修改。')
    }
  } }
  const h = await fixture(provider)
  const engine = new ExecutionEngine({ provider, registry: h.registry, gateway: h.gateway,
    runs: new ExecutionRunStore(path.join(h.directory, 'question-runs')), events: new ExecutionEventStore({ directory: path.join(h.directory, 'question-events') }),
    programmatic: new ProgrammaticToolRunner({ execute: async input => {
      await input.call('ask_user', { question: '采用当前修改吗？', responseKind: 'confirm', options: [{ label: '采用' }] })
      await input.call('text.replace', { content: 'confirmed' })
      return { status: 'completed', value: 'finished' }
    } }) })
  cleanups.push(() => engine.shutdown())
  engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'waiting') { questionId = event.itemId; waiting.resolve() } })
  const started = await engine.start(h.input)
  await waiting.promise
  if (steer) await engine.steer(started.runId, 'new-task-choice', '改为只报告，不修改正文')
  else await engine.answer({ runId: started.runId, callId: questionId, answer: { choices: [0] } })
  const final = await engine.wait(started.runId)
  expect(final.failure).toBeUndefined()
  expect(final.messages.some(message => message.role === 'tool' && String(message.tool_call_id).includes(':ptc:'))).toBe(false)
  expect(final.tools.find(tool => tool.call.name === 'ask_user')).toMatchObject({ origin: 'host', state: 'returned' })
  expect(h.session.read()).toMatchObject({ revision: steer ? 0 : 1, model: { source: steer ? 'before' : 'confirmed' } })
  if (steer) expect(final.tools.filter(tool => tool.call.name === 'text.replace').every(tool => tool.notInvokedReason === 'steering')).toBe(true)
})


it('exposes an OAuth-style incomplete delta as a pageable retained draft and continues without replay', async () => {
  let turns = 0
  const prefix = '{"content":"未完整写作参数'
  const h = await fixture({ async *stream(request) {
    turns++
    if (turns === 1) {
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'draft-only', name: 'text.replace', argumentsDelta: prefix }
      yield { ...response(request, '只保留已确认正文', [], 'length'), sequence: 2, finishDetails: { reason: 'max_output_tokens', limit: 'output' } }
    } else if (turns === 2) {
      const current = request.messages.findLast(message => String(message.content).startsWith('宿主当前工作记录'))!
      const data = JSON.parse(String(current.content).slice(String(current.content).indexOf('\n') + 1))
      const sourceId = data.currentWork.generationContinuation.unfinishedArguments[0].sourceId
      expect(sourceId).toContain(':draft:')
      yield response(request, '取回原未执行参数', [{ name: 'context.read', input: { sourceId, maxChars: 200 } }])
    } else if (turns === 3) {
      const read = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      expect(read.data).toMatchObject({ state: 'incomplete-prefix', toolName: 'text.replace', text: prefix })
      yield response(request, '修正并完成一次正式调用', [{ name: 'text.replace', input: { content: 'restored draft' } }])
    } else yield response(request, '已从原参数续接并完成。')
  } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.requests[0].argumentDrafts).toEqual([{ state: 'incomplete-prefix', providerCallId: 'draft-only', toolName: 'text.replace', argumentsText: prefix }])
  expect(final.messages[final.requests[0].assistantMessageIndex!].tool_calls).toBeUndefined()
  expect(final.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  expect(h.session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: 'restored draft' } })
})

it('returns an automatic job wait error to the model so independent authorized work can continue', async () => {
  let turns = 0, waits = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '启动原子任务', [{ name: 'delegate.readonly', input: {} }])
    else if (turns === 2) yield response(request, '原子任务尚未交付')
    else if (turns === 3) {
      expect(JSON.stringify(request.messages)).toContain('原作业状态服务暂时不可读')
      yield response(request, '原作业不重发，先处理独立正文', [{ name: 'text.replace', input: { content: 'independent work' } }])
    } else yield response(request, '独立正文已完成；原子任务仍需核对。')
  } })
  const execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementation(async (runId, callId, call) => {
    if (call.name === 'delegate.readonly') return { kind: 'read', data: { job: 'existing-child', status: 'preparing' } }
    if (call.name === 'job.wait') { waits++; return { kind: 'error', code: 'job-status-unavailable', message: '原作业状态服务暂时不可读' } }
    return execute(runId, callId, call)
  })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('partial')
  expect(final.failure).toBeUndefined()
  expect(waits).toBe(1)
  expect(turns).toBe(4)
  expect(h.session.read()).toMatchObject({ revision: 1, model: { source: 'independent work' } })
  expect(final.tools.filter(tool => tool.call.name === 'delegate.readonly')).toHaveLength(1)
})


it.each(['stop', 'steer'] as const)('preserves unexecuted length drafts before a complete tool is interrupted by %s', async action => {
  const entered = deferred(), release = deferred()
  let turns = 0
  const prefix = '{"content":"retained unfinished prefix'
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) {
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 1, id: 'unexecuted-draft', name: 'text.replace', argumentsDelta: prefix }
      yield { ...response(request, '完整调用与未完整调用同时返回', [{ name: 'text.replace', input: { content: 'first' } }], 'length'), sequence: 2,
        finishDetails: { reason: 'max_output_tokens', limit: 'output' } }
    } else {
      expect(JSON.stringify(request.messages)).toContain(':draft:')
      yield response(request, '已保留原现场并按最新要求报告。')
    }
  } })
  const execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementation(async (runId, callId, call) => {
    if (call.name === 'text.replace') { entered.resolve(); await release.promise }
    return execute(runId, callId, call)
  })
  const started = await h.engine.start(h.input)
  await entered.promise
  if (action === 'stop') { const stopping = h.engine.stop(started.runId); release.resolve(); await stopping }
  else { await h.engine.steer(started.runId, 'retain-prefix', '停止扩写，只报告目前已保留的现场'); release.resolve() }
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe(action === 'stop' ? 'stopped' : 'completed')
  expect(final.requests[0].argumentDrafts).toEqual([{ state: 'incomplete-prefix', providerCallId: 'unexecuted-draft', toolName: 'text.replace', argumentsText: prefix }])
  const stored = await new ExecutionRunStore(path.join(h.directory, 'runs')).read(started.runId)
  expect(stored?.requests[0].argumentDrafts).toEqual(final.requests[0].argumentDrafts)
  expect(final.tools.some(tool => tool.providerCallId === 'unexecuted-draft')).toBe(false)
})


it.each([false, true])('reads a stopped run exact full observation and original PNG from its retained tool source on Continue (clip=%s)', async clip => {
  const waiting = deferred()
  let phase = 0, turns = 0, sourceId = ''
  const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`
  const provider: ModelProvider = { async *stream(request, options) {
    turns++
    if (phase === 0 && turns === 1) yield response(request, '捕获一个裁剪观察', [{ name: 'view.observe', input: { target: 'fixture', purpose: 'diagnostic' } }])
    else if (phase === 0) {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      sourceId = receipt.data.fullObservationSource.sourceId
      expect(receipt.data).not.toHaveProperty('fullObservation')
      waiting.resolve()
      await new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))
    } else if (turns === 1) yield response(request, '从同任务原始回执读取完整结构和原图', [{ name: 'context.read', input: { sourceId, maxChars: 20000, imageIndexes: [0] } }])
    else {
      const receipt = JSON.parse(String(request.messages.filter(message => message.role === 'tool').at(-1)!.content))
      expect(receipt.data).toMatchObject({ sourceId, imagesPrepared: 1, images: [{ resourceId: 'original-png' }] })
      const data = JSON.parse(receipt.data.text).data
      expect((data.fullObservation ?? data).elements).toHaveLength(2)
      expect(receipt.data.text).not.toContain(png.toString('base64'))
      expect(request.messages.some(message => Array.isArray(message.content) && message.content.some(part => part && typeof part === 'object'
        && !Array.isArray(part) && part.type === 'image_url' && (part.image_url as { url?: string })?.url === imageDataUrl))).toBe(true)
      yield response(request, '原完整结构与原PNG已精确读回，未重新观察。')
    }
  } }
  const h = await fixture(provider), snapshot = h.session.read(), execute = h.gateway.execute.bind(h.gateway)
  vi.spyOn(h.gateway, 'execute').mockImplementation(async (runId, callId, call) => {
    if (call.name !== 'view.observe') return execute(runId, callId, call)
    const full = { source: 'live', identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: 0, locationId: 'fixture-location' },
      coverage: { width: 3, height: 2 }, structure: ['完整观察独有文字'], diagnostics: [], generation: 1,
      image: { resourceId: 'original-png', mimeType: 'image/png', width: 3, height: 2, byteLength: png.byteLength }, imageDataUrl,
      elements: [{ handle: 'original-one', text: '第一项' }, { handle: 'original-two', text: '第二项' }] }
    const { imageDataUrl: _privatePixels, ...publicFull } = full
    return { kind: 'read', data: clip ? { ...publicFull, image: { resourceId: 'cropped-png', mimeType: 'image/png', width: 1, height: 1 },
      originalImage: full.image, elements: [full.elements[0]], fullObservation: full } : publicFull }
  })
  const resource = vi.spyOn(h.gateway, 'readObservationResource').mockRejectedValue(new Error('旧资源 owner 已清理'))
  const first = await h.engine.start(h.input)
  await waiting.promise
  const stopped = (await h.engine.stop(first.runId))!
  expect(stopped.status).toBe('stopped')
  if (clip) expect(stopped.tools[0].result).toMatchObject({ kind: 'read', data: { fullObservation: { imageDataUrl } } })
  else {
    // Seed the carrier's original full-image message using the same host builder;
    // ordinary captures already store these bytes once instead of in fullObservation.
    const observation = (stopped.tools[0].result as Extract<NonNullable<typeof stopped.tools[0]['result']>, { kind: 'read' }>).data as ObservationResult
    stopped.messages.push(observationModelMessage({ toolCallId: stopped.tools[0].providerCallId, target: 'fixture', observation, bytes: png }))
    await new ExecutionRunStore(path.join(h.directory, 'runs')).save(stopped)
  }
  phase = 1; turns = 0
  const resumed = await h.engine.resume(stopped.runId, { ...stopped.input, taskId: 'read-retained-observation' }), ended = await h.engine.wait(resumed.runId)
  expect(ended.failure).toBeUndefined()
  expect(ended.tools.map(tool => tool.call.name)).toEqual(['context.read'])
  expect(resource).not.toHaveBeenCalled()
  expect(h.session.read().revision).toBe(0)
})


it('blocks only the same scopeless unknown operation while a distinct computation can proceed', async () => {
  let turns = 0
  const calls: string[] = []
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) yield response(request, '先计算一个来源', [{ name: 'compute.run', input: { code: 'print("uncertain")', sources: ['material'] } }])
    else if (turns === 2) yield response(request, '原计算不盲重发，另一项计算可以继续', [
      { name: 'compute.run', input: { sources: ['material'], code: 'print("uncertain")' } },
      { name: 'compute.run', input: { code: 'print("independent")', sources: ['material'] } },
    ])
    else yield response(request, '独立计算已完成；原计算副作用仍需查证。')
  } })
  vi.spyOn(h.gateway, 'execute').mockImplementation(async (_run, _id, call) => {
    const code = String((call.input as { code?: string })?.code)
    calls.push(code)
    return code.includes('uncertain') ? { kind: 'error', code: 'tool-outcome-unknown', message: '原计算结果尚未确认' }
      : { kind: 'read', data: { job: 'independent-result', status: 'ready', artifacts: [{ name: 'result.txt' }] } }
  })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('partial')
  expect(final.failure).toBeUndefined()
  expect(calls).toEqual(['print("uncertain")', 'print("independent")'])
  expect(final.tools[1].result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
  expect(final.tools[2].result).toMatchObject({ kind: 'read', data: { status: 'ready' } })
  expect(turns).toBe(3)
})
