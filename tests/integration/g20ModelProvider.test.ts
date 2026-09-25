// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { OpenAIChatProvider, serializeModelRequest, type ChatTransportDiagnostic } from '../../src/main/workbench/providers/OpenAIChatProvider'
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
  return `http://127.0.0.1:${address.port}/v1`
}
async function bodyOf(request: IncomingMessage): Promise<ModelJsonObject> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ModelJsonObject
}
function request(baseURL: string): ModelRequest {
  return { requestId: 'request-one', selection: { model: 'fixture-model',
    connection: { id: 'connection-one', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL,
      accountId: 'account-one', auth: { kind: 'api-key', credentialRef: 'credential-one' }, billing: { kind: 'token-plan' },
      capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } },
    parameters: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
    messages: [{ role: 'user', content: '测试中文 😀\n下一行' }],
    tools: [{ name: 'text.replace', description: 'replace selected text', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } }] }
}
async function collect(provider: OpenAIChatProvider, input: ModelRequest, signal?: AbortSignal): Promise<ModelEvent[]> {
  const events: ModelEvent[] = []
  for await (const event of provider.stream(input, { signal })) events.push(event)
  return events
}
function chunk(delta: ModelJsonObject, finish: string | null = null, extra: ModelJsonObject = {}): ModelJsonObject {
  return { id: 'completion-one', model: 'actual-fixture-model', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finish }], ...extra }
}
async function packetized(response: ServerResponse, data: string): Promise<void> {
  // Real HTTP writes deliberately split multibyte UTF-8 and CRLF boundaries.
  for (const byte of Buffer.from(data)) { response.write(Buffer.from([byte])); await nextTurn() }
}
function frame(data: ModelJsonObject): string { return `data: ${JSON.stringify(data)}\r\n\r\n` }

it('serializes the exact final HTTP body for budgets including native tools, parameters and Chinese image data', async () => {
  let actual = ''
  const baseURL = await serve(async (req, res) => {
    const buffers: Buffer[] = []
    for await (const value of req) buffers.push(Buffer.from(value))
    actual = Buffer.concat(buffers).toString('utf8')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame(chunk({ content: '完成' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const input = request(baseURL)
  input.selection.parameters = { thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 512, metadata: { title: '中文😀' } }
  input.messages = [{ role: 'user', content: [{ type: 'text', text: '读取图片：中文😀\n保留转义\\路径' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('fixture-image-中文😀').toString('base64')}`, detail: 'high' } }] }]
  const serialized = serializeModelRequest(input)
  const wire = JSON.parse(serialized)
  expect(wire).toMatchObject({ model: 'fixture-model', stream: true, stream_options: { include_usage: true },
    thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 512, metadata: { title: '中文😀' } })
  expect(wire).not.toHaveProperty('n')
  expect(wire.tools[0]).toMatchObject({ type: 'function', function: { description: input.tools![0]!.description, parameters: input.tools![0]!.inputSchema } })
  expect(wire.tools[0].function.name).toMatch(/^tool_[a-f0-9]+$/)
  expect(wire.messages).toEqual(input.messages)
  expect(serialized).not.toContain('credential-one')
  expect(serialized).not.toContain('request-one')
  const result = await collect(new OpenAIChatProvider({ credentialResolver: async () => 'fixture-wire-secret' }), input)
  expect(result.at(-1)?.type).toBe('response.completed')
  expect(actual).toBe(serialized)
  expect(Buffer.byteLength(actual, 'utf8')).toBe(Buffer.byteLength(serialized, 'utf8'))
  expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(serialized.length)
})

it('streams real fragmented UTF-8/SSE, preserves native reasoning/tool continuation, and freezes account configuration', async () => {
  const received: ModelJsonObject[] = [], auth: (string | undefined)[] = []
  const baseURL = await serve(async (req, res) => {
    expect(req.url).toBe('/v1/chat/completions')
    const body = await bodyOf(req); received.push(body); auth.push(req.headers.authorization)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-request-id': 'upstream-1' })
    if (received.length === 1) {
      const tools = body.tools as { function: { name: string } }[]
      const wire = tools[0]!.function.name
      expect(wire).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      expect(wire).not.toBe('text.replace')
      const first = JSON.stringify(chunk({ role: 'assistant', reasoning_content: '思考😀', reasoning_signature: 'opaque-signature' }))
      // SSE joins data lines with a newline before JSON parsing.
      await packetized(res, ': heartbeat\r\nevent: message\r\ndata: ' + first.slice(0, 1) + '\r\ndata: ' + first.slice(1) + '\r\n\r\n')
      await packetized(res, frame(chunk({ content: '即将修改中文😀\n' })))
      await packetized(res, frame(chunk({ tool_calls: [{ index: 0, id: 'provider-call-中文', type: 'function',
        signature: { token: 'unchanged' }, function: { name: wire, arguments: '{"content":"新' } }] })))
      await packetized(res, frame(chunk({ tool_calls: [{ index: 0, id: null, type: null,
        function: { name: null, arguments: '文😀\\n第二行"}' } }] })))
      await packetized(res, frame(chunk({}, 'tool_calls', { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 3 }, prompt_cache_hit_tokens: 4 } })))
    } else {
      await packetized(res, frame(chunk({ content: '已完成' }, 'stop')))
      // OpenAI-compatible gateways also use a separate usage-only final chunk.
      await packetized(res, `data: ${JSON.stringify({ id: 'completion-one', model: 'actual-fixture-model', choices: [], usage: { prompt_tokens: 20, completion_tokens: 2 } })}\n\n`)
    }
    res.end('data: [DONE]\r\n\r\n')
  })
  const resolutions: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const provider = new OpenAIChatProvider({ credentialResolver: async connection => {
    resolutions.push(`${connection.accountId}:${connection.auth.credentialRef}:${connection.revision}`)
    if (resolutions.length === 1) await gate
    return `fixture-${connection.accountId}`
  } })
  const input = request(baseURL)
  const first = collect(provider, input)
  input.selection.connection.accountId = 'mutated-account'
  input.messages = [{ role: 'user', content: 'mutated after dispatch' }]
  release()
  const events = await first
  expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1))
  expect(events.filter(event => event.type === 'text.delta').map(event => event.text).join('')).toBe('即将修改中文😀\n')
  const complete = events.at(-1)
  expect(complete?.type).toBe('response.completed')
  if (complete?.type !== 'response.completed') throw new Error(JSON.stringify(complete))
  expect(complete.toolCalls).toEqual([{ id: 'provider-call-中文', name: 'text.replace', argumentsText: '{"content":"新文😀\\n第二行"}' }])
  expect(complete.assistant).toMatchObject({ reasoning_content: '思考😀', reasoning_signature: 'opaque-signature',
    tool_calls: [{ id: 'provider-call-中文', signature: { token: 'unchanged' } }] })
  expect(complete.usage).toMatchObject({ inputTokens: 12, outputTokens: 8, totalTokens: 20, reasoningTokens: 3, cachedInputTokens: 4 })
  expect(complete.nativeResponse.stream_chunks).toHaveLength(5)
  const next = request(baseURL)
  next.requestId = 'request-two'; next.selection.connection.accountId = 'account-two'; next.selection.connection.revision = 2
  next.selection.connection.auth.credentialRef = 'credential-two'
  next.messages = [...next.messages, complete.assistant, { role: 'tool', tool_call_id: complete.toolCalls[0]!.id, content: '{"applied":true}' }]
  const second = await collect(provider, next)
  expect(second.at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '已完成' }, usage: { inputTokens: 20, outputTokens: 2 } })
  expect(received[0]!.messages).toEqual([{ role: 'user', content: '测试中文 😀\n下一行' }])
  expect((received[1]!.messages as unknown[])[1]).toEqual(complete.assistant)
  expect((received[1]!.messages as unknown[])[2]).toEqual(next.messages[2])
  expect(auth).toEqual(['Bearer fixture-account-one', 'Bearer fixture-account-two'])
  expect(resolutions).toEqual(['account-one:credential-one:1', 'account-two:credential-two:2'])
  expect(next.selection.connection.capabilities.tools).toBe('unknown')
})

it('treats nullable incremental tool identity fields as absent without weakening final tool validation', async () => {
  const cases = [
    { label: 'nullable function', fragments: [
      { index: 0, id: 'call-1', type: 'function', function: { name: '__WIRE__', arguments: '{"content":' } },
      { index: 0, type: null, id: null, function: null },
      { index: 0, type: null, id: null, function: { name: null, arguments: '"ok"}' } },
    ], expected: 'response.completed' },
    { label: 'custom', fragments: [{ index: 0, id: 'call-1', type: 'custom', function: { name: '__WIRE__', arguments: '{}' } }], expected: 'unsupported-tool-type' },
    { label: 'function_call', fragments: [{ index: 0, id: 'call-1', type: 'function_call', function: { name: '__WIRE__', arguments: '{}' } }], expected: 'unsupported-tool-type' },
    { label: 'numeric type', fragments: [{ index: 0, id: 'call-1', type: 1, function: { name: '__WIRE__', arguments: '{}' } }], expected: 'unsupported-tool-type' },
    { label: 'missing final id', fragments: [{ index: 0, id: null, type: null, function: { name: '__WIRE__', arguments: '{}' } }], expected: 'incomplete-tool-call' },
    { label: 'missing final name', fragments: [{ index: 0, id: 'call-1', type: null, function: { name: null, arguments: '{}' } }], expected: 'incomplete-tool-call' },
    { label: 'changed id', fragments: [
      { index: 0, id: 'call-1', type: 'function', function: { name: '__WIRE__', arguments: '' } },
      { index: 0, id: 'call-2', type: null, function: { name: null, arguments: '{}' } },
    ], expected: 'tool-id-changed' },
  ] as const
  const shapes: unknown[] = []
  const baseURL = await serve(async (req, res) => {
    const body = await bodyOf(req)
    const label = (body.messages as { content: string }[])[0]!.content
    const entry = cases.find(value => value.label === label)!
    const wire = (body.tools as { function: { name: string } }[])[0]!.function.name
    const frames = entry.fragments.map(fragment => frame(chunk({ tool_calls: [JSON.parse(JSON.stringify(fragment).replace('__WIRE__', wire))] })))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frames.join('') + frame(chunk({}, 'tool_calls')) + 'data: [DONE]\n\n')
  })
  for (const entry of cases) {
    const input = request(baseURL); input.messages = [{ role: 'user', content: entry.label }]
    const events = await collect(new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key',
      onProtocolShape: shape => { shapes.push(shape) } }), input)
    if (entry.expected === 'response.completed') {
      expect(events.at(-1)).toMatchObject({ type: 'response.completed', toolCalls: [{ id: 'call-1', name: 'text.replace', argumentsText: '{"content":"ok"}' }] })
    } else {
      expect(events.some(event => event.type === 'response.completed')).toBe(false)
      expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { code: entry.expected, outcome: 'unknown' } })
    }
  }
  expect(shapes).toEqual([
    { code: 'unsupported-tool-type', type: 'custom', index: 0, hasFunction: true },
    { code: 'unsupported-tool-type', type: 'function_call', index: 0, hasFunction: true },
    { code: 'unsupported-tool-type', type: 'number', index: 0, hasFunction: true },
    { code: 'tool-id-changed', type: 'null', index: 0, hasFunction: true },
  ])
  expect(JSON.stringify(shapes)).not.toContain('arguments')
  expect(JSON.stringify(shapes)).not.toContain('fixture-key')
})

it('rejects a drifting model ID across tool chunks', async () => {
  const baseURL = await serve(async (req, res) => {
    const body = await bodyOf(req)
    const wire = (body.tools as { function: { name: string } }[])[0]!.function.name
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame(chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: wire, arguments: '{}' } }] }))
      + frame({ ...chunk({ tool_calls: [{ index: 0, type: null, id: null, function: null }] }, 'tool_calls'), model: 'changed-model' })
      + 'data: [DONE]\n\n')
  })
  const events = await collect(new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' }), request(baseURL))
  expect(events.some(event => event.type === 'response.completed')).toBe(false)
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { code: 'response-identity-changed', outcome: 'unknown' } })
})

it('reports 429 Retry-After, server uncertainty and preflight rejection without retrying or leaking provider error bodies', async () => {
  let calls = 0
  const secret = 'fixture-credential-never-log'
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req); calls++
    const status = calls <= 2 ? 429 : 503
    res.writeHead(status, { 'Content-Type': 'application/json', 'x-request-id': secret,
      'Retry-After': calls === 1 ? '2' : 'Wed, 23 Sep 2026 01:00:05 GMT' })
    res.end(JSON.stringify({ error: { message: `reflected Authorization Bearer ${secret}` } }))
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => secret, now: () => Date.parse('2026-09-23T01:00:00Z') })
  const first = await collect(provider, request(baseURL))
  expect(first).toMatchObject([{ type: 'response.failed', failure: { kind: 'rate-limit', outcome: 'rejected', httpStatus: 429, retryAfterMs: 2000 } }])
  expect(JSON.stringify(first)).not.toContain(secret)
  expect((await collect(provider, request(baseURL))).at(-1)).toMatchObject({ failure: { retryAfterMs: 5000 } })
  expect((await collect(provider, request(baseURL))).at(-1)).toMatchObject({ failure: { kind: 'server', outcome: 'unknown', httpStatus: 503 } })
  const invalid = request(baseURL); invalid.selection.parameters = { model: 'unauthorized-model' }
  expect(await collect(provider, invalid)).toMatchObject([{ failure: { kind: 'configuration', outcome: 'not-sent' } }])
  const noVision = request(baseURL); noVision.selection.connection.capabilities.vision = 'unsupported'
  noVision.messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }]
  expect(await collect(provider, noVision)).toMatchObject([{ failure: { kind: 'configuration', outcome: 'not-sent' } }])
  const cancelled = new AbortController(); cancelled.abort()
  expect(await collect(provider, request(baseURL), cancelled.signal)).toMatchObject([{ failure: { kind: 'aborted', outcome: 'not-sent' } }])
  expect(calls).toBe(3)
})

it('classifies a structured 429 insufficient_quota as exhausted quota with a safe failure', async () => {
  const secret = 'private-credential'
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req)
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' })
    res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: `private ${secret}` } }))
  })
  const events = await collect(new OpenAIChatProvider({ credentialResolver: async () => secret }), request(baseURL))
  expect(events).toMatchObject([{ type: 'response.failed', failure: { kind: 'quota', outcome: 'rejected', code: 'http-429' } }])
  expect(JSON.stringify(events)).not.toContain(secret)
})

it('records only bounded transport phase, class and code before headers or during body read', async () => {
  const secret = 'private-token-and-prompt'
  const diagnostics: ChatTransportDiagnostic[] = []
  const beforeHeaders = new OpenAIChatProvider({ credentialResolver: async () => secret,
    fetch: async () => { throw Object.assign(new TypeError(`fetch failed ${secret}`), {
      cause: Object.assign(new Error(`socket ${secret}`), { code: 'ECONNRESET', path: `/private/${secret}` }),
    }) }, onTransportDiagnostic: item => { diagnostics.push(item) } })
  const first = await collect(beforeHeaders, request('https://fixture.invalid/private-token-and-prompt'))
  expect(first.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'transport', outcome: 'unknown' } })
  expect(diagnostics[0]).toEqual({ phase: 'fetch-before-headers', errorClass: 'TypeError', errorCode: 'ECONNRESET', httpResponseReceived: false })

  const brokenBody = new OpenAIChatProvider({ credentialResolver: async () => secret,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.error(Object.assign(new TypeError(`stream lost ${secret}`), { code: 'UND_ERR_SOCKET', url: `https://${secret}` }))
    } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    onTransportDiagnostic: item => { diagnostics.push(item) } })
  const second = await collect(brokenBody, request('https://fixture.invalid/private-token-and-prompt'))
  expect(second.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'transport', outcome: 'unknown' } })
  expect(diagnostics[1]).toEqual({ phase: 'body-read', errorClass: 'TypeError', errorCode: 'UND_ERR_SOCKET', httpResponseReceived: true, httpStatus: 200 })
  expect(JSON.stringify({ diagnostics, first, second })).not.toContain(secret)
})

it('does not complete/retry broken, truncated, cancelled or malformed streams after partial output', async () => {
  let calls = 0
  const baseURL = await serve(async (req, res) => {
    const body = await bodyOf(req); calls++
    const mode = (body.messages as { content: string }[])[0]!.content
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    await packetized(res, frame(chunk({ content: '保留中文😀' })))
    if (mode === 'socket') { res.destroy(); return }
    if (mode === 'truncated') { res.end('data: {"choices":'); return }
    if (mode === 'missing-done') { res.end(frame(chunk({}, 'stop'))); return }
    if (mode === 'bad-json') { res.end('data: {oops}\n\n'); return }
    if (mode === 'changed-id') { res.end(frame({ ...chunk({ content: 'wrong' }), id: 'different' }) + 'data: [DONE]\n\n'); return }
    // Abort/timeout cases keep the real socket open until the client cancels it.
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' })
  for (const mode of ['socket', 'truncated', 'missing-done', 'bad-json', 'changed-id', 'abort', 'timeout']) {
    const input = request(baseURL); input.messages = [{ role: 'user', content: mode }]
    const controller = new AbortController(), events: ModelEvent[] = []
    const selected = mode === 'timeout' ? new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 250 }) : provider
    for await (const event of selected.stream(input, { signal: controller.signal })) {
      events.push(event)
      if (mode === 'abort' && event.type === 'text.delta') controller.abort()
    }
    expect(events.some(event => event.type === 'text.delta')).toBe(true)
    expect(events.some(event => event.type === 'response.completed')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown',
      kind: mode === 'abort' ? 'aborted' : mode === 'timeout' ? 'timeout' : mode === 'socket' ? 'transport' : 'protocol' } })
  }
  expect(calls).toBe(7)
})

it('allows an active SSE stream beyond the idle window while retaining a finite total deadline', async () => {
  let calls = 0
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req); calls++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let index = 0; index < 7; index++) {
      res.write(frame(chunk({ reasoning_content: `片段${index}` })))
      await delay(25)
    }
    res.end(frame(chunk({ content: '完成' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 100, maxDurationMs: 500 })
  const events = await collect(provider, request(baseURL))
  expect(events.filter(event => event.type === 'reasoning.delta')).toHaveLength(7)
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', finishReason: 'stop' })
  const bounded = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 100, maxDurationMs: 120 })
  const exceeded = await collect(bounded, request(baseURL))
  expect(exceeded.some(event => event.type === 'reasoning.delta')).toBe(true)
  expect(exceeded.some(event => event.type === 'response.completed')).toBe(false)
  expect(exceeded.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'timeout', outcome: 'unknown' } })
  expect(calls).toBe(2)
})

it('does not let SSE comments extend the idle window, and external stop still aborts an active stream', async () => {
  let calls = 0
  const baseURL = await serve(async (req, res) => {
    const body = await bodyOf(req); calls++
    const mode = (body.messages as { content: string }[])[0]!.content
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(frame(chunk({ reasoning_content: '首片' })))
    for (let index = 0; index < 12 && !res.destroyed; index++) {
      await delay(20)
      res.write(mode === 'heartbeat' ? ': heartbeat\n\n' : frame(chunk({ reasoning_content: '续片' })))
    }
    if (!res.destroyed) res.end(frame(chunk({ content: '完成' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 90, maxDurationMs: 500 })
  const heartbeat = request(baseURL); heartbeat.messages = [{ role: 'user', content: 'heartbeat' }]
  const timedOut = await collect(provider, heartbeat)
  expect(timedOut.some(event => event.type === 'response.completed')).toBe(false)
  expect(timedOut.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'timeout', outcome: 'unknown' } })
  const active = request(baseURL); active.messages = [{ role: 'user', content: 'active' }]
  const controller = new AbortController(), stopped: ModelEvent[] = []
  for await (const event of provider.stream(active, { signal: controller.signal })) {
    stopped.push(event)
    if (event.type === 'reasoning.delta') controller.abort()
  }
  expect(stopped.some(event => event.type === 'response.completed')).toBe(false)
  expect(stopped.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'aborted', outcome: 'unknown' } })
  expect(calls).toBe(2)
})

it('does not count downstream event consumption as upstream SSE silence', async () => {
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req)
    await delay(100)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame(chunk({ content: '慢消费仍完成' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 180, maxDurationMs: 500 })
  const events: ModelEvent[] = []
  for await (const event of provider.stream(request(baseURL))) {
    events.push(event)
    if (event.type === 'response.started') await delay(120)
  }
  expect(events.map(event => event.type)).toEqual(['response.started', 'text.delta', 'response.completed'])
})

it('does not emit a later delta after the total deadline expires during downstream consumption', async () => {
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame(chunk({ content: '不可晚到' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 400, maxDurationMs: 200 })
  const events: ModelEvent[] = []
  for await (const event of provider.stream(request(baseURL))) {
    events.push(event)
    if (event.type === 'response.started') await delay(250)
  }
  expect(events.map(event => event.type)).toEqual(['response.started', 'response.failed'])
  expect(events.at(-1)).toMatchObject({ failure: { outcome: 'unknown', kind: 'timeout' } })
})

it('preserves external stop when the total deadline fires before downstream consumption resumes', async () => {
  const baseURL = await serve(async (req, res) => {
    await bodyOf(req)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(frame(chunk({ content: '不可晚到' }, 'stop')) + 'data: [DONE]\n\n')
  })
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key', timeoutMs: 500, maxDurationMs: 100 })
  const controller = new AbortController()
  const stream = provider.stream(request(baseURL), { signal: controller.signal })
  const started = await stream.next()
  expect(started.value?.type).toBe('response.started')
  await delay(12)
  controller.abort()
  await delay(150)
  const terminal = await stream.next()
  expect(terminal.value).toMatchObject({ type: 'response.failed', failure: { kind: 'aborted', outcome: 'unknown' } })
  expect((await stream.next()).done).toBe(true)
})

it('settles credential resolution on the total deadline or external stop without sending a late request', async () => {
  let fetches = 0
  const fetchStub: typeof fetch = async () => { fetches++; throw new Error('late-fetch') }
  for (const mode of ['deadline', 'stop'] as const) {
    let release: ((value: string) => void) | undefined
    const resolver = new Promise<string>(resolve => { release = resolve })
    const provider = new OpenAIChatProvider({ credentialResolver: async () => resolver, fetch: fetchStub,
      timeoutMs: 50, maxDurationMs: 80 })
    const controller = new AbortController()
    const pending = collect(provider, request('http://127.0.0.1:1/v1'), controller.signal)
    if (mode === 'stop') setTimeout(() => controller.abort(), 25)
    let events: ModelEvent[] | null
    try { events = await Promise.race([pending, delay(220).then(() => null)]) }
    finally { release?.('late-credential'); await pending }
    expect(events).not.toBeNull()
    expect(events?.at(-1)).toMatchObject({ type: 'response.failed', failure: {
      outcome: 'not-sent', kind: mode === 'stop' ? 'aborted' : 'timeout' } })
    expect(fetches).toBe(0)
  }
})
