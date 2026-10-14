// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ModelConnectionSnapshot, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'
import { modelCapabilityIdentity } from '../../src/shared/workbench/modelCapabilities'
import { defaultSearchSettings } from '../../src/shared/workbench/searchSettings'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import { OpenAISearchProvider } from '../../src/main/workbench/network/OpenAISearchProvider'
import { SearchRouter, freezeSearchSelection } from '../../src/main/workbench/network/SearchRouter'
import { McpSearchProvider, parseExaResults } from '../../src/main/workbench/network/McpSearchProvider'
import { SearxngSearchProvider } from '../../src/main/workbench/network/SearxngSearchProvider'
import { WebSearchProviderError } from '../../src/main/workbench/network/SearchProviderError'
import { WebResearchService } from '../../src/main/workbench/network/WebResearchService'
import { ChatGPTResponsesProvider, serializeChatGPTResponsesRequest, serializeOpenAIResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { httpFailure } from '../../src/main/workbench/providers/providerHttpFailure'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
const oauth: ModelConnectionSnapshot = { id: 'oauth', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'account', auth: { kind: 'oauth', credentialRef: 'secret-ref' }, billing: { kind: 'subscription' }, capabilities: { stream: 'supported', tools: 'supported', vision: 'unknown', reasoning: 'unknown' } }
const selection = { connection: oauth, model: 'gpt-6.1-sol', parameters: { reasoning_effort: 'low' } }
function view(): ExecutionSettingsView { return { connections: [{ connection: oauth, hasCredential: true, revoked: false }], profile: { revision: 1, updatedAt: '2026-10-12T00:00:00Z', roles: { conversation: { connectionId: oauth.id, model: selection.model }, vision: null, imageGenerate: null, imageEdit: null } }, secureStorageAvailable: true } }
const hit = (index: number) => ({ title: 'source ' + index, url: 'https://example.com/' + index, snippet: '' })
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
it('serializes explicit native search separately from normal tools for OAuth/API, preserving reasoning include', () => {
  const input: ModelRequest = { requestId: 'q', selection, messages: [{ role: 'user', content: 'query' }], tools: [{ name: 'ordinary', description: 'function', inputSchema: { type: 'object' } }], nativeSearch: { contextSize: 'low' } }
  const wire = JSON.parse(serializeChatGPTResponsesRequest(input))
  expect(wire.tools.map((tool: { type: string }) => tool.type)).toEqual(['function', 'web_search'])
  expect(wire.tool_choice).toEqual({ type: 'web_search' })
  expect(wire.include).toEqual(['reasoning.encrypted_content', 'web_search_call.action.sources'])
  expect(wire.tools[1].external_web_access).toBe(true)
  input.selection = { ...selection, connection: { ...oauth, protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1', auth: { kind: 'api-key', credentialRef: 'api-ref' } } }
  expect(JSON.parse(serializeOpenAIResponsesRequest(input)).tools[1]).toEqual(wire.tools[1])
  delete input.nativeSearch
  expect(JSON.parse(serializeOpenAIResponsesRequest(input)).include).toEqual(['reasoning.encrypted_content'])
})
it('parses sparse native completion sources/citations and never labels generated summary as page snippets', async () => {
  const output = [{ id: 'ws', type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 'https://example.com/1' }] } },
    { id: 'msg', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'summary', annotations: [{ type: 'url_citation', url: 'https://example.com/2', title: 'Cited' }] }] }]
  const transport = vi.fn(async () => new Response(frame({ type: 'response.created', response: { id: 'response-id', model: 'actual-model' } })
    + output.map((item, output_index) => frame({ type: 'response.output_item.done', output_index, item })).join('')
    + frame({ type: 'response.completed', response: { id: 'response-id', output: [], usage: { input_tokens: 40, output_tokens: 12 } } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'search-header-request-id' } }))
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'fixture-token', accountId: 'account' }) })
  const search = new OpenAISearchProvider({ selection: () => selection, provider })
  const result = await search.search({ query: 'query', limit: 1, signal: new AbortController().signal })
  expect(result).toMatchObject({ provider: 'openai-native', summary: 'summary', results: [{ title: 'Cited', snippet: '' }, { title: 'example.com', snippet: '' }], attempts: [{ outcome: 'completed', providerRequestId: 'search-header-request-id', model: 'actual-model', requestedModel: 'gpt-6.1-sol', usage: { inputTokens: 40, outputTokens: 12 } }] })
  expect(JSON.stringify(result)).not.toContain('fixture-token')
  expect(transport).toHaveBeenCalledOnce()
})
it('distinguishes actual zero results from no search, and retains reported usage through stream failure and fallback pagination', async () => {
  const provider: ModelProvider = { async *stream() {
    yield { type: 'response.started', requestId: 'q', sequence: 1, responseId: 'partial', actualModel: 'actual' }
    yield { type: 'usage.reported', requestId: 'q', sequence: 2, usage: { inputTokens: 19, raw: { input_tokens: 19 } } }
    yield { type: 'response.failed', requestId: 'q', sequence: 3, failure: { outcome: 'unknown', kind: 'transport', code: 'broken', message: 'stream interrupted' } }
  } }
  const native = new OpenAISearchProvider({ selection: () => selection, provider })
  const openai = { search: vi.fn(native.search.bind(native)) }, independent = { search: vi.fn(async () => ({ provider: 'exa-mcp', results: [hit(1), hit(2), hit(3)], attempts: [{ provider: 'exa-mcp', outcome: 'completed' as const }] })) }, deepseek = { search: vi.fn() }
  const router = new SearchRouter({ openai, deepseek, independent: () => independent }); router.beginRun('r', freezeSearchSelection(view(), selection))
  const service = new WebResearchService({ searchProvider: router }); service.beginRun('r')
  const first = await service.search({ runId: 'r', query: 'q', limit: 1 })
  expect(first).toMatchObject({ status: 'results', provider: 'exa-mcp', attempts: [{ provider: 'openai-native', outcome: 'unknown', usage: { inputTokens: 19 } }, { provider: 'exa-mcp' }] })
  if (first.status !== 'results') throw new Error()
  expect(modelToolResult('web.search', { kind: 'read', data: first })).toMatchObject({ data: { attempts: first.attempts } })
  const next = await service.search({ runId: 'r', query: 'q', cursor: first.nextCursor, limit: 1 })
  expect(next).toMatchObject({ status: 'results', provider: 'exa-mcp', results: [hit(2)] })
  expect(openai.search).toHaveBeenCalledOnce(); expect(independent.search).toHaveBeenCalledOnce(); expect(deepseek.search).not.toHaveBeenCalled()
  router.endRun('r'); await service.stopRun('r')
})
it('freezes only explicit/main OpenAI context and never scans DeepSeek or another paid account in auto', () => {
  const saved = view(); const frozen = freezeSearchSelection(saved)
  expect(frozen.openai).toBeNull(); expect(frozen.deepseek).toBeNull()
  expect(freezeSearchSelection(saved, selection).openai).toMatchObject(selection)
  saved.capabilityRecords = [{ ...modelCapabilityIdentity(selection), facts: { webSearch: { status: 'unsupported', observedAt: 1, source: 'request' } } }]
  expect(freezeSearchSelection(saved, selection)).toMatchObject({ openai: null, diagnostic: expect.stringContaining('明确不支持') })
  saved.capabilityRecords = []
  saved.profile.search = { ...defaultSearchSettings(), openai: { connectionId: 'missing', model: 'paid-model' } }
  expect(freezeSearchSelection(saved, selection)).toMatchObject({ openai: null, diagnostic: expect.any(String) })
})
it('fixed mode fails without fallback, empty success stays empty, stop prevents fallback', async () => {
  const fail = { search: vi.fn(async () => { throw new WebSearchProviderError('failed', 'failed') }) }, other = { search: vi.fn(async () => ({ provider: 'exa-mcp', results: [] })) }
  const router = new SearchRouter({ openai: fail, deepseek: fail, independent: () => other })
  const saved = view(); saved.profile.search = { ...defaultSearchSettings(), mode: 'openai' }; router.beginRun('fixed', freezeSearchSelection(saved, selection))
  await expect(router.search({ runId: 'fixed', query: 'q', limit: 1, signal: new AbortController().signal })).rejects.toThrow('failed')
  expect(other.search).not.toHaveBeenCalled()
  const controller = new AbortController(), aborting = { search: vi.fn(async () => { controller.abort(); throw new Error('stopped') }) }
  const auto = new SearchRouter({ openai: aborting, deepseek: fail, independent: () => other }); auto.beginRun('auto', freezeSearchSelection(view(), selection))
  await expect(auto.search({ runId: 'auto', query: 'q', limit: 1, signal: controller.signal })).rejects.toThrow('stopped')
  expect(other.search).not.toHaveBeenCalled()
})
it('Exa uses discovered query/numResults/objective and preserves structured missing snippets and extra results', async () => {
  const callTool = vi.fn(async (_params: { name: string; arguments: Record<string, unknown> }) => ({ content: [], structuredContent: { results: [{ url: hit(1).url }, hit(2)] } }))
  const connect = vi.fn(async () => ({ listTools: async () => ({ tools: [{ name: 'web_search_exa', inputSchema: { type: 'object', properties: { query: {}, objective: {}, numResults: {} }, required: ['query', 'objective'] } }] }), callTool, close: async () => {} }))
  const provider = new McpSearchProvider({ connect })
  expect(await provider.search({ query: 'q', limit: 1, signal: new AbortController().signal })).toMatchObject({ results: [{ title: 'example.com', snippet: '' }, hit(2)], attempts: [{ outcome: 'completed' }] })
  expect(callTool.mock.calls[0][0]).toEqual({ name: 'web_search_exa', arguments: { query: 'q', numResults: 1, objective: 'Find relevant web sources for this query: q' } })
})
it('parses the labelled records used by actual Exa without treating random prose URL as source', () => {
  const result = parseExaResults({ status: 'returned', service: 'exa', tool: 'search', operationId: 'q', truncated: false, content: [{ type: 'text', truncated: false, text: 'Title: Official\nURL: https://example.com/1\nPublished: N/A\nHighlights:\nreal excerpt\n---\nTitle: Second\nURL: https://example.com/2\nPublished: N/A' }] })
  expect(result).toEqual([{ title: 'Official', url: hit(1).url, snippet: 'real excerpt' }, { title: 'Second', url: hit(2).url, snippet: '' }])
})
it('SearXNG uses saved LAN endpoint and real pageno, keeps partial errors and names JSON disabled/429 failures', async () => {
  const transport = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({ results: [{ url: hit(1).url }], unresponsive_engines: [['engine', 'error']] }), { headers: { 'content-type': 'application/json' } }))
  const provider = new SearxngSearchProvider({ url: 'http://localhost:8080/', fetch: transport })
  const result = await provider.search({ query: 'q', limit: 1, cursor: '2', signal: new AbortController().signal })
  expect(String(transport.mock.calls[0][0])).toBe('http://localhost:8080/search?q=q&format=json&pageno=2')
  expect(result).toMatchObject({ results: [{ title: 'example.com', snippet: '' }], nextCursor: '3', diagnostics: [expect.stringContaining('部分引擎')] })
  for (const status of [403, 429]) await expect(new SearxngSearchProvider({ url: 'https://instance.example', fetch: async () => new Response('', { status }) }).search({ query: 'q', limit: 1, signal: new AbortController().signal })).rejects.toThrow('HTTP ' + status)
})
it('old settings default to auto, search saves/reopens under profile revision while preserving connections and roles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'search-settings-'))
  const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
  try {
    const store = new ExecutionSettingsStore({ directory, encryption })
    expect((await store.read()).profile.search).toEqual(defaultSearchSettings())
    const entry = await store.saveConnection({ connection: { provider: 'teamorouter', protocol: 'openai-chat', baseURL: 'https://api.teamorouter.com/v1', accountId: 'account', authKind: 'api-key', billing: { kind: 'metered' }, capabilities: oauth.capabilities }, apiKey: 'fixture-key' })
    const roles = { conversation: { connectionId: entry.connection.id, model: 'deepseek-flash' }, vision: null, imageGenerate: null, imageEdit: null }
    const profile = await store.saveProfile({ roles })
    const search = { ...defaultSearchSettings(), mode: 'independent' as const, independent: 'searxng' as const, searxngURL: 'http://localhost:8080' }
    await store.saveProfile({ expectedRevision: profile.revision, roles, search })
    const nativeSelection = { connection: entry.connection, model: 'deepseek-flash' }
    await store.recordNativeSearchCapability(nativeSelection, 'unsupported')
    const reopened = await new ExecutionSettingsStore({ directory, encryption }).read()
    expect(reopened.capabilityRecords).toMatchObject([{ ...modelCapabilityIdentity(nativeSelection), facts: { webSearch: { status: 'unsupported', source: 'request' } } }]); expect(reopened.capabilityRecords?.[0]?.lastProbe).toBeUndefined()
    expect(reopened.profile).toMatchObject({ search, roles }); expect(reopened.connections[0]).toMatchObject(entry)
    await expect(store.saveProfile({ expectedRevision: profile.revision, roles, search })).rejects.toThrow('已改变')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
it.each([['server_error', 'server', 'provider-transient-sse'], ['authentication_error', 'auth', 'provider-auth-sse'], ['insufficient_quota', 'quota', 'provider-quota-sse'], ['rate_limit_error', 'rate-limit', 'provider-rate-limit-sse'], ['context_length_exceeded', 'protocol', 'context_length_exceeded'], ['unexpected', 'server', 'provider-unknown-sse'], ['unsupported_parameter', 'protocol', 'provider-configuration-sse']])('SSE error %s retains safe actual metadata, usage and real byte activity', async (code, kind, hostCode) => {
  const provider = new ChatGPTResponsesProvider({ credentialResolver: async () => ({ accessToken: 'secret', accountId: 'account' }), fetch: async () => new Response(': heartbeat\n\n' + frame({ type: 'response.created', response: { id: 'r', usage: { input_tokens: 9 } } }) + frame({ type: 'error', error: { code, message: 'private secret response' } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'provider-id' } }) })
  const events = []; for await (const event of provider.stream({ requestId: 'q', selection, messages: [{ role: 'user', content: 'q' }] })) events.push(event)
  expect(events.some(event => event.type === 'response.activity')).toBe(true)
  expect(events.find(event => event.type === 'usage.reported')).toMatchObject({ usage: { inputTokens: 9 } })
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind, code: hostCode, providerCode: code, providerRequestId: 'provider-id', httpStatus: 200 } })
  expect(JSON.stringify(events)).not.toContain('private secret response')
})

it('SearXNG continuation first consumes leftovers then uses original pageno and removes repeated sources', async () => {
  const transport = vi.fn(async (url: URL | RequestInfo) => {
    const page = new URL(String(url)).searchParams.get('pageno')
    return new Response(JSON.stringify({ results: page === '1' ? [hit(1), hit(2), hit(3)] : [hit(3), hit(4)] }), { headers: { 'content-type': 'application/json' } })
  })
  const backend = new SearxngSearchProvider({ url: 'https://instance.example', fetch: transport }), paid = { search: vi.fn() }
  const router = new SearchRouter({ openai: paid, deepseek: paid, independent: () => backend })
  const saved = view(); saved.profile.search = { ...defaultSearchSettings(), mode: 'independent', independent: 'searxng', searxngURL: 'https://instance.example' }
  router.beginRun('r', freezeSearchSelection(saved))
  const request = { runId: 'r', query: 'q', limit: 2, signal: new AbortController().signal }
  const first = await router.search(request)
  expect(first.results).toEqual([hit(1), hit(2)])
  const second = await router.search({ ...request, cursor: first.nextCursor })
  expect(second.results).toEqual([hit(3)]); expect(transport).toHaveBeenCalledOnce()
  const third = await router.search({ ...request, cursor: second.nextCursor })
  expect(third.results).toEqual([hit(4)]); expect(transport).toHaveBeenCalledTimes(2)
  expect(paid.search).not.toHaveBeenCalled()
})
it('a completed native search with zero sources remains zero; missing native call fails despite prose URL', async () => {
  const provider = (searched: boolean): ModelProvider => ({ async *stream() {
    yield { type: 'response.completed', requestId: 'q', sequence: 1, responseId: 'r', finishReason: 'stop', toolCalls: [], nativeResponse: {}, assistant: { role: 'assistant', content: 'https://example.com ordinary text', nativeResponses: { protocol: 'chatgpt-responses', responseId: 'r', output: searched ? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } }] : [] } } }
  } })
  expect(await new OpenAISearchProvider({ selection: () => selection, provider: provider(true) }).search({ query: 'q', limit: 1, signal: new AbortController().signal })).toMatchObject({ results: [], attempts: [{ outcome: 'completed' }] })
  await expect(new OpenAISearchProvider({ selection: () => selection, provider: provider(false) }).search({ query: 'q', limit: 1, signal: new AbortController().signal })).rejects.toThrow('未实际完成')
})

it('keyless search preferences save while secure storage is unavailable and model roles remain unchanged', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'keyless-settings-'))
  try {
    const store = new ExecutionSettingsStore({ directory, encryption: { isEncryptionAvailable: () => false, encryptString: () => { throw Error('must not encrypt') }, decryptString: () => { throw Error('must not decrypt') } } })
    const current = await store.read()
    await expect(store.saveProfile({ expectedRevision: current.profile.revision, roles: current.profile.roles, search: { ...defaultSearchSettings(), mode: 'independent' } })).resolves.toMatchObject({ search: { mode: 'independent' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('temporary rate/auth/quota restrictions never persist a native search unsupported fact', async () => {
  const failure = await httpFailure(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'web_search not available until the rate limit resets' } }), { status: 429, headers: { 'content-type': 'application/json' } }))
  expect(failure).toMatchObject({ kind: 'rate-limit', code: 'http-429' })
  const observeCapability = vi.fn(async () => {})
  for (const kind of ['auth', 'quota', 'rate-limit', 'transport'] as const) {
    const provider: ModelProvider = { async *stream() { yield { type: 'response.failed', requestId: 'q', sequence: 1, failure: { outcome: 'rejected', kind, code: 'native-web-search-unsupported', message: 'temporary restriction' } } } }
    await expect(new OpenAISearchProvider({ selection: () => selection, provider, observeCapability }).search({ query: 'q', limit: 1, signal: new AbortController().signal })).rejects.toThrow('temporary')
  }
  expect(observeCapability).not.toHaveBeenCalled()
  expect(await httpFailure(new Response(JSON.stringify({ error: { message: 'web_search is not supported by this model' } }), { status: 400, headers: { 'content-type': 'application/json' } }))).toMatchObject({ kind: 'protocol', code: 'native-web-search-unsupported' })
})
