// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenAIImagesApiProvider } from '../../src/main/workbench/images/OpenAIImagesApiProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import type { ExecutionSelectionSnapshot } from '../../src/shared/workbench/executionSettings'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'

const servers: Server[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})
const connection = { id: 'teamorouter-images', revision: 2, provider: 'teamorouter', protocol: 'openai-chat',
  imageProtocol: 'openai-images',
  baseURL: 'https://api.teamorouter.com/v1', accountId: 'chosen-metered-account',
  auth: { kind: 'api-key', credentialRef: 'encrypted-reference' }, billing: { kind: 'metered' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } as const
const request = (jobId: string, operation: 'generate' | 'edit' = 'generate'): ImageGenerationRequest => ({
  jobId, runId: 'run', documentId: 'document', operation, prompt: '画一只蓝色小鸟',
  selection: { connection, imageModel: 'gpt-image-2' },
  ...(operation === 'edit' ? { referenceIds: ['original'] } : {}), output: { format: 'png' },
})
async function serve(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>) {
  const server = createServer((req, res) => { void handler(req, res).catch(() => res.destroy()) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return vi.fn<typeof fetch>((url, init) => fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init))
}
async function body(req: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-teamo-images-'))
  directories.push(directory); return directory
}

it('uses the chosen TeamoRouter API key and Images endpoint, then stores a reusable raster resource', async () => {
  const image = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#2563eb' } }).png().toBuffer()
  let seen = 0
  const transport = await serve(async (req, res) => {
    seen++
    expect(req.url).toBe('/v1/images/generations')
    expect(req.headers.authorization).toBe('Bearer local-api-key')
    expect(req.headers['chatgpt-account-id']).toBeUndefined()
    expect(req.headers['content-type']).toBe('application/json')
    expect(JSON.parse((await body(req)).toString('utf8'))).toEqual({ model: 'gpt-image-2', prompt: '画一只蓝色小鸟', output_format: 'png' })
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'local-image-1' })
    res.end(JSON.stringify({ created: 1, data: [{ b64_json: image.toString('base64') }], usage: { total_tokens: 8 } }))
  })
  const credentialResolver = vi.fn(async () => 'local-api-key')
  const provider = new OpenAIImagesApiProvider({ credentialResolver, fetch: transport })
  const service = new ImageGenerationService({ directory: await temporaryDirectory(), provider })
  const result = await service.run(request('first'))
  expect(result).toMatchObject({ status: 'ready', resources: [{ width: 32, height: 24, mimeType: 'image/png' }],
    provenance: { executor: 'guoling-openai-images-api', endpoint: 'https://api.teamorouter.com/v1/images/generations',
      authKind: 'api-key', billing: { kind: 'metered' }, requestedImageModel: 'gpt-image-2', providerRequestId: 'local-image-1',
      usage: { total_tokens: 8 }, charge: 'unknown' } })
  expect(result.provenance.actualImageModels).toBeUndefined()
  expect(Buffer.from((await service.readResource(result.resources[0]!.resourceId)).bytes)).toEqual(image)
  expect(await service.run(request('first'))).toEqual(result)
  expect(seen).toBe(1)
  expect(credentialResolver).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(result)).not.toContain('local-api-key')
})

it('sends one original image as multipart edit, preserves the original, and does not retry a rejected request', async () => {
  const original = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#2563eb' } }).png().toBuffer()
  const changed = await sharp(original).linear(0.7).png().toBuffer()
  let seen = 0, firstWire: Buffer | undefined
  const transport = await serve(async (req, res) => {
    seen++
    expect(req.url).toBe('/v1/images/edits')
    expect(req.headers.authorization).toBe('Bearer local-api-key')
    expect(req.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const wire = await body(req)
    if (seen === 1) firstWire = wire
    const form = await new Request('http://local.test', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: wire }).formData()
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('prompt')).toBe('画一只蓝色小鸟')
    expect(form.get('output_format')).toBe('png')
    const upload = form.get('image')
    expect(upload).toBeInstanceOf(File)
    expect(Buffer.from(await (upload as File).arrayBuffer())).toEqual(original)
    if (seen === 1) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ created: 2, data: [{ b64_json: changed.toString('base64') }] }))
    } else { res.writeHead(400); res.end('rejected') }
  })
  const provider = new OpenAIImagesApiProvider({ credentialResolver: async () => 'local-api-key', fetch: transport })
  const service = new ImageGenerationService({ directory: await temporaryDirectory(), provider,
    resolveReference: async () => ({ bytes: original, mimeType: 'image/png', filename: 'original.png' }) })
  const edited = await service.run(request('edit', 'edit'))
  expect(edited).toMatchObject({ status: 'ready', provenance: { references: [{ referenceId: 'original' }], authKind: 'api-key' } })
  expect(edited.provenance.requestBytes).toBe(firstWire!.byteLength)
  expect(edited.provenance.requestDigest).toBe(createHash('sha256').update(firstWire!).digest('hex'))
  expect(Buffer.from((await service.readResource(edited.resources[0]!.resourceId)).bytes)).toEqual(changed)
  expect(original).not.toEqual(changed)
  const failed = await service.run(request('reject', 'edit'))
  expect(failed).toMatchObject({ status: 'failed', failure: { outcome: 'rejected', code: 'image-http-400' } })
  expect(await service.run(request('reject', 'edit'))).toEqual(failed)
  expect(seen).toBe(2)
})

it('does not resend the same job after a 429 or a transport result with unknown delivery', async () => {
  let sent = 0
  const transport = await serve(async (req, res) => {
    sent++; await body(req)
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
    res.end(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }))
  })
  const provider = new OpenAIImagesApiProvider({ credentialResolver: async () => 'local-api-key', fetch: transport })
  const service = new ImageGenerationService({ directory: await temporaryDirectory(), provider })
  const limited = await service.run(request('limited'))
  expect(limited).toMatchObject({ status: 'failed', failure: { outcome: 'rejected', code: 'image-http-429', retryAfterMs: 7000 } })
  expect(await service.run(request('limited'))).toEqual(limited)
  expect(sent).toBe(1)

  let invoked = 0
  const uncertain = new ImageGenerationService({ directory: await temporaryDirectory(),
    provider: new OpenAIImagesApiProvider({ credentialResolver: async () => 'local-api-key',
      fetch: async () => { invoked++; throw new TypeError('connection dropped after send') } }) })
  const unknown = await uncertain.run(request('unknown'))
  expect(unknown).toMatchObject({ status: 'unknown', failure: { outcome: 'unknown', kind: 'transport' } })
  expect(await uncertain.run(request('unknown'))).toEqual(unknown)
  expect(invoked).toBe(1)
})

it('freezes TeamoRouter roles while rejecting unsupported models before a request', async () => {
  let model = 'gpt-image-2'
  const roles = frozenImageRoles(async role => ({ role, profileRevision: 1, profileUpdatedAt: '', connection,
    model, parameters: {} }) as ExecutionSelectionSnapshot)
  await roles.beginRun('first')
  model = 'other-provider-image-model'
  await roles.beginRun('second')
  expect(roles.selection('first', 'generate')).toMatchObject({ imageModel: 'gpt-image-2', connection: { billing: { kind: 'metered' } } })
  expect(roles.selection('second', 'generate').imageModel).toBe('other-provider-image-model')
})

it('uses the same adapter for another explicitly enabled API root and its own model ID', async () => {
  const image = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#22c55e' } }).png().toBuffer()
  let sent = 0
  const transport = await serve(async (req, res) => {
    sent++
    expect(req.url).toBe('/tenant/openai/images/generations')
    expect(req.headers.authorization).toBe('Bearer second-provider-key')
    expect(JSON.parse((await body(req)).toString('utf8')).model).toBe('vendor-illustrate-v2')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ created: 3, data: [{ b64_json: image.toString('base64') }] }))
  })
  const selection = { connection: { ...connection, id: 'other-provider', provider: 'vendor-images',
    baseURL: 'https://vendor.invalid/tenant/openai', accountId: 'other-account' }, imageModel: 'vendor-illustrate-v2' }
  const input = { ...request('other'), selection }
  const provider = new OpenAIImagesApiProvider({ credentialResolver: async () => 'second-provider-key', fetch: transport })
  const result = await provider.generate(input, [])
  expect(result).toMatchObject({ status: 'completed', provenance: { executor: 'guoling-openai-images-api',
    endpoint: 'https://vendor.invalid/tenant/openai/images/generations', accountId: 'other-account',
    requestedImageModel: 'vendor-illustrate-v2' } })
  expect(sent).toBe(1)
})
