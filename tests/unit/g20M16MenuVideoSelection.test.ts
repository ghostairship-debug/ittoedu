import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaImportPorts } from '@/renderer/app/useMediaImport'

const probe = vi.hoisted(() => ({
  decode: vi.fn<() => Promise<{ duration: number; width: number; height: number }>>(),
}))

vi.mock('@/renderer/project/assetManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/project/assetManager')>()
  return { ...actual, readMediaMetadata: probe.decode }
})

import { useMediaImport } from '@/renderer/app/useMediaImport'

function harness(selected: Awaited<ReturnType<NonNullable<MediaImportPorts['selectVideo']>>>) {
  const errors: unknown[] = []
  const writes = {
    importAssetsAtTarget: vi.fn(),
    placeVideoNodes: vi.fn(),
    commitCandidateMedia: vi.fn(),
    replaceSelectedVideo: vi.fn(),
    commitStatus: vi.fn(),
  }
  const selectVideo = vi.fn(async () => selected)
  const runBusy = vi.fn(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    try { return await operation() } catch (error) { errors.push(error); return undefined }
  })
  const ports = { ...writes, selectVideo, runBusy } as unknown as MediaImportPorts
  return { ports, writes, errors, selectVideo, runBusy }
}

afterEach(() => {
  probe.decode.mockReset()
})

describe('M16 single video selection', () => {
  it('returns null on picker cancellation without decoding or writing', async () => {
    const h = harness(null)
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectVideoAsset()).toBeNull()
    expect(h.selectVideo).toHaveBeenCalledTimes(1)
    expect(probe.decode).not.toHaveBeenCalled()
    expect(h.runBusy).toHaveBeenCalledTimes(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('returns validated metadata and copied original bytes without touching the project', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const h = harness({ name: 'lesson.mp4', path: 'lesson.mp4', mimeType: 'video/mp4', bytes })
    probe.decode.mockResolvedValue({ duration: 8, width: 640, height: 360 })
    const { result } = renderHook(() => useMediaImport(h.ports))
    const asset = await result.current.selectVideoAsset()
    expect(probe.decode).toHaveBeenCalledWith(bytes, 'video/mp4', 'video')
    expect(asset?.meta).toMatchObject({ kind: 'video', mimeType: 'video/mp4', duration: 8, width: 640, height: 360, byteLength: 4 })
    expect(asset?.bytes).toEqual(bytes)
    expect(asset?.bytes).not.toBe(bytes)
    bytes[0] = 9
    expect(asset?.bytes[0]).toBe(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('reports decode failure through runBusy and leaves all writes untouched', async () => {
    const h = harness({ name: 'bad.mp4', path: 'bad.mp4', mimeType: 'video/mp4', bytes: new Uint8Array([1]) })
    probe.decode.mockRejectedValue(new Error('decode failed'))
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectVideoAsset()).toBeNull()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects an unsupported video MIME even if metadata decoding returns dimensions', async () => {
    const h = harness({ name: 'unsupported.mov', path: 'unsupported.mov', mimeType: 'video/quicktime', bytes: new Uint8Array([1]) })
    probe.decode.mockResolvedValue({ duration: 3, width: 320, height: 240 })
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectVideoAsset()).toBeNull()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })
})
