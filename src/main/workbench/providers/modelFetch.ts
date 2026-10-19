import { getGlobalDispatcher, type Dispatcher } from 'undici'
import type { ModelTransportDiagnostic } from '../../../shared/workbench/modelProvider'

export const MODEL_RESPONSE_IDLE_TIMEOUT_MS = 5 * 60_000
export const IMAGE_RESPONSE_IDLE_TIMEOUT_MS = 15 * 60_000

function withResponseIdleTimeout(idleTimeoutMs: number): typeof fetch {
  // Keep the configured dispatcher, including its proxy and connection behavior.
  // Headers wait for the first response; body timeout resets on all received bytes,
  // including SSE comments/heartbeats. This never limits a live generation's duration.
  const responseWait: Dispatcher.DispatcherComposeInterceptor = dispatch => (options, handler) =>
    dispatch({ ...options, headersTimeout: idleTimeoutMs, bodyTimeout: idleTimeoutMs }, handler)
  return (input, init) => {
    const options: RequestInit & { dispatcher: Dispatcher } = {
      ...init, dispatcher: getGlobalDispatcher().compose(responseWait),
    }
    return fetch(input, options)
  }
}

/** Detect a stalled response without imposing a task or generation total deadline. */
export const fetchModelResponse = withResponseIdleTimeout(MODEL_RESPONSE_IDLE_TIMEOUT_MS)

/** Preserve an explicitly injected transport; the ordinary fetch uses generation settings. */
export function modelFetch(transport?: typeof fetch, idleTimeoutMs = MODEL_RESPONSE_IDLE_TIMEOUT_MS): typeof fetch {
  return transport && transport !== fetch ? transport
    : idleTimeoutMs === MODEL_RESPONSE_IDLE_TIMEOUT_MS ? fetchModelResponse : withResponseIdleTimeout(idleTimeoutMs)
}

/** Node fetch wraps Undici's fixed timeout codes in its cause; never expose raw errors. */
export function responseIdleTimeoutCode(error: unknown): 'response-headers-idle' | 'response-body-idle' | undefined {
  const outer = error && typeof error === 'object' ? error as { code?: unknown; cause?: unknown } : undefined
  const inner = outer?.cause && typeof outer.cause === 'object' ? outer.cause as { code?: unknown } : undefined
  const code = outer?.code ?? inner?.code
  return code === 'UND_ERR_HEADERS_TIMEOUT' ? 'response-headers-idle'
    : code === 'UND_ERR_BODY_TIMEOUT' ? 'response-body-idle' : undefined
}

const transportClasses = new Set<ModelTransportDiagnostic['errorClass']>([
  'TypeError', 'Error', 'AbortError', 'AggregateError', 'SocketError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError',
])
const transportCodes = new Set<NonNullable<ModelTransportDiagnostic['errorCode']>>([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])
export function transportDiagnostic(error: unknown, response: Response | undefined, httpStatus: number | undefined): ModelTransportDiagnostic {
  const outer = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; cause?: unknown } : null
  const name = typeof outer?.name === 'string' ? outer.name : ''
  let cause: unknown = error, code: ModelTransportDiagnostic['errorCode']
  for (let depth = 0; depth < 3; depth++) {
    if (!cause || typeof cause !== 'object') break
    const item = cause as { code?: unknown; cause?: unknown }
    if (typeof item.code === 'string' && transportCodes.has(item.code as NonNullable<ModelTransportDiagnostic['errorCode']>)) {
      code = item.code as NonNullable<ModelTransportDiagnostic['errorCode']>; break
    }
    cause = item.cause
  }
  return { phase: response ? 'body-read' : 'fetch-before-headers',
    errorClass: transportClasses.has(name as ModelTransportDiagnostic['errorClass']) ? name as ModelTransportDiagnostic['errorClass'] : 'other',
    ...(code ? { errorCode: code } : {}), httpResponseReceived: Boolean(response),
    ...(httpStatus !== undefined ? { httpStatus } : {}) }
}
