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
  const status = response.status
  const fallback: ModelFailure['kind'] = status === 401 || status === 403 ? 'auth'
    : status === 402 ? 'quota' : status === 429 ? 'rate-limit' : status >= 500 ? 'server' : 'protocol'
  if (![400, 402, 403, 429].includes(status)) return fallback
  const body = await readBoundedJson(response)
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
  if (/maximum context length/i.test(message) || /context[_ -]length[_ -]exceeded/i.test(message)) return 'context_length_exceeded'
  if (/invalid schema for function/i.test(message) || /invalid[-_ ]tool[-_ ]schema/i.test(message)) return 'invalid-tool-schema'
  return null
}

/** Bounded, credential-free classification of a provider HTTP error. Never exports provider body text;
 *  callers may rely only on the fixed `code` and the sanitized host message. */
export async function httpFailure(response: Response): Promise<Pick<ModelFailure, 'code' | 'httpStatus'> & { message: string }> {
  const status = response.status
  const body = [400, 402, 403, 429].includes(status) ? await readBoundedJson(response) : null
  const signature = classifyProviderSignature(body?.message)
  const code = signature ?? (body?.code && /^[A-Za-z0-9_.:-]{1,64}$/.test(body.code) ? body.code : `http-${status}`)
  const message = signature === 'context_length_exceeded'
    ? '模型或传输超出上下文长度；请缩小上下文后重试。'
    : signature === 'invalid-tool-schema'
      ? '工具参数 schema 不被提供方接受；请检查 tool 声明后重试。'
      : `模型服务返回 HTTP ${status}；详见 kind 决定是否重试。`
  return { code, message, httpStatus: status }
}
