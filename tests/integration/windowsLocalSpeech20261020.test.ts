// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaCapabilityService } from '../../src/main/workbench/media/MediaCapabilityService'
import { SpeechMediaJobAdapter } from '../../src/main/workbench/media/SpeechMediaJobAdapter'
import { WindowsSpeechSynthesizer, type LocalSpeechSynthesizer } from '../../src/main/workbench/media/WindowsSpeechSynthesizer'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'windows-local-speech-')); roots.push(root); return root }

it('keeps local discovery factual and rejects read-only or unsupported output before invoking the synthesizer', async () => {
  const synthesize = vi.fn<LocalSpeechSynthesizer['synthesize']>()
  const local: LocalSpeechSynthesizer = { voices: async () => [{ name: 'Chinese voice', culture: 'zh-CN' }, { name: 'English voice', culture: 'en-US' }], synthesize }
  const fetch = vi.fn(), adapter = new SpeechMediaJobAdapter({ directory: await directory(), local, fetch })
  const discovery = await adapter.discoverLocal()
  expect(discovery.capability).toMatchObject({ route: 'windows-local', billing: 'local', model: 'Windows.SystemSpeech',
    speech: { defaultVoice: 'English voice', voiceCultures: { 'English voice': 'en-US' } } })
  expect(discovery.capability).not.toHaveProperty('connectionId')
  const service = new MediaCapabilityService([adapter])
  service.beginRun('readonly', { writable: false, capabilities: [discovery.capability!] })
  expect(await service.start('readonly', { kind: 'speech', prompt: 'Hello' })).toMatchObject({ status: 'rejected', reason: '当前任务没有媒体生成授权' })
  service.beginRun('writer', { writable: true, capabilities: [discovery.capability!] })
  expect(await service.start('writer', { kind: 'speech', prompt: 'Hello', format: 'mp3' })).toMatchObject({ status: 'rejected' })
  expect(await service.start('writer', { kind: 'speech', prompt: 'Hello', language: 'fr' })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('fr') })
  expect(synthesize).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  const unavailable = new SpeechMediaJobAdapter({ directory: await directory(), local: { ...local, voices: async () => { throw new Error('No desktop voice available') } } })
  expect(await unavailable.discoverLocal()).toEqual({ reason: 'No desktop voice available' })
  service.beginRun('no-voice', { writable: true, unavailableReasons: { speech: 'No desktop voice available' } })
  expect(service.discover('no-voice')[0]).toMatchObject({ status: 'not-configured', reason: 'No desktop voice available' })
})

it('stops local synthesis through the original signal without automatic replay or a ready resource', async () => {
  const root = await directory()
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const synthesize = vi.fn<LocalSpeechSynthesizer['synthesize']>(async (_input, signal) => {
    entered()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Desktop speech stopped')), { once: true }))
  })
  const adapter = new SpeechMediaJobAdapter({ directory: root, local: { voices: async () => [{ name: 'English voice', culture: 'en-US' }], synthesize } })
  const service = new MediaCapabilityService([adapter]), discovery = await adapter.discoverLocal()
  service.beginRun('run', { writable: true, capabilities: [discovery.capability!] })
  const generation = service.start('run', { kind: 'speech', prompt: 'Hello' })
  await started; await service.stopRun('run')
  expect(await generation).toMatchObject({ status: 'rejected', reason: 'Desktop speech stopped' })
  expect(synthesize).toHaveBeenCalledOnce()
  expect(await fs.readdir(root)).toEqual([])
})

it.runIf(process.platform === 'win32')('generates actual desktop English WAV through the shared durable speech owner and closes an aborted helper', async () => {
  const root = await directory(), local = new WindowsSpeechSynthesizer(), adapter = new SpeechMediaJobAdapter({ directory: root, local })
  const discovery = await adapter.discoverLocal()
  expect(discovery.capability, discovery.reason).toBeDefined()
  expect(discovery.capability!.speech.voiceCultures![discovery.capability!.speech.defaultVoice]).toMatch(/^en(?:-|$)/i)
  const service = new MediaCapabilityService([adapter])
  service.beginRun('actual-local', { writable: true, capabilities: [discovery.capability!] })
  const result = await service.start('actual-local', { kind: 'speech', prompt: 'Hello. We ask questions, listen, and learn about each other.', language: 'en' })
  expect(result).toMatchObject({ status: 'started', job: { status: 'ready', resources: [{ mimeType: 'audio/wav', durationSeconds: expect.any(Number) }] } })
  if (result.status !== 'started') throw new Error('Expected actual speech result')
  const resource = result.job.resources![0]!, read = await service.readResource('actual-local', resource.resourceId)
  expect(read.bytes.byteLength).toBeGreaterThan(1000)
  expect(Buffer.from(read.bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF')
  const receipt = JSON.parse(await fs.readFile(path.join(root, `${resource.resourceId}.json`), 'utf8'))
  expect(receipt).toMatchObject({ route: 'windows-local', voice: discovery.capability!.speech.defaultVoice })
  expect(receipt).not.toHaveProperty('connectionId')
  const reopened = new SpeechMediaJobAdapter({ directory: root, local })
  expect((await reopened.readResource('actual-local', resource.resourceId)).bytes.byteLength).toBe(read.bytes.byteLength)
  await expect(reopened.readResource('different-run', resource.resourceId)).rejects.toThrow('不属于当前任务')
  const stop = new AbortController()
  const pending = local.synthesize({ text: 'This long recording is cancelled. '.repeat(1000), voice: receipt.voice }, stop.signal)
  stop.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
}, 15_000)
