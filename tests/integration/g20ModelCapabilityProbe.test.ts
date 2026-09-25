// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ModelCapabilityProbe } from '../../src/main/workbench/providers/ModelCapabilityProbe'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { answerG20VisionCapabilityProbe } from '../helpers/g20CapabilityProbeFixture'

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
})

function event(response: import('node:http').ServerResponse, body: unknown) {
  response.write(`data: ${JSON.stringify(body)}\n\n`)
}

it('records only observed vision and tool capability facts through two real HTTP provider requests', async () => {
  const bodies: any[] = []
  const server = createServer((request, response) => {
    let source = ''
    request.setEncoding('utf8'); request.on('data', chunk => { source += chunk }); request.on('end', () => { void (async () => {
      bodies.push(JSON.parse(source)); response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const body = bodies.at(-1), tool = Array.isArray(body.tools)
      if (tool) {
        const match = String(body.messages[0].content).match(/token：([^\s]+)/), token = match?.[1]
        event(response, { id: `response-${bodies.length}`, model: 'fixture-actual', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'capability_probe', arguments: JSON.stringify({ token }) } }] }, finish_reason: 'tool_calls' }] })
      } else event(response, { id: `response-${bodies.length}`, model: 'fixture-actual', choices: [{ index: 0, delta: { role: 'assistant', content: await answerG20VisionCapabilityProbe(body) }, finish_reason: 'stop' }] })
      response.end('data: [DONE]\n\n')
    })() })
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address')
  const selection: ModelSelection = { connection: { id: 'connection', revision: 4, provider: 'fixture', protocol: 'openai-chat',
    baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'fixture-requested', parameters: { temperature: 0 } }
  let identity = 0
  const probe = new ModelCapabilityProbe({ provider: new OpenAIChatProvider({ credentialResolver: async () => 'fixture-secret' }),
    createId: () => `probe-${++identity}`, now: () => 1234 })
  const result = await probe.probe(selection, ['vision', 'tools'])
  expect(result).toMatchObject({ requestCount: 2, checks: ['vision', 'tools'], facts: {
    vision: { status: 'supported', actualModel: 'fixture-actual' }, tools: { status: 'supported', actualModel: 'fixture-actual' },
  }, outcomes: [{ capability: 'vision', status: 'supported' }, { capability: 'tools', status: 'supported' }] })
  expect(bodies).toHaveLength(2)
  expect(bodies[0].messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
  expect(bodies[1].tools[0].function.name).toBe('capability_probe')
  expect(JSON.stringify(result)).not.toContain('fixture-secret')
})

it('accepts only equivalent complete vision codes and keeps provider reply text out of mismatches', async () => {
  const selection: ModelSelection = { connection: { id: 'connection', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'account', auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'metered' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, model: 'fixture-requested' }
  const expected = 'red-circle|green-square|blue-triangle'
  const probeWithReply = (reply: string) => {
    let requestCount = 0
    const provider: ModelProvider = { async *stream(request) {
      requestCount++
      yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture-response', actualModel: 'fixture-actual',
        assistant: { role: 'assistant', content: reply }, toolCalls: [], finishReason: 'stop', nativeResponse: {} }
    } }
    const probe = new ModelCapabilityProbe({ provider, createId: () => 'fixture', now: () => 1234,
      createVisionChallenge: async () => ({ dataUrl: 'data:image/png;base64,Zml4dHVyZQ==', expected }) })
    return { probe, calls: () => requestCount }
  }

  const equivalent = probeWithReply('**Red circle, GREEN-square, blue triangle**')
  const accepted = await equivalent.probe.probe(selection, ['vision'])
  expect(equivalent.calls()).toBe(1)
  expect(accepted.outcomes[0]).toMatchObject({ status: 'supported', code: 'probe-vision-observed', actualModel: 'fixture-actual' })
  expect(accepted.facts.vision?.status).toBe('supported')

  const wrongShape = await probeWithReply('red-circle|green-square|blue-square').probe.probe(selection, ['vision'])
  expect(wrongShape.outcomes[0]?.status).toBe('unknown')
  expect(wrongShape.facts.vision).toBeUndefined()

  const secret = 'secretValue'.repeat(8)
  const mismatch = probeWithReply(`red-circle|green-square|blue-square Bearer ${secret} data:image/png;base64,${'A'.repeat(1000)}`)
  const rejected = await mismatch.probe.probe(selection, ['vision'])
  expect(mismatch.calls()).toBe(1)
  expect(rejected.outcomes[0]).toMatchObject({ status: 'unknown', code: 'probe-answer-mismatch', actualModel: 'fixture-actual' })
  expect(rejected.facts.vision).toBeUndefined()
  expect(rejected.outcomes[0]?.message).toContain('视觉能力仍为未知')
  expect(rejected.outcomes[0]?.message).not.toContain(expected)
  expect(rejected.outcomes[0]?.message).not.toContain('blue-square')
  expect(rejected.outcomes[0]?.message).not.toContain(secret)
  expect(rejected.outcomes[0]?.message).not.toContain('data:image')
  expect(rejected.outcomes[0]?.message.length).toBeLessThan(1000)

  const prose = await probeWithReply(`答案是 ${expected}`).probe.probe(selection, ['vision'])
  expect(prose.outcomes[0]?.status).toBe('unknown')
})
