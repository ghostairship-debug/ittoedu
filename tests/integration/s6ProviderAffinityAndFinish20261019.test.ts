// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { OpenAIChatProvider, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider, CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest, serializeOpenAIResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider, serializeAnthropicMessagesRequest } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

function request(protocol: ModelRequest['selection']['connection']['protocol']): ModelRequest {
  return { requestId: 'first-request', sessionAffinity: { key: 'host-chat-session' }, selection: { model: 'gpt-6-luna', outputLimit: 2048,
    connection: { id: 'connection', revision: 1, provider: 'openai', protocol,
      baseURL: protocol === 'chatgpt-responses' ? CHATGPT_RESPONSES_BASE_URL : protocol === 'anthropic-messages' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1',
      accountId: 'account', auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'credential' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } } },
    messages: [{ role: 'system', content: 'Stable instructions' }, { role: 'user', content: 'current revision: 1' }] }
}
const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`
const transport = (events: object[], done = false) => vi.fn(async () => new Response(events.map(frame).join('') + (done ? 'data: [DONE]\n\n' : ''),
  { headers: { 'Content-Type': 'text/event-stream' } }))
async function complete(provider: ModelProvider, input: ModelRequest) {
  const events: ModelEvent[] = []
  for await (const event of provider.stream(input)) events.push(event)
  expect(events.at(-1)?.type).toBe('response.completed')
  return events.at(-1) as Extract<ModelEvent, { type: 'response.completed' }>
}

describe('host session affinity', () => {
  it.each(['openai-chat', 'openai-responses'] as const)('scopes %s affinity independently from request identity, current facts and response lineage', protocol => {
    const serialize = protocol === 'openai-chat' ? serializeModelRequest : serializeOpenAIResponsesRequest
    const input = request(protocol)
    const original = JSON.parse(serialize(input))
    expect(original.prompt_cache_key).toMatch(/^[a-f0-9]{64}$/)
    expect(original.prompt_cache_key).not.toContain(input.sessionAffinity!.key)
    input.requestId = 'next-request'
    input.selection.connection.revision++
    input.messages[1]!.content = 'current revision: 2'
    expect(JSON.parse(serialize(input)).prompt_cache_key).toBe(original.prompt_cache_key)
    for (const change of [
      (next: ModelRequest) => { next.selection.connection.accountId = 'other-account' },
      (next: ModelRequest) => { next.selection.connection.auth.credentialRef = 'other-credential' },
      (next: ModelRequest) => { next.selection.model = 'gpt-5.4' },
      (next: ModelRequest) => { next.sessionAffinity!.key = 'other-session' },
    ]) {
      const next = structuredClone(input); change(next)
      expect(JSON.parse(serialize(next)).prompt_cache_key).not.toBe(original.prompt_cache_key)
    }
    input.selection.parameters = { prompt_cache_key: 'explicit-user-option', temperature: 0.4 }
    expect(JSON.parse(serialize(input))).toMatchObject({ prompt_cache_key: 'explicit-user-option', temperature: 0.4 })
    expect(input.selection.parameters).toEqual({ prompt_cache_key: 'explicit-user-option', temperature: 0.4 })
  })

  it('keeps native response lineage separate from session affinity', () => {
    const input = request('openai-responses')
    const first = JSON.parse(serializeOpenAIResponsesRequest(input))
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'previous output' }] }]
    input.messages = [...input.messages, { role: 'assistant', content: 'previous output', nativeResponses: { protocol: 'openai-responses',
      responseId: 'provider-response', output } }]
    const next = JSON.parse(serializeOpenAIResponsesRequest(input))
    expect(next.prompt_cache_key).toBe(first.prompt_cache_key)
    expect(next).not.toHaveProperty('previous_response_id')
    expect(next.input.at(-1)).toEqual(output[0])
  })

  it('does not add public API cache fields to OAuth, unknown relays, unknown models or Anthropic', () => {
    const oauth = JSON.parse(serializeChatGPTResponsesRequest(request('chatgpt-responses')))
    const anthropic = request('anthropic-messages')
    anthropic.selection.model = 'claude-sonnet-4-5'
    anthropic.messages[0]!.content = [{ type: 'text', text: 'Stable instructions', cache_control: { type: 'ephemeral' } }]
    const messages = JSON.parse(serializeAnthropicMessagesRequest(anthropic))
    expect(messages.system).toEqual(anthropic.messages[0]!.content)
    for (const body of [oauth, messages]) {
      expect(body).not.toHaveProperty('prompt_cache_key'); expect(body).not.toHaveProperty('prompt_cache_retention')
      expect(body).not.toHaveProperty('prompt_cache_options'); expect(body).not.toHaveProperty('sessionAffinity')
    }
    for (const protocol of ['openai-chat', 'openai-responses'] as const) {
      const serialize = protocol === 'openai-chat' ? serializeModelRequest : serializeOpenAIResponsesRequest
      const relay = request(protocol); relay.selection.connection.baseURL = 'https://relay.invalid/v1'
      expect(JSON.parse(serialize(relay))).not.toHaveProperty('prompt_cache_key')
      const unknown = request(protocol); unknown.selection.model = 'unknown-model'
      expect(JSON.parse(serialize(unknown))).not.toHaveProperty('prompt_cache_key')
    }
  })

  it('sends the same prepared scoped key after the original host session changes', async () => {
    const fetch = transport([{ type: 'response.completed', response: { id: 'response', status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] } }])
    const provider = new OpenAIResponsesProvider({ fetch, credentialResolver: async () => 'fixture' })
    const input = request('openai-responses')
    const prepared = provider.prepare(input)
    const key = JSON.parse(prepared.serialized).prompt_cache_key
    input.sessionAffinity!.key = 'changed-after-prepare'
    const events: ModelEvent[] = []
    for await (const event of prepared.stream('second-request')) events.push(event)
    expect(events.at(-1)?.type).toBe('response.completed')
    expect(fetch).toHaveBeenCalledOnce()
    const init = (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
    expect(init.body).toBe(prepared.serialized)
    expect(JSON.parse(String(init.body)).prompt_cache_key).toBe(key)
  })
})

describe('provider stop details', () => {
  it('retains the ambiguous Chat Completions length reason without inventing a context/output classification', async () => {
    const fetch = transport([{ id: 'completion', model: 'gpt-6-luna', choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }] }], true)
    const result = await complete(new OpenAIChatProvider({ fetch, credentialResolver: async () => 'fixture' }), request('openai-chat'))
    expect(result).toMatchObject({ finishReason: 'length', finishDetails: { reason: 'length' } })
    expect(result.finishDetails).not.toHaveProperty('limit')
  })

  it.each(['openai-responses', 'chatgpt-responses'] as const)('preserves %s max_output_tokens as output exhaustion', async protocol => {
    const fetch = transport([{ type: 'response.incomplete', response: { id: 'response', status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } } }])
    const provider = protocol === 'openai-responses' ? new OpenAIResponsesProvider({ fetch, credentialResolver: async () => 'fixture' })
      : new ChatGPTResponsesProvider({ fetch, credentialResolver: async () => ({ accessToken: 'fixture', accountId: 'account' }) })
    expect(await complete(provider, request(protocol))).toMatchObject({ finishReason: 'length', finishDetails: { reason: 'max_output_tokens', limit: 'output' } })
  })

  it.each([['max_tokens', 'output'], ['model_context_window_exceeded', 'context']] as const)('preserves Anthropic %s as %s exhaustion', async (reason, limit) => {
    const fetch = transport([
      { type: 'message_start', message: { id: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'partial' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' },
    ])
    const input = request('anthropic-messages'); input.selection.model = 'claude-sonnet-4-5'
    expect(await complete(new AnthropicMessagesProvider({ fetch, credentialResolver: async () => 'fixture' }), input))
      .toMatchObject({ finishReason: 'length', finishDetails: { reason, limit } })
  })
})
