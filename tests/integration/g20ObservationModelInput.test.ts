import { describe, expect, it } from 'vitest'
import { appendObservationModelMessages, observationModelMessage } from '../../src/main/workbench/execution/observationModelInput'
import { CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import type { ModelChatMessage, ModelRequest } from '../../src/shared/workbench/modelProvider'
import type { ObservationResult } from '../../src/shared/workbench/toolPorts'

const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const observation: ObservationResult = { source: 'isolated-published',
  identity: { documentId: 'd', epoch: 'e', revision: 4, locationId: 'page-2' },
  coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
  image: { resourceId: 'image', mimeType: 'image/png', width: 1, height: 1, byteLength: bytes.byteLength } }

describe('observation model input', () => {
  it('appends one user image message after all tool receipts, linked to tool and revision', () => {
    const messages: ModelChatMessage[] = [{ role: 'assistant', content: null },
      { role: 'tool', tool_call_id: 'one', content: 'first' },
      { role: 'tool', tool_call_id: 'two', content: 'second' }]
    appendObservationModelMessages(messages, [{ toolCallId: 'two', target: 'handle-2', observation, bytes }])
    expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
    expect(messages[3]!.content).toEqual([
      { type: 'text', text: expect.stringContaining('revision=4; locationId=page-2') },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, detail: 'auto' } },
    ])
    expect(JSON.stringify(messages[3])).toContain('toolCallId=two; target=handle-2')
  })

  it('rejects truncated or substituted image bytes', () => {
    expect(() => observationModelMessage({ toolCallId: 'x', target: 'h', observation, bytes: bytes.slice(0, 8) })).toThrow()
    expect(() => observationModelMessage({ toolCallId: 'x', target: 'h', observation,
      bytes: Uint8Array.from({ length: bytes.length }, () => 0) })).toThrow()
  })

  it('maps the captured image into a Responses input_image with identical PNG bytes', () => {
    const message = observationModelMessage({ toolCallId: 'observe', target: 'page-2', observation, bytes })
    const request: ModelRequest = { requestId: 'observe', selection: { model: 'fixture', connection: {
      id: 'connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL,
      accountId: 'account', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'subscription' },
      capabilities: { stream: 'supported', tools: 'supported', reasoning: 'unknown', vision: 'supported' },
    }, parameters: {} }, messages: [message], tools: [] }
    const wire = JSON.parse(serializeChatGPTResponsesRequest(request)) as { input: Array<{ content: Array<Record<string, unknown>> }> }
    expect(wire.input[0]?.content[1]).toEqual({ type: 'input_image',
      image_url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, detail: 'auto' })
  })
})
