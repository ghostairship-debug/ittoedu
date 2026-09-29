import { describe, expect, it, vi } from 'vitest'
import { MediaCapabilityService, type MediaJobAdapter } from '../../src/main/workbench/media/MediaCapabilityService'

describe('M29 media capability boundary', () => {
  it('reports all three kinds unconfigured without a verified connection and never creates work', async () => {
    const submit = vi.fn()
    const service = new MediaCapabilityService([{ kind: 'speech', submit, cancelRun: vi.fn() }])
    service.beginRun('run', { writable: true })
    expect(service.discover('run')).toEqual([
      { kind: 'speech', status: 'not-configured', reason: expect.any(String) },
      { kind: 'video', status: 'not-configured', reason: expect.any(String) },
      { kind: 'music', status: 'not-configured', reason: expect.any(String) },
    ])
    for (const kind of ['speech', 'video', 'music'] as const) {
      expect((await service.start('run', { kind, prompt: 'A sample' })).status).toBe('not-configured')
    }
    expect(submit).not.toHaveBeenCalled()
  })

  it('rejects invalid parameters and read-only or stopped tasks before provider submission', async () => {
    const adapter: MediaJobAdapter = { kind: 'speech', submit: vi.fn().mockResolvedValue({ jobId: 'job', status: 'submitted' }), cancelRun: vi.fn().mockResolvedValue(undefined) }
    const capability = { kind: 'speech' as const, connectionId: 'connection', connectionRevision: 1, model: 'verified-speech', verified: true, billing: 'unknown' as const }
    const service = new MediaCapabilityService([adapter])
    service.beginRun('read-only', { writable: false, capabilities: [capability] })
    expect((await service.start('read-only', { kind: 'speech', prompt: 'Hi' })).status).toBe('rejected')
    service.beginRun('write', { writable: true, capabilities: [capability] })
    expect((await service.start('write', { kind: 'speech', prompt: 'Hi', durationSeconds: -1 })).status).toBe('rejected')
    await service.stopRun('write')
    expect((await service.start('write', { kind: 'speech', prompt: 'Hi' })).status).toBe('rejected')
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('does not expose a late provider receipt as an actionable resource after Stop', async () => {
    let finish!: (value: { jobId: string; status: 'ready' }) => void
    const adapter: MediaJobAdapter = { kind: 'speech', submit: () => new Promise(resolve => { finish = resolve }), cancelRun: vi.fn().mockResolvedValue(undefined) }
    const service = new MediaCapabilityService([adapter])
    service.beginRun('run', { writable: true, capabilities: [{ kind: 'speech', connectionId: 'connection', connectionRevision: 1,
      model: 'verified-speech', verified: true, billing: 'unknown' }] })
    const pending = service.start('run', { kind: 'speech', prompt: 'Hi' })
    await service.stopRun('run')
    finish({ jobId: 'late-job', status: 'ready' })
    expect(await pending).toMatchObject({ status: 'unknown', kind: 'speech' })
  })
})
