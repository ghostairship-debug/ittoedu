import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaImportPorts } from '@/renderer/app/useMediaImport'

const probe = vi.hoisted(() => ({
  decode: vi.fn<() => Promise<{ duration: number }>>(),
}))

vi.mock('@/renderer/project/assetManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/project/assetManager')>()
  return { ...actual, readMediaMetadata: probe.decode }
})

import { useMediaImport } from '@/renderer/app/useMediaImport'

function harness(selected: Awaited<ReturnType<NonNullable<MediaImportPorts['selectAudio']>>>) {
  const errors: unknown[] = []
  const writes = {
    importAssetsAtTarget: vi.fn(),
    importSounds: vi.fn(),
    placeFlowAudioNodes: vi.fn(),
    commitCandidateMedia: vi.fn(),
    commitStatus: vi.fn(),
  }
  const selectAudio = vi.fn(async () => selected)
  const selectAudios = vi.fn()
  const runBusy = vi.fn(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    try { return await operation() } catch (error) { errors.push(error); return undefined }
  })
  const ports = { ...writes, selectAudio, selectAudios, runBusy } as unknown as MediaImportPorts
  return { ports, writes, errors, selectAudio, selectAudios, runBusy }
}

afterEach(() => probe.decode.mockReset())

describe('M16 single audio selection', () => {
  it('returns null on picker cancellation without decoding or writing', async () => {
    const h = harness(null)
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectAudioAsset()).toBeNull()
    expect(h.selectAudio).toHaveBeenCalledTimes(1)
    expect(h.selectAudios).not.toHaveBeenCalled()
    expect(probe.decode).not.toHaveBeenCalled()
    expect(h.runBusy).toHaveBeenCalledTimes(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('returns validated metadata and copied original bytes without touching the project', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const h = harness({ name: 'lesson.mp3', path: 'lesson.mp3', mimeType: 'audio/mpeg', bytes })
    probe.decode.mockResolvedValue({ duration: 8 })
    const { result } = renderHook(() => useMediaImport(h.ports))
    const asset = await result.current.selectAudioAsset()
    expect(probe.decode).toHaveBeenCalledWith(bytes, 'audio/mpeg', 'audio')
    expect(asset?.meta).toMatchObject({ kind: 'audio', mimeType: 'audio/mpeg', duration: 8, byteLength: 4 })
    expect(asset?.bytes).toEqual(bytes)
    expect(asset?.bytes).not.toBe(bytes)
    bytes[0] = 9
    expect(asset?.bytes[0]).toBe(1)
    expect(h.selectAudios).not.toHaveBeenCalled()
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('reports decode failure through runBusy without writing', async () => {
    const h = harness({ name: 'bad.mp3', path: 'bad.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array([1]) })
    probe.decode.mockRejectedValue(new Error('decode failed'))
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectAudioAsset()).toBeNull()
    expect(h.errors).toHaveLength(1)
    expect(h.selectAudios).not.toHaveBeenCalled()
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects unsupported MIME after metadata decoding without writing', async () => {
    const h = harness({ name: 'unsupported.aiff', path: 'unsupported.aiff', mimeType: 'audio/aiff', bytes: new Uint8Array([1]) })
    probe.decode.mockResolvedValue({ duration: 3 })
    const { result } = renderHook(() => useMediaImport(h.ports))
    expect(await result.current.selectAudioAsset()).toBeNull()
    expect(h.errors).toHaveLength(1)
    expect(h.selectAudios).not.toHaveBeenCalled()
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })
})
