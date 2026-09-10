import { z } from 'zod'
import { authoringObservationSpatialViewSchema } from './authoringObservation'
import { aiTaskIdentityFields, aiQuestionSchema, aiInputDeliverySchema, type AiUserInput } from './localAgentInteraction'
import { workspaceIdentityV1Schema, workspaceIdentityKey } from './workspaceIdentity'
import { authoringToolDestinationV1Schema } from './authoringToolContract'
import { generationAfterCommitSchema, generationFailureSchema, generationCandidateSchema, generationCommitReceiptSchema } from './generationContract'
import { localAgentIdSchema, localAgentRecordSchema, type LocalAgentProbe } from './localAgentContract'
import { localAgentTokenUsageSchema } from './localAgentUsage'

// Local AI protocol only. Version numbers here do not change Course Project V9.
const revision = z.number().int().nonnegative()
const identity = z.string().trim().min(1).max(200)
const taskIdentity = aiTaskIdentityFields
export const aiTaskIdentitySchema = z.object(taskIdentity).strict()
export const aiIntentSchema = z.enum(['discuss', 'plan', 'edit'])
export const aiTaskStatusSchema = z.enum(['observing', 'running', 'waiting-input', 'checking', 'awaiting-apply', 'committing', 'feeding-back', 'completed', 'failed', 'cancelled', 'partial'])
export const aiReadScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selection'), surfaceId: identity, locationId: identity, itemIds: z.array(identity).min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('location'), surfaceId: identity, locationId: identity }).strict(),
  z.object({ kind: z.literal('course') }).strict(),
])
// Diagnostic boundaries only: no model/service attribution and no render or durability claim.
export const MAX_AI_TASK_TIMING_ENTRIES = 256
export const aiTaskTimingStageSchema = z.enum([
  'requestPrepared', 'nativeOpenStarted', 'nativeOpened', 'turnDispatchStarted', 'turnAccepted',
  'firstNativeEvent', 'candidateParsed', 'hostResultRecorded', 'hostCommitRecorded',
])
export const aiTaskTimingEntrySchema = z.object({
  runId: z.uuid(), observationId: z.uuid(), stage: aiTaskTimingStageSchema, at: revision,
}).strict()
export const aiTaskTimingSchema = z.object({
  version: z.literal(1), entries: z.array(aiTaskTimingEntrySchema).max(MAX_AI_TASK_TIMING_ENTRIES),
}).strict().superRefine((timing, ctx) => {
  const stages = new Set<string>(), observations = new Map<string, string>()
  for (const entry of timing.entries) {
    const key = `${entry.runId}:${entry.stage}`
    if (stages.has(key)) ctx.addIssue({ code: 'custom', message: '重复原生回合计时阶段' })
    if (observations.has(entry.runId) && observations.get(entry.runId) !== entry.observationId) ctx.addIssue({ code: 'custom', message: '同一原生回合计时引用不同观察' })
    stages.add(key); observations.set(entry.runId, entry.observationId)
  }
})
export type AiTaskTimingEntry = z.infer<typeof aiTaskTimingEntrySchema>
export type AiTaskTimingStage = z.infer<typeof aiTaskTimingStageSchema>
export const aiTaskSchema = z.object({
  version: z.literal(1), ...taskIdentity, sessionId: z.uuid(), adapter: localAgentIdSchema,
  goal: z.string().trim().min(1).max(20000), intent: aiIntentSchema,
  applyPolicy: z.enum(['auto', 'preview']), readScope: aiReadScopeSchema,
  // A snapshot of authorization; refresh revisions via canonical prepare, never widen targets.
  writeDestinations: z.array(authoringToolDestinationV1Schema).max(1000),
  status: aiTaskStatusSchema, observationId: z.uuid().nullable(),
  committedResultIds: z.array(z.uuid()).max(1000),
  completion: z.object({ version: z.literal(1), resultId: z.uuid(), outcome: z.enum(['modified', 'unchanged']) }).strict().optional(),
  execution: z.object({
    startedAt: revision, deadlineAt: revision, turnCount: revision,
    formatRepairs: revision, stagnantCandidates: revision,
    lastChangeKey: z.string().max(160000).nullable(), lastDiagnostic: z.string().max(4000).nullable(),
    timing: aiTaskTimingSchema.optional(),
  }).strict().optional(),
  pendingInputs: z.array(z.object({ inputId: z.uuid(), text: z.string().max(20000), kind: z.enum(['correct', 'supplement']) }).strict()).max(100).optional(),
}).strict().superRefine((task, ctx) => {
  if (task.intent !== 'edit' && task.writeDestinations.length) ctx.addIssue({ code: 'custom', message: '讨论和计划没有工程写入授权' })
  if (new Set(task.committedResultIds).size !== task.committedResultIds.length) ctx.addIssue({ code: 'custom', message: '重复已提交结果' })
  for (const destination of task.writeDestinations) {
    const target = destination.kind === 'update' ? destination.target : destination.scope
    if (target.projectId !== task.workspace.projectId) ctx.addIssue({ code: 'custom', message: '写入授权不属于当前工程' })
  }
})
export type AiTask = z.infer<typeof aiTaskSchema>

// References resolve inside the current immutable observation root, never arbitrary OS paths.
export const aiObservationFileSchema = z.object({
  fileId: identity, relativePath: z.string().min(1).max(1000).refine(value =>
    !value.includes('\\') && !value.includes(':') && !value.includes('\0') && !value.startsWith('/') &&
    !value.split('/').some(part => !part || part === '.' || part === '..'), '需要观察根内的相对文件路径'),
  mediaType: z.string().min(1).max(100), byteLength: revision,
  role: z.enum(['structure', 'image', 'capability', 'material', 'runtime-evidence']),
}).strict()
export const aiObservationSchema = z.object({
  version: z.literal(1), ...taskIdentity, observationId: z.uuid(), capturedAt: revision,
  documentRevision: revision, sessionGeneration: revision, draftEpoch: revision.nullable(), viewEpoch: revision.nullable(),
  runtime: z.object({ sessionId: identity, stateVersion: revision }).strict().nullable(),
  surfaceId: identity, locationId: identity, stateId: identity.nullable(),
  source: z.enum(['generation-snapshot', 'authoring', 'trial', 'preview']), readScope: aiReadScopeSchema,
  spatialView: authoringObservationSpatialViewSchema.optional(),
  files: z.array(aiObservationFileSchema).max(10000),
}).strict().superRefine((observation, ctx) => {
  if (observation.source === 'generation-snapshot') {
    if (observation.draftEpoch !== null || observation.viewEpoch !== null || observation.runtime !== null || observation.files.some(file => ['image', 'runtime-evidence'].includes(file.role))) ctx.addIssue({ code: 'custom', message: '旧生成快照不能声明未捕获的草稿、视觉或运行事实' })
  } else if (observation.draftEpoch === null || observation.viewEpoch === null) ctx.addIssue({ code: 'custom', message: '完整观察需要真实草稿和视图版本' })
  for (const key of ['fileId', 'relativePath'] as const) {
    if (new Set(observation.files.map(file => file[key])).size !== observation.files.length) ctx.addIssue({ code: 'custom', message: `重复观察文件 ${key}` })
  }
})
export type AiObservation = z.infer<typeof aiObservationSchema>

export const aiProposalIdentitySchema = z.object({
  ...taskIdentity, observationId: z.uuid(), requestId: z.uuid(), candidateId: z.uuid(),
}).strict()
export const aiProposalSchema = aiProposalIdentitySchema.extend({
  version: z.literal(1), candidate: generationCandidateSchema,
}).strict().superRefine((proposal, ctx) => {
  if (proposal.requestId !== proposal.candidate.requestId || proposal.candidateId !== proposal.candidate.candidateId) ctx.addIssue({ code: 'custom', message: '候选内外身份不一致' })
})
export type AiProposal = z.infer<typeof aiProposalSchema>
export const aiHostResultSchema = aiProposalIdentitySchema.extend({
  version: z.literal(1), resultId: z.uuid(),
  status: z.enum(['checked', 'rejected', 'stale', 'committed', 'unchanged', 'failed']),
  beforeRevision: revision, afterRevision: revision,
  // Only real live-project receipts belong here. Preparation effects are not receipts.
  receipts: z.array(generationCommitReceiptSchema).max(1),
  summary: z.string().max(4000),
  diagnostics: z.array(z.object({ code: identity, message: z.string().min(1).max(4000), path: z.array(z.union([z.string(), z.number()])).optional() }).strict()).max(1000),
  afterCommit: generationAfterCommitSchema.optional(), failure: generationFailureSchema.optional(),
  receiptDelivery: z.enum(['pending', 'delivered']).optional(),
}).strict().superRefine((result, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (result.status === 'committed') {
    if (result.afterRevision !== result.beforeRevision + 1 || !result.receipts.some(receipt => receipt.status === 'committed')) fail('已提交必须精确增加一次revision且有正式回执')
    if (result.receipts.some(receipt => !['committed', 'unchanged'].includes(receipt.status))) fail('原子提交不能包含失败回执')
  } else if (result.afterRevision !== result.beforeRevision) fail('未提交结果不能改变revision')
  if (!['committed', 'unchanged'].includes(result.status) && result.receipts.length) fail('检查和拒绝不能携带提交回执')
  if (result.status === 'unchanged' && (result.receipts.length !== 1 || result.receipts.some(receipt => receipt.status !== 'unchanged'))) fail('未改变结果需要一份正式无变化回执')
  if (result.afterCommit && !['committed', 'unchanged'].includes(result.status)) fail('只有正式应用结果可以决定提交后行为')
  if (new Set(result.receipts.map(receipt => receipt.requestId)).size !== result.receipts.length) fail('重复正式回执')
  for (const receipt of result.receipts) {
    if (receipt.beforeRevision !== result.beforeRevision || receipt.afterRevision !== result.afterRevision) fail('正式回执revision必须匹配原子事务')
    if (receipt.requestId !== result.requestId || receipt.candidateId !== result.candidateId || workspaceIdentityKey(receipt.workspace) !== workspaceIdentityKey(result.workspace)) fail('正式回执不属于当前候选或工程')
  }
})
export type AiHostResult = z.infer<typeof aiHostResultSchema>

export { aiQuestionSchema, aiUserInputSchema, aiInputDeliverySchema, type AiUserInput } from './localAgentInteraction'

import {
  localAgentCapabilitiesSchema, type LocalAgentCapabilities,
  localAgentConfigurationSchema, type LocalAgentConfiguration,
} from './localAgentContract'
export {
  localAgentCapabilitiesSchema, type LocalAgentCapabilities,
  localAgentConfigurationSchema, type LocalAgentConfiguration,
}

const eventIdentity = { version: z.literal(2), ...taskIdentity, sessionId: z.uuid(), runId: z.uuid(),
  nativeTurnId: identity.nullable(), sequence: z.number().int().positive(), time: revision }
const failure = z.object({
  category: z.enum(['transport', 'service', 'protocol', 'limit', 'capability', 'storage']), message: z.string().min(1).max(4000),
}).strict()
export const localAgentEventV2Schema = z.discriminatedUnion('kind', [
  z.object({ ...eventIdentity, kind: z.literal('text'), itemId: identity, phase: z.enum(['body', 'public-summary', 'plan', 'candidate']), operation: z.enum(['append', 'replace']), text: z.string().max(100000) }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('tool'), itemId: identity, name: identity, status: z.enum(['running', 'completed', 'failed', 'cancelled']), detail: z.json() }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('question'), question: aiQuestionSchema }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('input-delivery'), delivery: aiInputDeliverySchema }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('configuration'), capabilities: localAgentCapabilitiesSchema }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('usage'), inputTokens: revision.nullable(), outputTokens: revision.nullable(), cachedInputTokens: revision.nullable(), tokenUsage: localAgentTokenUsageSchema.optional() }).strict(),
  z.object({ ...eventIdentity, kind: z.literal('turn-ended'), status: z.enum(['completed', 'cancelled', 'failed']), failure: failure.nullable() }).strict(),
]).superRefine((event, ctx) => {
  if (event.kind === 'turn-ended' && ((event.status === 'failed') !== (event.failure !== null))) ctx.addIssue({ code: 'custom', message: '失败回合必须且只能携带failure' })
  const nested = event.kind === 'question' ? event.question : event.kind === 'input-delivery' ? event.delivery : null
  if (nested && (nested.taskId !== event.taskId || nested.epoch !== event.epoch || nested.workspace.projectId !== event.workspace.projectId || nested.workspace.normalizedPath !== event.workspace.normalizedPath)) ctx.addIssue({ code: 'custom', message: '嵌套事件身份不一致' })
})
export type LocalAgentEventV2 = z.infer<typeof localAgentEventV2Schema>
type WithoutRecordEnvelope<T> = T extends unknown ? Omit<T, 'version' | 'sessionId' | 'sequence' | 'time'> : never
export type LocalAgentNativeEvent = WithoutRecordEnvelope<LocalAgentEventV2>

export const localAgentRecordV2Schema = z.object({
  version: z.literal(2), id: z.uuid(), adapter: localAgentIdSchema, workspace: workspaceIdentityV1Schema,
  externalSessionId: identity.nullable(), workingDirectoryId: z.uuid(),
  tasks: z.array(aiTaskSchema).max(1000), observations: z.array(aiObservationSchema).max(1000),
  hostResults: z.array(aiHostResultSchema).max(1000), events: z.array(localAgentEventV2Schema).max(20000),
}).strict().superRefine((record, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  const tasks = new Map(record.tasks.map(task => [task.taskId, task]))
  if (tasks.size !== record.tasks.length) fail('重复任务')
  const belongs = (value: { workspace: { projectId: string; normalizedPath: string } }) => value.workspace.projectId === record.workspace.projectId && value.workspace.normalizedPath === record.workspace.normalizedPath
  for (const task of record.tasks) if (!belongs(task) || task.sessionId !== record.id || task.adapter !== record.adapter) fail('任务不属于当前会话')
  for (const [index, event] of record.events.entries()) {
    const task = tasks.get(event.taskId)
    if (!belongs(event) || event.sessionId !== record.id || event.sequence !== index + 1 || !task || event.epoch > task.epoch) fail('事件身份或顺序错误')
    if (event.kind === 'configuration' && event.capabilities.adapter !== record.adapter) fail('配置属于其他CLI')
  }
  for (const observation of record.observations) if (!belongs(observation) || !tasks.has(observation.taskId) || observation.epoch > tasks.get(observation.taskId)!.epoch) fail('观察不属于当前任务历史')
  for (const result of record.hostResults) if (!belongs(result) || !tasks.has(result.taskId) || result.epoch > tasks.get(result.taskId)!.epoch) fail('宿主结果不属于当前任务历史')
  if (new Set(record.observations.map(value => value.observationId)).size !== record.observations.length) fail('重复观察')
  if (new Set(record.hostResults.map(value => value.resultId)).size !== record.hostResults.length) fail('重复宿主结果')
  for (const task of record.tasks) for (const resultId of task.committedResultIds) {
    if (!record.hostResults.some(result => result.resultId === resultId && result.taskId === task.taskId && result.status === 'committed')) fail('任务引用不存在的实际提交')
  }
  for (const task of record.tasks) if (task.completion) {
    const result = record.hostResults.find(value => value.resultId === task.completion!.resultId && value.taskId === task.taskId)
    if (task.status !== 'completed' || !result || result.afterCommit?.action !== 'finish'
      || result.status !== (task.completion.outcome === 'modified' ? 'committed' : 'unchanged')) fail('完成状态必须对应真实的终结回执')
  }
  for (const task of record.tasks) if (task.observationId !== null && !record.observations.some(observation => observation.observationId === task.observationId && observation.taskId === task.taskId)) fail('任务引用不存在的观察')
  for (const task of record.tasks) for (const entry of task.execution?.timing?.entries ?? []) {
    if (!record.observations.some(observation => observation.observationId === entry.observationId && observation.taskId === task.taskId)) fail('计时引用不属于当前任务的观察')
  }
  for (const result of record.hostResults) if (!record.observations.some(observation => observation.observationId === result.observationId && observation.taskId === result.taskId && observation.epoch === result.epoch && observation.documentRevision === result.beforeRevision)) fail('结果引用不存在或版本不一致的观察')
})
export type LocalAgentRecordV2 = z.infer<typeof localAgentRecordV2Schema>

export const localAgentTurnInputSchema = z.object({
  ...taskIdentity, runId: z.uuid(), observationId: z.uuid(), text: z.string().min(1).max(160000),
  imageFileIds: z.array(identity).max(100),
}).strict()
/** Native transport port. Harness owns task state; renderer never supplies executable args/paths. */
export interface LocalAgentCliAdapterV2 {
  readonly id: z.infer<typeof localAgentIdSchema>
  open(input: { cwd: string; externalSessionId: string | null; candidateRoot?: string; configuration?: LocalAgentConfiguration }): Promise<{ externalSessionId: string | null; capabilities: LocalAgentCapabilities }>
  /** Only an identity confirmed by the native process may be persisted or resumed. */
  getExternalSessionId?(): string | null
  discoverCapabilities?(input?: { cwd: string }): Promise<LocalAgentCapabilities>
  configure(input: z.infer<typeof localAgentConfigurationSchema>): Promise<LocalAgentCapabilities>
  startTurn(input: z.infer<typeof localAgentTurnInputSchema>, observationFiles: ReadonlyMap<string, string>): Promise<{ nativeTurnId: string | null }>
  input(input: AiUserInput): Promise<z.infer<typeof aiInputDeliverySchema>>
  events(): AsyncIterable<LocalAgentNativeEvent>
  close(): Promise<void>
  probe?(): Promise<LocalAgentProbe>
}

/** Read-only history projection. Deliberately cannot be passed to start/resume/generate. */
export function projectLegacyAgentHistory(input: unknown) {
  const record = parseLocalAgentLegacyRecord(input)
  return {
    kind: 'legacy-history' as const, id: record.id, adapter: record.adapter, workspace: record.workspace,
    status: record.status === 'running' ? 'interrupted' as const : record.status,
    events: record.events.map(({ externalSessionId: _externalSessionId, ...event }) => event), hostResult: record.hostResult ?? null,
    canReplayCandidate: false as const, requiresFreshObservation: true as const,
  }
}

/** Existing V1 disk semantics, shared by the repository and future read-only history view. */
export function parseLocalAgentLegacyRecord(input: unknown) {
  const record = localAgentRecordSchema.parse(input)
  if (record.generationRequest && (record.generationRequestId !== record.generationRequest.requestId || workspaceIdentityKey(record.generationRequest.workspace) !== workspaceIdentityKey(record.workspace))) throw new Error('Generation request mismatch')
  if (record.hostResult && record.hostResult.requestId !== record.generationRequestId) throw new Error('Host result mismatch')
  for (const [index, event] of record.events.entries()) {
    if (event.sequence !== index + 1 || event.sessionId !== record.id || event.adapter !== record.adapter) throw new Error('Event identity mismatch')
  }
  const terminals = record.events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.kind))
  if (record.status === 'running' ? terminals.length !== 0 : terminals.length !== 1 || record.events.at(-1)?.kind !== record.status) throw new Error('Terminal state mismatch')
  return record
}
