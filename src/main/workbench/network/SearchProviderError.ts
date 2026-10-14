import type { SearchAttempt } from '../../../shared/workbench/webSearch'
export class WebSearchProviderError extends Error {
  constructor(readonly status: 'not-configured' | 'rejected' | 'failed', message: string,
    readonly attempts: readonly SearchAttempt[] = []) { super(message) }
}
export function searchFailure(cause: unknown, attempts: readonly SearchAttempt[] = []): WebSearchProviderError {
  if (cause instanceof WebSearchProviderError) return new WebSearchProviderError(cause.status, cause.message, [...attempts, ...cause.attempts])
  return new WebSearchProviderError('failed', cause instanceof Error ? cause.message : '搜索服务未返回完整结果', attempts)
}
