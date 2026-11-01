import type { ExecutionCompletionIssue } from './executionOutcome'

/** Compare known job facts, not the identity of the latest status query.
 * Unknown effects retain their exact receipt identity so distinct uncertainty
 * can never disappear through this model-only projection. Raw receipts remain
 * in the run journal and currentWork still carries the latest readable reference.
 */
export function completionIssueFacts(issues: readonly ExecutionCompletionIssue[]): unknown[] {
  return issues.map(issue => {
    if (!issue.job || !issue.kind || issue.status === 'unknown') return issue
    const { requestId: _queryRequest, receiptCallId: _queryReceipt, ...fact } = issue
    return fact
  })
}

export function hostWorkFactSignature(key: string, value: unknown): string {
  return JSON.stringify(key === 'remainingOperations' && Array.isArray(value)
    ? completionIssueFacts(value as ExecutionCompletionIssue[]) : value)
}
