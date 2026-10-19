import { createHash } from 'node:crypto'
import type {
  ModelAssistantMessage, ModelConnectionSnapshot, ModelEvent, ModelFailure, ModelJson,
  ModelJsonObject, ModelNativeToolCall, ModelProvider, ModelRequest, ModelUsage, PreparedModelRequest, ModelTransportDiagnostic,
} from '../../../shared/workbench/modelProvider'
import { modelAcceptsImages } from '../../../shared/workbench/modelProvider'
import { effectiveModelProtocol } from '../../../shared/workbench/modelRouting'
import { normalizeModelOutputParameters } from '../../../shared/workbench/modelOutputParameters'
import { serverSentEvents } from './serverSentEvents'
import { modelFetch, responseIdleTimeoutCode, transportDiagnostic } from './modelFetch'
import { httpFailure, providerStreamFailure } from './providerHttpFailure'
import { providerSessionCacheParameters } from './providerSessionAffinity'

export interface OpenAIChatProviderOptions {
  /** Main-owned resolver. Product configuration uses secure references, never ambient environment keys. */
  credentialResolver(connection: Readonly<ModelConnectionSnapshot>): Promise<string>
  fetch?: typeof fetch
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
export type ChatTransportDiagnostic = ModelTransportDiagnostic
class ProtocolError extends Error {}
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
/** Cancel a local wait without claiming an ignored upstream operation has stopped. */
export async function waitForModelOperation<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
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
  // Provider-only spelling: the catalog and returned calls keep their original names.
  if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return name
  // Keep the operation recognizable: long opaque names caused real models to
  // omit a character and repeatedly miss skills.read. The digest distinguishes
  // dotted names from underscores; prepare still checks exact alias collisions.
  const stem = name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 55) || 'tool'
  return `${stem}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`
}
export type ModelRequestPayload = Pick<ModelRequest, 'selection' | 'messages' | 'tools' | 'sessionAffinity'>
function prepare(request: ModelRequestPayload) {
  const connection = request.selection.connection
  if (!request.selection.model || !connection.id || !connection.accountId || !connection.auth.credentialRef
    || !validCounter(connection.revision) || effectiveModelProtocol(request.selection) !== 'openai-chat' || connection.auth.kind !== 'api-key') throw new Error('invalid-connection')
  const base = new URL(connection.baseURL)
  if (base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('invalid-endpoint')
  if (connection.capabilities.stream === 'unsupported' || (request.tools?.length && connection.capabilities.tools === 'unsupported')) throw new Error('unsupported-capability')
  if (!modelAcceptsImages(connection.capabilities.vision) && request.messages.some(message => Array.isArray(message.content)
    && message.content.some(part => object(part) && ['image_url', 'input_image'].includes(String(part.type))))) throw new Error('unsupported-vision')
  if (!request.messages.length) throw new Error('missing-messages')
  if (request.messages.some(message => message.nativeResponses !== undefined || message.nativeAnthropic !== undefined)) throw new Error('incompatible-native-continuation')
  const parameters = normalizeModelOutputParameters('openai-chat', request.selection.parameters)
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
    // OpenAI-compatible providers require tool parameters to be a JSON schema rooted at `type: 'object'`.
    // Preserve the caller's inputSchema untouched and only add the root type when absent.
    const source = tool.inputSchema
    const parameters = source && typeof source === 'object' && !Array.isArray(source) && source.type === undefined
      ? { type: 'object', ...source } : source
    return { type: 'function', function: { name, description: tool.description, parameters } }
  })
  const endpoint = connection.baseURL.replace(/\/+$/, '') + '/chat/completions'
  return { endpoint, names, body: { ...providerSessionCacheParameters(request), ...parameters, model: request.selection.model, messages: request.messages,
    ...(tools?.length ? { tools } : {}), stream: true, stream_options: { include_usage: true } } }
}

/** Exact credential-free request body used by both transport and final payload budgeting. */
export function serializeModelRequest(request: ModelRequestPayload): string {
  return JSON.stringify(prepare(request).body)
}

/** A single OpenAI-compatible Chat Completions request. Engine owns continuation and retry policy. */
export class OpenAIChatProvider implements ModelProvider {
  readonly retrySafety = 'pure-generation' as const
  constructor(private readonly options: OpenAIChatProviderOptions) {}

  prepare(input: ModelRequestPayload): PreparedModelRequest {
    const request = structuredClone(input)
    const prepared = prepare(request)
    const serialized = JSON.stringify(prepared.body)
    return { serialized, stream: (requestId, options) => this.streamPrepared({ ...request, requestId }, prepared, serialized, options) }
  }
  async *stream(input: ModelRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ModelEvent> {
    let prepared: PreparedModelRequest
    try { if (!input.requestId) throw new Error('missing-request-id'); prepared = this.prepare(input) }
    catch {
      yield { requestId: input.requestId, sequence: 1, type: 'response.failed', failure: {
        outcome: 'not-sent', kind: 'configuration', code: 'invalid-model-request', message: '模型连接、能力或请求配置无效；请求未发送。' } }
      return
    }
    yield* prepared.stream(input.requestId, options)
  }
  private async *streamPrepared(input: ModelRequest, prepared: ReturnType<typeof prepare>, serialized: string,
    options: { signal?: AbortSignal } = {}): AsyncGenerator<ModelEvent> {
    let sequence = 0
    const requestId = input.requestId
    const event = <T extends Omit<ModelEvent, 'requestId' | 'sequence'>>(value: T) => ({ ...value, requestId, sequence: ++sequence }) as unknown as ModelEvent
    const controller = new AbortController()
    let attempted = false, httpStatus: number | undefined, providerRequestId: string | undefined
    let failureShape: Omit<ToolFragmentDiagnostic, 'code'> | undefined
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const ensureActive = () => { if (controller.signal.aborted) throw new Error('aborted') }
    let response: Response | undefined
    try {
      // Freeze configuration and messages before the first asynchronous credential resolution.
      const request = input
      let credential: string
      try { credential = await waitForModelOperation(() => this.options.credentialResolver(request.selection.connection), controller.signal) }
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
      response = await modelFetch(this.options.fetch)(prepared.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${credential}` },
        body: serialized, signal: controller.signal, redirect: 'error',
      })
      httpStatus = response.status
      // Only opaque IDs are exported; error bodies/headers may echo auth and never enter events.
      const headerId = response.headers.get('x-request-id') ?? response.headers.get('request-id')
      if (headerId && !headerId.includes(credential) && /^[A-Za-z0-9_.:-]{1,200}$/.test(headerId)) providerRequestId = headerId
      credential = ''
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408
        const failure = await httpFailure(response)
        const retryAfterMs = retryAfter(response.headers.get('retry-after'), (this.options.now ?? Date.now)())
        yield event({ type: 'response.failed', failure: { outcome: rejected ? 'rejected' : 'unknown', ...failure, httpStatus,
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
      for await (const data of serverSentEvents(response.body)) {
        ensureActive()
        if (data === '[DONE]') { done = true; break }
        let chunk: ModelJsonObject
        try { const parsed: unknown = JSON.parse(data); if (!object(parsed)) throw new Error(); chunk = parsed }
        catch { throw new ProtocolError('invalid-json-event') }
        chunks.push(chunk)
        if (chunk.error !== undefined) {
          const failure = providerStreamFailure(chunk.error)
          if (failure) { yield event({ type: 'response.failed', failure: { outcome: 'unknown', ...failure, httpStatus } }); return }
          throw new ProtocolError('provider-stream-error')
        }
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
          yield event({ type: 'usage.reported', usage })
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
          const refusal = appendText(assistant, 'refusal', delta.refusal)
          if (refusal) { appendText(assistant, 'content', refusal); yield event({ type: 'text.delta', text: refusal }); ensureActive() }
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
      }
      ensureActive()
      if (!done || !responseId || !actualModel || !finishReason) throw new ProtocolError('incomplete-stream')
      const allCalls = [...calls].sort(([left], [right]) => left - right)
      const ordered = finishReason === 'length' ? allCalls.filter(([, call]) => call.id && call.function.name) : allCalls
      const ids = new Set<string>()
      for (let index = 0; index < ordered.length; index++) {
        const [position, call] = ordered[index]!
        if (finishReason !== 'length' && position !== index || !call.id || ids.has(call.id) || !call.function.name) throw new ProtocolError('incomplete-tool-call')
        ids.add(call.id)
      }
      if (ordered.length && !['tool_calls', 'length'].includes(finishReason) || !ordered.length && finishReason === 'tool_calls') throw new ProtocolError('inconsistent-tool-finish')
      if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(finishReason)) throw new ProtocolError('interrupted-generation')
      if (ordered.length) assistant.tool_calls = ordered.map(([, call]) => call)
      const nativeResponse: ModelJsonObject = { ...native, object: 'chat.completion',
        choices: [{ ...choiceFields, index: 0, message: assistant, finish_reason: finishReason }],
        ...(usage ? { usage: usage.raw } : {}), stream_chunks: chunks }
      yield event({ type: 'response.completed', responseId, actualModel, assistant,
        toolCalls: ordered.map(([, call]) => ({ id: call.id, name: prepared.names.get(call.function.name) ?? call.function.name, argumentsText: call.function.arguments })),
        finishReason, finishDetails: { reason: finishReason }, ...(usage ? { usage } : {}), nativeResponse })
    } catch (error) {
      const idleCode = controller.signal.aborted ? undefined : responseIdleTimeoutCode(error)
      const kind: ModelFailure['kind'] = controller.signal.aborted ? 'aborted' : idleCode ? 'timeout' : error instanceof ProtocolError ? 'protocol' : 'transport'
      if ((kind === 'transport' || kind === 'timeout') && this.options.onTransportDiagnostic) {
        const report = this.options.onTransportDiagnostic, detail = transportDiagnostic(error, response, httpStatus)
        void Promise.resolve().then(() => report(detail)).catch(() => undefined)
      }
      if (kind === 'protocol' && error instanceof ProtocolError && failureShape && this.options.onProtocolShape) {
        const report = this.options.onProtocolShape, detail = { code: error.message, ...failureShape }
        void Promise.resolve().then(() => report(detail)).catch(() => undefined)
      }
      yield event({ type: 'response.failed', failure: { outcome: attempted ? 'unknown' : 'not-sent', kind,
        code: idleCode ?? (error instanceof ProtocolError ? error.message : kind),
        message: idleCode ? '模型响应长时间未收到网络数据，连接已结束；是否重试由执行器决定，已提交工具不会重放。'
          : attempted ? '模型请求结果未能完整确认；片段与已提交工具保留，是否重试由执行器决定。' : '模型请求尚未发送。',
        ...(httpStatus !== undefined ? { httpStatus } : {}), ...(providerRequestId ? { providerRequestId } : {}) } })
    } finally {
      options.signal?.removeEventListener('abort', abort)
      controller.abort()
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined)
    }
  }
}
