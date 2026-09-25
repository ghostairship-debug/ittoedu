// @vitest-environment node
import { expect, it } from 'vitest'
import { httpFailureKind } from '../../src/main/workbench/providers/providerHttpFailure'

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
