// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatGPTImageProvider, imageProvenance, type ImageProviderReference } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import type { ExecutionSelectionSnapshot } from '../../src/shared/workbench/executionSettings'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'

const connection = { id: 'chosen-connection', revision: 2, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'chosen-account',
  auth: { kind: 'oauth', credentialRef: 'chosen-credential' }, billing: { kind: 'subscription' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } as const
const request = (operation: 'generate' | 'edit' = 'generate'): ImageGenerationRequest => ({
  jobId: 'job', runId: 'run', documentId: 'document', operation, prompt: '保留图形，改变颜色',
  selection: { connection, imageModel: 'chosen-image' }, ...(operation === 'edit' ? { referenceIds: ['original'] } : {}),
})
const reference: ImageProviderReference = { referenceId: 'original', bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', filename: 'original.png' }
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))) })

it('rejects configured unsupported image abilities and output options before credential resolution or network send', async () => {
  const credentialResolver = vi.fn(async () => ({ accessToken: 'secret', accountId: connection.accountId }))
  const fetchTransport = vi.fn<typeof fetch>()
  const provider = new ChatGPTImageProvider({ credentialResolver, fetch: fetchTransport })
  const unsupported = [
    { input: { ...request(), selection: { ...request().selection, capabilities: { generate: 'unsupported', edit: 'unknown', multipleReferences: 'unknown', transparent: 'unknown' } } } as ImageGenerationRequest,
      refs: [], code: 'image-unsupported-image-generate', message: '不支持生成' },
    { input: { ...request('edit'), selection: { ...request('edit').selection, capabilities: { generate: 'unknown', edit: 'unsupported', multipleReferences: 'unknown', transparent: 'unknown' } } } as ImageGenerationRequest,
      refs: [reference], code: 'image-unsupported-image-edit', message: '不支持编辑' },
    { input: { ...request(), output: { background: 'transparent' }, selection: { ...request().selection, capabilities: { generate: 'unknown', edit: 'unknown', multipleReferences: 'unknown', transparent: 'unsupported' } } } as ImageGenerationRequest,
      refs: [], code: 'image-unsupported-image-transparent', message: '不支持透明背景' },
    { input: { ...request('edit'), referenceIds: ['original', 'second'], selection: { ...request('edit').selection, capabilities: { generate: 'unknown', edit: 'unknown', multipleReferences: 'unsupported', transparent: 'unknown' } } } as ImageGenerationRequest,
      refs: [reference, { ...reference, referenceId: 'second' }], code: 'image-unsupported-image-multiple-references', message: '不支持多张参考图' },
    { input: { ...request(), output: { format: 'webp' } } as ImageGenerationRequest, refs: [], code: 'image-unsupported-image-option', message: '不支持所选输出参数' },
    { input: { ...request(), output: { quality: 'max' } } as ImageGenerationRequest, refs: [], code: 'image-unsupported-image-option', message: '不支持所选输出参数' },
  ]
  for (const { input, refs, code, message } of unsupported) {
    const result = await provider.generate(input, refs)
    expect(result).toMatchObject({ status: 'failed', failure: { outcome: 'not-sent', kind: 'configuration', code },
      provenance: { endpoint: input.operation === 'edit' ? 'https://chatgpt.com/backend-api/codex/images/edits' : 'https://chatgpt.com/backend-api/codex/images/generations',
        accountId: 'chosen-account', billing: { kind: 'subscription' }, requestedImageModel: 'chosen-image', charge: 'unknown' } })
    if (result.status === 'failed') expect(result.failure.message).toContain(message)
    expect(result.provenance.actualImageModels).toBeUndefined()
  }
  expect(credentialResolver).not.toHaveBeenCalled()
  expect(fetchTransport).not.toHaveBeenCalled()
})

it('keeps an unverified transparent request on the chosen OAuth Images route and reports a single local rejection without fallback', async () => {
  const received: Array<{ path: string; body: unknown; authorization: string | undefined; account: string | undefined }> = []
  const server = createServer((incoming, outgoing) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    received.push({ path: incoming.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      authorization: incoming.headers.authorization, account: incoming.headers['chatgpt-account-id'] as string | undefined })
    outgoing.writeHead(400, { 'x-request-id': 'local-unsupported-transparent' }); outgoing.end('unsupported transparent background')
  })().catch(() => outgoing.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const transport = vi.fn<typeof fetch>((url, init) => fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init))
  const credentialResolver = vi.fn(async () => ({ accessToken: 'local-token', accountId: 'chosen-account' }))
  const provider = new ChatGPTImageProvider({ credentialResolver, fetch: transport })
  const input = { ...request(), output: { background: 'transparent' as const } }
  const before = imageProvenance(input)
  const result = await provider.generate(input, [])
  expect(received).toEqual([{ path: '/backend-api/codex/images/generations', body: {
    model: 'chosen-image', prompt: input.prompt, background: 'transparent' }, authorization: 'Bearer local-token', account: 'chosen-account' }])
  expect(transport).toHaveBeenCalledTimes(1)
  expect(transport.mock.calls[0]?.[0]).toBe(before.endpoint)
  expect(credentialResolver).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ status: 'failed', failure: { outcome: 'rejected', code: 'image-http-400', httpStatus: 400 }, provenance: {
    executor: before.executor, endpoint: before.endpoint, connectionId: before.connectionId, connectionRevision: before.connectionRevision,
    accountId: before.accountId, authKind: before.authKind, billing: before.billing, requestedImageModel: before.requestedImageModel,
    providerRequestId: 'local-unsupported-transparent', charge: 'unknown', querySupport: 'unavailable' } })
  expect(result.provenance.actualImageModels).toBeUndefined()
})

it('refuses image-role parameters that the Images adapter would otherwise ignore', async () => {
  const roles = frozenImageRoles(async role => ({ role, profileRevision: 1, profileUpdatedAt: '2026-09-23T00:00:00.000Z',
    connection, model: 'chosen-image', parameters: role === 'imageGenerate' ? { output: { background: 'transparent' } } : {} }) as ExecutionSelectionSnapshot)
  await roles.beginRun('run')
  expect(() => roles.selection('run', 'generate')).toThrow('不支持的额外模型参数')
  expect(roles.selection('run', 'edit')).toMatchObject({ imageModel: 'chosen-image', connection: { id: 'chosen-connection', billing: { kind: 'subscription' } } })
})
