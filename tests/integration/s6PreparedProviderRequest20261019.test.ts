import { describe, expect, it, vi } from 'vitest'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import { routeModelProviders } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { PreparedPayloadTokenEstimator, estimateSerializedTokens } from '../../src/core/execution/modelContextBudget'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'

const selection = (protocol: ModelSelection['connection']['protocol']): ModelSelection => ({
  model: 'selected-model', outputLimit: 2048, connection: {
    id: 'selected-connection', revision: 1, provider: 'fixture', protocol,
    baseURL: protocol === 'chatgpt-responses' ? CHATGPT_RESPONSES_BASE_URL : 'https://fixture.invalid/v1',
    accountId: 'account', auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'credential' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  },
})

describe('request-scoped provider preparation', () => {
  it('uses prepared body accounting in the Engine and preserves exact custom/unknown-provider fallback', () => {
    const body = { messages: [{ role: 'user', content: '冻结文本中文'.repeat(8000) }], stream: true }
    const serialized = JSON.stringify(body), expected = estimateSerializedTokens(serialized)
    const stream = async function* () {}
    const prepare = vi.fn((_input, accounting) => ({ serialized, tokens: accounting.measurePayload(body), stream }))
    type Probe = { options: { provider: object; serializePayload?: () => string };
      preparePayload: (selection: ModelSelection, messages: typeof body.messages, tools: []) => { serialized: string; tokens: number } }
    const engine = Object.create(ExecutionEngine.prototype) as Probe
    engine.options = { provider: { prepare } }
    const parse = vi.spyOn(JSON, 'parse')
    try {
      expect(engine.preparePayload(selection('openai-chat'), body.messages, [])).toMatchObject({ serialized, tokens: expected })
      expect(parse).not.toHaveBeenCalled()
    } finally { parse.mockRestore() }
    const custom = 'custom non-JSON request\n中文 data:image/png;base64,YQ=='
    engine.options.serializePayload = () => custom
    prepare.mockClear()
    expect(engine.preparePayload(selection('openai-chat'), body.messages, []))
      .toMatchObject({ serialized: custom, tokens: estimateSerializedTokens(custom) })
    expect(prepare).not.toHaveBeenCalled()
    // A custom provider may ignore host accounting. Its real serialized bytes
    // retain the original estimator, rather than guessing from model messages.
    engine.options = { provider: { prepare: () => ({ serialized, stream }) } }
    expect(engine.preparePayload(selection('openai-chat'), body.messages, []))
      .toMatchObject({ serialized, tokens: expected })
  })
  it.each(['openai-chat', 'openai-responses', 'chatgpt-responses', 'anthropic-messages'] as const)(
    'sends the measured frozen %s payload without constructing it again', async protocol => {
      const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":{"type":"invalid_request_error"}}', { status: 400,
        headers: { 'Content-Type': 'application/json' } }))
      const credentials: string[] = []
      const apiOptions = { fetch, credentialResolver: async (connection: ModelSelection['connection']) => {
        credentials.push(connection.id); return 'fixture-key'
      } }
      const providers = {
        'openai-chat': new OpenAIChatProvider(apiOptions),
        'openai-responses': new OpenAIResponsesProvider(apiOptions),
        'anthropic-messages': new AnthropicMessagesProvider(apiOptions),
        'chatgpt-responses': new ChatGPTResponsesProvider({ fetch, credentialResolver: async connection => {
          credentials.push(connection.id); return { accessToken: 'fixture-key', accountId: connection.accountId }
        } }),
      }
      const provider: ModelProvider = routeModelProviders(providers)
      const prepare = vi.spyOn(providers[protocol], 'prepare')
      const input = { selection: selection(protocol), messages: [{ role: 'system' as const, content: 'Stable instruction' },
        { role: 'user' as const, content: 'current facts: revision 3' }], tools: [{ name: 'test.read', description: 'Read',
        inputSchema: { type: 'object', properties: {} } }] }
      const estimator = new PreparedPayloadTokenEstimator()
      estimator.retain(input.messages)
      const measurePayload = vi.fn(body => estimator.estimate(body))
      const prepared = provider.prepare!(input, { measurePayload })
      expect(measurePayload).toHaveBeenCalledOnce()
      expect(measurePayload.mock.calls[0]![0]).toEqual(JSON.parse(prepared.serialized))
      expect(prepared.tokens).toBe(estimateSerializedTokens(prepared.serialized))
      input.messages[1]!.content = 'changed after preparation'
      input.selection.connection.id = 'changed-connection'
      input.tools[0]!.description = 'changed schema'
      const events = []
      for await (const event of prepared.stream('request-1')) events.push(event)
      expect(prepare).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0]![1]?.body).toBe(prepared.serialized)
      expect(prepared.serialized).toContain('current facts: revision 3')
      expect(prepared.serialized).not.toContain('changed after preparation')
      expect(credentials).toEqual(['selected-connection'])
      expect(events).toMatchObject([{ requestId: 'request-1', type: 'response.failed', failure: { outcome: 'rejected' } }])
    })
})
