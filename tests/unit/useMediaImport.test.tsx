import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaImportIdentity, MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { emptyCourseAssetSidecar, freezeCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'
import { createImageAssetImport } from '../../src/renderer/project/assetManager'

const dimensionProbe = vi.hoisted(() => ({
  calls: 0,
  resolve: null as ((value: { width: number; height: number }) => void) | null,
}))

const dedupeProbe = vi.hoisted(() => ({
  calls: 0,
  deferred: false,
  release: null as (() => void) | null,
}))

vi.mock('../../src/renderer/project/assetManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/project/assetManager')>()
  return {
    ...actual,
    readImageDimensions: () => new Promise<{ width: number; height: number }>((resolve) => {
      dimensionProbe.calls += 1
      dimensionProbe.resolve = resolve
    }),
  }
})

vi.mock('../../src/renderer/project/v9AssetAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/project/v9AssetAdapter')>()
  return {
    ...actual,
    dedupeCourseMediaImports: async (
      kind: unknown,
      assets: unknown,
      sidecar: unknown,
      items: unknown,
    ) => {
      dedupeProbe.calls += 1
      if (dedupeProbe.deferred) {
        await new Promise<void>((resolve) => {
          dedupeProbe.release = resolve
        })
      }
      return actual.dedupeCourseMediaImports(
        kind as any,
        assets as any,
        sidecar as any,
        items as any,
      )
    },
  }
})

import { useMediaImport } from '../../src/renderer/app/useMediaImport'

interface Harness {
  readonly identity: {
    projectId: string
    revision: number
    locationId: string | null
    sessionGeneration: number
    surfaceId: string | null
    owner: string | null
    ownerKey: string | null
  }
  readonly errors: unknown[]
  readonly ports: MediaImportPorts
}

function createHarness(): Harness {
  const identity = {
    projectId: 'p1',
    revision: 1,
    locationId: 'L1',
    sessionGeneration: 1,
    surfaceId: 'surface-1',
    owner: 'scene',
    ownerKey: 'scene:surface-1:scene-1',
  }
  const errors: unknown[] = []
  const ports: MediaImportPorts = {
    captureIdentity: vi.fn(() => ({ ...identity }) as MediaImportIdentity),
    captureLibraryTarget: vi.fn(() => ({ projectId: 'p1', documentRevision: 1 })),
    captureImageReplacementTarget: vi.fn(() => null),
    readMediaLibrarySnapshot: vi.fn(() => ({ assets: {}, files: {} })),
    readCandidateMediaContext: vi.fn(() => ({ assets: {}, sidecar: emptyCourseAssetSidecar() })),
    readCourseMediaContext: vi.fn(() => ({ assets: {}, sidecar: emptyCourseAssetSidecar() })),
    replaceImageAtTarget: vi.fn(() => ({ ok: true })),
    importAssetsAtTarget: vi.fn(() => ({ ok: true })),
    placeImageNodes: vi.fn(() => []),
    placeVideoNodes: vi.fn(() => []),
    importSounds: vi.fn(() => []),
    commitCandidateMedia: vi.fn(),
    selectImage: vi.fn(async () => null),
    selectImages: vi.fn(async () => ({
      selectedCount: 1,
      acceptedByteLength: 3,
      accepted: [{
        name: 'a.png',
        path: 'a.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
        sha256: 'h1',
      }],
      rejected: [],
    })),
    selectAudios: vi.fn(async () => null),
    selectVideos: vi.fn(async () => null),
    runBusy: (async (operation: () => Promise<unknown>) => {
      try {
        return await operation()
      } catch (error) {
        errors.push(error)
        return undefined
      }
    }) as MediaImportPorts['runBusy'],
    commitStatus: vi.fn(),
    reportError: vi.fn(),
  }
  return { identity, errors, ports }
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const { title, message } = error as { title?: unknown; message?: unknown }
    return `${typeof title === 'string' ? title : ''} ${typeof message === 'string' ? message : ''}`
  }
  return String(error)
}

async function importWhileDecoding(
  harness: Harness,
  mutate: () => void,
): Promise<void> {
  const { result } = renderHook(() => useMediaImport(harness.ports))
  const pending = result.current.selectAndImportImage('add', { x: 10, y: 10 })
  await vi.waitFor(() => expect(dimensionProbe.calls).toBe(1))
  mutate()
  dimensionProbe.resolve?.({ width: 10, height: 10 })
  await pending
}

afterEach(() => {
  dimensionProbe.calls = 0
  dimensionProbe.resolve = null
  dedupeProbe.calls = 0
  dedupeProbe.deferred = false
  dedupeProbe.release = null
  vi.restoreAllMocks()
})

describe('useMediaImport target media Owner', () => {
  const chosen = { name: 'repeat.png', path: 'repeat.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]), sha256: 'h1' }

  function targetInput(harness: Harness) {
    return {
      kind: 'image' as const,
      captureTarget: () => ({ projectId: harness.identity.projectId, revision: harness.identity.revision,
        locationId: harness.identity.locationId }),
      isTargetCurrent: (target: { projectId: string; revision: number; locationId: string | null }) =>
        target.projectId === harness.identity.projectId && target.revision === harness.identity.revision
          && target.locationId === harness.identity.locationId,
    }
  }

  it('reuses the existing asset and sidecar bytes for identical content', async () => {
    const harness = createHarness()
    const existing = createImageAssetImport(chosen, { id: 'existing', dimensions: { width: 20, height: 10 } })
    harness.ports.readCourseMediaContext = vi.fn(() => ({ assets: { existing: existing.meta },
      sidecar: freezeCourseAssetSidecar({ existing: existing.bytes }) }))
    harness.ports.selectImage = vi.fn(async () => chosen)
    const { result } = renderHook(() => useMediaImport(harness.ports))
    const pending = result.current.selectTargetMedia(targetInput(harness))
    await vi.waitFor(() => expect(dimensionProbe.calls).toBe(1))
    dimensionProbe.resolve?.({ width: 20, height: 10 })
    const prepared = await pending
    expect(prepared?.asset.id).toBe('existing')
    expect(prepared?.source).toEqual({ kind: 'existing', assetId: 'existing' })
    expect(prepared?.bytes).toEqual(existing.bytes)
    expect(() => prepared?.assertCurrent()).not.toThrow()
  })

  it('returns null on picker cancellation without decoding or deduplication', async () => {
    const harness = createHarness()
    const { result } = renderHook(() => useMediaImport(harness.ports))
    expect(await result.current.selectTargetMedia(targetInput(harness))).toBeNull()
    expect(dimensionProbe.calls).toBe(0)
    expect(dedupeProbe.calls).toBe(0)
  })

  it('rejects a target changed while decoding', async () => {
    const harness = createHarness()
    harness.ports.selectImage = vi.fn(async () => chosen)
    const { result } = renderHook(() => useMediaImport(harness.ports))
    const pending = result.current.selectTargetMedia(targetInput(harness))
    await vi.waitFor(() => expect(dimensionProbe.calls).toBe(1))
    harness.identity.locationId = 'L2'
    dimensionProbe.resolve?.({ width: 20, height: 10 })
    await expect(pending).rejects.toThrow('工程已发生变化')
    expect(dedupeProbe.calls).toBe(0)
  })

  it('rejects a target changed during dedupe and rechecks before commit', async () => {
    const harness = createHarness()
    harness.ports.selectImage = vi.fn(async () => chosen)
    dedupeProbe.deferred = true
    const { result } = renderHook(() => useMediaImport(harness.ports))
    const pending = result.current.selectTargetMedia(targetInput(harness))
    await vi.waitFor(() => expect(dimensionProbe.calls).toBe(1))
    dimensionProbe.resolve?.({ width: 20, height: 10 })
    await vi.waitFor(() => expect(dedupeProbe.calls).toBe(1))
    harness.identity.revision = 2
    dedupeProbe.release?.()
    await expect(pending).rejects.toThrow('工程已发生变化')

    dedupeProbe.deferred = false
    harness.identity.revision = 1
    const again = result.current.selectTargetMedia(targetInput(harness))
    await vi.waitFor(() => expect(dimensionProbe.calls).toBe(2))
    dimensionProbe.resolve?.({ width: 20, height: 10 })
    const prepared = await again
    harness.identity.revision = 3
    expect(() => prepared?.assertCurrent()).toThrow('工程已发生变化')
  })
})

describe('useMediaImport stale results', () => {
  it('does not commit an image batch when the document changes during decoding', async () => {
    const harness = createHarness()
    await importWhileDecoding(harness, () => {
      harness.identity.revision = 2
    })

    expect(harness.ports.commitCandidateMedia).toHaveBeenCalledTimes(0)
    expect(harness.ports.placeImageNodes).toHaveBeenCalledTimes(0)
    expect(harness.ports.importAssetsAtTarget).toHaveBeenCalledTimes(0)
    expect(errorText(harness.errors[0])).toContain('工程已发生变化')
  })

  it('does not commit when the active location changes during decoding', async () => {
    const harness = createHarness()
    await importWhileDecoding(harness, () => {
      harness.identity.locationId = 'L2'
    })

    expect(harness.ports.commitCandidateMedia).toHaveBeenCalledTimes(0)
    expect(harness.ports.placeImageNodes).toHaveBeenCalledTimes(0)
    expect(harness.ports.importAssetsAtTarget).toHaveBeenCalledTimes(0)
    expect(errorText(harness.errors[0])).toContain('工程已发生变化')
  })

  it('does not commit when the active owner scope changes during decoding', async () => {
    const harness = createHarness()
    await importWhileDecoding(harness, () => {
      harness.identity.sessionGeneration += 1
      harness.identity.owner = 'global'
      harness.identity.ownerKey = 'global'
    })

    expect(harness.ports.commitCandidateMedia).toHaveBeenCalledTimes(0)
    expect(harness.ports.placeImageNodes).toHaveBeenCalledTimes(0)
    expect(harness.ports.importAssetsAtTarget).toHaveBeenCalledTimes(0)
    expect(errorText(harness.errors[0])).toContain('工程已发生变化')
  })

  it('does not commit when the document changes during deduplication', async () => {
    const harness = createHarness()
    dedupeProbe.deferred = true
    const { result } = renderHook(() => useMediaImport(harness.ports))
    const pending = result.current.selectAndImportImage('add', { x: 10, y: 10 })
    await vi.waitFor(() => expect(dimensionProbe.calls).toBe(1))
    dimensionProbe.resolve?.({ width: 10, height: 10 })
    await vi.waitFor(() => expect(dedupeProbe.calls).toBe(1))
    harness.identity.revision = 2
    dedupeProbe.release?.()
    await pending

    expect(harness.ports.commitCandidateMedia).toHaveBeenCalledTimes(0)
    expect(harness.ports.placeImageNodes).toHaveBeenCalledTimes(0)
    expect(harness.ports.importAssetsAtTarget).toHaveBeenCalledTimes(0)
    expect(errorText(harness.errors[0])).toContain('工程已发生变化')
  })
})
