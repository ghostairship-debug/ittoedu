// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { OpenAIImagesApiProvider } from '../../src/main/workbench/images/OpenAIImagesApiProvider'
import { modelFetch } from '../../src/main/workbench/providers/modelFetch'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))) })

it.each([
  ['api', 'headers'], ['api', 'body'], ['oauth', 'headers'], ['oauth', 'body'],
] as const)('%s Images reports real HTTP %s silence as an unknown timeout without replaying the paid job', async (protocol, phase) => {
  let calls = 0
  const server = createServer((_request, response) => {
    calls++
    if (phase === 'body') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"data":') }
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  const transport = modelFetch(undefined, 25)
  const fetch: typeof globalThis.fetch = (url, init) => transport(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init)
  const request: ImageGenerationRequest = { jobId: 'job', runId: 'run', documentId: 'document', operation: 'generate', prompt: '画一只小鸟',
    selection: { imageModel: 'chosen-image', connection: { id: 'connection', revision: 1, provider: protocol === 'oauth' ? 'openai' : 'fixture',
      protocol: protocol === 'oauth' ? 'chatgpt-responses' : 'openai-chat',
      baseURL: protocol === 'oauth' ? 'https://chatgpt.com/backend-api/codex' : 'https://fixture.invalid/v1',
      ...(protocol === 'api' ? { imageProtocol: 'openai-images' as const } : {}),
      accountId: 'account', auth: { kind: protocol === 'oauth' ? 'oauth' : 'api-key', credentialRef: 'own-reference' },
      billing: { kind: 'metered' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } } }
  const provider = protocol === 'api'
    ? new OpenAIImagesApiProvider({ credentialResolver: async () => 'own-key', fetch })
    : new ChatGPTImageProvider({ credentialResolver: async () => ({ accessToken: 'own-token', accountId: 'account' }), fetch })
  expect(await provider.generate(request, [])).toMatchObject({ status: 'failed', failure: {
    kind: 'timeout', outcome: 'unknown', code: phase === 'headers' ? 'image-response-headers-idle' : 'image-response-body-idle',
  } })
  expect(calls).toBe(1)
})
