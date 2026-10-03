// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { DeepSeekSearchProvider, nativeSearchSelection } from '../../src/main/workbench/network/DeepSeekSearchProvider'
import { WebResearchService } from '../../src/main/workbench/network/WebResearchService'
import type { ModelConnectionSnapshot } from '../../src/shared/workbench/modelProvider'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
const connection: ModelConnectionSnapshot = { id: 'official', revision: 1, provider: 'deepseek', protocol: 'openai-chat', baseURL: 'https://api.deepseek.com', accountId: 'test', auth: { kind: 'api-key', credentialRef: 'not-a-key' }, billing: { kind: 'metered' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } }
function provider(payload: unknown, state = true) {
  const transport = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
  const credential = vi.fn(async () => 'test-only-secret')
  const api = new DeepSeekSearchProvider({ selection: () => state ? { connection, model: 'deepseek-flash' } : null, credential, fetch: transport as typeof fetch })
  const service = new WebResearchService({ searchProvider: api }); service.beginRun('run')
  return { service, transport, credential }
}
it('keeps genuine no-snippet results, joins citation excerpts and exposes actual route/usage without credentials', async () => {
  const h = provider({ id: 'search-response', model: 'deepseek-flash', usage: { input_tokens: 100, output_tokens: 30 }, content: [
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://docs.python.org/3/library/json.html', title: 'JSON' }, { type: 'web_search_result', url: 'https://example.com/second', title: 'Second' }] },
    { type: 'text', text: 'summary', citations: [{ url: 'https://example.com/second', cited_text: 'real excerpt' }] },
  ] })
  try {
    const result = await h.service.search({ runId: 'run', query: 'JSON', limit: 2 })
    expect(result).toMatchObject({ status: 'results', results: [{ snippet: '', title: 'JSON' }, { snippet: 'real excerpt' }], execution: { connectionId: 'official', inputTokens: 100, outputTokens: 30 } })
    expect(JSON.stringify(result)).not.toContain('test-only-secret')
    expect(h.transport).toHaveBeenCalledOnce()
    const [url, init] = h.transport.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages'); expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body as string).tools[0]).toMatchObject({ type: 'web_search_20250305' })
  } finally { await h.service.stopRun('run') }
})
it('does not fabricate search from prose, execute without configuration, or send after cancellation', async () => {
  const h = provider({ content: [{ type: 'text', text: 'https://example.com invented' }] })
  expect(await h.service.search({ runId: 'run', query: 'test' })).toMatchObject({ status: 'failed' })
  const missing = provider({}, false)
  expect(await missing.service.search({ runId: 'run', query: 'test' })).toMatchObject({ status: 'not-configured' })
  expect(missing.credential).not.toHaveBeenCalled(); expect(missing.transport).not.toHaveBeenCalled()
  const cancelled = provider({}); const controller = new AbortController(); controller.abort()
  expect(await cancelled.service.search({ runId: 'run', query: 'test', signal: controller.signal })).toMatchObject({ status: 'failed' })
  expect(cancelled.credential).not.toHaveBeenCalled()
  await Promise.all([h.service.stopRun('run'), missing.service.stopRun('run'), cancelled.service.stopRun('run')])
})
it('selects only already-authorized official credentials, never a compatible proxy key', () => {
  const settings: ExecutionSettingsView = { connections: [{ connection: { ...connection, baseURL: 'https://proxy.example/v1' }, hasCredential: true, revoked: false }], profile: { revision: 1, updatedAt: 'now', roles: { conversation: { connectionId: 'official', model: 'deepseek-flash' }, vision: null, imageGenerate: null, imageEdit: null } }, secureStorageAvailable: true }
  expect(nativeSearchSelection(settings)).toBeNull()
  settings.connections[0].connection = connection
  expect(nativeSearchSelection(settings)).toMatchObject({ model: 'deepseek-flash', connection: { id: 'official' } })
  settings.connections[0].revoked = true
  expect(nativeSearchSelection(settings)).toBeNull()
})
