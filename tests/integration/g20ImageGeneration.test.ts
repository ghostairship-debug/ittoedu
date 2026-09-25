// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { ChatGPTImageProvider, imageProvenance, serializeChatGPTImageRequest, type ImageProviderReference } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ImageGenerationRequest } from '../../src/shared/workbench/images'

const servers: Server[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})
async function directory() { const result = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-images-')); directories.push(result); return result }
const fixture = () => sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 80, g: 120, b: 200, alpha: 1 } } }).png().toBuffer()
const connection = { id: 'connection', revision: 2, provider: 'openai', protocol: 'chatgpt-responses',
  baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'current-account',
  auth: { kind: 'oauth', credentialRef: 'own-ref' }, billing: { kind: 'subscription' },
  capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
function request(jobId: string): ImageGenerationRequest {
  return { jobId, runId: 'run', documentId: 'document', operation: 'generate', prompt: '蓝色铃铛，无文字',
    selection: { imageModel: 'chosen-image', connection }, output: { format: 'png' } }
}
async function server(handler: (body: string, response: import('node:http').ServerResponse, url: string) => void | Promise<void>): Promise<typeof fetch> {
  const http = createServer((req, res) => { void (async () => {
    expect(req.headers.authorization).toBe('Bearer own-access')
    expect(req.headers['chatgpt-account-id']).toBe('current-account')
    expect(req.headers.accept).toBe('application/json')
    expect(req.headers['x-codex-image-turn-id']).toBe('run')
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part))
    await handler(Buffer.concat(chunks).toString('utf8'), res, req.url ?? '')
  })().catch(() => res.destroy()) })
  servers.push(http)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address(); if (!address || typeof address === 'string') throw new Error()
  return (url, init) => fetch('http://127.0.0.1:' + address.port + new URL(String(url)).pathname, init)
}
const resolver = async () => ({ accessToken: 'own-access', accountId: 'current-account' })
const response = (bytes: Buffer, extra: object = {}) => JSON.stringify({ created: 123, data: [{ b64_json: bytes.toString('base64'), generation_id: 'generation-1' }],
  background: 'opaque', quality: 'medium', size: '32x24', output_format: 'png',
  usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }, ...extra })

it('serializes the official direct generations and edits contracts with frozen reference bytes', async () => {
  const generated = JSON.parse(serializeChatGPTImageRequest(request('generate'), []))
  expect(generated).toEqual({ model: 'chosen-image', prompt: '蓝色铃铛，无文字' })
  const original = await fixture(), reference: ImageProviderReference = { referenceId: 'original', bytes: original, mimeType: 'image/png', filename: 'original.png' }
  const edit: ImageGenerationRequest = { ...request('edit'), operation: 'edit', referenceIds: ['original'] }
  const wire = JSON.parse(serializeChatGPTImageRequest(edit, [reference]))
  expect(wire).toEqual({ model: 'chosen-image', prompt: '蓝色铃铛，无文字',
    images: [{ image_url: 'data:image/png;base64,' + original.toString('base64') }] })
  expect(() => serializeChatGPTImageRequest(edit, [])).toThrow()
  expect(() => serializeChatGPTImageRequest({ ...request('bad-format'), output: { format: 'webp' } }, [])).toThrow()
  expect(() => serializeChatGPTImageRequest({ ...request('bad-quality'), output: { quality: 'max' } }, [])).toThrow()
})

it('generates one real raster resource through the direct Images endpoint and reopens the durable job without resending', async () => {
  const image = await fixture(), root = await directory(), requests: string[] = []
  const transport = await server((raw, res, url) => {
    expect(url).toBe('/backend-api/codex/images/generations')
    requests.push(raw)
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': 'image-request-1' })
    res.end(response(image))
  })
  const provider = new ChatGPTImageProvider({ credentialResolver: resolver, fetch: transport })
  const service = new ImageGenerationService({ directory: root, provider })
  const job = await service.run(request('generate'))
  expect(job).toMatchObject({ status: 'ready', stopped: false, resources: [{ width: 32, height: 24, mimeType: 'image/png' }],
    provenance: { executor: 'guoling-direct-chatgpt-images', providerRequestId: 'image-request-1',
      providerResponseId: 'generation-1', requestedImageModel: 'chosen-image', resolvedOutput: { size: '32x24', format: 'png' },
      usage: { input_tokens: 3, output_tokens: 4 }, charge: 'unknown' } })
  expect(job.provenance.actualImageModels).toBeUndefined()
  expect(requests).toHaveLength(1)
  expect(JSON.parse(requests[0]!)).toEqual({ model: 'chosen-image', prompt: '蓝色铃铛，无文字' })
  const reopened = new ImageGenerationService({ directory: root, provider })
  expect(await reopened.run(request('generate'))).toEqual(job)
  expect(requests).toHaveLength(1)
  expect(Buffer.from((await reopened.readResource(job.resources[0]!.resourceId)).bytes)).toEqual(image)
  const durable = (await Promise.all((await fs.readdir(path.join(root, 'jobs'))).map(name => fs.readFile(path.join(root, 'jobs', name), 'utf8')))).join('')
  expect(durable).not.toContain('own-access')
  expect(durable).not.toContain(image.toString('base64'))
})

it('edits with the original bytes in an independent request and keeps the original intact', async () => {
  const original = await fixture(), changed = await sharp(original).flop().linear(0.7).png().toBuffer(), root = await directory()
  const transport = await server((raw, res, url) => {
    expect(url).toBe('/backend-api/codex/images/edits')
    expect(JSON.parse(raw)).toEqual({ model: 'chosen-image', prompt: '蓝色铃铛，无文字',
      images: [{ image_url: 'data:image/png;base64,' + original.toString('base64') }] })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response(changed))
  })
  const service = new ImageGenerationService({ directory: root, provider: new ChatGPTImageProvider({ credentialResolver: resolver, fetch: transport }),
    resolveReference: async () => ({ bytes: original, mimeType: 'image/png', filename: 'original.png' }) })
  const job = await service.run({ ...request('edit'), operation: 'edit', referenceIds: ['original'] })
  expect(job).toMatchObject({ status: 'ready', provenance: { references: [{ referenceId: 'original' }] } })
  expect(Buffer.from((await service.readResource(job.resources[0]!.resourceId)).bytes)).toEqual(changed)
  expect(original).not.toEqual(changed)
})

it('keeps HTTP rejection, malformed result and mismatched requested size honest without automatic retries', async () => {
  const image = await fixture(), root = await directory(); let mode = 'rejected', calls = 0
  const transport = await server((_raw, res) => {
    calls++
    if (mode === 'rejected') { res.writeHead(400); res.end('private upstream error own-access'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(mode === 'malformed' ? JSON.stringify({ created: 123, data: [] }) : response(image))
  })
  const provider = new ChatGPTImageProvider({ credentialResolver: resolver, fetch: transport })
  const service = new ImageGenerationService({ directory: root, provider })
  const rejected = await service.run(request('rejected'))
  expect(rejected).toMatchObject({ status: 'failed', resources: [], failure: { outcome: 'rejected', code: 'image-http-400' } })
  expect(await service.run(request('rejected'))).toEqual(rejected); expect(calls).toBe(1)
  mode = 'malformed'
  const unknown = await service.run(request('malformed'))
  expect(unknown).toMatchObject({ status: 'unknown', resources: [], failure: { outcome: 'unknown', kind: 'protocol' } })
  expect(await service.run(request('malformed'))).toEqual(unknown); expect(calls).toBe(2)
  mode = 'valid'
  const size = await service.run({ ...request('size'), output: { format: 'png', size: '64x48' } })
  expect(size).toMatchObject({ status: 'ready', resources: [{ width: 32, height: 24 }], provenance: { outputWarnings: ['size-differs'] } })
  expect(JSON.stringify([rejected, unknown, size])).not.toContain('own-access')
})

it('classifies a structured image 429 insufficient_quota without exposing its response', async () => {
  const transport = await server((_raw, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'private own-access' } }))
  })
  const result = await new ChatGPTImageProvider({ credentialResolver: resolver, fetch: transport }).generate(request('quota'), [])
  expect(result).toMatchObject({ status: 'failed', failure: { kind: 'quota', outcome: 'rejected', code: 'image-http-429' } })
  expect(JSON.stringify(result)).not.toContain('own-access')
})

it('stop after send remains unknown and a known late image is retained unapplied', async () => {
  const image = await fixture(), root = await directory()
  let entered!: () => void, release!: () => void, calls = 0
  const reached = new Promise<void>(resolve => { entered = resolve })
  const transport = await server(async (_raw, res) => { calls++; entered(); await new Promise<void>(resolve => { release = resolve })
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(response(image)) })
  const provider = new ChatGPTImageProvider({ credentialResolver: resolver, fetch: transport })
  const service = new ImageGenerationService({ directory: root, provider })
  const running = service.run(request('stopped'))
  await reached; await service.stop('stopped'); release()
  const stopped = await running
  expect(stopped).toMatchObject({ status: 'unknown', stopped: true, resources: [] })
  expect((await new ImageGenerationService({ directory: root, provider }).run(request('stopped'))).status).toBe('unknown')
  expect(calls).toBe(1)
  let resultReady!: () => void, releaseResult!: () => void
  const ready = new Promise<void>(resolve => { resultReady = resolve })
  const late = new ImageGenerationService({ directory: root, provider: { generate: async (req, refs, opts) => {
    entered = () => { setImmediate(() => release()) }
    const result = await provider.generate(req, refs, opts); resultReady()
    await new Promise<void>(resolve => { releaseResult = resolve }); return result
  } } })
  const lateRun = late.run(request('late')); await ready; await late.stop('late'); releaseResult()
  const retained = await lateRun
  expect(retained).toMatchObject({ status: 'unapplied', stopped: true, resources: [{ width: 32, height: 24 }] })
  expect(Buffer.from((await late.readResource(retained.resources[0]!.resourceId)).bytes)).toEqual(image)
  expect(calls).toBe(2)
})

it('times out an unanswered Images request as unknown and never resends the same paid job', async () => {
  const root = await directory(); let calls = 0
  const hangingFetch: typeof fetch = async (_url, init) => {
    calls++
    await new Promise<never>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal || typeof signal === 'string') throw new Error('missing abort signal')
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    throw new Error('unreachable')
  }
  const provider = new ChatGPTImageProvider({ credentialResolver: resolver, fetch: hangingFetch, timeoutMs: 25 })
  const service = new ImageGenerationService({ directory: root, provider })
  const first = await service.run(request('timeout'))
  expect(first).toMatchObject({ status: 'unknown', resources: [], stopped: false,
    failure: { outcome: 'unknown', kind: 'timeout', code: 'image-timeout' },
    provenance: { charge: 'unknown', querySupport: 'unavailable' } })
  expect(calls).toBe(1)
  expect(await new ImageGenerationService({ directory: root, provider }).run(request('timeout'))).toEqual(first)
  expect(calls).toBe(1)
})

it('defers image cache collection during an active provider request and leaves a no-resend tombstone', async () => {
  const root = await directory(), image = await fixture(); let entered!: () => void, release!: () => void, calls = 0
  const started = new Promise<void>(resolve => { entered = resolve })
  const service = new ImageGenerationService({ directory: root, provider: { generate: async input => {
    calls++; entered(); await new Promise<void>(resolve => { release = resolve })
    return { status: 'completed', images: [{ bytes: image, mimeType: 'image/png', filename: 'image.png' }], provenance: imageProvenance(input) }
  } } })
  const running = service.run(request('active'))
  await started
  expect(await service.releaseRunJobs(['run'])).toEqual({ deferred: true, jobs: 0, resources: 0 })
  release()
  const completed = await running
  expect(completed.status).toBe('ready')
  expect((await service.releaseRunJobs(['run'])).jobs).toBe(1)
  await expect(service.readResource(completed.resources[0]!.resourceId)).rejects.toThrow()
  await expect(service.run(request('active'))).rejects.toThrow('不能再次发送')
  expect(calls).toBe(1)
})
