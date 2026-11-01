import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyGuideRequestEvidence } from './packagedGuideRequestEvidence20261031.mjs'

const model = 'gpt-6.1-terra'
const completed = () => ({ requestId: 'request.attempt-2', state: 'completed', selectedModel: model,
  actualModel: model, sameOriginalConnection: true, assistantMessageIndex: 3,
  timing: { provider: { fetchStartedAt: 20 } }, payload: { digest: 'same-body' } })
const failed = () => ({ requestId: 'request.attempt-1', state: 'failed', selectedModel: model,
  actualModel: null, sameOriginalConnection: true, assistantMessageIndex: null,
  timing: { provider: { fetchStartedAt: 10, headersReceivedAt: null, firstContentAt: null, firstToolNameAt: null } },
  payload: { digest: 'same-body' }, failure: { kind: 'transport', outcome: 'unknown' } })

test('accepts completed reads and records a same-payload transport retry without inventing usage', () => {
  assert.equal(verifyGuideRequestEvidence([completed()], model).completed, 1)
  assert.deepEqual(verifyGuideRequestEvidence([failed(), completed()], model), {
    attempts: 2, completed: 1, recoveredTransportFailures: 1,
    failedAttemptModelAndUsage: 'unknown; not imputed from successful retry',
  })
})
for (const [name, mutate] of [
  ['wrong returned model', requests => { requests[1].actualModel = 'other-model' }],
  ['different connection', requests => { requests[1].sameOriginalConnection = false }],
  ['unrecovered failure', requests => { requests.pop() }],
  ['changed retry payload', requests => { requests[1].payload.digest = 'different' }],
  ['partial response', requests => { requests[0].timing.provider.firstContentAt = 12 }],
  ['unobserved fetch', requests => { requests[1].timing.provider.fetchStartedAt = null }],
  ['different logical request', requests => { requests[1].requestId = 'another.attempt-2' }],
]) test(`rejects ${name}`, () => {
  const requests = [failed(), completed()]; mutate(requests)
  assert.throws(() => verifyGuideRequestEvidence(requests, model))
})
