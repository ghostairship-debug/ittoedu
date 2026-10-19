import { describe, expect, it, vi } from 'vitest'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider } from '../../src/main/workbench/providers/AnthropicMessagesProvider'
import { routeModelProviders } from '../../src/main/workbench/providers/ModelProviderRouter'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'

const selection = (protocol: ModelSelection['connection']['protocol']): ModelSelection => ({
  model: 'selected-model', outputLimit: 2048, connection: {
    id: 'selected-connection', revision: 1, provider: 'fixture', protocol,
    baseURL: protocol === 'chatgpt-responses' ? CHATGPT_RESPONSES_BASE_URL : 'https://fixture.invalid/v1',
    accountId: 'account', auth: { kind: protocol === 'chatgpt-responses' ? 'oauth' : 'api-key', credentialRef: 'credential' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  },
})

describe('request-scoped provider preparation', () => {
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
      const prepared = provider.prepare!(input)
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
