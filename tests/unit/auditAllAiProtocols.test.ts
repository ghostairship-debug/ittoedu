// @vitest-environment node
import { expect, it } from 'vitest'
import { OpenAIChatProvider, modelToolWireName, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { AnthropicMessagesProvider } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import { OpenAIResponsesProvider } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelGenerationRetry } from '../../src/main/workbench/execution/modelGenerationRetry'
import { isContextLengthFailure } from '../../src/core/execution/modelContextBudget'
import type { ModelRequest } from '../../src/shared/workbench/modelProvider'
const request = (protocol: any): ModelRequest => ({ requestId: 'r', selection: { model: 'fixture', apiProtocol: protocol, outputLimit: 1024,
  connection: { id: 'c', revision: 1, provider: 'fixture', protocol, baseURL: 'https://example.org/v1', accountId: 'a', auth: { kind: 'api-key', credentialRef: 'fixture' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } },
  messages: [{ role: 'user', content: 'fixture' }], tools: [{ name: 'inspect', description: 'read', inputSchema: { type: 'object', properties: {} } }] })
const frames = (items: any[], done = false) => new Response(items.map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } })
async function collect(protocol: any, response: () => Response) {
  const options = { credentialResolver: async () => 'fixture', fetch: async () => response() }
  const provider = protocol === 'openai-chat' ? new OpenAIChatProvider(options as any) : protocol === 'anthropic-messages' ? new AnthropicMessagesProvider(options as any) : new OpenAIResponsesProvider(options as any)
  const events: any[] = []; for await (const event of provider.stream(request(protocol))) events.push(event)
  return events
}
it.each(['openai-chat', 'openai-responses', 'anthropic-messages'])('CA-056 preserves a safe context rejection in %s from one HTTP error body read', async protocol => {
  const events = await collect(protocol, () => new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'maximum context length; token=secret-fixture' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  const failure = events.find(event => event.type === 'response.failed')!.failure
  expect(isContextLengthFailure(failure)).toBe(true); expect(JSON.stringify(failure)).not.toContain('secret-fixture')
})
it('CA-235 creates stable unique wire aliases for legal different remote names', () => {
  const input = request('openai-chat'); input.tools = ['mcp.synthetic.read.file', 'mcp.synthetic.read_file'].map(name => ({ name, description: 'read', inputSchema: {} }))
  expect(() => serializeModelRequest(input)).not.toThrow()
  expect(modelToolWireName(input.tools[0].name)).not.toBe(modelToolWireName(input.tools[1].name))
  expect(modelToolWireName(input.tools[0].name)).toBe(modelToolWireName(input.tools[0].name))
})
it('CA-129/158 keeps complete Chat calls through length termination and an unknown tool', async () => {
  const events = await collect('openai-chat', () => frames([
    { id: 'r', model: 'fixture', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'known', type: 'function', function: { name: 'inspect', arguments: '{}' } }, { index: 1, id: 'unknown', type: 'function', function: { name: 'invented_tool', arguments: '{}' } }] }, finish_reason: null }] },
    { id: 'r', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
  ], true))
  expect(events.find(event => event.type === 'response.completed')).toMatchObject({ finishReason: 'length', toolCalls: [{ id: 'known', name: 'inspect' }, { id: 'unknown', name: 'invented_tool' }] })
})
it('CA-058/129/158 maps Anthropic native blocks to consecutive tool indexes, retaining complete and locally invalid calls', async () => {
  const items = [{ type: 'message_start', message: { id: 'r', role: 'assistant', model: 'fixture', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'plan', signature: 'signed' } }, { type: 'content_block_stop', index: 0 },
    ...['inspect', 'invented_tool'].flatMap((name, i) => [{ type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: `call-${i}`, name, input: {} } },
      { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: i ? '{' : '{}' } }, { type: 'content_block_stop', index: i + 1 }]),
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }]
  const events = await collect('anthropic-messages', () => frames(items))
  expect(events.filter(event => event.type === 'tool.delta').map(event => event.index)).toEqual([0, 0, 1, 1])
  expect(events.find(event => event.type === 'response.completed')).toMatchObject({ finishReason: 'length', toolCalls: [{ name: 'inspect', argumentsText: '{}' }, { name: 'invented_tool', argumentsText: '{' }] })
})
it('CA-129/158 keeps Responses completed done items when the provider reaches max_output_tokens', async () => {
  const calls = ['inspect', 'invented_tool'].map((name, i) => ({ type: 'function_call', id: `item-${i}`, call_id: `call-${i}`, name, arguments: '{}', status: 'completed' }))
  const events = await collect('openai-responses', () => frames([{ type: 'response.created', response: { id: 'r', model: 'fixture' } },
    ...calls.flatMap((item, output_index) => [{ type: 'response.output_item.added', output_index, item }, { type: 'response.output_item.done', output_index, item }]),
    { type: 'response.incomplete', response: { id: 'r', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }]))
  expect(events.find(event => event.type === 'response.completed')).toMatchObject({ finishReason: 'length', toolCalls: [{ name: 'inspect' }, { name: 'invented_tool' }] })
})
it('CA-158 keeps a completed Responses call when a later call is only partially delivered', async () => {
  const item = { type: 'function_call', id: 'known-item', call_id: 'known', name: 'inspect', arguments: '{}', status: 'completed' }
  const partial = { type: 'function_call', id: 'partial-item', call_id: 'partial', name: 'inspect', arguments: '{', status: 'in_progress' }
  const events = await collect('openai-responses', () => frames([
    { type: 'response.created', response: { id: 'r' } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{}' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.output_item.added', output_index: 1, item: partial },
    { type: 'response.function_call_arguments.done', output_index: 1, arguments: '{' },
    { type: 'response.incomplete', response: { id: 'r', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [item, partial] } },
  ]))
  expect(events.find(event => event.type === 'response.completed')).toMatchObject({ finishReason: 'length', toolCalls: [{ id: 'known', name: 'inspect', argumentsText: '{}' }] })
  expect(events.some(event => event.type === 'response.failed')).toBe(false)
})
it.each(['openai-chat', 'anthropic-messages'])('CA-157 routes a known transient SSE error in %s to the existing bounded retry without inventing HTTP 5xx', async protocol => {
  const events = await collect(protocol, () => frames([{ type: 'error', error: { type: 'overloaded_error', message: 'arbitrary secret text' } }]))
  const failure = events.find(event => event.type === 'response.failed')!.failure
  expect(failure).toMatchObject({ kind: 'server', httpStatus: 200, code: 'provider-transient-sse' })
  expect(modelGenerationRetry({ retrySafety: 'pure-generation' }, failure, 1)).toMatchObject({ kind: 'retry' })
  expect(JSON.stringify(failure)).not.toContain('arbitrary secret')
})
it.each(['openai-chat', 'openai-responses'])('CA-213 makes a provider refusal visible in %s while preserving native evidence', async protocol => {
  const refusal = '无法完成该请求。'
  const events = await collect(protocol, () => protocol === 'openai-chat' ? frames([
    { id: 'r', model: 'fixture', choices: [{ index: 0, delta: { refusal }, finish_reason: null }] },
    { id: 'r', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ], true) : frames([{ type: 'response.created', response: { id: 'r' } }, { type: 'response.refusal.delta', delta: refusal },
    { type: 'response.completed', response: { id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal }] }] } }]))
  expect(events.filter(event => event.type === 'text.delta').map(event => event.text).join('')).toBe(refusal)
  expect(events.find(event => event.type === 'response.completed').assistant.content).toBe(refusal)
})
