// @vitest-environment node
import { expect, it } from 'vitest'
import { httpFailureKind, providerStreamFailure } from '../../src/main/workbench/providers/providerHttpFailure'
import { modelGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'

it('classifies the observed OAuth server_is_overloaded SSE code for the existing bounded generation retry', () => {
  const classified = providerStreamFailure({ code: 'server_is_overloaded', type: 'service_unavailable_error', message: 'private provider payload' })
  if (!classified) throw new Error('Expected classified provider failure')
  const failure = { ...classified, httpStatus: 200, outcome: 'rejected' as const }
  expect(failure).toMatchObject({ kind: 'server', code: 'provider-transient-sse', providerCode: 'server_is_overloaded', providerType: 'service_unavailable_error' })
  expect(modelGenerationRetry({ retrySafety: 'pure-generation' }, failure, 1)).toEqual({ kind: 'retry', delayMs: 1000 })
  expect(modelGenerationRetry({ retrySafety: 'server-side-effects' }, failure, 1)).toEqual({ kind: 'stop' })
  expect(JSON.stringify(failure)).not.toContain('private provider payload')
  const unknown = providerStreamFailure({ code: 'unclassified_failure', type: 'service_unavailable_error', message: 'private unknown payload' })
  if (!unknown) throw new Error('Expected preserved unknown failure')
  expect(modelGenerationRetry({ retrySafety: 'pure-generation' }, { ...unknown, httpStatus: 200, outcome: 'rejected' }, 1)).toEqual({ kind: 'stop' })
})

it('separates exhausted quota from temporary 429 without exposing or trusting large and non-JSON bodies', async () => {
  const response = (body: string, contentType = 'application/json') => new Response(body, { status: 429, headers: { 'content-type': contentType } })
  expect(await httpFailureKind(response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'private token' } })))).toBe('quota')
  expect(await httpFailureKind(response(JSON.stringify({ error: { type: 'billing_hard_limit_reached' } })))).toBe('quota')
  expect(await httpFailureKind(response(JSON.stringify({ error: { message: '账户余额不足，请充值' } })))).toBe('quota')
  expect(await httpFailureKind(response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Too many requests' } })))).toBe('rate-limit')
  expect(await httpFailureKind(response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'quota exceeded in unrelated text' } })))).toBe('rate-limit')
  expect(await httpFailureKind(response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'Request quota exceeded per minute; retry after 60 seconds' } })))).toBe('rate-limit')
  expect(await httpFailureKind(response(JSON.stringify({ error: { message: '每分钟配额不足，请稍后重试' } })))).toBe('rate-limit')
  expect(await httpFailureKind(response('insufficient_quota private token', 'text/plain'))).toBe('rate-limit')
  expect(await httpFailureKind(response('{broken'))).toBe('rate-limit')
  expect(await httpFailureKind(response(JSON.stringify({ error: { code: 'insufficient_quota', secret: 'private token', padding: 'x'.repeat(17_000) } })))).toBe('rate-limit')
})
