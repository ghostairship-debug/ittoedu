// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runAffinityExperiment } from '../helpers/w7ProviderAffinityExperiment'
import type { ModelRequest } from '../../src/shared/workbench/modelProvider'

const payload = (): Omit<ModelRequest, 'requestId'> => ({ sessionAffinity: { key: 'fixture-owned-session' },
  selection: { model: 'gpt-6.1-terra', parameters: { reasoning: { effort: 'xhigh' } },
    connection: { id: 'current-oauth', revision: 4, provider: 'openai', protocol: 'chatgpt-responses',
      baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'fixture-account', auth: { kind: 'oauth', credentialRef: 'fixture-reference' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } },
  messages: [{ role: 'system', content: 'Current creative tool reference. Reply READY, no tool calls.' }, { role: 'user', content: 'Read this fixed task.' }] })
const credentialResolver = async () => ({ accessToken: 'fixture-only', accountId: 'fixture-account' })
function response(usage = true, actualModel = 'gpt-6.1-terra') {
  const frames = [{ type: 'response.created', response: { id: 'fixture', model: actualModel, status: 'in_progress', output: [] } },
    { type: 'response.output_text.delta', delta: 'READY' },
    { type: 'response.completed', response: { id: 'fixture', model: actualModel, status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'READY' }] }],
      ...(usage ? { usage: { input_tokens: 8192, output_tokens: 2, total_tokens: 8194, input_tokens_details: { cached_tokens: 4096 } } } : {}) } }]
  return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
it('runs ABBA with exactly one header candidate, byte-identical prepared payloads and per-sample checkpoints', async () => {
  const captures: Array<{ url: string; init: RequestInit }> = [], checkpoint = vi.fn(async () => undefined)
  const transport: typeof fetch = async (url, init) => { captures.push({ url: String(url), init: init! }); return response() }
  let clock = 0
  const result = await runAffinityExperiment({ payload: payload(), transport, credentialResolver, inputTokenFloor: 4096,
    createSessionId: () => 'fixture-experiment-only', now: () => ++clock, onSample: checkpoint })
  expect(result.order).toEqual(['A', 'B', 'B', 'A'])
  expect(result).toMatchObject({ complete: true, comparisonEligible: true })
  expect(checkpoint).toHaveBeenCalledTimes(4)
  expect(new Set(captures.map(capture => capture.init.body)).size).toBe(1)
  const ordinaryHeaders = (init: RequestInit) => [...new Headers(init.headers)].filter(([name]) => name !== 'session-id')
  for (const [index, capture] of captures.entries()) {
    expect(capture.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(ordinaryHeaders(capture.init)).toEqual(ordinaryHeaders(captures[0]!.init))
    expect(new Headers(capture.init.headers).get('session-id')).toBe(index === 1 || index === 2 ? 'fixture-experiment-only' : null)
    expect(JSON.parse(String(capture.init.body))).not.toHaveProperty('prompt_cache_key')
    expect(JSON.parse(String(capture.init.body))).not.toHaveProperty('sessionAffinity')
    expect(result.samples[index]).toMatchObject({ network: { fetchCalls: 1, dnsMs: null, tcpMs: null, tlsMs: null, connectionReused: null },
      usage: { inputTokens: 8192, cachedInputTokens: 4096, reasoningTokens: null }, actualModel: 'gpt-6.1-terra' })
  }
  expect(result.arms.A.cachedTokenFraction).toBe(0.5)
  expect(JSON.stringify(result)).not.toContain('fixture-only')
  expect(JSON.stringify(result)).not.toContain('fixture-account')
  expect(JSON.stringify(result)).not.toContain('fixture-reference')
})
it('keeps omitted usage unknown and prevents a cache conclusion', async () => {
  const result = await runAffinityExperiment({ payload: payload(), transport: async () => response(false), credentialResolver, inputTokenFloor: 4096 })
  expect(result.complete).toBe(true); expect(result.comparisonEligible).toBe(false)
  expect(result.samples.every(sample => sample.usage.inputTokens === null && sample.usage.cachedInputTokens === null
    && sample.reportedInputAboveFloor === null)).toBe(true)
  expect(result.arms.A).toMatchObject({ reportedInputTokens: null, reportedCachedInputTokens: null, cachedTokenFraction: null })
})
it('records pre-header resets without inventing usage, body timing or an automatic retry', async () => {
  const transport = vi.fn(async () => { throw Object.assign(new TypeError('untrusted failure text must not be logged'), { cause: { code: 'ECONNRESET' } }) })
  const result = await runAffinityExperiment({ payload: payload(), transport, credentialResolver, inputTokenFloor: 4096 })
  expect(transport).toHaveBeenCalledTimes(4) // Four scheduled samples, one transmission each, no retry.
  expect(result.samples).toHaveLength(4)
  for (const sample of result.samples) expect(sample).toMatchObject({ outcome: 'failed', comparisonEligible: false,
    usage: { inputTokens: null, cachedInputTokens: null }, durationsMs: { fetchToHeaders: null, firstContent: null },
    failure: { outcome: 'unknown', transport: { phase: 'fetch-before-headers', errorCode: 'ECONNRESET', httpResponseReceived: false } } })
  expect(JSON.stringify(result)).not.toContain('untrusted failure text')
})
it('stops remaining samples when the server reports a different actual model', async () => {
  const transport = vi.fn(async () => response(true, 'another-model'))
  const result = await runAffinityExperiment({ payload: payload(), transport, credentialResolver, inputTokenFloor: 4096 })
  expect(transport).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ complete: false, comparisonEligible: false, samples: [{ actualModel: 'another-model' }] })
})
