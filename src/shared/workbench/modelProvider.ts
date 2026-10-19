/** Serializable provider data. Credentials and host authority never belong in this contract. */
export type ModelJson = null | boolean | number | string | ModelJson[] | { [key: string]: ModelJson }
export type ModelJsonObject = { [key: string]: ModelJson }
export type ModelCapability = 'supported' | 'unsupported' | 'unknown'
/** Unknown uses the selected connection's real request path; only an explicit rejection disables input. */
export const modelAcceptsImages = (capability: ModelCapability): boolean => capability !== 'unsupported'

export interface ModelConnectionSnapshot {
  id: string
  revision: number
  provider: string
  protocol: 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'chatgpt-responses'
  /** Explicit opt-in for the separately billed OpenAI-compatible Images endpoints. */
  imageProtocol?: 'openai-images' | null
  baseURL: string
  accountId: string
  auth: { kind: 'api-key' | 'oauth'; credentialRef: string }
  billing: { kind: 'metered' | 'token-plan' | 'subscription' | 'prepaid' | 'unknown' }
  capabilities: { tools: ModelCapability; vision: ModelCapability; stream: ModelCapability; reasoning: ModelCapability }
}

/** Native fields stay with persisted originals and complete current continuation rounds. */
export type ModelChatMessage = ModelJsonObject & { role: 'system' | 'developer' | 'user' | 'assistant' | 'tool' }
export type ModelNativeToolCall = ModelJsonObject & {
  id: string; type: 'function'; function: ModelJsonObject & { name: string; arguments: string }
}
export type ModelAssistantMessage = ModelChatMessage & {
  role: 'assistant'; content: string | null; tool_calls?: ModelNativeToolCall[]
  nativeResponses?: { protocol: 'chatgpt-responses' | 'openai-responses'; responseId: string; output: ModelJsonObject[] }
  nativeAnthropic?: { content: ModelJsonObject[] }
}
export interface ModelToolDefinition { name: string; description: string; inputSchema: ModelJsonObject }
export interface ModelSelection {
  connection: ModelConnectionSnapshot
  model: string
  /** Frozen wire protocol; the underlying connection and credential identity stay unchanged. */
  apiProtocol?: ModelConnectionSnapshot['protocol']
  /** Optional upstream identity for capability lookup only; never replaces the requested model. */
  capabilityModel?: string
  /** Provider-declared token window for this model; absent falls back to a conservative host default. */
  contextWindow?: number
  /** Documented model output window, not a task or request quota. */
  outputLimit?: number
  /** Provider-native options, e.g. thinking/reasoning_effort. Cannot replace routing/messages/tools/stream. */
  parameters?: ModelJsonObject
}
export interface ModelRequest {
  requestId: string
  /** Opaque host session affinity, independent of request/run IDs, document identity and native response lineage. */
  sessionAffinity?: { key: string }
  selection: ModelSelection
  messages: readonly ModelChatMessage[]
  tools?: readonly ModelToolDefinition[]
  /** Host-owned search subrequest only; model parameters cannot declare native tools. */
  nativeSearch?: { contextSize?: 'low' | 'medium' | 'high' }
}
export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  /** Usage is provider-reported; it is not a balance or actual charge. Missing counters remain unknown. */
  raw: ModelJsonObject
}
export interface ModelFinishDetails {
  /** Original provider stop/incomplete reason, before normalization to finishReason. */
  reason: string
  /** Present only when the provider distinguishes output exhaustion from context exhaustion. */
  limit?: 'output' | 'context'
}
/** One frozen, credential-free wire payload, shared by budgeting and its actual transport. */
export interface PreparedModelRequest {
  readonly serialized: string
  stream(requestId: string, options?: { signal?: AbortSignal }): AsyncIterable<ModelEvent>
}
/** Fixed transport categories only; excludes exception text, URLs and response bytes. */
export interface ModelTransportDiagnostic {
  phase: 'fetch-before-headers' | 'body-read'
  errorClass: 'TypeError' | 'Error' | 'AbortError' | 'AggregateError' | 'SocketError' | 'ConnectTimeoutError' | 'HeadersTimeoutError' | 'BodyTimeoutError' | 'other'
  errorCode?: 'ECONNRESET' | 'ECONNREFUSED' | 'ENOTFOUND' | 'ETIMEDOUT' | 'EPIPE' | 'UND_ERR_SOCKET' | 'UND_ERR_CONNECT_TIMEOUT' | 'UND_ERR_HEADERS_TIMEOUT' | 'UND_ERR_BODY_TIMEOUT'
  httpResponseReceived: boolean
  httpStatus?: number
  lastEventType?: 'response.created' | 'response.in_progress' | 'response.output_item.added' | 'response.output_item.done'
    | 'response.content_part.added' | 'response.content_part.done' | 'response.output_text.delta' | 'response.output_text.done'
    | 'response.function_call_arguments.delta' | 'response.function_call_arguments.done' | 'response.reasoning_summary_text.delta'
    | 'response.reasoning_summary_text.done' | 'response.refusal.delta' | 'response.refusal.done'
    | 'response.completed' | 'response.failed' | 'response.incomplete' | 'error' | 'other'
}
export interface ModelFailure {
  outcome: 'not-sent' | 'rejected' | 'unknown'
  kind: 'configuration' | 'auth' | 'quota' | 'rate-limit' | 'transport' | 'timeout' | 'aborted' | 'protocol' | 'server'
  code: string
  message: string
  httpStatus?: number
  retryAfterMs?: number
  providerRequestId?: string
  providerCode?: string
  providerType?: string
  transport?: ModelTransportDiagnostic
}
export type ModelEvent = { requestId: string; sequence: number } & (
  | { type: 'response.started'; responseId: string; /** Only provider-reported, never inferred from selection. */ actualModel?: string; providerRequestId?: string }
  | { type: 'response.activity'; receivedAt: number; source: 'data' | 'heartbeat' }
  | { type: 'usage.reported'; usage: ModelUsage }
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  /** Preview only. The target/permission-aware S06 parser, not this adapter, may turn this into draft text. */
  | { type: 'tool.delta'; index: number; id?: string; name?: string; argumentsDelta: string }
  | { type: 'response.completed'; responseId: string; /** May remain unknown when the provider omits it. */ actualModel?: string; assistant: ModelAssistantMessage;
      toolCalls: readonly { id: string; name: string; argumentsText: string }[];
      finishReason: string; finishDetails?: ModelFinishDetails; usage?: ModelUsage; nativeResponse: ModelJsonObject }
  | { type: 'response.failed'; failure: ModelFailure }
)
export interface ModelProvider {
  /** Explicit adapter fact: absence does not authorize automatic replay of an unknown provider. */
  readonly retrySafety?: 'pure-generation' | 'server-side-effects'
  /** Optional request-scoped preparation; never a cache across changing messages, tools or selections. */
  prepare?(request: Omit<ModelRequest, 'requestId'>): PreparedModelRequest
  /** Exactly one request, no implicit retry, provider fallback, tool execution or document mutation. */
  stream(request: ModelRequest, options?: { signal?: AbortSignal }): AsyncIterable<ModelEvent>
}
