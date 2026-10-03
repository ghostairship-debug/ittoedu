// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import {
  OpenAIResponsesProvider, serializeOpenAIResponsesRequest, serializeChatGPTResponsesRequest, CHATGPT_RESPONSES_BASE_URL,
} from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import type { ModelEvent, ModelJsonObject, ModelRequest } from '../../src/shared/workbench/modelProvider'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))) })
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void) {
  const server = createServer((req, res) => { void Promise.resolve(handler(req, res)).catch(() => res.destroy()) }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  return `http://127.0.0.1:${address.port}`
}
async function body(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ModelJsonObject }
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`
function request(baseURL = 'https://api.teamorouter.com/v1'): ModelRequest { return {
  requestId: 'responses-api', selection: { model: 'gpt-6-sol', apiProtocol: 'openai-responses', connection: {
    id: 'router', revision: 3, provider: 'teamorouter', protocol: 'openai-chat', baseURL,
    accountId: 'metered-account', auth: { kind: 'api-key', credentialRef: 'secure-ref' }, billing: { kind: 'metered' },
    capabilities: { stream: 'unknown', tools: 'unknown', reasoning: 'unknown', vision: 'unknown' },
  }, parameters: { reasoning_effort: 'high' } }, messages: [
    { role: 'system', content: '保留指令😀' }, { role: 'user', content: '修改标题' },
  ], tools: [{ name: 'text.replace', description: 'replace', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
} }
async function collect(provider: OpenAIResponsesProvider, input: ModelRequest) { const events: ModelEvent[] = []; for await (const event of provider.stream(input)) events.push(event); return events }

it('API Responses retains connection credentials and native reasoning/tool continuation through real HTTP SSE', async () => {
  const bodies: ModelJsonObject[] = [], native: ModelJsonObject[] = [
    { id: 'reason', type: 'reasoning', encrypted_content: 'opaque-ciphertext', summary: [{ type: 'summary_text', text: '检查标题' }] },
    { id: 'call-item', type: 'function_call', call_id: 'call-1', name: 'text_replace', arguments: '{"text":"你好😀"}', status: 'completed' },
  ]
  const origin = await serve(async (req, res) => {
    expect(req.url).toBe('/v1/responses')
    expect(req.headers.authorization).toBe('Bearer own-key')
    expect(req.headers['chatgpt-account-id']).toBeUndefined()
    const wire = await body(req); bodies.push(wire)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (bodies.length === 1) {
      expect(wire).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'high' }, instructions: '保留指令😀', stream: true, store: false, include: ['reasoning.encrypted_content'] })
      expect(wire.tools).toEqual([{ type: 'function', name: 'text_replace', description: 'replace', parameters: request().tools![0]!.inputSchema, strict: false }])
      res.end(frame({ type: 'response.created', response: { id: 'first', model: 'server-model' } })
        + frame({ type: 'response.reasoning_summary_text.delta', delta: '检查标题' })
        + frame({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call-1', name: 'text_replace' } })
        + frame({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"text":' })
        + frame({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '"你好😀"}' })
        + native.map((item, output_index) => frame({ type: 'response.output_item.done', item, output_index })).join('')
        + frame({ type: 'response.completed', response: { id: 'first', model: 'server-model', status: 'completed', output: native, usage: {
          input_tokens: 12, output_tokens: 8, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 6 },
        } } }))
    } else {
      res.end(frame({ type: 'response.created', response: { id: 'second' } })
        + frame({ type: 'response.output_text.delta', delta: '已修改' })
        + frame({ type: 'response.completed', response: { id: 'second', status: 'completed', output: [
          { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '已修改' }] },
        ] } }))
    }
  })
  const input = request(`${origin}/v1/`), resolved: unknown[] = []
  const provider = new OpenAIResponsesProvider({ credentialResolver: async connection => { resolved.push(connection); return 'own-key' } })
  const first = await collect(provider, input), completed = first.at(-1)
  expect(completed).toMatchObject({ type: 'response.completed', responseId: 'first', actualModel: 'server-model',
    toolCalls: [{ id: 'call-1', name: 'text.replace', argumentsText: '{"text":"你好😀"}' }],
    usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 4, reasoningTokens: 6 },
  })
  if (completed?.type !== 'response.completed') throw new Error()
  expect(completed.assistant.nativeResponses).toEqual({ protocol: 'openai-responses', responseId: 'first', output: native })
  input.messages = [...input.messages, completed.assistant, { role: 'tool', tool_call_id: 'call-1', content: '{"committed":true}' }]
  expect((await collect(provider, input)).at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '已修改' } })
  expect((bodies[1]!.input as ModelJsonObject[]).slice(1, 3)).toEqual(native)
  expect((bodies[1]!.input as ModelJsonObject[]).at(-1)).toEqual({ type: 'function_call_output', call_id: 'call-1', output: '{"committed":true}' })
  expect(resolved).toEqual([input.selection.connection, input.selection.connection])
  expect(input.selection.connection).toMatchObject({ protocol: 'openai-chat', auth: { credentialRef: 'secure-ref' }, billing: { kind: 'metered' } })
  expect(JSON.stringify(bodies)).not.toContain('own-key')
})

it('API and OAuth serializers keep their own native continuation and reject the other protocol', () => {
  const input = request()
  input.messages = [...input.messages, { role: 'assistant', content: null, nativeResponses: {
    protocol: 'chatgpt-responses', responseId: 'oauth-id', output: [{ type: 'reasoning', encrypted_content: 'ciphertext' }],
  } }]
  expect(() => serializeOpenAIResponsesRequest(input)).toThrow('invalid-native-continuation')
  input.messages = [{ role: 'assistant', content: null, nativeAnthropic: { content: [{ type: 'thinking', thinking: 'opaque', signature: 'signed' }] } }]
  expect(() => serializeOpenAIResponsesRequest(input)).toThrow('incompatible-native-continuation')
  input.messages = [{ role: 'assistant', content: null, nativeResponses: {
    protocol: 'openai-responses', responseId: 'api-id', output: [{ type: 'reasoning', encrypted_content: 'ciphertext' }],
  } }]
  expect(JSON.parse(serializeOpenAIResponsesRequest(input)).input).toEqual([{ type: 'reasoning', encrypted_content: 'ciphertext' }])
  input.selection = { ...input.selection, apiProtocol: 'chatgpt-responses', connection: {
    ...input.selection.connection, protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL, auth: { kind: 'oauth', credentialRef: 'oauth-ref' },
  } }
  expect(() => serializeChatGPTResponsesRequest(input)).toThrow('invalid-native-continuation')
})

it('API Responses reports native failure without exposing payloads or retrying the selected connection', async () => {
  let calls = 0
  const origin = await serve(async (req, res) => {
    await body(req); calls++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame({ type: 'response.failed', response: { id: 'failed', error: { message: 'private key and prompt' } } }))
  })
  const provider = new OpenAIResponsesProvider({ credentialResolver: async () => 'own-key' })
  const events = await collect(provider, request(`${origin}/v1`))
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: 'server', outcome: 'rejected', code: 'responses-provider-response-failed' } })
  expect(calls).toBe(1)
  expect(JSON.stringify(events)).not.toContain('private key')
})
