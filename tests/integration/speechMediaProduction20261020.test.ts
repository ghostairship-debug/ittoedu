// @vitest-environment node
import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaCapabilityService, type MediaConnectionCapability } from '../../src/main/workbench/media/MediaCapabilityService'
import { SpeechMediaJobAdapter } from '../../src/main/workbench/media/SpeechMediaJobAdapter'
import { prepareMediaResource } from '../../src/main/workbench/admittedMediaResource'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { importCourseSounds } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import type { ModelConnectionSnapshot } from '../../src/shared/workbench/modelProvider'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** Fixed one-second mono PCM fixture. This is test audio, never claimed as generated speech. */
function wavFixture(): Uint8Array {
  const bytes = Buffer.alloc(44 + 16_000)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(16_000, 40)
  for (let index = 0; index < 8_000; index++) bytes.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 440 / 8_000) * 2_000), 44 + index * 2)
  return new Uint8Array(bytes)
}

const capability: MediaConnectionCapability = { kind: 'speech', connectionId: 'speech-connection', connectionRevision: 1,
  model: 'fixture-speech', verified: true, billing: 'unknown',
  speech: { voices: ['fixture-narrator', 'fixture-friend'], defaultVoice: 'fixture-narrator', formats: ['wav'], defaultFormat: 'wav' } }

async function fixture(handler: RequestListener) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-production-')); roots.push(directory)
  const server = createServer(handler); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind TCP')
  const connection: ModelConnectionSnapshot = { id: capability.connectionId, revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
    billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }
  const options = { directory, resolveConnection: async () => connection, credentialResolver: vi.fn(async () => 'fixture-key') }
  const service = new MediaCapabilityService([new SpeechMediaJobAdapter(options)])
  service.beginRun('author', { writable: true, capabilities: [capability] })
  return { directory, options, service, connection }
}

it('routes one real local HTTP response through durable audio, formal sounds, save and a fresh archive load', async () => {
  const requests: { path: string; body: unknown }[] = [], audio = wavFixture()
  const f = await fixture(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    response.writeHead(200, { 'Content-Type': 'audio/wav', 'x-request-id': 'fixture-request-1' }); response.end(audio)
  })
  const result = await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hello, my friend.', voice: 'fixture-friend', format: 'wav', language: 'en' })
  expect(result).toMatchObject({ status: 'started', job: { status: 'ready', providerRequestId: 'fixture-request-1',
    resources: [{ source: expect.stringMatching(/^media:speech_/), mimeType: 'audio/wav', durationSeconds: 1 }] } })
  expect(requests).toEqual([{ path: '/v1/audio/speech', body: { model: 'fixture-speech', input: 'Hello, my friend.', voice: 'fixture-friend', response_format: 'wav' } }])
  if (result.status !== 'started') throw new Error('Expected ready fixture audio')
  const resource = result.job.resources![0]!
  const reopenedService = new MediaCapabilityService([new SpeechMediaJobAdapter(f.options)])
  reopenedService.beginRun('author', { writable: true, capabilities: [capability] })
  const file = await reopenedService.readResource('author', resource.resourceId)
  expect(file).toMatchObject({ mimeType: 'audio/wav', filename: 'speech.wav' })
  const prepared = await prepareMediaResource(file, () => 'speech-fixture')
  const h = await createV10StoreHost(createBlankCourseProjectV10('Fixed audio software verification'))
  try {
    await importCourseSounds(h.kernel, h.kernel.captureTarget(), [prepared])
    expect(Object.values(h.model().project.media!.audio.sounds)).toEqual([expect.objectContaining({ assetId: prepared.meta.id })])
    expect(h.first.read().undoDepth).toBe(1)
    await h.bridge.save()
    const archivePath = path.join(f.directory, 'fixture.glx')
    await fs.writeFile(archivePath, h.disk.get('saved.glx')!)
    const loaded = h.driver.load(new Uint8Array(await fs.readFile(archivePath)))
    if (loaded.kind !== 'course-v10') throw new Error('Expected fresh V10 archive load')
    expect(loaded.project.assets[prepared.meta.id]).toMatchObject({ kind: 'audio', mimeType: 'audio/wav' })
    expect(loaded.resources.assets[prepared.meta.id].byteLength).toBe(16_044)
    await h.bridge.undo(); expect(h.model().project.assets[prepared.meta.id]).toBeUndefined()
  } finally { h.bridge.dispose() }
  reopenedService.beginRun('other', { writable: true })
  await expect(reopenedService.readResource('other', resource.resourceId)).rejects.toThrow('不属于当前任务')
  await reopenedService.stopRun('author')
  await expect(reopenedService.readResource('author', resource.resourceId)).rejects.toThrow('已停止')
})

it('does not enable an unverified route or send OAuth, unsupported voice or reference requests', async () => {
  let requests = 0
  const f = await fixture((_request, response) => { requests++; response.end(wavFixture()) })
  expect((await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi', voice: 'unknown' })).status).toBe('rejected')
  expect((await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi', referenceResources: ['voice-clone'] })).status).toBe('rejected')
  f.connection.auth.kind = 'oauth'; f.connection.protocol = 'chatgpt-responses'
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi' })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('登录不支持') })
  f.service.beginRun('unconfigured', { writable: true })
  expect(await f.service.start('unconfigured', { kind: 'speech', engine: 'remote', prompt: 'Hi' })).toMatchObject({ status: 'not-configured' })
  f.service.beginRun('missing-voice-facts', { writable: true, capabilities: [{ ...capability, speech: undefined }] })
  expect(f.service.discover('missing-voice-facts').find(entry => entry.engine === 'remote')).toMatchObject({ kind: 'speech', status: 'not-configured', reason: expect.stringContaining('声音角色或格式') })
  expect(await f.service.start('missing-voice-facts', { kind: 'speech', engine: 'remote', prompt: 'Hi' })).toMatchObject({ status: 'not-configured' })
  expect(requests).toBe(0); expect(f.options.credentialResolver).not.toHaveBeenCalled()
})

it('preserves rejection and unknown response diagnostics without retrying or storing invalid audio', async () => {
  let requests = 0
  const f = await fixture((_request, response) => {
    requests++; response.writeHead(requests === 1 ? 400 : 200, { 'Content-Type': 'application/json' }); response.end('{"error":"fixture"}')
  })
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi' })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('HTTP 400') })
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi' })).toMatchObject({ status: 'unknown', reason: expect.stringContaining('完整音频') })
  expect(requests).toBe(2)
  expect(await fs.readdir(f.directory)).toEqual([])
})
