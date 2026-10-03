import type { ModelProvider, ModelRequest } from '../../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../../shared/workbench/modelRouting'
import { serializeModelRequest } from './OpenAIChatProvider'
import { serializeChatGPTResponsesRequest, serializeOpenAIResponsesRequest } from './ChatGPTResponsesProvider'
import { serializeAnthropicMessagesRequest } from './AnthropicMessagesProvider'

export function routeModelProviders(providers: Record<ModelRequest['selection']['connection']['protocol'], ModelProvider>): ModelProvider {
  return { retrySafety: 'pure-generation', stream: (request, options) => providers[effectiveModelProtocol(request.selection)].stream(request, options) }
}

/** Payload accounting and transport select the same frozen wire protocol. */
export function serializeModelPayload(request: Pick<ModelRequest, 'selection' | 'messages' | 'tools'>): string {
  switch (effectiveModelProtocol(request.selection)) {
    case 'anthropic-messages': return serializeAnthropicMessagesRequest(request)
    case 'openai-responses': return serializeOpenAIResponsesRequest(request)
    case 'chatgpt-responses': return serializeChatGPTResponsesRequest(request)
    case 'openai-chat': return serializeModelRequest(request)
  }
}
