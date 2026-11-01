// @vitest-environment node
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionDelegationProjection } from '../../src/main/workbench/execution/ExecutionDelegationProjection'
import { contextMessageId } from '../../src/main/workbench/execution/ExecutionContextProjection'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'
import { NativeTaskRunner } from '../../src/main/workbench/delegation/NativeTaskRunner'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import { pendingApproval, pendingQuestion } from '../../src/renderer/workbench/executionTimelineModel'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const selection: ModelSelection = { model: 'native-fixture', outputLimit: 16384, parameters: { thinking: { type: 'enabled', budget_tokens: 6000 } },
  connection: { id: 'native-fixture', revision: 1, provider: 'native-fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-only', auth: { kind: 'api-key', credentialRef: 'unused' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'supported' } } }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function completed(request: ModelRequest, calls: Array<{ name: string; input: unknown }> = [], content = '本次结果已说明'):
  Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = calls.map((call, index) => ({ id: `${request.requestId}-${index}`, name: call.name, argumentsText: JSON.stringify(call.input) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'native-fixture-actual',
    finishReason: calls.length ? 'tool_calls' : 'stop', nativeResponse: {}, toolCalls,
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130, reasoningTokens: 12, cachedInputTokens: 25, raw: { fixture: true, detail: { thinking: 12 } } },
    assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
const body = (request: ModelRequest) => request.messages.map(message => String(message.content ?? '')).join('\n')
const childRequest = (request: ModelRequest) => body(request).includes('完成父任务委派的这一个独立工作单元。')
const data = (request: ModelRequest) => request.messages.filter(message => message.role === 'tool').map(message => {
  try { const value = JSON.parse(String(message.content)); return value.kind === 'read' ? value.data as Record<string, unknown> : undefined }
  catch { return undefined }
}).filter((value): value is Record<string, unknown> => !!value)

async function fixture(provider: ModelProvider, resolveSelection?: ConstructorParameters<typeof NativeTaskRunner>[0]['resolveSelection']) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'native-delegation-')), workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(workspaceRoot)
  await fs.writeFile(path.join(workspaceRoot, 'input.txt'), 'source = 7')
  const host = new DocumentHostService(path.join(root, 'documents')), files = new AgentFileService(host)
  const runs = new ExecutionRunStore(path.join(root, 'runs')), grants = new Map<string, ToolRunGrant>()
  let engine!: ExecutionEngine
  const delegation = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase: path.join(root, 'copies'),
    nativeRunner: new NativeTaskRunner({ engine: () => engine, resolveSelection }) })
  const jobs = new HostJobService({ delegation, images: {} as ImageGenerationService })
  host.tools.configureHostServices({ jobs,
    beginRun: async grant => { grants.set(grant.runId, grant) }, stopRun: runId => { grants.delete(runId) },
    taskInputs: { freeze: async (runId, sources) => Promise.all(sources.map(async source => {
      const grant = grants.get(runId)?.fileAccess
      if (!grant?.workspaceRoot) throw new Error('No active source grant')
      const file = await files.readAuthorizedFile({ runId, workspaceRoot: grant.workspaceRoot, permission: grant.permission }, source)
      return { source, name: file.name, bytes: file.bytes, mimeType: 'text/plain', version: 'fixture-source-v1' }
    })) },
    delegation: { availability: () => ({ ready: false, reason: 'No Codex model calls in this fixture' }),
      startManaged: input => delegation.startManaged(input), startNative: input => delegation.startNative(input),
      resumeNative: input => delegation.resumeNative(input), message: (...args) => delegation.message(...args),
      readArtifact: (...args) => delegation.readArtifact(...args), cancel: (...args) => delegation.cancel(...args), cancelRun: runId => delegation.cancelRun(runId) },
  })
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files, runs, events,
    collaborationPeers: runId => delegation.collaborationPeers(runId) })
  const projection = new ExecutionDelegationProjection({ readRun: runId => engine.read(runId), append: event => events.append(event) })
  const unsubscribe = events.subscribe(event => projection.enqueue(event))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const settleProjection = async () => { await events.flushPending(); await projection.flush(); await events.flushPending() }
  cleanups.push(async () => { await engine.shutdown(); await settleProjection(); unsubscribe() })
  const start = (instruction = '父任务：创作并保存成果', permission: 'workspace' | 'ask' = 'workspace') => engine.start({
    conversationId: 'parent-conversation', taskId: 'parent-task', instruction, selection, permission, workspaceRoot, documents: [],
    context: [{ role: 'assistant', content: 'PRIVATE_PARENT_HISTORY_MUST_NOT_BE_FORKED' }] })
  return { root, workspaceRoot, host, files, runs, engine, events, settleProjection, delegation, jobs, start }
}

function interactionEvent(events: ExecutionEventStore, status: string): Promise<ExecutionEvent> {
  return new Promise(resolve => {
    const unsubscribe = events.subscribe(event => {
      if (event.conversationId !== 'parent-conversation' || !event.data.delegationRef || event.data.status !== status) return
      unsubscribe(); resolve(event)
    })
  })
}

it('uses the same Engine for a complete tool loop, source reading, revision, sealed candidate and real parent file delivery', async () => {
  let childTurns = 0, job = '', parentRunId = '', childRunId = ''
  const provider: ModelProvider = { async *stream(request) {
    expect(request.selection).toEqual(selection)
    if (childRequest(request)) {
      expect(body(request)).not.toContain('PRIVATE_PARENT_HISTORY_MUST_NOT_BE_FORKED')
      const parentJob = /"replyToParentJob":"([^"]+)"/.exec(body(request))?.[1]
      job ||= parentJob!
      expect(parentJob).toBe(job)
      const snapshot = await h.delegation.status(parentRunId, job)
      expect(snapshot.childRunId).toBeTruthy() // Receipt is durable before the first child Provider request.
      childRunId = snapshot.childRunId!
      const steps = [
        { name: 'file.read', input: { path: 'input.txt' } },
        { name: 'delegate.message', input: { job: parentJob!, text: '子任务已核对来源，正在形成候选。' } },
        { name: 'file.write', input: { mode: 'create', path: 'candidate.md', content: '# 场景\nsource = 7\n草稿' } },
        { name: 'file.patch', input: { path: 'candidate.md', oldText: '草稿', newText: '已修订' } },
        { name: 'file.read', input: { path: 'candidate.md' } },
      ]
      const step = steps[childTurns++]
      if (childTurns > 1) expect(body(request)).toContain('source = 7')
      yield completed(request, step ? [step] : [], '候选文件已修订并回读'); return
    }
    const receipts = data(request)
    const submitted = receipts.find(value => typeof value.job === 'string' && !value.kind)
    if (!submitted) yield completed(request, [{ name: 'delegate.agent', input: { goal: '完成一个独立场景', sources: ['input.txt'],
      sharedBrief: '沿来源陈述，形成候选正文', role: '场景作者', outputs: ['candidate.md'] } }])
    else if (!receipts.some(value => value.kind === 'delegation' && value.status === 'ready')) {
      job = String(submitted.job)
      yield completed(request, [{ name: 'job.wait', input: { job, milliseconds: 30_000 } }])
    } else if (!receipts.some(value => value.status === 'read' && value.verifiedBytes === true)) {
      yield completed(request, [{ name: 'delegate.read', input: { job, name: 'candidate.md' } }])
    } else if (!receipts.some(value => value.saved === true)) {
      const candidate = receipts.find(value => value.status === 'read' && value.verifiedBytes === true)!
      expect(candidate).toMatchObject({ candidateComplete: true, childRunId, text: '# 场景\nsource = 7\n已修订' })
      yield completed(request, [{ name: 'file.write', input: { mode: 'create', path: 'delivered.md', content: String(candidate.text) } }])
    } else yield completed(request, [], '已审阅候选并保存父任务成果')
  } }
  const h = await fixture(provider)
  const opened = await h.engine.start({ conversationId: 'parent-conversation', taskId: 'parent-task', instruction: '父任务：创作并保存成果',
    selection, permission: 'workspace', workspaceRoot: h.workspaceRoot, documents: [],
    context: [{ role: 'assistant', content: 'PRIVATE_PARENT_HISTORY_MUST_NOT_BE_FORKED' }] }, undefined,
  async record => { parentRunId = record.runId })
  const parent = await h.engine.wait(opened.runId), child = await h.engine.read(childRunId)
  expect(parent.status, JSON.stringify(parent.failure)).toBe('completed')
  expect(child?.status, JSON.stringify(child?.failure)).toBe('completed')
  expect(child?.input.documents).toEqual([])
  expect(child?.input.workspaceRoot).not.toBe(h.workspaceRoot)
  expect(child?.input.conversationId).not.toBe(parent.input.conversationId)
  expect(child?.tools.map(tool => tool.call.name)).toEqual(['file.read', 'delegate.message', 'file.write', 'file.patch', 'file.read'])
  expect(parent.workingNote?.userConstraints).not.toContain('子任务已核对来源，正在形成候选。')
  expect(parent.steering).toEqual(expect.arrayContaining([expect.objectContaining({ senderRunId: childRunId,
    replyJob: job, senderRole: '场景作者' })]))
  expect(await fs.readFile(path.join(h.workspaceRoot, 'input.txt'), 'utf8')).toBe('source = 7')
  expect(await fs.readFile(path.join(h.workspaceRoot, 'delivered.md'), 'utf8')).toBe('# 场景\nsource = 7\n已修订')
  const snapshot = await h.delegation.status(parent.runId, job)
  expect(snapshot).toMatchObject({ executionKind: 'native', candidateComplete: true, childRunId })
  expect(snapshot.usage).toMatchObject({ inputTokens: 600, outputTokens: 180, totalTokens: 780,
    reasoningTokens: 72, cachedInputTokens: 150, raw: { requests: expect.arrayContaining([
      expect.objectContaining({ counters: { fixture: true, detail: { thinking: 12 } } })]) } })
  expect(parent.requests.every(request => !child!.requests.some(own => own.requestId === request.requestId))).toBe(true)
  expect(child?.requests).toHaveLength(6)
}, 30_000)

it('resumes the child history in a new candidate directory, keeps intermediate files, and does not inherit old writer or cancel authority', async () => {
  const releaseParent = deferred(), childEntered = deferred(), releaseChild = deferred()
  let initialTurns = 0, resumedTurns = 0, historySource = ''
  const provider: ModelProvider = { async *stream(request, options) {
    if (!childRequest(request)) {
      await Promise.race([releaseParent.promise, new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))])
      if (!options?.signal?.aborted) yield completed(request); return
    }
    if (!body(request).includes('来自父智能体')) {
      if (initialTurns === 0) { childEntered.resolve(); await releaseChild.promise }
      initialTurns++
      const receipts = data(request)
      const written = (name: string) => receipts.some(value => value.saved === true && typeof value.path === 'string' && path.basename(value.path) === name)
      const step = !written('candidate.md') ? { name: 'file.write', input: { mode: 'create', path: 'candidate.md', content: 'candidate-v1' } }
        : !written('notes.txt') ? { name: 'file.write', input: { mode: 'create', path: 'notes.txt', content: 'private child intermediate' } } : undefined
      yield completed(request, step ? [step] : []); return
    }
    // The Engine exposes its own original messages on demand instead of copying
    // another complete transcript into the new request.
    if (resumedTurns > 0) expect(body(request)).toContain('private child intermediate')
    expect(body(request)).not.toContain('PRIVATE_PARENT_HISTORY_MUST_NOT_BE_FORKED')
    const step = [
      { name: 'context.read', input: { sourceId: historySource } },
      { name: 'file.read', input: { path: 'notes.txt' } },
      { name: 'file.patch', input: { path: 'candidate.md', oldText: 'candidate-v1', newText: 'candidate-v2' } },
    ][resumedTurns++]
    yield completed(request, step ? [step] : [])
  } }
  const h = await fixture(provider), parent = await h.start()
  const originalInput = { goal: '写一个候选', outputs: ['candidate.md'] }
  const started = await h.host.tools.execute(parent.runId, 'native-first', { name: 'delegate.agent', input: originalInput })
  if (started.kind !== 'read') throw new Error(JSON.stringify(started))
  const originalJob = (started.data as { job: string }).job
  await childEntered.promise
  const childRunId = (await h.delegation.status(parent.runId, originalJob)).childRunId!
  const originalRecord = await h.engine.read(childRunId)
  await h.host.tools.execute(parent.runId, 'to-child', { name: 'delegate.message', input: { job: originalJob, text: '继续保持独立来源记录' } })
  const received = await h.engine.read(childRunId)
  expect(received?.steering).toEqual(expect.arrayContaining([expect.objectContaining({ senderRunId: parent.runId,
    replyJob: originalJob, senderRole: '父任务', text: '继续保持独立来源记录' })]))
  await expect(h.delegation.message('unrelated-run', originalJob, 'bad', '不应投递')).rejects.toMatchObject({ code: 'job-not-authorized' })
  releaseChild.resolve()
  const original = await h.delegation.wait(parent.runId, originalJob, 30_000)
  expect(original.status, original.reason).toBe('ready')
  const recorded = await h.engine.read(childRunId)
  const originalMessage = recorded!.messages.findIndex(message => message.role === 'assistant'
    && JSON.stringify(message.tool_calls ?? []).includes('private child intermediate'))
  expect(originalMessage).toBeGreaterThanOrEqual(0)
  historySource = contextMessageId(childRunId, originalMessage)
  const originalSource = await h.delegation.readArtifact(parent.runId, originalJob, 'candidate.md')
  expect(Buffer.from(originalSource.bytes).toString()).toBe('candidate-v1')
  const resumedInput = { job: originalJob, goal: '继续原候选，修订到第二版', outputs: ['candidate.md'] }
  const resumed = await h.host.tools.execute(parent.runId, 'native-resume', { name: 'delegate.resume', input: resumedInput })
  if (resumed.kind !== 'read') throw new Error(JSON.stringify(resumed))
  const resumedJob = (resumed.data as { job: string }).job
  const ended = await h.delegation.wait(parent.runId, resumedJob, 30_000)
  expect(ended.status, ended.reason).toBe('ready')
  const current = await h.engine.read(ended.childRunId!)
  expect(current?.input.conversationId).toBe(originalRecord?.input.conversationId)
  expect(current?.taskContinuedFrom).toBe(childRunId)
  expect(current?.input.workspaceRoot).not.toBe(originalRecord?.input.workspaceRoot)
  expect(current?.input.documents).toEqual([])
  expect(current?.workingNote?.userConstraints).not.toContain('继续保持独立来源记录')
  expect(Buffer.from((await h.delegation.readArtifact(parent.runId, resumedJob, 'candidate.md')).bytes).toString()).toBe('candidate-v2')
  expect(Buffer.from((await h.delegation.readArtifact(parent.runId, originalJob, 'candidate.md')).bytes).toString()).toBe('candidate-v1')
  expect(await fs.readFile(path.join(originalRecord!.input.workspaceRoot!, 'candidate.md'), 'utf8')).toBe('candidate-v1')
  const turns = initialTurns + resumedTurns
  // Job recovery returns its latest durable observation, not the dated start view.
  // Reusing the submission must preserve the original job and child identity.
  expect(await h.host.tools.execute(parent.runId, 'native-resume', { name: 'delegate.resume', input: resumedInput }))
    .toMatchObject({ kind: 'read', data: { job: resumedJob, requestDigest: ended.requestDigest, childRunId: ended.childRunId,
      status: 'ready', candidateComplete: true, artifacts: ended.artifacts } })
  expect(await h.host.tools.execute(parent.runId, 'native-resume', { name: 'delegate.resume', input: { ...resumedInput, goal: '改成另一个任务' } }))
    .toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
  expect(initialTurns + resumedTurns).toBe(turns)
  await h.engine.stop(parent.runId)
  releaseParent.resolve()
}, 30_000)

it('cancels the child through the same Engine and rejects a late response before any candidate write', async () => {
  const childEntered = deferred()
  let job = '', lateResponseReturned = false
  const provider: ModelProvider = { async *stream(request, options) {
    if (childRequest(request)) childEntered.resolve()
    await new Promise<void>(resolve => {
      if (options?.signal?.aborted) resolve()
      else options?.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    if (childRequest(request)) {
      lateResponseReturned = true
      yield completed(request, [{ name: 'file.write', input: { mode: 'create', path: 'late.md', content: 'must not be written' } }])
    }
  } }
  const h = await fixture(provider), parent = await h.start()
  const started = await h.host.tools.execute(parent.runId, 'cancelled-child', { name: 'delegate.agent', input: { goal: '生成候选', outputs: ['late.md'] } })
  if (started.kind !== 'read') throw new Error(JSON.stringify(started))
  job = (started.data as { job: string }).job
  await childEntered.promise
  const childRunId = (await h.delegation.status(parent.runId, job)).childRunId!
  const stopped = await h.engine.stop(parent.runId)
  expect(stopped?.status).toBe('stopped')
  const child = await h.engine.read(childRunId), snapshot = await h.delegation.status(parent.runId, job)
  expect(child?.status).toBe('stopped')
  expect(lateResponseReturned).toBe(true)
  expect(snapshot).toMatchObject({ status: 'cancelled', stopped: true, artifacts: [] })
  expect(child?.tools.some(tool => tool.call.name === 'file.write' && tool.state === 'returned')).toBe(false)
  await expect(fs.access(path.join(child!.input.workspaceRoot!, 'late.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(h.delegation.message(parent.runId, job, 'late-message', '继续')).rejects.toMatchObject({ code: 'run-stopped' })
}, 30_000)

it('projects child questions and approvals into the parent timeline and accepts only the real user decision at the original child', async () => {
  let childTurns = 0
  const provider: ModelProvider = { async *stream(request, options) {
    if (!childRequest(request)) {
      await new Promise<void>(resolve => {
        if (options?.signal?.aborted) resolve()
        else options?.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    childTurns++
    if (childTurns === 1) yield completed(request, [{ name: 'ask_user', input: { question: '候选场景要采用哪种语气？',
      options: [{ label: '正式' }, { label: '活泼' }] } }], 'PRIVATE_CHILD_PROCESS_TEXT')
    else if (childTurns === 2) yield completed(request, [{ name: 'file.create', input: { path: h.workspaceRoot, name: 'unapproved.md' } }])
    else if (childTurns === 3) {
      expect(body(request)).toContain('"status":"answered"')
      expect(body(request)).toContain('活泼')
      expect(body(request)).toContain('user-denied')
      yield completed(request, [{ name: 'file.write', input: { mode: 'create', path: 'candidate.md', content: '用户选择：活泼；候选保存在本子任务目录。' } }])
    } else yield completed(request, [], '已根据用户选择完成候选；外部创建已按拒绝保留原状。')
  } }
  const h = await fixture(provider), parent = await h.start()
  const questionShown = interactionEvent(h.events, 'waiting')
  const started = await h.host.tools.execute(parent.runId, 'interaction-child', { name: 'delegate.agent', input: {
    goal: '请用户选择场景语气，再形成独立候选', outputs: ['candidate.md'],
  } })
  if (started.kind !== 'read') throw new Error(JSON.stringify(started))
  const job = (started.data as { job: string }).job
  const event = await questionShown
  const question = pendingQuestion(await h.events.snapshot('parent-conversation'))!
  expect(question).toMatchObject({ runId: event.data.delegationRef!.runId, callId: event.data.delegationRef!.callId,
    delegation: { parentRunId: parent.runId, jobId: job }, question: { text: '候选场景要采用哪种语气？' } })
  expect(question.runId).not.toBe(parent.runId)
  expect((await h.engine.read(question.runId))?.delegatedBy).toEqual({ runId: parent.runId, jobId: job })
  expect(await h.host.tools.execute(parent.runId, 'suggest-answer', { name: 'delegate.message', input: { job, text: '父智能体建议选择正式。' } }))
    .toMatchObject({ kind: 'read', data: { status: 'accepted' } })
  expect(childTurns).toBe(1)
  expect((await h.engine.read(question.runId))?.tools.find(tool => tool.callId === question.callId)?.state).toBe('executing')
  await expect(h.engine.answer({ runId: parent.runId, callId: question.callId, answer: { choices: [1] } })).rejects.toThrow()
  const approvalShown = interactionEvent(h.events, 'approval')
  await h.engine.answer({ runId: question.runId, callId: question.callId, answer: { choices: [1] } })
  await approvalShown
  const approval = pendingApproval(await h.events.snapshot('parent-conversation'))!
  expect(approval).toMatchObject({ runId: question.runId, delegation: { parentRunId: parent.runId, jobId: job },
    approval: { reason: 'outside-workspace', documents: [path.join(h.workspaceRoot, 'unapproved.md')] } })
  await expect(fs.stat(path.join(h.workspaceRoot, 'unapproved.md'))).rejects.toThrow()
  expect(await h.host.tools.execute(parent.runId, 'suggest-approval', { name: 'delegate.message', input: { job, text: '父智能体希望继续创建。' } }))
    .toMatchObject({ kind: 'read', data: { status: 'accepted' } })
  expect(childTurns).toBe(2)
  expect(pendingApproval(await h.events.snapshot('parent-conversation'))?.callId).toBe(approval.callId)
  await expect(h.engine.decide({ runId: parent.runId, callId: approval.callId, decision: 'allow' })).rejects.toThrow()
  await h.engine.decide({ runId: approval.runId, callId: approval.callId, decision: 'deny' })
  const result = await h.delegation.wait(parent.runId, job, 30_000)
  expect(result.status, result.reason).toBe('ready')
  expect(result.candidateComplete).toBe(true)
  await h.settleProjection()
  const timeline = await h.events.snapshot('parent-conversation')
  expect(pendingQuestion(timeline)).toBeNull()
  expect(pendingApproval(timeline)).toBeNull()
  expect(timeline.items.filter(item => item.data.delegationRef)).toHaveLength(2)
  expect(timeline.items.filter(item => item.data.delegationRef).every(item => item.type === 'tool' && item.runId === parent.runId)).toBe(true)
  expect(JSON.stringify(timeline)).not.toContain('PRIVATE_CHILD_PROCESS_TEXT')
  expect((await h.engine.read(parent.runId))?.status).toBe('running')
  expect(timeline.items.some(item => item.type === 'run.end')).toBe(false)
  await expect(fs.stat(path.join(h.workspaceRoot, 'unapproved.md'))).rejects.toThrow()
  expect(Buffer.from((await h.delegation.readArtifact(parent.runId, job, 'candidate.md')).bytes).toString()).toContain('用户选择：活泼')
  await h.engine.stop(parent.runId)
}, 30_000)

it('sends an explicit child model to the existing Provider and preserves it when resumed without a new selection', async () => {
  const chosen: ModelSelection = { ...structuredClone(selection), model: 'lightweight-child', parameters: { reasoning_effort: 'low' } }
  const childSelections: ModelSelection[] = []
  const provider: ModelProvider = { async *stream(request, options) {
    if (!childRequest(request)) {
      await new Promise<void>(resolve => {
        if (options?.signal?.aborted) resolve()
        else options?.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    childSelections.push(structuredClone(request.selection))
    if (body(request).includes('来自父智能体')) { yield completed(request, [], 'Keep the original candidate'); return }
    const saved = data(request).some(value => value.saved === true)
    if (saved) yield completed(request, [], 'Child candidate saved')
    else yield completed(request, [{ name: 'file.write', input: { mode: 'create', path: 'candidate.md', content: 'lightweight candidate' } }])
  } }
  const resolveSelection = vi.fn(async (model, inherited: ModelSelection) => model ? structuredClone(chosen) : structuredClone(inherited))
  const h = await fixture(provider, resolveSelection), parent = await h.start()
  const first = await h.delegation.startNative({ runId: parent.runId, jobId: 'model-selected', taskId: 'explicit-model',
    permission: 'workspace', intent: { goal: 'Produce the candidate', outputs: ['candidate.md'], model: { connectionId: selection.connection.id, model: chosen.model } }, sources: [] })
  const done = await h.delegation.wait(parent.runId, first.jobId, 3000)
  expect(done).toMatchObject({ status: 'ready', configuredModel: chosen.model, connectionId: selection.connection.id })
  // The new continuation has its own copied workspace and original selected model.
  const resume = await h.delegation.resumeNative({ runId: parent.runId, jobId: 'model-resumed', taskId: 'resume-model',
    sourceRunId: parent.runId, sourceJobId: first.jobId, permission: 'workspace',
    intent: { goal: 'Keep the saved candidate', outputs: ['candidate.md'] }, sources: [] })
  const resumed = await h.delegation.wait(parent.runId, resume.jobId, 3000)
  expect(resumed).toMatchObject({ status: 'ready', configuredModel: chosen.model })
  expect(childSelections.length).toBeGreaterThanOrEqual(3)
  expect(childSelections.every(value => JSON.stringify(value) === JSON.stringify(chosen))).toBe(true)
  expect(resolveSelection.mock.calls.at(-1)?.[1]).toEqual(chosen)
})

it('reprepares a failed-before-start child from a new authorized parent continuation', async () => {
  let childTurns = 0
  const provider: ModelProvider = { async *stream(request, options) {
    if (!childRequest(request)) {
      await new Promise<void>(resolve => {
        if (options?.signal?.aborted) resolve()
        else options?.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    const step = [
      { name: 'file.read', input: { path: 'missing.txt' } },
      { name: 'file.write', input: { mode: 'create', path: 'candidate.md', content: 'recovered candidate' } },
    ][childTurns++]
    yield completed(request, step ? [step] : [])
  } }
  const h = await fixture(provider), parent = await h.start()
  const initial = await h.host.tools.execute(parent.runId, 'missing-source', { name: 'delegate.agent',
    input: { goal: 'Prepare source and write candidate', sources: ['missing.txt'], outputs: ['candidate.md'] } })
  if (initial.kind !== 'read') throw new Error(JSON.stringify(initial))
  const job = (initial.data as { job: string }).job
  const failed = await h.delegation.wait(parent.runId, job, 5000)
  expect(failed).toMatchObject({ status: 'failed', executionStarted: false })
  expect(failed.childRunId).toBeUndefined()
  await h.engine.stop(parent.runId)
  await fs.writeFile(path.join(h.workspaceRoot, 'missing.txt'), 'new authorized material')
  const current = await h.engine.resume(parent.runId, { ...parent.input, instruction: '材料已恢复，继续原任务' })
  const result = await h.host.tools.execute(current.runId, 'reprepare-source', { name: 'delegate.resume',
    input: { job, goal: 'Prepare current material and finish', sources: ['missing.txt'], outputs: ['candidate.md'] } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  const retried = await h.delegation.wait(current.runId, (result.data as { job: string }).job, 5000)
  expect(retried, retried.reason).toMatchObject({ status: 'ready', candidateComplete: true })
  expect(retried.resumedFrom).toBeUndefined()
  expect((await h.engine.read(retried.childRunId!))?.input.documents).toEqual([])
  expect(await h.host.tools.execute(current.runId, 'no-old-cancel', { name: 'job.cancel', input: { kind: 'delegation', job } }))
    .toMatchObject({ kind: 'error' })
  expect(await h.delegation.status(parent.runId, job)).toMatchObject({ status: 'failed', executionStarted: false })
  await h.engine.stop(current.runId)
}, 20_000)

it('discovers late peers and carries a usable reply identity through sibling messages', async () => {
  const parentGate = deferred(), childGate = deferred(), enteredA = deferred(), enteredB = deferred()
  let lateJob = ''
  const provider: ModelProvider = { async *stream(request, options) {
    const until = (gate: ReturnType<typeof deferred>) => Promise.race([gate.promise,
      new Promise<void>(resolve => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))])
    if (!childRequest(request)) { await until(parentGate); if (!options?.signal?.aborted) yield completed(request); return }
    const isA = body(request).includes('"rolePreference":"作者甲"')
    ;(isA ? enteredA : enteredB).resolve()
    await until(childGate)
    if (options?.signal?.aborted) return
    const written = data(request).some(value => value.saved === true)
    if (written && isA) {
      expect(body(request)).toContain(`"job":"${lateJob}"`)
      expect(body(request)).toContain(`"replyJob":"${lateJob}"`)
    }
    yield completed(request, written ? [] : [{ name: 'file.write', input: { mode: 'create', path: 'candidate.md',
      content: isA ? '作者甲的候选' : '作者乙的候选' } }])
  } }
  const h = await fixture(provider), parent = await h.start()
  const start = async (name: string, role: string) => {
    const result = await h.host.tools.execute(parent.runId, name, { name: 'delegate.agent',
      input: { goal: '在独立候选中完成一个模块', role, outputs: ['candidate.md'] } })
    if (result.kind !== 'read') throw new Error(JSON.stringify(result))
    return (result.data as { job: string }).job
  }
  const a = await start('author-a', '作者甲')
  await enteredA.promise
  const aRun = (await h.delegation.status(parent.runId, a)).childRunId!
  expect(await h.delegation.collaborationPeers(aRun)).toEqual([])
  const b = await start('author-b', '作者乙')
  lateJob = b
  await enteredB.promise
  const bRun = (await h.delegation.status(parent.runId, b)).childRunId!
  expect(await h.delegation.collaborationPeers(aRun)).toEqual(expect.arrayContaining([
    expect.objectContaining({ job: b, role: '作者乙', status: 'running' }),
  ]))
  await h.delegation.message(aRun, b, 'ask-coordinate', '请确认共享坐标的单位')
  const question = (await h.engine.read(bRun))!.steering!.find(value => value.text === '请确认共享坐标的单位')!
  expect(question).toMatchObject({ senderRunId: aRun, replyJob: a, senderRole: '作者甲' })
  await h.delegation.message(bRun, question.replyJob!, 'reply-coordinate', '坐标单位为米')
  expect((await h.engine.read(aRun))!.steering).toEqual(expect.arrayContaining([
    expect.objectContaining({ senderRunId: bRun, replyJob: b, senderRole: '作者乙', text: '坐标单位为米' }),
  ]))
  await expect(h.delegation.message(aRun, 'parentJob', 'wrong-job', '不能把字段名当编号'))
    .rejects.toMatchObject({ code: 'unknown-job' })
  await h.delegation.message(parent.runId, a, 'accepted-before-completion', '保留原目标并完成候选')
  childGate.resolve()
  expect(await h.delegation.wait(parent.runId, a, 10_000)).toMatchObject({ status: 'ready' })
  expect(await h.delegation.wait(parent.runId, b, 10_000)).toMatchObject({ status: 'ready' })
  expect(await h.delegation.message(parent.runId, a, 'accepted-before-completion', '保留原目标并完成候选'))
    .toMatchObject({ status: 'accepted', job: a })
  await expect(h.delegation.message(parent.runId, a, 'accepted-before-completion', '用相同提交编号改写正文'))
    .rejects.toThrow('同一调整提交编号')
  await expect(h.delegation.message(parent.runId, a, 'new-after-terminal', '继续写'))
    .rejects.toMatchObject({ code: 'message-terminal' })
  parentGate.resolve()
  await h.engine.stop(parent.runId)
}, 30_000)

it('retains a completed run assembly and reads it through an explicit same-task continuation', async () => {
  const firstGate = deferred()
  let oldSource = '', continuationTurns = 0, continuing = false
  const provider: ModelProvider = { async *stream(request) {
    if (!continuing) { await firstGate.promise; yield completed(request); return }
    yield continuationTurns++ === 0 ? completed(request, [{ name: 'file.read', input: { path: oldSource } }]) : completed(request)
  } }
  const h = await fixture(provider), original = await h.start('第一轮保留装配输入')
  expect(original.assemblyRoot).toBeTruthy()
  expect(original.assemblyRoot).not.toBe(h.workspaceRoot)
  oldSource = path.join(original.assemblyRoot!, 'recovery.md')
  await fs.writeFile(oldSource, 'unfinished adoption input')
  firstGate.resolve()
  expect((await h.engine.wait(original.runId)).status).toBe('completed')
  expect(await fs.readFile(oldSource, 'utf8')).toBe('unfinished adoption input')
  continuing = true
  const continued = await h.engine.resume(original.runId, original.input)
  expect(continued.input.instruction).toBe(original.input.instruction)
  expect(continued.assemblyRoot).not.toBe(original.assemblyRoot)
  const final = await h.engine.wait(continued.runId)
  expect(final.status).toBe('completed')
  expect(final.tools.find(tool => tool.call.name === 'file.read')?.result)
    .toMatchObject({ kind: 'read', data: { text: 'unfinished adoption input' } })
  expect(final.messages.some(message => typeof message.content === 'string' && message.content.includes('readOnlyPrevious')
    && message.content.includes(JSON.stringify(original.assemblyRoot!).slice(1, -1)))).toBe(true)
  expect(await fs.readFile(oldSource, 'utf8')).toBe('unfinished adoption input')
}, 15_000)
