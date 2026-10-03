import type {
  ModelAssistantMessage, ModelConnectionSnapshot, ModelEvent, ModelFailure, ModelJson,
  ModelJsonObject, ModelNativeToolCall, ModelProvider, ModelRequest, ModelUsage,
} from '../../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../../shared/workbench/modelRouting'
import { modelToolWireName, waitForModelOperation } from './OpenAIChatProvider'
import { serverSentEvents } from './serverSentEvents'
import { modelFetch, responseIdleTimeoutCode } from './modelFetch'
import { httpFailureKind } from './providerHttpFailure'

export interface AnthropicMessagesProviderOptions {
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
  now?: () => number
}
type Payload = Pick<ModelRequest, 'selection' | 'messages' | 'tools'>
const object = (value: unknown): value is ModelJsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
class ProtocolError extends Error {}

function imageSource(url: string): ModelJsonObject {
  const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url)
  if (data) return { type: 'base64', media_type: data[1]!, data: data[2]! }
  if (url.startsWith('data:')) throw new Error('unsupported-image-data')
  return { type: 'url', url }
}
function contentBlocks(content: ModelJson | undefined): ModelJsonObject[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (content === null) return []
  if (!Array.isArray(content)) throw new Error('invalid-content')
  return content.map(part => {
    if (!object(part)) throw new Error('invalid-content')
    if (['text', 'input_text', 'output_text'].includes(String(part.type)) && typeof part.text === 'string')
      return { ...structuredClone(part), type: 'text' }
    if (part.type === 'image' && object(part.source)) return structuredClone(part)
    if (part.type === 'image_url' && object(part.image_url) && text(part.image_url.url))
      return { type: 'image', source: imageSource(part.image_url.url) }
    if (part.type === 'input_image' && text(part.image_url)) return { type: 'image', source: imageSource(part.image_url) }
    throw new Error('unsupported-content')
  })
}
function prepare(request: Payload) {
  const { connection, model, parameters = {} } = request.selection
  if (effectiveModelProtocol(request.selection) !== 'anthropic-messages' || connection.auth.kind !== 'api-key'
    || !text(model) || !text(connection.id) || !text(connection.accountId) || !text(connection.auth.credentialRef)
    || !counter(connection.revision)) throw new Error('invalid-connection')
  const base = new URL(connection.baseURL)
  if (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('invalid-endpoint')
  if (connection.capabilities.stream === 'unsupported' || request.tools?.length && connection.capabilities.tools === 'unsupported') throw new Error('unsupported-capability')
  const reserved = ['model', 'messages', 'system', 'tools', 'stream', 'api_key', 'apiKey', 'authorization', 'headers', 'base_url', 'baseURL']
  if (Object.keys(parameters).some(key => reserved.includes(key))) throw new Error('reserved-parameter')
  // Messages requires this field. The value is the caller's choice or the model's
  // documented output window; the adapter does not introduce a task/token budget.
  const maxTokens = parameters.max_tokens ?? request.selection.outputLimit
  if (!counter(maxTokens) || maxTokens === 0) throw new Error('missing-model-output-window')
  const names = new Map<string, string>()
  const tools = request.tools?.map(tool => {
    const name = modelToolWireName(tool.name)
    if (!tool.name || names.has(name)) throw new Error('duplicate-tool')
    names.set(name, tool.name)
    return { name, description: tool.description, input_schema: tool.inputSchema.type === undefined
      ? { type: 'object', ...tool.inputSchema } : tool.inputSchema }
  })
  const messages: { role: 'user' | 'assistant'; content: ModelJsonObject[] }[] = []
  const system: string[] = []
  const append = (role: 'user' | 'assistant', content: ModelJsonObject[]) => {
    const previous = messages.at(-1)
    if (previous?.role === role) previous.content.push(...content)
    else messages.push({ role, content })
  }
  for (const message of request.messages) {
    if (message.nativeResponses !== undefined) throw new Error('incompatible-native-continuation')
    if (message.role === 'system' || message.role === 'developer') {
      const blocks = contentBlocks(message.content)
      if (blocks.some(block => block.type !== 'text')) throw new Error('unsupported-system-content')
      system.push(blocks.map(block => block.text).join('\n'))
    } else if (message.role === 'assistant' && message.nativeAnthropic !== undefined) {
      const native = message.nativeAnthropic
      if (!object(native) || !Array.isArray(native.content) || !native.content.every(object)) throw new Error('invalid-native-continuation')
      // Preserve every block and opaque signature, rather than rebuilding a text
      // transcript that would discard thinking state needed by the next tool turn.
      append('assistant', structuredClone(native.content) as ModelJsonObject[])
    } else if (message.role === 'tool') {
      if (!text(message.tool_call_id)) throw new Error('invalid-tool-result')
      append('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: contentBlocks(message.content),
        ...(typeof message.is_error === 'boolean' ? { is_error: message.is_error } : {}) }])
    } else {
      const blocks = contentBlocks(message.content)
      if (message.role === 'assistant' && message.tool_calls !== undefined) {
        if (!Array.isArray(message.tool_calls)) throw new Error('invalid-tool-call')
        for (const call of message.tool_calls) {
          if (!object(call) || !text(call.id) || !object(call.function) || !text(call.function.name) || typeof call.function.arguments !== 'string') throw new Error('invalid-tool-call')
          const input: unknown = JSON.parse(call.function.arguments)
          if (!object(input)) throw new Error('invalid-tool-input')
          blocks.push({ type: 'tool_use', id: call.id, name: modelToolWireName(call.function.name), input })
        }
      }
      append(message.role, blocks)
    }
  }
  if (!messages.length) throw new Error('missing-messages')
  if (connection.capabilities.vision === 'unsupported' && messages.some(message => message.content.some(block => block.type === 'image'))) throw new Error('unsupported-vision')
  const root = connection.baseURL.replace(/\/+$/, '')
  const endpoint = /\/v1$/.test(root) ? `${root}/messages` : `${root}/v1/messages`
  return { endpoint, names, body: { ...parameters, model, max_tokens: maxTokens,
    ...(system.length ? { system: system.join('\n\n') } : {}), messages, ...(tools?.length ? { tools } : {}), stream: true } }
}
export function serializeAnthropicMessagesRequest(request: Payload): string { return JSON.stringify(prepare(request).body) }

function usageOf(raw: ModelJsonObject): ModelUsage {
  const usage: ModelUsage = { raw: structuredClone(raw) }
  if (counter(raw.input_tokens)) {
    usage.inputTokens = raw.input_tokens + (counter(raw.cache_read_input_tokens) ? raw.cache_read_input_tokens : 0)
      + (counter(raw.cache_creation_input_tokens) ? raw.cache_creation_input_tokens : 0)
  }
  if (counter(raw.output_tokens)) usage.outputTokens = raw.output_tokens
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) usage.totalTokens = usage.inputTokens + usage.outputTokens
  if (counter(raw.cache_read_input_tokens)) usage.cachedInputTokens = raw.cache_read_input_tokens
  if (object(raw.output_tokens_details) && counter(raw.output_tokens_details.thinking_tokens)) usage.reasoningTokens = raw.output_tokens_details.thinking_tokens
  return usage
}
function retryAfter(value: string | null, now: number): number | undefined {
  if (!value) return
  const ms = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : undefined
}
interface StreamBlock { value: ModelJsonObject; closed: boolean; argumentsText?: string }

/** One native Messages request. Engine owns retries, continuation and tool execution. */
export class AnthropicMessagesProvider implements ModelProvider {
  readonly retrySafety = 'pure-generation' as const
  constructor(private readonly options: AnthropicMessagesProviderOptions) {}
  async *stream(input: ModelRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ModelEvent> {
    let sequence = 0, attempted = false
    const event = (value: object) => ({ ...value, requestId: input.requestId, sequence: ++sequence }) as ModelEvent
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    let response: Response | undefined, httpStatus: number | undefined, providerRequestId: string | undefined
    try {
      const request = structuredClone(input)
      let prepared: ReturnType<typeof prepare>
      try { if (!request.requestId) throw new Error('missing-request-id'); prepared = prepare(request) }
      catch { yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'configuration', code: 'invalid-model-request', message: 'Anthropic 连接、模型输出窗口或请求配置无效；请求未发送。' } }); return }
      let credential: string
      try { credential = await waitForModelOperation(() => this.options.credentialResolver(request.selection.connection), controller.signal) }
      catch { controller.signal.throwIfAborted(); yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-unavailable', message: '无法读取所选连接的凭据；请求未发送。' } }); return }
      controller.signal.throwIfAborted()
      if (!text(credential) || /[\r\n]/.test(credential)) {
        yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-invalid', message: '所选连接的凭据无效；请求未发送。' } }); return
      }
      attempted = true
      response = await modelFetch(this.options.fetch)(prepared.endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-api-key': credential, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(prepared.body),
      })
      httpStatus = response.status
      const headerId = response.headers.get('request-id') ?? response.headers.get('x-request-id')
      if (headerId && !headerId.includes(credential) && /^[A-Za-z0-9_.:-]{1,200}$/.test(headerId)) providerRequestId = headerId
      credential = ''
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408
        const kind = await httpFailureKind(response)
        const retryAfterMs = retryAfter(response.headers.get('retry-after'), (this.options.now ?? Date.now)())
        yield event({ type: 'response.failed', failure: { outcome: rejected ? 'rejected' : 'unknown', kind,
          code: `http-${response.status}`, message: `模型服务返回 HTTP ${response.status}；是否重试由执行器依据错误类型决定。`, httpStatus,
          ...(providerRequestId ? { providerRequestId } : {}), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } }); return
      }
      if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new ProtocolError('expected-event-stream')
      const blocks = new Map<number, StreamBlock>()
      let native: ModelJsonObject | undefined, responseId: string | undefined, actualModel: string | undefined
      let finish: string | undefined, done = false, usageRaw: ModelJsonObject = {}, usage: ModelUsage | undefined
      let output = '', reasoning = ''
      for await (const data of serverSentEvents(response.body)) {
        controller.signal.throwIfAborted()
        let item: ModelJsonObject
        try { const parsed: unknown = JSON.parse(data); if (!object(parsed)) throw new Error(); item = parsed }
        catch { throw new ProtocolError('invalid-json-event') }
        if (item.type === 'ping') continue
        if (item.type === 'error') throw new ProtocolError('anthropic-stream-error')
        if (item.type === 'message_start') {
          if (native || !object(item.message) || !text(item.message.id) || item.message.role !== 'assistant') throw new ProtocolError('invalid-message-start')
          native = structuredClone(item.message)
          responseId = item.message.id
          actualModel = text(item.message.model) ? item.message.model : undefined
          if (Array.isArray(item.message.content) && item.message.content.length) throw new ProtocolError('unexpected-start-content')
          if (object(item.message.usage)) { usageRaw = structuredClone(item.message.usage); usage = usageOf(usageRaw) }
          yield event({ type: 'response.started', responseId, ...(actualModel ? { actualModel } : {}), ...(providerRequestId ? { providerRequestId } : {}) })
          if (usage) yield event({ type: 'usage.reported', usage })
        } else if (!native) throw new ProtocolError('missing-message-start')
        else if (item.type === 'content_block_start') {
          if (!counter(item.index) || blocks.has(item.index) || !object(item.content_block) || !text(item.content_block.type)) throw new ProtocolError('invalid-content-block')
          const block = structuredClone(item.content_block)
          blocks.set(item.index, { value: block, closed: false })
          if (block.type === 'text' && typeof block.text === 'string' && block.text) { output += block.text; yield event({ type: 'text.delta', text: block.text }) }
          if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) { reasoning += block.thinking; yield event({ type: 'reasoning.delta', text: block.thinking }) }
          if (block.type === 'tool_use') {
            if (!text(block.id) || !text(block.name) || !object(block.input) || !prepared.names.has(block.name)) throw new ProtocolError('invalid-tool-call')
            yield event({ type: 'tool.delta', index: item.index, id: block.id, name: prepared.names.get(block.name), argumentsDelta: '' })
          }
        } else if (item.type === 'content_block_delta') {
          const block = counter(item.index) ? blocks.get(item.index) : undefined
          if (!block || block.closed || !object(item.delta)) throw new ProtocolError('invalid-content-delta')
          const delta = item.delta
          if (delta.type === 'text_delta' && block.value.type === 'text' && typeof delta.text === 'string') {
            block.value.text = String(block.value.text ?? '') + delta.text; output += delta.text
            if (delta.text) { yield event({ type: 'text.delta', text: delta.text }) }
          } else if (delta.type === 'thinking_delta' && block.value.type === 'thinking' && typeof delta.thinking === 'string') {
            block.value.thinking = String(block.value.thinking ?? '') + delta.thinking; reasoning += delta.thinking
            if (delta.thinking) { yield event({ type: 'reasoning.delta', text: delta.thinking }) }
          } else if (delta.type === 'signature_delta' && block.value.type === 'thinking' && typeof delta.signature === 'string') {
            block.value.signature = String(block.value.signature ?? '') + delta.signature
          } else if (delta.type === 'input_json_delta' && block.value.type === 'tool_use' && typeof delta.partial_json === 'string') {
            block.argumentsText = (block.argumentsText ?? '') + delta.partial_json
            yield event({ type: 'tool.delta', index: item.index, id: block.value.id, name: prepared.names.get(String(block.value.name)), argumentsDelta: delta.partial_json })
          } else if (delta.type === 'citations_delta' && block.value.type === 'text' && object(delta.citation)) {
            const citations = Array.isArray(block.value.citations) ? block.value.citations : []
            citations.push(structuredClone(delta.citation)); block.value.citations = citations
          } else throw new ProtocolError('unsupported-content-delta')
        } else if (item.type === 'content_block_stop') {
          const block = counter(item.index) ? blocks.get(item.index) : undefined
          if (!block || block.closed) throw new ProtocolError('invalid-content-stop')
          if (block.argumentsText !== undefined) {
            let parsed: unknown
            try { parsed = JSON.parse(block.argumentsText) } catch { throw new ProtocolError('invalid-tool-input') }
            if (!object(parsed)) throw new ProtocolError('invalid-tool-input')
            block.value.input = parsed
          }
          block.closed = true
        } else if (item.type === 'message_delta') {
          if (!object(item.delta)) throw new ProtocolError('invalid-message-delta')
          Object.assign(native, structuredClone(item.delta))
          if (typeof item.delta.stop_reason === 'string') finish = item.delta.stop_reason
          if (object(item.usage)) {
            // Native deltas can report null for unchanged cumulative counters.
            // Keep already reported input/cache counts while output advances.
            for (const [key, value] of Object.entries(item.usage)) if (value !== null) usageRaw[key] = structuredClone(value)
            usage = usageOf(usageRaw); yield event({ type: 'usage.reported', usage })
          }
        } else if (item.type === 'message_stop') { done = true; break }
        // New standalone metadata events can be ignored; native content deltas
        // above must be understood so continuation cannot silently lose data.
        controller.signal.throwIfAborted()
      }
      controller.signal.throwIfAborted()
      if (!done || !native || !responseId || !finish || [...blocks.values()].some(block => !block.closed)) throw new ProtocolError('incomplete-stream')
      const content = [...blocks].sort(([a], [b]) => a - b).map(([, block]) => block.value)
      const calls = content.filter(block => block.type === 'tool_use')
      if (new Set(calls.map(call => call.id)).size !== calls.length || calls.length && finish !== 'tool_use' || !calls.length && finish === 'tool_use') throw new ProtocolError('inconsistent-tool-finish')
      const finishReason = finish === 'tool_use' ? 'tool_calls' : ['end_turn', 'stop_sequence'].includes(finish) ? 'stop'
        : ['max_tokens', 'model_context_window_exceeded'].includes(finish) ? 'length' : finish === 'refusal' ? 'content_filter' : finish
      const assistant: ModelAssistantMessage = { role: 'assistant', content: output || null, nativeAnthropic: { content: structuredClone(content) } }
      if (reasoning) assistant.reasoning_content = reasoning
      if (calls.length) assistant.tool_calls = calls.map(call => ({ id: String(call.id), type: 'function',
        function: { name: String(call.name), arguments: JSON.stringify(call.input) } } satisfies ModelNativeToolCall))
      yield event({ type: 'response.completed', responseId, ...(actualModel ? { actualModel } : {}), assistant,
        toolCalls: calls.map(call => ({ id: String(call.id), name: prepared.names.get(String(call.name))!, argumentsText: JSON.stringify(call.input) })),
        finishReason, ...(usage ? { usage } : {}), nativeResponse: { ...native, content, ...(usage ? { usage: usage.raw } : {}) } })
    } catch (error) {
      const idleCode = controller.signal.aborted ? undefined : responseIdleTimeoutCode(error)
      const kind: ModelFailure['kind'] = controller.signal.aborted ? 'aborted' : idleCode ? 'timeout' : error instanceof ProtocolError ? 'protocol' : 'transport'
      yield event({ type: 'response.failed', failure: { outcome: attempted ? 'unknown' : 'not-sent', kind,
        code: idleCode ?? (error instanceof ProtocolError ? error.message : kind),
        message: idleCode ? '模型响应长时间未收到网络数据，连接已结束；是否重试由执行器决定，已提交工具不会重放。'
          : attempted ? '模型请求结果未能完整确认；片段与已提交工具保留，是否重试由执行器决定。' : '模型请求尚未发送。',
        ...(httpStatus !== undefined ? { httpStatus } : {}), ...(providerRequestId ? { providerRequestId } : {}) } })
    } finally {
      options.signal?.removeEventListener('abort', abort); controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
