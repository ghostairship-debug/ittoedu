import { documentSlotSchema } from '../document/selectionSchema'
import { z } from 'zod'
import { validHomePath, type ConversationRecord, type WorkspaceRecord } from './conversations'
import type { ExecutionRunRecord } from './execution'
import type { ExecutionEventSearchInput, ExecutionEventSearchPage, ExecutionBlobRef, ExecutionEvent, ExecutionEventPage, ExecutionProjection } from './executionEvents'
import type { EditEvent, EditSessionSnapshot } from './editSession'
import { inputAttachmentReferenceSchema, type InputAttachmentReference } from './attachments'
import { executionRoles, type ExecutionRole, type ExecutionSelectionSnapshot, type ExecutionSettingsView } from './executionSettings'
import { userAnswerSchema, type UserAnswer } from './userQuestion'
import { approvalDecisionSchema, executionPermissionModeSchema, type ApprovalDecision, type ExecutionPermissionMode } from './executionPermission'

const id = z.string().min(1).max(512), index = z.number().int().nonnegative()
export const executionSelectionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown-range'), from: index, to: index }).strict().refine(value => value.to > value.from),
  z.object({ kind: z.literal('course-object'), locationId: id, itemId: id, stateId: id.optional() }).strict(),
  z.object({ kind: z.literal('flow-block'), surfaceId: id, blockId: id, parentId: id.nullable() }).strict(),
  z.object({ kind: z.literal('flow-range'), surfaceId: id, blockId: id, parentId: id.nullable(), slot: documentSlotSchema, from: index, to: index }).strict().refine(value => value.to > value.from),
])
export type ExecutionSelectionTarget = z.infer<typeof executionSelectionTargetSchema>
const scope = z.union([z.object({ kind: z.literal('document') }).strict(), executionSelectionTargetSchema])
export const executionDocumentReferenceSchema = z.object({ documentId: id, epoch: id, revision: index, writable: z.array(scope).max(100), selection: z.array(executionSelectionTargetSchema).min(1).max(100).optional() }).strict()
export type ExecutionDocumentReference = z.infer<typeof executionDocumentReferenceSchema>
const disclosedRoleSchema = z.object({ connectionId: id, connectionRevision: index, provider: id, model: id,
  billingKind: z.enum(['metered', 'token-plan', 'subscription', 'prepaid', 'unknown']) }).strict()
const disclosedSettingsSchema = z.object({ profileRevision: index, roles: z.object({
  conversation: disclosedRoleSchema.nullable(), vision: disclosedRoleSchema.nullable(),
  imageGenerate: disclosedRoleSchema.nullable(), imageEdit: disclosedRoleSchema.nullable(),
}).strict() }).strict()
export type DisclosedExecutionSettings = z.infer<typeof disclosedSettingsSchema>
/** Non-secret identity of the settings shown in the send disclosure. */
export function disclosedExecutionSettings(view: ExecutionSettingsView): DisclosedExecutionSettings {
  const roles = {} as DisclosedExecutionSettings['roles']
  for (const role of executionRoles) {
    const selected = view.profile.roles[role]
    const connection = selected && view.connections.find(item => item.connection.id === selected.connectionId)?.connection
    roles[role] = selected && connection ? { connectionId: connection.id, connectionRevision: connection.revision,
      provider: connection.provider, model: selected.model, billingKind: connection.billing.kind } : null
  }
  return { profileRevision: view.profile.revision, roles }
}
export function matchesDisclosedSelection(disclosed: DisclosedExecutionSettings, selected: ExecutionSelectionSnapshot): boolean {
  const expected = disclosed.roles[selected.role as ExecutionRole]
  return Boolean(expected && disclosed.profileRevision === selected.profileRevision
    && expected.connectionId === selected.connection.id && expected.connectionRevision === selected.connection.revision
    && expected.provider === selected.connection.provider && expected.model === selected.model
    && expected.billingKind === selected.connection.billing.kind)
}
const identity = { workspaceId: id, conversationId: id }
/** A conversation home sent by the renderer; `missing` is only ever set by Main. */
const conversationHomeSchema = z.object({ kind: z.enum(['folder', 'file']), path: z.string().refine(validHomePath, '会话所属位置无效') }).strict()
export type ConversationHomeInput = z.infer<typeof conversationHomeSchema>
export const executionSubmissionModeSchema = z.enum(['queue', 'adjust'])
export type ExecutionSubmissionMode = z.infer<typeof executionSubmissionModeSchema>
export type ExecutionSubmissionState = 'queued' | 'starting' | 'accepted' | 'failed' | 'cancelled'
const rendererTimingStampSchema = z.object({ clockInstanceId: id, timeOriginMs: z.number().finite().nonnegative(),
  monotonicMs: z.number().finite().nonnegative(), wallTimeMs: z.number().finite().nonnegative() }).strict()
export type RendererTimingStamp = z.infer<typeof rendererTimingStampSchema>
/** Renderer and Main keep separate monotonic clocks; timeOrigin is an explicit alignment estimate. */
export function captureRendererTiming(): RendererTimingStamp {
  return { clockInstanceId: String(performance.timeOrigin), timeOriginMs: performance.timeOrigin,
    monotonicMs: performance.now(), wallTimeMs: Date.now() }
}
export const executionDesktopRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace'), root: z.string().min(1).max(32767).nullable() }).strict(),
  z.object({ type: z.literal('conversations'), workspaceId: id }).strict(),
  z.object({ type: z.literal('create-conversation'), workspaceId: id, title: z.string().max(1024).optional(), home: conversationHomeSchema.optional() }).strict(),
  z.object({ type: z.literal('set-conversation-home'), ...identity, home: conversationHomeSchema.nullable() }).strict(),
  z.object({ type: z.literal('conversation'), ...identity }).strict(),
  z.object({ type: z.literal('draft'), ...identity, expectedRevision: index, text: z.string().max(1024 * 1024), documents: z.array(executionDocumentReferenceSchema).max(100), attachments: z.array(inputAttachmentReferenceSchema).max(1000).default([]) }).strict(),
  z.object({ type: z.literal('rename-conversation'), ...identity, expectedRevision: index, title: z.string().min(1).max(1024) }).strict(),
  z.object({ type: z.literal('delete-conversation'), ...identity, expectedRevision: index }).strict(),
  z.object({ type: z.literal('send'), ...identity, submissionId: z.uuid(), expectedRevision: index, text: z.string().max(1024 * 1024), documents: z.array(executionDocumentReferenceSchema).max(100), attachments: z.array(inputAttachmentReferenceSchema).max(1000).default([]), mode: executionSubmissionModeSchema.default('queue'), retryOfRunId: id.optional(), disclosedSettings: disclosedSettingsSchema.optional(), permission: executionPermissionModeSchema.optional(),
    clientTiming: z.object({ click: rendererTimingStampSchema, invoke: rendererTimingStampSchema }).strict().optional() }).strict(),
  z.object({ type: z.literal('timing'), ...identity, submissionId: z.uuid(), stage: z.literal('renderer.first-visible'),
    stamp: rendererTimingStampSchema, itemId: id }).strict(),
  z.object({ type: z.literal('submission'), ...identity, submissionId: z.uuid() }).strict(),
  z.object({ type: z.literal('submissions'), ...identity }).strict(),
  z.object({ type: z.literal('delete-submission'), ...identity, submissionId: z.uuid() }).strict(),
  z.object({ type: z.literal('pause-queue'), ...identity }).strict(),
  z.object({ type: z.literal('resume-queue'), ...identity }).strict(),
  z.object({ type: z.literal('run'), runId: id }).strict(),
  z.object({ type: z.literal('stop'), runId: id }).strict(),
  z.object({ type: z.literal('answer'), runId: id, callId: id, answer: userAnswerSchema }).strict(),
  z.object({ type: z.literal('approve'), runId: id, callId: id, decision: approvalDecisionSchema }).strict(),
  z.object({ type: z.literal('events'), conversationId: id, after: index.optional(), limit: z.number().int().min(1).max(5000).optional() }).strict(),
  z.object({ type: z.literal('search-events'), conversationId: id, query: z.string().trim().min(1).max(500), after: index.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('timeline'), conversationId: id }).strict(),
  z.object({ type: z.literal('blob'), conversationId: id, ref: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), bytes: index, mime: z.literal('text/plain;charset=utf-8') }).strict() }).strict(),
  z.object({ type: z.literal('edits'), documentId: id }).strict(),
])
export interface ExecutionWorkspace { workspace: WorkspaceRecord; conversations: ConversationRecord[] }
export interface ExecutionSendInput {
  workspaceId: string
  conversationId: string
  submissionId: string
  clientTiming?: { click: RendererTimingStamp; invoke: RendererTimingStamp }
  expectedRevision: number
  text: string
  documents: ExecutionDocumentReference[]
  attachments?: InputAttachmentReference[]
  mode?: ExecutionSubmissionMode
  /** Explicit continuation of a terminal run. Repeated requests for that run reuse its child submission. */
  retryOfRunId?: string
  /** Renderer route precondition; Main rejects a changed route before accepting this submission. */
  disclosedSettings?: DisclosedExecutionSettings
  /** Frozen for this task; Main enforces it. Absent means the default workspace level. */
  permission?: ExecutionPermissionMode
}
export interface ExecutionSubmissionRecord {
  submissionId: string
  workspaceId: string
  conversationId: string
  state: ExecutionSubmissionState
  mode: ExecutionSubmissionMode
  text: string
  documents: ExecutionDocumentReference[]
  attachments: InputAttachmentReference[]
  /** Frozen when main accepts the submission. Later settings changes affect only later submissions. */
  model: { provider: string; model: string; accountId: string; billing: string }
  createdAt: number
  updatedAt: number
  position?: number
  runId?: string
  retryOfRunId?: string
  failure?: { code: string; message: string }
  queuePausedReason?: 'external-handoff'
  permission?: ExecutionPermissionMode
}
export interface ExecutionSendResult { submission: ExecutionSubmissionRecord; conversation: ConversationRecord; run?: ExecutionRunRecord }
export interface ExecutionDesktopAPI {
  workspace(root: string | null): Promise<ExecutionWorkspace>
  conversations(workspaceId: string): Promise<ConversationRecord[]>
  createConversation(workspaceId: string, title?: string, home?: ConversationHomeInput): Promise<ConversationRecord>
  /** Where a conversation belongs (Owner 2026-09-24); advisory metadata that never changes its revision. */
  setConversationHome?(input: { workspaceId: string; conversationId: string; home: ConversationHomeInput | null }): Promise<ConversationRecord>
  conversation(workspaceId: string, conversationId: string): Promise<ConversationRecord | null>
  draft(input: Omit<ExecutionSendInput, 'submissionId' | 'mode'>): Promise<ConversationRecord>
  renameConversation(input: { workspaceId: string; conversationId: string; expectedRevision: number; title: string }): Promise<ConversationRecord>
  deleteConversation(input: { workspaceId: string; conversationId: string; expectedRevision: number }): Promise<void>
  send(input: ExecutionSendInput): Promise<ExecutionSendResult>
  timing?(input: { workspaceId: string; conversationId: string; submissionId: string; stage: 'renderer.first-visible';
    stamp: RendererTimingStamp; itemId: string }): Promise<void>
  submission(input: { workspaceId: string; conversationId: string; submissionId: string }): Promise<ExecutionSubmissionRecord | null>
  submissions(input: { workspaceId: string; conversationId: string }): Promise<ExecutionSubmissionRecord[]>
  deleteSubmission(input: { workspaceId: string; conversationId: string; submissionId: string }): Promise<ExecutionSubmissionRecord>
  pauseQueue(input: { workspaceId: string; conversationId: string }): Promise<void>
  resumeQueue(input: { workspaceId: string; conversationId: string }): Promise<void>
  run(runId: string): Promise<ExecutionRunRecord | null>
  stop(runId: string): Promise<ExecutionRunRecord | null>
  /** Answers the open ask_user question of a live built-in run with the user's own choice. */
  answer?(input: { runId: string; callId: string; answer: UserAnswer }): Promise<ExecutionRunRecord>
  /** Decides the open modification approval of a live built-in run. */
  approve?(input: { runId: string; callId: string; decision: ApprovalDecision }): Promise<ExecutionRunRecord>
  events(conversationId: string, after?: number, limit?: number): Promise<ExecutionEventPage>
  searchEvents(input: ExecutionEventSearchInput): Promise<ExecutionEventSearchPage>
  timeline(conversationId: string): Promise<ExecutionProjection>
  blob(conversationId: string, ref: ExecutionBlobRef): Promise<string>
  edits(documentId: string): Promise<EditSessionSnapshot[]>
  subscribe(listener: (event: ExecutionEvent) => void): () => void
  subscribeEdits(listener: (event: EditEvent) => void): () => void
}
