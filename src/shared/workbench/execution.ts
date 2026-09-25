import type { ModelChatMessage, ModelFailure, ModelSelection } from './modelProvider'
import type { ModelToolCall, ToolResult, ToolTarget } from './tools'
import type { InputContext, PayloadManifest } from './attachments'
import type { DisclosedExecutionSettings } from './executionDesktop'
import type { ExecutionPermissionMode } from './executionPermission'
import type { ConversationHome } from './conversations'

export interface ExecutionBudget {
  /** Null means no cumulative cap for this run. */
  maxRequests: number | null
  maxToolCalls: number | null
  maxContextBytes: number
}
/** Main freezes this from the user's action; model output never supplies authority. */
export interface ExecutionStart {
  conversationId: string
  taskId: string
  instruction: string
  selection: ModelSelection
  /** User-visible role/connection revisions; host role freezing rejects later changes. */
  disclosedSettings?: DisclosedExecutionSettings
  documents: readonly { documentId: string; writable: readonly ToolTarget[]; selection?: readonly ToolTarget[] }[]
  /** Compiled, frozen attachment/context messages. No path implies a new grant. */
  context?: readonly ModelChatMessage[]
  inputContext?: InputContext
  selectionSource?: PayloadManifest['selectionSource']
  budget?: Partial<ExecutionBudget>
  /** Frozen with the task. Absent means the default workspace level. */
  permission?: ExecutionPermissionMode
  /** Canonical root of this space, including an app-managed space. */
  workspaceRoot?: string | null
  /** Advisory location frozen from the conversation when Main accepted this task. */
  conversationHome?: ConversationHome
  /** Canonical root containing conversationHome, which may differ after an in-app cross-space move. */
  conversationHomeRoot?: string
}
/** A local per-run cap. Never infer this from a provider or transport error message. */
export const MODEL_REQUEST_BUDGET_EXHAUSTED = 'model-request-budget-exhausted'
export const TOOL_CALL_BUDGET_EXHAUSTED = 'tool-call-budget-exhausted'
export const EXECUTION_NO_PROGRESS = 'execution-no-progress'
export type ExecutionStatus = 'queued' | 'running' | 'stopping' | 'stopped' | 'partial' | 'completed' | 'failed' | 'interrupted'
export interface ExecutionToolRecord {
  callId: string
  providerCallId: string
  requestId: string
  call: ModelToolCall
  state: 'pending' | 'executing' | 'returned'
  result?: ToolResult
  /** Durable timestamp makes a reconstructed commit event identical after a crash. */
  receiptTime?: number
}
export interface ExecutionModelRecord {
  requestId: string
  state: 'sending' | 'completed' | 'failed'
  actualModel?: string
  responseId?: string
  failure?: ModelFailure
  payload?: { phase: 'initial' | 'dynamic'; digest: string; serializedBytes: number }
}
export interface ExecutionRunRecord {
  schemaVersion: 1
  runId: string
  version: number
  input: ExecutionStart
  budget: ExecutionBudget
  status: ExecutionStatus
  createdAt: number
  updatedAt: number
  messages: ModelChatMessage[]
  initialMessageCount: number
  initialPayload?: PayloadManifest
  /** File bindings observed by Main at run preparation; used only to locate ancestor resources. */
  documentPaths?: Record<string, string>
  requests: ExecutionModelRecord[]
  tools: ExecutionToolRecord[]
  failure?: { code: string; message: string; outcome?: ModelFailure['outcome'] }
  /** Fact summary contains only actual tool returns; it cannot grant permissions. */
  compacted?: { atRequest: number; facts: string }
  continuedFrom?: string
  /** Host-verified image resource reissued from an ancestor run under this run's authority. */
  hostContinuationImages?: Array<{ sourceRunId: string; sourceJobId: string; resourceId: string;
    sourceDocumentId: string; destinationDocumentId: string; documentId: string; resource: string }>
}
