// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import { modelFetch } from '../../src/main/workbench/providers/modelFetch'
import { modelGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'
import type { ModelEvent, ModelRequest } from '../../src/shared/workbench/modelProvider'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))) })
async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>, idleTimeoutMs: number): Promise<typeof fetch> {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => response.destroy()) }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  const transport = modelFetch(undefined, idleTimeoutMs)
  return (url, init) => transport(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init)
}
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`
const protocols = ['openai-chat', 'openai-responses', 'anthropic-messages', 'chatgpt-responses'] as const
function request(protocol: typeof protocols[number]): ModelRequest {
  return { requestId: 'long-request', selection: { model: 'model-fixture', apiProtocol: protocol, outputLimit: 64000,
    parameters: {}, connection: { id: 'connection', revision: 1, provider: protocol === 'chatgpt-responses' ? 'openai' : 'fixture', protocol,
      baseURL: protocol === 'chatgpt-responses' ? CHATGPT_RESPONSES_BASE_URL : 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'secure-ref' }, billing: { kind: 'metered' },
      capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } },
    messages: [{ role: 'user', content: '生成内容' }], tools: [] }
}
function provider(protocol: typeof protocols[number], fetch: typeof globalThis.fetch) {
  const credentialResolver = async () => 'own-key'
  if (protocol === 'openai-chat') return new OpenAIChatProvider({ credentialResolver, fetch })
  if (protocol === 'openai-responses') return new OpenAIResponsesProvider({ credentialResolver, fetch })
  if (protocol === 'anthropic-messages') return new AnthropicMessagesProvider({ credentialResolver, fetch })
  return new ChatGPTResponsesProvider({ credentialResolver: async () => ({ accessToken: 'own-key', accountId: 'account' }), fetch })
}
function completed(protocol: typeof protocols[number]): string {
  if (protocol === 'openai-chat') return frame({ id: 'response', model: 'actual-model', choices: [{ index: 0, delta: { content: '完成' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 2 } }) + 'data: [DONE]\n\n'
  if (protocol === 'anthropic-messages') return [
    { type: 'message_start', message: { id: 'response', role: 'assistant', model: 'actual-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '完成' } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ].map(frame).join('')
  return frame({ type: 'response.created', response: { id: 'response' } }) + frame({ type: 'response.completed', response: {
    id: 'response', model: 'actual-model', status: 'completed', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] }],
  } })
}

it.each(protocols)('%s completes across multiple idle windows while real heartbeat bytes keep arriving', async protocol => {
  const transport = await serve(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': started\n\n')
    for (let i = 0; i < 6 && !response.destroyed; i++) {
      await delay(300)
      if (!response.destroyed) response.write(': heartbeat\n\n')
    }
    if (!response.destroyed) response.end(completed(protocol))
  }, 600)
  const events: ModelEvent[] = [], pending = (async () => {
    for await (const event of provider(protocol, transport).stream(request(protocol))) events.push(event)
  })()
  await pending
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', assistant: { content: '完成' }, usage: { inputTokens: 1, outputTokens: 2 } })
})

it.each(protocols)('%s reports a real stalled response as a retryable generation timeout', async protocol => {
  let calls = 0
  const transport = await serve((_request, response) => {
    calls++; response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': started\n\n')
  }, 25)
  const selected = provider(protocol, transport), events: ModelEvent[] = []
  for await (const event of selected.stream(request(protocol))) events.push(event)
  const failed = events.at(-1)
  expect(failed).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'timeout', code: 'response-body-idle' } })
  if (failed?.type !== 'response.failed') throw new Error('missing failure')
  expect(modelGenerationRetry(selected, failed.failure, 1)).toEqual({ kind: 'retry', delayMs: 1000 })
  expect(calls).toBe(1)
})

it.each(protocols)('%s stops a silent request on user Abort without an automatic retry', async protocol => {
  let entered!: () => void, calls = 0
  const reached = new Promise<void>(resolve => { entered = resolve })
  const transport = await serve(() => { calls++; entered() }, 600)
  const controller = new AbortController(), events: ModelEvent[] = [], pending = (async () => {
    for await (const event of provider(protocol, transport).stream(request(protocol), { signal: controller.signal })) events.push(event)
  })()
  await reached; controller.abort(); await pending
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'unknown', kind: 'aborted' } })
  expect(calls).toBe(1)
})
