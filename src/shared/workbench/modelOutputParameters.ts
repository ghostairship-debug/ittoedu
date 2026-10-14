import type { ModelJsonObject } from './modelProvider'
import type { ModelApiProtocol } from './modelRouting'

/** Preserve the selected value; only translate the three known output-cap spellings. */
export function modelOutputParameter(protocol: ModelApiProtocol, parameters: ModelJsonObject = {}) {
  const keys = protocol === 'openai-responses' || protocol === 'chatgpt-responses'
    ? ['max_output_tokens', 'max_completion_tokens', 'max_tokens'] as const
    : protocol === 'anthropic-messages'
      ? ['max_tokens', 'max_output_tokens', 'max_completion_tokens'] as const
      : ['max_completion_tokens', 'max_tokens', 'max_output_tokens'] as const
  const source = keys.find(key => parameters[key] !== undefined)
  if (!source) return undefined
  const key = protocol === 'openai-chat' ? source === 'max_completion_tokens' ? source : 'max_tokens' : keys[0]
  return { key, value: parameters[source] }
}

export function normalizeModelOutputParameters(protocol: ModelApiProtocol, parameters: ModelJsonObject = {}): ModelJsonObject {
  const cap = modelOutputParameter(protocol, parameters)
  const { max_tokens: _legacy, max_output_tokens: _responses, max_completion_tokens: _chat, ...rest } = parameters
  return cap ? { ...rest, [cap.key]: cap.value } : rest
}
