// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { ChatGPTOAuthClient, type ChatGPTOAuthSecurePersistence, type OAuthSecureEntry } from '../../src/main/workbench/providers/ChatGPTOAuthClient'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelEvent, ModelRequest, ModelJsonObject } from '../../src/shared/workbench/modelProvider'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))) })
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const server = createServer((req, res) => { void Promise.resolve(handler(req, res)).catch(() => res.destroy()) }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  const origin = `http://127.0.0.1:${address.port}`
  // Exercise actual Node fetch/HTTP/SSE while production URLs remain fixed in the provider.
  const transport: typeof fetch = (input, init) => fetch(`${origin}${new URL(String(input)).pathname}`, init)
  return transport
}
async function body(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8') }
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`
function request(): ModelRequest { return { requestId: 'test', selection: { model: 'fixture-model', connection: {
  id: 'connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL,
  accountId: 'account', auth: { kind: 'oauth', credentialRef: 'own-ref' }, billing: { kind: 'subscription' },
  capabilities: { stream: 'unknown', tools: 'unknown', reasoning: 'unknown', vision: 'unknown' },
}, parameters: { reasoning: { effort: 'medium' } } }, messages: [{ role: 'user', content: '中文😀' }],
  tools: [{ name: 'text.replace', description: 'replace', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } }
async function collect(provider: ChatGPTResponsesProvider, input: ModelRequest, signal?: AbortSignal) { const events: ModelEvent[] = []; for await (const event of provider.stream(input, { signal })) events.push(event); return events }

it('maps the selected OAuth reasoning strength only through the Responses reasoning object', () => {
  const input = request()
  input.selection.parameters = { reasoning_effort: 'low', max_output_tokens: 512 }
  expect(JSON.parse(serializeChatGPTResponsesRequest(input))).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 512 })
  input.selection.parameters = { reasoning_effort: 'max' }
  expect(JSON.parse(serializeChatGPTResponsesRequest(input))).toMatchObject({ reasoning: { effort: 'max' } })
  input.selection.parameters = { reasoning_effort: 'high', reasoning: { effort: 'low' } }
  expect(() => serializeChatGPTResponsesRequest(input)).toThrow('invalid-reasoning-effort')
  input.selection.parameters = { reasoning_effort: 'imaginary' }
  expect(() => serializeChatGPTResponsesRequest(input)).toThrow('invalid-reasoning-effort')
})

it('classifies a successful HTTP response without SSE using only safe, fixed error codes', async () => {
  let status = 200, mediaType = 'application/json', payload = '{"private":"do not expose"}'
  const transport = await serve(async (req, res) => {
    await body(req)
    res.writeHead(status, { 'Content-Type': mediaType })
    res.end(payload)
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  for (const [type, code] of [
    ['application/json', 'chatgpt-unexpected-json'], ['text/html', 'chatgpt-unexpected-html'],
    ['text/plain', 'chatgpt-unexpected-media-type'],
  ] as const) {
    mediaType = type
    const events = await collect(provider, request())
    expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'protocol', outcome: 'unknown', code } })
    expect(JSON.stringify(events)).not.toContain('private')
  }
  mediaType = 'text/plain'
  payload = frame({ type: 'response.created', response: { id: 'mislabeled' } })
    + frame({ type: 'response.output_item.done', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '有效事件' }] } })
    + frame({ type: 'response.completed', response: { id: 'mislabeled' } })
  const framed = await collect(provider, request())
  expect(framed.at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '有效事件' } })
  status = 204
  const noBody = await collect(provider, request())
  expect(noBody.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'protocol', outcome: 'unknown', code: 'chatgpt-response-body-missing' } })
})

it('direct Responses HTTP preserves every native continuation item, wire tools, account and final serialized budget', async () => {
  const bodies: string[] = [], nativeOutput: ModelJsonObject[] = []
  const transport = await serve(async (req, res) => {
    expect(req.url).toBe('/backend-api/codex/responses')
    expect(req.headers.authorization).toBe('Bearer own-token'); expect(req.headers['chatgpt-account-id']).toBe('account')
    bodies.push(await body(req)); const wire = JSON.parse(bodies.at(-1)!)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (bodies.length === 1) {
      const name = wire.tools[0].name
      expect(name).toMatch(/^tool_/); expect(wire.tools[0].parameters).toEqual(request().tools![0]!.inputSchema)
      expect(wire.tools[0].strict).toBe(false); expect(wire.instructions).toBe('保留系统指令😀')
      nativeOutput.push({ id: 'reason', type: 'reasoning', encrypted_content: 'opaque-ciphertext', signature: { opaque: '签名' }, summary: [{ type: 'summary_text', text: '思考摘要' }] },
        { id: 'call-item', type: 'function_call', call_id: 'native-call', name, arguments: '{"text":"你好😀"}', status: 'completed', opaque_extension: { keep: true } },
        { id: 'message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '开始😀', annotations: [] }] })
      const packets = frame({ type: 'response.created', response: { id: 'response-one' } })
        + frame({ type: 'response.reasoning_summary_text.delta', delta: '思考摘要' })
        + frame({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'call-item', call_id: 'native-call', name } })
        + frame({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"text":"你好😀"}' })
        + frame({ type: 'response.output_text.delta', delta: '开始😀' })
        + frame({ type: 'response.completed', response: { id: 'response-one', status: 'completed', output: nativeOutput,
          usage: { input_tokens: 20, output_tokens: 10, output_tokens_details: { reasoning_tokens: 3 } } } })
      for (const byte of Buffer.from(packets)) res.write(Buffer.from([byte]))
      res.end()
    } else res.end(frame({ type: 'response.completed', response: { id: 'response-two', model: 'actual-model', status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] },
    ] } }))
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const input = request(); input.messages = [{ role: 'system', content: '保留系统指令😀' }, ...input.messages]
  input.selection.parameters = { reasoning_effort: 'high', metadata: { source: 'local-test' } }
  const first = await collect(provider, input), completed = first.at(-1)
  expect(completed?.type).toBe('response.completed'); if (completed?.type !== 'response.completed') throw new Error()
  expect(completed).not.toHaveProperty('actualModel')
  expect(completed.toolCalls).toEqual([{ id: 'native-call', name: 'text.replace', argumentsText: '{"text":"你好😀"}' }])
  expect(completed.assistant.nativeResponses?.output).toEqual(nativeOutput)
  expect(completed.usage).toMatchObject({ inputTokens: 20, outputTokens: 10, reasoningTokens: 3 })
  expect(first.find(event => event.type === 'reasoning.delta')).toMatchObject({ text: '思考摘要' })
  expect(bodies[0]).toBe(serializeChatGPTResponsesRequest(input))
  expect(JSON.parse(bodies[0]!)).toMatchObject({ reasoning: { effort: 'high' }, metadata: { source: 'local-test' } })
  expect(JSON.parse(bodies[0]!)).not.toHaveProperty('reasoning_effort')
  input.messages = [...input.messages, completed.assistant, { role: 'tool', tool_call_id: 'native-call', content: '{"committed":true}' }]
  const second = await collect(provider, input)
  expect(second.at(-1)).toMatchObject({ type: 'response.completed', actualModel: 'actual-model', finishReason: 'stop' })
  expect(JSON.parse(bodies[1]!).input.slice(1, 4)).toEqual(nativeOutput)
  expect(JSON.parse(bodies[1]!).input.at(-1)).toEqual({ type: 'function_call_output', call_id: 'native-call', output: '{"committed":true}' })
  expect(bodies[1]).not.toContain('nativeResponses'); expect(bodies[1]).not.toContain('own-token')
  expect(JSON.parse(bodies[1]!)).toMatchObject({ reasoning: { effort: 'high' } })
  expect(() => serializeModelRequest({ ...input, selection: { ...input.selection, connection: { ...input.selection.connection, protocol: 'openai-chat', auth: { kind: 'api-key', credentialRef: 'ref' } } } })).toThrow()
})

it('accepts Codex Responses without model while preserving provider-only actual model and rejecting conflicting stream models', async () => {
  const secret = 'own-token private prompt /internal/path'
  let packet = '', serverModel: string | undefined
  const transport = await serve(async (req, res) => {
    await body(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', ...(serverModel ? { 'OpenAI-Model': serverModel } : {}) })
    res.end(packet)
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const completed = (model?: string) => frame({ type: 'response.completed', response: { id: 'one', ...(model ? { model } : {}), status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] }] } })

  packet = frame({ type: 'response.created', response: { id: 'one' } }) + completed()
  let events = await collect(provider, request())
  expect(events.find(event => event.type === 'response.started')).toMatchObject({ type: 'response.started', responseId: 'one' })
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', responseId: 'one', assistant: { content: '完成' } })
  expect(events.find(event => event.type === 'response.started')).not.toHaveProperty('actualModel')
  expect(events.at(-1)).not.toHaveProperty('actualModel')
  expect(JSON.stringify(events)).not.toContain('fixture-model')

  packet = frame({ type: 'response.created', response: { id: 'one' } }) + completed('late-provider-model')
  events = await collect(provider, request())
  expect(events.find(event => event.type === 'response.started')).not.toHaveProperty('actualModel')
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', actualModel: 'late-provider-model' })

  serverModel = 'routed-server-model'
  packet = frame({ type: 'response.created', response: { id: 'one', model: 'body-model' } }) + completed('body-model')
  events = await collect(provider, request())
  expect(events.find(event => event.type === 'response.started')).toMatchObject({ actualModel: 'routed-server-model' })
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', actualModel: 'routed-server-model' })

  serverModel = undefined
  packet = frame({ type: 'response.created', response: { id: 'one', model: 'first-model' } })
    + frame({ type: 'response.completed', response: { id: 'one', model: 'conflicting-model', status: 'completed', error: { message: secret }, output: [] } })
  events = await collect(provider, request())
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'protocol', outcome: 'unknown', code: 'chatgpt-protocol-mismatch' } })
  expect(events.some(event => event.type === 'response.completed')).toBe(false)
  expect(JSON.stringify(events)).not.toContain(secret)
})

it('reconstructs official sparse Codex output_item.done responses and replays exact native items on the next turn', async () => {
  const bodies: ModelJsonObject[] = [], nativeOutput: ModelJsonObject[] = []
  const transport = await serve(async (req, res) => {
    const wire = JSON.parse(await body(req)) as ModelJsonObject
    bodies.push(wire)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (bodies.length === 1) {
      const name = (wire.tools as ModelJsonObject[])[0]!.name as string
      nativeOutput.push({ id: 'reason', type: 'reasoning', encrypted_content: 'opaque-ciphertext', signature: { opaque: '签名' } },
        { id: 'call-item', type: 'function_call', call_id: 'native-call', name, arguments: '{"text":"你好😀"}' },
        { id: 'message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '开始😀' }] })
      res.end(frame({ type: 'response.created', response: { id: 'sparse-one' } })
        + nativeOutput.map(item => frame({ type: 'response.output_item.done', item })).join('')
        + frame({ type: 'response.completed', response: { id: 'sparse-one', output: [], usage: { input_tokens: 8, output_tokens: 5 } } }))
    } else {
      res.end(frame({ type: 'response.created', response: { id: 'sparse-two' } })
        + frame({ type: 'response.output_item.done', item: { id: 'reply', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] } })
        + frame({ type: 'response.completed', response: { id: 'sparse-two' } }))
    }
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const input = request()
  const first = await collect(provider, input), completed = first.at(-1)
  expect(completed).toMatchObject({ type: 'response.completed', responseId: 'sparse-one', finishReason: 'tool_calls',
    toolCalls: [{ id: 'native-call', name: 'text.replace', argumentsText: '{"text":"你好😀"}' }] })
  if (completed?.type !== 'response.completed') throw new Error()
  expect(completed.assistant.nativeResponses?.output).toEqual(nativeOutput)
  expect(completed.nativeResponse.output).toEqual(nativeOutput)
  expect(completed.assistant.content).toBe('开始😀')
  input.messages = [...input.messages, completed.assistant, { role: 'tool', tool_call_id: 'native-call', content: '{"committed":true}' }]
  const second = await collect(provider, input)
  expect(second.at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '完成' }, finishReason: 'stop' })
  expect((bodies[1]!.input as ModelJsonObject[]).slice(1, 4)).toEqual(nativeOutput)
  expect((bodies[1]!.input as ModelJsonObject[]).at(-1)).toEqual({ type: 'function_call_output', call_id: 'native-call', output: '{"committed":true}' })
})

it('uses final argument events without duplicate previews and rejects sparse output conflicts, missing items and truncation', async () => {
  const secret = 'own-token prompt /private/path stack'
  let packet = ''
  const transport = await serve(async (req, res) => {
    const wire = JSON.parse(await body(req))
    packet = packet.replaceAll('__TOOL_NAME__', wire.tools[0].name)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(packet)
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const created = frame({ type: 'response.created', response: { id: 'one' } })
  const added = frame({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call', name: '__TOOL_NAME__' } })
  const argsDone = frame({ type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"text":"完成"}' })
  const callDone = frame({ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', call_id: 'call', name: '__TOOL_NAME__', arguments: '{"text":"完成"}' } })
  const complete = frame({ type: 'response.completed', response: { id: 'one' } })
  packet = created + added + argsDone + callDone + complete
  let events = await collect(provider, request())
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', toolCalls: [{ id: 'call', name: 'text.replace', argumentsText: '{"text":"完成"}' }] })
  expect(events.filter(event => event.type === 'tool.delta' && event.argumentsDelta)).toHaveLength(1)

  const message = { id: 'message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '正确' }] }
  packet = created + frame({ type: 'response.output_item.done', output_index: 0, item: message })
    + frame({ type: 'response.completed', response: { id: 'one', status: 'completed', output: [message] } })
  events = await collect(provider, request())
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '正确' } })
  const failures = [
    created + frame({ type: 'response.output_item.done', output_index: 0, item: message })
      + frame({ type: 'response.completed', response: { id: 'one', output: [{ ...message, content: [{ type: 'output_text', text: '冲突' }] }] } }),
    created + frame({ type: 'response.output_item.done', output_index: 0, item: message })
      + frame({ type: 'response.output_item.done', output_index: 0, item: message }) + complete,
    created + frame({ type: 'response.output_item.done', output_index: 1, item: message }) + complete,
    created + frame({ type: 'response.output_item.done', output_index: 0, item: message })
      + frame({ type: 'response.completed', response: { id: 'one', output: [message, { ...message, id: 'missing-done' }] } }),
    created + added + frame({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"text":' })
      + argsDone + callDone + complete,
    created + added + argsDone + argsDone + callDone + complete,
    created + frame({ type: 'response.output_item.done', item: message })
      + frame({ type: 'response.completed', response: { id: 'one', status: 'failed', error: { message: secret } } }),
  ]
  for (const invalid of failures) {
    packet = invalid
    events = await collect(provider, request())
    expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'protocol', code: 'chatgpt-protocol-mismatch' } })
    expect(JSON.stringify(events)).not.toContain(secret)
  }
  packet = created + frame({ type: 'response.output_item.done', item: message })
  events = await collect(provider, request())
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'protocol', code: 'chatgpt-stream-truncated' } })
})

it('reports abort and truncated Responses as unknown once sent; HTTP rejection and preflight never retry or switch billing', async () => {
  let mode = 'truncated', requests = 0
  const transport = await serve(async (req, res) => {
    await body(req); requests++
    if (mode === '429') { res.writeHead(429, { 'Retry-After': '3' }); res.end('own-token private raw failure'); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(frame({ type: 'response.created', response: { id: 'one', model: 'actual' } }))
    if (mode === 'truncated') res.end(frame({ type: 'response.output_text.delta', delta: '部分' }))
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  expect((await collect(provider, request())).at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'protocol', code: 'chatgpt-stream-truncated' } })
  mode = 'abort'; const controller = new AbortController(), events: ModelEvent[] = []
  for await (const event of provider.stream(request(), { signal: controller.signal })) { events.push(event); if (event.type === 'response.started') controller.abort() }
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'aborted' } })
  mode = '429'; const rejected = await collect(provider, request())
  expect(rejected.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'rejected', retryAfterMs: 3000 } })
  expect(JSON.stringify(rejected)).not.toContain('own-token'); expect(requests).toBe(3)
  const wrong = request(); wrong.selection.connection.baseURL = 'https://example.invalid'
  expect((await collect(provider, wrong)).at(-1)).toMatchObject({ failure: { outcome: 'not-sent', kind: 'configuration' } })
  const accountMismatch = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'different' }) })
  expect((await collect(accountMismatch, request())).at(-1)).toMatchObject({ failure: { outcome: 'not-sent', kind: 'auth' } })
  expect(requests).toBe(3)
})

it('classifies ChatGPT structured 429 insufficient_quota without leaking its response', async () => {
  const transport = await serve(async (req, res) => {
    await body(req)
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'private own-token' } }))
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const events = await collect(provider, request())
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'quota', outcome: 'rejected', code: 'http-429' } })
  expect(JSON.stringify(events)).not.toContain('own-token')
})

it('distinguishes provider terminal SSE events from local protocol mismatch and stream truncation without leaking payloads', async () => {
  const secret = 'own-token prompt /private/internal/path stack trace'
  let packet = '', requests = 0
  const transport = await serve(async (req, res) => {
    await body(req); requests++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(packet)
  })
  const provider = new ChatGPTResponsesProvider({ fetch: transport, credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }) })
  const started = frame({ type: 'response.created', response: { id: 'one', model: 'actual' } })
  const cases = [
    { packet: frame({ type: 'error', error: { message: secret, code: secret } }), kind: 'server', outcome: 'rejected', code: 'chatgpt-provider-sse-error' },
    { packet: started + frame({ type: 'response.failed', response: { id: 'one', model: 'actual', status: 'failed', error: { message: secret } } }), kind: 'server', outcome: 'rejected', code: 'chatgpt-provider-response-failed' },
    { packet: started + frame({ type: 'response.incomplete', response: { id: 'one', model: 'actual', status: 'incomplete', incomplete_details: { reason: secret } } }), kind: 'server', outcome: 'unknown', code: 'chatgpt-provider-response-incomplete' },
    { packet: started + `data: {"type":"response.completed","secret":"${secret}"\n\n`, kind: 'protocol', outcome: 'unknown', code: 'chatgpt-protocol-mismatch' },
    { packet: started + 'data: [DONE]\n\n', kind: 'protocol', outcome: 'unknown', code: 'chatgpt-stream-truncated' },
  ] as const
  for (const scenario of cases) {
    packet = scenario.packet
    const events = await collect(provider, request())
    expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: scenario.kind, outcome: scenario.outcome, code: scenario.code } })
    expect(JSON.stringify(events)).not.toContain(secret)
  }
  expect(requests).toBe(cases.length)
})

function securePort(): ChatGPTOAuthSecurePersistence {
  const entries = new Map<string, OAuthSecureEntry>(), leases = new Map<string, Promise<unknown>>()
  return { read: async ref => structuredClone(entries.get(ref) ?? { version: 0, credential: null }),
    compareAndSet: async (ref, version, credential) => { if ((entries.get(ref)?.version ?? 0) !== version) return false
      entries.set(ref, structuredClone({ version: version + 1, credential })); return true },
    withLease: async (ref, operation) => { const previous = leases.get(ref) ?? Promise.resolve(); const next = previous.catch(() => undefined).then(operation); leases.set(ref, next); return await next },
  }
}
const jwt = (account = 'account', generation = 1) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account }, generation })).toString('base64url')}.test-signature`
const target = { credentialRef: 'own-ref', connectionId: 'connection', revision: 1, expectedAccountId: 'account' }
const callback = (url: string, state?: string) => `http://localhost:1455/auth/callback?state=${state ?? new URL(url).searchParams.get('state')}&code=own-code`

it('OAuth local HTTP proves PKCE/state, serialized refresh, identity and revocation fencing without leaking credentials', async () => {
  let now = 1_000_000, exchanges = 0, refreshes = 0
  let challenge = '', hold = false, entered!: () => void, release: (() => void) | undefined
  const transport = await serve(async (req, res) => {
    expect(req.url).toBe('/oauth/token'); const fields = new URLSearchParams(await body(req))
    expect(fields.get('client_id')).toBe('explicit-fixture-client')
    if (fields.get('grant_type') === 'authorization_code') { exchanges++; expect(createHash('sha256').update(fields.get('code_verifier')!).digest('base64url')).toBe(challenge) }
    else { refreshes++; expect(fields.get('refresh_token')).toBe('own-refresh') }
    if (hold) { entered(); await new Promise<void>(resolve => { release = resolve }) }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: jwt('account', exchanges + refreshes), refresh_token: 'own-refresh', expires_in: 120 }))
  })
  const port = securePort(), client = new ChatGPTOAuthClient({ clientId: 'explicit-fixture-client', redirectURI: 'http://localhost:1455/auth/callback', originator: 'fixture', persistence: port, fetch: transport, now: () => now })
  const flow = await client.beginAuthorization(target), url = new URL(flow.authorizationURL); challenge = url.searchParams.get('code_challenge')!
  expect(url.origin).toBe('https://auth.openai.com'); expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  await expect(client.completeAuthorization(flow.loginId, callback(flow.authorizationURL, 'wrong-state'))).rejects.toMatchObject({ code: 'state-or-callback-mismatch' }); expect(exchanges).toBe(0)
  const account = await client.completeAuthorization(flow.loginId, callback(flow.authorizationURL))
  expect(account).toMatchObject({ accountId: 'account', credentialRef: 'own-ref' }); expect(JSON.stringify(account)).not.toContain('own-refresh')
  await expect(client.completeAuthorization(flow.loginId, callback(flow.authorizationURL))).rejects.toMatchObject({ code: 'login-expired-or-cancelled' })
  now += 70_000
  const tokens = await Promise.all([client.resolveCredential(request().selection.connection), client.resolveCredential(request().selection.connection)])
  expect(tokens[0]).toEqual(tokens[1]); expect(refreshes).toBe(1)
  now += 70_000; hold = true
  const reached = new Promise<void>(resolve => { entered = resolve })
  const refreshing = client.resolveCredential(request().selection.connection)
  await reached; await client.revoke('own-ref'); release!()
  await expect(refreshing).rejects.toMatchObject({ code: 'credential-changed-during-refresh' })
  expect((await port.read('own-ref')).credential).toBeNull()
  await expect(client.resolveCredential(request().selection.connection)).rejects.toMatchObject({ code: 'credential-revoked-or-mismatched' })
})

it('device OAuth polls only on interval; cancelled in-flight login cannot save late tokens; errors omit raw auth', async () => {
  let now = 1_000_000, polls = 0, cancelled = false, entered!: () => void, release: (() => void) | undefined
  const transport = await serve(async (req, res) => {
    const raw = await body(req)
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.endsWith('/usercode')) { res.end(JSON.stringify({ device_auth_id: 'device-id', user_code: 'CODE', interval: 1 })); return }
    if (req.url?.endsWith('/deviceauth/token')) { polls++; expect(JSON.parse(raw)).toMatchObject({ device_auth_id: 'device-id', user_code: 'CODE' }); res.end(JSON.stringify({ authorization_code: 'device-code', code_verifier: 'device-verifier' })); return }
    const fields = new URLSearchParams(raw); expect(fields.get('redirect_uri')).toBe('https://auth.openai.com/deviceauth/callback')
    if (cancelled) { res.writeHead(400); res.end('secret-own-refresh'); return }
    entered(); await new Promise<void>(resolve => { release = resolve })
    res.end(JSON.stringify({ access_token: jwt(), refresh_token: 'own-refresh', expires_in: 120 }))
  })
  const port = securePort(), client = new ChatGPTOAuthClient({ clientId: 'fixture', redirectURI: 'http://localhost:1455/auth/callback', originator: 'fixture', persistence: port, fetch: transport, now: () => now })
  const flow = await client.beginDeviceAuthorization(target)
  expect(flow.verificationURL).toBe('https://auth.openai.com/codex/device')
  expect(await client.pollDeviceAuthorization(flow.loginId)).toEqual({ status: 'pending', retryAfterMs: 1000 }); expect(polls).toBe(0)
  now += 1000; const reached = new Promise<void>(resolve => { entered = resolve }), completing = client.pollDeviceAuthorization(flow.loginId)
  await reached; client.cancel(flow.loginId); release!()
  await expect(completing).rejects.toMatchObject({ code: 'login-expired-or-cancelled' }); expect((await port.read('own-ref')).credential).toBeNull()
  cancelled = true; const second = await client.beginDeviceAuthorization(target); now += 1000
  let error: unknown; try { await client.pollDeviceAuthorization(second.loginId) } catch (caught) { error = caught }
  expect(error).toMatchObject({ code: 'http-400' }); expect(String(error)).not.toContain('secret-own-refresh')
})
