import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaImportIdentity, MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { emptyCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'

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
    replaceImageAtTarget: vi.fn(() => ({ ok: true })),
    importAssetsAtTarget: vi.fn(() => ({ ok: true })),
    placeImageNodes: vi.fn(() => []),
    placeVideoNodes: vi.fn(() => []),
    importSounds: vi.fn(),
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
