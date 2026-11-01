import assert from 'node:assert/strict'

/** Read-only guide consumption can succeed after a transport retry. Keep every
 * attempt, including unknown usage; never infer an actual model for a failure. */
export function verifyGuideRequestEvidence(requests, model) {
  assert(requests.length > 0, 'no-observed-real-model-request')
  const logical = request => request.requestId.replace(/\.attempt-\d+$/, '')
  const completed = requests.filter(request => request.state === 'completed')
  assert(completed.length > 0, 'no-completed-model-request')
  for (const request of requests) {
    assert(Number.isFinite(request.timing?.provider?.fetchStartedAt), 'request-fetch-not-observed')
    assert(request.selectedModel === model && request.sameOriginalConnection === true, 'request-selection-mismatch')
    if (request.state === 'completed') {
      assert.equal(request.actualModel, model, 'completed-actual-model-mismatch')
      continue
    }
    assert(request.state === 'failed' && request.failure?.kind === 'transport'
      && request.failure.outcome === 'unknown', 'unreviewed-request-failure')
    assert(request.actualModel === null && request.assistantMessageIndex === null
      && request.timing.provider.headersReceivedAt === null
      && request.timing.provider.firstContentAt === null
      && request.timing.provider.firstToolNameAt === null, 'partial-response-requires-review')
    const retry = completed.find(candidate => logical(candidate) === logical(request)
      && candidate.timing.provider.fetchStartedAt > request.timing.provider.fetchStartedAt)
    assert(retry && request.payload?.digest && retry.payload?.digest === request.payload.digest,
      'transport-failure-has-no-matching-completed-retry')
  }
  return { attempts: requests.length, completed: completed.length,
    recoveredTransportFailures: requests.length - completed.length,
    failedAttemptModelAndUsage: 'unknown; not imputed from successful retry' }
}
