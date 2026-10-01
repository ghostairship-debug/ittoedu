import type { ModelFailure } from '../../../shared/workbench/modelProvider'

const MAX_ERROR_BYTES = 16 * 1024
const quotaCodes = new Set(['insufficient_quota', 'billing_hard_limit_reached'])
const rateLimitCodes = new Set(['rate_limit_exceeded', 'too_many_requests'])
const quotaMessage = /\b(?:out of credits|credits exhausted|billing hard limit reached)\b|余额(?:不足|已用尽|耗尽)/i

/** Only classify bounded JSON error metadata. Never return provider response text. */
export async function httpFailureKind(response: Response): Promise<ModelFailure['kind']> {
  const status = response.status
  const fallback: ModelFailure['kind'] = status === 401 || status === 403 ? 'auth'
    : status === 402 ? 'quota' : status === 429 ? 'rate-limit' : status >= 500 ? 'server' : 'protocol'
  if (![400, 402, 403, 429].includes(status)) return fallback
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) return fallback
  const reader = response.body?.getReader()
  if (!reader) return fallback
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > MAX_ERROR_BYTES) return fallback
      chunks.push(next.value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
    const envelope = parsed as Record<string, unknown>
    const error = envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)
      ? envelope.error as Record<string, unknown> : envelope
    const codes = [error.code, error.type].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
    if (codes.some(code => rateLimitCodes.has(code))) return 'rate-limit'
    if (codes.some(code => quotaCodes.has(code))) return 'quota'
    return typeof error.message === 'string' && error.message.length <= 2048 && quotaMessage.test(error.message) ? 'quota' : fallback
  } catch { return fallback }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
