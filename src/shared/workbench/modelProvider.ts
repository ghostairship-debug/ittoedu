/** Serializable provider data. Credentials and host authority never belong in this contract. */
export type ModelJson = null | boolean | number | string | ModelJson[] | { [key: string]: ModelJson }
export type ModelJsonObject = { [key: string]: ModelJson }
export type ModelCapability = 'supported' | 'unsupported' | 'unknown'

export interface ModelConnectionSnapshot {
  id: string
  revision: number
  provider: string
  protocol: 'openai-chat' | 'chatgpt-responses'
  /** Explicit opt-in for the separately billed OpenAI-compatible Images endpoints. */
  imageProtocol?: 'openai-images' | null
  baseURL: string
  accountId: string
  auth: { kind: 'api-key' | 'oauth'; credentialRef: string }
  billing: { kind: 'metered' | 'token-plan' | 'subscription' | 'prepaid' | 'unknown' }
  capabilities: { tools: ModelCapability; vision: ModelCapability; stream: ModelCapability; reasoning: ModelCapability }
}

/** Native fields stay with the message when Engine persists or sends the next turn. */
export type ModelChatMessage = ModelJsonObject & { role: 'system' | 'developer' | 'user' | 'assistant' | 'tool' }
export type ModelNativeToolCall = ModelJsonObject & {
  id: string; type: 'function'; function: ModelJsonObject & { name: string; arguments: string }
}
export type ModelAssistantMessage = ModelChatMessage & {
  role: 'assistant'; content: string | null; tool_calls?: ModelNativeToolCall[]
  nativeResponses?: { protocol: 'chatgpt-responses'; responseId: string; output: ModelJsonObject[] }
}
export interface ModelToolDefinition { name: string; description: string; inputSchema: ModelJsonObject }
export interface ModelSelection {
  connection: ModelConnectionSnapshot
  model: string
  /** Provider-native options, e.g. thinking/reasoning_effort. Cannot replace routing/messages/tools/stream. */
  parameters?: ModelJsonObject
}
export interface ModelRequest {
  requestId: string
  selection: ModelSelection
  messages: readonly ModelChatMessage[]
  tools?: readonly ModelToolDefinition[]
}
export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  /** Usage is provider-reported; it is not a balance or actual charge. Missing counters remain unknown. */
  raw: ModelJsonObject
}
export interface ModelFailure {
  outcome: 'not-sent' | 'rejected' | 'unknown'
  kind: 'configuration' | 'auth' | 'quota' | 'rate-limit' | 'transport' | 'timeout' | 'aborted' | 'protocol' | 'server'
  code: string
  message: string
  httpStatus?: number
  retryAfterMs?: number
  providerRequestId?: string
}
export type ModelEvent = { requestId: string; sequence: number } & (
  | { type: 'response.started'; responseId: string; /** Only provider-reported, never inferred from selection. */ actualModel?: string; providerRequestId?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  /** Preview only. The target/permission-aware S06 parser, not this adapter, may turn this into draft text. */
  | { type: 'tool.delta'; index: number; id?: string; name?: string; argumentsDelta: string }
  | { type: 'response.completed'; responseId: string; /** May remain unknown when the provider omits it. */ actualModel?: string; assistant: ModelAssistantMessage;
      toolCalls: readonly { id: string; name: string; argumentsText: string }[];
      finishReason: string; usage?: ModelUsage; nativeResponse: ModelJsonObject }
  | { type: 'response.failed'; failure: ModelFailure }
)
export interface ModelProvider {
  /** Exactly one request, no implicit retry, provider fallback, tool execution or document mutation. */
  stream(request: ModelRequest, options?: { signal?: AbortSignal }): AsyncIterable<ModelEvent>
}
