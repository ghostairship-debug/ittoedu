import type { ModelFailure, ModelProvider } from '../../../shared/workbench/modelProvider'

export const MAX_GENERATION_ATTEMPTS = 3
export const MAX_AUTOMATIC_MODEL_WAIT_MS = 15_000
export type ModelRetryDecision = { kind: 'stop' } | { kind: 'retry'; delayMs: number } | { kind: 'wait'; delayMs: number }
/** Retrying text generation may consume tokens again. It never replays a host tool or a media job. */
export function modelGenerationRetry(provider: Pick<ModelProvider, 'retrySafety'>, failure: ModelFailure, attempts: number, random = Math.random): ModelRetryDecision {
  if (provider.retrySafety !== 'pure-generation' || attempts >= MAX_GENERATION_ATTEMPTS || attempts < 1) return { kind: 'stop' }
  const temporary = failure.kind === 'transport' || failure.kind === 'timeout'
    || failure.kind === 'rate-limit' && failure.httpStatus === 429
    || failure.kind === 'server' && failure.httpStatus !== undefined && failure.httpStatus >= 500 && failure.httpStatus <= 599
    || failure.kind === 'protocol' && ['incomplete-stream', 'response-incomplete', 'chatgpt-stream-truncated'].includes(failure.code)
  if (!temporary) return { kind: 'stop' }
  const retryAfter = failure.retryAfterMs !== undefined && Number.isFinite(failure.retryAfterMs) ? Math.max(0, failure.retryAfterMs) : 0
  const delayMs = Math.max(1000 * 2 ** (attempts - 1) + Math.floor(Math.max(0, Math.min(1, random())) * 250), retryAfter)
  return { kind: delayMs > MAX_AUTOMATIC_MODEL_WAIT_MS ? 'wait' : 'retry', delayMs }
}
export async function waitForGenerationRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0 && !signal.aborted) {
    const chunk = Math.min(remaining, 2_147_483_647)
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, chunk)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
    remaining -= chunk
  }
}
