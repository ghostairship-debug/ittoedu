import { z } from 'zod'
import { executionDocumentReferenceSchema, type ExecutionDocumentReference } from './executionDesktop'
import type { ConversationRecord } from './conversations'
import type { InputAttachmentReference } from './attachments'
import type { ToolTarget } from './tools'

const id = z.string().min(1)
const owner = { workspaceId: id, conversationId: id }
export const externalGrantSchema = z.object({
  ...owner, expectedRevision: z.number().int().positive(), instruction: z.string(),
  documents: z.array(executionDocumentReferenceSchema).min(1),
  sourceRunId: id.optional(), remainingWork: z.string().optional(),
}).strict()
export type ExternalGrantInput = z.infer<typeof externalGrantSchema>
export const externalRequestSchema = z.discriminatedUnion('type', [
  externalGrantSchema.extend({ type: z.literal('grant') }),
  z.object({ type: z.literal('list'), ...owner }).strict(),
  z.object({ type: z.literal('revoke'), ...owner, connectionId: id }).strict(),
  z.object({ type: z.literal('handoff'), ...owner, runId: id, remainingWork: z.string().optional() }).strict(),
])
export interface ExternalOwner { workspaceId: string; conversationId: string }
export interface ExternalHandoff {
  originalGoal: string
  previousRun?: string
  originalTargets: { documentId: string; writable: readonly ToolTarget[] }[]
  committedFacts: { operationId: string; documentId: string; revision: number; status: 'applied' | 'unchanged'; tool: string }[]
  unresolvedTools: { callId: string; tool: string; state: string; reason: string }[]
  uncertainRequests: string[]
  /** User instruction, never an inferred completion claim. */
  remainingWork: string
  attachments: InputAttachmentReference[]
  observe: 'guoling://task/context'
}
export interface ExternalConnection {
  connectionId: string; runId: string; endpoint: string; bearer: string
}
/** No credentials in listings, persisted conversation metadata or execution events. */
export interface ExternalGrantView extends ExternalOwner {
  connectionId: string; runId: string
  status: 'active' | 'revoked' | 'closed'
  documents: ExecutionDocumentReference[]
}
export interface ExternalClientConfig {
  transport: 'streamable-http'
  endpoint: string
  /** Local grant active until revoked or the host closes; never a provider API key or OAuth flow. */
  authorization: string
  codex: string
  claude: string
  opencode: string
}
export interface ExternalGrantResult {
  conversation: ConversationRecord
  connection: ExternalConnection
  handoff: ExternalHandoff
  config: ExternalClientConfig
}
export interface ExternalMcpAPI {
  grant(input: ExternalGrantInput): Promise<ExternalGrantResult>
  list(input: ExternalOwner): Promise<ExternalGrantView[]>
  revoke(input: ExternalOwner & { connectionId: string }): Promise<void>
  handoff(input: ExternalOwner & { runId: string; remainingWork?: string }): Promise<ExternalHandoff>
}
