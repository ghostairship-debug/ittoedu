import type { ModelFailure } from '../../../shared/workbench/modelProvider'

const MAX_ERROR_BYTES = 16 * 1024
const quotaCodes = new Set(['insufficient_quota', 'billing_hard_limit_reached'])
const rateLimitCodes = new Set(['rate_limit_exceeded', 'too_many_requests'])
const quotaMessage = /\b(?:out of credits|credits exhausted|billing hard limit reached)\b|余额(?:不足|已用尽|耗尽)/i

interface BoundedErrorBody { code?: string; type?: string; message?: string }

/** Safely read a bounded JSON body; never throw or return raw response text. */
async function readBoundedJson(response: Response): Promise<BoundedErrorBody | null> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) return null
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_ERROR_BYTES) return null
      chunks.push(next.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const envelope = parsed as Record<string, unknown>
    const error = envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)
      ? envelope.error as Record<string, unknown> : envelope
    const body: BoundedErrorBody = {}
    if (typeof error.code === 'string') body.code = error.code
    if (typeof error.type === 'string') body.type = error.type
    if (typeof error.message === 'string' && error.message.length <= 2048) body.message = error.message
    return body
  } catch { return null }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

/** Only classify bounded JSON error metadata. Never return provider response text. */
export async function httpFailureKind(response: Response): Promise<ModelFailure['kind']> {
  return (await httpFailure(response)).kind
}
function failureKind(status: number, body: BoundedErrorBody | null): ModelFailure['kind'] {
  const fallback: ModelFailure['kind'] = status === 401 || status === 403 ? 'auth'
    : status === 402 ? 'quota' : status === 429 ? 'rate-limit' : status >= 500 ? 'server' : 'protocol'
  if (!body) return fallback
  const codes = [body.code, body.type].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
  if (codes.some(code => rateLimitCodes.has(code))) return 'rate-limit'
  if (codes.some(code => quotaCodes.has(code))) return 'quota'
  return typeof body.message === 'string' && quotaMessage.test(body.message) ? 'quota' : fallback
}

/** Detect well-known provider text markers as stable codes. The marker is matched before any
 *  credential-like payload can leak; the returned message is a fixed host sentence, never provider text. */
function classifyProviderSignature(message: string | undefined): string | null {
  if (!message) return null
  if (/web_search[\s"']+(?:tool[\s"']+)?(?:is[\s]+)?(?:not supported)|unsupported (?:tool|tool type)[\s:"']+web_search|does not support[^.\n]{0,80}web_search/i.test(message)) return 'native-web-search-unsupported'
  if (/maximum context length/i.test(message) || /context[_ -]length[_ -]exceeded/i.test(message)) return 'context_length_exceeded'
  if (/invalid schema for function/i.test(message) || /invalid[-_ ]tool[-_ ]schema/i.test(message)) return 'invalid-tool-schema'
  return null
}

/** Bounded, credential-free classification of a provider HTTP error. Never exports provider body text;
 *  callers may rely only on the fixed `code` and the sanitized host message. */
export async function httpFailure(response: Response): Promise<Pick<ModelFailure, 'code' | 'httpStatus' | 'kind'> & { message: string }> {
  const status = response.status
  const body = [400, 402, 403, 429].includes(status) ? await readBoundedJson(response) : null
  const signature = classifyProviderSignature([body?.code, body?.type, body?.message].filter(Boolean).join(' '))
  const kind = failureKind(status, body)
  const code = signature && kind === 'protocol' ? signature : `http-${status}`
  const message = code === 'native-web-search-unsupported' ? '所选连接或模型明确不支持原生 web_search；不会重复探测该连接修订。' : signature === 'context_length_exceeded'
    ? '模型或传输超出上下文长度；请缩小上下文后重试。'
    : signature === 'invalid-tool-schema'
      ? '工具参数 schema 不被提供方接受；请检查 tool 声明后重试。'
      : `模型服务返回 HTTP ${status}；详见 kind 决定是否重试。`
  return { code, message, httpStatus: status, kind }
}
/** Known server SSE failures retain HTTP 200 and fixed safe metadata, never their arbitrary payload. */
export function providerStreamFailure(error: unknown): Pick<ModelFailure, 'kind' | 'code' | 'message' | 'providerCode' | 'providerType'> | undefined {
  if (!error || typeof error !== 'object') return undefined
  const source = error as Record<string, unknown>
  const safe = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value) ? value : undefined
  const providerCode = safe(source.code), providerType = safe(source.type)
  const tokens = [providerCode, providerType].filter((item): item is string => !!item).map(item => item.toLowerCase())
  const metadata = { ...(providerCode ? { providerCode } : {}), ...(providerType ? { providerType } : {}) }
  const fixed = (kind: ModelFailure['kind'], code: string, message: string) => ({ kind, code, message, ...metadata })
  if (tokens.some(code => ['overloaded_error', 'server_error', 'internal_server_error', 'api_error'].includes(code)))
    return fixed('server', 'provider-transient-sse', '模型服务报告临时服务错误；由现有执行器决定有限重试。')
  if (tokens.some(code => rateLimitCodes.has(code) || code === 'rate_limit_error'))
    return fixed('rate-limit', 'provider-rate-limit-sse', '模型服务报告限流；由现有执行器决定有限重试。')
  if (tokens.some(code => quotaCodes.has(code) || code === 'billing_error'))
    return fixed('quota', 'provider-quota-sse', '模型服务报告额度不足；请核对所选连接的额度。')
  if (tokens.some(code => ['authentication_error', 'permission_error', 'invalid_api_key', 'invalid_token', 'unauthorized'].includes(code)))
    return fixed('auth', 'provider-auth-sse', '模型服务报告登录或权限错误；请检查所选连接。')
  const message = typeof source.message === 'string' && source.message.length <= 2048 ? source.message : undefined
  const signature = classifyProviderSignature([providerCode, providerType, message].filter(Boolean).join(' '))
  if (signature === 'native-web-search-unsupported') return fixed('protocol', signature, '所选连接或模型明确不支持原生 web_search；不会重复探测该连接修订。')
  if (signature === 'context_length_exceeded') return fixed('protocol', signature, '模型或传输超出上下文长度；请缩小上下文后重试。')
  if (signature === 'invalid-tool-schema') return fixed('protocol', signature, '工具参数 schema 不被提供方接受；请检查工具声明。')
  if (tokens.some(code => ['invalid_request_error', 'unsupported_parameter', 'unsupported_value', 'invalid_parameter', 'invalid_request'].includes(code)))
    return fixed('protocol', 'provider-configuration-sse', '模型服务不接受当前请求参数；请调整所选模型或请求配置。')
  if (message && quotaMessage.test(message)) return fixed('quota', 'provider-quota-sse', '模型服务报告额度不足；请核对所选连接的额度。')
  return fixed('server', 'provider-unknown-sse', '模型服务报告未分类错误；原始内容不用于自动重试。')
}
