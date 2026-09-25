import { isDeepStrictEqual } from 'node:util'
import type { ModelAssistantMessage, ModelConnectionSnapshot, ModelEvent, ModelFailure, ModelJsonObject, ModelProvider, ModelRequest, ModelUsage } from '../../../shared/workbench/modelProvider'
import { modelToolWireName } from './OpenAIChatProvider'
import { serverSentEvents } from './serverSentEvents'
import { httpFailureKind } from './providerHttpFailure'

export const CHATGPT_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export interface ChatGPTResponsesProviderOptions {
  /** Resolver must honor the exact frozen connection/revision and reject revoked credentials. */
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<{ accessToken: string; accountId: string }>
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  now?: () => number
  /** Local, privacy-filtered diagnostics only. Never receives response bytes or credentials. */
  onProtocolError?: (error: Error) => Promise<void> | void
}
const object = (v: unknown): v is ModelJsonObject => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
class ProtocolError extends Error {
  constructor(readonly code: 'chatgpt-protocol-mismatch' | 'chatgpt-response-body-missing' | 'chatgpt-unexpected-json' | 'chatgpt-unexpected-html' | 'chatgpt-unexpected-media-type' = 'chatgpt-protocol-mismatch') { super(code) }
}
class TruncatedStreamError extends Error {}
class ProviderResponseError extends Error {
  constructor(readonly code: 'chatgpt-provider-sse-error' | 'chatgpt-provider-response-failed' | 'chatgpt-provider-response-incomplete') { super(code) }
}
type Payload = Pick<ModelRequest, 'selection' | 'messages' | 'tools'>

function prepare(request: Payload) {
  const { connection, model, parameters = {} } = request.selection
  if (connection.protocol !== 'chatgpt-responses' || connection.auth.kind !== 'oauth' || !connection.id
    || !Number.isSafeInteger(connection.revision) || connection.revision < 0 || !connection.auth.credentialRef
    || !text(connection.accountId) || /[\r\n]/.test(connection.accountId) || !text(model)
    || connection.baseURL !== CHATGPT_RESPONSES_BASE_URL) throw new Error('invalid-connection')
  if (connection.capabilities.stream === 'unsupported' || request.tools?.length && connection.capabilities.tools === 'unsupported') throw new Error('unsupported-capability')
  const reserved = new Set(['model', 'input', 'instructions', 'messages', 'tools', 'stream', 'store', 'previous_response_id', 'conversation', 'background', 'include', 'api_key', 'apiKey', 'authorization', 'headers', 'base_url', 'baseURL'])
  if (Object.keys(parameters).some(key => reserved.has(key))) throw new Error('reserved-parameter')
  const { reasoning_effort: selectedEffort, ...wireParameters } = parameters
  if (selectedEffort !== undefined) {
    if (wireParameters.reasoning !== undefined || typeof selectedEffort !== 'string'
      || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(selectedEffort)) throw new Error('invalid-reasoning-effort')
    wireParameters.reasoning = { effort: selectedEffort }
  }
  const names = new Map<string, string>()
  const tools = request.tools?.map(tool => {
    const name = modelToolWireName(tool.name)
    if (!tool.name || names.has(name)) throw new Error('duplicate-tool')
    names.set(name, tool.name)
    return { type: 'function', name, description: tool.description, parameters: tool.inputSchema, strict: false }
  })
  const input: ModelJsonObject[] = []
  const instructions: string[] = []
  for (const message of request.messages) {
    if (message.role === 'system') {
      if (typeof message.content !== 'string' || Object.keys(message).some(key => !['role', 'content'].includes(key))) throw new Error('unsupported-system-content')
      instructions.push(message.content)
      continue
    }
    if (message.role === 'assistant' && message.nativeResponses !== undefined) {
      const native = message.nativeResponses
      if (!object(native) || native.protocol !== 'chatgpt-responses' || !text(native.responseId)
        || !Array.isArray(native.output) || !native.output.every(object)) throw new Error('invalid-native-continuation')
      // Replay ALL native items verbatim: reasoning encrypted_content/signatures and function call IDs included.
      input.push(...structuredClone(native.output) as ModelJsonObject[])
      continue
    }
    if (message.role === 'tool') {
      if (!text(message.tool_call_id) || typeof message.content !== 'string') throw new Error('invalid-tool-result')
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content })
      continue
    }
    if (Object.keys(message).some(key => !['role', 'content'].includes(key))) throw new Error('unsupported-message-native-fields')
    const content = typeof message.content === 'string'
      ? [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }]
      : Array.isArray(message.content) ? message.content.map(part => {
        if (!object(part)) throw new Error('invalid-content')
        if (part.type === 'text' && typeof part.text === 'string') return { ...part, type: 'input_text' }
        if (part.type === 'image_url' && object(part.image_url) && text(part.image_url.url)) {
          if (connection.capabilities.vision === 'unsupported') throw new Error('unsupported-vision')
          if (Object.keys(part).some(key => !['type', 'image_url'].includes(key)) || Object.keys(part.image_url).some(key => !['url', 'detail'].includes(key))) throw new Error('unsupported-image-fields')
          return { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) }
        }
        if (['input_text', 'input_image', 'input_file', 'output_text'].includes(String(part.type))) {
          if (part.type === 'input_image' && connection.capabilities.vision === 'unsupported') throw new Error('unsupported-vision')
          return structuredClone(part)
        }
        throw new Error('unsupported-content')
      }) : undefined
    if (!content) throw new Error('invalid-content')
    input.push({ role: message.role, content })
  }
  if (!input.length) throw new Error('missing-input')
  return { names, body: { ...wireParameters, model, instructions: instructions.join('\n\n') || 'You are a helpful assistant.', input, ...(tools?.length ? { tools } : {}), stream: true, store: false,
    include: ['reasoning.encrypted_content'] } }
}

/** Same final wire JSON is used by request budgeting and actual transport. Contains no credentials. */
export function serializeChatGPTResponsesRequest(request: Payload): string { return JSON.stringify(prepare(request).body) }

function usageOf(raw: ModelJsonObject): ModelUsage {
  const usage: ModelUsage = { raw: structuredClone(raw) }
  for (const [key, value] of Object.entries({ inputTokens: raw.input_tokens, outputTokens: raw.output_tokens, totalTokens: raw.total_tokens,
    cachedInputTokens: object(raw.input_tokens_details) ? raw.input_tokens_details.cached_tokens : undefined,
    reasoningTokens: object(raw.output_tokens_details) ? raw.output_tokens_details.reasoning_tokens : undefined })) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) Object.assign(usage, { [key]: value })
  }
  return usage
}
function retryAfter(value: string | null, now: number): number | undefined {
  if (!value) return
  const ms = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : undefined
}

/** Direct ChatGPT Responses transport. No Codex process, login, retry or alternate billing route. */
export class ChatGPTResponsesProvider implements ModelProvider {
  constructor(private readonly options: ChatGPTResponsesProviderOptions) {}
  async *stream(input: ModelRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ModelEvent> {
    let sequence = 0, attempted = false, timedOut = false
    const event = (value: object) => ({ ...value, requestId: input.requestId, sequence: ++sequence }) as ModelEvent
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(() => { timedOut = true; abort() }, this.options.timeoutMs ?? 120_000)
    let response: Response | undefined
    try {
      const request = structuredClone(input)
      let prepared: ReturnType<typeof prepare>
      try { if (!request.requestId) throw new Error(); prepared = prepare(request) }
      catch { yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'configuration', code: 'invalid-model-request', message: 'ChatGPT 连接或请求配置无效；请求未发送。' } }); return }
      let credential: { accessToken: string; accountId: string }
      try { credential = await this.options.credentialResolver(request.selection.connection) }
      catch { yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-unavailable', message: 'ChatGPT 登录凭据不可用；请求未发送。' } }); return }
      if (credential.accountId !== request.selection.connection.accountId || !text(credential.accessToken) || /[\r\n]/.test(credential.accessToken)) {
        yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-account-mismatch', message: 'ChatGPT 登录与所选账号不匹配；请求未发送。' } }); return
      }
      controller.signal.throwIfAborted()
      attempted = true
      response = await (this.options.fetch ?? fetch)(`${CHATGPT_RESPONSES_BASE_URL}/responses`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${credential.accessToken}`, 'chatgpt-account-id': credential.accountId,
          'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: serializeChatGPTResponsesRequest(request),
      })
      credential = { accessToken: '', accountId: '' }
      if (!response.ok) {
        const status = response.status
        const kind = await httpFailureKind(response)
        yield event({ type: 'response.failed', failure: { outcome: status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown', kind,
          code: `http-${status}`, message: `ChatGPT 返回 HTTP ${status}；未自动重试或切换连接。`, httpStatus: status,
          ...(retryAfter(response.headers.get('retry-after'), (this.options.now ?? Date.now)()) !== undefined
            ? { retryAfterMs: retryAfter(response.headers.get('retry-after'), (this.options.now ?? Date.now)()) } : {}) } }); return
      }
      if (!response.body) throw new ProtocolError('chatgpt-response-body-missing')
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      const unexpectedMediaCode = mediaType === 'application/json' ? 'chatgpt-unexpected-json'
        : mediaType === 'text/html' ? 'chatgpt-unexpected-html' : 'chatgpt-unexpected-media-type'
      // Codex Responses may omit response.model. OpenAI-Model is the server-reported model
      // and can differ from the requested model after backend routing.
      const headerModel = response.headers.get('openai-model')
      if (headerModel !== null && !text(headerModel)) throw new ProtocolError()
      let responseId = '', streamModel: string | undefined, previewText = '', completed = false, sawFramedEvent = false
      const toolPreviews = new Map<number, { id: string; name: string; arguments: string }>()
      const argumentDones = new Map<number, string>()
      const doneItems = new Map<number, ModelJsonObject>()
      const doneItemIds = new Set<string>()
      let nextDoneIndex = 0
      for await (const data of serverSentEvents(response.body, this.options.maxResponseBytes ?? 32 * 1024 * 1024)) {
        controller.signal.throwIfAborted()
        if (data === '[DONE]') break
        sawFramedEvent = true
        const chunk: unknown = JSON.parse(data)
        if (!object(chunk) || !text(chunk.type)) throw new ProtocolError()
        // These are explicit provider terminal events. Never forward their untrusted error text or payload.
        if (chunk.type === 'error') throw new ProviderResponseError('chatgpt-provider-sse-error')
        if (chunk.type === 'response.failed') throw new ProviderResponseError('chatgpt-provider-response-failed')
        if (chunk.type === 'response.incomplete') throw new ProviderResponseError('chatgpt-provider-response-incomplete')
        if (object(chunk.response)) {
          const native = chunk.response
          if (!text(native.id) || native.model !== undefined && !text(native.model)) throw new ProtocolError()
          if (native.model !== undefined) {
            if (streamModel && streamModel !== native.model) throw new ProtocolError()
            streamModel = native.model
          }
          if (!responseId) {
            responseId = native.id
            yield event({ type: 'response.started', responseId, ...(headerModel || streamModel ? { actualModel: headerModel || streamModel } : {}) })
          } else if (responseId !== native.id) throw new ProtocolError()
        }
        if (chunk.type === 'response.output_text.delta' || chunk.type === 'response.reasoning_summary_text.delta') {
          if (!responseId || typeof chunk.delta !== 'string') throw new ProtocolError()
          if (chunk.type === 'response.output_text.delta') previewText += chunk.delta
          yield event({ type: chunk.type === 'response.output_text.delta' ? 'text.delta' : 'reasoning.delta', text: chunk.delta })
        }
        if (chunk.type === 'response.output_item.added' && object(chunk.item) && chunk.item.type === 'function_call') {
          const item = chunk.item
          if (!Number.isSafeInteger(chunk.output_index) || Number(chunk.output_index) < 0 || !text(item.call_id) || !text(item.name) || !prepared.names.has(item.name)) throw new ProtocolError()
          const index = Number(chunk.output_index)
          if (toolPreviews.has(index)) throw new ProtocolError()
          toolPreviews.set(index, { id: item.call_id, name: item.name, arguments: '' })
          yield event({ type: 'tool.delta', index, id: item.call_id, name: prepared.names.get(item.name), argumentsDelta: '' })
        }
        if (chunk.type === 'response.function_call_arguments.delta') {
          const index = Number(chunk.output_index), call = toolPreviews.get(index)
          if (!call || argumentDones.has(index) || typeof chunk.delta !== 'string') throw new ProtocolError()
          call.arguments += chunk.delta
          yield event({ type: 'tool.delta', index, id: call.id, name: prepared.names.get(call.name), argumentsDelta: chunk.delta })
        }
        if (chunk.type === 'response.function_call_arguments.done') {
          const index = Number(chunk.output_index), call = toolPreviews.get(index)
          if (!Number.isSafeInteger(chunk.output_index) || index < 0 || typeof chunk.arguments !== 'string' || argumentDones.has(index)
            || call && call.arguments && call.arguments !== chunk.arguments) throw new ProtocolError()
          argumentDones.set(index, chunk.arguments)
          if (call && !call.arguments && chunk.arguments) {
            call.arguments = chunk.arguments
            yield event({ type: 'tool.delta', index, id: call.id, name: prepared.names.get(call.name), argumentsDelta: chunk.arguments })
          }
        }
        if (chunk.type === 'response.output_item.done') {
          if (!object(chunk.item)) throw new ProtocolError()
          const item = chunk.item
          const previewIndexes = item.type === 'function_call' && text(item.call_id)
            ? [...toolPreviews.entries()].filter(([, preview]) => preview.id === item.call_id).map(([index]) => index) : []
          if (previewIndexes.length > 1) throw new ProtocolError()
          const index = chunk.output_index === undefined ? previewIndexes[0] ?? nextDoneIndex : Number(chunk.output_index)
          if (!Number.isSafeInteger(index) || index < 0 || chunk.output_index !== undefined && chunk.output_index !== index
            || previewIndexes.length && previewIndexes[0] !== index || doneItems.has(index)
            || text(item.id) && doneItemIds.has(item.id)) throw new ProtocolError()
          if (item.type === 'function_call') {
            if (!text(item.call_id) || !text(item.name) || !prepared.names.has(item.name) || typeof item.arguments !== 'string') throw new ProtocolError()
            const preview = toolPreviews.get(index), finalArguments = argumentDones.get(index)
            if (preview && (preview.id !== item.call_id || preview.name !== item.name || preview.arguments && preview.arguments !== item.arguments)
              || finalArguments !== undefined && finalArguments !== item.arguments) throw new ProtocolError()
          } else if (argumentDones.has(index)) throw new ProtocolError()
          doneItems.set(index, structuredClone(item))
          if (text(item.id)) doneItemIds.add(item.id)
          nextDoneIndex = Math.max(nextDoneIndex, index + 1)
        }
        if (chunk.type === 'response.completed') {
          const native = chunk.response
          if (!object(native) || native.status !== undefined && native.status !== 'completed'
            || native.output !== undefined && (!Array.isArray(native.output) || !native.output.every(object))) throw new ProtocolError()
          // Codex may send only id/usage here; complete done items then become the native continuation.
          const doneOutput = Array.from({ length: doneItems.size }, (_, index) => doneItems.get(index))
          if (doneOutput.some(item => !item)) throw new ProtocolError()
          // The Codex backend can include output: [] in the completion envelope even
          // after delivering complete output_item.done records. Those records carry
          // the actual assistant turn and its native continuation.
          const sparseCompletion = doneItems.size > 0 && (native.output === undefined || native.output.length === 0)
          const output = sparseCompletion ? doneOutput as ModelJsonObject[] : native.output as ModelJsonObject[]
          if (!output?.length || doneItems.size && !sparseCompletion && (doneItems.size !== output.length
            || doneOutput.some((item, index) => !isDeepStrictEqual(item, output[index])))) throw new ProtocolError()
          const calls: { id: string; name: string; argumentsText: string }[] = []
          let content = ''
          const seen = new Set<string>()
          for (const [index, item] of output.entries()) {
            if (item.status !== undefined && item.status !== 'completed') throw new ProtocolError()
            if (item.type === 'message' && Array.isArray(item.content)) for (const part of item.content) {
              if (object(part) && part.type === 'output_text' && typeof part.text === 'string') content += part.text
            }
            if (item.type === 'function_call') {
              if (!text(item.call_id) || !text(item.name) || !prepared.names.has(item.name) || typeof item.arguments !== 'string' || seen.has(item.call_id)) throw new ProtocolError()
              seen.add(item.call_id)
              const preview = toolPreviews.get(index)
              if (preview && (preview.id !== item.call_id || preview.name !== item.name || preview.arguments && preview.arguments !== item.arguments)
                || argumentDones.has(index) && argumentDones.get(index) !== item.arguments) throw new ProtocolError()
              calls.push({ id: item.call_id, name: prepared.names.get(item.name)!, argumentsText: item.arguments })
            }
          }
          if (previewText && content !== previewText || [...toolPreviews.values()].some(call => !seen.has(call.id))
            || [...argumentDones.keys()].some(index => output[index]?.type !== 'function_call')) throw new ProtocolError()
          const assistant: ModelAssistantMessage = { role: 'assistant', content: content || null,
            nativeResponses: { protocol: 'chatgpt-responses', responseId, output: structuredClone(output) } }
          if (calls.length) assistant.tool_calls = output.filter(item => item.type === 'function_call').map(item => ({
            id: item.call_id as string, type: 'function', function: { name: item.name as string, arguments: item.arguments as string },
          }))
          yield event({ type: 'response.completed', responseId, ...(headerModel || streamModel ? { actualModel: headerModel || streamModel } : {}), assistant, toolCalls: calls,
            finishReason: calls.length ? 'tool_calls' : 'stop', ...(object(native.usage) ? { usage: usageOf(native.usage) } : {}),
            nativeResponse: structuredClone({ ...native, output }) })
          completed = true; break
        }
      }
      if (!completed) {
        if (!sawFramedEvent && mediaType !== 'text/event-stream') throw new ProtocolError(unexpectedMediaCode)
        throw new TruncatedStreamError()
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      const providerFailure = !aborted && error instanceof ProviderResponseError ? error : undefined
      const kind: ModelFailure['kind'] = aborted ? timedOut ? 'timeout' : 'aborted' : providerFailure ? 'server'
        : error instanceof ProtocolError || error instanceof SyntaxError || error instanceof TruncatedStreamError ? 'protocol' : 'transport'
      if (kind === 'protocol' && error instanceof Error && this.options.onProtocolError) {
        try { await this.options.onProtocolError(error) } catch { /* diagnostics cannot alter provider outcome */ }
      }
      const code = aborted ? `chatgpt-${kind}` : providerFailure?.code
        ?? (error instanceof ProtocolError ? error.code : error instanceof TruncatedStreamError ? 'chatgpt-stream-truncated'
          : kind === 'protocol' ? 'chatgpt-protocol-mismatch' : `chatgpt-${kind}`)
      const message = providerFailure ? providerFailure.code === 'chatgpt-provider-response-incomplete'
        ? 'ChatGPT 明确报告响应未完成；结果未知，未自动重试。'
        : 'ChatGPT 明确报告响应失败；未自动重试。'
        : error instanceof TruncatedStreamError && !aborted ? 'ChatGPT 响应流在完成前结束；结果未知，未自动重试。'
          : kind === 'protocol' ? 'ChatGPT 响应格式无法解析；结果未知，未自动重试。'
            : attempted ? 'ChatGPT 请求未取得完整结果，执行状态未知；未自动重试。' : 'ChatGPT 请求未发送。'
      yield event({ type: 'response.failed', failure: { outcome: providerFailure && providerFailure.code !== 'chatgpt-provider-response-incomplete'
        ? 'rejected' : attempted ? 'unknown' : 'not-sent', kind, code, message } })
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
