// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaCapabilityService, type MediaCapability, type MediaConnectionCapability } from '../../src/main/workbench/media/MediaCapabilityService'
import { SpeechMediaJobAdapter } from '../../src/main/workbench/media/SpeechMediaJobAdapter'
import type { LocalSpeechSynthesizer } from '../../src/main/workbench/media/WindowsSpeechSynthesizer'
import type { ModelConnectionSnapshot } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** Fixed PCM test audio; no actual speech provider or installed Windows voice is used. */
function wavFixture() {
  const bytes = Buffer.alloc(44 + 160)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(160, 40)
  return new Uint8Array(bytes)
}

const remote: MediaConnectionCapability = {
  kind: 'speech', route: 'remote', connectionId: 'remote-speech-fixture', connectionRevision: 7,
  model: 'fixture-narration-v2', verified: true, billing: 'metered',
  speech: { voices: ['fixture-narrator', 'fixture-friend'], defaultVoice: 'fixture-narrator', formats: ['mp3', 'wav'], defaultFormat: 'mp3',
    instructions: true, speed: { min: 0.25, max: 4, default: 1 }, maxInputCharacters: 4096 },
}

async function fixture(fetchImpl?: typeof fetch, localImpl?: LocalSpeechSynthesizer, remoteCapability = remote) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dual-speech-')); roots.push(directory)
  const local = localImpl ?? { voices: vi.fn(async () => [{ name: 'Fixture local voice', culture: 'en-US' }]),
    synthesize: vi.fn(async () => wavFixture()) }
  const fetcher = fetchImpl ?? vi.fn(async () => new Response(wavFixture(), {
    headers: { 'Content-Type': 'audio/wav', 'x-request-id': 'fixture-remote-request' },
  }))
  const connection: ModelConnectionSnapshot = { id: remoteCapability.connectionId, revision: remoteCapability.connectionRevision,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'fixture-only' }, billing: { kind: 'metered' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }
  const resolveConnection = vi.fn(async () => connection), credentialResolver = vi.fn(async () => 'fixture-only-key')
  const adapter = new SpeechMediaJobAdapter({ directory, local, fetch: fetcher, resolveConnection, credentialResolver })
  const discovered = await adapter.discoverLocal()
  if (!discovered.capability) throw new Error('Expected the fixed local voice fixture')
  const service = new MediaCapabilityService([adapter])
  const capabilities: MediaCapability[] = [discovered.capability, remoteCapability]
  service.beginRun('author', { writable: true, capabilities })
  return { service, adapter, directory, local, fetcher, resolveConnection, credentialResolver, capabilities }
}

it('discovers two independent engines and keeps an omitted engine local even when only a remote connection is configured', async () => {
  const f = await fixture()
  const available = f.service.discover('author').filter(row => row.kind === 'speech' && row.status === 'available')
  expect(available).toEqual(expect.arrayContaining([
    expect.objectContaining({ engine: 'local', route: 'windows-local', model: 'Windows.SystemSpeech', billing: 'local', availabilityBasis: 'installed-voices' }),
    expect.objectContaining({ engine: 'remote', route: 'remote', model: 'fixture-narration-v2', billing: 'metered', speech: remote.speech, availabilityBasis: 'configuration' }),
  ]))
  expect(available).toHaveLength(2)
  expect(f.capabilities[0]).not.toHaveProperty('connectionId')
  expect(f.capabilities[0]).not.toHaveProperty('connectionRevision')
  expect(await f.service.start('author', { kind: 'speech', prompt: 'Read this locally.' })).toMatchObject({
    status: 'started', job: { status: 'ready', resources: [{ mimeType: 'audio/wav' }] },
  })
  expect(f.local.synthesize).toHaveBeenCalledOnce()
  expect(f.local.synthesize).toHaveBeenCalledWith({ text: 'Read this locally.', voice: 'Fixture local voice' }, expect.any(AbortSignal))
  f.service.beginRun('remote-only', { writable: true, capabilities: [remote] })
  expect(await f.service.start('remote-only', { kind: 'speech', prompt: 'Do not buy speech implicitly.' })).toMatchObject({ status: 'not-configured' })
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.resolveConnection).not.toHaveBeenCalled()
  expect(f.credentialResolver).not.toHaveBeenCalled()
})

it('sends explicit remote expressive controls exactly once and keeps its durable audio scoped to the requesting run', async () => {
  const f = await fixture()
  const result = await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'We made it!',
    voice: 'fixture-friend', format: 'wav', instructions: 'Sound delighted, then pause briefly.', speed: 1.25 })
  expect(result).toMatchObject({ status: 'started', job: { status: 'ready', providerRequestId: 'fixture-remote-request',
    resources: [{ source: expect.stringMatching(/^media:speech_/), mimeType: 'audio/wav' }] } })
  expect(f.fetcher).toHaveBeenCalledOnce()
  const [url, init] = vi.mocked(f.fetcher).mock.calls[0]!
  expect(url).toBe('http://127.0.0.1:1/v1/audio/speech')
  expect(JSON.parse(String(init?.body))).toEqual({ model: 'fixture-narration-v2', input: 'We made it!', voice: 'fixture-friend',
    response_format: 'wav', instructions: 'Sound delighted, then pause briefly.', speed: 1.25 })
  expect(f.local.synthesize).not.toHaveBeenCalled()
  if (result.status !== 'started') throw new Error('Expected ready fixture audio')
  const resourceId = result.job.resources![0]!.resourceId
  expect(await f.service.readResource('author', resourceId)).toMatchObject({ filename: 'speech.wav', mimeType: 'audio/wav' })
  f.service.beginRun('other', { writable: true, capabilities: f.capabilities })
  await expect(f.service.readResource('other', resourceId)).rejects.toThrow('不属于当前任务')
})

it('rejects unsupported local controls before synthesis and never falls back to local after a remote HTTP failure', async () => {
  const fetcher = vi.fn(async () => new Response('{"error":"fixture rejection"}', { status: 400 }))
  const f = await fixture(fetcher)
  expect(await f.service.start('author', { kind: 'speech', engine: 'local', prompt: 'Hi', instructions: 'Sound cheerful.' }))
    .toMatchObject({ status: 'rejected', reason: expect.stringMatching(/instructions|指令|表达|风格/i) })
  expect(await f.service.start('author', { kind: 'speech', engine: 'local', prompt: 'Hi', speed: 1.2 }))
    .toMatchObject({ status: 'rejected', reason: expect.stringMatching(/speed|语速/i) })
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'x'.repeat(4097) })).toMatchObject({ status: 'rejected' })
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi', instructions: 'x'.repeat(4097) })).toMatchObject({ status: 'rejected' })
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi', speed: 4.01 })).toMatchObject({ status: 'rejected' })
  expect(f.local.synthesize).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(f.credentialResolver).not.toHaveBeenCalled()
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Hi', format: 'wav' }))
    .toMatchObject({ status: 'rejected', reason: expect.stringContaining('HTTP 400') })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(f.local.synthesize).not.toHaveBeenCalled()
  expect(await fs.readdir(f.directory)).toEqual([])
})

it('passes declared expressive controls for a custom model and rejects the same controls when that model has no capability declaration', async () => {
  const configured: MediaConnectionCapability = { ...remote, model: 'classroom-expressive-v2',
    speech: { ...remote.speech!, voices: ['teacher-warm'], defaultVoice: 'teacher-warm',
      instructions: true, speed: { min: 0.5, max: 2, default: 1 } } }
  const f = await fixture(undefined, undefined, configured)
  expect(await f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Welcome, everyone.',
    voice: 'teacher-warm', format: 'wav', instructions: 'Read with gentle curiosity.', speed: 0.85 })).toMatchObject({ status: 'started' })
  expect(f.fetcher).toHaveBeenCalledOnce()
  const [, init] = vi.mocked(f.fetcher).mock.calls[0]!
  expect(JSON.parse(String(init?.body))).toEqual({ model: 'classroom-expressive-v2', input: 'Welcome, everyone.',
    voice: 'teacher-warm', response_format: 'wav', instructions: 'Read with gentle curiosity.', speed: 0.85 })
  f.service.beginRun('undeclared-controls', { writable: true, capabilities: [{ ...configured,
    speech: { ...configured.speech!, instructions: undefined, speed: undefined } }] })
  expect(await f.service.start('undeclared-controls', { kind: 'speech', engine: 'remote', prompt: 'Hi', instructions: 'Sound cheerful.' }))
    .toMatchObject({ status: 'rejected', reason: expect.stringMatching(/instructions|指令|表达|风格/i) })
  expect(await f.service.start('undeclared-controls', { kind: 'speech', engine: 'remote', prompt: 'Hi', speed: 0.85 }))
    .toMatchObject({ status: 'rejected', reason: expect.stringMatching(/speed|语速/i) })
  expect(f.fetcher).toHaveBeenCalledOnce()
  expect(f.credentialResolver).toHaveBeenCalledOnce()
  expect(f.local.synthesize).not.toHaveBeenCalled()
})

it('does not expose usable late remote audio after Stop, including a transport that ignores its abort signal', async () => {
  let release!: (response: Response) => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const fetcher = vi.fn(async () => { entered(); return new Promise<Response>(resolve => { release = resolve }) })
  const f = await fixture(fetcher)
  const pending = f.service.start('author', { kind: 'speech', engine: 'remote', prompt: 'Late fixture audio.', format: 'wav' })
  await started
  await f.service.stopRun('author')
  release(new Response(wavFixture(), { headers: { 'Content-Type': 'audio/wav' } }))
  const result = await pending
  expect(result.status).toBe('unknown')
  expect(result).not.toHaveProperty('job')
  expect(f.local.synthesize).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(await fs.readdir(f.directory)).toEqual([])
  await expect(f.service.readResource('author', 'speech_00000000-0000-4000-8000-000000000000')).rejects.toThrow('已停止')
})
