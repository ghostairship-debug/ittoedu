import { expect, it } from 'vitest'
import { httpFailure } from '../../src/main/workbench/providers/providerHttpFailure'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'
const selection: ModelSelection = { model: 'test', connection: { id: 'x', revision: 1, provider: 'deepseek', protocol: 'openai-chat', baseURL: 'https://api.deepseek.com', accountId: 'owner', auth: { kind: 'api-key', credentialRef: 'x' }, billing: { kind: 'metered' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } }
it('adds an object root to a discriminated tool schema without discarding branch validation', () => {
  const inputSchema = { oneOf: [{ type: 'object', properties: { kind: { const: 'a' } } }, { type: 'object', properties: { kind: { const: 'b' } } }] }
  const body = JSON.parse(serializeModelRequest({ selection, messages: [{ role: 'user', content: 'test' }], tools: [{ name: 'artifact.save', description: 'save', inputSchema }] }))
  expect(body.tools[0].function.parameters).toEqual({ type: 'object', ...inputSchema })
  expect(inputSchema).not.toHaveProperty('type')
})
it('classifies context and schema failures with fixed codes without exporting the provider body', async () => {
  for (const [message, code] of [['maximum context length exceeded; secret-token', 'context_length_exceeded'], ["Invalid schema for function 'artifact_save': secret-token", 'invalid-tool-schema']]) {
    const result = await httpFailure(new Response(JSON.stringify({ error: { code: 'invalid_request_error', message } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    expect(result.code).toBe(code); expect(JSON.stringify(result)).not.toContain('secret-token')
  }
})
