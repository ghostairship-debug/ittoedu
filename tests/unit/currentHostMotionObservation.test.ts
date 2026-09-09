import { describe, expect, it, vi } from 'vitest'
import { collectCurrentHostMotion, currentHostMotionEvidenceSchema } from '@/renderer/authoring/generation/currentHostMotionObservation'
import type { AuthoringObservationCaptureImage } from '@/shared/authoringObservation'

const image = (capturedAt: number): AuthoringObservationCaptureImage => ({
  dataUrl: 'data:image/png;base64,aW1hZ2U=', capturedAt, width: 980, height: 1146,
})

function fixture() {
  let time = 100
  const first = image(1)
  const assertCurrent = vi.fn()
  const wait = vi.fn(async (durationMs: number) => { time += durationMs })
  const capture = vi.fn(async () => { time += 25; return image(time) })
  return { first, capture, assertCurrent, wait, now: () => time }
}

describe('finite current-host motion sampling', () => {
  it('reuses the first actual frame and schedules only two more against one monotonic origin', async () => {
    const h = fixture()
    const frames = await collectCurrentHostMotion(h.first, h)
    expect(frames[0].image).toBe(h.first)
    expect(h.capture).toHaveBeenCalledTimes(2)
    expect(h.wait.mock.calls).toEqual([[250], [475]])
    expect(frames.map(item => item.elapsedMs)).toEqual([0, 275, 775])
    expect(h.assertCurrent.mock.invocationCallOrder[0]).toBeLessThan(h.wait.mock.invocationCallOrder[0]!)
    expect(h.assertCurrent.mock.invocationCallOrder.at(-1)).toBeGreaterThan(h.capture.mock.invocationCallOrder.at(-1)!)
  })

  it('rejects a drift during a wait before capturing or returning a partial sequence', async () => {
    const h = fixture()
    h.wait.mockImplementation(async () => { h.assertCurrent.mockImplementation(() => { throw new Error('selection changed') }) })
    await expect(collectCurrentHostMotion(h.first, h)).rejects.toThrow('selection changed')
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.wait).toHaveBeenCalledOnce()
  })

  it('rejects late pixels when the current document changes during capture', async () => {
    const h = fixture()
    h.capture.mockImplementation(async () => {
      h.assertCurrent.mockImplementation(() => { throw new Error('document changed') })
      return image(2)
    })
    await expect(collectCurrentHostMotion(h.first, h)).rejects.toThrow('document changed')
    expect(h.capture).toHaveBeenCalledOnce()
  })

  it('does not retry a failed compositor capture', async () => {
    const h = fixture()
    h.capture.mockRejectedValue(new Error('capture unavailable'))
    await expect(collectCurrentHostMotion(h.first, h)).rejects.toThrow('capture unavailable')
    expect(h.capture).toHaveBeenCalledOnce()
  })

  it('rejects a changed image scale inside the same sequence', async () => {
    const h = fixture()
    h.capture.mockResolvedValue({ ...image(2), width: 1280 })
    await expect(collectCurrentHostMotion(h.first, h)).rejects.toThrow('画面尺度已变化')
    expect(h.capture).toHaveBeenCalledOnce()
  })

  it('bounds delayed hosts to three images without restarting the schedule', async () => {
    const h = fixture()
    h.capture.mockImplementation(async () => { await h.wait(1200); return image(2) })
    const frames = await collectCurrentHostMotion(h.first, h)
    expect(frames).toHaveLength(3)
    expect(h.capture).toHaveBeenCalledTimes(2)
    expect(h.wait.mock.calls).toEqual([[250], [1200], [0], [1200]])
  })
})

describe('current-host motion evidence contract', () => {
  const evidence = {
    version: 1, source: 'actual-current-host', projectId: 'project', documentRevision: 2, sessionGeneration: 1,
    viewSource: 'authoring', surfaceId: 'surface', locationId: 'location', stateId: null, runtime: null,
    instances: [{ instanceId: 'formal-cube', carrier: 'runtime' }], captureRect: { x: 10, y: 20, width: 490, height: 573 },
    frames: [0, 250, 750].map((elapsedMs, index) => ({ fileId: index ? `motion-frame-${index}` : 'current-frame', elapsedMs, capturedAt: 1000 + elapsedMs, width: 980, height: 1146 })),
    semanticVerdict: 'requires-review', privateRuntimeState: 'not-exposed',
  }

  it('keeps current formal frame identities and provenance while rejecting admission claims or extra controls', () => {
    expect(currentHostMotionEvidenceSchema.parse(evidence)).toEqual(evidence)
    expect(currentHostMotionEvidenceSchema.safeParse({ ...evidence, source: 'actual-candidate-host' }).success).toBe(false)
    expect(currentHostMotionEvidenceSchema.safeParse({ ...evidence, actions: ['suspend'] }).success).toBe(false)
    expect(currentHostMotionEvidenceSchema.safeParse({ ...evidence, frames: evidence.frames.slice(1) }).success).toBe(false)
  })

  it('rejects a substituted first frame or reordered timeline', () => {
    expect(currentHostMotionEvidenceSchema.safeParse({ ...evidence, frames: evidence.frames.map((value, index) => index ? value : { ...value, fileId: 'admission-frame' }) }).success).toBe(false)
    expect(currentHostMotionEvidenceSchema.safeParse({ ...evidence, frames: [evidence.frames[0], evidence.frames[2], evidence.frames[1]] }).success).toBe(false)
  })
})
