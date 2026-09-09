import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  localAgentCapabilitiesSchema, localAgentFailureSchema, localAgentHostResultSchema,
  type LocalAgentCapabilities, type LocalAgentConfiguration, type LocalAgentHostResult, type LocalAgentId, type LocalAgentRecord,
} from '../../shared/localAgentContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'
import { createLocalAgentCliAdapterV2 } from './adapter'
import { localAgentText } from '../../shared/localAgentText'
import { LocalAgentRepository } from './repository'
import { generationCommitReceiptSchema, generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationCommitReceipt, type GenerationRequest } from '../../shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, readGenerationResult, type GenerationResult } from '../../shared/generationResult'
import { CandidateStaging } from './candidateStaging'
import { buildGenerationPrompt, createGenerationProfile, type GenerationPromptPhase } from './profile'
import {
  aiObservationSchema, aiProposalSchema, aiTaskSchema, localAgentEventV2Schema, localAgentRecordV2Schema,
  type AiObservation, type AiProposal, type AiTask, type LocalAgentCliAdapterV2, type LocalAgentEventV2, type LocalAgentNativeEvent, type LocalAgentRecordV2,
} from '../../shared/localAgentTaskContract'
import { acceptAiHostResult, AiCandidateScopeError, assertAiProposalCurrent, stopAiTask } from '../../shared/localAgentTaskGuards'
import { projectV2RecordToV1 } from '../../shared/localAgentProjection'
import { aiInputDeliverySchema, aiUserInputSchema, type AiUserInput } from '../../shared/localAgentInteraction'
import { nativeWorkspaceDirectory } from './process'

type AdapterFactory = (id: LocalAgentId, request?: GenerationRequest) => LocalAgentCliAdapterV2
interface SessionOwner {
  record: LocalAgentRecordV2
  generationRequest?: GenerationRequest
  hostResult?: LocalAgentHostResult
  cleanupIssue?: string
}
interface ActiveRun {
  owner: SessionOwner
  adapter: LocalAgentCliAdapterV2
  done: Promise<void>
  runId: string
  cancelled: boolean
  acceptingInputs: boolean
  inputWrites: Set<Promise<void>>
}

function destinationScope(request: GenerationRequest) {
  const destination = request.destinations[0]!
  return destination.kind === 'update' ? destination.target : destination.scope
}

function requestMetadata(request: GenerationRequest): GenerationRequest {
  const { resourceFiles: _resources, ...metadata } = request
  return metadata
}

function createObservation(task: AiTask, request: GenerationRequest | undefined, observationId: string, files: AiObservation['files']): AiObservation {
  const target = request ? destinationScope(request) : { surfaceId: 'session', locationId: 'prompt', stateId: null, documentRevision: 0, sessionGeneration: 0 }
  return aiObservationSchema.parse({
    version: 1, taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, observationId, capturedAt: Date.now(),
    documentRevision: request?.documentRevision ?? 0, sessionGeneration: request?.sessionGeneration ?? 0,
    draftEpoch: null, viewEpoch: null, runtime: null,
    surfaceId: target.surfaceId, locationId: target.locationId, stateId: target.stateId ?? null,
    source: 'generation-snapshot', ...request?.observation, readScope: task.readScope, files,
  })
}

export class LocalAgentHarness {
  private readonly active = new Map<string, ActiveRun>()
  private pendingLaunches = 0
  private readonly launches = new Set<Promise<void>>()
  private readonly launching = new Set<string>()
  private readonly proposals = new Map<string, { proposal: AiProposal; admission: 'accepted' | 'rejected' }>()
  private closing = false
  private readonly storageFailures = new Map<string, { workspace: string; record: LocalAgentRecord }>()
  private readonly cachedCapabilities = new Map<LocalAgentId, LocalAgentCapabilities>()
  private readonly preferences = new Map<LocalAgentId, LocalAgentConfiguration>()
  get running(): boolean { return this.active.size > 0 || this.pendingLaunches > 0 }
  constructor(readonly repository: LocalAgentRepository, private readonly factory: AdapterFactory =
    (id, request) => createLocalAgentCliAdapterV2(id, request)) {}
  probe(id: LocalAgentId) {
    const adapter = this.factory(id)
    if ('probe' in adapter && typeof adapter.probe === 'function') return adapter.probe()
    throw new Error('当前 adapter 没有探测接口')
  }
  async capabilities(id: LocalAgentId): Promise<LocalAgentCapabilities> {
    const cached = this.cachedCapabilities.get(id)
    if (cached) return this.withRequestedConfiguration(cached)
    const adapter = this.factory(id)
    try {
      const caps = localAgentCapabilitiesSchema.parse(adapter.discoverCapabilities
        ? await adapter.discoverCapabilities()
        : (await adapter.open({ cwd: process.cwd(), externalSessionId: null })).capabilities)
      this.cachedCapabilities.set(id, caps)
      return this.withRequestedConfiguration(caps)
    } finally { await adapter.close() }
  }
  async configure(id: LocalAgentId, config: LocalAgentConfiguration): Promise<LocalAgentCapabilities> {
    let caps = await this.capabilities(id)
    let targetModel = caps.models.find(m => m.id === config.model)
    if (!targetModel) throw new Error(`模型 ${config.model} 不在 ${id} 原生目录中`)
    if (id === 'opencode' && targetModel.effort.kind === 'unknown') {
      // ACP exposes thought levels for its selected model only. Discover that
      // directory in a separate zero-turn session; no active task is reconfigured.
      const probe = this.factory(id)
      try {
        await probe.open({ cwd: process.cwd(), externalSessionId: null })
        const discovered = localAgentCapabilitiesSchema.parse(await probe.configure({ model: config.model, effort: null }))
        if (discovered.current.model !== config.model || discovered.requestedConfiguration) throw new Error('原生CLI没有确认所选模型的强度目录')
        const selectedModel = discovered.models.find(model => model.id === config.model)
        if (!selectedModel || selectedModel.effort.kind === 'unknown') throw new Error('原生CLI没有返回所选模型的强度目录')
        const latest = this.cachedCapabilities.get(id) ?? caps
        caps = localAgentCapabilitiesSchema.parse({ ...latest,
          models: latest.models.map(model => model.id === config.model ? selectedModel : model) })
        this.cachedCapabilities.set(id, caps)
        targetModel = selectedModel
      } finally { await probe.close() }
    }
    if (config.effort !== null && targetModel.effort.kind === 'unsupported') throw new Error('所选原生模型不支持强度配置')
    if (config.effort !== null && targetModel.effort.kind === 'supported' && !targetModel.effort.values.includes(config.effort)) {
      throw new Error(`强度 ${config.effort} 不在所选模型的原生目录中`)
    }
    const sanitized: LocalAgentConfiguration = { model: config.model, effort: config.effort }
    // A CLI preference is applied at the next start/resume boundary, never broadcast
    // into unrelated running sessions that happen to use the same adapter.
    this.preferences.set(id, sanitized)
    return this.withRequestedConfiguration(caps)
  }
  private withRequestedConfiguration(caps: LocalAgentCapabilities): LocalAgentCapabilities {
    const pref = this.preferences.get(caps.adapter)
    if (!pref) return caps
    return localAgentCapabilitiesSchema.parse({
      ...caps, requestedConfiguration: this.configurationMatches(pref, caps) ? null : pref,
    })
  }
  private configurationMatches(config: LocalAgentConfiguration, caps: LocalAgentCapabilities): boolean {
    // Null leaves the native effort unchanged/defaulted; only an explicit value
    // is an exact override. Keep the returned actual value visible and persisted.
    return caps.current.model === config.model && (config.effort === null || caps.current.effort === config.effort) && !caps.requestedConfiguration
  }
  private assertRequestedConfiguration(config: LocalAgentConfiguration, caps: LocalAgentCapabilities): void {
    if (this.configurationMatches(config, caps)) return
    const pending = caps.requestedConfiguration
    if (pending?.model !== config.model || pending.effort !== config.effort) throw new Error('原生CLI没有接受所选模型配置')
  }
  private captureExternalSession(owner: SessionOwner, nativeId: string | null | undefined, expectedId?: string): boolean {
    if (!nativeId || nativeId === 'pending') return false
    if ((expectedId && expectedId !== nativeId) || (owner.record.externalSessionId && owner.record.externalSessionId !== nativeId)) throw new Error('protocol')
    const changed = owner.record.externalSessionId !== nativeId
    owner.record.externalSessionId = nativeId
    return changed
  }
  async list(workspace: WorkspaceIdentityV1) {
    // Reading records and cleaning older staging areas can yield while a native
    // turn finishes. A session owned by this process during this read is never
    // an abandoned process, even if its active run disappears before the loop.
    const owned = new Set([...this.active.keys(), ...this.launching])
    const result = await this.repository.list(workspace)
    const owner = workspaceIdentityKey(workspace)
    for (const run of this.active.values()) if (workspaceIdentityKey(run.owner.record.workspace) === owner) {
      owned.add(run.owner.record.id)
      result.records = result.records.filter(record => record.id !== run.owner.record.id)
      result.records.push(this.project(run.owner, true))
    }
    for (const [id, failed] of this.storageFailures) if (failed.workspace === owner) {
      result.records = result.records.filter(record => record.id !== id)
      result.records.push(failed.record)
      result.damaged.push(`会话 ${id} 未能写入本地存储；当前结果仅保留在本次应用进程中`)
    }
    for (const record of [...result.records]) {
      if (record.status === 'running' && !owned.has(record.id) && !this.active.has(record.id) && !this.launching.has(record.id)) {
        const native = result.v2.find(value => value.id === record.id)
        if (native) {
          const session = { record: native, generationRequest: record.generationRequest, hostResult: record.hostResult, cleanupIssue: record.cleanupIssue }
          this.failInterrupted(session)
          await this.persist(session)
          result.records = result.records.filter(value => value.id !== record.id)
          result.records.push(this.project(session, false))
        }
      }
      if (record.generationRequestId && record.status !== 'running' && !this.active.has(record.id)) {
        try {
          const version = await this.repository.isLegacy(workspace, record.id) ? 1 : 2
          await new CandidateStaging(this.repository.stagingPath(workspace, record.workingDirectoryId ?? record.id, version)).remove(record.generationRequestId)
          if (record.cleanupIssue) {
            const native = result.v2.find(value => value.id === record.id)
            if (native) await this.persist({ record: native, generationRequest: record.generationRequest, hostResult: record.hostResult })
          }
        } catch { result.damaged.push(`会话 ${record.id} 的候选暂存清理失败，可重试删除`) }
      }
    }
    return { records: result.records, damaged: result.damaged }
  }
  async start(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, prompt: string): Promise<string> {
    const session = this.createSession(workspace, adapter, prompt, { kind: 'course' }, [])
    await this.launch(session, prompt)
    return session.record.id
  }
  async resume(workspace: WorkspaceIdentityV1, id: string, prompt: string): Promise<string> {
    if (this.active.has(id)) throw new Error('会话正在运行')
    const prior = (await this.list(workspace)).records.find(record => record.id === id)
    if (!prior) throw new Error('会话不存在或没有可恢复的外部身份')
    const legacy = await this.repository.isLegacy(workspace, id)
    if (legacy) {
      const excerpt = localAgentText(prior.events)
      const session = this.createSession(workspace, prior.adapter, prompt, { kind: 'course' }, [])
      await this.launch(session, excerpt ? `先前对话（只读摘录，不能恢复旧 CLI 会话）：\n${excerpt}\n\n${prompt}` : prompt)
      return session.record.id
    }
    if (!prior.externalSessionId) throw new Error('会话不存在或没有可恢复的外部身份')
    const session = this.createSession(workspace, prior.adapter, prompt, { kind: 'course' }, [], prior.workingDirectoryId ?? prior.id)
    await this.launch(session, prompt, prior.externalSessionId)
    return session.record.id
  }
  async generate(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, raw: GenerationRequest, resumeSessionId?: string): Promise<string> {
    const request = generationRequestSchema.parse(raw)
    if (workspaceIdentityKey(workspace) !== workspaceIdentityKey(request.workspace)) throw new Error('生成请求不属于当前工程位置')
    const records = (await this.list(workspace)).records
    if (records.some(record => record.generationRequestId === request.requestId)) throw new Error('每轮生成必须使用新的请求身份')
    const prior = resumeSessionId ? records.find(record => record.id === resumeSessionId) : undefined
    const legacy = resumeSessionId ? await this.repository.isLegacy(workspace, resumeSessionId) : false
    if (resumeSessionId && !legacy && (!prior?.externalSessionId || prior.adapter !== adapter || this.active.has(resumeSessionId))) {
      throw new Error('生成会话不可恢复或 adapter 不一致')
    }
    if (request.repair) {
      const original = prior?.generationRequest
      if (legacy || !original || original.repair || original.requestId !== request.repair.logicalRequestId
        || prior?.hostResult?.status !== 'rejected'
        || records.some(record => record.generationRequest?.repair?.logicalRequestId === request.repair!.logicalRequestId)) {
        throw new Error('本轮的唯一一次修复机会已使用或不属于当前会话')
      }
      for (const key of ['workspace', 'documentRevision', 'sessionGeneration', 'destinations', 'purpose', 'instruction', 'allowedCarriers', 'confirmedDocuments'] as const) {
        if (JSON.stringify(request[key]) !== JSON.stringify(original[key])) throw new Error('修复不能改变原请求的目标或工程基线')
      }
    }
    const target = destinationScope(request)
    const readScope = request.purpose === 'whole-course' ? { kind: 'course' as const } : { kind: 'location' as const, surfaceId: target.surfaceId, locationId: target.locationId }
    const session = this.createSession(workspace, adapter, request.instruction, readScope, request.destinations, !legacy && prior ? prior.workingDirectoryId ?? prior.id : undefined)
    session.generationRequest = request
    const observationId = randomUUID()
    session.record.tasks[0] = aiTaskSchema.parse({
      ...session.record.tasks[0]!, intent: request.intent ?? 'edit', applyPolicy: request.applyPolicy ?? 'preview', observationId,
      writeDestinations: request.intent && request.intent !== 'edit' ? [] : request.destinations,
    })
    await this.persistRequestObservation(session, request, observationId)
    let prompt = this.generationPrompt(adapter, request, path.join(this.repository.stagingPath(workspace, session.record.workingDirectoryId, 2), 'candidates', request.requestId))
    if (legacy && prior) {
      const excerpt = localAgentText(prior.events)
      if (excerpt) prompt = `先前对话（只读摘录，不能恢复旧 CLI 会话）：\n${excerpt}\n\n${prompt}`
    }
    if (Buffer.byteLength(prompt) > MAX_GENERATION_PROMPT_BYTES) throw new Error('请求上下文超过 CLI 发送预算，请缩小引用范围')
    await this.launch(session, prompt, !legacy ? prior?.externalSessionId : undefined, request)
    return session.record.id
  }
  /** Continue the same task with a fresh immutable request after an actual host result. */
  async continue(workspace: WorkspaceIdentityV1, id: string, raw: GenerationRequest): Promise<string> {
    if (this.active.has(id) || this.launching.has(id)) throw new Error('任务正在运行')
    // A host-feedback turn must be able to confirm completion. Preserve edit
    // authorization while giving every native adapter the reply-or-edit channel.
    const request = generationRequestSchema.parse({ ...raw, expectedResult: 'auto' })
    const listed = await this.repository.list(workspace)
    const native = listed.v2.find(record => record.id === id)
    const projected = listed.records.find(record => record.id === id)
    const task = native?.tasks.at(-1)
    const prior = projected?.generationRequest
    const result = projected?.hostResult
    if (!native?.externalSessionId || !task || !prior || !result || !['feeding-back', 'checking'].includes(task.status)) throw new Error('当前任务没有可续轮的宿主结果')
    if (workspaceIdentityKey(request.workspace) !== workspaceIdentityKey(workspace) || request.requestId === prior.requestId
      || result.requestId !== prior.requestId || !['committed', 'unchanged', 'rejected'].includes(result.status)) throw new Error('续轮必须对应当前工程的最新宿主结果')
    const expectedRevision = result.status === 'committed' ? result.afterRevision : prior.documentRevision
    if (request.documentRevision !== expectedRevision || request.instruction !== prior.instruction
      || (request.intent ?? 'edit') !== task.intent || (request.applyPolicy ?? 'preview') !== task.applyPolicy) throw new Error('stale：续轮目标或工程基线已改变')
    if (task.execution && (Date.now() >= task.execution.deadlineAt || task.execution.stagnantCandidates >= 2 || task.execution.formatRepairs > 1)) throw new Error('本任务预算已到或连续两轮没有进展，请调整要求后重新发送')
    const created = new Set(native.hostResults.filter(item => item.taskId === task.taskId).flatMap(item => item.receipts.flatMap(receipt => receipt.affected.filter(effect => effect.operation === 'created').map(effect => effect.id))))
    const canCreateLocations = task.writeDestinations.some(destination => destination.kind === 'create' && destination.scope.parent.kind === 'course-locations')
    const stable = (destination: GenerationRequest['destinations'][number]) => {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      const { documentRevision: _revision, sessionGeneration: _generation, revisionPolicy: _policy, ...identity } = target
      return JSON.stringify({ kind: destination.kind, ...identity })
    }
    for (const destination of request.destinations) {
      if (task.writeDestinations.some(allowed => stable(allowed) === stable(destination))) continue
      if (destination.kind === 'update' && created.has(destination.target.itemId)) continue
      if (destination.kind === 'create' && canCreateLocations && created.has(destination.scope.locationId)) continue
      throw new Error('续轮不能扩大原任务写入范围；请新建明确授权的请求')
    }
    const observationId = randomUUID()
    const execution = task.execution ? { ...task.execution, turnCount: task.execution.turnCount + 1 } : undefined
    native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'running', observationId,
      writeDestinations: task.intent === 'edit' ? request.destinations : [], execution })
    this.proposals.delete(id)
    const owner: SessionOwner = { record: native, generationRequest: request }
    await this.persistRequestObservation(owner, request, observationId)
    const feedback = `宿主已完成上一阶段。下列是正式结果，不是CLI自述：\n${JSON.stringify(result)}\n已记录正式提交回执：\n${JSON.stringify(native.hostResults.at(-1) ?? null)}\n请结合新的真实观察判断用户目标是否完成；若完成请自然语言答复，不再产生重复修改。若未完成请给下一阶段候选。\n${(task.pendingInputs ?? []).map(input => `用户${input.kind === 'correct' ? '纠正' : '补充'}：${input.text}`).join('\n')}`
    const prompt = `${feedback}\n${this.generationPrompt(native.adapter, request, path.join(this.repository.stagingPath(workspace, native.workingDirectoryId, 2), 'candidates', request.requestId), 'host-feedback')}`
    if (Buffer.byteLength(prompt) > MAX_GENERATION_PROMPT_BYTES) throw new Error('续轮上下文超过发送预算')
    await this.launch(owner, prompt, native.externalSessionId, request)
    return id
  }
  async candidate(workspace: WorkspaceIdentityV1, id: string) {
    const record = (await this.list(workspace)).records.find(value => value.id === id)
    if (!record?.generationRequestId) throw new Error('当前工程没有此生成请求')
    if (record.status !== 'completed' || this.active.has(id)) throw new Error('生成运行尚未成功结束')
    const nativeRecord = (await this.repository.list(workspace)).v2.find(value => value.id === id)
    const lastRun = nativeRecord?.events.at(-1)?.runId
    const currentEvents = nativeRecord ? projectV2RecordToV1({ ...nativeRecord, events: nativeRecord.events.filter(event => event.runId === lastRun) }).events : record.events
    let result: GenerationResult = readGenerationResult(localAgentText(currentEvents), record.generationRequest ?? { requestId: record.generationRequestId })
    const activeTask = nativeRecord?.tasks.at(-1)
    if (result.kind !== 'answer' && activeTask?.intent !== 'edit') throw new Error('本轮为讨论或计划，没有工程修改授权')
    if (result.kind === 'answer' && nativeRecord && activeTask) {
      const incomplete = activeTask.intent === 'edit' && !nativeRecord.hostResults.some(value => value.taskId === activeTask.taskId
        && (value.status === 'committed' || value.status === 'unchanged'))
      if (incomplete) result = { kind: 'incomplete', requestId: result.requestId, finding: '编辑未完成：CLI 已回复，但本任务没有实际应用或确认无需修改的正式回执；课件未修改。' }
      nativeRecord.tasks[nativeRecord.tasks.length - 1] = aiTaskSchema.parse({ ...activeTask, status: incomplete ? 'failed' : 'completed' })
      await this.persist({ record: nativeRecord, generationRequest: record.generationRequest, hostResult: record.hostResult })
    }
    if (result.kind === 'candidate') {
      const native = (await this.repository.list(workspace)).v2.find(value => value.id === id)
      const task = native?.tasks.at(-1)
      if (native && task?.observationId) {
        const proposal = aiProposalSchema.parse({
          version: 1, taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, observationId: task.observationId,
          requestId: result.requestId, candidateId: result.candidate.candidateId, candidate: result.candidate,
        })
        const observation = native.observations.find(value => value.observationId === task.observationId)
        if (!record.generationRequest || !observation) throw new Error('候选缺少当前真实观察')
        let admission: 'accepted' | 'rejected' = 'accepted'
        try { assertAiProposalCurrent(task, observation, record.generationRequest, proposal) }
        catch (error) {
          // Current request/observation authorization errors remain fatal. Only the candidate can be corrected.
          if (!(error instanceof AiCandidateScopeError)) throw error
          admission = 'rejected'
          result = { kind: 'candidate-rejected', requestId: result.requestId, candidateId: proposal.candidateId, finding: error.message.slice(0, 4000) }
        }
        this.proposals.set(id, { proposal, admission })
        native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'checking' })
        await this.persist({ record: native, generationRequest: record.generationRequest, hostResult: record.hostResult, cleanupIssue: record.cleanupIssue })
      }
    }
    return result
  }
  async hostResult(workspace: WorkspaceIdentityV1, id: string, raw: LocalAgentHostResult, receipt?: GenerationCommitReceipt) {
    const result = localAgentHostResultSchema.parse(raw)
    if (this.active.has(id)) throw new Error('宿主结果不属于已结束的当前请求')
    const listed = await this.repository.list(workspace)
    const projected = listed.records.find(record => record.id === id)
    const native = listed.v2.find(record => record.id === id)
    if (!projected || !native || projected.status === 'running' || projected.generationRequestId !== result.requestId) throw new Error('宿主结果不属于已结束的当前请求')
    const owner: SessionOwner = { record: native, generationRequest: projected.generationRequest, hostResult: result, cleanupIssue: projected.cleanupIssue }
    const task = native.tasks.at(-1)
    if (task && ['cancelled', 'partial', 'failed'].includes(task.status) && result.status !== 'undone') throw new Error('任务已停止，不能接收晚到结果')
    if (result.status === 'committed' || result.status === 'unchanged') {
      const parsedReceipt = generationCommitReceiptSchema.parse(receipt)
      const existing = native.hostResults.find(value => value.requestId === result.requestId && value.candidateId === parsedReceipt.candidateId && value.status === result.status)
      if (existing) {
        if (JSON.stringify(existing.receipts[0]) !== JSON.stringify(parsedReceipt)) throw new Error('同一候选的重复回执内容冲突')
        return
      }
      const pending = this.proposals.get(id)
      if (!task?.observationId || pending?.admission !== 'accepted') throw new Error('已提交结果必须对应当前通过身份与范围校验的候选')
      const proposal = pending.proposal
      const aiResult = {
        version: 1 as const, taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, observationId: task.observationId,
        requestId: result.requestId, candidateId: result.candidateId ?? proposal.candidateId, resultId: randomUUID(),
        status: result.status, beforeRevision: parsedReceipt.beforeRevision, afterRevision: parsedReceipt.afterRevision,
        receipts: [parsedReceipt], summary: result.summary, diagnostics: [],
      }
      const accepted = acceptAiHostResult(aiTaskSchema.parse({ ...task, status: 'committing' }), proposal, aiResult, native.hostResults)
      if (!accepted.duplicate) {
        native.tasks[native.tasks.length - 1] = accepted.task
        native.hostResults.push(aiResult)
      }
    } else if (task && result.status === 'checked') native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'awaiting-apply' })
    else if (task && result.status === 'rejected') native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'checking' })
    else if (task && result.status === 'stale') native.tasks[native.tasks.length - 1] = stopAiTask(task)
    const updated = native.tasks.at(-1)
    if (updated?.execution && ['committed', 'unchanged', 'rejected'].includes(result.status)) {
      const proposal = this.proposals.get(id)?.proposal
      const changeKey = proposal ? JSON.stringify(proposal.candidate.steps.map(({ id: _id, lowerCarrierReason: _reason, ...step }) => step)).slice(0, 160000) : null
      const repeated = result.status !== 'committed' && updated.execution.lastChangeKey === changeKey && updated.execution.lastDiagnostic === result.summary
      native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...updated, execution: { ...updated.execution,
        stagnantCandidates: result.status === 'committed' ? 0 : repeated ? updated.execution.stagnantCandidates + 1 : 0,
        formatRepairs: updated.execution.formatRepairs + (result.status === 'rejected' && !proposal ? 1 : 0),
        lastChangeKey: changeKey, lastDiagnostic: result.summary,
      } })
    }
    await this.persist(owner)
  }
  async input(workspace: WorkspaceIdentityV1, id: string, raw: AiUserInput): Promise<ReturnType<typeof aiInputDeliverySchema.parse>> {
    const input = aiUserInputSchema.parse(raw)
    const run = this.active.get(id)
    if (run && !run.acceptingInputs) {
      await run.done
      return this.input(workspace, id, input)
    }
    if (!run && (input.kind === 'correct' || input.kind === 'supplement')) {
      const listed = await this.repository.list(workspace)
      const record = listed.v2.find(value => value.id === id)
      const projected = listed.records.find(value => value.id === id)
      const task = record?.tasks.at(-1)
      if (!record || !task || !projected || !['checking', 'awaiting-apply', 'feeding-back'].includes(task.status)
        || input.taskId !== task.taskId || input.epoch !== task.epoch || workspaceIdentityKey(input.workspace) !== workspaceIdentityKey(workspace)) throw new Error('输入不属于可继续的当前任务')
      const pending = task.pendingInputs ?? []
      const duplicate = pending.find(value => value.inputId === input.inputId)
      if (duplicate && (duplicate.text !== input.text || duplicate.kind !== input.kind)) throw new Error('输入身份对应的内容冲突')
      if (!duplicate) {
        record.tasks[record.tasks.length - 1] = aiTaskSchema.parse({ ...task, pendingInputs: [...pending, { inputId: input.inputId, text: input.text, kind: input.kind }] })
        await this.persist({ record, generationRequest: projected.generationRequest, hostResult: projected.hostResult })
      }
      return aiInputDeliverySchema.parse({ taskId: task.taskId, epoch: task.epoch, workspace, inputId: input.inputId, turnId: input.turnId, status: 'queued', reason: '将在候选重新检查的下一原生回合消费' })
    }
    const task = run?.owner.record.tasks.at(-1)
    if (!run || !task || run.cancelled || workspaceIdentityKey(workspace) !== workspaceIdentityKey(task.workspace)
      || workspaceIdentityKey(input.workspace) !== workspaceIdentityKey(workspace) || input.taskId !== task.taskId || input.epoch !== task.epoch) throw new Error('输入不属于当前运行任务')
    const prior = run.owner.record.events.find(event => event.kind === 'input-delivery' && event.delivery.inputId === input.inputId)
    if (prior?.kind === 'input-delivery') return prior.delivery
    if (input.kind === 'stop') {
      await this.cancel(workspace, id)
      return aiInputDeliverySchema.parse({ taskId: input.taskId, epoch: input.epoch, workspace, inputId: input.inputId, turnId: input.turnId, status: 'consumed', reason: null })
    }
    if (input.kind === 'answer' && !run.owner.record.events.some(event => event.kind === 'question'
      && event.question.questionId === input.questionId && event.question.epoch === input.epoch
      && event.question.turnId === input.turnId)) throw new Error('提问不属于当前运行回合')
    let finishWrite!: () => void
    const writing = new Promise<void>(resolve => { finishWrite = resolve })
    run.inputWrites.add(writing)
    try {
    const delivery = aiInputDeliverySchema.parse({ ...await run.adapter.input(input), ...(input.kind === 'answer' ? { questionId: input.questionId } : {}) })
    if (delivery.taskId !== input.taskId || delivery.epoch !== input.epoch || delivery.inputId !== input.inputId
      || workspaceIdentityKey(delivery.workspace) !== workspaceIdentityKey(workspace)) throw new Error('原生输入回执身份不一致')
    if (run.cancelled || run.owner.record.tasks.at(-1)?.epoch !== input.epoch) throw new Error('输入返回时任务已停止')
    this.append(run.owner.record, run.runId, { kind: 'input-delivery', delivery, ...this.identity(run.owner.record, run.runId), nativeTurnId: delivery.turnId })
    if (delivery.status === 'queued' && (input.kind === 'correct' || input.kind === 'supplement')) {
      const currentTask = run.owner.record.tasks.at(-1)!
      run.owner.record.tasks[run.owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...currentTask,
        pendingInputs: [...(currentTask.pendingInputs ?? []).filter(value => value.inputId !== input.inputId), { inputId: input.inputId, kind: input.kind, text: input.text }] })
    } else if (input.kind === 'answer' && delivery.status !== 'rejected') {
      run.owner.record.tasks[run.owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'running' })
    }
    await this.persist(run.owner)
    return delivery
    } finally { run.inputWrites.delete(writing); finishWrite() }
  }
  async cancel(workspace: WorkspaceIdentityV1, id: string): Promise<void> {
    const run = this.active.get(id)
    if (!run) {
      const listed = await this.repository.list(workspace)
      const record = listed.v2.find(value => value.id === id)
      const projected = listed.records.find(value => value.id === id)
      const task = record?.tasks.at(-1)
      if (!record || !task || !projected) throw new Error('当前工程没有此运行会话')
      record.tasks[record.tasks.length - 1] = stopAiTask(task)
      this.proposals.delete(id)
      await this.persist({ record, generationRequest: projected.generationRequest, hostResult: projected.hostResult })
      return
    }
    if (workspaceIdentityKey(run.owner.record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('当前工程没有此运行会话')
    if (run.cancelled) { await run.done; return }
    const task = run.owner.record.tasks.at(-1)
    if (task) run.owner.record.tasks[run.owner.record.tasks.length - 1] = stopAiTask(task)
    run.cancelled = true
    this.append(run.owner.record, run.runId, { kind: 'turn-ended', status: 'cancelled', failure: null, ...this.identity(run.owner.record, run.runId) })
    try { await this.persist(run.owner) }
    finally {
      try { await run.adapter.close() }
      finally { await run.done }
    }
  }
  async delete(workspace: WorkspaceIdentityV1, id?: string): Promise<void> {
    for (const run of this.active.values()) if (workspaceIdentityKey(run.owner.record.workspace) === workspaceIdentityKey(workspace) && (!id || run.owner.record.id === id)) await this.cancel(workspace, run.owner.record.id)
    await this.repository.delete(workspace, id)
    for (const [failedId, failed] of this.storageFailures) if (failed.workspace === workspaceIdentityKey(workspace) && (!id || id === failedId)) this.storageFailures.delete(failedId)
  }
  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.launches])
    await Promise.all([...this.active.values()].map(run => this.cancel(run.owner.record.workspace, run.owner.record.id)))
  }
  private project(owner: SessionOwner, live: boolean): LocalAgentRecord {
    const projected = projectV2RecordToV1(owner.record, {
      generationRequest: owner.generationRequest ? requestMetadata(owner.generationRequest) : undefined, hostResult: owner.hostResult, cleanupIssue: owner.cleanupIssue, live,
    })
    if (!live) return projected
    return { ...projected, status: 'running', events: projected.events.filter(event => !['completed', 'failed', 'cancelled'].includes(event.kind)) }
  }
  private createSession(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, goal: string, readScope: AiTask['readScope'], writeDestinations: AiTask['writeDestinations'], workingDirectoryId?: string): SessionOwner {
    const sessionId = randomUUID()
    const taskId = randomUUID()
    const observationId = writeDestinations.length ? null : randomUUID()
    const task = aiTaskSchema.parse({
      version: 1, taskId, epoch: 0, workspace, sessionId, adapter, goal: goal.slice(0, 20000),
      intent: writeDestinations.length ? 'edit' : 'discuss', applyPolicy: 'preview', readScope, writeDestinations,
      status: 'running', observationId, committedResultIds: [],
      execution: { startedAt: Date.now(), deadlineAt: Date.now() + 20 * 60 * 1000, turnCount: 1,
        formatRepairs: 0, stagnantCandidates: 0, lastChangeKey: null, lastDiagnostic: null }, pendingInputs: [],
    })
    const record = localAgentRecordV2Schema.parse({
      version: 2, id: sessionId, adapter, workspace, externalSessionId: null, workingDirectoryId: workingDirectoryId ?? sessionId,
      tasks: [task], observations: observationId ? [createObservation(task, undefined, observationId, [])] : [], hostResults: [], events: [],
    })
    return { record }
  }
  private identity(record: LocalAgentRecordV2, runId: string) {
    const task = record.tasks.at(-1)!
    return { taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, runId, nativeTurnId: runId }
  }
  private append(record: LocalAgentRecordV2, runId: string, event: LocalAgentNativeEvent | Omit<Extract<LocalAgentEventV2, { kind: 'turn-ended' }>, 'version' | 'sessionId' | 'sequence' | 'time'>): void {
    const last = record.events.at(-1)
    if (last?.kind === 'turn-ended' && last.runId === runId) return
    record.events.push(localAgentEventV2Schema.parse({
      version: 2, sessionId: record.id, sequence: record.events.length + 1, time: Date.now(),
      ...this.identity(record, runId), ...event,
    }))
  }
  private failInterrupted(owner: SessionOwner): void {
    const task = owner.record.tasks.at(-1)
    if (task) owner.record.tasks[owner.record.tasks.length - 1] = stopAiTask({ ...task, status: task.committedResultIds.length ? 'partial' : 'running' })
    this.append(owner.record, randomUUID(), {
      kind: 'turn-ended', status: 'failed', failure: { category: 'protocol', message: '应用已中断，可恢复已有外部会话' },
      ...this.identity(owner.record, randomUUID()),
    })
  }
  private async persist(owner: SessionOwner): Promise<void> {
    await this.repository.write(localAgentRecordV2Schema.parse(owner.record))
    await this.repository.writeDisplay(owner.record.workspace, owner.record.id, { hostResult: owner.hostResult, cleanupIssue: owner.cleanupIssue })
  }
  private async persistRequestObservation(owner: SessionOwner, request: GenerationRequest, observationId: string): Promise<void> {
    const payload = JSON.stringify(requestMetadata(request))
    const files: AiObservation['files'] = [{ fileId: 'generation-request', relativePath: 'generation-request.json', mediaType: 'application/json', byteLength: Buffer.byteLength(payload), role: 'structure' }]
    const resources = new Map((request.resourceFiles ?? []).map(file => [file.path, file]))
    for (const resource of resources.values()) {
      if (resource.path.toLowerCase() === 'generation-request.json') throw new Error('资源不能覆盖正式观察结构')
      if (resource.encoding === 'base64' && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.content))) throw new Error('观察资源 base64 格式无效')
      const bytes = Buffer.from(resource.content, resource.encoding === 'base64' ? 'base64' : 'utf8')
      const observed = request.observation?.files.find(file => file.relativePath === resource.path)
      if (observed && (observed.byteLength !== bytes.byteLength || observed.mediaType !== resource.mediaType)) throw new Error('画面文件与观察索引不一致')
      files.push(observed ?? { fileId: `resource:${files.length}`, relativePath: resource.path, mediaType: resource.mediaType ?? 'application/octet-stream', byteLength: bytes.byteLength,
        role: resource.role === 'source' ? 'structure' : resource.role ?? 'structure' })
      await this.repository.writeObservation(owner.record.workspace, owner.record.workingDirectoryId, observationId, resource.path, bytes)
    }
    if (request.observation?.files.some(file => !resources.has(file.relativePath))) throw new Error('当前观察文件没有真实内容')
    owner.record.observations.push(createObservation(owner.record.tasks.at(-1)!, request, observationId, files))
    await this.repository.writeObservation(owner.record.workspace, owner.record.workingDirectoryId, observationId, 'generation-request.json', payload)
  }
  private launch(owner: SessionOwner, prompt: string, externalId?: string, request?: GenerationRequest): Promise<void> {
    if (this.closing) return Promise.reject(new Error('会话服务正在关闭'))
    this.launching.add(owner.record.id)
    const pending = this.prepareLaunch(owner, prompt, externalId, request)
    this.launches.add(pending)
    return pending.finally(() => { this.launches.delete(pending); this.launching.delete(owner.record.id) })
  }
  private async prepareLaunch(owner: SessionOwner, prompt: string, externalId?: string, request?: GenerationRequest): Promise<void> {
    if (this.active.size + this.pendingLaunches >= 3) throw new Error('最多同时运行三个 CLI 会话')
    this.pendingLaunches++
    let cwd: string | undefined
    try {
      const adapter = this.factory(owner.record.adapter, request)
      cwd = await this.repository.staging(owner.record.workspace, owner.record.workingDirectoryId, 2)
      if (request) await new CandidateStaging(cwd).create(request)
      await this.persist(owner)
      const run: ActiveRun = { owner, adapter, done: Promise.resolve(), runId: randomUUID(), cancelled: false, acceptingInputs: true, inputWrites: new Set() }
      this.active.set(owner.record.id, run)
      run.done = this.consume(run, prompt, cwd, externalId)
    } catch (error) {
      if (request && cwd) await new CandidateStaging(cwd).remove(request.requestId)
      throw error
    } finally { this.pendingLaunches-- }
  }
  private async consume(run: ActiveRun, prompt: string, cwd: string, externalId?: string): Promise<void> {
    const { owner, adapter } = run
    const tools = new Set<string>()
    let completed = false
    let lastFlush = Date.now()
    const task = owner.record.tasks.at(-1)!
    const files = new Map<string, string>()
    const preference = this.preferences.get(adapter.id)
    let turnPending = task.pendingInputs ?? []
    const remaining = (task.execution?.deadlineAt ?? Date.now() + 20 * 60 * 1000) - Date.now()
    const timeout = setTimeout(() => {
      if (run.cancelled) return
      this.append(owner.record, run.runId, { kind: 'turn-ended', status: 'failed', failure: { category: 'limit', message: '本任务的20分钟执行预算已用完；已提交阶段保留' }, ...this.identity(owner.record, run.runId) })
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...stopAiTask(owner.record.tasks.at(-1)!), status: owner.record.tasks.at(-1)!.committedResultIds.length ? 'partial' : 'failed' })
      run.cancelled = true
      void adapter.close().catch(() => {})
    }, Math.max(1, remaining))
    let configurationConfirmed = !preference
    const observation = owner.record.observations.find(value => value.observationId === task.observationId)
    if (observation) for (const file of observation.files) files.set(file.fileId, path.join(this.repository.observationPath(owner.record.workspace, owner.record.workingDirectoryId, observation.observationId), file.relativePath))
    const images = observation?.files.filter(file => file.role === 'image').map(file => file.fileId) ?? []
    let stage = '打开原生 CLI'
    try {
      const nativeCwd = await nativeWorkspaceDirectory(owner.record.workspace.normalizedPath)
      if (run.cancelled) return
      const opened = await adapter.open({ cwd: nativeCwd, externalSessionId: externalId ?? null,
        ...(owner.generationRequest ? { candidateRoot: path.join(cwd, 'candidates', owner.generationRequest.requestId) } : {}) })
      if (run.cancelled) return
      if (this.captureExternalSession(owner, opened.externalSessionId, externalId)) await this.persist(owner)
      stage = '应用模型配置'
      const capabilities = localAgentCapabilitiesSchema.parse(preference ? await adapter.configure(preference) : opened.capabilities)
      if (preference) this.assertRequestedConfiguration(preference, capabilities)
      configurationConfirmed = !preference || this.configurationMatches(preference, capabilities)
      this.cachedCapabilities.set(adapter.id, capabilities)
      if (run.cancelled) return
      let turnPrompt = prompt
      for (;;) {
      completed = false
      stage = '启动原生回合'
      await adapter.startTurn({
        taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, runId: run.runId,
        observationId: task.observationId ?? randomUUID(), text: turnPrompt, imageFileIds: images,
      }, files)
      stage = '读取原生事件'
      if (turnPending.length) {
        const consumed = new Set(turnPending.map(input => input.inputId))
        owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!,
          pendingInputs: (owner.record.tasks.at(-1)?.pendingInputs ?? []).filter(input => !consumed.has(input.inputId)) })
        for (const input of turnPending) this.append(owner.record, run.runId, { kind: 'input-delivery', ...this.identity(owner.record, run.runId), delivery: {
          taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, inputId: input.inputId, status: 'consumed', turnId: run.runId, reason: null,
        } })
        turnPending = []
      }
      for await (const event of adapter.events()) {
        if (run.cancelled) break
        if (owner.record.events.length >= 19990) throw new Error('output-limit')
        if (this.captureExternalSession(owner, adapter.getExternalSessionId?.(), externalId)) await this.persist(owner)
        if (event.kind === 'configuration') {
          const capabilities = localAgentCapabilitiesSchema.parse(event.capabilities)
          if (capabilities.adapter !== adapter.id) throw new Error('protocol')
          if (preference) this.assertRequestedConfiguration(preference, capabilities)
          configurationConfirmed = !preference || this.configurationMatches(preference, capabilities)
          this.cachedCapabilities.set(adapter.id, capabilities)
        }
        if (event.kind === 'turn-ended') {
          if (event.status === 'completed') {
            if (completed) throw new Error('protocol')
            completed = true
            continue
          }
        }
        if (completed) throw new Error('protocol')
        if (event.kind === 'tool') {
          if (event.status === 'running') {
            if (tools.has(event.itemId)) throw new Error('protocol')
            tools.add(event.itemId)
          } else if (!tools.delete(event.itemId)) {
            throw new Error('protocol')
          }
        }
        this.append(owner.record, run.runId, event)
        if (event.kind === 'question') owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!, status: 'waiting-input' })
        if (event.kind === 'turn-ended') break
        // A native permission/clarification can suspend the event stream. Its
        // waiting state must be durable without depending on a later event.
        if (event.kind === 'question' || owner.record.events.length % 32 === 0 || Date.now() - lastFlush >= 250) {
          await this.persist(owner); lastFlush = Date.now()
        }
      }
      while (run.inputWrites.size && !run.cancelled) await Promise.all([...run.inputWrites])
      const pending = owner.record.tasks.at(-1)?.pendingInputs ?? []
      if (run.cancelled || !completed || !pending.length) { run.acceptingInputs = false; break }
      if (tools.size) throw new Error('protocol')
      const current = owner.record.tasks.at(-1)!
      if (current.execution && Date.now() >= current.execution.deadlineAt) throw new Error('output-limit')
      this.append(owner.record, run.runId, { kind: 'turn-ended', status: 'completed', failure: null, ...this.identity(owner.record, run.runId) })
      run.runId = randomUUID()
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...current, status: 'running',
        ...(current.execution ? { execution: { ...current.execution, turnCount: current.execution.turnCount + 1 } } : {}) })
      turnPending = pending
      if (owner.generationRequest) await fs.rm(path.join(cwd, 'candidates', owner.generationRequest.requestId, 'candidate.json'), { force: true })
      turnPrompt = '用户在上一回合中补充或纠正了要求，上一回合的候选尚未提交。请以当前不可变观察与以下输入继续，不得宣称已写入工程。\n' + pending.map(input => input.text).join('\n')
      await this.persist(owner)
      }
      if (!run.cancelled && !owner.record.events.some(event => event.kind === 'turn-ended' && event.runId === run.runId)) {
        if (tools.size || !completed || !owner.record.externalSessionId || !configurationConfirmed) throw new Error('protocol')
        if (owner.generationRequest && createGenerationProfile(owner.record.adapter, owner.generationRequest).capability.candidateFileIngestion) {
          const candidate = await new CandidateStaging(cwd).readText(owner.generationRequest.requestId)
          if (candidate !== null) this.append(owner.record, run.runId, {
            kind: 'text', itemId: `candidate-file:${owner.generationRequest.requestId}`, phase: 'body', operation: 'replace',
            text: `${GENERATION_OPEN}${candidate}${GENERATION_CLOSE}`, ...this.identity(owner.record, run.runId),
          })
        }
        this.append(owner.record, run.runId, { kind: 'turn-ended', status: 'completed', failure: null, ...this.identity(owner.record, run.runId) })
        owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!, status: owner.generationRequest ? 'checking' : 'completed' })
      }
    } catch (error) {
      const category = localAgentFailureSchema.safeParse(error instanceof Error ? error.message : '')
      const mapped = error instanceof Error && error.message === 'output-limit' ? 'limit' as const
        : category.success && category.data === 'storage' ? 'storage' as const
        : 'protocol' as const
      this.append(owner.record, run.runId, {
        kind: 'turn-ended', status: 'failed', failure: { category: mapped,
          message: `CLI 未完成（${stage}）：${error instanceof Error ? error.message || error.name : String(error)}`.slice(0, 4000) },
        ...this.identity(owner.record, run.runId),
      })
    } finally {
      clearTimeout(timeout)
      const terminal = owner.record.events.at(-1)
      if (!run.cancelled && terminal?.kind === 'turn-ended' && terminal.status !== 'completed') owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!, status: owner.record.tasks.at(-1)!.committedResultIds.length ? 'partial' : terminal.status })
      try { await adapter.close() } catch { /* Terminal failure stays observable even if the child already exited. */ }
      if (owner.generationRequest) {
        try { await new CandidateStaging(cwd).remove(owner.generationRequest.requestId) }
        catch { owner.cleanupIssue = '候选暂存清理失败，可重试删除' }
      }
      try { await this.persist(owner) } catch {
        this.storageFailures.set(owner.record.id, { workspace: workspaceIdentityKey(owner.record.workspace), record: this.project(owner, false) })
      }
      this.active.delete(owner.record.id)
    }
  }
  private generationPrompt(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase = 'initial'): string {
    return buildGenerationPrompt(adapter, request, candidateRoot, phase)
  }
}
