import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  localAgentCapabilitiesSchema, localAgentFailureSchema, localAgentHostResultSchema,
  type LocalAgentCapabilities, type LocalAgentConfiguration, type LocalAgentHostResult, type LocalAgentId, type LocalAgentRecord,
} from '../../shared/localAgentContract'
import { workspaceIdentityKey, type AiWorkspaceIdentity, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'
import { createLocalAgentCliAdapterV2 } from './adapter'
import { codexCandidateFileMessage } from './codexAppServer'
import { localAgentText, visibleLocalAgentText } from '../../shared/localAgentText'
import { LocalAgentRepository } from './repository'
import { generationCommitReceiptSchema, generationRecovery, generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, DEFAULT_GENERATION_TASK_DURATION_MS, MAX_GENERATION_TASK_DURATION_MS, GENERATION_NATIVE_INACTIVITY_MS, type GenerationCommitReceipt, type GenerationRequest } from '../../shared/generationContract'
import { GENERATION_OPEN, GENERATION_CLOSE, generationStagedCandidateMarker, readGenerationResult, type GenerationResult } from '../../shared/generationResult'
import { CandidateMediaFileError, CandidateStaging } from './candidateStaging'
import { buildGenerationPrompt, createGenerationProfile, type GenerationPromptPhase } from './profile'
import {
  aiHostResultSchema, aiObservationSchema, aiProposalSchema, aiTaskSchema, localAgentEventV2Schema, localAgentRecordV2Schema,
  type AiObservation, type AiProposal, type AiTask, type AiTaskTimingStage, type LocalAgentCliAdapterV2, type LocalAgentEventV2, type LocalAgentNativeEvent, type LocalAgentRecordV2,
} from '../../shared/localAgentTaskContract'
import { acceptAiHostResult, AiCandidateScopeError, assertAiProposalCurrent, stopAiTask } from '../../shared/localAgentTaskGuards'
import { projectAiHostResult, projectV2RecordToV1 } from '../../shared/localAgentProjection'
import { aiInputDeliverySchema, aiUserInputSchema, type AiUserInput } from '../../shared/localAgentInteraction'
import { nativeWorkspaceDirectory } from './process'
import { NativeCapabilityCache } from './capabilityCache'
import { candidateChangeKey, failureReasonKey } from './candidateChangeKey'
import { generationCompactHostResult, generationHostFeedback, generationHostResultResource, generationPendingReceiptResource, generationPendingReceiptPrompt } from './generationHostFeedback'
import { generationRepairInputs } from './generationRepairInputs'
import { recordAiTaskTiming } from '../../shared/localAgentTiming'
import { recordAiTaskInputMetrics } from '../../shared/localAgentInputMetrics'

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
  nativeTurnId: string | null
  cancelled: boolean
  acceptingInputs: boolean
  inputWrites: Set<Promise<void>>
  interruptRequested?: boolean
  interruptConfirmed?: boolean
  budgetChanged?: () => void
  idleSince?: number
  budgetWrite?: Promise<void>
  promptPhase: GenerationPromptPhase
  promptFactory?: (availableBytes: number) => string
}

function taskMediaIdentity(task: AiTask) {
  return task.execution ? { taskId: task.taskId, deadlineAt: task.execution.deadlineAt } : undefined
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
  private readonly stoppedSessions = new Set<string>()
  private readonly idleOperations = new Map<string, Promise<void>>()
  private async withIdleOwner<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.idleOperations.get(id) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    this.idleOperations.set(id, current)
    await previous
    try { return await operation() }
    finally { release(); if (this.idleOperations.get(id) === current) this.idleOperations.delete(id) }
  }
  private readonly active = new Map<string, ActiveRun>()
  private pendingLaunches = 0
  private readonly launches = new Set<Promise<void>>()
  private readonly launching = new Set<string>()
  private readonly proposals = new Map<string, { proposal: AiProposal; admission: 'accepted' | 'rejected'; wireCandidate: AiProposal['candidate'] }>()
  private readonly candidateIds = new Map<string, { requestId: string; candidateId: string }>()
  private readonly preparedSessions = new Set<string>()
  // A known live receipt survives an uncertain disk/IPC result. Retrying only writes this exact record.
  private readonly pendingHostResults = new Map<string, SessionOwner>()
  private readonly deletingScopes = new Set<string>()
  private closing = false
  private readonly storageFailures = new Map<string, { workspace: string; record: LocalAgentRecord }>()
  private readonly cachedCapabilities = new NativeCapabilityCache()
  private readonly configurationWrites = new Map<LocalAgentId, Promise<LocalAgentCapabilities>>()
  get running(): boolean { return this.active.size > 0 || this.pendingLaunches > 0 }
  constructor(readonly repository: LocalAgentRepository, private readonly factory: AdapterFactory =
    (id, request) => createLocalAgentCliAdapterV2(id, request)) {}
  probe(id: LocalAgentId) {
    const adapter = this.factory(id)
    if ('probe' in adapter && typeof adapter.probe === 'function') return adapter.probe()
    throw new Error('当前 adapter 没有探测接口')
  }
  async capabilities(id: LocalAgentId, options: { workspace?: WorkspaceIdentityV1; refresh?: boolean } = {}): Promise<LocalAgentCapabilities> {
    return this.withRequestedConfiguration(await this.discoverCapabilities(id, options), await this.repository.readConfiguration(id))
  }
  private async discoverCapabilities(id: LocalAgentId, options: { workspace?: WorkspaceIdentityV1; refresh?: boolean } = {}): Promise<LocalAgentCapabilities> {
    const cwd = options.workspace ? await nativeWorkspaceDirectory(options.workspace.normalizedPath) : process.cwd()
    const caps = await this.cachedCapabilities.read(id, cwd, !!options.refresh, async () => {
      const adapter = this.factory(id)
      try {
        return localAgentCapabilitiesSchema.parse(adapter.discoverCapabilities
          ? await adapter.discoverCapabilities({ cwd }) : (await adapter.open({ cwd, externalSessionId: null })).capabilities)
      } finally { await adapter.close() }
    })
    return caps
  }
  configure(id: LocalAgentId, config: LocalAgentConfiguration, workspace?: WorkspaceIdentityV1): Promise<LocalAgentCapabilities> {
    const pending = (this.configurationWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.saveConfiguration(id, config, workspace))
    this.configurationWrites.set(id, pending)
    void pending.catch(() => {})
    return pending
  }
  private async saveConfiguration(id: LocalAgentId, config: LocalAgentConfiguration, workspace?: WorkspaceIdentityV1): Promise<LocalAgentCapabilities> {
    let caps = await this.discoverCapabilities(id, { workspace })
    let targetModel = caps.models.find(m => m.id === config.model)
    if (!targetModel) throw new Error(`模型 ${config.model} 不在 ${id} 原生目录中`)
    if (config.serviceTier !== undefined && id !== 'codex') throw new Error('该 CLI 尚未提供速度档位配置')
    if (config.serviceTier != null && config.serviceTier !== 'default' && !targetModel.serviceTiers?.some(tier => tier.id === config.serviceTier)) throw new Error('所选速度不在当前原生模型目录中，请刷新目录')
    if (id === 'opencode' && targetModel.effort.kind === 'unknown') {
      const probe = this.factory(id)
      try {
        const cwd = workspace ? await nativeWorkspaceDirectory(workspace.normalizedPath) : process.cwd()
        await probe.open({ cwd, externalSessionId: null })
        const discovered = localAgentCapabilitiesSchema.parse(await probe.configure({ model: config.model, effort: null }))
        if (discovered.current.model !== config.model || discovered.requestedConfiguration) throw new Error('原生CLI没有确认所选模型的强度目录')
        const selectedModel = discovered.models.find(model => model.id === config.model)
        if (!selectedModel || selectedModel.effort.kind === 'unknown') throw new Error('原生CLI没有返回所选模型的强度目录')
        caps = await this.cachedCapabilities.merge(id, cwd, discovered, current => localAgentCapabilitiesSchema.parse({ ...current,
          models: current.models.map(model => model.id === config.model ? selectedModel : model) }))
        targetModel = selectedModel
      } finally { await probe.close() }
    }
    if (config.effort !== null && targetModel.effort.kind === 'unsupported') throw new Error('所选原生模型不支持强度配置')
    if (config.effort !== null && targetModel.effort.kind === 'supported' && !targetModel.effort.values.includes(config.effort)) throw new Error(`强度 ${config.effort} 不在所选模型的原生目录中`)
    await this.repository.writeConfiguration(id, config)
    return this.withRequestedConfiguration(caps, config)
  }
  private withRequestedConfiguration(caps: LocalAgentCapabilities, pref?: LocalAgentConfiguration): LocalAgentCapabilities {
    if (!pref) return caps
    return localAgentCapabilitiesSchema.parse({
      ...caps, selectedConfiguration: pref, requestedConfiguration: this.configurationMatches(pref, caps) ? null : pref,
    })
  }
  private configurationMatches(config: LocalAgentConfiguration, caps: LocalAgentCapabilities): boolean {
    // Null leaves the native effort unchanged/defaulted; only an explicit value
    // is an exact override. Keep the returned actual value visible and persisted.
    return caps.current.model === config.model && (config.effort === null || caps.current.effort === config.effort)
      && (config.serviceTier === undefined || caps.current.serviceTier === config.serviceTier) && !caps.requestedConfiguration
  }
  private assertRequestedConfiguration(config: LocalAgentConfiguration, caps: LocalAgentCapabilities): void {
    if (this.configurationMatches(config, caps)) return
    const pending = caps.requestedConfiguration
    if (pending?.model !== config.model || pending.effort !== config.effort || pending.serviceTier !== config.serviceTier) throw new Error('原生CLI没有接受所选模型配置')
  }
  private async rememberCapabilities(cwd: string, caps: LocalAgentCapabilities): Promise<void> {
    this.cachedCapabilities.invalidate(caps.adapter, caps.cliVersion)
    await this.cachedCapabilities.merge(caps.adapter, cwd, caps, current => {
      const selected = caps.models.find(model => model.id === caps.current.model)
      const models = current.models.map(model => model.id === selected?.id ? selected : model)
      if (selected && !models.some(model => model.id === selected.id)) models.push(selected)
      return localAgentCapabilitiesSchema.parse({ ...current, models, current: caps.current, currentSource: caps.currentSource, input: caps.input,
        requestedConfiguration: caps.requestedConfiguration ?? null })
    }, 'native-session').catch(() => { /* A newer discovery owns its cache; native confirmation is still preserved in the event record. */ })
  }
  private captureExternalSession(owner: SessionOwner, nativeId: string | null | undefined, expectedId?: string): boolean {
    if (!nativeId || nativeId === 'pending') return false
    if ((expectedId && expectedId !== nativeId) || (owner.record.externalSessionId && owner.record.externalSessionId !== nativeId)) throw new Error('protocol')
    const changed = owner.record.externalSessionId !== nativeId
    owner.record.externalSessionId = nativeId
    return changed
  }
  async list(workspace: AiWorkspaceIdentity) {
    return this.readRecords(workspace)
  }
  async read(workspace: AiWorkspaceIdentity, id: string) {
    return this.readRecords(workspace, id)
  }
  private async readRecords(workspace: AiWorkspaceIdentity, requestedId?: string) {
    // Reading records and cleaning older staging areas can yield while a native
    // turn finishes. A session owned by this process during this read is never
    // an abandoned process, even if its active run disappears before the loop.
    const running = new Set([...this.active.keys(), ...this.launching])
    const owned = new Set([...running, ...this.preparedSessions, ...this.pendingHostResults.keys()])
    const result = requestedId !== undefined ? await this.repository.read(workspace, requestedId) : await this.repository.list(workspace)
    const owner = workspaceIdentityKey(workspace)
    const includes = (id: string) => requestedId === undefined || requestedId === id
    for (const run of this.active.values()) if (includes(run.owner.record.id) && workspaceIdentityKey('kind' in workspace ? run.owner.record.lessonWorkspace ?? run.owner.record.workspace : run.owner.record.workspace) === owner) {
      owned.add(run.owner.record.id)
      result.records = result.records.filter(record => record.id !== run.owner.record.id)
      result.records.push(this.project(run.owner, true))
    }
    for (const [id, failed] of this.storageFailures) if (includes(id) && (failed.workspace === owner || failed.record.lessonWorkspace && workspaceIdentityKey(failed.record.lessonWorkspace) === owner)) {
      result.records = result.records.filter(record => record.id !== id)
      result.records.push(failed.record)
      result.damaged.push(`会话 ${id} 未能写入本地存储；当前结果仅保留在本次应用进程中`)
    }
    for (const [id, pending] of this.pendingHostResults) if (includes(id) && workspaceIdentityKey('kind' in workspace ? pending.record.lessonWorkspace ?? pending.record.workspace : pending.record.workspace) === owner) {
      // Receipt acknowledgement persists during an active feedback turn. Its
      // storage entry must not replace the current run with an offline projection
      // whose last event can still be the previous turn's completion. The active
      // projection above also preserves explicit Stop/partial while closing.
      const active = this.active.get(id)
      if (active && workspaceIdentityKey('kind' in workspace ? active.owner.record.lessonWorkspace ?? active.owner.record.workspace : active.owner.record.workspace) === owner) continue
      result.records = result.records.filter(record => record.id !== id)
      result.records.push(this.project(pending, false))
      result.damaged.push(`会话 ${id} 的宿主结果尚未保存；课件中的已应用修改保留，请重试保存回执`)
    }
    for (const record of [...result.records]) {
      if ((record.status === 'running' || (record.task && ['checking', 'awaiting-apply', 'committing', 'feeding-back'].includes(record.task.status)))
        && !owned.has(record.id) && !this.active.has(record.id) && !this.launching.has(record.id)) {
        const native = result.v2.find(value => value.id === record.id)
        if (native) {
          const session = { record: native, generationRequest: record.generationRequest, hostResult: record.hostResult, cleanupIssue: record.cleanupIssue }
          this.failInterrupted(session)
          await this.persist(session)
          result.records = result.records.filter(value => value.id !== record.id)
          result.records.push(this.project(session, false))
        }
      }
      const awaitingCandidateFiles = this.preparedSessions.has(record.id) && !this.proposals.has(record.id)
        && record.task?.status === 'checking'
      // Feedback preparation persists its new request before active.set. The
      // projection can still show the prior native turn as completed here.
      // Neither a launch nor a run owned during this read is abandoned staging.
      if (record.generationRequestId && record.status !== 'running' && !running.has(record.id)
        && !this.active.has(record.id) && !this.launching.has(record.id) && !awaitingCandidateFiles) {
        try {
          const version = 2
          await new CandidateStaging(this.repository.stagingPath(record.workspace, record.workingDirectoryId ?? record.id, version)).remove(record.generationRequestId)
          if (record.cleanupIssue) {
            const native = result.v2.find(value => value.id === record.id)
            if (native) await this.persist({ record: native, generationRequest: record.generationRequest, hostResult: record.hostResult })
          }
        } catch { result.damaged.push(`会话 ${record.id} 的候选暂存清理失败，可重试删除`) }
      }
    }
    return { records: result.records, damaged: result.damaged }
  }
  async start(workspace: AiWorkspaceIdentity, adapter: LocalAgentId, prompt: string, intent: 'discuss' | 'plan' = 'discuss', userMessage?: string): Promise<string> {
    const session = this.createSession(workspace, adapter, prompt, { kind: 'course' }, [])
    session.record.tasks[0]!.intent = intent
    await this.launch(session, prompt, undefined, undefined, userMessage ?? prompt)
    return session.record.id
  }
  async resume(workspace: AiWorkspaceIdentity, id: string, prompt: string, userMessage?: string, preserveTaskBudget = false): Promise<string> {
    if (this.active.has(id)) throw new Error('会话正在运行')
    await this.savePendingFeedback(workspace, id)
    const prior = (await this.list(workspace)).records.find(record => record.id === id)
    if (!prior) throw new Error('会话不存在或没有可恢复的外部身份')
    if (!prior.externalSessionId) throw new Error('会话不存在或没有可恢复的外部身份')
    const session = this.createSession(workspace, prior.adapter, prompt, { kind: 'course' }, [], prior.workingDirectoryId ?? prior.id)
    if (preserveTaskBudget) {
      const original = (await this.repository.read(workspace, id)).v2.find(record => record.id === id)?.tasks.at(-1)
      if (!original?.execution || this.stoppedSessions.has(id) || prior.status === 'cancelled' || ['cancelled', 'partial', 'failed'].includes(original.status)
        || original.execution.budgetStopReason || Date.now() >= original.execution.deadlineAt) throw new Error('当前阶段已停止或原任务预算已到，未续接候选')
      session.record.tasks[0] = aiTaskSchema.parse({ ...session.record.tasks[0], execution: {
        ...original.execution, timing: undefined, inputMetrics: undefined, turnCount: original.execution.turnCount + 1,
      } })
    }
    await this.launch(session, prompt, prior.externalSessionId, undefined, userMessage ?? prompt)
    return session.record.id
  }
  async generate(workspace: WorkspaceIdentityV1, adapter: LocalAgentId, raw: GenerationRequest, resumeSessionId?: string, userMessage?: string, lessonWorkspace?: Extract<AiWorkspaceIdentity, { kind: 'lesson' }>): Promise<string> {
    let request = generationRequestSchema.parse(raw)
    if (workspaceIdentityKey(workspace) !== workspaceIdentityKey(request.workspace)) throw new Error('生成请求不属于当前工程位置')
    if (resumeSessionId) await this.savePendingFeedback(workspace, resumeSessionId)
    const records = (await this.list(workspace)).records
    if (records.some(record => record.generationRequestId === request.requestId)) throw new Error('每轮生成必须使用新的请求身份')
    const prior = resumeSessionId ? records.find(record => record.id === resumeSessionId) : undefined
    if (resumeSessionId && (!prior?.externalSessionId || prior.adapter !== adapter || this.active.has(resumeSessionId))) {
      throw new Error('生成会话不可恢复或 adapter 不一致')
    }
    if (request.repair) {
      const original = prior?.generationRequest
      if (!original || original.repair || original.requestId !== request.repair.logicalRequestId
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
    const session = this.createSession(workspace, adapter, request.instruction, readScope, request.destinations, prior ? prior.workingDirectoryId ?? prior.id : undefined)
    session.record.lessonWorkspace = lessonWorkspace ?? prior?.lessonWorkspace
    const pendingSources = await this.pendingReceipts(session, prior?.externalSessionId)
    const pendingResults = pendingSources.flatMap(source => source.record.hostResults.filter(result => result.receiptDelivery === 'pending'))
    request = generationPendingReceiptResource(request, pendingResults)
    session.generationRequest = request
    const observationId = randomUUID()
    session.record.tasks[0] = aiTaskSchema.parse({
      ...session.record.tasks[0]!, intent: request.intent ?? 'edit', applyPolicy: request.applyPolicy ?? 'preview', observationId,
      writeDestinations: request.intent && request.intent !== 'edit' ? [] : request.destinations,
      ...(request.execution ? { execution: { ...session.record.tasks[0]!.execution!, startedAt: request.execution.startedAt,
        deadlineAt: request.execution.deadlineAt } } : {}),
    })
    if (Date.now() >= session.record.tasks[0]!.execution!.deadlineAt) throw new Error('本任务的执行期限已到，请重新发送以获得新观察')
    await this.persistRequestObservation(session, request, observationId)
    let prompt = this.generationPrompt(adapter, request, path.join(this.repository.stagingPath(workspace, session.record.workingDirectoryId, 2), 'candidates', request.requestId))
    if (Buffer.byteLength(prompt) > MAX_GENERATION_PROMPT_BYTES) throw new Error('请求上下文超过 CLI 发送预算，请缩小引用范围')
    await this.launch(session, prompt, prior?.externalSessionId, request, userMessage ?? request.instruction)
    return session.record.id
  }
  /** Continue the same task with a fresh immutable request after an actual host result. */
  async continue(workspace: WorkspaceIdentityV1, id: string, raw: GenerationRequest): Promise<string> {
    return this.withIdleOwner(id, () => this.continueTask(workspace, id, raw))
  }
  private async continueTask(workspace: WorkspaceIdentityV1, id: string, raw: GenerationRequest): Promise<string> {
    if (this.active.has(id) || this.launching.has(id)) throw new Error('任务正在运行')
    // A host-feedback turn must be able to confirm completion. Preserve edit
    // authorization while giving every native adapter the reply-or-edit channel.
    let request = generationRequestSchema.parse({ ...raw, expectedResult: 'auto' })
    if (this.pendingHostResults.has(id)) throw new Error('已应用结果尚未保存，请先重试保存回执')
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
    if (task.execution) {
      if (Date.now() >= task.execution.deadlineAt) throw new Error('本任务的执行期限已到，请重新发送以获得新观察')
      if (task.execution.formatRepairs > 1) throw new Error('候选格式修复后仍不正确，请调整要求后重新发送')
      if (task.execution.stagnantCandidates >= 2) throw new Error('连续两轮没有进展，请调整要求后重新发送')
    }
    if (task.execution) request = generationRequestSchema.parse({ ...request, execution: { version: 1,
      startedAt: task.execution.startedAt, deadlineAt: task.execution.deadlineAt } })
    const created = new Set(native.hostResults.filter(item => item.taskId === task.taskId).flatMap(item => item.receipts.flatMap(receipt => receipt.affected.filter(effect => effect.operation === 'created').map(effect => effect.id))))
    const canCreateLocations = task.writeDestinations.some(destination => destination.kind === 'create' && destination.scope.parent.kind === 'course-locations')
    const stable = (destination: GenerationRequest['destinations'][number]) => {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      const { documentRevision: _revision, sessionGeneration: _generation, revisionPolicy: _policy, ...identity } = target
      return JSON.stringify({ kind: destination.kind, ...identity })
    }
    for (const destination of request.destinations) {
      // Focus-scoped reads no longer freeze the project's editable inventory.
      // The next host observation supplies fresh exact targets after each commit.
      if (prior.context && typeof prior.context === 'object' && !Array.isArray(prior.context) && prior.context.modificationScope === 'project') continue
      if (task.writeDestinations.some(allowed => stable(allowed) === stable(destination))) continue
      if (destination.kind === 'update' && created.has(destination.target.itemId)) continue
      if (destination.kind === 'create' && canCreateLocations && created.has(destination.scope.locationId)) continue
      throw new Error('续轮不能扩大原任务写入范围；请新建明确授权的请求')
    }
    const projectedFeedback = generationHostFeedback(request, result, native.hostResults.at(-1) ?? null)
    const cachedProposal = this.proposals.get(id)
    const repairInputs = generationRepairInputs(projectedFeedback.request, prior, task, native.hostResults.at(-1),
      cachedProposal?.admission === 'accepted' ? cachedProposal.proposal : undefined)
    request = repairInputs.request
    const pendingSources = await this.pendingReceipts({ record: native, generationRequest: request }, native.externalSessionId)
    const pendingResults = pendingSources.flatMap(source => source.record.hostResults.filter(value => value.receiptDelivery === 'pending'))
    request = pendingResults.length ? generationPendingReceiptResource(request, pendingResults)
      : generationHostResultResource(request, projectedFeedback.result, projectedFeedback.hostResult)
    const feedbackIntro = '上一阶段已返回宿主正式结果，不是CLI自述；只有committed或unchanged表示已应用或确认无需修改：'
    const feedbackTail = `${projectedFeedback.resourcePath ? `完整宿主反馈文件（相对 workspace.root）：${projectedFeedback.resourcePath}\n` : ''}${request.resourceFiles?.some(file => file.path === 'pending-host-results.json') ? '完整未送达宿主回执文件（相对 workspace.root）：resources/pending-host-results.json\n' : ''}请结合新的真实观察判断用户目标是否完成；若完成请自然语言答复，不再产生重复修改。尚有可执行的合法步骤才给下一阶段候选；确实受阻时通过答复通道说明未完成及具体缺失条件并结束，不提交空steps、自造操作或用于索取诊断的非法候选。\n${(task.pendingInputs ?? []).map(input => `用户${input.kind === 'correct' ? '纠正' : '补充'}：${input.text}`).join('\n')}`
    const candidateRoot = path.join(this.repository.stagingPath(workspace, native.workingDirectoryId, 2), 'candidates', request.requestId)
    const pendingReceiptPath = path.join(candidateRoot, ...(request.resourceFiles?.some(file => file.path === 'pending-host-results.json') ? ['resources'] : []), 'pending-host-results.json')
    const pendingPromptBytes = Buffer.byteLength(generationPendingReceiptPrompt(native.workspace, pendingResults, pendingReceiptPath), 'utf8')
    const fullReceiptPath = (current: GenerationRequest) => current.resourceFiles?.some(file => file.path === 'pending-host-results.json') || current.resourceFiles?.some(file => file.path === 'host-result.json')
      ? `resources/${current.resourceFiles.some(file => file.path === 'pending-host-results.json') ? 'pending-host-results.json' : 'host-result.json'}` : path.join(candidateRoot, pendingResults.length ? 'pending-host-results.json' : 'host-result.json')
    const feedback = `${feedbackIntro}\n${JSON.stringify(projectedFeedback.result)}\n已记录的宿主结果（拒绝不代表提交）：\n${JSON.stringify(projectedFeedback.hostResult)}\n${feedbackTail}`
    const compactFeedback = (current: GenerationRequest) => `${feedbackIntro}\n${JSON.stringify(generationCompactHostResult(projectedFeedback.result, fullReceiptPath(current)))}\n已记录的宿主结果（拒绝不代表提交）：\n${JSON.stringify(projectedFeedback.hostResult ? generationCompactHostResult(projectedFeedback.hostResult, fullReceiptPath(current)) : null)}\n${feedbackTail}`
    const promptFor = (current: GenerationRequest, guidance = '', feedbackText = feedback, availableBytes = MAX_GENERATION_PROMPT_BYTES - pendingPromptBytes) => {
      const prefix = `${feedbackText}\n${guidance}\n`
      const root = path.join(this.repository.stagingPath(workspace, native.workingDirectoryId, 2), 'candidates', current.requestId)
      return `${prefix}${this.generationPrompt(native.adapter, current, root, 'host-feedback', Math.max(0, availableBytes - Buffer.byteLength(prefix, 'utf8')))}`
    }
    let guidance = repairInputs.guidance ?? ''
    let prompt = promptFor(request, guidance)
    if (Buffer.byteLength(prompt) + pendingPromptBytes > MAX_GENERATION_PROMPT_BYTES && request !== projectedFeedback.request) {
      request = pendingResults.length ? generationPendingReceiptResource(projectedFeedback.request, pendingResults)
        : generationHostResultResource(projectedFeedback.request, projectedFeedback.result, projectedFeedback.hostResult)
      guidance = '组件修复输入超过本轮发送预算，已省略复用；请依据当前观察继续。'
      prompt = promptFor(request, guidance)
    }
    const promptFactory = (availableBytes: number) => {
      const complete = promptFor(request, guidance, feedback, availableBytes)
      return Buffer.byteLength(complete, 'utf8') <= availableBytes ? complete : promptFor(request, guidance, compactFeedback(request), availableBytes)
    }
    prompt = promptFactory(MAX_GENERATION_PROMPT_BYTES - pendingPromptBytes)
    if (Buffer.byteLength(prompt) + pendingPromptBytes > MAX_GENERATION_PROMPT_BYTES) throw new Error('续轮上下文超过发送预算')
    const observationId = randomUUID()
    const execution = task.execution ? { ...task.execution, deadlineAt: request.execution!.deadlineAt, turnCount: task.execution.turnCount + 1 } : undefined
    native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'running', observationId,
      writeDestinations: task.intent === 'edit' ? request.destinations : [], execution })
    this.proposals.delete(id)
    this.candidateIds.delete(id)
    const owner: SessionOwner = { record: native, generationRequest: request, hostResult: result }
    await this.persistRequestObservation(owner, request, observationId)
    await this.launch(owner, prompt, native.externalSessionId, request, undefined, 'host-feedback', promptFactory)
    return id
  }
  async candidate(workspace: WorkspaceIdentityV1, id: string) {
    return this.withIdleOwner(id, () => this.readCandidate(workspace, id))
  }
  private async readCandidate(workspace: WorkspaceIdentityV1, id: string) {
    if (this.pendingHostResults.has(id)) throw new Error('宿主实际结果尚未保存，不能重新读取并应用候选；请重试保存回执')
    const record = (await this.list(workspace)).records.find(value => value.id === id)
    if (!record?.generationRequestId) throw new Error('当前工程没有此生成请求')
    if (record.status !== 'completed' || this.active.has(id)) throw new Error('生成运行尚未成功结束')
    let nativeRecord = (await this.repository.list(workspace)).v2.find(value => value.id === id)
    const mediaTask = nativeRecord?.tasks.at(-1)
    if (mediaTask?.pendingInputs?.length) return { kind: 'incomplete' as const, requestId: record.generationRequestId,
      finding: '用户在上一回合结束后补充或纠正了要求，旧候选尚未应用；请根据最新输入重新准备' }
    if (nativeRecord && mediaTask?.execution && !this.proposals.has(id)) {
      const staging = new CandidateStaging(this.repository.stagingPath(workspace, nativeRecord.workingDirectoryId, 2))
      // The delivery helper registers only files it successfully copied. Keep
      // these even when the candidate JSON itself needs a native repair turn.
      try { await staging.retainDeliveredMedia(record.generationRequestId, taskMediaIdentity(mediaTask)!) }
      catch { /* Explicit candidate references still receive their exact validation below. */ }
      nativeRecord = (await this.repository.list(workspace)).v2.find(value => value.id === id)
      const current = nativeRecord?.tasks.at(-1)
      if (!current || current.taskId !== mediaTask.taskId || current.epoch !== mediaTask.epoch
        || current.observationId !== mediaTask.observationId
        || !['running', 'checking', 'awaiting-apply', 'committing'].includes(current.status)
        || Date.now() >= mediaTask.execution.deadlineAt) {
        await staging.releaseTaskMedia(mediaTask.taskId).catch(() => {})
        throw new Error('候选任务已停止、过期或观察已失效')
      }
    }
    const lastRun = nativeRecord?.events.at(-1)?.runId
    const currentEvents = nativeRecord ? projectV2RecordToV1({ ...nativeRecord, events: nativeRecord.events.filter(event => event.runId === lastRun) }).events : record.events
    let stable = this.candidateIds.get(id)
    if (!stable || stable.requestId !== record.generationRequestId) {
      stable = { requestId: record.generationRequestId, candidateId: randomUUID() }
      this.candidateIds.set(id, stable)
    }
    const currentText = localAgentText(currentEvents, { includeCandidates: true })
    let result: GenerationResult = readGenerationResult(currentText, record.generationRequest ?? { requestId: record.generationRequestId }, { candidateId: stable.candidateId })
    // A declared edit delivery whose candidate never materialized is a bounded
    // recoverable omission, not a protocol failure: name the actual cause, the
    // expected artifact and the next step. A declaration alone never commits.
    if (result.kind === 'candidate-format-error' && nativeRecord && !currentText.includes(GENERATION_OPEN)
      && currentText.includes(generationStagedCandidateMarker(record.generationRequestId))) {
      const staged = await new CandidateStaging(this.repository.stagingPath(workspace, nativeRecord.workingDirectoryId, 2)).readText(record.generationRequestId)
        .catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
      if (staged === null) {
        const finding = '已声明本轮交付编辑候选，但当前请求没有实际候选：候选根内没有 candidate.json，正文也没有 courseware-candidate-v1 通道。预检（--check）不写候选，不能据此声明交付。下一步：修正后重新运行交付工具（去掉 --check）把候选写入当前请求根的 candidate.json，或在最终正文给出完整 courseware-candidate-v1 候选，再声明交付；确认无需修改时改用 kind 为 answer 的终结答复。'
        const diagnostics = [{ code: 'missing-candidate-delivery', message: finding, path: [] as (string | number)[] }]
        result = { ...result, finding, ...(result.failure ? { failure: { ...result.failure, diagnostics, recovery: generationRecovery(diagnostics) } } : {}) }
      }
    }
    const parsedAt = Date.now()
    const activeTask = nativeRecord?.tasks.at(-1)
    if (result.kind !== 'answer' && activeTask?.intent !== 'edit') throw new Error('本轮为讨论或计划，没有工程修改授权')
    if (result.kind === 'answer' && nativeRecord && activeTask) {
      const incomplete = activeTask.intent === 'edit' && !nativeRecord.hostResults.some(value => value.taskId === activeTask.taskId
        && (value.status === 'committed' || value.status === 'unchanged'))
      if (incomplete) {
        // An edit turn that ends on the answer channel without any real commit
        // receipt is the same bounded recoverable omission as a missing staged
        // candidate: name the cause, the expected artifact and the next step so
        // the rejected -> continue chain stays machine-readable.
        const finding = '编辑未完成：本任务尚无实际修改回执。当前选择仅是上下文，不限制修改其他对象或新增对象。请使用原生 CLI 工具完成目标；快捷工具不足时可编辑暂存 V9 文档并通过 project.document 提交实际结果。不要仅以宿主不支持为由结束，也不要重复请求已明确的编辑授权。'
        const diagnostics = [{ code: 'missing-candidate-delivery', message: finding, path: [] as (string | number)[] }]
        result = { kind: 'incomplete', requestId: result.requestId, finding,
          failure: { version: 1, stage: 'candidate-parse', requestId: result.requestId, diagnostics,
            recovery: generationRecovery(diagnostics), assetIds: [], packageIds: [] } }
      }
      nativeRecord.tasks[nativeRecord.tasks.length - 1] = aiTaskSchema.parse({ ...activeTask, status: incomplete ? 'checking' : 'completed' })
      await this.persist({ record: nativeRecord, generationRequest: record.generationRequest, hostResult: record.hostResult })
    }
    if (result.kind === 'candidate') {
      let native = (await this.repository.list(workspace)).v2.find(value => value.id === id)
      let task = native?.tasks.at(-1)
      if (native && task?.observationId) {
        if (lastRun && activeTask) this.markTiming(native, activeTask, lastRun, 'candidateParsed', parsedAt)
        const proposal = aiProposalSchema.parse({
          version: 1, taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, observationId: task.observationId,
          requestId: result.requestId, candidateId: result.candidate.candidateId, candidate: result.candidate,
        })
        const wireCandidate = proposal.candidate
        const observation = native.observations.find(value => value.observationId === proposal.observationId)
        if (!record.generationRequest || !observation) throw new Error('候选缺少当前真实观察')
        let admission: 'accepted' | 'rejected' = 'accepted'
        try { assertAiProposalCurrent(task, observation, record.generationRequest, proposal) }
        catch (error) {
          // Current request/observation authorization errors remain fatal. Only the candidate can be corrected.
          if (!(error instanceof AiCandidateScopeError)) throw error
          admission = 'rejected'
          result = { kind: 'candidate-rejected', requestId: result.requestId, candidateId: proposal.candidateId, finding: error.message.slice(0, 4000), ...(error.failure ? { failure: error.failure } : {}) }
        }
        const staging = new CandidateStaging(this.repository.stagingPath(workspace, native.workingDirectoryId, 2))
        const mediaTask = taskMediaIdentity(task)
        if (admission === 'accepted' && result.kind === 'candidate') {
          try {
            const cached = this.proposals.get(id)
            if (lastRun) this.markTiming(native, task, lastRun, 'resourcePreparationStarted')
            proposal.candidate = cached?.admission === 'accepted' && cached.proposal.candidateId === proposal.candidateId
              ? cached.proposal.candidate
              : await staging.resolveMediaFiles(proposal.candidate, mediaTask)
            if (lastRun) this.markTiming(native, task, lastRun, 'resourcePrepared')
            result = { ...result, candidate: proposal.candidate }
          } catch (error) {
            admission = 'rejected'
            result = { kind: 'candidate-rejected', requestId: result.requestId, candidateId: proposal.candidateId,
              finding: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
              ...(error instanceof CandidateMediaFileError ? { failure: error.failure } : {}) }
          }
        } else {
          // Retain only explicitly referenced, valid media for this current task.
          // A scope error stays a scope error, and the rejected candidate is never applied.
          try { await staging.resolveMediaFiles(proposal.candidate, mediaTask) } catch { /* Preserve the original scope diagnostic. */ }
        }
        // File IO must not resurrect a task cancelled or superseded meanwhile.
        const fileTiming = native.tasks.at(-1)?.execution?.timing
        native = (await this.repository.list(workspace)).v2.find(value => value.id === id)
        task = native?.tasks.at(-1)
        try {
          if (!native || !task) throw new Error('候选任务已失效')
          assertAiProposalCurrent(task, observation, record.generationRequest, proposal)
        } catch (error) {
          if (!(error instanceof AiCandidateScopeError) || admission !== 'rejected') {
            if (mediaTask) await staging.releaseTaskMedia(mediaTask.taskId).catch(() => {})
            throw error
          }
        }
        if (!native || !task) throw new Error('候选任务已失效')
        // Merge only these synchronous marks into the freshly revalidated task.
        for (const entry of fileTiming?.entries ?? []) if (entry.runId === lastRun
          && ['candidateParsed', 'resourcePreparationStarted', 'resourcePrepared'].includes(entry.stage)) this.markTiming(native, task, entry.runId, entry.stage, entry.at)
        task = native.tasks.at(-1)!
        this.proposals.set(id, { proposal, admission, wireCandidate })
        native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...task, status: 'checking' })
        await this.persist({ record: native, generationRequest: record.generationRequest, hostResult: record.hostResult, cleanupIssue: record.cleanupIssue })
      }
    }
    // All successful file references now live in the accepted proposal. Keep
    // the existing transient staging lifecycle for answers and rejected output.
    try { await new CandidateStaging(this.repository.stagingPath(workspace, record.workingDirectoryId ?? id, 2)).remove(record.generationRequestId) }
    catch { /* list() retains the existing cleanup retry and diagnostic. */ }
    return result
  }
  async hostResult(workspace: WorkspaceIdentityV1, id: string, raw: LocalAgentHostResult, receipt?: GenerationCommitReceipt): Promise<LocalAgentRecord> {
    return this.withIdleOwner(id, () => this.recordHostResult(workspace, id, raw, receipt))
  }
  private async recordHostResult(workspace: WorkspaceIdentityV1, id: string, raw: LocalAgentHostResult, receipt?: GenerationCommitReceipt): Promise<LocalAgentRecord> {
    const result = localAgentHostResultSchema.parse(raw)
    if (this.active.has(id)) throw new Error('宿主结果不属于已结束的当前请求')
    const listed = await this.repository.list(workspace)
    const pendingOwner = this.pendingHostResults.get(id)
    const projected = pendingOwner ? this.project(pendingOwner, false) : listed.records.find(record => record.id === id)
    const native = pendingOwner?.record ?? listed.v2.find(record => record.id === id)
    if (!projected || !native || workspaceIdentityKey(native.workspace) !== workspaceIdentityKey(workspace)
      || projected.status === 'running' || projected.generationRequestId !== result.requestId) throw new Error('宿主结果不属于已结束的当前请求')
    const owner: SessionOwner = { record: native, generationRequest: projected.generationRequest, hostResult: result, cleanupIssue: projected.cleanupIssue }
    const task = native.tasks.at(-1)
    if (!task?.observationId) throw new Error('宿主结果缺少当前任务观察')
    const stopped = ['cancelled', 'partial', 'failed'].includes(task.status)
    const applied = result.status === 'committed' || result.status === 'unchanged'
    const proposal = this.proposals.get(id)
    const candidateId = result.candidateId ?? proposal?.proposal.candidateId ?? this.candidateIds.get(id)?.candidateId ?? randomUUID()
    const existing = native.hostResults.find(value => value.requestId === result.requestId && value.candidateId === candidateId && value.status === result.status)
    if (existing) {
      if (existing.summary !== result.summary || JSON.stringify(existing.afterCommit) !== JSON.stringify(result.afterCommit)
        || JSON.stringify(existing.failure) !== JSON.stringify(result.failure)
        || (!applied && (JSON.stringify(existing.semanticChanges) !== JSON.stringify(result.semanticChanges)
          || JSON.stringify(existing.executionEvidence) !== JSON.stringify(result.executionEvidence)))
        || (applied && JSON.stringify(existing.receipts[0]) !== JSON.stringify(generationCommitReceiptSchema.parse(receipt)))) throw new Error('同一候选的重复回执内容冲突')
      // Even an existing canonical record can have a failed display write. Never skip the retry.
      owner.hostResult = projectAiHostResult(existing)
    } else if (applied) {
      const parsedReceipt = generationCommitReceiptSchema.parse(receipt)
      if (proposal?.admission !== 'accepted') throw new Error('已提交结果必须对应当前通过身份与范围校验的候选')
      const identity = proposal.proposal
      if (result.beforeRevision !== undefined && result.beforeRevision !== parsedReceipt.beforeRevision
        || result.afterRevision !== undefined && result.afterRevision !== parsedReceipt.afterRevision) throw new Error('回执版本与宿主结果不同')
      const aiResult = aiHostResultSchema.parse({
        version: 1, taskId: task.taskId, epoch: identity.epoch, workspace: task.workspace, observationId: identity.observationId,
        requestId: result.requestId, candidateId, resultId: randomUUID(), status: result.status,
        beforeRevision: parsedReceipt.beforeRevision, afterRevision: parsedReceipt.afterRevision,
        receipts: [parsedReceipt], summary: result.summary, diagnostics: [],
        ...(parsedReceipt.semanticChanges ? { semanticChanges: parsedReceipt.semanticChanges } : {}),
        ...(parsedReceipt.executionEvidence ? { executionEvidence: parsedReceipt.executionEvidence } : {}),
        ...(result.afterCommit ? { afterCommit: result.afterCommit } : {}), receiptDelivery: 'pending',
      })
      // A synchronous live commit may win a race with Stop. Archive that fact without resurrecting the task.
      if (stopped && task.epoch !== identity.epoch + 1) throw new Error('已停止任务的回执身份不一致')
      const accepted = acceptAiHostResult(aiTaskSchema.parse({ ...task, epoch: identity.epoch, status: 'committing' }), identity, aiResult, native.hostResults)
      native.tasks[native.tasks.length - 1] = stopped
        ? aiTaskSchema.parse({ ...task, committedResultIds: accepted.task.committedResultIds, status: accepted.task.committedResultIds.length ? 'partial' : task.status })
        : accepted.task
      native.hostResults.push(aiResult)
      owner.hostResult = projectAiHostResult(aiResult)
    } else if (result.status === 'undone') {
      if (!native.hostResults.some(value => value.requestId === result.requestId && value.status === 'committed')) throw new Error('没有可标记撤销的正式提交')
    } else {
      const diagnosticOnly = ['rejected', 'stale', 'failed'].includes(result.status)
      const expired = Boolean(task.execution && Date.now() >= task.execution.deadlineAt)
      if (stopped && !diagnosticOnly) throw new Error('任务已停止，不能接收晚到候选结果')
      if (expired && !diagnosticOnly) throw new Error('本任务的执行期限已到，未应用候选已失效')
      if (result.afterCommit) throw new Error('未应用的候选不能完成任务')
      if (result.failure?.requestId && result.failure.requestId !== result.requestId
        || result.failure?.candidateId && result.failure.candidateId !== candidateId) throw new Error('失败诊断不属于当前候选')
      const beforeRevision = projected.generationRequest!.documentRevision
      const observationEpoch = native.observations.find(observation => observation.observationId === task.observationId && observation.taskId === task.taskId)?.epoch
      if (observationEpoch === undefined) throw new Error('失败结果缺少原任务观察')
      const aiResult = aiHostResultSchema.parse({ version: 1, taskId: task.taskId, epoch: observationEpoch, workspace: task.workspace,
        observationId: task.observationId, requestId: result.requestId, candidateId, resultId: randomUUID(), status: result.status,
        beforeRevision, afterRevision: beforeRevision, receipts: [], summary: result.summary,
        ...(result.semanticChanges ? { semanticChanges: result.semanticChanges } : {}),
        ...(result.executionEvidence ? { executionEvidence: result.executionEvidence } : {}),
        diagnostics: result.failure?.diagnostics ?? [], ...(result.failure ? { failure: result.failure } : {}),
        ...(['rejected', 'stale', 'failed'].includes(result.status) ? { receiptDelivery: 'pending' } : {}) })
      native.hostResults.push(aiResult)
      owner.hostResult = projectAiHostResult(aiResult)
      // A failed IPC may deliver a known rejection after Stop/deadline. Archive
      // that diagnostic without admitting a candidate or reviving execution.
      native.tasks[native.tasks.length - 1] = stopped ? task : expired || result.status === 'stale' ? stopAiTask(task)
        : aiTaskSchema.parse({ ...task, status: result.status === 'checked' ? 'awaiting-apply' : 'checking' })
    }
    const updated = native.tasks.at(-1)!
    if (!existing && updated.execution && !updated.pendingInputs?.length && ['committed', 'unchanged', 'rejected'].includes(result.status)) {
      const changeKey = proposal ? candidateChangeKey(proposal.proposal.candidate) : null
      // The same unchanged cause counts as stagnation even when the candidate
      // content, summary or step ids were rewritten; a rejection without
      // structured diagnostics keeps the existing change-key semantics only.
      const reasonKey = result.status === 'rejected' ? failureReasonKey(result.failure, proposal?.proposal.candidate) : null
      const repeated = result.status !== 'committed' && (updated.execution.lastChangeKey === changeKey
        || (reasonKey !== null && updated.execution.lastReasonKey === reasonKey))
      native.tasks[native.tasks.length - 1] = aiTaskSchema.parse({ ...updated, execution: { ...updated.execution,
        stagnantCandidates: result.status === 'committed' ? 0 : repeated ? updated.execution.stagnantCandidates + 1 : 0,
        formatRepairs: updated.execution.formatRepairs + (result.status === 'rejected' && !proposal ? 1 : 0),
        lastChangeKey: changeKey,
        lastReasonKey: result.status === 'rejected' ? reasonKey ?? updated.execution.lastReasonKey ?? null : null,
        lastDiagnostic: result.summary,
      } })
    }
    const resultRunId = native.events.at(-1)?.runId
    if (!existing && result.status !== 'undone' && resultRunId) {
      // Accepted owner facts, including a real commit that won a race with Stop.
      // Persistence follows below; this is neither a disk flush nor a rendered frame timestamp.
      this.markTiming(native, native.tasks.at(-1)!, resultRunId, 'hostResultRecorded')
      if (applied) this.markTiming(native, native.tasks.at(-1)!, resultRunId, 'hostCommitRecorded')
    }
    this.pendingHostResults.set(id, owner)
    await this.persist(owner)
    this.pendingHostResults.delete(id)
    this.storageFailures.delete(id)
    return this.project(owner, false)
  }
  async input(workspace: AiWorkspaceIdentity, id: string, raw: AiUserInput): Promise<ReturnType<typeof aiInputDeliverySchema.parse>> {
    const input = aiUserInputSchema.parse(raw)
    const run = this.active.get(id)
    if (run?.budgetWrite && input.kind !== 'stop') {
      await run.budgetWrite
      return this.input(workspace, id, input)
    }
    if (run && !run.acceptingInputs) {
      await run.done
      return this.input(workspace, id, input)
    }
    if (!run && (input.kind === 'correct' || input.kind === 'supplement')) {
      const queued = await this.withIdleOwner(id, async () => {
      if (this.active.has(id)) return null
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
        this.appendUserMessage(record, record.events.at(-1)?.runId ?? randomUUID(), input.inputId, input.text, input.kind)
        await this.persist({ record, generationRequest: projected.generationRequest, hostResult: projected.hostResult })
      }
      if (this.stoppedSessions.has(id)) throw new Error('输入保存期间任务已停止；不会重新启动或应用旧候选')
      return aiInputDeliverySchema.parse({ taskId: task.taskId, epoch: task.epoch, workspace, inputId: input.inputId, turnId: input.turnId, status: 'queued', reason: '将在候选重新检查的下一原生回合消费' })
      })
      return queued ?? this.input(workspace, id, input)
    }
    const task = run?.owner.record.tasks.at(-1)
    if (!run || !task || run.cancelled || workspaceIdentityKey(workspace) !== workspaceIdentityKey(task.workspace)
      || workspaceIdentityKey(input.workspace) !== workspaceIdentityKey(workspace) || input.taskId !== task.taskId || input.epoch !== task.epoch) throw new Error('输入不属于当前运行任务')
    const prior = run.owner.record.events.find(event => event.kind === 'input-delivery' && event.delivery.inputId === input.inputId)
    if (prior?.kind === 'input-delivery') return prior.delivery
    if (input.kind === 'extend-budget') {
      if (run.inputWrites.size) { await Promise.all([...run.inputWrites]); return this.input(workspace, id, input) }
      const execution = task.execution
      const deadlineAt = execution ? Math.min(execution.deadlineAt + input.minutes * 60_000, execution.startedAt + MAX_GENERATION_TASK_DURATION_MS) : 0
      const accepted = execution && Date.now() < execution.deadlineAt && deadlineAt > execution.deadlineAt
      const delivery = aiInputDeliverySchema.parse({ taskId: task.taskId, epoch: task.epoch, workspace, inputId: input.inputId,
        turnId: run.nativeTurnId, status: accepted ? 'accepted' : 'rejected',
        ...(accepted ? { deadlineAt } : {}),
        reason: accepted ? '已按本次明确请求增加执行预算' : '任务已到期或已达到120分钟总预算上限' })
      let release!: () => void
      const writing = new Promise<void>(resolve => { release = resolve })
      run.budgetWrite = writing
      run.inputWrites.add(writing)
      try {
        // Storage acknowledges the proposed budget before the live owner exposes
        // it. Native event processing waits; Stop and the old deadline do not.
        const record = structuredClone(run.owner.record)
        if (accepted) record.tasks[record.tasks.length - 1] = aiTaskSchema.parse({ ...task, execution: { ...execution, deadlineAt } })
        this.append(record, run.runId, { kind: 'input-delivery', delivery, ...this.identity(record, run.runId) })
        await this.repository.write(record)
        if (run.cancelled || run.owner.record.tasks.at(-1)?.epoch !== input.epoch || execution && Date.now() >= execution.deadlineAt) {
          await this.repository.write(localAgentRecordV2Schema.parse(run.owner.record))
          return aiInputDeliverySchema.parse({ ...delivery, deadlineAt: undefined, status: 'rejected', reason: '预算保存期间任务已停止或到期' })
        }
        if (accepted) {
          const current = run.owner.record.tasks.at(-1)!
          run.owner.record.tasks[run.owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...current, execution: { ...current.execution, deadlineAt } })
          if (run.owner.generationRequest) run.owner.generationRequest = generationRequestSchema.parse({ ...run.owner.generationRequest,
            execution: { version: 1, startedAt: execution.startedAt, deadlineAt } })
        }
        this.append(run.owner.record, run.runId, { kind: 'input-delivery', delivery, ...this.identity(run.owner.record, run.runId) })
        run.budgetChanged?.()
        return delivery
      } finally { run.budgetWrite = undefined; run.inputWrites.delete(writing); release() }
    }
    if (input.kind === 'stop') {
      await this.cancel(workspace, id)
      return aiInputDeliverySchema.parse({ taskId: input.taskId, epoch: input.epoch, workspace, inputId: input.inputId, turnId: input.turnId, status: 'consumed', reason: null })
    }
    const answeredQuestion = input.kind === 'answer' ? [...run.owner.record.events].reverse().find(event => event.kind === 'question'
      && event.question.questionId === input.questionId && event.question.epoch === input.epoch
      && event.question.turnId === input.turnId) : undefined
    if (input.kind === 'answer' && !answeredQuestion) throw new Error('提问不属于当前运行回合')
    let finishWrite!: () => void
    const writing = new Promise<void>(resolve => { finishWrite = resolve })
    run.inputWrites.add(writing)
    try {
    const delivery = aiInputDeliverySchema.parse({ ...await run.adapter.input(input), ...(input.kind === 'answer' ? { questionId: input.questionId } : {}) })
    if (delivery.taskId !== input.taskId || delivery.epoch !== input.epoch || delivery.inputId !== input.inputId
      || workspaceIdentityKey(delivery.workspace) !== workspaceIdentityKey(workspace)) throw new Error('原生输入回执身份不一致')
    if (run.cancelled || run.owner.record.tasks.at(-1)?.epoch !== input.epoch) throw new Error('输入返回时任务已停止')
    this.append(run.owner.record, run.runId, { kind: 'input-delivery', delivery, ...this.identity(run.owner.record, run.runId), nativeTurnId: delivery.turnId })
    if (delivery.status !== 'rejected') this.appendUserMessage(run.owner.record, run.runId, input.inputId,
      input.kind === 'answer' ? input.answers.map(answer => {
        const title = answeredQuestion?.kind === 'question' ? answeredQuestion.question.questions.find(question => question.id === answer.id)?.title : undefined
        const text = answer.values.join('、')
        return title ? `${title}：${text}` : text
      }).join('\n') : input.text, input.kind)
    if (delivery.status === 'queued' && (input.kind === 'correct' || input.kind === 'supplement')) {
      const currentTask = run.owner.record.tasks.at(-1)!
      run.owner.record.tasks[run.owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...currentTask,
        pendingInputs: [...(currentTask.pendingInputs ?? []).filter(value => value.inputId !== input.inputId), { inputId: input.inputId, kind: input.kind, text: input.text }] })
    } else if (input.kind === 'answer' && delivery.status !== 'rejected') {
      run.owner.record.tasks[run.owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...run.owner.record.tasks.at(-1)!, status: 'running' })
      run.idleSince = Date.now()
    }
    await this.persist(run.owner)
    run.budgetChanged?.()
    if (delivery.status === 'queued' && input.kind === 'correct'
      && run.adapter.interruptTurn && !run.interruptRequested && !run.cancelled) {
      // Pending intent is durable before interrupting. This is a turn handoff,
      // never a task Stop, and the consumer waits for the native terminal.
      run.interruptRequested = true
      run.interruptConfirmed = false
      try { await run.adapter.interruptTurn(); run.interruptConfirmed = true }
      catch (error) { run.interruptRequested = false; throw error }
    }
    return delivery
    } finally { run.inputWrites.delete(writing); finishWrite() }
  }
  async cancel(workspace: AiWorkspaceIdentity, id: string): Promise<void> {
    const run = this.active.get(id)
    if (!run) {
      const listed = await this.repository.list(workspace)
      const pending = this.pendingHostResults.get(id)
      const record = pending?.record ?? listed.v2.find(value => value.id === id)
      const projected = pending ? this.project(pending, false) : listed.records.find(value => value.id === id)
      const task = record?.tasks.at(-1)
      if (!record || !task || !projected || workspaceIdentityKey(record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('当前工程没有此运行会话')
      this.stoppedSessions.add(id)
      record.tasks[record.tasks.length - 1] = stopAiTask(task)
      await this.persist({ record, generationRequest: projected.generationRequest, hostResult: projected.hostResult })
      this.pendingHostResults.delete(id)
      this.preparedSessions.delete(id)
      return
    }
    if (workspaceIdentityKey(run.owner.record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('当前工程没有此运行会话')
    this.stoppedSessions.add(id)
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
  async delete(workspace: AiWorkspaceIdentity, id?: string): Promise<void> {
    const scope = workspaceIdentityKey(workspace)
    this.deletingScopes.add(scope)
    try {
    await Promise.allSettled([...this.launches])
    for (const run of this.active.values()) if (workspaceIdentityKey('kind' in workspace ? run.owner.record.lessonWorkspace ?? run.owner.record.workspace : run.owner.record.workspace) === workspaceIdentityKey(workspace) && (!id || run.owner.record.id === id)) await this.cancel(run.owner.record.workspace, run.owner.record.id)
    await this.repository.delete(workspace, id)
    for (const [failedId, failed] of this.storageFailures) if (failed.workspace === workspaceIdentityKey(workspace) && (!id || id === failedId)) this.storageFailures.delete(failedId)
    for (const [pendingId, pending] of this.pendingHostResults) if (workspaceIdentityKey(pending.record.workspace) === workspaceIdentityKey(workspace) && (!id || id === pendingId)) this.pendingHostResults.delete(pendingId)
    if (id) { this.proposals.delete(id); this.candidateIds.delete(id); this.preparedSessions.delete(id) }
    } finally { this.deletingScopes.delete(scope) }
  }
  async close(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.launches])
    const stopped = await Promise.allSettled([...this.active.values()].map(run => this.cancel(run.owner.record.workspace, run.owner.record.id)))
    const failure = stopped.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  private project(owner: SessionOwner, live: boolean): LocalAgentRecord {
    const projected = projectV2RecordToV1(owner.record, {
      generationRequest: owner.generationRequest ? requestMetadata(owner.generationRequest) : undefined, hostResult: owner.hostResult, cleanupIssue: owner.cleanupIssue, live,
    })
    if (!live || projected.status !== 'running') return projected
    return { ...projected, status: 'running', events: projected.events.filter(event => !['completed', 'failed', 'cancelled'].includes(event.kind)) }
  }
  private createSession(workspace: AiWorkspaceIdentity, adapter: LocalAgentId, goal: string, readScope: AiTask['readScope'], writeDestinations: AiTask['writeDestinations'], workingDirectoryId?: string): SessionOwner {
    const sessionId = randomUUID()
    const taskId = randomUUID()
    const observationId = writeDestinations.length ? null : randomUUID()
    const task = aiTaskSchema.parse({
      version: 1, taskId, epoch: 0, workspace, sessionId, adapter, goal: goal.slice(0, 20000),
      intent: writeDestinations.length ? 'edit' : 'discuss', applyPolicy: 'preview', readScope, writeDestinations,
      status: 'running', observationId, committedResultIds: [],
      execution: { startedAt: Date.now(), deadlineAt: Date.now() + DEFAULT_GENERATION_TASK_DURATION_MS, turnCount: 1,
        formatRepairs: 0, stagnantCandidates: 0, lastChangeKey: null, lastReasonKey: null, lastDiagnostic: null }, pendingInputs: [],
    })
    const record = localAgentRecordV2Schema.parse({
      version: 3, id: sessionId, adapter, workspace, externalSessionId: null, workingDirectoryId: workingDirectoryId ?? sessionId,
      tasks: [task], observations: observationId ? [createObservation(task, undefined, observationId, [])] : [], hostResults: [], events: [],
    })
    return { record }
  }
  private identity(record: LocalAgentRecordV2, runId: string) {
    const task = record.tasks.at(-1)!
    const run = this.active.get(record.id)
    const nativeTurnId = run?.runId === runId ? run.nativeTurnId
      : [...record.events].reverse().find(event => event.runId === runId && event.nativeTurnId !== null)?.nativeTurnId ?? null
    return { taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, runId, nativeTurnId }
  }
  private markTiming(record: LocalAgentRecordV2, observed: AiTask, runId: string, stage: AiTaskTimingStage, at = Date.now()): void {
    const task = record.tasks.at(-1)
    if (task) record.tasks[record.tasks.length - 1] = recordAiTaskTiming(task, observed, runId, stage, at)
  }
  private append(record: LocalAgentRecordV2, runId: string, event: LocalAgentNativeEvent | Omit<Extract<LocalAgentEventV2, { kind: 'turn-ended' }>, 'version' | 'sessionId' | 'sequence' | 'time'>): void {
    const last = [...record.events].reverse().find(value => value.kind !== 'user-message')
    if (last?.kind === 'turn-ended' && last.runId === runId && event.kind !== 'user-message') return
    record.events.push(localAgentEventV2Schema.parse({
      version: 2, sessionId: record.id, sequence: record.events.length + 1, time: Date.now(),
      ...this.identity(record, runId), ...event,
    }))
  }
  private appendUserMessage(record: LocalAgentRecordV2, runId: string, itemId: string, text: string, purpose: 'initial' | 'supplement' | 'correct' | 'answer') {
    if (record.events.some(event => event.kind === 'user-message' && event.itemId === itemId)) return
    this.append(record, runId, { ...this.identity(record, runId), kind: 'user-message', itemId, text, purpose })
  }
  private failInterrupted(owner: SessionOwner): void {
    const task = owner.record.tasks.at(-1)
    if (task) owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...stopAiTask(task), status: task.committedResultIds.length ? 'partial' : 'failed' })
    this.append(owner.record, randomUUID(), {
      kind: 'turn-ended', status: 'failed', failure: { category: 'protocol', message: '应用已中断；未保存的应用结果无法确认。已记录的实际提交保留，请检查当前课件并以新观察恢复已有会话' },
      ...this.identity(owner.record, randomUUID()),
    })
  }
  private async persist(owner: SessionOwner): Promise<void> {
    // Take the snapshot only after a concurrent explicit budget transaction has
    // settled. Otherwise an older event flush could overwrite its durable ACK.
    const budgetWrite = this.active.get(owner.record.id)?.budgetWrite
    if (budgetWrite) await budgetWrite
    if (this.stoppedSessions.has(owner.record.id) && owner.record.tasks.at(-1)) {
      owner.record.tasks[owner.record.tasks.length - 1] = stopAiTask(owner.record.tasks.at(-1)!)
    }
    const task = owner.record.tasks.at(-1)
    const terminal = task && ['completed', 'failed', 'cancelled', 'partial'].includes(task.status)
    const runId = owner.record.events.at(-1)?.runId
    if (terminal && runId) this.markTiming(owner.record, task, runId, 'taskEnded')
    await this.repository.write(localAgentRecordV2Schema.parse(owner.record))
    if (task && (terminal || task.execution && Date.now() >= task.execution.deadlineAt)) {
      // A Stop can race with an actual renderer receipt, so retain its small
      // original wire identity while releasing materialized image payloads.
      const proposal = this.proposals.get(owner.record.id)
      if (proposal) proposal.proposal.candidate = proposal.wireCandidate
      try {
        await new CandidateStaging(this.repository.stagingPath(owner.record.workspace, owner.record.workingDirectoryId, 2)).releaseTaskMedia(task.taskId)
      } catch { owner.cleanupIssue = '任务素材清理失败，可重试删除' }
    }
    await this.repository.writeDisplay(owner.record.workspace, owner.record.id, { hostResult: owner.hostResult, cleanupIssue: owner.cleanupIssue })
  }
  private async savePendingFeedback(workspace: AiWorkspaceIdentity, id: string): Promise<void> {
    const pending = this.pendingHostResults.get(id)
    if (!pending) return
    if (workspaceIdentityKey(pending.record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('回执不属于当前工程')
    await this.persist(pending)
    this.pendingHostResults.delete(id)
    this.storageFailures.delete(id)
  }
  private async pendingReceipts(owner: SessionOwner, requestedExternalId?: string): Promise<SessionOwner[]> {
    const listed = await this.repository.list(owner.record.workspace)
    const sources = new Map(listed.v2.map(record => {
      const display = listed.records.find(value => value.id === record.id)
      return [record.id, { record, generationRequest: display?.generationRequest, hostResult: display?.hostResult, cleanupIssue: display?.cleanupIssue } as SessionOwner]
    }))
    for (const [id, pending] of this.pendingHostResults) sources.set(id, pending)
    sources.set(owner.record.id, owner)
    return [...sources.values()].filter(source => workspaceIdentityKey(source.record.workspace) === workspaceIdentityKey(owner.record.workspace)
      && source.record.externalSessionId === (owner.record.externalSessionId ?? requestedExternalId) && source.record.workingDirectoryId === owner.record.workingDirectoryId
      && source.record.hostResults.some(result => result.receiptDelivery === 'pending'))
  }
  private async acknowledgeReceipts(sources: SessionOwner[]): Promise<void> {
    for (const source of sources) {
      source.record.hostResults = source.record.hostResults.map(result => result.receiptDelivery === 'pending' ? { ...result, receiptDelivery: 'delivered' } : result)
      const latest = source.record.hostResults.at(-1)
      if (latest && source.hostResult?.status !== 'undone') source.hostResult = projectAiHostResult(latest)
      this.pendingHostResults.set(source.record.id, source)
      try { await this.persist(source); this.pendingHostResults.delete(source.record.id); this.storageFailures.delete(source.record.id) }
      catch { /* The native turn has accepted the facts; retain this exact acknowledged record for a storage retry. */ }
    }
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
  private launch(owner: SessionOwner, prompt: string, externalId?: string, request?: GenerationRequest, userMessage?: string, promptPhase: GenerationPromptPhase = 'initial', promptFactory?: ActiveRun['promptFactory']): Promise<void> {
    if (this.stoppedSessions.has(owner.record.id)) return Promise.reject(new Error('任务已停止，不再启动原生回合'))
    if (this.closing || this.deletingScopes.has(workspaceIdentityKey(owner.record.lessonWorkspace ?? owner.record.workspace))) return Promise.reject(new Error('会话服务正在关闭或删除当前记录'))
    this.launching.add(owner.record.id)
    const pending = this.prepareLaunch(owner, prompt, externalId, request, userMessage, promptPhase, promptFactory)
    this.launches.add(pending)
    return pending.finally(() => { this.launches.delete(pending); this.launching.delete(owner.record.id) })
  }
  private async prepareLaunch(owner: SessionOwner, prompt: string, externalId?: string, request?: GenerationRequest, userMessage?: string, promptPhase: GenerationPromptPhase = 'initial', promptFactory?: ActiveRun['promptFactory']): Promise<void> {
    if (this.active.size + this.pendingLaunches >= 3) throw new Error('最多同时运行三个 CLI 会话')
    this.pendingLaunches++
    let cwd: string | undefined
    try {
      const adapter = this.factory(owner.record.adapter, request)
      cwd = await this.repository.staging(owner.record.workspace, owner.record.workingDirectoryId, 2)
      if (request) {
        const task = owner.record.tasks.at(-1)!
        await new CandidateStaging(cwd).create(request, taskMediaIdentity(task))
        if (promptPhase === 'host-feedback' && !request.resourceFiles?.some(file => ['pending-host-results.json', 'host-result.json'].includes(file.path))) {
          await fs.writeFile(path.join(cwd, 'candidates', request.requestId, 'host-result.json'), JSON.stringify({
            version: 1, source: 'formal-host-result', result: owner.hostResult, hostResult: owner.record.hostResults.at(-1),
          }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        }
      }
      const run: ActiveRun = { owner, adapter, done: Promise.resolve(), runId: randomUUID(), nativeTurnId: null, cancelled: false, acceptingInputs: true, inputWrites: new Set(), promptPhase, promptFactory }
      if (userMessage) this.appendUserMessage(owner.record, run.runId, randomUUID(), userMessage, 'initial')
      this.markTiming(owner.record, owner.record.tasks.at(-1)!, run.runId, 'requestPrepared')
      await this.persist(owner)
      if (this.stoppedSessions.has(owner.record.id)) throw new Error('任务已停止，不再启动原生回合')
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
    const nativeText = new Map<string, string>(), nativeToolStates = new Map<string, string>(), nativeUsage = new Map<string, number>()
    let preference: LocalAgentConfiguration | undefined
    let turnPending = task.pendingInputs ?? []
    let timeout: ReturnType<typeof setTimeout> | undefined
    let interrupted = false
    run.idleSince = Date.now()
    const checkBudget = () => {
      clearTimeout(timeout)
      if (run.cancelled) return
      const current = owner.record.tasks.at(-1)!, execution = current.execution
      if (!execution) return
      const now = Date.now()
      const idleDeadline = current.status === 'running' && !tools.size
        ? Math.max(execution.lastActivityAt ?? execution.startedAt, run.idleSince ?? 0) + GENERATION_NATIVE_INACTIVITY_MS : Infinity
      const reason = now >= execution.deadlineAt ? 'resource-budget' : now >= idleDeadline ? 'native-inactivity' : undefined
      if (!reason) { timeout = setTimeout(checkBudget, Math.max(1, Math.min(execution.deadlineAt, idleDeadline) - now)); return }
      this.append(owner.record, run.runId, { kind: 'turn-ended', status: 'failed', failure: { category: 'limit',
        message: reason === 'resource-budget' ? '本次明确设置的执行预算已用完；已提交阶段保留'
          : '20分钟未收到原生活动，且没有已知进行中的工具或待回答问题；本任务已结束，已提交阶段保留' }, ...this.identity(owner.record, run.runId) })
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...stopAiTask(current),
        status: current.committedResultIds.length ? 'partial' : 'failed', execution: { ...execution, budgetStopReason: reason } })
      run.cancelled = true
      void adapter.close().catch(() => {})
    }
    run.budgetChanged = checkBudget
    checkBudget()
    let configurationConfirmed = true
    const observation = owner.record.observations.find(value => value.observationId === task.observationId)
    if (observation) for (const file of observation.files) files.set(file.fileId, path.join(this.repository.observationPath(owner.record.workspace, owner.record.workingDirectoryId, observation.observationId), file.relativePath))
    const images = observation?.files.filter(file => file.role === 'image').map(file => file.fileId) ?? []
    let stage = '打开原生 CLI'
    try {
      await this.configurationWrites.get(adapter.id)
      preference = await this.repository.readConfiguration(adapter.id)
      configurationConfirmed = !preference
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!,
        configurationRuns: [...(owner.record.tasks.at(-1)!.configurationRuns ?? []), { runId: run.runId, requested: preference ?? null }] })
      await this.persist(owner)
      const nativeCwd = 'kind' in owner.record.workspace ? await fs.realpath(owner.record.workspace.normalizedDirectory) : await nativeWorkspaceDirectory(owner.record.workspace.normalizedPath)
      if (run.cancelled) return
      this.markTiming(owner.record, task, run.runId, 'nativeOpenStarted')
      const opened = await adapter.open({ cwd: nativeCwd, externalSessionId: externalId ?? null,
        ...(preference ? { configuration: preference } : {}),
        ...(owner.generationRequest ? { candidateRoot: path.join(cwd, 'candidates', owner.generationRequest.requestId) } : {}) })
      if (run.cancelled) return
      this.markTiming(owner.record, task, run.runId, 'nativeOpened')
      if (this.captureExternalSession(owner, opened.externalSessionId, externalId)) await this.persist(owner)
      stage = '应用模型配置'
      const capabilities = localAgentCapabilitiesSchema.parse(preference ? await adapter.configure(preference) : opened.capabilities)
      if (preference) this.assertRequestedConfiguration(preference, capabilities)
      configurationConfirmed = !preference || this.configurationMatches(preference, capabilities)
      await this.rememberCapabilities(nativeCwd, capabilities)
      if (run.cancelled) return
      let feedbackSources = await this.pendingReceipts(owner, externalId)
      const pendingResults = feedbackSources.flatMap(source => source.record.hostResults.filter(result => result.receiptDelivery === 'pending'))
      let pendingReceiptPath: string | undefined
      if (pendingResults.length) {
        if (owner.generationRequest?.resourceFiles?.some(file => file.path === 'pending-host-results.json')) {
          pendingReceiptPath = path.join(cwd, 'candidates', owner.generationRequest.requestId, 'resources', 'pending-host-results.json')
        } else {
          pendingReceiptPath = owner.generationRequest
            ? path.join(cwd, 'candidates', owner.generationRequest.requestId, 'pending-host-results.json')
            : path.join(cwd, 'pending-host-results', `${task.taskId}-${run.runId}.json`)
          await fs.mkdir(path.dirname(pendingReceiptPath), { recursive: true })
          await fs.writeFile(pendingReceiptPath, JSON.stringify({ version: 1, source: 'pending-formal-host-results', results: pendingResults }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        }
      }
      const pendingPrefix = generationPendingReceiptPrompt(owner.record.workspace, pendingResults, pendingReceiptPath ?? '')
      const available = Math.max(0, MAX_GENERATION_PROMPT_BYTES - Buffer.byteLength(pendingPrefix, 'utf8'))
      const finalPrompt = run.promptFactory ? run.promptFactory(available) : owner.generationRequest && run.promptPhase === 'initial'
        ? this.generationPrompt(owner.record.adapter, owner.generationRequest, path.join(cwd, 'candidates', owner.generationRequest.requestId), 'initial', available)
        : prompt
      let turnPrompt = `${pendingPrefix}${finalPrompt}`
      if (Buffer.byteLength(turnPrompt) > MAX_GENERATION_PROMPT_BYTES) throw new Error('正式回执与请求超过本轮发送预算')
      for (;;) {
      completed = false
      interrupted = false
      stage = '启动原生回合'
      if (run.cancelled || Date.now() >= (owner.record.tasks.at(-1)?.execution?.deadlineAt ?? Infinity)) throw new Error('output-limit')
      this.markTiming(owner.record, task, run.runId, 'turnDispatchStarted')
      const started = await adapter.startTurn({
        taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, runId: run.runId,
        observationId: task.observationId ?? randomUUID(), text: turnPrompt, imageFileIds: images,
      }, files)
      const configuredTask = owner.record.tasks.at(-1)!
      const configurationRuns = configuredTask.configurationRuns ?? []
      const configurationRun = { runId: run.runId, requested: preference ?? null, ...started.configuration }
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...configuredTask,
        configurationRuns: configurationRuns.some(entry => entry.runId === run.runId)
          ? configurationRuns.map(entry => entry.runId === run.runId ? configurationRun : entry) : [...configurationRuns, configurationRun] })
      if (started.inputMetrics) {
        const current = owner.record.tasks.at(-1)!
        owner.record.tasks[owner.record.tasks.length - 1] = recordAiTaskInputMetrics(current, task, run.runId, started.inputMetrics)
      }
      if (!run.cancelled) this.markTiming(owner.record, task, run.runId, 'turnAccepted')
      run.nativeTurnId = started.nativeTurnId
      // startTurn acknowledgement is the first evidence that the native session received these facts.
      if (feedbackSources.length) { await this.acknowledgeReceipts(feedbackSources); feedbackSources = [] }
      stage = '读取原生事件'
      if (turnPending.length) {
        const consumed = new Set(turnPending.map(input => input.inputId))
        owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!,
          pendingInputs: (owner.record.tasks.at(-1)?.pendingInputs ?? []).filter(input => !consumed.has(input.inputId)) })
        for (const input of turnPending) this.append(owner.record, run.runId, { kind: 'input-delivery', ...this.identity(owner.record, run.runId), delivery: {
          taskId: task.taskId, epoch: task.epoch, workspace: task.workspace, inputId: input.inputId, status: 'consumed', turnId: run.nativeTurnId, reason: null,
        } })
        turnPending = []
      }
      for await (const event of adapter.events()) {
        if (run.budgetWrite) await run.budgetWrite
        if (run.cancelled) break
        if (event.taskId !== task.taskId || event.epoch !== task.epoch || event.runId !== run.runId
          || workspaceIdentityKey(event.workspace) !== workspaceIdentityKey(task.workspace)) continue
        this.markTiming(owner.record, task, run.runId, 'firstNativeEvent')
        let activity = false
        if (event.kind === 'text') {
          const key = `${event.runId}:${event.itemId}:${event.phase}`, before = nativeText.get(key) ?? ''
          const after = event.operation === 'append' ? before + event.text : event.text
          activity = after !== before && Boolean(event.text.trim())
          nativeText.set(key, after)
        } else if (event.kind === 'tool') {
          const key = `${event.runId}:${event.itemId}`, before = nativeToolStates.get(key)
          if (before === event.status) continue
          nativeToolStates.set(key, event.status); activity = true
        } else if (event.kind === 'usage') {
          const values = event.tokenUsage?.total ?? { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedInputTokens: event.cachedInputTokens }
          for (const [key, value] of Object.entries(values)) if (typeof value === 'number' && value > (nativeUsage.get(key) ?? 0)) {
            nativeUsage.set(key, value); activity = true
          }
        } else if (event.kind === 'question') activity = true
        if (activity) {
          const current = owner.record.tasks.at(-1)!
          if (current.execution) current.execution.lastActivityAt = Date.now()
        }
        if (event.kind === 'text' && event.phase !== 'candidate'
          && !owner.record.tasks.at(-1)?.execution?.timing?.entries.some(entry => entry.runId === run.runId && entry.stage === 'firstVisibleText')) {
          const prior = projectV2RecordToV1({ ...owner.record, events: owner.record.events.filter(value => value.runId === run.runId) })
          const textEvents = [...prior.events, { version: 1, adapter: owner.record.adapter, sessionId: owner.record.id,
            sequence: owner.record.events.length + 1, kind: 'text', time: Date.now(),
            payload: { text: event.text, messageId: event.itemId, phase: event.phase, delta: event.operation === 'append' } } as LocalAgentRecord['events'][number]]
          if (visibleLocalAgentText(localAgentText(textEvents))) this.markTiming(owner.record, task, run.runId, 'firstVisibleText')
        }
        if (event.nativeTurnId !== null) run.nativeTurnId = event.nativeTurnId
        if (owner.record.events.length >= 19990) throw new Error('output-limit')
        if (this.captureExternalSession(owner, adapter.getExternalSessionId?.(), externalId)) await this.persist(owner)
        if (event.kind === 'configuration') {
          const capabilities = localAgentCapabilitiesSchema.parse(event.capabilities)
          if (capabilities.adapter !== adapter.id) throw new Error('protocol')
          if (preference) this.assertRequestedConfiguration(preference, capabilities)
          configurationConfirmed = !preference || this.configurationMatches(preference, capabilities)
          const current = owner.record.tasks.at(-1)!
          owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...current,
            configurationRuns: current.configurationRuns?.map(entry => entry.runId === run.runId ? { ...entry, confirmed: capabilities.current } : entry) })
          await this.rememberCapabilities(nativeCwd, capabilities)
        }
        if (event.kind === 'turn-ended') {
          if (event.status === 'cancelled' && run.interruptRequested) {
            interrupted = true
            tools.clear() // Native cancellation confirms outstanding operations have ended.
            break
          }
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
        checkBudget()
        if (event.kind === 'turn-ended') break
        // A native permission/clarification can suspend the event stream. Its
        // waiting state must be durable without depending on a later event.
        if (event.kind === 'question' || owner.record.events.length % 32 === 0 || Date.now() - lastFlush >= 250) {
          await this.persist(owner); lastFlush = Date.now()
        }
      }
      while (run.inputWrites.size && !run.cancelled) await Promise.all([...run.inputWrites])
      const pending = owner.record.tasks.at(-1)?.pendingInputs ?? []
      if (run.cancelled || (interrupted && !run.interruptConfirmed) || (!completed && !interrupted) || !pending.length) { run.acceptingInputs = false; break }
      if (tools.size) throw new Error('protocol')
      const current = owner.record.tasks.at(-1)!
      if (current.execution && Date.now() >= current.execution.deadlineAt) throw new Error('output-limit')
      this.append(owner.record, run.runId, { kind: 'turn-ended', status: interrupted ? 'cancelled' : 'completed', failure: null, ...this.identity(owner.record, run.runId) })
      run.runId = randomUUID()
      run.nativeTurnId = null
      run.interruptRequested = false
      run.interruptConfirmed = false
      owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...current, status: 'running',
        ...(current.execution ? { execution: { ...current.execution, turnCount: current.execution.turnCount + 1 } } : {}) })
      turnPending = pending
      if (owner.generationRequest) await fs.rm(path.join(cwd, 'candidates', owner.generationRequest.requestId, 'candidate.json'), { force: true })
      turnPrompt = '用户在上一回合中补充或纠正了要求，上一回合的候选尚未提交。请以当前不可变观察与以下输入继续，不得宣称已写入工程。\n' + pending.map(input => input.text).join('\n')
      this.markTiming(owner.record, task, run.runId, 'requestPrepared')
      await this.persist(owner)
      }
      if (!run.cancelled && !owner.record.events.some(event => event.kind === 'turn-ended' && event.runId === run.runId)) {
        if (tools.size || !completed || !owner.record.externalSessionId || !configurationConfirmed) throw new Error('protocol')
        const explicitCandidateFile = owner.generationRequest && owner.record.adapter === 'codex' && owner.record.events.some(event =>
          event.runId === run.runId && event.kind === 'text' && event.phase === 'candidate'
          && event.text === generationStagedCandidateMarker(owner.generationRequest!.requestId))
        if (owner.generationRequest && (explicitCandidateFile || createGenerationProfile(owner.record.adapter, owner.generationRequest).capability.candidateFileIngestion)) {
          const candidate = await new CandidateStaging(cwd).readText(owner.generationRequest.requestId)
          if (run.cancelled) return
          // A declared but missing candidate file is a recoverable delivery
          // omission, not a transport failure: the declaration stays in the
          // record and candidate reading returns the exact cause, expected
          // artifact and next step for one bounded native continuation.
          if (candidate !== null) this.append(owner.record, run.runId, {
            kind: 'text', itemId: `candidate-file:${owner.generationRequest.requestId}`, phase: 'candidate', operation: 'replace',
            text: owner.record.adapter === 'codex' ? codexCandidateFileMessage(candidate) : `${GENERATION_OPEN}${candidate}${GENERATION_CLOSE}`, ...this.identity(owner.record, run.runId),
          })
        }
        this.append(owner.record, run.runId, { kind: 'turn-ended', status: 'completed', failure: null, ...this.identity(owner.record, run.runId) })
        owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!, status: owner.generationRequest ? 'checking' : 'completed' })
        if (owner.generationRequest) this.preparedSessions.add(owner.record.id)
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
      run.budgetChanged = undefined
      const terminal = owner.record.events.at(-1)
      if (!run.cancelled && terminal?.kind === 'turn-ended' && terminal.status !== 'completed') owner.record.tasks[owner.record.tasks.length - 1] = aiTaskSchema.parse({ ...owner.record.tasks.at(-1)!, status: owner.record.tasks.at(-1)!.committedResultIds.length ? 'partial' : terminal.status })
      try { await adapter.close() } catch { /* Terminal failure stays observable even if the child already exited. */ }
      if (owner.generationRequest && (run.cancelled || terminal?.kind !== 'turn-ended' || terminal.status !== 'completed')) {
        try { await new CandidateStaging(cwd).remove(owner.generationRequest.requestId) }
        catch { owner.cleanupIssue = '候选暂存清理失败，可重试删除' }
      }
      try { await this.persist(owner) } catch {
        this.storageFailures.set(owner.record.id, { workspace: workspaceIdentityKey(owner.record.workspace), record: this.project(owner, false) })
      }
      this.active.delete(owner.record.id)
    }
  }
  private generationPrompt(adapter: LocalAgentId, request: GenerationRequest, candidateRoot: string, phase: GenerationPromptPhase = 'initial', maxBytes = MAX_GENERATION_PROMPT_BYTES): string {
    return buildGenerationPrompt(adapter, request, candidateRoot, phase, maxBytes)
  }
}
