import type { ModelChatMessage, ModelFailure, ModelSelection } from './modelProvider'
import type { ModelToolCall, ToolResult, ToolTarget } from './tools'
import type { InputContext, PayloadManifest } from './attachments'
import type { DisclosedExecutionSettings, ExecutionMaterials, WebTaskAuthorization } from './executionDesktop'
import type { ExecutionPermissionMode } from './executionPermission'
import type { ConversationHome } from './conversations'
import type { EditTarget } from './editSession'
import type { SavedCourseIdentity } from './documentSave'

/** Explicit host-bound authoring output. This is task metadata, never model-authored tool arguments. */
export interface ExecutionContentOutput {
  kind: 'replace-text'
  documentId: string
  target: EditTarget
}

/** Main freezes this from the user's action; model output never supplies authority. */
export interface ExecutionStart {
  conversationId: string
  taskId: string
  instruction: string
  selection: ModelSelection
  /** Optional visual fallback fixed when this task was accepted. */
  visionSelection?: ModelSelection
  /** Optional user-selected no-tool compression route; absent uses the frozen main model. */
  compressionSelection?: ModelSelection
  compressionUnavailableReason?: string
  visionUnavailableReason?: string
  /** User-visible role/connection revisions; host role freezing rejects later changes. */
  disclosedSettings?: DisclosedExecutionSettings
  documents: readonly { documentId: string; epoch?: string; revision?: number; writable: readonly ToolTarget[]; selection?: readonly ToolTarget[] }[]
  contentOutput?: ExecutionContentOutput
  materials?: ExecutionMaterials
  webAuthorization?: WebTaskAuthorization
  /** Compiled, frozen attachment/context messages. No path implies a new grant. */
  context?: readonly ModelChatMessage[]
  inputContext?: InputContext
  selectionSource?: PayloadManifest['selectionSource']
  /** Frozen with the task. Absent means the default workspace level. */
  permission?: ExecutionPermissionMode
  /** Canonical root of this space, including an app-managed space. */
  workspaceRoot?: string | null
  /** Advisory location frozen from the conversation when Main accepted this task. */
  conversationHome?: ConversationHome
  /** Canonical root containing conversationHome, which may differ after an in-app cross-space move. */
  conversationHomeRoot?: string
}
export type ExecutionStatus = 'queued' | 'running' | 'stopping' | 'stopped' | 'partial' | 'completed' | 'failed' | 'interrupted'
export interface ExecutionToolRecord {
  /** Host applications share canonical receipts without inventing provider tool calls. */
  origin?: 'host'
  /** Host receipt: this old call was cancelled at a safe boundary before dispatch. */
  notInvokedReason?: 'steering'
  callId: string
  providerCallId: string
  requestId: string
  call: ModelToolCall
  state: 'pending' | 'executing' | 'returned'
  result?: ToolResult
  /** Durable timestamp makes a reconstructed commit event identical after a crash. */
  receiptTime?: number
  /** Derived from host-issued handles before dispatch; never supplied in model arguments. */
  effectTargets?: Array<{ documentId: string; target: ToolTarget; epoch?: string }>
  /** Canonical file paths returned by the host's mutation preflight before dispatch. */
  effectPaths?: string[]
  /** Host-normalized intent from a missing-parent create refusal; never a successful preflight or effect. */
  rejectedCreationPath?: string
  /** Canonical authored fields captured before dispatch; absent means the host cannot prove coverage. */
  writeScopes?: Array<{ documentId: string; epoch: string; paths: string[][] }>
  /** Host capture/vision delivery failure after an observation receipt was returned. */
  observationFailure?: { message: string; outcome?: ModelFailure['outcome'] }
}
export interface ExecutionModelRecord {
  requestId: string
  /** An independent no-tool vision or context-note request is accounted alongside conversation requests. */
  kind?: 'visual-analysis' | 'context-summary'
  selection?: { connectionId: string; connectionRevision: number; provider: string; model: string; billingKind: string }
  state: 'sending' | 'completed' | 'failed'
  actualModel?: string
  responseId?: string
  /** Actual provider terminal label; tool arguments are validated independently. */
  finishReason?: string
  failure?: ModelFailure
  payload?: { phase: 'initial' | 'dynamic'; digest: string; serializedBytes: number }
  /** Local unfinished content only; never calls, model messages, effects or replay inputs. */
  argumentDrafts?: Array<{ state: 'incomplete-prefix'; providerCallId?: string; toolName?: string; argumentsText: string }>
  /** Provider-reported counters, not balances; used to size the working context. */
  inputTokens?: number
  outputTokens?: number
}
/** Advisory task memory. The frozen input, host receipts and grants remain authoritative. */
export interface WorkingNote {
  /** A short host-derived pointer to the user's original instruction, not a replacement for it. */
  goal: string
  /** Only host/user code may populate this field; task.note cannot change it. */
  userConstraints: string[]
  /** Model working choices. A sourceRef identifies an existing host input or returned tool call, not proof of the claim. */
  decisions: Array<{ text: string; reason?: string; sourceRefs?: string[] }>
  remaining: string[]
  openQuestions: string[]
  risks: string[]
}
/** Main-observed saved V10 identity; it locates the same work without granting additional targets. */
export type ExecutionDocumentBinding = SavedCourseIdentity
export interface ExecutionRunRecord {
  schemaVersion: 1
  runId: string
  version: number
  input: ExecutionStart
  status: ExecutionStatus
  createdAt: number
  updatedAt: number
  messages: ModelChatMessage[]
  initialMessageCount: number
  initialPayload?: PayloadManifest
  /** File bindings observed by Main at run preparation; used only to locate ancestor resources. */
  documentPaths?: Record<string, string>
  /** Successful save/open bindings, keyed by the document session actually associated with this run. */
  documentBindings?: Record<string, ExecutionDocumentBinding>
  requests: ExecutionModelRecord[]
  tools: ExecutionToolRecord[]
  /** Durable user adjustments; the original provider, grant and input remain frozen. */
  steering?: { submissionId: string; text: string; acceptedAt: number; messageIndex?: number; appliedAt?: number }[]
  failure?: { code: string; message: string; outcome?: ModelFailure['outcome'] }
  /** Fact summary contains only actual tool returns; it cannot grant permissions. */
  compacted?: { atRequest: number; facts: string; fromMessage?: number
    /** Model-authored note merged from the archived excerpt; advisory, never a new grant. */
    summary?: string
    /** Only a completed summary advances this exclusive source-message watermark. */
    summaryThroughMessage?: number
    /** Messages before this index were re-projected with bounded text excerpts. */
    boundedThroughMessage?: number
    /** The per-message text threshold used for that bounded projection. */
    boundedTextLimit?: number }
  /** Optional additive checkpoint field; older runs remain readable without migration. */
  workingNote?: WorkingNote
  continuedFrom?: string
  /** Explicit user continuation only. Conversation memory/queued messages do not inherit delivery obligations. */
  taskContinuedFrom?: string
  /** Host-verified image resource reissued from an ancestor run under this run's authority. */
  hostContinuationImages?: Array<{ sourceRunId: string; sourceJobId: string; resourceId: string;
    sourceDocumentId: string; destinationDocumentId: string; documentId: string; resource: string }>
  /** Image owner identities by original message index; context.read preserves these sources. */
  imageContextSources?: Record<number, string[]>
  /** Historical auxiliary vision receipts. Later success settles only the same original source. */
  visualAnalyses?: Array<{ source: string; sourceMessage: string; status: 'analyzed' | 'vision-unavailable'; reason?: string }>
}
