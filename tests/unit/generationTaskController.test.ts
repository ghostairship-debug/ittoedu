// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GenerationTaskController, generationNativeActivity, type GenerationPrepared } from '../../src/renderer/authoring/generation/generationTaskController'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { GenerationCandidatePreparationError, generationCandidateSchema, generationCommitReceiptSchema, generationRequestSchema, type GenerationAfterCommit, type GenerationCandidate, type GenerationCommitReceipt, type GenerationFailure, type GenerationRequest } from '../../src/shared/generationContract'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentRequest, type LocalAgentResponse } from '../../src/shared/localAgentContract'
import type { AiUserInput } from '../../src/shared/localAgentInteraction'

type Ports = ConstructorParameters<typeof GenerationTaskController>[0]
type HostResultCall = Extract<LocalAgentRequest, { operation: 'host-result' }>
it('reports native tool activity without treating model prose or status heartbeats as tool completion', () => {
  const base = { version: 1 as const, adapter: 'codex' as const, sessionId: randomUUID(), sequence: 1, time: 1000 }
  const call = { ...base, kind: 'tool-call' as const, payload: { id: 'a' } }
  const text = { ...base, time: 2000, kind: 'text' as const, payload: { text: '工具已完成' } }
  expect(generationNativeActivity([call, text], 7000)).toBe('CLI 正在执行 1 项工具；距最近原生活动 5 秒')
  expect(generationNativeActivity([call, { ...base, time: 3000, kind: 'tool-result', payload: { id: 'a' } }], 7000)).toBe('等待 CLI 的下一步结果；距最近原生活动 4 秒')
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Controller unit ports only: no CLI, browser, screenshot or production commit
 * is executed. Preparation and live apply deliberately return different effects. */
function fixture(outcomes: Array<'candidate' | 'answer' | 'candidate-rejected' | 'candidate-format-error' | 'incomplete'>, applyPolicy: 'auto' | 'preview' = 'auto', intent: 'edit' | 'discuss' | 'plan' = 'edit') {
  let document = createBlankCourseProject({ id: 'controller-unit-project', title: 'Before' })
  const workspace = { version: 1 as const, projectId: document.id, normalizedPath: 'c:/lessons/controller-unit.h5lesson' }
  const owner = { projectId: workspace.projectId, projectPath: workspace.normalizedPath }
  const calls: LocalAgentRequest[] = []
  const requests: GenerationRequest[] = []
  const receipts: GenerationCommitReceipt[] = []
  const previews = new Map<string, { request: GenerationRequest; prepared: GenerationPrepared }>()
  let sessionId = randomUUID(), stage = -1, sequence = 0
  const behavior = {
    afterCommit: undefined as GenerationAfterCommit | undefined,
    failure: undefined as GenerationFailure | undefined,
    projectedDeadline: undefined as number | undefined,
    projectHostResult: false,
    async onLaunch(_sessionId: string) {},
    async onHostResult(_call: HostResultCall) {},
    async onRead() {},
    async beforeApply() {},
    async onInput(_input: AiUserInput) {},
    async onCancel(_sessionId: string) {},
  }
  function request(previous?: GenerationRequest) {
    const revision = document.revision
    return generationRequestSchema.parse({
      version: 1, requestId: randomUUID(), workspace, documentRevision: revision, sessionGeneration: 1,
      purpose: 'local-edit', expectedResult: 'auto', intent, applyPolicy, instruction: previous?.instruction ?? '依次修改两个阶段，然后说明结果',
      destinations: [{ kind: 'update', target: { projectId: document.id, documentRevision: revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
        surfaceType: 'slide', surfaceId: document.surfaces[0]!.id, locationId: document.startLocationId, stateId: null,
        owner: 'scene', ownerKey: `scene:${document.startLocationId}`, itemId: 'title', authoringAddress: `${document.startLocationId}/title` } }],
      context: {}, allowedCarriers: ['native'],
      observation: { documentRevision: revision, sessionGeneration: 1, draftEpoch: 0, viewEpoch: 0, runtime: null,
        surfaceId: document.surfaces[0]!.id, locationId: document.startLocationId, stateId: null, source: 'authoring', capturedAt: 0,
        files: [{ fileId: 'unit-image', relativePath: 'unit-image.png', mediaType: 'image/png', byteLength: 1, role: 'image' }] },
    })
  }
  function candidate(input: GenerationRequest) {
    return generationCandidateSchema.parse({ version: 1, requestId: input.requestId, candidateId: randomUUID(), summary: `Stage ${stage + 1}`,
      ...(behavior.afterCommit ? { afterCommit: behavior.afterCommit } : {}),
      steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination: input.destinations[0], input: { operation: 'update' } }] })
  }
  function makePrepared(input: GenerationRequest, value: GenerationCandidate): GenerationPrepared {
    const prepared: GenerationPrepared = { previewId: randomUUID(), candidateId: value.candidateId, summary: value.summary,
      beforeRevision: input.documentRevision, afterRevision: input.documentRevision + 1,
      plannedEffects: [], behaviorEvidence: [], changes: [{ path: 'title', before: document.title, after: value.summary }], omitted: 0,
      document: { ...document, title: value.summary, revision: input.documentRevision + 1 }, resources: { assetFiles: {}, componentPackages: {} } }
    previews.set(prepared.previewId, { request: input, prepared })
    return prepared
  }
  const localAgent = vi.fn(async (raw: LocalAgentRequest): Promise<LocalAgentResponse> => {
    const input = localAgentRequestSchema.parse(raw)
    calls.push(input)
    let response: LocalAgentResponse = { enabled: true }
    if (input.operation === 'generate' || input.operation === 'continue') {
      if (input.operation === 'generate') { sessionId = randomUUID(); sequence = 0 }
      else expect(input.sessionId).toBe(sessionId)
      stage++
      requests.push(input.request)
      const launchedSessionId = sessionId
      await behavior.onLaunch(launchedSessionId)
      response = { enabled: true, sessionId: launchedSessionId }
    } else if (input.operation === 'read') {
      await behavior.onRead()
      response = { enabled: true, records: [{ version: 1, id: sessionId, adapter: 'codex', workspace, status: 'completed',
        ...(behavior.projectedDeadline === undefined ? {} : { task: { taskId: randomUUID(), epoch: 0, intent: 'edit', applyPolicy, status: 'checking', turnId: null, deadlineAt: behavior.projectedDeadline, committedStages: receipts.length } }),
        events: [{ version: 1, adapter: 'codex', sessionId, sequence: ++sequence, time: 0, kind: 'completed', payload: {} }] }] }
    } else if (input.operation === 'candidate') {
      const current = requests.at(-1)!
      response = { enabled: true, generationResult: outcomes[stage] === 'candidate'
        ? { kind: 'candidate', requestId: current.requestId, candidate: candidate(current) }
        : outcomes[stage] === 'candidate-rejected' ? { kind: 'candidate-rejected', requestId: current.requestId, candidateId: randomUUID(), finding: 'scope-mismatch：authoringAddress 不属于当前授权目标', ...(behavior.failure ? { failure: behavior.failure } : {}) }
        : outcomes[stage] === 'candidate-format-error' ? { kind: 'candidate-format-error', requestId: current.requestId, finding: '候选格式错误', excerpt: '{}', ...(behavior.failure ? { failure: behavior.failure } : {}) }
        : outcomes[stage] === 'incomplete' ? { kind: 'incomplete', requestId: current.requestId, finding: '编辑未完成：本任务没有正式修改回执' }
        : { kind: 'answer', requestId: current.requestId } }
    } else if (input.operation === 'host-result') {
      await behavior.onHostResult(input)
      if (behavior.projectHostResult) response = { enabled: true, records: [{ version: 1, id: sessionId, adapter: 'codex', workspace, status: 'completed', hostResult: { ...input.result, receiptDelivery: 'pending' },
        task: { taskId: randomUUID(), epoch: 0, intent: 'edit', applyPolicy, status: input.result.afterCommit?.action === 'finish' ? 'completed' : 'feeding-back', turnId: null,
          deadlineAt: behavior.projectedDeadline ?? null, committedStages: receipts.length, receiptDelivery: 'pending' }, events: [] }] }
    }
    else if (input.operation === 'input') {
      await behavior.onInput(input.input)
      response = { enabled: true, inputDelivery: {
        taskId: input.input.taskId, epoch: input.input.epoch, workspace, inputId: input.input.inputId,
        turnId: input.input.turnId, status: input.input.kind === 'extend-budget' ? 'accepted' : 'queued', reason: 'unit turn boundary',
        ...(input.input.kind === 'extend-budget' ? { deadlineAt: behavior.projectedDeadline } : {}),
      } }
    }
    else if (input.operation === 'cancel') await behavior.onCancel(input.sessionId)
    else throw new Error(`Unexpected controller operation ${input.operation}`)
    return localAgentResponseSchema.parse(response)
  })
  const prepare = vi.fn<Ports['prepare']>(async (input, value) => makePrepared(input, value))
  const apply = vi.fn<Ports['apply']>(previewId => {
    const entry = previews.get(previewId)
    previews.delete(previewId)
    if (!entry || entry.request.documentRevision !== document.revision) return { status: 'stale' }
    const beforeRevision = document.revision
    document = entry.prepared.document
    const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: entry.request.requestId, candidateId: entry.prepared.candidateId,
      workspace, status: 'committed', beforeRevision, afterRevision: document.revision,
      affected: [{ id: `applied-stage-${receipts.length + 1}`, operation: 'updated', ownerKey: `scene:${document.startLocationId}`, authoringAddress: `${document.startLocationId}/title` }],
      resources: { assetIds: [], packageIds: [] } })
    receipts.push(receipt)
    return { status: 'committed', beforeRevision, afterRevision: document.revision, receipt }
  })
  const captureNext = vi.fn<Ports['captureNext']>(async (previous, receipt) => {
    expect(document.revision).toBe(receipt?.afterRevision ?? previous.documentRevision)
    return request(previous)
  })
  const discard = vi.fn(() => { previews.clear() })
  const controller = new GenerationTaskController({ api: { localAgent }, owner, prepare, apply, captureNext, discard,
    isCurrent: input => input.documentRevision === document.revision, beforeApply: () => behavior.beforeApply(), onView: vi.fn() })
  return { controller, request, calls, requests, receipts, previews, behavior, prepare, apply, captureNext, discard, makePrepared,
    hostResults: () => calls.filter((call): call is HostResultCall => call.operation === 'host-result'),
    drift() { document = { ...document, revision: document.revision + 1 } },
    input(kind: 'correct' | 'supplement' = 'supplement'): AiUserInput { return { version: 1, taskId: randomUUID(), epoch: 0, workspace,
      inputId: randomUUID(), turnId: null, kind, text: '把标题再放大一些' } },
  }
}

describe('GenerationTaskController deadline recovery feedback', () => {
  it('discards a candidate still preparing when a correction is accepted and continues with a fresh observation without applying it', async () => {
    const f = fixture(['candidate', 'answer']), preparing = deferred<void>(), prepared = deferred<void>()
    f.prepare.mockImplementationOnce(async (request, candidate) => {
      preparing.resolve(); await prepared.promise
      return f.makePrepared(request, candidate)
    })
    const running = f.controller.start(f.request(), 'codex')
    await preparing.promise
    await f.controller.input(f.input('correct'))
    prepared.resolve(); await running
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.receipts).toEqual([])
    expect(f.hostResults()).toMatchObject([{ result: { status: 'rejected', summary: expect.stringContaining('当前候选未应用') } }])
    expect(f.captureNext).toHaveBeenCalledOnce()
    expect(f.controller.current.phase).toBe('completed')
    expect(f.calls.some(call => call.operation === 'cancel')).toBe(false)
  })
  it('uses the explicitly extended owner deadline through an already waiting stage and candidate preparation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const f = fixture(['candidate', 'answer']), readStarted = deferred<void>(), releaseRead = deferred<void>()
    let reads = 0
    f.behavior.projectedDeadline = 1100
    f.behavior.onRead = async () => { if (++reads === 1) { readStarted.resolve(); await releaseRead.promise } }
    f.behavior.onInput = async input => { expect(input.kind).toBe('extend-budget'); f.behavior.projectedDeadline = 1100 + 20 * 60_000 }
    try {
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await readStarted.promise
      const base = f.input()
      await f.controller.input({ version: 1, taskId: base.taskId, epoch: base.epoch, workspace: base.workspace,
        inputId: base.inputId, turnId: base.turnId, kind: 'extend-budget', minutes: 20 })
      await vi.advanceTimersByTimeAsync(101)
      expect(f.controller.current.busy).toBe(true)
      releaseRead.resolve(); await running
      expect(f.controller.current.phase).toBe('completed')
      expect(f.receipts).toHaveLength(1)
      expect(f.prepare.mock.calls[0]![0].execution!.deadlineAt).toBe(1100 + 20 * 60_000)
      expect(f.requests.at(-1)!.execution!.deadlineAt).toBe(1100 + 20 * 60_000)
    } finally { releaseRead.resolve(); await f.controller.stop(); vi.useRealTimers() }
  })
  it('preserves the stale recovery reason when content changes during checked-result feedback', async () => {
    vi.useFakeTimers()
    const f = fixture(['candidate']), delayed = deferred<void>()
    f.behavior.onHostResult = call => call.result.status === 'checked' ? delayed.promise : Promise.resolve()
    try {
      const running = f.controller.start(f.request(), 'codex')
      await vi.advanceTimersByTimeAsync(0)
      expect(f.controller.current.phase).toBe('checking')
      f.drift(); await vi.advanceTimersByTimeAsync(100); await running
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', error: expect.stringMatching(/^stale：/) })
      expect(f.hostResults().at(-1)?.result.status).toBe('stale')
      expect(f.apply).not.toHaveBeenCalled()
    } finally { delayed.resolve(); vi.useRealTimers() }
  })

  it('stops a hanging native read on document drift and keeps a late result from overwriting a fresh task', async () => {
    vi.useFakeTimers()
    const f = fixture(['candidate', 'answer']), delayed = deferred<void>()
    f.behavior.onRead = () => delayed.promise
    try {
      const old = f.controller.start(f.request(), 'codex')
      await vi.advanceTimersByTimeAsync(0)
      f.drift()
      await vi.advanceTimersByTimeAsync(100)
      await old
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', error: expect.stringContaining('stale：') })
      expect(f.prepare).not.toHaveBeenCalled()
      expect(f.calls.some(call => call.operation === 'cancel')).toBe(true)
      f.behavior.onRead = async () => undefined
      await f.controller.start(f.request(), 'codex')
      const fresh = f.controller.current
      delayed.resolve(); await vi.advanceTimersByTimeAsync(0)
      expect(f.controller.current).toBe(fresh)
      expect(f.controller.current.phase).toBe('completed')
      expect(f.apply).not.toHaveBeenCalled()
    } finally { delayed.resolve(); vi.useRealTimers() }
  })

  it('reports zero modifications when Main reaches the same deadline before the checked-feedback timer', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const f = fixture(['candidate']), pending = deferred<void>()
    f.behavior.onHostResult = async call => {
      if (call.result.status === 'checked') { await pending.promise; throw new Error('Main：本任务已达到执行期限') }
    }
    try {
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(0)
      expect(f.controller.current.phase).toBe('checking')
      // Move the clock without firing renderer timers: Main's rejection wins
      // at the same absolute deadline and must receive the same recovery detail.
      vi.setSystemTime(1100); pending.resolve()
      await vi.advanceTimersByTimeAsync(0); await running
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', canRetryFeedback: false,
        error: expect.stringContaining('宿主结果反馈未保存') })
      expect(f.controller.current.notice).toContain('已完成：本任务零修改，没有已提交的修改')
      expect(f.controller.current.notice).toContain('未完成：保存候选检查结果（Stage 1）')
      expect(f.controller.current.notice).toContain('恢复点：从当前课件重新观察')
      expect(f.controller.current.notice).toContain('旧候选已丢弃，不可直接应用')
      pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      expect(f.apply).not.toHaveBeenCalled(); expect(f.receipts).toEqual([])
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it('lists both actual committed stages and the unfinished third preparation without extending the budget', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const f = fixture(['candidate', 'candidate', 'candidate']), pending = deferred<void>()
    let preparedCount = 0
    f.prepare.mockImplementation(async (request, candidate) => {
      const prepared = f.makePrepared(request, candidate)
      if (++preparedCount === 3) await pending.promise
      return prepared
    })
    try {
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(0)
      expect(f.prepare).toHaveBeenCalledTimes(3); expect(f.receipts).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(100); await running
      const notice = f.controller.current.notice, completed = notice.split('\n未完成：')[0]!
      expect(completed).toContain('1. 已提交：Stage 1')
      expect(completed).toContain('2. 已提交：Stage 2')
      expect(completed).not.toContain('Stage 3')
      expect(notice).toContain('未完成：检查并准入当前候选（Stage 3）')
      expect(notice).toContain('此前合法提交已保留')
      expect(notice).toContain('恢复点：从当前课件重新观察')
      expect(notice).toContain('旧候选已丢弃，不可直接应用')
      expect(f.requests.map(request => request.execution)).toEqual(Array.from({ length: 3 }, () => ({ version: 1, startedAt: 1000, deadlineAt: 1100 })))
      pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      expect(f.apply).toHaveBeenCalledTimes(2); expect(f.receipts).toHaveLength(2)
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it('preserves an applied stage when receipt storage times out and offers record-only recovery', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const f = fixture(['candidate']), pending = deferred<void>()
    f.behavior.afterCommit = { version: 1, action: 'finish' }
    f.behavior.onHostResult = async call => { if (call.commitReceipt) await pending.promise }
    try {
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(0)
      expect(f.receipts).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(100); await running
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', canRetryFeedback: true, receipt: f.receipts[0] })
      expect(f.controller.current.notice).toContain('已完成：1. 已提交：Stage 1')
      expect(f.controller.current.notice).not.toContain('零修改')
      expect(f.controller.current.notice).toContain('未完成：保存已应用阶段的正式回执（Stage 1）')
      expect(f.controller.current.notice).toContain('先重试保存实际结果的回执，只补记录、不重复应用')
      expect(f.controller.current.notice).toContain('从当前课件重新观察')
      pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      await f.controller.retryFeedback()
      expect(f.apply).toHaveBeenCalledTimes(1); expect(f.receipts).toHaveLength(1)
      expect(f.captureNext).not.toHaveBeenCalled()
    } finally { pending.resolve(); vi.useRealTimers() }
  })
})

describe('GenerationTaskController unit task lifecycle', () => {
  it('retains a rejected result after feedback storage failure and retries only that result without applying or starting a turn', async () => {
    const f = fixture(['candidate-rejected'])
    f.behavior.onHostResult = async () => { throw new Error('disk temporarily unavailable') }
    await f.controller.start(f.request(), 'codex')
    expect(f.controller.current).toMatchObject({ phase: 'failed', canRetryFeedback: true })
    expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(0)
    const result = f.hostResults()[0]!.result
    f.behavior.onHostResult = async () => {}
    await f.controller.retryFeedback()
    expect(f.hostResults().at(-1)?.result).toEqual(result)
    expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', canRetryFeedback: false })
    expect(f.requests).toHaveLength(1); expect(f.apply).not.toHaveBeenCalled(); expect(f.captureNext).not.toHaveBeenCalled()
  })
  it('finishes an acknowledged terminal commit without another observation or native turn and adopts the host projection', async () => {
    const f = fixture(['candidate'])
    f.behavior.afterCommit = { version: 1, action: 'finish' }; f.behavior.projectHostResult = true
    await f.controller.start(f.request(), 'codex')
    expect(f.controller.current).toMatchObject({ busy: false, phase: 'completed', record: { task: { status: 'completed', receiptDelivery: 'pending' } } })
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked', 'committed'])
    expect(f.hostResults().at(-1)?.result.afterCommit).toEqual({ version: 1, action: 'finish' })
    expect(f.apply).toHaveBeenCalledOnce(); expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.calls.filter(call => call.operation === 'continue' || call.operation === 'cancel')).toHaveLength(0)
  })

  it('finishes a terminal unchanged receipt without a commit or native round trip', async () => {
    const f = fixture(['candidate']), request = f.request()
    f.behavior.afterCommit = { version: 1, action: 'finish' }
    f.apply.mockImplementation(previewId => {
      const prepared = f.previews.get(previewId)!.prepared
      return { status: 'unchanged', receipt: generationCommitReceiptSchema.parse({ version: 1, requestId: request.requestId, candidateId: prepared.candidateId, workspace: request.workspace,
        status: 'unchanged', beforeRevision: request.documentRevision, afterRevision: request.documentRevision, affected: [], resources: { assetIds: [], packageIds: [] } }) }
    })
    await f.controller.start(request, 'codex')
    expect(f.controller.current).toMatchObject({ phase: 'completed', notice: '已确认当前内容满足要求，无需修改', receipt: { status: 'unchanged' } })
    expect(f.receipts).toHaveLength(0); expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.hostResults().at(-1)?.commitReceipt?.status).toBe('unchanged')
  })

  it('keeps a terminal preview pending until the actual apply and receipt acknowledgement', async () => {
    const f = fixture(['candidate'], 'preview'); f.behavior.afterCommit = { version: 1, action: 'finish' }
    const pending = deferred<void>()
    f.behavior.onHostResult = async call => { if (call.commitReceipt) await pending.promise }
    const running = f.controller.start(f.request(), 'codex')
    await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
    expect(f.apply).not.toHaveBeenCalled(); expect(f.hostResults().at(-1)?.result.status).toBe('checked')
    f.controller.applyPreview()
    await expect.poll(() => f.hostResults().filter(call => call.commitReceipt).length).toBe(1)
    expect(f.controller.current.busy).toBe(true); expect(f.controller.current.phase).not.toBe('completed')
    pending.resolve(); await running
    expect(f.controller.current.phase).toBe('completed'); expect(f.captureNext).not.toHaveBeenCalled()
  })

  it('continues explicit observe but respects finish with inconclusive semantic evidence', async () => {
    for (const dynamic of [false, true]) {
      const f = fixture(['candidate', 'answer'])
      f.behavior.afterCommit = dynamic ? { version: 1, action: 'finish' } : { version: 1, action: 'observe', reason: '检查修改后排版' }
      if (dynamic) f.prepare.mockImplementation(async (request, candidate) => ({ ...f.makePrepared(request, candidate), behaviorEvidence: [{ version: 1, status: 'observed', mode: 'public-props', projectId: request.workspace.projectId,
        documentRevision: request.documentRevision, locationId: 'location', stateId: null, instanceIds: ['instance'], sourceIdentities: { instance: 'source' }, actions: ['update-inputs'], elapsedMs: 1, semanticVerdict: 'requires-review',
        frames: [{ phase: 'running', elapsedMs: 1, capturedAt: 1, stateVersion: 1, publicState: {}, width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }] }] }))
      await f.controller.start(f.request(), 'codex')
      expect(f.hostResults().at(-1)?.result.afterCommit).toEqual(f.behavior.afterCommit)
      expect(f.captureNext).toHaveBeenCalledTimes(dynamic ? 0 : 1)
      expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(dynamic ? 0 : 1)
    }
  })

  it('passes complete preparation failure metadata to the host instead of replacing it with the display summary', async () => {
    const f = fixture(['candidate', 'answer'])
    f.prepare.mockImplementationOnce(async (request, candidate) => { throw new GenerationCandidatePreparationError({ version: 1, stage: 'dynamic-admission', requestId: request.requestId, candidateId: candidate.candidateId,
      stepId: 'animate', tool: 'runtime.source', destination: candidate.steps[0]!.destination, assetIds: ['fallback'], packageIds: [], diagnostics: [{ code: 'dynamic-host-failed', message: '实例恢复失败', path: ['instances', 'runtime', 'resume'] }] }) })
    await f.controller.start(f.request(), 'codex')
    expect(f.hostResults()[0]?.result).toMatchObject({ status: 'rejected', failure: { stage: 'dynamic-admission', stepId: 'animate', tool: 'runtime.source', assetIds: ['fallback'], diagnostics: [{ code: 'dynamic-host-failed', path: ['instances', 'runtime', 'resume'] }] } })
    expect(f.apply).not.toHaveBeenCalled()
  })

  it.each(['candidate-format-error', 'candidate-rejected'] as const)('preserves structured %s diagnostics before preparation', async kind => {
    const f = fixture([kind, 'answer']), request = f.request()
    f.behavior.failure = { version: 1, stage: 'candidate-parse', requestId: request.requestId, stepId: 'title', destination: request.destinations[0],
      diagnostics: [{ code: 'invalid_type', message: 'Expected string', path: ['steps', 0, 'id'] }], assetIds: [], packageIds: [] }
    await f.controller.start(request, 'codex')
    expect(f.hostResults()[0]?.result).toMatchObject({ status: 'rejected', failure: f.behavior.failure })
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled()
  })

  it('retries only an already committed terminal receipt after two storage failures and after the execution deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    try {
      const f = fixture(['candidate']); f.behavior.afterCommit = { version: 1, action: 'finish' }
      f.behavior.onHostResult = async call => { if (call.commitReceipt) throw new Error('disk unavailable') }
      await f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', canRetryFeedback: true, receipt: f.receipts[0] })
      expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(0)
      vi.setSystemTime(2000); f.behavior.onHostResult = async () => {}
      await f.controller.retryFeedback()
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'completed', canRetryFeedback: false })
      const results = f.hostResults().filter(call => call.commitReceipt)
      expect(results).toHaveLength(3); expect(results[0]).toEqual(results[2])
      expect(f.apply).toHaveBeenCalledOnce(); expect(f.captureNext).not.toHaveBeenCalled()
      expect(f.calls.filter(call => call.operation === 'continue' || call.operation === 'cancel')).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })

  it('does not revive a stopped task or resume a nonterminal task when retrying its known receipt', async () => {
    for (const stop of [false, true]) {
      const f = fixture(['candidate'])
      f.behavior.afterCommit = stop ? { version: 1, action: 'finish' } : { version: 1, action: 'observe', reason: '检查布局' }
      f.behavior.onHostResult = async call => { if (call.commitReceipt) throw new Error('disk unavailable') }
      await f.controller.start(f.request(), 'codex')
      if (stop) await f.controller.stop()
      f.behavior.onHostResult = async () => {}
      await f.controller.retryFeedback()
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', canRetryFeedback: false })
      expect(f.apply).toHaveBeenCalledOnce(); expect(f.captureNext).not.toHaveBeenCalled()
      expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(0)
    }
  })

  it('clears only the retry flag when its receipt ACK arrives after Stop without reviving the task', async () => {
    const f = fixture(['candidate']), pending = deferred<void>()
    f.behavior.afterCommit = { version: 1, action: 'finish' }
    f.behavior.onHostResult = async call => { if (call.commitReceipt) throw new Error('disk unavailable') }
    await f.controller.start(f.request(), 'codex')
    f.behavior.onHostResult = async call => { if (call.commitReceipt) await pending.promise }
    const retrying = f.controller.retryFeedback()
    await expect.poll(() => f.hostResults().filter(call => call.commitReceipt).length).toBe(3)
    await f.controller.stop()
    expect(f.controller.current).toMatchObject({ phase: 'cancelled', busy: false, canRetryFeedback: true })
    pending.resolve(); await retrying
    expect(f.controller.current).toMatchObject({ phase: 'cancelled', busy: false, canRetryFeedback: false })
    expect(f.apply).toHaveBeenCalledOnce(); expect(f.captureNext).not.toHaveBeenCalled()
  })

  it('publishes infrastructure failure without waiting for a stalled cancellation IPC', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const pending = deferred<void>()
    try {
      const f = fixture(['candidate'])
      f.behavior.onHostResult = async () => { throw new Error('checked storage unavailable') }
      f.behavior.onCancel = () => pending.promise
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(100)
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', error: expect.stringContaining('checked storage unavailable') })
      expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(1)
      await running
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it.each(['prepare', 'preview', 'before-apply', 'capture-next', 'receipt-ipc', 'read-ipc'] as const)('expires during %s without permitting a late apply or native continuation', async boundary => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const pending = deferred<void>()
    try {
      const f = fixture(['candidate', 'answer'], boundary === 'preview' ? 'preview' : 'auto')
      if (boundary === 'prepare') f.prepare.mockImplementationOnce(async (request, candidate) => { const prepared = f.makePrepared(request, candidate); await pending.promise; return prepared })
      if (boundary === 'before-apply') f.behavior.beforeApply = () => pending.promise
      if (boundary === 'capture-next') f.captureNext.mockImplementationOnce(async () => { await pending.promise; return f.request() })
      if (boundary === 'receipt-ipc') f.behavior.onHostResult = async call => { if (call.commitReceipt) await pending.promise }
      if (boundary === 'read-ipc') f.behavior.onRead = () => pending.promise
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(100)
      await running
      expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', preview: undefined, error: expect.stringContaining('执行预算') })
      const committed = boundary === 'capture-next' || boundary === 'receipt-ipc'
      expect(f.apply).toHaveBeenCalledTimes(committed ? 1 : 0)
      if (boundary === 'receipt-ipc') expect(f.controller.current.canRetryFeedback).toBe(true)
      f.controller.applyPreview(); pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      expect(f.apply).toHaveBeenCalledTimes(committed ? 1 : 0)
      expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(0)
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it('takes an earlier main task deadline and keeps that absolute budget across successful continuations', async () => {
    const normal = fixture(['candidate', 'candidate', 'answer'])
    await normal.controller.start(normal.request(), 'codex')
    expect(normal.requests.map(request => request.execution)).toEqual([normal.requests[0]!.execution, normal.requests[0]!.execution, normal.requests[0]!.execution])
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const pending = deferred<void>()
    try {
      const f = fixture(['candidate'], 'preview'); f.behavior.projectedDeadline = 1050
      const running = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(50); await running
      expect(f.controller.current.phase).toBe('failed'); expect(f.apply).not.toHaveBeenCalled()
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it('keeps a newer preview intact when preparation from an expired task finally resolves', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const pending = deferred<void>()
    try {
      const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
      f.prepare.mockImplementationOnce(async (request, candidate) => { const prepared = f.makePrepared(request, candidate); await pending.promise; return prepared })
      const expired = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(100); await expired
      const current = f.controller.start(f.request(), 'codex')
      await vi.advanceTimersByTimeAsync(0)
      const preview = f.controller.current.preview!
      expect(f.controller.current.phase).toBe('awaiting-apply')
      pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      expect(f.controller.current.preview).toBe(preview); expect(f.previews.has(preview.previewId)).toBe(true)
      f.controller.applyPreview(); await current
      expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0]![0]).toBe(preview.previewId)
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it.each(['stop', 'deadline'] as const)('cancels a late native launch after %s while preserving the newer task preview', async reason => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const pending = deferred<void>()
    try {
      const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
      let oldSessionId: string | undefined
      f.behavior.onLaunch = async sessionId => { if (!oldSessionId) { oldSessionId = sessionId; await pending.promise } }
      const original = f.controller.start({ ...f.request(), execution: { version: 1, startedAt: 1000, deadlineAt: 1100 } }, 'codex')
      await vi.advanceTimersByTimeAsync(0)
      if (reason === 'stop') await f.controller.stop()
      else await vi.advanceTimersByTimeAsync(100)
      await original
      const resumed = f.controller.start(f.request(), 'codex')
      await vi.advanceTimersByTimeAsync(0)
      const preview = f.controller.current.preview!, currentSessionId = f.controller.current.sessionId
      expect(f.controller.current.phase).toBe('awaiting-apply'); expect(currentSessionId).not.toBe(oldSessionId)
      pending.resolve(); await vi.advanceTimersByTimeAsync(0)
      const cancellations = f.calls.filter(call => call.operation === 'cancel')
      expect(cancellations).toEqual([expect.objectContaining({ sessionId: oldSessionId })])
      expect(f.controller.current.preview).toBe(preview); expect(f.controller.current.sessionId).toBe(currentSessionId)
      f.controller.applyPreview(); await resumed
      expect(f.apply).toHaveBeenCalledOnce()
    } finally { pending.resolve(); vi.useRealTimers() }
  })

  it('feeds semantic candidate rejection to the same task without preparing or applying the rejected candidate', async () => {
    const f = fixture(['candidate-rejected', 'candidate', 'answer'])
    await f.controller.start(f.request(), 'claude')
    expect(f.controller.current.phase).toBe('completed')
    expect(f.prepare).toHaveBeenCalledTimes(1)
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.requests.map(request => request.documentRevision)).toEqual([0, 0, 1])
    expect(f.hostResults()[0]!.result).toMatchObject({ status: 'rejected', candidateId: expect.any(String), summary: expect.stringContaining('scope-mismatch') })
    expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(0)
  })

  it('recovers an unfulfilled edit answer on the same task and applies a real candidate', async () => {
    const f = fixture(['incomplete', 'candidate', 'answer'])
    await f.controller.start(f.request(), 'claude')
    expect(f.controller.current).toMatchObject({ busy: false, phase: 'completed' })
    expect(f.prepare).toHaveBeenCalledTimes(1)
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.captureNext).toHaveBeenCalledTimes(2)
    expect(f.calls.filter(call => call.operation === 'generate')).toHaveLength(1)
    expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(2)
    expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(0)
  })

  it('ignores an old input ACK after Stop without correcting or hiding the new task preview', async () => {
    const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
    const pending = deferred<void>()
    f.behavior.onInput = () => pending.promise
    const original = f.controller.start(f.request(), 'codex')
    let resumed: Promise<void> | undefined
    try {
      await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
      const oldInput = f.controller.input(f.input('correct')).then(() => undefined, () => undefined)
      await expect.poll(() => f.calls.filter(call => call.operation === 'input').length).toBe(1)
      await f.controller.stop()
      await original
      resumed = f.controller.start(f.request(), 'codex')
      await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
      const currentRequest = f.controller.current.request!, preview = f.controller.current.preview!
      pending.resolve()
      await oldInput
      expect(f.controller.current).toMatchObject({ busy: true, phase: 'awaiting-apply', request: currentRequest, preview })
      expect(f.hostResults().filter(call => call.result.requestId === currentRequest.requestId).map(call => call.result.status)).toEqual(['checked'])
      expect(f.previews.has(preview.previewId)).toBe(true)
      expect(f.apply).not.toHaveBeenCalled()
      f.controller.applyPreview()
      await resumed
      expect(f.apply).toHaveBeenCalledTimes(1)
      expect(f.apply.mock.calls[0]![0]).toBe(preview.previewId)
      expect(f.controller.current.phase).toBe('completed')
    } finally {
      pending.resolve()
      await f.controller.stop()
      await Promise.all([original, resumed])
    }
  })

  it('ignores an old failure cancel completion after Stop so a new task keeps its view and apply decision', async () => {
    const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
    const pending = deferred<void>()
    let originalSession: string | undefined, firstChecked = true
    f.behavior.onHostResult = async call => {
      if (firstChecked && call.result.status === 'checked') {
        firstChecked = false
        throw new Error('Original checked-result storage failure')
      }
    }
    f.behavior.onCancel = async sessionId => {
      originalSession ??= sessionId
      if (sessionId === originalSession) await pending.promise
    }
    const original = f.controller.start(f.request(), 'codex')
    let resumed: Promise<void> | undefined, stopping: Promise<void> | undefined
    try {
      await expect.poll(() => f.calls.filter(call => call.operation === 'cancel').length).toBe(1)
      stopping = f.controller.stop()
      resumed = f.controller.start(f.request(), 'codex')
      await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
      const currentRequest = f.controller.current.request!, preview = f.controller.current.preview!
      pending.resolve()
      await Promise.all([original, stopping])
      expect(f.controller.current).toMatchObject({ busy: true, phase: 'awaiting-apply', request: currentRequest, preview })
      expect(f.controller.current.error).toBeUndefined()
      expect(f.previews.has(preview.previewId)).toBe(true)
      expect(f.apply).not.toHaveBeenCalled()
      f.controller.applyPreview()
      await resumed
      expect(f.apply).toHaveBeenCalledTimes(1)
      expect(f.apply.mock.calls[0]![0]).toBe(preview.previewId)
      expect(f.controller.current.phase).toBe('completed')
    } finally {
      pending.resolve()
      await f.controller.stop()
      await Promise.all([original, stopping, resumed])
    }
  })

  it('feeds two actual apply receipts and fresh revisions to the same session before a final answer', async () => {
    const f = fixture(['candidate', 'candidate', 'answer'])
    await f.controller.start(f.request(), 'codex')
    expect(f.controller.current).toMatchObject({ phase: 'completed', busy: false, receipt: f.receipts[1] })
    expect(f.apply).toHaveBeenCalledTimes(2)
    expect(f.receipts.map(receipt => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[0, 1], [1, 2]])
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked', 'committed', 'checked', 'committed'])
    expect(f.hostResults().filter(call => call.commitReceipt).map(call => call.commitReceipt)).toEqual(f.receipts)
    expect(f.captureNext.mock.calls.map(([, receipt]) => receipt)).toEqual(f.receipts)
    expect(f.requests.map(input => input.documentRevision)).toEqual([0, 1, 2])
    const launches = f.calls.filter(call => call.operation === 'generate' || call.operation === 'continue')
    expect(launches.map(call => call.operation)).toEqual(['generate', 'continue', 'continue'])
    expect(f.calls.filter(call => call.operation === 'cancel')).toHaveLength(0)
  })

  it('waits for the user to apply a checked preview, then continues with the live receipt', async () => {
    const f = fixture(['candidate', 'answer'], 'preview')
    const running = f.controller.start(f.request(), 'codex')
    await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked'])
    f.controller.applyPreview()
    await running
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.controller.current.phase).toBe('completed')
    expect(f.hostResults().at(-1)?.commitReceipt).toEqual(f.receipts[0])
  })

  it('queues a preview correction, discards that preview, and applies only the corrected next stage', async () => {
    const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
    const running = f.controller.start(f.request(), 'codex')
    await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
    const oldPreview = f.controller.current.preview!.previewId
    const input = f.input('correct')
    expect(await f.controller.input(input)).toMatchObject({ inputId: input.inputId, status: 'queued' })
    await expect.poll(() => f.controller.current.preview?.previewId).not.toBe(oldPreview)
    await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.previews.has(oldPreview)).toBe(false)
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked', 'rejected', 'checked'])
    f.controller.applyPreview()
    await running
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.apply.mock.calls[0]![0]).not.toBe(oldPreview)
    expect(f.controller.current.phase).toBe('completed')
  })
  it('delivers a status inquiry without withdrawing the checked preview or changing its editing goal', async () => {
    const f = fixture(['candidate', 'answer'], 'preview')
    const initial = f.request(), running = f.controller.start(initial, 'codex')
    await vi.waitFor(() => expect(f.controller.current.phase).toBe('awaiting-apply'))
    const preview = f.controller.current.preview, request = f.controller.current.request
    const inquiry = { ...f.input('supplement'), text: '现在怎么样？' }
    expect(await f.controller.input(inquiry, { preservePreview: true })).toMatchObject({ status: 'queued' })
    expect(f.calls.find(call => call.operation === 'input')).toMatchObject({ input: inquiry })
    expect(f.controller.current).toMatchObject({ busy: true, phase: 'awaiting-apply', preview, request })
    expect(f.apply).not.toHaveBeenCalled(); expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.requests).toHaveLength(1)
    expect(f.calls.some(call => call.operation === 'cancel')).toBe(false)
    f.controller.applyPreview(); await running
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.requests[1]!.instruction).toBe(initial.instruction)
    expect(f.controller.current.phase).toBe('completed')
  })

  it('keeps a new task preview and result intact when stopped preparation or checked feedback resolves late', async () => {
    for (const boundary of ['prepare', 'checked-feedback'] as const) {
      const f = fixture(['candidate', 'candidate', 'answer'], 'preview')
      const pending = deferred<void>()
      if (boundary === 'prepare') f.prepare.mockImplementationOnce(async (input, candidate) => {
        const prepared = f.makePrepared(input, candidate)
        await pending.promise
        return prepared
      })
      else {
        let first = true
        f.behavior.onHostResult = async call => {
          if (first && call.result.status === 'checked') { first = false; await pending.promise }
        }
      }
      const stopped = f.controller.start(f.request(), 'codex')
      await expect.poll(() => boundary === 'prepare' ? f.prepare.mock.calls.length : f.hostResults().length).toBe(1)
      await f.controller.stop()
      expect(f.controller.current.phase).toBe('cancelled')
      expect(f.apply).not.toHaveBeenCalled()
      const resumed = f.controller.start(f.request(), 'codex')
      await expect.poll(() => f.controller.current.phase).toBe('awaiting-apply')
      const preview = f.controller.current.preview!
      pending.resolve()
      await stopped
      expect(f.previews.has(preview.previewId), boundary).toBe(true)
      expect(f.controller.current.preview?.previewId, boundary).toBe(preview.previewId)
      expect(f.controller.current.result?.candidateId, boundary).toBe(preview.candidateId)
      f.controller.applyPreview()
      await resumed
      expect(f.apply).toHaveBeenCalledTimes(1)
      expect(f.controller.current.phase).toBe('completed')
    }
  })

  it('retains a committed receipt after feedback storage fails twice without committing again', async () => {
    const f = fixture(['candidate', 'candidate'])
    f.behavior.onHostResult = async call => { if (call.commitReceipt) throw new Error('disk full after commit') }
    await f.controller.start(f.request(), 'codex')
    expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', receipt: f.receipts[0], result: { status: 'committed' } })
    expect(f.controller.current.notice).toContain('已提交的阶段保留')
    expect(f.apply).toHaveBeenCalledTimes(1)
    const feedback = f.hostResults().filter(call => call.commitReceipt)
    expect(feedback).toHaveLength(2)
    expect(feedback[0]).toEqual(feedback[1])
    expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(0)
  })

  it('treats checked-result storage failure as infrastructure failure without rejecting or resubmitting the candidate', async () => {
    const f = fixture(['candidate', 'answer'])
    f.behavior.onHostResult = async call => { if (call.result.status === 'checked') throw new Error('checked result storage unavailable') }
    await f.controller.start(f.request(), 'codex')
    expect(f.controller.current).toMatchObject({ phase: 'failed', busy: false })
    expect(f.controller.current.error).toContain('checked result storage unavailable')
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked'])
    expect(f.captureNext).not.toHaveBeenCalled()
    expect(f.calls.filter(call => call.operation === 'continue')).toHaveLength(0)
  })

  it('blocks a commit if a manual edit changes revision while the pre-apply check is pending', async () => {
    const f = fixture(['candidate', 'answer'])
    const pending = deferred<void>()
    f.behavior.beforeApply = () => pending.promise
    const running = f.controller.start(f.request(), 'codex')
    await expect.poll(() => f.controller.current.phase).toBe('committing')
    f.drift()
    pending.resolve()
    await running
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.controller.current).toMatchObject({ phase: 'failed', result: { status: 'stale' } })
    expect(f.hostResults().map(call => call.result.status)).toEqual(['checked', 'stale'])
    expect(f.captureNext).not.toHaveBeenCalled()
  })

  it.each(['discuss', 'plan'] as const)('finishes a %s reply without preparing writes or promising a plan, and refuses its candidate', async intent => {
    const answer = fixture(['answer'], 'preview', intent)
    await answer.controller.start(answer.request(), 'codex')
    expect(answer.controller.current).toMatchObject({ phase: 'completed', busy: false })
    if (intent === 'plan') expect(answer.controller.current.notice).toBe('本轮已回复，尚未修改课件')
    expect(answer.prepare).not.toHaveBeenCalled()
    expect(answer.apply).not.toHaveBeenCalled()
    expect(answer.hostResults()).toHaveLength(0)
    const candidate = fixture(['candidate'], 'preview', intent)
    await candidate.controller.start(candidate.request(), 'codex')
    expect(candidate.controller.current).toMatchObject({ phase: 'failed', busy: false })
    expect(candidate.prepare).not.toHaveBeenCalled()
    expect(candidate.apply).not.toHaveBeenCalled()
  })
})
