// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GenerationTaskController, type GenerationPrepared } from '../../src/renderer/authoring/generation/generationTaskController'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { generationCandidateSchema, generationCommitReceiptSchema, generationRequestSchema, type GenerationCandidate, type GenerationCommitReceipt, type GenerationRequest } from '../../src/shared/generationContract'
import { localAgentRequestSchema, localAgentResponseSchema, type LocalAgentRequest, type LocalAgentResponse } from '../../src/shared/localAgentContract'
import type { AiUserInput } from '../../src/shared/localAgentInteraction'

type Ports = ConstructorParameters<typeof GenerationTaskController>[0]
type HostResultCall = Extract<LocalAgentRequest, { operation: 'host-result' }>
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Controller unit ports only: no CLI, browser, screenshot or production commit
 * is executed. Preparation and live apply deliberately return different effects. */
function fixture(outcomes: Array<'candidate' | 'answer' | 'candidate-rejected' | 'incomplete'>, applyPolicy: 'auto' | 'preview' = 'auto', intent: 'edit' | 'discuss' | 'plan' = 'edit') {
  let document = createBlankCourseProject({ id: 'controller-unit-project', title: 'Before' })
  const workspace = { version: 1 as const, projectId: document.id, normalizedPath: 'c:/lessons/controller-unit.h5lesson' }
  const owner = { projectId: workspace.projectId, projectPath: workspace.normalizedPath }
  const calls: LocalAgentRequest[] = []
  const requests: GenerationRequest[] = []
  const receipts: GenerationCommitReceipt[] = []
  const previews = new Map<string, { request: GenerationRequest; prepared: GenerationPrepared }>()
  let sessionId = randomUUID(), stage = -1, sequence = 0
  const behavior = {
    async onHostResult(_call: HostResultCall) {},
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
      response = { enabled: true, sessionId }
    } else if (input.operation === 'read') {
      response = { enabled: true, records: [{ version: 1, id: sessionId, adapter: 'codex', workspace, status: 'completed',
        events: [{ version: 1, adapter: 'codex', sessionId, sequence: ++sequence, time: 0, kind: 'completed', payload: {} }] }] }
    } else if (input.operation === 'candidate') {
      const current = requests.at(-1)!
      response = { enabled: true, generationResult: outcomes[stage] === 'candidate'
        ? { kind: 'candidate', requestId: current.requestId, candidate: candidate(current) }
        : outcomes[stage] === 'candidate-rejected' ? { kind: 'candidate-rejected', requestId: current.requestId, candidateId: randomUUID(), finding: 'scope-mismatch：authoringAddress 不属于当前授权目标' }
        : outcomes[stage] === 'incomplete' ? { kind: 'incomplete', requestId: current.requestId, finding: '编辑未完成：本任务没有正式修改回执' }
        : { kind: 'answer', requestId: current.requestId } }
    } else if (input.operation === 'host-result') await behavior.onHostResult(input)
    else if (input.operation === 'input') {
      await behavior.onInput(input.input)
      response = { enabled: true, inputDelivery: {
        taskId: input.input.taskId, epoch: input.input.epoch, workspace, inputId: input.input.inputId,
        turnId: input.input.turnId, status: 'queued', reason: 'unit turn boundary',
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

describe('GenerationTaskController unit task lifecycle', () => {
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

  it('shows an unfulfilled edit answer without retrying, applying or cancelling its terminal task', async () => {
    const f = fixture(['incomplete'])
    await f.controller.start(f.request(), 'claude')
    expect(f.controller.current).toMatchObject({ busy: false, phase: 'failed', notice: expect.stringContaining('编辑未完成') })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.captureNext).not.toHaveBeenCalled()
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
