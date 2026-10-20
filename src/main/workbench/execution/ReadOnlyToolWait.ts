export type ReadOnlyWaitOutcome<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }

export interface ReadOnlyWaitOptions<T> {
  signal?: AbortSignal
  /** The caller supplies its existing local read deadline; no new global timeout. */
  timeoutMs?: number
  isCurrent?: () => boolean
  /** Cleanup/diagnostics for the original attempt only, never current-run publication. */
  onLate?: (outcome: ReadOnlyWaitOutcome<T>) => void | Promise<void>
}

function ended(code: 'read-cancelled' | 'read-timeout' | 'read-retired'): Error {
  const error = new Error(code === 'read-timeout' ? '纯读等待已超时，底层读取可能仍在收尾'
    : code === 'read-retired' ? '旧代际的纯读等待已退役' : '纯读等待已取消，底层读取可能仍在收尾')
  error.name = code === 'read-timeout' ? 'TimeoutError' : 'AbortError'
  return Object.assign(error, { code })
}

/** Ends only a safe read's logical wait. The underlying operation still owns
 * its resources until it really settles. Both late resolve and reject are
 * consumed; a retired attempt can never publish into a newer generation. */
export function waitForReadOnly<T>(operation: (signal: AbortSignal) => Promise<T>,
  options: ReadOnlyWaitOptions<T> = {}): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let finished = false, timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      options.signal?.removeEventListener('abort', cancel)
      if (timer !== undefined) clearTimeout(timer)
    }
    const stop = (code: 'read-cancelled' | 'read-timeout' | 'read-retired') => {
      if (finished) return
      finished = true
      cleanup()
      reject(ended(code))
      controller.abort()
    }
    const cancel = () => stop('read-cancelled')
    const late = (outcome: ReadOnlyWaitOutcome<T>) => {
      try { Promise.resolve(options.onLate?.(outcome)).catch(() => undefined) } catch { /* Cleanup cannot replace the original outcome. */ }
    }
    const complete = (outcome: ReadOnlyWaitOutcome<T>) => {
      if (!finished && options.isCurrent && !options.isCurrent()) stop('read-retired')
      if (finished) { late(outcome); return }
      finished = true
      cleanup()
      if (outcome.status === 'fulfilled') resolve(outcome.value)
      else reject(outcome.reason)
    }
    if (options.signal?.aborted) { cancel(); return }
    if (options.isCurrent && !options.isCurrent()) { stop('read-retired'); return }
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0)
      timer = setTimeout(() => stop('read-timeout'), options.timeoutMs)
    try { operation(controller.signal).then(value => complete({ status: 'fulfilled', value }),
      reason => complete({ status: 'rejected', reason })) }
    catch (reason) { complete({ status: 'rejected', reason }) }
  })
}
