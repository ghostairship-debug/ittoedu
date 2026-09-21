import { z } from 'zod'
import { workspaceIdentityV1Schema, aiWorkspaceIdentitySchema, conversationAgentWorkspaceSchema, lessonAgentWorkspaceSchema } from './workspaceIdentity'
import { frozenEditTargetSchema } from './lessonWorkspace'
import { generationAfterCommitSchema, generationFailureSchema, generationCommitReceiptSchema, generationRequestSchema } from './generationContract'
import { generationResultSchema } from './generationResult'
import { aiUserInputSchema, aiInputDeliverySchema } from './localAgentInteraction'
import { generationSemanticChangesSchema } from './generationChangeSummary'
import { generationExecutionEvidenceSchema } from './generationExecutionEvidence'
import { externalAiNoticeStatusSchema } from './externalAiNotice'

export const localAgentIdSchema = z.enum(['codex', 'claude', 'opencode'])
export type LocalAgentId = z.infer<typeof localAgentIdSchema>
export const localAgentFailureSchema = z.enum(['missing', 'unauthenticated', 'rate-limited', 'unsupported-version', 'launch', 'protocol', 'output-limit', 'crash', 'storage', 'interrupted'])
export const localAgentEventSchema = z.object({
  version: z.literal(1), adapter: localAgentIdSchema, sessionId: z.uuid(),
  externalSessionId: z.string().min(1).max(200).optional(),
  sequence: z.number().int().positive(), time: z.number().int().nonnegative(),
  kind: z.enum(['session', 'user-message', 'text', 'tool-call', 'tool-result', 'usage', 'completed', 'failed', 'cancelled']),
  payload: z.json(), failure: localAgentFailureSchema.optional(),
}).strict().superRefine((event, ctx) => {
  if ((event.kind === 'failed') !== (event.failure !== undefined)) ctx.addIssue({ code: 'custom', message: 'failed requires a failure category' })
})
export type LocalAgentEvent = z.infer<typeof localAgentEventSchema>
export const localAgentHostResultSchema = z.object({
  requestId: z.uuid(), status: z.enum(['checked', 'rejected', 'stale', 'committed', 'unchanged', 'undone']),
  beforeRevision: z.number().int().nonnegative().optional(), afterRevision: z.number().int().nonnegative().optional(),
  candidateId: z.uuid().optional(),
  summary: z.string().max(4000),
  semanticChanges: generationSemanticChangesSchema.optional(),
  executionEvidence: generationExecutionEvidenceSchema.optional(),
  afterCommit: generationAfterCommitSchema.optional(), failure: generationFailureSchema.optional(),
  receiptDelivery: z.enum(['pending', 'delivered']).optional(),
}).strict()
export type LocalAgentHostResult = z.infer<typeof localAgentHostResultSchema>
export const localAgentRecordSchema = z.object({
  version: z.literal(1), id: z.uuid(), adapter: localAgentIdSchema, workspace: aiWorkspaceIdentitySchema, lessonWorkspace: lessonAgentWorkspaceSchema.optional(),
  workingDirectoryId: z.uuid().optional(),
  generationRequestId: z.uuid().optional(),
  generationRequest: generationRequestSchema.optional(),
  hostResult: localAgentHostResultSchema.optional(),
  cleanupIssue: z.string().min(1).max(1000).optional(),
  externalSessionId: z.string().min(1).max(200).optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  task: z.object({
    taskId: z.uuid(), epoch: z.number().int().nonnegative(),
    intent: z.enum(['discuss', 'plan', 'edit']), applyPolicy: z.enum(['auto', 'preview']),
    status: z.enum(['observing', 'running', 'waiting-input', 'checking', 'awaiting-apply', 'committing', 'feeding-back', 'completed', 'failed', 'cancelled', 'partial']),
    turnId: z.string().nullable(), deadlineAt: z.number().int().nonnegative().nullable(), committedStages: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().optional(), lastActivityAt: z.number().int().nonnegative().optional(),
    budgetStopReason: z.enum(['resource-budget', 'native-inactivity']).optional(),
    completion: z.object({ version: z.literal(1), resultId: z.uuid(), outcome: z.enum(['modified', 'unchanged']) }).strict().optional(),
    receiptDelivery: z.enum(['pending', 'delivered']).optional(),
  }).strict().optional(),
  events: z.array(localAgentEventSchema).max(20000),
}).strict()
export type LocalAgentRecord = z.infer<typeof localAgentRecordSchema>
export const localAgentProbeSchema = z.object({
  adapter: localAgentIdSchema, status: z.enum(['ready', 'missing', 'unauthenticated', 'unsupported-version', 'launch', 'unknown-auth']),
  version: z.string().max(100).optional(), message: z.string().max(1000),
}).strict()
export type LocalAgentProbe = z.infer<typeof localAgentProbeSchema>
const identity = z.string().min(1).max(200)
const support = z.enum(['supported', 'unsupported', 'unknown'])
const serviceTier = identity.nullable().optional()
const configurationShape = { model: identity, effort: identity.nullable(), serviceTier }
export const localAgentCapabilitiesSchema = z.object({
  version: z.literal(1), adapter: localAgentIdSchema, cliVersion: identity,
  models: z.array(z.object({
    id: identity, resolvedModel: identity.nullable(), label: z.string().min(1).max(300), image: support,
    serviceTiers: z.array(z.object({ id: identity, name: identity, description: z.string().max(4000) }).strict()).max(20).optional(),
    effort: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('supported'), values: z.array(identity).min(1).max(20), default: identity.nullable() }).strict(),
      z.object({ kind: z.literal('unsupported') }).strict(),
      z.object({ kind: z.literal('unknown') }).strict(),
    ]),
  }).strict()).max(1000),
  current: z.object({ model: identity.nullable(), resolvedModel: identity.nullable(), effort: identity.nullable(), serviceTier }).strict(),
  currentSource: z.enum(['native-config', 'native-session']).optional(),
  selectedConfiguration: z.object(configurationShape).strict().optional(),
  // A requested next-turn configuration is not evidence that the native CLI applied it.
  requestedConfiguration: z.object(configurationShape).strict().nullable().optional(),
  input: z.object({ image: support, readFile: support, question: z.enum(['structured', 'text', 'unknown']), correction: z.enum(['active-turn', 'interrupt-resume', 'turn-boundary', 'unknown']), cancel: support }).strict(),
}).strict().superRefine((capabilities, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (new Set(capabilities.models.map(model => model.id)).size !== capabilities.models.length) fail('重复模型')
  for (const model of capabilities.models) if (model.effort.kind === 'supported') {
    if (new Set(model.effort.values).size !== model.effort.values.length || (model.effort.default !== null && !model.effort.values.includes(model.effort.default))) fail('无效原生强度选项')
  }
  const current = capabilities.models.find(model => model.id === capabilities.current.model)
  if (capabilities.current.model !== null && !current) fail('当前模型不在原生目录中')
  if (current?.resolvedModel && capabilities.current.resolvedModel && current.resolvedModel !== capabilities.current.resolvedModel) fail('实际模型与原生选择器解析不一致')
  if (capabilities.current.effort !== null && (current?.effort.kind !== 'supported' || !current.effort.values.includes(capabilities.current.effort))) fail('当前强度没有原生确认依据')
})
export type LocalAgentCapabilities = z.infer<typeof localAgentCapabilitiesSchema>
export const localAgentConfigurationSchema = z.object(configurationShape).strict()
export type LocalAgentConfiguration = z.infer<typeof localAgentConfigurationSchema>

const owner = { projectId: z.string().min(1).max(200), projectPath: z.string().min(1).max(32767), lessonWorkspace: lessonAgentWorkspaceSchema.optional() }
const optionalOwner = { projectId: owner.projectId.optional(), projectPath: owner.projectPath.optional() }
export const localAgentRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('external-notice'), scope: aiWorkspaceIdentitySchema, confirm: z.literal(true).optional() }).strict(),
  z.object({ operation: z.literal('lesson-prepare-generation'), workspace: lessonAgentWorkspaceSchema }).strict(),
  z.object({ operation: z.literal('lesson-start'), workspace: conversationAgentWorkspaceSchema, adapter: localAgentIdSchema, prompt: z.string().min(1).max(100000), userMessage: z.string().min(1).max(20000).optional(), intent: z.enum(['discuss', 'plan']).default('discuss'), frozenTarget: frozenEditTargetSchema.optional() }).strict(),
  z.object({ operation: z.literal('lesson-resume'), workspace: conversationAgentWorkspaceSchema, sessionId: z.uuid(), prompt: z.string().min(1).max(100000), userMessage: z.string().min(1).max(20000).optional(), preserveTaskBudget: z.literal(true).optional(), frozenTarget: frozenEditTargetSchema.optional() }).strict(),
  z.object({ operation: z.literal('lesson-list'), workspace: conversationAgentWorkspaceSchema }).strict(),
  z.object({ operation: z.literal('lesson-read'), workspace: conversationAgentWorkspaceSchema, sessionId: z.uuid(), after: z.number().int().nonnegative().default(0) }).strict(),
  z.object({ operation: z.literal('lesson-cancel'), workspace: conversationAgentWorkspaceSchema, sessionId: z.uuid() }).strict(),
  z.object({ operation: z.literal('lesson-delete'), workspace: conversationAgentWorkspaceSchema, sessionId: z.uuid().optional() }).strict(),
  z.object({ operation: z.literal('lesson-input'), workspace: conversationAgentWorkspaceSchema, sessionId: z.uuid(), input: aiUserInputSchema }).strict(),

  z.object({ operation: z.literal('probe'), adapter: localAgentIdSchema }).strict(),
  z.object({ operation: z.literal('capabilities'), adapter: localAgentIdSchema, ...optionalOwner, refresh: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('configure'), adapter: localAgentIdSchema, configuration: localAgentConfigurationSchema, ...optionalOwner }).strict(),
  z.object({ operation: z.literal('workspace'), ...owner }).strict(),
  z.object({ operation: z.literal('file-status'), ...owner }).strict(),
  z.object({ operation: z.literal('start'), ...owner, adapter: localAgentIdSchema, prompt: z.string().min(1).max(100000) }).strict(),
  z.object({ operation: z.literal('resume'), ...owner, sessionId: z.uuid(), prompt: z.string().min(1).max(100000) }).strict(),
  z.object({ operation: z.literal('generate'), ...owner, adapter: localAgentIdSchema, request: generationRequestSchema, resumeSessionId: z.uuid().optional(), userMessage: z.string().min(1).max(20000).optional() }).strict(),
  z.object({ operation: z.literal('continue'), ...owner, sessionId: z.uuid(), request: generationRequestSchema }).strict(),
  z.object({ operation: z.literal('candidate'), ...owner, sessionId: z.uuid() }).strict(),
  z.object({ operation: z.literal('host-result'), ...owner, sessionId: z.uuid(), result: localAgentHostResultSchema, commitReceipt: generationCommitReceiptSchema.optional() }).strict(),
  z.object({ operation: z.literal('cancel'), ...owner, sessionId: z.uuid() }).strict(),
  z.object({ operation: z.literal('input'), ...owner, sessionId: z.uuid(), input: aiUserInputSchema }).strict(),
  z.object({ operation: z.literal('list'), ...owner }).strict(),
  z.object({ operation: z.literal('read'), ...owner, sessionId: z.uuid(), after: z.number().int().nonnegative().default(0) }).strict(),
  z.object({ operation: z.literal('delete'), ...owner, sessionId: z.uuid().optional() }).strict(),
]).superRefine((request, ctx) => {
  if (request.operation === 'capabilities' || request.operation === 'configure') {
    if ((request.projectId === undefined) !== (request.projectPath === undefined)) ctx.addIssue({ code: 'custom', message: '模型目录的工程身份和位置必须同时提供' })
  }
})
export type LocalAgentRequest = z.infer<typeof localAgentRequestSchema>
export const localAgentResponseSchema = z.object({
  enabled: z.boolean(), probe: localAgentProbeSchema.optional(), sessionId: z.uuid().optional(),
  records: z.array(localAgentRecordSchema).optional(), damaged: z.array(z.string()).optional(),
  generationResult: generationResultSchema.optional(),
  lessonGeneration: z.object({ confirmedDocuments: z.object({ teachingPlan: z.string().min(1), presentationScript: z.string().min(1) }).strict() }).strict().optional(),
  workspace: workspaceIdentityV1Schema.optional(),
  capabilities: localAgentCapabilitiesSchema.optional(),
  inputDelivery: aiInputDeliverySchema.optional(),
  fileStatus: z.object({ status: z.enum(['current', 'changed', 'unavailable']), message: z.string().max(1000) }).strict().optional(),
  externalNotice: externalAiNoticeStatusSchema.optional(),
}).strict()
export type LocalAgentResponse = z.infer<typeof localAgentResponseSchema>
