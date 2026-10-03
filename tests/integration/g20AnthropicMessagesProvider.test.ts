// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { AnthropicMessagesProvider, serializeAnthropicMessagesRequest } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import type { ModelEvent, ModelJsonObject, ModelRequest } from '../../src/shared/workbench/modelProvider'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })))
})
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => response.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  return `http://127.0.0.1:${address.port}`
}
async function bodyOf(request: IncomingMessage): Promise<ModelJsonObject> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ModelJsonObject
}
function request(baseURL: string): ModelRequest {
  return { requestId: 'request-one', selection: { model: 'claude-fixture', apiProtocol: 'anthropic-messages', outputLimit: 64000,
    connection: { id: 'connection-one', revision: 1, provider: 'fixture-relay', protocol: 'openai-chat', baseURL,
      accountId: 'account-one', auth: { kind: 'api-key', credentialRef: 'credential-one' }, billing: { kind: 'token-plan' },
      capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
    parameters: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } } },
    messages: [{ role: 'system', content: '全局指令' }, { role: 'developer', content: '开发指令' },
      { role: 'user', content: [{ type: 'text', text: '测试中文 😀\n下一行' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'high' } }] }],
    tools: [{ name: 'text.replace', description: 'replace selected text', inputSchema: { properties: { content: { type: 'string' } }, required: ['content'] } }] }
}
async function collect(provider: AnthropicMessagesProvider, input: ModelRequest, signal?: AbortSignal): Promise<ModelEvent[]> {
  const events: ModelEvent[] = []
  for await (const event of provider.stream(input, { signal })) events.push(event)
  return events
}
const frame = (item: Record<string, unknown>) => `event: ${item.type}\r\ndata: ${JSON.stringify(item)}\r\n\r\n`
const start = (id = 'message-one') => ({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'actual-claude-fixture', content: [],
  stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } } })
async function packetized(response: ServerResponse, items: ModelJsonObject[]) {
  // Native SSE must survive network splits inside Chinese/emoji and CRLF.
  for (const byte of Buffer.from(items.map(frame).join(''))) { response.write(Buffer.from([byte])); await nextTurn() }
}

it('uses real Messages HTTP and preserves thinking, signatures, redacted blocks and tool results across two rounds', async () => {
  const received: ModelJsonObject[] = [], resolved: string[] = []
  const root = await serve(async (req, res) => {
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('fixture-private-key')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    expect(req.headers.authorization).toBeUndefined()
    const body = await bodyOf(req); received.push(body)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'request-id': 'upstream-one' })
    if (received.length === 1) {
      const toolName = (body.tools as ModelJsonObject[])[0]!.name
      await packetized(res, [start(),
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考😀' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque-redacted-payload' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '局部修改中文😀\n' } },
        { type: 'content_block_stop', index: 2 },
        { type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'tool-one', name: toolName, input: {} } },
        { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"content":"新' } },
        { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '文😀"}' } },
        { type: 'content_block_stop', index: 3 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: null, cache_read_input_tokens: null,
          output_tokens: 8, output_tokens_details: { thinking_tokens: 3 } } },
        { type: 'message_stop' }])
    } else {
      await packetized(res, [start('message-two'),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已完成' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: 'message_stop' }])
    }
    res.end()
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const provider = new AnthropicMessagesProvider({ credentialResolver: async connection => {
    resolved.push(`${connection.id}:${connection.accountId}:${connection.revision}`)
    if (resolved.length === 1) await gate
    return 'fixture-private-key'
  } })
  const input = request(root)
  const serialized = serializeAnthropicMessagesRequest(input)
  const pending = collect(provider, input)
  input.selection.connection.accountId = 'mutated-account'; input.selection.model = 'mutated-model'
  release()
  const first = await pending, complete = first.at(-1)
  expect(first.map(event => event.sequence)).toEqual(first.map((_, index) => index + 1))
  expect(complete?.type).toBe('response.completed')
  if (complete?.type !== 'response.completed') throw new Error(JSON.stringify(complete))
  expect(complete).toMatchObject({ actualModel: 'actual-claude-fixture', finishReason: 'tool_calls',
    assistant: { content: '局部修改中文😀\n', reasoning_content: '思考😀' },
    toolCalls: [{ id: 'tool-one', name: 'text.replace', argumentsText: '{"content":"新文😀"}' }],
    usage: { inputTokens: 18, outputTokens: 8, totalTokens: 26, cachedInputTokens: 4, reasoningTokens: 3 } })
  expect(complete.assistant.nativeAnthropic?.content).toEqual([
    { type: 'thinking', thinking: '思考😀', signature: 'opaque-signature' },
    { type: 'redacted_thinking', data: 'opaque-redacted-payload' },
    { type: 'text', text: '局部修改中文😀\n' },
    { type: 'tool_use', id: 'tool-one', name: 'text_replace', input: { content: '新文😀' } },
  ])
  expect(first.filter(event => event.type === 'reasoning.delta').map(event => event.text).join('')).toBe('思考😀')
  expect(JSON.stringify(received[0])).toBe(serialized)
  expect(received[0]).toMatchObject({ model: 'claude-fixture', max_tokens: 64000, system: '全局指令\n\n开发指令',
    tools: [{ name: 'text_replace', input_schema: { type: 'object' } }], output_config: { effort: 'high' }, thinking: { type: 'adaptive' } })
  expect((received[0]!.messages as ModelJsonObject[])[0]).toEqual({ role: 'user', content: [
    { type: 'text', text: '测试中文 😀\n下一行' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } },
  ] })
  const next = request(`${root}/v1/`)
  next.requestId = 'request-two'
  next.messages = [...next.messages, complete.assistant, { role: 'tool', tool_call_id: 'tool-one', content: '{"applied":true}' }]
  const second = await collect(provider, next)
  expect(second.at(-1)).toMatchObject({ type: 'response.completed', finishReason: 'stop', assistant: { content: '已完成' } })
  expect((received[1]!.messages as ModelJsonObject[])[1]).toEqual({ role: 'assistant', content: complete.assistant.nativeAnthropic!.content })
  expect((received[1]!.messages as ModelJsonObject[])[2]).toEqual({ role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'tool-one', content: [{ type: 'text', text: '{"applied":true}' }] },
  ] })
  expect(resolved).toEqual(['connection-one:account-one:1', 'connection-one:account-one:1'])
  expect(serialized).not.toContain('credential-one')
})

it('uses explicit native max_tokens before the model output window and converts canonical assistant tools', () => {
  const input = request('https://api.teamorouter.com/v1')
  input.selection.parameters!.max_tokens = 23000
  input.messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'canonical-call', type: 'function', function: { name: 'text.replace', arguments: '{"content":"改写"}' } }] },
    { role: 'tool', tool_call_id: 'canonical-call', content: '完成' }]
  const body = JSON.parse(serializeAnthropicMessagesRequest(input))
  expect(body.max_tokens).toBe(23000)
  expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.com/image.png' } })
  expect(body.messages[1].content).toEqual([{ type: 'tool_use', id: 'canonical-call', name: 'text_replace', input: { content: '改写' } }])
  delete input.selection.outputLimit; delete input.selection.parameters!.max_tokens
  expect(() => serializeAnthropicMessagesRequest(input)).toThrow('missing-model-output-window')
})

it('honors cancellation before dispatch and preserves unknown after streamed partial output', async () => {
  const root = await serve(async (req, res) => {
    await bodyOf(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write([start(), { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已有片段' } }].map(frame).join(''))
  })
  const resolver = vi.fn(async () => 'fixture-private-key')
  const provider = new AnthropicMessagesProvider({ credentialResolver: resolver })
  const before = new AbortController(); before.abort()
  expect((await collect(provider, request(root), before.signal)).at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'not-sent', kind: 'aborted' } })
  expect(resolver).not.toHaveBeenCalled()
  const controller = new AbortController(), events: ModelEvent[] = []
  for await (const event of provider.stream(request(root), { signal: controller.signal })) {
    events.push(event)
    if (event.type === 'text.delta') controller.abort()
  }
  expect(events.some(event => event.type === 'text.delta' && event.text === '已有片段')).toBe(true)
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'aborted' } })
  expect(events.some(event => event.type === 'response.completed')).toBe(false)
})

it('classifies real HTTP rejection without leaking echoed credentials or retrying', async () => {
  let requests = 0
  const root = await serve(async (req, res) => {
    requests++; await bodyOf(req)
    res.writeHead(429, { 'Content-Type': 'application/json', 'request-id': 'fixture-private-key', 'retry-after': '2' })
    res.end(JSON.stringify({ error: { type: 'insufficient_quota', message: 'out of credits fixture-private-key' } }))
  })
  const result = await collect(new AnthropicMessagesProvider({ credentialResolver: async () => 'fixture-private-key' }), request(root))
  expect(result.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'rejected', kind: 'quota', code: 'http-429', retryAfterMs: 2000 } })
  expect(JSON.stringify(result)).not.toContain('fixture-private-key')
  expect(requests).toBe(1)
})

it('does not publish incomplete tool calls when native message_stop is missing', async () => {
  const root = await serve(async (req, res) => {
    await bodyOf(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end([start(), { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'partial-call', name: 'text_replace', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"content":' } }].map(frame).join(''))
  })
  const result = await collect(new AnthropicMessagesProvider({ credentialResolver: async () => 'fixture-private-key' }), request(root))
  expect(result.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'protocol', code: 'incomplete-stream' } })
  expect(result.some(event => event.type === 'response.completed')).toBe(false)
})
