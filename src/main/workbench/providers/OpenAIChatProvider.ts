import { createHash } from 'node:crypto'
import type {
  ModelAssistantMessage, ModelConnectionSnapshot, ModelEvent, ModelFailure, ModelJson,
  ModelJsonObject, ModelNativeToolCall, ModelProvider, ModelRequest, ModelUsage,
} from '../../../shared/workbench/modelProvider'
import { serverSentEvents } from './serverSentEvents'
import { httpFailureKind } from './providerHttpFailure'

export interface OpenAIChatProviderOptions {
  /** Main-owned resolver. Product configuration uses secure references, never ambient environment keys. */
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
  /** Maximum silence while waiting for a valid SSE data event; defaults to 120 seconds. */
  timeoutMs?: number
  /** Absolute request ceiling, including credential resolution and streaming; defaults to 10 minutes. */
  maxDurationMs?: number
  maxResponseBytes?: number
  now?: () => number
  /** Receives only fixed-category protocol shape metadata, never response bytes. */
  onProtocolShape?: (diagnostic: ToolFragmentDiagnostic) => Promise<void> | void
  /** Private transport metadata only; never forward an exception message, stack, URL or request body. */
  onTransportDiagnostic?: (diagnostic: ChatTransportDiagnostic) => Promise<void> | void
}
export interface ToolFragmentDiagnostic {
  code: string
  type: 'missing' | 'null' | 'function' | 'custom' | 'function_call' | 'other-string' | 'number' | 'other'
  index: number | 'large' | 'invalid'
  hasFunction: boolean
}
export interface ChatTransportDiagnostic {
  phase: 'fetch-before-headers' | 'body-read'
  errorClass: 'TypeError' | 'Error' | 'AbortError' | 'AggregateError' | 'SocketError' | 'ConnectTimeoutError' | 'HeadersTimeoutError' | 'BodyTimeoutError' | 'other'
  errorCode?: 'ECONNRESET' | 'ECONNREFUSED' | 'ENOTFOUND' | 'ETIMEDOUT' | 'EPIPE' | 'UND_ERR_SOCKET' | 'UND_ERR_CONNECT_TIMEOUT' | 'UND_ERR_HEADERS_TIMEOUT' | 'UND_ERR_BODY_TIMEOUT'
  httpResponseReceived: boolean
  httpStatus?: number
}
class ProtocolError extends Error {}
const transportClasses = new Set<ChatTransportDiagnostic['errorClass']>([
  'TypeError', 'Error', 'AbortError', 'AggregateError', 'SocketError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError',
])
const transportCodes = new Set<NonNullable<ChatTransportDiagnostic['errorCode']>>([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])
function transportDiagnostic(error: unknown, response: Response | undefined, httpStatus: number | undefined): ChatTransportDiagnostic {
  const outer = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; cause?: unknown } : null
  const name = typeof outer?.name === 'string' ? outer.name : ''
  let cause: unknown = error, code: ChatTransportDiagnostic['errorCode']
  for (let depth = 0; depth < 3; depth++) {
    if (!cause || typeof cause !== 'object') break
    const item = cause as { code?: unknown; cause?: unknown }
    if (typeof item.code === 'string' && transportCodes.has(item.code as NonNullable<ChatTransportDiagnostic['errorCode']>)) {
      code = item.code as NonNullable<ChatTransportDiagnostic['errorCode']>; break
    }
    cause = item.cause
  }
  return { phase: response ? 'body-read' : 'fetch-before-headers',
    errorClass: transportClasses.has(name as ChatTransportDiagnostic['errorClass']) ? name as ChatTransportDiagnostic['errorClass'] : 'other',
    ...(code ? { errorCode: code } : {}), httpResponseReceived: Boolean(response),
    ...(httpStatus !== undefined ? { httpStatus } : {}) }
}
const object = (value: unknown): value is ModelJsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
const validCounter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const same = (left: ModelJson, right: ModelJson) => JSON.stringify(left) === JSON.stringify(right)
function toolFragmentShape(fragment: ModelJsonObject): Omit<ToolFragmentDiagnostic, 'code'> {
  const value = fragment.type
  const type = value === undefined ? 'missing' : value === null ? 'null'
    : value === 'function' ? 'function' : value === 'custom' ? 'custom'
      : value === 'function_call' ? 'function_call' : typeof value === 'string' ? 'other-string'
        : typeof value === 'number' ? 'number' : 'other'
  return { type, index: validCounter(fragment.index) ? fragment.index <= 1024 ? fragment.index : 'large' : 'invalid',
    hasFunction: fragment.function !== undefined && fragment.function !== null }
}

/** Opaque extensions are retained verbatim. An unsupported changing extension fails instead of losing continuation. */
function retain(target: ModelJsonObject, source: ModelJsonObject, ignored: readonly string[] = []): void {
  for (const [name, value] of Object.entries(source)) {
    if (ignored.includes(name)) continue
    if (!(name in target) || target[name] === null) target[name] = structuredClone(value)
    else if (!same(target[name]!, value) && value !== null) throw new ProtocolError('unsupported-native-delta')
  }
}
function appendText(target: ModelJsonObject, name: string, value: ModelJson | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ProtocolError('invalid-text-delta')
  target[name] = (typeof target[name] === 'string' ? target[name] : '') + value
  return value
}
function usageOf(raw: ModelJsonObject): ModelUsage {
  const result: ModelUsage = { raw: structuredClone(raw) }
  const put = (key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens' | 'cachedInputTokens', value: unknown) => {
    if (validCounter(value)) result[key] = value
  }
  put('inputTokens', raw.prompt_tokens); put('outputTokens', raw.completion_tokens); put('totalTokens', raw.total_tokens)
  put('reasoningTokens', object(raw.completion_tokens_details) ? raw.completion_tokens_details.reasoning_tokens : undefined)
  put('cachedInputTokens', raw.prompt_cache_hit_tokens ?? (object(raw.prompt_tokens_details) ? raw.prompt_tokens_details.cached_tokens : undefined))
  return result
}
function retryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.max(0, Math.ceil(Number(value) * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}
async function untilAbort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('aborted')
  let onAbort: () => void = () => undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('aborted')
      return work()
    }), interrupted])
  } finally { signal.removeEventListener('abort', onAbort) }
}
export function modelToolWireName(name: string): string {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return name
  return `tool_${createHash('sha256').update(name).digest('hex').slice(0, 48)}`
}
export type ModelRequestPayload = Pick<ModelRequest, 'selection' | 'messages' | 'tools'>
function prepare(request: ModelRequestPayload) {
  const connection = request.selection.connection
  if (!request.selection.model || !connection.id || !connection.accountId || !connection.auth.credentialRef
    || !validCounter(connection.revision) || connection.protocol !== 'openai-chat' || connection.auth.kind !== 'api-key') throw new Error('invalid-connection')
  const base = new URL(connection.baseURL)
  if (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('invalid-endpoint')
  if (connection.capabilities.stream === 'unsupported' || (request.tools?.length && connection.capabilities.tools === 'unsupported')) throw new Error('unsupported-capability')
  if (connection.capabilities.vision === 'unsupported' && request.messages.some(message => Array.isArray(message.content)
    && message.content.some(part => object(part) && ['image_url', 'input_image'].includes(String(part.type))))) throw new Error('unsupported-vision')
  if (!request.messages.length) throw new Error('missing-messages')
  if (request.messages.some(message => message.nativeResponses !== undefined)) throw new Error('incompatible-native-continuation')
  const parameters = request.selection.parameters ?? {}
  const reserved = ['model', 'messages', 'tools', 'stream', 'stream_options', 'n', 'api_key', 'apiKey', 'authorization', 'headers', 'base_url', 'baseURL']
  if (Object.keys(parameters).some(key => reserved.includes(key))) throw new Error('reserved-parameter')
  const names = new Map<string, string>()
  const catalogNames = new Set<string>()
  const tools = request.tools?.map(tool => {
    if (!tool.name || catalogNames.has(tool.name)) throw new Error('duplicate-tool')
    catalogNames.add(tool.name)
    const name = modelToolWireName(tool.name)
    if (names.has(name)) throw new Error('tool-name-collision')
    names.set(name, tool.name)
    return { type: 'function', function: { name, description: tool.description, parameters: tool.inputSchema } }
  })
  const endpoint = connection.baseURL.replace(/\/+$/, '') + '/chat/completions'
  return { endpoint, names, body: { ...parameters, model: request.selection.model, messages: request.messages,
    ...(tools?.length ? { tools } : {}), stream: true, stream_options: { include_usage: true } } }
}

/** Exact credential-free request body used by both transport and final payload budgeting. */
export function serializeModelRequest(request: ModelRequestPayload): string {
  return JSON.stringify(prepare(request).body)
}

/** A single OpenAI-compatible Chat Completions request. Engine owns continuation and retry policy. */
export class OpenAIChatProvider implements ModelProvider {
  constructor(private readonly options: OpenAIChatProviderOptions) {}

  async *stream(input: ModelRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ModelEvent> {
    let sequence = 0
    const requestId = input.requestId
    const event = <T extends Omit<ModelEvent, 'requestId' | 'sequence'>>(value: T) => ({ ...value, requestId, sequence: ++sequence }) as unknown as ModelEvent
    const controller = new AbortController()
    let timeout = false, attempted = false, httpStatus: number | undefined, providerRequestId: string | undefined
    let failureShape: Omit<ToolFragmentDiagnostic, 'code'> | undefined
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const expire = () => {
      if (controller.signal.aborted) return
      timeout = true
      controller.abort()
    }
    const totalTimer = setTimeout(expire, this.options.maxDurationMs ?? 10 * 60_000)
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const pauseIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined }
    const refreshIdle = () => {
      pauseIdle()
      idleTimer = setTimeout(expire, this.options.timeoutMs ?? 120_000)
    }
    const ensureActive = () => { if (controller.signal.aborted) throw new Error('aborted') }
    let response: Response | undefined
    try {
      // Freeze configuration and messages before the first asynchronous credential resolution.
      const request = structuredClone(input)
      let prepared: ReturnType<typeof prepare>
      try { if (!request.requestId) throw new Error('missing-request-id'); prepared = prepare(request) }
      catch {
        yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'configuration', code: 'invalid-model-request', message: '模型连接、能力或请求配置无效；请求未发送。' } })
        return
      }
      let credential: string
      try { credential = await untilAbort(() => this.options.credentialResolver(request.selection.connection), controller.signal) }
      catch {
        ensureActive()
        yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-unavailable', message: '无法读取所选连接的凭据；请求未发送。' } })
        return
      }
      ensureActive()
      if (!credential || /[\r\n]/.test(credential)) {
        yield event({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'auth', code: 'credential-invalid', message: '所选连接的凭据无效；请求未发送。' } })
        return
      }
      attempted = true
      refreshIdle()
      response = await (this.options.fetch ?? fetch)(prepared.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${credential}` },
        body: serializeModelRequest(request), signal: controller.signal, redirect: 'error',
      })
      httpStatus = response.status
      // Only opaque IDs are exported; error bodies/headers may echo auth and never enter events.
      const headerId = response.headers.get('x-request-id') ?? response.headers.get('request-id')
      if (headerId && !headerId.includes(credential) && /^[A-Za-z0-9_.:-]{1,200}$/.test(headerId)) providerRequestId = headerId
      credential = ''
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408
        const kind = await httpFailureKind(response)
        const retryAfterMs = retryAfter(response.headers.get('retry-after'), (this.options.now ?? Date.now)())
        yield event({ type: 'response.failed', failure: { outcome: rejected ? 'rejected' : 'unknown', kind,
          code: `http-${response.status}`, message: `模型服务返回 HTTP ${response.status}；未自动重试。`, httpStatus,
          ...(providerRequestId ? { providerRequestId } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } })
        return
      }
      if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new ProtocolError('expected-event-stream')
      const assistant: ModelAssistantMessage = { role: 'assistant', content: null }
      const calls = new Map<number, ModelNativeToolCall>()
      const native: ModelJsonObject = {}, choiceFields: ModelJsonObject = {}
      const chunks: ModelJson[] = []
      let responseId: string | undefined, actualModel: string | undefined, finishReason: string | undefined, done = false, usage: ModelUsage | undefined
      for await (const data of serverSentEvents(response.body, this.options.maxResponseBytes ?? 16 * 1024 * 1024)) {
        // The data event has arrived: downstream checkpointing and UI consumption
        // cannot count as time spent waiting for the next upstream event.
        pauseIdle()
        ensureActive()
        if (data === '[DONE]') { done = true; break }
        let chunk: ModelJsonObject
        try { const parsed: unknown = JSON.parse(data); if (!object(parsed)) throw new Error(); chunk = parsed }
        catch { throw new ProtocolError('invalid-json-event') }
        chunks.push(chunk)
        if (chunk.error !== undefined) throw new ProtocolError('provider-stream-error')
        if (typeof chunk.id !== 'string' || !chunk.id || typeof chunk.model !== 'string' || !chunk.model || !Array.isArray(chunk.choices)) throw new ProtocolError('invalid-completion-chunk')
        if (!responseId) {
          responseId = chunk.id; actualModel = chunk.model
          yield event({ type: 'response.started', responseId, actualModel, ...(providerRequestId ? { providerRequestId } : {}) })
          ensureActive()
        } else if (chunk.id !== responseId || chunk.model !== actualModel) throw new ProtocolError('response-identity-changed')
        retain(native, chunk, ['choices', 'usage', 'object'])
        if (chunk.usage !== undefined && chunk.usage !== null) {
          if (!object(chunk.usage)) throw new ProtocolError('invalid-usage')
          usage = usageOf(chunk.usage)
        }
        if (chunk.choices.length > 1) throw new ProtocolError('unexpected-multiple-choices')
        for (const choice of chunk.choices) {
          if (!object(choice) || choice.index !== 0 || !object(choice.delta)) throw new ProtocolError('invalid-choice')
          retain(choiceFields, choice, ['delta', 'finish_reason', 'logprobs'])
          const delta = choice.delta
          if (finishReason && Object.entries(delta).some(([key, value]) => value !== null && value !== '' && key !== 'role')) throw new ProtocolError('delta-after-finish')
          if (delta.role !== undefined && delta.role !== null && delta.role !== 'assistant') throw new ProtocolError('invalid-assistant-role')
          retain(assistant, delta, ['role', 'content', 'reasoning_content', 'refusal', 'tool_calls'])
          const text = appendText(assistant, 'content', delta.content)
          const reasoning = appendText(assistant, 'reasoning_content', delta.reasoning_content)
          appendText(assistant, 'refusal', delta.refusal)
          if (text) { yield event({ type: 'text.delta', text }); ensureActive() }
          if (reasoning) { yield event({ type: 'reasoning.delta', text: reasoning }); ensureActive() }
          if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
            if (!Array.isArray(delta.tool_calls)) throw new ProtocolError('invalid-tool-delta')
            for (const fragment of delta.tool_calls) {
              failureShape = object(fragment) ? toolFragmentShape(fragment) : undefined
              if (!object(fragment) || !validCounter(fragment.index)) throw new ProtocolError('invalid-tool-index')
              const index = fragment.index
              let call = calls.get(index)
              if (!call) { call = { id: '', type: 'function', function: { name: '', arguments: '' } }; calls.set(index, call) }
              if (fragment.type !== undefined && fragment.type !== null && fragment.type !== 'function') throw new ProtocolError('unsupported-tool-type')
              if (fragment.id !== undefined && fragment.id !== null) {
                if (typeof fragment.id !== 'string' || !fragment.id || call.id && call.id !== fragment.id) throw new ProtocolError('tool-id-changed')
                call.id = fragment.id
              }
              retain(call, fragment, ['index', 'id', 'type', 'function'])
              let argumentsDelta = ''
              if (fragment.function !== undefined && fragment.function !== null) {
                if (!object(fragment.function)) throw new ProtocolError('invalid-tool-function')
                const fn = fragment.function
                if (fn.name !== undefined && fn.name !== null) {
                  if (typeof fn.name !== 'string' || !fn.name || call.function.name && call.function.name !== fn.name) throw new ProtocolError('tool-name-changed')
                  call.function.name = fn.name
                }
                retain(call.function, fn, ['name', 'arguments'])
                argumentsDelta = appendText(call.function, 'arguments', fn.arguments)
              }
              yield event({ type: 'tool.delta', index, ...(call.id ? { id: call.id } : {}),
                ...(call.function.name ? { name: prepared.names.get(call.function.name) ?? call.function.name } : {}), argumentsDelta })
              ensureActive()
              failureShape = undefined
            }
          }
          if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
            if (typeof choice.finish_reason !== 'string' || !choice.finish_reason || finishReason && finishReason !== choice.finish_reason) throw new ProtocolError('invalid-finish-reason')
            finishReason = choice.finish_reason
          }
        }
        // Only a complete, structurally valid data event starts the next idle wait.
        // SSE comments and transport bytes without framed data do not extend it.
        refreshIdle()
      }
      ensureActive()
      if (!done || !responseId || !actualModel || !finishReason) throw new ProtocolError('incomplete-stream')
      const ordered = [...calls].sort(([left], [right]) => left - right)
      const ids = new Set<string>()
      for (let index = 0; index < ordered.length; index++) {
        const [position, call] = ordered[index]!
        if (position !== index || !call.id || ids.has(call.id) || !prepared.names.has(call.function.name)) throw new ProtocolError('incomplete-tool-call')
        ids.add(call.id)
      }
      if (ordered.length && finishReason !== 'tool_calls' || !ordered.length && finishReason === 'tool_calls') throw new ProtocolError('inconsistent-tool-finish')
      if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(finishReason)) throw new ProtocolError('interrupted-generation')
      if (ordered.length) assistant.tool_calls = ordered.map(([, call]) => call)
      const nativeResponse: ModelJsonObject = { ...native, object: 'chat.completion',
        choices: [{ ...choiceFields, index: 0, message: assistant, finish_reason: finishReason }],
        ...(usage ? { usage: usage.raw } : {}), stream_chunks: chunks }
      yield event({ type: 'response.completed', responseId, actualModel, assistant,
        toolCalls: ordered.map(([, call]) => ({ id: call.id, name: prepared.names.get(call.function.name)!, argumentsText: call.function.arguments })),
        finishReason, ...(usage ? { usage } : {}), nativeResponse })
    } catch (error) {
      const kind: ModelFailure['kind'] = controller.signal.aborted ? timeout ? 'timeout' : 'aborted' : error instanceof ProtocolError ? 'protocol' : 'transport'
      if (kind === 'transport' && this.options.onTransportDiagnostic) {
        try { await this.options.onTransportDiagnostic(transportDiagnostic(error, response, httpStatus)) } catch { /* diagnostics cannot alter provider outcome */ }
      }
      if (kind === 'protocol' && error instanceof ProtocolError && failureShape && this.options.onProtocolShape) {
        try { await this.options.onProtocolShape({ code: error.message, ...failureShape }) } catch { /* diagnostics cannot alter provider outcome */ }
      }
      yield event({ type: 'response.failed', failure: { outcome: attempted ? 'unknown' : 'not-sent', kind,
        code: error instanceof ProtocolError ? error.message : kind,
        message: attempted ? '模型请求结果未能完整确认；未自动重试，请保留已收到的片段。' : '模型请求尚未发送。',
        ...(httpStatus !== undefined ? { httpStatus } : {}), ...(providerRequestId ? { providerRequestId } : {}) } })
    } finally {
      clearTimeout(totalTimer)
      pauseIdle()
      options.signal?.removeEventListener('abort', abort)
      controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
